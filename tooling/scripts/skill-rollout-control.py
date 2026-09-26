#!/usr/bin/env python3
"""Out-of-band project Skill catalog projection for one agent host."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("install",))
    parser.add_argument("--root", required=True)
    parser.add_argument("--host", required=True, choices=("trae", "cursor", "codex"))
    return parser.parse_args()


def machine_root() -> Path:
    override = os.environ.get("PT_MACHINE_DEV_ROOT", "").strip()
    return Path(override) if override else Path.home() / ".peers-touch" / "dev"


def identity(root: Path) -> tuple[str, str, str]:
    canonical = root.resolve(strict=True)
    workspace_id = hashlib.sha256(str(canonical).encode()).hexdigest()[:16]
    branch = subprocess.run(
        ["git", "branch", "--show-current"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    head = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if not branch or not head:
        raise RuntimeError("worktree identity is incomplete")
    return workspace_id, branch, head


def canonical_skill_catalog(
    root: Path,
) -> tuple[list[Path], dict[str, object]]:
    source_root = root / "tooling" / "skills"
    if (
        source_root.is_symlink()
        or not source_root.is_dir()
        or source_root.resolve(strict=True) != root / "tooling" / "skills"
    ):
        raise RuntimeError(
            f"CANONICAL_SKILL_SOURCE_INVALID: {source_root} is not worktree-local"
        )
    sources: list[Path] = []
    entries: list[dict[str, object]] = []
    for item in sorted(source_root.glob("pt-*")):
        if item.is_symlink():
            raise RuntimeError(
                f"CANONICAL_SKILL_SOURCE_INVALID: {item} is a symlink"
            )
        skill_file = item / "SKILL.md"
        if not item.is_dir() or not skill_file.is_file():
            continue
        if skill_file.is_symlink() or item.resolve(strict=True).parent != source_root:
            raise RuntimeError(
                f"CANONICAL_SKILL_SOURCE_INVALID: {item} escapes tooling/skills"
            )
        sources.append(item)
        for candidate in sorted(item.rglob("*")):
            if candidate.is_symlink():
                raise RuntimeError(
                    f"CANONICAL_SKILL_SOURCE_INVALID: {candidate} is a symlink"
                )
            if not candidate.is_file():
                continue
            content = candidate.read_bytes()
            entries.append(
                {
                    "path": candidate.relative_to(source_root).as_posix(),
                    "mode": candidate.stat().st_mode & 0o777,
                    "size": len(content),
                    "sha256": hashlib.sha256(content).hexdigest(),
                }
            )
    if not sources:
        raise RuntimeError(f"canonical project Skills are missing: {source_root}")
    serialized = json.dumps(
        entries,
        separators=(",", ":"),
        sort_keys=True,
    ).encode()
    status = subprocess.run(
        [
            "git",
            "status",
            "--porcelain=v1",
            "--untracked-files=all",
            "--",
            "tooling/skills",
        ],
        cwd=root,
        check=True,
        capture_output=True,
    ).stdout
    return sources, {
        "catalogDigest": hashlib.sha256(serialized).hexdigest(),
        "catalogEntryCount": len(entries),
        "catalogGitState": "CLEAN" if not status else "DIRTY",
        "catalogStatusDigest": hashlib.sha256(status).hexdigest(),
    }


def receipt_path(workspace_id: str) -> Path:
    return (
        machine_root()
        / "workspaces"
        / workspace_id
        / "workflow"
        / "skill-rollout.json"
    )


def write_receipt(path: Path, value: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.tmp-",
        dir=path.parent,
    )
    temporary = Path(temporary_name)
    try:
        if hasattr(os, "fchmod"):
            os.fchmod(descriptor, 0o600)
        os.write(
            descriptor,
            (json.dumps(value, indent=2, sort_keys=True) + "\n").encode(),
        )
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    try:
        os.replace(temporary, path)
        if os.name != "nt":
            directory = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)


def host_root(root: Path, host: str) -> Path:
    candidate = root / (".agents" if host == "codex" else f".{host}")
    if candidate.is_symlink():
        raise RuntimeError(f"HOST_PROJECTION_ESCAPE: {candidate} is a symlink")
    candidate.mkdir(mode=0o700, parents=True, exist_ok=True)
    if candidate.resolve(strict=True).parent != root:
        raise RuntimeError(f"HOST_PROJECTION_ESCAPE: {candidate} leaves the worktree")
    return candidate


def retire(path: Path, retired_root: Path) -> None:
    if path.is_symlink():
        path.unlink()
        return
    if not path.exists():
        return
    if retired_root.is_symlink():
        raise RuntimeError(
            f"HOST_PROJECTION_ESCAPE: {retired_root} is a symlink"
        )
    retired_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    if retired_root.resolve(strict=True).parent != retired_root.parent:
        raise RuntimeError(
            f"HOST_PROJECTION_ESCAPE: {retired_root} leaves its host root"
        )
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
    destination = retired_root / f"{path.name}.{stamp}"
    path.rename(destination)
    print(f"retired existing project skill: {destination}")


def install(root: Path, host: str, workspace_id: str, branch: str, head: str) -> None:
    sources, catalog = canonical_skill_catalog(root)
    target_root = host_root(root, host)
    skills_root = target_root / "skills"
    if skills_root.is_symlink():
        skills_root.unlink()
    skills_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    if skills_root.resolve(strict=True).parent != target_root:
        raise RuntimeError(f"HOST_PROJECTION_ESCAPE: {skills_root} leaves its host root")
    retired_root = target_root / "retired-project-skills"
    retire(skills_root / "pt-trae-goal-orchestrator", retired_root)
    for source in sources:
        destination = skills_root / source.name
        retire(destination, retired_root)
        destination.symlink_to(source.resolve(strict=True), target_is_directory=True)
    receipt = receipt_path(workspace_id)
    write_receipt(
        receipt,
        {
            "kind": "peers-touch-skill-rollout",
            "state": "INSTALLED",
            "workspaceId": workspace_id,
            "branch": branch,
            "sourceHead": head,
            "host": host,
            "installedAt": datetime.now(timezone.utc).isoformat(
                timespec="milliseconds"
            ),
            **catalog,
        },
    )
    print(f"linked {len(sources)} project pt-* skills under {skills_root}")
    print(json.dumps({"status": "INSTALLED", "path": str(receipt)}))


def main() -> int:
    options = parse_args()
    root = Path(os.path.realpath(os.path.abspath(options.root)))
    workspace_id, branch, head = identity(root)
    try:
        install(root, options.host, workspace_id, branch, head)
    except (OSError, RuntimeError, json.JSONDecodeError) as error:
        print(json.dumps({"status": "BLOCKED", "code": str(error)}))
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
