from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from tooling.acceptance.core import GateError
from tooling.acceptance.core.redaction import redact_artifact_bytes
from tooling.acceptance.gates.station_access.relay_role_security_contract import (
    FORBIDDEN_EGRESS,
    _find_forbidden_egress,
    _probe_tls_with_openssl,
    _validate_runtime_evidence,
    validate_relay_role_source_contract,
)


def _protected_file(name: str) -> dict[str, object]:
    return {
        "name": name,
        "exists": True,
        "nonEmpty": True,
        "aclProtected": True,
        "principals": [
            "SIXWIN\\Administrator",
            "NT AUTHORITY\\SYSTEM",
        ],
        "unexpectedPrincipals": [],
        "expectedPrincipalsPresent": True,
        "protected": True,
    }


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
        attestation["runtimeSecurity"]["relayStorageSecurity"][
            "unexpectedPrincipals"
        ] = ["BUILTIN\\Users"]

        with self.assertRaisesRegex(GateError, "security is incomplete"):
            _validate_runtime_evidence(manifest, attestation)

    def test_runtime_evidence_rejects_unprotected_secret_file(self) -> None:
        manifest, attestation = self._runtime_evidence()
        file_evidence = attestation["runtimeSecurity"][
            "relayStorageSecurity"
        ]["requiredProtectedFiles"][3]
        file_evidence["aclProtected"] = False
        file_evidence["protected"] = False

        with self.assertRaisesRegex(
            GateError,
            "protected-file evidence is incomplete",
        ):
            _validate_runtime_evidence(manifest, attestation)

    def test_runtime_evidence_survives_canonical_redaction(self) -> None:
        manifest, attestation = self._runtime_evidence()
        encoded = json.dumps(attestation).encode("utf-8")

        redacted, _changed = redact_artifact_bytes(encoded)
        persisted_attestation = json.loads(redacted)
        evidence = _validate_runtime_evidence(
            manifest,
            persisted_attestation,
        )

        self.assertIsInstance(evidence["relayStorageSecurity"], dict)
        self.assertTrue(
            evidence["relayStorageSecurity"]["requiredProtectedFiles"]
        )

    @patch(
        "tooling.acceptance.gates.station_access."
        "relay_role_security_contract.subprocess.run"
    )
    def test_openssl_fallback_proves_tls13_and_rejects_tls12(
        self,
        run: MagicMock,
    ) -> None:
        certificate = (
            "-----BEGIN CERTIFICATE-----\n"
            "YWJj\n"
            "-----END CERTIFICATE-----"
        )
        run.side_effect = [
            subprocess.CompletedProcess(
                args=[],
                returncode=0,
                stdout=f"{certificate}\nProtocol  : TLSv1.3\n",
                stderr="",
            ),
            subprocess.CompletedProcess(
                args=[],
                returncode=1,
                stdout=(
                    "New, (NONE), Cipher is (NONE)\n"
                    "Protocol  : TLSv1.2\n"
                ),
                stderr="tlsv1 alert protocol version",
            ),
        ]

        evidence = _probe_tls_with_openssl("relay.example", 4501)

        self.assertEqual(evidence["protocol"], "TLSv1.3")
        self.assertEqual(evidence["tls12"], "rejected")
        self.assertEqual(len(evidence["certificateSha256"]), 64)
        self.assertNotIn("-brief", run.call_args_list[1].args[0])

    @patch(
        "tooling.acceptance.gates.station_access."
        "relay_role_security_contract.subprocess.run"
    )
    def test_openssl_fallback_rejects_tls12_acceptance(
        self,
        run: MagicMock,
    ) -> None:
        certificate = (
            "-----BEGIN CERTIFICATE-----\n"
            "YWJj\n"
            "-----END CERTIFICATE-----"
        )
        run.side_effect = [
            subprocess.CompletedProcess(
                args=[],
                returncode=0,
                stdout=f"{certificate}\nProtocol  : TLSv1.3\n",
                stderr="",
            ),
            subprocess.CompletedProcess(
                args=[],
                returncode=0,
                stdout="Protocol  : TLSv1.2\n",
                stderr="",
            ),
        ]

        with self.assertRaisesRegex(GateError, "accepted forbidden TLS 1.2"):
            _probe_tls_with_openssl("relay.example", 4501)

    @patch(
        "tooling.acceptance.gates.station_access."
        "relay_role_security_contract.subprocess.run"
    )
    def test_openssl_fallback_rejects_ambiguous_tls12_failure(
        self,
        run: MagicMock,
    ) -> None:
        certificate = (
            "-----BEGIN CERTIFICATE-----\n"
            "YWJj\n"
            "-----END CERTIFICATE-----"
        )
        run.side_effect = [
            subprocess.CompletedProcess(
                args=[],
                returncode=0,
                stdout=f"{certificate}\nProtocol  : TLSv1.3\n",
                stderr="",
            ),
            subprocess.CompletedProcess(
                args=[],
                returncode=1,
                stdout="",
                stderr="connect: Connection refused",
            ),
        ]

        with self.assertRaisesRegex(GateError, "was inconclusive"):
            _probe_tls_with_openssl("relay.example", 4501)

    @patch(
        "tooling.acceptance.gates.station_access."
        "relay_role_security_contract.subprocess.run"
    )
    def test_openssl_fallback_rejects_tls12_probe_timeout(
        self,
        run: MagicMock,
    ) -> None:
        certificate = (
            "-----BEGIN CERTIFICATE-----\n"
            "YWJj\n"
            "-----END CERTIFICATE-----"
        )
        run.side_effect = [
            subprocess.CompletedProcess(
                args=[],
                returncode=0,
                stdout=f"{certificate}\nProtocol  : TLSv1.3\n",
                stderr="",
            ),
            subprocess.TimeoutExpired(cmd=["openssl"], timeout=12),
        ]

        with self.assertRaisesRegex(GateError, "rejection probe failed"):
            _probe_tls_with_openssl("relay.example", 4501)

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
                    "endpoint": "https://relay.example:18081",
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
                "publicEndpoint": "https://relay.example:18081",
                "tlsTrustAnchor": {
                    "sha256": "sha256:" + "4" * 64,
                    "artifact": {
                        **artifact,
                        "path": "runtime/services/relay/tls-ca.pem",
                        "mediaType": "application/x-pem-file",
                    },
                },
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
                "relayStorageSecurity": {
                    "rootAclProtected": True,
                    "unexpectedPrincipals": [],
                    "processBinaryMatches": True,
                    "stationDatabasePath": "station/data/station.db",
                    "stationDatabaseExists": True,
                    "relayDatabasePath": "relay/data/relay.db",
                    "relayDatabaseExists": True,
                    "requiredProtectedFiles": [
                        _protected_file("auth-secret"),
                        _protected_file("relay-operator.key"),
                        _protected_file("relay-signing.key"),
                        _protected_file("relay-ca.key"),
                        _protected_file("relay-ca.crt"),
                        _protected_file("relay-tls.key"),
                        _protected_file("relay.crt"),
                    ],
                },
            },
        }
        return manifest, attestation


if __name__ == "__main__":
    unittest.main()
