from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.gates.agent.capability_binding_development import (
    CapabilityBindingDevelopmentError,
    J02_ACTOR_ACCOUNT,
    ROOT,
    evaluate_capability_binding,
    persist_native_actor_identity,
    seed_native_actor_identity,
)


def valid_capture() -> dict[str, object]:
    return {
        "inventory": {
            "assertions": {
                "knowledgeInventoryVisible": True,
                "bindingAndPolicyCasReadback": True,
                "readinessAndCompatibilityVisible": True,
                "preSendRuntimeSnapshotVisible": True,
                "staleRejectedBeforeExecution": True,
                "disconnectedRejectedBeforeExecution": True,
                "retiredRejectedBeforeExecution": True,
            },
            "cleanup": {"status": "clean"},
        },
        "incompatible": {
            "assertions": {
                "typedIncompatibleCapabilityRejected": True,
                "localizedChooseCompatibleModelRecovery": True,
                "stationReadinessReadback": True,
                "zeroRejectedPathSideEffects": True,
                "replayEqual": True,
                "cleanupComplete": True,
            },
            "receiver-dom": {"visible": True},
            "station-readback": {
                "entityKind": "agent-capability-readiness",
            },
            "cleanup": {"status": "clean"},
        },
    }


class CapabilityBindingDevelopmentTest(unittest.TestCase):
    def test_accepts_complete_native_journey(self) -> None:
        assertions = evaluate_capability_binding(valid_capture())

        self.assertTrue(all(assertions.values()))

    def test_rejects_missing_failure_state_assertion(self) -> None:
        capture = valid_capture()
        capture["inventory"]["assertions"][
            "retiredRejectedBeforeExecution"
        ] = False

        with self.assertRaisesRegex(
            CapabilityBindingDevelopmentError,
            "inventoryBindingAndFailureStates",
        ):
            evaluate_capability_binding(capture)

    def test_rejects_non_native_receiver_evidence(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["incompatible"]["receiver-dom"]["visible"] = False

        with self.assertRaisesRegex(
            CapabilityBindingDevelopmentError,
            "nativeReceiverObserved",
        ):
            evaluate_capability_binding(capture)

    def test_rejects_incomplete_cleanup(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["inventory"]["cleanup"]["status"] = "failed"

        with self.assertRaisesRegex(
            CapabilityBindingDevelopmentError,
            "inventoryCleanup",
        ):
            evaluate_capability_binding(capture)

    def test_runner_uses_canonical_profile_resolution(self) -> None:
        source = (
            ROOT
            / "tooling/acceptance/gates/agent/"
            "capability_binding_development.py"
        ).read_text(encoding="utf-8")

        self.assertIn("machine-dev.mjs", source)
        self.assertIn('"resolve",', source)
        self.assertIn(
            'resolved.get("authority") == "machine-control-plane"',
            source,
        )
        self.assertIn("provisioner._resolve_active_profile = lambda:", source)
        self.assertNotIn(".local/dev/active", source)
        self.assertIn('manifest.state.value == "FIXTURE_READY"', source)
        self.assertIn("authenticate_native_client(client, profile_env)", source)
        self.assertIn('"account": J02_ACTOR_ACCOUNT', source)
        self.assertIn("persist_native_actor_identity(", source)
        self.assertNotIn("_authenticate_clients(", source)
        self.assertNotIn('"ensureProvider"', source)
        self.assertNotIn("reset_fixture", source)
        self.assertNotIn("CHAT_ACCEPTANCE_RESET", source)
        self.assertNotIn("J01_IDENTITY_SEED", source)
        self.assertNotIn("seed_native_client_state", source)
        self.assertIn('"debugCapabilitySnapshot"', source)
        self.assertIn("copy_native_runtime_logs(", source)

    def test_seeds_only_matching_retained_actor_identity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture = root / "fixture"
            identity = (
                fixture
                / "actor-identity/peers-touch/desktop/data/"
                "secure-store/identity-keys"
            )
            identity.mkdir(parents=True)
            (identity / "actor.key").write_text("ab" * 32, encoding="utf-8")
            (fixture / "fixture.json").write_text(
                json.dumps({
                    "schemaVersion": 1,
                    "profile": "two",
                    "account": J02_ACTOR_ACCOUNT,
                    "actorId": "ptid:bob",
                    "stationUrl": "https://station.example",
                }),
                encoding="utf-8",
            )
            target_identity = root / "target-identity"

            metadata = seed_native_actor_identity(
                fixture_root=fixture,
                target_root=target_identity,
                station_url="https://station.example/",
            )

            self.assertEqual(metadata["actorId"], "ptid:bob")
            self.assertEqual(
                (
                    target_identity
                    / "peers-touch/desktop/data/secure-store/"
                    "identity-keys/actor.key"
                ).read_text(encoding="utf-8"),
                "ab" * 32,
            )

    def test_persists_actor_identity_and_rejects_actor_rebinding(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = (
                root
                / "source/peers-touch/desktop/data/"
                "secure-store/identity-keys"
            )
            source.mkdir(parents=True)
            (source / "actor.key").write_text("cd" * 32, encoding="utf-8")
            fixture = root / "fixture"

            metadata = persist_native_actor_identity(
                source_root=root / "source",
                fixture_root=fixture,
                station_url="https://station.example/",
                actor_id="ptid:bob",
            )

            self.assertEqual(metadata["account"], J02_ACTOR_ACCOUNT)
            self.assertEqual(
                (
                    fixture
                    / "actor-identity/peers-touch/desktop/data/"
                    "secure-store/identity-keys/actor.key"
                ).read_text(encoding="utf-8"),
                "cd" * 32,
            )
            with self.assertRaisesRegex(
                CapabilityBindingDevelopmentError,
                "belongs to another actor",
            ):
                persist_native_actor_identity(
                    source_root=root / "source",
                    fixture_root=fixture,
                    station_url="https://station.example",
                    actor_id="ptid:mallory",
                )

    def test_rejects_mismatched_or_malformed_identity_fixture(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture = root / "fixture"
            identity = fixture / "actor-identity/identity-keys"
            identity.mkdir(parents=True)
            (identity / "actor.key").write_text("not-a-key", encoding="utf-8")
            (fixture / "fixture.json").write_text(
                json.dumps({
                    "schemaVersion": 1,
                    "profile": "two",
                    "account": J02_ACTOR_ACCOUNT,
                    "actorId": "ptid:bob",
                    "stationUrl": "https://other-station.example",
                }),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                CapabilityBindingDevelopmentError,
                "does not match Profile two",
            ):
                seed_native_actor_identity(
                    fixture_root=fixture,
                    target_root=root / "target",
                    station_url="https://station.example",
                )
            (fixture / "fixture.json").write_text(
                json.dumps({
                    "schemaVersion": 1,
                    "profile": "two",
                    "account": J02_ACTOR_ACCOUNT,
                    "actorId": "ptid:bob",
                    "stationUrl": "https://station.example",
                }),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(
                CapabilityBindingDevelopmentError,
                "fixture key is invalid",
            ):
                seed_native_actor_identity(
                    fixture_root=fixture,
                    target_root=root / "target",
                    station_url="https://station.example",
                )


if __name__ == "__main__":
    unittest.main()
