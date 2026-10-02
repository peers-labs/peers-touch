#!/usr/bin/env python3
"""Provisioner runtime tests."""

from __future__ import annotations

import dataclasses
import json
import os
import socket
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

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
from tooling.acceptance.provisioners.home_station import (
    agent_native_requires_disposable_fixture,
    agent_native_requires_provider,
    agent_profile_for_gate,
    audit_remote_station_cli_processes,
    resolve_existing_actor,
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

    def test_native_tauri_defaults_to_canonical_station_profiles(self):
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "native-tauri-embedded-webdriver.yaml"
        )
        provisioner = get_provisioner(contract)

        self.assertEqual(
            provisioner._required_station_profiles(),
            {
                "station-four": "four",
                "station-five": "fiveArm",
            },
        )

    def test_native_tauri_rejects_incomplete_runtime_station_profiles(self):
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "native-tauri-embedded-webdriver.yaml"
        )
        provisioner = get_provisioner(
            contract,
            station_profiles={"station-four": "four"},
        )
        with self.assertRaisesRegex(
            BlockedError,
            r"--station-profile SERVICE_ID=PROFILE.*missing=station-five",
        ):
            provisioner._required_station_profiles()

        provisioner = get_provisioner(
            contract,
            station_profiles={
                "station-four": "four",
                "station-five": "fiveArm",
                "station-unknown": "sixwin-unknown",
            },
        )
        with self.assertRaisesRegex(
            BlockedError,
            r"unexpected=station-unknown",
        ):
            provisioner._required_station_profiles()

    def test_native_tauri_accepts_runtime_station_profile(self):
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "native-tauri-embedded-webdriver.yaml"
        )
        bindings = {
            "station-four": "four",
            "station-five": "fiveArm",
        }
        provisioner = get_provisioner(
            contract,
            station_profiles=bindings,
        )

        self.assertEqual(provisioner._required_station_profiles(), bindings)

    def test_native_tauri_local_station_needs_no_deploy_environment(self):
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "native-tauri-embedded-webdriver.yaml"
        )
        contract = dataclasses.replace(
            contract,
            services={"station-four": contract.services["station-four"]},
            clients=tuple(
                client
                for client in contract.clients
                if client.service_bindings["station"].service_id
                == "station-four"
            ),
        )
        provisioner = get_provisioner(
            contract,
            station_profiles={"station-four": "sixwin"},
        )
        manifest = provisioner._new_base_manifest(
            "chat-native-product-closure-e2e"
        )
        attestation = ServiceAttestation(
            service_id="station-four",
            service_kind="station",
            environment_id=contract.id,
            deployment_environment="local",
            endpoint="http://127.0.0.1:18080",
            live_commit=manifest.source_commit,
            workspace_digest="clean",
            protocol_digest="proto-digest",
            artifact_ref={},
            produced_at="2026-09-10T00:00:00+00:00",
            producer="station-deployment",
            runtime_identity="sixwin-station",
        )

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            profile_dir = root / ".local" / "dev" / "profiles"
            profile_dir.mkdir(parents=True)
            (profile_dir / "sixwin.env").write_text(
                "\n".join(
                    (
                        "PT_DEV_PROFILE=sixwin",
                        "PT_STATION_MODE=local",
                        "PT_STATION_URL=http://127.0.0.1:18080",
                    )
                )
                + "\n",
                encoding="utf-8",
            )
            with patch(
                "tooling.acceptance.provisioners."
                "native_tauri_embedded_webdriver.REPO_ROOT",
                root,
            ), patch.object(
                provisioner,
                "_station_ready",
                return_value=True,
            ), patch.object(
                provisioner,
                "acquire_profile_lease",
            ) as profile_lease, patch.object(
                provisioner,
                "acquire_remote_git_source_lease",
            ) as remote_lease, patch(
                "tooling.acceptance.provisioners."
                "native_tauri_embedded_webdriver.source_proto_digest",
                return_value="proto-digest",
            ), patch(
                "tooling.acceptance.provisioners."
                "native_tauri_embedded_webdriver.produce_station_attestation",
                return_value=attestation,
            ) as produce:
                services = provisioner._provision_station_services(manifest)

        self.assertEqual(services, {"station-four": attestation})
        profile_lease.assert_called_once()
        remote_lease.assert_not_called()
        self.assertEqual(
            produce.call_args.kwargs["profile_env"]["PT_STATION_MODE"],
            "local",
        )
        self.assertIsNone(
            produce.call_args.kwargs["remote_source_identity_provider"]
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
    def test_missing_machine_binding_blocks(self):
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
            ), patch(
                "tooling.acceptance.core.provisioner.subprocess.run",
                return_value=subprocess.CompletedProcess(
                    args=[],
                    returncode=2,
                    stdout="",
                    stderr='{"code":"WORKSPACE_BINDING_MISSING"}',
                ),
            ):
                with self.assertRaisesRegex(
                    BlockedError,
                    "Machine Dev profile binding is unavailable",
                ):
                    provisioner._resolve_active_profile()

    def test_machine_binding_resolves_canonical_profile_and_slot_ports(self):
        provisioner = get_provisioner(
            EnvironmentContract.from_yaml(
                ENVIRONMENTS_DIR / "home-station.yaml"
            )
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            fake_worktree = Path(tmpdir) / "peers-oss"
            profile_dir = Path(tmpdir) / "env" / "peers-touch" / "two"
            profile_dir.mkdir(parents=True)
            profile = profile_dir / "profile.env.example"
            profile.write_text(
                "\n".join(
                    (
                        "PT_DEV_PROFILE=two",
                        "PT_DEV_SLOT=99",
                        "PT_STATION_MODE=remote",
                        "PT_STATION_URL=http://station.example:18080",
                        "PT_DESKTOP_APP_GATEWAY_PORT=1",
                        "PT_AGENT_PROVIDER_API_KEY=",
                    )
                )
                + "\n",
                encoding="utf-8",
            )
            resolution = {
                "authority": "machine-control-plane",
                "binding": {
                    "canonicalRoot": str(fake_worktree),
                    "profile": "two",
                    "slot": 3,
                    "workspaceId": "0" * 16,
                },
                "profile": {
                    "profileFile": str(profile),
                    "sourceState": "tracked-clean",
                },
                "ports": {
                    "desktopAppGateway": 3330,
                    "desktopAppWeb": 3510,
                    "desktopWebGateway": 3331,
                    "desktopWebWeb": 3511,
                    "mobileWeb": 5473,
                },
            }
            with patch(
                "tooling.acceptance.core.provisioner.REPO_ROOT",
                fake_worktree,
            ), patch.dict(
                os.environ,
                {"PT_AGENT_PROVIDER_API_KEY": "injected-provider-secret"},
            ), patch(
                "tooling.acceptance.core.provisioner.subprocess.run",
                return_value=subprocess.CompletedProcess(
                    args=[],
                    returncode=0,
                    stdout=json.dumps(resolution),
                    stderr="",
                ),
            ):
                name, resolved_profile, slot, values = (
                    provisioner._resolve_active_profile()
                )

        self.assertEqual(name, "two")
        self.assertEqual(resolved_profile, profile.resolve())
        self.assertEqual(slot, 3)
        self.assertEqual(values["PT_DEV_SLOT"], "3")
        self.assertEqual(values["PT_DESKTOP_APP_GATEWAY_PORT"], "3330")
        self.assertEqual(values["PT_MOBILE_WEB_PORT"], "5473")
        self.assertEqual(
            values["PT_AGENT_PROVIDER_API_KEY"],
            "injected-provider-secret",
        )

    def test_machine_binding_uses_explicit_environment_repository(self):
        provisioner = get_provisioner(
            EnvironmentContract.from_yaml(
                ENVIRONMENTS_DIR / "home-station.yaml"
            )
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            fake_worktree = Path(tmpdir) / "peers-oss"
            reviewed_env = Path(tmpdir) / "reviewed-env"
            profile = reviewed_env / "peers-touch" / "two" / "profile.env.example"
            profile.parent.mkdir(parents=True)
            profile.write_text(
                "PT_DEV_PROFILE=two\n",
                encoding="utf-8",
            )
            resolution = {
                "authority": "machine-control-plane",
                "binding": {
                    "canonicalRoot": str(fake_worktree),
                    "profile": "two",
                    "slot": 3,
                    "workspaceId": "0" * 16,
                },
                "profile": {
                    "profileFile": str(profile),
                    "sourceState": "tracked-clean",
                },
                "ports": {
                    "desktopAppGateway": 3330,
                    "desktopAppWeb": 3510,
                    "desktopWebGateway": 3331,
                    "desktopWebWeb": 3511,
                    "mobileWeb": 5473,
                },
            }
            with patch(
                "tooling.acceptance.core.provisioner.REPO_ROOT",
                fake_worktree,
            ), patch.dict(
                os.environ,
                {"PT_ENV_REPO": str(reviewed_env)},
            ), patch(
                "tooling.acceptance.core.provisioner.subprocess.run",
                return_value=subprocess.CompletedProcess(
                    args=[],
                    returncode=0,
                    stdout=json.dumps(resolution),
                    stderr="",
                ),
            ) as run:
                provisioner._resolve_active_profile()

        command = run.call_args.args[0]
        self.assertEqual(
            command[command.index("--env-repo") + 1],
            str(reviewed_env.resolve()),
        )

    def test_profile_identity_mismatch_blocks(self):
        provisioner = get_provisioner(
            EnvironmentContract.from_yaml(
                ENVIRONMENTS_DIR / "home-station.yaml"
            )
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            fake_worktree = Path(tmpdir) / "peers-oss"
            profile = Path(tmpdir) / "profile.env.example"
            profile.write_text(
                "PT_DEV_PROFILE=other\n",
                encoding="utf-8",
            )
            resolution = {
                "authority": "machine-control-plane",
                "binding": {
                    "canonicalRoot": str(fake_worktree),
                    "profile": "two",
                    "slot": 1,
                    "workspaceId": "0" * 16,
                },
                "profile": {
                    "profileFile": str(profile),
                    "sourceState": "tracked-clean",
                },
                "ports": {
                    "desktopAppGateway": 3130,
                    "desktopAppWeb": 3310,
                    "desktopWebGateway": 3131,
                    "desktopWebWeb": 3311,
                    "mobileWeb": 5273,
                },
            }
            with patch(
                "tooling.acceptance.core.provisioner.REPO_ROOT",
                fake_worktree,
            ), patch(
                "tooling.acceptance.core.provisioner.subprocess.run",
                return_value=subprocess.CompletedProcess(
                    args=[],
                    returncode=0,
                    stdout=json.dumps(resolution),
                    stderr="",
                ),
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

    @staticmethod
    def _two_profile() -> tuple[str, Path, int, dict[str, str]]:
        return (
            "two",
            Path("/tmp/two.env"),
            2,
            {
                "PT_DEV_PROFILE": "two",
                "PT_DEV_SLOT": "2",
                "PT_STATION_MODE": "remote",
                "PT_STATION_URL": "http://station.example:28080",
                "PT_STATION_DEPLOY_ENV": "station-2",
                "PT_DESKTOP_APP_GATEWAY_PORT": "24030",
                "PT_DESKTOP_APP_WEB_PORT": "24210",
                "PT_DESKTOP_WEB_GATEWAY_PORT": "24031",
                "PT_DESKTOP_WEB_WEB_PORT": "24211",
                "CHAT_NATIVE_DEMO_PASSWORD": "fixture-password",
                "CHAT_ACCEPTANCE_RESET": "1",
            },
        )

    def test_agent_v2_scenario_control_uses_parent_run_and_restores_station(
        self,
    ):
        provisioner = HomeStationProvisioner(
            EnvironmentContract.from_yaml(
                ENVIRONMENTS_DIR / "home-station.yaml"
            )
        )
        completed = subprocess.CompletedProcess(
            args=["make", "station"],
            returncode=0,
            stdout="[OK] station start",
            stderr="",
        )
        with patch.dict(
            os.environ,
            {"PT_ACCEPTANCE_RUN_ID": "parent-run-id"},
            clear=True,
        ), patch(
            "tooling.acceptance.provisioners.home_station.subprocess.run",
            side_effect=(completed, completed),
        ) as run:
            provisioner._deploy_agent_v2_scenario_control(
                gate_id="agent-v2-governed-tool-loop-e2e",
                profile_env={"PT_DEV_PROFILE": "two"},
            )
            cleanup = provisioner.cleanup()

        self.assertEqual(len(run.call_args_list), 2)
        deployed_env = run.call_args_list[0].kwargs["env"]
        self.assertEqual(
            deployed_env["PT_ACCEPTANCE_RUN_ID"],
            "parent-run-id",
        )
        self.assertEqual(
            deployed_env["PT_AGENT_CAPABILITY_SCENARIO_CONTROL"],
            "1",
        )
        restored_env = run.call_args_list[1].kwargs["env"]
        self.assertEqual(restored_env["PT_ACCEPTANCE_RUN_ID"], "")
        self.assertEqual(
            restored_env["PT_AGENT_CAPABILITY_SCENARIO_CONTROL"],
            "",
        )
        self.assertEqual(
            cleanup,
            ("agent-v2-scenario-control:parent-run-id",),
        )

    def test_native_clients_receive_distinct_webdriver_ports(self):
        provisioner = HomeStationProvisioner(
            EnvironmentContract(id="home-station")
        )
        with patch("socket.socket.connect_ex", return_value=1):
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
        slot = next(
            candidate
            for candidate in range(20, 200)
            if all(
                self._port_is_available(port)
                for port in (
                    3330 + candidate * 100,
                    3331 + candidate * 100,
                    3510 + candidate * 100,
                    3511 + candidate * 100,
                    4445 + candidate * 10,
                    4446 + candidate * 10,
                )
            )
        )
        with patch.dict(
            "os.environ",
            {"PT_DEV_SLOT": "0"},
            clear=True,
        ), patch("socket.socket.connect_ex", return_value=1):
            clients = provisioner._clients(
                "chat-native-two-client-e2e",
                "run-profile-slot",
                slot,
            )

        self.assertEqual(
            [client.webdriver_port for client in clients],
            [4445 + slot * 10, 4446 + slot * 10],
        )

    def test_native_webdriver_port_conflict_blocks(self):
        provisioner = HomeStationProvisioner(
            EnvironmentContract(id="home-station")
        )
        slot = next(
            (
                candidate for candidate in range(20, 500)
                if all(
                    self._port_is_available(port)
                    for port in (
                        3330 + candidate * 100,
                        3331 + candidate * 100,
                        3510 + candidate * 100,
                        3511 + candidate * 100,
                        4445 + candidate * 10,
                        4446 + candidate * 10,
                    )
                )
            ),
            None,
        )
        self.assertIsNotNone(slot, "no isolated native client slot is available")
        assert slot is not None
        webdriver_port = 4445 + slot * 10
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", webdriver_port))
            listener.listen()
            with patch.dict(
                "os.environ",
                {"PT_DEV_SLOT": str(slot)},
                clear=True,
            ):
                with self.assertRaisesRegex(
                    BlockedError,
                    f"webdriver port {webdriver_port} is already in use",
                ):
                    provisioner._clients(
                        "chat-native-two-client-e2e",
                        "run-webdriver-conflict",
                        slot,
                    )

    @staticmethod
    def _port_is_available(port: int) -> bool:
        with socket.socket() as probe:
            try:
                probe.bind(("127.0.0.1", port))
            except OSError:
                return False
        return True

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
        ), patch.object(provisioner, "_assert_client_ports_available"):
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

    def test_agent_core_lifecycle_uses_reviewed_two_profile(self):
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
        ), patch.object(provisioner, "_assert_client_ports_available"):
            client = provisioner._agent_stream_client(
                "run-core-lifecycle",
                1,
                profile_env,
                profile=agent_profile_for_gate(
                    "agent-core-lifecycle-native-e2e"
                ),
            )

        self.assertEqual(client.profile, "two")
        provisioner._validate_agent_profile(
            "agent-core-lifecycle-native-e2e",
            "two",
            {
                "PT_STATION_MODE": "remote",
                "PT_STATION_DEPLOY_ENV": "station-two",
            },
        )

    def test_agent_core_lifecycle_reuses_actor_without_http_provider(self):
        gate_id = "agent-core-lifecycle-native-e2e"

        self.assertFalse(agent_native_requires_disposable_fixture(gate_id))
        self.assertFalse(agent_native_requires_provider(gate_id))
        self.assertTrue(
            agent_native_requires_disposable_fixture(
                "agent-stream-resilience-e2e"
            )
        )
        self.assertTrue(
            agent_native_requires_provider("agent-stream-resilience-e2e")
        )

    def test_agent_minimum_usable_chat_uses_two_without_reset_or_profile_provider(
        self,
    ):
        gate_id = "agent-minimum-usable-chat-native-e2e"
        provisioner = HomeStationProvisioner(
            EnvironmentContract(id="home-station")
        )
        profile_env = {
            "PT_DESKTOP_APP_GATEWAY_PORT": "13331",
            "PT_DESKTOP_APP_WEB_PORT": "13511",
        }
        with patch.dict(
            "os.environ",
            {"PT_AGENT_MINIMUM_USABLE_WEBDRIVER_PORT": "14449"},
            clear=True,
        ), patch.object(provisioner, "_assert_client_ports_available"):
            client = provisioner._agent_minimum_usable_chat_client(
                "run-minimum-usable",
                1,
                profile_env,
            )

        self.assertEqual(agent_profile_for_gate(gate_id), "two")
        self.assertEqual(client.profile, "two")
        self.assertEqual(client.actor, "alice")
        self.assertIn(
            "pt-agent-minimum-usable-chat-run-minimum-usable",
            client.storage_root,
        )
        self.assertFalse(agent_native_requires_disposable_fixture(gate_id))
        self.assertFalse(agent_native_requires_provider(gate_id))

    def test_agent_cli_provider_uses_two_without_reset_or_http_credentials(self):
        gate_id = "agent-cli-provider-primary-native-e2e"
        provisioner = HomeStationProvisioner(
            EnvironmentContract(id="home-station")
        )
        profile_env = {
            "PT_DESKTOP_APP_GATEWAY_PORT": "13331",
            "PT_DESKTOP_APP_WEB_PORT": "13511",
        }
        with patch.dict(
            "os.environ",
            {"PT_AGENT_CLI_PROVIDER_WEBDRIVER_PORT": "14449"},
            clear=True,
        ), patch.object(provisioner, "_assert_client_ports_available"):
            client = provisioner._agent_cli_provider_client(
                "run-cli-provider",
                1,
                profile_env,
            )

        self.assertEqual(agent_profile_for_gate(gate_id), "two")
        self.assertEqual(client.profile, "two")
        self.assertIn("pt-agent-cli-provider-run-cli-provider", client.storage_root)
        self.assertFalse(agent_native_requires_disposable_fixture(gate_id))
        self.assertFalse(agent_native_requires_provider(gate_id))

    def test_remote_station_cli_process_audit_checks_only_process_argv0(self):
        transport = MagicMock()
        transport.run_argv.return_value = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout="",
            stderr="",
        )
        with patch(
            "tooling.acceptance.provisioners.home_station."
            "reviewed_remote_transport",
            return_value=(
                transport,
                {"PT_ACCEPTANCE_COMPOSE_PROJECT": "pt-station-two"},
            ),
        ):
            audit_remote_station_cli_processes("station-two")

        remote_argv = transport.run_argv.call_args.args[0]
        self.assertEqual(remote_argv[:2], ["bash", "-lc"])
        remote_script = remote_argv[2]
        self.assertIn(
            "label=com.docker.compose.project=pt-station-two",
            remote_script,
        )
        self.assertIn(
            "label=com.docker.compose.service=station",
            remote_script,
        )
        self.assertIn("/proc/[0-9]*/cmdline", remote_script)
        self.assertIn("sed -n '1p'", remote_script)
        self.assertIn("traecli|host-cli-bin", remote_script)
        self.assertEqual(
            transport.run_argv.call_args.kwargs,
            {"timeout": 30, "check": False},
        )

    def test_remote_station_cli_process_audit_reports_bounded_failures(self):
        cases = (
            (41, "could not select exactly one Station container"),
            (42, "detected a residual provider process"),
            (17, "could not complete"),
        )
        for returncode, expected in cases:
            with self.subTest(returncode=returncode):
                transport = MagicMock()
                transport.run_argv.return_value = subprocess.CompletedProcess(
                    args=[],
                    returncode=returncode,
                    stdout="sensitive provider prompt",
                    stderr="sensitive remote command",
                )
                with patch(
                    "tooling.acceptance.provisioners.home_station."
                    "reviewed_remote_transport",
                    return_value=(
                        transport,
                        {
                            "PT_ACCEPTANCE_COMPOSE_PROJECT": (
                                "pt-station-two"
                            )
                        },
                    ),
                ), self.assertRaisesRegex(RuntimeError, expected) as raised:
                    audit_remote_station_cli_processes("station-two")

                self.assertNotIn("sensitive", str(raised.exception))

    def test_agent_cli_provider_registers_remote_process_cleanup_audit(self):
        gate_id = "agent-cli-provider-primary-native-e2e"
        provisioner = HomeStationProvisioner(
            EnvironmentContract(id="home-station")
        )
        manifest = dataclasses.replace(
            provisioner._new_base_manifest(gate_id),
            profile_slot=2,
        )
        actor_ref = {
            "artifactKind": "acceptance-artifact-ref",
            "workspaceId": "0" * 16,
            "gateId": gate_id,
            "runId": manifest.run_id,
            "path": "runtime/actors.json",
            "sha256": "0" * 64,
            "mediaType": "application/json",
        }
        with patch(
            "tooling.acceptance.provisioners.home_station."
            "resolve_existing_actor",
            return_value=MagicMock(),
        ), patch(
            "tooling.acceptance.provisioners.home_station."
            "persist_actor_manifest",
            return_value=(None, None, actor_ref),
        ), patch.object(
            provisioner,
            "_agent_cli_provider_client",
            return_value=MagicMock(),
        ):
            provisioner._agent_native_manifest(
                manifest,
                gate_id=gate_id,
                station_url="http://station.example:28080",
                deployment_environment="station-two",
                profile_env={"CHAT_NATIVE_DEMO_PASSWORD": "fixture-password"},
            )

        with patch(
            "tooling.acceptance.provisioners.home_station."
            "audit_remote_station_cli_processes",
        ) as audit:
            completed = provisioner.cleanup()

        self.assertEqual(
            completed,
            ("remote-station-cli-process-audit:station-two",),
        )
        audit.assert_called_once_with("station-two")

    def test_existing_actor_resolution_logs_out_without_reset(self):
        login = MagicMock()
        login.__enter__.return_value.read.return_value = json.dumps(
            {
                "data": {
                    "actor_ref": {"ptid": "ptid:alice"},
                    "tokens": {"access_token": "access-token"},
                }
            }
        ).encode("utf-8")
        logout = MagicMock()

        with patch(
            "tooling.acceptance.provisioners.home_station.urllib.request.urlopen",
            side_effect=[login, logout],
        ) as urlopen:
            actor = resolve_existing_actor(
                "http://station.example:18080",
                "alice",
                "fixture-password",
            )

        self.assertEqual(actor.ptid, "ptid:alice")
        self.assertEqual(actor.device_policy, "ephemeral-acceptance")
        self.assertEqual(urlopen.call_count, 2)
        logout.close.assert_called_once_with()

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
        ), patch.object(
            provisioner,
            "_assert_client_ports_available",
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
            profile_dir.mkdir(parents=True)
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
                "_resolve_active_profile",
                return_value=(
                    "three",
                    profile,
                    2,
                    {
                        "PT_DEV_PROFILE": "three",
                        "PT_DEV_SLOT": "2",
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

    def test_agent_v2_binding_reuses_profile_two_actors_without_reset(self):
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "home-station.yaml"
        )
        provisioner = get_provisioner(contract)
        profile = self._two_profile()
        profile[3].pop("CHAT_ACCEPTANCE_RESET")
        attestation = dataclasses.replace(
            self._station_attestation(),
            deployment_environment="station-2",
        )
        with patch.object(
            provisioner,
            "_resolve_active_profile",
            return_value=profile,
        ), patch.object(
            provisioner,
            "_git_commit",
            return_value="abc1234",
        ), patch.object(
            provisioner,
            "_git_workspace_digest",
            return_value="sha256:j02-acceptance-diff",
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
        ) as reset_actor_manifest, patch(
            "tooling.acceptance.provisioners.home_station.resolve_existing_actor",
            side_effect=(MagicMock(name="alice"), MagicMock(name="bob")),
        ) as resolve_actor, patch(
            "tooling.acceptance.provisioners.home_station.persist_actor_manifest",
            return_value=(
                None,
                None,
                {
                    "artifactKind": "acceptance-artifact-ref",
                    "workspaceId": "0" * 16,
                    "gateId": "agent-v2-capability-binding-e2e",
                    "runId": "20260917T000000000000Z-" + "0" * 32,
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
            provisioner,
            "_deploy_agent_v2_scenario_control",
        ) as scenario_deploy, patch.dict(
            "os.environ",
            {
                "PT_AGENT_V2_BINDING_NATIVE_WEBDRIVER_PORT": "25445",
                "PT_AGENT_V2_BINDING_BROWSER_WEBDRIVER_PORT": "25446",
            },
            clear=True,
        ):
            manifest = provisioner.provision(
                "agent-v2-capability-binding-e2e"
            )

        self.assertEqual(manifest.state, ProvisioningState.FIXTURE_READY)
        self.assertEqual(manifest.profile_resolved, "two")
        self.assertEqual(manifest.services, {"station": attestation})
        self.assertEqual(len(manifest.clients), 2)
        native, browser = manifest.clients
        self.assertEqual(native.runtime, "native-tauri")
        self.assertEqual(browser.runtime, "browser")
        self.assertEqual(native.actor, "charlie")
        self.assertEqual(browser.actor, "charlie")
        self.assertEqual(native.profile, "agent-v2-binding-native")
        self.assertEqual(browser.profile, "agent-v2-binding-browser")
        self.assertNotEqual(native.storage_root, browser.storage_root)
        self.assertIn(manifest.run_id, native.storage_root)
        self.assertIn(manifest.run_id, browser.storage_root)
        self.assertEqual(native.webdriver_port, 25445)
        self.assertEqual(browser.webdriver_port, 25446)
        self.assertEqual(
            manifest.credential_refs,
            ("profile:CHAT_NATIVE_DEMO_PASSWORD",),
        )
        reset_actor_manifest.assert_not_called()
        self.assertEqual(
            [invocation.args[1] for invocation in resolve_actor.call_args_list],
            ["alice", "charlie"],
        )
        persisted = actor_manifest.call_args.args[0]
        self.assertEqual(persisted.fixture_id, "chat-native-existing-actors")
        self.assertEqual(
            persisted.credential_refs,
            ("profile:CHAT_NATIVE_DEMO_PASSWORD",),
        )
        self.assertFalse(persisted.reset_authorized)
        self.assertTrue(persisted.target_verified)
        self.assertIsNotNone(manifest.actor_manifest_ref)
        profile_lease.assert_called_once_with(
            "station-2",
            f"acceptance:agent-v2-capability-binding-e2e:{manifest.run_id}",
        )
        source_lease.assert_called_once_with(
            "station-2",
            f"acceptance:agent-v2-capability-binding-e2e:{manifest.run_id}",
        )
        scenario_deploy.assert_called_once_with(
            gate_id="agent-v2-capability-binding-e2e",
            profile_env=profile[3],
        )
        cleanup = provisioner.cleanup()
        self.assertEqual(len(cleanup), 1)
        self.assertIn("pt-agent-v2-binding-", cleanup[0])

    def test_agent_v2_governed_tool_provisions_profile_two_clients(self):
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "home-station.yaml"
        )
        provisioner = get_provisioner(contract)
        attestation = dataclasses.replace(
            self._station_attestation(),
            deployment_environment="station-2",
        )
        with patch.object(
            provisioner,
            "_resolve_active_profile",
            return_value=self._two_profile(),
        ), patch.object(
            provisioner,
            "_git_commit",
            return_value="abc1234",
        ), patch.object(
            provisioner,
            "_git_workspace_digest",
            return_value="sha256:j03-development-diff",
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
            "acquire_profile_lease",
        ) as profile_lease, patch.object(
            provisioner,
            "acquire_remote_git_source_lease",
        ) as source_lease, patch.object(
            provisioner,
            "_deploy_agent_v2_scenario_control",
        ) as scenario_deploy, patch.dict(
            "os.environ",
            {
                "PT_AGENT_V2_GOVERNED_TOOL_NATIVE_WEBDRIVER_PORT": "26445",
                "PT_AGENT_V2_GOVERNED_TOOL_BROWSER_WEBDRIVER_PORT": "26446",
            },
            clear=True,
        ):
            manifest = provisioner.provision(
                "agent-v2-governed-tool-loop-e2e"
            )

        self.assertEqual(manifest.state, ProvisioningState.FIXTURE_READY)
        self.assertEqual(manifest.profile_resolved, "two")
        self.assertEqual(manifest.services, {"station": attestation})
        self.assertEqual(len(manifest.clients), 2)
        native, browser = manifest.clients
        self.assertEqual(native.actor, "charlie")
        self.assertEqual(browser.actor, "charlie")
        self.assertEqual(native.profile, "agent-v2-governed-tool-native")
        self.assertEqual(browser.profile, "agent-v2-governed-tool-browser")
        self.assertEqual(native.webdriver_port, 26445)
        self.assertEqual(browser.webdriver_port, 26446)
        self.assertIn("pt-agent-v2-governed-tool-", native.storage_root)
        self.assertEqual(
            manifest.credential_refs,
            ("profile:CHAT_NATIVE_DEMO_PASSWORD",),
        )
        profile_lease.assert_called_once_with(
            "station-2",
            f"acceptance:agent-v2-governed-tool-loop-e2e:{manifest.run_id}",
        )
        source_lease.assert_called_once_with(
            "station-2",
            f"acceptance:agent-v2-governed-tool-loop-e2e:{manifest.run_id}",
        )
        scenario_deploy.assert_called_once_with(
            gate_id="agent-v2-governed-tool-loop-e2e",
            profile_env=self._two_profile()[3],
        )
        cleanup = provisioner.cleanup()
        self.assertEqual(len(cleanup), 1)
        self.assertIn("pt-agent-v2-governed-tool-", cleanup[0])

    def test_agent_v2_mcp_provisions_profile_two_native_and_browser_clients(self):
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "home-station.yaml"
        )
        provisioner = get_provisioner(contract)
        attestation = dataclasses.replace(
            self._station_attestation(),
            deployment_environment="station-2",
        )
        with patch.object(
            provisioner,
            "_resolve_active_profile",
            return_value=self._two_profile(),
        ), patch.object(
            provisioner,
            "_git_commit",
            return_value="abc1234",
        ), patch.object(
            provisioner,
            "_git_workspace_digest",
            return_value="sha256:j04-development-diff",
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
            "acquire_profile_lease",
        ) as profile_lease, patch.object(
            provisioner,
            "acquire_remote_git_source_lease",
        ) as source_lease, patch.object(
            provisioner,
            "_deploy_agent_v2_scenario_control",
        ) as scenario_deploy, patch.dict(
            "os.environ",
            {
                "PT_AGENT_V2_MCP_NATIVE_WEBDRIVER_PORT": "27445",
                "PT_AGENT_V2_MCP_BROWSER_WEBDRIVER_PORT": "27446",
            },
            clear=True,
        ):
            manifest = provisioner.provision(
                "agent-v2-mcp-lifecycle-e2e"
            )

        self.assertEqual(manifest.state, ProvisioningState.FIXTURE_READY)
        self.assertEqual(manifest.profile_resolved, "two")
        self.assertEqual(manifest.services, {"station": attestation})
        self.assertEqual(len(manifest.clients), 2)
        native, browser = manifest.clients
        self.assertEqual(native.runtime, "native-tauri")
        self.assertEqual(native.actor, "charlie")
        self.assertEqual(native.profile, "agent-v2-mcp-native")
        self.assertEqual(native.webdriver_port, 27445)
        self.assertEqual(browser.runtime, "browser")
        self.assertEqual(browser.actor, "charlie")
        self.assertEqual(browser.profile, "agent-v2-mcp-browser")
        self.assertEqual(browser.webdriver_port, 27446)
        self.assertIn("pt-agent-v2-mcp-", native.storage_root)
        self.assertIn("pt-agent-v2-mcp-", browser.storage_root)
        self.assertEqual(
            manifest.credential_refs,
            ("profile:CHAT_NATIVE_DEMO_PASSWORD",),
        )
        profile_lease.assert_called_once_with(
            "station-2",
            f"acceptance:agent-v2-mcp-lifecycle-e2e:{manifest.run_id}",
        )
        source_lease.assert_called_once_with(
            "station-2",
            f"acceptance:agent-v2-mcp-lifecycle-e2e:{manifest.run_id}",
        )
        scenario_deploy.assert_called_once_with(
            gate_id="agent-v2-mcp-lifecycle-e2e",
            profile_env=self._two_profile()[3],
        )
        cleanup = provisioner.cleanup()
        self.assertEqual(len(cleanup), 1)
        self.assertIn("pt-agent-v2-mcp-", cleanup[0])

    def test_agent_v2_connector_provisions_profile_two_runtime_pair(self):
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "home-station.yaml"
        )
        provisioner = get_provisioner(contract)
        attestation = dataclasses.replace(
            self._station_attestation(),
            deployment_environment="station-2",
        )
        with patch.object(
            provisioner,
            "_resolve_active_profile",
            return_value=self._two_profile(),
        ), patch.object(
            provisioner,
            "_git_commit",
            return_value="abc1234",
        ), patch.object(
            provisioner,
            "_git_workspace_digest",
            return_value="sha256:j05-development-diff",
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
            "acquire_profile_lease",
        ) as profile_lease, patch.object(
            provisioner,
            "acquire_remote_git_source_lease",
        ) as source_lease, patch.dict(
            "os.environ",
            {
                "PT_AGENT_V2_CONNECTOR_NATIVE_WEBDRIVER_PORT": "28445",
                "PT_AGENT_V2_CONNECTOR_BROWSER_WEBDRIVER_PORT": "28446",
            },
            clear=True,
        ):
            manifest = provisioner.provision(
                "agent-v2-connector-invocation-e2e"
            )

        self.assertEqual(manifest.state, ProvisioningState.FIXTURE_READY)
        self.assertEqual(manifest.profile_resolved, "two")
        self.assertEqual(manifest.services, {"station": attestation})
        self.assertEqual(len(manifest.clients), 2)
        native, browser = manifest.clients
        self.assertEqual(native.runtime, "native-tauri")
        self.assertEqual(native.actor, "bob")
        self.assertEqual(native.profile, "agent-v2-connector-native")
        self.assertEqual(native.webdriver_port, 28445)
        self.assertEqual(browser.runtime, "browser")
        self.assertEqual(browser.actor, "bob")
        self.assertEqual(browser.profile, "agent-v2-connector-browser")
        self.assertEqual(browser.webdriver_port, 28446)
        self.assertIn("pt-agent-v2-connector-", native.storage_root)
        self.assertIn("pt-agent-v2-connector-", browser.storage_root)
        self.assertEqual(
            manifest.credential_refs,
            ("profile:CHAT_NATIVE_DEMO_PASSWORD",),
        )
        profile_lease.assert_called_once_with(
            "station-2",
            (
                "acceptance:agent-v2-connector-invocation-e2e:"
                f"{manifest.run_id}"
            ),
        )
        source_lease.assert_called_once_with(
            "station-2",
            (
                "acceptance:agent-v2-connector-invocation-e2e:"
                f"{manifest.run_id}"
            ),
        )
        cleanup = provisioner.cleanup()
        self.assertEqual(len(cleanup), 1)
        self.assertIn("pt-agent-v2-connector-", cleanup[0])

    def test_agent_v2_evaluation_provisions_native_and_browser_clients(self):
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "home-station.yaml"
        )
        provisioner = get_provisioner(contract)
        attestation = dataclasses.replace(
            self._station_attestation(),
            deployment_environment="station-2",
        )
        with patch.object(
            provisioner,
            "_resolve_active_profile",
            return_value=self._two_profile(),
        ), patch.object(
            provisioner,
            "_git_commit",
            return_value="abc1234",
        ), patch.object(
            provisioner,
            "_git_workspace_digest",
            return_value="sha256:j06-development-diff",
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
            "acquire_profile_lease",
        ) as profile_lease, patch.object(
            provisioner,
            "acquire_remote_git_source_lease",
        ) as source_lease, patch.dict(
            "os.environ",
            {
                "PT_AGENT_V2_EVALUATION_ALICE_WEBDRIVER_PORT": "29445",
                "PT_AGENT_V2_EVALUATION_BOB_WEBDRIVER_PORT": "29446",
            },
            clear=True,
        ):
            manifest = provisioner.provision(
                "agent-v2-evaluation-lab-e2e"
            )

        self.assertEqual(manifest.state, ProvisioningState.FIXTURE_READY)
        self.assertEqual(manifest.profile_resolved, "two")
        self.assertEqual(manifest.services, {"station": attestation})
        self.assertEqual(len(manifest.clients), 2)
        alice, bob = manifest.clients
        self.assertEqual((alice.actor, bob.actor), ("alice", "bob"))
        self.assertEqual(
            (alice.runtime, bob.runtime),
            ("native-tauri", "browser"),
        )
        self.assertEqual(
            alice.profile,
            "agent-v2-evaluation-native",
        )
        self.assertEqual(
            bob.profile,
            "agent-v2-evaluation-browser",
        )
        self.assertEqual(
            (alice.webdriver_port, bob.webdriver_port),
            (29445, 29446),
        )
        self.assertNotEqual(alice.storage_root, bob.storage_root)
        self.assertIn("pt-agent-v2-evaluation-", alice.storage_root)
        alice_identity_root = (
            Path(alice.storage_root).parent.parent / "actor-identity"
        )
        bob_identity_root = (
            Path(bob.storage_root).parent.parent / "actor-identity"
        )
        self.assertNotEqual(alice_identity_root, bob_identity_root)
        self.assertEqual(
            manifest.credential_refs,
            ("profile:CHAT_NATIVE_DEMO_PASSWORD",),
        )
        profile_lease.assert_called_once_with(
            "station-2",
            (
                "acceptance:agent-v2-evaluation-lab-e2e:"
                f"{manifest.run_id}"
            ),
        )
        source_lease.assert_called_once_with(
            "station-2",
            (
                "acceptance:agent-v2-evaluation-lab-e2e:"
                f"{manifest.run_id}"
            ),
        )
        cleanup = provisioner.cleanup()
        self.assertEqual(len(cleanup), 1)
        self.assertIn("pt-agent-v2-evaluation-", cleanup[0])

    def test_agent_marketplace_provisions_one_profile_two_native_client(self):
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "home-station.yaml"
        )
        provisioner = get_provisioner(contract)
        attestation = dataclasses.replace(
            self._station_attestation(),
            deployment_environment="station-2",
        )
        with patch.object(
            provisioner,
            "_resolve_active_profile",
            return_value=self._two_profile(),
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
            "acquire_profile_lease",
        ) as profile_lease, patch.object(
            provisioner,
            "acquire_remote_git_source_lease",
        ) as source_lease, patch.dict(
            "os.environ",
            {
                "PT_AGENT_MARKETPLACE_WEBDRIVER_PORT": "30445",
            },
            clear=True,
        ):
            manifest = provisioner.provision(
                "agent-marketplace-catalog-e2e"
            )

        self.assertEqual(manifest.state, ProvisioningState.FIXTURE_READY)
        self.assertEqual(manifest.profile_resolved, "two")
        self.assertEqual(manifest.services, {"station": attestation})
        self.assertEqual(len(manifest.clients), 1)
        native = manifest.clients[0]
        self.assertEqual(native.runtime, "native-tauri")
        self.assertEqual(native.actor, "alice")
        self.assertEqual(native.profile, "agent-marketplace-native")
        self.assertEqual(native.webdriver_port, 30445)
        self.assertIn("pt-agent-marketplace-", native.storage_root)
        self.assertEqual(
            manifest.credential_refs,
            ("profile:CHAT_NATIVE_DEMO_PASSWORD",),
        )
        profile_lease.assert_called_once_with(
            "station-2",
            f"acceptance:agent-marketplace-catalog-e2e:{manifest.run_id}",
        )
        source_lease.assert_called_once_with(
            "station-2",
            f"acceptance:agent-marketplace-catalog-e2e:{manifest.run_id}",
        )
        cleanup = provisioner.cleanup()
        self.assertEqual(len(cleanup), 1)
        self.assertIn("pt-agent-marketplace-", cleanup[0])

    def test_agent_v2_binding_rejects_non_two_profile(self):
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
        ) as station_ready:
            manifest = provisioner.provision(
                "agent-v2-capability-binding-e2e"
            )

        self.assertEqual(manifest.state, ProvisioningState.BLOCKED)
        self.assertEqual(
            manifest.blocked_resource,
            "profile:required:two",
        )
        station_ready.assert_not_called()

    def test_agent_v2_binding_rejects_dirty_remote_station(self):
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "home-station.yaml"
        )
        provisioner = get_provisioner(contract)
        dirty_attestation = dataclasses.replace(
            self._station_attestation(),
            deployment_environment="station-2",
            workspace_digest="sha256:dirty-station",
        )
        with patch.object(
            provisioner,
            "_resolve_active_profile",
            return_value=self._two_profile(),
        ), patch.object(
            provisioner,
            "_git_commit",
            return_value="abc1234",
        ), patch.object(
            provisioner,
            "_git_workspace_digest",
            return_value="sha256:j02-acceptance-diff",
        ), patch.object(
            provisioner,
            "_station_ready",
            return_value=True,
        ), patch(
            "tooling.acceptance.provisioners.home_station.produce_station_attestation",
            return_value=dirty_attestation,
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
            "_deploy_agent_v2_scenario_control",
        ), patch.object(
            provisioner,
            "_agent_v2_binding_clients",
        ) as allocate_clients, patch.dict(
            os.environ,
            {"PT_ACCEPTANCE_RUN_ID": "test-dirty-station"},
            clear=False,
        ):
            manifest = provisioner.provision("agent-v2-capability-binding-e2e")

        self.assertEqual(manifest.state, ProvisioningState.BLOCKED)
        self.assertEqual(
            manifest.blocked_resource,
            "source-identity:station-workspace",
        )
        allocate_clients.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)
