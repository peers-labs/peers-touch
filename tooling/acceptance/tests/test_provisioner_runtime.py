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
    def test_native_clients_receive_distinct_webdriver_ports(self):
        provisioner = HomeStationProvisioner(
            EnvironmentContract(id="home-station")
        )
        with patch.dict(
            "os.environ",
            {
                "CHAT_NATIVE_CLIENT_WORKTREES": "/tmp/client",
                "CHAT_NATIVE_GATEWAY_PORT": "13330",
                "CHAT_NATIVE_RENDERER_PORT": "13510",
                "CHAT_NATIVE_WEBDRIVER_PORT": "14445",
            },
            clear=True,
        ):
            clients = provisioner._clients(
                "chat-native-two-client-e2e",
                "run-webdriver-ports",
            )

        self.assertEqual(
            [client.webdriver_port for client in clients],
            [14445, 14446],
        )

    def test_native_webdriver_port_conflict_blocks(self):
        provisioner = HomeStationProvisioner(
            EnvironmentContract(id="home-station")
        )
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen()
            port = listener.getsockname()[1]
            with patch.dict(
                "os.environ",
                {
                    "CHAT_NATIVE_CLIENT_WORKTREES": "/tmp/client",
                    "CHAT_NATIVE_GATEWAY_PORT": "13330",
                    "CHAT_NATIVE_RENDERER_PORT": "13510",
                    "CHAT_NATIVE_WEBDRIVER_PORT": str(port),
                },
                clear=True,
            ):
                with self.assertRaisesRegex(
                    BlockedError,
                    f"webdriver port {port} is already in use",
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
                artifact_path="tooling/acceptance/reports/manifests/att.json",
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
        self.assertIn("credential", manifest.blocked_reason.lower())
        self.assertEqual(
            manifest.blocked_resource,
            "credential-ref:env:CHAT_NATIVE_DEMO_PASSWORD",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
