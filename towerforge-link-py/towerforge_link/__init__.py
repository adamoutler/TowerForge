"""TowerForge Link Python companion package (`towerforge_link`).

Zero-dependency Python 3.10+ standard-library implementation for macOS and Linux
that discovers system `adb` installations and executes sandboxed `adb` commands.
"""

from __future__ import annotations

from .adb_finder import (
    ADB_VERSION_PREFIX,
    ENV_ADB_PATH,
    LINUX_FALLBACK_PATHS,
    MACOS_FALLBACK_PATHS,
    VERSION_TIMEOUT_SECONDS,
    AdbError,
    AdbNotFoundError,
    InvalidAdbBinaryError,
    UnsafeAdbBinaryError,
    find_adb,
    get_platform_fallback_paths,
    validate_adb_binary,
)
from .adb_runner import (
    DEFAULT_TIMEOUT,
    OPERATION_TIMEOUTS,
    SERIAL_RE,
    TIMEOUT_PAIR,
    TIMEOUT_PULL,
    TIMEOUT_STATUS,
    AdbCommandError,
    AdbResult,
    AdbRunner,
    AdbTimeoutError,
    InvalidSerialError,
    resolve_timeout,
    run_adb,
    sanitize_env,
    validate_serial,
)

__version__ = "0.1.0"

__all__ = [
    "__version__",
    "ADB_VERSION_PREFIX",
    "DEFAULT_TIMEOUT",
    "ENV_ADB_PATH",
    "LINUX_FALLBACK_PATHS",
    "MACOS_FALLBACK_PATHS",
    "OPERATION_TIMEOUTS",
    "SERIAL_RE",
    "TIMEOUT_PAIR",
    "TIMEOUT_PULL",
    "TIMEOUT_STATUS",
    "VERSION_TIMEOUT_SECONDS",
    "AdbCommandError",
    "AdbError",
    "AdbNotFoundError",
    "AdbResult",
    "AdbRunner",
    "AdbTimeoutError",
    "InvalidAdbBinaryError",
    "InvalidSerialError",
    "UnsafeAdbBinaryError",
    "find_adb",
    "get_platform_fallback_paths",
    "resolve_timeout",
    "run_adb",
    "sanitize_env",
    "validate_adb_binary",
    "validate_serial",
]
