from __future__ import annotations

import unittest
from types import SimpleNamespace

from tooling.acceptance.core import ActorRuntime, GateError
from tooling.acceptance.gates.station_access.federation_boundary_e2e import (
    GATE_ID,
    REQUIRED_ASSERTIONS,
    StationAccessFederationBoundaryGate,
    validate_ordinary_client_boundary,
)


class _FakeRuntime:
    def __init__(self, *, contexts: list[dict[str, str]] | None = None) -> None:
        self.manifest = {"environmentId": "station-access-native"}
        self.desktop_binding = SimpleNamespace()
        self.identities: dict[str, SimpleNamespace] = {}
        self.calls: list[tuple[str, str, dict[str, object]]] = []
        self.contexts = (
            [
                {
                    "federationId": "fed-1",
                    "name": "Development",
                    "status": "active",
                }
            ]
            if contexts is None
            else contexts
        )
        self._identities = {
            "desktop-alice": SimpleNamespace(
                station_peer_id="station-peer",
                ptid="ptid:example:alice",
                federation_id="fed-1",
            ),
            "sim-ios": SimpleNamespace(
                station_peer_id="station-peer",
                ptid="ptid:example:bob",
                federation_id="fed-1",
            ),
        }

    def start_client(
        self,
        client_id: str,
        *,
        window_slot: int,
        window_count: int,
    ) -> SimpleNamespace:
        del window_slot, window_count
        identity = self._identities[client_id]
        self.identities[client_id] = identity
        return identity

    def actor_runtime(self, client_id: str) -> ActorRuntime:
        return ActorRuntime(name=client_id, runtime="test")

    @staticmethod
    def wait_until(predicate, _description: str, *, timeout_seconds: float):
        del timeout_seconds
        value = predicate()
        if value is None:
            raise GateError("condition did not become ready")
        return value

    def actor_fixture(self, client_id: str) -> dict[str, str]:
        fixtures = {
            "desktop-alice": {
                "federatedHandle": "@alice@station.example",
            },
            "sim-ios": {
                "federatedHandle": "@bob@station.example",
            },
        }
        return fixtures[client_id]

    def call_action(
        self,
        client_id: str,
        action: str,
        payload: dict[str, object],
    ) -> object:
        self.calls.append((client_id, action, payload))
        if action in {"federationContext", "federation.context.read"}:
            return {"federations": self.contexts}
        if payload.get("federationId") == "fed-1-outside":
            raise GateError("actor is not visible in the Federation context")
        if action == "searchFederationContext":
            return {
                "entries": [
                    {
                        "actorPtid": "ptid:example:bob",
                        "federationId": payload["federationId"],
                        "homeStationPeerId": "station-peer",
                    }
                ]
            }
        if action == "social.people.search":
            return {
                "entries": [
                    {
                        "ptid": "ptid:example:alice",
                        "federationId": payload["federationId"],
                        "homeStationPeerId": "station-peer",
                    }
                ]
            }
        raise AssertionError(action)

    def create_direct(
        self,
        sender_id: str,
        receiver_id: str,
        *,
        federation_id: str,
        timeout_seconds: float,
    ) -> str:
        del timeout_seconds
        self.calls.append(
            (
                sender_id,
                "create_direct",
                {
                    "receiverId": receiver_id,
                    "federationId": federation_id,
                },
            )
        )
        return "direct-1"

    def create_group(
        self,
        owner_id: str,
        member_ids: tuple[str, ...],
        *,
        federation_id: str,
        name: str,
        timeout_seconds: float,
    ) -> str:
        del timeout_seconds
        self.calls.append(
            (
                owner_id,
                "create_group",
                {
                    "memberIds": list(member_ids),
                    "name": name,
                    "federationId": federation_id,
                },
            )
        )
        return "group-1"

    def source_identity(self) -> dict[str, object]:
        return {
            "orchestrator": {"workspaceDigest": "clean"},
            "desktopRuntimeCell": {"cellId": "desktop-macos-native"},
            "mobileRuntimeCell": "ios-simulator",
        }

    def desktop_session(self, client_id: str) -> None:
        del client_id
        return None

    def cleanup(self, **_: object) -> dict[str, object]:
        return {"cleanupErrors": []}


class StationAccessFederationBoundaryGateTest(unittest.TestCase):
    def test_proves_explicit_context_and_client_boundary(self) -> None:
        runtime = _FakeRuntime()
        gate = StationAccessFederationBoundaryGate(runtime=runtime)

        result = gate.run()

        self.assertEqual(gate.gate_id, GATE_ID)
        self.assertEqual(
            {assertion.name for assertion in gate.report.assertions},
            REQUIRED_ASSERTIONS,
        )
        self.assertEqual(result["federationId"], "fed-1")
        self.assertIn(
            (
                "desktop-alice",
                "searchFederationContext",
                {"federationId": "fed-1", "prefix": "bob"},
            ),
            runtime.calls,
        )
        self.assertIn(
            (
                "sim-ios",
                "social.people.search",
                {
                    "query": "@alice@station.example",
                    "federationId": "fed-1",
                },
            ),
            runtime.calls,
        )
        self.assertIn(
            (
                "desktop-alice",
                "create_direct",
                {
                    "receiverId": "sim-ios",
                    "federationId": "fed-1",
                },
            ),
            runtime.calls,
        )

    def test_selects_one_shared_active_context_from_multiple(self) -> None:
        runtime = _FakeRuntime(contexts=[
            {
                "federationId": "fed-2",
                "name": "Second",
                "status": "active",
            },
            {
                "federationId": "fed-1",
                "name": "First",
                "status": "active",
            },
        ])

        result = StationAccessFederationBoundaryGate(
            runtime=runtime,
        ).run()

        self.assertEqual(result["federationId"], "fed-1")

    def test_rejects_missing_federation_context(self) -> None:
        gate = StationAccessFederationBoundaryGate(
            runtime=_FakeRuntime(contexts=[]),
        )
        with self.assertRaisesRegex(
            GateError,
            "Federation contexts must have explicit identities",
        ):
            gate.run()

    def test_rejects_ordinary_client_governance_tokens(self) -> None:
        with self.assertRaisesRegex(
            GateError,
            "ordinary client Federation governance remains",
        ):
            validate_ordinary_client_boundary(
                {
                    "apps/desktop/src/client.ts": (
                        "federation" + "Create()"
                    )
                }
            )

    def test_rejects_ordinary_client_relay_admin_tokens(self) -> None:
        with self.assertRaisesRegex(
            GateError,
            "ordinary client Relay administration remains",
        ):
            validate_ordinary_client_boundary(
                {
                    "apps/mobile/src/client.ts": (
                        "const relay" + "Token = token"
                    )
                }
            )


if __name__ == "__main__":
    unittest.main()
