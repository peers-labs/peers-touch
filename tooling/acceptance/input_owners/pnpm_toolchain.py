"""Read-only installed pnpm delegation inputs; no Gate/build qualification."""

from __future__ import annotations

import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
from typing import Any

from .installed_inputs import (
    executable_input, file_digest, macos_library_inputs, selection_input, tree_digest,
)


WORKER = Path(__file__).with_name("pnpm_observation.cjs")
MARKER = "PT_PNPM_INSTALLATION_OBSERVATION="
VERSION = re.compile(r"pnpm@([0-9]+\.[0-9]+\.[0-9]+)")


def installed_package(entry: Path) -> Path:
    """Resolve an actual manifest/bin pair, including the tools-directory link."""
    resolved = entry.resolve(strict=True)
    package = resolved.parent.parent
    manifest = json.loads((package / "package.json").read_text())
    if (
        manifest.get("name") != "pnpm"
        or not isinstance(manifest.get("bin"), dict)
        or manifest["bin"].get("pnpm") != resolved.relative_to(package).as_posix()
        or not resolved.read_bytes().startswith(b"#!/usr/bin/env node\n")
    ):
        raise ValueError("pnpm delegate has no closed installed manifest/bin pair")
    return package


def pnpm_entry() -> tuple[Path, Path]:
    selected = shutil.which("pnpm")
    if selected is None:
        raise ValueError("pnpm is unavailable")
    path = Path(selected)
    return path, installed_package(path)


def manifest_selection(root: Path) -> dict[str, Any]:
    """Bind pnpm's actual nearest workspace search and its manifest origin."""
    if any(os.environ.get(key) for key in (
        "NPM_CONFIG_WORKSPACE_DIR", "npm_config_workspace_dir",
        "NPM_CONFIG_LOCKFILE_DIR", "npm_config_lockfile_dir",
        "NPM_CONFIG_LOCKFILE_DIRECTORY", "npm_config_lockfile_directory",
    )):
        raise ValueError("configured pnpm workspace origin requires another owner")
    root = root.resolve(strict=True)
    paths = {}
    selected = root
    for parent in (root, *root.parents):
        found = False
        for name in (
            "pnpm-workspace.yaml", "pnpm-workspaces.yaml",
            "pnpm-workspaces.yml", "pnpm-workspace.yml",
        ):
            path = parent / name
            paths[str(path)] = (
                {"selection": selection_input(path), "bytes": file_digest(path)}
                if path.is_file() else "absent"
            )
            if path.exists():
                if name != "pnpm-workspace.yaml" or not path.is_file():
                    raise ValueError("pnpm workspace manifest is not qualified")
                selected = parent
                found = True
        if found:
            break
    manifest = selected / "package.json"
    paths[str(manifest)] = (
        {"selection": selection_input(manifest), "bytes": file_digest(manifest)}
        if manifest.is_file() else "absent"
    )
    return {"manifest": str(manifest), "search": paths}


def delegation_candidates(root: Path, selected: Path) -> dict[str, tuple[Path, Path]]:
    """Admit installed delegates only; never let a probe install a missing CLI."""
    if platform.system() != "Darwin":
        raise ValueError("pnpm delegation selection requires its qualified platform")
    candidates = {str(selected.resolve(strict=True)): (installed_package(selected), selected)}
    manifest = Path(manifest_selection(root)["manifest"])
    wanted = json.loads(manifest.read_text()).get("packageManager") if manifest.is_file() else None
    if wanted is None:
        return candidates
    match = VERSION.fullmatch(wanted) if isinstance(wanted, str) else None
    if match is None:
        raise ValueError("pnpm packageManager selection is not a qualified exact version")
    current = json.loads((installed_package(selected) / "package.json").read_text())
    if (
        current.get("version") == match[1]
        or os.environ.get("npm_config_manage_package_manager_versions") == "false"
    ):
        return candidates
    # Installed pnpm getDataDir: PNPM_HOME, XDG_DATA_HOME/pnpm, Darwin homedir.
    home = (
        Path(os.environ["PNPM_HOME"]) if os.environ.get("PNPM_HOME") else
        Path(os.environ["XDG_DATA_HOME"]) / "pnpm" if os.environ.get("XDG_DATA_HOME") else
        Path.home() / "Library/pnpm"
    )
    if not home.is_absolute():
        raise ValueError("relative pnpm tools origin is unqualified")
    child = home / ".tools/pnpm" / match[1] / "bin/pnpm"
    if not child.is_file() or not os.access(child, os.X_OK):
        raise ValueError("pnpm version delegate is not already installed")
    package = installed_package(child)
    if json.loads((package / "package.json").read_text()).get("version") != match[1]:
        raise ValueError("installed pnpm delegate conflicts with packageManager")
    candidates[str(child.resolve(strict=True))] = (package, child)
    return candidates


def observe_command(
    node: str, entry: Path, root: Path, argv: list[str], *,
    output_limit: int = 1024 * 1024,
) -> tuple[str, list[dict]]:
    """Retain command output and require complete, bounded exit observations."""
    if not 0 < output_limit <= 16 * 1024 * 1024:
        raise ValueError("pnpm observation output limit is not bounded")
    try:
        completed = subprocess.run(
            [node, str(WORKER), str(entry), *argv],
            cwd=root, capture_output=True, text=True, check=True, timeout=2,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise ValueError("pnpm installed input observation did not complete") from error
    if len(completed.stdout.encode()) > output_limit:
        raise ValueError("pnpm observation exceeds its bounded inventory")
    observations = []
    output = []
    for line in completed.stdout.splitlines(keepends=True):
        if line.startswith(MARKER):
            observations.append(json.loads(line.removeprefix(MARKER)))
        else:
            output.append(line)
    if not 1 <= len(observations) <= 2:
        raise ValueError("pnpm did not report its complete installed delegation")
    return "".join(output).strip(), observations


def pnpm_installation(root: Path) -> dict[str, Any]:
    """Bind both actual CLI installations, executable/images and cache resolution."""
    if os.environ.get("NODE_DISABLE_COMPILE_CACHE") != "1" or any(
        os.environ.get(key) for key in (
            "NODE_OPTIONS", "NODE_PATH", "NODE_EXTRA_CA_CERTS", "OPENSSL_CONF",
            "OPENSSL_MODULES", "ICU_DATA", "NODE_ICU_DATA",
        )
    ):
        raise ValueError("pnpm loader or compile cache requires its own input owner")
    selected, _ = pnpm_entry()
    candidates = delegation_candidates(root, selected)
    for parent in (root, *root.parents):
        if (parent / ".pnpmfile.cjs").exists():
            raise ValueError("implicit pnpm hook requires its own input owner")
    node = executable_input("node")
    runs = {}
    installations = {}
    libraries = {}
    for name, arguments in (
        ("version", ["--version"]), ("configuration", ["config", "list", "--json"]),
    ):
        output, observations = observe_command(node["path"], selected, root, arguments)
        entries = [value.get("entry") for value in observations]
        if (
            entries[-1] != str(selected.resolve(strict=True))
            or len(entries) != len(set(entries))
            or any(entry not in candidates for entry in entries)
        ):
            raise ValueError("pnpm observed an unqualified delegation chain")
        for value in observations:
            if (
                set(value) != {
                    "entry", "executable", "versions", "architecture", "platform",
                    "modules", "libraries", "optionalCache", "compileCacheDisabled",
                }
                or value["executable"] != node["resolvedPath"]
                or value["compileCacheDisabled"] is not True
                or value["platform"] != "darwin"
                or not isinstance(value["versions"], dict)
                or not isinstance(value["modules"], list) or not value["modules"]
                or not isinstance(value["libraries"], list) or not value["libraries"]
                or value["optionalCache"] != {"absent": True}
            ):
                raise ValueError("pnpm installed code/image observation is incomplete")
            package, origin = candidates[value["entry"]]
            if any(
                not Path(filename).resolve(strict=True).is_relative_to(package)
                for filename in value["modules"]
            ):
                raise ValueError("external pnpm module needs another owner")
            native = []
            for filename in package.rglob("*.node"):
                with filename.open("rb") as source:
                    magic = source.read(4)
                if magic in {
                    b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf",
                    b"\xce\xfa\xed\xfe", b"\xfe\xed\xfa\xce",
                    b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca",
                }:
                    native.append(filename)
            libraries.update(macos_library_inputs(native))
            for filename in value["libraries"]:
                if filename.startswith(("/usr/lib/", "/System/Library/")):
                    continue
                path = Path(filename).resolve(strict=True)
                libraries[str(path)] = file_digest(path)
            installed = {
                "package": str(package), "bytes": tree_digest(package),
                "selection": selection_input(origin),
                "nativeModules": {str(path): file_digest(path) for path in native},
            }
            if value["entry"] in installations and installations[value["entry"]] != installed:
                raise ValueError("pnpm installed inputs changed during observation")
            installations[value["entry"]] = installed
        result = json.loads(output) if name == "configuration" else output
        if name == "version" and result != json.loads(
            (candidates[entries[0]][0] / "package.json").read_text()
        ).get("version"):
            raise ValueError("pnpm version output conflicts with the actual delegate")
        if name == "configuration" and (
            not isinstance(result, dict)
            or any(result.get(key) for key in ("pnpmfile", "global-pnpmfile", "use-node-version"))
        ):
            raise ValueError("pnpm hooks/Node redirection require their concrete owner")
        runs[name] = {"result": result, "processes": observations}
    if runs["version"]["processes"] != runs["configuration"]["processes"]:
        # Module sets differ by command; delegate ordering and images must not.
        identity_fields = ("entry", "executable", "versions", "architecture", "platform")
        if [
            {key: item[key] for key in identity_fields}
            for item in runs["version"]["processes"]
        ] != [
            {key: item[key] for key in identity_fields}
            for item in runs["configuration"]["processes"]
        ]:
            raise ValueError("pnpm selected different tools during input observation")
    return {
        "selected": str(selected), "resolved": str(selected.resolve(strict=True)),
        "node": node, "installations": installations, "libraries": libraries, "runs": runs,
        "projectSelection": manifest_selection(root),
    }
