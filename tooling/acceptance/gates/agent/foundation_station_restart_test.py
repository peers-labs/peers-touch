from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from tooling.acceptance.gates.agent import foundation_station_restart


SOURCE_COMMIT = "a" * 40
PROTO_DIGEST = "sha256:proto"
CONTAINER_ID = "b" * 64
IMAGE_ID = "sha256:" + "c" * 64
PROFILE = "chat-native-disposable"
DEPLOYMENT = "chat-native-disposable-station"
PROJECT_LABEL = "pt-chat-native-disposable"
STATION_PORT = 18132
AUTHORIZED_ENV = {
    "PT_AGENT_ALLOW_STATION_RESTART": "1",
    "PT_ACCEPTANCE_APPROVED_PROFILE": PROFILE,
    "PT_ACCEPTANCE_DISPOSABLE": "1",
}


def runtime_manifest() -> dict[str, object]:
    return {
        "profile": {"resolvedName": PROFILE},
        "source": {"commit": SOURCE_COMMIT, "workspaceDigest": "clean"},
        "services": {
            "station": {
                "deploymentEnvironment": DEPLOYMENT,
                "endpoint": f"http://station.example:{STATION_PORT}",
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
                        "com.docker.compose.project": PROJECT_LABEL,
                        "com.docker.compose.service": "station",
                    },
                },
                "State": {"StartedAt": started_at},
                "NetworkSettings": {
                    "Ports": {
                        f"{foundation_station_restart.EXPECTED_CONTAINER_PORT}/tcp": [
                            {"HostIp": "0.0.0.0", "HostPort": str(STATION_PORT)}
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
        self.env_root = self.repo_root / "env"
        self.profile = (
            self.env_root / "peers-touch" / PROFILE / "profile.env.example"
        )
        self.deployment = (
            self.env_root
            / "peers-touch"
            / PROFILE
            / "deploy"
            / f"{DEPLOYMENT}.env.example"
        )
        self.profile.parent.mkdir(parents=True)
        self.deployment.parent.mkdir(parents=True)
        self.profile.write_text(
            "\n".join(
                (
                    f"PT_DEV_PROFILE={PROFILE}",
                    f"PT_STATION_DEPLOY_ENV={DEPLOYMENT}",
                    f"PT_STATION_URL=http://station.example:{STATION_PORT}",
                    f"PT_STATION_PORT={STATION_PORT}",
                    f"PT_STATION_HEALTH_URL=http://station.example:{STATION_PORT}/sub-oss/healthz",
                )
            )
            + "\n",
            encoding="utf-8",
        )
        self.deployment.write_text(
            "\n".join(
                (
                    "PT_DEPLOY_HOST=station.example",
                    "PT_DEPLOY_USER=acceptance",
                    "PT_ACCEPTANCE_DISPOSABLE=1",
                    f"PT_ACCEPTANCE_COMPOSE_PROJECT={PROJECT_LABEL}",
                )
            )
            + "\n",
            encoding="utf-8",
        )
        subprocess.run(["git", "init", "-q"], cwd=self.env_root, check=True)
        subprocess.run(
            ["git", "config", "user.name", "Foundation Test"],
            cwd=self.env_root,
            check=True,
        )
        subprocess.run(
            ["git", "config", "user.email", "foundation-test@example.invalid"],
            cwd=self.env_root,
            check=True,
        )
        subprocess.run(["git", "add", "."], cwd=self.env_root, check=True)
        subprocess.run(
            ["git", "commit", "-qm", "test: add Foundation env"],
            cwd=self.env_root,
            check=True,
        )
        self.authorized_env = {
            **AUTHORIZED_ENV,
            "PT_ENV_REPO": str(self.env_root),
        }

    def tearDown(self) -> None:
        path = Path(self.temporary_directory.name)
        self.temporary_directory._finalizer.detach()
        for attempt in range(5):
            try:
                shutil.rmtree(path)
                return
            except FileNotFoundError:
                return
            except OSError:
                if attempt == 4:
                    raise
                time.sleep(0.05)

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

    def test_prearmed_remote_kill_waits_for_explicit_trigger(self) -> None:
        process = Mock()
        stdin = Mock()
        process.stdin = stdin
        process.stdout = Mock()
        process.stdout.readline.return_value = "READY\n"
        process.stderr = Mock()
        process.communicate.return_value = (CONTAINER_ID, "")
        process.returncode = 0
        selector = Mock()
        selector.select.return_value = [(Mock(), 1)]
        with (
            patch.object(
                foundation_station_restart.subprocess,
                "Popen",
                return_value=process,
            ) as popen,
            patch.object(
                foundation_station_restart.selectors,
                "DefaultSelector",
                return_value=selector,
            ),
        ):
            armed = foundation_station_restart._ArmedRemoteKill(
                {
                    "PT_DEPLOY_HOST": "station.example",
                    "PT_DEPLOY_USER": "acceptance",
                },
                CONTAINER_ID,
                deadline=foundation_station_restart.time.monotonic() + 30,
            )
            result = armed.trigger(
                deadline=foundation_station_restart.time.monotonic() + 30,
            )

        self.assertEqual(result, CONTAINER_ID)
        stdin.write.assert_called_once_with("KILL\n")
        stdin.flush.assert_called_once_with()
        stdin.close.assert_called_once_with()
        command = popen.call_args.args[0]
        self.assertIn("BatchMode=yes", command)
        self.assertIn("printf 'READY\\n'", command[-1])
        self.assertIn(f"docker kill --signal KILL {CONTAINER_ID}", command[-1])

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
                self.authorized_env,
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
                self.authorized_env,
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
                before_outage=lambda: phases.append(
                    ("before-outage", 0.0)
                ),
                during_outage=lambda deadline: phases.append(
                    ("outage", deadline)
                ),
                after_restart=lambda deadline: phases.append(
                    ("restarted", deadline)
                ),
            )

        self.assertEqual(
            [phase for phase, _deadline in phases],
            ["before-outage", "outage", "restarted"],
        )
        self.assertLess(phases[1][1], phases[2][1])
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
        self.assertEqual(start_deadline, phases[2][1])
        self.assertIs(evidence["outageObserved"], True)
        self.assertEqual(evidence["deadlineSeconds"], 180)
        commands = [call.args[1] for call in remote.call_args_list]
        self.assertIn(
            f"docker kill --signal KILL {CONTAINER_ID}",
            commands,
        )
        self.assertIn(f"docker start {CONTAINER_ID}", commands)
        self.assertFalse(any(command.startswith("docker restart") for command in commands))

    def test_prearmed_outage_triggers_kill_before_outage_callback(self) -> None:
        remote_outputs = iter(
            (
                CONTAINER_ID[:12],
                inspect_payload("2026-08-28T00:00:00Z"),
                CONTAINER_ID,
                CONTAINER_ID[:12],
                inspect_payload("2026-08-28T00:01:00Z"),
            )
        )
        phases: list[str] = []
        armed_kill = Mock()

        def arm(*_args: object, **_kwargs: object) -> Mock:
            phases.append("armed")
            return armed_kill

        def trigger(*, deadline: float) -> str:
            self.assertGreater(deadline, 0)
            phases.append("killed")
            return CONTAINER_ID

        armed_kill.trigger.side_effect = trigger
        with (
            patch.dict(os.environ, self.authorized_env),
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
                "_ArmedRemoteKill",
                side_effect=arm,
            ),
            patch.object(
                foundation_station_restart,
                "_remote_command",
                side_effect=lambda *_args, **_kwargs: next(remote_outputs),
            ) as remote,
        ):
            foundation_station_restart.restart_foundation_station(
                runtime_manifest(),
                repo_root=self.repo_root,
                before_outage=lambda: phases.append("prepared"),
                during_outage=lambda _deadline: phases.append("finalized"),
                prearm_outage=True,
            )

        self.assertEqual(
            phases,
            ["armed", "prepared", "killed", "finalized"],
        )
        armed_kill.abort.assert_not_called()
        commands = [call.args[1] for call in remote.call_args_list]
        self.assertFalse(any("docker kill" in command for command in commands))
        self.assertIn(f"docker start {CONTAINER_ID}", commands)

    def test_prearmed_outage_aborts_when_prepare_fails(self) -> None:
        armed_kill = Mock()
        remote_outputs = iter(
            (
                CONTAINER_ID[:12],
                inspect_payload("2026-08-28T00:00:00Z"),
            )
        )
        with (
            patch.dict(os.environ, self.authorized_env),
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
                "_ArmedRemoteKill",
                return_value=armed_kill,
            ),
            patch.object(
                foundation_station_restart,
                "_remote_command",
                side_effect=lambda *_args, **_kwargs: next(remote_outputs),
            ) as remote,
        ):
            with self.assertRaisesRegex(RuntimeError, "prepare failed"):
                foundation_station_restart.restart_foundation_station(
                    runtime_manifest(),
                    repo_root=self.repo_root,
                    before_outage=lambda: (_ for _ in ()).throw(
                        RuntimeError("prepare failed")
                    ),
                    during_outage=lambda _deadline: None,
                    prearm_outage=True,
                )

        armed_kill.abort.assert_called_once_with()
        armed_kill.trigger.assert_not_called()
        commands = [call.args[1] for call in remote.call_args_list]
        self.assertFalse(any("docker kill" in command for command in commands))
        self.assertFalse(any("docker start" in command for command in commands))

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
                self.authorized_env,
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

    def test_before_outage_failure_prevents_station_mutation(self) -> None:
        def fail_prepare() -> None:
            raise RuntimeError("prepare failed")

        remote_outputs = iter(
            (
                CONTAINER_ID[:12],
                inspect_payload("2026-08-28T00:00:00Z"),
            )
        )
        with (
            patch.dict(
                os.environ,
                self.authorized_env,
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
                side_effect=lambda *_args, **_kwargs: next(remote_outputs),
            ) as remote,
        ):
            with self.assertRaisesRegex(RuntimeError, "prepare failed"):
                foundation_station_restart.restart_foundation_station(
                    runtime_manifest(),
                    repo_root=self.repo_root,
                    before_outage=fail_prepare,
                    during_outage=lambda _deadline: None,
                )

        commands = [call.args[1] for call in remote.call_args_list]
        self.assertFalse(any("docker kill" in command for command in commands))
        self.assertFalse(any("docker start" in command for command in commands))

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
                self.authorized_env,
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
                "PT_AGENT_ALLOW_STATION_RESTART=1",
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
                self.authorized_env,
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

    def test_restart_rejects_non_disposable_deployment(self) -> None:
        self.deployment.write_text(
            "\n".join(
                (
                    "PT_DEPLOY_HOST=station.example",
                    "PT_DEPLOY_USER=acceptance",
                    f"PT_ACCEPTANCE_COMPOSE_PROJECT={PROJECT_LABEL}",
                )
            )
            + "\n",
            encoding="utf-8",
        )
        subprocess.run(
            ["git", "add", "."],
            cwd=self.env_root,
            check=True,
        )
        subprocess.run(
            ["git", "commit", "-qm", "test: remove disposable marker"],
            cwd=self.env_root,
            check=True,
        )
        with (
            patch.dict(os.environ, self.authorized_env),
            patch.object(
                foundation_station_restart,
                "_remote_command",
            ) as remote,
        ):
            with self.assertRaisesRegex(
                foundation_station_restart.FoundationStationRestartError,
                "approved disposable Station deployment",
            ):
                foundation_station_restart.restart_foundation_station(
                    runtime_manifest(),
                    repo_root=self.repo_root,
                )
        remote.assert_not_called()

    def test_restart_rejects_dirty_env_definition(self) -> None:
        self.deployment.write_text(
            self.deployment.read_text(encoding="utf-8")
            + "PT_DEPLOY_PORT=22\n",
            encoding="utf-8",
        )
        with (
            patch.dict(os.environ, self.authorized_env),
            patch.object(
                foundation_station_restart,
                "_remote_command",
            ) as remote,
        ):
            with self.assertRaisesRegex(
                foundation_station_restart.FoundationStationRestartError,
                "dirty or untracked",
            ):
                foundation_station_restart.restart_foundation_station(
                    runtime_manifest(),
                    repo_root=self.repo_root,
                )
        remote.assert_not_called()

    def test_restart_rejects_wrong_profile_before_remote_command(self) -> None:
        manifest = runtime_manifest()
        manifest["profile"] = {"resolvedName": "one"}
        with (
            patch.dict(
                os.environ,
                self.authorized_env,
            ),
            patch.object(
                foundation_station_restart,
                "_remote_command",
            ) as remote,
        ):
            with self.assertRaisesRegex(
                foundation_station_restart.FoundationStationRestartError,
                "PT_ACCEPTANCE_APPROVED_PROFILE",
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
                self.authorized_env,
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
                self.authorized_env,
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
