#!/usr/bin/env python3
"""Role-neutral remote source synchronization tests (NDR-W2)."""

from __future__ import annotations

import errno
import fcntl
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from tooling.acceptance.core.errors import ProvisioningError
from tooling.acceptance.core.source_sync import (
    RemoteSourceSynchronizer,
    SourceSyncRequest,
    _git_tree_digest,
    _remote_checkout_script,
)
from tooling.acceptance.transports.ssh import SshTarget, SshTransport, SshTunnel


REPO_ROOT = Path(__file__).resolve().parents[3]
SOURCE_SYNC_CLI = REPO_ROOT / "tooling" / "scripts" / "deploy" / "source_sync.py"


def _remove_tree_with_retries(root: Path) -> None:
    for attempt in range(20):
        try:
            shutil.rmtree(root)
            return
        except OSError as error:
            if error.errno != errno.ENOTEMPTY or attempt == 19:
                raise
            time.sleep(0.05)


def _git_environment() -> dict[str, str]:
    environment = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith(("GIT_AI_", "GIT_TRACE2_"))
    }
    environment["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin"
    return environment


def _run_git(root: Path, *arguments: str) -> str:
    completed = subprocess.run(
        ["git", "-C", str(root), *arguments],
        env=_git_environment(),
        capture_output=True,
        text=True,
        check=True,
    )
    return completed.stdout.strip()


class RemoteCheckoutIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / "source"
        self.bare = self.root / "source.git"
        self.home = self.root / "remote-home"
        self.home.mkdir()
        self.source.mkdir()
        _run_git(self.source, "init")
        _run_git(self.source, "config", "user.email", "acceptance@test.invalid")
        _run_git(self.source, "config", "user.name", "Acceptance Test")
        (self.source / ".gitignore").write_text("ignored/\n", encoding="utf-8")
        (self.source / "source.txt").write_text("first\n", encoding="utf-8")
        _run_git(self.source, "add", ".gitignore", "source.txt")
        _run_git(self.source, "commit", "-m", "first")
        subprocess.run(
            ["git", "init", "--bare", str(self.bare)],
            env=_git_environment(),
            capture_output=True,
            check=True,
        )
        self.branch = _run_git(self.source, "branch", "--show-current")

    def tearDown(self) -> None:
        _remove_tree_with_retries(self.root)
        self.temp.cleanup()

    def _push(self) -> str:
        commit = _run_git(self.source, "rev-parse", "HEAD")
        _run_git(
            self.source,
            "push",
            "--force",
            str(self.bare),
            f"HEAD:refs/heads/{self.branch}",
        )
        return commit

    def _checkout(
        self,
        commit: str,
        expected_digest: str = "",
        lease_mode: str = "acquire",
        lease_owner: str = "test-owner",
    ) -> subprocess.CompletedProcess[str]:
        source_digest = expected_digest or _git_tree_digest(
            self.source,
            _run_git(self.source, "rev-parse", "HEAD"),
        )
        return subprocess.run(
            [
                sys.executable,
                "-c",
                _remote_checkout_script(),
                "test-cell",
                "cell/repo",
                "url",
                str(self.bare),
                self.branch,
                commit,
                source_digest,
                lease_owner,
                lease_mode,
            ],
            env={**_git_environment(), "HOME": str(self.home)},
            capture_output=True,
            text=True,
            check=False,
        )

    def test_first_and_second_sync_keep_exact_commits(self) -> None:
        first_commit = self._push()
        first = self._checkout(first_commit)
        self.assertEqual(first.returncode, 0, first.stderr)
        first_payload = json.loads(first.stdout)
        self.assertEqual(first_payload["remoteCommit"], first_commit)
        self.assertEqual(
            first_payload["remoteSourceDigest"],
            _git_tree_digest(self.source, first_commit),
        )
        legacy_bare = self.home / "cell" / "repo" / ".bare.git"
        subprocess.run(
            ["git", "init", "--bare", str(legacy_bare)],
            env=_git_environment(),
            capture_output=True,
            check=True,
        )
        ignored = self.home / "cell" / "repo" / "ignored" / "cache.bin"
        ignored.parent.mkdir()
        ignored.write_bytes(b"stale-cache")

        (self.source / "source.txt").write_text("second\n", encoding="utf-8")
        _run_git(self.source, "add", "source.txt")
        _run_git(self.source, "commit", "-m", "second")
        second_commit = self._push()
        second = self._checkout(second_commit)
        self.assertEqual(second.returncode, 0, second.stderr)
        second_payload = json.loads(second.stdout)
        self.assertEqual(second_payload["remoteCommit"], second_commit)

        checkout = self.home / "cell" / "repo"
        self.assertFalse(legacy_bare.exists())
        self.assertFalse(ignored.exists())
        self.assertEqual(_run_git(checkout, "rev-parse", "HEAD"), second_commit)
        _run_git(checkout, "cat-file", "-e", f"{first_commit}^{{commit}}")
        self.assertEqual(
            _run_git(checkout, "status", "--porcelain", "--untracked-files=all"),
            "",
        )

    def test_dirty_remote_checkout_is_rejected(self) -> None:
        commit = self._push()
        self.assertEqual(self._checkout(commit).returncode, 0)
        checkout = self.home / "cell" / "repo"
        (checkout / "source.txt").write_text("dirty\n", encoding="utf-8")

        result = self._checkout(commit)

        self.assertEqual(result.returncode, 75)
        self.assertIn("BLOCKED:dirty-remote-worktree", result.stdout)

    def test_unreachable_expected_commit_is_rejected(self) -> None:
        self._push()
        result = self._checkout("0" * 40)
        self.assertEqual(result.returncode, 76)
        self.assertIn("BLOCKED:commit-mismatch", result.stdout)

    def test_remote_source_digest_mismatch_is_rejected(self) -> None:
        commit = self._push()
        result = self._checkout(commit, "sha256:" + ("0" * 64))
        self.assertEqual(result.returncode, 78)
        self.assertIn("BLOCKED:source-digest-mismatch", result.stdout)

    def test_source_lease_conflict_is_rejected(self) -> None:
        commit = self._push()
        lock_path = (
            self.home
            / ".cache"
            / "peers-touch"
            / "source-leases"
            / "test-cell.lock"
        )
        lock_path.parent.mkdir(parents=True)
        with lock_path.open("a+", encoding="utf-8") as lease:
            fcntl.flock(lease.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            lease.write("competing-owner\n")
            lease.flush()
            result = self._checkout(commit)
        self.assertEqual(result.returncode, 73)
        self.assertIn("BLOCKED:lease-held:competing-owner", result.stdout)

    def test_caller_held_source_lease_allows_checkout(self) -> None:
        commit = self._push()
        lock_path = (
            self.home
            / ".cache"
            / "peers-touch"
            / "source-leases"
            / "test-cell.lock"
        )
        lock_path.parent.mkdir(parents=True)
        with lock_path.open("a+", encoding="utf-8") as lease:
            fcntl.flock(lease.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            lease.write("test-owner\n")
            lease.flush()
            result = self._checkout(commit, lease_mode="held")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_caller_held_mode_rejects_missing_outer_lease(self) -> None:
        commit = self._push()
        result = self._checkout(commit, lease_mode="held")
        self.assertEqual(result.returncode, 81)
        self.assertIn("BLOCKED:source-lease-not-held", result.stdout)

    def test_caller_held_mode_rejects_different_owner(self) -> None:
        commit = self._push()
        lock_path = (
            self.home
            / ".cache"
            / "peers-touch"
            / "source-leases"
            / "test-cell.lock"
        )
        lock_path.parent.mkdir(parents=True)
        with lock_path.open("a+", encoding="utf-8") as lease:
            fcntl.flock(lease.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            lease.write("runtime-cell:test:run-1\n")
            lease.flush()
            result = self._checkout(
                commit,
                lease_mode="held",
                lease_owner="source-sync:test-cell",
            )
        self.assertEqual(result.returncode, 80)
        self.assertIn(
            "BLOCKED:lease-owner-mismatch:runtime-cell:test:run-1",
            result.stdout,
        )


class SourceSyncContractTests(unittest.TestCase):
    @staticmethod
    def _request() -> SourceSyncRequest:
        return SourceSyncRequest(
            environment_name="test-cell",
            source_root=REPO_ROOT,
            branch="main",
            host="station.example",
            user="acceptance",
            deploy_path="runtime/linux-cell",
            source_mode="direct",
        )

    def test_held_source_lease_requires_explicit_owner(self) -> None:
        with self.assertRaisesRegex(ValueError, "source_lease_owner"):
            RemoteSourceSynchronizer(
                self._request(),
                source_lease_held=True,
            )

    def test_source_lease_owner_must_be_one_line(self) -> None:
        with self.assertRaisesRegex(ValueError, "one line"):
            RemoteSourceSynchronizer(
                self._request(),
                source_lease_held=True,
                source_lease_owner="runtime-cell:test\nforged-owner",
            )

    def test_ssh_transport_imports_before_core_without_cycle(self) -> None:
        completed = subprocess.run(
            [
                sys.executable,
                "-c",
                "from tooling.acceptance.transports.ssh import SshTransport",
            ],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)

    def test_ssh_target_rejects_option_like_user(self) -> None:
        with self.assertRaisesRegex(ProvisioningError, "SSH user"):
            SshTarget(host="station.example", user="-oProxyCommand=unexpected")

    def test_ssh_tunnel_stop_reaps_process_and_closes_stderr(self) -> None:
        process = subprocess.Popen(
            ["sleep", "60"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            start_new_session=True,
        )
        tunnel = SshTunnel(process, 19418)

        tunnel.stop()
        tunnel.stop()

        self.assertIsNotNone(process.poll())
        self.assertIsNotNone(process.stderr)
        self.assertTrue(process.stderr.closed)

    def test_ssh_transport_requires_strict_host_verification(self) -> None:
        with tempfile.NamedTemporaryFile() as known_hosts:
            transport = SshTransport(
                SshTarget(
                    host="station.example",
                    user="acceptance",
                    known_hosts_file=known_hosts.name,
                )
            )
            command = transport.command_prefix()
        self.assertIn("StrictHostKeyChecking=yes", command)
        self.assertNotIn("StrictHostKeyChecking=no", command)

    def test_ssh_copy_uses_strict_host_verification_and_remote_path(self) -> None:
        transport = SshTransport(
            SshTarget(host="station.example", user="acceptance", port=2222)
        )
        with (
            tempfile.NamedTemporaryFile() as source,
            patch(
                "tooling.acceptance.transports.ssh.subprocess.run",
                return_value=subprocess.CompletedProcess(
                    args=(),
                    returncode=0,
                    stdout="",
                    stderr="",
                ),
            ) as run,
        ):
            transport.copy_file(
                Path(source.name),
                Path("/remote/run/staging/file.png"),
            )

        command = run.call_args.args[0]
        self.assertEqual(command[0], "scp")
        self.assertIn("StrictHostKeyChecking=yes", command)
        self.assertIn("-P", command)
        self.assertIn("2222", command)
        self.assertEqual(
            command[-1],
            "acceptance@station.example:/remote/run/staging/file.png",
        )

    def test_ssh_copy_rejects_relative_remote_path(self) -> None:
        transport = SshTransport(
            SshTarget(host="station.example", user="acceptance")
        )
        with tempfile.NamedTemporaryFile() as source:
            with self.assertRaisesRegex(
                ProvisioningError,
                "destination is invalid",
            ):
                transport.copy_file(
                    Path(source.name),
                    Path("remote/run/file"),
                )

    def test_reverse_forward_requires_remote_end_to_end_readiness(self) -> None:
        transport = SshTransport(
            SshTarget(host="station.example", user="acceptance")
        )
        tunnel = Mock(spec=SshTunnel)
        with patch.object(
            transport,
            "_start_forward",
            return_value=tunnel,
        ) as start_forward:
            result = transport.start_reverse_forward(
                local_port=51219,
                remote_port=51219,
            )

        self.assertIs(result, tunnel)
        start_forward.assert_called_once_with(
            direction="-R",
            specification="127.0.0.1:51219:127.0.0.1:51219",
            local_probe_port=None,
            remote_probe_port=51219,
            timeout=10,
        )

    def test_remote_loopback_probe_reports_connection_result(self) -> None:
        transport = SshTransport(
            SshTarget(host="station.example", user="acceptance")
        )
        with patch.object(
            transport,
            "run_argv",
            return_value=subprocess.CompletedProcess(
                args=(),
                returncode=0,
                stdout="",
                stderr="",
            ),
        ) as run_argv:
            self.assertTrue(
                transport.remote_loopback_port_listening(51219)
            )

        command = run_argv.call_args.args[0]
        self.assertEqual(command[-1], "51219")
        self.assertIn("socket.create_connection", command[-2])

    def test_request_loads_profile_backed_target(self) -> None:
        root = Path(tempfile.mkdtemp())
        try:
            source = root / "source"
            source.mkdir()
            _run_git(source, "init")
            _run_git(source, "config", "user.email", "acceptance@test.invalid")
            _run_git(source, "config", "user.name", "Acceptance Test")
            (source / "tracked").write_text("data\n", encoding="utf-8")
            _run_git(source, "add", "tracked")
            _run_git(source, "commit", "-m", "base")
            envs = root / "envs"
            envs.mkdir()
            (envs / "linux-cell.env").write_text(
                "\n".join(
                    (
                        "PT_DEPLOY_HOST=station.example",
                        "PT_DEPLOY_USER=acceptance",
                        "PT_DEPLOY_PATH=runtime/linux-cell",
                        "PT_DEPLOY_SOURCE=direct",
                    )
                )
                + "\n",
                encoding="utf-8",
            )
            request = SourceSyncRequest.from_env_files(
                "linux-cell",
                source_root=source,
                environments_dir=envs,
                central_environment_path=root / "missing-central.env",
            )
        finally:
            _remove_tree_with_retries(root)
        self.assertEqual(request.host, "station.example")
        self.assertEqual(request.deploy_path, "runtime/linux-cell")
        self.assertEqual(request.source_mode, "direct")

    def test_central_profile_uses_independent_ssh_configuration(self) -> None:
        root = Path(tempfile.mkdtemp())
        try:
            source = root / "source"
            source.mkdir()
            _run_git(source, "init")
            _run_git(source, "config", "user.email", "acceptance@test.invalid")
            _run_git(source, "config", "user.name", "Acceptance Test")
            (source / "tracked").write_text("data\n", encoding="utf-8")
            _run_git(source, "add", "tracked")
            _run_git(source, "commit", "-m", "base")
            envs = root / "envs"
            envs.mkdir()
            (envs / "linux-cell.env").write_text(
                "\n".join(
                    (
                        "PT_DEPLOY_HOST=station.example",
                        "PT_DEPLOY_USER=acceptance",
                        "PT_DEPLOY_PATH=runtime/linux-cell",
                        "PT_DEPLOY_SOURCE=central",
                    )
                )
                + "\n",
                encoding="utf-8",
            )
            known_hosts = root / "central-known-hosts"
            known_hosts.touch()
            central = root / "git-server.env"
            central.write_text(
                "\n".join(
                    (
                        "PT_GIT_SERVER_HOST=git.example",
                        "PT_GIT_SERVER_USER=git",
                        "PT_GIT_SERVER_BARE_PATH=repositories/peers-touch.git",
                        "PT_GIT_SERVER_SSH_PORT=2222",
                        f"PT_GIT_SERVER_KNOWN_HOSTS_FILE={known_hosts}",
                    )
                )
                + "\n",
                encoding="utf-8",
            )
            request = SourceSyncRequest.from_env_files(
                "linux-cell",
                source_root=source,
                environments_dir=envs,
                central_environment_path=central,
            )
        finally:
            _remove_tree_with_retries(root)
        self.assertEqual(request.central_ssh_port, 2222)
        self.assertEqual(
            request.central_known_hosts_file,
            str(known_hosts),
        )

    def test_cli_require_clean_rejects_dirty_source_before_ssh(self) -> None:
        root = Path(tempfile.mkdtemp())
        try:
            source = root / "source"
            source.mkdir()
            _run_git(source, "init")
            _run_git(source, "config", "user.email", "acceptance@test.invalid")
            _run_git(source, "config", "user.name", "Acceptance Test")
            (source / "tracked").write_text("base\n", encoding="utf-8")
            _run_git(source, "add", "tracked")
            _run_git(source, "commit", "-m", "base")
            (source / "tracked").write_text("dirty\n", encoding="utf-8")
            envs = root / "envs"
            envs.mkdir()
            (envs / "linux-cell.env").write_text(
                "\n".join(
                    (
                        "PT_DEPLOY_HOST=unreachable.invalid",
                        "PT_DEPLOY_USER=acceptance",
                        "PT_DEPLOY_PATH=runtime/linux-cell",
                        "PT_DEPLOY_SOURCE=direct",
                    )
                )
                + "\n",
                encoding="utf-8",
            )
            completed = subprocess.run(
                [
                    sys.executable,
                    str(SOURCE_SYNC_CLI),
                    "linux-cell",
                    "--source-root",
                    str(source),
                    "--require-clean",
                ],
                env={
                    **os.environ,
                    "PT_DEPLOY_ENVS_DIR": str(envs),
                    "PT_GIT_SERVER_ENV": str(root / "missing-central.env"),
                },
                capture_output=True,
                text=True,
                check=False,
            )
        finally:
            _remove_tree_with_retries(root)
        self.assertEqual(completed.returncode, 1)
        self.assertIn("requires a clean local Git worktree", completed.stderr)
        self.assertNotIn("Could not resolve hostname", completed.stderr)

    def test_deploy_script_has_single_source_sync_entrypoint(self) -> None:
        source = (
            REPO_ROOT / "tooling" / "scripts" / "deploy" / "deploy.sh"
        ).read_text(encoding="utf-8")
        self.assertIn('"$SOURCE_SYNC_SCRIPT"', source)
        self.assertIn("PT_SOURCE_LEASE_HELD", source)
        self.assertIn('/bin/bash "$SCRIPT_DIR/deploy.sh" "$@"', source)
        self.assertNotIn("push_to_central()", source)
        self.assertNotIn("push_direct()", source)
        self.assertNotIn("resolve_fetch_url()", source)
        self.assertNotIn("refs/remotes/deploy", source)
        self.assertIn(".cache/peers-touch/build/$env_name", source)
        self.assertNotIn("$PT_DEPLOY_PATH/.cache/go", source)

    def test_git_server_setup_does_not_publish_source(self) -> None:
        source = (
            REPO_ROOT
            / "tooling"
            / "scripts"
            / "deploy"
            / "setup-git-server.sh"
        ).read_text(encoding="utf-8")
        self.assertIn("StrictHostKeyChecking=yes", source)
        self.assertNotIn("StrictHostKeyChecking=no", source)
        self.assertNotIn("git -C \"$PROJECT_ROOT\" push", source)


if __name__ == "__main__":
    unittest.main()
