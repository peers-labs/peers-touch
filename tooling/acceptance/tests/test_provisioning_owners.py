#!/usr/bin/env python3
"""Attestation and actor Fixture owner contract tests."""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling.acceptance.core.attestation import (
    produce_station_attestation,
    source_workspace_digest,
)
from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.fixtures.chat_native_actors import produce_actor_manifest


class StationAttestationOwnerTests(unittest.TestCase):
    def test_workspace_digest_binds_file_content(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
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
                ["git", "commit", "-m", "base"],
                cwd=root,
                check=True,
                capture_output=True,
            )
            self.assertEqual(source_workspace_digest(root), "clean")
            source.write_text("first\n", encoding="utf-8")
            first = source_workspace_digest(root)
            source.write_text("second\n", encoding="utf-8")
            second = source_workspace_digest(root)

        self.assertTrue(first.startswith("sha256:"))
        self.assertTrue(second.startswith("sha256:"))
        self.assertNotEqual(first, second)

    def test_producer_writes_source_bound_attestation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifests = root / "tooling" / "acceptance" / "reports" / "manifests"
            with patch(
                "tooling.acceptance.core.attestation.REPO_ROOT",
                root,
            ), patch(
                "tooling.acceptance.core.attestation.MANIFESTS_DIR",
                manifests,
            ), patch(
                "tooling.acceptance.core.attestation.read_station_version",
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
                    station_url="http://station.example",
                    profile_env={"PT_STATION_MODE": "local"},
                )

            path = root / attestation.artifact_path
            payload = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(
                payload["artifactKind"],
                "station-deployment-attestation",
            )
            self.assertEqual(payload["producer"], "station-deployment")
            self.assertEqual(payload["commit"], "abcdef1234567890")
            self.assertEqual(payload["protoDigest"], "proto-digest")

    def test_dirty_station_deployment_blocks(self) -> None:
        with patch(
            "tooling.acceptance.core.attestation.read_station_version",
            return_value={"build_commit": "abcdef123456"},
        ), patch(
            "tooling.acceptance.core.attestation._local_source_identity",
            return_value=("abcdef123456", "dirty", "proto-digest"),
        ):
            with self.assertRaisesRegex(BlockedError, "workspace is dirty"):
                produce_station_attestation(
                    environment_id="test",
                    run_id="run-1",
                    station_url="http://station.example",
                    profile_env={"PT_STATION_MODE": "local"},
                )


class ActorFixtureOwnerTests(unittest.TestCase):
    def test_reset_requires_explicit_authorization(self) -> None:
        with self.assertRaisesRegex(BlockedError, "CHAT_ACCEPTANCE_RESET=1"):
            produce_actor_manifest(
                environment_id="home-station",
                run_id="run-1",
                station_url="http://station.example",
                deployment_environment="station-three",
                roles=("alice", "bob"),
                password="not-persisted",
                credential_ref="env:CHAT_NATIVE_DEMO_PASSWORD",
                reset_authorized=False,
            )

    def test_actor_manifest_contains_ptid_refs_but_not_password(self) -> None:
        from tooling.acceptance.core.provisioning import ActorIdentity

        with tempfile.TemporaryDirectory() as tmp:
            manifests = Path(tmp)
            with patch(
                "tooling.acceptance.fixtures.chat_native_actors.MANIFESTS_DIR",
                manifests,
            ), patch(
                "tooling.acceptance.fixtures.chat_native_actors.REPO_ROOT",
                manifests.parent,
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
                manifest, path = produce_actor_manifest(
                    environment_id="home-station",
                    run_id="run-1",
                    station_url="http://station.example",
                    deployment_environment="station-three",
                    roles=("alice", "bob"),
                    password="not-persisted",
                    credential_ref="env:CHAT_NATIVE_DEMO_PASSWORD",
                    reset_authorized=True,
                )

            serialized = path.read_text(encoding="utf-8")
            self.assertNotIn("not-persisted", serialized)
            self.assertIn("env:CHAT_NATIVE_DEMO_PASSWORD", serialized)
            self.assertEqual(len(manifest.actors), 2)
            self.assertTrue(all(actor.ptid.startswith("ptid:") for actor in manifest.actors))


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
