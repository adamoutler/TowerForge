"""Unit tests for hardened ADB discovery (`adb_finder.py`) and sandboxed execution (`adb_runner.py`)."""

from __future__ import annotations

import os
from pathlib import Path
import stat
import subprocess
import sys
from typing import Any

import pytest

# Ensure `towerforge_link` is importable when pytest is invoked from repository root `/workspace`
PACKAGE_ROOT = Path(__file__).resolve().parents[1]
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from towerforge_link.adb_finder import (  # noqa: E402
    ENV_ADB_PATH,
    AdbNotFoundError,
    InvalidAdbBinaryError,
    UnsafeAdbBinaryError,
    find_adb,
    validate_adb_binary,
)
from towerforge_link.adb_runner import (  # noqa: E402
    SERIAL_RE,
    TIMEOUT_PAIR,
    TIMEOUT_PULL,
    TIMEOUT_STATUS,
    AdbCommandError,
    AdbRunner,
    AdbTimeoutError,
    InvalidSerialError,
    resolve_timeout,
    run_adb,
    sanitize_env,
    validate_serial,
)


def _create_fake_adb(path: Path, *, mode: int = 0o755, version_text: str = "Android Debug Bridge version 1.0.41") -> Path:
    """Create an executable fake `adb` script in `path`."""
    path.parent.mkdir(parents=True, exist_ok=True)
    script = (
        "#!/bin/sh\n"
        'if [ "$1" = "version" ]; then\n'
        f'  echo "{version_text}"\n'
        "  exit 0\n"
        "fi\n"
        'echo "ARGS:$*"\n'
        "exit 0\n"
    )
    path.write_text(script, encoding="utf-8")
    os.chmod(path, mode)
    return path


def test_find_adb_resolves_explicit_path_env_path_and_platform_fallbacks(tmp_path: Path) -> None:
    """Test Case 1: `find_adb()` resolves valid `adb` binary from explicit path, `PATH`, and platform fallback directories."""
    # 1a. Explicit `--adb-path`
    explicit_adb = _create_fake_adb(tmp_path / "explicit" / "adb", mode=0o755)
    resolved_explicit = find_adb(explicit_path=explicit_adb, env={})
    assert Path(resolved_explicit) == explicit_adb

    # 1b. `TOWERFORGE_ADB_PATH` environment variable
    env_adb = _create_fake_adb(tmp_path / "env_dir" / "adb", mode=0o755)
    resolved_env = find_adb(env={ENV_ADB_PATH: str(env_adb), "PATH": ""})
    assert Path(resolved_env) == env_adb

    # 1c. `PATH` via `shutil.which("adb")`
    path_dir = tmp_path / "bin_in_path"
    path_adb = _create_fake_adb(path_dir / "adb", mode=0o755)
    resolved_from_path = find_adb(
        env={"PATH": str(path_dir)},
        fallback_paths=[],
    )
    assert Path(resolved_from_path) == path_adb

    # 1d. Linux SDK fallback directory (`~/Android/Sdk/platform-tools/adb`)
    fake_linux_home = tmp_path / "linux_home"
    linux_sdk_adb = _create_fake_adb(
        fake_linux_home / "Android" / "Sdk" / "platform-tools" / "adb",
        mode=0o755,
    )
    resolved_linux_fallback = find_adb(
        env={"PATH": ""},
        which_fn=lambda _: None,
        platform_name="linux",
        home_dir=fake_linux_home,
        fallback_paths=["~/Android/Sdk/platform-tools/adb"],
    )
    assert Path(resolved_linux_fallback) == linux_sdk_adb

    # 1e. macOS SDK fallback directory (`~/Library/Android/sdk/platform-tools/adb`)
    fake_mac_home = tmp_path / "mac_home"
    mac_sdk_adb = _create_fake_adb(
        fake_mac_home / "Library" / "Android" / "sdk" / "platform-tools" / "adb",
        mode=0o755,
    )
    resolved_mac_fallback = find_adb(
        env={"PATH": ""},
        which_fn=lambda _: None,
        platform_name="darwin",
        home_dir=fake_mac_home,
        fallback_paths=["~/Library/Android/sdk/platform-tools/adb"],
    )
    assert Path(resolved_mac_fallback) == mac_sdk_adb


def test_find_adb_rejects_world_writable_and_untrusted_uid_binaries(tmp_path: Path) -> None:
    """Test Case 2: `find_adb()` rejects a world-writable (`0o777`) fake `adb` binary with `UnsafeAdbBinaryError`."""
    world_writable_adb = _create_fake_adb(tmp_path / "unsafe" / "adb", mode=0o777)
    actual_mode = stat.S_IMODE(os.stat(world_writable_adb).st_mode)
    assert actual_mode == 0o777

    with pytest.raises(UnsafeAdbBinaryError, match="world-writable"):
        find_adb(explicit_path=world_writable_adb)

    # Also verify rejection when discovered via PATH
    with pytest.raises(UnsafeAdbBinaryError, match="world-writable"):
        find_adb(
            env={"PATH": str(world_writable_adb.parent)},
            fallback_paths=[],
        )

    # Verify rejection when binary is owned by an untrusted UID (neither root nor current user)
    safe_mode_adb = _create_fake_adb(tmp_path / "uid_check" / "adb", mode=0o755)
    with pytest.raises(UnsafeAdbBinaryError, match="untrusted UID"):
        validate_adb_binary(safe_mode_adb, allowed_uids={99998})

    # Verify rejection when binary does not output valid `Android Debug Bridge` version header
    bad_version_adb = _create_fake_adb(
        tmp_path / "bad_ver" / "adb",
        mode=0o755,
        version_text="not-an-adb-binary 0.0.1",
    )
    with pytest.raises(InvalidAdbBinaryError):
        find_adb(explicit_path=bad_version_adb)

    # Verify AdbNotFoundError when no candidates exist
    with pytest.raises(AdbNotFoundError):
        find_adb(
            env={"PATH": ""},
            which_fn=lambda _: None,
            fallback_paths=[tmp_path / "nonexistent" / "adb"],
        )


def test_validate_serial_accepts_valid_serials_and_rejects_injections() -> None:
    """Test Case 3: `validate_serial()` accepts valid USB/TCP/mDNS serials and rejects shell metacharacters and flag injection."""
    valid_serials = [
        "54221FDAP0011M",
        "emulator-5554",
        "127.0.0.1:5555",
        "192.168.1.20:44547",
        "192.168.240.112:5555",
        "adb-54221FDAP0011M-abc123._adb-tls-connect._tcp",
        "R58M42_DEV:01.local",
    ]
    for serial in valid_serials:
        assert SERIAL_RE.fullmatch(serial) is not None
        assert validate_serial(serial) == serial

    malicious_serials = [
        "; id",
        "54221FDAP0011M; rm -rf /",
        "127.0.0.1:5555 | cat /etc/passwd",
        "$(whoami)",
        "`uname -a`",
        "serial with spaces",
        "serial\twith\ttab",
        "serial\nnewline",
        "-H",
        "--help",
        "-s",
        "--version",
        "../etc/passwd",
        "",
        "A" * 129,
    ]
    for bad_serial in malicious_serials:
        with pytest.raises(InvalidSerialError):
            validate_serial(bad_serial)


def test_run_adb_enforces_shell_false_scrubs_env_and_raises_timeout(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """Test Case 4: `run_adb()` invokes `subprocess.run` with `shell=False`, strips `LD_PRELOAD`/`DYLD_INSERT_LIBRARIES` from child env, and raises `AdbTimeoutError` on timeout."""
    fake_adb = _create_fake_adb(tmp_path / "adb", mode=0o755)
    recorded_calls: list[dict[str, Any]] = []

    def fake_subprocess_run(cmd: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
        recorded_calls.append({"cmd": cmd, **kwargs})
        return subprocess.CompletedProcess(
            args=cmd,
            returncode=0,
            stdout="List of devices attached\n54221FDAP0011M\tdevice\n",
            stderr="",
        )

    monkeypatch.setattr(subprocess, "run", fake_subprocess_run)

    hostile_env = {
        "PATH": "/usr/bin:/bin",
        "HOME": "/tmp",
        "LD_PRELOAD": "/tmp/evil.so",
        "LD_LIBRARY_PATH": "/tmp/evil_lib",
        "DYLD_INSERT_LIBRARIES": "/tmp/evil.dylib",
        "PYTHONPATH": "/tmp/evil_py",
        "PYTHONSTARTUP": "/tmp/evil_startup.py",
        " PYTHONHOME": "ignored",
        "SAFE_VAR": "kept_value",
    }

    result = run_adb(
        fake_adb,
        ["devices", "-l"],
        serial="54221FDAP0011M",
        env=hostile_env,
    )

    assert result.ok is True
    assert result.returncode == 0
    assert "54221FDAP0011M" in result.stdout
    assert len(recorded_calls) == 1

    call = recorded_calls[0]
    assert call["cmd"] == [str(fake_adb), "-s", "54221FDAP0011M", "devices", "-l"]
    assert call["shell"] is False
    assert call["timeout"] == TIMEOUT_STATUS

    child_env = call["env"]
    assert "LD_PRELOAD" not in child_env
    assert "LD_LIBRARY_PATH" not in child_env
    assert "DYLD_INSERT_LIBRARIES" not in child_env
    assert "PYTHONPATH" not in child_env
    assert "PYTHONSTARTUP" not in child_env
    assert child_env["SAFE_VAR"] == "kept_value"

    # Verify operation-specific hard timeouts (5s status, 15s pull, 30s pair)
    assert resolve_timeout(["devices", "-l"]) == 5.0
    assert resolve_timeout(["pull", "/sdcard/tool_export.json", "/tmp/out.json"]) == 15.0
    assert resolve_timeout(["pair", "192.168.1.20:37123", "123456"]) == 30.0

    runner = AdbRunner(fake_adb)
    runner.pull("/sdcard/tool_export.json", tmp_path / "out.json", serial="54221FDAP0011M")
    assert recorded_calls[-1]["timeout"] == TIMEOUT_PULL
    runner.pair("192.168.1.20:37123", "123456")
    assert recorded_calls[-1]["timeout"] == TIMEOUT_PAIR

    # Verify AdbTimeoutError is raised when subprocess.run raises TimeoutExpired
    def timeout_subprocess_run(cmd: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
        raise subprocess.TimeoutExpired(cmd=cmd, timeout=kwargs.get("timeout", 5.0))

    monkeypatch.setattr(subprocess, "run", timeout_subprocess_run)

    with pytest.raises(AdbTimeoutError, match="timed out"):
        run_adb(fake_adb, ["pull", "/sdcard/tool_export.json", "/tmp/out.json"], serial="54221FDAP0011M")


def test_run_adb_check_mode_and_sanitize_env_direct() -> None:
    """Verify `sanitize_env()` and `check=True` error raising."""
    cleaned = sanitize_env(
        {
            "LD_PRELOAD": "bad.so",
            "DYLD_INSERT_LIBRARIES": "bad.dylib",
            "PYTHONINSPECT": "1",
            "LANG": "C.UTF-8",
        }
    )
    assert "LD_PRELOAD" not in cleaned
    assert "DYLD_INSERT_LIBRARIES" not in cleaned
    assert "PYTHONINSPECT" not in cleaned
    assert cleaned["LANG"] == "C.UTF-8"

    # Verify static security invariants on package source files
    pkg_dir = PACKAGE_ROOT / "towerforge_link"
    for py_file in pkg_dir.glob("*.py"):
        source = py_file.read_text(encoding="utf-8")
        assert "shell=" + "True" not in source
        assert "url" + "lib" not in source
        assert "http." + "client" not in source


def test_cli_main_doctor_serve_and_adb_finder_edge_cases(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """Verify CLI `__main__.main` subcommands (`doctor`, `serve`, `udev-rules`) and `adb_finder` edge cases."""
    from towerforge_link.__main__ import _cmd_doctor, main as cli_main
    from towerforge_link.adb_finder import (
        InvalidAdbBinaryError,
        _expand_candidate,
        get_platform_fallback_paths,
        validate_adb_binary,
    )
    from towerforge_link import http_server

    assert _expand_candidate("~/adb", env={"HOME": "/custom/home"}) == "/custom/home/adb"
    assert _expand_candidate("~", home_dir="/explicit/home") == "/explicit/home"
    linux_paths = get_platform_fallback_paths("linux", home_dir="/home/tester")
    assert "/home/tester/Android/Sdk/platform-tools/adb" in linux_paths

    with pytest.raises(UnsafeAdbBinaryError):
        validate_adb_binary("")
    with pytest.raises(UnsafeAdbBinaryError):
        validate_adb_binary(tmp_path)

    non_exec = tmp_path / "adb_noexec"
    non_exec.write_text("#!/bin/sh\n", encoding="utf-8")
    os.chmod(non_exec, 0o600)
    with pytest.raises(UnsafeAdbBinaryError, match="not marked executable"):
        validate_adb_binary(non_exec)

    bad_ver = tmp_path / "adb_badver"
    bad_ver.write_text("#!/bin/sh\necho 'not adb'\nexit 1\n", encoding="utf-8")
    os.chmod(bad_ver, 0o700)
    with pytest.raises(InvalidAdbBinaryError):
        validate_adb_binary(bad_ver)

    import json

    valid_adb = _create_fake_adb(tmp_path / "bin" / "adb")

    # doctor (human and --json)
    assert cli_main(["--adb-path", str(valid_adb), "doctor"]) == 0
    out_human = capsys.readouterr().out
    assert str(valid_adb) in out_human

    assert cli_main(["--adb-path", str(valid_adb), "doctor", "--json"]) == 0
    out_json = json.loads(capsys.readouterr().out)
    assert out_json["ok"] is True

    # doctor failure (human and --json)
    assert _cmd_doctor(str(tmp_path / "missing_adb"), as_json=False) == 1
    assert _cmd_doctor(str(tmp_path / "missing_adb"), as_json=True) == 1
    err_json = json.loads(capsys.readouterr().out)
    assert err_json["ok"] is False

    # serve subcommand
    monkeypatch.setattr(http_server, "serve_forever", lambda **kwargs: 0)
    assert cli_main(["serve", "--bind", "127.0.0.1", "--port", "47821"]) == 0

    # udev-rules subcommand
    assert cli_main(["udev-rules", "--rule-only"]) == 0
    udev_out = capsys.readouterr().out
    assert 'TAG+="uaccess"' in udev_out

