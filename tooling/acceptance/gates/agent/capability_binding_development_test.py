from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.gates.agent.capability_binding_development import (
    CapabilityBindingDevelopmentError,
    ROOT,
    accepted_seed_profile,
    evaluate_capability_binding,
    seed_native_client_state,
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
        self.assertNotIn("_authenticate_clients(", source)
        self.assertNotIn('"ensureProvider"', source)
        self.assertNotIn("reset_fixture", source)
        self.assertNotIn("CHAT_ACCEPTANCE_RESET", source)

    def test_clones_only_accepted_matching_native_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            seed = root / "seed"
            identity = (
                seed
                / "actor-identity/peers-touch/desktop/data/"
                "secure-store/identity-keys"
            )
            identity.mkdir(parents=True)
            (identity / "actor.key").write_bytes(b"identity")
            storage = seed / "storage"
            storage.mkdir()
            (storage / "device.db").write_bytes(b"device")
            (seed / "journey-result.json").write_text(
                json.dumps({
                    "journey": "V2-J01",
                    "stationUrl": "https://station.example",
                    "status": "FUNCTIONAL_PASS",
                }),
                encoding="utf-8",
            )
            target_identity = root / "target-identity"
            target_storage = root / "target-storage"

            seed_native_client_state(
                seed_root=seed,
                target_storage_root=target_storage,
                target_root=target_identity,
                station_url="https://station.example/",
            )

            self.assertEqual(
                (
                    target_identity
                    / "peers-touch/desktop/data/secure-store/"
                    "identity-keys/actor.key"
                ).read_bytes(),
                b"identity",
            )
            self.assertEqual(
                (target_storage / "device.db").read_bytes(),
                b"device",
            )

    def test_derives_the_single_accepted_seed_profile(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "storage/peers-touch/desktop").mkdir(parents=True)
            (root / "storage/peers-touch/two-v2-j01").mkdir()

            self.assertEqual(
                accepted_seed_profile(root),
                "two-v2-j01",
            )

    def test_rejects_unproven_actor_identity_seed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            seed = root / "seed"
            identity = seed / "actor-identity/identity-keys"
            identity.mkdir(parents=True)
            (identity / "actor.key").write_bytes(b"identity")
            (seed / "journey-result.json").write_text(
                json.dumps({
                    "journey": "V2-J01",
                    "stationUrl": "https://station.example",
                    "status": "FUNCTIONAL_FAIL",
                }),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                CapabilityBindingDevelopmentError,
                "does not match Profile two",
            ):
                seed_native_client_state(
                    seed_root=seed,
                    target_storage_root=root / "target-storage",
                    target_root=root / "target",
                    station_url="https://station.example",
                )


if __name__ == "__main__":
    unittest.main()
