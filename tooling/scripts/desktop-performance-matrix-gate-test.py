#!/usr/bin/env python3

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).with_name("desktop-performance-matrix-gate.py")
SPEC = importlib.util.spec_from_file_location(
    "desktop_performance_matrix_gate",
    SCRIPT,
)
assert SPEC is not None and SPEC.loader is not None
module = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = module
SPEC.loader.exec_module(module)


class DesktopPerformanceMatrixGateTest(unittest.TestCase):
    def write_proven_inputs(self, root: Path) -> tuple[Path, Path, Path]:
        cells = root / "cells"
        cells.mkdir()
        for spec in module.DEFAULT_CELLS:
            (cells / f"{spec.cell_id}.json").write_text(
                json.dumps(
                    {
                        "artifactKind": module.CELL_REQUIRED_ARTIFACT_KIND,
                        "status": "sampled",
                        "completionStatus": "DONE",
                        "proofStatus": "PROVEN",
                        "sampleEmissionAllowed": True,
                        "phase": module.CELL_REQUIRED_PHASE,
                        "bom": list(spec.bom),
                        "spec": list(spec.spec),
                        "gate": spec.gate,
                        "cellId": spec.cell_id,
                        "runtime": spec.runtime,
                        "entrypoint": spec.entrypoint,
                        "startupMode": spec.startup_mode,
                        "interactionId": f"{spec.cell_id}-interaction",
                    }
                ),
                encoding="utf-8",
            )
        cohort = root / "cohort.json"
        cohort.write_text(
            json.dumps(
                {
                    "artifactKind": module.COHORT_REQUIRED_ARTIFACT_KIND,
                    "status": "pass",
                    "completionStatus": "DONE",
                    "proofStatus": "PROVEN",
                    "sampleEmissionAllowed": True,
                    "phase": module.COHORT_REQUIRED_PHASE,
                    "planTask": module.COHORT_REQUIRED_TASK,
                    "gate": "All Native runtime cells share one proven cohort",
                }
            ),
            encoding="utf-8",
        )
        events = root / "events.json"
        events.write_text(
            json.dumps(
                {
                    "artifactKind": module.RAW_EVENTS_REQUIRED_ARTIFACT_KIND,
                    "phase": module.RAW_EVENTS_REQUIRED_PHASE,
                    "bom": list(module.RAW_EVENTS_REQUIRED_BOM),
                    "spec": list(module.RAW_EVENTS_REQUIRED_SPEC),
                    "gate": "Station mirror preserves Native Desktop telemetry evidence",
                    "completionStatus": "DONE",
                    "proofStatus": "PROVEN",
                    "productSink": module.RAW_EVENTS_REQUIRED_PRODUCT_SINK,
                    "mirrorRole": module.RAW_EVENTS_REQUIRED_ROLE,
                    "events": [
                        {"kind": "interaction.started", "interactionId": "i-1"},
                        {"kind": "route.requested", "interactionId": "i-1"},
                        {"kind": "route.visible", "durationMs": 40, "interactionId": "i-1"},
                        {"kind": "surface.render", "durationMs": 20, "interactionId": "i-1"},
                        {"kind": "react.commit", "durationMs": 10, "interactionId": "i-1"},
                        {"kind": "contextmenu.intent", "interactionId": "i-1"},
                        {"kind": "overlay.visible", "durationMs": 10, "interactionId": "i-1"},
                        {"kind": "invoke.started", "interactionId": "i-1"},
                        {"kind": "invoke.completed", "durationMs": 20, "interactionId": "i-1"},
                        {"kind": "longtask.detected", "durationMs": 45, "interactionId": "i-1"},
                        {"kind": "layout.shift", "durationMs": 0.05, "interactionId": "i-1"},
                        {"kind": "paint.timing", "durationMs": 1, "interactionId": "i-1"},
                    ],
                }
            ),
            encoding="utf-8",
        )
        return cells, cohort, events

    def test_matrix_contains_only_native_tauri_runtime_cells(self) -> None:
        self.assertEqual(
            [cell.cell_id for cell in module.DEFAULT_CELLS],
            ["tauri-webview-dev", "tauri-webview-packaged"],
        )
        self.assertEqual(
            {cell.runtime for cell in module.DEFAULT_CELLS},
            {"tauri-webview-dev", "tauri-webview-packaged"},
        )
        self.assertEqual(
            {cell.entrypoint for cell in module.DEFAULT_CELLS},
            {
                "make desktop",
                "pnpm --dir apps/desktop tauri build --features acceptance-webdriver",
            },
        )

    def test_matrix_startup_modes_are_native(self) -> None:
        self.assertTrue(
            all(
                "tauri" in cell.startup_mode
                for cell in module.DEFAULT_CELLS
            )
        )

    def test_native_cell_remains_fail_closed_without_proof(self) -> None:
        cell = module.build_cell(
            module.DEFAULT_CELLS[0],
            status="diagnostic incomplete",
            reason="native evidence missing",
            evidence={
                "status": "diagnostic incomplete",
                "proofStatus": "UNPROVEN",
            },
            cohort_allowed=False,
        )
        self.assertFalse(cell["sampleEmissionAllowed"])
        self.assertEqual(cell["proofStatus"], "UNPROVEN")
        self.assertEqual(cell["runtime"], "tauri-webview-dev")

    def test_matrix_has_no_retired_runtime_preflight_dependency(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            report = module.build_matrix(
                argparse.Namespace(
                    events_report=str(Path(tmp) / "missing-events.json"),
                    cell_evidence_dir=str(Path(tmp) / "missing-cells"),
                )
            )

        self.assertNotIn("preflightState", report)
        self.assertNotIn("sampleEmissionRequiresPreflightPass", report["failClosed"])
        self.assertEqual(
            report["failClosed"]["allowedStatuses"],
            ["blocked", "diagnostic incomplete", "sampled"],
        )

    def test_proven_native_cells_and_station_mirror_pass(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cells, cohort, events = self.write_proven_inputs(Path(tmp))
            report = module.build_matrix(
                argparse.Namespace(
                    events_report=str(events),
                    cell_evidence_dir=str(cells),
                    cohort_report=str(cohort),
                )
            )

        self.assertEqual(report["status"], "pass")
        self.assertEqual(report["proofStatus"], "PROVEN")
        self.assertTrue(report["sampleEmissionAllowed"])
        self.assertEqual(report["summary"]["sampled"], 2)
        self.assertEqual(report["redLinePolicy"]["status"], "pass")

    def test_failed_cohort_blocks_all_native_cells(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cells, cohort, events = self.write_proven_inputs(Path(tmp))
            cohort.write_text(
                json.dumps(
                    {
                        "artifactKind": module.COHORT_REQUIRED_ARTIFACT_KIND,
                        "status": "diagnostic incomplete",
                        "completionStatus": "PARTIAL",
                        "proofStatus": "UNPROVEN",
                        "sampleEmissionAllowed": False,
                        "phase": module.COHORT_REQUIRED_PHASE,
                        "planTask": module.COHORT_REQUIRED_TASK,
                        "gate": "All Native runtime cells share one proven cohort",
                        "reason": "actual actor mismatch",
                    }
                ),
                encoding="utf-8",
            )
            report = module.build_matrix(
                argparse.Namespace(
                    events_report=str(events),
                    cell_evidence_dir=str(cells),
                    cohort_report=str(cohort),
                )
            )

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertFalse(report["sampleEmissionAllowed"])
        self.assertEqual(report["failClosed"]["blockedCellCount"], 2)
        self.assertTrue(all(not cell["sampleEmissionAllowed"] for cell in report["cells"]))

    def test_station_mirror_without_proof_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cells, cohort, events = self.write_proven_inputs(Path(tmp))
            mirror = json.loads(events.read_text(encoding="utf-8"))
            mirror["completionStatus"] = "PARTIAL"
            mirror["proofStatus"] = "UNPROVEN"
            events.write_text(json.dumps(mirror), encoding="utf-8")
            report = module.build_matrix(
                argparse.Namespace(
                    events_report=str(events),
                    cell_evidence_dir=str(cells),
                    cohort_report=str(cohort),
                )
            )

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(
            report["redLinePolicy"]["rawEvidence"]["status"],
            "source-proof-unproven",
        )
        self.assertFalse(report["sampleEmissionAllowed"])

    def test_default_inputs_use_native_artifact_producers(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "artifact-root"
            output = Path(tmp) / "matrix"
            calls: list[tuple[str, str]] = []

            def fake_latest_artifact(gate_id: str, role: str) -> tuple[Path, dict]:
                calls.append((gate_id, role))
                if role.startswith("cell-"):
                    path = root / "cells" / f"{role.removeprefix('cell-')}.json"
                else:
                    path = root / gate_id / f"{role}.json"
                return path, {
                    "workspaceId": "workspace",
                    "gateId": gate_id,
                    "runId": "run",
                    "path": role,
                }

            def fake_build_matrix(args: argparse.Namespace) -> dict:
                return {
                    "status": "diagnostic incomplete",
                    "completionStatus": "PARTIAL",
                    "proofStatus": "UNPROVEN",
                    "resolvedInputs": [
                        args.cohort_report,
                        args.events_report,
                        args.cell_evidence_dir,
                    ],
                }

            old_argv = sys.argv
            try:
                sys.argv = [
                    "desktop-performance-matrix-gate.py",
                    "--output-prefix",
                    str(output),
                ]
                with mock.patch.object(
                    module,
                    "latest_artifact",
                    side_effect=fake_latest_artifact,
                ), mock.patch.object(
                    module,
                    "build_matrix",
                    side_effect=fake_build_matrix,
                ), mock.patch.object(
                    module,
                    "render_markdown",
                    return_value="matrix\n",
                ):
                    module.main()
            finally:
                sys.argv = old_argv

            persisted = output.with_suffix(".json").read_text(encoding="utf-8")

        self.assertIn(("desktop-telemetry-mirror-template-gate", "report"), calls)
        self.assertEqual(
            {gate_id for gate_id, _ in calls},
            {
                "desktop-performance-cohort-gate",
                "desktop-performance-cell-collect-gate",
                "desktop-telemetry-mirror-template-gate",
            },
        )
        self.assertIn('"inputArtifactRefs"', persisted)


if __name__ == "__main__":
    unittest.main()
