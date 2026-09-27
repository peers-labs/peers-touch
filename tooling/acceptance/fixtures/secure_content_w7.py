"""Owner-side contracts for Secure Content W7 lifecycle fixtures."""

from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Callable, Mapping, Sequence

from tooling.acceptance.core import (
    EphemeralCapabilityBlocked,
    EphemeralCapabilityHandler,
    EphemeralGateClient,
    EphemeralGateLaunchContext,
    EphemeralHandlerCleanup,
)


FIXTURE_MANIFEST_KIND = "secure-content-fixture-manifest"
W7_FIXTURE_SET_ID = "secure-content-w7"
W7_FIXTURE_OPERATIONS = MappingProxyType(
    {
        "account-switch": "round-trip",
        "station-switch": "round-trip",
        "publisher-device-revocation": "revoke",
        "historical-recovery-epoch": "advance",
    }
)
W7_FIXTURE_OWNERS = MappingProxyType(
    {
        "account-switch": "actor-session-provisioner",
        "station-switch": "environment-runtime-provisioner",
        "publisher-device-revocation": "actor-identity-provisioner",
        "historical-recovery-epoch": "recovery-key-exchange-provisioner",
    }
)

FixtureAction = Callable[
    [Mapping[str, object], float, threading.Event],
    Mapping[str, object],
]


def canonical_digest(value: Mapping[str, object]) -> str:
    encoded = json.dumps(
        dict(value),
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


@dataclass(frozen=True)
class W7FixtureBinding:
    capability: str
    opaque_id: str
    expected_identity_digest: str
    action: FixtureAction
    sensitive_values: tuple[str, ...] = ()
    secret_channel_ref: str | None = None

    def __post_init__(self) -> None:
        if self.capability not in W7_FIXTURE_OPERATIONS:
            raise ValueError(f"unsupported W7 fixture capability: {self.capability}")
        if not self.opaque_id or self.opaque_id != self.opaque_id.strip():
            raise ValueError("W7 fixture opaque ID is invalid")
        if (
            len(self.expected_identity_digest) != 64
            or any(
                character not in "0123456789abcdef"
                for character in self.expected_identity_digest
            )
        ):
            raise ValueError("W7 fixture identity digest is invalid")
        if (
            self.capability == "historical-recovery-epoch"
            and self.secret_channel_ref != "w7-recovery-secret-channel"
        ):
            raise ValueError(
                "historical recovery fixture requires its ephemeral secret channel"
            )


class W7FixtureCapabilityHandler(EphemeralCapabilityHandler):
    """Execute one owner-held fixture action without exposing its raw inputs."""

    def __init__(
        self,
        binding: W7FixtureBinding,
        runtime_manifest_digests: frozenset[str],
    ) -> None:
        if (
            not runtime_manifest_digests
            or any(
                len(digest) != 64
                or any(character not in "0123456789abcdef" for character in digest)
                for digest in runtime_manifest_digests
            )
        ):
            raise ValueError("W7 fixture runtime manifest binding is invalid")
        self._capability = binding.capability
        self._opaque_id = binding.opaque_id
        self._expected_identity_digest = binding.expected_identity_digest
        self._runtime_manifest_digests = runtime_manifest_digests
        self._action: FixtureAction | None = binding.action
        self._sensitive_values = tuple(
            dict.fromkeys(value for value in binding.sensitive_values if value)
        )
        self._closed = False

    @property
    def allowed_operations(self) -> tuple[str, ...]:
        return (W7_FIXTURE_OPERATIONS[self._capability],)

    @property
    def sensitive_values(self) -> tuple[str, ...]:
        return self._sensitive_values

    def invoke(
        self,
        operation: str,
        payload: Mapping[str, object],
        *,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> Mapping[str, object]:
        if (
            self._closed
            or self._action is None
            or cancellation.is_set()
            or time.monotonic() >= deadline_monotonic
        ):
            raise EphemeralCapabilityBlocked(
                "Secure Content W7 fixture owner is unavailable",
                resource=f"fixture:{self._capability}",
            )
        if set(payload) != {
            "actionPayload",
            "expectedIdentityDigest",
            "handleId",
            "runtimeManifestDigest",
        }:
            raise EphemeralCapabilityBlocked(
                "Secure Content W7 fixture request has an invalid shape",
                resource=f"fixture:{self._capability}",
            )
        if (
            payload.get("handleId") != self._opaque_id
            or payload.get("expectedIdentityDigest")
            != self._expected_identity_digest
        ):
            raise EphemeralCapabilityBlocked(
                "Secure Content W7 fixture handle identity does not match",
                resource=f"fixture:{self._capability}",
            )
        runtime_manifest_digest = payload.get("runtimeManifestDigest")
        action_payload = payload.get("actionPayload")
        if (
            not isinstance(runtime_manifest_digest, str)
            or runtime_manifest_digest not in self._runtime_manifest_digests
            or not isinstance(action_payload, Mapping)
        ):
            raise EphemeralCapabilityBlocked(
                "Secure Content W7 fixture action binding is invalid",
                resource=f"fixture:{self._capability}",
            )
        try:
            outcome = self._action(
                MappingProxyType(dict(action_payload)),
                deadline_monotonic,
                cancellation,
            )
        except EphemeralCapabilityBlocked:
            raise
        except (TimeoutError, ValueError) as error:
            raise EphemeralCapabilityBlocked(
                "Secure Content W7 fixture action is unavailable",
                resource=f"fixture:{self._capability}",
            ) from error
        except Exception as error:
            raise EphemeralCapabilityBlocked(
                "Secure Content W7 fixture owner action failed",
                resource=f"fixture:{self._capability}",
            ) from error
        if (
            not isinstance(outcome, Mapping)
            or outcome.get("fixtureIdentityDigest")
            != self._expected_identity_digest
        ):
            raise EphemeralCapabilityBlocked(
                "Secure Content W7 fixture action identity does not match",
                resource=f"fixture:{self._capability}",
            )
        acknowledgement: dict[str, object] = {
            "schemaVersion": 1,
            "capability": self._capability,
            "operation": operation,
            "handleId": self._opaque_id,
            "expectedIdentityDigest": self._expected_identity_digest,
            "runtimeManifestDigest": runtime_manifest_digest,
            "outcome": dict(outcome),
        }
        acknowledgement["acknowledgementDigest"] = canonical_digest(
            acknowledgement
        )
        return acknowledgement

    def project_response(
        self,
        operation: str,
        response: Mapping[str, object],
    ) -> Mapping[str, object]:
        projected = dict(response)
        if projected.get("status") != "OK":
            return projected
        result = projected.get("result")
        if (
            not isinstance(result, Mapping)
            or set(result)
            != {
                "schemaVersion",
                "capability",
                "operation",
                "handleId",
                "expectedIdentityDigest",
                "runtimeManifestDigest",
                "outcome",
                "acknowledgementDigest",
            }
            or result.get("operation") != operation
        ):
            raise ValueError("W7 fixture acknowledgement has an invalid shape")
        return projected

    def quarantine(self, reason: str, *, deadline_monotonic: float) -> bool:
        del reason
        self._action = None
        self._runtime_manifest_digests = frozenset()
        self._sensitive_values = ()
        self._closed = True
        return time.monotonic() < deadline_monotonic

    def close(self) -> EphemeralHandlerCleanup:
        self._action = None
        self._runtime_manifest_digests = frozenset()
        self._sensitive_values = ()
        self._closed = True
        return EphemeralHandlerCleanup(closed=True, secrets_zeroized=True)


class W7FixtureOwner:
    """Publish one source-bound fixture manifest and its ephemeral handlers."""

    def __init__(
        self,
        *,
        source_checkpoint: str,
        run_id: str,
        bindings: Sequence[W7FixtureBinding],
    ) -> None:
        by_capability = {binding.capability: binding for binding in bindings}
        if set(by_capability) != set(W7_FIXTURE_OPERATIONS):
            missing = sorted(set(W7_FIXTURE_OPERATIONS) - set(by_capability))
            extra = sorted(set(by_capability) - set(W7_FIXTURE_OPERATIONS))
            raise ValueError(
                "W7 fixture bindings must exactly match the required capabilities"
                f"; missing={missing}; extra={extra}"
            )
        if len(by_capability) != len(tuple(bindings)):
            raise ValueError("W7 fixture bindings contain duplicate capabilities")
        self.source_checkpoint = source_checkpoint
        self.run_id = run_id
        self.bindings = MappingProxyType(by_capability)

    def manifest(self) -> dict[str, object]:
        handles: list[dict[str, object]] = []
        for capability in sorted(self.bindings):
            binding = self.bindings[capability]
            handle: dict[str, object] = {
                "kind": f"{capability}-fixture",
                "opaque_id": binding.opaque_id,
                "owner": W7_FIXTURE_OWNERS[capability],
                "capability": capability,
                "expected_identity_digest": binding.expected_identity_digest,
            }
            if binding.secret_channel_ref is not None:
                handle["secret_channel_ref"] = binding.secret_channel_ref
            handles.append(handle)
        payload: dict[str, object] = {
            "schema_version": 1,
            "kind": FIXTURE_MANIFEST_KIND,
            "fixture_set_id": W7_FIXTURE_SET_ID,
            "source_checkpoint": self.source_checkpoint,
            "handles": handles,
        }
        payload["manifest_digest"] = canonical_digest(payload)
        return payload

    def write_manifest(self, path: Path) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        encoded = json.dumps(
            self.manifest(),
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        return path

    def open_action_channel(
        self,
        *,
        workspace_id: str,
        gate_id: str,
        runtime_manifest_digests: Sequence[str],
    ) -> tuple[EphemeralGateLaunchContext, EphemeralGateClient]:
        bindings = dict(self.bindings)
        manifest_digests = frozenset(runtime_manifest_digests)
        capabilities = tuple(sorted(bindings))
        if set(capabilities) != set(W7_FIXTURE_OPERATIONS):
            raise ValueError("W7 fixture action channel is already consumed")
        context = EphemeralGateLaunchContext(
            required_capabilities=capabilities,
            request_timeout_seconds=120.0,
            quiesce_timeout_seconds=30.0,
        )
        for capability in capabilities:
            context.register_capability(
                capability,
                W7FixtureCapabilityHandler(
                    bindings[capability],
                    manifest_digests,
                ),
            )
        context.seal(
            workspace_id=workspace_id,
            gate_id=gate_id,
            evidence_run_id=self.run_id,
            provisioning_run_id=self.run_id,
        )
        binding = context.bind_child()
        child_descriptor = os.dup(binding.pass_fds[0])
        context.activate()
        binding.close_parent_copy()
        client = EphemeralGateClient(
            child_descriptor,
            workspace_id=workspace_id,
            gate_id=gate_id,
            evidence_run_id=self.run_id,
            provisioning_run_id=self.run_id,
        )
        self.bindings = MappingProxyType({})
        return context, client
