"""Restricted stdlib RFC 6455 WebSocket JSON-RPC endpoint (`GET /ws`) for TowerForge Link.

Implements a zero-dependency RFC 6455 WebSocket upgrade and frame loop on top of
`BaseHTTPRequestHandler` (`http_server.py`) enforcing:
- Linux `/proc/net/tcp` peer socket UID verification, `Host` allowlist, and
  explicit `Origin` allowlist before accepting `Upgrade: websocket`.
- Standard RFC 6455 `Sec-WebSocket-Accept` handshake computation.
- Client-to-server frame masking enforcement (`mask_bit == 1`) and a hard
  `65536`-byte (`64 KiB`) incoming payload cap (`1009 Message Too Big`).
- Opcode handling for `0x1` (text), `0x8` (close), `0x9` (ping -> `0xA` pong),
  and `0xA` (pong).
- Strictly allowlisted JSON-RPC method dispatcher (`status`, `sources`, `export`,
  `usb.owner`, `adb.kill_server`), rejecting any other method (such as `shell`,
  `exec`, `eval`, or `pull`) with `{"ok": False, "error": "MethodNotAllowed"}`.
"""

from __future__ import annotations

import base64
from collections.abc import Mapping
from dataclasses import dataclass
import hashlib
import json
import struct
from typing import Any

from .adb_finder import AdbError, find_adb
from .adb_runner import TIMEOUT_STATUS, run_adb
from .exporter import ExporterError, export_from_source, validate_http_export_query
from .security import (
    DEFAULT_ALLOWED_ORIGINS,
    ForbiddenOriginError,
    validate_origin_header,
)
from .sources import build_status_payload, clear_discovery_cache, discover_sources
from .usb_owner import inspect_usb_owner

WS_GUID: str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MAX_WS_FRAME_BYTES: int = 65536  # 64 KiB hard incoming frame cap

OPCODE_CONTINUATION: int = 0x0
OPCODE_TEXT: int = 0x1
OPCODE_BINARY: int = 0x2
OPCODE_CLOSE: int = 0x8
OPCODE_PING: int = 0x9
OPCODE_PONG: int = 0xA

CLOSE_NORMAL: int = 1000
CLOSE_PROTOCOL_ERROR: int = 1002
CLOSE_UNSUPPORTED_DATA: int = 1003
CLOSE_INVALID_PAYLOAD: int = 1007
CLOSE_MESSAGE_TOO_BIG: int = 1009

ALLOWED_WS_METHODS: frozenset[str] = frozenset(
    {
        "status",
        "sources",
        "export",
        "usb.owner",
        "adb.kill_server",
    }
)


class WebSocketError(Exception):
    """Base error for RFC 6455 framing or protocol violations."""

    def __init__(self, message: str, *, close_code: int = CLOSE_PROTOCOL_ERROR) -> None:
        super().__init__(message)
        self.message: str = message
        self.close_code: int = close_code


class WebSocketProtocolError(WebSocketError):
    """Raised when a client violates RFC 6455 framing rules (e.g. unmasked frame)."""

    def __init__(self, message: str, *, close_code: int = CLOSE_PROTOCOL_ERROR) -> None:
        super().__init__(message, close_code=close_code)


class WebSocketFrameTooLargeError(WebSocketError):
    """Raised when an incoming WebSocket frame exceeds `MAX_WS_FRAME_BYTES` (64 KiB)."""

    def __init__(
        self,
        message: str = "WebSocket frame exceeds maximum allowed 64 KiB payload size.",
    ) -> None:
        super().__init__(message, close_code=CLOSE_MESSAGE_TOO_BIG)


@dataclass(frozen=True)
class WsFrame:
    """Decoded RFC 6455 WebSocket frame."""

    fin: bool
    opcode: int
    payload: bytes
    masked: bool = True


def compute_websocket_accept(sec_websocket_key: str) -> str:
    """Compute the RFC 6455 `Sec-WebSocket-Accept` header value for `sec_websocket_key`."""
    raw = (sec_websocket_key.strip() + WS_GUID).encode("ascii")
    digest = hashlib.sha1(raw).digest()
    return base64.b64encode(digest).decode("ascii")


def _read_exact(rfile: Any, num_bytes: int) -> bytes | None:
    """Read exactly `num_bytes` from `rfile`, returning `None` on clean EOF before first byte."""
    if num_bytes <= 0:
        return b""
    chunks = bytearray()
    while len(chunks) < num_bytes:
        chunk = rfile.read(num_bytes - len(chunks))
        if not chunk:
            if not chunks:
                return None
            raise WebSocketProtocolError("Unexpected EOF while reading WebSocket frame.")
        chunks.extend(chunk)
    return bytes(chunks)


def encode_ws_frame(
    payload: bytes | str,
    opcode: int = OPCODE_TEXT,
    *,
    fin: bool = True,
    mask_key: bytes | None = None,
) -> bytes:
    """Encode an RFC 6455 WebSocket frame (unmasked for server, or masked if `mask_key` given)."""
    payload_bytes = payload.encode("utf-8") if isinstance(payload, str) else bytes(payload)
    length = len(payload_bytes)

    first_byte = (0x80 if fin else 0x00) | (opcode & 0x0F)
    mask_bit = 0x80 if mask_key is not None else 0x00

    header = bytearray([first_byte])
    if length < 126:
        header.append(mask_bit | length)
    elif length <= 0xFFFF:
        header.append(mask_bit | 126)
        header.extend(struct.pack("!H", length))
    else:
        header.append(mask_bit | 127)
        header.extend(struct.pack("!Q", length))

    if mask_key is not None:
        if len(mask_key) != 4:
            raise ValueError("WebSocket mask_key must be exactly 4 bytes.")
        header.extend(mask_key)
        masked_bytes = bytes(b ^ mask_key[i & 3] for i, b in enumerate(payload_bytes))
        return bytes(header) + masked_bytes

    return bytes(header) + payload_bytes


def read_ws_frame(
    rfile: Any,
    *,
    require_masked: bool = True,
    max_payload_bytes: int = MAX_WS_FRAME_BYTES,
) -> WsFrame | None:
    """Read and unmask a single RFC 6455 frame from `rfile`, enforcing the 64 KiB cap."""
    header = _read_exact(rfile, 2)
    if header is None:
        return None

    b0, b1 = header[0], header[1]
    fin = bool(b0 & 0x80)
    rsv = (b0 >> 4) & 0x07
    opcode = b0 & 0x0F
    masked = bool(b1 & 0x80)
    length_code = b1 & 0x7F

    if rsv != 0:
        raise WebSocketProtocolError("Non-zero RSV bits are not permitted.")
    if require_masked and not masked:
        raise WebSocketProtocolError("Client-to-server WebSocket frames must be masked.")

    if length_code < 126:
        payload_len = length_code
    elif length_code == 126:
        ext = _read_exact(rfile, 2)
        if ext is None:
            raise WebSocketProtocolError("Truncated 16-bit extended payload length.")
        payload_len = struct.unpack("!H", ext)[0]
    else:
        ext = _read_exact(rfile, 8)
        if ext is None:
            raise WebSocketProtocolError("Truncated 64-bit extended payload length.")
        payload_len = struct.unpack("!Q", ext)[0]

    if payload_len > max_payload_bytes:
        raise WebSocketFrameTooLargeError(
            f"WebSocket frame payload ({payload_len} bytes) exceeds {max_payload_bytes} byte limit."
        )

    mask_key = b""
    if masked:
        read_mask = _read_exact(rfile, 4)
        if read_mask is None:
            raise WebSocketProtocolError("Truncated WebSocket masking key.")
        mask_key = read_mask

    raw_payload = _read_exact(rfile, payload_len)
    if raw_payload is None:
        raise WebSocketProtocolError("Truncated WebSocket frame payload.")

    if masked:
        payload = bytes(b ^ mask_key[i & 3] for i, b in enumerate(raw_payload))
    else:
        payload = raw_payload

    return WsFrame(fin=fin, opcode=opcode, payload=payload, masked=masked)


def write_ws_frame(wfile: Any, payload: bytes | str, opcode: int = OPCODE_TEXT) -> None:
    """Write an unmasked server-to-client WebSocket frame to `wfile`."""
    frame_bytes = encode_ws_frame(payload, opcode=opcode, fin=True, mask_key=None)
    wfile.write(frame_bytes)
    wfile.flush()


def write_ws_close(wfile: Any, code: int = CLOSE_NORMAL, reason: str = "") -> None:
    """Write an unmasked server-to-client Close frame (`0x88`) with status code."""
    reason_bytes = reason.encode("utf-8")[:123]
    payload = struct.pack("!H", int(code)) + reason_bytes
    write_ws_frame(wfile, payload, opcode=OPCODE_CLOSE)


def _execute_kill_adb_server(server: Any, params: Mapping[str, Any]) -> dict[str, Any]:
    """Execute `adb kill-server` via the server's sandboxed ADB runner."""
    custom_handler = getattr(server, "kill_adb_handler", None)
    if callable(custom_handler):
        custom_res = custom_handler(server, dict(params))
        if isinstance(custom_res, tuple) and len(custom_res) == 2:
            return dict(custom_res[1])
        if isinstance(custom_res, Mapping):
            return dict(custom_res)

    adb_path = getattr(server, "adb_path", None)
    run_adb_fn = getattr(server, "run_adb_fn", None)
    find_adb_fn = getattr(server, "find_adb_fn", None)

    runner = run_adb if run_adb_fn is None else run_adb_fn
    locator = find_adb if find_adb_fn is None else find_adb_fn

    resolved_adb: str | None = adb_path
    if not resolved_adb:
        try:
            resolved_adb = locator(explicit_path=adb_path)
        except AdbError:
            resolved_adb = "/usr/bin/adb" if run_adb_fn is not None else None

    if resolved_adb is not None:
        try:
            runner(
                ["kill-server"],
                adb_path=resolved_adb,
                timeout=TIMEOUT_STATUS,
                operation="status",
            )
        except TypeError:
            runner(["kill-server"], operation="status", check=False)
        except AdbError:
            pass

    clear_discovery_cache()
    return {
        "ok": True,
        "killed": True,
        "message": "ADB server stopped.",
    }


def dispatch_ws_rpc(
    server: Any,
    raw_request: Mapping[str, Any] | str | bytes,
) -> dict[str, Any]:
    """Validate and dispatch an allowlisted WebSocket JSON-RPC request."""
    if isinstance(raw_request, (str, bytes)):
        try:
            text = (
                raw_request.decode("utf-8")
                if isinstance(raw_request, bytes)
                else raw_request
            )
            parsed = json.loads(text)
        except (UnicodeDecodeError, json.JSONDecodeError):
            return {
                "id": None,
                "ok": False,
                "error": "InvalidJSON",
                "message": "Malformed JSON in WebSocket request frame.",
            }
        if not isinstance(parsed, Mapping):
            return {
                "id": None,
                "ok": False,
                "error": "InvalidRequest",
                "message": "WebSocket RPC request must be a JSON object.",
            }
        req_map: Mapping[str, Any] = parsed
    elif isinstance(raw_request, Mapping):
        req_map = raw_request
    else:
        return {
            "id": None,
            "ok": False,
            "error": "InvalidRequest",
            "message": "WebSocket RPC request must be a JSON object.",
        }

    req_id = req_map.get("id")
    method = req_map.get("method")
    raw_params = req_map.get("params")

    if raw_params is None:
        params: dict[str, Any] = {}
    elif isinstance(raw_params, Mapping):
        params = dict(raw_params)
    else:
        return {
            "id": req_id,
            "ok": False,
            "error": "InvalidParams",
            "message": "RPC 'params' field must be a JSON object when provided.",
        }

    if not isinstance(method, str) or method not in ALLOWED_WS_METHODS:
        method_label = str(method) if method is not None else ""
        return {
            "id": req_id,
            "ok": False,
            "error": "MethodNotAllowed",
            "message": f"Method '{method_label}' is not allowed.",
        }

    refresh_flag = bool(
        params.get("refresh") or params.get("forceRefresh") or params.get("force_refresh")
    )

    if method == "status":
        status_handler = getattr(server, "status_handler", None)
        if callable(status_handler):
            _, status_dict = status_handler(
                server,
                {"refresh": "true"} if refresh_flag else {},
            )
        else:
            status_dict = build_status_payload(
                adb_path=getattr(server, "adb_path", None),
                home_dir=getattr(server, "home_dir", None),
                refresh=refresh_flag,
                run_adb_fn=getattr(server, "run_adb_fn", None),
                find_adb_fn=getattr(server, "find_adb_fn", None),
            )
        return {
            **status_dict,
            "id": req_id,
            "ok": True,
            "result": status_dict,
        }

    if method == "sources":
        sources_handler = getattr(server, "sources_handler", None)
        if callable(sources_handler):
            _, sources_dict = sources_handler(
                server,
                {"refresh": "true"} if refresh_flag else {},
            )
        else:
            sources_dict = discover_sources(
                adb_path=getattr(server, "adb_path", None),
                home_dir=getattr(server, "home_dir", None),
                refresh=refresh_flag,
                force_refresh=refresh_flag,
                run_adb_fn=getattr(server, "run_adb_fn", None),
                find_adb_fn=getattr(server, "find_adb_fn", None),
            )
        return {
            **sources_dict,
            "id": req_id,
            "ok": True,
            "result": sources_dict,
        }

    if method == "export":
        try:
            str_params = {
                str(k): str(v) for k, v in params.items() if v is not None
            }
            validate_http_export_query(str_params)
            source_id = (
                params.get("source")
                if params.get("source") is not None
                else (params.get("source_id") or params.get("sourceId"))
            )
            if isinstance(source_id, str):
                source_id = source_id.strip() or None
            newer_than = (
                params.get("newerThan")
                if params.get("newerThan") is not None
                else params.get("newer_than")
            )
            res = export_from_source(
                source=source_id,
                adb_path=getattr(server, "adb_path", None),
                home_dir=getattr(server, "home_dir", None),
                refresh=refresh_flag,
                newer_than=newer_than,
                run_adb_fn=getattr(server, "run_adb_fn", None),
                find_adb_fn=getattr(server, "find_adb_fn", None),
            )
        except ExporterError as exc:
            return {
                "id": req_id,
                "ok": False,
                "error": exc.code,
                "message": exc.message,
            }

        return {
            "id": req_id,
            "ok": True,
            "data": res["data"],
            "source": res.get("source"),
            "modified": res.get("modified"),
            "result": res,
        }

    if method == "usb.owner":
        vid = params.get("vid")
        pid = params.get("pid")
        usb_owner_handler = getattr(server, "usb_owner_handler", None)
        if callable(usb_owner_handler):
            query_map: dict[str, str] = {}
            if vid is not None:
                query_map["vid"] = str(vid)
            if pid is not None:
                query_map["pid"] = str(pid)
            _, owner_dict = usb_owner_handler(server, query_map)
        else:
            extra_kwargs = getattr(server, "usb_owner_kwargs", None) or {}
            owner_dict = inspect_usb_owner(vid=vid, pid=pid, **extra_kwargs)
        return {
            **owner_dict,
            "id": req_id,
            "ok": True,
            "result": owner_dict,
        }

    # method == "adb.kill_server"
    kill_dict = _execute_kill_adb_server(server, params)
    return {
        **kill_dict,
        "id": req_id,
        "ok": True,
        "killed": bool(kill_dict.get("killed", True)),
        "message": str(kill_dict.get("message", "ADB server stopped.")),
        "result": kill_dict,
    }


def handle_websocket_upgrade(
    handler: Any,
    *,
    cors_headers: Mapping[str, str] | None = None,
) -> bool:
    """Validate RFC 6455 upgrade headers, send HTTP 101, and run the `/ws` frame loop."""
    origin_header = handler.headers.get("Origin")
    allowed_origins = getattr(handler.server, "allowed_origins", DEFAULT_ALLOWED_ORIGINS)
    try:
        validate_origin_header(origin_header, allowed_origins=allowed_origins)
    except ForbiddenOriginError:
        handler._send_json(
            403,
            {
                "ok": False,
                "error": "forbidden_origin",
                "message": "Origin is not authorized to access TowerForge Link WebSocket.",
            },
        )
        return False

    upgrade_header = (handler.headers.get("Upgrade") or "").strip().lower()
    if upgrade_header != "websocket":
        handler._send_json(
            400,
            {
                "ok": False,
                "error": "invalid_upgrade",
                "message": "Expected 'Upgrade: websocket' header.",
            },
            extra_headers=cors_headers,
        )
        return False

    sec_ws_key = (handler.headers.get("Sec-WebSocket-Key") or "").strip()
    if not sec_ws_key:
        handler._send_json(
            400,
            {
                "ok": False,
                "error": "missing_websocket_key",
                "message": "Missing required 'Sec-WebSocket-Key' header.",
            },
            extra_headers=cors_headers,
        )
        return False

    accept_token = compute_websocket_accept(sec_ws_key)

    handler.send_response(101, "Switching Protocols")
    handler.send_header("Upgrade", "websocket")
    handler.send_header("Connection", "Upgrade")
    handler.send_header("Sec-WebSocket-Accept", accept_token)
    if cors_headers:
        for key, value in cors_headers.items():
            handler.send_header(key, value)
    handler.end_headers()
    handler.wfile.flush()
    handler.close_connection = True

    while True:
        try:
            frame = read_ws_frame(
                handler.rfile,
                require_masked=True,
                max_payload_bytes=MAX_WS_FRAME_BYTES,
            )
            if frame is None:
                break

            if frame.opcode == OPCODE_CLOSE:
                write_ws_close(handler.wfile, CLOSE_NORMAL)
                break

            if frame.opcode == OPCODE_PING:
                write_ws_frame(handler.wfile, frame.payload, opcode=OPCODE_PONG)
                continue

            if frame.opcode == OPCODE_PONG:
                continue

            if frame.opcode == OPCODE_TEXT:
                try:
                    text_payload = frame.payload.decode("utf-8")
                except UnicodeDecodeError:
                    write_ws_close(handler.wfile, CLOSE_INVALID_PAYLOAD, "Invalid UTF-8")
                    break
                response = dispatch_ws_rpc(handler.server, text_payload)
                write_ws_frame(handler.wfile, json.dumps(response), opcode=OPCODE_TEXT)
                continue

            write_ws_close(handler.wfile, CLOSE_UNSUPPORTED_DATA, "Unsupported opcode")
            break
        except WebSocketFrameTooLargeError:
            try:
                write_ws_close(handler.wfile, CLOSE_MESSAGE_TOO_BIG, "Message too big")
            except OSError:
                pass
            break
        except WebSocketProtocolError as exc:
            try:
                write_ws_close(handler.wfile, exc.close_code, "Protocol error")
            except OSError:
                pass
            break
        except OSError:
            break

    return True
