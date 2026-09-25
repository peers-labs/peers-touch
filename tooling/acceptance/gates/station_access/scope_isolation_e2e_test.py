from __future__ import annotations

import unittest
from types import SimpleNamespace

from tooling.acceptance.gates.station_access.scope_isolation_e2e import (
    GATE_ID,
    REQUIRED_ASSERTIONS,
    StationAccessScopeIsolationGate,
)


class _FakeBinding:
    def binding_proof_evidence(self) -> dict[str, object]:
        return {
            "proofRefs": [{"path": "binding.json"}],
            "allocatedGenerations": {},
            "proofCount": 4,
        }

    def proof_refs(self) -> tuple[dict[str, str], ...]:
        return ({"path": "binding.json"},)


class _FakeRuntime:
    def __init__(self) -> None:
        self.manifest = {"environmentId": "station-access-native"}
        self.desktop_binding = _FakeBinding()
        self.mobile_generation = 2
        self.mobile_logged_out = False
        self.identities = {
            "desktop-bob": SimpleNamespace(
                station_peer_id="station-peer",
                ptid="ptid:example:bob",
                device_id="desktop-bob-device",
            ),
            "sim-ios": SimpleNamespace(
                station_peer_id="station-peer",
                ptid="ptid:example:bob",
                device_id="mobile-bob-device",
            ),
            "desktop-alice": SimpleNamespace(
                station_peer_id="station-peer",
                ptid="ptid:example:alice",
                device_id="desktop-alice-device",
            ),
            "sim-ios-peer": SimpleNamespace(
                station_peer_id="station-peer",
                ptid="ptid:example:alice",
                device_id="mobile-alice-device",
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
        return self.identities[client_id]

    def scope_snapshot(self, client_id: str) -> dict[str, object]:
        identity = self.identities[client_id]
        if client_id == "sim-ios" and self.mobile_logged_out:
            return {
                "generation": self.mobile_generation,
                "stationPeerId": identity.station_peer_id,
                "runtimeStationPeerId": None,
                "actorPtid": None,
                "social": {
                    "stationPeerId": None,
                    "actorPtid": None,
                    "sessionCount": 0,
                    "requestCount": 0,
                    "messageThreadCount": 0,
                },
            }
        if client_id.startswith("desktop-"):
            return {
                "authenticated": True,
                "stationPeerId": identity.station_peer_id,
                "actorPtid": identity.ptid,
                "deviceIdentityDigest": identity.device_id,
            }
        return {
            "phase": "ACTIVE",
            "launchState": "shell",
            "generation": self.mobile_generation,
            "stationPeerId": identity.station_peer_id,
            "runtimeStationPeerId": identity.station_peer_id,
            "actorPtid": identity.ptid,
            "deviceIdentityDigest": identity.device_id,
        }

    def restart_desktop_session(self, *_: object, **__: object) -> dict[str, object]:
        return self.scope_snapshot("desktop-bob")

    def restart_client(self, *_: object, **__: object) -> None:
        self.mobile_generation += 1

    def call_action(
        self,
        client_id: str,
        action: str,
        payload: dict[str, object],
    ) -> dict[str, object]:
        del client_id, payload
        if action != "session.logout":
            raise AssertionError(action)
        self.mobile_generation += 1
        self.mobile_logged_out = True
        return {"decision": {"state": "ACTION_REQUIRED"}}

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


class StationAccessScopeIsolationGateTest(unittest.TestCase):
    def test_projects_station_access_identity(self) -> None:
        gate = StationAccessScopeIsolationGate(runtime=_FakeRuntime())
        self.assertEqual(gate.gate_id, GATE_ID)
        self.assertEqual(gate.phase, "SAL-01")
        self.assertIn(
            "SAL-C03",
            gate.spec,
        )

    def test_accepts_isolated_native_scopes(self) -> None:
        gate = StationAccessScopeIsolationGate(runtime=_FakeRuntime())
        result = gate.run()
        self.assertEqual(
            {assertion.name for assertion in gate.report.assertions},
            REQUIRED_ASSERTIONS,
        )
        self.assertEqual(result["bobActorPtid"], "ptid:example:bob")
        self.assertEqual(result["aliceActorPtid"], "ptid:example:alice")


if __name__ == "__main__":
    unittest.main()
