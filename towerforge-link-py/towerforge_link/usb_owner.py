"""Same-UID USB interface ownership inspector (`GET /usb/owner`) and Linux udev helper.

Inspects `/sys/bus/usb/devices` + `/proc/[pid]/fd` on Linux (or `pgrep`/`lsof` on macOS)
for processes owned by the current user (`os.getuid()`) that hold the Android ADB USB
interface (`0xFF/0x42/0x01`), checks `/dev/bus/usb/<BUS>/<DEV>` read/write access via
`os.access`, and outputs hardened `TAG+="uaccess"` udev rules (`REQ-P2-008`, `REQ-P3-008`).
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
import os
from pathlib import Path
import re
import subprocess
import sys
from typing import Any

DEFAULT_SYSFS_USB_ROOT = Path("/sys/bus/usb/devices")
DEFAULT_PROC_ROOT = Path("/proc")
DEFAULT_DEV_USB_ROOT = Path("/dev/bus/usb")

ADB_INTERFACE_CLASS = "ff"
ADB_INTERFACE_SUBCLASS = "42"
ADB_INTERFACE_PROTOCOL = "01"

UDEV_RULE_FILENAME = "51-android-adb-uaccess.rules"

UDEV_RULE_CONTENT = (
    "# TowerForge Link — Hardened Android ADB WebUSB udev rule\n"
    "# Grants the active local seat user access to USB devices exposing an\n"
    "# Android ADB interface (class 0xff, subclass 0x42, protocol 0x01).\n"
    'SUBSYSTEM=="usb", ENV{DEVTYPE}=="usb_device", ENV{ID_USB_INTERFACES}=="*:ff4201:*", TAG+="uaccess"\n'
)

UDEV_INSTALL_INSTRUCTIONS = (
    "# Installation Instructions (Linux):\n"
    f"#   sudo cp {UDEV_RULE_FILENAME} /etc/udev/rules.d/{UDEV_RULE_FILENAME} && "
    "sudo udevadm control --reload-rules && sudo udevadm trigger\n"
    "# Then unplug and reconnect your Android phone over USB.\n"
)

_HEX_ID_RE = re.compile(r"^[0-9a-f]{1,4}$")
_BROWSER_COMM_RE = re.compile(
    r"\b(chrome|chromium|msedge|edge|brave|vivaldi|opera|arc)\b",
    re.IGNORECASE,
)


def normalize_usb_hex_id(value: str | int | None) -> str | None:
    """Normalize an optional USB vendor/product ID into a 4-char lowercase hex string."""
    if value is None:
        return None
    if isinstance(value, int):
        if 0 <= value <= 0xFFFF:
            return f"{value:04x}"
        return None
    if isinstance(value, str):
        cleaned = value.strip().lower()
        if cleaned.startswith("0x"):
            cleaned = cleaned[2:]
        if not cleaned:
            return None
        if _HEX_ID_RE.fullmatch(cleaned):
            return cleaned.zfill(4)
        return cleaned
    return None


def _read_text_stripped(path: Path) -> str | None:
    """Read and strip a single-line sysfs/procfs file, returning `None` on any OS error."""
    try:
        return path.read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return None


def _normalize_hex_byte(raw: str | None) -> str | None:
    """Normalize a 1-byte sysfs hex attribute (`ff`, `0xff`, `42`, `01`) to 2-char lowercase hex."""
    if raw is None:
        return None
    cleaned = raw.strip().lower()
    if cleaned.startswith("0x"):
        cleaned = cleaned[2:]
    if not cleaned:
        return None
    if re.fullmatch(r"[0-9a-f]{1,2}", cleaned):
        return cleaned.zfill(2)
    return cleaned


def _parse_positive_int(raw: str | None) -> int | None:
    """Parse a positive decimal integer from a sysfs attribute (`busnum` / `devnum`)."""
    if raw is None:
        return None
    cleaned = raw.strip()
    if not cleaned.isdigit():
        return None
    val = int(cleaned, 10)
    return val if val >= 0 else None


def _resolve_device_dir_candidates(iface_dir: Path) -> list[Path]:
    """Return candidate USB device directories for a given sysfs interface directory."""
    candidates: list[Path] = [iface_dir]
    if ":" in iface_dir.name:
        device_prefix = iface_dir.name.split(":", 1)[0]
        if device_prefix:
            candidates.append(iface_dir.parent / device_prefix)
    candidates.append(iface_dir.parent)
    try:
        resolved = iface_dir.resolve()
        if resolved != iface_dir:
            candidates.append(resolved)
        candidates.append(resolved.parent)
        if ":" in resolved.name:
            dev_prefix = resolved.name.split(":", 1)[0]
            if dev_prefix:
                candidates.append(resolved.parent / dev_prefix)
    except OSError:
        pass

    deduped: list[Path] = []
    seen: set[str] = set()
    for cand in candidates:
        key = str(cand)
        if key not in seen:
            seen.add(key)
            deduped.append(cand)
    return deduped


def _extract_device_metadata(iface_dir: Path) -> dict[str, Any] | None:
    """Resolve `busnum`, `devnum`, `vid`, and `pid` for an ADB interface directory."""
    candidates = _resolve_device_dir_candidates(iface_dir)

    busnum: int | None = None
    devnum: int | None = None
    dev_vid: str | None = None
    dev_pid: str | None = None

    for cand in candidates:
        if busnum is None:
            busnum = _parse_positive_int(_read_text_stripped(cand / "busnum"))
        if devnum is None:
            devnum = _parse_positive_int(_read_text_stripped(cand / "devnum"))
        if dev_vid is None:
            dev_vid = normalize_usb_hex_id(_read_text_stripped(cand / "idVendor"))
        if dev_pid is None:
            dev_pid = normalize_usb_hex_id(_read_text_stripped(cand / "idProduct"))

    if busnum is None or devnum is None:
        return None

    return {
        "interface_dir": str(iface_dir),
        "vid": dev_vid,
        "pid": dev_pid,
        "busnum": busnum,
        "devnum": devnum,
    }


def _discover_adb_interfaces(sysfs_root: Path) -> list[dict[str, Any]]:
    """Scan `<sysfs_root>` for USB interfaces exposing `ff/42/01` (Android ADB)."""
    if not sysfs_root.is_dir():
        return []

    candidate_dirs: list[Path] = []
    try:
        top_entries = sorted(sysfs_root.iterdir(), key=lambda p: p.name)
    except OSError:
        return []

    for entry in top_entries:
        if (entry / "bInterfaceClass").is_file():
            candidate_dirs.append(entry)
            continue
        # Support nested synthetic sysfs trees (`<sysfs_root>/<device>/<interface>/bInterfaceClass`)
        if entry.is_dir() and not entry.is_symlink():
            try:
                for sub in sorted(entry.iterdir(), key=lambda p: p.name):
                    if (sub / "bInterfaceClass").is_file():
                        candidate_dirs.append(sub)
            except OSError:
                continue

    matches: list[dict[str, Any]] = []
    seen_bus_dev: set[tuple[int, int]] = set()

    for iface_dir in candidate_dirs:
        cls_hex = _normalize_hex_byte(_read_text_stripped(iface_dir / "bInterfaceClass"))
        sub_hex = _normalize_hex_byte(_read_text_stripped(iface_dir / "bInterfaceSubClass"))
        proto_hex = _normalize_hex_byte(_read_text_stripped(iface_dir / "bInterfaceProtocol"))

        if (
            cls_hex != ADB_INTERFACE_CLASS
            or sub_hex != ADB_INTERFACE_SUBCLASS
            or proto_hex != ADB_INTERFACE_PROTOCOL
        ):
            continue

        meta = _extract_device_metadata(iface_dir)
        if meta is None:
            continue

        key = (int(meta["busnum"]), int(meta["devnum"]))
        if key in seen_bus_dev:
            continue
        seen_bus_dev.add(key)
        matches.append(meta)

    return matches


def _select_matching_interface(
    interfaces: Sequence[dict[str, Any]],
    *,
    vid: str | None,
    pid: str | None,
) -> dict[str, Any] | None:
    """Select the best matching ADB USB interface for optional `vid` and `pid` filters."""
    if not interfaces:
        return None

    # 1. Exact VID + PID match (or wildcard when attribute is omitted in synthetic sysfs)
    for item in interfaces:
        item_vid = item.get("vid")
        item_pid = item.get("pid")
        vid_ok = vid is None or item_vid is None or item_vid == vid
        pid_ok = pid is None or item_pid is None or item_pid == pid
        if vid_ok and pid_ok:
            return item

    # 2. Same VID match (e.g. browser default 18d1:4ee2 probing a connected Pixel 18d1:4ee7)
    if vid is not None:
        for item in interfaces:
            if item.get("vid") == vid:
                return item

    # 3. Fallback to first active Android ADB (ff/42/01) interface on the host
    return interfaces[0]


def _resolve_pid_uid(pid_dir: Path) -> int | None:
    """Resolve the owner UID of a `/proc/<pid>` directory without elevated privileges."""
    status_text = _read_text_stripped(pid_dir / "status")
    if status_text:
        for line in status_text.splitlines():
            if line.startswith("Uid:"):
                parts = line.split()
                if len(parts) >= 2 and parts[1].isdigit():
                    return int(parts[1], 10)
    try:
        return os.stat(pid_dir).st_uid
    except OSError:
        return None


def _read_fd_target(fd_entry: Path) -> str | None:
    """Read the target path of a `/proc/<pid>/fd/<n>` symlink without following dangling targets."""
    try:
        target = os.readlink(fd_entry)
    except OSError:
        return None
    if target.endswith(" (deleted)"):
        target = target[: -len(" (deleted)")]
    return target.strip()


def _scan_proc_fd_holders(
    proc_root: Path,
    *,
    target_devnodes: set[str],
    expected_uid: int,
) -> list[dict[str, Any]]:
    """Scan `<proc_root>/[0-9]*/fd/*` owned by `expected_uid` for open handles to `target_devnodes`."""
    if not proc_root.is_dir():
        return []

    holders: list[dict[str, Any]] = []
    try:
        entries = list(proc_root.iterdir())
    except OSError:
        return []

    pid_dirs: list[tuple[int, Path]] = []
    for entry in entries:
        if entry.name.isdigit():
            pid_dirs.append((int(entry.name, 10), entry))
    pid_dirs.sort(key=lambda item: item[0])

    for pid_int, pid_dir in pid_dirs:
        pid_uid = _resolve_pid_uid(pid_dir)
        if pid_uid is None or pid_uid != expected_uid:
            continue

        fd_dir = pid_dir / "fd"
        try:
            fd_entries = list(fd_dir.iterdir())
        except OSError:
            continue

        matched_fd = False
        for fd_entry in fd_entries:
            target = _read_fd_target(fd_entry)
            if target is not None and target in target_devnodes:
                matched_fd = True
                break

        if matched_fd:
            comm = _read_text_stripped(pid_dir / "comm") or "unknown"
            holders.append({"pid": pid_int, "comm": comm})

    return holders


def _determine_recommended_action(
    holders: Sequence[Mapping[str, Any]],
    *,
    devnode_writable: bool | None,
    platform_name: str,
) -> str | None:
    """Compute a deterministic remediation action from holders and device node permissions."""
    for holder in holders:
        comm = str(holder.get("comm", "")).lower()
        if "adb" in comm:
            return "adb kill-server"
        if _BROWSER_COMM_RE.search(comm):
            return "Close the other browser tab holding the USB device"

    if holders:
        first = holders[0]
        return f"Stop {first.get('comm', 'process')} (PID {first.get('pid', 0)})"

    if platform_name == "linux" and devnode_writable is False:
        return f"Install {UDEV_RULE_FILENAME} and reload udevadm"

    return None


def inspect_linux_usb_owner(
    *,
    vid: str | int | None = None,
    pid: str | int | None = None,
    sysfs_root: str | Path = DEFAULT_SYSFS_USB_ROOT,
    proc_root: str | Path = DEFAULT_PROC_ROOT,
    dev_usb_root: str | Path = DEFAULT_DEV_USB_ROOT,
    uid: int | None = None,
    access_fn: Callable[[str | Path, int], bool] | None = None,
) -> dict[str, Any]:
    """Inspect Linux `/sys/bus/usb/devices` and same-UID `/proc/[pid]/fd` for ADB interface holders."""
    normalized_vid = normalize_usb_hex_id(vid)
    normalized_pid = normalize_usb_hex_id(pid)
    expected_uid = os.getuid() if uid is None else int(uid)
    effective_access = access_fn if access_fn is not None else os.access

    sysfs_path = Path(sysfs_root)
    proc_path = Path(proc_root)
    dev_usb_path = Path(dev_usb_root)

    interfaces = _discover_adb_interfaces(sysfs_path)
    selected = _select_matching_interface(
        interfaces,
        vid=normalized_vid,
        pid=normalized_pid,
    )

    if selected is None:
        return {
            "ok": True,
            "platform": "linux",
            "vid": normalized_vid,
            "pid": normalized_pid,
            "busnum": None,
            "devnum": None,
            "devnode": None,
            "devnode_writable": None,
            "busy": False,
            "holders": [],
            "recommended_action": None,
        }

    busnum = int(selected["busnum"])
    devnum = int(selected["devnum"])
    matched_vid = selected.get("vid") or normalized_vid
    matched_pid = selected.get("pid") or normalized_pid

    canonical_devnode = f"/dev/bus/usb/{busnum:03d}/{devnum:03d}"
    custom_devnode_path = dev_usb_path / f"{busnum:03d}" / f"{devnum:03d}"

    target_check_path: str | Path = (
        custom_devnode_path
        if dev_usb_path != DEFAULT_DEV_USB_ROOT
        else canonical_devnode
    )
    try:
        devnode_writable = bool(effective_access(target_check_path, os.R_OK | os.W_OK))
    except OSError:
        devnode_writable = False

    target_devnodes = {canonical_devnode, str(custom_devnode_path)}
    holders = _scan_proc_fd_holders(
        proc_path,
        target_devnodes=target_devnodes,
        expected_uid=expected_uid,
    )

    recommended_action = _determine_recommended_action(
        holders,
        devnode_writable=devnode_writable,
        platform_name="linux",
    )

    return {
        "ok": True,
        "platform": "linux",
        "vid": matched_vid,
        "pid": matched_pid,
        "busnum": busnum,
        "devnum": devnum,
        "devnode": canonical_devnode,
        "devnode_writable": devnode_writable,
        "busy": len(holders) > 0,
        "holders": holders,
        "recommended_action": recommended_action,
    }


def inspect_macos_usb_owner(
    *,
    vid: str | int | None = None,
    pid: str | int | None = None,
    uid: int | None = None,
    run_cmd_fn: Callable[[Sequence[str]], subprocess.CompletedProcess[str]] | None = None,
) -> dict[str, Any]:
    """Inspect same-UID `adb` processes on macOS via `pgrep -u <uid> adb` (`shell=False`)."""
    normalized_vid = normalize_usb_hex_id(vid)
    normalized_pid = normalize_usb_hex_id(pid)
    expected_uid = os.getuid() if uid is None else int(uid)

    def _default_run(cmd: Sequence[str]) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            list(cmd),
            shell=False,
            capture_output=True,
            text=True,
            timeout=3.0,
            check=False,
        )

    runner = run_cmd_fn if run_cmd_fn is not None else _default_run
    holders: list[dict[str, Any]] = []

    try:
        proc = runner(["pgrep", "-u", str(expected_uid), "adb"])
        if proc.returncode == 0 and proc.stdout:
            for line in proc.stdout.splitlines():
                token = line.strip()
                if token.isdigit():
                    holders.append({"pid": int(token, 10), "comm": "adb"})
    except (OSError, subprocess.SubprocessError):
        pass

    recommended_action = _determine_recommended_action(
        holders,
        devnode_writable=True,
        platform_name="macos",
    )

    return {
        "ok": True,
        "platform": "macos",
        "vid": normalized_vid,
        "pid": normalized_pid,
        "busnum": None,
        "devnum": None,
        "devnode": None,
        "devnode_writable": True,
        "busy": len(holders) > 0,
        "holders": holders,
        "recommended_action": recommended_action,
    }


def inspect_usb_owner(
    *,
    vid: str | int | None = None,
    pid: str | int | None = None,
    platform_name: str | None = None,
    **kwargs: Any,
) -> dict[str, Any]:
    """Dispatch USB interface ownership inspection for the current host platform."""
    plat = (platform_name or sys.platform).lower()
    if plat.startswith("linux"):
        return inspect_linux_usb_owner(vid=vid, pid=pid, **kwargs)
    if plat == "darwin" or plat.startswith("mac"):
        return inspect_macos_usb_owner(vid=vid, pid=pid, **kwargs)

    normalized_vid = normalize_usb_hex_id(vid)
    normalized_pid = normalize_usb_hex_id(pid)
    return {
        "ok": True,
        "platform": plat,
        "vid": normalized_vid,
        "pid": normalized_pid,
        "busnum": None,
        "devnum": None,
        "devnode": None,
        "devnode_writable": True,
        "busy": False,
        "holders": [],
        "recommended_action": None,
    }


def handle_http_usb_owner(
    server: Any,
    query: Mapping[str, str] | None = None,
) -> tuple[int, dict[str, Any]]:
    """Handle `GET /usb/owner` requests for `TowerForgeHTTPServer`."""
    params = query or {}
    vid = params.get("vid")
    pid = params.get("pid")
    payload = inspect_usb_owner(vid=vid, pid=pid)
    return 200, payload


def format_udev_rules_output(*, rule_only: bool = False) -> str:
    """Return the hardened `TAG+=\"uaccess\"` udev rule and optional install instructions."""
    if rule_only:
        return UDEV_RULE_CONTENT
    return f"{UDEV_RULE_CONTENT}\n{UDEV_INSTALL_INSTRUCTIONS}"


def print_udev_rules(*, rule_only: bool = False) -> int:
    """Print the hardened Linux udev rule and installation steps to stdout."""
    sys.stdout.write(format_udev_rules_output(rule_only=rule_only))
    sys.stdout.flush()
    return 0
