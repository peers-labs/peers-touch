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


def load_module():
    script = Path(__file__).with_name("desktop-local-telemetry-buffer-gate.py")
    spec = importlib.util.spec_from_file_location("desktop_local_telemetry_buffer_gate", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {script}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def proven_observation() -> dict:
    return {
        "source": "window.__PT_FRONTEND_TELEMETRY__",
        "runtime": "browser-gateway",
        "url": "http://localhost:3210/#/chat",
        "readyState": "complete",
        "eventCount": 11,
        "maxEvents": 500,
        "droppedCount": 0,
        "byKind": {
            "interaction.started": 1,
            "react.commit": 1,
            "store.update": 1,
            "contextmenu.intent": 1,
            "overlay.visible": 1,
            "invoke.started": 1,
            "invoke.completed": 1,
            "longtask.detected": 1,
            "layout.shift": 1,
            "paint.timing": 1,
            "route.visible": 1,
        },
        "withInteraction": {
            "interaction.started": 1,
            "react.commit": 1,
            "store.update": 1,
            "contextmenu.intent": 1,
            "overlay.visible": 1,
            "invoke.started": 1,
            "invoke.completed": 1,
            "longtask.detected": 1,
            "layout.shift": 1,
            "route.visible": 1,
        },
        "droppedByKind": {},
        "droppedWithInteraction": {},
    }


class DesktopLocalTelemetryBufferGateTest(unittest.TestCase):
    def test_missing_observations_are_partial_unproven(self) -> None:
        module = load_module()

        observation, source = module.read_json(Path("/missing/observations.json"))
        report = module.build_report(observation, source)

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertEqual(report["failedStep"], "observation-source")
        self.assertFalse(report["sampleEmissionAllowed"])

    def test_missing_required_fields_stays_fail_closed(self) -> None:
        module = load_module()
        observation = proven_observation()
        observation.pop("maxEvents")

        report = module.build_report(observation, {"status": "loaded"})

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["failedStep"], "observation-required-fields")
        self.assertIn("maxEvents", report["summary"]["missingObservationFields"])
        self.assertEqual(report["families"]["reactCommit"]["status"], "pass")

    def test_proven_snapshot_is_done_but_does_not_allow_sample_emission_by_itself(self) -> None:
        module = load_module()

        report = module.build_report(proven_observation(), {"status": "loaded"})

        self.assertEqual(report["status"], "pass")
        self.assertEqual(report["completionStatus"], "DONE")
        self.assertEqual(report["proofStatus"], "PROVEN")
        self.assertFalse(report["sampleEmissionAllowed"])
        self.assertEqual(report["summary"]["familyPassCount"], 6)
        self.assertEqual(report["summary"]["familyUnprovenCount"], 0)
        self.assertEqual(report["issue_breakdown"], [])

    def test_dropped_events_keep_buffer_unproven(self) -> None:
        module = load_module()
        observation = proven_observation()
        observation["droppedCount"] = 1
        observation["droppedByKind"] = {"interaction.started": 1}
        observation["droppedWithInteraction"] = {"interaction.started": 1}

        report = module.build_report(observation, {"status": "loaded"})

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["failedStep"], "local-buffer-drops")
        self.assertEqual(report["summary"]["retentionWindowProofStatus"], "UNPROVEN")

    def test_writes_json_and_markdown(self) -> None:
        module = load_module()
        report = module.build_report(proven_observation(), {"status": "loaded"})
        with tempfile.TemporaryDirectory() as tmp:
            json_path, md_path = module.write_outputs(report, Path(tmp) / "buffer")

            self.assertTrue(json_path.exists())
            self.assertTrue(md_path.exists())
            self.assertIn("Desktop Local Telemetry Buffer Gate", md_path.read_text(encoding="utf-8"))

    def test_main_without_runtime_observations_writes_external_unproven_report(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            old_argv = sys.argv
            try:
                sys.argv = ["desktop-local-telemetry-buffer-gate.py"]
                with patch.dict(
                    os.environ,
                    {"PT_ACCEPTANCE_ARTIFACT_ROOT": str(Path(tmp) / "artifacts")},
                ):
                    exit_code = module.main()
                    report_path = latest_path(module.ARTIFACT_KIND, "report")
                    written = json.loads(report_path.read_text(encoding="utf-8"))
            finally:
                sys.argv = old_argv

        self.assertEqual(exit_code, 1)
        self.assertEqual(written["proofStatus"], "UNPROVEN")
        self.assertEqual(
            written["sourceArtifact"],
            "evidence-store:current:report",
        )
        self.assertTrue(report_path.resolve().is_relative_to(Path(tmp).resolve()))


if __name__ == "__main__":
    unittest.main()
