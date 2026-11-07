"""Unit tests for USB interface ownership inspector (`usb_owner.py`), `GET /usb/owner`, and `udev-rules` CLI."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
import http.client
import json
import os
from pathlib import Path
import subprocess
import sys
import threading

import pytest

# Ensure `towerforge_link` is importable when pytest is invoked from repository root `/workspace`
PACKAGE_ROOT = Path(__file__).resolve().parents[1]
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from towerforge_link.__main__ import main as cli_main  # noqa: E402
from towerforge_link.http_server import (  # noqa: E402
    TowerForgeHTTPServer,
    create_server,
)
from towerforge_link.usb_owner import (  # noqa: E402
    UDEV_RULE_CONTENT,
    UDEV_RULE_FILENAME,
    format_udev_rules_output,
    inspect_linux_usb_owner,
    inspect_macos_usb_owner,
    inspect_usb_owner,
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


def _raw_http_get(
    port: int,
    path: str,
    *,
    headers: dict[str, str],
) -> tuple[int, dict[str, str], bytes]:
    """Send an HTTP/1.1 GET request to `127.0.0.1:port` with explicit headers."""
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5.0)
    try:
        conn.putrequest("GET", path, skip_host=True, skip_accept_encoding=True)
        for k, v in headers.items():
            conn.putheader(k, v)
        conn.endheaders()
        resp = conn.getresponse()
        resp_headers = {k.lower(): v for k, v in resp.getheaders()}
        resp_body = resp.read()
        return resp.status, resp_headers, resp_body
    finally:
        conn.close()


def _create_synthetic_adb_sysfs(
    sysfs_root: Path,
    *,
    device_name: str = "1-4",
    vid: str = "18d1",
    pid: str = "4ee2",
    busnum: int = 1,
    devnum: int = 12,
) -> Path:
    """Create a synthetic Linux `/sys/bus/usb/devices` device + `ff/42/01` interface."""
    dev_dir = sysfs_root / device_name
    dev_dir.mkdir(parents=True, exist_ok=True)
    (dev_dir / "idVendor").write_text(f"{vid}\n", encoding="utf-8")
    (dev_dir / "idProduct").write_text(f"{pid}\n", encoding="utf-8")
    (dev_dir / "busnum").write_text(f"{busnum}\n", encoding="utf-8")
    (dev_dir / "devnum").write_text(f"{devnum}\n", encoding="utf-8")

    # Also create a non-ADB HID interface (03/01/01) to verify filtering
    hid_iface = sysfs_root / f"{device_name}:1.0"
    hid_iface.mkdir(parents=True, exist_ok=True)
    (hid_iface / "bInterfaceClass").write_text("03\n", encoding="utf-8")
    (hid_iface / "bInterfaceSubClass").write_text("01\n", encoding="utf-8")
    (hid_iface / "bInterfaceProtocol").write_text("01\n", encoding="utf-8")

    # Create the Android ADB interface (ff/42/01)
    adb_iface = sysfs_root / f"{device_name}:1.1"
    adb_iface.mkdir(parents=True, exist_ok=True)
    (adb_iface / "bInterfaceClass").write_text("ff\n", encoding="utf-8")
    (adb_iface / "bInterfaceSubClass").write_text("42\n", encoding="utf-8")
    (adb_iface / "bInterfaceProtocol").write_text("01\n", encoding="utf-8")

    return adb_iface


def test_inspect_linux_usb_owner_identifies_adb_holder_from_synthetic_sysfs_and_procfs(
    tmp_path: Path,
) -> None:
    """Test Case 1: `inspect_linux_usb_owner()` against a synthetic sysfs + procfs tree identifies `ff/42/01` on `busnum=1, devnum=12` held by `/proc/4412/fd/9 -> /dev/bus/usb/001/012` with `comm="adb"` and returns `holders=[{"pid": 4412, "comm": "adb"}]` and `recommended_action="adb kill-server"`."""
    sysfs_root = tmp_path / "sys" / "bus" / "usb" / "devices"
    proc_root = tmp_path / "proc"
    _create_synthetic_adb_sysfs(
        sysfs_root,
        vid="18d1",
        pid="4ee2",
        busnum=1,
        devnum=12,
    )

    # Create same-UID process 4412 (`comm="adb"`) holding `/dev/bus/usb/001/012` on fd 9
    pid_4412_fd = proc_root / "4412" / "fd"
    pid_4412_fd.mkdir(parents=True, exist_ok=True)
    (proc_root / "4412" / "comm").write_text("adb\n", encoding="utf-8")
    os.symlink("/dev/bus/usb/001/012", pid_4412_fd / "9")
    os.symlink("/dev/null", pid_4412_fd / "0")

    # Create a different-UID process 8899 holding the same device node -> must be ignored
    pid_8899_fd = proc_root / "8899" / "fd"
    pid_8899_fd.mkdir(parents=True, exist_ok=True)
    (proc_root / "8899" / "comm").write_text("other-user-adb\n", encoding="utf-8")
    (proc_root / "8899" / "status").write_text("Name:\tother-user-adb\nUid:\t99999\t99999\t99999\t99999\n", encoding="utf-8")
    os.symlink("/dev/bus/usb/001/012", pid_8899_fd / "4")

    result = inspect_linux_usb_owner(
        vid="18d1",
        pid="4ee2",
        sysfs_root=sysfs_root,
        proc_root=proc_root,
        access_fn=lambda path, mode: True,
    )

    assert result["ok"] is True
    assert result["platform"] == "linux"
    assert result["vid"] == "18d1"
    assert result["pid"] == "4ee2"
    assert result["busnum"] == 1
    assert result["devnum"] == 12
    assert result["devnode"] == "/dev/bus/usb/001/012"
    assert result["devnode_writable"] is True
    assert result["busy"] is True
    assert result["holders"] == [{"pid": 4412, "comm": "adb"}]
    assert result["recommended_action"] == "adb kill-server"


def test_inspect_linux_usb_owner_detects_non_writable_devnode_and_recommends_udev_rules(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Test Case 2: `inspect_linux_usb_owner()` detects `devnode_writable=False` when `os.access` returns `False` and recommends installing `51-android-adb-uaccess.rules`."""
    sysfs_root = tmp_path / "sys" / "bus" / "usb" / "devices"
    proc_root = tmp_path / "proc"
    proc_root.mkdir(parents=True, exist_ok=True)

    _create_synthetic_adb_sysfs(
        sysfs_root,
        vid="18d1",
        pid="4ee7",
        busnum=1,
        devnum=20,
    )

    checked_paths: list[tuple[str, int]] = []

    def _fake_access(path: str | os.PathLike[str], mode: int) -> bool:
        checked_paths.append((os.fspath(path), mode))
        return False

    monkeypatch.setattr(os, "access", _fake_access)

    result = inspect_linux_usb_owner(
        vid="18d1",
        pid="4ee7",
        sysfs_root=sysfs_root,
        proc_root=proc_root,
    )

    assert checked_paths == [("/dev/bus/usb/001/020", os.R_OK | os.W_OK)]
    assert result["ok"] is True
    assert result["platform"] == "linux"
    assert result["busnum"] == 1
    assert result["devnum"] == 20
    assert result["devnode"] == "/dev/bus/usb/001/020"
    assert result["devnode_writable"] is False
    assert result["busy"] is False
    assert result["holders"] == []
    assert result["recommended_action"] is not None
    assert UDEV_RULE_FILENAME in result["recommended_action"]


def test_get_usb_owner_endpoint_returns_schema_expected_by_usb_diagnose_ts(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Test Case 3: `GET /usb/owner?vid=18d1&pid=4ee2` returns valid JSON matching the schema expected by `src/engine/usbDiagnose.ts`."""
    sysfs_root = tmp_path / "sys" / "bus" / "usb" / "devices"
    proc_root = tmp_path / "proc"
    _create_synthetic_adb_sysfs(
        sysfs_root,
        vid="18d1",
        pid="4ee2",
        busnum=1,
        devnum=12,
    )

    pid_dir = proc_root / "4412" / "fd"
    pid_dir.mkdir(parents=True, exist_ok=True)
    (proc_root / "4412" / "comm").write_text("adb\n", encoding="utf-8")
    os.symlink("/dev/bus/usb/001/012", pid_dir / "9")

    import towerforge_link.usb_owner as usb_owner_mod

    monkeypatch.setattr(
        usb_owner_mod,
        "inspect_usb_owner",
        lambda *, vid=None, pid=None, **kw: inspect_linux_usb_owner(
            vid=vid,
            pid=pid,
            sysfs_root=sysfs_root,
            proc_root=proc_root,
            access_fn=lambda _p, _m: True,
        ),
    )

    with _running_http_server() as srv:
        status, headers, body = _raw_http_get(
            srv.server_port,
            "/usb/owner?vid=18d1&pid=4ee2",
            headers={
                "Host": "127.0.0.1:47821",
                "Origin": "https://towerforge.hackedyour.info",
            },
        )
        assert status == 200
        assert headers.get("access-control-allow-origin") == "https://towerforge.hackedyour.info"
        payload = json.loads(body.decode("utf-8"))

        # Validate exact schema required by `UsbOwnerProbeResponse` in `src/engine/usbDiagnose.ts`
        assert payload["ok"] is True
        assert payload["platform"] == "linux"
        assert payload["vid"] == "18d1"
        assert payload["pid"] == "4ee2"
        assert payload["busnum"] == 1
        assert payload["devnum"] == 12
        assert payload["devnode"] == "/dev/bus/usb/001/012"
        assert payload["devnode_writable"] is True
        assert payload["busy"] is True
        assert isinstance(payload["holders"], list)
        assert payload["holders"] == [{"pid": 4412, "comm": "adb"}]
        assert payload["recommended_action"] == "adb kill-server"


def test_cli_udev_rules_outputs_uaccess_tag_with_zero_0666_permissions(
    capsys: pytest.CaptureFixture[str],
) -> None:
    """Test Case 4: CLI `udev-rules` outputs `TAG+=\"uaccess\"` rule content with zero `0666` permissions."""
    exit_code = cli_main(["udev-rules"])
    captured = capsys.readouterr()

    assert exit_code == 0
    assert 'SUBSYSTEM=="usb"' in captured.out
    assert 'ENV{DEVTYPE}=="usb_device"' in captured.out
    assert 'ENV{ID_USB_INTERFACES}=="*:ff4201:*"' in captured.out
    assert 'TAG+="uaccess"' in captured.out
    assert UDEV_RULE_FILENAME in captured.out
    assert "udevadm control --reload-rules" in captured.out
    assert "0666" not in captured.out
    assert "0666" not in UDEV_RULE_CONTENT
    assert "0666" not in format_udev_rules_output(rule_only=True)


def test_inspect_macos_usb_owner_and_browser_holder_detection(
    tmp_path: Path,
) -> None:
    """Verify macOS `pgrep` inspector and Linux browser-tab holder detection."""
    # 1. macOS inspector via injectable runner (`shell=False`)
    recorded_cmds: list[list[str]] = []

    def _fake_runner(cmd: list[str] | tuple[str, ...]) -> subprocess.CompletedProcess[str]:
        recorded_cmds.append(list(cmd))
        return subprocess.CompletedProcess(
            args=list(cmd),
            returncode=0,
            stdout="5120\n",
            stderr="",
        )

    mac_res = inspect_usb_owner(
        vid="0x18D1",
        pid="0x4EE7",
        platform_name="darwin",
        uid=501,
        run_cmd_fn=_fake_runner,
    )
    assert recorded_cmds == [["pgrep", "-u", "501", "adb"]]
    assert mac_res["ok"] is True
    assert mac_res["platform"] == "macos"
    assert mac_res["vid"] == "18d1"
    assert mac_res["pid"] == "4ee7"
    assert mac_res["holders"] == [{"pid": 5120, "comm": "adb"}]
    assert mac_res["recommended_action"] == "adb kill-server"

    # 2. Linux browser-tab holder (`comm="chrome"`) recommends closing the other browser tab
    sysfs_root = tmp_path / "sys_chrome"
    proc_root = tmp_path / "proc_chrome"
    _create_synthetic_adb_sysfs(sysfs_root, vid="18d1", pid="4ee7", busnum=1, devnum=20)
    chrome_fd = proc_root / "7721" / "fd"
    chrome_fd.mkdir(parents=True, exist_ok=True)
    (proc_root / "7721" / "comm").write_text("chrome\n", encoding="utf-8")
    os.symlink("/dev/bus/usb/001/020", chrome_fd / "42")

    browser_res = inspect_linux_usb_owner(
        vid="18d1",
        pid="4ee7",
        sysfs_root=sysfs_root,
        proc_root=proc_root,
        access_fn=lambda _p, _m: True,
    )
    assert browser_res["holders"] == [{"pid": 7721, "comm": "chrome"}]
    assert browser_res["recommended_action"] == "Close the other browser tab holding the USB device"
