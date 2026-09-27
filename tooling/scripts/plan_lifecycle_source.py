#!/usr/bin/env python3
"""Validate a frozen runtime source across Plan-only lifecycle commits."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence


GIT_COMMIT = re.compile(r"^[0-9a-f]{40}$")
PLAN_BLOCK = re.compile(
    r"(^## Plan Package\s*$\n+```json\s*$\n)([\s\S]*?)(\n```\s*$)",
    re.MULTILINE,
)


class PlanLifecycleSourceError(RuntimeError):
    pass


@dataclass(frozen=True)
class PlanLifecycleProjection:
    runtime_source_commit: str
    control_head: str
    transition_count: int
    transition_digest: str
    plan_path: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": "peers-touch-plan-lifecycle-source-projection",
            "runtimeSourceCommit": self.runtime_source_commit,
            "controlHead": self.control_head,
            "transitionCount": self.transition_count,
            "transitionDigest": self.transition_digest,
            "planPath": self.plan_path,
        }


def _canonical(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def _git(repo_root: Path, *arguments: str) -> str:
    completed = subprocess.run(
        ["git", *arguments],
        cwd=repo_root,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        diagnostic = (completed.stderr or completed.stdout).strip()
        raise PlanLifecycleSourceError(
            f"git {' '.join(arguments)} failed: {diagnostic}"
        )
    return completed.stdout


def _plan_at(repo_root: Path, commit: str, plan_path: str) -> tuple[dict[str, Any], str]:
    document = _git(repo_root, "show", f"{commit}:{plan_path}")
    match = PLAN_BLOCK.search(document)
    if match is None:
        raise PlanLifecycleSourceError(
            f"{commit} has no canonical Plan Package block"
        )
    try:
        manifest = json.loads(match.group(2))
    except json.JSONDecodeError as error:
        raise PlanLifecycleSourceError(
            f"{commit} Plan Package block is invalid JSON"
        ) from error
    if not isinstance(manifest, dict):
        raise PlanLifecycleSourceError(
            f"{commit} Plan Package block is not an object"
        )
    skeleton = document[: match.start(2)] + "<PLAN_PACKAGE>" + document[match.end(2) :]
    return manifest, skeleton


def _contract(manifest: Mapping[str, Any]) -> dict[str, Any]:
    value = copy.deepcopy(dict(manifest))
    value.pop("status", None)
    value.pop("exhaustion", None)
    tasks = value.get("tasks")
    if isinstance(tasks, list):
        for task in tasks:
            if isinstance(task, dict):
                task.pop("status", None)
                task.pop("blocker", None)
    return value


def _task_statuses(manifest: Mapping[str, Any]) -> dict[str, str]:
    tasks = manifest.get("tasks")
    if not isinstance(tasks, list):
        raise PlanLifecycleSourceError("Plan Package tasks are invalid")
    statuses: dict[str, str] = {}
    for task in tasks:
        if (
            not isinstance(task, dict)
            or not isinstance(task.get("id"), str)
            or not isinstance(task.get("status"), str)
            or task["id"] in statuses
        ):
            raise PlanLifecycleSourceError("Plan Package task lifecycle is invalid")
        statuses[task["id"]] = task["status"]
    return statuses


def _validate_handoff(
    before: Mapping[str, Any],
    after: Mapping[str, Any],
    *,
    commit: str,
) -> dict[str, Any]:
    before_statuses = _task_statuses(before)
    after_statuses = _task_statuses(after)
    if set(before_statuses) != set(after_statuses):
        raise PlanLifecycleSourceError(
            f"{commit} changes the Plan Task inventory"
        )
    current = [
        task_id
        for task_id, status in before_statuses.items()
        if status == "in_progress"
    ]
    if before.get("status") != "active" or len(current) != 1:
        raise PlanLifecycleSourceError(
            f"{commit} does not start from one active current Task"
        )
    completed_task = current[0]
    if after_statuses[completed_task] != "done":
        raise PlanLifecycleSourceError(
            f"{commit} does not complete the prior current Task"
        )
    changed = {
        task_id
        for task_id in before_statuses
        if before_statuses[task_id] != after_statuses[task_id]
    }
    next_tasks = [
        task_id
        for task_id, status in after_statuses.items()
        if status == "in_progress"
    ]
    if after.get("status") == "completed":
        if next_tasks or any(status != "done" for status in after_statuses.values()):
            raise PlanLifecycleSourceError(
                f"{commit} has an invalid completed Plan projection"
            )
        expected_changed = {completed_task}
        next_task = None
    elif after.get("status") == "active":
        if len(next_tasks) != 1:
            raise PlanLifecycleSourceError(
                f"{commit} does not select exactly one successor"
            )
        next_task = next_tasks[0]
        if before_statuses[next_task] != "pending":
            raise PlanLifecycleSourceError(
                f"{commit} successor was not pending"
            )
        expected_changed = {completed_task, next_task}
    else:
        raise PlanLifecycleSourceError(
            f"{commit} has an unsupported Plan lifecycle status"
        )
    if changed != expected_changed:
        raise PlanLifecycleSourceError(
            f"{commit} changes Task state outside one legal handoff"
        )
    return {
        "commit": commit,
        "completedTaskId": completed_task,
        "nextTaskId": next_task,
    }


def validate_plan_lifecycle_source(
    *,
    repo_root: Path,
    plan_path: str,
    runtime_source_commit: str,
    control_head: str,
) -> PlanLifecycleProjection:
    root = repo_root.resolve(strict=True)
    if (
        not GIT_COMMIT.fullmatch(runtime_source_commit)
        or not GIT_COMMIT.fullmatch(control_head)
    ):
        raise PlanLifecycleSourceError("source commits must be full Git hashes")
    candidate = (root / plan_path).resolve(strict=True)
    try:
        candidate.relative_to(root)
    except ValueError as error:
        raise PlanLifecycleSourceError("Plan path escapes the repository") from error
    relative_plan = candidate.relative_to(root).as_posix()
    _git(root, "cat-file", "-e", f"{runtime_source_commit}^{{commit}}")
    _git(root, "cat-file", "-e", f"{control_head}^{{commit}}")
    if runtime_source_commit == control_head:
        transitions: list[dict[str, Any]] = []
    else:
        ancestry = subprocess.run(
            [
                "git",
                "merge-base",
                "--is-ancestor",
                runtime_source_commit,
                control_head,
            ],
            cwd=root,
            check=False,
            capture_output=True,
            text=True,
        )
        if ancestry.returncode != 0:
            raise PlanLifecycleSourceError(
                "runtime source is not an ancestor of the control HEAD"
            )
        commits = [
            line
            for line in _git(
                root,
                "rev-list",
                "--reverse",
                "--ancestry-path",
                f"{runtime_source_commit}..{control_head}",
            ).splitlines()
            if line
        ]
        transitions = []
        previous = runtime_source_commit
        for commit in commits:
            parents = _git(root, "rev-list", "--parents", "-n", "1", commit).split()
            if parents != [commit, previous]:
                raise PlanLifecycleSourceError(
                    f"{commit} is not a linear Plan lifecycle commit"
                )
            changed_paths = [
                line
                for line in _git(
                    root,
                    "diff-tree",
                    "--no-commit-id",
                    "--name-only",
                    "-r",
                    previous,
                    commit,
                ).splitlines()
                if line
            ]
            if changed_paths != [relative_plan]:
                raise PlanLifecycleSourceError(
                    f"{commit} changes paths outside the bound Plan"
                )
            before, before_skeleton = _plan_at(root, previous, relative_plan)
            after, after_skeleton = _plan_at(root, commit, relative_plan)
            if before_skeleton != after_skeleton:
                raise PlanLifecycleSourceError(
                    f"{commit} changes Plan content outside lifecycle state"
                )
            if _canonical(_contract(before)) != _canonical(_contract(after)):
                raise PlanLifecycleSourceError(
                    f"{commit} changes the immutable Plan contract"
                )
            transitions.append(_validate_handoff(before, after, commit=commit))
            previous = commit
        if previous != control_head:
            raise PlanLifecycleSourceError(
                "Plan lifecycle history does not reach the control HEAD"
            )
    digest = hashlib.sha256(
        _canonical(
            {
                "runtimeSourceCommit": runtime_source_commit,
                "controlHead": control_head,
                "planPath": relative_plan,
                "transitions": transitions,
            }
        )
    ).hexdigest()
    return PlanLifecycleProjection(
        runtime_source_commit=runtime_source_commit,
        control_head=control_head,
        transition_count=len(transitions),
        transition_digest=digest,
        plan_path=relative_plan,
    )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate runtime source across Plan-only lifecycle commits",
    )
    parser.add_argument("--repo-root", required=True, type=Path)
    parser.add_argument("--plan", required=True)
    parser.add_argument("--runtime-source", required=True)
    parser.add_argument("--control-head", required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    try:
        result = validate_plan_lifecycle_source(
            repo_root=arguments.repo_root,
            plan_path=arguments.plan,
            runtime_source_commit=arguments.runtime_source,
            control_head=arguments.control_head,
        )
    except (OSError, PlanLifecycleSourceError) as error:
        print(
            json.dumps(
                {
                    "status": "BLOCKED",
                    "code": "PLAN_LIFECYCLE_SOURCE_INVALID",
                    "message": str(error),
                },
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 2
    print(json.dumps(result.to_dict(), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
