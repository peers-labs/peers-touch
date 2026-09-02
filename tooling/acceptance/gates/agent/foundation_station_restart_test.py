from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from tooling.acceptance.gates.agent import foundation_station_restart


SOURCE_COMMIT = "a" * 40
PROTO_DIGEST = "sha256:proto"
CONTAINER_ID = "b" * 64
IMAGE_ID = "sha256:" + "c" * 64


def runtime_manifest() -> dict[str, object]:
    return {
        "profile": {"resolvedName": "two"},
        "source": {"commit": SOURCE_COMMIT, "workspaceDigest": "clean"},
        "services": {
            "station": {
                "endpoint": "http://station.example:18080",
                "liveCommit": SOURCE_COMMIT[:12],
                "protocolDigest": PROTO_DIGEST,
                "workspaceDigest": "clean",
            },
        },
    }


def inspect_payload(started_at: str, *, image_id: str = IMAGE_ID) -> str:
    return json.dumps(
        [
            {
                "Id": CONTAINER_ID,
                "Image": image_id,
                "Config": {
                    "Image": "peers-touch/station@sha256:image",
                    "Labels": {
                        "com.docker.compose.project": "pt-station-two",
                        "com.docker.compose.service": "station",
                    },
                },
                "State": {"StartedAt": started_at},
                "NetworkSettings": {
                    "Ports": {
                        "18080/tcp": [
                            {"HostIp": "0.0.0.0", "HostPort": "18080"}
                        ]
                    }
                },
            }
        ]
    )


class FoundationStationRestartTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.repo_root = Path(self.temporary_directory.name)
        profile = self.repo_root / ".local/dev/profiles/two.env"
        deployment = (
            self.repo_root / ".local/deploy/envs/station-two.env"
        )
        profile.parent.mkdir(parents=True)
        deployment.parent.mkdir(parents=True)
        profile.write_text(
            "\n".join(
                (
                    "PT_DEV_PROFILE=two",
                    "PT_STATION_DEPLOY_ENV=station-two",
                    "PT_STATION_URL=http://station.example:18080",
                    "PT_STATION_HEALTH_URL=http://station.example:18080/sub-oss/healthz",
                )
            )
            + "\n",
            encoding="utf-8",
        )
        deployment.write_text(
            "PT_DEPLOY_HOST=station.example\nPT_DEPLOY_USER=acceptance\n",
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_commit_match_rejects_short_or_malformed_prefixes(self) -> None:
        self.assertTrue(
            foundation_station_restart._commits_match(
                SOURCE_COMMIT,
                SOURCE_COMMIT[:12],
            )
        )
        self.assertFalse(
            foundation_station_restart._commits_match(
                SOURCE_COMMIT,
                SOURCE_COMMIT[:11],
            )
        )
        self.assertFalse(
            foundation_station_restart._commits_match(
                SOURCE_COMMIT,
                "z" * 12,
            )
        )

    def test_remote_command_timeout_consumes_remaining_global_budget(self) -> None:
        completed = Mock(stdout="ok\n")
        with (
            patch.object(
                foundation_station_restart.time,
                "monotonic",
                return_value=100,
            ),
            patch.object(
                foundation_station_restart.subprocess,
                "run",
                return_value=completed,
            ) as run,
        ):
            output = foundation_station_restart._remote_command(
                {
                    "PT_DEPLOY_HOST": "station.example",
                    "PT_DEPLOY_USER": "acceptance",
                },
                "docker start container",
                deadline=142,
            )

        self.assertEqual(output, "ok")
        self.assertEqual(run.call_args.kwargs["timeout"], 42)
        self.assertIn(
            "ConnectTimeout=10",
            run.call_args.args[0],
        )

    def test_restart_is_source_bound_and_preserves_container_image(self) -> None:
        remote_outputs = iter(
            (
                CONTAINER_ID[:12],
                inspect_payload("2026-08-28T00:00:00Z"),
                CONTAINER_ID,
                CONTAINER_ID[:12],
                inspect_payload("2026-08-28T00:01:00Z"),
            )
        )
        with (
            patch.dict(
                os.environ,
                {"PT_AGENT_V2_ALLOW_STATION_RESTART": "1"},
            ),
            patch.object(
                foundation_station_restart,
                "source_proto_digest",
                return_value=PROTO_DIGEST,
            ),
            patch.object(
                foundation_station_restart,
                "_station_version",
                side_effect=(
                    {"build_commit": SOURCE_COMMIT[:12]},
                    {"build_commit": SOURCE_COMMIT[:12]},
                ),
            ),
            patch.object(
                foundation_station_restart,
                "_station_healthy",
                return_value=True,
            ),
            patch.object(
                foundation_station_restart,
                "_remote_command",
                side_effect=lambda *_args, **_kwargs: next(remote_outputs),
            ) as remote,
        ):
            evidence = foundation_station_restart.restart_foundation_station(
                runtime_manifest(),
                repo_root=self.repo_root,
            )

        self.assertEqual(evidence["containerId"], CONTAINER_ID)
        self.assertEqual(evidence["imageId"], IMAGE_ID)
        self.assertNotEqual(
            evidence["beforeStartedAt"],
            evidence["afterStartedAt"],
        )
        commands = [call.args[1] for call in remote.call_args_list]
        self.assertEqual(
            [command for command in commands if command.startswith("docker restart")],
            [f"docker restart {CONTAINER_ID}"],
        )
        self.assertFalse(any("docker compose" in command for command in commands))

    def test_bounded_outage_runs_callback_before_source_matched_restart(self) -> None:
        remote_outputs = iter(
            (
                CONTAINER_ID[:12],
                inspect_payload("2026-08-28T00:00:00Z"),
                CONTAINER_ID,
                CONTAINER_ID,
                CONTAINER_ID[:12],
                inspect_payload("2026-08-28T00:01:00Z"),
            )
        )
        phases: list[tuple[str, float]] = []
        with (
            patch.dict(
                os.environ,
                {"PT_AGENT_V2_ALLOW_STATION_RESTART": "1"},
            ),
            patch.object(
                foundation_station_restart,
                "source_proto_digest",
                return_value=PROTO_DIGEST,
            ),
            patch.object(
                foundation_station_restart,
                "_station_version",
                side_effect=(
                    {"build_commit": SOURCE_COMMIT[:12]},
                    {"build_commit": SOURCE_COMMIT[:12]},
                ),
            ),
            patch.object(
                foundation_station_restart,
                "_station_healthy",
                side_effect=(False, True),
            ),
            patch.object(
                foundation_station_restart,
                "_remote_command",
                side_effect=lambda *_args, **_kwargs: next(remote_outputs),
            ) as remote,
        ):
            evidence = foundation_station_restart.restart_foundation_station(
                runtime_manifest(),
                repo_root=self.repo_root,
                during_outage=lambda deadline: phases.append(
                    ("outage", deadline)
                ),
                after_restart=lambda deadline: phases.append(
                    ("restarted", deadline)
                ),
            )

        self.assertEqual(
            [phase for phase, _deadline in phases],
            ["outage", "restarted"],
        )
        self.assertLess(phases[0][1], phases[1][1])
        stop_deadline = next(
            call.kwargs["deadline"]
            for call in remote.call_args_list
            if call.args[1].startswith("docker kill")
        )
        start_deadline = next(
            call.kwargs["deadline"]
            for call in remote.call_args_list
            if call.args[1].startswith("docker start")
        )
        self.assertEqual(
            start_deadline - stop_deadline,
            foundation_station_restart.RESTORE_RESERVE_SECONDS,
        )
        self.assertEqual(start_deadline, phases[1][1])
        self.assertIs(evidence["outageObserved"], True)
        self.assertEqual(evidence["deadlineSeconds"], 180)
        commands = [call.args[1] for call in remote.call_args_list]
        self.assertIn(
            f"docker kill --signal KILL {CONTAINER_ID}",
            commands,
        )
        self.assertIn(f"docker start {CONTAINER_ID}", commands)
        self.assertFalse(any(command.startswith("docker restart") for command in commands))

    def test_bounded_outage_restores_station_before_propagating_callback_error(
        self,
    ) -> None:
        def fail_probe(_deadline: float) -> None:
            raise RuntimeError("probe failed")

        remote_outputs = iter(
            (
                CONTAINER_ID[:12],
                inspect_payload("2026-08-28T00:00:00Z"),
                CONTAINER_ID,
                CONTAINER_ID,
                CONTAINER_ID[:12],
                inspect_payload("2026-08-28T00:01:00Z"),
            )
        )
        with (
            patch.dict(
                os.environ,
                {"PT_AGENT_V2_ALLOW_STATION_RESTART": "1"},
            ),
            patch.object(
                foundation_station_restart,
                "source_proto_digest",
                return_value=PROTO_DIGEST,
            ),
            patch.object(
                foundation_station_restart,
                "_station_version",
                side_effect=(
                    {"build_commit": SOURCE_COMMIT[:12]},
                    {"build_commit": SOURCE_COMMIT[:12]},
                ),
            ),
            patch.object(
                foundation_station_restart,
                "_station_healthy",
                side_effect=(False, True),
            ),
            patch.object(
                foundation_station_restart,
                "_remote_command",
                side_effect=lambda *_args, **_kwargs: next(remote_outputs),
            ) as remote,
        ):
            with self.assertRaisesRegex(RuntimeError, "probe failed"):
                foundation_station_restart.restart_foundation_station(
                    runtime_manifest(),
                    repo_root=self.repo_root,
                    during_outage=fail_probe,
                )

        commands = [call.args[1] for call in remote.call_args_list]
        self.assertIn(f"docker start {CONTAINER_ID}", commands)

    def test_bounded_outage_restores_after_kill_identity_error(self) -> None:
        remote_outputs = iter(
            (
                CONTAINER_ID[:12],
                inspect_payload("2026-08-28T00:00:00Z"),
                "unexpected",
                CONTAINER_ID,
                CONTAINER_ID[:12],
                inspect_payload("2026-08-28T00:01:00Z"),
            )
        )
        with (
            patch.dict(
                os.environ,
                {"PT_AGENT_V2_ALLOW_STATION_RESTART": "1"},
            ),
            patch.object(
                foundation_station_restart,
                "source_proto_digest",
                return_value=PROTO_DIGEST,
            ),
            patch.object(
                foundation_station_restart,
                "_station_version",
                side_effect=(
                    {"build_commit": SOURCE_COMMIT[:12]},
                    {"build_commit": SOURCE_COMMIT[:12]},
                ),
            ),
            patch.object(
                foundation_station_restart,
                "_station_healthy",
                return_value=True,
            ),
            patch.object(
                foundation_station_restart,
                "_remote_command",
                side_effect=lambda *_args, **_kwargs: next(remote_outputs),
            ) as remote,
        ):
            with self.assertRaisesRegex(
                foundation_station_restart.FoundationStationRestartError,
                "docker kill returned a different container identity",
            ):
                foundation_station_restart.restart_foundation_station(
                    runtime_manifest(),
                    repo_root=self.repo_root,
                    during_outage=lambda _deadline: None,
                )

        commands = [call.args[1] for call in remote.call_args_list]
        self.assertIn(f"docker start {CONTAINER_ID}", commands)

    def test_restart_requires_explicit_authorization(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(
                foundation_station_restart.FoundationStationRestartError,
                "PT_AGENT_V2_ALLOW_STATION_RESTART=1",
            ):
                foundation_station_restart.restart_foundation_station(
                    runtime_manifest(),
                    repo_root=self.repo_root,
                )

    def test_restart_rejects_dirty_source_before_remote_command(self) -> None:
        manifest = runtime_manifest()
        manifest["source"]["workspaceDigest"] = "dirty-digest"
        with (
            patch.dict(
                os.environ,
                {"PT_AGENT_V2_ALLOW_STATION_RESTART": "1"},
            ),
            patch.object(
                foundation_station_restart,
                "_remote_command",
            ) as remote,
        ):
            with self.assertRaisesRegex(
                foundation_station_restart.FoundationStationRestartError,
                "clean source and Station workspace",
            ):
                foundation_station_restart.restart_foundation_station(
                    manifest,
                    repo_root=self.repo_root,
                )
        remote.assert_not_called()

    def test_restart_rejects_wrong_profile_before_remote_command(self) -> None:
        manifest = runtime_manifest()
        manifest["profile"] = {"resolvedName": "one"}
        with (
            patch.dict(
                os.environ,
                {"PT_AGENT_V2_ALLOW_STATION_RESTART": "1"},
            ),
            patch.object(
                foundation_station_restart,
                "_remote_command",
            ) as remote,
        ):
            with self.assertRaisesRegex(
                foundation_station_restart.FoundationStationRestartError,
                "profile two",
            ):
                foundation_station_restart.restart_foundation_station(
                    manifest,
                    repo_root=self.repo_root,
                )
        remote.assert_not_called()

    def test_restart_rejects_ambiguous_container_selection(self) -> None:
        with (
            patch.dict(
                os.environ,
                {"PT_AGENT_V2_ALLOW_STATION_RESTART": "1"},
            ),
            patch.object(
                foundation_station_restart,
                "source_proto_digest",
                return_value=PROTO_DIGEST,
            ),
            patch.object(
                foundation_station_restart,
                "_station_version",
                return_value={"build_commit": SOURCE_COMMIT[:12]},
            ),
            patch.object(
                foundation_station_restart,
                "_remote_command",
                return_value="container-a\ncontainer-b",
            ),
        ):
            with self.assertRaisesRegex(
                foundation_station_restart.FoundationStationRestartError,
                "exactly one",
            ):
                foundation_station_restart.restart_foundation_station(
                    runtime_manifest(),
                    repo_root=self.repo_root,
                )

    def test_restart_rejects_image_drift(self) -> None:
        remote_outputs = iter(
            (
                CONTAINER_ID[:12],
                inspect_payload("2026-08-28T00:00:00Z"),
                CONTAINER_ID,
                CONTAINER_ID[:12],
                inspect_payload(
                    "2026-08-28T00:01:00Z",
                    image_id="sha256:" + "d" * 64,
                ),
            )
        )
        with (
            patch.dict(
                os.environ,
                {"PT_AGENT_V2_ALLOW_STATION_RESTART": "1"},
            ),
            patch.object(
                foundation_station_restart,
                "source_proto_digest",
                return_value=PROTO_DIGEST,
            ),
            patch.object(
                foundation_station_restart,
                "_station_version",
                side_effect=(
                    {"build_commit": SOURCE_COMMIT[:12]},
                    {"build_commit": SOURCE_COMMIT[:12]},
                ),
            ),
            patch.object(
                foundation_station_restart,
                "_station_healthy",
                return_value=True,
            ),
            patch.object(
                foundation_station_restart,
                "_remote_command",
                side_effect=lambda *_args, **_kwargs: next(remote_outputs),
            ),
        ):
            with self.assertRaisesRegex(
                foundation_station_restart.FoundationStationRestartError,
                "container or image changed",
            ):
                foundation_station_restart.restart_foundation_station(
                    runtime_manifest(),
                    repo_root=self.repo_root,
                )


if __name__ == "__main__":
    unittest.main()
