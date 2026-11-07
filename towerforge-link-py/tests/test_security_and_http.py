"""Unit tests for hardened loopback HTTP server (`http_server.py`) and security controls (`security.py`)."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
import http.client
import json
import os
from pathlib import Path
import sys
import threading

import pytest

# Ensure `towerforge_link` is importable when pytest is invoked from repository root `/workspace`
PACKAGE_ROOT = Path(__file__).resolve().parents[1]
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from towerforge_link.http_server import (  # noqa: E402
    TowerForgeHTTPServer,
    create_server,
)
from towerforge_link.security import (  # noqa: E402
    DEFAULT_ALLOWED_ORIGINS,
    DEFAULT_BIND_HOST,
    DEFAULT_BIND_PORT,
    NonLoopbackBindError,
    validate_bind_address,
    validate_host_header,
    validate_post_csrf,
    verify_linux_peer_uid,
)


@contextmanager
def _running_http_server(**kwargs: object) -> Iterator[TowerForgeHTTPServer]:
    """Start `TowerForgeHTTPServer` on an ephemeral loopback port in a background thread."""
    server = create_server(
        bind="127.0.0.1",
        port=0,
        **kwargs,  # type: ignore[arg-type]
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


def _raw_http_request(
    port: int,
    method: str,
    path: str,
    *,
    headers: dict[str, str],
    body: bytes | None = None,
) -> tuple[int, dict[str, str], bytes]:
    """Send an HTTP/1.1 request to `127.0.0.1:port` with explicit `Host` and custom headers."""
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5.0)
    try:
        conn.putrequest(method, path, skip_host=True, skip_accept_encoding=True)
        for k, v in headers.items():
            conn.putheader(k, v)
        if body is not None and "Content-Length" not in headers:
            conn.putheader("Content-Length", str(len(body)))
        conn.endheaders(message_body=body)
        resp = conn.getresponse()
        resp_headers = {k.lower(): v for k, v in resp.getheaders()}
        resp_body = resp.read()
        return resp.status, resp_headers, resp_body
    finally:
        conn.close()


def test_get_status_rejects_evil_host_header_with_403() -> None:
    """Test Case 1: `GET /status` with `Host: evil.rebind.attacker.com:47821` returns HTTP `403`."""
    assert validate_host_header("evil.rebind.attacker.com:47821") is False
    assert validate_host_header("localhost:47821") is True
    assert validate_host_header("127.0.0.1:47821") is True

    with _running_http_server() as srv:
        port = srv.server_port
        # 1a. DNS rebinding Host header is rejected with HTTP 403
        status, headers, body = _raw_http_request(
            port,
            "GET",
            "/status",
            headers={"Host": "evil.rebind.attacker.com:47821"},
        )
        assert status == 403
        assert "access-control-allow-origin" not in headers
        payload = json.loads(body.decode("utf-8"))
        assert payload["ok"] is False
        assert payload["error"] == "forbidden_host"

        # 1b. Allowed loopback Host headers (`localhost:47821`, `127.0.0.1:47821`, dynamic loopback port) return HTTP 200
        for valid_host in ("localhost:47821", "127.0.0.1:47821", f"127.0.0.1:{port}", f"localhost:{port}"):
            ok_status, _, ok_body = _raw_http_request(
                port,
                "GET",
                "/status",
                headers={"Host": valid_host},
            )
            assert ok_status == 200
            ok_payload = json.loads(ok_body.decode("utf-8"))
            assert ok_payload["ok"] is True


def test_get_status_rejects_evil_origin_with_403_and_no_cors_header() -> None:
    """Test Case 2: `GET /status` with `Origin: https://evil.example.com` returns HTTP `403` and sets no `Access-Control-Allow-Origin` header."""
    with _running_http_server() as srv:
        port = srv.server_port
        status, headers, body = _raw_http_request(
            port,
            "GET",
            "/status",
            headers={
                "Host": "127.0.0.1:47821",
                "Origin": "https://evil.example.com",
            },
        )
        assert status == 403
        assert "access-control-allow-origin" not in headers
        assert "access-control-allow-private-network" not in headers
        payload = json.loads(body.decode("utf-8"))
        assert payload["ok"] is False
        assert payload["error"] == "forbidden_origin"


def test_options_status_pna_preflight_allows_trusted_origins() -> None:
    """Test Case 3: `OPTIONS /status` with `Origin: https://towerforge.hackedyour.info` (and `https://thetower.hackedyour.info`) and `Access-Control-Request-Private-Network: true` returns HTTP `204` with `Access-Control-Allow-Origin` and `Access-Control-Allow-Private-Network: true`."""
    expected_origins = {
        "https://thetower.hackedyour.info",
        "https://towerforge.hackedyour.info",
        "https://tower-forge.com",
        "https://www.tower-forge.com",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8096",
        "http://127.0.0.1:8096",
    }
    assert DEFAULT_ALLOWED_ORIGINS == expected_origins

    with _running_http_server() as srv:
        port = srv.server_port
        for origin in sorted(expected_origins):
            status, headers, body = _raw_http_request(
                port,
                "OPTIONS",
                "/status",
                headers={
                    "Host": "localhost:47821",
                    "Origin": origin,
                    "Access-Control-Request-Method": "GET",
                    "Access-Control-Request-Private-Network": "true",
                },
            )
            assert status == 204
            assert body == b""
            assert headers.get("access-control-allow-origin") == origin
            assert headers.get("access-control-allow-origin") != "*"
            assert headers.get("access-control-allow-private-network") == "true"
            assert headers.get("vary") == "Origin"

        # Untrusted origin on OPTIONS preflight must be rejected with HTTP 403 and no CORS headers
        bad_status, bad_headers, _ = _raw_http_request(
            port,
            "OPTIONS",
            "/status",
            headers={
                "Host": "localhost:47821",
                "Origin": "https://attacker.invalid",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Private-Network": "true",
            },
        )
        assert bad_status == 403
        assert "access-control-allow-origin" not in bad_headers
        assert "access-control-allow-private-network" not in bad_headers


def test_post_requires_csrf_header_or_json_content_type() -> None:
    """Test Case 4: `POST` without `Content-Type: application/json` or `X-TowerForge-Link: 1` returns HTTP `403`."""
    assert validate_post_csrf({}) is False
    assert validate_post_csrf({"Content-Type": "application/x-www-form-urlencoded"}) is False
    assert validate_post_csrf({"Content-Type": "text/plain"}) is False
    assert validate_post_csrf({"X-TowerForge-Link": "1"}) is True
    assert validate_post_csrf({"Content-Type": "application/json"}) is True
    assert validate_post_csrf({"Content-Type": "application/json; charset=utf-8"}) is True

    with _running_http_server() as srv:
        port = srv.server_port

        # 4a. HTML form-style POST without required headers -> 403 Forbidden
        status_no_csrf, _, body_no_csrf = _raw_http_request(
            port,
            "POST",
            "/phone/pair",
            headers={
                "Host": "127.0.0.1:47821",
                "Origin": "https://towerforge.hackedyour.info",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body=b"address=192.168.1.20:37123&code=123456",
        )
        assert status_no_csrf == 403
        payload_no_csrf = json.loads(body_no_csrf.decode("utf-8"))
        assert payload_no_csrf["error"] == "csrf_blocked"

        # 4b. POST with `X-TowerForge-Link: 1` passes CSRF guard -> 200 OK
        status_custom_hdr, _, _ = _raw_http_request(
            port,
            "POST",
            "/phone/pair",
            headers={
                "Host": "127.0.0.1:47821",
                "Origin": "https://towerforge.hackedyour.info",
                "X-TowerForge-Link": "1",
            },
        )
        assert status_custom_hdr == 200

        # 4c. POST with `Content-Type: application/json` passes CSRF guard -> 200 OK
        status_json_ct, _, _ = _raw_http_request(
            port,
            "POST",
            "/phone/pair",
            headers={
                "Host": "127.0.0.1:47821",
                "Origin": "https://thetower.hackedyour.info",
                "Content-Type": "application/json",
            },
            body=b'{"address": "192.168.1.20:37123", "code": "123456"}',
        )
        assert status_json_ct == 200


def test_verify_linux_peer_uid_accepts_matching_uid_and_rejects_mismatched_uid(
    tmp_path: Path,
) -> None:
    """Test Case 5: `verify_linux_peer_uid()` accepts matching UID (`os.getuid()`) and rejects mismatched UID (`99999`) using a mocked `/proc/net/tcp` table."""
    current_uid = os.getuid()
    client_port = 54321  # 0xD431
    server_port = DEFAULT_BIND_PORT  # 47821 -> 0xBACD

    # 127.0.0.1 in little-endian /proc/net/tcp hex is 0100007F
    matching_table = (
        "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n"
        f"   0: 0100007F:{client_port:04X} 0100007F:{server_port:04X} 01 00000000:00000000 00:00000000 00000000  {current_uid}        0 12345 1 0000000000000000 20 4 30 10 -1\n"
    )
    mismatched_table = (
        "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n"
        f"   0: 0100007F:{client_port:04X} 0100007F:{server_port:04X} 01 00000000:00000000 00:00000000 00000000  99999        0 12345 1 0000000000000000 20 4 30 10 -1\n"
    )

    mock_tcp_file = tmp_path / "proc_net_tcp"
    mock_tcp_file.write_text(matching_table, encoding="utf-8")

    # 5a. Matching UID (`os.getuid()`) -> True
    assert (
        verify_linux_peer_uid(
            client_port,
            server_port,
            proc_net_tcp_path=mock_tcp_file,
            platform_name="linux",
        )
        is True
    )

    # 5b. Mismatched UID (`99999`) -> False
    mock_tcp_file.write_text(mismatched_table, encoding="utf-8")
    assert (
        verify_linux_peer_uid(
            client_port,
            server_port,
            proc_net_tcp_path=mock_tcp_file,
            platform_name="linux",
        )
        is False
    )

    # 5c. Missing socket entry -> False
    empty_table = "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n"
    assert (
        verify_linux_peer_uid(
            client_port,
            server_port,
            proc_net_tcp_content=empty_table,
            platform_name="linux",
        )
        is False
    )

    # 5d. Live HTTP server rejects request with HTTP 403 when peer UID check fails
    with _running_http_server(expected_uid=99999) as srv_mismatch:
        status, headers, body = _raw_http_request(
            srv_mismatch.server_port,
            "GET",
            "/status",
            headers={
                "Host": "127.0.0.1:47821",
                "Origin": "https://towerforge.hackedyour.info",
            },
        )
        assert status == 403
        assert "access-control-allow-origin" not in headers
        payload = json.loads(body.decode("utf-8"))
        assert payload["error"] == "forbidden_peer_uid"


def test_strict_loopback_bind_refuses_non_loopback_unless_debug_flag_passed() -> None:
    """Verify `validate_bind_address` and `create_server` enforce strict loopback binding (`127.0.0.1:47821`)."""
    assert DEFAULT_BIND_HOST == "127.0.0.1"
    assert DEFAULT_BIND_PORT == 47821
    assert validate_bind_address("127.0.0.1") == "127.0.0.1"
    assert validate_bind_address("localhost") == "localhost"

    for non_loopback in ("0.0.0.0", "192.168.1.100", "10.0.0.5", "::"):
        with pytest.raises(NonLoopbackBindError):
            validate_bind_address(non_loopback, allow_non_loopback_debug=False)
        with pytest.raises(NonLoopbackBindError):
            create_server(bind=non_loopback, port=0, allow_non_loopback_debug=False)

    assert validate_bind_address("0.0.0.0", allow_non_loopback_debug=True) == "0.0.0.0"


def test_http_server_routes_query_decoding_and_post_error_branches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify query decoding, custom handlers, 400/404/413 HTTP error branches, and `serve_forever`."""
    from towerforge_link.http_server import (
        _percent_decode,
        parse_query_params,
        serve_forever,
    )

    assert _percent_decode("hello+world%21%2F%GG") == "hello world!/%GG"
    assert parse_query_params("a=1%202&flag&&b=3") == {"a": "1 2", "flag": "", "b": "3"}

    srv = create_server(
        bind="127.0.0.1",
        port=0,
        enforce_peer_uid=False,
        status_handler=lambda _s, q: (200, {"ok": True, "custom_status": q.get("x", "none")}),
        sources_handler=lambda _s, _q: (200, {"ok": True, "sources": []}),
        usb_owner_handler=lambda _s, _q: (200, {"ok": True, "holders": []}),
        phone_handler=lambda _s, p, _q, b: (200, {"ok": True, "path": p, "body": b}),
    )
    import threading
    thread = threading.Thread(target=srv.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    thread.start()
    try:
        port = srv.server_port
        valid_headers = {
            "Host": f"127.0.0.1:{port}",
            "Origin": "https://towerforge.hackedyour.info",
        }
        # GET /
        st_root, _, body_root = _raw_http_request(port, "GET", "/", headers=valid_headers)
        assert st_root == 200
        assert json.loads(body_root)["app"] == "TowerForge Link"

        # GET /status, /sources, /usb/owner via custom handlers
        st_stat, _, body_stat = _raw_http_request(port, "GET", "/status?x=hello%20world", headers=valid_headers)
        assert st_stat == 200
        assert json.loads(body_stat)["custom_status"] == "hello world"

        st_src, _, _ = _raw_http_request(port, "GET", "/sources", headers=valid_headers)
        assert st_src == 200

        st_usb, _, _ = _raw_http_request(port, "GET", "/usb/owner", headers=valid_headers)
        assert st_usb == 200

        # GET 404
        st_404, _, _ = _raw_http_request(port, "GET", "/nonexistent", headers=valid_headers)
        assert st_404 == 404

        # OPTIONS without Origin -> 403
        st_opt_no_orig, _, _ = _raw_http_request(
            port, "OPTIONS", "/status", headers={"Host": f"127.0.0.1:{port}"}
        )
        assert st_opt_no_orig == 403

        # POST /status (200), /phone/connect (custom handler), /unknown (404), invalid JSON (400), oversized (413)
        post_headers = {
            **valid_headers,
            "X-TowerForge-Link": "1",
            "Content-Type": "application/json",
        }
        st_post_stat, _, _ = _raw_http_request(port, "POST", "/status", headers=post_headers, body=b"{}")
        assert st_post_stat == 200

        st_post_phone, _, body_phone = _raw_http_request(
            port, "POST", "/phone/connect", headers=post_headers, body=b'{"endpoint":"127.0.0.1:5555"}'
        )
        assert st_post_phone == 200
        assert json.loads(body_phone)["path"] == "/phone/connect"

        st_post_404, _, _ = _raw_http_request(port, "POST", "/unknown", headers=post_headers, body=b"{}")
        assert st_post_404 == 404

        st_post_400, _, _ = _raw_http_request(port, "POST", "/status", headers=post_headers, body=b"{bad json")
        assert st_post_400 == 400

        oversized_headers = {**post_headers, "Content-Length": "100000"}
        st_post_413, _, _ = _raw_http_request(port, "POST", "/status", headers=oversized_headers, body=b"")
        assert st_post_413 == 413
    finally:
        srv.shutdown()
        srv.server_close()
        thread.join(timeout=2.0)

    # Verify serve_forever handles KeyboardInterrupt and closes server cleanly
    class _DummyServer:
        def __init__(self) -> None:
            self.closed = False

        def serve_forever(self) -> None:
            raise KeyboardInterrupt

        def server_close(self) -> None:
            self.closed = True

    dummy = _DummyServer()
    monkeypatch.setattr("towerforge_link.http_server.create_server", lambda **kwargs: dummy)
    assert serve_forever() == 0
    assert dummy.closed is True

