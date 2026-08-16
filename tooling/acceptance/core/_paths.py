from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
REPORTS_DIR = REPO_ROOT / "tooling" / "acceptance" / "reports"
EVIDENCE_DIR = REPORTS_DIR / "evidence"


def repo_root() -> Path:
    return REPO_ROOT


def reports_dir() -> Path:
    return REPORTS_DIR


def evidence_dir() -> Path:
    return EVIDENCE_DIR
