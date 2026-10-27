"""Actual pnpm project dependencies and execution paths; no build qualification."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
from typing import Any

from tooling.acceptance.core.execution_budget import digest
from .installed_inputs import (
    executable_input, file_digest, macos_library_inputs, selection_input, tree_digest,
)
from .pnpm_toolchain import observe_command, pnpm_entry, pnpm_installation


def dependency_paths(inventory: Any, cwd: Path) -> dict[str, str]:
    """Retain every actual installed resolution, including duplicate versions."""
    if (
        not isinstance(inventory, list) or len(inventory) != 1
        or not isinstance(inventory[0], dict)
        or Path(inventory[0].get("path", "")).resolve(strict=True) != cwd
    ):
        raise ValueError("pnpm dependency inventory does not own this project")
    paths: dict[str, str] = {}

    def visit(item: dict[str, Any]) -> None:
        for section in ("dependencies", "devDependencies", "optionalDependencies"):
            entries = item.get(section, {})
            if not isinstance(entries, dict):
                raise ValueError("pnpm dependency section is not a closed object")
            for name, child in entries.items():
                if not isinstance(child, dict) or not isinstance(child.get("path"), str):
                    raise ValueError("pnpm dependency has no installed path")
                location = child["path"]
                if not Path(location).is_absolute():
                    raise ValueError("pnpm dependency path is not absolute")
                if location in paths and paths[location] != name:
                    raise ValueError("pnpm dependency path has conflicting owners")
                paths[location] = name
                if len(paths) > 4096:
                    raise ValueError("pnpm dependency inventory exceeds its bounded roots")
                visit(child)

    visit(inventory[0])
    return paths


def project_command(
    arguments: list[str], cwd: Path, installation: dict[str, Any], *,
    json_output: bool = True,
) -> Any:
    """Observe the unchanged CLI and require its already qualified delegate chain."""
    selected, _ = pnpm_entry()
    output, processes = observe_command(
        installation["node"]["path"], selected, cwd, arguments,
        output_limit=16 * 1024 * 1024,
    )
    fields = ("entry", "executable", "versions", "architecture", "platform")
    actual = [{key: item.get(key) for key in fields} for item in processes]
    expected = [
        {key: item[key] for key in fields}
        for item in installation["runs"]["configuration"]["processes"]
    ]
    if actual != expected:
        raise ValueError("pnpm project selected another installed delegate")
    return json.loads(output) if json_output else output


def dependency_links(path: Path, manifest: dict[str, Any], roots: set[Path]) -> dict[str, Any]:
    """Bind each real ancestor package link, and only declared optional absence."""
    dependencies = {
        **manifest.get("dependencies", {}), **manifest.get("peerDependencies", {}),
        **manifest.get("optionalDependencies", {}),
    }
    records = {}
    for name in sorted(dependencies):
        if "/" in name.removeprefix("@").replace("/", "", 1) or ".." in name.split("/"):
            raise ValueError("pnpm dependency name is not a package path")
        optional = (
            name in manifest.get("optionalDependencies", {})
            or manifest.get("peerDependenciesMeta", {}).get(name, {}).get("optional") is True
        )
        search = {}
        target = None
        for parent in (path, *path.parents):
            if parent.name == "node_modules":
                continue
            origin = parent / "node_modules" / name
            if origin.exists():
                resolved = origin.resolve(strict=True)
                if resolved not in roots or not (resolved / "package.json").is_file():
                    raise ValueError("pnpm dependency resolves outside the observed package roots")
                search[str(origin)] = selection_input(origin)
                target = str(resolved)
                break
            search[str(origin)] = (
                {"brokenLink": os.readlink(origin)} if origin.is_symlink() else "absent"
            )
        if target is None and not optional:
            raise ValueError("required pnpm dependency has no observed installed resolution")
        records[name] = {"search": search, "target": target, "optional": optional}
    return records


def pnpm_project_inputs(cwd: Path) -> dict[str, Any]:
    """Resolve with pnpm, hash package content, and retain workspace input gaps."""
    cwd = cwd.resolve(strict=True)
    installation = pnpm_installation(cwd)
    configuration = project_command(["config", "list", "--json"], cwd, installation)
    if not isinstance(configuration, dict) or any(
        configuration.get(key) for key in (
            "pnpmfile", "global-pnpmfile", "use-node-version", "script-shell",
            "shell-emulator",
        )
    ):
        raise ValueError("pnpm project hook, Node or shell selection needs another owner")
    direct = project_command(
        ["list", "--depth", "0", "--json"], cwd, installation,
    )
    roots = dependency_paths(direct, cwd)
    inventory = project_command(
        ["list", "--depth", "Infinity", "--parseable"], cwd, installation,
        json_output=False,
    ).splitlines()
    if (
        not inventory or Path(inventory[0]).resolve(strict=True) != cwd
        or len(inventory) > 4097 or len(inventory) != len(set(inventory))
        or any(not Path(path).is_absolute() for path in inventory)
        or not set(roots).issubset(inventory)
    ):
        raise ValueError("pnpm flat inventory conflicts with its direct dependency roots")
    unavailable = {}
    for location in inventory[1:]:
        manifest = Path(location) / "package.json"
        if not manifest.is_file():
            unavailable[location] = "absent"
            continue
        name = json.loads(manifest.read_text()).get("name")
        if not isinstance(name, str):
            raise ValueError("pnpm flat inventory has no installed manifest owner")
        roots.setdefault(location, name)
    installed = {}
    workspace = {}
    native = []
    observed_roots = {Path(location).resolve(strict=True) for location in roots}
    observed_roots.add(cwd)
    for location, name in sorted(roots.items()):
        origin = Path(location)
        path = origin.resolve(strict=True)
        manifest = path / "package.json"
        value = json.loads(manifest.read_text())
        # Aliases keep their requested name in the resolution inventory.
        if not isinstance(value.get("name"), str) or not isinstance(value.get("version"), str):
            raise ValueError("pnpm installed dependency has no concrete manifest")
        record = {
            "requestedName": name, "selection": selection_input(origin),
            "manifest": file_digest(manifest),
            "dependencies": dependency_links(path, value, observed_roots),
        }
        if ".pnpm" not in path.parts:
            # Generated workspace outputs have their own producer lifecycle.
            # Recording the source does not qualify those outputs for reuse.
            record["source"] = tree_digest(path, excluded_children=frozenset({
                "node_modules", "target", "dist", ".local", ".git",
            }))
            workspace[location] = record
            continue
        record["content"] = tree_digest(path, excluded_children=frozenset({"node_modules"}))
        installed[location] = record
        for parent, directories, files in os.walk(path):
            directories[:] = sorted(name for name in directories if name != "node_modules")
            native.extend(Path(parent) / name for name in sorted(files) if name.endswith(".node"))
    libraries = macos_library_inputs(native)
    node = installation["node"]
    selected, _ = pnpm_entry()
    completed = subprocess.run(
        [str(selected), "exec", node["path"], "-e",
         "process.stdout.write(JSON.stringify({cwd:process.cwd(),path:process.env.PATH,"
         "execPath:process.execPath,libraries:process.report.getReport().sharedObjects}))"],
        cwd=cwd, capture_output=True, text=True, check=True, timeout=2,
    )
    if len(completed.stdout.encode()) > 1024 * 1024:
        raise ValueError("pnpm execution environment exceeds its bounded inventory")
    execution = json.loads(completed.stdout)
    if (
        set(execution) != {"cwd", "path", "execPath", "libraries"}
        or Path(execution["cwd"]).resolve(strict=True) != cwd
        or execution["execPath"] != node["resolvedPath"]
        or not isinstance(execution["path"], str)
        or not isinstance(execution["libraries"], list)
    ):
        raise ValueError("pnpm execution environment is incomplete")
    for location in execution["libraries"]:
        if not location.startswith(("/usr/lib/", "/System/Library/")):
            path = Path(location).resolve(strict=True)
            libraries[str(path)] = file_digest(path)
    tools = {}
    search = os.pathsep.join(
        str(path if path.is_absolute() else cwd / path)
        for path in map(Path, execution["path"].split(os.pathsep))
    )
    for name in ("node", "pnpm", "sh", "dirname", "sed", "uname"):
        selected_tool = shutil.which(name, path=search)
        if selected_tool is None:
            raise ValueError("pnpm script tool selection is unavailable")
        origin = Path(selected_tool)
        if not origin.is_absolute():
            origin = cwd / origin
        tools[name] = selection_input(origin)
        if name == "pnpm":
            tools[name]["installation"] = digest(installation)
        else:
            tools[name]["executable"] = executable_input(str(origin))
    return {
        "cwd": str(cwd), "installation": installation,
        "configurationDigest": digest(configuration),
        "resolutionDigest": digest({"direct": direct, "paths": inventory}),
        "installedPackages": installed,
        "unavailablePaths": unavailable,
        "workspaceSources": workspace, "execution": execution,
        "scriptTools": tools,
        "nativeModules": {str(path): file_digest(path) for path in native},
        "libraries": libraries,
        "qualification": "INSTALLED_PROJECT_INPUTS_ONLY",
    }
