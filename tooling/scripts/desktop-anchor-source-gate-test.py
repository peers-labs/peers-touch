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


def load_source_gate_module():
    script = Path(__file__).with_name("desktop-anchor-source-gate.py")
    spec = importlib.util.spec_from_file_location("desktop_anchor_source_gate", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {script}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class DesktopAnchorSourceGateTest(unittest.TestCase):
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
        <textarea data-pt-text-input="chat-composer" />
        <div
          data-pt-context-menu-trigger="chat-conversation"
          data-pt-context-menu-kind={c.kind}
          data-pt-context-menu-id={c.id}
        />
        """

    def test_complete_source_anchor_inventory_passes(self) -> None:
        module = load_source_gate_module()
        with tempfile.TemporaryDirectory() as tmp:
            source_root = self.write_source(tmp, self.complete_anchor_source())
            report = module.build_report(source_root)

        self.assertEqual(report["status"], "pass")
        self.assertEqual(report["completionStatus"], "DONE")
        self.assertEqual(report["proofStatus"], "PROVEN")
        self.assertTrue(report["sampleEmissionAllowed"])
        self.assertTrue(report["summary"]["sampleEmissionAllowed"])
        self.assertEqual(report["phase"], "P0b-1")
        self.assertEqual(report["bom"], ["BOM-SMP-01"])
        self.assertEqual(report["spec"], ["SPEC-ANCHOR-01"])
        self.assertEqual(report["requiredCount"], 10)
        self.assertEqual(report["presentCount"], 10)
        self.assertEqual(report["missing"], [])

    def test_missing_source_anchor_fails_without_dom_claim(self) -> None:
        module = load_source_gate_module()
        with tempfile.TemporaryDirectory() as tmp:
            source_root = self.write_source(tmp, '<button data-pt-primary-nav="chat" />')
            report = module.build_report(source_root)

        self.assertEqual(report["status"], "fail")
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertFalse(report["sampleEmissionAllowed"])
        self.assertFalse(report["summary"]["sampleEmissionAllowed"])
        self.assertGreater(len(report["missing"]), 0)
        self.assertEqual(report["issue_breakdown"][0]["status"], "diagnostic incomplete")
        self.assertEqual(report["issue_breakdown"][0]["completionStatus"], "PARTIAL")
        self.assertEqual(report["issue_breakdown"][0]["proofStatus"], "UNPROVEN")
        self.assertFalse(report["issue_breakdown"][0]["sampleEmissionAllowed"])
        self.assertEqual(report["issue_breakdown"][0]["sourceArtifactKind"], "desktop-anchor-source-gate")
        self.assertEqual(report["issue_breakdown"][0]["sourcePhase"], "P0b-1")
        self.assertIn("DOM evidence remains separate", report["boundary"])

    def test_main_writes_source_gate_artifacts(self) -> None:
        module = load_source_gate_module()
        with tempfile.TemporaryDirectory() as tmp:
            source_root = self.write_source(tmp, self.complete_anchor_source())
            output_prefix = Path(tmp) / "desktop-anchor-source-gate-latest"
            old_argv = sys.argv
            try:
                sys.argv = [
                    "desktop-anchor-source-gate.py",
                    "--source-root",
                    str(source_root),
                    "--output-prefix",
                    str(output_prefix),
                ]
                exit_code = module.main()
            finally:
                sys.argv = old_argv

            written = json.loads(output_prefix.with_suffix(".json").read_text(encoding="utf-8"))
            markdown = output_prefix.with_suffix(".md").read_text(encoding="utf-8")

        self.assertEqual(exit_code, 0)
        self.assertEqual(written["status"], "pass")
        self.assertIn("Desktop Anchor Source Gate", markdown)
        self.assertIn("does not inspect runtime DOM", markdown)

    def test_main_defaults_to_external_artifact_session(self) -> None:
        module = load_source_gate_module()
        with tempfile.TemporaryDirectory() as tmp:
            source_root = self.write_source(tmp, self.complete_anchor_source())
            old_argv = sys.argv
            try:
                sys.argv = [
                    "desktop-anchor-source-gate.py",
                    "--source-root",
                    str(source_root),
                ]
                with patch.dict(
                    os.environ,
                    {"PT_ACCEPTANCE_ARTIFACT_ROOT": str(Path(tmp) / "artifacts")},
                ):
                    exit_code = module.main()
                    report_path = latest_path(module.ARTIFACT_KIND, "report")
                    written = json.loads(report_path.read_text(encoding="utf-8"))
            finally:
                sys.argv = old_argv

        self.assertEqual(exit_code, 0)
        self.assertEqual(written["status"], "pass")
        self.assertTrue(report_path.resolve().is_relative_to(Path(tmp).resolve()))


if __name__ == "__main__":
    unittest.main()
