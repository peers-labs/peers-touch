"""Bounded Git operations for disposable source fixtures only."""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess


def synthetic_git_environment() -> dict[str, str]:
    """Select the concrete toolchain delegate before fixture readers run."""
    environment = {
        key: value for key, value in os.environ.items()
        if not key.startswith(("GIT_AI_", "GIT_TRACE2"))
    }
    # Native Git also reads global trace2 targets; removing variables is insufficient.
    environment.update(GIT_TRACE2="0", GIT_TRACE2_EVENT="0", GIT_TRACE2_PERF="0")
    environment["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin"
    discovery = subprocess.run(
        ("git", "--exec-path"), env=environment, capture_output=True,
        text=True, check=True, timeout=5,
    )
    delegate = Path(discovery.stdout.strip()) / "git"
    if not delegate.is_file() or not os.access(delegate, os.X_OK):
        raise RuntimeError("Synthetic source fixtures require a concrete Git delegate")
    environment["PATH"] = str(delegate.parent) + os.pathsep + environment["PATH"]
    return environment


def run_synthetic_git(
    root: Path, *arguments: str, environment: dict[str, str] | None = None,
) -> None:
    environment = environment if environment is not None else synthetic_git_environment()
    executable = shutil.which("git", path=environment["PATH"])
    if executable is None:
        raise RuntimeError("Synthetic source fixture Git is unavailable")
    subprocess.run(
        (executable, "-c", "core.hooksPath=/dev/null",
         "-c", "maintenance.auto=false", "-c", "gc.auto=0", *arguments),
        cwd=root, env=environment, check=True, stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE, timeout=5,
    )
