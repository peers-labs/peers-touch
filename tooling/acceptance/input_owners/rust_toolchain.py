"""Actual rustup delegates and installed compiler content; no build proof."""

from __future__ import annotations

from pathlib import Path
import shutil
import subprocess
import tomllib
from typing import Any

from tooling.acceptance.core.execution_budget import digest
from .installed_inputs import executable_input, file_digest, selection_input, tree_digest
from .native_toolchain import native_tool_observation


def cargo_configurations(directories: list[Path]) -> dict[str, Any]:
    """Bind the bounded actual include graph, including optional absence."""
    records = {}
    active = set()

    def visit(path: Path, *, optional: bool = False) -> None:
        location = str(path.absolute())
        if location in active:
            raise ValueError("Cargo configuration include cycle")
        if location in records:
            return
        if len(records) >= 64:
            raise ValueError("Cargo configuration include graph exceeds its inventory")
        if not path.exists():
            if not optional:
                raise ValueError("Cargo included configuration is unavailable")
            records[location] = "absent"
            return
        if not path.is_file() or path.stat().st_size > 1024 * 1024:
            raise ValueError("Cargo configuration is not a bounded file")
        content = path.read_bytes()
        value = tomllib.loads(content.decode())
        includes = value.get("include", [])
        if not isinstance(includes, list):
            raise ValueError("Cargo include must be a closed list")
        records[location] = {
            "resolved": str(path.resolve(strict=True)), "bytes": digest(content.hex()),
            "mode": path.stat().st_mode & 0o777,
        }
        active.add(location)
        try:
            for item in includes:
                if (
                    not isinstance(item, dict)
                    or set(item) not in ({"path"}, {"path", "optional"})
                    or not isinstance(item["path"], str) or not item["path"]
                    or not isinstance(item.get("optional", False), bool)
                ):
                    raise ValueError("Cargo configuration include is not qualified")
                visit(path.parent / item["path"], optional=item.get("optional", False))
        finally:
            active.remove(location)

    for directory in directories:
        for name in ("config", "config.toml"):
            visit(directory / name, optional=True)
    return records


def rust_installation(cwd: Path, environment: dict[str, str]) -> dict[str, Any]:
    """Resolve existing rustup tools from the actual Cargo command directory."""
    cwd = cwd.resolve(strict=True)
    resolver_path = shutil.which("rustup", path=environment.get("PATH"))
    if resolver_path is None:
        raise ValueError("rustup selection is unavailable")
    resolver = executable_input(resolver_path)
    observation_environment = {**environment, "RUSTUP_AUTO_INSTALL": "0"}

    def read(arguments: list[str]) -> str:
        completed = subprocess.run(
            [resolver["path"], *arguments], cwd=cwd, env=observation_environment,
            capture_output=True, text=True, check=True, timeout=2,
        )
        value = completed.stdout.strip()
        if not value or len(value.encode()) > 4096 or "\n" in value:
            raise ValueError("rustup selection is not a bounded unique value")
        return value

    active = read(["show", "active-toolchain"])
    tools = {}
    for name in ("cargo", "rustc"):
        selected = shutil.which(name, path=environment.get("PATH"))
        if selected is None or Path(selected).resolve(strict=True) != Path(resolver["resolvedPath"]):
            raise ValueError("Rust executable is not the qualified rustup proxy")
        if name == "rustc" and environment.get("RUSTC"):
            configured = shutil.which(environment["RUSTC"], path=environment.get("PATH"))
            if configured is None or Path(configured).resolve(strict=True) != Path(selected).resolve():
                raise ValueError("configured Rust compiler requires its own delegate owner")
        delegate = Path(read(["which", name]))
        tools[name] = {
            "proxy": selection_input(Path(selected)),
            "delegate": native_tool_observation(
                delegate, ["-vV"], cwd=cwd, environment=observation_environment,
            ),
        }
    compiler = Path(tools["rustc"]["delegate"]["executable"]["resolvedPath"])
    completed = subprocess.run(
        [str(compiler), "--print", "sysroot"], cwd=cwd, env=observation_environment,
        capture_output=True, text=True, check=True, timeout=2,
    )
    location = completed.stdout.strip()
    if not location or "\n" in location or not Path(location).is_absolute():
        raise ValueError("Rust compiler sysroot is unavailable")
    installation = Path(location).resolve(strict=True)
    if any(
        Path(tools[name]["delegate"]["executable"]["resolvedPath"]) != installation / "bin" / name
        for name in tools
    ):
        raise ValueError("Rust compiler and Cargo do not share the selected installation")
    rustup_home = Path(environment.get("RUSTUP_HOME", str(Path.home() / ".rustup")))
    cargo_home = Path(environment.get("CARGO_HOME", str(Path.home() / ".cargo")))
    if not rustup_home.is_absolute() or not cargo_home.is_absolute():
        raise ValueError("relative Rust installation selection requires another owner")
    settings = rustup_home / "settings.toml"
    # Bind toolchain selection files and their absence at every searched parent.
    selections = {}
    for parent in (cwd, *cwd.parents):
        for name in ("rust-toolchain", "rust-toolchain.toml"):
            path = parent / name
            selections[str(path)] = (
                {"selection": selection_input(path), "bytes": file_digest(path)}
                if path.is_file() else "absent"
            )
    return {
        "resolver": resolver, "resolverSelection": selection_input(Path(resolver_path)),
        "activeToolchain": active, "tools": tools,
        "rustupSettings": {"selection": selection_input(settings), "bytes": file_digest(settings)},
        "selectionFiles": selections,
        "configurations": cargo_configurations(list(dict.fromkeys((
            *(parent / ".cargo" for parent in (cwd, *cwd.parents)), cargo_home,
        )))),
        "sysrootSelection": selection_input(Path(location)),
        "installation": {
            name: tree_digest(installation / name) for name in ("bin", "lib", "libexec", "etc")
        },
    }
