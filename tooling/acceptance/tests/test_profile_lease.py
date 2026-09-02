from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.core.lease import (
    ProfileLease,
    ProfileLeaseUnavailable,
    RemoteGitSourceLease,
    RemoteGitSourceLeaseUnavailable,
    _remote_git_source_lease_release_script,
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
        self.assertIn('"$SOURCE_SYNC_SCRIPT"', source)
        self.assertNotIn("push_to_central()", source)
        self.assertNotIn("push_direct()", source)
        self.assertNotIn("resolve_fetch_url()", source)


class RemoteGitSourceLeaseTests(unittest.TestCase):
    def test_remote_lease_uses_strict_host_verification(self) -> None:
        with tempfile.NamedTemporaryFile() as known_hosts:
            lease = RemoteGitSourceLease(
                "station-three",
                "gate-owner",
                host="station.example",
                user="acceptance",
                deploy_path="station-three",
                port=2222,
                known_hosts_file=known_hosts.name,
            )
            command = lease._command()

        self.assertIn("StrictHostKeyChecking=yes", command)
        self.assertNotIn("StrictHostKeyChecking=no", command)
        self.assertIn("UserKnownHostsFile=" + known_hosts.name, command)
        self.assertIn("2222", command)

    def test_persistent_remote_lease_has_cross_process_release_protocol(self) -> None:
        acquire = _remote_git_source_lease_script(
            "station-three",
            "runtime-cell:linux:run-a",
            persistent=True,
            expires_at_epoch=4102444800,
        )
        release = _remote_git_source_lease_release_script(
            "station-three",
            "runtime-cell:linux:run-a",
        )

        self.assertIn("os.fork()", acquire)
        self.assertIn("READY:{child_pid}", acquire)
        self.assertIn("while time.time() < expires_at", acquire)
        self.assertIn("lease-process-mismatch", release)
        self.assertIn("os.kill(pid, signal.SIGTERM)", release)

    @patch("tooling.acceptance.core.lease.subprocess.run")
    def test_attached_persistent_remote_lease_releases_by_owner(
        self,
        run: MagicMock,
    ) -> None:
        run.return_value.returncode = 0
        run.return_value.stdout = "RELEASED\n"
        run.return_value.stderr = ""
        lease = RemoteGitSourceLease(
            "station-three",
            "runtime-cell:linux:run-a",
            host="station.example",
            user="acceptance",
            deploy_path="station-three",
            persistent=True,
        )
        lease.attach_persistent()

        lease.release()

        self.assertFalse(lease._acquired)
        command = run.call_args.args[0]
        self.assertIn("runtime-cell:linux:run-a", command[-1])
        self.assertIn("station-three", command[-1])

    def test_persistent_remote_script_holds_lock_after_launcher_exits(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            environment = {**os.environ, "HOME": directory}
            owner = "runtime-cell:linux:run-a"
            acquired = subprocess.run(
                [
                    "/bin/sh",
                    "-c",
                    _remote_git_source_lease_script(
                        "station-three",
                        owner,
                        persistent=True,
                        expires_at_epoch=int(time.time()) + 2,
                    ),
                ],
                env=environment,
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
            self.assertEqual(acquired.returncode, 0, acquired.stderr)
            self.assertRegex(acquired.stdout.strip(), r"^READY:\d+$")

            competing = subprocess.run(
                [
                    "/bin/sh",
                    "-c",
                    _remote_git_source_lease_script(
                        "station-three",
                        "second-owner",
                    ),
                ],
                env=environment,
                input="",
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
            self.assertEqual(competing.returncode, 73)
            self.assertIn(
                f"BLOCKED:lease-held:{owner}",
                competing.stdout,
            )

            time.sleep(3)
            replacement = self._start_lease(directory, "replacement-owner")
            self._release_process(replacement)

    def test_persistent_remote_script_releases_by_owner(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            environment = {**os.environ, "HOME": directory}
            owner = "runtime-cell:linux:run-release"
            acquired = subprocess.run(
                [
                    "/bin/sh",
                    "-c",
                    _remote_git_source_lease_script(
                        "station-three",
                        owner,
                        persistent=True,
                        expires_at_epoch=int(time.time()) + 60,
                    ),
                ],
                env=environment,
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
            self.assertEqual(acquired.returncode, 0, acquired.stderr)

            released = subprocess.run(
                [
                    "/bin/sh",
                    "-c",
                    _remote_git_source_lease_release_script(
                        "station-three",
                        owner,
                    ),
                ],
                env=environment,
                capture_output=True,
                text=True,
                timeout=15,
                check=False,
            )
            self.assertEqual(released.returncode, 0, released.stdout)
            self.assertIn("RELEASED", released.stdout)

            replacement = self._start_lease(directory, "replacement-owner")
            self._release_process(replacement)

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
                self.assertEqual(
                    lease_path.read_text(encoding="utf-8").strip(),
                    "first-owner",
                )
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

            second = self._start_lease(directory, "second-owner")
            self._release_process(second)

    def test_remote_script_process_exit_releases_advisory_lock(self) -> None:
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
                        "PT_DEPLOY_SSH_PORT=2222",
                        "PT_DEPLOY_KNOWN_HOSTS_FILE=/tmp/test-known-hosts",
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
            port=2222,
            known_hosts_file="/tmp/test-known-hosts",
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
