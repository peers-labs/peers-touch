from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.core import (
    EvidenceManifestInvalid,
    RuntimeReuseContract,
    SuiteRuntimeAction,
    SuiteRuntimeLedger,
)
from tooling.acceptance.gates.unified_client import architecture_aggregate


EXPECTED_SOURCE = {
    "commit": "a" * 40,
    "workspaceDigest": "sha256:" + ("b" * 64),
    "canonicalWorktreeHash": "0123456789abcdef",
}
RUN_ID = "20261017T120000000000Z-" + ("c" * 32)


def suite_runtime_report() -> dict[str, object]:
    contract = RuntimeReuseContract(
        entry_check_id="uca-suite",
        scenario_ids=("first", "second"),
        max_provisioning_runs=1,
        max_client_launches=1,
        min_warm_reuse_rate=0.5,
    )
    ledger = SuiteRuntimeLedger(
        contract,
        suite_runtime_id="uca-suite-runtime",
        source_digest=EXPECTED_SOURCE["workspaceDigest"].removeprefix("sha256:"),
        fixture_epoch="fixture-1",
    )
    ledger.record(SuiteRuntimeAction.PROVISION, resource_id="services")
    ledger.record(SuiteRuntimeAction.CLIENT_LAUNCH, resource_id="client")
    for scenario in contract.scenario_ids:
        ledger.record(SuiteRuntimeAction.SCENARIO_START, scenario_id=scenario)
        ledger.record(
            SuiteRuntimeAction.UI_ACTION,
            scenario_id=scenario,
        )
        ledger.record(
            SuiteRuntimeAction.RECEIVER_ASSERTION,
            scenario_id=scenario,
        )
        ledger.record(SuiteRuntimeAction.SCENARIO_END, scenario_id=scenario)
    ledger.record(SuiteRuntimeAction.CLEANUP_COMPLETE)
    return ledger.require_valid()


def artifact_ref(gate_id: str) -> dict[str, str]:
    return {
        "artifactKind": "acceptance-artifact-ref",
        "workspaceId": "0123456789abcdef",
        "gateId": gate_id,
        "runId": RUN_ID,
        "path": "reports/suite-runtime.json",
        "sha256": "d" * 64,
        "mediaType": "application/json",
    }


def passing_manifest(
    spec: architecture_aggregate.GateSpec,
    *,
    source: dict[str, str] | None = None,
) -> dict[str, object]:
    artifacts = (
        {"suite-runtime": artifact_ref(spec.gate_id)}
        if spec.requires_suite_runtime
        else {}
    )
    return {
        "artifactKind": "acceptance-run-manifest",
        "state": "DURABLE",
        "workspaceId": "0123456789abcdef",
        "gateId": spec.gate_id,
        "runId": RUN_ID,
        "source": source or EXPECTED_SOURCE,
        "runtime": {"runtimeCells": list(spec.runtime_cells)},
        "result": {
            "status": "passed",
            "completionStatus": "DONE",
            "proofStatus": "PROVEN",
            "secretScan": {"status": "passed"},
        },
        "artifacts": artifacts,
        "redaction": {"status": "passed"},
    }


class FakeStore:
    workspace_id = "0123456789abcdef"

    def __init__(self) -> None:
        self.manifests = {
            spec.gate_id: passing_manifest(spec)
            for spec in architecture_aggregate.CHILD_GATES
        }
        self.suite_report = suite_runtime_report()
        self.latest_calls = []

    def latest(self, gate_id: str, *, runtime_cell: str | None = None) -> dict[str, object]:
        self.latest_calls.append((gate_id, runtime_cell))
        if gate_id not in self.manifests:
            raise EvidenceManifestInvalid(
                f"latest pointer is unavailable for {gate_id}"
            )
        return self.manifests[gate_id]

    def read_json(self, _reference: object) -> dict[str, object]:
        return self.suite_report


class UnifiedClientArchitectureAggregateTest(unittest.TestCase):
    def test_dirty_workspace_cannot_reuse_head_only_suite_proof(self) -> None:
        source_report = suite_runtime_report()
        source_report["sourceDigest"] = EXPECTED_SOURCE["commit"]
        self.store.suite_report = source_report
        result = self.evaluate()
        self.assertFalse(result.passed)

    def setUp(self) -> None:
        self.store = FakeStore()

    def evaluate(self) -> architecture_aggregate.AggregateResult:
        return architecture_aggregate.AggregateResult(
            source=EXPECTED_SOURCE,
            outcome_comparison_sha256="e" * 64,
            baseline=[
                architecture_aggregate.BaselineResult("check", "PASS")
            ],
            children=[
                architecture_aggregate.check_child(
                    self.store,
                    spec,
                    expected_source=EXPECTED_SOURCE,
                )
                for spec in architecture_aggregate.CHILD_GATES
            ],
        )

    def test_requires_every_plan_child_gate_once(self) -> None:
        self.assertEqual(
            [spec.gate_id for spec in architecture_aggregate.CHILD_GATES],
            [
                "unified-client-android-host-e2e",
                "unified-client-ios-host-e2e",
                "unified-client-messaging-core-contract",
                "unified-client-messaging-e2e",
                "messaging-owner-hard-cut-zero",
                "secure-content-portable-core",
                "unified-client-secure-content-e2e",
                "secure-content-owner-hard-cut-zero",
                "unified-client-shared-semantics",
            ],
        )

    def test_current_source_children_and_cleanup_pass(self) -> None:
        aggregate = self.evaluate()

        self.assertTrue(aggregate.passed)
        report = architecture_aggregate.build_report(aggregate)
        self.assertEqual(report["status"], "PASS")
        self.assertEqual(report["proofStatus"], "PROVEN")
        self.assertEqual(report["outcomeComparisonSha256"], "e" * 64)

    def test_host_children_use_platform_latest_and_business_suites_use_whole_suite(self) -> None:
        self.evaluate()
        self.assertEqual(self.store.latest_calls[:2], [
            ("unified-client-android-host-e2e", "mobile-android-native"),
            ("unified-client-ios-host-e2e", "mobile-ios-native"),
        ])
        self.assertIn(("unified-client-messaging-e2e", None), self.store.latest_calls)
        self.assertIn(("unified-client-secure-content-e2e", None), self.store.latest_calls)

    def test_missing_or_stale_child_is_unproven(self) -> None:
        target = architecture_aggregate.CHILD_GATES[0]
        del self.store.manifests[target.gate_id]
        missing = self.evaluate()
        self.assertTrue(missing.unproven)
        self.assertEqual(missing.children[0].status, "MISSING")

        self.store.manifests[target.gate_id] = passing_manifest(
            target,
            source={**EXPECTED_SOURCE, "commit": "f" * 40},
        )
        stale = self.evaluate()
        self.assertEqual(stale.children[0].status, "STALE")

    def test_blocked_physical_runtime_remains_unproven(self) -> None:
        target = architecture_aggregate.CHILD_GATES[0]
        manifest = passing_manifest(target)
        manifest["result"] = {
            "status": "blocked",
            "completionStatus": "BLOCKED",
            "proofStatus": "UNPROVEN",
            "blockedReason": "physical Android device is unavailable",
            "secretScan": {"status": "passed"},
        }
        self.store.manifests[target.gate_id] = manifest

        aggregate = self.evaluate()

        self.assertTrue(aggregate.unproven)
        self.assertEqual(aggregate.children[0].status, "UNPROVEN")
        self.assertEqual(
            architecture_aggregate.build_report(aggregate)["status"],
            "UNPROVEN",
        )

    def test_runtime_cells_and_suite_cleanup_fail_closed(self) -> None:
        target = architecture_aggregate.CHILD_GATES[0]
        self.store.manifests[target.gate_id]["runtime"] = {
            "runtimeCells": ["mobile-ios-native"]
        }
        wrong_cell = self.evaluate()
        self.assertEqual(wrong_cell.children[0].status, "FAIL")

        self.store.manifests[target.gate_id] = passing_manifest(target)
        self.store.manifests[target.gate_id]["artifacts"] = {}
        missing_suite = self.evaluate()
        self.assertEqual(missing_suite.children[0].status, "FAIL")
        self.assertIn(
            "suite-runtime",
            missing_suite.children[0].detail,
        )

    def test_baseline_checks_are_bounded_and_local(self) -> None:
        calls: list[list[str]] = []

        def runner(command: list[str], **_kwargs: object):
            calls.append(command)
            return subprocess.CompletedProcess(command, 0, "", "")

        results = architecture_aggregate.run_baseline_checks(runner=runner)

        self.assertEqual(
            calls,
            [list(command) for command in architecture_aggregate.BASELINE_CHECKS],
        )
        self.assertTrue(all(result.status == "PASS" for result in results))
        source = Path(architecture_aggregate.__file__).read_text(
            encoding="utf-8"
        )
        self.assertNotIn("provisioner", source.lower())
        self.assertNotIn("acceptance-run.py", source)

    def test_outcome_comparison_digest_binds_exact_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "outcome-comparison.md"
            path.write_text("actual result\n", encoding="utf-8")

            self.assertEqual(
                architecture_aggregate.outcome_comparison_sha256(path),
                "cd93fd8f14225b2227bbf9910ca8cf8054cfa9edce2731a3d2c9c5083669bb27",
            )


if __name__ == "__main__":
    unittest.main()
