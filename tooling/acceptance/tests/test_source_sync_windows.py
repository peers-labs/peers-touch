from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling.acceptance.core.source_sync import (
    RemoteSourceSynchronizer,
    SourceSyncRequest,
    _git_tree_digest,
    _remote_checkout_script,
)
from tooling.acceptance.transports.ssh import RemotePlatform


REPO_ROOT = Path(__file__).resolve().parents[3]


def _git(root: Path, *arguments: str) -> str:
    completed = subprocess.run(
        ["git", "-C", str(root), *arguments],
        capture_output=True,
        text=True,
        check=True,
    )
    return completed.stdout.strip()


class WindowsSourceSyncTests(unittest.TestCase):
    @staticmethod
    def _request(remote_platform: RemotePlatform) -> SourceSyncRequest:
        return SourceSyncRequest(
            environment_name="windows-cell",
            source_root=REPO_ROOT,
            branch="main",
            host="windows.example",
            user="acceptance",
            deploy_path="runtime/windows-cell",
            source_mode="direct",
            remote_platform=remote_platform,
        )

    def test_windows_sync_uses_windows_transport_and_python(self) -> None:
        synchronizer = RemoteSourceSynchronizer(
            self._request(RemotePlatform.WINDOWS)
        )
        payload = json.dumps(
            {
                "remoteCommit": "a" * 40,
                "remoteSourceDigest": "sha256:" + ("b" * 64),
                "remoteCheckoutClean": True,
            }
        )
        with (
            patch.object(
                synchronizer,
                "preflight",
                return_value=("a" * 40, "sha256:" + ("b" * 64)),
            ),
            patch.object(
                synchronizer,
                "_publish_source",
                return_value=("url", "https://example.invalid/repo.git", None, False),
            ),
            patch.object(
                synchronizer.transport,
                "run_argv",
                return_value=subprocess.CompletedProcess(
                    args=(),
                    returncode=0,
                    stdout=payload,
                    stderr="",
                ),
            ) as run_argv,
        ):
            result = synchronizer.sync()

        self.assertEqual(
            synchronizer.transport.target.remote_platform,
            RemotePlatform.WINDOWS,
        )
        self.assertEqual(run_argv.call_args.args[0][0:2], ["python", "-"])
        self.assertEqual(
            run_argv.call_args.kwargs["input_text"],
            _remote_checkout_script(),
        )
        self.assertEqual(result.remote_commit, "a" * 40)
        self.assertTrue(result.remote_checkout_clean)

    def test_direct_publish_creates_remote_directory_with_python(self) -> None:
        synchronizer = RemoteSourceSynchronizer(
            self._request(RemotePlatform.WINDOWS)
        )
        with (
            patch.object(synchronizer.transport, "run_argv") as run_argv,
            patch.object(synchronizer, "_push") as push,
        ):
            synchronizer._publish_source()

        mkdir_argv = run_argv.call_args_list[0].args[0]
        self.assertEqual(mkdir_argv[0], "python")
        self.assertIn("pathlib.Path.home()", mkdir_argv[2])
        self.assertNotIn("mkdir", mkdir_argv[:2])
        self.assertEqual(run_argv.call_args_list[1].args[0][0:3], [
            "git",
            "init",
            "--bare",
        ])
        push.assert_called_once()

    def test_checkout_script_has_cross_platform_lock_and_exact_identity(self) -> None:
        script = _remote_checkout_script()

        self.assertIn("import msvcrt", script)
        self.assertIn("import fcntl", script)
        self.assertIn("msvcrt.LK_NBLCK", script)
        self.assertIn("seek(1 if os.name == 'nt' else 0)", script)
        self.assertIn("'config', 'core.longpaths', 'true'", script)
        self.assertIn("'checkout', '-f', '-B'", script)
        self.assertIn("'reset', '--hard'", script)
        self.assertIn("'clean', '-ffdqx'", script)
        self.assertIn("'ls-tree', '-r', '-z', '--full-tree'", script)
        self.assertIn("BLOCKED:source-residue-after-checkout", script)

    def test_posix_checkout_still_produces_clean_exact_commit_and_digest(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            bare = root / "source.git"
            home = root / "home"
            source.mkdir()
            home.mkdir()
            _git(source, "init")
            _git(source, "config", "user.email", "acceptance@test.invalid")
            _git(source, "config", "user.name", "Acceptance Test")
            (source / "tracked.txt").write_text("exact\n", encoding="utf-8")
            _git(source, "add", "tracked.txt")
            _git(source, "commit", "-m", "exact")
            subprocess.run(
                ["git", "init", "--bare", str(bare)],
                capture_output=True,
                check=True,
            )
            branch = _git(source, "branch", "--show-current")
            commit = _git(source, "rev-parse", "HEAD")
            digest = _git_tree_digest(source, commit)
            _git(source, "push", str(bare), f"HEAD:refs/heads/{branch}")

            completed = subprocess.run(
                [
                    sys.executable,
                    "-c",
                    _remote_checkout_script(),
                    "test-cell",
                    "runtime/repo",
                    "url",
                    str(bare),
                    branch,
                    commit,
                    digest,
                    "test-owner",
                    "acquire",
                ],
                env={
                    **os.environ,
                    "HOME": str(home),
                    "USERPROFILE": str(home),
                },
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(completed.returncode, 0, completed.stderr)
            payload = json.loads(completed.stdout)
            checkout = home / "runtime" / "repo"
            self.assertEqual(payload["remoteCommit"], commit)
            self.assertEqual(payload["remoteSourceDigest"], digest)
            self.assertTrue(payload["remoteCheckoutClean"])
            self.assertEqual(_git(checkout, "rev-parse", "HEAD"), commit)
            self.assertEqual(
                _git(checkout, "status", "--porcelain", "--untracked-files=all"),
                "",
            )


if __name__ == "__main__":
    unittest.main()
