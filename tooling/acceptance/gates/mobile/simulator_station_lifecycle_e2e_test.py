from __future__ import annotations

import unittest
from typing import Any
from unittest.mock import patch

from tooling.acceptance.core import ArtifactRef, GateError
from tooling.acceptance.gates.mobile.simulator_runtime_binding import (
    DEFAULT_GATE_ID as GATE_ID,
    MobileSimulatorBindingActivation,
    MobileSimulatorBindingSelection,
)
from tooling.acceptance.gates.mobile.simulator_station_lifecycle_e2e import (
    IOS_CLIENT,
    PEER_IOS_CLIENT,
    PRIMARY_BINDING,
    SECONDARY_BINDING,
    SWITCH_COUNT,
    SimulatorStationLifecycleGate,
)


RUN_ID = "20260909T120000000000Z-" + ("1" * 32)
WORKSPACE_ID = "a" * 16
ALICE_PTIDS = {
    PRIMARY_BINDING: "ptid:alice-primary",
    SECONDARY_BINDING: "ptid:alice-secondary",
}
STATION_PEERS = {
    PRIMARY_BINDING: "station-peer-primary",
    SECONDARY_BINDING: "station-peer-secondary",
}


def binding_proof(
    client_id: str,
    generation: int,
    binding_role: str,
) -> ArtifactRef:
    return ArtifactRef(
        workspace_id=WORKSPACE_ID,
        gate_id=GATE_ID,
        run_id=RUN_ID,
        path=(
            "runtime/mobile-simulator/bindings/"
            f"{client_id}/{generation}/{binding_role}.json"
        ),
        sha256="b" * 64,
        media_type="application/json",
    )


class FakeBinding:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, object]] = []
        self.clients: dict[str, dict[str, Any]] = {}
        self.launch_generations: dict[str, int] = {}
        self.ios_revoked = False
        self.closed = False

    def create_bound_session(
        self,
        client_id: str,
    ) -> MobileSimulatorBindingActivation:
        binding_role = PRIMARY_BINDING
        state = self.clients.setdefault(
            client_id,
            {
                "station": "",
                "actor": None,
                "generation": 0,
                "launchState": "station-selection",
            },
        )
        if state["station"] and state["station"] != STATION_PEERS[binding_role]:
            state["generation"] += 1
        elif not state["station"]:
            state["generation"] = 1
        state["station"] = STATION_PEERS[binding_role]
        state["actor"] = None
        state["launchState"] = "station-selection"
        generation = self.launch_generations.get(client_id, 0) + 1
        self.launch_generations[client_id] = generation
        self.calls.append(("create_bound_session", client_id, {}))
        binding_roles = (
            (PRIMARY_BINDING, SECONDARY_BINDING)
            if client_id == IOS_CLIENT
            else (PRIMARY_BINDING,)
        )
        return MobileSimulatorBindingActivation(
            client_id=client_id,
            launch_generation=generation,
            identity={
                "runtime": "tauri-ios-simulator",
                "instanceId": f"{client_id}-binding-{generation}",
                "identityDigest": "c" * 64,
            },
            scope=self._scope(client_id),
            active_binding_role=binding_role,
            binding_proofs={
                role: binding_proof(client_id, generation, role)
                for role in binding_roles
            },
        )

    def select_binding(
        self,
        client_id: str,
        binding_role: str,
    ) -> MobileSimulatorBindingSelection:
        state = self.clients[client_id]
        remote_revocation = (
            "confirmed" if state["actor"] is not None else "not-required"
        )
        if state["station"] != STATION_PEERS[binding_role]:
            state["generation"] += 1
        state["station"] = STATION_PEERS[binding_role]
        state["actor"] = None
        state["launchState"] = "station-selection"
        generation = self.launch_generations[client_id]
        self.calls.append(("select_binding", client_id, binding_role))
        return MobileSimulatorBindingSelection(
            client_id=client_id,
            binding_role=binding_role,
            launch_generation=generation,
            scope=self._scope(client_id),
            binding_proof=binding_proof(
                client_id,
                generation,
                binding_role,
            ),
            remote_revocation=remote_revocation,
        )

    def call_action(
        self,
        client_id: str,
        action: str,
        payload: dict[str, Any] | None = None,
    ) -> Any:
        body = dict(payload or {})
        self.calls.append((action, client_id, body))
        state = self.clients[client_id]
        if action == "access.submit":
            if body["kind"] == "start":
                state["launchState"] = "access-gate-chain"
                return {
                    "decision": {
                        "attemptId": f"attempt-{client_id}",
                    },
                    "session": None,
                }
            state["actor"] = (
                ALICE_PTIDS[SECONDARY_BINDING]
                if state["station"] == STATION_PEERS[SECONDARY_BINDING]
                else ALICE_PTIDS[PRIMARY_BINDING]
            )
            state["launchState"] = "shell"
            if client_id == PEER_IOS_CLIENT:
                self.ios_revoked = True
            return {
                "decision": {"state": "ACCESS_DECISION_STATE_GRANTED"},
                "session": {
                    "stationPeerId": state["station"],
                    "actorPtid": state["actor"],
                },
            }
        if action == "lifecycle.restart":
            state["generation"] += 1
            return {"requested": True, "scope": "webview"}
        if action == "lifecycle.suspend":
            return {"snapshot": self._scope(client_id)}
        if action == "lifecycle.resume":
            state["generation"] += 1
            if client_id == IOS_CLIENT and self.ios_revoked:
                state["actor"] = None
                state["launchState"] = "station-selection"
                self.ios_revoked = False
            return {"snapshot": self._scope(client_id)}
        if action == "lifecycle.scope.read":
            return self._scope(client_id)
        if action == "session.logout":
            state["generation"] += 1
            state["actor"] = None
            state["launchState"] = "access-gate-chain"
            return {"logout": {"remoteRevocation": "confirmed"}}
        if action == "cleanup":
            state["actor"] = None
            return {"cleaned": True}
        raise AssertionError(action)

    def begin_access_gate(self, client_id: str) -> dict[str, Any]:
        started = self.call_action(
            client_id,
            "access.submit",
            {"kind": "start"},
        )
        return {
            "decision": started["decision"],
            "scope": self._scope(client_id),
        }

    def authenticate_fixture_actor(
        self,
        client_id: str,
    ) -> dict[str, Any]:
        access = self.begin_access_gate(client_id)
        attempt_id = access["decision"]["attemptId"]
        login = self.call_action(
            client_id,
            "access.submit",
            {
                "kind": "login",
                "attemptId": attempt_id,
                "email": "parent-owned",
                "password": "parent-owned",
            },
        )
        return {
            "preAuthenticationScope": access["scope"],
            "login": login,
        }

    def close(self) -> tuple[str, ...]:
        self.closed = True
        stopped = tuple(reversed(tuple(self.clients)))
        self.calls.extend(("stop", client_id, {}) for client_id in stopped)
        return stopped

    def _scope(self, client_id: str) -> dict[str, Any]:
        state = self.clients[client_id]
        actor = state["actor"]
        station = state["station"]
        active = actor is not None
        return {
            "generation": state["generation"],
            "phase": "ACTIVE",
            "launchState": state["launchState"],
            "activeStationPeerId": station,
            "activeActorPtid": actor,
            "runtimeStationPeerId": station if active else None,
            "deviceId": f"device-{client_id}",
            "social": {
                "stationPeerId": station if active else None,
                "actorPtid": actor,
                "sessionCount": 1 if active else 0,
                "requestCount": 0,
                "messageThreadCount": 0,
            },
            "group": {
                "stationPeerId": station if active else None,
                "actorPtid": actor,
                "groupCount": 0,
                "messageThreadCount": 0,
            },
            "navigation": {
                "primaryRouteId": "tab:chat",
                "detailKeys": [],
                "overlayRouteId": None,
            },
        }


class FakeArtifacts:
    def __init__(self) -> None:
        self.writes: list[tuple[str, object, str | None]] = []
        self.completed: dict[str, object] = {}

    def __enter__(self) -> "FakeArtifacts":
        return self

    def __exit__(self, *_args: object) -> None:
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


class SimulatorStationLifecycleGateTests(unittest.TestCase):
    def test_journey_executes_restore_revocation_and_ten_switches(self) -> None:
        binding = FakeBinding()
        gate = SimulatorStationLifecycleGate(
            binding_factory=lambda: binding,  # type: ignore[arg-type]
        )

        result = gate._run_journey(binding)  # type: ignore[arg-type]

        launches = [
            (client_id, payload)
            for operation, client_id, payload in binding.calls
            if operation == "create_bound_session"
        ]
        self.assertEqual(
            launches,
            [
                (IOS_CLIENT, {}),
                (PEER_IOS_CLIENT, {}),
            ],
        )
        selections = [
            (client_id, payload)
            for operation, client_id, payload in binding.calls
            if operation == "select_binding"
        ]
        self.assertEqual(
            selections,
            [
                (IOS_CLIENT, SECONDARY_BINDING),
                *[
                    (
                        IOS_CLIENT,
                        PRIMARY_BINDING
                        if index % 2 == 0
                        else SECONDARY_BINDING,
                    )
                    for index in range(SWITCH_COUNT)
                ],
            ],
        )
        self.assertEqual(len(result["switches"]), SWITCH_COUNT)
        self.assertTrue(
            all(item["oldScopeAbsent"] for item in result["switches"])
        )
        self.assertTrue(
            all(item["authenticated"] for item in result["switches"])
        )
        self.assertTrue(
            all(
                item["remoteRevocation"] == "confirmed"
                for item in result["switches"]
            )
        )
        self.assertEqual(
            [
                event["remoteRevocation"]
                for event in gate.events
                if event["event"] == "binding-selected"
            ][-SWITCH_COUNT:],
            ["confirmed"] * SWITCH_COUNT,
        )
        self.assertIn(
            ("lifecycle.restart", IOS_CLIENT, {}),
            binding.calls,
        )
        self.assertIn(
            ("lifecycle.suspend", IOS_CLIENT, {}),
            binding.calls,
        )
        self.assertIn(
            ("lifecycle.resume", IOS_CLIENT, {}),
            binding.calls,
        )
        self.assertIn(("session.logout", IOS_CLIENT, {}), binding.calls)

    def test_execute_claims_only_declared_simulator_slice(self) -> None:
        binding = FakeBinding()
        artifacts = FakeArtifacts()
        gate = SimulatorStationLifecycleGate(
            binding_factory=lambda: binding,  # type: ignore[arg-type]
        )
        with patch(
            "tooling.acceptance.gates.mobile."
            "simulator_station_lifecycle_e2e.ArtifactSession",
            return_value=artifacts,
        ):
            exit_code = gate.execute()

        self.assertEqual(exit_code, 0)
        self.assertEqual(artifacts.completed["status"], "PASS")
        self.assertEqual(artifacts.completed["completion_status"], "DONE")
        self.assertEqual(artifacts.completed["proof_status"], "PROVEN")
        result = next(
            value
            for path, value, _role in artifacts.writes
            if path.endswith("/result.json")
        )
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["completionStatus"], "DONE")
        self.assertEqual(result["proofStatus"], "PROVEN")
        self.assertEqual(result["spec"][:2], ["AS-04", "AS-10"])
        self.assertIn(
            "W4 command and draft recovery",
            result["unprovenScope"],
        )
        self.assertIn(
            "W5 event-ingress projection convergence",
            result["unprovenScope"],
        )
        self.assertFalse(result["physicalDeviceClaimed"])
        self.assertTrue(binding.closed)

    def test_old_scope_presence_fails_closed(self) -> None:
        scope = FakeBinding()
        scope.clients[IOS_CLIENT] = {
            "station": STATION_PEERS[PRIMARY_BINDING],
            "actor": ALICE_PTIDS[PRIMARY_BINDING],
            "generation": 2,
            "launchState": "access-gate-chain",
        }
        value = scope._scope(IOS_CLIENT)

        with self.assertRaisesRegex(GateError, "old actor scope"):
            SimulatorStationLifecycleGate._assert_cleared_scope(
                value,
                expected_station_peer_id=STATION_PEERS[PRIMARY_BINDING],
                require_access_gate=True,
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
