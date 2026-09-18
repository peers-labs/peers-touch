#!/usr/bin/env python3
"""Resolve the explicit Plan Package list declared in a pull request body."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path, PurePosixPath


SECTION = "## Execution Plans / 执行计划"
PLAN_ITEM = re.compile(r"^-\s+`([^`]+)`\s*$")


class PlanInputError(ValueError):
    pass


def _validate_plan_path(value: str, repo_root: Path) -> str:
    if (
        not value
        or "\\" in value
        or "\0" in value
        or value.startswith("/")
    ):
        raise PlanInputError(f"invalid execution Plan path: {value!r}")
    candidate = PurePosixPath(value)
    if (
        candidate.name != "plan.md"
        or any(part in {"", ".", ".."} for part in candidate.parts)
    ):
        raise PlanInputError(f"invalid execution Plan path: {value!r}")
    resolved = (repo_root / Path(*candidate.parts)).resolve(strict=True)
    try:
        resolved.relative_to(repo_root.resolve(strict=True))
    except ValueError as error:
        raise PlanInputError(
            f"execution Plan escapes the repository: {value!r}",
        ) from error
    if not resolved.is_file():
        raise PlanInputError(f"execution Plan is not a file: {value!r}")
    return candidate.as_posix()


def extract_plan_paths(body: str, repo_root: Path) -> list[str]:
    sections = [index for index, line in enumerate(body.splitlines()) if line.strip() == SECTION]
    if len(sections) != 1:
        raise PlanInputError(
            "pull request body must contain exactly one Execution Plans section",
        )

    paths: list[str] = []
    lines = body.splitlines()
    for line in lines[sections[0] + 1 :]:
        stripped = line.strip()
        if stripped.startswith("## "):
            break
        if not stripped or stripped.startswith("<!--"):
            continue
        match = PLAN_ITEM.fullmatch(stripped)
        if not match:
            raise PlanInputError(
                "Execution Plans section accepts only '- `path/to/plan.md`' entries",
            )
        paths.append(_validate_plan_path(match.group(1), repo_root))

    if not paths:
        raise PlanInputError("Execution Plans section must declare at least one Plan")
    if len(paths) != len(set(paths)):
        raise PlanInputError("Execution Plans section contains duplicate Plan paths")
    return paths


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--event", type=Path, required=True)
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    args = parser.parse_args()

    try:
        event = json.loads(args.event.read_text(encoding="utf-8"))
        body = event["pull_request"]["body"]
        if not isinstance(body, str):
            raise PlanInputError("pull request body is missing")
        paths = extract_plan_paths(body, args.repo_root)
    except (OSError, json.JSONDecodeError, KeyError, PlanInputError) as error:
        print(f"PR_EXECUTION_PLAN_INPUT_INVALID: {error}", file=sys.stderr)
        return 2

    for plan in paths:
        print(plan)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
