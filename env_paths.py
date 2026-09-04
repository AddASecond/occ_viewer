"""Standalone occ_viewer project paths."""
from __future__ import annotations

import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE  # project root
RAW_ROOTS = tuple(Path(f"/data/rawdata{s}") for s in ("", "-1", "-2", "-3", "-4"))
DEFAULT_URI = os.environ.get(
    "ROBOTRUCK_MONGO_URI",
    "mongodb://krk030-mongodb:27017/?authSource=perception_experiment",
)


def ensure_c_path(*extra: Path) -> Path:
    for path in (HERE, *extra):
        s = str(path)
        if s not in sys.path:
            sys.path.insert(0, s)
    return ROOT
