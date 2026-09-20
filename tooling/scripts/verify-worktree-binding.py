#!/usr/bin/env python3
"""Verify that the current Git worktree matches an expected identity."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import NoReturn


MISMATCH = "WORKTREE_IDENTITY_MISMATCH"
UNAVAILABLE = "WORKTREE_IDENTITY_UNAVAILABLE"


class IdentityUnavailableError(RuntimeError):
    """Raised when the worktree identity cannot be determined."""


def emit(value: dict[str, object]) -> None:
    print(json.dumps(value, sort_keys=True, separators=(",", ":")))


def fail(code: str, message: str) -> NoReturn:
    emit({"error": {"code": code, "message": message}})
    raise SystemExit(1)


def run_git(root: Path, *args: str) -> str:
    try:
        result = subprocess.run(
            ["git", "-C", str(root), *args],
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError as error:
        raise IdentityUnavailableError("unable to execute git") from error

    if result.returncode != 0:
        raise IdentityUnavailableError(
            f"git {' '.join(args)} failed with exit code {result.returncode}"
        )
    return result.stdout


def canonical_path(path: Path, description: str) -> Path:
    try:
        return path.resolve(strict=True)
    except OSError as error:
        raise IdentityUnavailableError(
            f"unable to resolve {description}"
        ) from error


def canonical_git_path(root: Path, value: str, description: str) -> Path:
    path = Path(value)
    if not path.is_absolute():
        path = root / path
    return canonical_path(path, description)


def current_branch(root: Path) -> str:
    try:
        result = subprocess.run(
            ["git", "-C", str(root), "symbolic-ref", "--quiet", "--short", "HEAD"],
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError as error:
        raise IdentityUnavailableError("unable to execute git") from error

    if result.returncode == 1:
        fail(MISMATCH, "detached HEAD is not a valid worktree binding")
    if result.returncode != 0:
        raise IdentityUnavailableError(
            "git symbolic-ref failed with "
            f"exit code {result.returncode}"
        )

    branch = result.stdout.strip()
    if not branch:
        raise IdentityUnavailableError("git returned an empty branch")
    return branch


def inspect_identity(requested_root: Path) -> dict[str, str]:
    if not requested_root.is_absolute():
        fail(MISMATCH, "requested root must be an absolute path")
    root = canonical_path(requested_root, "requested root")
    cwd = canonical_path(Path.cwd(), "current working directory")
    if cwd != root:
        fail(MISMATCH, "current working directory is not the bound worktree root")
    toplevel_output = run_git(root, "rev-parse", "--show-toplevel")
    toplevel = canonical_path(
        Path(toplevel_output.strip()),
        "git toplevel",
    )
    if root != toplevel:
        fail(MISMATCH, "requested root is not the canonical git toplevel")

    branch = current_branch(root)
    head_output = run_git(root, "rev-parse", "HEAD")
    git_dir_output = run_git(root, "rev-parse", "--git-dir")
    common_dir_output = run_git(root, "rev-parse", "--git-common-dir")

    root_text = str(root)
    return {
        "root": root_text,
        "branch": branch,
        "workspaceId": hashlib.sha256(root_text.encode("utf-8")).hexdigest()[:16],
        "head": head_output.strip(),
        "gitDir": str(
            canonical_git_path(root, git_dir_output.strip(), "git directory")
        ),
        "commonDir": str(
            canonical_git_path(
                root,
                common_dir_output.strip(),
                "git common directory",
            )
        ),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--capture", action="store_true")
    parser.add_argument("--branch")
    parser.add_argument("--workspace-id")
    parser.add_argument("--head")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        identity = inspect_identity(Path(args.root))
    except IdentityUnavailableError as error:
        fail(UNAVAILABLE, str(error))

    supplied = (
        args.branch,
        args.workspace_id,
        args.head,
    )
    if args.capture:
        if any(value is not None for value in supplied):
            fail(UNAVAILABLE, "--capture does not accept expected identity values")
        emit(identity)
        return 0
    if any(value is None for value in supplied):
        fail(
            UNAVAILABLE,
            "verification requires branch, workspace ID, and HEAD",
        )

    expected = (
        ("branch", args.branch),
        ("workspaceId", args.workspace_id),
        ("head", args.head),
    )
    mismatched = [
        field
        for field, value in expected
        if value is not None and identity[field] != value
    ]
    if mismatched:
        fail(
            MISMATCH,
            "worktree identity mismatch: " + ", ".join(mismatched),
        )

    emit(identity)
    return 0


if __name__ == "__main__":
    sys.exit(main())
