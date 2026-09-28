from __future__ import annotations

import unittest

from tooling.acceptance.core import EvidenceManifestInvalid
from tooling.acceptance.gates.chat_storage import batch_clear_aggregate


EXPECTED_SOURCE = {
    "commit": "a" * 40,
    "workspaceDigest": "clean",
    "canonicalWorktreeHash": "0123456789abcdef",
}


def passing_manifest(gate_id: str) -> dict[str, object]:
    return {
        "artifactKind": "acceptance-run-manifest",
        "state": "DURABLE",
        "workspaceId": "0123456789abcdef",
        "gateId": gate_id,
        "runId": "20260927T120000000000Z-" + ("b" * 32),
        "source": EXPECTED_SOURCE,
        "redaction": {"status": "passed"},
        "result": {
            "status": "passed",
            "completionStatus": "DONE",
            "proofStatus": "PROVEN",
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


class ChatStorageBatchClearAggregateTest(unittest.TestCase):
    def setUp(self) -> None:
        self.manifests = {
            spec.gate_id: passing_manifest(spec.gate_id)
            for spec in batch_clear_aggregate.PRECEDING_GATES
        }

    def test_requires_both_batch_clients_builds_and_mobile_regression(self) -> None:
        self.assertEqual(
            [spec.gate_id for spec in batch_clear_aggregate.PRECEDING_GATES],
            [
                "chat-storage-contract",
                "chat-storage-zero-legacy-e2e",
                "chat-storage-desktop-batch-clear-e2e",
                "chat-storage-mobile-batch-clear-e2e",
                "mobile-simulator-chat-contacts-e2e",
                "desktop-release-build",
                "mobile-native-build",
                "acceptance-infra-validation",
            ],
        )

    def test_passes_only_when_every_manifest_matches_exact_source(self) -> None:
        gate = batch_clear_aggregate.ChatStorageBatchClearAggregateGate(
            store=FakeStore(self.manifests),
            expected_source=EXPECTED_SOURCE,
        )

        result = gate.run()

        self.assertEqual(result["passedCount"], len(self.manifests))
        self.assertEqual(len(gate.report.assertions), len(self.manifests))

    def test_missing_evidence_fails_closed(self) -> None:
        missing = batch_clear_aggregate.PRECEDING_GATES[0]
        del self.manifests[missing.gate_id]
        gate = batch_clear_aggregate.ChatStorageBatchClearAggregateGate(
            store=FakeStore(self.manifests),
            expected_source=EXPECTED_SOURCE,
        )

        with self.assertRaisesRegex(
            Exception,
            f"{missing.gate_id}=MISSING",
        ):
            gate.run()


if __name__ == "__main__":
    unittest.main()
