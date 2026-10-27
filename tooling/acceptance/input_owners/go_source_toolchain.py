"""Actual Go installation and resolved inputs of the Station AST source Gate."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
from typing import Any

from tooling.acceptance.core.execution_budget import digest
from tooling.acceptance.core.operation_observer import runner_operation_stream
from .installed_inputs import executable_input, file_digest, macos_library_inputs, tree_digest
from .observation_trace import InputOwnerTrace
from .source_toolchain import source_observation


OWNER_ID = "go-source-toolchain"
GATE_ID = "station-api-ownership"
PACKAGE = "./apps/station/app/cmd/station_api_ownership"
GO_ENVIRONMENT = {
    "GOENV": "off", "GOTOOLCHAIN": "local", "GOPROXY": "off", "GOSUMDB": "off",
    "CGO_ENABLED": "0", "GOFLAGS": "-mod=readonly",
    "GODEBUG": "gocacheverify=1",
}
COMMAND = (
    "env " + " ".join(f"{key}={value}" for key, value in GO_ENVIRONMENT.items())
    + " go run " + PACKAGE
    + " --root . --registry docs/architecture/engineering/api-governance/station-api-capabilities.yaml"
)
ENV_KEYS = (
    "GOROOT", "GOVERSION", "GOTOOLDIR", "GOHOSTOS", "GOHOSTARCH", "GOOS", "GOARCH",
    "GOAMD64", "GOARM", "GOARM64", "GOEXPERIMENT", "GOWORK", "GOMOD",
    "GOPATH", "GOMODCACHE", "GOCACHE", "GOTMPDIR", "GOTELEMETRY", "GOTELEMETRYDIR",
    *GO_ENVIRONMENT,
)


def go_json(argv: list[str], root: Path) -> list[dict[str, Any]]:
    """List metadata only; offline, read-only module mode cannot equip dependencies."""
    completed = subprocess.run(
        argv, cwd=root, env={**os.environ, **GO_ENVIRONMENT},
        capture_output=True, text=True, check=True, timeout=2,
    )
    if len(completed.stdout.encode()) > 4 * 1024 * 1024:
        raise ValueError("Go metadata exceeds the bounded input inventory")
    decoder = json.JSONDecoder()
    remaining = completed.stdout
    records = []
    while remaining.strip():
        value, end = decoder.raw_decode(remaining.lstrip())
        if not isinstance(value, dict) or len(records) == 256:
            raise ValueError("Go metadata is not a bounded object inventory")
        records.append(value)
        remaining = remaining.lstrip()[end:]
    if not records:
        raise ValueError("Go metadata inventory is empty")
    return records


def package_inputs(
    records: list[dict[str, Any]], *, root: Path, goroot: Path, module_cache: Path,
) -> dict[str, Any]:
    """Close every resolved package; reject native and external local replacements."""
    packages = {}
    modules = {}
    repository = root.resolve(strict=True)
    standard = (goroot / "src").resolve(strict=True)
    cache = module_cache.resolve(strict=True)
    for item in records:
        name = item.get("ImportPath")
        if (
            not isinstance(name, str) or not name or name in packages
            or item.get("Error") or item.get("DepsErrors") or item.get("Incomplete")
            or item.get("CgoFiles") or item.get("SysoFiles")
        ):
            raise ValueError("Go dependency is incomplete or requires a native owner")
        directory = Path(item["Dir"]).resolve(strict=True)
        if item.get("Standard"):
            if not directory.is_relative_to(standard):
                raise ValueError("standard Go package escapes the selected installation")
        else:
            module = item.get("Module")
            if not isinstance(module, dict) or module.get("Replace"):
                raise ValueError("Go replacement needs its own input owner")
            if module.get("Main"):
                if not directory.is_relative_to(repository):
                    raise ValueError("Go workspace package escapes the source boundary")
            else:
                location = Path(module["Dir"]).resolve(strict=True)
                if (
                    not location.is_relative_to(cache)
                    or not directory.is_relative_to(location)
                    or not module.get("Version") or not module.get("Sum")
                ):
                    raise ValueError("Go dependency has no installed module boundary")
                if str(location) not in modules:
                    manifest = Path(module["GoMod"]).resolve(strict=True)
                    if not manifest.is_relative_to(cache):
                        raise ValueError("Go module metadata escapes the installed cache")
                    modules[str(location)] = {
                        "module": module, "installation": tree_digest(location),
                        "manifest": file_digest(manifest),
                    }
        files = {}
        for field in ("GoFiles", "SFiles", "HFiles", "EmbedFiles"):
            for relative in item.get(field, []):
                path = Path(relative)
                if path.is_absolute() or ".." in path.parts:
                    raise ValueError("Go package input escapes its directory")
                selected = directory / path
                if not selected.resolve(strict=True).is_relative_to(directory):
                    raise ValueError("Go package link escapes its installed boundary")
                files[relative] = file_digest(selected)
        packages[name] = {"metadata": item, "files": files}
    return {"packages": packages, "modules": modules}


def go_installation(root: Path) -> dict[str, Any]:
    """The selected executable, compiler, linker and standard library are material."""
    executable = executable_input("go")
    observations = go_json([executable["path"], "env", "-json", *ENV_KEYS], root)
    if len(observations) != 1:
        raise ValueError("Go has no unique effective configuration")
    configuration = observations[0]
    if (
        any(
            configuration.get(key) != ("" if key == "GOENV" else value)
            for key, value in GO_ENVIRONMENT.items()
        )
        or configuration.get("GOHOSTOS") != "darwin"
        or configuration.get("GOOS") != configuration["GOHOSTOS"]
        or configuration.get("GOARCH") != configuration["GOHOSTARCH"]
        or configuration.get("GOEXPERIMENT")
        or configuration.get("GOTELEMETRY") not in {"local", "off"}
    ):
        raise ValueError("Go configuration requires another platform or compiler owner")
    goroot = Path(configuration["GOROOT"]).resolve(strict=True)
    if Path(executable["resolvedPath"]) != goroot / "bin/go":
        raise ValueError("Go executable is not the actual selected installation")
    tool_directory = Path(configuration["GOTOOLDIR"]).resolve(strict=True)
    if not tool_directory.is_relative_to(goroot / "pkg/tool"):
        raise ValueError("Go tools escape the selected installation")
    installation = {}
    for relative in ("pkg/include", "lib"):
        installation[relative] = tree_digest(goroot / relative)
    installation["tools"] = {
        name: executable_input(str(tool_directory / name))
        for name in ("compile", "asm", "link")
    }
    for relative in ("VERSION", "go.env"):
        installation[relative] = file_digest(goroot / relative)
    telemetry_mode = Path(configuration["GOTELEMETRYDIR"]) / "mode"
    installation["telemetryMode"] = (
        file_digest(telemetry_mode) if telemetry_mode.is_file() else "absent"
    )
    for key in ("GOWORK", "GOMOD"):
        location = configuration[key]
        if location not in ("", "off", os.devnull):
            path = Path(location).resolve(strict=True)
            if not path.is_relative_to(root.resolve(strict=True)):
                raise ValueError("Go workspace metadata escapes the source boundary")
            installation[key] = file_digest(path)
    dependencies = go_json(
        [executable["path"], "list", "-deps", "-json", PACKAGE], root,
    )
    return {
        "executable": executable, "configuration": configuration,
        "installation": installation,
        "libraries": macos_library_inputs([
            Path(executable["resolvedPath"]),
            *(tool_directory / name for name in ("compile", "asm", "link")),
        ]),
        "dependencies": package_inputs(
            dependencies, root=root, goroot=goroot,
            module_cache=Path(configuration["GOMODCACHE"]),
        ),
    }


def go_source_observation(context: dict[str, Any], *, root: Path) -> dict[str, Any]:
    gate = context["gate"]
    if gate["id"] != GATE_ID or gate.get("command") != COMMAND:
        raise ValueError("Go source owner does not own this complete command")
    value = source_observation(
        GATE_ID, context, root=root, tools=["python3", "env", "sh"], trees=[], files=[],
    )
    with InputOwnerTrace(GATE_ID, context).stage("go-installation"):
        installed = go_installation(root)
    value["ownerId"] = OWNER_ID
    value["inputs"]["runtime"] = digest({
        "sourceTools": value["inputs"]["runtime"], "go": installed,
    })
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gate", required=True, choices=[GATE_ID])
    parser.parse_args()
    try:
        with runner_operation_stream():
            value = go_source_observation(
                json.loads(os.environ["PT_ACCEPTANCE_INPUT_CONTEXT"]), root=Path.cwd(),
            )
        print(json.dumps(value, sort_keys=True))
        return 0
    except (
        KeyError, TypeError, ValueError, OSError, RuntimeError, ImportError,
        subprocess.SubprocessError,
    ):
        print("GO_SOURCE_INPUT_IDENTITY_UNPROVEN", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
