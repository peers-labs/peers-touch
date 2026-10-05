from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import signal
import subprocess
import sys
import uuid
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path, PurePosixPath
from types import MappingProxyType
from typing import Any, Callable, Mapping, Protocol, Sequence

from tooling.development.secure_content import work_item as work_item_control
from tooling.development.secure_content.activation_transport import (
    ActivationTransportError,
    ReviewedSchemaActivationTransport,
)
from tooling.development.secure_content.source_projection import (
    SourceProjectionError,
    resolve_runtime_source_identity,
)
from tooling.scripts.plan_lifecycle_source import (
    PlanLifecycleSourceError,
    validate_plan_lifecycle_source,
)


SCHEMA_VERSION = 1
PLAN_ID = "SECURE-CONTENT-HARD-CUT-20260913"
PLAN_PATH = (
    "docs/architecture/shared/security/secure-content/execution-plans/"
    "20260913-secure-content-hard-cut/plan.md"
)
SOURCE_WORK_ITEM_ID = "secure-content-w12d"
SOURCE_TASK_ID = "W12D"
SOURCE_EVIDENCE_ROOT = "W12A"
JOURNEY_ID = "sc-dj-canonical-schema-activation"

SOURCE_RECEIPT_KIND = "source-checkpoint-publication-receipt"
SOURCE_RESULT_KIND = "secure-content-source-freeze-result"
STATION_DEPLOYMENT_REQUEST_KIND = "secure-content-station-deployment-request"
PROFILE_RESULT_KIND = "secure-content-schema-activation-result"
AGGREGATE_RESULT_KIND = "secure-content-schema-activation-aggregate"
CANONICAL_PRIVATE_SCHEMA_ATTESTATION_FILENAME = (
    "canonical-private-schema-attestation.json"
)

INTENTS = ("SCHEMA_ACTIVATION", "FINAL_CUT")
JOURNAL_STATES = (
    "PREPARED",
    "DATABASE_SCHEMA_COMMITTED",
    "OBJECTS_DELETED",
    "STATION_DEPLOYED",
    "POST_AUDIT_PASSED",
    "COMPLETE",
)
SHA256 = re.compile(r"^[0-9a-f]{64}$")
GIT_COMMIT = re.compile(r"^[0-9a-f]{40}$")
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
RFC3339_TIMESTAMP = re.compile(
    r"^(?P<date>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})"
    r"(?:\.(?P<fraction>\d{1,9}))?"
    r"(?P<zone>Z|[+-]\d{2}:\d{2})$"
)
MAX_ARTIFACT_BYTES = 8 * 1024 * 1024
MAX_INVOCATION_LIFETIME_SECONDS = 900


@dataclass(frozen=True)
class ProfileTarget:
    profile_id: str
    deployment_environment: str
    destructive_scope: str
    activation_work_item_id: str
    activation_workstream_id: str
    final_work_item_id: str
    final_workstream_id: str
    ordinal: int


PROFILE_TARGETS = MappingProxyType(
    {
        "four": ProfileTarget(
            profile_id="four",
            deployment_environment="station-four",
            destructive_scope="station-four-social-private",
            activation_work_item_id="secure-content-w12a-four",
            activation_workstream_id="W12A-FOUR",
            final_work_item_id="secure-content-w12-four",
            final_workstream_id="W12F-FOUR",
            ordinal=1,
        ),
        "fiveArm": ProfileTarget(
            profile_id="fiveArm",
            deployment_environment="station-five-arm",
            destructive_scope="station-five-arm-social-private",
            activation_work_item_id="secure-content-w12a-five-arm",
            activation_workstream_id="W12A-FIVEARM",
            final_work_item_id="secure-content-w12-five-arm",
            final_workstream_id="W12F-FIVEARM",
            ordinal=2,
        ),
    }
)
PROFILE_ORDER = tuple(PROFILE_TARGETS)


@dataclass(frozen=True)
class DatabaseTargetSpec:
    table: str
    operation: str
    predicate: str | None = None


# This is the dependency order accepted by SC-D23. It is data supplied to the
# remote owner for validation; this module never translates it into SQL.
DATABASE_TARGET_SPECS = (
    DatabaseTargetSpec(
        "social_reactions",
        "DELETE_WHERE_POST_CLASS_PRIVATE",
        "post_class = 'private'",
    ),
    DatabaseTargetSpec(
        "social_comments",
        "DELETE_WHERE_POST_CLASS_PRIVATE",
        "post_class = 'private'",
    ),
    DatabaseTargetSpec("social_moment_deliveries", "CLEAR_TABLE"),
    DatabaseTargetSpec("social_private_object_grants", "CLEAR_TABLE"),
    DatabaseTargetSpec("social_private_objects", "CLEAR_TABLE"),
    DatabaseTargetSpec("social_private_object_parts", "CLEAR_TABLE"),
    DatabaseTargetSpec("social_private_object_uploads", "CLEAR_TABLE"),
    DatabaseTargetSpec("social_private_delivery_intents", "CLEAR_TABLE"),
    DatabaseTargetSpec("social_private_content_envelopes", "CLEAR_TABLE"),
    DatabaseTargetSpec("social_private_recipient_grants", "CLEAR_TABLE"),
    DatabaseTargetSpec("social_private_comments", "CLEAR_TABLE"),
    DatabaseTargetSpec("social_private_audience_snapshots", "CLEAR_TABLE"),
    DatabaseTargetSpec("social_private_commit_proofs", "CLEAR_TABLE"),
    DatabaseTargetSpec("social_private_command_receipts", "CLEAR_TABLE"),
    DatabaseTargetSpec("social_private_content_plan_slots", "CLEAR_TABLE"),
    DatabaseTargetSpec("social_private_content_plans", "CLEAR_TABLE"),
    DatabaseTargetSpec("social_private_audience_grants", "DROP_RETIRED_TABLE"),
    DatabaseTargetSpec("social_private_posts", "CLEAR_TABLE"),
    DatabaseTargetSpec(
        "social_private_posts",
        "REBUILD_CANONICAL_PRIVATE_POST_TABLE",
    ),
)

RETIRED_PRIVATE_POST_COLUMNS = (
    "id",
    "author_id",
    "type",
    "audience_kind",
    "audience_target_id",
    "audience_base_kind",
    "audience_key_envelopes_json",
    "text_body",
    "attachments_json",
    "mentions_json",
    "link_preview_json",
    "reactions_count_json",
    "repost_of_ref",
    "views_count",
    "edited_at",
)


class SchemaActivationError(RuntimeError):
    code = "SCHEMA_ACTIVATION_FAILED"

    def __init__(self, message: str, *, details: Mapping[str, Any] | None = None):
        super().__init__(message)
        self.details = dict(details or {})


class ValidationError(SchemaActivationError):
    code = "SCHEMA_ACTIVATION_INVALID"


class ArtifactConflict(SchemaActivationError):
    code = "SCHEMA_ACTIVATION_ARTIFACT_CONFLICT"


class BoundaryUnavailable(SchemaActivationError):
    code = "SCHEMA_ACTIVATION_BOUNDARY_UNAVAILABLE"


class ResetIncomplete(SchemaActivationError):
    code = "SCHEMA_ACTIVATION_INCOMPLETE"


class SourceCheckpointRunner(Protocol):
    def __call__(
        self,
        request: Mapping[str, Any],
        *,
        budget_seconds: int,
    ) -> Mapping[str, Any]: ...


class MaintenanceSession(Protocol):
    def prepare(self, request: Mapping[str, Any]) -> Mapping[str, Any]: ...

    def invoke(self, invocation: Mapping[str, Any]) -> Mapping[str, Any]: ...


class MaintenanceBoundary(Protocol):
    def open(
        self,
        request: Mapping[str, Any],
        *,
        budget_seconds: int,
    ) -> AbstractContextManager[MaintenanceSession]: ...


class StationDeploymentRunner(Protocol):
    def __call__(
        self,
        request: Mapping[str, Any],
        *,
        budget_seconds: int,
    ) -> None: ...

class StationQuiescenceRunner(Protocol):
    def __call__(
        self,
        request: Mapping[str, Any],
        *,
        budget_seconds: int,
    ) -> None: ...


class ProfilePreparationRunner(Protocol):
    def __call__(
        self,
        request: Mapping[str, Any],
        *,
        budget_seconds: int,
    ) -> None: ...


IdentityLoader = Callable[[], Mapping[str, Any]]
DeclarationLoader = Callable[[str], Mapping[str, Any]]
ProfileDeclarationLoader = Callable[[str, str], Mapping[str, Any]]
CleanChecker = Callable[[], None]
Clock = Callable[[], datetime]
IdFactory = Callable[[], str]
CommandRunner = Callable[..., subprocess.CompletedProcess[str]]


def canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def canonical_digest(value: Any) -> str:
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()


def _artifact_bytes(value: Mapping[str, Any]) -> bytes:
    return (
        json.dumps(value, ensure_ascii=True, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _with_digest(
    value: Mapping[str, Any],
    *,
    field: str,
) -> dict[str, Any]:
    result = dict(value)
    if field in result:
        raise ValidationError(f"{field} must not be supplied before sealing")
    result[field] = canonical_digest(result)
    return result


def _check_digest(value: Mapping[str, Any], field: str, label: str) -> str:
    digest = value.get(field)
    if not isinstance(digest, str) or SHA256.fullmatch(digest) is None:
        raise ValidationError(f"{label} {field} is invalid")
    content = dict(value)
    del content[field]
    if digest != canonical_digest(content):
        raise ValidationError(f"{label} {field} does not match its content")
    return digest


def _pairs_without_duplicates(
    pairs: list[tuple[str, Any]],
) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValidationError(f"JSON contains duplicate field {key!r}")
        result[key] = value
    return result


def _decode_json_object(raw: bytes, label: str) -> dict[str, Any]:
    if len(raw) > MAX_ARTIFACT_BYTES:
        raise ValidationError(f"{label} exceeds the artifact size limit")
    try:
        value = json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=_pairs_without_duplicates,
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValidationError(f"{label} is not canonical JSON") from error
    if not isinstance(value, dict):
        raise ValidationError(f"{label} must be a JSON object")
    return value


def _require_mapping(value: Any, field: str) -> Mapping[str, Any]:
    if not isinstance(value, dict):
        raise ValidationError(f"{field} must be an object")
    return value


def _require_exact_keys(
    value: Any,
    *,
    field: str,
    required: set[str],
    optional: set[str] = frozenset(),
) -> Mapping[str, Any]:
    mapping = _require_mapping(value, field)
    keys = set(mapping)
    missing = sorted(required - keys)
    unknown = sorted(keys - required - optional)
    if missing or unknown:
        raise ValidationError(
            f"{field} schema mismatch: missing={missing}, unknown={unknown}"
        )
    return mapping


def _require_text(
    value: Any,
    field: str,
    *,
    pattern: re.Pattern[str] | None = None,
    max_length: int = 1024,
) -> str:
    if (
        not isinstance(value, str)
        or not value
        or value != value.strip()
        or "\0" in value
        or len(value) > max_length
    ):
        raise ValidationError(f"{field} is invalid")
    if pattern is not None and pattern.fullmatch(value) is None:
        raise ValidationError(f"{field} is invalid")
    return value


def _require_integer(
    value: Any,
    field: str,
    *,
    minimum: int = 0,
) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValidationError(f"{field} is invalid")
    return value


def _require_timestamp(value: Any, field: str) -> datetime:
    text = _require_text(value, field, max_length=64)
    matched = RFC3339_TIMESTAMP.fullmatch(text)
    if matched is None:
        raise ValidationError(f"{field} is invalid")
    fraction = matched.group("fraction")
    normalized = matched.group("date")
    if fraction is not None:
        normalized += f".{fraction[:6].ljust(6, '0')}"
    zone = matched.group("zone")
    normalized += "+00:00" if zone == "Z" else zone
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as error:
        raise ValidationError(f"{field} is invalid") from error
    return parsed.astimezone(timezone.utc)


def _timestamp(value: datetime) -> str:
    if value.tzinfo is None:
        raise ValidationError("clock returned a timezone-naive value")
    return value.astimezone(timezone.utc).isoformat(
        timespec="milliseconds"
    ).replace("+00:00", "Z")


def _require_intent(value: Any) -> str:
    intent = _require_text(value, "reset_intent", pattern=IDENTIFIER)
    if intent not in INTENTS:
        raise ValidationError(f"unsupported reset intent {intent!r}")
    return intent


def _target(profile_id: str) -> ProfileTarget:
    try:
        return PROFILE_TARGETS[profile_id]
    except KeyError as error:
        raise ValidationError(f"unsupported profile {profile_id!r}") from error


def _work_item(target: ProfileTarget, intent: str) -> tuple[str, str, str]:
    if intent == "SCHEMA_ACTIVATION":
        return (
            target.activation_work_item_id,
            target.activation_workstream_id,
            SOURCE_TASK_ID,
        )
    if intent == "FINAL_CUT":
        return (
            target.final_work_item_id,
            target.final_workstream_id,
            "W12",
        )
    raise ValidationError(f"unsupported reset intent {intent!r}")


def _relative_ref(root: Path, path: Path) -> dict[str, str]:
    raw = path.read_bytes()
    return {
        "path": path.relative_to(root).as_posix(),
        "sha256": _sha256(raw),
    }


def _validate_ref(value: Any, field: str) -> Mapping[str, str]:
    reference = _require_exact_keys(
        value,
        field=field,
        required={"path", "sha256"},
    )
    path_text = _require_text(reference["path"], f"{field}.path")
    path = PurePosixPath(path_text)
    if path.is_absolute() or ".." in path.parts or path_text.startswith("./"):
        raise ValidationError(f"{field}.path is invalid")
    _require_text(reference["sha256"], f"{field}.sha256", pattern=SHA256)
    return reference  # type: ignore[return-value]


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_immutable_json(path: Path, value: Mapping[str, Any]) -> Path:
    encoded = _artifact_bytes(value)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.is_symlink():
        raise ArtifactConflict(f"immutable artifact is a symbolic link: {path}")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags, 0o600)
    except FileExistsError as error:
        raise ArtifactConflict(f"immutable artifact already exists: {path}") from error
    file_synced = False
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(encoded)
            output.flush()
            os.fsync(output.fileno())
        file_synced = True
        if os.name != "nt":
            path.chmod(0o600)
        _fsync_directory(path.parent)
        if path.read_bytes() != encoded:
            raise ArtifactConflict(f"immutable artifact readback differs: {path}")
    except Exception:
        if not file_synced:
            path.unlink(missing_ok=True)
        raise
    return path


def read_json_artifact(path: Path, label: str) -> dict[str, Any]:
    if path.is_symlink():
        raise ValidationError(f"{label} must not be a symbolic link")
    try:
        resolved = path.resolve(strict=True)
        stat = resolved.stat()
        if not resolved.is_file():
            raise ValidationError(f"{label} must be a regular file")
        if os.name != "nt" and stat.st_mode & 0o077:
            raise ValidationError(f"{label} must have mode 0600")
        return _decode_json_object(resolved.read_bytes(), label)
    except FileNotFoundError as error:
        raise ValidationError(f"{label} is missing") from error


def read_referenced_artifact(
    result_root: Path,
    reference: Any,
    label: str,
) -> tuple[Path, dict[str, Any]]:
    checked = _validate_ref(reference, label)
    unresolved = result_root / checked["path"]
    if unresolved.is_symlink():
        raise ValidationError(f"{label} must not be a symbolic link")
    candidate = unresolved.resolve()
    root = result_root.resolve()
    if candidate == root or root not in candidate.parents:
        raise ValidationError(f"{label} escapes the result root")
    raw = candidate.read_bytes()
    if os.name != "nt" and candidate.stat().st_mode & 0o077:
        raise ValidationError(f"{label} must have mode 0600")
    if _sha256(raw) != checked["sha256"]:
        raise ValidationError(f"{label} digest mismatch")
    return candidate, _decode_json_object(raw, label)


def _default_result_root(workspace_id: str) -> Path:
    return (
        Path.home()
        / ".peers-touch"
        / "dev"
        / "workspaces"
        / workspace_id
        / "development"
        / "secure-content"
    )


def _assert_external_result_root(repo_root: Path, result_root: Path) -> None:
    repository = repo_root.resolve()
    result = result_root.resolve()
    if result == repository or repository in result.parents:
        raise ValidationError("schema activation result root must be outside the repository")


def _resume_skips_quiescence(directory: Path) -> bool:
    responses = sorted(
        directory.glob("invocations/*/response.json"),
        key=lambda path: path.stat().st_mtime_ns,
    )
    if not responses:
        return False
    response = read_json_artifact(responses[-1], "reset invocation response")
    state = response.get("state")
    journal = response.get("journal")
    if (
        not isinstance(journal, Mapping)
        or journal.get("current_state") != state
    ):
        raise ValidationError("reset invocation response journal is invalid")
    return state in {
        "OBJECTS_DELETED",
        "STATION_DEPLOYED",
        "POST_AUDIT_PASSED",
        "COMPLETE",
    }


def validate_source_receipt(
    value: Any,
    *,
    identity: Mapping[str, Any],
    generation_id: str,
    declaration_digest: str,
) -> Mapping[str, Any]:
    receipt = _require_exact_keys(
        value,
        field="source checkpoint receipt",
        required={
            "kind",
            "state",
            "purpose",
            "checkpoint_id",
            "plan_id",
            "task_id",
            "workspace_id",
            "source_commit",
            "source_tree",
            "session_event_digest",
            "declaration_digest",
            "completed_at",
            "receipt_digest",
        },
    )
    expected = {
        "kind": SOURCE_RECEIPT_KIND,
        "state": "COMPLETE",
        "purpose": "SOURCE_OWNER_CHECKPOINT",
        "plan_id": PLAN_ID,
        "task_id": SOURCE_TASK_ID,
        "workspace_id": identity["workspaceId"],
        "source_commit": generation_id,
        "declaration_digest": declaration_digest,
    }
    for field, expected_value in expected.items():
        if receipt.get(field) != expected_value:
            raise ValidationError(f"source checkpoint receipt has invalid {field}")
    _require_text(receipt["checkpoint_id"], "checkpoint_id", pattern=IDENTIFIER)
    _require_text(receipt["source_tree"], "source_tree", pattern=GIT_COMMIT)
    _require_text(
        receipt["session_event_digest"],
        "session_event_digest",
        pattern=SHA256,
    )
    _require_timestamp(receipt["completed_at"], "completed_at")
    _check_digest(receipt, "receipt_digest", "source checkpoint receipt")
    return receipt


def validate_source_result(
    value: Any,
    *,
    generation_id: str | None = None,
) -> Mapping[str, Any]:
    result = _require_exact_keys(
        value,
        field="source freeze result",
        required={
            "schema_version",
            "kind",
            "workstream_id",
            "generation_id",
            "source_commit",
            "workspace_id",
            "checkpoint_receipt_ref",
            "checkpoint_receipt_digest",
            "status",
            "completed_at",
            "result_digest",
        },
    )
    if (
        result.get("schema_version") != SCHEMA_VERSION
        or result.get("kind") != SOURCE_RESULT_KIND
        or result.get("workstream_id") != SOURCE_TASK_ID
        or result.get("status") != "PASS"
    ):
        raise ValidationError("source freeze result identity is invalid")
    source_commit = _require_text(
        result["source_commit"], "source_commit", pattern=GIT_COMMIT
    )
    if result.get("generation_id") != source_commit:
        raise ValidationError("source freeze generation is not the source commit")
    if generation_id is not None and source_commit != generation_id:
        raise ValidationError("source freeze result is stale")
    _require_text(result["workspace_id"], "workspace_id", pattern=IDENTIFIER)
    _validate_ref(result["checkpoint_receipt_ref"], "checkpoint_receipt_ref")
    _require_text(
        result["checkpoint_receipt_digest"],
        "checkpoint_receipt_digest",
        pattern=SHA256,
    )
    _require_timestamp(result["completed_at"], "completed_at")
    _check_digest(result, "result_digest", "source freeze result")
    return result


def validate_reset_manifest(
    value: Any,
    *,
    target: ProfileTarget,
    intent: str,
    generation_id: str,
    workspace_id: str,
    reset_id: str,
) -> Mapping[str, Any]:
    manifest = _require_exact_keys(
        value,
        field="reset manifest",
        required={
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
        },
        optional={"recovery_predecessor"},
    )
    expected = {
        "schema_version": SCHEMA_VERSION,
        "reset_id": reset_id,
        "reset_intent": intent,
        "source_commit": generation_id,
        "workspace_id": workspace_id,
        "profile_id": target.profile_id,
        "deployment_environment": target.deployment_environment,
        "destructive_scope": target.destructive_scope,
    }
    for field, expected_value in expected.items():
        if manifest.get(field) != expected_value:
            raise ValidationError(f"reset manifest has invalid {field}")
    _require_text(
        manifest["database_identity_digest"],
        "database_identity_digest",
        pattern=SHA256,
    )
    _validate_public_snapshot(
        manifest["public_snapshot_before"],
        profile_id=target.profile_id,
    )
    _validate_database_targets(manifest["database_targets"])
    _validate_object_targets(
        manifest["canonical_private_object_targets"],
        field="canonical_private_object_targets",
        owner_domain="social",
    )
    _validate_object_targets(
        manifest["legacy_oss_object_targets"],
        field="legacy_oss_object_targets",
        owner_domain="oss",
    )
    out_of_scope = manifest["out_of_scope_table_names"]
    if not isinstance(out_of_scope, list):
        raise ValidationError("out_of_scope_table_names must be a list")
    names = [
        _require_text(item, "out_of_scope_table_names[]", pattern=IDENTIFIER)
        for item in out_of_scope
    ]
    if names != sorted(set(names)):
        raise ValidationError("out_of_scope_table_names must be sorted and unique")
    mutable_tables = {spec.table for spec in DATABASE_TARGET_SPECS}
    if mutable_tables.intersection(names):
        raise ValidationError("out_of_scope_table_names overlaps the reset allowlist")
    if "recovery_predecessor" in manifest:
        recovery = manifest["recovery_predecessor"]
        predecessor = _require_exact_keys(
            recovery,
            field="recovery_predecessor",
            required={
                "reset_id",
                "reset_manifest_digest",
                "journal_digest",
                "state",
                "failure_code",
            },
        )
        state_and_failure = (
            predecessor.get("state"),
            predecessor.get("failure_code"),
        )
        if state_and_failure not in {
            ("OBJECTS_DELETED", "RESET_SOURCE_SUPERSEDED"),
            ("STATION_DEPLOYED", "RESET_SCHEMA_TARGET_UNREVIEWED"),
            ("STATION_DEPLOYED", "RESET_SOURCE_SUPERSEDED"),
        } or predecessor.get("reset_id") == reset_id:
            raise ValidationError("recovery_predecessor identity is invalid")
        _require_text(
            predecessor["reset_id"],
            "recovery_predecessor.reset_id",
            pattern=IDENTIFIER,
        )
        _require_text(
            predecessor["reset_manifest_digest"],
            "recovery_predecessor.reset_manifest_digest",
            pattern=SHA256,
        )
        _require_text(
            predecessor["journal_digest"],
            "recovery_predecessor.journal_digest",
            pattern=SHA256,
        )
    _require_timestamp(manifest["created_at"], "manifest.created_at")
    _check_digest(manifest, "manifest_digest", "reset manifest")
    return manifest


def _validate_public_snapshot(value: Any, *, profile_id: str) -> None:
    snapshot = _require_exact_keys(
        value,
        field="public_snapshot_before",
        required={
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
        },
    )
    if (
        snapshot.get("schema_version") != SCHEMA_VERSION
        or snapshot.get("profile_id") != profile_id
    ):
        raise ValidationError("public snapshot identity is invalid")
    for field in (
        "public_post_schema_digest",
        "public_post_rows_digest",
        "public_comment_rows_digest",
        "public_reaction_rows_digest",
        "public_object_metadata_digest",
        "public_object_bytes_digest",
    ):
        _require_text(snapshot[field], field, pattern=SHA256)
    counts = _require_mapping(snapshot["counts"], "public snapshot counts")
    if not counts:
        raise ValidationError("public snapshot counts must not be empty")
    for name, count in counts.items():
        _require_text(name, "public snapshot count name", pattern=IDENTIFIER)
        _require_integer(count, f"public snapshot count {name}")
    _check_digest(snapshot, "snapshot_digest", "public snapshot")


def _validate_database_targets(value: Any) -> None:
    if not isinstance(value, list):
        raise ValidationError("database_targets must be a list")
    if len(value) != len(DATABASE_TARGET_SPECS):
        raise ValidationError("database_targets does not match the SC-D23 allowlist")
    for index, (item, spec) in enumerate(zip(value, DATABASE_TARGET_SPECS)):
        required = {
            "table",
            "operation",
            "expected_schema_before_digest",
            "expected_row_count",
        }
        if spec.predicate is not None:
            required.add("predicate")
        target = _require_exact_keys(
            item,
            field=f"database_targets[{index}]",
            required=required,
        )
        if target.get("table") != spec.table or target.get("operation") != spec.operation:
            raise ValidationError(
                f"database_targets[{index}] violates SC-D23 dependency order"
            )
        if spec.predicate is not None and target.get("predicate") != spec.predicate:
            raise ValidationError(f"database_targets[{index}] has invalid predicate")
        _require_text(
            target["expected_schema_before_digest"],
            f"database_targets[{index}].expected_schema_before_digest",
            pattern=SHA256,
        )
        _require_integer(
            target["expected_row_count"],
            f"database_targets[{index}].expected_row_count",
        )


def _validate_object_targets(
    value: Any,
    *,
    field: str,
    owner_domain: str,
) -> None:
    if not isinstance(value, list):
        raise ValidationError(f"{field} must be a list")
    identities: list[tuple[str, str, str]] = []
    for index, item in enumerate(value):
        target = _require_exact_keys(
            item,
            field=f"{field}[{index}]",
            required={
                "owner_domain",
                "owner_identity_digest",
                "backend",
                "storage_key_digest",
                "metadata_digest",
                "blob_digest",
                "source_row_digest",
                "reference_classification",
            },
        )
        if target.get("owner_domain") != owner_domain:
            raise ValidationError(f"{field}[{index}] has invalid owner_domain")
        backend = _require_text(
            target["backend"], f"{field}[{index}].backend", pattern=IDENTIFIER
        )
        classification = _require_text(
            target["reference_classification"],
            f"{field}[{index}].reference_classification",
            pattern=IDENTIFIER,
        )
        if classification not in {"PRIVATE_EXCLUSIVE", "SHARED_CAS_SAFE"}:
            raise ValidationError(
                f"{field}[{index}] has unreviewed reference classification"
            )
        for digest_field in (
            "owner_identity_digest",
            "storage_key_digest",
            "metadata_digest",
            "blob_digest",
            "source_row_digest",
        ):
            _require_text(
                target[digest_field],
                f"{field}[{index}].{digest_field}",
                pattern=SHA256,
            )
        identities.append(
            (backend, target["owner_identity_digest"], target["storage_key_digest"])
        )
    if len(identities) != len(set(identities)):
        raise ValidationError(f"{field} contains duplicate object targets")


def validate_reset_invocation(
    value: Any,
    *,
    manifest: Mapping[str, Any],
    declaration: Mapping[str, Any],
    target: ProfileTarget,
    task_id: str,
    now: datetime | None = None,
) -> Mapping[str, Any]:
    invocation = _require_exact_keys(
        value,
        field="reset invocation",
        required={
            "schema_version",
            "invocation_id",
            "reset_id",
            "reset_intent",
            "reset_manifest_digest",
            "plan_id",
            "task_id",
            "declaration_digest",
            "source_commit",
            "workspace_id",
            "profile_id",
            "deployment_environment",
            "destructive_scope",
            "issued_at",
            "expires_at",
            "invocation_digest",
        },
    )
    expected = {
        "schema_version": SCHEMA_VERSION,
        "reset_id": manifest["reset_id"],
        "reset_intent": manifest["reset_intent"],
        "reset_manifest_digest": manifest["manifest_digest"],
        "plan_id": PLAN_ID,
        "task_id": task_id,
        "declaration_digest": declaration["declarationDigest"],
        "source_commit": manifest["source_commit"],
        "workspace_id": manifest["workspace_id"],
        "profile_id": target.profile_id,
        "deployment_environment": target.deployment_environment,
        "destructive_scope": target.destructive_scope,
    }
    for field, expected_value in expected.items():
        if invocation.get(field) != expected_value:
            raise ValidationError(f"reset invocation has invalid {field}")
    _require_text(
        invocation["invocation_id"], "invocation_id", pattern=IDENTIFIER
    )
    issued = _require_timestamp(invocation["issued_at"], "issued_at")
    expires = _require_timestamp(invocation["expires_at"], "expires_at")
    lifetime = (expires - issued).total_seconds()
    if lifetime <= 0 or lifetime > MAX_INVOCATION_LIFETIME_SECONDS:
        raise ValidationError("reset invocation expiry is not bounded")
    if now is not None and now.astimezone(timezone.utc) >= expires:
        raise ValidationError("reset invocation has expired")
    _check_digest(invocation, "invocation_digest", "reset invocation")
    return invocation


def validate_completed_journal(
    value: Any,
    *,
    manifest_digest: str,
    invocation_id: str,
    invocation_digest: str,
) -> Mapping[str, Any]:
    return _validate_journal_state(
        value,
        manifest_digest=manifest_digest,
        expected_state="COMPLETE",
        required_invocations=((invocation_id, invocation_digest),),
        require_exact_invocations=False,
    )


def _validate_journal_state(
    value: Any,
    *,
    manifest_digest: str,
    expected_state: str,
    required_invocations: Sequence[tuple[str, str]],
    require_exact_invocations: bool,
) -> Mapping[str, Any]:
    try:
        state_index = JOURNAL_STATES.index(expected_state)
    except ValueError as error:
        raise ValidationError(
            f"unsupported expected journal state {expected_state!r}"
        ) from error
    journal = _require_exact_keys(
        value,
        field="reset journal",
        required={
            "schema_version",
            "reset_manifest_digest",
            "current_state",
            "accepted_invocations",
            "transitions",
            "failure",
        },
    )
    if (
        journal.get("schema_version") != SCHEMA_VERSION
        or journal.get("reset_manifest_digest") != manifest_digest
        or journal.get("current_state") != expected_state
        or journal.get("failure") is not None
    ):
        raise ResetIncomplete(
            f"maintenance journal did not reach {expected_state}"
        )
    accepted = journal["accepted_invocations"]
    if not isinstance(accepted, list) or not accepted:
        raise ValidationError("reset journal has no accepted invocations")
    accepted_ids: set[str] = set()
    accepted_pairs: list[tuple[str, str]] = []
    for index, item in enumerate(accepted):
        record = _require_exact_keys(
            item,
            field=f"accepted_invocations[{index}]",
            required={"invocation_id", "invocation_digest", "accepted_at"},
        )
        identifier = _require_text(
            record["invocation_id"],
            f"accepted_invocations[{index}].invocation_id",
            pattern=IDENTIFIER,
        )
        digest = _require_text(
            record["invocation_digest"],
            f"accepted_invocations[{index}].invocation_digest",
            pattern=SHA256,
        )
        _require_timestamp(
            record["accepted_at"], f"accepted_invocations[{index}].accepted_at"
        )
        if identifier in accepted_ids:
            raise ValidationError("reset journal repeats an invocation ID")
        accepted_ids.add(identifier)
        accepted_pairs.append((identifier, digest))
    required_pairs = list(required_invocations)
    if require_exact_invocations:
        if accepted_pairs != required_pairs:
            raise ValidationError(
                "reset journal invocation sequence does not match this owner run"
            )
    else:
        for required_pair in required_pairs:
            if required_pair not in accepted_pairs:
                raise ValidationError(
                    "completed journal did not accept this invocation"
                )
    transitions = journal["transitions"]
    if not isinstance(transitions, list) or len(transitions) != state_index:
        raise ValidationError("reset journal has an invalid transition count")
    previous_at: datetime | None = None
    for index, transition_value in enumerate(transitions):
        transition = _require_exact_keys(
            transition_value,
            field=f"transitions[{index}]",
            required={"from_state", "to_state", "transitioned_at", "transition_digest"},
        )
        if (
            transition.get("from_state") != JOURNAL_STATES[index]
            or transition.get("to_state") != JOURNAL_STATES[index + 1]
        ):
            raise ValidationError("reset journal transitions are not monotonic")
        transitioned_at = _require_timestamp(
            transition["transitioned_at"],
            f"transitions[{index}].transitioned_at",
        )
        if previous_at is not None and transitioned_at < previous_at:
            raise ValidationError("reset journal transition times move backwards")
        previous_at = transitioned_at
        _check_digest(transition, "transition_digest", f"transitions[{index}]")
    return journal


def validate_schema_attestation(
    value: Any,
    *,
    manifest: Mapping[str, Any],
    journal_digest: str,
) -> Mapping[str, Any]:
    attestation = _require_exact_keys(
        value,
        field="canonical schema attestation",
        required={
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
        },
    )
    expected = {
        "schema_version": SCHEMA_VERSION,
        "source_commit": manifest["source_commit"],
        "workspace_id": manifest["workspace_id"],
        "profile_id": manifest["profile_id"],
        "deployment_environment": manifest["deployment_environment"],
        "destructive_scope": manifest["destructive_scope"],
        "reset_intent": manifest["reset_intent"],
        "reset_manifest_digest": manifest["manifest_digest"],
        "completed_journal_digest": journal_digest,
        "public_snapshot_digest": manifest["public_snapshot_before"][
            "snapshot_digest"
        ],
        "retired_columns_absent": True,
    }
    for field, expected_value in expected.items():
        if attestation.get(field) != expected_value:
            raise ValidationError(f"canonical schema attestation has invalid {field}")
    for field in (
        "station_service_id",
        "station_peer_id",
        "station_runtime_identity",
    ):
        _require_text(attestation[field], field, max_length=256)
    for field in (
        "service_attestation_digest",
        "canonical_private_schema_digest",
    ):
        _require_text(attestation[field], field, pattern=SHA256)
    _require_timestamp(attestation["created_at"], "attestation.created_at")
    _check_digest(attestation, "attestation_digest", "schema attestation")
    return attestation


def _validate_prepared_manifest(
    value: Any,
    *,
    target: ProfileTarget,
    intent: str,
    generation_id: str,
    workspace_id: str,
    reset_id: str,
) -> Mapping[str, Any]:
    validate_reset_manifest(
        value,
        target=target,
        intent=intent,
        generation_id=generation_id,
        workspace_id=workspace_id,
        reset_id=reset_id,
    )
    return value


def _validate_execution_result(
    value: Any,
    *,
    manifest: Mapping[str, Any],
    expected_state: str,
    invocations: Sequence[Mapping[str, Any]],
    needs_deployment: bool,
    require_attestation: bool,
    expected_exact_replay: bool,
    require_exact_invocations: bool = True,
) -> tuple[Mapping[str, Any], Mapping[str, Any]]:
    required = {
        "schema_version",
        "reset_id",
        "state",
        "exact_replay",
        "needs_deployment",
        "journal",
        "journal_digest",
    }
    response = _require_exact_keys(
        value,
        field="maintenance execution result",
        required=required,
        optional={"attestation"},
    )
    expected = {
        "schema_version": SCHEMA_VERSION,
        "reset_id": manifest["reset_id"],
        "state": expected_state,
        "exact_replay": expected_exact_replay,
        "needs_deployment": needs_deployment,
    }
    for field, expected_value in expected.items():
        if response.get(field) != expected_value:
            raise ResetIncomplete(
                f"maintenance execution result has invalid {field}"
            )
    invocation_pairs = tuple(
        (invocation["invocation_id"], invocation["invocation_digest"])
        for invocation in invocations
    )
    journal = _validate_journal_state(
        response["journal"],
        manifest_digest=manifest["manifest_digest"],
        expected_state=expected_state,
        required_invocations=invocation_pairs,
        require_exact_invocations=require_exact_invocations,
    )
    journal_digest = _require_text(
        response["journal_digest"],
        "maintenance execution journal_digest",
        pattern=SHA256,
    )
    if journal_digest != canonical_digest(journal):
        raise ValidationError(
            "maintenance execution journal_digest does not match its journal"
        )
    if not require_attestation:
        if "attestation" in response:
            raise ValidationError(
                "non-complete maintenance result includes an attestation"
            )
        return journal, {}
    if "attestation" not in response:
        raise ValidationError(
            "complete maintenance result omits its attestation"
        )
    attestation = validate_schema_attestation(
        response["attestation"],
        manifest=manifest,
        journal_digest=journal_digest,
    )
    return journal, attestation


def _validate_identity(value: Any, repo_root: Path) -> Mapping[str, Any]:
    identity = _require_mapping(value, "worktree identity")
    for field in ("root", "workspaceId", "branch", "head"):
        _require_text(identity.get(field), f"worktree identity {field}")
    if Path(identity["root"]).resolve() != repo_root.resolve():
        raise ValidationError("worktree identity root differs from the repository")
    _require_text(identity["workspaceId"], "workspaceId", pattern=IDENTIFIER)
    _require_text(identity["head"], "head", pattern=GIT_COMMIT)
    return identity


def _declaration_source_commit(declaration: Mapping[str, Any]) -> str | None:
    source_identity = declaration.get("sourceIdentity")
    if isinstance(source_identity, dict):
        for field in ("runtimeSourceCommit", "controlHead"):
            value = source_identity.get(field)
            if isinstance(value, str) and GIT_COMMIT.fullmatch(value):
                return value
    source_head = declaration.get("sourceHead")
    if isinstance(source_head, str) and GIT_COMMIT.fullmatch(source_head):
        return source_head
    return None


def _validate_declaration(
    value: Any,
    *,
    identity: Mapping[str, Any],
    work_item_id: str,
    task_id: str,
    generation_id: str,
    target: ProfileTarget | None,
) -> Mapping[str, Any]:
    declaration = _require_mapping(value, "Development declaration")
    expected = {
        "declarationId": f"{work_item_id}-{identity['workspaceId']}",
        "workItemId": work_item_id,
        "planId": PLAN_ID,
        "planPath": PLAN_PATH,
        "taskId": task_id,
        "journeyId": JOURNEY_ID,
        "workspaceId": identity["workspaceId"],
        "branch": identity["branch"],
        "state": "ACTIVE",
    }
    for field, expected_value in expected.items():
        if declaration.get(field) != expected_value:
            raise ValidationError(f"Development declaration has invalid {field}")
    digest = _require_text(
        declaration.get("declarationDigest"),
        "declarationDigest",
        pattern=SHA256,
    )
    if not digest:
        raise ValidationError("Development declaration digest is missing")
    source_commit = _declaration_source_commit(declaration)
    if source_commit != identity.get("controlHead", generation_id):
        raise ValidationError("Development declaration source is stale")
    if target is None:
        runtime_claims = declaration.get("runtimeClaims", [])
        if runtime_claims:
            raise ValidationError("source-freeze declaration must not own runtime claims")
        return declaration
    claims = declaration.get("runtimeClaims")
    if not isinstance(claims, list):
        raise ValidationError("profile declaration runtimeClaims is invalid")
    relevant: dict[str, list[str]] = {
        "profile": [],
        "station.deploy": [],
        "station.reset": [],
    }
    for claim in claims:
        if not isinstance(claim, dict):
            raise ValidationError("profile declaration contains an invalid runtime claim")
        kind = claim.get("kind")
        resource_id = claim.get("resourceId")
        mode = claim.get("mode")
        if kind in relevant:
            if not isinstance(resource_id, str):
                raise ValidationError("profile declaration runtime resource is invalid")
            relevant[kind].append(resource_id)
            if kind in {"station.deploy", "station.reset"} and mode != "exclusive":
                raise ValidationError(f"profile declaration {kind} must be exclusive")
    expected_claims = {
        "profile": [target.profile_id],
        "station.deploy": [target.deployment_environment],
        "station.reset": [target.destructive_scope],
    }
    if relevant != expected_claims:
        raise ValidationError(
            "profile declaration must own exactly one approved profile, "
            "deployment environment, and reset scope"
        )
    return declaration


class DevelopmentSessionSourceCheckpointRunner:
    def __init__(
        self,
        *,
        repo_root: Path,
        command_runner: CommandRunner = subprocess.run,
    ) -> None:
        self.repo_root = repo_root
        self.command_runner = command_runner

    def __call__(
        self,
        request: Mapping[str, Any],
        *,
        budget_seconds: int,
    ) -> Mapping[str, Any]:
        completed = self.command_runner(
            [
                "make",
                "dev-session-status",
                f"WORK_ITEM={request['work_item_id']}",
            ],
            cwd=self.repo_root,
            capture_output=True,
            text=True,
            timeout=budget_seconds,
            check=False,
        )
        payload = _decode_process_json(
            completed,
            "Development Session checkpoint",
        )
        session = payload.get("session") if isinstance(payload, Mapping) else None
        state = session.get("state") if isinstance(session, Mapping) else None
        source = state.get("source") if isinstance(state, Mapping) else None
        if (
            not isinstance(session, Mapping)
            or not isinstance(state, Mapping)
            or not isinstance(source, Mapping)
            or state.get("state") != "CHECKPOINTED"
            or state.get("workItemId") != request["work_item_id"]
            or state.get("planId") != request["plan_id"]
            or state.get("taskId") != request["task_id"]
            or state.get("workspaceId") != request["workspace_id"]
            or state.get("branch") != request["branch"]
            or source.get("commit") != request["source_commit"]
            or source.get("branch") != request["branch"]
            or source.get("clean") is not True
            or source.get("purpose") != "development-runtime"
        ):
            raise ValidationError(
                "Development Session does not own the exact source checkpoint"
            )
        source_tree = _require_text(
            source.get("tree"),
            "Development Session source tree",
            pattern=GIT_COMMIT,
        )
        event_digest = _require_text(
            session.get("eventDigest"),
            "Development Session event digest",
            pattern=SHA256,
        )
        completed_at = _require_timestamp(
            source.get("createdAt"),
            "Development Session source createdAt",
        )
        receipt = {
            "kind": SOURCE_RECEIPT_KIND,
            "state": "COMPLETE",
            "purpose": request["purpose"],
            "checkpoint_id": state["sessionId"],
            "plan_id": request["plan_id"],
            "task_id": request["task_id"],
            "workspace_id": request["workspace_id"],
            "source_commit": request["source_commit"],
            "source_tree": source_tree,
            "session_event_digest": event_digest,
            "declaration_digest": request["declaration_digest"],
            "completed_at": completed_at.isoformat(
                timespec="milliseconds"
            ).replace("+00:00", "Z"),
        }
        return _with_digest(receipt, field="receipt_digest")


class ExternalStationDeploymentRunner:
    ENVIRONMENT_KEY = "PT_SECURE_CONTENT_STATION_DEPLOY_COMMAND_JSON"

    def __init__(
        self,
        *,
        repo_root: Path,
        environment: Mapping[str, str] | None = None,
        command_runner: CommandRunner = subprocess.run,
    ) -> None:
        self.repo_root = repo_root
        self.environment = dict(os.environ if environment is None else environment)
        self.command_runner = command_runner

    def __call__(
        self,
        request: Mapping[str, Any],
        *,
        budget_seconds: int,
    ) -> None:
        command = _command_from_environment(
            self.environment,
            self.ENVIRONMENT_KEY,
            require_ssh=False,
        )
        completed = self.command_runner(
            command,
            cwd=self.repo_root,
            input=_artifact_bytes(request).decode("utf-8"),
            capture_output=True,
            text=True,
            timeout=budget_seconds,
            check=False,
        )
        if completed.returncode != 0:
            diagnostic = (completed.stderr or completed.stdout)[-2000:].strip()
            raise BoundaryUnavailable(
                "reviewed Station deployment failed with exit code "
                f"{completed.returncode}: {diagnostic}"
            )

class ExternalStationQuiescenceRunner:
    ENVIRONMENT_KEY = "PT_SECURE_CONTENT_STATION_REQUIESCE_COMMAND_JSON"

    def __init__(
        self,
        *,
        repo_root: Path,
        environment: Mapping[str, str] | None = None,
        command_runner: CommandRunner = subprocess.run,
    ) -> None:
        self.repo_root = repo_root
        self.environment = dict(os.environ if environment is None else environment)
        self.command_runner = command_runner

    def __call__(
        self,
        request: Mapping[str, Any],
        *,
        budget_seconds: int,
    ) -> None:
        command = _command_from_environment(
            self.environment,
            self.ENVIRONMENT_KEY,
            require_ssh=False,
        )
        completed = self.command_runner(
            command,
            cwd=self.repo_root,
            input=_artifact_bytes(request).decode("utf-8"),
            capture_output=True,
            text=True,
            timeout=budget_seconds,
            check=False,
        )
        if completed.returncode != 0:
            diagnostic = (completed.stderr or completed.stdout)[-2000:].strip()
            raise BoundaryUnavailable(
                "Station re-quiescence failed with exit code "
                f"{completed.returncode}: {diagnostic}"
            )


class _LeaseWrappedSSHSession(AbstractContextManager["_LeaseWrappedSSHSession"]):
    EXIT_WAIT_SECONDS = 10
    TERMINATION_WAIT_SECONDS = 5

    def __init__(self, command: list[str], repo_root: Path) -> None:
        self.command = command
        self.repo_root = repo_root
        self.process: subprocess.Popen[str] | None = None
        self.previous_signal_handlers: dict[int, Any] = {}
        self.termination_requested = False
        self.closing = False

    def __enter__(self) -> "_LeaseWrappedSSHSession":
        self.process = subprocess.Popen(
            self.command,
            cwd=self.repo_root,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=True,
        )
        for signal_value in (
            signal.SIGINT,
            signal.SIGTERM,
            signal.SIGHUP,
        ):
            self.previous_signal_handlers[signal_value] = signal.getsignal(
                signal_value
            )
            signal.signal(signal_value, self._handle_signal)
        return self

    def _handle_signal(self, signal_number: int, _frame: Any) -> None:
        self.termination_requested = True
        self._terminate_process_group(signal.SIGTERM)
        if self.closing:
            return
        raise SystemExit(128 + signal_number)

    def _terminate_process_group(self, signal_number: int) -> None:
        if self.process is None:
            return
        try:
            os.killpg(self.process.pid, signal_number)
        except ProcessLookupError:
            return
        except PermissionError:
            if self.process.poll() is None:
                self.process.terminate()

    def prepare(self, request: Mapping[str, Any]) -> Mapping[str, Any]:
        return self._exchange("schema_audit", request)

    def invoke(self, invocation: Mapping[str, Any]) -> Mapping[str, Any]:
        return self._exchange("reset", invocation)

    def _exchange(
        self,
        operation: str,
        payload: Mapping[str, Any],
    ) -> Mapping[str, Any]:
        if (
            self.process is None
            or self.process.stdin is None
            or self.process.stdout is None
        ):
            raise BoundaryUnavailable("maintenance boundary is not open")
        try:
            envelope = {
                "operation": operation,
                "payload": dict(payload),
            }
            self.process.stdin.write(
                canonical_json_bytes(envelope).decode("utf-8") + "\n"
            )
            self.process.stdin.flush()
            line = self.process.stdout.readline()
        except (BrokenPipeError, OSError) as error:
            raise BoundaryUnavailable("maintenance SSH control channel closed") from error
        if not line:
            diagnostic = ""
            if self.process.stderr is not None:
                diagnostic = self.process.stderr.read()[-2000:]
            raise BoundaryUnavailable(
                f"maintenance SSH boundary returned no response: {diagnostic}"
            )
        return _decode_json_object(line.encode("utf-8"), "maintenance boundary response")

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> bool:
        if self.process is None:
            return False
        self.closing = True
        try:
            if exc_type is not None and not self.termination_requested:
                self._terminate_process_group(signal.SIGTERM)
            if self.process.stdin is not None:
                try:
                    self.process.stdin.close()
                except (BrokenPipeError, OSError):
                    pass
            try:
                return_code = self.process.wait(timeout=self.EXIT_WAIT_SECONDS)
            except subprocess.TimeoutExpired:
                self._terminate_process_group(signal.SIGTERM)
                try:
                    return_code = self.process.wait(
                        timeout=self.TERMINATION_WAIT_SECONDS
                    )
                except subprocess.TimeoutExpired:
                    self._terminate_process_group(signal.SIGKILL)
                    return_code = self.process.wait()
            if exc_type is None and return_code != 0:
                diagnostic = ""
                if self.process.stderr is not None:
                    diagnostic = self.process.stderr.read()[-2000:]
                raise BoundaryUnavailable(
                    "maintenance SSH boundary exited with "
                    f"{return_code}: {diagnostic}"
                )
            return False
        finally:
            for pipe in (self.process.stdout, self.process.stderr):
                if pipe is not None:
                    pipe.close()
            for signal_value, previous in self.previous_signal_handlers.items():
                signal.signal(signal_value, previous)


class LeaseWrappedSSHMaintenanceBoundary:
    ENVIRONMENT_KEY = "PT_SECURE_CONTENT_MAINTENANCE_SSH_COMMAND_JSON"

    def __init__(
        self,
        *,
        repo_root: Path,
        environment: Mapping[str, str] | None = None,
        command_resolver: (
            Callable[[Mapping[str, Any], int], Sequence[str]] | None
        ) = None,
    ) -> None:
        self.repo_root = repo_root
        self.environment = dict(os.environ if environment is None else environment)
        self.command_resolver = command_resolver

    def command_for(
        self,
        request: Mapping[str, Any],
        *,
        budget_seconds: int,
    ) -> list[str]:
        if self.environment.get(self.ENVIRONMENT_KEY, "").strip():
            ssh_command = _command_from_environment(
                self.environment,
                self.ENVIRONMENT_KEY,
                require_ssh=True,
            )
        elif self.command_resolver is not None:
            ssh_command = list(self.command_resolver(request, budget_seconds))
            if not ssh_command or Path(ssh_command[0]).name != "ssh":
                raise BoundaryUnavailable(
                    "reviewed maintenance command must use SSH transport"
                )
        else:
            raise BoundaryUnavailable(f"{self.ENVIRONMENT_KEY} is required")
        scope = _require_text(
            request.get("destructive_scope"),
            "destructive_scope",
            pattern=IDENTIFIER,
        )
        return [
            "node",
            "tooling/scripts/local-dev/machine-dev.mjs",
            "lease",
            "--workspace-root",
            str(self.repo_root),
            "--resource-kind",
            "station.reset",
            "--resource-id",
            scope,
            "--budget-seconds",
            str(budget_seconds),
            "--reset-scope",
            scope,
            "--",
            *ssh_command,
        ]

    def open(
        self,
        request: Mapping[str, Any],
        *,
        budget_seconds: int,
    ) -> AbstractContextManager[MaintenanceSession]:
        return _LeaseWrappedSSHSession(
            self.command_for(request, budget_seconds=budget_seconds),
            self.repo_root,
        )


def _command_from_environment(
    environment: Mapping[str, str],
    key: str,
    *,
    require_ssh: bool,
) -> list[str]:
    raw = environment.get(key, "").strip()
    if not raw:
        raise BoundaryUnavailable(f"{key} is required")
    try:
        command = json.loads(raw)
    except json.JSONDecodeError as error:
        raise BoundaryUnavailable(f"{key} is not valid JSON") from error
    if (
        not isinstance(command, list)
        or not command
        or any(not isinstance(part, str) or not part for part in command)
    ):
        raise BoundaryUnavailable(f"{key} must be a non-empty JSON string array")
    if require_ssh and Path(command[0]).name != "ssh":
        raise BoundaryUnavailable(
            f"{key} must name the reviewed SSH transport as its executable"
        )
    return command


def _decode_process_json(
    process: subprocess.CompletedProcess[str],
    label: str,
) -> Mapping[str, Any]:
    if process.returncode != 0:
        diagnostic = (process.stderr or process.stdout)[-2000:].strip()
        raise BoundaryUnavailable(
            f"{label} failed with exit code {process.returncode}: {diagnostic}"
        )
    return _decode_json_object(process.stdout.encode("utf-8"), label)


class SchemaActivationOwner:
    def __init__(
        self,
        *,
        repo_root: Path,
        result_root: Path | None = None,
        identity_loader: IdentityLoader | None = None,
        declaration_loader: DeclarationLoader | None = None,
        profile_declaration_loader: ProfileDeclarationLoader | None = None,
        clean_checker: CleanChecker | None = None,
        source_checkpoint_runner: SourceCheckpointRunner | None = None,
        maintenance_boundary: MaintenanceBoundary | None = None,
        profile_preparation_runner: ProfilePreparationRunner | None = None,
        station_deployment_runner: StationDeploymentRunner | None = None,
        station_quiescence_runner: StationQuiescenceRunner | None = None,
        clock: Clock | None = None,
        id_factory: IdFactory | None = None,
        command_runner: CommandRunner = subprocess.run,
    ) -> None:
        self.repo_root = repo_root.resolve()
        self.command_runner = command_runner
        self.identity_loader = identity_loader or self._load_identity
        self.declaration_loader = declaration_loader or self._load_declaration
        if profile_declaration_loader is not None:
            self.profile_declaration_loader = profile_declaration_loader
        elif declaration_loader is not None:
            self.profile_declaration_loader = (
                lambda work_item_id, _: self.declaration_loader(work_item_id)
            )
        else:
            self.profile_declaration_loader = self._activate_profile_declaration
        self.clean_checker = clean_checker or self._check_clean
        self.source_checkpoint_runner = source_checkpoint_runner or (
            DevelopmentSessionSourceCheckpointRunner(
                repo_root=self.repo_root,
                command_runner=command_runner,
            )
        )
        self.maintenance_boundary = maintenance_boundary or (
            LeaseWrappedSSHMaintenanceBoundary(repo_root=self.repo_root)
        )
        self.profile_preparation_runner = profile_preparation_runner
        self.station_deployment_runner = station_deployment_runner or (
            ExternalStationDeploymentRunner(
                repo_root=self.repo_root,
                command_runner=command_runner,
            )
        )
        self.station_quiescence_runner = station_quiescence_runner or (
            ExternalStationQuiescenceRunner(
                repo_root=self.repo_root,
                command_runner=command_runner,
            )
        )
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.id_factory = id_factory or (lambda: uuid.uuid4().hex)
        identity = _validate_identity(self.identity_loader(), self.repo_root)
        self.workspace_id = identity["workspaceId"]
        self.branch = identity["branch"]
        self.result_root = (
            result_root.resolve()
            if result_root is not None
            else _default_result_root(self.workspace_id)
        )
        _assert_external_result_root(self.repo_root, self.result_root)

    def source_freeze(
        self,
        *,
        generation_id: str,
        budget_seconds: int,
        work_item_id: str = SOURCE_WORK_ITEM_ID,
    ) -> Mapping[str, Any]:
        generation = _require_text(
            generation_id, "generation_id", pattern=GIT_COMMIT
        )
        budget = _require_integer(
            budget_seconds, "budget_seconds", minimum=1
        )
        source_work_item_id = _require_text(
            work_item_id,
            "work_item_id",
            pattern=IDENTIFIER,
        )
        identity = self._current_identity(generation)
        declaration = _validate_declaration(
            self.declaration_loader(source_work_item_id),
            identity=identity,
            work_item_id=source_work_item_id,
            task_id=SOURCE_TASK_ID,
            generation_id=generation,
            target=None,
        )
        self.clean_checker()
        directory = self._source_directory(generation)
        if (
            (directory / "source-checkpoint-receipt.json").exists()
            or (directory / "result.json").exists()
        ):
            raise ArtifactConflict(
                "source freeze artifacts already exist for this generation"
            )
        request = {
            "schema_version": SCHEMA_VERSION,
            "kind": "secure-content-source-freeze-request",
            "purpose": "SOURCE_OWNER_CHECKPOINT",
            "plan_id": PLAN_ID,
            "plan_path": PLAN_PATH,
            "task_id": SOURCE_TASK_ID,
            "work_item_id": source_work_item_id,
            "workspace_id": identity["workspaceId"],
            "branch": identity["branch"],
            "source_commit": generation,
            "declaration_id": declaration["declarationId"],
            "declaration_digest": declaration["declarationDigest"],
            "budget_seconds": budget,
        }
        receipt = validate_source_receipt(
            self.source_checkpoint_runner(request, budget_seconds=budget),
            identity=identity,
            generation_id=generation,
            declaration_digest=declaration["declarationDigest"],
        )
        receipt_path = write_immutable_json(
            directory / "source-checkpoint-receipt.json",
            receipt,
        )
        receipt_ref = _relative_ref(self.result_root, receipt_path)
        completed_at = _timestamp(self.clock())
        result = _with_digest(
            {
                "schema_version": SCHEMA_VERSION,
                "kind": SOURCE_RESULT_KIND,
                "workstream_id": SOURCE_TASK_ID,
                "generation_id": generation,
                "source_commit": generation,
                "workspace_id": identity["workspaceId"],
                "checkpoint_receipt_ref": receipt_ref,
                "checkpoint_receipt_digest": receipt["receipt_digest"],
                "status": "PASS",
                "completed_at": completed_at,
            },
            field="result_digest",
        )
        validate_source_result(result, generation_id=generation)
        write_immutable_json(directory / "result.json", result)
        return result

    def run_profile(
        self,
        *,
        workstream_id: str,
        profile_id: str,
        intent: str,
        generation_id: str,
        budget_seconds: int,
        reset_id: str | None = None,
    ) -> Mapping[str, Any]:
        checked_intent = _require_intent(intent)
        generation = _require_text(
            generation_id, "generation_id", pattern=GIT_COMMIT
        )
        budget = _require_integer(
            budget_seconds, "budget_seconds", minimum=1
        )
        target = _target(profile_id)
        work_item_id, expected_workstream, task_id = _work_item(
            target, checked_intent
        )
        if workstream_id != expected_workstream:
            raise ValidationError(
                f"{profile_id}/{checked_intent} requires workstream "
                f"{expected_workstream}"
            )
        reset_identifier = _require_text(
            reset_id or self.id_factory(),
            "reset_id",
            pattern=IDENTIFIER,
        )
        identity = self._current_identity(
            generation,
            allow_plan_lifecycle=checked_intent == "FINAL_CUT",
        )
        declaration = _validate_declaration(
            self.profile_declaration_loader(work_item_id, expected_workstream),
            identity=identity,
            work_item_id=work_item_id,
            task_id=task_id,
            generation_id=generation,
            target=target,
        )
        self.clean_checker()
        source_result = self._load_source_result(generation)
        self._require_serial_predecessor(
            intent=checked_intent,
            generation_id=generation,
            target=target,
        )
        directory = self._profile_directory(
            checked_intent,
            generation,
            profile_id,
            reset_identifier,
        )
        self._assert_reset_id_available(reset_identifier, directory)
        if (directory / "result.json").exists():
            raise ArtifactConflict("reset result already exists")
        request = {
            "schema_version": SCHEMA_VERSION,
            "kind": "secure-content-maintenance-boundary-request",
            "plan_id": PLAN_ID,
            "task_id": task_id,
            "workstream_id": expected_workstream,
            "work_item_id": work_item_id,
            "journey_id": JOURNEY_ID,
            "reset_id": reset_identifier,
            "reset_intent": checked_intent,
            "source_commit": generation,
            "workspace_id": identity["workspaceId"],
            "profile_id": target.profile_id,
            "deployment_environment": target.deployment_environment,
            "destructive_scope": target.destructive_scope,
            "declaration_id": declaration["declarationId"],
            "declaration_digest": declaration["declarationDigest"],
            "source_freeze_digest": source_result["result_digest"],
            "skip_quiesce": _resume_skips_quiescence(directory),
        }
        if self.profile_preparation_runner is not None:
            self.profile_preparation_runner(
                request,
                budget_seconds=budget,
            )
        with self.maintenance_boundary.open(
            request,
            budget_seconds=budget,
        ) as session:
            audit_request = self._new_audit_request(
                request=request,
                declaration=declaration,
                task_id=task_id,
            )
            manifest = _validate_prepared_manifest(
                session.prepare(audit_request),
                target=target,
                intent=checked_intent,
                generation_id=generation,
                workspace_id=identity["workspaceId"],
                reset_id=reset_identifier,
            )
            manifest_path = directory / "reset-manifest.json"
            resuming = manifest_path.exists()
            if resuming:
                existing = read_json_artifact(manifest_path, "reset manifest")
                validate_reset_manifest(
                    existing,
                    target=target,
                    intent=checked_intent,
                    generation_id=generation,
                    workspace_id=identity["workspaceId"],
                    reset_id=reset_identifier,
                )
                if existing != manifest:
                    raise ArtifactConflict(
                        "resume manifest differs from the immutable reset manifest"
                    )
                manifest = existing
            else:
                write_immutable_json(manifest_path, manifest)
            first_invocation = self._new_invocation(
                manifest=manifest,
                declaration=declaration,
                target=target,
                task_id=task_id,
            )
            validate_reset_invocation(
                first_invocation,
                manifest=manifest,
                declaration=declaration,
                target=target,
                task_id=task_id,
                now=self.clock(),
            )
            first_invocation_directory = (
                directory
                / "invocations"
                / first_invocation["invocation_id"]
            )
            write_immutable_json(
                first_invocation_directory / "request.json",
                first_invocation,
            )
            first_response = session.invoke(first_invocation)
            write_immutable_json(
                first_invocation_directory / "response.json",
                first_response,
            )
            if first_response.get("state") == "COMPLETE":
                if not resuming:
                    raise ResetIncomplete(
                        "fresh reset reached COMPLETE before the deployment boundary"
                    )
                response_exact_replay = first_response.get("exact_replay")
                if not isinstance(response_exact_replay, bool):
                    raise ResetIncomplete(
                        "maintenance execution result has invalid exact_replay"
                    )
                journal, attestation = _validate_execution_result(
                    first_response,
                    manifest=manifest,
                    expected_state="COMPLETE",
                    invocations=(),
                    needs_deployment=False,
                    require_attestation=True,
                    expected_exact_replay=response_exact_replay,
                    require_exact_invocations=False,
                )
                terminal_acceptance = journal["accepted_invocations"][-1]
                terminal_invocation_id = terminal_acceptance["invocation_id"]
                expected_exact_replay = (
                    terminal_invocation_id != first_invocation["invocation_id"]
                )
                if response_exact_replay is not expected_exact_replay:
                    raise ResetIncomplete(
                        "maintenance execution result has invalid exact_replay"
                    )
                invocation_directory = (
                    directory
                    / "invocations"
                    / terminal_invocation_id
                )
                invocation = read_json_artifact(
                    invocation_directory / "request.json",
                    "accepted terminal reset invocation",
                )
                accepted_declaration = {
                    **declaration,
                    "declarationDigest": invocation.get("declaration_digest"),
                }
                validate_reset_invocation(
                    invocation,
                    manifest=manifest,
                    declaration=accepted_declaration,
                    target=target,
                    task_id=task_id,
                )
                if (
                    invocation["invocation_digest"]
                    != terminal_acceptance["invocation_digest"]
                ):
                    raise ValidationError(
                        "terminal journal acceptance does not match its "
                        "persisted invocation"
                    )
                result_declaration_digest = invocation["declaration_digest"]
            else:
                _validate_execution_result(
                    first_response,
                    manifest=manifest,
                    expected_state="OBJECTS_DELETED",
                    invocations=(first_invocation,),
                    needs_deployment=True,
                    require_attestation=False,
                    expected_exact_replay=False,
                    require_exact_invocations=not resuming,
                )
                deployment_request = self._deployment_request(
                    request=request,
                    manifest=manifest,
                )
                complete_verified = False
                try:
                    self.station_deployment_runner(
                        deployment_request,
                        budget_seconds=budget,
                    )
                    invocation = self._new_invocation(
                        manifest=manifest,
                        declaration=declaration,
                        target=target,
                        task_id=task_id,
                    )
                    validate_reset_invocation(
                        invocation,
                        manifest=manifest,
                        declaration=declaration,
                        target=target,
                        task_id=task_id,
                        now=self.clock(),
                    )
                    invocation_directory = (
                        directory
                        / "invocations"
                        / invocation["invocation_id"]
                    )
                    write_immutable_json(
                        invocation_directory / "request.json",
                        invocation,
                    )
                    response = session.invoke(invocation)
                    journal, attestation = _validate_execution_result(
                        response,
                        manifest=manifest,
                        expected_state="COMPLETE",
                        invocations=(first_invocation, invocation),
                        needs_deployment=False,
                        require_attestation=True,
                        expected_exact_replay=False,
                        require_exact_invocations=not resuming,
                    )
                    complete_verified = True
                    write_immutable_json(
                        invocation_directory / "response.json",
                        response,
                    )
                    result_declaration_digest = declaration["declarationDigest"]
                except BaseException as error:
                    if not complete_verified:
                        try:
                            self.station_quiescence_runner(
                                deployment_request,
                                budget_seconds=budget,
                            )
                        except Exception as quiescence_error:
                            raise BoundaryUnavailable(
                                "activation failed and Station could not be "
                                f"returned to quiescence: {quiescence_error}"
                            ) from error
                    raise
        journal_path = write_immutable_json(
            directory / "completed-reset-journal.json",
            journal,
        )
        attestation_path = write_immutable_json(
            directory / CANONICAL_PRIVATE_SCHEMA_ATTESTATION_FILENAME,
            attestation,
        )
        manifest_ref = _relative_ref(self.result_root, manifest_path)
        invocation_ref = _relative_ref(
            self.result_root,
            invocation_directory / "request.json",
        )
        journal_ref = _relative_ref(self.result_root, journal_path)
        attestation_ref = _relative_ref(self.result_root, attestation_path)
        result = _with_digest(
            {
                "schema_version": SCHEMA_VERSION,
                "kind": PROFILE_RESULT_KIND,
                "workstream_id": expected_workstream,
                "task_id": task_id,
                "generation_id": generation,
                "source_commit": generation,
                "workspace_id": identity["workspaceId"],
                "profile_id": target.profile_id,
                "activation_ordinal": target.ordinal,
                "deployment_environment": target.deployment_environment,
                "destructive_scope": target.destructive_scope,
                "reset_id": reset_identifier,
                "reset_intent": checked_intent,
                "declaration_digest": result_declaration_digest,
                "source_freeze_ref": self._source_result_ref(generation),
                "source_freeze_digest": source_result["result_digest"],
                "reset_manifest_ref": manifest_ref,
                "reset_manifest_digest": manifest["manifest_digest"],
                "invocation_ref": invocation_ref,
                "invocation_digest": invocation["invocation_digest"],
                "completed_journal_ref": journal_ref,
                "completed_journal_digest": canonical_digest(journal),
                "schema_attestation_ref": attestation_ref,
                "schema_attestation_digest": attestation["attestation_digest"],
                "journal_state": "COMPLETE",
                "status": "PASS",
                "claim": (
                    "CANONICAL_SCHEMA_ACTIVE_ONLY"
                    if checked_intent == "SCHEMA_ACTIVATION"
                    else "FINAL_RESET_COMPLETE_ONLY"
                ),
                "completed_at": attestation["created_at"],
            },
            field="result_digest",
        )
        self._validate_profile_result(
            result,
            target=target,
            intent=checked_intent,
            generation_id=generation,
            validate_references=True,
        )
        write_immutable_json(directory / "result.json", result)
        return result

    def aggregate(
        self,
        *,
        intent: str,
        generation_id: str,
        profiles: Sequence[str],
    ) -> Mapping[str, Any]:
        checked_intent = _require_intent(intent)
        generation = _require_text(
            generation_id, "generation_id", pattern=GIT_COMMIT
        )
        if tuple(profiles) != PROFILE_ORDER:
            raise ValidationError(
                f"profiles must be exactly {','.join(PROFILE_ORDER)} in serial order"
            )
        identity = self._current_identity(
            generation,
            allow_plan_lifecycle=checked_intent == "FINAL_CUT",
        )
        self.clean_checker()
        source_result = self._load_source_result(generation)
        child_results: list[Mapping[str, Any]] = []
        children: list[dict[str, Any]] = []
        for profile_id in PROFILE_ORDER:
            target = _target(profile_id)
            paths = sorted(
                self._profile_parent(checked_intent, generation, profile_id).glob(
                    "*/result.json"
                )
            )
            if len(paths) != 1:
                raise ValidationError(
                    f"{profile_id} must have exactly one completed child result"
                )
            child = read_json_artifact(paths[0], f"{profile_id} child result")
            self._validate_profile_result(
                child,
                target=target,
                intent=checked_intent,
                generation_id=generation,
                validate_references=True,
            )
            child_results.append(child)
            children.append(
                {
                    "profile_id": profile_id,
                    "reset_id": child["reset_id"],
                    "result_ref": _relative_ref(self.result_root, paths[0]),
                    "result_digest": child["result_digest"],
                    "schema_attestation_digest": child[
                        "schema_attestation_digest"
                    ],
                }
            )
        if child_results[0]["reset_id"] == child_results[1]["reset_id"]:
            raise ValidationError("profile reset IDs must be distinct")
        if (
            child_results[0]["declaration_digest"]
            == child_results[1]["declaration_digest"]
        ):
            raise ValidationError("profile declarations must be distinct")
        if _require_timestamp(
            child_results[1]["completed_at"], "fiveArm completed_at"
        ) < _require_timestamp(child_results[0]["completed_at"], "four completed_at"):
            raise ValidationError("profile results do not prove serial execution")
        aggregate_directory = self._aggregate_directory(
            checked_intent, generation
        )
        task_id = SOURCE_TASK_ID if checked_intent == "SCHEMA_ACTIVATION" else "W12"
        result = _with_digest(
            {
                "schema_version": SCHEMA_VERSION,
                "kind": AGGREGATE_RESULT_KIND,
                "workstream_id": task_id,
                "task_id": task_id,
                "generation_id": generation,
                "source_commit": generation,
                "workspace_id": identity["workspaceId"],
                "reset_intent": checked_intent,
                "profiles": list(PROFILE_ORDER),
                "source_freeze_ref": self._source_result_ref(generation),
                "source_freeze_digest": source_result["result_digest"],
                "children": children,
                "status": "PASS",
                "claim": (
                    "CANONICAL_SCHEMA_ACTIVE_ONLY"
                    if checked_intent == "SCHEMA_ACTIVATION"
                    else "FINAL_RESET_COMPLETE_ONLY"
                ),
                "completed_at": child_results[-1]["completed_at"],
            },
            field="result_digest",
        )
        self._validate_aggregate_result(
            result,
            intent=checked_intent,
            generation_id=generation,
        )
        write_immutable_json(aggregate_directory / "result.json", result)
        return result

    def _current_identity(
        self,
        generation_id: str,
        *,
        allow_plan_lifecycle: bool = False,
    ) -> Mapping[str, Any]:
        identity = _validate_identity(self.identity_loader(), self.repo_root)
        if identity["workspaceId"] != self.workspace_id:
            raise ValidationError("worktree workspace changed during owner lifetime")
        if identity["branch"] != self.branch:
            raise ValidationError("worktree branch changed during owner lifetime")
        if identity["head"] != generation_id and not allow_plan_lifecycle:
            raise ValidationError("generation_id differs from the exact worktree HEAD")
        if identity["head"] != generation_id:
            try:
                projection = validate_plan_lifecycle_source(
                    repo_root=self.repo_root,
                    plan_path=PLAN_PATH,
                    runtime_source_commit=generation_id,
                    control_head=identity["head"],
                )
            except PlanLifecycleSourceError as error:
                raise ValidationError(str(error)) from error
            identity = {
                **identity,
                "controlHead": projection.control_head,
                "runtimeSourceCommit": projection.runtime_source_commit,
                "sourceTransitionCount": projection.transition_count,
                "sourceProjectionDigest": projection.transition_digest,
            }
        return identity

    def runtime_source_commit(self) -> str:
        identity = _validate_identity(self.identity_loader(), self.repo_root)
        try:
            projected = resolve_runtime_source_identity(
                repo_root=self.repo_root,
                result_root=self.result_root,
                control_identity=identity,
            )
        except SourceProjectionError as error:
            raise ValidationError(str(error)) from error
        return str(projected["runtimeSourceCommit"])

    def _load_identity(self) -> Mapping[str, Any]:
        completed = self.command_runner(
            [
                sys.executable,
                "tooling/scripts/verify-worktree-binding.py",
                "--root",
                str(self.repo_root),
                "--capture",
            ],
            cwd=self.repo_root,
            capture_output=True,
            text=True,
            check=False,
        )
        return _decode_process_json(completed, "worktree binding capture")

    def _load_declaration(self, work_item_id: str) -> Mapping[str, Any]:
        completed = self.command_runner(
            ["make", "dev-check", f"WORK_ITEM={work_item_id}"],
            cwd=self.repo_root,
            capture_output=True,
            text=True,
            check=False,
        )
        return _decode_process_json(completed, "Development declaration readback")

    def _activate_profile_declaration(
        self,
        work_item_id: str,
        workstream_id: str,
    ) -> Mapping[str, Any]:
        try:
            projection = work_item_control.load_projection(
                self.repo_root / work_item_control.DEFAULT_MANIFEST,
                workstream=workstream_id,
                journey=JOURNEY_ID,
                repo_root=self.repo_root,
            )
            if projection.work_item_id != work_item_id:
                raise work_item_control.ManifestError(
                    "profile work-item projection does not match the requested owner"
                )
            return work_item_control.ensure_active_projection(
                projection,
                repo_root=self.repo_root,
            )
        except (
            work_item_control.ManifestError,
            work_item_control.LedgerReadbackError,
            work_item_control.CommandError,
        ) as error:
            raise BoundaryUnavailable(
                f"profile Development declaration is unavailable: {error}",
                details={
                    "work_item_id": work_item_id,
                    "workstream_id": workstream_id,
                },
            ) from error

    def _check_clean(self) -> None:
        completed = self.command_runner(
            ["git", "status", "--porcelain", "--untracked-files=all"],
            cwd=self.repo_root,
            capture_output=True,
            text=True,
            check=False,
        )
        if completed.returncode != 0:
            raise ValidationError("cannot verify exact-source cleanliness")
        if completed.stdout.strip():
            raise ValidationError("schema activation requires a clean exact source")

    def _source_directory(self, generation_id: str) -> Path:
        return self.result_root / SOURCE_EVIDENCE_ROOT / "source" / generation_id

    def _source_result_ref(self, generation_id: str) -> Mapping[str, str]:
        return _relative_ref(
            self.result_root,
            self._source_directory(generation_id) / "result.json",
        )

    def _load_source_result(self, generation_id: str) -> Mapping[str, Any]:
        path = self._source_directory(generation_id) / "result.json"
        result = read_json_artifact(path, "source freeze result")
        validate_source_result(result, generation_id=generation_id)
        receipt_path, receipt = read_referenced_artifact(
            self.result_root,
            result["checkpoint_receipt_ref"],
            "source checkpoint receipt",
        )
        del receipt_path
        validate_source_receipt(
            receipt,
            identity={"workspaceId": self.workspace_id},
            generation_id=generation_id,
            declaration_digest=_require_text(
                receipt.get("declaration_digest"),
                "source receipt declaration_digest",
                pattern=SHA256,
            ),
        )
        if receipt.get("receipt_digest") != result["checkpoint_receipt_digest"]:
            raise ValidationError("source checkpoint receipt identity mismatch")
        return result

    def _profile_parent(
        self,
        intent: str,
        generation_id: str,
        profile_id: str,
    ) -> Path:
        if intent == "SCHEMA_ACTIVATION":
            return (
                self.result_root
                / SOURCE_EVIDENCE_ROOT
                / "activation"
                / generation_id
                / profile_id
            )
        return (
            self.result_root
            / "W12"
            / "final-cut"
            / generation_id
            / profile_id
        )

    def _profile_directory(
        self,
        intent: str,
        generation_id: str,
        profile_id: str,
        reset_id: str,
    ) -> Path:
        return self._profile_parent(intent, generation_id, profile_id) / reset_id

    def _aggregate_directory(self, intent: str, generation_id: str) -> Path:
        if intent == "SCHEMA_ACTIVATION":
            return (
                self.result_root
                / SOURCE_EVIDENCE_ROOT
                / "activation"
                / generation_id
                / "aggregate"
            )
        return self.result_root / "W12" / "final-cut" / generation_id / "aggregate"

    def _assert_reset_id_available(
        self,
        reset_id: str,
        intended_directory: Path,
    ) -> None:
        candidates = [
            *self.result_root.glob(
                f"{SOURCE_EVIDENCE_ROOT}/activation/*/*/{reset_id}"
            ),
            *self.result_root.glob(f"W12/final-cut/*/*/{reset_id}"),
        ]
        intended = intended_directory.resolve()
        conflicts = [
            candidate
            for candidate in candidates
            if candidate.resolve() != intended
        ]
        if conflicts:
            raise ValidationError(
                "reset_id was already used by another profile, generation, or intent"
            )

    def _require_serial_predecessor(
        self,
        *,
        intent: str,
        generation_id: str,
        target: ProfileTarget,
    ) -> None:
        if target.ordinal == 1:
            return
        predecessor = _target(PROFILE_ORDER[target.ordinal - 2])
        paths = sorted(
            self._profile_parent(
                intent, generation_id, predecessor.profile_id
            ).glob("*/result.json")
        )
        if len(paths) != 1:
            raise ValidationError(
                f"{target.profile_id} requires exactly one completed "
                f"{predecessor.profile_id} child"
            )
        result = read_json_artifact(paths[0], "serial predecessor result")
        self._validate_profile_result(
            result,
            target=predecessor,
            intent=intent,
            generation_id=generation_id,
            validate_references=True,
        )

    def _new_invocation(
        self,
        *,
        manifest: Mapping[str, Any],
        declaration: Mapping[str, Any],
        target: ProfileTarget,
        task_id: str,
    ) -> dict[str, Any]:
        issued = self.clock().astimezone(timezone.utc)
        invocation_id = _require_text(
            self.id_factory(), "invocation_id", pattern=IDENTIFIER
        )
        return _with_digest(
            {
                "schema_version": SCHEMA_VERSION,
                "invocation_id": invocation_id,
                "reset_id": manifest["reset_id"],
                "reset_intent": manifest["reset_intent"],
                "reset_manifest_digest": manifest["manifest_digest"],
                "plan_id": PLAN_ID,
                "task_id": task_id,
                "declaration_digest": declaration["declarationDigest"],
                "source_commit": manifest["source_commit"],
                "workspace_id": manifest["workspace_id"],
                "profile_id": target.profile_id,
                "deployment_environment": target.deployment_environment,
                "destructive_scope": target.destructive_scope,
                "issued_at": _timestamp(issued),
                "expires_at": _timestamp(
                    issued + timedelta(seconds=MAX_INVOCATION_LIFETIME_SECONDS)
                ),
            },
            field="invocation_digest",
        )

    def _new_audit_request(
        self,
        *,
        request: Mapping[str, Any],
        declaration: Mapping[str, Any],
        task_id: str,
    ) -> dict[str, Any]:
        issued = self.clock().astimezone(timezone.utc)
        request_id = (
            "audit-"
            + canonical_digest(
                {
                    "reset_id": request["reset_id"],
                    "declaration_digest": declaration["declarationDigest"],
                }
            )[:32]
        )
        return _with_digest(
            {
                "schema_version": SCHEMA_VERSION,
                "request_id": request_id,
                "reset_id": request["reset_id"],
                "reset_intent": request["reset_intent"],
                "plan_id": PLAN_ID,
                "task_id": task_id,
                "declaration_digest": declaration["declarationDigest"],
                "source_commit": request["source_commit"],
                "workspace_id": request["workspace_id"],
                "profile_id": request["profile_id"],
                "deployment_environment": request["deployment_environment"],
                "destructive_scope": request["destructive_scope"],
                "issued_at": _timestamp(issued),
                "expires_at": _timestamp(
                    issued + timedelta(seconds=MAX_INVOCATION_LIFETIME_SECONDS)
                ),
            },
            field="request_digest",
        )

    def _deployment_request(
        self,
        *,
        request: Mapping[str, Any],
        manifest: Mapping[str, Any],
    ) -> Mapping[str, Any]:
        return {
            "schema_version": SCHEMA_VERSION,
            "kind": STATION_DEPLOYMENT_REQUEST_KIND,
            "plan_id": request["plan_id"],
            "task_id": request["task_id"],
            "workstream_id": request["workstream_id"],
            "work_item_id": request["work_item_id"],
            "reset_id": manifest["reset_id"],
            "reset_intent": manifest["reset_intent"],
            "reset_manifest_digest": manifest["manifest_digest"],
            "source_commit": manifest["source_commit"],
            "workspace_id": manifest["workspace_id"],
            "profile_id": manifest["profile_id"],
            "deployment_environment": manifest["deployment_environment"],
            "destructive_scope": manifest["destructive_scope"],
            "declaration_id": request["declaration_id"],
            "declaration_digest": request["declaration_digest"],
            "source_freeze_digest": request["source_freeze_digest"],
        }

    def _validate_profile_result(
        self,
        value: Any,
        *,
        target: ProfileTarget,
        intent: str,
        generation_id: str,
        validate_references: bool,
    ) -> Mapping[str, Any]:
        result = _require_exact_keys(
            value,
            field="profile result",
            required={
                "schema_version",
                "kind",
                "workstream_id",
                "task_id",
                "generation_id",
                "source_commit",
                "workspace_id",
                "profile_id",
                "activation_ordinal",
                "deployment_environment",
                "destructive_scope",
                "reset_id",
                "reset_intent",
                "declaration_digest",
                "source_freeze_ref",
                "source_freeze_digest",
                "reset_manifest_ref",
                "reset_manifest_digest",
                "invocation_ref",
                "invocation_digest",
                "completed_journal_ref",
                "completed_journal_digest",
                "schema_attestation_ref",
                "schema_attestation_digest",
                "journal_state",
                "status",
                "claim",
                "completed_at",
                "result_digest",
            },
        )
        _, workstream_id, task_id = _work_item(target, intent)
        expected = {
            "schema_version": SCHEMA_VERSION,
            "kind": PROFILE_RESULT_KIND,
            "workstream_id": workstream_id,
            "task_id": task_id,
            "generation_id": generation_id,
            "source_commit": generation_id,
            "workspace_id": self.workspace_id,
            "profile_id": target.profile_id,
            "activation_ordinal": target.ordinal,
            "deployment_environment": target.deployment_environment,
            "destructive_scope": target.destructive_scope,
            "reset_intent": intent,
            "journal_state": "COMPLETE",
            "status": "PASS",
            "claim": (
                "CANONICAL_SCHEMA_ACTIVE_ONLY"
                if intent == "SCHEMA_ACTIVATION"
                else "FINAL_RESET_COMPLETE_ONLY"
            ),
        }
        for field, expected_value in expected.items():
            if result.get(field) != expected_value:
                raise ValidationError(f"profile result has invalid {field}")
        for field in (
            "declaration_digest",
            "source_freeze_digest",
            "reset_manifest_digest",
            "invocation_digest",
            "completed_journal_digest",
            "schema_attestation_digest",
        ):
            _require_text(result[field], field, pattern=SHA256)
        _require_text(result["reset_id"], "reset_id", pattern=IDENTIFIER)
        _require_timestamp(result["completed_at"], "result.completed_at")
        for field in (
            "source_freeze_ref",
            "reset_manifest_ref",
            "invocation_ref",
            "completed_journal_ref",
            "schema_attestation_ref",
        ):
            _validate_ref(result[field], field)
        _check_digest(result, "result_digest", "profile result")
        if validate_references:
            expected_source_ref = self._source_result_ref(generation_id)
            if result["source_freeze_ref"] != expected_source_ref:
                raise ValidationError("profile result source freeze ref is non-canonical")
            _, source_result = read_referenced_artifact(
                self.result_root, result["source_freeze_ref"], "source freeze result"
            )
            validate_source_result(source_result, generation_id=generation_id)
            if source_result["result_digest"] != result["source_freeze_digest"]:
                raise ValidationError("profile result source freeze digest mismatch")
            _, manifest = read_referenced_artifact(
                self.result_root, result["reset_manifest_ref"], "reset manifest"
            )
            directory = self._profile_directory(
                intent,
                generation_id,
                target.profile_id,
                result["reset_id"],
            )
            expected_refs = {
                "reset_manifest_ref": _relative_ref(
                    self.result_root, directory / "reset-manifest.json"
                ),
                "invocation_ref": result["invocation_ref"],
                "completed_journal_ref": _relative_ref(
                    self.result_root, directory / "completed-reset-journal.json"
                ),
                "schema_attestation_ref": _relative_ref(
                    self.result_root,
                    directory / CANONICAL_PRIVATE_SCHEMA_ATTESTATION_FILENAME,
                ),
            }
            for field, expected_ref in expected_refs.items():
                if result[field] != expected_ref:
                    raise ValidationError(f"profile result {field} is non-canonical")
            invocation_ref = _validate_ref(result["invocation_ref"], "invocation_ref")
            invocation_path = PurePosixPath(invocation_ref["path"])
            expected_invocation_parent = PurePosixPath(
                directory.relative_to(self.result_root).as_posix()
            ) / "invocations"
            if (
                invocation_path.parent.parent != expected_invocation_parent
                or invocation_path.name != "request.json"
            ):
                raise ValidationError("profile result invocation_ref is non-canonical")
            validate_reset_manifest(
                manifest,
                target=target,
                intent=intent,
                generation_id=generation_id,
                workspace_id=self.workspace_id,
                reset_id=result["reset_id"],
            )
            if manifest["manifest_digest"] != result["reset_manifest_digest"]:
                raise ValidationError("profile result manifest digest mismatch")
            _, invocation = read_referenced_artifact(
                self.result_root, result["invocation_ref"], "reset invocation"
            )
            validate_reset_invocation(
                invocation,
                manifest=manifest,
                declaration={"declarationDigest": result["declaration_digest"]},
                target=target,
                task_id=task_id,
            )
            if invocation["invocation_digest"] != result["invocation_digest"]:
                raise ValidationError("profile result invocation digest mismatch")
            _, journal = read_referenced_artifact(
                self.result_root,
                result["completed_journal_ref"],
                "completed reset journal",
            )
            validate_completed_journal(
                journal,
                manifest_digest=manifest["manifest_digest"],
                invocation_id=invocation["invocation_id"],
                invocation_digest=invocation["invocation_digest"],
            )
            if canonical_digest(journal) != result["completed_journal_digest"]:
                raise ValidationError("profile result journal digest mismatch")
            _, attestation = read_referenced_artifact(
                self.result_root,
                result["schema_attestation_ref"],
                "schema attestation",
            )
            validate_schema_attestation(
                attestation,
                manifest=manifest,
                journal_digest=canonical_digest(journal),
            )
            if attestation["attestation_digest"] != result[
                "schema_attestation_digest"
            ]:
                raise ValidationError("profile result attestation digest mismatch")
        return result

    def _validate_aggregate_result(
        self,
        value: Any,
        *,
        intent: str,
        generation_id: str,
    ) -> Mapping[str, Any]:
        result = _require_exact_keys(
            value,
            field="aggregate result",
            required={
                "schema_version",
                "kind",
                "workstream_id",
                "task_id",
                "generation_id",
                "source_commit",
                "workspace_id",
                "reset_intent",
                "profiles",
                "source_freeze_ref",
                "source_freeze_digest",
                "children",
                "status",
                "claim",
                "completed_at",
                "result_digest",
            },
        )
        task_id = SOURCE_TASK_ID if intent == "SCHEMA_ACTIVATION" else "W12"
        expected = {
            "schema_version": SCHEMA_VERSION,
            "kind": AGGREGATE_RESULT_KIND,
            "workstream_id": task_id,
            "task_id": task_id,
            "generation_id": generation_id,
            "source_commit": generation_id,
            "workspace_id": self.workspace_id,
            "reset_intent": intent,
            "profiles": list(PROFILE_ORDER),
            "status": "PASS",
            "claim": (
                "CANONICAL_SCHEMA_ACTIVE_ONLY"
                if intent == "SCHEMA_ACTIVATION"
                else "FINAL_RESET_COMPLETE_ONLY"
            ),
        }
        for field, expected_value in expected.items():
            if result.get(field) != expected_value:
                raise ValidationError(f"aggregate result has invalid {field}")
        children = result["children"]
        if not isinstance(children, list) or len(children) != len(PROFILE_ORDER):
            raise ValidationError("aggregate children are incomplete")
        for index, child_value in enumerate(children):
            child = _require_exact_keys(
                child_value,
                field=f"children[{index}]",
                required={
                    "profile_id",
                    "reset_id",
                    "result_ref",
                    "result_digest",
                    "schema_attestation_digest",
                },
            )
            if child.get("profile_id") != PROFILE_ORDER[index]:
                raise ValidationError("aggregate child order is invalid")
            _require_text(child["reset_id"], "child reset_id", pattern=IDENTIFIER)
            _validate_ref(child["result_ref"], "child result_ref")
            _require_text(child["result_digest"], "child result_digest", pattern=SHA256)
            _require_text(
                child["schema_attestation_digest"],
                "child schema_attestation_digest",
                pattern=SHA256,
            )
        _validate_ref(result["source_freeze_ref"], "source_freeze_ref")
        _require_text(
            result["source_freeze_digest"], "source_freeze_digest", pattern=SHA256
        )
        _require_timestamp(result["completed_at"], "aggregate.completed_at")
        _check_digest(result, "result_digest", "aggregate result")
        return result


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _current_head(repo_root: Path) -> str:
    completed = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        raise ValidationError("cannot resolve current source commit")
    return _require_text(completed.stdout.strip(), "source commit", pattern=GIT_COMMIT)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Own SC-D23/SC-D24 schema activation artifacts",
    )
    parser.add_argument("--result-root", type=Path)
    subparsers = parser.add_subparsers(dest="command", required=True)

    freeze = subparsers.add_parser("source-freeze")
    freeze.add_argument("--generation-id", required=True)
    freeze.add_argument("--budget-seconds", required=True, type=int)
    freeze.add_argument("--work-item", default=SOURCE_WORK_ITEM_ID)

    run = subparsers.add_parser("run")
    run.add_argument("--workstream", required=True)
    run.add_argument("--profile", required=True, choices=PROFILE_ORDER)
    run.add_argument("--intent", required=True, choices=INTENTS)
    run.add_argument("--generation-id")
    run.add_argument("--budget-seconds", required=True, type=int)
    run.add_argument("--reset-id")

    aggregate = subparsers.add_parser("aggregate")
    aggregate.add_argument("--intent", required=True, choices=INTENTS)
    aggregate.add_argument("--generation-id")
    aggregate.add_argument("--profiles", required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    repo_root = _repo_root()
    transport = (
        ReviewedSchemaActivationTransport(repo_root=repo_root)
        if arguments.command == "run"
        else None
    )
    owner = SchemaActivationOwner(
        repo_root=repo_root,
        result_root=arguments.result_root,
        maintenance_boundary=(
            LeaseWrappedSSHMaintenanceBoundary(
                repo_root=repo_root,
                command_resolver=(
                    lambda request, budget: transport.maintenance_command(
                        request,
                        budget_seconds=budget,
                    )
                ),
            )
            if transport is not None
            else None
        ),
        profile_preparation_runner=(
            transport.prepare if transport is not None else None
        ),
        station_deployment_runner=(
            transport.deploy if transport is not None else None
        ),
        station_quiescence_runner=(
            transport.requiesce if transport is not None else None
        ),
    )
    try:
        if arguments.command == "source-freeze":
            result = owner.source_freeze(
                generation_id=arguments.generation_id,
                budget_seconds=arguments.budget_seconds,
                work_item_id=arguments.work_item,
            )
        elif arguments.command == "run":
            generation = arguments.generation_id
            if generation is None:
                generation = (
                    _current_head(repo_root)
                    if arguments.intent == "SCHEMA_ACTIVATION"
                    else owner.runtime_source_commit()
                )
            result = owner.run_profile(
                workstream_id=arguments.workstream,
                profile_id=arguments.profile,
                intent=arguments.intent,
                generation_id=generation,
                budget_seconds=arguments.budget_seconds,
                reset_id=arguments.reset_id,
            )
        else:
            profiles = tuple(
                item.strip()
                for item in arguments.profiles.split(",")
                if item.strip()
            )
            generation = arguments.generation_id
            if generation is None:
                generation = (
                    _current_head(repo_root)
                    if arguments.intent == "SCHEMA_ACTIVATION"
                    else owner.runtime_source_commit()
                )
            result = owner.aggregate(
                intent=arguments.intent,
                generation_id=generation,
                profiles=profiles,
            )
    except (
        SchemaActivationError,
        ActivationTransportError,
        OSError,
        subprocess.SubprocessError,
    ) as error:
        code = (
            error.code
            if isinstance(error, SchemaActivationError)
            else "SCHEMA_ACTIVATION_IO_FAILED"
        )
        details = error.details if isinstance(error, SchemaActivationError) else {}
        print(
            json.dumps(
                {
                    "status": "BLOCKED",
                    "code": code,
                    "message": str(error),
                    "details": details,
                },
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 2
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
