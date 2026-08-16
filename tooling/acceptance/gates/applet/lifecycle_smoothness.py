#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core import AcceptanceGate, GateError  # noqa: E402


SOURCE_DIR = (
    REPO_ROOT
    / "tooling"
    / "acceptance"
    / "evidence"
    / "applets"
    / "desktop"
    / "lifecycle-smoothness-gate"
)
SOURCE_JSON = SOURCE_DIR / "lifecycle-smoothness-gate.json"
SOURCE_MARKDOWN = SOURCE_DIR / "lifecycle-smoothness-gate.md"


class AppletLifecycleSmoothnessGate(AcceptanceGate):
    gate_id = "applet-desktop-lifecycle-smoothness"

    def run(self) -> dict[str, Any]:
        completed = subprocess.run(
            ["pnpm", "applet:desktop-lifecycle-smoothness-gate"],
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
            timeout=600,
        )
        if completed.returncode != 0:
            detail = (completed.stdout + completed.stderr)[-4000:]
            raise GateError(f"Applet MJS lifecycle gate failed: {detail}")
        if not SOURCE_JSON.exists():
            raise GateError(f"Applet MJS gate did not emit source evidence: {SOURCE_JSON}")

        source = json.loads(SOURCE_JSON.read_text(encoding="utf-8"))
        if source.get("status") != "PASS":
            raise GateError(f"Applet source evidence is not PASS: {source.get('status')}")

        for check in source.get("checks", []):
            name = str(check.get("id") or "unnamed-check")
            passed = check.get("status") == "PASS"
            self.assert_condition(name, passed, str(check.get("message") or ""))

        self.report.add_evidence_file("source-json", SOURCE_JSON)
        if SOURCE_MARKDOWN.exists():
            self.report.add_evidence_file("source-markdown", SOURCE_MARKDOWN)

        return {
            "evidence_class": source.get("evidenceClass"),
            "source_gate": source.get("gate"),
            "source_commands": source.get("commands", []),
            "proven_scope": source.get("provenScope", []),
            "unproven_scope": source.get("unprovenScope", []),
        }


def main() -> int:
    return AppletLifecycleSmoothnessGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
