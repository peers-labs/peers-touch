from __future__ import annotations

import errno
import hashlib
import json
import mimetypes
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, BinaryIO, Mapping

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
    redact_artifact_bytes,
    redact_text_with_values,
    redact_value,
    redact_value_with_values,
)


ARTIFACT_ROOT_ENV = "PT_ACCEPTANCE_ARTIFACT_ROOT"
RUN_WORKSPACE_ENV = "PT_ACCEPTANCE_WORKSPACE_ID"
RUN_GATE_ENV = "PT_ACCEPTANCE_GATE_ID"
RUN_ID_ENV = "PT_ACCEPTANCE_RUN_ID"
REDACTION_VALUES_ENV = "PT_ACCEPTANCE_REDACTION_VALUES"
GATE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
RUN_ID_PATTERN = re.compile(r"^\d{8}T\d{12}Z-[0-9a-f]{32}$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


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


def _new_run_id() -> str:
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
        / _validate_run_id(run_id)
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
    current_environment = dict(
        os.environ if environment is None else environment
    )
    secret_values = _redaction_values(current_environment)
    if redact_text_with_values(relative_path, secret_values) != relative_path:
        raise EvidenceManifestInvalid(
            "Acceptance artifact path contains a resolved credential"
        )
    value, _ = redact_artifact_bytes(value, secret_values)
    run_dir = current_run_directory(
        repo_root=repo_root,
        environment=current_environment,
    )
    lock = _FileLock(run_dir / ".artifact-write.lock")
    lock.acquire(blocking=True)
    try:
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


def _validate_run_id(run_id: str) -> str:
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


class _FileLock:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._handle: BinaryIO | None = None

    def acquire(self, *, blocking: bool) -> bool:
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
            handle = self.path.open("a+b")
            if os.name != "nt":
                os.chmod(self.path, 0o600)
                import fcntl

                flags = fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB)
                try:
                    fcntl.flock(handle.fileno(), flags)
                except BlockingIOError:
                    handle.close()
                    return False
            else:
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
        _validate_run_id(self.run_id)
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
        if value.get("artifactKind") != "acceptance-artifact-ref":
            raise EvidenceManifestInvalid("invalid artifact reference kind")
        try:
            return cls(
                workspace_id=str(value["workspaceId"]),
                gate_id=str(value["gateId"]),
                run_id=str(value["runId"]),
                path=str(value["path"]),
                sha256=str(value["sha256"]),
                media_type=str(value["mediaType"]),
            )
        except KeyError as error:
            raise EvidenceManifestInvalid(
                f"artifact reference missing {error.args[0]}"
            ) from error


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
    try:
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
            candidate = _validate_run_id(run_id) if run_id else _new_run_id()
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

    def resolve(self, reference: ArtifactRef, *, verify_hash: bool = True) -> Path:
        if reference.workspace_id != self.workspace_id:
            raise EvidenceManifestInvalid("artifact workspace does not match store")
        run_dir = (
            self.workspace_dir
            / _validate_gate_id(reference.gate_id)
            / _validate_run_id(reference.run_id)
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
        return manifest

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
        normalized_run = _validate_run_id(run_id)
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
        with self._mutex:
            if self.state != "ACTIVE":
                raise EvidenceConflict("artifacts can only be written to an active run")
            normalized, target = self._target(relative_path)
            if (
                redact_text_with_values(normalized, self._redaction_values)
                != normalized
            ):
                raise EvidenceManifestInvalid(
                    "Acceptance artifact path contains a resolved credential"
                )
            value, redacted = redact_artifact_bytes(
                value,
                self._redaction_values,
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
            artifact_role = role or normalized
            existing = self._artifacts.get(artifact_role)
            if existing is not None and existing != reference:
                raise EvidenceConflict(f"artifact role already exists: {artifact_role}")
            self._artifacts[artifact_role] = reference
            return reference

    def write_json(
        self,
        relative_path: str,
        value: Mapping[str, Any],
        *,
        role: str | None = None,
        redact: bool = True,
    ) -> ArtifactRef:
        payload: Any = redact_value(dict(value)) if redact else dict(value)
        encoded = (
            json.dumps(payload, indent=2, sort_keys=True, default=str) + "\n"
        ).encode("utf-8")
        return self.write_bytes(
            relative_path,
            encoded,
            media_type="application/json",
            role=role,
        )

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
                "source": self.source,
                "runtime": redact_value_with_values(
                    dict(runtime or {}),
                    self._redaction_values,
                ),
                "result": redacted_result,
                "artifacts": {
                    role: reference.to_dict()
                    for role, reference in sorted(self._artifacts.items())
                },
                "redaction": {"status": redaction_status},
            }
            manifest = redact_value_with_values(
                manifest,
                self._redaction_values,
            )
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
        if self.state in {"DURABLE", "PUBLISHED"}:
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
        payload: Any = redact_value(dict(value)) if redact else dict(value)
        encoded = (
            json.dumps(payload, indent=2, sort_keys=True, default=str) + "\n"
        ).encode("utf-8")
        return self.write_bytes(
            relative_path,
            encoded,
            media_type="application/json",
            role=role,
        )

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
