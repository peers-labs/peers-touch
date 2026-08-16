#!/usr/bin/env python3
"""Regression tests for acceptance-run evidence summaries."""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest import mock


def load_module() -> Any:
    script = Path(__file__).with_name("acceptance-run.py")
    spec = importlib.util.spec_from_file_location("acceptance_run", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {script}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class AcceptanceRunTest(unittest.TestCase):
    def test_selected_gates_from_plan_expands_gate_ids_from_definitions(self) -> None:
        module = load_module()

        gates = module.selected_gates_from_plan(
            {
                "selected_gates": [
                    "desktop-performance-preflight-gate",
                    {
                        "id": "desktop-performance-report-gate",
                        "timeout_seconds": 42,
                    },
                ]
            },
            {
                "desktop-performance-preflight-gate": {
                    "command": "python3 tooling/scripts/desktop-performance-preflight.py",
                    "timeout_seconds": 600,
                    "tier": "env-evidence",
                },
                "desktop-performance-report-gate": {
                    "command": "python3 tooling/scripts/desktop-performance-report.py",
                    "timeout_seconds": 600,
                    "tier": "local-evidence",
                },
            },
        )

        self.assertEqual([gate["id"] for gate in gates], ["desktop-performance-preflight-gate", "desktop-performance-report-gate"])
        self.assertEqual(gates[0]["command"], "python3 tooling/scripts/desktop-performance-preflight.py")
        self.assertEqual(gates[1]["command"], "python3 tooling/scripts/desktop-performance-report.py")
        self.assertEqual(gates[1]["timeout_seconds"], 42)

    def test_enrich_result_with_evidence_from_log_artifact(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            artifact_path = Path(tmp) / "tooling/acceptance/reports/desktop-performance-report-latest.json"
            artifact_path.parent.mkdir(parents=True)
            artifact_path.write_text(
                json.dumps(
                    {
                        "artifactKind": "desktop-performance-report",
                        "status": "diagnostic incomplete",
                        "completionStatus": "PARTIAL",
                        "proofStatus": "UNPROVEN",
                        "phase": "P0c",
                        "bom": ["BOM-GATE-02"],
                        "spec": ["SPEC-GATE-02"],
                        "gate": "Final report must fail closed until runtime evidence is proven",
                        "reason": "runtime evidence missing",
                        "details": [
                            {
                                "step": "desktop-gateway",
                                "status": "fail",
                                "reason": "connection refused",
                                "url": "http://127.0.0.1:3030",
                            }
                        ],
                        "issue_breakdown": [
                            {
                                "category": "matrix",
                                "failedStep": "matrix",
                                "summary": "matrix evidence missing",
                                "proofImpact": "P0c remains PARTIAL/UNPROVEN.",
                            }
                        ],
                        "recommended_review_commands": [
                            {
                                "purpose": "Re-run final report.",
                                "command": "python3 tooling/scripts/desktop-performance-report.py",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            old_cwd = Path.cwd()
            try:
                import os

                os.chdir(tmp)
                result = module.enrich_result_with_evidence(
                    {
                        "id": "desktop-performance-report-gate",
                        "command": "python3 tooling/scripts/desktop-performance-report.py",
                        "status": "failed",
                    },
                    f"desktop performance report: {artifact_path.relative_to(tmp)}\n",
                )
            finally:
                os.chdir(old_cwd)

        self.assertEqual(result["sourceArtifactKind"], "desktop-performance-report")
        self.assertEqual(
            result["sourceArtifact"],
            "tooling/acceptance/reports/desktop-performance-report-latest.json",
        )
        self.assertEqual(result["completionStatus"], "PARTIAL")
        self.assertEqual(result["proofStatus"], "UNPROVEN")
        self.assertEqual(result["phase"], "P0c")
        self.assertEqual(result["sourcePhase"], "P0c")
        self.assertEqual(result["bom"], ["BOM-GATE-02"])
        self.assertEqual(result["sourceBom"], ["BOM-GATE-02"])
        self.assertEqual(result["spec"], ["SPEC-GATE-02"])
        self.assertEqual(result["sourceSpec"], ["SPEC-GATE-02"])
        self.assertEqual(result["sourceGate"], "Final report must fail closed until runtime evidence is proven")
        self.assertEqual(result["details"][0]["step"], "desktop-gateway")
        self.assertEqual(result["evidenceDetails"][0]["reason"], "connection refused")
        self.assertEqual(result["evidenceArtifacts"][0]["details"][0]["url"], "http://127.0.0.1:3030")
        self.assertEqual(result["issue_breakdown"][0]["category"], "matrix")
        self.assertEqual(
            result["recommended_review_commands"][0]["command"],
            "python3 tooling/scripts/desktop-performance-report.py",
        )

    def test_build_run_report_marks_failed_run_unproven(self) -> None:
        module = load_module()
        report = module.build_run_report(
            "tooling/acceptance/reports/latest-plan.json",
            [
                {
                    "id": "static-gate",
                    "status": "passed",
                },
                {
                    "id": "desktop-performance-report-gate",
                    "status": "failed",
                    "reason": "runtime evidence missing",
                    "sourceArtifact": "tooling/acceptance/reports/desktop-performance-report-latest.json",
                    "sourceArtifactKind": "desktop-performance-report",
                    "sourcePhase": "P0c",
                    "sourceBom": ["BOM-GATE-02"],
                    "sourceSpec": ["SPEC-GATE-02"],
                    "sourceGate": "Final report must fail closed until runtime evidence is proven",
                    "details": [
                        {
                            "step": "desktop-gateway",
                            "status": "fail",
                            "reason": "connection refused",
                        }
                    ],
                    "issue_breakdown": [
                        {
                            "category": "matrix",
                            "failedStep": "matrix",
                            "summary": "matrix evidence missing",
                            "proofImpact": "P0c remains PARTIAL/UNPROVEN.",
                        }
                    ],
                    "recommended_review_commands": [
                        {
                            "purpose": "Re-run final report.",
                            "command": "python3 tooling/scripts/desktop-performance-report.py",
                        }
                    ],
                },
            ],
        )

        self.assertEqual(report["artifactKind"], "acceptance-run")
        self.assertEqual(report["sourceArtifact"], "tooling/acceptance/reports/latest-plan.json")
        self.assertEqual(report["summary"]["total"], 2)
        self.assertEqual(report["summary"]["passed"], 1)
        self.assertEqual(report["summary"]["failed"], 1)
        self.assertEqual(report["summary"]["missingResultTraceability"], 0)
        self.assertFalse(report["summary"]["sampleEmissionAllowed"])
        self.assertFalse(report["sampleEmissionAllowed"])
        self.assertEqual(report["resultTraceabilityState"]["status"], "pass")
        self.assertEqual(report["resultTraceabilityState"]["completionStatus"], "DONE")
        self.assertEqual(report["resultTraceabilityState"]["proofStatus"], "PROVEN")
        self.assertFalse(report["resultTraceabilityState"]["sampleEmissionAllowed"])
        self.assertEqual(report["resultTraceabilityState"]["missingTraceabilityCount"], 0)
        self.assertEqual(report["results"][0]["artifactKind"], "acceptance-gate-result")
        self.assertEqual(report["results"][0]["artifactPath"], "tooling/acceptance/reports/latest-plan.json#results/static-gate")
        self.assertEqual(report["results"][0]["traceability"]["status"], "not-required")
        self.assertEqual(report["results"][1]["artifactKind"], "acceptance-gate-result")
        self.assertEqual(
            report["results"][1]["artifactPath"],
            "tooling/acceptance/reports/desktop-performance-report-latest.json",
        )
        self.assertEqual(report["results"][1]["traceability"]["status"], "complete")
        self.assertEqual(report["results"][1]["traceability"]["sourcePhase"], "P0c")
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertEqual(report["sourcePhases"], ["P0c"])
        self.assertEqual(report["sourceBom"], ["BOM-GATE-02"])
        self.assertEqual(report["sourceSpec"], ["SPEC-GATE-02"])
        self.assertEqual(report["sourceGates"], ["Final report must fail closed until runtime evidence is proven"])
        self.assertEqual(report["issue_breakdown"][0]["category"], "matrix")
        self.assertEqual(report["issue_breakdown"][0]["acceptanceGateId"], "desktop-performance-report-gate")
        self.assertEqual(
            report["issue_breakdown"][0]["sourceArtifact"],
            "tooling/acceptance/reports/desktop-performance-report-latest.json",
        )
        self.assertEqual(report["issue_breakdown"][0]["sourceArtifactKind"], "desktop-performance-report")
        self.assertEqual(report["issue_breakdown"][0]["sourcePhase"], "P0c")
        self.assertEqual(report["issue_breakdown"][0]["sourceBom"], ["BOM-GATE-02"])
        self.assertEqual(report["issue_breakdown"][0]["sourceSpec"], ["SPEC-GATE-02"])
        self.assertEqual(
            report["issue_breakdown"][0]["sourceGate"],
            "Final report must fail closed until runtime evidence is proven",
        )
        self.assertEqual(report["issue_breakdown"][0]["details"][0]["step"], "desktop-gateway")
        self.assertEqual(report["issue_breakdown"][0]["evidenceDetails"][0]["reason"], "connection refused")
        self.assertEqual(
            report["recommended_review_commands"][0]["command"],
            "python3 tooling/scripts/desktop-performance-report.py",
        )

    def test_enrich_result_derives_reason_from_source_issue_when_artifact_reason_missing(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            artifact_path = Path(tmp) / "tooling/acceptance/reports/desktop-anchor-inventory.json"
            artifact_path.parent.mkdir(parents=True)
            artifact_path.write_text(
                json.dumps(
                    {
                        "artifactKind": "desktop-anchor-inventory",
                        "status": "diagnostic incomplete",
                        "completionStatus": "PARTIAL",
                        "proofStatus": "UNPROVEN",
                        "phase": "P0b-1",
                        "bom": ["BOM-SMP-01"],
                        "spec": ["SPEC-ANCHOR-01"],
                        "gate": "Anchor inventory must preserve DOM evidence diagnostics",
                        "issue_breakdown": [
                            {
                                "category": "dom-automation-evidence",
                                "failedStep": "desktop-anchor-inventory",
                                "summary": "DOM evidence loaded but remains UNPROVEN",
                                "proofImpact": "P0b-1 remains PARTIAL/UNPROVEN.",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            old_cwd = Path.cwd()
            try:
                import os

                os.chdir(tmp)
                result = module.enrich_result_with_evidence(
                    {
                        "id": "desktop-anchor-inventory-gate",
                        "command": "python3 tooling/scripts/desktop-anchor-inventory.py",
                        "status": "failed",
                    },
                    f"anchor inventory: {artifact_path.relative_to(tmp)}\n",
                )
            finally:
                os.chdir(old_cwd)

        self.assertEqual(result["sourceArtifactKind"], "desktop-anchor-inventory")
        self.assertEqual(result["reason"], "DOM evidence loaded but remains UNPROVEN")
        self.assertEqual(result["issue_breakdown"][0]["category"], "dom-automation-evidence")

    def test_build_run_report_counts_passed_but_unproven_evidence(self) -> None:
        module = load_module()
        report = module.build_run_report(
            "tooling/acceptance/reports/latest-plan.json",
            [
                {
                    "id": "static-gate",
                    "status": "passed",
                    "completionStatus": "DONE",
                    "proofStatus": "PROVEN",
                },
                {
                    "id": "desktop-telemetry-mirror-template-gate",
                    "status": "passed",
                    "evidenceStatus": "diagnostic incomplete",
                    "completionStatus": "PARTIAL",
                    "proofStatus": "UNPROVEN",
                    "sourceArtifact": "tooling/acceptance/reports/desktop-performance-latest.json",
                    "sourceArtifactKind": "desktop-performance-station-mirror",
                    "sourcePhase": "P0a-6/P0c-5",
                    "sourceBom": ["BOM-CAP-05", "BOM-RUN-05"],
                    "sourceSpec": ["SPEC-STA-03", "SPEC-MIRROR-01"],
                    "sourceGate": "Station mirror must be queried from the product sink before report proof is allowed",
                    "reason": "Station mirror has not been queried; raw event evidence remains unproven",
                    "issue_breakdown": [
                        {
                            "category": "station-mirror-source",
                            "failedStep": "station-query-template",
                            "summary": "Station mirror has not been queried; raw event evidence remains unproven",
                            "proofImpact": "P0a-6/P0c-5 remains PARTIAL/UNPROVEN until Station raw events and rollups are queried from the product sink.",
                        }
                    ],
                    "recommended_review_commands": [
                        {
                            "purpose": "Run the live Gateway -> Station telemetry gate.",
                            "command": "python3 tooling/scripts/desktop-telemetry-live-gate.py",
                        }
                    ],
                },
            ],
        )

        self.assertEqual(report["summary"]["total"], 2)
        self.assertEqual(report["summary"]["passed"], 2)
        self.assertEqual(report["summary"]["failed"], 0)
        self.assertEqual(report["summary"]["partial"], 1)
        self.assertEqual(report["summary"]["unproven"], 1)
        self.assertEqual(report["summary"]["incomplete"], 1)
        self.assertEqual(report["summary"]["passedButUnproven"], 1)
        self.assertEqual(report["summary"]["missingResultTraceability"], 0)
        self.assertFalse(report["summary"]["sampleEmissionAllowed"])
        self.assertFalse(report["sampleEmissionAllowed"])
        self.assertEqual(report["results"][0]["traceability"]["status"], "not-required")
        self.assertEqual(report["results"][1]["traceability"]["status"], "complete")
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertEqual(report["sourcePhases"], ["P0a-6/P0c-5"])
        self.assertEqual(report["sourceBom"], ["BOM-CAP-05", "BOM-RUN-05"])
        self.assertEqual(report["sourceSpec"], ["SPEC-STA-03", "SPEC-MIRROR-01"])
        self.assertEqual(
            report["sourceGates"],
            ["Station mirror must be queried from the product sink before report proof is allowed"],
        )
        self.assertEqual(report["issue_breakdown"][0]["category"], "station-mirror-source")
        self.assertEqual(report["issue_breakdown"][0]["acceptanceGateId"], "desktop-telemetry-mirror-template-gate")
        self.assertEqual(
            report["issue_breakdown"][0]["sourceArtifact"],
            "tooling/acceptance/reports/desktop-performance-latest.json",
        )
        self.assertEqual(
            report["issue_breakdown"][0]["sourceArtifactKind"],
            "desktop-performance-station-mirror",
        )
        self.assertEqual(report["issue_breakdown"][0]["sourcePhase"], "P0a-6/P0c-5")
        self.assertEqual(report["issue_breakdown"][0]["sourceBom"], ["BOM-CAP-05", "BOM-RUN-05"])
        self.assertEqual(report["issue_breakdown"][0]["sourceSpec"], ["SPEC-STA-03", "SPEC-MIRROR-01"])
        self.assertEqual(report["issueBreakdown"], report["issue_breakdown"])
        self.assertEqual(
            report["recommended_review_commands"][0]["command"],
            "python3 tooling/scripts/desktop-telemetry-live-gate.py",
        )
        self.assertEqual(report["recommendedReviewCommands"], report["recommended_review_commands"])

    def test_build_run_report_marks_unproven_without_partial_incomplete(self) -> None:
        module = load_module()
        report = module.build_run_report(
            "tooling/acceptance/reports/latest-plan.json",
            [
                {
                    "id": "unproven-gate",
                    "status": "passed",
                    "completionStatus": "DONE",
                    "proofStatus": "UNPROVEN",
                    "reason": "evidence proof status is unproven",
                    "details": [
                        {
                            "step": "proof-state",
                            "status": "fail",
                            "reason": "proof status is UNPROVEN",
                        }
                    ],
                },
            ],
        )

        self.assertEqual(report["summary"]["partial"], 0)
        self.assertEqual(report["summary"]["unproven"], 1)
        self.assertEqual(report["summary"]["incomplete"], 1)
        self.assertEqual(report["summary"]["passedButUnproven"], 1)
        self.assertEqual(report["summary"]["missingResultTraceability"], 1)
        self.assertFalse(report["summary"]["sampleEmissionAllowed"])
        self.assertFalse(report["sampleEmissionAllowed"])
        self.assertEqual(report["resultTraceabilityState"]["status"], "diagnostic incomplete")
        self.assertEqual(report["resultTraceabilityState"]["completionStatus"], "PARTIAL")
        self.assertEqual(report["resultTraceabilityState"]["proofStatus"], "UNPROVEN")
        self.assertEqual(report["resultTraceabilityState"]["missingTraceabilityCount"], 1)
        self.assertEqual(report["resultTraceabilityState"]["missingTraceability"][0]["acceptanceGateId"], "unproven-gate")
        self.assertEqual(report["results"][0]["traceability"]["status"], "missing")
        self.assertIn("sourceArtifact", report["results"][0]["traceability"]["missingFields"])
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertEqual(report["issue_breakdown"][0]["category"], "acceptance-gate:unproven-gate")
        self.assertEqual(report["issue_breakdown"][0]["failedStep"], "unproven-gate")
        self.assertEqual(report["issue_breakdown"][0]["acceptanceGateId"], "unproven-gate")
        self.assertEqual(report["issue_breakdown"][0]["details"][0]["step"], "proof-state")
        self.assertEqual(report["issue_breakdown"][0]["evidenceDetails"][0]["status"], "fail")

    def test_build_run_report_never_allows_sample_emission_for_dry_run(self) -> None:
        module = load_module()
        report = module.build_run_report(
            "tooling/acceptance/plans/desktop-performance-phase0.json",
            [
                {
                    "id": "desktop-performance-preflight-gate",
                    "status": "dry-run",
                }
            ],
        )

        self.assertEqual(report["summary"]["dryRun"], 1)
        self.assertFalse(report["summary"]["sampleEmissionAllowed"])
        self.assertFalse(report["sampleEmissionAllowed"])
        self.assertEqual(module.acceptance_exit_code(report), 1)

    def test_render_markdown_exposes_sample_emission(self) -> None:
        module = load_module()
        report = module.build_run_report(
            "tooling/acceptance/reports/latest-plan.json",
            [
                {
                    "id": "desktop-performance-matrix-gate",
                    "status": "failed",
                    "completionStatus": "PARTIAL",
                    "proofStatus": "UNPROVEN",
                    "sourceArtifact": "tooling/acceptance/reports/desktop-performance-matrix-latest.json",
                    "sourceArtifactKind": "desktop-performance-matrix-gate",
                    "sourcePhase": "P0c-5",
                    "sourceBom": ["BOM-GATE-02"],
                    "sourceSpec": ["SPEC-GATE-02"],
                    "sourceGate": "Runtime matrix must fail closed until runtime samples are proven",
                }
            ],
        )

        markdown = module.render_markdown(report)

        self.assertIn("- Sample emission allowed: `False`", markdown)
        self.assertIn("desktop-performance-matrix-gate", markdown)

    def test_acceptance_exit_code_requires_proven_done_sample_allowed(self) -> None:
        module = load_module()
        proven_report = module.build_run_report(
            "tooling/acceptance/reports/latest-plan.json",
            [
                {
                    "id": "proven-gate",
                    "status": "passed",
                    "completionStatus": "DONE",
                    "proofStatus": "PROVEN",
                    "sampleEmissionAllowed": True,
                }
            ],
        )
        unproven_report = module.build_run_report(
            "tooling/acceptance/reports/latest-plan.json",
            [
                {
                    "id": "passed-but-unproven-gate",
                    "status": "passed",
                    "completionStatus": "PARTIAL",
                    "proofStatus": "UNPROVEN",
                    "sampleEmissionAllowed": False,
                    "sourceArtifact": "tooling/acceptance/reports/unproven.json",
                    "sourceArtifactKind": "unproven-evidence",
                    "sourcePhase": "P0x",
                    "sourceBom": ["BOM-X"],
                    "sourceSpec": ["SPEC-X"],
                    "sourceGate": "Unproven evidence must not let acceptance exit successfully",
                }
            ],
        )

        self.assertEqual(module.acceptance_exit_code(proven_report), 0)
        self.assertEqual(module.acceptance_exit_code(unproven_report), 1)

    def test_blocked_result_is_distinct_from_failed_and_exits_two(self) -> None:
        module = load_module()
        report = module.build_run_report(
            "tooling/acceptance/reports/latest-plan.json",
            [
                {
                    "id": "environment-gate",
                    "status": "blocked",
                    "blockedReason": "credential missing",
                    "blockedResource": "credential-ref:env:TEST_PASSWORD",
                }
            ],
        )

        self.assertEqual(report["summary"]["blocked"], 1)
        self.assertEqual(report["summary"]["failed"], 0)
        self.assertEqual(report["completionStatus"], "BLOCKED")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertEqual(module.acceptance_exit_code(report), 2)

    def test_unexpected_provisioning_error_is_structured_failed_result(self) -> None:
        module = load_module()
        result = module.provisioning_failure_result(
            gate_id="environment-gate",
            command="run-gate",
            environment="home-station",
            tier="env-evidence",
            error=RuntimeError("provisioner exploded"),
            duration_seconds=0.1,
        )
        report = module.build_run_report(
            "tooling/acceptance/reports/latest-plan.json",
            [result],
        )
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["proofStatus"], "UNPROVEN")
        self.assertEqual(result["errorType"], "RuntimeError")
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(module.acceptance_exit_code(report), 1)

    def test_missing_environment_contract_produces_blocked_manifest(self) -> None:
        module = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            environments = root / "environments"
            manifests = root / "reports" / "manifests"
            environments.mkdir()
            with mock.patch.object(module, "REPO_ROOT", root), mock.patch(
                "tooling.acceptance.core.ENVIRONMENTS_DIR",
                environments,
            ), mock.patch(
                "tooling.acceptance.core.MANIFESTS_DIR",
                manifests,
            ):
                provisioner, manifest, path = module.provision_environment(
                    "missing-environment",
                    "test-gate",
                )

        self.assertIsNone(provisioner)
        self.assertEqual(manifest["state"], "BLOCKED")
        self.assertEqual(
            manifest["blockedResource"],
            "environment-contract:missing-environment",
        )
        self.assertIsNotNone(path)

    def test_runtime_log_redaction_removes_resolved_secret_values(self) -> None:
        module = load_module()
        secret = "acceptance-secret-value"
        redacted = module.redact_runtime_text(
            f"raw output contained {secret}",
            (secret,),
        )
        self.assertNotIn(secret, redacted)
        self.assertIn("[REDACTED]", redacted)

    def test_short_secret_uses_key_aware_redaction_without_corrupting_numbers(self) -> None:
        module = load_module()
        redacted = module.redact_runtime_text(
            "count=1 password=1",
            ("1",),
        )
        self.assertIn("count=1", redacted)
        self.assertIn("password=[REDACTED]", redacted)

    def test_runtime_artifact_redaction_removes_resolved_secret_values(self) -> None:
        module = load_module()
        secret = "artifact-secret-value"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            artifact = (
                root
                / "tooling"
                / "acceptance"
                / "reports"
                / "gate.json"
            )
            artifact.parent.mkdir(parents=True)
            artifact.write_text(
                json.dumps(
                    {
                        "message": f"leaked {secret}",
                        "password": "1",
                        "count": 1,
                    }
                ),
                encoding="utf-8",
            )
            with mock.patch.object(module, "REPO_ROOT", root):
                redacted_paths = module.redact_runtime_artifacts(
                    "artifact: tooling/acceptance/reports/gate.json",
                    (secret,),
                )
            serialized = artifact.read_text(encoding="utf-8")

        self.assertEqual(
            redacted_paths,
            ["tooling/acceptance/reports/gate.json"],
        )
        self.assertNotIn(secret, serialized)
        self.assertIn("[REDACTED]", serialized)
        self.assertIn('"count": 1', serialized)
        self.assertNotIn('"password": "1"', serialized)

    def test_build_run_report_deduplicates_review_commands_by_command_text(self) -> None:
        module = load_module()
        report = module.build_run_report(
            "tooling/acceptance/reports/latest-plan.json",
            [
                {
                    "id": "gate-a",
                    "status": "failed",
                    "completionStatus": "PARTIAL",
                    "proofStatus": "UNPROVEN",
                    "sourceArtifact": "tooling/acceptance/reports/gate-a.json",
                    "sourceArtifactKind": "gate-a",
                    "sourcePhase": "P0x",
                    "sourceBom": ["BOM-X"],
                    "sourceSpec": ["SPEC-X"],
                    "sourceGate": "Gate A",
                    "recommended_review_commands": [
                        {"purpose": "Start Desktop.", "command": "make desktop"},
                        {"purpose": "Re-run acceptance.", "command": "make acceptance PLAN=tooling/acceptance/plans/desktop-performance-phase0.json"},
                    ],
                },
                {
                    "id": "gate-b",
                    "status": "failed",
                    "completionStatus": "PARTIAL",
                    "proofStatus": "UNPROVEN",
                    "sourceArtifact": "tooling/acceptance/reports/gate-b.json",
                    "sourceArtifactKind": "gate-b",
                    "sourcePhase": "P0x",
                    "sourceBom": ["BOM-X"],
                    "sourceSpec": ["SPEC-X"],
                    "sourceGate": "Gate B",
                    "recommended_review_commands": [
                        {"purpose": "Start Desktop again.", "command": "make desktop"},
                        {
                            "purpose": "Re-run acceptance again.",
                            "command": "make acceptance PLAN=tooling/acceptance/plans/desktop-performance-phase0.json",
                        },
                    ],
                },
            ],
        )

        command_texts = [item["command"] for item in report["recommended_review_commands"]]
        self.assertEqual(command_texts.count("make desktop"), 1)
        self.assertEqual(command_texts.count("make acceptance PLAN=tooling/acceptance/plans/desktop-performance-phase0.json"), 1)

    def test_selected_gates_from_plan_resolves_gate_ids_from_definitions(self) -> None:
        module = load_module()
        gates = module.selected_gates_from_plan(
            {
                "selected_gates": [
                    "static-gate",
                    {
                        "id": "runtime-gate",
                        "timeout_seconds": 30,
                    },
                ],
            },
            {
                "static-gate": {
                    "command": "python3 tooling/scripts/static_gate.py",
                    "tier": "ci-cheap",
                },
                "runtime-gate": {
                    "command": "python3 tooling/scripts/runtime_gate.py",
                    "tier": "env-evidence",
                    "timeout_seconds": 600,
                },
            },
        )

        self.assertEqual([gate["id"] for gate in gates], ["static-gate", "runtime-gate"])
        self.assertEqual(gates[0]["command"], "python3 tooling/scripts/static_gate.py")
        self.assertEqual(gates[0]["tier"], "ci-cheap")
        self.assertEqual(gates[1]["command"], "python3 tooling/scripts/runtime_gate.py")
        self.assertEqual(gates[1]["timeout_seconds"], 30)


if __name__ == "__main__":
    unittest.main()
