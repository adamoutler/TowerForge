"""Unit tests for multi-source device, emulator, Waydroid, and macOS container discovery (`sources.py`)."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
import http.client
import json
import os
from pathlib import Path
import sys
import threading
from typing import Any

# Ensure `towerforge_link` is importable when pytest is invoked from repository root `/workspace`
PACKAGE_ROOT = Path(__file__).resolve().parents[1]
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from towerforge_link.adb_runner import AdbResult  # noqa: E402
from towerforge_link.http_server import (  # noqa: E402
    TowerForgeHTTPServer,
    create_server,
)
from towerforge_link.sources import (  # noqa: E402
    CANDIDATE_ADB_EXPORT_PATHS,
    CANDIDATE_ADB_SAVE_PATHS,
    clear_discovery_cache,
    discover_macos_containers,
    discover_sources,
    discover_waydroid_local,
    parse_adb_devices,
    probe_adb_device,
)

REPO_ROOT = PACKAGE_ROOT.parent
OPENAPI_CONTRACT_PATH = REPO_ROOT / "docs" / "contracts" / "link-v1-openapi.json"


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


def _http_get_json(port: int, path: str) -> tuple[int, dict[str, Any]]:
    """Send a `GET` request to `127.0.0.1:port` with a valid loopback `Host` header."""
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5.0)
    try:
        conn.putrequest("GET", path, skip_host=True, skip_accept_encoding=True)
        conn.putheader("Host", "127.0.0.1:47821")
        conn.endheaders()
        resp = conn.getresponse()
        raw = resp.read()
        return resp.status, json.loads(raw.decode("utf-8"))
    finally:
        conn.close()


def test_parse_adb_devices_classifies_usb_wireless_emulator_waydroid_unauthorized_and_offline() -> None:
    """Test Case 1: `parse_adb_devices()` parses multi-device `adb devices -l` output."""
    sample_output = """\
* daemon not running; starting now at tcp:5037
* daemon started successfully
List of devices attached
54221FDAP0011M         device usb:1-4.3.1.4.1 product:caiman model:Pixel_9_Pro device:caiman transport_id:1
192.168.1.20:44547     device product:caiman model:Pixel_9_Pro device:caiman transport_id:2
emulator-5554          device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64xa transport_id:3
127.0.0.1:5555         device product:bluestacks model:BlueStacks_5 device:bstk transport_id:4
192.168.240.112:5555   device product:waydroid_x86_64 model:Waydroid_x86_64_Device device:waydroid_x86_64 transport_id:5
R58M999888Z            unauthorized usb:1-2 transport_id:6
192.168.1.99:39111     offline transport_id:7
-malicious-flag        device model:Injected
"""

    parsed = parse_adb_devices(sample_output)
    assert len(parsed) == 7

    by_serial = {item.serial: item for item in parsed}

    # 1. USB phone (Pixel 9 Pro)
    usb_phone = by_serial["54221FDAP0011M"]
    assert usb_phone.kind == "phone"
    assert usb_phone.state == "ready"
    assert usb_phone.adb_state == "device"
    assert usb_phone.is_wireless is False
    assert usb_phone.model == "Pixel 9 Pro"
    assert usb_phone.label == "Pixel 9 Pro (54221FDAP0011M)"
    assert usb_phone.id == "adb:54221FDAP0011M"
    assert usb_phone["kind"] == "phone"

    # 2. Wireless phone (Pixel 9 Pro over Wi-Fi)
    wifi_phone = by_serial["192.168.1.20:44547"]
    assert wifi_phone.kind == "phone"
    assert wifi_phone.state == "ready"
    assert wifi_phone.is_wireless is True
    assert wifi_phone.label == "Pixel 9 Pro (192.168.1.20:44547)"
    assert wifi_phone.id == "adb:192.168.1.20:44547"

    # 3. Android Studio AVD (emulator-5554) and localhost TCP emulator (127.0.0.1:5555)
    avd = by_serial["emulator-5554"]
    assert avd.kind == "emulator"
    assert avd.state == "ready"
    assert avd.label == "Android Emulator (emulator-5554)"
    assert avd.id == "adb:emulator-5554"

    tcp_emu = by_serial["127.0.0.1:5555"]
    assert tcp_emu.kind == "emulator"
    assert tcp_emu.state == "ready"
    assert tcp_emu.id == "adb:127.0.0.1:5555"

    # 4. Waydroid over ADB (192.168.240.112:5555)
    waydroid = by_serial["192.168.240.112:5555"]
    assert waydroid.kind == "waydroid"
    assert waydroid.state == "ready"
    assert waydroid.label == "Waydroid (192.168.240.112:5555)"
    assert waydroid.id == "adb:192.168.240.112:5555"

    # 5. Unauthorized device
    unauth = by_serial["R58M999888Z"]
    assert unauth.kind == "phone"
    assert unauth.state == "unauthorized"
    assert unauth.adb_state == "unauthorized"

    # 6. Offline device
    offline = by_serial["192.168.1.99:39111"]
    assert offline.kind == "phone"
    assert offline.state == "offline"
    assert offline.adb_state == "offline"


def test_discover_waydroid_local_finds_tool_export_and_player_save(tmp_path: Path) -> None:
    """Test Case 2: Linux Waydroid local filesystem directory detection finds `tool_export.json` in a mocked `~/.local/share/waydroid/...` tree."""
    waydroid_dir = (
        tmp_path
        / ".local"
        / "share"
        / "waydroid"
        / "data"
        / "media"
        / "0"
        / "Android"
        / "data"
        / "com.TechTreeGames.TheTower"
        / "files"
        / "TheTower"
    )
    waydroid_dir.mkdir(parents=True, exist_ok=True)

    export_file = waydroid_dir / "tool_export.json"
    export_file.write_text('{"VersionNumber": 26}', encoding="utf-8")
    save_file = waydroid_dir / "playerInfo.dat"
    save_file.write_bytes(b"MOCK_SAVE_BINARY")

    fixed_mtime = 1762440000
    os.utime(export_file, (fixed_mtime, fixed_mtime))
    os.utime(save_file, (fixed_mtime, fixed_mtime))

    sources = discover_waydroid_local(home_dir=tmp_path)
    assert len(sources) == 1

    src = sources[0]
    assert src.id == "waydroid:local"
    assert src.kind == "waydroid"
    assert src.state == "ready"
    assert src.has_save_data is True
    assert src.export_path == str(export_file)
    assert src.save_path == str(save_file)
    assert src.export_modified == fixed_mtime
    assert src.save_modified_at is not None and src.save_modified_at.endswith("Z")

    # Verify fallback to parent `.../files/` directory when `.../files/TheTower/` has no export
    fallback_home = tmp_path / "fallback_home"
    parent_files_dir = (
        fallback_home
        / ".local"
        / "share"
        / "waydroid"
        / "data"
        / "media"
        / "0"
        / "Android"
        / "data"
        / "com.TechTreeGames.TheTower"
        / "files"
    )
    parent_files_dir.mkdir(parents=True, exist_ok=True)
    parent_export = parent_files_dir / "tool_export.json"
    parent_export.write_text('{"VersionNumber": 27}', encoding="utf-8")

    fallback_sources = discover_waydroid_local(home_dir=fallback_home)
    assert len(fallback_sources) == 1
    assert fallback_sources[0].export_path == str(parent_export)
    assert fallback_sources[0].state == "ready"


def test_discover_macos_containers_finds_tool_export_in_containers_and_group_containers(
    tmp_path: Path,
) -> None:
    """Test Case 3: macOS container discovery finds `tool_export.json` in a mocked `~/Library/Containers/...` tree."""
    container_doc_dir = (
        tmp_path
        / "Library"
        / "Containers"
        / "com.TechTreeGames.TheTower"
        / "Data"
        / "Documents"
        / "TheTower"
    )
    container_doc_dir.mkdir(parents=True, exist_ok=True)
    export_file = container_doc_dir / "tool_export.json"
    export_file.write_text('{"VersionNumber": 26}', encoding="utf-8")
    save_file = container_doc_dir / "playerInfo.dat"
    save_file.write_bytes(b"MACOS_SAVE_DATA")

    group_container_dir = (
        tmp_path
        / "Library"
        / "Group Containers"
        / "group.com.TechTreeGames.TheTower"
        / "Documents"
    )
    group_container_dir.mkdir(parents=True, exist_ok=True)
    group_export = group_container_dir / "tool_export.json"
    group_export.write_text('{"VersionNumber": 26}', encoding="utf-8")

    mtime_main = 1762450000
    mtime_group = 1762445000
    os.utime(export_file, (mtime_main, mtime_main))
    os.utime(group_export, (mtime_group, mtime_group))

    sources = discover_macos_containers(home_dir=tmp_path)
    assert len(sources) == 2

    by_id = {s.id: s for s in sources}
    assert "macos:com.TechTreeGames.TheTower" in by_id
    assert "macos:group.com.TechTreeGames.TheTower" in by_id

    main_src = by_id["macos:com.TechTreeGames.TheTower"]
    assert main_src.kind == "macos_container"
    assert main_src.state == "ready"
    assert main_src.has_save_data is True
    assert main_src.export_path == str(export_file)
    assert main_src.save_path == str(save_file)
    assert main_src.export_modified == mtime_main
    assert main_src.save_modified_at is not None


def test_http_status_and_sources_validate_against_openapi_and_honor_refresh_cache_bypass(
    tmp_path: Path,
) -> None:
    """Test Case 4: `GET /status` and `GET /sources` HTTP responses validate against `docs/contracts/link-v1-openapi.json` required fields and honor `?refresh=true` / `?forceRefresh=true` cache bypass."""
    clear_discovery_cache()
    openapi_spec = json.loads(OPENAPI_CONTRACT_PATH.read_text(encoding="utf-8"))
    schemas = openapi_spec["components"]["schemas"]

    link_status_required = set(schemas["LinkStatus"]["required"])
    emulator_status_required = set(schemas["EmulatorStatus"]["required"])
    phone_status_required = set(schemas["PhoneStatus"]["required"])
    source_list_required = set(schemas["SourceListResult"]["required"])
    link_source_required = set(schemas["LinkSource"]["required"])

    adb_calls: list[list[str]] = []

    def fake_find_adb(*, explicit_path: str | None = None) -> str:
        return explicit_path or "/usr/bin/adb"

    def fake_run_adb(
        args: list[str],
        *,
        adb_path: str | None = None,
        serial: str | None = None,
        timeout: float | None = None,
        operation: str | None = None,
    ) -> AdbResult:
        cmd = list(args)
        adb_calls.append(([f"-s:{serial}"] if serial else []) + cmd)

        if cmd == ["devices", "-l"]:
            stdout = (
                "List of devices attached\n"
                "54221FDAP0011M         device usb:1-4.3 product:caiman model:Pixel_9_Pro device:caiman transport_id:1\n"
                "emulator-5554          device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64xa transport_id:2\n"
            )
            return AdbResult(args=["adb", *cmd], returncode=0, stdout=stdout, stderr="")

        if cmd == ["ls", "/sdcard/Android/data/com.TechTreeGames.TheTower/files"]:
            if serial == "54221FDAP0011M":
                stdout = (
                    "000045f8 00000d7c 6aee1299 .\n"
                    "000081b0 0000d755 6aee1299 playerInfo.dat\n"
                    "000081b0 00054aff 6aee1299 tool_export.json\n"
                )
            else:
                stdout = "000045f8 00000d7c 6aee1000 .\n"
            return AdbResult(args=["adb", "-s", serial or "", *cmd], returncode=0, stdout=stdout, stderr="")

        return AdbResult(args=["adb", *cmd], returncode=0, stdout="", stderr="")

    with _running_http_server(
        home_dir=tmp_path,
        find_adb_fn=fake_find_adb,
        run_adb_fn=fake_run_adb,
    ) as srv:
        port = srv.server_port

        # 1. Initial GET /sources populates cache
        status_code, sources_body = _http_get_json(port, "/sources")
        assert status_code == 200
        assert source_list_required.issubset(sources_body.keys())
        assert sources_body["has_save_data"] is True
        assert sources_body["adb_available"] is True
        assert sources_body["error"] is None
        assert len(sources_body["sources"]) == 2

        first_source = sources_body["sources"][0]
        assert link_source_required.issubset(first_source.keys())
        assert first_source["id"] == "adb:54221FDAP0011M"
        assert first_source["kind"] == "phone"
        assert first_source["label"] == "Pixel 9 Pro (54221FDAP0011M)"
        assert first_source["name"] == "Pixel 9 Pro (54221FDAP0011M)"
        assert first_source["state"] == "ready"
        assert first_source["serial"] == "54221FDAP0011M"
        assert first_source["has_save_data"] is True
        assert first_source["export_path"] == "/sdcard/Android/data/com.TechTreeGames.TheTower/files/tool_export.json"
        assert first_source["save_path"] == "/sdcard/Android/data/com.TechTreeGames.TheTower/files/playerInfo.dat"
        assert first_source["export_modified"] == int("6aee1299", 16)
        assert isinstance(first_source["save_modified_at"], str)

        calls_after_first = len(adb_calls)
        assert calls_after_first > 0

        # 2. Second GET /sources within 3s hits cache (zero new adb calls)
        status_cached, _ = _http_get_json(port, "/sources")
        assert status_cached == 200
        assert len(adb_calls) == calls_after_first

        # 3. GET /status within 3s also validates against OpenAPI schema
        status_http_code, status_body = _http_get_json(port, "/status")
        assert status_http_code == 200
        assert link_status_required.issubset(status_body.keys())
        assert status_body["app"] == "TowerForge Link"
        assert status_body["ok"] is True
        assert status_body["adbAvailable"] is True
        assert isinstance(status_body["emulators"], list)
        assert len(status_body["emulators"]) == 1
        assert emulator_status_required.issubset(status_body["emulators"][0].keys())
        assert status_body["emulators"][0]["id"] == "adb:emulator-5554"
        assert phone_status_required.issubset(status_body["phone"].keys())
        assert status_body["phone"]["adbReady"] is True
        assert status_body["phone"]["paired"] == 1
        assert "Pixel 9 Pro (54221FDAP0011M)" in status_body["phone"]["connected"]
        assert len(adb_calls) == calls_after_first

        # 4. GET /sources?refresh=true bypasses 3-second cache
        status_refresh, _ = _http_get_json(port, "/sources?refresh=true")
        assert status_refresh == 200
        calls_after_refresh = len(adb_calls)
        assert calls_after_refresh > calls_after_first

        # 5. GET /sources?forceRefresh=true also bypasses 3-second cache
        status_force, _ = _http_get_json(port, "/sources?forceRefresh=true")
        assert status_force == 200
        assert len(adb_calls) > calls_after_refresh


def test_probe_adb_device_checks_fallback_candidate_paths() -> None:
    """Verify `probe_adb_device()` checks fallback candidate directories such as `/sdcard/Download`."""
    assert "/sdcard/Android/data/com.TechTreeGames.TheTower/files/tool_export.json" in CANDIDATE_ADB_EXPORT_PATHS
    assert "/sdcard/Android/data/com.TechTreeGames.TheTower/files/playerInfo.dat" in CANDIDATE_ADB_SAVE_PATHS

    parsed = parse_adb_devices(
        "List of devices attached\n54221FDAP0011M device model:Pixel_9_Pro\n"
    )[0]

    def fake_runner(
        args: list[str],
        *,
        adb_path: str | None = None,
        serial: str | None = None,
        timeout: float | None = None,
        operation: str | None = None,
    ) -> AdbResult:
        if args == ["ls", "/sdcard/Download"]:
            return AdbResult(
                args=["adb", *args],
                returncode=0,
                stdout="000081b0 00001000 6aee1299 tool_export.json\n",
                stderr="",
            )
        return AdbResult(args=["adb", *args], returncode=0, stdout="", stderr="")

    probed = probe_adb_device(parsed, adb_path="/usr/bin/adb", run_adb_fn=fake_runner)
    assert probed.state == "ready"
    assert probed.has_save_data is True
    assert probed.export_path == "/sdcard/Download/tool_export.json"
    assert probed.export_modified == int("6aee1299", 16)
    assert discover_sources is not None
