#!/usr/bin/env python3
"""Project-local Skill projection and optional advisory Hook management."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shlex
import shutil
import subprocess
import tempfile
from pathlib import Path


PLUGIN_NAME = "pt-ew-plugin"
TRAE_HOOK_EVENTS = (
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "SubagentStart",
    "SubagentStop",
    "PreCompact",
    "PostCompact",
    "Stop",
)
CURSOR_HOOK_EVENTS = (
    ("sessionStart", "sessionStart"),
    ("beforeSubmitPrompt", "beforeSubmitPrompt"),
    ("preToolUse", "preToolUse"),
    ("stop", "stop"),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("install", "remove-hook"))
    parser.add_argument("--root", required=True)
    parser.add_argument("--host", required=True, choices=("trae", "cursor", "codex"))
    parser.add_argument("--workspace")
    return parser.parse_args()


def git_binary() -> Path:
    candidate = shutil.which("git")
    if candidate is None:
        raise RuntimeError("GIT_INTERPRETER_MISSING")
    return Path(candidate).resolve(strict=True)


def node_binary() -> Path:
    override = os.environ.get("PT_AGENT_NODE_BINARY", "").strip()
    candidate = override or shutil.which("node")
    if not candidate:
        raise RuntimeError("NODE_INTERPRETER_MISSING")
    path = Path(candidate)
    try:
        resolved = path.resolve(strict=True)
    except OSError as error:
        raise RuntimeError("NODE_INTERPRETER_MISSING") from error
    if not resolved.is_file() or not os.access(resolved, os.X_OK):
        raise RuntimeError("NODE_INTERPRETER_MISSING")
    return resolved


def canonical_root(value: str | Path) -> Path:
    root = Path(value)
    if root.is_symlink():
        raise RuntimeError("PROJECT_ROOT_INVALID")
    try:
        canonical = root.resolve(strict=True)
    except OSError as error:
        raise RuntimeError("PROJECT_ROOT_INVALID") from error
    completed = subprocess.run(
        [str(git_binary()), "rev-parse", "--show-toplevel"],
        cwd=canonical,
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError("PROJECT_ROOT_INVALID")
    try:
        git_root = Path(completed.stdout.strip()).resolve(strict=True)
    except OSError as error:
        raise RuntimeError("PROJECT_ROOT_INVALID") from error
    if git_root != canonical:
        raise RuntimeError("PROJECT_ROOT_INVALID")
    return canonical


def source_identity(root: Path) -> dict[str, str]:
    def value(*arguments: str) -> str:
        result = subprocess.run(
            [str(git_binary()), *arguments],
            cwd=root,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        if not result:
            raise RuntimeError("PROJECT_SOURCE_IDENTITY_INVALID")
        return result

    return {
        "workspaceId": hashlib.sha256(str(root).encode()).hexdigest()[:16],
        "branch": value("branch", "--show-current"),
        "head": value("rev-parse", "HEAD"),
    }


def read_workspace_descriptor(path: Path) -> tuple[Path, tuple[Path, ...]]:
    if path.is_symlink() or not path.is_file():
        raise RuntimeError("TRAE_WORKSPACE_DESCRIPTOR_INVALID")
    descriptor = path.resolve(strict=True)
    try:
        value = json.loads(descriptor.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError("TRAE_WORKSPACE_DESCRIPTOR_INVALID") from error
    folders = value.get("folders") if isinstance(value, dict) else None
    if not isinstance(folders, list) or not folders:
        raise RuntimeError("TRAE_WORKSPACE_DESCRIPTOR_INVALID")
    roots: list[Path] = []
    for folder in folders:
        raw = (
            folder
            if isinstance(folder, str)
            else folder.get("path")
            if isinstance(folder, dict)
            else None
        )
        if not isinstance(raw, str) or not raw.strip():
            raise RuntimeError("TRAE_WORKSPACE_DESCRIPTOR_INVALID")
        try:
            candidate = (descriptor.parent / raw).resolve(strict=True)
        except OSError as error:
            raise RuntimeError("TRAE_WORKSPACE_DESCRIPTOR_INVALID") from error
        if not candidate.is_dir():
            raise RuntimeError("TRAE_WORKSPACE_DESCRIPTOR_INVALID")
        if candidate not in roots:
            roots.append(candidate)
    return descriptor, tuple(roots)


def resolve_trae_workspace(
    root: Path,
    requested: str | None = None,
) -> tuple[Path | None, tuple[Path, ...], Path]:
    if not requested:
        return None, (root,), root
    descriptor, roots = read_workspace_descriptor(Path(requested))
    if root not in roots:
        raise RuntimeError("TRAE_WORKSPACE_ROOT_MISMATCH")
    return descriptor, roots, root


def host_root(root: Path, host: str, *, create: bool = True) -> Path:
    target = root / (".agents" if host == "codex" else f".{host}")
    if target.is_symlink():
        raise RuntimeError("HOST_PROJECTION_ESCAPE")
    if create:
        target.mkdir(parents=True, exist_ok=True, mode=0o700)
    if target.resolve().parent != root:
        raise RuntimeError("HOST_PROJECTION_ESCAPE")
    return target


def canonical_catalog(root: Path) -> tuple[list[Path], Path, dict[str, object]]:
    skills_root = root / "tooling" / "skills"
    if (
        skills_root.is_symlink()
        or not skills_root.is_dir()
        or skills_root.resolve(strict=True) != root / "tooling" / "skills"
    ):
        raise RuntimeError("CANONICAL_SKILL_SOURCE_INVALID")
    skills = [
        candidate
        for candidate in sorted(skills_root.glob("pt-*"))
        if candidate.is_dir() and (candidate / "SKILL.md").is_file()
    ]
    if not skills:
        raise RuntimeError("CANONICAL_SKILL_SOURCE_INVALID")
    plugin = root / "tooling" / "plugins" / PLUGIN_NAME
    hook_script = plugin / "scripts" / "hook-entry.mjs"
    if plugin.is_symlink() or not hook_script.is_file() or hook_script.is_symlink():
        raise RuntimeError("CANONICAL_PLUGIN_SOURCE_INVALID")

    entries: list[dict[str, object]] = []
    roots = [*skills, plugin]
    for source_root in roots:
        for candidate in sorted(source_root.rglob("*")):
            if candidate.is_symlink():
                raise RuntimeError("CANONICAL_INTEGRATION_SYMLINK")
            if not candidate.is_file():
                continue
            content = candidate.read_bytes()
            entries.append(
                {
                    "path": candidate.relative_to(root).as_posix(),
                    "mode": candidate.stat().st_mode & 0o777,
                    "size": len(content),
                    "sha256": hashlib.sha256(content).hexdigest(),
                }
            )
    serialized = json.dumps(entries, sort_keys=True, separators=(",", ":")).encode()
    return skills, plugin, {
        "integrationDigest": hashlib.sha256(serialized).hexdigest(),
        "integrationEntryCount": len(entries),
    }


def project_skills(skills: list[Path], target_root: Path) -> dict[str, object]:
    skills_root = target_root / "skills"
    if skills_root.is_symlink():
        canonical_source = skills[0].parent.resolve(strict=True)
        if (
            skills_root.exists()
            and skills_root.resolve(strict=True) == canonical_source
        ):
            return {
                "status": "PASS",
                "installed": [source.name for source in skills],
                "projection": "canonical-root-symlink",
            }
        raise RuntimeError("HOST_PROJECTION_ESCAPE")
    skills_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if skills_root.resolve(strict=True).parent != target_root:
        raise RuntimeError("HOST_PROJECTION_ESCAPE")
    installed: list[str] = []
    for source in skills:
        destination = skills_root / source.name
        if destination.is_symlink():
            if destination.exists() and destination.resolve(strict=True) == source:
                installed.append(source.name)
                continue
            raise RuntimeError(f"HOST_PROJECTION_CONFLICT:{source.name}")
        if destination.exists():
            raise RuntimeError(f"HOST_PROJECTION_CONFLICT:{source.name}")
        destination.symlink_to(source, target_is_directory=True)
        installed.append(source.name)
    return {
        "status": "PASS",
        "installed": installed,
        "projection": "per-skill-symlinks",
    }


def hook_command(
    root: Path,
    host: str,
    event: str,
    workspace: Path | None = None,
) -> str:
    script = (
        root / "tooling" / "plugins" / PLUGIN_NAME / "scripts" / "hook-entry.mjs"
    ).resolve(strict=True)
    parts = [
        str(node_binary()),
        str(script),
        "--host",
        host,
        "--event",
        event,
    ]
    if workspace is not None:
        parts.extend(["--workspace", str(workspace.resolve(strict=True))])
    return " ".join(shlex.quote(item) for item in parts)


def canonical_trae_hook_entry(
    root: Path,
    event: str,
    workspace: Path | None = None,
    *,
    host: str = "trae",
) -> dict[str, object]:
    entry: dict[str, object] = {
        "hooks": [
            {
                "type": "command",
                "command": hook_command(root, host, event, workspace),
                "timeout": 5,
            }
        ]
    }
    if event == "PreToolUse":
        entry["matcher"] = "*"
    return entry


def is_managed_trae_hook_entry(value: object) -> bool:
    return (
        isinstance(value, dict)
        and isinstance(value.get("hooks"), list)
        and any(
            isinstance(item, dict)
            and PLUGIN_NAME in str(item.get("command") or "")
            and "hook-entry.mjs" in str(item.get("command") or "")
            for item in value["hooks"]
        )
    )


def managed_cursor_hook(root: Path, host_event: str) -> dict[str, object]:
    hook: dict[str, object] = {
        "command": hook_command(root, "cursor", host_event),
        "timeout": 5,
        "failClosed": False,
    }
    if host_event == "preToolUse":
        hook["matcher"] = "*"
    return hook


def is_managed_cursor_hook(value: object) -> bool:
    return (
        isinstance(value, dict)
        and PLUGIN_NAME in str(value.get("command") or "")
        and "hook-entry.mjs" in str(value.get("command") or "")
    )


def load_hooks(path: Path, host: str) -> dict[str, object]:
    if path.is_symlink():
        raise RuntimeError("HOST_PROJECTION_ESCAPE")
    if not path.exists():
        return {"version": 1, "hooks": {}} if host == "cursor" else {"hooks": {}}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError("HOST_HOOKS_INVALID") from error
    valid = (
        isinstance(value, dict)
        and isinstance(value.get("hooks"), dict)
        and (host != "cursor" or value.get("version") == 1)
    )
    if not valid:
        raise RuntimeError("HOST_HOOKS_INVALID")
    return value


def planned_hooks(
    root: Path,
    target_root: Path,
    host: str,
    workspace: Path | None,
    *,
    install: bool,
) -> dict[str, object]:
    path = target_root / "hooks.json"
    output = json.loads(json.dumps(load_hooks(path, host)))
    if host == "cursor":
        for cursor_event, host_event in CURSOR_HOOK_EVENTS:
            existing = output["hooks"].get(cursor_event, [])
            if not isinstance(existing, list):
                raise RuntimeError("HOST_HOOKS_INVALID")
            retained = [
                item for item in existing if not is_managed_cursor_hook(item)
            ]
            if install:
                retained.append(managed_cursor_hook(root, host_event))
            if retained:
                output["hooks"][cursor_event] = retained
            else:
                output["hooks"].pop(cursor_event, None)
        return output
    for event in TRAE_HOOK_EVENTS:
        existing = output["hooks"].get(event, [])
        if not isinstance(existing, list):
            raise RuntimeError("HOST_HOOKS_INVALID")
        retained = [
            item for item in existing if not is_managed_trae_hook_entry(item)
        ]
        if install:
            retained.append(
                canonical_trae_hook_entry(
                    root,
                    event,
                    workspace if host == "trae" else None,
                    host=host,
                )
            )
        if retained:
            output["hooks"][event] = retained
        else:
            output["hooks"].pop(event, None)
    return output


def write_json_atomic(path: Path, value: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.tmp-",
        dir=path.parent,
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(value, stream, indent=2, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def install(
    root: Path,
    host: str,
    workspace: str | None = None,
) -> dict[str, object]:
    skills, _plugin, catalog = canonical_catalog(root)
    target = host_root(root, host)
    skill_result = project_skills(skills, target)
    workspace_file = None
    if host == "trae":
        workspace_file, _roots, _selected = resolve_trae_workspace(root, workspace)
    try:
        hooks = planned_hooks(
            root,
            target,
            host,
            workspace_file,
            install=True,
        )
        write_json_atomic(target / "hooks.json", hooks)
        hook_result: dict[str, object] = {"status": "PASS"}
    except RuntimeError as error:
        hook_result = {"status": "UNAVAILABLE", "code": str(error)}
    identity = source_identity(root)
    status = "PASS" if hook_result["status"] == "PASS" else "DEGRADED"
    return {
        "status": status,
        "action": "install",
        "root": str(root),
        "host": host,
        "source": identity,
        "skills": skill_result,
        "hook": hook_result,
        **catalog,
    }


def remove_hook(
    root: Path,
    host: str,
    workspace: str | None = None,
) -> dict[str, object]:
    target = host_root(root, host)
    workspace_file = None
    if host == "trae":
        workspace_file, _roots, _selected = resolve_trae_workspace(root, workspace)
    hooks = planned_hooks(
        root,
        target,
        host,
        workspace_file,
        install=False,
    )
    write_json_atomic(target / "hooks.json", hooks)
    return {
        "status": "PASS",
        "action": "remove-hook",
        "root": str(root),
        "host": host,
        "source": source_identity(root),
        "skills": {"status": "UNCHANGED"},
        "hook": {"status": "REMOVED"},
    }


def main() -> int:
    arguments = parse_args()
    try:
        root = canonical_root(arguments.root)
        result = (
            install(root, arguments.host, arguments.workspace)
            if arguments.action == "install"
            else remove_hook(root, arguments.host, arguments.workspace)
        )
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception as error:
        print(
            json.dumps(
                {
                    "status": "BLOCKED",
                    "action": arguments.action,
                    "host": arguments.host,
                    "code": str(error),
                },
                sort_keys=True,
            ),
            file=os.sys.stderr,
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
