from __future__ import annotations

import hashlib
import hmac
import json
import math
import os
import secrets
import stat
import threading
import time
import weakref
from collections.abc import Callable, Mapping
from contextlib import AbstractContextManager, ExitStack
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional, Protocol, TypeVar

from tooling.acceptance.core import (
    REPO_ROOT,
    ArtifactRef,
    validate_external_output_path,
    workspace_id,
)
from tooling.acceptance.core.redaction import redact_value
from tooling.acceptance.gates.mobile.proof_contracts import (
    ARTIFACT_ROLES,
    GATE_ID,
    validate_contract_payload,
)


CLIENT_PLATFORM = {
    "alice-ios": "ios",
    "bob-ios": "ios",
    "alice-android": "android",
    "bob-android": "android",
}
CLIENT_PROVIDER = {
    "alice-ios": "github",
    "bob-ios": "google",
    "alice-android": "google",
    "bob-android": "github",
}
PROVIDER_CLIENTS = {
    "github": ("alice-ios", "bob-android"),
    "google": ("bob-ios", "alice-android"),
}
LEASE_DURATION = timedelta(minutes=10)
LEDGER_SCHEMA = "peers-mobile-resource-lease-ledger"
LEDGER_VERSION = 1
LEDGER_AUTH_DOMAIN = b"peers-mobile-resource-lease-ledger-state-v1\0"
LEDGER_ANCHOR_DOMAIN = b"peers-mobile-resource-lease-ledger-anchor-v1\0"
LEDGER_GENERATIONS_DIRECTORY = "ledger.generations"
LEDGER_PENDING_NAME = "ledger.pending.json"
HEARTBEAT_CHAIN_DOMAIN = b"peers-mobile-resource-lease-heartbeat-v1\0"
LEDGER_AUTHORITY_NAMESPACE = "peers-touch/mobile-resource-leases/process-global"
LEDGER_AUTHORITY_ID = hashlib.sha256(
    LEDGER_AUTHORITY_NAMESPACE.encode("utf-8")
).hexdigest()[:16]
LEDGER_AUTHORITY_ROOT = (
    Path("/var/tmp").resolve(strict=True)
    / "peers-touch"
    / "acceptance"
    / "mobile-resource-leases"
    / LEDGER_AUTHORITY_ID
)
MAX_HEARTBEAT_STOP_SECONDS = 30.0

_T = TypeVar("_T")


class MobileResourceLeaseError(RuntimeError):
    """A Mobile resource lease operation failed closed."""


class MobileResourceLeaseDeadlineExceeded(
    MobileResourceLeaseError,
    TimeoutError,
):
    """A resource operation could not acquire authority before its deadline."""


class LeaseConflict(MobileResourceLeaseError):
    """A live or quarantined resource prevents acquisition."""


class LeaseFenceStale(MobileResourceLeaseError):
    """An operation presented a lease tuple that is no longer current."""


class LeaseHeartbeatExpired(MobileResourceLeaseError):
    """A lease heartbeat expired and the resource was quarantined."""


class LeaseBaselineMismatch(MobileResourceLeaseError):
    """A resource baseline or secret-side identity did not match."""


class _PhysicalDeviceFactMismatch(LeaseBaselineMismatch):
    def __init__(self, failure_code: str, message: str) -> None:
        super().__init__(message)
        self.failure_code = failure_code


class ArtifactWriter(Protocol):
    gate_id: str
    run_id: str

    def write_json(
        self,
        relative_path: str,
        value: Mapping[str, Any],
        *,
        role: str | None = None,
        redact: bool = True,
    ) -> ArtifactRef:
        ...


PhysicalDeviceResolver = Callable[[str], "ResolvedPhysicalDeviceHandle"]
ArtifactWriterResolver = Callable[[ArtifactRef], Optional[object]]


def _canonical_json_bytes(
    value: Mapping[str, Any],
    *,
    redact: bool = True,
) -> bytes:
    payload = redact_value(dict(value)) if redact else dict(value)
    return (
        json.dumps(payload, indent=2, sort_keys=True, default=str) + "\n"
    ).encode("utf-8")


def _validate_json_artifact_reference(
    reference: ArtifactRef,
    *,
    gate_id: str,
    run_id: str,
    path: str,
    value: Mapping[str, Any],
    redact: bool = True,
    expected_workspace_id: str | None = None,
) -> ArtifactRef:
    expected = {
        "artifactKind": "acceptance-artifact-ref",
        "workspaceId": expected_workspace_id or workspace_id(REPO_ROOT),
        "gateId": gate_id,
        "runId": run_id,
        "path": path,
        "sha256": hashlib.sha256(
            _canonical_json_bytes(value, redact=redact)
        ).hexdigest(),
        "mediaType": "application/json",
    }
    observed = reference.to_dict()
    mismatched = tuple(
        field
        for field, expected_value in expected.items()
        if observed.get(field) != expected_value
    )
    if mismatched:
        raise MobileResourceLeaseError(
            "artifact writer returned an invalid reference: "
            + ", ".join(mismatched)
        )
    return reference


def _artifact_role_instance(role: str, discriminator: str) -> str:
    if role not in ARTIFACT_ROLES:
        raise MobileResourceLeaseError(
            f"unknown frozen Mobile Artifact Role {role!r}"
        )
    if (
        not discriminator
        or discriminator in {".", ".."}
        or "/" in discriminator
        or "\\" in discriminator
        or "\x00" in discriminator
    ):
        raise MobileResourceLeaseError(
            f"invalid Mobile Artifact Role discriminator for {role!r}"
        )
    return f"{role}/{discriminator}"


def _acquisition_artifact_role(payload: Mapping[str, Any]) -> str:
    artifact_kind = str(payload.get("artifactKind", ""))
    if artifact_kind == "provider-account-lease":
        return _artifact_role_instance(
            "provider-account-lease",
            str(payload["provider"]),
        )
    if artifact_kind == "physical-device-lease":
        return _artifact_role_instance(
            "physical-device-lease",
            str(payload["clientId"]),
        )
    if artifact_kind == "provider-browser-session-lease":
        return _artifact_role_instance(
            "provider-browser-session-lease",
            str(payload["clientId"]),
        )
    raise MobileResourceLeaseError(
        f"unsupported acquisition Artifact Role kind {artifact_kind!r}"
    )


def _read_artifact_bytes(
    source: object,
    reference: ArtifactRef,
) -> bytes:
    read_bytes = getattr(source, "read_bytes", None)
    if callable(read_bytes):
        value = read_bytes(reference)
    else:
        store = getattr(source, "store", None)
        resolve = getattr(store, "resolve", None)
        if not callable(resolve):
            raise MobileResourceLeaseError(
                "immutable acquisition artifact reader is unavailable"
            )
        value = resolve(reference).read_bytes()
    if not isinstance(value, bytes):
        raise MobileResourceLeaseError(
            "immutable acquisition artifact reader returned non-bytes"
        )
    return value


def _canonical_acquisition_authority(
    payload: Mapping[str, Any],
) -> tuple[str, str, str]:
    artifact_kind = str(payload.get("artifactKind", ""))
    if artifact_kind == "provider-account-lease":
        provider = str(payload["provider"])
        return (
            "provider-account",
            f"provider-account/{provider}/disposable",
            f"runtime/mobile/leases/accounts/{provider}.json",
        )
    if artifact_kind == "physical-device-lease":
        client_id = str(payload["clientId"])
        return (
            "physical-device",
            f"physical-device/{client_id}",
            f"runtime/mobile/leases/devices/{client_id}.json",
        )
    if artifact_kind == "provider-browser-session-lease":
        client_id = str(payload["clientId"])
        return (
            "provider-browser-session",
            f"physical-device/{client_id}/browser/default",
            f"runtime/mobile/leases/browsers/{client_id}.json",
        )
    raise MobileResourceLeaseError(
        f"unsupported immutable acquisition kind {artifact_kind!r}"
    )


@dataclass(frozen=True)
class LeaseIdentity:
    resource_key: str
    holder_run_id: str
    fence_token: int

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> "LeaseIdentity":
        return cls(
            resource_key=str(payload["resourceKey"]),
            holder_run_id=str(payload["holderRunId"]),
            fence_token=int(payload["fenceToken"]),
        )


@dataclass(frozen=True)
class _LeaseDependency:
    kind: str
    identity: LeaseIdentity


@dataclass(frozen=True)
class BaselineRestoreResult:
    cleanup_completed: bool
    baseline_restored: bool
    identity_reverified: bool


@dataclass(frozen=True)
class BrowserBaselineVerificationResult:
    expected_identity_matched: bool
    authorization_in_progress: bool
    mobile_oauth_state_absent: bool
    station_run_state_absent: bool


@dataclass(frozen=True)
class ResolvedPhysicalDeviceHandle:
    """Process-local physical device facts; deliberately cannot be serialized."""

    _identifier: str
    platform: str
    connected: bool
    physical: bool
    simulator: bool

    @property
    def identifier(self) -> str:
        return self._identifier

    def __repr__(self) -> str:
        return "ResolvedPhysicalDeviceHandle(<redacted>)"

    def __reduce__(self) -> tuple[object, ...]:
        raise TypeError("physical device handles cannot be serialized")


class RunScopedCorrelationSecret:
    """Secret-side HMAC correlation with explicit close and zeroization."""

    def __init__(self, key: bytes | bytearray | None = None) -> None:
        material = key if key is not None else secrets.token_bytes(32)
        if len(material) < 32:
            raise ValueError("correlation key must contain at least 32 bytes")
        self._key = bytearray(material)
        self._closed = False

    def fingerprint(self, provider: str, provider_subject: str) -> str:
        if self._closed:
            raise MobileResourceLeaseError("correlation channel is closed")
        message = f"{provider}\0{provider_subject}".encode("utf-8")
        digest = hmac.new(bytes(self._key), message, hashlib.sha256).hexdigest()
        return f"sha256:{digest}"

    def close(self) -> dict[str, bool]:
        for index in range(len(self._key)):
            self._key[index] = 0
        self._closed = True
        return {
            "correlationChannelClosed": True,
            "correlationKeyZeroized": not any(self._key),
        }


@dataclass
class _LeaseRecord:
    kind: str
    acquisition: dict[str, Any]
    acquisition_ref: ArtifactRef | None
    artifact_workspace_id: str
    expires_at: datetime
    state: str
    operation_started: int = 0
    operation_completed: int = 0
    operation_active: int = 0
    max_observed_concurrency: int = 0
    fence_validated: bool = True
    outcome: dict[str, Any] | None = None
    owner_pid: int = 0
    quarantine_reason: str = ""
    physical_identity_hmac: str = ""
    provider_expected_identity_hmac: str = ""
    provider_identity_verified: bool = False
    provider_identity_assertion: dict[str, Any] | None = None
    pending_identity_assertion: dict[str, Any] | None = None
    operation_owner_pid: int = 0
    operation_intent: dict[str, Any] | None = None
    dependencies: tuple[_LeaseDependency, ...] = ()
    pending_outcome: dict[str, Any] | None = None
    heartbeat_history: tuple[dict[str, Any], ...] = ()


class ResourceLeaseLedger:
    """Mobile-owned durable state shared atomically across runner processes."""

    def __init__(self) -> None:
        _require_secure_posix_io()
        requested_root = _default_ledger_root()
        _reject_symlink_components(requested_root)
        self.storage_root = validate_external_output_path(
            requested_root,
            repo_root=REPO_ROOT,
        )
        self._root_fd = _open_secure_directory_tree(self.storage_root)
        os.fchmod(self._root_fd, 0o700)
        self._operations_fd = _open_or_create_directory_at(
            self._root_fd,
            "operations",
        )
        os.fchmod(self._operations_fd, 0o700)
        self._generations_fd = _open_or_create_directory_at(
            self._root_fd,
            LEDGER_GENERATIONS_DIRECTORY,
        )
        os.fchmod(self._generations_fd, 0o700)
        self._state_lock_fd = _open_regular_file_at(
            self._root_fd,
            "ledger.lock",
            os.O_RDWR | os.O_CREAT | os.O_APPEND,
            mode=0o600,
        )
        os.fchmod(self._state_lock_fd, 0o600)
        self._state_file_lock = _PersistentFileLock(self._state_lock_fd)
        self.state_path = self.storage_root / "ledger.json"
        self._thread_lock = threading.RLock()
        self._transaction = threading.local()
        self.lock = _LedgerTransactionLock(self)
        self.operation_locks: dict[str, _ReentrantProcessOperationLock] = {}
        self.records: dict[str, _LeaseRecord] = {}
        self.fences: dict[str, int] = {}
        self.acquisition_order: list[str] = []
        self.recovery_audit: list[dict[str, Any]] = []
        self.physical_identity_key_id = ""
        self._authentication_key = bytearray()
        self._state_generation = 0
        self._state_mac = ""

    def bind_authentication_key(self, key: bytes | bytearray) -> None:
        if len(key) < 32:
            raise ValueError(
                "lease ledger authentication key must contain at least 32 bytes"
            )
        candidate = bytes(key)
        with self._thread_lock:
            if self._authentication_key and not hmac.compare_digest(
                bytes(self._authentication_key),
                candidate,
            ):
                raise MobileResourceLeaseError(
                    "lease ledger authentication key is already bound"
                )
            self._authentication_key = bytearray(candidate)

    def operation_lock(
        self,
        resource_key: str,
        *,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> AbstractContextManager[None]:
        _acquire_thread_lock(
            self._thread_lock,
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )
        try:
            operation_lock = self.operation_locks.get(resource_key)
            if operation_lock is None:
                digest = hashlib.sha256(resource_key.encode("utf-8")).hexdigest()
                operation_lock = _shared_operation_lock(
                    self._operations_fd,
                    f"{digest}.lock",
                    deadline_monotonic=deadline_monotonic,
                    cancellation=cancellation,
                )
                self.operation_locks[resource_key] = operation_lock
            return operation_lock
        finally:
            self._thread_lock.release()

    def _enter_transaction(
        self,
        *,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> None:
        _acquire_thread_lock(
            self._thread_lock,
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )
        depth = getattr(self._transaction, "depth", 0)
        if depth > 0:
            self._transaction.depth = depth + 1
            return
        file_lock = self._state_file_lock
        try:
            file_lock.acquire(
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )
            self._load()
        except BaseException:
            file_lock.release()
            self._thread_lock.release()
            raise
        self._transaction.file_lock = file_lock
        self._transaction.depth = 1

    def _exit_transaction(self) -> None:
        depth = getattr(self._transaction, "depth", 0)
        if depth <= 0:
            raise MobileResourceLeaseError("lease ledger transaction is unbalanced")
        if depth > 1:
            self._transaction.depth = depth - 1
            self._thread_lock.release()
            return
        file_lock = self._transaction.file_lock
        try:
            self._persist()
        finally:
            self._transaction.depth = 0
            self._transaction.file_lock = None
            file_lock.release()
            self._thread_lock.release()

    def _load(self) -> None:
        key = self._require_authentication_key()
        generation_anchors = _read_generation_anchor_chain(
            self._generations_fd,
            key,
        )
        pending = _read_optional_json_at(
            self._root_fd,
            LEDGER_PENDING_NAME,
        )
        if pending is not None:
            self._recover_pending_persist(
                key,
                generation_anchors,
                pending,
            )
            generation_anchors = _read_generation_anchor_chain(
                self._generations_fd,
                key,
            )
        try:
            descriptor = _open_regular_file_at(
                self._root_fd,
                "ledger.json",
                os.O_RDONLY,
            )
        except FileNotFoundError:
            if (
                generation_anchors
                or _regular_file_exists_at(
                    self._root_fd,
                    "ledger.anchor.json",
                )
            ):
                raise MobileResourceLeaseError(
                    "resource lease ledger was deleted or replayed"
                )
            self.records = {}
            self.fences = {}
            self.acquisition_order = []
            self.recovery_audit = []
            self.physical_identity_key_id = ""
            self._state_generation = 0
            self._state_mac = ""
            return
        try:
            with os.fdopen(descriptor, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
            if (
                payload.get("schema") != LEDGER_SCHEMA
                or payload.get("version") != LEDGER_VERSION
                or payload.get("authorityNamespace")
                != LEDGER_AUTHORITY_NAMESPACE
                or payload.get("authorityId") != LEDGER_AUTHORITY_ID
            ):
                raise MobileResourceLeaseError(
                    "resource lease ledger identity is invalid"
                )
            authentication = payload.pop("authentication", None)
            if authentication is None:
                if (
                    _regular_file_exists_at(
                        self._root_fd,
                        "ledger.anchor.json",
                    )
                    or not _is_fresh_empty_ledger_payload(payload)
                ):
                    raise MobileResourceLeaseError(
                        "nonempty resource lease ledger is unsigned"
                    )
                generation = 0
                state_mac = ""
            else:
                generation, state_mac = self._verify_authenticated_payload(
                    payload,
                    authentication,
                    generation_anchors,
                )
            records = {
                resource_key: _record_from_dict(value)
                for resource_key, value in payload["records"].items()
            }
            fences = {
                str(resource_key): int(fence)
                for resource_key, fence in payload["fences"].items()
            }
            acquisition_order = [
                str(resource_key) for resource_key in payload["acquisitionOrder"]
            ]
            recovery_audit = [
                dict(entry) for entry in payload.get("recoveryAudit", [])
            ]
            physical_identity_key_id = str(
                payload.get("physicalIdentityKeyId", "")
            )
        except MobileResourceLeaseError:
            raise
        except Exception as error:
            raise MobileResourceLeaseError(
                "resource lease ledger is malformed"
            ) from error
        self.records = records
        self.fences = fences
        self.acquisition_order = acquisition_order
        self.recovery_audit = recovery_audit
        self.physical_identity_key_id = physical_identity_key_id
        self._state_generation = generation
        self._state_mac = state_mac

    def _persist(self) -> None:
        payload = {
            "schema": LEDGER_SCHEMA,
            "version": LEDGER_VERSION,
            "authorityNamespace": LEDGER_AUTHORITY_NAMESPACE,
            "authorityId": LEDGER_AUTHORITY_ID,
            "physicalIdentityKeyId": self.physical_identity_key_id,
            "fences": self.fences,
            "acquisitionOrder": self.acquisition_order,
            "recoveryAudit": self.recovery_audit,
            "records": {
                resource_key: _record_to_dict(record)
                for resource_key, record in self.records.items()
            },
        }
        _assert_durable_state_redacted(payload)
        key = self._require_authentication_key()
        generation = self._state_generation + 1
        previous_state_mac = self._state_mac
        state_mac = _ledger_state_mac(
            key,
            generation,
            previous_state_mac,
            payload,
        )
        authenticated_payload = {
            **payload,
            "authentication": {
                "algorithm": "HMAC-SHA256",
                "generation": generation,
                "previousStateMac": previous_state_mac,
                "stateMac": state_mac,
            },
        }
        generation_anchors = _read_generation_anchor_chain(
            self._generations_fd,
            key,
        )
        if len(generation_anchors) != self._state_generation:
            raise MobileResourceLeaseError(
                "resource lease generation chain does not match loaded state"
            )
        previous_anchor_hash = (
            _generation_anchor_hash(generation_anchors[-1])
            if generation_anchors
            else ""
        )
        anchor = _ledger_anchor_payload(
            key,
            generation,
            state_mac,
            previous_state_mac=previous_state_mac,
            previous_anchor_hash=previous_anchor_hash,
            ledger_hash=_ledger_payload_hash(authenticated_payload),
        )
        pending = {
            "schema": LEDGER_SCHEMA,
            "version": LEDGER_VERSION,
            "authorityNamespace": LEDGER_AUTHORITY_NAMESPACE,
            "authorityId": LEDGER_AUTHORITY_ID,
            "ledger": authenticated_payload,
            "anchor": anchor,
        }
        _atomic_write_json_at(
            self._root_fd,
            LEDGER_PENDING_NAME,
            pending,
            "resource lease ledger pending write failed",
        )
        _atomic_write_json_at(
            self._root_fd,
            "ledger.json",
            authenticated_payload,
            "resource lease ledger atomic write failed",
        )
        _write_generation_anchor_at(
            self._generations_fd,
            anchor,
        )
        _atomic_write_json_at(
            self._root_fd,
            "ledger.anchor.json",
            anchor,
            "resource lease ledger anchor write failed",
        )
        _unlink_regular_file_at(
            self._root_fd,
            LEDGER_PENDING_NAME,
            "resource lease ledger pending cleanup failed",
        )
        self._state_generation = generation
        self._state_mac = state_mac

    def _require_authentication_key(self) -> bytes:
        if not self._authentication_key or not any(self._authentication_key):
            raise MobileResourceLeaseError(
                "resource lease ledger authentication key is unavailable"
            )
        return bytes(self._authentication_key)

    def _verify_authenticated_payload(
        self,
        payload: Mapping[str, Any],
        authentication: object,
        generation_anchors: list[Mapping[str, Any]],
    ) -> tuple[int, str]:
        key = self._require_authentication_key()
        if not isinstance(authentication, Mapping):
            raise MobileResourceLeaseError(
                "resource lease ledger authentication is malformed"
            )
        try:
            algorithm = str(authentication["algorithm"])
            generation = int(authentication["generation"])
            previous_state_mac = str(authentication["previousStateMac"])
            state_mac = str(authentication["stateMac"])
        except (KeyError, TypeError, ValueError) as error:
            raise MobileResourceLeaseError(
                "resource lease ledger authentication is malformed"
            ) from error
        if (
            algorithm != "HMAC-SHA256"
            or isinstance(authentication.get("generation"), bool)
            or generation < 1
            or not _is_sha256_mac(state_mac)
            or (previous_state_mac and not _is_sha256_mac(previous_state_mac))
        ):
            raise MobileResourceLeaseError(
                "resource lease ledger authentication is malformed"
            )
        expected = _ledger_state_mac(
            key,
            generation,
            previous_state_mac,
            payload,
        )
        if not hmac.compare_digest(state_mac, expected):
            raise MobileResourceLeaseError(
                "resource lease ledger authentication failed"
            )
        if len(generation_anchors) != generation:
            raise MobileResourceLeaseError(
                "resource lease ledger was deleted or replayed"
            )
        anchor = generation_anchors[-1]
        if (
            anchor["generation"] != generation
            or not hmac.compare_digest(state_mac, str(anchor["stateMac"]))
            or not hmac.compare_digest(
                previous_state_mac,
                str(anchor["previousStateMac"]),
            )
        ):
            raise MobileResourceLeaseError(
                "resource lease ledger was deleted or replayed"
            )
        authenticated_payload = {
            **payload,
            "authentication": dict(authentication),
        }
        if not hmac.compare_digest(
            str(anchor["ledgerHash"]),
            _ledger_payload_hash(authenticated_payload),
        ):
            raise MobileResourceLeaseError(
                "resource lease ledger was deleted or replayed"
            )
        head = _read_json_at(
            self._root_fd,
            "ledger.anchor.json",
            missing_message="resource lease ledger authentication anchor is missing",
        )
        if _canonical_compact_json_bytes(head) != _canonical_compact_json_bytes(
            anchor
        ):
            raise MobileResourceLeaseError(
                "resource lease ledger was deleted or replayed"
            )
        return generation, state_mac

    def _recover_pending_persist(
        self,
        key: bytes,
        generation_anchors: list[Mapping[str, Any]],
        pending: Mapping[str, Any],
    ) -> None:
        try:
            if (
                pending.get("schema") != LEDGER_SCHEMA
                or pending.get("version") != LEDGER_VERSION
                or pending.get("authorityNamespace")
                != LEDGER_AUTHORITY_NAMESPACE
                or pending.get("authorityId") != LEDGER_AUTHORITY_ID
                or not isinstance(pending["ledger"], Mapping)
                or not isinstance(pending["anchor"], Mapping)
            ):
                raise MobileResourceLeaseError(
                    "resource lease ledger pending state is malformed"
                )
            target_ledger = dict(pending["ledger"])
            target_anchor = dict(pending["anchor"])
            target_payload = dict(target_ledger)
            target_authentication = target_payload.pop("authentication")
            target_generation, target_state_mac = (
                self._verify_payload_authentication(
                    key,
                    target_payload,
                    target_authentication,
                )
            )
        except MobileResourceLeaseError:
            raise
        except (KeyError, TypeError, ValueError) as error:
            raise MobileResourceLeaseError(
                "resource lease ledger pending state is malformed"
            ) from error

        chain_generation = len(generation_anchors)
        if chain_generation not in (
            target_generation - 1,
            target_generation,
        ):
            raise MobileResourceLeaseError(
                "resource lease ledger pending state conflicts with generation chain"
            )
        predecessor = (
            generation_anchors[target_generation - 2]
            if target_generation > 1
            else None
        )
        _verify_generation_anchor(
            key,
            target_anchor,
            expected_generation=target_generation,
            previous_anchor=predecessor,
        )
        if (
            not hmac.compare_digest(
                str(target_anchor["stateMac"]),
                target_state_mac,
            )
            or not hmac.compare_digest(
                str(target_anchor["previousStateMac"]),
                str(target_authentication["previousStateMac"]),
            )
            or not hmac.compare_digest(
                str(target_anchor["ledgerHash"]),
                _ledger_payload_hash(target_ledger),
            )
        ):
            raise MobileResourceLeaseError(
                "resource lease ledger pending state is malformed"
            )
        if chain_generation == target_generation and (
            _canonical_compact_json_bytes(generation_anchors[-1])
            != _canonical_compact_json_bytes(target_anchor)
        ):
            raise MobileResourceLeaseError(
                "resource lease ledger pending state conflicts with generation chain"
            )

        current_ledger = _read_optional_json_at(self._root_fd, "ledger.json")
        current_generation, current_state_mac = _ledger_identity_or_empty(
            key,
            current_ledger,
        )
        if current_generation not in (
            target_generation - 1,
            target_generation,
        ):
            raise MobileResourceLeaseError(
                "resource lease ledger pending state conflicts with ledger"
            )
        target_previous_state_mac = str(
            target_authentication["previousStateMac"]
        )
        if (
            current_generation == target_generation - 1
            and not hmac.compare_digest(
                current_state_mac,
                target_previous_state_mac,
            )
        ):
            raise MobileResourceLeaseError(
                "resource lease ledger pending state conflicts with ledger"
            )
        if current_generation == target_generation and (
            current_ledger is None
            or _canonical_compact_json_bytes(current_ledger)
            != _canonical_compact_json_bytes(target_ledger)
        ):
            raise MobileResourceLeaseError(
                "resource lease ledger pending state conflicts with ledger"
            )

        head = _read_optional_json_at(self._root_fd, "ledger.anchor.json")
        allowed_heads = [target_anchor]
        if predecessor is not None:
            allowed_heads.append(predecessor)
        if head is not None and not any(
            _canonical_compact_json_bytes(head)
            == _canonical_compact_json_bytes(candidate)
            for candidate in allowed_heads
        ):
            raise MobileResourceLeaseError(
                "resource lease ledger pending state conflicts with anchor head"
            )

        if current_generation < target_generation:
            _atomic_write_json_at(
                self._root_fd,
                "ledger.json",
                target_ledger,
                "resource lease ledger recovery write failed",
            )
        if chain_generation < target_generation:
            _write_generation_anchor_at(
                self._generations_fd,
                target_anchor,
            )
        _atomic_write_json_at(
            self._root_fd,
            "ledger.anchor.json",
            target_anchor,
            "resource lease ledger anchor recovery failed",
        )
        _unlink_regular_file_at(
            self._root_fd,
            LEDGER_PENDING_NAME,
            "resource lease ledger pending cleanup failed",
        )

    @staticmethod
    def _verify_payload_authentication(
        key: bytes,
        payload: Mapping[str, Any],
        authentication: object,
    ) -> tuple[int, str]:
        if not isinstance(authentication, Mapping):
            raise MobileResourceLeaseError(
                "resource lease ledger authentication is malformed"
            )
        try:
            algorithm = str(authentication["algorithm"])
            generation = int(authentication["generation"])
            previous_state_mac = str(authentication["previousStateMac"])
            state_mac = str(authentication["stateMac"])
        except (KeyError, TypeError, ValueError) as error:
            raise MobileResourceLeaseError(
                "resource lease ledger authentication is malformed"
            ) from error
        if (
            algorithm != "HMAC-SHA256"
            or isinstance(authentication.get("generation"), bool)
            or generation < 1
            or not _is_sha256_mac(state_mac)
            or (previous_state_mac and not _is_sha256_mac(previous_state_mac))
        ):
            raise MobileResourceLeaseError(
                "resource lease ledger authentication is malformed"
            )
        expected = _ledger_state_mac(
            key,
            generation,
            previous_state_mac,
            payload,
        )
        if not hmac.compare_digest(state_mac, expected):
            raise MobileResourceLeaseError(
                "resource lease ledger authentication failed"
            )
        return generation, state_mac

    def close(self) -> dict[str, bool]:
        def close_descriptor(attribute: str) -> bool:
            descriptor = getattr(self, attribute, -1)
            if descriptor < 0:
                return True
            try:
                os.close(descriptor)
            except OSError:
                return False
            setattr(self, attribute, -1)
            return True

        operation_locks = getattr(self, "operation_locks", None)
        operation_locks_closed = True
        if operation_locks is not None:
            for operation_lock in tuple(operation_locks.values()):
                operation_locks_closed = (
                    operation_lock.close() and operation_locks_closed
                )
            operation_locks.clear()

        state_lock_closed = close_descriptor("_state_lock_fd")
        operations_closed = close_descriptor("_operations_fd")
        generations_closed = close_descriptor("_generations_fd")
        root_closed = close_descriptor("_root_fd")

        authentication_key = getattr(self, "_authentication_key", None)
        if authentication_key is not None:
            for index in range(len(authentication_key)):
                authentication_key[index] = 0
        authentication_key_zeroized = (
            authentication_key is None or not any(authentication_key)
        )
        evidence = {
            "leaseLedgerStateLockDescriptorClosed": state_lock_closed,
            "leaseLedgerOperationLockDescriptorsClosed": (
                operation_locks_closed
            ),
            "leaseLedgerOperationsDescriptorClosed": operations_closed,
            "leaseLedgerGenerationsDescriptorClosed": generations_closed,
            "leaseLedgerRootDescriptorClosed": root_closed,
            "leaseLedgerAuthenticationKeyZeroized": (
                authentication_key_zeroized
            ),
        }
        return {
            **evidence,
            "leaseLedgerClosed": all(evidence.values()),
        }

    def __del__(self) -> None:
        self.close()


class _LedgerTransactionLock:
    def __init__(
        self,
        ledger: ResourceLeaseLedger,
        *,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> None:
        self._ledger = ledger
        self._deadline_monotonic = deadline_monotonic
        self._cancellation = cancellation

    def bounded(
        self,
        *,
        deadline_monotonic: float,
        cancellation: threading.Event | None = None,
    ) -> "_LedgerTransactionLock":
        return _LedgerTransactionLock(
            self._ledger,
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )

    def __enter__(self) -> None:
        self._ledger._enter_transaction(
            deadline_monotonic=self._deadline_monotonic,
            cancellation=self._cancellation,
        )

    def __exit__(self, *_: object) -> None:
        self._ledger._exit_transaction()


class _ReentrantProcessOperationLock:
    """One reentrant thread owner backed by one cross-process file lock."""

    def __init__(self, directory_fd: int, name: str) -> None:
        self._directory_fd = os.dup(directory_fd)
        self._name = name
        self._thread_lock = threading.RLock()
        self._local = threading.local()

    def bounded(
        self,
        *,
        deadline_monotonic: float,
        cancellation: threading.Event | None = None,
    ) -> "_BoundedOperationLock":
        return _BoundedOperationLock(
            self,
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )

    def acquire(
        self,
        *,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> None:
        _acquire_thread_lock(
            self._thread_lock,
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )
        depth = getattr(self._local, "depth", 0)
        if depth > 0:
            self._local.depth = depth + 1
            return
        file_lock = _FileLock(self._directory_fd, self._name)
        try:
            file_lock.acquire(
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )
        except BaseException:
            self._thread_lock.release()
            raise
        self._local.file_lock = file_lock
        self._local.depth = 1

    def release(self) -> None:
        self.__exit__()

    def __enter__(self) -> None:
        self.acquire()

    def __exit__(self, *_: object) -> None:
        depth = getattr(self._local, "depth", 0)
        if depth <= 0:
            raise MobileResourceLeaseError("operation lock is unbalanced")
        if depth > 1:
            self._local.depth = depth - 1
            self._thread_lock.release()
            return
        file_lock = self._local.file_lock
        try:
            file_lock.release()
        finally:
            self._local.depth = 0
            self._local.file_lock = None
            self._thread_lock.release()

    def close(self) -> bool:
        directory_fd = getattr(self, "_directory_fd", -1)
        if directory_fd < 0:
            return True
        try:
            os.close(directory_fd)
        except OSError:
            return False
        self._directory_fd = -1
        return True

    def __del__(self) -> None:
        self.close()


class _BoundedOperationLock:
    def __init__(
        self,
        operation_lock: _ReentrantProcessOperationLock,
        *,
        deadline_monotonic: float,
        cancellation: threading.Event | None,
    ) -> None:
        self._operation_lock = operation_lock
        self._deadline_monotonic = deadline_monotonic
        self._cancellation = cancellation

    def __enter__(self) -> None:
        self._operation_lock.acquire(
            deadline_monotonic=self._deadline_monotonic,
            cancellation=self._cancellation,
        )

    def __exit__(self, *_: object) -> None:
        self._operation_lock.release()


_OPERATION_LOCK_REGISTRY_GUARD = threading.Lock()
_OPERATION_LOCK_REGISTRY: weakref.WeakValueDictionary[
    tuple[int, int, str],
    _ReentrantProcessOperationLock,
] = weakref.WeakValueDictionary()


def _shared_operation_lock(
    directory_fd: int,
    name: str,
    *,
    deadline_monotonic: float | None = None,
    cancellation: threading.Event | None = None,
) -> _ReentrantProcessOperationLock:
    directory_stat = os.fstat(directory_fd)
    key = (directory_stat.st_dev, directory_stat.st_ino, name)
    _acquire_thread_lock(
        _OPERATION_LOCK_REGISTRY_GUARD,
        deadline_monotonic=deadline_monotonic,
        cancellation=cancellation,
    )
    try:
        operation_lock = _OPERATION_LOCK_REGISTRY.get(key)
        if operation_lock is None:
            operation_lock = _ReentrantProcessOperationLock(directory_fd, name)
            _OPERATION_LOCK_REGISTRY[key] = operation_lock
        return operation_lock
    finally:
        _OPERATION_LOCK_REGISTRY_GUARD.release()


class _FileLock:
    def __init__(self, directory_fd: int, name: str) -> None:
        self._directory_fd = directory_fd
        self._name = name
        self._descriptor: int | None = None

    def acquire(
        self,
        *,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> None:
        descriptor = _open_regular_file_at(
            self._directory_fd,
            self._name,
            os.O_RDWR | os.O_CREAT | os.O_APPEND,
            mode=0o600,
        )
        try:
            os.fchmod(descriptor, 0o600)
            import fcntl

            if deadline_monotonic is None and cancellation is None:
                fcntl.flock(descriptor, fcntl.LOCK_EX)
            else:
                while True:
                    _require_lock_budget(
                        deadline_monotonic=deadline_monotonic,
                        cancellation=cancellation,
                    )
                    try:
                        fcntl.flock(
                            descriptor,
                            fcntl.LOCK_EX | fcntl.LOCK_NB,
                        )
                        break
                    except BlockingIOError:
                        time.sleep(
                            _lock_poll_seconds(deadline_monotonic)
                        )
        except BaseException:
            os.close(descriptor)
            raise
        self._descriptor = descriptor

    def release(self) -> None:
        descriptor = self._descriptor
        if descriptor is None:
            return
        self._descriptor = None
        try:
            import fcntl

            fcntl.flock(descriptor, fcntl.LOCK_UN)
        finally:
            os.close(descriptor)


def _acquire_thread_lock(
    lock: threading.RLock,
    *,
    deadline_monotonic: float | None,
    cancellation: threading.Event | None,
) -> None:
    if deadline_monotonic is None and cancellation is None:
        lock.acquire()
        return
    while True:
        _require_lock_budget(
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )
        if lock.acquire(timeout=_lock_poll_seconds(deadline_monotonic)):
            return


def _require_lock_budget(
    *,
    deadline_monotonic: float | None,
    cancellation: threading.Event | None,
) -> None:
    if cancellation is not None and cancellation.is_set():
        raise MobileResourceLeaseDeadlineExceeded(
            "resource operation was cancelled while waiting for its lock"
        )
    if deadline_monotonic is None:
        return
    if (
        not isinstance(deadline_monotonic, (int, float))
        or isinstance(deadline_monotonic, bool)
        or not math.isfinite(deadline_monotonic)
    ):
        raise MobileResourceLeaseError(
            "resource operation deadline must be finite"
        )
    if time.monotonic() >= deadline_monotonic:
        raise MobileResourceLeaseDeadlineExceeded(
            "resource operation exceeded its lock deadline"
        )


def _lock_poll_seconds(deadline_monotonic: float | None) -> float:
    if deadline_monotonic is None:
        return 0.05
    return min(0.05, max(0.001, deadline_monotonic - time.monotonic()))


class _PersistentFileLock:
    def __init__(self, descriptor: int) -> None:
        self._descriptor = descriptor

    def acquire(
        self,
        *,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> None:
        import fcntl

        if deadline_monotonic is None and cancellation is None:
            fcntl.flock(self._descriptor, fcntl.LOCK_EX)
            return
        while True:
            _require_lock_budget(
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )
            try:
                fcntl.flock(
                    self._descriptor,
                    fcntl.LOCK_EX | fcntl.LOCK_NB,
                )
                return
            except BlockingIOError:
                time.sleep(_lock_poll_seconds(deadline_monotonic))

    def release(self) -> None:
        import fcntl

        fcntl.flock(self._descriptor, fcntl.LOCK_UN)


def _require_secure_posix_io() -> None:
    required_dir_fd_functions = (os.open, os.mkdir, os.stat, os.unlink)
    if (
        os.name != "posix"
        or not hasattr(os, "O_NOFOLLOW")
        or not hasattr(os, "O_DIRECTORY")
        or any(
            function not in os.supports_dir_fd
            for function in required_dir_fd_functions
        )
    ):
        raise MobileResourceLeaseError(
            "resource lease storage requires POSIX no-follow dirfd support"
        )


def _reject_symlink_components(path: Path) -> None:
    candidate = path.expanduser()
    if not candidate.is_absolute():
        candidate = Path.cwd() / candidate
    current = Path(candidate.anchor)
    for component in candidate.parts[1:]:
        current /= component
        try:
            mode = current.lstat().st_mode
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(mode):
            raise MobileResourceLeaseError(
                "resource lease storage path contains a symlink component"
            )


def _open_secure_directory_tree(path: Path) -> int:
    absolute = path.absolute()
    descriptor = os.open(
        absolute.anchor,
        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
    )
    try:
        for component in absolute.parts[1:]:
            try:
                child = os.open(
                    component,
                    os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                    dir_fd=descriptor,
                )
            except FileNotFoundError:
                try:
                    os.mkdir(component, mode=0o700, dir_fd=descriptor)
                except FileExistsError:
                    pass
                child = os.open(
                    component,
                    os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                    dir_fd=descriptor,
                )
            os.close(descriptor)
            descriptor = child
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def _open_or_create_directory_at(parent_fd: int, name: str) -> int:
    try:
        return os.open(
            name,
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
            dir_fd=parent_fd,
        )
    except FileNotFoundError:
        try:
            os.mkdir(name, mode=0o700, dir_fd=parent_fd)
        except FileExistsError:
            pass
        return os.open(
            name,
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
            dir_fd=parent_fd,
        )
    except OSError as error:
        raise MobileResourceLeaseError(
            "resource lease directory is not a no-follow directory"
        ) from error


def _open_regular_file_at(
    directory_fd: int,
    name: str,
    flags: int,
    *,
    mode: int = 0o600,
) -> int:
    try:
        descriptor = os.open(
            name,
            flags | os.O_NOFOLLOW,
            mode,
            dir_fd=directory_fd,
        )
    except OSError as error:
        if isinstance(error, FileNotFoundError):
            raise
        raise MobileResourceLeaseError(
            "resource lease state or lock open failed closed"
        ) from error
    file_mode = os.fstat(descriptor).st_mode
    if not stat.S_ISREG(file_mode):
        os.close(descriptor)
        raise MobileResourceLeaseError(
            "resource lease state or lock must be a regular file"
        )
    return descriptor


def _regular_file_exists_at(directory_fd: int, name: str) -> bool:
    try:
        descriptor = _open_regular_file_at(directory_fd, name, os.O_RDONLY)
    except FileNotFoundError:
        return False
    os.close(descriptor)
    return True


def _read_json_at(
    directory_fd: int,
    name: str,
    *,
    missing_message: str,
) -> Mapping[str, Any]:
    try:
        descriptor = _open_regular_file_at(directory_fd, name, os.O_RDONLY)
    except FileNotFoundError as error:
        raise MobileResourceLeaseError(missing_message) from error
    try:
        with os.fdopen(descriptor, "r", encoding="utf-8") as handle:
            value = json.load(handle)
    except MobileResourceLeaseError:
        raise
    except Exception as error:
        raise MobileResourceLeaseError(
            f"resource lease state file {name!r} is malformed"
        ) from error
    if not isinstance(value, Mapping):
        raise MobileResourceLeaseError(
            f"resource lease state file {name!r} is malformed"
        )
    return value


def _read_optional_json_at(
    directory_fd: int,
    name: str,
) -> Mapping[str, Any] | None:
    try:
        return _read_json_at(
            directory_fd,
            name,
            missing_message=f"resource lease state file {name!r} is missing",
        )
    except MobileResourceLeaseError as error:
        if not _regular_file_exists_at(directory_fd, name):
            return None
        raise error


def _atomic_write_json_at(
    directory_fd: int,
    name: str,
    value: Mapping[str, Any],
    failure_message: str,
) -> None:
    encoded = (
        json.dumps(value, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")
    temporary_name = f".{name}.tmp-{secrets.token_hex(8)}"
    descriptor: int | None = None
    try:
        descriptor = _open_regular_file_at(
            directory_fd,
            temporary_name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL,
            mode=0o600,
        )
        with os.fdopen(descriptor, "wb") as handle:
            descriptor = None
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(
            temporary_name,
            name,
            src_dir_fd=directory_fd,
            dst_dir_fd=directory_fd,
        )
        os.fsync(directory_fd)
    except OSError as error:
        if descriptor is not None:
            os.close(descriptor)
        try:
            os.unlink(temporary_name, dir_fd=directory_fd)
        except FileNotFoundError:
            pass
        raise MobileResourceLeaseError(failure_message) from error


def _exclusive_write_json_at(
    directory_fd: int,
    name: str,
    value: Mapping[str, Any],
    failure_message: str,
) -> None:
    encoded = (
        json.dumps(value, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")
    temporary_name = f".{name}.tmp-{secrets.token_hex(8)}"
    descriptor: int | None = None
    try:
        descriptor = _open_regular_file_at(
            directory_fd,
            temporary_name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL,
            mode=0o600,
        )
        with os.fdopen(descriptor, "wb") as handle:
            descriptor = None
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        os.link(
            temporary_name,
            name,
            src_dir_fd=directory_fd,
            dst_dir_fd=directory_fd,
            follow_symlinks=False,
        )
        os.fsync(directory_fd)
        os.unlink(temporary_name, dir_fd=directory_fd)
    except OSError as error:
        if descriptor is not None:
            os.close(descriptor)
        try:
            os.unlink(temporary_name, dir_fd=directory_fd)
        except FileNotFoundError:
            pass
        raise MobileResourceLeaseError(failure_message) from error


def _unlink_regular_file_at(
    directory_fd: int,
    name: str,
    failure_message: str,
) -> None:
    descriptor = _open_regular_file_at(directory_fd, name, os.O_RDONLY)
    os.close(descriptor)
    try:
        os.unlink(name, dir_fd=directory_fd)
        os.fsync(directory_fd)
    except OSError as error:
        raise MobileResourceLeaseError(failure_message) from error


def _canonical_compact_json_bytes(value: Mapping[str, Any]) -> bytes:
    return json.dumps(
        value,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def _ledger_state_mac(
    key: bytes,
    generation: int,
    previous_state_mac: str,
    payload: Mapping[str, Any],
) -> str:
    envelope = {
        "generation": generation,
        "previousStateMac": previous_state_mac,
        "state": payload,
    }
    digest = hmac.new(
        key,
        LEDGER_AUTH_DOMAIN + _canonical_compact_json_bytes(envelope),
        hashlib.sha256,
    ).hexdigest()
    return f"sha256:{digest}"


def _ledger_anchor_payload(
    key: bytes,
    generation: int,
    state_mac: str,
    *,
    previous_state_mac: str,
    previous_anchor_hash: str,
    ledger_hash: str,
) -> dict[str, Any]:
    authority = {
        "schema": LEDGER_SCHEMA,
        "version": LEDGER_VERSION,
        "authorityNamespace": LEDGER_AUTHORITY_NAMESPACE,
        "authorityId": LEDGER_AUTHORITY_ID,
        "generation": generation,
        "previousGeneration": generation - 1,
        "previousStateMac": previous_state_mac,
        "previousAnchorHash": previous_anchor_hash,
        "stateMac": state_mac,
        "ledgerHash": ledger_hash,
    }
    digest = hmac.new(
        key,
        LEDGER_ANCHOR_DOMAIN + _canonical_compact_json_bytes(authority),
        hashlib.sha256,
    ).hexdigest()
    return {
        **authority,
        "anchorMac": f"sha256:{digest}",
    }


def _verify_generation_anchor(
    key: bytes,
    anchor: Mapping[str, Any],
    *,
    expected_generation: int,
    previous_anchor: Mapping[str, Any] | None,
) -> None:
    try:
        generation = int(anchor["generation"])
        previous_generation = int(anchor["previousGeneration"])
        previous_state_mac = str(anchor["previousStateMac"])
        previous_anchor_hash = str(anchor["previousAnchorHash"])
        state_mac = str(anchor["stateMac"])
        ledger_hash = str(anchor["ledgerHash"])
        anchor_mac = str(anchor["anchorMac"])
    except (KeyError, TypeError, ValueError) as error:
        raise MobileResourceLeaseError(
            "resource lease ledger authentication anchor is malformed"
        ) from error
    expected_previous_generation = expected_generation - 1
    expected_previous_state_mac = (
        str(previous_anchor["stateMac"]) if previous_anchor is not None else ""
    )
    expected_previous_anchor_hash = (
        _generation_anchor_hash(previous_anchor)
        if previous_anchor is not None
        else ""
    )
    authority = {
        "schema": anchor.get("schema"),
        "version": anchor.get("version"),
        "authorityNamespace": anchor.get("authorityNamespace"),
        "authorityId": anchor.get("authorityId"),
        "generation": generation,
        "previousGeneration": previous_generation,
        "previousStateMac": previous_state_mac,
        "previousAnchorHash": previous_anchor_hash,
        "stateMac": state_mac,
        "ledgerHash": ledger_hash,
    }
    expected = _ledger_anchor_payload(
        key,
        generation,
        state_mac,
        previous_state_mac=previous_state_mac,
        previous_anchor_hash=previous_anchor_hash,
        ledger_hash=ledger_hash,
    )
    if (
        authority["schema"] != LEDGER_SCHEMA
        or authority["version"] != LEDGER_VERSION
        or authority["authorityNamespace"] != LEDGER_AUTHORITY_NAMESPACE
        or authority["authorityId"] != LEDGER_AUTHORITY_ID
        or isinstance(anchor.get("generation"), bool)
        or isinstance(anchor.get("previousGeneration"), bool)
        or generation != expected_generation
        or previous_generation != expected_previous_generation
        or not hmac.compare_digest(
            previous_state_mac,
            expected_previous_state_mac,
        )
        or not hmac.compare_digest(
            previous_anchor_hash,
            expected_previous_anchor_hash,
        )
        or not _is_sha256_mac(state_mac)
        or not _is_sha256_digest(ledger_hash)
        or not _is_sha256_mac(anchor_mac)
        or not hmac.compare_digest(anchor_mac, expected["anchorMac"])
    ):
        raise MobileResourceLeaseError(
            "resource lease ledger authentication failed"
        )


def _generation_anchor_name(generation: int) -> str:
    return f"{generation:020d}.json"


def _generation_anchor_hash(anchor: Mapping[str, Any]) -> str:
    digest = hashlib.sha256(_canonical_compact_json_bytes(anchor)).hexdigest()
    return f"sha256:{digest}"


def _ledger_payload_hash(payload: Mapping[str, Any]) -> str:
    digest = hashlib.sha256(_canonical_compact_json_bytes(payload)).hexdigest()
    return f"sha256:{digest}"


def _read_generation_anchor_chain(
    directory_fd: int,
    key: bytes,
) -> list[Mapping[str, Any]]:
    names = sorted(
        name
        for name in os.listdir(directory_fd)
        if not name.startswith(".")
    )
    anchors: list[Mapping[str, Any]] = []
    for expected_generation, name in enumerate(names, start=1):
        if name != _generation_anchor_name(expected_generation):
            raise MobileResourceLeaseError(
                "resource lease generation anchor chain has a deletion or gap"
            )
        anchor = _read_json_at(
            directory_fd,
            name,
            missing_message=(
                "resource lease generation anchor chain has a deletion or gap"
            ),
        )
        previous_anchor = anchors[-1] if anchors else None
        _verify_generation_anchor(
            key,
            anchor,
            expected_generation=expected_generation,
            previous_anchor=previous_anchor,
        )
        anchors.append(anchor)
    return anchors


def _write_generation_anchor_at(
    directory_fd: int,
    anchor: Mapping[str, Any],
) -> None:
    generation = int(anchor["generation"])
    _exclusive_write_json_at(
        directory_fd,
        _generation_anchor_name(generation),
        anchor,
        "resource lease generation anchor append failed",
    )


def _ledger_identity_or_empty(
    key: bytes,
    ledger: Mapping[str, Any] | None,
) -> tuple[int, str]:
    if ledger is None:
        return 0, ""
    payload = dict(ledger)
    authentication = payload.pop("authentication", None)
    if authentication is None:
        if _is_fresh_empty_ledger_payload(payload):
            return 0, ""
        raise MobileResourceLeaseError(
            "nonempty resource lease ledger is unsigned"
        )
    return ResourceLeaseLedger._verify_payload_authentication(
        key,
        payload,
        authentication,
    )


def _is_sha256_mac(value: str) -> bool:
    if not value.startswith("sha256:") or len(value) != 71:
        return False
    return all(character in "0123456789abcdef" for character in value[7:])


def _is_sha256_digest(value: str) -> bool:
    return _is_sha256_mac(value)


def _is_fresh_empty_ledger_payload(payload: Mapping[str, Any]) -> bool:
    return (
        payload.get("schema") == LEDGER_SCHEMA
        and payload.get("version") == LEDGER_VERSION
        and payload.get("authorityNamespace") == LEDGER_AUTHORITY_NAMESPACE
        and payload.get("authorityId") == LEDGER_AUTHORITY_ID
        and payload.get("physicalIdentityKeyId", "") == ""
        and payload.get("records") == {}
        and payload.get("fences") == {}
        and payload.get("acquisitionOrder") == []
        and payload.get("recoveryAudit", []) == []
    )


def _default_ledger_root() -> Path:
    return LEDGER_AUTHORITY_ROOT


def _record_to_dict(record: _LeaseRecord) -> dict[str, Any]:
    return {
        "kind": record.kind,
        "acquisition": record.acquisition,
        "acquisitionRef": (
            record.acquisition_ref.to_dict()
            if record.acquisition_ref is not None
            else None
        ),
        "artifactWorkspaceId": record.artifact_workspace_id,
        "expiresAt": _timestamp(record.expires_at),
        "state": record.state,
        "operationStarted": record.operation_started,
        "operationCompleted": record.operation_completed,
        "operationActive": record.operation_active,
        "maxObservedConcurrency": record.max_observed_concurrency,
        "fenceValidated": record.fence_validated,
        "outcome": record.outcome,
        "ownerPid": record.owner_pid,
        "quarantineReason": record.quarantine_reason,
        "physicalIdentityHmac": record.physical_identity_hmac,
        "providerExpectedIdentityHmac": (
            record.provider_expected_identity_hmac
        ),
        "providerIdentityVerified": record.provider_identity_verified,
        "providerIdentityAssertion": record.provider_identity_assertion,
        "pendingIdentityAssertion": record.pending_identity_assertion,
        "operationOwnerPid": record.operation_owner_pid,
        "operationIntent": record.operation_intent,
        "dependencies": [
            {
                "kind": dependency.kind,
                "resourceKey": dependency.identity.resource_key,
                "holderRunId": dependency.identity.holder_run_id,
                "fenceToken": dependency.identity.fence_token,
            }
            for dependency in record.dependencies
        ],
        "pendingOutcome": record.pending_outcome,
        "heartbeatHistory": [
            dict(entry) for entry in record.heartbeat_history
        ],
    }


def _record_from_dict(value: Mapping[str, Any]) -> _LeaseRecord:
    acquisition_ref = value["acquisitionRef"]
    return _LeaseRecord(
        kind=str(value["kind"]),
        acquisition=dict(value["acquisition"]),
        acquisition_ref=(
            ArtifactRef.from_dict(acquisition_ref)
            if acquisition_ref is not None
            else None
        ),
        artifact_workspace_id=str(value["artifactWorkspaceId"]),
        expires_at=_parse_timestamp(str(value["expiresAt"])),
        state=str(value["state"]),
        operation_started=int(value["operationStarted"]),
        operation_completed=int(value["operationCompleted"]),
        operation_active=int(value["operationActive"]),
        max_observed_concurrency=int(value["maxObservedConcurrency"]),
        fence_validated=bool(value["fenceValidated"]),
        outcome=dict(value["outcome"]) if value["outcome"] is not None else None,
        owner_pid=int(value["ownerPid"]),
        quarantine_reason=str(value["quarantineReason"]),
        physical_identity_hmac=str(value.get("physicalIdentityHmac", "")),
        provider_expected_identity_hmac=str(
            value.get("providerExpectedIdentityHmac", "")
        ),
        provider_identity_verified=bool(
            value.get("providerIdentityVerified", False)
        ),
        provider_identity_assertion=(
            dict(value["providerIdentityAssertion"])
            if value.get("providerIdentityAssertion") is not None
            else None
        ),
        pending_identity_assertion=(
            dict(value["pendingIdentityAssertion"])
            if value.get("pendingIdentityAssertion") is not None
            else None
        ),
        operation_owner_pid=int(value.get("operationOwnerPid", 0)),
        operation_intent=(
            dict(value["operationIntent"])
            if value.get("operationIntent") is not None
            else None
        ),
        dependencies=tuple(
            _LeaseDependency(
                kind=str(dependency["kind"]),
                identity=LeaseIdentity(
                    resource_key=str(dependency["resourceKey"]),
                    holder_run_id=str(dependency["holderRunId"]),
                    fence_token=int(dependency["fenceToken"]),
                ),
            )
            for dependency in value.get("dependencies", [])
        ),
        pending_outcome=(
            dict(value["pendingOutcome"])
            if value.get("pendingOutcome") is not None
            else None
        ),
        heartbeat_history=tuple(
            dict(entry) for entry in value["heartbeatHistory"]
        ),
    )


def _process_is_alive(pid: int) -> bool:
    if pid == os.getpid():
        return True
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _assert_durable_state_redacted(value: Mapping[str, Any]) -> None:
    encoded = json.dumps(value, sort_keys=True).lower()
    forbidden = (
        "devicehandles",
        "resolved_identifier",
        "provider_subject",
        "observedsubject",
        "expectedsubject",
        "correlationkey",
        "credentialvalue",
        "password",
        "udid",
        "serial",
    )
    if any(marker in encoded for marker in forbidden):
        raise MobileResourceLeaseError(
            "resource lease ledger contains forbidden sensitive material"
        )


class MobileResourceLeaseBroker:
    """Atomic run-exclusive lease owner for Mobile physical proof."""

    def __init__(
        self,
        *,
        run_handle: ArtifactWriter,
        correlation_secret: RunScopedCorrelationSecret,
        physical_identity_key: bytes | bytearray,
        artifact_writer_resolver: ArtifactWriterResolver,
        physical_device_resolver: PhysicalDeviceResolver | None = None,
        provider_expected_subjects: Mapping[str, str] | None = None,
        ledger: ResourceLeaseLedger | None = None,
        now: Callable[[], datetime] | None = None,
        artifact_workspace_id: str | None = None,
        gate_id: str = GATE_ID,
    ) -> None:
        self.run_handle = run_handle
        self.run_id = ""
        self.correlation_secret = correlation_secret
        self._physical_identity_key = bytearray()
        self.ledger = ledger
        self._closed = False
        self.gate_id = gate_id
        try:
            self.run_id = run_handle.run_id
            self._physical_identity_key = bytearray(physical_identity_key)
            if run_handle.gate_id != self.gate_id:
                raise MobileResourceLeaseError(
                    f"resource leases require gate {self.gate_id!r}"
                )
            if len(physical_identity_key) < 32:
                raise ValueError(
                    "physical identity broker key must contain at least 32 bytes"
                )
            if not callable(artifact_writer_resolver):
                raise MobileResourceLeaseError(
                    "original acquisition run artifact writer resolver is required"
                )
            self._physical_device_resolver = physical_device_resolver
            self._provider_expected_subjects = dict(
                provider_expected_subjects or {}
            )
            self._artifact_writer_resolver = artifact_writer_resolver
            self._artifact_workspace_id = (
                artifact_workspace_id or workspace_id(REPO_ROOT)
            )
            if (
                len(self._artifact_workspace_id) != 16
                or any(
                    character not in "0123456789abcdef"
                    for character in self._artifact_workspace_id
                )
            ):
                raise MobileResourceLeaseError(
                    "resource lease artifact workspace identity is invalid"
                )
            self.ledger = ledger or ResourceLeaseLedger()
            self.ledger.bind_authentication_key(self._physical_identity_key)
            self._now = now or (lambda: datetime.now(timezone.utc))
            physical_identity_key_id = "sha256:" + hashlib.sha256(
                bytes(self._physical_identity_key)
            ).hexdigest()
            with self.ledger.lock:
                self._validate_reconstructed_ledger()
                bound_key_id = self.ledger.physical_identity_key_id
                if not bound_key_id:
                    if self.ledger.records:
                        raise MobileResourceLeaseError(
                            "resource lease ledger has no physical identity key binding"
                        )
                    self.ledger.physical_identity_key_id = physical_identity_key_id
                elif not hmac.compare_digest(
                    bound_key_id,
                    physical_identity_key_id,
                ):
                    raise MobileResourceLeaseError(
                        "physical identity broker key does not match the ledger"
                    )
        except BaseException:
            self.close()
            raise

    def _validate_reconstructed_ledger(self) -> None:
        canonical_records: dict[str, tuple[_LeaseRecord, dict[str, Any]]] = {}
        for ledger_key, record in self.ledger.records.items():
            reference = record.acquisition_ref
            if reference is None:
                if record.state == "PENDING_PUBLICATION":
                    reference = self._recover_pending_acquisition_publication(
                        ledger_key,
                        record,
                    )
                if reference is None:
                    self._validate_unpublished_quarantine(ledger_key, record)
                    continue
            source = self._artifact_writer_resolver(reference)
            if source is None:
                raise MobileResourceLeaseError(
                    f"resource {ledger_key!r} immutable acquisition artifact "
                    "reader is unavailable"
                )
            try:
                encoded = _read_artifact_bytes(source, reference)
                if hashlib.sha256(encoded).hexdigest() != reference.sha256:
                    raise MobileResourceLeaseError(
                        f"resource {ledger_key!r} immutable acquisition hash "
                        "does not match"
                    )
                payload = json.loads(encoded.decode("utf-8"))
                if not isinstance(payload, Mapping):
                    raise MobileResourceLeaseError(
                        f"resource {ledger_key!r} immutable acquisition is not "
                        "an object"
                    )
                canonical_payload = validate_contract_payload(
                    payload,
                    expected_run_id=reference.run_id,
                    expected_gate_id=reference.gate_id,
                    expected_workspace_id=reference.workspace_id,
                )
                if encoded != _canonical_json_bytes(
                    canonical_payload,
                    redact=False,
                ):
                    raise MobileResourceLeaseError(
                        f"resource {ledger_key!r} immutable acquisition bytes "
                        "are not canonical"
                    )
                kind, resource_key, artifact_path = (
                    _canonical_acquisition_authority(canonical_payload)
                )
                _validate_json_artifact_reference(
                    reference,
                    gate_id=reference.gate_id,
                    run_id=str(canonical_payload["runId"]),
                    path=artifact_path,
                    value=canonical_payload,
                    redact=False,
                    expected_workspace_id=record.artifact_workspace_id,
                )
            except MobileResourceLeaseError:
                raise
            except BaseException as error:
                raise MobileResourceLeaseError(
                    f"resource {ledger_key!r} immutable acquisition validation "
                    "failed"
                ) from error
            if ledger_key != resource_key:
                raise MobileResourceLeaseError(
                    f"resource {ledger_key!r} ledger key does not match its "
                    "immutable acquisition"
                )
            if record.kind != kind:
                raise MobileResourceLeaseError(
                    f"resource {ledger_key!r} kind does not match its immutable "
                    "acquisition"
                )
            if record.acquisition != canonical_payload:
                raise MobileResourceLeaseError(
                    f"resource {ledger_key!r} ledger acquisition does not match "
                    "its immutable artifact"
                )
            self._validate_reconstructed_timing(
                ledger_key,
                record,
                canonical_payload,
            )
            self._validate_reconstructed_state(
                ledger_key,
                record,
                canonical_payload,
            )
            self._validate_heartbeat_history(
                ledger_key,
                record,
                canonical_payload,
            )
            fence = self.ledger.fences.get(resource_key)
            canonical_fence = canonical_payload.get("fenceToken")
            if (
                isinstance(fence, bool)
                or not isinstance(fence, int)
                or fence < 1
                or isinstance(canonical_fence, bool)
                or not isinstance(canonical_fence, int)
                or canonical_fence != fence
            ):
                raise LeaseFenceStale(
                    f"resource {resource_key!r} persisted fence is not current"
                )
            canonical_records[resource_key] = (record, canonical_payload)

        for resource_key, fence in self.ledger.fences.items():
            if isinstance(fence, bool) or not isinstance(fence, int) or fence < 1:
                raise MobileResourceLeaseError(
                    f"resource {resource_key!r} persisted fence is invalid"
                )
        for ordered_key in self.ledger.acquisition_order:
            if ordered_key not in self.ledger.fences:
                raise MobileResourceLeaseError(
                    f"resource {ordered_key!r} acquisition order has no fence"
                )

        for resource_key, (record, payload) in canonical_records.items():
            if record.kind == "provider-account":
                provider = str(payload["provider"])
                allowed_clients = tuple(payload["allowedClientIds"])
                if allowed_clients != PROVIDER_CLIENTS.get(provider):
                    raise MobileResourceLeaseError(
                        f"provider {provider!r} immutable client policy is invalid"
                    )
                expected_subject = self._provider_expected_subjects.get(provider)
                if expected_subject is None:
                    raise MobileResourceLeaseError(
                        f"provider {provider!r} expected identity is unavailable"
                    )
                expected_hmac = self._provider_expected_identity_hmac(
                    provider,
                    expected_subject,
                )
                if (
                    not record.provider_expected_identity_hmac
                    or not hmac.compare_digest(
                        record.provider_expected_identity_hmac,
                        expected_hmac,
                    )
                ):
                    raise LeaseBaselineMismatch(
                        f"provider {provider!r} expected identity binding changed"
                    )
            elif record.kind in {
                "physical-device",
                "provider-browser-session",
            }:
                client_id = str(payload["clientId"])
                if payload["platform"] != _client_platform(client_id):
                    raise MobileResourceLeaseError(
                        f"resource {resource_key!r} immutable platform binding "
                        "is invalid"
                    )

            if record.kind == "provider-browser-session":
                client_id = str(payload["clientId"])
                provider = CLIENT_PROVIDER[client_id]
                expected_dependencies = (
                    _LeaseDependency(
                        "physical-device",
                        self._canonical_record_identity(
                            canonical_records,
                            f"physical-device/{client_id}",
                            "physical-device",
                        ),
                    ),
                    _LeaseDependency(
                        "provider-account",
                        self._canonical_record_identity(
                            canonical_records,
                            f"provider-account/{provider}/disposable",
                            "provider-account",
                        ),
                    ),
                )
                if record.dependencies != expected_dependencies:
                    raise MobileResourceLeaseError(
                        f"resource {resource_key!r} dependencies do not match "
                        "canonical acquisitions"
                    )

    def _recover_pending_acquisition_publication(
        self,
        ledger_key: str,
        record: _LeaseRecord,
    ) -> ArtifactRef | None:
        acquisition_gate_id = str(record.acquisition.get("gateId") or "")
        payload = validate_contract_payload(
            record.acquisition,
            expected_run_id=str(record.acquisition.get("runId", "")),
            expected_gate_id=acquisition_gate_id,
            expected_workspace_id=record.artifact_workspace_id,
        )
        kind, resource_key, artifact_path = _canonical_acquisition_authority(
            payload
        )
        if ledger_key != resource_key or record.kind != kind:
            raise MobileResourceLeaseError(
                f"resource {ledger_key!r} pending acquisition authority is invalid"
            )
        expected_bytes = _canonical_json_bytes(payload, redact=False)
        reference = ArtifactRef(
            workspace_id=record.artifact_workspace_id,
            gate_id=acquisition_gate_id,
            run_id=str(payload["runId"]),
            path=artifact_path,
            sha256=hashlib.sha256(expected_bytes).hexdigest(),
            media_type="application/json",
        )
        try:
            source = self._artifact_writer_resolver(reference)
            if source is None:
                raise MobileResourceLeaseError(
                    "immutable acquisition artifact reader is unavailable"
                )
            observed_bytes = _read_artifact_bytes(source, reference)
        except Exception:
            self._quarantine_unpublished(
                record,
                "ACQUISITION_ARTIFACT_RECOVERY_UNAVAILABLE",
            )
            return None
        if (
            hashlib.sha256(observed_bytes).hexdigest() != reference.sha256
            or observed_bytes != expected_bytes
        ):
            self._quarantine_unpublished(
                record,
                "ACQUISITION_ARTIFACT_RECOVERY_MISMATCH",
            )
            return None
        record.acquisition_ref = reference
        record.state = str(payload["state"])
        record.quarantine_reason = ""
        return reference

    def _validate_unpublished_quarantine(
        self,
        ledger_key: str,
        record: _LeaseRecord,
    ) -> None:
        if (
            record.state != "QUARANTINED"
            or not record.quarantine_reason
            or record.outcome is not None
            or record.pending_outcome is not None
        ):
            raise MobileResourceLeaseError(
                f"resource {ledger_key!r} has no immutable acquisition artifact"
            )
        try:
            kind, resource_key, _ = _canonical_acquisition_authority(
                record.acquisition
            )
            canonical_fence = int(record.acquisition["fenceToken"])
        except (KeyError, TypeError, ValueError) as error:
            raise MobileResourceLeaseError(
                f"resource {ledger_key!r} unpublished quarantine is malformed"
            ) from error
        if (
            ledger_key != resource_key
            or record.kind != kind
            or self.ledger.fences.get(resource_key) != canonical_fence
        ):
            raise MobileResourceLeaseError(
                f"resource {ledger_key!r} unpublished quarantine authority is invalid"
            )

    @staticmethod
    def _validate_reconstructed_timing(
        resource_key: str,
        record: _LeaseRecord,
        payload: Mapping[str, Any],
    ) -> None:
        heartbeat_at = _parse_timestamp(str(payload["heartbeatAt"]))
        renew_before = _parse_timestamp(str(payload["renewBefore"]))
        immutable_expires_at = _parse_timestamp(str(payload["expiresAt"]))
        acquired_at_value = payload.get("acquiredAt")
        if (
            acquired_at_value is not None
            and _parse_timestamp(str(acquired_at_value)) != heartbeat_at
        ):
            raise MobileResourceLeaseError(
                f"resource {resource_key!r} immutable acquisition time is invalid"
            )
        if (
            renew_before != heartbeat_at + LEASE_DURATION / 2
            or immutable_expires_at != heartbeat_at + LEASE_DURATION
        ):
            raise MobileResourceLeaseError(
                f"resource {resource_key!r} immutable lease timing is invalid"
            )
        if record.expires_at < immutable_expires_at:
            raise MobileResourceLeaseError(
                f"resource {resource_key!r} mutable expiry predates "
                "its immutable acquisition"
            )

    @staticmethod
    def _validate_heartbeat_history(
        resource_key: str,
        record: _LeaseRecord,
        payload: Mapping[str, Any],
    ) -> None:
        identity = LeaseIdentity.from_payload(payload)
        immutable_expiry = _parse_timestamp(str(payload["expiresAt"]))
        previous_expiry = immutable_expiry
        previous_digest = _heartbeat_chain_root(identity, immutable_expiry)
        previous_heartbeat = _parse_timestamp(str(payload["heartbeatAt"]))
        for expected_sequence, entry in enumerate(
            record.heartbeat_history,
            start=1,
        ):
            try:
                sequence = int(entry["sequence"])
                heartbeat_at = _parse_timestamp(str(entry["heartbeatAt"]))
                entry_previous_expiry = _parse_timestamp(
                    str(entry["previousExpiresAt"])
                )
                expires_at = _parse_timestamp(str(entry["expiresAt"]))
                entry_previous_digest = str(entry["previousDigest"])
                digest = str(entry["digest"])
                entry_identity = LeaseIdentity(
                    resource_key=str(entry["resourceKey"]),
                    holder_run_id=str(entry["holderRunId"]),
                    fence_token=int(entry["fenceToken"]),
                )
            except (KeyError, TypeError, ValueError) as error:
                raise MobileResourceLeaseError(
                    f"resource {resource_key!r} heartbeat history is malformed"
                ) from error
            canonical_entry = {
                key: value for key, value in entry.items() if key != "digest"
            }
            expected_digest = _heartbeat_entry_digest(canonical_entry)
            if (
                sequence != expected_sequence
                or entry_identity != identity
                or heartbeat_at < previous_heartbeat
                or heartbeat_at >= previous_expiry
                or entry_previous_expiry != previous_expiry
                or expires_at != heartbeat_at + LEASE_DURATION
                or entry_previous_digest != previous_digest
                or not hmac.compare_digest(digest, expected_digest)
            ):
                raise MobileResourceLeaseError(
                    f"resource {resource_key!r} heartbeat history is invalid"
                )
            previous_heartbeat = heartbeat_at
            previous_expiry = expires_at
            previous_digest = digest
        if record.expires_at != previous_expiry:
            raise MobileResourceLeaseError(
                f"resource {resource_key!r} mutable expiry does not match "
                "its authenticated heartbeat history"
            )

    @staticmethod
    def _validate_reconstructed_state(
        resource_key: str,
        record: _LeaseRecord,
        payload: Mapping[str, Any],
    ) -> None:
        initial_state = str(payload["state"])
        if record.state == initial_state:
            if record.outcome is not None or record.pending_outcome is not None:
                raise MobileResourceLeaseError(
                    f"resource {resource_key!r} active state conflicts with "
                    "terminal state"
                )
        elif record.state == "PENDING_TERMINAL_PUBLICATION":
            if record.pending_outcome is None or record.outcome is not None:
                raise MobileResourceLeaseError(
                    f"resource {resource_key!r} pending terminal state is invalid"
                )
        elif record.state == "QUARANTINED":
            if (
                record.outcome is None
                or record.pending_outcome is not None
                or record.outcome.get("finalState") != "QUARANTINED"
            ):
                raise MobileResourceLeaseError(
                    f"resource {resource_key!r} quarantine state is invalid"
                )
        else:
            raise MobileResourceLeaseError(
                f"resource {resource_key!r} durable state is invalid"
            )

        if record.kind == "provider-account":
            verified = record.provider_identity_verified
            assertion = record.provider_identity_assertion
            pending = record.pending_identity_assertion
            if verified != (assertion is not None and pending is None):
                raise MobileResourceLeaseError(
                    f"resource {resource_key!r} provider verification state is "
                    "inconsistent"
                )
            for identity_payload in (assertion, pending):
                if identity_payload is None:
                    continue
                validated = validate_contract_payload(
                    identity_payload,
                    expected_kind="provider-identity-assertion",
                    expected_run_id=str(payload["runId"]),
                )
                if (
                    validated["provider"] != payload["provider"]
                    or validated["accountRef"] != payload["accountRef"]
                ):
                    raise MobileResourceLeaseError(
                        f"resource {resource_key!r} provider assertion authority "
                        "is invalid"
                    )
        elif (
            record.provider_expected_identity_hmac
            or record.provider_identity_verified
            or record.provider_identity_assertion is not None
            or record.pending_identity_assertion is not None
        ):
            raise MobileResourceLeaseError(
                f"resource {resource_key!r} carries provider-only authority"
            )

    @staticmethod
    def _canonical_record_identity(
        records: Mapping[str, tuple[_LeaseRecord, dict[str, Any]]],
        resource_key: str,
        expected_kind: str,
    ) -> LeaseIdentity:
        item = records.get(resource_key)
        if item is None or item[0].kind != expected_kind:
            raise MobileResourceLeaseError(
                f"resource {resource_key!r} canonical dependency is unavailable"
            )
        return LeaseIdentity.from_payload(item[1])

    def acquire_physical_device(
        self,
        client_id: str,
        *,
        heartbeat_at: datetime | None = None,
    ) -> dict[str, Any]:
        platform = _client_platform(client_id)
        resource_key = f"physical-device/{client_id}"
        heartbeat = _utc(heartbeat_at or self._now())
        handle = self._resolve_physical_device(client_id)
        checks = self._validate_physical_device_facts(client_id, handle)
        identity_hmac = self._physical_identity_hmac(handle)
        with self.ledger.operation_lock(resource_key):
            with self.ledger.lock:
                self._require_resource_available(resource_key)
                if any(
                    hmac.compare_digest(
                        record.physical_identity_hmac,
                        identity_hmac,
                    )
                    for record in self.ledger.records.values()
                    if record.physical_identity_hmac
                ):
                    raise LeaseConflict(
                        "physical device is already bound to another client lease"
                    )
                payload = {
                    **self._lease_header(resource_key, f"device-{client_id}"),
                    "artifactKind": "physical-device-lease",
                    "clientId": client_id,
                    "platform": platform,
                    "physicalDeviceRef": f"device-ref/{client_id}",
                    "destinationClassRef": f"{platform}-physical",
                    "brokerRef": "mobile-physical-device-broker",
                    "checks": checks,
                    "heartbeatAt": _timestamp(heartbeat),
                    "renewBefore": _timestamp(heartbeat + LEASE_DURATION / 2),
                    "acquiredAt": _timestamp(heartbeat),
                    "expiresAt": _timestamp(heartbeat + LEASE_DURATION),
                    "state": "BASELINE_VERIFIED",
                    "quarantineReason": "",
                    "releaseEvidence": None,
                }
                return self._acquire(
                    resource_key,
                    "physical-device",
                    payload,
                    heartbeat + LEASE_DURATION,
                    f"runtime/mobile/leases/devices/{client_id}.json",
                    physical_identity_hmac=identity_hmac,
                )

    def acquire_provider_account(
        self,
        provider: str,
        *,
        heartbeat_at: datetime | None = None,
    ) -> dict[str, Any]:
        allowed_clients = PROVIDER_CLIENTS.get(provider)
        if allowed_clients is None:
            raise MobileResourceLeaseError(
                f"provider {provider!r} is not declared"
            )
        if not self._provider_expected_subjects.get(provider):
            raise MobileResourceLeaseError(
                f"provider {provider!r} expected identity is unavailable"
            )
        heartbeat = _utc(heartbeat_at or self._now())
        resource_key = f"provider-account/{provider}/disposable"
        expected_identity_hmac = self._provider_expected_identity_hmac(
            provider,
            self._provider_expected_subjects[provider],
        )
        with self.ledger.operation_lock(resource_key):
            with self.ledger.lock:
                self._require_resource_available(resource_key)
                payload = {
                    **self._lease_header(
                        resource_key,
                        f"account-{provider}",
                    ),
                    "artifactKind": "provider-account-lease",
                    "provider": provider,
                    "accountRef": f"{provider}-disposable-account",
                    "allowedClientIds": list(allowed_clients),
                    "maxConcurrentAuthorizations": 1,
                    "heartbeatAt": _timestamp(heartbeat),
                    "renewBefore": _timestamp(
                        heartbeat + LEASE_DURATION / 2
                    ),
                    "state": "LEASED",
                    "acquiredAt": _timestamp(heartbeat),
                    "expiresAt": _timestamp(heartbeat + LEASE_DURATION),
                    "quarantineReason": "",
                    "releaseEvidence": None,
                }
                return self._acquire(
                    resource_key,
                    "provider-account",
                    payload,
                    heartbeat + LEASE_DURATION,
                    f"runtime/mobile/leases/accounts/{provider}.json",
                    provider_expected_identity_hmac=expected_identity_hmac,
                )

    def acquire_browser_session(
        self,
        client_id: str,
        *,
        physical_device_lease: Mapping[str, Any],
        provider_account_lease: Mapping[str, Any],
        verify_baseline: Callable[
            [LeaseIdentity, LeaseIdentity],
            BrowserBaselineVerificationResult,
        ],
        heartbeat_at: datetime | None = None,
    ) -> dict[str, Any]:
        platform = _client_platform(client_id)
        provider = CLIENT_PROVIDER[client_id]
        heartbeat = _utc(heartbeat_at or self._now())
        resource_key = f"physical-device/{client_id}/browser/default"
        device_key = f"physical-device/{client_id}"
        account_key = f"provider-account/{provider}/disposable"
        dependencies: tuple[_LeaseDependency, ...]
        with ExitStack() as locks:
            for locked_key in sorted((resource_key, device_key, account_key)):
                locks.enter_context(self.ledger.operation_lock(locked_key))
            with self.ledger.lock:
                self._require_resource_available(resource_key)
                device_record = self._require_dependency(
                    device_key,
                    physical_device_lease,
                    expected_kind="physical-device",
                    observed_at=heartbeat,
                )
                account_record = self._require_dependency(
                    account_key,
                    provider_account_lease,
                    expected_kind="provider-account",
                    observed_at=heartbeat,
                )
                if not account_record.provider_identity_verified:
                    raise LeaseBaselineMismatch(
                        f"provider {provider!r} identity is not verified"
                    )
                device_identity = LeaseIdentity.from_payload(
                    device_record.acquisition
                )
                account_identity = LeaseIdentity.from_payload(
                    account_record.acquisition
                )
                payload = {
                    **self._lease_header(
                        resource_key,
                        f"browser-{client_id}",
                    ),
                    "artifactKind": "provider-browser-session-lease",
                    "clientId": client_id,
                    "platform": platform,
                    "physicalDeviceLeaseRef": (
                        f"physical-device-lease/{client_id}"
                    ),
                    "browserProfileRef": f"browser-profile/{client_id}",
                    "providerAccountLeaseRef": (
                        f"provider-account-lease/{provider}"
                    ),
                    "baseline": "preauthenticated-exclusive",
                    "checks": {
                        "expectedIdentityMatched": False,
                        "authorizationInProgress": True,
                        "mobileOAuthStateAbsent": False,
                        "stationRunStateAbsent": False,
                    },
                    "cleanupPolicy": "preserve-login-verify-identity",
                    "heartbeatAt": _timestamp(heartbeat),
                    "renewBefore": _timestamp(
                        heartbeat + LEASE_DURATION / 2
                    ),
                    "expiresAt": _timestamp(heartbeat + LEASE_DURATION),
                    "state": "BASELINE_VERIFIED",
                    "quarantineReason": "",
                    "releaseEvidence": None,
                }
                dependencies = (
                    _LeaseDependency("physical-device", device_identity),
                    _LeaseDependency("provider-account", account_identity),
                )
                reservation = self._reserve(
                    resource_key,
                    "provider-browser-session",
                    payload,
                    heartbeat + LEASE_DURATION,
                    dependencies=dependencies,
                    state="PENDING_BASELINE",
                    validate_payload=False,
                )
            try:
                verification = verify_baseline(
                    device_identity,
                    account_identity,
                )
            except BaseException:
                with self.ledger.lock:
                    self._quarantine_reserved_browser(
                        reservation,
                        "BROWSER_BASELINE_CALLBACK_FAILED",
                    )
                raise
            if not isinstance(
                verification,
                BrowserBaselineVerificationResult,
            ):
                with self.ledger.lock:
                    self._quarantine_reserved_browser(
                        reservation,
                        "BROWSER_BASELINE_CALLBACK_INVALID",
                    )
                raise MobileResourceLeaseError(
                    "browser baseline verifier must return "
                    "BrowserBaselineVerificationResult"
                )
            if (
                not verification.expected_identity_matched
                or verification.authorization_in_progress
                or not verification.mobile_oauth_state_absent
                or not verification.station_run_state_absent
            ):
                with self.ledger.lock:
                    self._quarantine_reserved_browser(
                        reservation,
                        "BROWSER_BASELINE_MISMATCH",
                    )
                raise LeaseBaselineMismatch(
                    f"browser baseline for {client_id!r} is not verified"
                )
            payload["checks"] = {
                "expectedIdentityMatched": (
                    verification.expected_identity_matched
                ),
                "authorizationInProgress": (
                    verification.authorization_in_progress
                ),
                "mobileOAuthStateAbsent": (
                    verification.mobile_oauth_state_absent
                ),
                "stationRunStateAbsent": (
                    verification.station_run_state_absent
                ),
            }
            with self.ledger.lock:
                try:
                    reservation = self._validate_reserved_browser(
                        reservation,
                        observed_at=_utc(self._now()),
                    )
                except BaseException:
                    self._quarantine_reserved_browser(
                        reservation,
                        "BROWSER_BASELINE_REVALIDATION_FAILED",
                    )
                    raise
                reservation.acquisition = dict(payload)
                reservation.state = "PENDING_PUBLICATION"
                self.ledger._persist()
                return self._publish_acquisition(
                    reservation,
                    f"runtime/mobile/leases/browsers/{client_id}.json",
                )

    def heartbeat(
        self,
        lease: Mapping[str, Any],
        *,
        heartbeat_at: datetime | None = None,
    ) -> None:
        heartbeat = _utc(heartbeat_at or self._now())
        with self.ledger.operation_lock(str(lease["resourceKey"])):
            with self.ledger.lock:
                record = self._validate_operation(lease, heartbeat)
                identity = LeaseIdentity.from_payload(record.acquisition)
                previous_digest = (
                    record.heartbeat_history[-1]["digest"]
                    if record.heartbeat_history
                    else _heartbeat_chain_root(
                        identity,
                        _parse_timestamp(str(record.acquisition["expiresAt"])),
                    )
                )
                entry_without_digest = {
                    "sequence": len(record.heartbeat_history) + 1,
                    "resourceKey": identity.resource_key,
                    "holderRunId": identity.holder_run_id,
                    "fenceToken": identity.fence_token,
                    "heartbeatAt": _timestamp(heartbeat),
                    "previousExpiresAt": _timestamp(record.expires_at),
                    "expiresAt": _timestamp(heartbeat + LEASE_DURATION),
                    "previousDigest": previous_digest,
                }
                record.heartbeat_history = (
                    *record.heartbeat_history,
                    {
                        **entry_without_digest,
                        "digest": _heartbeat_entry_digest(
                            entry_without_digest
                        ),
                    },
                )
                record.expires_at = heartbeat + LEASE_DURATION

    def with_physical_device(
        self,
        lease: Mapping[str, Any],
        operation: Callable[[ResolvedPhysicalDeviceHandle], _T],
        *,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> _T:
        resource_key = str(lease["resourceKey"])
        operation_lock = self.ledger.operation_lock(
            resource_key,
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )
        lock_context = (
            operation_lock
            if deadline_monotonic is None and cancellation is None
            else operation_lock.bounded(
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )
        )
        with lock_context:
            ledger_lock = (
                self.ledger.lock
                if deadline_monotonic is None and cancellation is None
                else self.ledger.lock.bounded(
                    deadline_monotonic=deadline_monotonic,
                    cancellation=cancellation,
                )
            )
            with ledger_lock:
                record = self._validate_operation(lease, _utc(self._now()))
                if record.kind != "physical-device":
                    raise MobileResourceLeaseError(
                        "physical operation requires a physical-device lease"
                    )
                client_id = str(record.acquisition["clientId"])
                try:
                    handle = self._resolve_physical_device(client_id)
                    self._validate_physical_device_facts(client_id, handle)
                except BaseException as error:
                    failure_code = self._physical_device_failure_code(error)
                    self._terminalize(
                        record,
                        failure_code=failure_code,
                        cleanup_completed=False,
                        baseline_restored=False,
                        identity_reverified=False,
                        observed_at=_utc(self._now()),
                    )
                    raise
                if not hmac.compare_digest(
                    record.physical_identity_hmac,
                    self._physical_identity_hmac(handle),
                ):
                    self._terminalize(
                        record,
                        failure_code="LEASE_IDENTITY_MISMATCH",
                        cleanup_completed=False,
                        baseline_restored=False,
                        identity_reverified=False,
                        observed_at=_utc(self._now()),
                    )
                    raise LeaseBaselineMismatch(
                        f"physical device identity for {client_id!r} changed"
                    )
                operation_id = self._begin_external_operation(
                    record,
                    lease,
                    operation_kind="physical-device-callback",
                    details={"clientId": client_id},
                )
            try:
                _require_lock_budget(
                    deadline_monotonic=deadline_monotonic,
                    cancellation=cancellation,
                )
                result = operation(handle)
            except BaseException:
                try:
                    self._quarantine_interrupted_operation(
                        resource_key,
                        lease,
                        operation_id,
                        deadline_monotonic=deadline_monotonic,
                        cancellation=cancellation,
                    )
                except MobileResourceLeaseDeadlineExceeded:
                    pass
                raise
            try:
                completion_lock = (
                    self.ledger.lock
                    if deadline_monotonic is None and cancellation is None
                    else self.ledger.lock.bounded(
                        deadline_monotonic=deadline_monotonic,
                        cancellation=cancellation,
                    )
                )
                with completion_lock:
                    current = self._validate_operation(lease, _utc(self._now()))
                    if current.kind != "physical-device":
                        self._quarantine_current_operation(
                            current,
                            lease,
                            operation_id,
                        )
                        raise MobileResourceLeaseError(
                            "physical operation lease kind changed"
                        )
                    self._complete_external_operation(
                        current,
                        lease,
                        operation_id,
                    )
            except BaseException:
                try:
                    self._quarantine_interrupted_operation(
                        resource_key,
                        lease,
                        operation_id,
                        deadline_monotonic=deadline_monotonic,
                        cancellation=cancellation,
                    )
                except MobileResourceLeaseDeadlineExceeded:
                    pass
                raise
            return result

    def operate_browser_session(
        self,
        lease: Mapping[str, Any],
        operation: Callable[[], _T],
    ) -> _T:
        resource_key = str(lease["resourceKey"])
        with self._browser_operation_locks(lease):
            with self.ledger.lock:
                record = self._validate_browser_operation(
                    lease,
                    _utc(self._now()),
                )
                operation_id = self._begin_external_operation(
                    record,
                    lease,
                    operation_kind="browser-session-callback",
                )
            try:
                result = operation()
            except BaseException:
                self._quarantine_interrupted_operation(
                    resource_key,
                    lease,
                    operation_id,
                )
                raise
            try:
                with self.ledger.lock:
                    current = self._validate_browser_operation(
                        lease,
                        _utc(self._now()),
                    )
                    self._complete_external_operation(
                        current,
                        lease,
                        operation_id,
                    )
            except BaseException:
                self._quarantine_interrupted_operation(
                    resource_key,
                    lease,
                    operation_id,
                )
                raise
            return result

    def authorize_provider(
        self,
        account_lease: Mapping[str, Any],
        *,
        client_id: str,
        operation: Callable[[], _T],
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> _T:
        operation_lock = self.ledger.operation_lock(
            str(account_lease["resourceKey"]),
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )
        lock_context = (
            operation_lock
            if deadline_monotonic is None and cancellation is None
            else operation_lock.bounded(
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )
        )
        with lock_context:
            resource_key = str(account_lease["resourceKey"])
            ledger_lock = (
                self.ledger.lock
                if deadline_monotonic is None and cancellation is None
                else self.ledger.lock.bounded(
                    deadline_monotonic=deadline_monotonic,
                    cancellation=cancellation,
                )
            )
            with ledger_lock:
                record = self._validate_operation(
                    account_lease,
                    _utc(self._now()),
                )
                if record.kind != "provider-account":
                    raise MobileResourceLeaseError(
                        "provider authorization requires an account lease"
                    )
                provider = str(record.acquisition["provider"])
                allowed_clients = tuple(record.acquisition["allowedClientIds"])
                if client_id not in allowed_clients:
                    raise LeaseBaselineMismatch(
                        f"client {client_id!r} is not bound to provider "
                        f"{provider!r}"
                    )
                if not record.provider_identity_verified:
                    raise LeaseBaselineMismatch(
                        f"provider {provider!r} identity is not verified"
                    )
                operation_id = self._begin_external_operation(
                    record,
                    account_lease,
                    operation_kind="provider-authorization-callback",
                    details={
                        "provider": provider,
                        "clientId": client_id,
                    },
                    count_for_summary=True,
                )
            try:
                _require_lock_budget(
                    deadline_monotonic=deadline_monotonic,
                    cancellation=cancellation,
                )
                result = operation()
            except BaseException:
                try:
                    self._quarantine_interrupted_operation(
                        resource_key,
                        account_lease,
                        operation_id,
                        deadline_monotonic=deadline_monotonic,
                        cancellation=cancellation,
                    )
                except MobileResourceLeaseDeadlineExceeded:
                    pass
                raise
            try:
                completion_lock = (
                    self.ledger.lock
                    if deadline_monotonic is None and cancellation is None
                    else self.ledger.lock.bounded(
                        deadline_monotonic=deadline_monotonic,
                        cancellation=cancellation,
                    )
                )
                with completion_lock:
                    current = self._validate_operation(
                        account_lease,
                        _utc(self._now()),
                    )
                    self._complete_external_operation(
                        current,
                        account_lease,
                        operation_id,
                    )
            except BaseException:
                try:
                    self._quarantine_interrupted_operation(
                        resource_key,
                        account_lease,
                        operation_id,
                        deadline_monotonic=deadline_monotonic,
                        cancellation=cancellation,
                    )
                except MobileResourceLeaseDeadlineExceeded:
                    pass
                raise
            return result

    def provider_identity_assertion(
        self,
        account_lease: Mapping[str, Any],
        *,
        observed_subject: str,
        observed_at: datetime | None = None,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> dict[str, Any]:
        resource_key = str(account_lease["resourceKey"])
        operation_lock = self.ledger.operation_lock(
            resource_key,
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )
        with operation_lock.bounded(
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        ) if deadline_monotonic is not None else operation_lock:
            ledger_lock = (
                self.ledger.lock.bounded(
                    deadline_monotonic=deadline_monotonic,
                    cancellation=cancellation,
                )
                if deadline_monotonic is not None
                else self.ledger.lock
            )
            with ledger_lock:
                record = self._validate_operation(
                    account_lease,
                    _utc(self._now()),
                )
                if record.kind != "provider-account":
                    raise MobileResourceLeaseError(
                        "provider identity assertion requires an account lease"
                    )
                provider = str(record.acquisition["provider"])
                expected_subject = self._provider_expected_subjects.get(provider)
                if expected_subject is None:
                    raise MobileResourceLeaseError(
                        f"provider {provider!r} expected identity is unavailable"
                    )
                expected_identity_hmac = self._provider_expected_identity_hmac(
                    provider,
                    expected_subject,
                )
                if not hmac.compare_digest(
                    record.provider_expected_identity_hmac,
                    expected_identity_hmac,
                ):
                    raise LeaseBaselineMismatch(
                        f"provider {provider!r} expected identity binding changed"
                    )
                if not hmac.compare_digest(
                    observed_subject,
                    expected_subject,
                ):
                    self._terminalize(
                        record,
                        failure_code="LEASE_IDENTITY_MISMATCH",
                        cleanup_completed=False,
                        baseline_restored=False,
                        identity_reverified=False,
                        observed_at=_utc(observed_at or self._now()),
                    )
                    raise LeaseBaselineMismatch(
                        f"provider {provider!r} identity did not match"
                    )
                writer = self._writer_for(record)
                run_id = str(record.acquisition["runId"])
                if record.provider_identity_verified:
                    if record.provider_identity_assertion is None:
                        raise MobileResourceLeaseError(
                            "verified provider identity assertion is unavailable"
                        )
                    return dict(record.provider_identity_assertion)
                if record.pending_identity_assertion is None:
                    fingerprint = self.correlation_secret.fingerprint(
                        provider,
                        observed_subject,
                    )
                    payload = {
                        "artifactKind": "provider-identity-assertion",
                        "runId": run_id,
                        "gateId": self.gate_id,
                        "provider": provider,
                        "accountRef": record.acquisition["accountRef"],
                        "providerSubjectFingerprint": fingerprint,
                        "identityMatched": True,
                        "observedAt": _timestamp(
                            _utc(observed_at or self._now())
                        ),
                    }
                    validate_contract_payload(
                        payload,
                        expected_run_id=run_id,
                        expected_gate_id=self.gate_id,
                    )
                    record.pending_identity_assertion = dict(payload)
                else:
                    payload = dict(record.pending_identity_assertion)
                validate_contract_payload(
                    payload,
                    expected_run_id=run_id,
                    expected_gate_id=self.gate_id,
                )
                if (
                    payload["provider"] != provider
                    or payload["accountRef"] != record.acquisition["accountRef"]
                ):
                    raise MobileResourceLeaseError(
                        "pending provider identity assertion is inconsistent"
                    )
            _require_lock_budget(
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )
            identity_path = (
                f"runtime/mobile/identities/providers/{provider}.json"
            )
            identity_reference = writer.write_json(
                identity_path,
                payload,
                role=_artifact_role_instance(
                    "provider-identity-assertion",
                    provider,
                ),
            )
            _validate_json_artifact_reference(
                identity_reference,
                gate_id=self.gate_id,
                run_id=run_id,
                path=identity_path,
                value=payload,
                expected_workspace_id=record.artifact_workspace_id,
            )
            _require_lock_budget(
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )
            completion_lock = (
                self.ledger.lock.bounded(
                    deadline_monotonic=deadline_monotonic,
                    cancellation=cancellation,
                )
                if deadline_monotonic is not None
                else self.ledger.lock
            )
            with completion_lock:
                record = self._validate_operation(
                    account_lease,
                    _utc(self._now()),
                )
                if record.pending_identity_assertion != payload:
                    raise LeaseFenceStale(
                        f"provider {provider!r} identity assertion changed"
                    )
                record.provider_identity_verified = True
                record.provider_identity_assertion = dict(payload)
                record.pending_identity_assertion = None
                return payload

    def release(
        self,
        lease: Mapping[str, Any],
        *,
        restore: Callable[[], BaselineRestoreResult],
        observed_at: datetime | None = None,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> dict[str, Any]:
        resource_key = str(lease["resourceKey"])
        with self._lease_operation_locks(
            lease,
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        ):
            ledger_lock = (
                self.ledger.lock.bounded(
                    deadline_monotonic=deadline_monotonic,
                    cancellation=cancellation,
                )
                if deadline_monotonic is not None
                else self.ledger.lock
            )
            with ledger_lock:
                record = self._record(resource_key)
                self._require_exact_lease_tuple(record, lease)
                if record.pending_outcome is not None:
                    return self._terminalize(
                        record,
                        failure_code="",
                        cleanup_completed=False,
                        baseline_restored=False,
                        identity_reverified=False,
                        observed_at=_utc(observed_at or self._now()),
                    )
                if record.kind == "provider-browser-session":
                    self._validate_browser_operation(
                        lease,
                        _utc(self._now()),
                    )
                else:
                    self._validate_operation(lease, _utc(self._now()))
                cleanup_operation_id = self._begin_external_operation(
                    record,
                    lease,
                    operation_kind="baseline-restore-callback",
                )
            try:
                _require_lock_budget(
                    deadline_monotonic=deadline_monotonic,
                    cancellation=cancellation,
                )
                result = restore()
            except BaseException as error:
                self._quarantine_interrupted_operation(
                    resource_key,
                    lease,
                    cleanup_operation_id,
                    failure_code="LEASE_CLEANUP_FAILED",
                    observed_at=_utc(observed_at or self._now()),
                    deadline_monotonic=deadline_monotonic,
                    cancellation=cancellation,
                )
                if isinstance(error, MobileResourceLeaseDeadlineExceeded):
                    raise
                raise MobileResourceLeaseError(
                    "baseline restore failed and quarantined the resource"
                ) from error
            if not isinstance(result, BaselineRestoreResult):
                self._quarantine_interrupted_operation(
                    resource_key,
                    lease,
                    cleanup_operation_id,
                    failure_code="LEASE_CLEANUP_FAILED",
                    observed_at=_utc(observed_at or self._now()),
                    deadline_monotonic=deadline_monotonic,
                    cancellation=cancellation,
                )
                raise MobileResourceLeaseError(
                    "baseline restore must return BaselineRestoreResult"
                )
            _require_lock_budget(
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )
            completion_lock = (
                self.ledger.lock.bounded(
                    deadline_monotonic=deadline_monotonic,
                    cancellation=cancellation,
                )
                if deadline_monotonic is not None
                else self.ledger.lock
            )
            with completion_lock:
                if record.kind == "provider-browser-session":
                    record = self._validate_browser_operation(
                        lease,
                        _utc(self._now()),
                    )
                else:
                    record = self._validate_operation(
                        lease,
                        _utc(self._now()),
                    )
                self._complete_external_operation(
                    record,
                    lease,
                    cleanup_operation_id,
                )
                failure_code = ""
                if not result.cleanup_completed:
                    failure_code = "LEASE_CLEANUP_FAILED"
                elif not result.baseline_restored:
                    failure_code = "LEASE_BASELINE_RESTORE_FAILED"
                elif not result.identity_reverified:
                    failure_code = "LEASE_IDENTITY_MISMATCH"
                elif (
                    record.kind == "provider-account"
                    and record.operation_started != record.operation_completed
                ):
                    failure_code = "LEASE_OPERATION_INCOMPLETE"
                return self._terminalize(
                    record,
                    failure_code=failure_code,
                    cleanup_completed=result.cleanup_completed,
                    baseline_restored=result.baseline_restored,
                    identity_reverified=result.identity_reverified,
                    observed_at=_utc(observed_at or self._now()),
                )

    def quarantine(
        self,
        lease: Mapping[str, Any],
        failure_code: str,
        *,
        observed_at: datetime | None = None,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> dict[str, Any]:
        resource_key = str(lease["resourceKey"])
        operation_lock = self.ledger.operation_lock(
            resource_key,
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        )
        with operation_lock.bounded(
            deadline_monotonic=deadline_monotonic,
            cancellation=cancellation,
        ) if deadline_monotonic is not None else operation_lock:
            ledger_lock = (
                self.ledger.lock.bounded(
                    deadline_monotonic=deadline_monotonic,
                    cancellation=cancellation,
                )
                if deadline_monotonic is not None
                else self.ledger.lock
            )
            with ledger_lock:
                record = self._record(resource_key)
                if (
                    str(lease.get("holderRunId", "")) != self.run_id
                    or str(lease.get("runId", "")) != self.run_id
                ):
                    raise LeaseConflict(
                        f"resource {resource_key!r} belongs to another holder run"
                    )
                if not self._lease_tuple_matches(record, lease):
                    raise LeaseFenceStale(
                        f"resource {resource_key!r} quarantine fence is stale"
                    )
                if record.outcome is not None:
                    return dict(record.outcome)
                self._validate_operation(
                    lease,
                    _utc(observed_at or self._now()),
                )
                return self._terminalize(
                    record,
                    failure_code=failure_code,
                    cleanup_completed=False,
                    baseline_restored=False,
                    identity_reverified=False,
                    observed_at=_utc(observed_at or self._now()),
                )

    def quarantine_expired(
        self,
        *,
        observed_at: datetime | None = None,
    ) -> tuple[dict[str, Any], ...]:
        now = _utc(observed_at or self._now())
        with self.ledger.lock:
            resource_keys = tuple(self.ledger.acquisition_order)
        outcomes = []
        for resource_key in resource_keys:
            with self.ledger.operation_lock(resource_key):
                with self.ledger.lock:
                    record = self.ledger.records.get(resource_key)
                    if (
                        record is not None
                        and record.outcome is None
                        and (
                            now >= record.expires_at
                            or self._owner_is_dead(record)
                            or self._operation_owner_is_dead(record)
                        )
                    ):
                        if record.acquisition_ref is None:
                            self._quarantine_unpublished(
                                record,
                                "ACQUISITION_OWNER_LOST_DURING_PUBLICATION",
                            )
                            continue
                        outcomes.append(
                            self._terminalize(
                                record,
                                failure_code="LEASE_HEARTBEAT_EXPIRED",
                                cleanup_completed=False,
                                baseline_restored=False,
                                identity_reverified=False,
                                observed_at=now,
                            )
                        )
        return tuple(outcomes)

    def recover_quarantined(
        self,
        resource_key: str,
        *,
        restore_and_reverify: Callable[
            [LeaseIdentity, str],
            BaselineRestoreResult,
        ],
    ) -> None:
        with self.ledger.operation_lock(resource_key):
            with self.ledger.lock:
                record = self._record(resource_key)
                self._terminalize_dead_owner(record, _utc(self._now()))
                if record.state != "QUARANTINED":
                    raise MobileResourceLeaseError(
                        f"resource {resource_key!r} is not durably quarantined"
                    )
                identity = LeaseIdentity.from_payload(record.acquisition)
                audit = self._started_recovery(identity)
                if audit is None:
                    recovery_id = secrets.token_hex(16)
                    audit = {
                        "recoveryId": recovery_id,
                        "resourceKey": identity.resource_key,
                        "holderRunId": identity.holder_run_id,
                        "fenceToken": identity.fence_token,
                        "state": "STARTED",
                        "ownerPid": os.getpid(),
                        "startedAt": _timestamp(_utc(self._now())),
                        "lastResumedAt": None,
                        "resumeCount": 0,
                        "completedAt": None,
                        "cleanupCompleted": False,
                        "baselineRestored": False,
                        "identityReverified": False,
                    }
                    self.ledger.recovery_audit.append(audit)
                else:
                    recovery_id = str(audit["recoveryId"])
                    owner_pid = int(audit.get("ownerPid", 0))
                    if owner_pid > 0 and _process_is_alive(owner_pid):
                        raise LeaseConflict(
                            f"resource {resource_key!r} recovery is active"
                        )
                    audit["ownerPid"] = os.getpid()
                    audit["lastResumedAt"] = _timestamp(_utc(self._now()))
                    audit["resumeCount"] = int(audit.get("resumeCount", 0)) + 1
            try:
                result = restore_and_reverify(identity, recovery_id)
            except BaseException as error:
                with self.ledger.lock:
                    audit = self._recovery_audit(recovery_id)
                    audit["state"] = "FAILED"
                    audit["ownerPid"] = 0
                    audit["completedAt"] = _timestamp(_utc(self._now()))
                raise MobileResourceLeaseError(
                    "quarantine recovery callback failed closed"
                ) from error
            if not isinstance(result, BaselineRestoreResult):
                with self.ledger.lock:
                    audit = self._recovery_audit(recovery_id)
                    audit["state"] = "FAILED"
                    audit["ownerPid"] = 0
                    audit["completedAt"] = _timestamp(_utc(self._now()))
                raise MobileResourceLeaseError(
                    "quarantine recovery must return BaselineRestoreResult"
                )
            with self.ledger.lock:
                record = self._record(resource_key)
                if (
                    record.state != "QUARANTINED"
                    or LeaseIdentity.from_payload(record.acquisition) != identity
                ):
                    audit = self._recovery_audit(recovery_id)
                    audit["state"] = "FAILED"
                    audit["ownerPid"] = 0
                    audit["completedAt"] = _timestamp(_utc(self._now()))
                    raise LeaseFenceStale(
                        f"resource {resource_key!r} recovery fence is stale"
                    )
                audit = self._recovery_audit(recovery_id)
                audit.update(
                    {
                        "state": "COMPLETED",
                        "ownerPid": 0,
                        "completedAt": _timestamp(_utc(self._now())),
                        "cleanupCompleted": result.cleanup_completed,
                        "baselineRestored": result.baseline_restored,
                        "identityReverified": result.identity_reverified,
                    }
                )
                if (
                    not result.cleanup_completed
                    or not result.baseline_restored
                    or not result.identity_reverified
                ):
                    audit["state"] = "FAILED"
                    raise LeaseBaselineMismatch(
                        f"resource {resource_key!r} recovery is incomplete"
                    )
                del self.ledger.records[resource_key]

    def close(self) -> dict[str, bool]:
        correlation_evidence = {
            "correlationChannelClosed": False,
            "correlationKeyZeroized": False,
        }
        try:
            correlation_evidence = self.correlation_secret.close()
        except BaseException:
            pass

        ledger_evidence = {
            "leaseLedgerStateLockDescriptorClosed": self.ledger is None,
            "leaseLedgerOperationLockDescriptorsClosed": self.ledger is None,
            "leaseLedgerOperationsDescriptorClosed": self.ledger is None,
            "leaseLedgerGenerationsDescriptorClosed": self.ledger is None,
            "leaseLedgerRootDescriptorClosed": self.ledger is None,
            "leaseLedgerAuthenticationKeyZeroized": self.ledger is None,
            "leaseLedgerClosed": self.ledger is None,
        }
        if self.ledger is not None:
            try:
                ledger_evidence = self.ledger.close()
            except BaseException:
                pass

        for index in range(len(self._physical_identity_key)):
            self._physical_identity_key[index] = 0
        self._closed = True
        evidence = {
            **correlation_evidence,
            "physicalIdentityKeyZeroized": not any(
                self._physical_identity_key
            ),
            **ledger_evidence,
        }
        return {
            **evidence,
            "resourceLeaseBrokerClosed": all(evidence.values()),
        }

    def current_acquisition(self, resource_key: str) -> dict[str, Any]:
        with self.ledger.operation_lock(resource_key):
            with self.ledger.lock:
                record = self._record(resource_key)
                self._terminalize_dead_owner(record, _utc(self._now()))
                return dict(record.acquisition)

    def acquisition_reference(self, lease: Mapping[str, Any]) -> ArtifactRef:
        resource_key = str(lease.get("resourceKey", ""))
        with self.ledger.operation_lock(resource_key):
            with self.ledger.lock:
                record = self._record(resource_key)
                if (
                    str(lease.get("holderRunId", "")) != self.run_id
                    or str(lease.get("runId", "")) != self.run_id
                ):
                    raise LeaseConflict(
                        f"resource {resource_key!r} belongs to another holder run"
                    )
                record = self._validate_operation(lease, _utc(self._now()))
                reference = record.acquisition_ref
                if (
                    reference is None
                    or record.outcome is not None
                    or record.state.startswith("PENDING_")
                    or record.state in {"QUARANTINED", "RELEASED"}
                    or record.state != str(record.acquisition["state"])
                ):
                    raise MobileResourceLeaseError(
                        "acquisition artifact publication is incomplete"
                    )
                if (
                    reference.run_id != self.run_id
                    or reference.gate_id != self.run_handle.gate_id
                ):
                    raise MobileResourceLeaseError(
                        "acquisition artifact reference identity is invalid"
                    )
                return _validate_json_artifact_reference(
                    reference,
                    gate_id=self.gate_id,
                    run_id=self.run_id,
                    path=self._acquisition_artifact_path(record),
                    value=record.acquisition,
                    redact=False,
                    expected_workspace_id=record.artifact_workspace_id,
                )

    def terminal_outcome(self, resource_key: str) -> dict[str, Any] | None:
        with self.ledger.operation_lock(resource_key):
            with self.ledger.lock:
                record = self._record(resource_key)
                self._terminalize_dead_owner(record, _utc(self._now()))
                return dict(record.outcome) if record.outcome is not None else None

    def _lease_header(self, resource_key: str, lease_id: str) -> dict[str, Any]:
        return {
            "leaseId": lease_id,
            "resourceKey": resource_key,
            "holderRunId": self.run_id,
            "fenceToken": self._next_fence(resource_key),
            "runId": self.run_id,
            "gateId": self.gate_id,
        }

    def _next_fence(self, resource_key: str) -> int:
        with self.ledger.lock:
            fence = self.ledger.fences.get(resource_key, 0) + 1
            self.ledger.fences[resource_key] = fence
            return fence

    def _acquire(
        self,
        resource_key: str,
        kind: str,
        payload: dict[str, Any],
        expires_at: datetime,
        artifact_path: str,
        *,
        physical_identity_hmac: str = "",
        provider_expected_identity_hmac: str = "",
    ) -> dict[str, Any]:
        record = self._reserve(
            resource_key,
            kind,
            payload,
            expires_at,
            physical_identity_hmac=physical_identity_hmac,
            provider_expected_identity_hmac=(
                provider_expected_identity_hmac
            ),
            state="PENDING_PUBLICATION",
        )
        return self._publish_acquisition(record, artifact_path)

    def _reserve(
        self,
        resource_key: str,
        kind: str,
        payload: dict[str, Any],
        expires_at: datetime,
        *,
        physical_identity_hmac: str = "",
        provider_expected_identity_hmac: str = "",
        dependencies: tuple[_LeaseDependency, ...] = (),
        state: str,
        validate_payload: bool = True,
    ) -> _LeaseRecord:
        existing = self.ledger.records.get(resource_key)
        if existing is not None:
            self._terminalize_dead_owner(existing, _utc(self._now()))
            state = "quarantined" if existing.state == "QUARANTINED" else "leased"
            raise LeaseConflict(
                f"resource {resource_key!r} is {state} and unavailable"
            )
        if validate_payload:
            validate_contract_payload(
                payload,
                expected_run_id=self.run_id,
                expected_gate_id=self.gate_id,
            )
        record = _LeaseRecord(
            kind=kind,
            acquisition=dict(payload),
            acquisition_ref=None,
            artifact_workspace_id=self._artifact_workspace_id,
            expires_at=expires_at,
            state=state,
            owner_pid=os.getpid(),
            physical_identity_hmac=physical_identity_hmac,
            provider_expected_identity_hmac=(
                provider_expected_identity_hmac
            ),
            dependencies=dependencies,
        )
        self.ledger.records[resource_key] = record
        self.ledger.acquisition_order.append(resource_key)
        self.ledger._persist()
        return record

    def _require_resource_available(self, resource_key: str) -> None:
        existing = self.ledger.records.get(resource_key)
        if existing is None:
            return
        self._terminalize_dead_owner(existing, _utc(self._now()))
        state = "quarantined" if existing.state == "QUARANTINED" else "leased"
        raise LeaseConflict(
            f"resource {resource_key!r} is {state} and unavailable"
        )

    def _publish_acquisition(
        self,
        record: _LeaseRecord,
        artifact_path: str,
    ) -> dict[str, Any]:
        payload = record.acquisition
        validate_contract_payload(
            payload,
            expected_run_id=self.run_id,
            expected_gate_id=self.gate_id,
        )
        try:
            reference = self.run_handle.write_json(
                artifact_path,
                payload,
                role=_acquisition_artifact_role(payload),
                redact=False,
            )
            _validate_json_artifact_reference(
                reference,
                gate_id=self.gate_id,
                run_id=self.run_id,
                path=artifact_path,
                value=payload,
                redact=False,
                expected_workspace_id=record.artifact_workspace_id,
            )
        except BaseException:
            self._quarantine_unpublished(
                record,
                "ACQUISITION_ARTIFACT_PUBLICATION_FAILED",
            )
            raise
        record.acquisition_ref = reference
        record.state = str(payload["state"])
        return dict(payload)

    def _lease_operation_locks(
        self,
        lease: Mapping[str, Any],
        *,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> AbstractContextManager[None]:
        resource_key = str(lease["resourceKey"])
        ledger_lock = (
            self.ledger.lock.bounded(
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )
            if deadline_monotonic is not None
            else self.ledger.lock
        )
        with ledger_lock:
            record = self._record(resource_key)
            resource_keys = {
                resource_key,
                *(
                    dependency.identity.resource_key
                    for dependency in record.dependencies
                ),
            }
        stack = ExitStack()
        try:
            for locked_key in sorted(resource_keys):
                operation_lock = self.ledger.operation_lock(
                    locked_key,
                    deadline_monotonic=deadline_monotonic,
                    cancellation=cancellation,
                )
                stack.enter_context(
                    operation_lock.bounded(
                        deadline_monotonic=deadline_monotonic,
                        cancellation=cancellation,
                    )
                    if deadline_monotonic is not None
                    else operation_lock
                )
        except BaseException:
            stack.close()
            raise
        return stack

    def _browser_operation_locks(
        self,
        lease: Mapping[str, Any],
    ) -> AbstractContextManager[None]:
        return self._lease_operation_locks(lease)

    def _validate_reserved_browser(
        self,
        reservation: _LeaseRecord,
        *,
        observed_at: datetime,
    ) -> _LeaseRecord:
        identity = LeaseIdentity.from_payload(reservation.acquisition)
        current = self._record(identity.resource_key)
        if (
            current.state != "PENDING_BASELINE"
            or LeaseIdentity.from_payload(current.acquisition) != identity
        ):
            raise LeaseFenceStale(
                f"resource {identity.resource_key!r} baseline fence is stale"
            )
        if observed_at >= current.expires_at:
            self._quarantine_reserved_browser(
                current,
                "LEASE_HEARTBEAT_EXPIRED",
            )
            raise LeaseHeartbeatExpired(
                f"resource {identity.resource_key!r} heartbeat expired"
            )
        self._validate_browser_dependencies(current, observed_at)
        return current

    def _validate_browser_operation(
        self,
        lease: Mapping[str, Any],
        observed_at: datetime,
    ) -> _LeaseRecord:
        record = self._validate_operation(lease, observed_at)
        if record.kind != "provider-browser-session":
            raise MobileResourceLeaseError(
                "browser operation requires a browser-session lease"
            )
        self._validate_browser_dependencies(record, observed_at)
        return record

    def _validate_browser_dependencies(
        self,
        record: _LeaseRecord,
        observed_at: datetime,
    ) -> None:
        if len(record.dependencies) != 2:
            raise MobileResourceLeaseError(
                "browser lease dependency identities are unavailable"
            )
        observed_kinds: set[str] = set()
        for dependency in record.dependencies:
            identity = dependency.identity
            if identity.holder_run_id != self.run_id:
                raise LeaseConflict(
                    f"resource {identity.resource_key!r} belongs to another holder run"
                )
            dependency_record = self._validate_operation(
                {
                    "resourceKey": identity.resource_key,
                    "holderRunId": identity.holder_run_id,
                    "fenceToken": identity.fence_token,
                    "runId": identity.holder_run_id,
                },
                observed_at,
            )
            if dependency_record.kind != dependency.kind:
                raise MobileResourceLeaseError(
                    f"resource {identity.resource_key!r} is not a "
                    f"{dependency.kind} lease"
                )
            if (
                str(dependency_record.acquisition.get("runId", ""))
                != self.run_id
            ):
                raise LeaseConflict(
                    f"resource {identity.resource_key!r} belongs to another holder run"
                )
            if (
                dependency.kind == "provider-account"
                and not dependency_record.provider_identity_verified
            ):
                raise LeaseBaselineMismatch(
                    "browser provider account identity is not verified"
                )
            observed_kinds.add(dependency.kind)
        if observed_kinds != {"physical-device", "provider-account"}:
            raise MobileResourceLeaseError(
                "browser lease dependencies are incomplete"
            )

    def _quarantine_reserved_browser(
        self,
        reservation: _LeaseRecord,
        reason: str,
    ) -> None:
        identity = LeaseIdentity.from_payload(reservation.acquisition)
        current = self.ledger.records.get(identity.resource_key)
        if (
            current is None
            or LeaseIdentity.from_payload(current.acquisition) != identity
        ):
            raise LeaseFenceStale(
                f"resource {identity.resource_key!r} baseline fence is stale"
            )
        self._quarantine_unpublished(current, reason)

    def _validate_operation(
        self,
        lease: Mapping[str, Any],
        observed_at: datetime,
    ) -> _LeaseRecord:
        identity = LeaseIdentity.from_payload(lease)
        record = self._record(identity.resource_key)
        self._require_exact_lease_tuple(record, lease)
        self._terminalize_dead_owner(record, observed_at)
        if record.state == "QUARANTINED":
            raise LeaseConflict(
                f"resource {identity.resource_key!r} is quarantined"
            )
        if record.state == "PENDING_TERMINAL_PUBLICATION":
            raise LeaseConflict(
                f"resource {identity.resource_key!r} terminal outcome is pending"
            )
        if observed_at >= record.expires_at:
            self._terminalize(
                record,
                failure_code="LEASE_HEARTBEAT_EXPIRED",
                cleanup_completed=False,
                baseline_restored=False,
                identity_reverified=False,
                observed_at=observed_at,
            )
            raise LeaseHeartbeatExpired(
                f"resource {identity.resource_key!r} heartbeat expired"
            )
        return record

    def _require_exact_lease_tuple(
        self,
        record: _LeaseRecord,
        lease: Mapping[str, Any],
    ) -> None:
        resource_key = str(lease.get("resourceKey", ""))
        if (
            not self._lease_tuple_matches(record, lease)
            or record.state == "RELEASED"
        ):
            raise LeaseFenceStale(
                f"resource {resource_key!r} lease fence is stale"
            )

    def _begin_external_operation(
        self,
        record: _LeaseRecord,
        lease: Mapping[str, Any],
        *,
        operation_kind: str,
        details: Mapping[str, Any] | None = None,
        count_for_summary: bool = False,
    ) -> str:
        self._require_exact_lease_tuple(record, lease)
        if (
            record.operation_intent is not None
            or record.operation_owner_pid != 0
            or record.operation_active != 0
        ):
            self._terminalize(
                record,
                failure_code="LEASE_OPERATION_INCOMPLETE",
                cleanup_completed=False,
                baseline_restored=False,
                identity_reverified=False,
                observed_at=_utc(self._now()),
            )
            raise LeaseConflict(
                f"resource {lease['resourceKey']!r} has an incomplete operation"
            )
        if (
            record.kind == "provider-account"
            and record.operation_started != record.operation_completed
        ):
            self._terminalize(
                record,
                failure_code="LEASE_OPERATION_INCOMPLETE",
                cleanup_completed=False,
                baseline_restored=False,
                identity_reverified=False,
                observed_at=_utc(self._now()),
            )
            raise LeaseConflict(
                f"resource {lease['resourceKey']!r} has an incomplete operation"
            )
        operation_id = secrets.token_hex(16)
        record.operation_active = 1
        record.operation_owner_pid = os.getpid()
        if count_for_summary:
            record.operation_started += 1
            record.max_observed_concurrency = max(
                record.max_observed_concurrency,
                record.operation_active,
            )
        record.operation_intent = {
            "operationId": operation_id,
            "operationKind": operation_kind,
            "resourceKey": record.acquisition["resourceKey"],
            "holderRunId": record.acquisition["holderRunId"],
            "fenceToken": record.acquisition["fenceToken"],
            "runId": record.acquisition["runId"],
            "ownerPid": os.getpid(),
            "countForSummary": count_for_summary,
            **dict(details or {}),
        }
        return operation_id

    def _complete_external_operation(
        self,
        record: _LeaseRecord,
        lease: Mapping[str, Any],
        operation_id: str,
    ) -> None:
        self._require_exact_lease_tuple(record, lease)
        intent = record.operation_intent
        if (
            intent is None
            or intent.get("operationId") != operation_id
            or intent.get("resourceKey") != lease.get("resourceKey")
            or intent.get("holderRunId") != lease.get("holderRunId")
            or intent.get("fenceToken") != lease.get("fenceToken")
            or intent.get("runId") != lease.get("runId")
            or record.operation_owner_pid != os.getpid()
            or intent.get("ownerPid") != os.getpid()
        ):
            self._terminalize(
                record,
                failure_code="LEASE_OPERATION_INCOMPLETE",
                cleanup_completed=False,
                baseline_restored=False,
                identity_reverified=False,
                observed_at=_utc(self._now()),
            )
            raise LeaseConflict(
                f"resource {lease['resourceKey']!r} operation intent changed"
            )
        record.operation_active = 0
        if intent.get("countForSummary") is True:
            record.operation_completed += 1
        record.operation_owner_pid = 0
        record.operation_intent = None

    def _quarantine_current_operation(
        self,
        record: _LeaseRecord,
        lease: Mapping[str, Any],
        operation_id: str,
        *,
        failure_code: str = "LEASE_OPERATION_INCOMPLETE",
        observed_at: datetime | None = None,
    ) -> None:
        if not self._lease_tuple_matches(record, lease):
            return
        intent = record.operation_intent
        if record.outcome is not None:
            return
        self._terminalize(
            record,
            failure_code=failure_code,
            cleanup_completed=False,
            baseline_restored=False,
            identity_reverified=False,
            observed_at=_utc(observed_at or self._now()),
        )

    def _quarantine_interrupted_operation(
        self,
        resource_key: str,
        lease: Mapping[str, Any],
        operation_id: str,
        *,
        failure_code: str = "LEASE_OPERATION_INCOMPLETE",
        observed_at: datetime | None = None,
        deadline_monotonic: float | None = None,
        cancellation: threading.Event | None = None,
    ) -> None:
        lock_context = (
            self.ledger.lock
            if deadline_monotonic is None and cancellation is None
            else self.ledger.lock.bounded(
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
            )
        )
        with lock_context:
            record = self.ledger.records.get(resource_key)
            if record is None:
                return
            self._quarantine_current_operation(
                record,
                lease,
                operation_id,
                failure_code=failure_code,
                observed_at=observed_at,
            )

    @staticmethod
    def _lease_tuple_matches(
        record: _LeaseRecord,
        lease: Mapping[str, Any],
    ) -> bool:
        try:
            return (
                str(lease["resourceKey"])
                == str(record.acquisition["resourceKey"])
                and str(lease["holderRunId"])
                == str(record.acquisition["holderRunId"])
                and int(lease["fenceToken"])
                == int(record.acquisition["fenceToken"])
                and str(lease["runId"])
                == str(record.acquisition["runId"])
            )
        except (KeyError, TypeError, ValueError):
            return False

    def _terminalize(
        self,
        record: _LeaseRecord,
        *,
        failure_code: str,
        cleanup_completed: bool,
        baseline_restored: bool,
        identity_reverified: bool,
        observed_at: datetime,
    ) -> dict[str, Any]:
        if record.outcome is not None:
            return dict(record.outcome)
        if record.acquisition_ref is None:
            self._quarantine_unpublished(
                record,
                failure_code or "ACQUISITION_ARTIFACT_PUBLICATION_INCOMPLETE",
            )
            raise MobileResourceLeaseError(
                "unpublished acquisition was durably quarantined"
            )
        acquisition = record.acquisition
        run_id = str(acquisition["runId"])
        acquisition_gate_id = str(acquisition["gateId"])
        writer = self._writer_for(record)
        if record.pending_outcome is None:
            final_state = "QUARANTINED" if failure_code else "RELEASED"
            payload: dict[str, Any] = {
                "artifactKind": "mobile-lease-outcome",
                "runId": run_id,
                "gateId": acquisition_gate_id,
                "leaseId": acquisition["leaseId"],
                "leaseKind": record.kind,
                "resourceKey": acquisition["resourceKey"],
                "holderRunId": acquisition["holderRunId"],
                "fenceToken": acquisition["fenceToken"],
                "acquisition": record.acquisition_ref.to_dict(),
                "finalState": final_state,
                "cleanupCompleted": cleanup_completed,
                "baselineRestored": baseline_restored,
                "identityReverified": identity_reverified,
                "failureCode": failure_code,
                "observedAt": _timestamp(observed_at),
            }
            if record.kind == "provider-account":
                payload["operationSummary"] = {
                    "started": record.operation_started,
                    "completed": record.operation_completed,
                    "maxObservedConcurrency": record.max_observed_concurrency,
                    "fenceValidated": record.fence_validated,
                }
            validate_contract_payload(
                payload,
                expected_run_id=run_id,
                expected_gate_id=acquisition_gate_id,
            )
            record.pending_outcome = dict(payload)
            record.state = "PENDING_TERMINAL_PUBLICATION"
            self.ledger._persist()
        else:
            payload = dict(record.pending_outcome)
            validate_contract_payload(
                payload,
                expected_run_id=run_id,
                expected_gate_id=acquisition_gate_id,
            )
        outcome_path = (
            f"evidence/mobile/cleanup/leases/{acquisition['leaseId']}.json"
        )
        outcome_reference = writer.write_json(
            outcome_path,
            payload,
            role=_artifact_role_instance(
                "mobile-lease-outcome",
                str(acquisition["leaseId"]),
            ),
        )
        _validate_json_artifact_reference(
            outcome_reference,
            gate_id=acquisition_gate_id,
            run_id=run_id,
            path=outcome_path,
            value=payload,
            expected_workspace_id=record.artifact_workspace_id,
        )
        final_state = str(payload["finalState"])
        record.state = final_state
        record.outcome = dict(payload)
        record.pending_outcome = None
        if final_state == "RELEASED":
            del self.ledger.records[acquisition["resourceKey"]]
        return dict(payload)

    def _writer_for(self, record: _LeaseRecord) -> ArtifactWriter:
        reference = record.acquisition_ref
        if reference is None:
            raise MobileResourceLeaseError(
                "acquisition artifact publication is incomplete"
            )
        acquisition_run_id = str(record.acquisition["runId"])
        _validate_json_artifact_reference(
            reference,
            gate_id=reference.gate_id,
            run_id=acquisition_run_id,
            path=self._acquisition_artifact_path(record),
            value=record.acquisition,
            redact=False,
            expected_workspace_id=record.artifact_workspace_id,
        )
        writer: ArtifactWriter | None
        if (
            reference.run_id == self.run_id
            and reference.gate_id == self.run_handle.gate_id
        ):
            writer = self.run_handle
        else:
            writer = self._artifact_writer_resolver(reference)
        if (
            writer is None
            or writer.run_id != reference.run_id
            or writer.gate_id != reference.gate_id
        ):
            raise MobileResourceLeaseError(
                "original acquisition run artifact writer is unavailable"
            )
        return writer

    @staticmethod
    def _acquisition_artifact_path(record: _LeaseRecord) -> str:
        if record.kind == "provider-account":
            return (
                "runtime/mobile/leases/accounts/"
                f"{record.acquisition['provider']}.json"
            )
        if record.kind == "physical-device":
            return (
                "runtime/mobile/leases/devices/"
                f"{record.acquisition['clientId']}.json"
            )
        if record.kind == "provider-browser-session":
            return (
                "runtime/mobile/leases/browsers/"
                f"{record.acquisition['clientId']}.json"
            )
        raise MobileResourceLeaseError(
            f"unsupported acquisition artifact kind {record.kind!r}"
        )

    def _owner_is_dead(self, record: _LeaseRecord) -> bool:
        return (
            record.outcome is None
            and record.owner_pid > 0
            and not _process_is_alive(record.owner_pid)
        )

    def _operation_owner_is_dead(self, record: _LeaseRecord) -> bool:
        return (
            record.outcome is None
            and record.operation_intent is not None
            and record.operation_owner_pid > 0
            and not _process_is_alive(record.operation_owner_pid)
        )

    def _terminalize_dead_owner(
        self,
        record: _LeaseRecord,
        observed_at: datetime,
    ) -> None:
        if self._operation_owner_is_dead(record):
            self._terminalize(
                record,
                failure_code="LEASE_OPERATION_INCOMPLETE",
                cleanup_completed=False,
                baseline_restored=False,
                identity_reverified=False,
                observed_at=observed_at,
            )
            return
        if self._owner_is_dead(record):
            if record.acquisition_ref is None:
                self._quarantine_unpublished(
                    record,
                    "ACQUISITION_OWNER_LOST_DURING_PUBLICATION",
                )
                return
            self._terminalize(
                record,
                failure_code="LEASE_HEARTBEAT_EXPIRED",
                cleanup_completed=False,
                baseline_restored=False,
                identity_reverified=False,
                observed_at=observed_at,
            )

    def _quarantine_unpublished(
        self,
        record: _LeaseRecord,
        reason: str,
    ) -> None:
        record.state = "QUARANTINED"
        record.quarantine_reason = reason

    def _recovery_audit(self, recovery_id: str) -> dict[str, Any]:
        for entry in reversed(self.ledger.recovery_audit):
            if entry["recoveryId"] == recovery_id:
                return entry
        raise MobileResourceLeaseError(
            f"recovery audit {recovery_id!r} is unavailable"
        )

    def _started_recovery(
        self,
        identity: LeaseIdentity,
    ) -> dict[str, Any] | None:
        matches = [
            entry
            for entry in self.ledger.recovery_audit
            if entry.get("state") == "STARTED"
            and entry.get("resourceKey") == identity.resource_key
            and entry.get("holderRunId") == identity.holder_run_id
            and entry.get("fenceToken") == identity.fence_token
        ]
        if len(matches) > 1:
            raise MobileResourceLeaseError(
                f"resource {identity.resource_key!r} has duplicate recovery intents"
            )
        return matches[0] if matches else None

    def _resolve_physical_device(
        self,
        client_id: str,
    ) -> ResolvedPhysicalDeviceHandle:
        resolver = self._physical_device_resolver
        if resolver is None:
            raise MobileResourceLeaseError(
                "physical device resolver is unavailable"
            )
        handle = resolver(client_id)
        if not isinstance(handle, ResolvedPhysicalDeviceHandle):
            raise MobileResourceLeaseError(
                "physical device resolver returned an invalid handle"
            )
        if not isinstance(handle.identifier, str) or not handle.identifier:
            raise MobileResourceLeaseError(
                "physical device resolver returned an empty identity"
            )
        return handle

    @staticmethod
    def _validate_physical_device_facts(
        client_id: str,
        handle: ResolvedPhysicalDeviceHandle,
    ) -> dict[str, bool]:
        expected_platform = _client_platform(client_id)
        if not isinstance(handle.connected, bool) or not handle.connected:
            raise _PhysicalDeviceFactMismatch(
                "LEASE_DEVICE_DISCONNECTED",
                f"physical device for {client_id!r} is disconnected"
            )
        if (
            not isinstance(handle.physical, bool)
            or not isinstance(handle.simulator, bool)
            or not handle.physical
            or handle.simulator
        ):
            raise _PhysicalDeviceFactMismatch(
                "LEASE_SIMULATOR_DETECTED",
                f"physical device for {client_id!r} is a simulator or emulator"
            )
        platform_matched = (
            isinstance(handle.platform, str)
            and handle.platform == expected_platform
        )
        if not platform_matched:
            raise _PhysicalDeviceFactMismatch(
                "LEASE_PLATFORM_MISMATCH",
                f"physical device platform for {client_id!r} does not match"
            )
        return {
            "connected": handle.connected,
            "physical": handle.physical,
            "simulator": handle.simulator,
            "platformMatched": platform_matched,
        }

    @staticmethod
    def _physical_device_failure_code(error: BaseException) -> str:
        if isinstance(error, _PhysicalDeviceFactMismatch):
            return error.failure_code
        return "LEASE_DEVICE_DISCONNECTED"

    def _physical_identity_hmac(
        self,
        handle: ResolvedPhysicalDeviceHandle,
    ) -> str:
        if not any(self._physical_identity_key):
            raise MobileResourceLeaseError(
                "physical identity broker key is unavailable"
            )
        digest = hmac.new(
            bytes(self._physical_identity_key),
            b"physical-device\0" + handle.identifier.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return f"sha256:{digest}"

    def _provider_expected_identity_hmac(
        self,
        provider: str,
        expected_subject: str,
    ) -> str:
        if not any(self._physical_identity_key):
            raise MobileResourceLeaseError(
                "physical identity broker key is unavailable"
            )
        digest = hmac.new(
            bytes(self._physical_identity_key),
            (
                b"provider-expected-identity\0"
                + provider.encode("utf-8")
                + b"\0"
                + expected_subject.encode("utf-8")
            ),
            hashlib.sha256,
        ).hexdigest()
        return f"sha256:{digest}"

    def _record(self, resource_key: str) -> _LeaseRecord:
        record = self.ledger.records.get(resource_key)
        if record is None:
            raise LeaseFenceStale(
                f"resource {resource_key!r} has no current lease"
            )
        return record

    def _require_dependency(
        self,
        resource_key: str,
        presented_lease: Mapping[str, Any],
        *,
        expected_kind: str,
        observed_at: datetime,
        expected_identity: LeaseIdentity | None = None,
    ) -> _LeaseRecord:
        record = self._record(resource_key)
        identity = LeaseIdentity.from_payload(presented_lease)
        if (
            identity.resource_key != resource_key
            or identity.holder_run_id != self.run_id
            or presented_lease.get("runId") != self.run_id
        ):
            raise LeaseConflict(
                f"resource {resource_key!r} belongs to another holder run"
            )
        if record.kind != expected_kind:
            raise MobileResourceLeaseError(
                f"resource {resource_key!r} is not a {expected_kind} lease"
            )
        if expected_identity is not None and identity != expected_identity:
            raise LeaseFenceStale(
                f"resource {resource_key!r} dependency fence changed"
            )
        return self._validate_operation(presented_lease, observed_at)


class MobileResourceLeaseHeartbeatOwner(
    AbstractContextManager["MobileResourceLeaseHeartbeatOwner"]
):
    """Owns one bounded scheduler for the current run's active leases."""

    def __init__(
        self,
        broker: MobileResourceLeaseBroker,
        *,
        interval_seconds: float,
        stop_timeout_seconds: float = 5.0,
    ) -> None:
        maximum_interval = LEASE_DURATION.total_seconds() / 2
        if (
            interval_seconds <= 0
            or interval_seconds > maximum_interval
            or stop_timeout_seconds <= 0
            or stop_timeout_seconds > MAX_HEARTBEAT_STOP_SECONDS
        ):
            raise ValueError(
                "heartbeat interval and stop timeout must be positive and bounded"
            )
        self._broker = broker
        self._interval_seconds = interval_seconds
        self._stop_timeout_seconds = stop_timeout_seconds
        self._condition = threading.Condition()
        self._stop = threading.Event()
        self._leases: dict[str, dict[str, Any]] = {}
        self._external_heartbeats: dict[str, Callable[[], None]] = {}
        self._heartbeat_counts: dict[str, int] = {}
        self._failure: BaseException | None = None
        self._thread: threading.Thread | None = None
        self._closed = False

    def register(self, lease: Mapping[str, Any]) -> None:
        identity = LeaseIdentity.from_payload(lease)
        if (
            identity.holder_run_id != self._broker.run_id
            or str(lease.get("runId", "")) != self._broker.run_id
        ):
            raise LeaseConflict(
                f"resource {identity.resource_key!r} belongs to another holder run"
            )
        self._broker.acquisition_reference(lease)
        with self._condition:
            if self._closed:
                raise MobileResourceLeaseError(
                    "heartbeat owner is already closed"
                )
            if self._failure is not None:
                raise MobileResourceLeaseError(
                    "heartbeat owner has already failed"
                ) from self._failure
            existing = self._leases.get(identity.resource_key)
            candidate = dict(lease)
            if existing is not None and LeaseIdentity.from_payload(
                existing
            ) != identity:
                raise LeaseFenceStale(
                    f"resource {identity.resource_key!r} heartbeat fence changed"
                )
            self._leases[identity.resource_key] = candidate
            self._heartbeat_counts.setdefault(identity.resource_key, 0)
            self._condition.notify_all()

    def register_external(
        self,
        lease: Mapping[str, Any],
        heartbeat: Callable[[], None],
    ) -> None:
        identity = LeaseIdentity.from_payload(lease)
        if (
            identity.holder_run_id != self._broker.run_id
            or str(lease.get("runId", "")) != self._broker.run_id
        ):
            raise LeaseConflict(
                f"resource {identity.resource_key!r} belongs to another holder run"
            )
        with self._condition:
            if self._closed or self._failure is not None:
                raise MobileResourceLeaseError(
                    "heartbeat owner is unavailable"
                )
            if identity.resource_key in self._leases:
                raise LeaseConflict(
                    f"resource {identity.resource_key!r} is already registered"
                )
            self._leases[identity.resource_key] = dict(lease)
            self._external_heartbeats[identity.resource_key] = heartbeat
            self._heartbeat_counts.setdefault(identity.resource_key, 0)
            self._condition.notify_all()

    def unregister(self, lease: Mapping[str, Any]) -> None:
        identity = LeaseIdentity.from_payload(lease)
        with self._condition:
            existing = self._leases.get(identity.resource_key)
            if existing is None:
                return
            if LeaseIdentity.from_payload(existing) != identity:
                raise LeaseFenceStale(
                    f"resource {identity.resource_key!r} heartbeat fence changed"
                )
            del self._leases[identity.resource_key]
            self._external_heartbeats.pop(identity.resource_key, None)
            self._condition.notify_all()

    def start(self) -> None:
        with self._condition:
            if self._closed:
                raise MobileResourceLeaseError(
                    "heartbeat owner is already closed"
                )
            if self._thread is not None:
                raise MobileResourceLeaseError(
                    "heartbeat owner is already started"
                )
            self._thread = threading.Thread(
                target=self._run,
                name="mobile-resource-lease-heartbeat",
                daemon=True,
            )
            self._thread.start()

    def wait_for_heartbeat(
        self,
        resource_key: str,
        *,
        minimum_count: int = 1,
        timeout_seconds: float,
    ) -> bool:
        if minimum_count < 1 or timeout_seconds <= 0:
            raise ValueError(
                "heartbeat wait count and timeout must be positive"
            )
        deadline = time.monotonic() + timeout_seconds
        with self._condition:
            while (
                self._heartbeat_counts.get(resource_key, 0) < minimum_count
                and self._failure is None
                and not self._closed
            ):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return False
                self._condition.wait(remaining)
            return (
                self._heartbeat_counts.get(resource_key, 0) >= minimum_count
            )

    def wait_until_failed(self, *, timeout_seconds: float) -> bool:
        if timeout_seconds <= 0:
            raise ValueError("heartbeat failure wait timeout must be positive")
        deadline = time.monotonic() + timeout_seconds
        with self._condition:
            while self._failure is None and not self._closed:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return False
                self._condition.wait(remaining)
            return self._failure is not None

    def raise_if_failed(self) -> None:
        with self._condition:
            failure = self._failure
        if failure is not None:
            raise MobileResourceLeaseError(
                "heartbeat owner failed and stopped"
            ) from failure

    def close(self) -> None:
        with self._condition:
            if self._closed:
                return
            self._closed = True
            thread = self._thread
            self._stop.set()
            self._condition.notify_all()
        if thread is not None:
            thread.join(timeout=self._stop_timeout_seconds)
            if thread.is_alive():
                raise MobileResourceLeaseError(
                    "heartbeat owner did not stop within its bounded timeout"
                )

    def __enter__(self) -> "MobileResourceLeaseHeartbeatOwner":
        self.start()
        return self

    def __exit__(
        self,
        exc_type: object,
        exc_value: object,
        traceback: object,
    ) -> None:
        self.close()
        if exc_type is None:
            self.raise_if_failed()

    def _run(self) -> None:
        while not self._stop.wait(self._interval_seconds):
            with self._condition:
                leases = tuple(
                    (
                        resource_key,
                        dict(lease),
                        self._external_heartbeats.get(resource_key),
                    )
                    for resource_key, lease in self._leases.items()
                )
            for resource_key, lease, external_heartbeat in leases:
                if self._stop.is_set():
                    return
                try:
                    if external_heartbeat is None:
                        self._broker.heartbeat(lease)
                    else:
                        external_heartbeat()
                except BaseException as error:
                    with self._condition:
                        self._failure = error
                        self._stop.set()
                        self._condition.notify_all()
                    return
                with self._condition:
                    if resource_key in self._leases:
                        self._heartbeat_counts[resource_key] += 1
                    self._condition.notify_all()


def _client_platform(client_id: str) -> str:
    platform = CLIENT_PLATFORM.get(client_id)
    if platform is None:
        raise MobileResourceLeaseError(
            f"client {client_id!r} is not declared"
        )
    return platform


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("lease timestamps must be timezone-aware")
    return value.astimezone(timezone.utc)


def _timestamp(value: datetime) -> str:
    return value.isoformat(timespec="microseconds").replace("+00:00", "Z")


def _heartbeat_chain_root(
    identity: LeaseIdentity,
    immutable_expiry: datetime,
) -> str:
    payload = {
        "resourceKey": identity.resource_key,
        "holderRunId": identity.holder_run_id,
        "fenceToken": identity.fence_token,
        "immutableExpiresAt": _timestamp(immutable_expiry),
    }
    digest = hashlib.sha256(
        HEARTBEAT_CHAIN_DOMAIN + _canonical_compact_json_bytes(payload)
    ).hexdigest()
    return f"sha256:{digest}"


def _heartbeat_entry_digest(entry: Mapping[str, Any]) -> str:
    digest = hashlib.sha256(
        HEARTBEAT_CHAIN_DOMAIN + _canonical_compact_json_bytes(entry)
    ).hexdigest()
    return f"sha256:{digest}"


def _parse_timestamp(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise MobileResourceLeaseError(
            "resource lease timestamp is invalid"
        ) from error
    return _utc(parsed)


def contains_sensitive_lease_material(value: Mapping[str, Any]) -> bool:
    encoded = json.dumps(value, sort_keys=True).lower()
    forbidden = (
        "udid",
        "serial",
        "provider_subject",
        "provideridentity",
        "password",
        "credentialvalue",
        "/users/",
    )
    return any(marker in encoded for marker in forbidden)
