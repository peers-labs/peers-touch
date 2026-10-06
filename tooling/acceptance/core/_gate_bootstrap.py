"""Isolated launcher for Python Gates with an inherited context descriptor."""

from __future__ import annotations

import os
import runpy
import stat
import sys
import sysconfig
from pathlib import Path


_CONTEXT_DESCRIPTOR_ENV = "PT_ACCEPTANCE_EPHEMERAL_CONTEXT_FD"


def _context_descriptor() -> int:
    raw_descriptor = os.environ.get(_CONTEXT_DESCRIPTOR_ENV)
    if raw_descriptor is None:
        raise RuntimeError("ephemeral context descriptor locator is missing")
    try:
        descriptor = int(raw_descriptor)
    except ValueError as error:
        raise RuntimeError(
            "ephemeral context descriptor locator is invalid"
        ) from error
    try:
        descriptor_status = os.fstat(descriptor)
        if not stat.S_ISSOCK(descriptor_status.st_mode):
            raise RuntimeError(
                "ephemeral context descriptor locator is invalid"
            )
        os.set_inheritable(descriptor, False)
        if os.get_inheritable(descriptor):
            raise RuntimeError(
                "ephemeral context descriptor could not be isolated"
            )
    except OSError as error:
        raise RuntimeError(
            "ephemeral context descriptor locator is invalid"
        ) from error
    return descriptor


def _validate_pyvenv_config(config: Path) -> None:
    try:
        lines = config.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError) as error:
        raise RuntimeError(
            "isolated Gate virtual environment config is invalid"
        ) from error

    values: dict[str, str] = {}
    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            continue
        raw_key, separator, raw_value = line.partition("=")
        key = raw_key.strip().lower()
        value = raw_value.strip()
        if not separator or not key or not value or key in values:
            raise RuntimeError(
                "isolated Gate virtual environment config is invalid"
            )
        values[key] = value

    version = values.get("version") or values.get("version_info", "")
    version_parts = version.split(".")
    expected_version = [
        str(sys.version_info.major),
        str(sys.version_info.minor),
    ]
    if (
        not values.get("home")
        or values.get("include-system-site-packages", "").lower()
        not in {"true", "false"}
        or version_parts[:2] != expected_version
    ):
        raise RuntimeError("isolated Gate virtual environment config is invalid")


def _add_invoked_venv_site_packages() -> bool:
    executable = Path(sys.executable)
    if not executable.is_absolute():
        raise RuntimeError("isolated Gate Python executable is invalid")

    venv_root = executable.parent.parent
    config = venv_root / "pyvenv.cfg"
    try:
        config_status = config.lstat()
    except FileNotFoundError:
        return False
    except OSError as error:
        raise RuntimeError("isolated Gate virtual environment is invalid") from error

    if stat.S_ISLNK(config_status.st_mode) or not stat.S_ISREG(
        config_status.st_mode
    ):
        raise RuntimeError("isolated Gate virtual environment config is unsafe")

    try:
        resolved_root = venv_root.resolve(strict=True)
        resolved_bin = executable.parent.resolve(strict=True)
        resolved_config = config.resolve(strict=True)
    except OSError as error:
        raise RuntimeError("isolated Gate virtual environment is invalid") from error
    if (
        not resolved_root.is_dir()
        or resolved_bin != resolved_root / "bin"
        or not executable.is_file()
        or resolved_config != resolved_root / "pyvenv.cfg"
    ):
        raise RuntimeError("isolated Gate virtual environment config is unsafe")

    _validate_pyvenv_config(resolved_config)

    version_directory = f"python{sys.version_info.major}.{sys.version_info.minor}"
    resolved_paths: list[str] = []
    for library_directory in ("lib", "lib64"):
        candidate = (
            resolved_root
            / library_directory
            / version_directory
            / "site-packages"
        )
        try:
            candidate.lstat()
        except FileNotFoundError:
            continue
        except OSError as error:
            raise RuntimeError(
                "isolated Gate virtual environment package path is invalid"
            ) from error
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
    return True


def _add_invoked_user_site_packages() -> None:
    user_base_value = sysconfig.get_config_var("userbase")
    if not isinstance(user_base_value, str) or not user_base_value:
        return

    user_base = Path(user_base_value)
    try:
        resolved_base = user_base.resolve(strict=True)
    except FileNotFoundError:
        return
    except OSError as error:
        raise RuntimeError(
            "isolated Gate user package root is invalid"
        ) from error
    if not resolved_base.is_dir():
        raise RuntimeError("isolated Gate user package root is invalid")

    try:
        scheme = sysconfig.get_preferred_scheme("user")
    except (AttributeError, KeyError):
        scheme = "posix_user" if os.name != "nt" else "nt_user"

    resolved_paths: list[str] = []
    for path_name in ("purelib", "platlib"):
        candidate_value = sysconfig.get_path(path_name, scheme=scheme)
        if not isinstance(candidate_value, str) or not candidate_value:
            continue
        candidate = Path(candidate_value)
        try:
            candidate.lstat()
        except FileNotFoundError:
            continue
        except OSError as error:
            raise RuntimeError(
                "isolated Gate user package path is invalid"
            ) from error
        try:
            resolved_candidate = candidate.resolve(strict=True)
            resolved_candidate.relative_to(resolved_base)
        except (OSError, ValueError) as error:
            raise RuntimeError(
                "isolated Gate user package path is unsafe"
            ) from error
        if not resolved_candidate.is_dir():
            raise RuntimeError(
                "isolated Gate user package path is invalid"
            )
        resolved_path = str(resolved_candidate)
        if resolved_path not in resolved_paths:
            resolved_paths.append(resolved_path)

    sys.path.extend(resolved_paths)


def _add_invoked_system_site_packages() -> None:
    data_path_value = sysconfig.get_path("data")
    if not isinstance(data_path_value, str) or not data_path_value:
        raise RuntimeError("isolated Gate system package root is unavailable")

    try:
        resolved_root = Path(data_path_value).resolve(strict=True)
    except OSError as error:
        raise RuntimeError(
            "isolated Gate system package root is invalid"
        ) from error
    if not resolved_root.is_dir():
        raise RuntimeError("isolated Gate system package root is invalid")

    resolved_paths: list[str] = []
    for path_name in ("purelib", "platlib"):
        candidate_value = sysconfig.get_path(path_name)
        if not isinstance(candidate_value, str) or not candidate_value:
            continue
        candidate = Path(candidate_value)
        try:
            candidate.lstat()
        except FileNotFoundError:
            continue
        except OSError as error:
            raise RuntimeError(
                "isolated Gate system package path is invalid"
            ) from error
        try:
            resolved_candidate = candidate.resolve(strict=True)
            resolved_candidate.relative_to(resolved_root)
        except (OSError, ValueError) as error:
            raise RuntimeError(
                "isolated Gate system package path is unsafe"
            ) from error
        if not resolved_candidate.is_dir():
            raise RuntimeError(
                "isolated Gate system package path is invalid"
            )
        resolved_path = str(resolved_candidate)
        if resolved_path not in resolved_paths:
            resolved_paths.append(resolved_path)

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
    if not _add_invoked_venv_site_packages():
        _add_invoked_system_site_packages()
        _add_invoked_user_site_packages()
    _run_target(sys.argv[1:])


if __name__ == "__main__":
    main()
