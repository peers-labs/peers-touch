from __future__ import annotations

import json
import re
import secrets
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any

from .errors import ClientBindingError, ProvisioningError
from .redaction import redact_value


SERVICE_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
CLIENT_BINDING_ID_PATTERN = SERVICE_ID_PATTERN

CLIENT_BINDING_ERROR_CODES = {
    "DUPLICATE_CLIENT_ID": 20101,
    "DANGLING_SERVICE_REF": 20102,
    "KIND_MISMATCH": 20103,
    "MISSING_REQUIRED_BINDING": 20104,
    "UNEXPECTED_BINDING_ROLE": 20105,
    "ENDPOINT_COPY_DETECTED": 20106,
    "TRANSPORT_OVERRIDE_MISMATCH": 20107,
    "BINDING_PROOF_ABSENT": 20201,
    "LAUNCH_IDENTITY_MISMATCH": 20202,
    "UNREGISTERED_PROOF_MECHANISM": 20203,
}


def _client_binding_error(
    code: str,
    *,
    client_id: str,
    binding_role: str = "",
    detail: str,
    stage: str = "pre-launch",
    result: str = "BLOCKED",
) -> ClientBindingError:
    return ClientBindingError(
        code=code,
        numeric_code=CLIENT_BINDING_ERROR_CODES[code],
        stage=stage,
        client_id=client_id,
        binding_role=binding_role,
        detail=detail,
        result=result,
    )


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
    kind: str
    required: bool = True
    runtime_identity_required: bool = False
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
class ClientServiceBinding:
    service_id: str
    required_kind: str


@dataclass(frozen=True)
class EnvironmentClient:
    id: str
    actor: str
    runtime: str
    required_service_roles: tuple[str, ...]
    service_bindings: dict[str, ClientServiceBinding]


def _parse_bound_clients(
    clients_data: object,
    services: dict[str, ServiceRequirement],
    path: Path,
) -> tuple[EnvironmentClient, ...]:
    if not isinstance(clients_data, list):
        raise ProvisioningError(
            f"invalid environment contract at {path}: clients must be an array"
        )

    clients: list[EnvironmentClient] = []
    client_ids: set[str] = set()
    for raw_client in clients_data:
        if not isinstance(raw_client, dict):
            raise ProvisioningError(
                f"invalid environment contract at {path}: each client must be an object"
            )

        has_roles = "required_service_roles" in raw_client
        has_bindings = "service_bindings" in raw_client
        if not has_roles and not has_bindings:
            # Unmigrated business-domain clients are outside this plan's D-18 scope.
            continue

        client_id = str(raw_client.get("id") or "")
        actor = str(raw_client.get("actor") or "")
        runtime = str(raw_client.get("runtime") or "")
        if not CLIENT_BINDING_ID_PATTERN.fullmatch(client_id):
            raise _client_binding_error(
                "MISSING_REQUIRED_BINDING",
                client_id=client_id,
                detail="client id is missing or invalid",
            )
        if client_id in client_ids:
            raise _client_binding_error(
                "DUPLICATE_CLIENT_ID",
                client_id=client_id,
                detail="client id is duplicated",
            )
        if not actor or not runtime:
            raise _client_binding_error(
                "MISSING_REQUIRED_BINDING",
                client_id=client_id,
                detail="client actor and runtime are required",
            )
        if not has_roles or not has_bindings:
            raise _client_binding_error(
                "MISSING_REQUIRED_BINDING",
                client_id=client_id,
                detail=(
                    "required_service_roles and service_bindings must be "
                    "declared together"
                ),
            )

        raw_roles = raw_client["required_service_roles"]
        raw_bindings = raw_client["service_bindings"]
        if not isinstance(raw_roles, list) or any(
            not isinstance(role, str)
            or not CLIENT_BINDING_ID_PATTERN.fullmatch(role)
            for role in raw_roles
        ):
            raise _client_binding_error(
                "MISSING_REQUIRED_BINDING",
                client_id=client_id,
                detail="required_service_roles must contain valid role IDs",
            )
        roles = tuple(raw_roles)
        if len(set(roles)) != len(roles):
            raise _client_binding_error(
                "MISSING_REQUIRED_BINDING",
                client_id=client_id,
                detail="required_service_roles must not contain duplicates",
            )
        if not isinstance(raw_bindings, dict):
            raise _client_binding_error(
                "MISSING_REQUIRED_BINDING",
                client_id=client_id,
                detail="service_bindings must be an object",
            )

        binding_roles = set(raw_bindings)
        required_roles = set(roles)
        missing_roles = required_roles - binding_roles
        if missing_roles:
            missing_role = sorted(missing_roles)[0]
            raise _client_binding_error(
                "MISSING_REQUIRED_BINDING",
                client_id=client_id,
                binding_role=missing_role,
                detail="required binding role is missing",
            )
        unexpected_roles = binding_roles - required_roles
        if unexpected_roles:
            unexpected_role = sorted(unexpected_roles)[0]
            raise _client_binding_error(
                "UNEXPECTED_BINDING_ROLE",
                client_id=client_id,
                binding_role=unexpected_role,
                detail="binding role is not declared as required",
            )

        bindings: dict[str, ClientServiceBinding] = {}
        for role, raw_binding in raw_bindings.items():
            if (
                not isinstance(role, str)
                or not CLIENT_BINDING_ID_PATTERN.fullmatch(role)
                or not isinstance(raw_binding, dict)
            ):
                raise _client_binding_error(
                    "MISSING_REQUIRED_BINDING",
                    client_id=client_id,
                    binding_role=str(role),
                    detail="binding role or binding object is invalid",
                )
            if set(raw_binding) != {"service_id", "required_kind"}:
                raise _client_binding_error(
                    "ENDPOINT_COPY_DETECTED",
                    client_id=client_id,
                    binding_role=role,
                    detail=(
                        "binding must contain only service_id and required_kind"
                    ),
                )
            service_id = str(raw_binding.get("service_id") or "")
            required_kind = str(raw_binding.get("required_kind") or "")
            service = services.get(service_id)
            if service is None:
                raise _client_binding_error(
                    "DANGLING_SERVICE_REF",
                    client_id=client_id,
                    binding_role=role,
                    detail=f"service {service_id!r} is not declared",
                )
            if service.kind != required_kind:
                raise _client_binding_error(
                    "KIND_MISMATCH",
                    client_id=client_id,
                    binding_role=role,
                    detail=(
                        f"required kind {required_kind!r} does not match "
                        f"service kind {service.kind!r}"
                    ),
                )
            bindings[role] = ClientServiceBinding(
                service_id=service_id,
                required_kind=required_kind,
            )

        client_ids.add(client_id)
        clients.append(
            EnvironmentClient(
                id=client_id,
                actor=actor,
                runtime=runtime,
                required_service_roles=roles,
                service_bindings=bindings,
            )
        )
    return tuple(clients)


@dataclass(frozen=True)
class EnvironmentContract:
    id: str
    profile: ProfileRequirement = field(default_factory=ProfileRequirement)
    services: dict[str, ServiceRequirement] = field(default_factory=dict)
    fixtures: tuple[FixtureRequirement, ...] = ()
    credentials: tuple[CredentialRef, ...] = ()
    clients: tuple[EnvironmentClient, ...] = ()
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
        clients_data = data.get("clients") or []
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
        if any(
            not str(service.get("kind") or "").strip()
            for service in services_data.values()
        ):
            raise ProvisioningError(
                f"invalid environment contract at {path}: each service requires kind"
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

        services = {
            str(name): ServiceRequirement(
                kind=str(service["kind"]),
                required=bool(service.get("required", True)),
                runtime_identity_required=bool(
                    service.get("runtime_identity_required", False)
                ),
                ready_action=str(service.get("ready_action") or ""),
                health_action=str(service.get("health_action") or ""),
                status_action=str(service.get("status_action") or ""),
                attestation_producer=str(
                    service.get("attestation_producer") or ""
                ),
            )
            for name, service in services_data.items()
        }
        return cls(
            id=str(data["id"]),
            profile=ProfileRequirement(
                required=bool(profile_data.get("required", True)),
                identity_match=bool(profile_data.get("identity_match", True)),
            ),
            services=services,
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
            clients=_parse_bound_clients(clients_data, services, path),
            cleanup=CleanupRequirement(
                resources=tuple(
                    str(resource)
                    for resource in cleanup_resources
                )
            ),
        )


@dataclass(frozen=True)
class ServiceAttestation:
    service_id: str
    service_kind: str
    environment_id: str
    deployment_environment: str
    endpoint: str
    live_commit: str
    workspace_digest: str
    protocol_digest: str
    artifact_ref: dict[str, Any]
    produced_at: str
    producer: str
    build_time: str = ""
    runtime_identity: str = ""

    def __post_init__(self) -> None:
        if not SERVICE_ID_PATTERN.fullmatch(self.service_id):
            raise ProvisioningError(
                f"invalid runtime service id: {self.service_id!r}"
            )
        if not SERVICE_ID_PATTERN.fullmatch(self.service_kind):
            raise ProvisioningError(
                f"invalid runtime service kind: {self.service_kind!r}"
            )
        if not self.endpoint:
            raise ProvisioningError(
                f"runtime service {self.service_id!r} requires an endpoint"
            )
        if not self.deployment_environment:
            raise ProvisioningError(
                f"runtime service {self.service_id!r} requires a deployment environment"
            )
        if not self.producer:
            raise ProvisioningError(
                f"runtime service {self.service_id!r} requires an attestation producer"
            )

    @property
    def is_clean_workspace(self) -> bool:
        return self.workspace_digest == "clean"

    def to_dict(self) -> dict[str, Any]:
        payload = {
            "artifactKind": "service-deployment-attestation",
            "capturedAt": self.produced_at,
            "serviceId": self.service_id,
            "serviceKind": self.service_kind,
            "environmentId": self.environment_id,
            "deploymentEnvironment": self.deployment_environment,
            "endpoint": self.endpoint,
            "commit": self.live_commit,
            "workspaceDigest": self.workspace_digest,
            "protocolDigest": self.protocol_digest,
            "producer": self.producer,
            "liveMetadata": {
                "buildCommit": self.live_commit,
                "buildTime": self.build_time,
            },
        }
        if self.runtime_identity:
            payload["runtimeIdentity"] = self.runtime_identity
        return payload

    def to_manifest_dict(self) -> dict[str, Any]:
        payload = {
            "kind": self.service_kind,
            "deploymentEnvironment": self.deployment_environment,
            "endpoint": self.endpoint,
            "liveCommit": self.live_commit,
            "protocolDigest": self.protocol_digest,
            "workspaceDigest": self.workspace_digest,
            "attestationArtifact": dict(self.artifact_ref),
        }
        if self.runtime_identity:
            payload["runtimeIdentity"] = self.runtime_identity
        return payload

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
    id: str = ""
    required_service_roles: tuple[str, ...] = ()
    service_bindings: dict[str, ClientServiceBinding] = field(default_factory=dict)


@dataclass(frozen=True)
class ClientRuntimeIdentity:
    runtime: str
    instance_id: str
    identity_digest: str

    def __post_init__(self) -> None:
        if not self.runtime or not self.instance_id:
            raise ProvisioningError(
                "client runtime identity requires runtime and instance id"
            )
        if re.fullmatch(r"[0-9a-f]{64}", self.identity_digest) is None:
            raise ProvisioningError(
                "client runtime identity digest must be lowercase SHA-256"
            )


@dataclass(frozen=True)
class BindingProofRecord:
    evidence_run_id: str
    provisioning_run_id: str
    environment_id: str
    gate_id: str
    client_id: str
    binding_role: str
    declared_service_id: str
    launch_generation: int
    service_attestation_ref: dict[str, Any]
    service_attestation_digest: str
    client_runtime_identity: ClientRuntimeIdentity
    observed_runtime_identity: str
    captured_at: str
    proof_mechanism: str
    verifier_id: str
    verifier_source_digest: str
    verification_status: str = "VERIFIED"

    def to_dict(self) -> dict[str, Any]:
        return redact_value(
            {
                "artifactKind": "client-binding-proof",
                "evidenceRunId": self.evidence_run_id,
                "provisioningRunId": self.provisioning_run_id,
                "environmentId": self.environment_id,
                "gateId": self.gate_id,
                "clientId": self.client_id,
                "bindingRole": self.binding_role,
                "declaredServiceId": self.declared_service_id,
                "launchGeneration": self.launch_generation,
                "serviceAttestationRef": dict(self.service_attestation_ref),
                "serviceAttestationDigest": self.service_attestation_digest,
                "clientRuntimeIdentity": {
                    "runtime": self.client_runtime_identity.runtime,
                    "instanceId": self.client_runtime_identity.instance_id,
                    "identityDigest": self.client_runtime_identity.identity_digest,
                },
                "observedRuntimeIdentity": self.observed_runtime_identity,
                "capturedAt": self.captured_at,
                "proofMechanism": self.proof_mechanism,
                "verifierId": self.verifier_id,
                "verifierSourceDigest": self.verifier_source_digest,
                "verificationStatus": self.verification_status,
            }
        )


def _validate_runtime_client_bindings(
    clients: tuple[ClientRuntime, ...],
    services: dict[str, ServiceAttestation],
) -> None:
    bound_clients = [client for client in clients if client.id]
    if not bound_clients:
        return
    if len(bound_clients) != len(clients):
        legacy_client = next(client for client in clients if not client.id)
        raise _client_binding_error(
            "MISSING_REQUIRED_BINDING",
            client_id=legacy_client.actor,
            detail="a D-18 manifest cannot mix bound and legacy clients",
        )

    client_ids: set[str] = set()
    for client in clients:
        if not CLIENT_BINDING_ID_PATTERN.fullmatch(client.id):
            raise _client_binding_error(
                "MISSING_REQUIRED_BINDING",
                client_id=client.id,
                detail="runtime client id is missing or invalid",
            )
        if client.id in client_ids:
            raise _client_binding_error(
                "DUPLICATE_CLIENT_ID",
                client_id=client.id,
                detail="runtime client id is duplicated",
            )
        client_ids.add(client.id)

        required_roles = set(client.required_service_roles)
        binding_roles = set(client.service_bindings)
        missing_roles = required_roles - binding_roles
        if missing_roles:
            missing_role = sorted(missing_roles)[0]
            raise _client_binding_error(
                "MISSING_REQUIRED_BINDING",
                client_id=client.id,
                binding_role=missing_role,
                detail="required runtime binding is missing",
            )
        unexpected_roles = binding_roles - required_roles
        if unexpected_roles:
            unexpected_role = sorted(unexpected_roles)[0]
            raise _client_binding_error(
                "UNEXPECTED_BINDING_ROLE",
                client_id=client.id,
                binding_role=unexpected_role,
                detail="runtime binding role is not declared as required",
            )

        for role, binding in client.service_bindings.items():
            service = services.get(binding.service_id)
            if service is None:
                raise _client_binding_error(
                    "DANGLING_SERVICE_REF",
                    client_id=client.id,
                    binding_role=role,
                    detail=f"service {binding.service_id!r} is not in the manifest",
                )
            if service.service_kind != binding.required_kind:
                raise _client_binding_error(
                    "KIND_MISMATCH",
                    client_id=client.id,
                    binding_role=role,
                    detail=(
                        f"required kind {binding.required_kind!r} does not match "
                        f"service kind {service.service_kind!r}"
                    ),
                )


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
    services: dict[str, ServiceAttestation] = field(default_factory=dict)
    actor_manifest_ref: dict[str, Any] | None = None
    credential_refs: tuple[str, ...] = ()
    clients: tuple[ClientRuntime, ...] = ()
    cleanup_registered: bool = False
    cleanup_resources: tuple[str, ...] = ()
    blocked_reason: str | None = None
    blocked_resource: str | None = None

    def to_dict(self) -> dict[str, Any]:
        _validate_runtime_client_bindings(self.clients, self.services)
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
            "services": {},
            "credentialRefs": list(self.credential_refs),
            "clients": [asdict(client) for client in self.clients],
            "cleanup": {
                "registered": self.cleanup_registered,
                "resources": list(self.cleanup_resources),
            },
        }
        if self.services:
            for service_id, attestation in self.services.items():
                if service_id != attestation.service_id:
                    raise ProvisioningError(
                        "runtime manifest service key "
                        f"{service_id!r} does not match attestation service id "
                        f"{attestation.service_id!r}"
                    )
            result["services"] = {
                service_id: attestation.to_manifest_dict()
                for service_id, attestation in sorted(self.services.items())
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
    if "station" in manifest:
        raise ProvisioningError(
            "runtime manifest uses removed singular station field"
        )
    services = manifest.get("services")
    if not isinstance(services, dict):
        raise ProvisioningError("runtime manifest services must be an object")
    for service_id, service in services.items():
        if not isinstance(service_id, str) or not SERVICE_ID_PATTERN.fullmatch(
            service_id
        ):
            raise ProvisioningError(
                f"runtime manifest service id is invalid: {service_id!r}"
            )
        if not isinstance(service, dict):
            raise ProvisioningError(
                f"runtime manifest service {service_id!r} must be an object"
            )
        for field_name in (
            "kind",
            "deploymentEnvironment",
            "endpoint",
            "liveCommit",
            "protocolDigest",
            "workspaceDigest",
            "attestationArtifact",
        ):
            if not service.get(field_name):
                raise ProvisioningError(
                    f"runtime manifest service {service_id!r} is missing "
                    f"{field_name}"
                )
        artifact_ref = service.get("attestationArtifact")
        if not isinstance(artifact_ref, dict):
            raise ProvisioningError(
                f"runtime manifest service {service_id!r} has invalid "
                "attestationArtifact"
            )
    _validate_loaded_runtime_clients(manifest)
    return manifest


def _validate_loaded_runtime_clients(
    manifest: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    raw_clients = manifest.get("clients")
    if not isinstance(raw_clients, list):
        raise ProvisioningError("runtime manifest clients must be an array")
    if any(not isinstance(client, dict) for client in raw_clients):
        raise ProvisioningError(
            "runtime manifest clients must contain only objects"
        )

    d18_clients = [
        client
        for client in raw_clients
        if client.get("id")
        or client.get("required_service_roles")
        or client.get("service_bindings")
    ]
    if not d18_clients:
        return {}
    if len(d18_clients) != len(raw_clients):
        legacy_client = next(
            client for client in raw_clients if not client.get("id")
        )
        raise _client_binding_error(
            "MISSING_REQUIRED_BINDING",
            client_id=str(legacy_client.get("actor") or ""),
            detail="a D-18 manifest cannot mix bound and legacy clients",
        )

    services = manifest["services"]
    clients_by_id: dict[str, dict[str, Any]] = {}
    for client in d18_clients:
        client_id = str(client.get("id") or "")
        if not CLIENT_BINDING_ID_PATTERN.fullmatch(client_id):
            raise _client_binding_error(
                "MISSING_REQUIRED_BINDING",
                client_id=client_id,
                detail="runtime client id is missing or invalid",
            )
        if client_id in clients_by_id:
            raise _client_binding_error(
                "DUPLICATE_CLIENT_ID",
                client_id=client_id,
                detail="runtime client id is duplicated",
            )

        raw_roles = client.get("required_service_roles")
        raw_bindings = client.get("service_bindings")
        if not isinstance(raw_roles, list) or not isinstance(raw_bindings, dict):
            raise _client_binding_error(
                "MISSING_REQUIRED_BINDING",
                client_id=client_id,
                detail=(
                    "required_service_roles and service_bindings are required"
                ),
            )
        roles = {
            str(role)
            for role in raw_roles
            if isinstance(role, str)
            and CLIENT_BINDING_ID_PATTERN.fullmatch(role)
        }
        if len(roles) != len(raw_roles):
            raise _client_binding_error(
                "MISSING_REQUIRED_BINDING",
                client_id=client_id,
                detail="required_service_roles contain invalid or duplicate roles",
            )

        binding_roles = set(raw_bindings)
        missing_roles = roles - binding_roles
        if missing_roles:
            missing_role = sorted(missing_roles)[0]
            raise _client_binding_error(
                "MISSING_REQUIRED_BINDING",
                client_id=client_id,
                binding_role=missing_role,
                detail="required runtime binding is missing",
            )
        unexpected_roles = binding_roles - roles
        if unexpected_roles:
            unexpected_role = sorted(unexpected_roles)[0]
            raise _client_binding_error(
                "UNEXPECTED_BINDING_ROLE",
                client_id=client_id,
                binding_role=unexpected_role,
                detail="runtime binding role is not declared as required",
            )

        for role, binding in raw_bindings.items():
            if (
                not isinstance(role, str)
                or not CLIENT_BINDING_ID_PATTERN.fullmatch(role)
                or not isinstance(binding, dict)
            ):
                raise _client_binding_error(
                    "MISSING_REQUIRED_BINDING",
                    client_id=client_id,
                    binding_role=str(role),
                    detail="runtime binding role or value is invalid",
                )
            if set(binding) != {"service_id", "required_kind"}:
                raise _client_binding_error(
                    "ENDPOINT_COPY_DETECTED",
                    client_id=client_id,
                    binding_role=role,
                    detail=(
                        "runtime binding must contain only service_id and "
                        "required_kind"
                    ),
                )
            service_id = str(binding.get("service_id") or "")
            required_kind = str(binding.get("required_kind") or "")
            service = services.get(service_id)
            if not isinstance(service, dict):
                raise _client_binding_error(
                    "DANGLING_SERVICE_REF",
                    client_id=client_id,
                    binding_role=role,
                    detail=f"service {service_id!r} is not in the manifest",
                )
            if service.get("kind") != required_kind:
                raise _client_binding_error(
                    "KIND_MISMATCH",
                    client_id=client_id,
                    binding_role=role,
                    detail=(
                        f"required kind {required_kind!r} does not match "
                        f"service kind {service.get('kind')!r}"
                    ),
                )
        clients_by_id[client_id] = client
    return clients_by_id



def require_runtime_service(
    manifest: dict[str, Any],
    service_id: str,
    service_kind: str,
) -> dict[str, Any]:
    services = manifest.get("services")
    service = services.get(service_id) if isinstance(services, dict) else None
    if not isinstance(service, dict):
        raise ProvisioningError(
            f"runtime manifest service {service_id!r} is required"
        )
    if service.get("kind") != service_kind:
        raise ProvisioningError(
            f"runtime manifest service {service_id!r} must have kind "
            f"{service_kind!r}"
        )
    return service


def require_runtime_client_service(
    manifest: dict[str, Any],
    client_id: str,
    binding_role: str,
) -> tuple[str, dict[str, Any]]:
    clients = _validate_loaded_runtime_clients(manifest)
    client = clients.get(client_id)
    if client is None:
        raise _client_binding_error(
            "MISSING_REQUIRED_BINDING",
            client_id=client_id,
            binding_role=binding_role,
            detail="runtime client is not declared",
        )
    binding = client["service_bindings"].get(binding_role)
    if not isinstance(binding, dict):
        raise _client_binding_error(
            "MISSING_REQUIRED_BINDING",
            client_id=client_id,
            binding_role=binding_role,
            detail="required runtime binding is missing",
        )
    service_id = str(binding["service_id"])
    service = require_runtime_service(
        manifest,
        service_id,
        str(binding["required_kind"]),
    )
    return service_id, service


def verify_client_binding_observation(
    manifest: dict[str, Any],
    *,
    evidence_run_id: str,
    client_id: str,
    binding_role: str,
    launch_generation: int,
    client_runtime_identity: ClientRuntimeIdentity,
    observed_runtime_identity: str,
    proof_mechanism: str,
    registered_mechanisms: frozenset[str],
    verifier_id: str,
    verifier_source_digest: str,
) -> BindingProofRecord:
    clients = _validate_loaded_runtime_clients(manifest)
    client = clients.get(client_id)
    if client is None:
        raise _client_binding_error(
            "MISSING_REQUIRED_BINDING",
            client_id=client_id,
            binding_role=binding_role,
            detail="runtime client is not declared",
        )
    client_runtime = str(client.get("runtime") or "")
    if client_runtime_identity.runtime != client_runtime:
        raise _client_binding_error(
            "LAUNCH_IDENTITY_MISMATCH",
            client_id=client_id,
            binding_role=binding_role,
            detail=(
                f"runtime instance {client_runtime_identity.runtime!r} does not "
                f"match client runtime {client_runtime!r}"
            ),
            stage="post-launch",
        )
    if launch_generation <= 0:
        raise _client_binding_error(
            "BINDING_PROOF_ABSENT",
            client_id=client_id,
            binding_role=binding_role,
            detail="launch generation must be positive",
            stage="post-launch",
            result="UNPROVEN",
        )
    if proof_mechanism not in registered_mechanisms:
        raise _client_binding_error(
            "UNREGISTERED_PROOF_MECHANISM",
            client_id=client_id,
            binding_role=binding_role,
            detail=f"proof mechanism {proof_mechanism!r} is not registered",
            stage="post-launch",
        )

    service_id, service = require_runtime_client_service(
        manifest,
        client_id,
        binding_role,
    )
    expected_runtime_identity = str(service.get("runtimeIdentity") or "")
    if not expected_runtime_identity or not observed_runtime_identity:
        raise _client_binding_error(
            "BINDING_PROOF_ABSENT",
            client_id=client_id,
            binding_role=binding_role,
            detail="expected and observed runtime identities are required",
            stage="post-launch",
            result="UNPROVEN",
        )
    if observed_runtime_identity != expected_runtime_identity:
        raise _client_binding_error(
            "LAUNCH_IDENTITY_MISMATCH",
            client_id=client_id,
            binding_role=binding_role,
            detail=(
                f"observed identity {observed_runtime_identity!r} does not "
                f"match service identity {expected_runtime_identity!r}"
            ),
            stage="post-launch",
        )

    attestation_ref = service.get("attestationArtifact")
    if not isinstance(attestation_ref, dict):
        raise _client_binding_error(
            "BINDING_PROOF_ABSENT",
            client_id=client_id,
            binding_role=binding_role,
            detail="service attestation reference is required",
            stage="post-launch",
            result="UNPROVEN",
        )
    attestation_digest = str(attestation_ref.get("sha256") or "")
    if re.fullmatch(r"[0-9a-f]{64}", attestation_digest) is None:
        raise _client_binding_error(
            "BINDING_PROOF_ABSENT",
            client_id=client_id,
            binding_role=binding_role,
            detail="service attestation reference requires a SHA-256 digest",
            stage="post-launch",
            result="UNPROVEN",
        )
    if (
        not evidence_run_id
        or not verifier_id
        or re.fullmatch(r"[0-9a-f]{64}", verifier_source_digest) is None
    ):
        raise _client_binding_error(
            "BINDING_PROOF_ABSENT",
            client_id=client_id,
            binding_role=binding_role,
            detail="evidence run and verifier source identity are required",
            stage="post-launch",
            result="UNPROVEN",
        )

    return BindingProofRecord(
        evidence_run_id=evidence_run_id,
        provisioning_run_id=str(manifest.get("runId") or ""),
        environment_id=str(manifest.get("environmentId") or ""),
        gate_id=str(manifest.get("gateId") or ""),
        client_id=client_id,
        binding_role=binding_role,
        declared_service_id=service_id,
        launch_generation=launch_generation,
        service_attestation_ref=attestation_ref,
        service_attestation_digest=attestation_digest,
        client_runtime_identity=client_runtime_identity,
        observed_runtime_identity=observed_runtime_identity,
        captured_at=utc_now(),
        proof_mechanism=proof_mechanism,
        verifier_id=verifier_id,
        verifier_source_digest=verifier_source_digest,
    )


def persist_client_binding_observation(
    manifest: dict[str, Any],
    *,
    evidence_run_id: str,
    client_id: str,
    binding_role: str,
    launch_generation: int,
    client_runtime_identity: ClientRuntimeIdentity,
    observed_runtime_identity: str,
    proof_mechanism: str,
    registered_mechanisms: frozenset[str],
    verifier_id: str,
    verifier_source_digest: str,
) -> tuple[BindingProofRecord, dict[str, Any]]:
    from ._paths import REPO_ROOT
    from .evidence_store import ArtifactSession

    proof = verify_client_binding_observation(
        manifest,
        evidence_run_id=evidence_run_id,
        client_id=client_id,
        binding_role=binding_role,
        launch_generation=launch_generation,
        client_runtime_identity=client_runtime_identity,
        observed_runtime_identity=observed_runtime_identity,
        proof_mechanism=proof_mechanism,
        registered_mechanisms=registered_mechanisms,
        verifier_id=verifier_id,
        verifier_source_digest=verifier_source_digest,
    )
    relative_path = (
        f"runtime/client-bindings/{client_id}/"
        f"generation-{launch_generation}/{binding_role}.json"
    )
    reference = ArtifactSession(
        repo_root=REPO_ROOT,
        gate_id=str(manifest.get("gateId") or ""),
    ).write_json(
        relative_path,
        proof.to_dict(),
        role=(
            f"client-binding-proof:{client_id}:"
            f"{launch_generation}:{binding_role}"
        ),
    )
    return proof, reference.to_dict()


def validate_binding_proof_closure(
    manifest: dict[str, Any],
    *,
    allocated_generations: dict[str, int],
    proofs: tuple[BindingProofRecord, ...],
) -> None:
    clients = _validate_loaded_runtime_clients(manifest)
    expected = {
        (client_id, generation, role)
        for client_id, generation_count in allocated_generations.items()
        for generation in range(1, generation_count + 1)
        for role in clients[client_id]["required_service_roles"]
    }
    actual = {
        (proof.client_id, proof.launch_generation, proof.binding_role)
        for proof in proofs
        if proof.verification_status == "VERIFIED"
    }
    if actual == expected and len(actual) == len(proofs):
        return
    missing = sorted(expected - actual)
    extra = sorted(actual - expected)
    duplicate_count = len(proofs) - len(actual)
    client_id, generation, role = (
        missing[0]
        if missing
        else extra[0]
        if extra
        else ("", 0, "")
    )
    raise _client_binding_error(
        "BINDING_PROOF_ABSENT",
        client_id=client_id,
        binding_role=role,
        detail=(
            "binding proof closure mismatch: "
            f"generation={generation}, missing={missing}, extra={extra}, "
            f"duplicates={duplicate_count}"
        ),
        stage="post-launch",
        result="UNPROVEN",
    )
