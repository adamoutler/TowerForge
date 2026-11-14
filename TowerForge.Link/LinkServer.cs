// ============================================================
//  TowerForge Link — the link the website talks to
//  A tiny HTTP server on this PC only (127.0.0.1). towerforge.net,
//  open in a browser on the same PC, calls
//    GET  /status                 what the helper found (emulators, phones)
//    GET  /sources                every emulator, phone and iPhone backup
//                                 seen, with its export's time or what's
//                                 wrong (Link 0.4) — for players with more
//                                 than one, to pick where to import from
//    GET  /export                 the game's export file: the newest, or
//         ?source=<id>            the one from that source (/sources)
//         ?newerThan=<unix s>     only if it's newer: 204 (no body) when it
//                                 isn't — the site's auto import asks this
//                                 every 30 s
//  Android phones over Wi-Fi (Phones.cs), when the player asks on the site:
//    POST /phone/adb              download Google's adb (PlatformTools.cs)
//    POST /phone/pair?address=192.168.1.23:37415&code=123456
//    POST /phone/connect?address=192.168.1.23:41235
//    POST /phone/forget           forget the phones paired through Link
//  Safety:
//   • listens on the loopback address only — nothing outside this PC
//     can reach it;
//   • answers pages from towerforge.net (and the local dev servers)
//     only — the browser blocks every other site from reading it;
//   • checks the Host header, so a site that points its own name at
//     127.0.0.1 (DNS rebinding) gets nothing;
//   • reads that one file and nothing else (MuMu with its ADB port shut:
//     through MuMu's own MuMuManager.exe, two fixed commands on that
//     file — MuMuShell.cs); the phone actions only pair
//     or connect with an address on a home network (10.x, 172.16–31.x,
//     192.168.x) and a 6-digit code. No other adb command can be sent
//     through it.
//  Chrome and Edge ask once before a site may talk to apps on the PC;
//  the preflight answers Private Network Access's header too.
// ============================================================

using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace TowerForge.Link;

internal sealed class LinkServer(int port, Action<string> log)
{
    // When a towerforge.net page last asked anything (UTC ticks; 0: never).
    // Program waits a few seconds after starting: a page already asking
    // (the setup dialog checks every 4 s) means the site is open, so Link
    // doesn't open another tab.
    private long _lastSiteAsked;
    public bool SiteAsked => Interlocked.Read(ref _lastSiteAsked) != 0;

    private static readonly HashSet<string> AllowedOrigins = new(StringComparer.OrdinalIgnoreCase)
    {
        "https://towerforge.net", "https://www.towerforge.net",
        "http://localhost:5173", "http://localhost:4174", "http://127.0.0.1:5173", "http://127.0.0.1:4174",
    };

    private readonly SemaphoreSlim _oneAtATime = new(1, 1);

    public async Task RunAsync(TcpListener listener, CancellationToken stop)
    {
        while (!stop.IsCancellationRequested)
        {
            TcpClient client;
            try { client = await listener.AcceptTcpClientAsync(stop); }
            catch (OperationCanceledException) { break; }
            _ = Task.Run(() => HandleAsync(client), stop);
        }
    }

    private async Task HandleAsync(TcpClient client)
    {
        using (client)
        {
            try
            {
                var stream = client.GetStream();
                var request = await ReadRequestAsync(stream);
                if (request == null) return;
                await RespondAsync(stream, request);
            }
            catch (Exception ex) when (ex is IOException or SocketException or OperationCanceledException)
            {
                // The browser went away; nothing to answer.
            }
        }
    }

    private sealed record Request(string Method, string Path, string Query, Dictionary<string, string> Headers);

    private static async Task<Request?> ReadRequestAsync(NetworkStream stream)
    {
        var buffer = new byte[16 * 1024];
        var read = 0;
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        while (read < buffer.Length)
        {
            var n = await stream.ReadAsync(buffer.AsMemory(read), cts.Token);
            if (n == 0) return null;
            read += n;
            var text = Encoding.ASCII.GetString(buffer, 0, read);
            var end = text.IndexOf("\r\n\r\n", StringComparison.Ordinal);
            if (end < 0) continue;
            var lines = text[..end].Split("\r\n");
            var first = lines[0].Split(' ');
            if (first.Length < 2) return null;
            var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var line in lines.Skip(1))
            {
                var colon = line.IndexOf(':');
                if (colon > 0) headers[line[..colon].Trim()] = line[(colon + 1)..].Trim();
            }
            var target = first[1].Split('?', 2);
            return new Request(first[0].ToUpperInvariant(), target[0], target.Length > 1 ? target[1] : "", headers);
        }
        return null;
    }

    private async Task RespondAsync(NetworkStream stream, Request req)
    {
        req.Headers.TryGetValue("Host", out var host);
        if (host is null || !(host.Equals($"localhost:{port}", StringComparison.OrdinalIgnoreCase)
            || host.Equals($"127.0.0.1:{port}", StringComparison.OrdinalIgnoreCase)))
        {
            await WriteAsync(stream, 403, Error("forbidden", "Unexpected host."), null);
            return;
        }
        req.Headers.TryGetValue("Origin", out var origin);
        if (origin != null && !AllowedOrigins.Contains(origin))
        {
            log($"Refused a request from {origin} (only towerforge.net may use TowerForge Link).");
            await WriteAsync(stream, 403, Error("forbidden", "Only towerforge.net can use TowerForge Link."), null);
            return;
        }

        var cors = new Dictionary<string, string>();
        if (origin != null)
        {
            Interlocked.Exchange(ref _lastSiteAsked, DateTime.UtcNow.Ticks);
            cors["Access-Control-Allow-Origin"] = origin;
            cors["Vary"] = "Origin";
            cors["Access-Control-Expose-Headers"] = "X-Export-Modified, X-Export-Source, X-Export-Source-Id";
        }

        if (req.Method == "OPTIONS")
        {
            cors["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
            cors["Access-Control-Allow-Headers"] = req.Headers.TryGetValue("Access-Control-Request-Headers", out var h) ? h : "*";
            cors["Access-Control-Allow-Private-Network"] = "true";
            cors["Access-Control-Max-Age"] = "600";
            await WriteAsync(stream, 204, null, cors);
            return;
        }
        if (req.Method == "POST")
        {
            await PhoneAsync(stream, cors, req);
            return;
        }
        if (req.Method != "GET")
        {
            await WriteAsync(stream, 405, Error("method", "Use GET or POST."), cors);
            return;
        }

        switch (req.Path)
        {
            case "/":
                await WriteAsync(stream, 200, ("text/plain; charset=utf-8",
                    Encoding.UTF8.GetBytes("TowerForge Link is running. Use \"Get from emulator or phone\" on towerforge.net.")), cors);
                return;
            case "/status":
                await WriteAsync(stream, 200, await StatusAsync(), cors);
                return;
            case "/sources":
                await SourcesAsync(stream, cors);
                return;
            case "/export":
                var source = QueryValue(req.Query, "source");
                await ExportAsync(stream, cors, NewerThan(req.Query), source.Length > 0 ? source : null);
                return;
            default:
                await WriteAsync(stream, 404, Error("not_found", "Nothing here."), cors);
                return;
        }
    }

    private async Task<(string, byte[])> StatusAsync()
    {
        var emulators = Emulators.Find();
        var backups = IPhoneBackups.Find();
        var tools = await PlatformTools.FindAsync();
        var paired = Phones.Paired();
        // Phones adb has connected (only asked once one is paired: that
        // starts Google's adb server).
        var phones = new List<string>();
        if (tools != null && paired.Count > 0)
        {
            await _oneAtATime.WaitAsync();
            try
            {
                var adb = new Adb(tools.Path);
                await adb.StartServerAsync();
                await Phones.ConnectAsync(adb);
                var r = await adb.RunAsync(TimeSpan.FromSeconds(8), "devices", "-l");
                foreach (var line in r.Out.Split('\n').Skip(1))
                {
                    var parts = line.Split([' ', '\t'], StringSplitOptions.RemoveEmptyEntries);
                    if (parts.Length < 2 || parts[1] != "device" || !Phones.IsPhoneSerial(parts[0])) continue;
                    var model = parts.FirstOrDefault(p => p.StartsWith("model:", StringComparison.Ordinal));
                    phones.Add(model != null ? model["model:".Length..].Replace('_', ' ') : "Android phone");
                }
            }
            finally { _oneAtATime.Release(); }
        }
        return Json(w =>
        {
            w.WriteString("app", "TowerForge Link");
            w.WriteString("version", Program.Version);
            w.WriteStartArray("emulators");
            foreach (var e in emulators)
            {
                w.WriteStartObject();
                w.WriteString("name", e.Name);
                w.WriteBoolean("running", e.Running);
                if (e.AdbEnabled is bool on) w.WriteBoolean("adbEnabled", on);
                else w.WriteNull("adbEnabled");
                w.WriteEndObject();
            }
            w.WriteEndArray();
            w.WriteStartObject("phone");
            w.WriteBoolean("adbReady", tools != null);
            if (tools != null) w.WriteString("adbVersion", tools.Version.ToString());
            w.WriteNumber("paired", paired.Count);
            w.WriteStartArray("connected");
            foreach (var p in phones) w.WriteStringValue(p);
            w.WriteEndArray();
            w.WriteEndObject();
            // iPhone backups on this PC (IPhoneBackups.cs), newest first.
            w.WriteStartArray("iphoneBackups");
            foreach (var b in backups.Take(5))
            {
                w.WriteStartObject();
                if (b.LastBackup is DateTime d) w.WriteNumber("backedUp", new DateTimeOffset(d).ToUnixTimeSeconds());
                w.WriteBoolean("encrypted", b.Encrypted);
                w.WriteBoolean("hasExport", b.ExportPath != null);
                if (b.ExportPath != null) w.WriteNumber("exportModified", b.ExportModified);
                w.WriteEndObject();
            }
            w.WriteEndArray();
        });
    }

    // Query value by name ("" when absent).
    private static string QueryValue(string query, string name)
    {
        foreach (var part in query.Split('&'))
        {
            var kv = part.Split('=', 2);
            if (kv.Length == 2 && kv[0] == name) return Uri.UnescapeDataString(kv[1].Replace('+', ' '));
        }
        return "";
    }

    // The phone actions: one at a time, and never alongside an export read.
    private async Task PhoneAsync(NetworkStream stream, Dictionary<string, string> cors, Request req)
    {
        await _oneAtATime.WaitAsync();
        try
        {
            string message;
            switch (req.Path)
            {
                case "/phone/adb":
                    var got = await PlatformTools.DownloadAsync(log);
                    message = $"Google's adb {got.Version} is ready.";
                    break;
                case "/phone/pair":
                {
                    var address = Phones.CleanAddress(QueryValue(req.Query, "address"));
                    var code = QueryValue(req.Query, "code");
                    if (address == null) throw new ExportProblem("bad_address", BadAddress);
                    if (!Phones.IsCode(code)) throw new ExportProblem("bad_code", "The pairing code is the 6 digits under \"Wi-Fi pairing code\" on the phone.");
                    message = await Phones.PairAsync(await PhoneAdbAsync(), address, code, log);
                    break;
                }
                case "/phone/connect":
                {
                    var address = Phones.CleanAddress(QueryValue(req.Query, "address"));
                    if (address == null) throw new ExportProblem("bad_address", BadAddress);
                    message = await Phones.ConnectAddressAsync(await PhoneAdbAsync(), address, log);
                    break;
                }
                case "/phone/forget":
                    var tools = await PlatformTools.FindAsync();
                    await Phones.ForgetAsync(tools == null ? null : new Adb(tools.Path));
                    log("Forgot the phones paired through TowerForge Link.");
                    message = "Forgotten. To use a phone again, pair it again.";
                    break;
                default:
                    await WriteAsync(stream, 404, Error("not_found", "Nothing here."), cors);
                    return;
            }
            await WriteAsync(stream, 200, Json(w => { w.WriteBoolean("ok", true); w.WriteString("message", message); }), cors);
        }
        catch (ExportProblem p)
        {
            await WriteAsync(stream, 409, Error(p.Code, p.Message), cors);
        }
        catch (Exception ex)
        {
            log($"Something went wrong: {ex.Message}");
            await WriteAsync(stream, 500, Error("failed", "TowerForge Link hit an error: " + ex.Message), cors);
        }
        finally
        {
            _oneAtATime.Release();
        }
    }

    private const string BadAddress =
        "Type the address the phone shows, like 192.168.1.23:37415 (numbers, a colon, then the port).";

    private static async Task<Adb> PhoneAdbAsync()
    {
        var tools = await PlatformTools.FindAsync()
            ?? throw new ExportProblem("adb_missing", "Phones need Google's adb first: click \"Get Google's adb\".");
        return new Adb(tools.Path);
    }

    // newerThan=<unix seconds> from the query (null when absent or not a number).
    private static long? NewerThan(string query)
    {
        foreach (var part in query.Split('&'))
        {
            var kv = part.Split('=', 2);
            if (kv.Length == 2 && kv[0] == "newerThan" && long.TryParse(kv[1], out var t) && t > 0) return t;
        }
        return null;
    }

    // Where an export can come from: one adb scan, nothing copied.
    private async Task SourcesAsync(NetworkStream stream, Dictionary<string, string> cors)
    {
        await _oneAtATime.WaitAsync();
        try
        {
            var sources = await Exporter.ListAsync();
            await WriteAsync(stream, 200, Json(w =>
            {
                w.WriteStartArray("sources");
                foreach (var s in sources)
                {
                    w.WriteStartObject();
                    w.WriteString("id", s.Id);
                    w.WriteString("name", s.Name);
                    w.WriteString("kind", s.Kind);
                    w.WriteString("state", s.State);
                    if (s.Modified is long m) w.WriteNumber("modified", m);
                    if (s.Message != null) w.WriteString("message", s.Message);
                    w.WriteEndObject();
                }
                w.WriteEndArray();
            }), cors);
        }
        catch (Exception ex)
        {
            log($"Something went wrong: {ex.Message}");
            await WriteAsync(stream, 500, Error("failed", "TowerForge Link hit an error: " + ex.Message), cors);
        }
        finally
        {
            _oneAtATime.Release();
        }
    }

    private async Task ExportAsync(NetworkStream stream, Dictionary<string, string> cors, long? newerThan, string? sourceId)
    {
        await _oneAtATime.WaitAsync();
        try
        {
            // Auto import asks every 30 s: say nothing unless there's a new file.
            if (newerThan is null) log("Getting your export…");
            var file = await Exporter.ReadAsync(newerThan, sourceId);
            cors["X-Export-Modified"] = file.ModifiedUnix.ToString();
            cors["X-Export-Source"] = file.Source;
            cors["X-Export-Source-Id"] = file.SourceId;
            if (file.Data.Length == 0)
            {
                await WriteAsync(stream, 204, null, cors);
                return;
            }
            var age = DateTimeOffset.UtcNow - DateTimeOffset.FromUnixTimeSeconds(file.ModifiedUnix);
            log($"Sent your export from {file.Source} ({file.Data.Length / 1024:N0} KB, made {Ago(age)}).");
            await WriteAsync(stream, 200, ("application/json", file.Data), cors);
        }
        catch (ExportProblem p)
        {
            if (newerThan is null) log(p.Message);
            await WriteAsync(stream, 409, Error(p.Code, p.Message), cors);
        }
        catch (Exception ex)
        {
            log($"Something went wrong: {ex.Message}");
            await WriteAsync(stream, 500, Error("failed", "TowerForge Link hit an error: " + ex.Message), cors);
        }
        finally
        {
            _oneAtATime.Release();
        }
    }

    private static string Ago(TimeSpan t)
    {
        static string Unit(int n, string one) => n == 1 ? $"1 {one} ago" : $"{n} {one}s ago";
        return t.TotalMinutes < 1 ? "just now"
            : t.TotalHours < 1 ? Unit((int)t.TotalMinutes, "minute")
            : t.TotalDays < 1 ? Unit((int)t.TotalHours, "hour")
            : Unit((int)t.TotalDays, "day");
    }

    // JSON written by hand: the trimmed single-file build has no reflection serializer.
    private static (string, byte[]) Json(Action<Utf8JsonWriter> write)
    {
        using var ms = new MemoryStream();
        using (var w = new Utf8JsonWriter(ms))
        {
            w.WriteStartObject();
            write(w);
            w.WriteEndObject();
        }
        return ("application/json; charset=utf-8", ms.ToArray());
    }

    private static (string, byte[]) Error(string code, string message) => Json(w =>
    {
        w.WriteString("error", code);
        w.WriteString("message", message);
    });

    private static readonly Dictionary<int, string> Reasons = new()
    {
        [200] = "OK", [204] = "No Content", [403] = "Forbidden", [404] = "Not Found",
        [405] = "Method Not Allowed", [409] = "Conflict", [500] = "Internal Server Error",
    };

    private static async Task WriteAsync(NetworkStream stream, int status, (string Type, byte[] Body)? content, Dictionary<string, string>? headers)
    {
        var sb = new StringBuilder();
        sb.Append($"HTTP/1.1 {status} {Reasons.GetValueOrDefault(status, "OK")}\r\n");
        sb.Append("Connection: close\r\nCache-Control: no-store\r\n");
        if (headers != null) foreach (var (k, v) in headers) sb.Append($"{k}: {v}\r\n");
        var body = content?.Body ?? [];
        if (content != null) sb.Append($"Content-Type: {content.Value.Type}\r\n");
        sb.Append($"Content-Length: {body.Length}\r\n\r\n");
        await stream.WriteAsync(Encoding.ASCII.GetBytes(sb.ToString()));
        if (body.Length > 0) await stream.WriteAsync(body);
        await stream.FlushAsync();
    }
}
