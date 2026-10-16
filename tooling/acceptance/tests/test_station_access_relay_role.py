from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from tooling.acceptance.core import (
    ActorIdentity,
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
from tooling.acceptance.provisioners.posix_service_runtime import (
    PosixServiceRuntimeConfig,
)
from tooling.acceptance.provisioners.station_access_relay_role import (
    DESKTOP_RELAY_NATIVE_GATE_ID,
    NODE_CONNECTIVITY_NATIVE_GATE_ID,
    NODE_CONNECTIVITY_STORAGE_MARKER,
    NODE_CONNECTIVITY_STORAGE_ROOTS_ENV,
    _prepare_node_connectivity_storage,
    _relay_discovery_endpoint,
    _relay_peer_identity,
    _service_source_compatibility,
    _station_compose_environment_file,
    _station_runtime_config,
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
        deploy_path=f"peers-touch/{role}",
        runtime_path=f".peers-touch/runtime/{role}",
        http_port=http_port,
        public_port=18080 if role == "station" else 18081,
        libp2p_port=4001 if role == "relay" else None,
        public_base_url=f"http://{role}.example:{http_port}",
        compose_project=f"pt-{role}",
        compose_service=role,
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
        "libp2pPort": 4001 if role == "relay" else None,
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
                "_relay_peer_identity",
                return_value="relay-peer",
            ),
            patch(
                "tooling.acceptance.provisioners.station_access_relay_role."
                "produce_station_attestation",
                return_value=_attestation("station", "station"),
            ),
            patch(
                "tooling.acceptance.provisioners.station_access_relay_role."
                "_persist_station_origin_attestation",
                return_value=_attestation("station-origin", "station"),
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
            {
                "station",
                "station-origin",
                "relay",
                "station-via-relay",
            },
        )
        self.assertEqual(manifest.clients, ())
        self.assertFalse(manifest.cleanup_registered)
        self.assertEqual(manifest.cleanup_resources, ())
        self.assertEqual(provisioner._relay_trust_anchor, b"certificate")
        self.assertEqual(provisioner.cleanup(), ())

    def test_desktop_relay_gate_declares_native_station_binding(self) -> None:
        provisioner = StationAccessRelayRoleProvisioner(self.contract)
        lifecycle_order: list[str] = []
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
            patch.multiple(
                provisioner,
                acquire_profile_lease=Mock(),
                acquire_remote_git_source_lease=Mock(),
                _activate_direct_station_proxy=Mock(
                    side_effect=lambda **_: (
                        lifecycle_order.append("station-restart")
                        or "https://station-proxy.example"
                    ),
                ),
                _prepare_native_relay_fixture=Mock(
                    side_effect=lambda **_: lifecycle_order.append(
                        "relay-fixture"
                    )
                ),
            ),
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
                "_relay_peer_identity",
                return_value="relay-peer",
            ),
            patch(
                "tooling.acceptance.provisioners.station_access_relay_role."
                "_persist_direct_station_attestation",
                return_value=_attestation("station", "station"),
            ),
            patch(
                "tooling.acceptance.provisioners.station_access_relay_role."
                "_persist_station_origin_attestation",
                return_value=_attestation("station-origin", "station"),
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
                "relay_discovery_endpoint"
            ],
            "https://relay.example:18081",
        )
        self.assertEqual(
            (client.gateway_port, client.renderer_port, client.webdriver_port),
            (18101, 18102, 18103),
        )
        self.assertEqual(
            lifecycle_order,
            ["station-restart", "relay-fixture"],
        )
        self.assertTrue(manifest.cleanup_registered)
        self.assertEqual(
            manifest.cleanup_resources,
            ("processes", "ports", "storage", "sessions"),
        )
        self.assertEqual(len(provisioner.cleanup()), 1)

    def test_ncp_native_gate_allocates_two_relay_bound_existing_actors(
        self,
    ) -> None:
        provisioner = StationAccessRelayRoleProvisioner(self.contract)
        lifecycle_order: list[str] = []
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
        actor_ref = {
            "artifactKind": "acceptance-artifact-ref",
            "workspaceId": "1" * 16,
            "gateId": NODE_CONNECTIVITY_NATIVE_GATE_ID,
            "runId": "20261006T100000000000Z-" + "2" * 32,
            "path": "runtime/actor-manifest.json",
            "sha256": "3" * 64,
            "mediaType": "application/json",
        }

        def resolve_source_identity(
            deployment: str,
        ) -> tuple[str, str, str]:
            self.assertEqual(
                lifecycle_order[:4],
                [
                    "profile-lease:station-1",
                    "profile-lease:relay-1",
                    "source-lease:station-1",
                    "source-lease:relay-1",
                ],
            )
            lifecycle_order.append(f"source-identity:{deployment}")
            return COMMIT, "clean", PROTO_DIGEST

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
            patch.multiple(
                provisioner,
                acquire_profile_lease=Mock(
                    side_effect=lambda resource, _owner: lifecycle_order.append(
                        f"profile-lease:{resource}"
                    )
                ),
                acquire_remote_git_source_lease=Mock(
                    side_effect=lambda resource, _owner: lifecycle_order.append(
                        f"source-lease:{resource}"
                    )
                ),
                _activate_direct_station_proxy=Mock(
                    side_effect=lambda **_: (
                        lifecycle_order.append("station-restart")
                        or "https://station-proxy.example"
                    ),
                ),
                _prepare_native_relay_fixture=Mock(
                    side_effect=lambda **_: lifecycle_order.append(
                        "relay-fixture"
                    )
                ),
            ),
            patch(
                "tooling.acceptance.provisioners.station_access_relay_role."
                "PosixServiceRuntimeConfig.load",
                side_effect=(_config("station"), _config("relay")),
            ),
            patch(
                "tooling.acceptance.provisioners.station_access_relay_role."
                "resolve_remote_source_identity",
                side_effect=resolve_source_identity,
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
                "_relay_peer_identity",
                return_value="relay-peer",
            ),
            patch(
                "tooling.acceptance.provisioners.station_access_relay_role."
                "_persist_direct_station_attestation",
                return_value=_attestation("station", "station"),
            ),
            patch(
                "tooling.acceptance.provisioners.station_access_relay_role."
                "_persist_station_origin_attestation",
                return_value=_attestation("station-origin", "station"),
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
            patch(
                "tooling.acceptance.provisioners.station_access_relay_role."
                "_available_ports",
                return_value=(
                    18101,
                    18102,
                    18103,
                    18111,
                    18112,
                    18113,
                ),
            ),
            patch(
                "tooling.acceptance.provisioners.station_access_relay_role."
                "resolve_existing_actor_identity",
                side_effect=lambda _url, role: ActorIdentity(
                    role=role,
                    account_ref=f"station-account:{role}@p.t",
                    ptid=f"ptid:{role}",
                ),
            ) as resolve_actor,
            patch(
                "tooling.acceptance.provisioners.station_access_relay_role."
                "_prepare_node_connectivity_storage",
                return_value={
                    "alice": Path("/state/alice"),
                    "bob": Path("/state/bob"),
                },
            ) as prepare_storage,
            patch(
                "tooling.acceptance.provisioners.station_access_relay_role."
                "persist_actor_manifest",
                return_value=(SimpleNamespace(), Path("/actors"), actor_ref),
            ) as persist_actors,
        ):
            manifest = provisioner.provision(
                NODE_CONNECTIVITY_NATIVE_GATE_ID
            )

        self.assertEqual(manifest.state, ProvisioningState.FIXTURE_READY)
        self.assertEqual(
            tuple(client.id for client in manifest.clients),
            ("alice", "bob"),
        )
        self.assertEqual(
            {
                client.id: client.service_bindings["station"].service_id
                for client in manifest.clients
            },
            {
                "alice": "station",
                "bob": "station-via-relay",
            },
        )
        self.assertEqual(
            len({client.storage_root for client in manifest.clients}),
            2,
        )
        self.assertEqual(
            {client.storage_lifecycle for client in manifest.clients},
            {"persistent"},
        )
        self.assertEqual(
            len({client.webdriver_port for client in manifest.clients}),
            2,
        )
        self.assertEqual(manifest.actor_manifest_ref, actor_ref)
        self.assertEqual(
            manifest.credential_refs,
            ("fixture:apps/station/app/conf/actor.yml#preset_users",),
        )
        self.assertEqual(resolve_actor.call_count, 2)
        actor_manifest = persist_actors.call_args.args[0]
        self.assertEqual(actor_manifest.initial_state, "existing")
        self.assertFalse(actor_manifest.reset_authorized)
        self.assertTrue(actor_manifest.target_verified)
        self.assertEqual(
            {actor.device_policy for actor in actor_manifest.actors},
            {"persistent-acceptance"},
        )
        self.assertEqual(
            lifecycle_order,
            [
                "profile-lease:station-1",
                "profile-lease:relay-1",
                "source-lease:station-1",
                "source-lease:relay-1",
                "source-identity:station-1",
                "source-identity:relay-1",
                "station-restart",
                "relay-fixture",
            ],
        )
        prepare_storage.assert_called_once()
        self.assertEqual(len(provisioner.cleanup()), 0)

    def test_ncp_storage_reuses_actor_bound_persistent_roots(self) -> None:
        actors = (
            ActorIdentity(
                role="alice",
                account_ref="station-account:alice@p.t",
                ptid="ptid:alice",
                device_policy="persistent-acceptance",
            ),
            ActorIdentity(
                role="bob",
                account_ref="station-account:bob@p.t",
                ptid="ptid:bob",
                device_policy="persistent-acceptance",
            ),
        )
        with tempfile.TemporaryDirectory() as temporary:
            alice = Path(temporary) / "alice"
            bob = Path(temporary) / "bob"
            with patch.dict(
                os.environ,
                {
                    NODE_CONNECTIVITY_STORAGE_ROOTS_ENV: (
                        f"{alice},{bob}"
                    )
                },
            ):
                first = _prepare_node_connectivity_storage(
                    profile_name="one",
                    station_peer_id="station-peer",
                    actors=actors,
                    run_id="run-1",
                )
                sentinel = first["alice"] / "identity-state"
                sentinel.write_text("retained", encoding="utf-8")
                second = _prepare_node_connectivity_storage(
                    profile_name="one",
                    station_peer_id="station-peer",
                    actors=actors,
                    run_id="run-2",
                )

            self.assertEqual(first, second)
            self.assertEqual(
                sentinel.read_text(encoding="utf-8"),
                "retained",
            )
            marker = json.loads(
                (
                    first["alice"] / NODE_CONNECTIVITY_STORAGE_MARKER
                ).read_text(encoding="utf-8")
            )
            self.assertEqual(marker["actorPtid"], "ptid:alice")
            self.assertEqual(marker["stationPeerId"], "station-peer")
            self.assertEqual(
                marker["devicePolicy"],
                "persistent-acceptance",
            )

    def test_ncp_storage_rejects_actor_identity_drift_without_deletion(
        self,
    ) -> None:
        actors = (
            ActorIdentity(
                role="alice",
                account_ref="station-account:alice@p.t",
                ptid="ptid:alice",
            ),
            ActorIdentity(
                role="bob",
                account_ref="station-account:bob@p.t",
                ptid="ptid:bob",
            ),
        )
        with tempfile.TemporaryDirectory() as temporary:
            alice = Path(temporary) / "alice"
            bob = Path(temporary) / "bob"
            with patch.dict(
                os.environ,
                {
                    NODE_CONNECTIVITY_STORAGE_ROOTS_ENV: (
                        f"{alice},{bob}"
                    )
                },
            ):
                _prepare_node_connectivity_storage(
                    profile_name="one",
                    station_peer_id="station-peer",
                    actors=actors,
                    run_id="run-1",
                )
                sentinel = alice / "identity-state"
                sentinel.write_text("retained", encoding="utf-8")
                changed = (
                    ActorIdentity(
                        role="alice",
                        account_ref="station-account:alice@p.t",
                        ptid="ptid:alice-replaced",
                    ),
                    actors[1],
                )

                with self.assertRaisesRegex(
                    BlockedError,
                    "storage identity does not match",
                ):
                    _prepare_node_connectivity_storage(
                        profile_name="one",
                        station_peer_id="station-peer",
                        actors=changed,
                        run_id="run-2",
                    )

            self.assertEqual(
                sentinel.read_text(encoding="utf-8"),
                "retained",
            )

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


    def test_runtime_wait_allows_http_ready_to_reach_docker_healthy(
        self,
    ) -> None:
        expected = _status("station", 101)
        with (
            patch(
                "tooling.acceptance.provisioners.station_access_relay_role."
                "inspect_posix_runtime",
                side_effect=(
                    BlockedError(
                        reason="runtime is starting",
                        resource="runtime-status:station",
                    ),
                    expected,
                ),
            ) as inspect_runtime,
            patch(
                "tooling.acceptance.provisioners.station_access_relay_role."
                "time.sleep",
            ),
        ):
            result = StationAccessRelayRoleProvisioner._wait_posix_runtime(
                _config("station"),
            )

        self.assertEqual(result, expected)
        self.assertEqual(inspect_runtime.call_count, 2)

    def test_disposable_station_runtime_uses_reviewed_acceptance_topology(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            environment = Path(directory) / "station.env.example"
            environment.write_text(
                "\n".join(
                    (
                        "PT_DEPLOY_HOST=192.0.2.30",
                        "PT_DEPLOY_USER=operator",
                        "PT_DEPLOY_PATH=peers-touch/acceptance/station/repo",
                        "PT_DEPLOY_ROLE=station",
                        "PT_DEPLOY_PLATFORM=posix",
                        "PT_DEPLOY_RESTART_CMD='docker compose --env-file "
                        "$HOME/peers-touch/branches/chat/.env up -d station'",
                        "PT_ACCEPTANCE_DISPOSABLE=1",
                        "PT_ACCEPTANCE_STATION_URL=http://192.0.2.30:18132",
                        "PT_ACCEPTANCE_COMPOSE_PROJECT=pt-chat",
                        "PT_ACCEPTANCE_STATION_CONTAINER=pt-chat-station-1",
                    )
                )
                + "\n",
                encoding="utf-8",
            )
            with patch(
                "tooling.acceptance.provisioners.station_access_relay_role."
                "resolve_deployment_environment_path",
                return_value=environment,
            ):
                config = _station_runtime_config("chat-station")
                env_file = _station_compose_environment_file(
                    config,
                    "/home/operator",
                )

        self.assertEqual(config.compose_project, "pt-chat")
        self.assertEqual(config.data_volume, "pt-chat_peers_data")
        self.assertEqual(config.http_port, 18132)
        self.assertEqual(
            env_file,
            "/home/operator/peers-touch/branches/chat/.env",
        )

    def test_disposable_station_restart_keeps_env_owned_libp2p_port(
        self,
    ) -> None:
        config = _config("station")
        transport = Mock()
        transport.run_argv.return_value = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout="",
            stderr="",
        )
        config.transport = Mock(return_value=transport)
        with (
            patch.object(
                PosixServiceRuntimeConfig,
                "transport",
                return_value=transport,
            ),
            patch.object(
                StationAccessRelayRoleProvisioner,
                "_remote_home",
                return_value="/home/operator",
            ),
            patch(
                "tooling.acceptance.provisioners.station_access_relay_role."
                "resolve_deployment_environment_path",
                return_value=Path("/tmp/station.env"),
            ),
            patch(
                "tooling.acceptance.provisioners.station_access_relay_role."
                "load_env_file",
                return_value={
                    "PT_DEPLOY_RESTART_CMD": (
                        "docker compose --env-file "
                        "$HOME/peers-touch/station.env up -d station"
                    )
                },
            ),
        ):
            StationAccessRelayRoleProvisioner._restart_station_origin(
                config,
                "https://station.example",
            )

        argv = transport.run_argv.call_args.args[0]
        self.assertIn(
            "PEERS_NODE_SERVER_BASEURL=https://station.example",
            argv,
        )
        self.assertFalse(
            any(value.startswith("LIBP2P_PORT=") for value in argv)
        )

    def test_relay_ca_install_restarts_the_same_station_container(self) -> None:
        provisioner = StationAccessRelayRoleProvisioner(self.contract)
        provisioner._manifest = SimpleNamespace(run_id="run-1")
        config = _config("station")
        transport = Mock()
        transport.run_argv.return_value = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout="",
            stderr="",
        )
        config.transport = Mock(return_value=transport)
        runtime_status = {
            "containerId": "station-container",
            "healthy": True,
        }
        with (
            patch.object(
                provisioner,
                "_wait_posix_runtime",
                side_effect=(runtime_status, runtime_status),
            ) as wait_runtime,
            patch.object(
                provisioner,
                "_remote_home",
                return_value="/home/operator",
            ),
        ):
            provisioner._install_station_relay_ca(
                config,
                b"certificate",
            )

        commands = [
            call.args[0] for call in transport.run_argv.call_args_list
        ]
        update_index = commands.index(
            (
                "docker",
                "exec",
                "station-container",
                "update-ca-certificates",
            )
        )
        restart_index = commands.index(
            ("docker", "restart", "station-container")
        )
        self.assertLess(update_index, restart_index)
        self.assertEqual(wait_runtime.call_count, 2)

    def test_runtime_status_rejects_source_drift(self) -> None:
        status = _status("relay", 202)
        status["sourceCommit"] = "d" * 40

        with self.assertRaisesRegex(BlockedError, "does not match source"):
            _validate_runtime_status(
                status,
                config=_config("relay"),
                source_commit=COMMIT,
            )

    def test_runtime_status_accepts_proven_service_tree_equivalence(
        self,
    ) -> None:
        status = _status("relay", 202)
        status["sourceCommit"] = "d" * 40
        status["buildCommit"] = "d" * 40
        compatibility = {
            "mode": "service-tree-equivalent",
            "runtimeCommit": "d" * 40,
            "sourceCommit": COMMIT,
            "changedPathCount": 2,
            "changedPathsSha256": "e" * 64,
        }

        with patch(
            "tooling.acceptance.provisioners.station_access_relay_role."
            "_service_source_compatibility",
            return_value=compatibility,
        ):
            evidence = _validate_runtime_status(
                status,
                config=_config("relay"),
                source_commit=COMMIT,
            )

        self.assertEqual(
            evidence["sourceCompatibility"]["runtime"]["mode"],
            "service-tree-equivalent",
        )
        self.assertEqual(
            evidence["sourceCompatibility"]["build"]["changedPathCount"],
            2,
        )

    def test_source_compatibility_allows_only_client_and_acceptance_drift(
        self,
    ) -> None:
        completed = SimpleNamespace(
            stdout=(
                "apps/desktop/src-tauri/src/infrastructure/"
                "station_discovery.rs\n"
                "tooling/acceptance/drivers/native/runtime.py\n"
            )
        )
        with patch(
            "tooling.acceptance.provisioners.station_access_relay_role."
            "subprocess.run",
            return_value=completed,
        ):
            compatibility = _service_source_compatibility(
                "d" * 40,
                COMMIT,
            )

        self.assertIsNotNone(compatibility)
        self.assertEqual(
            compatibility["mode"],
            "service-tree-equivalent",
        )
        self.assertEqual(compatibility["changedPathCount"], 2)

    def test_source_compatibility_rejects_station_runtime_drift(self) -> None:
        completed = SimpleNamespace(
            stdout="apps/station/app/main.go\n"
        )
        with patch(
            "tooling.acceptance.provisioners.station_access_relay_role."
            "subprocess.run",
            return_value=completed,
        ):
            compatibility = _service_source_compatibility(
                "d" * 40,
                COMMIT,
            )

        self.assertIsNone(compatibility)

    def test_source_compatibility_rejects_missing_runtime_commit(self) -> None:
        with patch(
            "tooling.acceptance.provisioners.station_access_relay_role."
            "subprocess.run",
        ) as run:
            compatibility = _service_source_compatibility("", COMMIT)

        self.assertIsNone(compatibility)
        run.assert_not_called()

    def test_relay_discovery_endpoint_uses_public_https_listener(self) -> None:
        self.assertEqual(
            _relay_discovery_endpoint(
                "https://relay.example:18081",
                {"publicPort": 18081},
            ),
            "https://relay.example:18081",
        )

    def test_relay_discovery_endpoint_rejects_missing_public_port(self) -> None:
        with self.assertRaisesRegex(
            BlockedError,
            "no valid public HTTPS endpoint",
        ):
            _relay_discovery_endpoint(
                "https://relay.example:18081",
                {"publicPort": None},
            )

    def test_relay_peer_identity_is_bound_to_attested_https_health(
        self,
    ) -> None:
        context = Mock()
        response = Mock()
        response.status = 200
        response.geturl.return_value = (
            "https://relay.example:18081/healthz"
        )
        response.read.return_value = json.dumps(
            {
                "role": "relay",
                "status": "ready",
                "peer_id": "12D3KooWRelay",
            }
        ).encode("utf-8")
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)

        with (
            patch(
                "tooling.acceptance.provisioners."
                "station_access_relay_role.ssl.SSLContext",
                return_value=context,
            ),
            patch(
                "tooling.acceptance.provisioners."
                "station_access_relay_role.urllib.request.urlopen",
                return_value=response,
            ),
        ):
            peer_id = _relay_peer_identity(
                "https://relay.example:18081",
                "https://relay.example:18081/healthz",
                b"certificate",
            )

        self.assertEqual(peer_id, "12D3KooWRelay")
        context.load_verify_locations.assert_called_once_with(
            cadata="certificate"
        )

if __name__ == "__main__":
    unittest.main()
