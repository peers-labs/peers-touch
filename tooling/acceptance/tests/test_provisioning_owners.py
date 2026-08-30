#!/usr/bin/env python3
"""Attestation and actor Fixture owner contract tests."""

from __future__ import annotations

import errno
import json
import os
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling.acceptance.core.attestation import (
    produce_station_attestation,
    source_workspace_digest,
)
from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.core.evidence_store import ArtifactRef, EvidenceStore
from tooling.acceptance.fixtures.chat_native_actors import (
    _login_session,
    produce_actor_manifest,
)
from tooling.acceptance.fixtures.chat_native_reset import (
    reset_station_messaging_state,
)


class StationAttestationOwnerTests(unittest.TestCase):
    def test_remote_attestation_excludes_only_deployment_bare_repo(self) -> None:
        from tooling.acceptance.core.attestation import _remote_source_identity

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
                "tooling.acceptance.core.attestation.REPO_ROOT",
                root,
            ), patch(
                "tooling.acceptance.core.attestation.subprocess.run",
                return_value=completed,
            ) as run:
                identity = _remote_source_identity("station-three")

        self.assertEqual(
            identity,
            ("abcdef123456", "clean", "proto-digest"),
        )
        remote_command = run.call_args.args[0][-1]
        self.assertIn("git status --porcelain | sed", remote_command)
        self.assertIn("\\.bare\\.git\\/", remote_command)
        self.assertNotIn("apps/mobile/ios", remote_command)

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
    def test_reset_discovers_postgres_from_live_station_compose_project(self) -> None:
        discovery = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout="pt-station-c-postgres-1\n",
            stderr="",
        )
        reset = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout="",
            stderr="",
        )
        with patch.dict(
            os.environ,
            {"PT_STATION_URL": "http://station.example:18080"},
            clear=True,
        ), patch(
            "tooling.acceptance.fixtures.chat_native_reset.deploy_environment",
            return_value={
                "PT_DEPLOY_HOST": "station.example",
                "PT_DEPLOY_USER": "acceptance",
            },
        ), patch(
            "tooling.acceptance.fixtures.chat_native_reset.subprocess.run",
            side_effect=(discovery, reset),
        ) as run:
            reset_station_messaging_state("station-three")

        self.assertEqual(run.call_count, 2)
        self.assertIn("publish=18080", run.call_args_list[0].args[0][-1])
        self.assertIn(
            "pt-station-c-postgres-1",
            run.call_args_list[1].args[0][-1],
        )

    def test_login_session_requires_ptid_token_and_session(self) -> None:
        session = _login_session(
            {
                "data": {
                    "actor_ref": {"ptid": "ptid:alice"},
                    "tokens": {"access_token": "runtime-token"},
                    "session_id": "runtime-session",
                }
            },
            "alice",
        )
        self.assertEqual(
            session,
            ("ptid:alice", "runtime-token", "runtime-session"),
        )
        with self.assertRaisesRegex(BlockedError, "releasable session"):
            _login_session(
                {
                    "data": {
                        "actorRef": {"ptid": "ptid:alice"},
                        "tokens": {},
                    }
                },
                "alice",
            )

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
                side_effect=lambda station, role, password: ActorIdentity(
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
