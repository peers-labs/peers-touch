from __future__ import annotations

import json
import unittest
from pathlib import Path
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
    MAX_ROUTE_EXPIRY_WAIT_SECONDS,
    MIN_ROUTE_EXPIRY_WAIT_SECONDS,
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
        if action == "lifecycle.waitReady":
            return {
                "phase": "ACTIVE",
                "generation": state["generation"],
                "runtimes": [
                    {
                        "id": "messaging",
                        "status": "ready",
                        "errorKey": None,
                    },
                ],
                "runtimeErrors": [],
            }
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


class DelayedAuthenticatedScopeBinding(FakeBinding):
    def __init__(self) -> None:
        super().__init__()
        self.partial_scope_reads = 0
        self._deferred_client: str | None = None
        self._injected = False

    def call_action(
        self,
        client_id: str,
        action: str,
        payload: dict[str, Any] | None = None,
    ) -> Any:
        value = super().call_action(client_id, action, payload)
        body = dict(payload or {})
        if (
            action == "access.submit"
            and body.get("kind") == "login"
            and client_id == IOS_CLIENT
            and self.clients[client_id]["station"]
            == STATION_PEERS[SECONDARY_BINDING]
            and not self._injected
        ):
            self._deferred_client = client_id
            self._injected = True
        elif (
            action == "lifecycle.scope.read"
            and self._deferred_client == client_id
        ):
            value = dict(value)
            value["runtimeStationPeerId"] = None
            self._deferred_client = None
            self.partial_scope_reads += 1
        return value


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


class FakeExpiryClock:
    def __init__(self) -> None:
        self.now = 100.0
        self.sleeps: list[float] = []

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += MAX_ROUTE_EXPIRY_WAIT_SECONDS


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
        login_count = sum(
            operation == "access.submit"
            and isinstance(payload, dict)
            and payload.get("kind") == "login"
            for operation, _client_id, payload in binding.calls
        )
        readiness_count = sum(
            operation == "lifecycle.waitReady"
            for operation, _client_id, _payload in binding.calls
        )
        self.assertEqual(readiness_count, login_count)

    def test_route_expiry_wait_resumes_session_and_selects_secondary(self) -> None:
        binding = FakeBinding()
        clock = FakeExpiryClock()
        gate = SimulatorStationLifecycleGate(
            binding_factory=lambda: binding,  # type: ignore[arg-type]
            route_expiry_wait_seconds=MIN_ROUTE_EXPIRY_WAIT_SECONDS,
            monotonic=clock.monotonic,
            sleep=clock.sleep,
        )

        result = gate._run_journey(binding)  # type: ignore[arg-type]

        lifecycle_actions = [
            operation
            for operation, client_id, _payload in binding.calls
            if client_id == IOS_CLIENT
            and operation in {"lifecycle.suspend", "lifecycle.resume"}
        ]
        self.assertEqual(
            lifecycle_actions[:2],
            ["lifecycle.suspend", "lifecycle.resume"],
        )
        self.assertEqual(clock.sleeps, [0.25])
        self.assertEqual(
            result["routeExpiry"],
            {
                "waitSeconds": MIN_ROUTE_EXPIRY_WAIT_SECONDS,
                "sameSessionResumed": True,
                "secondaryBindingSelected": True,
            },
        )
        expiry_events = [
            event
            for event in gate.events
            if event["event"].startswith("expired-")
        ]
        self.assertEqual(
            [event["event"] for event in expiry_events],
            [
                "expired-route-resumed-with-same-session",
                "expired-secondary-route-selected",
            ],
        )
        self.assertTrue(
            all(
                event["waitSeconds"] == MIN_ROUTE_EXPIRY_WAIT_SECONDS
                for event in expiry_events
            )
        )

    def test_route_expiry_wait_is_bounded(self) -> None:
        for wait_seconds in (
            MIN_ROUTE_EXPIRY_WAIT_SECONDS - 1,
            MAX_ROUTE_EXPIRY_WAIT_SECONDS + 1,
        ):
            with self.subTest(wait_seconds=wait_seconds):
                with self.assertRaisesRegex(
                    GateError,
                    "must wait 310-360 seconds",
                ):
                    SimulatorStationLifecycleGate(
                        route_expiry_wait_seconds=wait_seconds
                    )

    def test_catalog_requires_route_expiry_observation(self) -> None:
        catalog_path = Path(__file__).resolve().parents[2] / "gates.yaml"
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))

        self.assertEqual(
            catalog["gates"][
                "mobile-simulator-station-lifecycle-e2e"
            ]["argv"][-2:],
            [
                "--route-expiry-wait-seconds",
                str(MIN_ROUTE_EXPIRY_WAIT_SECONDS),
            ],
        )

    def test_execute_claims_only_declared_simulator_slice(self) -> None:
        binding = FakeBinding()
        artifacts = FakeArtifacts()
        clock = FakeExpiryClock()
        gate = SimulatorStationLifecycleGate(
            binding_factory=lambda: binding,  # type: ignore[arg-type]
            route_expiry_wait_seconds=MIN_ROUTE_EXPIRY_WAIT_SECONDS,
            monotonic=clock.monotonic,
            sleep=clock.sleep,
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

    def test_zero_wait_is_diagnostic_not_formal_proof(self) -> None:
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
        self.assertEqual(artifacts.completed["completion_status"], "PARTIAL")
        self.assertEqual(artifacts.completed["proof_status"], "UNPROVEN")
        result = next(
            value
            for path, value, _role in artifacts.writes
            if path.endswith("/result.json")
        )
        self.assertNotIn(
            "expired-route same-session resume and secondary Station selection",
            result["observedScope"],
        )
        self.assertIn(
            "expired-route same-session resume and secondary Station selection",
            result["unprovenScope"],
        )

    def test_journey_waits_for_complete_authenticated_scope(self) -> None:
        binding = DelayedAuthenticatedScopeBinding()
        gate = SimulatorStationLifecycleGate(
            binding_factory=lambda: binding,  # type: ignore[arg-type]
        )

        with patch(
            "tooling.acceptance.gates.mobile."
            "simulator_station_lifecycle_e2e.time.sleep",
        ):
            result = gate._run_journey(binding)  # type: ignore[arg-type]

        self.assertEqual(binding.partial_scope_reads, 1)
        self.assertEqual(len(result["switches"]), SWITCH_COUNT)

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
