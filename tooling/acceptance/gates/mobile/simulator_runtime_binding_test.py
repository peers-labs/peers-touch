from __future__ import annotations

import inspect
import unittest
from collections.abc import Mapping

from tooling.acceptance.core import ArtifactRef, DriverError
from tooling.acceptance.gates.mobile.simulator_runtime_binding import (
    CAPABILITY_ID,
    DEFAULT_GATE_ID,
    MobileSimulatorRuntimeBinding,
    validate_scope_projection,
)


RUN_ID = "20260909T120000000000Z-" + ("1" * 32)
WORKSPACE_ID = "a" * 16


def scope(
    *,
    generation: int = 3,
    station_peer_id: str = "station-peer-primary",
    actor_ptid: str | None = None,
    launch_state: str | None = None,
) -> dict[str, object]:
    active = actor_ptid is not None
    return {
        "generation": generation,
        "phase": "ACTIVE",
        "launchState": launch_state or (
            "shell" if active else "station-selection"
        ),
        "activeStationPeerId": station_peer_id,
        "activeActorPtid": actor_ptid,
        "runtimeStationPeerId": station_peer_id if active else None,
        "deviceIdentityDigest": "d" * 64 if active else None,
        "social": {
            "stationPeerId": station_peer_id if active else None,
            "actorPtid": actor_ptid,
            "sessionCount": 1 if active else 0,
            "requestCount": 0,
            "messageThreadCount": 0,
        },
        "navigation": {
            "primaryRouteId": "tab:chat",
            "detailKeys": [],
            "overlayRouteId": None,
        },
    }


def proof_ref(
    client_id: str,
    generation: int,
    binding_role: str,
    gate_id: str = DEFAULT_GATE_ID,
) -> dict[str, object]:
    return ArtifactRef(
        workspace_id=WORKSPACE_ID,
        gate_id=gate_id,
        run_id=RUN_ID,
        path=(
            "runtime/mobile-simulator/bindings/"
            f"{client_id}/{generation}/{binding_role}.json"
        ),
        sha256="b" * 64,
        media_type="application/json",
    ).to_dict()


class RecordingClient:
    def __init__(self, gate_id: str = DEFAULT_GATE_ID) -> None:
        self.calls: list[
            tuple[str, str, dict[str, object], float]
        ] = []
        self.closed = False
        self.gate_id = gate_id
        self.generations = {"sim-ios": 0, "sim-ios-peer": 0}

    def invoke(
        self,
        capability_id: str,
        operation: str,
        payload: Mapping[str, object],
        *,
        timeout_seconds: float,
    ) -> Mapping[str, object]:
        request = dict(payload)
        self.calls.append(
            (capability_id, operation, request, timeout_seconds)
        )
        client_id = str(request["clientId"])
        if operation == "create_bound_session":
            self.generations[client_id] += 1
            generation = self.generations[client_id]
            binding_roles = (
                ("station-primary", "station-secondary")
                if client_id == "sim-ios"
                else ("station-primary",)
            )
            active_binding_role = binding_roles[0]
            station_peer_id = f"peer-{active_binding_role}"
            return {
                "clientId": client_id,
                "launchGeneration": generation,
                "identity": {
                    "runtime": "tauri-ios-simulator",
                    "instanceId": f"{client_id}-binding-{generation}",
                    "identityDigest": "c" * 64,
                },
                "scope": scope(
                    generation=generation,
                    station_peer_id=station_peer_id,
                ),
                "activeBindingRole": active_binding_role,
                "bindingProofs": {
                    binding_role: proof_ref(
                        client_id,
                        generation,
                        binding_role,
                        self.gate_id,
                    )
                    for binding_role in binding_roles
                },
            }
        if operation == "select_binding":
            binding_role = str(request["bindingRole"])
            generation = self.generations[client_id]
            return {
                "clientId": client_id,
                "bindingRole": binding_role,
                "launchGeneration": generation,
                "scope": scope(
                    generation=generation + 1,
                    station_peer_id=f"peer-{binding_role}",
                ),
                "bindingProof": proof_ref(
                    client_id,
                    generation,
                    binding_role,
                    self.gate_id,
                ),
                "remoteRevocation": "confirmed",
            }
        if operation == "begin_access_gate":
            return {
                "clientId": client_id,
                "value": {
                    "decision": {"attemptId": "attempt-1"},
                    "scope": scope(
                        launch_state="access-gate-chain",
                    ),
                },
            }
        if operation == "authenticate_fixture_actor":
            return {
                "clientId": client_id,
                "value": {
                    "preAuthenticationScope": scope(
                        launch_state="access-gate-chain",
                    ),
                    "login": {
                        "decision": {
                            "state": "ACCESS_DECISION_STATE_GRANTED",
                        },
                        "session": {
                            "stationPeerId": "station-peer-primary",
                            "actorPtid": "ptid:alice",
                        },
                    },
                },
            }
        if operation == "harness_action":
            return {
                "clientId": client_id,
                "value": (
                    scope()
                    if request["action"] == "lifecycle.scope.read"
                    else {"ok": True}
                ),
            }
        if operation == "stop":
            return {"clientId": client_id, "stopped": True}
        raise AssertionError(operation)

    def close(self) -> None:
        self.closed = True


class MobileSimulatorRuntimeBindingTests(unittest.TestCase):
    def test_constructor_has_no_raw_authority_inputs(self) -> None:
        parameters = inspect.signature(
            MobileSimulatorRuntimeBinding
        ).parameters

        self.assertEqual(set(parameters), {"client", "gate_id"})
        for forbidden in (
            "server_url",
            "device_id",
            "artifact_path",
            "station_endpoint",
        ):
            self.assertNotIn(forbidden, parameters)

    def test_create_bound_session_sends_only_closed_launch_options(self) -> None:
        client = RecordingClient()
        binding = MobileSimulatorRuntimeBinding(client)  # type: ignore[arg-type]

        activation = binding.create_bound_session("sim-ios")

        capability, operation, payload, timeout = client.calls[0]
        self.assertEqual(capability, CAPABILITY_ID)
        self.assertEqual(operation, "create_bound_session")
        self.assertEqual(
            payload,
            {
                "clientId": "sim-ios",
                "launchOptions": {},
            },
        )
        self.assertNotIn("bindingRole", payload)
        self.assertNotIn("url", repr(payload).lower())
        self.assertNotIn("device", repr(payload).lower())
        self.assertNotIn("artifact", repr(payload).lower())
        self.assertGreaterEqual(timeout, 180.0)
        self.assertEqual(activation.launch_generation, 1)
        self.assertEqual(
            activation.scope["activeStationPeerId"],
            "peer-station-primary",
        )
        self.assertEqual(
            set(activation.binding_proofs),
            {"station-primary", "station-secondary"},
        )
        self.assertIsInstance(
            activation.binding_proofs["station-primary"],
            ArtifactRef,
        )

    def test_select_binding_reuses_the_current_launch_generation(self) -> None:
        client = RecordingClient()
        binding = MobileSimulatorRuntimeBinding(client)  # type: ignore[arg-type]
        activation = binding.create_bound_session("sim-ios")

        selection = binding.select_binding(
            "sim-ios",
            "station-secondary",
        )

        self.assertEqual(
            selection.launch_generation,
            activation.launch_generation,
        )
        self.assertEqual(
            selection.scope["activeStationPeerId"],
            "peer-station-secondary",
        )
        self.assertEqual(selection.remote_revocation, "confirmed")
        _, operation, payload, _ = client.calls[-1]
        self.assertEqual(operation, "select_binding")
        self.assertEqual(
            payload,
            {
                "clientId": "sim-ios",
                "bindingRole": "station-secondary",
            },
        )

    def test_topology_actions_are_not_child_callable(self) -> None:
        binding = MobileSimulatorRuntimeBinding(  # type: ignore[arg-type]
            RecordingClient()
        )

        for action in (
            "access.submit",
            "station.add",
            "station.select",
            "projection.read",
        ):
            with self.subTest(action=action):
                with self.assertRaisesRegex(
                    DriverError,
                    "not callable",
                ):
                    binding.call_action("sim-ios", action, {})

    def test_recovery_snapshot_is_child_callable(self) -> None:
        client = RecordingClient()
        binding = MobileSimulatorRuntimeBinding(client)  # type: ignore[arg-type]

        self.assertEqual(
            binding.call_action("sim-ios", "recovery.snapshot", {}),
            {"ok": True},
        )
        _, operation, payload, _ = client.calls[-1]
        self.assertEqual(operation, "harness_action")
        self.assertEqual(
            payload,
            {
                "clientId": "sim-ios",
                "action": "recovery.snapshot",
                "actionPayload": {},
            },
        )

    def test_federation_read_actions_are_child_callable(self) -> None:
        client = RecordingClient()
        binding = MobileSimulatorRuntimeBinding(client)  # type: ignore[arg-type]

        for action, payload in (
            ("lifecycle.waitReady", {}),
            ("federation.context.read", {}),
            (
                "social.people.search",
                {
                    "query": "@alice@station.example",
                    "federationId": "federation-1",
                },
            ),
        ):
            with self.subTest(action=action):
                self.assertEqual(
                    binding.call_action("sim-ios", action, payload),
                    {"ok": True},
                )

    def test_fixture_authentication_keeps_credentials_parent_owned(self) -> None:
        client = RecordingClient()
        binding = MobileSimulatorRuntimeBinding(client)  # type: ignore[arg-type]
        binding.create_bound_session("sim-ios")

        result = binding.authenticate_fixture_actor("sim-ios")

        _, operation, payload, _ = client.calls[-1]
        self.assertEqual(operation, "authenticate_fixture_actor")
        self.assertEqual(payload, {"clientId": "sim-ios"})
        self.assertNotIn("password", repr(payload).lower())
        self.assertEqual(
            result["preAuthenticationScope"]["launchState"],
            "access-gate-chain",
        )

    def test_scope_rejects_raw_endpoint_or_device_authority(self) -> None:
        for field in ("url", "serverUrl", "deviceId", "artifact"):
            invalid = scope()
            invalid[field] = "raw-authority"
            with self.subTest(field=field):
                with self.assertRaisesRegex(
                    DriverError,
                    "raw runtime authority",
                ):
                    validate_scope_projection(invalid)

    def test_scope_rejects_retired_standalone_group_projection(self) -> None:
        invalid = scope()
        invalid["group"] = {
            "stationPeerId": "station-peer-primary",
            "actorPtid": "ptid:alice",
            "groupCount": 0,
            "messageThreadCount": 0,
        }

        with self.assertRaisesRegex(DriverError, "invalid shape"):
            validate_scope_projection(invalid)

    def test_cleanup_stops_clients_in_reverse_activation_order(self) -> None:
        client = RecordingClient()
        binding = MobileSimulatorRuntimeBinding(client)  # type: ignore[arg-type]
        binding.create_bound_session("sim-ios")
        binding.create_bound_session("sim-ios-peer")

        stopped = binding.close()

        stop_clients = [
            payload["clientId"]
            for _, operation, payload, _ in client.calls
            if operation == "stop"
        ]
        self.assertEqual(
            stop_clients,
            ["sim-ios-peer", "sim-ios"],
        )
        self.assertEqual(stopped, ("sim-ios-peer", "sim-ios"))
        self.assertTrue(client.closed)

    def test_binding_proofs_are_scoped_to_the_requested_gate(self) -> None:
        client = RecordingClient()
        binding = MobileSimulatorRuntimeBinding(  # type: ignore[arg-type]
            client,
            gate_id="mobile-simulator-settings-e2e",
        )

        with self.assertRaisesRegex(DriverError, "wrong Gate"):
            binding.create_bound_session("sim-ios")

    def test_binding_accepts_proofs_for_a_second_allowed_gate(self) -> None:
        gate_id = "mobile-simulator-settings-e2e"
        client = RecordingClient(gate_id)
        binding = MobileSimulatorRuntimeBinding(  # type: ignore[arg-type]
            client,
            gate_id=gate_id,
        )

        activation = binding.create_bound_session("sim-ios")

        self.assertEqual(
            {reference.gate_id for reference in activation.binding_proofs.values()},
            {gate_id},
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
