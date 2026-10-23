from __future__ import annotations

import errno
import hashlib
import json
import mimetypes
import os
import re
import secrets
import shutil
import stat
import struct
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, BinaryIO, Mapping

from . import finalization_contracts as finalization
from .errors import (
    EvidenceConflict,
    EvidenceError,
    EvidenceManifestInvalid,
    EvidenceNoSpace,
    EvidencePathTraversal,
    EvidencePermissionDenied,
    EvidenceQuotaExceeded,
    EvidenceRootForbidden,
    EvidenceRootInvalid,
    EvidenceRunActive,
    EvidenceSymlinkRejected,
    EvidenceWriteInterrupted,
)
from .redaction import (
    is_sensitive_key,
    REDACTED,
    redact_artifact_bytes,
    redact_text_with_values,
    redact_value,
    redact_value_with_values,
    secret_text_redactor,
)


ARTIFACT_ROOT_ENV = "PT_ACCEPTANCE_ARTIFACT_ROOT"
RUN_WORKSPACE_ENV = "PT_ACCEPTANCE_WORKSPACE_ID"
RUN_GATE_ENV = "PT_ACCEPTANCE_GATE_ID"
RUN_ID_ENV = "PT_ACCEPTANCE_RUN_ID"
REDACTION_VALUES_ENV = "PT_ACCEPTANCE_REDACTION_VALUES"
GATE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
RUN_ID_PATTERN = re.compile(r"^\d{8}T\d{12}Z-[0-9a-f]{32}$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


def _public_metadata(value: Any, secret_values: tuple[str, ...]) -> Any:
    """Scan every string, rejecting loss of identity rather than sealing it."""
    text = secret_text_redactor(secret_values)

    def visit(item: Any) -> Any:
        if isinstance(item, Mapping):
            return {visit(key): visit(child) for key, child in item.items()}
        if isinstance(item, (list, tuple)):
            return [visit(child) for child in item]
        if isinstance(item, str):
            if text(item) != item:
                raise EvidenceManifestInvalid("public metadata contains a resolved credential")
            return item
        if item is None or isinstance(item, (bool, int, float)):
            return item
        raise EvidenceManifestInvalid("public metadata contains an unsupported value")

    return visit(value)


def _json_payload(value: Any, secret_values: tuple[str, ...]) -> Any:
    """Only actual closed producer types bypass payload field-name heuristics."""
    from .execution_graph import ExecutionGraph

    text = secret_text_redactor(secret_values)

    def visit(item: Any) -> Any:
        if type(item) is ExecutionGraph:
            item.validate()
            return _public_metadata(item, secret_values)
        if type(item) is ArtifactRef:
            return _public_metadata(item.to_dict(), secret_values)
        if isinstance(item, Mapping):
            return {
                text(str(key)): (
                    child if is_sensitive_key(key) and isinstance(child, bool)
                    else REDACTED if is_sensitive_key(key)
                    else visit(child)
                )
                for key, child in item.items()
            }
        if isinstance(item, (list, tuple)):
            return [visit(child) for child in item]
        if isinstance(item, str):
            return text(item)
        if isinstance(item, (bytes, bytearray, memoryview)):
            return REDACTED
        if item is None or isinstance(item, (bool, int, float)):
            return item
        return text(str(item))

    return visit(value)


@dataclass(frozen=True)
class _JsonArtifact:
    value: Mapping[str, Any]

    def encode(self, secret_values: tuple[str, ...]) -> tuple[bytes, bool]:
        if not isinstance(self.value, Mapping):
            raise EvidenceManifestInvalid("JSON artifact must be an object")
        payload = _json_payload(self.value, secret_values)
        encoded = (json.dumps(payload, indent=2, sort_keys=True, default=str) + "\n").encode("utf-8")
        return encoded, payload != self.value


def _redaction_values(
    environment: Mapping[str, str] | None = None,
) -> tuple[str, ...]:
    current_environment = dict(os.environ if environment is None else environment)
    raw = current_environment.get(REDACTION_VALUES_ENV, "").strip()
    if not raw:
        return ()
    try:
        values = json.loads(raw)
    except json.JSONDecodeError as error:
        raise EvidenceManifestInvalid(
            "Acceptance redaction values are malformed"
        ) from error
    if (
        not isinstance(values, list)
        or any(not isinstance(value, str) for value in values)
    ):
        raise EvidenceManifestInvalid(
            "Acceptance redaction values must be a string array"
        )
    return tuple(values)


def canonical_secret_scan(
    value: object,
    secret_values: tuple[str, ...] = (),
) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise EvidenceManifestInvalid("secretScan must be an object")
    expected_fields = {
        "status",
        "scannedHighEntropyValues",
        "scannedCredentialValues",
        "redactedArtifacts",
    }
    if set(value) != expected_fields:
        raise EvidenceManifestInvalid(
            "secretScan must contain only the canonical scan fields"
        )
    status = value.get("status")
    high_entropy_count = value.get("scannedHighEntropyValues")
    credential_count = value.get("scannedCredentialValues")
    redacted_artifacts = value.get("redactedArtifacts")
    if status not in {"passed", "failed"}:
        raise EvidenceManifestInvalid("secretScan status is invalid")
    for field, count in (
        ("scannedHighEntropyValues", high_entropy_count),
        ("scannedCredentialValues", credential_count),
    ):
        if isinstance(count, bool) or not isinstance(count, int) or count < 0:
            raise EvidenceManifestInvalid(
                f"secretScan {field} must be a non-negative integer"
            )
    if (
        not isinstance(redacted_artifacts, list)
        or any(not isinstance(item, str) for item in redacted_artifacts)
    ):
        raise EvidenceManifestInvalid(
            "secretScan redactedArtifacts must be a string array"
        )
    return {
        "status": status,
        "scannedHighEntropyValues": high_entropy_count,
        "scannedCredentialValues": credential_count,
        "redactedArtifacts": redact_value_with_values(
            redacted_artifacts,
            secret_values,
        ),
    }


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def new_run_id() -> str:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    return f"{timestamp}-{secrets.token_hex(16)}"


def canonical_workspace_path(worktree: Path) -> str:
    return os.path.normcase(os.path.realpath(os.path.abspath(str(worktree))))


def workspace_id(worktree: Path) -> str:
    canonical = canonical_workspace_path(worktree)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def _reject_symlink_components(path: Path, *, role: str) -> None:
    absolute = Path(os.path.abspath(str(path)))
    current = Path(absolute.anchor)
    for part in absolute.parts[1:]:
        current = current / part
        if current.is_symlink():
            stat = current.lstat()
            if os.name != "nt" and stat.st_uid == 0:
                continue
            raise EvidenceSymlinkRejected(
                f"symlink path component is forbidden: {current}",
                operation="validate-path",
                path_role=role,
            )


def validate_external_output_path(
    value: str | Path,
    *,
    repo_root: Path,
) -> Path:
    candidate = Path(os.path.realpath(os.path.abspath(str(value))))
    repository = Path(canonical_workspace_path(repo_root))
    if candidate == repository or _contains(repository, candidate):
        raise EvidenceRootForbidden(
            "explicit Acceptance output must remain outside the repository",
            operation="resolve-explicit-output",
            path_role="test-fixture-output",
        )
    return candidate


def source_identity(repo_root: Path) -> dict[str, str]:
    from .attestation import source_workspace_digest

    completed = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=False,
    )
    commit = completed.stdout.strip()
    if completed.returncode != 0 or not commit:
        raise EvidenceManifestInvalid("cannot resolve source commit")
    return {
        "commit": commit,
        "workspaceDigest": source_workspace_digest(repo_root),
        "canonicalWorktreeHash": workspace_id(repo_root),
    }


def _is_ci(environment: Mapping[str, str]) -> bool:
    value = environment.get("CI", "").strip().lower()
    return value not in {"", "0", "false", "no"}


def _expand_user(path: str, home: Path) -> Path:
    if path == "~":
        return home
    if path.startswith("~/") or path.startswith("~\\"):
        return home / path[2:]
    return Path(path)


def _map_os_error(
    error: OSError,
    *,
    operation: str,
    path_role: str,
) -> EvidenceError:
    message = f"{operation} failed for {path_role}: {error.strerror or type(error).__name__}"
    kwargs = {"operation": operation, "path_role": path_role}
    if error.errno in {errno.EACCES, errno.EPERM, errno.EROFS}:
        return EvidencePermissionDenied(message, **kwargs)
    if error.errno in {errno.ENOSPC, getattr(errno, "EDQUOT", -1)}:
        return EvidenceNoSpace(message, **kwargs)
    return EvidenceWriteInterrupted(message, **kwargs)


def _contains(parent: Path, child: Path) -> bool:
    try:
        return os.path.commonpath((str(parent), str(child))) == str(parent)
    except ValueError:
        return False


def resolve_artifact_root(
    *,
    repo_root: Path,
    platform: str | None = None,
    environment: Mapping[str, str] | None = None,
    home: Path | None = None,
    create: bool = True,
) -> Path:
    current_platform = platform or sys.platform
    current_environment = dict(os.environ if environment is None else environment)
    current_home = home or Path.home()
    override = current_environment.get(ARTIFACT_ROOT_ENV, "").strip()

    if _is_ci(current_environment) and not override:
        raise EvidenceRootInvalid(
            f"{ARTIFACT_ROOT_ENV} is required in CI",
            operation="resolve-root",
            path_role="artifact-root",
        )

    if override:
        candidate = _expand_user(override, current_home)
    elif current_platform == "darwin":
        candidate = current_home / "Library" / "Application Support" / "PeersTouch" / "acceptance"
    elif current_platform.startswith("linux"):
        state_home = current_environment.get("XDG_STATE_HOME", "").strip()
        candidate = (
            _expand_user(state_home, current_home)
            if state_home
            else current_home / ".local" / "state"
        ) / "peers-touch" / "acceptance"
    elif current_platform in {"win32", "cygwin"}:
        local_app_data = current_environment.get("LOCALAPPDATA", "").strip()
        if not local_app_data:
            raise EvidenceRootInvalid(
                "LOCALAPPDATA is required for the Windows artifact root",
                operation="resolve-root",
                path_role="artifact-root",
            )
        candidate = _expand_user(local_app_data, current_home) / "PeersTouch" / "acceptance"
    else:
        raise EvidenceRootInvalid(
            f"unsupported artifact-root platform: {current_platform}",
            operation="resolve-root",
            path_role="artifact-root",
        )

    if not candidate.is_absolute():
        raise EvidenceRootInvalid(
            "artifact root must be absolute",
            operation="resolve-root",
            path_role="artifact-root",
        )

    _reject_symlink_components(candidate, role="artifact-root")
    root = Path(os.path.realpath(str(candidate)))
    canonical_repo = Path(os.path.realpath(str(repo_root)))
    if root == canonical_repo or _contains(canonical_repo, root):
        raise EvidenceRootForbidden(
            "artifact root must be outside the repository",
            operation="resolve-root",
            path_role="artifact-root",
        )
    if root.exists() and not root.is_dir():
        raise EvidenceRootInvalid(
            "artifact root exists and is not a directory",
            operation="resolve-root",
            path_role="artifact-root",
        )

    if create:
        try:
            root.mkdir(mode=0o700, parents=True, exist_ok=True)
            if os.name != "nt":
                root.chmod(0o700)
        except OSError as error:
            raise _map_os_error(
                error,
                operation="create-root",
                path_role="artifact-root",
            ) from error
    return root


def current_run_directory(
    *,
    repo_root: Path,
    environment: Mapping[str, str] | None = None,
) -> Path:
    current_environment = dict(os.environ if environment is None else environment)
    expected_workspace = workspace_id(repo_root)
    context_workspace = current_environment.get(RUN_WORKSPACE_ENV, "").strip()
    gate_id = current_environment.get(RUN_GATE_ENV, "").strip()
    run_id = current_environment.get(RUN_ID_ENV, "").strip()
    if not context_workspace or not gate_id or not run_id:
        raise EvidenceRootInvalid(
            "Acceptance run context is required; execute through acceptance-run",
            operation="resolve-run",
            path_role="run",
        )
    if context_workspace != expected_workspace:
        raise EvidenceManifestInvalid("run context workspace mismatch")
    root = resolve_artifact_root(
        repo_root=repo_root,
        environment=current_environment,
    )
    run_dir = (
        root
        / context_workspace
        / _validate_gate_id(gate_id)
        / validate_run_id(run_id)
    )
    _ensure_no_symlink(root, run_dir)
    if not run_dir.is_dir():
        raise EvidenceManifestInvalid("run context directory does not exist")
    return run_dir


def current_artifact_path(
    relative_path: str,
    *,
    repo_root: Path,
    environment: Mapping[str, str] | None = None,
) -> Path:
    run_dir = current_run_directory(
        repo_root=repo_root,
        environment=environment,
    )
    relative = _validate_relative_path(relative_path)
    target = run_dir.joinpath(*relative.parts)
    if not _contains(run_dir, target):
        raise EvidencePathTraversal("artifact path escaped its run")
    _ensure_no_symlink(run_dir, target)
    _private_directory(target.parent, "artifact-parent")
    return target


def write_current_artifact(
    relative_path: str,
    value: bytes,
    *,
    repo_root: Path,
    environment: Mapping[str, str] | None = None,
) -> Path:
    return _write_current_artifact(
        relative_path, value, repo_root=repo_root, environment=environment,
    )


def write_current_json(
    relative_path: str,
    value: Mapping[str, Any],
    *,
    repo_root: Path,
    environment: Mapping[str, str] | None = None,
) -> Path:
    return _write_current_artifact(
        relative_path, _JsonArtifact(value), repo_root=repo_root, environment=environment,
    )


def _write_current_artifact(
    relative_path: str,
    value: bytes | _JsonArtifact,
    *,
    repo_root: Path,
    environment: Mapping[str, str] | None = None,
) -> Path:
    current_environment = dict(
        os.environ if environment is None else environment
    )
    secret_values = _redaction_values(current_environment)
    if redact_text_with_values(relative_path, secret_values) != relative_path:
        raise EvidenceManifestInvalid(
            "Acceptance artifact path contains a resolved credential"
        )
    value, _ = (
        value.encode(secret_values) if type(value) is _JsonArtifact
        else redact_artifact_bytes(value, secret_values)
    )
    run_dir = current_run_directory(
        repo_root=repo_root,
        environment=current_environment,
    )
    lock = _FileLock(run_dir / ".artifact-write.lock")
    lock.acquire(blocking=True)
    finalization_lock = _FileLock(run_dir / ".finalization.lock")
    try:
        _acquire_bounded(
            finalization_lock,
            timeout_seconds=60,
            operation="write-current-artifact",
        )
        if (run_dir / "sealed.json").exists():
            raise EvidenceConflict(
                "artifacts are sealed for finalization",
                operation="write-artifact",
                path_role=relative_path,
            )
        target = current_artifact_path(
            relative_path,
            repo_root=repo_root,
            environment=current_environment,
        )
        if target.is_file():
            if _sha256_file(target) != _sha256_bytes(value):
                raise EvidenceConflict(
                    f"artifact path already has different bytes: {relative_path}"
                )
            return target
        _atomic_write(target, value, path_role=relative_path)
        return target
    finally:
        finalization_lock.release()
        lock.release()


def current_artifact_ref(
    relative_path: str,
    *,
    repo_root: Path,
    media_type: str | None = None,
    environment: Mapping[str, str] | None = None,
) -> "ArtifactRef":
    current_environment = dict(os.environ if environment is None else environment)
    target = current_artifact_path(
        relative_path,
        repo_root=repo_root,
        environment=current_environment,
    )
    return ArtifactRef(
        workspace_id=current_environment.get(RUN_WORKSPACE_ENV, ""),
        gate_id=current_environment.get(RUN_GATE_ENV, ""),
        run_id=current_environment.get(RUN_ID_ENV, ""),
        path=_validate_relative_path(relative_path).as_posix(),
        sha256=_sha256_file(target),
        media_type=media_type or _media_type(target),
    )


def latest_artifact_path(
    gate_id: str,
    role: str,
    *,
    repo_root: Path,
    runtime_cell: str | None = None,
    environment: Mapping[str, str] | None = None,
) -> Path:
    store = EvidenceStore.from_environment(
        repo_root=repo_root,
        worktree=repo_root,
        environment=environment,
    )
    return store.resolve(
        store.latest_artifact_ref(
            gate_id,
            role,
            runtime_cell=runtime_cell,
        )
    )


def _validate_gate_id(gate_id: str) -> str:
    if not GATE_ID_PATTERN.fullmatch(gate_id):
        raise EvidencePathTraversal(
            f"invalid Gate ID: {gate_id!r}",
            operation="validate-identity",
            path_role="gate-id",
        )
    return gate_id


def validate_run_id(run_id: str) -> str:
    if not RUN_ID_PATTERN.fullmatch(run_id):
        raise EvidencePathTraversal(
            f"invalid run ID: {run_id!r}",
            operation="validate-identity",
            path_role="run-id",
        )
    return run_id


def _validate_relative_path(value: str) -> PurePosixPath:
    if not value or "\x00" in value or "\\" in value:
        raise EvidencePathTraversal(
            f"invalid artifact path: {value!r}",
            operation="validate-path",
            path_role="artifact",
        )
    path = PurePosixPath(value)
    if (
        not path.parts
        or path.is_absolute()
        or any(part in {"", ".", ".."} for part in path.parts)
    ):
        raise EvidencePathTraversal(
            f"artifact path must remain inside its run: {value!r}",
            operation="validate-path",
            path_role="artifact",
        )
    if re.match(r"^[A-Za-z]:", value):
        raise EvidencePathTraversal(
            f"artifact path cannot contain a drive prefix: {value!r}",
            operation="validate-path",
            path_role="artifact",
        )
    return path


def _ensure_no_symlink(base: Path, target: Path) -> None:
    current = base
    if current.is_symlink():
        raise EvidenceSymlinkRejected(
            f"symlink base is forbidden: {base}",
            operation="validate-path",
            path_role="artifact",
        )
    for part in target.relative_to(base).parts:
        current = current / part
        if current.exists() and current.is_symlink():
            raise EvidenceSymlinkRejected(
                f"symlink artifact path is forbidden: {current}",
                operation="validate-path",
                path_role="artifact",
            )


def _private_directory(path: Path, role: str) -> None:
    for component in (path, *path.parents):
        if component.is_symlink():
            raise EvidenceSymlinkRejected(
                f"symlink directory is forbidden: {component}",
                operation="create-directory",
                path_role=role,
            )
    try:
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
        if path.is_symlink() or not path.is_dir():
            raise EvidenceSymlinkRejected(
                f"artifact directory is not a real directory: {path}",
                operation="create-directory",
                path_role=role,
            )
        if os.name != "nt":
            path.chmod(0o700)
    except OSError as error:
        raise _map_os_error(
            error,
            operation="create-directory",
            path_role=role,
        ) from error


def _fsync_directory(path: Path) -> None:
    if os.name == "nt":
        return
    descriptor = os.open(str(path), os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _fsync_file(path: Path, *, path_role: str) -> None:
    try:
        with path.open("rb") as handle:
            os.fsync(handle.fileno())
    except OSError as error:
        raise _map_os_error(
            error,
            operation="fsync-file",
            path_role=path_role,
        ) from error


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _media_type(path: Path) -> str:
    media_type, _ = mimetypes.guess_type(path.name)
    return media_type or "application/octet-stream"


def _atomic_write(path: Path, value: bytes, *, path_role: str) -> None:
    if path.is_symlink():
        raise EvidenceSymlinkRejected(
            f"symlink artifact is forbidden: {path}",
            operation="atomic-write",
            path_role=path_role,
        )
    _private_directory(path.parent, f"{path_role}-parent")
    # Keep the temporary basename bounded so long artifact names remain below
    # Windows MAX_PATH while preserving same-directory atomic replacement.
    temporary = path.parent / f".tmp-{secrets.token_hex(8)}"
    try:
        with temporary.open("xb") as handle:
            if os.name != "nt":
                os.chmod(temporary, 0o600)
            handle.write(value)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        _fsync_directory(path.parent)
    except OSError as error:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass
        raise _map_os_error(
            error,
            operation="atomic-write",
            path_role=path_role,
        ) from error


def _atomic_write_no_replace(
    path: Path,
    value: bytes,
    *,
    path_role: str,
) -> bool:
    """Publish immutable bytes once; return False only for an equal retry."""
    if path.is_symlink():
        raise EvidenceSymlinkRejected(
            f"symlink artifact is forbidden: {path}",
            operation="atomic-write-no-replace",
            path_role=path_role,
        )
    _private_directory(path.parent, f"{path_role}-parent")
    temporary = path.parent / f".tmp-{secrets.token_hex(8)}"
    try:
        with temporary.open("xb") as handle:
            if os.name != "nt":
                os.chmod(temporary, 0o600)
            handle.write(value)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            if path.is_symlink() or not path.is_file():
                raise EvidenceConflict(
                    f"immutable path is not a regular file: {path.name}",
                    operation="atomic-write-no-replace",
                    path_role=path_role,
                )
            if path.read_bytes() != value:
                raise EvidenceConflict(
                    f"immutable path already has different bytes: {path.name}",
                    operation="atomic-write-no-replace",
                    path_role=path_role,
                )
            _fsync_file(path, path_role=path_role)
            _fsync_directory(path.parent)
            return False
        _fsync_directory(path.parent)
        return True
    except EvidenceError:
        raise
    except OSError as error:
        raise _map_os_error(
            error,
            operation="atomic-write-no-replace",
            path_role=path_role,
        ) from error
    finally:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass


class _FileLock:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._handle: BinaryIO | None = None

    def acquire(self, *, blocking: bool, shared: bool = False) -> bool:
        if self._handle is not None:
            return True
        _private_directory(self.path.parent, "lock-parent")
        if self.path.is_symlink():
            raise EvidenceSymlinkRejected(
                f"symlink lock is forbidden: {self.path}",
                operation="lock",
                path_role="lock",
            )
        try:
            if os.name != "nt":
                descriptor = os.open(
                    self.path,
                    os.O_RDWR
                    | os.O_CREAT
                    | os.O_CLOEXEC
                    | getattr(os, "O_NOFOLLOW", 0),
                    0o600,
                )
                handle = os.fdopen(descriptor, "r+b", closefd=True)
                os.chmod(self.path, 0o600)
                import fcntl

                flags = (
                    fcntl.LOCK_SH if shared else fcntl.LOCK_EX
                ) | (0 if blocking else fcntl.LOCK_NB)
                try:
                    fcntl.flock(handle.fileno(), flags)
                except BlockingIOError:
                    handle.close()
                    return False
            else:
                if shared:
                    raise EvidenceConflict(
                        "shared Gate publish locks require POSIX flock",
                        operation="acquire-lock",
                        path_role="lock",
                    )
                handle = self.path.open("a+b")
                import msvcrt

                if self.path.stat().st_size == 0:
                    handle.write(b"\0")
                    handle.flush()
                handle.seek(0)
                mode = msvcrt.LK_LOCK if blocking else msvcrt.LK_NBLCK
                try:
                    msvcrt.locking(handle.fileno(), mode, 1)
                except OSError:
                    handle.close()
                    return False
        except OSError as error:
            raise _map_os_error(
                error,
                operation="acquire-lock",
                path_role="lock",
            ) from error
        self._handle = handle
        return True

    def fileno(self) -> int:
        if self._handle is None:
            raise EvidenceConflict(
                "lock is not held",
                operation="inspect-lock",
                path_role="lock",
            )
        return self._handle.fileno()

    def release(self) -> None:
        handle = self._handle
        if handle is None:
            return
        self._handle = None
        try:
            if os.name != "nt":
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
            else:
                import msvcrt

                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        finally:
            handle.close()


def _acquire_bounded(
    lock: _FileLock,
    *,
    timeout_seconds: float,
    operation: str,
) -> None:
    deadline = time.monotonic() + timeout_seconds
    while not lock.acquire(blocking=False):
        if time.monotonic() >= deadline:
            raise EvidenceConflict(
                f"{operation} lock acquisition timed out",
                operation=operation,
                path_role="lock",
            )
        time.sleep(min(0.01, max(0.0, deadline - time.monotonic())))


class GatePublishLock:
    """A held Gate publish lock without store or mutation capabilities."""

    def __init__(
        self,
        lock: _FileLock,
        identity: finalization.GatePublishLockIdentity,
        *,
        shared: bool,
    ) -> None:
        self._lock = lock
        self.identity = identity
        self.shared = shared
        self._closed = False

    @property
    def held(self) -> bool:
        return not self._closed

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._lock.release()

    def __enter__(self) -> "GatePublishLock":
        if self._closed:
            raise EvidenceConflict(
                "Gate publish lock is already closed",
                operation="enter-publish-lock",
                path_role="lock",
            )
        return self

    def __exit__(self, *ignored: object) -> None:
        self.close()

    def __reduce__(self) -> object:
        raise TypeError("GatePublishLock is process-local and non-serializable")


class ExecutionRequestClaim:
    """One process-local lock and one-shot request consumption, outside evidence."""

    def __init__(self, directory: Path) -> None:
        self.directory = directory
        self._lock = _FileLock(directory / "request.lock")
        if not self._lock.acquire(blocking=False):
            raise EvidenceConflict("execution session already has an active request")
        self._request_dir: Path | None = None

    def consume(self, sequence: int, prior_manifest: ArtifactRef | None) -> None:
        if self._request_dir is not None or type(sequence) is not int or sequence < 1:
            raise EvidenceConflict("execution request can only be consumed once")
        _ensure_no_symlink(self.directory, self.directory)
        if sequence > 1:
            completed = self.directory / str(sequence - 1) / "completed.json"
            try:
                _ensure_no_symlink(self.directory, completed)
                previous = ArtifactRef.from_dict(json.loads(completed.read_text()))
            except (OSError, ValueError, EvidenceError) as error:
                raise EvidenceConflict("prior request lacks durable terminal cleanup") from error
            if previous != prior_manifest:
                raise EvidenceConflict("stale execution session manifest")
        elif prior_manifest is not None:
            raise EvidenceConflict("initial request cannot consume prior proof")
        request_dir = self.directory / str(sequence)
        _private_directory(request_dir, "execution-request")
        created = _atomic_write_no_replace(
            request_dir / "consumed.json",
            (json.dumps({
                "request": sequence,
                "priorManifest": prior_manifest.to_dict() if prior_manifest else None,
            }, sort_keys=True) + "\n").encode(),
            path_role="execution-request",
        )
        if not created:
            raise EvidenceConflict("execution request sequence was already consumed")
        self._request_dir = request_dir

    def complete(self, reference: ArtifactRef) -> None:
        if self._request_dir is None:
            raise EvidenceConflict("execution request was not consumed")
        _atomic_write_no_replace(
            self._request_dir / "completed.json",
            (json.dumps(reference.to_dict(), sort_keys=True) + "\n").encode(),
            path_role="execution-request-terminal",
        )

    def close(self) -> None:
        self._lock.release()


@dataclass(frozen=True)
class ArtifactRef:
    workspace_id: str
    gate_id: str
    run_id: str
    path: str
    sha256: str
    media_type: str
    artifact_kind: str = "acceptance-artifact-ref"

    def __post_init__(self) -> None:
        if not re.fullmatch(r"[0-9a-f]{16}", self.workspace_id):
            raise EvidenceManifestInvalid("invalid workspace ID")
        _validate_gate_id(self.gate_id)
        validate_run_id(self.run_id)
        _validate_relative_path(self.path)
        if not SHA256_PATTERN.fullmatch(self.sha256):
            raise EvidenceManifestInvalid("invalid artifact SHA-256")

    def to_dict(self) -> dict[str, str]:
        return {
            "artifactKind": self.artifact_kind,
            "workspaceId": self.workspace_id,
            "gateId": self.gate_id,
            "runId": self.run_id,
            "path": self.path,
            "sha256": self.sha256,
            "mediaType": self.media_type,
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "ArtifactRef":
        if not isinstance(value, Mapping):
            raise EvidenceManifestInvalid("artifact reference must be an object")
        fields = {"artifactKind", "workspaceId", "gateId", "runId", "path", "sha256", "mediaType"}
        if set(value) != fields or any(not isinstance(item, str) for item in value.values()):
            raise EvidenceManifestInvalid("artifact reference has unknown, missing or non-string fields")
        if value.get("artifactKind") != "acceptance-artifact-ref":
            raise EvidenceManifestInvalid("invalid artifact reference kind")
        try:
            return cls(
                workspace_id=value["workspaceId"],
                gate_id=value["gateId"],
                run_id=value["runId"],
                path=value["path"],
                sha256=value["sha256"],
                media_type=value["mediaType"],
            )
        except KeyError as error:
            raise EvidenceManifestInvalid(
                f"artifact reference missing {error.args[0]}"
            ) from error


def _contract_artifact_ref(reference: ArtifactRef) -> finalization.ArtifactRef:
    return finalization.ArtifactRef.from_dict(reference.to_dict())


def _store_artifact_ref(reference: finalization.ArtifactRef) -> ArtifactRef:
    if type(reference) is not finalization.ArtifactRef:
        raise EvidenceManifestInvalid(
            "finalization ArtifactRef must use the pure contract"
        )
    return ArtifactRef.from_dict(reference.to_dict())


def _canonical_contract_bytes(value: object) -> bytes:
    try:
        return finalization.canonical_json_bytes(value)
    except ValueError as error:
        raise EvidenceManifestInvalid(
            "finalization contract is not canonical JSON"
        ) from error


def _length_prefixed_bundle(
    magic: bytes,
    manifest: object,
    contents: tuple[bytes, ...],
) -> bytes:
    manifest_bytes = _canonical_contract_bytes(manifest)
    return b"".join(
        (
            magic,
            struct.pack(">Q", len(manifest_bytes)),
            manifest_bytes,
            *(
                part
                for content in contents
                for part in (struct.pack(">Q", len(content)), content)
            ),
        )
    )


def _register_current_artifact_role(
    reference: ArtifactRef,
    role: str,
    *,
    repo_root: Path,
) -> None:
    if not role or "\x00" in role or len(role) > 256:
        raise EvidenceManifestInvalid("invalid artifact role")
    run_dir = current_run_directory(repo_root=repo_root)
    target = run_dir.joinpath(*PurePosixPath(reference.path).parts)
    if (
        reference.workspace_id != workspace_id(repo_root)
        or reference.gate_id != os.environ.get(RUN_GATE_ENV)
        or reference.run_id != os.environ.get(RUN_ID_ENV)
        or not target.is_file()
        or _sha256_file(target) != reference.sha256
    ):
        raise EvidenceManifestInvalid(
            "artifact role reference does not match the current run"
        )
    role_dir = run_dir / ".artifact-roles"
    _private_directory(role_dir, "artifact-role-registry")
    lock = _FileLock(run_dir / ".artifact-roles.lock")
    lock.acquire(blocking=True)
    finalization_lock = _FileLock(run_dir / ".finalization.lock")
    try:
        _acquire_bounded(
            finalization_lock,
            timeout_seconds=60,
            operation="register-current-artifact-role",
        )
        if (run_dir / "sealed.json").exists():
            raise EvidenceConflict(
                "artifact roles are sealed for finalization",
                operation="register-artifact-role",
                path_role=role,
            )
        encoded = (
            json.dumps(
                {"role": role, "artifact": reference.to_dict()},
                indent=2,
                sort_keys=True,
            )
            + "\n"
        ).encode("utf-8")
        metadata_path = role_dir / f"{_sha256_bytes(role.encode('utf-8'))}.json"
        if metadata_path.is_file():
            if metadata_path.read_bytes() != encoded:
                raise EvidenceConflict(f"artifact role already exists: {role}")
            return
        _atomic_write(
            metadata_path,
            encoded,
            path_role="artifact-role-registry",
        )
    finally:
        finalization_lock.release()
        lock.release()


class EvidenceStore:
    def __init__(
        self,
        root: Path,
        *,
        worktree: Path,
        byte_budget: int | None = None,
    ) -> None:
        _reject_symlink_components(Path(root), role="artifact-root")
        self.root = Path(os.path.realpath(str(root)))
        self.worktree = Path(canonical_workspace_path(worktree))
        if self.root == self.worktree or _contains(self.worktree, self.root):
            raise EvidenceRootForbidden(
                "artifact root must be outside the worktree",
                operation="initialize-store",
                path_role="artifact-root",
            )
        self.workspace_id = workspace_id(worktree)
        self.workspace_dir = self.root / self.workspace_id
        self.byte_budget = byte_budget
        _private_directory(self.root, "artifact-root")
        _private_directory(self.workspace_dir, "workspace")

    def execution_request(self, session_id: str) -> ExecutionRequestClaim:
        validate_run_id(session_id)
        store_identity = hashlib.sha256(str(self.root).encode()).hexdigest()
        directory = (
            self.worktree / ".local" / "acceptance" / "execution-sessions"
            / store_identity / session_id
        )
        _reject_symlink_components(directory, role="execution-session")
        return ExecutionRequestClaim(directory)

    @classmethod
    def from_environment(
        cls,
        *,
        repo_root: Path,
        worktree: Path | None = None,
        platform: str | None = None,
        environment: Mapping[str, str] | None = None,
        home: Path | None = None,
        byte_budget: int | None = None,
    ) -> "EvidenceStore":
        root = resolve_artifact_root(
            repo_root=repo_root,
            platform=platform,
            environment=environment,
            home=home,
        )
        return cls(
            root,
            worktree=worktree or repo_root,
            byte_budget=byte_budget,
        )

    def acquire_gate_publish_lock(
        self,
        gate_id: str,
        *,
        shared: bool,
        timeout_seconds: float = 10.0,
    ) -> GatePublishLock:
        normalized_gate = _validate_gate_id(gate_id)
        if (
            isinstance(timeout_seconds, bool)
            or not isinstance(timeout_seconds, (int, float))
            or not 0 < timeout_seconds <= 60
        ):
            raise EvidenceManifestInvalid(
                "Gate publish lock timeout must be in (0, 60]"
            )
        path = self.workspace_dir / normalized_gate / ".publish.lock"
        lock = _FileLock(path)
        deadline = time.monotonic() + timeout_seconds
        while not lock.acquire(blocking=False, shared=shared):
            if time.monotonic() >= deadline:
                raise EvidenceConflict(
                    "Gate publish lock acquisition timed out",
                    operation="acquire-gate-publish-lock",
                    path_role="lock",
                )
            time.sleep(min(0.01, max(0.0, deadline - time.monotonic())))
        try:
            observed = os.fstat(lock.fileno())
            if not stat.S_ISREG(observed.st_mode):
                raise EvidenceManifestInvalid(
                    "Gate publish lock must be a regular file"
                )
            identity = finalization.GatePublishLockIdentity.create(
                workspace_id=self.workspace_id,
                gate_id=normalized_gate,
                device_id=str(observed.st_dev),
                inode=str(observed.st_ino),
            )
            return GatePublishLock(lock, identity, shared=shared)
        except BaseException:
            lock.release()
            raise

    def read_active_power_controller_trust(
        self,
        gate_id: str,
        *,
        publish_lock: GatePublishLock,
    ) -> tuple[
        finalization.PowerControllerTrustCurrent,
        finalization.ActivePowerControllerTrustGeneration,
        dict[str, Any],
    ]:
        normalized_gate = _validate_gate_id(gate_id)
        if (
            type(publish_lock) is not GatePublishLock
            or not publish_lock.held
            or not publish_lock.shared
            or publish_lock.identity.workspace_id != self.workspace_id
            or publish_lock.identity.gate_id != normalized_gate
        ):
            raise EvidenceConflict(
                "active controller trust requires the matching held shared lock",
                operation="read-controller-trust",
                path_role="lock",
            )
        trust_dir = (
            self.workspace_dir
            / normalized_gate
            / "finalizer-enforcement"
            / "controller-trust"
        )
        try:
            current = finalization.PowerControllerTrustCurrent.from_dict(
                self._read_contract_object(
                    trust_dir / "current.json",
                    path_role="controller-trust-current",
                )
            )
            generation_ref = current.generation_ref
            generation = finalization.ActivePowerControllerTrustGeneration.from_dict(
                self._read_contract_object(
                    trust_dir
                    / "generations"
                    / (
                        f"{generation_ref.trust_generation}-"
                        f"{generation_ref.trust_generation_digest}.json"
                    ),
                    path_role="controller-trust-generation",
                )
            )
            if generation.reference() != generation_ref:
                raise ValueError("current trust generation reference mismatch")
            anchor = self._read_contract_object(
                trust_dir / f"{generation.trust_anchor_digest}.json",
                path_role="controller-trust-anchor",
            )
            anchor_keys = {
                "artifactKind",
                "schemaVersion",
                "workspaceId",
                "gateId",
                "trustGeneration",
                "predecessorGenerationRef",
                "controllerIdentity",
                "controllerSignatureAlgorithm",
                "controllerPublicKeyHex",
                "controllerPublicKeySha256",
                "controllerRuntime",
                "controllerRuntimeLockBackend",
                "bootstrapCandidateDigest",
                "qualificationManifestDigest",
                "qualifiedBackendIdentityDigest",
                "ownerApprovalDocumentPath",
                "ownerApprovalDocumentSha256",
                "sourceCommit",
                "enrolledAt",
                "enrollmentAuthorization",
                "trustAnchorDigest",
            }
            if (
                set(anchor) != anchor_keys
                or anchor.get("artifactKind")
                != "acceptance-power-controller-trust-anchor"
                or type(anchor.get("schemaVersion")) is not int
                or anchor.get("schemaVersion") != 1
                or anchor.get("workspaceId") != self.workspace_id
                or anchor.get("gateId") != normalized_gate
                or anchor.get("trustGeneration") != generation.trust_generation
                or anchor.get("trustAnchorDigest")
                != generation.trust_anchor_digest
                or finalization.domain_separated_sha256(
                    "pt.acceptance.finalization.durability-power-controller-trust-anchor.v1",
                    {
                        key: value
                        for key, value in anchor.items()
                        if key != "trustAnchorDigest"
                    },
                )
                != generation.trust_anchor_digest
            ):
                raise ValueError("active controller trust anchor mismatch")
        except ValueError as error:
            raise EvidenceManifestInvalid(
                "active power-controller trust closure is invalid"
            ) from error
        return current, generation, anchor

    def write_claim_admission_record(
        self,
        gate_id: str,
        relative_path: str,
        value: Mapping[str, object],
        *,
        replace: bool = False,
    ) -> Path:
        normalized_gate = _validate_gate_id(gate_id)
        relative = _validate_relative_path(relative_path)
        if relative.parts[0] not in {
            "epochs",
            "jobs",
            "completions",
            "emissions",
            "pauses",
            "boot-boundaries",
        } and relative.as_posix() != "current-epoch.json":
            raise EvidencePathTraversal(
                "claim-admission record path is outside the closed namespace"
            )
        if not isinstance(value, Mapping):
            raise EvidenceManifestInvalid(
                "claim-admission record must be an object"
            )
        target = (
            self.workspace_dir
            / normalized_gate
            / "claim-admission"
            / relative
        )
        encoded = _canonical_contract_bytes(dict(value))
        if replace:
            _atomic_write(
                target,
                encoded,
                path_role="claim-admission-record",
            )
        else:
            _atomic_write_no_replace(
                target,
                encoded,
                path_role="claim-admission-record",
            )
        return target

    def read_claim_admission_record(
        self,
        gate_id: str,
        relative_path: str,
    ) -> dict[str, Any]:
        normalized_gate = _validate_gate_id(gate_id)
        relative = _validate_relative_path(relative_path)
        target = (
            self.workspace_dir
            / normalized_gate
            / "claim-admission"
            / relative
        )
        return self._read_contract_object(
            target,
            path_role="claim-admission-record",
        )

    def begin_run(
        self,
        gate_id: str,
        *,
        source: Mapping[str, Any],
        run_id: str | None = None,
    ) -> "RunHandle":
        normalized_gate = _validate_gate_id(gate_id)
        gate_dir = self.workspace_dir / normalized_gate
        _private_directory(gate_dir, "gate")
        for _ in range(16):
            candidate = validate_run_id(run_id) if run_id else new_run_id()
            run_dir = gate_dir / candidate
            try:
                run_dir.mkdir(mode=0o700)
            except FileExistsError:
                if run_id:
                    raise EvidenceConflict(
                        f"run already exists: {candidate}",
                        operation="allocate-run",
                        path_role="run",
                    )
                continue
            except OSError as error:
                raise _map_os_error(
                    error,
                    operation="allocate-run",
                    path_role="run",
                ) from error
            return RunHandle(
                store=self,
                gate_id=normalized_gate,
                run_id=candidate,
                run_dir=run_dir,
                source=dict(source),
            )
        raise EvidenceConflict(
            "could not allocate a collision-free run ID",
            operation="allocate-run",
            path_role="run",
        )

    def _read_contract_object(
        self,
        path: Path,
        *,
        path_role: str,
    ) -> dict[str, Any]:
        _ensure_no_symlink(self.root, path)
        try:
            encoded = path.read_bytes()
            value = json.loads(encoded.decode("utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise EvidenceManifestInvalid(
                f"{path_role} is unavailable or malformed"
            ) from error
        if type(value) is not dict:
            raise EvidenceManifestInvalid(f"{path_role} must be an object")
        return value

    def _contract_ref_bytes(
        self,
        reference: finalization.ArtifactRef,
    ) -> bytes:
        path = self.resolve(_store_artifact_ref(reference))
        try:
            return path.read_bytes()
        except OSError as error:
            raise _map_os_error(
                error,
                operation="read-finalization-artifact",
                path_role=reference.path,
            ) from error

    def _source_capture_bundle(
        self,
        record: finalization.FinalizerRequirementRecord,
        *,
        executable_only: bool,
    ) -> bytes:
        artifacts = {
            item.repo_relative_path: item
            for item in record.protected_source_artifacts
        }
        captured = tuple(
            item
            for item in record.captured_sources
            if not executable_only or item.executable_included
        )
        contents = tuple(
            self._contract_ref_bytes(
                artifacts[item.repo_relative_path].ref
            )
            for item in captured
        )
        if any(
            len(content) != item.byte_length
            or _sha256_bytes(content) != item.file_sha256
            for item, content in zip(captured, contents)
        ):
            raise EvidenceManifestInvalid(
                "protected source artifact content changed"
            )
        manifest = [
            {
                "repoRelativePath": item.repo_relative_path,
                "fileSha256": item.file_sha256,
                "byteLength": item.byte_length,
            }
            for item in captured
        ]
        return _length_prefixed_bundle(
            b"pt-finalizer-bundle-v1",
            manifest,
            contents,
        )

    def _runtime_capture_bundle(
        self,
        record: finalization.FinalizerRequirementRecord,
    ) -> bytes:
        contents = tuple(
            self._contract_ref_bytes(item.ref)
            for item in record.runtime_evidence_artifacts
        )
        if any(
            len(content) != item.byte_length
            or _sha256_bytes(content) != item.file_sha256
            for item, content in zip(
                record.runtime_evidence_artifacts,
                contents,
            )
        ):
            raise EvidenceManifestInvalid(
                "runtime evidence artifact content changed"
            )
        manifest = {
            "captureId": record.runtime_capture_id,
            "measurement": record.runtime_measurement.to_dict(),
            "files": [
                item.to_dict() for item in record.captured_runtime_files
            ],
        }
        return _length_prefixed_bundle(
            b"pt-finalizer-runtime-bundle-v1",
            manifest,
            contents,
        )

    def _validate_requirement_bundles(
        self,
        record: finalization.FinalizerRequirementRecord,
        *,
        executable: finalization.FinalizerExecutableArtifact | None = None,
    ) -> None:
        source_bundle = self._source_capture_bundle(
            record,
            executable_only=False,
        )
        if _sha256_bytes(source_bundle) != record.source_capture_bundle_digest:
            raise EvidenceManifestInvalid(
                "source capture bundle digest mismatch"
            )
        runtime_bundle = self._runtime_capture_bundle(record)
        if _sha256_bytes(runtime_bundle) != record.runtime_capture_bundle_digest:
            raise EvidenceManifestInvalid(
                "runtime capture bundle digest mismatch"
            )
        if executable is not None:
            executable_bundle = self._source_capture_bundle(
                record,
                executable_only=True,
            )
            if (
                _sha256_bytes(executable_bundle) != executable.bundle_digest
                or self._contract_ref_bytes(executable.ref)
                != executable_bundle
            ):
                raise EvidenceManifestInvalid(
                    "finalizer executable bundle differs from captured sources"
                )

    def _validate_active_enforcement(
        self,
        record: finalization.FinalizerRequirementRecord,
    ) -> None:
        gate_dir = self.workspace_dir / record.requirement.gate_id
        enforcement_dir = gate_dir / "finalizer-enforcement"
        pending_path = enforcement_dir / "activation-pending.json"
        activated_path = enforcement_dir / "activated.json"
        current_path = enforcement_dir / "current.json"
        if pending_path.exists():
            raise EvidenceConflict(
                "required-finalizer activation is pending",
                operation="allocate-required-run",
                path_role="activation-pending",
            )
        interlock = self._validated_finalizer_interlock(
            record.requirement.gate_id
        )
        if (
            interlock.workspace_id != self.workspace_id
            or interlock.gate_id != record.requirement.gate_id
            or interlock.required_finalizer_id
            != record.requirement.finalizer_id
        ):
            raise EvidenceManifestInvalid(
                "publication interlock identity mismatch"
            )
        try:
            activated = finalization.FinalizerEnforcementActivated.from_dict(
                self._read_contract_object(
                    activated_path,
                    path_role="enforcement-activated",
                )
            )
            current = finalization.FinalizerEnforcementCurrent.from_dict(
                self._read_contract_object(
                    current_path,
                    path_role="enforcement-current",
                )
            )
            generation = finalization.FinalizerEnforcementRecord.from_dict(
                self._read_contract_object(
                    enforcement_dir
                    / "generations"
                    / f"{current.generation}.json",
                    path_role="enforcement-generation",
                )
            )
        except ValueError as error:
            raise EvidenceManifestInvalid(
                "finalizer enforcement contract is invalid"
            ) from error
        expected_scope = (
            self.workspace_id,
            record.requirement.gate_id,
            record.requirement.finalizer_id,
        )
        if (
            (
                activated.workspace_id,
                activated.gate_id,
                activated.required_finalizer_id,
            )
            != expected_scope
            or (
                current.workspace_id,
                current.gate_id,
                current.required_finalizer_id,
            )
            != expected_scope
            or (
                generation.workspace_id,
                generation.gate_id,
                generation.required_finalizer_id,
            )
            != expected_scope
            or current.generation != record.enforcement_generation
            or generation.generation != record.enforcement_generation
            or current.enforcement_digest != record.enforcement_digest
            or generation.enforcement_digest != record.enforcement_digest
            or generation.requirement_digest != record.requirement_digest
            or generation.config_digest != record.config_digest
            or generation.source_digest != record.source_digest
            or generation.protected_baseline_digest
            != record.protected_baseline.digest()
        ):
            raise EvidenceConflict(
                "finalizer enforcement changed before run allocation",
                operation="allocate-required-run",
                path_role="finalizer-enforcement",
            )

    def begin_required_run(
        self,
        *,
        requirement_record: finalization.FinalizerRequirementRecord,
        preflight_token: finalization.FinalizerPreflightToken,
        source_capture: finalization.PreflightSourceCapture,
        runtime_capture: finalization.PreflightRuntimeCapture,
        supervisor_session: finalization.SupervisorSession,
        immutable_artifacts: Mapping[str, bytes],
    ) -> "RunHandle":
        if (
            type(requirement_record)
            is not finalization.FinalizerRequirementRecord
            or type(preflight_token) is not finalization.FinalizerPreflightToken
            or type(source_capture) is not finalization.PreflightSourceCapture
            or type(runtime_capture) is not finalization.PreflightRuntimeCapture
            or type(supervisor_session) is not finalization.SupervisorSession
        ):
            raise EvidenceManifestInvalid(
                "required run allocation requires concrete finalization contracts"
            )
        record = requirement_record
        gate_id = _validate_gate_id(record.requirement.gate_id)
        if record.workspace_id != self.workspace_id:
            raise EvidenceManifestInvalid(
                "required run workspace does not match store"
            )
        token_projection = (
            preflight_token.enforcement_generation,
            preflight_token.enforcement_digest,
            preflight_token.requirement_digest,
            preflight_token.config_digest,
            preflight_token.source_digest,
            preflight_token.supervisor_runtime_digest,
            preflight_token.preflight_runtime_digest,
            preflight_token.source_capture_id,
            preflight_token.source_capture_digest,
            preflight_token.runtime_capture_id,
            preflight_token.runtime_capture_digest,
            preflight_token.durability_profile_digest,
        )
        record_projection = (
            record.enforcement_generation,
            record.enforcement_digest,
            record.requirement_digest,
            record.config_digest,
            record.source_digest,
            record.finalizer_runtime.supervisor_runtime_digest,
            record.runtime_measurement.preflight_runtime_digest,
            record.source_capture_id,
            record.source_capture_digest,
            record.runtime_capture_id,
            record.runtime_capture_digest,
            record.durability_profile.durability_profile_digest,
        )
        if token_projection != record_projection:
            raise EvidenceConflict(
                "preflight token does not match requirement record",
                operation="allocate-required-run",
                path_role="preflight-token",
            )
        if (
            supervisor_session.supervisor_session_id
            != preflight_token.supervisor_session_id
            or supervisor_session.supervisor_runtime_digest
            != preflight_token.supervisor_runtime_digest
            or supervisor_session.state != "READY"
        ):
            raise EvidenceConflict(
                "preflight supervisor session is not live and READY",
                operation="allocate-required-run",
                path_role="supervisor-session",
            )
        if source_capture.consumed or runtime_capture.consumed:
            raise EvidenceConflict(
                "preflight capture was already consumed",
                operation="allocate-required-run",
                path_role="preflight-capture",
            )
        if (
            source_capture.capture_id != record.source_capture_id
            or source_capture.workspace_id != record.workspace_id
            or source_capture.source_commit != record.source_commit
            or source_capture.workspace_digest != record.workspace_digest
            or source_capture.canonical_worktree_hash
            != record.canonical_worktree_hash
            or source_capture.source_files != record.captured_sources
            or source_capture.source_capture_bundle_digest
            != record.source_capture_bundle_digest
            or source_capture.source_capture_digest
            != record.source_capture_digest
            or runtime_capture.capture_id != record.runtime_capture_id
            or runtime_capture.measurement != record.runtime_measurement
            or runtime_capture.files != record.captured_runtime_files
            or runtime_capture.runtime_capture_bundle_digest
            != record.runtime_capture_bundle_digest
            or runtime_capture.runtime_capture_digest
            != record.runtime_capture_digest
        ):
            raise EvidenceConflict(
                "live preflight capture does not match requirement record",
                operation="allocate-required-run",
                path_role="preflight-capture",
            )
        for claim in (
            source_capture.temporary_directory_claim,
            runtime_capture.temporary_directory_claim,
        ):
            owner = claim.owner_binding
            if (
                type(owner)
                is not finalization.TemporaryDirectoryOwnerBinding
                or owner.supervisor_session_id
                != preflight_token.supervisor_session_id
            ):
                raise EvidenceConflict(
                    "preflight capture belongs to another supervisor session",
                    operation="allocate-required-run",
                    path_role="preflight-capture",
                )
        referenced = {
            item.ref.path: item.ref
            for item in (
                *record.protected_source_artifacts,
                *record.runtime_evidence_artifacts,
            )
        }
        if set(immutable_artifacts) != set(referenced):
            raise EvidenceManifestInvalid(
                "immutable artifact bytes do not match requirement inventory"
            )
        for path, reference in referenced.items():
            value = immutable_artifacts[path]
            if type(value) is not bytes:
                raise EvidenceManifestInvalid(
                    "immutable artifact payload must be bytes"
                )
            if _sha256_bytes(value) != reference.sha256:
                raise EvidenceManifestInvalid(
                    f"immutable artifact hash mismatch: {path}"
                )
        run_ids = {reference.run_id for reference in referenced.values()}
        if len(run_ids) != 1:
            raise EvidenceManifestInvalid(
                "required run artifacts do not share one run ID"
            )
        run_id = validate_run_id(next(iter(run_ids)))
        gate_dir = self.workspace_dir / gate_id
        _private_directory(gate_dir, "gate")
        cleanup_lock = _FileLock(gate_dir / ".cleanup.lock")
        cleanup_lock.acquire(blocking=True)
        handle: RunHandle | None = None
        run_dir = gate_dir / run_id
        try:
            self._validate_active_enforcement(record)
            try:
                run_dir.mkdir(mode=0o700)
            except FileExistsError as error:
                raise EvidenceConflict(
                    f"run already exists: {run_id}",
                    operation="allocate-required-run",
                    path_role="run",
                ) from error
            except OSError as error:
                raise _map_os_error(
                    error,
                    operation="allocate-required-run",
                    path_role="run",
                ) from error
            handle = RunHandle(
                store=self,
                gate_id=gate_id,
                run_id=run_id,
                run_dir=run_dir,
                source={
                    "commit": record.source_commit,
                    "workspaceDigest": record.workspace_digest,
                    "canonicalWorktreeHash": record.canonical_worktree_hash,
                },
            )
            for path in sorted(immutable_artifacts):
                relative, target = handle._target(path)
                value = immutable_artifacts[path]
                _atomic_write_no_replace(
                    target,
                    value,
                    path_role=f"required-artifact:{relative}",
                )
                handle._bytes_written += len(value)
            self._validate_requirement_bundles(record)
            requirement_bytes = _canonical_contract_bytes(record.to_dict())
            _atomic_write_no_replace(
                run_dir / "finalization-requirement.json",
                requirement_bytes,
                path_role="finalization-requirement",
            )
            _fsync_directory(run_dir)
            _fsync_directory(gate_dir)
            if source_capture.consumed or runtime_capture.consumed:
                raise EvidenceConflict(
                    "preflight capture changed during required allocation",
                    operation="allocate-required-run",
                    path_role="preflight-capture",
                )
            source_capture.consumed = True
            runtime_capture.consumed = True
            handle._requirement_record = record
            handle._preflight_token = preflight_token
            handle._supervisor_session = supervisor_session
            handle.created_at = record.created_at
            return handle
        except BaseException:
            if handle is not None:
                handle._active_lock.release()
            if run_dir.exists():
                try:
                    shutil.rmtree(run_dir)
                    _fsync_directory(gate_dir)
                except OSError:
                    pass
            raise
        finally:
            cleanup_lock.release()

    def resolve(self, reference: ArtifactRef, *, verify_hash: bool = True) -> Path:
        if reference.workspace_id != self.workspace_id:
            raise EvidenceManifestInvalid("artifact workspace does not match store")
        run_dir = (
            self.workspace_dir
            / _validate_gate_id(reference.gate_id)
            / validate_run_id(reference.run_id)
        )
        relative = _validate_relative_path(reference.path)
        target = run_dir.joinpath(*relative.parts)
        if not _contains(run_dir, target):
            raise EvidencePathTraversal("artifact path escaped its run")
        _ensure_no_symlink(run_dir, target)
        if not target.is_file():
            raise EvidenceManifestInvalid(f"artifact is missing: {reference.path}")
        if verify_hash and _sha256_file(target) != reference.sha256:
            raise EvidenceManifestInvalid(f"artifact hash mismatch: {reference.path}")
        return target

    def read_json(self, reference: ArtifactRef) -> dict[str, Any]:
        try:
            value = json.loads(self.resolve(reference).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise EvidenceManifestInvalid(
                f"invalid JSON artifact: {reference.path}"
            ) from error
        if not isinstance(value, dict):
            raise EvidenceManifestInvalid("JSON artifact must be an object")
        return value

    def read_run_manifest(
        self,
        reference: ArtifactRef,
        *,
        manifest_sha256: str,
        expected_gate_id: str | None = None,
    ) -> dict[str, Any]:
        if reference.path != "manifest.json":
            raise EvidenceManifestInvalid(
                "run manifest reference must target manifest.json"
            )
        if not SHA256_PATTERN.fullmatch(manifest_sha256):
            raise EvidenceManifestInvalid("invalid manifest SHA-256")
        if reference.sha256 != manifest_sha256:
            raise EvidenceManifestInvalid(
                "explicit manifest SHA-256 does not match ArtifactRef"
            )
        if expected_gate_id is not None and reference.gate_id != expected_gate_id:
            raise EvidenceManifestInvalid("run manifest Gate mismatch")
        manifest = self.read_json(reference)
        if manifest.get("artifactKind") != "acceptance-run-manifest":
            raise EvidenceManifestInvalid("invalid run manifest kind")
        if manifest.get("state") != "DURABLE":
            raise EvidenceManifestInvalid("run manifest is not durable")
        if (
            manifest.get("workspaceId") != reference.workspace_id
            or manifest.get("gateId") != reference.gate_id
            or manifest.get("runId") != reference.run_id
        ):
            raise EvidenceManifestInvalid("run manifest identity mismatch")
        self.verify_run_inventory(manifest)
        return manifest

    def verify_run_inventory(self, manifest: Mapping[str, Any]) -> None:
        artifacts = manifest.get("artifacts")
        if not isinstance(artifacts, dict):
            raise EvidenceManifestInvalid("run artifact inventory must be an object")
        identity = (manifest.get("workspaceId"), manifest.get("gateId"), manifest.get("runId"))
        for role, value in artifacts.items():
            if not isinstance(role, str) or not role:
                raise EvidenceManifestInvalid("artifact role must be a non-empty string")
            reference = ArtifactRef.from_dict(value)
            if (reference.workspace_id, reference.gate_id, reference.run_id) != identity:
                raise EvidenceManifestInvalid("artifact inventory identity mismatch")
            self.resolve(reference)

    def publish_candidate_proof(
        self,
        *,
        candidate_manifest: ArtifactRef,
        proof_envelope: ArtifactRef,
    ) -> Path:
        if candidate_manifest.path != "manifest.json":
            raise EvidenceManifestInvalid(
                "candidate proof publication requires a manifest reference"
            )
        if (
            candidate_manifest.workspace_id != self.workspace_id
            or proof_envelope.workspace_id != self.workspace_id
        ):
            raise EvidenceManifestInvalid("candidate proof workspace mismatch")
        self.read_run_manifest(
            candidate_manifest,
            manifest_sha256=candidate_manifest.sha256,
        )
        self.resolve(proof_envelope)
        gate_dir = self.workspace_dir / _validate_gate_id(
            candidate_manifest.gate_id
        )
        proof_dir = gate_dir / ".candidate-proofs"
        _private_directory(proof_dir, "candidate-proof")
        target = proof_dir / f"{candidate_manifest.run_id}.json"
        payload = {
            "artifactKind": "acceptance-candidate-proof-pointer",
            "schemaVersion": 1,
            "workspaceId": self.workspace_id,
            "gateId": candidate_manifest.gate_id,
            "candidateRunId": candidate_manifest.run_id,
            "candidateManifest": candidate_manifest.to_dict(),
            "candidateManifestSha256": candidate_manifest.sha256,
            "proofEnvelope": proof_envelope.to_dict(),
            "proofEnvelopeSha256": proof_envelope.sha256,
        }
        encoded = (
            json.dumps(payload, indent=2, sort_keys=True) + "\n"
        ).encode("utf-8")
        lock = _FileLock(gate_dir / ".candidate-proof.lock")
        lock.acquire(blocking=True)
        try:
            if target.is_file():
                if target.read_bytes() != encoded:
                    raise EvidenceConflict(
                        "candidate already has a different proof envelope"
                    )
                return target
            _atomic_write(
                target,
                encoded,
                path_role="candidate-proof-pointer",
            )
            return target
        finally:
            lock.release()

    def _latest_pointer(
        self,
        gate_id: str,
        *,
        required: bool,
        runtime_cell: str | None = None,
    ) -> dict[str, Any] | None:
        normalized_gate = _validate_gate_id(gate_id)
        normalized_cell = (
            _validate_gate_id(runtime_cell)
            if runtime_cell is not None
            else None
        )
        gate_dir = self.workspace_dir / normalized_gate
        pointer_path = gate_dir / (
            f"latest.{normalized_cell}.json"
            if normalized_cell is not None
            else "latest.json"
        )
        _ensure_no_symlink(self.root, pointer_path)
        if not pointer_path.exists() and not required:
            return None
        try:
            pointer = json.loads(pointer_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise EvidenceManifestInvalid(
                f"latest pointer is unavailable for {gate_id}"
            ) from error
        if not isinstance(pointer, dict):
            raise EvidenceManifestInvalid("latest pointer must be an object")
        if pointer.get("artifactKind") != "acceptance-latest-pointer":
            raise EvidenceManifestInvalid("invalid latest pointer kind")
        if pointer.get("workspaceId") != self.workspace_id:
            raise EvidenceManifestInvalid("latest pointer workspace mismatch")
        if pointer.get("gateId") != normalized_gate:
            raise EvidenceManifestInvalid("latest pointer Gate mismatch")
        if (
            normalized_cell is not None
            and pointer.get("runtimeCell") != normalized_cell
        ):
            raise EvidenceManifestInvalid("latest pointer runtime cell mismatch")
        reference = ArtifactRef.from_dict(pointer.get("manifest", {}))
        if reference.gate_id != normalized_gate:
            raise EvidenceManifestInvalid("latest manifest Gate mismatch")
        if pointer.get("runId") != reference.run_id:
            raise EvidenceManifestInvalid("latest pointer run mismatch")
        if pointer.get("manifestSha256") != reference.sha256:
            raise EvidenceManifestInvalid("latest manifest hash is inconsistent")
        self.resolve(reference)
        if normalized_cell is not None:
            manifest = self.read_json(reference)
            result = manifest.get("result")
            if (
                not isinstance(result, dict)
                or result.get("runtimeCell") != normalized_cell
            ):
                raise EvidenceManifestInvalid(
                    "latest manifest runtime cell mismatch"
                )
        return pointer

    def latest(
        self,
        gate_id: str,
        *,
        runtime_cell: str | None = None,
    ) -> dict[str, Any]:
        pointer = self._latest_pointer(
            gate_id,
            required=True,
            runtime_cell=runtime_cell,
        )
        if pointer is None:
            raise EvidenceManifestInvalid(f"latest pointer is unavailable for {gate_id}")
        return self.read_json(ArtifactRef.from_dict(pointer["manifest"]))

    @staticmethod
    def _manifest_result_tuple(
        manifest: Mapping[str, Any],
    ) -> finalization.CanonicalResultTuple:
        result = manifest.get("result")
        if type(result) is not dict:
            raise EvidenceManifestInvalid(
                "manifest result must be an object"
            )
        try:
            return finalization.CanonicalResultTuple.from_dict(
                {
                    "status": result["status"],
                    "completionStatus": result["completionStatus"],
                    "proofStatus": result["proofStatus"],
                }
            )
        except (KeyError, ValueError) as error:
            raise EvidenceManifestInvalid(
                "manifest result tuple is invalid"
            ) from error

    def _validated_finalizer_interlock(
        self,
        gate_id: str,
    ) -> finalization.FinalizerPublicationInterlock:
        path = (
            self.workspace_dir
            / gate_id
            / "finalizer-enforcement"
            / "publication-interlock.json"
        )
        interlock = self._read_contract_object(
            path,
            path_role="publication-interlock",
        )
        required = {
            "artifactKind",
            "schemaVersion",
            "workspaceId",
            "gateId",
            "requiredFinalizerId",
            "installedAt",
            "installationSourceCommit",
            "proofAdmissionSourceDigest",
            "authorization",
            "interlockDigest",
        }
        if (
            set(interlock) != required
            or interlock.get("artifactKind")
            != "acceptance-finalizer-publication-interlock"
            or interlock.get("schemaVersion") != 1
            or interlock.get("workspaceId") != self.workspace_id
            or interlock.get("gateId") != gate_id
        ):
            raise EvidenceManifestInvalid(
                "publication interlock identity is invalid"
            )
        try:
            expected = finalization.domain_separated_sha256(
                "pt.acceptance.finalization.publication-interlock.v1",
                {
                    key: value
                    for key, value in interlock.items()
                    if key != "interlockDigest"
                },
            )
        except ValueError as error:
            raise EvidenceManifestInvalid(
                "publication interlock payload is invalid"
            ) from error
        if interlock.get("interlockDigest") != expected:
            raise EvidenceManifestInvalid(
                "publication interlock digest is invalid"
            )
        authorization = interlock.get("authorization")
        quiescence = (
            authorization.get("proofAdmissionQuiescence")
            if type(authorization) is dict
            else None
        )
        if type(quiescence) is not dict:
            raise EvidenceManifestInvalid(
                "publication interlock lacks proof-admission quiescence"
            )
        coordinator_epoch_id = quiescence.get("coordinatorEpochId")
        if type(coordinator_epoch_id) is not str:
            raise EvidenceManifestInvalid(
                "publication interlock epoch identity is invalid"
            )
        claim_dir = (
            self.workspace_dir / gate_id / "claim-admission"
        )
        try:
            epoch = finalization.ProofAdmissionEpochRecord.from_dict(
                self._read_contract_object(
                    claim_dir
                    / "epochs"
                    / f"{coordinator_epoch_id}.json",
                    path_role="proof-admission-epoch",
                )
            )
            current_epoch = (
                finalization.ProofAdmissionCurrentEpoch.from_dict(
                    self._read_contract_object(
                        claim_dir / "current-epoch.json",
                        path_role="proof-admission-current-epoch",
                    )
                )
            )
            pause = finalization.ProofAdmissionPauseRecord.from_dict(
                self._read_contract_object(
                    claim_dir
                    / "pauses"
                    / f"{coordinator_epoch_id}.json",
                    path_role="proof-admission-pause",
                )
            )
            jobs = tuple(
                finalization.ProofAdmissionJobRecord.from_dict(
                    self._read_contract_object(
                        path,
                        path_role="proof-admission-job",
                    )
                )
                for path in sorted(
                    (
                        claim_dir
                        / "jobs"
                        / coordinator_epoch_id
                    ).glob("*.json")
                )
            )
            jobs_by_sequence = {
                job.job_sequence: job for job in jobs
            }
            completions_list = []
            for path in sorted(
                (
                    claim_dir
                    / "completions"
                    / coordinator_epoch_id
                ).glob("*.json")
            ):
                raw = self._read_contract_object(
                    path,
                    path_role="proof-admission-completion",
                )
                sequence = raw.get("jobSequence")
                job = jobs_by_sequence.get(sequence)
                if job is None:
                    raise ValueError(
                        "completion has no matching job"
                    )
                completions_list.append(
                    finalization.ProofAdmissionJobCompletion.from_dict(
                        raw,
                        job=job,
                        epoch=epoch,
                        pause=pause,
                    )
                )
            completions = tuple(completions_list)
            completions_by_sequence = {
                item.job_sequence: item for item in completions
            }
            intents_list = []
            acknowledgements_list = []
            emissions_dir = (
                claim_dir / "emissions" / coordinator_epoch_id
            )
            if emissions_dir.is_dir():
                for directory in sorted(emissions_dir.iterdir()):
                    if not directory.is_dir() or directory.is_symlink():
                        raise ValueError(
                            "emission identity must be a real directory"
                        )
                    intent_path = directory / "intent.json"
                    acknowledgement_path = (
                        directory / "acknowledged.json"
                    )
                    if not intent_path.exists():
                        if acknowledgement_path.exists():
                            raise ValueError(
                                "acknowledgement lacks intent"
                            )
                        continue
                    raw_intent = self._read_contract_object(
                        intent_path,
                        path_role="proof-admission-emission-intent",
                    )
                    sequence = raw_intent.get("jobSequence")
                    job = jobs_by_sequence.get(sequence)
                    completion = completions_by_sequence.get(sequence)
                    if job is None or completion is None:
                        raise ValueError(
                            "emission intent lacks job completion"
                        )
                    intent = (
                        finalization.ProofAdmissionEmissionIntent.from_dict(
                            raw_intent,
                            job=job,
                            completion=completion,
                            epoch=epoch,
                        )
                    )
                    intents_list.append(intent)
                    if acknowledgement_path.exists():
                        acknowledgements_list.append(
                            finalization.ProofAdmissionEmissionAcknowledgement.from_dict(
                                self._read_contract_object(
                                    acknowledgement_path,
                                    path_role=(
                                        "proof-admission-emission-acknowledgement"
                                    ),
                                ),
                                intent=intent,
                            )
                        )
            references = {
                "epoch": epoch,
                "current_epoch": current_epoch,
                "pause": pause,
                "jobs": jobs,
                "completions": completions,
                "intents": tuple(intents_list),
                "acknowledgements": tuple(acknowledgements_list),
            }
            parsed = finalization.FinalizerPublicationInterlock.from_dict(
                interlock,
                **references,
            )
        except ValueError as error:
            raise EvidenceManifestInvalid(
                "publication interlock proof-admission closure is invalid"
            ) from error
        return parsed

    def _read_finalizer_requirement(
        self,
        reference: ArtifactRef,
    ) -> finalization.FinalizerRequirementRecord:
        candidate = (
            self.workspace_dir
            / reference.gate_id
            / reference.run_id
            / "finalization-requirement.json"
        )
        _ensure_no_symlink(self.root, candidate)
        if not candidate.is_file():
            raise EvidenceManifestInvalid(
                "finalization requirement record is missing"
            )
        path = self.resolve(
            ArtifactRef(
                workspace_id=reference.workspace_id,
                gate_id=reference.gate_id,
                run_id=reference.run_id,
                path="finalization-requirement.json",
                sha256=_sha256_file(candidate),
                media_type="application/json",
            )
        )
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            record = finalization.FinalizerRequirementRecord.from_dict(value)
        except (
            OSError,
            UnicodeDecodeError,
            json.JSONDecodeError,
            ValueError,
        ) as error:
            raise EvidenceManifestInvalid(
                "finalization requirement record is invalid"
            ) from error
        if _canonical_contract_bytes(record.to_dict()) != path.read_bytes():
            raise EvidenceManifestInvalid(
                "finalization requirement bytes are not canonical"
            )
        return record

    def _validate_completed_finalization_manifest(
        self,
        manifest: Mapping[str, Any],
        manifest_ref: ArtifactRef,
        requirement: finalization.FinalizerRequirementRecord,
        evidence_record: finalization.EvidenceFinalizationRecord,
    ) -> None:
        run_dir = (
            self.workspace_dir
            / manifest_ref.gate_id
            / manifest_ref.run_id
        )
        if (
            (
                run_dir.parent
                / "aborts"
                / manifest_ref.run_id
                / "authorized.json"
            ).exists()
            or (
                run_dir.parent
                / "aborted-runs"
                / manifest_ref.run_id
            ).exists()
        ):
            raise EvidenceManifestInvalid(
                "aborted or abort-authorized run is not authoritative"
            )
        try:
            seal_value = self._read_contract_object(
                run_dir / "sealed.json",
                path_role="finalization-seal",
            )
            marker = finalization.SealedEvidenceMarker.from_dict(seal_value)
        except ValueError as error:
            raise EvidenceManifestInvalid(
                "finalization seal is invalid"
            ) from error
        if (
            _canonical_contract_bytes(marker.to_dict())
            != (run_dir / "sealed.json").read_bytes()
        ):
            raise EvidenceManifestInvalid(
                "finalization seal bytes are not canonical"
            )
        context = marker.finalizer_context
        if (
            evidence_record.state
            is not finalization.EvidenceFinalizationState.COMPLETED
            or evidence_record.primary_result != marker.primary_result
            or evidence_record.primary_result_digest
            != marker.primary_result_digest
            or evidence_record.seal_digest != marker.seal_digest
            or evidence_record.enforcement_generation
            != requirement.enforcement_generation
            or evidence_record.enforcement_digest
            != requirement.enforcement_digest
            or evidence_record.requirement_digest
            != requirement.requirement_digest
            or evidence_record.config_digest != requirement.config_digest
            or evidence_record.source_digest != requirement.source_digest
            or context.requirement_digest != requirement.requirement_digest
            or context.config_digest != requirement.config_digest
            or context.finalizer_source_digest != requirement.source_digest
            or context.finalizer_runtime != requirement.finalizer_runtime
        ):
            raise EvidenceManifestInvalid(
                "manifest finalization identity is inconsistent"
            )
        for reference in (
            *(
                item.ref for item in requirement.protected_source_artifacts
            ),
            *(
                item.ref for item in requirement.runtime_evidence_artifacts
            ),
            context.finalizer_executable.ref,
            *(artifact.ref for artifact in marker.snapshot.artifacts),
        ):
            self.resolve(_store_artifact_ref(reference))
        self._validate_requirement_bundles(
            requirement,
            executable=context.finalizer_executable,
        )
        invocation_values = {
            "finalizer_id": context.finalizer_id,
            "finalizer_executable": context.finalizer_executable,
            "finalizer_source_digest": context.finalizer_source_digest,
            "finalizer_runtime": context.finalizer_runtime,
            "supervisor_session_id": context.supervisor_session_id,
            "supervisor_runtime_digest": context.supervisor_runtime_digest,
            "enforcement_generation": context.enforcement_generation,
            "enforcement_digest": context.enforcement_digest,
            "requirement_digest": context.requirement_digest,
            "config_digest": context.config_digest,
            "workspace_id": context.workspace_id,
            "gate_id": context.gate_id,
            "evidence_run_id": context.evidence_run_id,
            "provisioning_run_id": context.provisioning_run_id,
            "runtime_manifest_ref": context.runtime_manifest_ref,
            "source_commit": context.source_commit,
            "workspace_digest": context.workspace_digest,
            "canonical_worktree_hash": context.canonical_worktree_hash,
            "snapshot_digest": context.snapshot_digest,
            "required_role_identities": context.required_role_identities,
            "primary_status": context.primary_status,
            "primary_result_digest": context.primary_result_digest,
        }
        invocation = finalization.FinalizerInvocationIdentity.create(
            **invocation_values
        )
        finalizer_input = finalization.FinalizerInput.create(
            invocation=invocation,
            context=context,
            snapshot=marker.snapshot,
        )
        outcome = evidence_record.outcome
        projection = (
            outcome.child_outcome
            if type(outcome)
            is finalization.ChildGateEvidenceFinalization
            else outcome
        )
        if (
            projection is None
            or projection.finalizer_id != invocation.finalizer_id
            or projection.invocation_digest != invocation.invocation_digest
            or projection.finalizer_input_digest
            != finalizer_input.finalizer_input_digest
            or projection.snapshot_digest != invocation.snapshot_digest
            or projection.primary_result_digest
            != invocation.primary_result_digest
        ):
            raise EvidenceManifestInvalid(
                "historical finalizer outcome identity is invalid"
            )
        result = manifest.get("result")
        if type(result) is not dict:
            raise EvidenceManifestInvalid("manifest result is invalid")
        published_tuple = self._manifest_result_tuple(manifest)
        if published_tuple is not evidence_record.published_result_tuple():
            raise EvidenceManifestInvalid(
                "manifest result violates monotonic merge"
            )
        base_result = dict(result)
        base_result.pop("evidenceFinalization", None)
        base_result.update(marker.primary_result.result_tuple.to_dict())
        if (
            _canonical_contract_bytes(base_result)
            != _canonical_contract_bytes(
                marker.primary_result.document.json_value()
            )
        ):
            raise EvidenceManifestInvalid(
                "manifest result changed primary result content"
            )

    def _validate_pre_seal_finalization_manifest(
        self,
        manifest: Mapping[str, Any],
        manifest_ref: ArtifactRef,
        requirement: finalization.FinalizerRequirementRecord,
        evidence_record: finalization.EvidenceFinalizationRecord,
    ) -> None:
        run_dir = (
            self.workspace_dir
            / manifest_ref.gate_id
            / manifest_ref.run_id
        )
        if (run_dir / "sealed.json").exists():
            raise EvidenceManifestInvalid(
                "pre-seal finalization unexpectedly has a sealed marker"
            )
        if (
            evidence_record.state
            is not finalization.EvidenceFinalizationState.NOT_INVOKED_PRE_SEAL
            or evidence_record.enforcement_generation
            != requirement.enforcement_generation
            or evidence_record.enforcement_digest
            != requirement.enforcement_digest
            or evidence_record.requirement_digest
            != requirement.requirement_digest
            or evidence_record.config_digest != requirement.config_digest
            or evidence_record.source_digest != requirement.source_digest
            or evidence_record.primary_result is None
        ):
            raise EvidenceManifestInvalid(
                "pre-seal finalization record is inconsistent"
            )
        primary = evidence_record.primary_result
        if primary.source_trace.source_commit != requirement.source_commit:
            raise EvidenceManifestInvalid(
                "pre-seal primary source does not match requirement"
            )
        for reference in primary.source_trace.evidence_refs:
            self.resolve(_store_artifact_ref(reference))
        if (
            (
                run_dir.parent
                / "aborts"
                / manifest_ref.run_id
                / "authorized.json"
            ).exists()
            or (
                run_dir.parent
                / "aborted-runs"
                / manifest_ref.run_id
            ).exists()
        ):
            raise EvidenceManifestInvalid(
                "aborted or abort-authorized run is not authoritative"
            )
        result = manifest.get("result")
        if type(result) is not dict:
            raise EvidenceManifestInvalid("manifest result is invalid")
        if (
            self._manifest_result_tuple(manifest)
            is not evidence_record.published_result_tuple()
        ):
            raise EvidenceManifestInvalid(
                "pre-seal result violates monotonic merge"
            )
        base_result = dict(result)
        base_result.pop("evidenceFinalization", None)
        base_result.update(primary.result_tuple.to_dict())
        if _canonical_contract_bytes(base_result) != _canonical_contract_bytes(
            primary.document.json_value()
        ):
            raise EvidenceManifestInvalid(
                "pre-seal manifest changed primary result content"
            )

    def authoritative_latest(
        self,
        gate_id: str,
    ) -> finalization.AuthoritativeLatestResolution:
        normalized_gate = _validate_gate_id(gate_id)
        gate_dir = self.workspace_dir / normalized_gate
        enforcement_dir = gate_dir / "finalizer-enforcement"
        marker_paths = {
            "interlock": enforcement_dir / "publication-interlock.json",
            "pending": enforcement_dir / "activation-pending.json",
            "activated": enforcement_dir / "activated.json",
            "current": enforcement_dir / "current.json",
        }
        presence = {
            name: path.exists() for name, path in marker_paths.items()
        }
        if not any(presence.values()):
            pointer = self._latest_pointer(normalized_gate, required=True)
            if pointer is None:
                raise EvidenceManifestInvalid(
                    "legacy latest pointer is unavailable"
                )
            reference = ArtifactRef.from_dict(pointer["manifest"])
            manifest = self.read_run_manifest(
                reference,
                manifest_sha256=reference.sha256,
                expected_gate_id=normalized_gate,
            )
            return finalization.AuthoritativeLatestResolution.create(
                authority_mode=finalization.LatestAuthorityMode.LEGACY,
                workspace_id=self.workspace_id,
                gate_id=normalized_gate,
                interlock_digest=None,
                generation=None,
                enforcement_digest=None,
                manifest_ref=_contract_artifact_ref(reference),
                result_tuple=self._manifest_result_tuple(manifest),
            )
        if (
            not presence["interlock"]
            or presence["pending"]
            or not presence["activated"]
            or not presence["current"]
        ):
            raise EvidenceManifestInvalid(
                "finalizer enforcement markers are incomplete"
            )
        interlock = self._validated_finalizer_interlock(normalized_gate)
        try:
            activated = finalization.FinalizerEnforcementActivated.from_dict(
                self._read_contract_object(
                    marker_paths["activated"],
                    path_role="enforcement-activated",
                )
            )
            current = finalization.FinalizerEnforcementCurrent.from_dict(
                self._read_contract_object(
                    marker_paths["current"],
                    path_role="enforcement-current",
                )
            )
            generation = finalization.FinalizerEnforcementRecord.from_dict(
                self._read_contract_object(
                    enforcement_dir
                    / "generations"
                    / f"{current.generation}.json",
                    path_role="enforcement-generation",
                )
            )
        except ValueError as error:
            raise EvidenceManifestInvalid(
                "finalizer enforcement history is invalid"
            ) from error
        if (
            activated.workspace_id != self.workspace_id
            or activated.gate_id != normalized_gate
            or current.workspace_id != self.workspace_id
            or current.gate_id != normalized_gate
            or generation.workspace_id != self.workspace_id
            or generation.gate_id != normalized_gate
            or current.required_finalizer_id
            != interlock.required_finalizer_id
            or generation.required_finalizer_id
            != current.required_finalizer_id
            or current.generation != generation.generation
            or current.enforcement_digest != generation.enforcement_digest
        ):
            raise EvidenceManifestInvalid(
                "finalizer enforcement selector is inconsistent"
            )
        latest_path = (
            enforcement_dir / "latest" / f"{current.generation}.json"
        )
        try:
            pointer = finalization.LatestPointer.from_dict(
                self._read_contract_object(
                    latest_path,
                    path_role="finalizer-generation-latest",
                )
            )
        except ValueError as error:
            raise EvidenceManifestInvalid(
                "generation latest pointer is invalid"
            ) from error
        reference = _store_artifact_ref(pointer.manifest)
        manifest = self.read_run_manifest(
            reference,
            manifest_sha256=pointer.manifest_sha256,
            expected_gate_id=normalized_gate,
        )
        requirement = self._read_finalizer_requirement(reference)
        result = manifest.get("result")
        if type(result) is not dict:
            raise EvidenceManifestInvalid("manifest result is invalid")
        try:
            evidence_record = (
                finalization.EvidenceFinalizationRecord.from_dict(
                    result["evidenceFinalization"]
                )
            )
        except (KeyError, ValueError) as error:
            raise EvidenceManifestInvalid(
                "manifest finalization record is invalid"
            ) from error
        if (
            requirement.enforcement_generation != current.generation
            or requirement.enforcement_digest
            != current.enforcement_digest
            or requirement.requirement_digest
            != generation.requirement_digest
            or requirement.config_digest != generation.config_digest
            or requirement.source_digest != generation.source_digest
        ):
            raise EvidenceManifestInvalid(
                "requirement record does not match active generation"
            )
        if (
            evidence_record.state
            is finalization.EvidenceFinalizationState.COMPLETED
        ):
            self._validate_completed_finalization_manifest(
                manifest,
                reference,
                requirement,
                evidence_record,
            )
        elif (
            evidence_record.state
            is finalization.EvidenceFinalizationState.NOT_INVOKED_PRE_SEAL
        ):
            self._validate_pre_seal_finalization_manifest(
                manifest,
                reference,
                requirement,
                evidence_record,
            )
        else:
            raise EvidenceManifestInvalid(
                "enforced latest forbids NOT_REQUIRED finalization"
            )
        return finalization.AuthoritativeLatestResolution.create(
            authority_mode=finalization.LatestAuthorityMode.FINALIZER_ENFORCED,
            workspace_id=self.workspace_id,
            gate_id=normalized_gate,
            interlock_digest=interlock.interlock_digest,
            generation=current.generation,
            enforcement_digest=current.enforcement_digest,
            manifest_ref=pointer.manifest,
            result_tuple=self._manifest_result_tuple(manifest),
        )

    def latest_artifact_ref(
        self,
        gate_id: str,
        role: str,
        *,
        runtime_cell: str | None = None,
    ) -> ArtifactRef:
        manifest = self.latest(gate_id, runtime_cell=runtime_cell)
        artifacts = manifest.get("artifacts")
        if not isinstance(artifacts, dict) or role not in artifacts:
            raise EvidenceManifestInvalid(
                f"latest {gate_id!r} run has no artifact role {role!r}"
            )
        return ArtifactRef.from_dict(artifacts[role])

    def delete_run(self, gate_id: str, run_id: str) -> None:
        normalized_gate = _validate_gate_id(gate_id)
        normalized_run = validate_run_id(run_id)
        gate_dir = self.workspace_dir / normalized_gate
        run_dir = gate_dir / normalized_run
        if not run_dir.is_dir():
            return
        cleanup_lock = _FileLock(gate_dir / ".cleanup.lock")
        cleanup_lock.acquire(blocking=True)
        try:
            publish_lock = _FileLock(gate_dir / ".publish.lock")
            publish_lock.acquire(blocking=True)
            try:
                pointers = [
                    self._latest_pointer(normalized_gate, required=False)
                ]
                for pointer_path in sorted(gate_dir.glob("latest.*.json")):
                    name = pointer_path.name
                    runtime_cell = name[len("latest.") : -len(".json")]
                    pointers.append(
                        self._latest_pointer(
                            normalized_gate,
                            required=True,
                            runtime_cell=runtime_cell,
                        )
                    )
                generation_latest = (
                    gate_dir / "finalizer-enforcement" / "latest"
                )
                if generation_latest.is_dir():
                    for pointer_path in sorted(
                        generation_latest.glob("*.json")
                    ):
                        pointer = self._read_contract_object(
                            pointer_path,
                            path_role="finalizer-generation-latest",
                        )
                        try:
                            pointers.append(
                                finalization.LatestPointer.from_dict(
                                    pointer
                                ).to_dict()
                            )
                        except ValueError as error:
                            raise EvidenceManifestInvalid(
                                "generation latest pointer is invalid"
                            ) from error
                if any(
                    pointer is not None
                    and pointer.get("runId") == normalized_run
                    for pointer in pointers
                ):
                    raise EvidenceConflict(
                        "cleanup cannot delete a latest run"
                    )
            finally:
                publish_lock.release()
            lock = _FileLock(run_dir / ".active.lock")
            if not lock.acquire(blocking=False):
                raise EvidenceRunActive(f"run is active: {normalized_run}")
            lock.release()
            if (
                (run_dir / "sealed.json").exists()
                or (
                    gate_dir
                    / "aborts"
                    / normalized_run
                    / "authorized.json"
                ).exists()
            ):
                raise EvidenceConflict(
                    "sealed or abort-authorized run requires explicit abort"
                )
            try:
                shutil.rmtree(run_dir)
                _fsync_directory(gate_dir)
            except OSError as error:
                raise _map_os_error(
                    error,
                    operation="cleanup-run",
                    path_role="run",
                ) from error
        finally:
            cleanup_lock.release()


class RunHandle:
    def __init__(
        self,
        *,
        store: EvidenceStore,
        gate_id: str,
        run_id: str,
        run_dir: Path,
        source: dict[str, Any],
    ) -> None:
        self.store = store
        self.gate_id = gate_id
        self.run_id = run_id
        self.run_dir = run_dir
        self.source = redact_value(source)
        self.created_at = _utc_now()
        self.state = "ALLOCATED"
        self._artifacts: dict[str, ArtifactRef] = {}
        self._bytes_written = 0
        self._mutex = threading.Lock()
        self._active_lock = _FileLock(run_dir / ".active.lock")
        if not self._active_lock.acquire(blocking=False):
            raise EvidenceRunActive(f"new run lock is unexpectedly held: {run_id}")
        self.state = "ACTIVE"
        self._manifest: dict[str, Any] | None = None
        self._manifest_ref: ArtifactRef | None = None
        self._redacted_artifacts: set[str] = set()
        self._redaction_values: tuple[str, ...] = ()
        self._finalization_lock = _FileLock(run_dir / ".finalization.lock")
        self._requirement_record: (
            finalization.FinalizerRequirementRecord | None
        ) = None
        self._preflight_token: finalization.FinalizerPreflightToken | None = None
        self._seal_marker: finalization.SealedEvidenceMarker | None = None
        self._finalization_artifacts: dict[
            tuple[str, str | None],
            finalization.SnapshotArtifact,
        ] = {}
        self._reservation: (
            finalization.FinalizationInvocationReservation | None
        ) = None
        self._finalizer_input: finalization.FinalizerInput | None = None
        self._supervisor_session: finalization.SupervisorSession | None = None
        self._pre_seal_manifest_bytes: bytes | None = None
        self._pre_seal_pointer_bytes: bytes | None = None
        self._pre_seal_primary_digest: str | None = None

    @property
    def manifest_ref(self) -> ArtifactRef:
        if self._manifest_ref is None:
            raise EvidenceManifestInvalid("run manifest is not durable")
        return self._manifest_ref

    @property
    def redacted_artifacts(self) -> tuple[str, ...]:
        return tuple(sorted(self._redacted_artifacts))

    def configure_redaction(self, secret_values: tuple[str, ...]) -> None:
        with self._mutex:
            if self.state != "ACTIVE":
                raise EvidenceConflict(
                    "redaction can only be configured for an active run"
                )
            self._redaction_values = tuple(secret_values)

    def discard(self) -> None:
        with self._mutex:
            if self.state != "ACTIVE":
                raise EvidenceConflict("only an active run can be discarded")
            self._active_lock.release()
            shutil.rmtree(self.run_dir)
            _fsync_directory(self.run_dir.parent)
            self.state = "CLOSED"

    def subprocess_environment(
        self,
        base: Mapping[str, str] | None = None,
    ) -> dict[str, str]:
        environment = dict(os.environ if base is None else base)
        environment.update(
            {
                ARTIFACT_ROOT_ENV: str(self.store.root),
                RUN_WORKSPACE_ENV: self.store.workspace_id,
                RUN_GATE_ENV: self.gate_id,
                RUN_ID_ENV: self.run_id,
                REDACTION_VALUES_ENV: json.dumps(self._redaction_values),
            }
        )
        return environment

    def collect_existing_artifacts(self) -> dict[str, ArtifactRef]:
        with self._mutex:
            if self.state != "ACTIVE":
                raise EvidenceConflict("artifacts can only be collected from an active run")
            role_dir = self.run_dir / ".artifact-roles"
            if role_dir.exists():
                if role_dir.is_symlink() or not role_dir.is_dir():
                    raise EvidenceSymlinkRejected(
                        "artifact role registry must be a real directory"
                    )
                for metadata_path in sorted(role_dir.glob("*.json")):
                    try:
                        metadata = json.loads(
                            metadata_path.read_text(encoding="utf-8")
                        )
                    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
                        raise EvidenceManifestInvalid(
                            "artifact role metadata is malformed"
                        ) from error
                    if not isinstance(metadata, Mapping):
                        raise EvidenceManifestInvalid(
                            "artifact role metadata must be an object"
                        )
                    role = metadata.get("role")
                    if not isinstance(role, str) or not role:
                        raise EvidenceManifestInvalid(
                            "artifact role metadata is missing its role"
                        )
                    reference = ArtifactRef.from_dict(metadata.get("artifact"))
                    if (
                        reference.workspace_id != self.store.workspace_id
                        or reference.gate_id != self.gate_id
                        or reference.run_id != self.run_id
                    ):
                        raise EvidenceManifestInvalid(
                            "artifact role metadata identity mismatch"
                        )
                    target = self.store.resolve(reference)
                    if (
                        not target.is_file()
                        or _sha256_file(target) != reference.sha256
                    ):
                        raise EvidenceManifestInvalid(
                            f"artifact role metadata hash mismatch: {role}"
                        )
                    existing = self._artifacts.get(role)
                    if existing is not None and existing != reference:
                        raise EvidenceConflict(
                            f"artifact role already exists: {role}"
                        )
                    self._artifacts[role] = reference
            for path in sorted(self.run_dir.rglob("*")):
                if (
                    not path.is_file()
                    or any(
                        part.startswith(".")
                        for part in path.relative_to(self.run_dir).parts
                    )
                ):
                    continue
                relative = path.relative_to(self.run_dir).as_posix()
                if relative == "manifest.json":
                    continue
                _ensure_no_symlink(self.run_dir, path)
                reference = ArtifactRef(
                    workspace_id=self.store.workspace_id,
                    gate_id=self.gate_id,
                    run_id=self.run_id,
                    path=relative,
                    sha256=_sha256_file(path),
                    media_type=_media_type(path),
                )
                registered = next(
                    (
                        current
                        for current in self._artifacts.values()
                        if current.path == relative
                    ),
                    None,
                )
                if registered is not None:
                    if registered.sha256 != reference.sha256:
                        raise EvidenceConflict(
                            f"artifact changed after registration: {relative}"
                        )
                    continue
                existing = self._artifacts.get(relative)
                if existing is not None and existing != reference:
                    raise EvidenceConflict(
                        f"collected artifact changed after registration: {relative}"
                    )
                self._artifacts[relative] = reference
            return dict(self._artifacts)

    def _target(self, relative_path: str) -> tuple[str, Path]:
        relative = _validate_relative_path(relative_path)
        target = self.run_dir.joinpath(*relative.parts)
        if not _contains(self.run_dir, target):
            raise EvidencePathTraversal("artifact path escaped its run")
        _ensure_no_symlink(self.run_dir, target)
        _private_directory(target.parent, "artifact-parent")
        return relative.as_posix(), target

    def write_bytes(
        self,
        relative_path: str,
        value: bytes,
        *,
        media_type: str = "application/octet-stream",
        role: str | None = None,
    ) -> ArtifactRef:
        return self._write_artifact(relative_path, value, media_type=media_type, role=role)

    def _write_artifact(
        self,
        relative_path: str,
        value: bytes | _JsonArtifact,
        *,
        media_type: str,
        role: str | None,
    ) -> ArtifactRef:
        with self._mutex:
            if self.state != "ACTIVE":
                raise EvidenceConflict("artifacts can only be written to an active run")
            _acquire_bounded(
                self._finalization_lock,
                timeout_seconds=60,
                operation="write-artifact",
            )
            try:
                if (self.run_dir / "sealed.json").exists():
                    raise EvidenceConflict(
                        "artifacts are sealed for finalization"
                    )
                normalized, target = self._target(relative_path)
                artifact_role = role or normalized
                _public_metadata(artifact_role, self._redaction_values)
                if (
                    redact_text_with_values(normalized, self._redaction_values)
                    != normalized
                ):
                    raise EvidenceManifestInvalid(
                        "Acceptance artifact path contains a resolved credential"
                    )
                value, redacted = (
                    value.encode(self._redaction_values) if type(value) is _JsonArtifact
                    else redact_artifact_bytes(value, self._redaction_values)
                )
                if redacted:
                    self._redacted_artifacts.add(normalized)
                digest = _sha256_bytes(value)
                if target.exists():
                    if target.is_symlink():
                        raise EvidenceSymlinkRejected(f"symlink artifact is forbidden: {normalized}")
                    if _sha256_file(target) != digest:
                        raise EvidenceConflict(f"artifact path already has different bytes: {normalized}")
                else:
                    projected = self._bytes_written + len(value)
                    if self.store.byte_budget is not None and projected > self.store.byte_budget:
                        raise EvidenceQuotaExceeded(
                            "run byte budget exceeded",
                            operation="write-artifact",
                            path_role=role or normalized,
                        )
                    _atomic_write(target, value, path_role=role or normalized)
                    self._bytes_written = projected
                reference = ArtifactRef(
                    workspace_id=self.store.workspace_id,
                    gate_id=self.gate_id,
                    run_id=self.run_id,
                    path=normalized,
                    sha256=digest,
                    media_type=media_type,
                )
                existing = self._artifacts.get(artifact_role)
                if existing is not None and existing != reference:
                    raise EvidenceConflict(f"artifact role already exists: {artifact_role}")
                self._artifacts[artifact_role] = reference
                return reference
            finally:
                self._finalization_lock.release()

    def write_json(
        self,
        relative_path: str,
        value: Mapping[str, Any],
        *,
        role: str | None = None,
        redact: bool = True,
    ) -> ArtifactRef:
        return self._write_artifact(
            relative_path,
            _JsonArtifact(value),
            media_type="application/json",
            role=role,
        )

    def _public_inventory(self, artifacts: Mapping[str, Any]) -> dict[str, Any]:
        values = {}
        for role, reference in artifacts.items():
            if type(reference) is finalization.ArtifactRef:
                reference = _store_artifact_ref(reference)
            if type(reference) is not ArtifactRef:
                raise EvidenceManifestInvalid("public inventory requires actual ArtifactRef values")
            values[role] = reference.to_dict()
        values = _public_metadata(values, self._redaction_values)
        self.store.verify_run_inventory({
            "workspaceId": self.store.workspace_id, "gateId": self.gate_id,
            "runId": self.run_id, "artifacts": values,
        })
        return values

    def register_finalization_artifact(
        self,
        artifact: finalization.SnapshotArtifact,
    ) -> None:
        with self._mutex:
            if self.state != "ACTIVE" or self._requirement_record is None:
                raise EvidenceConflict(
                    "finalization artifact registration requires an active required run"
                )
            if type(artifact) is not finalization.SnapshotArtifact:
                raise EvidenceManifestInvalid(
                    "finalization artifact must use SnapshotArtifact"
                )
            reference = artifact.ref
            if (
                reference.workspace_id,
                reference.gate_id,
                reference.run_id,
            ) != (
                self.store.workspace_id,
                self.gate_id,
                self.run_id,
            ):
                raise EvidenceManifestInvalid(
                    "finalization artifact identity does not match run"
                )
            _acquire_bounded(
                self._finalization_lock,
                timeout_seconds=60,
                operation="register-finalization-artifact",
            )
            try:
                if (self.run_dir / "sealed.json").exists():
                    raise EvidenceConflict(
                        "artifact roles are sealed for finalization"
                    )
                self.store.resolve(_store_artifact_ref(reference))
                identity = artifact.identity
                existing = self._finalization_artifacts.get(identity)
                if existing is not None:
                    if existing != artifact:
                        raise EvidenceConflict(
                            "finalization artifact identity already has different content"
                        )
                    return
                role_dir = self.run_dir / ".artifact-role-instances"
                metadata_path = role_dir / (
                    _sha256_bytes(
                        _canonical_contract_bytes(
                            {
                                "roleName": identity[0],
                                "discriminator": identity[1],
                            }
                        )
                    )
                    + ".json"
                )
                _atomic_write_no_replace(
                    metadata_path,
                    _canonical_contract_bytes(artifact.to_dict()),
                    path_role="finalization-artifact-role",
                )
                self._finalization_artifacts[identity] = artifact
            finally:
                self._finalization_lock.release()

    def _validate_required_control_files(self) -> None:
        record = self._requirement_record
        if record is None:
            raise EvidenceConflict("run has no finalization requirement")
        requirement_path = self.run_dir / "finalization-requirement.json"
        expected = _canonical_contract_bytes(record.to_dict())
        if (
            requirement_path.is_symlink()
            or not requirement_path.is_file()
            or requirement_path.read_bytes() != expected
        ):
            raise EvidenceManifestInvalid(
                "durable finalization requirement changed"
            )
        for reference in (
            *(
                item.ref for item in record.protected_source_artifacts
            ),
            *(
                item.ref for item in record.runtime_evidence_artifacts
            ),
        ):
            self.store.resolve(_store_artifact_ref(reference))

    def _validate_seal_candidate(
        self,
        marker: finalization.SealedEvidenceMarker,
    ) -> None:
        record = self._requirement_record
        token = self._preflight_token
        if record is None or token is None:
            raise EvidenceConflict("run has no required-finalizer allocation")
        if type(marker) is not finalization.SealedEvidenceMarker:
            raise EvidenceManifestInvalid(
                "sealed marker must use SealedEvidenceMarker"
            )
        snapshot = marker.snapshot
        context = marker.finalizer_context
        if (
            snapshot.workspace_id,
            snapshot.gate_id,
            snapshot.evidence_run_id,
            snapshot.source_commit,
            snapshot.workspace_digest,
            snapshot.canonical_worktree_hash,
        ) != (
            self.store.workspace_id,
            self.gate_id,
            self.run_id,
            record.source_commit,
            record.workspace_digest,
            record.canonical_worktree_hash,
        ):
            raise EvidenceManifestInvalid(
                "sealed snapshot identity does not match required run"
            )
        if (
            context.finalizer_id != record.requirement.finalizer_id
            or context.enforcement_generation != record.enforcement_generation
            or context.enforcement_digest != record.enforcement_digest
            or context.requirement_digest != record.requirement_digest
            or context.config_digest != record.config_digest
            or context.finalizer_source_digest != record.source_digest
            or context.finalizer_runtime != record.finalizer_runtime
            or context.supervisor_session_id != token.supervisor_session_id
            or context.supervisor_runtime_digest
            != token.supervisor_runtime_digest
        ):
            raise EvidenceManifestInvalid(
                "sealed finalizer context does not match requirement"
            )
        executable_files = tuple(
            (item.repo_relative_path, item.file_sha256)
            for item in record.captured_sources
            if item.executable_included
        )
        if (
            context.finalizer_executable.files != executable_files
            or context.finalizer_executable.source_digest
            != record.source_digest
            or context.finalizer_executable.core_bootstrap_source_digest
            != record.bootstrap_baseline.core_bootstrap_source_digest
            or context.finalizer_executable.entrypoint
            != record.registry_entry.entrypoint
        ):
            raise EvidenceManifestInvalid(
                "sealed executable does not match captured sources"
            )
        self.store.resolve(
            _store_artifact_ref(context.finalizer_executable.ref)
        )
        self.store._validate_requirement_bundles(
            record,
            executable=context.finalizer_executable,
        )
        registered = tuple(
            self._finalization_artifacts[key]
            for key in sorted(
                self._finalization_artifacts,
                key=lambda item: (
                    item[0].encode("utf-8"),
                    (b"\x00" if item[1] is None else b"\x01" + item[1].encode("utf-8")),
                ),
            )
        )
        if snapshot.artifacts != registered:
            raise EvidenceManifestInvalid(
                "sealed snapshot differs from registered role instances"
            )
        required_role_identities = tuple(
            artifact.identity
            for artifact in registered
            if artifact.role_name in record.registry_entry.evidence_role_names
        )
        if (
            {identity[0] for identity in required_role_identities}
            != set(record.registry_entry.evidence_role_names)
            or context.required_role_identities
            != required_role_identities
        ):
            raise EvidenceManifestInvalid(
                "required role identities do not match registry projection"
            )
        for artifact in registered:
            self.store.resolve(_store_artifact_ref(artifact.ref))
        if snapshot.runtime_manifest_ref not in tuple(
            artifact.ref for artifact in registered
        ):
            raise EvidenceManifestInvalid(
                "runtime manifest is absent from sealed artifact inventory"
            )
        expected_paths = {
            "finalization-requirement.json",
            context.finalizer_executable.ref.path,
            *(
                item.ref.path for item in record.protected_source_artifacts
            ),
            *(
                item.ref.path for item in record.runtime_evidence_artifacts
            ),
            *(artifact.ref.path for artifact in registered),
        }
        actual_paths = {
            path.relative_to(self.run_dir).as_posix()
            for path in self.run_dir.rglob("*")
            if path.is_file()
            and not any(
                part.startswith(".")
                for part in path.relative_to(self.run_dir).parts
            )
            and path.relative_to(self.run_dir).as_posix()
            not in {"sealed.json", "manifest.json"}
        }
        if actual_paths != expected_paths:
            raise EvidenceManifestInvalid(
                "run file inventory changed before seal; "
                f"missing={sorted(expected_paths - actual_paths)}, "
                f"unexpected={sorted(actual_paths - expected_paths)}"
            )

    def seal_for_finalization(
        self,
        marker: finalization.SealedEvidenceMarker,
    ) -> None:
        with self._mutex:
            if self.state != "ACTIVE":
                raise EvidenceConflict(
                    "finalization seal requires one active run"
                )
            _acquire_bounded(
                self._finalization_lock,
                timeout_seconds=60,
                operation="seal-finalization",
            )
            try:
                if (self.run_dir / "sealed.json").exists():
                    raise EvidenceConflict("run is already sealed")
                self._validate_required_control_files()
                self._validate_seal_candidate(marker)
                _atomic_write_no_replace(
                    self.run_dir / "sealed.json",
                    _canonical_contract_bytes(marker.to_dict()),
                    path_role="finalization-seal",
                )
                self._seal_marker = marker
                self._reservation = (
                    finalization.FinalizationReadyReservation()
                )
                self.state = "ARTIFACTS_SEALED"
            finally:
                self._finalization_lock.release()

    def start_finalizer_invocation(
        self,
        finalizer_input: finalization.FinalizerInput,
    ) -> None:
        with self._mutex:
            if (
                self.state != "ARTIFACTS_SEALED"
                or type(self._reservation)
                is not finalization.FinalizationReadyReservation
                or self._seal_marker is None
            ):
                raise EvidenceConflict(
                    "finalizer invocation is not available"
                )
            if (
                type(finalizer_input) is not finalization.FinalizerInput
                or finalizer_input.context
                != self._seal_marker.finalizer_context
                or finalizer_input.snapshot != self._seal_marker.snapshot
            ):
                raise EvidenceManifestInvalid(
                    "finalizer input does not match sealed marker"
                )
            self._reservation = finalization.start_finalizer_invocation(
                self._reservation,
                invocation_digest=(
                    finalizer_input.invocation.invocation_digest
                ),
            )
            self._finalizer_input = finalizer_input
            self.state = "FINALIZER_RUNNING"

    def cache_finalizer_outcome(
        self,
        outcome: finalization.GateEvidenceFinalization,
        *,
        supervisor_session: finalization.SupervisorSession,
    ) -> None:
        with self._mutex:
            if (
                self.state != "FINALIZER_RUNNING"
                or type(self._reservation)
                is not finalization.FinalizationInvocationStartedReservation
                or self._finalizer_input is None
            ):
                raise EvidenceConflict(
                    "finalizer outcome has no active invocation"
                )
            token = self._preflight_token
            if (
                type(supervisor_session)
                is not finalization.SupervisorSession
                or supervisor_session is not self._supervisor_session
                or token is None
                or supervisor_session.supervisor_session_id
                != token.supervisor_session_id
                or supervisor_session.supervisor_runtime_digest
                != token.supervisor_runtime_digest
                or supervisor_session.state != "CLOSED"
            ):
                raise EvidenceConflict(
                    "supervisor must be closed before outcome caching"
                )
            invocation = self._finalizer_input.invocation
            if type(outcome) is finalization.ChildGateEvidenceFinalization:
                projection = outcome.child_outcome
                if (
                    projection.status
                    is finalization.FinalizerOutcomeStatus.VALIDATED
                    and projection.validated_role_instances
                    != invocation.required_role_identities
                ):
                    raise EvidenceManifestInvalid(
                        "validated role instances do not match invocation"
                    )
            elif type(outcome) is finalization.CoreGateEvidenceFinalization:
                projection = outcome
            else:
                raise EvidenceManifestInvalid(
                    "outcome must be GateEvidenceFinalization"
                )
            if (
                projection.finalizer_id != invocation.finalizer_id
                or projection.invocation_digest
                != invocation.invocation_digest
                or projection.finalizer_input_digest
                != self._finalizer_input.finalizer_input_digest
                or projection.snapshot_digest != invocation.snapshot_digest
                or projection.primary_result_digest
                != invocation.primary_result_digest
            ):
                raise EvidenceManifestInvalid(
                    "finalizer outcome identity does not match invocation"
                )
            self._reservation = finalization.cache_finalizer_outcome(
                self._reservation,
                outcome=outcome,
            )
            self.state = "SUPERVISOR_CLOSED"

    def _prepared_finalization_bytes(
        self,
    ) -> tuple[bytes, bytes, dict[str, Any], ArtifactRef]:
        record = self._requirement_record
        marker = self._seal_marker
        reservation = self._reservation
        if (
            record is None
            or marker is None
            or type(reservation)
            is not finalization.FinalizationOutcomeCachedReservation
        ):
            raise EvidenceConflict(
                "finalization bytes require one cached outcome"
            )
        finalization_record = finalization.EvidenceFinalizationRecord(
            artifact_kind="acceptance-evidence-finalization",
            schema_version=1,
            state=finalization.EvidenceFinalizationState.COMPLETED,
            enforcement_generation=record.enforcement_generation,
            enforcement_digest=record.enforcement_digest,
            requirement_digest=record.requirement_digest,
            config_digest=record.config_digest,
            source_digest=record.source_digest,
            seal_digest=marker.seal_digest,
            primary_result=marker.primary_result,
            primary_result_digest=marker.primary_result_digest,
            failure_code=None,
            outcome=reservation.cached_outcome,
        )
        result = marker.primary_result.document.json_value()
        if type(result) is not dict:
            raise EvidenceManifestInvalid(
                "primary result document must be an object"
            )
        result = dict(result)
        result.update(finalization_record.published_result_tuple().to_dict())
        result["evidenceFinalization"] = finalization_record.to_dict()
        artifacts = dict(self._artifacts)
        for artifact in marker.snapshot.artifacts:
            key = (
                artifact.role_name
                if artifact.discriminator is None
                else f"{artifact.role_name}@{artifact.discriminator}"
            )
            value = _store_artifact_ref(artifact.ref)
            if key in artifacts and artifacts[key] != value:
                raise EvidenceConflict(
                    "manifest artifact key has conflicting role identities"
                )
            artifacts[key] = value
        completed_at = _utc_now()
        manifest = {
            "artifactKind": "acceptance-run-manifest",
            "schemaVersion": 1,
            "workspaceId": self.store.workspace_id,
            "gateId": self.gate_id,
            "runId": self.run_id,
            "state": "DURABLE",
            "createdAt": self.created_at,
            "completedAt": completed_at,
            "source": self.source,
            "runtime": {
                "runtimeManifestRef": (
                    marker.snapshot.runtime_manifest_ref.to_dict()
                )
            },
            "result": result,
            "artifacts": self._public_inventory(artifacts),
            "redaction": {"status": "passed"},
        }
        manifest_bytes = _canonical_contract_bytes(manifest)
        manifest_ref = ArtifactRef(
            workspace_id=self.store.workspace_id,
            gate_id=self.gate_id,
            run_id=self.run_id,
            path="manifest.json",
            sha256=_sha256_bytes(manifest_bytes),
            media_type="application/json",
        )
        pointer = finalization.LatestPointer.create(
            workspace_id=self.store.workspace_id,
            gate_id=self.gate_id,
            run_id=self.run_id,
            completed_at=completed_at,
            manifest=_contract_artifact_ref(manifest_ref),
        )
        pointer_bytes = _canonical_contract_bytes(pointer.to_dict())
        self._reservation = finalization.prepare_finalization_manifest(
            reservation,
            completed_at=completed_at,
            manifest_bytes=manifest_bytes,
            latest_pointer_bytes=pointer_bytes,
        )
        return manifest_bytes, pointer_bytes, manifest, manifest_ref

    def _publish_finalizer_latest(
        self,
        record: finalization.FinalizerRequirementRecord,
        pointer_bytes: bytes,
    ) -> finalization.FinalizationLatestDisposition:
        gate_dir = self.run_dir.parent
        publish_lock = _FileLock(gate_dir / ".publish.lock")
        publish_lock.acquire(blocking=True)
        try:
            self.store._validate_active_enforcement(record)
            latest_dir = (
                gate_dir / "finalizer-enforcement" / "latest"
            )
            _private_directory(
                latest_dir,
                "finalizer-generation-latest",
            )
            latest_path = latest_dir / (
                f"{record.enforcement_generation}.json"
            )
            disposition = (
                finalization.FinalizationLatestDisposition.PUBLISHED
            )
            try:
                candidate = finalization.LatestPointer.from_dict(
                    json.loads(pointer_bytes.decode("utf-8"))
                )
            except (
                ValueError,
                UnicodeDecodeError,
                json.JSONDecodeError,
            ) as error:
                raise EvidenceManifestInvalid(
                    "candidate generation latest pointer is invalid"
                ) from error
            if latest_path.exists():
                current_value = self.store._read_contract_object(
                    latest_path,
                    path_role="finalizer-generation-latest",
                )
                try:
                    current = finalization.LatestPointer.from_dict(
                        current_value
                    )
                except ValueError as error:
                    raise EvidenceManifestInvalid(
                        "generation latest pointer is invalid"
                    ) from error
                current_order = (current.completed_at, current.run_id)
                candidate_order = (
                    candidate.completed_at,
                    candidate.run_id,
                )
                if current.to_dict() == candidate.to_dict():
                    if latest_path.read_bytes() != pointer_bytes:
                        raise EvidenceManifestInvalid(
                            "equal latest pointer has noncanonical bytes"
                        )
                    _fsync_file(
                        latest_path,
                        path_role="finalizer-generation-latest",
                    )
                    _fsync_directory(latest_dir)
                    disposition = (
                        finalization.FinalizationLatestDisposition.ALREADY_CURRENT
                    )
                elif current_order > candidate_order:
                    disposition = (
                        finalization.FinalizationLatestDisposition.SUPERSEDED
                    )
                else:
                    _atomic_write(
                        latest_path,
                        pointer_bytes,
                        path_role="finalizer-generation-latest",
                    )
            else:
                _atomic_write(
                    latest_path,
                    pointer_bytes,
                    path_role="finalizer-generation-latest",
                )
            return disposition
        finally:
            publish_lock.release()

    def finalize_with_evidence(self) -> dict[str, Any]:
        with self._mutex:
            if self.state not in {
                "SUPERVISOR_CLOSED",
                "FINALIZING",
                "DURABLE",
            }:
                raise EvidenceConflict(
                    "required run is not ready for evidence finalization"
                )
            _acquire_bounded(
                self._finalization_lock,
                timeout_seconds=60,
                operation="finalize-with-evidence",
            )
            try:
                self._validate_required_control_files()
                if self._seal_marker is None:
                    raise EvidenceManifestInvalid("sealed marker is unavailable")
                seal_path = self.run_dir / "sealed.json"
                if seal_path.read_bytes() != _canonical_contract_bytes(
                    self._seal_marker.to_dict()
                ):
                    raise EvidenceManifestInvalid("sealed marker changed")
                self._validate_seal_candidate(self._seal_marker)
                if (
                    type(self._reservation)
                    is finalization.FinalizationOutcomeCachedReservation
                ):
                    (
                        manifest_bytes,
                        pointer_bytes,
                        manifest,
                        manifest_ref,
                    ) = self._prepared_finalization_bytes()
                elif type(self._reservation) in (
                    finalization.FinalizationManifestPreparedReservation,
                    finalization.FinalizationManifestDurableReservation,
                ):
                    reservation = self._reservation
                    manifest_bytes = reservation.manifest_bytes
                    pointer_bytes = reservation.latest_pointer_bytes
                    try:
                        manifest = json.loads(manifest_bytes.decode("utf-8"))
                    except (UnicodeDecodeError, json.JSONDecodeError) as error:
                        raise EvidenceManifestInvalid(
                            "cached manifest bytes are invalid"
                        ) from error
                    manifest_ref = ArtifactRef(
                        workspace_id=self.store.workspace_id,
                        gate_id=self.gate_id,
                        run_id=self.run_id,
                        path="manifest.json",
                        sha256=reservation.manifest_digest,
                        media_type="application/json",
                    )
                else:
                    raise EvidenceConflict(
                        "finalization reservation cannot prepare a manifest"
                    )
                self.state = "FINALIZING"
                if (
                    type(self._reservation)
                    is finalization.FinalizationManifestPreparedReservation
                ):
                    _atomic_write_no_replace(
                        self.run_dir / "manifest.json",
                        manifest_bytes,
                        path_role="run-manifest",
                    )
                    self._reservation = (
                        finalization.mark_finalization_manifest_durable(
                            self._reservation
                        )
                    )
                self._manifest = manifest
                self._manifest_ref = manifest_ref
                self.state = "DURABLE"
            finally:
                self._finalization_lock.release()

            record = self._requirement_record
            if record is None:
                raise EvidenceConflict("required finalization record is absent")
            disposition = self._publish_finalizer_latest(
                record,
                pointer_bytes,
            )
            if (
                type(self._reservation)
                is not finalization.FinalizationManifestDurableReservation
            ):
                raise EvidenceConflict(
                    "latest resolution requires a durable reservation"
                )
            self._reservation = finalization.resolve_finalization_latest(
                self._reservation,
                disposition=disposition,
            )
            self.state = "LATEST_RESOLVED"
            return dict(self._manifest or {})

    def finalize_pre_seal_failure(
        self,
        primary_result: finalization.CanonicalPrimaryResult,
        *,
        supervisor_session: finalization.SupervisorSession,
    ) -> dict[str, Any]:
        with self._mutex:
            record = self._requirement_record
            if (
                record is None
                or self._preflight_token is None
                or self._supervisor_session is None
            ):
                raise EvidenceConflict(
                    "pre-seal finalization requires one allocated required run"
                )
            if self.state not in {"ACTIVE", "FINALIZING", "DURABLE"}:
                raise EvidenceConflict(
                    "run cannot publish a pre-seal failure from its current state"
                )
            if (
                type(supervisor_session)
                is not finalization.SupervisorSession
                or supervisor_session is not self._supervisor_session
                or supervisor_session.state != "CLOSED"
            ):
                raise EvidenceConflict(
                    "live preflight supervisor must be closed"
                )
            if type(primary_result) is not finalization.CanonicalPrimaryResult:
                raise EvidenceManifestInvalid(
                    "primary result must use CanonicalPrimaryResult"
                )
            if (
                primary_result.source_trace.source_commit
                != record.source_commit
            ):
                raise EvidenceManifestInvalid(
                    "primary result source does not match required run"
                )
            for reference in primary_result.source_trace.evidence_refs:
                if (
                    reference.workspace_id,
                    reference.gate_id,
                    reference.run_id,
                ) != (
                    self.store.workspace_id,
                    self.gate_id,
                    self.run_id,
                ):
                    raise EvidenceManifestInvalid(
                        "primary result evidence ref does not match run"
                    )
                self.store.resolve(_store_artifact_ref(reference))
            primary_digest = primary_result.digest()
            if (
                self._pre_seal_primary_digest is not None
                and self._pre_seal_primary_digest != primary_digest
            ):
                raise EvidenceConflict(
                    "pre-seal finalization retry changed primary result"
                )
            _acquire_bounded(
                self._finalization_lock,
                timeout_seconds=60,
                operation="finalize-pre-seal-failure",
            )
            try:
                if (
                    (self.run_dir / "sealed.json").exists()
                    or self._seal_marker is not None
                    or self._reservation is not None
                ):
                    raise EvidenceConflict(
                        "sealed run cannot use pre-seal failure branch"
                    )
                self._validate_required_control_files()
                self.store._validate_requirement_bundles(record)
                if self._pre_seal_manifest_bytes is None:
                    finalization_record = (
                        finalization.EvidenceFinalizationRecord(
                            artifact_kind=(
                                "acceptance-evidence-finalization"
                            ),
                            schema_version=1,
                            state=(
                                finalization.EvidenceFinalizationState
                                .NOT_INVOKED_PRE_SEAL
                            ),
                            enforcement_generation=(
                                record.enforcement_generation
                            ),
                            enforcement_digest=record.enforcement_digest,
                            requirement_digest=record.requirement_digest,
                            config_digest=record.config_digest,
                            source_digest=record.source_digest,
                            seal_digest=None,
                            primary_result=primary_result,
                            primary_result_digest=primary_digest,
                            failure_code=(
                                finalization.FinalizerFailureCode
                                .NOT_INVOKED_PRE_SEAL
                            ),
                            outcome=None,
                        )
                    )
                    result = primary_result.document.json_value()
                    if type(result) is not dict:
                        raise EvidenceManifestInvalid(
                            "primary result document must be an object"
                        )
                    result = dict(result)
                    result.update(
                        finalization_record.published_result_tuple().to_dict()
                    )
                    result["evidenceFinalization"] = (
                        finalization_record.to_dict()
                    )
                    completed_at = _utc_now()
                    manifest = {
                        "artifactKind": "acceptance-run-manifest",
                        "schemaVersion": 1,
                        "workspaceId": self.store.workspace_id,
                        "gateId": self.gate_id,
                        "runId": self.run_id,
                        "state": "DURABLE",
                        "createdAt": self.created_at,
                        "completedAt": completed_at,
                        "source": self.source,
                        "runtime": {},
                        "result": result,
                        "artifacts": self._public_inventory(self._artifacts),
                        "redaction": {"status": "passed"},
                    }
                    manifest_bytes = _canonical_contract_bytes(manifest)
                    manifest_ref = ArtifactRef(
                        workspace_id=self.store.workspace_id,
                        gate_id=self.gate_id,
                        run_id=self.run_id,
                        path="manifest.json",
                        sha256=_sha256_bytes(manifest_bytes),
                        media_type="application/json",
                    )
                    pointer = finalization.LatestPointer.create(
                        workspace_id=self.store.workspace_id,
                        gate_id=self.gate_id,
                        run_id=self.run_id,
                        completed_at=completed_at,
                        manifest=_contract_artifact_ref(manifest_ref),
                    )
                    self._pre_seal_manifest_bytes = manifest_bytes
                    self._pre_seal_pointer_bytes = _canonical_contract_bytes(
                        pointer.to_dict()
                    )
                    self._pre_seal_primary_digest = primary_digest
                manifest_bytes = self._pre_seal_manifest_bytes
                pointer_bytes = self._pre_seal_pointer_bytes
                if manifest_bytes is None or pointer_bytes is None:
                    raise EvidenceConflict(
                        "pre-seal finalization cache is incomplete"
                    )
                _atomic_write_no_replace(
                    self.run_dir / "manifest.json",
                    manifest_bytes,
                    path_role="run-manifest",
                )
                manifest = json.loads(manifest_bytes.decode("utf-8"))
                self._manifest_ref = ArtifactRef(
                    workspace_id=self.store.workspace_id,
                    gate_id=self.gate_id,
                    run_id=self.run_id,
                    path="manifest.json",
                    sha256=_sha256_bytes(manifest_bytes),
                    media_type="application/json",
                )
                self._manifest = manifest
                self.state = "DURABLE"
            finally:
                self._finalization_lock.release()
            self._publish_finalizer_latest(record, pointer_bytes)
            self.state = "LATEST_RESOLVED"
            return dict(self._manifest or {})

    def finalize(
        self,
        *,
        result: Mapping[str, Any],
        runtime: Mapping[str, Any] | None = None,
        redaction_status: str = "passed",
    ) -> dict[str, Any]:
        with self._mutex:
            if self.state != "ACTIVE":
                raise EvidenceConflict("run can only be finalized once")
            if self._requirement_record is not None:
                raise EvidenceConflict(
                    "required-finalizer run must use finalize_with_evidence"
                )
            self.state = "FINALIZING"
            completed_at = _utc_now()
            raw_result = dict(result)
            secret_scan = raw_result.pop("secretScan", None)
            redacted_secret_scan = (
                canonical_secret_scan(secret_scan, self._redaction_values)
                if secret_scan is not None
                else None
            )
            redacted_result = redact_value_with_values(
                raw_result,
                self._redaction_values,
            )
            manifest = {
                "artifactKind": "acceptance-run-manifest",
                "schemaVersion": 1,
                "workspaceId": self.store.workspace_id,
                "gateId": self.gate_id,
                "runId": self.run_id,
                "state": "DURABLE",
                "createdAt": self.created_at,
                "completedAt": completed_at,
                "source": redact_value_with_values(self.source, self._redaction_values),
                "runtime": redact_value_with_values(
                    dict(runtime or {}),
                    self._redaction_values,
                ),
                "result": redacted_result,
                "artifacts": self._public_inventory(self._artifacts),
                "redaction": {"status": redaction_status},
            }
            _public_metadata({
                key: manifest[key] for key in (
                    "artifactKind", "schemaVersion", "workspaceId", "gateId",
                    "runId", "state", "createdAt", "completedAt",
                )
            }, self._redaction_values)
            if redacted_secret_scan is not None:
                manifest["result"]["secretScan"] = redacted_secret_scan
            encoded = (
                json.dumps(manifest, indent=2, sort_keys=True, default=str) + "\n"
            ).encode("utf-8")
            manifest = json.loads(encoded.decode("utf-8"))
            target = self.run_dir / "manifest.json"
            _atomic_write(target, encoded, path_role="run-manifest")
            self._manifest_ref = ArtifactRef(
                workspace_id=self.store.workspace_id,
                gate_id=self.gate_id,
                run_id=self.run_id,
                path="manifest.json",
                sha256=_sha256_bytes(encoded),
                media_type="application/json",
            )
            self._manifest = manifest
            self.state = "DURABLE"
            return manifest

    def publish_latest(self, *, runtime_cell: str | None = None) -> Path:
        if self._requirement_record is not None:
            raise EvidenceConflict(
                "required-finalizer run must publish generation latest"
            )
        if self.state not in {"DURABLE", "PUBLISHED"}:
            raise EvidenceConflict("latest can only publish a durable manifest")
        if self._manifest is None or self._manifest_ref is None:
            raise EvidenceManifestInvalid("durable run is missing its manifest")
        gate_dir = self.run_dir.parent
        lock = _FileLock(gate_dir / ".publish.lock")
        lock.acquire(blocking=True)
        try:
            normalized_cell = (
                _validate_gate_id(runtime_cell)
                if runtime_cell
                else None
            )
            if normalized_cell is not None:
                result = self._manifest.get("result")
                if (
                    not isinstance(result, dict)
                    or result.get("runtimeCell") != normalized_cell
                ):
                    raise EvidenceManifestInvalid(
                        "durable manifest runtime cell mismatch"
                    )
            latest_path = gate_dir / (
                f"latest.{normalized_cell}.json"
                if normalized_cell is not None
                else "latest.json"
            )
            if latest_path.is_file():
                current = self.store._latest_pointer(
                    self.gate_id,
                    required=True,
                    runtime_cell=normalized_cell,
                )
                if current is None:
                    raise EvidenceManifestInvalid("existing latest pointer is invalid")
                current_order = (
                    str(current.get("completedAt", "")),
                    str(current.get("runId", "")),
                )
                candidate_order = (
                    str(self._manifest["completedAt"]),
                    self.run_id,
                )
                if current_order > candidate_order:
                    return latest_path
            pointer = {
                "artifactKind": "acceptance-latest-pointer",
                "schemaVersion": 1,
                "workspaceId": self.store.workspace_id,
                "gateId": self.gate_id,
                "runId": self.run_id,
                "completedAt": self._manifest["completedAt"],
                "manifest": self._manifest_ref.to_dict(),
                "manifestSha256": self._manifest_ref.sha256,
            }
            if normalized_cell is not None:
                pointer["runtimeCell"] = normalized_cell
            encoded = (
                json.dumps(pointer, indent=2, sort_keys=True) + "\n"
            ).encode("utf-8")
            _atomic_write(latest_path, encoded, path_role="latest-pointer")
            self.state = "PUBLISHED"
            return latest_path
        finally:
            lock.release()

    def close(self) -> None:
        self._active_lock.release()
        if self.state in {"DURABLE", "PUBLISHED", "LATEST_RESOLVED"}:
            self.state = "CLOSED"
        elif self.state != "CLOSED":
            self.state = "EVIDENCE_FAILED"

    def __enter__(self) -> "RunHandle":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


class ArtifactSession:
    def __init__(
        self,
        *,
        repo_root: Path,
        gate_id: str,
        source: Mapping[str, Any] | None = None,
    ) -> None:
        self.repo_root = repo_root
        self.gate_id = _validate_gate_id(gate_id)
        self.store = EvidenceStore.from_environment(
            repo_root=repo_root,
            worktree=repo_root,
        )
        context_run_id = os.environ.get(RUN_ID_ENV, "").strip()
        self._owned_run: RunHandle | None = None
        self._completed = False
        if context_run_id:
            if os.environ.get(RUN_GATE_ENV) != self.gate_id:
                raise EvidenceManifestInvalid(
                    "artifact session Gate does not match run context"
                )
            current_run_directory(repo_root=repo_root)
        else:
            self._owned_run = self.store.begin_run(
                self.gate_id,
                source=dict(
                    source if source is not None else source_identity(repo_root)
                ),
            )

    @property
    def run_id(self) -> str:
        if self._owned_run is not None:
            return self._owned_run.run_id
        return os.environ[RUN_ID_ENV]

    def subprocess_environment(
        self,
        base: Mapping[str, str] | None = None,
    ) -> dict[str, str]:
        if self._owned_run is not None:
            return self._owned_run.subprocess_environment(base)
        environment = dict(os.environ)
        if base is not None:
            environment.update(base)
        current_run_directory(
            repo_root=self.repo_root,
            environment=environment,
        )
        return environment

    def write_bytes(
        self,
        relative_path: str,
        value: bytes,
        *,
        media_type: str = "application/octet-stream",
        role: str | None = None,
    ) -> ArtifactRef:
        if self._owned_run is not None:
            return self._owned_run.write_bytes(
                relative_path,
                value,
                media_type=media_type,
                role=role,
            )
        write_current_artifact(
            relative_path,
            value,
            repo_root=self.repo_root,
        )
        reference = current_artifact_ref(
            relative_path,
            repo_root=self.repo_root,
            media_type=media_type,
        )
        if role is not None:
            _register_current_artifact_role(
                reference,
                role,
                repo_root=self.repo_root,
            )
        return reference

    def write_json(
        self,
        relative_path: str,
        value: Mapping[str, Any],
        *,
        role: str | None = None,
        redact: bool = True,
    ) -> ArtifactRef:
        if self._owned_run is not None:
            return self._owned_run.write_json(
                relative_path,
                value,
                role=role,
                redact=redact,
            )
        if role is not None:
            _public_metadata(role, _redaction_values())
        write_current_json(
            relative_path, value, repo_root=self.repo_root,
        )
        reference = current_artifact_ref(
            relative_path, repo_root=self.repo_root,
            media_type="application/json",
        )
        if role is not None:
            _register_current_artifact_role(reference, role, repo_root=self.repo_root)
        return reference

    def complete(
        self,
        *,
        status: str,
        completion_status: str,
        proof_status: str,
        runtime: Mapping[str, Any] | None = None,
    ) -> ArtifactRef | None:
        if self._completed:
            raise EvidenceConflict("artifact session is already complete")
        self._completed = True
        if self._owned_run is None:
            return None
        self._owned_run.collect_existing_artifacts()
        self._owned_run.finalize(
            result={
                "status": status,
                "completionStatus": completion_status,
                "proofStatus": proof_status,
            },
            runtime=runtime,
        )
        self._owned_run.publish_latest()
        return self._owned_run.manifest_ref

    def close(self) -> None:
        if self._owned_run is not None:
            self._owned_run.close()

    def __enter__(self) -> "ArtifactSession":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()
