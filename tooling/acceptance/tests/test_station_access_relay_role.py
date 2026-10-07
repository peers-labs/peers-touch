from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from tooling.acceptance.core import (
    ENVIRONMENTS_DIR,
    EnvironmentContract,
    ProvisioningState,
    ServiceAttestation,
)
from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.provisioners import (
    StationAccessRelayRoleProvisioner,
    get_provisioner,
)
from tooling.acceptance.provisioners.station_access_relay_role import (
    _relay_runtime_security,
    _validate_runtime_status,
)


COMMIT = "a" * 40
BINARY_SHA256 = "b" * 64
PROTO_DIGEST = "c" * 64


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


def _config(role: str) -> SimpleNamespace:
    http_port = 18080 if role == "station" else 18081
    return SimpleNamespace(
        environment_name=f"sixwin-{role}",
        role=role,
        task_name=f"PeersTouch-sixwin-{role}",
        host="sixwin.example",
        user="Administrator",
        ssh_port=22,
        known_hosts_file="",
        runtime_path=f".peers-touch/runtime/sixwin-{role}",
        http_port=http_port,
        stream_port=4501 if role == "relay" else None,
    )


def _status(role: str, process_id: int) -> dict[str, object]:
    task_name = f"PeersTouch-sixwin-{role}"
    runtime_path = f"C:\\runtime\\sixwin-{role}"
    return {
        "artifactKind": "windows-native-runtime-status",
        "environmentName": f"sixwin-{role}",
        "role": role,
        "taskName": task_name,
        "taskRegistered": True,
        "processIds": [process_id],
        "healthy": True,
        "healthUrl": (
            f"http://127.0.0.1:{18080 if role == 'station' else 18081}/healthz"
        ),
        "runtimePath": runtime_path,
        "sourceCommit": COMMIT,
        "sourceClean": True,
        "manifest": {
            "artifactKind": "windows-native-runtime-manifest",
            "environmentName": f"sixwin-{role}",
            "role": role,
            "taskName": task_name,
            "sourceCommit": COMMIT,
            "sourceClean": True,
            "binaryPath": runtime_path + "\\bin\\peers-touch.exe",
            "binarySha256": "sha256:" + BINARY_SHA256,
            "httpPort": 18080 if role == "station" else 18081,
            "streamPort": 4501 if role == "relay" else None,
            "deployedAt": "2026-10-06T00:00:00+00:00",
        },
    }


def _attestation(service_id: str, kind: str) -> ServiceAttestation:
    return ServiceAttestation(
        service_id=service_id,
        service_kind=kind,
        environment_id="station-access-relay-role",
        deployment_environment=f"sixwin-{service_id}",
        endpoint=f"http://{service_id}.example",
        live_commit=COMMIT,
        workspace_digest="clean",
        protocol_digest=PROTO_DIGEST,
        artifact_ref={
            "artifactKind": "acceptance-artifact-ref",
            "workspaceId": "1" * 16,
            "gateId": "relay-role-security-contract",
            "runId": "20261006T100000000000Z-" + "2" * 32,
            "path": f"runtime/services/{service_id}/attestation.json",
            "sha256": "3" * 64,
            "mediaType": "application/json",
        },
        produced_at="2026-10-06T00:00:00+00:00",
        producer="station-relay-role-attachment",
        runtime_identity=f"runtime:{service_id}",
    )


class StationAccessRelayRoleProvisionerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "station-access-relay-role.yaml"
        )

    def test_provisioner_is_registered(self) -> None:
        self.assertIsInstance(
            get_provisioner(self.contract),
            StationAccessRelayRoleProvisioner,
        )

    def test_attach_only_provisioning_emits_two_services_without_cleanup(
        self,
    ) -> None:
        provisioner = StationAccessRelayRoleProvisioner(self.contract)
        profile = {
            "PT_STATION_MODE": "remote",
            "PT_STATION_URL": "http://station.example",
            "PT_STATION_HEALTH_URL": "http://station.example/healthz",
            "PT_STATION_DEPLOY_ENV": "sixwin-station",
            "PT_RELAY_MODE": "remote",
            "PT_RELAY_URL": "http://relay.example",
            "PT_RELAY_HEALTH_URL": "http://relay.example/healthz",
            "PT_RELAY_DEPLOY_ENV": "sixwin-relay",
        }
        with (
            patch.object(provisioner, "_git_commit", return_value=COMMIT),
            patch.object(
                provisioner,
                "_git_workspace_digest",
                return_value="clean",
            ),
            patch.object(
                provisioner,
                "_resolve_active_profile",
                return_value=("sixwin", Path("/profile"), 6, profile),
            ),
            patch.object(provisioner, "_station_ready", return_value=True),
            patch(
                "tooling.acceptance.provisioners.station_access_relay_role."
                "resolve_deployment_environment_path",
                side_effect=lambda name: Path(f"/{name}.env"),
            ),
            patch(
                "tooling.acceptance.provisioners.station_access_relay_role."
                "WindowsRuntimeConfig.load",
                side_effect=(_config("station"), _config("relay")),
            ),
            patch(
                "tooling.acceptance.provisioners.station_access_relay_role."
                "resolve_remote_source_identity",
                return_value=(COMMIT, "clean", PROTO_DIGEST),
            ),
            patch(
                "tooling.acceptance.provisioners.station_access_relay_role."
                "source_proto_digest",
                return_value=PROTO_DIGEST,
            ),
            patch(
                "tooling.acceptance.provisioners.station_access_relay_role."
                "_runtime_status",
                side_effect=(_status("station", 101), _status("relay", 202)),
            ),
            patch(
                "tooling.acceptance.provisioners.station_access_relay_role."
                "_relay_runtime_security",
                return_value={"rootAclProtected": True},
            ),
            patch(
                "tooling.acceptance.provisioners.station_access_relay_role."
                "produce_station_attestation",
                return_value=_attestation("station", "station"),
            ),
            patch(
                "tooling.acceptance.provisioners.station_access_relay_role."
                "_persist_relay_attestation",
                return_value=_attestation("relay", "relay"),
            ),
        ):
            manifest = provisioner.provision("relay-role-security-contract")

        self.assertEqual(manifest.state, ProvisioningState.FIXTURE_READY)
        self.assertEqual(set(manifest.services), {"station", "relay"})
        self.assertFalse(manifest.cleanup_registered)
        self.assertEqual(manifest.cleanup_resources, ())
        self.assertEqual(provisioner.cleanup(), ())

    def test_runtime_status_accepts_prefixed_binary_digest(self) -> None:
        evidence = _validate_runtime_status(
            _status("relay", 202),
            config=_config("relay"),
            source_commit=COMMIT,
        )

        self.assertEqual(evidence["binarySha256"], BINARY_SHA256)

    def test_runtime_status_rejects_source_drift(self) -> None:
        status = _status("relay", 202)
        status["sourceCommit"] = "d" * 40

        with self.assertRaisesRegex(BlockedError, "does not match source"):
            _validate_runtime_status(
                status,
                config=_config("relay"),
                source_commit=COMMIT,
            )

    def test_secret_audit_requires_restricted_acl_and_live_binary(self) -> None:
        payload = {
            "secretRootExists": True,
            "rootAclProtected": True,
            "principals": [
                "SIXWIN\\Administrator",
                "NT AUTHORITY\\SYSTEM",
            ],
            "unexpectedPrincipals": [],
            "requiredSecretFiles": [
                _protected_file("auth-secret"),
                _protected_file("relay-operator.key"),
                _protected_file("relay-signing.key"),
                _protected_file("relay-tls.key"),
                _protected_file("relay.crt"),
            ],
            "binarySha256": BINARY_SHA256,
            "processBinaryMatches": True,
            "stationDatabasePath": "C:\\runtime\\sixwin-station\\data\\station.db",
            "stationDatabaseExists": True,
            "relayDatabasePath": "C:\\runtime\\sixwin-relay\\data\\relay.db",
            "relayDatabaseExists": True,
        }
        transport = MagicMock()
        transport.run_argv.return_value = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout=json.dumps(payload),
            stderr="",
        )

        with patch(
            "tooling.acceptance.provisioners.station_access_relay_role."
            "_windows_transport",
            return_value=transport,
        ):
            evidence = _relay_runtime_security(
                _config("relay"),
                _status("relay", 202),
                _validate_runtime_status(
                    _status("station", 101),
                    config=_config("station"),
                    source_commit=COMMIT,
                ),
            )

        self.assertTrue(evidence["rootAclProtected"])
        protected_files = {
            record["name"]: record
            for record in evidence["requiredProtectedFiles"]
        }
        self.assertTrue(
            protected_files["relay-tls.key"]["protected"]
        )
        command = transport.run_argv.call_args.args[0]
        self.assertIn("Join-Path $env:USERPROFILE", command[-1])
        self.assertIn("$fileAcl=Get-Acl -LiteralPath $path", command[-1])
        self.assertIn("expectedPrincipalsPresent", command[-1])

    def test_secret_audit_rejects_unsafe_file_acl(self) -> None:
        payload = {
            "secretRootExists": True,
            "rootAclProtected": True,
            "principals": [
                "SIXWIN\\Administrator",
                "NT AUTHORITY\\SYSTEM",
            ],
            "unexpectedPrincipals": [],
            "requiredSecretFiles": [
                _protected_file("auth-secret"),
                _protected_file("relay-operator.key"),
                _protected_file("relay-signing.key"),
                {
                    **_protected_file("relay-tls.key"),
                    "unexpectedPrincipals": ["BUILTIN\\Users"],
                    "protected": False,
                },
                _protected_file("relay.crt"),
            ],
            "binarySha256": BINARY_SHA256,
            "processBinaryMatches": True,
            "stationDatabasePath": "C:\\runtime\\sixwin-station\\data\\station.db",
            "stationDatabaseExists": True,
            "relayDatabasePath": "C:\\runtime\\sixwin-relay\\data\\relay.db",
            "relayDatabaseExists": True,
        }
        transport = MagicMock()
        transport.run_argv.return_value = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout=json.dumps(payload),
            stderr="",
        )

        with (
            patch(
                "tooling.acceptance.provisioners.station_access_relay_role."
                "_windows_transport",
                return_value=transport,
            ),
            self.assertRaisesRegex(
                BlockedError,
                "security ownership is incomplete",
            ),
        ):
            _relay_runtime_security(
                _config("relay"),
                _status("relay", 202),
                _validate_runtime_status(
                    _status("station", 101),
                    config=_config("station"),
                    source_commit=COMMIT,
                ),
            )


if __name__ == "__main__":
    unittest.main()
