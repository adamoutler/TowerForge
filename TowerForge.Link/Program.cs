// ============================================================
//  TowerForge Link — entry point
//  Starts the local link on 127.0.0.1:47821 and keeps a small
//  console window open with what it's doing. Close the window to
//  stop it. How it works: docs/towerforge-link.md.
//  --port N listens on another port (for testing beside a running copy;
//  the site only talks to 47821). --backups <folder> reads iPhone
//  backups from that folder instead (testing with a made-up backup).
//
//  0.5: when it starts and no towerforge.net page asks for it within a
//  few seconds, it opens towerforge.net/?link=import, and the site
//  imports right away — starting Link is the whole job (owner,
//  2026-11-13: 43% of players who downloaded Link got an import through
//  it). Started again while running, it opens the site instead of only
//  saying so. --no-browser turns that off; --site <url> opens another
//  address (testing).
// ============================================================

using System.Diagnostics;
using System.Net;
using System.Net.Sockets;

namespace TowerForge.Link;

internal static class Program
{
    public const int Port = 47821;
    private const string ImportUrl = "https://towerforge.net/?link=import";
    // The setup dialog asks every 4 s; Auto import every 30 s.
    private static readonly TimeSpan WaitForPage = TimeSpan.FromSeconds(6);
    public static readonly string Version =
        typeof(Program).Assembly.GetName().Version?.ToString(3) ?? "0.1.0";

    private static async Task<int> Main(string[] args)
    {
        var port = Port;
        var at = Array.IndexOf(args, "--port");
        if (at >= 0 && at + 1 < args.Length && int.TryParse(args[at + 1], out var p) && p is > 1024 and < 65536) port = p;
        var bk = Array.IndexOf(args, "--backups");
        if (bk >= 0 && bk + 1 < args.Length) IPhoneBackups.Override = args[bk + 1];
        var noBrowser = args.Contains("--no-browser");
        var st = Array.IndexOf(args, "--site");
        var site = st >= 0 && st + 1 < args.Length ? args[st + 1] : ImportUrl;

        Console.Title = "TowerForge Link";
        Console.OutputEncoding = System.Text.Encoding.UTF8;
        Console.WriteLine($"TowerForge Link {Version}");
        Console.WriteLine("Gets The Tower's data export off your emulator, Android phone or iPhone backup for towerforge.net.");
        Console.WriteLine();

        var listener = new TcpListener(IPAddress.Loopback, port);
        try
        {
            listener.Start();
        }
        catch (SocketException)
        {
            Console.WriteLine($"TowerForge Link is already running (or something else uses port {port}).");
            if (!noBrowser && OpenSite(site))
            {
                // The running copy answers the site; this window has nothing to do.
                Console.WriteLine("Opening towerforge.net to bring in your data. This window closes by itself.");
                await Task.Delay(TimeSpan.FromSeconds(4));
                return 1;
            }
            Console.WriteLine("Press any key to close this window.");
            Console.ReadKey(true);
            return 1;
        }

        var emulators = Emulators.Find();
        var phones = Phones.Paired();
        var iphones = IPhoneBackups.Find();
        if (emulators.Count == 0 && phones.Count == 0 && iphones.Count == 0)
        {
            Console.WriteLine("No Android emulator found yet. Supported: BlueStacks, MuMu, LDPlayer, MEmu, Nox,");
            Console.WriteLine("an Android phone over Wi-Fi, or an iPhone backed up to this PC: see \"Get from emulator or phone\" on towerforge.net.");
            Console.WriteLine("Using one? Open it, then click \"Get from emulator or phone\" — Link looks again every time, wherever it's installed.");
        }
        foreach (var b in iphones.Take(3))
        {
            var what = b.Encrypted ? "encrypted — Link can't read it yet"
                : b.ExportPath != null ? "has your export" : "no export in it yet";
            Console.WriteLine($"Found {IPhoneBackups.Describe(b)} ({what})");
        }
        if (phones.Count > 0)
        {
            Console.WriteLine($"Android phone{(phones.Count == 1 ? "" : "s")} paired: {phones.Count}. Turn on Wireless debugging on the phone to use it.");
        }
        foreach (var e in emulators)
        {
            var adb = e.AdbEnabled switch
            {
                true => " — Android Debug Bridge on",
                false => " — Android Debug Bridge OFF: turn it on in Settings → Advanced, then restart BlueStacks",
                null => "",
            };
            // Where it is, so a screenshot of this window says which install Link uses.
            var folder = Path.GetDirectoryName(e.AdbPath);
            Console.WriteLine($"Found {e.Name}{(e.Running ? " (running)" : "")}{adb} — {folder}");
        }
        Console.WriteLine();
        Console.WriteLine("Ready. Export your data in the game (Settings > External Tools Export, or Auto),");
        Console.WriteLine("and towerforge.net brings it in: \"Get from emulator or phone\", or Auto import on the site.");
        Console.WriteLine("Leave this window open while you use it (you can minimize it). Close it to stop.");
        Console.WriteLine();

        using var stop = new CancellationTokenSource();
        Console.CancelKeyPress += (_, ev) => { ev.Cancel = true; stop.Cancel(); };
        var server = new LinkServer(port, msg => Console.WriteLine($"{DateTime.Now:HH:mm:ss}  {msg}"));
        var running = server.RunAsync(listener, stop.Token);

        // No towerforge.net page asking yet: open one, which imports right away.
        if (!noBrowser)
        {
            await Task.Delay(WaitForPage);
            if (server.SiteAsked) Console.WriteLine($"{DateTime.Now:HH:mm:ss}  towerforge.net is open and asking — bringing your data in there.");
            else if (OpenSite(site)) Console.WriteLine($"{DateTime.Now:HH:mm:ss}  Opened towerforge.net to bring in your data.");
        }

        await running;
        listener.Stop();
        return 0;
    }

    // The default browser, at the site; false when there's none to open.
    private static bool OpenSite(string url)
    {
        try
        {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            return true;
        }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException or PlatformNotSupportedException)
        {
            Console.WriteLine($"Couldn't open a browser ({ex.Message}). Open towerforge.net yourself.");
            return false;
        }
    }
}
