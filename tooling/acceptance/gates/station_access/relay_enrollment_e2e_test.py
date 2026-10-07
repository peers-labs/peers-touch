from __future__ import annotations

import base64
import json
import ssl
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from tooling.acceptance.gates.station_access.relay_enrollment_e2e import (
    CAPABILITY_ID,
    RUN_OPERATION,
    RelayEnrollmentGate,
    RelayEnrollmentCapabilityHandler,
    validate_enrollment_source_contract,
)


def _encode(value: object) -> str:
    return base64.urlsafe_b64encode(
        json.dumps(value, separators=(",", ":")).encode("utf-8")
    ).rstrip(b"=").decode("ascii")


class RelayEnrollmentGateTest(unittest.TestCase):
    def test_current_repository_satisfies_source_contract(self) -> None:
        validate_enrollment_source_contract()

    @patch(
        "tooling.acceptance.gates.station_access."
        "relay_enrollment_e2e._OpenSSLRelayStream"
    )
    def test_stream_uses_openssl_when_python_lacks_tls13(
        self,
        stream_factory: MagicMock,
    ) -> None:
        stream = MagicMock()
        stream.recv.side_effect = [b'{"ok":true}', b"\n"]
        stream_factory.return_value = stream
        handler = object.__new__(RelayEnrollmentCapabilityHandler)
        handler._relay_config = SimpleNamespace(host="relay.example")
        handler._stream_port = 4501

        with patch.object(ssl, "HAS_TLSv1_3", False):
            opened = handler._open_stream("credential", "station-peer")

        self.assertIs(opened, stream)
        stream_factory.assert_called_once_with("relay.example", 4501)
        stream.settimeout.assert_called_once_with(10)
        stream.sendall.assert_called_once_with(
            b'{"relay_token":"credential","station_peer_id":"station-peer"}\n'
        )

    def test_credential_claim_projection_reads_eddsa_header(self) -> None:
        token = ".".join(
            (
                _encode({"alg": "EdDSA", "typ": "JWT"}),
                _encode(
                    {
                        "aud": ["peers-touch-relay-mount"],
                        "scope": [
                            "relay.mount.connect",
                            "relay.mount.rotate",
                        ],
                        "jti": "credential-id",
                        "generation": 2,
                    }
                ),
                "signature",
            )
        )

        claims = RelayEnrollmentCapabilityHandler._credential_claims(token)

        self.assertEqual(claims["_alg"], "EdDSA")
        self.assertEqual(claims["aud"], ["peers-touch-relay-mount"])
        self.assertEqual(claims["generation"], 2)

    def test_gate_requires_complete_lifecycle_result(self) -> None:
        runtime_reference = {
            "artifactKind": "acceptance-artifact-ref",
            "workspaceId": "workspace-id",
            "gateId": "relay-station-enrollment-e2e",
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
                if self_call != (CAPABILITY_ID, RUN_OPERATION, {}, 240):
                    raise AssertionError(self_call)
                return {
                    "stationPeerIdSha256": "a" * 64,
                    "relayPeerIdSha256": "b" * 64,
                    "invitePlaintextHidden": True,
                    "credentialAlgorithm": "EdDSA",
                    "credentialAudience": ["peers-touch-relay-mount"],
                    "credentialScopes": [
                        "relay.mount.connect",
                        "relay.mount.rotate",
                        "relay.route.publish",
                        "relay.peer.tunnel",
                    ],
                    "credentialHasJti": True,
                    "firstGeneration": 1,
                    "rotationGeneration": 2,
                    "rotationChangedJti": True,
                    "streamClosedAfterRotate": True,
                    "oldCredentialAfterRotateStatus": 401,
                    "newCredentialAfterRotateStatus": 200,
                    "revokeStatus": "revoked",
                    "streamClosedAfterRevoke": True,
                    "reconnectRejectedAfterRevoke": True,
                    "revokedCredentialStatus": 401,
                    "recoveryGeneration": 3,
                    "recoverySucceeded": True,
                    "concurrentConsumeStatuses": [200, 403],
                    "relayClientInitialReady": True,
                    "relayClientRecoveredReady": True,
                }

        with (
            patch.dict(
                "os.environ",
                {"PT_ACCEPTANCE_RUNTIME_MANIFEST": "/tmp/runtime.json"},
            ),
            patch(
                "tooling.acceptance.gates.station_access."
                "relay_enrollment_e2e.load_runtime_manifest",
                return_value={"source": {"commit": "a" * 40}},
            ),
            patch(
                "tooling.acceptance.gates.station_access."
                "relay_enrollment_e2e.current_artifact_ref"
            ) as artifact_ref,
        ):
            artifact_ref.return_value.to_dict.return_value = runtime_reference
            gate = RelayEnrollmentGate(FakeCapabilityClient())
            result = gate.run()

        self.assertEqual(result["runtimeCell"], "sixwin-station-relay")
        self.assertEqual(
            gate.manifest["_manifest_ref"],
            runtime_reference,
        )
        self.assertTrue(all(result["assertions"].values()))


if __name__ == "__main__":
    unittest.main()
