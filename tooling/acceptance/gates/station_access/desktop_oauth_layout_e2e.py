#!/usr/bin/env python3
"""Prove the exact-source Desktop OAuth login-card layout."""

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
REPORT_PATH = REPORTS_DIR / "station-access-desktop-oauth-layout-e2e.json"
EVIDENCE_DIR = (
    REPORTS_DIR / "evidence" / "station-access-desktop-oauth-layout-e2e"
)
ENVIRONMENT_ID = "station-access-login-browser"
PROFILE_ID = ENVIRONMENT_ID


class StationAccessDesktopOAuthLayoutGate(AcceptanceGate):
    gate_id = "station-access-desktop-oauth-layout-e2e"
    phase = "SAL-OAUTH-LAYOUT"
    bom = ("STATION-ACCESS-DESKTOP-LOGIN",)
    spec = ("STATION-ACCESS-AUTHENTICATION",)
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
            raise GateError("Desktop OAuth layout Runtime Manifest is invalid")
        return manifest

    def run(self) -> dict[str, Any]:
        manifest = self._manifest()
        with tempfile.TemporaryDirectory(prefix="pt-desktop-oauth-layout-") as temp:
            output_dir = Path(temp)
            completed = subprocess.run(
                ["node", str(DRIVER), str(output_dir)],
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
                timeout=240,
                check=False,
            )
            if completed.returncode != 0:
                detail = completed.stderr.strip() or completed.stdout.strip()
                raise GateError(f"Desktop OAuth layout journey failed: {detail}")

            summary_path = output_dir / "summary.json"
            try:
                summary = json.loads(summary_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as error:
                raise GateError(
                    f"Desktop OAuth layout journey summary is invalid: {error}"
                ) from error

            assertions = summary.get("assertions")
            if not isinstance(assertions, dict):
                raise GateError("Desktop OAuth layout journey omitted assertions")
            for name, passed in assertions.items():
                self.assert_condition(
                    str(name),
                    passed is True,
                    f"journey assertion {name} was not proven",
                )

            artifacts = summary.get("artifacts")
            if not isinstance(artifacts, dict):
                raise GateError("Desktop OAuth layout journey omitted artifacts")
            evidence: dict[str, Any] = {}
            server_log = artifacts.get("serverLog")
            if not isinstance(server_log, str) or not Path(server_log).is_file():
                raise GateError("Desktop OAuth layout server log is missing")
            evidence["serverLog"] = self.report.add_evidence_file(
                "station-access-desktop-oauth-layout-server-log",
                Path(server_log),
                destination_dir=self.evidence_dir,
            )

            for artifact_group in ("doms", "screenshots"):
                values = artifacts.get(artifact_group)
                if not isinstance(values, dict) or len(values) != 4:
                    raise GateError(
                        f"Desktop OAuth layout {artifact_group} evidence is incomplete"
                    )
                for case_id, value in values.items():
                    artifact_path = Path(value) if isinstance(value, str) else None
                    if artifact_path is None or not artifact_path.is_file():
                        raise GateError(
                            f"Desktop OAuth layout artifact is missing: "
                            f"{artifact_group}/{case_id}"
                        )
                    evidence[f"{artifact_group}-{case_id}"] = (
                        self.report.add_evidence_file(
                            f"station-access-oauth-{artifact_group}-{case_id}",
                            artifact_path,
                            destination_dir=self.evidence_dir,
                        )
                    )

            cases = summary.get("cases")
            if not isinstance(cases, list) or len(cases) != 4:
                raise GateError("Desktop OAuth layout journey must report four cases")

            return {
                "environment": ENVIRONMENT_ID,
                "journey": self.phase,
                "runtimeCell": manifest["profile"]["resolvedName"],
                "cases": cases,
                "evidence": evidence,
            }


if __name__ == "__main__":
    raise SystemExit(StationAccessDesktopOAuthLayoutGate().execute())
