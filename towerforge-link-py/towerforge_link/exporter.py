"""Hardened game data exporter and CLI save backup helper (`exporter.py`).

Implements:
- `export_from_source()`:
  - Resolves the requested `source` ID (or selects the newest discovered source
    with `has_save_data=True` / `export_path`).
  - Refuses any request or parameter (`path`, `file`, `filename`, `target`, or
    `source`) attempting to read `playerInfo.dat` or traverse directories (`..`).
  - Creates an ephemeral staging directory via
    `tempfile.TemporaryDirectory(prefix="tf-link-")` with explicit `0o700`
    permissions and guarantees cleanup on both success and error paths.
  - Pulls `tool_export.json` via sandboxed `adb -s <serial> pull <remote> <local>`
    (`shell=False`, `TIMEOUT_PULL`) for ADB sources, or reads directly from verified
    local host paths for Waydroid and macOS containers.
  - Enforces a hard `8 MiB` (`MAX_EXPORT_BYTES = 8 * 1024 * 1024 = 8_388_608` bytes)
    size cap before reading file contents into memory.
  - Validates JSON syntax via `json.loads(raw_text)` and returns the exact,
    unmodified `raw_text` string (never re-serializing with `json.dumps()`).
- `handle_http_export()`:
  - Wires `GET /export` in `http_server.py` with `X-Export-Modified`,
    `X-Export-Source`, and `X-Export-Source-Id` headers, `newerThan` (`204 No Content`)
    support, and HTTP `413` / `422` / `403` / `409` error mapping.
- `pull_save_backup()` & `run_cli_pull()`:
  - CLI-only helper for `python3 -m towerforge_link pull --pull-save --output-dir <dir>`
    that pulls `playerInfo.dat` (and `playerInfo.dat.bak` if available) into a
    local directory and computes SHA-256 digests. Never exposed over HTTP.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import sys
import tempfile
from typing import Any

from .adb_finder import AdbError, find_adb
from .adb_runner import TIMEOUT_PULL, TIMEOUT_STATUS, AdbResult, run_adb, validate_serial
from .sources import (
    CANDIDATE_ADB_EXPORT_PATHS,
    CANDIDATE_ADB_SAVE_PATHS,
    EXPORT_FILENAME,
    SAVE_FILENAME,
    DiscoveredSource,
    discover_sources,
    is_refresh_requested,
)

MAX_EXPORT_BYTES: int = 8 * 1024 * 1024  # 8_388_608 bytes (8 MiB)
TEMP_DIR_PREFIX: str = "tf-link-"
SAVE_BACKUP_FILENAMES: tuple[str, ...] = (SAVE_FILENAME, f"{SAVE_FILENAME}.bak")

FORBIDDEN_QUERY_KEYS: frozenset[str] = frozenset(
    {
        "path",
        "file",
        "filename",
        "target",
        "save",
        "save_path",
        "savePath",
        "pull_save",
        "pull-save",
        "pullSave",
    }
)


class ExporterError(Exception):
    """Base exception for TowerForge Link export and CLI pull errors."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "export_failed",
        http_status: int = 409,
    ) -> None:
        super().__init__(message)
        self.message: str = message
        self.code: str = code
        self.http_status: int = http_status


class PayloadTooLargeError(ExporterError):
    """Raised when an export file exceeds `MAX_EXPORT_BYTES` (8 MiB / 8,388,608 bytes)."""

    def __init__(self, message: str = "Export file exceeds the 8 MiB maximum size limit.") -> None:
        super().__init__(message, code="payload_too_large", http_status=413)


class InvalidExportJsonError(ExporterError, ValueError):
    """Raised when `tool_export.json` is empty, corrupt, truncated, or invalid JSON."""

    def __init__(self, message: str = "Export file contains corrupt or invalid JSON.") -> None:
        super().__init__(message, code="invalid_export_json", http_status=422)


class ForbiddenExportTargetError(ExporterError, PermissionError):
    """Raised when a caller attempts to export `playerInfo.dat` or traverse paths over HTTP."""

    def __init__(
        self,
        message: str = "Exporting playerInfo.dat or custom file paths over HTTP is forbidden.",
    ) -> None:
        super().__init__(message, code="forbidden_export_target", http_status=403)


class ExportSourceNotFoundError(ExporterError, LookupError):
    """Raised when no valid game export source is available or the requested source ID is missing."""

    def __init__(
        self,
        message: str = "No TowerForge export source is currently available.",
        *,
        code: str = "no_export",
        http_status: int = 409,
    ) -> None:
        super().__init__(message, code=code, http_status=http_status)


def _contains_forbidden_save_or_traversal(value: str) -> bool:
    """Return `True` if `value` references `playerInfo.dat` or path traversal sequences."""
    if not isinstance(value, str):
        return False
    lower = value.strip().lower()
    if not lower:
        return False
    if "\x00" in lower:
        return True
    if ".." in lower.replace("\\", "/").split("/") or ".." in lower:
        return True
    if "playerinfo" in lower or lower.endswith(".dat") or lower.endswith(".dat.bak"):
        return True
    return False


def validate_http_export_query(query: Mapping[str, str] | None) -> None:
    """Validate HTTP `/export` query parameters and block any `playerInfo.dat` or path injection.

    Raises:
        ForbiddenExportTargetError: If any forbidden parameter (`path`, `file`, etc.) or
            any reference to `playerInfo.dat` / `..` is present in `query`.
    """
    if not query:
        return

    for raw_key, raw_val in query.items():
        key_clean = str(raw_key).strip()
        val_clean = str(raw_val).strip()
        if key_clean in FORBIDDEN_QUERY_KEYS or key_clean.lower() in {
            k.lower() for k in FORBIDDEN_QUERY_KEYS
        }:
            raise ForbiddenExportTargetError(
                f"Query parameter {key_clean!r} is forbidden on GET /export; only tool_export.json may be exported."
            )
        if _contains_forbidden_save_or_traversal(key_clean) or _contains_forbidden_save_or_traversal(
            val_clean
        ):
            raise ForbiddenExportTargetError(
                "Refusing request referencing playerInfo.dat or path traversal on GET /export."
            )


def parse_newer_than(raw_value: int | float | str | None) -> int | None:
    """Parse an optional `newerThan` value (Unix seconds or ISO-8601 UTC string) into integer seconds."""
    if raw_value is None:
        return None
    if isinstance(raw_value, (int, float)):
        int_val = int(raw_value)
        return int_val if int_val > 0 else None
    if not isinstance(raw_value, str):
        return None

    cleaned = raw_value.strip()
    if not cleaned:
        return None

    try:
        numeric = int(float(cleaned))
        return numeric if numeric > 0 else None
    except ValueError:
        pass

    try:
        iso_normalized = cleaned[:-1] + "+00:00" if cleaned.endswith(("Z", "z")) else cleaned
        dt = datetime.fromisoformat(iso_normalized)
        ts = int(dt.timestamp())
        return ts if ts > 0 else None
    except ValueError:
        return None


def _normalize_source_dict(item: Mapping[str, Any] | DiscoveredSource) -> dict[str, Any]:
    """Convert a `DiscoveredSource` or mapping into a normalized plain dictionary."""
    if isinstance(item, DiscoveredSource):
        return item.to_dict()
    return dict(item)


def _validate_export_file_path(export_path: str) -> None:
    """Ensure `export_path` targets `tool_export.json` and never `playerInfo.dat` or `..`."""
    if not export_path or "\x00" in export_path:
        raise ForbiddenExportTargetError("Invalid empty or NUL-containing export path.")
    normalized = export_path.replace("\\", "/")
    parts = [p for p in normalized.split("/") if p]
    if ".." in parts:
        raise ForbiddenExportTargetError(
            f"Path traversal sequence '..' is forbidden in export path: {export_path!r}"
        )
    basename = parts[-1].lower() if parts else ""
    if "playerinfo" in basename or basename.endswith(".dat") or basename.endswith(".dat.bak"):
        raise ForbiddenExportTargetError(
            f"Refusing to read save file {basename!r} through export interface."
        )


def _read_and_validate_export_file(file_path: Path) -> tuple[str, int]:
    """Enforce the 8 MiB size cap prior to reading into memory, then validate UTF-8 JSON syntax.

    Returns:
        `(raw_text, mtime_seconds)` where `raw_text` is the exact, unmodified file content.

    Raises:
        ForbiddenExportTargetError: If `file_path` is not a regular file or is a symlink.
        PayloadTooLargeError: If `st_size > MAX_EXPORT_BYTES` (`8_388_608` bytes).
        InvalidExportJsonError: If the file cannot be decoded as UTF-8 or fails `json.loads()`.
    """
    try:
        lstat_res = os.lstat(file_path)
    except FileNotFoundError as exc:
        raise ExportSourceNotFoundError(
            f"Export file does not exist: {file_path}",
            code="no_export",
            http_status=409,
        ) from exc
    except OSError as exc:
        raise ExporterError(
            f"Unable to stat export file '{file_path}': {exc}",
            code="read_failed",
            http_status=409,
        ) from exc

    if stat.S_ISLNK(lstat_res.st_mode):
        raise ForbiddenExportTargetError(
            f"Refusing to follow symlink for export file: {file_path}"
        )
    if not stat.S_ISREG(lstat_res.st_mode):
        raise ForbiddenExportTargetError(
            f"Export path is not a regular file: {file_path}"
        )

    if lstat_res.st_size > MAX_EXPORT_BYTES:
        raise PayloadTooLargeError(
            f"Export file size ({lstat_res.st_size} bytes) exceeds maximum allowed "
            f"8 MiB cap ({MAX_EXPORT_BYTES} bytes)."
        )

    try:
        with open(file_path, "rb") as fh:
            raw_bytes = fh.read(MAX_EXPORT_BYTES + 1)
    except OSError as exc:
        raise ExporterError(
            f"Failed to read export file '{file_path}': {exc}",
            code="read_failed",
            http_status=409,
        ) from exc

    if len(raw_bytes) > MAX_EXPORT_BYTES:
        raise PayloadTooLargeError(
            f"Export file stream exceeded maximum allowed 8 MiB cap ({MAX_EXPORT_BYTES} bytes)."
        )

    if not raw_bytes:
        raise InvalidExportJsonError("Export file is empty (0 bytes).")

    try:
        raw_text = raw_bytes.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise InvalidExportJsonError(
            f"Export file is not valid UTF-8 text: {exc}"
        ) from exc

    if not raw_text.strip():
        raise InvalidExportJsonError("Export file contains only whitespace.")

    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise InvalidExportJsonError(
            f"Export file contains corrupt or truncated JSON at line {exc.lineno} column {exc.colno}: {exc.msg}"
        ) from exc

    if not isinstance(parsed, dict):
        raise InvalidExportJsonError(
            "Export JSON root must be a JSON object."
        )

    mtime_seconds = int(lstat_res.st_mtime) if lstat_res.st_mtime > 0 else 0
    return raw_text, mtime_seconds


def _resolve_target_source(
    source: str | os.PathLike[str] | Mapping[str, Any] | DiscoveredSource | None,
    *,
    sources: Sequence[Mapping[str, Any] | DiscoveredSource] | None = None,
    export_path: str | os.PathLike[str] | None = None,
    adb_path: str | None = None,
    home_dir: str | os.PathLike[str] | None = None,
    refresh: bool = False,
    run_adb_fn: Callable[..., AdbResult] | None = None,
    find_adb_fn: Callable[..., str] | None = None,
) -> dict[str, Any]:
    """Resolve the requested source specification into a single source dictionary."""
    if export_path is not None:
        exp_str = os.fspath(export_path)
        _validate_export_file_path(exp_str)
        return {
            "id": "local:file",
            "name": "Local Export File",
            "label": "Local Export File",
            "kind": "local",
            "state": "ready",
            "serial": None,
            "export_modified": None,
            "has_save_data": True,
            "export_path": exp_str,
            "save_path": None,
        }

    if isinstance(source, (Mapping, DiscoveredSource)):
        src_dict = _normalize_source_dict(source)
        raw_id = str(src_dict.get("id") or "")
        raw_exp = src_dict.get("export_path")
        if _contains_forbidden_save_or_traversal(raw_id):
            raise ForbiddenExportTargetError(
                f"Forbidden source identifier: {raw_id!r}"
            )
        if raw_exp is not None:
            _validate_export_file_path(str(raw_exp))
        return src_dict

    if isinstance(source, os.PathLike):
        path_str = os.fspath(source)
        _validate_export_file_path(path_str)
        return {
            "id": "local:file",
            "name": "Local Export File",
            "label": "Local Export File",
            "kind": "local",
            "state": "ready",
            "serial": None,
            "export_modified": None,
            "has_save_data": True,
            "export_path": path_str,
            "save_path": None,
        }

    if isinstance(source, str):
        cleaned_source = source.strip()
        if _contains_forbidden_save_or_traversal(cleaned_source):
            raise ForbiddenExportTargetError(
                f"Refusing forbidden export source or path: {cleaned_source!r}"
            )
        # Support passing a direct local file path string in tests or CLI
        if (os.path.isabs(cleaned_source) or cleaned_source.endswith(".json")) and os.path.lexists(
            cleaned_source
        ):
            _validate_export_file_path(cleaned_source)
            return {
                "id": "local:file",
                "name": "Local Export File",
                "label": "Local Export File",
                "kind": "local",
                "state": "ready",
                "serial": None,
                "export_modified": None,
                "has_save_data": True,
                "export_path": cleaned_source,
                "save_path": None,
            }
    else:
        cleaned_source = None

    if sources is not None:
        candidate_list = [_normalize_source_dict(s) for s in sources]
    else:
        discovery = discover_sources(
            adb_path=adb_path,
            home_dir=home_dir,
            refresh=refresh,
            run_adb_fn=run_adb_fn,
            find_adb_fn=find_adb_fn,
        )
        candidate_list = [
            _normalize_source_dict(s) for s in discovery.get("sources", [])
        ]

    if cleaned_source:
        for cand in candidate_list:
            cand_id = str(cand.get("id") or "")
            cand_serial = str(cand.get("serial") or "")
            if cleaned_source in {cand_id, cand_serial} or (
                cand_serial and cleaned_source == f"adb:{cand_serial}"
            ):
                return cand
        raise ExportSourceNotFoundError(
            f"Requested export source {cleaned_source!r} was not found.",
            code="source_not_found",
            http_status=404,
        )

    # Default selection: first source with an export_path, else first source with has_save_data=True
    for cand in candidate_list:
        if cand.get("export_path") and cand.get("state") == "ready":
            return cand
    for cand in candidate_list:
        if cand.get("has_save_data"):
            return cand

    if candidate_list:
        first = candidate_list[0]
        state = str(first.get("state") or "no_export")
        msg = str(
            first.get("message")
            or f"No TowerForge game export ({EXPORT_FILENAME}) available on {first.get('label') or first.get('id')}."
        )
        raise ExportSourceNotFoundError(msg, code=state, http_status=409)

    raise ExportSourceNotFoundError(
        "No connected Android device, emulator, Waydroid instance, or macOS container with game data was found.",
        code="no_export",
        http_status=409,
    )


def export_from_source(
    source: str | os.PathLike[str] | Mapping[str, Any] | DiscoveredSource | None = None,
    *,
    sources: Sequence[Mapping[str, Any] | DiscoveredSource] | None = None,
    export_path: str | os.PathLike[str] | None = None,
    adb_path: str | None = None,
    home_dir: str | os.PathLike[str] | None = None,
    refresh: bool = False,
    newer_than: int | float | str | None = None,
    run_adb_fn: Callable[..., AdbResult] | None = None,
    find_adb_fn: Callable[..., str] | None = None,
    temp_base_dir: str | os.PathLike[str] | None = None,
    on_temp_dir_created: Callable[[Path], None] | None = None,
    path: str | None = None,
    file: str | None = None,
) -> dict[str, Any]:
    """Export `tool_export.json` from `source` using a `0700` staging directory and 8 MiB cap.

    Steps:
      1. Reject any `path`/`file` override or `playerInfo.dat` / `..` reference.
      2. Resolve the requested `source` (or first source with `has_save_data=True`).
      3. Create an ephemeral staging directory via `tempfile.TemporaryDirectory(prefix="tf-link-")`
         and enforce `0o700` permissions.
      4. Pull `tool_export.json` via `adb -s <serial> pull <remote_path> <local_temp_file>`
         (or read from the local host path for Waydroid/macOS container sources).
      5. Enforce `MAX_EXPORT_BYTES = 8 * 1024 * 1024` (`8_388_608` bytes) before reading into memory.
      6. Validate JSON structure with `json.loads(raw_text)` and return
         `{"ok": True, "data": raw_text, "source": target_source, "modified": modified_ts}`
         where `data` is the exact, unmodified raw string.
    """
    if path is not None or file is not None:
        raise ForbiddenExportTargetError(
            "Custom file or path parameters are forbidden; exporter strictly reads tool_export.json."
        )

    target_source = _resolve_target_source(
        source,
        sources=sources,
        export_path=export_path,
        adb_path=adb_path,
        home_dir=home_dir,
        refresh=refresh,
        run_adb_fn=run_adb_fn,
        find_adb_fn=find_adb_fn,
    )

    state = str(target_source.get("state") or "ready")
    if state in {"unauthorized", "offline"}:
        raise ExportSourceNotFoundError(
            str(target_source.get("message") or f"Source {target_source.get('label')} is {state}."),
            code=state,
            http_status=409,
        )

    resolved_export_path = target_source.get("export_path")
    serial = target_source.get("serial")
    if not resolved_export_path:
        if serial:
            resolved_export_path = CANDIDATE_ADB_EXPORT_PATHS[0]
        else:
            raise ExportSourceNotFoundError(
                str(
                    target_source.get("message")
                    or f"No {EXPORT_FILENAME} found on {target_source.get('label') or target_source.get('id')}."
                ),
                code="no_export",
                http_status=409,
            )

    resolved_export_str = str(resolved_export_path)
    _validate_export_file_path(resolved_export_str)

    known_modified = target_source.get("export_modified")
    newer_than_ts = parse_newer_than(newer_than)
    if (
        newer_than_ts is not None
        and isinstance(known_modified, (int, float))
        and int(known_modified) > 0
        and int(known_modified) <= newer_than_ts
    ):
        return {
            "ok": True,
            "unchanged": True,
            "data": "",
            "source": target_source,
            "modified": int(known_modified),
        }

    runner = run_adb if run_adb_fn is None else run_adb_fn
    locator = find_adb if find_adb_fn is None else find_adb_fn

    with tempfile.TemporaryDirectory(
        prefix=TEMP_DIR_PREFIX,
        dir=os.fspath(temp_base_dir) if temp_base_dir is not None else None,
    ) as tmp_dir_name:
        tmp_dir = Path(tmp_dir_name)
        try:
            os.chmod(tmp_dir, 0o700)
            if on_temp_dir_created is not None:
                on_temp_dir_created(tmp_dir)

            if serial is not None:
                validated_serial = validate_serial(str(serial))
                resolved_adb = (
                    adb_path
                    if adb_path is not None
                    else (locator(explicit_path=adb_path) if find_adb_fn is not None or run_adb_fn is None else "/usr/bin/adb")
                )
                staged_file = tmp_dir / EXPORT_FILENAME
                try:
                    pull_res = runner(
                        ["pull", resolved_export_str, str(staged_file)],
                        adb_path=resolved_adb,
                        serial=validated_serial,
                        timeout=TIMEOUT_PULL,
                        operation="pull",
                    )
                except AdbError as exc:
                    raise ExporterError(
                        f"ADB pull failed for {validated_serial}: {exc}",
                        code="pull_failed",
                        http_status=409,
                    ) from exc

                if not pull_res.ok or not staged_file.exists():
                    err_detail = (pull_res.stderr or pull_res.stdout).strip() or "adb pull failed"
                    raise ExportSourceNotFoundError(
                        f"Unable to pull {EXPORT_FILENAME} from {target_source.get('label') or validated_serial}: {err_detail}",
                        code="no_export",
                        http_status=409,
                    )
                os.chmod(staged_file, 0o600)
                raw_text, file_mtime = _read_and_validate_export_file(staged_file)
            else:
                local_file = Path(resolved_export_str)
                raw_text, file_mtime = _read_and_validate_export_file(local_file)
        finally:
            # Explicitly purge any staged files before TemporaryDirectory cleanup exits
            shutil.rmtree(tmp_dir, ignore_errors=True)

    effective_modified = (
        int(known_modified)
        if isinstance(known_modified, (int, float)) and int(known_modified) > 0
        else (file_mtime if file_mtime > 0 else None)
    )

    if (
        newer_than_ts is not None
        and effective_modified is not None
        and effective_modified <= newer_than_ts
    ):
        return {
            "ok": True,
            "unchanged": True,
            "data": "",
            "source": target_source,
            "modified": effective_modified,
        }

    return {
        "ok": True,
        "unchanged": False,
        "data": raw_text,
        "source": target_source,
        "modified": effective_modified,
    }


def handle_http_export(
    server: Any,
    query: Mapping[str, str] | None = None,
) -> tuple[int, dict[str, str], bytes | dict[str, Any]]:
    """Handle `GET /export` for `TowerForgeHTTPServer`.

    Enforces query parameter allowlisting (refusing any attempt to read `playerInfo.dat`),
    honors `?source=<id>`, `?newerThan=<ts>`, and `?refresh=true`, and emits
    `X-Export-Modified`, `X-Export-Source`, and `X-Export-Source-Id` headers.
    """
    active_query = dict(query or {})
    try:
        validate_http_export_query(active_query)

        requested_source = active_query.get("source")
        if requested_source is not None:
            requested_source = requested_source.strip() or None

        newer_than_raw = active_query.get("newerThan") or active_query.get("newer_than")
        refresh = is_refresh_requested(active_query)

        result = export_from_source(
            source=requested_source,
            adb_path=getattr(server, "adb_path", None),
            home_dir=getattr(server, "home_dir", None),
            refresh=refresh,
            newer_than=newer_than_raw,
            run_adb_fn=getattr(server, "run_adb_fn", None),
            find_adb_fn=getattr(server, "find_adb_fn", None),
        )
    except ExporterError as exc:
        return (
            exc.http_status,
            {},
            {
                "ok": False,
                "error": exc.code,
                "message": exc.message,
            },
        )
    except Exception as exc:  # pragma: no cover - defensive fallback
        return (
            500,
            {},
            {
                "ok": False,
                "error": "failed",
                "message": f"TowerForge Link hit an error: {exc}",
            },
        )

    src_info = result.get("source") or {}
    source_label = str(src_info.get("label") or src_info.get("name") or "your emulator")
    source_id = str(src_info.get("id") or "")
    modified_val = result.get("modified")

    extra_headers: dict[str, str] = {
        "X-Export-Source": source_label,
    }
    if source_id:
        extra_headers["X-Export-Source-Id"] = source_id
    if isinstance(modified_val, (int, float)) and int(modified_val) > 0:
        extra_headers["X-Export-Modified"] = str(int(modified_val))

    if result.get("unchanged"):
        return 204, extra_headers, b""

    raw_text: str = result["data"]
    envelope_flag = (active_query.get("envelope") or active_query.get("format") or "").strip().lower()
    if envelope_flag in {"1", "true", "yes", "envelope"}:
        return (
            200,
            extra_headers,
            {
                "ok": True,
                "data": raw_text,
                "source": src_info,
                "modified": modified_val,
            },
        )

    return 200, extra_headers, raw_text.encode("utf-8")


def _sha256_file(path: Path) -> tuple[str, int]:
    """Compute the lowercase hex SHA-256 digest and byte size of `path`."""
    hasher = hashlib.sha256()
    total = 0
    with open(path, "rb") as fh:
        while True:
            chunk = fh.read(65536)
            if not chunk:
                break
            hasher.update(chunk)
            total += len(chunk)
    return hasher.hexdigest(), total


def pull_save_backup(
    output_dir: str | os.PathLike[str] = ".",
    *,
    serial: str | None = None,
    source: str | Mapping[str, Any] | DiscoveredSource | None = None,
    sources: Sequence[Mapping[str, Any] | DiscoveredSource] | None = None,
    adb_path: str | None = None,
    home_dir: str | os.PathLike[str] | None = None,
    include_export: bool = False,
    run_adb_fn: Callable[..., AdbResult] | None = None,
    find_adb_fn: Callable[..., str] | None = None,
) -> dict[str, Any]:
    """CLI-only helper to pull `playerInfo.dat` (and `playerInfo.dat.bak` if present) into `output_dir`.

    Computes and verifies the SHA-256 digest of every pulled file. Never exposed via HTTP.
    """
    runner = run_adb if run_adb_fn is None else run_adb_fn
    locator = find_adb if find_adb_fn is None else find_adb_fn

    target_source: dict[str, Any] | None = None
    if isinstance(source, (Mapping, DiscoveredSource)):
        target_source = _normalize_source_dict(source)
    elif serial is not None:
        validated_serial = validate_serial(serial)
        if sources is not None:
            for item in sources:
                norm = _normalize_source_dict(item)
                if norm.get("serial") == validated_serial or norm.get("id") == f"adb:{validated_serial}":
                    target_source = norm
                    break
        if target_source is None:
            target_source = {
                "id": f"adb:{validated_serial}",
                "label": f"Android Device ({validated_serial})",
                "name": f"Android Device ({validated_serial})",
                "kind": "phone",
                "state": "ready",
                "serial": validated_serial,
                "has_save_data": True,
                "save_path": None,
                "export_path": None,
            }
    else:
        target_source = _resolve_target_source(
            source,
            sources=sources,
            adb_path=adb_path,
            home_dir=home_dir,
            refresh=True,
            run_adb_fn=run_adb_fn,
            find_adb_fn=find_adb_fn,
        )

    dest_dir = Path(output_dir).expanduser().resolve()
    dest_dir.mkdir(parents=True, exist_ok=True)

    target_serial = target_source.get("serial")
    known_save_path = target_source.get("save_path")
    known_export_path = target_source.get("export_path")

    pulled_files: dict[str, dict[str, Any]] = {}

    with tempfile.TemporaryDirectory(prefix=TEMP_DIR_PREFIX) as tmp_dir_name:
        tmp_dir = Path(tmp_dir_name)
        os.chmod(tmp_dir, 0o700)

        if target_serial is not None:
            validated_serial = validate_serial(str(target_serial))
            resolved_adb = (
                adb_path
                if adb_path is not None
                else (locator(explicit_path=adb_path) if find_adb_fn is not None or run_adb_fn is None else "/usr/bin/adb")
            )

            candidate_save_paths: list[str] = []
            if known_save_path:
                candidate_save_paths.append(str(known_save_path))
            for cand_path in CANDIDATE_ADB_SAVE_PATHS:
                if cand_path not in candidate_save_paths:
                    candidate_save_paths.append(cand_path)

            staged_save = tmp_dir / SAVE_FILENAME
            pulled_remote_save: str | None = None
            last_err = ""

            for remote_save in candidate_save_paths:
                res = runner(
                    ["pull", remote_save, str(staged_save)],
                    adb_path=resolved_adb,
                    serial=validated_serial,
                    timeout=TIMEOUT_PULL,
                    operation="pull",
                )
                if res.ok and staged_save.is_file():
                    pulled_remote_save = remote_save
                    break
                last_err = (res.stderr or res.stdout).strip()

            if pulled_remote_save is None or not staged_save.is_file():
                raise ExportSourceNotFoundError(
                    f"Unable to pull {SAVE_FILENAME} from {validated_serial}: {last_err or 'file not found'}",
                    code="no_save",
                    http_status=404,
                )

            final_save = dest_dir / SAVE_FILENAME
            shutil.copy2(staged_save, final_save)
            os.chmod(final_save, 0o600)
            save_sha256, save_size = _sha256_file(final_save)
            pulled_files[SAVE_FILENAME] = {
                "filename": SAVE_FILENAME,
                "remote_path": pulled_remote_save,
                "path": str(final_save),
                "sha256": save_sha256,
                "size": save_size,
            }

            # Optional playerInfo.dat.bak backup pull
            remote_bak = f"{pulled_remote_save}.bak"
            staged_bak = tmp_dir / f"{SAVE_FILENAME}.bak"
            bak_res = runner(
                ["pull", remote_bak, str(staged_bak)],
                adb_path=resolved_adb,
                serial=validated_serial,
                timeout=TIMEOUT_PULL,
                operation="pull",
            )
            if bak_res.ok and staged_bak.is_file():
                final_bak = dest_dir / f"{SAVE_FILENAME}.bak"
                shutil.copy2(staged_bak, final_bak)
                os.chmod(final_bak, 0o600)
                bak_sha256, bak_size = _sha256_file(final_bak)
                pulled_files[f"{SAVE_FILENAME}.bak"] = {
                    "filename": f"{SAVE_FILENAME}.bak",
                    "remote_path": remote_bak,
                    "path": str(final_bak),
                    "sha256": bak_sha256,
                    "size": bak_size,
                }

            if include_export:
                remote_export = (
                    str(known_export_path)
                    if known_export_path
                    else str(Path(pulled_remote_save).parent / EXPORT_FILENAME)
                )
                staged_export = tmp_dir / EXPORT_FILENAME
                exp_res = runner(
                    ["pull", remote_export, str(staged_export)],
                    adb_path=resolved_adb,
                    serial=validated_serial,
                    timeout=TIMEOUT_PULL,
                    operation="pull",
                )
                if exp_res.ok and staged_export.is_file():
                    _read_and_validate_export_file(staged_export)
                    final_export = dest_dir / EXPORT_FILENAME
                    shutil.copy2(staged_export, final_export)
                    os.chmod(final_export, 0o600)
                    exp_sha256, exp_size = _sha256_file(final_export)
                    pulled_files[EXPORT_FILENAME] = {
                        "filename": EXPORT_FILENAME,
                        "remote_path": remote_export,
                        "path": str(final_export),
                        "sha256": exp_sha256,
                        "size": exp_size,
                    }
        else:
            if not known_save_path:
                raise ExportSourceNotFoundError(
                    f"Source {target_source.get('id')} does not have a {SAVE_FILENAME} path.",
                    code="no_save",
                    http_status=404,
                )
            src_save = Path(str(known_save_path))
            if not src_save.is_file():
                raise ExportSourceNotFoundError(
                    f"Local save file does not exist: {src_save}",
                    code="no_save",
                    http_status=404,
                )
            final_save = dest_dir / SAVE_FILENAME
            shutil.copy2(src_save, final_save)
            os.chmod(final_save, 0o600)
            save_sha256, save_size = _sha256_file(final_save)
            pulled_files[SAVE_FILENAME] = {
                "filename": SAVE_FILENAME,
                "remote_path": str(src_save),
                "path": str(final_save),
                "sha256": save_sha256,
                "size": save_size,
            }

            src_bak = Path(f"{src_save}.bak")
            if src_bak.is_file():
                final_bak = dest_dir / f"{SAVE_FILENAME}.bak"
                shutil.copy2(src_bak, final_bak)
                os.chmod(final_bak, 0o600)
                bak_sha256, bak_size = _sha256_file(final_bak)
                pulled_files[f"{SAVE_FILENAME}.bak"] = {
                    "filename": f"{SAVE_FILENAME}.bak",
                    "remote_path": str(src_bak),
                    "path": str(final_bak),
                    "sha256": bak_sha256,
                    "size": bak_size,
                }

            if include_export and known_export_path:
                src_exp = Path(str(known_export_path))
                if src_exp.is_file():
                    _read_and_validate_export_file(src_exp)
                    final_export = dest_dir / EXPORT_FILENAME
                    shutil.copy2(src_exp, final_export)
                    os.chmod(final_export, 0o600)
                    exp_sha256, exp_size = _sha256_file(final_export)
                    pulled_files[EXPORT_FILENAME] = {
                        "filename": EXPORT_FILENAME,
                        "remote_path": str(src_exp),
                        "path": str(final_export),
                        "sha256": exp_sha256,
                        "size": exp_size,
                    }

    primary = pulled_files[SAVE_FILENAME]
    return {
        "ok": True,
        "output_dir": str(dest_dir),
        "path": primary["path"],
        "save_path": primary["path"],
        "sha256": primary["sha256"],
        "size": primary["size"],
        "files": pulled_files,
        "source": target_source,
    }


def run_cli_pull(
    *,
    adb_path: str | None = None,
    serial: str | None = None,
    source: str | None = None,
    pull_save: bool = False,
    output_dir: str | os.PathLike[str] = ".",
    run_adb_fn: Callable[..., AdbResult] | None = None,
    find_adb_fn: Callable[..., str] | None = None,
) -> int:
    """Execute the `towerforge-link pull` CLI command."""
    dest_dir = Path(output_dir).expanduser().resolve()
    dest_dir.mkdir(parents=True, exist_ok=True)

    try:
        if pull_save:
            backup_res = pull_save_backup(
                output_dir=dest_dir,
                serial=serial,
                source=source,
                adb_path=adb_path,
                include_export=True,
                run_adb_fn=run_adb_fn,
                find_adb_fn=find_adb_fn,
            )
            print(json.dumps(backup_res, indent=2))
            return 0

        export_res = export_from_source(
            source=source or serial,
            adb_path=adb_path,
            refresh=True,
            run_adb_fn=run_adb_fn,
            find_adb_fn=find_adb_fn,
        )
        raw_text: str = export_res["data"]
        out_file = dest_dir / EXPORT_FILENAME
        out_file.write_bytes(raw_text.encode("utf-8"))
        os.chmod(out_file, 0o600)
        digest, size = _sha256_file(out_file)
        summary = {
            "ok": True,
            "output_dir": str(dest_dir),
            "path": str(out_file),
            "sha256": digest,
            "size": size,
            "modified": export_res.get("modified"),
            "source": export_res.get("source"),
        }
        print(json.dumps(summary, indent=2))
        return 0
    except (ExporterError, AdbError) as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": getattr(exc, "code", "pull_failed"),
                    "message": str(exc),
                },
                indent=2,
            ),
            file=sys.stderr,
        )
        return 1
