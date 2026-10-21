"""Read-only ACTIVE controller-trust admission under the Gate publish lock."""

from __future__ import annotations

import os
import secrets
import hashlib
from dataclasses import dataclass

from . import finalization_contracts as contracts
from .evidence_store import EvidenceStore, GatePublishLock
from .errors import EvidenceConflict, EvidenceManifestInvalid


@dataclass(frozen=True)
class TrustDispatchBinding:
    controller_runtime_epoch_id: str
    controller_runtime_epoch_digest: str
    command_id: str
    command_identity_digest: str
    resolution_request_digest: str
    expected_head_digest: str
    command_lock_identity_digest: str
    holder_process_start_identity: contracts.ProcessStartIdentity


class HeldTrustDispatchLease:
    """Owns the shared publish lock for exactly one in-process dispatch."""

    def __init__(
        self,
        lease: contracts.TrustDispatchLease,
        publish_lock: GatePublishLock,
        controller_public_key: bytes,
    ) -> None:
        if (
            type(lease) is not contracts.TrustDispatchLease
            or type(publish_lock) is not GatePublishLock
            or not publish_lock.held
            or not publish_lock.shared
            or lease.publish_lock_identity != publish_lock.identity
            or lease.holder_pid != os.getpid()
        ):
            raise EvidenceConflict("trust lease must bind its held shared publish lock")
        if type(controller_public_key) is not bytes or len(controller_public_key) != 32:
            raise ValueError("trust admission requires the resolved Ed25519 public key")
        self.lease = lease
        self._controller_public_key = controller_public_key
        self._publish_lock = publish_lock
        self._closed = False

    @property
    def held(self) -> bool:
        return not self._closed and self._publish_lock.held

    @property
    def controller_public_key(self) -> bytes:
        return self._controller_public_key

    def validate_for(
        self,
        *,
        workspace_id: str,
        gate_id: str,
        binding: TrustDispatchBinding,
    ) -> contracts.TrustDispatchLease:
        if not self.held:
            raise EvidenceConflict("trust dispatch lease is not held")
        lease = self.lease
        expected = (
            workspace_id,
            gate_id,
            binding.controller_runtime_epoch_id,
            binding.controller_runtime_epoch_digest,
            binding.command_id,
            binding.command_identity_digest,
            binding.resolution_request_digest,
            binding.expected_head_digest,
            binding.command_lock_identity_digest,
            os.getpid(),
            binding.holder_process_start_identity,
        )
        observed = (
            lease.workspace_id,
            lease.gate_id,
            lease.controller_runtime_epoch_id,
            lease.controller_runtime_epoch_digest,
            lease.command_id,
            lease.command_identity_digest,
            lease.resolution_request_digest,
            lease.expected_head_digest,
            lease.command_lock_identity_digest,
            lease.holder_pid,
            lease.holder_process_start_identity,
        )
        if observed != expected:
            raise EvidenceConflict("trust dispatch lease binding mismatch")
        return lease

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._publish_lock.close()

    def __enter__(self) -> "HeldTrustDispatchLease":
        if not self.held:
            raise EvidenceConflict("trust dispatch lease is already closed")
        return self

    def __exit__(self, *ignored: object) -> None:
        self.close()

    def __reduce__(self) -> object:
        raise TypeError("HeldTrustDispatchLease is process-local")


class TrustAdmission:
    """Resolves ACTIVE trust and lends only a command-bound shared lock."""

    def __init__(self, store: EvidenceStore) -> None:
        if type(store) is not EvidenceStore:
            raise TypeError("TrustAdmission requires a concrete EvidenceStore")
        self._store = store

    def acquire_dispatch_lease(
        self,
        *,
        gate_id: str,
        binding: TrustDispatchBinding,
        expected_generation_ref: contracts.PowerControllerTrustGenerationRef,
        expected_current_trust_digest: str,
        timeout_seconds: float = 10.0,
    ) -> HeldTrustDispatchLease:
        if type(binding) is not TrustDispatchBinding:
            raise TypeError("dispatch binding must be concrete")
        if type(expected_generation_ref) is not contracts.PowerControllerTrustGenerationRef:
            raise TypeError("expected generation ref must be concrete")
        contracts.validate_sha256(expected_current_trust_digest)
        publish_lock = self._store.acquire_gate_publish_lock(
            gate_id,
            shared=True,
            timeout_seconds=timeout_seconds,
        )
        try:
            current, generation, anchor = (
                self._store.read_active_power_controller_trust(
                    gate_id,
                    publish_lock=publish_lock,
                )
            )
            if (
                current.generation_ref != expected_generation_ref
                or current.current_trust_digest != expected_current_trust_digest
                or generation.reference() != expected_generation_ref
                or anchor["trustAnchorDigest"] != generation.trust_anchor_digest
            ):
                raise EvidenceManifestInvalid(
                    "ACTIVE controller trust changed before dispatch"
                )
            public_key_hex = anchor.get("controllerPublicKeyHex")
            if (
                anchor.get("controllerSignatureAlgorithm") != "ED25519"
                or type(public_key_hex) is not str
                or len(public_key_hex) != 64
                or any(character not in "0123456789abcdef" for character in public_key_hex)
            ):
                raise EvidenceManifestInvalid("ACTIVE controller public key encoding is invalid")
            public_key = bytes.fromhex(public_key_hex)
            if hashlib.sha256(public_key).hexdigest() != anchor.get("controllerPublicKeySha256"):
                raise EvidenceManifestInvalid("ACTIVE controller public key hash mismatch")
            lease = contracts.TrustDispatchLease.create(
                workspace_id=self._store.workspace_id,
                gate_id=gate_id,
                selected_trust_generation_ref=current.generation_ref,
                selected_current_trust_digest=current.current_trust_digest,
                controller_runtime_epoch_id=(
                    binding.controller_runtime_epoch_id
                ),
                controller_runtime_epoch_digest=(
                    binding.controller_runtime_epoch_digest
                ),
                command_id=binding.command_id,
                command_identity_digest=binding.command_identity_digest,
                resolution_request_digest=binding.resolution_request_digest,
                expected_head_digest=binding.expected_head_digest,
                command_lock_identity_digest=(
                    binding.command_lock_identity_digest
                ),
                holder_pid=os.getpid(),
                holder_process_start_identity=(
                    binding.holder_process_start_identity
                ),
                publish_lock_identity=publish_lock.identity,
                random_lease_bytes=secrets.token_bytes(32),
            )
            return HeldTrustDispatchLease(lease, publish_lock, public_key)
        except BaseException:
            publish_lock.close()
            raise
