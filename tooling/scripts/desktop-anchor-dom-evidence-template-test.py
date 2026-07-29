#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


def load_template_module():
    script = Path(__file__).with_name("desktop-anchor-dom-evidence-template.py")
    spec = importlib.util.spec_from_file_location("desktop_anchor_dom_evidence_template", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {script}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class DesktopAnchorDomEvidenceTemplateTest(unittest.TestCase):
    def test_template_carries_trace_metadata_and_stays_unproven(self) -> None:
        module = load_template_module()
        report = module.build_template()

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["artifactKind"], "desktop-anchor-dom-evidence")
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertFalse(report["sampleEmissionAllowed"])
        self.assertEqual(report["phase"], "P0b-1")
        self.assertEqual(report["bom"], ["BOM-SMP-01"])
        self.assertEqual(report["spec"], ["SPEC-ANCHOR-01"])
        self.assertTrue(report["gate"])
        self.assertEqual(report["summary"]["failedStep"], "dom-evidence-template")
        self.assertFalse(report["summary"]["sampleEmissionAllowed"])
        self.assertEqual(report["browser"]["status"], "diagnostic incomplete")
        self.assertEqual(report["tauriDev"]["status"], "diagnostic incomplete")
        self.assertEqual(report["tauriPackaged"]["status"], "diagnostic incomplete")
        self.assertEqual(len(report["browser"]["anchors"]), 10)
        self.assertEqual(len(report["tauriDev"]["anchors"]), 10)
        self.assertEqual(len(report["tauriPackaged"]["anchors"]), 10)
        self.assertTrue(all(anchor["count"] == 0 for anchor in report["browser"]["anchors"].values()))
        self.assertEqual(report["issue_breakdown"][0]["category"], "dom-automation-evidence")
        self.assertEqual(report["issueBreakdown"][0]["category"], "dom-automation-evidence")
        self.assertEqual(report["issue_breakdown"][0]["status"], "diagnostic incomplete")
        self.assertEqual(report["issue_breakdown"][0]["completionStatus"], "PARTIAL")
        self.assertEqual(report["issue_breakdown"][0]["proofStatus"], "UNPROVEN")
        self.assertFalse(report["issue_breakdown"][0]["sampleEmissionAllowed"])
        self.assertEqual(report["issue_breakdown"][0]["sourceArtifactKind"], "desktop-anchor-dom-evidence")
        self.assertEqual(report["recommended_review_commands"][0]["command"], "make desktop")
        self.assertEqual(report["recommendedReviewCommands"][0]["command"], "make desktop")
        self.assertTrue(
            any(
                command["command"]
                == (
                    "python3 tooling/scripts/desktop-anchor-dom-evidence-collect.py "
                    "--observations tooling/acceptance/reports/desktop-anchor-dom-observations.json "
                    "--output tooling/acceptance/reports/desktop-anchor-dom-evidence.json"
                )
                for command in report["recommended_review_commands"]
            )
        )

    def test_observations_template_stays_fail_closed(self) -> None:
        module = load_template_module()
        template = module.build_observations_template()

        self.assertEqual(template["artifactKind"], "desktop-anchor-dom-observations-template")
        self.assertEqual(template["completionStatus"], "PARTIAL")
        self.assertEqual(template["proofStatus"], "UNPROVEN")
        self.assertFalse(template["sampleEmissionAllowed"])
        self.assertEqual(template["summary"]["completionStatus"], "PARTIAL")
        self.assertEqual(template["summary"]["proofStatus"], "UNPROVEN")
        self.assertFalse(template["summary"]["sampleEmissionAllowed"])
        self.assertEqual(template["phase"], "P0b-1")
        self.assertEqual(template["bom"], ["BOM-SMP-01"])
        self.assertEqual(template["spec"], ["SPEC-ANCHOR-01"])
        self.assertEqual(
            template["requiredRuntimes"],
            ["browser-gateway", "tauri-webview-dev", "tauri-webview-packaged"],
        )
        self.assertEqual(len(template["browser-gateway"]["anchors"]), 10)
        self.assertEqual(len(template["tauri-webview-dev"]["anchors"]), 10)
        self.assertEqual(len(template["tauri-webview-packaged"]["anchors"]), 10)

    def test_main_writes_template(self) -> None:
        module = load_template_module()
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "dom-evidence.json"
            observations_template = Path(tmp) / "dom-observations-template.json"
            old_argv = sys.argv
            try:
                sys.argv = [
                    "desktop-anchor-dom-evidence-template.py",
                    "--output",
                    str(output),
                    "--observations-template-output",
                    str(observations_template),
                ]
                exit_code = module.main()
            finally:
                sys.argv = old_argv

            self.assertEqual(exit_code, 1)
            written = json.loads(output.read_text(encoding="utf-8"))
            observations_written = json.loads(observations_template.read_text(encoding="utf-8"))

        self.assertEqual(written["artifactKind"], "desktop-anchor-dom-evidence")
        self.assertEqual(written["phase"], "P0b-1")
        self.assertEqual(written["proofStatus"], "UNPROVEN")
        self.assertFalse(written["sampleEmissionAllowed"])
        self.assertFalse(written["summary"]["sampleEmissionAllowed"])
        self.assertEqual(written["issue_breakdown"][0]["category"], "dom-automation-evidence")
        self.assertEqual(observations_written["artifactKind"], "desktop-anchor-dom-observations-template")
        self.assertFalse(observations_written["sampleEmissionAllowed"])
        self.assertFalse(observations_written["summary"]["sampleEmissionAllowed"])

    def test_main_preserves_existing_collected_evidence(self) -> None:
        module = load_template_module()
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "dom-evidence.json"
            observations_template = Path(tmp) / "dom-observations-template.json"
            existing = {
                "artifactKind": "desktop-anchor-dom-evidence",
                "source": "dom-observations",
                "status": "diagnostic incomplete",
                "proofStatus": "UNPROVEN",
                "recommended_review_commands": [
                    {
                        "purpose": "Collect browser/Tauri DOM anchor observations when runtimes are available.",
                        "command": (
                            "python3 tooling/scripts/desktop-anchor-dom-evidence-collect.py "
                            "--observations tooling/acceptance/reports/desktop-anchor-dom-observations.json"
                        ),
                    }
                ],
                "recommendedReviewCommands": [
                    {
                        "purpose": "Collect browser/Tauri DOM anchor observations when runtimes are available.",
                        "command": "python3 tooling/scripts/desktop-anchor-dom-evidence-collect.py",
                    }
                ],
            }
            output.write_text(json.dumps(existing), encoding="utf-8")
            old_argv = sys.argv
            try:
                sys.argv = [
                    "desktop-anchor-dom-evidence-template.py",
                    "--output",
                    str(output),
                    "--observations-template-output",
                    str(observations_template),
                ]
                exit_code = module.main()
            finally:
                sys.argv = old_argv

            self.assertEqual(exit_code, 1)
            preserved = json.loads(output.read_text(encoding="utf-8"))
            observations_written = json.loads(observations_template.read_text(encoding="utf-8"))

        self.assertEqual(preserved["artifactKind"], existing["artifactKind"])
        self.assertEqual(preserved["source"], existing["source"])
        self.assertEqual(preserved["status"], existing["status"])
        self.assertEqual(preserved["proofStatus"], existing["proofStatus"])
        expected_command = (
            "python3 tooling/scripts/desktop-anchor-dom-evidence-collect.py "
            "--observations tooling/acceptance/reports/desktop-anchor-dom-observations.json "
            "--output tooling/acceptance/reports/desktop-anchor-dom-evidence.json"
        )
        self.assertEqual(preserved["recommended_review_commands"][0]["command"], expected_command)
        self.assertEqual(preserved["recommendedReviewCommands"][0]["command"], expected_command)
        self.assertEqual(observations_written["artifactKind"], "desktop-anchor-dom-observations-template")
        self.assertFalse(observations_written["sampleEmissionAllowed"])


if __name__ == "__main__":
    unittest.main()
