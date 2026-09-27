from __future__ import annotations

import unittest

from tooling.acceptance.core import EvidenceManifestInvalid
from tooling.acceptance.gates.chat_storage import governance_aggregate


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
        "runId": "20260926T120000000000Z-" + ("b" * 32),
        "source": source or EXPECTED_SOURCE,
        "redaction": {"status": "passed"},
        "result": {
            "status": status,
            "completionStatus": completion_status,
            "proofStatus": proof_status,
            "secretScan": {"status": "passed"},
        },
    }


class FakeStore:
    workspace_id = "0123456789abcdef"

    def __init__(self, manifests: dict[str, dict[str, object]]) -> None:
        self.manifests = manifests

    def latest(self, gate_id: str) -> dict[str, object]:
        if gate_id not in self.manifests:
            raise EvidenceManifestInvalid(
                f"latest pointer is unavailable for {gate_id}"
            )
        return self.manifests[gate_id]


class ChatStorageGovernanceAggregateTest(unittest.TestCase):
    def setUp(self) -> None:
        self.manifests = {
            spec.gate_id: passing_manifest(spec.gate_id)
            for spec in governance_aggregate.PRECEDING_GATES
        }
        self.store = FakeStore(self.manifests)

    def evaluate(self) -> governance_aggregate.AggregateResult:
        return governance_aggregate.AggregateResult(
            source=EXPECTED_SOURCE,
            gates=[
                governance_aggregate.check_gate(
                    self.store,
                    spec,
                    expected_source=EXPECTED_SOURCE,
                )
                for spec in governance_aggregate.PRECEDING_GATES
            ],
        )

    def test_requires_complete_chat_storage_gate_set(self) -> None:
        self.assertEqual(
            [spec.gate_id for spec in governance_aggregate.PRECEDING_GATES],
            [
                "chat-storage-contract",
                "chat-storage-accounting-e2e",
                "chat-storage-cache-clear-e2e",
                "chat-storage-retention-e2e",
                "chat-storage-redaction-recovery-e2e",
                "chat-storage-delete-reclaim-e2e",
                "chat-storage-dead-contract-zero-e2e",
                "chat-storage-zero-legacy-e2e",
                "desktop-release-build",
                "mobile-native-build",
            ],
        )

    def test_current_proven_manifests_pass(self) -> None:
        result = self.evaluate()

        self.assertTrue(result.passed)
        report = governance_aggregate.build_report(result)
        self.assertEqual(report["status"], "PASS")
        self.assertEqual(report["proofStatus"], "PROVEN")
        self.assertEqual(
            report["passedCount"],
            len(governance_aggregate.PRECEDING_GATES),
        )

    def test_missing_or_stale_evidence_is_unproven(self) -> None:
        missing = governance_aggregate.PRECEDING_GATES[0]
        del self.manifests[missing.gate_id]
        result = self.evaluate()
        self.assertFalse(result.passed)
        self.assertTrue(result.unproven)
        self.assertEqual(result.gates[0].status, "MISSING")

        self.manifests[missing.gate_id] = passing_manifest(
            missing.gate_id,
            source={**EXPECTED_SOURCE, "commit": "c" * 40},
        )
        result = self.evaluate()
        self.assertEqual(result.gates[0].status, "STALE")

    def test_failed_or_unredacted_evidence_fails_closed(self) -> None:
        target = governance_aggregate.PRECEDING_GATES[1]
        self.manifests[target.gate_id] = passing_manifest(
            target.gate_id,
            status="failed",
        )

        result = self.evaluate()

        self.assertFalse(result.passed)
        self.assertFalse(result.unproven)
        self.assertEqual(result.gates[1].status, "FAIL")

    def test_malformed_evidence_is_unproven(self) -> None:
        target = governance_aggregate.PRECEDING_GATES[1]
        manifest = passing_manifest(target.gate_id)
        manifest["redaction"] = None
        self.manifests[target.gate_id] = manifest

        result = self.evaluate()

        self.assertFalse(result.passed)
        self.assertTrue(result.unproven)
        self.assertEqual(result.gates[1].status, "ERROR")

    def test_gate_records_every_preceding_result(self) -> None:
        gate = governance_aggregate.ChatStorageGovernanceAggregateGate(
            store=self.store,
            expected_source=EXPECTED_SOURCE,
        )
        result = gate.run()

        self.assertEqual(
            result["passedCount"],
            len(governance_aggregate.PRECEDING_GATES),
        )
        self.assertEqual(
            len(gate.report.assertions),
            len(governance_aggregate.PRECEDING_GATES),
        )


if __name__ == "__main__":
    unittest.main()
