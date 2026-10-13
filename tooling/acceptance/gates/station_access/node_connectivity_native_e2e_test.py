from __future__ import annotations

import http.server
import json
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from types import SimpleNamespace

from tooling.acceptance.core import REPO_ROOT
from tooling.acceptance.core.redaction import redact_value
from tooling.acceptance.gates.station_access.node_connectivity_native_e2e import (
    ATTACHMENT_BYTES,
    GATE_ID,
    JOURNEY_ID,
    NCP_ASSERTIONS,
    NCP_REQUIRED_ASSERTIONS,
    NCP_REQUIRED_STEPS,
    NodeConnectivityNativeGate,
    validate_ncp_report,
)
from tooling.acceptance.node_connectivity_native_support import (
    DirectRouteFaultProxy,
)


class _VersionHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        body = b'{"version":"test"}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format: str, *_args: object) -> None:
        return


class NodeConnectivityNativeGateTest(unittest.TestCase):
    def test_gate_catalog_uses_environment_backed_native_argv(self) -> None:
        gates = json.loads(
            (REPO_ROOT / "tooling/acceptance/gates.yaml").read_text(
                encoding="utf-8"
            )
        )["gates"]
        gate = gates[GATE_ID]

        self.assertNotIn("command", gate)
        self.assertEqual(
            gate["argv"],
            [
                "python3",
                "-m",
                "tooling.acceptance.gates.station_access."
                "node_connectivity_native_e2e",
            ],
        )
        self.assertEqual(
            gate["environment"],
            "station-access-relay-role",
        )
        self.assertEqual(
            gate["provisioner"],
            "station-access-relay-role",
        )
        self.assertEqual(
            gate["requiredRuntimeCells"],
            ["desktop-macos-native"],
        )
        self.assertEqual(gate["tier"], "env-evidence")
        local_journey = (
            REPO_ROOT / "tooling/scripts/node-connectivity-journey.py"
        ).read_text(encoding="utf-8")
        self.assertNotIn("NCP-G03", local_journey)

    def test_native_file_picker_has_one_business_implementation(self) -> None:
        helper = (
            REPO_ROOT
            / "tooling/acceptance/gates/chat/native_file_picker.py"
        ).read_text(encoding="utf-8")
        self.assertEqual(
            helper.count("select_file_chooser_path_to_process("),
            1,
        )
        for relative in (
            "tooling/acceptance/gates/chat/lifecycle_direct.py",
            "tooling/acceptance/gates/chat/lifecycle_rich_voice.py",
            "tooling/acceptance/gates/chat/native_product_closure_runner.py",
        ):
            source = (REPO_ROOT / relative).read_text(encoding="utf-8")
            self.assertIn("select_native_file(", source, relative)
            self.assertNotIn(
                "select_file_chooser_path_to_process(",
                source,
                relative,
            )

    def test_acceptance_binary_exposes_read_only_route_diagnostics(self) -> None:
        command_source = (
            REPO_ROOT
            / "apps/desktop/src-tauri/src/interface/tauri_commands/station.rs"
        ).read_text(encoding="utf-8")
        main_source = (
            REPO_ROOT / "apps/desktop/src-tauri/src/main.rs"
        ).read_text(encoding="utf-8")

        for command in (
            "acceptance_station_route_probe",
            "acceptance_station_transport_diagnostics",
            "acceptance_station_direct_route_override",
        ):
            self.assertIn(f"pub fn {command}", command_source)
            self.assertIn(f"station::{command}", main_source)
        self.assertIn(
            '#[cfg(feature = "acceptance-webdriver")]',
            command_source,
        )
        gate_source = (
            REPO_ROOT
            / "tooling/acceptance/gates/station_access/"
            "node_connectivity_native_e2e.py"
        ).read_text(encoding="utf-8")
        self.assertIn(
            "apply_verified_direct_route_override(",
            gate_source,
        )
        self.assertIn(
            "clear_verified_direct_route_override(",
            gate_source,
        )
        self.assertNotIn(
            "self.runtime_binding.apply_transport_override(",
            gate_source,
        )

    def test_gate_separates_circuit_locator_from_station_identity_url(
        self,
    ) -> None:
        station = {
            "kind": "station",
            "endpoint": "http://station.example",
            "runtimeIdentity": "station-peer",
        }
        relay = {
            "kind": "relay",
            "endpoint": "https://relay.example:18081",
            "runtimeIdentity": "relay-peer",
        }
        via_relay = {
            "kind": "station",
            "endpoint": "https://relay.example:18081",
            "runtimeIdentity": "station-peer",
        }
        manifest = {
            "environmentId": "station-access-relay-role",
            "state": "FIXTURE_READY",
            "services": {
                "station": station,
                "relay": relay,
                "station-via-relay": via_relay,
            },
            "clients": [
                {
                    "id": actor,
                    "actor": actor,
                    "runtime": "native-tauri",
                    "storage_root": f"/state/{actor}",
                    "storage_lifecycle": "persistent",
                    "required_service_roles": ["station"],
                    "service_bindings": {
                        "station": {
                            "service_id": (
                                "station"
                                if actor == "alice"
                                else "station-via-relay"
                            ),
                            "required_kind": "station",
                        }
                    },
                }
                for actor in ("alice", "bob")
            ],
        }
        actor_manifest = {
            "initialState": "existing",
            "actors": [
                {
                    "role": actor,
                    "accountRef": f"station-account:{actor}@p.t",
                    "ptid": f"ptid:{actor}",
                    "devicePolicy": "persistent-acceptance",
                }
                for actor in ("alice", "bob")
            ],
            "reset": {
                "authorized": False,
                "targetVerified": True,
            },
        }

        gate = NodeConnectivityNativeGate(
            manifest=manifest,
            actor_manifest=actor_manifest,
            runtime_binding=SimpleNamespace(
                cell_id="desktop-macos-native"
            ),
        )

        self.assertEqual(
            gate.station_url,
            "http://station.example",
        )
        self.assertEqual(
            gate.station_identity_url,
            "http://station.example",
        )
        self.assertEqual(gate.report.station_url, "http://station.example")
        self.assertEqual(gate.journey_id, JOURNEY_ID)
        self.assertTrue(gate.verify_fixture_ready())

    def test_direct_route_fault_proxy_drops_only_armed_version_probe(
        self,
    ) -> None:
        upstream = http.server.ThreadingHTTPServer(
            ("127.0.0.1", 0),
            _VersionHandler,
        )
        upstream_thread = threading.Thread(
            target=upstream.serve_forever,
            daemon=True,
        )
        upstream_thread.start()
        host, port = upstream.server_address
        proxy = DirectRouteFaultProxy(f"http://{host}:{port}")
        proxy.start()
        try:
            with urllib.request.urlopen(
                f"{proxy.url}/app-meta/version",
                timeout=2,
            ) as response:
                self.assertEqual(response.status, 200)
            proxy.arm()
            with self.assertRaises(
                (urllib.error.URLError, ConnectionError),
            ):
                urllib.request.urlopen(
                    f"{proxy.url}/app-meta/version",
                    timeout=2,
                )
            proxy.disarm()
            with urllib.request.urlopen(
                f"{proxy.url}/app-meta/version",
                timeout=2,
            ) as response:
                self.assertEqual(response.status, 200)
            self.assertEqual(proxy.evidence()["failureCount"], 1)
        finally:
            proxy.stop()
            upstream.shutdown()
            upstream.server_close()
            upstream_thread.join(timeout=2)

    def test_validator_requires_routes_read_and_exact_attachment(self) -> None:
        report = {
            "manifest": {
                "services": {
                    "station": {
                        "runtimeIdentity": "station-peer",
                    },
                    "relay": {
                        "endpoint": "https://relay.example:18081",
                        "runtimeIdentity": "relay-peer",
                    },
                }
            },
            "runtime": {
                "nodeConnectivity": {
                    "identityState": {
                        actor: {
                            "storageRoot": f"/state/{actor}",
                            "storageLifecycle": "persistent",
                            "devicePolicy": "persistent-acceptance",
                            "endpoint": {
                                "active": True,
                                "profileRevision": 7,
                            },
                            "profile": {"profile_revision": 7},
                        }
                        for actor in ("alice", "bob")
                    },
                    "routes": {
                        actor: {
                            "stationPeerId": "station-peer",
                            "route": {
                                "route_type": "relay",
                                "health": "available",
                                "relay_peer_id": "relay-peer",
                                "endpoint_origin": (
                                    "https://relay.example:18443"
                                ),
                            },
                        }
                        for actor in ("alice", "bob")
                    },
                    "routePolicy": {
                        "directOnly": {
                            "policy": "direct_only",
                            "attempt": {
                                "sequence": 1,
                                "routeType": "direct",
                                "requestPath": "/app-meta/version",
                                "outcome": "connected",
                            },
                            "mutation": {
                                "receiverVisible": True,
                                "readbackMatches": True,
                            },
                        },
                        "relayOnly": {
                            "policy": "relay_only",
                            "attempt": {
                                "sequence": 2,
                                "routeType": "relay",
                                "requestPath": "/app-meta/version",
                                "outcome": "connected",
                            },
                            "mutation": {
                                "receiverVisible": True,
                                "readbackMatches": True,
                            },
                        },
                        "noRoute": {"code": "station_no_route"},
                        "policyConflict": {
                            "code": "station_route_policy_conflict"
                        },
                        "auto": {
                            "policy": "auto",
                            "attempts": [
                                {
                                    "sequence": 3,
                                    "routeType": "direct",
                                    "requestPath": "/app-meta/version",
                                    "outcome": "failed",
                                },
                                {
                                    "sequence": 4,
                                    "routeType": "relay",
                                    "requestPath": "/app-meta/version",
                                    "outcome": "connected",
                                },
                            ],
                            "before": {
                                "stationPeerId": "station-peer",
                                "activeRouteId": "direct-route",
                                "routeRevision": 1,
                                "lifecycleGeneration": 1,
                            },
                            "after": {
                                "stationPeerId": "station-peer",
                                "activeRouteId": "relay-route",
                                "routeRevision": 2,
                                "lifecycleGeneration": 1,
                            },
                            "sessionBefore": {
                                "account_scope_sha256": "e" * 64,
                                "session_id_sha256": "c" * 64,
                                "session_binding_sha256": "d" * 64,
                            },
                            "sessionAfter": {
                                "account_scope_sha256": "e" * 64,
                                "session_id_sha256": "c" * 64,
                                "session_binding_sha256": "d" * 64,
                            },
                            "transition": {
                                "previousLeaseCancelled": True,
                                "previousRouteId": "direct-route",
                                "nextRouteId": "relay-route",
                                "previousRouteRevision": 1,
                                "nextRouteRevision": 2,
                                "lifecycleGeneration": 1,
                            },
                            "proxy": {
                                "failureCount": 2,
                                "autoFailureDelta": 1,
                            },
                        },
                    },
                    "read": {
                        "sender": {
                            "messageUlid": "message-1",
                            "receipt": "read",
                        },
                        "receiver": {"messageUlid": "message-1"},
                    },
                    "attachment": {
                        "byteLength": ATTACHMENT_BYTES,
                        "receiverSnapshot": {"visible": True},
                        "openedSnapshot": {"openState": "ready"},
                        "sourceSha256": "a" * 64,
                        "receiverSha256": "a" * 64,
                    },
                }
            }
        }

        redacted_report = redact_value(report)
        validate_ncp_report(redacted_report)
        redacted_detail = redact_value(
            {
                "detail": json.dumps(
                    redacted_report["runtime"]["nodeConnectivity"][
                        "routePolicy"
                    ]["auto"],
                    sort_keys=True,
                )
            }
        )["detail"]
        self.assertIsInstance(json.loads(redacted_detail), dict)
        report["runtime"]["nodeConnectivity"]["attachment"][
            "receiverSha256"
        ] = "b" * 64
        with self.assertRaisesRegex(
            RuntimeError,
            "attachment evidence is incomplete",
        ):
            validate_ncp_report(report)
        report["runtime"]["nodeConnectivity"]["attachment"][
            "receiverSha256"
        ] = "a" * 64
        del report["runtime"]["nodeConnectivity"]["routePolicy"][
            "policyConflict"
        ]
        with self.assertRaisesRegex(
            RuntimeError,
            "route-policy evidence is incomplete",
        ):
            validate_ncp_report(report)

    def test_proof_contract_requires_native_receiver_closure(self) -> None:
        self.assertTrue(NCP_ASSERTIONS <= NCP_REQUIRED_ASSERTIONS)
        self.assertIn(
            "native_actor_identity_state_persistent",
            NCP_REQUIRED_ASSERTIONS,
        )
        for assertion in (
            "native_direct_only_route",
            "native_device_enrollment_profile_revision",
            "native_relay_only_route",
            "native_auto_route_ordered_failover",
            "native_route_failures_typed",
            "native_route_switch_preserves_session",
            "native_route_lease_fenced",
            "native_profile_mutation_readback",
        ):
            self.assertIn(assertion, NCP_REQUIRED_ASSERTIONS)
        self.assertIn("fixture.existing", NCP_REQUIRED_STEPS)
        self.assertNotIn("fixture.reset", NCP_REQUIRED_STEPS)
        for step in (
            "route.direct-only",
            "route.no-route",
            "route.relay-only",
            "route.policy-conflict",
            "route.auto-failover",
            "route.circuit",
            "receipt.read",
            "attachment.upload",
            "attachment.received",
            "attachment.opened",
            "attachment.digest",
        ):
            self.assertIn(step, NCP_REQUIRED_STEPS)


if __name__ == "__main__":
    unittest.main()
