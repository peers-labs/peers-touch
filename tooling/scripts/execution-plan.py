#!/usr/bin/env python3
"""Inspect and validate the formal execution plan bound to this worktree."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core.execution_plan import (  # noqa: E402
    PLAN_BINDING_REQUIRED,
    PLAN_INPUT_REQUIRED,
    PLAN_INVALID,
    ExecutionPlanError,
    closure_status_is_complete,
    discover_active_plan,
    load_formal_plan,
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan")
    parser.add_argument("--branch")
    parser.add_argument("--ci", action="store_true")
    parser.add_argument("--require-complete", action="store_true")
    parser.add_argument("--allow-untracked", action="store_true")
    args = parser.parse_args()

    explicit_plan = args.plan or os.environ.get("PT_EXECUTION_PLAN")
    try:
        if args.ci and not explicit_plan:
            raise ExecutionPlanError(
                PLAN_INPUT_REQUIRED,
                "CI must provide --plan or PT_EXECUTION_PLAN; branch discovery is forbidden",
            )
        if explicit_plan:
            plan = load_formal_plan(Path(explicit_plan))
        else:
            plan = discover_active_plan(
                REPO_ROOT,
                branch=args.branch,
            )
        try:
            relative_plan = plan.path.relative_to(REPO_ROOT).as_posix()
        except ValueError as error:
            raise ExecutionPlanError(
                PLAN_INVALID,
                "execution Plan must resolve inside the repository",
            ) from error
        incomplete = {
            closure: status
            for closure, status in plan.closure_statuses.items()
            if not closure_status_is_complete(status)
        }
        if args.require_complete and incomplete:
            raise ExecutionPlanError(
                PLAN_INVALID,
                "execution plan is not complete: "
                + ", ".join(
                    f"{closure}={status}"
                    for closure, status in incomplete.items()
                ),
            )
    except ExecutionPlanError as error:
        if (
            args.allow_untracked
            and not args.ci
            and not explicit_plan
            and error.code == PLAN_BINDING_REQUIRED
        ):
            print(
                json.dumps(
                    {
                        "ok": True,
                        "tracked": False,
                        "plan": None,
                    },
                    indent=2,
                    sort_keys=True,
                )
            )
            return 0
        print(
            json.dumps(
                {"ok": False, "error": {"code": error.code, "message": str(error)}},
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 2

    print(
        json.dumps(
            {
                "ok": True,
                "tracked": True,
                "plan": relative_plan,
                "planId": plan.plan_id,
                "planFormat": plan.plan_format,
                "branch": plan.branch,
                "workspaceId": plan.workspace_id,
                "currentTaskId": plan.current_task_id,
                "currentTaskPath": plan.current_task_path,
                "currentClosure": plan.current_closure,
                "closures": plan.closure_statuses,
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
