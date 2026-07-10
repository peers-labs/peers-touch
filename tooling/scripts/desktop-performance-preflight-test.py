#!/usr/bin/env python3
"""Regression tests for Desktop performance preflight evidence."""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from typing import Any
from unittest import mock


def load_module() -> Any:
    script = Path(__file__).with_name("desktop-performance-preflight.py")
    spec = importlib.util.spec_from_file_location("desktop_performance_preflight", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {script}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def passing_entrypoint(command: str) -> dict[str, Any]:
    return {"name": "entrypoint", "command": command, "status": "pass"}


class DesktopPerformancePreflightTest(unittest.TestCase):
    def test_report_passes_only_when_all_preflight_checks_pass(self) -> None:
        module = load_module()
        with mock.patch.object(module, "run_make_dry_run", side_effect=passing_entrypoint), mock.patch.object(
            module,
            "check_station",
            return_value={"name": "station-health", "status": "pass", "url": "http://station/sub-oss/healthz"},
        ), mock.patch.object(
            module,
            "check_gateway",
            return_value={
                "name": "desktop-gateway",
                "status": "pass",
                "url": "http://gateway",
                "activeStation": "http://station",
            },
        ):
            report = module.build_report("http://gateway", "http://station", 0.1)

        self.assertEqual(report["artifactKind"], "desktop-performance-preflight")
        self.assertEqual(report["status"], "pass")
        self.assertEqual(report["completionStatus"], "DONE")
        self.assertEqual(report["proofStatus"], "PROVEN")
        self.assertTrue(report["sampleEmissionAllowed"])
        self.assertTrue(report["summary"]["sampleEmissionAllowed"])
        self.assertEqual(report["phase"], "P0c-1/P0c-2")
        self.assertEqual(report["bom"], ["BOM-RUN-01", "BOM-CAP-04", "BOM-GATE-01"])
        self.assertEqual(report["spec"], ["SPEC-RUN-01", "SPEC-GATE-01"])
        self.assertEqual(report["details"], [])
        self.assertEqual(report["issue_breakdown"], [])
        self.assertEqual(report["issueBreakdown"], [])

    def test_gateway_failure_is_partial_unproven_and_self_diagnosing(self) -> None:
        module = load_module()
        with mock.patch.object(module, "run_make_dry_run", side_effect=passing_entrypoint), mock.patch.object(
            module,
            "check_station",
            return_value={"name": "station-health", "status": "pass", "url": "http://station/sub-oss/healthz"},
        ), mock.patch.object(
            module,
            "check_gateway",
            return_value={
                "name": "desktop-gateway",
                "status": "fail",
                "url": "http://gateway",
                "reason": "connection refused",
            },
        ):
            report = module.build_report("http://gateway", "http://station", 0.1, "tmp/preflight.json")

        self.assertEqual(report["status"], "baseline preflight failure")
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertFalse(report["sampleEmissionAllowed"])
        self.assertFalse(report["summary"]["sampleEmissionAllowed"])
        self.assertEqual(report["failedStep"], "desktop-gateway")
        self.assertEqual(
            report["details"][0],
            {
                "step": "desktop-gateway",
                "status": "fail",
                "reason": "connection refused",
                "url": "http://gateway",
            },
        )
        self.assertEqual(report["issue_breakdown"][0]["category"], "desktop-gateway-preflight")
        self.assertEqual(report["issue_breakdown"][0]["failedStep"], "desktop-gateway")
        self.assertEqual(report["issue_breakdown"][0]["status"], "diagnostic incomplete")
        self.assertEqual(report["issue_breakdown"][0]["completionStatus"], "PARTIAL")
        self.assertEqual(report["issue_breakdown"][0]["proofStatus"], "UNPROVEN")
        self.assertFalse(report["issue_breakdown"][0]["sampleEmissionAllowed"])
        self.assertEqual(report["issue_breakdown"][0]["sourceArtifact"], "tmp/preflight.json")
        self.assertEqual(report["issue_breakdown"][0]["sourceArtifactKind"], "desktop-performance-preflight")
        self.assertEqual(report["issue_breakdown"][0]["sourcePhase"], "P0c-1/P0c-2")
        self.assertIn("PARTIAL/UNPROVEN", report["issue_breakdown"][0]["proofImpact"])
        self.assertEqual(report["issueBreakdown"], report["issue_breakdown"])
        self.assertTrue(any(command["command"] == "make desktop" for command in report["recommendedReviewCommands"]))
        self.assertTrue(
            any("desktop-telemetry-live-gate.py" in command["command"] for command in report["recommended_review_commands"])
        )

    def test_entrypoint_failure_blocks_sample_emission(self) -> None:
        module = load_module()

        def entrypoint(command: str) -> dict[str, Any]:
            if command == "make desktop":
                return {"name": "entrypoint", "command": command, "status": "fail", "reason": "missing target"}
            return passing_entrypoint(command)

        with mock.patch.object(module, "run_make_dry_run", side_effect=entrypoint), mock.patch.object(
            module,
            "check_station",
            return_value={"name": "station-health", "status": "pass", "url": "http://station/sub-oss/healthz"},
        ), mock.patch.object(
            module,
            "check_gateway",
            return_value={"name": "desktop-gateway", "status": "pass", "url": "http://gateway"},
        ):
            report = module.build_report("http://gateway", "http://station", 0.1)

        self.assertEqual(report["status"], "baseline preflight failure")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertEqual(
            report["details"][0],
            {
                "step": "make desktop",
                "status": "fail",
                "reason": "missing target",
            },
        )
        self.assertEqual(report["issue_breakdown"][0]["category"], "entrypoint-contract")
        self.assertEqual(report["issue_breakdown"][0]["failedStep"], "make desktop")
        self.assertEqual(report["issue_breakdown"][0]["proofStatus"], "UNPROVEN")
        self.assertEqual(report["reason"], "missing target")


if __name__ == "__main__":
    unittest.main()
