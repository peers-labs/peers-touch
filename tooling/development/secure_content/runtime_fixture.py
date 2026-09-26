"""Source-bound fixture ownership for Secure Content runtime commands."""

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
from tooling.development.secure_content.runtime_manifest import (
    FIXTURE_MANIFEST_KIND,
)


FixtureAction = Callable[
    [str, Mapping[str, object], float, threading.Event],
    Mapping[str, object],
]


def canonical_digest(value: Mapping[str, object]) -> str:
    return hashlib.sha256(
        json.dumps(
            dict(value),
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()


@dataclass(frozen=True)
class RuntimeFixtureBinding:
    capability: str
    owner: str
    opaque_id: str
    expected_identity_digest: str
    operations: frozenset[str]
    action: FixtureAction
    sensitive_values: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        for field_name in ("capability", "owner", "opaque_id"):
            value = getattr(self, field_name)
            if not value or value != value.strip():
                raise ValueError(
                    f"runtime fixture {field_name} is invalid"
                )
        if (
            len(self.expected_identity_digest) != 64
            or any(
                character not in "0123456789abcdef"
                for character in self.expected_identity_digest
            )
        ):
            raise ValueError("runtime fixture identity digest is invalid")
        if not self.operations or any(
            not operation or operation != operation.strip()
            for operation in self.operations
        ):
            raise ValueError("runtime fixture operations are invalid")


class RuntimeFixtureCapabilityHandler(EphemeralCapabilityHandler):
    def __init__(
        self,
        binding: RuntimeFixtureBinding,
        runtime_manifest_digests: frozenset[str],
    ) -> None:
        if (
            not runtime_manifest_digests
            or any(
                len(digest) != 64
                or any(
                    character not in "0123456789abcdef"
                    for character in digest
                )
                for digest in runtime_manifest_digests
            )
        ):
            raise ValueError("runtime fixture manifest binding is invalid")
        self._binding = binding
        self._runtime_manifest_digests = runtime_manifest_digests
        self._action: FixtureAction | None = binding.action
        self._closed = False

    @property
    def allowed_operations(self) -> tuple[str, ...]:
        return tuple(sorted(self._binding.operations))

    @property
    def sensitive_values(self) -> tuple[str, ...]:
        return tuple(
            dict.fromkeys(
                value for value in self._binding.sensitive_values if value
            )
        )

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
                "Secure Content runtime fixture owner is unavailable",
                resource=f"fixture:{self._binding.capability}",
            )
        if operation not in self._binding.operations:
            raise EphemeralCapabilityBlocked(
                "Secure Content runtime fixture operation is not allowed",
                resource=f"fixture:{self._binding.capability}:{operation}",
            )
        if set(payload) != {
            "actionPayload",
            "expectedIdentityDigest",
            "handleId",
            "runtimeManifestDigest",
        }:
            raise EphemeralCapabilityBlocked(
                "Secure Content runtime fixture request has an invalid shape",
                resource=f"fixture:{self._binding.capability}",
            )
        if (
            payload.get("handleId") != self._binding.opaque_id
            or payload.get("expectedIdentityDigest")
            != self._binding.expected_identity_digest
        ):
            raise EphemeralCapabilityBlocked(
                "Secure Content runtime fixture handle identity does not match",
                resource=f"fixture:{self._binding.capability}",
            )
        manifest_digest = payload.get("runtimeManifestDigest")
        action_payload = payload.get("actionPayload")
        if (
            not isinstance(manifest_digest, str)
            or manifest_digest not in self._runtime_manifest_digests
            or not isinstance(action_payload, Mapping)
        ):
            raise EphemeralCapabilityBlocked(
                "Secure Content runtime fixture action binding is invalid",
                resource=f"fixture:{self._binding.capability}",
            )
        try:
            outcome = self._action(
                operation,
                MappingProxyType(dict(action_payload)),
                deadline_monotonic,
                cancellation,
            )
        except EphemeralCapabilityBlocked:
            raise
        except Exception as error:
            raise EphemeralCapabilityBlocked(
                "Secure Content runtime fixture action failed",
                resource=f"fixture:{self._binding.capability}:{operation}",
            ) from error
        if not isinstance(outcome, Mapping):
            raise EphemeralCapabilityBlocked(
                "Secure Content runtime fixture outcome is invalid",
                resource=f"fixture:{self._binding.capability}:{operation}",
            )
        acknowledgement: dict[str, object] = {
            "schemaVersion": 1,
            "capability": self._binding.capability,
            "operation": operation,
            "handleId": self._binding.opaque_id,
            "expectedIdentityDigest": self._binding.expected_identity_digest,
            "runtimeManifestDigest": manifest_digest,
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
            or result.get("capability") != self._binding.capability
            or result.get("operation") != operation
        ):
            raise ValueError(
                "Secure Content runtime fixture acknowledgement is invalid"
            )
        return projected

    def quarantine(self, reason: str, *, deadline_monotonic: float) -> bool:
        del reason
        self._action = None
        self._runtime_manifest_digests = frozenset()
        self._closed = True
        return time.monotonic() < deadline_monotonic

    def close(self) -> EphemeralHandlerCleanup:
        self._action = None
        self._runtime_manifest_digests = frozenset()
        self._closed = True
        return EphemeralHandlerCleanup(closed=True, secrets_zeroized=True)


class RuntimeFixtureOwner:
    def __init__(
        self,
        *,
        source_checkpoint: str,
        run_id: str,
        fixture_set_id: str,
        bindings: Sequence[RuntimeFixtureBinding],
    ) -> None:
        by_capability = {
            binding.capability: binding for binding in bindings
        }
        if not by_capability or len(by_capability) != len(tuple(bindings)):
            raise ValueError(
                "runtime fixture bindings must be non-empty and unique"
            )
        self.source_checkpoint = source_checkpoint
        self.run_id = run_id
        self.fixture_set_id = fixture_set_id
        self.bindings = MappingProxyType(by_capability)

    def manifest(self) -> dict[str, object]:
        handles = [
            {
                "kind": f"{binding.capability}-fixture",
                "opaque_id": binding.opaque_id,
                "owner": binding.owner,
                "capability": binding.capability,
                "expected_identity_digest": (
                    binding.expected_identity_digest
                ),
            }
            for binding in (
                self.bindings[capability]
                for capability in sorted(self.bindings)
            )
        ]
        payload: dict[str, object] = {
            "schema_version": 1,
            "kind": FIXTURE_MANIFEST_KIND,
            "fixture_set_id": self.fixture_set_id,
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
        descriptor = os.open(
            path,
            os.O_CREAT | os.O_EXCL | os.O_WRONLY,
            0o600,
        )
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
        capabilities = tuple(sorted(bindings))
        context = EphemeralGateLaunchContext(
            required_capabilities=capabilities,
            request_timeout_seconds=120.0,
            quiesce_timeout_seconds=30.0,
        )
        manifest_digests = frozenset(runtime_manifest_digests)
        for capability, binding in bindings.items():
            context.register_capability(
                capability,
                RuntimeFixtureCapabilityHandler(
                    binding,
                    manifest_digests,
                ),
            )
        context.seal(
            workspace_id=workspace_id,
            gate_id=gate_id,
            evidence_run_id=self.run_id,
            provisioning_run_id=self.run_id,
        )
        launch_binding = context.bind_child()
        child_descriptor = os.dup(launch_binding.pass_fds[0])
        context.activate()
        launch_binding.close_parent_copy()
        client = EphemeralGateClient(
            child_descriptor,
            workspace_id=workspace_id,
            gate_id=gate_id,
            evidence_run_id=self.run_id,
            provisioning_run_id=self.run_id,
        )
        self.bindings = MappingProxyType({})
        return context, client
