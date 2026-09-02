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
    RemoteGitSourceLeaseUnavailable,
    _remote_git_source_lease_script,
)
from tooling.acceptance.core.provisioner import EnvironmentProvisioner
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

    def test_deploy_script_uses_shared_profile_lease(self) -> None:
        source = (
            REPO_ROOT / "tooling" / "scripts" / "deploy" / "deploy.sh"
        ).read_text(encoding="utf-8")
        self.assertIn("PT_PROFILE_LEASE_HELD", source)
        self.assertIn("tooling.acceptance.core.lease", source)
        self.assertIn('--resource "$env_name"', source)


class RemoteGitSourceLeaseTests(unittest.TestCase):
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
            repo = Path(directory) / "station-three"
            subprocess.run(
                ["git", "init", str(repo)],
                check=True,
                capture_output=True,
            )
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
            repo = Path(directory) / "station-three"
            subprocess.run(
                ["git", "init", str(repo)],
                check=True,
                capture_output=True,
            )
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
            environment = (
                root
                / ".local"
                / "deploy"
                / "envs"
                / "station-three.env"
            )
            environment.parent.mkdir(parents=True)
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
            lease.resource = "station-three"
            provisioner = DummyProvisioner(
                EnvironmentContract(id="lease-test")
            )
            with patch(
                "tooling.acceptance.core.provisioner.REPO_ROOT",
                root,
            ), patch(
                "tooling.acceptance.core.provisioner.RemoteGitSourceLease",
                return_value=lease,
            ) as lease_type:
                provisioner.acquire_remote_git_source_lease(
                    "station-three",
                    "gate-owner",
                )
                completed = provisioner.cleanup()

        lease_type.assert_called_once_with(
            "station-three",
            "gate-owner",
            host="station.example",
            user="acceptance",
            deploy_path="station-three",
            port=22,
            known_hosts_file="",
        )
        lease.acquire.assert_called_once_with()
        lease.release.assert_called_once_with()
        self.assertEqual(completed, ("source-lease:station-three",))

    def test_provisioner_maps_remote_conflict_to_structured_blocked(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            environment = (
                root
                / ".local"
                / "deploy"
                / "envs"
                / "station-three.env"
            )
            environment.parent.mkdir(parents=True)
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
                "tooling.acceptance.core.provisioner.REPO_ROOT",
                root,
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
