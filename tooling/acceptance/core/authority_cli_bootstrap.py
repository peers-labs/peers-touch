"""Isolated source bootstrap for D-19 authority commands."""

from __future__ import annotations

import ast
import hashlib
import importlib.util
import os
import subprocess
import sys
import types
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, TypeVar

from . import finalization_contracts as contracts


class AuthorityBootstrapError(RuntimeError):
    pass


T = TypeVar("T")


@dataclass(frozen=True)
class VerifiedAuthoritySource:
    source_commit: str
    approval_document_path: str
    approval_document_sha256: str
    source_files: tuple[tuple[str, str, int], ...]
    source_digest: str


def require_isolated_process() -> None:
    required = {
        "isolated": sys.flags.isolated,
        "no_site": sys.flags.no_site,
        "ignore_environment": sys.flags.ignore_environment,
        "dont_write_bytecode": sys.dont_write_bytecode,
    }
    if not all(required.values()):
        missing = ", ".join(name for name, enabled in required.items() if not enabled)
        raise AuthorityBootstrapError(
            f"authority CLI requires python -I -S -E -B; missing {missing}"
        )


def _git(repo_root: Path, *arguments: str) -> bytes:
    completed = subprocess.run(
        ("git", *arguments),
        cwd=repo_root,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if completed.returncode != 0:
        raise AuthorityBootstrapError(
            completed.stderr.decode("utf-8", errors="replace").strip()
            or "Git authority verification failed"
        )
    return completed.stdout


def verify_authority_source(
    repo_root: Path,
    *,
    expected_commit: str,
    approval_document_path: str,
    expected_approval_sha256: str,
    source_paths: tuple[str, ...],
) -> VerifiedAuthoritySource:
    root = Path(repo_root).resolve(strict=True)
    if _git(root, "rev-parse", "HEAD").decode().strip() != expected_commit:
        raise AuthorityBootstrapError("authority source commit is not current HEAD")
    normalized_paths = tuple(
        sorted(
            {
                contracts.validate_repo_relative_path(path)
                for path in source_paths
            },
            key=lambda item: item.encode("utf-8"),
        )
    )
    if not normalized_paths:
        raise AuthorityBootstrapError("authority source closure is empty")
    status = _git(
        root,
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "--",
        *normalized_paths,
    )
    if status:
        raise AuthorityBootstrapError("authority-bearing source is not clean")
    approval_path = contracts.validate_repo_relative_path(approval_document_path)
    approval = _git(root, "show", f"{expected_commit}:{approval_path}")
    if hashlib.sha256(approval).hexdigest() != expected_approval_sha256:
        raise AuthorityBootstrapError("accepted authority document hash mismatch")
    if b"D-19" not in approval:
        raise AuthorityBootstrapError("authority document does not accept D-19")
    source_files = []
    for relative in normalized_paths:
        data = _git(root, "show", f"{expected_commit}:{relative}")
        source_files.append(
            (relative, hashlib.sha256(data).hexdigest(), len(data))
        )
    source_tuple = tuple(source_files)
    return VerifiedAuthoritySource(
        source_commit=expected_commit,
        approval_document_path=approval_path,
        approval_document_sha256=expected_approval_sha256,
        source_files=source_tuple,
        source_digest=hashlib.sha256(
            contracts.canonical_json_bytes([list(item) for item in source_tuple])
        ).hexdigest(),
    )


def verify_kernel_principal_and_tty(
    *,
    input_stream: object = sys.stdin,
    output_stream: object = sys.stderr,
) -> str:
    if os.name == "nt":
        raise AuthorityBootstrapError("D-19 authority CLI requires POSIX")
    if os.getuid() != os.geteuid():
        raise AuthorityBootstrapError("real and effective UID must match")
    if not (
        hasattr(input_stream, "isatty")
        and input_stream.isatty()
        and hasattr(output_stream, "isatty")
        and output_stream.isatty()
    ):
        raise AuthorityBootstrapError("authority command requires a controlling TTY")
    return f"uid:{os.geteuid()}"


def confirmation_challenge(payload: dict[str, object]) -> str:
    return contracts.domain_separated_sha256(
        "pt.acceptance.finalization.authority-confirmation.v1",
        payload,
    )


def require_confirmation(
    payload: dict[str, object],
    *,
    read_confirmation: Callable[[str], str],
) -> str:
    challenge = confirmation_challenge(payload)
    if read_confirmation(challenge).strip() != challenge:
        raise AuthorityBootstrapError("authority confirmation challenge mismatch")
    return challenge


def _validate_imports(
    source: bytes,
    *,
    allowed_modules: frozenset[str],
    path: str,
) -> None:
    try:
        tree = ast.parse(source, filename=path, feature_version=(3, 12))
    except (SyntaxError, ValueError) as error:
        raise AuthorityBootstrapError("authority source cannot be parsed") from error
    for node in ast.walk(tree):
        names: tuple[str, ...] = ()
        if isinstance(node, ast.Import):
            names = tuple(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                continue
            names = () if node.module is None else (node.module,)
        for name in names:
            root = name.split(".", 1)[0]
            if root not in allowed_modules:
                raise AuthorityBootstrapError(
                    f"authority source imports unapproved module: {name}"
                )


def load_verified_source_module(
    repo_root: Path,
    source: VerifiedAuthoritySource,
    *,
    relative_path: str,
    module_name: str,
    allowed_modules: frozenset[str],
) -> types.ModuleType:
    relative = contracts.validate_repo_relative_path(relative_path)
    expected = {
        path: (digest, length)
        for path, digest, length in source.source_files
    }.get(relative)
    if expected is None:
        raise AuthorityBootstrapError("module is outside verified source closure")
    data = _git(
        Path(repo_root).resolve(strict=True),
        "show",
        f"{source.source_commit}:{relative}",
    )
    if (hashlib.sha256(data).hexdigest(), len(data)) != expected:
        raise AuthorityBootstrapError("verified authority module bytes changed")
    _validate_imports(
        data,
        allowed_modules=allowed_modules,
        path=relative,
    )
    module = types.ModuleType(module_name)
    module.__file__ = f"{source.source_commit}:{relative}"
    module.__package__ = module_name.rpartition(".")[0]
    module.__spec__ = importlib.util.spec_from_loader(module_name, loader=None)
    exec(compile(data, module.__file__, "exec"), module.__dict__, module.__dict__)
    return module


def mutate_after_runtime_persisted(
    *,
    persist_runtime: Callable[[], contracts.PersistAuthorityRuntimeCompleted],
    mutation: Callable[[], T],
) -> T:
    result = persist_runtime()
    if type(result) is not contracts.PersistAuthorityRuntimeCompleted:
        raise AuthorityBootstrapError(
            "authority runtime was not durably persisted before mutation"
        )
    return mutation()
