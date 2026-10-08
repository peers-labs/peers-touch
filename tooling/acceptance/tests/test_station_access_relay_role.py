from __future__ import annotations

import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

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
    DESKTOP_RELAY_NATIVE_GATE_ID,
    _relay_route_endpoint,
    _validate_runtime_status,
)


COMMIT = "a" * 40
PROTO_DIGEST = "c" * 64


def _config(role: str) -> SimpleNamespace:
    http_port = 18080 if role == "station" else 18082
    return SimpleNamespace(
        environment_name=f"one-{role}",
        role=role,
        host=f"{role}.example",
        user="operator",
        ssh_port=22,
        known_hosts_file="",
        http_port=http_port,
        public_port=18080 if role == "station" else 18081,
        stream_port=4501 if role == "relay" else None,
        data_volume=f"pt-{role}_peers_data",
    )


def _status(role: str, process_id: int) -> dict[str, object]:
    return {
        "artifactKind": "posix-compose-runtime-status",
        "environmentName": f"one-{role}",
        "platform": "linux",
        "role": role,
        "processIds": [process_id],
        "healthy": True,
        "runtimeOwner": f"docker-compose:pt-{role}/{role}",
        "runtimePath": f"/home/operator/peers-touch/{role}",
        "containerId": role + "-container",
        "sourceCommit": COMMIT,
        "buildCommit": COMMIT,
        "buildTime": "2026-10-08T00:00:00Z",
        "sourceClean": True,
        "imageDigest": "sha256:" + "b" * 64,
        "dataOwner": f"pt-{role}_peers_data",
        "httpPort": 18080 if role == "station" else 18082,
        "publicPort": 18080 if role == "station" else 18081,
        "streamPort": 4501 if role == "relay" else None,
    }


def _attestation(service_id: str, kind: str) -> ServiceAttestation:
    return ServiceAttestation(
        service_id=service_id,
        service_kind=kind,
        environment_id="station-access-relay-role",
        deployment_environment=f"one-{service_id}",
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

    def test_attach_only_provisioning_emits_route_service_without_cleanup(
        self,
    ) -> None:
        provisioner = StationAccessRelayRoleProvisioner(self.contract)
        profile = {
            "PT_STATION_MODE": "remote",
            "PT_STATION_URL": "http://station.example",
            "PT_STATION_HEALTH_URL": "http://station.example/healthz",
            "PT_STATION_DEPLOY_ENV": "station-1",
            "PT_RELAY_MODE": "remote",
            "PT_RELAY_URL": "https://relay.example:18081",
            "PT_RELAY_HEALTH_URL": "https://relay.example:18081/healthz",
            "PT_RELAY_DEPLOY_ENV": "relay-1",
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
                return_value=("one", Path("/profile"), 0, profile),
            ),
            patch.object(provisioner, "_station_ready", return_value=True),
            patch(
                "tooling.acceptance.provisioners.station_access_relay_role."
                "PosixServiceRuntimeConfig.load",
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
                "inspect_posix_runtime",
                side_effect=(_status("station", 101), _status("relay", 202)),
            ),
            patch(
                "tooling.acceptance.provisioners.station_access_relay_role."
                "audit_posix_relay_security",
                return_value={"rootAclProtected": True},
            ),
            patch(
                "tooling.acceptance.provisioners.station_access_relay_role."
                "resolve_posix_relay_trust_anchor",
                return_value=(b"certificate", "sha256:" + "d" * 64),
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
            patch(
                "tooling.acceptance.provisioners.station_access_relay_role."
                "_persist_station_route_attestation",
                return_value=_attestation("station-via-relay", "station"),
            ),
        ):
            manifest = provisioner.provision("relay-role-security-contract")

        self.assertEqual(manifest.state, ProvisioningState.FIXTURE_READY)
        self.assertEqual(
            set(manifest.services),
            {"station", "relay", "station-via-relay"},
        )
        self.assertEqual(manifest.clients, ())
        self.assertFalse(manifest.cleanup_registered)
        self.assertEqual(manifest.cleanup_resources, ())
        self.assertEqual(provisioner.cleanup(), ())

    def test_desktop_relay_gate_declares_native_station_binding(self) -> None:
        provisioner = StationAccessRelayRoleProvisioner(self.contract)
        profile = {
            "PT_STATION_MODE": "remote",
            "PT_STATION_URL": "http://station.example",
            "PT_STATION_HEALTH_URL": "http://station.example/healthz",
            "PT_STATION_DEPLOY_ENV": "station-1",
            "PT_RELAY_MODE": "remote",
            "PT_RELAY_URL": "https://relay.example:18081",
            "PT_RELAY_HEALTH_URL": "https://relay.example:18081/healthz",
            "PT_RELAY_DEPLOY_ENV": "relay-1",
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
                return_value=("one", Path("/profile"), 0, profile),
            ),
            patch.object(provisioner, "_station_ready", return_value=True),
            patch(
                "tooling.acceptance.provisioners.station_access_relay_role."
                "PosixServiceRuntimeConfig.load",
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
                "inspect_posix_runtime",
                side_effect=(_status("station", 101), _status("relay", 202)),
            ),
            patch(
                "tooling.acceptance.provisioners.station_access_relay_role."
                "audit_posix_relay_security",
                return_value={"rootAclProtected": True},
            ),
            patch(
                "tooling.acceptance.provisioners.station_access_relay_role."
                "resolve_posix_relay_trust_anchor",
                return_value=(b"certificate", "sha256:" + "d" * 64),
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
            patch(
                "tooling.acceptance.provisioners.station_access_relay_role."
                "_persist_station_route_attestation",
                return_value=_attestation("station-via-relay", "station"),
            ) as persist_station_route,
            patch(
                "tooling.acceptance.provisioners.station_access_relay_role."
                "_available_ports",
                return_value=(18101, 18102, 18103),
            ),
        ):
            manifest = provisioner.provision(DESKTOP_RELAY_NATIVE_GATE_ID)

        self.assertEqual(manifest.state, ProvisioningState.FIXTURE_READY)
        self.assertEqual(len(manifest.clients), 1)
        client = manifest.clients[0]
        self.assertEqual(client.id, "desktop-relay")
        self.assertEqual(client.runtime, "native-tauri")
        self.assertEqual(client.required_service_roles, ("station",))
        self.assertEqual(
            client.service_bindings["station"].service_id,
            "station-via-relay",
        )
        persist_station_route.assert_called_once()
        self.assertEqual(
            persist_station_route.call_args.kwargs["relay_locator"],
            "https://relay.example:18081",
        )
        self.assertEqual(
            persist_station_route.call_args.kwargs[
                "relay_transport_endpoint"
            ],
            "https://relay.example:18081",
        )
        self.assertEqual(
            (client.gateway_port, client.renderer_port, client.webdriver_port),
            (18101, 18102, 18103),
        )
        self.assertTrue(manifest.cleanup_registered)
        self.assertEqual(manifest.cleanup_resources, ("storage",))
        self.assertEqual(len(provisioner.cleanup()), 1)

    def test_runtime_status_accepts_linux_compose_identity(self) -> None:
        evidence = _validate_runtime_status(
            _status("relay", 202),
            config=_config("relay"),
            source_commit=COMMIT,
        )

        self.assertEqual(
            evidence["runtimeOwner"],
            "docker-compose:pt-relay/relay",
        )
        self.assertEqual(evidence["platform"], "linux")

    def test_runtime_status_rejects_source_drift(self) -> None:
        status = _status("relay", 202)
        status["sourceCommit"] = "d" * 40

        with self.assertRaisesRegex(BlockedError, "does not match source"):
            _validate_runtime_status(
                status,
                config=_config("relay"),
                source_commit=COMMIT,
            )

    def test_relay_route_endpoint_uses_public_https_listener(self) -> None:
        self.assertEqual(
            _relay_route_endpoint(
                "https://relay.example:18081",
                {"publicPort": 18081},
            ),
            "https://relay.example:18081",
        )

    def test_relay_route_endpoint_rejects_missing_public_port(self) -> None:
        with self.assertRaisesRegex(
            BlockedError,
            "no valid public HTTPS endpoint",
        ):
            _relay_route_endpoint(
                "https://relay.example:18081",
                {"publicPort": None},
            )

if __name__ == "__main__":
    unittest.main()
