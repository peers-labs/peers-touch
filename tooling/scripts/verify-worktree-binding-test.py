#!/usr/bin/env python3
"""Tests for verify-worktree-binding.py."""

from __future__ import annotations

import errno
import hashlib
import importlib.util
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

SPEC = importlib.util.spec_from_file_location("verify_worktree_binding", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"unable to load {SCRIPT}")
WORKTREE_BINDING = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WORKTREE_BINDING)


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

    def worktree_set_digest(self) -> str:
        return hashlib.sha256(str(self.root).encode("utf-8")).hexdigest()

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
                "--worktree-set-digest",
                self.worktree_set_digest(),
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
        result = self.invoke(
            "--head",
            head,
            "--worktree-set-digest",
            self.worktree_set_digest(),
        )
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
                "worktreeSetDigest": self.worktree_set_digest(),
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

        verified = self.invoke(
            "--head",
            identity["head"],
            "--worktree-set-digest",
            identity["worktreeSetDigest"],
        )
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

    def test_worktree_set_mismatch(self) -> None:
        result = self.invoke("--worktree-set-digest", "0" * 64)

        self.assert_mismatch(result)

    def test_worktree_set_digest_changes_for_synthetic_path_set(self) -> None:
        original = WORKTREE_BINDING.digest_worktree_paths(
            ("/repo/main", "/repo/worktree-a")
        )
        changed = WORKTREE_BINDING.digest_worktree_paths(
            ("/repo/main", "/repo/worktree-a", "/repo/worktree-b")
        )

        self.assertNotEqual(original, changed)

    def test_detached_head(self) -> None:
        self.git("update-ref", "--no-deref", "HEAD", self.git("rev-parse", "HEAD"))

        self.assert_mismatch(self.invoke())


class WorktreeBindingContractTests(unittest.TestCase):
    def test_orchestration_contracts_share_the_fail_closed_guard(self) -> None:
        paths = (
            "AGENTS.md",
            "tooling/skills/pt-context-anchor/SKILL.md",
            "tooling/skills/pt-dev-workflow/SKILL.md",
            "tooling/skills/pt-god-view/SKILL.md",
            "tooling/skills/pt-execution-plan-guardian/SKILL.md",
            "tooling/skills/pt-plan-and-document/SKILL.md",
            "tooling/skills/pt-trae-goal-orchestrator/SKILL.md",
            "tooling/skills/pt-trae-goal-orchestrator/GOAL_TEMPLATE.md",
            "tooling/skills/pt-trae-goal-orchestrator/REVIEW_RUBRIC.md",
        )
        required = (
            "verify-worktree-binding.py",
            "workspaceId",
            "worktree-set",
            "WORKTREE_IDENTITY_MISMATCH",
        )
        for relative in paths:
            with self.subTest(path=relative):
                content = (REPO_ROOT / relative).read_text(encoding="utf-8")
                for marker in required:
                    self.assertIn(marker, content)

    def test_active_work_contracts_persist_recoverable_identity(self) -> None:
        paths = (
            "AGENTS.md",
            "tooling/skills/pt-context-anchor/SKILL.md",
            "tooling/skills/pt-dev-workflow/SKILL.md",
            "tooling/skills/pt-plan-and-document/SKILL.md",
        )
        required = (
            "workspace_id",
            "initial_head",
            "expected_head",
            "worktree_set_digest",
        )
        for relative in paths:
            with self.subTest(path=relative):
                content = (REPO_ROOT / relative).read_text(encoding="utf-8")
                for marker in required:
                    self.assertIn(marker, content)

    def test_legacy_active_work_migration_is_explicit_and_auditable(self) -> None:
        paths = (
            "AGENTS.md",
            "tooling/skills/pt-context-anchor/SKILL.md",
        )
        required = (
            "legacy",
            "exactly once",
            "explicitly authorizes",
            "active_work_binding_migrations",
            "both HEAD",
            "resume",
            "recapture",
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
            "tooling/skills/pt-god-view/SKILL.md",
            "tooling/skills/pt-execution-plan-guardian/SKILL.md",
        )
        for relative in paths:
            with self.subTest(path=relative):
                content = (REPO_ROOT / relative).read_text(encoding="utf-8")
                self.assertIn("<worktree-name> (<repo-root>)", content)
                self.assertIn("bare `<repo-root>`", content)

    def test_goal_commands_require_shell_safe_root_quoting(self) -> None:
        command_paths = (
            "tooling/skills/pt-trae-goal-orchestrator/SKILL.md",
            "tooling/skills/pt-trae-goal-orchestrator/GOAL_TEMPLATE.md",
        )
        for relative in command_paths:
            with self.subTest(path=relative):
                content = (REPO_ROOT / relative).read_text(encoding="utf-8")
                self.assertIn("shell-safe", content)
                self.assertIn("--root '<", content)

        rubric = (
            REPO_ROOT
            / "tooling/skills/pt-trae-goal-orchestrator/REVIEW_RUBRIC.md"
        ).read_text(encoding="utf-8")
        self.assertIn("shell-safe", rubric)
        self.assertIn("root containing whitespace", rubric)

    def test_execution_contracts_forbid_implicit_worktree_operations(self) -> None:
        paths = (
            "AGENTS.md",
            "tooling/skills/pt-god-view/SKILL.md",
            "tooling/skills/pt-execution-plan-guardian/SKILL.md",
            "tooling/skills/pt-trae-goal-orchestrator/SKILL.md",
            "tooling/skills/pt-trae-goal-orchestrator/GOAL_TEMPLATE.md",
        )
        for relative in paths:
            with self.subTest(path=relative):
                content = (REPO_ROOT / relative).read_text(encoding="utf-8")
                self.assertIn("git switch", content)
                self.assertIn("git checkout", content)
                self.assertIn("git worktree add", content)
                self.assertIn("explicit", content)


if __name__ == "__main__":
    unittest.main(verbosity=2)
