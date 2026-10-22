"""Synthetic build producer checks; these do not claim Desktop product proof."""

from __future__ import annotations

import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.core.execution_budget import ExecutionDeadline, deadline
from tooling.acceptance.provisioners.desktop_acceptance_build import (
    BUILD_RESOURCE,
    DesktopAcceptanceBuild,
)


class DesktopAcceptanceBuildTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        directory = Path(self.temporary.name)
        self.root = directory / "repo"
        self.root.mkdir()
        (self.root / "apps/desktop/src-tauri").mkdir(parents=True)
        self.tools = directory / "tools"
        self.tools.mkdir()
        (self.root / ".gitignore").write_text(".local/\n")
        (self.root / "Makefile").write_text(
            "export PATH := /usr/bin:/bin:$(PATH)\n"
            "acceptance-driver-build-environment:\n"
            f"\t@\"{sys.executable}\" -c "
            "'import json,os; print(json.dumps({\"path\": os.environ[\"PATH\"]}))'\n"
        )
        (self.root / "source.txt").write_text("first source")
        self.git("init", "-q")
        self.git("add", ".gitignore", "source.txt", "Makefile")
        self.commit()
        self.frontend = """
from pathlib import Path
root = Path(ROOT)
state = root / '.local'
state.mkdir(exist_ok=True)
count = state / 'count'
count.write_text(str(int(count.read_text()) + 1 if count.exists() else 1))
(state / 'compiler-binary').write_bytes((root / 'source.txt').read_bytes())
"""
        self.tool("pnpm", self.frontend)
        self.tool("cargo", """
import json
print(json.dumps({
    'reason': 'compiler-artifact', 'target': {'name': 'peers-touch-desktop'},
    'executable': ROOT + '/.local/compiler-binary',
}))
""")
        self.tool("node", "")
        self.tool("rustc", "")
        self.environment = patch.dict(os.environ, {
            "PATH": f"{self.tools}:{os.environ['PATH']}",
            "PT_ACCEPTANCE_RUN_ID": "",
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.platform = patch(
            "tooling.acceptance.provisioners.desktop_acceptance_build.platform.system",
            return_value="Linux",
        )
        self.platform.start()
        self.addCleanup(self.platform.stop)

    def git(self, *argv: str) -> None:
        subprocess.run(
            ("git", *argv), cwd=self.root, check=True,
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        )

    def commit(self) -> None:
        self.git(
            "-c", "user.name=Synthetic Build", "-c", "user.email=build@example.invalid",
            "commit", "-qm", "synthetic source",
        )

    def tool(self, name: str, body: str, version: str = "1.0") -> None:
        path = self.tools / name
        path.write_text(
            "#!/usr/bin/env python3\nimport sys\n"
            f"ROOT = {str(self.root)!r}\n"
            f"if sys.argv[1:] in [['--version'], ['-vV']]:\n"
            f"    print({version!r}); raise SystemExit(0)\n"
            + body,
        )
        path.chmod(0o755)

    def count(self) -> int:
        return int((self.root / ".local/count").read_text())

    def test_cold_then_verified_reuse_and_integrity_source_config_tool_invalidation(self) -> None:
        cold = DesktopAcceptanceBuild(self.root)
        binary = cold.ensure()
        self.assertEqual(cold.observation["reuse"], "COLD_BUILD")
        warm = DesktopAcceptanceBuild(self.root)
        self.assertEqual(warm.ensure(), binary)
        self.assertEqual(warm.observation["reuse"], "VERIFIED_BUILD")
        self.assertEqual(self.count(), 1)
        with patch.dict(os.environ, {"PATH": "/usr/bin:/bin:" + os.environ["PATH"]}):
            make_environment = DesktopAcceptanceBuild(self.root)
            make_environment.ensure()
            self.assertEqual(make_environment.observation["reuse"], "VERIFIED_BUILD")
            self.assertEqual(self.count(), 1)

        binary.write_bytes(b"tampered")
        DesktopAcceptanceBuild(self.root).ensure()
        self.assertEqual(binary.read_bytes(), b"first source")
        self.assertEqual(self.count(), 2)

        (self.root / "source.txt").write_text("next source")
        with self.assertRaisesRegex(BlockedError, "clean source"):
            DesktopAcceptanceBuild(self.root).ensure()
        self.assertEqual(self.count(), 2)
        self.git("add", "source.txt")
        self.commit()
        DesktopAcceptanceBuild(self.root).ensure()
        self.assertEqual(binary.read_bytes(), b"next source")
        self.assertEqual(self.count(), 3)

        with patch.dict(os.environ, {"RUSTFLAGS": "--cfg synthetic"}):
            DesktopAcceptanceBuild(self.root).ensure()
            self.assertEqual(self.count(), 4)
            DesktopAcceptanceBuild(self.root).ensure()
            self.assertEqual(self.count(), 4)
            self.tool("node", "", version="2.0")
            DesktopAcceptanceBuild(self.root).ensure()
            self.assertEqual(self.count(), 5)
        receipt = json.loads((cold.state / "receipt.json").read_text())
        self.assertEqual(receipt["identity"]["workspaceDigest"], "clean")
        self.assertNotIn("RUSTFLAGS", json.dumps(receipt))

    def test_build_timeout_retains_output_and_does_not_publish_a_receipt(self) -> None:
        self.tool("pnpm", """
import time
print('synthetic frontend waiting', flush=True)
time.sleep(30)
""")
        build = DesktopAcceptanceBuild(self.root, timeout_seconds=1.5)
        with patch.object(build, "_identity", return_value={
            "commit": "synthetic-source", "workspaceDigest": "clean",
        }), self.assertRaises(BlockedError) as caught:
            build.ensure()
        self.assertEqual(caught.exception.resource, BUILD_RESOURCE)
        self.assertEqual(build.observation["stage"], "frontend")
        self.assertFalse((build.state / "receipt.json").exists())
        logs = list(build.state.glob("attempts/*/frontend-stdout.log"))
        self.assertEqual(len(logs), 1)
        self.assertIn("synthetic frontend waiting", logs[0].read_text())
        self.assertEqual(
            caught.exception.diagnostic.to_dict()["resourceChecks"][0]["observed"]["status"],
            "FAILED",
        )

    def test_outer_gate_cancellation_preserves_typed_deadline_and_owner_diagnostic(self) -> None:
        self.tool("pnpm", "import time\ntime.sleep(30)\n")
        build = DesktopAcceptanceBuild(self.root)
        with patch.object(build, "_identity", return_value={
            "commit": "synthetic-source", "workspaceDigest": "clean",
        }), self.assertRaises(ExecutionDeadline) as caught:
            with deadline(1.5, ExecutionDeadline("synthetic", "runtime-cell", "work")):
                build.ensure()
        self.assertEqual(caught.exception.stage, "runtime-cell")
        self.assertEqual(caught.exception.resource, BUILD_RESOURCE)
        self.assertIsNotNone(caught.exception.diagnostic)
        self.assertFalse((build.state / "receipt.json").exists())

    def test_lock_wait_is_bounded_and_does_not_start_another_build(self) -> None:
        build = DesktopAcceptanceBuild(self.root, timeout_seconds=0.1)
        build.state.mkdir(parents=True)
        with (build.state / "build.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            with self.assertRaisesRegex(BlockedError, "lock timed out"):
                build.ensure()
        self.assertFalse((self.root / ".local/count").exists())


if __name__ == "__main__":
    unittest.main()
