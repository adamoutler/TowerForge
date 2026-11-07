"""Unit tests for Wireless ADB phone pairing, connection, RFC1918 validation, and rate limits (`wireless.py`)."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
import http.client
import json
from pathlib import Path
import sys
import threading
from typing import Any

import pytest

# Ensure `towerforge_link` is importable when pytest is invoked from repository root `/workspace`
PACKAGE_ROOT = Path(__file__).resolve().parents[1]
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from towerforge_link.adb_runner import TIMEOUT_PAIR, TIMEOUT_STATUS, AdbResult  # noqa: E402
from towerforge_link.http_server import (  # noqa: E402
    TowerForgeHTTPServer,
    create_server,
)
from towerforge_link.wireless import (  # noqa: E402
    InvalidPairingCodeError,
    InvalidWirelessEndpointError,
    SlidingWindowRateLimiter,
    validate_lan_endpoint,
    validate_pairing_code,
)


@contextmanager
def _running_http_server(**kwargs: Any) -> Iterator[TowerForgeHTTPServer]:
    """Start `TowerForgeHTTPServer` on an ephemeral loopback port in a background thread."""
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


def _http_post_json(
    port: int,
    path: str,
    *,
    body_obj: dict[str, Any] | None = None,
    extra_headers: dict[str, str] | None = None,
) -> tuple[int, dict[str, Any]]:
    """Send a hardened `POST` request to `127.0.0.1:port` with valid loopback `Host` and CSRF headers."""
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5.0)
    try:
        conn.putrequest("POST", path, skip_host=True, skip_accept_encoding=True)
        headers: dict[str, str] = {
            "Host": "127.0.0.1:47821",
            "Origin": "https://towerforge.hackedyour.info",
            "X-TowerForge-Link": "1",
        }
        if body_obj is not None:
            raw_body = json.dumps(body_obj).encode("utf-8")
            headers["Content-Type"] = "application/json"
            headers["Content-Length"] = str(len(raw_body))
        else:
            raw_body = None
        if extra_headers:
            headers.update(extra_headers)
        for key, value in headers.items():
            conn.putheader(key, value)
        conn.endheaders(message_body=raw_body)
        resp = conn.getresponse()
        resp_bytes = resp.read()
        return resp.status, json.loads(resp_bytes.decode("utf-8"))
    finally:
        conn.close()


def test_validate_lan_endpoint_accepts_rfc1918_private_lan_addresses() -> None:
    """Test Case 1: `validate_lan_endpoint()` accepts `192.168.1.50:37123`, `10.0.0.12:5555`, `172.16.5.4:44444`."""
    assert validate_lan_endpoint("192.168.1.50:37123") == ("192.168.1.50", 37123)
    assert validate_lan_endpoint("10.0.0.12:5555") == ("10.0.0.12", 5555)
    assert validate_lan_endpoint("172.16.5.4:44444") == ("172.16.5.4", 44444)

    # Boundary port checks (1024 and 65535) and upper 172.31.x.x RFC1918 block
    assert validate_lan_endpoint("192.168.0.1:1024") == ("192.168.0.1", 1024)
    assert validate_lan_endpoint("172.31.255.254:65535") == ("172.31.255.254", 65535)


def test_validate_lan_endpoint_rejects_public_loopback_link_local_hostname_and_bad_ports() -> None:
    """Test Case 2: `validate_lan_endpoint()` rejects `8.8.8.8:5555` (public), `127.0.0.1:5555` (loopback), `169.254.1.1:5555` (link-local), `example.com:5555` (hostname), `192.168.1.50:80` (privileged port < 1024), and `192.168.1.50:70000`."""
    rejected_endpoints = [
        "8.8.8.8:5555",          # Public IPv4
        "1.1.1.1:5555",          # Public IPv4
        "172.32.0.1:5555",       # Outside 172.16.0.0/12
        "100.64.0.1:5555",       # CGNAT (not RFC1918)
        "127.0.0.1:5555",        # Loopback
        "127.0.1.1:5555",        # Loopback /8
        "169.254.1.1:5555",      # Link-local
        "224.0.0.1:5555",        # Multicast
        "0.0.0.0:5555",          # Unspecified
        "example.com:5555",      # Hostname
        "localhost:5555",        # Hostname
        "[::1]:5555",            # IPv6 loopback
        "fe80::1:5555",          # IPv6 link-local
        "192.168.1.50:80",       # Privileged port < 1024
        "192.168.1.50:1023",     # Privileged port boundary
        "192.168.1.50:0",        # Port 0
        "192.168.1.50:70000",    # Port > 65535
        "192.168.1.50:65536",    # Port > 65535 boundary
        "192.168.1.50:-5555",    # Negative port
        "192.168.1.50:abc",      # Non-numeric port
        "192.168.1.50",          # Missing port
        ":5555",                 # Missing IP
        "",                      # Empty
        "192.168.1.50:5555; id", # Command injection attempt
    ]
    for bad_endpoint in rejected_endpoints:
        with pytest.raises(InvalidWirelessEndpointError):
            validate_lan_endpoint(bad_endpoint)


def test_validate_pairing_code_accepts_6_digits_and_rejects_invalid_codes() -> None:
    """Test Case 3: `validate_pairing_code()` accepts `"123456"` and rejects `"12345"`, `"1234567"`, `"12345a"`, `"; id"`."""
    assert validate_pairing_code("123456") == "123456"
    assert validate_pairing_code("000000") == "000000"
    assert validate_pairing_code("987654") == "987654"

    rejected_codes: list[Any] = [
        "12345",
        "1234567",
        "12345a",
        "; id",
        "123 456",
        "-12345",
        "",
        "12345\n",
        None,
        True,
    ]
    for bad_code in rejected_codes:
        with pytest.raises(InvalidPairingCodeError):
            validate_pairing_code(bad_code)


def test_rate_limiter_allows_5_requests_in_60s_and_rejects_6th_with_http_429() -> None:
    """Test Case 4: Rate limiter allows 5 requests in 60s and rejects the 6th request with HTTP `429`."""
    # 4a. Direct SlidingWindowRateLimiter unit verification with controllable clock
    fake_now = [1000.0]
    limiter = SlidingWindowRateLimiter(max_attempts=5, window_seconds=60.0, clock=lambda: fake_now[0])
    for _ in range(5):
        assert limiter.allow("wireless") is True
    assert limiter.allow("wireless") is False

    # Advancing clock past 60s window allows requests again
    fake_now[0] = 1060.1
    assert limiter.allow("wireless") is True

    # 4b. Live HTTP server verification on /phone/pair and /phone/connect (5 allowed, 6th -> HTTP 429)
    adb_calls: list[list[str]] = []

    def fake_run_adb(
        args: list[str],
        *,
        adb_path: str | None = None,
        serial: str | None = None,
        timeout: float | None = None,
        operation: str | None = None,
    ) -> AdbResult:
        adb_calls.append(list(args))
        if args[0] == "pair":
            return AdbResult(
                args=["adb", *args],
                returncode=0,
                stdout=f"Successfully paired to {args[1]} [guid=adb-pixel9]\n",
                stderr="",
            )
        if args[0] == "connect":
            return AdbResult(
                args=["adb", *args],
                returncode=0,
                stdout=f"connected to {args[1]}\n",
                stderr="",
            )
        return AdbResult(args=["adb", *args], returncode=0, stdout="", stderr="")

    with _running_http_server(run_adb_fn=fake_run_adb) as srv:
        port = srv.server_port

        # First 5 attempts within 60s succeed with HTTP 200
        for i in range(5):
            status, payload = _http_post_json(
                port,
                f"/phone/pair?address=192.168.1.50:3712{i}&code=123456",
            )
            assert status == 200
            assert payload["ok"] is True

        # 6th attempt on /phone/pair within 60s is rejected with HTTP 429
        status_6th, payload_6th = _http_post_json(
            port,
            "/phone/pair?address=192.168.1.50:37129&code=123456",
        )
        assert status_6th == 429
        assert payload_6th["ok"] is False
        assert payload_6th["error"] == "rate_limit_exceeded"
        assert "rate limit exceeded" in payload_6th["message"].lower()

        # /phone/connect shares the wireless rate limiter and also returns HTTP 429 when exhausted
        status_conn_limited, payload_conn_limited = _http_post_json(
            port,
            "/phone/connect?address=192.168.1.50:44547",
        )
        assert status_conn_limited == 429
        assert payload_conn_limited["ok"] is False
        assert len(adb_calls) == 5


def test_phone_endpoints_return_json_matching_link_client_expectations() -> None:
    """Test Case 5: `/phone/pair`, `/phone/connect`, `/phone/enable-wireless` (and `/phone/adb`), and `/phone/disconnect` (and `/phone/forget`) return JSON matching `src/engine/linkClient.ts` expectations."""
    recorded_invocations: list[dict[str, Any]] = []

    def fake_run_adb(
        args: list[str],
        *,
        adb_path: str | None = None,
        serial: str | None = None,
        timeout: float | None = None,
        operation: str | None = None,
    ) -> AdbResult:
        recorded_invocations.append(
            {
                "args": list(args),
                "adb_path": adb_path,
                "serial": serial,
                "timeout": timeout,
                "operation": operation,
            }
        )
        if args == ["tcpip", "5555"]:
            return AdbResult(
                args=["adb", *args],
                returncode=0,
                stdout="restarting in TCP mode port: 5555\n",
                stderr="",
            )
        if args == ["shell", "ip", "route"]:
            return AdbResult(
                args=["adb", *args],
                returncode=0,
                stdout="192.168.1.0/24 dev wlan0 proto kernel scope link src 192.168.1.50\n",
                stderr="",
            )
        if args[0] == "pair":
            return AdbResult(
                args=["adb", *args],
                returncode=0,
                stdout=f"Successfully paired to {args[1]} [guid=adb-54221FDAP0011M]\n",
                stderr="",
            )
        if args[0] == "connect":
            return AdbResult(
                args=["adb", *args],
                returncode=0,
                stdout=f"connected to {args[1]}\n",
                stderr="",
            )
        if args[0] == "disconnect":
            return AdbResult(
                args=["adb", *args],
                returncode=0,
                stdout="disconnected everything\n",
                stderr="",
            )
        return AdbResult(args=["adb", *args], returncode=0, stdout="", stderr="")

    with _running_http_server(run_adb_fn=fake_run_adb) as srv:
        port = srv.server_port

        # 5a. POST /phone/enable-wireless and alias POST /phone/adb
        status_enable, body_enable = _http_post_json(port, "/phone/enable-wireless")
        assert status_enable == 200
        assert body_enable["ok"] is True
        assert body_enable["adbReady"] is True
        assert body_enable["port"] == 5555
        assert body_enable["ip"] == "192.168.1.50"
        assert isinstance(body_enable["message"], str) and len(body_enable["message"]) > 0

        status_adb_alias, body_adb_alias = _http_post_json(port, "/phone/adb")
        assert status_adb_alias == 200
        assert body_adb_alias["ok"] is True
        assert isinstance(body_adb_alias["message"], str) and len(body_adb_alias["message"]) > 0

        # 5b. POST /phone/pair via query params (as called by linkPhone('pair', { address, code }) in linkClient.ts)
        status_pair_q, body_pair_q = _http_post_json(
            port,
            "/phone/pair?address=192.168.1.50:37123&code=123456",
        )
        assert status_pair_q == 200
        assert body_pair_q["ok"] is True
        assert body_pair_q["paired"] is True
        assert body_pair_q["address"] == "192.168.1.50:37123"
        assert "192.168.1.50:37123" in body_pair_q["message"]

        pair_call = next(c for c in recorded_invocations if c["args"][0] == "pair")
        assert pair_call["args"] == ["pair", "192.168.1.50:37123", "123456"]
        assert pair_call["operation"] == "pair"
        assert pair_call["timeout"] == TIMEOUT_PAIR

        # 5c. POST /phone/pair via JSON body
        status_pair_json, body_pair_json = _http_post_json(
            port,
            "/phone/pair",
            body_obj={"address": "10.0.0.12:41234", "code": "654321"},
        )
        assert status_pair_json == 200
        assert body_pair_json["ok"] is True
        assert body_pair_json["paired"] is True
        assert body_pair_json["address"] == "10.0.0.12:41234"

        # 5d. POST /phone/connect via query params and JSON body
        status_conn, body_conn = _http_post_json(
            port,
            "/phone/connect?address=192.168.1.50:44547",
        )
        assert status_conn == 200
        assert body_conn["ok"] is True
        assert body_conn["connected"] is True
        assert body_conn["address"] == "192.168.1.50:44547"
        assert body_conn["serial"] == "192.168.1.50:44547"
        assert "192.168.1.50:44547" in body_conn["message"]

        conn_call = next(c for c in recorded_invocations if c["args"][0] == "connect")
        assert conn_call["args"] == ["connect", "192.168.1.50:44547"]
        assert conn_call["operation"] == "status"
        assert conn_call["timeout"] == TIMEOUT_STATUS

        # 5e. POST /phone/disconnect and alias POST /phone/forget
        status_disc, body_disc = _http_post_json(port, "/phone/disconnect")
        assert status_disc == 200
        assert body_disc == {
            "ok": True,
            "connected": False,
            "message": "Disconnected wireless ADB devices.",
        }

        status_forget, body_forget = _http_post_json(port, "/phone/forget")
        assert status_forget == 200
        assert body_forget == {
            "ok": True,
            "connected": False,
            "message": "Disconnected wireless ADB devices.",
        }

        # 5f. Invalid input to /phone/pair and /phone/connect returns HTTP 400 with ok=False, error='invalid_input'
        status_bad_ip, body_bad_ip = _http_post_json(
            port,
            "/phone/pair?address=8.8.8.8:5555&code=123456",
        )
        assert status_bad_ip == 400
        assert body_bad_ip["ok"] is False
        assert body_bad_ip["error"] == "invalid_input"

        status_bad_code, body_bad_code = _http_post_json(
            port,
            "/phone/pair?address=192.168.1.50:37123&code=12345a",
        )
        assert status_bad_code == 400
        assert body_bad_code["ok"] is False
        assert body_bad_code["error"] == "invalid_input"

        status_bad_conn, body_bad_conn = _http_post_json(
            port,
            "/phone/connect?address=127.0.0.1:5555",
        )
        assert status_bad_conn == 400
        assert body_bad_conn["ok"] is False
        assert body_bad_conn["error"] == "invalid_input"
