#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


def load_inventory_module():
    script = Path(__file__).with_name("desktop-anchor-inventory.py")
    spec = importlib.util.spec_from_file_location("desktop_anchor_inventory", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {script}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class DesktopAnchorInventoryTest(unittest.TestCase):
    def write_source(self, tmp: str, content: str) -> Path:
        source_root = Path(tmp) / "src"
        source_root.mkdir()
        (source_root / "Anchors.tsx").write_text(content, encoding="utf-8")
        return source_root

    def complete_anchor_source(self) -> str:
        return """
        <button data-pt-primary-nav="chat" />
        <button data-pt-secondary-tab="settings" data-pt-secondary-tab-id={group.key} />
        <button data-pt-section-item="settings" data-pt-section-item-id={section.key} />
        <section data-pt-section-host={descriptor.id} />
        <div
          data-pt-context-menu-trigger="chat-conversation"
          data-pt-context-menu-kind={c.kind}
          data-pt-context-menu-id={c.id}
        />
        """

    def complete_dom_evidence(self, module) -> dict[str, object]:
        anchors = {
            anchor.anchor_id: {
                "status": "pass",
                "selector": anchor.selector,
                "count": 1,
            }
            for anchor in module.REQUIRED_ANCHORS
        }
        return {
            "artifactKind": module.DOM_EVIDENCE_ARTIFACT_KIND,
            "phase": module.DOM_EVIDENCE_PHASE,
            "bom": list(module.DOM_EVIDENCE_BOM),
            "spec": list(module.DOM_EVIDENCE_SPEC),
            "gate": module.DOM_EVIDENCE_GATE,
            "completionStatus": "DONE",
            "proofStatus": "PROVEN",
            "browser": {"status": "pass", "anchors": anchors},
            "tauri": {"status": "pass", "anchors": anchors},
        }

    def test_complete_source_without_dom_evidence_stays_unproven(self) -> None:
        module = load_inventory_module()
        with tempfile.TemporaryDirectory() as tmp:
            source_root = self.write_source(tmp, self.complete_anchor_source())
            report = module.build_report(source_root, Path(tmp) / "missing-dom.json")

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["artifactKind"], "desktop-anchor-inventory")
        self.assertEqual(report["phase"], "P0b-1")
        self.assertEqual(report["bom"], ["BOM-SMP-01"])
        self.assertEqual(report["spec"], ["SPEC-ANCHOR-01"])
        self.assertTrue(report["gate"])
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertFalse(report["sampleEmissionAllowed"])
        self.assertFalse(report["summary"]["sampleEmissionAllowed"])
        self.assertEqual(report["sourceAnchors"]["status"], "loaded")
        self.assertEqual(report["sourceAnchors"]["presentCount"], 9)
        self.assertEqual(report["domAutomation"]["status"], "missing")
        self.assertEqual(report["issue_breakdown"][0]["category"], "dom-automation-evidence")
        self.assertEqual(report["issue_breakdown"][0]["status"], "diagnostic incomplete")
        self.assertEqual(report["issue_breakdown"][0]["completionStatus"], "PARTIAL")
        self.assertEqual(report["issue_breakdown"][0]["proofStatus"], "UNPROVEN")
        self.assertFalse(report["issue_breakdown"][0]["sampleEmissionAllowed"])
        self.assertEqual(report["issue_breakdown"][0]["sourceArtifactKind"], "desktop-anchor-inventory")
        self.assertEqual(report["issue_breakdown"][0]["sourcePhase"], "P0b-1")
        self.assertEqual(report["issue_breakdown"][0]["sourceBom"], ["BOM-SMP-01"])
        self.assertEqual(report["issue_breakdown"][0]["sourceSpec"], ["SPEC-ANCHOR-01"])
        self.assertEqual(report["issueBreakdown"], report["issue_breakdown"])
        self.assertEqual(report["domAutomation"]["issue_breakdown"][0]["failedStep"], "missing")
        self.assertTrue(
            any(
                item["command"]
                == (
                    "python3 tooling/scripts/desktop-anchor-dom-evidence-collect.py "
                    "--observations tooling/acceptance/reports/desktop-anchor-dom-observations.json "
                    "--output tooling/acceptance/reports/desktop-anchor-dom-evidence.json"
                )
                for item in report["recommended_review_commands"]
            )
        )
        self.assertFalse(any("--force" in item["command"] for item in report["recommended_review_commands"]))
        self.assertEqual(report["recommendedReviewCommands"], report["recommended_review_commands"])

    def test_missing_source_anchor_fails_inventory(self) -> None:
        module = load_inventory_module()
        with tempfile.TemporaryDirectory() as tmp:
            source_root = self.write_source(tmp, '<button data-pt-primary-nav="chat" />')
            report = module.build_report(source_root, Path(tmp) / "missing-dom.json")

        self.assertEqual(report["status"], "fail")
        self.assertEqual(report["sourceAnchors"]["status"], "missing")
        self.assertGreater(len(report["sourceAnchors"]["missing"]), 0)
        self.assertEqual(report["issue_breakdown"][0]["category"], "source-anchor-inventory")
        self.assertEqual(report["issue_breakdown"][0]["status"], "diagnostic incomplete")
        self.assertEqual(report["issue_breakdown"][0]["completionStatus"], "PARTIAL")
        self.assertEqual(report["issue_breakdown"][0]["proofStatus"], "UNPROVEN")
        self.assertFalse(report["issue_breakdown"][0]["sampleEmissionAllowed"])
        self.assertEqual(report["issue_breakdown"][0]["sourceArtifactKind"], "desktop-anchor-inventory")

    def test_complete_source_and_dom_evidence_passes_inventory(self) -> None:
        module = load_inventory_module()
        with tempfile.TemporaryDirectory() as tmp:
            source_root = self.write_source(tmp, self.complete_anchor_source())
            dom_evidence = Path(tmp) / "dom.json"
            dom_evidence.write_text(json.dumps(self.complete_dom_evidence(module)), encoding="utf-8")
            report = module.build_report(source_root, dom_evidence)

        self.assertEqual(report["status"], "pass")
        self.assertEqual(report["proofStatus"], "PROVEN")
        self.assertTrue(report["sampleEmissionAllowed"])
        self.assertEqual(report["domAutomation"]["proofStatus"], "PROVEN")
        self.assertEqual(report["domAutomation"]["sourceArtifactKind"], "desktop-anchor-dom-evidence")
        self.assertEqual(report["domAutomation"]["browser"]["provenCount"], 9)
        self.assertEqual(report["domAutomation"]["tauri"]["provenCount"], 9)

    def test_dom_evidence_requires_per_anchor_browser_and_tauri_matches(self) -> None:
        module = load_inventory_module()
        with tempfile.TemporaryDirectory() as tmp:
            source_root = self.write_source(tmp, self.complete_anchor_source())
            dom_evidence = Path(tmp) / "dom.json"
            dom_evidence.write_text(
                json.dumps(
                    {
                        "browser": {"status": "pass"},
                        "tauri": {"status": "pass"},
                    }
                ),
                encoding="utf-8",
            )
            report = module.build_report(source_root, dom_evidence)

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertEqual(report["domAutomation"]["status"], "diagnostic incomplete")
        self.assertEqual(report["domAutomation"]["evidenceStatus"], "missing-source-metadata")
        self.assertEqual(report["domAutomation"]["issue_breakdown"][0]["category"], "dom-automation-evidence")
        self.assertEqual(report["domAutomation"]["issue_breakdown"][0]["status"], "diagnostic incomplete")
        self.assertEqual(report["domAutomation"]["issue_breakdown"][0]["completionStatus"], "PARTIAL")
        self.assertEqual(report["domAutomation"]["issue_breakdown"][0]["proofStatus"], "UNPROVEN")
        self.assertFalse(report["domAutomation"]["issue_breakdown"][0]["sampleEmissionAllowed"])
        self.assertEqual(report["domAutomation"]["issue_breakdown"][0]["sourceArtifactKind"], "desktop-anchor-dom-evidence")
        self.assertIn("DOM evidence source metadata is incomplete", report["domAutomation"]["reason"])
        self.assertIn("browser DOM anchors are not fully proven (0/9 anchors proven)", report["domAutomation"]["reason"])
        self.assertIn("tauri DOM anchors are not fully proven (0/9 anchors proven)", report["domAutomation"]["reason"])
        self.assertIn("(0/9 anchors proven)", report["domAutomation"]["issue_breakdown"][1]["summary"])
        self.assertEqual(report["domAutomation"]["browser"]["provenCount"], 0)
        self.assertEqual(report["domAutomation"]["tauri"]["provenCount"], 0)
        markdown = module.render_markdown(report)
        self.assertIn("| Anchor | Browser | Tauri |", markdown)
        self.assertIn("`diagnostic incomplete`", markdown)
        self.assertIn("missing or invalid phase", markdown)


if __name__ == "__main__":
    unittest.main()
