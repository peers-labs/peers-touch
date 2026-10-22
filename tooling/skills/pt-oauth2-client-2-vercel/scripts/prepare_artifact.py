#!/usr/bin/env python3
"""Prepare the OAuth Vercel upload without duplicating shared source in Git."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path


OLD_REPLACE = (
    "replace github.com/peers-labs/peers-touch/github-repository "
    "=> ../../packages/github-repository"
)
NEW_REPLACE = (
    "replace github.com/peers-labs/peers-touch/github-repository "
    "=> ./packages/github-repository"
)


def copy_ignore(_directory: str, names: list[str]) -> set[str]:
    return {
        name
        for name in names
        if name in {"node_modules", "target", ".vercel", "__pycache__"}
    }


def prepare_artifact(repo_root: Path, output_dir: Path) -> dict[str, object]:
    repo_root = repo_root.resolve()
    output_dir = output_dir.resolve()
    try:
        output_dir.relative_to(repo_root)
    except ValueError:
        pass
    else:
        raise ValueError("artifact directory must be outside source")
    if output_dir.exists():
        raise ValueError("artifact directory already exists")

    app_source = repo_root / "apps/oauth2-client"
    shared_source = repo_root / "packages/github-repository"
    app_target = output_dir / "apps/oauth2-client"
    shared_target = app_target / "packages/github-repository"
    shutil.copytree(app_source, app_target, ignore=copy_ignore)
    shutil.copytree(shared_source, shared_target, ignore=copy_ignore)

    go_mod = app_target / "go.mod"
    content = go_mod.read_text(encoding="utf-8")
    if content.count(OLD_REPLACE) != 1:
        raise ValueError("OAuth shared-module replacement is invalid")
    go_mod.write_text(content.replace(OLD_REPLACE, NEW_REPLACE), encoding="utf-8")

    files = sorted(
        path.relative_to(output_dir).as_posix()
        for path in output_dir.rglob("*")
        if path.is_file()
    )
    return {
        "status": "PASS",
        "artifactRoot": str(output_dir),
        "fileCount": len(files),
        "sharedModuleFiles": sum(
            path.startswith(
                "apps/oauth2-client/packages/github-repository/"
            )
            for path in files
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    repo_root = args.repo_root.resolve()
    status = subprocess.run(
        (
            "git",
            "-C",
            str(repo_root),
            "status",
            "--porcelain=v1",
            "--untracked-files=all",
        ),
        capture_output=True,
        check=False,
        text=True,
    )
    if status.returncode != 0 or status.stdout.strip():
        raise SystemExit("OAuth Vercel artifact requires clean source")
    print(json.dumps(prepare_artifact(repo_root, args.output_dir), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
