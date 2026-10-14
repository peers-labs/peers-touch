#!/usr/bin/env python3
"""Tests for verify-worktree-binding.py."""

from __future__ import annotations

import errno
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("verify-worktree-binding.py")
REPO_ROOT = SCRIPT.parents[2]
MISMATCH = "WORKTREE_IDENTITY_MISMATCH"
UNAVAILABLE = "WORKTREE_IDENTITY_UNAVAILABLE"

class WorktreeBindingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp()).resolve()
        self.addCleanup(self.cleanup_repository)

        self.git("init", "-q", "--initial-branch=main")
        self.git("config", "user.name", "Worktree Binding Test")
        self.git("config", "user.email", "worktree-binding@example.invalid")
        (self.root / "tracked.txt").write_text("tracked\n", encoding="utf-8")
        self.git("add", "tracked.txt")
        self.git("commit", "-q", "-m", "initial")

    def cleanup_repository(self) -> None:
        for attempt in range(5):
            try:
                shutil.rmtree(self.root)
                return
            except FileNotFoundError:
                return
            except OSError as error:
                if error.errno != errno.ENOTEMPTY or attempt == 4:
                    raise
                time.sleep(0.05 * (attempt + 1))

    def git(self, *args: str) -> str:
        result = subprocess.run(
            ["git", "-C", str(self.root), *args],
            check=True,
            capture_output=True,
            text=True,
        )
        return result.stdout.strip()

    def workspace_id(self) -> str:
        return hashlib.sha256(str(self.root).encode("utf-8")).hexdigest()[:16]

    def invoke(
        self,
        *extra: str,
        root: Path | None = None,
        cwd: Path | None = None,
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--root",
                str(root or self.root),
                "--branch",
                "main",
                "--workspace-id",
                self.workspace_id(),
                "--head",
                self.git("rev-parse", "HEAD"),
                *extra,
            ],
            check=False,
            capture_output=True,
            text=True,
            cwd=cwd or self.root,
        )

    def assert_mismatch(self, result: subprocess.CompletedProcess[str]) -> None:
        self.assertNotEqual(result.returncode, 0)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["error"]["code"], MISMATCH)

    def test_success(self) -> None:
        head = self.git("rev-parse", "HEAD")
        result = self.invoke("--head", head)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            json.loads(result.stdout),
            {
                "root": str(self.root),
                "branch": "main",
                "workspaceId": self.workspace_id(),
                "head": head,
                "gitDir": str(self.root / ".git"),
                "commonDir": str(self.root / ".git"),
            },
        )

    def test_capture_then_verify(self) -> None:
        captured = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--root",
                str(self.root),
                "--capture",
            ],
            check=False,
            capture_output=True,
            text=True,
            cwd=self.root,
        )
        self.assertEqual(captured.returncode, 0, captured.stderr)
        identity = json.loads(captured.stdout)

        verified = self.invoke("--head", identity["head"])
        self.assertEqual(verified.returncode, 0, verified.stderr)

    def test_incomplete_verification_is_unavailable(self) -> None:
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--root",
                str(self.root),
            ],
            check=False,
            capture_output=True,
            text=True,
            cwd=self.root,
        )
        self.assertNotEqual(result.returncode, 0)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["error"]["code"], UNAVAILABLE)

    def test_root_mismatch(self) -> None:
        nested = self.root / "nested"
        nested.mkdir()

        self.assert_mismatch(self.invoke(root=nested))

    def test_wrong_current_working_directory(self) -> None:
        self.assert_mismatch(self.invoke(cwd=self.root.parent))

    def test_branch_mismatch(self) -> None:
        result = self.invoke("--branch", "unexpected")

        self.assert_mismatch(result)

    def test_workspace_mismatch(self) -> None:
        result = self.invoke("--workspace-id", "0" * 16)

        self.assert_mismatch(result)

    def test_head_mismatch(self) -> None:
        result = self.invoke("--head", "0" * 40)

        self.assert_mismatch(result)

    def test_unrelated_sibling_directory_churn_does_not_change_identity(self) -> None:
        captured = json.loads(
            subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--root",
                    str(self.root),
                    "--capture",
                ],
                check=True,
                capture_output=True,
                text=True,
                cwd=self.root,
            ).stdout
        )
        sibling = self.root.with_name(f"{self.root.name}-sibling")
        sibling.mkdir()
        (sibling / "unrelated.txt").write_text("unrelated\n", encoding="utf-8")
        result = self.invoke("--head", captured["head"])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), captured)

    def test_detached_head(self) -> None:
        self.git("update-ref", "--no-deref", "HEAD", self.git("rev-parse", "HEAD"))

        self.assert_mismatch(self.invoke())


class WorktreeBindingContractTests(unittest.TestCase):
    def test_contracts_exclude_sibling_worktree_inventory(self) -> None:
        paths = (
            "AGENTS.md",
            "tooling/skills/pt-context-anchor/SKILL.md",
            "tooling/skills/pt-dev-workflow/SKILL.md",
            "tooling/skills/pt-execution-plan-guardian/SKILL.md",
            "tooling/skills/pt-plan-and-document/SKILL.md",
            "tooling/skills/pt-goal-orchestrator/GOAL_TEMPLATE.md",
            "tooling/skills/pt-goal-orchestrator/REVIEW_RUBRIC.md",
        )
        forbidden = (
            "worktree-set",
            "worktreeSetDigest",
            "worktree_set_digest",
        )
        for relative in paths:
            with self.subTest(path=relative):
                content = (REPO_ROOT / relative).read_text(encoding="utf-8")
                for marker in forbidden:
                    self.assertNotIn(marker, content)

    def test_current_worktree_and_optional_task_are_explicit(self) -> None:
        contracts = {
            "AGENTS.md": ("canonical root", "current Git/runtime facts"),
            "tooling/skills/pt-context-anchor/SKILL.md": (
                "canonical worktree",
                "current branch/HEAD",
                ".dev-workflow/tasks/<taskId>",
            ),
            "tooling/skills/pt-plan-and-document/SKILL.md": (
                "明确路径",
                "taskId",
                "Plan Version",
            ),
        }
        for relative, required in contracts.items():
            with self.subTest(path=relative):
                content = (REPO_ROOT / relative).read_text(encoding="utf-8")
                for marker in required:
                    self.assertIn(marker, content)
                self.assertNotIn("worktree_set_digest", content)

    def test_resume_does_not_depend_on_shared_memory_state(self) -> None:
        content = (REPO_ROOT / "AGENTS.md").read_text(encoding="utf-8")
        self.assertIn("Never infer a task from branch, mtime, chat, or memory", content)
        self.assertIn("Current-source evidence", content)

    def test_execution_contracts_forbid_implicit_worktree_operations(self) -> None:
        paths = (
            "AGENTS.md",
            "tooling/skills/pt-dev-workflow/SKILL.md",
        )
        for relative in paths:
            with self.subTest(path=relative):
                content = (REPO_ROOT / relative).read_text(encoding="utf-8")
                self.assertIn("worktree", content)
                self.assertIn("explicit", content.lower())
                self.assertIn("create", content.lower())

    def test_goal_orchestration_drains_ready_work_before_blocking(self) -> None:
        contracts = {
            "AGENTS.md": (
                "Park only the",
                "blocked action",
                "ready frontier",
            ),
            "tooling/skills/pt-execution-plan-guardian/SKILL.md": (
                "A blocked deploy does not block independent",
            ),
            "tooling/skills/pt-context-anchor/SKILL.md": (
                "continue immediately",
                "real resource conflict",
            ),
        }
        for relative, required in contracts.items():
            with self.subTest(path=relative):
                content = (REPO_ROOT / relative).read_text(encoding="utf-8")
                for marker in required:
                    self.assertIn(marker, content)


if __name__ == "__main__":
    unittest.main(verbosity=2)
