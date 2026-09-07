from __future__ import annotations

import unittest
from unittest.mock import patch

from tooling.acceptance.core import DriverError
from tooling.acceptance.gates.mobile.simulator_social_e2e import (
    ENVIRONMENT_ID,
    SCENARIO_GATES,
    SimulatorSocialGate,
)


class Artifacts:
    run_id = "20260904T120000000000Z-" + ("1" * 32)

    class Store:
        workspace_id = "a" * 16

    store = Store()

    def __init__(self) -> None:
        self.completed: dict[str, object] = {}
        self.writes: list[tuple[str, object, str | None]] = []

    def __enter__(self) -> "Artifacts":
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def write_json(
        self,
        path: str,
        value: object,
        *,
        role: str | None = None,
    ) -> None:
        self.writes.append((path, value, role))

    def complete(self, **values: object) -> None:
        self.completed = values


class SimulatorSocialGateTests(unittest.TestCase):
    def test_supplemental_gate_never_claims_full_proof(self) -> None:
        artifacts = Artifacts()
        gate = SimulatorSocialGate("social-convergence")
        with (
            patch(
                "tooling.acceptance.gates.mobile.simulator_social_e2e."
                "ArtifactSession",
                return_value=artifacts,
            ),
            patch.object(
                gate,
                "_load_social_manifest",
                return_value={"environmentId": ENVIRONMENT_ID},
            ),
            patch.object(
                gate,
                "_run_social_journey",
                return_value=gate._result_base("PASS"),
            ),
            patch.object(gate, "_cleanup_sessions"),
        ):
            exit_code = gate.execute()

        self.assertEqual(exit_code, 0)
        self.assertEqual(artifacts.completed["status"], "PASS")
        self.assertEqual(artifacts.completed["completion_status"], "PARTIAL")
        self.assertEqual(artifacts.completed["proof_status"], "UNPROVEN")
        result = next(
            value
            for path, value, _role in artifacts.writes
            if path.endswith("/result.json")
        )
        self.assertEqual(
            result["artifactKind"],
            "acceptance-gate-evidence-report",
        )
        self.assertEqual(result["gateId"], gate.gate_id)
        self.assertEqual(result["phase"], "W9-D Social")
        self.assertEqual(result["bom"], ["W5", "W6A", "W9-D"])
        self.assertEqual(result["spec"], ["MS-AG04", "MS-AG06"])
        self.assertEqual(result["gate"], gate.gate_id)
        self.assertFalse(result["physicalDeviceClaimed"])
        self.assertIn("full MS-AG04 and MS-AG06", result["unprovenScope"])

    def test_cleanup_failure_does_not_hide_primary_failure(self) -> None:
        artifacts = Artifacts()
        gate = SimulatorSocialGate("social-convergence")

        def record_cleanup_failure(_artifacts: Artifacts) -> None:
            gate.cleanup.append(
                {
                    "clientId": "sim-ios",
                    "resource": "product-harness",
                    "status": "failed",
                    "errorType": "DriverError",
                }
            )

        with (
            patch(
                "tooling.acceptance.gates.mobile.simulator_social_e2e."
                "ArtifactSession",
                return_value=artifacts,
            ),
            patch.object(
                gate,
                "_load_social_manifest",
                return_value={"environmentId": ENVIRONMENT_ID},
            ),
            patch.object(
                gate,
                "_run_social_journey",
                side_effect=DriverError("station.add failed"),
            ),
            patch.object(
                gate,
                "_cleanup_sessions",
                side_effect=record_cleanup_failure,
            ),
        ):
            exit_code = gate.execute()

        result = next(
            value
            for path, value, _role in artifacts.writes
            if path.endswith("/result.json")
        )
        self.assertEqual(exit_code, 1)
        self.assertEqual(result["reason"], "station.add failed")
        self.assertEqual(
            result["cleanupReason"],
            "simulator social cleanup was incomplete",
        )

    def test_gate_ids_are_stable_and_scenario_specific(self) -> None:
        self.assertEqual(
            SCENARIO_GATES,
            {
                "social-convergence": (
                    "mobile-simulator-social-convergence-e2e"
                ),
                "chat-contacts": "mobile-simulator-chat-contacts-e2e",
            },
        )
        self.assertNotEqual(
            SimulatorSocialGate("social-convergence").gate_id,
            SimulatorSocialGate("chat-contacts").gate_id,
        )

    def test_unknown_scenario_fails_before_runtime_allocation(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported"):
            SimulatorSocialGate("unknown")


if __name__ == "__main__":
    unittest.main()
