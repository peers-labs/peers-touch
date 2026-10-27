"""Installed macOS tool images and SDK inputs; no command or product proof."""

from __future__ import annotations

from pathlib import Path
import platform
import re
import subprocess
from typing import Any

from .installed_inputs import executable_input, file_digest, selection_input, tree_digest


IMAGE = re.compile(
    r"dyld\[([0-9]+)\]: <([0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12})> (/.+)"
)
DELAYED = re.compile(r"dyld\[([0-9]+)\]: move loaded to delayed: ([^/\n]+)")


def native_tool_observation(
    executable: Path, arguments: list[str], *, cwd: Path,
    environment: dict[str, str],
) -> dict[str, Any]:
    """Log actual dyld images without changing library selection or arguments."""
    if platform.system() != "Darwin" or any(
        key.startswith("DYLD_") for key in environment
    ):
        raise ValueError("configured native loader requires its own input owner")
    binary = executable_input(str(executable))
    completed = subprocess.run(
        [str(executable), *arguments], cwd=cwd,
        env={**environment, "DYLD_PRINT_LIBRARIES": "1"},
        capture_output=True, text=True, check=True, timeout=2,
    )
    if len(completed.stdout.encode()) + len(completed.stderr.encode()) > 1024 * 1024:
        raise ValueError("native image observation exceeds its bounded inventory")
    images: dict[str, Any] = {}
    image_names: set[str] = set()
    delayed = []
    process = None
    for line in completed.stderr.splitlines():
        match = IMAGE.fullmatch(line)
        transition = DELAYED.fullmatch(line) if match is None else None
        if (match is None and transition is None) or len(images) + len(delayed) >= 2048:
            raise ValueError("native tool has no complete image-only observation")
        event = match or transition
        if process is not None and process != event[1]:
            raise ValueError("native child process requires another input owner")
        process = event[1]
        if transition is not None:
            if transition[2] not in image_names:
                raise ValueError("delayed library has no original loaded image")
            delayed.append(transition[2])
            continue
        name = match[3]
        if name in images:
            raise ValueError("native image inventory is ambiguous")
        value = {"uuid": match[2]}
        if not name.startswith(("/usr/lib/", "/System/Library/")):
            path = Path(name).resolve(strict=True)
            value.update(resolved=str(path), bytes=file_digest(path))
        images[name] = value
        image_names.add(Path(name).name)
    if binary["resolvedPath"] not in images:
        raise ValueError("native executable was not observed among actual loaded images")
    release, version_info, machine = platform.mac_ver()
    return {
        "executable": binary, "selection": selection_input(executable),
        "output": completed.stdout.strip(), "images": images, "delayedImages": delayed,
        "platform": [
            platform.system(), platform.machine(), platform.version(),
            [release, list(version_info), machine],
        ],
    }


def native_selection(
    arguments: list[str], *, cwd: Path, environment: dict[str, str],
) -> str:
    """Read bounded xcrun metadata; the resolver is part of installed identity."""
    completed = subprocess.run(
        ["/usr/bin/xcrun", *arguments], cwd=cwd, env=environment,
        capture_output=True, text=True, check=True, timeout=2,
    )
    value = completed.stdout.strip()
    if not value or len(value.encode()) > 4096 or "\n" in value:
        raise ValueError("native tool selection is not a unique bounded value")
    return value


def macos_sdk_installation(cwd: Path, environment: dict[str, str]) -> dict[str, Any]:
    """Bind selected C/C++ tools, builtin resources and every actual SDK byte."""
    if platform.system() != "Darwin" or any(
        key.startswith("DYLD_") for key in environment
    ):
        raise ValueError("native SDK selection requires its qualified platform/loader")
    resolver = executable_input("/usr/bin/xcrun")
    sdk_origin = Path(native_selection(
        ["--sdk", "macosx", "--show-sdk-path"], cwd=cwd, environment=environment,
    ))
    sdk = sdk_origin.resolve(strict=True)
    tools = {}
    for name, options in (
        ("clang", ["--version"]), ("clang++", ["--version"]),
        ("ar", ["--version"]), ("ranlib", ["--version"]), ("ld", ["-v"]),
    ):
        origin = Path(native_selection(["--find", name], cwd=cwd, environment=environment))
        # Some native tools emit their version to stderr. Their installation
        # content still binds them; only compilers have image-only observation.
        tools[name] = (
            native_tool_observation(origin, options, cwd=cwd, environment=environment)
            if name in {"clang", "clang++"} else {
                "executable": executable_input(str(origin)),
                "selection": selection_input(origin),
            }
        )
    compiler = Path(tools["clang"]["executable"]["resolvedPath"])
    toolchain = compiler.parent.parent
    if any(
        not Path(item["executable"]["resolvedPath"]).is_relative_to(toolchain / "bin")
        for item in tools.values()
    ):
        raise ValueError("native tools do not share the observed compiler installation")
    resource = subprocess.run(
        [str(compiler), "-print-resource-dir"], cwd=cwd, env=environment,
        capture_output=True, text=True, check=True, timeout=2,
    ).stdout.strip()
    if not resource or not Path(resource).resolve(strict=True).is_relative_to(toolchain):
        raise ValueError("compiler builtin resources escape the selected installation")
    configured = environment.get("SDKROOT")
    if configured and (
        not Path(configured).is_absolute()
        or Path(configured).resolve(strict=True) != sdk
    ):
        raise ValueError("configured SDK differs from the observed macOS selection")
    return {
        "resolver": resolver, "sdkSelection": selection_input(sdk_origin),
        "sdk": {"path": str(sdk), "bytes": tree_digest(sdk)},
        "sdkVersion": native_selection(
            ["--sdk", "macosx", "--show-sdk-version"], cwd=cwd, environment=environment,
        ),
        "tools": tools, "builtinResources": selection_input(Path(resource)),
        "toolchain": {
            str(toolchain / name): tree_digest(toolchain / name)
            for name in ("bin", "lib", "include")
        },
    }
