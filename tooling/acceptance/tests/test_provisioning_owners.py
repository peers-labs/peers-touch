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

from tooling.acceptance.core.attestation import (
    produce_station_attestation,
    source_proto_digest,
    source_workspace_digest,
)
from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.core.evidence_store import ArtifactRef, EvidenceStore
from tooling.acceptance.fixtures import chat_native_reset
from tooling.acceptance.fixtures.chat_native_actors import (
    ACTOR_ACCOUNTS,
    prepare_bound_friendships,
    produce_actor_manifest,
    produce_bound_actor_manifest,
    reset_fixture,
)


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
                proto.parent.mkdir(parents=True)
                generated.parent.mkdir(parents=True)
                proto.write_text("syntax = \"proto3\";\n", encoding="utf-8")
                generated.write_text("// generated\n", encoding="utf-8")
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
                "tooling.acceptance.provisioners.remote_source_identity.REPO_ROOT",
                root,
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
        self.assertIn(":(glob)model/domain/**/*.proto", remote_command)
        self.assertIn(
            ":(glob)apps/desktop/src/gen/proto/**/*.ts",
            remote_command,
        )
        self.assertIn(":(glob)apps/station/**/*.pb.go", remote_command)
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
                        f"PT_DEPLOY_KNOWN_HOSTS_FILE={root / 'missing-known-hosts'}",
                    )
                )
                + "\n",
                encoding="utf-8",
            )

            with patch(
                "tooling.acceptance.provisioners.remote_source_identity.REPO_ROOT",
                root,
            ), self.assertRaisesRegex(
                BlockedError,
                "SSH contract is invalid",
            ):
                resolve_remote_source_identity("station-three")

    def test_remote_attestation_uses_strict_openssh_default_known_hosts(self) -> None:
        from tooling.acceptance.provisioners.remote_source_identity import (
            resolve_remote_source_identity,
        )

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            environment = (
                root
                / ".local"
                / "deploy"
                / "envs"
                / "station-four.env"
            )
            environment.parent.mkdir(parents=True)
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
                "tooling.acceptance.provisioners.remote_source_identity.REPO_ROOT",
                root,
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
                    / "acceptance-framework"
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
    def test_reset_fixture_uses_package_module(self, popen, killpg) -> None:
        process = MagicMock()
        process.pid = 1234
        process.returncode = 0
        process.communicate.return_value = ("", "")
        popen.return_value = process
        killpg.side_effect = ProcessLookupError()

        reset_fixture("chat-native-acceptance", ("alice", "bob"))

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
        self.assertLessEqual(
            process.communicate.call_args.kwargs["timeout"],
            0.05,
        )

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
            },
        )

    def test_actor_fixture_has_no_json_business_http_path(self) -> None:
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
        self.assertNotIn("urllib.request", source)

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
            with patch.dict(
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
            ):
                manifest, path, reference = produce_actor_manifest(
                    environment_id="home-station",
                    run_id="run-1",
                    station_url="http://station.example",
                    deployment_environment="station-three",
                    roles=("alice", "bob"),
                    credential_ref="auto:uuid",
                    reset_authorized=True,
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
            run.close()

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
                )

            self.assertEqual(verify.call_count, 2)
            reset.assert_any_call("station-four", ["alice"])
            reset.assert_any_call("station-five", ["bob"])
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
        ) as seed_contact:
            prepare_bound_friendships(role_targets, actors)

        self.assertEqual(read_actor.call_count, 3)
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


class ProfileActivationContractTests(unittest.TestCase):
    def test_profile_activation_checks_declared_identity(self) -> None:
        source = (
            Path(__file__).resolve().parents[3]
            / "tooling"
            / "scripts"
            / "local-dev"
            / "profile.sh"
        ).read_text(encoding="utf-8")
        self.assertIn("Profile identity mismatch", source)
        self.assertIn('PT_DEV_PROFILE=', source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
