from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.core import GateError
from tooling.acceptance.gates.station_access.relay_role_security_contract import (
    FORBIDDEN_EGRESS,
    _find_forbidden_egress,
    _validate_runtime_evidence,
    validate_relay_role_source_contract,
)


class RelayRoleSecurityContractTest(unittest.TestCase):
    def test_current_repository_satisfies_source_contract(self) -> None:
        validate_relay_role_source_contract()

    def test_debug_egress_scan_rejects_station_source(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "apps" / "station" / "example.go"
            source.parent.mkdir(parents=True)
            source.write_text(
                f'package station\nconst endpoint = "{FORBIDDEN_EGRESS}"\n',
                encoding="utf-8",
            )

            self.assertEqual(
                _find_forbidden_egress(root),
                ["apps/station/example.go"],
            )

    def test_runtime_evidence_requires_isolated_attested_services(self) -> None:
        manifest, attestation = self._runtime_evidence()

        evidence = _validate_runtime_evidence(manifest, attestation)

        self.assertEqual(evidence["sourceCommit"], "a" * 40)
        self.assertEqual(evidence["streamEndpoint"], "tls://relay.example:4501")

    def test_runtime_evidence_rejects_shared_process(self) -> None:
        manifest, attestation = self._runtime_evidence()
        attestation["runtimeSecurity"]["relayRuntime"]["processIds"] = [101]

        with self.assertRaisesRegex(GateError, "security is incomplete"):
            _validate_runtime_evidence(manifest, attestation)

    def test_runtime_evidence_rejects_unexpected_secret_principal(self) -> None:
        manifest, attestation = self._runtime_evidence()
        attestation["runtimeSecurity"]["relaySecrets"][
            "unexpectedPrincipals"
        ] = ["BUILTIN\\Users"]

        with self.assertRaisesRegex(GateError, "security is incomplete"):
            _validate_runtime_evidence(manifest, attestation)

    @staticmethod
    def _runtime_evidence() -> tuple[dict[str, object], dict[str, object]]:
        commit = "a" * 40
        artifact = {
            "artifactKind": "acceptance-artifact-ref",
            "workspaceId": "1" * 16,
            "gateId": "relay-role-security-contract",
            "runId": "20261006T100000000000Z-" + "2" * 32,
            "path": "runtime/services/relay/attestation.json",
            "sha256": "3" * 64,
            "mediaType": "application/json",
        }
        manifest = {
            "environmentId": "station-access-relay-role",
            "source": {"commit": commit},
            "services": {
                "station": {
                    "kind": "station",
                    "liveCommit": commit,
                    "workspaceDigest": "clean",
                    "protocolDigest": "p" * 64,
                    "endpoint": "http://station.example",
                    "attestationArtifact": artifact,
                },
                "relay": {
                    "kind": "relay",
                    "liveCommit": commit,
                    "workspaceDigest": "clean",
                    "protocolDigest": "p" * 64,
                    "endpoint": "http://relay.example",
                    "attestationArtifact": artifact,
                },
            },
        }
        attestation = {
            "artifactKind": "service-deployment-attestation",
            "serviceId": "relay",
            "serviceKind": "relay",
            "commit": commit,
            "runtimeSecurity": {
                "attachmentMode": "existing-owner-managed",
                "streamEndpoint": "tls://relay.example:4501",
                "stationRuntime": {
                    "role": "station",
                    "taskName": "station-task",
                    "runtimePath": "station-runtime",
                    "processIds": [101],
                },
                "relayRuntime": {
                    "role": "relay",
                    "taskName": "relay-task",
                    "runtimePath": "relay-runtime",
                    "processIds": [202],
                },
                "relaySecrets": {
                    "rootAclProtected": True,
                    "unexpectedPrincipals": [],
                    "processBinaryMatches": True,
                    "stationDatabasePath": "station/data/station.db",
                    "stationDatabaseExists": True,
                    "relayDatabasePath": "relay/data/relay.db",
                    "relayDatabaseExists": True,
                    "requiredSecretFiles": {
                        "auth-secret": True,
                        "relay-operator.key": True,
                        "relay-signing.key": True,
                        "relay-tls.key": True,
                        "relay.crt": True,
                    },
                },
            },
        }
        return manifest, attestation


if __name__ == "__main__":
    unittest.main()
