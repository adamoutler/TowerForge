// ============================================================
//  TowerForge Link for Android — the link the website talks to
//  The same API as TowerForge Link for Windows
//  (TowerForge.Link/LinkServer.cs), on this phone only:
//    GET http://127.0.0.1:47821/status   what's set up (Shizuku, export)
//    GET http://127.0.0.1:47821/export   the game's export file
//        ?newerThan=<unix seconds>         204 when it isn't newer — the
//                                          site's Auto import asks this
//  Safety, as on Windows:
//   • listens on 127.0.0.1 only — nothing outside this phone reaches it;
//   • answers pages from towerforge.net (and the local dev servers) only;
//   • checks the Host header (no DNS rebinding);
//   • reads that one file, nothing else, and never changes it.
//  Chrome asks once before a site may talk to apps on the device; the
//  preflight answers Private Network Access's header too.
// ============================================================

package net.towerforge.link;

import android.content.Context;
import android.os.ParcelFileDescriptor;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class LinkServer {

    static final int PORT = 47821;

    private static final Set<String> ORIGINS = Set.of(
            "https://towerforge.net", "https://www.towerforge.net",
            "http://localhost:5173", "http://localhost:4174", "http://127.0.0.1:5173", "http://127.0.0.1:4174");

    private final Context context;
    private final ExecutorService pool = Executors.newFixedThreadPool(4);
    private final Object oneAtATime = new Object();
    private ServerSocket server;
    private volatile boolean running;

    LinkServer(Context context) {
        this.context = context.getApplicationContext();
    }

    void start() throws IOException {
        server = new ServerSocket();
        server.setReuseAddress(true);
        server.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), PORT));
        running = true;
        Thread accept = new Thread(this::acceptLoop, "towerforge-link");
        accept.setDaemon(true);
        accept.start();
    }

    void stop() {
        running = false;
        try {
            if (server != null) server.close();
        } catch (IOException ignored) {
            // already closed
        }
        pool.shutdownNow();
    }

    private void acceptLoop() {
        while (running) {
            try {
                Socket socket = server.accept();
                pool.execute(() -> handle(socket));
            } catch (IOException e) {
                if (!running) return;
            }
        }
    }

    // ── One request ─────────────────────────────────────────────
    private static final class Request {
        String method;
        String path;
        String query = "";
        final Map<String, String> headers = new HashMap<>();
    }

    private void handle(Socket socket) {
        try (Socket s = socket) {
            s.setSoTimeout(10_000);
            Request req = read(s.getInputStream());
            if (req != null) respond(s.getOutputStream(), req);
        } catch (IOException ignored) {
            // the browser went away
        }
    }

    private static Request read(InputStream in) throws IOException {
        byte[] buffer = new byte[16 * 1024];
        int read = 0;
        while (read < buffer.length) {
            int n = in.read(buffer, read, buffer.length - read);
            if (n < 0) return null;
            read += n;
            String text = new String(buffer, 0, read, StandardCharsets.ISO_8859_1);
            int end = text.indexOf("\r\n\r\n");
            if (end < 0) continue;
            String[] lines = text.substring(0, end).split("\r\n");
            String[] first = lines[0].split(" ");
            if (first.length < 2) return null;
            Request req = new Request();
            req.method = first[0].toUpperCase(Locale.ROOT);
            String target = first[1];
            int q = target.indexOf('?');
            req.path = q < 0 ? target : target.substring(0, q);
            if (q >= 0) req.query = target.substring(q + 1);
            for (int i = 1; i < lines.length; i++) {
                int colon = lines[i].indexOf(':');
                if (colon > 0) req.headers.put(lines[i].substring(0, colon).trim().toLowerCase(Locale.ROOT), lines[i].substring(colon + 1).trim());
            }
            return req;
        }
        return null;
    }

    private void respond(OutputStream out, Request req) throws IOException {
        String host = req.headers.get("host");
        if (host == null || !(host.equalsIgnoreCase("localhost:" + PORT) || host.equalsIgnoreCase("127.0.0.1:" + PORT))) {
            write(out, 403, error("forbidden", "Unexpected host."), null);
            return;
        }
        String origin = req.headers.get("origin");
        if (origin != null && !ORIGINS.contains(origin.toLowerCase(Locale.ROOT))) {
            write(out, 403, error("forbidden", "Only towerforge.net can use TowerForge Link."), null);
            return;
        }
        Map<String, String> cors = new LinkedHashMap<>();
        if (origin != null) {
            cors.put("Access-Control-Allow-Origin", origin);
            cors.put("Vary", "Origin");
            cors.put("Access-Control-Expose-Headers", "X-Export-Modified, X-Export-Source");
        }
        if (req.method.equals("OPTIONS")) {
            cors.put("Access-Control-Allow-Methods", "GET, OPTIONS");
            String asked = req.headers.get("access-control-request-headers");
            cors.put("Access-Control-Allow-Headers", asked != null ? asked : "*");
            cors.put("Access-Control-Allow-Private-Network", "true");
            cors.put("Access-Control-Max-Age", "600");
            write(out, 204, null, cors);
            return;
        }
        if (!req.method.equals("GET")) {
            write(out, 405, error("method", "Use GET."), cors);
            return;
        }
        switch (req.path) {
            case "/":
                write(out, 200, new Body("text/plain; charset=utf-8",
                        "TowerForge Link is running. Use \"Get from emulator or phone\" on towerforge.net.".getBytes(StandardCharsets.UTF_8)), cors);
                return;
            case "/status":
                write(out, 200, status(), cors);
                return;
            case "/export":
                export(out, cors, newerThan(req.query));
                return;
            default:
                write(out, 404, error("not_found", "Nothing here."), cors);
        }
    }

    // ── What's set up ───────────────────────────────────────────
    private Body status() {
        ShizukuReader.State st = ShizukuReader.state(context);
        JSONObject json = new JSONObject();
        try {
            json.put("app", "TowerForge Link");
            json.put("version", BuildConfig.VERSION_NAME);
            json.put("platform", "android");
            json.put("emulators", new JSONArray());
            JSONObject android = new JSONObject();
            android.put("shizuku", stateName(st));
            IExportReader reader = st == ShizukuReader.State.READY ? ShizukuReader.reader(context, 4000) : null;
            if (reader != null) {
                try {
                    int s = reader.state();
                    android.put("export", s == 0 ? "found" : s == 1 ? "no_game" : s == 2 ? "none" : "unreadable");
                    if (s == 0) android.put("exportModified", reader.modified());
                } catch (Exception e) {
                    android.put("export", "unknown");
                }
            }
            json.put("android", android);
        } catch (JSONException ignored) {
            // can't happen with these values
        }
        return new Body("application/json; charset=utf-8", json.toString().getBytes(StandardCharsets.UTF_8));
    }

    private static String stateName(ShizukuReader.State st) {
        switch (st) {
            case NOT_INSTALLED: return "not_installed";
            case NOT_RUNNING: return "not_running";
            case NO_PERMISSION: return "no_permission";
            default: return "ready";
        }
    }

    private static Long newerThan(String query) {
        for (String part : query.split("&")) {
            String[] kv = part.split("=", 2);
            if (kv.length == 2 && kv[0].equals("newerThan")) {
                try {
                    long t = Long.parseLong(kv[1]);
                    return t > 0 ? t : null;
                } catch (NumberFormatException e) {
                    return null;
                }
            }
        }
        return null;
    }

    // ── The export ──────────────────────────────────────────────
    private void export(OutputStream out, Map<String, String> cors, Long newerThan) throws IOException {
        synchronized (oneAtATime) {
            ShizukuReader.State st = ShizukuReader.state(context);
            if (st != ShizukuReader.State.READY) {
                write(out, 409, problem(st), cors);
                return;
            }
            IExportReader reader = ShizukuReader.reader(context, 8000);
            if (reader == null) {
                write(out, 409, error("shizuku_off",
                        "Shizuku didn't answer. Open Shizuku, make sure it says it's running, then try again."), cors);
                return;
            }
            try {
                int state = reader.state();
                if (state == 1) {
                    write(out, 409, error("no_game", "The Tower isn't installed on this phone, or hasn't been opened yet."), cors);
                    return;
                }
                if (state == 2) {
                    write(out, 409, error("no_export", "The Tower hasn't exported your data yet. In the game: Settings → "
                            + "tap your player ID 5 times → External Tools Export, and export — Auto keeps it up to date."), cors);
                    return;
                }
                long modified = reader.modified();
                cors.put("X-Export-Modified", Long.toString(modified));
                cors.put("X-Export-Source", "your phone");
                if (newerThan != null && modified <= newerThan) {
                    write(out, 204, null, cors);
                    return;
                }
                byte[] data;
                ParcelFileDescriptor pfd = reader.open();
                if (pfd == null) {
                    write(out, 409, error("copy_failed", "Found your export but couldn't read it. Try again."), cors);
                    return;
                }
                try (InputStream in = new ParcelFileDescriptor.AutoCloseInputStream(pfd)) {
                    data = readAll(in);
                }
                if (!looksLikeJson(data)) {
                    write(out, 409, error("bad_file", "The export file doesn't look right. Export your data again in the game, then try again."), cors);
                    return;
                }
                write(out, 200, new Body("application/json", data), cors);
            } catch (android.os.RemoteException | RuntimeException e) {
                write(out, 409, error("shizuku_off",
                        "Lost the connection to Shizuku (it stops when the phone restarts). Open Shizuku and tap Start, then try again."), cors);
            }
        }
    }

    private static Body problem(ShizukuReader.State st) {
        switch (st) {
            case NOT_INSTALLED:
                return error("shizuku_missing", "Shizuku isn't installed. Open TowerForge Link on this phone and follow its steps.");
            case NOT_RUNNING:
                return error("shizuku_off", "Shizuku isn't running — it stops when the phone restarts. Open Shizuku and tap Start, then try again.");
            default:
                return error("shizuku_permission", "TowerForge Link isn't allowed to use Shizuku yet. Open TowerForge Link and tap Allow.");
        }
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream(1 << 20);
        byte[] chunk = new byte[64 * 1024];
        int n;
        while ((n = in.read(chunk)) > 0) bytes.write(chunk, 0, n);
        return bytes.toByteArray();
    }

    private static boolean looksLikeJson(byte[] data) {
        for (byte b : data) {
            int c = b & 0xff;
            if (c == ' ' || c == '\t' || c == '\r' || c == '\n' || c == 0xEF || c == 0xBB || c == 0xBF) continue;
            return c == '{';
        }
        return false;
    }

    // ── Writing answers ─────────────────────────────────────────
    private static final class Body {
        final String type;
        final byte[] bytes;

        Body(String type, byte[] bytes) {
            this.type = type;
            this.bytes = bytes;
        }
    }

    private static Body error(String code, String message) {
        JSONObject json = new JSONObject();
        try {
            json.put("error", code);
            json.put("message", message);
        } catch (JSONException ignored) {
            // can't happen with these values
        }
        return new Body("application/json; charset=utf-8", json.toString().getBytes(StandardCharsets.UTF_8));
    }

    private static String reason(int status) {
        switch (status) {
            case 200: return "OK";
            case 204: return "No Content";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 405: return "Method Not Allowed";
            case 409: return "Conflict";
            default: return "OK";
        }
    }

    private static void write(OutputStream out, int status, Body body, Map<String, String> headers) throws IOException {
        StringBuilder sb = new StringBuilder();
        sb.append("HTTP/1.1 ").append(status).append(' ').append(reason(status)).append("\r\n");
        sb.append("Connection: close\r\nCache-Control: no-store\r\n");
        if (headers != null) for (Map.Entry<String, String> h : headers.entrySet()) sb.append(h.getKey()).append(": ").append(h.getValue()).append("\r\n");
        byte[] bytes = body != null ? body.bytes : new byte[0];
        if (body != null) sb.append("Content-Type: ").append(body.type).append("\r\n");
        sb.append("Content-Length: ").append(bytes.length).append("\r\n\r\n");
        out.write(sb.toString().getBytes(StandardCharsets.ISO_8859_1));
        if (bytes.length > 0) out.write(bytes);
        out.flush();
    }
}
