"""Hardened loopback HTTP server for TowerForge Link (`http_server.py`).

Binds `ThreadingHTTPServer` strictly to `127.0.0.1:47821` (refusing non-loopback
bind addresses unless `--allow-non-loopback-debug` is explicitly supplied) and
enforces:
- Linux `/proc/net/tcp` peer socket UID verification (`os.getuid()`)
- `Host` header allowlist (`localhost:47821`, `127.0.0.1:47821`, or dynamic bound port)
- Explicit `Origin` allowlist and Chromium Private Network Access (PNA) preflights
- Anti-CSRF header verification (`X-TowerForge-Link: 1` or `Content-Type: application/json`) on `POST`
"""

from __future__ import annotations

from collections.abc import Callable, Collection, Mapping
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from typing import Any

from . import __version__
from .adb_finder import AdbError, find_adb
from .adb_runner import TIMEOUT_STATUS, run_adb
from .exporter import handle_http_export
from .security import (
    DEFAULT_ALLOWED_ORIGINS,
    DEFAULT_BIND_HOST,
    DEFAULT_BIND_PORT,
    PROC_NET_TCP_PATH,
    ForbiddenOriginError,
    build_cors_headers,
    validate_bind_address,
    validate_host_header,
    validate_post_csrf,
    verify_linux_peer_uid,
)
from .sources import (
    build_status_payload,
    discover_sources,
    is_refresh_requested,
)
from .usb_owner import handle_http_usb_owner
from .wireless import handle_phone_post
from .ws import handle_websocket_upgrade

MAX_POST_BODY_BYTES: int = 64 * 1024


def _percent_decode(value: str) -> str:
    """Decode percent-encoded URL query components without external imports."""
    replaced = value.replace("+", " ")
    if "%" not in replaced:
        return replaced
    out = bytearray()
    i = 0
    length = len(replaced)
    while i < length:
        if replaced[i] == "%" and i + 2 < length:
            hex_part = replaced[i + 1 : i + 3]
            try:
                out.append(int(hex_part, 16))
                i += 3
                continue
            except ValueError:
                pass
        out.extend(replaced[i].encode("utf-8"))
        i += 1
    return out.decode("utf-8", errors="replace")


def parse_query_params(raw_query: str) -> dict[str, str]:
    """Parse a raw URL query string into a dictionary of key-value strings."""
    params: dict[str, str] = {}
    if not raw_query:
        return params
    for part in raw_query.split("&"):
        if not part:
            continue
        if "=" in part:
            k, v = part.split("=", 1)
            params[_percent_decode(k)] = _percent_decode(v)
        else:
            params[_percent_decode(part)] = ""
    return params


def split_path_and_query(raw_target: str) -> tuple[str, dict[str, str]]:
    """Split a request target (`/export?source=abc`) into `(path, query_dict)`."""
    if "?" in raw_target:
        path_part, query_part = raw_target.split("?", 1)
        return path_part or "/", parse_query_params(query_part)
    return raw_target or "/", {}


class TowerForgeHTTPServer(ThreadingHTTPServer):
    """Hardened `ThreadingHTTPServer` bound strictly to loopback by default."""

    allow_reuse_address = True
    daemon_threads = True

    def __init__(
        self,
        server_address: tuple[str, int] = (DEFAULT_BIND_HOST, DEFAULT_BIND_PORT),
        RequestHandlerClass: type[BaseHTTPRequestHandler] | None = None,
        *,
        adb_path: str | None = None,
        home_dir: str | Path | None = None,
        run_adb_fn: Callable[..., Any] | None = None,
        find_adb_fn: Callable[..., str] | None = None,
        allow_non_loopback_debug: bool = False,
        allowed_origins: Collection[str] = DEFAULT_ALLOWED_ORIGINS,
        enforce_peer_uid: bool = True,
        expected_uid: int | None = None,
        proc_net_tcp_path: str | Path = PROC_NET_TCP_PATH,
        proc_net_tcp_content: str | None = None,
        status_handler: Callable[[TowerForgeHTTPServer, dict[str, str]], tuple[int, dict[str, Any]]] | None = None,
        sources_handler: Callable[[TowerForgeHTTPServer, dict[str, str]], tuple[int, dict[str, Any]]] | None = None,
        export_handler: Callable[[TowerForgeHTTPServer, dict[str, str]], tuple[int, dict[str, str], bytes | dict[str, Any]]] | None = None,
        phone_handler: Callable[[TowerForgeHTTPServer, str, dict[str, str], dict[str, Any]], tuple[int, dict[str, Any]]] | None = None,
        usb_owner_handler: Callable[[TowerForgeHTTPServer, dict[str, str]], tuple[int, dict[str, Any]]] | None = None,
    ) -> None:
        bind_host, bind_port = server_address[0], int(server_address[1])
        validated_host = validate_bind_address(
            bind_host,
            allow_non_loopback_debug=allow_non_loopback_debug,
        )
        self.adb_path: str | None = adb_path
        self.home_dir: str | Path | None = home_dir
        self.run_adb_fn: Callable[..., Any] | None = run_adb_fn
        self.find_adb_fn: Callable[..., str] | None = find_adb_fn
        self.allow_non_loopback_debug: bool = allow_non_loopback_debug
        self.allowed_origins: frozenset[str] = frozenset(allowed_origins)
        self.enforce_peer_uid: bool = enforce_peer_uid
        self.expected_uid: int | None = expected_uid
        self.proc_net_tcp_path: str | Path = proc_net_tcp_path
        self.proc_net_tcp_content: str | None = proc_net_tcp_content
        self.status_handler = status_handler
        self.sources_handler = sources_handler
        self.export_handler = export_handler
        self.phone_handler = phone_handler
        self.usb_owner_handler = usb_owner_handler
        self._cached_adb_available: bool | None = None

        handler_cls = RequestHandlerClass or TowerForgeRequestHandler
        super().__init__((validated_host, bind_port), handler_cls)


class TowerForgeRequestHandler(BaseHTTPRequestHandler):
    """HTTP request handler enforcing Host, Origin, PNA, CSRF, and Linux peer-UID guards."""

    server: TowerForgeHTTPServer  # type: ignore[assignment]

    def log_message(self, format: str, *args: Any) -> None:
        """Suppress default stderr request logging."""
        return

    def _headers_as_dict(self) -> dict[str, str]:
        """Convert `self.headers` into a standard dictionary."""
        return {k: v for k, v in self.headers.items()}

    def _send_response_bytes(
        self,
        status_code: int,
        body: bytes,
        *,
        content_type: str | None = "application/json; charset=utf-8",
        extra_headers: Mapping[str, str] | None = None,
    ) -> None:
        """Write an HTTP response with `Cache-Control: no-store` and optional headers."""
        self.send_response(status_code)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        if extra_headers:
            for key, value in extra_headers.items():
                self.send_header(key, value)
        if content_type is not None:
            self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _send_json(
        self,
        status_code: int,
        payload: dict[str, Any],
        *,
        extra_headers: Mapping[str, str] | None = None,
    ) -> None:
        """Serialize `payload` as UTF-8 JSON and send the response."""
        encoded = json.dumps(payload).encode("utf-8")
        self._send_response_bytes(
            status_code,
            encoded,
            content_type="application/json; charset=utf-8",
            extra_headers=extra_headers,
        )

    def _check_security_gates(self, *, is_preflight: bool = False) -> dict[str, str] | None:
        """Enforce Peer-UID, `Host`, and `Origin` security controls.

        Returns the CORS/PNA response header dictionary if all checks succeed,
        or sends an HTTP `403 Forbidden` response (with no CORS headers) and returns `None`.
        """
        # 1. Linux Peer-UID Verification via /proc/net/tcp
        if getattr(self.server, "enforce_peer_uid", True):
            peer_ok = verify_linux_peer_uid(
                self.client_address,
                self.server.server_address,
                expected_uid=getattr(self.server, "expected_uid", None),
                proc_net_tcp_path=getattr(self.server, "proc_net_tcp_path", PROC_NET_TCP_PATH),
                proc_net_tcp_content=getattr(self.server, "proc_net_tcp_content", None),
            )
            if not peer_ok:
                self._send_json(
                    403,
                    {
                        "ok": False,
                        "error": "forbidden_peer_uid",
                        "message": "Client socket UID does not match server process UID.",
                    },
                )
                return None

        # 2. Host Header Guard (blocks DNS rebinding)
        host_header = self.headers.get("Host")
        if not validate_host_header(host_header, server_port=self.server.server_port):
            self._send_json(
                403,
                {
                    "ok": False,
                    "error": "forbidden_host",
                    "message": "Unexpected or missing Host header.",
                },
            )
            return None

        # 3. Origin Allowlist & PNA Preflight Headers
        origin_header = self.headers.get("Origin")
        if is_preflight and origin_header is None:
            self._send_json(
                403,
                {
                    "ok": False,
                    "error": "forbidden_origin",
                    "message": "CORS preflight requires an allowlisted Origin header.",
                },
            )
            return None

        try:
            cors_headers = build_cors_headers(
                origin_header,
                allowed_origins=self.server.allowed_origins,
                is_preflight=is_preflight,
                request_headers=self._headers_as_dict(),
            )
        except ForbiddenOriginError:
            self._send_json(
                403,
                {
                    "ok": False,
                    "error": "forbidden_origin",
                    "message": "Origin is not authorized to access TowerForge Link.",
                },
            )
            return None

        return cors_headers

    def _probe_adb_available(self) -> bool:
        """Return `True` if a valid system `adb` binary is discoverable."""
        cached = getattr(self.server, "_cached_adb_available", None)
        if isinstance(cached, bool):
            return cached
        try:
            find_adb(explicit_path=getattr(self.server, "adb_path", None))
            available = True
        except AdbError:
            available = False
        self.server._cached_adb_available = available
        return available

    def _build_default_status(self, query: Mapping[str, str] | None = None) -> dict[str, Any]:
        """Construct the default `/status` response payload via `sources.py`."""
        refresh = is_refresh_requested(query)
        return build_status_payload(
            adb_path=getattr(self.server, "adb_path", None),
            home_dir=getattr(self.server, "home_dir", None),
            refresh=refresh,
            run_adb_fn=getattr(self.server, "run_adb_fn", None),
            find_adb_fn=getattr(self.server, "find_adb_fn", None),
        )

    def _build_default_sources(self, query: Mapping[str, str] | None = None) -> dict[str, Any]:
        """Construct the default `/sources` response payload via `sources.py`."""
        refresh = is_refresh_requested(query)
        return discover_sources(
            adb_path=getattr(self.server, "adb_path", None),
            home_dir=getattr(self.server, "home_dir", None),
            refresh=refresh,
            run_adb_fn=getattr(self.server, "run_adb_fn", None),
            find_adb_fn=getattr(self.server, "find_adb_fn", None),
        )

    def do_OPTIONS(self) -> None:
        """Handle CORS and Chromium Private Network Access (PNA) preflight requests."""
        cors_headers = self._check_security_gates(is_preflight=True)
        if cors_headers is None:
            return
        self._send_response_bytes(
            204,
            b"",
            content_type=None,
            extra_headers=cors_headers,
        )

    def do_GET(self) -> None:
        """Handle `GET` requests (`/`, `/status`, `/sources`, `/export`, `/usb/owner`, `/ws`)."""
        cors_headers = self._check_security_gates(is_preflight=False)
        if cors_headers is None:
            return

        path, query = split_path_and_query(self.path)

        if path == "/":
            self._send_json(
                200,
                {
                    "app": "TowerForge Link",
                    "version": __version__,
                    "ok": True,
                    "message": "TowerForge Link is running.",
                },
                extra_headers=cors_headers,
            )
            return

        if path == "/status":
            if self.server.status_handler is not None:
                status_code, payload = self.server.status_handler(self.server, query)
                self._send_json(status_code, payload, extra_headers=cors_headers)
                return
            self._send_json(200, self._build_default_status(query), extra_headers=cors_headers)
            return

        if path == "/sources":
            if self.server.sources_handler is not None:
                status_code, payload = self.server.sources_handler(self.server, query)
                self._send_json(status_code, payload, extra_headers=cors_headers)
                return
            self._send_json(200, self._build_default_sources(query), extra_headers=cors_headers)
            return

        if path == "/export":
            handler = self.server.export_handler or handle_http_export
            status_code, extra, body = handler(self.server, query)
            merged_headers = dict(cors_headers)
            merged_headers.update(extra)
            if isinstance(body, bytes):
                self._send_response_bytes(
                    status_code,
                    body,
                    content_type="application/json; charset=utf-8" if body else None,
                    extra_headers=merged_headers,
                )
            else:
                self._send_json(status_code, body, extra_headers=merged_headers)
            return

        if path == "/usb/owner":
            if self.server.usb_owner_handler is not None:
                status_code, payload = self.server.usb_owner_handler(self.server, query)
                self._send_json(status_code, payload, extra_headers=cors_headers)
                return
            status_code, payload = handle_http_usb_owner(self.server, query)
            self._send_json(status_code, payload, extra_headers=cors_headers)
            return

        if path == "/ws":
            handle_websocket_upgrade(self, cors_headers=cors_headers)
            return

        self._send_json(
            404,
            {
                "ok": False,
                "error": "not_found",
                "message": f"Unknown route: {path}",
            },
            extra_headers=cors_headers,
        )

    def do_POST(self) -> None:
        """Handle `POST` requests with mandatory anti-CSRF verification."""
        cors_headers = self._check_security_gates(is_preflight=False)
        if cors_headers is None:
            return

        header_map = self._headers_as_dict()
        if not validate_post_csrf(header_map):
            self._send_json(
                403,
                {
                    "ok": False,
                    "error": "csrf_blocked",
                    "message": "POST request requires X-TowerForge-Link: 1 or Content-Type: application/json.",
                },
                extra_headers=cors_headers,
            )
            return

        content_length_raw = self.headers.get("Content-Length", "0")
        try:
            content_length = max(0, int(content_length_raw))
        except ValueError:
            content_length = 0

        if content_length > MAX_POST_BODY_BYTES:
            self._send_json(
                413,
                {
                    "ok": False,
                    "error": "payload_too_large",
                    "message": "POST request body exceeds maximum size.",
                },
                extra_headers=cors_headers,
            )
            return

        raw_body = self.rfile.read(content_length) if content_length > 0 else b""
        body_json: dict[str, Any] = {}
        if raw_body:
            try:
                parsed = json.loads(raw_body.decode("utf-8"))
                if isinstance(parsed, dict):
                    body_json = parsed
            except (UnicodeDecodeError, json.JSONDecodeError):
                self._send_json(
                    400,
                    {
                        "ok": False,
                        "error": "invalid_json",
                        "message": "Invalid JSON in POST request body.",
                    },
                    extra_headers=cors_headers,
                )
                return

        path, query = split_path_and_query(self.path)

        if self.server.phone_handler is not None and path.startswith("/phone/"):
            status_code, payload = self.server.phone_handler(self.server, path, query, body_json)
            self._send_json(status_code, payload, extra_headers=cors_headers)
            return

        if path in {
            "/phone/adb",
            "/phone/enable-wireless",
            "/phone/pair",
            "/phone/connect",
            "/phone/forget",
            "/phone/disconnect",
        }:
            status_code, payload = handle_phone_post(self.server, path, query, body_json)
            self._send_json(status_code, payload, extra_headers=cors_headers)
            return

        if path == "/status":
            self._send_json(
                200,
                {
                    "ok": True,
                    "message": "Request accepted.",
                },
                extra_headers=cors_headers,
            )
            return

        self._send_json(
            404,
            {
                "ok": False,
                "error": "not_found",
                "message": f"Unknown POST route: {path}",
            },
            extra_headers=cors_headers,
        )


def create_server(
    bind: str = DEFAULT_BIND_HOST,
    port: int = DEFAULT_BIND_PORT,
    *,
    adb_path: str | None = None,
    home_dir: str | Path | None = None,
    run_adb_fn: Callable[..., Any] | None = None,
    find_adb_fn: Callable[..., str] | None = None,
    allow_non_loopback_debug: bool = False,
    allowed_origins: Collection[str] = DEFAULT_ALLOWED_ORIGINS,
    enforce_peer_uid: bool = True,
    expected_uid: int | None = None,
    proc_net_tcp_path: str | Path = PROC_NET_TCP_PATH,
    proc_net_tcp_content: str | None = None,
    status_handler: Callable[[TowerForgeHTTPServer, dict[str, str]], tuple[int, dict[str, Any]]] | None = None,
    sources_handler: Callable[[TowerForgeHTTPServer, dict[str, str]], tuple[int, dict[str, Any]]] | None = None,
    export_handler: Callable[[TowerForgeHTTPServer, dict[str, str]], tuple[int, dict[str, str], bytes | dict[str, Any]]] | None = None,
    phone_handler: Callable[[TowerForgeHTTPServer, str, dict[str, str], dict[str, Any]], tuple[int, dict[str, Any]]] | None = None,
    usb_owner_handler: Callable[[TowerForgeHTTPServer, dict[str, str]], tuple[int, dict[str, Any]]] | None = None,
) -> TowerForgeHTTPServer:
    """Create and bind a `TowerForgeHTTPServer` instance."""
    return TowerForgeHTTPServer(
        (bind, port),
        TowerForgeRequestHandler,
        adb_path=adb_path,
        home_dir=home_dir,
        run_adb_fn=run_adb_fn,
        find_adb_fn=find_adb_fn,
        allow_non_loopback_debug=allow_non_loopback_debug,
        allowed_origins=allowed_origins,
        enforce_peer_uid=enforce_peer_uid,
        expected_uid=expected_uid,
        proc_net_tcp_path=proc_net_tcp_path,
        proc_net_tcp_content=proc_net_tcp_content,
        status_handler=status_handler,
        sources_handler=sources_handler,
        export_handler=export_handler,
        phone_handler=phone_handler,
        usb_owner_handler=usb_owner_handler,
    )


def format_startup_banner(
    bind: str = DEFAULT_BIND_HOST,
    port: int = DEFAULT_BIND_PORT,
    *,
    adb_path: str | None = None,
    find_adb_fn: Callable[..., str] | None = None,
    run_adb_fn: Callable[..., Any] | None = None,
) -> str:
    """Format the flushed CLI startup banner displaying ADB status and listening URLs."""
    locator = find_adb if find_adb_fn is None else find_adb_fn
    runner = run_adb if run_adb_fn is None else run_adb_fn
    lines: list[str] = []
    try:
        resolved_adb = locator(explicit_path=adb_path)
        version_res = runner(resolved_adb, ["version"], timeout=TIMEOUT_STATUS)
        devices_res = runner(resolved_adb, ["devices", "-l"], timeout=TIMEOUT_STATUS)
        lines.append(f"ADB binary: {resolved_adb}")
        if version_res.stdout.strip():
            lines.append(version_res.stdout.strip())
        if devices_res.stdout.strip():
            lines.append(devices_res.stdout.strip())
    except AdbError as exc:
        lines.append(f"ADB binary: unavailable ({exc})")

    display_host = "127.0.0.1" if bind in {"0.0.0.0", "::"} else bind
    lines.append(
        f"TowerForge Link {__version__} listening on http://{display_host}:{port} "
        f"(WebSocket: ws://{display_host}:{port}/ws)"
    )
    lines.append(
        'Ready! Click "Get from emulator or phone" or "Import via Python Companion" '
        "in TowerForge (Ctrl+C to stop)."
    )
    return "\n".join(lines)


def serve_forever(
    bind: str = DEFAULT_BIND_HOST,
    port: int = DEFAULT_BIND_PORT,
    *,
    adb_path: str | None = None,
    allow_non_loopback_debug: bool = False,
) -> int:
    """Start the hardened loopback HTTP server, print the startup banner, and run until interrupted."""
    server = create_server(
        bind=bind,
        port=port,
        adb_path=adb_path,
        allow_non_loopback_debug=allow_non_loopback_debug,
    )
    actual_port = int(getattr(server, "server_port", port) or port)
    print(
        format_startup_banner(
            bind=bind,
            port=actual_port,
            adb_path=adb_path,
        ),
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0
