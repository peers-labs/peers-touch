#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


def load_collect_module():
    script = Path(__file__).with_name("desktop-anchor-dom-evidence-collect.py")
    spec = importlib.util.spec_from_file_location("desktop_anchor_dom_evidence_collect", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {script}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def load_gate_module():
    script = Path(__file__).with_name("desktop-anchor-dom-evidence-gate.py")
    spec = importlib.util.spec_from_file_location("desktop_anchor_dom_evidence_gate", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {script}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class DesktopAnchorDomEvidenceCollectTest(unittest.TestCase):
    def complete_observations(self, module) -> dict[str, object]:
        inventory = module.load_inventory_module()
        anchors = {
            anchor.anchor_id: {
                "selector": anchor.selector,
                "count": 1,
            }
            for anchor in inventory.REQUIRED_ANCHORS
        }
        return {
            "browser-gateway": {"anchors": anchors},
            "tauri-webview": {"anchors": anchors},
        }

    def test_complete_observations_emit_proven_contract_accepted_by_gate(self) -> None:
        collect = load_collect_module()
        gate = load_gate_module()
        with tempfile.TemporaryDirectory() as tmp:
            evidence_path = Path(tmp) / "dom-evidence.json"
            evidence = collect.build_evidence(self.complete_observations(collect))
            evidence_path.write_text(json.dumps(evidence), encoding="utf-8")
            gate_report = gate.build_report(evidence_path)

        self.assertEqual(evidence["artifactKind"], "desktop-anchor-dom-evidence")
        self.assertEqual(evidence["phase"], "P0b-1")
        self.assertEqual(evidence["bom"], ["BOM-SMP-01"])
        self.assertEqual(evidence["spec"], ["SPEC-ANCHOR-01"])
        self.assertEqual(evidence["completionStatus"], "DONE")
        self.assertEqual(evidence["proofStatus"], "PROVEN")
        self.assertNotIn("issue_breakdown", evidence)
        self.assertEqual(gate_report["status"], "pass")
        self.assertEqual(gate_report["proofStatus"], "PROVEN")
        self.assertEqual(gate_report["domAutomation"]["sourceArtifactKind"], "desktop-anchor-dom-evidence")

    def test_missing_tauri_observations_stay_unproven(self) -> None:
        collect = load_collect_module()
        inventory = collect.load_inventory_module()
        browser_anchors = {
            anchor.anchor_id: {
                "selector": anchor.selector,
                "count": 1,
            }
            for anchor in inventory.REQUIRED_ANCHORS
        }
        evidence = collect.build_evidence({"browser": {"anchors": browser_anchors}})

        self.assertEqual(evidence["status"], "diagnostic incomplete")
        self.assertEqual(evidence["completionStatus"], "PARTIAL")
        self.assertEqual(evidence["proofStatus"], "UNPROVEN")
        self.assertEqual(evidence["browser"]["status"], "pass")
        self.assertEqual(evidence["tauri"]["status"], "diagnostic incomplete")
        self.assertTrue(all(anchor["count"] == 0 for anchor in evidence["tauri"]["anchors"].values()))
        self.assertEqual(evidence["artifactKind"], "desktop-anchor-dom-evidence")
        self.assertFalse(evidence["sampleEmissionAllowed"])
        self.assertEqual(evidence["summary"]["completionStatus"], "PARTIAL")
        self.assertEqual(evidence["summary"]["proofStatus"], "UNPROVEN")
        self.assertFalse(evidence["summary"]["sampleEmissionAllowed"])
        self.assertEqual(evidence["issue_breakdown"][0]["category"], "dom-automation-evidence")
        self.assertEqual(evidence["issue_breakdown"][0]["failedStep"], "tauri-webview")
        self.assertEqual(evidence["issue_breakdown"][0]["sourceArtifactKind"], "desktop-anchor-dom-evidence")
        self.assertEqual(evidence["issue_breakdown"][0]["sourcePhase"], "P0b-1")
        self.assertEqual(evidence["issue_breakdown"][0]["sourceBom"], ["BOM-SMP-01"])
        self.assertEqual(evidence["issue_breakdown"][0]["sourceSpec"], ["SPEC-ANCHOR-01"])
        self.assertEqual(evidence["issueBreakdown"][0]["category"], "dom-automation-evidence")
        self.assertEqual(evidence["recommended_review_commands"][0]["command"], "make desktop")
        self.assertEqual(evidence["recommendedReviewCommands"][0]["command"], "make desktop")
        self.assertTrue(
            any(
                command["command"]
                == (
                    "python3 tooling/scripts/desktop-anchor-dom-evidence-collect.py "
                    "--observations tooling/acceptance/reports/desktop-anchor-dom-observations.json "
                    "--output tooling/acceptance/reports/desktop-anchor-dom-evidence.json"
                )
                for command in evidence["recommended_review_commands"]
            )
        )

    def test_main_writes_normalized_evidence(self) -> None:
        collect = load_collect_module()
        with tempfile.TemporaryDirectory() as tmp:
            observations_path = Path(tmp) / "observations.json"
            output_path = Path(tmp) / "dom-evidence.json"
            observations_path.write_text(json.dumps(self.complete_observations(collect)), encoding="utf-8")
            old_argv = sys.argv
            try:
                sys.argv = [
                    "desktop-anchor-dom-evidence-collect.py",
                    "--observations",
                    str(observations_path),
                    "--output",
                    str(output_path),
                ]
                exit_code = collect.main()
            finally:
                sys.argv = old_argv

            written = json.loads(output_path.read_text(encoding="utf-8"))

        self.assertEqual(exit_code, 0)
        self.assertEqual(written["artifactKind"], "desktop-anchor-dom-evidence")
        self.assertEqual(written["source"], "dom-observations")
        self.assertEqual(written["proofStatus"], "PROVEN")
        self.assertTrue(written["sampleEmissionAllowed"])


if __name__ == "__main__":
    unittest.main()
