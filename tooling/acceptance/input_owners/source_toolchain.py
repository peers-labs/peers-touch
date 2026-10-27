"""Read-only input owner for owner-qualified local source checks."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import platform
import sys
from typing import Any

from tooling.acceptance.core.execution_budget import digest
from tooling.acceptance.core.operation_observer import runner_operation_stream
from .observation_trace import InputOwnerTrace
from .installed_inputs import (
    executable_input, file_digest, git_configuration,
    macos_library_inputs, python_installation, tree_digest,
)

SOURCE_TOOLS = frozenset({"python3", "sh", "env", "git", "rg"})


def source_observation(
    gate_id: str, context: dict[str, Any], *, root: Path,
    tools: list[str], trees: list[str], files: list[str],
    python_packages: list[str] | None = None,
) -> dict[str, Any]:
    gate = context["gate"]
    source = context["source"]
    if gate["id"] != gate_id or not source or not context["contextDigest"]:
        raise ValueError("candidate context does not identify this Gate")
    if (
        gate.get("environment", "local") != "local"
        or gate.get("provisioner") or gate.get("requiredRuntimeCells")
        or gate.get("ephemeralCapabilities")
    ):
        raise ValueError("source owner cannot identify a provisioned or live runtime")
    if any(Path(tool).name not in SOURCE_TOOLS for tool in tools):
        raise ValueError("tool configuration and delegate need a qualified input owner")
    trace = InputOwnerTrace(gate_id, context)
    with trace.stage("executables"):
        executables = {tool: executable_input(tool) for tool in dict.fromkeys(tools)}
    for value in executables.values():
        if Path(value["resolvedPath"]).name.startswith("python") and (
            Path(value["resolvedPath"]) != Path(sys.executable).resolve(strict=True)
        ):
            raise ValueError("a second Python interpreter needs its own installation owner")
    dependencies = {}
    for relative in trees:
        path = root / relative
        dependencies[relative] = tree_digest(path)
    for relative in files:
        path = root / relative
        if path.exists() or path.is_symlink():
            if not path.resolve(strict=True).is_relative_to(root.resolve(strict=True)):
                raise ValueError("declared file escapes the source input boundary")
        dependencies[relative] = file_digest(path) if path.is_file() else "absent"
    with trace.stage("platform"):
        platform_info = [platform.system(), platform.machine(), platform.version(), platform.mac_ver()]
    with trace.stage("python-installation"):
        python = python_installation(root, python_packages)
    with trace.stage("native-libraries"):
        libraries = macos_library_inputs([
            Path(value["resolvedPath"]) for value in executables.values()
            if Path(value["resolvedPath"]) != Path(sys.executable).resolve(strict=True)
        ])
    with trace.stage("git-configuration"):
        git = {
            tool: git_configuration(Path(value["resolvedPath"]), root)
            for tool, value in executables.items() if Path(tool).name == "git"
        }
    runtime = {
        "platform": platform_info, "python": python, "libraries": libraries, "git": git,
        "executables": executables, "dependencies": dependencies,
    }
    return {
        "artifactKind": "acceptance-gate-input-observation",
        "gateId": gate_id,
        "ownerId": "source-toolchain",
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
    parser.add_argument("--tree", action="append", default=[])
    parser.add_argument("--file", action="append", default=[])
    parser.add_argument("--python-package", action="append", default=[])
    args = parser.parse_args()
    try:
        for relative in (*args.tree, *args.file):
            path = Path(relative)
            if path.is_absolute() or ".." in path.parts:
                raise ValueError("dependency selection must be repository-relative")
        context = json.loads(os.environ["PT_ACCEPTANCE_INPUT_CONTEXT"])
        with runner_operation_stream():
            observation = source_observation(
                args.gate, context, root=Path.cwd(),
                tools=args.tool, trees=args.tree, files=args.file,
                python_packages=args.python_package,
            )
        print(json.dumps(observation, sort_keys=True))
        return 0
    except (KeyError, TypeError, ValueError, OSError, RuntimeError, AttributeError, ImportError):
        print("SOURCE_INPUT_IDENTITY_UNPROVEN", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
