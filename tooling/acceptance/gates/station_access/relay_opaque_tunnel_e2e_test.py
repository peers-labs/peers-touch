from __future__ import annotations

import json
import os
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from tooling.acceptance.gates.station_access.relay_opaque_tunnel_e2e import (
    CAPABILITY_ID,
    RUN_OPERATION,
    RelayOpaqueTunnelCapabilityHandler,
    RelayOpaqueTunnelGate,
    validate_opaque_tunnel_source_contract,
)


class RelayOpaqueTunnelGateTest(unittest.TestCase):
    def test_current_repository_satisfies_source_contract(self) -> None:
        validate_opaque_tunnel_source_contract()

    def test_capability_runs_live_probe_and_redacts_marker(self) -> None:
        handler = object.__new__(RelayOpaqueTunnelCapabilityHandler)
        handler._closed = False
        handler._station_url = "http://127.0.0.1:41001"
        handler._relay_url = "http://127.0.0.1:41002"
        handler._relay_public_url = "https://127.0.0.1:41003"
        handler._relay_ca_file = Path("/tmp/relay-ca.pem")
        handler._marker = "opaque-sensitive-marker"
        handler._mount_process = MagicMock(
            poll=MagicMock(return_value=None)
        )
        handler._relay_config = MagicMock()
        handler._relay_transport = MagicMock()

        completed = MagicMock(
            returncode=0,
            stdout=(
                "PT_OPAQUE_TUNNEL_PROBE="
                + json.dumps(
                    {
                        "binaryTunnel": True,
                        "innerTLS13": True,
                        "stationSPKIPinned": True,
                        "stationLoginPassed": True,
                        "outerRelayCAValidated": True,
                        "relayNonceBounded": True,
                        "limitsAdvertised": True,
                    }
                )
                + "\n"
            ),
            stderr="",
        )
        with (
            patch(
                "tooling.acceptance.gates.station_access."
                "relay_opaque_tunnel_e2e.subprocess.run",
                return_value=completed,
            ) as run,
            patch.object(
                handler,
                "_marker_absent_from_relay_log",
                return_value=True,
            ),
        ):
            result = handler.invoke(
                RUN_OPERATION,
                {},
                deadline_monotonic=10**12,
                cancellation=MagicMock(is_set=lambda: False),
            )

        self.assertTrue(result["relayOpaqueMarkerAbsent"])
        self.assertEqual(len(result["markerSha256"]), 64)
        self.assertNotIn(handler._marker, json.dumps(result))
        self.assertEqual(
            run.call_args.kwargs["env"]["PT_LIVE_TUNNEL_MARKER"],
            handler._marker,
        )
        self.assertEqual(
            run.call_args.kwargs["env"]["PT_LIVE_TUNNEL_RELAY_URL"],
            handler._relay_public_url,
        )
        self.assertEqual(
            run.call_args.kwargs["env"]["PT_LIVE_TUNNEL_RELAY_CA_FILE"],
            str(handler._relay_ca_file),
        )

    def test_close_stops_probe_and_revokes_mount_before_tunnels(self) -> None:
        handler = object.__new__(RelayOpaqueTunnelCapabilityHandler)
        handler._closed = False
        handler._marker = "marker"
        handler._mount_operator_token = "operator-token"
        handler._mount_station_peer_id = "station-peer"
        handler._attached_existing_mount = False
        handler._relay_url = "http://127.0.0.1:41002"
        process = MagicMock(returncode=0)
        process.stdin = MagicMock()
        handler._mount_process = process
        handler._tunnels = []
        handler._sensitive = [bytearray(b"operator-token")]
        handler._probe_directory = MagicMock()
        handler._request_json = MagicMock(return_value={"_status": 200})

        cleanup = handler.close()

        self.assertTrue(cleanup.closed)
        self.assertTrue(cleanup.secrets_zeroized)
        process.stdin.close.assert_called_once()
        process.wait.assert_called_once_with(timeout=10)
        handler._request_json.assert_called_once_with(
            "http://127.0.0.1:41002/api/v1/relay/mount",
            method="DELETE",
            payload={"station_peer_id": "station-peer"},
            bearer="operator-token",
            allow_error=True,
        )
        handler._probe_directory.cleanup.assert_called_once()
        self.assertEqual(handler._mount_operator_token, "")
        self.assertEqual(handler._mount_station_peer_id, "")

    def test_existing_online_mount_is_attached_without_probe(self) -> None:
        handler = object.__new__(RelayOpaqueTunnelCapabilityHandler)
        handler._attached_existing_mount = False
        handler._mount_process = None
        handler._station_url = "http://127.0.0.1:41001"
        handler._relay_url = "http://127.0.0.1:41002"
        handler._operator_token = MagicMock(return_value="operator-token")
        handler._ensure_probe_binary = MagicMock()
        handler._request_json = MagicMock(
            side_effect=[
                {"peer_id": "station-peer"},
                {
                    "mounts": [
                        {
                            "station_peer_id": "station-peer",
                            "status": 1,
                            "revoked_at": "",
                        }
                    ]
                },
            ]
        )

        handler._ensure_mount(
            deadline_monotonic=10**12,
            cancellation=MagicMock(is_set=lambda: False),
        )

        self.assertTrue(handler._attached_existing_mount)
        handler._ensure_probe_binary.assert_not_called()

    def test_close_does_not_revoke_attached_existing_mount(self) -> None:
        handler = object.__new__(RelayOpaqueTunnelCapabilityHandler)
        handler._closed = False
        handler._marker = "marker"
        handler._mount_process = None
        handler._mount_operator_token = "operator-token"
        handler._mount_station_peer_id = "station-peer"
        handler._attached_existing_mount = True
        handler._relay_url = "http://127.0.0.1:41002"
        handler._tunnels = []
        handler._sensitive = [bytearray(b"operator-token")]
        handler._probe_directory = MagicMock()
        handler._request_json = MagicMock()

        cleanup = handler.close()

        self.assertTrue(cleanup.closed)
        self.assertTrue(cleanup.secrets_zeroized)
        handler._request_json.assert_not_called()
        handler._probe_directory.cleanup.assert_called_once()

    def test_gate_requires_complete_runtime_result(self) -> None:
        runtime_reference = {
            "artifactKind": "acceptance-artifact-ref",
            "workspaceId": "workspace-id",
            "gateId": "relay-opaque-tunnel-e2e",
            "runId": "20261007T120000000000Z-" + ("a" * 32),
            "path": "runtime/environment-manifest.json",
            "sha256": "b" * 64,
            "mediaType": "application/json",
        }

        class FakeCapabilityClient:
            def invoke(
                self,
                capability_id: str,
                operation: str,
                payload: object,
                *,
                timeout_seconds: float,
            ) -> dict[str, object]:
                if (
                    capability_id,
                    operation,
                    payload,
                    timeout_seconds,
                ) != (CAPABILITY_ID, RUN_OPERATION, {}, 180):
                    raise AssertionError("unexpected capability request")
                return {
                    "binaryTunnel": True,
                    "innerTLS13": True,
                    "stationSPKIPinned": True,
                    "stationLoginPassed": True,
                    "outerRelayCAValidated": True,
                    "relayNonceBounded": True,
                    "limitsAdvertised": True,
                    "relayOpaqueMarkerAbsent": True,
                    "markerSha256": "c" * 64,
                }

        with (
            patch.dict(
                os.environ,
                {"PT_ACCEPTANCE_RUNTIME_MANIFEST": "/tmp/runtime.json"},
            ),
            patch(
                "tooling.acceptance.gates.station_access."
                "relay_opaque_tunnel_e2e.load_runtime_manifest",
                return_value={"source": {"commit": "a" * 40}},
            ),
            patch(
                "tooling.acceptance.gates.station_access."
                "relay_opaque_tunnel_e2e.current_artifact_ref"
            ) as artifact_ref,
            patch(
                "tooling.acceptance.gates.station_access."
                "relay_opaque_tunnel_e2e.subprocess.run"
            ) as run,
        ):
            artifact_ref.return_value.to_dict.return_value = runtime_reference
            run.return_value.returncode = 0
            gate = RelayOpaqueTunnelGate(FakeCapabilityClient())
            result = gate.run()

        self.assertEqual(result["runtimeCell"], "one-linux-relay")
        self.assertTrue(all(result["assertions"].values()))


if __name__ == "__main__":
    unittest.main()
