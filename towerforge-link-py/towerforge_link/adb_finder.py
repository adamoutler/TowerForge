"""Hardened system ADB binary locator and permission/ownership verifier.

Locates an existing host installation of Android Debug Bridge (`adb`) without
fetching binaries over the network. Enforces filesystem ownership, mode-bit
checks (rejecting world-writable binaries), and `adb version` verification
using argument-array subprocess execution with `shell=False`.
"""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
from typing import Callable, Mapping, Sequence

ENV_ADB_PATH = "TOWERFORGE_ADB_PATH"
VERSION_TIMEOUT_SECONDS = 5
ADB_VERSION_PREFIX = "Android Debug Bridge"

MACOS_FALLBACK_PATHS: tuple[str, ...] = (
    "~/Library/Android/sdk/platform-tools/adb",
    "/opt/homebrew/bin/adb",
    "/usr/local/bin/adb",
)

LINUX_FALLBACK_PATHS: tuple[str, ...] = (
    "~/Android/Sdk/platform-tools/adb",
    "/usr/bin/adb",
    "/usr/lib/android-sdk/platform-tools/adb",
    "/snap/bin/adb",
)

_SCRUBBED_ENV_KEYS: frozenset[str] = frozenset(
    {
        "LD_PRELOAD",
        "LD_LIBRARY_PATH",
        "LD_AUDIT",
        "DYLD_INSERT_LIBRARIES",
        "DYLD_LIBRARY_PATH",
        "DYLD_FRAMEWORK_PATH",
    }
)


class AdbError(RuntimeError):
    """Base exception for all ADB discovery and execution failures."""


class AdbNotFoundError(AdbError, FileNotFoundError):
    """Raised when no valid system `adb` binary can be located."""


class UnsafeAdbBinaryError(AdbError, PermissionError):
    """Raised when a candidate `adb` binary fails ownership, permission, or verification checks."""


class InvalidAdbBinaryError(UnsafeAdbBinaryError):
    """Raised when a candidate `adb` binary fails `adb version` output verification."""


def _clean_version_env(base_env: Mapping[str, str] | None = None) -> dict[str, str]:
    """Return a copy of the environment with dynamic linker and Python injection vars removed."""
    source = os.environ if base_env is None else base_env
    cleaned: dict[str, str] = {}
    for key, value in source.items():
        if key in _SCRUBBED_ENV_KEYS or key.startswith("PYTHON"):
            continue
        cleaned[key] = value
    return cleaned


def _default_allowed_uids() -> set[int]:
    """Return the set of trusted file owner UIDs (root and current process user)."""
    uids = {0}
    if hasattr(os, "getuid"):
        uids.add(os.getuid())
    if hasattr(os, "geteuid"):
        uids.add(os.geteuid())
    return uids


def _expand_candidate(
    raw_path: str | os.PathLike[str],
    *,
    home_dir: str | os.PathLike[str] | None = None,
    env: Mapping[str, str] | None = None,
) -> str:
    """Expand leading `~` deterministically using `home_dir`, `env['HOME']`, or `os.path.expanduser`."""
    path_str = os.fspath(raw_path).strip()
    if path_str.startswith("~/") or path_str == "~":
        if home_dir is not None:
            base_home = os.fspath(home_dir)
            return os.path.join(base_home, path_str[2:]) if path_str.startswith("~/") else base_home
        if env is not None and "HOME" in env and env["HOME"]:
            base_home = env["HOME"]
            return os.path.join(base_home, path_str[2:]) if path_str.startswith("~/") else base_home
    return os.path.expanduser(path_str)


def validate_adb_binary(
    adb_path: str | os.PathLike[str],
    *,
    allowed_uids: set[int] | None = None,
    verify_version: bool = True,
    env: Mapping[str, str] | None = None,
) -> str:
    """Validate that `adb_path` is a safe, properly owned executable and outputs a valid version.

    Raises:
        AdbNotFoundError: If the path does not exist.
        UnsafeAdbBinaryError: If the binary is world-writable, not owned by root/current user,
            not a regular executable file, or fails `adb version` verification.
    """
    candidate = os.fspath(adb_path)
    if not candidate or "\x00" in candidate:
        raise UnsafeAdbBinaryError("Invalid empty or NUL-containing ADB binary path.")

    try:
        link_stat = os.lstat(candidate)
        target_stat = os.stat(candidate)
    except FileNotFoundError as exc:
        raise AdbNotFoundError(f"ADB binary does not exist: {candidate}") from exc
    except OSError as exc:
        raise UnsafeAdbBinaryError(f"Unable to stat ADB binary '{candidate}': {exc}") from exc

    if not stat.S_ISREG(target_stat.st_mode):
        raise UnsafeAdbBinaryError(f"ADB binary path is not a regular file: {candidate}")

    if target_stat.st_mode & stat.S_IWOTH:
        mode_oct = oct(stat.S_IMODE(target_stat.st_mode))
        raise UnsafeAdbBinaryError(
            f"Refusing to execute world-writable ADB binary ({mode_oct}): {candidate}"
        )

    trusted_uids = _default_allowed_uids() if allowed_uids is None else set(allowed_uids)
    if target_stat.st_uid not in trusted_uids:
        raise UnsafeAdbBinaryError(
            f"Refusing to execute ADB binary owned by untrusted UID {target_stat.st_uid} "
            f"(allowed UIDs: {sorted(trusted_uids)}): {candidate}"
        )
    if link_stat.st_uid not in trusted_uids:
        raise UnsafeAdbBinaryError(
            f"Refusing to follow ADB symlink owned by untrusted UID {link_stat.st_uid}: {candidate}"
        )

    exec_bits = stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH
    if not (target_stat.st_mode & exec_bits):
        raise UnsafeAdbBinaryError(f"ADB binary is not marked executable: {candidate}")

    if verify_version:
        try:
            proc = subprocess.run(
                [candidate, "version"],
                shell=False,
                capture_output=True,
                text=True,
                timeout=VERSION_TIMEOUT_SECONDS,
                env=_clean_version_env(env),
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise InvalidAdbBinaryError(
                f"ADB binary timed out during version verification ({VERSION_TIMEOUT_SECONDS}s): {candidate}"
            ) from exc
        except OSError as exc:
            raise UnsafeAdbBinaryError(
                f"Failed to execute ADB binary for version verification '{candidate}': {exc}"
            ) from exc

        stdout_text = proc.stdout if isinstance(proc.stdout, str) else (proc.stdout or b"").decode("utf-8", "replace")
        stderr_text = proc.stderr if isinstance(proc.stderr, str) else (proc.stderr or b"").decode("utf-8", "replace")
        combined = f"{stdout_text}\n{stderr_text}".strip()

        if proc.returncode != 0 or ADB_VERSION_PREFIX not in combined:
            raise InvalidAdbBinaryError(
                f"ADB binary '{candidate}' failed version check (exit={proc.returncode}): {combined[:200]}"
            )

    return candidate


def get_platform_fallback_paths(
    platform_name: str | None = None,
    *,
    home_dir: str | os.PathLike[str] | None = None,
    env: Mapping[str, str] | None = None,
) -> list[str]:
    """Return ordered fallback candidate paths for macOS and Linux SDK/distro locations."""
    plat = (platform_name or sys.platform).lower()
    if plat.startswith("darwin") or plat == "macos":
        raw_paths = (*MACOS_FALLBACK_PATHS, *LINUX_FALLBACK_PATHS)
    else:
        raw_paths = (*LINUX_FALLBACK_PATHS, *MACOS_FALLBACK_PATHS)

    expanded: list[str] = []
    for raw in raw_paths:
        path_str = _expand_candidate(raw, home_dir=home_dir, env=env)
        if path_str not in expanded:
            expanded.append(path_str)
    return expanded


def find_adb(
    explicit_path: str | os.PathLike[str] | None = None,
    *,
    adb_path: str | os.PathLike[str] | None = None,
    env: Mapping[str, str] | None = None,
    which_fn: Callable[[str], str | None] | None = None,
    platform_name: str | None = None,
    home_dir: str | os.PathLike[str] | None = None,
    fallback_paths: Sequence[str | os.PathLike[str]] | None = None,
    allowed_uids: set[int] | None = None,
    verify_version: bool = True,
) -> str:
    """Locate and validate a system `adb` binary using the hardened search order.

    Search order:
      1. Explicit `--adb-path` CLI argument (`explicit_path` / `adb_path`) or
         `TOWERFORGE_ADB_PATH` environment variable.
      2. `shutil.which("adb")` on `PATH`.
      3. macOS SDK/Homebrew paths (`~/Library/Android/sdk/platform-tools/adb`,
         `/opt/homebrew/bin/adb`, `/usr/local/bin/adb`).
      4. Linux SDK/distro paths (`~/Android/Sdk/platform-tools/adb`, `/usr/bin/adb`,
         `/usr/lib/android-sdk/platform-tools/adb`, `/snap/bin/adb`).

    Raises:
        UnsafeAdbBinaryError: If a discovered or explicit binary fails permission,
            ownership, or version verification checks.
        AdbNotFoundError: If no candidate binary exists.
    """
    active_env = os.environ if env is None else env

    # 1. Explicit CLI flag (--adb-path) or TOWERFORGE_ADB_PATH environment variable
    chosen_explicit = explicit_path if explicit_path is not None else adb_path
    if chosen_explicit is not None and os.fspath(chosen_explicit).strip():
        expanded_explicit = _expand_candidate(chosen_explicit, home_dir=home_dir, env=active_env)
        return validate_adb_binary(
            expanded_explicit,
            allowed_uids=allowed_uids,
            verify_version=verify_version,
            env=active_env,
        )

    env_override = active_env.get(ENV_ADB_PATH, "").strip()
    if env_override:
        expanded_env = _expand_candidate(env_override, home_dir=home_dir, env=active_env)
        return validate_adb_binary(
            expanded_env,
            allowed_uids=allowed_uids,
            verify_version=verify_version,
            env=active_env,
        )

    # 2. shutil.which("adb")
    if which_fn is not None:
        which_candidate = which_fn("adb")
    elif env is not None and "PATH" in env:
        which_candidate = shutil.which("adb", path=env.get("PATH"))
    else:
        which_candidate = shutil.which("adb")

    if which_candidate:
        return validate_adb_binary(
            which_candidate,
            allowed_uids=allowed_uids,
            verify_version=verify_version,
            env=active_env,
        )

    # 3 & 4. macOS and Linux SDK/distro fallback paths
    if fallback_paths is not None:
        candidates = [
            _expand_candidate(p, home_dir=home_dir, env=active_env) for p in fallback_paths
        ]
    else:
        candidates = get_platform_fallback_paths(
            platform_name=platform_name,
            home_dir=home_dir,
            env=active_env,
        )

    for candidate in candidates:
        if not os.path.lexists(candidate):
            continue
        return validate_adb_binary(
            candidate,
            allowed_uids=allowed_uids,
            verify_version=verify_version,
            env=active_env,
        )

    raise AdbNotFoundError(
        "No valid 'adb' binary found via --adb-path, TOWERFORGE_ADB_PATH, PATH, "
        "or platform SDK locations."
    )
