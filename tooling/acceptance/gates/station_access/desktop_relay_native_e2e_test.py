from __future__ import annotations

import base64
import hashlib
import json
import unittest
from pathlib import Path
from unittest.mock import Mock

from tooling.acceptance.core import GateError
from tooling.acceptance.drivers.tauri import TauriSession
from tooling.acceptance.gates.station_access.desktop_relay_native_e2e import (
    MACOS_GATE_ID,
    WINDOWS_GATE_ID,
    expected_runtime_cell,
    is_relay_transport,
    relay_trust_environment,
    station_registry_snapshot,
)


class DesktopRelayNativeGateTest(unittest.TestCase):
    def test_desktop_relay_uses_injected_ca_without_disabling_tls(self) -> None:
        discovery = Path(
            "apps/desktop/src-tauri/src/infrastructure/station_discovery.rs"
        ).read_text(encoding="utf-8")
        transport = Path(
            "apps/desktop/src-tauri/src/infrastructure/station_transport.rs"
        ).read_text(encoding="utf-8")
        trust = Path(
            "apps/desktop/src-tauri/src/infrastructure/relay_tls.rs"
        ).read_text(encoding="utf-8")
        combined = discovery + transport + trust

        self.assertIn("PT_ACCEPTANCE_RELAY_CA_DER_B64", trust)
        self.assertIn("add_root_certificate", discovery)
        self.assertIn("RootCertStore::empty()", transport)
        self.assertIn("client_tls_with_config", transport)
        self.assertNotIn("danger_accept_invalid_certs", combined)
        self.assertNotIn("danger_accept_invalid_hostnames", combined)

    def test_relay_trust_environment_uses_verified_run_artifact(self) -> None:
        certificate = (
            b"-----BEGIN CERTIFICATE-----\n"
            b"YWJj\n"
            b"-----END CERTIFICATE-----\n"
        )
        digest = hashlib.sha256(certificate).hexdigest()
        attestation_path = "runtime/services/relay/attestation.json"
        certificate_path = "runtime/services/relay/tls-ca.pem"
        manifest = {
            "services": {
                "relay": {
                    "attestationArtifact": {
                        "path": attestation_path,
                    }
                }
            }
        }
        attestation = {
            "runtimeSecurity": {
                "tlsTrustAnchor": {
                    "sha256": f"sha256:{digest}",
                    "artifact": {
                        "path": certificate_path,
                        "sha256": digest,
                    },
                }
            }
        }
        artifacts = {
            attestation_path: json.dumps(attestation).encode(),
            certificate_path: certificate,
        }

        environment = relay_trust_environment(
            manifest,
            artifact_loader=artifacts.__getitem__,
        )

        self.assertEqual(
            base64.b64decode(
                environment["PT_ACCEPTANCE_RELAY_CA_DER_B64"]
            ),
            b"abc",
        )

    def test_relay_trust_environment_rejects_digest_mismatch(self) -> None:
        attestation_path = "runtime/services/relay/attestation.json"
        certificate_path = "runtime/services/relay/tls-ca.pem"
        manifest = {
            "services": {
                "relay": {
                    "attestationArtifact": {
                        "path": attestation_path,
                    }
                }
            }
        }
        attestation = {
            "runtimeSecurity": {
                "tlsTrustAnchor": {
                    "sha256": "sha256:" + "0" * 64,
                    "artifact": {
                        "path": certificate_path,
                        "sha256": "0" * 64,
                    },
                }
            }
        }
        artifacts = {
            attestation_path: json.dumps(attestation).encode(),
            certificate_path: (
                b"-----BEGIN CERTIFICATE-----\n"
                b"YWJj\n"
                b"-----END CERTIFICATE-----\n"
            ),
        }

        with self.assertRaisesRegex(GateError, "digest"):
            relay_trust_environment(
                manifest,
                artifact_loader=artifacts.__getitem__,
            )

    def test_restart_preserves_station_registry_storage(self) -> None:
        source = Path(
            "tooling/acceptance/gates/station_access/"
            "desktop_relay_native_e2e.py"
        ).read_text(encoding="utf-8")
        stop = source.index("first.stop(preserve_state=True)")
        restore = source.index("restore_session=True")

        self.assertLess(stop, restore)

    def test_relay_transport_is_distinct_from_discovery_locator(self) -> None:
        self.assertTrue(
            is_relay_transport(
                "http://10.36.3.187:18081",
                "https://10.36.3.187:4501",
            )
        )
        self.assertFalse(
            is_relay_transport(
                "http://10.36.3.187:18081",
                "http://10.36.3.187:18081",
            )
        )

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
