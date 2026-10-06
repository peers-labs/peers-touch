from __future__ import annotations

import base64
import json
import unittest
from unittest.mock import patch

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
                if self_call != (CAPABILITY_ID, RUN_OPERATION, {}, 120):
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
                    "rotationGeneration": 1,
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
        ):
            gate = RelayEnrollmentGate(FakeCapabilityClient())
            result = gate.run()

        self.assertEqual(result["runtimeCell"], "sixwin-station-relay")
        self.assertTrue(all(result["assertions"].values()))


if __name__ == "__main__":
    unittest.main()
