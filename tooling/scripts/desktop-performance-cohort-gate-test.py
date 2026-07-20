#!/usr/bin/env python3
"""Regression tests for the P0c3-R2 cohort gate."""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any


def load_module() -> Any:
    script = Path(__file__).with_name("desktop-performance-cohort-gate.py")
    spec = importlib.util.spec_from_file_location("desktop_performance_cohort_gate", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {script}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def manifest() -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "artifactKind": "desktop-performance-cohort-manifest",
        "phase": "P0c-3",
        "planTask": "P0c3-R2",
        "cohortId": "cohort-1",
        "profile": "performance",
        "account": "actor-1",
        "expectedActorId": "actor-1",
        "station": "http://station",
        "dataRevision": "data-1",
        "window": {"width": 1200, "height": 800},
        "warmupRuns": 5,
        "postWarmupSamplesPerScenario": 30,
        "buildRevision": "revision-1",
        "runtimes": [
            "browser-gateway",
            "tauri-webview-dev",
            "tauri-webview-packaged",
        ],
        "scenarios": [
            "text-input",
            "primary-nav",
            "secondary-tab",
            "overlay",
        ],
    }


def observations(source: dict[str, Any]) -> dict[str, Any]:
    cell = {
        "cohortId": source["cohortId"],
        "profile": source["profile"],
        "account": source["account"],
        "actualActorId": source["expectedActorId"],
        "station": source["station"],
        "dataRevision": source["dataRevision"],
        "window": source["window"],
        "warmupRuns": source["warmupRuns"],
        "buildRevision": source["buildRevision"],
        "scenarios": source["scenarios"],
    }
    return {
        "artifactKind": "desktop-performance-cohort-observations",
        "cells": {
            runtime: {"runtime": runtime, **cell}
            for runtime in source["runtimes"]
        },
    }


class DesktopPerformanceCohortGateTest(unittest.TestCase):
    def write_sources(
        self,
        root: str,
        cohort_manifest: dict[str, Any],
        cohort_observations: dict[str, Any],
    ) -> tuple[Path, Path]:
        manifest_path = Path(root) / "manifest.json"
        observations_path = Path(root) / "observations.json"
        manifest_path.write_text(json.dumps(cohort_manifest), encoding="utf-8")
        observations_path.write_text(json.dumps(cohort_observations), encoding="utf-8")
        return manifest_path, observations_path

    def test_complete_identical_cohort_passes(self) -> None:
        module = load_module()
        source = manifest()
        with tempfile.TemporaryDirectory() as tmp:
            manifest_path, observations_path = self.write_sources(tmp, source, observations(source))
            report = module.build_report(manifest_path, observations_path)

        self.assertEqual(report["status"], "pass")
        self.assertEqual(report["proofStatus"], "PROVEN")
        self.assertTrue(report["sampleEmissionAllowed"])
        self.assertEqual(report["issue_breakdown"], [])
        self.assertEqual(report["summary"]["observedCellCount"], 3)

    def test_missing_runtime_observation_blocks_all_cells(self) -> None:
        module = load_module()
        source = manifest()
        observed = observations(source)
        del observed["cells"]["tauri-webview-packaged"]
        with tempfile.TemporaryDirectory() as tmp:
            manifest_path, observations_path = self.write_sources(tmp, source, observed)
            report = module.build_report(manifest_path, observations_path)

        self.assertEqual(report["status"], "diagnostic incomplete")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertFalse(report["sampleEmissionAllowed"])
        self.assertEqual(report["issue_breakdown"][0]["failedStep"], "cohort.tauri-webview-packaged")

    def test_actual_actor_mismatch_is_explicit_and_fail_closed(self) -> None:
        module = load_module()
        source = manifest()
        observed = observations(source)
        observed["cells"]["tauri-webview-dev"]["actualActorId"] = "actor-2"
        with tempfile.TemporaryDirectory() as tmp:
            manifest_path, observations_path = self.write_sources(tmp, source, observed)
            report = module.build_report(manifest_path, observations_path)

        actor_issue = next(
            item for item in report["issue_breakdown"]
            if item["category"] == "cohort-actual-actor"
        )
        self.assertFalse(report["sampleEmissionAllowed"])
        self.assertEqual(actor_issue["failedStep"], "cohort.tauri-webview-dev.actualActorId")
        self.assertIn("got='actor-2' want='actor-1'", actor_issue["summary"])

    def test_any_cohort_field_mismatch_blocks_the_gate(self) -> None:
        module = load_module()
        source = manifest()
        observed = observations(source)
        observed["cells"]["browser-gateway"]["window"] = {"width": 1000, "height": 800}
        with tempfile.TemporaryDirectory() as tmp:
            manifest_path, observations_path = self.write_sources(tmp, source, observed)
            report = module.build_report(manifest_path, observations_path)

        self.assertFalse(report["sampleEmissionAllowed"])
        self.assertTrue(
            any(
                item["failedStep"] == "cohort.browser-gateway.window"
                for item in report["issue_breakdown"]
            )
        )

    def test_missing_observations_file_is_fail_closed(self) -> None:
        module = load_module()
        source = manifest()
        with tempfile.TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "manifest.json"
            manifest_path.write_text(json.dumps(source), encoding="utf-8")
            report = module.build_report(manifest_path, Path(tmp) / "missing.json")

        self.assertFalse(report["sampleEmissionAllowed"])
        self.assertEqual(report["failedStep"], "observations.load")
        self.assertEqual(report["summary"]["observedCellCount"], 0)


if __name__ == "__main__":
    unittest.main()
