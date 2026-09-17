from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from tooling.acceptance.core.execution_plan import (
    ACTIVE_PLAN_REQUIRED,
    MULTIPLE_ACTIVE_PLANS,
    PLAN_BLOCKED,
    PLAN_COMPLETE,
    PLAN_INVALID,
    ExecutionPlanError,
    discover_active_plan,
    load_formal_plan,
    workspace_id,
)


def package_manifest_text(
    workspace: str,
    *,
    branch: str = "feat/example",
    status: str = "active",
) -> str:
    return f"""# Example Package

> **Status**: {status}
> **Branch**: `{branch}`
> **Workspace ID**: `{workspace}`
> **Initial HEAD**: `{'a' * 40}`

## Plan Package

```json
{{
  "schemaVersion": 1,
  "kind": "peers-touch-plan-package"
}}
```
"""


def package_status(
    workspace: str,
    *,
    status: str = "active",
    current: bool = True,
) -> dict[str, object]:
    return {
        "ok": True,
        "status": status,
        "branch": "feat/example",
        "workspaceId": workspace,
        "initialHead": "a" * 40,
        "expectedHead": "a" * 40,
        "currentTaskId": "T1" if current else None,
        "currentTaskPath": "tasks/T1.md" if current else None,
        "currentClosure": "C1" if current else None,
        "closureStatuses": {
            "C1": "in_progress" if current else "blocked",
            "C2": "done",
        },
        "acceptance": {
            "schemaVersion": 1,
            "closures": {"C1": ["cheap-gate"], "C2": []},
            "completion": ["cheap-gate"],
            "full": ["cheap-gate", "runtime-gate"],
        },
    }


def plan_text(
    workspace: str,
    *,
    branch: str = "feat/example",
    status: str = "active, approved for execution",
    rows: str = "| C1 | in progress | |\n| C2 | completed | |",
) -> str:
    return f"""# Example

> **Status**: {status}
> **Branch**: `{branch}`
> **Workspace ID**: `{workspace}`
> **Initial HEAD**: `{'a' * 40}`

## Acceptance Execution

```json
{{
  "schemaVersion": 1,
  "closures": {{"C1": ["cheap-gate"], "C2": []}},
  "completion": ["cheap-gate"],
  "full": ["cheap-gate", "runtime-gate"]
}}
```

## Implementation Status

| Closure | Status | Evidence |
|---|---|---|
{rows}
"""


class ExecutionPlanTest(unittest.TestCase):
    def test_package_planctl_projection_end_to_end(self) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        temporary_root = repo_root / "tmp"
        temporary_root.mkdir(exist_ok=True)
        workspace = workspace_id(repo_root)
        with tempfile.TemporaryDirectory(
            prefix="execution-plan-package-",
            dir=temporary_root,
        ) as temporary:
            package = Path(temporary)
            tasks = package / "tasks"
            tasks.mkdir()
            manifest = {
                "schemaVersion": 1,
                "kind": "peers-touch-plan-package",
                "planId": "DWF-PYTHON-INTEGRATION",
                "status": "active",
                "binding": {
                    "branch": "feat/example",
                    "workspaceId": workspace,
                    "initialHead": "a" * 40,
                    "expectedHead": "b" * 40,
                },
                "workClass": "infrastructure",
                "architecture": {
                    "sources": [
                        "docs/architecture/development-workflow/design.md"
                    ],
                    "decisions": ["DWF-D13"],
                },
                "scope": {
                    "sourceClaims": [
                        {
                            "pathPrefix": "tooling/scripts/plan",
                            "mode": "exclusive-write",
                        },
                        {
                            "pathPrefix": "docs/architecture/development-workflow",
                            "mode": "shared-read",
                        },
                    ],
                    "nonGoals": ["Product behavior"],
                },
                "tasks": [
                    {
                        "id": "DWF-PY-01",
                        "workstreamId": "DWF-B1",
                        "path": "tasks/DWF-PY-01.md",
                        "dependsOn": [],
                        "status": "in_progress",
                        "blocker": None,
                    }
                ],
                "exhaustion": None,
                "authorization": {
                    "checkpoint": {
                        "localCommit": "denied",
                        "amend": "denied",
                    },
                    "delivery": {
                        "push": "denied",
                        "pullRequest": "denied",
                    },
                    "runtime": {
                        "deployProfiles": [],
                        "destructiveResetScopes": [],
                    },
                    "history": {"rewrite": "denied"},
                },
            }
            acceptance = {
                "schemaVersion": 1,
                "closures": {
                    "development-workflow-control-plane": [
                        "development-workflow-control-plane"
                    ]
                },
                "completion": ["development-workflow-control-plane"],
                "full": ["development-workflow-control-plane"],
            }
            task = {
                "schemaVersion": 1,
                "kind": "peers-touch-task-slice",
                "planId": manifest["planId"],
                "taskId": "DWF-PY-01",
                "workstreamId": "DWF-B1",
                "title": "Cross-language parser integration",
                "workClass": "infrastructure",
                "completionClass": "functional",
                "executionMode": "build",
                "closureId": "development-workflow-control-plane",
                "journeyId": "DWF-AS02",
                "runtimeClass": "source-only",
                "writeSet": ["tooling/scripts/plan"],
                "readSet": [
                    "docs/architecture/development-workflow/design.md"
                ],
                "budgets": {
                    "focusedCheckSeconds": 30,
                    "functionalRunSeconds": 60,
                    "cleanupSeconds": 10,
                },
                "checks": [
                    {
                        "id": "python-adapter",
                        "command": (
                            "python3 -m unittest "
                            "tooling.acceptance.tests.test_execution_plan"
                        ),
                        "verificationClass": "STRUCTURAL_CHECK",
                    },
                    {
                        "id": "python-adapter-functional",
                        "command": (
                            "python3 -m unittest "
                            "tooling.acceptance.tests.test_execution_plan"
                        ),
                        "verificationClass": "FUNCTIONAL_CHECK",
                    },
                    {
                        "id": "python-adapter-acceptance",
                        "command": (
                            "python3 -m unittest "
                            "tooling.acceptance.tests.test_execution_plan"
                        ),
                        "verificationClass": "ACCEPTANCE_PROOF",
                    }
                ],
                "doneWhen": ["Python consumes the Node projection"],
                "failureBehavior": ["Fail on projection drift"],
                "updatedAt": "2026-09-16T00:00:00.000Z",
                "durableEvidence": [],
            }
            plan_path = package / "plan.md"
            plan_path.write_text(
                "\n".join(
                    [
                        "# Integration Plan",
                        "",
                        "> **Status**: active",
                        "> **Branch**: feat/example",
                        f"> **Workspace ID**: {workspace}",
                        f"> **Initial HEAD**: {'a' * 40}",
                        f"> **Expected HEAD**: {'b' * 40}",
                        "",
                        "## Plan Package",
                        "",
                        "```json",
                        json.dumps(manifest, indent=2),
                        "```",
                        "",
                        "## Acceptance Execution",
                        "",
                        "```json",
                        json.dumps(acceptance, indent=2),
                        "```",
                        "",
                    ]
                ),
                encoding="utf-8",
            )
            (tasks / "DWF-PY-01.md").write_text(
                "\n".join(
                    [
                        "# Cross-language parser integration",
                        "",
                        "## Task Slice",
                        "",
                        "```json",
                        json.dumps(task, indent=2),
                        "```",
                        "",
                        "## Current Snapshot",
                        "",
                        "- State: ready",
                        "",
                    ]
                ),
                encoding="utf-8",
            )

            plan = load_formal_plan(plan_path)

        self.assertEqual(plan.plan_format, "package")
        self.assertEqual(plan.current_task_id, "DWF-PY-01")
        self.assertEqual(
            plan.gate_ids("closure"),
            ["development-workflow-control-plane"],
        )

    def test_loads_package_through_planctl_projection(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "plan.md"
            path.write_text(package_manifest_text("1" * 16), encoding="utf-8")

            with mock.patch(
                "tooling.acceptance.core.execution_plan._package_status",
                return_value=package_status("1" * 16),
            ):
                plan = load_formal_plan(path)

        self.assertEqual(plan.plan_format, "package")
        self.assertEqual(plan.current_task_id, "T1")
        self.assertEqual(plan.current_task_path, "tasks/T1.md")
        self.assertEqual(plan.current_closure, "C1")
        self.assertEqual(plan.gate_ids("closure"), ["cheap-gate"])

    def test_blocked_package_has_no_runnable_closure(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "plan.md"
            path.write_text(
                package_manifest_text("1" * 16, status="blocked"),
                encoding="utf-8",
            )

            with mock.patch(
                "tooling.acceptance.core.execution_plan._package_status",
                return_value=package_status(
                    "1" * 16,
                    status="blocked",
                    current=False,
                ),
            ):
                plan = load_formal_plan(path)

        self.assertIsNone(plan.current_task_id)
        self.assertIsNone(plan.current_closure)
        with self.assertRaises(ExecutionPlanError) as raised:
            plan.gate_ids("closure")
        self.assertEqual(raised.exception.code, PLAN_BLOCKED)

    def test_loads_current_closure_and_gate_sets(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "plan.md"
            path.write_text(plan_text("1" * 16), encoding="utf-8")

            plan = load_formal_plan(path)

        self.assertEqual(plan.current_closure, "C1")
        self.assertEqual(plan.gate_ids("closure"), ["cheap-gate"])
        self.assertEqual(
            plan.all_declared_gate_ids(),
            {"cheap-gate", "runtime-gate"},
        )

    def test_rejects_multiple_current_closures(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "plan.md"
            path.write_text(
                plan_text(
                    "1" * 16,
                    rows="| C1 | in progress | |\n| C2 | in progress | |",
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                ExecutionPlanError,
                "multiple in-progress closures",
            ) as raised:
                load_formal_plan(path)

        self.assertEqual(raised.exception.code, PLAN_INVALID)

    def test_allows_no_current_closure_after_every_closure_completes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "plan.md"
            path.write_text(
                plan_text(
                    "1" * 16,
                    rows="| C1 | completed | |\n| C2 | completed | |",
                ),
                encoding="utf-8",
            )

            plan = load_formal_plan(path)

        self.assertIsNone(plan.current_closure)
        with self.assertRaises(ExecutionPlanError) as raised:
            plan.gate_ids("closure")
        self.assertEqual(raised.exception.code, PLAN_COMPLETE)

    def test_discovers_exactly_one_plan_for_branch_and_worktree(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            plan_dir = root / "docs" / "architecture" / "example" / "execution-plans"
            plan_dir.mkdir(parents=True)
            expected_workspace = workspace_id(root)
            active = plan_dir / "active.md"
            active.write_text(plan_text(expected_workspace), encoding="utf-8")
            (plan_dir / "completed.md").write_text(
                plan_text(expected_workspace, status="completed"),
                encoding="utf-8",
            )

            with mock.patch(
                "tooling.acceptance.core.execution_plan._git",
                return_value="feat/example",
            ):
                result = discover_active_plan(root)

        self.assertEqual(result.path, active.resolve())

    def test_discovers_active_package_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            expected_workspace = workspace_id(root)
            package = (
                root
                / "docs"
                / "architecture"
                / "example"
                / "execution-plans"
                / "package"
            )
            package.mkdir(parents=True)
            manifest = package / "plan.md"
            manifest.write_text(
                package_manifest_text(expected_workspace),
                encoding="utf-8",
            )

            with (
                mock.patch(
                    "tooling.acceptance.core.execution_plan._git",
                    return_value="feat/example",
                ),
                mock.patch(
                    "tooling.acceptance.core.execution_plan._package_status",
                    return_value=package_status(expected_workspace),
                ),
            ):
                result = discover_active_plan(root)

        self.assertEqual(result.path, manifest.resolve())
        self.assertEqual(result.plan_format, "package")

    def test_rejects_zero_or_multiple_active_plans(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "docs").mkdir()
            with mock.patch(
                "tooling.acceptance.core.execution_plan._git",
                return_value="feat/example",
            ):
                with self.assertRaises(ExecutionPlanError) as missing:
                    discover_active_plan(root)
            self.assertEqual(missing.exception.code, ACTIVE_PLAN_REQUIRED)

            plan_dir = root / "docs" / "example" / "execution-plans"
            plan_dir.mkdir(parents=True)
            expected_workspace = workspace_id(root)
            for name in ("one.md", "two.md"):
                (plan_dir / name).write_text(
                    plan_text(expected_workspace),
                    encoding="utf-8",
                )
            with mock.patch(
                "tooling.acceptance.core.execution_plan._git",
                return_value="feat/example",
            ):
                with self.assertRaises(ExecutionPlanError) as multiple:
                    discover_active_plan(root)
            self.assertEqual(multiple.exception.code, MULTIPLE_ACTIVE_PLANS)


if __name__ == "__main__":
    unittest.main()
