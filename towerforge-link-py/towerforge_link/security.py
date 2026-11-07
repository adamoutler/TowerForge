"""Security controls for the TowerForge Link loopback HTTP server (`security.py`).

Implements defense-in-depth guards for the local HTTP server (`127.0.0.1:47821`):
1. Strict loopback bind address enforcement (`127.0.0.1`), rejecting non-loopback
   addresses unless `--allow-non-loopback-debug` is explicitly enabled.
2. `Host` header validation (`localhost:47821` or `127.0.0.1:47821`) to block
   DNS rebinding attacks.
3. Explicit `Origin` allowlist validation and Chromium Private Network Access (PNA)
   preflight response headers (`Access-Control-Allow-Private-Network: true`),
   never emitting wildcard (`*`) origins.
4. `POST` CSRF protection requiring `X-TowerForge-Link: 1` or
   `Content-Type: application/json` to block HTML `<form>` submissions.
5. Linux `/proc/net/tcp` peer socket UID verification (`verify_linux_peer_uid`)
   confirming the connecting loopback client socket is owned by `os.getuid()`.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping
import ipaddress
import os
from pathlib import Path
import socket
import struct
import sys

DEFAULT_BIND_HOST: str = "127.0.0.1"
DEFAULT_BIND_PORT: int = 47821

ALLOWED_DEFAULT_HOSTS: frozenset[str] = frozenset(
    {
        f"localhost:{DEFAULT_BIND_PORT}",
        f"127.0.0.1:{DEFAULT_BIND_PORT}",
    }
)

DEFAULT_ALLOWED_ORIGINS: frozenset[str] = frozenset(
    {
        "https://thetower.hackedyour.info",
        "https://towerforge.hackedyour.info",
        "https://tower-forge.com",
        "https://www.tower-forge.com",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8096",
        "http://127.0.0.1:8096",
    }
)

CSRF_HEADER_NAME: str = "X-TowerForge-Link"
CSRF_HEADER_VALUE: str = "1"
PROC_NET_TCP_PATH: str = "/proc/net/tcp"


class SecurityError(Exception):
    """Base exception for TowerForge Link HTTP security policy violations."""


class NonLoopbackBindError(SecurityError, ValueError):
    """Raised when attempting to bind the HTTP server to a non-loopback address."""


class ForbiddenHostError(SecurityError):
    """Raised when a request carries a missing or non-loopback `Host` header."""


class ForbiddenOriginError(SecurityError):
    """Raised when a request carries a non-allowlisted `Origin` header."""


class CsrfValidationError(SecurityError):
    """Raised when a `POST` request lacks required anti-CSRF headers."""


class PeerUidMismatchError(SecurityError):
    """Raised when a connecting Linux loopback socket is not owned by `os.getuid()`."""


def is_loopback_address(bind_host: str) -> bool:
    """Return `True` if `bind_host` is strictly a loopback address (`127.0.0.1` / `localhost`)."""
    if not isinstance(bind_host, str):
        return False
    normalized = bind_host.strip().lower()
    if not normalized:
        return False
    if normalized == "localhost":
        return True
    try:
        addr = ipaddress.ip_address(normalized)
    except ValueError:
        return False
    return bool(addr.is_loopback)


def validate_bind_address(
    bind_host: str,
    *,
    allow_non_loopback_debug: bool = False,
) -> str:
    """Validate the server bind address, refusing non-loopback hosts unless debug flag is set."""
    if not isinstance(bind_host, str) or not bind_host.strip():
        raise NonLoopbackBindError("Bind address must be a non-empty string.")
    cleaned = bind_host.strip()
    if is_loopback_address(cleaned):
        return cleaned
    if allow_non_loopback_debug:
        return cleaned
    raise NonLoopbackBindError(
        f"Refusing to bind HTTP server to non-loopback address {cleaned!r}. "
        "Pass --allow-non-loopback-debug to override in isolated container environments."
    )


def get_allowed_hosts(server_port: int = DEFAULT_BIND_PORT) -> frozenset[str]:
    """Return the set of allowed `Host` header values for `server_port`."""
    hosts = {
        f"localhost:{DEFAULT_BIND_PORT}",
        f"127.0.0.1:{DEFAULT_BIND_PORT}",
        f"localhost:{int(server_port)}",
        f"127.0.0.1:{int(server_port)}",
    }
    return frozenset(hosts)


def validate_host_header(
    host_header: str | None,
    server_port: int = DEFAULT_BIND_PORT,
) -> bool:
    """Return `True` iff `host_header` matches an allowed loopback `Host` value."""
    if not host_header or not isinstance(host_header, str):
        return False
    candidate = host_header.strip().lower()
    if not candidate:
        return False
    return candidate in get_allowed_hosts(server_port)


def validate_origin_header(
    origin_header: str | None,
    allowed_origins: Collection[str] = DEFAULT_ALLOWED_ORIGINS,
) -> str | None:
    """Validate `Origin` against `allowed_origins`.

    Returns:
        - `None` if `origin_header` is `None` (no `Origin` header sent).
        - The exact matched origin string if `origin_header` is in `allowed_origins`.

    Raises:
        ForbiddenOriginError: If `origin_header` is present (including empty string or `"null"`)
        and not in `allowed_origins`.
    """
    if origin_header is None:
        return None
    if not isinstance(origin_header, str):
        raise ForbiddenOriginError("Invalid Origin header type.")
    candidate = origin_header.strip()
    if not candidate or candidate == "*":
        raise ForbiddenOriginError("Empty or wildcard Origin header is forbidden.")
    if candidate in allowed_origins:
        return candidate
    raise ForbiddenOriginError(f"Origin {candidate!r} is not in the allowed origins list.")


def build_cors_headers(
    origin_header: str | None,
    *,
    allowed_origins: Collection[str] = DEFAULT_ALLOWED_ORIGINS,
    is_preflight: bool = False,
    request_headers: Mapping[str, str] | None = None,
) -> dict[str, str]:
    """Construct CORS and Chromium Private Network Access (PNA) headers for an allowlisted origin.

    Never emits `*` for `Access-Control-Allow-Origin`. If `origin_header` is `None`,
    returns an empty dictionary. Raises `ForbiddenOriginError` if `origin_header` is not allowlisted.
    """
    matched_origin = validate_origin_header(origin_header, allowed_origins=allowed_origins)
    if matched_origin is None:
        return {}

    headers: dict[str, str] = {
        "Access-Control-Allow-Origin": matched_origin,
        "Access-Control-Allow-Private-Network": "true",
        "Vary": "Origin",
        "Access-Control-Expose-Headers": "X-Export-Modified, X-Export-Source, X-Export-Source-Id",
    }

    if is_preflight:
        req_allow_headers = "Content-Type, X-TowerForge-Link"
        if request_headers is not None:
            for key, value in request_headers.items():
                if key.lower() == "access-control-request-headers" and value.strip():
                    req_allow_headers = value.strip()
                    break
        headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        headers["Access-Control-Allow-Headers"] = req_allow_headers
        headers["Access-Control-Max-Age"] = "600"

    return headers


def _get_header_case_insensitive(headers: Mapping[str, str], target_name: str) -> str | None:
    """Look up an HTTP header value case-insensitively."""
    direct = headers.get(target_name)
    if direct is not None:
        return direct
    target_lower = target_name.lower()
    for key, value in headers.items():
        if key.lower() == target_lower:
            return value
    return None


def validate_post_csrf(headers: Mapping[str, str]) -> bool:
    """Return `True` if a `POST` request carries `X-TowerForge-Link: 1` or `Content-Type: application/json`."""
    if headers is None:
        return False

    custom_header = _get_header_case_insensitive(headers, CSRF_HEADER_NAME)
    if custom_header is not None and custom_header.strip() == CSRF_HEADER_VALUE:
        return True

    content_type = _get_header_case_insensitive(headers, "Content-Type")
    if content_type is not None:
        media_type = content_type.split(";", 1)[0].strip().lower()
        if media_type == "application/json":
            return True

    return False


def _ipv4_to_proc_hex_candidates(ip_str: str) -> set[str]:
    """Convert an IPv4 address string (e.g. `127.0.0.1`) to uppercase 8-hex-char `/proc/net/tcp` representations."""
    cleaned = ip_str.strip()
    if cleaned.lower() == "localhost":
        cleaned = "127.0.0.1"
    packed = socket.inet_aton(cleaned)
    le_val = struct.unpack("<I", packed)[0]
    be_val = struct.unpack(">I", packed)[0]
    return {f"{le_val:08X}", f"{be_val:08X}"}


def verify_linux_peer_uid(
    client_port: int | tuple[str, int],
    server_port: int | tuple[str, int] = DEFAULT_BIND_PORT,
    *,
    client_ip: str = "127.0.0.1",
    server_ip: str = "127.0.0.1",
    expected_uid: int | None = None,
    proc_net_tcp_path: str | Path = PROC_NET_TCP_PATH,
    proc_net_tcp_content: str | None = None,
    platform_name: str | None = None,
) -> bool:
    """Verify via `/proc/net/tcp` that the connecting client socket belongs to `expected_uid` (`os.getuid()`).

    Inspects `/proc/net/tcp` for the active client socket `(client_ip, client_port)` ->
    `(server_ip, server_port)` and checks that column 7 (`uid`) equals `os.getuid()`.
    """
    if isinstance(client_port, tuple):
        client_ip = str(client_port[0])
        actual_client_port = int(client_port[1])
    else:
        actual_client_port = int(client_port)

    if isinstance(server_port, tuple):
        server_ip = str(server_port[0])
        actual_server_port = int(server_port[1])
    else:
        actual_server_port = int(server_port)

    if actual_client_port <= 0 or actual_client_port > 65535:
        return False
    if actual_server_port <= 0 or actual_server_port > 65535:
        return False

    plat = (platform_name or sys.platform).lower()
    if not plat.startswith("linux") and proc_net_tcp_content is None:
        return True

    target_uid = os.getuid() if expected_uid is None else int(expected_uid)

    if proc_net_tcp_content is not None:
        raw_table = proc_net_tcp_content
    else:
        try:
            raw_table = Path(proc_net_tcp_path).read_text(encoding="utf-8")
        except OSError:
            return False

    try:
        client_ip_hexes = _ipv4_to_proc_hex_candidates(client_ip)
        server_ip_hexes = _ipv4_to_proc_hex_candidates(server_ip)
    except OSError:
        return False

    client_port_hex = f"{actual_client_port:04X}"
    server_port_hex = f"{actual_server_port:04X}"

    valid_local_addrs = {f"{ip_hex}:{client_port_hex}" for ip_hex in client_ip_hexes}
    valid_rem_addrs = {f"{ip_hex}:{server_port_hex}" for ip_hex in server_ip_hexes}

    for line in raw_table.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("sl"):
            continue
        parts = stripped.split()
        if len(parts) < 8:
            continue
        local_addr = parts[1].upper()
        rem_addr = parts[2].upper()
        if local_addr in valid_local_addrs and rem_addr in valid_rem_addrs:
            try:
                socket_uid = int(parts[7])
            except ValueError:
                return False
            return socket_uid == target_uid

    return False
