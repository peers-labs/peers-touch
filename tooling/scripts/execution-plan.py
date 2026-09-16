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
    PLAN_INVALID,
    ExecutionPlanError,
    discover_active_plan,
    load_formal_plan,
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan")
    parser.add_argument("--branch")
    parser.add_argument("--ci", action="store_true")
    parser.add_argument("--require-complete", action="store_true")
    args = parser.parse_args()

    try:
        if args.plan:
            plan = load_formal_plan(Path(args.plan))
        else:
            branch = args.branch or (
                os.environ.get("GITHUB_HEAD_REF") if args.ci else None
            )
            plan = discover_active_plan(
                REPO_ROOT,
                branch=branch,
                validate_workspace=not args.ci,
            )
        incomplete = {
            closure: status
            for closure, status in plan.closure_statuses.items()
            if not status.startswith("completed")
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
                "plan": plan.path.relative_to(REPO_ROOT).as_posix(),
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
