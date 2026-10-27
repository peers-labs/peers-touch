"""Actual pnpm Node launcher selections; no tool execution or build proof."""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
from typing import Any

from tooling.acceptance.core.execution_budget import digest
from .installed_inputs import executable_input, file_digest, selection_input
from .pnpm_toolchain import pnpm_entry


WORKER = Path(__file__).with_name("pnpm_launcher_observation.cjs")
MARKER = "PT_PNPM_LAUNCHER_OBSERVATION="
TEMPLATE = """#!/bin/sh
basedir=$(dirname "$(echo "$0" | sed -e 's,\\\\,/,g')")

case `uname` in
    *CYGWIN*) basedir=`cygpath -w "$basedir"`;;
esac

if [ -z "$NODE_PATH" ]; then
  export NODE_PATH="{node_path}"
else
  export NODE_PATH="{node_path}:$NODE_PATH"
fi
if [ -x "$basedir/node" ]; then
  exec "$basedir/node"  "$basedir/{entry}" "$@"
else
  exec node  "$basedir/{entry}" "$@"
fi
"""


def launcher_entry(launcher: Path, name: str) -> tuple[Path, dict[str, Any]]:
    """Admit only the reviewed installed Node template and its manifest/bin."""
    text = launcher.read_text()
    paths = re.findall(r'^  export NODE_PATH="([^"$`\r\n]+)"$', text, re.MULTILINE)
    entries = re.findall(r'exec node  "\$basedir/([^"$`\r\n]+)" "\$@"', text)
    if (
        len(paths) != 1 or len(entries) != 1
        or text != TEMPLATE.format(node_path=paths[0], entry=entries[0])
        or any(character in paths[0] + entries[0] for character in "\\;&|<>")
        or any(not Path(path).is_absolute() for path in paths[0].split(os.pathsep))
    ):
        raise ValueError("pnpm bin is not the qualified installed Node launcher template")
    origin = launcher.parent / entries[0]
    entry = origin.resolve(strict=True)
    for parent in entry.parents:
        manifest = parent / "package.json"
        if not manifest.is_file():
            continue
        value = json.loads(manifest.read_text())
        bins = value.get("bin")
        target = bins.get(name) if isinstance(bins, dict) else bins
        if not isinstance(target, str) or not target:
            continue
        if (parent / target).resolve(strict=True) != entry:
            continue
        if not entry.read_bytes().startswith(b"#!/usr/bin/env node\n"):
            raise ValueError("pnpm bin entry is not a Node script")
        return entry, {
            "launcher": selection_input(launcher), "bytes": file_digest(launcher),
            "entry": selection_input(origin), "entryBytes": file_digest(entry),
            "manifest": selection_input(manifest), "manifestBytes": file_digest(manifest),
            "injectedNodePath": paths[0],
            "localNode": (
                selection_input(launcher.parent / "node")
                if (launcher.parent / "node").exists()
                else {"brokenLink": os.readlink(launcher.parent / "node")}
                if (launcher.parent / "node").is_symlink() else "absent"
            ),
        }
    raise ValueError("pnpm bin has no matching installed manifest/bin entry")


def search_root(path: Path) -> dict[str, Any]:
    """Bind current lookup names and links without qualifying unselected code."""
    if not path.exists():
        return (
            {"brokenLink": os.readlink(path)} if path.is_symlink() else {"state": "absent"}
        )
    if not path.is_dir():
        raise ValueError("Node global search root is not a directory")
    entries = {}

    def record(item: Path) -> None:
        key = item.relative_to(path).as_posix()
        if len(entries) >= 4096:
            raise ValueError("Node global search root exceeds its bounded names")
        if not item.exists():
            entries[key] = (
                {"brokenLink": os.readlink(item)} if item.is_symlink() else {"state": "absent"}
            )
        else:
            entries[key] = {
                "selection": selection_input(item),
                "kind": "directory" if item.is_dir() else "file",
                **({"bytes": file_digest(item)} if item.is_file() else {}),
            }

    for child in sorted(path.iterdir()):
        record(child)
        if child.name.startswith("@") and child.is_dir():
            for item in sorted(child.iterdir()):
                record(item)
    return {"selection": selection_input(path), "entries": entries}


def pnpm_launcher_inputs(
    cwd: Path, names: tuple[str, ...], installation: dict[str, Any],
) -> dict[str, Any]:
    """Observe the unchanged launcher chain, stopping before tool code executes."""
    if (
        not names or len(names) > 32 or len(names) != len(set(names))
        or any(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", name) is None for name in names)
        or os.environ.get("NODE_DISABLE_COMPILE_CACHE") != "1"
        or os.environ.get("NODE_OPTIONS") or os.environ.get("NODE_PATH")
    ):
        raise ValueError("pnpm launcher observation needs explicit bins and closed Node loading")
    cwd = cwd.resolve(strict=True)
    selected, _ = pnpm_entry()
    prepared = {}
    for name in names:
        launcher = cwd / "node_modules/.bin" / name
        if not launcher.is_file() or not os.access(launcher, os.X_OK):
            raise ValueError("pnpm selected project bin is unavailable")
        prepared[name] = launcher_entry(launcher, name)
    rows = {}
    roots = {}
    for name, (entry, inputs) in prepared.items():
        completed = subprocess.run(
            [str(selected), "exec", name], cwd=cwd,
            env={
                **os.environ, "NODE_OPTIONS": "--require=" + json.dumps(str(WORKER)),
                "PT_PNPM_LAUNCHER_ENTRY": str(entry),
            },
            capture_output=True, text=True, check=True, timeout=2,
        )
        output = completed.stdout.strip()
        if len(output.encode()) > 1024 * 1024 or not output.startswith(MARKER):
            raise ValueError("pnpm launcher environment observation is incomplete")
        value = json.loads(output.removeprefix(MARKER))
        if (
            set(value) != {
                "entry", "node", "cwd", "path", "nodePath", "globalPaths",
                "compileCacheDisabled", "libraries",
            }
            or value["entry"] != str(entry)
            or value["node"] != installation["node"]["resolvedPath"]
            or value["cwd"] != str(cwd)
            or value["nodePath"] != inputs["injectedNodePath"]
            or value["compileCacheDisabled"] is not True
            or not isinstance(value["path"], str) or not isinstance(value["globalPaths"], list)
            or not isinstance(value["libraries"], list)
            or len(value["globalPaths"]) > 64
            or any(not isinstance(path, str) or not Path(path).is_absolute()
                   for path in value["globalPaths"])
        ):
            raise ValueError("pnpm launcher selected an unqualified Node environment")
        path = os.pathsep.join(
            str(part if part.is_absolute() else cwd / part)
            for part in map(Path, value["path"].split(os.pathsep))
        )
        actual = shutil.which(name, path=path)
        if actual is None or Path(actual) != cwd / "node_modules/.bin" / name:
            raise ValueError("pnpm exec selected another bin origin")
        tools = {}
        for tool in ("node", "sh", "dirname", "sed", "uname"):
            origin = shutil.which(tool, path=path)
            if origin is None:
                raise ValueError("pnpm launcher utility is unavailable")
            tools[tool] = executable_input(origin)
        # The template's shebang owns /bin/sh even when PATH's sh differs.
        tools["launcherShell"] = executable_input("/bin/sh")
        libraries = {}
        for filename in value["libraries"]:
            if not isinstance(filename, str) or not Path(filename).is_absolute():
                raise ValueError("pnpm launcher library observation is incomplete")
            if not filename.startswith(("/usr/lib/", "/System/Library/")):
                library = Path(filename).resolve(strict=True)
                libraries[str(library)] = file_digest(library)
        for location in value["globalPaths"]:
            observed = search_root(Path(location))
            if location in roots and roots[location] != observed:
                raise ValueError("Node lookup roots changed during launcher observation")
            roots[location] = observed
        if launcher_entry(cwd / "node_modules/.bin" / name, name) != (entry, inputs):
            raise ValueError("pnpm launcher inputs changed during observation")
        rows[name] = {"inputs": inputs, "runtime": value, "tools": tools, "libraries": libraries}
    return {
        "cwd": str(cwd), "installationDigest": digest(installation),
        "observerBytes": file_digest(WORKER), "bins": rows, "searchRoots": roots,
        "qualification": "LAUNCHER_ENVIRONMENT_INPUTS_ONLY",
    }
