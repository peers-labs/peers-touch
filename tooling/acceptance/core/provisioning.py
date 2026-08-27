from __future__ import annotations

import json
import secrets
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any

from .errors import ProvisioningError
from .redaction import redact_value


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class ProvisioningState(str, Enum):
    DISCOVERED = "DISCOVERED"
    PREFLIGHTED = "PREFLIGHTED"
    PROVISIONED = "PROVISIONED"
    FIXTURE_READY = "FIXTURE_READY"
    GATE_RUNNING = "GATE_RUNNING"
    EVIDENCE_JUDGED = "EVIDENCE_JUDGED"
    CLEANING = "CLEANING"
    CLEANED = "CLEANED"
    BLOCKED = "BLOCKED"
    GATE_FAILED = "GATE_FAILED"
    CLEANUP_FAILED = "CLEANUP_FAILED"


@dataclass(frozen=True)
class CredentialRef:
    id: str
    source_ref: str
    required: bool = True
    generated_if_missing: bool = False

    def resolve(self) -> str:
        import os

        if self.source_ref.startswith("auto:"):
            if not hasattr(self, "_auto_value"):
                object.__setattr__(self, "_auto_value", secrets.token_urlsafe(32))
            return self._auto_value  # type: ignore[attr-defined]
        if self.source_ref.startswith("env:"):
            env_name = self.source_ref[4:]
            value = os.environ.get(env_name, "")
            if not value and self.generated_if_missing:
                value = secrets.token_urlsafe(32)
                os.environ[env_name] = value
            if not value and self.required:
                raise ProvisioningError(
                    f"required credential {self.id} not found at {self.source_ref}"
                )
            return value
        if self.source_ref.startswith("file:"):
            file_path = Path(self.source_ref[5:]).expanduser()
            if not file_path.is_file():
                if self.required:
                    raise ProvisioningError(
                        f"required credential file {self.id} not found at {self.source_ref}"
                    )
                return ""
            return file_path.read_text(encoding="utf-8").strip()
        raise ProvisioningError(f"unsupported credential source: {self.source_ref}")


@dataclass(frozen=True)
class ProfileRequirement:
    required: bool = True
    identity_match: bool = True


@dataclass(frozen=True)
class ServiceRequirement:
    required: bool = True
    ready_action: str = ""
    health_action: str = ""
    status_action: str = ""
    attestation_producer: str = ""


@dataclass(frozen=True)
class FixtureRequirement:
    id: str
    authorization_required: bool = False
    authorization_ref: str = ""


@dataclass(frozen=True)
class CleanupRequirement:
    resources: tuple[str, ...] = (
        "processes",
        "ports",
        "storage",
        "sessions",
    )


@dataclass(frozen=True)
class EnvironmentContract:
    id: str
    profile: ProfileRequirement = field(default_factory=ProfileRequirement)
    services: dict[str, ServiceRequirement] = field(default_factory=dict)
    fixtures: tuple[FixtureRequirement, ...] = ()
    credentials: tuple[CredentialRef, ...] = ()
    cleanup: CleanupRequirement = field(default_factory=CleanupRequirement)

    @classmethod
    def from_yaml(cls, path: Path) -> EnvironmentContract:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ProvisioningError(
                f"invalid environment contract at {path}: {error}"
            ) from error
        if not isinstance(data, dict) or not str(data.get("id") or "").strip():
            raise ProvisioningError(
                f"invalid environment contract at {path}: missing id"
            )

        profile_data = data.get("profile") or {}
        services_data = data.get("services") or {}
        fixtures_data = data.get("fixtures") or []
        credentials_data = data.get("credentials") or []
        cleanup_data = data.get("cleanup") or {}
        if not isinstance(profile_data, dict):
            raise ProvisioningError(
                f"invalid environment contract at {path}: profile must be an object"
            )
        if not isinstance(services_data, dict):
            raise ProvisioningError(
                f"invalid environment contract at {path}: services must be an object"
            )
        if any(not isinstance(service, dict) for service in services_data.values()):
            raise ProvisioningError(
                f"invalid environment contract at {path}: each service must be an object"
            )
        if not isinstance(fixtures_data, list) or any(
            not isinstance(fixture, dict) or not fixture.get("id")
            for fixture in fixtures_data
        ):
            raise ProvisioningError(
                f"invalid environment contract at {path}: each fixture requires id"
            )
        if not isinstance(credentials_data, list) or any(
            not isinstance(credential, dict)
            or not credential.get("id")
            or not credential.get("source_ref")
            for credential in credentials_data
        ):
            raise ProvisioningError(
                f"invalid environment contract at {path}: each credential requires id and source_ref"
            )
        if any(
            credential.get("generated_if_missing", False)
            and not (
                str(credential["source_ref"]).startswith("env:")
                or str(credential["source_ref"]).startswith("auto:")
            )
            for credential in credentials_data
        ):
            raise ProvisioningError(
                "invalid environment contract at "
                f"{path}: generated credentials require an env: or auto: source_ref"
            )
        if not isinstance(cleanup_data, dict):
            raise ProvisioningError(
                f"invalid environment contract at {path}: cleanup must be an object"
            )
        cleanup_resources = cleanup_data.get(
            "resources",
            ("processes", "ports", "storage", "sessions"),
        )
        if not isinstance(cleanup_resources, (list, tuple)) or any(
            not isinstance(resource, str) or not resource
            for resource in cleanup_resources
        ):
            raise ProvisioningError(
                f"invalid environment contract at {path}: cleanup.resources must be strings"
            )

        return cls(
            id=str(data["id"]),
            profile=ProfileRequirement(
                required=bool(profile_data.get("required", True)),
                identity_match=bool(profile_data.get("identity_match", True)),
            ),
            services={
                str(name): ServiceRequirement(
                    required=bool(service.get("required", True)),
                    ready_action=str(service.get("ready_action") or ""),
                    health_action=str(service.get("health_action") or ""),
                    status_action=str(service.get("status_action") or ""),
                    attestation_producer=str(
                        service.get("attestation_producer") or ""
                    ),
                )
                for name, service in services_data.items()
            },
            fixtures=tuple(
                FixtureRequirement(
                    id=str(fixture["id"]),
                    authorization_required=bool(
                        fixture.get("authorization_required", False)
                    ),
                    authorization_ref=str(fixture.get("authorization_ref") or ""),
                )
                for fixture in fixtures_data
            ),
            credentials=tuple(
                CredentialRef(
                    id=str(credential["id"]),
                    source_ref=str(credential["source_ref"]),
                    required=bool(credential.get("required", True)),
                    generated_if_missing=bool(
                        credential.get("generated_if_missing", False)
                    ),
                )
                for credential in credentials_data
            ),
            cleanup=CleanupRequirement(
                resources=tuple(
                    str(resource)
                    for resource in cleanup_resources
                )
            ),
        )


@dataclass(frozen=True)
class StationAttestation:
    environment_id: str
    url: str
    live_commit: str
    workspace_digest: str
    proto_digest: str
    artifact_ref: dict[str, Any]
    produced_at: str
    producer: str = "station-deployment"
    build_time: str = ""

    @property
    def is_clean_workspace(self) -> bool:
        return self.workspace_digest == "clean"

    def to_dict(self) -> dict[str, Any]:
        return {
            "artifactKind": "station-deployment-attestation",
            "capturedAt": self.produced_at,
            "environmentId": self.environment_id,
            "commit": self.live_commit,
            "workspaceDigest": self.workspace_digest,
            "protoDigest": self.proto_digest,
            "producer": self.producer,
            "liveMetadata": {
                "buildCommit": self.live_commit,
                "buildTime": self.build_time,
            },
        }

    def write(self, path: Path) -> Path:
        return write_immutable_json(path, self.to_dict())


@dataclass(frozen=True)
class ActorIdentity:
    role: str
    account_ref: str
    ptid: str
    device_policy: str = "fresh"


@dataclass(frozen=True)
class ActorManifest:
    fixture_id: str
    environment_id: str
    run_id: str
    created_at: str
    actors: tuple[ActorIdentity, ...]
    credential_refs: tuple[str, ...]
    reset_authorized: bool
    target_verified: bool
    initial_state: str = "ready"

    def to_dict(self) -> dict[str, Any]:
        return redact_value(
            {
                "artifactKind": "acceptance-actor-manifest",
                "fixtureId": self.fixture_id,
                "environmentId": self.environment_id,
                "runId": self.run_id,
                "createdAt": self.created_at,
                "initialState": self.initial_state,
                "actors": [
                    {
                        "role": actor.role,
                        "accountRef": actor.account_ref,
                        "ptid": actor.ptid,
                        "devicePolicy": actor.device_policy,
                    }
                    for actor in self.actors
                ],
                "credentialRefs": list(self.credential_refs),
                "reset": {
                    "authorized": self.reset_authorized,
                    "targetVerified": self.target_verified,
                },
            }
        )

    def write(self, path: Path) -> Path:
        return write_immutable_json(path, self.to_dict())


@dataclass(frozen=True)
class GapArtifact:
    claim: str
    gap_type: str
    owner_stage: str
    required_closure: str
    evidence: tuple[dict[str, Any], ...] = ()
    status: str = "BLOCKING"
    proof_state: str = "UNPROVEN"

    def to_dict(self) -> dict[str, Any]:
        return redact_value(
            {
                "artifactKind": "acceptance-gap",
                "status": self.status,
                "claim": self.claim,
                "gapType": self.gap_type,
                "proofState": self.proof_state,
                "ownerStage": self.owner_stage,
                "evidence": [dict(item) for item in self.evidence],
                "requiredClosure": self.required_closure,
            }
        )


@dataclass(frozen=True)
class ClientRuntime:
    actor: str
    runtime: str
    worktree: str
    gateway_port: int
    renderer_port: int
    webdriver_port: int
    profile: str
    storage_root: str


@dataclass(frozen=True)
class RuntimeManifest:
    artifact_kind: str
    environment_id: str
    gate_id: str
    run_id: str
    created_at: str
    state: ProvisioningState
    source_worktree: str
    source_commit: str
    workspace_digest: str
    profile_requested: str
    profile_resolved: str
    profile_slot: int
    station: StationAttestation | None = None
    actor_manifest_ref: dict[str, Any] | None = None
    credential_refs: tuple[str, ...] = ()
    clients: tuple[ClientRuntime, ...] = ()
    cleanup_registered: bool = False
    cleanup_resources: tuple[str, ...] = ()
    blocked_reason: str | None = None
    blocked_resource: str | None = None

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "artifactKind": self.artifact_kind,
            "environmentId": self.environment_id,
            "gateId": self.gate_id,
            "runId": self.run_id,
            "createdAt": self.created_at,
            "state": self.state.value,
            "source": {
                "worktree": self.source_worktree,
                "commit": self.source_commit,
                "workspaceDigest": self.workspace_digest,
            },
            "profile": {
                "requestedName": self.profile_requested,
                "resolvedName": self.profile_resolved,
                "slot": self.profile_slot,
            },
            "credentialRefs": list(self.credential_refs),
            "clients": [asdict(client) for client in self.clients],
            "cleanup": {
                "registered": self.cleanup_registered,
                "resources": list(self.cleanup_resources),
            },
        }
        if self.station is not None:
            result["station"] = {
                "url": self.station.url,
                "liveCommit": self.station.live_commit,
                "protoDigest": self.station.proto_digest,
                "workspaceDigest": self.station.workspace_digest,
                "attestationArtifact": dict(self.station.artifact_ref),
            }
        if self.actor_manifest_ref:
            result["actorManifest"] = dict(self.actor_manifest_ref)
        if self.blocked_reason:
            result["blockedReason"] = self.blocked_reason
        if self.blocked_resource:
            result["blockedResource"] = self.blocked_resource
        return redact_value(result)

    def write(self, path: Path) -> Path:
        return write_immutable_json(path, self.to_dict())

    def is_ready(self) -> bool:
        return self.state == ProvisioningState.FIXTURE_READY

    def is_blocked(self) -> bool:
        return self.state == ProvisioningState.BLOCKED


def write_immutable_json(path: Path, payload: dict[str, Any]) -> Path:
    if path.exists():
        raise ProvisioningError(f"immutable artifact already exists: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(redact_value(payload), indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return path


def new_manifest(
    environment_id: str,
    gate_id: str,
    requested_profile: str,
    resolved_profile: str,
    slot: int,
    commit: str,
    worktree: str,
    workspace_digest: str = "unknown",
) -> RuntimeManifest:
    return RuntimeManifest(
        artifact_kind="acceptance-runtime-manifest",
        environment_id=environment_id,
        gate_id=gate_id,
        run_id=secrets.token_hex(8),
        created_at=utc_now(),
        state=ProvisioningState.DISCOVERED,
        source_worktree=worktree,
        source_commit=commit,
        workspace_digest=workspace_digest,
        profile_requested=requested_profile,
        profile_resolved=resolved_profile,
        profile_slot=slot,
    )


def blocked_manifest(
    base: RuntimeManifest,
    reason: str,
    resource: str = "",
) -> RuntimeManifest:
    from dataclasses import replace

    return replace(
        base,
        state=ProvisioningState.BLOCKED,
        blocked_reason=reason,
        blocked_resource=resource or None,
    )


def load_json_artifact(path: Path, artifact_kind: str) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ProvisioningError(f"cannot load artifact {path}: {error}") from error
    if not isinstance(payload, dict):
        raise ProvisioningError(f"artifact {path} must contain a JSON object")
    if payload.get("artifactKind") != artifact_kind:
        raise ProvisioningError(
            f"artifact {path} has kind {payload.get('artifactKind')!r}; "
            f"expected {artifact_kind!r}"
        )
    return payload


def load_runtime_manifest(path: Path, gate_id: str) -> dict[str, Any]:
    manifest = load_json_artifact(path, "acceptance-runtime-manifest")
    if manifest.get("gateId") != gate_id:
        raise ProvisioningError(
            f"runtime manifest gate {manifest.get('gateId')!r} does not match "
            f"{gate_id!r}"
        )
    if manifest.get("state") != ProvisioningState.FIXTURE_READY.value:
        raise ProvisioningError(
            f"runtime manifest state must be FIXTURE_READY, got "
            f"{manifest.get('state')!r}"
        )
    return manifest
