from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
ENVIRONMENTS_DIR = REPO_ROOT / "tooling" / "acceptance" / "environments"
RUNTIME_CELLS_DIR = REPO_ROOT / "tooling" / "acceptance" / "runtime-cells"
REPORTS_DIR = REPO_ROOT / "tooling" / "acceptance" / "reports"


def repo_root() -> Path:
    return REPO_ROOT


def environments_dir() -> Path:
    return ENVIRONMENTS_DIR


def runtime_cells_dir() -> Path:
    return RUNTIME_CELLS_DIR
