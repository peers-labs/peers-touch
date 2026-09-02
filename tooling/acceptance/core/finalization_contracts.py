"""Pure, closed contracts shared by D-19 finalization components."""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import math
import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from enum import Enum
from typing import Any, ClassVar, Mapping, Union

from .result_contracts import CanonicalResultTuple


FINALIZER_TIMEOUT_SECONDS_MAX = 60
FINALIZER_INPUT_BYTE_LIMIT_MAX = 1024 * 1024
REPO_RELATIVE_PATH_BYTE_LIMIT = 512

_I_JSON_INTEGER_MIN = -9007199254740991
_I_JSON_INTEGER_MAX = 9007199254740991
_SLUG_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_ENTRYPOINT_PATTERN = re.compile(
    r"^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$"
)
_DRIVE_PREFIX_PATTERN = re.compile(r"^[A-Za-z]:")
_WORKSPACE_ID_PATTERN = re.compile(r"^[0-9a-f]{16}$")
_RUN_ID_PATTERN = re.compile(r"^\d{8}T\d{12}Z-[0-9a-f]{32}$")

_PAYLOAD_DOMAIN = "pt.acceptance.finalization.payload.v1"
_SNAPSHOT_DOMAIN = "pt.acceptance.finalization.snapshot.v1"
_PRIMARY_RESULT_DOMAIN = "pt.acceptance.finalization.primary-result.v1"
_PRIMARY_RESULT_SOURCE_TRACE_DOMAIN = (
    "pt.acceptance.finalization.primary-result-source-trace.v1"
)
_REQUIREMENT_DOMAIN = "pt.acceptance.finalization.requirement.v1"
_REQUIREMENT_MAPPING_DOMAIN = (
    "pt.acceptance.finalization.requirement-mapping.v1"
)
_CONFIG_DOMAIN = "pt.acceptance.finalization.config.v1"
_PROTECTED_BASELINE_DOMAIN = (
    "pt.acceptance.finalization.protected-baseline.v1"
)
_SOURCE_DOMAIN = "pt.acceptance.finalization.source.v1"
_CONTRACT_ROLE_PROJECTION_DOMAIN = (
    "pt.acceptance.finalization.role-projection.v1"
)
_INVOCATION_DOMAIN = "pt.acceptance.finalization.invocation.v1"
_FINALIZER_INPUT_DOMAIN = "pt.acceptance.finalization.finalizer-input.v1"
_SEAL_DOMAIN = "pt.acceptance.finalization.seal.v1"
_CORE_BOOTSTRAP_SOURCE_DOMAIN = (
    "pt.acceptance.finalization.core-bootstrap-source.v1"
)
_SUPERVISOR_SOURCE_DOMAIN = (
    "pt.acceptance.finalization.supervisor-source.v1"
)
_STDLIB_CLOSURE_DOMAIN = "pt.acceptance.finalization.stdlib-closure.v1"
_COMPILER_FLAGS_DOMAIN = "pt.acceptance.finalization.compiler-flags.v1"
_PLATFORM_RUNTIME_DOMAIN = (
    "pt.acceptance.finalization.platform-runtime.v1"
)
_RUNTIME_HOST_IDENTITY_DOMAIN = (
    "pt.acceptance.finalization.runtime-host-identity.v1"
)
_SUPERVISOR_RUNTIME_DOMAIN = (
    "pt.acceptance.finalization.supervisor-runtime.v1"
)
_FINALIZER_RUNTIME_DOMAIN = "pt.acceptance.finalization.runtime.v1"
_CHILD_OUTCOME_DOMAIN = "pt.acceptance.finalization.child-outcome.v1"
_OUTCOME_DOMAIN = "pt.acceptance.finalization.outcome.v1"
_AUTHORITATIVE_RESOLUTION_DOMAIN = (
    "pt.acceptance.finalization.authoritative-resolution.v1"
)
_ENFORCEMENT_ACTIVATED_DOMAIN = (
    "pt.acceptance.finalization.enforcement-activated.v1"
)
_ENFORCEMENT_CURRENT_DOMAIN = (
    "pt.acceptance.finalization.enforcement-current.v1"
)
_PRIOR_LATEST_POINTER_DOMAIN = (
    "pt.acceptance.finalization.prior-latest-pointer.v1"
)
_ABORT_PREFLIGHT_REQUEST_DOMAIN = (
    "pt.acceptance.finalization.abort-preflight-request.v1"
)
_ABORT_PREFLIGHT_RESULT_DOMAIN = (
    "pt.acceptance.finalization.abort-preflight-result.v1"
)
_PROOF_SOURCE_NODE_DOMAIN = (
    "pt.acceptance.finalization.proof-admission-source-node.v1"
)
_PROOF_ADMISSION_SOURCE_DOMAIN = (
    "pt.acceptance.finalization.proof-admission-source.v1"
)
_CLAIM_INPUT_DOMAIN = "pt.acceptance.finalization.claim-emitter-input.v1"
_CLAIM_OUTPUT_DOMAIN = "pt.acceptance.finalization.claim-emitter-output.v1"
_SCANNER_RUNTIME_DOMAIN = (
    "pt.acceptance.finalization.proof-admission-scanner-runtime.v1"
)
_SCANNER_SOURCE_DOMAIN = (
    "pt.acceptance.finalization.proof-admission-scanner-source.v1"
)
_FORBIDDEN_RULE_DOMAIN = (
    "pt.acceptance.finalization.proof-admission-forbidden-process-api-rule.v1"
)
_FORBIDDEN_REGISTRY_DOMAIN = (
    "pt.acceptance.finalization.proof-admission-forbidden-process-api-registry.v1"
)
_FORBIDDEN_SCAN_DOMAIN = (
    "pt.acceptance.finalization.proof-admission-forbidden-process-api-scan.v1"
)
_ARGV_DOMAIN = "pt.acceptance.finalization.proof-admission-argv.v1"
_JOB_RUNTIME_DOMAIN = (
    "pt.acceptance.finalization.proof-admission-job-runtime.v1"
)
_CONSUMING_WAIT_DOMAIN = (
    "pt.acceptance.finalization.proof-admission-consuming-wait.v1"
)
_LINUX_WAITID_STATUS_DOMAIN = (
    "pt.acceptance.finalization.proof-admission-linux-waitid-status.v1"
)
_LINUX_PIDFD_CAPABILITY_DOMAIN = (
    "pt.acceptance.finalization.proof-admission-linux-pidfd-wait-capability.v1"
)
_BOOT_OBSERVATION_DOMAIN = {
    "DARWIN": (
        "pt.acceptance.finalization.proof-admission-darwin-boot-observation.v1"
    ),
    "LINUX": (
        "pt.acceptance.finalization.proof-admission-linux-boot-observation.v1"
    ),
}
_BOOT_OBSERVATION_REF_DOMAIN = {
    "DARWIN": (
        "pt.acceptance.finalization.proof-admission-darwin-boot-observation-ref.v1"
    ),
    "LINUX": (
        "pt.acceptance.finalization.proof-admission-linux-boot-observation-ref.v1"
    ),
}
_BOOT_ATTESTATION_DOMAIN = {
    "DARWIN": (
        "pt.acceptance.finalization.proof-admission-darwin-boot-boundary.v1"
    ),
    "LINUX": (
        "pt.acceptance.finalization.proof-admission-linux-boot-boundary.v1"
    ),
}
_LOCK_DOMAIN = "pt.acceptance.finalization.proof-admission-lock.v1"
_ENVIRONMENT_DOMAIN = "pt.acceptance.finalization.proof-admission-environment.v1"
_ENVIRONMENT_TERMINATION_DOMAIN = (
    "pt.acceptance.finalization.proof-admission-environment-termination.v1"
)
_NAMESPACE_TERMINATION_DOMAIN = (
    "pt.acceptance.finalization.proof-admission-linux-namespace-termination.v1"
)
_WRAPPER_SOURCE_DOMAIN = (
    "pt.acceptance.finalization.proof-admission-claim-wrapper-source.v1"
)
_WRAPPER_RUNTIME_DOMAIN = (
    "pt.acceptance.finalization.proof-admission-claim-wrapper-runtime.v1"
)
_WRAPPER_IDENTITY_DOMAIN = (
    "pt.acceptance.finalization.proof-admission-claim-wrapper.v1"
)
_WRAPPER_WAIT_DOMAIN = (
    "pt.acceptance.finalization.proof-admission-claim-wrapper-wait.v1"
)
_PROCESS_GROUP_ENUMERATION_DOMAIN = (
    "pt.acceptance.finalization.proof-admission-process-group-enumeration.v1"
)
_ORPHAN_RECOVERY_DOMAIN = (
    "pt.acceptance.finalization.proof-admission-orphan-recovery.v1"
)
_EPOCH_DOMAIN = "pt.acceptance.finalization.proof-admission-epoch.v1"
_EPOCH_REF_DOMAIN = "pt.acceptance.finalization.proof-admission-epoch-ref.v1"
_CURRENT_EPOCH_DOMAIN = (
    "pt.acceptance.finalization.proof-admission-current-epoch.v1"
)
_JOB_RECORD_DOMAIN = (
    "pt.acceptance.finalization.proof-admission-job-record.v1"
)
_JOB_COMPLETION_DOMAIN = (
    "pt.acceptance.finalization.proof-admission-job-completion.v1"
)
_SINK_SOURCE_DOMAIN = (
    "pt.acceptance.finalization.proof-admission-sink-source.v1"
)
_SINK_RESOLVER_DOMAIN = (
    "pt.acceptance.finalization.proof-admission-sink-resolver-identity.v1"
)
_SINK_ID_DOMAIN = "pt.acceptance.finalization.proof-admission-sink-id.v1"
_SINK_IDENTITY_DOMAIN = (
    "pt.acceptance.finalization.proof-admission-sink-identity.v1"
)
_EMISSION_IDEMPOTENCY_DOMAIN = (
    "pt.acceptance.finalization.proof-admission-emission-idempotency.v1"
)
_EMISSION_INTENT_DOMAIN = (
    "pt.acceptance.finalization.proof-admission-emission-intent.v1"
)
_EMISSION_ACK_DOMAIN = (
    "pt.acceptance.finalization.proof-admission-emission-acknowledgement.v1"
)
_SINK_RECEIPT_DOMAIN = (
    "pt.acceptance.finalization.proof-admission-sink-receipt.v1"
)
_PAUSE_DOMAIN = "pt.acceptance.finalization.proof-admission-pause.v1"
_QUIESCENCE_DOMAIN = (
    "pt.acceptance.finalization.proof-admission-quiescence.v1"
)
_MOUNT_BINDING_DOMAIN = (
    "pt.acceptance.finalization.durability-live-mount-binding.v1"
)
_KERNEL_HELPER_DOMAIN = (
    "pt.acceptance.finalization.proof-admission-kernel-helper.v1"
)
_DURABILITY_CAPABILITY_REF_DOMAIN = (
    "pt.acceptance.finalization.durability-capability-ref.v1"
)
_STABLE_VOLUME_IDENTITY_DOMAIN = (
    "pt.acceptance.finalization.durability-volume-identity.v1"
)
_DURABILITY_SYNC_ANCHOR_DOMAIN = (
    "pt.acceptance.finalization.durability-sync-anchor.v1"
)
_DURABILITY_QUALIFIED_ENVIRONMENT_DOMAIN = (
    "pt.acceptance.finalization.durability-qualified-environment.v1"
)
_DURABILITY_ENVIRONMENT_OBSERVATION_DOMAIN = (
    "pt.acceptance.finalization.durability-environment-observation.v1"
)
_DURABILITY_QUALIFICATION_BOOT_DOMAIN = (
    "pt.acceptance.finalization.durability-qualification-boot-observation.v1"
)
_DURABILITY_PROFILE_BOOT_DOMAIN = (
    "pt.acceptance.finalization.durability-profile-boot-observation.v1"
)
_DURABILITY_EXPECTATION_DOMAIN = (
    "pt.acceptance.finalization.durability-expectation.v1"
)
_DURABILITY_EXECUTION_START_DOMAIN = (
    "pt.acceptance.finalization.durability-execution-start.v1"
)
_DURABILITY_CRASH_FIXTURE_MANIFEST_DOMAIN = (
    "pt.acceptance.finalization.durability-crash-fixture-manifest.v1"
)
_DURABILITY_CRASH_CASE_DOMAIN = (
    "pt.acceptance.finalization.durability-crash-case.v1"
)
_POWER_CONTROLLER_IDENTITY_DOMAIN = (
    "pt.acceptance.finalization.durability-controller-identity.v1"
)
_POWER_INTERRUPTION_EVIDENCE_DOMAIN = (
    "pt.acceptance.finalization.durability-power-interruption.v1"
)

_SUPPORTED_DIGEST_DOMAINS = frozenset(
    {
        _PAYLOAD_DOMAIN,
        _SNAPSHOT_DOMAIN,
        _PRIMARY_RESULT_DOMAIN,
        _PRIMARY_RESULT_SOURCE_TRACE_DOMAIN,
        _REQUIREMENT_DOMAIN,
        _REQUIREMENT_MAPPING_DOMAIN,
        _CONFIG_DOMAIN,
        _PROTECTED_BASELINE_DOMAIN,
        _SOURCE_DOMAIN,
        _CONTRACT_ROLE_PROJECTION_DOMAIN,
        _INVOCATION_DOMAIN,
        _FINALIZER_INPUT_DOMAIN,
        _SEAL_DOMAIN,
        _CORE_BOOTSTRAP_SOURCE_DOMAIN,
        _SUPERVISOR_SOURCE_DOMAIN,
        _STDLIB_CLOSURE_DOMAIN,
        _COMPILER_FLAGS_DOMAIN,
        _PLATFORM_RUNTIME_DOMAIN,
        _RUNTIME_HOST_IDENTITY_DOMAIN,
        _SUPERVISOR_RUNTIME_DOMAIN,
        _FINALIZER_RUNTIME_DOMAIN,
        _CHILD_OUTCOME_DOMAIN,
        _OUTCOME_DOMAIN,
        _AUTHORITATIVE_RESOLUTION_DOMAIN,
        _ENFORCEMENT_ACTIVATED_DOMAIN,
        _ENFORCEMENT_CURRENT_DOMAIN,
        _PRIOR_LATEST_POINTER_DOMAIN,
        _ABORT_PREFLIGHT_REQUEST_DOMAIN,
        _ABORT_PREFLIGHT_RESULT_DOMAIN,
        _PROOF_SOURCE_NODE_DOMAIN,
        _PROOF_ADMISSION_SOURCE_DOMAIN,
        _CLAIM_INPUT_DOMAIN,
        _CLAIM_OUTPUT_DOMAIN,
        _SCANNER_RUNTIME_DOMAIN,
        _SCANNER_SOURCE_DOMAIN,
        _FORBIDDEN_RULE_DOMAIN,
        _FORBIDDEN_REGISTRY_DOMAIN,
        _FORBIDDEN_SCAN_DOMAIN,
        _ARGV_DOMAIN,
        _JOB_RUNTIME_DOMAIN,
        _CONSUMING_WAIT_DOMAIN,
        _LINUX_WAITID_STATUS_DOMAIN,
        _LINUX_PIDFD_CAPABILITY_DOMAIN,
        *_BOOT_OBSERVATION_DOMAIN.values(),
        *_BOOT_OBSERVATION_REF_DOMAIN.values(),
        *_BOOT_ATTESTATION_DOMAIN.values(),
        _LOCK_DOMAIN,
        _ENVIRONMENT_DOMAIN,
        _ENVIRONMENT_TERMINATION_DOMAIN,
        _NAMESPACE_TERMINATION_DOMAIN,
        _WRAPPER_SOURCE_DOMAIN,
        _WRAPPER_RUNTIME_DOMAIN,
        _WRAPPER_IDENTITY_DOMAIN,
        _WRAPPER_WAIT_DOMAIN,
        _PROCESS_GROUP_ENUMERATION_DOMAIN,
        _ORPHAN_RECOVERY_DOMAIN,
        _EPOCH_DOMAIN,
        _EPOCH_REF_DOMAIN,
        _CURRENT_EPOCH_DOMAIN,
        _JOB_RECORD_DOMAIN,
        _JOB_COMPLETION_DOMAIN,
        _SINK_SOURCE_DOMAIN,
        _SINK_RESOLVER_DOMAIN,
        _SINK_ID_DOMAIN,
        _SINK_IDENTITY_DOMAIN,
        _EMISSION_IDEMPOTENCY_DOMAIN,
        _EMISSION_INTENT_DOMAIN,
        _EMISSION_ACK_DOMAIN,
        _SINK_RECEIPT_DOMAIN,
        _PAUSE_DOMAIN,
        _QUIESCENCE_DOMAIN,
        _MOUNT_BINDING_DOMAIN,
        _KERNEL_HELPER_DOMAIN,
        _DURABILITY_CAPABILITY_REF_DOMAIN,
        _STABLE_VOLUME_IDENTITY_DOMAIN,
        _DURABILITY_SYNC_ANCHOR_DOMAIN,
        _DURABILITY_QUALIFIED_ENVIRONMENT_DOMAIN,
        _DURABILITY_ENVIRONMENT_OBSERVATION_DOMAIN,
        _DURABILITY_QUALIFICATION_BOOT_DOMAIN,
        _DURABILITY_PROFILE_BOOT_DOMAIN,
        _DURABILITY_EXPECTATION_DOMAIN,
        _DURABILITY_EXECUTION_START_DOMAIN,
        _DURABILITY_CRASH_FIXTURE_MANIFEST_DOMAIN,
        _DURABILITY_CRASH_CASE_DOMAIN,
        _POWER_CONTROLLER_IDENTITY_DOMAIN,
        _POWER_INTERRUPTION_EVIDENCE_DOMAIN,
    }
)


class FinalizerOutcomeStatus(str, Enum):
    VALIDATED = "VALIDATED"
    REJECTED = "REJECTED"
    BLOCKED = "BLOCKED"
    TIMED_OUT = "TIMED_OUT"
    ERROR = "ERROR"


class FinalizerFailureCode(str, Enum):
    REQUIRED_MISSING = "FINALIZER_REQUIRED_MISSING"
    CONFIG_MISMATCH = "FINALIZER_CONFIG_MISMATCH"
    ENFORCEMENT_CHANGED = "FINALIZER_ENFORCEMENT_CHANGED"
    NOT_INVOKED_PRE_SEAL = "FINALIZER_NOT_INVOKED_PRE_SEAL"
    PRIMARY_RESULT_INVALID = "FINALIZER_PRIMARY_RESULT_INVALID"
    SNAPSHOT_INVALID = "FINALIZER_SNAPSHOT_INVALID"
    IDENTITY_MISMATCH = "FINALIZER_IDENTITY_MISMATCH"
    SOURCE_MISMATCH = "FINALIZER_SOURCE_MISMATCH"
    RUNTIME_MISMATCH = "FINALIZER_RUNTIME_MISMATCH"
    DURABILITY_PROFILE_UNSUPPORTED = "FINALIZER_DURABILITY_PROFILE_UNSUPPORTED"
    AUTHORITY_RUNTIME_IO_FAILED = "FINALIZER_AUTHORITY_RUNTIME_IO_FAILED"
    BUNDLE_INVALID = "FINALIZER_BUNDLE_INVALID"
    HARD_TIMEOUT_UNSUPPORTED = "FINALIZER_HARD_TIMEOUT_UNSUPPORTED"
    SUPERVISOR_FAILED = "FINALIZER_SUPERVISOR_FAILED"
    MATERIALIZATION_FAILED = "FINALIZER_MATERIALIZATION_FAILED"
    INPUT_TOO_LARGE = "FINALIZER_INPUT_TOO_LARGE"
    OUTPUT_TOO_LARGE = "FINALIZER_OUTPUT_TOO_LARGE"
    REJECTED = "FINALIZER_REJECTED"
    BLOCKED = "FINALIZER_BLOCKED"
    TIMED_OUT = "FINALIZER_TIMED_OUT"
    CANCELLED = "FINALIZER_CANCELLED"
    PROCESS_FAILED = "FINALIZER_PROCESS_FAILED"
    OUTPUT_INVALID = "FINALIZER_OUTPUT_INVALID"
    ABORT_SEALED_LOCK_TIMEOUT = "ABORT_SEALED_LOCK_TIMEOUT"
    ABORT_SEALED_INCOMPLETE = "ABORT_SEALED_INCOMPLETE"
    ABORT_SEALED_DELETE_UNSUPPORTED = "ABORT_SEALED_DELETE_UNSUPPORTED"


class MaintenanceFailureCode(str, Enum):
    IDENTITY_MISMATCH = "MAINTENANCE_IDENTITY_MISMATCH"
    REQUEST_INVALID = "MAINTENANCE_REQUEST_INVALID"
    DURABILITY_PROFILE_UNSUPPORTED = "MAINTENANCE_DURABILITY_PROFILE_UNSUPPORTED"
    DURABLE_STATE_CONFLICT = "MAINTENANCE_DURABLE_STATE_CONFLICT"
    ACTIVE_RUN = "MAINTENANCE_ACTIVE_RUN"
    LIMIT_EXCEEDED = "MAINTENANCE_LIMIT_EXCEEDED"
    TIMED_OUT = "MAINTENANCE_TIMED_OUT"
    IO_FAILED = "MAINTENANCE_IO_FAILED"


class FinalizationOrigin(str, Enum):
    CHILD = "CHILD"
    CORE = "CORE"


class EvidenceFinalizationState(str, Enum):
    NOT_REQUIRED = "NOT_REQUIRED"
    NOT_INVOKED_PRE_SEAL = "NOT_INVOKED_PRE_SEAL"
    COMPLETED = "COMPLETED"


class RuntimeOsFamily(str, Enum):
    DARWIN = "DARWIN"
    LINUX = "LINUX"


class StdlibModuleOriginKind(str, Enum):
    FILE = "FILE"
    BUILTIN = "BUILTIN"
    FROZEN = "FROZEN"


class RuntimeImageOriginKind(str, Enum):
    STANDALONE_FILE = "STANDALONE_FILE"
    DARWIN_SHARED_CACHE = "DARWIN_SHARED_CACHE"


class RuntimeFileKind(str, Enum):
    SUPERVISOR_BINARY = "SUPERVISOR_BINARY"
    PYTHON_EXECUTABLE = "PYTHON_EXECUTABLE"
    STDLIB_MODULE = "STDLIB_MODULE"
    COMPILER_BINARY = "COMPILER_BINARY"
    LOADED_RUNTIME_IMAGE = "LOADED_RUNTIME_IMAGE"


class LatestAuthorityMode(str, Enum):
    LEGACY = "LEGACY"
    FINALIZER_ENFORCED = "FINALIZER_ENFORCED"


class AbortOperatorIdentityKind(str, Enum):
    POSIX_EFFECTIVE_UID = "POSIX_EFFECTIVE_UID"


class AbortPreflightStatus(str, Enum):
    REJECTED = "REJECTED"


class AbortPreflightDurableBoundary(str, Enum):
    NO_MUTATION = "NO_MUTATION"


class ProofAdmissionEdgeKind(str, Enum):
    IMPORT = "IMPORT"
    INCLUDE = "INCLUDE"
    EXECUTE = "EXECUTE"
    SOURCE = "SOURCE"
    MAKE_RECIPE = "MAKE_RECIPE"
    CI_STEP = "CI_STEP"
    DATA_READ = "DATA_READ"


class ProofAdmissionGrammarId(str, Enum):
    PYTHON_AST_V1 = "PYTHON_AST_V1"
    POSIX_SHELL_V1 = "POSIX_SHELL_V1"
    ECMASCRIPT_V1 = "ECMASCRIPT_V1"
    TYPESCRIPT_V1 = "TYPESCRIPT_V1"
    RUST_V1 = "RUST_V1"
    GO_V1 = "GO_V1"
    C_V1 = "C_V1"
    MAKE_V1 = "MAKE_V1"
    YAML_V1 = "YAML_V1"
    TOML_V1 = "TOML_V1"
    JSON_V1 = "JSON_V1"


class ProofAdmissionInterpreter(str, Enum):
    PYTHON3 = "PYTHON3"
    POSIX_SH = "POSIX_SH"
    NODE = "NODE"
    NATIVE = "NATIVE"


class ProofAdmissionSourceClassification(str, Enum):
    PARSED_SOURCE = "PARSED_SOURCE"
    OPAQUE_DATA = "OPAQUE_DATA"


class ForbiddenProcessOperation(str, Enum):
    CREATE_PROCESS = "CREATE_PROCESS"
    REPLACE_PROCESS_IMAGE = "REPLACE_PROCESS_IMAGE"
    EXEC_SHELL = "EXEC_SHELL"
    CREATE_SESSION = "CREATE_SESSION"
    CHANGE_PROCESS_GROUP = "CHANGE_PROCESS_GROUP"
    DYNAMIC_SYMBOL_RESOLUTION = "DYNAMIC_SYMBOL_RESOLUTION"
    LOAD_NATIVE_EXTENSION = "LOAD_NATIVE_EXTENSION"


class PosixTerminalKind(str, Enum):
    EXITED = "EXITED"
    SIGNALED = "SIGNALED"


class LinuxWaitIdCode(str, Enum):
    CLD_EXITED = "CLD_EXITED"
    CLD_KILLED = "CLD_KILLED"
    CLD_DUMPED = "CLD_DUMPED"


class ProofAdmissionJobTerminalState(str, Enum):
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"
    REAPED = "REAPED"


class ProofAdmissionTerminationProofKind(str, Enum):
    LEAF_PROCESS_REAPED = "LEAF_PROCESS_REAPED"
    EXECUTION_ENVIRONMENT_TERMINATED = "EXECUTION_ENVIRONMENT_TERMINATED"


class ProofAdmissionTerminationMethod(str, Enum):
    BOOT_BOUNDARY_ATTESTED = "BOOT_BOUNDARY_ATTESTED"
    PID_NAMESPACE_INIT_TERMINATED = "PID_NAMESPACE_INIT_TERMINATED"


_PROOF_PROCESS_POLICY = "NO_CHILD_NO_SESSION_CHANGE_V1"
_VALID_GRAMMAR_INTERPRETER_PAIRS = frozenset(
    {
        (ProofAdmissionGrammarId.PYTHON_AST_V1, ProofAdmissionInterpreter.PYTHON3),
        (ProofAdmissionGrammarId.POSIX_SHELL_V1, ProofAdmissionInterpreter.POSIX_SH),
        (ProofAdmissionGrammarId.ECMASCRIPT_V1, ProofAdmissionInterpreter.NODE),
        (ProofAdmissionGrammarId.TYPESCRIPT_V1, ProofAdmissionInterpreter.NODE),
        (ProofAdmissionGrammarId.RUST_V1, ProofAdmissionInterpreter.NATIVE),
        (ProofAdmissionGrammarId.GO_V1, ProofAdmissionInterpreter.NATIVE),
        (ProofAdmissionGrammarId.C_V1, ProofAdmissionInterpreter.NATIVE),
        (ProofAdmissionGrammarId.MAKE_V1, ProofAdmissionInterpreter.POSIX_SH),
        (ProofAdmissionGrammarId.YAML_V1, None),
        (ProofAdmissionGrammarId.TOML_V1, None),
        (ProofAdmissionGrammarId.JSON_V1, None),
    }
)


def merge_finalizer_outcome(
    primary: CanonicalResultTuple,
    outcome: FinalizerOutcomeStatus | None,
    *,
    finalizer_required: bool,
) -> CanonicalResultTuple:
    """Apply the accepted D-19 monotonic result merge table."""
    if not isinstance(primary, CanonicalResultTuple):
        raise ValueError("primary result must be a CanonicalResultTuple")
    if outcome is not None and not isinstance(outcome, FinalizerOutcomeStatus):
        raise ValueError("finalizer outcome must be closed")
    if not finalizer_required:
        if outcome is not None:
            raise ValueError("a non-required finalizer cannot produce an outcome")
        return primary
    if primary.status in {"failed", "blocked"}:
        return primary
    if outcome is FinalizerOutcomeStatus.VALIDATED:
        return primary
    return CanonicalResultTuple.FailedPartialUnproven


def validate_finalizer_id(value: object) -> str:
    """Return a valid D-19 finalizer slug or raise ValueError."""
    if not isinstance(value, str) or _SLUG_PATTERN.fullmatch(value) is None:
        raise ValueError(
            "finalizer ID must match "
            "[A-Za-z0-9][A-Za-z0-9._-]{0,127}"
        )
    return value


def validate_repo_relative_path(value: object) -> str:
    """Validate one canonical, bounded repository-relative POSIX path."""
    if not isinstance(value, str) or not value:
        raise ValueError("repository-relative path must be a non-empty string")
    try:
        encoded = value.encode("utf-8")
    except UnicodeEncodeError as error:
        raise ValueError("repository-relative path must be valid UTF-8") from error
    if len(encoded) > REPO_RELATIVE_PATH_BYTE_LIMIT:
        raise ValueError(
            "repository-relative path exceeds the 512-byte limit"
        )
    if (
        value.startswith("/")
        or "\\" in value
        or _DRIVE_PREFIX_PATTERN.match(value) is not None
        or any(ord(character) < 32 or ord(character) == 127 for character in value)
    ):
        raise ValueError("repository-relative path is not canonical POSIX")
    parts = value.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        raise ValueError("repository-relative path may not escape or normalize")
    return value


def validate_sha256(value: object) -> str:
    """Return a lowercase raw SHA-256 hex digest or raise ValueError."""
    if not isinstance(value, str) or _SHA256_PATTERN.fullmatch(value) is None:
        raise ValueError("SHA-256 must be exactly 64 lowercase hex characters")
    return value


def canonical_json_bytes(value: object) -> bytes:
    """Encode supported JSON primitives using RFC 8785 canonical ordering."""
    return _canonical_json_text(value, active_containers=set()).encode("utf-8")


def raw_sha256(value: bytes) -> str:
    """Hash exact bytes as lowercase raw SHA-256."""
    if not isinstance(value, bytes):
        raise ValueError("raw SHA-256 input must be bytes")
    return hashlib.sha256(value).hexdigest()


def domain_separated_sha256(domain: str, payload: object) -> str:
    """Hash a supported payload in one registered D-19 digest domain."""
    if domain not in _SUPPORTED_DIGEST_DOMAINS:
        raise ValueError("unknown finalization digest domain")
    return raw_sha256(
        canonical_json_bytes({"domain": domain, "payload": payload})
    )


def _canonical_json_text(
    value: object,
    *,
    active_containers: set[int],
) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int):
        if not _I_JSON_INTEGER_MIN <= value <= _I_JSON_INTEGER_MAX:
            raise ValueError("JSON integer is outside the I-JSON safe range")
        return str(value)
    if isinstance(value, float):
        return _canonical_float(value)
    if isinstance(value, str):
        try:
            value.encode("utf-8")
        except UnicodeEncodeError as error:
            raise ValueError("JSON strings must contain Unicode scalar values") from error
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, (list, tuple)):
        return _canonical_sequence(value, active_containers=active_containers)
    if isinstance(value, dict):
        return _canonical_object(value, active_containers=active_containers)
    raise ValueError(
        "unsupported canonical JSON value; expected null, boolean, number, "
        "string, list, tuple, or object"
    )


def _canonical_sequence(
    value: object,
    *,
    active_containers: set[int],
) -> str:
    if not isinstance(value, (list, tuple)):
        raise ValueError("canonical JSON array must be a list or tuple")
    identity = id(value)
    if identity in active_containers:
        raise ValueError("canonical JSON value contains a cycle")
    active_containers.add(identity)
    try:
        return "[" + ",".join(
            _canonical_json_text(item, active_containers=active_containers)
            for item in value
        ) + "]"
    finally:
        active_containers.remove(identity)


def _canonical_object(
    value: dict[object, object],
    *,
    active_containers: set[int],
) -> str:
    identity = id(value)
    if identity in active_containers:
        raise ValueError("canonical JSON value contains a cycle")
    for key in value:
        if not isinstance(key, str):
            raise ValueError("canonical JSON object keys must be strings")
        try:
            key.encode("utf-8")
        except UnicodeEncodeError as error:
            raise ValueError(
                "JSON object keys must contain Unicode scalar values"
            ) from error

    active_containers.add(identity)
    try:
        ordered_keys = sorted(
            value,
            key=lambda key: key.encode("utf-16be"),
        )
        members = (
            json.dumps(key, ensure_ascii=False, separators=(",", ":"))
            + ":"
            + _canonical_json_text(
                value[key],
                active_containers=active_containers,
            )
            for key in ordered_keys
        )
        return "{" + ",".join(members) + "}"
    finally:
        active_containers.remove(identity)


def _canonical_float(value: float) -> str:
    if not math.isfinite(value):
        raise ValueError("canonical JSON numbers must be finite")
    if value == 0:
        return "0"

    absolute = abs(value)
    shortest = repr(value).lower()
    if 1e-6 <= absolute < 1e21:
        fixed = format(Decimal(shortest), "f")
        if "." in fixed:
            fixed = fixed.rstrip("0").rstrip(".")
        return fixed

    mantissa, exponent = shortest.split("e")
    if mantissa.endswith(".0"):
        mantissa = mantissa[:-2]
    exponent_value = int(exponent)
    exponent_text = f"+{exponent_value}" if exponent_value >= 0 else str(exponent_value)
    return f"{mantissa}e{exponent_text}"


def _validate_slug(value: object, *, field: str) -> str:
    if not isinstance(value, str) or _SLUG_PATTERN.fullmatch(value) is None:
        raise ValueError(
            f"{field} must match [A-Za-z0-9][A-Za-z0-9._-]{{0,127}}"
        )
    return value


def _validate_non_empty_utf8(
    value: object,
    *,
    field: str,
    maximum_bytes: int = 4096,
) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{field} must be a non-empty string")
    try:
        encoded = value.encode("utf-8")
    except UnicodeEncodeError as error:
        raise ValueError(f"{field} must contain valid UTF-8") from error
    if len(encoded) > maximum_bytes or any(
        ord(character) == 0 for character in value
    ):
        raise ValueError(f"{field} is not a bounded UTF-8 string")
    return value


def _canonical_utc_instant(value: object, *, field: str) -> datetime:
    text = _validate_non_empty_utf8(value, field=field, maximum_bytes=64)
    try:
        instant = datetime.fromisoformat(text)
    except ValueError as error:
        raise ValueError(f"{field} must be a canonical UTC timestamp") from error
    if (
        instant.tzinfo is None
        or instant.utcoffset() != timedelta(0)
        or instant.isoformat() != text
    ):
        raise ValueError(f"{field} must be a canonical UTC timestamp")
    return instant


def _validate_optional_non_empty_utf8(
    value: object,
    *,
    field: str,
    maximum_bytes: int = 4096,
) -> str | None:
    if value is None:
        return None
    return _validate_non_empty_utf8(
        value,
        field=field,
        maximum_bytes=maximum_bytes,
    )


def _validate_non_negative_integer(value: object, *, field: str) -> int:
    if (
        not isinstance(value, int)
        or isinstance(value, bool)
        or value < 0
        or value > _I_JSON_INTEGER_MAX
    ):
        raise ValueError(f"{field} must be a non-negative I-JSON integer")
    return value


def _validate_positive_integer(value: object, *, field: str) -> int:
    validated = _validate_non_negative_integer(value, field=field)
    if validated == 0:
        raise ValueError(f"{field} must be positive")
    return validated


def _validate_workspace_id(value: object) -> str:
    if not isinstance(value, str) or _WORKSPACE_ID_PATTERN.fullmatch(value) is None:
        raise ValueError("workspaceId must be 16 lowercase hex characters")
    return value


def _validate_run_id(value: object, *, field: str) -> str:
    if not isinstance(value, str) or _RUN_ID_PATTERN.fullmatch(value) is None:
        raise ValueError(f"{field} is not a canonical evidence run ID")
    return value


def _validate_optional_discriminator(value: object) -> str | None:
    if value is None:
        return None
    return _validate_non_empty_utf8(
        value,
        field="discriminator",
        maximum_bytes=256,
    )


def _validate_role_identity(
    value: object,
    *,
    field: str,
) -> tuple[str, str | None]:
    if not isinstance(value, tuple) or len(value) != 2:
        raise ValueError(f"{field} must be a (roleName, discriminator) tuple")
    return (
        _validate_role_name(value[0]),
        _validate_optional_discriminator(value[1]),
    )


def _role_identity_key(
    identity: tuple[str, str | None],
) -> tuple[bytes, int, bytes]:
    role_name, discriminator = identity
    return (
        role_name.encode("utf-8"),
        0 if discriminator is None else 1,
        b"" if discriminator is None else discriminator.encode("utf-8"),
    )


def _nullable_string_sort_key(value: str | None) -> bytes:
    return b"\x00" if value is None else b"\x01" + value.encode("utf-8")


def _validate_role_identities(
    value: object,
    *,
    field: str,
    allow_empty: bool,
) -> tuple[tuple[str, str | None], ...]:
    if not isinstance(value, tuple):
        raise ValueError(f"{field} must be an immutable tuple")
    validated = tuple(
        _validate_role_identity(item, field=field) for item in value
    )
    if not validated and not allow_empty:
        raise ValueError(f"{field} must not be empty")
    if len(set(validated)) != len(validated):
        raise ValueError(f"{field} contains duplicate role identities")
    if validated != tuple(sorted(validated, key=_role_identity_key)):
        raise ValueError(f"{field} must be in canonical lexical order")
    return validated


def _role_identities_to_wire(
    value: tuple[tuple[str, str | None], ...],
) -> list[list[str | None]]:
    return [[role_name, discriminator] for role_name, discriminator in value]


def _role_identities_from_wire(
    value: object,
    *,
    field: str,
) -> tuple[tuple[str, str | None], ...]:
    if not isinstance(value, list):
        raise ValueError(f"{field} must be an array")
    identities: list[tuple[str, str | None]] = []
    for item in value:
        if not isinstance(item, list) or len(item) != 2:
            raise ValueError(f"{field} entries must be two-element arrays")
        identities.append((item[0], item[1]))
    return tuple(identities)


def _enum_from_wire(enum_type: type[Enum], value: object, *, field: str) -> Enum:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    try:
        return enum_type(value)
    except ValueError as error:
        raise ValueError(f"{field} is not a closed enum value") from error


def _strict_json_value(canonical_bytes: bytes) -> object:
    try:
        text = canonical_bytes.decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise ValueError("canonicalUtf8Base64 must decode to valid UTF-8") from error

    def reject_duplicate_keys(
        pairs: list[tuple[str, object]],
    ) -> dict[str, object]:
        result: dict[str, object] = {}
        for key, item in pairs:
            if key in result:
                raise ValueError("opaque JSON contains a duplicate object key")
            result[key] = item
        return result

    try:
        value = json.loads(
            text,
            object_pairs_hook=reject_duplicate_keys,
            parse_constant=lambda token: (_ for _ in ()).throw(
                ValueError(f"opaque JSON contains invalid number {token}")
            ),
        )
    except (json.JSONDecodeError, UnicodeError) as error:
        raise ValueError("canonicalUtf8Base64 must contain JSON") from error
    if canonical_json_bytes(value) != canonical_bytes:
        raise ValueError("canonicalUtf8Base64 bytes are not RFC 8785 canonical")
    return value


def _validate_entrypoint(value: object) -> str:
    if (
        not isinstance(value, str)
        or len(value.encode("utf-8")) > REPO_RELATIVE_PATH_BYTE_LIMIT
        or _ENTRYPOINT_PATTERN.fullmatch(value) is None
    ):
        raise ValueError("entrypoint must be a bounded dotted Python name")
    return value


def _validate_role_name(value: object) -> str:
    if not isinstance(value, str) or not value or "\x00" in value:
        raise ValueError("evidence role name must be a non-empty string")
    try:
        encoded = value.encode("utf-8")
    except UnicodeEncodeError as error:
        raise ValueError("evidence role name must be valid UTF-8") from error
    if len(encoded) > 256:
        raise ValueError("evidence role name exceeds the 256-byte limit")
    return value


def _validate_lexical_tuple(
    value: object,
    *,
    field: str,
    item_validator: Any,
    allow_empty: bool,
) -> tuple[str, ...]:
    if not isinstance(value, tuple):
        raise ValueError(f"{field} must be an immutable tuple")
    if not value and not allow_empty:
        raise ValueError(f"{field} must not be empty")
    validated = tuple(item_validator(item) for item in value)
    if len(set(validated)) != len(validated):
        raise ValueError(f"{field} must contain unique values")
    if validated != tuple(sorted(validated, key=lambda item: item.encode("utf-8"))):
        raise ValueError(f"{field} must be in UTF-8 lexical order")
    return validated


def _validate_positive_bounded_integer(
    value: object,
    *,
    field: str,
    maximum: int,
) -> int:
    if (
        not isinstance(value, int)
        or isinstance(value, bool)
        or value <= 0
        or value > maximum
    ):
        raise ValueError(f"{field} must be an integer in 1..{maximum}")
    return value


def _validate_ordered_string_tuple(
    value: object,
    *,
    field: str,
) -> tuple[str, ...]:
    if not isinstance(value, tuple):
        raise ValueError(f"{field} must be an immutable tuple")
    return tuple(
        _validate_non_empty_utf8(item, field=field) for item in value
    )


def _validate_file_identity_tuple(
    value: object,
    *,
    field: str,
) -> tuple[tuple[str, str], ...]:
    if not isinstance(value, tuple) or not value:
        raise ValueError(f"{field} must be a non-empty immutable tuple")
    validated: list[tuple[str, str]] = []
    for item in value:
        if not isinstance(item, tuple) or len(item) != 2:
            raise ValueError(f"{field} entries must be immutable pairs")
        validated.append(
            (validate_repo_relative_path(item[0]), validate_sha256(item[1]))
        )
    result = tuple(validated)
    paths = tuple(path for path, _ in result)
    if len(set(paths)) != len(paths):
        raise ValueError(f"{field} contains duplicate paths")
    if paths != tuple(sorted(paths, key=lambda item: item.encode("utf-8"))):
        raise ValueError(f"{field} must be in UTF-8 lexical path order")
    return result


def _file_identity_tuple_from_wire(
    value: object,
    *,
    field: str,
) -> tuple[tuple[str, str], ...]:
    if not isinstance(value, list):
        raise ValueError(f"{field} must be an array")
    result: list[tuple[str, str]] = []
    for item in value:
        if not isinstance(item, list) or len(item) != 2:
            raise ValueError(f"{field} entries must be two-element arrays")
        result.append((item[0], item[1]))
    return tuple(result)


def _artifact_source_identity(reference: ArtifactRef) -> tuple[str, str, str]:
    return (reference.workspace_id, reference.gate_id, reference.run_id)


def _validate_ref_content(
    reference: object,
    *,
    field: str,
    sha256: str,
) -> ArtifactRef:
    if type(reference) is not ArtifactRef:
        raise ValueError(f"{field} must be an ArtifactRef")
    if reference.sha256 != sha256:
        raise ValueError(f"{field} sha256 does not match content identity")
    return reference


def _closed_mapping(
    value: object,
    *,
    schema: str,
    keys: frozenset[str],
) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{schema} must be an object")
    actual = frozenset(value.keys())
    if actual != keys:
        missing = sorted(keys - actual)
        unknown = sorted(
            (key for key in actual - keys),
            key=lambda key: str(key),
        )
        raise ValueError(
            f"{schema} fields mismatch; missing={missing}, unknown={unknown}"
        )
    return value


@dataclass(frozen=True)
class ArtifactRef:
    """Pure identity projection of Evidence Store's ArtifactRef."""

    workspace_id: str
    gate_id: str
    run_id: str
    path: str
    sha256: str
    media_type: str
    artifact_kind: str = "acceptance-artifact-ref"

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "artifactKind",
            "workspaceId",
            "gateId",
            "runId",
            "path",
            "sha256",
            "mediaType",
        }
    )

    def __post_init__(self) -> None:
        if self.artifact_kind != "acceptance-artifact-ref":
            raise ValueError("artifactKind must be acceptance-artifact-ref")
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gate ID")
        _validate_run_id(self.run_id, field="runId")
        validate_repo_relative_path(self.path)
        validate_sha256(self.sha256)
        _validate_non_empty_utf8(
            self.media_type,
            field="mediaType",
            maximum_bytes=256,
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind,
            "workspaceId": self.workspace_id,
            "gateId": self.gate_id,
            "runId": self.run_id,
            "path": self.path,
            "sha256": self.sha256,
            "mediaType": self.media_type,
        }

    @classmethod
    def from_dict(cls, value: object) -> "ArtifactRef":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            artifact_kind=data["artifactKind"],
            workspace_id=data["workspaceId"],
            gate_id=data["gateId"],
            run_id=data["runId"],
            path=data["path"],
            sha256=data["sha256"],
            media_type=data["mediaType"],
        )


def _artifact_ref_key(reference: ArtifactRef) -> bytes:
    return canonical_json_bytes(reference.to_dict())


@dataclass(frozen=True)
class CanonicalOpaqueJson:
    schema_id: str
    schema_digest: str
    byte_length: int
    canonical_utf8_base64: str
    content_digest: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "schemaId",
            "schemaDigest",
            "byteLength",
            "canonicalUtf8Base64",
            "contentDigest",
        }
    )

    def __post_init__(self) -> None:
        _validate_slug(self.schema_id, field="schemaId")
        validate_sha256(self.schema_digest)
        _validate_non_negative_integer(self.byte_length, field="byteLength")
        validate_sha256(self.content_digest)
        if not isinstance(self.canonical_utf8_base64, str):
            raise ValueError("canonicalUtf8Base64 must be a string")
        try:
            encoded = self.canonical_utf8_base64.encode("ascii")
            canonical_bytes = base64.b64decode(encoded, validate=True)
        except (UnicodeEncodeError, binascii.Error) as error:
            raise ValueError("canonicalUtf8Base64 is not canonical Base64") from error
        if base64.b64encode(canonical_bytes).decode("ascii") != self.canonical_utf8_base64:
            raise ValueError("canonicalUtf8Base64 is not canonical Base64")
        if len(canonical_bytes) != self.byte_length:
            raise ValueError("byteLength does not match decoded canonical JSON")
        if raw_sha256(canonical_bytes) != self.content_digest:
            raise ValueError("contentDigest does not match decoded canonical JSON")
        _strict_json_value(canonical_bytes)

    @classmethod
    def from_value(
        cls,
        *,
        schema_id: str,
        schema_digest: str,
        value: object,
    ) -> "CanonicalOpaqueJson":
        canonical_bytes = canonical_json_bytes(value)
        return cls(
            schema_id=schema_id,
            schema_digest=schema_digest,
            byte_length=len(canonical_bytes),
            canonical_utf8_base64=base64.b64encode(canonical_bytes).decode("ascii"),
            content_digest=raw_sha256(canonical_bytes),
        )

    def json_value(self) -> object:
        return _strict_json_value(
            base64.b64decode(self.canonical_utf8_base64.encode("ascii"))
        )

    def payload_digest(self) -> str:
        return domain_separated_sha256(_PAYLOAD_DOMAIN, self.json_value())

    def to_dict(self) -> dict[str, object]:
        return {
            "schemaId": self.schema_id,
            "schemaDigest": self.schema_digest,
            "byteLength": self.byte_length,
            "canonicalUtf8Base64": self.canonical_utf8_base64,
            "contentDigest": self.content_digest,
        }

    @classmethod
    def from_dict(cls, value: object) -> "CanonicalOpaqueJson":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            schema_id=data["schemaId"],
            schema_digest=data["schemaDigest"],
            byte_length=data["byteLength"],
            canonical_utf8_base64=data["canonicalUtf8Base64"],
            content_digest=data["contentDigest"],
        )


@dataclass(frozen=True)
class SnapshotArtifact:
    role_name: str
    discriminator: str | None
    ref: ArtifactRef
    payload: CanonicalOpaqueJson | None
    payload_digest: str | None

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {"roleName", "discriminator", "ref", "payload", "payloadDigest"}
    )

    def __post_init__(self) -> None:
        _validate_role_name(self.role_name)
        _validate_optional_discriminator(self.discriminator)
        if type(self.ref) is not ArtifactRef:
            raise ValueError("ref must be an ArtifactRef")
        if self.payload is None:
            if self.payload_digest is not None:
                raise ValueError("payloadDigest must be null when payload is null")
        else:
            if type(self.payload) is not CanonicalOpaqueJson:
                raise ValueError("payload must be CanonicalOpaqueJson or null")
            validate_sha256(self.payload_digest)
            if self.payload_digest != self.payload.payload_digest():
                raise ValueError("payloadDigest does not match payload")

    @property
    def identity(self) -> tuple[str, str | None]:
        return (self.role_name, self.discriminator)

    def to_dict(self) -> dict[str, object]:
        return {
            "roleName": self.role_name,
            "discriminator": self.discriminator,
            "ref": self.ref.to_dict(),
            "payload": None if self.payload is None else self.payload.to_dict(),
            "payloadDigest": self.payload_digest,
        }

    @classmethod
    def from_dict(cls, value: object) -> "SnapshotArtifact":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        payload = data["payload"]
        return cls(
            role_name=data["roleName"],
            discriminator=data["discriminator"],
            ref=ArtifactRef.from_dict(data["ref"]),
            payload=(
                None
                if payload is None
                else CanonicalOpaqueJson.from_dict(payload)
            ),
            payload_digest=data["payloadDigest"],
        )


@dataclass(frozen=True)
class ReadOnlyEvidenceSnapshot:
    workspace_id: str
    gate_id: str
    evidence_run_id: str
    snapshot_digest: str
    evaluation_time: str
    artifacts: tuple[SnapshotArtifact, ...]
    runtime_manifest_ref: ArtifactRef
    source_commit: str
    workspace_digest: str
    canonical_worktree_hash: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "workspaceId",
            "gateId",
            "evidenceRunId",
            "snapshotDigest",
            "evaluationTime",
            "artifacts",
            "runtimeManifestRef",
            "sourceCommit",
            "workspaceDigest",
            "canonicalWorktreeHash",
        }
    )

    def __post_init__(self) -> None:
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gate ID")
        _validate_run_id(self.evidence_run_id, field="evidenceRunId")
        validate_sha256(self.snapshot_digest)
        _canonical_utc_instant(
            self.evaluation_time,
            field="evaluationTime",
        )
        _validate_non_empty_utf8(self.source_commit, field="sourceCommit")
        _validate_non_empty_utf8(self.workspace_digest, field="workspaceDigest")
        validate_sha256(self.canonical_worktree_hash)
        if not isinstance(self.artifacts, tuple) or not self.artifacts:
            raise ValueError("artifacts must be a non-empty immutable tuple")
        if any(type(item) is not SnapshotArtifact for item in self.artifacts):
            raise ValueError("artifacts must contain SnapshotArtifact values")
        identities = tuple(item.identity for item in self.artifacts)
        if len(set(identities)) != len(identities):
            raise ValueError("artifacts contain duplicate role identities")
        if identities != tuple(sorted(identities, key=_role_identity_key)):
            raise ValueError("artifacts must be in canonical role identity order")
        if type(self.runtime_manifest_ref) is not ArtifactRef:
            raise ValueError("runtimeManifestRef must be an ArtifactRef")
        for reference in (
            *(artifact.ref for artifact in self.artifacts),
            self.runtime_manifest_ref,
        ):
            if (
                reference.workspace_id != self.workspace_id
                or reference.gate_id != self.gate_id
                or reference.run_id != self.evidence_run_id
            ):
                raise ValueError("ArtifactRef identity does not match snapshot")
        if self.runtime_manifest_ref not in tuple(
            artifact.ref for artifact in self.artifacts
        ):
            raise ValueError("runtimeManifestRef must belong to artifacts")
        if self.snapshot_digest != self.expected_digest():
            raise ValueError("snapshotDigest does not match snapshot")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "workspaceId": self.workspace_id,
            "gateId": self.gate_id,
            "evidenceRunId": self.evidence_run_id,
            "evaluationTime": self.evaluation_time,
            "artifacts": [artifact.to_dict() for artifact in self.artifacts],
            "runtimeManifestRef": self.runtime_manifest_ref.to_dict(),
            "sourceCommit": self.source_commit,
            "workspaceDigest": self.workspace_digest,
            "canonicalWorktreeHash": self.canonical_worktree_hash,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_SNAPSHOT_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "snapshotDigest": self.snapshot_digest}

    @classmethod
    def create(
        cls,
        *,
        workspace_id: str,
        gate_id: str,
        evidence_run_id: str,
        evaluation_time: str,
        artifacts: tuple[SnapshotArtifact, ...],
        runtime_manifest_ref: ArtifactRef,
        source_commit: str,
        workspace_digest: str,
        canonical_worktree_hash: str,
    ) -> "ReadOnlyEvidenceSnapshot":
        if (
            type(artifacts) is not tuple
            or any(type(item) is not SnapshotArtifact for item in artifacts)
            or type(runtime_manifest_ref) is not ArtifactRef
        ):
            raise ValueError(
                "snapshot inputs must use concrete contract types"
            )
        ordered = tuple(sorted(artifacts, key=lambda item: _role_identity_key(item.identity)))
        payload = {
            "workspaceId": workspace_id,
            "gateId": gate_id,
            "evidenceRunId": evidence_run_id,
            "evaluationTime": evaluation_time,
            "artifacts": [artifact.to_dict() for artifact in ordered],
            "runtimeManifestRef": runtime_manifest_ref.to_dict(),
            "sourceCommit": source_commit,
            "workspaceDigest": workspace_digest,
            "canonicalWorktreeHash": canonical_worktree_hash,
        }
        return cls(
            workspace_id=workspace_id,
            gate_id=gate_id,
            evidence_run_id=evidence_run_id,
            snapshot_digest=domain_separated_sha256(_SNAPSHOT_DOMAIN, payload),
            evaluation_time=evaluation_time,
            artifacts=ordered,
            runtime_manifest_ref=runtime_manifest_ref,
            source_commit=source_commit,
            workspace_digest=workspace_digest,
            canonical_worktree_hash=canonical_worktree_hash,
        )

    @classmethod
    def from_dict(cls, value: object) -> "ReadOnlyEvidenceSnapshot":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        artifacts = data["artifacts"]
        if not isinstance(artifacts, list):
            raise ValueError("ReadOnlyEvidenceSnapshot.artifacts must be an array")
        return cls(
            workspace_id=data["workspaceId"],
            gate_id=data["gateId"],
            evidence_run_id=data["evidenceRunId"],
            snapshot_digest=data["snapshotDigest"],
            evaluation_time=data["evaluationTime"],
            artifacts=tuple(SnapshotArtifact.from_dict(item) for item in artifacts),
            runtime_manifest_ref=ArtifactRef.from_dict(data["runtimeManifestRef"]),
            source_commit=data["sourceCommit"],
            workspace_digest=data["workspaceDigest"],
            canonical_worktree_hash=data["canonicalWorktreeHash"],
        )


@dataclass(frozen=True)
class PrimaryResultSourceTrace:
    producer_id: str
    source_commit: str
    invocation_id: str
    evidence_refs: tuple[ArtifactRef, ...]
    source_trace_digest: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "producerId",
            "sourceCommit",
            "invocationId",
            "evidenceRefs",
            "sourceTraceDigest",
        }
    )

    def __post_init__(self) -> None:
        _validate_slug(self.producer_id, field="producerId")
        _validate_non_empty_utf8(self.source_commit, field="sourceCommit")
        _validate_non_empty_utf8(self.invocation_id, field="invocationId")
        validate_sha256(self.source_trace_digest)
        if not isinstance(self.evidence_refs, tuple):
            raise ValueError("evidenceRefs must be an immutable tuple")
        if not self.evidence_refs:
            raise ValueError("evidenceRefs must be non-empty")
        if any(type(item) is not ArtifactRef for item in self.evidence_refs):
            raise ValueError("evidenceRefs must contain ArtifactRef values")
        keys = tuple(_artifact_ref_key(item) for item in self.evidence_refs)
        if len(set(keys)) != len(keys):
            raise ValueError("evidenceRefs must be unique")
        if keys != tuple(sorted(keys)):
            raise ValueError("evidenceRefs must be in UTF-8 lexical order")
        source_identities = {
            (item.workspace_id, item.gate_id, item.run_id)
            for item in self.evidence_refs
        }
        if len(source_identities) > 1:
            raise ValueError("evidenceRefs must share one run source tuple")
        if self.source_trace_digest != self.expected_digest():
            raise ValueError("sourceTraceDigest does not match source trace")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "producerId": self.producer_id,
            "sourceCommit": self.source_commit,
            "invocationId": self.invocation_id,
            "evidenceRefs": [item.to_dict() for item in self.evidence_refs],
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(
            _PRIMARY_RESULT_SOURCE_TRACE_DOMAIN,
            self._digest_payload(),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            **self._digest_payload(),
            "sourceTraceDigest": self.source_trace_digest,
        }

    @classmethod
    def create(
        cls,
        *,
        producer_id: str,
        source_commit: str,
        invocation_id: str,
        evidence_refs: tuple[ArtifactRef, ...],
    ) -> "PrimaryResultSourceTrace":
        ordered = tuple(sorted(evidence_refs, key=_artifact_ref_key))
        payload = {
            "producerId": producer_id,
            "sourceCommit": source_commit,
            "invocationId": invocation_id,
            "evidenceRefs": [item.to_dict() for item in ordered],
        }
        return cls(
            producer_id=producer_id,
            source_commit=source_commit,
            invocation_id=invocation_id,
            evidence_refs=ordered,
            source_trace_digest=domain_separated_sha256(
                _PRIMARY_RESULT_SOURCE_TRACE_DOMAIN,
                payload,
            ),
        )

    @classmethod
    def from_dict(cls, value: object) -> "PrimaryResultSourceTrace":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        evidence_refs = data["evidenceRefs"]
        if not isinstance(evidence_refs, list):
            raise ValueError("PrimaryResultSourceTrace.evidenceRefs must be an array")
        return cls(
            producer_id=data["producerId"],
            source_commit=data["sourceCommit"],
            invocation_id=data["invocationId"],
            evidence_refs=tuple(ArtifactRef.from_dict(item) for item in evidence_refs),
            source_trace_digest=data["sourceTraceDigest"],
        )


@dataclass(frozen=True)
class CanonicalPrimaryResult:
    document: CanonicalOpaqueJson
    result_tuple: CanonicalResultTuple
    reason_code: str | None
    source_trace: PrimaryResultSourceTrace

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {"document", "resultTuple", "reasonCode", "sourceTrace"}
    )

    def __post_init__(self) -> None:
        if type(self.document) is not CanonicalOpaqueJson:
            raise ValueError("document must be CanonicalOpaqueJson")
        if self.document.schema_id != "acceptance-primary-result-v1":
            raise ValueError(
                "document.schemaId must be acceptance-primary-result-v1"
            )
        if type(self.result_tuple) is not CanonicalResultTuple:
            raise ValueError("resultTuple must be a CanonicalResultTuple")
        _validate_optional_non_empty_utf8(
            self.reason_code,
            field="reasonCode",
            maximum_bytes=256,
        )
        if type(self.source_trace) is not PrimaryResultSourceTrace:
            raise ValueError("sourceTrace must be PrimaryResultSourceTrace")
        document_value = self.document.json_value()
        if not isinstance(document_value, dict):
            raise ValueError("primary result document must be an object")
        expected_projection = {
            **self.result_tuple.to_dict(),
            "reasonCode": self.reason_code,
            "sourceTrace": self.source_trace.to_dict(),
        }
        for field, expected in expected_projection.items():
            if document_value.get(field) != expected:
                raise ValueError(
                    f"primary result document {field} does not match projection"
                )

    def to_dict(self) -> dict[str, object]:
        return {
            "document": self.document.to_dict(),
            "resultTuple": self.result_tuple.to_dict(),
            "reasonCode": self.reason_code,
            "sourceTrace": self.source_trace.to_dict(),
        }

    def digest(self) -> str:
        return domain_separated_sha256(_PRIMARY_RESULT_DOMAIN, self.to_dict())

    @classmethod
    def from_dict(cls, value: object) -> "CanonicalPrimaryResult":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            document=CanonicalOpaqueJson.from_dict(data["document"]),
            result_tuple=CanonicalResultTuple.from_dict(data["resultTuple"]),
            reason_code=data["reasonCode"],
            source_trace=PrimaryResultSourceTrace.from_dict(data["sourceTrace"]),
        )


def _validate_outcome_identity(
    *,
    finalizer_id: object,
    invocation_digest: object,
    finalizer_input_digest: object,
    snapshot_digest: object,
    primary_result_digest: object,
) -> None:
    validate_finalizer_id(finalizer_id)
    validate_sha256(invocation_digest)
    validate_sha256(finalizer_input_digest)
    validate_sha256(snapshot_digest)
    validate_sha256(primary_result_digest)


@dataclass(frozen=True)
class FinalizerChildOutcome:
    status: FinalizerOutcomeStatus
    finalizer_id: str
    invocation_digest: str
    finalizer_input_digest: str
    snapshot_digest: str
    primary_result_digest: str
    child_outcome_digest: str
    validated_role_instances: tuple[tuple[str, str | None], ...]
    failure_code: FinalizerFailureCode | None
    diagnostic: str | None

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "status",
            "finalizerId",
            "invocationDigest",
            "finalizerInputDigest",
            "snapshotDigest",
            "primaryResultDigest",
            "childOutcomeDigest",
            "validatedRoleInstances",
            "failureCode",
            "diagnostic",
        }
    )

    def __post_init__(self) -> None:
        if self.status not in {
            FinalizerOutcomeStatus.VALIDATED,
            FinalizerOutcomeStatus.REJECTED,
            FinalizerOutcomeStatus.BLOCKED,
        }:
            raise ValueError("child status must be VALIDATED, REJECTED, or BLOCKED")
        _validate_outcome_identity(
            finalizer_id=self.finalizer_id,
            invocation_digest=self.invocation_digest,
            finalizer_input_digest=self.finalizer_input_digest,
            snapshot_digest=self.snapshot_digest,
            primary_result_digest=self.primary_result_digest,
        )
        roles = _validate_role_identities(
            self.validated_role_instances,
            field="validatedRoleInstances",
            allow_empty=self.status is not FinalizerOutcomeStatus.VALIDATED,
        )
        expected_failure = {
            FinalizerOutcomeStatus.VALIDATED: None,
            FinalizerOutcomeStatus.REJECTED: FinalizerFailureCode.REJECTED,
            FinalizerOutcomeStatus.BLOCKED: FinalizerFailureCode.BLOCKED,
        }[self.status]
        if self.failure_code is not expected_failure:
            raise ValueError("failureCode does not match child status")
        if self.status is FinalizerOutcomeStatus.VALIDATED:
            if self.diagnostic is not None:
                raise ValueError("VALIDATED child outcome forbids diagnostic")
        else:
            if roles:
                raise ValueError("non-VALIDATED child outcome forbids roles")
            _validate_non_empty_utf8(
                self.diagnostic,
                field="diagnostic",
                maximum_bytes=4096,
            )
        validate_sha256(self.child_outcome_digest)
        if self.child_outcome_digest != self.expected_digest():
            raise ValueError("childOutcomeDigest does not match child outcome")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "status": self.status.value,
            "finalizerId": self.finalizer_id,
            "invocationDigest": self.invocation_digest,
            "finalizerInputDigest": self.finalizer_input_digest,
            "snapshotDigest": self.snapshot_digest,
            "primaryResultDigest": self.primary_result_digest,
            "validatedRoleInstances": _role_identities_to_wire(
                self.validated_role_instances
            ),
            "failureCode": (
                None if self.failure_code is None else self.failure_code.value
            ),
            "diagnostic": self.diagnostic,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(
            _CHILD_OUTCOME_DOMAIN,
            self._digest_payload(),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            **self._digest_payload(),
            "childOutcomeDigest": self.child_outcome_digest,
        }

    @classmethod
    def from_dict(cls, value: object) -> "FinalizerChildOutcome":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        failure_code = data["failureCode"]
        return cls(
            status=_enum_from_wire(
                FinalizerOutcomeStatus,
                data["status"],
                field="status",
            ),
            finalizer_id=data["finalizerId"],
            invocation_digest=data["invocationDigest"],
            finalizer_input_digest=data["finalizerInputDigest"],
            snapshot_digest=data["snapshotDigest"],
            primary_result_digest=data["primaryResultDigest"],
            child_outcome_digest=data["childOutcomeDigest"],
            validated_role_instances=_role_identities_from_wire(
                data["validatedRoleInstances"],
                field="validatedRoleInstances",
            ),
            failure_code=(
                None
                if failure_code is None
                else _enum_from_wire(
                    FinalizerFailureCode,
                    failure_code,
                    field="failureCode",
                )
            ),
            diagnostic=data["diagnostic"],
        )


@dataclass(frozen=True)
class ChildGateEvidenceFinalization:
    origin: FinalizationOrigin
    child_outcome: FinalizerChildOutcome
    outcome_digest: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {"origin", "childOutcome", "outcomeDigest"}
    )

    def __post_init__(self) -> None:
        if self.origin is not FinalizationOrigin.CHILD:
            raise ValueError("child finalization origin must be CHILD")
        if type(self.child_outcome) is not FinalizerChildOutcome:
            raise ValueError("childOutcome must be FinalizerChildOutcome")
        validate_sha256(self.outcome_digest)
        if self.outcome_digest != self.expected_digest():
            raise ValueError("outcomeDigest does not match child finalization")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "origin": self.origin.value,
            "childOutcome": self.child_outcome.to_dict(),
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_OUTCOME_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "outcomeDigest": self.outcome_digest}

    @classmethod
    def from_dict(cls, value: object) -> "ChildGateEvidenceFinalization":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            origin=_enum_from_wire(
                FinalizationOrigin,
                data["origin"],
                field="origin",
            ),
            child_outcome=FinalizerChildOutcome.from_dict(data["childOutcome"]),
            outcome_digest=data["outcomeDigest"],
        )


_CORE_ERROR_FAILURE_CODES = frozenset(
    code
    for code in FinalizerFailureCode
    if code.value.startswith("FINALIZER_")
    and code
    not in {
        FinalizerFailureCode.REJECTED,
        FinalizerFailureCode.BLOCKED,
        FinalizerFailureCode.TIMED_OUT,
    }
)


@dataclass(frozen=True)
class CoreGateEvidenceFinalization:
    origin: FinalizationOrigin
    status: FinalizerOutcomeStatus
    child_outcome: None
    finalizer_id: str
    invocation_digest: str
    finalizer_input_digest: str
    snapshot_digest: str
    primary_result_digest: str
    outcome_digest: str
    validated_role_instances: tuple[tuple[str, str | None], ...]
    failure_code: FinalizerFailureCode
    diagnostic: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "origin",
            "status",
            "childOutcome",
            "finalizerId",
            "invocationDigest",
            "finalizerInputDigest",
            "snapshotDigest",
            "primaryResultDigest",
            "outcomeDigest",
            "validatedRoleInstances",
            "failureCode",
            "diagnostic",
        }
    )

    def __post_init__(self) -> None:
        if self.origin is not FinalizationOrigin.CORE:
            raise ValueError("core finalization origin must be CORE")
        if self.status not in {
            FinalizerOutcomeStatus.TIMED_OUT,
            FinalizerOutcomeStatus.ERROR,
        }:
            raise ValueError("core status must be TIMED_OUT or ERROR")
        if self.child_outcome is not None:
            raise ValueError("core childOutcome must be null")
        _validate_outcome_identity(
            finalizer_id=self.finalizer_id,
            invocation_digest=self.invocation_digest,
            finalizer_input_digest=self.finalizer_input_digest,
            snapshot_digest=self.snapshot_digest,
            primary_result_digest=self.primary_result_digest,
        )
        roles = _validate_role_identities(
            self.validated_role_instances,
            field="validatedRoleInstances",
            allow_empty=True,
        )
        if roles:
            raise ValueError("core validatedRoleInstances must be empty")
        if self.status is FinalizerOutcomeStatus.TIMED_OUT:
            if self.failure_code is not FinalizerFailureCode.TIMED_OUT:
                raise ValueError("TIMED_OUT requires FINALIZER_TIMED_OUT")
        elif self.failure_code not in _CORE_ERROR_FAILURE_CODES:
            raise ValueError("ERROR requires a Core-owned failure code")
        _validate_non_empty_utf8(
            self.diagnostic,
            field="diagnostic",
            maximum_bytes=4096,
        )
        validate_sha256(self.outcome_digest)
        if self.outcome_digest != self.expected_digest():
            raise ValueError("outcomeDigest does not match core finalization")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "origin": self.origin.value,
            "status": self.status.value,
            "childOutcome": None,
            "finalizerId": self.finalizer_id,
            "invocationDigest": self.invocation_digest,
            "finalizerInputDigest": self.finalizer_input_digest,
            "snapshotDigest": self.snapshot_digest,
            "primaryResultDigest": self.primary_result_digest,
            "validatedRoleInstances": [],
            "failureCode": self.failure_code.value,
            "diagnostic": self.diagnostic,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_OUTCOME_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "outcomeDigest": self.outcome_digest}

    @classmethod
    def from_dict(cls, value: object) -> "CoreGateEvidenceFinalization":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            origin=_enum_from_wire(
                FinalizationOrigin,
                data["origin"],
                field="origin",
            ),
            status=_enum_from_wire(
                FinalizerOutcomeStatus,
                data["status"],
                field="status",
            ),
            child_outcome=data["childOutcome"],
            finalizer_id=data["finalizerId"],
            invocation_digest=data["invocationDigest"],
            finalizer_input_digest=data["finalizerInputDigest"],
            snapshot_digest=data["snapshotDigest"],
            primary_result_digest=data["primaryResultDigest"],
            outcome_digest=data["outcomeDigest"],
            validated_role_instances=_role_identities_from_wire(
                data["validatedRoleInstances"],
                field="validatedRoleInstances",
            ),
            failure_code=_enum_from_wire(
                FinalizerFailureCode,
                data["failureCode"],
                field="failureCode",
            ),
            diagnostic=data["diagnostic"],
        )


GateEvidenceFinalization = Union[
    ChildGateEvidenceFinalization,
    CoreGateEvidenceFinalization,
]


def gate_evidence_finalization_from_dict(
    value: object,
) -> GateEvidenceFinalization:
    if not isinstance(value, Mapping):
        raise ValueError("GateEvidenceFinalization must be an object")
    origin = value.get("origin")
    if origin == FinalizationOrigin.CHILD.value:
        return ChildGateEvidenceFinalization.from_dict(value)
    if origin == FinalizationOrigin.CORE.value:
        return CoreGateEvidenceFinalization.from_dict(value)
    raise ValueError("GateEvidenceFinalization origin is not closed")


@dataclass(frozen=True)
class EvidenceFinalizationRecord:
    artifact_kind: str
    schema_version: int
    state: EvidenceFinalizationState
    enforcement_generation: int | None
    enforcement_digest: str | None
    requirement_digest: str | None
    config_digest: str | None
    source_digest: str | None
    seal_digest: str | None
    primary_result: CanonicalPrimaryResult | None
    primary_result_digest: str | None
    failure_code: FinalizerFailureCode | None
    outcome: GateEvidenceFinalization | None

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "artifactKind",
            "schemaVersion",
            "state",
            "enforcementGeneration",
            "enforcementDigest",
            "requirementDigest",
            "configDigest",
            "sourceDigest",
            "sealDigest",
            "primaryResult",
            "primaryResultDigest",
            "failureCode",
            "outcome",
        }
    )

    def __post_init__(self) -> None:
        if self.artifact_kind != "acceptance-evidence-finalization":
            raise ValueError(
                "artifactKind must be acceptance-evidence-finalization"
            )
        if self.schema_version != 1 or isinstance(self.schema_version, bool):
            raise ValueError("schemaVersion must be 1")
        if type(self.state) is not EvidenceFinalizationState:
            raise ValueError("state must be a closed finalization state")
        if self.state is EvidenceFinalizationState.NOT_REQUIRED:
            nullable = (
                self.enforcement_generation,
                self.enforcement_digest,
                self.requirement_digest,
                self.config_digest,
                self.source_digest,
                self.seal_digest,
                self.primary_result,
                self.primary_result_digest,
                self.failure_code,
                self.outcome,
            )
            if any(item is not None for item in nullable):
                raise ValueError("NOT_REQUIRED requires every branch field null")
            return

        _validate_positive_integer(
            self.enforcement_generation,
            field="enforcementGeneration",
        )
        for field, value in (
            ("enforcementDigest", self.enforcement_digest),
            ("requirementDigest", self.requirement_digest),
            ("configDigest", self.config_digest),
            ("sourceDigest", self.source_digest),
        ):
            try:
                validate_sha256(value)
            except ValueError as error:
                raise ValueError(f"{field} must be a SHA-256 digest") from error
        if type(self.primary_result) is not CanonicalPrimaryResult:
            raise ValueError("primaryResult must be CanonicalPrimaryResult")
        validate_sha256(self.primary_result_digest)
        if self.primary_result_digest != self.primary_result.digest():
            raise ValueError("primaryResultDigest does not match primaryResult")

        if self.state is EvidenceFinalizationState.NOT_INVOKED_PRE_SEAL:
            if self.seal_digest is not None:
                raise ValueError("NOT_INVOKED_PRE_SEAL requires null sealDigest")
            if self.failure_code is not FinalizerFailureCode.NOT_INVOKED_PRE_SEAL:
                raise ValueError(
                    "NOT_INVOKED_PRE_SEAL requires its exact failure code"
                )
            if self.outcome is not None:
                raise ValueError("NOT_INVOKED_PRE_SEAL requires null outcome")
            return

        validate_sha256(self.seal_digest)
        if self.failure_code is not None:
            raise ValueError("COMPLETED requires null failureCode")
        if type(self.outcome) not in (
            ChildGateEvidenceFinalization,
            CoreGateEvidenceFinalization,
        ):
            raise ValueError("COMPLETED requires GateEvidenceFinalization")
        outcome_primary_result_digest = (
            self.outcome.child_outcome.primary_result_digest
            if type(self.outcome) is ChildGateEvidenceFinalization
            else self.outcome.primary_result_digest
        )
        if outcome_primary_result_digest != self.primary_result_digest:
            raise ValueError("outcome primaryResultDigest does not match record")

    def published_result_tuple(self) -> CanonicalResultTuple:
        if self.state is EvidenceFinalizationState.NOT_REQUIRED:
            raise ValueError("NOT_REQUIRED does not carry a primary result")
        outcome_status = None if self.outcome is None else (
            self.outcome.child_outcome.status
            if type(self.outcome) is ChildGateEvidenceFinalization
            else self.outcome.status
        )
        return merge_finalizer_outcome(
            self.primary_result.result_tuple,
            outcome_status,
            finalizer_required=True,
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind,
            "schemaVersion": self.schema_version,
            "state": self.state.value,
            "enforcementGeneration": self.enforcement_generation,
            "enforcementDigest": self.enforcement_digest,
            "requirementDigest": self.requirement_digest,
            "configDigest": self.config_digest,
            "sourceDigest": self.source_digest,
            "sealDigest": self.seal_digest,
            "primaryResult": (
                None
                if self.primary_result is None
                else self.primary_result.to_dict()
            ),
            "primaryResultDigest": self.primary_result_digest,
            "failureCode": (
                None if self.failure_code is None else self.failure_code.value
            ),
            "outcome": None if self.outcome is None else self.outcome.to_dict(),
        }

    @classmethod
    def from_dict(cls, value: object) -> "EvidenceFinalizationRecord":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        primary_result = data["primaryResult"]
        failure_code = data["failureCode"]
        outcome = data["outcome"]
        return cls(
            artifact_kind=data["artifactKind"],
            schema_version=data["schemaVersion"],
            state=_enum_from_wire(
                EvidenceFinalizationState,
                data["state"],
                field="state",
            ),
            enforcement_generation=data["enforcementGeneration"],
            enforcement_digest=data["enforcementDigest"],
            requirement_digest=data["requirementDigest"],
            config_digest=data["configDigest"],
            source_digest=data["sourceDigest"],
            seal_digest=data["sealDigest"],
            primary_result=(
                None
                if primary_result is None
                else CanonicalPrimaryResult.from_dict(primary_result)
            ),
            primary_result_digest=data["primaryResultDigest"],
            failure_code=(
                None
                if failure_code is None
                else _enum_from_wire(
                    FinalizerFailureCode,
                    failure_code,
                    field="failureCode",
                )
            ),
            outcome=(
                None
                if outcome is None
                else gate_evidence_finalization_from_dict(outcome)
            ),
        )


@dataclass(frozen=True)
class RequiredFinalizerMapping:
    __slots__ = ("gate_id", "finalizer_id")

    gate_id: str
    finalizer_id: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {"gateId", "finalizerId"}
    )

    def __post_init__(self) -> None:
        _validate_slug(self.gate_id, field="gate ID")
        validate_finalizer_id(self.finalizer_id)

    def to_dict(self) -> dict[str, object]:
        return {"gateId": self.gate_id, "finalizerId": self.finalizer_id}

    @classmethod
    def from_dict(cls, value: object) -> "RequiredFinalizerMapping":
        data = _closed_mapping(
            value,
            schema=cls.__name__,
            keys=cls._WIRE_KEYS,
        )
        return cls(gate_id=data["gateId"], finalizer_id=data["finalizerId"])


@dataclass(frozen=True)
class FinalizerRequirement:
    __slots__ = (
        "gate_id",
        "finalizer_id",
        "finalizer_registry_path",
        "protected_baseline_path",
        "protected_baseline_digest",
        "protected_baseline_file_sha256",
    )

    gate_id: str
    finalizer_id: str
    finalizer_registry_path: str
    protected_baseline_path: str
    protected_baseline_digest: str
    protected_baseline_file_sha256: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "gateId",
            "finalizerId",
            "finalizerRegistryPath",
            "protectedBaselinePath",
            "protectedBaselineDigest",
            "protectedBaselineFileSha256",
        }
    )

    def __post_init__(self) -> None:
        _validate_slug(self.gate_id, field="gate ID")
        validate_finalizer_id(self.finalizer_id)
        validate_repo_relative_path(self.finalizer_registry_path)
        validate_repo_relative_path(self.protected_baseline_path)
        validate_sha256(self.protected_baseline_digest)
        validate_sha256(self.protected_baseline_file_sha256)

    def to_dict(self) -> dict[str, object]:
        return {
            "gateId": self.gate_id,
            "finalizerId": self.finalizer_id,
            "finalizerRegistryPath": self.finalizer_registry_path,
            "protectedBaselinePath": self.protected_baseline_path,
            "protectedBaselineDigest": self.protected_baseline_digest,
            "protectedBaselineFileSha256": self.protected_baseline_file_sha256,
        }

    def digest(self) -> str:
        return domain_separated_sha256(_REQUIREMENT_DOMAIN, self.to_dict())

    def requirement_mapping_digest(self) -> str:
        return domain_separated_sha256(
            _REQUIREMENT_MAPPING_DOMAIN,
            {
                "gateId": self.gate_id,
                "finalizerId": self.finalizer_id,
                "finalizerRegistryPath": self.finalizer_registry_path,
                "protectedBaselinePath": self.protected_baseline_path,
            },
        )

    @classmethod
    def from_dict(cls, value: object) -> "FinalizerRequirement":
        data = _closed_mapping(
            value,
            schema=cls.__name__,
            keys=cls._WIRE_KEYS,
        )
        return cls(
            gate_id=data["gateId"],
            finalizer_id=data["finalizerId"],
            finalizer_registry_path=data["finalizerRegistryPath"],
            protected_baseline_path=data["protectedBaselinePath"],
            protected_baseline_digest=data["protectedBaselineDigest"],
            protected_baseline_file_sha256=data[
                "protectedBaselineFileSha256"
            ],
        )


@dataclass(frozen=True)
class FinalizerExecutionConfig:
    __slots__ = (
        "gate_id",
        "finalizer_id",
        "timeout_seconds",
        "input_byte_limit",
    )

    gate_id: str
    finalizer_id: str
    timeout_seconds: int
    input_byte_limit: int

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {"gateId", "finalizerId", "timeoutSeconds", "inputByteLimit"}
    )

    def __post_init__(self) -> None:
        _validate_slug(self.gate_id, field="gate ID")
        validate_finalizer_id(self.finalizer_id)
        _validate_positive_bounded_integer(
            self.timeout_seconds,
            field="timeoutSeconds",
            maximum=FINALIZER_TIMEOUT_SECONDS_MAX,
        )
        _validate_positive_bounded_integer(
            self.input_byte_limit,
            field="inputByteLimit",
            maximum=FINALIZER_INPUT_BYTE_LIMIT_MAX,
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "gateId": self.gate_id,
            "finalizerId": self.finalizer_id,
            "timeoutSeconds": self.timeout_seconds,
            "inputByteLimit": self.input_byte_limit,
        }

    def digest(self) -> str:
        return domain_separated_sha256(_CONFIG_DOMAIN, self.to_dict())

    @classmethod
    def from_dict(cls, value: object) -> "FinalizerExecutionConfig":
        data = _closed_mapping(
            value,
            schema=cls.__name__,
            keys=cls._WIRE_KEYS,
        )
        return cls(
            gate_id=data["gateId"],
            finalizer_id=data["finalizerId"],
            timeout_seconds=data["timeoutSeconds"],
            input_byte_limit=data["inputByteLimit"],
        )


@dataclass(frozen=True)
class FinalizerRegistryEntry:
    __slots__ = (
        "finalizer_id",
        "entrypoint",
        "source_paths",
        "source_digest",
        "contract_role_projection_digest",
        "evidence_role_names",
    )

    finalizer_id: str
    entrypoint: str
    source_paths: tuple[str, ...]
    source_digest: str
    contract_role_projection_digest: str
    evidence_role_names: tuple[str, ...]

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "finalizerId",
            "entrypoint",
            "sourcePaths",
            "sourceDigest",
            "contractRoleProjectionDigest",
            "evidenceRoleNames",
        }
    )

    def __post_init__(self) -> None:
        validate_finalizer_id(self.finalizer_id)
        _validate_entrypoint(self.entrypoint)
        _validate_lexical_tuple(
            self.source_paths,
            field="sourcePaths",
            item_validator=validate_repo_relative_path,
            allow_empty=False,
        )
        validate_sha256(self.source_digest)
        validate_sha256(self.contract_role_projection_digest)
        _validate_lexical_tuple(
            self.evidence_role_names,
            field="evidenceRoleNames",
            item_validator=_validate_role_name,
            allow_empty=True,
        )
        if (
            self.contract_role_projection_digest
            != self.expected_contract_role_projection_digest()
        ):
            raise ValueError("contractRoleProjectionDigest does not match roles")

    def to_dict(self) -> dict[str, object]:
        return {
            "finalizerId": self.finalizer_id,
            "entrypoint": self.entrypoint,
            "sourcePaths": list(self.source_paths),
            "sourceDigest": self.source_digest,
            "contractRoleProjectionDigest": (
                self.contract_role_projection_digest
            ),
            "evidenceRoleNames": list(self.evidence_role_names),
        }

    def expected_contract_role_projection_digest(self) -> str:
        return domain_separated_sha256(
            _CONTRACT_ROLE_PROJECTION_DOMAIN,
            {
                "finalizerId": self.finalizer_id,
                "evidenceRoleNames": self.evidence_role_names,
            },
        )

    @classmethod
    def from_dict(cls, value: object) -> "FinalizerRegistryEntry":
        data = _closed_mapping(
            value,
            schema=cls.__name__,
            keys=cls._WIRE_KEYS,
        )
        source_paths = data["sourcePaths"]
        evidence_role_names = data["evidenceRoleNames"]
        if not isinstance(source_paths, list):
            raise ValueError("FinalizerRegistryEntry.sourcePaths must be an array")
        if not isinstance(evidence_role_names, list):
            raise ValueError(
                "FinalizerRegistryEntry.evidenceRoleNames must be an array"
            )
        return cls(
            finalizer_id=data["finalizerId"],
            entrypoint=data["entrypoint"],
            source_paths=tuple(source_paths),
            source_digest=data["sourceDigest"],
            contract_role_projection_digest=data[
                "contractRoleProjectionDigest"
            ],
            evidence_role_names=tuple(evidence_role_names),
        )


@dataclass(frozen=True)
class FinalizerProtectedBaseline:
    __slots__ = (
        "gate_id",
        "finalizer_id",
        "requirement_mapping_digest",
        "registry_file_path",
        "registry_file_digest",
        "contract_schema_path",
        "contract_schema_digest",
        "entrypoint_source_path",
        "entrypoint_source_digest",
        "generator_source_path",
        "generator_source_digest",
    )

    gate_id: str
    finalizer_id: str
    requirement_mapping_digest: str
    registry_file_path: str
    registry_file_digest: str
    contract_schema_path: str
    contract_schema_digest: str
    entrypoint_source_path: str
    entrypoint_source_digest: str
    generator_source_path: str
    generator_source_digest: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "gateId",
            "finalizerId",
            "requirementMappingDigest",
            "registryFilePath",
            "registryFileDigest",
            "contractSchemaPath",
            "contractSchemaDigest",
            "entrypointSourcePath",
            "entrypointSourceDigest",
            "generatorSourcePath",
            "generatorSourceDigest",
        }
    )

    def __post_init__(self) -> None:
        _validate_slug(self.gate_id, field="gate ID")
        validate_finalizer_id(self.finalizer_id)
        validate_sha256(self.requirement_mapping_digest)
        validate_repo_relative_path(self.registry_file_path)
        validate_sha256(self.registry_file_digest)
        validate_repo_relative_path(self.contract_schema_path)
        validate_sha256(self.contract_schema_digest)
        validate_repo_relative_path(self.entrypoint_source_path)
        validate_sha256(self.entrypoint_source_digest)
        validate_repo_relative_path(self.generator_source_path)
        validate_sha256(self.generator_source_digest)

    def to_dict(self) -> dict[str, object]:
        return {
            "gateId": self.gate_id,
            "finalizerId": self.finalizer_id,
            "requirementMappingDigest": self.requirement_mapping_digest,
            "registryFilePath": self.registry_file_path,
            "registryFileDigest": self.registry_file_digest,
            "contractSchemaPath": self.contract_schema_path,
            "contractSchemaDigest": self.contract_schema_digest,
            "entrypointSourcePath": self.entrypoint_source_path,
            "entrypointSourceDigest": self.entrypoint_source_digest,
            "generatorSourcePath": self.generator_source_path,
            "generatorSourceDigest": self.generator_source_digest,
        }

    def digest(self) -> str:
        return domain_separated_sha256(
            _PROTECTED_BASELINE_DOMAIN,
            self.to_dict(),
        )

    @classmethod
    def from_dict(cls, value: object) -> "FinalizerProtectedBaseline":
        data = _closed_mapping(
            value,
            schema=cls.__name__,
            keys=cls._WIRE_KEYS,
        )
        return cls(
            gate_id=data["gateId"],
            finalizer_id=data["finalizerId"],
            requirement_mapping_digest=data["requirementMappingDigest"],
            registry_file_path=data["registryFilePath"],
            registry_file_digest=data["registryFileDigest"],
            contract_schema_path=data["contractSchemaPath"],
            contract_schema_digest=data["contractSchemaDigest"],
            entrypoint_source_path=data["entrypointSourcePath"],
            entrypoint_source_digest=data["entrypointSourceDigest"],
            generator_source_path=data["generatorSourcePath"],
            generator_source_digest=data["generatorSourceDigest"],
        )


@dataclass(frozen=True)
class FinalizerExecutableArtifact:
    ref: ArtifactRef
    bundle_format: str
    bundle_digest: str
    files: tuple[tuple[str, str], ...]
    source_digest: str
    core_bootstrap_source_digest: str
    entrypoint: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "ref",
            "bundleFormat",
            "bundleDigest",
            "files",
            "sourceDigest",
            "coreBootstrapSourceDigest",
            "entrypoint",
        }
    )

    def __post_init__(self) -> None:
        if self.bundle_format != "pt-finalizer-bundle-v1":
            raise ValueError("bundleFormat must be pt-finalizer-bundle-v1")
        validate_sha256(self.bundle_digest)
        _validate_ref_content(
            self.ref,
            field="ref",
            sha256=self.bundle_digest,
        )
        _validate_file_identity_tuple(self.files, field="files")
        validate_sha256(self.source_digest)
        validate_sha256(self.core_bootstrap_source_digest)
        _validate_entrypoint(self.entrypoint)

    def to_dict(self) -> dict[str, object]:
        return {
            "ref": self.ref.to_dict(),
            "bundleFormat": self.bundle_format,
            "bundleDigest": self.bundle_digest,
            "files": [list(item) for item in self.files],
            "sourceDigest": self.source_digest,
            "coreBootstrapSourceDigest": self.core_bootstrap_source_digest,
            "entrypoint": self.entrypoint,
        }

    @classmethod
    def create(
        cls,
        *,
        ref: ArtifactRef,
        files: tuple[tuple[str, str], ...],
        source_digest: str,
        core_bootstrap_source_digest: str,
        entrypoint: str,
    ) -> "FinalizerExecutableArtifact":
        return cls(
            ref=ref,
            bundle_format="pt-finalizer-bundle-v1",
            bundle_digest=ref.sha256,
            files=files,
            source_digest=source_digest,
            core_bootstrap_source_digest=core_bootstrap_source_digest,
            entrypoint=entrypoint,
        )

    @classmethod
    def from_dict(cls, value: object) -> "FinalizerExecutableArtifact":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            ref=ArtifactRef.from_dict(data["ref"]),
            bundle_format=data["bundleFormat"],
            bundle_digest=data["bundleDigest"],
            files=_file_identity_tuple_from_wire(data["files"], field="files"),
            source_digest=data["sourceDigest"],
            core_bootstrap_source_digest=data["coreBootstrapSourceDigest"],
            entrypoint=data["entrypoint"],
        )


@dataclass(frozen=True)
class SupervisorBuildIdentity:
    compiler_executable_path_hash: str
    compiler_binary_sha256: str
    compiler_binary_ref: ArtifactRef
    compiler_version: str
    target_triple: str
    compiler_flags: tuple[str, ...]
    compiler_flags_digest: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "compilerExecutablePathHash",
            "compilerBinarySha256",
            "compilerBinaryRef",
            "compilerVersion",
            "targetTriple",
            "compilerFlags",
            "compilerFlagsDigest",
        }
    )

    def __post_init__(self) -> None:
        validate_sha256(self.compiler_executable_path_hash)
        validate_sha256(self.compiler_binary_sha256)
        _validate_ref_content(
            self.compiler_binary_ref,
            field="compilerBinaryRef",
            sha256=self.compiler_binary_sha256,
        )
        _validate_non_empty_utf8(
            self.compiler_version,
            field="compilerVersion",
        )
        _validate_non_empty_utf8(self.target_triple, field="targetTriple")
        _validate_ordered_string_tuple(
            self.compiler_flags,
            field="compilerFlags",
        )
        validate_sha256(self.compiler_flags_digest)
        if self.compiler_flags_digest != self.expected_compiler_flags_digest():
            raise ValueError("compilerFlagsDigest does not match compilerFlags")

    def expected_compiler_flags_digest(self) -> str:
        return domain_separated_sha256(
            _COMPILER_FLAGS_DOMAIN,
            list(self.compiler_flags),
        )

    def without_artifact_ref_dict(self) -> dict[str, object]:
        return {
            "compilerExecutablePathHash": self.compiler_executable_path_hash,
            "compilerBinarySha256": self.compiler_binary_sha256,
            "compilerVersion": self.compiler_version,
            "targetTriple": self.target_triple,
            "compilerFlags": list(self.compiler_flags),
            "compilerFlagsDigest": self.compiler_flags_digest,
        }

    def to_dict(self) -> dict[str, object]:
        return {
            "compilerExecutablePathHash": self.compiler_executable_path_hash,
            "compilerBinarySha256": self.compiler_binary_sha256,
            "compilerBinaryRef": self.compiler_binary_ref.to_dict(),
            "compilerVersion": self.compiler_version,
            "targetTriple": self.target_triple,
            "compilerFlags": list(self.compiler_flags),
            "compilerFlagsDigest": self.compiler_flags_digest,
        }

    @classmethod
    def create(
        cls,
        *,
        compiler_executable_path_hash: str,
        compiler_binary_sha256: str,
        compiler_binary_ref: ArtifactRef,
        compiler_version: str,
        target_triple: str,
        compiler_flags: tuple[str, ...],
    ) -> "SupervisorBuildIdentity":
        return cls(
            compiler_executable_path_hash=compiler_executable_path_hash,
            compiler_binary_sha256=compiler_binary_sha256,
            compiler_binary_ref=compiler_binary_ref,
            compiler_version=compiler_version,
            target_triple=target_triple,
            compiler_flags=compiler_flags,
            compiler_flags_digest=domain_separated_sha256(
                _COMPILER_FLAGS_DOMAIN,
                list(compiler_flags),
            ),
        )

    @classmethod
    def from_dict(cls, value: object) -> "SupervisorBuildIdentity":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        compiler_flags = data["compilerFlags"]
        if not isinstance(compiler_flags, list):
            raise ValueError("compilerFlags must be an array")
        return cls(
            compiler_executable_path_hash=data["compilerExecutablePathHash"],
            compiler_binary_sha256=data["compilerBinarySha256"],
            compiler_binary_ref=ArtifactRef.from_dict(data["compilerBinaryRef"]),
            compiler_version=data["compilerVersion"],
            target_triple=data["targetTriple"],
            compiler_flags=tuple(compiler_flags),
            compiler_flags_digest=data["compilerFlagsDigest"],
        )


@dataclass(frozen=True)
class PreflightSupervisorBuildIdentity:
    compiler_executable_path_hash: str
    compiler_binary_sha256: str
    compiler_version: str
    target_triple: str
    compiler_flags: tuple[str, ...]
    compiler_flags_digest: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "compilerExecutablePathHash",
            "compilerBinarySha256",
            "compilerVersion",
            "targetTriple",
            "compilerFlags",
            "compilerFlagsDigest",
        }
    )

    def __post_init__(self) -> None:
        validate_sha256(self.compiler_executable_path_hash)
        validate_sha256(self.compiler_binary_sha256)
        _validate_non_empty_utf8(self.compiler_version, field="compilerVersion")
        _validate_non_empty_utf8(self.target_triple, field="targetTriple")
        _validate_ordered_string_tuple(self.compiler_flags, field="compilerFlags")
        validate_sha256(self.compiler_flags_digest)
        if self.compiler_flags_digest != domain_separated_sha256(
            _COMPILER_FLAGS_DOMAIN,
            list(self.compiler_flags),
        ):
            raise ValueError("compilerFlagsDigest does not match compilerFlags")

    def to_dict(self) -> dict[str, object]:
        return {
            "compilerExecutablePathHash": self.compiler_executable_path_hash,
            "compilerBinarySha256": self.compiler_binary_sha256,
            "compilerVersion": self.compiler_version,
            "targetTriple": self.target_triple,
            "compilerFlags": list(self.compiler_flags),
            "compilerFlagsDigest": self.compiler_flags_digest,
        }

    @classmethod
    def create(
        cls,
        *,
        compiler_executable_path_hash: str,
        compiler_binary_sha256: str,
        compiler_version: str,
        target_triple: str,
        compiler_flags: tuple[str, ...],
    ) -> "PreflightSupervisorBuildIdentity":
        return cls(
            compiler_executable_path_hash=compiler_executable_path_hash,
            compiler_binary_sha256=compiler_binary_sha256,
            compiler_version=compiler_version,
            target_triple=target_triple,
            compiler_flags=compiler_flags,
            compiler_flags_digest=domain_separated_sha256(
                _COMPILER_FLAGS_DOMAIN,
                list(compiler_flags),
            ),
        )

    @classmethod
    def from_dict(cls, value: object) -> "PreflightSupervisorBuildIdentity":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        compiler_flags = data["compilerFlags"]
        if not isinstance(compiler_flags, list):
            raise ValueError("compilerFlags must be an array")
        return cls(
            compiler_executable_path_hash=data["compilerExecutablePathHash"],
            compiler_binary_sha256=data["compilerBinarySha256"],
            compiler_version=data["compilerVersion"],
            target_triple=data["targetTriple"],
            compiler_flags=tuple(compiler_flags),
            compiler_flags_digest=data["compilerFlagsDigest"],
        )


@dataclass(frozen=True)
class StdlibModuleIdentity:
    module_name: str
    origin_kind: StdlibModuleOriginKind
    file_sha256: str | None
    artifact_ref: ArtifactRef | None

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {"moduleName", "originKind", "fileSha256", "artifactRef"}
    )

    def __post_init__(self) -> None:
        _validate_non_empty_utf8(
            self.module_name,
            field="moduleName",
            maximum_bytes=512,
        )
        if not isinstance(self.origin_kind, StdlibModuleOriginKind):
            raise ValueError("originKind must be a closed stdlib origin")
        if self.origin_kind is StdlibModuleOriginKind.FILE:
            validate_sha256(self.file_sha256)
            _validate_ref_content(
                self.artifact_ref,
                field="artifactRef",
                sha256=self.file_sha256,
            )
        elif self.file_sha256 is not None or self.artifact_ref is not None:
            raise ValueError("BUILTIN/FROZEN modules forbid file identity")

    def to_dict(self) -> dict[str, object]:
        return {
            "moduleName": self.module_name,
            "originKind": self.origin_kind.value,
            "fileSha256": self.file_sha256,
            "artifactRef": (
                None if self.artifact_ref is None else self.artifact_ref.to_dict()
            ),
        }

    @classmethod
    def create(
        cls,
        *,
        module_name: str,
        origin_kind: StdlibModuleOriginKind,
        file_sha256: str | None = None,
        artifact_ref: ArtifactRef | None = None,
    ) -> "StdlibModuleIdentity":
        return cls(
            module_name=module_name,
            origin_kind=origin_kind,
            file_sha256=file_sha256,
            artifact_ref=artifact_ref,
        )

    @classmethod
    def from_dict(cls, value: object) -> "StdlibModuleIdentity":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        artifact_ref = data["artifactRef"]
        return cls(
            module_name=data["moduleName"],
            origin_kind=_enum_from_wire(
                StdlibModuleOriginKind,
                data["originKind"],
                field="originKind",
            ),
            file_sha256=data["fileSha256"],
            artifact_ref=(
                None
                if artifact_ref is None
                else ArtifactRef.from_dict(artifact_ref)
            ),
        )


@dataclass(frozen=True)
class PreflightStdlibModuleIdentity:
    module_name: str
    origin_kind: StdlibModuleOriginKind
    file_sha256: str | None

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {"moduleName", "originKind", "fileSha256"}
    )

    def __post_init__(self) -> None:
        _validate_non_empty_utf8(
            self.module_name,
            field="moduleName",
            maximum_bytes=512,
        )
        if not isinstance(self.origin_kind, StdlibModuleOriginKind):
            raise ValueError("originKind must be a closed stdlib origin")
        if self.origin_kind is StdlibModuleOriginKind.FILE:
            validate_sha256(self.file_sha256)
        elif self.file_sha256 is not None:
            raise ValueError("BUILTIN/FROZEN modules forbid fileSha256")

    def to_dict(self) -> dict[str, object]:
        return {
            "moduleName": self.module_name,
            "originKind": self.origin_kind.value,
            "fileSha256": self.file_sha256,
        }

    @classmethod
    def create(
        cls,
        *,
        module_name: str,
        origin_kind: StdlibModuleOriginKind,
        file_sha256: str | None = None,
    ) -> "PreflightStdlibModuleIdentity":
        return cls(
            module_name=module_name,
            origin_kind=origin_kind,
            file_sha256=file_sha256,
        )

    @classmethod
    def from_dict(cls, value: object) -> "PreflightStdlibModuleIdentity":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            module_name=data["moduleName"],
            origin_kind=_enum_from_wire(
                StdlibModuleOriginKind,
                data["originKind"],
                field="originKind",
            ),
            file_sha256=data["fileSha256"],
        )


@dataclass(frozen=True)
class LoadedRuntimeImage:
    logical_name: str
    origin_kind: RuntimeImageOriginKind
    path_hash: str
    file_sha256: str | None
    artifact_ref: ArtifactRef | None
    macho_uuid: str | None
    code_directory_hash: str | None
    shared_cache_uuid: str | None

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "logicalName",
            "originKind",
            "pathHash",
            "fileSha256",
            "artifactRef",
            "machoUuid",
            "codeDirectoryHash",
            "sharedCacheUuid",
        }
    )

    def __post_init__(self) -> None:
        _validate_non_empty_utf8(
            self.logical_name,
            field="logicalName",
            maximum_bytes=512,
        )
        if not isinstance(self.origin_kind, RuntimeImageOriginKind):
            raise ValueError("originKind must be a closed runtime image origin")
        validate_sha256(self.path_hash)
        if self.origin_kind is RuntimeImageOriginKind.STANDALONE_FILE:
            validate_sha256(self.file_sha256)
            _validate_ref_content(
                self.artifact_ref,
                field="artifactRef",
                sha256=self.file_sha256,
            )
            if any(
                value is not None
                for value in (
                    self.macho_uuid,
                    self.code_directory_hash,
                    self.shared_cache_uuid,
                )
            ):
                raise ValueError(
                    "STANDALONE_FILE forbids shared-cache identity fields"
                )
            return
        if self.file_sha256 is not None or self.artifact_ref is not None:
            raise ValueError(
                "DARWIN_SHARED_CACHE forbids fileSha256 and artifactRef"
            )
        for field, value in (
            ("machoUuid", self.macho_uuid),
            ("codeDirectoryHash", self.code_directory_hash),
            ("sharedCacheUuid", self.shared_cache_uuid),
        ):
            _validate_non_empty_utf8(value, field=field, maximum_bytes=256)

    @property
    def identity_key(self) -> tuple[bytes, bytes, bytes]:
        return (
            self.origin_kind.value.encode("utf-8"),
            self.logical_name.encode("utf-8"),
            self.path_hash.encode("ascii"),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "logicalName": self.logical_name,
            "originKind": self.origin_kind.value,
            "pathHash": self.path_hash,
            "fileSha256": self.file_sha256,
            "artifactRef": (
                None if self.artifact_ref is None else self.artifact_ref.to_dict()
            ),
            "machoUuid": self.macho_uuid,
            "codeDirectoryHash": self.code_directory_hash,
            "sharedCacheUuid": self.shared_cache_uuid,
        }

    @classmethod
    def create(
        cls,
        *,
        logical_name: str,
        origin_kind: RuntimeImageOriginKind,
        path_hash: str,
        file_sha256: str | None = None,
        artifact_ref: ArtifactRef | None = None,
        macho_uuid: str | None = None,
        code_directory_hash: str | None = None,
        shared_cache_uuid: str | None = None,
    ) -> "LoadedRuntimeImage":
        return cls(
            logical_name=logical_name,
            origin_kind=origin_kind,
            path_hash=path_hash,
            file_sha256=file_sha256,
            artifact_ref=artifact_ref,
            macho_uuid=macho_uuid,
            code_directory_hash=code_directory_hash,
            shared_cache_uuid=shared_cache_uuid,
        )

    @classmethod
    def from_dict(cls, value: object) -> "LoadedRuntimeImage":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        artifact_ref = data["artifactRef"]
        return cls(
            logical_name=data["logicalName"],
            origin_kind=_enum_from_wire(
                RuntimeImageOriginKind,
                data["originKind"],
                field="originKind",
            ),
            path_hash=data["pathHash"],
            file_sha256=data["fileSha256"],
            artifact_ref=(
                None
                if artifact_ref is None
                else ArtifactRef.from_dict(artifact_ref)
            ),
            macho_uuid=data["machoUuid"],
            code_directory_hash=data["codeDirectoryHash"],
            shared_cache_uuid=data["sharedCacheUuid"],
        )


@dataclass(frozen=True)
class PreflightLoadedRuntimeImage:
    logical_name: str
    origin_kind: RuntimeImageOriginKind
    path_hash: str
    file_sha256: str | None
    macho_uuid: str | None
    code_directory_hash: str | None
    shared_cache_uuid: str | None

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "logicalName",
            "originKind",
            "pathHash",
            "fileSha256",
            "machoUuid",
            "codeDirectoryHash",
            "sharedCacheUuid",
        }
    )

    def __post_init__(self) -> None:
        _validate_non_empty_utf8(
            self.logical_name,
            field="logicalName",
            maximum_bytes=512,
        )
        if not isinstance(self.origin_kind, RuntimeImageOriginKind):
            raise ValueError("originKind must be a closed runtime image origin")
        validate_sha256(self.path_hash)
        if self.origin_kind is RuntimeImageOriginKind.STANDALONE_FILE:
            validate_sha256(self.file_sha256)
            if any(
                value is not None
                for value in (
                    self.macho_uuid,
                    self.code_directory_hash,
                    self.shared_cache_uuid,
                )
            ):
                raise ValueError(
                    "STANDALONE_FILE forbids shared-cache identity fields"
                )
            return
        if self.file_sha256 is not None:
            raise ValueError("DARWIN_SHARED_CACHE forbids fileSha256")
        for field, value in (
            ("machoUuid", self.macho_uuid),
            ("codeDirectoryHash", self.code_directory_hash),
            ("sharedCacheUuid", self.shared_cache_uuid),
        ):
            _validate_non_empty_utf8(value, field=field, maximum_bytes=256)

    @property
    def identity_key(self) -> tuple[bytes, bytes, bytes]:
        return (
            self.origin_kind.value.encode("utf-8"),
            self.logical_name.encode("utf-8"),
            self.path_hash.encode("ascii"),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "logicalName": self.logical_name,
            "originKind": self.origin_kind.value,
            "pathHash": self.path_hash,
            "fileSha256": self.file_sha256,
            "machoUuid": self.macho_uuid,
            "codeDirectoryHash": self.code_directory_hash,
            "sharedCacheUuid": self.shared_cache_uuid,
        }

    @classmethod
    def create(
        cls,
        *,
        logical_name: str,
        origin_kind: RuntimeImageOriginKind,
        path_hash: str,
        file_sha256: str | None = None,
        macho_uuid: str | None = None,
        code_directory_hash: str | None = None,
        shared_cache_uuid: str | None = None,
    ) -> "PreflightLoadedRuntimeImage":
        return cls(
            logical_name=logical_name,
            origin_kind=origin_kind,
            path_hash=path_hash,
            file_sha256=file_sha256,
            macho_uuid=macho_uuid,
            code_directory_hash=code_directory_hash,
            shared_cache_uuid=shared_cache_uuid,
        )

    @classmethod
    def from_dict(cls, value: object) -> "PreflightLoadedRuntimeImage":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            logical_name=data["logicalName"],
            origin_kind=_enum_from_wire(
                RuntimeImageOriginKind,
                data["originKind"],
                field="originKind",
            ),
            path_hash=data["pathHash"],
            file_sha256=data["fileSha256"],
            macho_uuid=data["machoUuid"],
            code_directory_hash=data["codeDirectoryHash"],
            shared_cache_uuid=data["sharedCacheUuid"],
        )


@dataclass(frozen=True)
class CapturedRuntimeFile:
    kind: RuntimeFileKind
    module_name: str | None
    logical_name: str | None
    origin_kind: RuntimeImageOriginKind | None
    path_hash: str
    file_sha256: str
    byte_length: int

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "kind",
            "moduleName",
            "logicalName",
            "originKind",
            "pathHash",
            "fileSha256",
            "byteLength",
        }
    )

    def __post_init__(self) -> None:
        if not isinstance(self.kind, RuntimeFileKind):
            raise ValueError("kind must be a closed runtime file kind")
        validate_sha256(self.path_hash)
        validate_sha256(self.file_sha256)
        _validate_non_negative_integer(self.byte_length, field="byteLength")
        if self.kind is RuntimeFileKind.STDLIB_MODULE:
            _validate_non_empty_utf8(
                self.module_name,
                field="moduleName",
                maximum_bytes=512,
            )
            if self.logical_name is not None or self.origin_kind is not None:
                raise ValueError("STDLIB_MODULE forbids image identity fields")
        elif self.kind is RuntimeFileKind.LOADED_RUNTIME_IMAGE:
            _validate_non_empty_utf8(
                self.logical_name,
                field="logicalName",
                maximum_bytes=512,
            )
            if (
                self.module_name is not None
                or self.origin_kind is not RuntimeImageOriginKind.STANDALONE_FILE
            ):
                raise ValueError(
                    "LOADED_RUNTIME_IMAGE requires STANDALONE_FILE identity"
                )
        elif any(
            value is not None
            for value in (self.module_name, self.logical_name, self.origin_kind)
        ):
            raise ValueError(f"{self.kind.value} forbids module/image identity")

    @property
    def identity_key(self) -> tuple[bytes, bytes, bytes, bytes]:
        return (
            self.kind.value.encode("utf-8"),
            _nullable_string_sort_key(self.module_name),
            _nullable_string_sort_key(self.logical_name),
            self.path_hash.encode("ascii"),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "kind": self.kind.value,
            "moduleName": self.module_name,
            "logicalName": self.logical_name,
            "originKind": (
                None if self.origin_kind is None else self.origin_kind.value
            ),
            "pathHash": self.path_hash,
            "fileSha256": self.file_sha256,
            "byteLength": self.byte_length,
        }

    @classmethod
    def create(
        cls,
        *,
        kind: RuntimeFileKind,
        path_hash: str,
        file_sha256: str,
        byte_length: int,
        module_name: str | None = None,
        logical_name: str | None = None,
        origin_kind: RuntimeImageOriginKind | None = None,
    ) -> "CapturedRuntimeFile":
        return cls(
            kind=kind,
            module_name=module_name,
            logical_name=logical_name,
            origin_kind=origin_kind,
            path_hash=path_hash,
            file_sha256=file_sha256,
            byte_length=byte_length,
        )

    @classmethod
    def from_dict(cls, value: object) -> "CapturedRuntimeFile":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        origin_kind = data["originKind"]
        return cls(
            kind=_enum_from_wire(
                RuntimeFileKind,
                data["kind"],
                field="kind",
            ),
            module_name=data["moduleName"],
            logical_name=data["logicalName"],
            origin_kind=(
                None
                if origin_kind is None
                else _enum_from_wire(
                    RuntimeImageOriginKind,
                    origin_kind,
                    field="originKind",
                )
            ),
            path_hash=data["pathHash"],
            file_sha256=data["fileSha256"],
            byte_length=data["byteLength"],
        )


@dataclass(frozen=True)
class DarwinRuntimeHostBuild:
    os_family: RuntimeOsFamily
    product_version: str
    product_build_version: str
    kernel_release: str
    kernel_version: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "osFamily",
            "productVersion",
            "productBuildVersion",
            "kernelRelease",
            "kernelVersion",
        }
    )

    def __post_init__(self) -> None:
        if self.os_family is not RuntimeOsFamily.DARWIN:
            raise ValueError("Darwin host build osFamily must be DARWIN")
        for field, value in (
            ("productVersion", self.product_version),
            ("productBuildVersion", self.product_build_version),
            ("kernelRelease", self.kernel_release),
            ("kernelVersion", self.kernel_version),
        ):
            _validate_non_empty_utf8(value, field=field)

    def to_dict(self) -> dict[str, object]:
        return {
            "osFamily": self.os_family.value,
            "productVersion": self.product_version,
            "productBuildVersion": self.product_build_version,
            "kernelRelease": self.kernel_release,
            "kernelVersion": self.kernel_version,
        }

    @classmethod
    def create(
        cls,
        *,
        product_version: str,
        product_build_version: str,
        kernel_release: str,
        kernel_version: str,
    ) -> "DarwinRuntimeHostBuild":
        return cls(
            os_family=RuntimeOsFamily.DARWIN,
            product_version=product_version,
            product_build_version=product_build_version,
            kernel_release=kernel_release,
            kernel_version=kernel_version,
        )

    @classmethod
    def from_dict(cls, value: object) -> "DarwinRuntimeHostBuild":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            os_family=_enum_from_wire(
                RuntimeOsFamily,
                data["osFamily"],
                field="osFamily",
            ),
            product_version=data["productVersion"],
            product_build_version=data["productBuildVersion"],
            kernel_release=data["kernelRelease"],
            kernel_version=data["kernelVersion"],
        )


@dataclass(frozen=True)
class LinuxRuntimeHostBuild:
    os_family: RuntimeOsFamily
    os_release_file_sha256: str
    kernel_release: str
    kernel_version: str
    machine: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "osFamily",
            "osReleaseFileSha256",
            "kernelRelease",
            "kernelVersion",
            "machine",
        }
    )

    def __post_init__(self) -> None:
        if self.os_family is not RuntimeOsFamily.LINUX:
            raise ValueError("Linux host build osFamily must be LINUX")
        validate_sha256(self.os_release_file_sha256)
        for field, value in (
            ("kernelRelease", self.kernel_release),
            ("kernelVersion", self.kernel_version),
            ("machine", self.machine),
        ):
            _validate_non_empty_utf8(value, field=field)

    def to_dict(self) -> dict[str, object]:
        return {
            "osFamily": self.os_family.value,
            "osReleaseFileSha256": self.os_release_file_sha256,
            "kernelRelease": self.kernel_release,
            "kernelVersion": self.kernel_version,
            "machine": self.machine,
        }

    @classmethod
    def create(
        cls,
        *,
        os_release_file_sha256: str,
        kernel_release: str,
        kernel_version: str,
        machine: str,
    ) -> "LinuxRuntimeHostBuild":
        return cls(
            os_family=RuntimeOsFamily.LINUX,
            os_release_file_sha256=os_release_file_sha256,
            kernel_release=kernel_release,
            kernel_version=kernel_version,
            machine=machine,
        )

    @classmethod
    def from_dict(cls, value: object) -> "LinuxRuntimeHostBuild":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            os_family=_enum_from_wire(
                RuntimeOsFamily,
                data["osFamily"],
                field="osFamily",
            ),
            os_release_file_sha256=data["osReleaseFileSha256"],
            kernel_release=data["kernelRelease"],
            kernel_version=data["kernelVersion"],
            machine=data["machine"],
        )


RuntimeHostBuild = Union[DarwinRuntimeHostBuild, LinuxRuntimeHostBuild]


def runtime_host_build_from_dict(value: object) -> RuntimeHostBuild:
    if not isinstance(value, Mapping):
        raise ValueError("RuntimeHostBuild must be an object")
    os_family = value.get("osFamily")
    if os_family == RuntimeOsFamily.DARWIN.value:
        return DarwinRuntimeHostBuild.from_dict(value)
    if os_family == RuntimeOsFamily.LINUX.value:
        return LinuxRuntimeHostBuild.from_dict(value)
    raise ValueError("RuntimeHostBuild osFamily is not closed")


@dataclass(frozen=True)
class DarwinRuntimeHostIdentity:
    os_family: RuntimeOsFamily
    host_build: DarwinRuntimeHostBuild
    hardware_identity_hash: str
    runtime_host_identity_digest: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "osFamily",
            "hostBuild",
            "hardwareIdentityHash",
            "runtimeHostIdentityDigest",
        }
    )

    def __post_init__(self) -> None:
        if self.os_family is not RuntimeOsFamily.DARWIN:
            raise ValueError("Darwin host identity osFamily must be DARWIN")
        if not isinstance(self.host_build, DarwinRuntimeHostBuild):
            raise ValueError("Darwin host identity requires Darwin hostBuild")
        validate_sha256(self.hardware_identity_hash)
        validate_sha256(self.runtime_host_identity_digest)
        if self.runtime_host_identity_digest != self.expected_digest():
            raise ValueError("runtimeHostIdentityDigest does not match identity")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "osFamily": self.os_family.value,
            "hostBuild": self.host_build.to_dict(),
            "hardwareIdentityHash": self.hardware_identity_hash,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(
            _RUNTIME_HOST_IDENTITY_DOMAIN,
            self._digest_payload(),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            **self._digest_payload(),
            "runtimeHostIdentityDigest": self.runtime_host_identity_digest,
        }

    @classmethod
    def create(
        cls,
        *,
        host_build: DarwinRuntimeHostBuild,
        hardware_identity_hash: str,
    ) -> "DarwinRuntimeHostIdentity":
        payload = {
            "osFamily": RuntimeOsFamily.DARWIN.value,
            "hostBuild": host_build.to_dict(),
            "hardwareIdentityHash": hardware_identity_hash,
        }
        return cls(
            os_family=RuntimeOsFamily.DARWIN,
            host_build=host_build,
            hardware_identity_hash=hardware_identity_hash,
            runtime_host_identity_digest=domain_separated_sha256(
                _RUNTIME_HOST_IDENTITY_DOMAIN,
                payload,
            ),
        )

    @classmethod
    def from_dict(cls, value: object) -> "DarwinRuntimeHostIdentity":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            os_family=_enum_from_wire(
                RuntimeOsFamily,
                data["osFamily"],
                field="osFamily",
            ),
            host_build=DarwinRuntimeHostBuild.from_dict(data["hostBuild"]),
            hardware_identity_hash=data["hardwareIdentityHash"],
            runtime_host_identity_digest=data["runtimeHostIdentityDigest"],
        )


@dataclass(frozen=True)
class LinuxRuntimeHostIdentity:
    os_family: RuntimeOsFamily
    host_build: LinuxRuntimeHostBuild
    machine_id_hash: str
    runtime_host_identity_digest: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "osFamily",
            "hostBuild",
            "machineIdHash",
            "runtimeHostIdentityDigest",
        }
    )

    def __post_init__(self) -> None:
        if self.os_family is not RuntimeOsFamily.LINUX:
            raise ValueError("Linux host identity osFamily must be LINUX")
        if not isinstance(self.host_build, LinuxRuntimeHostBuild):
            raise ValueError("Linux host identity requires Linux hostBuild")
        validate_sha256(self.machine_id_hash)
        validate_sha256(self.runtime_host_identity_digest)
        if self.runtime_host_identity_digest != self.expected_digest():
            raise ValueError("runtimeHostIdentityDigest does not match identity")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "osFamily": self.os_family.value,
            "hostBuild": self.host_build.to_dict(),
            "machineIdHash": self.machine_id_hash,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(
            _RUNTIME_HOST_IDENTITY_DOMAIN,
            self._digest_payload(),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            **self._digest_payload(),
            "runtimeHostIdentityDigest": self.runtime_host_identity_digest,
        }

    @classmethod
    def create(
        cls,
        *,
        host_build: LinuxRuntimeHostBuild,
        machine_id_hash: str,
    ) -> "LinuxRuntimeHostIdentity":
        payload = {
            "osFamily": RuntimeOsFamily.LINUX.value,
            "hostBuild": host_build.to_dict(),
            "machineIdHash": machine_id_hash,
        }
        return cls(
            os_family=RuntimeOsFamily.LINUX,
            host_build=host_build,
            machine_id_hash=machine_id_hash,
            runtime_host_identity_digest=domain_separated_sha256(
                _RUNTIME_HOST_IDENTITY_DOMAIN,
                payload,
            ),
        )

    @classmethod
    def from_dict(cls, value: object) -> "LinuxRuntimeHostIdentity":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            os_family=_enum_from_wire(
                RuntimeOsFamily,
                data["osFamily"],
                field="osFamily",
            ),
            host_build=LinuxRuntimeHostBuild.from_dict(data["hostBuild"]),
            machine_id_hash=data["machineIdHash"],
            runtime_host_identity_digest=data["runtimeHostIdentityDigest"],
        )


RuntimeHostIdentity = Union[
    DarwinRuntimeHostIdentity,
    LinuxRuntimeHostIdentity,
]


def runtime_host_identity_from_dict(value: object) -> RuntimeHostIdentity:
    if not isinstance(value, Mapping):
        raise ValueError("RuntimeHostIdentity must be an object")
    os_family = value.get("osFamily")
    if os_family == RuntimeOsFamily.DARWIN.value:
        return DarwinRuntimeHostIdentity.from_dict(value)
    if os_family == RuntimeOsFamily.LINUX.value:
        return LinuxRuntimeHostIdentity.from_dict(value)
    raise ValueError("RuntimeHostIdentity osFamily is not closed")


@dataclass(frozen=True)
class RuntimePlatformAttestation:
    os_family: RuntimeOsFamily
    host_build: RuntimeHostBuild
    dynamic_loader_identity: LoadedRuntimeImage
    shared_cache_uuid: str | None
    loaded_images: tuple[LoadedRuntimeImage, ...]
    platform_runtime_digest: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "osFamily",
            "hostBuild",
            "dynamicLoaderIdentity",
            "sharedCacheUuid",
            "loadedImages",
            "platformRuntimeDigest",
        }
    )

    def __post_init__(self) -> None:
        if not isinstance(self.os_family, RuntimeOsFamily):
            raise ValueError("osFamily must be a closed runtime OS family")
        if self.host_build.os_family is not self.os_family:
            raise ValueError("hostBuild osFamily does not match attestation")
        if not isinstance(self.dynamic_loader_identity, LoadedRuntimeImage):
            raise ValueError("dynamicLoaderIdentity must be LoadedRuntimeImage")
        if self.dynamic_loader_identity.logical_name != "dynamic-loader":
            raise ValueError(
                "dynamicLoaderIdentity.logicalName must be dynamic-loader"
            )
        if not isinstance(self.loaded_images, tuple) or not self.loaded_images:
            raise ValueError("loadedImages must be a non-empty immutable tuple")
        if any(not isinstance(item, LoadedRuntimeImage) for item in self.loaded_images):
            raise ValueError("loadedImages must contain LoadedRuntimeImage values")
        keys = tuple(item.identity_key for item in self.loaded_images)
        if len(set(keys)) != len(keys):
            raise ValueError("loadedImages contains duplicate identities")
        if keys != tuple(sorted(keys)):
            raise ValueError("loadedImages must be in canonical identity order")
        if self.dynamic_loader_identity not in self.loaded_images:
            raise ValueError("dynamicLoaderIdentity must belong to loadedImages")
        if self.os_family is RuntimeOsFamily.DARWIN:
            if not isinstance(self.host_build, DarwinRuntimeHostBuild):
                raise ValueError("DARWIN requires DarwinRuntimeHostBuild")
            shared_cache_uuid = _validate_non_empty_utf8(
                self.shared_cache_uuid,
                field="sharedCacheUuid",
                maximum_bytes=256,
            )
            for image in self.loaded_images:
                if (
                    image.origin_kind
                    is RuntimeImageOriginKind.DARWIN_SHARED_CACHE
                    and image.shared_cache_uuid != shared_cache_uuid
                ):
                    raise ValueError(
                        "shared-cache image UUID does not match attestation"
                    )
        else:
            if not isinstance(self.host_build, LinuxRuntimeHostBuild):
                raise ValueError("LINUX requires LinuxRuntimeHostBuild")
            if self.shared_cache_uuid is not None:
                raise ValueError("LINUX requires null sharedCacheUuid")
            if any(
                item.origin_kind is not RuntimeImageOriginKind.STANDALONE_FILE
                for item in self.loaded_images
            ):
                raise ValueError("LINUX forbids DARWIN_SHARED_CACHE images")
        validate_sha256(self.platform_runtime_digest)
        if self.platform_runtime_digest != self.expected_digest():
            raise ValueError("platformRuntimeDigest does not match attestation")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "osFamily": self.os_family.value,
            "hostBuild": self.host_build.to_dict(),
            "dynamicLoaderIdentity": self.dynamic_loader_identity.to_dict(),
            "sharedCacheUuid": self.shared_cache_uuid,
            "loadedImages": [item.to_dict() for item in self.loaded_images],
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(
            _PLATFORM_RUNTIME_DOMAIN,
            self._digest_payload(),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            **self._digest_payload(),
            "platformRuntimeDigest": self.platform_runtime_digest,
        }

    @classmethod
    def create(
        cls,
        *,
        os_family: RuntimeOsFamily,
        host_build: RuntimeHostBuild,
        dynamic_loader_identity: LoadedRuntimeImage,
        shared_cache_uuid: str | None,
        loaded_images: tuple[LoadedRuntimeImage, ...],
    ) -> "RuntimePlatformAttestation":
        ordered = tuple(sorted(loaded_images, key=lambda item: item.identity_key))
        payload = {
            "osFamily": os_family.value,
            "hostBuild": host_build.to_dict(),
            "dynamicLoaderIdentity": dynamic_loader_identity.to_dict(),
            "sharedCacheUuid": shared_cache_uuid,
            "loadedImages": [item.to_dict() for item in ordered],
        }
        return cls(
            os_family=os_family,
            host_build=host_build,
            dynamic_loader_identity=dynamic_loader_identity,
            shared_cache_uuid=shared_cache_uuid,
            loaded_images=ordered,
            platform_runtime_digest=domain_separated_sha256(
                _PLATFORM_RUNTIME_DOMAIN,
                payload,
            ),
        )

    @classmethod
    def from_dict(cls, value: object) -> "RuntimePlatformAttestation":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        loaded_images = data["loadedImages"]
        if not isinstance(loaded_images, list):
            raise ValueError("loadedImages must be an array")
        return cls(
            os_family=_enum_from_wire(
                RuntimeOsFamily,
                data["osFamily"],
                field="osFamily",
            ),
            host_build=runtime_host_build_from_dict(data["hostBuild"]),
            dynamic_loader_identity=LoadedRuntimeImage.from_dict(
                data["dynamicLoaderIdentity"]
            ),
            shared_cache_uuid=data["sharedCacheUuid"],
            loaded_images=tuple(
                LoadedRuntimeImage.from_dict(item) for item in loaded_images
            ),
            platform_runtime_digest=data["platformRuntimeDigest"],
        )


@dataclass(frozen=True)
class FinalizerRuntimeIdentity:
    finalizer_runtime_digest: str
    supervisor_runtime_digest: str
    supervisor_source_path: str
    supervisor_source_file_sha256: str
    supervisor_source_artifact: ArtifactRef
    supervisor_source_digest: str
    supervisor_binary_ref: ArtifactRef
    supervisor_binary_sha256: str
    supervisor_build_identity: SupervisorBuildIdentity
    protocol_version: int
    executable_path_hash: str
    executable_ref: ArtifactRef
    executable_sha256: str
    implementation: str
    version: str
    stdlib_modules: tuple[StdlibModuleIdentity, ...]
    stdlib_digest: str
    platform_runtime: RuntimePlatformAttestation
    core_bootstrap_source_digest: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "finalizerRuntimeDigest",
            "supervisorRuntimeDigest",
            "supervisorSourcePath",
            "supervisorSourceFileSha256",
            "supervisorSourceArtifact",
            "supervisorSourceDigest",
            "supervisorBinaryRef",
            "supervisorBinarySha256",
            "supervisorBuildIdentity",
            "protocolVersion",
            "executablePathHash",
            "executableRef",
            "executableSha256",
            "implementation",
            "version",
            "stdlibModules",
            "stdlibDigest",
            "platformRuntime",
            "coreBootstrapSourceDigest",
        }
    )

    def __post_init__(self) -> None:
        validate_sha256(self.supervisor_runtime_digest)
        validate_repo_relative_path(self.supervisor_source_path)
        validate_sha256(self.supervisor_source_file_sha256)
        source_ref = _validate_ref_content(
            self.supervisor_source_artifact,
            field="supervisorSourceArtifact",
            sha256=self.supervisor_source_file_sha256,
        )
        if source_ref.path != self.supervisor_source_path:
            raise ValueError(
                "supervisorSourceArtifact path does not match supervisorSourcePath"
            )
        validate_sha256(self.supervisor_source_digest)
        expected_source_digest = domain_separated_sha256(
            _SUPERVISOR_SOURCE_DOMAIN,
            {
                "repoRelativePath": self.supervisor_source_path,
                "fileSha256": self.supervisor_source_file_sha256,
            },
        )
        if self.supervisor_source_digest != expected_source_digest:
            raise ValueError(
                "supervisorSourceDigest does not match supervisor source"
            )
        validate_sha256(self.supervisor_binary_sha256)
        _validate_ref_content(
            self.supervisor_binary_ref,
            field="supervisorBinaryRef",
            sha256=self.supervisor_binary_sha256,
        )
        if type(self.supervisor_build_identity) is not SupervisorBuildIdentity:
            raise ValueError(
                "supervisorBuildIdentity must be SupervisorBuildIdentity"
            )
        if self.protocol_version != 1 or isinstance(self.protocol_version, bool):
            raise ValueError("protocolVersion must be 1")
        validate_sha256(self.executable_path_hash)
        validate_sha256(self.executable_sha256)
        _validate_ref_content(
            self.executable_ref,
            field="executableRef",
            sha256=self.executable_sha256,
        )
        _validate_non_empty_utf8(self.implementation, field="implementation")
        _validate_non_empty_utf8(self.version, field="version")
        if not isinstance(self.stdlib_modules, tuple):
            raise ValueError("stdlibModules must be an immutable tuple")
        if any(
            type(item) is not StdlibModuleIdentity
            for item in self.stdlib_modules
        ):
            raise ValueError(
                "stdlibModules must contain StdlibModuleIdentity values"
            )
        module_names = tuple(item.module_name for item in self.stdlib_modules)
        if len(set(module_names)) != len(module_names):
            raise ValueError("stdlibModules contains duplicate moduleName")
        if module_names != tuple(
            sorted(module_names, key=lambda item: item.encode("utf-8"))
        ):
            raise ValueError("stdlibModules must be in UTF-8 lexical order")
        validate_sha256(self.stdlib_digest)
        if self.stdlib_digest != self.expected_stdlib_digest():
            raise ValueError("stdlibDigest does not match stdlibModules")
        if type(self.platform_runtime) is not RuntimePlatformAttestation:
            raise ValueError(
                "platformRuntime must be RuntimePlatformAttestation"
            )
        validate_sha256(self.core_bootstrap_source_digest)
        references = (
            self.supervisor_source_artifact,
            self.supervisor_binary_ref,
            self.supervisor_build_identity.compiler_binary_ref,
            self.executable_ref,
            *(
                item.artifact_ref
                for item in self.stdlib_modules
                if item.artifact_ref is not None
            ),
            *(
                item.artifact_ref
                for item in self.platform_runtime.loaded_images
                if item.artifact_ref is not None
            ),
        )
        if len({_artifact_source_identity(item) for item in references}) != 1:
            raise ValueError("runtime ArtifactRefs must share one run identity")
        validate_sha256(self.finalizer_runtime_digest)
        if self.supervisor_runtime_digest != self.expected_supervisor_runtime_digest():
            raise ValueError(
                "supervisorRuntimeDigest does not match supervisor identity"
            )
        if self.finalizer_runtime_digest != self.expected_digest():
            raise ValueError(
                "finalizerRuntimeDigest does not match runtime identity"
            )

    def expected_stdlib_digest(self) -> str:
        return domain_separated_sha256(
            _STDLIB_CLOSURE_DOMAIN,
            [item.to_dict() for item in self.stdlib_modules],
        )

    def supervisor_runtime_payload(self) -> dict[str, object]:
        return {
            "supervisorSourceDigest": self.supervisor_source_digest,
            "supervisorBinarySha256": self.supervisor_binary_sha256,
            "supervisorBuildIdentity": (
                self.supervisor_build_identity.without_artifact_ref_dict()
            ),
            "protocolVersion": self.protocol_version,
        }

    def expected_supervisor_runtime_digest(self) -> str:
        return domain_separated_sha256(
            _SUPERVISOR_RUNTIME_DOMAIN,
            self.supervisor_runtime_payload(),
        )

    def _digest_payload(self) -> dict[str, object]:
        return {
            "supervisorRuntimeDigest": self.supervisor_runtime_digest,
            "supervisorSourcePath": self.supervisor_source_path,
            "supervisorSourceFileSha256": self.supervisor_source_file_sha256,
            "supervisorSourceArtifact": self.supervisor_source_artifact.to_dict(),
            "supervisorSourceDigest": self.supervisor_source_digest,
            "supervisorBinaryRef": self.supervisor_binary_ref.to_dict(),
            "supervisorBinarySha256": self.supervisor_binary_sha256,
            "supervisorBuildIdentity": self.supervisor_build_identity.to_dict(),
            "protocolVersion": self.protocol_version,
            "executablePathHash": self.executable_path_hash,
            "executableRef": self.executable_ref.to_dict(),
            "executableSha256": self.executable_sha256,
            "implementation": self.implementation,
            "version": self.version,
            "stdlibModules": [item.to_dict() for item in self.stdlib_modules],
            "stdlibDigest": self.stdlib_digest,
            "platformRuntime": self.platform_runtime.to_dict(),
            "coreBootstrapSourceDigest": self.core_bootstrap_source_digest,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(
            _FINALIZER_RUNTIME_DOMAIN,
            self._digest_payload(),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "finalizerRuntimeDigest": self.finalizer_runtime_digest,
            **self._digest_payload(),
        }

    @classmethod
    def create(
        cls,
        *,
        supervisor_source_path: str,
        supervisor_source_file_sha256: str,
        supervisor_source_artifact: ArtifactRef,
        supervisor_binary_ref: ArtifactRef,
        supervisor_binary_sha256: str,
        supervisor_build_identity: SupervisorBuildIdentity,
        executable_path_hash: str,
        executable_ref: ArtifactRef,
        executable_sha256: str,
        implementation: str,
        version: str,
        stdlib_modules: tuple[StdlibModuleIdentity, ...],
        platform_runtime: RuntimePlatformAttestation,
        core_bootstrap_source_digest: str,
    ) -> "FinalizerRuntimeIdentity":
        if (
            type(supervisor_build_identity) is not SupervisorBuildIdentity
            or type(stdlib_modules) is not tuple
            or any(
                type(item) is not StdlibModuleIdentity
                for item in stdlib_modules
            )
            or type(platform_runtime) is not RuntimePlatformAttestation
        ):
            raise ValueError(
                "runtime inputs must use concrete contract types"
            )
        supervisor_source_digest = domain_separated_sha256(
            _SUPERVISOR_SOURCE_DOMAIN,
            {
                "repoRelativePath": supervisor_source_path,
                "fileSha256": supervisor_source_file_sha256,
            },
        )
        stdlib_digest = domain_separated_sha256(
            _STDLIB_CLOSURE_DOMAIN,
            [item.to_dict() for item in stdlib_modules],
        )
        supervisor_runtime_payload = {
            "supervisorSourceDigest": supervisor_source_digest,
            "supervisorBinarySha256": supervisor_binary_sha256,
            "supervisorBuildIdentity": (
                supervisor_build_identity.without_artifact_ref_dict()
            ),
            "protocolVersion": 1,
        }
        supervisor_runtime_digest = domain_separated_sha256(
            _SUPERVISOR_RUNTIME_DOMAIN,
            supervisor_runtime_payload,
        )
        payload = {
            "supervisorRuntimeDigest": supervisor_runtime_digest,
            "supervisorSourcePath": supervisor_source_path,
            "supervisorSourceFileSha256": supervisor_source_file_sha256,
            "supervisorSourceArtifact": supervisor_source_artifact.to_dict(),
            "supervisorSourceDigest": supervisor_source_digest,
            "supervisorBinaryRef": supervisor_binary_ref.to_dict(),
            "supervisorBinarySha256": supervisor_binary_sha256,
            "supervisorBuildIdentity": supervisor_build_identity.to_dict(),
            "protocolVersion": 1,
            "executablePathHash": executable_path_hash,
            "executableRef": executable_ref.to_dict(),
            "executableSha256": executable_sha256,
            "implementation": implementation,
            "version": version,
            "stdlibModules": [item.to_dict() for item in stdlib_modules],
            "stdlibDigest": stdlib_digest,
            "platformRuntime": platform_runtime.to_dict(),
            "coreBootstrapSourceDigest": core_bootstrap_source_digest,
        }
        return cls(
            finalizer_runtime_digest=domain_separated_sha256(
                _FINALIZER_RUNTIME_DOMAIN,
                payload,
            ),
            supervisor_runtime_digest=supervisor_runtime_digest,
            supervisor_source_path=supervisor_source_path,
            supervisor_source_file_sha256=supervisor_source_file_sha256,
            supervisor_source_artifact=supervisor_source_artifact,
            supervisor_source_digest=supervisor_source_digest,
            supervisor_binary_ref=supervisor_binary_ref,
            supervisor_binary_sha256=supervisor_binary_sha256,
            supervisor_build_identity=supervisor_build_identity,
            protocol_version=1,
            executable_path_hash=executable_path_hash,
            executable_ref=executable_ref,
            executable_sha256=executable_sha256,
            implementation=implementation,
            version=version,
            stdlib_modules=stdlib_modules,
            stdlib_digest=stdlib_digest,
            platform_runtime=platform_runtime,
            core_bootstrap_source_digest=core_bootstrap_source_digest,
        )

    @classmethod
    def from_dict(cls, value: object) -> "FinalizerRuntimeIdentity":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        stdlib_modules = data["stdlibModules"]
        if not isinstance(stdlib_modules, list):
            raise ValueError("stdlibModules must be an array")
        return cls(
            finalizer_runtime_digest=data["finalizerRuntimeDigest"],
            supervisor_runtime_digest=data["supervisorRuntimeDigest"],
            supervisor_source_path=data["supervisorSourcePath"],
            supervisor_source_file_sha256=data["supervisorSourceFileSha256"],
            supervisor_source_artifact=ArtifactRef.from_dict(
                data["supervisorSourceArtifact"]
            ),
            supervisor_source_digest=data["supervisorSourceDigest"],
            supervisor_binary_ref=ArtifactRef.from_dict(
                data["supervisorBinaryRef"]
            ),
            supervisor_binary_sha256=data["supervisorBinarySha256"],
            supervisor_build_identity=SupervisorBuildIdentity.from_dict(
                data["supervisorBuildIdentity"]
            ),
            protocol_version=data["protocolVersion"],
            executable_path_hash=data["executablePathHash"],
            executable_ref=ArtifactRef.from_dict(data["executableRef"]),
            executable_sha256=data["executableSha256"],
            implementation=data["implementation"],
            version=data["version"],
            stdlib_modules=tuple(
                StdlibModuleIdentity.from_dict(item) for item in stdlib_modules
            ),
            stdlib_digest=data["stdlibDigest"],
            platform_runtime=RuntimePlatformAttestation.from_dict(
                data["platformRuntime"]
            ),
            core_bootstrap_source_digest=data["coreBootstrapSourceDigest"],
        )


def _validate_finalizer_identity_fields(
    *,
    finalizer_id: object,
    finalizer_executable: object,
    finalizer_source_digest: object,
    finalizer_runtime: object,
    supervisor_session_id: object,
    supervisor_runtime_digest: object,
    enforcement_generation: object,
    enforcement_digest: object,
    requirement_digest: object,
    config_digest: object,
    workspace_id: object,
    gate_id: object,
    evidence_run_id: object,
    provisioning_run_id: object,
    runtime_manifest_ref: object,
    source_commit: object,
    workspace_digest: object,
    canonical_worktree_hash: object,
    snapshot_digest: object,
    required_role_identities: object,
    primary_status: object,
    primary_result_digest: object,
) -> None:
    validate_finalizer_id(finalizer_id)
    if type(finalizer_executable) is not FinalizerExecutableArtifact:
        raise ValueError(
            "finalizerExecutable must be FinalizerExecutableArtifact"
        )
    validate_sha256(finalizer_source_digest)
    if finalizer_source_digest != finalizer_executable.source_digest:
        raise ValueError(
            "finalizerSourceDigest does not match finalizerExecutable"
        )
    if type(finalizer_runtime) is not FinalizerRuntimeIdentity:
        raise ValueError("finalizerRuntime must be FinalizerRuntimeIdentity")
    if (
        finalizer_executable.core_bootstrap_source_digest
        != finalizer_runtime.core_bootstrap_source_digest
    ):
        raise ValueError("coreBootstrapSourceDigest does not match")
    _validate_non_empty_utf8(
        supervisor_session_id,
        field="supervisorSessionId",
        maximum_bytes=256,
    )
    validate_sha256(supervisor_runtime_digest)
    if supervisor_runtime_digest != finalizer_runtime.supervisor_runtime_digest:
        raise ValueError(
            "supervisorRuntimeDigest does not match finalizerRuntime"
        )
    _validate_positive_integer(
        enforcement_generation,
        field="enforcementGeneration",
    )
    for field, digest in (
        ("enforcementDigest", enforcement_digest),
        ("requirementDigest", requirement_digest),
        ("configDigest", config_digest),
    ):
        try:
            validate_sha256(digest)
        except ValueError as error:
            raise ValueError(f"{field} must be a SHA-256 digest") from error
    _validate_workspace_id(workspace_id)
    _validate_slug(gate_id, field="gate ID")
    _validate_run_id(evidence_run_id, field="evidenceRunId")
    _validate_non_empty_utf8(
        provisioning_run_id,
        field="provisioningRunId",
        maximum_bytes=256,
    )
    if type(runtime_manifest_ref) is not ArtifactRef:
        raise ValueError("runtimeManifestRef must be an ArtifactRef")
    _validate_non_empty_utf8(source_commit, field="sourceCommit")
    _validate_non_empty_utf8(workspace_digest, field="workspaceDigest")
    validate_sha256(canonical_worktree_hash)
    validate_sha256(snapshot_digest)
    _validate_role_identities(
        required_role_identities,
        field="requiredRoleIdentities",
        allow_empty=True,
    )
    if not isinstance(primary_status, CanonicalResultTuple):
        raise ValueError("primaryStatus must be a CanonicalResultTuple")
    validate_sha256(primary_result_digest)
    expected_source = (workspace_id, gate_id, evidence_run_id)
    references = (
        runtime_manifest_ref,
        finalizer_executable.ref,
        finalizer_runtime.supervisor_source_artifact,
        finalizer_runtime.supervisor_binary_ref,
        finalizer_runtime.supervisor_build_identity.compiler_binary_ref,
        finalizer_runtime.executable_ref,
        *(
            item.artifact_ref
            for item in finalizer_runtime.stdlib_modules
            if item.artifact_ref is not None
        ),
        *(
            item.artifact_ref
            for item in finalizer_runtime.platform_runtime.loaded_images
            if item.artifact_ref is not None
        ),
    )
    if any(_artifact_source_identity(item) != expected_source for item in references):
        raise ValueError("nested ArtifactRef identity does not match invocation")


def _finalizer_identity_payload(
    *,
    finalizer_id: str,
    finalizer_executable: FinalizerExecutableArtifact,
    finalizer_source_digest: str,
    finalizer_runtime: FinalizerRuntimeIdentity,
    supervisor_session_id: str,
    supervisor_runtime_digest: str,
    enforcement_generation: int,
    enforcement_digest: str,
    requirement_digest: str,
    config_digest: str,
    workspace_id: str,
    gate_id: str,
    evidence_run_id: str,
    provisioning_run_id: str,
    runtime_manifest_ref: ArtifactRef,
    source_commit: str,
    workspace_digest: str,
    canonical_worktree_hash: str,
    snapshot_digest: str,
    required_role_identities: tuple[tuple[str, str | None], ...],
    primary_status: CanonicalResultTuple,
    primary_result_digest: str,
) -> dict[str, object]:
    return {
        "finalizerId": finalizer_id,
        "finalizerExecutable": finalizer_executable.to_dict(),
        "finalizerSourceDigest": finalizer_source_digest,
        "finalizerRuntime": finalizer_runtime._digest_payload(),
        "supervisorSessionId": supervisor_session_id,
        "supervisorRuntimeDigest": supervisor_runtime_digest,
        "enforcementGeneration": enforcement_generation,
        "enforcementDigest": enforcement_digest,
        "requirementDigest": requirement_digest,
        "configDigest": config_digest,
        "workspaceId": workspace_id,
        "gateId": gate_id,
        "evidenceRunId": evidence_run_id,
        "provisioningRunId": provisioning_run_id,
        "runtimeManifestRef": runtime_manifest_ref.to_dict(),
        "sourceCommit": source_commit,
        "workspaceDigest": workspace_digest,
        "canonicalWorktreeHash": canonical_worktree_hash,
        "snapshotDigest": snapshot_digest,
        "requiredRoleIdentities": _role_identities_to_wire(
            required_role_identities
        ),
        "primaryStatus": primary_status.to_dict(),
        "primaryResultDigest": primary_result_digest,
    }


@dataclass(frozen=True)
class FinalizerContext:
    finalizer_id: str
    enforcement_generation: int
    enforcement_digest: str
    requirement_digest: str
    config_digest: str
    workspace_id: str
    gate_id: str
    evidence_run_id: str
    provisioning_run_id: str
    runtime_manifest_ref: ArtifactRef
    source_commit: str
    workspace_digest: str
    canonical_worktree_hash: str
    snapshot_digest: str
    finalizer_source_digest: str
    finalizer_executable: FinalizerExecutableArtifact
    finalizer_runtime: FinalizerRuntimeIdentity
    supervisor_session_id: str
    supervisor_runtime_digest: str
    required_role_identities: tuple[tuple[str, str | None], ...]
    primary_status: CanonicalResultTuple
    primary_result_digest: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "finalizerId",
            "enforcementGeneration",
            "enforcementDigest",
            "requirementDigest",
            "configDigest",
            "workspaceId",
            "gateId",
            "evidenceRunId",
            "provisioningRunId",
            "runtimeManifestRef",
            "sourceCommit",
            "workspaceDigest",
            "canonicalWorktreeHash",
            "snapshotDigest",
            "finalizerSourceDigest",
            "finalizerExecutable",
            "finalizerRuntime",
            "supervisorSessionId",
            "supervisorRuntimeDigest",
            "requiredRoleIdentities",
            "primaryStatus",
            "primaryResultDigest",
        }
    )

    def __post_init__(self) -> None:
        _validate_finalizer_identity_fields(**self._identity_kwargs())

    def _identity_kwargs(self) -> dict[str, object]:
        return {
            "finalizer_id": self.finalizer_id,
            "finalizer_executable": self.finalizer_executable,
            "finalizer_source_digest": self.finalizer_source_digest,
            "finalizer_runtime": self.finalizer_runtime,
            "supervisor_session_id": self.supervisor_session_id,
            "supervisor_runtime_digest": self.supervisor_runtime_digest,
            "enforcement_generation": self.enforcement_generation,
            "enforcement_digest": self.enforcement_digest,
            "requirement_digest": self.requirement_digest,
            "config_digest": self.config_digest,
            "workspace_id": self.workspace_id,
            "gate_id": self.gate_id,
            "evidence_run_id": self.evidence_run_id,
            "provisioning_run_id": self.provisioning_run_id,
            "runtime_manifest_ref": self.runtime_manifest_ref,
            "source_commit": self.source_commit,
            "workspace_digest": self.workspace_digest,
            "canonical_worktree_hash": self.canonical_worktree_hash,
            "snapshot_digest": self.snapshot_digest,
            "required_role_identities": self.required_role_identities,
            "primary_status": self.primary_status,
            "primary_result_digest": self.primary_result_digest,
        }

    def identity_payload(self) -> dict[str, object]:
        return _finalizer_identity_payload(**self._identity_kwargs())

    def to_dict(self) -> dict[str, object]:
        payload = self.identity_payload()
        payload["finalizerRuntime"] = self.finalizer_runtime.to_dict()
        return payload

    @classmethod
    def create(cls, **values: object) -> "FinalizerContext":
        return cls(**values)

    @classmethod
    def from_dict(cls, value: object) -> "FinalizerContext":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            finalizer_id=data["finalizerId"],
            enforcement_generation=data["enforcementGeneration"],
            enforcement_digest=data["enforcementDigest"],
            requirement_digest=data["requirementDigest"],
            config_digest=data["configDigest"],
            workspace_id=data["workspaceId"],
            gate_id=data["gateId"],
            evidence_run_id=data["evidenceRunId"],
            provisioning_run_id=data["provisioningRunId"],
            runtime_manifest_ref=ArtifactRef.from_dict(
                data["runtimeManifestRef"]
            ),
            source_commit=data["sourceCommit"],
            workspace_digest=data["workspaceDigest"],
            canonical_worktree_hash=data["canonicalWorktreeHash"],
            snapshot_digest=data["snapshotDigest"],
            finalizer_source_digest=data["finalizerSourceDigest"],
            finalizer_executable=FinalizerExecutableArtifact.from_dict(
                data["finalizerExecutable"]
            ),
            finalizer_runtime=FinalizerRuntimeIdentity.from_dict(
                data["finalizerRuntime"]
            ),
            supervisor_session_id=data["supervisorSessionId"],
            supervisor_runtime_digest=data["supervisorRuntimeDigest"],
            required_role_identities=_role_identities_from_wire(
                data["requiredRoleIdentities"],
                field="requiredRoleIdentities",
            ),
            primary_status=CanonicalResultTuple.from_dict(
                data["primaryStatus"]
            ),
            primary_result_digest=data["primaryResultDigest"],
        )


@dataclass(frozen=True)
class FinalizerInvocationIdentity:
    finalizer_id: str
    finalizer_executable: FinalizerExecutableArtifact
    finalizer_source_digest: str
    finalizer_runtime: FinalizerRuntimeIdentity
    supervisor_session_id: str
    supervisor_runtime_digest: str
    enforcement_generation: int
    enforcement_digest: str
    requirement_digest: str
    config_digest: str
    workspace_id: str
    gate_id: str
    evidence_run_id: str
    provisioning_run_id: str
    runtime_manifest_ref: ArtifactRef
    source_commit: str
    workspace_digest: str
    canonical_worktree_hash: str
    snapshot_digest: str
    required_role_identities: tuple[tuple[str, str | None], ...]
    primary_status: CanonicalResultTuple
    primary_result_digest: str
    invocation_digest: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = FinalizerContext._WIRE_KEYS | {
        "invocationDigest"
    }

    def __post_init__(self) -> None:
        _validate_finalizer_identity_fields(**self._identity_kwargs())
        validate_sha256(self.invocation_digest)
        if self.invocation_digest != self.expected_digest():
            raise ValueError("invocationDigest does not match invocation")

    def _identity_kwargs(self) -> dict[str, object]:
        return {
            "finalizer_id": self.finalizer_id,
            "finalizer_executable": self.finalizer_executable,
            "finalizer_source_digest": self.finalizer_source_digest,
            "finalizer_runtime": self.finalizer_runtime,
            "supervisor_session_id": self.supervisor_session_id,
            "supervisor_runtime_digest": self.supervisor_runtime_digest,
            "enforcement_generation": self.enforcement_generation,
            "enforcement_digest": self.enforcement_digest,
            "requirement_digest": self.requirement_digest,
            "config_digest": self.config_digest,
            "workspace_id": self.workspace_id,
            "gate_id": self.gate_id,
            "evidence_run_id": self.evidence_run_id,
            "provisioning_run_id": self.provisioning_run_id,
            "runtime_manifest_ref": self.runtime_manifest_ref,
            "source_commit": self.source_commit,
            "workspace_digest": self.workspace_digest,
            "canonical_worktree_hash": self.canonical_worktree_hash,
            "snapshot_digest": self.snapshot_digest,
            "required_role_identities": self.required_role_identities,
            "primary_status": self.primary_status,
            "primary_result_digest": self.primary_result_digest,
        }

    def _digest_payload(self) -> dict[str, object]:
        return _finalizer_identity_payload(**self._identity_kwargs())

    def expected_digest(self) -> str:
        return domain_separated_sha256(
            _INVOCATION_DOMAIN,
            self._digest_payload(),
        )

    def to_dict(self) -> dict[str, object]:
        payload = self._digest_payload()
        payload["finalizerRuntime"] = self.finalizer_runtime.to_dict()
        return {**payload, "invocationDigest": self.invocation_digest}

    @classmethod
    def create(cls, **values: object) -> "FinalizerInvocationIdentity":
        payload = _finalizer_identity_payload(**values)
        return cls(
            **values,
            invocation_digest=domain_separated_sha256(
                _INVOCATION_DOMAIN,
                payload,
            ),
        )

    @classmethod
    def from_dict(cls, value: object) -> "FinalizerInvocationIdentity":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            finalizer_id=data["finalizerId"],
            finalizer_executable=FinalizerExecutableArtifact.from_dict(
                data["finalizerExecutable"]
            ),
            finalizer_source_digest=data["finalizerSourceDigest"],
            finalizer_runtime=FinalizerRuntimeIdentity.from_dict(
                data["finalizerRuntime"]
            ),
            supervisor_session_id=data["supervisorSessionId"],
            supervisor_runtime_digest=data["supervisorRuntimeDigest"],
            enforcement_generation=data["enforcementGeneration"],
            enforcement_digest=data["enforcementDigest"],
            requirement_digest=data["requirementDigest"],
            config_digest=data["configDigest"],
            workspace_id=data["workspaceId"],
            gate_id=data["gateId"],
            evidence_run_id=data["evidenceRunId"],
            provisioning_run_id=data["provisioningRunId"],
            runtime_manifest_ref=ArtifactRef.from_dict(
                data["runtimeManifestRef"]
            ),
            source_commit=data["sourceCommit"],
            workspace_digest=data["workspaceDigest"],
            canonical_worktree_hash=data["canonicalWorktreeHash"],
            snapshot_digest=data["snapshotDigest"],
            required_role_identities=_role_identities_from_wire(
                data["requiredRoleIdentities"],
                field="requiredRoleIdentities",
            ),
            primary_status=CanonicalResultTuple.from_dict(
                data["primaryStatus"]
            ),
            primary_result_digest=data["primaryResultDigest"],
            invocation_digest=data["invocationDigest"],
        )


@dataclass(frozen=True)
class FinalizerInput:
    invocation: FinalizerInvocationIdentity
    context: FinalizerContext
    snapshot: ReadOnlyEvidenceSnapshot
    finalizer_input_digest: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {"invocation", "context", "snapshot", "finalizerInputDigest"}
    )

    def __post_init__(self) -> None:
        if type(self.invocation) is not FinalizerInvocationIdentity:
            raise ValueError(
                "invocation must be FinalizerInvocationIdentity"
            )
        if type(self.context) is not FinalizerContext:
            raise ValueError("context must be FinalizerContext")
        if type(self.snapshot) is not ReadOnlyEvidenceSnapshot:
            raise ValueError("snapshot must be ReadOnlyEvidenceSnapshot")
        invocation_projection = self.invocation.to_dict()
        invocation_projection.pop("invocationDigest")
        if self.context.to_dict() != invocation_projection:
            raise ValueError("context does not equal invocation projection")
        snapshot_projection = {
            "workspaceId": self.snapshot.workspace_id,
            "gateId": self.snapshot.gate_id,
            "evidenceRunId": self.snapshot.evidence_run_id,
            "runtimeManifestRef": self.snapshot.runtime_manifest_ref.to_dict(),
            "sourceCommit": self.snapshot.source_commit,
            "workspaceDigest": self.snapshot.workspace_digest,
            "canonicalWorktreeHash": self.snapshot.canonical_worktree_hash,
            "snapshotDigest": self.snapshot.snapshot_digest,
        }
        invocation_source_projection = {
            "workspaceId": self.invocation.workspace_id,
            "gateId": self.invocation.gate_id,
            "evidenceRunId": self.invocation.evidence_run_id,
            "runtimeManifestRef": self.invocation.runtime_manifest_ref.to_dict(),
            "sourceCommit": self.invocation.source_commit,
            "workspaceDigest": self.invocation.workspace_digest,
            "canonicalWorktreeHash": self.invocation.canonical_worktree_hash,
            "snapshotDigest": self.invocation.snapshot_digest,
        }
        if snapshot_projection != invocation_source_projection:
            raise ValueError("snapshot does not equal invocation source identity")
        snapshot_role_identities = {
            artifact.identity for artifact in self.snapshot.artifacts
        }
        missing_role_identities = sorted(
            set(self.invocation.required_role_identities)
            - snapshot_role_identities,
            key=_role_identity_key,
        )
        if missing_role_identities:
            raise ValueError(
                "requiredRoleIdentities are absent from snapshot artifacts: "
                f"{missing_role_identities}"
            )
        validate_sha256(self.finalizer_input_digest)
        if self.finalizer_input_digest != self.expected_digest():
            raise ValueError("finalizerInputDigest does not match input")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "invocation": self.invocation.to_dict(),
            "context": self.context.to_dict(),
            "snapshot": self.snapshot.to_dict(),
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(
            _FINALIZER_INPUT_DOMAIN,
            self._digest_payload(),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            **self._digest_payload(),
            "finalizerInputDigest": self.finalizer_input_digest,
        }

    @classmethod
    def create(
        cls,
        *,
        invocation: FinalizerInvocationIdentity,
        context: FinalizerContext,
        snapshot: ReadOnlyEvidenceSnapshot,
    ) -> "FinalizerInput":
        if (
            type(invocation) is not FinalizerInvocationIdentity
            or type(context) is not FinalizerContext
            or type(snapshot) is not ReadOnlyEvidenceSnapshot
        ):
            raise ValueError(
                "finalizer input requires concrete contract types"
            )
        payload = {
            "invocation": invocation.to_dict(),
            "context": context.to_dict(),
            "snapshot": snapshot.to_dict(),
        }
        return cls(
            invocation=invocation,
            context=context,
            snapshot=snapshot,
            finalizer_input_digest=domain_separated_sha256(
                _FINALIZER_INPUT_DOMAIN,
                payload,
            ),
        )

    @classmethod
    def from_dict(cls, value: object) -> "FinalizerInput":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            invocation=FinalizerInvocationIdentity.from_dict(
                data["invocation"]
            ),
            context=FinalizerContext.from_dict(data["context"]),
            snapshot=ReadOnlyEvidenceSnapshot.from_dict(data["snapshot"]),
            finalizer_input_digest=data["finalizerInputDigest"],
        )


@dataclass(frozen=True)
class SealedEvidenceMarker:
    artifact_kind: str
    schema_version: int
    snapshot: ReadOnlyEvidenceSnapshot
    finalizer_context: FinalizerContext
    primary_result: CanonicalPrimaryResult
    primary_result_digest: str
    sealed_at: str
    seal_digest: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "artifactKind",
            "schemaVersion",
            "snapshot",
            "finalizerContext",
            "primaryResult",
            "primaryResultDigest",
            "sealedAt",
            "sealDigest",
        }
    )

    def __post_init__(self) -> None:
        if self.artifact_kind != "acceptance-finalizer-seal":
            raise ValueError("artifactKind must be acceptance-finalizer-seal")
        if self.schema_version != 1 or isinstance(self.schema_version, bool):
            raise ValueError("schemaVersion must be 1")
        if not isinstance(self.snapshot, ReadOnlyEvidenceSnapshot):
            raise ValueError("snapshot must be ReadOnlyEvidenceSnapshot")
        if not isinstance(self.finalizer_context, FinalizerContext):
            raise ValueError("finalizerContext must be FinalizerContext")
        if not isinstance(self.primary_result, CanonicalPrimaryResult):
            raise ValueError("primaryResult must be CanonicalPrimaryResult")
        validate_sha256(self.primary_result_digest)
        if self.primary_result_digest != self.primary_result.digest():
            raise ValueError(
                "primaryResultDigest does not match primaryResult"
            )
        if (
            self.finalizer_context.primary_result_digest
            != self.primary_result_digest
            or self.finalizer_context.primary_status
            is not self.primary_result.result_tuple
        ):
            raise ValueError(
                "finalizerContext primary result does not match marker"
            )
        snapshot_projection = {
            "workspaceId": self.snapshot.workspace_id,
            "gateId": self.snapshot.gate_id,
            "evidenceRunId": self.snapshot.evidence_run_id,
            "runtimeManifestRef": self.snapshot.runtime_manifest_ref.to_dict(),
            "sourceCommit": self.snapshot.source_commit,
            "workspaceDigest": self.snapshot.workspace_digest,
            "canonicalWorktreeHash": self.snapshot.canonical_worktree_hash,
            "snapshotDigest": self.snapshot.snapshot_digest,
        }
        context_projection = {
            "workspaceId": self.finalizer_context.workspace_id,
            "gateId": self.finalizer_context.gate_id,
            "evidenceRunId": self.finalizer_context.evidence_run_id,
            "runtimeManifestRef": (
                self.finalizer_context.runtime_manifest_ref.to_dict()
            ),
            "sourceCommit": self.finalizer_context.source_commit,
            "workspaceDigest": self.finalizer_context.workspace_digest,
            "canonicalWorktreeHash": (
                self.finalizer_context.canonical_worktree_hash
            ),
            "snapshotDigest": self.finalizer_context.snapshot_digest,
        }
        if snapshot_projection != context_projection:
            raise ValueError("snapshot does not match finalizerContext")
        sealed_at = _canonical_utc_instant(
            self.sealed_at,
            field="sealedAt",
        )
        evaluation_time = _canonical_utc_instant(
            self.snapshot.evaluation_time,
            field="evaluationTime",
        )
        if sealed_at < evaluation_time:
            raise ValueError("sealedAt must not precede evaluationTime")
        source_trace = self.primary_result.source_trace
        if source_trace.source_commit != self.snapshot.source_commit:
            raise ValueError(
                "primary result sourceCommit does not match snapshot"
            )
        snapshot_identity = (
            self.snapshot.workspace_id,
            self.snapshot.gate_id,
            self.snapshot.evidence_run_id,
        )
        if any(
            (
                reference.workspace_id,
                reference.gate_id,
                reference.run_id,
            )
            != snapshot_identity
            for reference in source_trace.evidence_refs
        ):
            raise ValueError(
                "primary result evidenceRefs do not match snapshot"
            )
        snapshot_artifact_refs = {
            _artifact_ref_key(artifact.ref)
            for artifact in self.snapshot.artifacts
        }
        if any(
            _artifact_ref_key(reference) not in snapshot_artifact_refs
            for reference in source_trace.evidence_refs
        ):
            raise ValueError(
                "primary result evidenceRefs are absent from snapshot"
            )
        validate_sha256(self.seal_digest)
        if self.seal_digest != self.expected_digest():
            raise ValueError("sealDigest does not match sealed marker")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind,
            "schemaVersion": self.schema_version,
            "snapshot": self.snapshot.to_dict(),
            "finalizerContext": self.finalizer_context.to_dict(),
            "primaryResult": self.primary_result.to_dict(),
            "primaryResultDigest": self.primary_result_digest,
            "sealedAt": self.sealed_at,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_SEAL_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "sealDigest": self.seal_digest}

    @classmethod
    def create(
        cls,
        *,
        snapshot: ReadOnlyEvidenceSnapshot,
        finalizer_context: FinalizerContext,
        primary_result: CanonicalPrimaryResult,
        sealed_at: str,
    ) -> "SealedEvidenceMarker":
        primary_result_digest = primary_result.digest()
        payload = {
            "artifactKind": "acceptance-finalizer-seal",
            "schemaVersion": 1,
            "snapshot": snapshot.to_dict(),
            "finalizerContext": finalizer_context.to_dict(),
            "primaryResult": primary_result.to_dict(),
            "primaryResultDigest": primary_result_digest,
            "sealedAt": sealed_at,
        }
        return cls(
            artifact_kind="acceptance-finalizer-seal",
            schema_version=1,
            snapshot=snapshot,
            finalizer_context=finalizer_context,
            primary_result=primary_result,
            primary_result_digest=primary_result_digest,
            sealed_at=sealed_at,
            seal_digest=domain_separated_sha256(_SEAL_DOMAIN, payload),
        )

    @classmethod
    def from_dict(cls, value: object) -> "SealedEvidenceMarker":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            artifact_kind=data["artifactKind"],
            schema_version=data["schemaVersion"],
            snapshot=ReadOnlyEvidenceSnapshot.from_dict(data["snapshot"]),
            finalizer_context=FinalizerContext.from_dict(
                data["finalizerContext"]
            ),
            primary_result=CanonicalPrimaryResult.from_dict(
                data["primaryResult"]
            ),
            primary_result_digest=data["primaryResultDigest"],
            sealed_at=data["sealedAt"],
            seal_digest=data["sealDigest"],
        )


@dataclass(frozen=True)
class FinalizerPreflightToken:
    enforcement_generation: int
    enforcement_digest: str
    requirement_digest: str
    config_digest: str
    source_digest: str
    supervisor_session_id: str
    supervisor_runtime_digest: str
    preflight_runtime_digest: str
    source_capture_id: str
    source_capture_digest: str
    runtime_capture_id: str
    runtime_capture_digest: str
    durability_profile_digest: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "enforcementGeneration",
            "enforcementDigest",
            "requirementDigest",
            "configDigest",
            "sourceDigest",
            "supervisorSessionId",
            "supervisorRuntimeDigest",
            "preflightRuntimeDigest",
            "sourceCaptureId",
            "sourceCaptureDigest",
            "runtimeCaptureId",
            "runtimeCaptureDigest",
            "durabilityProfileDigest",
        }
    )

    def __post_init__(self) -> None:
        _validate_positive_integer(
            self.enforcement_generation,
            field="enforcementGeneration",
        )
        for field, value in (
            ("enforcementDigest", self.enforcement_digest),
            ("requirementDigest", self.requirement_digest),
            ("configDigest", self.config_digest),
            ("sourceDigest", self.source_digest),
            ("supervisorRuntimeDigest", self.supervisor_runtime_digest),
            ("preflightRuntimeDigest", self.preflight_runtime_digest),
            ("sourceCaptureDigest", self.source_capture_digest),
            ("runtimeCaptureDigest", self.runtime_capture_digest),
            ("durabilityProfileDigest", self.durability_profile_digest),
        ):
            try:
                validate_sha256(value)
            except ValueError as error:
                raise ValueError(f"{field} must be a SHA-256 digest") from error
        for field, value in (
            ("supervisorSessionId", self.supervisor_session_id),
            ("sourceCaptureId", self.source_capture_id),
            ("runtimeCaptureId", self.runtime_capture_id),
        ):
            _validate_non_empty_utf8(value, field=field, maximum_bytes=256)

    def to_dict(self) -> dict[str, object]:
        return {
            "enforcementGeneration": self.enforcement_generation,
            "enforcementDigest": self.enforcement_digest,
            "requirementDigest": self.requirement_digest,
            "configDigest": self.config_digest,
            "sourceDigest": self.source_digest,
            "supervisorSessionId": self.supervisor_session_id,
            "supervisorRuntimeDigest": self.supervisor_runtime_digest,
            "preflightRuntimeDigest": self.preflight_runtime_digest,
            "sourceCaptureId": self.source_capture_id,
            "sourceCaptureDigest": self.source_capture_digest,
            "runtimeCaptureId": self.runtime_capture_id,
            "runtimeCaptureDigest": self.runtime_capture_digest,
            "durabilityProfileDigest": self.durability_profile_digest,
        }

    @classmethod
    def create(cls, **values: object) -> "FinalizerPreflightToken":
        return cls(**values)

    @classmethod
    def from_dict(cls, value: object) -> "FinalizerPreflightToken":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            enforcement_generation=data["enforcementGeneration"],
            enforcement_digest=data["enforcementDigest"],
            requirement_digest=data["requirementDigest"],
            config_digest=data["configDigest"],
            source_digest=data["sourceDigest"],
            supervisor_session_id=data["supervisorSessionId"],
            supervisor_runtime_digest=data["supervisorRuntimeDigest"],
            preflight_runtime_digest=data["preflightRuntimeDigest"],
            source_capture_id=data["sourceCaptureId"],
            source_capture_digest=data["sourceCaptureDigest"],
            runtime_capture_id=data["runtimeCaptureId"],
            runtime_capture_digest=data["runtimeCaptureDigest"],
            durability_profile_digest=data["durabilityProfileDigest"],
        )


@dataclass(frozen=True)
class LatestPointer:
    artifact_kind: str
    schema_version: int
    workspace_id: str
    gate_id: str
    run_id: str
    completed_at: str
    manifest: ArtifactRef
    manifest_sha256: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "artifactKind",
            "schemaVersion",
            "workspaceId",
            "gateId",
            "runId",
            "completedAt",
            "manifest",
            "manifestSha256",
        }
    )

    def __post_init__(self) -> None:
        if self.artifact_kind != "acceptance-latest-pointer":
            raise ValueError("artifactKind must be acceptance-latest-pointer")
        if self.schema_version != 1 or isinstance(self.schema_version, bool):
            raise ValueError("schemaVersion must be 1")
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gate ID")
        _validate_run_id(self.run_id, field="runId")
        _canonical_utc_instant(self.completed_at, field="completedAt")
        if type(self.manifest) is not ArtifactRef:
            raise ValueError("manifest must be an ArtifactRef")
        validate_sha256(self.manifest_sha256)
        if (
            self.manifest.workspace_id != self.workspace_id
            or self.manifest.gate_id != self.gate_id
            or self.manifest.run_id != self.run_id
        ):
            raise ValueError("manifest identity does not match latest pointer")
        if self.manifest.sha256 != self.manifest_sha256:
            raise ValueError("manifestSha256 does not match manifest")

    def to_dict(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind,
            "schemaVersion": self.schema_version,
            "workspaceId": self.workspace_id,
            "gateId": self.gate_id,
            "runId": self.run_id,
            "completedAt": self.completed_at,
            "manifest": self.manifest.to_dict(),
            "manifestSha256": self.manifest_sha256,
        }

    def digest(self) -> str:
        return domain_separated_sha256(
            _PRIOR_LATEST_POINTER_DOMAIN,
            self.to_dict(),
        )

    @classmethod
    def create(
        cls,
        *,
        workspace_id: str,
        gate_id: str,
        run_id: str,
        completed_at: str,
        manifest: ArtifactRef,
    ) -> "LatestPointer":
        if type(manifest) is not ArtifactRef:
            raise ValueError("manifest must be an ArtifactRef")
        return cls(
            artifact_kind="acceptance-latest-pointer",
            schema_version=1,
            workspace_id=workspace_id,
            gate_id=gate_id,
            run_id=run_id,
            completed_at=completed_at,
            manifest=manifest,
            manifest_sha256=manifest.sha256,
        )

    @classmethod
    def from_dict(cls, value: object) -> "LatestPointer":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            artifact_kind=data["artifactKind"],
            schema_version=data["schemaVersion"],
            workspace_id=data["workspaceId"],
            gate_id=data["gateId"],
            run_id=data["runId"],
            completed_at=data["completedAt"],
            manifest=ArtifactRef.from_dict(data["manifest"]),
            manifest_sha256=data["manifestSha256"],
        )


@dataclass(frozen=True)
class AuthoritativeLatestResolution:
    artifact_kind: str
    schema_version: int
    authority_mode: LatestAuthorityMode
    workspace_id: str
    gate_id: str
    interlock_digest: str | None
    generation: int | None
    enforcement_digest: str | None
    manifest_ref: ArtifactRef
    manifest_sha256: str
    result_tuple: CanonicalResultTuple
    resolution_digest: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "artifactKind",
            "schemaVersion",
            "authorityMode",
            "workspaceId",
            "gateId",
            "interlockDigest",
            "generation",
            "enforcementDigest",
            "manifestRef",
            "manifestSha256",
            "resultTuple",
            "resolutionDigest",
        }
    )

    def __post_init__(self) -> None:
        if self.artifact_kind != "acceptance-authoritative-latest-resolution":
            raise ValueError(
                "artifactKind must be acceptance-authoritative-latest-resolution"
            )
        if self.schema_version != 1 or isinstance(self.schema_version, bool):
            raise ValueError("schemaVersion must be 1")
        if type(self.authority_mode) is not LatestAuthorityMode:
            raise ValueError("authorityMode must be closed")
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gate ID")
        if type(self.manifest_ref) is not ArtifactRef:
            raise ValueError("manifestRef must be an ArtifactRef")
        if (
            self.manifest_ref.workspace_id != self.workspace_id
            or self.manifest_ref.gate_id != self.gate_id
        ):
            raise ValueError("manifestRef identity does not match resolution")
        validate_sha256(self.manifest_sha256)
        if self.manifest_sha256 != self.manifest_ref.sha256:
            raise ValueError("manifestSha256 does not match manifestRef")
        if type(self.result_tuple) is not CanonicalResultTuple:
            raise ValueError("resultTuple must be a CanonicalResultTuple")
        if self.authority_mode is LatestAuthorityMode.LEGACY:
            if any(
                value is not None
                for value in (
                    self.interlock_digest,
                    self.generation,
                    self.enforcement_digest,
                )
            ):
                raise ValueError("LEGACY requires null enforcement fields")
        else:
            validate_sha256(self.interlock_digest)
            _validate_positive_integer(self.generation, field="generation")
            validate_sha256(self.enforcement_digest)
        validate_sha256(self.resolution_digest)
        if self.resolution_digest != self.expected_digest():
            raise ValueError("resolutionDigest does not match resolution")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind,
            "schemaVersion": self.schema_version,
            "authorityMode": self.authority_mode.value,
            "workspaceId": self.workspace_id,
            "gateId": self.gate_id,
            "interlockDigest": self.interlock_digest,
            "generation": self.generation,
            "enforcementDigest": self.enforcement_digest,
            "manifestRef": self.manifest_ref.to_dict(),
            "manifestSha256": self.manifest_sha256,
            "resultTuple": self.result_tuple.to_dict(),
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(
            _AUTHORITATIVE_RESOLUTION_DOMAIN,
            self._digest_payload(),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            **self._digest_payload(),
            "resolutionDigest": self.resolution_digest,
        }

    @classmethod
    def create(
        cls,
        *,
        authority_mode: LatestAuthorityMode,
        workspace_id: str,
        gate_id: str,
        interlock_digest: str | None,
        generation: int | None,
        enforcement_digest: str | None,
        manifest_ref: ArtifactRef,
        result_tuple: CanonicalResultTuple,
    ) -> "AuthoritativeLatestResolution":
        if (
            type(authority_mode) is not LatestAuthorityMode
            or type(manifest_ref) is not ArtifactRef
            or type(result_tuple) is not CanonicalResultTuple
        ):
            raise ValueError(
                "resolution inputs must use concrete contract types"
            )
        payload = {
            "artifactKind": "acceptance-authoritative-latest-resolution",
            "schemaVersion": 1,
            "authorityMode": authority_mode.value,
            "workspaceId": workspace_id,
            "gateId": gate_id,
            "interlockDigest": interlock_digest,
            "generation": generation,
            "enforcementDigest": enforcement_digest,
            "manifestRef": manifest_ref.to_dict(),
            "manifestSha256": manifest_ref.sha256,
            "resultTuple": result_tuple.to_dict(),
        }
        return cls(
            artifact_kind="acceptance-authoritative-latest-resolution",
            schema_version=1,
            authority_mode=authority_mode,
            workspace_id=workspace_id,
            gate_id=gate_id,
            interlock_digest=interlock_digest,
            generation=generation,
            enforcement_digest=enforcement_digest,
            manifest_ref=manifest_ref,
            manifest_sha256=manifest_ref.sha256,
            result_tuple=result_tuple,
            resolution_digest=domain_separated_sha256(
                _AUTHORITATIVE_RESOLUTION_DOMAIN,
                payload,
            ),
        )

    @classmethod
    def from_dict(cls, value: object) -> "AuthoritativeLatestResolution":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            artifact_kind=data["artifactKind"],
            schema_version=data["schemaVersion"],
            authority_mode=_enum_from_wire(
                LatestAuthorityMode,
                data["authorityMode"],
                field="authorityMode",
            ),
            workspace_id=data["workspaceId"],
            gate_id=data["gateId"],
            interlock_digest=data["interlockDigest"],
            generation=data["generation"],
            enforcement_digest=data["enforcementDigest"],
            manifest_ref=ArtifactRef.from_dict(data["manifestRef"]),
            manifest_sha256=data["manifestSha256"],
            result_tuple=CanonicalResultTuple.from_dict(data["resultTuple"]),
            resolution_digest=data["resolutionDigest"],
        )


@dataclass(frozen=True)
class FinalizerEnforcementActivated:
    artifact_kind: str
    schema_version: int
    workspace_id: str
    gate_id: str
    required_finalizer_id: str
    first_generation: int
    first_enforcement_digest: str
    activated_at: str
    activation_source_commit: str
    activation_intent_digest: str
    activated_digest: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "artifactKind",
            "schemaVersion",
            "workspaceId",
            "gateId",
            "requiredFinalizerId",
            "firstGeneration",
            "firstEnforcementDigest",
            "activatedAt",
            "activationSourceCommit",
            "activationIntentDigest",
            "activatedDigest",
        }
    )

    def __post_init__(self) -> None:
        if self.artifact_kind != "acceptance-finalizer-enforcement-activated":
            raise ValueError(
                "artifactKind must be acceptance-finalizer-enforcement-activated"
            )
        if self.schema_version != 1 or isinstance(self.schema_version, bool):
            raise ValueError("schemaVersion must be 1")
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gate ID")
        validate_finalizer_id(self.required_finalizer_id)
        if self.first_generation != 1 or isinstance(self.first_generation, bool):
            raise ValueError("firstGeneration must be 1")
        validate_sha256(self.first_enforcement_digest)
        _canonical_utc_instant(self.activated_at, field="activatedAt")
        _validate_non_empty_utf8(
            self.activation_source_commit,
            field="activationSourceCommit",
        )
        validate_sha256(self.activation_intent_digest)
        validate_sha256(self.activated_digest)
        if self.activated_digest != self.expected_digest():
            raise ValueError("activatedDigest does not match activated sentinel")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind,
            "schemaVersion": self.schema_version,
            "workspaceId": self.workspace_id,
            "gateId": self.gate_id,
            "requiredFinalizerId": self.required_finalizer_id,
            "firstGeneration": self.first_generation,
            "firstEnforcementDigest": self.first_enforcement_digest,
            "activatedAt": self.activated_at,
            "activationSourceCommit": self.activation_source_commit,
            "activationIntentDigest": self.activation_intent_digest,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(
            _ENFORCEMENT_ACTIVATED_DOMAIN,
            self._digest_payload(),
        )

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "activatedDigest": self.activated_digest}

    @classmethod
    def create(cls, **values: object) -> "FinalizerEnforcementActivated":
        payload = {
            "artifactKind": "acceptance-finalizer-enforcement-activated",
            "schemaVersion": 1,
            "workspaceId": values["workspace_id"],
            "gateId": values["gate_id"],
            "requiredFinalizerId": values["required_finalizer_id"],
            "firstGeneration": values["first_generation"],
            "firstEnforcementDigest": values["first_enforcement_digest"],
            "activatedAt": values["activated_at"],
            "activationSourceCommit": values["activation_source_commit"],
            "activationIntentDigest": values["activation_intent_digest"],
        }
        return cls(
            artifact_kind="acceptance-finalizer-enforcement-activated",
            schema_version=1,
            activated_digest=domain_separated_sha256(
                _ENFORCEMENT_ACTIVATED_DOMAIN,
                payload,
            ),
            **values,
        )

    @classmethod
    def from_dict(cls, value: object) -> "FinalizerEnforcementActivated":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            artifact_kind=data["artifactKind"],
            schema_version=data["schemaVersion"],
            workspace_id=data["workspaceId"],
            gate_id=data["gateId"],
            required_finalizer_id=data["requiredFinalizerId"],
            first_generation=data["firstGeneration"],
            first_enforcement_digest=data["firstEnforcementDigest"],
            activated_at=data["activatedAt"],
            activation_source_commit=data["activationSourceCommit"],
            activation_intent_digest=data["activationIntentDigest"],
            activated_digest=data["activatedDigest"],
        )


@dataclass(frozen=True)
class FinalizerEnforcementCurrent:
    artifact_kind: str
    schema_version: int
    workspace_id: str
    gate_id: str
    required_finalizer_id: str
    generation: int
    enforcement_digest: str
    current_digest: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "artifactKind",
            "schemaVersion",
            "workspaceId",
            "gateId",
            "requiredFinalizerId",
            "generation",
            "enforcementDigest",
            "currentDigest",
        }
    )

    def __post_init__(self) -> None:
        if self.artifact_kind != "acceptance-finalizer-enforcement-current":
            raise ValueError(
                "artifactKind must be acceptance-finalizer-enforcement-current"
            )
        if self.schema_version != 1 or isinstance(self.schema_version, bool):
            raise ValueError("schemaVersion must be 1")
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gate ID")
        validate_finalizer_id(self.required_finalizer_id)
        _validate_positive_integer(self.generation, field="generation")
        validate_sha256(self.enforcement_digest)
        validate_sha256(self.current_digest)
        if self.current_digest != self.expected_digest():
            raise ValueError("currentDigest does not match current selector")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind,
            "schemaVersion": self.schema_version,
            "workspaceId": self.workspace_id,
            "gateId": self.gate_id,
            "requiredFinalizerId": self.required_finalizer_id,
            "generation": self.generation,
            "enforcementDigest": self.enforcement_digest,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(
            _ENFORCEMENT_CURRENT_DOMAIN,
            self._digest_payload(),
        )

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "currentDigest": self.current_digest}

    @classmethod
    def create(cls, **values: object) -> "FinalizerEnforcementCurrent":
        payload = {
            "artifactKind": "acceptance-finalizer-enforcement-current",
            "schemaVersion": 1,
            "workspaceId": values["workspace_id"],
            "gateId": values["gate_id"],
            "requiredFinalizerId": values["required_finalizer_id"],
            "generation": values["generation"],
            "enforcementDigest": values["enforcement_digest"],
        }
        return cls(
            artifact_kind="acceptance-finalizer-enforcement-current",
            schema_version=1,
            current_digest=domain_separated_sha256(
                _ENFORCEMENT_CURRENT_DOMAIN,
                payload,
            ),
            **values,
        )

    @classmethod
    def from_dict(cls, value: object) -> "FinalizerEnforcementCurrent":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            artifact_kind=data["artifactKind"],
            schema_version=data["schemaVersion"],
            workspace_id=data["workspaceId"],
            gate_id=data["gateId"],
            required_finalizer_id=data["requiredFinalizerId"],
            generation=data["generation"],
            enforcement_digest=data["enforcementDigest"],
            current_digest=data["currentDigest"],
        )


@dataclass(frozen=True)
class AbortOperatorIdentity:
    identity_kind: AbortOperatorIdentityKind
    principal_id: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {"identityKind", "principalId"}
    )

    def __post_init__(self) -> None:
        if self.identity_kind is not AbortOperatorIdentityKind.POSIX_EFFECTIVE_UID:
            raise ValueError("identityKind must be POSIX_EFFECTIVE_UID")
        if (
            not isinstance(self.principal_id, str)
            or re.fullmatch(r"posix-euid:(0|[1-9][0-9]*)", self.principal_id)
            is None
        ):
            raise ValueError("principalId must be canonical posix-euid:<decimal>")
        uid = int(self.principal_id.removeprefix("posix-euid:"))
        if uid > 4294967295:
            raise ValueError("principalId UID exceeds UInt32")

    def to_dict(self) -> dict[str, object]:
        return {
            "identityKind": self.identity_kind.value,
            "principalId": self.principal_id,
        }

    @classmethod
    def create(cls, *, effective_uid: int) -> "AbortOperatorIdentity":
        if (
            not isinstance(effective_uid, int)
            or isinstance(effective_uid, bool)
            or not 0 <= effective_uid <= 4294967295
        ):
            raise ValueError("effective UID must be a UInt32")
        return cls(
            identity_kind=AbortOperatorIdentityKind.POSIX_EFFECTIVE_UID,
            principal_id=f"posix-euid:{effective_uid}",
        )

    @classmethod
    def from_dict(cls, value: object) -> "AbortOperatorIdentity":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            identity_kind=_enum_from_wire(
                AbortOperatorIdentityKind,
                data["identityKind"],
                field="identityKind",
            ),
            principal_id=data["principalId"],
        )


@dataclass(frozen=True)
class AbortSealedPreflightRequest:
    workspace_id: str
    gate_id: str
    evidence_run_id: str
    authorization_id: str
    attempt_id: str
    source_commit: str
    durability_profile_digest: str
    abort_preflight_request_digest: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "workspaceId",
            "gateId",
            "evidenceRunId",
            "authorizationId",
            "attemptId",
            "sourceCommit",
            "durabilityProfileDigest",
            "abortPreflightRequestDigest",
        }
    )

    def __post_init__(self) -> None:
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gate ID")
        _validate_run_id(self.evidence_run_id, field="evidenceRunId")
        _validate_slug(self.authorization_id, field="authorizationId")
        _validate_slug(self.attempt_id, field="attemptId")
        _validate_non_empty_utf8(self.source_commit, field="sourceCommit")
        validate_sha256(self.durability_profile_digest)
        validate_sha256(self.abort_preflight_request_digest)
        if self.abort_preflight_request_digest != self.expected_digest():
            raise ValueError(
                "abortPreflightRequestDigest does not match request"
            )

    def _digest_payload(self) -> dict[str, object]:
        return {
            "workspaceId": self.workspace_id,
            "gateId": self.gate_id,
            "evidenceRunId": self.evidence_run_id,
            "authorizationId": self.authorization_id,
            "attemptId": self.attempt_id,
            "sourceCommit": self.source_commit,
            "durabilityProfileDigest": self.durability_profile_digest,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(
            _ABORT_PREFLIGHT_REQUEST_DOMAIN,
            self._digest_payload(),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            **self._digest_payload(),
            "abortPreflightRequestDigest": self.abort_preflight_request_digest,
        }

    @classmethod
    def create(cls, **values: object) -> "AbortSealedPreflightRequest":
        payload = {
            "workspaceId": values["workspace_id"],
            "gateId": values["gate_id"],
            "evidenceRunId": values["evidence_run_id"],
            "authorizationId": values["authorization_id"],
            "attemptId": values["attempt_id"],
            "sourceCommit": values["source_commit"],
            "durabilityProfileDigest": values["durability_profile_digest"],
        }
        return cls(
            abort_preflight_request_digest=domain_separated_sha256(
                _ABORT_PREFLIGHT_REQUEST_DOMAIN,
                payload,
            ),
            **values,
        )

    @classmethod
    def from_dict(cls, value: object) -> "AbortSealedPreflightRequest":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            workspace_id=data["workspaceId"],
            gate_id=data["gateId"],
            evidence_run_id=data["evidenceRunId"],
            authorization_id=data["authorizationId"],
            attempt_id=data["attemptId"],
            source_commit=data["sourceCommit"],
            durability_profile_digest=data["durabilityProfileDigest"],
            abort_preflight_request_digest=data[
                "abortPreflightRequestDigest"
            ],
        )


@dataclass(frozen=True)
class AbortSealedPreflightRejected:
    request: AbortSealedPreflightRequest
    status: AbortPreflightStatus
    durable_boundary: AbortPreflightDurableBoundary
    failure_code: FinalizerFailureCode
    host_os_family: RuntimeOsFamily
    diagnostic: str
    abort_preflight_result_digest: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "request",
            "status",
            "durableBoundary",
            "failureCode",
            "hostOsFamily",
            "diagnostic",
            "abortPreflightResultDigest",
        }
    )

    def __post_init__(self) -> None:
        if not isinstance(self.request, AbortSealedPreflightRequest):
            raise ValueError("request must be AbortSealedPreflightRequest")
        if self.status is not AbortPreflightStatus.REJECTED:
            raise ValueError("status must be REJECTED")
        if self.durable_boundary is not AbortPreflightDurableBoundary.NO_MUTATION:
            raise ValueError("durableBoundary must be NO_MUTATION")
        if (
            self.failure_code
            is not FinalizerFailureCode.ABORT_SEALED_DELETE_UNSUPPORTED
        ):
            raise ValueError(
                "failureCode must be ABORT_SEALED_DELETE_UNSUPPORTED"
            )
        if not isinstance(self.host_os_family, RuntimeOsFamily):
            raise ValueError("hostOsFamily must be DARWIN or LINUX")
        _validate_non_empty_utf8(
            self.diagnostic,
            field="diagnostic",
            maximum_bytes=4096,
        )
        validate_sha256(self.abort_preflight_result_digest)
        if self.abort_preflight_result_digest != self.expected_digest():
            raise ValueError(
                "abortPreflightResultDigest does not match rejected result"
            )

    def _digest_payload(self) -> dict[str, object]:
        return {
            "request": self.request.to_dict(),
            "status": self.status.value,
            "durableBoundary": self.durable_boundary.value,
            "failureCode": self.failure_code.value,
            "hostOsFamily": self.host_os_family.value,
            "diagnostic": self.diagnostic,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(
            _ABORT_PREFLIGHT_RESULT_DOMAIN,
            self._digest_payload(),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            **self._digest_payload(),
            "abortPreflightResultDigest": self.abort_preflight_result_digest,
        }

    @classmethod
    def create(
        cls,
        *,
        request: AbortSealedPreflightRequest,
        host_os_family: RuntimeOsFamily,
        diagnostic: str,
    ) -> "AbortSealedPreflightRejected":
        payload = {
            "request": request.to_dict(),
            "status": AbortPreflightStatus.REJECTED.value,
            "durableBoundary": AbortPreflightDurableBoundary.NO_MUTATION.value,
            "failureCode": (
                FinalizerFailureCode.ABORT_SEALED_DELETE_UNSUPPORTED.value
            ),
            "hostOsFamily": host_os_family.value,
            "diagnostic": diagnostic,
        }
        return cls(
            request=request,
            status=AbortPreflightStatus.REJECTED,
            durable_boundary=AbortPreflightDurableBoundary.NO_MUTATION,
            failure_code=FinalizerFailureCode.ABORT_SEALED_DELETE_UNSUPPORTED,
            host_os_family=host_os_family,
            diagnostic=diagnostic,
            abort_preflight_result_digest=domain_separated_sha256(
                _ABORT_PREFLIGHT_RESULT_DOMAIN,
                payload,
            ),
        )

    @classmethod
    def from_dict(cls, value: object) -> "AbortSealedPreflightRejected":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            request=AbortSealedPreflightRequest.from_dict(data["request"]),
            status=_enum_from_wire(
                AbortPreflightStatus,
                data["status"],
                field="status",
            ),
            durable_boundary=_enum_from_wire(
                AbortPreflightDurableBoundary,
                data["durableBoundary"],
                field="durableBoundary",
            ),
            failure_code=_enum_from_wire(
                FinalizerFailureCode,
                data["failureCode"],
                field="failureCode",
            ),
            host_os_family=_enum_from_wire(
                RuntimeOsFamily,
                data["hostOsFamily"],
                field="hostOsFamily",
            ),
            diagnostic=data["diagnostic"],
            abort_preflight_result_digest=data[
                "abortPreflightResultDigest"
            ],
        )


def _validate_uint_string(
    value: object,
    *,
    field: str,
    maximum: int = 18446744073709551615,
) -> str:
    if (
        not isinstance(value, str)
        or re.fullmatch(r"0|[1-9][0-9]*", value) is None
        or int(value) > maximum
    ):
        raise ValueError(f"{field} must be a canonical unsigned integer string")
    return value


def _validate_source_file_tuple(
    value: object,
    *,
    field: str,
) -> tuple[tuple[str, str, int], ...]:
    if not isinstance(value, tuple) or not value:
        raise ValueError(f"{field} must be a non-empty immutable tuple")
    result: list[tuple[str, str, int]] = []
    for item in value:
        if not isinstance(item, tuple) or len(item) != 3:
            raise ValueError(f"{field} entries must be immutable triples")
        result.append(
            (
                validate_repo_relative_path(item[0]),
                validate_sha256(item[1]),
                _validate_non_negative_integer(item[2], field="byteLength"),
            )
        )
    validated = tuple(result)
    paths = tuple(item[0] for item in validated)
    if len(paths) != len(set(paths)):
        raise ValueError(f"{field} contains duplicate paths")
    if paths != tuple(sorted(paths, key=lambda item: item.encode("utf-8"))):
        raise ValueError(f"{field} must be in UTF-8 lexical path order")
    return validated


def _source_file_tuple_to_wire(
    value: tuple[tuple[str, str, int], ...],
) -> list[list[object]]:
    return [[path, digest, byte_length] for path, digest, byte_length in value]


def _source_file_tuple_from_wire(
    value: object,
    *,
    field: str,
) -> tuple[tuple[str, str, int], ...]:
    if not isinstance(value, list):
        raise ValueError(f"{field} must be an array")
    result: list[tuple[str, str, int]] = []
    for item in value:
        if not isinstance(item, list) or len(item) != 3:
            raise ValueError(f"{field} entries must be three-element arrays")
        result.append((item[0], item[1], item[2]))
    return tuple(result)


def _validate_host_pair(
    os_family: RuntimeOsFamily,
    host_build: RuntimeHostBuild,
    host_identity: RuntimeHostIdentity,
) -> None:
    if type(os_family) is not RuntimeOsFamily:
        raise ValueError("hostOsFamily must be DARWIN or LINUX")
    if os_family is RuntimeOsFamily.DARWIN:
        if type(host_build) is not DarwinRuntimeHostBuild or type(
            host_identity
        ) is not DarwinRuntimeHostIdentity:
            raise ValueError("DARWIN requires Darwin host build and identity")
    elif type(host_build) is not LinuxRuntimeHostBuild or type(
        host_identity
    ) is not LinuxRuntimeHostIdentity:
        raise ValueError("LINUX requires Linux host build and identity")
    if canonical_json_bytes(host_identity.host_build.to_dict()) != canonical_json_bytes(
        host_build.to_dict()
    ):
        raise ValueError("hostIdentity hostBuild must equal hostBuild")


def _same_process_start_identity(
    left: ProcessStartIdentity,
    right: ProcessStartIdentity,
) -> bool:
    if type(left) not in (
        DarwinProcessStartIdentity,
        LinuxProcessStartIdentity,
    ) or type(right) is not type(left):
        return False
    return canonical_json_bytes(left.to_dict()) == canonical_json_bytes(
        right.to_dict()
    )


def _enum_or_none(
    enum_type: type[Enum],
    value: object,
    *,
    field: str,
) -> Enum | None:
    if value is None:
        return None
    return _enum_from_wire(enum_type, value, field=field)


def _canonical_resolution_base64(
    resolution: AuthoritativeLatestResolution,
) -> str:
    return base64.b64encode(canonical_json_bytes(resolution.to_dict())).decode(
        "ascii"
    )


@dataclass(frozen=True)
class ProofAdmissionSourceEdge:
    __slots__ = (
        "edge_kind",
        "target_path",
        "assigned_grammar_id",
        "assigned_interpreter",
    )

    edge_kind: ProofAdmissionEdgeKind
    target_path: str
    assigned_grammar_id: ProofAdmissionGrammarId | None
    assigned_interpreter: ProofAdmissionInterpreter | None

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "edgeKind",
            "targetPath",
            "assignedGrammarId",
            "assignedInterpreter",
        }
    )

    def __post_init__(self) -> None:
        if type(self.edge_kind) is not ProofAdmissionEdgeKind:
            raise ValueError("edgeKind must be closed")
        validate_repo_relative_path(self.target_path)
        pair = (self.assigned_grammar_id, self.assigned_interpreter)
        if self.edge_kind is ProofAdmissionEdgeKind.DATA_READ:
            if pair != (None, None):
                raise ValueError("DATA_READ must not assign grammar or interpreter")
        elif pair not in _VALID_GRAMMAR_INTERPRETER_PAIRS:
            raise ValueError("non-data edge requires one valid grammar pair")

    def to_dict(self) -> dict[str, object]:
        return {
            "edgeKind": self.edge_kind.value,
            "targetPath": self.target_path,
            "assignedGrammarId": (
                None
                if self.assigned_grammar_id is None
                else self.assigned_grammar_id.value
            ),
            "assignedInterpreter": (
                None
                if self.assigned_interpreter is None
                else self.assigned_interpreter.value
            ),
        }

    @classmethod
    def create(cls, **values: object) -> "ProofAdmissionSourceEdge":
        return cls(**values)

    @classmethod
    def from_dict(cls, value: object) -> "ProofAdmissionSourceEdge":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            edge_kind=_enum_from_wire(
                ProofAdmissionEdgeKind, data["edgeKind"], field="edgeKind"
            ),
            target_path=data["targetPath"],
            assigned_grammar_id=_enum_or_none(
                ProofAdmissionGrammarId,
                data["assignedGrammarId"],
                field="assignedGrammarId",
            ),
            assigned_interpreter=_enum_or_none(
                ProofAdmissionInterpreter,
                data["assignedInterpreter"],
                field="assignedInterpreter",
            ),
        )


def _source_edge_key(edge: ProofAdmissionSourceEdge) -> tuple[bytes, bytes, bytes, bytes]:
    return (
        edge.edge_kind.value.encode("utf-8"),
        edge.target_path.encode("utf-8"),
        b"" if edge.assigned_grammar_id is None else edge.assigned_grammar_id.value.encode("utf-8"),
        b"" if edge.assigned_interpreter is None else edge.assigned_interpreter.value.encode("utf-8"),
    )


def classify_proof_admission_source(
    repo_relative_path: str,
    *,
    executable: bool,
    shebang_interpreter: ProofAdmissionInterpreter | None = None,
    incoming_assignment: tuple[
        ProofAdmissionGrammarId, ProofAdmissionInterpreter | None
    ]
    | None = None,
) -> tuple[
    ProofAdmissionSourceClassification,
    ProofAdmissionGrammarId | None,
    ProofAdmissionInterpreter | None,
]:
    """Apply the §20 ordered, total proof-admission source classifier."""
    path = validate_repo_relative_path(repo_relative_path)
    lower = path.lower()
    suffixes = (
        ((".py", ".pyi"), ProofAdmissionGrammarId.PYTHON_AST_V1, ProofAdmissionInterpreter.PYTHON3),
        ((".sh", ".bash", ".zsh"), ProofAdmissionGrammarId.POSIX_SHELL_V1, ProofAdmissionInterpreter.POSIX_SH),
        ((".js", ".jsx", ".mjs", ".cjs"), ProofAdmissionGrammarId.ECMASCRIPT_V1, ProofAdmissionInterpreter.NODE),
        ((".ts", ".tsx"), ProofAdmissionGrammarId.TYPESCRIPT_V1, ProofAdmissionInterpreter.NODE),
        ((".rs",), ProofAdmissionGrammarId.RUST_V1, ProofAdmissionInterpreter.NATIVE),
        ((".go",), ProofAdmissionGrammarId.GO_V1, ProofAdmissionInterpreter.NATIVE),
        ((".c", ".h"), ProofAdmissionGrammarId.C_V1, ProofAdmissionInterpreter.NATIVE),
        ((".mk",), ProofAdmissionGrammarId.MAKE_V1, ProofAdmissionInterpreter.POSIX_SH),
        ((".toml",), ProofAdmissionGrammarId.TOML_V1, None),
        ((".json",), ProofAdmissionGrammarId.JSON_V1, None),
        ((".yaml", ".yml"), ProofAdmissionGrammarId.YAML_V1, None),
    )
    assignment = next(
        (
            (grammar, interpreter)
            for suffix_group, grammar, interpreter in suffixes
            if lower.endswith(suffix_group)
        ),
        None,
    )
    basename = path.rsplit("/", 1)[-1]
    if assignment is None and basename in {"Makefile", "GNUmakefile"}:
        assignment = (
            ProofAdmissionGrammarId.MAKE_V1,
            ProofAdmissionInterpreter.POSIX_SH,
        )
    if assignment is None and path.startswith(".github/workflows/"):
        assignment = (ProofAdmissionGrammarId.YAML_V1, None)
    if assignment is None and executable:
        shebang_pair = {
            ProofAdmissionInterpreter.PYTHON3: (
                ProofAdmissionGrammarId.PYTHON_AST_V1,
                ProofAdmissionInterpreter.PYTHON3,
            ),
            ProofAdmissionInterpreter.POSIX_SH: (
                ProofAdmissionGrammarId.POSIX_SHELL_V1,
                ProofAdmissionInterpreter.POSIX_SH,
            ),
            ProofAdmissionInterpreter.NODE: (
                ProofAdmissionGrammarId.ECMASCRIPT_V1,
                ProofAdmissionInterpreter.NODE,
            ),
        }.get(shebang_interpreter)
        assignment = shebang_pair or incoming_assignment
        if assignment is None:
            raise ValueError("extensionless executable requires a recognized assignment")
    if assignment is not None and incoming_assignment is not None:
        if assignment != incoming_assignment:
            raise ValueError("path/shebang and incoming assignments conflict")
    assignment = assignment or incoming_assignment
    if assignment is None:
        return (ProofAdmissionSourceClassification.OPAQUE_DATA, None, None)
    if assignment not in _VALID_GRAMMAR_INTERPRETER_PAIRS:
        raise ValueError("source assignment is not a valid grammar pair")
    return (ProofAdmissionSourceClassification.PARSED_SOURCE, *assignment)


@dataclass(frozen=True)
class ProofAdmissionSourceNode:
    __slots__ = (
        "repo_relative_path",
        "raw_file_sha256",
        "byte_length",
        "classification",
        "grammar_id",
        "interpreter_assignment",
        "forward_edges",
        "source_node_digest",
    )

    repo_relative_path: str
    raw_file_sha256: str
    byte_length: int
    classification: ProofAdmissionSourceClassification
    grammar_id: ProofAdmissionGrammarId | None
    interpreter_assignment: ProofAdmissionInterpreter | None
    forward_edges: tuple[ProofAdmissionSourceEdge, ...]
    source_node_digest: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "repoRelativePath",
            "rawFileSha256",
            "byteLength",
            "classification",
            "grammarId",
            "interpreterAssignment",
            "forwardEdges",
            "sourceNodeDigest",
        }
    )

    def __post_init__(self) -> None:
        validate_repo_relative_path(self.repo_relative_path)
        validate_sha256(self.raw_file_sha256)
        _validate_non_negative_integer(self.byte_length, field="byteLength")
        if type(self.classification) is not ProofAdmissionSourceClassification:
            raise ValueError("classification must be closed")
        if type(self.forward_edges) is not tuple or not all(
            type(edge) is ProofAdmissionSourceEdge for edge in self.forward_edges
        ):
            raise ValueError("forwardEdges must be a typed immutable tuple")
        if self.forward_edges != tuple(sorted(self.forward_edges, key=_source_edge_key)):
            raise ValueError("forwardEdges must be in canonical lexical order")
        edge_keys = tuple(_source_edge_key(edge) for edge in self.forward_edges)
        if len(edge_keys) != len(set(edge_keys)):
            raise ValueError("forwardEdges contains duplicate edges")
        pair = (self.grammar_id, self.interpreter_assignment)
        if self.classification is ProofAdmissionSourceClassification.OPAQUE_DATA:
            if pair != (None, None) or self.forward_edges:
                raise ValueError("OPAQUE_DATA must have no grammar, interpreter, or edges")
        elif pair not in _VALID_GRAMMAR_INTERPRETER_PAIRS:
            raise ValueError("PARSED_SOURCE requires a valid grammar pair")
        validate_sha256(self.source_node_digest)
        if self.source_node_digest != self.expected_digest():
            raise ValueError("sourceNodeDigest does not match source node")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "repoRelativePath": self.repo_relative_path,
            "rawFileSha256": self.raw_file_sha256,
            "byteLength": self.byte_length,
            "classification": self.classification.value,
            "grammarId": None if self.grammar_id is None else self.grammar_id.value,
            "interpreterAssignment": (
                None
                if self.interpreter_assignment is None
                else self.interpreter_assignment.value
            ),
            "forwardEdges": [edge.to_dict() for edge in self.forward_edges],
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_PROOF_SOURCE_NODE_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "sourceNodeDigest": self.source_node_digest}

    @classmethod
    def create(cls, **values: object) -> "ProofAdmissionSourceNode":
        if (
            type(values.get("classification"))
            is not ProofAdmissionSourceClassification
            or type(values.get("forward_edges")) is not tuple
            or any(
                type(edge) is not ProofAdmissionSourceEdge
                for edge in values["forward_edges"]
            )
        ):
            raise ValueError(
                "source node inputs must use concrete contract types"
            )
        payload = {
            "repoRelativePath": values["repo_relative_path"],
            "rawFileSha256": values["raw_file_sha256"],
            "byteLength": values["byte_length"],
            "classification": values["classification"].value,
            "grammarId": None if values["grammar_id"] is None else values["grammar_id"].value,
            "interpreterAssignment": (
                None
                if values["interpreter_assignment"] is None
                else values["interpreter_assignment"].value
            ),
            "forwardEdges": [edge.to_dict() for edge in values["forward_edges"]],
        }
        return cls(
            **values,
            source_node_digest=domain_separated_sha256(_PROOF_SOURCE_NODE_DOMAIN, payload),
        )

    @classmethod
    def from_dict(cls, value: object) -> "ProofAdmissionSourceNode":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        edges = data["forwardEdges"]
        if not isinstance(edges, list):
            raise ValueError("forwardEdges must be an array")
        return cls(
            repo_relative_path=data["repoRelativePath"],
            raw_file_sha256=data["rawFileSha256"],
            byte_length=data["byteLength"],
            classification=_enum_from_wire(
                ProofAdmissionSourceClassification,
                data["classification"],
                field="classification",
            ),
            grammar_id=_enum_or_none(
                ProofAdmissionGrammarId, data["grammarId"], field="grammarId"
            ),
            interpreter_assignment=_enum_or_none(
                ProofAdmissionInterpreter,
                data["interpreterAssignment"],
                field="interpreterAssignment",
            ),
            forward_edges=tuple(
                ProofAdmissionSourceEdge.from_dict(edge) for edge in edges
            ),
            source_node_digest=data["sourceNodeDigest"],
        )


def proof_admission_source_digest(
    nodes: tuple[ProofAdmissionSourceNode, ...],
) -> str:
    """Validate a closed source graph and digest its canonical node inventory."""
    if type(nodes) is not tuple or not nodes:
        raise ValueError("proof-admission source inventory must not be empty")
    if not all(type(node) is ProofAdmissionSourceNode for node in nodes):
        raise ValueError("proof-admission source inventory must contain typed nodes")
    paths = tuple(node.repo_relative_path for node in nodes)
    if paths != tuple(sorted(paths, key=lambda item: item.encode("utf-8"))):
        raise ValueError("proof-admission source nodes must be in lexical path order")
    if len(paths) != len(set(paths)):
        raise ValueError("proof-admission source inventory contains duplicate paths")
    by_path = {node.repo_relative_path: node for node in nodes}
    incoming: dict[
        str,
        tuple[ProofAdmissionGrammarId, ProofAdmissionInterpreter | None],
    ] = {}
    for node in nodes:
        for edge in node.forward_edges:
            target = by_path.get(edge.target_path)
            if target is None:
                raise ValueError("source edge target is absent from the inventory")
            if edge.edge_kind is ProofAdmissionEdgeKind.DATA_READ:
                continue
            assignment = (
                edge.assigned_grammar_id,
                edge.assigned_interpreter,
            )
            previous = incoming.setdefault(edge.target_path, assignment)
            if previous != assignment:
                raise ValueError("incoming source edge assignments conflict")
            if target.classification is not ProofAdmissionSourceClassification.PARSED_SOURCE:
                raise ValueError("non-data source edge cannot target OPAQUE_DATA")
            if assignment != (target.grammar_id, target.interpreter_assignment):
                raise ValueError("source edge assignment does not match target node")
    return domain_separated_sha256(
        _PROOF_ADMISSION_SOURCE_DOMAIN,
        [node.to_dict() for node in nodes],
    )


@dataclass(frozen=True)
class DarwinProcessStartIdentity:
    __slots__ = ("os_family", "boot_session_uuid", "start_seconds", "start_microseconds")
    os_family: RuntimeOsFamily
    boot_session_uuid: str
    start_seconds: str
    start_microseconds: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {"osFamily", "bootSessionUuid", "startSeconds", "startMicroseconds"}
    )

    def __post_init__(self) -> None:
        if self.os_family is not RuntimeOsFamily.DARWIN:
            raise ValueError("Darwin process start osFamily must be DARWIN")
        _validate_non_empty_utf8(self.boot_session_uuid, field="bootSessionUuid")
        _validate_uint_string(self.start_seconds, field="startSeconds")
        _validate_uint_string(self.start_microseconds, field="startMicroseconds")

    def to_dict(self) -> dict[str, object]:
        return {
            "osFamily": self.os_family.value,
            "bootSessionUuid": self.boot_session_uuid,
            "startSeconds": self.start_seconds,
            "startMicroseconds": self.start_microseconds,
        }

    @classmethod
    def create(cls, **values: object) -> "DarwinProcessStartIdentity":
        return cls(os_family=RuntimeOsFamily.DARWIN, **values)

    @classmethod
    def from_dict(cls, value: object) -> "DarwinProcessStartIdentity":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            os_family=_enum_from_wire(RuntimeOsFamily, data["osFamily"], field="osFamily"),
            boot_session_uuid=data["bootSessionUuid"],
            start_seconds=data["startSeconds"],
            start_microseconds=data["startMicroseconds"],
        )


@dataclass(frozen=True)
class LinuxProcessStartIdentity:
    __slots__ = ("os_family", "boot_id", "start_clock_ticks")
    os_family: RuntimeOsFamily
    boot_id: str
    start_clock_ticks: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {"osFamily", "bootId", "startClockTicks"}
    )

    def __post_init__(self) -> None:
        if self.os_family is not RuntimeOsFamily.LINUX:
            raise ValueError("Linux process start osFamily must be LINUX")
        _validate_non_empty_utf8(self.boot_id, field="bootId")
        _validate_uint_string(self.start_clock_ticks, field="startClockTicks")

    def to_dict(self) -> dict[str, object]:
        return {
            "osFamily": self.os_family.value,
            "bootId": self.boot_id,
            "startClockTicks": self.start_clock_ticks,
        }

    @classmethod
    def create(cls, **values: object) -> "LinuxProcessStartIdentity":
        return cls(os_family=RuntimeOsFamily.LINUX, **values)

    @classmethod
    def from_dict(cls, value: object) -> "LinuxProcessStartIdentity":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            os_family=_enum_from_wire(RuntimeOsFamily, data["osFamily"], field="osFamily"),
            boot_id=data["bootId"],
            start_clock_ticks=data["startClockTicks"],
        )


ProcessStartIdentity = Union[DarwinProcessStartIdentity, LinuxProcessStartIdentity]


def process_start_identity_from_dict(value: object) -> ProcessStartIdentity:
    if not isinstance(value, Mapping):
        raise ValueError("ProcessStartIdentity must be an object")
    if value.get("osFamily") == RuntimeOsFamily.DARWIN.value:
        return DarwinProcessStartIdentity.from_dict(value)
    if value.get("osFamily") == RuntimeOsFamily.LINUX.value:
        return LinuxProcessStartIdentity.from_dict(value)
    raise ValueError("ProcessStartIdentity osFamily is not closed")


@dataclass(frozen=True)
class PosixWaitStatus:
    __slots__ = ("terminal_kind", "exit_code", "term_signal", "core_dumped")
    terminal_kind: PosixTerminalKind
    exit_code: int | None
    term_signal: int | None
    core_dumped: bool
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {"terminalKind", "exitCode", "termSignal", "coreDumped"}
    )

    def __post_init__(self) -> None:
        if self.terminal_kind is PosixTerminalKind.EXITED:
            if (
                not isinstance(self.exit_code, int)
                or isinstance(self.exit_code, bool)
                or not 0 <= self.exit_code <= 255
                or self.term_signal is not None
                or self.core_dumped is not False
            ):
                raise ValueError("EXITED wait status branch is invalid")
        elif self.terminal_kind is PosixTerminalKind.SIGNALED:
            if self.exit_code is not None or not isinstance(self.core_dumped, bool):
                raise ValueError("SIGNALED wait status branch is invalid")
            _validate_positive_integer(self.term_signal, field="termSignal")
        else:
            raise ValueError("terminalKind must be closed")

    def to_dict(self) -> dict[str, object]:
        return {
            "terminalKind": self.terminal_kind.value,
            "exitCode": self.exit_code,
            "termSignal": self.term_signal,
            "coreDumped": self.core_dumped,
        }

    @classmethod
    def create_exited(cls, exit_code: int) -> "PosixWaitStatus":
        return cls(PosixTerminalKind.EXITED, exit_code, None, False)

    @classmethod
    def create_signaled(cls, term_signal: int, core_dumped: bool) -> "PosixWaitStatus":
        return cls(PosixTerminalKind.SIGNALED, None, term_signal, core_dumped)

    @classmethod
    def from_dict(cls, value: object) -> "PosixWaitStatus":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            terminal_kind=_enum_from_wire(
                PosixTerminalKind, data["terminalKind"], field="terminalKind"
            ),
            exit_code=data["exitCode"],
            term_signal=data["termSignal"],
            core_dumped=data["coreDumped"],
        )


PosixExitedStatus = PosixWaitStatus
PosixSignaledStatus = PosixWaitStatus


@dataclass(frozen=True)
class ConsumingChildWaitEvidence:
    __slots__ = (
        "waiter_pid", "waiter_process_start_identity", "child_pid",
        "child_process_start_identity", "wait_api", "wait_options",
        "returned_pid", "status", "status_consumed", "waited_at",
        "wait_evidence_digest",
    )
    waiter_pid: int
    waiter_process_start_identity: ProcessStartIdentity
    child_pid: int
    child_process_start_identity: ProcessStartIdentity
    wait_api: str
    wait_options: int
    returned_pid: int
    status: PosixWaitStatus
    status_consumed: bool
    waited_at: str
    wait_evidence_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "waiterPid", "waiterProcessStartIdentity", "childPid",
            "childProcessStartIdentity", "waitApi", "waitOptions",
            "returnedPid", "status", "statusConsumed", "waitedAt",
            "waitEvidenceDigest",
        }
    )

    def __post_init__(self) -> None:
        _validate_positive_integer(self.waiter_pid, field="waiterPid")
        _validate_positive_integer(self.child_pid, field="childPid")
        _validate_positive_integer(self.returned_pid, field="returnedPid")
        if self.returned_pid != self.child_pid:
            raise ValueError("returnedPid must equal childPid")
        if (
            type(self.waiter_process_start_identity)
            not in (DarwinProcessStartIdentity, LinuxProcessStartIdentity)
            or type(self.child_process_start_identity)
            not in (DarwinProcessStartIdentity, LinuxProcessStartIdentity)
            or self.waiter_process_start_identity.os_family
            is not self.child_process_start_identity.os_family
        ):
            raise ValueError("wait process identities must use one OS branch")
        if self.wait_api != "WAITPID" or self.wait_options != 0:
            raise ValueError("consuming child wait must use waitpid options 0")
        if type(self.status) is not PosixWaitStatus or self.status_consumed is not True:
            raise ValueError("wait status must be typed and consumed")
        _canonical_utc_instant(self.waited_at, field="waitedAt")
        validate_sha256(self.wait_evidence_digest)
        if self.wait_evidence_digest != self.expected_digest():
            raise ValueError("waitEvidenceDigest does not match wait evidence")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "waiterPid": self.waiter_pid,
            "waiterProcessStartIdentity": self.waiter_process_start_identity.to_dict(),
            "childPid": self.child_pid,
            "childProcessStartIdentity": self.child_process_start_identity.to_dict(),
            "waitApi": self.wait_api,
            "waitOptions": self.wait_options,
            "returnedPid": self.returned_pid,
            "status": self.status.to_dict(),
            "statusConsumed": self.status_consumed,
            "waitedAt": self.waited_at,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_CONSUMING_WAIT_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "waitEvidenceDigest": self.wait_evidence_digest}

    @classmethod
    def create(cls, **values: object) -> "ConsumingChildWaitEvidence":
        if (
            type(values.get("waiter_process_start_identity"))
            not in (DarwinProcessStartIdentity, LinuxProcessStartIdentity)
            or type(values.get("child_process_start_identity"))
            not in (DarwinProcessStartIdentity, LinuxProcessStartIdentity)
            or type(values.get("status")) is not PosixWaitStatus
        ):
            raise ValueError("wait inputs must use concrete contract types")
        values = {"wait_api": "WAITPID", "wait_options": 0, "status_consumed": True, **values}
        payload = {
            "waiterPid": values["waiter_pid"],
            "waiterProcessStartIdentity": values["waiter_process_start_identity"].to_dict(),
            "childPid": values["child_pid"],
            "childProcessStartIdentity": values["child_process_start_identity"].to_dict(),
            "waitApi": values["wait_api"],
            "waitOptions": values["wait_options"],
            "returnedPid": values["returned_pid"],
            "status": values["status"].to_dict(),
            "statusConsumed": values["status_consumed"],
            "waitedAt": values["waited_at"],
        }
        return cls(**values, wait_evidence_digest=domain_separated_sha256(_CONSUMING_WAIT_DOMAIN, payload))

    @classmethod
    def from_dict(cls, value: object) -> "ConsumingChildWaitEvidence":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            waiter_pid=data["waiterPid"],
            waiter_process_start_identity=process_start_identity_from_dict(data["waiterProcessStartIdentity"]),
            child_pid=data["childPid"],
            child_process_start_identity=process_start_identity_from_dict(data["childProcessStartIdentity"]),
            wait_api=data["waitApi"],
            wait_options=data["waitOptions"],
            returned_pid=data["returnedPid"],
            status=PosixWaitStatus.from_dict(data["status"]),
            status_consumed=data["statusConsumed"],
            waited_at=data["waitedAt"],
            wait_evidence_digest=data["waitEvidenceDigest"],
        )


@dataclass(frozen=True)
class ClaimEmitterInput:
    __slots__ = ("binding_name", "resolution", "encoded_utf8_base64", "input_digest")
    binding_name: str
    resolution: AuthoritativeLatestResolution
    encoded_utf8_base64: str
    input_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {"bindingName", "resolution", "encodedUtf8Base64", "inputDigest"}
    )

    def __post_init__(self) -> None:
        if self.binding_name != "authoritative_input":
            raise ValueError("bindingName must be authoritative_input")
        if type(self.resolution) is not AuthoritativeLatestResolution:
            raise ValueError("resolution must be AuthoritativeLatestResolution")
        if self.encoded_utf8_base64 != _canonical_resolution_base64(self.resolution):
            raise ValueError("encodedUtf8Base64 must encode the exact resolution")
        validate_sha256(self.input_digest)
        if self.input_digest != self.expected_digest():
            raise ValueError("inputDigest does not match claim input")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "bindingName": self.binding_name,
            "resolution": self.resolution.to_dict(),
            "encodedUtf8Base64": self.encoded_utf8_base64,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_CLAIM_INPUT_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "inputDigest": self.input_digest}

    @classmethod
    def create(cls, *, resolution: AuthoritativeLatestResolution) -> "ClaimEmitterInput":
        if type(resolution) is not AuthoritativeLatestResolution:
            raise ValueError("resolution must be AuthoritativeLatestResolution")
        encoded = _canonical_resolution_base64(resolution)
        payload = {
            "bindingName": "authoritative_input",
            "resolution": resolution.to_dict(),
            "encodedUtf8Base64": encoded,
        }
        return cls("authoritative_input", resolution, encoded, domain_separated_sha256(_CLAIM_INPUT_DOMAIN, payload))

    @classmethod
    def from_dict(cls, value: object) -> "ClaimEmitterInput":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            data["bindingName"],
            AuthoritativeLatestResolution.from_dict(data["resolution"]),
            data["encodedUtf8Base64"],
            data["inputDigest"],
        )


@dataclass(frozen=True)
class ClaimEmitterOutput:
    __slots__ = ("binding_name", "resolution", "encoded_utf8_base64", "output_digest")
    binding_name: str
    resolution: AuthoritativeLatestResolution
    encoded_utf8_base64: str
    output_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {"bindingName", "resolution", "encodedUtf8Base64", "outputDigest"}
    )

    def __post_init__(self) -> None:
        if self.binding_name != "authoritative_result":
            raise ValueError("bindingName must be authoritative_result")
        if type(self.resolution) is not AuthoritativeLatestResolution:
            raise ValueError("resolution must be AuthoritativeLatestResolution")
        if self.encoded_utf8_base64 != _canonical_resolution_base64(self.resolution):
            raise ValueError("encodedUtf8Base64 must encode the exact resolution")
        validate_sha256(self.output_digest)
        if self.output_digest != self.expected_digest():
            raise ValueError("outputDigest does not match claim output")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "bindingName": self.binding_name,
            "resolution": self.resolution.to_dict(),
            "encodedUtf8Base64": self.encoded_utf8_base64,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_CLAIM_OUTPUT_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "outputDigest": self.output_digest}

    @classmethod
    def create(cls, *, resolution: AuthoritativeLatestResolution) -> "ClaimEmitterOutput":
        if type(resolution) is not AuthoritativeLatestResolution:
            raise ValueError("resolution must be AuthoritativeLatestResolution")
        encoded = _canonical_resolution_base64(resolution)
        payload = {
            "bindingName": "authoritative_result",
            "resolution": resolution.to_dict(),
            "encodedUtf8Base64": encoded,
        }
        return cls("authoritative_result", resolution, encoded, domain_separated_sha256(_CLAIM_OUTPUT_DOMAIN, payload))

    @classmethod
    def from_dict(cls, value: object) -> "ClaimEmitterOutput":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            data["bindingName"],
            AuthoritativeLatestResolution.from_dict(data["resolution"]),
            data["encodedUtf8Base64"],
            data["outputDigest"],
        )


CLAIM_EMITTER_PRELOADED_FACADES_V1 = ("canonical_json",)
CLAIM_EMITTER_BUILTIN_ALLOWLIST_V1 = (
    "None", "True", "False", "bool", "dict", "int", "len", "list", "range",
    "str", "tuple",
)
CLAIM_EMITTER_AST_ALLOWLIST_V1 = (
    "Module", "Expr", "Assign", "Name", "Load", "Store", "Constant", "Dict",
    "List", "Tuple", "If", "Compare", "BoolOp", "UnaryOp", "Call", "Attribute",
)


@dataclass(frozen=True)
class ForbiddenProcessApiRule:
    __slots__ = ("grammar_id", "operation_id", "canonical_symbols", "rule_digest")
    grammar_id: ProofAdmissionGrammarId
    operation_id: ForbiddenProcessOperation
    canonical_symbols: tuple[str, ...]
    rule_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {"grammarId", "operationId", "canonicalSymbols", "ruleDigest"}
    )

    def __post_init__(self) -> None:
        if self.grammar_id is not ProofAdmissionGrammarId.PYTHON_AST_V1:
            raise ValueError("forbidden process API rule grammar must be PYTHON_AST_V1")
        if not isinstance(self.operation_id, ForbiddenProcessOperation):
            raise ValueError("operationId must be closed")
        _validate_lexical_tuple(
            self.canonical_symbols,
            field="canonicalSymbols",
            item_validator=lambda item: _validate_non_empty_utf8(
                item, field="canonicalSymbol", maximum_bytes=256
            ),
            allow_empty=False,
        )
        validate_sha256(self.rule_digest)
        if self.rule_digest != self.expected_digest():
            raise ValueError("ruleDigest does not match forbidden API rule")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "grammarId": self.grammar_id.value,
            "operationId": self.operation_id.value,
            "canonicalSymbols": list(self.canonical_symbols),
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_FORBIDDEN_RULE_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "ruleDigest": self.rule_digest}

    @classmethod
    def create(
        cls,
        *,
        operation_id: ForbiddenProcessOperation,
        canonical_symbols: tuple[str, ...],
    ) -> "ForbiddenProcessApiRule":
        payload = {
            "grammarId": ProofAdmissionGrammarId.PYTHON_AST_V1.value,
            "operationId": operation_id.value,
            "canonicalSymbols": list(canonical_symbols),
        }
        return cls(
            ProofAdmissionGrammarId.PYTHON_AST_V1,
            operation_id,
            canonical_symbols,
            domain_separated_sha256(_FORBIDDEN_RULE_DOMAIN, payload),
        )

    @classmethod
    def from_dict(cls, value: object) -> "ForbiddenProcessApiRule":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        symbols = data["canonicalSymbols"]
        if not isinstance(symbols, list):
            raise ValueError("canonicalSymbols must be an array")
        return cls(
            _enum_from_wire(
                ProofAdmissionGrammarId, data["grammarId"], field="grammarId"
            ),
            _enum_from_wire(
                ForbiddenProcessOperation, data["operationId"], field="operationId"
            ),
            tuple(symbols),
            data["ruleDigest"],
        )


_FORBIDDEN_PROCESS_API_SYMBOLS: dict[ForbiddenProcessOperation, tuple[str, ...]] = {
    ForbiddenProcessOperation.CREATE_PROCESS: tuple(
        sorted(
            (
                "subprocess", "multiprocessing", "os.fork", "os.forkpty",
                "os.vfork", "os.posix_spawn", "os.posix_spawnp",
                "asyncio.create_subprocess_exec",
                "asyncio.create_subprocess_shell", "pty.fork", "os.spawnl",
                "os.spawnle", "os.spawnlp", "os.spawnlpe", "os.spawnv",
                "os.spawnve", "os.spawnvp", "os.spawnvpe", "posix.fork",
                "posix.forkpty", "posix.posix_spawn", "posix.posix_spawnp",
            ),
            key=lambda item: item.encode("utf-8"),
        )
    ),
    ForbiddenProcessOperation.REPLACE_PROCESS_IMAGE: tuple(
        sorted(
            (
                "os.execl", "os.execle", "os.execlp", "os.execlpe", "os.execv",
                "os.execve", "os.execvp", "os.execvpe", "posix.execv",
                "posix.execve",
            ),
            key=lambda item: item.encode("utf-8"),
        )
    ),
    ForbiddenProcessOperation.EXEC_SHELL: tuple(
        sorted(
            (
                "os.system", "os.popen", "pty.spawn", "subprocess shell=True",
                "posix.system",
            ),
            key=lambda item: item.encode("utf-8"),
        )
    ),
    ForbiddenProcessOperation.CREATE_SESSION: ("os.setsid", "posix.setsid"),
    ForbiddenProcessOperation.CHANGE_PROCESS_GROUP: (
        "os.setpgid", "posix.setpgid",
    ),
    ForbiddenProcessOperation.DYNAMIC_SYMBOL_RESOLUTION: tuple(
        sorted(
            ("importlib", "__import__", "eval", "exec", "ctypes", "cffi"),
            key=lambda item: item.encode("utf-8"),
        )
    ),
    ForbiddenProcessOperation.LOAD_NATIVE_EXTENSION: (
        "any non-source module loader or extension-module origin",
    ),
}


def canonical_forbidden_process_api_registry(
) -> tuple[ForbiddenProcessApiRule, ...]:
    return tuple(
        ForbiddenProcessApiRule.create(
            operation_id=operation,
            canonical_symbols=symbols,
        )
        for operation, symbols in sorted(
            _FORBIDDEN_PROCESS_API_SYMBOLS.items(),
            key=lambda item: item[0].value.encode("utf-8"),
        )
    )


def forbidden_process_api_registry_digest(
    rules: tuple[ForbiddenProcessApiRule, ...],
) -> str:
    if not isinstance(rules, tuple) or not rules:
        raise ValueError("rule registry must be a non-empty immutable tuple")
    key = lambda rule: (
        rule.grammar_id.value.encode("utf-8"),
        rule.operation_id.value.encode("utf-8"),
    )
    if not all(isinstance(rule, ForbiddenProcessApiRule) for rule in rules):
        raise ValueError("rule registry entries must be typed rules")
    if rules != tuple(sorted(rules, key=key)):
        raise ValueError("rule registry must be in grammar/operation lexical order")
    if len({key(rule) for rule in rules}) != len(rules):
        raise ValueError("rule registry contains duplicate operations")
    return domain_separated_sha256(
        _FORBIDDEN_REGISTRY_DOMAIN,
        [rule.to_dict() for rule in rules],
    )


@dataclass(frozen=True)
class PythonScannerInterpreterIdentity:
    __slots__ = (
        "host_os_family", "host_build", "host_identity", "executable_path_hash",
        "executable_sha256", "implementation", "version",
        "ast_grammar_feature_version", "stdlib_digest", "scanner_runtime_digest",
    )
    host_os_family: RuntimeOsFamily
    host_build: RuntimeHostBuild
    host_identity: RuntimeHostIdentity
    executable_path_hash: str
    executable_sha256: str
    implementation: str
    version: str
    ast_grammar_feature_version: str
    stdlib_digest: str
    scanner_runtime_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "hostOsFamily", "hostBuild", "hostIdentity", "executablePathHash",
            "executableSha256", "implementation", "version",
            "astGrammarFeatureVersion", "stdlibDigest", "scannerRuntimeDigest",
        }
    )

    def __post_init__(self) -> None:
        _validate_host_pair(self.host_os_family, self.host_build, self.host_identity)
        for value in (
            self.executable_path_hash,
            self.executable_sha256,
            self.stdlib_digest,
        ):
            validate_sha256(value)
        for field, value in (
            ("implementation", self.implementation),
            ("version", self.version),
            ("astGrammarFeatureVersion", self.ast_grammar_feature_version),
        ):
            _validate_non_empty_utf8(value, field=field, maximum_bytes=256)
        validate_sha256(self.scanner_runtime_digest)
        if self.scanner_runtime_digest != self.expected_digest():
            raise ValueError("scannerRuntimeDigest does not match interpreter")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "hostOsFamily": self.host_os_family.value,
            "hostBuild": self.host_build.to_dict(),
            "hostIdentity": self.host_identity.to_dict(),
            "executablePathHash": self.executable_path_hash,
            "executableSha256": self.executable_sha256,
            "implementation": self.implementation,
            "version": self.version,
            "astGrammarFeatureVersion": self.ast_grammar_feature_version,
            "stdlibDigest": self.stdlib_digest,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_SCANNER_RUNTIME_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "scannerRuntimeDigest": self.scanner_runtime_digest}

    @classmethod
    def create(cls, **values: object) -> "PythonScannerInterpreterIdentity":
        payload = {
            "hostOsFamily": values["host_os_family"].value,
            "hostBuild": values["host_build"].to_dict(),
            "hostIdentity": values["host_identity"].to_dict(),
            "executablePathHash": values["executable_path_hash"],
            "executableSha256": values["executable_sha256"],
            "implementation": values["implementation"],
            "version": values["version"],
            "astGrammarFeatureVersion": values["ast_grammar_feature_version"],
            "stdlibDigest": values["stdlib_digest"],
        }
        return cls(**values, scanner_runtime_digest=domain_separated_sha256(_SCANNER_RUNTIME_DOMAIN, payload))

    @classmethod
    def from_dict(cls, value: object) -> "PythonScannerInterpreterIdentity":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            host_os_family=_enum_from_wire(RuntimeOsFamily, data["hostOsFamily"], field="hostOsFamily"),
            host_build=runtime_host_build_from_dict(data["hostBuild"]),
            host_identity=runtime_host_identity_from_dict(data["hostIdentity"]),
            executable_path_hash=data["executablePathHash"],
            executable_sha256=data["executableSha256"],
            implementation=data["implementation"],
            version=data["version"],
            ast_grammar_feature_version=data["astGrammarFeatureVersion"],
            stdlib_digest=data["stdlibDigest"],
            scanner_runtime_digest=data["scannerRuntimeDigest"],
        )


@dataclass(frozen=True)
class ForbiddenProcessApiScan:
    __slots__ = (
        "policy", "scanner_rule", "scanner_source_rule", "scanner_entrypoint_path",
        "scanner_entrypoint_function", "scanner_source_files",
        "scanner_source_digest", "scanner_interpreter", "scanner_runtime_digest",
        "allowed_preloaded_facades", "allowed_builtins", "allowed_ast_nodes",
        "input_contract", "output_contract", "proof_admission_source_digest",
        "inspected_nodes", "rule_registry", "rule_registry_digest", "findings",
        "forbidden_process_api_scan_digest",
    )
    policy: str
    scanner_rule: str
    scanner_source_rule: str
    scanner_entrypoint_path: str
    scanner_entrypoint_function: str
    scanner_source_files: tuple[tuple[str, str, int], ...]
    scanner_source_digest: str
    scanner_interpreter: PythonScannerInterpreterIdentity
    scanner_runtime_digest: str
    allowed_preloaded_facades: tuple[str, ...]
    allowed_builtins: tuple[str, ...]
    allowed_ast_nodes: tuple[str, ...]
    input_contract: str
    output_contract: str
    proof_admission_source_digest: str
    inspected_nodes: tuple[tuple[str, str], ...]
    rule_registry: tuple[ForbiddenProcessApiRule, ...]
    rule_registry_digest: str
    findings: tuple[()]
    forbidden_process_api_scan_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "policy", "scannerRule", "scannerSourceRule", "scannerEntrypointPath",
            "scannerEntrypointFunction", "scannerSourceFiles",
            "scannerSourceDigest", "scannerInterpreter", "scannerRuntimeDigest",
            "allowedPreloadedFacades", "allowedBuiltins", "allowedAstNodes",
            "inputContract", "outputContract", "proofAdmissionSourceDigest",
            "inspectedNodes", "ruleRegistry", "ruleRegistryDigest", "findings",
            "forbiddenProcessApiScanDigest",
        }
    )

    def __post_init__(self) -> None:
        fixed = (
            (self.policy, _PROOF_PROCESS_POLICY),
            (self.scanner_rule, "FORBIDDEN_PROCESS_API_SCANNER_V1"),
            (self.scanner_source_rule, "FORBIDDEN_PROCESS_API_SCANNER_SOURCE_V1"),
            (self.scanner_entrypoint_path, "tooling/acceptance/core/proof_admission.py"),
            (self.scanner_entrypoint_function, "scan_forbidden_process_apis"),
            (self.input_contract, "AUTHORITATIVE_RESOLUTION_INPUT_V1"),
            (self.output_contract, "AUTHORITATIVE_RESULT_BINDING_V1"),
        )
        if any(actual != expected for actual, expected in fixed):
            raise ValueError("forbidden process scan fixed contract fields changed")
        _validate_source_file_tuple(self.scanner_source_files, field="scannerSourceFiles")
        expected_source_digest = domain_separated_sha256(
            _SCANNER_SOURCE_DOMAIN,
            _source_file_tuple_to_wire(self.scanner_source_files),
        )
        if self.scanner_source_digest != expected_source_digest:
            raise ValueError("scannerSourceDigest does not match scanner sources")
        if not isinstance(self.scanner_interpreter, PythonScannerInterpreterIdentity):
            raise ValueError("scannerInterpreter must be typed")
        if self.scanner_runtime_digest != self.scanner_interpreter.scanner_runtime_digest:
            raise ValueError("scannerRuntimeDigest does not match interpreter")
        if self.allowed_preloaded_facades != CLAIM_EMITTER_PRELOADED_FACADES_V1:
            raise ValueError("allowedPreloadedFacades must equal the v1 allowlist")
        if self.allowed_builtins != CLAIM_EMITTER_BUILTIN_ALLOWLIST_V1:
            raise ValueError("allowedBuiltins must equal the v1 allowlist")
        if self.allowed_ast_nodes != CLAIM_EMITTER_AST_ALLOWLIST_V1:
            raise ValueError("allowedAstNodes must equal the v1 allowlist")
        validate_sha256(self.proof_admission_source_digest)
        _validate_file_identity_tuple(self.inspected_nodes, field="inspectedNodes")
        expected_registry = forbidden_process_api_registry_digest(self.rule_registry)
        if self.rule_registry_digest != expected_registry:
            raise ValueError("ruleRegistryDigest does not match registry")
        if self.rule_registry != canonical_forbidden_process_api_registry():
            raise ValueError("ruleRegistry must equal FORBIDDEN_PROCESS_API_SCANNER_V1")
        if self.findings != ():
            raise ValueError("findings must be the exact empty tuple")
        validate_sha256(self.forbidden_process_api_scan_digest)
        if self.forbidden_process_api_scan_digest != self.expected_digest():
            raise ValueError("forbiddenProcessApiScanDigest does not match scan")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "policy": self.policy,
            "scannerRule": self.scanner_rule,
            "scannerSourceRule": self.scanner_source_rule,
            "scannerEntrypointPath": self.scanner_entrypoint_path,
            "scannerEntrypointFunction": self.scanner_entrypoint_function,
            "scannerSourceFiles": _source_file_tuple_to_wire(self.scanner_source_files),
            "scannerSourceDigest": self.scanner_source_digest,
            "scannerInterpreter": self.scanner_interpreter.to_dict(),
            "scannerRuntimeDigest": self.scanner_runtime_digest,
            "allowedPreloadedFacades": list(self.allowed_preloaded_facades),
            "allowedBuiltins": list(self.allowed_builtins),
            "allowedAstNodes": list(self.allowed_ast_nodes),
            "inputContract": self.input_contract,
            "outputContract": self.output_contract,
            "proofAdmissionSourceDigest": self.proof_admission_source_digest,
            "inspectedNodes": _role_identities_to_wire(self.inspected_nodes),
            "ruleRegistry": [rule.to_dict() for rule in self.rule_registry],
            "ruleRegistryDigest": self.rule_registry_digest,
            "findings": [],
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_FORBIDDEN_SCAN_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "forbiddenProcessApiScanDigest": self.forbidden_process_api_scan_digest}

    @classmethod
    def create(
        cls,
        *,
        scanner_source_files: tuple[tuple[str, str, int], ...],
        scanner_interpreter: PythonScannerInterpreterIdentity,
        proof_admission_source_digest: str,
        inspected_nodes: tuple[tuple[str, str], ...],
        rule_registry: tuple[ForbiddenProcessApiRule, ...],
    ) -> "ForbiddenProcessApiScan":
        source_digest = domain_separated_sha256(
            _SCANNER_SOURCE_DOMAIN,
            _source_file_tuple_to_wire(scanner_source_files),
        )
        registry_digest = forbidden_process_api_registry_digest(rule_registry)
        payload = {
            "policy": _PROOF_PROCESS_POLICY,
            "scannerRule": "FORBIDDEN_PROCESS_API_SCANNER_V1",
            "scannerSourceRule": "FORBIDDEN_PROCESS_API_SCANNER_SOURCE_V1",
            "scannerEntrypointPath": "tooling/acceptance/core/proof_admission.py",
            "scannerEntrypointFunction": "scan_forbidden_process_apis",
            "scannerSourceFiles": _source_file_tuple_to_wire(scanner_source_files),
            "scannerSourceDigest": source_digest,
            "scannerInterpreter": scanner_interpreter.to_dict(),
            "scannerRuntimeDigest": scanner_interpreter.scanner_runtime_digest,
            "allowedPreloadedFacades": list(CLAIM_EMITTER_PRELOADED_FACADES_V1),
            "allowedBuiltins": list(CLAIM_EMITTER_BUILTIN_ALLOWLIST_V1),
            "allowedAstNodes": list(CLAIM_EMITTER_AST_ALLOWLIST_V1),
            "inputContract": "AUTHORITATIVE_RESOLUTION_INPUT_V1",
            "outputContract": "AUTHORITATIVE_RESULT_BINDING_V1",
            "proofAdmissionSourceDigest": proof_admission_source_digest,
            "inspectedNodes": _role_identities_to_wire(inspected_nodes),
            "ruleRegistry": [rule.to_dict() for rule in rule_registry],
            "ruleRegistryDigest": registry_digest,
            "findings": [],
        }
        return cls(
            policy=_PROOF_PROCESS_POLICY,
            scanner_rule="FORBIDDEN_PROCESS_API_SCANNER_V1",
            scanner_source_rule="FORBIDDEN_PROCESS_API_SCANNER_SOURCE_V1",
            scanner_entrypoint_path="tooling/acceptance/core/proof_admission.py",
            scanner_entrypoint_function="scan_forbidden_process_apis",
            scanner_source_files=scanner_source_files,
            scanner_source_digest=source_digest,
            scanner_interpreter=scanner_interpreter,
            scanner_runtime_digest=scanner_interpreter.scanner_runtime_digest,
            allowed_preloaded_facades=CLAIM_EMITTER_PRELOADED_FACADES_V1,
            allowed_builtins=CLAIM_EMITTER_BUILTIN_ALLOWLIST_V1,
            allowed_ast_nodes=CLAIM_EMITTER_AST_ALLOWLIST_V1,
            input_contract="AUTHORITATIVE_RESOLUTION_INPUT_V1",
            output_contract="AUTHORITATIVE_RESULT_BINDING_V1",
            proof_admission_source_digest=proof_admission_source_digest,
            inspected_nodes=inspected_nodes,
            rule_registry=rule_registry,
            rule_registry_digest=registry_digest,
            findings=(),
            forbidden_process_api_scan_digest=domain_separated_sha256(
                _FORBIDDEN_SCAN_DOMAIN, payload
            ),
        )

    @classmethod
    def from_dict(cls, value: object) -> "ForbiddenProcessApiScan":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        for field in (
            "allowedPreloadedFacades", "allowedBuiltins", "allowedAstNodes",
            "inspectedNodes", "ruleRegistry", "findings",
        ):
            if not isinstance(data[field], list):
                raise ValueError(f"{field} must be an array")
        return cls(
            policy=data["policy"],
            scanner_rule=data["scannerRule"],
            scanner_source_rule=data["scannerSourceRule"],
            scanner_entrypoint_path=data["scannerEntrypointPath"],
            scanner_entrypoint_function=data["scannerEntrypointFunction"],
            scanner_source_files=_source_file_tuple_from_wire(data["scannerSourceFiles"], field="scannerSourceFiles"),
            scanner_source_digest=data["scannerSourceDigest"],
            scanner_interpreter=PythonScannerInterpreterIdentity.from_dict(data["scannerInterpreter"]),
            scanner_runtime_digest=data["scannerRuntimeDigest"],
            allowed_preloaded_facades=tuple(data["allowedPreloadedFacades"]),
            allowed_builtins=tuple(data["allowedBuiltins"]),
            allowed_ast_nodes=tuple(data["allowedAstNodes"]),
            input_contract=data["inputContract"],
            output_contract=data["outputContract"],
            proof_admission_source_digest=data["proofAdmissionSourceDigest"],
            inspected_nodes=_file_identity_tuple_from_wire(data["inspectedNodes"], field="inspectedNodes"),
            rule_registry=tuple(ForbiddenProcessApiRule.from_dict(item) for item in data["ruleRegistry"]),
            rule_registry_digest=data["ruleRegistryDigest"],
            findings=tuple(data["findings"]),
            forbidden_process_api_scan_digest=data["forbiddenProcessApiScanDigest"],
        )


@dataclass(frozen=True)
class ProofAdmissionJobRuntimeIdentity:
    __slots__ = (
        "process_policy", "host_os_family", "host_build", "host_identity",
        "execution_kind", "interpreter_kind", "argv", "argv_digest",
        "executable_path_hash", "executable_sha256", "entrypoint_path",
        "entrypoint_file_sha256", "entrypoint_source_node_digest",
        "interpreter_executable_path_hash", "interpreter_executable_sha256",
        "interpreter_implementation", "interpreter_version",
        "ast_grammar_feature_version", "stdlib_digest",
        "forbidden_process_api_scan", "job_runtime_digest",
    )
    process_policy: str
    host_os_family: RuntimeOsFamily
    host_build: RuntimeHostBuild
    host_identity: RuntimeHostIdentity
    execution_kind: str
    interpreter_kind: ProofAdmissionInterpreter
    argv: tuple[str, ...]
    argv_digest: str
    executable_path_hash: str
    executable_sha256: str
    entrypoint_path: str
    entrypoint_file_sha256: str
    entrypoint_source_node_digest: str
    interpreter_executable_path_hash: str
    interpreter_executable_sha256: str
    interpreter_implementation: str
    interpreter_version: str
    ast_grammar_feature_version: str
    stdlib_digest: str
    forbidden_process_api_scan: ForbiddenProcessApiScan
    job_runtime_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "processPolicy", "hostOsFamily", "hostBuild", "hostIdentity",
            "executionKind", "interpreterKind", "argv", "argvDigest",
            "executablePathHash", "executableSha256", "entrypointPath",
            "entrypointFileSha256", "entrypointSourceNodeDigest",
            "interpreterExecutablePathHash", "interpreterExecutableSha256",
            "interpreterImplementation", "interpreterVersion",
            "astGrammarFeatureVersion", "stdlibDigest",
            "forbiddenProcessApiScan", "jobRuntimeDigest",
        }
    )

    def __post_init__(self) -> None:
        if (
            self.process_policy != _PROOF_PROCESS_POLICY
            or self.execution_kind != "INTERPRETED_SOURCE"
            or self.interpreter_kind is not ProofAdmissionInterpreter.PYTHON3
        ):
            raise ValueError("job runtime must be the v1 Python leaf runtime")
        _validate_host_pair(self.host_os_family, self.host_build, self.host_identity)
        _validate_ordered_string_tuple(self.argv, field="argv")
        if len(self.argv) < 2 or self.argv[1] != self.entrypoint_path:
            raise ValueError("argv[1] must equal entrypointPath")
        validate_repo_relative_path(self.entrypoint_path)
        if not self.entrypoint_path.endswith(".py"):
            raise ValueError("entrypointPath must be a Python source path")
        for value in (
            self.executable_path_hash, self.executable_sha256,
            self.entrypoint_file_sha256, self.entrypoint_source_node_digest,
            self.interpreter_executable_path_hash,
            self.interpreter_executable_sha256, self.stdlib_digest,
        ):
            validate_sha256(value)
        if (
            self.executable_path_hash != self.interpreter_executable_path_hash
            or self.executable_sha256 != self.interpreter_executable_sha256
        ):
            raise ValueError("job and interpreter executable identities differ")
        expected_argv = domain_separated_sha256(_ARGV_DOMAIN, list(self.argv))
        if self.argv_digest != expected_argv:
            raise ValueError("argvDigest does not match argv")
        if not isinstance(self.forbidden_process_api_scan, ForbiddenProcessApiScan):
            raise ValueError("forbiddenProcessApiScan must be typed")
        scanner = self.forbidden_process_api_scan.scanner_interpreter
        if (
            scanner.host_os_family is not self.host_os_family
            or scanner.host_build != self.host_build
            or scanner.host_identity != self.host_identity
            or scanner.executable_path_hash != self.interpreter_executable_path_hash
            or scanner.executable_sha256 != self.interpreter_executable_sha256
            or scanner.implementation != self.interpreter_implementation
            or scanner.version != self.interpreter_version
            or scanner.ast_grammar_feature_version != self.ast_grammar_feature_version
            or scanner.stdlib_digest != self.stdlib_digest
        ):
            raise ValueError("scanner and job interpreter identities differ")
        if (self.entrypoint_path, self.entrypoint_source_node_digest) not in self.forbidden_process_api_scan.inspected_nodes:
            raise ValueError("entrypoint is absent from inspectedNodes")
        validate_sha256(self.job_runtime_digest)
        if self.job_runtime_digest != self.expected_digest():
            raise ValueError("jobRuntimeDigest does not match runtime")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "processPolicy": self.process_policy,
            "hostOsFamily": self.host_os_family.value,
            "hostBuild": self.host_build.to_dict(),
            "hostIdentity": self.host_identity.to_dict(),
            "executionKind": self.execution_kind,
            "interpreterKind": self.interpreter_kind.value,
            "argv": list(self.argv),
            "argvDigest": self.argv_digest,
            "executablePathHash": self.executable_path_hash,
            "executableSha256": self.executable_sha256,
            "entrypointPath": self.entrypoint_path,
            "entrypointFileSha256": self.entrypoint_file_sha256,
            "entrypointSourceNodeDigest": self.entrypoint_source_node_digest,
            "interpreterExecutablePathHash": self.interpreter_executable_path_hash,
            "interpreterExecutableSha256": self.interpreter_executable_sha256,
            "interpreterImplementation": self.interpreter_implementation,
            "interpreterVersion": self.interpreter_version,
            "astGrammarFeatureVersion": self.ast_grammar_feature_version,
            "stdlibDigest": self.stdlib_digest,
            "forbiddenProcessApiScan": self.forbidden_process_api_scan.to_dict(),
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_JOB_RUNTIME_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "jobRuntimeDigest": self.job_runtime_digest}

    @classmethod
    def create(cls, **values: object) -> "ProofAdmissionJobRuntimeIdentity":
        values = {
            "process_policy": _PROOF_PROCESS_POLICY,
            "execution_kind": "INTERPRETED_SOURCE",
            "interpreter_kind": ProofAdmissionInterpreter.PYTHON3,
            **values,
        }
        values["argv_digest"] = domain_separated_sha256(_ARGV_DOMAIN, list(values["argv"]))
        payload = {
            "processPolicy": values["process_policy"],
            "hostOsFamily": values["host_os_family"].value,
            "hostBuild": values["host_build"].to_dict(),
            "hostIdentity": values["host_identity"].to_dict(),
            "executionKind": values["execution_kind"],
            "interpreterKind": values["interpreter_kind"].value,
            "argv": list(values["argv"]),
            "argvDigest": values["argv_digest"],
            "executablePathHash": values["executable_path_hash"],
            "executableSha256": values["executable_sha256"],
            "entrypointPath": values["entrypoint_path"],
            "entrypointFileSha256": values["entrypoint_file_sha256"],
            "entrypointSourceNodeDigest": values["entrypoint_source_node_digest"],
            "interpreterExecutablePathHash": values["interpreter_executable_path_hash"],
            "interpreterExecutableSha256": values["interpreter_executable_sha256"],
            "interpreterImplementation": values["interpreter_implementation"],
            "interpreterVersion": values["interpreter_version"],
            "astGrammarFeatureVersion": values["ast_grammar_feature_version"],
            "stdlibDigest": values["stdlib_digest"],
            "forbiddenProcessApiScan": values["forbidden_process_api_scan"].to_dict(),
        }
        return cls(
            **values,
            job_runtime_digest=domain_separated_sha256(
                _JOB_RUNTIME_DOMAIN, payload
            ),
        )

    @classmethod
    def from_dict(cls, value: object) -> "ProofAdmissionJobRuntimeIdentity":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        if not isinstance(data["argv"], list):
            raise ValueError("argv must be an array")
        return cls(
            process_policy=data["processPolicy"],
            host_os_family=_enum_from_wire(RuntimeOsFamily, data["hostOsFamily"], field="hostOsFamily"),
            host_build=runtime_host_build_from_dict(data["hostBuild"]),
            host_identity=runtime_host_identity_from_dict(data["hostIdentity"]),
            execution_kind=data["executionKind"],
            interpreter_kind=_enum_from_wire(
                ProofAdmissionInterpreter, data["interpreterKind"], field="interpreterKind"
            ),
            argv=tuple(data["argv"]),
            argv_digest=data["argvDigest"],
            executable_path_hash=data["executablePathHash"],
            executable_sha256=data["executableSha256"],
            entrypoint_path=data["entrypointPath"],
            entrypoint_file_sha256=data["entrypointFileSha256"],
            entrypoint_source_node_digest=data["entrypointSourceNodeDigest"],
            interpreter_executable_path_hash=data["interpreterExecutablePathHash"],
            interpreter_executable_sha256=data["interpreterExecutableSha256"],
            interpreter_implementation=data["interpreterImplementation"],
            interpreter_version=data["interpreterVersion"],
            ast_grammar_feature_version=data["astGrammarFeatureVersion"],
            stdlib_digest=data["stdlibDigest"],
            forbidden_process_api_scan=ForbiddenProcessApiScan.from_dict(data["forbiddenProcessApiScan"]),
            job_runtime_digest=data["jobRuntimeDigest"],
        )


@dataclass(frozen=True)
class LinuxWaitIdStatus:
    __slots__ = ("si_pid", "si_uid", "si_code", "si_status", "wait_id_status_digest")
    si_pid: int
    si_uid: str
    si_code: LinuxWaitIdCode
    si_status: int
    wait_id_status_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {"siPid", "siUid", "siCode", "siStatus", "waitIdStatusDigest"}
    )

    def __post_init__(self) -> None:
        _validate_positive_integer(self.si_pid, field="siPid")
        _validate_uint_string(self.si_uid, field="siUid")
        if not isinstance(self.si_code, LinuxWaitIdCode):
            raise ValueError("siCode must be closed")
        if self.si_code is LinuxWaitIdCode.CLD_EXITED:
            if (
                not isinstance(self.si_status, int)
                or isinstance(self.si_status, bool)
                or not 0 <= self.si_status <= 255
            ):
                raise ValueError("CLD_EXITED siStatus must be 0..255")
        else:
            _validate_positive_integer(self.si_status, field="siStatus")
        validate_sha256(self.wait_id_status_digest)
        if self.wait_id_status_digest != self.expected_digest():
            raise ValueError("waitIdStatusDigest does not match waitid status")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "siPid": self.si_pid,
            "siUid": self.si_uid,
            "siCode": self.si_code.value,
            "siStatus": self.si_status,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_LINUX_WAITID_STATUS_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "waitIdStatusDigest": self.wait_id_status_digest}

    @classmethod
    def create(cls, **values: object) -> "LinuxWaitIdStatus":
        payload = {
            "siPid": values["si_pid"],
            "siUid": values["si_uid"],
            "siCode": values["si_code"].value,
            "siStatus": values["si_status"],
        }
        return cls(**values, wait_id_status_digest=domain_separated_sha256(_LINUX_WAITID_STATUS_DOMAIN, payload))

    @classmethod
    def from_dict(cls, value: object) -> "LinuxWaitIdStatus":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            si_pid=data["siPid"],
            si_uid=data["siUid"],
            si_code=_enum_from_wire(LinuxWaitIdCode, data["siCode"], field="siCode"),
            si_status=data["siStatus"],
            wait_id_status_digest=data["waitIdStatusDigest"],
        )


LinuxWaitIdExitedStatus = LinuxWaitIdStatus
LinuxWaitIdKilledStatus = LinuxWaitIdStatus
LinuxWaitIdDumpedStatus = LinuxWaitIdStatus


def _poll_mask(value: str, *, field: str) -> int:
    return int(_validate_uint_string(value, field=field, maximum=4294967295))


def _validate_pidfd_masks(
    *,
    pre_raw: str,
    pre_in: bool,
    pre_errors: int,
    pre_hup: bool,
    post_raw: str,
    post_hup: bool,
    post_errors: int,
) -> None:
    pollin = 0x0001
    pollerr = 0x0008
    pollhup = 0x0010
    pollnval = 0x0020
    pre = _poll_mask(pre_raw, field="pidfdPollReventsRaw")
    post = _poll_mask(post_raw, field="postWaitPidfdPollReventsRaw")
    if (
        pre_in is not True
        or pre_in != bool(pre & pollin)
        or pre_errors != pre & (pollerr | pollnval)
        or pre_errors != 0
        or pre_hup != bool(pre & pollhup)
        or pre_hup is not False
    ):
        raise ValueError("pre-wait pidfd poll mask is not ready and error-free")
    if (
        post_hup is not True
        or post_hup != bool(post & pollhup)
        or post_errors != post & (pollerr | pollnval)
        or post_errors != 0
    ):
        raise ValueError("post-wait pidfd poll mask is not HUP and error-free")


@dataclass(frozen=True)
class LinuxPidfdWaitCapabilityEvidence:
    __slots__ = (
        "host_build", "host_identity", "kernel_release", "probe_child_pid",
        "probe_child_process_start_identity", "probe_pidfd_lease_id",
        "pidfd_open_flags", "pidfd_open_supported", "pidfd_poll_revents_raw",
        "pidfd_poll_in_set", "pidfd_poll_error_bits", "pidfd_poll_hup_before_wait",
        "wait_id_type", "wait_id_options", "wait_id_status",
        "wait_consumed_probe_child", "post_wait_pidfd_poll_revents_raw",
        "post_wait_pidfd_poll_hup_set", "post_wait_pidfd_poll_error_bits",
        "probed_before_environment_allocation", "probed_at",
        "pidfd_wait_capability_digest",
    )
    host_build: LinuxRuntimeHostBuild
    host_identity: LinuxRuntimeHostIdentity
    kernel_release: str
    probe_child_pid: int
    probe_child_process_start_identity: LinuxProcessStartIdentity
    probe_pidfd_lease_id: str
    pidfd_open_flags: int
    pidfd_open_supported: bool
    pidfd_poll_revents_raw: str
    pidfd_poll_in_set: bool
    pidfd_poll_error_bits: int
    pidfd_poll_hup_before_wait: bool
    wait_id_type: str
    wait_id_options: str
    wait_id_status: LinuxWaitIdStatus
    wait_consumed_probe_child: bool
    post_wait_pidfd_poll_revents_raw: str
    post_wait_pidfd_poll_hup_set: bool
    post_wait_pidfd_poll_error_bits: int
    probed_before_environment_allocation: bool
    probed_at: str
    pidfd_wait_capability_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "hostBuild", "hostIdentity", "kernelRelease", "probeChildPid",
            "probeChildProcessStartIdentity", "probePidfdLeaseId",
            "pidfdOpenFlags", "pidfdOpenSupported", "pidfdPollReventsRaw",
            "pidfdPollInSet", "pidfdPollErrorBits", "pidfdPollHupBeforeWait",
            "waitIdType", "waitIdOptions", "waitIdStatus",
            "waitConsumedProbeChild", "postWaitPidfdPollReventsRaw",
            "postWaitPidfdPollHupSet", "postWaitPidfdPollErrorBits",
            "probedBeforeEnvironmentAllocation", "probedAt",
            "pidfdWaitCapabilityDigest",
        }
    )

    def __post_init__(self) -> None:
        _validate_host_pair(RuntimeOsFamily.LINUX, self.host_build, self.host_identity)
        if self.kernel_release != self.host_build.kernel_release:
            raise ValueError("kernelRelease must equal hostBuild")
        _validate_positive_integer(self.probe_child_pid, field="probeChildPid")
        if (
            not isinstance(self.probe_child_process_start_identity, LinuxProcessStartIdentity)
            or self.probe_child_process_start_identity.boot_id == ""
        ):
            raise ValueError("probe child start identity must be Linux")
        _validate_non_empty_utf8(self.probe_pidfd_lease_id, field="probePidfdLeaseId")
        if self.pidfd_open_flags != 0 or self.pidfd_open_supported is not True:
            raise ValueError("pidfd_open capability must use flags 0 and be supported")
        if self.wait_id_type != "P_PIDFD" or self.wait_id_options != "WEXITED":
            raise ValueError("pidfd wait must use waitid(P_PIDFD, WEXITED)")
        if (
            not isinstance(self.wait_id_status, LinuxWaitIdStatus)
            or self.wait_id_status.si_pid != self.probe_child_pid
            or self.wait_consumed_probe_child is not True
            or self.probed_before_environment_allocation is not True
        ):
            raise ValueError("pidfd wait must consume the exact probe child before allocation")
        _validate_pidfd_masks(
            pre_raw=self.pidfd_poll_revents_raw,
            pre_in=self.pidfd_poll_in_set,
            pre_errors=self.pidfd_poll_error_bits,
            pre_hup=self.pidfd_poll_hup_before_wait,
            post_raw=self.post_wait_pidfd_poll_revents_raw,
            post_hup=self.post_wait_pidfd_poll_hup_set,
            post_errors=self.post_wait_pidfd_poll_error_bits,
        )
        _canonical_utc_instant(self.probed_at, field="probedAt")
        validate_sha256(self.pidfd_wait_capability_digest)
        if self.pidfd_wait_capability_digest != self.expected_digest():
            raise ValueError("pidfdWaitCapabilityDigest does not match evidence")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "hostBuild": self.host_build.to_dict(),
            "hostIdentity": self.host_identity.to_dict(),
            "kernelRelease": self.kernel_release,
            "probeChildPid": self.probe_child_pid,
            "probeChildProcessStartIdentity": self.probe_child_process_start_identity.to_dict(),
            "probePidfdLeaseId": self.probe_pidfd_lease_id,
            "pidfdOpenFlags": self.pidfd_open_flags,
            "pidfdOpenSupported": self.pidfd_open_supported,
            "pidfdPollReventsRaw": self.pidfd_poll_revents_raw,
            "pidfdPollInSet": self.pidfd_poll_in_set,
            "pidfdPollErrorBits": self.pidfd_poll_error_bits,
            "pidfdPollHupBeforeWait": self.pidfd_poll_hup_before_wait,
            "waitIdType": self.wait_id_type,
            "waitIdOptions": self.wait_id_options,
            "waitIdStatus": self.wait_id_status.to_dict(),
            "waitConsumedProbeChild": self.wait_consumed_probe_child,
            "postWaitPidfdPollReventsRaw": self.post_wait_pidfd_poll_revents_raw,
            "postWaitPidfdPollHupSet": self.post_wait_pidfd_poll_hup_set,
            "postWaitPidfdPollErrorBits": self.post_wait_pidfd_poll_error_bits,
            "probedBeforeEnvironmentAllocation": self.probed_before_environment_allocation,
            "probedAt": self.probed_at,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_LINUX_PIDFD_CAPABILITY_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "pidfdWaitCapabilityDigest": self.pidfd_wait_capability_digest}

    @classmethod
    def create(cls, **values: object) -> "LinuxPidfdWaitCapabilityEvidence":
        values = {
            "kernel_release": values["host_build"].kernel_release,
            "pidfd_open_flags": 0,
            "pidfd_open_supported": True,
            "pidfd_poll_in_set": True,
            "pidfd_poll_error_bits": 0,
            "pidfd_poll_hup_before_wait": False,
            "wait_id_type": "P_PIDFD",
            "wait_id_options": "WEXITED",
            "wait_consumed_probe_child": True,
            "post_wait_pidfd_poll_hup_set": True,
            "post_wait_pidfd_poll_error_bits": 0,
            "probed_before_environment_allocation": True,
            **values,
        }
        payload = {
            "hostBuild": values["host_build"].to_dict(),
            "hostIdentity": values["host_identity"].to_dict(),
            "kernelRelease": values["kernel_release"],
            "probeChildPid": values["probe_child_pid"],
            "probeChildProcessStartIdentity": values["probe_child_process_start_identity"].to_dict(),
            "probePidfdLeaseId": values["probe_pidfd_lease_id"],
            "pidfdOpenFlags": values["pidfd_open_flags"],
            "pidfdOpenSupported": values["pidfd_open_supported"],
            "pidfdPollReventsRaw": values["pidfd_poll_revents_raw"],
            "pidfdPollInSet": values["pidfd_poll_in_set"],
            "pidfdPollErrorBits": values["pidfd_poll_error_bits"],
            "pidfdPollHupBeforeWait": values["pidfd_poll_hup_before_wait"],
            "waitIdType": values["wait_id_type"],
            "waitIdOptions": values["wait_id_options"],
            "waitIdStatus": values["wait_id_status"].to_dict(),
            "waitConsumedProbeChild": values["wait_consumed_probe_child"],
            "postWaitPidfdPollReventsRaw": values["post_wait_pidfd_poll_revents_raw"],
            "postWaitPidfdPollHupSet": values["post_wait_pidfd_poll_hup_set"],
            "postWaitPidfdPollErrorBits": values["post_wait_pidfd_poll_error_bits"],
            "probedBeforeEnvironmentAllocation": values["probed_before_environment_allocation"],
            "probedAt": values["probed_at"],
        }
        return cls(**values, pidfd_wait_capability_digest=domain_separated_sha256(_LINUX_PIDFD_CAPABILITY_DOMAIN, payload))

    @classmethod
    def from_dict(cls, value: object) -> "LinuxPidfdWaitCapabilityEvidence":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            host_build=LinuxRuntimeHostBuild.from_dict(data["hostBuild"]),
            host_identity=LinuxRuntimeHostIdentity.from_dict(data["hostIdentity"]),
            kernel_release=data["kernelRelease"],
            probe_child_pid=data["probeChildPid"],
            probe_child_process_start_identity=LinuxProcessStartIdentity.from_dict(data["probeChildProcessStartIdentity"]),
            probe_pidfd_lease_id=data["probePidfdLeaseId"],
            pidfd_open_flags=data["pidfdOpenFlags"],
            pidfd_open_supported=data["pidfdOpenSupported"],
            pidfd_poll_revents_raw=data["pidfdPollReventsRaw"],
            pidfd_poll_in_set=data["pidfdPollInSet"],
            pidfd_poll_error_bits=data["pidfdPollErrorBits"],
            pidfd_poll_hup_before_wait=data["pidfdPollHupBeforeWait"],
            wait_id_type=data["waitIdType"],
            wait_id_options=data["waitIdOptions"],
            wait_id_status=LinuxWaitIdStatus.from_dict(data["waitIdStatus"]),
            wait_consumed_probe_child=data["waitConsumedProbeChild"],
            post_wait_pidfd_poll_revents_raw=data["postWaitPidfdPollReventsRaw"],
            post_wait_pidfd_poll_hup_set=data["postWaitPidfdPollHupSet"],
            post_wait_pidfd_poll_error_bits=data["postWaitPidfdPollErrorBits"],
            probed_before_environment_allocation=data["probedBeforeEnvironmentAllocation"],
            probed_at=data["probedAt"],
            pidfd_wait_capability_digest=data["pidfdWaitCapabilityDigest"],
        )


@dataclass(frozen=True)
class ProofAdmissionLockIdentity:
    __slots__ = ("device_id", "inode", "file_type", "lock_identity_digest")
    device_id: str
    inode: str
    file_type: str
    lock_identity_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {"deviceId", "inode", "fileType", "lockIdentityDigest"}
    )

    def __post_init__(self) -> None:
        _validate_uint_string(self.device_id, field="deviceId")
        _validate_uint_string(self.inode, field="inode")
        if self.file_type != "REGULAR_FILE":
            raise ValueError("fileType must be REGULAR_FILE")
        validate_sha256(self.lock_identity_digest)
        if self.lock_identity_digest != self.expected_digest():
            raise ValueError("lockIdentityDigest does not match lock identity")

    def _digest_payload(self) -> dict[str, object]:
        return {"deviceId": self.device_id, "inode": self.inode, "fileType": self.file_type}

    def expected_digest(self) -> str:
        return domain_separated_sha256(_LOCK_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "lockIdentityDigest": self.lock_identity_digest}

    @classmethod
    def create(cls, *, device_id: str, inode: str) -> "ProofAdmissionLockIdentity":
        payload = {"deviceId": device_id, "inode": inode, "fileType": "REGULAR_FILE"}
        return cls(device_id, inode, "REGULAR_FILE", domain_separated_sha256(_LOCK_DOMAIN, payload))

    @classmethod
    def from_dict(cls, value: object) -> "ProofAdmissionLockIdentity":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(data["deviceId"], data["inode"], data["fileType"], data["lockIdentityDigest"])


@dataclass(frozen=True)
class ProofAdmissionSinkResolverIdentity:
    __slots__ = (
        "owner", "entrypoint_path", "entrypoint_function", "source_rule",
        "source_files", "source_digest", "backend_kind",
        "backend_protocol_version", "resolver_identity_digest",
    )
    owner: str
    entrypoint_path: str
    entrypoint_function: str
    source_rule: str
    source_files: tuple[tuple[str, str, int], ...]
    source_digest: str
    backend_kind: str
    backend_protocol_version: str
    resolver_identity_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "owner", "entrypointPath", "entrypointFunction", "sourceRule",
            "sourceFiles", "sourceDigest", "backendKind",
            "backendProtocolVersion", "resolverIdentityDigest",
        }
    )

    def __post_init__(self) -> None:
        fixed = (
            (self.owner, "ACCEPTANCE_INFRA"),
            (self.entrypoint_path, "tooling/acceptance/core/proof_admission.py"),
            (self.entrypoint_function, "emit_authoritative_claim"),
            (self.source_rule, "PROOF_ADMISSION_SINK_SOURCE_V1"),
            (self.backend_kind, "EVIDENCE_STORE"),
            (self.backend_protocol_version, "IDEMPOTENT_CLAIM_SINK_V1"),
        )
        if any(actual != expected for actual, expected in fixed):
            raise ValueError("sink resolver fixed identity changed")
        _validate_source_file_tuple(self.source_files, field="sourceFiles")
        if self.source_digest != domain_separated_sha256(
            _SINK_SOURCE_DOMAIN, _source_file_tuple_to_wire(self.source_files)
        ):
            raise ValueError("sourceDigest does not match sink source closure")
        validate_sha256(self.resolver_identity_digest)
        if self.resolver_identity_digest != self.expected_digest():
            raise ValueError("resolverIdentityDigest does not match resolver")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "owner": self.owner,
            "entrypointPath": self.entrypoint_path,
            "entrypointFunction": self.entrypoint_function,
            "sourceRule": self.source_rule,
            "sourceFiles": _source_file_tuple_to_wire(self.source_files),
            "sourceDigest": self.source_digest,
            "backendKind": self.backend_kind,
            "backendProtocolVersion": self.backend_protocol_version,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_SINK_RESOLVER_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "resolverIdentityDigest": self.resolver_identity_digest}

    @classmethod
    def create(
        cls,
        *,
        source_files: tuple[tuple[str, str, int], ...],
    ) -> "ProofAdmissionSinkResolverIdentity":
        source_digest = domain_separated_sha256(
            _SINK_SOURCE_DOMAIN, _source_file_tuple_to_wire(source_files)
        )
        payload = {
            "owner": "ACCEPTANCE_INFRA",
            "entrypointPath": "tooling/acceptance/core/proof_admission.py",
            "entrypointFunction": "emit_authoritative_claim",
            "sourceRule": "PROOF_ADMISSION_SINK_SOURCE_V1",
            "sourceFiles": _source_file_tuple_to_wire(source_files),
            "sourceDigest": source_digest,
            "backendKind": "EVIDENCE_STORE",
            "backendProtocolVersion": "IDEMPOTENT_CLAIM_SINK_V1",
        }
        return cls(
            owner="ACCEPTANCE_INFRA",
            entrypoint_path="tooling/acceptance/core/proof_admission.py",
            entrypoint_function="emit_authoritative_claim",
            source_rule="PROOF_ADMISSION_SINK_SOURCE_V1",
            source_files=source_files,
            source_digest=source_digest,
            backend_kind="EVIDENCE_STORE",
            backend_protocol_version="IDEMPOTENT_CLAIM_SINK_V1",
            resolver_identity_digest=domain_separated_sha256(
                _SINK_RESOLVER_DOMAIN, payload
            ),
        )

    @classmethod
    def from_dict(cls, value: object) -> "ProofAdmissionSinkResolverIdentity":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            owner=data["owner"],
            entrypoint_path=data["entrypointPath"],
            entrypoint_function=data["entrypointFunction"],
            source_rule=data["sourceRule"],
            source_files=_source_file_tuple_from_wire(data["sourceFiles"], field="sourceFiles"),
            source_digest=data["sourceDigest"],
            backend_kind=data["backendKind"],
            backend_protocol_version=data["backendProtocolVersion"],
            resolver_identity_digest=data["resolverIdentityDigest"],
        )


@dataclass(frozen=True)
class ProofAdmissionSinkIdentity:
    __slots__ = (
        "sink_kind", "sink_id", "sink_protocol_version",
        "destination_namespace_id", "workspace_id", "gate_id",
        "resolver_identity", "deadline_milliseconds",
        "contains_credential_or_endpoint", "sink_identity_digest",
    )
    sink_kind: str
    sink_id: str
    sink_protocol_version: str
    destination_namespace_id: str
    workspace_id: str
    gate_id: str
    resolver_identity: ProofAdmissionSinkResolverIdentity
    deadline_milliseconds: int
    contains_credential_or_endpoint: bool
    sink_identity_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "sinkKind", "sinkId", "sinkProtocolVersion",
            "destinationNamespaceId", "workspaceId", "gateId",
            "resolverIdentity", "deadlineMilliseconds",
            "containsCredentialOrEndpoint", "sinkIdentityDigest",
        }
    )

    def __post_init__(self) -> None:
        if (
            self.sink_kind != "EVIDENCE_STORE_AUTHORITATIVE_CLAIM"
            or self.sink_protocol_version != "IDEMPOTENT_CLAIM_SINK_V1"
            or self.destination_namespace_id != "AUTHORITATIVE_CLAIM_RESULTS_V1"
            or self.contains_credential_or_endpoint is not False
        ):
            raise ValueError("sink identity fixed fields changed")
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gate ID")
        if type(self.resolver_identity) is not ProofAdmissionSinkResolverIdentity:
            raise ValueError("resolverIdentity must be typed")
        _validate_positive_bounded_integer(
            self.deadline_milliseconds, field="deadlineMilliseconds", maximum=10000
        )
        expected_sink_id = domain_separated_sha256(
            _SINK_ID_DOMAIN,
            {
                "sinkKind": self.sink_kind,
                "workspaceId": self.workspace_id,
                "gateId": self.gate_id,
                "destinationNamespaceId": self.destination_namespace_id,
                "resolverIdentityDigest": self.resolver_identity.resolver_identity_digest,
            },
        )
        if self.sink_id != expected_sink_id:
            raise ValueError("sinkId does not match canonical sink identity")
        validate_sha256(self.sink_identity_digest)
        if self.sink_identity_digest != self.expected_digest():
            raise ValueError("sinkIdentityDigest does not match sink identity")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "sinkKind": self.sink_kind,
            "sinkId": self.sink_id,
            "sinkProtocolVersion": self.sink_protocol_version,
            "destinationNamespaceId": self.destination_namespace_id,
            "workspaceId": self.workspace_id,
            "gateId": self.gate_id,
            "resolverIdentity": self.resolver_identity.to_dict(),
            "deadlineMilliseconds": self.deadline_milliseconds,
            "containsCredentialOrEndpoint": self.contains_credential_or_endpoint,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_SINK_IDENTITY_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "sinkIdentityDigest": self.sink_identity_digest}

    @classmethod
    def create(
        cls,
        *,
        workspace_id: str,
        gate_id: str,
        resolver_identity: ProofAdmissionSinkResolverIdentity,
        deadline_milliseconds: int,
    ) -> "ProofAdmissionSinkIdentity":
        if type(resolver_identity) is not ProofAdmissionSinkResolverIdentity:
            raise ValueError("resolverIdentity must be typed")
        sink_id = domain_separated_sha256(
            _SINK_ID_DOMAIN,
            {
                "sinkKind": "EVIDENCE_STORE_AUTHORITATIVE_CLAIM",
                "workspaceId": workspace_id,
                "gateId": gate_id,
                "destinationNamespaceId": "AUTHORITATIVE_CLAIM_RESULTS_V1",
                "resolverIdentityDigest": resolver_identity.resolver_identity_digest,
            },
        )
        payload = {
            "sinkKind": "EVIDENCE_STORE_AUTHORITATIVE_CLAIM",
            "sinkId": sink_id,
            "sinkProtocolVersion": "IDEMPOTENT_CLAIM_SINK_V1",
            "destinationNamespaceId": "AUTHORITATIVE_CLAIM_RESULTS_V1",
            "workspaceId": workspace_id,
            "gateId": gate_id,
            "resolverIdentity": resolver_identity.to_dict(),
            "deadlineMilliseconds": deadline_milliseconds,
            "containsCredentialOrEndpoint": False,
        }
        return cls(
            sink_kind="EVIDENCE_STORE_AUTHORITATIVE_CLAIM",
            sink_id=sink_id,
            sink_protocol_version="IDEMPOTENT_CLAIM_SINK_V1",
            destination_namespace_id="AUTHORITATIVE_CLAIM_RESULTS_V1",
            workspace_id=workspace_id,
            gate_id=gate_id,
            resolver_identity=resolver_identity,
            deadline_milliseconds=deadline_milliseconds,
            contains_credential_or_endpoint=False,
            sink_identity_digest=domain_separated_sha256(_SINK_IDENTITY_DOMAIN, payload),
        )

    @classmethod
    def from_dict(cls, value: object) -> "ProofAdmissionSinkIdentity":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            sink_kind=data["sinkKind"],
            sink_id=data["sinkId"],
            sink_protocol_version=data["sinkProtocolVersion"],
            destination_namespace_id=data["destinationNamespaceId"],
            workspace_id=data["workspaceId"],
            gate_id=data["gateId"],
            resolver_identity=ProofAdmissionSinkResolverIdentity.from_dict(data["resolverIdentity"]),
            deadline_milliseconds=data["deadlineMilliseconds"],
            contains_credential_or_endpoint=data["containsCredentialOrEndpoint"],
            sink_identity_digest=data["sinkIdentityDigest"],
        )


@dataclass(frozen=True)
class IdempotentClaimSinkReceipt:
    __slots__ = (
        "sink_id", "sink_protocol_version", "idempotency_key",
        "accepted_payload_sha256", "accepted_at", "sink_receipt_digest",
    )
    sink_id: str
    sink_protocol_version: str
    idempotency_key: str
    accepted_payload_sha256: str
    accepted_at: str
    sink_receipt_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "sinkId", "sinkProtocolVersion", "idempotencyKey",
            "acceptedPayloadSha256", "acceptedAt", "sinkReceiptDigest",
        }
    )

    def __post_init__(self) -> None:
        for value in (self.sink_id, self.idempotency_key, self.accepted_payload_sha256):
            validate_sha256(value)
        if self.sink_protocol_version != "IDEMPOTENT_CLAIM_SINK_V1":
            raise ValueError("sinkProtocolVersion must be IDEMPOTENT_CLAIM_SINK_V1")
        _canonical_utc_instant(self.accepted_at, field="acceptedAt")
        validate_sha256(self.sink_receipt_digest)
        if self.sink_receipt_digest != self.expected_digest():
            raise ValueError("sinkReceiptDigest does not match receipt")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "sinkId": self.sink_id,
            "sinkProtocolVersion": self.sink_protocol_version,
            "idempotencyKey": self.idempotency_key,
            "acceptedPayloadSha256": self.accepted_payload_sha256,
            "acceptedAt": self.accepted_at,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_SINK_RECEIPT_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "sinkReceiptDigest": self.sink_receipt_digest}

    @classmethod
    def create(cls, **values: object) -> "IdempotentClaimSinkReceipt":
        values = {"sink_protocol_version": "IDEMPOTENT_CLAIM_SINK_V1", **values}
        payload = {
            "sinkId": values["sink_id"],
            "sinkProtocolVersion": values["sink_protocol_version"],
            "idempotencyKey": values["idempotency_key"],
            "acceptedPayloadSha256": values["accepted_payload_sha256"],
            "acceptedAt": values["accepted_at"],
        }
        return cls(**values, sink_receipt_digest=domain_separated_sha256(_SINK_RECEIPT_DOMAIN, payload))

    @classmethod
    def from_dict(cls, value: object) -> "IdempotentClaimSinkReceipt":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            data["sinkId"], data["sinkProtocolVersion"], data["idempotencyKey"],
            data["acceptedPayloadSha256"], data["acceptedAt"], data["sinkReceiptDigest"],
        )


@dataclass(frozen=True)
class ProofAdmissionEmissionIntent:
    __slots__ = (
        "artifact_kind", "schema_version", "workspace_id", "gate_id",
        "coordinator_epoch_id", "job_sequence", "job_record_digest",
        "completion_digest", "expected_resolution_digest", "output_digest",
        "payload_encoding", "payload_base64", "payload_sha256", "sink_identity",
        "idempotency_key", "created_at", "emission_intent_digest",
    )
    artifact_kind: str
    schema_version: int
    workspace_id: str
    gate_id: str
    coordinator_epoch_id: str
    job_sequence: int
    job_record_digest: str
    completion_digest: str
    expected_resolution_digest: str
    output_digest: str
    payload_encoding: str
    payload_base64: str
    payload_sha256: str
    sink_identity: ProofAdmissionSinkIdentity
    idempotency_key: str
    created_at: str
    emission_intent_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "artifactKind", "schemaVersion", "workspaceId", "gateId",
            "coordinatorEpochId", "jobSequence", "jobRecordDigest",
            "completionDigest", "expectedResolutionDigest", "outputDigest",
            "payloadEncoding", "payloadBase64", "payloadSha256", "sinkIdentity",
            "idempotencyKey", "createdAt", "emissionIntentDigest",
        }
    )

    def __post_init__(self) -> None:
        if self.artifact_kind != "acceptance-proof-admission-emission-intent":
            raise ValueError("artifactKind is invalid")
        if self.schema_version != 1 or isinstance(self.schema_version, bool):
            raise ValueError("schemaVersion must be 1")
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gate ID")
        _validate_non_empty_utf8(self.coordinator_epoch_id, field="coordinatorEpochId")
        _validate_positive_integer(self.job_sequence, field="jobSequence")
        for value in (
            self.job_record_digest, self.completion_digest,
            self.expected_resolution_digest, self.output_digest,
        ):
            validate_sha256(value)
        if self.payload_encoding != "JCS_CLAIM_EMITTER_OUTPUT_V1":
            raise ValueError("payloadEncoding is invalid")
        try:
            payload_bytes = base64.b64decode(self.payload_base64.encode("ascii"), validate=True)
        except (UnicodeEncodeError, binascii.Error) as error:
            raise ValueError("payloadBase64 must be canonical Base64") from error
        if base64.b64encode(payload_bytes).decode("ascii") != self.payload_base64:
            raise ValueError("payloadBase64 must be canonical Base64")
        output = ClaimEmitterOutput.from_dict(_strict_json_value(payload_bytes))
        if output.output_digest != self.output_digest:
            raise ValueError("payload outputDigest does not match intent")
        if output.resolution.resolution_digest != self.expected_resolution_digest:
            raise ValueError("payload resolution does not match intent")
        if (
            output.resolution.workspace_id != self.workspace_id
            or output.resolution.gate_id != self.gate_id
        ):
            raise ValueError("payload resolution identity does not match intent")
        if raw_sha256(payload_bytes) != self.payload_sha256:
            raise ValueError("payloadSha256 does not match payloadBase64")
        if (
            type(self.sink_identity) is not ProofAdmissionSinkIdentity
            or self.sink_identity.workspace_id != self.workspace_id
            or self.sink_identity.gate_id != self.gate_id
        ):
            raise ValueError("sink identity does not match intent")
        expected_key = domain_separated_sha256(
            _EMISSION_IDEMPOTENCY_DOMAIN,
            {
                "workspaceId": self.workspace_id,
                "gateId": self.gate_id,
                "coordinatorEpochId": self.coordinator_epoch_id,
                "jobSequence": self.job_sequence,
                "jobRecordDigest": self.job_record_digest,
                "completionDigest": self.completion_digest,
                "expectedResolutionDigest": self.expected_resolution_digest,
                "outputDigest": self.output_digest,
                "payloadSha256": self.payload_sha256,
                "sinkIdentityDigest": self.sink_identity.sink_identity_digest,
            },
        )
        if self.idempotency_key != expected_key:
            raise ValueError("idempotencyKey does not match intent")
        _canonical_utc_instant(self.created_at, field="createdAt")
        validate_sha256(self.emission_intent_digest)
        if self.emission_intent_digest != self.expected_digest():
            raise ValueError("emissionIntentDigest does not match intent")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind,
            "schemaVersion": self.schema_version,
            "workspaceId": self.workspace_id,
            "gateId": self.gate_id,
            "coordinatorEpochId": self.coordinator_epoch_id,
            "jobSequence": self.job_sequence,
            "jobRecordDigest": self.job_record_digest,
            "completionDigest": self.completion_digest,
            "expectedResolutionDigest": self.expected_resolution_digest,
            "outputDigest": self.output_digest,
            "payloadEncoding": self.payload_encoding,
            "payloadBase64": self.payload_base64,
            "payloadSha256": self.payload_sha256,
            "sinkIdentity": self.sink_identity.to_dict(),
            "idempotencyKey": self.idempotency_key,
            "createdAt": self.created_at,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_EMISSION_INTENT_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "emissionIntentDigest": self.emission_intent_digest}

    def validate_references(
        self,
        *,
        job: ProofAdmissionJobRecord,
        completion: ProofAdmissionJobCompletion,
        epoch: ProofAdmissionEpochRecord,
    ) -> None:
        if (
            type(job) is not ProofAdmissionJobRecord
            or type(completion) is not ProofAdmissionJobCompletion
            or type(epoch) is not ProofAdmissionEpochRecord
        ):
            raise ValueError(
                "emission intent requires typed job, completion, and epoch "
                "references"
            )
        completion.validate_references(job=job, epoch=epoch)
        if _canonical_utc_instant(
            completion.completed_at,
            field="completedAt",
        ) > _canonical_utc_instant(self.created_at, field="createdAt"):
            raise ValueError(
                "emission intent cannot precede completion"
            )
        payload_bytes = base64.b64decode(self.payload_base64.encode("ascii"), validate=True)
        output = ClaimEmitterOutput.from_dict(_strict_json_value(payload_bytes))
        if (
            job.workspace_id != self.workspace_id
            or job.gate_id != self.gate_id
            or job.coordinator_epoch_id != self.coordinator_epoch_id
            or job.job_sequence != self.job_sequence
            or job.job_record_digest != self.job_record_digest
            or job.expected_resolution_digest != self.expected_resolution_digest
            or job.sink_identity != self.sink_identity
            or completion.workspace_id != self.workspace_id
            or completion.gate_id != self.gate_id
            or completion.coordinator_epoch_id != self.coordinator_epoch_id
            or completion.job_sequence != self.job_sequence
            or completion.job_record_digest != self.job_record_digest
            or completion.sink_identity_digest
            != self.sink_identity.sink_identity_digest
            or completion.completion_digest != self.completion_digest
            or completion.terminal_state
            is not ProofAdmissionJobTerminalState.COMPLETED
            or completion.output is None
            or canonical_json_bytes(completion.output.to_dict())
            != canonical_json_bytes(output.to_dict())
        ):
            raise ValueError(
                "emission intent references do not close over job and completion"
            )

    @classmethod
    def create(
        cls,
        *,
        job: ProofAdmissionJobRecord,
        completion: ProofAdmissionJobCompletion,
        epoch: ProofAdmissionEpochRecord,
        created_at: str,
    ) -> "ProofAdmissionEmissionIntent":
        if (
            type(job) is not ProofAdmissionJobRecord
            or type(completion) is not ProofAdmissionJobCompletion
            or type(epoch) is not ProofAdmissionEpochRecord
        ):
            raise ValueError(
                "emission intent requires typed job, completion, and epoch "
                "references"
            )
        if completion.output is None:
            raise ValueError("emission intent requires completed claim output")
        output = completion.output
        workspace_id = job.workspace_id
        gate_id = job.gate_id
        coordinator_epoch_id = job.coordinator_epoch_id
        job_sequence = job.job_sequence
        job_record_digest = job.job_record_digest
        completion_digest = completion.completion_digest
        sink_identity = job.sink_identity
        payload_bytes = canonical_json_bytes(output.to_dict())
        payload_base64 = base64.b64encode(payload_bytes).decode("ascii")
        payload_sha256 = raw_sha256(payload_bytes)
        idempotency_payload = {
            "workspaceId": workspace_id,
            "gateId": gate_id,
            "coordinatorEpochId": coordinator_epoch_id,
            "jobSequence": job_sequence,
            "jobRecordDigest": job_record_digest,
            "completionDigest": completion_digest,
            "expectedResolutionDigest": output.resolution.resolution_digest,
            "outputDigest": output.output_digest,
            "payloadSha256": payload_sha256,
            "sinkIdentityDigest": sink_identity.sink_identity_digest,
        }
        idempotency_key = domain_separated_sha256(
            _EMISSION_IDEMPOTENCY_DOMAIN, idempotency_payload
        )
        values = {
            "artifact_kind": "acceptance-proof-admission-emission-intent",
            "schema_version": 1,
            "workspace_id": workspace_id,
            "gate_id": gate_id,
            "coordinator_epoch_id": coordinator_epoch_id,
            "job_sequence": job_sequence,
            "job_record_digest": job_record_digest,
            "completion_digest": completion_digest,
            "expected_resolution_digest": output.resolution.resolution_digest,
            "output_digest": output.output_digest,
            "payload_encoding": "JCS_CLAIM_EMITTER_OUTPUT_V1",
            "payload_base64": payload_base64,
            "payload_sha256": payload_sha256,
            "sink_identity": sink_identity,
            "idempotency_key": idempotency_key,
            "created_at": created_at,
        }
        wire = {
            "artifactKind": values["artifact_kind"],
            "schemaVersion": 1,
            "workspaceId": workspace_id,
            "gateId": gate_id,
            "coordinatorEpochId": coordinator_epoch_id,
            "jobSequence": job_sequence,
            "jobRecordDigest": job_record_digest,
            "completionDigest": completion_digest,
            "expectedResolutionDigest": output.resolution.resolution_digest,
            "outputDigest": output.output_digest,
            "payloadEncoding": values["payload_encoding"],
            "payloadBase64": payload_base64,
            "payloadSha256": payload_sha256,
            "sinkIdentity": sink_identity.to_dict(),
            "idempotencyKey": idempotency_key,
            "createdAt": created_at,
        }
        intent = cls(
            **values,
            emission_intent_digest=domain_separated_sha256(
                _EMISSION_INTENT_DOMAIN, wire
            ),
        )
        intent.validate_references(
            job=job,
            completion=completion,
            epoch=epoch,
        )
        return intent

    @classmethod
    def from_dict(
        cls,
        value: object,
        *,
        job: ProofAdmissionJobRecord,
        completion: ProofAdmissionJobCompletion,
        epoch: ProofAdmissionEpochRecord,
    ) -> "ProofAdmissionEmissionIntent":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        intent = cls(
            artifact_kind=data["artifactKind"],
            schema_version=data["schemaVersion"],
            workspace_id=data["workspaceId"],
            gate_id=data["gateId"],
            coordinator_epoch_id=data["coordinatorEpochId"],
            job_sequence=data["jobSequence"],
            job_record_digest=data["jobRecordDigest"],
            completion_digest=data["completionDigest"],
            expected_resolution_digest=data["expectedResolutionDigest"],
            output_digest=data["outputDigest"],
            payload_encoding=data["payloadEncoding"],
            payload_base64=data["payloadBase64"],
            payload_sha256=data["payloadSha256"],
            sink_identity=ProofAdmissionSinkIdentity.from_dict(data["sinkIdentity"]),
            idempotency_key=data["idempotencyKey"],
            created_at=data["createdAt"],
            emission_intent_digest=data["emissionIntentDigest"],
        )
        intent.validate_references(
            job=job,
            completion=completion,
            epoch=epoch,
        )
        return intent


@dataclass(frozen=True)
class ProofAdmissionEmissionAcknowledgement:
    __slots__ = (
        "artifact_kind", "schema_version", "workspace_id", "gate_id",
        "coordinator_epoch_id", "job_sequence", "job_record_digest",
        "completion_digest", "emission_intent_digest", "sink_identity_digest",
        "sink_id", "idempotency_key", "accepted_payload_sha256",
        "sink_receipt", "acknowledged_at", "emission_acknowledgement_digest",
    )
    artifact_kind: str
    schema_version: int
    workspace_id: str
    gate_id: str
    coordinator_epoch_id: str
    job_sequence: int
    job_record_digest: str
    completion_digest: str
    emission_intent_digest: str
    sink_identity_digest: str
    sink_id: str
    idempotency_key: str
    accepted_payload_sha256: str
    sink_receipt: IdempotentClaimSinkReceipt
    acknowledged_at: str
    emission_acknowledgement_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "artifactKind", "schemaVersion", "workspaceId", "gateId",
            "coordinatorEpochId", "jobSequence", "jobRecordDigest",
            "completionDigest", "emissionIntentDigest", "sinkIdentityDigest",
            "sinkId", "idempotencyKey", "acceptedPayloadSha256",
            "sinkReceipt", "acknowledgedAt", "emissionAcknowledgementDigest",
        }
    )

    def __post_init__(self) -> None:
        if self.artifact_kind != "acceptance-proof-admission-emission-acknowledgement":
            raise ValueError("artifactKind is invalid")
        if self.schema_version != 1 or isinstance(self.schema_version, bool):
            raise ValueError("schemaVersion must be 1")
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gate ID")
        _validate_non_empty_utf8(self.coordinator_epoch_id, field="coordinatorEpochId")
        _validate_positive_integer(self.job_sequence, field="jobSequence")
        for value in (
            self.job_record_digest, self.completion_digest,
            self.emission_intent_digest, self.sink_identity_digest,
            self.sink_id, self.idempotency_key, self.accepted_payload_sha256,
        ):
            validate_sha256(value)
        if type(self.sink_receipt) is not IdempotentClaimSinkReceipt:
            raise ValueError("sinkReceipt must be typed")
        if (
            self.sink_receipt.sink_id != self.sink_id
            or self.sink_receipt.idempotency_key != self.idempotency_key
            or self.sink_receipt.accepted_payload_sha256 != self.accepted_payload_sha256
            or self.sink_receipt.sink_protocol_version != "IDEMPOTENT_CLAIM_SINK_V1"
        ):
            raise ValueError("sink receipt does not match acknowledgement")
        acknowledged_at = _canonical_utc_instant(
            self.acknowledged_at,
            field="acknowledgedAt",
        )
        if (
            _canonical_utc_instant(
                self.sink_receipt.accepted_at,
                field="acceptedAt",
            )
            > acknowledged_at
        ):
            raise ValueError("sink receipt must precede acknowledgement")
        validate_sha256(self.emission_acknowledgement_digest)
        if self.emission_acknowledgement_digest != self.expected_digest():
            raise ValueError("emissionAcknowledgementDigest does not match acknowledgement")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind,
            "schemaVersion": self.schema_version,
            "workspaceId": self.workspace_id,
            "gateId": self.gate_id,
            "coordinatorEpochId": self.coordinator_epoch_id,
            "jobSequence": self.job_sequence,
            "jobRecordDigest": self.job_record_digest,
            "completionDigest": self.completion_digest,
            "emissionIntentDigest": self.emission_intent_digest,
            "sinkIdentityDigest": self.sink_identity_digest,
            "sinkId": self.sink_id,
            "idempotencyKey": self.idempotency_key,
            "acceptedPayloadSha256": self.accepted_payload_sha256,
            "sinkReceipt": self.sink_receipt.to_dict(),
            "acknowledgedAt": self.acknowledged_at,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_EMISSION_ACK_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {
            **self._digest_payload(),
            "emissionAcknowledgementDigest": self.emission_acknowledgement_digest,
        }

    def validate_reference(
        self,
        *,
        intent: ProofAdmissionEmissionIntent,
    ) -> None:
        if type(intent) is not ProofAdmissionEmissionIntent:
            raise ValueError(
                "acknowledgement requires a concrete intent reference"
            )
        if (
            self.workspace_id != intent.workspace_id
            or self.gate_id != intent.gate_id
            or self.coordinator_epoch_id != intent.coordinator_epoch_id
            or self.job_sequence != intent.job_sequence
            or self.job_record_digest != intent.job_record_digest
            or self.completion_digest != intent.completion_digest
            or self.emission_intent_digest != intent.emission_intent_digest
            or self.sink_identity_digest
            != intent.sink_identity.sink_identity_digest
            or self.sink_id != intent.sink_identity.sink_id
            or self.idempotency_key != intent.idempotency_key
            or self.accepted_payload_sha256 != intent.payload_sha256
            or _canonical_utc_instant(
                self.sink_receipt.accepted_at,
                field="acceptedAt",
            )
            < _canonical_utc_instant(
                intent.created_at,
                field="createdAt",
            )
        ):
            raise ValueError(
                "acknowledgement does not close over the exact intent"
            )

    @classmethod
    def create(
        cls,
        *,
        intent: ProofAdmissionEmissionIntent,
        sink_receipt: IdempotentClaimSinkReceipt,
        acknowledged_at: str,
    ) -> "ProofAdmissionEmissionAcknowledgement":
        if (
            type(intent) is not ProofAdmissionEmissionIntent
            or type(sink_receipt) is not IdempotentClaimSinkReceipt
        ):
            raise ValueError(
                "acknowledgement requires concrete intent and receipt"
            )
        intent_created_at = _canonical_utc_instant(
            intent.created_at,
            field="createdAt",
        )
        receipt_accepted_at = _canonical_utc_instant(
            sink_receipt.accepted_at,
            field="acceptedAt",
        )
        if (
            sink_receipt.sink_id != intent.sink_identity.sink_id
            or sink_receipt.idempotency_key != intent.idempotency_key
            or sink_receipt.accepted_payload_sha256 != intent.payload_sha256
            or intent_created_at > receipt_accepted_at
        ):
            raise ValueError("receipt does not acknowledge the exact intent")
        values = {
            "artifact_kind": "acceptance-proof-admission-emission-acknowledgement",
            "schema_version": 1,
            "workspace_id": intent.workspace_id,
            "gate_id": intent.gate_id,
            "coordinator_epoch_id": intent.coordinator_epoch_id,
            "job_sequence": intent.job_sequence,
            "job_record_digest": intent.job_record_digest,
            "completion_digest": intent.completion_digest,
            "emission_intent_digest": intent.emission_intent_digest,
            "sink_identity_digest": intent.sink_identity.sink_identity_digest,
            "sink_id": intent.sink_identity.sink_id,
            "idempotency_key": intent.idempotency_key,
            "accepted_payload_sha256": intent.payload_sha256,
            "sink_receipt": sink_receipt,
            "acknowledged_at": acknowledged_at,
        }
        wire = {
            "artifactKind": values["artifact_kind"],
            "schemaVersion": 1,
            "workspaceId": values["workspace_id"],
            "gateId": values["gate_id"],
            "coordinatorEpochId": values["coordinator_epoch_id"],
            "jobSequence": values["job_sequence"],
            "jobRecordDigest": values["job_record_digest"],
            "completionDigest": values["completion_digest"],
            "emissionIntentDigest": values["emission_intent_digest"],
            "sinkIdentityDigest": values["sink_identity_digest"],
            "sinkId": values["sink_id"],
            "idempotencyKey": values["idempotency_key"],
            "acceptedPayloadSha256": values["accepted_payload_sha256"],
            "sinkReceipt": sink_receipt.to_dict(),
            "acknowledgedAt": acknowledged_at,
        }
        acknowledgement = cls(
            **values,
            emission_acknowledgement_digest=domain_separated_sha256(
                _EMISSION_ACK_DOMAIN, wire
            ),
        )
        acknowledgement.validate_reference(intent=intent)
        return acknowledgement

    @classmethod
    def from_dict(
        cls,
        value: object,
        *,
        intent: ProofAdmissionEmissionIntent,
    ) -> "ProofAdmissionEmissionAcknowledgement":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        acknowledgement = cls(
            artifact_kind=data["artifactKind"],
            schema_version=data["schemaVersion"],
            workspace_id=data["workspaceId"],
            gate_id=data["gateId"],
            coordinator_epoch_id=data["coordinatorEpochId"],
            job_sequence=data["jobSequence"],
            job_record_digest=data["jobRecordDigest"],
            completion_digest=data["completionDigest"],
            emission_intent_digest=data["emissionIntentDigest"],
            sink_identity_digest=data["sinkIdentityDigest"],
            sink_id=data["sinkId"],
            idempotency_key=data["idempotencyKey"],
            accepted_payload_sha256=data["acceptedPayloadSha256"],
            sink_receipt=IdempotentClaimSinkReceipt.from_dict(data["sinkReceipt"]),
            acknowledged_at=data["acknowledgedAt"],
            emission_acknowledgement_digest=data["emissionAcknowledgementDigest"],
        )
        acknowledgement.validate_reference(intent=intent)
        return acknowledgement


def _validate_sequence_digest_tuple(
    value: object,
    *,
    field: str,
) -> tuple[tuple[int, str], ...]:
    if not isinstance(value, tuple):
        raise ValueError(f"{field} must be an immutable tuple")
    result: list[tuple[int, str]] = []
    for item in value:
        if not isinstance(item, tuple) or len(item) != 2:
            raise ValueError(f"{field} entries must be immutable pairs")
        result.append(
            (
                _validate_positive_integer(item[0], field="jobSequence"),
                validate_sha256(item[1]),
            )
        )
    validated = tuple(result)
    sequences = tuple(sequence for sequence, _ in validated)
    if sequences != tuple(sorted(sequences)) or len(sequences) != len(set(sequences)):
        raise ValueError(f"{field} must have unique ascending job sequences")
    return validated


def _sequence_digest_tuple_from_wire(
    value: object,
    *,
    field: str,
) -> tuple[tuple[int, str], ...]:
    if not isinstance(value, list):
        raise ValueError(f"{field} must be an array")
    result: list[tuple[int, str]] = []
    for item in value:
        if not isinstance(item, list) or len(item) != 2:
            raise ValueError(f"{field} entries must be two-element arrays")
        result.append((item[0], item[1]))
    return tuple(result)


def _sequence_digest_tuple_to_wire(
    value: tuple[tuple[int, str], ...],
) -> list[list[object]]:
    return [[sequence, digest] for sequence, digest in value]


@dataclass(frozen=True)
class ProofAdmissionEpochRef:
    __slots__ = (
        "workspace_id", "gate_id", "coordinator_epoch_id",
        "epoch_digest", "epoch_ref_digest",
    )
    workspace_id: str
    gate_id: str
    coordinator_epoch_id: str
    epoch_digest: str
    epoch_ref_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "workspaceId", "gateId", "coordinatorEpochId",
            "epochDigest", "epochRefDigest",
        }
    )

    def __post_init__(self) -> None:
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gate ID")
        _validate_non_empty_utf8(self.coordinator_epoch_id, field="coordinatorEpochId")
        validate_sha256(self.epoch_digest)
        validate_sha256(self.epoch_ref_digest)
        if self.epoch_ref_digest != self.expected_digest():
            raise ValueError("epochRefDigest does not match epoch ref")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "workspaceId": self.workspace_id,
            "gateId": self.gate_id,
            "coordinatorEpochId": self.coordinator_epoch_id,
            "epochDigest": self.epoch_digest,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_EPOCH_REF_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "epochRefDigest": self.epoch_ref_digest}

    @classmethod
    def create(cls, **values: object) -> "ProofAdmissionEpochRef":
        payload = {
            "workspaceId": values["workspace_id"],
            "gateId": values["gate_id"],
            "coordinatorEpochId": values["coordinator_epoch_id"],
            "epochDigest": values["epoch_digest"],
        }
        return cls(**values, epoch_ref_digest=domain_separated_sha256(_EPOCH_REF_DOMAIN, payload))

    @classmethod
    def from_dict(cls, value: object) -> "ProofAdmissionEpochRef":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            data["workspaceId"], data["gateId"], data["coordinatorEpochId"],
            data["epochDigest"], data["epochRefDigest"],
        )


@dataclass(frozen=True)
class ProofAdmissionCurrentEpoch:
    __slots__ = (
        "artifact_kind", "schema_version", "workspace_id", "gate_id",
        "coordinator_epoch_id", "epoch_digest", "current_epoch_digest",
    )
    artifact_kind: str
    schema_version: int
    workspace_id: str
    gate_id: str
    coordinator_epoch_id: str
    epoch_digest: str
    current_epoch_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "artifactKind", "schemaVersion", "workspaceId", "gateId",
            "coordinatorEpochId", "epochDigest", "currentEpochDigest",
        }
    )

    def __post_init__(self) -> None:
        if self.artifact_kind != "acceptance-proof-admission-current-epoch":
            raise ValueError("artifactKind is invalid")
        if self.schema_version != 1 or isinstance(self.schema_version, bool):
            raise ValueError("schemaVersion must be 1")
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gate ID")
        _validate_non_empty_utf8(self.coordinator_epoch_id, field="coordinatorEpochId")
        validate_sha256(self.epoch_digest)
        validate_sha256(self.current_epoch_digest)
        if self.current_epoch_digest != self.expected_digest():
            raise ValueError("currentEpochDigest does not match selector")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind,
            "schemaVersion": self.schema_version,
            "workspaceId": self.workspace_id,
            "gateId": self.gate_id,
            "coordinatorEpochId": self.coordinator_epoch_id,
            "epochDigest": self.epoch_digest,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_CURRENT_EPOCH_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "currentEpochDigest": self.current_epoch_digest}

    @classmethod
    def create(cls, **values: object) -> "ProofAdmissionCurrentEpoch":
        payload = {
            "artifactKind": "acceptance-proof-admission-current-epoch",
            "schemaVersion": 1,
            "workspaceId": values["workspace_id"],
            "gateId": values["gate_id"],
            "coordinatorEpochId": values["coordinator_epoch_id"],
            "epochDigest": values["epoch_digest"],
        }
        return cls(
            "acceptance-proof-admission-current-epoch", 1,
            values["workspace_id"], values["gate_id"],
            values["coordinator_epoch_id"], values["epoch_digest"],
            domain_separated_sha256(_CURRENT_EPOCH_DOMAIN, payload),
        )

    @classmethod
    def from_dict(cls, value: object) -> "ProofAdmissionCurrentEpoch":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            data["artifactKind"], data["schemaVersion"], data["workspaceId"],
            data["gateId"], data["coordinatorEpochId"], data["epochDigest"],
            data["currentEpochDigest"],
        )


@dataclass(frozen=True)
class ProofAdmissionPauseRecord:
    __slots__ = (
        "artifact_kind", "schema_version", "workspace_id", "gate_id",
        "coordinator_epoch_id", "epoch_digest", "claim_admission_lock_identity",
        "claim_sequence_lock_identity", "last_accepted_job_sequence",
        "paused_at", "pause_digest",
    )
    artifact_kind: str
    schema_version: int
    workspace_id: str
    gate_id: str
    coordinator_epoch_id: str
    epoch_digest: str
    claim_admission_lock_identity: ProofAdmissionLockIdentity
    claim_sequence_lock_identity: ProofAdmissionLockIdentity
    last_accepted_job_sequence: int
    paused_at: str
    pause_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "artifactKind", "schemaVersion", "workspaceId", "gateId",
            "coordinatorEpochId", "epochDigest", "claimAdmissionLockIdentity",
            "claimSequenceLockIdentity", "lastAcceptedJobSequence",
            "pausedAt", "pauseDigest",
        }
    )

    def __post_init__(self) -> None:
        if self.artifact_kind != "acceptance-proof-admission-pause":
            raise ValueError("artifactKind is invalid")
        if self.schema_version != 1 or isinstance(self.schema_version, bool):
            raise ValueError("schemaVersion must be 1")
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gate ID")
        _validate_non_empty_utf8(self.coordinator_epoch_id, field="coordinatorEpochId")
        validate_sha256(self.epoch_digest)
        if type(self.claim_admission_lock_identity) is not ProofAdmissionLockIdentity:
            raise ValueError("claimAdmissionLockIdentity must be typed")
        if type(self.claim_sequence_lock_identity) is not ProofAdmissionLockIdentity:
            raise ValueError("claimSequenceLockIdentity must be typed")
        _validate_non_negative_integer(
            self.last_accepted_job_sequence, field="lastAcceptedJobSequence"
        )
        _canonical_utc_instant(self.paused_at, field="pausedAt")
        validate_sha256(self.pause_digest)
        if self.pause_digest != self.expected_digest():
            raise ValueError("pauseDigest does not match pause record")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind,
            "schemaVersion": self.schema_version,
            "workspaceId": self.workspace_id,
            "gateId": self.gate_id,
            "coordinatorEpochId": self.coordinator_epoch_id,
            "epochDigest": self.epoch_digest,
            "claimAdmissionLockIdentity": self.claim_admission_lock_identity.to_dict(),
            "claimSequenceLockIdentity": self.claim_sequence_lock_identity.to_dict(),
            "lastAcceptedJobSequence": self.last_accepted_job_sequence,
            "pausedAt": self.paused_at,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_PAUSE_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "pauseDigest": self.pause_digest}

    @classmethod
    def create(cls, **values: object) -> "ProofAdmissionPauseRecord":
        if (
            type(values.get("claim_admission_lock_identity"))
            is not ProofAdmissionLockIdentity
            or type(values.get("claim_sequence_lock_identity"))
            is not ProofAdmissionLockIdentity
        ):
            raise ValueError(
                "pause inputs must use concrete lock identities"
            )
        wire = {
            "artifactKind": "acceptance-proof-admission-pause",
            "schemaVersion": 1,
            "workspaceId": values["workspace_id"],
            "gateId": values["gate_id"],
            "coordinatorEpochId": values["coordinator_epoch_id"],
            "epochDigest": values["epoch_digest"],
            "claimAdmissionLockIdentity": values["claim_admission_lock_identity"].to_dict(),
            "claimSequenceLockIdentity": values["claim_sequence_lock_identity"].to_dict(),
            "lastAcceptedJobSequence": values["last_accepted_job_sequence"],
            "pausedAt": values["paused_at"],
        }
        return cls(
            artifact_kind="acceptance-proof-admission-pause",
            schema_version=1,
            pause_digest=domain_separated_sha256(_PAUSE_DOMAIN, wire),
            **values,
        )

    @classmethod
    def from_dict(cls, value: object) -> "ProofAdmissionPauseRecord":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            artifact_kind=data["artifactKind"],
            schema_version=data["schemaVersion"],
            workspace_id=data["workspaceId"],
            gate_id=data["gateId"],
            coordinator_epoch_id=data["coordinatorEpochId"],
            epoch_digest=data["epochDigest"],
            claim_admission_lock_identity=ProofAdmissionLockIdentity.from_dict(data["claimAdmissionLockIdentity"]),
            claim_sequence_lock_identity=ProofAdmissionLockIdentity.from_dict(data["claimSequenceLockIdentity"]),
            last_accepted_job_sequence=data["lastAcceptedJobSequence"],
            paused_at=data["pausedAt"],
            pause_digest=data["pauseDigest"],
        )


@dataclass(frozen=True)
class ProofAdmissionQuiescence:
    __slots__ = (
        "artifact_kind", "schema_version", "workspace_id", "gate_id",
        "coordinator_epoch_id", "epoch_digest", "current_epoch_digest",
        "coordinator_state", "source_commit", "proof_admission_source_digest",
        "claim_admission_lock_identity", "claim_sequence_lock_identity",
        "pause_digest", "registered_jobs", "terminal_job_completions",
        "acknowledged_emissions", "pending_emissions", "active_jobs",
        "captured_at", "quiescence_digest",
    )
    artifact_kind: str
    schema_version: int
    workspace_id: str
    gate_id: str
    coordinator_epoch_id: str
    epoch_digest: str
    current_epoch_digest: str
    coordinator_state: str
    source_commit: str
    proof_admission_source_digest: str
    claim_admission_lock_identity: ProofAdmissionLockIdentity
    claim_sequence_lock_identity: ProofAdmissionLockIdentity
    pause_digest: str
    registered_jobs: tuple[tuple[int, str], ...]
    terminal_job_completions: tuple[tuple[int, str], ...]
    acknowledged_emissions: tuple[tuple[int, str], ...]
    pending_emissions: tuple[()]
    active_jobs: tuple[()]
    captured_at: str
    quiescence_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "artifactKind", "schemaVersion", "workspaceId", "gateId",
            "coordinatorEpochId", "epochDigest", "currentEpochDigest",
            "coordinatorState", "sourceCommit", "proofAdmissionSourceDigest",
            "claimAdmissionLockIdentity", "claimSequenceLockIdentity",
            "pauseDigest", "registeredJobs", "terminalJobCompletions",
            "acknowledgedEmissions", "pendingEmissions", "activeJobs",
            "capturedAt", "quiescenceDigest",
        }
    )

    def __post_init__(self) -> None:
        if self.artifact_kind != "acceptance-proof-admission-quiescence":
            raise ValueError("artifactKind is invalid")
        if self.schema_version != 1 or isinstance(self.schema_version, bool):
            raise ValueError("schemaVersion must be 1")
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gate ID")
        _validate_non_empty_utf8(self.coordinator_epoch_id, field="coordinatorEpochId")
        if self.coordinator_state != "PAUSED":
            raise ValueError("coordinatorState must be PAUSED")
        _validate_non_empty_utf8(self.source_commit, field="sourceCommit")
        for value in (
            self.epoch_digest, self.current_epoch_digest,
            self.proof_admission_source_digest, self.pause_digest,
        ):
            validate_sha256(value)
        if type(self.claim_admission_lock_identity) is not ProofAdmissionLockIdentity:
            raise ValueError("claimAdmissionLockIdentity must be typed")
        if type(self.claim_sequence_lock_identity) is not ProofAdmissionLockIdentity:
            raise ValueError("claimSequenceLockIdentity must be typed")
        registered = _validate_sequence_digest_tuple(self.registered_jobs, field="registeredJobs")
        completed = _validate_sequence_digest_tuple(
            self.terminal_job_completions, field="terminalJobCompletions"
        )
        acknowledged = _validate_sequence_digest_tuple(
            self.acknowledged_emissions, field="acknowledgedEmissions"
        )
        registered_sequences = tuple(sequence for sequence, _ in registered)
        if registered_sequences != tuple(range(1, len(registered_sequences) + 1)):
            raise ValueError("registeredJobs must be contiguous from sequence 1")
        if tuple(sequence for sequence, _ in completed) != registered_sequences:
            raise ValueError("every registered job requires one terminal completion")
        if not set(sequence for sequence, _ in acknowledged).issubset(registered_sequences):
            raise ValueError("acknowledged emission refers to an unknown job")
        if self.pending_emissions != () or self.active_jobs != ():
            raise ValueError("quiescence requires no pending emissions or active jobs")
        _canonical_utc_instant(self.captured_at, field="capturedAt")
        validate_sha256(self.quiescence_digest)
        if self.quiescence_digest != self.expected_digest():
            raise ValueError("quiescenceDigest does not match quiescence")

    def validate_references(
        self,
        *,
        epoch: ProofAdmissionEpochRecord,
        current_epoch: ProofAdmissionCurrentEpoch,
        pause: ProofAdmissionPauseRecord,
        jobs: tuple[ProofAdmissionJobRecord, ...],
        completions: tuple[ProofAdmissionJobCompletion, ...],
        intents: tuple[ProofAdmissionEmissionIntent, ...],
        acknowledgements: tuple[
            ProofAdmissionEmissionAcknowledgement, ...
        ],
    ) -> None:
        if (
            type(epoch) is not ProofAdmissionEpochRecord
            or type(current_epoch) is not ProofAdmissionCurrentEpoch
            or type(pause) is not ProofAdmissionPauseRecord
            or type(jobs) is not tuple
            or type(completions) is not tuple
            or type(intents) is not tuple
            or type(acknowledgements) is not tuple
            or any(type(job) is not ProofAdmissionJobRecord for job in jobs)
            or any(
                type(completion) is not ProofAdmissionJobCompletion
                for completion in completions
            )
            or any(
                type(intent) is not ProofAdmissionEmissionIntent
                for intent in intents
            )
            or any(
                type(acknowledgement)
                is not ProofAdmissionEmissionAcknowledgement
                for acknowledgement in acknowledgements
            )
        ):
            raise ValueError(
                "quiescence requires concrete job, completion, and "
                "acknowledgement references"
            )
        jobs_by_sequence = {job.job_sequence: job for job in jobs}
        completions_by_sequence = {
            completion.job_sequence: completion
            for completion in completions
        }
        intents_by_sequence = {
            intent.job_sequence: intent
            for intent in intents
        }
        acknowledgements_by_sequence = {
            acknowledgement.job_sequence: acknowledgement
            for acknowledgement in acknowledgements
        }
        if (
            len(jobs_by_sequence) != len(jobs)
            or len(completions_by_sequence) != len(completions)
            or len(intents_by_sequence) != len(intents)
            or len(acknowledgements_by_sequence) != len(acknowledgements)
            or tuple(
                (sequence, job.job_record_digest)
                for sequence, job in sorted(jobs_by_sequence.items())
            )
            != self.registered_jobs
            or tuple(
                (sequence, completion.completion_digest)
                for sequence, completion
                in sorted(completions_by_sequence.items())
            )
            != self.terminal_job_completions
            or tuple(
                (
                    sequence,
                    acknowledgement.emission_acknowledgement_digest,
                )
                for sequence, acknowledgement
                in sorted(acknowledgements_by_sequence.items())
            )
            != self.acknowledged_emissions
        ):
            raise ValueError(
                "quiescence references do not match recorded digest sets"
            )
        if (
            epoch.workspace_id != self.workspace_id
            or epoch.gate_id != self.gate_id
            or epoch.coordinator_epoch_id != self.coordinator_epoch_id
            or epoch.epoch_digest != self.epoch_digest
            or epoch.source_commit != self.source_commit
            or epoch.proof_admission_source_digest
            != self.proof_admission_source_digest
            or canonical_json_bytes(
                epoch.claim_admission_lock_identity.to_dict()
            )
            != canonical_json_bytes(
                self.claim_admission_lock_identity.to_dict()
            )
            or canonical_json_bytes(
                epoch.claim_sequence_lock_identity.to_dict()
            )
            != canonical_json_bytes(
                self.claim_sequence_lock_identity.to_dict()
            )
            or current_epoch.workspace_id != self.workspace_id
            or current_epoch.gate_id != self.gate_id
            or current_epoch.coordinator_epoch_id
            != self.coordinator_epoch_id
            or current_epoch.epoch_digest != self.epoch_digest
            or current_epoch.current_epoch_digest
            != self.current_epoch_digest
            or pause.workspace_id != self.workspace_id
            or pause.gate_id != self.gate_id
            or pause.coordinator_epoch_id != self.coordinator_epoch_id
            or pause.epoch_digest != self.epoch_digest
            or pause.pause_digest != self.pause_digest
            or pause.last_accepted_job_sequence != len(self.registered_jobs)
            or canonical_json_bytes(
                pause.claim_admission_lock_identity.to_dict()
            )
            != canonical_json_bytes(
                self.claim_admission_lock_identity.to_dict()
            )
            or canonical_json_bytes(
                pause.claim_sequence_lock_identity.to_dict()
            )
            != canonical_json_bytes(
                self.claim_sequence_lock_identity.to_dict()
            )
            or _canonical_utc_instant(
                pause.paused_at,
                field="pausedAt",
            )
            < _canonical_utc_instant(
                epoch.started_at,
                field="startedAt",
            )
            or _canonical_utc_instant(
                pause.paused_at,
                field="pausedAt",
            )
            > _canonical_utc_instant(
                self.captured_at,
                field="capturedAt",
            )
        ):
            raise ValueError(
                "quiescence epoch, current, or pause reference does not "
                "match record"
            )
        expected_acknowledgement_sequences: set[int] = set()
        for sequence, job in jobs_by_sequence.items():
            completion = completions_by_sequence.get(sequence)
            if completion is None:
                raise ValueError(
                    "quiescence requires one completion per job"
                )
            if (
                job.workspace_id != self.workspace_id
                or job.gate_id != self.gate_id
                or job.coordinator_epoch_id != self.coordinator_epoch_id
                or job.epoch_digest != self.epoch_digest
                or job.source_commit != self.source_commit
                or job.proof_admission_source_digest
                != self.proof_admission_source_digest
                or job.claim_admission_lock_identity
                != self.claim_admission_lock_identity
                or job.claim_sequence_lock_identity
                != self.claim_sequence_lock_identity
            ):
                raise ValueError(
                    "quiescence job identity does not match epoch"
                )
            completion.validate_references(job=job, epoch=epoch)
            if (
                _canonical_utc_instant(
                    job.registered_at,
                    field="registeredAt",
                )
                > _canonical_utc_instant(
                    pause.paused_at,
                    field="pausedAt",
                )
                or _canonical_utc_instant(
                    completion.completed_at,
                    field="completedAt",
                )
                > _canonical_utc_instant(
                    self.captured_at,
                    field="capturedAt",
                )
            ):
                raise ValueError(
                    "quiescence references violate lifecycle chronology"
                )
            if (
                completion.terminal_state
                is ProofAdmissionJobTerminalState.COMPLETED
            ):
                expected_acknowledgement_sequences.add(sequence)
        if (
            set(intents_by_sequence)
            != expected_acknowledgement_sequences
            or set(acknowledgements_by_sequence)
            != expected_acknowledgement_sequences
        ):
            raise ValueError(
                "quiescence intent and acknowledgement cardinality does not "
                "match terminal states"
            )
        for sequence, acknowledgement in (
            acknowledgements_by_sequence.items()
        ):
            job = jobs_by_sequence[sequence]
            completion = completions_by_sequence[sequence]
            intent = intents_by_sequence[sequence]
            intent.validate_references(
                job=job,
                completion=completion,
                epoch=epoch,
            )
            acknowledgement.validate_reference(intent=intent)
            if (
                _canonical_utc_instant(
                    intent.created_at,
                    field="createdAt",
                )
                > _canonical_utc_instant(
                    acknowledgement.acknowledged_at,
                    field="acknowledgedAt",
                )
                or _canonical_utc_instant(
                    acknowledgement.acknowledged_at,
                    field="acknowledgedAt",
                )
                > _canonical_utc_instant(
                    self.captured_at,
                    field="capturedAt",
                )
                or acknowledgement.workspace_id != self.workspace_id
                or acknowledgement.gate_id != self.gate_id
                or acknowledgement.coordinator_epoch_id
                != self.coordinator_epoch_id
                or acknowledgement.job_record_digest
                != job.job_record_digest
                or acknowledgement.completion_digest
                != completion.completion_digest
                or acknowledgement.sink_identity_digest
                != job.sink_identity.sink_identity_digest
                or acknowledgement.sink_id != job.sink_identity.sink_id
            ):
                raise ValueError(
                    "quiescence acknowledgement does not close over job "
                    "and completion"
                )

    def _digest_payload(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind,
            "schemaVersion": self.schema_version,
            "workspaceId": self.workspace_id,
            "gateId": self.gate_id,
            "coordinatorEpochId": self.coordinator_epoch_id,
            "epochDigest": self.epoch_digest,
            "currentEpochDigest": self.current_epoch_digest,
            "coordinatorState": self.coordinator_state,
            "sourceCommit": self.source_commit,
            "proofAdmissionSourceDigest": self.proof_admission_source_digest,
            "claimAdmissionLockIdentity": self.claim_admission_lock_identity.to_dict(),
            "claimSequenceLockIdentity": self.claim_sequence_lock_identity.to_dict(),
            "pauseDigest": self.pause_digest,
            "registeredJobs": _sequence_digest_tuple_to_wire(self.registered_jobs),
            "terminalJobCompletions": _sequence_digest_tuple_to_wire(self.terminal_job_completions),
            "acknowledgedEmissions": _sequence_digest_tuple_to_wire(self.acknowledged_emissions),
            "pendingEmissions": [],
            "activeJobs": [],
            "capturedAt": self.captured_at,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_QUIESCENCE_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "quiescenceDigest": self.quiescence_digest}

    @classmethod
    def create(
        cls,
        *,
        epoch: ProofAdmissionEpochRecord,
        current_epoch: ProofAdmissionCurrentEpoch,
        pause: ProofAdmissionPauseRecord,
        jobs: tuple[ProofAdmissionJobRecord, ...],
        completions: tuple[ProofAdmissionJobCompletion, ...],
        intents: tuple[ProofAdmissionEmissionIntent, ...],
        acknowledgements: tuple[
            ProofAdmissionEmissionAcknowledgement, ...
        ],
        **values: object,
    ) -> "ProofAdmissionQuiescence":
        if (
            type(values.get("claim_admission_lock_identity"))
            is not ProofAdmissionLockIdentity
            or type(values.get("claim_sequence_lock_identity"))
            is not ProofAdmissionLockIdentity
        ):
            raise ValueError(
                "quiescence inputs must use concrete lock identities"
            )
        values = {
            "artifact_kind": "acceptance-proof-admission-quiescence",
            "schema_version": 1,
            "coordinator_state": "PAUSED",
            "pending_emissions": (),
            "active_jobs": (),
            **values,
        }
        wire = {
            "artifactKind": values["artifact_kind"],
            "schemaVersion": 1,
            "workspaceId": values["workspace_id"],
            "gateId": values["gate_id"],
            "coordinatorEpochId": values["coordinator_epoch_id"],
            "epochDigest": values["epoch_digest"],
            "currentEpochDigest": values["current_epoch_digest"],
            "coordinatorState": values["coordinator_state"],
            "sourceCommit": values["source_commit"],
            "proofAdmissionSourceDigest": values["proof_admission_source_digest"],
            "claimAdmissionLockIdentity": values["claim_admission_lock_identity"].to_dict(),
            "claimSequenceLockIdentity": values["claim_sequence_lock_identity"].to_dict(),
            "pauseDigest": values["pause_digest"],
            "registeredJobs": _sequence_digest_tuple_to_wire(values["registered_jobs"]),
            "terminalJobCompletions": _sequence_digest_tuple_to_wire(values["terminal_job_completions"]),
            "acknowledgedEmissions": _sequence_digest_tuple_to_wire(values["acknowledged_emissions"]),
            "pendingEmissions": [],
            "activeJobs": [],
            "capturedAt": values["captured_at"],
        }
        quiescence = cls(
            **values,
            quiescence_digest=domain_separated_sha256(
                _QUIESCENCE_DOMAIN, wire
            ),
        )
        quiescence.validate_references(
            epoch=epoch,
            current_epoch=current_epoch,
            pause=pause,
            jobs=jobs,
            completions=completions,
            intents=intents,
            acknowledgements=acknowledgements,
        )
        return quiescence

    @classmethod
    def from_dict(
        cls,
        value: object,
        *,
        epoch: ProofAdmissionEpochRecord,
        current_epoch: ProofAdmissionCurrentEpoch,
        pause: ProofAdmissionPauseRecord,
        jobs: tuple[ProofAdmissionJobRecord, ...],
        completions: tuple[ProofAdmissionJobCompletion, ...],
        intents: tuple[ProofAdmissionEmissionIntent, ...],
        acknowledgements: tuple[
            ProofAdmissionEmissionAcknowledgement, ...
        ],
    ) -> "ProofAdmissionQuiescence":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        for field in (
            "registeredJobs", "terminalJobCompletions", "acknowledgedEmissions",
            "pendingEmissions", "activeJobs",
        ):
            if not isinstance(data[field], list):
                raise ValueError(f"{field} must be an array")
        quiescence = cls(
            artifact_kind=data["artifactKind"],
            schema_version=data["schemaVersion"],
            workspace_id=data["workspaceId"],
            gate_id=data["gateId"],
            coordinator_epoch_id=data["coordinatorEpochId"],
            epoch_digest=data["epochDigest"],
            current_epoch_digest=data["currentEpochDigest"],
            coordinator_state=data["coordinatorState"],
            source_commit=data["sourceCommit"],
            proof_admission_source_digest=data["proofAdmissionSourceDigest"],
            claim_admission_lock_identity=ProofAdmissionLockIdentity.from_dict(data["claimAdmissionLockIdentity"]),
            claim_sequence_lock_identity=ProofAdmissionLockIdentity.from_dict(data["claimSequenceLockIdentity"]),
            pause_digest=data["pauseDigest"],
            registered_jobs=_sequence_digest_tuple_from_wire(data["registeredJobs"], field="registeredJobs"),
            terminal_job_completions=_sequence_digest_tuple_from_wire(data["terminalJobCompletions"], field="terminalJobCompletions"),
            acknowledged_emissions=_sequence_digest_tuple_from_wire(data["acknowledgedEmissions"], field="acknowledgedEmissions"),
            pending_emissions=tuple(data["pendingEmissions"]),
            active_jobs=tuple(data["activeJobs"]),
            captured_at=data["capturedAt"],
            quiescence_digest=data["quiescenceDigest"],
        )
        quiescence.validate_references(
            epoch=epoch,
            current_epoch=current_epoch,
            pause=pause,
            jobs=jobs,
            completions=completions,
            intents=intents,
            acknowledgements=acknowledgements,
        )
        return quiescence


class DurabilityBackend(str, Enum):
    LINUX_FILE_AND_DIRECTORY_FSYNC_V1 = "LINUX_FILE_AND_DIRECTORY_FSYNC_V1"
    DARWIN_APFS_FULLFSYNC_V1 = "DARWIN_APFS_FULLFSYNC_V1"


class DurabilitySyncOperation(str, Enum):
    WRITE_TEMP = "WRITE_TEMP"
    SYNC_FILE = "SYNC_FILE"
    RENAME_FINAL = "RENAME_FINAL"
    SYNC_DIRECTORY = "SYNC_DIRECTORY"
    SYNC_ANCHOR = "SYNC_ANCHOR"


class DurabilityInterruptionPoint(str, Enum):
    BEFORE_FILE_SYNC = "BEFORE_FILE_SYNC"
    AFTER_FILE_SYNC = "AFTER_FILE_SYNC"
    AFTER_RENAME = "AFTER_RENAME"
    AFTER_DIRECTORY_SYNC = "AFTER_DIRECTORY_SYNC"
    AFTER_ANCHOR_SYNC = "AFTER_ANCHOR_SYNC"


class DurabilityRecoveredState(str, Enum):
    ABSENT = "ABSENT"
    OLD_BYTES = "OLD_BYTES"
    NEW_BYTES = "NEW_BYTES"
    OTHER = "OTHER"


class DurabilityTrustMode(str, Enum):
    BOOTSTRAP_CANDIDATE = "BOOTSTRAP_CANDIDATE"
    ACTIVE_ANCHOR = "ACTIVE_ANCHOR"


class DurabilityObservationMode(str, Enum):
    QUALIFICATION_BOOTSTRAP = "QUALIFICATION_BOOTSTRAP"
    ACTIVE_PROFILE = "ACTIVE_PROFILE"


class DurabilitySupportResult(str, Enum):
    SUPPORTED = "SUPPORTED"


class PowerInterruptionKind(str, Enum):
    PHYSICAL_POWER_CUT = "PHYSICAL_POWER_CUT"
    VM_HARD_POWER_OFF = "VM_HARD_POWER_OFF"


class DurabilityCapabilityArtifactName(str, Enum):
    EXPECTATION = "EXPECTATION"
    EXECUTION_START = "EXECUTION_START"
    MANIFEST = "MANIFEST"
    POWER_CUT_TRACE = "POWER_CUT_TRACE"
    RECOVERY_RESULT = "RECOVERY_RESULT"
    BOOT_OBSERVATION = "BOOT_OBSERVATION"
    QUALIFICATION_BOOT_OBSERVATION = "QUALIFICATION_BOOT_OBSERVATION"
    CONTROLLER_RUNTIME_EPOCH = "CONTROLLER_RUNTIME_EPOCH"
    CONTROLLER_RUNTIME_CURRENT = "CONTROLLER_RUNTIME_CURRENT"
    CONTROLLER_LOCK_CONTENTION = "CONTROLLER_LOCK_CONTENTION"
    CONTROLLER_RECEIPT = "CONTROLLER_RECEIPT"
    CONTROLLER_ARM_RECEIPT = "CONTROLLER_ARM_RECEIPT"
    CONTROLLER_EXECUTION_RECEIPT = "CONTROLLER_EXECUTION_RECEIPT"
    CONTROLLER_COMMAND_JOURNAL = "CONTROLLER_COMMAND_JOURNAL"
    CONTROLLER_COMMAND_JOURNAL_HEAD = "CONTROLLER_COMMAND_JOURNAL_HEAD"
    PROBE_RUNTIME_MANIFEST = "PROBE_RUNTIME_MANIFEST"
    PROBE_RUNTIME_BLOB = "PROBE_RUNTIME_BLOB"


@dataclass(frozen=True)
class DurabilityCapabilityArtifactRef:
    __slots__ = (
        "artifact_kind", "schema_version", "workspace_id", "gate_id",
        "crash_fixture_id", "artifact_name", "object_digest",
        "content_sha256", "byte_length", "durability_capability_ref_digest",
    )
    artifact_kind: str
    schema_version: int
    workspace_id: str
    gate_id: str
    crash_fixture_id: str
    artifact_name: DurabilityCapabilityArtifactName
    object_digest: str | None
    content_sha256: str
    byte_length: int
    durability_capability_ref_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "artifactKind", "schemaVersion", "workspaceId", "gateId",
            "crashFixtureId", "artifactName", "objectDigest",
            "contentSha256", "byteLength", "durabilityCapabilityRefDigest",
        }
    )

    def __post_init__(self) -> None:
        if self.artifact_kind != "acceptance-durability-capability-ref":
            raise ValueError("artifactKind is invalid")
        if self.schema_version != 1 or isinstance(self.schema_version, bool):
            raise ValueError("schemaVersion must be 1")
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gate ID")
        _validate_slug(self.crash_fixture_id, field="crashFixtureId")
        if not isinstance(self.artifact_name, DurabilityCapabilityArtifactName):
            raise ValueError("artifactName must be closed")
        if self.artifact_name is DurabilityCapabilityArtifactName.PROBE_RUNTIME_BLOB:
            if self.object_digest is not None:
                raise ValueError("PROBE_RUNTIME_BLOB requires null objectDigest")
        else:
            validate_sha256(self.object_digest)
        validate_sha256(self.content_sha256)
        _validate_non_negative_integer(self.byte_length, field="byteLength")
        validate_sha256(self.durability_capability_ref_digest)
        if self.durability_capability_ref_digest != self.expected_digest():
            raise ValueError("durabilityCapabilityRefDigest does not match ref")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind,
            "schemaVersion": self.schema_version,
            "workspaceId": self.workspace_id,
            "gateId": self.gate_id,
            "crashFixtureId": self.crash_fixture_id,
            "artifactName": self.artifact_name.value,
            "objectDigest": self.object_digest,
            "contentSha256": self.content_sha256,
            "byteLength": self.byte_length,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(
            _DURABILITY_CAPABILITY_REF_DOMAIN, self._digest_payload()
        )

    def to_dict(self) -> dict[str, object]:
        return {
            **self._digest_payload(),
            "durabilityCapabilityRefDigest": self.durability_capability_ref_digest,
        }

    @classmethod
    def create(cls, **values: object) -> "DurabilityCapabilityArtifactRef":
        wire = {
            "artifactKind": "acceptance-durability-capability-ref",
            "schemaVersion": 1,
            "workspaceId": values["workspace_id"],
            "gateId": values["gate_id"],
            "crashFixtureId": values["crash_fixture_id"],
            "artifactName": values["artifact_name"].value,
            "objectDigest": values["object_digest"],
            "contentSha256": values["content_sha256"],
            "byteLength": values["byte_length"],
        }
        return cls(
            artifact_kind="acceptance-durability-capability-ref",
            schema_version=1,
            durability_capability_ref_digest=domain_separated_sha256(
                _DURABILITY_CAPABILITY_REF_DOMAIN, wire
            ),
            **values,
        )

    @classmethod
    def from_dict(cls, value: object) -> "DurabilityCapabilityArtifactRef":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            artifact_kind=data["artifactKind"],
            schema_version=data["schemaVersion"],
            workspace_id=data["workspaceId"],
            gate_id=data["gateId"],
            crash_fixture_id=data["crashFixtureId"],
            artifact_name=_enum_from_wire(
                DurabilityCapabilityArtifactName,
                data["artifactName"],
                field="artifactName",
            ),
            object_digest=data["objectDigest"],
            content_sha256=data["contentSha256"],
            byte_length=data["byteLength"],
            durability_capability_ref_digest=data["durabilityCapabilityRefDigest"],
        )


@dataclass(frozen=True)
class DarwinStableVolumeIdentity:
    __slots__ = (
        "os_family",
        "filesystem_type",
        "volume_uuid",
        "container_uuid",
        "volume_identity_digest",
    )
    os_family: RuntimeOsFamily
    filesystem_type: str
    volume_uuid: str
    container_uuid: str
    volume_identity_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "osFamily",
            "filesystemType",
            "volumeUuid",
            "containerUuid",
            "volumeIdentityDigest",
        }
    )

    def __post_init__(self) -> None:
        if self.os_family is not RuntimeOsFamily.DARWIN:
            raise ValueError("Darwin stable volume osFamily must be DARWIN")
        if self.filesystem_type != "APFS":
            raise ValueError("Darwin stable volume filesystemType must be APFS")
        _validate_non_empty_utf8(self.volume_uuid, field="volumeUuid")
        _validate_non_empty_utf8(self.container_uuid, field="containerUuid")
        validate_sha256(self.volume_identity_digest)
        if self.volume_identity_digest != self.expected_digest():
            raise ValueError("volumeIdentityDigest does not match stable volume")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "osFamily": self.os_family.value,
            "filesystemType": self.filesystem_type,
            "volumeUuid": self.volume_uuid,
            "containerUuid": self.container_uuid,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(
            _STABLE_VOLUME_IDENTITY_DOMAIN,
            self._digest_payload(),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            **self._digest_payload(),
            "volumeIdentityDigest": self.volume_identity_digest,
        }

    @classmethod
    def create(
        cls,
        *,
        volume_uuid: str,
        container_uuid: str,
    ) -> "DarwinStableVolumeIdentity":
        payload = {
            "osFamily": RuntimeOsFamily.DARWIN.value,
            "filesystemType": "APFS",
            "volumeUuid": volume_uuid,
            "containerUuid": container_uuid,
        }
        return cls(
            os_family=RuntimeOsFamily.DARWIN,
            filesystem_type="APFS",
            volume_uuid=volume_uuid,
            container_uuid=container_uuid,
            volume_identity_digest=domain_separated_sha256(
                _STABLE_VOLUME_IDENTITY_DOMAIN,
                payload,
            ),
        )

    @classmethod
    def from_dict(cls, value: object) -> "DarwinStableVolumeIdentity":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            os_family=_enum_from_wire(
                RuntimeOsFamily,
                data["osFamily"],
                field="osFamily",
            ),
            filesystem_type=data["filesystemType"],
            volume_uuid=data["volumeUuid"],
            container_uuid=data["containerUuid"],
            volume_identity_digest=data["volumeIdentityDigest"],
        )


@dataclass(frozen=True)
class LinuxStableVolumeIdentity:
    __slots__ = (
        "os_family",
        "filesystem_type",
        "filesystem_uuid",
        "volume_identity_digest",
    )
    os_family: RuntimeOsFamily
    filesystem_type: str
    filesystem_uuid: str
    volume_identity_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "osFamily",
            "filesystemType",
            "filesystemUuid",
            "volumeIdentityDigest",
        }
    )

    def __post_init__(self) -> None:
        if self.os_family is not RuntimeOsFamily.LINUX:
            raise ValueError("Linux stable volume osFamily must be LINUX")
        _validate_non_empty_utf8(self.filesystem_type, field="filesystemType")
        _validate_non_empty_utf8(self.filesystem_uuid, field="filesystemUuid")
        validate_sha256(self.volume_identity_digest)
        if self.volume_identity_digest != self.expected_digest():
            raise ValueError("volumeIdentityDigest does not match stable volume")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "osFamily": self.os_family.value,
            "filesystemType": self.filesystem_type,
            "filesystemUuid": self.filesystem_uuid,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(
            _STABLE_VOLUME_IDENTITY_DOMAIN,
            self._digest_payload(),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            **self._digest_payload(),
            "volumeIdentityDigest": self.volume_identity_digest,
        }

    @classmethod
    def create(
        cls,
        *,
        filesystem_type: str,
        filesystem_uuid: str,
    ) -> "LinuxStableVolumeIdentity":
        payload = {
            "osFamily": RuntimeOsFamily.LINUX.value,
            "filesystemType": filesystem_type,
            "filesystemUuid": filesystem_uuid,
        }
        return cls(
            os_family=RuntimeOsFamily.LINUX,
            filesystem_type=filesystem_type,
            filesystem_uuid=filesystem_uuid,
            volume_identity_digest=domain_separated_sha256(
                _STABLE_VOLUME_IDENTITY_DOMAIN,
                payload,
            ),
        )

    @classmethod
    def from_dict(cls, value: object) -> "LinuxStableVolumeIdentity":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            os_family=_enum_from_wire(
                RuntimeOsFamily,
                data["osFamily"],
                field="osFamily",
            ),
            filesystem_type=data["filesystemType"],
            filesystem_uuid=data["filesystemUuid"],
            volume_identity_digest=data["volumeIdentityDigest"],
        )


StableVolumeIdentity = Union[
    DarwinStableVolumeIdentity,
    LinuxStableVolumeIdentity,
]


def stable_volume_identity_from_dict(value: object) -> StableVolumeIdentity:
    if not isinstance(value, Mapping):
        raise ValueError("StableVolumeIdentity must be an object")
    if value.get("osFamily") == RuntimeOsFamily.DARWIN.value:
        return DarwinStableVolumeIdentity.from_dict(value)
    if value.get("osFamily") == RuntimeOsFamily.LINUX.value:
        return LinuxStableVolumeIdentity.from_dict(value)
    raise ValueError("StableVolumeIdentity osFamily is not closed")


@dataclass(frozen=True)
class DurabilitySyncAnchorIdentity:
    __slots__ = (
        "device_id",
        "inode",
        "file_type",
        "content_sha256",
        "byte_length",
        "anchor_identity_digest",
    )
    device_id: str
    inode: str
    file_type: str
    content_sha256: str
    byte_length: int
    anchor_identity_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "deviceId",
            "inode",
            "fileType",
            "contentSha256",
            "byteLength",
            "anchorIdentityDigest",
        }
    )

    def __post_init__(self) -> None:
        _validate_uint_string(self.device_id, field="deviceId")
        _validate_uint_string(self.inode, field="inode")
        if self.file_type != "REGULAR_FILE":
            raise ValueError("fileType must be REGULAR_FILE")
        validate_sha256(self.content_sha256)
        _validate_non_negative_integer(self.byte_length, field="byteLength")
        validate_sha256(self.anchor_identity_digest)
        if self.anchor_identity_digest != self.expected_digest():
            raise ValueError("anchorIdentityDigest does not match sync anchor")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "deviceId": self.device_id,
            "inode": self.inode,
            "fileType": self.file_type,
            "contentSha256": self.content_sha256,
            "byteLength": self.byte_length,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(
            _DURABILITY_SYNC_ANCHOR_DOMAIN,
            self._digest_payload(),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            **self._digest_payload(),
            "anchorIdentityDigest": self.anchor_identity_digest,
        }

    @classmethod
    def create(
        cls,
        *,
        device_id: str,
        inode: str,
        content_sha256: str,
        byte_length: int,
    ) -> "DurabilitySyncAnchorIdentity":
        payload = {
            "deviceId": device_id,
            "inode": inode,
            "fileType": "REGULAR_FILE",
            "contentSha256": content_sha256,
            "byteLength": byte_length,
        }
        return cls(
            device_id=device_id,
            inode=inode,
            file_type="REGULAR_FILE",
            content_sha256=content_sha256,
            byte_length=byte_length,
            anchor_identity_digest=domain_separated_sha256(
                _DURABILITY_SYNC_ANCHOR_DOMAIN,
                payload,
            ),
        )

    @classmethod
    def from_dict(cls, value: object) -> "DurabilitySyncAnchorIdentity":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            device_id=data["deviceId"],
            inode=data["inode"],
            file_type=data["fileType"],
            content_sha256=data["contentSha256"],
            byte_length=data["byteLength"],
            anchor_identity_digest=data["anchorIdentityDigest"],
        )


@dataclass(frozen=True)
class DurabilityQualifiedEnvironment:
    __slots__ = (
        "host_build",
        "host_identity",
        "filesystem_implementation_version",
        "required_mount_options",
        "stable_volume_identity",
        "probe_runtime_digest",
        "qualified_environment_digest",
    )
    host_build: RuntimeHostBuild
    host_identity: RuntimeHostIdentity
    filesystem_implementation_version: str
    required_mount_options: tuple[str, ...]
    stable_volume_identity: StableVolumeIdentity
    probe_runtime_digest: str
    qualified_environment_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "hostBuild",
            "hostIdentity",
            "filesystemImplementationVersion",
            "requiredMountOptions",
            "stableVolumeIdentity",
            "probeRuntimeDigest",
            "qualifiedEnvironmentDigest",
        }
    )

    def __post_init__(self) -> None:
        if not isinstance(
            self.host_build,
            (DarwinRuntimeHostBuild, LinuxRuntimeHostBuild),
        ):
            raise ValueError("hostBuild must be a closed RuntimeHostBuild")
        if not isinstance(
            self.host_identity,
            (DarwinRuntimeHostIdentity, LinuxRuntimeHostIdentity),
        ):
            raise ValueError("hostIdentity must be a closed RuntimeHostIdentity")
        if self.host_identity.host_build != self.host_build:
            raise ValueError("hostIdentity.hostBuild must equal hostBuild")
        if (
            self.host_build.os_family is RuntimeOsFamily.DARWIN
            and not isinstance(self.stable_volume_identity, DarwinStableVolumeIdentity)
        ) or (
            self.host_build.os_family is RuntimeOsFamily.LINUX
            and not isinstance(self.stable_volume_identity, LinuxStableVolumeIdentity)
        ):
            raise ValueError("stable volume OS must equal host OS")
        _validate_non_empty_utf8(
            self.filesystem_implementation_version,
            field="filesystemImplementationVersion",
        )
        _validate_lexical_tuple(
            self.required_mount_options,
            field="requiredMountOptions",
            item_validator=lambda item: _validate_non_empty_utf8(
                item,
                field="requiredMountOption",
                maximum_bytes=256,
            ),
            allow_empty=True,
        )
        validate_sha256(self.probe_runtime_digest)
        validate_sha256(self.qualified_environment_digest)
        if self.qualified_environment_digest != self.expected_digest():
            raise ValueError(
                "qualifiedEnvironmentDigest does not match environment"
            )

    def _digest_payload(self) -> dict[str, object]:
        return {
            "hostBuild": self.host_build.to_dict(),
            "hostIdentity": self.host_identity.to_dict(),
            "filesystemImplementationVersion": (
                self.filesystem_implementation_version
            ),
            "requiredMountOptions": list(self.required_mount_options),
            "stableVolumeIdentity": self.stable_volume_identity.to_dict(),
            "probeRuntimeDigest": self.probe_runtime_digest,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(
            _DURABILITY_QUALIFIED_ENVIRONMENT_DOMAIN,
            self._digest_payload(),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            **self._digest_payload(),
            "qualifiedEnvironmentDigest": self.qualified_environment_digest,
        }

    @classmethod
    def create(
        cls,
        *,
        host_build: RuntimeHostBuild,
        host_identity: RuntimeHostIdentity,
        filesystem_implementation_version: str,
        required_mount_options: tuple[str, ...],
        stable_volume_identity: StableVolumeIdentity,
        probe_runtime_digest: str,
    ) -> "DurabilityQualifiedEnvironment":
        payload = {
            "hostBuild": host_build.to_dict(),
            "hostIdentity": host_identity.to_dict(),
            "filesystemImplementationVersion": filesystem_implementation_version,
            "requiredMountOptions": list(required_mount_options),
            "stableVolumeIdentity": stable_volume_identity.to_dict(),
            "probeRuntimeDigest": probe_runtime_digest,
        }
        return cls(
            host_build=host_build,
            host_identity=host_identity,
            filesystem_implementation_version=filesystem_implementation_version,
            required_mount_options=required_mount_options,
            stable_volume_identity=stable_volume_identity,
            probe_runtime_digest=probe_runtime_digest,
            qualified_environment_digest=domain_separated_sha256(
                _DURABILITY_QUALIFIED_ENVIRONMENT_DOMAIN,
                payload,
            ),
        )

    @classmethod
    def from_dict(cls, value: object) -> "DurabilityQualifiedEnvironment":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        required_mount_options = data["requiredMountOptions"]
        if not isinstance(required_mount_options, list):
            raise ValueError("requiredMountOptions must be an array")
        return cls(
            host_build=runtime_host_build_from_dict(data["hostBuild"]),
            host_identity=runtime_host_identity_from_dict(data["hostIdentity"]),
            filesystem_implementation_version=data[
                "filesystemImplementationVersion"
            ],
            required_mount_options=tuple(required_mount_options),
            stable_volume_identity=stable_volume_identity_from_dict(
                data["stableVolumeIdentity"]
            ),
            probe_runtime_digest=data["probeRuntimeDigest"],
            qualified_environment_digest=data["qualifiedEnvironmentDigest"],
        )


@dataclass(frozen=True)
class LiveAuthorityMountBinding:
    __slots__ = (
        "os_family", "stable_volume_identity_digest", "mount_namespace_id",
        "mount_id", "darwin_fsid", "device_id", "host_build",
        "filesystem_implementation_version", "mount_options", "observed_at",
        "mount_binding_digest",
    )
    os_family: RuntimeOsFamily
    stable_volume_identity_digest: str
    mount_namespace_id: str | None
    mount_id: str | None
    darwin_fsid: str | None
    device_id: str
    host_build: RuntimeHostBuild
    filesystem_implementation_version: str
    mount_options: tuple[str, ...]
    observed_at: str
    mount_binding_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "osFamily", "stableVolumeIdentityDigest", "mountNamespaceId",
            "mountId", "darwinFsid", "deviceId", "hostBuild",
            "filesystemImplementationVersion", "mountOptions", "observedAt",
            "mountBindingDigest",
        }
    )

    def __post_init__(self) -> None:
        validate_sha256(self.stable_volume_identity_digest)
        _validate_uint_string(self.device_id, field="deviceId")
        if self.os_family is RuntimeOsFamily.DARWIN:
            if (
                not isinstance(self.host_build, DarwinRuntimeHostBuild)
                or self.mount_namespace_id is not None
                or self.mount_id is not None
                or self.darwin_fsid is None
            ):
                raise ValueError("Darwin mount binding branch is invalid")
            _validate_non_empty_utf8(self.darwin_fsid, field="darwinFsid")
        elif self.os_family is RuntimeOsFamily.LINUX:
            if (
                not isinstance(self.host_build, LinuxRuntimeHostBuild)
                or self.darwin_fsid is not None
                or self.mount_namespace_id is None
                or self.mount_id is None
            ):
                raise ValueError("Linux mount binding branch is invalid")
            _validate_non_empty_utf8(self.mount_namespace_id, field="mountNamespaceId")
            _validate_uint_string(self.mount_id, field="mountId")
        else:
            raise ValueError("osFamily must be DARWIN or LINUX")
        _validate_non_empty_utf8(
            self.filesystem_implementation_version,
            field="filesystemImplementationVersion",
        )
        _validate_lexical_tuple(
            self.mount_options,
            field="mountOptions",
            item_validator=lambda item: _validate_non_empty_utf8(
                item, field="mountOption", maximum_bytes=256
            ),
            allow_empty=True,
        )
        _canonical_utc_instant(self.observed_at, field="observedAt")
        validate_sha256(self.mount_binding_digest)
        if self.mount_binding_digest != self.expected_digest():
            raise ValueError("mountBindingDigest does not match binding")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "osFamily": self.os_family.value,
            "stableVolumeIdentityDigest": self.stable_volume_identity_digest,
            "mountNamespaceId": self.mount_namespace_id,
            "mountId": self.mount_id,
            "darwinFsid": self.darwin_fsid,
            "deviceId": self.device_id,
            "hostBuild": self.host_build.to_dict(),
            "filesystemImplementationVersion": self.filesystem_implementation_version,
            "mountOptions": list(self.mount_options),
            "observedAt": self.observed_at,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_MOUNT_BINDING_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "mountBindingDigest": self.mount_binding_digest}

    @classmethod
    def create(cls, **values: object) -> "LiveAuthorityMountBinding":
        wire = {
            "osFamily": values["os_family"].value,
            "stableVolumeIdentityDigest": values["stable_volume_identity_digest"],
            "mountNamespaceId": values["mount_namespace_id"],
            "mountId": values["mount_id"],
            "darwinFsid": values["darwin_fsid"],
            "deviceId": values["device_id"],
            "hostBuild": values["host_build"].to_dict(),
            "filesystemImplementationVersion": values["filesystem_implementation_version"],
            "mountOptions": list(values["mount_options"]),
            "observedAt": values["observed_at"],
        }
        return cls(**values, mount_binding_digest=domain_separated_sha256(_MOUNT_BINDING_DOMAIN, wire))

    @classmethod
    def from_dict(cls, value: object) -> "LiveAuthorityMountBinding":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        if not isinstance(data["mountOptions"], list):
            raise ValueError("mountOptions must be an array")
        return cls(
            os_family=_enum_from_wire(RuntimeOsFamily, data["osFamily"], field="osFamily"),
            stable_volume_identity_digest=data["stableVolumeIdentityDigest"],
            mount_namespace_id=data["mountNamespaceId"],
            mount_id=data["mountId"],
            darwin_fsid=data["darwinFsid"],
            device_id=data["deviceId"],
            host_build=runtime_host_build_from_dict(data["hostBuild"]),
            filesystem_implementation_version=data["filesystemImplementationVersion"],
            mount_options=tuple(data["mountOptions"]),
            observed_at=data["observedAt"],
            mount_binding_digest=data["mountBindingDigest"],
        )


def _validate_durability_environment_observation(
    *,
    observation_mode: DurabilityObservationMode,
    expected_mode: DurabilityObservationMode,
    qualified_environment_digest: object,
    host_build: object,
    host_identity: object,
    filesystem_implementation_version: object,
    mount_options: object,
    stable_volume_identity: object,
    live_mount_binding: object,
    boot_observation_ref: object,
    expected_artifact_name: DurabilityCapabilityArtifactName,
    observed_at: object,
    environment_observation_digest: object,
    expected_digest: str,
) -> None:
    if observation_mode is not expected_mode:
        raise ValueError("observationMode does not match observation branch")
    validate_sha256(qualified_environment_digest)
    if not isinstance(
        host_build,
        (DarwinRuntimeHostBuild, LinuxRuntimeHostBuild),
    ):
        raise ValueError("hostBuild must be a closed RuntimeHostBuild")
    if not isinstance(
        host_identity,
        (DarwinRuntimeHostIdentity, LinuxRuntimeHostIdentity),
    ):
        raise ValueError("hostIdentity must be a closed RuntimeHostIdentity")
    if host_identity.host_build != host_build:
        raise ValueError("hostIdentity.hostBuild must equal hostBuild")
    if (
        host_build.os_family is RuntimeOsFamily.DARWIN
        and not isinstance(stable_volume_identity, DarwinStableVolumeIdentity)
    ) or (
        host_build.os_family is RuntimeOsFamily.LINUX
        and not isinstance(stable_volume_identity, LinuxStableVolumeIdentity)
    ):
        raise ValueError("stable volume OS must equal observed host OS")
    _validate_non_empty_utf8(
        filesystem_implementation_version,
        field="filesystemImplementationVersion",
    )
    _validate_lexical_tuple(
        mount_options,
        field="mountOptions",
        item_validator=lambda item: _validate_non_empty_utf8(
            item,
            field="mountOption",
            maximum_bytes=256,
        ),
        allow_empty=True,
    )
    if not isinstance(live_mount_binding, LiveAuthorityMountBinding):
        raise ValueError("liveMountBinding must be typed")
    if (
        live_mount_binding.os_family is not host_build.os_family
        or live_mount_binding.host_build != host_build
        or live_mount_binding.stable_volume_identity_digest
        != stable_volume_identity.volume_identity_digest
        or live_mount_binding.filesystem_implementation_version
        != filesystem_implementation_version
        or live_mount_binding.mount_options != mount_options
    ):
        raise ValueError("live mount identity does not equal observed environment")
    if not isinstance(boot_observation_ref, DurabilityCapabilityArtifactRef):
        raise ValueError("bootObservationRef must be typed")
    if boot_observation_ref.artifact_name is not expected_artifact_name:
        raise ValueError("bootObservationRef artifactName does not match branch")
    _canonical_utc_instant(observed_at, field="observedAt")
    validate_sha256(environment_observation_digest)
    if environment_observation_digest != expected_digest:
        raise ValueError(
            "environmentObservationDigest does not match observation"
        )


@dataclass(frozen=True)
class QualificationDurabilityEnvironmentObservation:
    __slots__ = (
        "observation_mode",
        "qualified_environment_digest",
        "host_build",
        "host_identity",
        "filesystem_implementation_version",
        "mount_options",
        "stable_volume_identity",
        "live_mount_binding",
        "boot_observation_ref",
        "observed_at",
        "environment_observation_digest",
    )
    observation_mode: DurabilityObservationMode
    qualified_environment_digest: str
    host_build: RuntimeHostBuild
    host_identity: RuntimeHostIdentity
    filesystem_implementation_version: str
    mount_options: tuple[str, ...]
    stable_volume_identity: StableVolumeIdentity
    live_mount_binding: LiveAuthorityMountBinding
    boot_observation_ref: DurabilityCapabilityArtifactRef
    observed_at: str
    environment_observation_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "observationMode",
            "qualifiedEnvironmentDigest",
            "hostBuild",
            "hostIdentity",
            "filesystemImplementationVersion",
            "mountOptions",
            "stableVolumeIdentity",
            "liveMountBinding",
            "bootObservationRef",
            "observedAt",
            "environmentObservationDigest",
        }
    )

    def __post_init__(self) -> None:
        _validate_durability_environment_observation(
            observation_mode=self.observation_mode,
            expected_mode=DurabilityObservationMode.QUALIFICATION_BOOTSTRAP,
            qualified_environment_digest=self.qualified_environment_digest,
            host_build=self.host_build,
            host_identity=self.host_identity,
            filesystem_implementation_version=self.filesystem_implementation_version,
            mount_options=self.mount_options,
            stable_volume_identity=self.stable_volume_identity,
            live_mount_binding=self.live_mount_binding,
            boot_observation_ref=self.boot_observation_ref,
            expected_artifact_name=(
                DurabilityCapabilityArtifactName.QUALIFICATION_BOOT_OBSERVATION
            ),
            observed_at=self.observed_at,
            environment_observation_digest=self.environment_observation_digest,
            expected_digest=self.expected_digest(),
        )

    def _digest_payload(self) -> dict[str, object]:
        return _durability_environment_observation_payload(self)

    def expected_digest(self) -> str:
        return domain_separated_sha256(
            _DURABILITY_ENVIRONMENT_OBSERVATION_DOMAIN,
            self._digest_payload(),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            **self._digest_payload(),
            "environmentObservationDigest": self.environment_observation_digest,
        }

    @classmethod
    def create(cls, **values: object) -> "QualificationDurabilityEnvironmentObservation":
        values = {
            "observation_mode": DurabilityObservationMode.QUALIFICATION_BOOTSTRAP,
            **values,
        }
        payload = _durability_environment_observation_payload_from_values(values)
        return cls(
            **values,
            environment_observation_digest=domain_separated_sha256(
                _DURABILITY_ENVIRONMENT_OBSERVATION_DOMAIN,
                payload,
            ),
        )

    @classmethod
    def from_dict(
        cls,
        value: object,
    ) -> "QualificationDurabilityEnvironmentObservation":
        return cls(**_durability_environment_observation_from_dict(cls, value))


@dataclass(frozen=True)
class ActiveDurabilityEnvironmentObservation:
    __slots__ = QualificationDurabilityEnvironmentObservation.__slots__
    observation_mode: DurabilityObservationMode
    qualified_environment_digest: str
    host_build: RuntimeHostBuild
    host_identity: RuntimeHostIdentity
    filesystem_implementation_version: str
    mount_options: tuple[str, ...]
    stable_volume_identity: StableVolumeIdentity
    live_mount_binding: LiveAuthorityMountBinding
    boot_observation_ref: DurabilityCapabilityArtifactRef
    observed_at: str
    environment_observation_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = (
        QualificationDurabilityEnvironmentObservation._WIRE_KEYS
    )

    def __post_init__(self) -> None:
        _validate_durability_environment_observation(
            observation_mode=self.observation_mode,
            expected_mode=DurabilityObservationMode.ACTIVE_PROFILE,
            qualified_environment_digest=self.qualified_environment_digest,
            host_build=self.host_build,
            host_identity=self.host_identity,
            filesystem_implementation_version=self.filesystem_implementation_version,
            mount_options=self.mount_options,
            stable_volume_identity=self.stable_volume_identity,
            live_mount_binding=self.live_mount_binding,
            boot_observation_ref=self.boot_observation_ref,
            expected_artifact_name=DurabilityCapabilityArtifactName.BOOT_OBSERVATION,
            observed_at=self.observed_at,
            environment_observation_digest=self.environment_observation_digest,
            expected_digest=self.expected_digest(),
        )

    def _digest_payload(self) -> dict[str, object]:
        return _durability_environment_observation_payload(self)

    def expected_digest(self) -> str:
        return domain_separated_sha256(
            _DURABILITY_ENVIRONMENT_OBSERVATION_DOMAIN,
            self._digest_payload(),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            **self._digest_payload(),
            "environmentObservationDigest": self.environment_observation_digest,
        }

    @classmethod
    def create(cls, **values: object) -> "ActiveDurabilityEnvironmentObservation":
        values = {
            "observation_mode": DurabilityObservationMode.ACTIVE_PROFILE,
            **values,
        }
        payload = _durability_environment_observation_payload_from_values(values)
        return cls(
            **values,
            environment_observation_digest=domain_separated_sha256(
                _DURABILITY_ENVIRONMENT_OBSERVATION_DOMAIN,
                payload,
            ),
        )

    @classmethod
    def from_dict(
        cls,
        value: object,
    ) -> "ActiveDurabilityEnvironmentObservation":
        return cls(**_durability_environment_observation_from_dict(cls, value))


DurabilityEnvironmentObservation = Union[
    QualificationDurabilityEnvironmentObservation,
    ActiveDurabilityEnvironmentObservation,
]


def _durability_environment_observation_payload(
    value: DurabilityEnvironmentObservation,
) -> dict[str, object]:
    return {
        "observationMode": value.observation_mode.value,
        "qualifiedEnvironmentDigest": value.qualified_environment_digest,
        "hostBuild": value.host_build.to_dict(),
        "hostIdentity": value.host_identity.to_dict(),
        "filesystemImplementationVersion": (
            value.filesystem_implementation_version
        ),
        "mountOptions": list(value.mount_options),
        "stableVolumeIdentity": value.stable_volume_identity.to_dict(),
        "liveMountBinding": value.live_mount_binding.to_dict(),
        "bootObservationRef": value.boot_observation_ref.to_dict(),
        "observedAt": value.observed_at,
    }


def _durability_environment_observation_payload_from_values(
    values: Mapping[str, object],
) -> dict[str, object]:
    return {
        "observationMode": values["observation_mode"].value,
        "qualifiedEnvironmentDigest": values["qualified_environment_digest"],
        "hostBuild": values["host_build"].to_dict(),
        "hostIdentity": values["host_identity"].to_dict(),
        "filesystemImplementationVersion": values[
            "filesystem_implementation_version"
        ],
        "mountOptions": list(values["mount_options"]),
        "stableVolumeIdentity": values["stable_volume_identity"].to_dict(),
        "liveMountBinding": values["live_mount_binding"].to_dict(),
        "bootObservationRef": values["boot_observation_ref"].to_dict(),
        "observedAt": values["observed_at"],
    }


def _durability_environment_observation_from_dict(
    contract_type: type[
        QualificationDurabilityEnvironmentObservation
        | ActiveDurabilityEnvironmentObservation
    ],
    value: object,
) -> dict[str, object]:
    data = _closed_mapping(
        value,
        schema=contract_type.__name__,
        keys=contract_type._WIRE_KEYS,
    )
    mount_options = data["mountOptions"]
    if not isinstance(mount_options, list):
        raise ValueError("mountOptions must be an array")
    return {
        "observation_mode": _enum_from_wire(
            DurabilityObservationMode,
            data["observationMode"],
            field="observationMode",
        ),
        "qualified_environment_digest": data["qualifiedEnvironmentDigest"],
        "host_build": runtime_host_build_from_dict(data["hostBuild"]),
        "host_identity": runtime_host_identity_from_dict(data["hostIdentity"]),
        "filesystem_implementation_version": data[
            "filesystemImplementationVersion"
        ],
        "mount_options": tuple(mount_options),
        "stable_volume_identity": stable_volume_identity_from_dict(
            data["stableVolumeIdentity"]
        ),
        "live_mount_binding": LiveAuthorityMountBinding.from_dict(
            data["liveMountBinding"]
        ),
        "boot_observation_ref": DurabilityCapabilityArtifactRef.from_dict(
            data["bootObservationRef"]
        ),
        "observed_at": data["observedAt"],
        "environment_observation_digest": data[
            "environmentObservationDigest"
        ],
    }


def durability_environment_observation_from_dict(
    value: object,
) -> DurabilityEnvironmentObservation:
    if not isinstance(value, Mapping):
        raise ValueError("DurabilityEnvironmentObservation must be an object")
    mode = value.get("observationMode")
    if mode == DurabilityObservationMode.QUALIFICATION_BOOTSTRAP.value:
        return QualificationDurabilityEnvironmentObservation.from_dict(value)
    if mode == DurabilityObservationMode.ACTIVE_PROFILE.value:
        return ActiveDurabilityEnvironmentObservation.from_dict(value)
    raise ValueError("DurabilityEnvironmentObservation mode is not closed")


def validate_durability_environment_observation(
    observation: DurabilityEnvironmentObservation,
    qualified_environment: DurabilityQualifiedEnvironment,
) -> DurabilityEnvironmentObservation:
    if not isinstance(
        observation,
        (
            QualificationDurabilityEnvironmentObservation,
            ActiveDurabilityEnvironmentObservation,
        ),
    ):
        raise ValueError("observation must be a closed durability environment")
    if not isinstance(qualified_environment, DurabilityQualifiedEnvironment):
        raise ValueError("qualifiedEnvironment must be typed")
    if (
        observation.qualified_environment_digest
        != qualified_environment.qualified_environment_digest
        or observation.host_build != qualified_environment.host_build
        or observation.host_identity != qualified_environment.host_identity
        or observation.filesystem_implementation_version
        != qualified_environment.filesystem_implementation_version
        or observation.mount_options
        != qualified_environment.required_mount_options
        or observation.stable_volume_identity
        != qualified_environment.stable_volume_identity
    ):
        raise ValueError(
            "environment observation does not equal qualified environment"
        )
    return observation


@dataclass(frozen=True)
class DurabilityCrashCase:
    __slots__ = (
        "case_id",
        "interruption_point",
        "expected_recovered_state",
        "trace_ref",
        "recovery_result_ref",
        "case_digest",
    )
    case_id: str
    interruption_point: DurabilityInterruptionPoint
    expected_recovered_state: DurabilityRecoveredState
    trace_ref: DurabilityCapabilityArtifactRef
    recovery_result_ref: DurabilityCapabilityArtifactRef
    case_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "caseId",
            "interruptionPoint",
            "expectedRecoveredState",
            "traceRef",
            "recoveryResultRef",
            "caseDigest",
        }
    )

    def __post_init__(self) -> None:
        _validate_slug(self.case_id, field="caseId")
        if not isinstance(self.interruption_point, DurabilityInterruptionPoint):
            raise ValueError("interruptionPoint must be closed")
        if self.expected_recovered_state not in {
            DurabilityRecoveredState.ABSENT,
            DurabilityRecoveredState.OLD_BYTES,
            DurabilityRecoveredState.NEW_BYTES,
        }:
            raise ValueError("expectedRecoveredState cannot be OTHER")
        if (
            not isinstance(self.trace_ref, DurabilityCapabilityArtifactRef)
            or self.trace_ref.artifact_name
            is not DurabilityCapabilityArtifactName.POWER_CUT_TRACE
        ):
            raise ValueError("traceRef must name POWER_CUT_TRACE")
        if (
            not isinstance(
                self.recovery_result_ref,
                DurabilityCapabilityArtifactRef,
            )
            or self.recovery_result_ref.artifact_name
            is not DurabilityCapabilityArtifactName.RECOVERY_RESULT
        ):
            raise ValueError("recoveryResultRef must name RECOVERY_RESULT")
        trace_identity = (
            self.trace_ref.workspace_id,
            self.trace_ref.gate_id,
            self.trace_ref.crash_fixture_id,
        )
        recovery_identity = (
            self.recovery_result_ref.workspace_id,
            self.recovery_result_ref.gate_id,
            self.recovery_result_ref.crash_fixture_id,
        )
        if trace_identity != recovery_identity:
            raise ValueError("crash case refs must share qualification identity")
        validate_sha256(self.case_digest)
        if self.case_digest != self.expected_digest():
            raise ValueError("caseDigest does not match crash case")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "caseId": self.case_id,
            "interruptionPoint": self.interruption_point.value,
            "expectedRecoveredState": self.expected_recovered_state.value,
            "traceRef": self.trace_ref.to_dict(),
            "recoveryResultRef": self.recovery_result_ref.to_dict(),
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(
            _DURABILITY_CRASH_CASE_DOMAIN,
            self._digest_payload(),
        )

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "caseDigest": self.case_digest}

    @classmethod
    def create(
        cls,
        *,
        case_id: str,
        interruption_point: DurabilityInterruptionPoint,
        expected_recovered_state: DurabilityRecoveredState,
        trace_ref: DurabilityCapabilityArtifactRef,
        recovery_result_ref: DurabilityCapabilityArtifactRef,
    ) -> "DurabilityCrashCase":
        payload = {
            "caseId": case_id,
            "interruptionPoint": interruption_point.value,
            "expectedRecoveredState": expected_recovered_state.value,
            "traceRef": trace_ref.to_dict(),
            "recoveryResultRef": recovery_result_ref.to_dict(),
        }
        return cls(
            case_id=case_id,
            interruption_point=interruption_point,
            expected_recovered_state=expected_recovered_state,
            trace_ref=trace_ref,
            recovery_result_ref=recovery_result_ref,
            case_digest=domain_separated_sha256(
                _DURABILITY_CRASH_CASE_DOMAIN,
                payload,
            ),
        )

    @classmethod
    def from_dict(cls, value: object) -> "DurabilityCrashCase":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            case_id=data["caseId"],
            interruption_point=_enum_from_wire(
                DurabilityInterruptionPoint,
                data["interruptionPoint"],
                field="interruptionPoint",
            ),
            expected_recovered_state=_enum_from_wire(
                DurabilityRecoveredState,
                data["expectedRecoveredState"],
                field="expectedRecoveredState",
            ),
            trace_ref=DurabilityCapabilityArtifactRef.from_dict(
                data["traceRef"]
            ),
            recovery_result_ref=DurabilityCapabilityArtifactRef.from_dict(
                data["recoveryResultRef"]
            ),
            case_digest=data["caseDigest"],
        )


@dataclass(frozen=True)
class DurabilityCrashFixtureManifest:
    __slots__ = (
        "artifact_kind",
        "schema_version",
        "workspace_id",
        "gate_id",
        "crash_fixture_id",
        "qualification_run_id",
        "backend",
        "stable_volume_identity",
        "qualified_environment",
        "controller_runtime_digest",
        "controller_runtime_lock_backend_digest",
        "expectation_ref",
        "expectation_digest",
        "probe_runtime_manifest_ref",
        "operation_sequence",
        "old_content_sha256",
        "new_content_sha256",
        "cases",
        "result",
        "crash_fixture_manifest_digest",
    )
    artifact_kind: str
    schema_version: int
    workspace_id: str
    gate_id: str
    crash_fixture_id: str
    qualification_run_id: str
    backend: DurabilityBackend
    stable_volume_identity: StableVolumeIdentity
    qualified_environment: DurabilityQualifiedEnvironment
    controller_runtime_digest: str
    controller_runtime_lock_backend_digest: str
    expectation_ref: DurabilityCapabilityArtifactRef
    expectation_digest: str
    probe_runtime_manifest_ref: DurabilityCapabilityArtifactRef
    operation_sequence: tuple[DurabilitySyncOperation, ...]
    old_content_sha256: str
    new_content_sha256: str
    cases: tuple[DurabilityCrashCase, ...]
    result: DurabilitySupportResult
    crash_fixture_manifest_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "artifactKind",
            "schemaVersion",
            "workspaceId",
            "gateId",
            "crashFixtureId",
            "qualificationRunId",
            "backend",
            "stableVolumeIdentity",
            "qualifiedEnvironment",
            "controllerRuntimeDigest",
            "controllerRuntimeLockBackendDigest",
            "expectationRef",
            "expectationDigest",
            "probeRuntimeManifestRef",
            "operationSequence",
            "oldContentSha256",
            "newContentSha256",
            "cases",
            "result",
            "crashFixtureManifestDigest",
        }
    )

    def __post_init__(self) -> None:
        if self.artifact_kind != "acceptance-durability-crash-fixture":
            raise ValueError("artifactKind is invalid")
        if self.schema_version != 1 or isinstance(self.schema_version, bool):
            raise ValueError("schemaVersion must be 1")
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gate ID")
        _validate_slug(self.crash_fixture_id, field="crashFixtureId")
        _validate_slug(self.qualification_run_id, field="qualificationRunId")
        if not isinstance(self.backend, DurabilityBackend):
            raise ValueError("backend must be closed")
        if not isinstance(
            self.stable_volume_identity,
            (DarwinStableVolumeIdentity, LinuxStableVolumeIdentity),
        ):
            raise ValueError("stableVolumeIdentity must be closed")
        if not isinstance(
            self.qualified_environment,
            DurabilityQualifiedEnvironment,
        ):
            raise ValueError("qualifiedEnvironment must be typed")
        if (
            self.qualified_environment.stable_volume_identity
            != self.stable_volume_identity
        ):
            raise ValueError(
                "qualified environment stable volume must equal manifest"
            )

        if self.backend is DurabilityBackend.LINUX_FILE_AND_DIRECTORY_FSYNC_V1:
            expected_volume_type = LinuxStableVolumeIdentity
            expected_operations = (
                DurabilitySyncOperation.WRITE_TEMP,
                DurabilitySyncOperation.SYNC_FILE,
                DurabilitySyncOperation.RENAME_FINAL,
                DurabilitySyncOperation.SYNC_DIRECTORY,
            )
            expected_points = (
                DurabilityInterruptionPoint.BEFORE_FILE_SYNC,
                DurabilityInterruptionPoint.AFTER_FILE_SYNC,
                DurabilityInterruptionPoint.AFTER_RENAME,
                DurabilityInterruptionPoint.AFTER_DIRECTORY_SYNC,
            )
        else:
            expected_volume_type = DarwinStableVolumeIdentity
            expected_operations = (
                DurabilitySyncOperation.WRITE_TEMP,
                DurabilitySyncOperation.SYNC_FILE,
                DurabilitySyncOperation.RENAME_FINAL,
                DurabilitySyncOperation.SYNC_DIRECTORY,
                DurabilitySyncOperation.SYNC_ANCHOR,
            )
            expected_points = (
                DurabilityInterruptionPoint.BEFORE_FILE_SYNC,
                DurabilityInterruptionPoint.AFTER_FILE_SYNC,
                DurabilityInterruptionPoint.AFTER_RENAME,
                DurabilityInterruptionPoint.AFTER_DIRECTORY_SYNC,
                DurabilityInterruptionPoint.AFTER_ANCHOR_SYNC,
            )
        if not isinstance(self.stable_volume_identity, expected_volume_type):
            raise ValueError("backend and stable volume OS do not match")
        if self.operation_sequence != expected_operations:
            raise ValueError("operationSequence does not match backend")

        validate_sha256(self.controller_runtime_digest)
        validate_sha256(self.controller_runtime_lock_backend_digest)
        validate_sha256(self.expectation_digest)
        validate_sha256(self.old_content_sha256)
        validate_sha256(self.new_content_sha256)
        if self.old_content_sha256 == self.new_content_sha256:
            raise ValueError("oldContentSha256 and newContentSha256 must differ")
        self._validate_ref(
            self.expectation_ref,
            artifact_name=DurabilityCapabilityArtifactName.EXPECTATION,
            object_digest=self.expectation_digest,
            field="expectationRef",
        )
        self._validate_ref(
            self.probe_runtime_manifest_ref,
            artifact_name=DurabilityCapabilityArtifactName.PROBE_RUNTIME_MANIFEST,
            object_digest=self.qualified_environment.probe_runtime_digest,
            field="probeRuntimeManifestRef",
        )
        if (
            not isinstance(self.cases, tuple)
            or not self.cases
            or any(not isinstance(case, DurabilityCrashCase) for case in self.cases)
        ):
            raise ValueError("cases must be a non-empty typed tuple")
        if tuple(case.interruption_point for case in self.cases) != expected_points:
            raise ValueError(
                "cases must cover the backend interruption matrix in order"
            )
        if len({case.case_id for case in self.cases}) != len(self.cases):
            raise ValueError("caseId values must be unique")
        case_ref_digests: list[str] = []
        for case in self.cases:
            self._validate_ref(
                case.trace_ref,
                artifact_name=DurabilityCapabilityArtifactName.POWER_CUT_TRACE,
                object_digest=case.trace_ref.object_digest,
                field="case.traceRef",
            )
            self._validate_ref(
                case.recovery_result_ref,
                artifact_name=DurabilityCapabilityArtifactName.RECOVERY_RESULT,
                object_digest=case.recovery_result_ref.object_digest,
                field="case.recoveryResultRef",
            )
            case_ref_digests.extend(
                (
                    case.trace_ref.durability_capability_ref_digest,
                    case.recovery_result_ref.durability_capability_ref_digest,
                )
            )
        if len(set(case_ref_digests)) != len(case_ref_digests):
            raise ValueError("case artifact refs must be unique")
        if self.result is not DurabilitySupportResult.SUPPORTED:
            raise ValueError("result must be SUPPORTED")
        validate_sha256(self.crash_fixture_manifest_digest)
        if self.crash_fixture_manifest_digest != self.expected_digest():
            raise ValueError(
                "crashFixtureManifestDigest does not match manifest"
            )

    def _validate_ref(
        self,
        reference: DurabilityCapabilityArtifactRef,
        *,
        artifact_name: DurabilityCapabilityArtifactName,
        object_digest: str | None,
        field: str,
    ) -> None:
        if not isinstance(reference, DurabilityCapabilityArtifactRef):
            raise ValueError(f"{field} must be typed")
        if reference.artifact_name is not artifact_name:
            raise ValueError(f"{field} artifactName does not match")
        if (
            reference.workspace_id != self.workspace_id
            or reference.gate_id != self.gate_id
            or reference.crash_fixture_id != self.crash_fixture_id
        ):
            raise ValueError(f"{field} identity does not match manifest")
        if reference.object_digest != object_digest:
            raise ValueError(f"{field} objectDigest does not match")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind,
            "schemaVersion": self.schema_version,
            "workspaceId": self.workspace_id,
            "gateId": self.gate_id,
            "crashFixtureId": self.crash_fixture_id,
            "qualificationRunId": self.qualification_run_id,
            "backend": self.backend.value,
            "stableVolumeIdentity": self.stable_volume_identity.to_dict(),
            "qualifiedEnvironment": self.qualified_environment.to_dict(),
            "controllerRuntimeDigest": self.controller_runtime_digest,
            "controllerRuntimeLockBackendDigest": (
                self.controller_runtime_lock_backend_digest
            ),
            "expectationRef": self.expectation_ref.to_dict(),
            "expectationDigest": self.expectation_digest,
            "probeRuntimeManifestRef": self.probe_runtime_manifest_ref.to_dict(),
            "operationSequence": [
                operation.value for operation in self.operation_sequence
            ],
            "oldContentSha256": self.old_content_sha256,
            "newContentSha256": self.new_content_sha256,
            "cases": [case.to_dict() for case in self.cases],
            "result": self.result.value,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(
            _DURABILITY_CRASH_FIXTURE_MANIFEST_DOMAIN,
            self._digest_payload(),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            **self._digest_payload(),
            "crashFixtureManifestDigest": self.crash_fixture_manifest_digest,
        }

    @classmethod
    def create(cls, **values: object) -> "DurabilityCrashFixtureManifest":
        values = {
            "artifact_kind": "acceptance-durability-crash-fixture",
            "schema_version": 1,
            "result": DurabilitySupportResult.SUPPORTED,
            **values,
        }
        payload = {
            "artifactKind": values["artifact_kind"],
            "schemaVersion": values["schema_version"],
            "workspaceId": values["workspace_id"],
            "gateId": values["gate_id"],
            "crashFixtureId": values["crash_fixture_id"],
            "qualificationRunId": values["qualification_run_id"],
            "backend": values["backend"].value,
            "stableVolumeIdentity": values["stable_volume_identity"].to_dict(),
            "qualifiedEnvironment": values["qualified_environment"].to_dict(),
            "controllerRuntimeDigest": values["controller_runtime_digest"],
            "controllerRuntimeLockBackendDigest": values[
                "controller_runtime_lock_backend_digest"
            ],
            "expectationRef": values["expectation_ref"].to_dict(),
            "expectationDigest": values["expectation_digest"],
            "probeRuntimeManifestRef": values[
                "probe_runtime_manifest_ref"
            ].to_dict(),
            "operationSequence": [
                operation.value for operation in values["operation_sequence"]
            ],
            "oldContentSha256": values["old_content_sha256"],
            "newContentSha256": values["new_content_sha256"],
            "cases": [case.to_dict() for case in values["cases"]],
            "result": values["result"].value,
        }
        return cls(
            **values,
            crash_fixture_manifest_digest=domain_separated_sha256(
                _DURABILITY_CRASH_FIXTURE_MANIFEST_DOMAIN,
                payload,
            ),
        )

    @classmethod
    def from_dict(cls, value: object) -> "DurabilityCrashFixtureManifest":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        operation_sequence = data["operationSequence"]
        cases = data["cases"]
        if not isinstance(operation_sequence, list):
            raise ValueError("operationSequence must be an array")
        if not isinstance(cases, list):
            raise ValueError("cases must be an array")
        return cls(
            artifact_kind=data["artifactKind"],
            schema_version=data["schemaVersion"],
            workspace_id=data["workspaceId"],
            gate_id=data["gateId"],
            crash_fixture_id=data["crashFixtureId"],
            qualification_run_id=data["qualificationRunId"],
            backend=_enum_from_wire(
                DurabilityBackend,
                data["backend"],
                field="backend",
            ),
            stable_volume_identity=stable_volume_identity_from_dict(
                data["stableVolumeIdentity"]
            ),
            qualified_environment=DurabilityQualifiedEnvironment.from_dict(
                data["qualifiedEnvironment"]
            ),
            controller_runtime_digest=data["controllerRuntimeDigest"],
            controller_runtime_lock_backend_digest=data[
                "controllerRuntimeLockBackendDigest"
            ],
            expectation_ref=DurabilityCapabilityArtifactRef.from_dict(
                data["expectationRef"]
            ),
            expectation_digest=data["expectationDigest"],
            probe_runtime_manifest_ref=DurabilityCapabilityArtifactRef.from_dict(
                data["probeRuntimeManifestRef"]
            ),
            operation_sequence=tuple(
                _enum_from_wire(
                    DurabilitySyncOperation,
                    operation,
                    field="operationSequence",
                )
                for operation in operation_sequence
            ),
            old_content_sha256=data["oldContentSha256"],
            new_content_sha256=data["newContentSha256"],
            cases=tuple(DurabilityCrashCase.from_dict(case) for case in cases),
            result=_enum_from_wire(
                DurabilitySupportResult,
                data["result"],
                field="result",
            ),
            crash_fixture_manifest_digest=data["crashFixtureManifestDigest"],
        )


@dataclass(frozen=True)
class DurabilityExecutionStartRecord:
    artifact_kind: str
    schema_version: int
    workspace_id: str
    gate_id: str
    crash_fixture_id: str
    qualification_run_id: str
    case_id: str
    interruption_point: DurabilityInterruptionPoint
    qualified_environment_digest: str
    expectation_ref: DurabilityCapabilityArtifactRef
    expectation_digest: str
    durable_sequence: int
    previous_execution_digest: str | None
    started_at: str
    execution_start_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "artifactKind",
            "schemaVersion",
            "workspaceId",
            "gateId",
            "crashFixtureId",
            "qualificationRunId",
            "caseId",
            "interruptionPoint",
            "qualifiedEnvironmentDigest",
            "expectationRef",
            "expectationDigest",
            "durableSequence",
            "previousExecutionDigest",
            "startedAt",
            "executionStartDigest",
        }
    )

    def __post_init__(self) -> None:
        if self.artifact_kind != "acceptance-durability-execution-start":
            raise ValueError("artifactKind is invalid")
        if self.schema_version != 1 or isinstance(self.schema_version, bool):
            raise ValueError("schemaVersion must be 1")
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gate ID")
        _validate_slug(self.crash_fixture_id, field="crashFixtureId")
        _validate_slug(self.qualification_run_id, field="qualificationRunId")
        _validate_slug(self.case_id, field="caseId")
        if not isinstance(self.interruption_point, DurabilityInterruptionPoint):
            raise ValueError("interruptionPoint must be closed")
        validate_sha256(self.qualified_environment_digest)
        if (
            not isinstance(self.expectation_ref, DurabilityCapabilityArtifactRef)
            or self.expectation_ref.artifact_name
            is not DurabilityCapabilityArtifactName.EXPECTATION
        ):
            raise ValueError("expectationRef must name EXPECTATION")
        if (
            self.expectation_ref.workspace_id != self.workspace_id
            or self.expectation_ref.gate_id != self.gate_id
            or self.expectation_ref.crash_fixture_id != self.crash_fixture_id
        ):
            raise ValueError("expectationRef identity does not match start record")
        validate_sha256(self.expectation_digest)
        if self.expectation_ref.object_digest != self.expectation_digest:
            raise ValueError("expectationRef objectDigest does not match expectation")
        _validate_positive_integer(self.durable_sequence, field="durableSequence")
        if self.durable_sequence == 1:
            if self.previous_execution_digest is not None:
                raise ValueError("sequence 1 requires null previousExecutionDigest")
        else:
            validate_sha256(self.previous_execution_digest)
        _canonical_utc_instant(self.started_at, field="startedAt")
        validate_sha256(self.execution_start_digest)
        if self.execution_start_digest != self.expected_digest():
            raise ValueError("executionStartDigest does not match start record")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind,
            "schemaVersion": self.schema_version,
            "workspaceId": self.workspace_id,
            "gateId": self.gate_id,
            "crashFixtureId": self.crash_fixture_id,
            "qualificationRunId": self.qualification_run_id,
            "caseId": self.case_id,
            "interruptionPoint": self.interruption_point.value,
            "qualifiedEnvironmentDigest": self.qualified_environment_digest,
            "expectationRef": self.expectation_ref.to_dict(),
            "expectationDigest": self.expectation_digest,
            "durableSequence": self.durable_sequence,
            "previousExecutionDigest": self.previous_execution_digest,
            "startedAt": self.started_at,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(
            _DURABILITY_EXECUTION_START_DOMAIN,
            self._digest_payload(),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            **self._digest_payload(),
            "executionStartDigest": self.execution_start_digest,
        }

    @classmethod
    def create(
        cls,
        *,
        workspace_id: str,
        gate_id: str,
        crash_fixture_id: str,
        qualification_run_id: str,
        case_id: str,
        interruption_point: DurabilityInterruptionPoint,
        qualified_environment_digest: str,
        expectation_ref: DurabilityCapabilityArtifactRef,
        expectation_digest: str,
        durable_sequence: int,
        previous_execution_digest: str | None,
        started_at: str,
    ) -> "DurabilityExecutionStartRecord":
        values = {
            "artifact_kind": "acceptance-durability-execution-start",
            "schema_version": 1,
            "workspace_id": workspace_id,
            "gate_id": gate_id,
            "crash_fixture_id": crash_fixture_id,
            "qualification_run_id": qualification_run_id,
            "case_id": case_id,
            "interruption_point": interruption_point,
            "qualified_environment_digest": qualified_environment_digest,
            "expectation_ref": expectation_ref,
            "expectation_digest": expectation_digest,
            "durable_sequence": durable_sequence,
            "previous_execution_digest": previous_execution_digest,
            "started_at": started_at,
        }
        payload = {
            "artifactKind": values["artifact_kind"],
            "schemaVersion": values["schema_version"],
            "workspaceId": workspace_id,
            "gateId": gate_id,
            "crashFixtureId": crash_fixture_id,
            "qualificationRunId": qualification_run_id,
            "caseId": case_id,
            "interruptionPoint": interruption_point.value,
            "qualifiedEnvironmentDigest": qualified_environment_digest,
            "expectationRef": expectation_ref.to_dict(),
            "expectationDigest": expectation_digest,
            "durableSequence": durable_sequence,
            "previousExecutionDigest": previous_execution_digest,
            "startedAt": started_at,
        }
        return cls(
            **values,
            execution_start_digest=domain_separated_sha256(
                _DURABILITY_EXECUTION_START_DOMAIN,
                payload,
            ),
        )

    @classmethod
    def from_dict(cls, value: object) -> "DurabilityExecutionStartRecord":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            artifact_kind=data["artifactKind"],
            schema_version=data["schemaVersion"],
            workspace_id=data["workspaceId"],
            gate_id=data["gateId"],
            crash_fixture_id=data["crashFixtureId"],
            qualification_run_id=data["qualificationRunId"],
            case_id=data["caseId"],
            interruption_point=_enum_from_wire(
                DurabilityInterruptionPoint,
                data["interruptionPoint"],
                field="interruptionPoint",
            ),
            qualified_environment_digest=data["qualifiedEnvironmentDigest"],
            expectation_ref=DurabilityCapabilityArtifactRef.from_dict(
                data["expectationRef"]
            ),
            expectation_digest=data["expectationDigest"],
            durable_sequence=data["durableSequence"],
            previous_execution_digest=data["previousExecutionDigest"],
            started_at=data["startedAt"],
            execution_start_digest=data["executionStartDigest"],
        )


def _durability_boot_wire_keys(
    authority_key: str,
    boot_identity_key: str,
    boot_fraction_key: str,
    digest_key: str,
) -> frozenset[str]:
    return frozenset(
        {
            "artifactKind",
            "schemaVersion",
            "workspaceId",
            "gateId",
            "crashFixtureId",
            "qualificationRunId",
            authority_key,
            "sourceCommit",
            "hostIdentity",
            "helperSourceDigest",
            "helperRuntimeDigest",
            boot_identity_key,
            "bootTimeSeconds",
            boot_fraction_key,
            "observedAt",
            digest_key,
        }
    )


class _DurabilityBootObservationMixin:
    _ARTIFACT_KIND: ClassVar[str]
    _OS_FAMILY: ClassVar[RuntimeOsFamily]
    _HOST_IDENTITY_TYPE: ClassVar[type]
    _AUTHORITY_KEY: ClassVar[str]
    _AUTHORITY_ATTR: ClassVar[str]
    _BOOT_IDENTITY_KEY: ClassVar[str]
    _BOOT_IDENTITY_ATTR: ClassVar[str]
    _BOOT_FRACTION_KEY: ClassVar[str]
    _BOOT_FRACTION_ATTR: ClassVar[str]
    _DIGEST_KEY: ClassVar[str]
    _DIGEST_ATTR: ClassVar[str]
    _DIGEST_DOMAIN: ClassVar[str]
    _WIRE_KEYS: ClassVar[frozenset[str]]

    def __post_init__(self) -> None:
        if self.artifact_kind != self._ARTIFACT_KIND:
            raise ValueError("artifactKind does not match boot observation branch")
        if self.schema_version != 1 or isinstance(self.schema_version, bool):
            raise ValueError("schemaVersion must be 1")
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gate ID")
        _validate_slug(self.crash_fixture_id, field="crashFixtureId")
        _validate_slug(self.qualification_run_id, field="qualificationRunId")
        validate_sha256(getattr(self, self._AUTHORITY_ATTR))
        _validate_non_empty_utf8(self.source_commit, field="sourceCommit")
        if not isinstance(self.host_identity, self._HOST_IDENTITY_TYPE):
            raise ValueError("hostIdentity does not match boot observation OS")
        _validate_host_pair(
            self._OS_FAMILY,
            self.host_identity.host_build,
            self.host_identity,
        )
        validate_sha256(self.helper_source_digest)
        validate_sha256(self.helper_runtime_digest)
        _validate_non_empty_utf8(
            getattr(self, self._BOOT_IDENTITY_ATTR),
            field=self._BOOT_IDENTITY_KEY,
        )
        _validate_uint_string(self.boot_time_seconds, field="bootTimeSeconds")
        _validate_uint_string(
            getattr(self, self._BOOT_FRACTION_ATTR),
            field=self._BOOT_FRACTION_KEY,
        )
        _canonical_utc_instant(self.observed_at, field="observedAt")
        digest = getattr(self, self._DIGEST_ATTR)
        validate_sha256(digest)
        if digest != self.expected_digest():
            raise ValueError(f"{self._DIGEST_KEY} does not match observation")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind,
            "schemaVersion": self.schema_version,
            "workspaceId": self.workspace_id,
            "gateId": self.gate_id,
            "crashFixtureId": self.crash_fixture_id,
            "qualificationRunId": self.qualification_run_id,
            self._AUTHORITY_KEY: getattr(self, self._AUTHORITY_ATTR),
            "sourceCommit": self.source_commit,
            "hostIdentity": self.host_identity.to_dict(),
            "helperSourceDigest": self.helper_source_digest,
            "helperRuntimeDigest": self.helper_runtime_digest,
            self._BOOT_IDENTITY_KEY: getattr(self, self._BOOT_IDENTITY_ATTR),
            "bootTimeSeconds": self.boot_time_seconds,
            self._BOOT_FRACTION_KEY: getattr(self, self._BOOT_FRACTION_ATTR),
            "observedAt": self.observed_at,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(
            self._DIGEST_DOMAIN,
            self._digest_payload(),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            **self._digest_payload(),
            self._DIGEST_KEY: getattr(self, self._DIGEST_ATTR),
        }

    @classmethod
    def _payload_from_values(
        cls,
        values: Mapping[str, object],
    ) -> dict[str, object]:
        return {
            "artifactKind": cls._ARTIFACT_KIND,
            "schemaVersion": 1,
            "workspaceId": values["workspace_id"],
            "gateId": values["gate_id"],
            "crashFixtureId": values["crash_fixture_id"],
            "qualificationRunId": values["qualification_run_id"],
            cls._AUTHORITY_KEY: values[cls._AUTHORITY_ATTR],
            "sourceCommit": values["source_commit"],
            "hostIdentity": values["host_identity"].to_dict(),
            "helperSourceDigest": values["helper_source_digest"],
            "helperRuntimeDigest": values["helper_runtime_digest"],
            cls._BOOT_IDENTITY_KEY: values[cls._BOOT_IDENTITY_ATTR],
            "bootTimeSeconds": values["boot_time_seconds"],
            cls._BOOT_FRACTION_KEY: values[cls._BOOT_FRACTION_ATTR],
            "observedAt": values["observed_at"],
        }

    @classmethod
    def _create(cls, **values: object) -> object:
        values = {
            **values,
            "artifact_kind": cls._ARTIFACT_KIND,
            "schema_version": 1,
        }
        return cls(
            **values,
            **{
                cls._DIGEST_ATTR: domain_separated_sha256(
                    cls._DIGEST_DOMAIN,
                    cls._payload_from_values(values),
                )
            },
        )

    @classmethod
    def from_dict(cls, value: object) -> object:
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            artifact_kind=data["artifactKind"],
            schema_version=data["schemaVersion"],
            workspace_id=data["workspaceId"],
            gate_id=data["gateId"],
            crash_fixture_id=data["crashFixtureId"],
            qualification_run_id=data["qualificationRunId"],
            **{cls._AUTHORITY_ATTR: data[cls._AUTHORITY_KEY]},
            source_commit=data["sourceCommit"],
            host_identity=runtime_host_identity_from_dict(data["hostIdentity"]),
            helper_source_digest=data["helperSourceDigest"],
            helper_runtime_digest=data["helperRuntimeDigest"],
            **{cls._BOOT_IDENTITY_ATTR: data[cls._BOOT_IDENTITY_KEY]},
            boot_time_seconds=data["bootTimeSeconds"],
            **{cls._BOOT_FRACTION_ATTR: data[cls._BOOT_FRACTION_KEY]},
            observed_at=data["observedAt"],
            **{cls._DIGEST_ATTR: data[cls._DIGEST_KEY]},
        )


@dataclass(frozen=True)
class DarwinDurabilityQualificationBootObservation(
    _DurabilityBootObservationMixin
):
    artifact_kind: str
    schema_version: int
    workspace_id: str
    gate_id: str
    crash_fixture_id: str
    qualification_run_id: str
    bootstrap_candidate_digest: str
    source_commit: str
    host_identity: DarwinRuntimeHostIdentity
    helper_source_digest: str
    helper_runtime_digest: str
    boot_session_uuid: str
    boot_time_seconds: str
    boot_time_microseconds: str
    observed_at: str
    qualification_boot_observation_digest: str
    _ARTIFACT_KIND = (
        "acceptance-durability-qualification-darwin-boot-observation"
    )
    _OS_FAMILY = RuntimeOsFamily.DARWIN
    _HOST_IDENTITY_TYPE = DarwinRuntimeHostIdentity
    _AUTHORITY_KEY = "bootstrapCandidateDigest"
    _AUTHORITY_ATTR = "bootstrap_candidate_digest"
    _BOOT_IDENTITY_KEY = "bootSessionUuid"
    _BOOT_IDENTITY_ATTR = "boot_session_uuid"
    _BOOT_FRACTION_KEY = "bootTimeMicroseconds"
    _BOOT_FRACTION_ATTR = "boot_time_microseconds"
    _DIGEST_KEY = "qualificationBootObservationDigest"
    _DIGEST_ATTR = "qualification_boot_observation_digest"
    _DIGEST_DOMAIN = _DURABILITY_QUALIFICATION_BOOT_DOMAIN
    _WIRE_KEYS = _durability_boot_wire_keys(
        _AUTHORITY_KEY,
        _BOOT_IDENTITY_KEY,
        _BOOT_FRACTION_KEY,
        _DIGEST_KEY,
    )

    @classmethod
    def create(
        cls,
        *,
        workspace_id: str,
        gate_id: str,
        crash_fixture_id: str,
        qualification_run_id: str,
        bootstrap_candidate_digest: str,
        source_commit: str,
        host_identity: DarwinRuntimeHostIdentity,
        helper_source_digest: str,
        helper_runtime_digest: str,
        boot_session_uuid: str,
        boot_time_seconds: str,
        boot_time_microseconds: str,
        observed_at: str,
    ) -> "DarwinDurabilityQualificationBootObservation":
        return cls._create(
            workspace_id=workspace_id,
            gate_id=gate_id,
            crash_fixture_id=crash_fixture_id,
            qualification_run_id=qualification_run_id,
            bootstrap_candidate_digest=bootstrap_candidate_digest,
            source_commit=source_commit,
            host_identity=host_identity,
            helper_source_digest=helper_source_digest,
            helper_runtime_digest=helper_runtime_digest,
            boot_session_uuid=boot_session_uuid,
            boot_time_seconds=boot_time_seconds,
            boot_time_microseconds=boot_time_microseconds,
            observed_at=observed_at,
        )


@dataclass(frozen=True)
class LinuxDurabilityQualificationBootObservation(
    _DurabilityBootObservationMixin
):
    artifact_kind: str
    schema_version: int
    workspace_id: str
    gate_id: str
    crash_fixture_id: str
    qualification_run_id: str
    bootstrap_candidate_digest: str
    source_commit: str
    host_identity: LinuxRuntimeHostIdentity
    helper_source_digest: str
    helper_runtime_digest: str
    boot_id: str
    boot_time_seconds: str
    boot_time_nanoseconds: str
    observed_at: str
    qualification_boot_observation_digest: str
    _ARTIFACT_KIND = (
        "acceptance-durability-qualification-linux-boot-observation"
    )
    _OS_FAMILY = RuntimeOsFamily.LINUX
    _HOST_IDENTITY_TYPE = LinuxRuntimeHostIdentity
    _AUTHORITY_KEY = "bootstrapCandidateDigest"
    _AUTHORITY_ATTR = "bootstrap_candidate_digest"
    _BOOT_IDENTITY_KEY = "bootId"
    _BOOT_IDENTITY_ATTR = "boot_id"
    _BOOT_FRACTION_KEY = "bootTimeNanoseconds"
    _BOOT_FRACTION_ATTR = "boot_time_nanoseconds"
    _DIGEST_KEY = "qualificationBootObservationDigest"
    _DIGEST_ATTR = "qualification_boot_observation_digest"
    _DIGEST_DOMAIN = _DURABILITY_QUALIFICATION_BOOT_DOMAIN
    _WIRE_KEYS = _durability_boot_wire_keys(
        _AUTHORITY_KEY,
        _BOOT_IDENTITY_KEY,
        _BOOT_FRACTION_KEY,
        _DIGEST_KEY,
    )

    @classmethod
    def create(
        cls,
        *,
        workspace_id: str,
        gate_id: str,
        crash_fixture_id: str,
        qualification_run_id: str,
        bootstrap_candidate_digest: str,
        source_commit: str,
        host_identity: LinuxRuntimeHostIdentity,
        helper_source_digest: str,
        helper_runtime_digest: str,
        boot_id: str,
        boot_time_seconds: str,
        boot_time_nanoseconds: str,
        observed_at: str,
    ) -> "LinuxDurabilityQualificationBootObservation":
        return cls._create(
            workspace_id=workspace_id,
            gate_id=gate_id,
            crash_fixture_id=crash_fixture_id,
            qualification_run_id=qualification_run_id,
            bootstrap_candidate_digest=bootstrap_candidate_digest,
            source_commit=source_commit,
            host_identity=host_identity,
            helper_source_digest=helper_source_digest,
            helper_runtime_digest=helper_runtime_digest,
            boot_id=boot_id,
            boot_time_seconds=boot_time_seconds,
            boot_time_nanoseconds=boot_time_nanoseconds,
            observed_at=observed_at,
        )


DurabilityQualificationBootObservation = Union[
    DarwinDurabilityQualificationBootObservation,
    LinuxDurabilityQualificationBootObservation,
]


def durability_qualification_boot_observation_from_dict(
    value: object,
) -> DurabilityQualificationBootObservation:
    if not isinstance(value, Mapping):
        raise ValueError("DurabilityQualificationBootObservation must be an object")
    artifact_kind = value.get("artifactKind")
    if artifact_kind == DarwinDurabilityQualificationBootObservation._ARTIFACT_KIND:
        return DarwinDurabilityQualificationBootObservation.from_dict(value)
    if artifact_kind == LinuxDurabilityQualificationBootObservation._ARTIFACT_KIND:
        return LinuxDurabilityQualificationBootObservation.from_dict(value)
    raise ValueError("qualification boot observation artifactKind is not closed")


@dataclass(frozen=True)
class DarwinDurabilityProfileBootObservation(_DurabilityBootObservationMixin):
    artifact_kind: str
    schema_version: int
    workspace_id: str
    gate_id: str
    crash_fixture_id: str
    qualification_run_id: str
    durability_profile_digest: str
    source_commit: str
    host_identity: DarwinRuntimeHostIdentity
    helper_source_digest: str
    helper_runtime_digest: str
    boot_session_uuid: str
    boot_time_seconds: str
    boot_time_microseconds: str
    observed_at: str
    profile_boot_observation_digest: str
    _ARTIFACT_KIND = "acceptance-durability-profile-darwin-boot-observation"
    _OS_FAMILY = RuntimeOsFamily.DARWIN
    _HOST_IDENTITY_TYPE = DarwinRuntimeHostIdentity
    _AUTHORITY_KEY = "durabilityProfileDigest"
    _AUTHORITY_ATTR = "durability_profile_digest"
    _BOOT_IDENTITY_KEY = "bootSessionUuid"
    _BOOT_IDENTITY_ATTR = "boot_session_uuid"
    _BOOT_FRACTION_KEY = "bootTimeMicroseconds"
    _BOOT_FRACTION_ATTR = "boot_time_microseconds"
    _DIGEST_KEY = "profileBootObservationDigest"
    _DIGEST_ATTR = "profile_boot_observation_digest"
    _DIGEST_DOMAIN = _DURABILITY_PROFILE_BOOT_DOMAIN
    _WIRE_KEYS = _durability_boot_wire_keys(
        _AUTHORITY_KEY,
        _BOOT_IDENTITY_KEY,
        _BOOT_FRACTION_KEY,
        _DIGEST_KEY,
    )

    @classmethod
    def create(
        cls,
        *,
        workspace_id: str,
        gate_id: str,
        crash_fixture_id: str,
        qualification_run_id: str,
        durability_profile_digest: str,
        source_commit: str,
        host_identity: DarwinRuntimeHostIdentity,
        helper_source_digest: str,
        helper_runtime_digest: str,
        boot_session_uuid: str,
        boot_time_seconds: str,
        boot_time_microseconds: str,
        observed_at: str,
    ) -> "DarwinDurabilityProfileBootObservation":
        return cls._create(
            workspace_id=workspace_id,
            gate_id=gate_id,
            crash_fixture_id=crash_fixture_id,
            qualification_run_id=qualification_run_id,
            durability_profile_digest=durability_profile_digest,
            source_commit=source_commit,
            host_identity=host_identity,
            helper_source_digest=helper_source_digest,
            helper_runtime_digest=helper_runtime_digest,
            boot_session_uuid=boot_session_uuid,
            boot_time_seconds=boot_time_seconds,
            boot_time_microseconds=boot_time_microseconds,
            observed_at=observed_at,
        )


@dataclass(frozen=True)
class LinuxDurabilityProfileBootObservation(_DurabilityBootObservationMixin):
    artifact_kind: str
    schema_version: int
    workspace_id: str
    gate_id: str
    crash_fixture_id: str
    qualification_run_id: str
    durability_profile_digest: str
    source_commit: str
    host_identity: LinuxRuntimeHostIdentity
    helper_source_digest: str
    helper_runtime_digest: str
    boot_id: str
    boot_time_seconds: str
    boot_time_nanoseconds: str
    observed_at: str
    profile_boot_observation_digest: str
    _ARTIFACT_KIND = "acceptance-durability-profile-linux-boot-observation"
    _OS_FAMILY = RuntimeOsFamily.LINUX
    _HOST_IDENTITY_TYPE = LinuxRuntimeHostIdentity
    _AUTHORITY_KEY = "durabilityProfileDigest"
    _AUTHORITY_ATTR = "durability_profile_digest"
    _BOOT_IDENTITY_KEY = "bootId"
    _BOOT_IDENTITY_ATTR = "boot_id"
    _BOOT_FRACTION_KEY = "bootTimeNanoseconds"
    _BOOT_FRACTION_ATTR = "boot_time_nanoseconds"
    _DIGEST_KEY = "profileBootObservationDigest"
    _DIGEST_ATTR = "profile_boot_observation_digest"
    _DIGEST_DOMAIN = _DURABILITY_PROFILE_BOOT_DOMAIN
    _WIRE_KEYS = _durability_boot_wire_keys(
        _AUTHORITY_KEY,
        _BOOT_IDENTITY_KEY,
        _BOOT_FRACTION_KEY,
        _DIGEST_KEY,
    )

    @classmethod
    def create(
        cls,
        *,
        workspace_id: str,
        gate_id: str,
        crash_fixture_id: str,
        qualification_run_id: str,
        durability_profile_digest: str,
        source_commit: str,
        host_identity: LinuxRuntimeHostIdentity,
        helper_source_digest: str,
        helper_runtime_digest: str,
        boot_id: str,
        boot_time_seconds: str,
        boot_time_nanoseconds: str,
        observed_at: str,
    ) -> "LinuxDurabilityProfileBootObservation":
        return cls._create(
            workspace_id=workspace_id,
            gate_id=gate_id,
            crash_fixture_id=crash_fixture_id,
            qualification_run_id=qualification_run_id,
            durability_profile_digest=durability_profile_digest,
            source_commit=source_commit,
            host_identity=host_identity,
            helper_source_digest=helper_source_digest,
            helper_runtime_digest=helper_runtime_digest,
            boot_id=boot_id,
            boot_time_seconds=boot_time_seconds,
            boot_time_nanoseconds=boot_time_nanoseconds,
            observed_at=observed_at,
        )


DurabilityProfileBootObservation = Union[
    DarwinDurabilityProfileBootObservation,
    LinuxDurabilityProfileBootObservation,
]


def durability_profile_boot_observation_from_dict(
    value: object,
) -> DurabilityProfileBootObservation:
    if not isinstance(value, Mapping):
        raise ValueError("DurabilityProfileBootObservation must be an object")
    artifact_kind = value.get("artifactKind")
    if artifact_kind == DarwinDurabilityProfileBootObservation._ARTIFACT_KIND:
        return DarwinDurabilityProfileBootObservation.from_dict(value)
    if artifact_kind == LinuxDurabilityProfileBootObservation._ARTIFACT_KIND:
        return LinuxDurabilityProfileBootObservation.from_dict(value)
    raise ValueError("profile boot observation artifactKind is not closed")


@dataclass(frozen=True)
class KernelEvidenceHelperIdentity:
    __slots__ = (
        "helper_kind", "entrypoint_path", "entrypoint_function", "source_rule",
        "source_files", "source_digest", "runtime_manifest_ref",
        "runtime_digest", "helper_identity_digest",
    )
    helper_kind: str
    entrypoint_path: str
    entrypoint_function: str
    source_rule: str
    source_files: tuple[tuple[str, str, int], ...]
    source_digest: str
    runtime_manifest_ref: DurabilityCapabilityArtifactRef
    runtime_digest: str
    helper_identity_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "helperKind", "entrypointPath", "entrypointFunction", "sourceRule",
            "sourceFiles", "sourceDigest", "runtimeManifestRef",
            "runtimeDigest", "helperIdentityDigest",
        }
    )

    def __post_init__(self) -> None:
        functions = {
            "BOOT_BOUNDARY": "capture_boot_boundary",
            "LINUX_PID_NAMESPACE_TERMINATION": "terminate_linux_pid_namespace",
        }
        if (
            self.helper_kind not in functions
            or self.entrypoint_path != "tooling/acceptance/core/proof_admission.py"
            or self.entrypoint_function != functions[self.helper_kind]
            or self.source_rule != "KERNEL_EVIDENCE_HELPER_SOURCE_V1"
        ):
            raise ValueError("kernel helper fixed identity changed")
        _validate_source_file_tuple(self.source_files, field="sourceFiles")
        expected_source = domain_separated_sha256(
            _KERNEL_HELPER_DOMAIN,
            _source_file_tuple_to_wire(self.source_files),
        )
        if self.source_digest != expected_source:
            raise ValueError("sourceDigest does not match helper source closure")
        if (
            not isinstance(self.runtime_manifest_ref, DurabilityCapabilityArtifactRef)
            or self.runtime_manifest_ref.artifact_name
            is not DurabilityCapabilityArtifactName.PROBE_RUNTIME_MANIFEST
        ):
            raise ValueError("runtimeManifestRef must name PROBE_RUNTIME_MANIFEST")
        validate_sha256(self.runtime_digest)
        validate_sha256(self.helper_identity_digest)
        if self.helper_identity_digest != self.expected_digest():
            raise ValueError("helperIdentityDigest does not match helper")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "helperKind": self.helper_kind,
            "entrypointPath": self.entrypoint_path,
            "entrypointFunction": self.entrypoint_function,
            "sourceRule": self.source_rule,
            "sourceFiles": _source_file_tuple_to_wire(self.source_files),
            "sourceDigest": self.source_digest,
            "runtimeManifestRef": self.runtime_manifest_ref.to_dict(),
            "runtimeDigest": self.runtime_digest,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_KERNEL_HELPER_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "helperIdentityDigest": self.helper_identity_digest}

    @classmethod
    def create(
        cls,
        *,
        helper_kind: str,
        source_files: tuple[tuple[str, str, int], ...],
        runtime_manifest_ref: DurabilityCapabilityArtifactRef,
        runtime_digest: str,
    ) -> "KernelEvidenceHelperIdentity":
        functions = {
            "BOOT_BOUNDARY": "capture_boot_boundary",
            "LINUX_PID_NAMESPACE_TERMINATION": "terminate_linux_pid_namespace",
        }
        if helper_kind not in functions:
            raise ValueError("helperKind must be closed")
        source_digest = domain_separated_sha256(
            _KERNEL_HELPER_DOMAIN,
            _source_file_tuple_to_wire(source_files),
        )
        values = {
            "helper_kind": helper_kind,
            "entrypoint_path": "tooling/acceptance/core/proof_admission.py",
            "entrypoint_function": functions[helper_kind],
            "source_rule": "KERNEL_EVIDENCE_HELPER_SOURCE_V1",
            "source_files": source_files,
            "source_digest": source_digest,
            "runtime_manifest_ref": runtime_manifest_ref,
            "runtime_digest": runtime_digest,
        }
        wire = {
            "helperKind": helper_kind,
            "entrypointPath": values["entrypoint_path"],
            "entrypointFunction": values["entrypoint_function"],
            "sourceRule": values["source_rule"],
            "sourceFiles": _source_file_tuple_to_wire(source_files),
            "sourceDigest": source_digest,
            "runtimeManifestRef": runtime_manifest_ref.to_dict(),
            "runtimeDigest": runtime_digest,
        }
        return cls(**values, helper_identity_digest=domain_separated_sha256(_KERNEL_HELPER_DOMAIN, wire))

    @classmethod
    def from_dict(cls, value: object) -> "KernelEvidenceHelperIdentity":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            helper_kind=data["helperKind"],
            entrypoint_path=data["entrypointPath"],
            entrypoint_function=data["entrypointFunction"],
            source_rule=data["sourceRule"],
            source_files=_source_file_tuple_from_wire(data["sourceFiles"], field="sourceFiles"),
            source_digest=data["sourceDigest"],
            runtime_manifest_ref=DurabilityCapabilityArtifactRef.from_dict(data["runtimeManifestRef"]),
            runtime_digest=data["runtimeDigest"],
            helper_identity_digest=data["helperIdentityDigest"],
        )


def _validate_boot_observation_common(
    *,
    workspace_id: str,
    gate_id: str,
    observation_id: str,
    source_commit: str,
    host_identity: RuntimeHostIdentity,
    durability_profile_digest: str,
    live_mount_binding: LiveAuthorityMountBinding,
    helper_identity: KernelEvidenceHelperIdentity,
    observed_at: str,
) -> None:
    _validate_workspace_id(workspace_id)
    _validate_slug(gate_id, field="gate ID")
    _validate_slug(observation_id, field="observationId")
    _validate_non_empty_utf8(source_commit, field="sourceCommit")
    validate_sha256(durability_profile_digest)
    if not isinstance(live_mount_binding, LiveAuthorityMountBinding):
        raise ValueError("liveMountBinding must be typed")
    if not isinstance(helper_identity, KernelEvidenceHelperIdentity):
        raise ValueError("helperIdentity must be typed")
    if helper_identity.helper_kind != "BOOT_BOUNDARY":
        raise ValueError("boot observation requires BOOT_BOUNDARY helper")
    if (
        helper_identity.runtime_manifest_ref.workspace_id != workspace_id
        or helper_identity.runtime_manifest_ref.gate_id != gate_id
    ):
        raise ValueError("boot helper runtime ref identity does not match observation")
    if live_mount_binding.os_family is not host_identity.os_family:
        raise ValueError("mount and host OS families differ")
    if live_mount_binding.host_build != host_identity.host_build:
        raise ValueError("mount and host builds differ")
    _canonical_utc_instant(observed_at, field="observedAt")


@dataclass(frozen=True)
class DarwinBootBoundaryObservation:
    __slots__ = (
        "artifact_kind", "schema_version", "workspace_id", "gate_id",
        "observation_id", "source_commit", "host_identity",
        "durability_profile_digest", "live_mount_binding", "helper_identity",
        "boot_session_uuid", "boot_time_seconds", "boot_time_microseconds",
        "observed_at", "observation_digest",
    )
    artifact_kind: str
    schema_version: int
    workspace_id: str
    gate_id: str
    observation_id: str
    source_commit: str
    host_identity: DarwinRuntimeHostIdentity
    durability_profile_digest: str
    live_mount_binding: LiveAuthorityMountBinding
    helper_identity: KernelEvidenceHelperIdentity
    boot_session_uuid: str
    boot_time_seconds: str
    boot_time_microseconds: str
    observed_at: str
    observation_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "artifactKind", "schemaVersion", "workspaceId", "gateId",
            "observationId", "sourceCommit", "hostIdentity",
            "durabilityProfileDigest", "liveMountBinding", "helperIdentity",
            "bootSessionUuid", "bootTimeSeconds", "bootTimeMicroseconds",
            "observedAt", "observationDigest",
        }
    )

    def __post_init__(self) -> None:
        if self.artifact_kind != "acceptance-proof-admission-darwin-boot-observation":
            raise ValueError("artifactKind is invalid")
        if self.schema_version != 1 or isinstance(self.schema_version, bool):
            raise ValueError("schemaVersion must be 1")
        if not isinstance(self.host_identity, DarwinRuntimeHostIdentity):
            raise ValueError("hostIdentity must be Darwin")
        _validate_boot_observation_common(
            workspace_id=self.workspace_id,
            gate_id=self.gate_id,
            observation_id=self.observation_id,
            source_commit=self.source_commit,
            host_identity=self.host_identity,
            durability_profile_digest=self.durability_profile_digest,
            live_mount_binding=self.live_mount_binding,
            helper_identity=self.helper_identity,
            observed_at=self.observed_at,
        )
        _validate_non_empty_utf8(self.boot_session_uuid, field="bootSessionUuid")
        _validate_uint_string(self.boot_time_seconds, field="bootTimeSeconds")
        _validate_uint_string(self.boot_time_microseconds, field="bootTimeMicroseconds")
        validate_sha256(self.observation_digest)
        if self.observation_digest != self.expected_digest():
            raise ValueError("observationDigest does not match observation")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind,
            "schemaVersion": self.schema_version,
            "workspaceId": self.workspace_id,
            "gateId": self.gate_id,
            "observationId": self.observation_id,
            "sourceCommit": self.source_commit,
            "hostIdentity": self.host_identity.to_dict(),
            "durabilityProfileDigest": self.durability_profile_digest,
            "liveMountBinding": self.live_mount_binding.to_dict(),
            "helperIdentity": self.helper_identity.to_dict(),
            "bootSessionUuid": self.boot_session_uuid,
            "bootTimeSeconds": self.boot_time_seconds,
            "bootTimeMicroseconds": self.boot_time_microseconds,
            "observedAt": self.observed_at,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_BOOT_OBSERVATION_DOMAIN["DARWIN"], self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "observationDigest": self.observation_digest}

    @classmethod
    def create(cls, **values: object) -> "DarwinBootBoundaryObservation":
        values = {
            "artifact_kind": "acceptance-proof-admission-darwin-boot-observation",
            "schema_version": 1,
            **values,
        }
        wire = {
            "artifactKind": values["artifact_kind"],
            "schemaVersion": 1,
            "workspaceId": values["workspace_id"],
            "gateId": values["gate_id"],
            "observationId": values["observation_id"],
            "sourceCommit": values["source_commit"],
            "hostIdentity": values["host_identity"].to_dict(),
            "durabilityProfileDigest": values["durability_profile_digest"],
            "liveMountBinding": values["live_mount_binding"].to_dict(),
            "helperIdentity": values["helper_identity"].to_dict(),
            "bootSessionUuid": values["boot_session_uuid"],
            "bootTimeSeconds": values["boot_time_seconds"],
            "bootTimeMicroseconds": values["boot_time_microseconds"],
            "observedAt": values["observed_at"],
        }
        return cls(**values, observation_digest=domain_separated_sha256(_BOOT_OBSERVATION_DOMAIN["DARWIN"], wire))

    @classmethod
    def from_dict(cls, value: object) -> "DarwinBootBoundaryObservation":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            artifact_kind=data["artifactKind"],
            schema_version=data["schemaVersion"],
            workspace_id=data["workspaceId"],
            gate_id=data["gateId"],
            observation_id=data["observationId"],
            source_commit=data["sourceCommit"],
            host_identity=DarwinRuntimeHostIdentity.from_dict(data["hostIdentity"]),
            durability_profile_digest=data["durabilityProfileDigest"],
            live_mount_binding=LiveAuthorityMountBinding.from_dict(data["liveMountBinding"]),
            helper_identity=KernelEvidenceHelperIdentity.from_dict(data["helperIdentity"]),
            boot_session_uuid=data["bootSessionUuid"],
            boot_time_seconds=data["bootTimeSeconds"],
            boot_time_microseconds=data["bootTimeMicroseconds"],
            observed_at=data["observedAt"],
            observation_digest=data["observationDigest"],
        )


@dataclass(frozen=True)
class LinuxBootBoundaryObservation:
    __slots__ = (
        "artifact_kind", "schema_version", "workspace_id", "gate_id",
        "observation_id", "source_commit", "host_identity",
        "durability_profile_digest", "live_mount_binding", "helper_identity",
        "boot_id", "boot_time_seconds", "boot_time_nanoseconds",
        "observed_at", "observation_digest",
    )
    artifact_kind: str
    schema_version: int
    workspace_id: str
    gate_id: str
    observation_id: str
    source_commit: str
    host_identity: LinuxRuntimeHostIdentity
    durability_profile_digest: str
    live_mount_binding: LiveAuthorityMountBinding
    helper_identity: KernelEvidenceHelperIdentity
    boot_id: str
    boot_time_seconds: str
    boot_time_nanoseconds: str
    observed_at: str
    observation_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "artifactKind", "schemaVersion", "workspaceId", "gateId",
            "observationId", "sourceCommit", "hostIdentity",
            "durabilityProfileDigest", "liveMountBinding", "helperIdentity",
            "bootId", "bootTimeSeconds", "bootTimeNanoseconds",
            "observedAt", "observationDigest",
        }
    )

    def __post_init__(self) -> None:
        if self.artifact_kind != "acceptance-proof-admission-linux-boot-observation":
            raise ValueError("artifactKind is invalid")
        if self.schema_version != 1 or isinstance(self.schema_version, bool):
            raise ValueError("schemaVersion must be 1")
        if not isinstance(self.host_identity, LinuxRuntimeHostIdentity):
            raise ValueError("hostIdentity must be Linux")
        _validate_boot_observation_common(
            workspace_id=self.workspace_id,
            gate_id=self.gate_id,
            observation_id=self.observation_id,
            source_commit=self.source_commit,
            host_identity=self.host_identity,
            durability_profile_digest=self.durability_profile_digest,
            live_mount_binding=self.live_mount_binding,
            helper_identity=self.helper_identity,
            observed_at=self.observed_at,
        )
        _validate_non_empty_utf8(self.boot_id, field="bootId")
        _validate_uint_string(self.boot_time_seconds, field="bootTimeSeconds")
        _validate_uint_string(self.boot_time_nanoseconds, field="bootTimeNanoseconds")
        validate_sha256(self.observation_digest)
        if self.observation_digest != self.expected_digest():
            raise ValueError("observationDigest does not match observation")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind,
            "schemaVersion": self.schema_version,
            "workspaceId": self.workspace_id,
            "gateId": self.gate_id,
            "observationId": self.observation_id,
            "sourceCommit": self.source_commit,
            "hostIdentity": self.host_identity.to_dict(),
            "durabilityProfileDigest": self.durability_profile_digest,
            "liveMountBinding": self.live_mount_binding.to_dict(),
            "helperIdentity": self.helper_identity.to_dict(),
            "bootId": self.boot_id,
            "bootTimeSeconds": self.boot_time_seconds,
            "bootTimeNanoseconds": self.boot_time_nanoseconds,
            "observedAt": self.observed_at,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_BOOT_OBSERVATION_DOMAIN["LINUX"], self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "observationDigest": self.observation_digest}

    @classmethod
    def create(cls, **values: object) -> "LinuxBootBoundaryObservation":
        values = {
            "artifact_kind": "acceptance-proof-admission-linux-boot-observation",
            "schema_version": 1,
            **values,
        }
        wire = {
            "artifactKind": values["artifact_kind"],
            "schemaVersion": 1,
            "workspaceId": values["workspace_id"],
            "gateId": values["gate_id"],
            "observationId": values["observation_id"],
            "sourceCommit": values["source_commit"],
            "hostIdentity": values["host_identity"].to_dict(),
            "durabilityProfileDigest": values["durability_profile_digest"],
            "liveMountBinding": values["live_mount_binding"].to_dict(),
            "helperIdentity": values["helper_identity"].to_dict(),
            "bootId": values["boot_id"],
            "bootTimeSeconds": values["boot_time_seconds"],
            "bootTimeNanoseconds": values["boot_time_nanoseconds"],
            "observedAt": values["observed_at"],
        }
        return cls(**values, observation_digest=domain_separated_sha256(_BOOT_OBSERVATION_DOMAIN["LINUX"], wire))

    @classmethod
    def from_dict(cls, value: object) -> "LinuxBootBoundaryObservation":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            artifact_kind=data["artifactKind"],
            schema_version=data["schemaVersion"],
            workspace_id=data["workspaceId"],
            gate_id=data["gateId"],
            observation_id=data["observationId"],
            source_commit=data["sourceCommit"],
            host_identity=LinuxRuntimeHostIdentity.from_dict(data["hostIdentity"]),
            durability_profile_digest=data["durabilityProfileDigest"],
            live_mount_binding=LiveAuthorityMountBinding.from_dict(data["liveMountBinding"]),
            helper_identity=KernelEvidenceHelperIdentity.from_dict(data["helperIdentity"]),
            boot_id=data["bootId"],
            boot_time_seconds=data["bootTimeSeconds"],
            boot_time_nanoseconds=data["bootTimeNanoseconds"],
            observed_at=data["observedAt"],
            observation_digest=data["observationDigest"],
        )


@dataclass(frozen=True)
class BootBoundaryObservationRef:
    __slots__ = (
        "artifact_kind", "schema_version", "workspace_id", "gate_id",
        "observation_id", "observation_digest", "observation_ref_digest",
    )
    artifact_kind: str
    schema_version: int
    workspace_id: str
    gate_id: str
    observation_id: str
    observation_digest: str
    observation_ref_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "artifactKind", "schemaVersion", "workspaceId", "gateId",
            "observationId", "observationDigest", "observationRefDigest",
        }
    )

    @property
    def os_family(self) -> RuntimeOsFamily:
        if self.artifact_kind == "acceptance-proof-admission-darwin-boot-observation-ref":
            return RuntimeOsFamily.DARWIN
        if self.artifact_kind == "acceptance-proof-admission-linux-boot-observation-ref":
            return RuntimeOsFamily.LINUX
        raise ValueError("artifactKind is invalid")

    def __post_init__(self) -> None:
        family = self.os_family
        if self.schema_version != 1 or isinstance(self.schema_version, bool):
            raise ValueError("schemaVersion must be 1")
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gate ID")
        _validate_slug(self.observation_id, field="observationId")
        validate_sha256(self.observation_digest)
        validate_sha256(self.observation_ref_digest)
        if self.observation_ref_digest != self.expected_digest():
            raise ValueError("observationRefDigest does not match ref")
        if family not in (RuntimeOsFamily.DARWIN, RuntimeOsFamily.LINUX):
            raise ValueError("boot observation ref OS is invalid")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind,
            "schemaVersion": self.schema_version,
            "workspaceId": self.workspace_id,
            "gateId": self.gate_id,
            "observationId": self.observation_id,
            "observationDigest": self.observation_digest,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(
            _BOOT_OBSERVATION_REF_DOMAIN[self.os_family.value], self._digest_payload()
        )

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "observationRefDigest": self.observation_ref_digest}

    @classmethod
    def create(
        cls,
        *,
        os_family: RuntimeOsFamily,
        workspace_id: str,
        gate_id: str,
        observation_id: str,
        observation_digest: str,
    ) -> "BootBoundaryObservationRef":
        artifact_kind = (
            "acceptance-proof-admission-darwin-boot-observation-ref"
            if os_family is RuntimeOsFamily.DARWIN
            else "acceptance-proof-admission-linux-boot-observation-ref"
        )
        wire = {
            "artifactKind": artifact_kind,
            "schemaVersion": 1,
            "workspaceId": workspace_id,
            "gateId": gate_id,
            "observationId": observation_id,
            "observationDigest": observation_digest,
        }
        return cls(
            artifact_kind, 1, workspace_id, gate_id, observation_id,
            observation_digest,
            domain_separated_sha256(_BOOT_OBSERVATION_REF_DOMAIN[os_family.value], wire),
        )

    @classmethod
    def from_dict(cls, value: object) -> "BootBoundaryObservationRef":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            data["artifactKind"], data["schemaVersion"], data["workspaceId"],
            data["gateId"], data["observationId"], data["observationDigest"],
            data["observationRefDigest"],
        )


DarwinBootBoundaryObservationRef = BootBoundaryObservationRef
LinuxBootBoundaryObservationRef = BootBoundaryObservationRef


@dataclass(frozen=True)
class BootBoundaryAttestation:
    __slots__ = (
        "source", "prior_observation", "current_observation",
        "boot_boundary_attestation_digest",
    )
    source: str
    prior_observation: DarwinBootBoundaryObservation | LinuxBootBoundaryObservation
    current_observation: DarwinBootBoundaryObservation | LinuxBootBoundaryObservation
    boot_boundary_attestation_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "source", "priorObservation", "currentObservation",
            "bootBoundaryAttestationDigest",
        }
    )

    @property
    def os_family(self) -> RuntimeOsFamily:
        if isinstance(self.prior_observation, DarwinBootBoundaryObservation):
            return RuntimeOsFamily.DARWIN
        if isinstance(self.prior_observation, LinuxBootBoundaryObservation):
            return RuntimeOsFamily.LINUX
        raise ValueError("priorObservation branch is invalid")

    def __post_init__(self) -> None:
        if self.source != "KERNEL_BOOT_BOUNDARY_HELPER_V1":
            raise ValueError("source must be KERNEL_BOOT_BOUNDARY_HELPER_V1")
        if type(self.prior_observation) is not type(self.current_observation):
            raise ValueError("boot observations must use one OS branch")
        prior = self.prior_observation
        current = self.current_observation
        prior_observed_at = _canonical_utc_instant(
            prior.observed_at,
            field="priorObservation.observedAt",
        )
        current_observed_at = _canonical_utc_instant(
            current.observed_at,
            field="currentObservation.observedAt",
        )
        if (
            prior.workspace_id != current.workspace_id
            or prior.gate_id != current.gate_id
            or prior.source_commit != current.source_commit
            or prior.host_identity != current.host_identity
            or prior.durability_profile_digest != current.durability_profile_digest
            or prior.helper_identity != current.helper_identity
            or prior.observation_id == current.observation_id
            or prior_observed_at >= current_observed_at
        ):
            raise ValueError("boot observation authority fields do not match")
        if isinstance(prior, DarwinBootBoundaryObservation):
            if (
                prior.boot_session_uuid == current.boot_session_uuid
                or (prior.boot_time_seconds, prior.boot_time_microseconds)
                == (current.boot_time_seconds, current.boot_time_microseconds)
            ):
                raise ValueError("Darwin attestation requires a changed boot")
        elif (
            prior.boot_id == current.boot_id
            or (prior.boot_time_seconds, prior.boot_time_nanoseconds)
            == (current.boot_time_seconds, current.boot_time_nanoseconds)
        ):
            raise ValueError("Linux attestation requires a changed boot")
        validate_sha256(self.boot_boundary_attestation_digest)
        if self.boot_boundary_attestation_digest != self.expected_digest():
            raise ValueError("bootBoundaryAttestationDigest does not match attestation")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "source": self.source,
            "priorObservation": self.prior_observation.to_dict(),
            "currentObservation": self.current_observation.to_dict(),
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(
            _BOOT_ATTESTATION_DOMAIN[self.os_family.value], self._digest_payload()
        )

    def to_dict(self) -> dict[str, object]:
        return {
            **self._digest_payload(),
            "bootBoundaryAttestationDigest": self.boot_boundary_attestation_digest,
        }

    @classmethod
    def create(
        cls,
        *,
        prior_observation: DarwinBootBoundaryObservation | LinuxBootBoundaryObservation,
        current_observation: DarwinBootBoundaryObservation | LinuxBootBoundaryObservation,
    ) -> "BootBoundaryAttestation":
        family = (
            RuntimeOsFamily.DARWIN
            if isinstance(prior_observation, DarwinBootBoundaryObservation)
            else RuntimeOsFamily.LINUX
        )
        wire = {
            "source": "KERNEL_BOOT_BOUNDARY_HELPER_V1",
            "priorObservation": prior_observation.to_dict(),
            "currentObservation": current_observation.to_dict(),
        }
        return cls(
            "KERNEL_BOOT_BOUNDARY_HELPER_V1",
            prior_observation,
            current_observation,
            domain_separated_sha256(_BOOT_ATTESTATION_DOMAIN[family.value], wire),
        )

    @classmethod
    def from_dict(cls, value: object) -> "BootBoundaryAttestation":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        prior = data["priorObservation"]
        if not isinstance(prior, Mapping):
            raise ValueError("priorObservation must be an object")
        if prior.get("artifactKind") == "acceptance-proof-admission-darwin-boot-observation":
            decoder = DarwinBootBoundaryObservation.from_dict
        elif prior.get("artifactKind") == "acceptance-proof-admission-linux-boot-observation":
            decoder = LinuxBootBoundaryObservation.from_dict
        else:
            raise ValueError("priorObservation artifactKind is not closed")
        return cls(
            data["source"],
            decoder(prior),
            decoder(data["currentObservation"]),
            data["bootBoundaryAttestationDigest"],
        )


DarwinBootBoundaryAttestation = BootBoundaryAttestation
LinuxBootBoundaryAttestation = BootBoundaryAttestation


@dataclass(frozen=True)
class DarwinProofAdmissionExecutionEnvironmentIdentity:
    __slots__ = (
        "os_family", "host_build", "host_identity", "environment_kind",
        "environment_id", "supervisor_pid", "supervisor_process_start_identity",
        "epoch_boot_observation_ref", "epoch_boot_observation_digest",
        "process_policy", "environment_identity_digest",
    )
    os_family: RuntimeOsFamily
    host_build: DarwinRuntimeHostBuild
    host_identity: DarwinRuntimeHostIdentity
    environment_kind: str
    environment_id: str
    supervisor_pid: int
    supervisor_process_start_identity: DarwinProcessStartIdentity
    epoch_boot_observation_ref: BootBoundaryObservationRef
    epoch_boot_observation_digest: str
    process_policy: str
    environment_identity_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "osFamily", "hostBuild", "hostIdentity", "environmentKind",
            "environmentId", "supervisorPid", "supervisorProcessStartIdentity",
            "epochBootObservationRef", "epochBootObservationDigest",
            "processPolicy", "environmentIdentityDigest",
        }
    )

    def __post_init__(self) -> None:
        if (
            self.os_family is not RuntimeOsFamily.DARWIN
            or self.environment_kind != "TRUSTED_LEAF_COORDINATOR"
            or self.process_policy != _PROOF_PROCESS_POLICY
        ):
            raise ValueError("Darwin execution environment fixed fields changed")
        _validate_host_pair(self.os_family, self.host_build, self.host_identity)
        _validate_non_empty_utf8(self.environment_id, field="environmentId")
        _validate_positive_integer(self.supervisor_pid, field="supervisorPid")
        if not isinstance(
            self.supervisor_process_start_identity, DarwinProcessStartIdentity
        ):
            raise ValueError("supervisor process start identity must be Darwin")
        if (
            not isinstance(self.epoch_boot_observation_ref, BootBoundaryObservationRef)
            or self.epoch_boot_observation_ref.os_family is not RuntimeOsFamily.DARWIN
            or self.epoch_boot_observation_ref.observation_digest
            != self.epoch_boot_observation_digest
        ):
            raise ValueError("epoch boot observation ref/digest mismatch")
        validate_sha256(self.epoch_boot_observation_digest)
        validate_sha256(self.environment_identity_digest)
        if self.environment_identity_digest != self.expected_digest():
            raise ValueError("environmentIdentityDigest does not match environment")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "osFamily": self.os_family.value,
            "hostBuild": self.host_build.to_dict(),
            "hostIdentity": self.host_identity.to_dict(),
            "environmentKind": self.environment_kind,
            "environmentId": self.environment_id,
            "supervisorPid": self.supervisor_pid,
            "supervisorProcessStartIdentity": self.supervisor_process_start_identity.to_dict(),
            "epochBootObservationRef": self.epoch_boot_observation_ref.to_dict(),
            "epochBootObservationDigest": self.epoch_boot_observation_digest,
            "processPolicy": self.process_policy,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_ENVIRONMENT_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "environmentIdentityDigest": self.environment_identity_digest}

    @classmethod
    def create(cls, **values: object) -> "DarwinProofAdmissionExecutionEnvironmentIdentity":
        values = {
            "os_family": RuntimeOsFamily.DARWIN,
            "environment_kind": "TRUSTED_LEAF_COORDINATOR",
            "process_policy": _PROOF_PROCESS_POLICY,
            "epoch_boot_observation_digest": values["epoch_boot_observation_ref"].observation_digest,
            **values,
        }
        wire = {
            "osFamily": RuntimeOsFamily.DARWIN.value,
            "hostBuild": values["host_build"].to_dict(),
            "hostIdentity": values["host_identity"].to_dict(),
            "environmentKind": values["environment_kind"],
            "environmentId": values["environment_id"],
            "supervisorPid": values["supervisor_pid"],
            "supervisorProcessStartIdentity": values["supervisor_process_start_identity"].to_dict(),
            "epochBootObservationRef": values["epoch_boot_observation_ref"].to_dict(),
            "epochBootObservationDigest": values["epoch_boot_observation_digest"],
            "processPolicy": values["process_policy"],
        }
        return cls(**values, environment_identity_digest=domain_separated_sha256(_ENVIRONMENT_DOMAIN, wire))

    @classmethod
    def from_dict(cls, value: object) -> "DarwinProofAdmissionExecutionEnvironmentIdentity":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            os_family=_enum_from_wire(RuntimeOsFamily, data["osFamily"], field="osFamily"),
            host_build=DarwinRuntimeHostBuild.from_dict(data["hostBuild"]),
            host_identity=DarwinRuntimeHostIdentity.from_dict(data["hostIdentity"]),
            environment_kind=data["environmentKind"],
            environment_id=data["environmentId"],
            supervisor_pid=data["supervisorPid"],
            supervisor_process_start_identity=DarwinProcessStartIdentity.from_dict(data["supervisorProcessStartIdentity"]),
            epoch_boot_observation_ref=BootBoundaryObservationRef.from_dict(data["epochBootObservationRef"]),
            epoch_boot_observation_digest=data["epochBootObservationDigest"],
            process_policy=data["processPolicy"],
            environment_identity_digest=data["environmentIdentityDigest"],
        )


@dataclass(frozen=True)
class LinuxProofAdmissionExecutionEnvironmentIdentity:
    __slots__ = (
        "os_family", "host_build", "host_identity", "environment_kind",
        "environment_id", "supervisor_pid", "supervisor_process_start_identity",
        "epoch_boot_observation_ref", "epoch_boot_observation_digest",
        "pid_namespace_device_id", "pid_namespace_inode", "namespace_init_pid",
        "namespace_init_process_start_identity",
        "namespace_init_pidfd_opened_before_job_release",
        "namespace_init_pidfd_owner_pid",
        "namespace_init_pidfd_owner_process_start_identity",
        "namespace_init_pidfd_lease_id", "pidfd_owner_sigchld_disposition",
        "pidfd_owner_sa_no_cld_wait", "pidfd_sole_waiter",
        "pidfd_wait_capability", "process_policy", "environment_identity_digest",
    )
    os_family: RuntimeOsFamily
    host_build: LinuxRuntimeHostBuild
    host_identity: LinuxRuntimeHostIdentity
    environment_kind: str
    environment_id: str
    supervisor_pid: int
    supervisor_process_start_identity: LinuxProcessStartIdentity
    epoch_boot_observation_ref: BootBoundaryObservationRef
    epoch_boot_observation_digest: str
    pid_namespace_device_id: str
    pid_namespace_inode: str
    namespace_init_pid: int
    namespace_init_process_start_identity: LinuxProcessStartIdentity
    namespace_init_pidfd_opened_before_job_release: bool
    namespace_init_pidfd_owner_pid: int
    namespace_init_pidfd_owner_process_start_identity: LinuxProcessStartIdentity
    namespace_init_pidfd_lease_id: str
    pidfd_owner_sigchld_disposition: str
    pidfd_owner_sa_no_cld_wait: bool
    pidfd_sole_waiter: bool
    pidfd_wait_capability: LinuxPidfdWaitCapabilityEvidence
    process_policy: str
    environment_identity_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "osFamily", "hostBuild", "hostIdentity", "environmentKind",
            "environmentId", "supervisorPid", "supervisorProcessStartIdentity",
            "epochBootObservationRef", "epochBootObservationDigest",
            "pidNamespaceDeviceId", "pidNamespaceInode", "namespaceInitPid",
            "namespaceInitProcessStartIdentity",
            "namespaceInitPidfdOpenedBeforeJobRelease",
            "namespaceInitPidfdOwnerPid",
            "namespaceInitPidfdOwnerProcessStartIdentity",
            "namespaceInitPidfdLeaseId", "pidfdOwnerSigchldDisposition",
            "pidfdOwnerSaNoCldWait", "pidfdSoleWaiter", "pidfdWaitCapability",
            "processPolicy", "environmentIdentityDigest",
        }
    )

    def __post_init__(self) -> None:
        if (
            self.os_family is not RuntimeOsFamily.LINUX
            or self.environment_kind != "LINUX_PID_NAMESPACE"
            or self.process_policy != _PROOF_PROCESS_POLICY
        ):
            raise ValueError("Linux execution environment fixed fields changed")
        _validate_host_pair(self.os_family, self.host_build, self.host_identity)
        _validate_non_empty_utf8(self.environment_id, field="environmentId")
        _validate_positive_integer(self.supervisor_pid, field="supervisorPid")
        starts = (
            self.supervisor_process_start_identity,
            self.namespace_init_process_start_identity,
            self.namespace_init_pidfd_owner_process_start_identity,
        )
        if not all(isinstance(start, LinuxProcessStartIdentity) for start in starts):
            raise ValueError("Linux environment process identities must be Linux")
        if len({start.boot_id for start in starts}) != 1:
            raise ValueError("Linux environment process identities must share one boot")
        if (
            not isinstance(self.epoch_boot_observation_ref, BootBoundaryObservationRef)
            or self.epoch_boot_observation_ref.os_family is not RuntimeOsFamily.LINUX
            or self.epoch_boot_observation_ref.observation_digest
            != self.epoch_boot_observation_digest
        ):
            raise ValueError("epoch boot observation ref/digest mismatch")
        validate_sha256(self.epoch_boot_observation_digest)
        _validate_uint_string(self.pid_namespace_device_id, field="pidNamespaceDeviceId")
        _validate_uint_string(self.pid_namespace_inode, field="pidNamespaceInode")
        _validate_positive_integer(self.namespace_init_pid, field="namespaceInitPid")
        if (
            self.namespace_init_pidfd_opened_before_job_release is not True
            or self.namespace_init_pidfd_owner_pid != self.supervisor_pid
            or self.namespace_init_pidfd_owner_process_start_identity
            != self.supervisor_process_start_identity
            or self.pidfd_owner_sigchld_disposition != "DEFAULT"
            or self.pidfd_owner_sa_no_cld_wait is not False
            or self.pidfd_sole_waiter is not True
        ):
            raise ValueError("Linux pidfd ownership contract is invalid")
        _validate_non_empty_utf8(
            self.namespace_init_pidfd_lease_id, field="namespaceInitPidfdLeaseId"
        )
        if (
            not isinstance(self.pidfd_wait_capability, LinuxPidfdWaitCapabilityEvidence)
            or self.pidfd_wait_capability.host_build != self.host_build
            or self.pidfd_wait_capability.host_identity != self.host_identity
        ):
            raise ValueError("pidfd capability does not match environment host")
        validate_sha256(self.environment_identity_digest)
        if self.environment_identity_digest != self.expected_digest():
            raise ValueError("environmentIdentityDigest does not match environment")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "osFamily": self.os_family.value,
            "hostBuild": self.host_build.to_dict(),
            "hostIdentity": self.host_identity.to_dict(),
            "environmentKind": self.environment_kind,
            "environmentId": self.environment_id,
            "supervisorPid": self.supervisor_pid,
            "supervisorProcessStartIdentity": self.supervisor_process_start_identity.to_dict(),
            "epochBootObservationRef": self.epoch_boot_observation_ref.to_dict(),
            "epochBootObservationDigest": self.epoch_boot_observation_digest,
            "pidNamespaceDeviceId": self.pid_namespace_device_id,
            "pidNamespaceInode": self.pid_namespace_inode,
            "namespaceInitPid": self.namespace_init_pid,
            "namespaceInitProcessStartIdentity": self.namespace_init_process_start_identity.to_dict(),
            "namespaceInitPidfdOpenedBeforeJobRelease": self.namespace_init_pidfd_opened_before_job_release,
            "namespaceInitPidfdOwnerPid": self.namespace_init_pidfd_owner_pid,
            "namespaceInitPidfdOwnerProcessStartIdentity": self.namespace_init_pidfd_owner_process_start_identity.to_dict(),
            "namespaceInitPidfdLeaseId": self.namespace_init_pidfd_lease_id,
            "pidfdOwnerSigchldDisposition": self.pidfd_owner_sigchld_disposition,
            "pidfdOwnerSaNoCldWait": self.pidfd_owner_sa_no_cld_wait,
            "pidfdSoleWaiter": self.pidfd_sole_waiter,
            "pidfdWaitCapability": self.pidfd_wait_capability.to_dict(),
            "processPolicy": self.process_policy,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_ENVIRONMENT_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "environmentIdentityDigest": self.environment_identity_digest}

    @classmethod
    def create(cls, **values: object) -> "LinuxProofAdmissionExecutionEnvironmentIdentity":
        values = {
            "os_family": RuntimeOsFamily.LINUX,
            "environment_kind": "LINUX_PID_NAMESPACE",
            "epoch_boot_observation_digest": values["epoch_boot_observation_ref"].observation_digest,
            "namespace_init_pidfd_opened_before_job_release": True,
            "namespace_init_pidfd_owner_pid": values["supervisor_pid"],
            "namespace_init_pidfd_owner_process_start_identity": values["supervisor_process_start_identity"],
            "pidfd_owner_sigchld_disposition": "DEFAULT",
            "pidfd_owner_sa_no_cld_wait": False,
            "pidfd_sole_waiter": True,
            "process_policy": _PROOF_PROCESS_POLICY,
            **values,
        }
        wire = {
            "osFamily": RuntimeOsFamily.LINUX.value,
            "hostBuild": values["host_build"].to_dict(),
            "hostIdentity": values["host_identity"].to_dict(),
            "environmentKind": values["environment_kind"],
            "environmentId": values["environment_id"],
            "supervisorPid": values["supervisor_pid"],
            "supervisorProcessStartIdentity": values["supervisor_process_start_identity"].to_dict(),
            "epochBootObservationRef": values["epoch_boot_observation_ref"].to_dict(),
            "epochBootObservationDigest": values["epoch_boot_observation_digest"],
            "pidNamespaceDeviceId": values["pid_namespace_device_id"],
            "pidNamespaceInode": values["pid_namespace_inode"],
            "namespaceInitPid": values["namespace_init_pid"],
            "namespaceInitProcessStartIdentity": values["namespace_init_process_start_identity"].to_dict(),
            "namespaceInitPidfdOpenedBeforeJobRelease": True,
            "namespaceInitPidfdOwnerPid": values["namespace_init_pidfd_owner_pid"],
            "namespaceInitPidfdOwnerProcessStartIdentity": values["namespace_init_pidfd_owner_process_start_identity"].to_dict(),
            "namespaceInitPidfdLeaseId": values["namespace_init_pidfd_lease_id"],
            "pidfdOwnerSigchldDisposition": "DEFAULT",
            "pidfdOwnerSaNoCldWait": False,
            "pidfdSoleWaiter": True,
            "pidfdWaitCapability": values["pidfd_wait_capability"].to_dict(),
            "processPolicy": _PROOF_PROCESS_POLICY,
        }
        return cls(**values, environment_identity_digest=domain_separated_sha256(_ENVIRONMENT_DOMAIN, wire))

    @classmethod
    def from_dict(cls, value: object) -> "LinuxProofAdmissionExecutionEnvironmentIdentity":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            os_family=_enum_from_wire(RuntimeOsFamily, data["osFamily"], field="osFamily"),
            host_build=LinuxRuntimeHostBuild.from_dict(data["hostBuild"]),
            host_identity=LinuxRuntimeHostIdentity.from_dict(data["hostIdentity"]),
            environment_kind=data["environmentKind"],
            environment_id=data["environmentId"],
            supervisor_pid=data["supervisorPid"],
            supervisor_process_start_identity=LinuxProcessStartIdentity.from_dict(data["supervisorProcessStartIdentity"]),
            epoch_boot_observation_ref=BootBoundaryObservationRef.from_dict(data["epochBootObservationRef"]),
            epoch_boot_observation_digest=data["epochBootObservationDigest"],
            pid_namespace_device_id=data["pidNamespaceDeviceId"],
            pid_namespace_inode=data["pidNamespaceInode"],
            namespace_init_pid=data["namespaceInitPid"],
            namespace_init_process_start_identity=LinuxProcessStartIdentity.from_dict(data["namespaceInitProcessStartIdentity"]),
            namespace_init_pidfd_opened_before_job_release=data["namespaceInitPidfdOpenedBeforeJobRelease"],
            namespace_init_pidfd_owner_pid=data["namespaceInitPidfdOwnerPid"],
            namespace_init_pidfd_owner_process_start_identity=LinuxProcessStartIdentity.from_dict(data["namespaceInitPidfdOwnerProcessStartIdentity"]),
            namespace_init_pidfd_lease_id=data["namespaceInitPidfdLeaseId"],
            pidfd_owner_sigchld_disposition=data["pidfdOwnerSigchldDisposition"],
            pidfd_owner_sa_no_cld_wait=data["pidfdOwnerSaNoCldWait"],
            pidfd_sole_waiter=data["pidfdSoleWaiter"],
            pidfd_wait_capability=LinuxPidfdWaitCapabilityEvidence.from_dict(data["pidfdWaitCapability"]),
            process_policy=data["processPolicy"],
            environment_identity_digest=data["environmentIdentityDigest"],
        )


ProofAdmissionExecutionEnvironmentIdentity = Union[
    DarwinProofAdmissionExecutionEnvironmentIdentity,
    LinuxProofAdmissionExecutionEnvironmentIdentity,
]


def proof_admission_execution_environment_from_dict(
    value: object,
) -> ProofAdmissionExecutionEnvironmentIdentity:
    if not isinstance(value, Mapping):
        raise ValueError("ProofAdmissionExecutionEnvironmentIdentity must be an object")
    if value.get("osFamily") == RuntimeOsFamily.DARWIN.value:
        return DarwinProofAdmissionExecutionEnvironmentIdentity.from_dict(value)
    if value.get("osFamily") == RuntimeOsFamily.LINUX.value:
        return LinuxProofAdmissionExecutionEnvironmentIdentity.from_dict(value)
    raise ValueError("execution environment osFamily is not closed")


@dataclass(frozen=True)
class LinuxPidNamespaceTerminationEvidence:
    __slots__ = (
        "helper_identity", "pidfd_owner_pid", "pidfd_owner_process_start_identity",
        "pid_namespace_device_id", "pid_namespace_inode", "namespace_init_pid",
        "namespace_init_process_start_identity",
        "namespace_init_pidfd_opened_before_job_release",
        "namespace_init_pidfd_lease_id", "pidfd_owner_sigchld_disposition",
        "pidfd_owner_sa_no_cld_wait", "pidfd_sole_waiter",
        "namespace_init_pidfd_poll_revents_raw",
        "namespace_init_pidfd_poll_in_set", "namespace_init_pidfd_poll_error_bits",
        "namespace_init_pidfd_poll_hup_before_wait", "namespace_init_wait_id_type",
        "namespace_init_wait_id_options", "namespace_init_wait_consumed",
        "namespace_init_wait_status", "post_wait_pidfd_poll_revents_raw",
        "post_wait_pidfd_poll_hup_set", "post_wait_pidfd_poll_error_bits",
        "observed_at", "namespace_termination_evidence_digest",
    )
    helper_identity: KernelEvidenceHelperIdentity
    pidfd_owner_pid: int
    pidfd_owner_process_start_identity: LinuxProcessStartIdentity
    pid_namespace_device_id: str
    pid_namespace_inode: str
    namespace_init_pid: int
    namespace_init_process_start_identity: LinuxProcessStartIdentity
    namespace_init_pidfd_opened_before_job_release: bool
    namespace_init_pidfd_lease_id: str
    pidfd_owner_sigchld_disposition: str
    pidfd_owner_sa_no_cld_wait: bool
    pidfd_sole_waiter: bool
    namespace_init_pidfd_poll_revents_raw: str
    namespace_init_pidfd_poll_in_set: bool
    namespace_init_pidfd_poll_error_bits: int
    namespace_init_pidfd_poll_hup_before_wait: bool
    namespace_init_wait_id_type: str
    namespace_init_wait_id_options: str
    namespace_init_wait_consumed: bool
    namespace_init_wait_status: LinuxWaitIdStatus
    post_wait_pidfd_poll_revents_raw: str
    post_wait_pidfd_poll_hup_set: bool
    post_wait_pidfd_poll_error_bits: int
    observed_at: str
    namespace_termination_evidence_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "helperIdentity", "pidfdOwnerPid", "pidfdOwnerProcessStartIdentity",
            "pidNamespaceDeviceId", "pidNamespaceInode", "namespaceInitPid",
            "namespaceInitProcessStartIdentity",
            "namespaceInitPidfdOpenedBeforeJobRelease",
            "namespaceInitPidfdLeaseId", "pidfdOwnerSigchldDisposition",
            "pidfdOwnerSaNoCldWait", "pidfdSoleWaiter",
            "namespaceInitPidfdPollReventsRaw", "namespaceInitPidfdPollInSet",
            "namespaceInitPidfdPollErrorBits",
            "namespaceInitPidfdPollHupBeforeWait", "namespaceInitWaitIdType",
            "namespaceInitWaitIdOptions", "namespaceInitWaitConsumed",
            "namespaceInitWaitStatus", "postWaitPidfdPollReventsRaw",
            "postWaitPidfdPollHupSet", "postWaitPidfdPollErrorBits",
            "observedAt", "namespaceTerminationEvidenceDigest",
        }
    )

    def __post_init__(self) -> None:
        if (
            not isinstance(self.helper_identity, KernelEvidenceHelperIdentity)
            or self.helper_identity.helper_kind != "LINUX_PID_NAMESPACE_TERMINATION"
        ):
            raise ValueError("namespace termination helper is invalid")
        _validate_positive_integer(self.pidfd_owner_pid, field="pidfdOwnerPid")
        _validate_positive_integer(self.namespace_init_pid, field="namespaceInitPid")
        if not isinstance(self.pidfd_owner_process_start_identity, LinuxProcessStartIdentity):
            raise ValueError("pidfd owner start identity must be Linux")
        if not isinstance(self.namespace_init_process_start_identity, LinuxProcessStartIdentity):
            raise ValueError("namespace init start identity must be Linux")
        _validate_uint_string(self.pid_namespace_device_id, field="pidNamespaceDeviceId")
        _validate_uint_string(self.pid_namespace_inode, field="pidNamespaceInode")
        _validate_non_empty_utf8(
            self.namespace_init_pidfd_lease_id, field="namespaceInitPidfdLeaseId"
        )
        if (
            self.namespace_init_pidfd_opened_before_job_release is not True
            or self.pidfd_owner_sigchld_disposition != "DEFAULT"
            or self.pidfd_owner_sa_no_cld_wait is not False
            or self.pidfd_sole_waiter is not True
            or self.namespace_init_wait_id_type != "P_PIDFD"
            or self.namespace_init_wait_id_options != "WEXITED"
            or self.namespace_init_wait_consumed is not True
            or self.namespace_init_wait_status.si_pid != self.namespace_init_pid
        ):
            raise ValueError("namespace consuming wait contract is invalid")
        _validate_pidfd_masks(
            pre_raw=self.namespace_init_pidfd_poll_revents_raw,
            pre_in=self.namespace_init_pidfd_poll_in_set,
            pre_errors=self.namespace_init_pidfd_poll_error_bits,
            pre_hup=self.namespace_init_pidfd_poll_hup_before_wait,
            post_raw=self.post_wait_pidfd_poll_revents_raw,
            post_hup=self.post_wait_pidfd_poll_hup_set,
            post_errors=self.post_wait_pidfd_poll_error_bits,
        )
        _canonical_utc_instant(self.observed_at, field="observedAt")
        validate_sha256(self.namespace_termination_evidence_digest)
        if self.namespace_termination_evidence_digest != self.expected_digest():
            raise ValueError("namespaceTerminationEvidenceDigest does not match evidence")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "helperIdentity": self.helper_identity.to_dict(),
            "pidfdOwnerPid": self.pidfd_owner_pid,
            "pidfdOwnerProcessStartIdentity": self.pidfd_owner_process_start_identity.to_dict(),
            "pidNamespaceDeviceId": self.pid_namespace_device_id,
            "pidNamespaceInode": self.pid_namespace_inode,
            "namespaceInitPid": self.namespace_init_pid,
            "namespaceInitProcessStartIdentity": self.namespace_init_process_start_identity.to_dict(),
            "namespaceInitPidfdOpenedBeforeJobRelease": self.namespace_init_pidfd_opened_before_job_release,
            "namespaceInitPidfdLeaseId": self.namespace_init_pidfd_lease_id,
            "pidfdOwnerSigchldDisposition": self.pidfd_owner_sigchld_disposition,
            "pidfdOwnerSaNoCldWait": self.pidfd_owner_sa_no_cld_wait,
            "pidfdSoleWaiter": self.pidfd_sole_waiter,
            "namespaceInitPidfdPollReventsRaw": self.namespace_init_pidfd_poll_revents_raw,
            "namespaceInitPidfdPollInSet": self.namespace_init_pidfd_poll_in_set,
            "namespaceInitPidfdPollErrorBits": self.namespace_init_pidfd_poll_error_bits,
            "namespaceInitPidfdPollHupBeforeWait": self.namespace_init_pidfd_poll_hup_before_wait,
            "namespaceInitWaitIdType": self.namespace_init_wait_id_type,
            "namespaceInitWaitIdOptions": self.namespace_init_wait_id_options,
            "namespaceInitWaitConsumed": self.namespace_init_wait_consumed,
            "namespaceInitWaitStatus": self.namespace_init_wait_status.to_dict(),
            "postWaitPidfdPollReventsRaw": self.post_wait_pidfd_poll_revents_raw,
            "postWaitPidfdPollHupSet": self.post_wait_pidfd_poll_hup_set,
            "postWaitPidfdPollErrorBits": self.post_wait_pidfd_poll_error_bits,
            "observedAt": self.observed_at,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_NAMESPACE_TERMINATION_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "namespaceTerminationEvidenceDigest": self.namespace_termination_evidence_digest}

    @classmethod
    def create(cls, **values: object) -> "LinuxPidNamespaceTerminationEvidence":
        values = {
            "namespace_init_pidfd_opened_before_job_release": True,
            "pidfd_owner_sigchld_disposition": "DEFAULT",
            "pidfd_owner_sa_no_cld_wait": False,
            "pidfd_sole_waiter": True,
            "namespace_init_pidfd_poll_in_set": True,
            "namespace_init_pidfd_poll_error_bits": 0,
            "namespace_init_pidfd_poll_hup_before_wait": False,
            "namespace_init_wait_id_type": "P_PIDFD",
            "namespace_init_wait_id_options": "WEXITED",
            "namespace_init_wait_consumed": True,
            "post_wait_pidfd_poll_hup_set": True,
            "post_wait_pidfd_poll_error_bits": 0,
            **values,
        }
        wire = {
            "helperIdentity": values["helper_identity"].to_dict(),
            "pidfdOwnerPid": values["pidfd_owner_pid"],
            "pidfdOwnerProcessStartIdentity": values["pidfd_owner_process_start_identity"].to_dict(),
            "pidNamespaceDeviceId": values["pid_namespace_device_id"],
            "pidNamespaceInode": values["pid_namespace_inode"],
            "namespaceInitPid": values["namespace_init_pid"],
            "namespaceInitProcessStartIdentity": values["namespace_init_process_start_identity"].to_dict(),
            "namespaceInitPidfdOpenedBeforeJobRelease": True,
            "namespaceInitPidfdLeaseId": values["namespace_init_pidfd_lease_id"],
            "pidfdOwnerSigchldDisposition": "DEFAULT",
            "pidfdOwnerSaNoCldWait": False,
            "pidfdSoleWaiter": True,
            "namespaceInitPidfdPollReventsRaw": values["namespace_init_pidfd_poll_revents_raw"],
            "namespaceInitPidfdPollInSet": True,
            "namespaceInitPidfdPollErrorBits": 0,
            "namespaceInitPidfdPollHupBeforeWait": False,
            "namespaceInitWaitIdType": "P_PIDFD",
            "namespaceInitWaitIdOptions": "WEXITED",
            "namespaceInitWaitConsumed": True,
            "namespaceInitWaitStatus": values["namespace_init_wait_status"].to_dict(),
            "postWaitPidfdPollReventsRaw": values["post_wait_pidfd_poll_revents_raw"],
            "postWaitPidfdPollHupSet": True,
            "postWaitPidfdPollErrorBits": 0,
            "observedAt": values["observed_at"],
        }
        return cls(**values, namespace_termination_evidence_digest=domain_separated_sha256(_NAMESPACE_TERMINATION_DOMAIN, wire))

    @classmethod
    def from_dict(cls, value: object) -> "LinuxPidNamespaceTerminationEvidence":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            helper_identity=KernelEvidenceHelperIdentity.from_dict(data["helperIdentity"]),
            pidfd_owner_pid=data["pidfdOwnerPid"],
            pidfd_owner_process_start_identity=LinuxProcessStartIdentity.from_dict(data["pidfdOwnerProcessStartIdentity"]),
            pid_namespace_device_id=data["pidNamespaceDeviceId"],
            pid_namespace_inode=data["pidNamespaceInode"],
            namespace_init_pid=data["namespaceInitPid"],
            namespace_init_process_start_identity=LinuxProcessStartIdentity.from_dict(data["namespaceInitProcessStartIdentity"]),
            namespace_init_pidfd_opened_before_job_release=data["namespaceInitPidfdOpenedBeforeJobRelease"],
            namespace_init_pidfd_lease_id=data["namespaceInitPidfdLeaseId"],
            pidfd_owner_sigchld_disposition=data["pidfdOwnerSigchldDisposition"],
            pidfd_owner_sa_no_cld_wait=data["pidfdOwnerSaNoCldWait"],
            pidfd_sole_waiter=data["pidfdSoleWaiter"],
            namespace_init_pidfd_poll_revents_raw=data["namespaceInitPidfdPollReventsRaw"],
            namespace_init_pidfd_poll_in_set=data["namespaceInitPidfdPollInSet"],
            namespace_init_pidfd_poll_error_bits=data["namespaceInitPidfdPollErrorBits"],
            namespace_init_pidfd_poll_hup_before_wait=data["namespaceInitPidfdPollHupBeforeWait"],
            namespace_init_wait_id_type=data["namespaceInitWaitIdType"],
            namespace_init_wait_id_options=data["namespaceInitWaitIdOptions"],
            namespace_init_wait_consumed=data["namespaceInitWaitConsumed"],
            namespace_init_wait_status=LinuxWaitIdStatus.from_dict(data["namespaceInitWaitStatus"]),
            post_wait_pidfd_poll_revents_raw=data["postWaitPidfdPollReventsRaw"],
            post_wait_pidfd_poll_hup_set=data["postWaitPidfdPollHupSet"],
            post_wait_pidfd_poll_error_bits=data["postWaitPidfdPollErrorBits"],
            observed_at=data["observedAt"],
            namespace_termination_evidence_digest=data["namespaceTerminationEvidenceDigest"],
        )


@dataclass(frozen=True)
class ClaimLeaseWrapperIdentity:
    __slots__ = (
        "host_os_family", "host_build", "host_identity", "wrapper_source_rule",
        "wrapper_entrypoint_path", "wrapper_entrypoint_function",
        "wrapper_source_files", "wrapper_source_digest", "wrapper_runtime_digest",
        "wrapper_pid", "wrapper_process_start_identity", "claim_process_pid",
        "claim_process_start_identity", "lease_fd_passed_to_claim",
        "wrapper_identity_digest",
    )
    host_os_family: RuntimeOsFamily
    host_build: RuntimeHostBuild
    host_identity: RuntimeHostIdentity
    wrapper_source_rule: str
    wrapper_entrypoint_path: str
    wrapper_entrypoint_function: str
    wrapper_source_files: tuple[tuple[str, str, int], ...]
    wrapper_source_digest: str
    wrapper_runtime_digest: str
    wrapper_pid: int
    wrapper_process_start_identity: ProcessStartIdentity
    claim_process_pid: int
    claim_process_start_identity: ProcessStartIdentity
    lease_fd_passed_to_claim: bool
    wrapper_identity_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "hostOsFamily", "hostBuild", "hostIdentity", "wrapperSourceRule",
            "wrapperEntrypointPath", "wrapperEntrypointFunction",
            "wrapperSourceFiles", "wrapperSourceDigest", "wrapperRuntimeDigest",
            "wrapperPid", "wrapperProcessStartIdentity", "claimProcessPid",
            "claimProcessStartIdentity", "leaseFdPassedToClaim",
            "wrapperIdentityDigest",
        }
    )

    def __post_init__(self) -> None:
        _validate_host_pair(self.host_os_family, self.host_build, self.host_identity)
        if (
            self.wrapper_source_rule != "CLAIM_LEASE_WRAPPER_SOURCE_V1"
            or self.wrapper_entrypoint_path != "tooling/acceptance/core/proof_admission.py"
            or self.wrapper_entrypoint_function != "run_claim_with_lease"
            or self.lease_fd_passed_to_claim is not False
        ):
            raise ValueError("claim wrapper fixed identity changed")
        _validate_source_file_tuple(self.wrapper_source_files, field="wrapperSourceFiles")
        expected_source = domain_separated_sha256(
            _WRAPPER_SOURCE_DOMAIN,
            _source_file_tuple_to_wire(self.wrapper_source_files),
        )
        if self.wrapper_source_digest != expected_source:
            raise ValueError("wrapperSourceDigest does not match source closure")
        validate_sha256(self.wrapper_runtime_digest)
        _validate_positive_integer(self.wrapper_pid, field="wrapperPid")
        _validate_positive_integer(self.claim_process_pid, field="claimProcessPid")
        starts = (
            self.wrapper_process_start_identity,
            self.claim_process_start_identity,
        )
        if not all(
            type(start) in (DarwinProcessStartIdentity, LinuxProcessStartIdentity)
            and start.os_family is self.host_os_family
            for start in starts
        ):
            raise ValueError("wrapper and claim process identities use wrong OS")
        validate_sha256(self.wrapper_identity_digest)
        if self.wrapper_identity_digest != self.expected_digest():
            raise ValueError("wrapperIdentityDigest does not match wrapper")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "hostOsFamily": self.host_os_family.value,
            "hostBuild": self.host_build.to_dict(),
            "hostIdentity": self.host_identity.to_dict(),
            "wrapperSourceRule": self.wrapper_source_rule,
            "wrapperEntrypointPath": self.wrapper_entrypoint_path,
            "wrapperEntrypointFunction": self.wrapper_entrypoint_function,
            "wrapperSourceFiles": _source_file_tuple_to_wire(self.wrapper_source_files),
            "wrapperSourceDigest": self.wrapper_source_digest,
            "wrapperRuntimeDigest": self.wrapper_runtime_digest,
            "wrapperPid": self.wrapper_pid,
            "wrapperProcessStartIdentity": self.wrapper_process_start_identity.to_dict(),
            "claimProcessPid": self.claim_process_pid,
            "claimProcessStartIdentity": self.claim_process_start_identity.to_dict(),
            "leaseFdPassedToClaim": self.lease_fd_passed_to_claim,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_WRAPPER_IDENTITY_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "wrapperIdentityDigest": self.wrapper_identity_digest}

    @classmethod
    def create(
        cls,
        *,
        host_os_family: RuntimeOsFamily,
        host_build: RuntimeHostBuild,
        host_identity: RuntimeHostIdentity,
        wrapper_source_files: tuple[tuple[str, str, int], ...],
        job_runtime: ProofAdmissionJobRuntimeIdentity,
        wrapper_pid: int,
        wrapper_process_start_identity: ProcessStartIdentity,
        claim_process_pid: int,
        claim_process_start_identity: ProcessStartIdentity,
    ) -> "ClaimLeaseWrapperIdentity":
        if (
            type(job_runtime) is not ProofAdmissionJobRuntimeIdentity
            or type(wrapper_process_start_identity)
            not in (DarwinProcessStartIdentity, LinuxProcessStartIdentity)
            or type(claim_process_start_identity)
            not in (DarwinProcessStartIdentity, LinuxProcessStartIdentity)
        ):
            raise ValueError("wrapper inputs must use concrete contract types")
        if (
            job_runtime.host_os_family is not host_os_family
            or canonical_json_bytes(job_runtime.host_build.to_dict())
            != canonical_json_bytes(host_build.to_dict())
            or canonical_json_bytes(job_runtime.host_identity.to_dict())
            != canonical_json_bytes(host_identity.to_dict())
        ):
            raise ValueError("wrapper and job host identities differ")
        source_digest = domain_separated_sha256(
            _WRAPPER_SOURCE_DOMAIN,
            _source_file_tuple_to_wire(wrapper_source_files),
        )
        runtime_digest = domain_separated_sha256(
            _WRAPPER_RUNTIME_DOMAIN,
            {
                "wrapperSourceDigest": source_digest,
                "executablePathHash": job_runtime.interpreter_executable_path_hash,
                "executableSha256": job_runtime.interpreter_executable_sha256,
                "implementation": job_runtime.interpreter_implementation,
                "version": job_runtime.interpreter_version,
                "stdlibDigest": job_runtime.stdlib_digest,
            },
        )
        values = {
            "host_os_family": host_os_family,
            "host_build": host_build,
            "host_identity": host_identity,
            "wrapper_source_rule": "CLAIM_LEASE_WRAPPER_SOURCE_V1",
            "wrapper_entrypoint_path": "tooling/acceptance/core/proof_admission.py",
            "wrapper_entrypoint_function": "run_claim_with_lease",
            "wrapper_source_files": wrapper_source_files,
            "wrapper_source_digest": source_digest,
            "wrapper_runtime_digest": runtime_digest,
            "wrapper_pid": wrapper_pid,
            "wrapper_process_start_identity": wrapper_process_start_identity,
            "claim_process_pid": claim_process_pid,
            "claim_process_start_identity": claim_process_start_identity,
            "lease_fd_passed_to_claim": False,
        }
        wire = {
            "hostOsFamily": host_os_family.value,
            "hostBuild": host_build.to_dict(),
            "hostIdentity": host_identity.to_dict(),
            "wrapperSourceRule": values["wrapper_source_rule"],
            "wrapperEntrypointPath": values["wrapper_entrypoint_path"],
            "wrapperEntrypointFunction": values["wrapper_entrypoint_function"],
            "wrapperSourceFiles": _source_file_tuple_to_wire(wrapper_source_files),
            "wrapperSourceDigest": source_digest,
            "wrapperRuntimeDigest": runtime_digest,
            "wrapperPid": wrapper_pid,
            "wrapperProcessStartIdentity": wrapper_process_start_identity.to_dict(),
            "claimProcessPid": claim_process_pid,
            "claimProcessStartIdentity": claim_process_start_identity.to_dict(),
            "leaseFdPassedToClaim": False,
        }
        return cls(**values, wrapper_identity_digest=domain_separated_sha256(_WRAPPER_IDENTITY_DOMAIN, wire))

    @classmethod
    def from_dict(cls, value: object) -> "ClaimLeaseWrapperIdentity":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            host_os_family=_enum_from_wire(RuntimeOsFamily, data["hostOsFamily"], field="hostOsFamily"),
            host_build=runtime_host_build_from_dict(data["hostBuild"]),
            host_identity=runtime_host_identity_from_dict(data["hostIdentity"]),
            wrapper_source_rule=data["wrapperSourceRule"],
            wrapper_entrypoint_path=data["wrapperEntrypointPath"],
            wrapper_entrypoint_function=data["wrapperEntrypointFunction"],
            wrapper_source_files=_source_file_tuple_from_wire(data["wrapperSourceFiles"], field="wrapperSourceFiles"),
            wrapper_source_digest=data["wrapperSourceDigest"],
            wrapper_runtime_digest=data["wrapperRuntimeDigest"],
            wrapper_pid=data["wrapperPid"],
            wrapper_process_start_identity=process_start_identity_from_dict(data["wrapperProcessStartIdentity"]),
            claim_process_pid=data["claimProcessPid"],
            claim_process_start_identity=process_start_identity_from_dict(data["claimProcessStartIdentity"]),
            lease_fd_passed_to_claim=data["leaseFdPassedToClaim"],
            wrapper_identity_digest=data["wrapperIdentityDigest"],
        )


@dataclass(frozen=True)
class ClaimLeaseWrapperWaitEvidence:
    __slots__ = (
        "wrapper_pid", "wrapper_process_start_identity", "claim_process_pid",
        "claim_process_start_identity", "claim_wait_status",
        "output_captured_internally", "lease_released_after_output_capture",
        "wrapper_wait_status", "wrapper_wait_evidence_digest",
    )
    wrapper_pid: int
    wrapper_process_start_identity: ProcessStartIdentity
    claim_process_pid: int
    claim_process_start_identity: ProcessStartIdentity
    claim_wait_status: ConsumingChildWaitEvidence
    output_captured_internally: bool
    lease_released_after_output_capture: bool
    wrapper_wait_status: ConsumingChildWaitEvidence
    wrapper_wait_evidence_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "wrapperPid", "wrapperProcessStartIdentity", "claimProcessPid",
            "claimProcessStartIdentity", "claimWaitStatus",
            "outputCapturedInternally", "leaseReleasedAfterOutputCapture",
            "wrapperWaitStatus", "wrapperWaitEvidenceDigest",
        }
    )

    def __post_init__(self) -> None:
        _validate_positive_integer(self.wrapper_pid, field="wrapperPid")
        _validate_positive_integer(self.claim_process_pid, field="claimProcessPid")
        if (
            type(self.wrapper_process_start_identity)
            not in (DarwinProcessStartIdentity, LinuxProcessStartIdentity)
            or type(self.claim_process_start_identity)
            not in (DarwinProcessStartIdentity, LinuxProcessStartIdentity)
            or type(self.claim_wait_status) is not ConsumingChildWaitEvidence
            or type(self.wrapper_wait_status) is not ConsumingChildWaitEvidence
            or self.claim_wait_status.waiter_pid != self.wrapper_pid
            or not _same_process_start_identity(
                self.claim_wait_status.waiter_process_start_identity,
                self.wrapper_process_start_identity,
            )
            or self.claim_wait_status.child_pid != self.claim_process_pid
            or not _same_process_start_identity(
                self.claim_wait_status.child_process_start_identity,
                self.claim_process_start_identity,
            )
            or self.wrapper_wait_status.child_pid != self.wrapper_pid
            or not _same_process_start_identity(
                self.wrapper_wait_status.child_process_start_identity,
                self.wrapper_process_start_identity,
            )
        ):
            raise ValueError("wrapper wait evidence process identities do not close")
        if (
            self.output_captured_internally is not True
            or self.lease_released_after_output_capture is not True
        ):
            raise ValueError("wrapper must capture output before lease release")
        validate_sha256(self.wrapper_wait_evidence_digest)
        if self.wrapper_wait_evidence_digest != self.expected_digest():
            raise ValueError("wrapperWaitEvidenceDigest does not match waits")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "wrapperPid": self.wrapper_pid,
            "wrapperProcessStartIdentity": self.wrapper_process_start_identity.to_dict(),
            "claimProcessPid": self.claim_process_pid,
            "claimProcessStartIdentity": self.claim_process_start_identity.to_dict(),
            "claimWaitStatus": self.claim_wait_status.to_dict(),
            "outputCapturedInternally": self.output_captured_internally,
            "leaseReleasedAfterOutputCapture": self.lease_released_after_output_capture,
            "wrapperWaitStatus": self.wrapper_wait_status.to_dict(),
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_WRAPPER_WAIT_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "wrapperWaitEvidenceDigest": self.wrapper_wait_evidence_digest}

    @classmethod
    def create(cls, **values: object) -> "ClaimLeaseWrapperWaitEvidence":
        if (
            type(values.get("wrapper_process_start_identity"))
            not in (DarwinProcessStartIdentity, LinuxProcessStartIdentity)
            or type(values.get("claim_process_start_identity"))
            not in (DarwinProcessStartIdentity, LinuxProcessStartIdentity)
            or type(values.get("claim_wait_status")) is not ConsumingChildWaitEvidence
            or type(values.get("wrapper_wait_status"))
            is not ConsumingChildWaitEvidence
        ):
            raise ValueError("wrapper wait inputs must use concrete contract types")
        values = {
            "output_captured_internally": True,
            "lease_released_after_output_capture": True,
            **values,
        }
        wire = {
            "wrapperPid": values["wrapper_pid"],
            "wrapperProcessStartIdentity": values["wrapper_process_start_identity"].to_dict(),
            "claimProcessPid": values["claim_process_pid"],
            "claimProcessStartIdentity": values["claim_process_start_identity"].to_dict(),
            "claimWaitStatus": values["claim_wait_status"].to_dict(),
            "outputCapturedInternally": values["output_captured_internally"],
            "leaseReleasedAfterOutputCapture": values["lease_released_after_output_capture"],
            "wrapperWaitStatus": values["wrapper_wait_status"].to_dict(),
        }
        return cls(**values, wrapper_wait_evidence_digest=domain_separated_sha256(_WRAPPER_WAIT_DOMAIN, wire))

    @classmethod
    def from_dict(cls, value: object) -> "ClaimLeaseWrapperWaitEvidence":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            wrapper_pid=data["wrapperPid"],
            wrapper_process_start_identity=process_start_identity_from_dict(data["wrapperProcessStartIdentity"]),
            claim_process_pid=data["claimProcessPid"],
            claim_process_start_identity=process_start_identity_from_dict(data["claimProcessStartIdentity"]),
            claim_wait_status=ConsumingChildWaitEvidence.from_dict(data["claimWaitStatus"]),
            output_captured_internally=data["outputCapturedInternally"],
            lease_released_after_output_capture=data["leaseReleasedAfterOutputCapture"],
            wrapper_wait_status=ConsumingChildWaitEvidence.from_dict(data["wrapperWaitStatus"]),
            wrapper_wait_evidence_digest=data["wrapperWaitEvidenceDigest"],
        )


@dataclass(frozen=True)
class ProofAdmissionJobRecord:
    __slots__ = (
        "artifact_kind", "schema_version", "workspace_id", "gate_id",
        "coordinator_epoch_id", "epoch_digest", "claim_admission_lock_identity",
        "claim_sequence_lock_identity", "job_lease_lock_identity",
        "job_sequence", "job_id", "claim_process_pid", "claim_process_group_id",
        "claim_process_start_identity", "runtime_identity",
        "lease_wrapper_identity", "emitter_input", "expected_resolution",
        "expected_resolution_digest", "sink_identity", "source_commit",
        "proof_admission_source_digest", "registered_at", "job_record_digest",
    )
    artifact_kind: str
    schema_version: int
    workspace_id: str
    gate_id: str
    coordinator_epoch_id: str
    epoch_digest: str
    claim_admission_lock_identity: ProofAdmissionLockIdentity
    claim_sequence_lock_identity: ProofAdmissionLockIdentity
    job_lease_lock_identity: ProofAdmissionLockIdentity
    job_sequence: int
    job_id: str
    claim_process_pid: int
    claim_process_group_id: int
    claim_process_start_identity: ProcessStartIdentity
    runtime_identity: ProofAdmissionJobRuntimeIdentity
    lease_wrapper_identity: ClaimLeaseWrapperIdentity
    emitter_input: ClaimEmitterInput
    expected_resolution: AuthoritativeLatestResolution
    expected_resolution_digest: str
    sink_identity: ProofAdmissionSinkIdentity
    source_commit: str
    proof_admission_source_digest: str
    registered_at: str
    job_record_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "artifactKind", "schemaVersion", "workspaceId", "gateId",
            "coordinatorEpochId", "epochDigest", "claimAdmissionLockIdentity",
            "claimSequenceLockIdentity", "jobLeaseLockIdentity", "jobSequence",
            "jobId", "claimProcessPid", "claimProcessGroupId",
            "claimProcessStartIdentity", "runtimeIdentity",
            "leaseWrapperIdentity", "emitterInput", "expectedResolution",
            "expectedResolutionDigest", "sinkIdentity", "sourceCommit",
            "proofAdmissionSourceDigest", "registeredAt", "jobRecordDigest",
        }
    )

    def __post_init__(self) -> None:
        if self.artifact_kind != "acceptance-proof-admission-job":
            raise ValueError("artifactKind is invalid")
        if self.schema_version != 1 or isinstance(self.schema_version, bool):
            raise ValueError("schemaVersion must be 1")
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gate ID")
        _validate_non_empty_utf8(self.coordinator_epoch_id, field="coordinatorEpochId")
        validate_sha256(self.epoch_digest)
        if not all(
            type(lock) is ProofAdmissionLockIdentity
            for lock in (
                self.claim_admission_lock_identity,
                self.claim_sequence_lock_identity,
                self.job_lease_lock_identity,
            )
        ):
            raise ValueError("job lock identities must be typed")
        _validate_positive_integer(self.job_sequence, field="jobSequence")
        _validate_slug(self.job_id, field="jobId")
        _validate_positive_integer(self.claim_process_pid, field="claimProcessPid")
        _validate_positive_integer(self.claim_process_group_id, field="claimProcessGroupId")
        if (
            type(self.claim_process_start_identity)
            not in (DarwinProcessStartIdentity, LinuxProcessStartIdentity)
            or type(self.runtime_identity) is not ProofAdmissionJobRuntimeIdentity
            or type(self.lease_wrapper_identity) is not ClaimLeaseWrapperIdentity
            or not _same_process_start_identity(
                self.claim_process_start_identity,
                self.lease_wrapper_identity.claim_process_start_identity,
            )
            or self.claim_process_pid != self.lease_wrapper_identity.claim_process_pid
            or self.runtime_identity.host_os_family
            is not self.claim_process_start_identity.os_family
            or self.lease_wrapper_identity.host_os_family
            is not self.runtime_identity.host_os_family
        ):
            raise ValueError("job runtime/wrapper/process identities do not close")
        expected_wrapper_runtime = domain_separated_sha256(
            _WRAPPER_RUNTIME_DOMAIN,
            {
                "wrapperSourceDigest": self.lease_wrapper_identity.wrapper_source_digest,
                "executablePathHash": self.runtime_identity.interpreter_executable_path_hash,
                "executableSha256": self.runtime_identity.interpreter_executable_sha256,
                "implementation": self.runtime_identity.interpreter_implementation,
                "version": self.runtime_identity.interpreter_version,
                "stdlibDigest": self.runtime_identity.stdlib_digest,
            },
        )
        if self.lease_wrapper_identity.wrapper_runtime_digest != expected_wrapper_runtime:
            raise ValueError("wrapper runtime does not equal job interpreter projection")
        if (
            type(self.emitter_input) is not ClaimEmitterInput
            or type(self.expected_resolution) is not AuthoritativeLatestResolution
            or type(self.sink_identity) is not ProofAdmissionSinkIdentity
            or canonical_json_bytes(self.emitter_input.resolution.to_dict())
            != canonical_json_bytes(self.expected_resolution.to_dict())
            or self.expected_resolution_digest
            != self.expected_resolution.resolution_digest
            or self.expected_resolution.workspace_id != self.workspace_id
            or self.expected_resolution.gate_id != self.gate_id
            or self.sink_identity.workspace_id != self.workspace_id
            or self.sink_identity.gate_id != self.gate_id
        ):
            raise ValueError("job authority input or sink identity does not close")
        _validate_non_empty_utf8(self.source_commit, field="sourceCommit")
        validate_sha256(self.proof_admission_source_digest)
        if (
            self.runtime_identity.forbidden_process_api_scan.proof_admission_source_digest
            != self.proof_admission_source_digest
        ):
            raise ValueError("job and scan proof-admission source digests differ")
        _canonical_utc_instant(self.registered_at, field="registeredAt")
        validate_sha256(self.job_record_digest)
        if self.job_record_digest != self.expected_digest():
            raise ValueError("jobRecordDigest does not match job")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind,
            "schemaVersion": self.schema_version,
            "workspaceId": self.workspace_id,
            "gateId": self.gate_id,
            "coordinatorEpochId": self.coordinator_epoch_id,
            "epochDigest": self.epoch_digest,
            "claimAdmissionLockIdentity": self.claim_admission_lock_identity.to_dict(),
            "claimSequenceLockIdentity": self.claim_sequence_lock_identity.to_dict(),
            "jobLeaseLockIdentity": self.job_lease_lock_identity.to_dict(),
            "jobSequence": self.job_sequence,
            "jobId": self.job_id,
            "claimProcessPid": self.claim_process_pid,
            "claimProcessGroupId": self.claim_process_group_id,
            "claimProcessStartIdentity": self.claim_process_start_identity.to_dict(),
            "runtimeIdentity": self.runtime_identity.to_dict(),
            "leaseWrapperIdentity": self.lease_wrapper_identity.to_dict(),
            "emitterInput": self.emitter_input.to_dict(),
            "expectedResolution": self.expected_resolution.to_dict(),
            "expectedResolutionDigest": self.expected_resolution_digest,
            "sinkIdentity": self.sink_identity.to_dict(),
            "sourceCommit": self.source_commit,
            "proofAdmissionSourceDigest": self.proof_admission_source_digest,
            "registeredAt": self.registered_at,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_JOB_RECORD_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "jobRecordDigest": self.job_record_digest}

    @classmethod
    def create(cls, **values: object) -> "ProofAdmissionJobRecord":
        expected_types = {
            "claim_admission_lock_identity": ProofAdmissionLockIdentity,
            "claim_sequence_lock_identity": ProofAdmissionLockIdentity,
            "job_lease_lock_identity": ProofAdmissionLockIdentity,
            "runtime_identity": ProofAdmissionJobRuntimeIdentity,
            "lease_wrapper_identity": ClaimLeaseWrapperIdentity,
            "emitter_input": ClaimEmitterInput,
            "expected_resolution": AuthoritativeLatestResolution,
            "sink_identity": ProofAdmissionSinkIdentity,
        }
        if any(
            type(values.get(field)) is not expected_type
            for field, expected_type in expected_types.items()
        ) or type(values.get("claim_process_start_identity")) not in (
            DarwinProcessStartIdentity,
            LinuxProcessStartIdentity,
        ):
            raise ValueError("job structured inputs must use concrete contract types")
        values = {
            "artifact_kind": "acceptance-proof-admission-job",
            "schema_version": 1,
            "expected_resolution_digest": values["expected_resolution"].resolution_digest,
            **values,
        }
        wire = {
            "artifactKind": values["artifact_kind"],
            "schemaVersion": 1,
            "workspaceId": values["workspace_id"],
            "gateId": values["gate_id"],
            "coordinatorEpochId": values["coordinator_epoch_id"],
            "epochDigest": values["epoch_digest"],
            "claimAdmissionLockIdentity": values["claim_admission_lock_identity"].to_dict(),
            "claimSequenceLockIdentity": values["claim_sequence_lock_identity"].to_dict(),
            "jobLeaseLockIdentity": values["job_lease_lock_identity"].to_dict(),
            "jobSequence": values["job_sequence"],
            "jobId": values["job_id"],
            "claimProcessPid": values["claim_process_pid"],
            "claimProcessGroupId": values["claim_process_group_id"],
            "claimProcessStartIdentity": values["claim_process_start_identity"].to_dict(),
            "runtimeIdentity": values["runtime_identity"].to_dict(),
            "leaseWrapperIdentity": values["lease_wrapper_identity"].to_dict(),
            "emitterInput": values["emitter_input"].to_dict(),
            "expectedResolution": values["expected_resolution"].to_dict(),
            "expectedResolutionDigest": values["expected_resolution_digest"],
            "sinkIdentity": values["sink_identity"].to_dict(),
            "sourceCommit": values["source_commit"],
            "proofAdmissionSourceDigest": values["proof_admission_source_digest"],
            "registeredAt": values["registered_at"],
        }
        return cls(**values, job_record_digest=domain_separated_sha256(_JOB_RECORD_DOMAIN, wire))

    @classmethod
    def from_dict(cls, value: object) -> "ProofAdmissionJobRecord":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            artifact_kind=data["artifactKind"],
            schema_version=data["schemaVersion"],
            workspace_id=data["workspaceId"],
            gate_id=data["gateId"],
            coordinator_epoch_id=data["coordinatorEpochId"],
            epoch_digest=data["epochDigest"],
            claim_admission_lock_identity=ProofAdmissionLockIdentity.from_dict(data["claimAdmissionLockIdentity"]),
            claim_sequence_lock_identity=ProofAdmissionLockIdentity.from_dict(data["claimSequenceLockIdentity"]),
            job_lease_lock_identity=ProofAdmissionLockIdentity.from_dict(data["jobLeaseLockIdentity"]),
            job_sequence=data["jobSequence"],
            job_id=data["jobId"],
            claim_process_pid=data["claimProcessPid"],
            claim_process_group_id=data["claimProcessGroupId"],
            claim_process_start_identity=process_start_identity_from_dict(data["claimProcessStartIdentity"]),
            runtime_identity=ProofAdmissionJobRuntimeIdentity.from_dict(data["runtimeIdentity"]),
            lease_wrapper_identity=ClaimLeaseWrapperIdentity.from_dict(data["leaseWrapperIdentity"]),
            emitter_input=ClaimEmitterInput.from_dict(data["emitterInput"]),
            expected_resolution=AuthoritativeLatestResolution.from_dict(data["expectedResolution"]),
            expected_resolution_digest=data["expectedResolutionDigest"],
            sink_identity=ProofAdmissionSinkIdentity.from_dict(data["sinkIdentity"]),
            source_commit=data["sourceCommit"],
            proof_admission_source_digest=data["proofAdmissionSourceDigest"],
            registered_at=data["registeredAt"],
            job_record_digest=data["jobRecordDigest"],
        )


@dataclass(frozen=True)
class ProofAdmissionProcessGroupEnumeration:
    __slots__ = (
        "artifact_kind", "schema_version", "claim_process_group_id",
        "claim_process_pid", "claim_process_start_identity",
        "observer_pid", "observer_process_start_identity",
        "observed_process_identities", "observed_at", "enumeration_digest",
    )
    artifact_kind: str
    schema_version: int
    claim_process_group_id: int
    claim_process_pid: int
    claim_process_start_identity: ProcessStartIdentity
    observer_pid: int
    observer_process_start_identity: ProcessStartIdentity
    observed_process_identities: tuple[()]
    observed_at: str
    enumeration_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "artifactKind", "schemaVersion", "claimProcessGroupId",
            "claimProcessPid", "claimProcessStartIdentity",
            "observerPid", "observerProcessStartIdentity",
            "observedProcessIdentities", "observedAt", "enumerationDigest",
        }
    )

    def __post_init__(self) -> None:
        if (
            self.artifact_kind
            != "acceptance-proof-admission-process-group-enumeration"
            or self.schema_version != 1
            or isinstance(self.schema_version, bool)
        ):
            raise ValueError("process-group enumeration fixed fields changed")
        _validate_positive_integer(
            self.claim_process_group_id,
            field="claimProcessGroupId",
        )
        _validate_positive_integer(
            self.claim_process_pid,
            field="claimProcessPid",
        )
        _validate_positive_integer(self.observer_pid, field="observerPid")
        if (
            type(self.claim_process_start_identity)
            not in (DarwinProcessStartIdentity, LinuxProcessStartIdentity)
            or type(self.observer_process_start_identity)
            not in (DarwinProcessStartIdentity, LinuxProcessStartIdentity)
            or self.claim_process_start_identity.os_family
            is not self.observer_process_start_identity.os_family
        ):
            raise ValueError(
                "process-group enumeration identities must use one concrete "
                "OS branch"
            )
        if self.observed_process_identities != ():
            raise ValueError(
                "leaf completion requires an empty exact process-group "
                "enumeration"
            )
        _canonical_utc_instant(self.observed_at, field="observedAt")
        validate_sha256(self.enumeration_digest)
        if self.enumeration_digest != self.expected_digest():
            raise ValueError(
                "enumerationDigest does not match process-group enumeration"
            )

    def _digest_payload(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind,
            "schemaVersion": self.schema_version,
            "claimProcessGroupId": self.claim_process_group_id,
            "claimProcessPid": self.claim_process_pid,
            "claimProcessStartIdentity":
                self.claim_process_start_identity.to_dict(),
            "observerPid": self.observer_pid,
            "observerProcessStartIdentity":
                self.observer_process_start_identity.to_dict(),
            "observedProcessIdentities": [],
            "observedAt": self.observed_at,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(
            _PROCESS_GROUP_ENUMERATION_DOMAIN,
            self._digest_payload(),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            **self._digest_payload(),
            "enumerationDigest": self.enumeration_digest,
        }

    @classmethod
    def create(
        cls,
        *,
        claim_process_group_id: int,
        claim_process_pid: int,
        claim_process_start_identity: ProcessStartIdentity,
        observer_pid: int,
        observer_process_start_identity: ProcessStartIdentity,
        observed_at: str,
    ) -> "ProofAdmissionProcessGroupEnumeration":
        if (
            type(claim_process_start_identity)
            not in (DarwinProcessStartIdentity, LinuxProcessStartIdentity)
            or type(observer_process_start_identity)
            not in (DarwinProcessStartIdentity, LinuxProcessStartIdentity)
        ):
            raise ValueError(
                "process-group enumeration identities must use concrete "
                "OS branches"
            )
        values = {
            "artifact_kind":
                "acceptance-proof-admission-process-group-enumeration",
            "schema_version": 1,
            "claim_process_group_id": claim_process_group_id,
            "claim_process_pid": claim_process_pid,
            "claim_process_start_identity": claim_process_start_identity,
            "observer_pid": observer_pid,
            "observer_process_start_identity":
                observer_process_start_identity,
            "observed_process_identities": (),
            "observed_at": observed_at,
        }
        wire = {
            "artifactKind": values["artifact_kind"],
            "schemaVersion": 1,
            "claimProcessGroupId": claim_process_group_id,
            "claimProcessPid": claim_process_pid,
            "claimProcessStartIdentity":
                claim_process_start_identity.to_dict(),
            "observerPid": observer_pid,
            "observerProcessStartIdentity":
                observer_process_start_identity.to_dict(),
            "observedProcessIdentities": [],
            "observedAt": observed_at,
        }
        return cls(
            **values,
            enumeration_digest=domain_separated_sha256(
                _PROCESS_GROUP_ENUMERATION_DOMAIN,
                wire,
            ),
        )

    @classmethod
    def from_dict(
        cls,
        value: object,
    ) -> "ProofAdmissionProcessGroupEnumeration":
        data = _closed_mapping(
            value,
            schema=cls.__name__,
            keys=cls._WIRE_KEYS,
        )
        if not isinstance(data["observedProcessIdentities"], list):
            raise ValueError("observedProcessIdentities must be an array")
        return cls(
            artifact_kind=data["artifactKind"],
            schema_version=data["schemaVersion"],
            claim_process_group_id=data["claimProcessGroupId"],
            claim_process_pid=data["claimProcessPid"],
            claim_process_start_identity=process_start_identity_from_dict(
                data["claimProcessStartIdentity"]
            ),
            observer_pid=data["observerPid"],
            observer_process_start_identity=process_start_identity_from_dict(
                data["observerProcessStartIdentity"]
            ),
            observed_process_identities=tuple(
                data["observedProcessIdentities"]
            ),
            observed_at=data["observedAt"],
            enumeration_digest=data["enumerationDigest"],
        )


@dataclass(frozen=True)
class ProofAdmissionOrphanRecoveryEvidence:
    __slots__ = (
        "artifact_kind", "schema_version", "workspace_id", "gate_id",
        "coordinator_epoch_id", "epoch_digest", "pause_digest",
        "claim_admission_lock_identity", "exclusive_lock_owner_pid",
        "exclusive_lock_owner_process_start_identity",
        "job_record_digest", "job_lease_lock_identity",
        "job_lease_probe_result", "process_group_enumeration",
        "execution_environment_termination_digest", "observed_at",
        "recovery_evidence_digest",
    )
    artifact_kind: str
    schema_version: int
    workspace_id: str
    gate_id: str
    coordinator_epoch_id: str
    epoch_digest: str
    pause_digest: str
    claim_admission_lock_identity: ProofAdmissionLockIdentity
    exclusive_lock_owner_pid: int
    exclusive_lock_owner_process_start_identity: ProcessStartIdentity
    job_record_digest: str
    job_lease_lock_identity: ProofAdmissionLockIdentity
    job_lease_probe_result: str
    process_group_enumeration: ProofAdmissionProcessGroupEnumeration
    execution_environment_termination_digest: str
    observed_at: str
    recovery_evidence_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "artifactKind", "schemaVersion", "workspaceId", "gateId",
            "coordinatorEpochId", "epochDigest", "pauseDigest",
            "claimAdmissionLockIdentity", "exclusiveLockOwnerPid",
            "exclusiveLockOwnerProcessStartIdentity", "jobRecordDigest",
            "jobLeaseLockIdentity", "jobLeaseProbeResult",
            "processGroupEnumeration",
            "executionEnvironmentTerminationDigest", "observedAt",
            "recoveryEvidenceDigest",
        }
    )

    def __post_init__(self) -> None:
        if (
            self.artifact_kind
            != "acceptance-proof-admission-orphan-recovery"
            or self.schema_version != 1
            or isinstance(self.schema_version, bool)
        ):
            raise ValueError("orphan recovery fixed fields changed")
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gate ID")
        _validate_non_empty_utf8(
            self.coordinator_epoch_id,
            field="coordinatorEpochId",
        )
        for value in (
            self.epoch_digest,
            self.pause_digest,
            self.job_record_digest,
            self.execution_environment_termination_digest,
        ):
            validate_sha256(value)
        if (
            type(self.claim_admission_lock_identity)
            is not ProofAdmissionLockIdentity
            or type(self.job_lease_lock_identity)
            is not ProofAdmissionLockIdentity
            or type(self.process_group_enumeration)
            is not ProofAdmissionProcessGroupEnumeration
            or type(self.exclusive_lock_owner_process_start_identity)
            not in (DarwinProcessStartIdentity, LinuxProcessStartIdentity)
        ):
            raise ValueError(
                "orphan recovery inputs must use concrete contract types"
            )
        _validate_positive_integer(
            self.exclusive_lock_owner_pid,
            field="exclusiveLockOwnerPid",
        )
        if self.job_lease_probe_result != "ABSENT_EXCLUSIVE_PROBE_ACQUIRED":
            raise ValueError("orphan recovery requires absent job lease proof")
        if (
            self.process_group_enumeration.observer_pid
            != self.exclusive_lock_owner_pid
            or not _same_process_start_identity(
                self.process_group_enumeration
                .observer_process_start_identity,
                self.exclusive_lock_owner_process_start_identity,
            )
        ):
            raise ValueError(
                "orphan recovery group observer must own the exclusive lock"
            )
        _canonical_utc_instant(self.observed_at, field="observedAt")
        validate_sha256(self.recovery_evidence_digest)
        if self.recovery_evidence_digest != self.expected_digest():
            raise ValueError(
                "recoveryEvidenceDigest does not match orphan recovery"
            )

    def _digest_payload(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind,
            "schemaVersion": self.schema_version,
            "workspaceId": self.workspace_id,
            "gateId": self.gate_id,
            "coordinatorEpochId": self.coordinator_epoch_id,
            "epochDigest": self.epoch_digest,
            "pauseDigest": self.pause_digest,
            "claimAdmissionLockIdentity":
                self.claim_admission_lock_identity.to_dict(),
            "exclusiveLockOwnerPid": self.exclusive_lock_owner_pid,
            "exclusiveLockOwnerProcessStartIdentity":
                self.exclusive_lock_owner_process_start_identity.to_dict(),
            "jobRecordDigest": self.job_record_digest,
            "jobLeaseLockIdentity": self.job_lease_lock_identity.to_dict(),
            "jobLeaseProbeResult": self.job_lease_probe_result,
            "processGroupEnumeration":
                self.process_group_enumeration.to_dict(),
            "executionEnvironmentTerminationDigest":
                self.execution_environment_termination_digest,
            "observedAt": self.observed_at,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(
            _ORPHAN_RECOVERY_DOMAIN,
            self._digest_payload(),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            **self._digest_payload(),
            "recoveryEvidenceDigest": self.recovery_evidence_digest,
        }

    @classmethod
    def create(cls, **values: object) -> "ProofAdmissionOrphanRecoveryEvidence":
        concrete_types = (
            type(values.get("claim_admission_lock_identity"))
            is ProofAdmissionLockIdentity
            and type(values.get("job_lease_lock_identity"))
            is ProofAdmissionLockIdentity
            and type(values.get("process_group_enumeration"))
            is ProofAdmissionProcessGroupEnumeration
            and type(
                values.get("exclusive_lock_owner_process_start_identity")
            )
            in (DarwinProcessStartIdentity, LinuxProcessStartIdentity)
        )
        if not concrete_types:
            raise ValueError(
                "orphan recovery inputs must use concrete contract types"
            )
        values = {
            "artifact_kind":
                "acceptance-proof-admission-orphan-recovery",
            "schema_version": 1,
            "job_lease_probe_result":
                "ABSENT_EXCLUSIVE_PROBE_ACQUIRED",
            **values,
        }
        payload = {
            "artifactKind": values["artifact_kind"],
            "schemaVersion": values["schema_version"],
            "workspaceId": values["workspace_id"],
            "gateId": values["gate_id"],
            "coordinatorEpochId": values["coordinator_epoch_id"],
            "epochDigest": values["epoch_digest"],
            "pauseDigest": values["pause_digest"],
            "claimAdmissionLockIdentity":
                values["claim_admission_lock_identity"].to_dict(),
            "exclusiveLockOwnerPid": values["exclusive_lock_owner_pid"],
            "exclusiveLockOwnerProcessStartIdentity":
                values[
                    "exclusive_lock_owner_process_start_identity"
                ].to_dict(),
            "jobRecordDigest": values["job_record_digest"],
            "jobLeaseLockIdentity":
                values["job_lease_lock_identity"].to_dict(),
            "jobLeaseProbeResult": values["job_lease_probe_result"],
            "processGroupEnumeration":
                values["process_group_enumeration"].to_dict(),
            "executionEnvironmentTerminationDigest":
                values["execution_environment_termination_digest"],
            "observedAt": values["observed_at"],
        }
        return cls(
            **values,
            recovery_evidence_digest=domain_separated_sha256(
                _ORPHAN_RECOVERY_DOMAIN,
                payload,
            ),
        )

    @classmethod
    def from_dict(
        cls,
        value: object,
    ) -> "ProofAdmissionOrphanRecoveryEvidence":
        data = _closed_mapping(
            value,
            schema=cls.__name__,
            keys=cls._WIRE_KEYS,
        )
        return cls(
            artifact_kind=data["artifactKind"],
            schema_version=data["schemaVersion"],
            workspace_id=data["workspaceId"],
            gate_id=data["gateId"],
            coordinator_epoch_id=data["coordinatorEpochId"],
            epoch_digest=data["epochDigest"],
            pause_digest=data["pauseDigest"],
            claim_admission_lock_identity=(
                ProofAdmissionLockIdentity.from_dict(
                    data["claimAdmissionLockIdentity"]
                )
            ),
            exclusive_lock_owner_pid=data["exclusiveLockOwnerPid"],
            exclusive_lock_owner_process_start_identity=(
                process_start_identity_from_dict(
                    data["exclusiveLockOwnerProcessStartIdentity"]
                )
            ),
            job_record_digest=data["jobRecordDigest"],
            job_lease_lock_identity=ProofAdmissionLockIdentity.from_dict(
                data["jobLeaseLockIdentity"]
            ),
            job_lease_probe_result=data["jobLeaseProbeResult"],
            process_group_enumeration=(
                ProofAdmissionProcessGroupEnumeration.from_dict(
                    data["processGroupEnumeration"]
                )
            ),
            execution_environment_termination_digest=(
                data["executionEnvironmentTerminationDigest"]
            ),
            observed_at=data["observedAt"],
            recovery_evidence_digest=data["recoveryEvidenceDigest"],
        )


@dataclass(frozen=True)
class ProofAdmissionJobCompletion:
    __slots__ = (
        "artifact_kind", "schema_version", "workspace_id", "gate_id",
        "coordinator_epoch_id", "job_sequence", "job_record_digest",
        "sink_identity_digest", "claim_process_pid", "claim_process_group_id",
        "claim_process_start_identity", "terminal_state",
        "termination_proof_kind", "process_policy",
        "process_group_enumeration", "output", "wrapper_wait_status",
        "execution_environment_termination", "orphan_recovery_evidence",
        "completed_at", "completion_digest",
    )
    artifact_kind: str
    schema_version: int
    workspace_id: str
    gate_id: str
    coordinator_epoch_id: str
    job_sequence: int
    job_record_digest: str
    sink_identity_digest: str
    claim_process_pid: int
    claim_process_group_id: int
    claim_process_start_identity: ProcessStartIdentity
    terminal_state: ProofAdmissionJobTerminalState
    termination_proof_kind: ProofAdmissionTerminationProofKind
    process_policy: str
    process_group_enumeration: ProofAdmissionProcessGroupEnumeration | None
    output: ClaimEmitterOutput | None
    wrapper_wait_status: ClaimLeaseWrapperWaitEvidence | None
    execution_environment_termination: ExecutionEnvironmentTermination | None
    orphan_recovery_evidence: ProofAdmissionOrphanRecoveryEvidence | None
    completed_at: str
    completion_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "artifactKind", "schemaVersion", "workspaceId", "gateId",
            "coordinatorEpochId", "jobSequence", "jobRecordDigest",
            "sinkIdentityDigest", "claimProcessPid", "claimProcessGroupId",
            "claimProcessStartIdentity", "terminalState",
            "terminationProofKind", "processPolicy",
            "processGroupEnumeration", "output", "wrapperWaitStatus",
            "executionEnvironmentTermination", "orphanRecoveryEvidence",
            "completedAt", "completionDigest",
        }
    )

    def __post_init__(self) -> None:
        if self.artifact_kind != "acceptance-proof-admission-job-completion":
            raise ValueError("artifactKind is invalid")
        if self.schema_version != 1 or isinstance(self.schema_version, bool):
            raise ValueError("schemaVersion must be 1")
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gate ID")
        _validate_non_empty_utf8(self.coordinator_epoch_id, field="coordinatorEpochId")
        _validate_positive_integer(self.job_sequence, field="jobSequence")
        validate_sha256(self.job_record_digest)
        validate_sha256(self.sink_identity_digest)
        _validate_positive_integer(self.claim_process_pid, field="claimProcessPid")
        _validate_positive_integer(self.claim_process_group_id, field="claimProcessGroupId")
        if self.process_policy != _PROOF_PROCESS_POLICY:
            raise ValueError("processPolicy must be NO_CHILD_NO_SESSION_CHANGE_V1")
        if self.terminal_state is ProofAdmissionJobTerminalState.REAPED:
            if (
                self.termination_proof_kind
                is not ProofAdmissionTerminationProofKind.EXECUTION_ENVIRONMENT_TERMINATED
                or self.output is not None
                or self.wrapper_wait_status is not None
                or self.process_group_enumeration is not None
                or type(self.execution_environment_termination)
                not in (
                    DarwinExecutionEnvironmentTermination,
                    LinuxExecutionEnvironmentTermination,
                )
                or type(self.orphan_recovery_evidence)
                is not ProofAdmissionOrphanRecoveryEvidence
                or self.execution_environment_termination.execution_environment_identity.os_family
                is not self.claim_process_start_identity.os_family
            ):
                raise ValueError("REAPED completion branch is invalid")
        else:
            if (
                self.termination_proof_kind
                is not ProofAdmissionTerminationProofKind.LEAF_PROCESS_REAPED
                or self.execution_environment_termination is not None
                or self.orphan_recovery_evidence is not None
                or type(self.wrapper_wait_status)
                is not ClaimLeaseWrapperWaitEvidence
                or type(self.process_group_enumeration)
                is not ProofAdmissionProcessGroupEnumeration
            ):
                raise ValueError("leaf completion branch is invalid")
            enumeration = self.process_group_enumeration
            coordinator_wait = self.wrapper_wait_status.wrapper_wait_status
            if (
                self.wrapper_wait_status.claim_process_pid != self.claim_process_pid
                or not _same_process_start_identity(
                    self.wrapper_wait_status.claim_process_start_identity,
                    self.claim_process_start_identity,
                )
                or enumeration.claim_process_group_id
                != self.claim_process_group_id
                or enumeration.claim_process_pid != self.claim_process_pid
                or not _same_process_start_identity(
                    enumeration.claim_process_start_identity,
                    self.claim_process_start_identity,
                )
                or enumeration.observer_pid != coordinator_wait.waiter_pid
                or not _same_process_start_identity(
                    enumeration.observer_process_start_identity,
                    coordinator_wait.waiter_process_start_identity,
                )
            ):
                raise ValueError(
                    "completion process identity does not match waits and "
                    "group enumeration"
                )
            claim_status = self.wrapper_wait_status.claim_wait_status.status
            wrapper_status = self.wrapper_wait_status.wrapper_wait_status.status
            successful = all(
                status.terminal_kind is PosixTerminalKind.EXITED
                and status.exit_code == 0
                for status in (claim_status, wrapper_status)
            )
            if self.terminal_state is ProofAdmissionJobTerminalState.COMPLETED:
                if not successful or type(self.output) is not ClaimEmitterOutput:
                    raise ValueError("COMPLETED requires output and two zero exits")
                if (
                    self.output.resolution.workspace_id != self.workspace_id
                    or self.output.resolution.gate_id != self.gate_id
                ):
                    raise ValueError(
                        "completed output resolution identity does not match completion"
                    )
            elif self.terminal_state is ProofAdmissionJobTerminalState.CANCELLED:
                if successful or self.output is not None:
                    raise ValueError("CANCELLED requires no output and a failed wait")
            else:
                raise ValueError("terminalState must be closed")
        _canonical_utc_instant(self.completed_at, field="completedAt")
        validate_sha256(self.completion_digest)
        if self.completion_digest != self.expected_digest():
            raise ValueError("completionDigest does not match completion")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind,
            "schemaVersion": self.schema_version,
            "workspaceId": self.workspace_id,
            "gateId": self.gate_id,
            "coordinatorEpochId": self.coordinator_epoch_id,
            "jobSequence": self.job_sequence,
            "jobRecordDigest": self.job_record_digest,
            "sinkIdentityDigest": self.sink_identity_digest,
            "claimProcessPid": self.claim_process_pid,
            "claimProcessGroupId": self.claim_process_group_id,
            "claimProcessStartIdentity": self.claim_process_start_identity.to_dict(),
            "terminalState": self.terminal_state.value,
            "terminationProofKind": self.termination_proof_kind.value,
            "processPolicy": self.process_policy,
            "processGroupEnumeration": (
                None
                if self.process_group_enumeration is None
                else self.process_group_enumeration.to_dict()
            ),
            "output": None if self.output is None else self.output.to_dict(),
            "wrapperWaitStatus": (
                None
                if self.wrapper_wait_status is None
                else self.wrapper_wait_status.to_dict()
            ),
            "executionEnvironmentTermination": (
                None
                if self.execution_environment_termination is None
                else self.execution_environment_termination.to_dict()
            ),
            "orphanRecoveryEvidence": (
                None
                if self.orphan_recovery_evidence is None
                else self.orphan_recovery_evidence.to_dict()
            ),
            "completedAt": self.completed_at,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_JOB_COMPLETION_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "completionDigest": self.completion_digest}

    def validate_references(
        self,
        *,
        job: ProofAdmissionJobRecord,
        epoch: ProofAdmissionEpochRecord,
        pause: ProofAdmissionPauseRecord | None = None,
    ) -> None:
        if (
            type(job) is not ProofAdmissionJobRecord
            or type(epoch) is not ProofAdmissionEpochRecord
        ):
            raise ValueError(
                "completion requires typed job and epoch references"
            )
        if (
            job.workspace_id != self.workspace_id
            or job.gate_id != self.gate_id
            or job.coordinator_epoch_id != self.coordinator_epoch_id
            or job.job_sequence != self.job_sequence
            or job.job_record_digest != self.job_record_digest
            or job.sink_identity.sink_identity_digest != self.sink_identity_digest
            or job.claim_process_pid != self.claim_process_pid
            or job.claim_process_group_id != self.claim_process_group_id
            or not _same_process_start_identity(
                job.claim_process_start_identity,
                self.claim_process_start_identity,
            )
            or epoch.workspace_id != job.workspace_id
            or epoch.gate_id != job.gate_id
            or epoch.coordinator_epoch_id != job.coordinator_epoch_id
            or epoch.epoch_digest != job.epoch_digest
            or epoch.source_commit != job.source_commit
            or epoch.proof_admission_source_digest
            != job.proof_admission_source_digest
            or canonical_json_bytes(
                epoch.claim_admission_lock_identity.to_dict()
            )
            != canonical_json_bytes(
                job.claim_admission_lock_identity.to_dict()
            )
            or canonical_json_bytes(
                epoch.claim_sequence_lock_identity.to_dict()
            )
            != canonical_json_bytes(
                job.claim_sequence_lock_identity.to_dict()
            )
            or (
                self.process_group_enumeration is not None
                and (
                    self.process_group_enumeration.claim_process_group_id
                    != job.claim_process_group_id
                    or self.process_group_enumeration.claim_process_pid
                    != job.claim_process_pid
                    or not _same_process_start_identity(
                        self.process_group_enumeration
                        .claim_process_start_identity,
                        job.claim_process_start_identity,
                    )
                )
            )
            or (
                self.wrapper_wait_status is not None
                and (
                    self.wrapper_wait_status.wrapper_wait_status.waiter_pid
                    != epoch.coordinator_pid
                    or not _same_process_start_identity(
                        self.wrapper_wait_status.wrapper_wait_status
                        .waiter_process_start_identity,
                        epoch.coordinator_process_start_identity,
                    )
                    or self.process_group_enumeration.observer_pid
                    != epoch.coordinator_pid
                    or not _same_process_start_identity(
                        self.process_group_enumeration
                        .observer_process_start_identity,
                        epoch.coordinator_process_start_identity,
                    )
                )
            )
            or self.wrapper_wait_status is not None
            and (
                self.wrapper_wait_status.wrapper_pid
                != job.lease_wrapper_identity.wrapper_pid
                or not _same_process_start_identity(
                    self.wrapper_wait_status.wrapper_process_start_identity,
                    job.lease_wrapper_identity.wrapper_process_start_identity,
                )
                or self.wrapper_wait_status.claim_process_pid
                != job.lease_wrapper_identity.claim_process_pid
                or not _same_process_start_identity(
                    self.wrapper_wait_status.claim_process_start_identity,
                    job.lease_wrapper_identity.claim_process_start_identity,
                )
            )
            or (
                self.terminal_state is ProofAdmissionJobTerminalState.COMPLETED
                and (
                    self.output is None
                    or canonical_json_bytes(self.output.resolution.to_dict())
                    != canonical_json_bytes(job.expected_resolution.to_dict())
                    or self.output.resolution.resolution_digest
                    != job.expected_resolution_digest
                )
            )
            or (
                self.terminal_state is ProofAdmissionJobTerminalState.REAPED
                and (
                    self.execution_environment_termination is None
                    or type(pause) is not ProofAdmissionPauseRecord
                    or canonical_json_bytes(
                        self.execution_environment_termination
                        .execution_environment_identity.to_dict()
                    )
                    != canonical_json_bytes(
                        epoch.execution_environment_identity.to_dict()
                    )
                    or self.orphan_recovery_evidence.workspace_id
                    != job.workspace_id
                    or self.orphan_recovery_evidence.gate_id != job.gate_id
                    or self.orphan_recovery_evidence.coordinator_epoch_id
                    != job.coordinator_epoch_id
                    or self.orphan_recovery_evidence.epoch_digest
                    != job.epoch_digest
                    or self.orphan_recovery_evidence.pause_digest
                    != pause.pause_digest
                    or self.orphan_recovery_evidence.job_record_digest
                    != job.job_record_digest
                    or self.orphan_recovery_evidence
                    .execution_environment_termination_digest
                    != self.execution_environment_termination
                    .execution_environment_termination_digest
                    or canonical_json_bytes(
                        self.orphan_recovery_evidence
                        .claim_admission_lock_identity.to_dict()
                    )
                    != canonical_json_bytes(
                        pause.claim_admission_lock_identity.to_dict()
                    )
                    or canonical_json_bytes(
                        self.orphan_recovery_evidence
                        .job_lease_lock_identity.to_dict()
                    )
                    != canonical_json_bytes(
                        job.job_lease_lock_identity.to_dict()
                    )
                )
            )
        ):
            raise ValueError(
                "completion does not close over the referenced job and epoch"
            )
        epoch_started_at = _canonical_utc_instant(
            epoch.started_at,
            field="startedAt",
        )
        registered_at = _canonical_utc_instant(
            job.registered_at,
            field="registeredAt",
        )
        completed_at = _canonical_utc_instant(
            self.completed_at,
            field="completedAt",
        )
        if registered_at < epoch_started_at:
            raise ValueError(
                "job registration cannot precede epoch start"
            )
        if registered_at > completed_at:
            raise ValueError("completion cannot precede job registration")
        if self.process_group_enumeration is not None and (
            _canonical_utc_instant(
                self.process_group_enumeration.observed_at,
                field="observedAt",
            )
            > completed_at
        ):
            raise ValueError(
                "process-group enumeration cannot follow completion"
            )
        if self.wrapper_wait_status is not None:
            claim_waited_at = _canonical_utc_instant(
                self.wrapper_wait_status.claim_wait_status.waited_at,
                field="waitedAt",
            )
            wrapper_waited_at = _canonical_utc_instant(
                self.wrapper_wait_status.wrapper_wait_status.waited_at,
                field="waitedAt",
            )
            enumeration_at = _canonical_utc_instant(
                self.process_group_enumeration.observed_at,
                field="observedAt",
            )
            if not (
                registered_at
                <= claim_waited_at
                <= wrapper_waited_at
                <= enumeration_at
                <= completed_at
            ):
                raise ValueError(
                    "leaf completion chronology is invalid"
                )
        if self.execution_environment_termination is not None and (
            _canonical_utc_instant(
                self.execution_environment_termination.terminated_at,
                field="terminatedAt",
            )
            > completed_at
        ):
            raise ValueError(
                "environment termination cannot follow completion"
            )
        if self.orphan_recovery_evidence is not None:
            terminated_at = _canonical_utc_instant(
                self.execution_environment_termination.terminated_at,
                field="terminatedAt",
            )
            group_observed_at = _canonical_utc_instant(
                self.orphan_recovery_evidence
                .process_group_enumeration.observed_at,
                field="observedAt",
            )
            recovery_observed_at = _canonical_utc_instant(
                self.orphan_recovery_evidence.observed_at,
                field="observedAt",
            )
            paused_at = _canonical_utc_instant(
                pause.paused_at,
                field="pausedAt",
            )
            if not (
                registered_at
                <= terminated_at
                <= paused_at
                <= group_observed_at
                <= recovery_observed_at
                <= completed_at
            ):
                raise ValueError(
                    "orphan recovery chronology is invalid"
                )

    @classmethod
    def create(
        cls,
        *,
        job: ProofAdmissionJobRecord,
        epoch: ProofAdmissionEpochRecord,
        terminal_state: ProofAdmissionJobTerminalState,
        output: ClaimEmitterOutput | None,
        wrapper_wait_status: ClaimLeaseWrapperWaitEvidence,
        process_group_enumeration: ProofAdmissionProcessGroupEnumeration,
        completed_at: str,
    ) -> "ProofAdmissionJobCompletion":
        if (
            type(job) is not ProofAdmissionJobRecord
            or type(epoch) is not ProofAdmissionEpochRecord
        ):
            raise ValueError(
                "completion requires typed job and epoch references"
            )
        if (
            type(terminal_state) is not ProofAdmissionJobTerminalState
            or type(wrapper_wait_status) is not ClaimLeaseWrapperWaitEvidence
            or type(process_group_enumeration)
            is not ProofAdmissionProcessGroupEnumeration
            or (
                terminal_state is ProofAdmissionJobTerminalState.COMPLETED
                and type(output) is not ClaimEmitterOutput
            )
            or (
                terminal_state is ProofAdmissionJobTerminalState.CANCELLED
                and output is not None
            )
        ):
            raise ValueError(
                "completion inputs must use concrete contract types"
            )
        if (
            terminal_state is ProofAdmissionJobTerminalState.COMPLETED
            and (
                canonical_json_bytes(output.resolution.to_dict())
                != canonical_json_bytes(job.expected_resolution.to_dict())
                or output.resolution.resolution_digest
                != job.expected_resolution_digest
            )
        ):
            raise ValueError("completed output must equal the job resolution")
        values = {
            "artifact_kind": "acceptance-proof-admission-job-completion",
            "schema_version": 1,
            "workspace_id": job.workspace_id,
            "gate_id": job.gate_id,
            "coordinator_epoch_id": job.coordinator_epoch_id,
            "job_sequence": job.job_sequence,
            "job_record_digest": job.job_record_digest,
            "sink_identity_digest": job.sink_identity.sink_identity_digest,
            "claim_process_pid": job.claim_process_pid,
            "claim_process_group_id": job.claim_process_group_id,
            "claim_process_start_identity": job.claim_process_start_identity,
            "terminal_state": terminal_state,
            "termination_proof_kind": ProofAdmissionTerminationProofKind.LEAF_PROCESS_REAPED,
            "process_policy": _PROOF_PROCESS_POLICY,
            "process_group_enumeration": process_group_enumeration,
            "output": output,
            "wrapper_wait_status": wrapper_wait_status,
            "execution_environment_termination": None,
            "orphan_recovery_evidence": None,
            "completed_at": completed_at,
        }
        wire = {
            "artifactKind": values["artifact_kind"],
            "schemaVersion": 1,
            "workspaceId": values["workspace_id"],
            "gateId": values["gate_id"],
            "coordinatorEpochId": values["coordinator_epoch_id"],
            "jobSequence": values["job_sequence"],
            "jobRecordDigest": values["job_record_digest"],
            "sinkIdentityDigest": values["sink_identity_digest"],
            "claimProcessPid": values["claim_process_pid"],
            "claimProcessGroupId": values["claim_process_group_id"],
            "claimProcessStartIdentity": values["claim_process_start_identity"].to_dict(),
            "terminalState": terminal_state.value,
            "terminationProofKind": values["termination_proof_kind"].value,
            "processPolicy": values["process_policy"],
            "processGroupEnumeration": process_group_enumeration.to_dict(),
            "output": None if output is None else output.to_dict(),
            "wrapperWaitStatus": wrapper_wait_status.to_dict(),
            "executionEnvironmentTermination": None,
            "orphanRecoveryEvidence": None,
            "completedAt": completed_at,
        }
        completion = cls(
            **values,
            completion_digest=domain_separated_sha256(_JOB_COMPLETION_DOMAIN, wire),
        )
        completion.validate_references(job=job, epoch=epoch)
        return completion

    @classmethod
    def create_reaped(
        cls,
        *,
        job: ProofAdmissionJobRecord,
        epoch: ProofAdmissionEpochRecord,
        pause: ProofAdmissionPauseRecord,
        execution_environment_termination: ExecutionEnvironmentTermination,
        orphan_recovery_evidence: ProofAdmissionOrphanRecoveryEvidence,
        completed_at: str,
    ) -> "ProofAdmissionJobCompletion":
        if type(job) is not ProofAdmissionJobRecord:
            raise ValueError("completion requires a typed job reference")
        if type(epoch) is not ProofAdmissionEpochRecord:
            raise ValueError(
                "reaped completion requires a typed epoch reference"
            )
        if (
            type(pause) is not ProofAdmissionPauseRecord
            or type(orphan_recovery_evidence)
            is not ProofAdmissionOrphanRecoveryEvidence
        ):
            raise ValueError(
                "reaped completion requires typed pause and recovery evidence"
            )
        if type(execution_environment_termination) not in (
            DarwinExecutionEnvironmentTermination,
            LinuxExecutionEnvironmentTermination,
        ):
            raise ValueError(
                "reaped completion requires typed environment termination"
            )
        if (
            job.workspace_id != epoch.workspace_id
            or job.gate_id != epoch.gate_id
            or job.coordinator_epoch_id != epoch.coordinator_epoch_id
            or job.epoch_digest != epoch.epoch_digest
            or canonical_json_bytes(
                execution_environment_termination
                .execution_environment_identity.to_dict()
            )
            != canonical_json_bytes(
                epoch.execution_environment_identity.to_dict()
            )
        ):
            raise ValueError(
                "reaped completion termination does not match job epoch"
            )
        values = {
            "artifact_kind": "acceptance-proof-admission-job-completion",
            "schema_version": 1,
            "workspace_id": job.workspace_id,
            "gate_id": job.gate_id,
            "coordinator_epoch_id": job.coordinator_epoch_id,
            "job_sequence": job.job_sequence,
            "job_record_digest": job.job_record_digest,
            "sink_identity_digest": job.sink_identity.sink_identity_digest,
            "claim_process_pid": job.claim_process_pid,
            "claim_process_group_id": job.claim_process_group_id,
            "claim_process_start_identity": job.claim_process_start_identity,
            "terminal_state": ProofAdmissionJobTerminalState.REAPED,
            "termination_proof_kind": ProofAdmissionTerminationProofKind.EXECUTION_ENVIRONMENT_TERMINATED,
            "process_policy": _PROOF_PROCESS_POLICY,
            "process_group_enumeration": None,
            "output": None,
            "wrapper_wait_status": None,
            "execution_environment_termination": execution_environment_termination,
            "orphan_recovery_evidence": orphan_recovery_evidence,
            "completed_at": completed_at,
        }
        wire = {
            "artifactKind": values["artifact_kind"],
            "schemaVersion": 1,
            "workspaceId": values["workspace_id"],
            "gateId": values["gate_id"],
            "coordinatorEpochId": values["coordinator_epoch_id"],
            "jobSequence": values["job_sequence"],
            "jobRecordDigest": values["job_record_digest"],
            "sinkIdentityDigest": values["sink_identity_digest"],
            "claimProcessPid": values["claim_process_pid"],
            "claimProcessGroupId": values["claim_process_group_id"],
            "claimProcessStartIdentity": values["claim_process_start_identity"].to_dict(),
            "terminalState": values["terminal_state"].value,
            "terminationProofKind": values["termination_proof_kind"].value,
            "processPolicy": values["process_policy"],
            "processGroupEnumeration": None,
            "output": None,
            "wrapperWaitStatus": None,
            "executionEnvironmentTermination": execution_environment_termination.to_dict(),
            "orphanRecoveryEvidence": orphan_recovery_evidence.to_dict(),
            "completedAt": completed_at,
        }
        completion = cls(
            **values,
            completion_digest=domain_separated_sha256(_JOB_COMPLETION_DOMAIN, wire),
        )
        completion.validate_references(job=job, epoch=epoch, pause=pause)
        return completion

    @classmethod
    def from_dict(
        cls,
        value: object,
        *,
        job: ProofAdmissionJobRecord,
        epoch: ProofAdmissionEpochRecord | None = None,
        pause: ProofAdmissionPauseRecord | None = None,
    ) -> "ProofAdmissionJobCompletion":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        output = data["output"]
        wrapper = data["wrapperWaitStatus"]
        termination = data["executionEnvironmentTermination"]
        enumeration = data["processGroupEnumeration"]
        recovery = data["orphanRecoveryEvidence"]
        completion = cls(
            artifact_kind=data["artifactKind"],
            schema_version=data["schemaVersion"],
            workspace_id=data["workspaceId"],
            gate_id=data["gateId"],
            coordinator_epoch_id=data["coordinatorEpochId"],
            job_sequence=data["jobSequence"],
            job_record_digest=data["jobRecordDigest"],
            sink_identity_digest=data["sinkIdentityDigest"],
            claim_process_pid=data["claimProcessPid"],
            claim_process_group_id=data["claimProcessGroupId"],
            claim_process_start_identity=process_start_identity_from_dict(data["claimProcessStartIdentity"]),
            terminal_state=_enum_from_wire(
                ProofAdmissionJobTerminalState, data["terminalState"], field="terminalState"
            ),
            termination_proof_kind=_enum_from_wire(
                ProofAdmissionTerminationProofKind,
                data["terminationProofKind"],
                field="terminationProofKind",
            ),
            process_policy=data["processPolicy"],
            process_group_enumeration=(
                None
                if enumeration is None
                else ProofAdmissionProcessGroupEnumeration.from_dict(
                    enumeration
                )
            ),
            output=None if output is None else ClaimEmitterOutput.from_dict(output),
            wrapper_wait_status=None if wrapper is None else ClaimLeaseWrapperWaitEvidence.from_dict(wrapper),
            execution_environment_termination=(
                None
                if termination is None
                else execution_environment_termination_from_dict(termination)
            ),
            orphan_recovery_evidence=(
                None
                if recovery is None
                else ProofAdmissionOrphanRecoveryEvidence.from_dict(recovery)
            ),
            completed_at=data["completedAt"],
            completion_digest=data["completionDigest"],
        )
        completion.validate_references(job=job, epoch=epoch, pause=pause)
        return completion


@dataclass(frozen=True)
class LegacyClaimEnvironmentIdentity:
    __slots__ = (
        "os_family", "environment_kind", "host_identity",
        "boot_observation_digest", "environment_identity_digest",
    )
    os_family: RuntimeOsFamily
    environment_kind: str
    host_identity: RuntimeHostIdentity
    boot_observation_digest: str
    environment_identity_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "osFamily", "environmentKind", "hostIdentity",
            "bootObservationDigest", "environmentIdentityDigest",
        }
    )

    def __post_init__(self) -> None:
        if self.environment_kind != "LEGACY_BOOT_SESSION":
            raise ValueError("environmentKind must be LEGACY_BOOT_SESSION")
        if (
            not isinstance(self.host_identity, (DarwinRuntimeHostIdentity, LinuxRuntimeHostIdentity))
            or self.host_identity.os_family is not self.os_family
        ):
            raise ValueError("legacy host identity uses the wrong OS branch")
        validate_sha256(self.boot_observation_digest)
        validate_sha256(self.environment_identity_digest)
        if self.environment_identity_digest != self.expected_digest():
            raise ValueError("environmentIdentityDigest does not match legacy identity")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "osFamily": self.os_family.value,
            "environmentKind": self.environment_kind,
            "hostIdentity": self.host_identity.to_dict(),
            "bootObservationDigest": self.boot_observation_digest,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_ENVIRONMENT_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "environmentIdentityDigest": self.environment_identity_digest}

    @classmethod
    def create(
        cls,
        *,
        host_identity: RuntimeHostIdentity,
        boot_observation_digest: str,
    ) -> "LegacyClaimEnvironmentIdentity":
        values = {
            "os_family": host_identity.os_family,
            "environment_kind": "LEGACY_BOOT_SESSION",
            "host_identity": host_identity,
            "boot_observation_digest": boot_observation_digest,
        }
        wire = {
            "osFamily": host_identity.os_family.value,
            "environmentKind": "LEGACY_BOOT_SESSION",
            "hostIdentity": host_identity.to_dict(),
            "bootObservationDigest": boot_observation_digest,
        }
        return cls(**values, environment_identity_digest=domain_separated_sha256(_ENVIRONMENT_DOMAIN, wire))

    @classmethod
    def from_dict(cls, value: object) -> "LegacyClaimEnvironmentIdentity":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            os_family=_enum_from_wire(RuntimeOsFamily, data["osFamily"], field="osFamily"),
            environment_kind=data["environmentKind"],
            host_identity=runtime_host_identity_from_dict(data["hostIdentity"]),
            boot_observation_digest=data["bootObservationDigest"],
            environment_identity_digest=data["environmentIdentityDigest"],
        )


DarwinLegacyClaimEnvironmentIdentity = LegacyClaimEnvironmentIdentity
LinuxLegacyClaimEnvironmentIdentity = LegacyClaimEnvironmentIdentity


@dataclass(frozen=True)
class LegacyEnvironmentTermination:
    __slots__ = (
        "execution_environment_identity", "termination_method",
        "boot_boundary_attestation", "terminated_at",
        "surviving_process_identities", "execution_environment_termination_digest",
    )
    execution_environment_identity: LegacyClaimEnvironmentIdentity
    termination_method: ProofAdmissionTerminationMethod
    boot_boundary_attestation: BootBoundaryAttestation
    terminated_at: str
    surviving_process_identities: tuple[()]
    execution_environment_termination_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "executionEnvironmentIdentity", "terminationMethod",
            "bootBoundaryAttestation", "terminatedAt",
            "survivingProcessIdentities", "executionEnvironmentTerminationDigest",
        }
    )

    def __post_init__(self) -> None:
        if (
            not isinstance(self.execution_environment_identity, LegacyClaimEnvironmentIdentity)
            or self.termination_method
            is not ProofAdmissionTerminationMethod.BOOT_BOUNDARY_ATTESTED
            or not isinstance(self.boot_boundary_attestation, BootBoundaryAttestation)
            or self.surviving_process_identities != ()
        ):
            raise ValueError("legacy termination branch is invalid")
        prior = self.boot_boundary_attestation.prior_observation
        if (
            prior.host_identity != self.execution_environment_identity.host_identity
            or prior.observation_digest
            != self.execution_environment_identity.boot_observation_digest
            or prior.host_identity.os_family
            is not self.execution_environment_identity.os_family
        ):
            raise ValueError("legacy termination does not match prior boot observation")
        terminated_at = _canonical_utc_instant(
            self.terminated_at,
            field="terminatedAt",
        )
        if (
            _canonical_utc_instant(
                self.boot_boundary_attestation.current_observation.observed_at,
                field="observedAt",
            )
            > terminated_at
        ):
            raise ValueError("termination cannot precede current boot observation")
        validate_sha256(self.execution_environment_termination_digest)
        if self.execution_environment_termination_digest != self.expected_digest():
            raise ValueError("executionEnvironmentTerminationDigest does not match")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "executionEnvironmentIdentity": self.execution_environment_identity.to_dict(),
            "terminationMethod": self.termination_method.value,
            "bootBoundaryAttestation": self.boot_boundary_attestation.to_dict(),
            "terminatedAt": self.terminated_at,
            "survivingProcessIdentities": [],
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_ENVIRONMENT_TERMINATION_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {
            **self._digest_payload(),
            "executionEnvironmentTerminationDigest": self.execution_environment_termination_digest,
        }

    @classmethod
    def create(
        cls,
        *,
        execution_environment_identity: LegacyClaimEnvironmentIdentity,
        boot_boundary_attestation: BootBoundaryAttestation,
        terminated_at: str,
    ) -> "LegacyEnvironmentTermination":
        values = {
            "execution_environment_identity": execution_environment_identity,
            "termination_method": ProofAdmissionTerminationMethod.BOOT_BOUNDARY_ATTESTED,
            "boot_boundary_attestation": boot_boundary_attestation,
            "terminated_at": terminated_at,
            "surviving_process_identities": (),
        }
        wire = {
            "executionEnvironmentIdentity": execution_environment_identity.to_dict(),
            "terminationMethod": ProofAdmissionTerminationMethod.BOOT_BOUNDARY_ATTESTED.value,
            "bootBoundaryAttestation": boot_boundary_attestation.to_dict(),
            "terminatedAt": terminated_at,
            "survivingProcessIdentities": [],
        }
        return cls(**values, execution_environment_termination_digest=domain_separated_sha256(_ENVIRONMENT_TERMINATION_DOMAIN, wire))

    @classmethod
    def from_dict(cls, value: object) -> "LegacyEnvironmentTermination":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        if not isinstance(data["survivingProcessIdentities"], list):
            raise ValueError("survivingProcessIdentities must be an array")
        return cls(
            execution_environment_identity=LegacyClaimEnvironmentIdentity.from_dict(data["executionEnvironmentIdentity"]),
            termination_method=_enum_from_wire(
                ProofAdmissionTerminationMethod,
                data["terminationMethod"],
                field="terminationMethod",
            ),
            boot_boundary_attestation=BootBoundaryAttestation.from_dict(data["bootBoundaryAttestation"]),
            terminated_at=data["terminatedAt"],
            surviving_process_identities=tuple(data["survivingProcessIdentities"]),
            execution_environment_termination_digest=data["executionEnvironmentTerminationDigest"],
        )


DarwinLegacyEnvironmentTermination = LegacyEnvironmentTermination
LinuxLegacyEnvironmentTermination = LegacyEnvironmentTermination


@dataclass(frozen=True)
class DarwinExecutionEnvironmentTermination:
    __slots__ = (
        "execution_environment_identity", "termination_method",
        "boot_boundary_attestation", "terminated_at",
        "surviving_process_identities", "execution_environment_termination_digest",
    )
    execution_environment_identity: DarwinProofAdmissionExecutionEnvironmentIdentity
    termination_method: ProofAdmissionTerminationMethod
    boot_boundary_attestation: BootBoundaryAttestation
    terminated_at: str
    surviving_process_identities: tuple[()]
    execution_environment_termination_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = LegacyEnvironmentTermination._WIRE_KEYS

    def __post_init__(self) -> None:
        if (
            not isinstance(
                self.execution_environment_identity,
                DarwinProofAdmissionExecutionEnvironmentIdentity,
            )
            or self.termination_method
            is not ProofAdmissionTerminationMethod.BOOT_BOUNDARY_ATTESTED
            or self.boot_boundary_attestation.os_family is not RuntimeOsFamily.DARWIN
            or self.surviving_process_identities != ()
        ):
            raise ValueError("Darwin termination branch is invalid")
        prior = self.boot_boundary_attestation.prior_observation
        environment = self.execution_environment_identity
        if (
            prior.host_identity != environment.host_identity
            or prior.observation_digest != environment.epoch_boot_observation_digest
            or prior.observation_id != environment.epoch_boot_observation_ref.observation_id
        ):
            raise ValueError("Darwin termination does not match environment boot")
        terminated_at = _canonical_utc_instant(
            self.terminated_at,
            field="terminatedAt",
        )
        if (
            _canonical_utc_instant(
                self.boot_boundary_attestation.current_observation.observed_at,
                field="observedAt",
            )
            > terminated_at
        ):
            raise ValueError("termination cannot precede current boot observation")
        validate_sha256(self.execution_environment_termination_digest)
        if self.execution_environment_termination_digest != self.expected_digest():
            raise ValueError("executionEnvironmentTerminationDigest does not match")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "executionEnvironmentIdentity": self.execution_environment_identity.to_dict(),
            "terminationMethod": self.termination_method.value,
            "bootBoundaryAttestation": self.boot_boundary_attestation.to_dict(),
            "terminatedAt": self.terminated_at,
            "survivingProcessIdentities": [],
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_ENVIRONMENT_TERMINATION_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "executionEnvironmentTerminationDigest": self.execution_environment_termination_digest}

    @classmethod
    def create(cls, **values: object) -> "DarwinExecutionEnvironmentTermination":
        values = {
            "termination_method": ProofAdmissionTerminationMethod.BOOT_BOUNDARY_ATTESTED,
            "surviving_process_identities": (),
            **values,
        }
        wire = {
            "executionEnvironmentIdentity": values["execution_environment_identity"].to_dict(),
            "terminationMethod": values["termination_method"].value,
            "bootBoundaryAttestation": values["boot_boundary_attestation"].to_dict(),
            "terminatedAt": values["terminated_at"],
            "survivingProcessIdentities": [],
        }
        return cls(**values, execution_environment_termination_digest=domain_separated_sha256(_ENVIRONMENT_TERMINATION_DOMAIN, wire))

    @classmethod
    def from_dict(cls, value: object) -> "DarwinExecutionEnvironmentTermination":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        if not isinstance(data["survivingProcessIdentities"], list):
            raise ValueError("survivingProcessIdentities must be an array")
        return cls(
            execution_environment_identity=DarwinProofAdmissionExecutionEnvironmentIdentity.from_dict(data["executionEnvironmentIdentity"]),
            termination_method=_enum_from_wire(
                ProofAdmissionTerminationMethod, data["terminationMethod"], field="terminationMethod"
            ),
            boot_boundary_attestation=BootBoundaryAttestation.from_dict(data["bootBoundaryAttestation"]),
            terminated_at=data["terminatedAt"],
            surviving_process_identities=tuple(data["survivingProcessIdentities"]),
            execution_environment_termination_digest=data["executionEnvironmentTerminationDigest"],
        )


@dataclass(frozen=True)
class LinuxExecutionEnvironmentTermination:
    __slots__ = (
        "execution_environment_identity", "termination_method",
        "namespace_termination_evidence", "boot_boundary_attestation",
        "surviving_process_identities", "terminated_at",
        "execution_environment_termination_digest",
    )
    execution_environment_identity: LinuxProofAdmissionExecutionEnvironmentIdentity
    termination_method: ProofAdmissionTerminationMethod
    namespace_termination_evidence: LinuxPidNamespaceTerminationEvidence | None
    boot_boundary_attestation: BootBoundaryAttestation | None
    surviving_process_identities: tuple[()]
    terminated_at: str
    execution_environment_termination_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "executionEnvironmentIdentity", "terminationMethod",
            "namespaceTerminationEvidence", "bootBoundaryAttestation",
            "survivingProcessIdentities", "terminatedAt",
            "executionEnvironmentTerminationDigest",
        }
    )

    def __post_init__(self) -> None:
        environment = self.execution_environment_identity
        if (
            not isinstance(environment, LinuxProofAdmissionExecutionEnvironmentIdentity)
            or self.surviving_process_identities != ()
        ):
            raise ValueError("Linux termination environment is invalid")
        if self.termination_method is ProofAdmissionTerminationMethod.PID_NAMESPACE_INIT_TERMINATED:
            evidence = self.namespace_termination_evidence
            if self.boot_boundary_attestation is not None or not isinstance(
                evidence, LinuxPidNamespaceTerminationEvidence
            ):
                raise ValueError("namespace termination branch is invalid")
            equality = (
                evidence.pidfd_owner_pid == environment.namespace_init_pidfd_owner_pid,
                evidence.pidfd_owner_process_start_identity
                == environment.namespace_init_pidfd_owner_process_start_identity,
                evidence.pid_namespace_device_id == environment.pid_namespace_device_id,
                evidence.pid_namespace_inode == environment.pid_namespace_inode,
                evidence.namespace_init_pid == environment.namespace_init_pid,
                evidence.namespace_init_process_start_identity
                == environment.namespace_init_process_start_identity,
                evidence.namespace_init_pidfd_lease_id
                == environment.namespace_init_pidfd_lease_id,
            )
            if not all(equality):
                raise ValueError("namespace termination does not match environment")
        elif self.termination_method is ProofAdmissionTerminationMethod.BOOT_BOUNDARY_ATTESTED:
            if self.namespace_termination_evidence is not None or not isinstance(
                self.boot_boundary_attestation, BootBoundaryAttestation
            ):
                raise ValueError("Linux boot termination branch is invalid")
            prior = self.boot_boundary_attestation.prior_observation
            if (
                self.boot_boundary_attestation.os_family is not RuntimeOsFamily.LINUX
                or prior.host_identity != environment.host_identity
                or prior.observation_digest != environment.epoch_boot_observation_digest
            ):
                raise ValueError("Linux boot termination does not match environment")
        else:
            raise ValueError("terminationMethod must be closed")
        _canonical_utc_instant(self.terminated_at, field="terminatedAt")
        validate_sha256(self.execution_environment_termination_digest)
        if self.execution_environment_termination_digest != self.expected_digest():
            raise ValueError("executionEnvironmentTerminationDigest does not match")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "executionEnvironmentIdentity": self.execution_environment_identity.to_dict(),
            "terminationMethod": self.termination_method.value,
            "namespaceTerminationEvidence": (
                None
                if self.namespace_termination_evidence is None
                else self.namespace_termination_evidence.to_dict()
            ),
            "bootBoundaryAttestation": (
                None
                if self.boot_boundary_attestation is None
                else self.boot_boundary_attestation.to_dict()
            ),
            "survivingProcessIdentities": [],
            "terminatedAt": self.terminated_at,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_ENVIRONMENT_TERMINATION_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "executionEnvironmentTerminationDigest": self.execution_environment_termination_digest}

    @classmethod
    def create(cls, **values: object) -> "LinuxExecutionEnvironmentTermination":
        values = {"surviving_process_identities": (), **values}
        wire = {
            "executionEnvironmentIdentity": values["execution_environment_identity"].to_dict(),
            "terminationMethod": values["termination_method"].value,
            "namespaceTerminationEvidence": (
                None
                if values["namespace_termination_evidence"] is None
                else values["namespace_termination_evidence"].to_dict()
            ),
            "bootBoundaryAttestation": (
                None
                if values["boot_boundary_attestation"] is None
                else values["boot_boundary_attestation"].to_dict()
            ),
            "survivingProcessIdentities": [],
            "terminatedAt": values["terminated_at"],
        }
        return cls(**values, execution_environment_termination_digest=domain_separated_sha256(_ENVIRONMENT_TERMINATION_DOMAIN, wire))

    @classmethod
    def from_dict(cls, value: object) -> "LinuxExecutionEnvironmentTermination":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        if not isinstance(data["survivingProcessIdentities"], list):
            raise ValueError("survivingProcessIdentities must be an array")
        namespace = data["namespaceTerminationEvidence"]
        attestation = data["bootBoundaryAttestation"]
        return cls(
            execution_environment_identity=LinuxProofAdmissionExecutionEnvironmentIdentity.from_dict(data["executionEnvironmentIdentity"]),
            termination_method=_enum_from_wire(
                ProofAdmissionTerminationMethod, data["terminationMethod"], field="terminationMethod"
            ),
            namespace_termination_evidence=(
                None if namespace is None else LinuxPidNamespaceTerminationEvidence.from_dict(namespace)
            ),
            boot_boundary_attestation=(
                None if attestation is None else BootBoundaryAttestation.from_dict(attestation)
            ),
            surviving_process_identities=tuple(data["survivingProcessIdentities"]),
            terminated_at=data["terminatedAt"],
            execution_environment_termination_digest=data["executionEnvironmentTerminationDigest"],
        )


ExecutionEnvironmentTermination = Union[
    DarwinExecutionEnvironmentTermination,
    LinuxExecutionEnvironmentTermination,
]


def execution_environment_termination_from_dict(
    value: object,
) -> ExecutionEnvironmentTermination:
    if not isinstance(value, Mapping):
        raise ValueError("ExecutionEnvironmentTermination must be an object")
    environment = value.get("executionEnvironmentIdentity")
    if not isinstance(environment, Mapping):
        raise ValueError("executionEnvironmentIdentity must be an object")
    if environment.get("osFamily") == RuntimeOsFamily.DARWIN.value:
        return DarwinExecutionEnvironmentTermination.from_dict(value)
    if environment.get("osFamily") == RuntimeOsFamily.LINUX.value:
        return LinuxExecutionEnvironmentTermination.from_dict(value)
    raise ValueError("execution environment termination OS is not closed")


PredecessorEnvironmentTermination = Union[
    LegacyEnvironmentTermination,
    DarwinExecutionEnvironmentTermination,
    LinuxExecutionEnvironmentTermination,
]


def predecessor_environment_termination_from_dict(
    value: object,
) -> PredecessorEnvironmentTermination:
    if not isinstance(value, Mapping):
        raise ValueError("predecessorEnvironmentTermination must be an object")
    environment = value.get("executionEnvironmentIdentity")
    if not isinstance(environment, Mapping):
        raise ValueError("executionEnvironmentIdentity must be an object")
    if environment.get("environmentKind") == "LEGACY_BOOT_SESSION":
        return LegacyEnvironmentTermination.from_dict(value)
    return execution_environment_termination_from_dict(value)


@dataclass(frozen=True)
class ProofAdmissionEpochRecord:
    __slots__ = (
        "artifact_kind", "schema_version", "workspace_id", "gate_id",
        "coordinator_epoch_id", "execution_environment_identity",
        "coordinator_pid", "coordinator_process_start_identity", "source_commit",
        "proof_admission_source_digest", "claim_admission_lock_identity",
        "claim_sequence_lock_identity", "previous_epoch_ref",
        "predecessor_environment_termination", "started_at", "epoch_digest",
    )
    artifact_kind: str
    schema_version: int
    workspace_id: str
    gate_id: str
    coordinator_epoch_id: str
    execution_environment_identity: ProofAdmissionExecutionEnvironmentIdentity
    coordinator_pid: int
    coordinator_process_start_identity: ProcessStartIdentity
    source_commit: str
    proof_admission_source_digest: str
    claim_admission_lock_identity: ProofAdmissionLockIdentity
    claim_sequence_lock_identity: ProofAdmissionLockIdentity
    previous_epoch_ref: ProofAdmissionEpochRef | None
    predecessor_environment_termination: PredecessorEnvironmentTermination
    started_at: str
    epoch_digest: str
    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "artifactKind", "schemaVersion", "workspaceId", "gateId",
            "coordinatorEpochId", "executionEnvironmentIdentity",
            "coordinatorPid", "coordinatorProcessStartIdentity", "sourceCommit",
            "proofAdmissionSourceDigest", "claimAdmissionLockIdentity",
            "claimSequenceLockIdentity", "previousEpochRef",
            "predecessorEnvironmentTermination", "startedAt", "epochDigest",
        }
    )

    def __post_init__(self) -> None:
        if self.artifact_kind != "acceptance-proof-admission-epoch":
            raise ValueError("artifactKind is invalid")
        if self.schema_version != 1 or isinstance(self.schema_version, bool):
            raise ValueError("schemaVersion must be 1")
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gate ID")
        _validate_non_empty_utf8(self.coordinator_epoch_id, field="coordinatorEpochId")
        environment = self.execution_environment_identity
        if type(environment) not in (
            DarwinProofAdmissionExecutionEnvironmentIdentity,
            LinuxProofAdmissionExecutionEnvironmentIdentity,
        ):
            raise ValueError("executionEnvironmentIdentity must be typed")
        _validate_positive_integer(self.coordinator_pid, field="coordinatorPid")
        if (
            self.coordinator_pid != environment.supervisor_pid
            or type(self.coordinator_process_start_identity)
            is not type(environment.supervisor_process_start_identity)
            or not _same_process_start_identity(
                self.coordinator_process_start_identity,
                environment.supervisor_process_start_identity,
            )
        ):
            raise ValueError("coordinator must be the execution environment supervisor")
        _validate_non_empty_utf8(self.source_commit, field="sourceCommit")
        validate_sha256(self.proof_admission_source_digest)
        if type(self.claim_admission_lock_identity) is not ProofAdmissionLockIdentity:
            raise ValueError("claimAdmissionLockIdentity must be typed")
        if type(self.claim_sequence_lock_identity) is not ProofAdmissionLockIdentity:
            raise ValueError("claimSequenceLockIdentity must be typed")
        predecessor = self.predecessor_environment_termination
        if _canonical_utc_instant(
            predecessor.terminated_at,
            field="terminatedAt",
        ) >= _canonical_utc_instant(self.started_at, field="startedAt"):
            raise ValueError(
                "predecessor termination must precede epoch start"
            )
        if self.previous_epoch_ref is None:
            if type(predecessor) is not LegacyEnvironmentTermination:
                raise ValueError("first epoch requires legacy predecessor termination")
            attestation = predecessor.boot_boundary_attestation
            if (
                predecessor.execution_environment_identity.os_family
                is not environment.os_family
                or predecessor.execution_environment_identity.host_identity
                != environment.host_identity
                or attestation.current_observation.observation_digest
                != environment.epoch_boot_observation_digest
                or attestation.current_observation.observation_id
                != environment.epoch_boot_observation_ref.observation_id
            ):
                raise ValueError("first epoch does not follow predecessor boot boundary")
            current_observation = attestation.current_observation
            if (
                isinstance(environment, DarwinProofAdmissionExecutionEnvironmentIdentity)
                and environment.supervisor_process_start_identity.boot_session_uuid
                != current_observation.boot_session_uuid
            ) or (
                isinstance(environment, LinuxProofAdmissionExecutionEnvironmentIdentity)
                and environment.supervisor_process_start_identity.boot_id
                != current_observation.boot_id
            ):
                raise ValueError("first epoch supervisor uses the wrong boot")
        else:
            if type(self.previous_epoch_ref) is not ProofAdmissionEpochRef:
                raise ValueError("previousEpochRef must be typed")
            if type(predecessor) not in (
                DarwinExecutionEnvironmentTermination,
                LinuxExecutionEnvironmentTermination,
            ):
                raise ValueError("later epoch cannot use a legacy predecessor")
            if (
                self.previous_epoch_ref.workspace_id != self.workspace_id
                or self.previous_epoch_ref.gate_id != self.gate_id
                or predecessor.execution_environment_identity.os_family
                is not environment.os_family
            ):
                raise ValueError("later epoch predecessor identity does not close")
            attestation = getattr(predecessor, "boot_boundary_attestation", None)
            if attestation is not None:
                current_observation = attestation.current_observation
                if (
                    current_observation.host_identity != environment.host_identity
                    or current_observation.observation_digest
                    != environment.epoch_boot_observation_digest
                    or current_observation.observation_id
                    != environment.epoch_boot_observation_ref.observation_id
                ):
                    raise ValueError("later epoch does not follow boot termination")
        _canonical_utc_instant(self.started_at, field="startedAt")
        validate_sha256(self.epoch_digest)
        if self.epoch_digest != self.expected_digest():
            raise ValueError("epochDigest does not match epoch record")

    def validate_previous_epoch(
        self,
        *,
        previous_epoch: ProofAdmissionEpochRecord | None,
    ) -> None:
        if self.previous_epoch_ref is None:
            if previous_epoch is not None:
                raise ValueError(
                    "first epoch cannot resolve a previous epoch"
                )
            return
        if type(previous_epoch) is not ProofAdmissionEpochRecord:
            raise ValueError(
                "later epoch requires the exact typed previous epoch"
            )
        predecessor_identity = (
            self.predecessor_environment_termination
            .execution_environment_identity
        )
        if (
            self.previous_epoch_ref.workspace_id
            != previous_epoch.workspace_id
            or self.previous_epoch_ref.gate_id != previous_epoch.gate_id
            or self.previous_epoch_ref.coordinator_epoch_id
            != previous_epoch.coordinator_epoch_id
            or self.previous_epoch_ref.epoch_digest
            != previous_epoch.epoch_digest
            or canonical_json_bytes(predecessor_identity.to_dict())
            != canonical_json_bytes(
                previous_epoch.execution_environment_identity.to_dict()
            )
        ):
            raise ValueError(
                "later epoch predecessor does not match previous epoch"
            )
        if _canonical_utc_instant(
            previous_epoch.started_at,
            field="startedAt",
        ) >= _canonical_utc_instant(
            self.predecessor_environment_termination.terminated_at,
            field="terminatedAt",
        ):
            raise ValueError(
                "predecessor termination must follow previous epoch start"
            )

    def _digest_payload(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind,
            "schemaVersion": self.schema_version,
            "workspaceId": self.workspace_id,
            "gateId": self.gate_id,
            "coordinatorEpochId": self.coordinator_epoch_id,
            "executionEnvironmentIdentity": self.execution_environment_identity.to_dict(),
            "coordinatorPid": self.coordinator_pid,
            "coordinatorProcessStartIdentity": self.coordinator_process_start_identity.to_dict(),
            "sourceCommit": self.source_commit,
            "proofAdmissionSourceDigest": self.proof_admission_source_digest,
            "claimAdmissionLockIdentity": self.claim_admission_lock_identity.to_dict(),
            "claimSequenceLockIdentity": self.claim_sequence_lock_identity.to_dict(),
            "previousEpochRef": (
                None if self.previous_epoch_ref is None else self.previous_epoch_ref.to_dict()
            ),
            "predecessorEnvironmentTermination": self.predecessor_environment_termination.to_dict(),
            "startedAt": self.started_at,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_EPOCH_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "epochDigest": self.epoch_digest}

    @classmethod
    def create(
        cls,
        *,
        previous_epoch: ProofAdmissionEpochRecord | None = None,
        **values: object,
    ) -> "ProofAdmissionEpochRecord":
        if (
            type(values.get("execution_environment_identity"))
            not in (
                DarwinProofAdmissionExecutionEnvironmentIdentity,
                LinuxProofAdmissionExecutionEnvironmentIdentity,
            )
            or type(values.get("coordinator_process_start_identity"))
            not in (
                DarwinProcessStartIdentity,
                LinuxProcessStartIdentity,
            )
            or type(values.get("claim_admission_lock_identity"))
            is not ProofAdmissionLockIdentity
            or type(values.get("claim_sequence_lock_identity"))
            is not ProofAdmissionLockIdentity
            or (
                values.get("previous_epoch_ref") is None
                and type(
                    values.get("predecessor_environment_termination")
                )
                is not LegacyEnvironmentTermination
            )
            or (
                values.get("previous_epoch_ref") is not None
                and (
                    type(values.get("previous_epoch_ref"))
                    is not ProofAdmissionEpochRef
                    or type(
                        values.get("predecessor_environment_termination")
                    )
                    not in (
                        DarwinExecutionEnvironmentTermination,
                        LinuxExecutionEnvironmentTermination,
                    )
                )
            )
        ):
            raise ValueError(
                "epoch inputs must use concrete contract types"
            )
        values = {
            "artifact_kind": "acceptance-proof-admission-epoch",
            "schema_version": 1,
            **values,
        }
        wire = {
            "artifactKind": values["artifact_kind"],
            "schemaVersion": 1,
            "workspaceId": values["workspace_id"],
            "gateId": values["gate_id"],
            "coordinatorEpochId": values["coordinator_epoch_id"],
            "executionEnvironmentIdentity": values["execution_environment_identity"].to_dict(),
            "coordinatorPid": values["coordinator_pid"],
            "coordinatorProcessStartIdentity": values["coordinator_process_start_identity"].to_dict(),
            "sourceCommit": values["source_commit"],
            "proofAdmissionSourceDigest": values["proof_admission_source_digest"],
            "claimAdmissionLockIdentity": values["claim_admission_lock_identity"].to_dict(),
            "claimSequenceLockIdentity": values["claim_sequence_lock_identity"].to_dict(),
            "previousEpochRef": (
                None if values["previous_epoch_ref"] is None else values["previous_epoch_ref"].to_dict()
            ),
            "predecessorEnvironmentTermination": values["predecessor_environment_termination"].to_dict(),
            "startedAt": values["started_at"],
        }
        epoch = cls(
            **values,
            epoch_digest=domain_separated_sha256(_EPOCH_DOMAIN, wire),
        )
        epoch.validate_previous_epoch(previous_epoch=previous_epoch)
        return epoch

    @classmethod
    def from_dict(
        cls,
        value: object,
        *,
        previous_epoch: ProofAdmissionEpochRecord | None = None,
    ) -> "ProofAdmissionEpochRecord":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        previous = data["previousEpochRef"]
        epoch = cls(
            artifact_kind=data["artifactKind"],
            schema_version=data["schemaVersion"],
            workspace_id=data["workspaceId"],
            gate_id=data["gateId"],
            coordinator_epoch_id=data["coordinatorEpochId"],
            execution_environment_identity=proof_admission_execution_environment_from_dict(data["executionEnvironmentIdentity"]),
            coordinator_pid=data["coordinatorPid"],
            coordinator_process_start_identity=process_start_identity_from_dict(data["coordinatorProcessStartIdentity"]),
            source_commit=data["sourceCommit"],
            proof_admission_source_digest=data["proofAdmissionSourceDigest"],
            claim_admission_lock_identity=ProofAdmissionLockIdentity.from_dict(data["claimAdmissionLockIdentity"]),
            claim_sequence_lock_identity=ProofAdmissionLockIdentity.from_dict(data["claimSequenceLockIdentity"]),
            previous_epoch_ref=None if previous is None else ProofAdmissionEpochRef.from_dict(previous),
            predecessor_environment_termination=predecessor_environment_termination_from_dict(data["predecessorEnvironmentTermination"]),
            started_at=data["startedAt"],
            epoch_digest=data["epochDigest"],
        )
        epoch.validate_previous_epoch(previous_epoch=previous_epoch)
        return epoch
