"""Multi-source device, emulator, Waydroid, and macOS container discovery (`sources.py`).

Implements discovery for:
- USB and wireless Android phones via `adb devices -l`
- Android Studio AVDs and localhost TCP emulators (`emulator-*`, `127.0.0.1:*`)
- Linux Waydroid via ADB (`192.168.240.112:5555` / `192.168.240.*`) and local
  host media paths (`~/.local/share/waydroid/data/media/0/Android/data/com.TechTreeGames.TheTower/files/...`)
- macOS Apple Silicon native iOS app containers (`~/Library/Containers/...` and
  `~/Library/Group Containers/*TechTreeGames*/...`)

Provides a 3-second TTL discovery cache bypassed by `?refresh=true` or
`?forceRefresh=true`, and emits `/status` and `/sources` payloads compatible
with both `docs/contracts/link-v1-openapi.json` and `src/engine/linkClient.ts`.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
import os
from pathlib import Path
import stat
import threading
import time
from typing import Any

from . import __version__
from .adb_finder import AdbError, find_adb
from .adb_runner import TIMEOUT_STATUS, AdbResult, InvalidSerialError, run_adb, validate_serial

GAME_PACKAGE: str = "com.TechTreeGames.TheTower"
EXPORT_FILENAME: str = "tool_export.json"
SAVE_FILENAME: str = "playerInfo.dat"

WAYDROID_IP_PREFIX: str = "192.168.240."
WAYDROID_DEFAULT_SERIAL: str = "192.168.240.112:5555"

SOURCE_CACHE_TTL_SECONDS: float = 3.0

CANDIDATE_ADB_EXPORT_PATHS: tuple[str, ...] = (
    f"/sdcard/Android/data/{GAME_PACKAGE}/files/{EXPORT_FILENAME}",
    f"/sdcard/Android/data/{GAME_PACKAGE}/files/TheTower/{EXPORT_FILENAME}",
    f"/storage/emulated/0/Android/data/{GAME_PACKAGE}/files/{EXPORT_FILENAME}",
    f"/storage/emulated/0/Android/data/{GAME_PACKAGE}/files/TheTower/{EXPORT_FILENAME}",
    f"/sdcard/Download/{EXPORT_FILENAME}",
)

CANDIDATE_ADB_SAVE_PATHS: tuple[str, ...] = (
    f"/sdcard/Android/data/{GAME_PACKAGE}/files/{SAVE_FILENAME}",
    f"/sdcard/Android/data/{GAME_PACKAGE}/files/TheTower/{SAVE_FILENAME}",
    f"/storage/emulated/0/Android/data/{GAME_PACKAGE}/files/{SAVE_FILENAME}",
    f"/storage/emulated/0/Android/data/{GAME_PACKAGE}/files/TheTower/{SAVE_FILENAME}",
    f"/sdcard/Download/{SAVE_FILENAME}",
)

CANDIDATE_ADB_DIRS: tuple[str, ...] = (
    f"/sdcard/Android/data/{GAME_PACKAGE}/files",
    f"/sdcard/Android/data/{GAME_PACKAGE}/files/TheTower",
    f"/storage/emulated/0/Android/data/{GAME_PACKAGE}/files",
    f"/storage/emulated/0/Android/data/{GAME_PACKAGE}/files/TheTower",
    "/sdcard/Download",
)

WAYDROID_REL_DIRS: tuple[str, ...] = (
    f".local/share/waydroid/data/media/0/Android/data/{GAME_PACKAGE}/files/TheTower",
    f".local/share/waydroid/data/media/0/Android/data/{GAME_PACKAGE}/files",
)

MACOS_CONTAINER_GLOBS: tuple[str, ...] = (
    f"Library/Containers/*/Data/Documents/TheTower/{EXPORT_FILENAME}",
    f"Library/Containers/*/Data/Documents/{EXPORT_FILENAME}",
    f"Library/Group Containers/*TechTreeGames*/**/{EXPORT_FILENAME}",
)


def _format_iso_timestamp(unix_seconds: int | float | None) -> str | None:
    """Format a Unix epoch timestamp (seconds) as an ISO-8601 UTC string."""
    if unix_seconds is None or unix_seconds <= 0:
        return None
    dt = datetime.fromtimestamp(int(unix_seconds), tz=timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")


@dataclass(frozen=True)
class AdbLsEntry:
    """Parsed line entry from `adb -s <serial> ls <dir>` output."""

    name: str
    mode: int
    size: int
    mtime: int


@dataclass(frozen=True)
class ParsedAdbDevice(Mapping[str, Any]):
    """Parsed device record from `adb devices -l`."""

    serial: str
    adb_state: str
    state: str
    kind: str
    label: str
    id: str
    model: str | None = None
    product: str | None = None
    device: str | None = None
    usb: str | None = None
    transport_id: str | None = None
    is_wireless: bool = False

    @property
    def name(self) -> str:
        """Alias for `label` for wire compatibility."""
        return self.label

    def to_dict(self) -> dict[str, Any]:
        """Serialize the parsed ADB device to a plain dictionary."""
        return {
            "id": self.id,
            "serial": self.serial,
            "adb_state": self.adb_state,
            "state": self.state,
            "kind": self.kind,
            "label": self.label,
            "name": self.label,
            "model": self.model,
            "product": self.product,
            "device": self.device,
            "usb": self.usb,
            "transport_id": self.transport_id,
            "is_wireless": self.is_wireless,
        }

    def __getitem__(self, key: str) -> Any:
        return self.to_dict()[key]

    def __iter__(self) -> Iterator[str]:
        return iter(self.to_dict())

    def __len__(self) -> int:
        return len(self.to_dict())


@dataclass(frozen=True)
class DiscoveredSource(Mapping[str, Any]):
    """Normalized game data source discovered via ADB or host filesystem."""

    id: str
    kind: str
    label: str
    state: str
    serial: str | None = None
    export_modified: int | None = None
    save_modified_at: str | None = None
    has_save_data: bool = False
    export_path: str | None = None
    save_path: str | None = None
    message: str | None = None

    @property
    def name(self) -> str:
        """Alias for `label` required by `LinkSource` in `link-v1-openapi.json`."""
        return self.label

    @property
    def modified(self) -> int | None:
        """Alias for `export_modified` required by `LinkSource` in `link-v1-openapi.json`."""
        return self.export_modified

    def to_dict(self) -> dict[str, Any]:
        """Convert to JSON-serializable dict matching OpenAPI and `linkClient.ts`."""
        payload: dict[str, Any] = {
            "id": self.id,
            "name": self.label,
            "label": self.label,
            "kind": self.kind,
            "state": self.state,
            "serial": self.serial,
            "export_modified": self.export_modified,
            "save_modified_at": self.save_modified_at,
            "has_save_data": self.has_save_data,
            "export_path": self.export_path,
            "save_path": self.save_path,
        }
        if self.export_modified is not None:
            payload["modified"] = int(self.export_modified)
        if self.message is not None:
            payload["message"] = self.message
        return payload

    def __getitem__(self, key: str) -> Any:
        return self.to_dict()[key]

    def __iter__(self) -> Iterator[str]:
        return iter(self.to_dict())

    def __len__(self) -> int:
        return len(self.to_dict())


def classify_adb_device(
    serial: str,
    *,
    model: str | None = None,
    product: str | None = None,
    device: str | None = None,
) -> str:
    """Classify an ADB device serial and metadata into `'phone'`, `'emulator'`, or `'waydroid'`."""
    lower_serial = serial.lower()
    meta_combined = " ".join(filter(None, (model, product, device))).lower()

    if lower_serial.startswith(WAYDROID_IP_PREFIX) or "waydroid" in meta_combined:
        return "waydroid"

    if (
        lower_serial.startswith("emulator-")
        or lower_serial.startswith("127.0.0.1:")
        or lower_serial.startswith("localhost:")
    ):
        return "emulator"

    return "phone"


def format_device_label(serial: str, kind: str, model: str | None = None) -> str:
    """Construct a human-readable device label including its serial."""
    cleaned_model = (model or "").replace("_", " ").strip()
    if kind == "waydroid":
        if cleaned_model and "waydroid" not in cleaned_model.lower():
            return f"Waydroid {cleaned_model} ({serial})"
        return f"Waydroid ({serial})"

    if kind == "emulator":
        if cleaned_model and not cleaned_model.lower().startswith("sdk"):
            return f"{cleaned_model} ({serial})"
        return f"Android Emulator ({serial})"

    if cleaned_model:
        return f"{cleaned_model} ({serial})"
    return f"Android Phone ({serial})"


def _map_adb_state_to_source_state(adb_state: str) -> str:
    """Map raw `adb devices -l` state token to initial source state."""
    normalized = adb_state.strip().lower()
    if normalized == "device":
        return "ready"
    if normalized == "unauthorized":
        return "unauthorized"
    return "offline"


def parse_adb_devices(output: str) -> list[ParsedAdbDevice]:
    """Parse `adb devices -l` output into structured `ParsedAdbDevice` items.

    Classifies USB phones, wireless ADB phones, Android Studio AVDs (`emulator-*` /
    `127.0.0.1:*`), Waydroid (`192.168.240.112:5555`), `unauthorized` devices,
    and `offline` devices. Ignores invalid or flag-injecting serial tokens.
    """
    devices: list[ParsedAdbDevice] = []
    if not output:
        return devices

    for raw_line in output.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("* daemon") or line.lower().startswith("list of devices"):
            continue

        parts = line.split()
        if len(parts) < 2:
            continue

        raw_serial, raw_state = parts[0], parts[1]
        try:
            serial = validate_serial(raw_serial)
        except InvalidSerialError:
            continue

        metadata: dict[str, str] = {}
        for token in parts[2:]:
            if ":" in token:
                key, value = token.split(":", 1)
                if key and value:
                    metadata[key] = value

        raw_model = metadata.get("model")
        human_model = raw_model.replace("_", " ").strip() if raw_model else None
        product = metadata.get("product")
        device_code = metadata.get("device")
        usb_path = metadata.get("usb")
        transport_id = metadata.get("transport_id")

        kind = classify_adb_device(
            serial,
            model=human_model,
            product=product,
            device=device_code,
        )
        state = _map_adb_state_to_source_state(raw_state)
        label = format_device_label(serial, kind, human_model)
        is_wireless = (
            kind == "phone"
            and usb_path is None
            and (":" in serial or "._adb-tls-" in serial)
        )

        devices.append(
            ParsedAdbDevice(
                serial=serial,
                adb_state=raw_state,
                state=state,
                kind=kind,
                label=label,
                id=f"adb:{serial}",
                model=human_model,
                product=product,
                device=device_code,
                usb=usb_path,
                transport_id=transport_id,
                is_wireless=is_wireless,
            )
        )

    return devices


def parse_adb_ls(output: str) -> dict[str, AdbLsEntry]:
    """Parse `adb -s <serial> ls <dir>` output (`<mode_hex> <size_hex> <mtime_hex> <name>`)."""
    entries: dict[str, AdbLsEntry] = {}
    if not output:
        return entries

    for raw_line in output.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        parts = line.split(None, 3)
        if len(parts) < 4:
            continue
        try:
            mode = int(parts[0], 16)
            size = int(parts[1], 16)
            mtime = int(parts[2], 16)
        except ValueError:
            continue
        name = parts[3]
        entries[name] = AdbLsEntry(name=name, mode=mode, size=size, mtime=mtime)

    return entries


def _default_state_message(label: str, state: str) -> str | None:
    """Return a human-readable explanation when a source state is not `'ready'`."""
    if state == "ready":
        return None
    if state == "unauthorized":
        return f"{label} is waiting for USB/Wireless debugging authorization on the device."
    if state == "offline":
        return f"{label} is offline or not responding to ADB."
    if state in {"no_save", "no_export", "no_game"}:
        return f"No TowerForge game export ({EXPORT_FILENAME}) found on {label}."
    return f"{label} is in state '{state}'."


def probe_adb_device(
    device: ParsedAdbDevice,
    *,
    adb_path: str | None = None,
    run_adb_fn: Callable[..., AdbResult] | None = None,
) -> DiscoveredSource:
    """Probe candidate game export and save paths on a single ADB device."""
    if device.adb_state != "device":
        mapped_state = _map_adb_state_to_source_state(device.adb_state)
        return DiscoveredSource(
            id=device.id,
            kind=device.kind,
            label=device.label,
            state=mapped_state,
            serial=device.serial,
            export_modified=None,
            save_modified_at=None,
            has_save_data=False,
            export_path=None,
            save_path=None,
            message=_default_state_message(device.label, mapped_state),
        )

    runner = run_adb if run_adb_fn is None else run_adb_fn

    export_path: str | None = None
    export_modified: int | None = None
    save_path: str | None = None
    save_modified: int | None = None

    primary_sdcard_dir = CANDIDATE_ADB_DIRS[0]
    primary_sdcard_nonempty = False
    primary_has_subdir = False

    for candidate_dir in CANDIDATE_ADB_DIRS:
        # Avoid redundant roundtrips on real Android devices where /sdcard/Android/data/.../files
        # was already listed and showed no TheTower subdirectory, and /storage/emulated/0 mirrors /sdcard.
        if (
            candidate_dir == f"{primary_sdcard_dir}/TheTower"
            and primary_sdcard_nonempty
            and not primary_has_subdir
        ):
            continue
        if (
            candidate_dir.startswith("/storage/emulated/0/")
            and primary_sdcard_nonempty
        ):
            continue

        try:
            res = runner(
                ["ls", candidate_dir],
                adb_path=adb_path,
                serial=device.serial,
                timeout=TIMEOUT_STATUS,
                operation="ls",
            )
        except AdbError:
            continue

        if not res.ok and not res.stdout:
            continue

        entries = parse_adb_ls(res.stdout)
        if candidate_dir == primary_sdcard_dir and entries:
            primary_sdcard_nonempty = True
            primary_has_subdir = "TheTower" in entries

        if not entries:
            continue

        dir_prefix = candidate_dir.rstrip("/")
        if export_path is None and EXPORT_FILENAME in entries:
            entry = entries[EXPORT_FILENAME]
            export_path = f"{dir_prefix}/{EXPORT_FILENAME}"
            export_modified = entry.mtime if entry.mtime > 0 else None

        if save_path is None and SAVE_FILENAME in entries:
            s_entry = entries[SAVE_FILENAME]
            save_path = f"{dir_prefix}/{SAVE_FILENAME}"
            save_modified = s_entry.mtime if s_entry.mtime > 0 else None

        if export_path is not None:
            break

    has_save_data = bool(export_path is not None or save_path is not None)
    best_mtime = export_modified if export_modified is not None else save_modified
    save_modified_at = _format_iso_timestamp(best_mtime)
    state = "ready" if has_save_data else "no_save"

    return DiscoveredSource(
        id=device.id,
        kind=device.kind,
        label=device.label,
        state=state,
        serial=device.serial,
        export_modified=export_modified,
        save_modified_at=save_modified_at,
        has_save_data=has_save_data,
        export_path=export_path,
        save_path=save_path,
        message=_default_state_message(device.label, state),
    )


def _resolve_home_dir(home_dir: str | os.PathLike[str] | None = None) -> Path:
    """Resolve the user home directory deterministically."""
    if home_dir is not None:
        return Path(home_dir)
    env_home = os.environ.get("HOME", "").strip()
    if env_home:
        return Path(env_home)
    return Path(os.path.expanduser("~"))


def _safe_regular_file_mtime(path: Path) -> int | None:
    """Return the integer modification time of `path` if it is a regular file, else `None`."""
    try:
        st = path.stat()
    except OSError:
        return None
    if not stat.S_ISREG(st.st_mode):
        return None
    return int(st.st_mtime)


def discover_waydroid_local(
    home_dir: str | os.PathLike[str] | None = None,
) -> list[DiscoveredSource]:
    """Discover `tool_export.json` and `playerInfo.dat` in Linux Waydroid host directories."""
    base_home = _resolve_home_dir(home_dir)
    export_path: str | None = None
    export_modified: int | None = None
    save_path: str | None = None
    save_modified: int | None = None
    any_dir_exists = False

    for rel_dir in WAYDROID_REL_DIRS:
        candidate_dir = base_home / rel_dir
        try:
            if not candidate_dir.is_dir():
                continue
        except OSError:
            continue

        any_dir_exists = True
        exp_candidate = candidate_dir / EXPORT_FILENAME
        exp_mtime = _safe_regular_file_mtime(exp_candidate)
        if export_path is None and exp_mtime is not None:
            export_path = str(exp_candidate)
            export_modified = exp_mtime

        save_candidate = candidate_dir / SAVE_FILENAME
        sav_mtime = _safe_regular_file_mtime(save_candidate)
        if save_path is None and sav_mtime is not None:
            save_path = str(save_candidate)
            save_modified = sav_mtime

        if export_path is not None:
            break

    if not any_dir_exists and export_path is None and save_path is None:
        return []

    has_save_data = bool(export_path is not None or save_path is not None)
    best_mtime = export_modified if export_modified is not None else save_modified
    state = "ready" if has_save_data else "no_save"
    label = "Waydroid (Local Filesystem)"

    return [
        DiscoveredSource(
            id="waydroid:local",
            kind="waydroid",
            label=label,
            state=state,
            serial=None,
            export_modified=export_modified,
            save_modified_at=_format_iso_timestamp(best_mtime),
            has_save_data=has_save_data,
            export_path=export_path,
            save_path=save_path,
            message=_default_state_message(label, state),
        )
    ]


def _extract_macos_container_name(base_home: Path, file_path: Path) -> str:
    """Extract the macOS container identifier from a matched path under `~/Library/`."""
    try:
        rel = file_path.relative_to(base_home / "Library")
        parts = rel.parts
        if len(parts) >= 2 and parts[0] in {"Containers", "Group Containers"}:
            return parts[1]
    except ValueError:
        pass
    return file_path.parent.name or "TheTower"


def discover_macos_containers(
    home_dir: str | os.PathLike[str] | None = None,
) -> list[DiscoveredSource]:
    """Discover `tool_export.json` inside macOS Apple Silicon iOS app containers."""
    base_home = _resolve_home_dir(home_dir)
    library_dir = base_home / "Library"
    try:
        if not library_dir.is_dir():
            return []
    except OSError:
        return []

    discovered_by_id: dict[str, DiscoveredSource] = {}

    for pattern in MACOS_CONTAINER_GLOBS:
        for matched_export in sorted(base_home.glob(pattern)):
            exp_mtime = _safe_regular_file_mtime(matched_export)
            if exp_mtime is None:
                continue

            container_name = _extract_macos_container_name(base_home, matched_export)
            source_id = f"macos:{container_name}"
            if source_id in discovered_by_id:
                existing = discovered_by_id[source_id]
                if (existing.export_modified or 0) >= exp_mtime:
                    continue

            sibling_save = matched_export.parent / SAVE_FILENAME
            save_mtime = _safe_regular_file_mtime(sibling_save)
            save_path = str(sibling_save) if save_mtime is not None else None
            label = f"macOS Container ({container_name})"

            discovered_by_id[source_id] = DiscoveredSource(
                id=source_id,
                kind="macos_container",
                label=label,
                state="ready",
                serial=None,
                export_modified=exp_mtime,
                save_modified_at=_format_iso_timestamp(exp_mtime),
                has_save_data=True,
                export_path=str(matched_export),
                save_path=save_path,
                message=None,
            )

    return list(discovered_by_id.values())


@dataclass
class _CacheEntry:
    timestamp: float
    sources_payload: dict[str, Any]
    status_payload: dict[str, Any]


_CACHE_LOCK = threading.Lock()
_DISCOVERY_CACHE: dict[tuple[str, str, int, int], _CacheEntry] = {}


def clear_discovery_cache() -> None:
    """Clear the 3-second discovery cache."""
    with _CACHE_LOCK:
        _DISCOVERY_CACHE.clear()


def is_refresh_requested(query: Mapping[str, str] | None) -> bool:
    """Return `True` if `?refresh=true` or `?forceRefresh=true` is set in `query`."""
    if not query:
        return False
    for key in ("refresh", "forceRefresh", "force_refresh"):
        val = query.get(key)
        if val is not None and val.strip().lower() in {"1", "true", "yes", "on"}:
            return True
    return False


def _perform_discovery(
    *,
    adb_path: str | None = None,
    home_dir: str | os.PathLike[str] | None = None,
    run_adb_fn: Callable[..., AdbResult] | None = None,
    find_adb_fn: Callable[..., str] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Run a single multi-source discovery pass and construct `/sources` and `/status` dicts."""
    locator = find_adb if find_adb_fn is None else find_adb_fn
    runner = run_adb if run_adb_fn is None else run_adb_fn

    resolved_adb: str | None = None
    adb_available = False
    adb_error: str | None = None

    try:
        resolved_adb = locator(explicit_path=adb_path)
        adb_available = True
    except AdbError as exc:
        adb_available = False
        adb_error = str(exc)

    discovered_sources: list[DiscoveredSource] = []

    if adb_available and resolved_adb is not None:
        try:
            devices_res = runner(
                ["devices", "-l"],
                adb_path=resolved_adb,
                timeout=TIMEOUT_STATUS,
                operation="devices",
            )
            if devices_res.ok:
                parsed_devices = parse_adb_devices(devices_res.stdout)
                for dev in parsed_devices:
                    discovered_sources.append(
                        probe_adb_device(
                            dev,
                            adb_path=resolved_adb,
                            run_adb_fn=runner,
                        )
                    )
            else:
                adb_error = (devices_res.stderr or devices_res.stdout).strip() or "adb devices failed"
        except AdbError as exc:
            adb_error = str(exc)

    discovered_sources.extend(discover_waydroid_local(home_dir=home_dir))
    discovered_sources.extend(discover_macos_containers(home_dir=home_dir))

    # Order sources with newest export first, then save-bearing sources, then others
    discovered_sources.sort(
        key=lambda s: (
            s.export_modified is not None,
            s.export_modified or 0,
            s.has_save_data,
            s.state == "ready",
        ),
        reverse=True,
    )

    source_dicts = [src.to_dict() for src in discovered_sources]
    any_save_data = any(src.has_save_data for src in discovered_sources)

    sources_payload: dict[str, Any] = {
        "sources": source_dicts,
        "has_save_data": any_save_data,
        "adb_available": adb_available,
        "error": adb_error if (adb_error and not source_dicts) else None,
    }

    emulators_list: list[dict[str, Any]] = []
    connected_phones: list[str] = []

    for src in discovered_sources:
        if src.kind in {"emulator", "waydroid"}:
            emulators_list.append(
                {
                    "id": src.id,
                    "name": src.label,
                    "running": src.state != "offline",
                    "adbEnabled": (src.serial is not None and src.state != "offline")
                    if src.serial is not None
                    else None,
                    "state": src.state,
                    "serial": src.serial,
                    "exportModified": src.export_modified,
                    "exportPath": src.export_path,
                }
            )
        elif src.kind == "phone" and src.state not in {"offline", "unauthorized"}:
            connected_phones.append(src.label)

    status_payload: dict[str, Any] = {
        "app": "TowerForge Link",
        "version": __version__,
        "ok": True,
        "adbAvailable": adb_available,
        "emulators": emulators_list,
        "phone": {
            "adbReady": adb_available,
            "paired": len(connected_phones),
            "connected": connected_phones,
        },
        "iphoneBackups": [],
    }

    return sources_payload, status_payload


def _get_cached_or_discover(
    *,
    adb_path: str | None = None,
    home_dir: str | os.PathLike[str] | None = None,
    refresh: bool = False,
    force_refresh: bool = False,
    cache_ttl: float = SOURCE_CACHE_TTL_SECONDS,
    run_adb_fn: Callable[..., AdbResult] | None = None,
    find_adb_fn: Callable[..., str] | None = None,
) -> _CacheEntry:
    """Return cached discovery entry within `cache_ttl` (3s) or execute fresh discovery."""
    bypass = bool(refresh or force_refresh)
    cache_key = (
        os.fspath(adb_path) if adb_path is not None else "",
        os.fspath(_resolve_home_dir(home_dir)),
        id(run_adb_fn) if run_adb_fn is not None else 0,
        id(find_adb_fn) if find_adb_fn is not None else 0,
    )
    now = time.monotonic()

    if not bypass:
        with _CACHE_LOCK:
            cached = _DISCOVERY_CACHE.get(cache_key)
            if cached is not None and (now - cached.timestamp) < cache_ttl:
                return cached

    sources_payload, status_payload = _perform_discovery(
        adb_path=adb_path,
        home_dir=home_dir,
        run_adb_fn=run_adb_fn,
        find_adb_fn=find_adb_fn,
    )
    entry = _CacheEntry(
        timestamp=time.monotonic(),
        sources_payload=sources_payload,
        status_payload=status_payload,
    )
    with _CACHE_LOCK:
        _DISCOVERY_CACHE[cache_key] = entry
    return entry


def discover_sources(
    *,
    adb_path: str | None = None,
    home_dir: str | os.PathLike[str] | None = None,
    refresh: bool = False,
    force_refresh: bool = False,
    cache_ttl: float = SOURCE_CACHE_TTL_SECONDS,
    run_adb_fn: Callable[..., AdbResult] | None = None,
    find_adb_fn: Callable[..., str] | None = None,
) -> dict[str, Any]:
    """Return the `/sources` discovery payload, honoring the 3-second TTL cache."""
    entry = _get_cached_or_discover(
        adb_path=adb_path,
        home_dir=home_dir,
        refresh=refresh,
        force_refresh=force_refresh,
        cache_ttl=cache_ttl,
        run_adb_fn=run_adb_fn,
        find_adb_fn=find_adb_fn,
    )
    return dict(entry.sources_payload)


def build_status_payload(
    *,
    adb_path: str | None = None,
    home_dir: str | os.PathLike[str] | None = None,
    refresh: bool = False,
    force_refresh: bool = False,
    cache_ttl: float = SOURCE_CACHE_TTL_SECONDS,
    run_adb_fn: Callable[..., AdbResult] | None = None,
    find_adb_fn: Callable[..., str] | None = None,
) -> dict[str, Any]:
    """Return the `/status` discovery payload, honoring the 3-second TTL cache."""
    entry = _get_cached_or_discover(
        adb_path=adb_path,
        home_dir=home_dir,
        refresh=refresh,
        force_refresh=force_refresh,
        cache_ttl=cache_ttl,
        run_adb_fn=run_adb_fn,
        find_adb_fn=find_adb_fn,
    )
    return dict(entry.status_payload)
