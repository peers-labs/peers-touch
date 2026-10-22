from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

from tooling.acceptance.core import ArtifactRef, FormalExecutionPlan
from tooling.acceptance.gates.release import operation_analysis
from tooling.acceptance.gates.release import release_aggregate
from tooling.acceptance.gates.release import operation_analysis_test as operation_fixture


EXPECTED_SOURCE = {
    "commit": "a" * 40,
    "workspaceDigest": "clean",
    "canonicalWorktreeHash": "0123456789abcdef",
}
RUN_ID = "20261019T130000000000Z-" + ("b" * 32)
ENV_GATE = "desktop-native-journey"
LOCAL_GATE = "source-contract"
OPERATION_GATE = operation_analysis.GATE_ID
AGGREGATE_GATE = release_aggregate.GATE_ID


def artifact_ref(gate_id: str, path: str) -> dict[str, str]:
    return {
        "artifactKind": "acceptance-artifact-ref",
        "workspaceId": "0123456789abcdef",
        "gateId": gate_id,
        "runId": RUN_ID,
        "path": path,
        "sha256": "c" * 64,
        "mediaType": "application/json",
    }


def passing_manifest(
    gate_id: str,
    *,
    runtime_cell: str | None = None,
    environment_evidence: bool = False,
) -> dict[str, object]:
    artifacts: dict[str, object] = {}
    result: dict[str, object] = {
        "status": "passed",
        "completionStatus": "DONE",
        "proofStatus": "PROVEN",
        "cleanupStatus": "not-required",
        "secretScan": {"status": "passed"},
    }
    if runtime_cell:
        result["runtimeCell"] = runtime_cell
    if environment_evidence:
        report = artifact_ref(gate_id, "canonical-report.json")
        artifacts["canonical-report"] = report
        result.update(
            {
                "sourceArtifactKind": "acceptance-gate-evidence-report",
                "sourceArtifact": report,
            }
        )
    if gate_id == OPERATION_GATE:
        artifacts[
            operation_analysis.REPORT_ROLE
        ] = artifact_ref(gate_id, "operation-report.json")
    return {
        "artifactKind": "acceptance-run-manifest",
        "state": "DURABLE",
        "workspaceId": "0123456789abcdef",
        "gateId": gate_id,
        "runId": RUN_ID,
        "source": EXPECTED_SOURCE,
        "redaction": {"status": "passed"},
        "artifacts": artifacts,
        "result": result,
    }


def completed_operation_report() -> dict[str, object]:
    return {
        "artifactKind": "acceptance-gate-evidence-report",
        "gateId": OPERATION_GATE,
        "planId": operation_analysis.PLAN_ID,
        "status": "PASS",
        "completionStatus": "DONE",
        "proofStatus": "PROVEN",
        "uxVerdict": "通过",
        "source": EXPECTED_SOURCE,
        "journeyCount": len(operation_analysis.REQUIRED_JOURNEYS),
        "journeys": operation_fixture.review_input()["journeys"],
        "fixedDefects": [],
        "openBlockers": [],
        "preservedDesigns": [],
        "roadmap": {"must": [], "should": [], "could": []},
    }


class FakeStore:
    workspace_id = "0123456789abcdef"

    def __init__(self) -> None:
        self.operations = operation_fixture.FakeStore()
        self.manifests = {
            LOCAL_GATE: passing_manifest(LOCAL_GATE),
            ENV_GATE: passing_manifest(
                ENV_GATE,
                runtime_cell="desktop-macos-native",
                environment_evidence=True,
            ),
            OPERATION_GATE: passing_manifest(OPERATION_GATE),
        }

    def latest(self, gate_id: str) -> dict[str, object]:
        return self.manifests[gate_id]

    def resolve(self, reference: ArtifactRef) -> Path:
        return Path("/tmp") / reference.path

    def read_json(self, reference: ArtifactRef) -> dict[str, object]:
        if reference.path == "manifest.json":
            if reference.gate_id in self.operations.manifests:
                return self.operations.read_json(reference)
            return self.manifests[reference.gate_id]
        if reference.path == "trace.json":
            return self.operations.read_json(reference)
        if reference.path == "canonical-report.json":
            return {
                "artifactKind": "acceptance-gate-evidence-report",
                "gateId": reference.gate_id,
                "status": "PASS",
                "completionStatus": "DONE",
                "proofStatus": "PROVEN",
                "sampleEmissionAllowed": True,
            }
        if reference.path == "operation-report.json":
            return completed_operation_report()
        if reference.path == "cleanup.json":
            return {
                "artifactKind": "acceptance-provisioner-cleanup-result",
                "status": "passed",
                "completionStatus": "DONE",
                "proofStatus": "PROVEN",
            }
        raise AssertionError(f"unexpected JSON artifact: {reference.path}")


def formal_plan() -> FormalExecutionPlan:
    return FormalExecutionPlan(
        path=Path("/tmp/plan.md"),
        plan_id=release_aggregate.PLAN_ID,
        plan_format="version",
        status="explicit",
        branch="test",
        workspace_id="0123456789abcdef",
        initial_head="a" * 40,
        current_task_id=None,
        current_task_path=None,
        current_task_write_set=None,
        current_closure=None,
        closure_statuses={
            "release-source": "unselected",
            "release-ux-analysis": "unselected",
            "release-final": "unselected",
        },
        acceptance={
            "closures": {
                "release-source": [LOCAL_GATE],
                "release-ux-analysis": [ENV_GATE, OPERATION_GATE],
                "release-final": [AGGREGATE_GATE],
            },
            "completion": [
                LOCAL_GATE,
                ENV_GATE,
                OPERATION_GATE,
                AGGREGATE_GATE,
            ],
            "full": [
                LOCAL_GATE,
                ENV_GATE,
                OPERATION_GATE,
                AGGREGATE_GATE,
            ],
        },
        source_claims=("tooling/acceptance",),
    )


def current_results() -> str:
    return json.dumps(
        {
            "source": EXPECTED_SOURCE,
            "results": [
                {
                    "id": gate_id,
                    "status": "passed",
                    "completionStatus": "DONE",
                    "proofStatus": "PROVEN",
                    "runManifest": artifact_ref(gate_id, "manifest.json"),
                }
                for gate_id in (LOCAL_GATE, ENV_GATE, OPERATION_GATE)
            ],
        }
    )


class ReleaseAggregateTest(unittest.TestCase):
    def setUp(self) -> None:
        self.store = FakeStore()
        self.catalog = {
            LOCAL_GATE: {
                "tier": "ci-cheap",
                "environment": "local",
            },
            ENV_GATE: {
                "tier": "env-evidence",
                "environment": "desktop",
                "requiredRuntimeCells": ["desktop-macos-native"],
            },
            OPERATION_GATE: {
                "tier": "local-evidence",
                "environment": "local",
            },
        }

    def gate(
        self,
        *,
        results: str | None = None,
    ) -> release_aggregate.ReleaseAggregateGate:
        return release_aggregate.ReleaseAggregateGate(
            store=self.store,
            expected_source=EXPECTED_SOURCE,
            plan=formal_plan(),
            current_results=results or current_results(),
            catalog=self.catalog,
        )

    def test_complete_current_aggregate_is_publishable(self) -> None:
        report = self.gate().evaluate()

        self.assertEqual(report["status"], "PASS")
        self.assertEqual(report["releaseVerdict"], "可发布")
        self.assertEqual(report["passedCount"], 3)
        self.assertFalse(report["blockers"])

    def test_missing_current_result_is_not_publishable(self) -> None:
        value = json.loads(current_results())
        value["results"] = value["results"][:-1]

        report = self.gate(results=json.dumps(value)).evaluate()

        self.assertEqual(report["status"], "FAIL")
        self.assertEqual(report["releaseVerdict"], "不可发布")
        self.assertTrue(
            any(item["status"] == "MISSING" for item in report["blockers"])
        )

    def test_stale_manifest_is_rejected(self) -> None:
        self.store.manifests[LOCAL_GATE]["source"] = {
            **EXPECTED_SOURCE,
            "commit": "d" * 40,
        }

        report = self.gate().evaluate()

        self.assertEqual(report["status"], "FAIL")
        self.assertTrue(
            any(item["status"] == "STALE" for item in report["blockers"])
        )

    def test_wrong_runtime_cell_is_rejected(self) -> None:
        self.store.manifests[ENV_GATE]["result"][
            "runtimeCell"
        ] = "desktop-linux-native"

        report = self.gate().evaluate()

        self.assertEqual(report["status"], "FAIL")
        self.assertIn(
            "runtime cell",
            next(
                item["detail"]
                for item in report["blockers"]
                if item["gateId"] == ENV_GATE
            ),
        )

    def test_failed_cleanup_is_rejected(self) -> None:
        manifest = self.store.manifests[ENV_GATE]
        cleanup = artifact_ref(ENV_GATE, "cleanup.json")
        manifest["artifacts"]["cleanup"] = cleanup
        manifest["result"]["cleanupStatus"] = "failed"
        manifest["result"]["cleanupArtifact"] = cleanup

        report = self.gate().evaluate()

        self.assertEqual(report["status"], "FAIL")
        self.assertIn(
            "cleanup status",
            next(
                item["detail"]
                for item in report["blockers"]
                if item["gateId"] == ENV_GATE
            ),
        )

    def test_invalid_operation_report_is_rejected(self) -> None:
        original = self.store.read_json

        def invalid(reference: ArtifactRef) -> dict[str, object]:
            value = original(reference)
            if reference.path == "operation-report.json":
                value = copy.deepcopy(value)
                value["proofStatus"] = "UNPROVEN"
            return value

        self.store.read_json = invalid  # type: ignore[method-assign]

        report = self.gate().evaluate()

        self.assertEqual(report["status"], "FAIL")
        self.assertTrue(
            any(
                item["gateId"] == OPERATION_GATE
                for item in report["blockers"]
            )
        )

    def test_aggregate_rejects_empty_journeys_despite_declared_count(self) -> None:
        original = self.store.read_json
        def invalid(reference: ArtifactRef) -> dict[str, object]:
            value = original(reference)
            if reference.path == "operation-report.json":
                value = copy.deepcopy(value)
                value["journeys"] = []
            return value
        self.store.read_json = invalid
        self.assertEqual(self.gate().evaluate()["status"], "FAIL")

    def test_aggregate_revalidates_platform_in_the_immutable_trace(self) -> None:
        self.store.operations.trace["segments"][0]["platform"] = "ios-simulator"
        self.assertEqual(self.gate().evaluate()["status"], "FAIL")


if __name__ == "__main__":
    unittest.main()
