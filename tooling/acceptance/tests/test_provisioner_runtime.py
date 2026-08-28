#!/usr/bin/env python3
"""Provisioner runtime tests."""

from __future__ import annotations

import socket
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from tooling.acceptance.core import (
    BlockedError,
    CredentialRef,
    EnvironmentContract,
    EnvironmentProvisioner,
    ProvisioningError,
    ProvisioningState,
    StationAttestation,
)
from tooling.acceptance.core._paths import ENVIRONMENTS_DIR
from tooling.acceptance.provisioners import (
    HomeStationProvisioner,
    get_provisioner,
)
from tooling.acceptance.provisioners.local_desktop_gateway import (
    LocalDesktopGatewayProvisioner,
    PROVISION_DESKTOP_LOG,
)
from tooling.acceptance.provisioners.native_tauri_embedded_webdriver import (
    NativeTauriEmbeddedWebDriverProvisioner,
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

    def test_auto_credential_value_is_retained_by_provisioner_instance(self):
        provisioner = HomeStationProvisioner(
            EnvironmentContract(
                id="home-station",
                credentials=(
                    CredentialRef(
                        id="canary",
                        source_ref="auto:canary",
                    ),
                ),
            )
        )

        refs, values = provisioner._resolve_credentials()

        self.assertEqual(refs, ("auto:canary",))
        self.assertEqual(
            provisioner.resolved_credential_values,
            (values["canary"],),
        )

    def test_resolved_credentials_survive_later_resolution_failure(self):
        first = CredentialRef(id="first", source_ref="env:FIRST")
        second = CredentialRef(id="second", source_ref="env:SECOND")
        provisioner = HomeStationProvisioner(
            EnvironmentContract(
                id="home-station",
                credentials=(first, second),
            )
        )

        with patch.object(
            CredentialRef,
            "resolve",
            side_effect=("resolved-secret", RuntimeError("second failed")),
        ), self.assertRaises(BlockedError):
            provisioner._resolve_credentials()

        self.assertEqual(
            provisioner.resolved_credential_values,
            ("resolved-secret",),
        )

    def test_short_credential_is_rejected_before_runtime_use(self):
        provisioner = HomeStationProvisioner(
            EnvironmentContract(
                id="home-station",
                credentials=(
                    CredentialRef(id="short", source_ref="env:SHORT"),
                ),
            )
        )

        with patch.object(
            CredentialRef,
            "resolve",
            return_value="abc",
        ), self.assertRaisesRegex(
            BlockedError,
            "too short for safe evidence redaction",
        ):
            provisioner._resolve_credentials()

        self.assertEqual(provisioner.resolved_credential_values, ())
        with self.assertRaisesRegex(
            BlockedError,
            "too short for safe evidence redaction",
        ):
            provisioner._remember_resolved_credentials(
                ("fixture:short",),
                {"short": "abc"},
            )

    def test_committed_fixture_password_is_not_treated_as_secret(self):
        provisioner = NativeTauriEmbeddedWebDriverProvisioner(
            EnvironmentContract(
                id="native-tauri-embedded-webdriver",
            )
        )

        refs, values = provisioner._resolve_credentials()

        self.assertEqual(
            refs,
            ("fixture:apps/station/app/conf/actor.yml#preset_users",),
        )
        self.assertEqual(values, {"chat-password": "1"})
        self.assertEqual(provisioner.resolved_credential_values, ())


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
    def test_desktop_gateway_profile_ports_fail_closed(self):
        provisioner = LocalDesktopGatewayProvisioner(
            EnvironmentContract(id="local-desktop-gateway")
        )

        for field in (
            "PT_DESKTOP_APP_GATEWAY_PORT",
            "PT_DESKTOP_APP_WEB_PORT",
        ):
            with self.subTest(field=field), self.assertRaisesRegex(
                BlockedError,
                "invalid port",
            ) as raised:
                provisioner._profile_ports({field: "not-a-port"}, 0)

            self.assertEqual(
                raised.exception.resource,
                "profile:desktop-port",
            )

    def test_desktop_gateway_timeout_names_external_artifact_logically(self):
        provisioner = LocalDesktopGatewayProvisioner(
            EnvironmentContract(id="local-desktop-gateway")
        )
        process = Mock(pid=1234)
        process.poll.return_value = None

        with tempfile.TemporaryDirectory() as tmpdir:
            external_log = Path(tmpdir) / "run" / PROVISION_DESKTOP_LOG
            with patch(
                "tooling.acceptance.provisioners.local_desktop_gateway."
                "current_artifact_path",
                return_value=external_log,
            ), patch(
                "tooling.acceptance.provisioners.local_desktop_gateway."
                "subprocess.Popen",
                return_value=process,
            ), patch.object(
                provisioner,
                "_gateway_ready",
                return_value=False,
            ), patch(
                "tooling.acceptance.provisioners.local_desktop_gateway."
                "time.monotonic",
                side_effect=(0, 901),
            ), patch(
                "tooling.acceptance.provisioners.local_desktop_gateway."
                "os.killpg",
            ):
                with self.assertRaises(BlockedError) as raised:
                    provisioner._start_gateway("http://127.0.0.1:3030")
                provisioner.cleanup()

        self.assertEqual(
            raised.exception.resource,
            "desktop-gateway:http://127.0.0.1:3030",
        )
        self.assertIn(PROVISION_DESKTOP_LOG, raised.exception.reason)
        self.assertNotIn(str(external_log), raised.exception.reason)

    def test_desktop_gateway_does_not_misclassify_unexpected_value_error(self):
        provisioner = LocalDesktopGatewayProvisioner(
            EnvironmentContract(id="local-desktop-gateway")
        )
        with patch.object(
            provisioner,
            "_resolve_active_profile",
            side_effect=ValueError("unexpected provisioning defect"),
        ):
            with self.assertRaisesRegex(
                ValueError,
                "unexpected provisioning defect",
            ):
                provisioner.provision("chat-desktop-gateway-e2e")

    def test_remote_runtime_cell_skips_local_binary_preflight(self):
        provisioner = NativeTauriEmbeddedWebDriverProvisioner(
            EnvironmentContract(id="native-tauri-embedded-webdriver")
        )
        manifest = Mock()
        manifest.is_ready.return_value = True
        with patch.object(
            HomeStationProvisioner,
            "provision",
            return_value=manifest,
        ), patch.object(
            provisioner,
            "_run_preflight_command",
        ) as preflight, patch.dict(
            "os.environ",
            {"PT_ACCEPTANCE_RUNTIME_CELL": "desktop-linux-native"},
            clear=True,
        ):
            result = provisioner.provision(
                "chat-native-product-closure-e2e"
            )

        self.assertIs(result, manifest)
        preflight.assert_not_called()

    def test_native_clients_receive_distinct_webdriver_ports(self):
        provisioner = HomeStationProvisioner(
            EnvironmentContract(id="home-station")
        )
        with patch.dict(
            "os.environ",
            {"PT_DEV_SLOT": "2"},
            clear=True,
        ), patch(
            "tooling.acceptance.provisioners.home_station.socket.socket",
        ) as socket_factory:
            probe = socket_factory.return_value.__enter__.return_value
            probe.connect_ex.return_value = 1
            clients = provisioner._clients(
                "chat-native-two-client-e2e",
                "run-webdriver-ports",
            )

        self.assertEqual(
            [client.webdriver_port for client in clients],
            [4465, 4466],
        )

    def test_resolved_profile_slot_overrides_process_environment(self):
        provisioner = HomeStationProvisioner(
            EnvironmentContract(id="home-station")
        )
        with patch.dict(
            "os.environ",
            {"PT_DEV_SLOT": "0"},
            clear=True,
        ), patch(
            "tooling.acceptance.provisioners.home_station.socket.socket",
        ) as socket_factory:
            probe = socket_factory.return_value.__enter__.return_value
            probe.connect_ex.return_value = 1
            clients = provisioner._clients(
                "chat-native-product-closure-e2e",
                "run-resolved-profile-slot",
                slot=4,
            )

        self.assertEqual(
            [client.webdriver_port for client in clients],
            [4485, 4486, 4487],
        )
        self.assertEqual(
            [client.gateway_port for client in clients],
            [3730, 3731, 3732],
        )

    def test_native_webdriver_port_conflict_blocks(self):
        provisioner = HomeStationProvisioner(
            EnvironmentContract(id="home-station")
        )
        listener = None
        selected_slot = None
        for slot in range(100, 1000):
            candidate = socket.socket()
            candidate.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                candidate.bind(("127.0.0.1", 4445 + slot * 10))
            except OSError:
                candidate.close()
                continue
            listener = candidate
            selected_slot = slot
            break
        self.assertIsNotNone(listener)
        self.assertIsNotNone(selected_slot)
        assert listener is not None
        assert selected_slot is not None
        with listener:
            listener.listen()
            with patch.dict(
                "os.environ",
                {"PT_DEV_SLOT": str(selected_slot)},
                clear=True,
            ):
                with self.assertRaisesRegex(
                    BlockedError,
                    "webdriver port .* is already in use",
                ):
                    provisioner._clients(
                        "chat-native-two-client-e2e",
                        "run-webdriver-conflict",
                    )

    def test_unreachable_station_returns_blocked_manifest(self):
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "home-station.yaml"
        )
        provisioner = get_provisioner(contract)
        with patch.object(
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
            attestation = StationAttestation(
                environment_id="home-station",
                url="http://station.example:18080",
                live_commit="abc1234",
                workspace_digest="clean",
                proto_digest="proto-digest",
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
                {},
                clear=True,
            ):
                manifest = provisioner.provision(
                    "chat-native-two-client-e2e"
                )

        self.assertEqual(manifest.state, ProvisioningState.BLOCKED)
        self.assertIn("reset", manifest.blocked_reason.lower())


if __name__ == "__main__":
    unittest.main(verbosity=2)
