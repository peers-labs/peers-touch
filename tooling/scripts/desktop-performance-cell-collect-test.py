#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


def load_collect_module():
    script = Path(__file__).with_name("desktop-performance-cell-collect.py")
    spec = importlib.util.spec_from_file_location("desktop_performance_cell_collect", script)
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


class DesktopPerformanceCellCollectTest(unittest.TestCase):
    def sampled_observations(self) -> dict[str, object]:
        return {
            "cells": {
                "tauri-webview": {
                    "runtime": "tauri-webview",
                    "entrypoint": "make desktop",
                    "startupMode": "dev-tauri-webview",
                    "readyShell": {
                        "status": "pass",
                        "visible": True,
                    },
                    "events": [
                        {
                            "kind": "interaction.started",
                            "interactionId": "tauri-sample-1",
                            "durationMs": 0,
                        },
                        {
                            "kind": "route.visible",
                            "interactionId": "tauri-sample-1",
                            "durationMs": 42,
                        },
                    ],
                }
            }
        }

    def test_sampled_observation_emits_proven_cell_contract_accepted_by_matrix(self) -> None:
        collect = load_collect_module()
        matrix = load_matrix_module()
        evidence = collect.build_evidence(
            self.sampled_observations(),
            {"status": "loaded", "path": "inline"},
            ["tauri-webview"],
        )["tauri-webview"]

        self.assertEqual(evidence["status"], "sampled")
        self.assertEqual(evidence["artifactKind"], "desktop-performance-runtime-cell")
        self.assertEqual(evidence["completionStatus"], "DONE")
        self.assertEqual(evidence["proofStatus"], "PROVEN")
        self.assertEqual(evidence["phase"], "P0c-3")
        self.assertEqual(evidence["bom"], ["BOM-GATE-02", "BOM-CAP-04"])
        self.assertEqual(evidence["spec"], ["SPEC-GATE-02", "SPEC-RUN-01"])
        self.assertEqual(evidence["interactionId"], "tauri-sample-1")
        self.assertTrue(evidence["sampleEmissionAllowed"])
        self.assertEqual(evidence["validationDetails"], [])
        self.assertNotIn("issue_breakdown", evidence)
        self.assertNotIn("recommended_review_commands", evidence)

        with tempfile.TemporaryDirectory() as tmp:
            cell_dir = Path(tmp) / "cells"
            collect.write_evidence({"tauri-webview": evidence}, cell_dir)
            report = matrix.build_matrix(
                argparse.Namespace(
                    live_gate_report=str(Path(tmp) / "missing-live-gate.json"),
                    events_report=str(Path(tmp) / "missing-events.json"),
                    cell_evidence_dir=str(cell_dir),
                )
            )

        tauri = next(cell for cell in report["cells"] if cell["cellId"] == "tauri-webview")
        self.assertEqual(tauri["status"], "sampled")
        self.assertEqual(tauri["proofStatus"], "PROVEN")
        self.assertTrue(tauri["sampleEmissionAllowed"])
        self.assertEqual(tauri["evidence"]["status"], "loaded")
        self.assertEqual(tauri["evidence"]["sourceArtifactKind"], "desktop-performance-runtime-cell")
        self.assertEqual(tauri["evidence"]["sourcePhase"], "P0c-3")

    def test_missing_runtime_samples_stay_partial_unproven(self) -> None:
        collect = load_collect_module()
        evidence = collect.build_evidence(
            {},
            {
                "status": "missing",
                "path": "tooling/acceptance/reports/desktop-performance-cell-observations.json",
                "reason": "runtime cell observations file is missing",
            },
            ["prod-preview"],
        )["prod-preview"]

        self.assertEqual(evidence["status"], "diagnostic incomplete")
        self.assertEqual(evidence["completionStatus"], "PARTIAL")
        self.assertEqual(evidence["proofStatus"], "UNPROVEN")
        self.assertFalse(evidence["sampleEmissionAllowed"])
        self.assertEqual(evidence["readyShell"]["proofStatus"], "UNPROVEN")
        self.assertEqual(evidence["telemetry"]["proofStatus"], "UNPROVEN")
        self.assertIn("missing runtime cell observation", evidence["validationDetails"])
        self.assertEqual(evidence["issue_breakdown"][0]["category"], "runtime-cell-evidence")
        self.assertEqual(evidence["issueBreakdown"][0]["failedStep"], "prod-preview")
        self.assertEqual(evidence["recommended_review_commands"][0]["command"], "make desktop-web PREVIEW=1")
        self.assertEqual(evidence["recommendedReviewCommands"][0]["command"], "make desktop-web PREVIEW=1")

    def test_runtime_entrypoint_startup_mismatch_blocks_sample_emission(self) -> None:
        collect = load_collect_module()
        observations = self.sampled_observations()
        observations["cells"]["tauri-webview"]["entrypoint"] = "make desktop-web"
        evidence = collect.build_evidence(
            observations,
            {"status": "loaded", "path": "inline"},
            ["tauri-webview"],
        )["tauri-webview"]

        self.assertEqual(evidence["status"], "diagnostic incomplete")
        self.assertEqual(evidence["proofStatus"], "UNPROVEN")
        self.assertFalse(evidence["sampleEmissionAllowed"])
        self.assertIn("entrypoint observation does not match matrix cell", evidence["validationDetails"])
        self.assertEqual(evidence["issue_breakdown"][0]["category"], "runtime-cell-evidence")
        self.assertEqual(evidence["recommended_review_commands"][0]["command"], "make desktop")

    def test_main_writes_fail_closed_cell_evidence_when_observations_are_missing(self) -> None:
        collect = load_collect_module()
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "cells"
            old_argv = sys.argv
            try:
                sys.argv = [
                    "desktop-performance-cell-collect.py",
                    "--observations",
                    str(Path(tmp) / "missing-observations.json"),
                    "--output-dir",
                    str(output_dir),
                ]
                exit_code = collect.main()
            finally:
                sys.argv = old_argv

            written = sorted(path.name for path in output_dir.glob("*.json"))
            tauri = json.loads((output_dir / "tauri-webview.json").read_text(encoding="utf-8"))

        self.assertEqual(exit_code, 0)
        self.assertEqual(written, ["offline-fixture.json", "prod-preview.json", "tauri-webview.json"])
        self.assertEqual(tauri["status"], "diagnostic incomplete")
        self.assertEqual(tauri["artifactKind"], "desktop-performance-runtime-cell")
        self.assertEqual(tauri["completionStatus"], "PARTIAL")
        self.assertEqual(tauri["proofStatus"], "UNPROVEN")
        self.assertEqual(tauri["observationSource"]["status"], "missing")
        self.assertEqual(tauri["issue_breakdown"][0]["category"], "runtime-cell-evidence")
        self.assertEqual(tauri["recommended_review_commands"][0]["command"], "make desktop")

    def test_main_strict_exit_fails_when_runtime_samples_are_missing(self) -> None:
        collect = load_collect_module()
        with tempfile.TemporaryDirectory() as tmp:
            output_dir = Path(tmp) / "cells"
            old_argv = sys.argv
            try:
                sys.argv = [
                    "desktop-performance-cell-collect.py",
                    "--observations",
                    str(Path(tmp) / "missing-observations.json"),
                    "--output-dir",
                    str(output_dir),
                    "--strict-exit",
                ]
                exit_code = collect.main()
            finally:
                sys.argv = old_argv

        self.assertEqual(exit_code, 1)


if __name__ == "__main__":
    unittest.main()
