#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core.suite_runtime import (
    RuntimeReuseContract,
    SuiteRuntimeAction,
    SuiteRuntimeLedger,
)


SCRIPT = Path(__file__).with_name("acceptance-pipeline-audit.py")
SPEC = importlib.util.spec_from_file_location(
    "acceptance_pipeline_audit",
    SCRIPT,
)
assert SPEC is not None and SPEC.loader is not None
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


def runtime_reuse() -> dict[str, object]:
    return {
        "scope": "suite",
        "entryCheckId": "suite-functional",
        "scenarioIds": ["publish", "receive"],
        "maxProvisioningRuns": 1,
        "maxClientLaunches": 2,
        "minWarmReuseRate": 0.5,
        "requireAttachOnlyScenarios": True,
        "requireReceiverVisibleProof": True,
        "allowClientReplacement": False,
    }


def write_plan(root: Path, *, include_contract: bool = True) -> Path:
    plan_dir = root / "plan"
    task_dir = plan_dir / "tasks"
    task_dir.mkdir(parents=True)
    task = {
        "kind": "peers-touch-task-slice",
        "planId": "AUDIT-TEST",
        "taskId": "T1",
        "workstreamId": "T1",
        "title": "Audit suite",
        "workClass": "product-behavior",
        "completionClass": "functional",
        "executionMode": "build",
        "closureId": "audit-suite",
        "journeyId": "audit-suite",
        "runtimeClass": "native-desktop",
        "writeSet": ["tooling/acceptance"],
        "readSet": [],
        "budgets": {
            "focusedCheckSeconds": 60,
            "functionalRunSeconds": 120,
            "cleanupSeconds": 30,
        },
        "checks": [
            {
                "id": "suite-functional",
                "command": "run-suite",
                "verificationClass": "FUNCTIONAL_CHECK",
            }
        ],
        "doneWhen": ["suite passes"],
        "failureBehavior": ["fail closed"],
        "updatedAt": "2026-09-29T00:00:00.000Z",
        "durableEvidence": [],
    }
    if include_contract:
        task["runtimeReuse"] = runtime_reuse()
    (task_dir / "T1.md").write_text(
        "\n".join(
            (
                "# T1",
                "",
                "## Task Slice",
                "",
                "```json",
                json.dumps(task),
                "```",
                "",
                "## Current Snapshot",
                "",
                "- Test fixture.",
                "",
            )
        ),
        encoding="utf-8",
    )
    manifest = {
        "kind": "peers-touch-plan-package",
        "planId": "AUDIT-TEST",
        "tasks": [
            {
                "id": "T1",
                "path": "tasks/T1.md",
            }
        ],
    }
    plan_path = plan_dir / "plan.md"
    plan_path.write_text(
        "\n".join(
            (
                "# Audit Test",
                "",
                "## Plan Package",
                "",
                "```json",
                json.dumps(manifest),
                "```",
                "",
            )
        ),
        encoding="utf-8",
    )
    return plan_path


def valid_report() -> dict[str, object]:
    contract = RuntimeReuseContract.from_dict(runtime_reuse())
    ledger = SuiteRuntimeLedger(
        contract,
        suite_runtime_id="audit-suite",
        source_digest="a" * 40,
        fixture_epoch="epoch-1",
    )
    ledger.record(
        SuiteRuntimeAction.PROVISION,
        resource_id="runtime",
    )
    for actor in ("alice", "bob"):
        ledger.record(
            SuiteRuntimeAction.CLIENT_LAUNCH,
            resource_id=actor,
        )
    for scenario_id in contract.scenario_ids:
        ledger.record(
            SuiteRuntimeAction.SCENARIO_START,
            scenario_id=scenario_id,
        )
        ledger.record(
            SuiteRuntimeAction.UI_ACTION,
            scenario_id=scenario_id,
        )
        ledger.record(
            SuiteRuntimeAction.RECEIVER_ASSERTION,
            scenario_id=scenario_id,
        )
        ledger.record(
            SuiteRuntimeAction.SCENARIO_END,
            scenario_id=scenario_id,
        )
    ledger.record(SuiteRuntimeAction.CLEANUP_COMPLETE)
    return ledger.require_valid()


class AcceptancePipelineAuditTests(unittest.TestCase):
    def test_plan_contract_passes_without_claiming_runtime_proof(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            plan_path = write_plan(Path(temp_dir))
            result = AUDIT.audit_pipeline(
                plan_path=plan_path,
                task_ids=("T1",),
            )

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["proofState"], "NOT_RUN")
        self.assertEqual(
            result["taskResults"][0]["runtimeProofState"],
            "NOT_RUN",
        )

    def test_missing_contract_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            plan_path = write_plan(
                Path(temp_dir),
                include_contract=False,
            )
            result = AUDIT.audit_pipeline(
                plan_path=plan_path,
                task_ids=("T1",),
            )

        self.assertEqual(result["result"], "FAIL")
        self.assertEqual(
            result["findings"][0]["code"],
            "RUNTIME_REUSE_CONTRACT_MISSING",
        )

    def test_implicit_audit_rejects_plan_without_reuse_tasks(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            plan_path = write_plan(
                Path(temp_dir),
                include_contract=False,
            )
            with self.assertRaisesRegex(
                AUDIT.PipelineAuditError,
                "no runtimeReuse Task",
            ):
                AUDIT.audit_pipeline(
                    plan_path=plan_path,
                    task_ids=(),
                )

    def test_valid_runtime_report_is_supporting_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            plan_path = write_plan(root)
            report_path = root / "suite-report.json"
            report_path.write_text(
                json.dumps(valid_report()),
                encoding="utf-8",
            )
            result = AUDIT.audit_pipeline(
                plan_path=plan_path,
                task_ids=("T1",),
                runtime_reports=(report_path,),
            )

        self.assertEqual(result["result"], "PASS")
        self.assertEqual(result["proofState"], "SUPPORTING")
        self.assertEqual(
            result["runtimeReports"][0]["result"],
            "PASS",
        )

    def test_mutated_runtime_report_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            plan_path = write_plan(root)
            report = valid_report()
            report["metrics"]["clientLaunches"] = 99
            report_path = root / "suite-report.json"
            report_path.write_text(
                json.dumps(report),
                encoding="utf-8",
            )
            result = AUDIT.audit_pipeline(
                plan_path=plan_path,
                task_ids=("T1",),
                runtime_reports=(report_path,),
            )

        self.assertEqual(result["result"], "FAIL")
        self.assertEqual(
            result["findings"][0]["code"],
            "SUITE_RUNTIME_REPORT_DIGEST_MISMATCH",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
