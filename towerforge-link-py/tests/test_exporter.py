"""Unit tests for the hardened exporter and CLI save backup helper (`exporter.py`)."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
import hashlib
import http.client
import json
import os
from pathlib import Path
import stat
import sys
import threading
from typing import Any

import pytest

# Ensure `towerforge_link` is importable when pytest is invoked from repository root `/workspace`
PACKAGE_ROOT = Path(__file__).resolve().parents[1]
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from towerforge_link.__main__ import main as cli_main  # noqa: E402
from towerforge_link.adb_runner import AdbResult  # noqa: E402
from towerforge_link.exporter import (  # noqa: E402
     MAX_EXPORT_BYTES,
    ExportSourceNotFoundError,
    ForbiddenExportTargetError,
    InvalidExportJsonError,
    PayloadTooLargeError,
    export_from_source,
    pull_save_backup,
)
from towerforge_link.http_server import (  # noqa: E402
    TowerForgeHTTPServer,
    create_server,
)
from towerforge_link.sources import clear_discovery_cache  # noqa: E402


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


def _http_get_raw(port: int, path: str) -> tuple[int, dict[str, str], bytes]:
    """Send a `GET` request to `127.0.0.1:port` with a valid loopback `Host` header."""
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5.0)
    try:
        conn.putrequest("GET", path, skip_host=True, skip_accept_encoding=True)
        conn.putheader("Host", "127.0.0.1:47821")
        conn.endheaders()
        resp = conn.getresponse()
        headers = {k.lower(): v for k, v in resp.getheaders()}
        raw = resp.read()
        return resp.status, headers, raw
    finally:
        conn.close()


def test_export_from_source_preserves_byte_identical_raw_text_and_headers(
    tmp_path: Path,
) -> None:
    """Test Case 1: `export_from_source()` returns `{"ok": True, "data": raw_text}` where `raw_text` is byte-for-byte identical to the fixture file (preserving whitespace and key order)."""
    clear_discovery_cache()

    # Deliberately craft JSON with non-sorted keys, custom whitespace, scientific notation,
    # and trailing newline that `json.dumps(json.loads(...))` would mutate if re-serialized.
    raw_fixture_text = (
        "{\n"
        '  "ZetaKey" :   true,\n'
        '  "VersionNumber": 26,\n'
        '  "DataVersion" : 4,\n'
        '  "Coins": 1.2500e+12,\n'
        '  "Gems" : 4500,\n'
        '  "AlphaNested": {  "b": 2,   "a": 1  }\n'
        "}\n"
    )
    assert json.dumps(json.loads(raw_fixture_text)) != raw_fixture_text

    fixture_file = tmp_path / "tool_export.json"
    fixture_file.write_bytes(raw_fixture_text.encode("utf-8"))

    observed_temp_modes: list[int] = []
    observed_temp_paths: list[Path] = []

    def track_temp_dir(tdir: Path) -> None:
        observed_temp_paths.append(tdir)
        observed_temp_modes.append(stat.S_IMODE(tdir.stat().st_mode))

    # 1a. Direct local source export preserves exact bytes and creates 0700 temp dir
    direct_res = export_from_source(
        fixture_file,
        temp_base_dir=tmp_path,
        on_temp_dir_created=track_temp_dir,
    )
    assert direct_res["ok"] is True
    assert direct_res["data"] == raw_fixture_text
    assert direct_res["data"].encode("utf-8") == raw_fixture_text.encode("utf-8")
    assert observed_temp_modes == [0o700]
    assert not observed_temp_paths[0].exists()

    # 1b. ADB pull source export via `adb -s <serial> pull` preserves exact bytes and headers
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
        if args == ["devices", "-l"]:
            return AdbResult(
                args=["adb", *args],
                returncode=0,
                stdout="List of devices attached\n54221FDAP0011M device usb:1-4 model:Pixel_9_Pro device:caiman\n",
                stderr="",
            )
        if args == ["ls", "/sdcard/Android/data/com.TechTreeGames.TheTower/files"]:
            return AdbResult(
                args=["adb", "-s", serial or "", *args],
                returncode=0,
                stdout="000081b0 00000100 6aee14f1 tool_export.json\n",
                stderr="",
            )
        if args[0] == "pull":
            dest = Path(args[2])
            dest.write_bytes(raw_fixture_text.encode("utf-8"))
            return AdbResult(
                args=["adb", "-s", serial or "", *args],
                returncode=0,
                stdout="1 file pulled",
                stderr="",
            )
        return AdbResult(args=["adb", *args], returncode=0, stdout="", stderr="")

    adb_res = export_from_source(
        source="adb:54221FDAP0011M",
        home_dir=tmp_path,
        run_adb_fn=fake_run_adb,
        find_adb_fn=fake_find_adb,
    )
    assert adb_res["ok"] is True
    assert adb_res["data"] == raw_fixture_text
    assert adb_res["source"]["id"] == "adb:54221FDAP0011M"
    assert adb_res["modified"] == int("6aee14f1", 16)

    # 1c. Verify HTTP GET /export returns byte-identical raw text, headers, envelope mode, and 204 newerThan
    with _running_http_server(
        home_dir=tmp_path,
        find_adb_fn=fake_find_adb,
        run_adb_fn=fake_run_adb,
    ) as srv:
        port = srv.server_port

        status, headers, body = _http_get_raw(port, "/export?source=adb:54221FDAP0011M")
        assert status == 200
        assert body == raw_fixture_text.encode("utf-8")
        assert headers.get("x-export-source") == "Pixel 9 Pro (54221FDAP0011M)"
        assert headers.get("x-export-source-id") == "adb:54221FDAP0011M"
        assert headers.get("x-export-modified") == str(int("6aee14f1", 16))

        # Envelope mode (`?envelope=true`) returns {"ok": True, "data": raw_text, ...}
        env_status, _, env_body = _http_get_raw(port, "/export?source=adb:54221FDAP0011M&envelope=true")
        assert env_status == 200
        env_json = json.loads(env_body.decode("utf-8"))
        assert env_json["ok"] is True
        assert env_json["data"] == raw_fixture_text

        # `newerThan` equal to or newer than `export_modified` returns HTTP 204 No Content
        not_mod_status, not_mod_headers, not_mod_body = _http_get_raw(
            port,
            f"/export?source=adb:54221FDAP0011M&newerThan={int('6aee14f1', 16)}",
        )
        assert not_mod_status == 204
        assert not_mod_body == b""
        assert not_mod_headers.get("x-export-modified") == str(int("6aee14f1", 16))


def test_export_from_source_rejects_file_exceeding_8_mib_with_413(
    tmp_path: Path,
) -> None:
    """Test Case 2: `export_from_source()` rejects a file > 8 MiB (`8_388_609` bytes) with `PayloadTooLargeError` (HTTP `413` / `ok: False`)."""
    clear_discovery_cache()
    assert MAX_EXPORT_BYTES == 8_388_608

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
    oversized_export = waydroid_dir / "tool_export.json"

    # Write exactly 8_388_609 bytes (MAX_EXPORT_BYTES + 1)
    prefix = b'{"VersionNumber":26,"pad":"'
    suffix = b'"}'
    pad_len = (MAX_EXPORT_BYTES + 1) - len(prefix) - len(suffix)
    with open(oversized_export, "wb") as fh:
        fh.write(prefix)
        fh.write(b"A" * pad_len)
        fh.write(suffix)

    assert oversized_export.stat().st_size == 8_388_609

    with pytest.raises(PayloadTooLargeError) as exc_info:
        export_from_source(oversized_export)
    assert exc_info.value.http_status == 413
    assert exc_info.value.code == "payload_too_large"

    # Verify HTTP GET /export maps PayloadTooLargeError to HTTP 413 and {"ok": False, ...}
    with _running_http_server(
        home_dir=tmp_path,
        find_adb_fn=lambda **_: "/usr/bin/adb",
        run_adb_fn=lambda args, **_: AdbResult(args=["adb", *args], returncode=0, stdout="", stderr=""),
    ) as srv:
        status, _, body = _http_get_raw(srv.server_port, "/export?refresh=true")
        assert status == 413
        payload = json.loads(body.decode("utf-8"))
        assert payload["ok"] is False
        assert payload["error"] == "payload_too_large"


def test_export_from_source_rejects_corrupt_json_with_422_and_cleans_up_0700_temp_dir(
    tmp_path: Path,
) -> None:
    """Test Case 3: `export_from_source()` rejects corrupt/truncated JSON with `InvalidExportJsonError` (HTTP `422` / `ok: False`) and cleans up the `0700` temp directory."""
    clear_discovery_cache()

    corrupt_bytes = b'{"VersionNumber": 26, "DataVersion": 4, "Coins": 12345, "TruncatedArray": [1, 2, '
    staging_root = tmp_path / "staging"
    staging_root.mkdir(parents=True, exist_ok=True)

    captured_temp_dirs: list[Path] = []
    captured_modes: list[int] = []

    def record_temp_dir(temp_dir: Path) -> None:
        captured_temp_dirs.append(temp_dir)
        captured_modes.append(stat.S_IMODE(temp_dir.stat().st_mode))

    def fake_run_adb(
        args: list[str],
        *,
        adb_path: str | None = None,
        serial: str | None = None,
        timeout: float | None = None,
        operation: str | None = None,
    ) -> AdbResult:
        if args == ["devices", "-l"]:
            return AdbResult(
                args=["adb", *args],
                returncode=0,
                stdout="List of devices attached\n54221FDAP0011M device model:Pixel_9_Pro\n",
                stderr="",
            )
        if args == ["ls", "/sdcard/Android/data/com.TechTreeGames.TheTower/files"]:
            return AdbResult(
                args=["adb", "-s", serial or "", *args],
                returncode=0,
                stdout="000081b0 00000050 6aee14f1 tool_export.json\n",
                stderr="",
            )
        if args[0] == "pull":
            dest = Path(args[2])
            dest.write_bytes(corrupt_bytes)
            return AdbResult(
                args=["adb", "-s", serial or "", *args],
                returncode=0,
                stdout="1 file pulled",
                stderr="",
            )
        return AdbResult(args=["adb", *args], returncode=0, stdout="", stderr="")

    with pytest.raises(InvalidExportJsonError) as exc_info:
        export_from_source(
            source="adb:54221FDAP0011M",
            home_dir=tmp_path,
            run_adb_fn=fake_run_adb,
            find_adb_fn=lambda **_: "/usr/bin/adb",
            temp_base_dir=staging_root,
            on_temp_dir_created=record_temp_dir,
        )

    assert exc_info.value.http_status == 422
    assert exc_info.value.code == "invalid_export_json"

    # Confirm the 0700 temp directory was created with mode 0o700 and completely removed on failure
    assert len(captured_temp_dirs) == 1
    assert captured_modes == [0o700]
    assert captured_temp_dirs[0].name.startswith("tf-link-")
    assert not captured_temp_dirs[0].exists()
    assert list(staging_root.iterdir()) == []

    # Verify HTTP GET /export returns 422 Unprocessable Entity with ok: False
    with _running_http_server(
        home_dir=tmp_path,
        find_adb_fn=lambda **_: "/usr/bin/adb",
        run_adb_fn=fake_run_adb,
    ) as srv:
        status, _, body = _http_get_raw(srv.server_port, "/export?refresh=true")
        assert status == 422
        payload = json.loads(body.decode("utf-8"))
        assert payload["ok"] is False
        assert payload["error"] == "invalid_export_json"


def test_pull_save_backup_computes_sha256_and_http_export_refuses_playerinfo_dat(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """Test Case 4: `pull_save_backup()` CLI helper pulls `playerInfo.dat` to `--output-dir` and computes its SHA-256 digest, while HTTP `/export` refuses any path parameter or attempt to read `playerInfo.dat`."""
    clear_discovery_cache()

    save_payload = b"TOWERFORGE_BINARY_SAVE_DATA_V26_\x00\x01\x02\xff"
    bak_payload = b"TOWERFORGE_BINARY_SAVE_BACKUP_V26"
    expected_save_sha256 = hashlib.sha256(save_payload).hexdigest()
    expected_bak_sha256 = hashlib.sha256(bak_payload).hexdigest()

    def fake_run_adb(
        args: list[str],
        *,
        adb_path: str | None = None,
        serial: str | None = None,
        timeout: float | None = None,
        operation: str | None = None,
    ) -> AdbResult:
        if args[0] == "pull":
            remote = args[1]
            dest = Path(args[2])
            if remote.endswith("playerInfo.dat"):
                dest.write_bytes(save_payload)
                return AdbResult(args=["adb", *args], returncode=0, stdout="1 file pulled", stderr="")
            if remote.endswith("playerInfo.dat.bak"):
                dest.write_bytes(bak_payload)
                return AdbResult(args=["adb", *args], returncode=0, stdout="1 file pulled", stderr="")
            return AdbResult(args=["adb", *args], returncode=1, stdout="", stderr="remote object does not exist")
        return AdbResult(args=["adb", *args], returncode=0, stdout="", stderr="")

    out_dir = tmp_path / "save_backups"
    backup_res = pull_save_backup(
        output_dir=out_dir,
        serial="54221FDAP0011M",
        run_adb_fn=fake_run_adb,
        find_adb_fn=lambda **_: "/usr/bin/adb",
    )

    assert backup_res["ok"] is True
    assert backup_res["sha256"] == expected_save_sha256
    assert backup_res["size"] == len(save_payload)

    pulled_save_file = out_dir / "playerInfo.dat"
    pulled_bak_file = out_dir / "playerInfo.dat.bak"
    assert pulled_save_file.is_file()
    assert pulled_save_file.read_bytes() == save_payload
    assert stat.S_IMODE(pulled_save_file.stat().st_mode) == 0o600
    assert pulled_bak_file.is_file()
    assert backup_res["files"]["playerInfo.dat.bak"]["sha256"] == expected_bak_sha256

    # Also test CLI entry point `pull --pull-save --output-dir <dir>` with local Waydroid fixture
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
    (waydroid_dir / "playerInfo.dat").write_bytes(save_payload)
    (waydroid_dir / "tool_export.json").write_text('{"VersionNumber": 26}', encoding="utf-8")

    cli_out_dir = tmp_path / "cli_backups"
    old_home = os.environ.get("HOME")
    os.environ["HOME"] = str(tmp_path)
    try:
        rc = cli_main(
            [
                "pull",
                "--source",
                "waydroid:local",
                "--pull-save",
                "--output-dir",
                str(cli_out_dir),
            ]
        )
    finally:
        if old_home is not None:
            os.environ["HOME"] = old_home

    assert rc == 0
    cli_stdout = capsys.readouterr().out
    cli_payload = json.loads(cli_stdout)
    assert cli_payload["ok"] is True
    assert cli_payload["sha256"] == expected_save_sha256
    assert (cli_out_dir / "playerInfo.dat").read_bytes() == save_payload

    # Verify `export_from_source()` refuses any direct or parameter attempt to read `playerInfo.dat`
    for forbidden_call in (
        {"source": "playerInfo.dat"},
        {"source": "../playerInfo.dat"},
        {"source": str(pulled_save_file)},
        {"path": "playerInfo.dat"},
        {"file": "playerInfo.dat"},
    ):
        with pytest.raises(ForbiddenExportTargetError):
            export_from_source(**forbidden_call)  # type: ignore[arg-type]

    # Verify HTTP `GET /export` refuses any query parameter or path attempting to read `playerInfo.dat`
    with _running_http_server(
        home_dir=tmp_path,
        find_adb_fn=lambda **_: "/usr/bin/adb",
        run_adb_fn=fake_run_adb,
    ) as srv:
        port = srv.server_port
        for forbidden_query in (
            "/export?path=playerInfo.dat",
            "/export?file=playerInfo.dat",
            "/export?filename=playerInfo.dat",
            "/export?target=/sdcard/Android/data/com.TechTreeGames.TheTower/files/playerInfo.dat",
            "/export?source=playerInfo.dat",
            "/export?source=../playerInfo.dat",
            "/export?pull_save=1",
        ):
            status, _, body = _http_get_raw(port, forbidden_query)
            assert status == 403, f"Expected 403 for {forbidden_query}, got {status}"
            err_body = json.loads(body.decode("utf-8"))
            assert err_body["ok"] is False
            assert err_body["error"] == "forbidden_export_target"


def test_export_from_source_raises_not_found_when_no_sources_exist(
    tmp_path: Path,
) -> None:
    """Verify `export_from_source()` raises `ExportSourceNotFoundError` when no sources are discovered."""
    clear_discovery_cache()
    with pytest.raises(ExportSourceNotFoundError) as exc_info:
        export_from_source(
            home_dir=tmp_path,
            find_adb_fn=lambda **_: "/usr/bin/adb",
            run_adb_fn=lambda args, **_: AdbResult(
                args=["adb", *args],
                returncode=0,
                stdout="List of devices attached\n\n",
                stderr="",
            ),
        )
    assert exc_info.value.http_status == 409
    assert exc_info.value.code == "no_export"


def test_exporter_cli_pull_export_and_parse_newer_than_branches(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """Verify `parse_newer_than`, `export_from_source(export_path=...)`, `pull_save_backup(include_export=True)`, and `run_cli_pull`."""
    from towerforge_link.exporter import (
        InvalidExportJsonError,
        parse_newer_than,
        run_cli_pull,
    )
    from towerforge_link.sources import DiscoveredSource

    assert parse_newer_than(None) is None
    assert parse_newer_than("") is None
    assert parse_newer_than("2026-01-01T00:00:00Z") is not None
    assert parse_newer_than("not-a-timestamp") is None
    assert parse_newer_than(1700000000) == 1700000000

    local_export = tmp_path / "tool_export.json"
    local_export.write_text('{"VersionNumber": 26, "Coins": 500}', encoding="utf-8")

    # Direct export_path and PathLike source resolution
    res_direct = export_from_source(export_path=local_export)
    assert res_direct["ok"] is True
    assert '"Coins": 500' in res_direct["data"]

    disc = DiscoveredSource(
        id="waydroid:local",
        label="Waydroid",
        kind="waydroid",
        state="ready",
        serial=None,
        export_modified=1700000000,
        has_save_data=True,
        export_path=str(local_export),
        save_path=str(tmp_path / "playerInfo.dat"),
    )
    res_disc = export_from_source(source=disc)
    assert res_disc["ok"] is True

    # Local pull_save_backup with .bak and include_export=True
    (tmp_path / "playerInfo.dat").write_bytes(b"SAVE_DATA_1")
    (tmp_path / "playerInfo.dat.bak").write_bytes(b"SAVE_BAK_1")
    local_backup_dir = tmp_path / "local_backup_out"
    local_backup = pull_save_backup(
        output_dir=local_backup_dir,
        source=disc,
        include_export=True,
    )
    assert "playerInfo.dat" in local_backup["files"]
    assert "playerInfo.dat.bak" in local_backup["files"]
    assert "tool_export.json" in local_backup["files"]

    # ADB pull_save_backup with include_export=True
    def fake_adb_pull_all(args: list[str], **_: Any) -> AdbResult:
        if args[0] == "pull":
            remote, dest = args[1], Path(args[2])
            if remote.endswith("playerInfo.dat"):
                dest.write_bytes(b"ADB_SAVE")
                return AdbResult(args=["adb", *args], returncode=0, stdout="ok", stderr="")
            if remote.endswith("tool_export.json"):
                dest.write_text('{"VersionNumber": 26}', encoding="utf-8")
                return AdbResult(args=["adb", *args], returncode=0, stdout="ok", stderr="")
        return AdbResult(args=["adb", *args], returncode=1, stdout="", stderr="missing")

    adb_backup_dir = tmp_path / "adb_backup_out"
    adb_backup = pull_save_backup(
        output_dir=adb_backup_dir,
        serial="54221FDAP0011M",
        sources=[
            {
                "id": "adb:54221FDAP0011M",
                "serial": "54221FDAP0011M",
                "label": "Pixel",
                "name": "Pixel",
                "kind": "phone",
                "state": "ready",
                "has_save_data": True,
                "save_path": "/sdcard/Android/data/com.TechTreeGames.TheTower/files/playerInfo.dat",
                "export_path": "/sdcard/Android/data/com.TechTreeGames.TheTower/files/tool_export.json",
            }
        ],
        include_export=True,
        run_adb_fn=fake_adb_pull_all,
        find_adb_fn=lambda **_: "/usr/bin/adb",
    )
    assert "tool_export.json" in adb_backup["files"]

    # run_cli_pull(pull_save=False) success and failure
    cli_export_dir = tmp_path / "cli_export_out"
    rc_ok = run_cli_pull(
        source=str(local_export),
        pull_save=False,
        output_dir=cli_export_dir,
    )
    assert rc_ok == 0
    capsys.readouterr()
    assert (cli_export_dir / "tool_export.json").is_file()

    rc_err = run_cli_pull(
        source="missing:source",
        pull_save=False,
        output_dir=cli_export_dir,
        find_adb_fn=lambda **_: "/usr/bin/adb",
        run_adb_fn=lambda args, **_: AdbResult(args=["adb", *args], returncode=0, stdout="List of devices attached\n\n", stderr=""),
    )
    assert rc_err == 1
    capsys.readouterr()

    # Empty and array JSON validation error branches
    empty_json = tmp_path / "empty.json"
    empty_json.write_text("", encoding="utf-8")
    with pytest.raises(InvalidExportJsonError):
        export_from_source(export_path=empty_json)

    array_json = tmp_path / "array.json"
    array_json.write_text("[1, 2, 3]", encoding="utf-8")
    with pytest.raises(InvalidExportJsonError):
        export_from_source(export_path=array_json)

