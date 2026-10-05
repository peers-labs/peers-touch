#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import io
import json
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("execution-plan.py")
SPEC = importlib.util.spec_from_file_location("execution_plan_cli", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"failed to load {SCRIPT}")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def tracked_plan(status: str) -> SimpleNamespace:
    return SimpleNamespace(
        path=(
            MODULE.REPO_ROOT
            / "docs/architecture/development-workflow/execution-plans/"
            "20261004-nonblocking-agent-integration/plan.md"
        ),
        plan_id="DWF-NONBLOCKING-INTEGRATION-20261004",
        plan_format="version",
        branch="fix/nonblocking-agent-integration",
        workspace_id="23d863a02a53c299",
        current_task_id=None,
        current_task_path=None,
        current_closure=None,
        closure_statuses={"native-plan-mount-cutover": status},
    )


class ExecutionPlanCliTests(unittest.TestCase):
    def run_cli(
        self,
        arguments: list[str],
        *,
        plan: SimpleNamespace | None = None,
        error: Exception | None = None,
    ) -> tuple[int, str, str]:
        stdout = io.StringIO()
        stderr = io.StringIO()
        if error is not None:
            resolver = patch.object(
                MODULE,
                "discover_active_plan",
                side_effect=error,
            )
        else:
            resolver = patch.object(
                MODULE,
                "discover_active_plan",
                return_value=plan,
            )
        with (
            resolver,
            patch.object(sys, "argv", [str(SCRIPT), *arguments]),
            redirect_stdout(stdout),
            redirect_stderr(stderr),
        ):
            result = MODULE.main()
        return result, stdout.getvalue(), stderr.getvalue()

    def test_allows_standalone_pr_when_mount_is_absent(self) -> None:
        result, stdout, stderr = self.run_cli(
            ["--require-complete", "--allow-untracked"],
            error=MODULE.ExecutionPlanError(
                MODULE.PLAN_BINDING_REQUIRED,
                "workspace has no live Plan mount",
            ),
        )

        self.assertEqual(result, 0, stderr)
        self.assertEqual(
            json.loads(stdout),
            {
                "ok": True,
                "plan": None,
                "tracked": False,
            },
        )

    def test_mount_absence_still_fails_without_explicit_opt_in(self) -> None:
        result, _stdout, stderr = self.run_cli(
            ["--require-complete"],
            error=MODULE.ExecutionPlanError(
                MODULE.PLAN_BINDING_REQUIRED,
                "workspace has no live Plan mount",
            ),
        )

        self.assertEqual(result, 2)
        self.assertEqual(
            json.loads(stderr)["error"]["code"],
            MODULE.PLAN_BINDING_REQUIRED,
        )

    def test_ci_cannot_use_standalone_mode_without_explicit_plan(self) -> None:
        result, _stdout, stderr = self.run_cli(
            ["--ci", "--allow-untracked"],
        )

        self.assertEqual(result, 2)
        self.assertEqual(
            json.loads(stderr)["error"]["code"],
            MODULE.PLAN_INPUT_REQUIRED,
        )

    def test_mount_identity_failure_cannot_select_standalone_mode(self) -> None:
        result, _stdout, stderr = self.run_cli(
            ["--require-complete", "--allow-untracked"],
            error=MODULE.ExecutionPlanError(
                MODULE.PLAN_INVALID,
                "mounted Plan identity is invalid",
            ),
        )

        self.assertEqual(result, 2)
        self.assertEqual(
            json.loads(stderr)["error"]["code"],
            MODULE.PLAN_INVALID,
        )

    def test_incomplete_tracked_plan_cannot_downgrade_to_standalone(self) -> None:
        result, _stdout, stderr = self.run_cli(
            ["--require-complete", "--allow-untracked"],
            plan=tracked_plan("in_progress"),
        )

        self.assertEqual(result, 2)
        self.assertEqual(
            json.loads(stderr)["error"]["code"],
            MODULE.PLAN_INVALID,
        )

    def test_reports_tracked_mode_for_complete_mounted_plan(self) -> None:
        result, stdout, stderr = self.run_cli(
            ["--require-complete", "--allow-untracked"],
            plan=tracked_plan("done"),
        )

        self.assertEqual(result, 0, stderr)
        self.assertIs(json.loads(stdout)["tracked"], True)


if __name__ == "__main__":
    unittest.main()
