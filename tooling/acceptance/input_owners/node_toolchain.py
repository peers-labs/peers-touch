"""Concrete read-only owner for source checks using Node and explicit imports."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
from typing import Any

from tooling.acceptance.core.execution_budget import digest
from tooling.acceptance.core.operation_observer import runner_operation_stream
from .observation_trace import InputOwnerTrace
from .installed_inputs import (
    executable_input, file_digest, git_configuration, macos_library_inputs,
    make_installation, python_installation, tree_digest,
)


NODE_DISCOVERY = r"""
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const selections = JSON.parse(process.argv[1]);
const packages = {};
const resolutions = [];
function resolvePackage(name, origin, optional = false) {
  let entry;
  try {
    entry = fs.realpathSync(createRequire(origin).resolve(name));
  } catch (error) {
    if (optional && error.code === 'MODULE_NOT_FOUND') {
      resolutions.push({name, origin, absent: true});
      return;
    }
    throw error;
  }
  let root = path.dirname(entry);
  let manifest;
  while (true) {
    const candidate = path.join(root, 'package.json');
    if (fs.existsSync(candidate)) {
      const value = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (value.name === name) { manifest = value; break; }
    }
    const parent = path.dirname(root);
    if (parent === root) throw new Error('Unowned package entry');
    root = parent;
  }
  resolutions.push({name, origin, entry, root});
  if (packages[root]) return;
  packages[root] = {name, manifest};
  const dependencies = {...manifest.dependencies, ...manifest.peerDependencies,
                        ...manifest.optionalDependencies};
  for (const dependency of Object.keys(dependencies).sort()) {
    const optional = Object.hasOwn(manifest.optionalDependencies || {}, dependency)
      || manifest.peerDependenciesMeta?.[dependency]?.optional === true;
    resolvePackage(dependency, path.join(root, 'package.json'), optional);
  }
}
for (const selection of selections) {
  resolvePackage(selection.name, selection.origin);
}
process.stdout.write(JSON.stringify({
  executable: fs.realpathSync(process.execPath), versions: process.versions,
  architecture: process.arch, platform: process.platform, packages, resolutions,
  libraries: process.report.getReport().sharedObjects
}));
"""

NODE_SOURCE_TOOLS = frozenset({
    "node", "python3", "sh", "bash", "env", "git", "rg", "dirname",
    "sed", "sort", "mktemp", "rm", "cut", "awk", "ps", "sleep", "make",
})
PACKAGE_NAME = re.compile(r"^(?:@[A-Za-z0-9._-]+/)?[A-Za-z0-9._-]+$")


def node_installation(root: Path, imports: list[dict[str, str]]) -> dict[str, Any]:
    """Resolve actual package roots; never traverse a workspace node_modules tree."""
    node = executable_input("node")
    for item in imports:
        origin = Path(item["origin"])
        if (
            not PACKAGE_NAME.fullmatch(item["name"])
            or origin.is_absolute() or ".." in origin.parts
            or not (root / origin).is_file()
            or not (root / origin).resolve(strict=True).is_relative_to(root.resolve(strict=True))
        ):
            raise ValueError("Node import requires an exact repository-owned origin")
    if any(os.environ.get(key) for key in (
        "NODE_OPTIONS", "NODE_PATH", "NODE_EXTRA_CA_CERTS", "OPENSSL_CONF",
        "OPENSSL_MODULES", "ICU_DATA", "NODE_ICU_DATA",
    )):
        raise ValueError("configured Node loader needs its own material input owner")
    selections = [
        {"name": item["name"], "origin": str(root / item["origin"])}
        for item in imports
    ]
    try:
        completed = subprocess.run(
            [node["path"], "-e", NODE_DISCOVERY, json.dumps(selections)],
            cwd=root, capture_output=True, text=True, check=True, timeout=2,
        )
        if len(completed.stdout.encode()) > 1024 * 1024:
            raise ValueError("Node dependency resolution exceeds the bounded inventory")
        installation = json.loads(completed.stdout)
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError) as error:
        raise ValueError("Node installation inputs are unavailable") from error
    if installation["executable"] != node["resolvedPath"]:
        raise ValueError("Node executable changed during resolution")
    if platform.system() != "Darwin" or not installation["libraries"]:
        raise ValueError("Node loaded library observation requires a qualified platform")
    libraries = {}
    for location in installation["libraries"]:
        if location.startswith(("/usr/lib/", "/System/Library/")):
            continue
        path = Path(location).resolve(strict=True)
        libraries[str(path)] = file_digest(path)
    packages = {}
    for location, value in installation["packages"].items():
        package_root = Path(location)
        if any(package_root.rglob("*.node")):
            raise ValueError("native Node package needs its own library input owner")
        packages[location] = {
            "name": value["name"],
            "manifest": value["manifest"],
            "code": tree_digest(package_root, excluded_children=frozenset({"node_modules"})),
        }
    return {
        **installation, "packages": packages, "executableInput": node,
        "libraries": libraries,
    }


def node_source_observation(
    gate_id: str, context: dict[str, Any], *, root: Path,
    tools: list[str], imports: list[dict[str, str]],
    python_packages: list[str] | None = None,
) -> dict[str, Any]:
    gate = context["gate"]
    source = context["source"]
    if (
        gate["id"] != gate_id or not source or not context["contextDigest"]
        or gate.get("environment", "local") != "local"
        or gate.get("provisioner") or gate.get("requiredRuntimeCells")
        or gate.get("ephemeralCapabilities")
        or any(Path(tool).name not in NODE_SOURCE_TOOLS for tool in tools)
    ):
        raise ValueError("Node source owner cannot qualify the declared Gate")
    trace = InputOwnerTrace(gate_id, context)
    with trace.stage("executables"):
        executables = {tool: executable_input(tool) for tool in dict.fromkeys(tools)}
    for value in executables.values():
        if Path(value["resolvedPath"]).name.startswith("python") and (
            Path(value["resolvedPath"]) != Path(sys.executable).resolve(strict=True)
        ):
            raise ValueError("a second Python interpreter needs its own installation owner")
    with trace.stage("platform"):
        platform_info = [platform.system(), platform.machine(), platform.version(), platform.mac_ver()]
    with trace.stage("python-installation"):
        python = python_installation(root, ["yaml", *(python_packages or [])])
    with trace.stage("node-installation"):
        node = node_installation(root, imports)
    with trace.stage("native-libraries"):
        libraries = macos_library_inputs([
            Path(value["resolvedPath"]) for value in executables.values()
            if Path(value["resolvedPath"]) != Path(sys.executable).resolve(strict=True)
            and Path(value["resolvedPath"]).name != "node"
        ])
    with trace.stage("git-configuration"):
        git = {
            tool: git_configuration(Path(value["resolvedPath"]), root)
            for tool, value in executables.items() if Path(tool).name == "git"
        }
    with trace.stage("make-installation"):
        make = {
            tool: make_installation(Path(value["resolvedPath"]))
            for tool, value in executables.items() if Path(tool).name == "make"
        }
    runtime = {
        "platform": platform_info,
        "python": python, "node": node,
        "executables": executables,
        "libraries": libraries, "git": git, "make": make,
    }
    return {
        "artifactKind": "acceptance-gate-input-observation",
        "gateId": gate_id, "ownerId": "node-source-toolchain",
        "inputs": {
            "runtime": digest(runtime),
            "provider": digest({"kind": "source-or-disposable-local", "source": source}),
            "oracle": digest({"source": source, "gate": gate}),
            "actionPlan": digest({"gate": gate, "context": context["contextDigest"]}),
            "fixture": digest({"kind": "owner-local-temporary-fixture", "source": source}),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gate", required=True)
    parser.add_argument("--tool", action="append", default=[])
    parser.add_argument("--node-import", action="append", nargs=2, default=[])
    parser.add_argument("--python-package", action="append", default=[])
    args = parser.parse_args()
    try:
        with runner_operation_stream():
            value = node_source_observation(
                args.gate, json.loads(os.environ["PT_ACCEPTANCE_INPUT_CONTEXT"]),
                root=Path.cwd(), tools=args.tool,
                imports=[{"origin": origin, "name": name} for origin, name in args.node_import],
                python_packages=args.python_package,
            )
        print(json.dumps(value, sort_keys=True))
        return 0
    except (
        KeyError, TypeError, ValueError, OSError, RuntimeError, AttributeError,
        ImportError, subprocess.SubprocessError,
    ):
        print("NODE_SOURCE_INPUT_IDENTITY_UNPROVEN", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
