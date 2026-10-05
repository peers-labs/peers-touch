#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


def load_template_module():
    script = Path(__file__).with_name("desktop-performance-cell-template.py")
    spec = importlib.util.spec_from_file_location("desktop_performance_cell_template", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {script}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def load_matrix_module():
    script = Path(__file__).with_name("desktop-performance-matrix-gate.py")
    spec = importlib.util.spec_from_file_location("desktop_performance_matrix_gate", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {script}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class DesktopPerformanceCellTemplateTest(unittest.TestCase):
    def test_templates_cover_native_runtime_cells_with_trace_metadata(self) -> None:
        module = load_template_module()
        templates = module.build_templates()

        self.assertEqual(
            set(templates),
            {"tauri-webview-dev", "tauri-webview-packaged"},
        )
        for cell_id, template in templates.items():
            self.assertEqual(template["artifactKind"], "desktop-performance-runtime-cell")
            self.assertEqual(template["status"], "diagnostic incomplete")
            self.assertEqual(template["completionStatus"], "PARTIAL")
            self.assertEqual(template["proofStatus"], "UNPROVEN")
            self.assertEqual(template["phase"], "P0c-3")
            self.assertEqual(template["bom"], ["BOM-GATE-02", "BOM-CAP-04"])
            self.assertEqual(template["spec"], ["SPEC-GATE-02", "SPEC-RUN-01"])
            self.assertTrue(template["gate"])
            self.assertEqual(template["cellId"], cell_id)
            self.assertFalse(template["sampleEmissionAllowed"])
            self.assertEqual(template["summary"]["completionStatus"], "PARTIAL")
            self.assertEqual(template["summary"]["proofStatus"], "UNPROVEN")
            self.assertFalse(template["summary"]["sampleEmissionAllowed"])
            self.assertEqual(template["issue_breakdown"][0]["category"], "runtime-cell-evidence")
            self.assertEqual(template["issueBreakdown"][0]["failedStep"], cell_id)
            self.assertEqual(template["issue_breakdown"][0]["status"], "diagnostic incomplete")
            self.assertEqual(template["issue_breakdown"][0]["completionStatus"], "PARTIAL")
            self.assertEqual(template["issue_breakdown"][0]["proofStatus"], "UNPROVEN")
            self.assertFalse(template["issue_breakdown"][0]["sampleEmissionAllowed"])
            self.assertEqual(template["issue_breakdown"][0]["sourcePhase"], "P0c-3")
            self.assertEqual(template["issue_breakdown"][0]["sourceBom"], ["BOM-GATE-02", "BOM-CAP-04"])
            self.assertEqual(template["issue_breakdown"][0]["sourceSpec"], ["SPEC-GATE-02", "SPEC-RUN-01"])
            self.assertEqual(template["recommended_review_commands"][0]["command"], template["entrypoint"])
            self.assertEqual(template["recommendedReviewCommands"][0]["command"], template["entrypoint"])

    def test_observations_template_stays_fail_closed(self) -> None:
        module = load_template_module()
        template = module.build_observations_template()

        self.assertEqual(template["artifactKind"], "desktop-performance-cell-observations-template")
        self.assertEqual(template["completionStatus"], "PARTIAL")
        self.assertEqual(template["proofStatus"], "UNPROVEN")
        self.assertFalse(template["sampleEmissionAllowed"])
        self.assertEqual(template["summary"]["completionStatus"], "PARTIAL")
        self.assertEqual(template["summary"]["proofStatus"], "UNPROVEN")
        self.assertFalse(template["summary"]["sampleEmissionAllowed"])
        self.assertEqual(template["phase"], "P0c-3")
        self.assertEqual(template["bom"], ["BOM-GATE-02", "BOM-CAP-04"])
        self.assertEqual(template["spec"], ["SPEC-GATE-02", "SPEC-RUN-01"])
        self.assertEqual(
            template["requiredCells"],
            ["tauri-webview-dev", "tauri-webview-packaged"],
        )
        self.assertEqual(
            template["cells"]["tauri-webview-dev"]["readyShell"]["status"],
            "diagnostic incomplete",
        )
        self.assertEqual(
            template["cells"]["tauri-webview-packaged"]["readyShell"]["status"],
            "diagnostic incomplete",
        )

    def test_main_writes_templates(self) -> None:
        module = load_template_module()
        with tempfile.TemporaryDirectory() as tmp:
            observations_template = Path(tmp) / "runtime-cell-observations-template.json"
            old_argv = sys.argv
            try:
                sys.argv = [
                    "desktop-performance-cell-template.py",
                    "--output-dir",
                    tmp,
                    "--observations-template-output",
                    str(observations_template),
                ]
                exit_code = module.main()
            finally:
                sys.argv = old_argv

            written = sorted(path.name for path in Path(tmp).glob("*.json"))
            observations_written = json.loads(observations_template.read_text(encoding="utf-8"))

        self.assertEqual(exit_code, 0)
        self.assertEqual(
            written,
            [
                "runtime-cell-observations-template.json",
                "tauri-webview-dev.json",
                "tauri-webview-packaged.json",
            ],
        )
        self.assertEqual(observations_written["artifactKind"], "desktop-performance-cell-observations-template")
        self.assertFalse(observations_written["sampleEmissionAllowed"])
        self.assertFalse(observations_written["summary"]["sampleEmissionAllowed"])

    def test_main_strict_exit_fails_for_unproven_templates(self) -> None:
        module = load_template_module()
        with tempfile.TemporaryDirectory() as tmp:
            observations_template = Path(tmp) / "runtime-cell-observations-template.json"
            old_argv = sys.argv
            try:
                sys.argv = [
                    "desktop-performance-cell-template.py",
                    "--output-dir",
                    tmp,
                    "--observations-template-output",
                    str(observations_template),
                    "--strict-exit",
                ]
                exit_code = module.main()
            finally:
                sys.argv = old_argv

        self.assertEqual(exit_code, 1)

    def test_matrix_gate_loads_templates_without_allowing_sample_emission(self) -> None:
        template = load_template_module()
        matrix = load_matrix_module()
        with tempfile.TemporaryDirectory() as tmp:
            cell_dir = Path(tmp) / "cells"
            template.write_templates(cell_dir)
            report = matrix.build_matrix(
                argparse.Namespace(
                    events_report=str(Path(tmp) / "missing-events.json"),
                    cell_evidence_dir=str(cell_dir),
                )
            )

        runtime_cells = report["cells"]
        self.assertEqual(len(runtime_cells), 2)
        for cell in runtime_cells:
            self.assertEqual(cell["status"], "diagnostic incomplete")
            self.assertEqual(cell["proofStatus"], "UNPROVEN")
            self.assertFalse(cell["sampleEmissionAllowed"])
            self.assertEqual(cell["evidence"]["status"], "loaded")
            self.assertEqual(cell["evidence"]["sourceArtifactKind"], "desktop-performance-runtime-cell")
            self.assertEqual(cell["evidence"]["sourceStatus"], "diagnostic incomplete")
            self.assertEqual(cell["evidence"]["completionStatus"], "PARTIAL")
            self.assertEqual(cell["evidence"]["proofStatus"], "UNPROVEN")
            self.assertEqual(cell["evidence"]["sourcePhase"], "P0c-3")
            self.assertEqual(cell["evidence"]["sourceBom"], ["BOM-GATE-02", "BOM-CAP-04"])
            self.assertEqual(cell["evidence"]["sourceSpec"], ["SPEC-GATE-02", "SPEC-RUN-01"])
            self.assertEqual(cell["evidence"]["issue_breakdown"][0]["category"], "runtime-cell-evidence")
            self.assertEqual(cell["evidence"]["issueBreakdown"][0]["category"], "runtime-cell-evidence")
            self.assertEqual(cell["evidence"]["recommended_review_commands"][0]["command"], cell["entrypoint"])
            self.assertEqual(cell["evidence"]["recommendedReviewCommands"][0]["command"], cell["entrypoint"])
        markdown = matrix.render_markdown(report)
        self.assertIn("`P0c-3`", markdown)
        self.assertIn("`BOM-GATE-02,BOM-CAP-04`", markdown)
        self.assertIn("`SPEC-GATE-02,SPEC-RUN-01`", markdown)


if __name__ == "__main__":
    unittest.main()
