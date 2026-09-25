from __future__ import annotations

import unittest
from types import SimpleNamespace

from tooling.acceptance.core import GateError
from tooling.acceptance.gates.station_access.auth_e2e import (
    REQUIRED_ASSERTIONS,
    StationAccessAuthGate,
)


class _FakeBinding:
    def binding_proof_evidence(self) -> dict[str, object]:
        return {
            "proofRefs": [{"path": "desktop-binding.json"}],
            "allocatedGenerations": {"desktop-bob": 2},
            "proofCount": 2,
        }

    def proof_refs(self) -> tuple[dict[str, str], ...]:
        return ({"path": "desktop-binding.json"},)


class _FakeRuntime:
    def __init__(self, *, leak_pre_auth_actor: bool = False) -> None:
        self.manifest = {"environmentId": "chat-mixed-native"}
        self.desktop_binding = _FakeBinding()
        self._mobile_generation = 3
        self._leak_pre_auth_actor = leak_pre_auth_actor
        self._identities = {
            "desktop-bob": SimpleNamespace(
                station_service_id="station-secondary",
                station_peer_id="station-peer",
                ptid="ptid:example:bob",
                device_id="desktop-device-digest",
            ),
            "sim-ios": SimpleNamespace(
                station_service_id="station-secondary",
                station_peer_id="station-peer",
                ptid="ptid:example:bob",
                device_id="mobile-device-digest",
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
        return self._identities[client_id]

    def access_snapshot(self, client_id: str) -> dict[str, object]:
        if client_id == "desktop-bob":
            return {
                "preAuthentication": {
                    "authenticated": False,
                    "actorPtid": (
                        "ptid:example:stale"
                        if self._leak_pre_auth_actor
                        else ""
                    ),
                },
                "bindingProofRefs": [{"path": "desktop-binding.json"}],
            }
        return {
            "preAuthentication": {
                "activeStationPeerId": "station-peer",
                "activeActorPtid": None,
                "runtimeStationPeerId": None,
            },
            "bindingProofRefs": [{"path": "mobile-binding.json"}],
        }

    def scope_snapshot(self, client_id: str) -> dict[str, object]:
        if client_id == "desktop-bob":
            return {
                "phase": "authenticated",
                "authenticated": True,
                "stationPeerId": "station-peer",
                "actorPtid": "ptid:example:bob",
                "deviceIdentityDigest": "desktop-device-digest",
            }
        return {
            "phase": "ACTIVE",
            "launchState": "shell",
            "generation": self._mobile_generation,
            "stationPeerId": "station-peer",
            "runtimeStationPeerId": "station-peer",
            "actorPtid": "ptid:example:bob",
            "deviceIdentityDigest": "mobile-device-digest",
        }

    def restart_desktop_session(
        self,
        client_id: str,
        *,
        window_slot: int,
        window_count: int,
        timeout_seconds: float,
    ) -> dict[str, object]:
        del client_id, window_slot, window_count, timeout_seconds
        return self.scope_snapshot("desktop-bob")

    def restart_client(
        self,
        client_id: str,
        *,
        timeout_seconds: float,
    ) -> None:
        del client_id, timeout_seconds
        self._mobile_generation += 1

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


class StationAccessAuthGateTest(unittest.TestCase):
    def test_accepts_source_bound_native_scope(self) -> None:
        gate = StationAccessAuthGate(runtime=_FakeRuntime())
        result = gate.run()
        self.assertEqual(
            {assertion.name for assertion in gate.report.assertions},
            REQUIRED_ASSERTIONS,
        )
        self.assertEqual(result["actorPtid"], "ptid:example:bob")

    def test_rejects_actor_projection_before_credentials(self) -> None:
        gate = StationAccessAuthGate(
            runtime=_FakeRuntime(leak_pre_auth_actor=True)
        )
        with self.assertRaisesRegex(
            GateError,
            "signed_station_bound_before_credentials",
        ):
            gate.run()


if __name__ == "__main__":
    unittest.main()
