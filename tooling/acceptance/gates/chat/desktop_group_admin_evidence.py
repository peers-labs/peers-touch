#!/usr/bin/env python3
"""Desktop group admin semi-automated evidence gate.

This harness closes the gap between the Station HTTP group-admin gate and a
real multi-Desktop manual run. It:

1. runs the Station group admin HTTP gate against the target Station;
2. scans Desktop logs for realtime membership events and sender-key rotation;
3. scans a screenshot directory for required UI evidence;
4. writes a JSON evidence report that can be attached to the P2 acceptance doc.

Set CHAT_GROUP_ADMIN_REQUIRE_ARTIFACTS=1 when the Desktop manual run is meant to
be blocking; otherwise missing logs/screenshots are reported but do not fail the
Station-level verification.
Set CHAT_GROUP_ADMIN_EVIDENCE_DRY_RUN=1 to validate report generation without a
running Station.
"""

from __future__ import annotations

import glob
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[4]
GROUP_ADMIN_GATE = REPO_ROOT / "tooling/acceptance/gates/chat/group_admin_e2e.py"
DEFAULT_EVIDENCE_DIR = REPO_ROOT / "artifacts/acceptance/group-admin"

LOG_PATTERNS = {
    "membership_updated": ["UPDATED", "GroupMembershipChange", "group membership"],
    "membership_removed": ["REMOVED", "GroupMembershipChange", "group membership"],
    "membership_transferred": ["TRANSFERRED", "GroupMembershipChange", "group membership"],
    "membership_dissolved": ["DISSOLVED", "GroupMembershipChange", "group membership"],
    "sender_key_rotation": ["rotateGroupSenderChain"],
}

SCREENSHOT_PATTERNS = {
    "owner_permission_card": ["owner", "permission"],
    "admin_permission_card": ["admin", "permission"],
    "member_read_only_card": ["member", "read"],
    "locked_member_rows": ["locked"],
}


def env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


def evidence_dir() -> Path:
    raw = os.environ.get("CHAT_GROUP_ADMIN_EVIDENCE_DIR", "").strip()
    return Path(raw).expanduser().resolve() if raw else DEFAULT_EVIDENCE_DIR


def split_globs(raw: str) -> list[str]:
    if not raw.strip():
        return []
    parts: list[str] = []
    for chunk in raw.replace("\n", ",").split(","):
        item = chunk.strip()
        if item:
            parts.append(item)
    return parts


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def run_station_gate() -> dict[str, Any]:
    if env_flag("CHAT_GROUP_ADMIN_EVIDENCE_DRY_RUN"):
        return {
            "command": "dry-run",
            "exit_code": 0,
            "stdout": "dry-run station gate skipped",
            "stderr": "",
            "passed": True,
        }
    env = os.environ.copy()
    result = subprocess.run(
        [sys.executable, str(GROUP_ADMIN_GATE)],
        cwd=REPO_ROOT,
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    return {
        "command": f"{sys.executable} {GROUP_ADMIN_GATE.relative_to(REPO_ROOT)}",
        "exit_code": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "passed": result.returncode == 0,
    }


def scan_logs() -> dict[str, Any]:
    globs = split_globs(os.environ.get("CHAT_GROUP_ADMIN_DESKTOP_LOG_GLOB", ""))
    paths = sorted({Path(match).expanduser().resolve() for pattern in globs for match in glob.glob(pattern)})
    combined = "\n".join(read_text(path) for path in paths)
    hits: dict[str, bool] = {}
    for key, required in LOG_PATTERNS.items():
        hits[key] = all(token in combined for token in required)
    return {
        "configured_globs": globs,
        "files": [str(path) for path in paths],
        "hits": hits,
        "complete": bool(paths) and all(hits.values()),
    }


def scan_screenshots() -> dict[str, Any]:
    raw_dir = os.environ.get("CHAT_GROUP_ADMIN_SCREENSHOT_DIR", "").strip()
    if not raw_dir:
        return {
            "directory": "",
            "files": [],
            "hits": {key: False for key in SCREENSHOT_PATTERNS},
            "complete": False,
        }
    root = Path(raw_dir).expanduser().resolve()
    files = [path for path in root.rglob("*") if path.is_file()]
    lowered = [path.name.lower() for path in files]
    hits: dict[str, bool] = {}
    for key, required in SCREENSHOT_PATTERNS.items():
        hits[key] = any(all(token in name for token in required) for name in lowered)
    return {
        "directory": str(root),
        "files": [str(path) for path in files],
        "hits": hits,
        "complete": bool(files) and all(hits.values()),
    }


def write_report(report: dict[str, Any], output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / f"group-admin-desktop-evidence-{int(time.time())}.json"
    path.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
    return path


def main() -> int:
    require_artifacts = env_flag("CHAT_GROUP_ADMIN_REQUIRE_ARTIFACTS")
    station_gate = run_station_gate()
    logs = scan_logs()
    screenshots = scan_screenshots()
    report = {
        "generated_at_unix_ms": int(time.time() * 1000),
        "require_artifacts": require_artifacts,
        "station_gate": station_gate,
        "desktop_logs": logs,
        "screenshots": screenshots,
        "passed": station_gate["passed"] and (not require_artifacts or (logs["complete"] and screenshots["complete"])),
    }
    report_path = write_report(report, evidence_dir())

    print("Desktop Group Admin Evidence")
    print("============================")
    print(f"station_gate={'PASS' if station_gate['passed'] else 'FAIL'}")
    print(f"desktop_logs={'PASS' if logs['complete'] else 'MISSING'} files={len(logs['files'])}")
    print(f"screenshots={'PASS' if screenshots['complete'] else 'MISSING'} files={len(screenshots['files'])}")
    print(f"report={report_path}")

    if not report["passed"]:
        if not station_gate["passed"]:
            print(station_gate["stdout"], file=sys.stderr)
            print(station_gate["stderr"], file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
