#!/usr/bin/env python3
"""Regression tests for the Acceptance Gap Detector."""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path
from typing import Any


SCRIPT = Path(__file__).with_name("acceptance-gap-detect.py")
SPEC = importlib.util.spec_from_file_location("acceptance_gap_detect", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"failed to load {SCRIPT}")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def proven_result(gate_id: str) -> dict[str, Any]:
    return {
        "id": gate_id,
        "status": "passed",
        "completionStatus": "DONE",
        "proofStatus": "PROVEN",
    }


class AcceptanceGapDetectorTests(unittest.TestCase):
    def test_proven_local_gate_has_no_gap(self) -> None:
        report = MODULE.detect(
            claim="Acceptance planner remains valid",
            paths=["tooling/scripts/acceptance-plan.py"],
            plan={
                "selected_gates": [
                    {
                        "id": "acceptance-plan-self",
                        "environment": "local",
                        "tier": "ci-structure",
                    }
                ]
            },
            run={"results": [proven_result("acceptance-plan-self")]},
            required_gates=[],
        )
        self.assertEqual(report["proofState"], "PROVEN")
        self.assertEqual(report["gaps"], [])

    def test_passed_ci_gate_is_valid_structural_evidence(self) -> None:
        report = MODULE.detect(
            claim="Acceptance planner structure remains valid",
            paths=[],
            plan={
                "selected_gates": [
                    {
                        "id": "acceptance-plan-self",
                        "environment": "local",
                        "tier": "ci-structure",
                    }
                ]
            },
            run={
                "results": [
                    {
                        "id": "acceptance-plan-self",
                        "status": "passed",
                    }
                ]
            },
            required_gates=[],
        )
        self.assertEqual(report["proofState"], "PROVEN")

    def test_unrun_selected_gate_fails_closed(self) -> None:
        report = MODULE.detect(
            claim="Native receipt delivery is proven",
            paths=[],
            plan={
                "selected_gates": [
                    {
                        "id": "chat-native-two-client-e2e",
                        "environment": "home-station",
                        "tier": "env-evidence",
                    }
                ]
            },
            run={"results": []},
            required_gates=[],
        )
        self.assertEqual(report["proofState"], "UNPROVEN")
        self.assertEqual(report["gaps"][0]["gapType"], "REQUIRED_GATE_NOT_RUN")

    def test_blocked_gate_remains_unproven(self) -> None:
        report = MODULE.detect(
            claim="Native receipt delivery is proven",
            paths=[],
            plan={"selected_gates": ["chat-native-two-client-e2e"]},
            run={
                "results": [
                    {
                        "id": "chat-native-two-client-e2e",
                        "status": "blocked",
                        "blockedReason": "Station deployment workspace is dirty",
                        "blockedResource": "station-attestation",
                    }
                ]
            },
            required_gates=[],
        )
        self.assertEqual(
            report["gaps"][0]["gapType"],
            "GATE_BLOCKED_BY_ENVIRONMENT",
        )

    def test_receipt_owner_requires_native_two_client_selection(self) -> None:
        report = MODULE.detect(
            claim="Direct receipt behavior is covered",
            paths=["apps/desktop/src-tauri/src/messaging/direct.rs"],
            plan={"selected_gates": ["chat-desktop-gateway-e2e"]},
            run={"results": [proven_result("chat-desktop-gateway-e2e")]},
            required_gates=[],
        )
        gap_types = {item["gapType"] for item in report["gaps"]}
        self.assertIn("RECEIVER_PROOF_GATE_NOT_SELECTED", gap_types)
        self.assertIn("REQUIRED_GATE_NOT_RUN", gap_types)

    def test_provisioned_gate_requires_ready_manifest(self) -> None:
        gate_id = "chat-native-two-client-e2e"
        report = MODULE.detect(
            claim="Native receipt delivery is proven",
            paths=[],
            plan={
                "selected_gates": [
                    {
                        "id": gate_id,
                        "environment": "home-station",
                        "tier": "env-evidence",
                        "provisioner": "home-station",
                    }
                ]
            },
            run={"results": [proven_result(gate_id)]},
            required_gates=[],
        )
        self.assertEqual(
            report["gaps"][0]["gapType"],
            "RUNTIME_MANIFEST_MISSING",
        )

    def test_stale_runtime_manifest_is_rejected(self) -> None:
        gate_id = "chat-native-two-client-e2e"
        result = proven_result(gate_id)
        result["manifest"] = {
            "state": "FIXTURE_READY",
            "runId": "run-old",
            "source": {
                "commit": "old-commit",
                "workspaceDigest": "clean",
            },
        }
        report = MODULE.detect(
            claim="Native receipt delivery is proven",
            paths=[],
            plan={
                "selected_gates": [
                    {
                        "id": gate_id,
                        "environment": "home-station",
                        "tier": "env-evidence",
                        "provisioner": "home-station",
                    }
                ]
            },
            run={"results": [result]},
            required_gates=[],
            source_commit="new-commit",
            workspace_digest="clean",
        )
        self.assertEqual(
            report["gaps"][0]["gapType"],
            "ACCEPTANCE_EVIDENCE_STALE",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
