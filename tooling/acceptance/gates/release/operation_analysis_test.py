from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.core import ArtifactRef, GateError, REPO_ROOT
from tooling.acceptance.gates.release import operation_analysis
from tooling.acceptance.gates.release.operation_contract import RUNTIME_CELLS


EXPECTED_SOURCE = {
    "commit": "a" * 40,
    "workspaceDigest": "clean",
    "canonicalWorktreeHash": "0123456789abcdef",
}
RUN_ID = "20261019T120000000000Z-" + ("b" * 32)


def artifact_ref(
    gate_id: str,
    path: str,
    *,
    media_type: str = "application/json",
) -> dict[str, str]:
    return {
        "artifactKind": "acceptance-artifact-ref",
        "workspaceId": "0123456789abcdef",
        "gateId": gate_id,
        "runId": RUN_ID,
        "path": path,
        "sha256": "c" * 64,
        "mediaType": media_type,
    }


def passing_manifest(gate_id: str) -> dict[str, object]:
    report = artifact_ref(gate_id, "report.json")
    screenshot = artifact_ref(
        gate_id,
        "screenshot.png",
        media_type="image/png",
    )
    trace = artifact_ref(gate_id, "trace.json")
    return {
        "artifactKind": "acceptance-run-manifest",
        "state": "DURABLE",
        "workspaceId": "0123456789abcdef",
        "gateId": gate_id,
        "runId": RUN_ID,
        "source": EXPECTED_SOURCE,
        "redaction": {"status": "passed"},
        "artifacts": {
            "report": report,
            "screenshot": screenshot,
            "trace": trace,
        },
        "result": {
            "status": "passed",
            "completionStatus": "DONE",
            "proofStatus": "PROVEN",
            "cleanupStatus": "not-required",
            "sourceArtifactKind": "acceptance-gate-evidence-report",
            "sourceArtifact": report,
            "secretScan": {"status": "passed"},
        },
    }


def review_artifact(
    gate_id: str,
    path: str,
    *,
    media_type: str = "application/json",
) -> dict[str, object]:
    return {
        "artifact": artifact_ref(
            gate_id,
            path,
            media_type=media_type,
        ),
        "runManifest": artifact_ref(gate_id, "manifest.json"),
    }


class FakeStore:
    workspace_id = "0123456789abcdef"

    def __init__(self) -> None:
        self.manifests = {
            gate_id: passing_manifest(gate_id)
            for gate_id in operation_analysis.REQUIRED_EVIDENCE_GATES
        }
        self.trace = {
            "artifactKind": "release-operation-interaction-trace",
            "source": EXPECTED_SOURCE,
            "segments": [],
        }
        evidence_gate = operation_analysis.REQUIRED_EVIDENCE_GATES[0]
        self.manifests[evidence_gate]["result"]["runtimeCell"] = "desktop-macos-native+ios-simulator"
        for journey_id, platform in operation_analysis.REQUIRED_JOURNEYS:
            path = f"{journey_id}-{platform}.png"
            screenshot = artifact_ref(evidence_gate, path, media_type="image/png")
            self.manifests[evidence_gate]["artifacts"][path] = screenshot
            self.trace["segments"].append({
                "segmentId": f"{journey_id}-{platform}",
                "journeyId": journey_id,
                "platform": platform,
                "runtimeCell": RUNTIME_CELLS[platform],
                "steps": ["进入功能", "执行操作", "确认结果"],
                "screenshots": [screenshot],
                "actions": [
                    {"stepIndex": index, "kind": "ui-action", "status": "passed", "observation": "原生操作"}
                    for index in range(3)
                ],
                "assertions": [
                    {"stepIndex": 2, "kind": kind, "status": "passed", "observation": "原生结果可见"}
                    for kind in ("ui-visible", "receiver-visible")
                ],
            })

    def latest(self, gate_id: str) -> dict[str, object]:
        return self.manifests[gate_id]

    def resolve(self, reference: ArtifactRef) -> Path:
        return Path("/tmp") / reference.path

    def read_json(self, reference: ArtifactRef) -> dict[str, object]:
        if reference.path == "manifest.json":
            return self.manifests[reference.gate_id]
        if reference.path == "report.json":
            return {
                "artifactKind": "acceptance-gate-evidence-report",
                "gateId": reference.gate_id,
                "status": "PASS",
                "completionStatus": "DONE",
                "proofStatus": "PROVEN",
                "sampleEmissionAllowed": True,
            }
        if reference.path == "trace.json":
            return self.trace
        raise AssertionError(f"unexpected JSON artifact: {reference.path}")


def review_input() -> dict[str, object]:
    evidence_gate = operation_analysis.REQUIRED_EVIDENCE_GATES[0]
    trace = review_artifact(evidence_gate, "trace.json")
    journeys = []
    for journey_id, platform in operation_analysis.REQUIRED_JOURNEYS:
        journeys.append(
            {
                "journeyId": journey_id,
                "platform": platform,
                "goal": "完成用户任务",
                "steps": ["进入功能", "执行操作", "确认结果"],
                "completed": True,
                "durationSeconds": 12,
                "waitPoints": [
                    {
                        "label": "等待结果",
                        "durationSeconds": 1,
                        "feedback": "界面显示处理中",
                    }
                ],
                "discoverability": "入口可见",
                "feedback": "结果反馈明确",
                "recovery": "失败后可重试",
                "facts": ["任务用三步完成"],
                "observations": ["操作过程无死路"],
                "judgments": [
                    {
                        "summary": "保留当前反馈模式",
                        "classification": "preserve-good-design",
                        "priority": "preserve",
                        "rationale": "反馈及时且含义清楚",
                        "affectedUsers": "所有用户",
                        "dimensions": {
                            dimension: "符合要求"
                            for dimension in operation_analysis.DIMENSIONS
                        },
                        "resolutionStatus": "not-applicable",
                    }
                ],
                "screenshot": review_artifact(
                    evidence_gate, f"{journey_id}-{platform}.png", media_type="image/png",
                ),
                "interactionTrace": trace,
                "traceSegmentId": f"{journey_id}-{platform}",
            }
        )
    return {
        "artifactKind": "release-operation-review-input",
        "schemaVersion": 1,
        "planId": operation_analysis.PLAN_ID,
        "source": EXPECTED_SOURCE,
        "reviewer": "Release Acceptance",
        "journeys": journeys,
    }


class OperationAnalysisTest(unittest.TestCase):
    def setUp(self) -> None:
        self.store = FakeStore()
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.review_path = Path(self.temporary.name) / "review.json"

    def write_review(self, value: dict[str, object]) -> None:
        self.review_path.write_text(
            json.dumps(value, ensure_ascii=False),
            encoding="utf-8",
        )

    def gate(self) -> operation_analysis.OperationAnalysisGate:
        return operation_analysis.OperationAnalysisGate(
            store=self.store,
            expected_source=EXPECTED_SOURCE,
            review_input=self.review_path,
        )

    def test_complete_exact_source_review_passes(self) -> None:
        self.write_review(review_input())

        report, normalized = self.gate().evaluate()

        self.assertIsNotNone(normalized)
        self.assertEqual(report["status"], "PASS")
        self.assertEqual(
            report["journeyCount"],
            len(operation_analysis.REQUIRED_JOURNEYS),
        )
        self.assertFalse(report["openBlockers"])
        self.assertIn(
            '<a href="peers-touch-evidence://',
            operation_analysis.render_html(report),
        )

    def test_missing_journey_is_unproven(self) -> None:
        value = review_input()
        value["journeys"] = value["journeys"][:-1]
        self.write_review(value)

        report, normalized = self.gate().evaluate()

        self.assertIsNone(normalized)
        self.assertEqual(report["status"], "FAIL")
        self.assertIn("missing journeys", report["openBlockers"][-1]["detail"])

    def test_open_release_defect_blocks_report(self) -> None:
        value = review_input()
        judgment = value["journeys"][0]["judgments"][0]
        judgment.update(
            {
                "classification": "release-defect",
                "priority": "must",
                "resolutionStatus": "open",
            }
        )
        self.write_review(value)

        report, _ = self.gate().evaluate()

        self.assertEqual(report["status"], "FAIL")
        self.assertEqual(
            report["openBlockers"][-1]["summary"],
            judgment["summary"],
        )

    def test_raw_internal_url_is_rejected(self) -> None:
        value = review_input()
        value["journeys"][0]["facts"] = ["访问 http://station.internal"]

        with self.assertRaisesRegex(GateError, "sensitive"):
            operation_analysis.validate_review_input(
                value,
                store=self.store,
                expected_source=EXPECTED_SOURCE,
            )

    def test_report_review_requires_completed_proof(self) -> None:
        self.write_review(review_input())
        report, _ = self.gate().evaluate()
        operation_analysis.validate_analysis_report(report)

        failed = copy.deepcopy(report)
        failed["proofStatus"] = "UNPROVEN"
        with self.assertRaisesRegex(GateError, "completed proof"):
            operation_analysis.validate_analysis_report(failed)

    def test_wrong_platform_or_journey_cannot_reuse_a_segment(self) -> None:
        value = review_input()
        value["journeys"][0]["traceSegmentId"] = value["journeys"][1]["traceSegmentId"]
        with self.assertRaisesRegex(GateError, "does not match"):
            operation_analysis.validate_review_input(value, store=self.store, expected_source=EXPECTED_SOURCE)

    def test_unmapped_shared_trace_is_rejected(self) -> None:
        value = review_input()
        self.store.trace["segments"] = []
        with self.assertRaisesRegex(GateError, "missing or ambiguous"):
            operation_analysis.validate_review_input(value, store=self.store, expected_source=EXPECTED_SOURCE)

    def test_ios_only_run_cannot_certify_desktop_even_with_a_forged_segment(self) -> None:
        evidence_gate = operation_analysis.REQUIRED_EVIDENCE_GATES[0]
        self.store.manifests[evidence_gate]["result"]["runtimeCell"] = "ios-simulator"
        with self.assertRaisesRegex(GateError, "required native platform"):
            operation_analysis.validate_review_input(review_input(), store=self.store, expected_source=EXPECTED_SOURCE)

    def test_empty_report_cannot_claim_eighteen_journeys(self) -> None:
        self.write_review(review_input())
        report, _ = self.gate().evaluate()
        report["journeys"] = []
        with self.assertRaisesRegex(GateError, "incomplete journey"):
            operation_analysis.validate_analysis_report(report)

    def test_missing_receiver_observation_is_rejected(self) -> None:
        segment = next(item for item in self.store.trace["segments"] if item["journeyId"] == "direct-and-group-chat")
        segment["assertions"] = segment["assertions"][:1]
        with self.assertRaisesRegex(GateError, "receiver visible"):
            operation_analysis.validate_review_input(review_input(), store=self.store, expected_source=EXPECTED_SOURCE)

    def test_feature_capability_domain_registry_and_catalog_are_wired(self) -> None:
        acceptance_root = REPO_ROOT / "tooling/acceptance"
        feature = json.loads(
            (
                acceptance_root
                / "features/release-mobile-ios-desktop-operation-analysis.yaml"
            ).read_text(encoding="utf-8")
        )
        capabilities = json.loads(
            (acceptance_root / "capabilities/mobile.yaml").read_text(
                encoding="utf-8"
            )
        )["capabilities"]
        domain = json.loads(
            (acceptance_root / "domains/mobile.yaml").read_text(
                encoding="utf-8"
            )
        )
        registry = json.loads(
            (acceptance_root / "registry.yaml").read_text(encoding="utf-8")
        )["rules"]
        gates = json.loads(
            (acceptance_root / "gates.yaml").read_text(encoding="utf-8")
        )["gates"]
        capability = next(
            item
            for item in capabilities
            if item["id"] == feature["id"]
        )
        operation_rule = next(
            item
            for item in registry
            if item["id"] == "release-mobile-ios-desktop-operation-analysis"
        )
        aggregate_rule = next(
            item
            for item in registry
            if item["id"] == "release-mobile-ios-desktop-final-aggregate"
        )

        self.assertIn(feature["id"], capability["features"])
        self.assertIn(capability["id"], domain["capabilities"])
        self.assertEqual(
            feature["required_gates"],
            [operation_analysis.GATE_ID],
        )
        self.assertEqual(
            capability["required_gates"],
            [operation_analysis.GATE_ID],
        )
        self.assertEqual(
            operation_rule["require"],
            [operation_analysis.GATE_ID],
        )
        self.assertEqual(
            aggregate_rule["require"],
            ["release-0.0.1-mobile-ios-desktop-aggregate"],
        )
        self.assertIn(operation_analysis.GATE_ID, gates)
        self.assertIn(
            "release-0.0.1-mobile-ios-desktop-aggregate",
            gates,
        )


if __name__ == "__main__":
    unittest.main()
