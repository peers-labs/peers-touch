from types import SimpleNamespace
import unittest

from tooling.acceptance.core import AcceptanceGate
from tooling.acceptance.gates.station_access.mobile_relay_native_e2e import (
    CLIENT_ID,
    MobileRelayNativeGate,
)


class FakeBinding:
    def __init__(self) -> None:
        self.route_type = "direct"
        self.route_revision = 1

    def create_bound_session(self, client_id: str) -> SimpleNamespace:
        return SimpleNamespace(
            active_binding_role="station",
            scope={
                "activeStationPeerId": "station-a",
                "activeActorPtid": None,
            },
        )

    def authenticate_fixture_actor(self, client_id: str):
        return {
            "preAuthenticationScope": {},
            "login": {
                "session": {
                    "stationPeerId": "station-a",
                    "actorPtid": "ptid:alice",
                }
            },
        }

    def activate_station_route(self, client_id: str, route_type: str):
        self.route_type = route_type
        self.route_revision += 1
        snapshot = self.station_route_snapshot(client_id)
        snapshot["uiEvidence"] = {"artifactId": f"{route_type}-route"}
        return snapshot

    def station_route_snapshot(self, client_id: str):
        active_route_id = (
            "relay-route" if self.route_type == "relay" else "direct-route"
        )
        return {
            "activeStationPeerId": "station-a",
            "entries": [
                {
                    "stationPeerId": "station-a",
                    "activeRouteId": active_route_id,
                    "routeRevision": self.route_revision,
                    "lifecycleGeneration": 1,
                    "routes": [
                        {
                            "routeId": "direct-route",
                            "routeType": "direct",
                            "routeGeneration": 1,
                            "health": "available",
                        },
                        {
                            "routeId": "relay-route",
                            "routeType": "relay",
                            "routeGeneration": 7,
                            "health": "available",
                        },
                    ],
                }
            ],
            "binding": {
                "stationPeerId": "station-a",
                "routeId": active_route_id,
                "routeType": self.route_type,
                "routeGeneration": 7 if self.route_type == "relay" else 1,
                "routeRevision": self.route_revision,
            },
        }

    def call_action(self, client_id: str, action: str, payload=None):
        if action == "lifecycle.scope.read":
            return {
                "activeStationPeerId": "station-a",
                "activeActorPtid": "ptid:alice",
            }
        if action == "settings.profile.read":
            return {"actorPtid": "ptid:alice"}
        if action == "lifecycle.restart":
            return {"requested": True, "scope": "webview"}
        if action == "cleanup":
            return {"clean": True}
        raise AssertionError(action)


class MobileRelayNativeGateTests(unittest.TestCase):
    def test_route_switch_preserves_station_and_actor_scope(self) -> None:
        gate = MobileRelayNativeGate.__new__(MobileRelayNativeGate)
        AcceptanceGate.__init__(gate)
        gate.manifest = {
            "services": {
                "station-primary": {
                    "runtimeIdentity": "station-a",
                },
                "relay": {
                    "endpoint": "https://relay.example",
                },
            }
        }
        gate.events = []
        gate.cleanup = []
        gate.client_active = False

        result = gate._run_journey(FakeBinding())

        self.assertTrue(result["sessionPreserved"])
        self.assertTrue(result["restartRecovered"])
        self.assertEqual(result["lifecycleGeneration"], 1)
        self.assertGreater(result["routeRevision"], 1)

    def test_active_route_rejects_ambiguous_registry(self) -> None:
        with self.assertRaisesRegex(Exception, "ambiguous"):
            MobileRelayNativeGate._active_route(
                {"entries": []},
                "station-a",
            )


if __name__ == "__main__":
    unittest.main()
