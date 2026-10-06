from __future__ import annotations

import json
import unittest

from tooling.acceptance.core import EvidenceManifestInvalid
from tooling.acceptance.gates.station_access import session_class_e2e


EXPECTED_SOURCE = {
    "commit": "a" * 40,
    "workspaceDigest": "clean",
    "canonicalWorktreeHash": "0123456789abcdef",
}


def passing_manifest(
    gate_id: str,
    *,
    source: dict[str, str] | None = None,
    status: str = "passed",
    completion_status: str = "DONE",
    proof_status: str = "PROVEN",
) -> dict[str, object]:
    return {
        "artifactKind": "acceptance-run-manifest",
        "state": "DURABLE",
        "workspaceId": "0123456789abcdef",
        "gateId": gate_id,
        "runId": "20261006T120000000000Z-" + ("b" * 32),
        "source": source or EXPECTED_SOURCE,
        "redaction": {"status": "passed"},
        "result": {
            "status": status,
            "completionStatus": completion_status,
            "proofStatus": proof_status,
            "secretScan": {"status": "passed"},
        },
    }


def development_manifest(gate_id: str) -> dict[str, object]:
    manifest = passing_manifest(gate_id)
    manifest["result"] = {
        "artifactKind": "development-functional-result",
        "status": "passed",
        "verificationClass": "FUNCTIONAL_CHECK",
        "cleanupStatus": "passed",
    }
    return manifest


def development_result(gate_id: str) -> dict[str, object]:
    run_id = "20261006T120000000000Z-" + ("b" * 32)
    return {
        "artifactKind": "development-functional-result",
        "id": gate_id,
        "status": "passed",
        "developmentRunId": run_id,
        "developmentManifest": {
            "artifactKind": "acceptance-artifact-ref",
            "workspaceId": "0123456789abcdef",
            "gateId": gate_id,
            "runId": run_id,
            "path": "manifest.json",
            "sha256": "c" * 64,
            "mediaType": "application/json",
        },
    }


class FakeStore:
    workspace_id = "0123456789abcdef"

    def __init__(self, manifests: dict[str, dict[str, object]]) -> None:
        self.manifests = manifests
        self.latest_calls = 0

    def latest(self, gate_id: str) -> dict[str, object]:
        self.latest_calls += 1
        if gate_id not in self.manifests:
            raise EvidenceManifestInvalid(
                f"latest pointer is unavailable for {gate_id}"
            )
        return self.manifests[gate_id]

    def read_json(self, reference: object) -> dict[str, object]:
        gate_id = getattr(reference, "gate_id", "")
        if gate_id not in self.manifests:
            raise EvidenceManifestInvalid(
                f"immutable manifest is unavailable for {gate_id}"
            )
        return self.manifests[gate_id]


class StationAccessSessionClassGateTest(unittest.TestCase):
    def setUp(self) -> None:
        self.manifests = {
            spec.gate_id: passing_manifest(spec.gate_id)
            for spec in session_class_e2e.PRECEDING_GATES
        }
        self.store = FakeStore(self.manifests)

    def evaluate(self) -> session_class_e2e.AggregateResult:
        return session_class_e2e.AggregateResult(
            source=EXPECTED_SOURCE,
            gates=[
                session_class_e2e.check_gate(
                    self.store,
                    spec,
                    expected_source=EXPECTED_SOURCE,
                )
                for spec in session_class_e2e.PRECEDING_GATES
            ],
        )

    def test_requires_all_three_native_session_class_branches(self) -> None:
        self.assertEqual(
            [
                (spec.acceptance_id, spec.gate_id)
                for spec in session_class_e2e.PRECEDING_GATES
            ],
            [
                ("SAL-G05", "chat-native-multi-device-e2e"),
                (
                    "SAL-G05",
                    "chat-lifecycle-mixed-client-multi-device-e2e",
                ),
                ("SAL-G05", "mobile-simulator-station-lifecycle-e2e"),
            ],
        )

    def test_current_proven_manifests_pass(self) -> None:
        result = self.evaluate()

        self.assertTrue(result.passed)
        report = session_class_e2e.build_report(result)
        self.assertEqual(report["status"], "PASS")
        self.assertEqual(report["completionStatus"], "DONE")
        self.assertEqual(report["proofStatus"], "PROVEN")
        self.assertEqual(report["passedCount"], 3)

    def test_current_development_results_use_immutable_manifests(self) -> None:
        manifests = {
            spec.gate_id: development_manifest(spec.gate_id)
            for spec in session_class_e2e.PRECEDING_GATES
        }
        store = FakeStore(manifests)
        raw = json.dumps(
            {
                "source": EXPECTED_SOURCE,
                "results": [
                    development_result(spec.gate_id)
                    for spec in session_class_e2e.PRECEDING_GATES
                ],
            }
        )

        current_results, proof_status = session_class_e2e.load_current_results(
            raw,
            expected_source=EXPECTED_SOURCE,
        )
        self.assertIsNotNone(current_results)
        aggregate = session_class_e2e.AggregateResult(
            source=EXPECTED_SOURCE,
            proof_status=proof_status,
            gates=[
                session_class_e2e.check_gate(
                    store,
                    spec,
                    expected_source=EXPECTED_SOURCE,
                    current_result=current_results[spec.gate_id],
                    current_results_authoritative=True,
                )
                for spec in session_class_e2e.PRECEDING_GATES
            ],
        )

        self.assertTrue(aggregate.passed)
        self.assertEqual(store.latest_calls, 0)
        report = session_class_e2e.build_report(aggregate)
        self.assertEqual(report["status"], "PASS")
        self.assertEqual(report["proofStatus"], "NOT_APPLICABLE")
        self.assertFalse(report["sampleEmissionAllowed"])

    def test_current_results_source_mismatch_fails_closed(self) -> None:
        raw = json.dumps(
            {
                "source": {**EXPECTED_SOURCE, "commit": "c" * 40},
                "results": [],
            }
        )

        with self.assertRaisesRegex(
            session_class_e2e.GateError,
            "do not match the exact source",
        ):
            session_class_e2e.load_current_results(
                raw,
                expected_source=EXPECTED_SOURCE,
            )

    def test_missing_or_stale_evidence_is_unproven(self) -> None:
        target = session_class_e2e.PRECEDING_GATES[0]
        del self.manifests[target.gate_id]

        result = self.evaluate()

        self.assertFalse(result.passed)
        self.assertTrue(result.unproven)
        self.assertEqual(result.gates[0].status, "MISSING")

        self.manifests[target.gate_id] = passing_manifest(
            target.gate_id,
            source={**EXPECTED_SOURCE, "commit": "c" * 40},
        )
        result = self.evaluate()
        self.assertEqual(result.gates[0].status, "STALE")

    def test_non_proven_result_fails_closed(self) -> None:
        target = session_class_e2e.PRECEDING_GATES[1]
        self.manifests[target.gate_id] = passing_manifest(
            target.gate_id,
            proof_status="UNPROVEN",
        )

        result = self.evaluate()

        self.assertFalse(result.passed)
        self.assertFalse(result.unproven)
        self.assertEqual(result.gates[1].status, "FAIL")

    def test_invalid_manifest_identity_is_unproven(self) -> None:
        target = session_class_e2e.PRECEDING_GATES[2]
        self.manifests[target.gate_id] = {
            **passing_manifest(target.gate_id),
            "workspaceId": "fedcba9876543210",
        }

        result = self.evaluate()

        self.assertFalse(result.passed)
        self.assertTrue(result.unproven)
        self.assertEqual(result.gates[2].status, "ERROR")

    def test_dirty_aggregate_source_is_unproven(self) -> None:
        result = session_class_e2e.AggregateResult(
            source={
                **EXPECTED_SOURCE,
                "workspaceDigest": "sha256:" + ("d" * 64),
            },
            gates=[],
        )

        self.assertFalse(result.passed)
        self.assertTrue(result.unproven)
        self.assertEqual(
            session_class_e2e.build_report(result)["status"],
            "UNPROVEN",
        )

    def test_gate_records_every_preceding_result(self) -> None:
        gate = session_class_e2e.StationAccessSessionClassGate(
            store=self.store,
            expected_source=EXPECTED_SOURCE,
        )

        result = gate.run()

        self.assertEqual(result, {"gateCount": 3, "passedCount": 3})
        self.assertEqual(len(gate.report.assertions), 3)


if __name__ == "__main__":
    unittest.main()
