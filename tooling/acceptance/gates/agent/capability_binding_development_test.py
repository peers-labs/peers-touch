from __future__ import annotations

import copy
import unittest

from tooling.acceptance.gates.agent.capability_binding_development import (
    CapabilityBindingDevelopmentError,
    ROOT,
    evaluate_capability_binding,
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


if __name__ == "__main__":
    unittest.main()
