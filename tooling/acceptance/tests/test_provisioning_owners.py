#!/usr/bin/env python3
"""Attestation and actor Fixture owner contract tests."""

from __future__ import annotations

import errno
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, call, patch

from tooling.acceptance.core import (
    ActorManifest,
    ENVIRONMENTS_DIR,
    EnvironmentContract,
    ProvisioningError,
    ServiceAttestation,
)
from tooling.acceptance.core.attestation import (
    PROTOCOL_SOURCE_PATHS,
    produce_service_attestation,
    produce_station_attestation,
    source_proto_digest,
    source_workspace_digest,
)
from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.core.evidence_store import ArtifactRef, EvidenceStore
from tooling.acceptance.fixtures import chat_native_reset
from tooling.acceptance.fixtures.chat_native_actors import (
    ACTOR_ACCOUNTS,
    ResolvedActorIdentity,
    prepare_bound_friendships,
    prepare_bound_federation_routing,
    produce_actor_manifest,
    produce_bound_actor_manifest,
    reset_fixture,
    resolve_actor_identity,
    resolve_existing_actor_identity,
)
from tooling.acceptance.provisioners import (
    CrossStationSocialNativeProvisioner,
    get_provisioner,
)
from tooling.acceptance.remote_platform import RemotePlatform


class StationAttestationOwnerTests(unittest.TestCase):
    def test_proto_digest_uses_only_git_tracked_contract_artifacts(self) -> None:
        native_git_environment = {
            key: value
            for key, value in os.environ.items()
            if not key.startswith(("GIT_AI_", "GIT_TRACE2_"))
        }
        native_git_environment["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin"
        root = Path(tempfile.mkdtemp())
        try:
            with patch.dict(
                os.environ,
                native_git_environment,
                clear=True,
            ):
                subprocess.run(
                    ["git", "init"],
                    cwd=root,
                    check=True,
                    capture_output=True,
                )
                subprocess.run(
                    ["git", "config", "user.email", "acceptance@test.invalid"],
                    cwd=root,
                    check=True,
                )
                subprocess.run(
                    ["git", "config", "user.name", "Acceptance Test"],
                    cwd=root,
                    check=True,
                )
                proto = root / "model/domain/test.proto"
                generated = (
                    root
                    / "apps/desktop/src/gen/proto/domain/test_pb.ts"
                )
                station_dashboard = (
                    root
                    / "apps/station/app/subserver/dashboard/web/src/api/client.ts"
                )
                proto.parent.mkdir(parents=True)
                generated.parent.mkdir(parents=True)
                station_dashboard.parent.mkdir(parents=True)
                proto.write_text("syntax = \"proto3\";\n", encoding="utf-8")
                generated.write_text("// generated\n", encoding="utf-8")
                station_dashboard.write_text(
                    "// not a protocol artifact\n",
                    encoding="utf-8",
                )
                subprocess.run(
                    ["git", "add", "model", "apps"],
                    cwd=root,
                    check=True,
                )
                subprocess.run(
                    ["git", "commit", "-m", "base"],
                    cwd=root,
                    check=True,
                    capture_output=True,
                )
                baseline = source_proto_digest(root)

                station_dashboard.write_text(
                    "// ordinary Station TypeScript changed\n",
                    encoding="utf-8",
                )
                self.assertEqual(source_proto_digest(root), baseline)

                untracked = (
                    root
                    / "apps/station/app/subserver/test/model/test.pb.go"
                )
                untracked.parent.mkdir(parents=True)
                untracked.write_text("// generated\n", encoding="utf-8")
                self.assertEqual(source_proto_digest(root), baseline)

                generated.write_text("// generated changed\n", encoding="utf-8")
                self.assertNotEqual(source_proto_digest(root), baseline)
        finally:
            for attempt in range(20):
                try:
                    shutil.rmtree(root)
                    break
                except OSError as error:
                    if error.errno != errno.ENOTEMPTY or attempt == 19:
                        raise
                    time.sleep(0.05)

    def test_remote_attestation_excludes_only_deployment_bare_repo(self) -> None:
        from tooling.acceptance.provisioners.remote_source_identity import (
            resolve_remote_source_identity,
        )

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            known_hosts = root / "known_hosts"
            known_hosts.write_text(
                "station.example ssh-ed25519 test-key\n",
                encoding="utf-8",
            )
            environment = root / "station-three.env.example"
            environment.write_text(
                "\n".join(
                    (
                        "PT_DEPLOY_HOST=station.example",
                        "PT_DEPLOY_USER=acceptance",
                        "PT_DEPLOY_PATH=station-three",
                        "PT_DEPLOY_SSH_PORT=2222",
                        f"PT_DEPLOY_KNOWN_HOSTS_FILE={known_hosts}",
                    )
                )
                + "\n",
                encoding="utf-8",
            )
            completed = subprocess.CompletedProcess(
                args=[],
                returncode=0,
                stdout="abcdef123456\nclean\nproto-digest\n",
                stderr="",
            )
            with patch(
                "tooling.acceptance.provisioners.remote_source_identity.resolve_deployment_environment_path",
                return_value=environment,
            ), patch(
                "tooling.acceptance.transports.ssh.subprocess.run",
                return_value=completed,
            ) as run:
                identity = resolve_remote_source_identity("station-three")

        self.assertEqual(
            identity,
            ("abcdef123456", "clean", "proto-digest"),
        )
        command = run.call_args.args[0]
        remote_command = command[-1]
        self.assertIn("git status --porcelain | sed", remote_command)
        self.assertIn("\\.bare\\.git\\/", remote_command)
        self.assertIn("subprocess.check_output", remote_command)
        self.assertIn("ls-files", remote_command)
        for pathspec in PROTOCOL_SOURCE_PATHS:
            self.assertIn(pathspec, remote_command)
        self.assertNotIn("x.endswith(b'.ts')", remote_command)
        self.assertNotIn("apps/mobile/ios", remote_command)
        self.assertIn("StrictHostKeyChecking=yes", command)
        self.assertNotIn("StrictHostKeyChecking=no", command)
        self.assertIn(f"UserKnownHostsFile={known_hosts}", command)
        self.assertIn("2222", command)
        self.assertEqual(run.call_args.kwargs["timeout"], 30)
        self.assertFalse(run.call_args.kwargs["check"])

    def test_remote_attestation_rejects_invalid_known_hosts_contract(self) -> None:
        from tooling.acceptance.provisioners.remote_source_identity import (
            resolve_remote_source_identity,
        )

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            environment = root / "station-three.env.example"
            environment.write_text(
                "\n".join(
                    (
                        "PT_DEPLOY_HOST=station.example",
                        "PT_DEPLOY_USER=acceptance",
                        "PT_DEPLOY_PATH=station-three",
                        f"PT_DEPLOY_KNOWN_HOSTS_FILE={root / 'missing-known-hosts'}",
                    )
                )
                + "\n",
                encoding="utf-8",
            )

            with patch(
                "tooling.acceptance.provisioners.remote_source_identity.resolve_deployment_environment_path",
                return_value=environment,
            ), self.assertRaisesRegex(
                BlockedError,
                "SSH contract is invalid",
            ):
                resolve_remote_source_identity("station-three")

    def test_remote_attestation_timeout_is_environment_blocked(self) -> None:
        from tooling.acceptance.provisioners.remote_source_identity import (
            resolve_remote_source_identity,
        )

        transport = MagicMock()
        transport.target.remote_platform = RemotePlatform.POSIX
        transport.run_argv.side_effect = subprocess.TimeoutExpired(
            ("ssh", "station.example"),
            30,
        )
        with patch(
            "tooling.acceptance.provisioners.remote_source_identity."
            "_reviewed_remote_transport",
            return_value=(transport, {"PT_DEPLOY_PATH": "station-three"}),
        ), self.assertRaisesRegex(
            BlockedError,
            "Cannot attest deployment station-three",
        ) as raised:
            resolve_remote_source_identity("station-three")

        self.assertEqual(
            raised.exception.resource,
            "deployment-source:station-three",
        )

    def test_remote_attestation_uses_windows_transport_without_bash(self) -> None:
        from tooling.acceptance.provisioners.remote_source_identity import (
            _windows_source_identity_script,
            resolve_remote_source_identity,
        )

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            environment = root / "sixwin-station.env.example"
            environment.write_text(
                "\n".join(
                    (
                        "PT_DEPLOY_HOST=sixwin.example",
                        "PT_DEPLOY_USER=Administrator",
                        "PT_DEPLOY_PATH=.peers-touch/deploy/sixwin-station/source",
                        "PT_DEPLOY_PLATFORM=windows",
                    )
                )
                + "\n",
                encoding="utf-8",
            )
            completed = subprocess.CompletedProcess(
                args=[],
                returncode=0,
                stdout=json.dumps(
                    ["abcdef123456", "clean", "proto-digest"]
                )
                + "\n",
                stderr="",
            )
            with patch(
                "tooling.acceptance.provisioners.remote_source_identity."
                "resolve_deployment_environment_path",
                return_value=environment,
            ), patch(
                "tooling.acceptance.transports.ssh.subprocess.run",
                return_value=completed,
            ) as run:
                identity = resolve_remote_source_identity("sixwin-station")

        self.assertEqual(
            identity,
            ("abcdef123456", "clean", "proto-digest"),
        )
        command = run.call_args.args[0]
        self.assertIn("powershell.exe -NoProfile -NonInteractive", command[-1])
        self.assertNotIn("bash -lc", command[-1])
        identity_script = _windows_source_identity_script()
        self.assertIn("['git','show','HEAD:'", identity_script)
        self.assertNotIn("x.read_bytes()", identity_script)

    def test_windows_service_version_uses_registered_runtime_identity(self) -> None:
        from tooling.acceptance.provisioners.remote_source_identity import (
            resolve_windows_service_version,
        )

        config = MagicMock(
            role="station",
            task_name="PeersTouch-sixwin-station",
        )
        transport = MagicMock()
        transport.target.remote_platform = RemotePlatform.WINDOWS
        status = {
            "artifactKind": "windows-native-runtime-status",
            "environmentName": "sixwin-station",
            "role": "station",
            "taskName": "PeersTouch-sixwin-station",
            "taskRegistered": True,
            "healthy": True,
            "sourceClean": True,
            "sourceCommit": "abcdef1234567890",
            "processIds": [42],
            "manifest": {
                "sourceCommit": "abcdef123456",
                "sourceClean": True,
                "role": "station",
                "taskName": "PeersTouch-sixwin-station",
                "binarySha256": "sha256:" + "b" * 64,
                "deployedAt": "2026-10-08T00:00:00Z",
            },
        }
        with patch(
            "tooling.acceptance.provisioners.remote_source_identity."
            "_reviewed_remote_transport",
            return_value=(transport, {}),
        ), patch(
            "tooling.acceptance.provisioners.remote_source_identity."
            "resolve_deployment_environment_path",
            return_value=Path("/reviewed/sixwin-station.env.example"),
        ), patch(
            "tooling.acceptance.provisioners.remote_source_identity."
            "WindowsRuntimeConfig.load",
            return_value=config,
        ), patch(
            "tooling.acceptance.provisioners.remote_source_identity."
            "execute_windows_runtime",
            return_value=status,
        ):
            version = resolve_windows_service_version("sixwin-station")

        self.assertEqual(version["build_commit"], "abcdef1234567890")
        self.assertEqual(
            version["service_id"],
            "windows-task:PeersTouch-sixwin-station",
        )

    def test_remote_attestation_uses_strict_openssh_default_known_hosts(self) -> None:
        from tooling.acceptance.provisioners.remote_source_identity import (
            resolve_remote_source_identity,
        )

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            environment = root / "station-four.env.example"
            environment.write_text(
                "\n".join(
                    (
                        "PT_DEPLOY_HOST=station.example",
                        "PT_DEPLOY_USER=acceptance",
                        "PT_DEPLOY_PATH=station-four",
                    )
                )
                + "\n",
                encoding="utf-8",
            )
            completed = subprocess.CompletedProcess(
                args=[],
                returncode=0,
                stdout="abcdef123456\nclean\nproto-digest\n",
                stderr="",
            )
            with patch(
                "tooling.acceptance.provisioners.remote_source_identity.resolve_deployment_environment_path",
                return_value=environment,
            ), patch(
                "tooling.acceptance.transports.ssh.subprocess.run",
                return_value=completed,
            ) as run:
                identity = resolve_remote_source_identity("station-four")

        self.assertEqual(identity, ("abcdef123456", "clean", "proto-digest"))
        command = run.call_args.args[0]
        self.assertIn("StrictHostKeyChecking=yes", command)
        self.assertFalse(
            any(
                argument.startswith("UserKnownHostsFile=")
                for argument in command
            )
        )

    def test_reviewed_remote_tunnel_uses_deployment_ssh_authority(self) -> None:
        from tooling.acceptance.provisioners.remote_source_identity import (
            open_reviewed_remote_tunnel,
        )

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            known_hosts = root / "known_hosts"
            known_hosts.write_text(
                "station.example ssh-ed25519 test-key\n",
                encoding="utf-8",
            )
            environment = root / "station-three.env.example"
            environment.write_text(
                "\n".join(
                    (
                        "PT_DEPLOY_HOST=station.example",
                        "PT_DEPLOY_USER=acceptance",
                        "PT_DEPLOY_PATH=station-three",
                        "PT_DEPLOY_SSH_PORT=2222",
                        f"PT_DEPLOY_KNOWN_HOSTS_FILE={known_hosts}",
                    )
                )
                + "\n",
                encoding="utf-8",
            )
            tunnel = MagicMock()
            transport = MagicMock()
            transport.start_local_forward.return_value = tunnel
            with patch(
                "tooling.acceptance.provisioners.remote_source_identity.resolve_deployment_environment_path",
                return_value=environment,
            ), patch(
                "tooling.acceptance.provisioners.remote_source_identity.SshTransport",
                return_value=transport,
            ) as transport_type:
                resolved = open_reviewed_remote_tunnel(
                    "station-three",
                    remote_host="10.0.0.3",
                    remote_port=18080,
                    local_port=4101,
                    timeout=7,
                )

        self.assertIs(resolved, tunnel)
        self.assertEqual(
            {
                "remote_host": "10.0.0.3",
                "remote_port": 18080,
                "local_port": 4101,
                "timeout": 7,
            },
            transport.start_local_forward.call_args.kwargs,
        )
        target = transport_type.call_args.args[0]
        self.assertEqual("station.example", target.host)
        self.assertEqual("acceptance", target.user)
        self.assertEqual(2222, target.port)
        self.assertEqual(str(known_hosts), target.known_hosts_file)

    def test_workspace_digest_binds_file_content(self) -> None:
        # The IDE git wrapper writes .git/ai asynchronously; use native Git so
        # TemporaryDirectory cleanup is deterministic.
        native_git_environment = {
            key: value
            for key, value in os.environ.items()
            if not key.startswith(("GIT_AI_", "GIT_TRACE2_"))
        }
        native_git_environment["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin"
        root = Path(tempfile.mkdtemp())
        try:
            with patch.dict(
                os.environ,
                native_git_environment,
                clear=True,
            ):
                subprocess.run(["git", "init"], cwd=root, check=True, capture_output=True)
                subprocess.run(
                    ["git", "config", "user.email", "acceptance@test.invalid"],
                    cwd=root,
                    check=True,
                )
                subprocess.run(
                    ["git", "config", "user.name", "Acceptance Test"],
                    cwd=root,
                    check=True,
                )
                source = root / "source.txt"
                source.write_text("base\n", encoding="utf-8")
                subprocess.run(["git", "add", "source.txt"], cwd=root, check=True)
                subprocess.run(
                    [
                        "git",
                        "-c",
                        "maintenance.auto=false",
                        "-c",
                        "gc.auto=0",
                        "commit",
                        "-m",
                        "base",
                    ],
                    cwd=root,
                    check=True,
                    capture_output=True,
                )
                self.assertEqual(source_workspace_digest(root), "clean")
                source.write_text("first\n", encoding="utf-8")
                first = source_workspace_digest(root)
                source.write_text("second\n", encoding="utf-8")
                second = source_workspace_digest(root)
        finally:
            for attempt in range(20):
                try:
                    shutil.rmtree(root)
                    break
                except OSError as error:
                    if error.errno != errno.ENOTEMPTY or attempt == 19:
                        raise
                    time.sleep(0.05)

        self.assertTrue(first.startswith("sha256:"))
        self.assertTrue(second.startswith("sha256:"))
        self.assertNotEqual(first, second)

    def test_workspace_digest_ignores_generated_coverage_report(self) -> None:
        native_git_environment = {
            key: value
            for key, value in os.environ.items()
            if not key.startswith(("GIT_AI_", "GIT_TRACE2_"))
        }
        native_git_environment["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin"
        root = Path(tempfile.mkdtemp())
        try:
            with patch.dict(
                os.environ,
                native_git_environment,
                clear=True,
            ):
                subprocess.run(
                    ["git", "init"],
                    cwd=root,
                    check=True,
                    capture_output=True,
                )
                subprocess.run(
                    ["git", "config", "user.email", "acceptance@test.invalid"],
                    cwd=root,
                    check=True,
                )
                subprocess.run(
                    ["git", "config", "user.name", "Acceptance Test"],
                    cwd=root,
                    check=True,
                )
                report = (
                    root
                    / "docs"
                    / "architecture"
                    / "engineering"
                    / "acceptance"
                    / "coverage-report.md"
                )
                report.parent.mkdir(parents=True)
                report.write_text("old\n", encoding="utf-8")
                source = root / "source.txt"
                source.write_text("base\n", encoding="utf-8")
                subprocess.run(
                    ["git", "add", "docs", "source.txt"],
                    cwd=root,
                    check=True,
                )
                subprocess.run(
                    ["git", "commit", "-m", "base"],
                    cwd=root,
                    check=True,
                    capture_output=True,
                )

                report.write_text("new\n", encoding="utf-8")
                self.assertEqual(source_workspace_digest(root), "clean")

                source.write_text("changed\n", encoding="utf-8")
                self.assertTrue(
                    source_workspace_digest(root).startswith("sha256:")
                )
        finally:
            for attempt in range(20):
                try:
                    shutil.rmtree(root)
                    break
                except OSError as error:
                    if error.errno != errno.ENOTEMPTY or attempt == 19:
                        raise
                    time.sleep(0.05)

    def test_producer_writes_source_bound_attestation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            worktree = root / "repo"
            worktree.mkdir()
            store = EvidenceStore(root / "artifacts", worktree=worktree)
            run = store.begin_run("test-gate", source={})
            with patch.dict(
                os.environ,
                run.subprocess_environment(os.environ),
            ), patch(
                "tooling.acceptance.core.attestation.REPO_ROOT",
                worktree,
            ), patch(
                "tooling.acceptance.core.attestation.read_service_version",
                return_value={
                    "build_commit": "abcdef123456",
                    "build_time": "2026-08-16T00:00:00Z",
                },
            ), patch(
                "tooling.acceptance.core.attestation._local_source_identity",
                return_value=("abcdef1234567890", "clean", "proto-digest"),
            ):
                attestation = produce_station_attestation(
                    environment_id="test",
                    run_id="run-1",
                    service_id="station",
                    station_url="http://station.example",
                    profile_env={"PT_STATION_MODE": "local"},
                )
                secondary = produce_station_attestation(
                    environment_id="test",
                    run_id="run-1",
                    service_id="station-secondary",
                    station_url="http://station-secondary.example",
                    profile_env={"PT_STATION_MODE": "local"},
                )

            path = store.resolve(ArtifactRef.from_dict(attestation.artifact_ref))
            payload = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(
                payload["artifactKind"],
                "service-deployment-attestation",
            )
            self.assertEqual(payload["serviceId"], "station")
            self.assertEqual(payload["serviceKind"], "station")
            self.assertEqual(payload["producer"], "station-deployment")
            self.assertEqual(payload["commit"], "abcdef1234567890")
            self.assertEqual(payload["protocolDigest"], "proto-digest")
            self.assertEqual(
                attestation.artifact_ref["path"],
                "runtime/services/station/attestation.json",
            )
            self.assertEqual(
                secondary.artifact_ref["path"],
                "runtime/services/station-secondary/attestation.json",
            )
            self.assertNotEqual(
                attestation.artifact_ref["path"],
                secondary.artifact_ref["path"],
            )
            run.close()

    def test_remote_attestation_requires_injected_source_identity_owner(
        self,
    ) -> None:
        with patch(
            "tooling.acceptance.core.attestation.read_service_version",
            return_value={"build_commit": "abcdef123456"},
        ):
            with self.assertRaisesRegex(
                BlockedError,
                "missing its deployment source identity provider",
            ):
                produce_station_attestation(
                    environment_id="test",
                    run_id="run-1",
                    service_id="station",
                    station_url="http://station.example",
                    profile_env={
                        "PT_STATION_MODE": "remote",
                        "PT_STATION_DEPLOY_ENV": "station-three",
                    },
                )

    def test_service_attestation_accepts_deployment_runtime_version_owner(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            worktree = root / "repo"
            worktree.mkdir()
            store = EvidenceStore(root / "artifacts", worktree=worktree)
            run = store.begin_run("test-gate", source={})
            runtime_version = MagicMock(
                return_value={
                    "build_commit": "abcdef123456",
                    "build_time": "2026-10-08T00:00:00Z",
                    "service_id": "docker-compose:pt-relay/relay",
                }
            )
            with patch.dict(
                os.environ,
                run.subprocess_environment(os.environ),
            ), patch(
                "tooling.acceptance.core.attestation.REPO_ROOT",
                worktree,
            ), patch(
                "tooling.acceptance.core.attestation.read_service_version",
            ) as endpoint_version:
                attestation = produce_service_attestation(
                    environment_id="test",
                    run_id="run-1",
                    service_id="relay",
                    service_kind="relay",
                    endpoint="http://relay.example",
                    mode="remote",
                    deployment_environment="relay-1",
                    producer="relay-deployment",
                    require_runtime_identity=True,
                    remote_source_identity_provider=lambda _: (
                        "abcdef1234567890",
                        "clean",
                        "proto-digest",
                    ),
                    runtime_version_provider=runtime_version,
                )

            endpoint_version.assert_not_called()
            runtime_version.assert_called_once_with("relay-1")
            self.assertEqual(
                attestation.runtime_identity,
                "docker-compose:pt-relay/relay",
            )
            run.close()

    def test_dirty_station_deployment_blocks(self) -> None:
        with patch(
            "tooling.acceptance.core.attestation.read_service_version",
            return_value={"build_commit": "abcdef123456"},
        ), patch(
            "tooling.acceptance.core.attestation._local_source_identity",
            return_value=("abcdef123456", "dirty", "proto-digest"),
        ):
            with self.assertRaisesRegex(BlockedError, "workspace is dirty"):
                produce_station_attestation(
                    environment_id="test",
                    run_id="run-1",
                    service_id="station",
                    station_url="http://station.example",
                    profile_env={"PT_STATION_MODE": "local"},
                )


class ActorFixtureOwnerTests(unittest.TestCase):
    def test_reset_module_imports_in_fresh_process(self) -> None:
        completed = subprocess.run(
            [
                sys.executable,
                "-c",
                (
                    "from tooling.acceptance.fixtures.chat_native_reset "
                    "import main"
                ),
            ],
            cwd=Path(__file__).resolve().parents[3],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )

        self.assertEqual(
            completed.returncode,
            0,
            completed.stderr or completed.stdout,
        )

    @patch("tooling.acceptance.fixtures.chat_native_reset._remote_transport")
    def test_reset_target_remote_command_uses_remaining_budget(
        self,
        remote_transport,
    ) -> None:
        transport = MagicMock()
        transport.run_argv.return_value = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout="{}\n",
            stderr="",
        )
        remote_transport.return_value = transport
        cancellation = threading.Event()
        deadline = time.monotonic() + 1

        chat_native_reset._remote_command(
            {
                "PT_DEPLOY_HOST": "station.example",
                "PT_DEPLOY_USER": "acceptance",
            },
            "true",
            deadline_monotonic=deadline,
            cancellation=cancellation,
        )

        timeout = transport.run_argv.call_args.kwargs["timeout"]
        self.assertGreater(timeout, 0)
        self.assertLessEqual(timeout, 1)

    @patch("tooling.acceptance.fixtures.chat_native_actors.os.killpg")
    @patch("tooling.acceptance.fixtures.chat_native_actors.subprocess.Popen")
    @patch(
        "tooling.acceptance.fixtures.chat_native_actors."
        "machine_lease_reset_profile",
        return_value="four",
    )
    def test_reset_fixture_uses_package_module(
        self,
        _lease_profile,
        popen,
        killpg,
    ) -> None:
        process = MagicMock()
        process.pid = 1234
        process.returncode = 0
        process.communicate.return_value = ("", "")
        popen.return_value = process
        killpg.side_effect = ProcessLookupError()

        reset_fixture(
            "chat-native-acceptance",
            ("alice", "bob"),
            reset_authorized=True,
        )

        arguments, options = popen.call_args
        self.assertEqual(
            arguments[0],
            [
                sys.executable,
                "-m",
                "tooling.acceptance.fixtures.chat_native_reset",
                "--environment",
                "chat-native-acceptance",
                "--accounts",
                "alice",
                "bob",
            ],
        )
        self.assertEqual(
            options["cwd"],
            Path(__file__).resolve().parents[3],
        )
        self.assertTrue(options["start_new_session"])
        self.assertFalse(options["shell"])
        self.assertTrue(options["close_fds"])
        self.assertEqual(options["env"]["CHAT_ACCEPTANCE_RESET"], "1")
        self.assertEqual(
            options["env"]["CHAT_ACCEPTANCE_RESET_PROFILE"],
            "four",
        )
        for key in (
            "PT_MACHINE_LEASE_KIND",
            "PT_MACHINE_LEASE_RESOURCE_ID",
            "PT_MACHINE_LEASE_RESET_SCOPE",
            "PT_MACHINE_LEASE_FD",
            "PT_MACHINE_LEASE_ID",
        ):
            self.assertNotIn(key, options["env"])
        self.assertLessEqual(
            process.communicate.call_args.kwargs["timeout"],
            0.05,
        )

    @patch("tooling.acceptance.fixtures.chat_native_actors.subprocess.Popen")
    @patch("tooling.acceptance.fixtures.chat_native_actors.os.killpg", side_effect=ProcessLookupError)
    @patch.dict(os.environ, {"CHAT_ACCEPTANCE_RESET_ENVIRONMENTS": "station-four,station-five-arm"}, clear=True)
    def test_reset_child_retains_dual_targets_without_inferred_profile(self, killpg, popen) -> None:
        process = MagicMock()
        process.pid = 1234
        process.returncode = 0
        process.communicate.return_value = ("", "")
        popen.return_value = process
        with patch(
            "tooling.acceptance.fixtures.chat_native_actors.machine_lease_reset_profile",
            side_effect=AssertionError("explicit target list must remain selected"),
        ):
            reset_fixture("station-five-arm", ("alice",), reset_authorized=True)
        child = popen.call_args.kwargs["env"]
        self.assertEqual(child["CHAT_ACCEPTANCE_RESET_ENVIRONMENTS"], "station-four,station-five-arm")
        self.assertNotIn("CHAT_ACCEPTANCE_RESET_PROFILE", child)

    @patch("tooling.acceptance.fixtures.chat_native_actors.subprocess.Popen")
    def test_reset_fixture_rejects_cancelled_cleanup_before_spawn(
        self,
        popen,
    ) -> None:
        cancellation = threading.Event()
        cancellation.set()

        with self.assertRaisesRegex(TimeoutError, "cancelled"):
            reset_fixture(
                "chat-native-acceptance",
                ("alice", "bob"),
                deadline_monotonic=time.monotonic() + 5,
                cancellation=cancellation,
            )

        popen.assert_not_called()

    @patch("tooling.acceptance.fixtures.chat_native_actors.os.killpg")
    @patch("tooling.acceptance.fixtures.chat_native_actors.subprocess.Popen")
    def test_reset_fixture_cancels_and_reaps_running_process_group(
        self,
        popen,
        killpg,
    ) -> None:
        cancellation = threading.Event()
        process = MagicMock()
        process.pid = 1234
        process.returncode = -signal.SIGTERM

        def communicate(*, timeout: float):
            if process.communicate.call_count == 1:
                cancellation.set()
                raise subprocess.TimeoutExpired("reset", timeout)
            return "", ""

        process.communicate.side_effect = communicate
        popen.return_value = process
        killpg.side_effect = (None, None, ProcessLookupError())

        with self.assertRaisesRegex(TimeoutError, "cancelled"):
            reset_fixture(
                "chat-native-acceptance",
                ("alice", "bob"),
                deadline_monotonic=time.monotonic() + 5,
                cancellation=cancellation,
            )

        self.assertEqual(
            killpg.call_args_list,
            [
                unittest.mock.call(1234, signal.SIGTERM),
                unittest.mock.call(1234, signal.SIGKILL),
                unittest.mock.call(1234, 0),
            ],
        )

    def test_actor_roles_resolve_to_canonical_preset_accounts(self) -> None:
        self.assertEqual(
            ACTOR_ACCOUNTS,
            {
                "alice": "alice@p.t",
                "bob": "bob@p.t",
                "charlie": "carol@p.t",
                "eve": "carol@p.t",
                "federation_secondary_owner": "alice@p.t",
            },
        )

    def test_actor_fixture_http_path_is_public_profile_only(self) -> None:
        source = (
            Path(__file__).resolve().parents[3]
            / "tooling"
            / "acceptance"
            / "fixtures"
            / "chat_native_actors.py"
        ).read_text(encoding="utf-8")
        self.assertNotIn("/actor/login", source)
        self.assertNotIn("/actor/logout", source)
        self.assertNotIn("/actor/federation/resolve", source)
        self.assertIn("resolve_existing_actor_identity", source)
        self.assertIn('method="GET"', source)

    def test_existing_actor_resolution_reads_public_profile_without_session(
        self,
    ) -> None:
        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps(
            {
                "username": "carol",
                "display_name": "  Canonical Eve  ",
                "ref": {"ptid": "ptid:eve"},
                "federated_handle": "@carol@station.example",
                "home_station_peer_id": "station-peer",
            }
        ).encode("utf-8")

        with patch(
            "tooling.acceptance.fixtures.chat_native_actors."
            "urllib.request.urlopen",
            return_value=response,
        ) as urlopen:
            actor = resolve_existing_actor_identity(
                "http://station.example:18080",
                "eve",
            )

        request = urlopen.call_args.args[0]
        self.assertEqual(
            request.full_url,
            "http://station.example:18080/actor/carol/profile",
        )
        self.assertEqual(request.get_method(), "GET")
        self.assertIsNone(request.data)
        self.assertEqual(urlopen.call_count, 1)
        self.assertEqual(actor.account_ref, "station-account:carol@p.t")
        self.assertEqual(actor.ptid, "ptid:eve")
        self.assertEqual(
            actor.federated_handle,
            "@carol@station.example",
        )
        self.assertEqual(actor.home_station_peer_id, "station-peer")
        self.assertEqual(actor.display_name, "Canonical Eve")

    def test_reset_actor_resolution_preserves_canonical_display_name(
        self,
    ) -> None:
        record = MagicMock()
        record.ptid = "ptid:alice"
        record.name = "  Acceptance Profile  "
        record.federated_handle = "@alice@station.example"
        record.home_station_peer_id = "station-peer"
        with patch(
            "tooling.acceptance.fixtures.chat_native_actors."
            "read_fixture_actor",
            return_value=record,
        ):
            actor = resolve_actor_identity(
                "http://station.example:18080",
                "station-four",
                "alice",
            )

        self.assertEqual(actor.display_name, "Acceptance Profile")

    def test_existing_actor_resolution_uses_canonical_access_client(self) -> None:
        root = Path(__file__).resolve().parents[3]
        helper = (
            root
            / "tooling"
            / "acceptance"
            / "provisioners"
            / "preset_actor.py"
        ).read_text(encoding="utf-8")
        for provisioner, resolver in (
            ("home_station.py", "resolve_existing_preset_actor_identity("),
            ("native_tauri_current_profile.py", "resolve_existing_preset_actor("),
        ):
            source = (
                root
                / "tooling"
                / "acceptance"
                / "provisioners"
                / provisioner
            ).read_text(encoding="utf-8")
            self.assertNotIn("/actor/login", source)
            self.assertIn(resolver, source)
        self.assertIn('"run", "./tests/access_client"', helper)
        self.assertIn("/actor/logout", helper)

    def test_reset_requires_explicit_authorization(self) -> None:
        with self.assertRaisesRegex(BlockedError, "CHAT_ACCEPTANCE_RESET=1"):
            produce_actor_manifest(
                environment_id="home-station",
                run_id="run-1",
                station_url="http://station.example",
                deployment_environment="station-three",
                roles=("alice", "bob"),
                credential_ref="auto:uuid",
                reset_authorized=False,
            )

    def test_actor_manifest_contains_ptid_refs_but_not_password(self) -> None:
        from tooling.acceptance.core.provisioning import ActorIdentity

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            worktree = root / "repo"
            worktree.mkdir()
            store = EvidenceStore(root / "artifacts", worktree=worktree)
            run = store.begin_run("test-gate", source={})
            with run, patch.dict(
                os.environ,
                run.subprocess_environment(os.environ),
            ), patch(
                "tooling.acceptance.fixtures.chat_native_actors.REPO_ROOT",
                worktree,
            ), patch(
                "tooling.acceptance.fixtures.chat_native_actors.verify_reset_target"
            ), patch(
                "tooling.acceptance.fixtures.chat_native_actors.reset_fixture"
            ), patch(
                "tooling.acceptance.fixtures.chat_native_actors.resolve_actor_identity",
                side_effect=lambda station, environment, role: ActorIdentity(
                    role=role,
                    account_ref=f"station-account:{role}@p.t",
                    ptid=f"ptid:{role}",
                ),
            ), patch(
                "tooling.acceptance.fixtures.chat_native_actors.prepare_bound_friendships"
            ) as friendships:
                manifest, path, reference = produce_actor_manifest(
                    environment_id="home-station",
                    run_id="run-1",
                    station_url="http://station.example",
                    deployment_environment="station-three",
                    roles=("alice", "bob"),
                    credential_ref="auto:uuid",
                    reset_authorized=True,
                )

            friendships.assert_called_once_with(
                {
                    "alice": ("http://station.example", "station-three"),
                    "bob": ("http://station.example", "station-three"),
                },
                manifest.actors,
            )
            serialized = path.read_text(encoding="utf-8")
            self.assertNotIn("not-persisted", serialized)
            self.assertIn("auto:uuid", serialized)
            self.assertEqual(len(manifest.actors), 2)
            self.assertTrue(all(actor.ptid.startswith("ptid:") for actor in manifest.actors))
            self.assertEqual(
                store.resolve(ArtifactRef.from_dict(reference)),
                path,
            )

    def test_bound_actor_manifest_uses_each_roles_declared_station(self) -> None:
        from tooling.acceptance.core.provisioning import ActorIdentity

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            worktree = root / "repo"
            worktree.mkdir()
            store = EvidenceStore(root / "artifacts", worktree=worktree)
            run = store.begin_run("test-gate", source={})
            with patch.dict(
                os.environ,
                run.subprocess_environment(os.environ),
            ), patch(
                "tooling.acceptance.fixtures.chat_native_actors.REPO_ROOT",
                worktree,
            ), patch(
                "tooling.acceptance.fixtures.chat_native_actors.verify_reset_target"
            ) as verify, patch(
                "tooling.acceptance.fixtures.chat_native_actors.reset_fixture"
            ) as reset, patch(
                "tooling.acceptance.fixtures.chat_native_actors.resolve_actor_identity",
                side_effect=lambda station, environment, role: ActorIdentity(
                    role=role,
                    account_ref=f"station-account:{role}@p.t",
                    ptid=f"ptid:{role}:{station.rsplit('-', 1)[-1]}",
                ),
            ) as resolve, patch(
                "tooling.acceptance.fixtures.chat_native_actors.prepare_bound_friendships"
            ) as friendships:
                manifest, _, _ = produce_bound_actor_manifest(
                    environment_id="native-tauri-embedded-webdriver",
                    run_id="run-1",
                    role_targets={
                        "alice": ("http://station-four", "station-four"),
                        "bob": ("http://station-five", "station-five"),
                    },
                    credential_ref="fixture:preset-users",
                    reset_authorized=True,
                    fixture_id="cross-station-social-actors",
                )

            self.assertEqual(verify.call_count, 2)
            reset.assert_any_call(
                "station-four",
                ["alice"],
                reset_authorized=True,
            )
            reset.assert_any_call(
                "station-five",
                ["bob"],
                reset_authorized=True,
            )
            self.assertEqual(
                [call.args for call in resolve.call_args_list],
                [
                    ("http://station-four", "station-four", "alice"),
                    ("http://station-five", "station-five", "bob"),
                ],
            )
            friendships.assert_called_once_with(
                {
                    "alice": ("http://station-four", "station-four"),
                    "bob": ("http://station-five", "station-five"),
                },
                manifest.actors,
            )
            self.assertEqual(
                [actor.ptid for actor in manifest.actors],
                ["ptid:alice:four", "ptid:bob:five"],
            )
            self.assertEqual(
                manifest.fixture_id,
                "cross-station-social-actors",
            )
            run.close()

    def test_bound_friendships_cover_every_cross_station_actor_pair(self) -> None:
        from tooling.acceptance.core.provisioning import ActorIdentity

        role_targets = {
            "alice": ("http://station-four", "station-four"),
            "bob": ("http://station-five", "station-five"),
            "charlie": ("http://station-five", "station-five"),
        }

        def record(role: str, station: str) -> chat_native_reset.FixtureActorRecord:
            return chat_native_reset.FixtureActorRecord(
                ptid=f"ptid:{role}",
                preferred_username=role,
                name=role.title(),
                summary="",
                icon="",
                image="",
                url=f"https://{station}.example/actors/{role}",
                federated_handle=f"@{role}@{station}.example",
                home_station_peer_id=station,
                home_station_domain=f"{station}.example",
                visibility=1,
                locator_seq=1,
            )

        records = {
            "alice": record("alice", "station-four"),
            "bob": record("bob", "station-five"),
            "charlie": record("charlie", "station-five"),
        }
        by_account = {
            ACTOR_ACCOUNTS[role]: value
            for role, value in records.items()
        }
        actors = tuple(
            ActorIdentity(
                role=role,
                account_ref=f"station-account:{ACTOR_ACCOUNTS[role]}",
                ptid=value.ptid,
            )
            for role, value in records.items()
        )

        federation_members = tuple(records.values())
        with patch(
            "tooling.acceptance.fixtures.chat_native_actors.read_fixture_actor",
            side_effect=lambda _station, _environment, account: by_account[account],
        ) as read_actor, patch(
            "tooling.acceptance.fixtures.chat_native_actors.seed_bound_contact"
        ) as seed_contact, patch(
            "tooling.acceptance.fixtures.chat_native_actors."
            "prepare_bound_federation_routing"
        ) as prepare_routing:
            prepare_bound_friendships(role_targets, actors)

        self.assertEqual(read_actor.call_count, 3)
        prepare_routing.assert_called_once_with(role_targets, records)
        self.assertEqual(
            seed_contact.call_args_list,
            [
                call(
                    "http://station-four",
                    "station-four",
                    records["alice"],
                    records["bob"],
                    federation_members,
                ),
                call(
                    "http://station-four",
                    "station-four",
                    records["alice"],
                    records["charlie"],
                    federation_members,
                ),
                call(
                    "http://station-five",
                    "station-five",
                    records["bob"],
                    records["alice"],
                    federation_members,
                ),
                call(
                    "http://station-five",
                    "station-five",
                    records["bob"],
                    records["charlie"],
                    federation_members,
                ),
                call(
                    "http://station-five",
                    "station-five",
                    records["charlie"],
                    records["alice"],
                    federation_members,
                ),
                call(
                    "http://station-five",
                    "station-five",
                    records["charlie"],
                    records["bob"],
                    federation_members,
                ),
            ],
        )

    @patch(
        "tooling.acceptance.fixtures.chat_native_actors._bootstrap_request"
    )
    def test_bound_federation_routing_connects_and_verifies_locators(
        self,
        request,
    ) -> None:
        records = {
            "alice": chat_native_reset.FixtureActorRecord(
                ptid="ptid:alice",
                preferred_username="alice",
                name="Alice",
                summary="",
                icon="",
                image="",
                url="https://four.example/actors/alice",
                federated_handle="@alice@four.example",
                home_station_peer_id="peer-four",
                home_station_domain="four.example",
                visibility=3,
                locator_seq=4,
            ),
            "bob": chat_native_reset.FixtureActorRecord(
                ptid="ptid:bob",
                preferred_username="bob",
                name="Bob",
                summary="",
                icon="",
                image="",
                url="https://five.example/actors/bob",
                federated_handle="@bob@five.example",
                home_station_peer_id="peer-five",
                home_station_domain="five.example",
                visibility=3,
                locator_seq=7,
            ),
        }

        def response(station_url: str, path: str, *, method: str = "GET"):
            if path == "/sub-bootstrap/info":
                peer = "node-four" if "four" in station_url else "node-five"
                return {
                    "dial_addrs": [
                        f"/ip4/192.0.2.1/tcp/4002/p2p/{peer}"
                    ],
                }
            if "/locator/lookup?" in path:
                actor = records["bob"] if "four" in station_url else records["alice"]
                return {
                    "federated_handle": actor.federated_handle.lstrip("@"),
                    "home_station_peer_id": actor.home_station_peer_id,
                    "seq": actor.locator_seq + 1,
                }
            return {}

        request.side_effect = response
        role_targets = {
            "alice": ("http://station-four", "station-four"),
            "bob": ("http://station-five", "station-five"),
        }

        prepare_bound_federation_routing(role_targets, records)

        calls = request.call_args_list
        self.assertEqual(
            sum("/sub-bootstrap/connect?" in item.args[1] for item in calls),
            2,
        )
        self.assertEqual(
            sum("/sub-bootstrap/locator/publish?" in item.args[1] for item in calls),
            2,
        )
        self.assertEqual(
            sum("/sub-bootstrap/locator/lookup?" in item.args[1] for item in calls),
            2,
        )
        publish_calls = [
            item for item in calls
            if "/sub-bootstrap/locator/publish?" in item.args[1]
        ]
        self.assertTrue(
            all(item.kwargs.get("method") == "POST" for item in publish_calls)
        )


class CrossStationSocialProvisioningOwnerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "cross-station-social-native.yaml"
        )

    def test_service_profiles_bind_cross_station_social_services(self) -> None:
        bindings = {
            "station-four": "four",
            "station-five-arm": "fiveArm",
        }

        provisioner = get_provisioner(
            self.contract,
            service_profiles=bindings,
        )

        self.assertIsInstance(
            provisioner,
            CrossStationSocialNativeProvisioner,
        )
        self.assertEqual(bindings, provisioner._required_station_profiles())

    def test_federation_actor_manifest_rejects_home_station_mismatch(
        self,
    ) -> None:
        manifest = ActorManifest(
            fixture_id="cross-station-social-actors",
            environment_id="cross-station-social-native",
            run_id="run-1",
            created_at="2026-10-17T00:00:00Z",
            actors=(
                ResolvedActorIdentity(
                    role="federation_secondary_owner",
                    account_ref="station-account:alice@p.t",
                    ptid="ptid:alice",
                    home_station_peer_id="peer-untrusted",
                ),
            ),
            credential_refs=("fixture:preset-users",),
            reset_authorized=True,
            target_verified=True,
        )
        service = ServiceAttestation(
            service_id="station-five-arm",
            service_kind="station",
            environment_id="cross-station-social-native",
            deployment_environment="fiveArm",
            endpoint="http://station-five",
            live_commit="a" * 40,
            workspace_digest="clean",
            protocol_digest="b" * 64,
            artifact_ref={},
            produced_at="2026-10-17T00:00:00Z",
            producer="test",
            runtime_identity="peer-five",
        )

        with self.assertRaisesRegex(
            BlockedError,
            "Home Station identity does not match",
        ):
            CrossStationSocialNativeProvisioner._persist_station_keyed_actor_manifest(
                manifest=manifest,
                role_targets={
                    "federation_secondary_owner": (
                        service.endpoint,
                        service.deployment_environment,
                    ),
                },
                services={service.service_id: service},
            )

    def test_conflicting_profile_binding_kinds_fail_closed(self) -> None:
        with self.assertRaisesRegex(
            ProvisioningError,
            "conflicting station and service profile bindings",
        ):
            get_provisioner(
                self.contract,
                station_profiles={
                    "station-four": "four",
                    "station-five-arm": "fiveArm",
                },
                service_profiles={
                    "station-four": "fiveArm",
                    "station-five-arm": "four",
                },
            )


class ProfileActivationContractTests(unittest.TestCase):
    def test_profile_activation_uses_machine_binding_owner(self) -> None:
        source = (
            Path(__file__).resolve().parents[3]
            / "tooling"
            / "make"
            / "local-dev.mk"
        ).read_text(encoding="utf-8")
        self.assertIn("profile:", source)
        self.assertIn(
            "@node $(MACHINE_DEV_SCRIPT) select \\",
            source,
        )
        self.assertIn('--profile "$(PROFILE_ARG)"', source)

    def test_profile_activation_checks_declared_identity(self) -> None:
        root = Path(__file__).resolve().parents[3]
        registry_source = (
            root
            / "tooling"
            / "scripts"
            / "local-dev"
            / "machine-dev-registry.mjs"
        ).read_text(encoding="utf-8")
        runtime_source = (
            root / "tooling" / "scripts" / "local-dev" / "env.sh"
        ).read_text(encoding="utf-8")
        self.assertIn("values.PT_DEV_PROFILE !== profile", registry_source)
        self.assertIn(
            "profile identity does not match its directory",
            registry_source,
        )
        self.assertIn(
            '"$PT_DEV_PROFILE" != "$PT_MACHINE_PROFILE"',
            runtime_source,
        )


class ChatResetTargetTests(unittest.TestCase):
    def test_bound_profiles_reset_both_stations_and_restore_context(self) -> None:
        from tooling.acceptance.fixtures import chat_reset_targets as targets

        profiles = {
            "chat-native-disposable": {
                "profile": "chat-native-disposable", "environment": "chat-station",
                "stationUrl": "http://192.0.2.40:18132",
            },
            "fiveArm": {
                "profile": "fiveArm", "environment": "five-station",
                "stationUrl": "http://192.0.2.50:18080",
            },
        }
        with patch.dict(os.environ, {}, clear=True), patch.object(
            targets, "require_reset_lease",
        ), patch.object(
            targets, "_reviewed_profile", side_effect=profiles.__getitem__,
        ):
            with targets.bound_reset_profiles(profiles):
                for profile in profiles.values():
                    resolved = targets.bound_reset_target(
                        profile["environment"], profile["stationUrl"],
                    )
                    self.assertEqual(resolved, profile)
                with self.assertRaises(BlockedError):
                    targets.bound_reset_target("five-station", "http://192.0.2.40:18132")
                with self.assertRaises(BlockedError):
                    targets.bound_reset_target("unknown-station", "")
            self.assertNotIn(targets.PROFILE_BINDINGS_ENV, os.environ)

    def test_reviewed_stable_target_remains_protected(self) -> None:
        from tooling.acceptance.fixtures import chat_reset_targets as targets

        response = subprocess.CompletedProcess(
            [], 0, stdout=json.dumps({
                "profile": "prodStable", "resetPolicy": "stable-protected",
                "environment": "prod", "stationUrl": "https://station.example",
            }),
        )
        with patch.object(targets.subprocess, "run", return_value=response):
            with self.assertRaisesRegex(BlockedError, "PROFILE_RESET_PROTECTED"):
                targets._reviewed_profile("prodStable")

    def test_reset_child_inherits_actual_fd_and_source_identity(self) -> None:
        from tooling.acceptance.fixtures import chat_native_actors as actors
        from tooling.acceptance.fixtures.chat_reset_targets import PROFILE_BINDINGS_ENV

        read_fd, write_fd = os.pipe()
        self.addCleanup(os.close, read_fd)
        self.addCleanup(os.close, write_fd)
        real_popen = subprocess.Popen
        observations = []

        def launch(_argv, **options):
            observations.append(options)
            code = (
                "import os;"
                "os.fstat(int(os.environ['PT_MACHINE_LEASE_FD']));"
                "assert os.environ['PT_MACHINE_LEASE_SOURCE_HEAD']=='candidate';"
                "assert os.environ['PT_MACHINE_LEASE_ID']=='real-fd-test';"
            )
            return real_popen([sys.executable, "-c", code], **options)

        environment = {
            "PT_MACHINE_LEASE_KIND": "station.reset",
            "PT_MACHINE_LEASE_RESOURCE_ID": "chat-native-actors",
            "PT_MACHINE_LEASE_RESET_SCOPE": "chat-native-actors",
            "PT_MACHINE_LEASE_FD": str(read_fd),
            "PT_MACHINE_LEASE_ID": "real-fd-test",
            "PT_MACHINE_LEASE_SOURCE_HEAD": "candidate",
            PROFILE_BINDINGS_ENV: json.dumps({"five-station": "fiveArm"}),
        }
        with patch.dict(os.environ, environment, clear=True), patch.object(
            actors, "require_reset_lease",
        ), patch.object(actors.subprocess, "Popen", side_effect=launch):
            actors.reset_fixture("five-station", ("bob",))
        self.assertEqual(observations[0]["pass_fds"], (read_fd,))
        self.assertEqual(
            observations[0]["env"][PROFILE_BINDINGS_ENV],
            environment[PROFILE_BINDINGS_ENV],
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
