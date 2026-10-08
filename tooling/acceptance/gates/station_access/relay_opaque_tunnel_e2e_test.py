from __future__ import annotations

import json
import os
import unittest
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
        handler._marker = "opaque-sensitive-marker"
        handler._relay_config = MagicMock()
        handler._transport = MagicMock()

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
