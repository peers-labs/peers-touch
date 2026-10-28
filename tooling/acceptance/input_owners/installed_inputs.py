"""Material installed inputs for source owners; unknown delegates stay opaque."""

from __future__ import annotations

from collections import deque
from concurrent.futures import ThreadPoolExecutor
import hashlib
import ctypes
import importlib
import importlib.metadata
import importlib.util
import os
from pathlib import Path
import platform
import shutil
import stat
import subprocess
import sys
import sysconfig
from typing import Any

from tooling.acceptance.core.execution_budget import digest


def file_digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def selection_input(path: Path) -> dict[str, Any]:
    """Bind the selected origin and each actual ancestor link."""
    return {
        "path": str(path), "resolved": str(path.resolve(strict=True)),
        "mode": path.stat().st_mode & 0o777,
        "links": {
            str(item): os.readlink(item)
            for item in (path, *path.parents) if item.is_symlink()
        },
    }


def tree_digest(
    root: Path, *, excluded_children: frozenset[str] = frozenset(),
    linked_files: frozenset[Path] = frozenset(),
) -> str:
    """Observe all bytes with bounded readers; reduce in original traversal order."""
    if not root.is_dir():
        raise ValueError("declared installed dependency root is unavailable")
    boundary = root.resolve(strict=True)
    seen: set[Path] = set()
    pending = deque()
    batch = []
    readers = ThreadPoolExecutor(max_workers=4, thread_name_prefix="installed-input")

    def finish_read() -> None:
        future, nodes = pending.popleft()
        values = future.result()
        for node, value in zip(nodes, values, strict=True):
            node["bytes"] = value

    def submit_batch() -> None:
        if not batch:
            return
        if len(pending) == 8:
            finish_read()
        items = tuple(batch)
        batch.clear()
        future = readers.submit(lambda: [file_digest(path) for path, _ in items])
        pending.append((future, [node for _, node in items]))

    def read_file(path: Path, node: dict[str, Any]) -> dict[str, Any]:
        batch.append((path, node))
        if len(batch) == 32:
            submit_batch()
        return node

    def visit(path: Path, resolved: Path, metadata: os.stat_result) -> dict[str, Any]:
        if stat.S_ISLNK(metadata.st_mode):
            target = path.resolve(strict=True)
            target_metadata = target.lstat()
            mode = target_metadata.st_mode & 0o777
            if not target.is_relative_to(boundary):
                if target not in linked_files or not stat.S_ISREG(target_metadata.st_mode):
                    raise ValueError("dependency link escapes the declared installed input boundary")
                return read_file(target, {
                    "link": os.readlink(path), "target": str(target), "mode": mode,
                })
            return {
                "link": os.readlink(path),
                "target": visit(target, target, target_metadata), "mode": mode,
            }
        mode = metadata.st_mode & 0o777
        if resolved in seen:
            return {"reference": str(resolved)}
        seen.add(resolved)
        if stat.S_ISREG(metadata.st_mode):
            return read_file(path, {"mode": mode})
        if not stat.S_ISDIR(metadata.st_mode):
            raise ValueError("declared dependency contains a non-file resource")
        children = {}
        with os.scandir(path) as entries:
            for child in sorted(entries, key=lambda item: item.name):
                if path == root and child.name in excluded_children:
                    continue
                if path.name == "node_modules" and child.name in {".vite", ".vitest"}:
                    continue
                children[child.name] = visit(
                    Path(child.path), resolved / child.name,
                    child.stat(follow_symlinks=False),
                )
        return {"entries": children, "mode": mode}

    def reduce(node: dict[str, Any]) -> str:
        if "entries" in node:
            node["entries"] = {
                name: reduce(child) for name, child in node["entries"].items()
            }
        elif isinstance(node.get("target"), dict):
            node["target"] = reduce(node["target"])
        return digest(node)

    try:
        inventory = visit(root, boundary, root.lstat())
        submit_batch()
        while pending:
            finish_read()
        return reduce(inventory)
    finally:
        readers.shutdown(wait=True, cancel_futures=True)


def executable_input(tool: str) -> dict[str, Any]:
    """A native binary is observable; hashing a shell shim grants no closure."""
    selected = shutil.which(tool, path=os.environ.get("PATH"))
    if selected is None:
        raise ValueError("declared executable is unavailable")
    path = Path(selected)
    with path.open("rb") as stream:
        magic = stream.read(4)
    if magic not in {
        b"\x7fELF", b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf",
        b"\xce\xfa\xed\xfe", b"\xfe\xed\xfa\xce",
        b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca",
    } and not magic.startswith(b"MZ"):
        raise ValueError("script or shim has no qualified delegate input owner")
    return {
        "path": str(path), "resolvedPath": str(path.resolve(strict=True)),
        "bytes": file_digest(path), "mode": path.stat().st_mode & 0o777,
    }


def macos_library_inputs(executables: list[Path]) -> dict[str, str]:
    """System libraries bind to the OS build; other dylibs bind to their bytes."""
    if platform.system() != "Darwin":
        raise ValueError("native library observation requires a qualified platform owner")
    if not executables:
        return {}
    try:
        discovery = subprocess.run(
            ["/usr/bin/xcrun", "--find", "otool"], capture_output=True,
            text=True, check=True, timeout=2,
        )
        inspector = Path(discovery.stdout.strip()).resolve(strict=True)
        executable_input(str(inspector))
    except (OSError, subprocess.SubprocessError) as error:
        raise ValueError("native library inspector is unavailable") from error
    result: dict[str, str] = {"inspector": file_digest(inspector)}
    pending = list(executables)
    seen: set[Path] = set()
    while pending:
        binary = pending.pop().resolve(strict=True)
        if binary in seen:
            continue
        seen.add(binary)
        try:
            completed = subprocess.run(
                [str(inspector), "-L", str(binary)], capture_output=True,
                text=True, check=True, timeout=1,
            )
            identifiers = subprocess.run(
                [str(inspector), "-D", str(binary)], capture_output=True,
                text=True, check=True, timeout=1,
            )
        except (OSError, subprocess.SubprocessError) as error:
            raise ValueError("native library observation did not complete") from error
        own_names = {
            line.strip() for line in identifiers.stdout.splitlines()
            if line.strip() and not line.rstrip().endswith(":")
        }
        for line in completed.stdout.splitlines()[1:]:
            name = line.strip().split(" (", 1)[0]
            if name in own_names or name.startswith(("/usr/lib/", "/System/Library/")):
                continue
            if name.startswith("@loader_path/"):
                path = binary.parent / name.removeprefix("@loader_path/")
            elif name.startswith("@executable_path/"):
                path = executables[0].resolve(strict=True).parent / name.removeprefix("@executable_path/")
            elif name.startswith("/"):
                path = Path(name)
            else:
                raise ValueError("unresolved native library input")
            resolved = path.resolve(strict=True)
            result[str(path)] = file_digest(resolved)
            pending.append(resolved)
    return result


def loaded_python_libraries() -> dict[str, str]:
    """Read dyld's actual Python images, including imported extension dependencies."""
    if platform.system() != "Darwin":
        raise ValueError("Python library observation requires a qualified platform owner")
    loader = ctypes.CDLL(None)
    count = loader._dyld_image_count
    count.restype = ctypes.c_uint32
    name = loader._dyld_get_image_name
    name.argtypes = [ctypes.c_uint32]
    name.restype = ctypes.c_char_p
    libraries = {}
    for index in range(count()):
        value = name(index)
        if value is None:
            raise ValueError("Python loaded library identity is unavailable")
        path_value = os.fsdecode(value)
        if path_value.startswith(("/usr/lib/", "/System/Library/")):
            continue
        path = Path(path_value).resolve(strict=True)
        libraries[str(path)] = file_digest(path)
    return libraries


def git_configuration(executable: Path, root: Path) -> dict[str, str]:
    """Configuration can change source enumeration without changing Git's bytes."""
    try:
        discovery = subprocess.run(
            [str(executable), "--exec-path"], capture_output=True,
            text=True, check=True, timeout=2,
        )
        delegate = Path(discovery.stdout.strip()) / "git"
        if not delegate.is_file():
            raise ValueError("Git has no concrete toolchain delegate")
        delegate_input = executable_input(str(delegate))
        config = subprocess.run(
            [str(delegate), "-C", str(root), "config", "--null", "--list"],
            capture_output=True, check=True, timeout=2,
        )
        selected = subprocess.run(
            [str(delegate), "-C", str(root), "rev-parse", "--git-path", "info/exclude"],
            capture_output=True, text=True, check=True, timeout=2,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise ValueError("Git source enumeration inputs are unavailable") from error
    path = root / selected.stdout.strip()
    return {
        "delegate": digest(delegate_input),
        "libraries": digest(macos_library_inputs([delegate])),
        "configuration": hashlib.sha256(config.stdout).hexdigest(),
        "localExclusions": file_digest(path) if path.is_file() else "absent",
    }


def make_installation(executable: Path) -> dict[str, Any]:
    """Bind the actual macOS developer-tool delegate used by the system launcher."""
    if executable != Path("/usr/bin/make"):
        return {"executable": executable_input(str(executable))}
    resolver = executable_input("/usr/bin/xcrun")
    completed = subprocess.run(
        [resolver["path"], "--find", "make"], capture_output=True,
        text=True, check=True, timeout=2,
    )
    delegate = Path(completed.stdout.strip()).resolve(strict=True)
    return {
        "resolver": resolver, "delegate": executable_input(str(delegate)),
        "libraries": macos_library_inputs([delegate]),
    }


def python_package_inputs(packages: list[str]) -> tuple[dict[str, Any], list[Path]]:
    """Resolve installed distribution requirements, including inherited extras."""
    if not packages:
        return {}, []
    from packaging.markers import default_environment
    from packaging.requirements import Requirement
    from packaging.utils import canonicalize_name

    mappings = importlib.metadata.packages_distributions()
    selections = list(dict.fromkeys([*packages, "packaging"]))
    selected_distributions = []
    for name in selections:
        if not name.isidentifier():
            raise ValueError("Python package selection must name a top-level import")
        owners = mappings.get(name, [])
        if len(owners) != 1:
            raise ValueError("Python package has no unique installed distribution")
        selected_distributions.append(canonicalize_name(owners[0]))
    pending = [(name, frozenset()) for name in selected_distributions]
    extras: dict[str, set[str]] = {}
    distributions = {}
    edges = {}
    environment = default_environment()
    while pending:
        name, requested = pending.pop()
        if name in extras and requested.issubset(extras[name]):
            continue
        extras.setdefault(name, set()).update(requested)
        distribution = importlib.metadata.distribution(name)
        distributions[name] = distribution
        for text in distribution.requires or []:
            requirement = Requirement(text)
            active = requirement.marker is None or any(
                requirement.marker.evaluate({**environment, "extra": extra})
                for extra in ("", *sorted(extras[name]))
            )
            if not active:
                continue
            if requirement.url:
                raise ValueError("direct Python dependency needs a qualified origin owner")
            dependency = canonicalize_name(requirement.name)
            installed = importlib.metadata.distribution(dependency)
            if not requirement.specifier.contains(installed.version, prereleases=True):
                raise ValueError("installed Python dependency does not satisfy its requirement")
            edges[(name, text)] = {
                "owner": name, "requirement": text, "dependency": dependency,
            }
            pending.append((dependency, frozenset(
                canonicalize_name(extra) for extra in requirement.extras
            )))
    inputs: dict[str, Any] = {
        "requirements": {
            "environment": environment,
            "extras": {name: sorted(value) for name, value in extras.items()},
            "edges": [edges[key] for key in sorted(edges)],
        },
    }
    roots = []
    for name, distribution in sorted(distributions.items()):
        modules = sorted(
            module for module, owners in mappings.items()
            if module != "__pycache__"
            and name in {canonicalize_name(owner) for owner in owners}
        )
        if not modules:
            raise ValueError("Python distribution has no concrete import roots")
        boundary = Path(distribution.locate_file("")).resolve(strict=True)
        for module in modules:
            if len(mappings[module]) != 1 or not module.isidentifier():
                raise ValueError("shared Python namespace needs a qualified owner")
            spec = importlib.util.find_spec(module)
            if spec is None or spec.origin is None:
                raise ValueError(f"Python dependency {module} has no concrete installation")
            origin = Path(spec.origin).resolve(strict=True)
            package_root = origin.parent if spec.submodule_search_locations else origin
            if not package_root.is_relative_to(boundary):
                raise ValueError("Python import resolution escapes its installed distribution")
            roots.append(package_root)
            inputs[str(package_root)] = (
                tree_digest(package_root) if package_root.is_dir() else file_digest(package_root)
            )
            if package_root.is_file():
                cached = Path(importlib.util.cache_from_source(str(package_root)))
                inputs[str(cached)] = file_digest(cached) if cached.is_file() else "absent"
            importlib.import_module(module)
        inputs[f"distribution:{name}"] = digest({
            "name": name, "version": distribution.version,
            "metadata": distribution.read_text("METADATA"),
            "record": distribution.read_text("RECORD"),
        })
    for name in selections:
        importlib.import_module(name)
    return inputs, roots


def python_installation(root: Path, packages: list[str] | None = None) -> dict[str, Any]:
    """Bind the running interpreter, framework, stdlib and effective import roots."""
    binaries = list(dict.fromkeys((sys.executable, sys._base_executable)))
    executable_inputs = {value: executable_input(value) for value in binaries}
    stdlib = Path(sysconfig.get_path("stdlib")).resolve(strict=True)
    framework = sysconfig.get_config_var("PYTHONFRAMEWORK")
    linked_files = (
        frozenset({(Path(sys.base_prefix) / framework).resolve(strict=True)})
        if framework else frozenset()
    )
    installations = {
        str(stdlib): tree_digest(
            stdlib, excluded_children=frozenset({"site-packages"}), linked_files=linked_files,
        ),
    }
    effective_paths = []
    package_inputs, package_roots = python_package_inputs(packages or [])
    installations.update(package_inputs)
    for entry in sys.path:
        path = Path(entry or os.getcwd()).resolve()
        effective_paths.append(str(path))
        if path == root.resolve(strict=True) or path.is_relative_to(stdlib):
            continue
        if path.is_file():
            installations[str(path)] = file_digest(path)
        elif path.is_dir() and path.name in {"site-packages", "dist-packages"}:
            installations[str(path)] = digest({
                str(item): file_digest(item)
                for item in sorted(path.iterdir())
                if item.is_file() and (
                    item.suffix == ".pth" or item.name in {"sitecustomize.py", "usercustomize.py"}
                )
            })
        elif not path.exists():
            installations[str(path)] = "absent"
        else:
            raise ValueError("external Python import root has no installed input owner")
    for module in tuple(sys.modules.values()):
        filename = getattr(module, "__file__", None)
        if not filename:
            continue
        path = Path(filename).resolve()
        if path.is_relative_to(root.resolve()) or (
            path.is_relative_to(stdlib) and "site-packages" not in path.parts
        ):
            continue
        if not any(path == item or path.is_relative_to(item) for item in package_roots):
            raise ValueError("loaded Python code is outside the declared installed package closure")
    return {
        "executables": executable_inputs,
        "version": list(sys.version_info), "implementation": sys.implementation.cache_tag,
        "effectivePaths": effective_paths, "installations": installations,
        "libraries": loaded_python_libraries(),
    }
