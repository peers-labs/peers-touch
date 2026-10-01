from __future__ import annotations

import argparse
import hashlib
import hmac
import importlib
import json
import os
import pkgutil
import re
import signal
import subprocess
import sys
import tempfile
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from types import FrameType
from typing import Any, Callable, Iterator, Mapping, Optional, Sequence

from tooling.acceptance.core.attestation import source_proto_digest
from tooling.acceptance.core.errors import (
    EphemeralCapabilityBlocked,
    EphemeralLaunchError,
    GateError,
)
from tooling.acceptance.core.launch_context import EphemeralGateClient
from tooling.acceptance.core.redaction import (
    redact_artifact_bytes,
    redact_text,
    redact_value,
)
from tooling.development.secure_content import (
    runtime_manifest as runtime_manifest_v2,
)
from tooling.development.secure_content.source_projection import (
    SourceProjectionError,
    resolve_runtime_source_identity,
)


SCHEMA_VERSION = 1
RESULT_KIND = "peers-touch-development-result"
VERIFICATION_CLASS = "FUNCTIONAL_CHECK"
RUNTIMES = frozenset({"source-only", "service", "desktop", "mobile", "browser"})
SCENARIO_PACKAGE = "tooling.development.secure_content.scenarios"
IDENTIFIER = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$", re.IGNORECASE)
SHA256 = re.compile(r"^[0-9a-f]{64}$")
ACTIVE_DECLARATION_STATE = "ACTIVE"
PREPARED_RESULT_KIND = "peers-touch-development-prepared-result"
RESULT_RESERVED_FIELDS = frozenset(
    {
        "schemaVersion",
        "kind",
        "taskId",
        "workstreamId",
        "generationId",
        "variantId",
        "runId",
        "workItemId",
        "journeyId",
        "scenarioId",
        "runtime",
        "verificationClass",
        "result",
        "workspaceId",
        "branch",
        "sourceCommit",
        "sessionId",
        "declarationId",
        "declarationDigest",
        "runtimeBindingDigest",
        "profile",
        "profiles",
        "clients",
        "startedAt",
        "durationMs",
        "commandDigest",
        "runtimeManifestDigest",
        "runtimeManifestRef",
        "serviceIds",
        "fixtureManifestDigest",
        "proofState",
        "checks",
        "artifactRefs",
        "firstFailure",
        "completedAt",
        "resultDigest",
    }
)
MAX_BOUND_ARTIFACT_BYTES = 2 * 1024 * 1024
BOUND_ARTIFACT_FIELDS = frozenset(
    {
        "schemaVersion",
        "kind",
        "sourceCommit",
        "sessionId",
        "declarationId",
        "scenarioId",
        "journeyId",
        "runtime",
        "runtimeManifestRunId",
        "runtimeManifestDigest",
        "createdAt",
        "bindingDigest",
        "artifactDigest",
    }
)
RuntimeManifestBinding = runtime_manifest_v2.RuntimeManifestBinding
ResultVariantResolver = Callable[
    [str, Optional[str], tuple[str, ...], tuple[str, ...]],
    str,
]


class RunnerError(RuntimeError):
    pass


class ScenarioFailed(RunnerError):
    def __init__(self, message: str, result_path: Path):
        super().__init__(message)
        self.result_path = result_path


class ScenarioBudgetExceeded(RunnerError):
    pass


class ScenarioBlocked(RunnerError):
    def __init__(
        self,
        message: str,
        *,
        kind: str,
        owner: str,
        retryable: bool,
    ):
        super().__init__(message)
        self.kind = kind
        self.owner = owner
        self.retryable = retryable
        self.result_path: Optional[Path] = None


@dataclass(frozen=True)
class ScenarioDefinition:
    scenario_id: str
    journey_id: str
    work_item_id: str
    runtimes: frozenset[str]
    evidence_path: Path
    execute: Callable[["ScenarioContext"], Mapping[str, Any]]
    required_fixture_capabilities: frozenset[str] = field(
        default_factory=frozenset
    )
    result_prefix: Optional[Path] = None
    result_task_id: Optional[str] = None
    result_workstream_id: Optional[str] = None
    result_variant: Optional[str | ResultVariantResolver] = None


@dataclass(frozen=True)
class RestartRequest:
    request_id: str
    client_id: str
    parent_manifest_digest: str
    retained_storage_identity_digest: str
    resume_artifact_digest: str
    reason: str


@dataclass(frozen=True)
class FixtureHandle:
    kind: str
    owner: str
    handle_id: str
    capability: str
    digest: str
    secret_channel_ref: str | None = None



@dataclass(frozen=True)
class PendingConsumptionReceipt:
    artifact_path: Path
    artifact_bytes: bytes = field(repr=False)
    claim_path: Path
    claim_bytes: bytes = field(repr=False)
    receipt_path: Path
    receipt: Mapping[str, Any]


@dataclass
class ScenarioContext:
    repo_root: Path
    scenario_id: str
    journey_id: str
    source_commit: str
    session_id: str
    declaration_id: str
    runtime: str
    profile: Optional[str]
    profiles: tuple[str, ...]
    clients: tuple[str, ...]
    budget_seconds: int
    started_monotonic: float
    runtime_manifest: Optional[RuntimeManifestBinding] = None
    artifact_dir: Optional[Path] = None
    result_path: Optional[Path] = None
    checks: list[dict[str, Any]] = field(default_factory=list)
    artifact_refs: list[str] = field(default_factory=list)
    pending_consumption_receipts: list[PendingConsumptionReceipt] = field(
        default_factory=list
    )
    required_fixture_capabilities: frozenset[str] = field(
        default_factory=frozenset
    )
    fixture_action_client: EphemeralGateClient | None = field(
        default=None,
        repr=False,
    )
    continuation_provenance: list[tuple[Path, bytes]] = field(
        default_factory=list,
        repr=False,
    )

    def remaining_seconds(self) -> float:
        remaining = self.budget_seconds - (
            time.monotonic() - self.started_monotonic
        )
        if remaining <= 0:
            raise ScenarioBudgetExceeded("scenario budget exhausted")
        return remaining

    def block(
        self,
        message: str,
        *,
        kind: str,
        owner: str,
        retryable: bool,
    ) -> None:
        raise ScenarioBlocked(
            message,
            kind=kind,
            owner=owner,
            retryable=retryable,
        )

    def require_runtime_manifest(self) -> RuntimeManifestBinding:
        if self.runtime_manifest is None:
            raise RunnerError(
                f"{self.runtime} scenario requires --runtime-manifest"
            )
        return self.runtime_manifest

    def fixture_handle(self, capability: str) -> FixtureHandle:
        manifest = self.require_runtime_manifest()
        raw = manifest.fixture_handle(capability)
        return FixtureHandle(
            kind=str(raw["kind"]),
            owner=str(raw["owner"]),
            handle_id=str(raw["opaque_id"]),
            capability=str(raw["capability"]),
            digest=str(raw["expected_identity_digest"]),
            secret_channel_ref=(
                str(raw["secret_channel_ref"])
                if raw.get("secret_channel_ref") is not None
                else None
            ),
        )

    def invoke_fixture_action(
        self,
        capability: str,
        operation: str,
        payload: Mapping[str, object] | None = None,
    ) -> Mapping[str, Any]:
        handle = self.fixture_handle(capability)
        client = self.fixture_action_client
        if client is None:
            self.block(
                f"fixture action channel is unavailable for {capability!r}",
                kind="FIXTURE_CAPABILITY_UNAVAILABLE",
                owner=handle.owner,
                retryable=True,
            )
        manifest = self.require_runtime_manifest()
        request_id = hashlib.sha256(
            (
                f"{self.session_id}:{manifest.sha256}:{handle.handle_id}:"
                f"{operation}"
            ).encode("utf-8")
        ).hexdigest()
        try:
            acknowledgement = client.invoke(
                capability,
                operation,
                {
                    "handleId": handle.handle_id,
                    "expectedIdentityDigest": handle.digest,
                    "runtimeManifestDigest": manifest.sha256,
                    "actionPayload": dict(payload or {}),
                },
                timeout_seconds=min(120.0, self.remaining_seconds()),
                request_id=request_id,
            )
        except EphemeralCapabilityBlocked as error:
            self.block(
                str(error),
                kind="FIXTURE_CAPABILITY_UNAVAILABLE",
                owner=handle.owner,
                retryable=True,
            )
        except EphemeralLaunchError as error:
            self.block(
                str(error),
                kind=error.code,
                owner=handle.owner,
                retryable=False,
            )
        content = dict(acknowledgement)
        digest = content.pop("acknowledgementDigest", None)
        outcome = acknowledgement.get("outcome")
        if (
            acknowledgement.get("schemaVersion") != 1
            or acknowledgement.get("capability") != capability
            or acknowledgement.get("operation") != operation
            or acknowledgement.get("handleId") != handle.handle_id
            or acknowledgement.get("expectedIdentityDigest") != handle.digest
            or acknowledgement.get("runtimeManifestDigest") != manifest.sha256
            or not isinstance(outcome, Mapping)
            or outcome.get("fixtureIdentityDigest") != handle.digest
            or digest != _canonical_digest(content)
        ):
            raise RunnerError(
                f"fixture action acknowledgement is invalid for {capability!r}"
            )
        self.checks.append(
            {
                "name": f"fixture:{capability}:{operation}",
                "status": "passed",
                "detail": {
                    "acknowledgementDigest": digest,
                    "handleIdentityDigest": handle.digest,
                },
            }
        )
        return acknowledgement

    def request_restart(
        self,
        client_id: str,
        *,
        reason: str,
    ) -> RestartRequest:
        manifest = self.require_runtime_manifest()
        client = manifest.client(client_id)
        resume_paths = [
            Path(reference)
            for reference in self.artifact_refs
            if Path(reference).name.endswith("-resume.json")
        ]
        if len(resume_paths) != 1:
            raise RunnerError(
                "restart request requires exactly one immutable resume artifact"
            )
        _, resume_artifact = _read_json_artifact(resume_paths[0])
        resume_artifact_digest = resume_artifact.get("artifactDigest")
        if (
            not isinstance(resume_artifact_digest, str)
            or SHA256.fullmatch(resume_artifact_digest) is None
        ):
            raise RunnerError("restart resume artifact digest is invalid")
        request = RestartRequest(
            request_id=(
                f"restart-{self.session_id}-{client_id}-{manifest.sha256[:12]}"
            ),
            client_id=client_id,
            parent_manifest_digest=manifest.sha256,
            retained_storage_identity_digest=str(
                client["storage_identity_digest"]
            ),
            resume_artifact_digest=resume_artifact_digest,
            reason=reason,
        )
        self.write_bound_artifact_json(
            f"restart-request-{client_id}.json",
            "secure-content-runtime-restart-request",
            {
                "schema_version": 1,
                "run_id": manifest.run_id,
                "request_id": request.request_id,
                "client_id": request.client_id,
                "parent_runtime_manifest_digest": (
                    request.parent_manifest_digest
                ),
                "expected_source_checkpoint": self.source_commit,
                "expected_profile": sorted(manifest.service_profiles),
                "retained_storage_identity_digest": (
                    request.retained_storage_identity_digest
                ),
                "resume_artifact_digest": request.resume_artifact_digest,
                "reason": request.reason,
            },
        )
        self.block(
            f"restart requested for client {client_id!r}: {reason}",
            kind="BLOCKED_RUNTIME_ACTION_REQUIRED",
            owner="secure-content-w7-runtime",
            retryable=True,
        )

    def artifact_path(self, name: str) -> Path:
        if self.artifact_dir is None:
            raise RunnerError("scenario artifact directory is unavailable")
        if (
            not isinstance(name, str)
            or not name
            or name != Path(name).name
            or name in {".", ".."}
        ):
            raise RunnerError("scenario artifact name must be one file name")
        return self.artifact_dir / name

    def write_artifact_json(
        self,
        name: str,
        value: Mapping[str, Any],
    ) -> Path:
        path = self.artifact_path(name)
        _write_json_atomic(path, value)
        self._register_artifact(path)
        return path

    def write_artifact_bytes(
        self,
        name: str,
        value: bytes,
        *,
        durable: bool = True,
        secret_values: Sequence[str] = (),
    ) -> Path:
        path = self.artifact_path(name)
        redacted, _ = redact_artifact_bytes(value, tuple(secret_values))
        _write_bytes_atomic(path, redacted)
        if durable:
            self._register_artifact(path)
        return path

    def write_bound_artifact_json(
        self,
        name: str,
        kind: str,
        value: Mapping[str, Any],
    ) -> Path:
        _require_identifier(kind, "artifact kind")
        collisions = sorted(BOUND_ARTIFACT_FIELDS.intersection(value))
        if collisions:
            raise RunnerError(
                "bound artifact payload cannot replace binding fields: "
                + ", ".join(collisions)
            )
        binding = self._bound_artifact_identity(
            kind=kind,
            runtime_manifest=self.require_runtime_manifest(),
        )
        redacted_value = _redacted_mapping(value)
        path = self.artifact_path(name)
        if path.exists():
            if self._has_durable_artifact(path):
                raise RunnerError(f"immutable artifact already exists: {path}")
            _, existing = _read_json_artifact(path)
            expected_static = {
                field_name: binding[field_name]
                for field_name in (
                    "schemaVersion",
                    "kind",
                    "sourceCommit",
                    "sessionId",
                    "declarationId",
                    "scenarioId",
                    "journeyId",
                    "runtime",
                )
            }
            artifact_content = dict(existing)
            artifact_digest = artifact_content.pop("artifactDigest", None)
            existing_binding = {
                field_name: existing.get(field_name)
                for field_name in BOUND_ARTIFACT_FIELDS
                if field_name not in {"artifactDigest", "bindingDigest"}
            }
            if (
                any(existing.get(field) != expected for field, expected in expected_static.items())
                or any(existing.get(field) != expected for field, expected in redacted_value.items())
                or artifact_digest != _canonical_digest(artifact_content)
                or existing.get("bindingDigest") != _canonical_digest(existing_binding)
            ):
                raise RunnerError(
                    f"incomplete immutable artifact conflicts with retry: {path}"
                )
            self._register_artifact(path)
            return path
        payload = _redacted_mapping({**binding, **redacted_value})
        payload["artifactDigest"] = _canonical_digest(payload)
        _write_json_immutable(path, payload)
        self._register_artifact(path)
        return path

    def _has_durable_artifact(self, path: Path) -> bool:
        if self.result_path is None or not self.result_path.is_file():
            return False
        try:
            result = json.loads(self.result_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return False
        return (
            isinstance(result, dict)
            and result.get("kind") == RESULT_KIND
            and result.get("result") == "PASS"
            and result.get("scenarioId") == self.scenario_id
            and str(path) in result.get("artifactRefs", [])
        )

    def consume_bound_artifact_json(
        self,
        path: Path,
        *,
        kind: str,
        producer_scenario_id: str,
        producer_journey_id: str,
        producer_runtime: str,
        require_fresh_runtime_manifest: bool = True,
    ) -> Mapping[str, Any]:
        _require_identifier(kind, "artifact kind")
        resolved = _validate_bound_artifact_path(path, self.artifact_dir)
        raw_bytes, payload = _read_json_artifact(resolved)
        expected = {
            "schemaVersion": SCHEMA_VERSION,
            "kind": kind,
            "sourceCommit": self.source_commit,
            "sessionId": self.session_id,
            "declarationId": self.declaration_id,
            "scenarioId": producer_scenario_id,
            "journeyId": producer_journey_id,
            "runtime": producer_runtime,
        }
        for field_name, expected_value in expected.items():
            if payload.get(field_name) != expected_value:
                raise RunnerError(
                    f"bound artifact {resolved.name} has invalid {field_name}"
                )
        producer_run_id = payload.get("runtimeManifestRunId")
        producer_manifest_digest = payload.get("runtimeManifestDigest")
        if not isinstance(producer_run_id, str) or not producer_run_id:
            raise RunnerError(
                f"bound artifact {resolved.name} has invalid runtime manifest run"
            )
        if (
            not isinstance(producer_manifest_digest, str)
            or SHA256.fullmatch(producer_manifest_digest) is None
        ):
            raise RunnerError(
                f"bound artifact {resolved.name} has invalid runtime manifest digest"
            )
        binding = {
            field_name: payload.get(field_name)
            for field_name in BOUND_ARTIFACT_FIELDS
            if field_name not in {"artifactDigest", "bindingDigest"}
        }
        if payload.get("bindingDigest") != _canonical_digest(binding):
            raise RunnerError(
                f"bound artifact {resolved.name} binding digest is invalid"
            )
        artifact_content = dict(payload)
        artifact_digest = artifact_content.pop("artifactDigest", None)
        if artifact_digest != _canonical_digest(artifact_content):
            raise RunnerError(
                f"bound artifact {resolved.name} content digest is invalid"
            )

        manifest = self.require_runtime_manifest()
        artifact_created_at = _parse_timestamp(
            payload.get("createdAt"),
            f"bound artifact {resolved.name} createdAt",
        )
        manifest_captured_at = _parse_timestamp(
            manifest.payload.get("created_at"),
            "runtime manifest created_at",
        )
        if require_fresh_runtime_manifest and (
            producer_run_id == manifest.run_id
            or producer_manifest_digest == manifest.sha256
            or manifest_captured_at <= artifact_created_at
        ):
            raise RunnerError(
                f"bound artifact {resolved.name} requires a fresh runtime manifest"
            )
        if require_fresh_runtime_manifest:
            continuation = manifest.payload.get("continuation")
            if (
                not isinstance(continuation, Mapping)
                or continuation.get("parent_manifest_digest")
                != producer_manifest_digest
            ):
                raise RunnerError(
                    f"bound artifact {resolved.name} continuation lineage is invalid"
                )

        artifact_digest = hashlib.sha256(raw_bytes).hexdigest()
        claim_path = resolved.with_name(f"{resolved.stem}.consuming.json")
        receipt_path = resolved.with_name(f"{resolved.stem}.consumed.json")
        receipt = {
            "schemaVersion": SCHEMA_VERSION,
            "kind": f"{kind}-consumption",
            "artifactSha256": artifact_digest,
            "sourceCommit": self.source_commit,
            "sessionId": self.session_id,
            "declarationId": self.declaration_id,
            "consumerScenarioId": self.scenario_id,
            "consumerJourneyId": self.journey_id,
            "consumerRuntime": self.runtime,
            "consumerRuntimeManifestRunId": manifest.run_id,
            "consumerRuntimeManifestDigest": manifest.sha256,
        }
        claim = {
            **receipt,
            "kind": f"{kind}-consumption-claim",
            "claimedAt": _timestamp(),
        }
        claim["claimDigest"] = _canonical_digest(claim)
        if receipt_path.exists():
            raise RunnerError(
                "immutable consumption receipt already exists; "
                f"prepared-result recovery is required: {receipt_path}"
            )
        if claim_path.exists():
            raise RunnerError(
                "immutable consumption claim already exists; "
                f"outcome reconciliation is required: {claim_path}"
            )
        if any(
            pending.receipt_path == receipt_path
            for pending in self.pending_consumption_receipts
        ):
            raise RunnerError(
                f"immutable artifact already exists: {receipt_path}"
            )
        try:
            if resolved.read_bytes() != raw_bytes:
                raise RunnerError(
                    f"bound artifact {resolved.name} changed during consumption"
                )
        except OSError as error:
            raise RunnerError(
                f"bound artifact {resolved.name} became unreadable during consumption"
            ) from error
        _write_json_immutable(claim_path, claim)
        claim_bytes = _json_bytes(claim)
        self.pending_consumption_receipts.append(
            PendingConsumptionReceipt(
                artifact_path=resolved,
                artifact_bytes=raw_bytes,
                claim_path=claim_path,
                claim_bytes=claim_bytes,
                receipt_path=receipt_path,
                receipt=receipt,
            )
        )
        self._register_artifact(resolved)
        self._register_artifact(claim_path)
        return payload

    def consume_owner_continuation(
        self,
        resume_path: Path,
        *,
        client_id: str,
        kind: str,
        producer_scenario_id: str,
        producer_journey_id: str,
        producer_runtime: str,
    ) -> Mapping[str, Any]:
        child = self.require_runtime_manifest()
        continuation = child.payload.get("continuation")
        if not isinstance(continuation, Mapping):
            raise runtime_manifest_v2.RuntimeManifestError(
                "RUNTIME_CONTINUATION_IDENTITY_MISMATCH",
                "child runtime manifest has no owner continuation lineage",
            )
        if continuation.get("retained_client_id") != client_id:
            raise runtime_manifest_v2.RuntimeManifestError(
                "RUNTIME_CONTINUATION_IDENTITY_MISMATCH",
                "child runtime manifest retained the wrong client",
            )

        resolved_resume = _validate_bound_artifact_path(
            resume_path,
            self.artifact_dir,
        )
        _, resume_payload = _read_json_artifact(resolved_resume)
        resume_digest = resume_payload.get("artifactDigest")
        if (
            not isinstance(resume_digest, str)
            or SHA256.fullmatch(resume_digest) is None
        ):
            raise RunnerError("continuation resume artifact digest is invalid")

        if self.result_path is None or not self.result_path.is_file():
            raise runtime_manifest_v2.RuntimeManifestError(
                "RUNTIME_CONTINUATION_IDENTITY_MISMATCH",
                "continuation requires the prior blocked scenario result",
            )
        _, prior_result = _read_json_artifact(self.result_path)
        prior_failure = prior_result.get("firstFailure")
        parent_manifest_ref = prior_result.get("runtimeManifestRef")
        if (
            prior_result.get("kind") != RESULT_KIND
            or prior_result.get("result") != "BLOCKED"
            or prior_result.get("scenarioId") != self.scenario_id
            or prior_result.get("journeyId") != self.journey_id
            or prior_result.get("runtime") != self.runtime
            or prior_result.get("sourceCommit") != self.source_commit
            or not isinstance(prior_failure, Mapping)
            or prior_failure.get("kind")
            != "BLOCKED_RUNTIME_ACTION_REQUIRED"
            or prior_result.get("runtimeManifestDigest")
            != continuation.get("parent_manifest_digest")
            or not isinstance(parent_manifest_ref, str)
            or not parent_manifest_ref
        ):
            raise runtime_manifest_v2.RuntimeManifestError(
                "RUNTIME_CONTINUATION_IDENTITY_MISMATCH",
                "prior scenario result does not authorize continuation",
            )

        source = child.payload["source"]
        try:
            protocol_digest = source_proto_digest(self.repo_root)
            parent = runtime_manifest_v2.load_runtime_manifest(
                Path(parent_manifest_ref),
                journey_id=self.journey_id,
                repo_root=self.repo_root,
                workspace_identity={
                    "workspaceId": str(source["workspace_id"]),
                    "head": self.source_commit,
                    "worktreeSetDigest": str(
                        source["worktree_set_digest"]
                    ),
                },
                profile_selectors=self.profiles
                or ((self.profile,) if self.profile else ()),
                client_selectors=self.clients,
                runtime=self.runtime,
                expected_protocol_digest=protocol_digest,
                required_fixture_capabilities=tuple(
                    self.required_fixture_capabilities
                ),
            )
        except (OSError, subprocess.SubprocessError) as error:
            raise RunnerError(
                "cannot validate the parent runtime manifest"
            ) from error

        request_path = _validate_bound_artifact_path(
            self.artifact_path(f"restart-request-{client_id}.json"),
            self.artifact_dir,
        )
        acknowledgement_path = _validate_bound_artifact_path(
            self.artifact_path(
                f"restart-acknowledgement-{client_id}.json"
            ),
            self.artifact_dir,
        )
        _, restart_request = _read_json_artifact(request_path)
        request_content = dict(restart_request)
        request_digest = request_content.pop("artifactDigest", None)
        if (
            request_digest != _canonical_digest(request_content)
            or restart_request.get("runtimeManifestDigest") != parent.sha256
        ):
            raise runtime_manifest_v2.RuntimeManifestError(
                "RUNTIME_CONTINUATION_IDENTITY_MISMATCH",
                "restart request artifact identity is invalid",
            )
        acknowledgement_bytes, acknowledgement = _read_json_artifact(
            acknowledgement_path
        )

        runtime_manifest_v2.validate_owner_continuation(
            parent,
            child,
            restart_request=restart_request,
            acknowledgement=acknowledgement,
            resume_artifact_digest=resume_digest,
        )
        self.consume_bound_artifact_json(
            request_path,
            kind="secure-content-runtime-restart-request",
            producer_scenario_id=self.scenario_id,
            producer_journey_id=self.journey_id,
            producer_runtime=self.runtime,
        )
        parent.verify_unchanged()
        child.verify_unchanged()
        self.continuation_provenance = [
            (parent.path, parent.raw_bytes),
            *parent.provenance_files,
            (acknowledgement_path, acknowledgement_bytes),
        ]
        return self.consume_bound_artifact_json(
            resolved_resume,
            kind=kind,
            producer_scenario_id=producer_scenario_id,
            producer_journey_id=producer_journey_id,
            producer_runtime=producer_runtime,
        )

    def verify_continuation_unchanged(self) -> None:
        for path, expected in self.continuation_provenance:
            try:
                current = path.read_bytes()
            except OSError as error:
                raise runtime_manifest_v2.RuntimeManifestError(
                    "RUNTIME_CONTINUATION_IDENTITY_MISMATCH",
                    f"continuation evidence became unreadable: {path.name}",
                ) from error
            if not hmac.compare_digest(current, expected):
                raise runtime_manifest_v2.RuntimeManifestError(
                    "RUNTIME_CONTINUATION_IDENTITY_MISMATCH",
                    f"continuation evidence changed during scenario execution: {path.name}",
                )

    def prepare_bound_artifact_consumptions(
        self,
        prepared_result_path: Path,
        result: Mapping[str, Any],
    ) -> None:
        if not self.pending_consumption_receipts:
            return
        for pending in self.pending_consumption_receipts:
            if pending.receipt_path.exists():
                raise RunnerError(
                    f"immutable artifact already exists: {pending.receipt_path}"
                )
            try:
                if pending.artifact_path.read_bytes() != pending.artifact_bytes:
                    raise RunnerError(
                        f"bound artifact {pending.artifact_path.name} changed "
                        "before consumption succeeded"
                    )
                if not hmac.compare_digest(
                    pending.claim_path.read_bytes(),
                    pending.claim_bytes,
                ):
                    raise RunnerError(
                        f"bound artifact {pending.artifact_path.name} "
                        "consumption claim changed before completion"
                    )
            except OSError as error:
                raise RunnerError(
                    f"bound artifact {pending.artifact_path.name} or its "
                    "consumption claim became unreadable before completion"
                ) from error

        durable_result = _redacted_mapping(result)
        if durable_result.get("result") != "PASS":
            raise RunnerError("only a PASS result can prepare consumption receipts")
        result_bytes = _json_bytes(durable_result)
        result_digest = hashlib.sha256(result_bytes).hexdigest()
        consumptions: list[dict[str, Any]] = []
        receipts: list[tuple[Path, Mapping[str, Any]]] = []
        for pending in self.pending_consumption_receipts:
            receipt = _redacted_mapping(
                {
                    **pending.receipt,
                    "preparedResultSha256": result_digest,
                }
            )
            receipt_bytes = _json_bytes(receipt)
            consumptions.append(
                {
                    "artifactPath": str(pending.artifact_path),
                    "artifactSha256": hashlib.sha256(
                        pending.artifact_bytes
                    ).hexdigest(),
                    "claimPath": str(pending.claim_path),
                    "claimSha256": hashlib.sha256(
                        pending.claim_bytes
                    ).hexdigest(),
                    "receiptPath": str(pending.receipt_path),
                    "receiptSha256": hashlib.sha256(receipt_bytes).hexdigest(),
                    "receipt": receipt,
                }
            )
            receipts.append((pending.receipt_path, receipt))

        journal: dict[str, Any] = {
            "schemaVersion": SCHEMA_VERSION,
            "kind": PREPARED_RESULT_KIND,
            "preparedResultSha256": result_digest,
            "result": durable_result,
            "consumptions": consumptions,
        }
        journal["journalDigest"] = _canonical_digest(journal)
        _write_json_immutable(prepared_result_path, journal)
        for receipt_path, receipt in receipts:
            _write_json_immutable(receipt_path, receipt)
        self.pending_consumption_receipts.clear()

    def _bound_artifact_identity(
        self,
        *,
        kind: str,
        runtime_manifest: RuntimeManifestBinding,
    ) -> Mapping[str, Any]:
        binding: dict[str, Any] = {
            "schemaVersion": SCHEMA_VERSION,
            "kind": kind,
            "sourceCommit": self.source_commit,
            "sessionId": self.session_id,
            "declarationId": self.declaration_id,
            "scenarioId": self.scenario_id,
            "journeyId": self.journey_id,
            "runtime": self.runtime,
            "runtimeManifestRunId": runtime_manifest.run_id,
            "runtimeManifestDigest": runtime_manifest.sha256,
            "createdAt": _timestamp(),
        }
        binding["bindingDigest"] = _canonical_digest(binding)
        return binding

    def _register_artifact(self, path: Path) -> None:
        reference = str(path)
        if reference not in self.artifact_refs:
            self.artifact_refs.append(reference)

    def run_check(
        self,
        check_id: str,
        command: Sequence[str],
        *,
        cwd: Path,
    ) -> dict[str, Any]:
        _require_identifier(check_id, "check id")
        if not command or any(not isinstance(value, str) or not value for value in command):
            raise RunnerError(f"{check_id} command must contain non-empty strings")
        remaining = self.remaining_seconds()
        started = time.monotonic()
        try:
            process = subprocess.run(
                list(command),
                cwd=cwd,
                check=False,
                capture_output=True,
                text=True,
                timeout=remaining,
            )
        except subprocess.TimeoutExpired as error:
            self.checks.append(
                {
                    "id": check_id,
                    "command": list(command),
                    "durationMs": int((time.monotonic() - started) * 1000),
                    "exitCode": None,
                    "result": "FAIL",
                }
            )
            raise ScenarioBudgetExceeded(
                f"{check_id} exceeded the scenario budget"
            ) from error
        record = {
            "id": check_id,
            "command": list(command),
            "durationMs": int((time.monotonic() - started) * 1000),
            "exitCode": process.returncode,
            "result": "PASS" if process.returncode == 0 else "FAIL",
        }
        self.checks.append(record)
        if process.returncode != 0:
            raise RunnerError(
                f"{check_id} failed with exit code {process.returncode}"
            )
        return record


CommandRunner = Callable[[list[str], Path], subprocess.CompletedProcess[str]]


def _require_identifier(value: Any, field: str) -> str:
    if (
        not isinstance(value, str)
        or value != value.strip()
        or not IDENTIFIER.fullmatch(value)
    ):
        raise RunnerError(f"{field} has an invalid identifier")
    return value


def _canonical_scenario_id(value: str) -> str:
    if not isinstance(value, str):
        raise RunnerError("scenario id must be a string")
    normalized = value.strip().replace("_", "-")
    if (
        not normalized
        or normalized != normalized.lower()
        or any(part == "" for part in normalized.split("-"))
        or any(not part.replace(".", "").isalnum() for part in normalized.split("-"))
    ):
        raise RunnerError(f"invalid scenario id: {value!r}")
    return normalized


def _validate_definition(value: Any, module_name: str) -> ScenarioDefinition:
    required = (
        "scenario_id",
        "journey_id",
        "work_item_id",
        "runtimes",
        "evidence_path",
        "execute",
        "required_fixture_capabilities",
    )
    if any(not hasattr(value, field_name) for field_name in required):
        raise RunnerError(f"{module_name} does not export a complete SCENARIO definition")
    scenario_id = _canonical_scenario_id(value.scenario_id)
    expected_module = scenario_id.replace("-", "_")
    if module_name.rsplit(".", 1)[-1] != expected_module:
        raise RunnerError(
            f"scenario module {module_name} must match id {scenario_id!r}"
        )
    runtimes = frozenset(value.runtimes)
    if not runtimes or not runtimes.issubset(RUNTIMES):
        raise RunnerError(f"scenario {scenario_id} declares unsupported runtimes")
    evidence_path = Path(value.evidence_path)
    if (
        evidence_path.is_absolute()
        or ".." in evidence_path.parts
        or evidence_path.name != "result.json"
    ):
        raise RunnerError(f"scenario {scenario_id} has an invalid evidence path")
    if not callable(value.execute):
        raise RunnerError(f"scenario {scenario_id} execute is not callable")
    required_fixture_capabilities = frozenset(
        value.required_fixture_capabilities
    )
    for capability in required_fixture_capabilities:
        _require_identifier(capability, "fixture capability")
    result_prefix = getattr(value, "result_prefix", None)
    result_task_id = getattr(value, "result_task_id", None)
    result_workstream_id = getattr(value, "result_workstream_id", None)
    result_variant = getattr(value, "result_variant", None)
    layout_fields = (
        result_prefix,
        result_task_id,
        result_workstream_id,
        result_variant,
    )
    if any(field is not None for field in layout_fields):
        if any(field is None for field in layout_fields):
            raise RunnerError(
                f"scenario {scenario_id} has an incomplete canonical result layout"
            )
        result_prefix = Path(result_prefix)
        if (
            result_prefix.is_absolute()
            or ".." in result_prefix.parts
            or result_prefix in {Path("."), Path("")}
        ):
            raise RunnerError(
                f"scenario {scenario_id} has an invalid result prefix"
            )
        _require_identifier(result_task_id, "result task id")
        _require_identifier(result_workstream_id, "result workstream id")
        if not isinstance(result_variant, str) and not callable(result_variant):
            raise RunnerError(
                f"scenario {scenario_id} has an invalid result variant"
            )
        if isinstance(result_variant, str):
            _require_identifier(result_variant, "result variant")
    return ScenarioDefinition(
        scenario_id=scenario_id,
        journey_id=_require_identifier(value.journey_id, "journey id"),
        work_item_id=_require_identifier(value.work_item_id, "work item id"),
        runtimes=runtimes,
        evidence_path=evidence_path,
        execute=value.execute,
        required_fixture_capabilities=required_fixture_capabilities,
        result_prefix=result_prefix,
        result_task_id=result_task_id,
        result_workstream_id=result_workstream_id,
        result_variant=result_variant,
    )


def discover_scenarios() -> dict[str, ScenarioDefinition]:
    package = importlib.import_module(SCENARIO_PACKAGE)
    discovered: dict[str, ScenarioDefinition] = {}
    for module_info in sorted(
        pkgutil.iter_modules(package.__path__),
        key=lambda item: item.name,
    ):
        if module_info.name.startswith("_") or module_info.name.startswith("test_"):
            continue
        module_name = f"{SCENARIO_PACKAGE}.{module_info.name}"
        module = importlib.import_module(module_name)
        if not hasattr(module, "SCENARIO"):
            raise RunnerError(f"{module_name} does not export SCENARIO")
        scenario = _validate_definition(module.SCENARIO, module_name)
        if scenario.scenario_id in discovered:
            raise RunnerError(f"duplicate scenario id: {scenario.scenario_id}")
        discovered[scenario.scenario_id] = scenario
    return discovered


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _run_command(command: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=cwd,
        check=False,
        capture_output=True,
        text=True,
    )


def _decode_json_output(
    process: subprocess.CompletedProcess[str],
    action: str,
) -> Any:
    if process.returncode != 0:
        diagnostic = (process.stderr or process.stdout).strip()
        if len(diagnostic) > 2000:
            diagnostic = diagnostic[-2000:]
        raise RunnerError(
            f"{action} failed with exit code {process.returncode}: {diagnostic}"
        )
    try:
        return json.loads(process.stdout)
    except json.JSONDecodeError as error:
        raise RunnerError(f"{action} returned invalid JSON") from error


def _workspace_identity(
    repo_root: Path,
    command_runner: CommandRunner = _run_command,
) -> Mapping[str, str]:
    process = command_runner(
        [
            sys.executable,
            "tooling/scripts/verify-worktree-binding.py",
            "--root",
            str(repo_root),
            "--capture",
        ],
        repo_root,
    )
    identity = _decode_json_output(process, "worktree binding capture")
    if not isinstance(identity, dict):
        raise RunnerError("worktree verifier returned a non-object identity")
    for field_name in ("root", "workspaceId", "branch", "head"):
        if not isinstance(identity.get(field_name), str) or not identity[field_name]:
            raise RunnerError(f"worktree identity is missing {field_name}")
    if Path(identity["root"]).resolve() != repo_root.resolve():
        raise RunnerError("worktree identity root differs from the runner repository")
    return identity


def _runtime_manifest_binding(
    *,
    path: Path,
    scenario: ScenarioDefinition,
    identity: Mapping[str, str],
    runtime: str,
    profile: Optional[str],
    profiles: Sequence[str],
    clients: Sequence[str],
    repo_root: Path,
) -> RuntimeManifestBinding:
    try:
        protocol_digest = source_proto_digest(repo_root)
    except (OSError, subprocess.SubprocessError) as error:
        raise RunnerError("cannot derive source protocol digest") from error
    return runtime_manifest_v2.load_runtime_manifest(
        path,
        journey_id=scenario.journey_id,
        repo_root=repo_root,
        workspace_identity=identity,
        profile_selectors=profiles,
        client_selectors=clients,
        runtime=runtime,
        expected_protocol_digest=protocol_digest,
        required_fixture_capabilities=tuple(
            scenario.required_fixture_capabilities
        ),
    )


def _validate_active_declaration(
    value: Any,
    *,
    scenario: ScenarioDefinition,
    identity: Mapping[str, str],
) -> Mapping[str, Any]:
    if not isinstance(value, dict):
        raise RunnerError("Development declaration is not an object")
    expected = {
        "workItemId": scenario.work_item_id,
        "journeyId": scenario.journey_id,
        "workspaceId": identity["workspaceId"],
        "branch": identity["branch"],
        "sourceHead": identity.get("controlHead", identity["head"]),
        "state": ACTIVE_DECLARATION_STATE,
    }
    for field_name, expected_value in expected.items():
        if value.get(field_name) != expected_value:
            raise RunnerError(
                f"Development declaration {field_name} does not match "
                f"scenario/workspace identity"
            )
    for field_name in ("sessionId", "declarationId"):
        _require_identifier(value.get(field_name), f"declaration {field_name}")
    expected_declaration_id = (
        f"{scenario.work_item_id}-{identity['workspaceId']}"
    )
    if value["declarationId"] != expected_declaration_id:
        raise RunnerError("Development declaration id is not canonical")
    digest = value.get("declarationDigest")
    if not isinstance(digest, str) or SHA256.fullmatch(digest) is None:
        raise RunnerError("Development declaration digest is invalid")
    return value


def _active_scenario_declaration(
    *,
    repo_root: Path,
    scenario: ScenarioDefinition,
    identity: Mapping[str, str],
    command_runner: CommandRunner = _run_command,
) -> Mapping[str, Any]:
    status = _decode_json_output(
        command_runner(["make", "dev-status"], repo_root),
        "dev-status",
    )
    if not isinstance(status, dict):
        raise RunnerError("dev-status did not return an object")
    declarations = status.get("declarations")
    if not isinstance(declarations, list):
        raise RunnerError("dev-status did not return a declaration list")
    if status.get("workspaceId") != identity["workspaceId"]:
        raise RunnerError("dev-status workspace differs from the runner workspace")

    matches = [
        declaration
        for declaration in declarations
        if isinstance(declaration, dict)
        and declaration.get("workspaceId") == identity["workspaceId"]
        and declaration.get("journeyId") == scenario.journey_id
        and declaration.get("state") == ACTIVE_DECLARATION_STATE
    ]
    if len(matches) != 1:
        raise RunnerError(
            "expected exactly one active current-workspace declaration "
            f"for Journey {scenario.journey_id}, found {len(matches)}"
        )
    selected = _validate_active_declaration(
        matches[0],
        scenario=scenario,
        identity=identity,
    )

    checked = _decode_json_output(
        command_runner(
            [
                "make",
                "dev-check",
                f"WORK_ITEM={scenario.work_item_id}",
                f"SESSION={selected['sessionId']}",
            ],
            repo_root,
        ),
        "dev-check",
    )
    validated = _validate_active_declaration(
        checked,
        scenario=scenario,
        identity=identity,
    )
    _assert_declared_source_clean(
        declaration=validated,
        repo_root=repo_root,
        command_runner=command_runner,
    )
    return validated


def _assert_declared_source_clean(
    *,
    declaration: Mapping[str, Any],
    repo_root: Path,
    command_runner: CommandRunner,
) -> None:
    claims = declaration.get("sourceClaims")
    if not isinstance(claims, list) or not claims:
        raise RunnerError("Development declaration has no source claims")
    for claim in claims:
        if not isinstance(claim, dict):
            raise RunnerError("Development declaration has an invalid source claim")
        path_prefix = claim.get("pathPrefix")
        if not isinstance(path_prefix, str) or not path_prefix:
            raise RunnerError("Development declaration has an invalid source claim")
    process = command_runner(
        ["git", "status", "--porcelain", "--untracked-files=all"],
        repo_root,
    )
    if process.returncode != 0:
        raise RunnerError("cannot verify declared source cleanliness")
    if process.stdout.strip():
        raise RunnerError(
            "declared source differs from sourceCommit; checkpoint before "
            "FUNCTIONAL_CHECK"
        )


def _default_result_root(workspace_id: str) -> Path:
    return (
        Path.home()
        / ".peers-touch/dev/workspaces"
        / workspace_id
        / "development/secure-content"
    )


def _scenario_result_coordinates(
    *,
    scenario: ScenarioDefinition,
    identity: Mapping[str, str],
    declaration: Mapping[str, Any],
    runtime: str,
    profile: Optional[str],
    profiles: Sequence[str],
    clients: Sequence[str],
    runtime_manifest: Optional[RuntimeManifestBinding],
) -> tuple[Path, Mapping[str, str]]:
    if scenario.result_prefix is None:
        return scenario.evidence_path, {}
    resolver = scenario.result_variant
    variant = (
        resolver(runtime, profile, tuple(profiles), tuple(clients))
        if callable(resolver)
        else resolver
    )
    checked_variant = _require_identifier(variant, "result variant")
    run_id = _require_identifier(
        (
            runtime_manifest.run_id
            if runtime_manifest is not None
            else declaration["sessionId"]
        ),
        "result run id",
    )
    generation_id = _require_identifier(identity["head"], "result generation id")
    task_id = _require_identifier(scenario.result_task_id, "result task id")
    workstream_id = _require_identifier(
        scenario.result_workstream_id,
        "result workstream id",
    )
    return (
        scenario.result_prefix
        / generation_id
        / checked_variant
        / run_id
        / "result.json",
        {
            "taskId": task_id,
            "workstreamId": workstream_id,
            "generationId": generation_id,
            "variantId": checked_variant,
            "runId": run_id,
        },
    )


def _assert_external_result_path(repo_root: Path, result_root: Path) -> None:
    resolved_repo = repo_root.resolve()
    resolved_result = result_root.resolve()
    if resolved_result == resolved_repo or resolved_repo in resolved_result.parents:
        raise RunnerError("Development result path must be outside the repository")


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00",
        "Z",
    )


def _parse_timestamp(value: object, field_name: str) -> datetime:
    if not isinstance(value, str) or not value:
        raise RunnerError(f"{field_name} is invalid")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise RunnerError(f"{field_name} is invalid") from error
    if parsed.tzinfo is None:
        raise RunnerError(f"{field_name} is invalid")
    return parsed.astimezone(timezone.utc)


def _command_digest(
    *,
    scenario_id: str,
    runtime: str,
    profile: Optional[str],
    profiles: Sequence[str],
    clients: Sequence[str],
    budget_seconds: int,
    runtime_manifest_digest: Optional[str],
) -> str:
    payload = json.dumps(
        {
            "budgetSeconds": budget_seconds,
            "clients": list(clients),
            "profile": profile,
            "profiles": list(profiles),
            "runtime": runtime,
            "runtimeManifestDigest": runtime_manifest_digest,
            "scenarioId": scenario_id,
        },
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _runtime_binding_digest(
    *,
    declaration_digest: str,
    source_commit: str,
    runtime: str,
    profile: Optional[str],
    profiles: Sequence[str],
    clients: Sequence[str],
    checks: Sequence[Mapping[str, Any]],
    runtime_manifest_digest: Optional[str],
) -> str:
    check_commands = [
        {
            "id": check.get("id"),
            "commandDigest": hashlib.sha256(
                json.dumps(
                    check.get("command", []),
                    separators=(",", ":"),
                ).encode("utf-8")
            ).hexdigest(),
        }
        for check in checks
    ]
    payload = json.dumps(
        {
            "clients": list(clients),
            "declarationDigest": declaration_digest,
            "profile": profile,
            "profiles": list(profiles),
            "runtime": runtime,
            "runtimeManifestDigest": runtime_manifest_digest,
            "sourceCommit": source_commit,
            "checks": check_commands,
        },
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _failure_summary(
    error: Exception,
    checks: Sequence[Mapping[str, Any]],
) -> str:
    if isinstance(
        error,
        (ScenarioBlocked, runtime_manifest_v2.RuntimeManifestError),
    ):
        return redact_text(str(error))
    if isinstance(error, ScenarioBudgetExceeded):
        return "scenario exceeded the declared budget"
    if isinstance(error, (GateError, RunnerError)):
        return redact_text(str(error))
    if checks and checks[-1].get("result") == "FAIL":
        return (
            f"{checks[-1].get('id', 'scenario check')} failed with exit code "
            f"{checks[-1].get('exitCode')}"
        )
    return f"{type(error).__name__}: scenario execution failed"


def _canonical_digest(value: Mapping[str, Any]) -> str:
    encoded = json.dumps(
        value,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _redacted_mapping(value: Mapping[str, Any]) -> dict[str, Any]:
    redacted = redact_value(dict(value))
    if not isinstance(redacted, dict):
        raise RunnerError("redaction returned a non-object value")
    return redacted


def _json_bytes(value: Mapping[str, Any]) -> bytes:
    return (
        json.dumps(
            _redacted_mapping(value),
            indent=2,
            sort_keys=True,
        )
        + "\n"
    ).encode("utf-8")


def _write_bytes_atomic(path: Path, value: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary_name = tempfile.mkstemp(
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
    )
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(value)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary_name, 0o600)
        os.replace(temporary_name, path)
        _fsync_directory(path.parent)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)


def _write_json_atomic(path: Path, value: Mapping[str, Any]) -> None:
    _write_bytes_atomic(path, _json_bytes(value))


def _write_json_immutable(path: Path, value: Mapping[str, Any]) -> None:
    encoded = _json_bytes(value)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError as error:
        raise RunnerError(f"immutable artifact already exists: {path}") from error
    file_synced = False
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(encoded)
            output.flush()
            os.fsync(output.fileno())
        file_synced = True
        _fsync_directory(path.parent)
    except Exception:
        if not file_synced:
            path.unlink(missing_ok=True)
        raise


def _fsync_directory(path: Path) -> None:
    try:
        descriptor = os.open(path, os.O_RDONLY)
    except OSError as error:
        raise RunnerError(f"cannot open artifact directory for sync: {path}") from error
    try:
        os.fsync(descriptor)
    except OSError as error:
        raise RunnerError(f"cannot sync artifact directory: {path}") from error
    finally:
        os.close(descriptor)


def _validate_bound_artifact_path(
    path: Path,
    artifact_dir: Optional[Path],
) -> Path:
    if artifact_dir is None:
        raise RunnerError("scenario artifact directory is unavailable")
    if not path.is_absolute():
        raise RunnerError("bound artifact path must be absolute")
    if path.is_symlink():
        raise RunnerError("bound artifact path must not be a symbolic link")
    try:
        resolved = path.resolve(strict=True)
        evidence_root = artifact_dir.parent.resolve(strict=True)
    except OSError as error:
        raise RunnerError("bound artifact path cannot be resolved") from error
    if not resolved.is_file():
        raise RunnerError("bound artifact path must name a regular file")
    if resolved != evidence_root and evidence_root not in resolved.parents:
        raise RunnerError("bound artifact path escapes the scenario evidence root")
    return resolved


def _read_json_artifact(path: Path) -> tuple[bytes, Mapping[str, Any]]:
    try:
        stat = path.stat()
        if stat.st_size <= 0 or stat.st_size > MAX_BOUND_ARTIFACT_BYTES:
            raise RunnerError(f"bound artifact {path.name} size is invalid")
        raw_bytes = path.read_bytes()
        payload = json.loads(raw_bytes)
    except RunnerError:
        raise
    except (OSError, json.JSONDecodeError) as error:
        raise RunnerError(f"bound artifact {path.name} is invalid") from error
    if not isinstance(payload, dict):
        raise RunnerError(f"bound artifact {path.name} must be an object")
    return raw_bytes, payload


def _prepared_result_path(result_path: Path) -> Path:
    return result_path.with_name(f"{result_path.stem}.prepared.json")


def _recover_prepared_result(
    *,
    prepared_path: Path,
    output_path: Path,
    scenario: ScenarioDefinition,
    identity: Mapping[str, str],
    declaration: Mapping[str, Any],
    runtime_manifest: Optional[RuntimeManifestBinding],
    command_digest: str,
    runtime: str,
    profile: Optional[str],
    profiles: Sequence[str],
    clients: Sequence[str],
    result_coordinates: Mapping[str, str],
) -> Optional[Mapping[str, Any]]:
    if not prepared_path.exists():
        return None
    if prepared_path.is_symlink():
        raise RunnerError("prepared result journal must not be a symbolic link")
    _, journal = _read_json_artifact(prepared_path)
    journal_content = dict(journal)
    journal_digest = journal_content.pop("journalDigest", None)
    if (
        journal.get("schemaVersion") != SCHEMA_VERSION
        or journal.get("kind") != PREPARED_RESULT_KIND
        or not isinstance(journal_digest, str)
        or SHA256.fullmatch(journal_digest) is None
        or not hmac.compare_digest(
            journal_digest,
            _canonical_digest(journal_content),
        )
    ):
        raise RunnerError("prepared result journal is invalid")

    result = journal.get("result")
    if not isinstance(result, Mapping):
        raise RunnerError("prepared result journal has no result")
    result_checks = result.get("checks")
    if (
        not isinstance(result_checks, list)
        or any(not isinstance(check, Mapping) for check in result_checks)
    ):
        raise RunnerError("prepared result journal checks are invalid")
    expected_runtime_binding_digest = _runtime_binding_digest(
        declaration_digest=declaration["declarationDigest"],
        source_commit=identity["head"],
        runtime=runtime,
        profile=profile,
        profiles=profiles,
        clients=clients,
        checks=result_checks,
        runtime_manifest_digest=(
            runtime_manifest.sha256 if runtime_manifest is not None else None
        ),
    )
    expected_result = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": RESULT_KIND,
        "workItemId": scenario.work_item_id,
        "journeyId": scenario.journey_id,
        "scenarioId": scenario.scenario_id,
        "runtime": runtime,
        "verificationClass": VERIFICATION_CLASS,
        "result": "PASS",
        "workspaceId": identity["workspaceId"],
        "branch": identity["branch"],
        "sourceCommit": identity["head"],
        "sessionId": declaration["sessionId"],
        "declarationId": declaration["declarationId"],
        "declarationDigest": declaration["declarationDigest"],
        "runtimeBindingDigest": expected_runtime_binding_digest,
        "commandDigest": command_digest,
        "profile": profile,
        "profiles": list(profiles),
        "clients": list(clients),
        **result_coordinates,
    }
    if any(result.get(field) != value for field, value in expected_result.items()):
        raise RunnerError("prepared result journal identity is invalid")
    if result_coordinates:
        result_content = dict(result)
        result_digest = result_content.pop("resultDigest", None)
        if (
            not isinstance(result_digest, str)
            or SHA256.fullmatch(result_digest) is None
            or not hmac.compare_digest(
                result_digest,
                _canonical_digest(result_content),
            )
        ):
            raise RunnerError("prepared result digest is invalid")
    result_bytes = _json_bytes(result)
    result_digest = hashlib.sha256(result_bytes).hexdigest()
    prepared_digest = journal.get("preparedResultSha256")
    if (
        not isinstance(prepared_digest, str)
        or SHA256.fullmatch(prepared_digest) is None
        or not hmac.compare_digest(prepared_digest, result_digest)
    ):
        raise RunnerError("prepared result journal digest is invalid")

    if runtime_manifest is None:
        if (
            result.get("runtimeManifestDigest") is not None
            or result.get("runtimeManifestRef") is not None
        ):
            raise RunnerError("prepared result runtime binding is invalid")
    elif (
        result.get("runtimeManifestDigest") != runtime_manifest.sha256
        or result.get("runtimeManifestRef") != str(runtime_manifest.path)
    ):
        raise RunnerError("prepared result runtime binding is invalid")

    artifact_refs = result.get("artifactRefs")
    if (
        not isinstance(artifact_refs, list)
        or any(not isinstance(reference, str) for reference in artifact_refs)
        or str(output_path) not in artifact_refs
        or str(prepared_path) not in artifact_refs
    ):
        raise RunnerError("prepared result artifact references are invalid")
    consumptions = journal.get("consumptions")
    if not isinstance(consumptions, list) or not consumptions:
        raise RunnerError("prepared result journal has no consumptions")

    receipts_to_publish: list[tuple[Path, Mapping[str, Any]]] = []
    for consumption in consumptions:
        if not isinstance(consumption, Mapping):
            raise RunnerError("prepared result consumption is invalid")
        artifact_path_value = consumption.get("artifactPath")
        receipt_path_value = consumption.get("receiptPath")
        claim_path_value = consumption.get("claimPath")
        receipt = consumption.get("receipt")
        if (
            not isinstance(artifact_path_value, str)
            or not isinstance(receipt_path_value, str)
            or not isinstance(claim_path_value, str)
            or not isinstance(receipt, Mapping)
        ):
            raise RunnerError("prepared result consumption is invalid")
        artifact_path = _validate_bound_artifact_path(
            Path(artifact_path_value),
            output_path.parent,
        )
        receipt_path = Path(receipt_path_value)
        claim_path = Path(claim_path_value)
        if (
            not receipt_path.is_absolute()
            or receipt_path
            != artifact_path.with_name(f"{artifact_path.stem}.consumed.json")
            or receipt_path.is_symlink()
            or not claim_path.is_absolute()
            or claim_path
            != artifact_path.with_name(f"{artifact_path.stem}.consuming.json")
            or claim_path.is_symlink()
        ):
            raise RunnerError("prepared result receipt path is invalid")
        claim_bytes, claim = _read_json_artifact(claim_path)
        artifact_bytes, artifact = _read_json_artifact(artifact_path)
        artifact_digest = hashlib.sha256(artifact_bytes).hexdigest()
        expected_receipt = {
            "schemaVersion": SCHEMA_VERSION,
            "kind": f"{artifact.get('kind')}-consumption",
            "artifactSha256": artifact_digest,
            "sourceCommit": identity["head"],
            "sessionId": declaration["sessionId"],
            "declarationId": declaration["declarationId"],
            "consumerScenarioId": scenario.scenario_id,
            "consumerJourneyId": scenario.journey_id,
            "consumerRuntime": runtime,
            "consumerRuntimeManifestRunId": (
                runtime_manifest.run_id if runtime_manifest is not None else None
            ),
            "consumerRuntimeManifestDigest": (
                runtime_manifest.sha256 if runtime_manifest is not None else None
            ),
            "preparedResultSha256": result_digest,
        }
        expected_claim = {
            key: value
            for key, value in expected_receipt.items()
            if key != "preparedResultSha256"
        }
        expected_claim["kind"] = (
            f"{artifact.get('kind')}-consumption-claim"
        )
        if (
            consumption.get("artifactSha256") != artifact_digest
            or any(
                receipt.get(field) != value
                for field, value in expected_receipt.items()
            )
        ):
            raise RunnerError("prepared result consumption artifact is invalid")
        claim_content = dict(claim)
        claim_digest = claim_content.pop("claimDigest", None)
        _parse_timestamp(
            claim.get("claimedAt"),
            "prepared result consumption claim claimedAt",
        )
        if (
            any(
                claim.get(field) != value
                for field, value in expected_claim.items()
            )
            or not isinstance(claim_digest, str)
            or SHA256.fullmatch(claim_digest) is None
            or not hmac.compare_digest(
                claim_digest,
                _canonical_digest(claim_content),
            )
            or consumption.get("claimSha256")
            != hashlib.sha256(claim_bytes).hexdigest()
            or str(claim_path) not in artifact_refs
        ):
            raise RunnerError("prepared result consumption claim is invalid")
        receipt_bytes = _json_bytes(receipt)
        receipt_digest = hashlib.sha256(receipt_bytes).hexdigest()
        if (
            consumption.get("receiptSha256") != receipt_digest
            or str(artifact_path) not in artifact_refs
            or str(receipt_path) not in artifact_refs
        ):
            raise RunnerError("prepared result consumption receipt is invalid")
        if receipt_path.exists():
            try:
                existing_receipt = receipt_path.read_bytes()
            except OSError as error:
                raise RunnerError(
                    "prepared result consumption receipt is unreadable"
                ) from error
            if not hmac.compare_digest(existing_receipt, receipt_bytes):
                raise RunnerError(
                    "prepared result consumption receipt conflicts with journal"
                )
        else:
            receipts_to_publish.append((receipt_path, receipt))

    if runtime_manifest is not None:
        runtime_manifest.verify_unchanged()
    for receipt_path, receipt in receipts_to_publish:
        _write_json_immutable(receipt_path, receipt)
    _write_bytes_atomic(output_path, result_bytes)
    try:
        if not hmac.compare_digest(output_path.read_bytes(), result_bytes):
            raise RunnerError("prepared result finalization did not persist")
    except OSError as error:
        raise RunnerError("prepared result finalization is unreadable") from error
    return dict(result)


@contextmanager
def _scenario_budget(seconds: float) -> Iterator[None]:
    if (
        threading.current_thread() is not threading.main_thread()
        or not hasattr(signal, "SIGALRM")
        or not hasattr(signal, "setitimer")
    ):
        yield
        return

    def handle_timeout(_signum: int, _frame: Optional[FrameType]) -> None:
        raise ScenarioBudgetExceeded("scenario exceeded the declared budget")

    previous_handler = signal.getsignal(signal.SIGALRM)
    signal.signal(signal.SIGALRM, handle_timeout)
    previous_timer = signal.setitimer(signal.ITIMER_REAL, seconds)
    started = time.monotonic()
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)
        if previous_timer[0] > 0:
            elapsed = time.monotonic() - started
            restored = max(0.000001, previous_timer[0] - elapsed)
            signal.setitimer(signal.ITIMER_REAL, restored, previous_timer[1])


def _validated_detail(value: Any) -> Mapping[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, Mapping):
        raise RunnerError("scenario execute must return a mapping")
    collisions = sorted(RESULT_RESERVED_FIELDS.intersection(value))
    if collisions:
        raise RunnerError(
            "scenario detail cannot replace runner-owned fields: "
            + ", ".join(collisions)
        )
    return value


def execute_scenario(
    *,
    runtime: str,
    scenario_id: str,
    budget_seconds: int,
    repo_root: Path,
    profile: Optional[str] = None,
    profiles: Sequence[str] = (),
    clients: Sequence[str] = (),
    runtime_manifest_path: Optional[Path] = None,
    result_root: Optional[Path] = None,
    registry: Optional[Mapping[str, ScenarioDefinition]] = None,
    workspace_identity: Optional[Mapping[str, str]] = None,
    command_runner: CommandRunner = _run_command,
    fixture_action_client: EphemeralGateClient | None = None,
) -> Mapping[str, Any]:
    normalized_scenario = _canonical_scenario_id(scenario_id)
    if runtime not in RUNTIMES:
        raise RunnerError(f"unsupported runtime: {runtime}")
    if budget_seconds <= 0:
        raise RunnerError("budget-seconds must be positive")
    if profile is not None and profiles:
        raise RunnerError("choose exactly one of profile or profiles")
    bound_profiles = tuple(profiles) if profiles else ((profile,) if profile else ())
    for value in bound_profiles:
        _require_identifier(value, "profile")
    if len(set(bound_profiles)) != len(bound_profiles):
        raise RunnerError("profiles must not contain duplicates")
    if registry is None:
        registry = discover_scenarios()
    scenario = registry.get(normalized_scenario)
    if scenario is None:
        raise RunnerError(f"unknown scenario: {normalized_scenario}")
    if runtime not in scenario.runtimes:
        raise RunnerError(
            f"scenario {normalized_scenario} does not support runtime {runtime}"
        )

    identity = workspace_identity or _workspace_identity(repo_root, command_runner)
    for field_name in ("workspaceId", "branch", "head"):
        if not isinstance(identity.get(field_name), str) or not identity[field_name]:
            raise RunnerError(f"worktree identity is missing {field_name}")
    output_root = (
        result_root.resolve()
        if result_root is not None
        else _default_result_root(identity["workspaceId"]).resolve()
    )
    _assert_external_result_path(repo_root, output_root)
    if workspace_identity is None:
        try:
            identity = resolve_runtime_source_identity(
                repo_root=repo_root,
                result_root=output_root,
                control_identity=identity,
            )
        except SourceProjectionError as error:
            raise RunnerError(str(error)) from error
    declaration = _active_scenario_declaration(
        repo_root=repo_root,
        scenario=scenario,
        identity=identity,
        command_runner=command_runner,
    )
    runtime_manifest: Optional[RuntimeManifestBinding] = None
    manifest_preflight_error: Optional[
        runtime_manifest_v2.RuntimeManifestError
    ] = None
    if runtime_manifest_path is not None:
        try:
            runtime_manifest = _runtime_manifest_binding(
                path=runtime_manifest_path,
                scenario=scenario,
                identity=identity,
                runtime=runtime,
                profile=profile,
                profiles=bound_profiles,
                clients=clients,
                repo_root=repo_root,
            )
        except runtime_manifest_v2.RuntimeManifestError as error:
            manifest_preflight_error = error
    relative_output_path, result_coordinates = _scenario_result_coordinates(
        scenario=scenario,
        identity=identity,
        declaration=declaration,
        runtime=runtime,
        profile=profile,
        profiles=bound_profiles,
        clients=clients,
        runtime_manifest=runtime_manifest,
    )
    output_path = output_root / relative_output_path
    prepared_path = _prepared_result_path(output_path)
    command_digest = _command_digest(
        scenario_id=scenario.scenario_id,
        runtime=runtime,
        profile=profile,
        profiles=bound_profiles,
        clients=clients,
        budget_seconds=budget_seconds,
        runtime_manifest_digest=(
            runtime_manifest.sha256 if runtime_manifest is not None else None
        ),
    )
    recovered = (
        _recover_prepared_result(
            prepared_path=prepared_path,
            output_path=output_path,
            scenario=scenario,
            identity=identity,
            declaration=declaration,
            runtime_manifest=runtime_manifest,
            command_digest=command_digest,
            runtime=runtime,
            profile=profile,
            profiles=bound_profiles,
            clients=clients,
            result_coordinates=result_coordinates,
        )
        if manifest_preflight_error is None
        else None
    )
    if recovered is not None:
        return recovered

    started_at = _timestamp()
    started_monotonic = time.monotonic()
    context = ScenarioContext(
        repo_root=repo_root,
        scenario_id=scenario.scenario_id,
        journey_id=scenario.journey_id,
        source_commit=identity["head"],
        session_id=declaration["sessionId"],
        declaration_id=declaration["declarationId"],
        runtime=runtime,
        profile=profile,
        profiles=bound_profiles,
        clients=tuple(clients),
        budget_seconds=budget_seconds,
        started_monotonic=started_monotonic,
        runtime_manifest=runtime_manifest,
        artifact_dir=output_path.parent,
        result_path=output_path,
        required_fixture_capabilities=scenario.required_fixture_capabilities,
        fixture_action_client=fixture_action_client,
    )
    failure: Optional[str] = None
    detail: Mapping[str, Any] = {}
    failure_kind = "PRODUCT_ASSERTION_FAILED"
    failure_owner = "source"
    failure_retryable = False
    failure_stage = "FUNCTIONAL_RUNNING"
    blocked_error: Optional[ScenarioBlocked] = None
    execution_error: Optional[Exception] = manifest_preflight_error
    if execution_error is None:
        try:
            with _scenario_budget(context.remaining_seconds()):
                detail = _validated_detail(scenario.execute(context))
            context.remaining_seconds()
        except Exception as error:
            execution_error = error

    manifest_error: Optional[Exception] = None
    if runtime_manifest is not None:
        try:
            runtime_manifest.verify_unchanged()
            context.verify_continuation_unchanged()
        except Exception as error:
            manifest_error = error

    outcome_error = manifest_error or execution_error
    if isinstance(outcome_error, runtime_manifest_v2.RuntimeManifestError):
        failure = redact_text(str(outcome_error))
        failure_kind = outcome_error.code
        failure_owner = outcome_error.owner
        failure_retryable = outcome_error.retryable
        failure_stage = outcome_error.stage
        blocked_error = ScenarioBlocked(
            failure,
            kind=failure_kind,
            owner=failure_owner,
            retryable=failure_retryable,
        )
    elif isinstance(outcome_error, ScenarioBlocked):
        failure = _failure_summary(outcome_error, context.checks)
        failure_kind = outcome_error.kind
        failure_owner = outcome_error.owner
        failure_retryable = outcome_error.retryable
        blocked_error = ScenarioBlocked(
            failure,
            kind=failure_kind,
            owner=failure_owner,
            retryable=failure_retryable,
        )
    elif isinstance(outcome_error, ScenarioBudgetExceeded):
        failure = _failure_summary(outcome_error, context.checks)
        failure_kind = "TIMEOUT"
    elif outcome_error is not None:
        failure = _failure_summary(outcome_error, context.checks)
        if manifest_error is not None:
            failure_kind = "RUNTIME_BINDING_CHANGED"
            failure_owner = "secure-content-w7-runtime"
            failure_retryable = False

    pending_receipt_refs = (
        [
            str(pending.receipt_path)
            for pending in context.pending_consumption_receipts
        ]
        if outcome_error is None
        else []
    )
    prepared_result_refs = (
        [str(prepared_path)]
        if pending_receipt_refs
        else []
    )
    result: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": RESULT_KIND,
        "workItemId": scenario.work_item_id,
        "journeyId": scenario.journey_id,
        "scenarioId": scenario.scenario_id,
        "runtime": runtime,
        "verificationClass": VERIFICATION_CLASS,
        "result": "BLOCKED" if blocked_error else ("FAIL" if failure else "PASS"),
        "proofState": "UNPROVEN",
        "workspaceId": identity["workspaceId"],
        "branch": identity["branch"],
        "sourceCommit": identity["head"],
        "sessionId": declaration["sessionId"],
        "declarationId": declaration["declarationId"],
        "declarationDigest": declaration["declarationDigest"],
        "runtimeBindingDigest": _runtime_binding_digest(
            declaration_digest=declaration["declarationDigest"],
            source_commit=identity["head"],
            runtime=runtime,
            profile=profile,
            profiles=bound_profiles,
            clients=clients,
            checks=context.checks,
            runtime_manifest_digest=(
                runtime_manifest.sha256 if runtime_manifest is not None else None
            ),
        ),
        "profile": profile,
        "profiles": list(bound_profiles),
        "clients": list(clients),
        "startedAt": started_at,
        "durationMs": int((time.monotonic() - started_monotonic) * 1000),
        "commandDigest": command_digest,
        "checks": context.checks,
        "artifactRefs": [
            str(output_path),
            *(
                [str(runtime_manifest.path)]
                if runtime_manifest is not None
                else []
            ),
            *context.artifact_refs,
            *prepared_result_refs,
            *pending_receipt_refs,
        ],
        **result_coordinates,
    }
    if runtime_manifest is not None:
        result["runtimeManifestDigest"] = runtime_manifest.sha256
        result["runtimeManifestRef"] = str(runtime_manifest.path)
        result["serviceIds"] = sorted(runtime_manifest.services)
        result["fixtureManifestDigest"] = runtime_manifest.payload[
            "fixture_manifest_digest"
        ]
        final_cut_bindings = runtime_manifest.payload.get(
            "final_cut_bindings"
        )
        if isinstance(final_cut_bindings, Mapping):
            result["postCutEpochId"] = runtime_manifest.payload[
                "post_cut_epoch_id"
            ]
            result["finalCutBindings"] = {
                profile_id: {
                    "resultDigest": binding["result_digest"],
                    "resetId": binding["reset_id"],
                    "schemaAttestationDigest": binding[
                        "schema_attestation_digest"
                    ],
                    "stationRuntimeIdentity": binding[
                        "station_runtime_identity"
                    ],
                }
                for profile_id, binding in final_cut_bindings.items()
            }
    result.update(detail)
    if failure:
        result["firstFailure"] = {
            "kind": failure_kind,
            "stage": failure_stage,
            "owner": failure_owner,
            "summary": failure,
            "retryable": failure_retryable,
        }
    result["completedAt"] = _timestamp()
    durable_result = _redacted_mapping(result)
    if result_coordinates:
        durable_result["resultDigest"] = _canonical_digest(durable_result)
    if pending_receipt_refs:
        context.prepare_bound_artifact_consumptions(
            prepared_path,
            durable_result,
        )
    _write_json_atomic(output_path, durable_result)
    if blocked_error:
        blocked_error.result_path = output_path
        raise blocked_error
    if failure:
        raise ScenarioFailed(failure, output_path)
    return durable_result


def _parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a Secure Content Development Journey")
    parser.add_argument("--runtime", required=True, choices=sorted(RUNTIMES))
    parser.add_argument("--scenario", required=True)
    profile_group = parser.add_mutually_exclusive_group()
    profile_group.add_argument("--profile")
    profile_group.add_argument("--profiles", default="")
    parser.add_argument("--clients", default="")
    parser.add_argument("--runtime-manifest", type=Path)
    parser.add_argument("--budget-seconds", required=True, type=int)
    parser.add_argument("--result-root", type=Path)
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = _parse_args(argv)
    clients = tuple(value.strip() for value in args.clients.split(",") if value.strip())
    profiles = tuple(value.strip() for value in args.profiles.split(",") if value.strip())
    try:
        result = execute_scenario(
            runtime=args.runtime,
            scenario_id=args.scenario,
            budget_seconds=args.budget_seconds,
            repo_root=_repo_root(),
            profile=args.profile,
            profiles=profiles,
            clients=clients,
            runtime_manifest_path=args.runtime_manifest,
            result_root=args.result_root,
        )
    except ScenarioBlocked as error:
        output = redact_value({"status": "BLOCKED", "message": str(error)})
        if error.result_path is not None:
            output["resultPath"] = str(error.result_path)
        print(json.dumps(output, sort_keys=True), file=sys.stderr)
        return 2
    except ScenarioFailed as error:
        print(
            json.dumps(
                redact_value(
                    {
                        "status": "FAILED",
                        "message": str(error),
                        "resultPath": str(error.result_path),
                    }
                ),
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 1
    except RunnerError as error:
        print(
            json.dumps(
                redact_value({"status": "BLOCKED", "message": str(error)}),
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 2
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
