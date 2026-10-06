"""Resolve the stable formal Plan mounted to a Git worktree."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any


PLAN_INPUT_REQUIRED = "EXECUTION_PLAN_INPUT_REQUIRED"
PLAN_BINDING_REQUIRED = "PLAN_MOUNT_REQUIRED"
PLAN_BINDING_MISMATCH = "PLAN_MOUNT_IDENTITY_MISMATCH"
PLAN_INVALID = "EXECUTION_PLAN_INVALID"
PLAN_COMPLETE = "EXECUTION_PLAN_COMPLETE"
PLAN_BLOCKED = "EXECUTION_PLAN_BLOCKED"
PLAN_DRIFT = "ACCEPTANCE_PLAN_DRIFT"

class ExecutionPlanError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class FormalExecutionPlan:
    path: Path
    plan_id: str | None
    plan_format: str
    status: str
    branch: str
    workspace_id: str
    initial_head: str
    current_task_id: str | None
    current_task_path: str | None
    current_task_write_set: tuple[str, ...] | None
    current_closure: str | None
    closure_statuses: dict[str, str]
    acceptance: dict[str, Any]
    source_claims: tuple[str, ...] | None = None

    def gate_ids(self, mode: str) -> list[str]:
        if mode == "closure":
            if self.current_closure is None:
                if self.status == "blocked":
                    raise ExecutionPlanError(
                        PLAN_BLOCKED,
                        "execution plan is blocked and has no current task",
                    )
                raise ExecutionPlanError(
                    PLAN_COMPLETE,
                    "execution plan is complete and has no current closure",
                )
            values = self.acceptance["closures"][self.current_closure]
        else:
            values = self.acceptance[mode]
        return list(values)

    def all_declared_gate_ids(self) -> set[str]:
        gates = set(self.acceptance["completion"]) | set(self.acceptance["full"])
        for values in self.acceptance["closures"].values():
            gates.update(values)
        return gates


def closure_status_is_complete(status: str) -> bool:
    return status == "done" or status.startswith("completed")


def _git(root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(root), *args],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise ExecutionPlanError(
            PLAN_INVALID,
            f"git {' '.join(args)} failed: {result.stderr.strip()}",
        )
    return result.stdout.strip()


def workspace_id(root: Path) -> str:
    canonical = str(root.resolve(strict=True))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def _is_plan(text: str) -> bool:
    return bool(
        re.search(
            r'"kind"\s*:\s*"peers-touch-plan"',
            text,
        )
    )


def _mounted_plan_status(path: Path) -> dict[str, Any]:
    try:
        repository_root = Path(_git(path.parent, "rev-parse", "--show-toplevel"))
    except ExecutionPlanError as error:
        raise ExecutionPlanError(
            PLAN_INVALID,
            f"cannot resolve repository for Plan {path}: {error}",
        ) from error
    planctl = repository_root / "tooling" / "scripts" / "plan" / "planctl.mjs"
    if not planctl.is_file():
        raise ExecutionPlanError(
            PLAN_INVALID,
            f"Plan parser is missing: {planctl}",
        )
    completed = subprocess.run(
        [
            "node",
            str(planctl),
            "status",
            "--plan",
            str(path),
            "--repo-root",
            str(repository_root),
        ],
        cwd=repository_root,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        payload: dict[str, Any] = {}
        try:
            payload = json.loads(completed.stderr)
        except json.JSONDecodeError:
            pass
        error = payload.get("error", payload)
        code = error.get("code", PLAN_INVALID)
        message = error.get("message") or completed.stderr.strip() or completed.stdout.strip()
        raise ExecutionPlanError(code, message or f"Plan validation failed: {path}")
    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise ExecutionPlanError(
            PLAN_INVALID,
            f"Plan parser returned invalid JSON for {path}: {error}",
        ) from error
    if not isinstance(payload, dict) or payload.get("ok") is not True:
        raise ExecutionPlanError(
            PLAN_INVALID,
            f"Plan parser returned an invalid result for {path}",
        )
    return payload


def _load_plan(path: Path) -> FormalExecutionPlan:
    payload = _mounted_plan_status(path)
    acceptance = payload.get("acceptance")
    if not isinstance(acceptance, dict):
        acceptance = {
            "closures": payload.get("closures"),
            "completion": payload.get("completion"),
            "full": payload.get("full"),
        }
    closures = acceptance.get("closures")
    closure_statuses = payload.get("closureStatuses", payload.get("closures"))
    if not isinstance(closures, dict) or not isinstance(closure_statuses, dict):
        raise ExecutionPlanError(
            PLAN_INVALID,
            f"Plan status omitted Acceptance closures: {path}",
        )
    current_task_id = payload.get("currentTaskId")
    current_task_path = payload.get("currentTaskPath")
    current_task_write_set = payload.get("currentTaskWriteSet")
    current_closure = payload.get("currentClosure")
    for field, value in (
        ("currentTaskId", current_task_id),
        ("currentTaskPath", current_task_path),
        ("currentClosure", current_closure),
    ):
        if value is not None and (not isinstance(value, str) or not value):
            raise ExecutionPlanError(PLAN_INVALID, f"{field} is invalid: {path}")
    if (
        not isinstance(current_task_write_set, list)
        or any(not isinstance(item, str) or not item for item in current_task_write_set)
    ):
        raise ExecutionPlanError(
            PLAN_INVALID,
            f"currentTaskWriteSet is invalid: {path}",
        )
    required_text = {
        "planId": payload.get("planId"),
        "status": payload.get("status"),
        "branch": payload.get("branch"),
        "workspaceId": payload.get("workspaceId"),
        "initialHead": payload.get("initialHead"),
    }
    missing = [field for field, value in required_text.items() if not value]
    if missing:
        raise ExecutionPlanError(
            PLAN_INVALID,
            f"Plan status omitted fields: {', '.join(missing)}",
        )
    source_claims = payload.get("sourceClaims")
    if (
        not isinstance(source_claims, list)
        or not source_claims
        or any(
            not isinstance(claim, dict)
            or not isinstance(claim.get("pathPrefix"), str)
            or not claim["pathPrefix"]
            for claim in source_claims
        )
    ):
        raise ExecutionPlanError(
            PLAN_INVALID,
            f"Plan status omitted valid source claims: {path}",
        )
    return FormalExecutionPlan(
        path=path,
        plan_id=required_text["planId"],
        plan_format="stable",
        status=required_text["status"],
        branch=required_text["branch"],
        workspace_id=required_text["workspaceId"],
        initial_head=required_text["initialHead"],
        current_task_id=current_task_id,
        current_task_path=current_task_path,
        current_task_write_set=tuple(current_task_write_set),
        current_closure=current_closure,
        closure_statuses=dict(closure_statuses),
        acceptance=acceptance,
        source_claims=tuple(claim["pathPrefix"] for claim in source_claims),
    )


def load_formal_plan(path: Path) -> FormalExecutionPlan:
    resolved = path.resolve(strict=True)
    text = resolved.read_text(encoding="utf-8")
    if not _is_plan(text):
        raise ExecutionPlanError(
            PLAN_INVALID,
            f"execution plan does not use the current stable Plan contract: {resolved}",
        )
    return _load_plan(resolved)


def _workspace_plan_mount(root: Path) -> dict[str, str]:
    script = root / "tooling" / "scripts" / "plan" / "plan-mount.mjs"
    if not script.is_file():
        raise ExecutionPlanError(
            PLAN_BINDING_REQUIRED,
            f"workspace Plan mount resolver is missing: {script}",
        )
    completed = subprocess.run(
        [
            "node",
            str(script),
            "status",
            "--repo-root",
            str(root),
        ],
        cwd=root,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        payload: dict[str, Any] = {}
        try:
            payload = json.loads(completed.stderr)
        except json.JSONDecodeError:
            pass
        error = payload.get("error", payload)
        raise ExecutionPlanError(
            error.get("code", PLAN_BINDING_REQUIRED),
            error.get("message")
            or completed.stderr.strip()
            or "workspace Plan mount is unavailable",
        )
    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise ExecutionPlanError(
            PLAN_INVALID,
            f"workspace Plan mount resolver returned invalid JSON: {error}",
        ) from error
    mount = payload.get("mount")
    if (
        payload.get("ok") is not True
        or not isinstance(mount, dict)
        or not isinstance(mount.get("planId"), str)
        or not mount["planId"]
        or not isinstance(mount.get("planPath"), str)
        or not mount["planPath"]
    ):
        raise ExecutionPlanError(
            PLAN_INVALID,
            "workspace Plan mount resolver returned an invalid result",
        )
    return {
        "planId": mount["planId"],
        "planPath": mount["planPath"],
    }


def discover_active_plan(
    root: Path,
    *,
    branch: str | None = None,
    validate_workspace: bool = True,
) -> FormalExecutionPlan:
    canonical = root.resolve(strict=True)
    mount = _workspace_plan_mount(canonical)
    try:
        path = (canonical / mount["planPath"]).resolve(strict=True)
        path.relative_to(canonical)
    except (FileNotFoundError, ValueError) as error:
        raise ExecutionPlanError(
            PLAN_BINDING_MISMATCH,
            "mounted Plan path is missing or outside the current worktree",
        ) from error
    plan = load_formal_plan(path)
    if plan.plan_format != "stable" or plan.plan_id != mount["planId"]:
        raise ExecutionPlanError(
            PLAN_BINDING_MISMATCH,
            "mounted Plan identity does not match the Plan",
        )
    selected_branch = branch or _git(
        canonical,
        "symbolic-ref",
        "--quiet",
        "--short",
        "HEAD",
    )
    if plan.branch != selected_branch:
        raise ExecutionPlanError(
            PLAN_BINDING_MISMATCH,
            "bound Plan branch does not match the current worktree",
        )
    if validate_workspace and plan.workspace_id != workspace_id(canonical):
        raise ExecutionPlanError(
            PLAN_BINDING_MISMATCH,
            "bound Plan workspace does not match the current worktree",
        )
    return plan


def changed_paths_for_plan(
    root: Path,
    plan: FormalExecutionPlan,
    execution_mode: str = "closure",
) -> list[str]:
    paths = set(
        line
        for line in _git(root, "diff", "--name-only", f"{plan.initial_head}..HEAD").splitlines()
        if line
    )
    for args in (
        ("diff", "--name-only"),
        ("ls-files", "--others", "--exclude-standard"),
    ):
        paths.update(line for line in _git(root, *args).splitlines() if line)
    scope = (
        plan.current_task_write_set
        if execution_mode == "closure" and plan.current_task_write_set is not None
        else plan.source_claims
    )
    if scope is not None:
        prefixes = tuple(prefix.rstrip("/") for prefix in scope)
        paths = {
            changed
            for changed in paths
            if any(
                changed == prefix or changed.startswith(f"{prefix}/")
                for prefix in prefixes
            )
        }
    return sorted(paths)
