from __future__ import annotations

import unittest

from tooling.acceptance.core import EvidenceManifestInvalid
from tooling.acceptance.gates.station_access import relay_aggregate


EXPECTED_SOURCE = {
    "commit": "a" * 40,
    "workspaceDigest": "clean",
    "canonicalWorktreeHash": "0123456789abcdef",
}


def passing_manifest(
    gate_id: str,
    *,
    source: dict[str, str] | None = None,
) -> dict[str, object]:
    return {
        "artifactKind": "acceptance-run-manifest",
        "state": "DURABLE",
        "workspaceId": "0123456789abcdef",
        "gateId": gate_id,
        "runId": "20261008T120000000000Z-" + ("b" * 32),
        "source": source or EXPECTED_SOURCE,
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
        self.calls: list[tuple[str, str | None]] = []

    def latest(
        self,
        gate_id: str,
        *,
        runtime_cell: str | None = None,
    ) -> dict[str, object]:
        self.calls.append((gate_id, runtime_cell))
        if gate_id not in self.manifests:
            raise EvidenceManifestInvalid(
                f"latest pointer is unavailable for {gate_id}"
            )
        return self.manifests[gate_id]


class RelayAggregateTest(unittest.TestCase):
    def test_security_aggregate_requires_all_security_owners(self) -> None:
        self.assertEqual(
            [spec.gate_id for spec in relay_aggregate.SECURITY_GATES],
            [
                "relay-role-security-contract",
                "relay-station-enrollment-e2e",
                "relay-endpoint-discovery-contract",
                "relay-opaque-tunnel-e2e",
            ],
        )

    def test_unified_aggregate_uses_runtime_cell_pointers(self) -> None:
        manifests = {
            spec.gate_id: passing_manifest(spec.gate_id)
            for spec in relay_aggregate.UNIFIED_GATES
        }
        store = FakeStore(manifests)
        gate = relay_aggregate.UnifiedRelayAggregateGate(
            store=store,
            expected_source=EXPECTED_SOURCE,
        )

        result = gate.run()

        self.assertEqual(
            result["passedCount"],
            len(relay_aggregate.UNIFIED_GATES),
        )
        self.assertIn(
            (
                "station-access-desktop-relay-native-e2e",
                "desktop-macos-native",
            ),
            store.calls,
        )
        self.assertIn(
            (
                "station-access-desktop-relay-windows-e2e",
                "desktop-windows-native",
            ),
            store.calls,
        )

    def test_stale_or_missing_evidence_fails_closed(self) -> None:
        specs = relay_aggregate.SECURITY_GATES
        manifests = {
            spec.gate_id: passing_manifest(spec.gate_id)
            for spec in specs
        }
        manifests[specs[0].gate_id] = passing_manifest(
            specs[0].gate_id,
            source={**EXPECTED_SOURCE, "commit": "c" * 40},
        )
        del manifests[specs[1].gate_id]
        store = FakeStore(manifests)
        results = [
            relay_aggregate.check_gate(
                store,
                spec,
                expected_source=EXPECTED_SOURCE,
            )
            for spec in specs
        ]

        self.assertEqual(results[0].status, "STALE")
        self.assertEqual(results[1].status, "MISSING")
        with self.assertRaisesRegex(Exception, "incomplete"):
            relay_aggregate.RelaySecurityAggregateGate(
                store=store,
                expected_source=EXPECTED_SOURCE,
            ).run()


if __name__ == "__main__":
    unittest.main()
