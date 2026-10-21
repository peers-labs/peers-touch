"""External power-controller runtime with in-process key and actuator custody."""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import secrets
import stat
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterator

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, utils
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from nacl.bindings import crypto_core_ed25519_is_valid_point

from . import finalization_contracts as contracts
from .errors import EvidenceConflict, EvidenceManifestInvalid
from .trust_admission import HeldTrustDispatchLease, TrustDispatchBinding


SignCallback = Callable[[bytes], bytes]
Actuator = Callable[[], None]

_JOURNAL_DOMAIN = "pt.acceptance.finalization.durability-power-controller-command-journal.v1"
_HEAD_DOMAIN = "pt.acceptance.finalization.durability-power-controller-command-journal-head.v1"
_EPOCH_DOMAIN = "pt.acceptance.finalization.durability-power-controller-runtime-epoch.v1"
_SIGNATURE_DOMAINS = {
    "acceptance-power-controller-command-journal": (
        "pt.acceptance.finalization.durability-power-controller-command-journal-signature.v1"
    ),
    "acceptance-power-controller-runtime-epoch": (
        "pt.acceptance.finalization.durability-power-controller-runtime-epoch-signature.v1"
    ),
}
_COMMAND_DOMAIN = "pt.acceptance.finalization.durability-power-controller-command-identity.v1"
_REQUEST_DOMAIN = "pt.acceptance.finalization.durability-power-controller-command-resolution-request.v1"
_LOCK_DOMAIN = "pt.acceptance.finalization.durability-power-controller-command-journal-lock.v1"
_ED25519_ORDER = 2**252 + 27742317777372353535851937790883648493
_P256_ORDER = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
_WITNESS_SIGNATURE_DOMAINS = {
    "INTERRUPTION": (
        "pt.acceptance.finalization.durability-power-controller-store-interruption-signature.v1"
    ),
    "RECOVERY": (
        "pt.acceptance.finalization.durability-power-controller-store-recovery-signature.v1"
    ),
}


def _digest(domain: str, payload: object) -> str:
    return contracts.domain_separated_sha256(domain, payload)


def _signature_message(payload: dict[str, object]) -> bytes:
    domain = _SIGNATURE_DOMAINS.get(payload.get("artifactKind"))
    if domain is None:
        raise EvidenceManifestInvalid("controller artifact has no signature domain")
    return contracts.canonical_json_bytes({"domain": domain, "payload": payload})


def _utc_now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def _write_all(descriptor: int, value: bytes) -> None:
    offset = 0
    while offset < len(value):
        written = os.write(descriptor, value[offset:])
        if written <= 0:
            raise OSError("controller durable write made no progress")
        offset += written


class Ed25519SigningAuthority:
    """Uses a process-local signer callback and verifies every returned signature."""

    def __init__(self, public_key: bytes, sign: SignCallback) -> None:
        if type(public_key) is not bytes or len(public_key) != 32:
            raise ValueError("Ed25519 public key must be exactly 32 bytes")
        if not crypto_core_ed25519_is_valid_point(public_key):
            raise ValueError("Ed25519 public key must be a canonical non-small-order point")
        if not callable(sign):
            raise TypeError("sign must be a process-local callback")
        self.public_key = public_key
        self.public_key_sha256 = hashlib.sha256(public_key).hexdigest()
        self._verifier = Ed25519PublicKey.from_public_bytes(public_key)
        self._sign = sign

    def sign_payload(self, payload: dict[str, object]) -> str:
        message = _signature_message(payload)
        signature = self._sign(message)
        if type(signature) is not bytes or len(signature) != 64:
            raise EvidenceManifestInvalid(
                "controller signer returned a non-Ed25519 signature"
            )
        self._validate_signature_encoding(signature)
        try:
            self._verifier.verify(signature, message)
        except InvalidSignature as error:
            raise EvidenceManifestInvalid(
                "controller signer does not match the configured public key"
            ) from error
        return signature.hex()

    def verify_payload(self, payload: dict[str, object], signature_hex: object) -> None:
        if (
            type(signature_hex) is not str
            or len(signature_hex) != 128
            or any(character not in "0123456789abcdef" for character in signature_hex)
        ):
            raise EvidenceManifestInvalid("controller signature encoding is invalid")
        message = _signature_message(payload)
        signature = bytes.fromhex(signature_hex)
        self._validate_signature_encoding(signature)
        try:
            self._verifier.verify(signature, message)
        except InvalidSignature as error:
            raise EvidenceManifestInvalid("controller signature is invalid") from error

    def __reduce__(self) -> object:
        raise TypeError("controller signing authority is process-local")

    @staticmethod
    def _validate_signature_encoding(signature: bytes) -> None:
        if (
            not crypto_core_ed25519_is_valid_point(signature[:32])
            or int.from_bytes(signature[32:], "little") >= _ED25519_ORDER
        ):
            raise EvidenceManifestInvalid("Ed25519 signature is non-canonical")


class P256QualificationWitness:
    """Qualification-only verifier/signer; cannot supply production credentials."""

    signature_algorithm = "ECDSA_P256_SHA256_P1363_LOW_S"
    production_authority_eligible = False

    def __init__(self, public_key: bytes, sign: SignCallback | None = None) -> None:
        if type(public_key) is not bytes or len(public_key) != 65 or public_key[0] != 4:
            raise ValueError("witness public key must be canonical uncompressed P-256")
        verifier = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), public_key)
        if verifier.public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        ) != public_key:
            raise ValueError("witness point is not canonical")
        if sign is not None and not callable(sign):
            raise TypeError("witness signer must be a process-local callback")
        self.public_key = public_key
        self.public_key_sha256 = hashlib.sha256(public_key).hexdigest()
        self.witness_id = "p256-sha256:" + self.public_key_sha256
        self._verifier = verifier
        self._sign = sign

    @staticmethod
    def _message(phase: str, payload: dict[str, object]) -> bytes:
        domain = _WITNESS_SIGNATURE_DOMAINS.get(phase)
        if domain is None:
            raise EvidenceManifestInvalid("witness signature phase is not qualification-only")
        return contracts.canonical_json_bytes({"domain": domain, "payload": payload})

    def verify_payload(self, phase: str, payload: dict[str, object], signature_hex: object) -> None:
        if (
            type(signature_hex) is not str
            or len(signature_hex) != 128
            or any(character not in "0123456789abcdef" for character in signature_hex)
        ):
            raise EvidenceManifestInvalid("witness signature must be lowercase P1363")
        signature = bytes.fromhex(signature_hex)
        r = int.from_bytes(signature[:32], "big")
        s = int.from_bytes(signature[32:], "big")
        if not 0 < r < _P256_ORDER or not 0 < s <= _P256_ORDER // 2:
            raise EvidenceManifestInvalid("witness signature must have in-range low-S scalars")
        try:
            self._verifier.verify(
                utils.encode_dss_signature(r, s), self._message(phase, payload),
                ec.ECDSA(hashes.SHA256()),
            )
        except InvalidSignature as error:
            raise EvidenceManifestInvalid("witness signature is invalid") from error

    def sign_payload(self, phase: str, payload: dict[str, object]) -> str:
        if self._sign is None:
            raise EvidenceConflict("witness has no process-local signing authority")
        signature = self._sign(self._message(phase, payload))
        if type(signature) is not bytes or len(signature) != 64:
            raise EvidenceManifestInvalid("witness signer must return P1363 low-S bytes")
        self.verify_payload(phase, payload, signature.hex())
        return signature.hex()

    def __reduce__(self) -> object:
        raise TypeError("qualification witness authority is process-local")


class ControllerStore:
    """Descriptor-contained local storage; qualification is a separate obligation."""

    _MAX_ARTIFACT_BYTES = 1024 * 1024

    def __init__(self, root: Path, *, darwin_sync_anchor: Path | None = None) -> None:
        if not root.is_absolute() or root.is_symlink():
            raise ValueError("controller store root must be absolute and non-symlink")
        self.root = Path(os.path.realpath(root))
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.root.chmod(0o700)
        observed_root = self.root.stat()
        self._root_identity = (observed_root.st_dev, observed_root.st_ino)
        if darwin_sync_anchor is not None and darwin_sync_anchor.is_symlink():
            raise ValueError("Darwin sync anchor must not be a symlink")
        self.anchor = (
            None
            if darwin_sync_anchor is None
            else Path(os.path.realpath(darwin_sync_anchor))
        )
        if self.anchor is not None:
            if not self.anchor.is_file() or self.anchor.is_symlink():
                raise ValueError("Darwin sync anchor must be a regular file")
            if self.anchor.stat().st_dev != self.root.stat().st_dev:
                raise ValueError("Darwin sync anchor must be on the store volume")
        self._anchor_identity = (
            None if self.anchor is None
            else (self.anchor.stat().st_dev, self.anchor.stat().st_ino)
        )

    def _sync_fd(self, descriptor: int) -> None:
        if self.anchor is not None:
            fcntl.fcntl(descriptor, fcntl.F_FULLFSYNC)
        else:
            os.fsync(descriptor)

    def _sync_directory(self, descriptor: int) -> None:
        os.fsync(descriptor)
        if self.anchor is not None:
            anchor_fd = os.open(
                self.anchor,
                os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW | os.O_NONBLOCK,
            )
            try:
                observed = os.fstat(anchor_fd)
                if (
                    not stat.S_ISREG(observed.st_mode)
                    or observed.st_nlink != 1
                    or (observed.st_dev, observed.st_ino) != self._anchor_identity
                ):
                    raise EvidenceManifestInvalid("Darwin sync anchor identity changed")
                self._sync_fd(anchor_fd)
            finally:
                os.close(anchor_fd)

    @contextmanager
    def _parent(self, relative: str, *, create: bool = False) -> Iterator[tuple[int, str]]:
        parts = contracts.validate_repo_relative_path(relative).split("/")
        descriptors: list[int] = []
        try:
            root_fd = os.open(
                self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC | os.O_NOFOLLOW
            )
            descriptors.append(root_fd)
            observed = os.fstat(root_fd)
            if (observed.st_dev, observed.st_ino) != self._root_identity:
                raise EvidenceManifestInvalid("controller store root identity changed")
            parent = root_fd
            for component in parts[:-1]:
                if create:
                    try:
                        os.mkdir(component, 0o700, dir_fd=parent)
                    except FileExistsError:
                        pass
                child = os.open(
                    component,
                    os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC | os.O_NOFOLLOW,
                    dir_fd=parent,
                )
                descriptors.append(child)
                if os.fstat(child).st_dev != self._root_identity[0]:
                    raise EvidenceManifestInvalid("controller path crossed a device")
                if create:
                    self._sync_directory(child)
                    self._sync_directory(parent)
                parent = child
        except OSError as error:
            for descriptor in reversed(descriptors):
                os.close(descriptor)
            if isinstance(error, FileNotFoundError):
                raise
            raise EvidenceManifestInvalid("controller directory is unsafe") from error
        except BaseException:
            for descriptor in reversed(descriptors):
                os.close(descriptor)
            raise
        try:
            yield parent, parts[-1]
        finally:
            for descriptor in reversed(descriptors):
                os.close(descriptor)

    def _open_regular(self, parent: int, name: str, *, create: bool = False) -> int:
        flags = os.O_RDWR if create else os.O_RDONLY
        if create:
            flags |= os.O_CREAT
        try:
            descriptor = os.open(
                name, flags | os.O_CLOEXEC | os.O_NOFOLLOW | os.O_NONBLOCK,
                0o600, dir_fd=parent,
            )
        except FileNotFoundError:
            raise
        except OSError as error:
            raise EvidenceManifestInvalid("controller artifact is unsafe") from error
        observed = os.fstat(descriptor)
        if (
            not stat.S_ISREG(observed.st_mode)
            or observed.st_nlink != 1
            or observed.st_dev != self._root_identity[0]
        ):
            os.close(descriptor)
            raise EvidenceManifestInvalid("controller artifact must be a private regular file")
        return descriptor

    def _read_bytes(self, descriptor: int) -> bytes:
        if os.fstat(descriptor).st_size > self._MAX_ARTIFACT_BYTES:
            raise EvidenceManifestInvalid("controller artifact exceeds its byte limit")
        data = bytearray()
        while len(data) <= self._MAX_ARTIFACT_BYTES:
            chunk = os.read(descriptor, min(65536, self._MAX_ARTIFACT_BYTES + 1 - len(data)))
            if not chunk:
                return bytes(data)
            data.extend(chunk)
        raise EvidenceManifestInvalid("controller artifact exceeds its byte limit")

    def _write(self, relative: str, payload: dict[str, object], *, immutable: bool) -> bytes:
        encoded = contracts.canonical_json_bytes(payload)
        if len(encoded) > self._MAX_ARTIFACT_BYTES:
            raise EvidenceManifestInvalid("controller artifact exceeds its byte limit")
        with self._parent(relative, create=True) as (parent, name):
            try:
                existing = self._open_regular(parent, name)
            except FileNotFoundError:
                existing = None
            if existing is not None:
                try:
                    if immutable:
                        if self._read_bytes(existing) != encoded:
                            raise EvidenceConflict("immutable controller artifact conflicts")
                        self._sync_fd(existing)
                        self._sync_directory(parent)
                        return encoded
                finally:
                    os.close(existing)
            temporary = f".{name}.{secrets.token_hex(16)}.tmp"
            descriptor = os.open(
                temporary,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC | os.O_NOFOLLOW,
                0o600, dir_fd=parent,
            )
            try:
                try:
                    _write_all(descriptor, encoded)
                    self._sync_fd(descriptor)
                finally:
                    os.close(descriptor)
                if immutable:
                    try:
                        os.link(
                            temporary, name, src_dir_fd=parent, dst_dir_fd=parent,
                            follow_symlinks=False,
                        )
                    except FileExistsError:
                        existing = self._open_regular(parent, name)
                        try:
                            if self._read_bytes(existing) != encoded:
                                raise EvidenceConflict("immutable controller artifact conflicts")
                            self._sync_fd(existing)
                        finally:
                            os.close(existing)
                else:
                    os.replace(temporary, name, src_dir_fd=parent, dst_dir_fd=parent)
            finally:
                try:
                    os.unlink(temporary, dir_fd=parent)
                except FileNotFoundError:
                    pass
            self._sync_directory(parent)
        return encoded

    def write_immutable(self, relative: str, payload: dict[str, object]) -> bytes:
        return self._write(relative, payload, immutable=True)

    def replace(self, relative: str, payload: dict[str, object]) -> bytes:
        return self._write(relative, payload, immutable=False)

    def read_optional(self, relative: str) -> dict[str, object] | None:
        try:
            with self._parent(relative) as (parent, name):
                descriptor = self._open_regular(parent, name)
                try:
                    encoded = self._read_bytes(descriptor)
                finally:
                    os.close(descriptor)
        except FileNotFoundError:
            return None
        try:
            value = json.loads(encoded)
            if type(value) is not dict or contracts.canonical_json_bytes(value) != encoded:
                raise ValueError("non-canonical object")
        except (ValueError, UnicodeError) as error:
            raise EvidenceManifestInvalid("controller artifact must be a canonical object") from error
        return value

    def read(self, relative: str) -> dict[str, object]:
        value = self.read_optional(relative)
        if value is None:
            raise EvidenceManifestInvalid(f"controller artifact is missing: {relative}")
        return value

    def entries(self, relative: str, *, maximum: int) -> tuple[str, ...]:
        try:
            with self._parent(f"{relative}/.inventory") as (parent, ignored):
                with os.scandir(parent) as iterator:
                    names = []
                    for entry in iterator:
                        if entry.name.startswith("."):
                            continue
                        if len(names) >= maximum or not entry.is_file(follow_symlinks=False):
                            raise EvidenceManifestInvalid("controller inventory is invalid")
                        names.append(entry.name)
                return tuple(sorted(names))
        except FileNotFoundError:
            return ()

    def measure_lock(self, relative: str) -> "_HeldFileLock":
        with self._parent(relative) as (parent, name):
            descriptor = self._open_regular(parent, name)
            try:
                observed = os.fstat(descriptor)
                return _HeldFileLock(-1, str(observed.st_dev), str(observed.st_ino))
            finally:
                os.close(descriptor)

    def lock(self, relative: str) -> "_HeldFileLock":
        with self._parent(relative, create=True) as (parent, name):
            descriptor = self._open_regular(parent, name, create=True)
            try:
                observed = os.fstat(descriptor)
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                self._sync_fd(descriptor)
                self._sync_directory(parent)
                return _HeldFileLock(descriptor, str(observed.st_dev), str(observed.st_ino))
            except BaseException:
                os.close(descriptor)
                raise


class _HeldFileLock:
    def __init__(self, descriptor: int, device_id: str, inode: str) -> None:
        self.descriptor = descriptor
        self.device_id = device_id
        self.inode = inode

    def close(self) -> None:
        if self.descriptor < 0:
            return
        descriptor, self.descriptor = self.descriptor, -1
        fcntl.flock(descriptor, fcntl.LOCK_UN)
        os.close(descriptor)

    def __enter__(self) -> "_HeldFileLock":
        return self

    def __exit__(self, *ignored: object) -> None:
        self.close()


@dataclass(frozen=True)
class PowerCommand:
    command_id: str
    workspace_id: str
    gate_id: str
    crash_fixture_id: str
    qualification_run_id: str
    case_id: str
    expectation_digest: str
    execution_start_digest: str
    interruption_point: str
    release_token_sha256: str
    selected_trust_generation_ref: contracts.PowerControllerTrustGenerationRef
    selected_current_trust_digest: str

    def __post_init__(self) -> None:
        for value in (
            self.command_id,
            self.gate_id,
            self.crash_fixture_id,
            self.qualification_run_id,
            self.case_id,
        ):
            contracts.validate_finalizer_id(value)
        for digest in (
            self.expectation_digest,
            self.execution_start_digest,
            self.release_token_sha256,
            self.selected_current_trust_digest,
        ):
            contracts.validate_sha256(digest)
        if not self.interruption_point:
            raise ValueError("interruptionPoint must not be empty")
        if (
            type(self.selected_trust_generation_ref)
            is not contracts.PowerControllerTrustGenerationRef
            or self.selected_trust_generation_ref.workspace_id
            != self.workspace_id
            or self.selected_trust_generation_ref.gate_id != self.gate_id
        ):
            raise ValueError("command trust generation scope mismatch")

    def identity_digest(self, epoch_digest: str) -> str:
        return _digest(
            _COMMAND_DOMAIN,
            {
                **self.__dict__,
                "selected_trust_generation_ref": (
                    self.selected_trust_generation_ref.to_dict()
                ),
                "controllerRuntimeEpochDigest": epoch_digest,
            },
        )


class PowerController:
    """Owns one live epoch and one-shot command dispatch in this process."""

    _EDGES = {
        "ACCEPTED": {"ARMED", "CANCELLED"},
        "ARMED": {"EXECUTION_STARTED", "CANCELLED"},
        "EXECUTION_STARTED": {"ACTION_DISPATCHED"},
        "ACTION_DISPATCHED": {"EXECUTED"},
        "EXECUTED": set(),
        "CANCELLED": set(),
    }

    def __init__(
        self,
        store: ControllerStore,
        signing_authority: Ed25519SigningAuthority,
        *,
        controller_identity_digest: str,
        runtime_identity_digest: str,
        process_start_identity: contracts.ProcessStartIdentity,
    ) -> None:
        if type(store) is not ControllerStore:
            raise TypeError("controller store must be concrete")
        if type(signing_authority) is not Ed25519SigningAuthority:
            raise TypeError("signing authority must be concrete")
        contracts.validate_sha256(controller_identity_digest)
        contracts.validate_sha256(runtime_identity_digest)
        self.store = store
        self.signing_authority = signing_authority
        self.controller_identity_digest = controller_identity_digest
        self.runtime_identity_digest = runtime_identity_digest
        self.process_start_identity = process_start_identity
        self.pid = os.getpid()
        self._closed = False
        self._call_lock = threading.RLock()
        self._dispatched_commands: set[str] = set()
        self._epoch_lock = store.lock(".runtime.lock")
        try:
            self.epoch = self._start_epoch()
        except BaseException:
            self._epoch_lock.close()
            raise

    def _start_epoch(self) -> dict[str, object]:
        previous = self.store.read_optional("current.json")
        if previous is None:
            if self.store.entries("epochs", maximum=1):
                raise EvidenceManifestInvalid("controller current is missing from existing history")
        else:
            epoch_id = previous.get("controllerRuntimeEpochId")
            try:
                contracts.validate_finalizer_id(epoch_id)
                prior = self.store.read(f"epochs/{epoch_id}.json")
                self._verify_signed(prior, "controllerRuntimeEpochDigest", _EPOCH_DOMAIN)
            except ValueError as error:
                raise EvidenceManifestInvalid("controller predecessor epoch is invalid") from error
            if (
                previous != self._epoch_current(prior)
                or prior.get("controllerIdentityDigest") != self.controller_identity_digest
                or prior.get("runtimeLockDeviceId") != self._epoch_lock.device_id
                or prior.get("runtimeLockInode") != self._epoch_lock.inode
            ):
                raise EvidenceManifestInvalid("controller predecessor current is invalid")
        epoch_id = secrets.token_hex(16)
        payload = {
            "artifactKind": "acceptance-power-controller-runtime-epoch",
            "schemaVersion": 1,
            "controllerIdentityDigest": self.controller_identity_digest,
            "controllerRuntimeEpochId": epoch_id,
            "controllerPid": self.pid,
            "controllerProcessStartIdentity": self.process_start_identity.to_dict(),
            "runtimeIdentityDigest": self.runtime_identity_digest,
            "runtimeLockDeviceId": self._epoch_lock.device_id,
            "runtimeLockInode": self._epoch_lock.inode,
            "previousEpochDigest": (
                None if previous is None else previous["controllerRuntimeEpochDigest"]
            ),
            "startedAt": _utc_now(),
            "signatureAlgorithm": "ED25519",
        }
        epoch_digest = _digest(_EPOCH_DOMAIN, payload)
        payload["signatureHex"] = self.signing_authority.sign_payload(payload)
        payload["controllerRuntimeEpochDigest"] = epoch_digest
        self.store.write_immutable(f"epochs/{epoch_id}.json", payload)
        self.store.replace("current.json", self._epoch_current(payload))
        return payload

    @staticmethod
    def _epoch_current(epoch: dict[str, object]) -> dict[str, object]:
        return {
            "artifactKind": "acceptance-power-controller-runtime-current",
            "schemaVersion": 1,
            "controllerRuntimeEpochId": epoch["controllerRuntimeEpochId"],
            "controllerRuntimeEpochDigest": epoch["controllerRuntimeEpochDigest"],
        }

    def _require_live(self) -> None:
        if self._closed or self.pid != os.getpid() or self._epoch_lock.descriptor < 0:
            raise EvidenceConflict("controller epoch is not owned by this live process")
        measured = self.store.measure_lock(".runtime.lock")
        if (measured.device_id, measured.inode) != (
            self._epoch_lock.device_id, self._epoch_lock.inode
        ):
            raise EvidenceConflict("controller runtime lock identity changed")
        observed = os.fstat(self._epoch_lock.descriptor)
        if (str(observed.st_dev), str(observed.st_ino)) != (
            measured.device_id, measured.inode
        ):
            raise EvidenceConflict("controller runtime descriptor identity changed")
        stored = self.store.read(f"epochs/{self.epoch['controllerRuntimeEpochId']}.json")
        self._verify_signed(stored, "controllerRuntimeEpochDigest", _EPOCH_DOMAIN)
        if stored != self.epoch or self.store.read("current.json") != self._epoch_current(stored):
            raise EvidenceConflict("controller current epoch changed")

    @contextmanager
    def _command_lock(self, command: PowerCommand) -> Iterator["_HeldFileLock"]:
        if type(command) is not PowerCommand:
            raise TypeError("command must be concrete")
        if self.pid != os.getpid():
            raise EvidenceConflict("controller calls cannot cross a process boundary")
        with self._call_lock:
            self._require_live()
            with self.store.lock(f"commands/{command.command_id}/.lock") as lock:
                self._require_live()
                yield lock

    def accept(self, command: PowerCommand) -> dict[str, object]:
        with self._command_lock(command) as lock:
            head = self._resolve_head(command, lock)
            if head is not None:
                return self._validated_equal_retry(head)
            identity = command.identity_digest(
                self.epoch["controllerRuntimeEpochDigest"]
            )
            common = self._common(command, identity, lock)
            return self._append(common, state="ACCEPTED", previous=None)

    def transition(
        self,
        command: PowerCommand,
        *,
        target_state: str,
        release_token: bytes | None = None,
    ) -> dict[str, object]:
        if target_state not in {"ARMED", "EXECUTION_STARTED", "CANCELLED"}:
            raise ValueError("caller-selected transition is not allowed")
        with self._command_lock(command) as lock:
            if command.command_id in self._dispatched_commands:
                raise EvidenceConflict("controller already consumed this power dispatch")
            head = self._require_current_head(command, lock)
            if target_state not in self._EDGES[head["commandState"]]:
                raise EvidenceConflict("controller command transition is invalid")
            if target_state == "ARMED":
                if (
                    type(release_token) is not bytes
                    or hashlib.sha256(release_token).hexdigest()
                    != command.release_token_sha256
                ):
                    raise EvidenceConflict("release token does not match command")
            return self._append(
                self._common(
                    command,
                    command.identity_digest(
                        self.epoch["controllerRuntimeEpochDigest"]
                    ),
                    lock,
                ),
                state=target_state,
                previous=head,
            )

    def dispatch(
        self,
        command: PowerCommand,
        *,
        held_trust_lease: HeldTrustDispatchLease,
        actuator: Actuator,
    ) -> dict[str, object]:
        if type(held_trust_lease) is not HeldTrustDispatchLease:
            raise TypeError("dispatch requires a held trust lease")
        if not callable(actuator):
            raise TypeError("actuator must be an in-process callback")
        with self._command_lock(command) as lock:
            if command.command_id in self._dispatched_commands:
                raise EvidenceConflict("controller already consumed this power dispatch")
            head = self._require_current_head(command, lock)
            if head["commandState"] != "EXECUTION_STARTED":
                raise EvidenceConflict(
                    "power action is ineligible or already dispatched"
                )
            binding = self._dispatch_binding(command, head, lock)
            if held_trust_lease.controller_public_key != self.signing_authority.public_key:
                raise EvidenceConflict("controller signer does not match ACTIVE trust")
            lease = held_trust_lease.validate_for(
                workspace_id=command.workspace_id,
                gate_id=command.gate_id,
                binding=binding,
            )
            if (
                lease.selected_trust_generation_ref
                != command.selected_trust_generation_ref
                or lease.selected_current_trust_digest
                != command.selected_current_trust_digest
            ):
                raise EvidenceConflict(
                    "trust dispatch lease does not match frozen command trust"
                )
            dispatched = self._append(
                self._common(command, head["commandIdentityDigest"], lock),
                state="ACTION_DISPATCHED",
                previous=head,
                dispatch_invocation_digest=held_trust_lease.lease.trust_dispatch_lease_digest,
            )
            self._dispatched_commands.add(command.command_id)
            self._require_live()
            actuator()
            self._require_live()
            return self._append(
                self._common(command, head["commandIdentityDigest"], lock),
                state="EXECUTED",
                previous=dispatched,
            )

    def prepare_dispatch_binding(
        self,
        command: PowerCommand,
    ) -> TrustDispatchBinding:
        """Measure the command lock without acquiring it; trust lock comes first."""
        if type(command) is not PowerCommand:
            raise TypeError("command must be concrete")
        if self.pid != os.getpid():
            raise EvidenceConflict("controller calls cannot cross a process boundary")
        with self._call_lock:
            self._require_live()
            measured = self.store.measure_lock(f"commands/{command.command_id}/.lock")
            head = self._require_current_head(command, measured, recover=False)
            if head["commandState"] != "EXECUTION_STARTED":
                raise EvidenceConflict("power action is not ready for admission")
            return self._dispatch_binding(command, head, measured)

    def _dispatch_binding(
        self,
        command: PowerCommand,
        head: dict[str, object],
        lock: _HeldFileLock,
    ) -> TrustDispatchBinding:
        request_digest = _digest(
            _REQUEST_DOMAIN,
            {
                "operation": "EXECUTE_POWER_ACTION",
                "commandId": command.command_id,
                "expectedHeadDigest": head["commandJournalHeadDigest"],
                "controllerRuntimeEpochDigest": self.epoch[
                    "controllerRuntimeEpochDigest"
                ],
            },
        )
        lock_digest = _digest(
            _LOCK_DOMAIN,
            {
                "commandId": command.command_id,
                "deviceId": lock.device_id,
                "inode": lock.inode,
                "controllerRuntimeEpochDigest": self.epoch[
                    "controllerRuntimeEpochDigest"
                ],
            },
        )
        return TrustDispatchBinding(
            controller_runtime_epoch_id=self.epoch[
                "controllerRuntimeEpochId"
            ],
            controller_runtime_epoch_digest=self.epoch[
                "controllerRuntimeEpochDigest"
            ],
            command_id=command.command_id,
            command_identity_digest=str(head["commandIdentityDigest"]),
            resolution_request_digest=request_digest,
            expected_head_digest=str(head["commandJournalHeadDigest"]),
            command_lock_identity_digest=lock_digest,
            holder_process_start_identity=self.process_start_identity,
        )

    def _common(
        self,
        command: PowerCommand,
        identity_digest: str,
        lock: _HeldFileLock,
    ) -> dict[str, object]:
        return {
            "commandId": command.command_id,
            "workspaceId": command.workspace_id,
            "gateId": command.gate_id,
            "crashFixtureId": command.crash_fixture_id,
            "qualificationRunId": command.qualification_run_id,
            "caseId": command.case_id,
            "expectationDigest": command.expectation_digest,
            "executionStartDigest": command.execution_start_digest,
            "interruptionPoint": command.interruption_point,
            "releaseTokenSha256": command.release_token_sha256,
            "selectedTrustGenerationRef": (
                command.selected_trust_generation_ref.to_dict()
            ),
            "selectedCurrentTrustDigest": command.selected_current_trust_digest,
            "controllerIdentityDigest": self.controller_identity_digest,
            "controllerRuntimeEpochId": self.epoch[
                "controllerRuntimeEpochId"
            ],
            "controllerRuntimeEpochDigest": self.epoch[
                "controllerRuntimeEpochDigest"
            ],
            "commandIdentityDigest": identity_digest,
            "commandLockDeviceId": lock.device_id,
            "commandLockInode": lock.inode,
        }

    def _append(
        self,
        common: dict[str, object],
        *,
        state: str,
        previous: dict[str, object] | None,
        dispatch_invocation_digest: str | None = None,
    ) -> dict[str, object]:
        self._require_live()
        measured = self.store.measure_lock(f"commands/{common['commandId']}/.lock")
        if (measured.device_id, measured.inode) != (
            common["commandLockDeviceId"], common["commandLockInode"]
        ):
            raise EvidenceConflict("controller command lock identity changed")
        sequence = 1 if previous is None else int(previous["transitionSequence"]) + 1
        payload = {
            "artifactKind": "acceptance-power-controller-command-journal",
            "schemaVersion": 1,
            **common,
            "transitionSequence": sequence,
            "commandState": state,
            "previousJournalDigest": (
                None if previous is None else previous["commandJournalDigest"]
            ),
            "expectedHeadDigest": (
                None
                if previous is None
                else previous["commandJournalHeadDigest"]
            ),
            "dispatchInvocationDigest": dispatch_invocation_digest,
            "transitionedAt": _utc_now(),
            "signatureAlgorithm": "ED25519",
        }
        payload["signatureHex"] = self.signing_authority.sign_payload(payload)
        payload["commandJournalDigest"] = _digest(_JOURNAL_DOMAIN, payload)
        command_id = str(common["commandId"])
        self.store.write_immutable(
            f"commands/{command_id}/transitions/{sequence}-{state}.json",
            payload,
        )
        head = self._journal_head(payload)
        self.store.replace(f"commands/{command_id}/head.json", head)
        return head

    @staticmethod
    def _journal_head(payload: dict[str, object]) -> dict[str, object]:
        head = {
            "artifactKind": "acceptance-power-controller-command-journal-head",
            "schemaVersion": 1,
            "commandId": payload["commandId"],
            "controllerRuntimeEpochId": payload["controllerRuntimeEpochId"],
            "controllerRuntimeEpochDigest": payload[
                "controllerRuntimeEpochDigest"
            ],
            "commandIdentityDigest": payload["commandIdentityDigest"],
            "transitionSequence": payload["transitionSequence"],
            "commandState": payload["commandState"],
            "commandJournalDigest": payload["commandJournalDigest"],
        }
        head["commandJournalHeadDigest"] = _digest(_HEAD_DOMAIN, head)
        return head

    def _verify_signed(
        self, value: dict[str, object], digest_key: str, domain: str
    ) -> None:
        if (
            value.get("signatureAlgorithm") != "ED25519"
            or type(value.get("schemaVersion")) is not int
            or value["schemaVersion"] != 1
        ):
            raise EvidenceManifestInvalid("controller signed schema is invalid")
        signed = {key: item for key, item in value.items() if key != digest_key}
        unsigned = {key: item for key, item in signed.items() if key != "signatureHex"}
        digest_payload = unsigned if digest_key == "controllerRuntimeEpochDigest" else signed
        if value.get(digest_key) != _digest(domain, digest_payload):
            raise EvidenceManifestInvalid("controller signed digest is invalid")
        self.signing_authority.verify_payload(
            unsigned,
            value.get("signatureHex"),
        )

    def _resolve_head(
        self, command: PowerCommand, lock: "_HeldFileLock", *, recover: bool = True
    ) -> dict[str, object] | None:
        """Validate the bounded signed chain; adopt only one safe live successor."""
        base = f"commands/{command.command_id}"
        head = self.store.read_optional(f"{base}/head.json")
        if head is not None and (
            head.get("controllerRuntimeEpochDigest") != self.epoch["controllerRuntimeEpochDigest"]
            or head.get("commandIdentityDigest") != command.identity_digest(
                self.epoch["controllerRuntimeEpochDigest"]
            )
        ):
            raise EvidenceConflict("controller command belongs to another epoch or identity")
        names = self.store.entries(f"{base}/transitions", maximum=7)
        common = self._common(
            command, command.identity_digest(self.epoch["controllerRuntimeEpochDigest"]), lock
        )
        chain: list[tuple[dict[str, object], dict[str, object], str]] = []
        previous = None
        for sequence, name in enumerate(names, start=1):
            entry = self.store.read(f"{base}/transitions/{name}")
            self._verify_signed(entry, "commandJournalDigest", _JOURNAL_DOMAIN)
            state = entry.get("commandState")
            metadata = {
                "artifactKind", "schemaVersion", "transitionSequence", "commandState",
                "previousJournalDigest", "expectedHeadDigest", "dispatchInvocationDigest",
                "transitionedAt", "signatureAlgorithm", "signatureHex", "commandJournalDigest",
            }
            if (
                set(entry) != set(common) | metadata
                or any(entry.get(key) != item for key, item in common.items())
                or entry["artifactKind"] != "acceptance-power-controller-command-journal"
                or type(entry["transitionSequence"]) is not int
                or entry["transitionSequence"] != sequence
                or name != f"{sequence}-{state}.json"
                or (previous is None and state != "ACCEPTED")
                or (previous is not None and state not in self._EDGES[previous["commandState"]])
                or entry["previousJournalDigest"] != (
                    None if previous is None else previous["commandJournalDigest"]
                )
                or entry["expectedHeadDigest"] != (
                    None if previous is None else previous["commandJournalHeadDigest"]
                )
            ):
                raise EvidenceManifestInvalid("controller journal chain is invalid")
            if state == "ACTION_DISPATCHED":
                try:
                    contracts.validate_sha256(entry["dispatchInvocationDigest"])
                except ValueError as error:
                    raise EvidenceManifestInvalid("dispatch invocation digest is invalid") from error
            elif entry["dispatchInvocationDigest"] is not None:
                raise EvidenceManifestInvalid("non-dispatch entry carries an invocation")
            previous = self._journal_head(entry)
            chain.append((entry, previous, name))
        if not chain:
            if head is not None:
                raise EvidenceManifestInvalid("controller head has no signed journal")
            return None
        selected = 0 if head is None else head.get("transitionSequence")
        if type(selected) is not int or not 0 <= selected <= len(chain):
            raise EvidenceManifestInvalid("controller head sequence is invalid")
        if selected and head != chain[selected - 1][1]:
            raise EvidenceManifestInvalid("controller head differs from its signed journal")
        if len(chain) - selected > 1:
            raise EvidenceManifestInvalid("controller journal contains multiple unheaded successors")
        if len(chain) != selected:
            if not recover or chain[-1][1]["commandState"] == "ACTION_DISPATCHED":
                raise EvidenceConflict("unheaded controller dispatch or transition is uncertain")
            head = chain[-1][1]
        # Namespace visibility does not prove the predecessor's durability.
        if recover:
            for entry, ignored, name in chain:
                self.store.write_immutable(f"{base}/transitions/{name}", entry)
            self.store.replace(f"{base}/head.json", head)
        return head

    def _require_current_head(
        self, command: PowerCommand, lock: "_HeldFileLock", *, recover: bool = True
    ) -> dict[str, object]:
        head = self._resolve_head(command, lock, recover=recover)
        if head is None:
            raise EvidenceConflict("controller command head is missing")
        return head

    def _validated_equal_retry(self, head: dict[str, object]) -> dict[str, object]:
        if head["commandState"] == "ACTION_DISPATCHED":
            raise EvidenceConflict("power action dispatch is uncertain")
        return head

    def close(self) -> None:
        if self.pid != os.getpid():
            # An inherited descriptor must never unlock the parent's open-file description.
            descriptor, self._epoch_lock.descriptor = self._epoch_lock.descriptor, -1
            self._closed = True
            if descriptor >= 0:
                os.close(descriptor)
            return
        with self._call_lock:
            self._closed = True
            self._epoch_lock.close()

    def __enter__(self) -> "PowerController":
        self._require_live()
        return self

    def __exit__(self, *ignored: object) -> None:
        self.close()
