"""Resolve the frozen Secure Content runtime source from W12D activation."""

from __future__ import annotations

import hashlib
import hmac
import json
import subprocess
from pathlib import Path
from typing import Any, Callable, Mapping, Optional

from tooling.scripts.plan_lifecycle_source import (
    PlanLifecycleProjection,
    PlanLifecycleSourceError,
    validate_plan_lifecycle_source,
)


PLAN_PATH = (
    "docs/architecture/secure-content/execution-plans/"
    "20260913-secure-content-hard-cut/plan.md"
)
AGGREGATE_KIND = "secure-content-schema-activation-aggregate"
AGGREGATE_TASK_ID = "W12D"
LEGACY_AGGREGATE_TASK_ID = "W12A"
SHA = frozenset("0123456789abcdef")


class SourceProjectionError(RuntimeError):
    pass


def _canonical_digest(value: Mapping[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(
            dict(value),
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()


def _is_commit(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 40
        and all(character in SHA for character in value)
    )


def _read_activation(path: Path, workspace_id: str) -> Optional[str]:
    if path.is_symlink() or not path.is_file():
        raise SourceProjectionError("activation aggregate is not a regular file")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SourceProjectionError("activation aggregate is unreadable") from error
    if not isinstance(value, dict):
        raise SourceProjectionError("activation aggregate is not an object")
    digest = value.get("result_digest")
    unsigned = dict(value)
    unsigned.pop("result_digest", None)
    generation = value.get("generation_id")
    task_id = value.get("task_id")
    workstream_id = value.get("workstream_id")
    if (
        value.get("kind") != AGGREGATE_KIND
        or value.get("workspace_id") != workspace_id
        or value.get("reset_intent") != "SCHEMA_ACTIVATION"
        or value.get("profiles") != ["four", "fiveArm"]
        or value.get("status") != "PASS"
        or value.get("claim") != "CANONICAL_SCHEMA_ACTIVE_ONLY"
        or not _is_commit(generation)
        or value.get("source_commit") != generation
        or path.parents[1].name != generation
        or not isinstance(digest, str)
        or not hmac.compare_digest(digest, _canonical_digest(unsigned))
    ):
        raise SourceProjectionError("activation aggregate identity is invalid")
    if (
        task_id == LEGACY_AGGREGATE_TASK_ID
        and workstream_id == LEGACY_AGGREGATE_TASK_ID
    ):
        return None
    if task_id != AGGREGATE_TASK_ID or workstream_id != AGGREGATE_TASK_ID:
        raise SourceProjectionError("activation aggregate identity is invalid")
    return generation


def _is_ancestor(repo_root: Path, ancestor: str, descendant: str) -> bool:
    return (
        subprocess.run(
            ["git", "merge-base", "--is-ancestor", ancestor, descendant],
            cwd=repo_root,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        ).returncode
        == 0
    )


def _distance(repo_root: Path, ancestor: str, descendant: str) -> int:
    completed = subprocess.run(
        ["git", "rev-list", "--count", f"{ancestor}..{descendant}"],
        cwd=repo_root,
        check=True,
        capture_output=True,
        text=True,
    )
    return int(completed.stdout.strip())


def resolve_runtime_source_identity(
    *,
    repo_root: Path,
    result_root: Path,
    control_identity: Mapping[str, str],
    projection_validator: Callable[..., PlanLifecycleProjection] = (
        validate_plan_lifecycle_source
    ),
    ancestor_checker: Callable[[Path, str, str], bool] = _is_ancestor,
    distance: Callable[[Path, str, str], int] = _distance,
) -> dict[str, str | int]:
    root = repo_root.resolve(strict=True)
    control_head = control_identity.get("head")
    workspace_id = control_identity.get("workspaceId")
    if not _is_commit(control_head) or not isinstance(workspace_id, str):
        raise SourceProjectionError("control source identity is invalid")
    candidates: list[tuple[int, str]] = []
    activation_root = result_root / "W12A" / "activation"
    for path in sorted(activation_root.glob("*/aggregate/result.json")):
        generation = _read_activation(path, workspace_id)
        if generation is None:
            continue
        if ancestor_checker(root, generation, control_head):
            candidates.append((distance(root, generation, control_head), generation))
    if not candidates:
        raise SourceProjectionError(
            "no completed W12A activation is an ancestor of the control HEAD"
        )
    candidates.sort()
    nearest_distance = candidates[0][0]
    nearest = [
        generation
        for candidate_distance, generation in candidates
        if candidate_distance == nearest_distance
    ]
    if len(nearest) != 1:
        raise SourceProjectionError(
            "completed W12A activation source is ambiguous"
        )
    runtime_source = nearest[0]
    try:
        projection = projection_validator(
            repo_root=root,
            plan_path=PLAN_PATH,
            runtime_source_commit=runtime_source,
            control_head=control_head,
        )
    except PlanLifecycleSourceError as error:
        raise SourceProjectionError(str(error)) from error
    projected = dict(control_identity)
    projected.update(
        {
            "head": runtime_source,
            "runtimeSourceCommit": runtime_source,
            "controlHead": control_head,
            "transitionCount": projection.transition_count,
            "transitionDigest": projection.transition_digest,
        }
    )
    projected["worktreeSetDigest"] = hashlib.sha256(
        json.dumps(
            {
                "branch": projected.get("branch"),
                "controlHead": control_head,
                "head": runtime_source,
                "root": str(root),
                "transitionDigest": projection.transition_digest,
                "workspaceId": workspace_id,
            },
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()
    return projected
