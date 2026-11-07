#!/usr/bin/env python3
"""Deterministic, reproducible `.pyz` zipapp builder for `towerforge-link-py`.

Packages `towerforge_link` into `towerforge.client/public/downloads/towerforge-link.pyz`
with:
- Shebang `#!/usr/bin/env python3` and root `__main__.py` invoking `towerforge_link.__main__:main`
- `zipfile.ZIP_DEFLATED` (`compresslevel=9`) compression
- Normalized `ZipInfo` timestamps (`1980-01-01 00:00:00`), file permissions (`0o644`),
  and sorted archive entry order with zero `__pycache__` or `.pyc` files
- Hard `< 51,200` byte (`50 KiB`) size verification
- Companion `towerforge-link.pyz.sha256` digest file (`<sha256>  towerforge-link.pyz`)
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import io
import os
from pathlib import Path
from typing import Any
import zipfile

SHEBANG: bytes = b"#!/usr/bin/env python3\n"
DETERMINISTIC_TIMESTAMP: tuple[int, int, int, int, int, int] = (1980, 1, 1, 0, 0, 0)
DETERMINISTIC_EXTERNAL_ATTR: int = 0o644 << 16
MAX_ZIPAPP_BYTES: int = 51_200  # 50 KiB strict ceiling

SINGLE_FILE_MODULE_ORDER: tuple[str, ...] = (
    "adb_finder.py",
    "adb_runner.py",
    "__init__.py",
    "security.py",
    "sources.py",
    "exporter.py",
    "wireless.py",
    "usb_owner.py",
    "ws.py",
    "http_server.py",
    "__main__.py",
)

ENTRYPOINT_SOURCE: bytes = (
    b"# -*- coding: utf-8 -*-\n"
    b"import sys\n"
    b"from towerforge_link.__main__ import main\n"
    b"if __name__ == '__main__':\n"
    b"    raise SystemExit(main())\n"
)

SCRIPT_DIR: Path = Path(__file__).resolve().parent
REPO_ROOT: Path = SCRIPT_DIR.parent
DEFAULT_PACKAGE_DIR: Path = SCRIPT_DIR / "towerforge_link"
DEFAULT_OUTPUT_PYZ: Path = (
    REPO_ROOT / "towerforge.client" / "public" / "downloads" / "towerforge-link.pyz"
)
DEFAULT_OUTPUT_PY: Path = (
    REPO_ROOT / "towerforge.client" / "public" / "downloads" / "towerforge-link.py"
)


def _iter_package_python_files(package_dir: Path) -> list[Path]:
    """Return sorted `.py` source files under `package_dir`, excluding `__pycache__` and `.pyc`."""
    if not package_dir.is_dir():
        raise FileNotFoundError(f"Package directory not found: {package_dir}")

    files: list[Path] = []
    for path in package_dir.rglob("*"):
        if "__pycache__" in path.parts:
            continue
        if not path.is_file():
            continue
        if path.suffix in {".pyc", ".pyo"} or path.suffix != ".py":
            continue
        files.append(path)

    files.sort(key=lambda p: p.relative_to(package_dir).as_posix())
    return files


def _make_deterministic_zipinfo(arcname: str) -> zipfile.ZipInfo:
    """Create a `ZipInfo` record with fixed epoch timestamp and permissions."""
    info = zipfile.ZipInfo(filename=arcname, date_time=DETERMINISTIC_TIMESTAMP)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.create_system = 3  # Unix
    info.external_attr = DETERMINISTIC_EXTERNAL_ATTR
    return info


def build_zipapp_bytes(package_dir: str | Path = DEFAULT_PACKAGE_DIR) -> bytes:
    """Build the reproducible `.pyz` archive in memory and return its exact byte content."""
    pkg_path = Path(package_dir).resolve()
    source_files = _iter_package_python_files(pkg_path)

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(
        zip_buffer,
        mode="w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
    ) as zf:
        main_info = _make_deterministic_zipinfo("__main__.py")
        zf.writestr(
            main_info,
            ENTRYPOINT_SOURCE,
            compress_type=zipfile.ZIP_DEFLATED,
            compresslevel=9,
        )

        for src_file in source_files:
            rel_posix = src_file.relative_to(pkg_path).as_posix()
            arcname = f"towerforge_link/{rel_posix}"
            raw_source = src_file.read_bytes().replace(b"\r\n", b"\n")
            entry_info = _make_deterministic_zipinfo(arcname)
            zf.writestr(
                entry_info,
                raw_source,
                compress_type=zipfile.ZIP_DEFLATED,
                compresslevel=9,
            )

    return SHEBANG + zip_buffer.getvalue()


def _strip_relative_and_future_imports(source_text: str) -> str:
    """Strip top-level `from __future__ import ...` and relative `from .xxx import ...` statements."""
    tree = ast.parse(source_text)
    lines = source_text.splitlines()
    skip_lines: set[int] = set()

    for idx, node in enumerate(tree.body):
        # Strip module docstring so we only have one top-level docstring in the single-file script
        if (
            idx == 0
            and isinstance(node, ast.Expr)
            and isinstance(getattr(node, "value", None), ast.Constant)
            and isinstance(node.value.value, str)
        ):
            for ln in range(node.lineno, (node.end_lineno or node.lineno) + 1):
                skip_lines.add(ln)
            continue

        if isinstance(node, ast.ImportFrom):
            if (node.level and node.level >= 1) or node.module == "__future__":
                for ln in range(node.lineno, (node.end_lineno or node.lineno) + 1):
                    skip_lines.add(ln)

    kept = [line for i, line in enumerate(lines, start=1) if i not in skip_lines]
    return "\n".join(kept).strip()


def build_single_file_source(package_dir: str | Path = DEFAULT_PACKAGE_DIR) -> str:
    """Bundle `towerforge_link/*.py` into a single plain-text UTF-8 Python script."""
    pkg_path = Path(package_dir).resolve()
    header = (
        "#!/usr/bin/env python3\n"
        '"""TowerForge Link — Standalone Single-File Python Companion (macOS, Linux & Windows).\n\n'
        "Zero-dependency Python 3.10+ standard-library companion that discovers system `adb`\n"
        "installations, Waydroid, and macOS containers, and serves the hardened loopback\n"
        "HTTP & WebSocket API on http://127.0.0.1:47821 (ws://127.0.0.1:47821/ws).\n"
        '"""\n\n'
        "from __future__ import annotations\n"
    )
    sections: list[str] = [header]
    for mod_name in SINGLE_FILE_MODULE_ORDER:
        mod_file = pkg_path / mod_name
        if not mod_file.is_file():
            raise FileNotFoundError(f"Expected module not found: {mod_file}")
        raw_text = mod_file.read_text(encoding="utf-8").replace("\r\n", "\n")
        cleaned = _strip_relative_and_future_imports(raw_text)
        sections.append(
            f"# ============================================================\n"
            f"# Module: towerforge_link/{mod_name}\n"
            f"# ============================================================\n\n"
            f"{cleaned}\n"
        )
    combined = "\n\n".join(sections).rstrip() + "\n"
    # Verify the generated single-file Python script parses cleanly
    ast.parse(combined)
    return combined


def build_single_file_script(
    output_path: str | Path = DEFAULT_OUTPUT_PY,
    *,
    package_dir: str | Path = DEFAULT_PACKAGE_DIR,
    sha256_path: str | Path | None = None,
) -> dict[str, Any]:
    """Write `towerforge-link.py` (`0o755`, UTF-8) and `towerforge-link.py.sha256`."""
    out_file = Path(output_path).resolve()
    out_file.parent.mkdir(parents=True, exist_ok=True)

    script_text = build_single_file_source(package_dir=package_dir)
    script_bytes = script_text.encode("utf-8")
    out_file.write_bytes(script_bytes)
    os.chmod(out_file, 0o755)

    size_bytes = os.path.getsize(out_file)
    sha256_hex = hashlib.sha256(script_bytes).hexdigest()
    digest_file = (
        Path(sha256_path).resolve()
        if sha256_path is not None
        else out_file.with_name(f"{out_file.name}.sha256")
    )
    digest_file.write_text(f"{sha256_hex}  {out_file.name}\n", encoding="utf-8")

    return {
        "output_path": str(out_file),
        "sha256_path": str(digest_file),
        "size_bytes": size_bytes,
        "sha256": sha256_hex,
    }


def build_zipapp(
    output_path: str | Path = DEFAULT_OUTPUT_PYZ,
    *,
    package_dir: str | Path = DEFAULT_PACKAGE_DIR,
    sha256_path: str | Path | None = None,
    max_bytes: int = MAX_ZIPAPP_BYTES,
    py_output_path: str | Path | None = None,
) -> dict[str, Any]:
    """Build `towerforge-link.pyz` (and `towerforge-link.py`), verify `< 50 KiB`, set `0o755`, and write `.sha256`."""
    out_file = Path(output_path).resolve()
    out_file.parent.mkdir(parents=True, exist_ok=True)

    pyz_bytes = build_zipapp_bytes(package_dir=package_dir)
    out_file.write_bytes(pyz_bytes)
    os.chmod(out_file, 0o755)

    size_bytes = os.path.getsize(out_file)
    if size_bytes >= max_bytes:
        raise RuntimeError(
            f"Built zipapp {out_file} is {size_bytes} bytes, exceeding the {max_bytes} byte (50 KiB) cap."
        )

    sha256_hex = hashlib.sha256(pyz_bytes).hexdigest()
    digest_file = (
        Path(sha256_path).resolve()
        if sha256_path is not None
        else out_file.with_name(f"{out_file.name}.sha256")
    )
    digest_file.write_text(f"{sha256_hex}  {out_file.name}\n", encoding="utf-8")

    resolved_py_out: Path | None = None
    if py_output_path is not None:
        resolved_py_out = Path(py_output_path).resolve()
    elif out_file == DEFAULT_OUTPUT_PYZ.resolve():
        resolved_py_out = DEFAULT_OUTPUT_PY.resolve()

    py_meta: dict[str, Any] | None = None
    if resolved_py_out is not None:
        py_meta = build_single_file_script(
            output_path=resolved_py_out,
            package_dir=package_dir,
        )

    return {
        "output_path": str(out_file),
        "sha256_path": str(digest_file),
        "size_bytes": size_bytes,
        "sha256": sha256_hex,
        "py_output": py_meta,
    }


def main() -> int:
    """CLI entry point for building `towerforge-link.pyz` and `towerforge-link.py`."""
    parser = argparse.ArgumentParser(
        description="Build reproducible towerforge-link.pyz zipapp archive and single-file towerforge-link.py.",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT_PYZ),
        help="Output path for towerforge-link.pyz.",
    )
    parser.add_argument(
        "--py-output",
        default=str(DEFAULT_OUTPUT_PY),
        help="Output path for standalone plain-text towerforge-link.py.",
    )
    parser.add_argument(
        "--package-dir",
        default=str(DEFAULT_PACKAGE_DIR),
        help="Path to towerforge_link Python package directory.",
    )
    args = parser.parse_args()

    result = build_zipapp(
        output_path=args.output,
        package_dir=args.package_dir,
        py_output_path=args.py_output,
    )
    print(
        f"Built {result['output_path']} ({result['size_bytes']} bytes, sha256={result['sha256']})"
    )
    if result.get("py_output"):
        py_res = result["py_output"]
        print(
            f"Built {py_res['output_path']} ({py_res['size_bytes']} bytes, sha256={py_res['sha256']})"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
