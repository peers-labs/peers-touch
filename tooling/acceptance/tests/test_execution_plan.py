from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from tooling.acceptance.core.execution_plan import (
    PLAN_COMPLETE,
    PLAN_INPUT_REQUIRED,
    PLAN_INVALID,
    ExecutionPlanError,
    changed_paths_for_plan,
    closure_status_is_complete,
    discover_active_plan,
    load_formal_plan,
    workspace_id,
)


def plan_version_text(
    workspace: str,
    *,
    branch: str = "feat/example",
    status: str = "active",
) -> str:
    return f"""# Example Plan Version

> **Status**: {status}
> **Branch**: `{branch}`
> **Workspace ID**: `{workspace}`
> **Initial HEAD**: `{'a' * 40}`

## Plan Version

```json
{{
  "kind": "peers-touch-plan-version"
}}
```
"""


def mounted_plan_status(
    workspace: str,
    *,
    plan_id: str = "EXAMPLE-PLAN",
    status: str = "active",
    current: bool = True,
) -> dict[str, object]:
    return {
        "ok": True,
        "planId": plan_id,
        "status": status,
        "branch": "feat/example",
        "workspaceId": workspace,
        "initialHead": "a" * 40,
        "currentTaskWriteSet": ["tooling/scripts/plan"] if current else [],
        "sourceClaims": [
            {
                "pathPrefix": "tooling/scripts/plan",
                "mode": "exclusive-write",
            },
            {
                "pathPrefix": "docs/architecture/engineering/development-workflow",
                "mode": "shared-read",
            },
        ],
        "currentTaskId": "T1" if current else None,
        "currentTaskPath": "tasks/T1.md" if current else None,
        "currentClosure": "C1" if current else None,
        "closureStatuses": {
            "C1": "in_progress" if current else "blocked",
            "C2": "done",
        },
        "acceptance": {
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
    def test_completion_accepts_plan_version_and_legacy_statuses(self) -> None:
        self.assertTrue(closure_status_is_complete("done"))
        self.assertTrue(closure_status_is_complete("completed"))
        self.assertTrue(closure_status_is_complete("completed with evidence"))
        self.assertFalse(closure_status_is_complete("in_progress"))

    def test_ci_requires_explicit_plan_input(self) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        environment = dict(os.environ)
        environment.pop("PT_EXECUTION_PLAN", None)
        completed = subprocess.run(
            [
                "python3",
                "tooling/scripts/execution-plan.py",
                "--ci",
            ],
            cwd=repo_root,
            env=environment,
            check=False,
            capture_output=True,
            text=True,
        )

        self.assertEqual(completed.returncode, 2)
        self.assertIn("EXECUTION_PLAN_INPUT_REQUIRED", completed.stderr)

    def test_plan_version_projection_preserves_acceptance_closure(self) -> None:
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
                "kind": "peers-touch-plan-version",
                "planId": "DWF-PYTHON-INTEGRATION",
                "status": "active",
                "binding": {
                    "branch": "feat/example",
                    "workspaceId": workspace,
                    "initialHead": "a" * 40,
                },
                "workClass": "infrastructure",
                "architecture": {
                    "sources": [
                        "docs/architecture/engineering/development-workflow/design.md"
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
                            "pathPrefix": "docs/architecture/engineering/development-workflow",
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
                "closures": {
                    "development-workflow-control-plane": [
                        "development-workflow-control-plane"
                    ]
                },
                "completion": ["development-workflow-control-plane"],
                "full": ["development-workflow-control-plane"],
            }
            task = {
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
                    "docs/architecture/engineering/development-workflow/design.md"
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
                        "",
                        "## Plan Version",
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

            status = mounted_plan_status(
                workspace,
                plan_id=manifest["planId"],
            )
            status.update(
                {
                    "currentTaskId": "DWF-PY-01",
                    "currentTaskPath": "tasks/DWF-PY-01.md",
                    "currentTaskWriteSet": ["tooling/scripts/plan"],
                    "currentClosure": "development-workflow-control-plane",
                    "closureStatuses": {
                        "development-workflow-control-plane": "in_progress"
                    },
                    "acceptance": acceptance,
                }
            )
            with (
                mock.patch(
                    "tooling.acceptance.core.execution_plan._explicit_plan_inspection",
                    return_value=status,
                ),
                mock.patch(
                    "tooling.acceptance.core.execution_plan._git",
                    side_effect=[temporary, "feat/example", "b" * 40],
                ),
            ):
                plan = load_formal_plan(plan_path)

        self.assertEqual(plan.plan_format, "version")
        self.assertIsNone(plan.current_task_id)
        self.assertIsNone(plan.current_closure)
        self.assertEqual(
            plan.gate_ids("completion"),
            ["development-workflow-control-plane"],
        )

    def test_loads_plan_version_through_planctl_projection(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "plan.md"
            path.write_text(plan_version_text("1" * 16), encoding="utf-8")

            with (
                mock.patch(
                    "tooling.acceptance.core.execution_plan._explicit_plan_inspection",
                    return_value=mounted_plan_status("1" * 16),
                ),
                mock.patch(
                    "tooling.acceptance.core.execution_plan._git",
                    side_effect=[temporary, "feat/example", "b" * 40],
                ),
            ):
                plan = load_formal_plan(path)

        self.assertEqual(plan.plan_format, "version")
        self.assertIsNone(plan.current_task_id)
        self.assertIsNone(plan.current_task_path)
        self.assertIsNone(plan.current_task_write_set)
        self.assertIsNone(plan.current_closure)
        self.assertEqual(plan.gate_ids("completion"), ["cheap-gate"])
        self.assertEqual(
            plan.source_claims,
            (
                "tooling/scripts/plan",
                "docs/architecture/engineering/development-workflow",
            ),
        )

    def test_plan_version_changed_paths_are_limited_to_source_claims(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "plan.md"
            path.write_text(plan_version_text("1" * 16), encoding="utf-8")
            with (
                mock.patch(
                    "tooling.acceptance.core.execution_plan._explicit_plan_inspection",
                    return_value=mounted_plan_status("1" * 16),
                ),
                mock.patch(
                    "tooling.acceptance.core.execution_plan._git",
                    side_effect=[temporary, "feat/example", "b" * 40],
                ),
            ):
                plan = load_formal_plan(path)

        with mock.patch(
            "tooling.acceptance.core.execution_plan._git",
            side_effect=[
                (
                    "tooling/scripts/plan/planctl.mjs\n"
                    "apps/station/unrelated.go\n"
                ),
                "docs/architecture/engineering/development-workflow/design.md\n",
                "apps/desktop/untracked.ts\n",
            ],
        ):
            paths = changed_paths_for_plan(Path("/repo"), plan)

        self.assertEqual(
            paths,
            [
                "docs/architecture/engineering/development-workflow/design.md",
                "tooling/scripts/plan/planctl.mjs",
            ],
        )

        with mock.patch(
            "tooling.acceptance.core.execution_plan._git",
            side_effect=[
                (
                    "tooling/scripts/plan/planctl.mjs\n"
                    "apps/station/unrelated.go\n"
                ),
                "docs/architecture/engineering/development-workflow/design.md\n",
                "apps/desktop/untracked.ts\n",
            ],
        ):
            completion_paths = changed_paths_for_plan(
                Path("/repo"),
                plan,
                "completion",
            )

        self.assertEqual(
            completion_paths,
            [
                "docs/architecture/engineering/development-workflow/design.md",
                "tooling/scripts/plan/planctl.mjs",
            ],
        )

    def test_explicit_plan_version_has_no_implicit_runnable_closure(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "plan.md"
            path.write_text(
                plan_version_text("1" * 16, status="blocked"),
                encoding="utf-8",
            )

            with (
                mock.patch(
                    "tooling.acceptance.core.execution_plan._explicit_plan_inspection",
                    return_value=mounted_plan_status(
                        "1" * 16,
                        status="blocked",
                        current=False,
                    ),
                ),
                mock.patch(
                    "tooling.acceptance.core.execution_plan._git",
                    side_effect=[temporary, "feat/example", "b" * 40],
                ),
            ):
                plan = load_formal_plan(path)

        self.assertIsNone(plan.current_task_id)
        self.assertIsNone(plan.current_closure)
        with self.assertRaises(ExecutionPlanError) as raised:
            plan.gate_ids("closure")
        self.assertEqual(raised.exception.code, PLAN_COMPLETE)

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

    def test_rejects_a_versioned_acceptance_execution_contract(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "plan.md"
            content = plan_text("1" * 16).replace(
                '"closures"',
                '"schemaVersion": 1,\n  "closures"',
                1,
            )
            path.write_text(content, encoding="utf-8")

            with self.assertRaisesRegex(
                ExecutionPlanError,
                "must not declare a workflow version",
            ) as raised:
                load_formal_plan(path)

        self.assertEqual(raised.exception.code, PLAN_INVALID)

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

    def test_active_plan_discovery_requires_an_explicit_plan(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaises(ExecutionPlanError) as missing:
                discover_active_plan(root)

        self.assertEqual(missing.exception.code, PLAN_INPUT_REQUIRED)


if __name__ == "__main__":
    unittest.main()
