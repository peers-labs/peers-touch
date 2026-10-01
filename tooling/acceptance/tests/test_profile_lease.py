from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.core.lease import (
    ProfileLease,
    ProfileLeaseUnavailable,
    RemoteGitSourceLease,
    RemoteGitSourceLeaseUnavailable,
    _remote_git_source_lease_script,
)
from tooling.acceptance.core.provisioner import (
    EnvironmentProvisioner,
    resolve_deployment_environment_path,
)
from tooling.acceptance.core.provisioning import (
    EnvironmentContract,
    RuntimeManifest,
)


REPO_ROOT = Path(__file__).resolve().parents[3]


class DummyProvisioner(EnvironmentProvisioner):
    environment_id = "lease-test"

    def provision(self, gate_id: str) -> RuntimeManifest:
        return self._new_base_manifest(gate_id)


class ProfileLeaseTests(unittest.TestCase):
    def test_conflict_reports_current_owner_and_release_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            os.environ,
            {"PT_PROFILE_LEASE_DIR": directory},
        ):
            first = ProfileLease("station-three", "first-owner")
            second = ProfileLease("station-three", "second-owner")
            first.acquire()
            with self.assertRaisesRegex(
                ProfileLeaseUnavailable,
                "first-owner",
            ):
                second.acquire()
            first.release()
            first.release()
            second.acquire()
            second.release()

    def test_process_exit_releases_os_lease(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            environment = os.environ.copy()
            environment["PT_PROFILE_LEASE_DIR"] = directory
            environment["PYTHONPATH"] = str(REPO_ROOT)
            child = subprocess.Popen(
                [
                    sys.executable,
                    "-c",
                    (
                        "from tooling.acceptance.core.lease import ProfileLease;"
                        "import time;"
                        "lease=ProfileLease('station-three','child-owner');"
                        "lease.acquire();"
                        "print('ready',flush=True);"
                        "time.sleep(60)"
                    ),
                ],
                cwd=REPO_ROOT,
                env=environment,
                stdout=subprocess.PIPE,
                text=True,
            )
            try:
                self.assertEqual(child.stdout.readline().strip(), "ready")
                with patch.dict(
                    os.environ,
                    {"PT_PROFILE_LEASE_DIR": directory},
                ), self.assertRaises(ProfileLeaseUnavailable):
                    ProfileLease("station-three", "parent-owner").acquire()
            finally:
                child.terminate()
                child.wait(timeout=10)
                if child.stdout is not None:
                    child.stdout.close()

            with patch.dict(
                os.environ,
                {"PT_PROFILE_LEASE_DIR": directory},
            ):
                lease = ProfileLease("station-three", "parent-owner")
                lease.acquire()
                lease.release()

    def test_provisioner_maps_conflict_to_structured_blocked(self) -> None:
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            os.environ,
            {"PT_PROFILE_LEASE_DIR": directory},
        ):
            held = ProfileLease("station-three", "deploy-owner")
            held.acquire()
            provisioner = DummyProvisioner(
                EnvironmentContract(id="lease-test")
            )
            try:
                with self.assertRaisesRegex(
                    BlockedError,
                    "deploy-owner",
                ) as caught:
                    provisioner.acquire_profile_lease(
                        "station-three",
                        "gate-owner",
                    )
                self.assertEqual(
                    caught.exception.resource,
                    "profile-lease:station-three",
                )
            finally:
                held.release()

    def test_deploy_script_uses_machine_station_lease_and_legacy_relay_lease(self) -> None:
        source = (
            REPO_ROOT / "tooling" / "scripts" / "deploy" / "deploy.sh"
        ).read_text(encoding="utf-8")
        self.assertIn('[[ "$PT_DEPLOY_ROLE" == "station" ]]', source)
        self.assertIn("machine-dev.mjs", source)
        self.assertIn("verify-held", source)
        self.assertIn("--resource-kind station.deploy", source)
        self.assertIn("PT_PROFILE_LEASE_HELD", source)
        self.assertIn("tooling.acceptance.core.lease", source)
        self.assertIn('--resource "$env_name"', source)

    def test_deploy_script_forwards_only_valid_acceptance_runtime_environment(
        self,
    ) -> None:
        deploy_source = (
            REPO_ROOT / "tooling" / "scripts" / "deploy" / "deploy.sh"
        ).read_text(encoding="utf-8")
        compose_source = (
            REPO_ROOT / "tooling" / "docker" / "compose.yml"
        ).read_text(encoding="utf-8")

        self.assertIn("acceptance_runtime_env_prefix()", deploy_source)
        self.assertIn('[[ "$PT_DEPLOY_ROLE" != "station" ]]', deploy_source)
        self.assertIn('[[ "$environment" != "home-station" ]]', deploy_source)
        self.assertIn('[[ "$scenario_control" != "1" ]]', deploy_source)
        self.assertIn(
            '[[ ! "$run_id" =~ ^[0-9]{8}T[0-9]{12}Z-[0-9a-f]{32}$ ]]',
            deploy_source,
        )
        self.assertIn("external_runtime_env_prefix()", deploy_source)
        self.assertIn('[[ "$runtime_root" != /* ]]', deploy_source)
        self.assertIn(
            "PT_AGENT_EXTERNAL_RUNTIME_ROOT=%q "
            "PT_AGENT_EXTERNAL_START_ARGV_JSON=%q "
            "PT_AGENT_EXTERNAL_RESUME_ARGV_JSON=%q "
            "PT_AGENT_EXTERNAL_RESET_ARGV_JSON=%q",
            deploy_source,
        )
        self.assertIn(
            "${ACCEPTANCE_RUNTIME_ENV_PREFIX}"
            "${EXTERNAL_RUNTIME_ENV_PREFIX}"
            "${CLI_RUNTIME_ENV_PREFIX}"
            "${PT_DEPLOY_RESTART_CMD}",
            deploy_source,
        )
        for variable in (
            "PT_ACCEPTANCE_ENVIRONMENT",
            "PT_AGENT_CAPABILITY_SCENARIO_CONTROL",
            "PT_ACCEPTANCE_RUN_ID",
            "PT_AGENT_EXTERNAL_RUNTIME_ROOT",
            "PT_AGENT_EXTERNAL_START_ARGV_JSON",
            "PT_AGENT_EXTERNAL_RESUME_ARGV_JSON",
            "PT_AGENT_EXTERNAL_RESET_ARGV_JSON",
        ):
            self.assertIn(f"{variable}: ${{{variable}:-}}", compose_source)


class RemoteGitSourceLeaseTests(unittest.TestCase):
    def test_deployment_environment_resolver_uses_reviewed_authority(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            environment = root / "station-three.env.example"
            environment.write_text(
                "PT_DEPLOY_HOST=station.example\n",
                encoding="utf-8",
            )
            completed = subprocess.CompletedProcess(
                args=[],
                returncode=0,
                stdout=f"{environment}\n",
                stderr="",
            )
            with patch(
                "tooling.acceptance.core.provisioner.subprocess.run",
                return_value=completed,
            ) as run:
                resolved = resolve_deployment_environment_path(
                    "station-three",
                    repo_root=root,
                )

        self.assertEqual(resolved, environment.resolve())
        run.assert_called_once_with(
            [
                "/bin/bash",
                str(root / "tooling" / "scripts" / "deploy" / "deploy.sh"),
                "resolve",
                "station-three",
            ],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )

    def test_deployment_environment_resolver_maps_authority_failure(self) -> None:
        completed = subprocess.CompletedProcess(
            args=[],
            returncode=1,
            stdout="",
            stderr="[ERROR] reviewed environment topology is dirty\n",
        )
        with tempfile.TemporaryDirectory() as directory, patch(
            "tooling.acceptance.core.provisioner.subprocess.run",
            return_value=completed,
        ), self.assertRaisesRegex(
            BlockedError,
            "reviewed environment topology is dirty",
        ) as caught:
            resolve_deployment_environment_path(
                "station-three",
                repo_root=Path(directory),
            )

        self.assertEqual(
            caught.exception.resource,
            "deployment-environment:station-three",
        )

    def test_deployment_environment_resolver_rejects_relative_path(self) -> None:
        completed = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout="relative/station-three.env.example\n",
            stderr="",
        )
        with tempfile.TemporaryDirectory() as directory, patch(
            "tooling.acceptance.core.provisioner.subprocess.run",
            return_value=completed,
        ), self.assertRaisesRegex(
            BlockedError,
            "non-absolute path",
        ):
            resolve_deployment_environment_path(
                "station-three",
                repo_root=Path(directory),
            )

    def test_ssh_transport_imports_first_in_fresh_process(self) -> None:
        completed = subprocess.run(
            [
                sys.executable,
                "-c",
                (
                    "from tooling.acceptance.transports.ssh "
                    "import SshTarget, SshTransport;"
                    "from tooling.acceptance.core.attestation "
                    "import source_workspace_digest;"
                    "from tooling.acceptance.core.lease "
                    "import RemoteGitSourceLease"
                ),
            ],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )

        self.assertEqual(completed.returncode, 0, completed.stderr)

    def test_remote_lease_uses_strict_shared_ssh_transport(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            known_hosts = Path(directory) / "known_hosts"
            known_hosts.write_text(
                "station.example ssh-ed25519 test-key\n",
                encoding="utf-8",
            )
            lease = RemoteGitSourceLease(
                "station-three",
                "gate-owner",
                host="station.example",
                user="acceptance",
                deploy_path="station-three",
                port=2222,
                known_hosts_file=str(known_hosts),
            )

        command = lease._command()
        self.assertIn("StrictHostKeyChecking=yes", command)
        self.assertNotIn("StrictHostKeyChecking=no", command)
        self.assertIn(f"UserKnownHostsFile={known_hosts}", command)
        self.assertIn("2222", command)

    def _start_lease(
        self,
        home: str,
        owner: str,
    ) -> subprocess.Popen[str]:
        environment = os.environ.copy()
        environment["HOME"] = home
        process = subprocess.Popen(
            [
                "/bin/sh",
                "-c",
                _remote_git_source_lease_script("station-three", owner),
            ],
            env=environment,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        self.assertIsNotNone(process.stdout)
        self.assertEqual(process.stdout.readline().strip(), "READY")
        return process

    @staticmethod
    def _release_process(process: subprocess.Popen[str]) -> None:
        if process.stdin is not None and not process.stdin.closed:
            process.stdin.close()
        process.wait(timeout=10)
        if process.stdout is not None:
            process.stdout.close()
        if process.stderr is not None:
            process.stderr.close()

    def test_remote_script_blocks_competing_git_writer_and_releases(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            first = self._start_lease(directory, "first-owner")
            try:
                lease_path = (
                    Path(directory)
                    / ".cache"
                    / "peers-touch"
                    / "source-leases"
                    / "station-three.lock"
                )
                self.assertTrue(lease_path.is_file())
                competing = subprocess.run(
                    [
                        "/bin/sh",
                        "-c",
                        _remote_git_source_lease_script(
                            "station-three",
                            "second-owner",
                        ),
                    ],
                    env={**os.environ, "HOME": directory},
                    input="",
                    capture_output=True,
                    text=True,
                    timeout=10,
                    check=False,
                )
                self.assertEqual(competing.returncode, 73)
                self.assertIn(
                    "BLOCKED:lease-held:first-owner",
                    competing.stdout,
                )
            finally:
                self._release_process(first)

            replacement = self._start_lease(directory, "replacement-owner")
            self._release_process(replacement)

    def test_remote_script_process_exit_releases_source_lease(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            process = self._start_lease(directory, "crash-owner")
            process.terminate()
            process.wait(timeout=10)
            if process.stdin is not None:
                process.stdin.close()
            if process.stdout is not None:
                process.stdout.close()
            if process.stderr is not None:
                process.stderr.close()

            replacement = self._start_lease(directory, "replacement-owner")
            self._release_process(replacement)

    def test_provisioner_registers_remote_source_cleanup(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            environment = root / "station-three.env.example"
            environment.write_text(
                "\n".join(
                    (
                        "PT_DEPLOY_HOST=station.example",
                        "PT_DEPLOY_USER=acceptance",
                        "PT_DEPLOY_PATH=station-three",
                        "PT_DEPLOY_SSH_PORT=2222",
                        "PT_DEPLOY_KNOWN_HOSTS_FILE=/tmp/known-hosts",
                    )
                )
                + "\n",
                encoding="utf-8",
            )
            lease = MagicMock()
            lease.resource = "station-three"
            provisioner = DummyProvisioner(
                EnvironmentContract(id="lease-test")
            )
            with patch(
                "tooling.acceptance.core.provisioner.resolve_deployment_environment_path",
                return_value=environment,
            ) as resolve_environment, patch(
                "tooling.acceptance.core.provisioner.RemoteGitSourceLease",
                return_value=lease,
            ) as lease_type:
                provisioner.acquire_remote_git_source_lease(
                    "station-three",
                    "gate-owner",
                )
                completed = provisioner.cleanup()

        resolve_environment.assert_called_once_with("station-three")
        lease_type.assert_called_once_with(
            "station-three",
            "gate-owner",
            host="station.example",
            user="acceptance",
            deploy_path="station-three",
            port=2222,
            known_hosts_file="/tmp/known-hosts",
        )
        lease.acquire.assert_called_once_with()
        lease.release.assert_called_once_with()
        self.assertEqual(completed, ("source-lease:station-three",))

    def test_provisioner_maps_remote_conflict_to_structured_blocked(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            environment = root / "station-three.env.example"
            environment.write_text(
                "\n".join(
                    (
                        "PT_DEPLOY_HOST=station.example",
                        "PT_DEPLOY_USER=acceptance",
                        "PT_DEPLOY_PATH=station-three",
                    )
                )
                + "\n",
                encoding="utf-8",
            )
            lease = MagicMock()
            lease.acquire.side_effect = RemoteGitSourceLeaseUnavailable(
                "station-three",
                "deployment worktree is held by deploy-owner",
            )
            provisioner = DummyProvisioner(
                EnvironmentContract(id="lease-test")
            )
            with patch(
                "tooling.acceptance.core.provisioner.resolve_deployment_environment_path",
                return_value=environment,
            ), patch(
                "tooling.acceptance.core.provisioner.RemoteGitSourceLease",
                return_value=lease,
            ), self.assertRaisesRegex(
                BlockedError,
                "deploy-owner",
            ) as caught:
                provisioner.acquire_remote_git_source_lease(
                    "station-three",
                    "gate-owner",
                )

        self.assertEqual(
            caught.exception.resource,
            "source-lease:station-three",
        )

    def test_provisioner_rejects_noncanonical_remote_resource(self) -> None:
        provisioner = DummyProvisioner(
            EnvironmentContract(id="lease-test")
        )
        with self.assertRaisesRegex(
            BlockedError,
            "not a canonical lease resource",
        ) as caught:
            provisioner.acquire_remote_git_source_lease(
                "../station-three",
                "gate-owner",
            )

        self.assertEqual(
            caught.exception.resource,
            "source-lease:invalid-resource",
        )


if __name__ == "__main__":
    unittest.main()
