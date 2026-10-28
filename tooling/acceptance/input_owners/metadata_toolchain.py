"""Concrete pnpm/Cargo metadata inputs for architecture registry validation."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tomllib
from typing import Any

from tooling.acceptance.core.execution_budget import digest
from tooling.acceptance.core.operation_observer import runner_operation_stream
from .installed_inputs import executable_input, file_digest, macos_library_inputs, tree_digest
from .node_toolchain import node_source_observation
from .observation_trace import InputOwnerTrace
from .pnpm_toolchain import pnpm_entry, pnpm_installation
from .rust_toolchain import cargo_configurations


OWNER_ID = "architecture-metadata-toolchain"
GATE_ID = "architecture-registry-self"
COMMAND = (
    "env NODE_DISABLE_COMPILE_CACHE=1 npm_config_manage_package_manager_versions=false sh -c '"
    "node tooling/scripts/architecture/module-governance.mjs validate && "
    "node --test tooling/scripts/architecture/module-governance.test.mjs'"
)
WORKER = Path(__file__).with_name("pnpm_metadata.cjs")


def fixture_parent() -> Path:
    node = executable_input("node")
    location = read_json_command(
        [node["path"], "-e",
         "process.stdout.write(JSON.stringify(require('node:os').tmpdir()))"], Path.cwd(),
    )
    if not isinstance(location, str) or not Path(location).is_absolute():
        raise ValueError("temporary fixture parent is unavailable")
    return Path(location).resolve(strict=True)


def read_json_command(argv: list[str], root: Path) -> Any:
    completed = subprocess.run(
        argv, cwd=root, capture_output=True, text=True, check=True, timeout=2,
    )
    if len(completed.stdout.encode()) > 16 * 1024 * 1024:
        raise ValueError("metadata exceeds the bounded input inventory")
    return json.loads(completed.stdout)


def pnpm_command(argv: list[str], root: Path) -> tuple[Any, dict[str, Any]]:
    completed = subprocess.run(
        argv, cwd=root, capture_output=True, text=True, check=True, timeout=2,
    )
    marker = "\nPT_PNPM_METADATA_OBSERVATION="
    if (
        len(completed.stdout.encode()) > 16 * 1024 * 1024
        or completed.stdout.count(marker) != 1
    ):
        raise ValueError("pnpm has no unique bounded observation")
    output, observation = completed.stdout.split(marker)
    return json.loads(output), json.loads(observation)


def pnpm_metadata(root: Path) -> dict[str, Any]:
    """Run the installed delegate; bind its entire installation and actual images."""
    if os.environ.get("NODE_DISABLE_COMPILE_CACHE") != "1":
        raise ValueError("metadata enumeration requires disabled Node compile cache")
    selected, package = pnpm_entry()
    installation = pnpm_installation(root)
    node = executable_input("node")
    resolved = selected.resolve(strict=True)
    temporary = fixture_parent()
    observations = {}
    for name, directory, arguments in (
        ("configuration", root, ["config", "list", "--json"]),
        ("fixture-configuration", temporary, ["config", "list", "--json"]),
        ("workspace", root, ["list", "--recursive", "--depth", "-1", "--json"]),
    ):
        output, value = pnpm_command(
            [node["path"], str(WORKER), str(resolved), *arguments], directory,
        )
        if (
            set(value) != {"modules", "libraries", "executable"}
            or value["executable"] != node["resolvedPath"]
            or not isinstance(value["libraries"], list) or not value["libraries"]
            or not isinstance(value["modules"], list)
        ):
            raise ValueError("pnpm did not report its actual installed inputs")
        for filename in value["modules"]:
            if not Path(filename).resolve(strict=True).is_relative_to(package):
                raise ValueError("pnpm loaded code outside its installed package")
        libraries = {}
        for filename in value["libraries"]:
            if filename.startswith(("/usr/lib/", "/System/Library/")):
                continue
            path = Path(filename).resolve(strict=True)
            libraries[str(path)] = file_digest(path)
        if name.endswith("configuration") and (
            not isinstance(output, dict)
            or output.get("manage-package-manager-versions") is not False
            or any(output.get(key) for key in ("pnpmfile", "global-pnpmfile"))
        ):
            raise ValueError("pnpm redirects or external hooks require another owner")
        observations[name] = {
            "result": output, "modules": value["modules"], "libraries": libraries,
        }
    # Hooks can be implicit even when absent from the effective config.
    for parent in dict.fromkeys((root, *root.parents, temporary, *temporary.parents)):
        if (parent / ".pnpmfile.cjs").exists():
            raise ValueError("implicit pnpm hook requires its own input owner")
    return {
        "selected": str(selected), "resolved": str(resolved),
        "fixtureParent": str(temporary),
        "mode": selected.stat().st_mode & 0o777,
        "installation": tree_digest(package),
        "delegateInputs": installation,
        "observations": observations,
    }


def cargo_metadata(root: Path) -> dict[str, Any]:
    """Cargo --no-deps does not build or load rustc; rustup selection is material."""
    selected = shutil.which("cargo")
    resolver = executable_input("rustup")
    if selected is None or Path(selected).resolve(strict=True) != Path(resolver["resolvedPath"]):
        raise ValueError("Cargo needs the qualified rustup delegate")
    temporary = fixture_parent()
    delegates = {}
    for directory in dict.fromkeys((root, temporary)):
        completed = subprocess.run(
            [resolver["path"], "which", "cargo"], cwd=directory,
            capture_output=True, text=True, check=True, timeout=2,
        )
        delegate = Path(completed.stdout.strip()).resolve(strict=True)
        if delegate.name != "cargo":
            raise ValueError("rustup did not select a Cargo executable")
        delegates[str(directory)] = executable_input(str(delegate))
    settings = Path(os.environ["HOME"]) / ".rustup" / "settings.toml"
    settings_value = tomllib.loads(settings.read_text())
    for location in settings_value.get("overrides", {}):
        path = Path(location).resolve()
        if path != temporary and path.is_relative_to(temporary):
            raise ValueError("fixture-specific rustup override requires another owner")
    directories = list(dict.fromkeys((
        *(parent / ".cargo" for parent in (
            root, *root.parents, temporary, *temporary.parents,
        )),
        Path(os.environ["HOME"]) / ".cargo",
    )))
    configurations = cargo_configurations(directories)
    metadata = {}
    for relative in (
        "apps/desktop/src-tauri/Cargo.toml", "apps/mobile/src-tauri/Cargo.toml",
    ):
        metadata[relative] = read_json_command(
            [selected, "metadata", "--no-deps", "--format-version", "1",
             "--manifest-path", str(root / relative)], root,
        )
    return {
        "selected": executable_input(selected), "resolver": resolver,
        "delegates": delegates, "rustupSettings": file_digest(settings),
        "configurations": configurations,
        "libraries": macos_library_inputs([
            Path(resolver["resolvedPath"]),
            *(Path(item["resolvedPath"]) for item in delegates.values()),
        ]),
        "metadata": metadata,
    }


def metadata_observation(context: dict[str, Any], *, root: Path) -> dict[str, Any]:
    gate = context["gate"]
    if (
        gate["id"] != GATE_ID or gate.get("command") != COMMAND
        or os.environ.get("NODE_DISABLE_COMPILE_CACHE") != "1"
        or os.environ.get("npm_config_manage_package_manager_versions") != "false"
    ):
        raise ValueError("metadata owner does not own this command")
    # Retain the existing Node/Python/platform closure and source-only rejection.
    value = node_source_observation(
        GATE_ID, context, root=root,
        tools=["node", "python3", "sh", "env"],
        imports=[{"origin": "tooling/scripts/architecture/module-governance.mjs",
                  "name": "yaml"}],
    )
    trace = InputOwnerTrace(GATE_ID, context)
    with trace.stage("pnpm-metadata"):
        pnpm = pnpm_metadata(root)
    with trace.stage("cargo-metadata"):
        cargo = cargo_metadata(root)
    value["ownerId"] = OWNER_ID
    value["inputs"]["runtime"] = digest({
        "nodeSource": value["inputs"]["runtime"], "pnpm": pnpm, "cargo": cargo,
    })
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gate", required=True, choices=[GATE_ID])
    parser.parse_args()
    try:
        with runner_operation_stream():
            value = metadata_observation(
                json.loads(os.environ["PT_ACCEPTANCE_INPUT_CONTEXT"]), root=Path.cwd(),
            )
        print(json.dumps(value, sort_keys=True))
        return 0
    except (
        KeyError, TypeError, ValueError, OSError, RuntimeError, AttributeError,
        ImportError, subprocess.SubprocessError,
    ):
        print("ARCHITECTURE_METADATA_INPUT_IDENTITY_UNPROVEN", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
