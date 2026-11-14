// ============================================================
//  TowerForge Link — reading the export
//  The game writes tool_export.json to its own folder,
//  /sdcard/Android/data/com.TechTreeGames.TheTower/files/ (Unity's
//  persistentDataPath; TheTowerSDK save/access/path). Phones on
//  Android 11+ hide that folder from other apps and the browser, but
//  adb can read it. Steps:
//   1. Pick an adb: with a phone paired over Wi-Fi, Google's (only it
//      can reach phones that way — Phones.cs); else the running
//      emulator's own (no version clash with the adb it runs itself),
//      else Android's platform-tools.
//   2. Connect to each running emulator's adb port, and to paired
//      phones adb can see on the Wi-Fi.
//   3. For every device adb lists, look for the file with `adb ls`
//      (the file-transfer channel: size and modified time, no shell).
//   4. Copy one out with `adb pull` into a temp file, read it, delete
//      it: the one the player picked on the site (?source=, from
//      /sources — Link 0.4), else the newest.
//  MuMu Player with its ADB port shut (MuMuShell.cs): its own
//  MuMuManager.exe reads the file instead, with fixed commands.
//  iPhones (IPhoneBackups.cs): the export is read out of the newest
//  iPhone backup on this PC instead; it's one more source to pick, and
//  without a pick the newest export of all wins.
//  Nothing else on the device or in the backup is read or changed.
// ============================================================

using System.Globalization;

namespace TowerForge.Link;

internal sealed record ExportFile(byte[] Data, long ModifiedUnix, string Source, string SourceId);

// One place an export can come from, for the site's list. State: ready
// (has an export), no_export, no_game, blocked (adb refused), offline
// (running but not answering), unauthorized, encrypted (iPhone backup).
internal sealed record ExportSource(string Id, string Name, string Kind, string State, long? Modified, string? Message);

// What went wrong, in words for the player; Code is for the website.
internal sealed class ExportProblem(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}

internal static class Exporter
{
    public const string Package = "com.TechTreeGames.TheTower";
    public const string IPhoneSourceId = "iphone-backup";
    private const string Folder = "/sdcard/Android/data/" + Package + "/files/";
    private const string FileName = "tool_export.json";
    private static readonly TimeSpan Quick = TimeSpan.FromSeconds(8);
    private static readonly TimeSpan Copy = TimeSpan.FromSeconds(60);

    private sealed record LsEntry(string Name, long Size, long Modified);

    // A device adb listed, with what was found on it. Two serials can name
    // one emulator (emulator-5554 and 127.0.0.1:5555): one Id for both.
    // Manager / VmIndex: a MuMu instance read through MuMuManager.exe, not adb.
    private sealed record Device(string Serial, string AdbState, string Id, string Name, string Kind, string Status, LsEntry? Export,
        string? Manager = null, int VmIndex = 0);

    private sealed record Scan(Adb Adb, List<EmulatorInfo> Emulators, List<EmulatorInfo> Running, bool PhoneAdb, List<Device> Devices);

    // The export: from `sourceId` when given, else the newest. With
    // newerThan (unix seconds), an empty one (no Data) when the file
    // isn't newer than that — nothing is copied.
    public static async Task<ExportFile> ReadAsync(long? newerThan = null, string? sourceId = null)
    {
        if (sourceId == IPhoneSourceId)
        {
            var only = IPhoneBackups.NewestWithExport()
                ?? throw new ExportProblem("source_missing", "There's no iPhone backup with the game's export on this PC any more. Back up your iPhone again, or pick another place in the list.");
            return ReadBackup(only, newerThan);
        }
        if (sourceId != null) return await ReadFromAdbAsync(newerThan, sourceId);

        var backup = IPhoneBackups.NewestWithExport();
        ExportFile? fromAdb = null;
        ExportProblem? adbProblem = null;
        try { fromAdb = await ReadFromAdbAsync(newerThan, null); }
        catch (ExportProblem p) { adbProblem = p; }

        if (fromAdb != null && (backup == null || fromAdb.ModifiedUnix >= backup.ExportModified)) return fromAdb;
        if (backup != null) return ReadBackup(backup, newerThan);
        // No export anywhere: say what's wrong with the iPhone backups when
        // there are some and nothing else was found.
        if (adbProblem?.Code == "no_emulator")
        {
            var backups = IPhoneBackups.Find();
            if (backups.Count > 0) throw BackupProblem(backups);
        }
        throw adbProblem ?? new ExportProblem("failed", "TowerForge Link couldn't find your export.");
    }

    // Every emulator, phone and iPhone backup Link can see, with its export
    // or what's wrong — newest export first. Nothing is copied.
    public static async Task<List<ExportSource>> ListAsync()
    {
        var list = new List<ExportSource>();
        Scan? scan = null;
        try { scan = await ScanAsync(); }
        catch (ExportProblem) { /* no emulator or phone set up: only backups */ }
        if (scan != null)
        {
            foreach (var d in scan.Devices)
            {
                list.Add(new ExportSource(d.Id, d.Name, d.Kind, d.Status, d.Export?.Modified,
                    d.Status == "ready" ? null : DeviceMessage(d, scan.Emulators)));
            }
            // A running emulator that gave no device: its adb is off or not up yet.
            foreach (var e in scan.Running.Where(e => e.Name != "Android platform-tools"))
            {
                if (scan.Devices.Any(d => d.Kind == "emulator" && e.Ports.Contains(PortOf(d.Serial)))) continue;
                list.Add(new ExportSource($"{Slug(e.Name)}:{e.Ports.FirstOrDefault()}", e.Name, "emulator", "offline", null, OfflineMessage(e)));
            }
        }
        var backups = IPhoneBackups.Find();
        var withExport = IPhoneBackups.NewestWithExport();
        if (withExport != null)
            list.Add(new ExportSource(IPhoneSourceId, IPhoneBackups.Describe(withExport), "iphone", "ready", withExport.ExportModified, null));
        else if (backups.Count > 0)
            list.Add(new ExportSource(IPhoneSourceId, "your iPhone backup", "iphone", backups.All(b => b.Encrypted) ? "encrypted" : "no_export", null, BackupProblem(backups).Message));
        return [.. list.OrderByDescending(s => s.Modified ?? 0)];
    }

    private static ExportProblem BackupProblem(List<IPhoneBackup> backups) => backups.All(b => b.Encrypted)
        ? new ExportProblem("iphone_encrypted",
            "Your iPhone backup is encrypted, and TowerForge Link can't read encrypted backups yet. In the Apple "
            + "Devices app (or iTunes), untick \"Encrypt local backup\" and back up again — or use Import Game Data.")
        : new ExportProblem("iphone_no_export",
            "Your newest iPhone backup doesn't have the game's data export. In The Tower, export your data "
            + "(Settings → tap your player ID 5 times → External Tools Export), then back up your iPhone again and try again.");

    private static ExportFile ReadBackup(IPhoneBackup backup, long? newerThan)
    {
        var source = IPhoneBackups.Describe(backup);
        if (newerThan is long seen && backup.ExportModified <= seen) return new ExportFile([], backup.ExportModified, source, IPhoneSourceId);
        byte[] data;
        try { data = File.ReadAllBytes(backup.ExportPath!); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            throw new ExportProblem("copy_failed", "Found the export in your iPhone backup but couldn't read it. Wait for the backup to finish, then try again.");
        }
        if (!LooksLikeJson(data))
        {
            throw new ExportProblem("bad_file", "The export in your iPhone backup doesn't look right. Export your data again in the game, back up again, then try again.");
        }
        return new ExportFile(data, backup.ExportModified, source, IPhoneSourceId);
    }

    // Connects every running emulator and paired phone, then looks for the
    // file on each device adb lists.
    private static async Task<Scan> ScanAsync()
    {
        var emulators = Emulators.Find();
        var phoneAdb = Phones.Any() ? await PlatformTools.FindAsync() : null;
        if (emulators.Count == 0 && phoneAdb == null)
        {
            throw new ExportProblem("no_emulator",
                "No Android emulator found on this PC. TowerForge Link works with BlueStacks (and MuMu, LDPlayer, "
                + "MEmu or Nox), or an Android phone over Wi-Fi — pair it from \"Get from emulator or phone\" on towerforge.net.");
        }

        var running = emulators.Where(e => e.Running && e.Ports.Length > 0).ToList();
        var pick = running.FirstOrDefault()
            ?? emulators.FirstOrDefault(e => e.Name == "Android platform-tools")
            ?? emulators.FirstOrDefault();
        var adb = new Adb(phoneAdb?.Path ?? pick!.AdbPath);
        await adb.StartServerAsync();
        foreach (var e in running.Count > 0 ? running : emulators)
        {
            foreach (var port in e.Ports) await adb.RunAsync(Quick, "connect", $"127.0.0.1:{port}");
        }
        if (phoneAdb != null) await Phones.ConnectAsync(adb);

        var devices = new List<Device>();
        foreach (var (serial, state, model) in await ListDevicesAsync(adb))
        {
            var phone = Phones.IsPhoneSerial(serial) || PortOf(serial) == 0;
            var name = phone ? (model ?? "your phone") : SourceName(serial, emulators);
            var id = phone ? $"phone:{serial}" : $"{Slug(EmulatorOf(serial, emulators)?.Name ?? "emulator")}:{PortOf(serial)}";
            if (state != "device")
            {
                devices.Add(new Device(serial, state, id, name, phone ? "phone" : "emulator", state == "unauthorized" ? "unauthorized" : "offline", null));
                continue;
            }
            var listing = await adb.RunAsync(Quick, "-s", serial, "ls", Folder);
            var entries = ParseLs(listing.Out);
            var file = entries.FirstOrDefault(e => e.Name == FileName);
            string status;
            if (file != null) status = "ready";
            else if (entries.Count > 0) status = "no_export";
            else
            {
                // No listing at all: is the folder missing, or is adb blocked?
                var sdcard = await adb.RunAsync(Quick, "-s", serial, "ls", "/sdcard/");
                status = ParseLs(sdcard.Out).Count == 0 ? "blocked" : "no_game";
            }
            devices.Add(new Device(serial, state, id, name, phone ? "phone" : "emulator", status, file));
        }
        // MuMu instances adb couldn't reach: ask MuMu's own manager.
        foreach (var e in running.Where(e => e.MuMuManager != null && e.VmIndexes != null))
        {
            foreach (var (port, index) in e.VmIndexes!)
            {
                if (devices.Any(d => PortOf(d.Serial) == port && d.AdbState == "device")) continue;
                var stat = await MuMuShell.StatAsync(e.MuMuManager!, index);
                if (stat == null) continue;   // that instance isn't running, or MuMu can't reach it either
                var id = $"{Slug(e.Name)}:{port}";
                devices.RemoveAll(d => d.Id == id);
                var file = stat == MuMuShell.NoFile ? null : new LsEntry(FileName, stat.Value.Size, stat.Value.Modified);
                devices.Add(new Device($"127.0.0.1:{port}", "device", id, e.NameFor(port), "emulator",
                    file != null ? "ready" : "no_export", file, e.MuMuManager, index));
            }
        }

        // One entry per emulator: the serial with the export (newest), the
        // 127.0.0.1 one when they tie.
        devices = [.. devices
            .GroupBy(d => d.Id)
            .Select(g => g.OrderByDescending(d => d.Export?.Modified ?? -1).ThenByDescending(d => d.Serial.Contains(':')).First())];
        return new Scan(adb, emulators, running, phoneAdb != null, devices);
    }

    // Emulators and Android phones, through adb.
    private static async Task<ExportFile> ReadFromAdbAsync(long? newerThan, string? sourceId)
    {
        var scan = await ScanAsync();
        var devices = scan.Devices;
        if (devices.Count == 0)
        {
            if (scan.PhoneAdb && scan.Running.Count == 0)
            {
                throw new ExportProblem("phone_offline",
                    "Your phone isn't connected. On the phone, turn on Wireless debugging (Settings → Developer options), "
                    + "on the same Wi-Fi as this PC, then try again. No need to pair again.");
            }
            throw new ExportProblem("not_running", scan.Running.Count == 0
                ? "Your emulator isn't running. Start it (with The Tower installed), then try again."
                : OfflineMessage(scan.Running[0]));
        }
        if (devices.All(d => d.AdbState == "unauthorized"))
        {
            throw new ExportProblem("unauthorized",
                "Your phone is asking whether to allow USB debugging. Tap Allow on the phone, then try again.");
        }

        Device best;
        if (sourceId != null)
        {
            var chosen = devices.FirstOrDefault(d => d.Id == sourceId);
            var offline = scan.Running.FirstOrDefault(e => e.Ports.Any(p => $"{Slug(e.Name)}:{p}" == sourceId));
            if (chosen == null && offline != null) throw new ExportProblem("offline", OfflineMessage(offline));
            if (chosen == null)
            {
                throw new ExportProblem("source_missing",
                    "The emulator or phone you picked isn't answering. Start it (or connect the phone), then try again — or pick another place in the list.");
            }
            if (chosen.Export == null) throw new ExportProblem(chosen.Status, DeviceMessage(chosen, scan.Emulators));
            best = chosen;
        }
        else
        {
            var found = devices.Where(d => d.Export != null).ToList();
            if (found.Count == 0) throw Explain(devices, scan.Emulators);
            best = found.OrderByDescending(d => d.Export!.Modified).First();
        }

        if (newerThan is long seen && best.Export!.Modified <= seen)
            return new ExportFile([], best.Export.Modified, best.Name, best.Id);
        if (best.Manager != null)
        {
            var bytes = await MuMuShell.ReadAsync(best.Manager, best.VmIndex)
                ?? throw new ExportProblem("copy_failed", "Found your export in MuMu Player but couldn't copy it. Try again; if it keeps failing, restart MuMu.");
            if (!LooksLikeJson(bytes))
            {
                throw new ExportProblem("bad_file",
                    "The export file doesn't look right. Export your data again in the game, then try again.");
            }
            return new ExportFile(bytes, best.Export!.Modified, best.Name, best.Id);
        }
        var temp = Path.Combine(Path.GetTempPath(), "TowerForgeLink");
        Directory.CreateDirectory(temp);
        var local = Path.Combine(temp, $"{Guid.NewGuid():N}.json");
        try
        {
            var pull = await scan.Adb.RunAsync(Copy, "-s", best.Serial, "pull", Folder + FileName, local);
            if (!pull.Ok || !File.Exists(local))
            {
                throw new ExportProblem("copy_failed",
                    "Found your export but couldn't copy it. Try again; if it keeps failing, restart the emulator.");
            }
            var data = await File.ReadAllBytesAsync(local);
            if (!LooksLikeJson(data))
            {
                throw new ExportProblem("bad_file",
                    "The export file doesn't look right. Export your data again in the game, then try again.");
            }
            return new ExportFile(data, best.Export!.Modified, best.Name, best.Id);
        }
        finally
        {
            try { File.Delete(local); } catch { /* temp folder; best effort */ }
        }
    }

    // No export on any device: the most useful reason first.
    private static ExportProblem Explain(List<Device> devices, List<EmulatorInfo> emulators)
    {
        var d = devices.FirstOrDefault(x => x.Status == "no_export")
            ?? devices.FirstOrDefault(x => x.Status == "blocked")
            ?? devices.FirstOrDefault(x => x.Status == "no_game")
            ?? devices[0];
        return new ExportProblem(d.Status == "offline" ? "not_running" : d.Status, DeviceMessage(d, emulators));
    }

    // What's wrong on one device, in words for the player.
    private static string DeviceMessage(Device d, List<EmulatorInfo> emulators)
    {
        switch (d.Status)
        {
            case "no_export":
                return $"The Tower on {d.Name} has no data export yet. In the game: Settings → tap your player ID 5 times → External Tools Export, export, then try again.";
            case "no_game":
                return $"The Tower isn't installed on {d.Name}, or hasn't been opened yet.";
            case "unauthorized":
                return "Your phone is asking whether to allow USB debugging. Tap Allow on the phone, then try again.";
            case "blocked":
                var bs = emulators.FirstOrDefault(e => e.Name == "BlueStacks");
                if (bs != null && d.Name.StartsWith("BlueStacks", StringComparison.Ordinal))
                {
                    return bs.AdbEnabled == true
                        ? "BlueStacks has Android Debug Bridge turned on but hasn't applied it yet. Wait a minute, "
                          + "or close BlueStacks fully and open it again, then try again."
                        : "BlueStacks is blocking the connection. In BlueStacks open Settings → Advanced and turn on "
                          + "Android Debug Bridge (ADB), then close BlueStacks fully and open it again.";
                }
                return "The emulator refused the connection. Turn on ADB (sometimes called \"local connection\" or "
                    + "\"ADB debugging\") in its settings, restart it, then try again.";
            default:
                return $"{d.Name} isn't answering yet. Wait for it to finish starting, then try again.";
        }
    }

    // A running emulator adb couldn't reach at all.
    private static string OfflineMessage(EmulatorInfo e) => e.Name switch
    {
        "MuMu Player" => "MuMu Player is running but isn't letting TowerForge Link connect. In MuMu, open Settings → Developer options "
            + "and set ADB debug to Enable local connection, then close MuMu fully and open it again. If it just started, wait a minute and try again.",
        "BlueStacks" => e.AdbEnabled == false
            ? "BlueStacks is blocking the connection. In BlueStacks open Settings → Advanced and turn on "
              + "Android Debug Bridge (ADB), then close BlueStacks fully and open it again."
            : "BlueStacks is running but didn't answer. Wait for it to finish starting, then try again.",
        _ => $"{e.Name} is running but didn't answer. Wait for it to finish starting; if it still doesn't, turn on ADB in its settings and restart it.",
    };

    // Serial, state and (for phones) model from `adb devices -l`.
    private static async Task<List<(string Serial, string State, string? Model)>> ListDevicesAsync(Adb adb)
    {
        var r = await adb.RunAsync(Quick, "devices", "-l");
        var list = new List<(string, string, string?)>();
        foreach (var line in r.Out.Split('\n').Skip(1))
        {
            var parts = line.Trim().Split([' ', '\t'], StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 2) continue;
            var model = parts.FirstOrDefault(p => p.StartsWith("model:", StringComparison.Ordinal));
            list.Add((parts[0], parts[1], model?["model:".Length..].Replace('_', ' ')));
        }
        return list;
    }

    // `adb ls` prints "mode size mtime name", the numbers in hex.
    private static List<LsEntry> ParseLs(string output)
    {
        var entries = new List<LsEntry>();
        foreach (var line in output.Split('\n'))
        {
            var parts = line.Trim().Split(' ', 4, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 4) continue;
            if (!long.TryParse(parts[1], NumberStyles.HexNumber, null, out var size)) continue;
            if (!long.TryParse(parts[2], NumberStyles.HexNumber, null, out var mtime)) continue;
            entries.Add(new LsEntry(parts[3], size, mtime));   // includes "." and "..": the folder exists
        }
        return entries;
    }

    private static bool LooksLikeJson(byte[] data)
    {
        foreach (var b in data)
        {
            if (b is (byte)' ' or (byte)'\t' or (byte)'\r' or (byte)'\n' or 0xEF or 0xBB or 0xBF) continue;
            return b == (byte)'{';
        }
        return false;
    }

    // An emulator serial's adb port: emulator-N listens on N + 1; host:port.
    private static int PortOf(string serial)
    {
        if (serial.StartsWith("emulator-") && int.TryParse(serial["emulator-".Length..], out var console)) return console + 1;
        if (serial.StartsWith("127.0.0.1:") || serial.StartsWith("localhost:"))
            return int.TryParse(serial[(serial.LastIndexOf(':') + 1)..], out var p) ? p : 0;
        return 0;   // a phone (its Wi-Fi address or USB serial)
    }

    private static EmulatorInfo? EmulatorOf(string serial, List<EmulatorInfo> emulators)
    {
        var port = PortOf(serial);
        return emulators.FirstOrDefault(e => e.Running && e.Ports.Contains(port))
            ?? emulators.FirstOrDefault(e => e.Ports.Contains(port));
    }

    // Which emulator a serial belongs to, by its adb port.
    private static string SourceName(string serial, List<EmulatorInfo> emulators)
    {
        if (Phones.IsPhoneSerial(serial)) return "your phone";
        var port = PortOf(serial);
        var match = EmulatorOf(serial, emulators);
        if (match != null) return match.NameFor(port);
        return port > 0 ? $"your emulator (port {port})" : "your phone";
    }

    private static string Slug(string name) => new([.. name.ToLowerInvariant().Where(char.IsLetterOrDigit)]);
}
