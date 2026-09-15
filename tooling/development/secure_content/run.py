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
import stat as stat_module
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
from tooling.acceptance.core.provisioning import (
    ProvisioningError,
    load_json_artifact,
    load_runtime_manifest,
    require_runtime_client_service,
)
from tooling.acceptance.core.redaction import (
    redact_artifact_bytes,
    redact_text,
    redact_value,
)


SCHEMA_VERSION = 1
RESULT_KIND = "peers-touch-development-result"
VERIFICATION_CLASS = "FUNCTIONAL_CHECK"
RUNTIMES = frozenset({"source-only", "service", "desktop", "mobile", "browser"})
SCENARIO_PACKAGE = "tooling.development.secure_content.scenarios"
IDENTIFIER = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$", re.IGNORECASE)
SHA256 = re.compile(r"^[0-9a-f]{64}$")
ACTIVE_DECLARATION_STATE = "ACTIVE"
RUNTIME_ATTACHMENT_KIND = "secure-content-development-runtime-attachment"
PREPARED_RESULT_KIND = "peers-touch-development-prepared-result"
RESULT_RESERVED_FIELDS = frozenset(
    {
        "schemaVersion",
        "kind",
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
        "checks",
        "artifactRefs",
        "firstFailure",
    }
)
MAX_RUNTIME_MANIFEST_BYTES = 2 * 1024 * 1024
MAX_BOUND_ARTIFACT_BYTES = 2 * 1024 * 1024
RUNTIME_CLIENT_KINDS = {
    "desktop": frozenset({"native-tauri"}),
    "browser": frozenset({"browser"}),
}
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


@dataclass(frozen=True)
class RuntimeManifestBinding:
    path: Path
    sha256: str
    run_id: str
    payload: Mapping[str, Any]
    clients: Mapping[str, Mapping[str, Any]]
    raw_bytes: bytes = field(repr=False)
    provenance_files: tuple[tuple[Path, bytes], ...] = field(
        default_factory=tuple,
        repr=False,
    )

    def client(self, client_id: str) -> Mapping[str, Any]:
        client = self.clients.get(client_id)
        if client is None:
            raise RunnerError(
                f"runtime manifest does not contain client {client_id!r}"
            )
        return client

    def verify_unchanged(self) -> None:
        try:
            current = self.path.read_bytes()
        except OSError as error:
            raise RunnerError(
                "runtime manifest became unreadable during scenario execution"
            ) from error
        if current != self.raw_bytes:
            raise RunnerError(
                "runtime manifest changed during scenario execution"
            )
        for path, expected in self.provenance_files:
            try:
                if path.read_bytes() != expected:
                    raise RunnerError(
                        f"runtime provenance artifact changed during scenario execution: {path.name}"
                    )
            except OSError as error:
                raise RunnerError(
                    f"runtime provenance artifact became unreadable: {path.name}"
                ) from error

    def client_harness_binding(self, client_id: str) -> Mapping[str, str]:
        client = self.client(client_id)
        source = self.payload.get("source")
        source_commit = source.get("commit") if isinstance(source, Mapping) else None
        return validated_harness_identity(
            client_id,
            client,
            client.get("harness_identity"),
            source_commit=source_commit,
        )


def validated_harness_identity(
    client_id: str,
    client: Mapping[str, Any],
    identity: object,
    *,
    actor_ptids_by_role: Optional[Mapping[str, str]] = None,
    source_commit: object = None,
) -> dict[str, str]:
    if not isinstance(identity, Mapping):
        raise RunnerError(
            f"runtime manifest client {client_id!r} is missing harness_identity"
        )

    actor = client.get("actor")
    expected_authentication = (
        "ANONYMOUS" if actor == "anonymous" else "AUTHENTICATED"
    )
    authentication = identity.get("authenticationState")
    if authentication != expected_authentication:
        raise RunnerError(
            f"runtime manifest client {client_id!r} harness identity has "
            "an invalid authenticationState"
        )

    live_source_commit = identity.get("sourceCommit")
    client_artifact_sha256 = identity.get("clientArtifactSha256")
    if (
        not isinstance(live_source_commit, str)
        or re.fullmatch(r"[0-9a-f]{40}", live_source_commit) is None
        or (
            source_commit is not None
            and live_source_commit != source_commit
        )
        or not isinstance(client_artifact_sha256, str)
        or SHA256.fullmatch(client_artifact_sha256) is None
    ):
        raise RunnerError(
            f"runtime manifest client {client_id!r} does not bind the exact "
            "client source artifact"
        )
    result = {
        "authenticationState": expected_authentication,
        "sourceCommit": live_source_commit,
        "clientArtifactSha256": client_artifact_sha256,
    }
    session_identity_sha256 = identity.get("sessionIdentitySha256")
    if (
        not isinstance(session_identity_sha256, str)
        or SHA256.fullmatch(session_identity_sha256) is None
    ):
        raise RunnerError(
            f"runtime manifest client {client_id!r} cannot bind the "
            "live session identity"
        )
    result["sessionIdentitySha256"] = session_identity_sha256

    actor_ptid_sha256 = identity.get("actorPtidSha256")
    if expected_authentication == "AUTHENTICATED":
        if (
            not isinstance(actor_ptid_sha256, str)
            or SHA256.fullmatch(actor_ptid_sha256) is None
        ):
            raise RunnerError(
                f"runtime manifest client {client_id!r} cannot bind the "
                "authenticated actor PTID"
            )
        role_alias_sha256 = hashlib.sha256(str(actor).encode("utf-8")).hexdigest()
        if actor_ptid_sha256 == role_alias_sha256:
            raise RunnerError(
                f"runtime manifest client {client_id!r} actorPtidSha256 "
                "must not be derived from its actor role alias"
            )
        if actor_ptids_by_role is not None:
            canonical_ptid = actor_ptids_by_role.get(str(actor))
            if (
                canonical_ptid is None
                or not hmac.compare_digest(
                    actor_ptid_sha256,
                    hashlib.sha256(canonical_ptid.encode("utf-8")).hexdigest(),
                )
            ):
                raise RunnerError(
                    f"runtime manifest client {client_id!r} live actor does not "
                    "match the runtime owner's canonical actor binding"
                )
        result["actorPtidSha256"] = actor_ptid_sha256
    elif actor_ptid_sha256 is not None:
        raise RunnerError(
            f"runtime manifest client {client_id!r} anonymous harness "
            "identity must not contain actorPtidSha256"
        )
    elif (
        actor_ptids_by_role is not None
        and str(actor) in actor_ptids_by_role
    ):
        raise RunnerError(
            f"anonymous runtime client {client_id!r} has an actor PTID"
        )

    native_runtime_identity = identity.get("nativeRuntimeIdentitySha256")
    if client.get("runtime") == "native-tauri":
        if (
            not isinstance(native_runtime_identity, str)
            or SHA256.fullmatch(native_runtime_identity) is None
        ):
            raise RunnerError(
                f"runtime manifest client {client_id!r} cannot bind the "
                "Native process identity"
            )
        result["nativeRuntimeIdentitySha256"] = native_runtime_identity
    elif native_runtime_identity is not None:
        raise RunnerError(
            f"runtime manifest client {client_id!r} non-Native harness "
            "identity must not contain nativeRuntimeIdentitySha256"
        )
    return result


def canonical_actor_ptids(actor_manifest: Mapping[str, Any]) -> dict[str, str]:
    raw_actors = actor_manifest.get("actors")
    if not isinstance(raw_actors, list):
        raise RunnerError("actor manifest actors are invalid")
    actor_ptids_by_role: dict[str, str] = {}
    observed_ptids: set[str] = set()
    for actor in raw_actors:
        if not isinstance(actor, Mapping):
            raise RunnerError("actor manifest actor is invalid")
        role = actor.get("role")
        ptid = actor.get("ptid")
        if (
            not isinstance(role, str)
            or not role
            or role != role.strip()
            or role in actor_ptids_by_role
            or not isinstance(ptid, str)
            or not ptid.startswith("ptid:")
            or ptid != ptid.strip()
            or ptid in observed_ptids
        ):
            raise RunnerError("actor manifest actor binding is invalid")
        actor_ptids_by_role[role] = ptid
        observed_ptids.add(ptid)
    return actor_ptids_by_role


@dataclass(frozen=True)
class PendingConsumptionReceipt:
    artifact_path: Path
    artifact_bytes: bytes = field(repr=False)
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
            manifest.payload.get("developmentAttachment", {}).get("capturedAt"),
            "runtime manifest attachment capturedAt",
        )
        if require_fresh_runtime_manifest and (
            producer_run_id == manifest.run_id
            or producer_manifest_digest == manifest.sha256
            or manifest_captured_at <= artifact_created_at
        ):
            raise RunnerError(
                f"bound artifact {resolved.name} requires a fresh runtime manifest"
            )

        artifact_digest = hashlib.sha256(raw_bytes).hexdigest()
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
        if receipt_path.exists():
            raise RunnerError(
                "immutable consumption receipt already exists; "
                f"prepared-result recovery is required: {receipt_path}"
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
        self.pending_consumption_receipts.append(
            PendingConsumptionReceipt(
                artifact_path=resolved,
                artifact_bytes=raw_bytes,
                receipt_path=receipt_path,
                receipt=receipt,
            )
        )
        self._register_artifact(resolved)
        return payload

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
            except OSError as error:
                raise RunnerError(
                    f"bound artifact {pending.artifact_path.name} became "
                    "unreadable before consumption succeeded"
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
    return ScenarioDefinition(
        scenario_id=scenario_id,
        journey_id=_require_identifier(value.journey_id, "journey id"),
        work_item_id=_require_identifier(value.work_item_id, "work item id"),
        runtimes=runtimes,
        evidence_path=evidence_path,
        execute=value.execute,
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
    if not path.is_absolute():
        raise RunnerError("runtime manifest path must be absolute")
    if path.is_symlink():
        raise RunnerError("runtime manifest path must not be a symbolic link")
    try:
        resolved = path.resolve(strict=True)
        stat = resolved.stat()
        if not resolved.is_file():
            raise RunnerError("runtime manifest path must name a file")
        if stat.st_uid != os.geteuid() or stat_module.S_IMODE(stat.st_mode) & 0o077:
            raise RunnerError(
                "runtime manifest must be owned by the current user and private"
            )
        if stat.st_size <= 0 or stat.st_size > MAX_RUNTIME_MANIFEST_BYTES:
            raise RunnerError("runtime manifest size is invalid")
        if resolved == repo_root.resolve() or repo_root.resolve() in resolved.parents:
            raise RunnerError("runtime manifest must be outside the repository")
        raw_bytes = resolved.read_bytes()
    except RunnerError:
        raise
    except OSError as error:
        raise RunnerError(f"cannot read runtime manifest: {error}") from error

    try:
        payload = load_runtime_manifest(resolved, scenario.journey_id)
    except ProvisioningError as error:
        raise RunnerError(f"runtime manifest is invalid: {error}") from error
    try:
        if resolved.read_bytes() != raw_bytes:
            raise RunnerError("runtime manifest changed while it was loaded")
    except OSError as error:
        raise RunnerError(
            "runtime manifest became unreadable while it was loaded"
        ) from error

    attachment = payload.get("developmentAttachment")
    if (
        not isinstance(attachment, dict)
        or attachment.get("kind") != RUNTIME_ATTACHMENT_KIND
        or not isinstance(attachment.get("sourceManifestRunId"), str)
        or attachment.get("sourceManifestRunId") != payload.get("runId")
        or not isinstance(attachment.get("sourceManifestPath"), str)
        or not attachment["sourceManifestPath"]
        or not isinstance(attachment.get("sourceManifestSha256"), str)
        or SHA256.fullmatch(attachment["sourceManifestSha256"]) is None
        or not isinstance(attachment.get("actorManifestPath"), str)
        or not attachment["actorManifestPath"]
        or not isinstance(attachment.get("actorManifestSha256"), str)
        or SHA256.fullmatch(attachment["actorManifestSha256"]) is None
        or not isinstance(attachment.get("capturedAt"), str)
        or not attachment["capturedAt"]
        or attachment.get("namespace") != "moments"
    ):
        raise RunnerError(
            "runtime manifest is missing its post-launch Development attachment"
        )
    source_manifest_path = Path(attachment["sourceManifestPath"])
    if (
        not source_manifest_path.is_absolute()
        or source_manifest_path.is_symlink()
        or source_manifest_path == resolved
    ):
        raise RunnerError("runtime manifest attachment source path is invalid")
    try:
        source_manifest_path = source_manifest_path.resolve(strict=True)
        if (
            not source_manifest_path.is_file()
            or source_manifest_path == repo_root.resolve()
            or repo_root.resolve() in source_manifest_path.parents
        ):
            raise RunnerError("runtime manifest attachment source is invalid")
        source_manifest_bytes = source_manifest_path.read_bytes()
        if (
            hashlib.sha256(source_manifest_bytes).hexdigest()
            != attachment["sourceManifestSha256"]
        ):
            raise RunnerError("runtime manifest attachment source digest is invalid")
        source_manifest_payload = load_runtime_manifest(
            source_manifest_path,
            scenario.journey_id,
        )
        if source_manifest_path.read_bytes() != source_manifest_bytes:
            raise RunnerError(
                "runtime manifest attachment source changed while it was loaded"
            )
    except RunnerError:
        raise
    except (OSError, ProvisioningError) as error:
        raise RunnerError(
            f"runtime manifest attachment source is invalid: {error}"
        ) from error
    if (
        source_manifest_payload.get("developmentAttachment") is not None
        or source_manifest_payload.get("runId") != attachment["sourceManifestRunId"]
    ):
        raise RunnerError("runtime manifest attachment source lineage is invalid")
    reconstructed_source = json.loads(json.dumps(payload))
    reconstructed_source.pop("developmentAttachment", None)
    for client in reconstructed_source.get("clients", []):
        if isinstance(client, dict):
            client.pop("webdriver_session_id", None)
            client.pop("harness_identity", None)
    if reconstructed_source != source_manifest_payload:
        raise RunnerError("runtime manifest attachment diverges from its source")
    actor_manifest_path = Path(attachment["actorManifestPath"])
    actor_ref = source_manifest_payload.get("actorManifest")
    if (
        not actor_manifest_path.is_absolute()
        or actor_manifest_path.is_symlink()
        or not isinstance(actor_ref, dict)
    ):
        raise RunnerError("runtime manifest actor provenance is invalid")
    try:
        actor_manifest_path = actor_manifest_path.resolve(strict=True)
        if (
            not actor_manifest_path.is_file()
            or actor_manifest_path == repo_root.resolve()
            or repo_root.resolve() in actor_manifest_path.parents
        ):
            raise RunnerError("runtime manifest actor provenance is invalid")
        actor_manifest_bytes = actor_manifest_path.read_bytes()
        actor_manifest = load_json_artifact(
            actor_manifest_path,
            "acceptance-actor-manifest",
        )
        if actor_manifest_path.read_bytes() != actor_manifest_bytes:
            raise RunnerError("runtime manifest actor provenance changed while loaded")
    except RunnerError:
        raise
    except (OSError, ProvisioningError) as error:
        raise RunnerError(f"runtime manifest actor provenance is invalid: {error}") from error
    if (
        hashlib.sha256(actor_manifest_bytes).hexdigest()
        != attachment["actorManifestSha256"]
        or actor_ref.get("sha256") != attachment["actorManifestSha256"]
        or actor_ref.get("runId") != payload.get("runId")
        or actor_manifest.get("runId") != payload.get("runId")
        or actor_manifest.get("environmentId") != payload.get("environmentId")
    ):
        raise RunnerError("runtime manifest actor provenance is invalid")
    actor_ptids_by_role = canonical_actor_ptids(actor_manifest)

    source = payload.get("source")
    if not isinstance(source, dict):
        raise RunnerError("runtime manifest source is required")
    source_worktree = source.get("worktree")
    if not isinstance(source_worktree, str):
        raise RunnerError("runtime manifest source worktree is required")
    try:
        if Path(source_worktree).resolve(strict=True) != repo_root.resolve():
            raise RunnerError(
                "runtime manifest source worktree differs from the runner repository"
            )
    except OSError as error:
        raise RunnerError(
            "runtime manifest source worktree cannot be resolved"
        ) from error
    if source.get("commit") != identity["head"]:
        raise RunnerError(
            "runtime manifest source commit differs from the runner checkpoint"
        )
    if source.get("workspaceDigest") != "clean":
        raise RunnerError("runtime manifest source workspace is not clean")
    manifest_run_id = payload.get("runId")
    if not isinstance(manifest_run_id, str) or not manifest_run_id:
        raise RunnerError("runtime manifest run id is required")
    environment_id = payload.get("environmentId")
    if not isinstance(environment_id, str) or not environment_id:
        raise RunnerError("runtime manifest environment id is required")
    services = payload.get("services")
    service_attestation_files: list[tuple[Path, bytes]] = []
    try:
        local_protocol_digest = source_proto_digest(repo_root)
    except (OSError, subprocess.SubprocessError) as error:
        raise RunnerError("cannot derive source protocol digest") from error
    if not isinstance(services, dict) or not services:
        raise RunnerError("runtime manifest services are required")
    for service_id, service in services.items():
        if not isinstance(service_id, str) or not isinstance(service, dict):
            raise RunnerError("runtime manifest service binding is invalid")
        if service.get("kind") == "station":
            if service.get("workspaceDigest") != "clean":
                raise RunnerError(
                    f"runtime manifest Station service {service_id!r} "
                    "workspace is not clean"
                )
            if service.get("protocolDigest") != local_protocol_digest:
                raise RunnerError(
                    f"runtime manifest Station service {service_id!r} "
                    "protocol digest differs from source"
                )
        attestation_ref = service.get("attestationArtifact")
        if (
            not isinstance(attestation_ref, dict)
            or attestation_ref.get("artifactKind") != "acceptance-artifact-ref"
            or attestation_ref.get("workspaceId") != identity["workspaceId"]
            or attestation_ref.get("gateId") != scenario.journey_id
            or attestation_ref.get("runId") != manifest_run_id
            or not isinstance(attestation_ref.get("path"), str)
            or not attestation_ref["path"]
            or not isinstance(attestation_ref.get("sha256"), str)
            or SHA256.fullmatch(attestation_ref["sha256"]) is None
        ):
            raise RunnerError(
                f"runtime manifest service {service_id!r} attestation reference is invalid"
            )
        relative_path = Path(attestation_ref["path"])
        if relative_path.is_absolute() or ".." in relative_path.parts:
            raise RunnerError(
                f"runtime manifest service {service_id!r} attestation path is invalid"
            )
        attestation_path = source_manifest_path.parent.joinpath(relative_path)
        if attestation_path.is_symlink():
            raise RunnerError(
                f"runtime manifest service {service_id!r} attestation is symlinked"
            )
        try:
            attestation_path = attestation_path.resolve(strict=True)
            source_root = source_manifest_path.parent.resolve(strict=True)
            if source_root not in attestation_path.parents:
                raise RunnerError(
                    f"runtime manifest service {service_id!r} attestation escaped its run"
                )
            attestation_bytes = attestation_path.read_bytes()
            attestation = load_json_artifact(
                attestation_path,
                "service-deployment-attestation",
            )
            if attestation_path.read_bytes() != attestation_bytes:
                raise RunnerError(
                    f"runtime manifest service {service_id!r} attestation changed while loaded"
                )
        except RunnerError:
            raise
        except (OSError, ProvisioningError) as error:
            raise RunnerError(
                f"runtime manifest service {service_id!r} attestation is invalid: {error}"
            ) from error
        if hashlib.sha256(attestation_bytes).hexdigest() != attestation_ref["sha256"]:
            raise RunnerError(
                f"runtime manifest service {service_id!r} attestation digest is invalid"
            )
        expected_attestation = {
            "serviceId": service_id,
            "serviceKind": service.get("kind"),
            "environmentId": environment_id,
            "deploymentEnvironment": service.get("deploymentEnvironment"),
            "endpoint": service.get("endpoint"),
            "commit": service.get("liveCommit"),
            "workspaceDigest": service.get("workspaceDigest"),
            "protocolDigest": service.get("protocolDigest"),
            "runtimeIdentity": service.get("runtimeIdentity"),
        }
        for field_name, expected_value in expected_attestation.items():
            if attestation.get(field_name) != expected_value:
                raise RunnerError(
                    f"runtime manifest service {service_id!r} attestation "
                    f"has invalid {field_name}"
                )
        if service.get("kind") == "station" and (
            attestation.get("workspaceDigest") != "clean"
            or attestation.get("protocolDigest") != local_protocol_digest
        ):
            raise RunnerError(
                f"runtime manifest Station service {service_id!r} "
                "attestation differs from source"
            )
        live_metadata = attestation.get("liveMetadata")
        if (
            not isinstance(live_metadata, dict)
            or live_metadata.get("buildCommit") != service.get("liveCommit")
        ):
            raise RunnerError(
                f"runtime manifest service {service_id!r} live metadata is invalid"
            )
        service_attestation_files.append((attestation_path, attestation_bytes))

    profile_binding = payload.get("profile")
    if not isinstance(profile_binding, dict):
        raise RunnerError("runtime manifest profile is required")
    expected_profiles = tuple(profiles) if profiles else ((profile,) if profile else ())
    if len(expected_profiles) != 1:
        raise RunnerError(
            "runtime manifest binding requires exactly one selected profile"
        )
    selected_profile = expected_profiles[0]
    if (
        profile_binding.get("requestedName") != selected_profile
        or profile_binding.get("resolvedName") != selected_profile
    ):
        raise RunnerError(
            "runtime manifest profile differs from the scenario profile"
        )
    slot = profile_binding.get("slot")
    if not isinstance(slot, int) or isinstance(slot, bool) or slot <= 0:
        raise RunnerError("runtime manifest profile slot is invalid")

    raw_clients = payload.get("clients")
    if not isinstance(raw_clients, list):
        raise RunnerError("runtime manifest clients must be an array")
    clients_by_id: dict[str, Mapping[str, Any]] = {}
    webdriver_ports: set[int] = set()
    webdriver_session_ids: set[str] = set()
    gateway_ports: set[int] = set()
    renderer_ports: set[int] = set()
    storage_roots: set[str] = set()
    accepted_kinds = RUNTIME_CLIENT_KINDS.get(runtime)
    if accepted_kinds is None:
        raise RunnerError(
            f"runtime {runtime} does not support runtime-manifest clients"
        )
    for raw_client in raw_clients:
        if not isinstance(raw_client, dict):
            raise RunnerError("runtime manifest client must be an object")
        client_id = raw_client.get("id")
        if not isinstance(client_id, str) or not client_id:
            raise RunnerError("runtime manifest client id is required")
        if client_id in clients_by_id:
            raise RunnerError("runtime manifest contains duplicate client ids")
        if raw_client.get("runtime") not in accepted_kinds:
            raise RunnerError(
                f"runtime manifest client {client_id!r} has the wrong runtime"
            )
        actor = raw_client.get("actor")
        if not isinstance(actor, str) or not actor:
            raise RunnerError(
                f"runtime manifest client {client_id!r} actor is invalid"
            )
        if raw_client.get("profile") != f"{selected_profile}-app":
            raise RunnerError(
                f"runtime manifest client {client_id!r} profile differs from "
                "the selected profile"
            )
        client_worktree = raw_client.get("worktree")
        if not isinstance(client_worktree, str):
            raise RunnerError(
                f"runtime manifest client {client_id!r} worktree is invalid"
            )
        try:
            if Path(client_worktree).resolve(strict=True) != repo_root.resolve():
                raise RunnerError(
                    f"runtime manifest client {client_id!r} worktree differs "
                    "from the runner repository"
                )
        except OSError as error:
            raise RunnerError(
                f"runtime manifest client {client_id!r} worktree cannot be resolved"
            ) from error
        webdriver_session_id = raw_client.get("webdriver_session_id")
        if (
            not isinstance(webdriver_session_id, str)
            or not webdriver_session_id.strip()
            or webdriver_session_id != webdriver_session_id.strip()
            or webdriver_session_id in webdriver_session_ids
        ):
            raise RunnerError(
                f"runtime manifest client {client_id!r} has an invalid or "
                "duplicate webdriver_session_id"
            )
        webdriver_session_ids.add(webdriver_session_id)
        for field_name, allocated in (
            ("webdriver_port", webdriver_ports),
            ("gateway_port", gateway_ports),
            ("renderer_port", renderer_ports),
        ):
            port = raw_client.get(field_name)
            if (
                not isinstance(port, int)
                or isinstance(port, bool)
                or port < 1
                or port > 65535
                or port in allocated
            ):
                raise RunnerError(
                    f"runtime manifest client {client_id!r} has an invalid "
                    f"or duplicate {field_name}"
                )
            allocated.add(port)
        storage_root = raw_client.get("storage_root")
        if (
            not isinstance(storage_root, str)
            or not Path(storage_root).is_absolute()
            or storage_root in storage_roots
        ):
            raise RunnerError(
                f"runtime manifest client {client_id!r} storage root is invalid "
                "or duplicated"
            )
        storage_roots.add(storage_root)
        if raw_client.get("storage_lifecycle") not in {
            "ephemeral",
            "persistent",
        }:
            raise RunnerError(
                f"runtime manifest client {client_id!r} storage lifecycle is invalid"
            )
        try:
            _, station = require_runtime_client_service(
                payload,
                client_id,
                "station",
            )
        except ProvisioningError as error:
            raise RunnerError(
                f"runtime manifest client {client_id!r} station binding is invalid: "
                f"{error}"
            ) from error
        if station.get("liveCommit") != identity["head"]:
            raise RunnerError(
                f"runtime manifest client {client_id!r} Station commit differs "
                "from the runner checkpoint"
            )
        if not isinstance(station.get("runtimeIdentity"), str) or not station[
            "runtimeIdentity"
        ]:
            raise RunnerError(
                f"runtime manifest client {client_id!r} Station runtime identity "
                "is missing"
            )
        validated_harness_identity(
            client_id,
            raw_client,
            raw_client.get("harness_identity"),
            actor_ptids_by_role=actor_ptids_by_role,
            source_commit=identity["head"],
        )
        clients_by_id[client_id] = raw_client

    if tuple(clients_by_id) != tuple(clients):
        raise RunnerError(
            "runtime manifest clients differ from the ordered --clients binding"
        )
    binding = RuntimeManifestBinding(
        path=resolved,
        sha256=hashlib.sha256(raw_bytes).hexdigest(),
        run_id=manifest_run_id,
        payload=payload,
        clients=clients_by_id,
        raw_bytes=raw_bytes,
        provenance_files=(
            (source_manifest_path, source_manifest_bytes),
            (actor_manifest_path, actor_manifest_bytes),
            *service_attestation_files,
        ),
    )
    return binding


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
        "sourceHead": identity["head"],
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
    if isinstance(error, ScenarioBlocked):
        return redact_text(str(error))
    if isinstance(error, ScenarioBudgetExceeded):
        return "scenario exceeded the declared budget"
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
    expected_result = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": RESULT_KIND,
        "workItemId": scenario.work_item_id,
        "journeyId": scenario.journey_id,
        "scenarioId": scenario.scenario_id,
        "runtime": runtime,
        "result": "PASS",
        "workspaceId": identity["workspaceId"],
        "branch": identity["branch"],
        "sourceCommit": identity["head"],
        "sessionId": declaration["sessionId"],
        "declarationId": declaration["declarationId"],
        "commandDigest": command_digest,
        "profile": profile,
        "profiles": list(profiles),
        "clients": list(clients),
    }
    if any(result.get(field) != value for field, value in expected_result.items()):
        raise RunnerError("prepared result journal identity is invalid")
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

    for consumption in consumptions:
        if not isinstance(consumption, Mapping):
            raise RunnerError("prepared result consumption is invalid")
        artifact_path_value = consumption.get("artifactPath")
        receipt_path_value = consumption.get("receiptPath")
        receipt = consumption.get("receipt")
        if (
            not isinstance(artifact_path_value, str)
            or not isinstance(receipt_path_value, str)
            or not isinstance(receipt, Mapping)
        ):
            raise RunnerError("prepared result consumption is invalid")
        artifact_path = _validate_bound_artifact_path(
            Path(artifact_path_value),
            output_path.parent,
        )
        receipt_path = Path(receipt_path_value)
        if (
            not receipt_path.is_absolute()
            or receipt_path
            != artifact_path.with_name(f"{artifact_path.stem}.consumed.json")
            or receipt_path.is_symlink()
        ):
            raise RunnerError("prepared result receipt path is invalid")
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
        if (
            consumption.get("artifactSha256") != artifact_digest
            or any(
                receipt.get(field) != value
                for field, value in expected_receipt.items()
            )
        ):
            raise RunnerError("prepared result consumption artifact is invalid")
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
    declaration = _active_scenario_declaration(
        repo_root=repo_root,
        scenario=scenario,
        identity=identity,
        command_runner=command_runner,
    )
    runtime_manifest = (
        _runtime_manifest_binding(
            path=runtime_manifest_path,
            scenario=scenario,
            identity=identity,
            runtime=runtime,
            profile=profile,
            profiles=bound_profiles,
            clients=clients,
            repo_root=repo_root,
        )
        if runtime_manifest_path is not None
        else None
    )
    output_root = (
        result_root.resolve()
        if result_root is not None
        else _default_result_root(identity["workspaceId"]).resolve()
    )
    _assert_external_result_path(repo_root, output_root)
    output_path = output_root / scenario.evidence_path
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
    recovered = _recover_prepared_result(
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
    )
    failure: Optional[str] = None
    detail: Mapping[str, Any] = {}
    failure_kind = "PRODUCT_ASSERTION_FAILED"
    failure_owner = "source"
    failure_retryable = False
    blocked_error: Optional[ScenarioBlocked] = None
    execution_error: Optional[Exception] = None
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
        except Exception as error:
            manifest_error = error

    outcome_error = manifest_error or execution_error
    if isinstance(outcome_error, ScenarioBlocked):
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
    }
    if runtime_manifest is not None:
        result["runtimeManifestDigest"] = runtime_manifest.sha256
        result["runtimeManifestRef"] = str(runtime_manifest.path)
    result.update(detail)
    if failure:
        result["firstFailure"] = {
            "kind": failure_kind,
            "stage": "FUNCTIONAL_RUNNING",
            "owner": failure_owner,
            "summary": failure,
            "retryable": failure_retryable,
        }
    durable_result = _redacted_mapping(result)
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
