from __future__ import annotations

import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest
import uuid
from unittest.mock import Mock, patch

from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.core.lease import source_lease_guarded_argv
from tooling.acceptance.core.provisioner import EnvironmentProvisioner
from tooling.acceptance.core.provisioning import EnvironmentContract
from tooling.acceptance.transports.ssh import (
    SSH_CONNECTIONS_ENV, SshTarget, SshTransport, ssh_target_identity,
)


@unittest.skipUnless(os.name == "posix", "owned OpenSSH sockets require POSIX")
class SourceConnectionTests(unittest.TestCase):
    def test_owner_projects_new_connections_and_restores_context_on_failure(self) -> None:
        class Owner(EnvironmentProvisioner):
            environment_id = "source-context-test"

            def provision(self, gate_id: str):
                raise NotImplementedError

        owner = Owner(EnvironmentContract(id="source-context-test"))
        descriptor = {
            "target": ssh_target_identity(SshTarget("host.example", "runner")),
            "pid": 123, "controlPath": "/tmp/private-owner/control",
            "resource": "test-source", "owner": "test-owner",
        }
        lease = Mock(resource="test-source", connection_descriptor=descriptor)
        environment = {
            "PT_DEPLOY_HOST": "host.example", "PT_DEPLOY_USER": "runner",
            "PT_DEPLOY_PATH": "station",
        }
        with (
            patch.dict(os.environ, {SSH_CONNECTIONS_ENV: "previous-context"}),
            patch("tooling.acceptance.core.provisioner.resolve_deployment_environment_path"),
            patch("tooling.acceptance.core.provisioner.load_env_file", return_value=environment),
            patch("tooling.acceptance.core.provisioner.RemoteGitSourceLease", return_value=lease) as factory,
        ):
            with self.assertRaisesRegex(RuntimeError, "after-acquisition"):
                with owner.remote_source_context():
                    self.assertNotIn(SSH_CONNECTIONS_ENV, os.environ)
                    owner.acquire_remote_git_source_lease("test-source", "test-owner")
                    self.assertEqual(json.loads(os.environ[SSH_CONNECTIONS_ENV]), [descriptor])
                    self.assertEqual(owner.remote_source_environment[SSH_CONNECTIONS_ENV], os.environ[SSH_CONNECTIONS_ENV])
                    raise RuntimeError("after-acquisition")
            self.assertEqual(os.environ[SSH_CONNECTIONS_ENV], "previous-context")
            self.assertTrue(factory.call_args.kwargs["reuse_connection"])
            self.assertEqual(owner.cleanup(), ("source-lease:test-source",))
            self.assertEqual(owner.remote_source_environment, {})
            lease.release.assert_called_once_with()

    def test_forward_probe_rejection_terminates_owned_process(self) -> None:
        process = subprocess.Popen(
            [sys.executable, "-c", "import time;time.sleep(30)"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE, start_new_session=True,
        )
        transport = SshTransport(SshTarget("127.0.0.1", "acceptance", 9))
        try:
            with (
                patch("tooling.acceptance.transports.ssh.subprocess.Popen", return_value=process),
                patch.object(
                    transport, "remote_loopback_port_listening",
                    side_effect=BlockedError("source lease was released"),
                ),
                self.assertRaises(BlockedError),
            ):
                transport.start_reverse_forward(local_port=4101, remote_port=4102, timeout=1)
            self.assertIsNotNone(process.poll())
            self.assertTrue(process.stderr.closed)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)
            if not process.stderr.closed:
                process.stderr.close()

    def test_dead_socket_and_mismatched_target_fail_before_remote_command(self) -> None:
        target = SshTarget("127.0.0.1", "acceptance", 9)
        with tempfile.TemporaryDirectory(prefix="pt-ssh-", dir="/tmp") as directory:
            control = Path(directory) / "control"
            descriptor = {
                "target": ssh_target_identity(target), "pid": os.getpid(),
                "controlPath": str(control), "resource": "test-source", "owner": "test-owner",
            }
            environment = {SSH_CONNECTIONS_ENV: json.dumps([descriptor])}
            transport = SshTransport(target, connection_environment=environment)
            with self.assertRaises(BlockedError) as absent:
                transport.run_argv(("false",), timeout=1)
            self.assertEqual(absent.exception.diagnostic.to_dict()["owner"], "tooling.acceptance.transports.ssh:SshTransport")
            listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            try:
                listener.bind(str(control))
                with self.assertRaises(BlockedError) as dead:
                    transport.run_argv(("false",), timeout=1)
                self.assertEqual(dead.exception.diagnostic.to_dict()["resourceChecks"][0]["observed"]["checkExitCode"], 255)
                mismatch = SshTransport(
                    SshTarget("127.0.0.1", "acceptance", 10),
                    connection_environment=environment,
                )
                with self.assertRaises(BlockedError):
                    mismatch.run_argv(("false",), timeout=1)
            finally:
                listener.close()

    def test_remote_guard_rechecks_real_lock_and_exact_owner_each_operation(self) -> None:
        import fcntl

        resource = "guard-test-" + uuid.uuid4().hex
        root = Path.home() / ".cache/peers-touch/source-leases"
        root.mkdir(parents=True, exist_ok=True)
        path = root / (resource + ".lock")

        def invoke(owner: str) -> subprocess.CompletedProcess[str]:
            argv = source_lease_guarded_argv(
                resource, owner, (sys.executable, "-c", "print('executed')"),
            )
            return subprocess.run(
                [sys.executable, *argv[1:]], capture_output=True, text=True,
                timeout=5, check=False,
            )

        try:
            with path.open("x+", encoding="utf-8") as handle:
                handle.write("actual-owner\n")
                handle.flush()
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                accepted = invoke("actual-owner")
                self.assertEqual(accepted.returncode, 0, accepted.stderr)
                self.assertEqual(accepted.stdout.strip(), "executed")
                mismatch = invoke("other-owner")
                self.assertEqual(mismatch.returncode, 74)
                self.assertEqual(mismatch.stdout, "")
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
                released = invoke("actual-owner")
                self.assertEqual(released.returncode, 74)
                self.assertEqual(released.stdout, "")
        finally:
            path.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
