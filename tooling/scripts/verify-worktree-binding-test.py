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

    def test_unrelated_sibling_worktree_churn_does_not_change_identity(self) -> None:
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
        try:
            self.git("worktree", "add", "-q", "-b", "sibling", str(sibling))
            result = self.invoke("--head", captured["head"])
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout), captured)
        finally:
            subprocess.run(
                [
                    "git",
                    "-C",
                    str(self.root),
                    "worktree",
                    "remove",
                    "--force",
                    str(sibling),
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            shutil.rmtree(sibling, ignore_errors=True)
        result = self.invoke("--head", captured["head"])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), captured)

    def test_detached_head(self) -> None:
        self.git("update-ref", "--no-deref", "HEAD", self.git("rev-parse", "HEAD"))

        self.assert_mismatch(self.invoke())


class WorktreeBindingContractTests(unittest.TestCase):
    def test_orchestration_contracts_share_the_fail_closed_guard(self) -> None:
        paths = (
            "AGENTS.md",
            "tooling/skills/pt-dev-workflow/SKILL.md",
            "tooling/skills/pt-goal-orchestrator/GOAL_TEMPLATE.md",
        )
        required = (
            "verify-worktree-binding.py",
            "workspaceId",
            "WORKTREE_IDENTITY_MISMATCH",
        )
        for relative in paths:
            with self.subTest(path=relative):
                content = (REPO_ROOT / relative).read_text(encoding="utf-8")
                for marker in required:
                    self.assertIn(marker, content)

    def test_binding_contract_excludes_sibling_worktree_inventory(self) -> None:
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

    def test_active_work_contracts_persist_current_worktree_identity(self) -> None:
        contracts = {
            "AGENTS.md": ("workspaceId", "initial_head", "expected_head"),
            "tooling/skills/pt-context-anchor/SKILL.md": (
                "workspaceId",
                "Initial HEAD",
                "Expected HEAD",
                "active-work.json",
            ),
            "tooling/skills/pt-plan-and-document/SKILL.md": (
                "workspace",
                "active-work",
                "project_memory.md",
            ),
        }
        for relative, required in contracts.items():
            with self.subTest(path=relative):
                content = (REPO_ROOT / relative).read_text(encoding="utf-8")
                for marker in required:
                    self.assertIn(marker, content)
                self.assertNotIn("worktree_set_digest", content)

    def test_legacy_active_work_migration_is_explicit_and_auditable(self) -> None:
        paths = ("AGENTS.md",)
        required = (
            "legacy",
            "project_memory.md ## active_work",
            "compatibility writer",
            "make active-work-sync",
            "another workspace's record",
            "resume",
            "WORKTREE_IDENTITY_UNAVAILABLE",
        )
        for relative in paths:
            with self.subTest(path=relative):
                content = (REPO_ROOT / relative).read_text(encoding="utf-8")
                for marker in required:
                    self.assertIn(marker, content)

    def test_context_anchor_names_the_logical_worktree(self) -> None:
        paths = (
            "AGENTS.md",
            "tooling/skills/pt-context-anchor/SKILL.md",
        )
        for relative in paths:
            with self.subTest(path=relative):
                content = (REPO_ROOT / relative).read_text(encoding="utf-8")
                self.assertIn("<worktree-name> (<repo-root>)", content)
        agents = (REPO_ROOT / "AGENTS.md").read_text(encoding="utf-8")
        self.assertIn("bare `<repo-root>`", agents)

    def test_goal_commands_require_shell_safe_root_quoting(self) -> None:
        command_paths = ("tooling/skills/pt-goal-orchestrator/GOAL_TEMPLATE.md",)
        for relative in command_paths:
            with self.subTest(path=relative):
                content = (REPO_ROOT / relative).read_text(encoding="utf-8")
                self.assertIn("shell-safe", content)
                self.assertIn("--root '<", content)

        rubric = (
            REPO_ROOT
            / "tooling/skills/pt-goal-orchestrator/REVIEW_RUBRIC.md"
        ).read_text(encoding="utf-8")
        self.assertIn("shell-safe", rubric)
        self.assertIn("root containing whitespace", rubric)

    def test_execution_contracts_forbid_implicit_worktree_operations(self) -> None:
        paths = (
            "AGENTS.md",
            "tooling/skills/pt-goal-orchestrator/GOAL_TEMPLATE.md",
        )
        for relative in paths:
            with self.subTest(path=relative):
                content = (REPO_ROOT / relative).read_text(encoding="utf-8")
                self.assertIn("git switch", content)
                self.assertIn("git checkout", content)
                self.assertIn("git worktree add", content)
                self.assertIn("explicit", content)

    def test_goal_orchestration_drains_ready_work_before_blocking(self) -> None:
        queue_contracts = (
            "tooling/skills/pt-goal-orchestrator/GOAL_TEMPLATE.md",
            "tooling/skills/pt-goal-orchestrator/REVIEW_RUBRIC.md",
        )
        for relative in queue_contracts:
            with self.subTest(path=relative):
                content = (REPO_ROOT / relative).read_text(encoding="utf-8")
                self.assertIn("Ready Queue", content)
                self.assertIn("Parked Queue", content)
                self.assertIn("exhaustion proof", content)

        scheduler = (
            REPO_ROOT / "tooling/skills/pt-goal-orchestrator/SKILL.md"
        ).read_text(encoding="utf-8")
        self.assertIn("Ready Queue", scheduler)
        self.assertIn("Park actions", scheduler)
        self.assertIn("GOAL_SLICE_BLOCKED", scheduler)

        execution_contracts = {
            "AGENTS.md": (
                "Action blocked",
                "Goal blocked",
                "fixed-point exhaustion",
            ),
            "tooling/skills/pt-execution-plan-guardian/SKILL.md": (
                "One failed action does not prove the whole plan blocked",
            ),
            "tooling/skills/pt-context-anchor/SKILL.md": (
                "non-blocked",
                "hard boundary",
                "source-backed",
            ),
        }
        for relative, required in execution_contracts.items():
            with self.subTest(path=relative):
                content = (REPO_ROOT / relative).read_text(encoding="utf-8")
                for marker in required:
                    self.assertIn(marker, content)


if __name__ == "__main__":
    unittest.main(verbosity=2)
