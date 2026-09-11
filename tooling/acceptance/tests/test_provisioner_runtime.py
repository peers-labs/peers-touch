#!/usr/bin/env python3
"""Provisioner runtime tests."""

from __future__ import annotations

import socket
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling.acceptance.core import (
    BlockedError,
    ClientRuntime,
    ClientServiceBinding,
    CredentialRef,
    EnvironmentContract,
    EnvironmentClient,
    EnvironmentProvisioner,
    ProvisioningError,
    ProvisioningState,
    ServiceAttestation,
)
from tooling.acceptance.core._paths import ENVIRONMENTS_DIR
from tooling.acceptance.provisioners import (
    HomeStationProvisioner,
    MobileNativeProvisioner,
    NativeTauriEmbeddedWebDriverProvisioner,
    get_provisioner,
)


class ProvisionerBaseClassTests(unittest.TestCase):
    def test_provisioner_requires_environment_id(self):
        class BadProvisioner(EnvironmentProvisioner):
            def provision(self, gate_id):
                return None

        with self.assertRaises(ProvisioningError):
            BadProvisioner(EnvironmentContract(id="test"))

    def test_provisioner_rejects_mismatched_contract(self):
        with self.assertRaisesRegex(ProvisioningError, "does not match"):
            HomeStationProvisioner(EnvironmentContract(id="wrong-env"))

    def test_get_provisioner_unknown_environment(self):
        with self.assertRaisesRegex(ProvisioningError, "no provisioner registered"):
            get_provisioner(EnvironmentContract(id="nonexistent-env"))

    def test_mobile_native_provisioner_is_registered(self):
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "mobile-native.yaml"
        )
        self.assertIsInstance(
            get_provisioner(contract),
            MobileNativeProvisioner,
        )

    def test_cleanup_runs_in_reverse_order(self):
        provisioner = HomeStationProvisioner(
            EnvironmentContract(id="home-station")
        )
        order = []
        provisioner.register_cleanup("first", lambda: order.append("first"))
        provisioner.register_cleanup("second", lambda: order.append("second"))
        completed = provisioner.cleanup()
        self.assertEqual(order, ["second", "first"])
        self.assertEqual(completed, ("second", "first"))

    def test_ready_requires_every_required_service_attestation(self):
        provisioner = HomeStationProvisioner(
            EnvironmentContract.from_yaml(
                ENVIRONMENTS_DIR / "home-station.yaml"
            )
        )
        manifest = provisioner._new_base_manifest("test-gate")
        with self.assertRaisesRegex(
            BlockedError,
            "has no runtime attestation",
        ):
            provisioner._ready(manifest)


class ProfileResolutionTests(unittest.TestCase):
    def test_missing_active_profile_blocks(self):
        provisioner = get_provisioner(
            EnvironmentContract.from_yaml(
                ENVIRONMENTS_DIR / "home-station.yaml"
            )
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            fake_worktree = Path(tmpdir) / "fake-worktree"
            fake_worktree.mkdir()
            with patch(
                "tooling.acceptance.core.provisioner.REPO_ROOT",
                fake_worktree,
            ):
                with self.assertRaisesRegex(BlockedError, "No active profile"):
                    provisioner._resolve_active_profile()

    def test_profile_identity_mismatch_blocks(self):
        provisioner = get_provisioner(
            EnvironmentContract.from_yaml(
                ENVIRONMENTS_DIR / "home-station.yaml"
            )
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            fake_worktree = Path(tmpdir) / "peers-oss"
            profile_dir = fake_worktree / ".local" / "dev" / "profiles"
            active_dir = fake_worktree / ".local" / "dev" / "active"
            profile_dir.mkdir(parents=True)
            active_dir.mkdir(parents=True)
            profile = profile_dir / "expected.env"
            profile.write_text(
                "PT_DEV_PROFILE=other\nPT_DEV_SLOT=1\n",
                encoding="utf-8",
            )
            (active_dir / "peers-oss.env").symlink_to(profile)
            with patch(
                "tooling.acceptance.core.provisioner.REPO_ROOT",
                fake_worktree,
            ):
                with self.assertRaisesRegex(BlockedError, "identity mismatch"):
                    provisioner._resolve_active_profile()


class ProvisionerBlockingTests(unittest.TestCase):
    @staticmethod
    def _station_attestation(commit: str = "abc1234") -> ServiceAttestation:
        return ServiceAttestation(
            service_id="station",
            service_kind="station",
            environment_id="home-station",
            deployment_environment="station-1",
            endpoint="http://station.example:18080",
            live_commit=commit,
            workspace_digest="clean",
            protocol_digest="proto-digest",
            artifact_ref={
                "artifactKind": "acceptance-artifact-ref",
                "workspaceId": "0" * 16,
                "gateId": "agent-v2-kernel-foundation-e2e",
                "runId": "20260817T000000000000Z-" + "0" * 32,
                "path": "runtime/attestation.json",
                "sha256": "0" * 64,
                "mediaType": "application/json",
            },
            produced_at="2026-08-16T00:00:00+00:00",
            producer="station-deployment",
        )

    @staticmethod
    def _one_profile() -> tuple[str, Path, int, dict[str, str]]:
        return (
            "one",
            Path("/tmp/one.env"),
            1,
            {
                "PT_DEV_PROFILE": "one",
                "PT_DEV_SLOT": "1",
                "PT_STATION_MODE": "remote",
                "PT_STATION_URL": "http://station.example:18080",
                "PT_STATION_DEPLOY_ENV": "station-1",
                "PT_DESKTOP_APP_GATEWAY_PORT": "23030",
                "PT_DESKTOP_APP_WEB_PORT": "23210",
                "PT_DESKTOP_WEB_GATEWAY_PORT": "23031",
                "PT_DESKTOP_WEB_WEB_PORT": "23211",
                "CHAT_NATIVE_DEMO_PASSWORD": "fixture-password",
                "CHAT_ACCEPTANCE_RESET": "1",
            },
        )

    def test_native_clients_receive_distinct_webdriver_ports(self):
        provisioner = HomeStationProvisioner(
            EnvironmentContract(id="home-station")
        )
        clients = provisioner._clients(
            "chat-native-two-client-e2e",
            "run-webdriver-ports",
            2,
        )

        self.assertEqual(
            [client.webdriver_port for client in clients],
            [4465, 4466],
        )

    def test_native_clients_use_resolved_slot_not_ambient_environment(self):
        provisioner = HomeStationProvisioner(
            EnvironmentContract(id="home-station")
        )
        with patch.dict(
            "os.environ",
            {"PT_DEV_SLOT": "0"},
            clear=True,
        ):
            clients = provisioner._clients(
                "chat-native-two-client-e2e",
                "run-profile-slot",
                3,
            )

        self.assertEqual(
            [client.webdriver_port for client in clients],
            [4475, 4476],
        )

    def test_native_webdriver_port_conflict_blocks(self):
        provisioner = HomeStationProvisioner(
            EnvironmentContract(id="home-station")
        )
        with socket.socket() as listener:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind(("127.0.0.1", 4445))
            listener.listen()
            with patch.dict(
                "os.environ",
                {"PT_DEV_SLOT": "0"},
                clear=True,
            ):
                with self.assertRaisesRegex(
                    BlockedError,
                    "webdriver port 4445 is already in use",
                ):
                    provisioner._clients(
                        "chat-native-two-client-e2e",
                        "run-webdriver-conflict",
                        0,
                    )

    def test_native_actor_targets_include_non_launched_fixture_roles(self):
        clients = tuple(
            ClientRuntime(
                id=client_id,
                actor=actor,
                runtime="native-tauri",
                worktree="/repo",
                gateway_port=port,
                renderer_port=port + 100,
                webdriver_port=port + 200,
                profile=f"chat-native-{client_id}",
                storage_root=f"/tmp/{client_id}",
                required_service_roles=("station",),
                service_bindings={
                    "station": ClientServiceBinding(
                        service_id=service_id,
                        required_kind="station",
                    )
                },
            )
            for client_id, actor, service_id, port in (
                ("alice", "alice", "station-four", 3600),
                ("alice2", "alice", "station-four", 3602),
            )
        )
        declared_clients = (
            EnvironmentClient(
                id="alice",
                actor="alice",
                runtime="native-tauri",
                required_service_roles=("station",),
                service_bindings={
                    "station": ClientServiceBinding(
                        service_id="station-four",
                        required_kind="station",
                    )
                },
            ),
            EnvironmentClient(
                id="bob",
                actor="bob",
                runtime="native-tauri",
                required_service_roles=("station",),
                service_bindings={
                    "station": ClientServiceBinding(
                        service_id="station-five",
                        required_kind="station",
                    )
                },
            ),
        )
        services = {
            service_id: ServiceAttestation(
                service_id=service_id,
                service_kind="station",
                environment_id="native-tauri-embedded-webdriver",
                deployment_environment=deployment_environment,
                endpoint=endpoint,
                live_commit="a" * 40,
                workspace_digest="clean",
                protocol_digest="b" * 64,
                artifact_ref={},
                produced_at="2026-09-03T00:00:00+00:00",
                producer="station-deployment",
            )
            for service_id, deployment_environment, endpoint in (
                (
                    "station-four",
                    "chat-native-four",
                    "http://station-four:18132",
                ),
                (
                    "station-five",
                    "chat-native-five",
                    "http://station-five:18132",
                ),
            )
        }

        targets = NativeTauriEmbeddedWebDriverProvisioner._actor_role_targets(
            ("alice", "bob"),
            clients,
            declared_clients,
            services,
        )

        self.assertEqual(
            targets,
            {
                "alice": (
                    "http://station-four:18132",
                    "chat-native-four",
                ),
                "bob": (
                    "http://station-five:18132",
                    "chat-native-five",
                ),
            },
        )

    def test_agent_stream_client_uses_one_profile_and_isolated_storage(self):
        provisioner = HomeStationProvisioner(
            EnvironmentContract(id="home-station")
        )
        profile_env = {
            "PT_DESKTOP_APP_GATEWAY_PORT": "13331",
            "PT_DESKTOP_APP_WEB_PORT": "13511",
        }
        with patch.dict(
            "os.environ",
            {"PT_AGENT_STREAM_WEBDRIVER_PORT": "14449"},
            clear=True,
        ):
            client = provisioner._agent_stream_client(
                "run-stream-resilience",
                1,
                profile_env,
            )

        self.assertEqual(client.actor, "alice")
        self.assertEqual(client.profile, "one")
        self.assertEqual(client.gateway_port, 13331)
        self.assertEqual(client.renderer_port, 13511)
        self.assertEqual(client.webdriver_port, 14449)
        self.assertIn("pt-agent-stream-run-stream-resilience", client.storage_root)

    def test_agent_stream_credentials_must_come_from_one_profile(self):
        provisioner = HomeStationProvisioner(
            EnvironmentContract(id="home-station")
        )
        with self.assertRaisesRegex(
            BlockedError,
            "One profile is missing required credential",
        ):
            provisioner._export_profile_credential_refs({})

    def test_agent_attachment_client_has_separate_runtime_identity(self):
        provisioner = HomeStationProvisioner(
            EnvironmentContract(id="home-station")
        )
        profile_env = {
            "PT_DESKTOP_APP_GATEWAY_PORT": "13331",
            "PT_DESKTOP_APP_WEB_PORT": "13511",
        }
        with patch.dict(
            "os.environ",
            {"PT_AGENT_ATTACHMENT_WEBDRIVER_PORT": "14450"},
            clear=True,
        ):
            client = provisioner._agent_attachment_client(
                "run-attachment",
                1,
                profile_env,
            )

        self.assertEqual(client.actor, "alice")
        self.assertEqual(client.profile, "one")
        self.assertEqual(client.gateway_port, 13331)
        self.assertEqual(client.renderer_port, 13511)
        self.assertEqual(client.webdriver_port, 14450)
        self.assertIn("pt-agent-attachment-run-attachment", client.storage_root)

    def test_unreachable_station_returns_blocked_manifest(self):
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "home-station.yaml"
        )
        provisioner = get_provisioner(contract)
        with tempfile.TemporaryDirectory() as lease_dir, patch.dict(
            "os.environ",
            {"PT_PROFILE_LEASE_DIR": lease_dir},
            clear=True,
        ), patch.object(
            provisioner,
            "_resolve_active_profile",
            return_value=(
                "acceptance-three",
                Path("/tmp/acceptance-three.env"),
                4,
                {
                    "PT_STATION_MODE": "remote",
                    "PT_STATION_URL": "http://station.example:18080",
                    "PT_STATION_DEPLOY_ENV": "station-three",
                },
            ),
        ), patch.object(
            provisioner,
            "_git_commit",
            return_value="abc1234",
        ), patch.object(
            provisioner,
            "_git_workspace_digest",
            return_value="clean",
        ), patch.object(
            provisioner,
            "_station_ready",
            return_value=False,
        ), patch.object(
            provisioner,
            "acquire_remote_git_source_lease",
        ) as remote_lease:
            manifest = provisioner.provision("chat-native-two-client-e2e")

        remote_lease.assert_called_once()
        self.assertEqual(manifest.state, ProvisioningState.BLOCKED)
        self.assertEqual(
            manifest.blocked_resource,
            "station:http://station.example:18080",
        )

    def test_missing_credential_returns_blocked_manifest(self):
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "home-station.yaml"
        )
        provisioner = get_provisioner(contract)
        with tempfile.TemporaryDirectory() as tmpdir:
            fake_worktree = Path(tmpdir) / "peers-oss"
            profile_dir = fake_worktree / ".local" / "dev" / "profiles"
            active_dir = fake_worktree / ".local" / "dev" / "active"
            profile_dir.mkdir(parents=True)
            active_dir.mkdir(parents=True)
            profile = profile_dir / "three.env"
            profile.write_text(
                "\n".join(
                    (
                        "PT_DEV_PROFILE=three",
                        "PT_DEV_SLOT=2",
                        "PT_STATION_MODE=remote",
                        "PT_STATION_URL=http://station.example:18080",
                        "PT_STATION_DEPLOY_ENV=station-three",
                    )
                )
                + "\n",
                encoding="utf-8",
            )
            (active_dir / "peers-oss.env").symlink_to(profile)
            attestation = ServiceAttestation(
                service_id="station",
                service_kind="station",
                environment_id="home-station",
                deployment_environment="station-three",
                endpoint="http://station.example:18080",
                live_commit="abc1234",
                workspace_digest="clean",
                protocol_digest="proto-digest",
                artifact_ref={
                    "artifactKind": "acceptance-artifact-ref",
                    "workspaceId": "0" * 16,
                    "gateId": "test-gate",
                    "runId": "20260817T000000000000Z-" + "0" * 32,
                    "path": "runtime/attestation.json",
                    "sha256": "0" * 64,
                    "mediaType": "application/json",
                },
                produced_at="2026-08-16T00:00:00+00:00",
                producer="station-deployment",
            )
            with patch(
                "tooling.acceptance.core.provisioner.REPO_ROOT",
                fake_worktree,
            ), patch(
                "tooling.acceptance.provisioners.home_station.REPO_ROOT",
                fake_worktree,
            ), patch.object(
                provisioner,
                "_git_commit",
                return_value="abc1234",
            ), patch.object(
                provisioner,
                "_git_workspace_digest",
                return_value="clean",
            ), patch.object(
                provisioner,
                "_station_ready",
                return_value=True,
            ), patch(
                "tooling.acceptance.provisioners.home_station.produce_station_attestation",
                return_value=attestation,
            ), patch(
                "tooling.acceptance.provisioners.home_station.source_proto_digest",
                return_value="proto-digest",
            ), patch.object(
                provisioner,
                "acquire_remote_git_source_lease",
            ), patch.dict(
                "os.environ",
                {
                    "PT_PROFILE_LEASE_DIR": str(
                        Path(tmpdir) / "profile-leases"
                    )
                },
                clear=True,
            ):
                manifest = provisioner.provision(
                    "chat-native-two-client-e2e"
                )

        self.assertEqual(manifest.state, ProvisioningState.BLOCKED)
        self.assertIn("reset", manifest.blocked_reason.lower())

    def test_agent_v2_foundation_provisions_native_and_browser_manifest(self):
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "home-station.yaml"
        )
        provisioner = get_provisioner(contract)
        attestation = self._station_attestation()
        with patch.object(
            provisioner,
            "_resolve_active_profile",
            return_value=self._one_profile(),
        ), patch.object(
            provisioner,
            "_git_commit",
            return_value="abc1234",
        ), patch.object(
            provisioner,
            "_git_workspace_digest",
            return_value="clean",
        ), patch.object(
            provisioner,
            "_station_ready",
            return_value=True,
        ), patch(
            "tooling.acceptance.provisioners.home_station.produce_station_attestation",
            return_value=attestation,
        ), patch(
            "tooling.acceptance.provisioners.home_station.source_proto_digest",
            return_value="proto-digest",
        ), patch(
            "tooling.acceptance.provisioners.home_station.produce_actor_manifest",
            return_value=(
                None,
                None,
                {
                    "artifactKind": "acceptance-artifact-ref",
                    "workspaceId": "0" * 16,
                    "gateId": "agent-v2-kernel-foundation-e2e",
                    "runId": "20260817T000000000000Z-" + "0" * 32,
                    "path": "runtime/actors.json",
                    "sha256": "0" * 64,
                    "mediaType": "application/json",
                },
            ),
        ) as actor_manifest, patch.object(
            provisioner,
            "acquire_profile_lease",
        ) as profile_lease, patch.object(
            provisioner,
            "acquire_remote_git_source_lease",
        ) as source_lease, patch.object(
            CredentialRef,
            "resolve",
            side_effect=AssertionError("credential values must not be resolved"),
        ), patch(
            "tooling.acceptance.provisioners.home_station.subprocess.run",
            side_effect=AssertionError("runtime startup is not provisioning"),
        ), patch.dict(
            "os.environ",
            {
                "PT_AGENT_V2_NATIVE_WEBDRIVER_PORT": "24445",
                "PT_AGENT_V2_BROWSER_WEBDRIVER_PORT": "24446",
            },
            clear=True,
        ):
            manifest = provisioner.provision(
                "agent-v2-kernel-foundation-e2e"
            )

        self.assertEqual(manifest.state, ProvisioningState.FIXTURE_READY)
        self.assertEqual(manifest.profile_resolved, "one")
        self.assertEqual(manifest.services, {"station": attestation})
        self.assertEqual(
            manifest.credential_refs,
            (
                "profile:CHAT_NATIVE_DEMO_PASSWORD",
                "profile:PT_AGENT_PROVIDER_API_KEY",
                "profile:PT_AGENT_DEFAULT_MODEL_ID",
            ),
        )
        self.assertEqual(len(manifest.clients), 2)
        native, browser = manifest.clients
        self.assertEqual(native.actor, "alice")
        self.assertEqual(native.runtime, "native-tauri")
        self.assertEqual(native.gateway_port, 23030)
        self.assertEqual(native.renderer_port, 23210)
        self.assertEqual(native.webdriver_port, 24445)
        self.assertEqual(browser.actor, "alice")
        self.assertEqual(browser.runtime, "browser")
        self.assertEqual(browser.gateway_port, 23031)
        self.assertEqual(browser.renderer_port, 23211)
        self.assertEqual(browser.webdriver_port, 24446)
        self.assertEqual(native.profile, "agent-v2-foundation-native")
        self.assertEqual(browser.profile, "agent-v2-foundation-browser")
        for client in manifest.clients:
            self.assertIn(manifest.run_id, client.storage_root)
        self.assertTrue(manifest.cleanup_registered)
        self.assertEqual(
            manifest.cleanup_resources,
            ("processes", "ports", "storage", "sessions"),
        )
        serialized = str(manifest.to_dict())
        self.assertNotIn("credential values must not be resolved", serialized)
        profile_lease.assert_called_once_with(
            "station-1",
            f"acceptance:agent-v2-kernel-foundation-e2e:{manifest.run_id}",
        )
        source_lease.assert_called_once_with(
            "station-1",
            f"acceptance:agent-v2-kernel-foundation-e2e:{manifest.run_id}",
        )
        self.assertEqual(
            actor_manifest.call_args.kwargs["roles"],
            ("alice", "bob"),
        )
        self.assertEqual(
            provisioner.cleanup(),
            (f"client-storage:/tmp/pt-agent-v2-{manifest.run_id}",),
        )

    def test_agent_v2_foundation_requires_one_remote_profile(self):
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "home-station.yaml"
        )
        provisioner = get_provisioner(contract)
        profile = self._one_profile()
        wrong_profile = ("Other", profile[1], profile[2], profile[3])
        with patch.object(
            provisioner,
            "_resolve_active_profile",
            return_value=wrong_profile,
        ), patch.object(
            provisioner,
            "_git_commit",
            return_value="abc1234",
        ), patch.object(
            provisioner,
            "_git_workspace_digest",
            return_value="clean",
        ), patch.object(
            provisioner,
            "_station_ready",
        ) as station_ready, patch.object(
            provisioner,
            "acquire_profile_lease",
        ) as profile_lease:
            manifest = provisioner.provision(
                "agent-v2-kernel-foundation-e2e"
            )

        self.assertEqual(manifest.state, ProvisioningState.BLOCKED)
        self.assertEqual(manifest.blocked_resource, "profile:required:one")
        station_ready.assert_not_called()
        profile_lease.assert_not_called()

    def test_agent_v2_foundation_rejects_local_station_mode(self):
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "home-station.yaml"
        )
        provisioner = get_provisioner(contract)
        profile_name, profile_path, slot, profile_env = self._one_profile()
        local_profile = (
            profile_name,
            profile_path,
            slot,
            {**profile_env, "PT_STATION_MODE": "local"},
        )
        with patch.object(
            provisioner,
            "_resolve_active_profile",
            return_value=local_profile,
        ), patch.object(
            provisioner,
            "_git_commit",
            return_value="abc1234",
        ), patch.object(
            provisioner,
            "_git_workspace_digest",
            return_value="clean",
        ), patch.object(
            provisioner,
            "_station_ready",
        ) as station_ready, patch.object(
            provisioner,
            "acquire_profile_lease",
        ) as profile_lease:
            manifest = provisioner.provision(
                "agent-v2-kernel-foundation-e2e"
            )

        self.assertEqual(manifest.state, ProvisioningState.BLOCKED)
        self.assertEqual(
            manifest.blocked_resource,
            "profile:PT_STATION_MODE",
        )
        station_ready.assert_not_called()
        profile_lease.assert_not_called()

    def test_agent_v2_foundation_source_mismatch_blocks_before_clients(self):
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "home-station.yaml"
        )
        provisioner = get_provisioner(contract)
        with patch.object(
            provisioner,
            "_resolve_active_profile",
            return_value=self._one_profile(),
        ), patch.object(
            provisioner,
            "_git_commit",
            return_value="abc1234",
        ), patch.object(
            provisioner,
            "_git_workspace_digest",
            return_value="clean",
        ), patch.object(
            provisioner,
            "_station_ready",
            return_value=True,
        ), patch(
            "tooling.acceptance.provisioners.home_station.produce_station_attestation",
            return_value=self._station_attestation("different-commit"),
        ), patch(
            "tooling.acceptance.provisioners.home_station.source_proto_digest",
            return_value="proto-digest",
        ), patch.object(
            provisioner,
            "acquire_profile_lease",
        ), patch.object(
            provisioner,
            "acquire_remote_git_source_lease",
        ), patch.object(
            provisioner,
            "_agent_v2_foundation_client",
        ) as allocate_client:
            manifest = provisioner.provision(
                "agent-v2-kernel-foundation-e2e"
            )

        self.assertEqual(manifest.state, ProvisioningState.BLOCKED)
        self.assertEqual(manifest.blocked_resource, "source-identity:commit")
        allocate_client.assert_not_called()

    def test_agent_v2_foundation_dirty_source_blocks_before_clients(self):
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "home-station.yaml"
        )
        provisioner = get_provisioner(contract)
        with patch.object(
            provisioner,
            "_resolve_active_profile",
            return_value=self._one_profile(),
        ), patch.object(
            provisioner,
            "_git_commit",
            return_value="abc1234",
        ), patch.object(
            provisioner,
            "_git_workspace_digest",
            return_value="sha256:dirty-source",
        ), patch.object(
            provisioner,
            "_station_ready",
            return_value=True,
        ), patch(
            "tooling.acceptance.provisioners.home_station.produce_station_attestation",
            return_value=self._station_attestation(),
        ), patch(
            "tooling.acceptance.provisioners.home_station.source_proto_digest",
            return_value="proto-digest",
        ), patch.object(
            provisioner,
            "acquire_profile_lease",
        ), patch.object(
            provisioner,
            "acquire_remote_git_source_lease",
        ), patch.object(
            provisioner,
            "_agent_v2_foundation_client",
        ) as allocate_client:
            manifest = provisioner.provision(
                "agent-v2-kernel-foundation-e2e"
            )

        self.assertEqual(manifest.state, ProvisioningState.BLOCKED)
        self.assertEqual(
            manifest.blocked_resource,
            "source-identity:workspace",
        )
        allocate_client.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)
