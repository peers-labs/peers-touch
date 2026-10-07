from __future__ import annotations

import hashlib
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from tooling.acceptance.core.execution_plan import (
    PLAN_BLOCKED,
    PLAN_BINDING_MISMATCH,
    PLAN_BINDING_REQUIRED,
    PLAN_INVALID,
    ExecutionPlanError,
    changed_paths_for_plan,
    closure_status_is_complete,
    discover_active_plan,
    load_formal_plan,
    workspace_id,
)


def stable_plan_text(
    workspace: str,
    *,
    branch: str = "feat/example",
    status: str = "active",
) -> str:
    return f"""# Example Plan

## Plan

```json
{{
  "kind": "peers-touch-plan"
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
    def test_completion_accepts_current_and_historical_completion_words(self) -> None:
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

    def test_stable_plan_projection_preserves_acceptance_closure(self) -> None:
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
                "kind": "peers-touch-plan",
                "planId": "DWF-PYTHON-INTEGRATION",
                "createdAt": "2026-10-06T00:00:00.000Z",
                "northStar": {
                    "objective": "Prove the Python adapter consumes the stable Plan.",
                    "successCriteria": [
                        {
                            "id": "DWF-PY-NS-01",
                            "statement": "The current closure remains available.",
                            "sourceRefs": ["DWF-D13"],
                        }
                    ],
                },
                "northStarApproval": None,
                "criterionCoverage": [
                    {
                        "criterionId": "DWF-PY-NS-01",
                        "taskIds": ["DWF-PY-01"],
                        "closureIds": ["development-workflow-control-plane"],
                        "gateIds": ["development-workflow-control-plane"],
                    }
                ],
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
                    }
                ],
                "authorization": {
                    "checkpoint": {
                        "localCommit": "denied",
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
                "amendments": [],
            }
            north_star_payload = {
                "kind": "peers-touch-north-star",
                "planId": manifest["planId"],
                "northStar": manifest["northStar"],
            }
            manifest["northStarApproval"] = {
                "northStarDigest": hashlib.sha256(
                    json.dumps(
                        north_star_payload,
                        sort_keys=True,
                        separators=(",", ":"),
                    ).encode("utf-8")
                ).hexdigest(),
                "approvedBy": "test-owner",
                "approvedAt": "2026-10-07T00:00:00.000Z",
                "decisionRef": "USER-DECISION-PYTHON-TEST",
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
                        f"> **Plan ID**: {manifest['planId']}",
                        f"> **Created**: {manifest['createdAt']}",
                        "",
                        "## Plan",
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
            with mock.patch(
                "tooling.acceptance.core.execution_plan._source_plan_status",
                return_value=status,
            ):
                plan = load_formal_plan(plan_path)

        self.assertEqual(plan.plan_format, "stable")
        self.assertEqual(plan.current_task_id, "DWF-PY-01")
        self.assertEqual(
            plan.gate_ids("closure"),
            ["development-workflow-control-plane"],
        )

    def test_loads_stable_plan_through_planctl_projection(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "plan.md"
            path.write_text(stable_plan_text("1" * 16), encoding="utf-8")

            with mock.patch(
                "tooling.acceptance.core.execution_plan._source_plan_status",
                return_value=mounted_plan_status("1" * 16),
            ):
                plan = load_formal_plan(path)

        self.assertEqual(plan.plan_format, "stable")
        self.assertEqual(plan.current_task_id, "T1")
        self.assertEqual(plan.current_task_path, "tasks/T1.md")
        self.assertEqual(
            plan.current_task_write_set,
            ("tooling/scripts/plan",),
        )
        self.assertEqual(plan.current_closure, "C1")
        self.assertEqual(plan.gate_ids("closure"), ["cheap-gate"])
        self.assertEqual(
            plan.source_claims,
            (
                "tooling/scripts/plan",
                "docs/architecture/engineering/development-workflow",
            ),
        )

    def test_repository_plan_validation_does_not_require_a_machine_mount(self) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        plan = load_formal_plan(
            repo_root
            / "docs"
            / "architecture"
            / "domains"
            / "agent"
            / "execution-plans"
            / "20261003-mcp-dual-runtime"
            / "plan.md"
        )

        self.assertEqual(plan.plan_id, "agent-mcp-dual-runtime-20261003")
        self.assertEqual(plan.status, "unverified")
        self.assertIsNone(plan.workspace_id)

    def test_stable_plan_changed_paths_are_limited_to_source_claims(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "plan.md"
            path.write_text(stable_plan_text("1" * 16), encoding="utf-8")
            with mock.patch(
                "tooling.acceptance.core.execution_plan._source_plan_status",
                return_value=mounted_plan_status("1" * 16),
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

        self.assertEqual(paths, ["tooling/scripts/plan/planctl.mjs"])

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

    def test_blocked_stable_plan_has_no_runnable_closure(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "plan.md"
            path.write_text(
                stable_plan_text("1" * 16, status="blocked"),
                encoding="utf-8",
            )

            with mock.patch(
                "tooling.acceptance.core.execution_plan._source_plan_status",
                return_value=mounted_plan_status(
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

    def test_rejects_legacy_plan_documents(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "plan.md"
            path.write_text(plan_text("1" * 16), encoding="utf-8")

            with self.assertRaisesRegex(
                ExecutionPlanError,
                "current stable Plan contract",
            ) as raised:
                load_formal_plan(path)

        self.assertEqual(raised.exception.code, PLAN_INVALID)

    def test_discovers_only_the_immutable_workspace_binding(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            plan_dir = (
                root / "docs" / "architecture" / "example" / "execution-plans"
            )
            plan_dir.mkdir(parents=True)
            expected_workspace = workspace_id(root)
            bound = plan_dir / "bound" / "plan.md"
            foreign = plan_dir / "foreign" / "plan.md"
            bound.parent.mkdir()
            foreign.parent.mkdir()
            bound.write_text(
                stable_plan_text(expected_workspace),
                encoding="utf-8",
            )
            foreign.write_text(
                stable_plan_text("2" * 16),
                encoding="utf-8",
            )

            with (
                mock.patch(
                    "tooling.acceptance.core.execution_plan._workspace_plan_mount",
                    return_value={
                        "planId": "BOUND-PLAN",
                        "planPath": bound.relative_to(root).as_posix(),
                    },
                ),
                mock.patch(
                    "tooling.acceptance.core.execution_plan._git",
                    return_value="feat/example",
                ),
                mock.patch(
                    "tooling.acceptance.core.execution_plan._mounted_plan_status",
                    return_value=mounted_plan_status(
                        expected_workspace,
                        plan_id="BOUND-PLAN",
                    ),
                ) as package_projection,
            ):
                result = discover_active_plan(root)

        self.assertEqual(result.path, bound.resolve())
        self.assertEqual(result.plan_id, "BOUND-PLAN")
        package_projection.assert_called_once_with(bound.resolve())

    def test_rejects_a_bound_plan_identity_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            expected_workspace = workspace_id(root)
            package_directory = (
                root
                / "docs"
                / "architecture"
                / "example"
                / "execution-plans"
                / "package"
            )
            package_directory.mkdir(parents=True)
            manifest = package_directory / "plan.md"
            manifest.write_text(
                stable_plan_text(expected_workspace),
                encoding="utf-8",
            )

            with (
                mock.patch(
                    "tooling.acceptance.core.execution_plan._workspace_plan_mount",
                    return_value={
                        "planId": "OTHER-PLAN",
                        "planPath": manifest.relative_to(root).as_posix(),
                    },
                ),
                mock.patch(
                    "tooling.acceptance.core.execution_plan._mounted_plan_status",
                    return_value=mounted_plan_status(
                        expected_workspace,
                        plan_id="BOUND-PLAN",
                    ),
                ),
            ):
                with self.assertRaises(ExecutionPlanError) as mismatch:
                    discover_active_plan(root, branch="feat/example")

        self.assertEqual(mismatch.exception.code, PLAN_BINDING_MISMATCH)

    def test_propagates_missing_workspace_binding(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with mock.patch(
                "tooling.acceptance.core.execution_plan._workspace_plan_mount",
                side_effect=ExecutionPlanError(
                    PLAN_BINDING_REQUIRED,
                    "workspace has no immutable Plan binding",
                ),
            ):
                with self.assertRaises(ExecutionPlanError) as missing:
                    discover_active_plan(root)

        self.assertEqual(missing.exception.code, PLAN_BINDING_REQUIRED)


if __name__ == "__main__":
    unittest.main()
