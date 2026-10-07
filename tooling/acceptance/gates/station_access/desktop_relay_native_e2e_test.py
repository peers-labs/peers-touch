from __future__ import annotations

import json
import unittest
from unittest.mock import Mock

from tooling.acceptance.core import GateError
from tooling.acceptance.drivers.tauri import TauriSession
from tooling.acceptance.gates.station_access.desktop_relay_native_e2e import (
    MACOS_GATE_ID,
    WINDOWS_GATE_ID,
    expected_runtime_cell,
    station_registry_snapshot,
)


class DesktopRelayNativeGateTest(unittest.TestCase):
    def test_gate_variants_are_closed_over_platform_runtime_cells(self) -> None:
        self.assertEqual(
            expected_runtime_cell(MACOS_GATE_ID),
            "desktop-macos-native",
        )
        self.assertEqual(
            expected_runtime_cell(WINDOWS_GATE_ID),
            "desktop-windows-native",
        )
        with self.assertRaisesRegex(GateError, "unsupported Desktop Relay"):
            expected_runtime_cell("station-access-desktop-relay-linux-e2e")

    def test_registry_snapshot_resolves_station_keyed_active_route(self) -> None:
        session = Mock(spec=TauriSession)
        session.invoke_app_result.return_value = {
            "data": {
                "status": json.dumps(
                    {
                        "active_station_peer_id": "station-peer",
                        "entries": [
                            {
                                "station_peer_id": "station-peer",
                                "active_route_id": "relay-route",
                                "route_revision": 3,
                                "lifecycle_generation": 1,
                                "routes": [
                                    {
                                        "route_id": "direct-route",
                                        "route_type": "direct",
                                        "endpoint_origin": "https://station",
                                    },
                                    {
                                        "route_id": "relay-route",
                                        "route_type": "relay",
                                        "endpoint_origin": "https://relay",
                                    },
                                ],
                            }
                        ],
                        "binding": {
                            "phase": "access_gate",
                            "station_peer_id": "station-peer",
                        },
                    }
                )
            }
        }

        snapshot = station_registry_snapshot(session)

        self.assertEqual(snapshot["stationPeerId"], "station-peer")
        self.assertEqual(snapshot["activeRouteId"], "relay-route")
        self.assertEqual(snapshot["routeRevision"], 3)
        self.assertEqual(snapshot["route"]["route_type"], "relay")

    def test_registry_snapshot_rejects_url_keyed_legacy_shape(self) -> None:
        session = Mock(spec=TauriSession)
        session.invoke_app_result.return_value = {
            "data": {
                "status": json.dumps(
                    {
                        "active_url": "https://relay",
                        "entries": [
                            {
                                "url": "https://relay",
                                "peer_id": "station-peer",
                            }
                        ],
                    }
                )
            }
        }

        with self.assertRaisesRegex(GateError, "no active Station"):
            station_registry_snapshot(session)


if __name__ == "__main__":
    unittest.main()
