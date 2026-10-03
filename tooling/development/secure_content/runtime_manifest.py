from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import stat as stat_module
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from types import MappingProxyType
from typing import Any, Mapping, Optional, Sequence
from urllib.parse import urlparse


SCHEMA_VERSION = 3
MANIFEST_KIND = "secure-content-development-runtime"
MANIFEST_CONTRACT = "secure-content-development-runtime-v3"
FIXTURE_MANIFEST_KIND = "secure-content-fixture-manifest"
SERVICE_ATTESTATION_KIND = "service-deployment-attestation"
CANONICAL_PRIVATE_SCHEMA_ATTESTATION_FILENAME = (
    "canonical-private-schema-attestation.json"
)
COMPLETED_RESET_JOURNAL_FILENAME = "completed-reset-journal.json"
RESET_MANIFEST_FILENAME = "reset-manifest.json"
AUTOMATION_ATTACHMENT_KIND = "webdriver-session"
HARNESS_IDENTITY_SCHEMA_VERSION = 1
RUNTIME_OWNER_ID = "secure-content-w7-runtime"
CONTINUATION_ACKNOWLEDGEMENT_KIND = (
    "secure-content-runtime-restart-acknowledgement"
)
RUNTIME_LEASE_EVIDENCE_KIND = "secure-content-runtime-lease-evidence"
CLIENT_KINDS = frozenset(
    {
        "native-tauri",
        "browser",
        "tauri-ios-simulator",
        "tauri-android-emulator",
    }
)
RUNTIME_CLIENT_KINDS = {
    "desktop": frozenset({"native-tauri"}),
    "browser": frozenset({"browser"}),
    "mobile": frozenset(
        {"tauri-ios-simulator", "tauri-android-emulator"}
    ),
}
LIFECYCLE_OBSERVER_CAPABILITIES = frozenset(
    {
        "persisted-before-send",
        "sent-before-response",
        "response-before-local-commit",
        "stream-terminal-marker",
        "runtime-owner-restart",
    }
)
CANONICAL_PROFILES = {
    "four": "station-four",
    "fiveArm": "station-five-arm",
}
CANONICAL_PRIVATE_SCHEMA_SCOPES = {
    "four": "station-four-social-private",
    "fiveArm": "station-five-arm-social-private",
}
RESET_INTENTS = frozenset({"SCHEMA_ACTIVATION", "FINAL_CUT"})
RESET_JOURNAL_STATES = (
    "PREPARED",
    "DATABASE_SCHEMA_COMMITTED",
    "OBJECTS_DELETED",
    "STATION_DEPLOYED",
    "POST_AUDIT_PASSED",
    "COMPLETE",
)
MAX_MANIFEST_BYTES = 2 * 1024 * 1024
IDENTIFIER = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$", re.IGNORECASE)
SERVICE_IDENTIFIER = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
COMMIT = re.compile(r"^[0-9a-f]{40}$")
RFC3339_TIMESTAMP = re.compile(
    r"^(?P<date>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})"
    r"(?:\.(?P<fraction>\d{1,9}))?"
    r"(?P<zone>Z|[+-]\d{2}:\d{2})$"
)

TOP_LEVEL_FIELDS = frozenset(
    {
        "schema_version",
        "kind",
        "run_id",
        "journey_id",
        "source",
        "controller_binding",
        "services",
        "clients",
        "fixture_manifest_ref",
        "fixture_manifest_digest",
        "lifecycle_observer_capabilities",
        "created_at",
        "manifest_digest",
        "continuation",
        "post_cut_epoch_id",
        "final_cut_bindings",
    }
)
REQUIRED_TOP_LEVEL_FIELDS = TOP_LEVEL_FIELDS - {
    "continuation",
    "post_cut_epoch_id",
    "final_cut_bindings",
}
POST_CUT_PROFILES = frozenset({"four", "fiveArm"})
SOURCE_FIELDS = frozenset(
    {
        "canonical_worktree",
        "workspace_id",
        "source_evidence_workspace_id",
        "commit",
        "worktree_set_digest",
        "workspace_digest",
    }
)
REQUIRED_SOURCE_FIELDS = SOURCE_FIELDS - {"source_evidence_workspace_id"}
CONTROLLER_FIELDS = frozenset({"profile_id", "slot"})
BASE_SERVICE_FIELDS = frozenset(
    {
        "kind",
        "profile_id",
        "deployment_environment",
        "endpoint",
        "schema_attestation_endpoint",
        "live_commit",
        "protocol_digest",
        "runtime_identity",
        "attestation_artifact_ref",
    }
)
SERVICE_FIELDS = BASE_SERVICE_FIELDS | frozenset(
    {"canonical_private_schema_attestation_ref"}
)
CLIENT_FIELDS = frozenset(
    {
        "id",
        "actor_role",
        "actor_role_digest",
        "runtime_kind",
        "required_service_roles",
        "service_bindings",
        "storage_identity_digest",
        "boot_identity",
        "session_generation",
        "automation_attachment_ref",
        "harness_identity_digest",
    }
)
BINDING_FIELDS = frozenset({"service_id", "required_kind"})
ARTIFACT_REF_FIELDS = frozenset({"path", "sha256"})
AUTOMATION_REF_FIELDS = frozenset({"kind", "endpoint", "session_id"})
FIXTURE_FIELDS = frozenset(
    {
        "schema_version",
        "kind",
        "fixture_set_id",
        "source_checkpoint",
        "handles",
        "manifest_digest",
    }
)
FIXTURE_HANDLE_FIELDS = frozenset(
    {
        "kind",
        "opaque_id",
        "owner",
        "capability",
        "expected_identity_digest",
        "secret_channel_ref",
    }
)
REQUIRED_FIXTURE_HANDLE_FIELDS = FIXTURE_HANDLE_FIELDS - {"secret_channel_ref"}
CONTINUATION_FIELDS = frozenset(
    {
        "parent_manifest_digest",
        "restart_request_id",
        "retained_client_id",
        "retained_storage_identity_digest",
        "previous_boot_identity",
        "runtime_owner_acknowledgement_id",
        "lease_evidence_ref",
    }
)
CONTINUATION_ACKNOWLEDGEMENT_FIELDS = frozenset(
    {
        "schema_version",
        "kind",
        "request_id",
        "owner_id",
        "acknowledgement_id",
        "parent_runtime_manifest_digest",
        "child_runtime_manifest_digest",
        "previous_boot_identity",
        "current_boot_identity",
        "session_generation",
        "retained_storage_identity_digest",
        "lease_evidence_ref",
        "artifact_digest",
    }
)
FINAL_CUT_BINDING_FIELDS = frozenset(
    {
        "result_digest",
        "reset_id",
        "schema_attestation_digest",
        "station_runtime_identity",
    }
)
RUNTIME_LEASE_EVIDENCE_FIELDS = frozenset(
    {
        "schema_version",
        "kind",
        "owner_id",
        "request_id",
        "parent_manifest_digest",
        "retained_client_id",
        "lease_ids",
        "acquired_at",
        "expires_at",
        "artifact_digest",
    }
)
CANONICAL_PRIVATE_SCHEMA_ATTESTATION_FIELDS = frozenset(
    {
        "schema_version",
        "source_commit",
        "workspace_id",
        "profile_id",
        "deployment_environment",
        "destructive_scope",
        "station_service_id",
        "station_peer_id",
        "station_runtime_identity",
        "service_attestation_digest",
        "reset_intent",
        "reset_manifest_digest",
        "completed_journal_digest",
        "canonical_private_schema_digest",
        "retired_columns_absent",
        "public_snapshot_digest",
        "created_at",
        "attestation_digest",
    }
)
RESET_MANIFEST_FIELDS = frozenset(
    {
        "schema_version",
        "reset_id",
        "reset_intent",
        "source_commit",
        "workspace_id",
        "profile_id",
        "deployment_environment",
        "destructive_scope",
        "database_identity_digest",
        "public_snapshot_before",
        "database_targets",
        "canonical_private_object_targets",
        "legacy_oss_object_targets",
        "out_of_scope_table_names",
        "created_at",
        "manifest_digest",
    }
)
RESET_MANIFEST_OPTIONAL_FIELDS = frozenset({"recovery_predecessor"})
RESET_RECOVERY_PREDECESSOR_FIELDS = frozenset(
    {
        "reset_id",
        "reset_manifest_digest",
        "journal_digest",
        "state",
        "failure_code",
    }
)
PUBLIC_SOCIAL_SNAPSHOT_FIELDS = frozenset(
    {
        "schema_version",
        "profile_id",
        "public_post_schema_digest",
        "public_post_rows_digest",
        "public_comment_rows_digest",
        "public_reaction_rows_digest",
        "public_object_metadata_digest",
        "public_object_bytes_digest",
        "counts",
        "snapshot_digest",
    }
)
RESET_JOURNAL_FIELDS = frozenset(
    {
        "schema_version",
        "reset_manifest_digest",
        "current_state",
        "accepted_invocations",
        "transitions",
        "failure",
    }
)
REQUIRED_RESET_JOURNAL_FIELDS = RESET_JOURNAL_FIELDS
RESET_INVOCATION_ACCEPTANCE_FIELDS = frozenset(
    {"invocation_id", "invocation_digest", "accepted_at"}
)
RESET_TRANSITION_FIELDS = frozenset(
    {"from_state", "to_state", "transitioned_at", "transition_digest"}
)


class RuntimeManifestError(ValueError):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.result = "BLOCKED"
        self.proof_state = "UNPROVEN"
        self.stage = "PRE_ACTION"
        self.owner = "secure-content-runtime-owner"
        self.retryable = retryable


@dataclass(frozen=True)
class CanonicalPrivateSchemaAttestationBinding:
    path: Path
    payload: Mapping[str, Any]
    raw_bytes: bytes = field(repr=False)
    provenance_files: tuple[tuple[Path, bytes], ...] = field(
        default_factory=tuple,
        repr=False,
    )


@dataclass(frozen=True)
class RuntimeManifestBinding:
    path: Path
    sha256: str
    run_id: str
    payload: Mapping[str, Any]
    clients: Mapping[str, Mapping[str, Any]]
    services: Mapping[str, Mapping[str, Any]]
    service_profiles: frozenset[str]
    fixture_capabilities: frozenset[str]
    fixture_handles: Mapping[str, Mapping[str, Any]]
    raw_bytes: bytes = field(repr=False)
    provenance_files: tuple[tuple[Path, bytes], ...] = field(
        default_factory=tuple,
        repr=False,
    )

    def client(self, client_id: str) -> Mapping[str, Any]:
        client = self.clients.get(client_id)
        if client is None:
            _fail(
                "CLIENT_CLOSURE_MISMATCH",
                f"runtime manifest does not contain client {client_id!r}",
            )
        return client

    def service_for_client(
        self,
        client_id: str,
        role: str,
    ) -> tuple[str, Mapping[str, Any]]:
        client = self.client(client_id)
        binding = client["service_bindings"].get(role)
        if not isinstance(binding, Mapping):
            _fail(
                "SERVICE_CLOSURE_MISMATCH",
                f"client {client_id!r} has no service binding for {role!r}",
            )
        service_id = str(binding["service_id"])
        service = self.services.get(service_id)
        if not isinstance(service, Mapping):
            _fail(
                "SERVICE_CLOSURE_MISMATCH",
                f"client {client_id!r} references missing service {service_id!r}",
            )
        return service_id, service

    def require_fixture_capabilities(
        self,
        capabilities: Sequence[str],
    ) -> None:
        missing = set(capabilities) - self.fixture_capabilities
        if missing:
            _fail(
                "FIXTURE_CAPABILITY_UNAVAILABLE",
                "runtime fixture manifest is missing capabilities: "
                + ", ".join(sorted(missing)),
                retryable=True,
            )

    def fixture_handle(self, capability: str) -> Mapping[str, Any]:
        handle = self.fixture_handles.get(capability)
        if handle is None:
            _fail(
                "FIXTURE_CAPABILITY_UNAVAILABLE",
                f"runtime fixture manifest is missing capability {capability!r}",
                retryable=True,
            )
        return handle

    def verify_unchanged(self) -> None:
        try:
            current = self.path.read_bytes()
        except OSError as error:
            raise RuntimeManifestError(
                "MUTABLE_MANIFEST_LINEAGE",
                "runtime manifest became unreadable during scenario execution",
            ) from error
        if not hmac.compare_digest(current, self.raw_bytes):
            _fail(
                "MUTABLE_MANIFEST_LINEAGE",
                "runtime manifest changed during scenario execution",
            )
        for path, expected in self.provenance_files:
            try:
                current_provenance = path.read_bytes()
            except OSError as error:
                raise RuntimeManifestError(
                    "MUTABLE_MANIFEST_LINEAGE",
                    f"runtime provenance became unreadable: {path.name}",
                ) from error
            if not hmac.compare_digest(current_provenance, expected):
                _fail(
                    "MUTABLE_MANIFEST_LINEAGE",
                    f"runtime provenance changed during scenario execution: {path.name}",
                )


def canonical_digest(value: Mapping[str, Any]) -> str:
    encoded = json.dumps(
        value,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def with_manifest_digest(payload: Mapping[str, Any]) -> dict[str, Any]:
    result = json.loads(json.dumps(payload))
    result.pop("manifest_digest", None)
    result["manifest_digest"] = canonical_digest(result)
    return result


def service_attestation_binding_digest(
    service_id: str,
    service: Mapping[str, Any],
) -> str:
    return canonical_digest(
        {
            "artifactKind": SERVICE_ATTESTATION_KIND,
            "serviceId": service_id,
            "serviceKind": service["kind"],
            "deploymentEnvironment": service["deployment_environment"],
            "endpoint": service["endpoint"],
            "commit": service["live_commit"],
            "workspaceDigest": "clean",
            "protocolDigest": service["protocol_digest"],
            "runtimeIdentity": service["runtime_identity"],
        }
    )


def schema_service_attestation_binding_digest(
    service_id: str,
    service: Mapping[str, Any],
) -> str:
    return service_attestation_binding_digest(
        service_id,
        {
            **service,
            "endpoint": service["schema_attestation_endpoint"],
        },
    )


def load_canonical_private_schema_attestation(
    path: Path,
    *,
    repo_root: Path,
    source_commit: str,
    workspace_id: str,
    service_id: str,
    profile_id: str,
    deployment_environment: str,
    station_runtime_identity: str,
    service_attestation_digest: str,
) -> CanonicalPrivateSchemaAttestationBinding:
    resolved, raw_bytes = _read_private_external_file(
        path,
        repo_root=repo_root,
        label="canonical private schema attestation",
    )
    payload = _decode_object(
        raw_bytes,
        "canonical private schema attestation",
        code="CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
    )
    provenance = _validate_canonical_private_schema_attestation(
        payload,
        attestation_path=resolved,
        source_commit=source_commit,
        workspace_id=workspace_id,
        service_id=service_id,
        profile_id=profile_id,
        deployment_environment=deployment_environment,
        station_runtime_identity=station_runtime_identity,
        service_attestation_digest=service_attestation_digest,
    )
    return CanonicalPrivateSchemaAttestationBinding(
        path=resolved,
        payload=payload,
        raw_bytes=raw_bytes,
        provenance_files=provenance,
    )


def harness_identity_digest(
    snapshot: Mapping[str, Any],
    *,
    client: Mapping[str, Any],
    source_commit: str,
    station: Mapping[str, Any],
    automation_session_id: str,
) -> str:
    return canonical_digest(
        harness_identity_projection(
            snapshot,
            client=client,
            source_commit=source_commit,
            station=station,
            automation_session_id=automation_session_id,
        )
    )


def harness_identity_projection(
    snapshot: Mapping[str, Any],
    *,
    client: Mapping[str, Any],
    source_commit: str,
    station: Mapping[str, Any],
    automation_session_id: str,
) -> Mapping[str, Any]:
    client_id = str(client.get("id") or "")
    runtime_kind = str(client.get("runtime_kind") or "")
    expected_platform = {
        "native-tauri": "native",
        "browser": "browser",
        "tauri-ios-simulator": "mobile",
        "tauri-android-emulator": "mobile",
    }.get(runtime_kind)
    if snapshot.get("platform") != expected_platform:
        _fail(
            "STALE_CLIENT_IDENTITY",
            f"runtime client {client_id!r} live platform differs from the manifest",
        )

    actor_role = str(client.get("actor_role") or "")
    authentication_state = snapshot.get("authenticationState")
    expected_authentication = (
        "ANONYMOUS" if actor_role == "anonymous" else "AUTHENTICATED"
    )
    if authentication_state != expected_authentication:
        _fail(
            "STALE_CLIENT_IDENTITY",
            f"runtime client {client_id!r} authentication identity differs from the manifest",
        )
    actor_identity = snapshot.get("actorPtidSha256")
    actor_role_digest = client.get("actor_role_digest")
    if expected_authentication == "AUTHENTICATED":
        if (
            not isinstance(actor_identity, str)
            or not isinstance(actor_role_digest, str)
            or not hmac.compare_digest(actor_identity, actor_role_digest)
        ):
            _fail(
                "STALE_CLIENT_IDENTITY",
                f"runtime client {client_id!r} actor identity differs from the manifest",
            )
    elif actor_identity is not None:
        _fail(
            "STALE_CLIENT_IDENTITY",
            f"runtime client {client_id!r} anonymous identity contains an actor",
        )

    if snapshot.get("sourceCommit") != source_commit:
        _fail(
            "STALE_CLIENT_IDENTITY",
            f"runtime client {client_id!r} source commit differs from the manifest",
        )
    client_artifact = _sha256(
        snapshot.get("clientArtifactSha256"),
        f"runtime client {client_id} clientArtifactSha256",
        "STALE_CLIENT_IDENTITY",
    )
    session_identity = _sha256(
        snapshot.get("sessionIdentitySha256"),
        f"runtime client {client_id} sessionIdentitySha256",
        "STALE_CLIENT_IDENTITY",
    )

    expected_station_runtime = hashlib.sha256(
        str(station.get("runtime_identity") or "").encode("utf-8")
    ).hexdigest()
    expected_station_endpoint = hashlib.sha256(
        str(station.get("endpoint") or "").rstrip("/").encode("utf-8")
    ).hexdigest()
    station_runtime = snapshot.get("stationRuntimeIdentitySha256")
    station_endpoint = snapshot.get("stationEndpointSha256")
    if (
        not isinstance(station_runtime, str)
        or not hmac.compare_digest(
            station_runtime,
            expected_station_runtime,
        )
        or not isinstance(station_endpoint, str)
        or not hmac.compare_digest(
            station_endpoint,
            expected_station_endpoint,
        )
    ):
        _fail(
            "STALE_CLIENT_IDENTITY",
            f"runtime client {client_id!r} Station identity differs from the manifest",
        )

    boot_identity = _sha256(
        client.get("boot_identity"),
        f"runtime client {client_id} boot_identity",
        "STALE_CLIENT_IDENTITY",
    )
    observed_boot_identity = _sha256(
        snapshot.get("bootIdentitySha256"),
        f"runtime client {client_id} bootIdentitySha256",
        "STALE_CLIENT_IDENTITY",
    )
    if not hmac.compare_digest(observed_boot_identity, boot_identity):
        _fail(
            "STALE_CLIENT_IDENTITY",
            f"runtime client {client_id!r} boot identity differs from the manifest",
        )
    observed_session_generation = snapshot.get("sessionGeneration")
    if (
        not isinstance(observed_session_generation, int)
        or isinstance(observed_session_generation, bool)
        or observed_session_generation < 1
        or observed_session_generation != client.get("session_generation")
    ):
        _fail(
            "STALE_CLIENT_IDENTITY",
            f"runtime client {client_id!r} session generation differs from the manifest",
        )
    native_runtime_identity = snapshot.get("nativeRuntimeIdentitySha256")
    if runtime_kind == "browser":
        if native_runtime_identity is not None:
            _fail(
                "STALE_CLIENT_IDENTITY",
                f"runtime client {client_id!r} Browser identity contains a Native boot identity",
            )
    elif (
        not isinstance(native_runtime_identity, str)
        or not hmac.compare_digest(native_runtime_identity, boot_identity)
    ):
        _fail(
            "STALE_CLIENT_IDENTITY",
            f"runtime client {client_id!r} boot identity differs from the manifest",
        )

    attachment = client.get("automation_attachment_ref")
    expected_automation_session = (
        attachment.get("session_id")
        if isinstance(attachment, Mapping)
        else None
    )
    if (
        not isinstance(expected_automation_session, str)
        or not isinstance(automation_session_id, str)
        or not hmac.compare_digest(
            automation_session_id,
            expected_automation_session,
        )
    ):
        _fail(
            "STALE_CLIENT_IDENTITY",
            f"runtime client {client_id!r} automation session differs from the manifest",
        )

    return {
        "schemaVersion": HARNESS_IDENTITY_SCHEMA_VERSION,
        "platform": expected_platform,
        "authenticationState": expected_authentication,
        "actorRole": actor_role,
        "actorRoleDigest": actor_role_digest,
        "sourceCommit": source_commit,
        "clientArtifactSha256": client_artifact,
        "stationRuntimeIdentitySha256": station_runtime,
        "stationEndpointSha256": station_endpoint,
        "bootIdentity": observed_boot_identity,
        "sessionGeneration": observed_session_generation,
        "sessionIdentitySha256": session_identity,
        "automationSessionId": automation_session_id,
        **(
            {"nativeRuntimeIdentitySha256": native_runtime_identity}
            if native_runtime_identity is not None
            else {}
        ),
    }


def load_runtime_manifest(
    path: Path,
    *,
    journey_id: str,
    repo_root: Path,
    workspace_identity: Mapping[str, str],
    profile_selectors: Sequence[str],
    client_selectors: Sequence[str],
    runtime: Optional[str],
    expected_protocol_digest: Optional[str] = None,
    required_fixture_capabilities: Sequence[str] = (),
) -> RuntimeManifestBinding:
    resolved, raw_bytes = _read_private_external_file(
        path,
        repo_root=repo_root,
        label="runtime manifest",
    )
    payload = _decode_object(raw_bytes, "runtime manifest")
    return validate_runtime_manifest(
        payload,
        path=resolved,
        raw_bytes=raw_bytes,
        journey_id=journey_id,
        repo_root=repo_root,
        workspace_identity=workspace_identity,
        profile_selectors=profile_selectors,
        client_selectors=client_selectors,
        runtime=runtime,
        expected_protocol_digest=expected_protocol_digest,
        required_fixture_capabilities=required_fixture_capabilities,
    )


def validate_runtime_manifest(
    payload: Mapping[str, Any],
    *,
    path: Path,
    raw_bytes: bytes,
    journey_id: str,
    repo_root: Path,
    workspace_identity: Mapping[str, str],
    profile_selectors: Sequence[str],
    client_selectors: Sequence[str],
    runtime: Optional[str],
    expected_protocol_digest: Optional[str] = None,
    required_fixture_capabilities: Sequence[str] = (),
) -> RuntimeManifestBinding:
    _closed_object(
        payload,
        required=REQUIRED_TOP_LEVEL_FIELDS,
        allowed=TOP_LEVEL_FIELDS,
        label="runtime manifest",
        code="INVALID_MANIFEST_SCHEMA",
    )
    if (
        payload["schema_version"] != SCHEMA_VERSION
        or isinstance(payload["schema_version"], bool)
        or payload["kind"] != MANIFEST_KIND
    ):
        _fail(
            "UNSUPPORTED_MANIFEST_VERSION",
            f"runtime manifest must be {MANIFEST_CONTRACT}",
        )
    run_id = _identifier(payload["run_id"], "runtime manifest run_id")
    if payload["journey_id"] != journey_id:
        _fail(
            "MANIFEST_JOURNEY_MISMATCH",
            "runtime manifest journey_id differs from the selected Journey",
        )
    manifest_created_at = _timestamp(
        payload["created_at"],
        "runtime manifest created_at",
    )

    source = _closed_mapping(
        payload["source"],
        required=REQUIRED_SOURCE_FIELDS,
        allowed=SOURCE_FIELDS,
        label="runtime manifest source",
        code="SOURCE_IDENTITY_MISMATCH",
    )
    expected_worktree = repo_root.resolve(strict=True)
    source_worktree = _externalized_worktree(
        source["canonical_worktree"],
        expected_worktree,
    )
    del source_worktree
    expected_source = {
        "workspace_id": workspace_identity.get("workspaceId"),
        "commit": workspace_identity.get("head"),
        "worktree_set_digest": workspace_identity.get("worktreeSetDigest"),
        "workspace_digest": "clean",
    }
    for field_name, expected in expected_source.items():
        if not isinstance(expected, str) or not expected:
            _fail(
                "SOURCE_IDENTITY_MISMATCH",
                f"workspace identity is missing {field_name}",
            )
        if source.get(field_name) != expected:
            _fail(
                "SOURCE_IDENTITY_MISMATCH",
                f"runtime manifest source {field_name} differs from the workspace",
            )
    if COMMIT.fullmatch(str(source["commit"])) is None:
        _fail("SOURCE_IDENTITY_MISMATCH", "source commit is invalid")
    if SHA256.fullmatch(str(source["worktree_set_digest"])) is None:
        _fail(
            "SOURCE_IDENTITY_MISMATCH",
            "source worktree_set_digest is invalid",
        )

    controller = _closed_mapping(
        payload["controller_binding"],
        required=CONTROLLER_FIELDS,
        allowed=CONTROLLER_FIELDS,
        label="runtime manifest controller_binding",
        code="CONTROLLER_BINDING_MISMATCH",
    )
    if controller != {"profile_id": "four", "slot": 5}:
        _fail(
            "CONTROLLER_BINDING_MISMATCH",
            "controller binding must remain profile four at slot 5",
        )

    post_cut_epoch_id = payload.get("post_cut_epoch_id")
    final_cut_bindings = payload.get("final_cut_bindings")
    if (post_cut_epoch_id is None) != (final_cut_bindings is None):
        _fail(
            "INVALID_MANIFEST_SCHEMA",
            "post-cut epoch and final-cut bindings must be declared together",
        )
    if post_cut_epoch_id is not None:
        _identifier(
            post_cut_epoch_id,
            "runtime manifest post_cut_epoch_id",
        )
        bindings = _closed_mapping(
            final_cut_bindings,
            required=POST_CUT_PROFILES,
            allowed=POST_CUT_PROFILES,
            label="runtime manifest final_cut_bindings",
            code="INVALID_MANIFEST_SCHEMA",
        )
        for profile_id, raw_binding in bindings.items():
            binding = _closed_mapping(
                raw_binding,
                required=FINAL_CUT_BINDING_FIELDS,
                allowed=FINAL_CUT_BINDING_FIELDS,
                label=f"runtime manifest final_cut_bindings.{profile_id}",
                code="INVALID_MANIFEST_SCHEMA",
            )
            _sha256(
                binding["result_digest"],
                f"final_cut_bindings.{profile_id}.result_digest",
                "INVALID_MANIFEST_SCHEMA",
            )
            _identifier_for_code(
                binding["reset_id"],
                f"final_cut_bindings.{profile_id}.reset_id",
                "INVALID_MANIFEST_SCHEMA",
            )
            _sha256(
                binding["schema_attestation_digest"],
                f"final_cut_bindings.{profile_id}.schema_attestation_digest",
                "INVALID_MANIFEST_SCHEMA",
            )
            _nonempty(
                binding["station_runtime_identity"],
                f"final_cut_bindings.{profile_id}.station_runtime_identity",
                "INVALID_MANIFEST_SCHEMA",
            )

    services, service_profiles, service_provenance = _validate_services(
        payload["services"],
        manifest_path=path,
        source=source,
        run_id=run_id,
        journey_id=journey_id,
        expected_protocol_digest=expected_protocol_digest,
    )
    selectors = tuple(profile_selectors)
    if (
        not selectors
        or len(set(selectors)) != len(selectors)
        or set(selectors) != service_profiles
    ):
        _fail(
            "PROFILE_SELECTOR_DRIFT",
            "CLI profile selectors must equal the manifest service-profile set",
        )

    (
        fixture_payload,
        fixture_path,
        fixture_bytes,
        fixture_handles,
    ) = _validate_fixture_manifest(
        payload,
        manifest_path=path,
        source_commit=str(source["commit"]),
    )
    handles = fixture_payload["handles"]
    fixture_capabilities = frozenset(
        str(handle["capability"]) for handle in handles
    )
    missing_capabilities = (
        set(required_fixture_capabilities) - fixture_capabilities
    )
    if missing_capabilities:
        _fail(
            "FIXTURE_CAPABILITY_UNAVAILABLE",
            "runtime fixture manifest is missing capabilities: "
            + ", ".join(sorted(missing_capabilities)),
            retryable=True,
        )

    clients = _validate_clients(payload["clients"], services)
    _validate_client_selectors(
        clients,
        selectors=client_selectors,
        runtime=runtime,
    )
    lifecycle_capabilities = payload["lifecycle_observer_capabilities"]
    if (
        not isinstance(lifecycle_capabilities, list)
        or not lifecycle_capabilities
        or len(set(lifecycle_capabilities)) != len(lifecycle_capabilities)
        or any(
            capability not in LIFECYCLE_OBSERVER_CAPABILITIES
            for capability in lifecycle_capabilities
        )
    ):
        _fail(
            "LIFECYCLE_LINEAGE_MISMATCH",
            "runtime manifest lifecycle observer capabilities are invalid",
        )

    continuation_provenance: tuple[tuple[Path, bytes], ...] = ()
    continuation = payload.get("continuation")
    if continuation is not None:
        continuation_provenance = _validate_continuation_shape(
            continuation,
            clients,
            manifest_path=path,
            manifest_created_at=manifest_created_at,
        )

    manifest_content = dict(payload)
    manifest_digest = manifest_content.pop("manifest_digest")
    if (
        not isinstance(manifest_digest, str)
        or SHA256.fullmatch(manifest_digest) is None
        or not hmac.compare_digest(
            manifest_digest,
            canonical_digest(manifest_content),
        )
    ):
        _fail(
            "MUTABLE_MANIFEST_LINEAGE",
            "runtime manifest digest is invalid",
        )

    return RuntimeManifestBinding(
        path=path,
        sha256=manifest_digest,
        run_id=run_id,
        payload=payload,
        clients=clients,
        services=services,
        service_profiles=frozenset(service_profiles),
        fixture_capabilities=fixture_capabilities,
        fixture_handles=fixture_handles,
        raw_bytes=raw_bytes,
        provenance_files=(
            *service_provenance,
            (fixture_path, fixture_bytes),
            *continuation_provenance,
        ),
    )


def validate_harness_snapshot(
    binding: RuntimeManifestBinding,
    client_id: str,
    snapshot: Mapping[str, Any],
    *,
    automation_session_id: str,
) -> None:
    client = binding.client(client_id)
    _, station = binding.service_for_client(client_id, "station")
    observed = harness_identity_digest(
        snapshot,
        client=client,
        source_commit=str(binding.payload["source"]["commit"]),
        station=station,
        automation_session_id=automation_session_id,
    )
    if not hmac.compare_digest(observed, str(client["harness_identity_digest"])):
        _fail(
            "STALE_CLIENT_IDENTITY",
            f"runtime client {client_id!r} live Harness identity differs from the manifest",
        )


def validate_owner_continuation(
    parent: RuntimeManifestBinding,
    child: RuntimeManifestBinding,
    *,
    restart_request: Mapping[str, Any],
    acknowledgement: Mapping[str, Any],
    resume_artifact_digest: str,
) -> None:
    continuation = child.payload.get("continuation")
    if not isinstance(continuation, Mapping):
        _fail(
            "RUNTIME_CONTINUATION_IDENTITY_MISMATCH",
            "child runtime manifest has no owner continuation lineage",
        )
    client_id = str(continuation["retained_client_id"])
    parent_client = parent.client(client_id)
    child_client = child.client(client_id)
    expected_request = {
        "schema_version": 1,
        "kind": "secure-content-runtime-restart-request",
        "run_id": parent.run_id,
        "request_id": continuation["restart_request_id"],
        "client_id": client_id,
        "parent_runtime_manifest_digest": parent.sha256,
        "expected_source_checkpoint": parent.payload["source"]["commit"],
        "expected_profile": sorted(parent.service_profiles),
        "retained_storage_identity_digest": parent_client[
            "storage_identity_digest"
        ],
        "resume_artifact_digest": resume_artifact_digest,
    }
    for field_name, expected in expected_request.items():
        if restart_request.get(field_name) != expected:
            _fail(
                "RUNTIME_CONTINUATION_IDENTITY_MISMATCH",
                f"restart request has invalid {field_name}",
            )
    acknowledgement = _closed_mapping(
        acknowledgement,
        required=CONTINUATION_ACKNOWLEDGEMENT_FIELDS,
        allowed=CONTINUATION_ACKNOWLEDGEMENT_FIELDS,
        label="runtime owner acknowledgement",
        code="RUNTIME_CONTINUATION_IDENTITY_MISMATCH",
    )
    acknowledgement_content = dict(acknowledgement)
    acknowledgement_digest = acknowledgement_content.pop(
        "artifact_digest",
        None,
    )
    if (
        not isinstance(acknowledgement_digest, str)
        or SHA256.fullmatch(acknowledgement_digest) is None
        or not hmac.compare_digest(
            acknowledgement_digest,
            canonical_digest(acknowledgement_content),
        )
    ):
        _fail(
            "RUNTIME_CONTINUATION_IDENTITY_MISMATCH",
            "runtime owner acknowledgement digest is invalid",
        )
    expected_acknowledgement = {
        "schema_version": 1,
        "kind": CONTINUATION_ACKNOWLEDGEMENT_KIND,
        "request_id": continuation["restart_request_id"],
        "owner_id": RUNTIME_OWNER_ID,
        "acknowledgement_id": continuation[
            "runtime_owner_acknowledgement_id"
        ],
        "parent_runtime_manifest_digest": parent.sha256,
        "child_runtime_manifest_digest": child.sha256,
        "previous_boot_identity": parent_client["boot_identity"],
        "current_boot_identity": child_client["boot_identity"],
        "session_generation": child_client["session_generation"],
        "retained_storage_identity_digest": child_client[
            "storage_identity_digest"
        ],
        "lease_evidence_ref": continuation["lease_evidence_ref"],
    }
    for field_name, expected in expected_acknowledgement.items():
        if acknowledgement.get(field_name) != expected:
            _fail(
                "RUNTIME_CONTINUATION_IDENTITY_MISMATCH",
                f"runtime owner acknowledgement has invalid {field_name}",
            )
    if (
        continuation["parent_manifest_digest"] != parent.sha256
        or continuation["retained_storage_identity_digest"]
        != parent_client["storage_identity_digest"]
        or child_client["storage_identity_digest"]
        != parent_client["storage_identity_digest"]
        or continuation["previous_boot_identity"]
        != parent_client["boot_identity"]
        or child_client["boot_identity"] == parent_client["boot_identity"]
        or child_client["session_generation"]
        < parent_client["session_generation"]
        or child_client["automation_attachment_ref"]["session_id"]
        == parent_client["automation_attachment_ref"]["session_id"]
        or child.payload["source"] != parent.payload["source"]
        or child.service_profiles != parent.service_profiles
        or _stable_service_topology(child.services)
        != _stable_service_topology(parent.services)
        or _stable_client_topology(child.clients, retained_client_id=client_id)
        != _stable_client_topology(parent.clients, retained_client_id=client_id)
    ):
        _fail(
            "RUNTIME_CONTINUATION_IDENTITY_MISMATCH",
            "child manifest does not preserve source, service, client, storage, boot, session, and automation lineage",
        )


def _stable_service_topology(
    services: Mapping[str, Mapping[str, Any]],
) -> dict[str, dict[str, Any]]:
    return {
        service_id: {
            field_name: value
            for field_name, value in service.items()
            if field_name != "attestation_artifact_ref"
        }
        for service_id, service in services.items()
    }


def _stable_client_topology(
    clients: Mapping[str, Mapping[str, Any]],
    *,
    retained_client_id: str,
) -> dict[str, dict[str, Any]]:
    changing_retained_fields = {
        "boot_identity",
        "session_generation",
        "automation_attachment_ref",
        "harness_identity_digest",
    }
    return {
        client_id: {
            field_name: value
            for field_name, value in client.items()
            if client_id != retained_client_id
            or field_name not in changing_retained_fields
        }
        for client_id, client in clients.items()
    }


def _validate_services(
    value: Any,
    *,
    manifest_path: Path,
    source: Mapping[str, Any],
    run_id: str,
    journey_id: str,
    expected_protocol_digest: Optional[str],
) -> tuple[
    dict[str, Mapping[str, Any]],
    set[str],
    tuple[tuple[Path, bytes], ...],
]:
    if not isinstance(value, Mapping) or not value:
        _fail(
            "SERVICE_CLOSURE_MISMATCH",
            "runtime manifest services must be a non-empty object",
        )
    services: dict[str, Mapping[str, Any]] = {}
    profiles: set[str] = set()
    provenance: list[tuple[Path, bytes]] = []
    for service_id, raw_service in value.items():
        if (
            not isinstance(service_id, str)
            or SERVICE_IDENTIFIER.fullmatch(service_id) is None
        ):
            _fail(
                "SERVICE_CLOSURE_MISMATCH",
                f"runtime manifest service id is invalid: {service_id!r}",
            )
        service = _closed_mapping(
            raw_service,
            required=BASE_SERVICE_FIELDS,
            allowed=SERVICE_FIELDS,
            label=f"runtime manifest service {service_id!r}",
            code="SERVICE_CLOSURE_MISMATCH",
        )
        kind = _identifier(service["kind"], f"service {service_id} kind")
        profile_id = _identifier(
            service["profile_id"],
            f"service {service_id} profile_id",
        )
        if profile_id not in CANONICAL_PROFILES:
            _fail(
                "SERVICE_CLOSURE_MISMATCH",
                f"service {service_id!r} uses an unapproved profile",
            )
        if (
            kind == "station"
            and service["deployment_environment"]
            != CANONICAL_PROFILES[profile_id]
        ):
            _fail(
                "SERVICE_CLOSURE_MISMATCH",
                f"service {service_id!r} deployment environment is not canonical",
            )
        _endpoint(
            service["endpoint"],
            f"service {service_id} endpoint",
            code="SERVICE_CLOSURE_MISMATCH",
        )
        _endpoint(
            service["schema_attestation_endpoint"],
            f"service {service_id} schema_attestation_endpoint",
            code="CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
        )
        for field_name in (
            "deployment_environment",
            "runtime_identity",
        ):
            _nonempty(
                service[field_name],
                f"service {service_id} {field_name}",
                "SERVICE_CLOSURE_MISMATCH",
            )
        if service["live_commit"] != source["commit"]:
            _fail(
                "SOURCE_ATTESTATION_MISMATCH",
                f"service {service_id!r} live commit differs from source",
            )
        if (
            not isinstance(service["protocol_digest"], str)
            or SHA256.fullmatch(service["protocol_digest"]) is None
            or (
                expected_protocol_digest is not None
                and service["protocol_digest"] != expected_protocol_digest
            )
        ):
            _fail(
                "SOURCE_ATTESTATION_MISMATCH",
                f"service {service_id!r} protocol digest differs from source",
            )
        reference = _artifact_ref(
            service["attestation_artifact_ref"],
            f"service {service_id} attestation_artifact_ref",
        )
        attestation_path, attestation_bytes = _read_relative_artifact(
            manifest_path,
            reference,
            f"service {service_id} attestation",
        )
        attestation = _decode_object(
            attestation_bytes,
            f"service {service_id} attestation",
        )
        expected_attestation = {
            "artifactKind": SERVICE_ATTESTATION_KIND,
            "serviceId": service_id,
            "serviceKind": kind,
            "deploymentEnvironment": service["deployment_environment"],
            "endpoint": service["endpoint"],
            "commit": service["live_commit"],
            "workspaceDigest": "clean",
            "protocolDigest": service["protocol_digest"],
            "runtimeIdentity": service["runtime_identity"],
        }
        for field_name, expected in expected_attestation.items():
            if attestation.get(field_name) != expected:
                _fail(
                    "SOURCE_ATTESTATION_MISMATCH",
                    f"service {service_id!r} attestation has invalid {field_name}",
                )
        if attestation.get("runId") != run_id:
            _fail(
                "SOURCE_ATTESTATION_MISMATCH",
                f"service {service_id!r} attestation has invalid runId",
            )
        if attestation.get("gateId") != journey_id:
            _fail(
                "SOURCE_ATTESTATION_MISMATCH",
                f"service {service_id!r} attestation has invalid gateId",
            )
        if "canonical_private_schema_attestation_ref" not in service:
            _fail(
                "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
                f"service {service_id!r} has no canonical private schema attestation",
            )
        schema_reference = _artifact_ref(
            service["canonical_private_schema_attestation_ref"],
            (
                f"service {service_id} "
                "canonical_private_schema_attestation_ref"
            ),
            code="CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
        )
        schema_path, schema_bytes = _read_relative_artifact(
            manifest_path,
            schema_reference,
            f"service {service_id} canonical private schema attestation",
            code="CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
        )
        schema_attestation = _decode_object(
            schema_bytes,
            f"service {service_id} canonical private schema attestation",
            code="CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE",
        )
        schema_workspace_id = source.get(
            "source_evidence_workspace_id",
            source["workspace_id"],
        )
        _nonempty(
            schema_workspace_id,
            "runtime manifest source source_evidence_workspace_id",
            "SOURCE_IDENTITY_MISMATCH",
        )
        schema_provenance = _validate_canonical_private_schema_attestation(
            schema_attestation,
            attestation_path=schema_path,
            source_commit=str(source["commit"]),
            workspace_id=str(schema_workspace_id),
            service_id=service_id,
            profile_id=profile_id,
            deployment_environment=str(service["deployment_environment"]),
            station_runtime_identity=str(service["runtime_identity"]),
            service_attestation_digest=schema_service_attestation_binding_digest(
                service_id,
                service,
            ),
        )
        services[service_id] = service
        profiles.add(profile_id)
        provenance.append((attestation_path, attestation_bytes))
        provenance.append((schema_path, schema_bytes))
        provenance.extend(schema_provenance)
    return services, profiles, tuple(provenance)


def _validate_clients(
    value: Any,
    services: Mapping[str, Mapping[str, Any]],
) -> dict[str, Mapping[str, Any]]:
    if not isinstance(value, list) or not value:
        _fail(
            "CLIENT_CLOSURE_MISMATCH",
            "runtime manifest clients must be a non-empty array",
        )
    clients: dict[str, Mapping[str, Any]] = {}
    storage_identities: set[str] = set()
    boot_identities: set[str] = set()
    attachment_identities: set[tuple[str, str]] = set()
    for raw_client in value:
        client = _closed_mapping(
            raw_client,
            required=CLIENT_FIELDS,
            allowed=CLIENT_FIELDS,
            label="runtime manifest client",
            code="CLIENT_CLOSURE_MISMATCH",
        )
        client_id = _identifier_for_code(
            client["id"],
            "runtime manifest client id",
            "CLIENT_CLOSURE_MISMATCH",
        )
        if client_id in clients:
            _fail(
                "DUPLICATE_CLIENT_ID",
                f"runtime manifest client id is duplicated: {client_id!r}",
            )
        _nonempty(
            client["actor_role"],
            f"client {client_id} actor_role",
            "CLIENT_CLOSURE_MISMATCH",
        )
        _sha256(
            client["actor_role_digest"],
            f"client {client_id} actor_role_digest",
            "STALE_CLIENT_IDENTITY",
        )
        runtime_kind = client["runtime_kind"]
        if runtime_kind not in CLIENT_KINDS:
            _fail(
                "UNKNOWN_CLIENT_KIND",
                f"runtime client {client_id!r} has unsupported runtime_kind",
            )
        roles = client["required_service_roles"]
        bindings = client["service_bindings"]
        if (
            not isinstance(roles, list)
            or not roles
            or "station" not in roles
            or len(set(roles)) != len(roles)
            or any(
                not isinstance(role, str)
                or SERVICE_IDENTIFIER.fullmatch(role) is None
                for role in roles
            )
            or not isinstance(bindings, Mapping)
        ):
            _fail(
                "SERVICE_CLOSURE_MISMATCH",
                f"runtime client {client_id!r} service roles are invalid",
            )
        if set(roles) != set(bindings):
            _fail(
                "SERVICE_CLOSURE_MISMATCH",
                f"runtime client {client_id!r} service bindings are not closed",
            )
        station_binding = bindings.get("station")
        if (
            not isinstance(station_binding, Mapping)
            or station_binding.get("required_kind") != "station"
        ):
            _fail(
                "SERVICE_CLOSURE_MISMATCH",
                f"runtime client {client_id!r} Station binding is invalid",
            )
        for role, raw_binding in bindings.items():
            binding = _closed_mapping(
                raw_binding,
                required=BINDING_FIELDS,
                allowed=BINDING_FIELDS,
                label=f"client {client_id} binding {role}",
                code="SERVICE_CLOSURE_MISMATCH",
            )
            service_id = binding["service_id"]
            service = services.get(service_id)
            if not isinstance(service, Mapping):
                _fail(
                    "SERVICE_CLOSURE_MISMATCH",
                    f"runtime client {client_id!r} has a dangling service binding",
                )
            if service["kind"] != binding["required_kind"]:
                _fail(
                    "SERVICE_CLOSURE_MISMATCH",
                    f"runtime client {client_id!r} service kind does not match",
                )

        storage_identity = _sha256(
            client["storage_identity_digest"],
            f"client {client_id} storage_identity_digest",
            "STALE_CLIENT_IDENTITY",
        )
        if storage_identity in storage_identities:
            _fail(
                "DUPLICATE_STORAGE_IDENTITY",
                "runtime clients must not share a storage identity",
            )
        boot_identity = _sha256(
            client["boot_identity"],
            f"client {client_id} boot_identity",
            "STALE_CLIENT_IDENTITY",
        )
        if boot_identity in boot_identities:
            _fail(
                "STALE_CLIENT_IDENTITY",
                "runtime clients must not share a boot identity",
            )
        generation = client["session_generation"]
        if (
            not isinstance(generation, int)
            or isinstance(generation, bool)
            or generation < 1
        ):
            _fail(
                "STALE_CLIENT_IDENTITY",
                f"runtime client {client_id!r} session_generation is invalid",
            )
        _sha256(
            client["harness_identity_digest"],
            f"client {client_id} harness_identity_digest",
            "STALE_CLIENT_IDENTITY",
        )
        attachment = _closed_mapping(
            client["automation_attachment_ref"],
            required=AUTOMATION_REF_FIELDS,
            allowed=AUTOMATION_REF_FIELDS,
            label=f"client {client_id} automation_attachment_ref",
            code="UNSUPPORTED_ATTACHMENT",
        )
        if attachment["kind"] != AUTOMATION_ATTACHMENT_KIND:
            _fail(
                "UNSUPPORTED_ATTACHMENT",
                f"runtime client {client_id!r} attachment kind is unsupported",
            )
        endpoint = _endpoint(
            attachment["endpoint"],
            f"client {client_id} automation endpoint",
            loopback_only=True,
        )
        session_id = _nonempty(
            attachment["session_id"],
            f"client {client_id} automation session_id",
            "UNSUPPORTED_ATTACHMENT",
        )
        attachment_identity = (endpoint, session_id)
        if attachment_identity in attachment_identities:
            _fail(
                "UNSUPPORTED_ATTACHMENT",
                "runtime clients must not share an automation attachment",
            )
        storage_identities.add(storage_identity)
        boot_identities.add(boot_identity)
        attachment_identities.add(attachment_identity)
        clients[client_id] = client
    return clients


def _validate_canonical_private_schema_attestation(
    attestation: Mapping[str, Any],
    *,
    attestation_path: Path,
    source_commit: str,
    workspace_id: str,
    service_id: str,
    profile_id: str,
    deployment_environment: str,
    station_runtime_identity: str,
    service_attestation_digest: str,
) -> tuple[tuple[Path, bytes], ...]:
    code = "CANONICAL_PRIVATE_SCHEMA_UNAVAILABLE"
    label = f"service {service_id} canonical private schema attestation"
    _closed_object(
        attestation,
        required=CANONICAL_PRIVATE_SCHEMA_ATTESTATION_FIELDS,
        allowed=CANONICAL_PRIVATE_SCHEMA_ATTESTATION_FIELDS,
        label=label,
        code=code,
    )
    if attestation_path.name != CANONICAL_PRIVATE_SCHEMA_ATTESTATION_FILENAME:
        _fail(code, f"{label} filename is not canonical")
    if attestation["schema_version"] != 1 or isinstance(
        attestation["schema_version"],
        bool,
    ):
        _fail(code, f"{label} schema_version is invalid")
    expected = {
        "source_commit": source_commit,
        "workspace_id": workspace_id,
        "profile_id": profile_id,
        "deployment_environment": deployment_environment,
        "destructive_scope": CANONICAL_PRIVATE_SCHEMA_SCOPES.get(profile_id),
        "station_service_id": service_id,
        "station_runtime_identity": station_runtime_identity,
        "service_attestation_digest": service_attestation_digest,
    }
    for field_name, expected_value in expected.items():
        if expected_value is None or attestation.get(field_name) != expected_value:
            _fail(code, f"{label} has invalid {field_name}")
    _nonempty(attestation["station_peer_id"], f"{label} station_peer_id", code)
    if attestation["reset_intent"] not in RESET_INTENTS:
        _fail(code, f"{label} has invalid reset_intent")
    for field_name in (
        "service_attestation_digest",
        "reset_manifest_digest",
        "completed_journal_digest",
        "canonical_private_schema_digest",
        "public_snapshot_digest",
        "attestation_digest",
    ):
        _sha256(attestation[field_name], f"{label} {field_name}", code)
    if attestation["retired_columns_absent"] is not True:
        _fail(code, f"{label} does not prove retired-column absence")
    _timestamp_for_code(attestation["created_at"], f"{label} created_at", code)
    content = dict(attestation)
    digest = content.pop("attestation_digest")
    if not hmac.compare_digest(digest, canonical_digest(content)):
        _fail(code, f"{label} digest is invalid")

    reset_path, reset_bytes = _read_adjacent_artifact(
        attestation_path,
        RESET_MANIFEST_FILENAME,
        f"{label} reset manifest",
        code=code,
    )
    reset_manifest = _decode_object(
        reset_bytes,
        f"{label} reset manifest",
        code=code,
    )
    _closed_object(
        reset_manifest,
        required=RESET_MANIFEST_FIELDS,
        allowed=RESET_MANIFEST_FIELDS | RESET_MANIFEST_OPTIONAL_FIELDS,
        label=f"{label} reset manifest",
        code=code,
    )
    if reset_manifest["schema_version"] != 1 or isinstance(
        reset_manifest["schema_version"],
        bool,
    ):
        _fail(code, f"{label} reset manifest schema_version is invalid")
    reset_expected = {
        "reset_intent": attestation["reset_intent"],
        "source_commit": source_commit,
        "workspace_id": workspace_id,
        "profile_id": profile_id,
        "deployment_environment": deployment_environment,
        "destructive_scope": attestation["destructive_scope"],
    }
    for field_name, expected_value in reset_expected.items():
        if reset_manifest.get(field_name) != expected_value:
            _fail(code, f"{label} reset manifest has invalid {field_name}")
    reset_content = dict(reset_manifest)
    reset_digest = reset_content.pop("manifest_digest", None)
    if (
        reset_digest != attestation["reset_manifest_digest"]
        or not isinstance(reset_digest, str)
        or not hmac.compare_digest(reset_digest, canonical_digest(reset_content))
    ):
        _fail(code, f"{label} reset manifest digest is invalid")
    _sha256(
        reset_manifest["database_identity_digest"],
        f"{label} database_identity_digest",
        code,
    )
    _timestamp_for_code(
        reset_manifest["created_at"],
        f"{label} reset manifest created_at",
        code,
    )
    for field_name in (
        "database_targets",
        "canonical_private_object_targets",
        "legacy_oss_object_targets",
        "out_of_scope_table_names",
    ):
        if not isinstance(reset_manifest[field_name], list):
            _fail(code, f"{label} reset manifest has invalid {field_name}")
    if "recovery_predecessor" in reset_manifest:
        recovery = reset_manifest["recovery_predecessor"]
        recovery = _closed_mapping(
            recovery,
            required=RESET_RECOVERY_PREDECESSOR_FIELDS,
            allowed=RESET_RECOVERY_PREDECESSOR_FIELDS,
            label=f"{label} recovery predecessor",
            code=code,
        )
        state_and_failure = (
            recovery["state"],
            recovery["failure_code"],
        )
        if (
            recovery["reset_id"] == reset_manifest["reset_id"]
            or state_and_failure
            not in {
                ("OBJECTS_DELETED", "RESET_SOURCE_SUPERSEDED"),
                ("STATION_DEPLOYED", "RESET_SCHEMA_TARGET_UNREVIEWED"),
            }
        ):
            _fail(code, f"{label} recovery predecessor identity is invalid")
        _identifier_for_code(
            recovery["reset_id"],
            f"{label} recovery predecessor reset_id",
            code,
        )
        _sha256(
            recovery["reset_manifest_digest"],
            f"{label} recovery predecessor reset_manifest_digest",
            code,
        )
        _sha256(
            recovery["journal_digest"],
            f"{label} recovery predecessor journal_digest",
            code,
        )

    public_snapshot = _closed_mapping(
        reset_manifest["public_snapshot_before"],
        required=PUBLIC_SOCIAL_SNAPSHOT_FIELDS,
        allowed=PUBLIC_SOCIAL_SNAPSHOT_FIELDS,
        label=f"{label} public snapshot",
        code=code,
    )
    if (
        public_snapshot["schema_version"] != 1
        or isinstance(public_snapshot["schema_version"], bool)
        or public_snapshot["profile_id"] != profile_id
        or not isinstance(public_snapshot["counts"], Mapping)
    ):
        _fail(code, f"{label} public snapshot identity is invalid")
    for field_name in PUBLIC_SOCIAL_SNAPSHOT_FIELDS - {
        "schema_version",
        "profile_id",
        "counts",
    }:
        _sha256(public_snapshot[field_name], f"{label} {field_name}", code)
    snapshot_content = dict(public_snapshot)
    snapshot_digest = snapshot_content.pop("snapshot_digest")
    if (
        snapshot_digest != attestation["public_snapshot_digest"]
        or not hmac.compare_digest(
            snapshot_digest,
            canonical_digest(snapshot_content),
        )
    ):
        _fail(code, f"{label} public snapshot digest is invalid")

    journal_path, journal_bytes = _read_adjacent_artifact(
        attestation_path,
        COMPLETED_RESET_JOURNAL_FILENAME,
        f"{label} completed journal",
        code=code,
    )
    journal = _decode_object(
        journal_bytes,
        f"{label} completed journal",
        code=code,
    )
    _closed_object(
        journal,
        required=REQUIRED_RESET_JOURNAL_FIELDS,
        allowed=RESET_JOURNAL_FIELDS,
        label=f"{label} completed journal",
        code=code,
    )
    if (
        journal["schema_version"] != 1
        or isinstance(journal["schema_version"], bool)
        or journal["reset_manifest_digest"] != reset_digest
        or journal["current_state"] != "COMPLETE"
        or not isinstance(journal["accepted_invocations"], list)
        or not journal["accepted_invocations"]
        or not isinstance(journal["transitions"], list)
        or not journal["transitions"]
        or journal.get("failure") is not None
    ):
        _fail(code, f"{label} completed journal is not COMPLETE")
    journal_digest = canonical_digest(journal)
    if (
        journal_digest != attestation["completed_journal_digest"]
        or not hmac.compare_digest(
            journal_digest,
            attestation["completed_journal_digest"],
        )
    ):
        _fail(code, f"{label} completed journal digest is invalid")
    for index, accepted_value in enumerate(journal["accepted_invocations"]):
        accepted = _closed_mapping(
            accepted_value,
            required=RESET_INVOCATION_ACCEPTANCE_FIELDS,
            allowed=RESET_INVOCATION_ACCEPTANCE_FIELDS,
            label=f"{label} accepted invocation {index}",
            code=code,
        )
        _identifier_for_code(
            accepted["invocation_id"],
            f"{label} accepted invocation {index} id",
            code,
        )
        _sha256(
            accepted["invocation_digest"],
            f"{label} accepted invocation {index} digest",
            code,
        )
        _timestamp_for_code(
            accepted["accepted_at"],
            f"{label} accepted invocation {index} accepted_at",
            code,
        )
    if len(journal["transitions"]) != len(RESET_JOURNAL_STATES) - 1:
        _fail(code, f"{label} completed journal transitions are incomplete")
    for index, transition_value in enumerate(journal["transitions"]):
        transition = _closed_mapping(
            transition_value,
            required=RESET_TRANSITION_FIELDS,
            allowed=RESET_TRANSITION_FIELDS,
            label=f"{label} transition {index}",
            code=code,
        )
        if (
            transition["from_state"] != RESET_JOURNAL_STATES[index]
            or transition["to_state"] != RESET_JOURNAL_STATES[index + 1]
        ):
            _fail(code, f"{label} completed journal transitions are invalid")
        _timestamp_for_code(
            transition["transitioned_at"],
            f"{label} transition {index} transitioned_at",
            code,
        )
        transition_content = dict(transition)
        transition_digest = transition_content.pop("transition_digest")
        if (
            not isinstance(transition_digest, str)
            or not hmac.compare_digest(
                transition_digest,
                canonical_digest(transition_content),
            )
        ):
            _fail(code, f"{label} transition {index} digest is invalid")
    return (
        (reset_path, reset_bytes),
        (journal_path, journal_bytes),
    )


def _validate_client_selectors(
    clients: Mapping[str, Mapping[str, Any]],
    *,
    selectors: Sequence[str],
    runtime: Optional[str],
) -> None:
    selected = tuple(selectors)
    if len(set(selected)) != len(selected):
        _fail(
            "CLIENT_CLOSURE_MISMATCH",
            "CLI client selectors must not contain duplicates",
        )
    if runtime is None:
        expected = set(clients)
    else:
        accepted_kinds = RUNTIME_CLIENT_KINDS.get(runtime)
        if accepted_kinds is None:
            _fail(
                "UNKNOWN_CLIENT_KIND",
                f"runtime {runtime!r} cannot attach manifest clients",
            )
        expected = {
            client_id
            for client_id, client in clients.items()
            if client["runtime_kind"] in accepted_kinds
        }
    if not expected or set(selected) != expected:
        _fail(
            "CLIENT_CLOSURE_MISMATCH",
            "CLI client selectors must equal the manifest runtime client set",
        )


def _validate_fixture_manifest(
    payload: Mapping[str, Any],
    *,
    manifest_path: Path,
    source_commit: str,
) -> tuple[
    Mapping[str, Any],
    Path,
    bytes,
    Mapping[str, Mapping[str, Any]],
]:
    reference = _artifact_ref(
        payload["fixture_manifest_ref"],
        "fixture_manifest_ref",
    )
    fixture_path, fixture_bytes = _read_relative_artifact(
        manifest_path,
        reference,
        "fixture manifest",
    )
    fixture = _decode_object(fixture_bytes, "fixture manifest")
    _closed_object(
        fixture,
        required=FIXTURE_FIELDS,
        allowed=FIXTURE_FIELDS,
        label="fixture manifest",
        code="FIXTURE_CAPABILITY_UNAVAILABLE",
    )
    if (
        fixture["schema_version"] != 1
        or fixture["kind"] != FIXTURE_MANIFEST_KIND
        or fixture["source_checkpoint"] != source_commit
    ):
        _fail(
            "FIXTURE_CAPABILITY_UNAVAILABLE",
            "fixture manifest identity differs from the runtime source",
        )
    _identifier(fixture["fixture_set_id"], "fixture manifest fixture_set_id")
    fixture_content = dict(fixture)
    fixture_digest = fixture_content.pop("manifest_digest")
    if (
        not isinstance(fixture_digest, str)
        or SHA256.fullmatch(fixture_digest) is None
        or not hmac.compare_digest(
            fixture_digest,
            canonical_digest(fixture_content),
        )
        or fixture_digest != payload["fixture_manifest_digest"]
    ):
        _fail(
            "FIXTURE_CAPABILITY_UNAVAILABLE",
            "fixture manifest digest is invalid",
        )
    handles = fixture["handles"]
    if not isinstance(handles, list):
        _fail(
            "FIXTURE_CAPABILITY_UNAVAILABLE",
            "fixture manifest handles must be an array",
        )
    handle_ids: set[str] = set()
    capabilities: set[str] = set()
    validated_handles: dict[str, Mapping[str, Any]] = {}
    for raw_handle in handles:
        handle = _closed_mapping(
            raw_handle,
            required=REQUIRED_FIXTURE_HANDLE_FIELDS,
            allowed=FIXTURE_HANDLE_FIELDS,
            label="fixture handle",
            code="FIXTURE_CAPABILITY_UNAVAILABLE",
        )
        handle_id = _identifier(handle["opaque_id"], "fixture opaque_id")
        capability = _identifier(handle["capability"], "fixture capability")
        _identifier(handle["kind"], "fixture kind")
        _identifier(handle["owner"], "fixture owner")
        _sha256(
            handle["expected_identity_digest"],
            "fixture expected_identity_digest",
            "FIXTURE_CAPABILITY_UNAVAILABLE",
        )
        if handle_id in handle_ids or capability in capabilities:
            _fail(
                "FIXTURE_CAPABILITY_UNAVAILABLE",
                "fixture handles contain duplicate identities or capabilities",
            )
        secret_ref = handle.get("secret_channel_ref")
        if secret_ref is not None:
            _identifier(secret_ref, "fixture secret_channel_ref")
        handle_ids.add(handle_id)
        capabilities.add(capability)
        validated_handles[capability] = MappingProxyType(dict(handle))
    return (
        fixture,
        fixture_path,
        fixture_bytes,
        MappingProxyType(validated_handles),
    )


def _validate_continuation_shape(
    value: Any,
    clients: Mapping[str, Mapping[str, Any]],
    *,
    manifest_path: Path,
    manifest_created_at: datetime,
) -> tuple[tuple[Path, bytes], ...]:
    continuation = _closed_mapping(
        value,
        required=CONTINUATION_FIELDS,
        allowed=CONTINUATION_FIELDS,
        label="runtime manifest continuation",
        code="RUNTIME_CONTINUATION_IDENTITY_MISMATCH",
    )
    _sha256(
        continuation["parent_manifest_digest"],
        "continuation parent_manifest_digest",
        "RUNTIME_CONTINUATION_IDENTITY_MISMATCH",
    )
    _identifier(continuation["restart_request_id"], "restart request id")
    client_id = _identifier_for_code(
        continuation["retained_client_id"],
        "continuation retained_client_id",
        "RUNTIME_CONTINUATION_IDENTITY_MISMATCH",
    )
    client = clients.get(client_id)
    if not isinstance(client, Mapping):
        _fail(
            "RUNTIME_CONTINUATION_IDENTITY_MISMATCH",
            "continuation retained client is missing",
        )
    if (
        continuation["retained_storage_identity_digest"]
        != client["storage_identity_digest"]
        or continuation["previous_boot_identity"] == client["boot_identity"]
    ):
        _fail(
            "RUNTIME_CONTINUATION_IDENTITY_MISMATCH",
            "continuation storage or boot identity is invalid",
        )
    _identifier(
        continuation["runtime_owner_acknowledgement_id"],
        "continuation runtime owner acknowledgement id",
    )
    lease_reference = _artifact_ref(
        continuation["lease_evidence_ref"],
        "continuation lease_evidence_ref",
    )
    lease_path, lease_bytes = _read_relative_artifact(
        manifest_path,
        lease_reference,
        "runtime continuation lease evidence",
    )
    lease_evidence = _closed_mapping(
        _decode_object(lease_bytes, "runtime continuation lease evidence"),
        required=RUNTIME_LEASE_EVIDENCE_FIELDS,
        allowed=RUNTIME_LEASE_EVIDENCE_FIELDS,
        label="runtime continuation lease evidence",
        code="RUNTIME_CONTINUATION_IDENTITY_MISMATCH",
    )
    lease_content = dict(lease_evidence)
    lease_digest = lease_content.pop("artifact_digest", None)
    if (
        not isinstance(lease_digest, str)
        or SHA256.fullmatch(lease_digest) is None
        or not hmac.compare_digest(
            lease_digest,
            canonical_digest(lease_content),
        )
    ):
        _fail(
            "RUNTIME_CONTINUATION_IDENTITY_MISMATCH",
            "runtime continuation lease evidence digest is invalid",
        )
    expected_lease_evidence = {
        "schema_version": 1,
        "kind": RUNTIME_LEASE_EVIDENCE_KIND,
        "owner_id": RUNTIME_OWNER_ID,
        "request_id": continuation["restart_request_id"],
        "parent_manifest_digest": continuation["parent_manifest_digest"],
        "retained_client_id": client_id,
    }
    for field_name, expected in expected_lease_evidence.items():
        if lease_evidence.get(field_name) != expected:
            _fail(
                "RUNTIME_CONTINUATION_IDENTITY_MISMATCH",
                f"runtime continuation lease evidence has invalid {field_name}",
            )
    lease_ids = lease_evidence["lease_ids"]
    if (
        not isinstance(lease_ids, list)
        or not lease_ids
        or len(set(lease_ids)) != len(lease_ids)
        or any(
            not isinstance(lease_id, str)
            or not lease_id
            or lease_id != lease_id.strip()
            for lease_id in lease_ids
        )
    ):
        _fail(
            "RUNTIME_CONTINUATION_IDENTITY_MISMATCH",
            "runtime continuation lease evidence lease_ids are invalid",
        )
    acquired_at = _timestamp(
        lease_evidence["acquired_at"],
        "runtime continuation lease acquired_at",
    )
    expires_at = _timestamp(
        lease_evidence["expires_at"],
        "runtime continuation lease expires_at",
    )
    if (
        expires_at <= acquired_at
        or manifest_created_at < acquired_at
        or manifest_created_at >= expires_at
    ):
        _fail(
            "RUNTIME_CONTINUATION_IDENTITY_MISMATCH",
            "runtime continuation lease evidence does not cover child manifest creation",
        )
    return ((lease_path, lease_bytes),)


def _read_private_external_file(
    path: Path,
    *,
    repo_root: Path,
    label: str,
) -> tuple[Path, bytes]:
    if not path.is_absolute() or path.is_symlink():
        _fail(
            "UNSUPPORTED_ATTACHMENT",
            f"{label} path must be absolute and non-symlinked",
        )
    try:
        resolved = path.resolve(strict=True)
        repository = repo_root.resolve(strict=True)
        metadata = resolved.stat()
        if (
            not resolved.is_file()
            or resolved == repository
            or repository in resolved.parents
        ):
            _fail(
                "UNSUPPORTED_ATTACHMENT",
                f"{label} must be a file outside the repository",
            )
        if (
            metadata.st_uid != os.geteuid()
            or stat_module.S_IMODE(metadata.st_mode) & 0o077
        ):
            _fail(
                "UNSUPPORTED_ATTACHMENT",
                f"{label} must be owned by the current user and mode 0600",
            )
        if metadata.st_size <= 0 or metadata.st_size > MAX_MANIFEST_BYTES:
            _fail("INVALID_MANIFEST_SCHEMA", f"{label} size is invalid")
        return resolved, resolved.read_bytes()
    except RuntimeManifestError:
        raise
    except OSError as error:
        raise RuntimeManifestError(
            "UNSUPPORTED_ATTACHMENT",
            f"cannot read {label}: {error}",
        ) from error


def _read_relative_artifact(
    manifest_path: Path,
    reference: Mapping[str, str],
    label: str,
    *,
    code: str = "MUTABLE_MANIFEST_LINEAGE",
) -> tuple[Path, bytes]:
    relative = Path(reference["path"])
    candidate = manifest_path.parent / relative
    if candidate.is_symlink():
        _fail(
            code,
            f"{label} path must not be symlinked",
        )
    try:
        root = manifest_path.parent.resolve(strict=True)
        resolved = candidate.resolve(strict=True)
        if root not in resolved.parents or not resolved.is_file():
            _fail(
                code,
                f"{label} path escapes the manifest directory",
            )
        raw_bytes = resolved.read_bytes()
    except RuntimeManifestError:
        raise
    except OSError as error:
        raise RuntimeManifestError(
            code,
            f"{label} cannot be read",
        ) from error
    if hashlib.sha256(raw_bytes).hexdigest() != reference["sha256"]:
        _fail(
            code,
            f"{label} digest is invalid",
        )
    return resolved, raw_bytes


def _read_adjacent_artifact(
    parent_artifact_path: Path,
    filename: str,
    label: str,
    *,
    code: str,
) -> tuple[Path, bytes]:
    candidate = parent_artifact_path.parent / filename
    if candidate.is_symlink():
        _fail(code, f"{label} path must not be symlinked")
    try:
        resolved = candidate.resolve(strict=True)
        parent = parent_artifact_path.parent.resolve(strict=True)
        metadata = resolved.stat()
        if (
            resolved.parent != parent
            or not resolved.is_file()
            or metadata.st_uid != os.geteuid()
            or stat_module.S_IMODE(metadata.st_mode) & 0o077
            or metadata.st_size <= 0
            or metadata.st_size > MAX_MANIFEST_BYTES
        ):
            _fail(code, f"{label} is not an immutable private artifact")
        return resolved, resolved.read_bytes()
    except RuntimeManifestError:
        raise
    except OSError as error:
        raise RuntimeManifestError(code, f"{label} cannot be read") from error


def _artifact_ref(
    value: Any,
    label: str,
    *,
    code: str = "MUTABLE_MANIFEST_LINEAGE",
) -> Mapping[str, str]:
    reference = _closed_mapping(
        value,
        required=ARTIFACT_REF_FIELDS,
        allowed=ARTIFACT_REF_FIELDS,
        label=label,
        code=code,
    )
    path = reference["path"]
    if (
        not isinstance(path, str)
        or not path
        or "\\" in path
        or "\x00" in path
        or Path(path).is_absolute()
        or Path(path).as_posix() != path
        or any(part in {"", ".", ".."} for part in path.split("/"))
    ):
        _fail(
            code,
            f"{label} path is not canonical relative POSIX",
        )
    _sha256(reference["sha256"], f"{label} sha256", code)
    return reference


def _closed_mapping(
    value: Any,
    *,
    required: frozenset[str],
    allowed: frozenset[str],
    label: str,
    code: str,
) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        _fail(code, f"{label} must be an object")
    _closed_object(value, required=required, allowed=allowed, label=label, code=code)
    return value


def _closed_object(
    value: Mapping[str, Any],
    *,
    required: frozenset[str],
    allowed: frozenset[str],
    label: str,
    code: str,
) -> None:
    missing = required - set(value)
    unknown = set(value) - allowed
    if missing or unknown:
        detail: list[str] = []
        if missing:
            detail.append("missing " + ", ".join(sorted(missing)))
        if unknown:
            detail.append("unknown " + ", ".join(sorted(unknown)))
        _fail(code, f"{label} has " + "; ".join(detail))


def _decode_object(
    raw_bytes: bytes,
    label: str,
    *,
    code: str = "INVALID_MANIFEST_SCHEMA",
) -> Mapping[str, Any]:
    try:
        value = json.loads(raw_bytes)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeManifestError(
            code,
            f"{label} is not valid JSON",
        ) from error
    if not isinstance(value, Mapping):
        _fail(code, f"{label} must be an object")
    return value


def _externalized_worktree(value: Any, expected: Path) -> Path:
    if not isinstance(value, str) or not value:
        _fail(
            "SOURCE_IDENTITY_MISMATCH",
            "runtime manifest canonical_worktree is invalid",
        )
    try:
        actual = Path(value).resolve(strict=True)
    except OSError as error:
        raise RuntimeManifestError(
            "SOURCE_IDENTITY_MISMATCH",
            "runtime manifest canonical_worktree cannot be resolved",
        ) from error
    if actual != expected:
        _fail(
            "SOURCE_IDENTITY_MISMATCH",
            "runtime manifest canonical_worktree differs from the runner",
        )
    return actual


def _endpoint(
    value: Any,
    label: str,
    *,
    loopback_only: bool = False,
    code: str = "UNSUPPORTED_ATTACHMENT",
) -> str:
    if (
        not isinstance(value, str)
        or value != value.strip()
        or any(character.isspace() for character in value)
    ):
        _fail(code, f"{label} is invalid")
    try:
        parsed = urlparse(value)
        port = parsed.port
    except ValueError:
        _fail(code, f"{label} is invalid")
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or port == 0
        or (loopback_only and parsed.hostname not in {"127.0.0.1", "localhost"})
    ):
        _fail(code, f"{label} is invalid")
    return value.rstrip("/")


def _timestamp(value: Any, label: str) -> datetime:
    return _timestamp_for_code(value, label, "INVALID_MANIFEST_SCHEMA")


def _timestamp_for_code(value: Any, label: str, code: str) -> datetime:
    if not isinstance(value, str) or not value:
        _fail(code, f"{label} is invalid")
    matched = RFC3339_TIMESTAMP.fullmatch(value)
    if matched is None:
        _fail(code, f"{label} is invalid")
    fraction = matched.group("fraction")
    normalized = matched.group("date")
    if fraction is not None:
        normalized += f".{fraction[:6].ljust(6, '0')}"
    zone = matched.group("zone")
    normalized += "+00:00" if zone == "Z" else zone
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as error:
        raise RuntimeManifestError(
            code,
            f"{label} is invalid",
        ) from error
    if parsed.tzinfo is None:
        _fail(code, f"{label} is invalid")
    return parsed


def _identifier(value: Any, label: str) -> str:
    return _identifier_for_code(value, label, "INVALID_MANIFEST_SCHEMA")


def _identifier_for_code(value: Any, label: str, code: str) -> str:
    if (
        not isinstance(value, str)
        or value != value.strip()
        or IDENTIFIER.fullmatch(value) is None
    ):
        _fail(code, f"{label} is invalid")
    return value


def _service_identifier(value: Any, label: str, code: str) -> str:
    if (
        not isinstance(value, str)
        or SERVICE_IDENTIFIER.fullmatch(value) is None
    ):
        _fail(code, f"{label} is invalid")
    return value


def _sha256(value: Any, label: str, code: str) -> str:
    if not isinstance(value, str) or SHA256.fullmatch(value) is None:
        _fail(code, f"{label} is invalid")
    return value


def _nonempty(value: Any, label: str, code: str) -> str:
    if (
        not isinstance(value, str)
        or not value
        or value != value.strip()
        or len(value) > 512
    ):
        _fail(code, f"{label} is invalid")
    return value


def _fail(code: str, message: str, *, retryable: bool = False) -> None:
    raise RuntimeManifestError(code, message, retryable=retryable)
