from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.core.errors import ProvisioningError
from tooling.acceptance.core.source_sync import SourceSyncRequest
from tooling.scripts.deploy.source_sync import _run_follow_up


REPO_ROOT = Path(__file__).resolve().parents[3]


def _write_direct_environment(path: Path, *, host: str) -> None:
    path.write_text(
        "\n".join(
            (
                f"PT_DEPLOY_HOST={host}",
                "PT_DEPLOY_USER=acceptance",
                "PT_DEPLOY_PATH=runtime/station",
                "PT_DEPLOY_SOURCE=direct",
                "",
            )
        ),
        encoding="utf-8",
    )


class SourceSyncRequestTests(unittest.TestCase):
    def test_deploy_forwards_reviewed_environment_file(self) -> None:
        deploy_script = (
            REPO_ROOT / "tooling" / "scripts" / "deploy" / "deploy.sh"
        ).read_text(encoding="utf-8")

        self.assertIn('--environment-file "$ENV_FILE"', deploy_script)

    def test_explicit_reviewed_environment_example_is_authoritative(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            environments_dir = Path(directory)
            reviewed = environments_dir / "station-four.env.example"
            _write_direct_environment(reviewed, host="reviewed.example")
            _write_direct_environment(
                environments_dir / "station-four.env",
                host="legacy.example",
            )

            request = SourceSyncRequest.from_env_files(
                "station-four",
                source_root=REPO_ROOT,
                environments_dir=environments_dir,
                central_environment_path=environments_dir / "git-server.env",
                environment_path=reviewed,
                branch="main",
            )

        self.assertEqual(request.host, "reviewed.example")

    def test_local_environment_default_remains_dot_env(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            environments_dir = Path(directory)
            _write_direct_environment(
                environments_dir / "station-local.env",
                host="local.example",
            )

            request = SourceSyncRequest.from_env_files(
                "station-local",
                source_root=REPO_ROOT,
                environments_dir=environments_dir,
                central_environment_path=environments_dir / "git-server.env",
                branch="main",
            )

        self.assertEqual(request.host, "local.example")

    def test_explicit_environment_file_must_match_environment_name(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            environments_dir = Path(directory)
            mismatched = environments_dir / "station-five.env.example"
            _write_direct_environment(mismatched, host="wrong.example")

            with self.assertRaisesRegex(
                ProvisioningError,
                "does not match environment 'station-four'",
            ):
                SourceSyncRequest.from_env_files(
                    "station-four",
                    source_root=REPO_ROOT,
                    environments_dir=environments_dir,
                    central_environment_path=(
                        environments_dir / "git-server.env"
                    ),
                    environment_path=mismatched,
                    branch="main",
                )


@unittest.skipUnless(os.name == "posix", "descriptor inheritance requires POSIX")
class SourceSyncFollowUpTests(unittest.TestCase):
    def test_follow_up_preserves_machine_lease_descriptor(self) -> None:
        lease_read_fd, lease_write_fd = os.pipe()
        try:
            environment = os.environ.copy()
            environment["PT_MACHINE_LEASE_FD"] = str(lease_read_fd)
            returncode = _run_follow_up(
                [
                    sys.executable,
                    "-c",
                    "import os; os.fstat(int(os.environ['PT_MACHINE_LEASE_FD']))",
                ],
                environment=environment,
            )
        finally:
            os.close(lease_read_fd)
            os.close(lease_write_fd)

        self.assertEqual(returncode, 0)


if __name__ == "__main__":
    unittest.main()
