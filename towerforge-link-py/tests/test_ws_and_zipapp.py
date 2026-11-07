"""Unit tests for the restricted stdlib RFC 6455 WebSocket endpoint (`ws.py`) and reproducible `.pyz` zipapp builder (`build_zipapp.py`)."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
import hashlib
import io
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import sys
import threading
from typing import Any
import zipfile

import pytest

# Ensure `towerforge_link` and `build_zipapp` are importable when pytest runs from `/workspace`
PACKAGE_ROOT = Path(__file__).resolve().parents[1]
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

import build_zipapp as zipapp_builder  # noqa: E402
from towerforge_link.adb_runner import AdbResult  # noqa: E402
from towerforge_link.http_server import TowerForgeHTTPServer, create_server  # noqa: E402
from towerforge_link.sources import clear_discovery_cache  # noqa: E402
from towerforge_link.ws import (  # noqa: E402
    CLOSE_MESSAGE_TOO_BIG,
    CLOSE_NORMAL,
    CLOSE_PROTOCOL_ERROR,
    MAX_WS_FRAME_BYTES,
    OPCODE_CLOSE,
    OPCODE_PING,
    OPCODE_PONG,
    OPCODE_TEXT,
    WebSocketFrameTooLargeError,
    WebSocketProtocolError,
    compute_websocket_accept,
    dispatch_ws_rpc,
    encode_ws_frame,
    read_ws_frame,
)


@contextmanager
def _running_http_server(**kwargs: Any) -> Iterator[TowerForgeHTTPServer]:
    """Start `TowerForgeHTTPServer` on an ephemeral loopback port in a background thread."""
    clear_discovery_cache()
    server = create_server(
        bind="127.0.0.1",
        port=0,
        **kwargs,
    )
    thread = threading.Thread(
        target=server.serve_forever,
        kwargs={"poll_interval": 0.02},
        daemon=True,
    )
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3.0)
        clear_discovery_cache()


class _RawWsTestClient:
    """Minimal raw TCP RFC 6455 WebSocket client for testing `ws://127.0.0.1:<port>/ws`."""

    def __init__(self, port: int) -> None:
        self.port = port
        self.sock = socket.create_connection(("127.0.0.1", port), timeout=5.0)
        self.rfile = self.sock.makefile("rb")
        self.wfile = self.sock.makefile("wb")

    def handshake(
        self,
        *,
        origin: str | None = "https://towerforge.hackedyour.info",
        host: str = "127.0.0.1:47821",
        sec_key: str = "dGhlIHNhbXBsZSBub25jZQ==",
        upgrade: str = "websocket",
    ) -> tuple[int, dict[str, str], bytes]:
        """Send an HTTP WebSocket upgrade request and return `(status_code, headers, body_if_error)`."""
        lines = [
            "GET /ws HTTP/1.1",
            f"Host: {host}",
            f"Upgrade: {upgrade}",
            "Connection: Upgrade",
            f"Sec-WebSocket-Key: {sec_key}",
            "Sec-WebSocket-Version: 13",
        ]
        if origin is not None:
            lines.append(f"Origin: {origin}")
        raw_req = ("\r\n".join(lines) + "\r\n\r\n").encode("ascii")
        self.wfile.write(raw_req)
        self.wfile.flush()

        status_line = self.rfile.readline().decode("iso-8859-1").strip()
        parts = status_line.split(" ", 2)
        status_code = int(parts[1])

        headers: dict[str, str] = {}
        while True:
            line = self.rfile.readline().decode("iso-8859-1")
            if line in ("\r\n", "\n", ""):
                break
            if ":" in line:
                k, v = line.split(":", 1)
                headers[k.strip().lower()] = v.strip()

        body = b""
        if status_code != 101:
            content_length = int(headers.get("content-length", "0"))
            if content_length > 0:
                body = self.rfile.read(content_length)
        return status_code, headers, body

    def send_masked_frame(
        self,
        payload: bytes | str,
        opcode: int = OPCODE_TEXT,
        *,
        mask_key: bytes = b"\x37\xfa\x21\x3d",
    ) -> None:
        """Send a masked client-to-server WebSocket frame."""
        frame = encode_ws_frame(payload, opcode=opcode, fin=True, mask_key=mask_key)
        self.wfile.write(frame)
        self.wfile.flush()

    def recv_server_frame(self) -> tuple[int, bytes]:
        """Read an unmasked server-to-client WebSocket frame."""
        frame = read_ws_frame(self.rfile, require_masked=False)
        assert frame is not None, "Expected server WebSocket frame, got EOF"
        assert frame.masked is False, "Server-to-client frames must not be masked"
        return frame.opcode, frame.payload

    def call_rpc(
        self,
        method: str,
        params: dict[str, Any] | None = None,
        *,
        req_id: str = "req-1",
    ) -> dict[str, Any]:
        """Send a JSON-RPC text frame and parse the JSON response frame."""
        req_obj: dict[str, Any] = {"id": req_id, "method": method}
        if params is not None:
            req_obj["params"] = params
        self.send_masked_frame(json.dumps(req_obj), opcode=OPCODE_TEXT)
        opcode, payload = self.recv_server_frame()
        assert opcode == OPCODE_TEXT
        return json.loads(payload.decode("utf-8"))

    def close(self) -> None:
        """Close the underlying socket and streams."""
        for handle in (self.wfile, self.rfile, self.sock):
            try:
                handle.close()
            except OSError:
                pass


def test_ws_handshake_accepts_trusted_origin_and_rejects_untrusted_origin() -> None:
    """Test Case 1: WebSocket handshake with valid `Origin: https://towerforge.hackedyour.info` succeeds (`101 Switching Protocols` and valid `Sec-WebSocket-Accept`); untrusted `Origin` returns `403`."""
    rfc_sample_key = "dGhlIHNhbXBsZSBub25jZQ=="
    expected_accept = "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
    assert compute_websocket_accept(rfc_sample_key) == expected_accept

    with _running_http_server() as srv:
        port = srv.server_port

        # 1a. Valid trusted Origin -> 101 Switching Protocols + RFC6455 Sec-WebSocket-Accept
        client_ok = _RawWsTestClient(port)
        try:
            status, headers, _ = client_ok.handshake(
                origin="https://towerforge.hackedyour.info",
                sec_key=rfc_sample_key,
            )
            assert status == 101
            assert headers.get("upgrade", "").lower() == "websocket"
            assert headers.get("connection", "").lower() == "upgrade"
            assert headers.get("sec-websocket-accept") == expected_accept
            assert (
                headers.get("access-control-allow-origin")
                == "https://towerforge.hackedyour.info"
            )

            # Clean close handshake (`0x8` -> `0x8`)
            client_ok.send_masked_frame(struct.pack("!H", CLOSE_NORMAL), opcode=OPCODE_CLOSE)
            close_opcode, close_payload = client_ok.recv_server_frame()
            assert close_opcode == OPCODE_CLOSE
            assert struct.unpack("!H", close_payload[:2])[0] == CLOSE_NORMAL
        finally:
            client_ok.close()

        # 1b. Untrusted Origin -> 403 Forbidden (no upgrade, no CORS header)
        client_evil_origin = _RawWsTestClient(port)
        try:
            bad_status, bad_headers, bad_body = client_evil_origin.handshake(
                origin="https://evil.attacker.example",
                sec_key=rfc_sample_key,
            )
            assert bad_status == 403
            assert "sec-websocket-accept" not in bad_headers
            assert "access-control-allow-origin" not in bad_headers
            err_json = json.loads(bad_body.decode("utf-8"))
            assert err_json["ok"] is False
            assert err_json["error"] == "forbidden_origin"
        finally:
            client_evil_origin.close()

        # 1c. DNS rebinding Host header -> 403 Forbidden
        client_evil_host = _RawWsTestClient(port)
        try:
            host_status, _, host_body = client_evil_host.handshake(
                origin="https://towerforge.hackedyour.info",
                host="rebind.attacker.example:47821",
                sec_key=rfc_sample_key,
            )
            assert host_status == 403
            err_host = json.loads(host_body.decode("utf-8"))
            assert err_host["error"] == "forbidden_host"
        finally:
            client_evil_host.close()

    # 1d. Mismatched Linux peer socket UID -> 403 Forbidden
    with _running_http_server(expected_uid=99999) as srv_uid_mismatch:
        client_uid = _RawWsTestClient(srv_uid_mismatch.server_port)
        try:
            uid_status, _, uid_body = client_uid.handshake(
                origin="https://towerforge.hackedyour.info",
            )
            assert uid_status == 403
            err_uid = json.loads(uid_body.decode("utf-8"))
            assert err_uid["error"] == "forbidden_peer_uid"
        finally:
            client_uid.close()


def test_ws_rpc_methods_status_sources_export_usb_owner_and_kill_server(
    tmp_path: Path,
) -> None:
    """Test Case 2: WebSocket JSON-RPC calls for `status`, `sources`, `export`, `usb.owner`, and `adb.kill_server` return expected JSON responses."""
    # Set up a local Waydroid export file with exact whitespace/key order to verify zero re-serialization
    waydroid_dir = (
        tmp_path
        / ".local/share/waydroid/data/media/0/Android/data/com.TechTreeGames.TheTower/files"
    )
    waydroid_dir.mkdir(parents=True, exist_ok=True)
    raw_export_str = '{\n  "version":  1,\n  "coins": 1e308,\n  "note": "exact_unmodified_bytes"\n}\n'
    export_file = waydroid_dir / "tool_export.json"
    export_file.write_text(raw_export_str, encoding="utf-8")

    adb_calls: list[list[str]] = []

    def fake_run_adb(
        first: Any,
        second: Any = None,
        *,
        serial: str | None = None,
        **kwargs: Any,
    ) -> AdbResult:
        cmd = list(second) if second is not None else list(first)
        if serial is not None:
            cmd = ["-s", serial, *cmd]
        adb_calls.append(cmd)
        if cmd[:1] == ["devices"]:
            return AdbResult(
                args=cmd,
                returncode=0,
                stdout="List of devices attached\n54221FDAP0011M device usb:1-2 product:cheetah model:Pixel_7_Pro device:cheetah transport_id:1\n",
                stderr="",
            )
        if "ls" in cmd:
            return AdbResult(
                args=cmd,
                returncode=0,
                stdout="000081b0 00000400 672b8d00 tool_export.json\n",
                stderr="",
            )
        if cmd[:1] == ["kill-server"]:
            return AdbResult(args=cmd, returncode=0, stdout="", stderr="")
        return AdbResult(args=cmd, returncode=0, stdout="", stderr="")

    def fake_usb_owner_handler(
        _srv: TowerForgeHTTPServer,
        query: dict[str, str],
    ) -> tuple[int, dict[str, Any]]:
        return (
            200,
            {
                "ok": True,
                "platform": "linux",
                "vid": query.get("vid") or "18d1",
                "pid": query.get("pid") or "4ee2",
                "busnum": 1,
                "devnum": 12,
                "devnode": "/dev/bus/usb/001/012",
                "devnode_writable": True,
                "busy": True,
                "holders": [{"pid": 4321, "comm": "adb"}],
                "recommended_action": "adb kill-server",
            },
        )

    with _running_http_server(
        home_dir=tmp_path,
        adb_path="/usr/bin/adb",
        run_adb_fn=fake_run_adb,
        find_adb_fn=lambda explicit_path=None: "/usr/bin/adb",
        usb_owner_handler=fake_usb_owner_handler,
    ) as srv:
        client = _RawWsTestClient(srv.server_port)
        try:
            status_code, _, _ = client.handshake(
                origin="https://towerforge.hackedyour.info"
            )
            assert status_code == 101

            # 2a. status
            res_status = client.call_rpc("status", req_id="tf-ws-1")
            assert res_status["id"] == "tf-ws-1"
            assert res_status["ok"] is True
            assert res_status["app"] == "TowerForge Link"
            assert res_status["adbAvailable"] is True
            assert isinstance(res_status["result"], dict)

            # 2b. sources
            res_sources = client.call_rpc(
                "sources",
                {"refresh": True},
                req_id="tf-ws-2",
            )
            assert res_sources["id"] == "tf-ws-2"
            assert res_sources["ok"] is True
            assert res_sources["has_save_data"] is True
            source_ids = [s["id"] for s in res_sources["sources"]]
            assert "waydroid:local" in source_ids
            assert "adb:54221FDAP0011M" in source_ids

            # 2c. export (verifying exact unmodified JSON text preservation)
            res_export = client.call_rpc(
                "export",
                {"source": "waydroid:local"},
                req_id="tf-ws-3",
            )
            assert res_export["id"] == "tf-ws-3"
            assert res_export["ok"] is True
            assert res_export["data"] == raw_export_str
            assert res_export["source"]["id"] == "waydroid:local"

            # 2d. usb.owner
            res_usb = client.call_rpc(
                "usb.owner",
                {"vid": "18d1", "pid": "4ee2"},
                req_id="tf-ws-4",
            )
            assert res_usb["id"] == "tf-ws-4"
            assert res_usb["ok"] is True
            assert res_usb["vid"] == "18d1"
            assert res_usb["pid"] == "4ee2"
            assert res_usb["holders"] == [{"pid": 4321, "comm": "adb"}]
            assert res_usb["recommended_action"] == "adb kill-server"

            # 2e. adb.kill_server
            res_kill = client.call_rpc("adb.kill_server", req_id="tf-ws-5")
            assert res_kill["id"] == "tf-ws-5"
            assert res_kill["ok"] is True
            assert res_kill["killed"] is True
            assert res_kill["message"] == "ADB server stopped."
            assert ["kill-server"] in adb_calls
        finally:
            client.close()


def test_ws_rpc_rejects_disallowed_methods_with_method_not_allowed() -> None:
    """Test Case 3: WebSocket JSON-RPC call with `method: "shell"` (and other non-allowlisted methods) returns `{"ok": False, "error": "MethodNotAllowed"}`."""
    with _running_http_server() as srv:
        client = _RawWsTestClient(srv.server_port)
        try:
            status_code, _, _ = client.handshake(
                origin="https://towerforge.hackedyour.info"
            )
            assert status_code == 101

            for forbidden_method in ("shell", "exec", "eval", "pull", "push", "root", ""):
                req_id = f"forbid-{forbidden_method or 'empty'}"
                resp = client.call_rpc(
                    forbidden_method,
                    {"cmd": "id"},
                    req_id=req_id,
                )
                assert resp["id"] == req_id
                assert resp["ok"] is False
                assert resp["error"] == "MethodNotAllowed"
                assert forbidden_method in resp["message"]
        finally:
            client.close()


def test_ws_framing_ping_pong_16bit_length_unmasked_rejection_and_64kib_cap() -> None:
    """Verify RFC 6455 ping/pong (`0x9` -> `0xA`), 16-bit extended payload length, unmasked client rejection (`1002`), and 64 KiB cap (`1009`)."""
    # Unit-test 16-bit frame encode/decode roundtrip (e.g., 1024-byte payload)
    medium_payload = b"x" * 1024
    masked_16bit = encode_ws_frame(
        medium_payload,
        opcode=OPCODE_TEXT,
        mask_key=b"\x01\x02\x03\x04",
    )
    decoded = read_ws_frame(io.BytesIO(masked_16bit), require_masked=True)
    assert decoded is not None
    assert decoded.payload == medium_payload

    # Unit-test unmasked client frame rejection -> WebSocketProtocolError (1002)
    unmasked_frame = encode_ws_frame(b'{"id":"1","method":"status"}', mask_key=None)
    with pytest.raises(WebSocketProtocolError) as exc_proto:
        read_ws_frame(io.BytesIO(unmasked_frame), require_masked=True)
    assert exc_proto.value.close_code == CLOSE_PROTOCOL_ERROR

    # Unit-test >64 KiB frame rejection -> WebSocketFrameTooLargeError (1009)
    oversized_frame = encode_ws_frame(
        b"A" * (MAX_WS_FRAME_BYTES + 1),
        opcode=OPCODE_TEXT,
        mask_key=b"\x11\x22\x33\x44",
    )
    with pytest.raises(WebSocketFrameTooLargeError) as exc_big:
        read_ws_frame(io.BytesIO(oversized_frame), require_masked=True)
    assert exc_big.value.close_code == CLOSE_MESSAGE_TOO_BIG

    # Live server test for Ping -> Pong and >64 KiB close code 1009
    with _running_http_server() as srv:
        client = _RawWsTestClient(srv.server_port)
        try:
            status_code, _, _ = client.handshake(
                origin="https://towerforge.hackedyour.info"
            )
            assert status_code == 101

            # Ping (0x9) -> Pong (0xA) echoing payload
            client.send_masked_frame(b"heartbeat-123", opcode=OPCODE_PING)
            opcode, pong_payload = client.recv_server_frame()
            assert opcode == OPCODE_PONG
            assert pong_payload == b"heartbeat-123"

            # Oversized frame (> 65536 bytes) -> Close frame with 1009
            client.wfile.write(oversized_frame)
            client.wfile.flush()
            close_op, close_data = client.recv_server_frame()
            assert close_op == OPCODE_CLOSE
            assert struct.unpack("!H", close_data[:2])[0] == CLOSE_MESSAGE_TOO_BIG
        finally:
            client.close()

    # Also verify export RPC blocks playerInfo.dat path traversal attempts
    err_resp = dispatch_ws_rpc(
        object(),
        {
            "id": "sec-1",
            "method": "export",
            "params": {"source": "../playerInfo.dat"},
        },
    )
    assert err_resp["id"] == "sec-1"
    assert err_resp["ok"] is False
    assert err_resp["error"] == "forbidden_export_target"


def test_build_zipapp_produces_reproducible_pyz_under_50kib_and_cli_runs(
    tmp_path: Path,
) -> None:
    """Test Case 4: `build_zipapp.py` produces `towerforge-link.pyz` `< 50 KiB`, deterministic byte-for-byte output, and `python3 towerforge-link.pyz --version` / `--help` exits `0`."""
    # Build two separate archives in tmp_path and verify byte-for-byte reproducibility
    out_1 = tmp_path / "towerforge-link-1.pyz"
    out_2 = tmp_path / "towerforge-link-2.pyz"

    meta_1 = zipapp_builder.build_zipapp(output_path=out_1)
    meta_2 = zipapp_builder.build_zipapp(output_path=out_2)

    bytes_1 = out_1.read_bytes()
    bytes_2 = out_2.read_bytes()
    assert bytes_1 == bytes_2
    assert meta_1["sha256"] == meta_2["sha256"]
    assert bytes_1.startswith(b"#!/usr/bin/env python3\n")
    assert len(bytes_1) < 51_200

    # Verify ZipInfo entries have normalized (1980, 1, 1, 0, 0, 0) timestamps and zero __pycache__/.pyc
    with zipfile.ZipFile(io.BytesIO(bytes_1), "r") as zf:
        names = zf.namelist()
        assert "__main__.py" in names
        assert "towerforge_link/__main__.py" in names
        assert "towerforge_link/ws.py" in names
        for info in zf.infolist():
            assert "__pycache__" not in info.filename
            assert not info.filename.endswith(".pyc")
            assert info.date_time == (1980, 1, 1, 0, 0, 0)

    # Also verify the canonical artifact in `towerforge.client/public/downloads/towerforge-link.pyz`
    canonical_meta = zipapp_builder.build_zipapp()
    canonical_pyz = Path(canonical_meta["output_path"])
    canonical_sha = Path(canonical_meta["sha256_path"])

    assert canonical_pyz.is_file()
    assert canonical_sha.is_file()
    assert os.path.getsize(canonical_pyz) < 51_200

    expected_digest = hashlib.sha256(canonical_pyz.read_bytes()).hexdigest()
    assert canonical_sha.read_text(encoding="utf-8") == f"{expected_digest}  towerforge-link.pyz\n"

    # Execute `--version` and `--help` against the built `.pyz`
    ver_proc = subprocess.run(
        [sys.executable, str(canonical_pyz), "--version"],
        shell=False,
        capture_output=True,
        text=True,
        timeout=5.0,
        check=False,
    )
    assert ver_proc.returncode == 0
    assert "towerforge-link" in ver_proc.stdout

    help_proc = subprocess.run(
        [sys.executable, str(canonical_pyz), "--help"],
        shell=False,
        capture_output=True,
        text=True,
        timeout=5.0,
        check=False,
    )
    assert help_proc.returncode == 0
    assert "usage: towerforge-link" in help_proc.stdout


def test_build_single_file_py_and_startup_banner_and_default_serve(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """Test Case 5 (TOWERFORGE-20): `build_zipapp.py` / `build_pyz.py` produces standalone plain-text `towerforge-link.py`, `serve` prints flushed startup banner, and no-arg CLI invocation defaults to `serve`."""
    from towerforge_link import __main__ as cli_mod
    from towerforge_link import http_server as http_mod

    # 1. Build standalone plain-text `towerforge-link.py` and verify sha256 + execution
    out_py = tmp_path / "towerforge-link.py"
    py_meta = zipapp_builder.build_single_file_script(output_path=out_py)
    assert out_py.is_file()
    py_text = out_py.read_text(encoding="utf-8")
    assert py_text.startswith("#!/usr/bin/env python3\n")
    assert "from ." not in py_text
    assert "TowerForge Link {__version__} listening on" in py_text

    sha_file = Path(py_meta["sha256_path"])
    assert sha_file.is_file()
    expected_sha = hashlib.sha256(out_py.read_bytes()).hexdigest()
    assert sha_file.read_text(encoding="utf-8") == f"{expected_sha}  towerforge-link.py\n"

    # Also verify canonical `towerforge.client/public/downloads/towerforge-link.py`
    canonical_py = zipapp_builder.DEFAULT_OUTPUT_PY
    assert canonical_py.is_file()

    ver_proc = subprocess.run(
        [sys.executable, str(out_py), "--version"],
        shell=False,
        capture_output=True,
        text=True,
        timeout=5.0,
        check=False,
    )
    assert ver_proc.returncode == 0
    assert "towerforge-link 0.1.0" in ver_proc.stdout

    # 2. Verify format_startup_banner includes ADB status, listening URL, and Ready! message
    banner = http_mod.format_startup_banner(
        bind="127.0.0.1",
        port=47821,
        adb_path="/usr/bin/adb",
        find_adb_fn=lambda explicit_path=None: "/usr/bin/adb",
        run_adb_fn=lambda adb, args, **kw: AdbResult(
            args=list(args),
            returncode=0,
            stdout=(
                "Android Debug Bridge version 1.0.41\n"
                if list(args) == ["version"]
                else "List of devices attached\n54221FDAP0011M\tdevice\n"
            ),
            stderr="",
        ),
    )
    assert "ADB binary: /usr/bin/adb" in banner
    assert "54221FDAP0011M\tdevice" in banner
    assert (
        "TowerForge Link 0.1.0 listening on http://127.0.0.1:47821 (WebSocket: ws://127.0.0.1:47821/ws)"
        in banner
    )
    assert (
        'Ready! Click "Get from emulator or phone" or "Import via Python Companion" in TowerForge (Ctrl+C to stop).'
        in banner
    )

    # 3. Verify no-arg `cli_mod.main([])` defaults to `serve` and `status` subcommand exits 0
    serve_calls: list[tuple[str, int, str | None]] = []

    def fake_serve_forever(
        bind: str = "127.0.0.1",
        port: int = 47821,
        *,
        adb_path: str | None = None,
        allow_non_loopback_debug: bool = False,
    ) -> int:
        serve_calls.append((bind, port, adb_path))
        print(banner, flush=True)
        return 0

    monkeypatch.setattr(http_mod, "serve_forever", fake_serve_forever)
    rc = cli_mod.main([])
    assert rc == 0
    assert serve_calls == [("127.0.0.1", 47821, None)]
    captured = capsys.readouterr()
    assert "TowerForge Link 0.1.0 listening on http://127.0.0.1:47821" in captured.out

