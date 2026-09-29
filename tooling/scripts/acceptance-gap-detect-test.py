#!/usr/bin/env python3
"""Regression tests for the Acceptance Gap Detector."""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch


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
        "sourceArtifact": {"path": f"reports/{gate_id}.json"},
        "sourceArtifactKind": "acceptance-gate-evidence-report",
        "evidenceGateId": gate_id,
    }


class AcceptanceGapDetectorTests(unittest.TestCase):
    def test_main_rejects_before_loading_evidence_without_a_session(self) -> None:
        with patch.object(
            sys,
            "argv",
            ["acceptance-gap-detect.py"],
        ), patch.object(
            MODULE,
            "require_acceptance_admission",
            side_effect=MODULE.AcceptanceAdmissionError(
                "ACCEPTANCE_SESSION_REQUIRED"
            ),
        ) as admission, patch.object(
            sys,
            "stderr",
        ):
            exit_code = MODULE.main()

        self.assertEqual(exit_code, 2)
        admission.assert_called_once_with(
            MODULE.REPO_ROOT,
            None,
            "gap",
        )

    def test_main_uses_session_for_admission_not_run_evidence(self) -> None:
        with patch.object(
            sys,
            "argv",
            [
                "acceptance-gap-detect.py",
                "--session",
                "/tmp/session.json",
                "--run",
                "/tmp/run.json",
            ],
        ), patch.object(
            MODULE,
            "require_acceptance_admission",
            side_effect=MODULE.AcceptanceAdmissionError("stop after admission"),
        ) as admission, patch.object(
            sys,
            "stderr",
        ):
            exit_code = MODULE.main()

        self.assertEqual(exit_code, 2)
        admission.assert_called_once_with(
            MODULE.REPO_ROOT,
            "/tmp/session.json",
            "gap",
        )

    def test_explicit_changed_paths_define_exact_scope(self) -> None:
        with patch.object(
            MODULE,
            "changed_paths",
            return_value=[
                "tooling/acceptance/core/launch_context.py",
                "tooling/scripts/acceptance-run.py",
            ],
        ):
            paths = MODULE.resolve_changed_paths(
                "HEAD",
                [
                    "tooling/acceptance/core/launch_context.py",
                    "tooling/acceptance/core/launch_context.py",
                    " tooling/scripts/acceptance-run.py ",
                    "",
                ],
            )

        self.assertEqual(
            paths,
            [
                "tooling/acceptance/core/launch_context.py",
                "tooling/scripts/acceptance-run.py",
            ],
        )

    def test_explicit_changed_paths_reject_empty_scope(self) -> None:
        with self.assertRaisesRegex(
            MODULE.DetectorError,
            "at least one non-empty",
        ):
            MODULE.resolve_changed_paths("HEAD", ["", "  "])

    def test_explicit_changed_paths_reject_noncanonical_paths(self) -> None:
        invalid_paths = (
            "/tmp/outside.py",
            "../outside.py",
            "tooling/../outside.py",
            "./tooling/scripts/acceptance-run.py",
            "tooling//scripts/acceptance-run.py",
            r"tooling\scripts\acceptance-run.py",
        )

        for path in invalid_paths:
            with self.subTest(path=path):
                with self.assertRaisesRegex(
                    MODULE.DetectorError,
                    "canonical repository-relative path",
                ):
                    MODULE.resolve_changed_paths("HEAD", [path])

    def test_explicit_changed_paths_reject_incomplete_or_extra_scope(self) -> None:
        actual = [
            "tooling/acceptance/core/launch_context.py",
            "tooling/scripts/acceptance-run.py",
        ]
        cases = (
            (
                ["tooling/acceptance/core/launch_context.py"],
                "missing=\\['tooling/scripts/acceptance-run.py'\\], extra=\\[\\]",
            ),
            (
                [*actual, "tooling/scripts/not-in-range.py"],
                "missing=\\[\\], extra=\\['tooling/scripts/not-in-range.py'\\]",
            ),
        )

        for supplied, expected_error in cases:
            with self.subTest(supplied=supplied):
                with patch.object(MODULE, "changed_paths", return_value=actual):
                    with self.assertRaisesRegex(
                        MODULE.DetectorError,
                        expected_error,
                    ):
                        MODULE.resolve_changed_paths("HEAD", supplied)

    def test_stale_plan_paths_fail_closed(self) -> None:
        report = MODULE.detect(
            claim="Runtime provisioning is ready to merge",
            paths=[
                "tooling/acceptance/core/provisioner.py",
                "tooling/acceptance/core/lease.py",
            ],
            plan={
                "changed_paths": [],
                "selected_gates": [],
            },
            run={"results": []},
            required_gates=[],
        )
        self.assertEqual(report["proofState"], "UNPROVEN")
        self.assertEqual(
            report["gaps"][0]["gapType"],
            "ACCEPTANCE_GAP_DETECTOR_INPUT_INVALID",
        )
        evidence = report["gaps"][0]["evidence"][0]
        self.assertEqual(
            evidence["missingFromPlan"],
            [
                "tooling/acceptance/core/lease.py",
                "tooling/acceptance/core/provisioner.py",
            ],
        )

    def test_supplied_plan_cannot_filter_canonical_exact_range_gates(
        self,
    ) -> None:
        report = MODULE.detect(
            claim="Acceptance plan is complete",
            paths=["tooling/acceptance/core/provisioner.py"],
            plan={
                "changed_paths": [
                    "tooling/acceptance/core/provisioner.py",
                ],
                "selected_gates": ["acceptance-plan-self"],
            },
            canonical_plan={
                "changed_paths": [
                    "tooling/acceptance/core/provisioner.py",
                ],
                "selected_gates": [
                    "acceptance-plan-self",
                    "acceptance-runtime-provisioning-self",
                ],
            },
            run={
                "results": [
                    proven_result("acceptance-plan-self"),
                ],
            },
            required_gates=[],
        )

        self.assertEqual(report["proofState"], "UNPROVEN")
        invalid = next(
            item
            for item in report["gaps"]
            if item["gapType"] == "ACCEPTANCE_GAP_DETECTOR_INPUT_INVALID"
        )
        self.assertEqual(
            invalid["evidence"][0]["missingCanonicalGates"],
            ["acceptance-runtime-provisioning-self"],
        )

    def test_supplied_plan_may_add_gates_to_canonical_exact_range(
        self,
    ) -> None:
        report = MODULE.detect(
            claim="Acceptance plan is complete",
            paths=["tooling/acceptance/core/provisioner.py"],
            plan={
                "changed_paths": [
                    "tooling/acceptance/core/provisioner.py",
                ],
                "selected_gates": [
                    "acceptance-plan-self",
                    "acceptance-runtime-provisioning-self",
                    "manual-review-gate",
                ],
            },
            canonical_plan={
                "changed_paths": [
                    "tooling/acceptance/core/provisioner.py",
                ],
                "selected_gates": [
                    "acceptance-plan-self",
                    "acceptance-runtime-provisioning-self",
                ],
            },
            run={
                "results": [
                    proven_result("acceptance-plan-self"),
                    proven_result("acceptance-runtime-provisioning-self"),
                    proven_result("manual-review-gate"),
                ],
            },
            required_gates=[],
        )

        self.assertEqual(report["proofState"], "PROVEN")
        self.assertEqual(report["gaps"], [])

    def test_completion_projection_may_defer_declared_candidate_gates(
        self,
    ) -> None:
        report = MODULE.detect(
            claim="Plan is ready for PR review",
            paths=["src/example.py"],
            plan={
                "changed_paths": ["src/example.py"],
                "candidate_gates": ["cheap-gate", "runtime-gate"],
                "execution": {"mode": "completion"},
                "selected_gates": [
                    {
                        "id": "cheap-gate",
                        "environment": "local",
                        "tier": "ci-cheap",
                    }
                ],
            },
            canonical_plan={
                "changed_paths": ["src/example.py"],
                "selected_gates": ["cheap-gate", "runtime-gate"],
            },
            run={"results": [proven_result("cheap-gate")]},
            required_gates=[],
        )

        self.assertEqual(report["proofState"], "PROVEN")
        self.assertEqual(report["gaps"], [])

    def test_canonical_exact_range_plan_uses_acceptance_planner(self) -> None:
        canonical = MODULE.canonical_plan_for_paths(
            ["tooling/acceptance/core/provisioner.py"]
        )

        selected = set(MODULE.gate_entries(canonical))
        self.assertIn("acceptance-plan-self", selected)
        self.assertIn("acceptance-runtime-provisioning-self", selected)

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

    def test_formal_closure_may_defer_receiver_candidate_gate(self) -> None:
        changed_path = "apps/desktop/src/store/socialChat.ts"
        closure_gate = "chat-storage-redaction-recovery-e2e"
        report = MODULE.detect(
            claim="Redaction Recovery behavior is covered",
            paths=[changed_path],
            plan={
                "changed_paths": [changed_path],
                "candidate_gates": [
                    "chat-native-two-client-e2e",
                    closure_gate,
                ],
                "execution": {"mode": "completion"},
                "selected_gates": [closure_gate],
            },
            canonical_plan={
                "changed_paths": [changed_path],
                "selected_gates": [
                    "chat-native-two-client-e2e",
                    closure_gate,
                ],
            },
            run={"results": [proven_result(closure_gate)]},
            required_gates=[],
        )

        self.assertEqual(report["proofState"], "PROVEN")
        self.assertEqual(report["gaps"], [])

    def test_rich_voice_gate_satisfies_receiver_proof_requirement(self) -> None:
        gate_id = "chat-lifecycle-rich-voice-e2e"
        report = MODULE.detect(
            claim="Recorded voice receiver behavior is covered",
            paths=["apps/desktop/src/store/socialProjection.ts"],
            plan={"selected_gates": [gate_id]},
            run={"results": [proven_result(gate_id)]},
            required_gates=[],
        )

        self.assertEqual(report["proofState"], "PROVEN")
        self.assertEqual(report["gaps"], [])

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

    def test_environment_gate_rejects_noncanonical_evidence_kind(self) -> None:
        gate_id = "chat-native-two-client-e2e"
        result = proven_result(gate_id)
        result["sourceArtifactKind"] = "forged-kind"
        result["manifest"] = {
            "state": "FIXTURE_READY",
            "runId": "run-current",
            "source": {
                "commit": "current-head",
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
            source_commit="current-head",
            workspace_digest="clean",
        )

        self.assertEqual(report["proofState"], "UNPROVEN")
        self.assertEqual(
            report["gaps"][0]["gapType"],
            "GATE_EVIDENCE_UNPROVEN",
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


class ContractDeliverableTests(unittest.TestCase):
    def _contract(self, deliverables: list[dict[str, Any]]) -> dict[str, Any]:
        return {"deliverables": deliverables}

    def test_scan_deliverable_gate_not_run(self) -> None:
        contract = self._contract([{
            "id": "deleted-files-absent",
            "verify": {"type": "path-absent", "paths": ["foo.rs"]},
        }])
        report = MODULE.detect(
            claim="contract closure",
            paths=[],
            plan={"selected_gates": []},
            run={"results": []},
            required_gates=[],
            contract=contract,
        )
        self.assertEqual(report["proofState"], "UNPROVEN")
        gap_types = {g["gapType"] for g in report["gaps"]}
        self.assertIn("CONTRACT_SCAN_GATE_NOT_RUN", gap_types)

    def test_scan_deliverable_gate_failed(self) -> None:
        contract = self._contract([{
            "id": "no-dup",
            "verify": {"type": "no-duplicate-symbol"},
        }])
        report = MODULE.detect(
            claim="contract closure",
            paths=[],
            plan={"selected_gates": []},
            run={"results": [{
                "id": "chat-w11-duplicate-scan",
                "status": "failed",
            }]},
            required_gates=[],
            contract=contract,
        )
        gap_types = {g["gapType"] for g in report["gaps"]}
        self.assertIn("CONTRACT_SCAN_GATE_FAILED", gap_types)

    def test_scan_deliverable_gate_passed_proven(self) -> None:
        contract = self._contract([{
            "id": "deleted-files-absent",
            "verify": {"type": "path-absent", "paths": ["foo.rs"]},
        }])
        report = MODULE.detect(
            claim="contract closure",
            paths=[],
            plan={"selected_gates": []},
            run={"results": [proven_result("chat-w11-forbidden-scan")]},
            required_gates=[],
            contract=contract,
        )
        contract_gaps = [
            g for g in report["gaps"]
            if g["gapType"].startswith("CONTRACT_")
        ]
        self.assertEqual(contract_gaps, [])

    def test_gates_passed_deliverable_not_run(self) -> None:
        contract = self._contract([{
            "id": "native-evidence",
            "verify": {
                "type": "gates-passed",
                "gates": ["chat-native-two-client-e2e"],
            },
        }])
        report = MODULE.detect(
            claim="contract closure",
            paths=[],
            plan={"selected_gates": []},
            run={"results": []},
            required_gates=[],
            contract=contract,
        )
        gap_types = {g["gapType"] for g in report["gaps"]}
        self.assertIn("CONTRACT_GATE_NOT_RUN", gap_types)

    def test_gate_passed_deliverable_failed(self) -> None:
        contract = self._contract([{
            "id": "completion-audit",
            "verify": {
                "type": "gate-passed",
                "gate": "chat-w11-completion-audit",
            },
        }])
        report = MODULE.detect(
            claim="contract closure",
            paths=[],
            plan={"selected_gates": []},
            run={"results": [{
                "id": "chat-w11-completion-audit",
                "status": "failed",
            }]},
            required_gates=[],
            contract=contract,
        )
        gap_types = {g["gapType"] for g in report["gaps"]}
        self.assertIn("CONTRACT_GATE_FAILED", gap_types)

    def test_gate_passed_deliverable_passed(self) -> None:
        contract = self._contract([{
            "id": "completion-audit",
            "verify": {
                "type": "gate-passed",
                "gate": "chat-w11-completion-audit",
            },
        }])
        report = MODULE.detect(
            claim="contract closure",
            paths=[],
            plan={"selected_gates": []},
            run={"results": [proven_result("chat-w11-completion-audit")]},
            required_gates=[],
            contract=contract,
        )
        contract_gaps = [
            g for g in report["gaps"]
            if g["gapType"].startswith("CONTRACT_")
        ]
        self.assertEqual(contract_gaps, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
