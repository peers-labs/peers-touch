"""Resolve the one active formal execution plan for a Git worktree."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ACTIVE_PLAN_REQUIRED = "EXECUTION_PLAN_REQUIRED"
MULTIPLE_ACTIVE_PLANS = "MULTIPLE_ACTIVE_EXECUTION_PLANS"
PLAN_INVALID = "EXECUTION_PLAN_INVALID"
PLAN_COMPLETE = "EXECUTION_PLAN_COMPLETE"
PLAN_BLOCKED = "EXECUTION_PLAN_BLOCKED"
PLAN_DRIFT = "ACCEPTANCE_PLAN_DRIFT"

_METADATA = re.compile(r"^>\s+\*\*(?P<key>[^*]+)\*\*:\s*(?P<value>.+?)\s*$")
_ACCEPTANCE_SECTION = re.compile(
    r"^##\s+(?:\d+(?:\.\d+)*\.?\s+)?Acceptance Execution\s*$",
    re.MULTILINE,
)
_JSON_BLOCK = re.compile(r"```json\s*(?P<body>\{.*?\})\s*```", re.DOTALL)


class ExecutionPlanError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class FormalExecutionPlan:
    path: Path
    plan_format: str
    status: str
    branch: str
    workspace_id: str
    initial_head: str
    current_task_id: str | None
    current_task_path: str | None
    current_closure: str | None
    closure_statuses: dict[str, str]
    acceptance: dict[str, Any]

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


def _metadata(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in text.splitlines():
        match = _METADATA.match(line)
        if not match:
            continue
        values[match.group("key").strip()] = match.group("value").strip().strip("`")
    return values


def _acceptance_contract(text: str, path: Path) -> dict[str, Any]:
    section = _ACCEPTANCE_SECTION.search(text)
    if not section:
        raise ExecutionPlanError(
            PLAN_INVALID,
            f"active plan has no Acceptance Execution section: {path}",
        )
    block = _JSON_BLOCK.search(text, section.end())
    if not block:
        raise ExecutionPlanError(
            PLAN_INVALID,
            f"active plan has no JSON Acceptance Execution contract: {path}",
        )
    try:
        value = json.loads(block.group("body"))
    except json.JSONDecodeError as error:
        raise ExecutionPlanError(
            PLAN_INVALID,
            f"invalid Acceptance Execution JSON in {path}: {error}",
        ) from error
    if value.get("schemaVersion") != 1:
        raise ExecutionPlanError(PLAN_INVALID, "unsupported Acceptance Execution schema")
    closures = value.get("closures")
    if not isinstance(closures, dict) or not closures:
        raise ExecutionPlanError(PLAN_INVALID, "Acceptance closures must be non-empty")
    for label, gates in [*closures.items(), ("completion", value.get("completion")), ("full", value.get("full"))]:
        if (
            not isinstance(gates, list)
            or any(not isinstance(gate, str) or not gate for gate in gates)
            or len(gates) != len(set(gates))
        ):
            raise ExecutionPlanError(
                PLAN_INVALID,
                f"Acceptance gate list {label!r} must contain unique non-empty IDs",
            )
    return value


def _closure_statuses(
    text: str,
    closures: dict[str, Any],
    path: Path,
) -> tuple[str | None, dict[str, str]]:
    current: list[str] = []
    statuses: dict[str, str] = {}
    for line in text.splitlines():
        if not line.lstrip().startswith("|"):
            continue
        columns = [value.strip() for value in line.strip().strip("|").split("|")]
        closure_tokens = columns[0].split(maxsplit=1) if columns else []
        closure_id = closure_tokens[0] if closure_tokens else ""
        if len(columns) < 2 or closure_id not in closures:
            continue
        status = columns[1].lower()
        statuses[closure_id] = status
        if "in progress" in status or "进行中" in status:
            current.append(closure_id)
    missing = sorted(set(closures) - set(statuses))
    if missing:
        raise ExecutionPlanError(
            PLAN_INVALID,
            f"Acceptance closures are missing from Implementation Status: {missing}",
        )
    if len(current) > 1:
        raise ExecutionPlanError(
            PLAN_INVALID,
            f"active plan has multiple in-progress closures: {current}: {path}",
        )
    if not current and not all(
        status.startswith("completed") for status in statuses.values()
    ):
        raise ExecutionPlanError(
            PLAN_INVALID,
            f"active plan has no in-progress closure and is not complete: {path}",
        )
    return (current[0] if current else None), statuses


def _is_package_manifest(text: str) -> bool:
    return bool(
        re.search(
            r'"kind"\s*:\s*"peers-touch-plan-package"',
            text,
        )
    )


def _package_status(path: Path) -> dict[str, Any]:
    try:
        repository_root = Path(_git(path.parent, "rev-parse", "--show-toplevel"))
    except ExecutionPlanError as error:
        raise ExecutionPlanError(
            PLAN_INVALID,
            f"cannot resolve repository for Plan Package {path}: {error}",
        ) from error
    planctl = repository_root / "tooling" / "scripts" / "plan" / "planctl.mjs"
    if not planctl.is_file():
        raise ExecutionPlanError(
            PLAN_INVALID,
            f"Plan Package parser is missing: {planctl}",
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
        raise ExecutionPlanError(code, message or f"Plan Package validation failed: {path}")
    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise ExecutionPlanError(
            PLAN_INVALID,
            f"Plan Package parser returned invalid JSON for {path}: {error}",
        ) from error
    if not isinstance(payload, dict) or payload.get("ok") is not True:
        raise ExecutionPlanError(
            PLAN_INVALID,
            f"Plan Package parser returned an invalid result for {path}",
        )
    return payload


def _load_package_plan(path: Path) -> FormalExecutionPlan:
    payload = _package_status(path)
    acceptance = payload.get("acceptance")
    if not isinstance(acceptance, dict):
        acceptance = {
            "schemaVersion": 1,
            "closures": payload.get("closures"),
            "completion": payload.get("completion"),
            "full": payload.get("full"),
        }
    closures = acceptance.get("closures")
    closure_statuses = payload.get("closureStatuses", payload.get("closures"))
    if not isinstance(closures, dict) or not isinstance(closure_statuses, dict):
        raise ExecutionPlanError(
            PLAN_INVALID,
            f"Plan Package status omitted Acceptance closures: {path}",
        )
    current_task_id = payload.get("currentTaskId")
    current_task_path = payload.get("currentTaskPath")
    current_closure = payload.get("currentClosure")
    for field, value in (
        ("currentTaskId", current_task_id),
        ("currentTaskPath", current_task_path),
        ("currentClosure", current_closure),
    ):
        if value is not None and (not isinstance(value, str) or not value):
            raise ExecutionPlanError(PLAN_INVALID, f"{field} is invalid: {path}")
    required_text = {
        "status": payload.get("status"),
        "branch": payload.get("branch"),
        "workspaceId": payload.get("workspaceId"),
        "initialHead": payload.get("initialHead"),
    }
    missing = [field for field, value in required_text.items() if not value]
    if missing:
        raise ExecutionPlanError(
            PLAN_INVALID,
            f"Plan Package status omitted fields: {', '.join(missing)}",
        )
    return FormalExecutionPlan(
        path=path,
        plan_format="package",
        status=required_text["status"],
        branch=required_text["branch"],
        workspace_id=required_text["workspaceId"],
        initial_head=required_text["initialHead"],
        current_task_id=current_task_id,
        current_task_path=current_task_path,
        current_closure=current_closure,
        closure_statuses=dict(closure_statuses),
        acceptance=acceptance,
    )


def load_formal_plan(path: Path) -> FormalExecutionPlan:
    resolved = path.resolve(strict=True)
    text = resolved.read_text(encoding="utf-8")
    if _is_package_manifest(text):
        return _load_package_plan(resolved)
    metadata = _metadata(text)
    required = ["Status", "Branch", "Workspace ID", "Initial HEAD"]
    missing = [key for key in required if not metadata.get(key)]
    if missing:
        raise ExecutionPlanError(
            PLAN_INVALID,
            f"execution plan metadata is missing: {', '.join(missing)}",
        )
    if not re.fullmatch(r"[0-9a-f]{16}", metadata["Workspace ID"]):
        raise ExecutionPlanError(
            PLAN_INVALID,
            "execution plan Workspace ID must be 16 lowercase hex characters",
        )
    if not re.fullmatch(r"[0-9a-f]{40}", metadata["Initial HEAD"]):
        raise ExecutionPlanError(
            PLAN_INVALID,
            "execution plan Initial HEAD must be a full lowercase commit",
        )
    acceptance = _acceptance_contract(text, resolved)
    current, statuses = _closure_statuses(
        text,
        acceptance["closures"],
        resolved,
    )
    return FormalExecutionPlan(
        path=resolved,
        plan_format="legacy",
        status=metadata["Status"],
        branch=metadata["Branch"],
        workspace_id=metadata["Workspace ID"],
        initial_head=metadata["Initial HEAD"],
        current_task_id=None,
        current_task_path=None,
        current_closure=current,
        closure_statuses=statuses,
        acceptance=acceptance,
    )


def discover_active_plan(
    root: Path,
    *,
    branch: str | None = None,
    validate_workspace: bool = True,
) -> FormalExecutionPlan:
    canonical = root.resolve(strict=True)
    selected_branch = branch or _git(
        canonical,
        "symbolic-ref",
        "--quiet",
        "--short",
        "HEAD",
    )
    expected_workspace = workspace_id(canonical)
    candidates: list[FormalExecutionPlan] = []
    discovered_paths = {
        path.resolve()
        for pattern in (
            "**/execution-plans/*.md",
            "**/execution-plans/*/plan.md",
        )
        for path in (canonical / "docs").glob(pattern)
    }
    for path in sorted(discovered_paths):
        text = path.read_text(encoding="utf-8")
        metadata = _metadata(text)
        status = metadata.get("Status", "").lower()
        if not (status.startswith("active") or status == "blocked"):
            continue
        if metadata.get("Branch") != selected_branch:
            continue
        if "Workspace ID" not in metadata:
            continue
        plan = load_formal_plan(path)
        if validate_workspace and plan.workspace_id != expected_workspace:
            raise ExecutionPlanError(
                PLAN_INVALID,
                f"active plan workspace does not match current worktree: {path}",
            )
        candidates.append(plan)
    if not candidates:
        raise ExecutionPlanError(
            ACTIVE_PLAN_REQUIRED,
            f"no active formal execution plan matches branch {selected_branch!r}",
        )
    if len(candidates) > 1:
        raise ExecutionPlanError(
            MULTIPLE_ACTIVE_PLANS,
            "multiple active formal execution plans match the current worktree: "
            + ", ".join(str(plan.path) for plan in candidates),
        )
    return candidates[0]


def changed_paths_for_plan(root: Path, plan: FormalExecutionPlan) -> list[str]:
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
    return sorted(paths)
