#!/usr/bin/env python3

import argparse
import fcntl
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

import cargo_gc


class ProbeError(RuntimeError):
    pass


CLASS_ORDER = (
    "keep_hot",
    "keep_warm",
    "current_task_irrelevant",
    "derived_idle",
    "safe_now",
    "rebuildable_cache",
    "evidence_review",
    "blocked",
)
RUST_WRITER_PATTERN = re.compile(r"(^|/|\s)(cargo|rustc)(\s|$)")
IOS_WRITER_PATTERN = re.compile(
    r"(xcodebuild|XCBBuildService|tauri\s+ios|ios-deploy|simctl)",
    re.IGNORECASE,
)
ANDROID_WRITER_PATTERN = re.compile(
    r"(gradle|tauri\s+android|adb(\s|$)|emulator(\s|$))",
    re.IGNORECASE,
)
NODE_PATTERN = re.compile(r"(^|/|\s)(node|pnpm|vite|tsx|tsc)(\s|$)")
HASHED_ARTIFACT = re.compile(
    r"^(?P<family>.+)-(?P<hash>[0-9a-f]{16})(?P<suffix>(?:\..*)?)$"
)


def run_text(
    command: Sequence[str],
    cwd: Optional[Path] = None,
    timeout: int = 120,
    required: bool = False,
) -> str:
    try:
        completed = subprocess.run(
            list(command),
            cwd=str(cwd) if cwd else None,
            check=False,
            capture_output=True,
            timeout=timeout,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as error:
        if required:
            raise ProbeError(
                f"required probe failed to execute: {command[0]}"
            ) from error
        return ""
    if required and completed.returncode != 0:
        raise ProbeError(
            f"required probe returned {completed.returncode}: {command[0]}"
        )
    return completed.stdout.decode("utf-8", errors="replace")


def is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def allocated_tree_bytes(paths: Iterable[Path]) -> int:
    total = 0
    seen: Set[Tuple[int, int]] = set()

    def count(path: Path) -> None:
        nonlocal total
        try:
            stat = path.lstat()
        except OSError:
            return
        key = (stat.st_dev, stat.st_ino)
        if key in seen:
            return
        seen.add(key)
        total += stat.st_blocks * 512

    for root in paths:
        if root.is_symlink() or root.is_file():
            count(root)
            continue
        if not root.is_dir():
            continue
        count(root)
        for current, directories, files in os.walk(root, followlinks=False):
            current_path = Path(current)
            for name in directories:
                count(current_path / name)
            for name in files:
                count(current_path / name)
    return total


def discover_worktrees(repo_root: Path) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    output = run_text(
        ["git", "worktree", "list", "--porcelain"],
        cwd=repo_root,
        required=True,
    )
    records: List[Dict[str, Any]] = []
    current: Dict[str, Any] = {}

    for line in output.splitlines() + [""]:
        if not line:
            if current:
                records.append(current)
                current = {}
            continue
        key, _, value = line.partition(" ")
        if key == "worktree":
            current["root"] = value
        elif key == "HEAD":
            current["head"] = value
        elif key == "branch":
            current["branch"] = value.removeprefix("refs/heads/")
        elif key == "detached":
            current["branch"] = "(detached)"
        elif key == "prunable":
            current["prunable"] = True
            current["prunable_reason"] = value

    active = []
    prunable = []
    for record in records:
        root = Path(record.get("root", ""))
        record["name"] = root.name
        if record.get("prunable") or not root.is_dir():
            prunable.append(record)
        else:
            active.append(record)
    return active, prunable


def process_inventory(worktree_roots: Sequence[Path]) -> Dict[Path, List[Dict[str, Any]]]:
    roots = sorted((root.resolve() for root in worktree_roots), key=lambda item: -len(str(item)))
    command_by_pid: Dict[int, str] = {}
    for line in run_text(
        ["ps", "-axo", "pid=,command="],
        required=True,
    ).splitlines():
        fields = line.strip().split(maxsplit=1)
        if not fields or not fields[0].isdigit():
            continue
        command_by_pid[int(fields[0])] = fields[1] if len(fields) > 1 else ""

    inventory: Dict[Path, List[Dict[str, Any]]] = defaultdict(list)
    pid: Optional[int] = None
    command_name = ""
    cwd: Optional[Path] = None

    def flush() -> None:
        nonlocal pid, command_name, cwd
        if pid is None or cwd is None:
            pid = None
            command_name = ""
            cwd = None
            return
        for root in roots:
            if cwd == root or is_relative_to(cwd, root):
                inventory[root].append(
                    {
                        "pid": pid,
                        "name": command_name,
                        "command": command_by_pid.get(pid, command_name),
                        "cwd": str(cwd),
                    }
                )
                break
        pid = None
        command_name = ""
        cwd = None

    output = run_text(
        ["lsof", "-nP", "-d", "cwd", "-Fpcn"],
        timeout=180,
        required=True,
    )
    for line in output.splitlines():
        if line.startswith("p"):
            flush()
            value = line[1:]
            pid = int(value) if value.isdigit() else None
        elif line.startswith("c"):
            command_name = line[1:]
        elif line.startswith("n"):
            cwd = Path(line[1:]).resolve()
    flush()
    known_pids = {
        root: {process["pid"] for process in processes}
        for root, processes in inventory.items()
    }
    for process_pid, command in command_by_pid.items():
        for root in roots:
            if process_pid in known_pids.get(root, set()):
                continue
            if str(root) not in command:
                continue
            inventory[root].append(
                {
                    "pid": process_pid,
                    "name": Path(command.split(maxsplit=1)[0]).name,
                    "command": command,
                    "cwd": "(external)",
                }
            )
    return inventory


def opened_paths() -> Set[Path]:
    result: Set[Path] = set()
    for line in run_text(
        ["lsof", "-nP", "-Fpn"],
        timeout=240,
        required=True,
    ).splitlines():
        if not line.startswith("n"):
            continue
        value = line[1:]
        if not value.startswith("/"):
            continue
        try:
            result.add(Path(value).resolve())
        except OSError:
            continue
    return result


def git_dirty_paths(root: Path) -> List[str]:
    output = run_text(
        ["git", "status", "--porcelain=v1", "--untracked-files=all"],
        cwd=root,
        required=True,
    )
    result = []
    for line in output.splitlines():
        if len(line) < 4:
            continue
        path = line[3:]
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        result.append(path)
    return result


def load_json(path: Path) -> Dict[str, Any]:
    try:
        with path.open(encoding="utf-8") as handle:
            value = json.load(handle)
    except (OSError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def development_context(home: Path, worktrees: Sequence[Dict[str, Any]]) -> Dict[Path, Dict[str, Any]]:
    dev_root = home / ".peers-touch/dev"
    root_to_workspace: Dict[Path, str] = {}
    registry = load_json(dev_root / "registry.json")
    registrations = (
        registry.get("discovery", {}).get("observedRegistrations", [])
        if isinstance(registry.get("discovery"), dict)
        else []
    )
    for item in registrations:
        if not isinstance(item, dict):
            continue
        root = item.get("canonicalRoot")
        workspace_id = item.get("workspaceId")
        if root and workspace_id:
            root_to_workspace[Path(root).resolve()] = str(workspace_id)

    ledger = load_json(dev_root / "plan-mounts/ledger.json")
    live_mount_ids = set(
        (ledger.get("liveMountsByWorkspace") or {}).values()
    )
    for mount_id in live_mount_ids:
        mount = load_json(
            dev_root / "plan-mounts/mounts" / f"{mount_id}.json"
        )
        root = mount.get("canonicalRoot")
        workspace_id = mount.get("workspaceId")
        if root and workspace_id:
            root_to_workspace[Path(root).resolve()] = str(workspace_id)

    work = load_json(dev_root / "work.json")
    declarations = work.get("declarations", {})
    if not isinstance(declarations, dict):
        declarations = {}

    result: Dict[Path, Dict[str, Any]] = {}
    for worktree in worktrees:
        root = Path(worktree["root"]).resolve()
        workspace_id = root_to_workspace.get(root)
        matches = []
        for declaration in declarations.values():
            if not isinstance(declaration, dict) or declaration.get("state") != "ACTIVE":
                continue
            exact_workspace = workspace_id and declaration.get("workspaceId") == workspace_id
            branch_fallback = (
                not workspace_id
                and declaration.get("branch")
                and declaration.get("branch") == worktree.get("branch")
            )
            if exact_workspace or branch_fallback:
                matches.append(declaration)
        result[root] = {
            "workspace_id": workspace_id,
            "declarations": matches,
        }
    return result


def mark(
    demand: Dict[str, Dict[str, Any]],
    domain: str,
    level: int,
    reason: str,
) -> None:
    current = demand.setdefault(domain, {"level": 0, "reasons": []})
    current["level"] = max(int(current["level"]), level)
    if reason not in current["reasons"]:
        current["reasons"].append(reason)


def apply_path_signal(
    demand: Dict[str, Dict[str, Any]],
    path: str,
    level: int,
    source: str,
) -> None:
    normalized = path.replace("\\", "/").lstrip("./")
    lower = normalized.lower()
    reason = f"{source}:{normalized}"

    if normalized.startswith("apps/desktop/src-tauri"):
        mark(demand, "desktop_native", level, reason)
        mark(demand, "node", 1, reason)
        return
    if normalized == "apps/desktop" or normalized.startswith("apps/desktop/"):
        mark(demand, "node", level, reason)
        if source == "claim":
            mark(demand, "desktop_native", level, reason)
        return

    if normalized == "apps/mobile":
        mark(demand, "node", level, reason)
        mark(demand, "mobile_host", 1, reason)
        mark(demand, "ios_sim", 1, reason)
        mark(demand, "ios_device", 1, reason)
        mark(demand, "android", 1, reason)
        return

    if normalized.startswith("apps/mobile/src-tauri"):
        mark(demand, "mobile_host", level, reason)
        if (
            "/gen/apple/" in lower
            or "/ios/" in lower
            or "ios_" in lower
            or "ios-" in lower
            or "ios_keychain" in lower
        ):
            mark(demand, "ios_sim", level, reason)
            mark(demand, "ios_device", level, reason)
        elif "/gen/android/" in lower or "/android/" in lower or "android_" in lower:
            mark(demand, "android", level, reason)
        else:
            mark(demand, "ios_sim", 1, reason)
            mark(demand, "ios_device", 1, reason)
            mark(demand, "android", 1, reason)
        return

    if normalized.startswith("apps/mobile/"):
        mark(demand, "node", level, reason)
        return

    if normalized == "Cargo.lock" or lower.endswith("/cargo.toml"):
        mark(demand, "desktop_native", 1, reason)
        mark(demand, "mobile_host", 1, reason)
        mark(demand, "ios_sim", 1, reason)
        mark(demand, "ios_device", 1, reason)
        mark(demand, "android", 1, reason)
    elif normalized.startswith("packages/") and lower.endswith(".rs"):
        mark(demand, "desktop_native", 1, reason)
        mark(demand, "mobile_host", 1, reason)
        mark(demand, "ios_sim", 1, reason)
        mark(demand, "ios_device", 1, reason)
        mark(demand, "android", 1, reason)
    elif normalized.startswith(("packages/", "tooling/", "model/")):
        mark(demand, "node", 1, reason)


def infer_demand(
    dirty_paths: Sequence[str],
    declarations: Sequence[Dict[str, Any]],
    processes: Sequence[Dict[str, Any]],
) -> Dict[str, Dict[str, Any]]:
    demand: Dict[str, Dict[str, Any]] = {}
    for declaration in declarations:
        for claim in declaration.get("sourceClaims", []):
            if not isinstance(claim, dict):
                continue
            prefix = claim.get("pathPrefix")
            if prefix:
                apply_path_signal(demand, str(prefix), 2, "claim")
        text = " ".join(
            str(declaration.get(key, ""))
            for key in ("taskId", "journeyId", "purpose")
        ).lower()
        if "ios" in text:
            mark(demand, "ios_sim", 2, "task-text:ios")
            mark(demand, "ios_device", 2, "task-text:ios")
            mark(demand, "mobile_host", 2, "task-text:ios")
        if "android" in text:
            mark(demand, "android", 2, "task-text:android")
            mark(demand, "mobile_host", 2, "task-text:android")
        if "desktop" in text:
            mark(demand, "desktop_native", 2, "task-text:desktop")

    for path in dirty_paths:
        apply_path_signal(demand, path, 2, "dirty")

    for process in processes:
        text = f"{process.get('name', '')} {process.get('command', '')}".lower()
        if IOS_WRITER_PATTERN.search(text):
            mark(demand, "ios_sim", 2, f"process:{process.get('pid')}")
            mark(demand, "ios_device", 2, f"process:{process.get('pid')}")
            mark(demand, "mobile_host", 2, f"process:{process.get('pid')}")
        if ANDROID_WRITER_PATTERN.search(text):
            mark(demand, "android", 2, f"process:{process.get('pid')}")
            mark(demand, "mobile_host", 2, f"process:{process.get('pid')}")
        if "apps/mobile" in text and RUST_WRITER_PATTERN.search(text):
            mark(demand, "mobile_host", 2, f"process:{process.get('pid')}")
        if "apps/desktop" in text and RUST_WRITER_PATTERN.search(text):
            mark(demand, "desktop_native", 2, f"process:{process.get('pid')}")
        if NODE_PATTERN.search(text):
            mark(demand, "node", 2, f"process:{process.get('pid')}")
    return demand


def component(
    worktree_name: str,
    suffix: str,
    paths: Sequence[Path],
    kind: str,
    domain: str,
    consequence: str,
    cargo: bool = False,
    manifest_path: Optional[Path] = None,
) -> Dict[str, Any]:
    return {
        "id": f"{worktree_name}:{suffix}",
        "paths": [str(path) for path in paths],
        "kind": kind,
        "domain": domain,
        "cargo": cargo,
        "manifest_path": str(manifest_path) if manifest_path else None,
        "bytes": allocated_tree_bytes(paths),
        "consequence": consequence,
    }


def is_cargo_target_root(path: Path) -> bool:
    return (
        (path / ".rustc_info.json").is_file()
        or (path / "debug/.fingerprint").is_dir()
        or (path / "release/.fingerprint").is_dir()
    )


def discover_components(
    root: Path,
    name: str,
    identity: str,
) -> List[Dict[str, Any]]:
    result: List[Dict[str, Any]] = []
    component_owner = f"{name}@{identity}"
    desktop_target = root / "apps/desktop/src-tauri/target"
    desktop_manifest = root / "apps/desktop/src-tauri/Cargo.toml"
    if desktop_target.is_symlink():
        result.append(
            component(
                component_owner,
                "desktop-cargo-target-symlink",
                [desktop_target],
                "symlink",
                "desktop_native",
                "Symlinked build roots are never cleanup targets",
            )
        )
    else:
        for profile_name in ("debug", "release"):
            profile = desktop_target / profile_name
            if profile.is_symlink():
                result.append(
                    component(
                        component_owner,
                        f"desktop-cargo-{profile_name}-symlink",
                        [profile],
                        "symlink",
                        "desktop_native",
                        "Symlinked build profiles are never cleanup targets",
                    )
                )
            elif profile.is_dir():
                result.append(
                    component(
                        component_owner,
                        f"desktop-cargo-{profile_name}",
                        [profile],
                        "cargo_profile",
                        "desktop_native",
                        f"Desktop {profile_name} becomes a cold Rust build",
                        cargo=True,
                        manifest_path=desktop_manifest,
                    )
                )

    mobile_target = root / "apps/mobile/src-tauri/target"
    mobile_manifest = root / "apps/mobile/src-tauri/Cargo.toml"
    known_mobile: Set[Path] = set()
    if mobile_target.is_symlink():
        result.append(
            component(
                component_owner,
                "mobile-cargo-target-symlink",
                [mobile_target],
                "symlink",
                "mobile_host",
                "Symlinked build roots are never cleanup targets",
            )
        )
    else:
        for profile_name in ("debug", "release"):
            profile = mobile_target / profile_name
            if profile.is_symlink():
                known_mobile.add(profile)
                result.append(
                    component(
                        component_owner,
                        f"mobile-host-cargo-{profile_name}-symlink",
                        [profile],
                        "symlink",
                        "mobile_host",
                        "Symlinked build profiles are never cleanup targets",
                    )
                )
            elif profile.is_dir():
                known_mobile.add(profile)
                result.append(
                    component(
                        component_owner,
                        f"mobile-host-cargo-{profile_name}",
                        [profile],
                        "cargo_profile",
                        "mobile_host",
                        f"Mobile host {profile_name} checks and tests become cold",
                        cargo=True,
                        manifest_path=mobile_manifest,
                    )
                )

    mobile_children = (
        sorted(mobile_target.iterdir())
        if mobile_target.is_dir() and not mobile_target.is_symlink()
        else ()
    )
    for child in mobile_children:
        if child in known_mobile or child.name in (".rustc_info.json", "CACHEDIR.TAG"):
            continue
        if child.is_symlink():
            known_mobile.add(child)
            result.append(
                component(
                    component_owner,
                    f"mobile-target-symlink-{child.name}",
                    [child],
                    "symlink",
                    "mobile_host",
                    "Symlinked build roots are never cleanup targets",
                )
            )
            continue
        domain = ""
        suffix = ""
        if child.name.endswith("-apple-ios-sim") or child.name == "x86_64-apple-ios":
            domain = "ios_sim"
            suffix = f"mobile-ios-simulator-{child.name}"
        elif child.name == "aarch64-apple-ios":
            domain = "ios_device"
            suffix = f"mobile-ios-device-{child.name}"
        elif "linux-android" in child.name:
            domain = "android"
            suffix = f"mobile-android-{child.name}"
        if domain:
            known_mobile.add(child)
            result.append(
                component(
                    component_owner,
                    suffix,
                    [child],
                    "cargo_target",
                    domain,
                    f"{child.name} requires a full platform Rust rebuild",
                    cargo=True,
                    manifest_path=mobile_manifest,
                )
            )

    evidence_paths = []
    for child in mobile_children:
        if child in known_mobile or child.name in (".rustc_info.json", "CACHEDIR.TAG"):
            continue
        if child.is_dir() and is_cargo_target_root(child):
            lower = child.name.lower()
            if "ios" in lower:
                domain = "ios_sim"
            elif "android" in lower:
                domain = "android"
            else:
                domain = "mobile_host"
            result.append(
                component(
                    component_owner,
                    f"mobile-aux-cargo-{child.name}",
                    [child],
                    "cargo_target",
                    domain,
                    f"Auxiliary Mobile Rust target {child.name} becomes cold",
                    cargo=True,
                    manifest_path=mobile_manifest,
                )
            )
        else:
            evidence_paths.append(child)
    if evidence_paths:
        result.append(
            component(
                component_owner,
                "mobile-target-evidence",
                evidence_paths,
                "evidence",
                "evidence",
                "Requires an owner retention decision; not a compiler cache",
            )
        )

    android_build = root / "apps/mobile/src-tauri/gen/android/app/build"
    if android_build.is_dir():
        result.append(
            component(
                component_owner,
                "mobile-android-gradle-build",
                [android_build],
                "android_build",
                "android",
                "Android Gradle outputs and APKs must be rebuilt",
            )
        )

    apple_build = root / "apps/mobile/src-tauri/gen/apple/build"
    if apple_build.is_dir():
        result.append(
            component(
                component_owner,
                "mobile-ios-xcode-build",
                [apple_build],
                "ios_build",
                "ios_sim",
                "iOS Xcode products must be rebuilt",
            )
        )

    node_modules = root / "node_modules"
    if node_modules.is_dir():
        result.append(
            component(
                component_owner,
                "node-modules",
                [node_modules],
                "node_modules",
                "node",
                "pnpm install is required before JS development resumes",
            )
        )

    pytest_cache = root / ".pytest_cache"
    if pytest_cache.is_dir():
        result.append(
            component(
                component_owner,
                "pytest-cache",
                [pytest_cache],
                "language_cache",
                "node",
                "Pytest cache metadata is regenerated on the next test run",
            )
        )

    for evidence_path, evidence_id in (
        (root / "apps/desktop/test-results", "desktop-test-results"),
        (root / "test-results", "test-results"),
    ):
        if evidence_path.is_dir():
            result.append(
                component(
                    component_owner,
                    evidence_id,
                    [evidence_path],
                    "evidence",
                    "evidence",
                    "Requires an owner retention decision",
                )
            )
    return result


def writer_state(processes: Sequence[Dict[str, Any]]) -> Dict[str, bool]:
    classified = {
        value
        for process in processes
        for value in process.get("classes", [])
    }
    commands = " ".join(
        f"{process.get('name', '')} {process.get('command', '')}" for process in processes
    )
    return {
        "cargo": "cargo_writer" in classified or bool(
            RUST_WRITER_PATTERN.search(commands)
        ),
        "ios": "ios_writer" in classified or bool(
            IOS_WRITER_PATTERN.search(commands)
        ),
        "android": "android_writer" in classified or bool(
            ANDROID_WRITER_PATTERN.search(commands)
        ),
        "node": "node_user" in classified or bool(NODE_PATTERN.search(commands)),
    }


def process_for_report(process: Dict[str, Any]) -> Dict[str, Any]:
    text = f"{process.get('name', '')} {process.get('command', '')}"
    classes = []
    if RUST_WRITER_PATTERN.search(text):
        classes.append("cargo_writer")
    if IOS_WRITER_PATTERN.search(text):
        classes.append("ios_writer")
    if ANDROID_WRITER_PATTERN.search(text):
        classes.append("android_writer")
    if NODE_PATTERN.search(text):
        classes.append("node_user")
    return {
        "pid": process.get("pid"),
        "name": process.get("name"),
        "cwd": process.get("cwd"),
        "classes": classes,
    }


def classify_component(
    item: Dict[str, Any],
    demand: Dict[str, Dict[str, Any]],
    current: bool,
    writers: Dict[str, bool],
) -> Tuple[str, str]:
    if item["kind"] == "symlink":
        return "blocked", "cleanup paths must not contain symbolic links"
    if item["kind"] == "evidence":
        return "evidence_review", "artifact role is evidence or unknown output"
    if item["cargo"] and writers["cargo"]:
        return "blocked", "Cargo or rustc is active in this worktree"
    if item["kind"] == "android_build" and writers["android"]:
        return "blocked", "Android build tooling is active in this worktree"
    if item["kind"] == "ios_build" and writers["ios"]:
        return "blocked", "iOS build tooling is active in this worktree"
    if item["kind"] == "node_modules" and current:
        return "keep_hot", "current worktrees retain installed dependencies"

    domain = item["domain"]
    domain_demand = demand.get(domain, {"level": 0, "reasons": []})
    level = int(domain_demand["level"])
    reasons = domain_demand["reasons"]
    if level >= 2:
        return "keep_hot", "; ".join(reasons[:4])
    if level == 1:
        return "keep_warm", "; ".join(reasons[:4])
    if current:
        return (
            "current_task_irrelevant",
            f"current task has no {domain} demand; future use pays the rebuild cost",
        )
    return "derived_idle", "no ACTIVE task, dirty source, or process requires this component"


def cargo_profile_paths(item: Dict[str, Any]) -> List[Path]:
    result = []
    for raw_path in item["paths"]:
        path = Path(raw_path)
        if item["kind"] == "cargo_profile":
            result.append(path)
        elif item["kind"] == "cargo_target":
            for profile_name in ("debug", "release"):
                profile = path / profile_name
                if profile.is_dir():
                    result.append(profile)
    return result


def old_test_binaries(
    components: Sequence[Dict[str, Any]],
    cutoff: float,
    opened: Set[Path],
) -> List[Path]:
    result = []
    for item in components:
        if not item.get("cargo") or item.get("class") == "blocked":
            continue
        for profile in cargo_profile_paths(item):
            deps = profile / "deps"
            if not deps.is_dir():
                continue
            for path in deps.iterdir():
                match = HASHED_ARTIFACT.match(path.name)
                if not match or match.group("suffix"):
                    continue
                try:
                    stat = path.stat()
                except OSError:
                    continue
                if (
                    path.is_file()
                    and not path.is_symlink()
                    and os.access(path, os.X_OK)
                    and stat.st_mtime < cutoff
                    and path.resolve() not in opened
                ):
                    result.append(path)
    return result


def rust_rebuildable_candidates(
    components: Sequence[Dict[str, Any]],
    cutoff: float,
    keep_generations: int,
) -> Tuple[List[Path], List[Path], List[Path], Dict[str, int]]:
    grouped: Dict[Tuple[str, str, str, str], List[Path]] = defaultdict(list)
    newest: Dict[Tuple[str, str, str, str], float] = defaultdict(float)
    profile_paths = [
        profile
        for item in components
        if item.get("cargo")
        for profile in cargo_profile_paths(item)
    ]

    for profile in profile_paths:
        for section_name in ("deps", "build"):
            section = profile / section_name
            if not section.is_dir():
                continue
            for path in section.iterdir():
                match = HASHED_ARTIFACT.match(path.name)
                if not match:
                    continue
                key = (
                    str(profile),
                    section_name,
                    match.group("family"),
                    match.group("hash"),
                )
                grouped[key].append(path)
                try:
                    newest[key] = max(newest[key], path.stat().st_mtime)
                except OSError:
                    continue

    families: Dict[
        Tuple[str, str, str],
        List[Tuple[Tuple[str, str, str, str], float]],
    ] = defaultdict(list)
    for key, modified in newest.items():
        profile, section, family, _ = key
        families[(profile, section, family)].append((key, modified))

    deps: List[Path] = []
    build: List[Path] = []
    counts = {"deps": 0, "build": 0, "incremental": 0}
    for generations in families.values():
        generations.sort(key=lambda item: item[1], reverse=True)
        for key, modified in generations[keep_generations:]:
            if modified >= cutoff:
                continue
            section = key[1]
            counts[section] += 1
            for path in grouped[key]:
                match = HASHED_ARTIFACT.match(path.name)
                if (
                    section == "deps"
                    and match
                    and not match.group("suffix")
                    and path.is_file()
                    and os.access(path, os.X_OK)
                ):
                    continue
                (deps if section == "deps" else build).append(path)

    incremental: List[Path] = []
    for profile in profile_paths:
        incremental_root = profile / "incremental"
        if not incremental_root.is_dir():
            continue
        incremental_families: Dict[str, List[Path]] = defaultdict(list)
        for path in incremental_root.iterdir():
            if path.is_dir():
                incremental_families[path.name.rsplit("-", 1)[0]].append(path)
        for paths in incremental_families.values():
            paths.sort(key=lambda item: item.stat().st_mtime, reverse=True)
            for path in paths[keep_generations:]:
                try:
                    modified = path.stat().st_mtime
                except OSError:
                    continue
                if modified < cutoff:
                    incremental.append(path)
                    counts["incremental"] += 1
    return deps, build, incremental, counts


def scan(
    args: argparse.Namespace,
    include_open_paths: bool = True,
    deep_rust: bool = True,
) -> Dict[str, Any]:
    repo_root = args.repo_root.resolve()
    worktree_records, prunable = discover_worktrees(repo_root)
    if args.worktree:
        selected = set(args.worktree)
        worktree_records = [
            record
            for record in worktree_records
            if record["name"] in selected
        ]
    roots = [Path(item["root"]).resolve() for item in worktree_records]
    processes_by_root = process_inventory(roots)
    contexts = development_context(Path.home(), worktree_records)
    opened = opened_paths() if include_open_paths else set()
    cutoff = time.time() - args.binary_age_days * 86400
    generation_cutoff = time.time() - args.generation_age_days * 86400
    worktree_reports = []
    summary = defaultdict(int)
    nested_summary = defaultdict(int)

    for record in worktree_records:
        root = Path(record["root"]).resolve()
        dirty_paths = git_dirty_paths(root)
        processes = processes_by_root.get(root, [])
        context = contexts.get(root, {"workspace_id": None, "declarations": []})
        declarations = context["declarations"]
        root_hash = hashlib.sha256(str(root).encode("utf-8")).hexdigest()[:12]
        identity = (
            f"{context.get('workspace_id') or 'unregistered'}-{root_hash}"
        )
        demand = infer_demand(dirty_paths, declarations, processes)
        writers = writer_state(processes)
        current = bool(dirty_paths or declarations or processes)
        components = discover_components(root, record["name"], identity)

        for item in components:
            item_class, reason = classify_component(item, demand, current, writers)
            item["class"] = item_class
            item["reason"] = reason
            summary[item_class] += int(item["bytes"])

        safe_binaries = (
            []
            if writers["cargo"]
            else old_test_binaries(components, cutoff, opened)
        )
        safe_bytes = allocated_tree_bytes(safe_binaries)
        deep_component_ids = set()
        active_graph_reclaim_bytes = 0
        active_graph_analysis_only_bytes = 0
        active_graph_candidate_bytes = 0
        active_graph_groups = 0
        active_graph_manifests = []
        analyzable_cargo_components = [
            item
            for item in components
            if item.get("cargo")
            and item["class"] != "blocked"
            and item.get("manifest_path")
        ]
        triggered_manifests = {
            item["manifest_path"]
            for item in analyzable_cargo_components
            if deep_rust and item["bytes"] >= args.deep_rust_min_bytes
        }
        for manifest_path in sorted(triggered_manifests):
            entries = [
                (item, profile)
                for item in analyzable_cargo_components
                if item["manifest_path"] == manifest_path
                for profile in cargo_profile_paths(item)
            ]
            profile_to_item = {
                profile.resolve(): item
                for item, profile in entries
            }
            analysis = cargo_gc.analyze_profiles(
                list(profile_to_item),
                Path(manifest_path),
                generation_cutoff,
                args.keep_generations,
                opened=opened,
                writer_active=writers["cargo"],
                max_groups=args.max_rust_groups,
            )
            analysis_only_bytes = int(
                analysis.get("conservative_reclaim_bytes", 0)
            )
            cleanup_groups = 0
            executable_reclaim_bytes = 0
            for report in analysis.get("profiles", []):
                report_analysis_only_bytes = int(
                    report.get("conservative_reclaim_bytes", 0)
                )
                report_cleanup_groups = 0
                report_executable_reclaim_bytes = 0
                for group in report.get("groups", []):
                    if current:
                        group["cleanup_enabled"] = False
                        group["execution_blocked_reason"] = (
                            "current worktrees are analysis-only"
                        )
                    if group["cleanup_enabled"]:
                        cleanup_groups += 1
                        report_cleanup_groups += 1
                        group_reclaim = int(group["conservative_reclaim_bytes"])
                        executable_reclaim_bytes += group_reclaim
                        report_executable_reclaim_bytes += group_reclaim
                report["analysis_only_conservative_bytes"] = (
                    report_analysis_only_bytes
                )
                report["cleanup_enabled_groups"] = report_cleanup_groups
                report["conservative_reclaim_bytes"] = (
                    report_executable_reclaim_bytes
                )
            analysis["analysis_only_conservative_bytes"] = analysis_only_bytes
            analysis["cleanup_enabled_groups"] = cleanup_groups
            analysis["conservative_reclaim_bytes"] = executable_reclaim_bytes
            active_graph_manifests.append(
                {
                    key: value
                    for key, value in analysis.items()
                    if key != "profiles"
                }
            )
            for report in analysis.get("profiles", []):
                item = profile_to_item.get(Path(report["profile"]).resolve())
                if item is None:
                    continue
                for group in report.get("groups", []):
                    candidate_id = (
                        f"{item['id']}:rust:{Path(report['profile']).name}:"
                        f"{group['id']}"
                    )
                    group["candidate_id"] = candidate_id
                    if group["cleanup_enabled"]:
                        group["cleanup_id"] = candidate_id
                item.setdefault("rust_active_graph_gc", []).append(report)
                deep_component_ids.add(item["id"])
            active_graph_analysis_only_bytes += analysis_only_bytes
            active_graph_reclaim_bytes += executable_reclaim_bytes
            active_graph_candidate_bytes += int(
                analysis.get("candidate_allocated_upper_bound_bytes", 0)
            )
            active_graph_groups += int(analysis.get("candidate_groups", 0))

        fallback_components = [
            item
            for item in components
            if item["id"] not in deep_component_ids
            and item["class"] != "blocked"
        ]
        deps, build, incremental, generation_counts = rust_rebuildable_candidates(
            fallback_components,
            generation_cutoff,
            args.keep_generations,
        )
        rebuildable_bytes = allocated_tree_bytes(deps + build + incremental)
        nested_summary["safe_now"] += safe_bytes
        nested_summary["rebuildable_cache"] += (
            rebuildable_bytes + active_graph_candidate_bytes
        )
        nested_summary["active_graph_reclaim"] += active_graph_reclaim_bytes
        nested_summary["active_graph_analysis_only"] += (
            active_graph_analysis_only_bytes
        )
        worktree_reports.append(
            {
                "name": record["name"],
                "root": str(root),
                "branch": record.get("branch"),
                "head": record.get("head"),
                "workspace_id": context.get("workspace_id"),
                "component_identity": identity,
                "current": current,
                "current_reasons": {
                    "active_declarations": [
                        {
                            "task_id": declaration.get("taskId"),
                            "work_item_id": declaration.get("workItemId"),
                            "purpose": declaration.get("purpose"),
                            "source_claims": [
                                claim.get("pathPrefix")
                                for claim in declaration.get("sourceClaims", [])
                                if isinstance(claim, dict) and claim.get("pathPrefix")
                            ],
                        }
                        for declaration in declarations
                    ],
                    "dirty_path_count": len(dirty_paths),
                    "demand_domains": sorted(demand),
                    "processes": [
                        process_for_report(process)
                        for process in processes
                    ],
                },
                "demand": demand,
                "components": components,
                "safe_now": {
                    "old_test_binaries": {
                        "files": len(safe_binaries),
                        "allocated_upper_bound_bytes": safe_bytes,
                    }
                },
                "rebuildable_cache": {
                    "old_deps_generations": generation_counts["deps"],
                    "old_build_generations": generation_counts["build"],
                    "old_incremental_directories": generation_counts["incremental"],
                    "allocated_upper_bound_bytes": (
                        rebuildable_bytes + active_graph_candidate_bytes
                    ),
                    "deletion_enabled": False,
                },
                "rust_active_graph_gc": {
                    "components": len(deep_component_ids),
                    "manifests": active_graph_manifests,
                    "candidate_groups": active_graph_groups,
                    "candidate_allocated_upper_bound_bytes": (
                        active_graph_candidate_bytes
                    ),
                    "conservative_reclaim_bytes": active_graph_reclaim_bytes,
                    "analysis_only_conservative_bytes": (
                        active_graph_analysis_only_bytes
                    ),
                    "deletion_enabled": active_graph_reclaim_bytes > 0,
                },
            }
        )

    return {
        "schema_version": 2,
        "scan_time": int(time.time()),
        "repo_root": str(repo_root),
        "disk_available_bytes": shutil.disk_usage(repo_root).free,
        "prunable_worktrees": prunable,
        "summary_bytes": {
            key: int(summary.get(key, 0))
            for key in CLASS_ORDER
        },
        "nested_candidate_bytes": {
            "safe_now": int(nested_summary["safe_now"]),
            "rebuildable_cache": int(nested_summary["rebuildable_cache"]),
            "active_graph_reclaim": int(nested_summary["active_graph_reclaim"]),
            "active_graph_analysis_only": int(
                nested_summary["active_graph_analysis_only"]
            ),
            "additive_to_component_summary": False,
        },
        "worktrees": worktree_reports,
    }


def cleanup_worktree_name(cleanup_id: str) -> str:
    owner = cleanup_id.split(":", 1)[0]
    return owner.split("@", 1)[0]


def validate_cleanup_path(path: Path, worktree_root: Path) -> None:
    root = Path(os.path.abspath(str(worktree_root)))
    candidate = Path(os.path.abspath(str(path)))
    try:
        relative = candidate.relative_to(root)
    except ValueError as error:
        raise RuntimeError(f"cleanup path escapes worktree: {candidate}") from error
    current = root
    if current.is_symlink():
        raise RuntimeError(f"worktree root is a symbolic link: {current}")
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise RuntimeError(f"cleanup path contains a symbolic link: {current}")


def open_directory_beneath(worktree_root: Path, directory: Path) -> int:
    nofollow = getattr(os, "O_NOFOLLOW", None)
    directory_flag = getattr(os, "O_DIRECTORY", None)
    if nofollow is None or directory_flag is None:
        raise RuntimeError("descriptor-safe cleanup is unavailable on this platform")
    validate_cleanup_path(directory, worktree_root)
    root = Path(os.path.abspath(str(worktree_root)))
    candidate = Path(os.path.abspath(str(directory)))
    relative = candidate.relative_to(root)
    flags = os.O_RDONLY | directory_flag | nofollow
    current_fd = os.open(str(root), flags)
    try:
        for part in relative.parts:
            next_fd = os.open(part, flags, dir_fd=current_fd)
            os.close(current_fd)
            current_fd = next_fd
        return current_fd
    except BaseException:
        os.close(current_fd)
        raise


def cargo_locks(
    profiles: Sequence[Path],
    worktree_root: Path,
) -> Tuple[List[Dict[str, Any]], Optional[Path]]:
    records = []
    lock_flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
    for profile in profiles:
        try:
            directory_fd = open_directory_beneath(worktree_root, profile)
            lock_fd = os.open(
                ".cargo-lock",
                lock_flags,
                0o600,
                dir_fd=directory_fd,
            )
            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (OSError, BlockingIOError, RuntimeError):
            if "lock_fd" in locals():
                os.close(lock_fd)
                del lock_fd
            if "directory_fd" in locals():
                os.close(directory_fd)
                del directory_fd
            release_cargo_locks(records)
            return [], profile / ".cargo-lock"
        records.append(
            {
                "profile": Path(os.path.abspath(str(profile))),
                "directory_fd": directory_fd,
                "lock_fd": lock_fd,
            }
        )
        del directory_fd
        del lock_fd
    return records, None


def release_cargo_locks(records: Sequence[Dict[str, Any]]) -> None:
    for record in records:
        os.close(record["lock_fd"])
        os.close(record["directory_fd"])


def verify_locked_profile_identity(records: Sequence[Dict[str, Any]]) -> None:
    for record in records:
        profile = record["profile"]
        try:
            path_stat = os.stat(profile, follow_symlinks=False)
            fd_stat = os.fstat(record["directory_fd"])
        except OSError as error:
            raise RuntimeError(
                f"locked Cargo profile identity is unavailable: {profile}"
            ) from error
        if stat.S_ISLNK(path_stat.st_mode):
            raise RuntimeError(f"locked Cargo profile became a symlink: {profile}")
        if (path_stat.st_dev, path_stat.st_ino) != (
            fd_stat.st_dev,
            fd_stat.st_ino,
        ):
            raise RuntimeError(f"locked Cargo profile identity changed: {profile}")


def assert_worktree_inactive(worktree: Dict[str, Any]) -> None:
    root = Path(worktree["root"]).resolve()
    processes = process_inventory([root]).get(root, [])
    context = development_context(
        Path.home(),
        [
            {
                "root": str(root),
                "branch": worktree.get("branch"),
            }
        ],
    ).get(root, {"declarations": []})
    if processes or git_dirty_paths(root) or context.get("declarations"):
        raise RuntimeError("worktree became active after Cargo locks were acquired")


def remove_directory_at(parent_fd: int, name: str) -> None:
    flags = (
        os.O_RDONLY
        | getattr(os, "O_DIRECTORY", 0)
        | getattr(os, "O_NOFOLLOW", 0)
    )
    directory_fd = os.open(name, flags, dir_fd=parent_fd)
    try:
        for child_name in os.listdir(directory_fd):
            child_stat = os.stat(
                child_name,
                dir_fd=directory_fd,
                follow_symlinks=False,
            )
            if stat.S_ISDIR(child_stat.st_mode):
                remove_directory_at(directory_fd, child_name)
            else:
                os.unlink(child_name, dir_fd=directory_fd)
    finally:
        os.close(directory_fd)
    os.rmdir(name, dir_fd=parent_fd)


def remove_beneath(directory_fd: int, relative_path: Path) -> None:
    if relative_path.is_absolute() or not relative_path.parts:
        raise RuntimeError(f"invalid descriptor-relative path: {relative_path}")
    if any(part in ("", ".", "..") for part in relative_path.parts):
        raise RuntimeError(f"unsafe descriptor-relative path: {relative_path}")
    flags = (
        os.O_RDONLY
        | getattr(os, "O_DIRECTORY", 0)
        | getattr(os, "O_NOFOLLOW", 0)
    )
    parent_fd = os.dup(directory_fd)
    try:
        for part in relative_path.parts[:-1]:
            next_fd = os.open(part, flags, dir_fd=parent_fd)
            os.close(parent_fd)
            parent_fd = next_fd
        name = relative_path.parts[-1]
        entry_stat = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        if stat.S_ISLNK(entry_stat.st_mode):
            raise RuntimeError(f"cleanup target became a symbolic link: {relative_path}")
        if stat.S_ISDIR(entry_stat.st_mode):
            remove_directory_at(parent_fd, name)
        else:
            os.unlink(name, dir_fd=parent_fd)
    finally:
        os.close(parent_fd)


def lock_for_path(
    locks: Sequence[Dict[str, Any]],
    path: Path,
) -> Tuple[Dict[str, Any], Path]:
    candidate = Path(os.path.abspath(str(path)))
    for record in locks:
        try:
            relative = candidate.relative_to(record["profile"])
        except ValueError:
            continue
        return record, relative
    raise RuntimeError(f"cleanup path is outside locked Cargo profiles: {candidate}")


def clean_safe(args: argparse.Namespace) -> Dict[str, Any]:
    report = scan(args, include_open_paths=False, deep_rust=False)
    candidate_groups = []
    skipped_locks = []
    for worktree in report["worktrees"]:
        writers = writer_state(worktree["current_reasons"]["processes"])
        if worktree["current"] or writers["cargo"]:
            continue
        for item in worktree["components"]:
            if not item.get("cargo"):
                continue
            profiles = cargo_profile_paths(item)
            if not profiles:
                continue
            locks, blocked_lock = cargo_locks(
                profiles,
                Path(worktree["root"]),
            )
            if blocked_lock:
                skipped_locks.append(str(blocked_lock))
                continue
            candidate_groups.append(
                (worktree, item, locks)
            )

    before = shutil.disk_usage(args.repo_root).free
    removed = []
    try:
        for worktree, item, locks in candidate_groups:
            assert_worktree_inactive(worktree)
            opened_after_lock = opened_paths()
            candidates = old_test_binaries(
                [item],
                time.time() - args.binary_age_days * 86400,
                opened_after_lock,
            )
            verify_locked_profile_identity(locks)
            for path in candidates:
                try:
                    lock, relative = lock_for_path(locks, path)
                    remove_beneath(lock["directory_fd"], relative)
                    removed.append(str(path))
                except OSError:
                    continue
    finally:
        for _, _, locks in candidate_groups:
            release_cargo_locks(locks)
    after = shutil.disk_usage(args.repo_root).free
    return {
        "removed_files": len(removed),
        "skipped_cargo_locks": skipped_locks,
        "disk_free_before": before,
        "disk_free_after": after,
        "disk_free_delta": after - before,
    }


def clean_rust_group(args: argparse.Namespace) -> Dict[str, Any]:
    args.worktree = [cleanup_worktree_name(args.clean_rust_group_id)]
    report = scan(args, include_open_paths=False, deep_rust=False)
    selected_item = None
    selected_worktree = None
    profile_name = None
    fingerprint_id = None
    for worktree in report["worktrees"]:
        for item in worktree["components"]:
            prefix = f"{item['id']}:rust:"
            if not args.clean_rust_group_id.startswith(prefix):
                continue
            remainder = args.clean_rust_group_id[len(prefix) :]
            if ":" not in remainder:
                continue
            profile_name, fingerprint_id = remainder.split(":", 1)
            selected_item = item
            selected_worktree = worktree
            break
        if selected_item:
            break
    if not selected_item or not selected_worktree or not profile_name or not fingerprint_id:
        raise RuntimeError(
            f"unknown Rust generation id: {args.clean_rust_group_id}"
        )
    if selected_worktree["current"]:
        raise RuntimeError(
            "active worktrees are analysis-only; quiesce the worktree before cleanup"
        )
    if selected_item["class"] != "derived_idle":
        raise RuntimeError(
            "Rust generation cleanup requires an inactive derived component"
        )
    if not selected_item.get("manifest_path"):
        raise RuntimeError("Cargo manifest is unavailable for selected component")
    writers = writer_state(selected_worktree["current_reasons"]["processes"])
    if writers["cargo"]:
        raise RuntimeError("Cargo or rustc is active in the selected worktree")

    selected_profiles = {
        profile.name: profile
        for profile in cargo_profile_paths(selected_item)
    }
    profile = selected_profiles.get(profile_name)
    if profile is None:
        raise RuntimeError(f"Cargo profile is unavailable: {profile_name}")

    related_items = [
        item
        for item in selected_worktree["components"]
        if item.get("cargo")
        and item["class"] != "blocked"
        and item.get("manifest_path") == selected_item["manifest_path"]
    ]
    related_profiles = list(
        dict.fromkeys(
            candidate
            for item in related_items
            for candidate in cargo_profile_paths(item)
        )
    )
    worktree_root = Path(selected_worktree["root"])
    for related_profile in related_profiles:
        validate_cleanup_path(related_profile, worktree_root)
    locks, blocked_lock = cargo_locks(related_profiles, worktree_root)
    if blocked_lock:
        raise RuntimeError(f"Cargo lock is held: {blocked_lock}")
    before = shutil.disk_usage(args.repo_root).free
    removed_paths = 0
    selected_group = None
    try:
        assert_worktree_inactive(selected_worktree)
        opened = opened_paths()
        graph_report = cargo_gc.analyze_profiles(
            related_profiles,
            Path(selected_item["manifest_path"]),
            time.time() - args.generation_age_days * 86400,
            args.keep_generations,
            opened=opened,
            writer_active=False,
            max_groups=sys.maxsize,
            include_paths=True,
        )
        verify_locked_profile_identity(locks)
        for profile_report in graph_report.get("profiles", []):
            if Path(profile_report["profile"]).resolve() != profile.resolve():
                continue
            for group in profile_report.get("groups", []):
                if group["id"] == fingerprint_id:
                    selected_group = group
                    break
        if selected_group is None:
            raise RuntimeError(
                "Rust generation is no longer an unreachable candidate"
            )
        if not selected_group["cleanup_enabled"]:
            raise RuntimeError(
                f"Rust generation is blocked: {selected_group['reason']}"
            )
        for path in selected_group["_path_objects"]:
            validate_cleanup_path(path, worktree_root)
            lock, relative = lock_for_path(locks, path)
            remove_beneath(lock["directory_fd"], relative)
            removed_paths += 1
    finally:
        release_cargo_locks(locks)
    after = shutil.disk_usage(args.repo_root).free
    return {
        "removed_rust_generation": args.clean_rust_group_id,
        "removed_paths": removed_paths,
        "estimated_allocated_upper_bound_bytes": (
            selected_group["allocated_upper_bound_bytes"]
            if selected_group
            else 0
        ),
        "estimated_conservative_reclaim_bytes": (
            selected_group["conservative_reclaim_bytes"]
            if selected_group
            else 0
        ),
        "disk_free_before": before,
        "disk_free_after": after,
        "disk_free_delta": after - before,
    }


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    default_root = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=default_root)
    parser.add_argument("--binary-age-days", type=int, default=7)
    parser.add_argument("--generation-age-days", type=int, default=14)
    parser.add_argument("--keep-generations", type=int, default=4)
    parser.add_argument("--worktree", action="append")
    parser.add_argument(
        "--deep-rust-min-bytes",
        type=int,
        default=512 * 1024 * 1024,
    )
    parser.add_argument("--max-rust-groups", type=int, default=100)
    parser.add_argument("--clean-safe", action="store_true")
    parser.add_argument("--clean-rust-group-id")
    parser.add_argument("--confirm", action="store_true")
    parser.add_argument("--accept-alternate-config-rebuild", action="store_true")
    args = parser.parse_args(argv)
    cleanup_modes = sum(
        bool(value)
        for value in (
            args.clean_safe,
            args.clean_rust_group_id,
        )
    )
    if cleanup_modes > 1:
        parser.error("cleanup modes are mutually exclusive")
    if cleanup_modes and not args.confirm:
        parser.error("--confirm is required for deletion")
    if (
        args.clean_rust_group_id
        and not args.accept_alternate_config_rebuild
    ):
        parser.error(
            "--accept-alternate-config-rebuild is required for Rust generation GC"
        )
    return args


def main(argv: Sequence[str]) -> int:
    args = parse_args(argv)
    try:
        if args.clean_safe:
            result = clean_safe(args)
        elif args.clean_rust_group_id:
            result = clean_rust_group(args)
        else:
            result = scan(args)
    except RuntimeError as error:
        json.dump({"error": str(error)}, sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 2
    json.dump(result, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
