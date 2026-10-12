from __future__ import annotations

import json
import unittest
from pathlib import Path
from types import SimpleNamespace

from tooling.acceptance.core import REPO_ROOT
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
                            "service_id": "station-via-relay",
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
            "https://relay.example:18081",
        )
        self.assertEqual(
            gate.station_identity_url,
            "http://station.example",
        )
        self.assertEqual(gate.report.station_url, "http://station.example")
        self.assertEqual(gate.journey_id, JOURNEY_ID)
        self.assertTrue(gate.verify_fixture_ready())

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

        validate_ncp_report(report)
        report["runtime"]["nodeConnectivity"]["attachment"][
            "receiverSha256"
        ] = "b" * 64
        with self.assertRaisesRegex(
            RuntimeError,
            "attachment evidence is incomplete",
        ):
            validate_ncp_report(report)

    def test_proof_contract_requires_native_receiver_closure(self) -> None:
        self.assertTrue(NCP_ASSERTIONS <= NCP_REQUIRED_ASSERTIONS)
        self.assertIn(
            "native_actor_identity_state_persistent",
            NCP_REQUIRED_ASSERTIONS,
        )
        self.assertIn("fixture.existing", NCP_REQUIRED_STEPS)
        self.assertNotIn("fixture.reset", NCP_REQUIRED_STEPS)
        for step in (
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
