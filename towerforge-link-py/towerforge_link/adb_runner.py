"""Sandboxed ADB subprocess runner with serial allowlisting and environment scrubbing.

Executes all `adb` commands strictly as argument arrays (`shell=False`),
enforces `SERIAL_RE` validation with flag-injection rejection before passing
`-s <serial>`, scrubs dangerous dynamic-linker and runtime variables from the
child environment, and enforces hard per-operation timeouts.
"""

from __future__ import annotations

from dataclasses import dataclass
import os
import re
import subprocess
from typing import Mapping, Sequence

from .adb_finder import AdbError, find_adb

SERIAL_RE = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")

TIMEOUT_STATUS: float = 5.0
TIMEOUT_PULL: float = 15.0
TIMEOUT_PAIR: float = 30.0
DEFAULT_TIMEOUT: float = TIMEOUT_STATUS

OPERATION_TIMEOUTS: dict[str, float] = {
    "status": TIMEOUT_STATUS,
    "devices": TIMEOUT_STATUS,
    "version": TIMEOUT_STATUS,
    "mdns": TIMEOUT_STATUS,
    "ls": TIMEOUT_STATUS,
    "stat": TIMEOUT_STATUS,
    "shell": TIMEOUT_STATUS,
    "connect": TIMEOUT_STATUS,
    "disconnect": TIMEOUT_STATUS,
    "tcpip": TIMEOUT_STATUS,
    "start-server": TIMEOUT_STATUS,
    "kill-server": TIMEOUT_STATUS,
    "pull": TIMEOUT_PULL,
    "pair": TIMEOUT_PAIR,
}

SCRUBBED_ENV_EXACT: frozenset[str] = frozenset(
    {
        "LD_PRELOAD",
        "LD_LIBRARY_PATH",
        "LD_AUDIT",
        "LD_DEBUG",
        "DYLD_INSERT_LIBRARIES",
        "DYLD_LIBRARY_PATH",
        "DYLD_FRAMEWORK_PATH",
        "BASH_ENV",
        "ENV",
    }
)

SCRUBBED_ENV_PREFIXES: tuple[str, ...] = ("PYTHON",)


class InvalidSerialError(AdbError, ValueError):
    """Raised when a device serial fails `SERIAL_RE` or flag-injection validation."""


class AdbTimeoutError(AdbError, TimeoutError):
    """Raised when an `adb` subprocess exceeds its configured hard timeout."""


class AdbCommandError(AdbError):
    """Raised when `check=True` is requested and `adb` exits with a non-zero code."""

    def __init__(self, message: str, result: AdbResult) -> None:
        super().__init__(message)
        self.result = result


@dataclass(frozen=True)
class AdbResult:
    """Immutable result of a sandboxed `adb` invocation."""

    args: list[str]
    returncode: int
    stdout: str
    stderr: str

    @property
    def ok(self) -> bool:
        """Return True when the command exited with code 0."""
        return self.returncode == 0

    @property
    def code(self) -> int:
        """Alias for `returncode` for parity with C# `Adb.Result`."""
        return self.returncode

    @property
    def out(self) -> str:
        """Alias for `stdout` for parity with C# `Adb.Result`."""
        return self.stdout

    @property
    def err(self) -> str:
        """Alias for `stderr` for parity with C# `Adb.Result`."""
        return self.stderr


def validate_serial(serial: str) -> str:
    """Validate an ADB target serial against `SERIAL_RE` and reject flag injection.

    Accepts valid USB serials (`54221FDAP0011M`), emulator serials (`emulator-5554`),
    TCP `host:port` endpoints (`192.168.1.20:5555`), and mDNS service serials
    (`adb-54221FDAP0011M-abc._adb-tls-connect._tcp`).

    Rejects:
      - Non-string or empty serials
      - Leading hyphens (`-H`, `--help`, `-s`) to prevent ADB CLI option injection
      - Shell metacharacters (`;`, `|`, `$()`, backticks, whitespace, etc.)
      - Path traversal sequences (`..`)

    Raises:
        InvalidSerialError: If `serial` is invalid or unsafe.
    """
    if not isinstance(serial, str) or not serial:
        raise InvalidSerialError("Device serial must be a non-empty string.")
    if serial.startswith("-"):
        raise InvalidSerialError(
            f"Device serial cannot start with '-' (flag injection blocked): {serial!r}"
        )
    if ".." in serial:
        raise InvalidSerialError(
            f"Device serial cannot contain '..' traversal sequence: {serial!r}"
        )
    if not SERIAL_RE.fullmatch(serial):
        raise InvalidSerialError(
            f"Device serial {serial!r} does not match allowed pattern {SERIAL_RE.pattern}"
        )
    return serial


def sanitize_env(base_env: Mapping[str, str] | None = None) -> dict[str, str]:
    """Return a sanitized copy of `base_env` (or `os.environ`) for child `adb` processes.

    Strips `LD_PRELOAD`, `LD_LIBRARY_PATH`, `DYLD_INSERT_LIBRARIES`, and all
    `PYTHON*` environment variables.
    """
    source = os.environ if base_env is None else base_env
    cleaned: dict[str, str] = {}
    for key, value in source.items():
        if not isinstance(key, str) or not isinstance(value, str):
            continue
        if "\x00" in key or "\x00" in value:
            continue
        if key in SCRUBBED_ENV_EXACT:
            continue
        if any(key.startswith(prefix) for prefix in SCRUBBED_ENV_PREFIXES):
            continue
        cleaned[key] = value
    return cleaned


def resolve_timeout(
    args: Sequence[str],
    *,
    timeout: float | None = None,
    operation: str | None = None,
) -> float:
    """Resolve the hard timeout in seconds (`5s` status, `15s` pull, `30s` pair)."""
    if timeout is not None:
        if timeout <= 0:
            raise ValueError(f"Timeout must be positive, got {timeout}")
        return float(timeout)
    if operation is not None:
        return OPERATION_TIMEOUTS.get(operation.lower(), DEFAULT_TIMEOUT)

    # Inspect the first non-flag argument in `args` to infer operation timeout
    idx = 0
    while idx < len(args):
        token = args[idx]
        if token == "-s" and idx + 1 < len(args):
            idx += 2
            continue
        if token.startswith("-"):
            idx += 1
            continue
        return OPERATION_TIMEOUTS.get(token.lower(), DEFAULT_TIMEOUT)

    return DEFAULT_TIMEOUT


def _normalize_invocation(
    first: str | os.PathLike[str] | Sequence[str],
    second: Sequence[str] | None,
    adb_path_kw: str | os.PathLike[str] | None,
) -> tuple[str, list[str]]:
    """Support both `run_adb(adb_path, args)` and `run_adb(args, adb_path=...)` call forms."""
    if isinstance(first, (str, os.PathLike)):
        resolved_adb = os.fspath(first)
        if second is None:
            raise ValueError("ADB command arguments (`args`) must be provided.")
        if isinstance(second, (str, bytes)):
            cmd_args = [str(second)]
        else:
            cmd_args = [str(a) for a in second]
    else:
        if second is not None:
            raise TypeError("Unexpected positional argument when `args` sequence is passed first.")
        cmd_args = [str(a) for a in first]
        resolved_adb = os.fspath(adb_path_kw) if adb_path_kw is not None else find_adb()

    if not resolved_adb or "\x00" in resolved_adb:
        raise ValueError("Invalid ADB binary path.")
    if not cmd_args:
        raise ValueError("ADB argument list cannot be empty.")
    for arg in cmd_args:
        if "\x00" in arg:
            raise ValueError("ADB argument contains forbidden NUL byte.")

    return resolved_adb, cmd_args


def run_adb(
    first: str | os.PathLike[str] | Sequence[str],
    args: Sequence[str] | None = None,
    *,
    serial: str | None = None,
    adb_path: str | os.PathLike[str] | None = None,
    timeout: float | None = None,
    operation: str | None = None,
    env: Mapping[str, str] | None = None,
    check: bool = False,
) -> AdbResult:
    """Execute `adb` inside an argument-array sandbox (`shell=False`) with hard timeouts.

    Can be called either as:
      - `run_adb(adb_path, ["devices", "-l"], serial=..., timeout=...)`
      - `run_adb(["devices", "-l"], adb_path=..., serial=..., timeout=...)`

    Raises:
        InvalidSerialError: If `serial` (or an inline `-s <serial>`) fails validation.
        AdbTimeoutError: If the command exceeds its hard timeout (`5s`/`15s`/`30s`).
        AdbCommandError: If `check=True` and the subprocess exits non-zero.
    """
    resolved_adb, cmd_args = _normalize_invocation(first, args, adb_path)

    # Validate inline `-s <serial>` if caller placed it in `cmd_args`
    for idx, token in enumerate(cmd_args):
        if token == "-s":
            if idx + 1 >= len(cmd_args):
                raise InvalidSerialError("Missing serial argument after '-s'.")
            validate_serial(cmd_args[idx + 1])

    full_cmd: list[str] = [resolved_adb]
    if serial is not None:
        validated_serial = validate_serial(serial)
        full_cmd.extend(["-s", validated_serial])
    full_cmd.extend(cmd_args)

    effective_timeout = resolve_timeout(cmd_args, timeout=timeout, operation=operation)
    child_env = sanitize_env(env)

    try:
        completed = subprocess.run(
            full_cmd,
            shell=False,
            capture_output=True,
            text=True,
            timeout=effective_timeout,
            env=child_env,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise AdbTimeoutError(
            f"ADB command timed out after {effective_timeout}s: {' '.join(full_cmd)}"
        ) from exc

    stdout_str = (
        completed.stdout
        if isinstance(completed.stdout, str)
        else (completed.stdout or b"").decode("utf-8", "replace")
    )
    stderr_str = (
        completed.stderr
        if isinstance(completed.stderr, str)
        else (completed.stderr or b"").decode("utf-8", "replace")
    )

    result = AdbResult(
        args=list(full_cmd),
        returncode=completed.returncode,
        stdout=stdout_str,
        stderr=stderr_str,
    )

    if check and not result.ok:
        raise AdbCommandError(
            f"ADB command failed with exit code {result.returncode}: {result.stderr.strip()}",
            result=result,
        )

    return result


class AdbRunner:
    """High-level bound runner for executing sandboxed `adb` commands."""

    def __init__(self, adb_path: str | os.PathLike[str] | None = None) -> None:
        self.adb_path: str = os.fspath(adb_path) if adb_path is not None else find_adb()

    def run(
        self,
        args: Sequence[str],
        *,
        serial: str | None = None,
        timeout: float | None = None,
        operation: str | None = None,
        env: Mapping[str, str] | None = None,
        check: bool = False,
    ) -> AdbResult:
        """Run an arbitrary allowlisted `adb` command array."""
        return run_adb(
            self.adb_path,
            args,
            serial=serial,
            timeout=timeout,
            operation=operation,
            env=env,
            check=check,
        )

    def status_cmd(
        self,
        args: Sequence[str],
        *,
        serial: str | None = None,
        env: Mapping[str, str] | None = None,
    ) -> AdbResult:
        """Run a fast status/discovery command with the 5s hard timeout."""
        return self.run(args, serial=serial, timeout=TIMEOUT_STATUS, operation="status", env=env)

    def pull(
        self,
        remote_path: str,
        local_path: str | os.PathLike[str],
        *,
        serial: str | None = None,
        env: Mapping[str, str] | None = None,
    ) -> AdbResult:
        """Run `adb pull` with the 15s hard timeout."""
        return self.run(
            ["pull", remote_path, os.fspath(local_path)],
            serial=serial,
            timeout=TIMEOUT_PULL,
            operation="pull",
            env=env,
        )

    def pair(
        self,
        endpoint: str,
        pairing_code: str,
        *,
        env: Mapping[str, str] | None = None,
    ) -> AdbResult:
        """Run `adb pair <endpoint> <code>` with the 30s hard timeout."""
        return self.run(
            ["pair", endpoint, pairing_code],
            timeout=TIMEOUT_PAIR,
            operation="pair",
            env=env,
        )
