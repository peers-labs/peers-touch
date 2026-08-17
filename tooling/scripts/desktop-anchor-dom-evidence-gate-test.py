#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from _acceptance_artifacts import latest_path


def load_gate_module():
    script = Path(__file__).with_name("desktop-anchor-dom-evidence-gate.py")
    spec = importlib.util.spec_from_file_location("desktop_anchor_dom_evidence_gate", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {script}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class DesktopAnchorDomEvidenceGateTest(unittest.TestCase):
    def complete_dom_evidence(self, module) -> dict[str, object]:
        inventory = module.load_inventory_module()
        anchors = {
            anchor.anchor_id: {
                "status": "pass",
                "selector": anchor.selector,
                "count": 1,
            }
            for anchor in inventory.REQUIRED_ANCHORS
        }
        return {
            "artifactKind": "desktop-anchor-dom-evidence",
            "phase": inventory.DOM_EVIDENCE_PHASE,
            "bom": list(inventory.DOM_EVIDENCE_BOM),
            "spec": list(inventory.DOM_EVIDENCE_SPEC),
            "gate": inventory.DOM_EVIDENCE_GATE,
            "completionStatus": "DONE",
            "proofStatus": "PROVEN",
            "browser": {"status": "pass", "anchors": anchors},
            "tauriDev": {"status": "pass", "anchors": anchors},
            "tauriPackaged": {"status": "pass", "anchors": anchors},
        }

    def test_missing_dom_evidence_stays_unproven(self) -> None:
        module = load_gate_module()
        with tempfile.TemporaryDirectory() as tmp:
            report = module.build_report(Path(tmp) / "missing-dom.json")

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["artifactKind"], "desktop-anchor-dom-evidence-gate")
        self.assertEqual(report["phase"], "P0b-1")
        self.assertEqual(report["bom"], ["BOM-SMP-01"])
        self.assertEqual(report["spec"], ["SPEC-ANCHOR-01"])
        self.assertTrue(report["gate"])
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertFalse(report["sampleEmissionAllowed"])
        self.assertFalse(report["summary"]["sampleEmissionAllowed"])
        self.assertEqual(report["domAutomation"]["status"], "missing")
        self.assertEqual(report["domAutomation"]["evidenceStatus"], "missing")
        self.assertEqual(report["issue_breakdown"][0]["category"], "dom-automation-evidence")
        self.assertEqual(report["issue_breakdown"][0]["status"], "diagnostic incomplete")
        self.assertEqual(report["issue_breakdown"][0]["completionStatus"], "PARTIAL")
        self.assertEqual(report["issue_breakdown"][0]["proofStatus"], "UNPROVEN")
        self.assertFalse(report["issue_breakdown"][0]["sampleEmissionAllowed"])
        self.assertEqual(report["issueBreakdown"], report["issue_breakdown"])
        self.assertEqual(report["recommendedReviewCommands"], report["recommended_review_commands"])

    def test_top_level_runtime_pass_without_per_anchor_evidence_stays_unproven(self) -> None:
        module = load_gate_module()
        with tempfile.TemporaryDirectory() as tmp:
            evidence = Path(tmp) / "dom.json"
            evidence.write_text(
                json.dumps({"browser": {"status": "pass"}, "tauri": {"status": "pass"}}),
                encoding="utf-8",
            )
            report = module.build_report(evidence)

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertEqual(report["domAutomation"]["evidenceStatus"], "missing-source-metadata")
        self.assertEqual(report["domAutomation"]["issue_breakdown"][0]["category"], "dom-automation-evidence")
        self.assertIn("DOM evidence source metadata is incomplete", report["domAutomation"]["reason"])
        self.assertIn("browser DOM anchors are not fully proven (0/10 anchors proven)", report["domAutomation"]["reason"])
        self.assertIn("tauriDev DOM anchors are not fully proven (0/10 anchors proven)", report["domAutomation"]["reason"])
        self.assertIn("tauriPackaged DOM anchors are not fully proven (0/10 anchors proven)", report["domAutomation"]["reason"])
        self.assertEqual(report["domAutomation"]["browser"]["provenCount"], 0)
        self.assertEqual(report["domAutomation"]["tauriDev"]["provenCount"], 0)
        self.assertEqual(report["domAutomation"]["tauriPackaged"]["provenCount"], 0)
        markdown = module.render_markdown(report)
        self.assertIn("| Anchor | Browser | Tauri |", markdown)
        self.assertIn("`diagnostic incomplete`", markdown)
        self.assertIn("missing or invalid phase", markdown)

    def test_per_anchor_pass_without_source_metadata_stays_unproven(self) -> None:
        module = load_gate_module()
        with tempfile.TemporaryDirectory() as tmp:
            inventory = module.load_inventory_module()
            anchors = {
                anchor.anchor_id: {
                    "status": "pass",
                    "selector": anchor.selector,
                    "count": 1,
                }
                for anchor in inventory.REQUIRED_ANCHORS
            }
            evidence = Path(tmp) / "dom.json"
            evidence.write_text(
                json.dumps(
                    {
                        "browser": {"status": "pass", "anchors": anchors},
                        "tauriDev": {"status": "pass", "anchors": anchors},
                        "tauriPackaged": {"status": "pass", "anchors": anchors},
                    }
                ),
                encoding="utf-8",
            )
            report = module.build_report(evidence)

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertFalse(report["sampleEmissionAllowed"])
        self.assertEqual(report["domAutomation"]["evidenceStatus"], "missing-source-metadata")
        self.assertEqual(report["issue_breakdown"][0]["category"], "dom-automation-evidence")
        self.assertEqual(report["domAutomation"]["reason"], "DOM evidence source metadata is incomplete")
        self.assertEqual(report["domAutomation"]["browser"]["provenCount"], 10)
        self.assertEqual(report["domAutomation"]["tauriDev"]["provenCount"], 10)
        self.assertEqual(report["domAutomation"]["tauriPackaged"]["provenCount"], 10)
        self.assertIn("missing required DOM evidence BOM binding", report["domAutomation"]["details"])

    def test_complete_browser_and_tauri_per_anchor_evidence_passes(self) -> None:
        module = load_gate_module()
        with tempfile.TemporaryDirectory() as tmp:
            evidence = Path(tmp) / "dom.json"
            evidence.write_text(json.dumps(self.complete_dom_evidence(module)), encoding="utf-8")
            report = module.build_report(evidence)

        self.assertEqual(report["status"], "pass")
        self.assertEqual(report["completionStatus"], "DONE")
        self.assertEqual(report["proofStatus"], "PROVEN")
        self.assertTrue(report["sampleEmissionAllowed"])
        self.assertTrue(report["summary"]["sampleEmissionAllowed"])
        self.assertEqual(report["domAutomation"]["sourceArtifactKind"], "desktop-anchor-dom-evidence")
        self.assertEqual(report["domAutomation"]["browser"]["provenCount"], 10)
        self.assertEqual(report["domAutomation"]["tauriDev"]["provenCount"], 10)
        self.assertEqual(report["domAutomation"]["tauriPackaged"]["provenCount"], 10)
        self.assertNotIn("issue_breakdown", report)

    def test_main_resolves_collector_latest_and_writes_typed_reference(self) -> None:
        module = load_gate_module()
        with tempfile.TemporaryDirectory() as tmp:
            old_argv = sys.argv
            try:
                with patch.dict(
                    os.environ,
                    {"PT_ACCEPTANCE_ARTIFACT_ROOT": str(Path(tmp) / "artifacts")},
                ):
                    evidence = self.complete_dom_evidence(module)
                    with module.artifact_session(
                        module.DOM_EVIDENCE_PRODUCER_ID
                    ) as session:
                        session.write_json(
                            "reports/desktop-anchor-dom-evidence.json",
                            evidence,
                            role=module.DOM_EVIDENCE_ROLE,
                        )
                        session.complete(
                            status="pass",
                            completion_status="DONE",
                            proof_status="PROVEN",
                        )
                    sys.argv = ["desktop-anchor-dom-evidence-gate.py"]
                    exit_code = module.main()
                    written = json.loads(
                        latest_path(module.ARTIFACT_KIND, "report").read_text(
                            encoding="utf-8"
                        )
                    )
            finally:
                sys.argv = old_argv

        self.assertEqual(exit_code, 0)
        self.assertIsInstance(written["domAutomation"]["sourceArtifact"], dict)
        self.assertEqual(
            written["domAutomation"]["sourceArtifact"]["gateId"],
            module.DOM_EVIDENCE_PRODUCER_ID,
        )


if __name__ == "__main__":
    unittest.main()
