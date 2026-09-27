from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from tooling.acceptance.core import EvidenceManifestInvalid
from tooling.acceptance.gates.chat import lifecycle_ccu_aggregate as aggregate


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
        "runId": "20260924T120000000000Z-" + ("b" * 32),
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


class AggregateContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.manifests = {
            spec.gate_id: passing_manifest(spec.gate_id)
            for spec in aggregate.PRECEDING_GATES
        }
        self.store = FakeStore(self.manifests)

    def evaluate(self) -> aggregate.AggregateResult:
        return aggregate.AggregateResult(
            source=EXPECTED_SOURCE,
            gates=[
                aggregate.check_gate(
                    self.store,
                    spec,
                    expected_source=EXPECTED_SOURCE,
                )
                for spec in aggregate.PRECEDING_GATES
            ],
        )

    def test_requires_exact_chat_g15_through_g21_mapping(self) -> None:
        self.assertEqual(
            [
                (spec.acceptance_id, spec.gate_id)
                for spec in aggregate.PRECEDING_GATES
            ],
            [
                ("CHAT-G15", "messaging-platform-contract"),
                (
                    "CHAT-G16",
                    "chat-lifecycle-mixed-client-same-station-e2e",
                ),
                (
                    "CHAT-G17",
                    "chat-lifecycle-mixed-client-cross-station-e2e",
                ),
                (
                    "CHAT-G18",
                    "chat-lifecycle-mixed-client-multi-device-e2e",
                ),
                ("CHAT-G19", "chat-lifecycle-call-resolution-e2e"),
                (
                    "CHAT-G20",
                    "chat-lifecycle-mixed-client-group-mls-e2e",
                ),
                (
                    "CHAT-G21",
                    "chat-lifecycle-tree-zero-reference-e2e",
                ),
            ],
        )

    def test_all_current_proven_latest_manifests_pass(self) -> None:
        result = self.evaluate()

        self.assertTrue(result.passed)
        self.assertEqual(
            [gate.status for gate in result.gates],
            ["PASS"] * len(aggregate.PRECEDING_GATES),
        )
        report = aggregate.build_report(result)
        self.assertEqual(report["status"], "PASS")
        self.assertEqual(report["completionStatus"], "DONE")
        self.assertEqual(report["proofStatus"], "PROVEN")
        self.assertEqual(report["passedCount"], 7)

    def test_missing_latest_manifest_is_unproven(self) -> None:
        missing = aggregate.PRECEDING_GATES[0]
        del self.manifests[missing.gate_id]

        result = self.evaluate()

        self.assertFalse(result.passed)
        self.assertTrue(result.unproven)
        self.assertEqual(result.gates[0].status, "MISSING")
        self.assertEqual(aggregate.build_report(result)["status"], "UNPROVEN")

    def test_stale_source_manifest_is_unproven(self) -> None:
        stale = aggregate.PRECEDING_GATES[1]
        self.manifests[stale.gate_id] = passing_manifest(
            stale.gate_id,
            source={**EXPECTED_SOURCE, "commit": "c" * 40},
        )

        result = self.evaluate()

        self.assertFalse(result.passed)
        self.assertTrue(result.unproven)
        self.assertEqual(result.gates[1].status, "STALE")

    def test_dirty_aggregate_source_is_unproven(self) -> None:
        result = aggregate.AggregateResult(
            source={
                **EXPECTED_SOURCE,
                "workspaceDigest": "sha256:" + ("d" * 64),
            },
            gates=[],
        )

        self.assertFalse(result.passed)
        self.assertTrue(result.unproven)
        self.assertEqual(aggregate.build_report(result)["status"], "UNPROVEN")

    def test_non_proven_result_fails_closed(self) -> None:
        target = aggregate.PRECEDING_GATES[2]
        for field, value in (
            ("status", "failed"),
            ("completion_status", "PARTIAL"),
            ("proof_status", "UNPROVEN"),
        ):
            with self.subTest(field=field):
                kwargs = {field: value}
                self.manifests[target.gate_id] = passing_manifest(
                    target.gate_id,
                    **kwargs,
                )

                result = self.evaluate()

                self.assertFalse(result.passed)
                self.assertEqual(result.gates[2].status, "FAIL")
                self.manifests[target.gate_id] = passing_manifest(
                    target.gate_id
                )

    def test_invalid_manifest_identity_fails_closed(self) -> None:
        target = aggregate.PRECEDING_GATES[3]
        self.manifests[target.gate_id] = {
            **passing_manifest(target.gate_id),
            "workspaceId": "fedcba9876543210",
        }

        result = self.evaluate()

        self.assertFalse(result.passed)
        self.assertTrue(result.unproven)
        self.assertEqual(result.gates[3].status, "ERROR")

    def test_main_reads_store_and_emits_external_report(self) -> None:
        artifact_session = MagicMock()
        artifact_session.__enter__.return_value = artifact_session
        artifact_session.__exit__.return_value = None
        artifact_session.write_json.return_value = MagicMock()

        with (
            patch.object(
                aggregate.EvidenceStore,
                "from_environment",
                return_value=self.store,
            ),
            patch.object(
                aggregate,
                "source_identity",
                return_value=EXPECTED_SOURCE,
            ),
            patch.object(
                aggregate,
                "ArtifactSession",
                return_value=artifact_session,
            ),
        ):
            self.assertEqual(aggregate.main(), 0)

        artifact_session.write_json.assert_called_once()
        path, report = artifact_session.write_json.call_args.args
        self.assertEqual(path, aggregate.REPORT_RELATIVE_PATH)
        self.assertEqual(report["status"], "PASS")
        self.assertEqual(
            artifact_session.write_json.call_args.kwargs["role"],
            "report",
        )
        artifact_session.complete.assert_called_once_with(
            status="passed",
            completion_status="DONE",
            proof_status="PROVEN",
        )

    def test_module_has_no_source_tree_report_owner(self) -> None:
        source = Path(aggregate.__file__).read_text(encoding="utf-8")

        self.assertNotIn("REPORTS_DIR", source)
        self.assertNotIn("tooling/acceptance/reports", source)
        self.assertNotIn("write_text(", source)


if __name__ == "__main__":
    unittest.main()
