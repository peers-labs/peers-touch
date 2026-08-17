from __future__ import annotations

import os
import platform
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]


def _default_artifact_root() -> Path:
    system = platform.system()
    if system == "Darwin":
        return Path.home() / "Library" / "Application Support" / "PeersTouch" / "acceptance"
    if system == "Windows":
        local = os.environ.get("LOCALAPPDATA", "")
        if local:
            return Path(local) / "PeersTouch" / "acceptance"
        return Path.home() / "AppData" / "Local" / "PeersTouch" / "acceptance"
    xdg = os.environ.get("XDG_STATE_HOME", "")
    if xdg:
        return Path(xdg) / "peers-touch" / "acceptance"
    return Path.home() / ".local" / "state" / "peers-touch" / "acceptance"


def _artifact_root() -> Path:
    override = os.environ.get("PT_ACCEPTANCE_ARTIFACT_ROOT", "").strip()
    if override:
        return Path(override)
    return _default_artifact_root()


ARTIFACT_ROOT = _artifact_root()
REPORTS_DIR = ARTIFACT_ROOT / "reports"
EVIDENCE_DIR = ARTIFACT_ROOT / "evidence"


def repo_root() -> Path:
    return REPO_ROOT


def reports_dir() -> Path:
    return REPORTS_DIR


def evidence_dir() -> Path:
    return EVIDENCE_DIR
