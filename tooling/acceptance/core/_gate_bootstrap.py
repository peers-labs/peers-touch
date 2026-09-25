"""Isolated launcher for Python Gates with an inherited context descriptor."""

from __future__ import annotations

import os
import runpy
import sys
from pathlib import Path


_CONTEXT_DESCRIPTOR_ENV = "PT_ACCEPTANCE_EPHEMERAL_CONTEXT_FD"


def _context_descriptor() -> int:
    raw_descriptor = os.environ.get(_CONTEXT_DESCRIPTOR_ENV)
    if raw_descriptor is None:
        raise RuntimeError("ephemeral context descriptor locator is missing")
    try:
        descriptor = int(raw_descriptor)
        os.set_inheritable(descriptor, False)
    except (OSError, ValueError) as error:
        raise RuntimeError(
            "ephemeral context descriptor locator is invalid"
        ) from error
    return descriptor


def _add_invoked_venv_site_packages() -> None:
    venv_root = Path(sys.executable).parent.parent
    config = venv_root / "pyvenv.cfg"
    if not config.exists():
        return

    try:
        resolved_root = venv_root.resolve(strict=True)
        resolved_config = config.resolve(strict=True)
    except OSError as error:
        raise RuntimeError("isolated Gate virtual environment is invalid") from error
    if not resolved_config.is_file() or resolved_config.parent != resolved_root:
        raise RuntimeError("isolated Gate virtual environment config is unsafe")

    version_directory = f"python{sys.version_info.major}.{sys.version_info.minor}"
    resolved_paths: list[str] = []
    for library_directory in ("lib", "lib64"):
        candidate = venv_root / library_directory / version_directory / "site-packages"
        if not candidate.exists():
            continue
        try:
            resolved_candidate = candidate.resolve(strict=True)
            resolved_candidate.relative_to(resolved_root)
        except (OSError, ValueError) as error:
            raise RuntimeError(
                "isolated Gate virtual environment package path is unsafe"
            ) from error
        if not resolved_candidate.is_dir():
            raise RuntimeError(
                "isolated Gate virtual environment package path is invalid"
            )
        resolved_path = str(resolved_candidate)
        if resolved_path not in resolved_paths:
            resolved_paths.append(resolved_path)

    if not resolved_paths:
        raise RuntimeError(
            "isolated Gate virtual environment package path is unavailable"
        )
    sys.path.extend(resolved_paths)


def _run_target(argv: list[str]) -> None:
    if len(argv) < 2:
        raise RuntimeError("isolated Gate bootstrap target is missing")

    mode, target, *arguments = argv
    if mode == "--module":
        sys.path.insert(0, os.getcwd())
        sys.argv = [target, *arguments]
        runpy.run_module(target, run_name="__main__", alter_sys=True)
        return
    if mode == "--script":
        script = Path(target).resolve()
        sys.path.insert(0, os.getcwd())
        sys.path.insert(0, str(script.parent))
        sys.argv = [str(script), *arguments]
        runpy.run_path(str(script), run_name="__main__")
        return
    if mode == "--code":
        sys.path.insert(0, os.getcwd())
        sys.argv = ["-c", *arguments]
        namespace = {
            "__name__": "__main__",
            "__package__": None,
            "__spec__": None,
            "__builtins__": __builtins__,
        }
        exec(compile(target, "<string>", "exec"), namespace, namespace)
        return
    raise RuntimeError("isolated Gate bootstrap mode is invalid")


def main() -> None:
    _context_descriptor()
    _add_invoked_venv_site_packages()
    _run_target(sys.argv[1:])


if __name__ == "__main__":
    main()
