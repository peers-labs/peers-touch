from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from tooling.scripts.plan_lifecycle_source import (
    PlanLifecycleSourceError,
    validate_plan_lifecycle_source,
)


PLAN_PATH = "docs/architecture/test/execution-plans/example/plan.md"


def _run(root: Path, *arguments: str) -> str:
    return subprocess.run(
        ["git", *arguments],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def _manifest(first: str, second: str) -> dict[str, object]:
    return {
        "kind": "peers-touch-plan-package",
        "planId": "PLAN-TEST",
        "status": "completed" if second == "done" else "active",
        "binding": {
            "branch": "test",
            "workspaceId": "0123456789abcdef",
            "initialHead": "0" * 40,
        },
        "workClass": "infrastructure",
        "architecture": {
            "sources": ["docs/architecture/test/design.md"],
            "decisions": ["TEST-D01"],
        },
        "scope": {
            "sourceClaims": [
                {"pathPrefix": "tooling", "mode": "exclusive-write"}
            ],
            "nonGoals": [],
        },
        "tasks": [
            {
                "id": "first",
                "workstreamId": "first",
                "path": "tasks/first.md",
                "dependsOn": [],
                "status": first,
                "blocker": None,
            },
            {
                "id": "second",
                "workstreamId": "second",
                "path": "tasks/second.md",
                "dependsOn": ["first"],
                "status": second,
                "blocker": None,
            },
        ],
        "exhaustion": None,
        "authorization": {
            "checkpoint": {"localCommit": "allowed", "amend": "allowed"},
            "delivery": {"push": "denied", "pullRequest": "denied"},
            "runtime": {"deployProfiles": [], "destructiveResetScopes": []},
            "history": {"rewrite": "denied"},
        },
    }


def _document(manifest: dict[str, object], suffix: str = "") -> str:
    return (
        "# Test Plan\n\n"
        "## Plan Package\n\n"
        "```json\n"
        + json.dumps(manifest, separators=(",", ":"), sort_keys=True)
        + "\n```\n\n"
        "## Acceptance Execution\n\n"
        "```json\n{}\n```\n"
        + suffix
    )


class PlanLifecycleSourceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        _run(self.root, "init", "-b", "test")
        _run(self.root, "config", "user.email", "test@example.com")
        _run(self.root, "config", "user.name", "Test")
        self.plan = self.root / PLAN_PATH
        self.plan.parent.mkdir(parents=True)
        self.plan.write_text(
            _document(_manifest("in_progress", "pending")),
            encoding="utf-8",
        )
        _run(self.root, "add", PLAN_PATH)
        _run(self.root, "commit", "-m", "runtime source")
        self.runtime_source = _run(self.root, "rev-parse", "HEAD")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _commit(self, manifest: dict[str, object], suffix: str = "") -> str:
        self.plan.write_text(_document(manifest, suffix), encoding="utf-8")
        _run(self.root, "add", PLAN_PATH)
        _run(self.root, "commit", "-m", "plan lifecycle")
        return _run(self.root, "rev-parse", "HEAD")

    def test_accepts_one_legal_plan_only_handoff(self) -> None:
        control = self._commit(_manifest("done", "in_progress"))

        projection = validate_plan_lifecycle_source(
            repo_root=self.root,
            plan_path=PLAN_PATH,
            runtime_source_commit=self.runtime_source,
            control_head=control,
        )

        self.assertEqual(1, projection.transition_count)
        self.assertEqual(self.runtime_source, projection.runtime_source_commit)
        self.assertEqual(control, projection.control_head)
        self.assertEqual(64, len(projection.transition_digest))

    def test_rejects_non_plan_source_change(self) -> None:
        (self.root / "source.txt").write_text("changed\n", encoding="utf-8")
        _run(self.root, "add", "source.txt")
        _run(self.root, "commit", "-m", "source change")
        control = _run(self.root, "rev-parse", "HEAD")

        with self.assertRaisesRegex(
            PlanLifecycleSourceError,
            "outside the bound Plan",
        ):
            validate_plan_lifecycle_source(
                repo_root=self.root,
                plan_path=PLAN_PATH,
                runtime_source_commit=self.runtime_source,
                control_head=control,
            )

    def test_rejects_plan_contract_change(self) -> None:
        manifest = _manifest("done", "in_progress")
        manifest["scope"]["nonGoals"] = ["new contract"]
        control = self._commit(manifest)

        with self.assertRaisesRegex(
            PlanLifecycleSourceError,
            "immutable Plan contract",
        ):
            validate_plan_lifecycle_source(
                repo_root=self.root,
                plan_path=PLAN_PATH,
                runtime_source_commit=self.runtime_source,
                control_head=control,
            )


if __name__ == "__main__":
    unittest.main()
