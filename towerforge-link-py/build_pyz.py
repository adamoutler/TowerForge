#!/usr/bin/env python3
"""Build towerforge-link.pyz and towerforge-link.py into towerforge.client/public/downloads/."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_zipapp import (  # noqa: E402
    DEFAULT_OUTPUT_PY,
    DEFAULT_OUTPUT_PYZ,
    build_single_file_script,
    build_single_file_source,
    build_zipapp,
    main,
)

__all__ = [
    "DEFAULT_OUTPUT_PY",
    "DEFAULT_OUTPUT_PYZ",
    "build_single_file_script",
    "build_single_file_source",
    "build_zipapp",
    "main",
]

if __name__ == "__main__":
    raise SystemExit(main())
