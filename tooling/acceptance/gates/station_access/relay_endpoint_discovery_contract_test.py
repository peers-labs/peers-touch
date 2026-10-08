from __future__ import annotations

import os
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling.acceptance.gates.station_access.relay_endpoint_discovery_contract import (
    CAPABILITY_ID,
    RUN_OPERATION,
    RelayEndpointDiscoveryCapabilityHandler,
    RelayEndpointDiscoveryGate,
    validate_discovery_source_contract,
)


class RelayEndpointDiscoveryContractTest(unittest.TestCase):
    def test_current_repository_satisfies_source_contract(self) -> None:
        validate_discovery_source_contract()

    def test_capability_handler_redacts_forwarded_endpoints(self) -> None:
        handler = RelayEndpointDiscoveryCapabilityHandler.__new__(
            RelayEndpointDiscoveryCapabilityHandler
        )
        handler._station_url = "http://127.0.0.1:41001"
        handler._relay_url = "http://127.0.0.1:41002"

        self.assertEqual(
            handler.sensitive_values,
            ("http://127.0.0.1:41001", "http://127.0.0.1:41002"),
        )

    def test_gate_requires_signed_roles_and_challenges(self) -> None:
        runtime_reference = {
            "artifactKind": "acceptance-artifact-ref",
            "workspaceId": "workspace-id",
            "gateId": "relay-endpoint-discovery-contract",
            "runId": "20261006T120000000000Z-" + ("a" * 32),
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
                self_call = (
                    capability_id,
                    operation,
                    payload,
                    timeout_seconds,
                )
                if self_call != (
                    CAPABILITY_ID,
                    RUN_OPERATION,
                    {},
                    180,
                ):
                    raise AssertionError(self_call)
                return {
                    "station_role_bound": True,
                    "relay_role_bound": True,
                    "challenges_bound": True,
                    "relay_no_candidates": True,
                    "dashboard_auth_required": True,
                    "dashboard_sensitive_headers": True,
                }

        with (
            patch.dict(
                os.environ,
                {"PT_ACCEPTANCE_RUNTIME_MANIFEST": "/tmp/runtime.json"},
            ),
            patch(
                "tooling.acceptance.gates.station_access."
                "relay_endpoint_discovery_contract.load_runtime_manifest",
                return_value={"source": {"commit": "a" * 40}},
            ),
            patch(
                "tooling.acceptance.gates.station_access."
                "relay_endpoint_discovery_contract.current_artifact_ref"
            ) as artifact_ref,
            patch(
                "tooling.acceptance.gates.station_access."
                "relay_endpoint_discovery_contract.subprocess.run"
            ) as run,
        ):
            artifact_ref.return_value.to_dict.return_value = runtime_reference
            run.return_value.returncode = 0
            gate = RelayEndpointDiscoveryGate(FakeCapabilityClient())
            result = gate.run()

        self.assertEqual(result["runtimeCell"], "one-linux-relay")
        self.assertTrue(all(result["assertions"].values()))
        self.assertEqual(run.call_args.kwargs["env"]["HOME"], str(Path.home()))


if __name__ == "__main__":
    unittest.main()
