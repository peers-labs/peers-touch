#!/usr/bin/env python3
"""Prove the Desktop primary navigation and Settings ownership cutover."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from tooling.acceptance.core import (
    AcceptanceGate,
    GateError,
    REPORTS_DIR,
    load_runtime_manifest,
)


REPO_ROOT = Path(__file__).resolve().parents[4]
DRIVER = Path(__file__).with_suffix(".mjs")
REPORT_PATH = REPORTS_DIR / "desktop-primary-navigation-e2e.json"
EVIDENCE_DIR = REPORTS_DIR / "evidence" / "desktop-primary-navigation-e2e"
ENVIRONMENT_ID = "desktop-primary-navigation-browser"
PROFILE_ID = "desktop-browser-local"


class DesktopPrimaryNavigationGate(AcceptanceGate):
    gate_id = "desktop-primary-navigation-e2e"
    phase = "DPNC-J01"
    bom = ("DPNC-01-DESKTOP-CUTOVER",)
    spec = ("DPNC-D01", "DPNC-D02")
    report_path = REPORT_PATH
    evidence_dir = EVIDENCE_DIR

    def _manifest(self) -> dict[str, Any]:
        value = os.environ.get("PT_ACCEPTANCE_RUNTIME_MANIFEST", "").strip()
        if not value:
            raise GateError("PT_ACCEPTANCE_RUNTIME_MANIFEST is required")
        manifest = load_runtime_manifest(Path(value), self.gate_id)
        clients = manifest.get("clients")
        if (
            manifest.get("environmentId") != ENVIRONMENT_ID
            or manifest.get("profile", {}).get("resolvedName") != PROFILE_ID
            or not isinstance(clients, list)
            or len(clients) != 1
            or clients[0].get("runtime") != "browser"
        ):
            raise GateError("Desktop navigation Runtime Manifest is invalid")
        return manifest

    def run(self) -> dict[str, Any]:
        manifest = self._manifest()
        with tempfile.TemporaryDirectory(prefix="pt-primary-navigation-") as temp:
            output_dir = Path(temp)
            completed = subprocess.run(
                ["node", str(DRIVER), str(output_dir)],
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
                timeout=120,
                check=False,
            )
            if completed.returncode != 0:
                detail = completed.stderr.strip() or completed.stdout.strip()
                raise GateError(f"Desktop navigation journey failed: {detail}")

            summary_path = output_dir / "summary.json"
            try:
                summary = json.loads(summary_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as error:
                raise GateError(
                    f"Desktop navigation journey summary is invalid: {error}"
                ) from error

            assertions = summary.get("assertions")
            if not isinstance(assertions, dict):
                raise GateError("Desktop navigation journey omitted assertions")
            for name, passed in assertions.items():
                self.assert_condition(
                    str(name),
                    passed is True,
                    f"journey assertion {name} was not proven",
                )

            artifacts = summary.get("artifacts")
            if not isinstance(artifacts, dict):
                raise GateError("Desktop navigation journey omitted artifacts")
            evidence = {}
            for name in ("dom", "screenshot", "serverLog"):
                value = artifacts.get(name)
                path = Path(value) if isinstance(value, str) else None
                if path is None or not path.is_file():
                    raise GateError(f"Desktop navigation artifact is missing: {name}")
                evidence[name] = self.report.add_evidence_file(
                    f"desktop-primary-navigation-{name}",
                    path,
                    destination_dir=self.evidence_dir,
                )

            return {
                "environment": ENVIRONMENT_ID,
                "journey": self.phase,
                "runtimeCell": manifest["profile"]["resolvedName"],
                "invocationCounts": summary.get("invocationCounts", {}),
                "evidence": evidence,
            }


if __name__ == "__main__":
    raise SystemExit(DesktopPrimaryNavigationGate().execute())
