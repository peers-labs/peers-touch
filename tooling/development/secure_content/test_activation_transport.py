from __future__ import annotations

import io
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from tooling.development.secure_content.activation_transport import (
    ReviewedSchemaActivationTransport,
    _install_attestation,
    _quiesce,
)


COMMIT = "8" * 40
DIGEST = "9" * 64


class FakeRemoteTransport:
    def __init__(self) -> None:
        self.target = SimpleNamespace(destination="acceptance@station.example")
        self.calls: list[tuple[list[str], dict[str, object]]] = []

    def command_prefix(self) -> list[str]:
        return ["ssh", "-o", "StrictHostKeyChecking=yes"]

    def render_remote_argv(self, argv: list[str]) -> str:
        return " ".join(argv)

    def run_argv(self, argv: list[str], **kwargs: object) -> SimpleNamespace:
        self.calls.append((list(argv), dict(kwargs)))
        return SimpleNamespace(returncode=0, stdout="", stderr="")


class ReviewedSchemaActivationTransportTest(unittest.TestCase):
    def test_maintenance_command_uses_reviewed_deployment_transport(self) -> None:
        remote = FakeRemoteTransport()
        owner = ReviewedSchemaActivationTransport(repo_root=Path.cwd())
        request = {
            "source_commit": COMMIT,
            "workspace_id": "workspace-four",
            "profile_id": "four",
            "deployment_environment": "station-four",
            "destructive_scope": "station-four-social-private",
            "declaration_digest": DIGEST,
        }
        with mock.patch(
            "tooling.development.secure_content.activation_transport."
            "reviewed_remote_transport",
            return_value=(remote, {"PT_DEPLOY_PATH": "peers-touch/repo"}),
        ):
            command = owner.maintenance_command(
                request,
                budget_seconds=3600,
            )

        self.assertEqual("ssh", command[0])
        self.assertIn("acceptance@station.example", command)
        self.assertIn("remote-session", command[-1])
        self.assertIn("station-four-social-private", command[-1])

    def test_resume_command_can_preserve_an_already_deployed_station(self) -> None:
        remote = FakeRemoteTransport()
        owner = ReviewedSchemaActivationTransport(repo_root=Path.cwd())
        request = {
            "source_commit": COMMIT,
            "workspace_id": "workspace-four",
            "profile_id": "four",
            "deployment_environment": "station-four",
            "destructive_scope": "station-four-social-private",
            "declaration_digest": DIGEST,
            "skip_quiesce": True,
        }
        with mock.patch(
            "tooling.development.secure_content.activation_transport."
            "reviewed_remote_transport",
            return_value=(remote, {"PT_DEPLOY_PATH": "peers-touch/repo"}),
        ):
            command = owner.maintenance_command(
                request,
                budget_seconds=3600,
            )

        self.assertIn("--skip-quiesce", command[-1])

    def test_schema_verify_command_uses_reviewed_read_only_transport(self) -> None:
        remote = FakeRemoteTransport()
        owner = ReviewedSchemaActivationTransport(repo_root=Path.cwd())
        request = {
            "source_commit": COMMIT,
            "workspace_id": "workspace-four",
            "profile_id": "four",
            "deployment_environment": "station-four",
            "destructive_scope": "station-four-social-private",
        }
        with mock.patch(
            "tooling.development.secure_content.activation_transport."
            "reviewed_remote_transport",
            return_value=(remote, {"PT_DEPLOY_PATH": "peers-touch/repo"}),
        ):
            command = owner.schema_verify_command(
                request,
                budget_seconds=120,
            )

        self.assertEqual("ssh", command[0])
        self.assertIn("acceptance@station.example", command)
        self.assertIn("remote-schema-verify", command[-1])
        self.assertNotIn("--declaration-digest", command[-1])
        self.assertNotIn("--skip-quiesce", command[-1])

    def test_deploy_uses_profile_pipeline_and_installs_attestation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            repo_root = parent / "peers-touch-federation"
            profile_path = (
                parent
                / "env/peers-touch/four/profile.env.example"
            )
            repo_root.mkdir()
            profile_path.parent.mkdir(parents=True)
            profile_path.write_text(
                "\n".join(
                    (
                        "PT_STATION_MODE=remote",
                        "PT_STATION_URL=http://station.example:18080",
                        "PT_STATION_DEPLOY_ENV=station-four",
                    )
                )
                + "\n",
                encoding="utf-8",
            )
            remote = FakeRemoteTransport()
            command_runner = mock.Mock(
                return_value=SimpleNamespace(
                    returncode=0,
                    stdout="",
                    stderr="",
                )
            )
            owner = ReviewedSchemaActivationTransport(
                repo_root=repo_root,
                command_runner=command_runner,
            )
            with (
                mock.patch(
                    "tooling.development.secure_content.activation_transport."
                    "read_service_version",
                    return_value={
                        "build_commit": COMMIT[:12],
                        "build_time": "2026-09-20T00:00:00Z",
                        "peer_id": "peer-four",
                    },
                ),
                mock.patch(
                    "tooling.development.secure_content.activation_transport."
                    "resolve_remote_source_identity",
                    return_value=(COMMIT, "clean", "a" * 64),
                ),
                mock.patch(
                    "tooling.development.secure_content.activation_transport."
                    "reviewed_remote_transport",
                    return_value=(
                        remote,
                        {"PT_DEPLOY_PATH": "peers-touch/repo"},
                    ),
                ),
            ):
                owner.prepare(
                    {
                        "source_commit": COMMIT,
                        "profile_id": "four",
                        "deployment_environment": "station-four",
                    },
                    budget_seconds=3600,
                )

        self.assertEqual(["make", "station"], command_runner.call_args.args[0])
        install_call = remote.calls[0]
        self.assertIn("install-attestation", install_call[0][-1])
        payload = json.loads(str(install_call[1]["input_text"]))
        self.assertEqual("station-four", payload["serviceId"])
        self.assertEqual(COMMIT, payload["commit"])
        self.assertEqual("peer-four", payload["runtimeIdentity"])

    def test_install_attestation_updates_regular_file_in_place(self) -> None:
        payload = {
            "artifactKind": "service-deployment-attestation",
            "commit": COMMIT,
        }
        with tempfile.TemporaryDirectory() as directory:
            repo_root = Path(directory) / "repo"
            repo_root.mkdir()
            stdin = io.TextIOWrapper(
                io.BytesIO(json.dumps(payload).encode("utf-8"))
            )
            with mock.patch("sys.stdin", stdin):
                _install_attestation(repo_root, "four")
            path = (
                repo_root.parent
                / "secure-content/four-service-attestation.json"
            )
            self.assertEqual(payload, json.loads(path.read_text()))
            self.assertEqual(0o600, path.stat().st_mode & 0o777)

    def test_quiesce_stops_only_station_service_and_verifies_state(self) -> None:
        completed = [
            SimpleNamespace(returncode=0, stdout="", stderr=""),
            SimpleNamespace(returncode=0, stdout="", stderr=""),
        ]
        with mock.patch(
            "tooling.development.secure_content.activation_transport."
            "_compose_command",
            return_value=["docker", "compose"],
        ), mock.patch(
            "tooling.development.secure_content.activation_transport."
            "_run_checked",
            side_effect=completed,
        ) as run:
            _quiesce(Path("/repo"))

        self.assertEqual(
            ["docker", "compose", "stop", "-t", "30", "station"],
            run.call_args_list[0].args[0],
        )
        self.assertEqual(
            [
                "docker",
                "compose",
                "ps",
                "-q",
                "--status",
                "running",
                "station",
            ],
            run.call_args_list[1].args[0],
        )

    def test_station_image_owns_the_maintenance_binary(self) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        dockerfile = (repo_root / "tooling/docker/station.Dockerfile").read_text(
            encoding="utf-8"
        )
        deploy_script = (repo_root / "tooling/scripts/deploy/deploy.sh").read_text(
            encoding="utf-8"
        )
        entrypoint = (repo_root / "tooling/docker/entrypoint.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn(
            "-o /out/secure-content-maintenance "
            "./cmd/secure_content_maintenance",
            dockerfile,
        )
        self.assertIn(
            "COPY --from=builder /out/secure-content-maintenance .",
            dockerfile,
        )
        self.assertIn(
            r"PEERS_TOUCH_BUILD_COMMIT=\$(git rev-parse HEAD)",
            deploy_script,
        )
        self.assertNotIn("git rev-parse --short", deploy_script)
        self.assertIn("/app/data/social-private-objects", entrypoint)


if __name__ == "__main__":
    unittest.main()
