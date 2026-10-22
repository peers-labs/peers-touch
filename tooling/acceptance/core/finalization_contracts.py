"""Pure, closed contracts shared by D-19 finalization components."""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import math
import posixpath
import re
from dataclasses import dataclass, fields as dataclass_fields
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
_SOURCE_CAPTURE_DOMAIN = "pt.acceptance.finalization.source-capture.v1"
_SUPERVISOR_SOURCE_DOMAIN = (
    "pt.acceptance.finalization.supervisor-source.v1"
)
_STDLIB_CLOSURE_DOMAIN = "pt.acceptance.finalization.stdlib-closure.v1"
_COMPILER_FLAGS_DOMAIN = "pt.acceptance.finalization.compiler-flags.v1"
_PLATFORM_RUNTIME_DOMAIN = (
    "pt.acceptance.finalization.platform-runtime.v1"
)
_PREFLIGHT_PLATFORM_RUNTIME_DOMAIN = (
    "pt.acceptance.finalization.preflight-platform-runtime.v1"
)
_PREFLIGHT_RUNTIME_DOMAIN = "pt.acceptance.finalization.preflight-runtime.v1"
_RUNTIME_CAPTURE_DOMAIN = "pt.acceptance.finalization.runtime-capture.v1"
_AUTHORITY_RUNTIME_REF_DOMAIN = (
    "pt.acceptance.finalization.authority-runtime-ref.v1"
)
_MAINTENANCE_WORKER_SOURCE_DOMAIN = (
    "pt.acceptance.finalization.maintenance-worker-source.v1"
)
_MAINTENANCE_RUNTIME_DOMAIN = (
    "pt.acceptance.finalization.maintenance-runtime.v1"
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
_AUTHORITY_CONFIRMATION_DOMAIN = "pt.acceptance.finalization.authority-confirmation.v1"
_AUTHORITY_AUTHORIZATION_DOMAIN = "pt.acceptance.finalization.authority-authorization.v1"
_PUBLICATION_INTERLOCK_DOMAIN = "pt.acceptance.finalization.publication-interlock.v1"
_ACTIVATION_INTENT_DOMAIN = "pt.acceptance.finalization.activation-intent.v1"
_ACTIVATION_PENDING_DOMAIN = "pt.acceptance.finalization.activation-pending.v1"
_ENFORCEMENT_DOMAIN = "pt.acceptance.finalization.enforcement.v1"
_ABORT_CONFIRMATION_DOMAIN = "pt.acceptance.finalization.abort-confirmation.v1"
_ABORT_EVENT_DOMAIN = "pt.acceptance.finalization.abort-event.v1"
_ABORT_TOMBSTONE_IDENTITY_DOMAIN = (
    "pt.acceptance.finalization.abort-tombstone-identity.v1"
)
_ABORT_CONTINUATION_DOMAIN = (
    "pt.acceptance.finalization.abort-continuation.v1"
)
_ABORT_CONTROL_REF_DOMAIN = "pt.acceptance.finalization.abort-control-ref.v1"
_ABORT_DELETION_PLAN_DOMAIN = "pt.acceptance.finalization.abort-deletion-plan.v1"
_MAINTENANCE_RESULT_DOMAIN = "pt.acceptance.finalization.maintenance-result.v1"
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
_POWER_CONTROLLER_TRUST_ANCHOR_REF_DOMAIN = (
    "pt.acceptance.finalization.durability-power-controller-trust-anchor-ref.v1"
)
_POWER_CONTROLLER_TRUST_ANCHOR_DOMAIN = (
    "pt.acceptance.finalization.durability-power-controller-trust-anchor.v1"
)
_POWER_CONTROLLER_TRUST_GENERATION_REF_DOMAIN = (
    "pt.acceptance.finalization.durability-power-controller-trust-generation-ref.v1"
)
_POWER_CONTROLLER_TRUST_GENERATION_DOMAIN = (
    "pt.acceptance.finalization.durability-power-controller-trust-generation.v1"
)
_POWER_CONTROLLER_TRUST_CURRENT_DOMAIN = (
    "pt.acceptance.finalization.durability-power-controller-trust-current.v1"
)
_POWER_CONTROLLER_JOURNAL_DOMAIN = (
    "pt.acceptance.finalization.durability-power-controller-command-journal.v1"
)
_POWER_CONTROLLER_HEAD_DOMAIN = (
    "pt.acceptance.finalization.durability-power-controller-command-journal-head.v1"
)
_POWER_CONTROLLER_EPOCH_DOMAIN = (
    "pt.acceptance.finalization.durability-power-controller-runtime-epoch.v1"
)
_POWER_CONTROLLER_COMMAND_DOMAIN = (
    "pt.acceptance.finalization.durability-power-controller-command-identity.v1"
)
_POWER_CONTROLLER_REQUEST_DOMAIN = (
    "pt.acceptance.finalization.durability-power-controller-command-resolution-request.v1"
)
_POWER_CONTROLLER_LOCK_DOMAIN = (
    "pt.acceptance.finalization.durability-power-controller-command-journal-lock.v1"
)
_POWER_CONTROLLER_JOURNAL_SIGNATURE_DOMAIN = (
    "pt.acceptance.finalization.durability-power-controller-command-journal-signature.v1"
)
_POWER_CONTROLLER_EPOCH_SIGNATURE_DOMAIN = (
    "pt.acceptance.finalization.durability-power-controller-runtime-epoch-signature.v1"
)
_CONTROLLER_WITNESS_DOMAIN = (
    "pt.acceptance.finalization.durability-power-controller-store-witness.v1"
)
_CONTROLLER_WITNESS_AUTHORIZATION_DOMAIN = (
    "pt.acceptance.finalization.durability-power-controller-store-witness-authorization.v1"
)
_CONTROLLER_WITNESS_AUTHORIZATION_ID_DOMAIN = (
    "pt.acceptance.finalization.durability-power-controller-store-witness-authorization-id.v1"
)
_CONTROLLER_WITNESS_CONFIRMATION_DOMAIN = (
    "pt.acceptance.finalization.durability-power-controller-store-witness-confirmation.v1"
)
_GATE_PUBLISH_LOCK_IDENTITY_DOMAIN = (
    "pt.acceptance.finalization.gate-publish-lock-identity.v1"
)
_TRUST_DISPATCH_LEASE_DOMAIN = (
    "pt.acceptance.finalization.trust-dispatch-lease.v1"
)
_DURABILITY_PROBE_RUNTIME_DOMAIN = (
    "pt.acceptance.finalization.durability-probe-runtime.v1"
)
_DURABILITY_PROBE_SOURCE_DOMAIN = (
    "pt.acceptance.finalization.durability-probe-source.v1"
)
_DURABILITY_CAPABILITY_EVIDENCE_DOMAIN = (
    "pt.acceptance.finalization.durability-capability-evidence.v1"
)
_DURABILITY_PROFILE_DOMAIN = {
    "LINUX": "pt.acceptance.finalization.durability-profile.linux.v1",
    "DARWIN": "pt.acceptance.finalization.durability-profile.darwin.v1",
}
_DESCRIPTOR_OWNER_DOMAIN = (
    "pt.acceptance.finalization.descriptor-owner-binding.v1"
)
_DESCRIPTOR_CLAIM_DOMAIN = "pt.acceptance.finalization.descriptor-claim.v1"
_WORKER_REQUEST_IDENTITY_DOMAIN = (
    "pt.acceptance.finalization.worker-request-identity.v1"
)
_WORKER_REQUEST_DOMAIN = "pt.acceptance.finalization.worker-request.v1"
_WORKER_RESULT_DOMAIN = "pt.acceptance.finalization.worker-result.v1"
_SUPERVISOR_CONTROL_FRAME_DOMAIN = (
    "pt.acceptance.finalization.supervisor-control-frame.v1"
)

FINALIZER_BOOTSTRAP_SOURCE_PATHS = (
    "tooling/acceptance/core/finalization_contracts.py",
    "tooling/acceptance/core/finalization_supervisor.c",
    "tooling/acceptance/core/finalizer_worker.py",
    "tooling/acceptance/core/result_contracts.py",
)

_SUPPORTED_DIGEST_DOMAINS = frozenset(
    {
        _WORKER_REQUEST_DOMAIN,
        _PREFLIGHT_PLATFORM_RUNTIME_DOMAIN,
        _PREFLIGHT_RUNTIME_DOMAIN,
        _RUNTIME_CAPTURE_DOMAIN,
        _AUTHORITY_RUNTIME_REF_DOMAIN,
        _MAINTENANCE_WORKER_SOURCE_DOMAIN,
        _MAINTENANCE_RUNTIME_DOMAIN,
        _WORKER_RESULT_DOMAIN,
        _SUPERVISOR_CONTROL_FRAME_DOMAIN,
        _DESCRIPTOR_OWNER_DOMAIN,
        _DESCRIPTOR_CLAIM_DOMAIN,
        _WORKER_REQUEST_IDENTITY_DOMAIN,
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
        _SOURCE_CAPTURE_DOMAIN,
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
        _AUTHORITY_CONFIRMATION_DOMAIN,
        _AUTHORITY_AUTHORIZATION_DOMAIN,
        _PUBLICATION_INTERLOCK_DOMAIN,
        _ACTIVATION_INTENT_DOMAIN,
        _ACTIVATION_PENDING_DOMAIN,
        _ENFORCEMENT_DOMAIN,
        _ABORT_CONFIRMATION_DOMAIN,
        _ABORT_EVENT_DOMAIN,
        _ABORT_TOMBSTONE_IDENTITY_DOMAIN,
        _ABORT_CONTINUATION_DOMAIN,
        _ABORT_CONTROL_REF_DOMAIN,
        _ABORT_DELETION_PLAN_DOMAIN,
        _MAINTENANCE_RESULT_DOMAIN,
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
        _POWER_CONTROLLER_TRUST_ANCHOR_REF_DOMAIN,
        _POWER_CONTROLLER_TRUST_ANCHOR_DOMAIN,
        _POWER_CONTROLLER_TRUST_GENERATION_REF_DOMAIN,
        _POWER_CONTROLLER_TRUST_GENERATION_DOMAIN,
        _POWER_CONTROLLER_TRUST_CURRENT_DOMAIN,
        _POWER_CONTROLLER_JOURNAL_DOMAIN,
        _POWER_CONTROLLER_HEAD_DOMAIN,
        _POWER_CONTROLLER_EPOCH_DOMAIN,
        _POWER_CONTROLLER_COMMAND_DOMAIN,
        _POWER_CONTROLLER_REQUEST_DOMAIN,
        _POWER_CONTROLLER_LOCK_DOMAIN,
        _POWER_CONTROLLER_JOURNAL_SIGNATURE_DOMAIN,
        _POWER_CONTROLLER_EPOCH_SIGNATURE_DOMAIN,
        _CONTROLLER_WITNESS_DOMAIN,
        _CONTROLLER_WITNESS_AUTHORIZATION_DOMAIN,
        _CONTROLLER_WITNESS_AUTHORIZATION_ID_DOMAIN,
        _CONTROLLER_WITNESS_CONFIRMATION_DOMAIN,
        _GATE_PUBLISH_LOCK_IDENTITY_DOMAIN,
        _TRUST_DISPATCH_LEASE_DOMAIN,
        _DURABILITY_PROBE_RUNTIME_DOMAIN,
        _DURABILITY_PROBE_SOURCE_DOMAIN,
        _DURABILITY_CAPABILITY_EVIDENCE_DOMAIN,
        *_DURABILITY_PROFILE_DOMAIN.values(),
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


class FinalizationReservationState(str, Enum):
    READY = "READY"
    INVOCATION_STARTED = "INVOCATION_STARTED"
    OUTCOME_CACHED = "OUTCOME_CACHED"
    MANIFEST_PREPARED = "MANIFEST_PREPARED"
    MANIFEST_DURABLE = "MANIFEST_DURABLE"
    LATEST_RESOLVED = "LATEST_RESOLVED"


class FinalizationLatestDisposition(str, Enum):
    PUBLISHED = "PUBLISHED"
    ALREADY_CURRENT = "ALREADY_CURRENT"
    SUPERSEDED = "SUPERSEDED"


class ProtectedSourceComponent(str, Enum):
    PROTECTED_BASELINE = "PROTECTED_BASELINE"
    REQUIRED_MAPPING = "REQUIRED_MAPPING"
    REGISTRATION_CATALOG = "REGISTRATION_CATALOG"
    CONTRACT_SCHEMA = "CONTRACT_SCHEMA"
    ENTRYPOINT_SOURCE = "ENTRYPOINT_SOURCE"
    GENERATOR_SOURCE = "GENERATOR_SOURCE"
    CORE_CONTRACTS = "CORE_CONTRACTS"
    CORE_WORKER_BOOTSTRAP = "CORE_WORKER_BOOTSTRAP"
    SUPERVISOR_SOURCE = "SUPERVISOR_SOURCE"
    CORE_RESULT_CONTRACTS = "CORE_RESULT_CONTRACTS"


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


class RuntimePathKind(str, Enum):
    SUPERVISOR_BINARY = "SUPERVISOR_BINARY"
    PYTHON_EXECUTABLE = "PYTHON_EXECUTABLE"
    COMPILER_BINARY = "COMPILER_BINARY"
    STDLIB_MODULE = "STDLIB_MODULE"


class ArtifactPayloadKind(str, Enum):
    CANONICAL_JSON = "CANONICAL_JSON"
    BINARY = "BINARY"


class DescriptorRole(str, Enum):
    GATE_DIRECTORY = "GATE_DIRECTORY"
    RUN_DIRECTORY = "RUN_DIRECTORY"
    REPOSITORY_ROOT = "REPOSITORY_ROOT"
    TEMPORARY_DIRECTORY = "TEMPORARY_DIRECTORY"


class WorkerKind(str, Enum):
    AUTHORITY_RUNTIME_PERSISTER = "AUTHORITY_RUNTIME_PERSISTER"
    MAINTENANCE = "MAINTENANCE"
    BUNDLE_PREPARER = "BUNDLE_PREPARER"
    RUNTIME_CAPTURE = "RUNTIME_CAPTURE"
    MATERIALIZER = "MATERIALIZER"
    FINALIZER = "FINALIZER"


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
class GateDirectoryOwnerBinding:
    workspace_id: str
    gate_id: str
    role: ClassVar[DescriptorRole] = DescriptorRole.GATE_DIRECTORY

    def __post_init__(self) -> None:
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gateId")

    def to_dict(self) -> dict[str, object]:
        return {
            "role": self.role.value,
            "workspaceId": self.workspace_id,
            "gateId": self.gate_id,
        }


@dataclass(frozen=True)
class RunDirectoryOwnerBinding:
    workspace_id: str
    gate_id: str
    evidence_run_id: str
    role: ClassVar[DescriptorRole] = DescriptorRole.RUN_DIRECTORY

    def __post_init__(self) -> None:
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gateId")
        _validate_run_id(self.evidence_run_id, field="evidenceRunId")

    def to_dict(self) -> dict[str, object]:
        return {
            "role": self.role.value,
            "workspaceId": self.workspace_id,
            "gateId": self.gate_id,
            "evidenceRunId": self.evidence_run_id,
        }


@dataclass(frozen=True)
class RepositoryRootOwnerBinding:
    workspace_id: str
    source_commit: str
    workspace_digest: str
    canonical_worktree_hash: str
    role: ClassVar[DescriptorRole] = DescriptorRole.REPOSITORY_ROOT

    def __post_init__(self) -> None:
        _validate_workspace_id(self.workspace_id)
        _validate_non_empty_utf8(self.source_commit, field="sourceCommit")
        validate_sha256(self.workspace_digest)
        validate_sha256(self.canonical_worktree_hash)

    def to_dict(self) -> dict[str, object]:
        return {
            "role": self.role.value,
            "workspaceId": self.workspace_id,
            "sourceCommit": self.source_commit,
            "workspaceDigest": self.workspace_digest,
            "canonicalWorktreeHash": self.canonical_worktree_hash,
        }


@dataclass(frozen=True)
class TemporaryDirectoryOwnerBinding:
    supervisor_session_id: str
    request_id: str
    temp_nonce: str
    role: ClassVar[DescriptorRole] = DescriptorRole.TEMPORARY_DIRECTORY

    def __post_init__(self) -> None:
        for field, value in (
            ("supervisorSessionId", self.supervisor_session_id),
            ("requestId", self.request_id),
            ("tempNonce", self.temp_nonce),
        ):
            _validate_non_empty_utf8(value, field=field, maximum_bytes=256)

    def to_dict(self) -> dict[str, object]:
        return {
            "role": self.role.value,
            "supervisorSessionId": self.supervisor_session_id,
            "requestId": self.request_id,
            "tempNonce": self.temp_nonce,
        }


DescriptorOwnerBinding = Union[
    GateDirectoryOwnerBinding,
    RunDirectoryOwnerBinding,
    RepositoryRootOwnerBinding,
    TemporaryDirectoryOwnerBinding,
]
_DESCRIPTOR_OWNER_TYPES = (
    GateDirectoryOwnerBinding,
    RunDirectoryOwnerBinding,
    RepositoryRootOwnerBinding,
    TemporaryDirectoryOwnerBinding,
)


def descriptor_owner_binding_from_dict(value: object) -> DescriptorOwnerBinding:
    """Select a closed owner branch before interpreting descriptor identity."""
    if not isinstance(value, Mapping):
        raise ValueError("descriptor owner binding must be an object")
    branches = {
        DescriptorRole.GATE_DIRECTORY.value: (
            GateDirectoryOwnerBinding,
            ("workspaceId", "gateId"),
        ),
        DescriptorRole.RUN_DIRECTORY.value: (
            RunDirectoryOwnerBinding,
            ("workspaceId", "gateId", "evidenceRunId"),
        ),
        DescriptorRole.REPOSITORY_ROOT.value: (
            RepositoryRootOwnerBinding,
            ("workspaceId", "sourceCommit", "workspaceDigest", "canonicalWorktreeHash"),
        ),
        DescriptorRole.TEMPORARY_DIRECTORY.value: (
            TemporaryDirectoryOwnerBinding,
            ("supervisorSessionId", "requestId", "tempNonce"),
        ),
    }
    role = value.get("role")
    if not isinstance(role, str) or role not in branches:
        raise ValueError("unknown descriptor owner role")
    owner_type, fields = branches[role]
    data = _closed_mapping(
        value,
        schema=owner_type.__name__,
        keys=frozenset(("role", *fields)),
    )
    return owner_type(*(data[field] for field in fields))


@dataclass(frozen=True)
class DescriptorClaim:
    role: DescriptorRole
    device_id: str
    inode: str
    owner_binding: DescriptorOwnerBinding
    owner_binding_digest: str
    descriptor_claim_digest: str
    file_type: str = "DIRECTORY"

    def __post_init__(self) -> None:
        if type(self.role) is not DescriptorRole:
            raise ValueError("descriptor role must be closed")
        if type(self.owner_binding) not in _DESCRIPTOR_OWNER_TYPES:
            raise ValueError("descriptor owner must use a concrete branch")
        if self.owner_binding.role is not self.role:
            raise ValueError("descriptor role does not match owner binding")
        if self.file_type != "DIRECTORY":
            raise ValueError("descriptor fileType must be DIRECTORY")
        for field, value in (("deviceId", self.device_id), ("inode", self.inode)):
            if (
                not isinstance(value, str)
                or re.fullmatch(r"0|[1-9][0-9]{0,19}", value) is None
                or int(value) > 18446744073709551615
            ):
                raise ValueError(f"{field} must be a canonical UInt64String")
        expected_owner = domain_separated_sha256(
            _DESCRIPTOR_OWNER_DOMAIN, self.owner_binding.to_dict()
        )
        if self.owner_binding_digest != expected_owner:
            raise ValueError("ownerBindingDigest mismatch")
        validate_sha256(self.descriptor_claim_digest)
        if self.descriptor_claim_digest != domain_separated_sha256(
            _DESCRIPTOR_CLAIM_DOMAIN, self._digest_payload()
        ):
            raise ValueError("descriptorClaimDigest mismatch")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "role": self.role.value,
            "deviceId": self.device_id,
            "inode": self.inode,
            "fileType": self.file_type,
            "ownerBinding": self.owner_binding.to_dict(),
            "ownerBindingDigest": self.owner_binding_digest,
        }

    def to_dict(self) -> dict[str, object]:
        return {
            **self._digest_payload(),
            "descriptorClaimDigest": self.descriptor_claim_digest,
        }

    @classmethod
    def create(
        cls,
        *,
        device_id: str,
        inode: str,
        owner_binding: DescriptorOwnerBinding,
    ) -> "DescriptorClaim":
        if type(owner_binding) not in _DESCRIPTOR_OWNER_TYPES:
            raise ValueError("descriptor owner must use a concrete branch")
        owner_digest = domain_separated_sha256(
            _DESCRIPTOR_OWNER_DOMAIN, owner_binding.to_dict()
        )
        payload = {
            "role": owner_binding.role.value,
            "deviceId": device_id,
            "inode": inode,
            "fileType": "DIRECTORY",
            "ownerBinding": owner_binding.to_dict(),
            "ownerBindingDigest": owner_digest,
        }
        return cls(
            role=owner_binding.role,
            device_id=device_id,
            inode=inode,
            owner_binding=owner_binding,
            owner_binding_digest=owner_digest,
            descriptor_claim_digest=domain_separated_sha256(
                _DESCRIPTOR_CLAIM_DOMAIN, payload
            ),
        )

    @classmethod
    def from_dict(cls, value: object) -> "DescriptorClaim":
        data = _closed_mapping(
            value,
            schema=cls.__name__,
            keys=frozenset(
                {
                    "role", "deviceId", "inode", "fileType", "ownerBinding",
                    "ownerBindingDigest", "descriptorClaimDigest",
                }
            ),
        )
        return cls(
            role=_enum_from_wire(DescriptorRole, data["role"], field="role"),
            device_id=data["deviceId"],
            inode=data["inode"],
            file_type=data["fileType"],
            owner_binding=descriptor_owner_binding_from_dict(data["ownerBinding"]),
            owner_binding_digest=data["ownerBindingDigest"],
            descriptor_claim_digest=data["descriptorClaimDigest"],
        )


def worker_descriptor_roles(kind: WorkerKind) -> tuple[DescriptorRole, ...]:
    if type(kind) is not WorkerKind:
        raise ValueError("workerKind must be closed")
    return _WORKER_CONTRACT_MATRIX[kind][2]


@dataclass(frozen=True)
class WorkerRequestIdentity:
    supervisor_session_id: str
    request_id: str
    sequence: int
    worker_kind: WorkerKind
    descriptor_claims: tuple[DescriptorClaim, ...]
    request_payload_digest: str
    request_identity_digest: str

    def __post_init__(self) -> None:
        _validate_non_empty_utf8(
            self.supervisor_session_id, field="supervisorSessionId", maximum_bytes=256
        )
        _validate_non_empty_utf8(
            self.request_id, field="requestId", maximum_bytes=256
        )
        _validate_positive_integer(self.sequence, field="sequence")
        if self.sequence > _I_JSON_INTEGER_MAX:
            raise ValueError("sequence exceeds I-JSON range")
        expected_roles = worker_descriptor_roles(self.worker_kind)
        if (
            type(self.descriptor_claims) is not tuple
            or any(type(claim) is not DescriptorClaim for claim in self.descriptor_claims)
            or tuple(claim.role for claim in self.descriptor_claims) != expected_roles
        ):
            raise ValueError("descriptor claims do not match ordered worker roles")
        identities = tuple(
            (claim.device_id, claim.inode) for claim in self.descriptor_claims
        )
        if len(set(identities)) != len(identities):
            raise ValueError("descriptor claims must identify distinct directories")
        for claim in self.descriptor_claims:
            if type(claim.owner_binding) is TemporaryDirectoryOwnerBinding:
                if (
                    claim.owner_binding.supervisor_session_id != self.supervisor_session_id
                    or claim.owner_binding.request_id != self.request_id
                ):
                    raise ValueError("temporary descriptor belongs to another request")
        validate_sha256(self.request_payload_digest)
        validate_sha256(self.request_identity_digest)
        if self.request_identity_digest != domain_separated_sha256(
            _WORKER_REQUEST_IDENTITY_DOMAIN, self._digest_payload()
        ):
            raise ValueError("requestIdentityDigest mismatch")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "supervisorSessionId": self.supervisor_session_id,
            "requestId": self.request_id,
            "sequence": self.sequence,
            "workerKind": self.worker_kind.value,
            "descriptorClaims": [claim.to_dict() for claim in self.descriptor_claims],
            "requestPayloadDigest": self.request_payload_digest,
        }

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "requestIdentityDigest": self.request_identity_digest}

    @classmethod
    def create(
        cls,
        *,
        supervisor_session_id: str,
        request_id: str,
        sequence: int,
        worker_kind: WorkerKind,
        descriptor_claims: tuple[DescriptorClaim, ...],
        request_payload_digest: str,
    ) -> "WorkerRequestIdentity":
        if type(worker_kind) is not WorkerKind or type(descriptor_claims) is not tuple:
            raise ValueError("worker identity requires concrete contract types")
        if any(type(claim) is not DescriptorClaim for claim in descriptor_claims):
            raise ValueError("descriptor claims must use concrete contracts")
        payload = {
            "supervisorSessionId": supervisor_session_id,
            "requestId": request_id,
            "sequence": sequence,
            "workerKind": worker_kind.value,
            "descriptorClaims": [claim.to_dict() for claim in descriptor_claims],
            "requestPayloadDigest": request_payload_digest,
        }
        return cls(
            supervisor_session_id=supervisor_session_id,
            request_id=request_id,
            sequence=sequence,
            worker_kind=worker_kind,
            descriptor_claims=descriptor_claims,
            request_payload_digest=request_payload_digest,
            request_identity_digest=domain_separated_sha256(
                _WORKER_REQUEST_IDENTITY_DOMAIN, payload
            ),
        )

    @classmethod
    def from_dict(cls, value: object) -> "WorkerRequestIdentity":
        data = _closed_mapping(
            value,
            schema=cls.__name__,
            keys=frozenset(
                {
                    "supervisorSessionId", "requestId", "sequence", "workerKind",
                    "descriptorClaims", "requestPayloadDigest", "requestIdentityDigest",
                }
            ),
        )
        if type(data["descriptorClaims"]) is not list or len(data["descriptorClaims"]) > 2:
            raise ValueError("descriptorClaims must be a bounded wire array")
        return cls(
            supervisor_session_id=data["supervisorSessionId"],
            request_id=data["requestId"],
            sequence=data["sequence"],
            worker_kind=_enum_from_wire(WorkerKind, data["workerKind"], field="workerKind"),
            descriptor_claims=tuple(
                DescriptorClaim.from_dict(claim) for claim in data["descriptorClaims"]
            ),
            request_payload_digest=data["requestPayloadDigest"],
            request_identity_digest=data["requestIdentityDigest"],
        )


@dataclass(frozen=True)
class PrepareBundleRequest:
    identity: WorkerRequestIdentity
    source_inventory: tuple[tuple[str, str], ...]
    entrypoint: str
    file_limit: int = 64
    path_byte_limit: int = 512
    manifest_byte_limit: int = 256 * 1024
    entry_byte_limit: int = 8 * 1024 * 1024
    bundle_byte_limit: int = 64 * 1024 * 1024
    expanded_byte_limit: int = 64 * 1024 * 1024
    temporary_storage_byte_limit: int = 128 * 1024 * 1024
    timeout_seconds: int = 60

    def __post_init__(self) -> None:
        _validate_file_identity_tuple(self.source_inventory, field="sourceInventory")
        _validate_entrypoint(self.entrypoint)
        limits = (
            ("fileLimit", self.file_limit, 64),
            ("pathByteLimit", self.path_byte_limit, 512),
            ("manifestByteLimit", self.manifest_byte_limit, 256 * 1024),
            ("entryByteLimit", self.entry_byte_limit, 8 * 1024 * 1024),
            ("bundleByteLimit", self.bundle_byte_limit, 64 * 1024 * 1024),
            ("expandedByteLimit", self.expanded_byte_limit, 64 * 1024 * 1024),
            ("temporaryStorageByteLimit", self.temporary_storage_byte_limit, 128 * 1024 * 1024),
            ("timeoutSeconds", self.timeout_seconds, 60),
        )
        for field, value, expected in limits:
            if type(value) is not int or value != expected:
                raise ValueError(f"{field} must equal the fixed bundle limit {expected}")
        if len(self.source_inventory) > self.file_limit:
            raise ValueError("sourceInventory exceeds fileLimit")
        if len(canonical_json_bytes(self._payload())) > self.manifest_byte_limit:
            raise ValueError("sourceInventory exceeds manifestByteLimit")
        _validate_worker_request_binding(
            self.identity, WorkerKind.BUNDLE_PREPARER, self._payload()
        )

    def _payload(self) -> dict[str, object]:
        return {
            "sourceInventory": [list(item) for item in self.source_inventory],
            "entrypoint": self.entrypoint,
            "fileLimit": self.file_limit,
            "pathByteLimit": self.path_byte_limit,
            "manifestByteLimit": self.manifest_byte_limit,
            "entryByteLimit": self.entry_byte_limit,
            "bundleByteLimit": self.bundle_byte_limit,
            "expandedByteLimit": self.expanded_byte_limit,
            "temporaryStorageByteLimit": self.temporary_storage_byte_limit,
            "timeoutSeconds": self.timeout_seconds,
        }

    def to_dict(self) -> dict[str, object]:
        return {"identity": self.identity.to_dict(), **self._payload()}

    @classmethod
    def from_dict(cls, value: object) -> "PrepareBundleRequest":
        fields = (
            "fileLimit", "pathByteLimit", "manifestByteLimit", "entryByteLimit",
            "bundleByteLimit", "expandedByteLimit", "temporaryStorageByteLimit",
            "timeoutSeconds",
        )
        data = _closed_mapping(
            value, schema=cls.__name__,
            keys=frozenset(("identity", "sourceInventory", "entrypoint", *fields)),
        )
        inventory = data["sourceInventory"]
        if type(inventory) is not list or len(inventory) > 64:
            raise ValueError("sourceInventory must be a bounded array")
        return cls(
            WorkerRequestIdentity.from_dict(data["identity"]),
            _file_identity_tuple_from_wire(inventory, field="sourceInventory"),
            data["entrypoint"],
            *(data[field] for field in fields),
        )


def _validate_worker_request_binding(
    identity: object, kind: WorkerKind, payload: dict[str, object]
) -> None:
    if type(identity) is not WorkerRequestIdentity or identity.worker_kind is not kind:
        raise ValueError("request does not match its worker-kind identity")
    if identity.request_payload_digest != domain_separated_sha256(
        _WORKER_REQUEST_DOMAIN, payload
    ):
        raise ValueError("requestPayloadDigest mismatch")


@dataclass(frozen=True)
class BundlePreparationCompleted:
    identity: WorkerRequestIdentity
    capture_id: str
    source_capture_bundle_digest: str
    expanded_inventory: tuple[tuple[str, str, int], ...]
    worker_result_digest: str
    status: ClassVar[str] = "COMPLETED"

    def __post_init__(self) -> None:
        if (
            type(self.identity) is not WorkerRequestIdentity
            or self.identity.worker_kind is not WorkerKind.BUNDLE_PREPARER
        ):
            raise ValueError("bundle result must match BUNDLE_PREPARER")
        _validate_non_empty_utf8(self.capture_id, field="captureId", maximum_bytes=256)
        validate_sha256(self.source_capture_bundle_digest)
        if type(self.expanded_inventory) is not tuple or not 1 <= len(self.expanded_inventory) <= 64:
            raise ValueError("expandedInventory must contain 1..64 immutable entries")
        paths = []
        cumulative = 0
        for item in self.expanded_inventory:
            if type(item) is not tuple or len(item) != 3:
                raise ValueError("expandedInventory entries must be immutable triples")
            paths.append(validate_repo_relative_path(item[0]))
            validate_sha256(item[1])
            if type(item[2]) is not int or not 0 <= item[2] <= 8 * 1024 * 1024:
                raise ValueError("expandedInventory byteLength exceeds entry limit")
            cumulative += item[2]
        if paths != sorted(set(paths), key=lambda path: path.encode("utf-8")):
            raise ValueError("expandedInventory must have unique UTF-8 sorted paths")
        if cumulative > 64 * 1024 * 1024:
            raise ValueError("expandedInventory exceeds expanded byte limit")
        if self.worker_result_digest != domain_separated_sha256(
            _WORKER_RESULT_DOMAIN, self._payload()
        ):
            raise ValueError("workerResultDigest mismatch")

    def _payload(self) -> dict[str, object]:
        return {
            "identity": self.identity.to_dict(),
            "status": self.status,
            "captureId": self.capture_id,
            "sourceCaptureBundleDigest": self.source_capture_bundle_digest,
            "expandedInventory": [list(item) for item in self.expanded_inventory],
            "failureCode": None,
            "diagnostic": None,
        }

    def to_dict(self) -> dict[str, object]:
        return {**self._payload(), "workerResultDigest": self.worker_result_digest}

    @classmethod
    def from_dict(cls, value: object) -> "BundlePreparationCompleted":
        data = _closed_mapping(
            value, schema=cls.__name__, keys=_BUNDLE_RESULT_KEYS
        )
        if data["status"] != "COMPLETED" or data["failureCode"] is not None or data["diagnostic"] is not None:
            raise ValueError("completed bundle result has invalid branch fields")
        inventory = data["expandedInventory"]
        if type(inventory) is not list or not 1 <= len(inventory) <= 64:
            raise ValueError("expandedInventory must be a bounded wire array")
        if any(type(item) is not list or len(item) != 3 for item in inventory):
            raise ValueError("expandedInventory entries must be three-element arrays")
        return cls(
            WorkerRequestIdentity.from_dict(data["identity"]),
            data["captureId"], data["sourceCaptureBundleDigest"],
            tuple(tuple(item) for item in inventory),
            data["workerResultDigest"],
        )


_BUNDLE_RESULT_KEYS = frozenset({
    "identity", "status", "captureId", "sourceCaptureBundleDigest",
    "expandedInventory", "workerResultDigest", "failureCode", "diagnostic",
})


@dataclass(frozen=True)
class BundlePreparationFailed:
    identity: WorkerRequestIdentity
    failure_code: FinalizerFailureCode
    diagnostic: str
    worker_result_digest: str
    status: ClassVar[str] = "FAILED"

    def __post_init__(self) -> None:
        if (
            type(self.identity) is not WorkerRequestIdentity
            or self.identity.worker_kind is not WorkerKind.BUNDLE_PREPARER
        ):
            raise ValueError("bundle result must match BUNDLE_PREPARER")
        if type(self.failure_code) is not FinalizerFailureCode or self.failure_code not in (
            FinalizerFailureCode.BUNDLE_INVALID, FinalizerFailureCode.TIMED_OUT,
            FinalizerFailureCode.PROCESS_FAILED,
        ):
            raise ValueError("failureCode is outside the bundle failure branch")
        _validate_non_empty_utf8(self.diagnostic, field="diagnostic", maximum_bytes=4096)
        if self.worker_result_digest != domain_separated_sha256(
            _WORKER_RESULT_DOMAIN, self._payload()
        ):
            raise ValueError("workerResultDigest mismatch")

    def _payload(self) -> dict[str, object]:
        return {
            "identity": self.identity.to_dict(), "status": self.status,
            "captureId": None, "sourceCaptureBundleDigest": None,
            "expandedInventory": [], "failureCode": self.failure_code.value,
            "diagnostic": self.diagnostic,
        }

    def to_dict(self) -> dict[str, object]:
        return {**self._payload(), "workerResultDigest": self.worker_result_digest}

    @classmethod
    def from_dict(cls, value: object) -> "BundlePreparationFailed":
        data = _closed_mapping(value, schema=cls.__name__, keys=_BUNDLE_RESULT_KEYS)
        if (
            data["status"] != "FAILED" or data["captureId"] is not None
            or data["sourceCaptureBundleDigest"] is not None
            or type(data["expandedInventory"]) is not list
            or data["expandedInventory"]
        ):
            raise ValueError("failed bundle result has invalid branch fields")
        return cls(
            WorkerRequestIdentity.from_dict(data["identity"]),
            _enum_from_wire(FinalizerFailureCode, data["failureCode"], field="failureCode"),
            data["diagnostic"], data["workerResultDigest"],
        )


def bundle_preparation_result_from_dict(
    value: object, request: PrepareBundleRequest
) -> Union[BundlePreparationCompleted, BundlePreparationFailed]:
    if type(request) is not PrepareBundleRequest or not isinstance(value, Mapping):
        raise ValueError("bundle result requires its concrete request")
    if value.get("status") == "COMPLETED":
        result = BundlePreparationCompleted.from_dict(value)
    elif value.get("status") == "FAILED":
        result = BundlePreparationFailed.from_dict(value)
    else:
        raise ValueError("unknown bundle result status")
    if result.identity != request.identity:
        raise ValueError("bundle result belongs to another request")
    if type(result) is BundlePreparationCompleted:
        captured = tuple((path, digest) for path, digest, _ in result.expanded_inventory)
        if captured != request.source_inventory:
            raise ValueError("bundle result does not match reviewed source inventory")
    return result


@dataclass(frozen=True)
class WorkerRequestFrame:
    """Closed request envelope shared by all six worker kinds."""

    identity: WorkerRequestIdentity
    request: WorkerRequest
    frame_digest: str
    frame_type: ClassVar[str] = "WORKER_REQUEST"

    def __post_init__(self) -> None:
        if (
            type(self.identity) is not WorkerRequestIdentity
            or type(self.request) not in _worker_request_types(self.identity.worker_kind)
            or self.identity != self.request.identity
        ):
            raise ValueError("request frame inner/outer identity mismatch")
        if self.frame_digest != domain_separated_sha256(
            _SUPERVISOR_CONTROL_FRAME_DOMAIN, self._payload()
        ):
            raise ValueError("frameDigest mismatch")

    def _payload(self) -> dict[str, object]:
        return {
            "frameType": self.frame_type,
            "identity": self.identity.to_dict(),
            "request": self.request.to_dict(),
        }

    def to_dict(self) -> dict[str, object]:
        return {**self._payload(), "frameDigest": self.frame_digest}

    @classmethod
    def from_dict(
        cls, value: object, *,
        epoch: ProofAdmissionEpochRecord | None = None,
        current_epoch: ProofAdmissionCurrentEpoch | None = None,
        pause: ProofAdmissionPauseRecord | None = None,
        jobs: tuple[ProofAdmissionJobRecord, ...] = (),
        completions: tuple[ProofAdmissionJobCompletion, ...] = (),
        intents: tuple[ProofAdmissionEmissionIntent, ...] = (),
        acknowledgements: tuple[ProofAdmissionEmissionAcknowledgement, ...] = (),
    ) -> "WorkerRequestFrame":
        data = _closed_mapping(
            value, schema=cls.__name__,
            keys=frozenset(("frameType", "identity", "request", "frameDigest")),
        )
        if data["frameType"] != cls.frame_type:
            raise ValueError("frameType must be WORKER_REQUEST")
        return cls(
            WorkerRequestIdentity.from_dict(data["identity"]),
            worker_request_from_dict(
                data["request"], epoch=epoch, current_epoch=current_epoch, pause=pause,
                jobs=jobs, completions=completions, intents=intents,
                acknowledgements=acknowledgements,
            ), data["frameDigest"],
        )


@dataclass(frozen=True)
class WorkerResultFrame:
    """Closed result envelope; request correlation is compulsory at decoding."""

    identity: WorkerRequestIdentity
    result: WorkerResult
    frame_digest: str
    frame_type: ClassVar[str] = "WORKER_RESULT"

    def __post_init__(self) -> None:
        if (
            type(self.identity) is not WorkerRequestIdentity
            or type(self.result) not in _worker_result_types(self.identity.worker_kind)
            or self.identity != self.result.identity
        ):
            raise ValueError("result frame inner/outer identity mismatch")
        if self.frame_digest != domain_separated_sha256(
            _SUPERVISOR_CONTROL_FRAME_DOMAIN, self._payload()
        ):
            raise ValueError("frameDigest mismatch")

    def _payload(self) -> dict[str, object]:
        return {
            "frameType": self.frame_type,
            "identity": self.identity.to_dict(),
            "result": self.result.to_dict(),
        }

    def to_dict(self) -> dict[str, object]:
        return {**self._payload(), "frameDigest": self.frame_digest}

    @classmethod
    def from_dict(
        cls, value: object, *, request: WorkerRequest
    ) -> "WorkerResultFrame":
        data = _closed_mapping(
            value, schema=cls.__name__,
            keys=frozenset(("frameType", "identity", "result", "frameDigest")),
        )
        if data["frameType"] != cls.frame_type:
            raise ValueError("frameType must be WORKER_RESULT")
        return cls(
            WorkerRequestIdentity.from_dict(data["identity"]),
            worker_result_from_dict(data["result"], request),
            data["frameDigest"],
        )


class _SupervisorFrame:
    """Shared digest envelope; concrete frame classes own every payload field."""

    frame_type: ClassVar[str]

    def _payload(self) -> dict[str, object]:
        raise NotImplementedError

    def _validate_digest(self) -> None:
        if self.frame_digest != domain_separated_sha256(
            _SUPERVISOR_CONTROL_FRAME_DOMAIN, self._payload()
        ):
            raise ValueError("frameDigest mismatch")

    def to_dict(self) -> dict[str, object]:
        return {**self._payload(), "frameDigest": self.frame_digest}


def _frame_identity_payload(
    frame_type: str, identity: WorkerRequestIdentity
) -> dict[str, object]:
    if type(identity) is not WorkerRequestIdentity:
        raise ValueError("frame identity must be WorkerRequestIdentity")
    return {"frameType": frame_type, "identity": identity.to_dict()}


def _validate_claim_digest_echo(
    identity: WorkerRequestIdentity, digests: tuple[str, ...]
) -> None:
    if type(identity) is not WorkerRequestIdentity:
        raise ValueError("frame identity must be WorkerRequestIdentity")
    expected = tuple(claim.descriptor_claim_digest for claim in identity.descriptor_claims)
    if type(digests) is not tuple or digests != expected:
        raise ValueError("frame descriptor digests do not match ordered claims")


@dataclass(frozen=True)
class SupervisorReadyFrame(_SupervisorFrame):
    supervisor_session_id: str
    supervisor_runtime_digest: str
    protocol_version: int
    frame_digest: str
    frame_type: ClassVar[str] = "SUPERVISOR_READY"

    def __post_init__(self) -> None:
        _validate_non_empty_utf8(
            self.supervisor_session_id, field="supervisorSessionId", maximum_bytes=256
        )
        validate_sha256(self.supervisor_runtime_digest)
        if type(self.protocol_version) is not int or self.protocol_version != 1:
            raise ValueError("protocolVersion must be integer 1")
        self._validate_digest()

    def _payload(self) -> dict[str, object]:
        return {
            "frameType": self.frame_type, "supervisorSessionId": self.supervisor_session_id,
            "supervisorRuntimeDigest": self.supervisor_runtime_digest,
            "protocolVersion": self.protocol_version,
        }


@dataclass(frozen=True)
class DescriptorTransferFrame(_SupervisorFrame):
    identity: WorkerRequestIdentity
    descriptor_claim_digests: tuple[str, ...]
    frame_digest: str
    frame_type: ClassVar[str] = "DESCRIPTOR_TRANSFER"

    def __post_init__(self) -> None:
        _validate_claim_digest_echo(self.identity, self.descriptor_claim_digests)
        if not self.descriptor_claim_digests:
            raise ValueError("descriptor-free worker forbids ancillary transfer")
        self._validate_digest()
        if len(canonical_json_bytes(self.to_dict())) > 4096:
            raise ValueError("descriptor transfer exceeds the datagram byte limit")

    def _payload(self) -> dict[str, object]:
        return {
            **_frame_identity_payload(self.frame_type, self.identity),
            "descriptorClaimDigests": list(self.descriptor_claim_digests),
        }


@dataclass(frozen=True)
class RequestAcceptedFrame(_SupervisorFrame):
    identity: WorkerRequestIdentity
    accepted_descriptor_claim_digests: tuple[str, ...]
    frame_digest: str
    frame_type: ClassVar[str] = "REQUEST_ACCEPTED"

    def __post_init__(self) -> None:
        _validate_claim_digest_echo(self.identity, self.accepted_descriptor_claim_digests)
        self._validate_digest()

    def _payload(self) -> dict[str, object]:
        return {
            **_frame_identity_payload(self.frame_type, self.identity),
            "acceptedDescriptorClaimDigests": list(self.accepted_descriptor_claim_digests),
        }


@dataclass(frozen=True)
class WorkerArmedFrame(_SupervisorFrame):
    identity: WorkerRequestIdentity
    pid: int
    pgid: int
    timer_kind: str
    timer_seconds: int
    frame_digest: str
    frame_type: ClassVar[str] = "WORKER_ARMED"

    def __post_init__(self) -> None:
        _frame_identity_payload(self.frame_type, self.identity)
        _validate_positive_bounded_integer(self.pid, field="pid", maximum=2147483647)
        if type(self.pgid) is not int or self.pgid != self.pid:
            raise ValueError("worker PGID must equal its PID")
        if self.timer_kind != "ITIMER_REAL":
            raise ValueError("worker timer must be ITIMER_REAL")
        _validate_positive_bounded_integer(
            self.timer_seconds, field="timerSeconds", maximum=60
        )
        self._validate_digest()

    def _payload(self) -> dict[str, object]:
        return {
            **_frame_identity_payload(self.frame_type, self.identity),
            "pid": self.pid, "pgid": self.pgid, "timerKind": self.timer_kind,
            "timerSeconds": self.timer_seconds,
        }


@dataclass(frozen=True)
class WorkerReadyFrame(_SupervisorFrame):
    identity: WorkerRequestIdentity
    validated_descriptor_claim_digests: tuple[str, ...]
    timer_remaining_micros: int
    frame_digest: str
    frame_type: ClassVar[str] = "WORKER_READY"

    def __post_init__(self) -> None:
        _validate_claim_digest_echo(self.identity, self.validated_descriptor_claim_digests)
        _validate_positive_bounded_integer(
            self.timer_remaining_micros, field="timerRemainingMicros", maximum=60000000
        )
        self._validate_digest()

    def _payload(self) -> dict[str, object]:
        return {
            **_frame_identity_payload(self.frame_type, self.identity),
            "validatedDescriptorClaimDigests": list(self.validated_descriptor_claim_digests),
            "timerRemainingMicros": self.timer_remaining_micros,
        }


@dataclass(frozen=True)
class WorkerDiagnosticFrame(_SupervisorFrame):
    identity: WorkerRequestIdentity
    stream: str
    chunk_sequence: int
    chunk_base64: str
    final_chunk: bool
    frame_digest: str
    frame_type: ClassVar[str] = "WORKER_DIAGNOSTIC"

    def __post_init__(self) -> None:
        _frame_identity_payload(self.frame_type, self.identity)
        if self.stream not in ("STDOUT", "STDERR"):
            raise ValueError("diagnostic stream must be STDOUT or STDERR")
        _validate_positive_bounded_integer(
            self.chunk_sequence, field="chunkSequence", maximum=_I_JSON_INTEGER_MAX
        )
        if type(self.chunk_base64) is not str or len(self.chunk_base64) > 87384:
            raise ValueError("diagnostic chunk exceeds encoded byte limit")
        try:
            chunk = base64.b64decode(self.chunk_base64, validate=True)
        except (ValueError, binascii.Error) as error:
            raise ValueError("diagnostic chunk must be canonical base64") from error
        if len(chunk) > 65536 or base64.b64encode(chunk).decode("ascii") != self.chunk_base64:
            raise ValueError("diagnostic chunk is noncanonical or oversized")
        if type(self.final_chunk) is not bool:
            raise ValueError("finalChunk must be boolean")
        self._validate_digest()

    def _payload(self) -> dict[str, object]:
        return {
            **_frame_identity_payload(self.frame_type, self.identity),
            "stream": self.stream, "chunkSequence": self.chunk_sequence,
            "chunkBase64": self.chunk_base64, "finalChunk": self.final_chunk,
        }


@dataclass(frozen=True)
class WorkerExitedFrame(_SupervisorFrame):
    identity: WorkerRequestIdentity
    exit_code: int
    frame_digest: str
    frame_type: ClassVar[str] = "WORKER_EXITED"

    def __post_init__(self) -> None:
        _frame_identity_payload(self.frame_type, self.identity)
        if type(self.exit_code) is not int or not 0 <= self.exit_code <= 255:
            raise ValueError("exitCode must be a POSIX exit status in 0..255")
        self._validate_digest()

    def _payload(self) -> dict[str, object]:
        return {**_frame_identity_payload(self.frame_type, self.identity), "exitCode": self.exit_code}


@dataclass(frozen=True)
class WorkerSignaledFrame(_SupervisorFrame):
    identity: WorkerRequestIdentity
    signal_number: int
    frame_digest: str
    frame_type: ClassVar[str] = "WORKER_SIGNALED"

    def __post_init__(self) -> None:
        _frame_identity_payload(self.frame_type, self.identity)
        _validate_positive_bounded_integer(self.signal_number, field="signalNumber", maximum=127)
        self._validate_digest()

    def _payload(self) -> dict[str, object]:
        return {**_frame_identity_payload(self.frame_type, self.identity), "signalNumber": self.signal_number}


@dataclass(frozen=True)
class WorkerTimeoutFrame(_SupervisorFrame):
    identity: WorkerRequestIdentity
    deadline_owner: str
    frame_digest: str
    frame_type: ClassVar[str] = "WORKER_TIMEOUT"

    def __post_init__(self) -> None:
        _frame_identity_payload(self.frame_type, self.identity)
        if self.deadline_owner not in ("CHILD_ITIMER_REAL", "SUPERVISOR_MONOTONIC"):
            raise ValueError("unknown deadline owner")
        self._validate_digest()

    def _payload(self) -> dict[str, object]:
        return {**_frame_identity_payload(self.frame_type, self.identity), "deadlineOwner": self.deadline_owner}


@dataclass(frozen=True)
class WorkerCancelledFrame(_SupervisorFrame):
    identity: WorkerRequestIdentity
    reason: str
    frame_digest: str
    frame_type: ClassVar[str] = "WORKER_CANCELLED"

    def __post_init__(self) -> None:
        _frame_identity_payload(self.frame_type, self.identity)
        if self.reason not in ("ORCHESTRATOR_CANCEL", "SESSION_CLOSE"):
            raise ValueError("unknown cancellation reason")
        self._validate_digest()

    def _payload(self) -> dict[str, object]:
        return {**_frame_identity_payload(self.frame_type, self.identity), "reason": self.reason}


@dataclass(frozen=True)
class WorkerCancelRequestFrame(WorkerCancelledFrame):
    frame_type: ClassVar[str] = "WORKER_CANCEL_REQUEST"


@dataclass(frozen=True)
class SupervisorCloseFrame(_SupervisorFrame):
    supervisor_session_id: str
    last_sequence: int
    frame_digest: str
    frame_type: ClassVar[str] = "SUPERVISOR_CLOSE"

    def __post_init__(self) -> None:
        _validate_non_empty_utf8(
            self.supervisor_session_id, field="supervisorSessionId", maximum_bytes=256
        )
        if type(self.last_sequence) is not int or not 0 <= self.last_sequence <= _I_JSON_INTEGER_MAX:
            raise ValueError("lastSequence must be a nonnegative I-JSON integer")
        self._validate_digest()

    def _payload(self) -> dict[str, object]:
        return {
            "frameType": self.frame_type, "supervisorSessionId": self.supervisor_session_id,
            "lastSequence": self.last_sequence,
        }


@dataclass(frozen=True)
class SupervisorCloseAckFrame(SupervisorCloseFrame):
    all_workers_reaped: bool = True
    frame_type: ClassVar[str] = "SUPERVISOR_CLOSE_ACK"

    def __post_init__(self) -> None:
        if self.all_workers_reaped is not True:
            raise ValueError("close acknowledgement requires allWorkersReaped=true")
        super().__post_init__()

    def _payload(self) -> dict[str, object]:
        return {**super()._payload(), "allWorkersReaped": self.all_workers_reaped}


_SUPERVISOR_SCALAR_FRAME_BRANCHES = {
    "SUPERVISOR_READY": (SupervisorReadyFrame, ("supervisorSessionId", "supervisorRuntimeDigest", "protocolVersion")),
    "DESCRIPTOR_TRANSFER": (DescriptorTransferFrame, ("identity", "descriptorClaimDigests")),
    "REQUEST_ACCEPTED": (RequestAcceptedFrame, ("identity", "acceptedDescriptorClaimDigests")),
    "WORKER_ARMED": (WorkerArmedFrame, ("identity", "pid", "pgid", "timerKind", "timerSeconds")),
    "WORKER_READY": (WorkerReadyFrame, ("identity", "validatedDescriptorClaimDigests", "timerRemainingMicros")),
    "WORKER_DIAGNOSTIC": (WorkerDiagnosticFrame, ("identity", "stream", "chunkSequence", "chunkBase64", "finalChunk")),
    "WORKER_EXITED": (WorkerExitedFrame, ("identity", "exitCode")),
    "WORKER_SIGNALED": (WorkerSignaledFrame, ("identity", "signalNumber")),
    "WORKER_TIMEOUT": (WorkerTimeoutFrame, ("identity", "deadlineOwner")),
    "WORKER_CANCELLED": (WorkerCancelledFrame, ("identity", "reason")),
    "WORKER_CANCEL_REQUEST": (WorkerCancelRequestFrame, ("identity", "reason")),
    "SUPERVISOR_CLOSE": (SupervisorCloseFrame, ("supervisorSessionId", "lastSequence")),
    "SUPERVISOR_CLOSE_ACK": (SupervisorCloseAckFrame, ("supervisorSessionId", "lastSequence", "allWorkersReaped")),
}


def supervisor_scalar_frame_from_bytes(
    wire: bytes, *, ancillary: bool = False,
    expected_identity: WorkerRequestIdentity | None = None,
) -> _SupervisorFrame:
    """Decode a closed scalar frame on its designated channel before correlation."""
    if type(ancillary) is not bool:
        raise ValueError("ancillary must be boolean")
    limit = 4096 if ancillary else 2097152
    if type(wire) is not bytes or not 1 <= len(wire) <= limit:
        raise ValueError("supervisor frame exceeds channel byte limit")
    value = _strict_json_value(wire)
    if not isinstance(value, Mapping):
        raise ValueError("supervisor frame must be an object")
    frame_type = value.get("frameType")
    if type(frame_type) is not str or frame_type not in _SUPERVISOR_SCALAR_FRAME_BRANCHES:
        raise ValueError("unknown scalar supervisor frame type")
    if ancillary != (frame_type == "DESCRIPTOR_TRANSFER"):
        raise ValueError("supervisor frame belongs to another channel")
    frame_class, fields = _SUPERVISOR_SCALAR_FRAME_BRANCHES[frame_type]
    data = _closed_mapping(
        value, schema=frame_class.__name__,
        keys=frozenset(("frameType", "frameDigest", *fields)),
    )
    values = []
    for field in fields:
        item = data[field]
        if field == "identity":
            item = WorkerRequestIdentity.from_dict(item)
        elif field.endswith("DescriptorClaimDigests") or field == "descriptorClaimDigests":
            if type(item) is not list or len(item) > 2:
                raise ValueError("descriptor digest echo must be a bounded array")
            item = tuple(item)
        values.append(item)
    if frame_class is SupervisorCloseAckFrame:
        frame = frame_class(values[0], values[1], data["frameDigest"], values[2])
    else:
        frame = frame_class(*values, data["frameDigest"])
    if expected_identity is not None:
        if type(expected_identity) is not WorkerRequestIdentity or getattr(frame, "identity", None) != expected_identity:
            raise ValueError("supervisor frame belongs to another request")
    return frame


class SupervisorSession:
    """Pure six-kind admission state; runtime owns allocation, I/O and reaping."""

    def __init__(self, supervisor_session_id: str, supervisor_runtime_digest: str):
        _validate_non_empty_utf8(
            supervisor_session_id, field="supervisorSessionId", maximum_bytes=256
        )
        validate_sha256(supervisor_runtime_digest)
        self.supervisor_session_id = supervisor_session_id
        self.supervisor_runtime_digest = supervisor_runtime_digest
        self.state = "STARTING"
        self.failure_code: FinalizerFailureCode | None = None
        self.closed_after_failure = False
        self.next_sequence = 1
        self.phase: str | None = None
        self.request: WorkerRequest | None = None
        self.cancel_reason: str | None = None
        self.timer_seconds: int | None = None
        self._diagnostic_bytes = {"STDOUT": 0, "STDERR": 0}
        self._diagnostic_sequence = {"STDOUT": 1, "STDERR": 1}
        self._diagnostic_closed = {"STDOUT": False, "STDERR": False}

    def accept(self, frame: object) -> None:
        """Reject any bad transition permanently; runtime owner must kill/reap."""
        try:
            self._accept(frame)
        except ValueError:
            self.state = "FAILED"
            self.failure_code = FinalizerFailureCode.SUPERVISOR_FAILED
            raise

    def _accept(self, frame: object) -> None:
        if type(frame) is SupervisorReadyFrame:
            if (
                self.state != "STARTING"
                or frame.supervisor_session_id != self.supervisor_session_id
                or frame.supervisor_runtime_digest != self.supervisor_runtime_digest
            ):
                raise ValueError("READY does not match the starting supervisor")
            self.state = "READY"
            return
        if type(frame) is SupervisorCloseFrame:
            if (
                self.state not in ("READY", "FAILED") or self.request is not None
                or frame.supervisor_session_id != self.supervisor_session_id
                or frame.last_sequence != self.next_sequence - 1
            ):
                raise ValueError("session cannot close with an outstanding worker")
            self.state = "CLOSING"
            return
        if type(frame) is SupervisorCloseAckFrame:
            if (
                self.state != "CLOSING"
                or frame.supervisor_session_id != self.supervisor_session_id
                or frame.last_sequence != self.next_sequence - 1
            ):
                raise ValueError("unexpected close acknowledgement")
            self.closed_after_failure = self.failure_code is not None
            self.state = "CLOSED"
            return
        if type(frame) is WorkerRequestFrame:
            if (
                self.state != "READY"
                or frame.identity.supervisor_session_id != self.supervisor_session_id
                or frame.identity.sequence != self.next_sequence
            ):
                raise ValueError("request sequence/session does not match READY")
            self.request = frame.request
            self.state = "REQUEST_ACTIVE"
            self.phase = "REQUEST_SENT"
            self.cancel_reason = None
            self.timer_seconds = None
            self._diagnostic_bytes = {"STDOUT": 0, "STDERR": 0}
            self._diagnostic_sequence = {"STDOUT": 1, "STDERR": 1}
            self._diagnostic_closed = {"STDOUT": False, "STDERR": False}
            return
        if (
            self.state != "REQUEST_ACTIVE" or self.request is None
            or getattr(frame, "identity", None) != self.request.identity
        ):
            raise ValueError("frame does not match the active request")
        if type(frame) is DescriptorTransferFrame:
            if self.phase != "REQUEST_SENT" or not self.request.identity.descriptor_claims:
                raise ValueError("descriptor transfer is out of order")
            self.phase = "DESCRIPTORS_SENT"
            return
        if type(frame) is RequestAcceptedFrame:
            expected_phase = (
                "DESCRIPTORS_SENT" if self.request.identity.descriptor_claims else "REQUEST_SENT"
            )
            if self.phase != expected_phase:
                raise ValueError("request accepted before descriptor transfer")
            self.phase = "ACCEPTED"
            return
        if type(frame) is WorkerArmedFrame:
            if self.phase != "ACCEPTED" or frame.timer_seconds != worker_timeout_seconds(self.request):
                raise ValueError("worker timer acknowledgement does not match request")
            self.timer_seconds = frame.timer_seconds
            self.phase = "ARMED"
            return
        if type(frame) is WorkerReadyFrame:
            if (
                self.phase != "ARMED" or self.timer_seconds is None
                or frame.timer_remaining_micros > self.timer_seconds * 1000000
            ):
                raise ValueError("worker ready has no matching armed timer")
            self.phase = "WORKER_READY"
            return
        if type(frame) is WorkerDiagnosticFrame:
            if (
                self.phase != "WORKER_READY" or self.cancel_reason is not None
                or self._diagnostic_closed[frame.stream]
                or frame.chunk_sequence != self._diagnostic_sequence[frame.stream]
            ):
                raise ValueError("diagnostic chunk is out of order")
            total = self._diagnostic_bytes[frame.stream] + len(
                base64.b64decode(frame.chunk_base64, validate=True)
            )
            if total > 262144:
                raise ValueError("diagnostic stream exceeds cumulative byte limit")
            self._diagnostic_bytes[frame.stream] = total
            self._diagnostic_sequence[frame.stream] += 1
            self._diagnostic_closed[frame.stream] = frame.final_chunk
            return
        if type(frame) is WorkerResultFrame:
            if self.phase != "WORKER_READY" or self.cancel_reason is not None:
                raise ValueError("worker result before READY or after cancellation")
            worker_result_from_dict(frame.result.to_dict(), self.request)
            self.phase = "RESULT_RECEIVED"
            return
        if type(frame) is WorkerCancelRequestFrame:
            if self.phase not in ("ACCEPTED", "ARMED", "WORKER_READY") or self.cancel_reason is not None:
                raise ValueError("cancel request is out of order")
            self.cancel_reason = frame.reason
            return
        if type(frame) is WorkerCancelledFrame:
            if self.cancel_reason != frame.reason:
                raise ValueError("cancellation lacks a matching request")
            self._finish()
            return
        if type(frame) is WorkerExitedFrame:
            if frame.exit_code == 0 and (
                self.phase != "RESULT_RECEIVED" or self.cancel_reason is not None
            ):
                raise ValueError("successful exit requires a prior result")
            if self.phase not in ("ACCEPTED", "ARMED", "WORKER_READY", "RESULT_RECEIVED"):
                raise ValueError("exit before request acceptance")
            self._finish()
            if frame.exit_code != 0:
                self.state = "FAILED"
                self.failure_code = FinalizerFailureCode.PROCESS_FAILED
            return
        if type(frame) in (WorkerSignaledFrame, WorkerTimeoutFrame):
            if self.phase not in ("ACCEPTED", "ARMED", "WORKER_READY", "RESULT_RECEIVED"):
                raise ValueError("terminal worker frame before acceptance")
            self._finish()
            self.state = "FAILED"
            self.failure_code = (
                FinalizerFailureCode.TIMED_OUT
                if type(frame) is WorkerTimeoutFrame else FinalizerFailureCode.PROCESS_FAILED
            )
            return
        raise ValueError("frame is outside the supervisor contract")

    def _finish(self) -> None:
        self.request = None
        self.phase = None
        self.cancel_reason = None
        self.timer_seconds = None
        self.next_sequence += 1
        self.state = "READY"

    def acknowledge_reaped_after_failure(self, identity: WorkerRequestIdentity) -> None:
        """Runtime may clear an active failed request only after actual kill/reap."""
        if self.state != "FAILED" or self.request is None or identity != self.request.identity:
            raise ValueError("reap acknowledgement does not match failed request")
        self.request = None
        self.phase = None
        self.next_sequence += 1

    def accept_eof(self) -> None:
        if self.state != "CLOSED":
            self.state = "FAILED"
            self.failure_code = FinalizerFailureCode.SUPERVISOR_FAILED
            raise ValueError("supervisor EOF without terminal close acknowledgement")


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
class FinalizerBootstrapBaseline:
    schema_version: int
    source_files: tuple[tuple[str, str], ...]
    core_bootstrap_source_digest: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {"schemaVersion", "sourceFiles", "coreBootstrapSourceDigest"}
    )

    def __post_init__(self) -> None:
        if type(self.schema_version) is not int or self.schema_version != 1:
            raise ValueError("schemaVersion must be 1")
        _validate_file_identity_tuple(self.source_files, field="sourceFiles")
        if tuple(path for path, _ in self.source_files) != (
            FINALIZER_BOOTSTRAP_SOURCE_PATHS
        ):
            raise ValueError(
                "sourceFiles must equal the fixed Core bootstrap inventory"
            )
        validate_sha256(self.core_bootstrap_source_digest)
        if self.core_bootstrap_source_digest != domain_separated_sha256(
            _CORE_BOOTSTRAP_SOURCE_DOMAIN,
            [list(item) for item in self.source_files],
        ):
            raise ValueError(
                "coreBootstrapSourceDigest does not match sourceFiles"
            )

    def to_dict(self) -> dict[str, object]:
        return {
            "schemaVersion": self.schema_version,
            "sourceFiles": [list(item) for item in self.source_files],
            "coreBootstrapSourceDigest": self.core_bootstrap_source_digest,
        }

    @classmethod
    def create(
        cls,
        *,
        source_files: tuple[tuple[str, str], ...],
    ) -> "FinalizerBootstrapBaseline":
        return cls(
            schema_version=1,
            source_files=source_files,
            core_bootstrap_source_digest=domain_separated_sha256(
                _CORE_BOOTSTRAP_SOURCE_DOMAIN,
                [list(item) for item in source_files],
            ),
        )

    @classmethod
    def from_dict(cls, value: object) -> "FinalizerBootstrapBaseline":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            schema_version=data["schemaVersion"],
            source_files=_file_identity_tuple_from_wire(
                data["sourceFiles"],
                field="sourceFiles",
            ),
            core_bootstrap_source_digest=data["coreBootstrapSourceDigest"],
        )


@dataclass(frozen=True)
class CapturedProtectedSource:
    component: ProtectedSourceComponent
    repo_relative_path: str
    file_sha256: str
    byte_length: int
    executable_included: bool

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "component",
            "repoRelativePath",
            "fileSha256",
            "byteLength",
            "executableIncluded",
        }
    )

    def __post_init__(self) -> None:
        if type(self.component) is not ProtectedSourceComponent:
            raise ValueError("component must be a closed protected-source component")
        validate_repo_relative_path(self.repo_relative_path)
        validate_sha256(self.file_sha256)
        _validate_non_negative_integer(self.byte_length, field="byteLength")
        if self.byte_length > 8 * 1024 * 1024:
            raise ValueError("protected source exceeds the fixed entry limit")
        if type(self.executable_included) is not bool:
            raise ValueError("executableIncluded must be boolean")

    @property
    def identity_key(self) -> bytes:
        return self.repo_relative_path.encode("utf-8")

    def to_dict(self) -> dict[str, object]:
        return {
            "component": self.component.value,
            "repoRelativePath": self.repo_relative_path,
            "fileSha256": self.file_sha256,
            "byteLength": self.byte_length,
            "executableIncluded": self.executable_included,
        }

    @classmethod
    def from_dict(cls, value: object) -> "CapturedProtectedSource":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            component=_enum_from_wire(
                ProtectedSourceComponent,
                data["component"],
                field="component",
            ),
            repo_relative_path=data["repoRelativePath"],
            file_sha256=data["fileSha256"],
            byte_length=data["byteLength"],
            executable_included=data["executableIncluded"],
        )


def _validate_captured_protected_sources(
    value: object,
) -> tuple[CapturedProtectedSource, ...]:
    if (
        type(value) is not tuple
        or not value
        or len(value) > 4096
        or any(type(item) is not CapturedProtectedSource for item in value)
    ):
        raise ValueError(
            "capturedSources must contain 1..4096 protected-source values"
        )
    keys = tuple(item.identity_key for item in value)
    if len(set(keys)) != len(keys) or keys != tuple(sorted(keys)):
        raise ValueError(
            "capturedSources must have unique UTF-8 lexical paths"
        )
    if sum(item.byte_length for item in value) > 64 * 1024 * 1024:
        raise ValueError("capturedSources exceeds the fixed expanded limit")
    return value


@dataclass
class PreflightSourceCapture:
    capture_id: str
    workspace_id: str
    source_commit: str
    workspace_digest: str
    canonical_worktree_hash: str
    source_files: tuple[CapturedProtectedSource, ...]
    source_capture_bundle_digest: str
    temporary_directory_claim: DescriptorClaim
    source_capture_digest: str
    consumed: bool = False

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "captureId",
            "workspaceId",
            "sourceCommit",
            "workspaceDigest",
            "canonicalWorktreeHash",
            "sourceFiles",
            "sourceCaptureBundleDigest",
            "temporaryDirectoryClaim",
            "sourceCaptureDigest",
            "consumed",
        }
    )

    def __post_init__(self) -> None:
        _validate_non_empty_utf8(
            self.capture_id,
            field="captureId",
            maximum_bytes=256,
        )
        _validate_workspace_id(self.workspace_id)
        _validate_non_empty_utf8(self.source_commit, field="sourceCommit")
        _validate_non_empty_utf8(self.workspace_digest, field="workspaceDigest")
        validate_sha256(self.canonical_worktree_hash)
        _validate_captured_protected_sources(self.source_files)
        validate_sha256(self.source_capture_bundle_digest)
        if (
            type(self.temporary_directory_claim) is not DescriptorClaim
            or self.temporary_directory_claim.role
            is not DescriptorRole.TEMPORARY_DIRECTORY
        ):
            raise ValueError(
                "temporaryDirectoryClaim must bind a temporary directory"
            )
        if type(self.consumed) is not bool:
            raise ValueError("consumed must be boolean")
        validate_sha256(self.source_capture_digest)
        if self.source_capture_digest != self.expected_digest():
            raise ValueError("sourceCaptureDigest does not match capture")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "captureId": self.capture_id,
            "workspaceId": self.workspace_id,
            "sourceCommit": self.source_commit,
            "workspaceDigest": self.workspace_digest,
            "canonicalWorktreeHash": self.canonical_worktree_hash,
            "sourceFiles": [item.to_dict() for item in self.source_files],
            "sourceCaptureBundleDigest": self.source_capture_bundle_digest,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(
            _SOURCE_CAPTURE_DOMAIN,
            self._digest_payload(),
        )

    def consume(self) -> None:
        if self.consumed:
            raise ValueError("source capture is already consumed")
        self.consumed = True

    def to_dict(self) -> dict[str, object]:
        return {
            **self._digest_payload(),
            "temporaryDirectoryClaim": self.temporary_directory_claim.to_dict(),
            "sourceCaptureDigest": self.source_capture_digest,
            "consumed": self.consumed,
        }

    @classmethod
    def create(
        cls,
        *,
        capture_id: str,
        workspace_id: str,
        source_commit: str,
        workspace_digest: str,
        canonical_worktree_hash: str,
        source_files: tuple[CapturedProtectedSource, ...],
        source_capture_bundle_digest: str,
        temporary_directory_claim: DescriptorClaim,
    ) -> "PreflightSourceCapture":
        payload = {
            "captureId": capture_id,
            "workspaceId": workspace_id,
            "sourceCommit": source_commit,
            "workspaceDigest": workspace_digest,
            "canonicalWorktreeHash": canonical_worktree_hash,
            "sourceFiles": [item.to_dict() for item in source_files],
            "sourceCaptureBundleDigest": source_capture_bundle_digest,
        }
        return cls(
            capture_id=capture_id,
            workspace_id=workspace_id,
            source_commit=source_commit,
            workspace_digest=workspace_digest,
            canonical_worktree_hash=canonical_worktree_hash,
            source_files=source_files,
            source_capture_bundle_digest=source_capture_bundle_digest,
            temporary_directory_claim=temporary_directory_claim,
            source_capture_digest=domain_separated_sha256(
                _SOURCE_CAPTURE_DOMAIN,
                payload,
            ),
        )

    @classmethod
    def from_dict(cls, value: object) -> "PreflightSourceCapture":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        source_files = data["sourceFiles"]
        if type(source_files) is not list:
            raise ValueError("sourceFiles must be an array")
        return cls(
            capture_id=data["captureId"],
            workspace_id=data["workspaceId"],
            source_commit=data["sourceCommit"],
            workspace_digest=data["workspaceDigest"],
            canonical_worktree_hash=data["canonicalWorktreeHash"],
            source_files=tuple(
                CapturedProtectedSource.from_dict(item)
                for item in source_files
            ),
            source_capture_bundle_digest=data["sourceCaptureBundleDigest"],
            temporary_directory_claim=DescriptorClaim.from_dict(
                data["temporaryDirectoryClaim"]
            ),
            source_capture_digest=data["sourceCaptureDigest"],
            consumed=data["consumed"],
        )


@dataclass(frozen=True)
class ProtectedSourceArtifact:
    component: ProtectedSourceComponent
    repo_relative_path: str
    ref: ArtifactRef
    file_sha256: str
    byte_length: int
    executable_included: bool

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "component",
            "repoRelativePath",
            "ref",
            "fileSha256",
            "byteLength",
            "executableIncluded",
        }
    )

    def __post_init__(self) -> None:
        CapturedProtectedSource(
            component=self.component,
            repo_relative_path=self.repo_relative_path,
            file_sha256=self.file_sha256,
            byte_length=self.byte_length,
            executable_included=self.executable_included,
        )
        _validate_ref_content(self.ref, field="ref", sha256=self.file_sha256)
        if self.ref.path != self.repo_relative_path:
            raise ValueError("ref path must equal repoRelativePath")

    @property
    def captured(self) -> CapturedProtectedSource:
        return CapturedProtectedSource(
            component=self.component,
            repo_relative_path=self.repo_relative_path,
            file_sha256=self.file_sha256,
            byte_length=self.byte_length,
            executable_included=self.executable_included,
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "component": self.component.value,
            "repoRelativePath": self.repo_relative_path,
            "ref": self.ref.to_dict(),
            "fileSha256": self.file_sha256,
            "byteLength": self.byte_length,
            "executableIncluded": self.executable_included,
        }

    @classmethod
    def from_dict(cls, value: object) -> "ProtectedSourceArtifact":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            component=_enum_from_wire(
                ProtectedSourceComponent,
                data["component"],
                field="component",
            ),
            repo_relative_path=data["repoRelativePath"],
            ref=ArtifactRef.from_dict(data["ref"]),
            file_sha256=data["fileSha256"],
            byte_length=data["byteLength"],
            executable_included=data["executableIncluded"],
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

    def without_artifact_ref_dict(self) -> dict[str, object]:
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
        if self.code_directory_hash is not None:
            raise ValueError(
                "DARWIN_SHARED_CACHE uses signed cache UUID plus Mach-O UUID, not per-image CDHash"
            )
        for field, value in (
            ("machoUuid", self.macho_uuid),
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
        if self.code_directory_hash is not None:
            raise ValueError(
                "DARWIN_SHARED_CACHE uses signed cache UUID plus Mach-O UUID, not per-image CDHash"
            )
        for field, value in (
            ("machoUuid", self.macho_uuid),
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
class RuntimePathInput:
    """Ephemeral lexical path contract; worker must verify the live realpath."""

    kind: RuntimePathKind
    module_name: str | None
    absolute_path: str
    expected_path_hash: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {"kind", "moduleName", "absolutePath", "expectedPathHash"}
    )

    def __post_init__(self) -> None:
        if type(self.kind) is not RuntimePathKind:
            raise ValueError("kind must be a closed runtime path kind")
        if self.kind is RuntimePathKind.STDLIB_MODULE:
            _validate_non_empty_utf8(
                self.module_name, field="moduleName", maximum_bytes=512
            )
        elif self.module_name is not None:
            raise ValueError("non-module runtime paths forbid moduleName")
        path = _validate_non_empty_utf8(
            self.absolute_path, field="absolutePath", maximum_bytes=4096
        )
        if (
            not path.startswith("/")
            or path.startswith("//")
            or posixpath.normpath(path) != path
        ):
            raise ValueError("absolutePath must be a normalized POSIX absolute path")
        validate_sha256(self.expected_path_hash)
        if raw_sha256(path.encode("utf-8")) != self.expected_path_hash:
            raise ValueError("expectedPathHash does not match canonical path bytes")

    @property
    def identity_key(self) -> tuple[bytes, bytes, bytes]:
        return (
            self.kind.value.encode("ascii"),
            _nullable_string_sort_key(self.module_name),
            self.expected_path_hash.encode("ascii"),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "kind": self.kind.value,
            "moduleName": self.module_name,
            "absolutePath": self.absolute_path,
            "expectedPathHash": self.expected_path_hash,
        }

    @classmethod
    def from_dict(cls, value: object) -> "RuntimePathInput":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            kind=_enum_from_wire(RuntimePathKind, data["kind"], field="kind"),
            module_name=data["moduleName"],
            absolute_path=data["absolutePath"],
            expected_path_hash=data["expectedPathHash"],
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
class RuntimeEvidenceArtifact:
    kind: RuntimeFileKind
    module_name: str | None
    logical_name: str | None
    origin_kind: RuntimeImageOriginKind | None
    path_hash: str
    ref: ArtifactRef
    file_sha256: str
    byte_length: int

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "kind",
            "moduleName",
            "logicalName",
            "originKind",
            "pathHash",
            "ref",
            "fileSha256",
            "byteLength",
        }
    )

    def __post_init__(self) -> None:
        CapturedRuntimeFile(
            kind=self.kind,
            module_name=self.module_name,
            logical_name=self.logical_name,
            origin_kind=self.origin_kind,
            path_hash=self.path_hash,
            file_sha256=self.file_sha256,
            byte_length=self.byte_length,
        )
        _validate_ref_content(self.ref, field="ref", sha256=self.file_sha256)

    @property
    def identity_key(self) -> tuple[bytes, bytes, bytes, bytes]:
        return self.captured.identity_key

    @property
    def captured(self) -> CapturedRuntimeFile:
        return CapturedRuntimeFile(
            kind=self.kind,
            module_name=self.module_name,
            logical_name=self.logical_name,
            origin_kind=self.origin_kind,
            path_hash=self.path_hash,
            file_sha256=self.file_sha256,
            byte_length=self.byte_length,
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
            "ref": self.ref.to_dict(),
            "fileSha256": self.file_sha256,
            "byteLength": self.byte_length,
        }

    @classmethod
    def from_dict(cls, value: object) -> "RuntimeEvidenceArtifact":
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
            ref=ArtifactRef.from_dict(data["ref"]),
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
class PreflightRuntimePlatformAttestation:
    os_family: RuntimeOsFamily
    host_build: RuntimeHostBuild
    dynamic_loader_identity: PreflightLoadedRuntimeImage
    shared_cache_uuid: str | None
    loaded_images: tuple[PreflightLoadedRuntimeImage, ...]
    preflight_platform_runtime_digest: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "osFamily", "hostBuild", "dynamicLoaderIdentity", "sharedCacheUuid",
            "loadedImages", "preflightPlatformRuntimeDigest",
        }
    )

    def __post_init__(self) -> None:
        if type(self.os_family) is not RuntimeOsFamily:
            raise ValueError("osFamily must be a closed runtime OS family")
        expected_build_type = (
            DarwinRuntimeHostBuild
            if self.os_family is RuntimeOsFamily.DARWIN
            else LinuxRuntimeHostBuild
        )
        if type(self.host_build) is not expected_build_type:
            raise ValueError("hostBuild must match osFamily")
        if type(self.dynamic_loader_identity) is not PreflightLoadedRuntimeImage:
            raise ValueError("dynamicLoaderIdentity must be a preflight image")
        if self.dynamic_loader_identity.logical_name != "dynamic-loader":
            raise ValueError("dynamic loader logicalName must be dynamic-loader")
        if (
            type(self.loaded_images) is not tuple
            or not self.loaded_images
            or any(type(item) is not PreflightLoadedRuntimeImage for item in self.loaded_images)
        ):
            raise ValueError("loadedImages must be a non-empty tuple of preflight images")
        keys = tuple(item.identity_key for item in self.loaded_images)
        if len(set(keys)) != len(keys) or keys != tuple(sorted(keys)):
            raise ValueError("loadedImages must have unique, canonical identities")
        if self.dynamic_loader_identity not in self.loaded_images:
            raise ValueError("dynamicLoaderIdentity must be an identity-equal member")
        if self.os_family is RuntimeOsFamily.DARWIN:
            _validate_non_empty_utf8(
                self.shared_cache_uuid, field="sharedCacheUuid", maximum_bytes=256
            )
            if any(
                image.origin_kind is RuntimeImageOriginKind.DARWIN_SHARED_CACHE
                and image.shared_cache_uuid != self.shared_cache_uuid
                for image in self.loaded_images
            ):
                raise ValueError("shared-cache UUID must match platform inventory")
        elif self.shared_cache_uuid is not None or any(
            item.origin_kind is not RuntimeImageOriginKind.STANDALONE_FILE
            for item in self.loaded_images
        ):
            raise ValueError("LINUX forbids shared-cache fields and images")
        validate_sha256(self.preflight_platform_runtime_digest)
        if self.preflight_platform_runtime_digest != self.expected_digest():
            raise ValueError("preflightPlatformRuntimeDigest does not match platform")

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
            _PREFLIGHT_PLATFORM_RUNTIME_DOMAIN, self._digest_payload()
        )

    def to_dict(self) -> dict[str, object]:
        return {
            **self._digest_payload(),
            "preflightPlatformRuntimeDigest": self.preflight_platform_runtime_digest,
        }

    @classmethod
    def create(
        cls, *, os_family: RuntimeOsFamily, host_build: RuntimeHostBuild,
        dynamic_loader_identity: PreflightLoadedRuntimeImage,
        shared_cache_uuid: str | None,
        loaded_images: tuple[PreflightLoadedRuntimeImage, ...],
    ) -> "PreflightRuntimePlatformAttestation":
        payload = {
            "osFamily": os_family.value,
            "hostBuild": host_build.to_dict(),
            "dynamicLoaderIdentity": dynamic_loader_identity.to_dict(),
            "sharedCacheUuid": shared_cache_uuid,
            "loadedImages": [item.to_dict() for item in loaded_images],
        }
        return cls(
            os_family, host_build, dynamic_loader_identity, shared_cache_uuid,
            loaded_images,
            domain_separated_sha256(_PREFLIGHT_PLATFORM_RUNTIME_DOMAIN, payload),
        )

    @classmethod
    def from_dict(cls, value: object) -> "PreflightRuntimePlatformAttestation":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        if type(data["loadedImages"]) is not list:
            raise ValueError("loadedImages must be an array")
        return cls(
            os_family=_enum_from_wire(RuntimeOsFamily, data["osFamily"], field="osFamily"),
            host_build=runtime_host_build_from_dict(data["hostBuild"]),
            dynamic_loader_identity=PreflightLoadedRuntimeImage.from_dict(
                data["dynamicLoaderIdentity"]
            ),
            shared_cache_uuid=data["sharedCacheUuid"],
            loaded_images=tuple(
                PreflightLoadedRuntimeImage.from_dict(item) for item in data["loadedImages"]
            ),
            preflight_platform_runtime_digest=data["preflightPlatformRuntimeDigest"],
        )


@dataclass(frozen=True)
class PreflightRuntimeMeasurement:
    supervisor_source_path: str
    supervisor_source_file_sha256: str
    supervisor_binary_sha256: str
    supervisor_build_identity: PreflightSupervisorBuildIdentity
    protocol_version: int
    executable_path_hash: str
    executable_sha256: str
    implementation: str
    version: str
    stdlib_modules: tuple[PreflightStdlibModuleIdentity, ...]
    stdlib_digest: str
    platform_runtime: PreflightRuntimePlatformAttestation
    core_bootstrap_source_digest: str
    preflight_runtime_digest: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "supervisorSourcePath", "supervisorSourceFileSha256",
            "supervisorBinarySha256", "supervisorBuildIdentity", "protocolVersion",
            "executablePathHash", "executableSha256", "implementation", "version",
            "stdlibModules", "stdlibDigest", "platformRuntime",
            "coreBootstrapSourceDigest", "preflightRuntimeDigest",
        }
    )

    def __post_init__(self) -> None:
        validate_repo_relative_path(self.supervisor_source_path)
        for value in (
            self.supervisor_source_file_sha256, self.supervisor_binary_sha256,
            self.executable_path_hash, self.executable_sha256,
            self.core_bootstrap_source_digest, self.stdlib_digest,
            self.preflight_runtime_digest,
        ):
            validate_sha256(value)
        if type(self.supervisor_build_identity) is not PreflightSupervisorBuildIdentity:
            raise ValueError("supervisorBuildIdentity must be a preflight build")
        if type(self.protocol_version) is not int or self.protocol_version != 1:
            raise ValueError("protocolVersion must be integer 1")
        _validate_non_empty_utf8(self.implementation, field="implementation")
        _validate_non_empty_utf8(self.version, field="version")
        if type(self.stdlib_modules) is not tuple or any(
            type(item) is not PreflightStdlibModuleIdentity for item in self.stdlib_modules
        ):
            raise ValueError("stdlibModules must be a tuple of preflight modules")
        names = tuple(item.module_name for item in self.stdlib_modules)
        if len(set(names)) != len(names) or names != tuple(
            sorted(names, key=lambda name: name.encode("utf-8"))
        ):
            raise ValueError("stdlibModules must have unique UTF-8 lexical names")
        if self.stdlib_digest != domain_separated_sha256(
            _STDLIB_CLOSURE_DOMAIN, [item.to_dict() for item in self.stdlib_modules]
        ):
            raise ValueError("stdlibDigest does not match module closure")
        if type(self.platform_runtime) is not PreflightRuntimePlatformAttestation:
            raise ValueError("platformRuntime must be a preflight platform")
        if self.preflight_runtime_digest != self.expected_digest():
            raise ValueError("preflightRuntimeDigest does not match measurement")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "supervisorSourcePath": self.supervisor_source_path,
            "supervisorSourceFileSha256": self.supervisor_source_file_sha256,
            "supervisorBinarySha256": self.supervisor_binary_sha256,
            "supervisorBuildIdentity": self.supervisor_build_identity.to_dict(),
            "protocolVersion": self.protocol_version,
            "executablePathHash": self.executable_path_hash,
            "executableSha256": self.executable_sha256,
            "implementation": self.implementation,
            "version": self.version,
            "stdlibModules": [item.to_dict() for item in self.stdlib_modules],
            "stdlibDigest": self.stdlib_digest,
            "platformRuntime": self.platform_runtime.to_dict(),
            "coreBootstrapSourceDigest": self.core_bootstrap_source_digest,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(_PREFLIGHT_RUNTIME_DOMAIN, self._digest_payload())

    def to_dict(self) -> dict[str, object]:
        return {**self._digest_payload(), "preflightRuntimeDigest": self.preflight_runtime_digest}

    @classmethod
    def create(
        cls,
        *,
        supervisor_source_path: str,
        supervisor_source_file_sha256: str,
        supervisor_binary_sha256: str,
        supervisor_build_identity: PreflightSupervisorBuildIdentity,
        executable_path_hash: str,
        executable_sha256: str,
        implementation: str,
        version: str,
        stdlib_modules: tuple[PreflightStdlibModuleIdentity, ...],
        platform_runtime: PreflightRuntimePlatformAttestation,
        core_bootstrap_source_digest: str,
    ) -> "PreflightRuntimeMeasurement":
        stdlib_digest = domain_separated_sha256(
            _STDLIB_CLOSURE_DOMAIN,
            [item.to_dict() for item in stdlib_modules],
        )
        payload = {
            "supervisorSourcePath": supervisor_source_path,
            "supervisorSourceFileSha256": supervisor_source_file_sha256,
            "supervisorBinarySha256": supervisor_binary_sha256,
            "supervisorBuildIdentity": supervisor_build_identity.to_dict(),
            "protocolVersion": 1,
            "executablePathHash": executable_path_hash,
            "executableSha256": executable_sha256,
            "implementation": implementation,
            "version": version,
            "stdlibModules": [item.to_dict() for item in stdlib_modules],
            "stdlibDigest": stdlib_digest,
            "platformRuntime": platform_runtime.to_dict(),
            "coreBootstrapSourceDigest": core_bootstrap_source_digest,
        }
        return cls(
            supervisor_source_path,
            supervisor_source_file_sha256,
            supervisor_binary_sha256,
            supervisor_build_identity,
            1,
            executable_path_hash,
            executable_sha256,
            implementation,
            version,
            stdlib_modules,
            stdlib_digest,
            platform_runtime,
            core_bootstrap_source_digest,
            domain_separated_sha256(_PREFLIGHT_RUNTIME_DOMAIN, payload),
        )

    @classmethod
    def from_dict(cls, value: object) -> "PreflightRuntimeMeasurement":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        if type(data["stdlibModules"]) is not list:
            raise ValueError("stdlibModules must be an array")
        return cls(
            supervisor_source_path=data["supervisorSourcePath"],
            supervisor_source_file_sha256=data["supervisorSourceFileSha256"],
            supervisor_binary_sha256=data["supervisorBinarySha256"],
            supervisor_build_identity=PreflightSupervisorBuildIdentity.from_dict(
                data["supervisorBuildIdentity"]
            ),
            protocol_version=data["protocolVersion"],
            executable_path_hash=data["executablePathHash"],
            executable_sha256=data["executableSha256"],
            implementation=data["implementation"],
            version=data["version"],
            stdlib_modules=tuple(
                PreflightStdlibModuleIdentity.from_dict(item) for item in data["stdlibModules"]
            ),
            stdlib_digest=data["stdlibDigest"],
            platform_runtime=PreflightRuntimePlatformAttestation.from_dict(data["platformRuntime"]),
            core_bootstrap_source_digest=data["coreBootstrapSourceDigest"],
            preflight_runtime_digest=data["preflightRuntimeDigest"],
        )

    def validate_runtime_paths(self, paths: tuple[RuntimePathInput, ...]) -> None:
        """Check exact caller inventory; live file/loader verification is worker-owned."""
        if type(paths) is not tuple or any(type(item) is not RuntimePathInput for item in paths):
            raise ValueError("runtimePaths must be a tuple of RuntimePathInput")
        keys = tuple(item.identity_key for item in paths)
        if len(set(keys)) != len(keys) or keys != tuple(sorted(keys)):
            raise ValueError("runtimePaths must have unique canonical identities")
        expected = {
            (RuntimePathKind.SUPERVISOR_BINARY, None),
            (RuntimePathKind.PYTHON_EXECUTABLE, None),
            (RuntimePathKind.COMPILER_BINARY, None),
            *((RuntimePathKind.STDLIB_MODULE, item.module_name)
              for item in self.stdlib_modules if item.origin_kind is StdlibModuleOriginKind.FILE),
        }
        identities = tuple((item.kind, item.module_name) for item in paths)
        if len(identities) != len(expected) or set(identities) != expected:
            raise ValueError("runtimePaths must match the exact preflight file closure")
        by_kind = {item.kind: item for item in paths if item.module_name is None}
        if by_kind[RuntimePathKind.PYTHON_EXECUTABLE].expected_path_hash != self.executable_path_hash:
            raise ValueError("Python path hash does not match measurement")
        if (
            by_kind[RuntimePathKind.COMPILER_BINARY].expected_path_hash
            != self.supervisor_build_identity.compiler_executable_path_hash
        ):
            raise ValueError("compiler path hash does not match measurement")


@dataclass(frozen=True)
class RuntimeMeasurementBasis:
    """Reviewed static facts completed by worker-owned file/loader measurement."""

    supervisor_source_path: str
    supervisor_source_file_sha256: str
    supervisor_build_identity: PreflightSupervisorBuildIdentity
    protocol_version: int
    stdlib_modules: tuple[PreflightStdlibModuleIdentity, ...]
    core_bootstrap_source_digest: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset({
        "supervisorSourcePath", "supervisorSourceFileSha256",
        "supervisorBuildIdentity", "protocolVersion", "stdlibModules",
        "coreBootstrapSourceDigest",
    })

    def __post_init__(self) -> None:
        validate_repo_relative_path(self.supervisor_source_path)
        validate_sha256(self.supervisor_source_file_sha256)
        if type(self.supervisor_build_identity) is not PreflightSupervisorBuildIdentity:
            raise ValueError("supervisorBuildIdentity must be a preflight build")
        if type(self.protocol_version) is not int or self.protocol_version != 1:
            raise ValueError("protocolVersion must be integer 1")
        if type(self.stdlib_modules) is not tuple or any(
            type(item) is not PreflightStdlibModuleIdentity
            for item in self.stdlib_modules
        ):
            raise ValueError("stdlibModules must contain preflight module identities")
        names = tuple(item.module_name for item in self.stdlib_modules)
        if names != tuple(sorted(set(names), key=lambda item: item.encode("utf-8"))):
            raise ValueError("stdlibModules must have unique UTF-8 lexical names")
        validate_sha256(self.core_bootstrap_source_digest)

    def to_dict(self) -> dict[str, object]:
        return {
            "supervisorSourcePath": self.supervisor_source_path,
            "supervisorSourceFileSha256": self.supervisor_source_file_sha256,
            "supervisorBuildIdentity": self.supervisor_build_identity.to_dict(),
            "protocolVersion": self.protocol_version,
            "stdlibModules": [item.to_dict() for item in self.stdlib_modules],
            "coreBootstrapSourceDigest": self.core_bootstrap_source_digest,
        }

    @classmethod
    def from_dict(cls, value: object) -> "RuntimeMeasurementBasis":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        if type(data["stdlibModules"]) is not list:
            raise ValueError("stdlibModules must be an array")
        return cls(
            data["supervisorSourcePath"],
            data["supervisorSourceFileSha256"],
            PreflightSupervisorBuildIdentity.from_dict(data["supervisorBuildIdentity"]),
            data["protocolVersion"],
            tuple(
                PreflightStdlibModuleIdentity.from_dict(item)
                for item in data["stdlibModules"]
            ),
            data["coreBootstrapSourceDigest"],
        )

    @classmethod
    def from_measurement(
        cls, measurement: PreflightRuntimeMeasurement
    ) -> "RuntimeMeasurementBasis":
        if type(measurement) is not PreflightRuntimeMeasurement:
            raise ValueError("measurement must be PreflightRuntimeMeasurement")
        return cls(
            measurement.supervisor_source_path,
            measurement.supervisor_source_file_sha256,
            measurement.supervisor_build_identity,
            measurement.protocol_version,
            measurement.stdlib_modules,
            measurement.core_bootstrap_source_digest,
        )

    def validate_measurement(self, measurement: PreflightRuntimeMeasurement) -> None:
        if type(measurement) is not PreflightRuntimeMeasurement:
            raise ValueError("measurement must be PreflightRuntimeMeasurement")
        if self != RuntimeMeasurementBasis.from_measurement(measurement):
            raise ValueError("runtime measurement differs from request basis")


@dataclass(frozen=True)
class CaptureRuntimeRequest:
    identity: WorkerRequestIdentity
    runtime_paths: tuple[RuntimePathInput, ...]
    measurement_basis: RuntimeMeasurementBasis
    file_limit: int = 1024
    single_file_byte_limit: int = 256 * 1024 * 1024
    cumulative_byte_limit: int = 512 * 1024 * 1024
    timeout_seconds: int = 60

    def __post_init__(self) -> None:
        for name, value, expected in (
            ("fileLimit", self.file_limit, 1024),
            ("singleFileByteLimit", self.single_file_byte_limit, 256 * 1024 * 1024),
            ("cumulativeByteLimit", self.cumulative_byte_limit, 512 * 1024 * 1024),
            ("timeoutSeconds", self.timeout_seconds, 60),
        ):
            if type(value) is not int or value != expected:
                raise ValueError(f"{name} must equal fixed runtime capture limit")
        if (
            type(self.runtime_paths) is not tuple
            or not 3 <= len(self.runtime_paths) <= self.file_limit
            or any(type(item) is not RuntimePathInput for item in self.runtime_paths)
        ):
            raise ValueError("runtimePaths must contain 3..1024 concrete paths")
        keys = tuple(item.identity_key for item in self.runtime_paths)
        if len(set(keys)) != len(keys) or keys != tuple(sorted(keys)):
            raise ValueError("runtimePaths must have unique canonical identities")
        identities = tuple((item.kind, item.module_name) for item in self.runtime_paths)
        if len(set(identities)) != len(identities):
            raise ValueError("runtimePaths contains duplicate kind/module identities")
        for kind in (
            RuntimePathKind.SUPERVISOR_BINARY, RuntimePathKind.PYTHON_EXECUTABLE,
            RuntimePathKind.COMPILER_BINARY,
        ):
            if identities.count((kind, None)) != 1:
                raise ValueError("runtimePaths requires exactly one executable of each kind")
        if type(self.measurement_basis) is not RuntimeMeasurementBasis:
            raise ValueError("measurementBasis must be RuntimeMeasurementBasis")
        expected_modules = {
            item.module_name
            for item in self.measurement_basis.stdlib_modules
            if item.origin_kind is StdlibModuleOriginKind.FILE
        }
        actual_modules = {
            item.module_name
            for item in self.runtime_paths
            if item.kind is RuntimePathKind.STDLIB_MODULE
        }
        if actual_modules != expected_modules:
            raise ValueError("runtimePaths must match measurementBasis FILE stdlib closure")
        compiler = next(
            item for item in self.runtime_paths
            if item.kind is RuntimePathKind.COMPILER_BINARY
        )
        if (
            compiler.expected_path_hash
            != self.measurement_basis.supervisor_build_identity.compiler_executable_path_hash
        ):
            raise ValueError("compiler path differs from measurementBasis")
        _validate_worker_request_binding(self.identity, WorkerKind.RUNTIME_CAPTURE, self._payload())

    def _payload(self) -> dict[str, object]:
        return {
            "runtimePaths": [item.to_dict() for item in self.runtime_paths],
            "measurementBasis": self.measurement_basis.to_dict(),
            "fileLimit": self.file_limit,
            "singleFileByteLimit": self.single_file_byte_limit,
            "cumulativeByteLimit": self.cumulative_byte_limit,
            "timeoutSeconds": self.timeout_seconds,
        }

    def to_dict(self) -> dict[str, object]:
        return {"identity": self.identity.to_dict(), **self._payload()}

    @classmethod
    def from_dict(cls, value: object) -> "CaptureRuntimeRequest":
        fields = ("fileLimit", "singleFileByteLimit", "cumulativeByteLimit", "timeoutSeconds")
        data = _closed_mapping(
            value, schema=cls.__name__,
            keys=frozenset(("identity", "runtimePaths", "measurementBasis", *fields)),
        )
        paths = data["runtimePaths"]
        if type(paths) is not list or not 3 <= len(paths) <= 1024:
            raise ValueError("runtimePaths must be a bounded wire array")
        return cls(
            WorkerRequestIdentity.from_dict(data["identity"]),
            tuple(RuntimePathInput.from_dict(item) for item in paths),
            RuntimeMeasurementBasis.from_dict(data["measurementBasis"]),
            *(data[field] for field in fields),
        )


_RUNTIME_CAPTURE_RESULT_KEYS = frozenset({
    "identity", "status", "captureId", "measurement", "files",
    "runtimeCaptureBundleDigest", "runtimeCaptureDigest", "workerResultDigest",
    "failureCode", "diagnostic",
})


@dataclass(frozen=True)
class CaptureRuntimeCompleted:
    identity: WorkerRequestIdentity
    capture_id: str
    measurement: PreflightRuntimeMeasurement
    files: tuple[CapturedRuntimeFile, ...]
    runtime_capture_bundle_digest: str
    runtime_capture_digest: str
    worker_result_digest: str
    status: ClassVar[str] = "COMPLETED"

    def __post_init__(self) -> None:
        if type(self.identity) is not WorkerRequestIdentity or self.identity.worker_kind is not WorkerKind.RUNTIME_CAPTURE:
            raise ValueError("capture result must match RUNTIME_CAPTURE")
        _validate_non_empty_utf8(self.capture_id, field="captureId", maximum_bytes=256)
        if type(self.measurement) is not PreflightRuntimeMeasurement:
            raise ValueError("measurement must be PreflightRuntimeMeasurement")
        if (
            type(self.files) is not tuple or not 3 <= len(self.files) <= 1024
            or any(type(item) is not CapturedRuntimeFile for item in self.files)
        ):
            raise ValueError("files must be 3..1024 immutable captured files")
        keys = tuple(item.identity_key for item in self.files)
        if len(set(keys)) != len(keys) or keys != tuple(sorted(keys)):
            raise ValueError("files must have unique canonical identities")
        if any(item.byte_length > 256 * 1024 * 1024 for item in self.files):
            raise ValueError("captured file exceeds singleFileByteLimit")
        if sum(item.byte_length for item in self.files) > 512 * 1024 * 1024:
            raise ValueError("captured files exceed cumulativeByteLimit")
        validate_sha256(self.runtime_capture_bundle_digest)
        validate_sha256(self.runtime_capture_digest)
        validate_sha256(self.worker_result_digest)
        if self.runtime_capture_digest != domain_separated_sha256(
            _RUNTIME_CAPTURE_DOMAIN, self._capture_payload()
        ):
            raise ValueError("runtimeCaptureDigest does not match complete capture")
        if self.worker_result_digest != domain_separated_sha256(_WORKER_RESULT_DOMAIN, self._payload()):
            raise ValueError("workerResultDigest mismatch")
        self._validate_file_closure()

    def _validate_file_closure(self) -> None:
        _validate_runtime_capture_files(self.measurement, self.files)

    def _capture_payload(self) -> dict[str, object]:
        return {
            "captureId": self.capture_id, "measurement": self.measurement.to_dict(),
            "files": [item.to_dict() for item in self.files],
            "runtimeCaptureBundleDigest": self.runtime_capture_bundle_digest,
        }

    def _payload(self) -> dict[str, object]:
        return {
            "identity": self.identity.to_dict(), "status": self.status,
            **self._capture_payload(), "runtimeCaptureDigest": self.runtime_capture_digest,
            "failureCode": None, "diagnostic": None,
        }

    def to_dict(self) -> dict[str, object]:
        return {**self._payload(), "workerResultDigest": self.worker_result_digest}

    @classmethod
    def from_dict(cls, value: object) -> "CaptureRuntimeCompleted":
        data = _closed_mapping(value, schema=cls.__name__, keys=_RUNTIME_CAPTURE_RESULT_KEYS)
        if data["status"] != "COMPLETED" or data["failureCode"] is not None or data["diagnostic"] is not None:
            raise ValueError("completed runtime result has invalid branch fields")
        if type(data["files"]) is not list or not 3 <= len(data["files"]) <= 1024:
            raise ValueError("files must be a bounded wire array")
        return cls(
            WorkerRequestIdentity.from_dict(data["identity"]), data["captureId"],
            PreflightRuntimeMeasurement.from_dict(data["measurement"]),
            tuple(CapturedRuntimeFile.from_dict(item) for item in data["files"]),
            data["runtimeCaptureBundleDigest"], data["runtimeCaptureDigest"],
            data["workerResultDigest"],
        )


def _validate_runtime_capture_files(
    measurement: PreflightRuntimeMeasurement, files: tuple[CapturedRuntimeFile, ...]
) -> None:
    if type(measurement) is not PreflightRuntimeMeasurement:
        raise ValueError("measurement must be PreflightRuntimeMeasurement")
    if (
        type(files) is not tuple or not 3 <= len(files) <= 1024
        or any(type(item) is not CapturedRuntimeFile for item in files)
    ):
        raise ValueError("files must be 3..1024 concrete captured files")
    keys = tuple(item.identity_key for item in files)
    if keys != tuple(sorted(set(keys))):
        raise ValueError("files must have unique canonical identities")
    if any(item.byte_length > 256 * 1024 * 1024 for item in files):
        raise ValueError("captured file exceeds singleFileByteLimit")
    if sum(item.byte_length for item in files) > 512 * 1024 * 1024:
        raise ValueError("captured files exceed cumulativeByteLimit")
    expected: dict[tuple[RuntimeFileKind, str | None, str | None, str | None], tuple[str | None, str]] = {
        (RuntimeFileKind.SUPERVISOR_BINARY, None, None, None): (None, measurement.supervisor_binary_sha256),
        (RuntimeFileKind.PYTHON_EXECUTABLE, None, None, None): (measurement.executable_path_hash, measurement.executable_sha256),
        (RuntimeFileKind.COMPILER_BINARY, None, None, None): (
            measurement.supervisor_build_identity.compiler_executable_path_hash,
            measurement.supervisor_build_identity.compiler_binary_sha256,
        ),
    }
    for module in measurement.stdlib_modules:
        if module.origin_kind is StdlibModuleOriginKind.FILE:
            expected[(RuntimeFileKind.STDLIB_MODULE, module.module_name, None, None)] = (
                None, module.file_sha256
            )
    for image in measurement.platform_runtime.loaded_images:
        if image.origin_kind is RuntimeImageOriginKind.STANDALONE_FILE:
            expected[(RuntimeFileKind.LOADED_RUNTIME_IMAGE, None, image.logical_name, image.path_hash)] = (
                image.path_hash, image.file_sha256
            )
    actual = tuple(
        (item.kind, item.module_name, item.logical_name,
         item.path_hash if item.kind is RuntimeFileKind.LOADED_RUNTIME_IMAGE else None)
        for item in files
    )
    if len(actual) != len(expected) or set(actual) != set(expected):
        raise ValueError("captured files must equal the measured file-backed closure")
    for item in files:
        path_hash, file_hash = expected[(
            item.kind, item.module_name, item.logical_name,
            item.path_hash if item.kind is RuntimeFileKind.LOADED_RUNTIME_IMAGE else None,
        )]
        if item.file_sha256 != file_hash or (path_hash is not None and item.path_hash != path_hash):
            raise ValueError("captured file does not match measured identity")


@dataclass(frozen=True)
class CaptureRuntimeFailed:
    identity: WorkerRequestIdentity
    failure_code: FinalizerFailureCode
    diagnostic: str
    worker_result_digest: str
    status: ClassVar[str] = "FAILED"

    def __post_init__(self) -> None:
        if type(self.identity) is not WorkerRequestIdentity or self.identity.worker_kind is not WorkerKind.RUNTIME_CAPTURE:
            raise ValueError("capture result must match RUNTIME_CAPTURE")
        if type(self.failure_code) is not FinalizerFailureCode or self.failure_code not in (
            FinalizerFailureCode.RUNTIME_MISMATCH, FinalizerFailureCode.TIMED_OUT,
            FinalizerFailureCode.PROCESS_FAILED,
        ):
            raise ValueError("failureCode is outside runtime capture failure branch")
        _validate_non_empty_utf8(self.diagnostic, field="diagnostic", maximum_bytes=4096)
        if self.worker_result_digest != domain_separated_sha256(_WORKER_RESULT_DOMAIN, self._payload()):
            raise ValueError("workerResultDigest mismatch")

    def _payload(self) -> dict[str, object]:
        return {
            "identity": self.identity.to_dict(), "status": self.status, "captureId": None,
            "measurement": None, "files": [], "runtimeCaptureBundleDigest": None,
            "runtimeCaptureDigest": None, "failureCode": self.failure_code.value,
            "diagnostic": self.diagnostic,
        }

    def to_dict(self) -> dict[str, object]:
        return {**self._payload(), "workerResultDigest": self.worker_result_digest}

    @classmethod
    def from_dict(cls, value: object) -> "CaptureRuntimeFailed":
        data = _closed_mapping(value, schema=cls.__name__, keys=_RUNTIME_CAPTURE_RESULT_KEYS)
        if (
            data["status"] != "FAILED" or any(
                data[field] is not None for field in (
                    "captureId", "measurement", "runtimeCaptureBundleDigest", "runtimeCaptureDigest"
                )
            ) or type(data["files"]) is not list or data["files"]
        ):
            raise ValueError("failed runtime result has invalid branch fields")
        return cls(
            WorkerRequestIdentity.from_dict(data["identity"]),
            _enum_from_wire(FinalizerFailureCode, data["failureCode"], field="failureCode"),
            data["diagnostic"], data["workerResultDigest"],
        )


def capture_runtime_result_from_dict(
    value: object, request: CaptureRuntimeRequest
) -> Union[CaptureRuntimeCompleted, CaptureRuntimeFailed]:
    if type(request) is not CaptureRuntimeRequest or not isinstance(value, Mapping):
        raise ValueError("capture result requires its concrete request")
    if value.get("status") == "COMPLETED":
        result = CaptureRuntimeCompleted.from_dict(value)
    elif value.get("status") == "FAILED":
        result = CaptureRuntimeFailed.from_dict(value)
    else:
        raise ValueError("unknown runtime capture result status")
    if result.identity != request.identity:
        raise ValueError("capture result belongs to another request")
    if type(result) is CaptureRuntimeCompleted:
        request.measurement_basis.validate_measurement(result.measurement)
        result.measurement.validate_runtime_paths(request.runtime_paths)
        captured = {
            (item.kind.value, item.module_name): item for item in result.files
            if item.kind is not RuntimeFileKind.LOADED_RUNTIME_IMAGE
        }
        for path in request.runtime_paths:
            if captured[(path.kind.value, path.module_name)].path_hash != path.expected_path_hash:
                raise ValueError("captured file path does not match requested identity")
    return result


@dataclass
class PreflightRuntimeCapture:
    capture_id: str
    measurement: PreflightRuntimeMeasurement
    files: tuple[CapturedRuntimeFile, ...]
    runtime_capture_bundle_digest: str
    temporary_directory_claim: DescriptorClaim
    runtime_capture_digest: str
    consumed: bool = False

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "captureId",
            "measurement",
            "files",
            "runtimeCaptureBundleDigest",
            "temporaryDirectoryClaim",
            "runtimeCaptureDigest",
            "consumed",
        }
    )

    def __post_init__(self) -> None:
        _validate_non_empty_utf8(
            self.capture_id,
            field="captureId",
            maximum_bytes=256,
        )
        _validate_runtime_capture_files(self.measurement, self.files)
        validate_sha256(self.runtime_capture_bundle_digest)
        if (
            type(self.temporary_directory_claim) is not DescriptorClaim
            or self.temporary_directory_claim.role
            is not DescriptorRole.TEMPORARY_DIRECTORY
        ):
            raise ValueError(
                "temporaryDirectoryClaim must bind a temporary directory"
            )
        if type(self.consumed) is not bool:
            raise ValueError("consumed must be boolean")
        validate_sha256(self.runtime_capture_digest)
        if self.runtime_capture_digest != self.expected_digest():
            raise ValueError("runtimeCaptureDigest does not match capture")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "captureId": self.capture_id,
            "measurement": self.measurement.to_dict(),
            "files": [item.to_dict() for item in self.files],
            "runtimeCaptureBundleDigest": self.runtime_capture_bundle_digest,
        }

    def expected_digest(self) -> str:
        return domain_separated_sha256(
            _RUNTIME_CAPTURE_DOMAIN,
            self._digest_payload(),
        )

    def consume(self) -> None:
        if self.consumed:
            raise ValueError("runtime capture is already consumed")
        self.consumed = True

    def to_dict(self) -> dict[str, object]:
        return {
            **self._digest_payload(),
            "temporaryDirectoryClaim": self.temporary_directory_claim.to_dict(),
            "runtimeCaptureDigest": self.runtime_capture_digest,
            "consumed": self.consumed,
        }

    @classmethod
    def from_completed(
        cls,
        result: CaptureRuntimeCompleted,
    ) -> "PreflightRuntimeCapture":
        if type(result) is not CaptureRuntimeCompleted:
            raise ValueError("runtime capture requires completed worker result")
        claims = tuple(
            claim
            for claim in result.identity.descriptor_claims
            if claim.role is DescriptorRole.TEMPORARY_DIRECTORY
        )
        if len(claims) != 1:
            raise ValueError(
                "runtime capture requires one temporary-directory claim"
            )
        return cls(
            capture_id=result.capture_id,
            measurement=result.measurement,
            files=result.files,
            runtime_capture_bundle_digest=result.runtime_capture_bundle_digest,
            temporary_directory_claim=claims[0],
            runtime_capture_digest=result.runtime_capture_digest,
        )

    @classmethod
    def from_dict(cls, value: object) -> "PreflightRuntimeCapture":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        if type(data["files"]) is not list:
            raise ValueError("files must be an array")
        return cls(
            capture_id=data["captureId"],
            measurement=PreflightRuntimeMeasurement.from_dict(
                data["measurement"]
            ),
            files=tuple(
                CapturedRuntimeFile.from_dict(item) for item in data["files"]
            ),
            runtime_capture_bundle_digest=data["runtimeCaptureBundleDigest"],
            temporary_directory_claim=DescriptorClaim.from_dict(
                data["temporaryDirectoryClaim"]
            ),
            runtime_capture_digest=data["runtimeCaptureDigest"],
            consumed=data["consumed"],
        )


@dataclass(frozen=True)
class AuthorityRuntimeArtifactRef:
    workspace_id: str
    gate_id: str
    authorization_id: str
    kind: RuntimeFileKind
    module_name: str | None
    logical_name: str | None
    origin_kind: RuntimeImageOriginKind | None
    content_sha256: str
    byte_length: int
    authority_runtime_ref_digest: str
    artifact_kind: ClassVar[str] = "acceptance-finalizer-authority-runtime-ref"
    schema_version: ClassVar[int] = 1

    def __post_init__(self) -> None:
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gateId")
        _validate_slug(self.authorization_id, field="authorizationId")
        # Reuse the canonical runtime-kind nullability contract; refs have no path.
        CapturedRuntimeFile(
            self.kind, self.module_name, self.logical_name, self.origin_kind,
            "0" * 64, self.content_sha256, self.byte_length,
        )
        if self.byte_length > 256 * 1024 * 1024:
            raise ValueError("authority runtime file exceeds single-file limit")
        validate_sha256(self.authority_runtime_ref_digest)
        if self.authority_runtime_ref_digest != domain_separated_sha256(
            _AUTHORITY_RUNTIME_REF_DOMAIN, self._payload()
        ):
            raise ValueError("authorityRuntimeRefDigest mismatch")

    def _payload(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind, "schemaVersion": self.schema_version,
            "workspaceId": self.workspace_id, "gateId": self.gate_id,
            "authorizationId": self.authorization_id, "kind": self.kind.value,
            "moduleName": self.module_name, "logicalName": self.logical_name,
            "originKind": None if self.origin_kind is None else self.origin_kind.value,
            "contentSha256": self.content_sha256, "byteLength": self.byte_length,
        }

    def to_dict(self) -> dict[str, object]:
        return {**self._payload(), "authorityRuntimeRefDigest": self.authority_runtime_ref_digest}

    @classmethod
    def from_dict(cls, value: object) -> "AuthorityRuntimeArtifactRef":
        fields = (
            "artifactKind", "schemaVersion", "workspaceId", "gateId", "authorizationId",
            "kind", "moduleName", "logicalName", "originKind", "contentSha256",
            "byteLength", "authorityRuntimeRefDigest",
        )
        data = _closed_mapping(value, schema=cls.__name__, keys=frozenset(fields))
        if data["artifactKind"] != cls.artifact_kind or type(data["schemaVersion"]) is not int or data["schemaVersion"] != 1:
            raise ValueError("invalid authority runtime ref schema")
        return cls(
            data["workspaceId"], data["gateId"], data["authorizationId"],
            _enum_from_wire(RuntimeFileKind, data["kind"], field="kind"),
            data["moduleName"], data["logicalName"],
            None if data["originKind"] is None else _enum_from_wire(
                RuntimeImageOriginKind, data["originKind"], field="originKind"
            ),
            data["contentSha256"], data["byteLength"], data["authorityRuntimeRefDigest"],
        )


@dataclass(frozen=True)
class FinalizerMaintenanceRuntimeIdentity:
    worker_source_files: tuple[tuple[str, str, int], ...]
    worker_source_digest: str
    runtime_capture_id: str
    runtime_measurement: PreflightRuntimeMeasurement
    captured_runtime_files: tuple[CapturedRuntimeFile, ...]
    runtime_artifacts: tuple[AuthorityRuntimeArtifactRef, ...]
    runtime_capture_bundle_digest: str
    runtime_capture_digest: str
    maintenance_runtime_digest: str
    protocol_version: ClassVar[int] = 1
    worker_source_rule: ClassVar[str] = "MAINTENANCE_WORKER_SOURCE_V1"

    def __post_init__(self) -> None:
        if (
            type(self.worker_source_files) is not tuple
            or not 1 <= len(self.worker_source_files) <= 64
        ):
            raise ValueError("workerSourceFiles must contain 1..64 immutable triples")
        paths = []
        total = 0
        for item in self.worker_source_files:
            if type(item) is not tuple or len(item) != 3:
                raise ValueError("workerSourceFiles requires immutable triples")
            paths.append(validate_repo_relative_path(item[0]))
            validate_sha256(item[1])
            if type(item[2]) is not int or not 0 <= item[2] <= 8 * 1024 * 1024:
                raise ValueError("worker source file exceeds entry limit")
            total += item[2]
        if paths != sorted(set(paths), key=lambda path: path.encode("utf-8")):
            raise ValueError("workerSourceFiles requires unique lexical paths")
        if "tooling/acceptance/core/finalizer_worker.py" not in paths:
            raise ValueError("maintenance closure must include its fixed worker entrypoint")
        if total > 64 * 1024 * 1024:
            raise ValueError("worker source closure exceeds expanded limit")
        validate_sha256(self.worker_source_digest)
        if self.worker_source_digest != domain_separated_sha256(
            _MAINTENANCE_WORKER_SOURCE_DOMAIN,
            {"workerSourceRule": self.worker_source_rule,
             "workerSourceFiles": [list(item) for item in self.worker_source_files]},
        ):
            raise ValueError("workerSourceDigest mismatch")
        _validate_non_empty_utf8(self.runtime_capture_id, field="runtimeCaptureId", maximum_bytes=256)
        _validate_runtime_capture_files(self.runtime_measurement, self.captured_runtime_files)
        validate_sha256(self.runtime_capture_bundle_digest)
        validate_sha256(self.runtime_capture_digest)
        capture_payload = {
            "captureId": self.runtime_capture_id,
            "measurement": self.runtime_measurement.to_dict(),
            "files": [item.to_dict() for item in self.captured_runtime_files],
            "runtimeCaptureBundleDigest": self.runtime_capture_bundle_digest,
        }
        if self.runtime_capture_digest != domain_separated_sha256(
            _RUNTIME_CAPTURE_DOMAIN, capture_payload
        ):
            raise ValueError("runtimeCaptureDigest mismatch")
        if (
            type(self.runtime_artifacts) is not tuple
            or len(self.runtime_artifacts) != len(self.captured_runtime_files)
            or any(type(ref) is not AuthorityRuntimeArtifactRef for ref in self.runtime_artifacts)
        ):
            raise ValueError("runtimeArtifacts must match capturedRuntimeFiles cardinality")
        authorities = {
            (ref.workspace_id, ref.gate_id, ref.authorization_id) for ref in self.runtime_artifacts
        }
        if len(authorities) != 1:
            raise ValueError("runtimeArtifacts must belong to one workspace/Gate/authorization")
        for ref, captured in zip(self.runtime_artifacts, self.captured_runtime_files):
            if (
                ref.kind, ref.module_name, ref.logical_name, ref.origin_kind,
                ref.content_sha256, ref.byte_length,
            ) != (
                captured.kind, captured.module_name, captured.logical_name, captured.origin_kind,
                captured.file_sha256, captured.byte_length,
            ):
                raise ValueError("runtimeArtifacts must match captured files in exact order")
        validate_sha256(self.maintenance_runtime_digest)
        if self.maintenance_runtime_digest != domain_separated_sha256(
            _MAINTENANCE_RUNTIME_DOMAIN, self._payload()
        ):
            raise ValueError("maintenanceRuntimeDigest mismatch")

    def _payload(self) -> dict[str, object]:
        return {
            "protocolVersion": self.protocol_version, "workerSourceRule": self.worker_source_rule,
            "workerSourceFiles": [list(item) for item in self.worker_source_files],
            "workerSourceDigest": self.worker_source_digest,
            "runtimeCaptureId": self.runtime_capture_id,
            "runtimeMeasurement": self.runtime_measurement.to_dict(),
            "capturedRuntimeFiles": [item.to_dict() for item in self.captured_runtime_files],
            "runtimeArtifacts": [item.to_dict() for item in self.runtime_artifacts],
            "runtimeCaptureBundleDigest": self.runtime_capture_bundle_digest,
            "runtimeCaptureDigest": self.runtime_capture_digest,
        }

    def to_dict(self) -> dict[str, object]:
        return {**self._payload(), "maintenanceRuntimeDigest": self.maintenance_runtime_digest}

    @classmethod
    def from_dict(cls, value: object) -> "FinalizerMaintenanceRuntimeIdentity":
        fields = (
            "protocolVersion", "workerSourceRule", "workerSourceFiles", "workerSourceDigest",
            "runtimeCaptureId", "runtimeMeasurement", "capturedRuntimeFiles", "runtimeArtifacts",
            "runtimeCaptureBundleDigest", "runtimeCaptureDigest", "maintenanceRuntimeDigest",
        )
        data = _closed_mapping(value, schema=cls.__name__, keys=frozenset(fields))
        if type(data["protocolVersion"]) is not int or data["protocolVersion"] != 1 or data["workerSourceRule"] != cls.worker_source_rule:
            raise ValueError("invalid maintenance runtime protocol/source rule")
        sources = data["workerSourceFiles"]
        if type(sources) is not list or not 1 <= len(sources) <= 64 or any(
            type(item) is not list or len(item) != 3 for item in sources
        ):
            raise ValueError("workerSourceFiles must be a bounded triple array")
        for field in ("capturedRuntimeFiles", "runtimeArtifacts"):
            if type(data[field]) is not list or not 3 <= len(data[field]) <= 1024:
                raise ValueError(f"{field} must be a bounded wire array")
        return cls(
            tuple(tuple(item) for item in sources), data["workerSourceDigest"],
            data["runtimeCaptureId"], PreflightRuntimeMeasurement.from_dict(data["runtimeMeasurement"]),
            tuple(CapturedRuntimeFile.from_dict(item) for item in data["capturedRuntimeFiles"]),
            tuple(AuthorityRuntimeArtifactRef.from_dict(item) for item in data["runtimeArtifacts"]),
            data["runtimeCaptureBundleDigest"], data["runtimeCaptureDigest"], data["maintenanceRuntimeDigest"],
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
            [
                item.without_artifact_ref_dict()
                for item in self.stdlib_modules
            ],
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
            [
                item.without_artifact_ref_dict()
                for item in stdlib_modules
            ],
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


def materialize_runtime_identity(
    measurement: PreflightRuntimeMeasurement,
    captured_files: tuple[CapturedRuntimeFile, ...],
    runtime_artifacts: tuple[RuntimeEvidenceArtifact, ...],
    supervisor_source_artifact: ArtifactRef,
) -> FinalizerRuntimeIdentity:
    """Insert only run-scoped refs into one validated preflight measurement."""
    if type(measurement) is not PreflightRuntimeMeasurement:
        raise ValueError("measurement must be PreflightRuntimeMeasurement")
    _validate_runtime_capture_files(measurement, captured_files)
    if (
        type(runtime_artifacts) is not tuple
        or len(runtime_artifacts) != len(captured_files)
        or any(type(item) is not RuntimeEvidenceArtifact for item in runtime_artifacts)
    ):
        raise ValueError(
            "runtimeArtifacts must match capturedFiles cardinality"
        )
    if tuple(item.identity_key for item in runtime_artifacts) != tuple(
        item.identity_key for item in captured_files
    ):
        raise ValueError(
            "runtimeArtifacts must preserve capturedFiles canonical order"
        )
    for captured, artifact in zip(captured_files, runtime_artifacts):
        if artifact.captured != captured:
            raise ValueError(
                "runtimeArtifacts must equal capturedFiles before ref insertion"
            )
    _validate_ref_content(
        supervisor_source_artifact,
        field="supervisorSourceArtifact",
        sha256=measurement.supervisor_source_file_sha256,
    )
    if supervisor_source_artifact.path != measurement.supervisor_source_path:
        raise ValueError(
            "supervisorSourceArtifact path does not match measurement"
        )

    def artifact_for(
        kind: RuntimeFileKind,
        *,
        module_name: str | None = None,
        logical_name: str | None = None,
        path_hash: str | None = None,
    ) -> RuntimeEvidenceArtifact:
        matches = tuple(
            artifact
            for artifact in runtime_artifacts
            if artifact.kind is kind
            and artifact.module_name == module_name
            and artifact.logical_name == logical_name
            and (path_hash is None or artifact.path_hash == path_hash)
        )
        if len(matches) != 1:
            raise ValueError(
                f"runtime artifact identity is not one-to-one: {kind.value}"
            )
        return matches[0]

    supervisor_binary = artifact_for(RuntimeFileKind.SUPERVISOR_BINARY)
    python_executable = artifact_for(RuntimeFileKind.PYTHON_EXECUTABLE)
    compiler_binary = artifact_for(RuntimeFileKind.COMPILER_BINARY)
    preflight_build = measurement.supervisor_build_identity
    build = SupervisorBuildIdentity(
        compiler_executable_path_hash=(
            preflight_build.compiler_executable_path_hash
        ),
        compiler_binary_sha256=preflight_build.compiler_binary_sha256,
        compiler_binary_ref=compiler_binary.ref,
        compiler_version=preflight_build.compiler_version,
        target_triple=preflight_build.target_triple,
        compiler_flags=preflight_build.compiler_flags,
        compiler_flags_digest=preflight_build.compiler_flags_digest,
    )
    stdlib_modules = tuple(
        StdlibModuleIdentity(
            module_name=module.module_name,
            origin_kind=module.origin_kind,
            file_sha256=module.file_sha256,
            artifact_ref=(
                artifact_for(
                    RuntimeFileKind.STDLIB_MODULE,
                    module_name=module.module_name,
                ).ref
                if module.origin_kind is StdlibModuleOriginKind.FILE
                else None
            ),
        )
        for module in measurement.stdlib_modules
    )
    loaded_images: list[LoadedRuntimeImage] = []
    for image in measurement.platform_runtime.loaded_images:
        artifact = (
            artifact_for(
                RuntimeFileKind.LOADED_RUNTIME_IMAGE,
                logical_name=image.logical_name,
                path_hash=image.path_hash,
            )
            if image.origin_kind is RuntimeImageOriginKind.STANDALONE_FILE
            else None
        )
        loaded_images.append(
            LoadedRuntimeImage(
                logical_name=image.logical_name,
                origin_kind=image.origin_kind,
                path_hash=image.path_hash,
                file_sha256=image.file_sha256,
                artifact_ref=None if artifact is None else artifact.ref,
                macho_uuid=image.macho_uuid,
                code_directory_hash=image.code_directory_hash,
                shared_cache_uuid=image.shared_cache_uuid,
            )
        )
    loaded_images_tuple = tuple(loaded_images)
    dynamic_loader = next(
        (
            image
            for image in loaded_images_tuple
            if image.identity_key
            == measurement.platform_runtime.dynamic_loader_identity.identity_key
        ),
        None,
    )
    if dynamic_loader is None:
        raise ValueError("dynamic loader is absent after runtime materialization")
    platform_runtime = RuntimePlatformAttestation.create(
        os_family=measurement.platform_runtime.os_family,
        host_build=measurement.platform_runtime.host_build,
        dynamic_loader_identity=dynamic_loader,
        shared_cache_uuid=measurement.platform_runtime.shared_cache_uuid,
        loaded_images=loaded_images_tuple,
    )
    result = FinalizerRuntimeIdentity.create(
        supervisor_source_path=measurement.supervisor_source_path,
        supervisor_source_file_sha256=(
            measurement.supervisor_source_file_sha256
        ),
        supervisor_source_artifact=supervisor_source_artifact,
        supervisor_binary_ref=supervisor_binary.ref,
        supervisor_binary_sha256=measurement.supervisor_binary_sha256,
        supervisor_build_identity=build,
        executable_path_hash=measurement.executable_path_hash,
        executable_ref=python_executable.ref,
        executable_sha256=measurement.executable_sha256,
        implementation=measurement.implementation,
        version=measurement.version,
        stdlib_modules=stdlib_modules,
        platform_runtime=platform_runtime,
        core_bootstrap_source_digest=measurement.core_bootstrap_source_digest,
    )
    if (
        result.stdlib_digest != measurement.stdlib_digest
        or build.compiler_flags_digest
        != measurement.supervisor_build_identity.compiler_flags_digest
    ):
        raise ValueError("durable runtime projection changed preflight closure")
    return result


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
class ArtifactMaterializationInput:
    role_name: str
    discriminator: str | None
    ref: ArtifactRef
    payload_kind: ArtifactPayloadKind
    schema_id: str | None
    schema_digest: str | None

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset({
        "roleName", "discriminator", "ref", "payloadKind",
        "schemaId", "schemaDigest",
    })

    def __post_init__(self) -> None:
        _validate_role_name(self.role_name)
        _validate_optional_discriminator(self.discriminator)
        if type(self.ref) is not ArtifactRef:
            raise ValueError("ref must be an ArtifactRef")
        if type(self.payload_kind) is not ArtifactPayloadKind:
            raise ValueError("payloadKind must be closed")
        if self.payload_kind is ArtifactPayloadKind.CANONICAL_JSON:
            _validate_slug(self.schema_id, field="schemaId")
            validate_sha256(self.schema_digest)
            if self.ref.media_type != "application/json":
                raise ValueError("CANONICAL_JSON artifact must use application/json")
        elif self.schema_id is not None or self.schema_digest is not None:
            raise ValueError("BINARY artifact forbids schema identity")

    @property
    def identity(self) -> tuple[str, str | None]:
        return (self.role_name, self.discriminator)

    def to_dict(self) -> dict[str, object]:
        return {
            "roleName": self.role_name,
            "discriminator": self.discriminator,
            "ref": self.ref.to_dict(),
            "payloadKind": self.payload_kind.value,
            "schemaId": self.schema_id,
            "schemaDigest": self.schema_digest,
        }

    @classmethod
    def from_dict(cls, value: object) -> "ArtifactMaterializationInput":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        return cls(
            data["roleName"],
            data["discriminator"],
            ArtifactRef.from_dict(data["ref"]),
            _enum_from_wire(
                ArtifactPayloadKind, data["payloadKind"], field="payloadKind"
            ),
            data["schemaId"],
            data["schemaDigest"],
        )

    @classmethod
    def from_snapshot_artifact(
        cls, artifact: SnapshotArtifact
    ) -> "ArtifactMaterializationInput":
        if type(artifact) is not SnapshotArtifact:
            raise ValueError("artifact must be SnapshotArtifact")
        payload = artifact.payload
        return cls(
            artifact.role_name,
            artifact.discriminator,
            artifact.ref,
            (
                ArtifactPayloadKind.BINARY
                if payload is None
                else ArtifactPayloadKind.CANONICAL_JSON
            ),
            None if payload is None else payload.schema_id,
            None if payload is None else payload.schema_digest,
        )


@dataclass(frozen=True)
class MaterializeSnapshotRequest:
    identity: WorkerRequestIdentity
    workspace_id: str
    gate_id: str
    evidence_run_id: str
    evaluation_time: str
    artifact_inventory: tuple[ArtifactMaterializationInput, ...]
    runtime_manifest_ref: ArtifactRef
    source_commit: str
    workspace_digest: str
    canonical_worktree_hash: str
    input_byte_limit: int
    artifact_count_limit: int = 4096
    single_artifact_byte_limit: int = 1024 * 1024 * 1024
    cumulative_hash_byte_limit: int = 8 * 1024 * 1024 * 1024
    timeout_seconds: int = 60

    def __post_init__(self) -> None:
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gateId")
        _validate_run_id(self.evidence_run_id, field="evidenceRunId")
        _canonical_utc_instant(self.evaluation_time, field="evaluationTime")
        _validate_non_empty_utf8(self.source_commit, field="sourceCommit")
        _validate_non_empty_utf8(self.workspace_digest, field="workspaceDigest")
        validate_sha256(self.canonical_worktree_hash)
        _validate_positive_bounded_integer(
            self.input_byte_limit, field="inputByteLimit",
            maximum=FINALIZER_INPUT_BYTE_LIMIT_MAX,
        )
        for field, value, expected in (
            ("artifactCountLimit", self.artifact_count_limit, 4096),
            ("singleArtifactByteLimit", self.single_artifact_byte_limit, 1024 ** 3),
            ("cumulativeHashByteLimit", self.cumulative_hash_byte_limit, 8 * 1024 ** 3),
            ("timeoutSeconds", self.timeout_seconds, 60),
        ):
            if type(value) is not int or value != expected:
                raise ValueError(f"{field} must equal the fixed materialization limit")
        if (
            type(self.artifact_inventory) is not tuple
            or not 1 <= len(self.artifact_inventory) <= self.artifact_count_limit
        ):
            raise ValueError("artifactInventory must contain 1..4096 immutable triples")
        identities = []
        references = []
        for item in self.artifact_inventory:
            if type(item) is not ArtifactMaterializationInput:
                raise ValueError(
                    "artifactInventory requires ArtifactMaterializationInput values"
                )
            identities.append(item.identity)
            references.append(item.ref)
        if tuple(identities) != tuple(sorted(set(identities), key=_role_identity_key)):
            raise ValueError("artifactInventory must have unique canonical role identities")
        if type(self.runtime_manifest_ref) is not ArtifactRef or self.runtime_manifest_ref not in references:
            raise ValueError("runtimeManifestRef must belong to artifactInventory")
        runtime_input = next(
            item for item in self.artifact_inventory
            if item.ref == self.runtime_manifest_ref
        )
        if runtime_input.payload_kind is not ArtifactPayloadKind.CANONICAL_JSON:
            raise ValueError("runtimeManifestRef must be materialized as canonical JSON")
        expected_source = (self.workspace_id, self.gate_id, self.evidence_run_id)
        if any(_artifact_source_identity(ref) != expected_source for ref in references):
            raise ValueError("artifactInventory contains a foreign run reference")
        _validate_worker_request_binding(self.identity, WorkerKind.MATERIALIZER, self._payload())
        owner = self.identity.descriptor_claims[0].owner_binding
        if type(owner) is not RunDirectoryOwnerBinding or (
            owner.workspace_id, owner.gate_id, owner.evidence_run_id
        ) != expected_source:
            raise ValueError("RUN_DIRECTORY owner does not match materialization source")

    def _payload(self) -> dict[str, object]:
        return {
            "workspaceId": self.workspace_id, "gateId": self.gate_id,
            "evidenceRunId": self.evidence_run_id, "evaluationTime": self.evaluation_time,
            "artifactInventory": [
                item.to_dict() for item in self.artifact_inventory
            ],
            "runtimeManifestRef": self.runtime_manifest_ref.to_dict(),
            "sourceCommit": self.source_commit, "workspaceDigest": self.workspace_digest,
            "canonicalWorktreeHash": self.canonical_worktree_hash,
            "inputByteLimit": self.input_byte_limit,
            "artifactCountLimit": self.artifact_count_limit,
            "singleArtifactByteLimit": self.single_artifact_byte_limit,
            "cumulativeHashByteLimit": self.cumulative_hash_byte_limit,
            "timeoutSeconds": self.timeout_seconds,
        }

    def to_dict(self) -> dict[str, object]:
        return {"identity": self.identity.to_dict(), **self._payload()}

    @classmethod
    def from_dict(cls, value: object) -> "MaterializeSnapshotRequest":
        fields = (
            "workspaceId", "gateId", "evidenceRunId", "evaluationTime",
            "artifactInventory", "runtimeManifestRef", "sourceCommit",
            "workspaceDigest", "canonicalWorktreeHash", "inputByteLimit",
            "artifactCountLimit", "singleArtifactByteLimit",
            "cumulativeHashByteLimit", "timeoutSeconds",
        )
        data = _closed_mapping(value, schema=cls.__name__, keys=frozenset(("identity", *fields)))
        inventory = data["artifactInventory"]
        if type(inventory) is not list or not 1 <= len(inventory) <= 4096:
            raise ValueError("artifactInventory must be a bounded wire array")
        if any(type(item) is not dict for item in inventory):
            raise ValueError("artifactInventory requires object entries")
        return cls(
            WorkerRequestIdentity.from_dict(data["identity"]),
            data["workspaceId"], data["gateId"], data["evidenceRunId"], data["evaluationTime"],
            tuple(ArtifactMaterializationInput.from_dict(item) for item in inventory),
            ArtifactRef.from_dict(data["runtimeManifestRef"]),
            *(data[field] for field in fields[6:]),
        )


_MATERIALIZE_RESULT_KEYS = frozenset({
    "identity", "status", "snapshot", "workerResultDigest", "failureCode", "diagnostic",
})


@dataclass(frozen=True)
class MaterializeSnapshotCompleted:
    identity: WorkerRequestIdentity
    snapshot: ReadOnlyEvidenceSnapshot
    worker_result_digest: str
    status: ClassVar[str] = "COMPLETED"

    def __post_init__(self) -> None:
        _validate_worker_result_binding(self.identity, WorkerKind.MATERIALIZER, self.worker_result_digest, self._payload())
        if type(self.snapshot) is not ReadOnlyEvidenceSnapshot:
            raise ValueError("snapshot must be ReadOnlyEvidenceSnapshot")
        if len(self.snapshot.artifacts) > 4096:
            raise ValueError("snapshot exceeds artifactCountLimit")

    def _payload(self) -> dict[str, object]:
        if type(self.snapshot) is not ReadOnlyEvidenceSnapshot:
            raise ValueError("snapshot must be ReadOnlyEvidenceSnapshot")
        return {
            "identity": self.identity.to_dict(), "status": self.status,
            "snapshot": self.snapshot.to_dict(), "failureCode": None, "diagnostic": None,
        }

    def to_dict(self) -> dict[str, object]:
        return {**self._payload(), "workerResultDigest": self.worker_result_digest}

    @classmethod
    def from_dict(cls, value: object) -> "MaterializeSnapshotCompleted":
        data = _closed_mapping(value, schema=cls.__name__, keys=_MATERIALIZE_RESULT_KEYS)
        _validate_completed_worker_branch(data)
        return cls(
            WorkerRequestIdentity.from_dict(data["identity"]),
            ReadOnlyEvidenceSnapshot.from_dict(data["snapshot"]), data["workerResultDigest"],
        )


@dataclass(frozen=True)
class MaterializeSnapshotFailed:
    identity: WorkerRequestIdentity
    failure_code: FinalizerFailureCode
    diagnostic: str
    worker_result_digest: str
    status: ClassVar[str] = "FAILED"

    def __post_init__(self) -> None:
        _validate_worker_failure(
            self.failure_code, self.diagnostic,
            (FinalizerFailureCode.MATERIALIZATION_FAILED, FinalizerFailureCode.TIMED_OUT,
             FinalizerFailureCode.PROCESS_FAILED),
        )
        _validate_worker_result_binding(self.identity, WorkerKind.MATERIALIZER, self.worker_result_digest, self._payload())

    def _payload(self) -> dict[str, object]:
        return {
            "identity": self.identity.to_dict(), "status": self.status, "snapshot": None,
            "failureCode": self.failure_code.value, "diagnostic": self.diagnostic,
        }

    def to_dict(self) -> dict[str, object]:
        return {**self._payload(), "workerResultDigest": self.worker_result_digest}

    @classmethod
    def from_dict(cls, value: object) -> "MaterializeSnapshotFailed":
        data = _closed_mapping(value, schema=cls.__name__, keys=_MATERIALIZE_RESULT_KEYS)
        if data["status"] != "FAILED" or data["snapshot"] is not None:
            raise ValueError("failed materialization forbids snapshot")
        return cls(
            WorkerRequestIdentity.from_dict(data["identity"]),
            _enum_from_wire(FinalizerFailureCode, data["failureCode"], field="failureCode"),
            data["diagnostic"], data["workerResultDigest"],
        )


def _validate_worker_result_binding(
    identity: object, kind: WorkerKind, digest: str, payload: dict[str, object]
) -> None:
    if type(identity) is not WorkerRequestIdentity or identity.worker_kind is not kind:
        raise ValueError("worker result has wrong worker-kind identity")
    validate_sha256(digest)
    if digest != domain_separated_sha256(_WORKER_RESULT_DOMAIN, payload):
        raise ValueError("workerResultDigest mismatch")


def _validate_completed_worker_branch(data: Mapping[str, object]) -> None:
    if data["status"] != "COMPLETED" or data["failureCode"] is not None or data["diagnostic"] is not None:
        raise ValueError("completed worker result forbids failure fields")


def _validate_worker_failure(
    code: object, diagnostic: object, allowed: tuple[FinalizerFailureCode, ...]
) -> None:
    if type(code) is not FinalizerFailureCode or code not in allowed:
        raise ValueError("failureCode is outside the worker failure branch")
    _validate_non_empty_utf8(diagnostic, field="diagnostic", maximum_bytes=4096)


def materialize_snapshot_result_from_dict(
    value: object, request: MaterializeSnapshotRequest
) -> Union[MaterializeSnapshotCompleted, MaterializeSnapshotFailed]:
    if type(request) is not MaterializeSnapshotRequest or not isinstance(value, Mapping):
        raise ValueError("materialization result requires its concrete request")
    if value.get("status") == "COMPLETED":
        result = MaterializeSnapshotCompleted.from_dict(value)
    elif value.get("status") == "FAILED":
        result = MaterializeSnapshotFailed.from_dict(value)
    else:
        raise ValueError("unknown materialization result status")
    if result.identity != request.identity:
        raise ValueError("materialization result belongs to another request")
    if type(result) is MaterializeSnapshotCompleted:
        snapshot = result.snapshot
        for field in (
            "workspace_id", "gate_id", "evidence_run_id", "evaluation_time",
            "runtime_manifest_ref", "source_commit", "workspace_digest", "canonical_worktree_hash",
        ):
            if getattr(snapshot, field) != getattr(request, field):
                raise ValueError(f"materialized snapshot does not match requested {field}")
        inventory = tuple(
            ArtifactMaterializationInput.from_snapshot_artifact(item)
            for item in snapshot.artifacts
        )
        if inventory != request.artifact_inventory:
            raise ValueError("materialized snapshot does not match exact artifact inventory")
        if len(canonical_json_bytes(snapshot.to_dict())) > request.input_byte_limit:
            raise ValueError("materialized snapshot exceeds inputByteLimit")
    return result


@dataclass(frozen=True)
class ExecuteFinalizerRequest:
    identity: WorkerRequestIdentity
    input: FinalizerInput
    timeout_seconds: int
    input_byte_limit: int

    def __post_init__(self) -> None:
        if type(self.input) is not FinalizerInput:
            raise ValueError("input must be FinalizerInput")
        config = FinalizerExecutionConfig(
            self.input.invocation.gate_id, self.input.invocation.finalizer_id,
            self.timeout_seconds, self.input_byte_limit,
        )
        if config.digest() != self.input.invocation.config_digest:
            raise ValueError("execution limits do not match invocation configDigest")
        if len(canonical_json_bytes(self.input.to_dict())) > self.input_byte_limit:
            raise ValueError("finalizer input exceeds inputByteLimit")
        _validate_worker_request_binding(self.identity, WorkerKind.FINALIZER, self._payload())

    def _payload(self) -> dict[str, object]:
        return {
            "input": self.input.to_dict(), "timeoutSeconds": self.timeout_seconds,
            "inputByteLimit": self.input_byte_limit,
        }

    def to_dict(self) -> dict[str, object]:
        return {"identity": self.identity.to_dict(), **self._payload()}

    @classmethod
    def from_dict(cls, value: object) -> "ExecuteFinalizerRequest":
        data = _closed_mapping(
            value, schema=cls.__name__,
            keys=frozenset(("identity", "input", "timeoutSeconds", "inputByteLimit")),
        )
        return cls(
            WorkerRequestIdentity.from_dict(data["identity"]), FinalizerInput.from_dict(data["input"]),
            data["timeoutSeconds"], data["inputByteLimit"],
        )


_EXECUTE_FINALIZER_RESULT_KEYS = frozenset({
    "identity", "status", "childOutcome", "workerResultDigest", "failureCode", "diagnostic",
})


@dataclass(frozen=True)
class ExecuteFinalizerCompleted:
    identity: WorkerRequestIdentity
    child_outcome: FinalizerChildOutcome
    worker_result_digest: str
    status: ClassVar[str] = "COMPLETED"

    def __post_init__(self) -> None:
        _validate_worker_result_binding(self.identity, WorkerKind.FINALIZER, self.worker_result_digest, self._payload())

    def _payload(self) -> dict[str, object]:
        if type(self.child_outcome) is not FinalizerChildOutcome:
            raise ValueError("childOutcome must be FinalizerChildOutcome")
        return {
            "identity": self.identity.to_dict(), "status": self.status,
            "childOutcome": self.child_outcome.to_dict(), "failureCode": None, "diagnostic": None,
        }

    def to_dict(self) -> dict[str, object]:
        return {**self._payload(), "workerResultDigest": self.worker_result_digest}

    @classmethod
    def from_dict(cls, value: object) -> "ExecuteFinalizerCompleted":
        data = _closed_mapping(value, schema=cls.__name__, keys=_EXECUTE_FINALIZER_RESULT_KEYS)
        _validate_completed_worker_branch(data)
        return cls(
            WorkerRequestIdentity.from_dict(data["identity"]),
            FinalizerChildOutcome.from_dict(data["childOutcome"]), data["workerResultDigest"],
        )


@dataclass(frozen=True)
class ExecuteFinalizerFailed:
    identity: WorkerRequestIdentity
    failure_code: FinalizerFailureCode
    diagnostic: str
    worker_result_digest: str
    status: ClassVar[str] = "FAILED"

    def __post_init__(self) -> None:
        _validate_worker_failure(
            self.failure_code, self.diagnostic,
            (FinalizerFailureCode.RUNTIME_MISMATCH, FinalizerFailureCode.INPUT_TOO_LARGE,
             FinalizerFailureCode.OUTPUT_TOO_LARGE, FinalizerFailureCode.TIMED_OUT,
             FinalizerFailureCode.CANCELLED, FinalizerFailureCode.PROCESS_FAILED,
             FinalizerFailureCode.OUTPUT_INVALID),
        )
        _validate_worker_result_binding(self.identity, WorkerKind.FINALIZER, self.worker_result_digest, self._payload())

    def _payload(self) -> dict[str, object]:
        return {
            "identity": self.identity.to_dict(), "status": self.status, "childOutcome": None,
            "failureCode": self.failure_code.value, "diagnostic": self.diagnostic,
        }

    def to_dict(self) -> dict[str, object]:
        return {**self._payload(), "workerResultDigest": self.worker_result_digest}

    @classmethod
    def from_dict(cls, value: object) -> "ExecuteFinalizerFailed":
        data = _closed_mapping(value, schema=cls.__name__, keys=_EXECUTE_FINALIZER_RESULT_KEYS)
        if data["status"] != "FAILED" or data["childOutcome"] is not None:
            raise ValueError("failed execution forbids childOutcome")
        return cls(
            WorkerRequestIdentity.from_dict(data["identity"]),
            _enum_from_wire(FinalizerFailureCode, data["failureCode"], field="failureCode"),
            data["diagnostic"], data["workerResultDigest"],
        )


def execute_finalizer_result_from_dict(
    value: object, request: ExecuteFinalizerRequest
) -> Union[ExecuteFinalizerCompleted, ExecuteFinalizerFailed]:
    if type(request) is not ExecuteFinalizerRequest or not isinstance(value, Mapping):
        raise ValueError("finalizer result requires its concrete request")
    if value.get("status") == "COMPLETED":
        result = ExecuteFinalizerCompleted.from_dict(value)
    elif value.get("status") == "FAILED":
        result = ExecuteFinalizerFailed.from_dict(value)
    else:
        raise ValueError("unknown finalizer result status")
    if result.identity != request.identity:
        raise ValueError("finalizer result belongs to another request")
    if type(result) is ExecuteFinalizerCompleted:
        outcome, invocation = result.child_outcome, request.input.invocation
        expected = (
            invocation.finalizer_id, invocation.invocation_digest,
            request.input.finalizer_input_digest, invocation.snapshot_digest,
            invocation.primary_result_digest,
        )
        actual = (
            outcome.finalizer_id, outcome.invocation_digest, outcome.finalizer_input_digest,
            outcome.snapshot_digest, outcome.primary_result_digest,
        )
        if actual != expected:
            raise ValueError("childOutcome does not match finalizer input identity")
        if outcome.status is FinalizerOutcomeStatus.VALIDATED and (
            outcome.validated_role_instances != invocation.required_role_identities
        ):
            raise ValueError("validated childOutcome must cover exactly the required roles")
    return result


@dataclass(frozen=True)
class PersistAuthorityRuntimeRequest:
    identity: WorkerRequestIdentity
    workspace_id: str
    gate_id: str
    authorization_id: str
    candidate_runtime: FinalizerMaintenanceRuntimeIdentity
    durability_profile: ProofAuthorityDurabilityProfile
    environment_observation: ActiveDurabilityEnvironmentObservation
    expected_durability_profile_digest: str
    file_limit: int = 1024
    single_file_byte_limit: int = 256 * 1024 * 1024
    cumulative_byte_limit: int = 512 * 1024 * 1024
    timeout_seconds: int = 60

    def __post_init__(self) -> None:
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gateId")
        _validate_slug(self.authorization_id, field="authorizationId")
        validate_sha256(self.expected_durability_profile_digest)
        if type(self.candidate_runtime) is not FinalizerMaintenanceRuntimeIdentity:
            raise ValueError("candidateRuntime must be FinalizerMaintenanceRuntimeIdentity")
        if type(self.durability_profile) not in (
            LinuxProofAuthorityDurabilityProfile,
            DarwinProofAuthorityDurabilityProfile,
        ):
            raise ValueError("durabilityProfile must use one closed OS branch")
        if (
            self.durability_profile.durability_profile_digest
            != self.expected_durability_profile_digest
        ):
            raise ValueError(
                "expectedDurabilityProfileDigest does not match durabilityProfile"
            )
        self.durability_profile.capability_evidence.validate_maintenance_source(
            self.candidate_runtime
        )
        if (
            type(self.environment_observation)
            is not ActiveDurabilityEnvironmentObservation
        ):
            raise ValueError(
                "environmentObservation must be active-profile evidence"
            )
        capability = self.durability_profile.capability_evidence
        qualified = DurabilityQualifiedEnvironment.create(
            host_build=capability.qualified_host_build,
            host_identity=capability.qualified_host_identity,
            filesystem_implementation_version=(
                capability.filesystem_implementation_version
            ),
            required_mount_options=capability.required_mount_options,
            stable_volume_identity=capability.stable_volume_identity,
            probe_runtime_digest=capability.probe_runtime_digest,
        )
        validate_durability_environment_observation(
            self.environment_observation,
            qualified,
        )
        for field, value, expected in (
            ("fileLimit", self.file_limit, 1024),
            ("singleFileByteLimit", self.single_file_byte_limit, 256 * 1024 * 1024),
            ("cumulativeByteLimit", self.cumulative_byte_limit, 512 * 1024 * 1024),
            ("timeoutSeconds", self.timeout_seconds, 60),
        ):
            if type(value) is not int or value != expected:
                raise ValueError(f"{field} must equal fixed authority-runtime limit")
        expected_owner = (self.workspace_id, self.gate_id, self.authorization_id)
        if any(
            (ref.workspace_id, ref.gate_id, ref.authorization_id) != expected_owner
            for ref in self.candidate_runtime.runtime_artifacts
        ):
            raise ValueError("candidateRuntime belongs to another authority")
        _validate_worker_request_binding(
            self.identity, WorkerKind.AUTHORITY_RUNTIME_PERSISTER, self._payload()
        )
        owner = self.identity.descriptor_claims[0].owner_binding
        if type(owner) is not GateDirectoryOwnerBinding or (
            owner.workspace_id, owner.gate_id
        ) != expected_owner[:2]:
            raise ValueError("GATE_DIRECTORY owner does not match authority")

    def _payload(self) -> dict[str, object]:
        return {
            "workspaceId": self.workspace_id, "gateId": self.gate_id,
            "authorizationId": self.authorization_id,
            "candidateRuntime": self.candidate_runtime.to_dict(),
            "durabilityProfile": self.durability_profile.to_dict(),
            "environmentObservation": self.environment_observation.to_dict(),
            "expectedDurabilityProfileDigest": self.expected_durability_profile_digest,
            "fileLimit": self.file_limit, "singleFileByteLimit": self.single_file_byte_limit,
            "cumulativeByteLimit": self.cumulative_byte_limit,
            "timeoutSeconds": self.timeout_seconds,
        }

    def to_dict(self) -> dict[str, object]:
        return {"identity": self.identity.to_dict(), **self._payload()}

    @classmethod
    def from_dict(cls, value: object) -> "PersistAuthorityRuntimeRequest":
        fields = (
            "workspaceId", "gateId", "authorizationId", "candidateRuntime",
            "durabilityProfile", "environmentObservation",
            "expectedDurabilityProfileDigest",
            "fileLimit", "singleFileByteLimit",
            "cumulativeByteLimit", "timeoutSeconds",
        )
        data = _closed_mapping(value, schema=cls.__name__, keys=frozenset(("identity", *fields)))
        return cls(
            WorkerRequestIdentity.from_dict(data["identity"]),
            data["workspaceId"], data["gateId"], data["authorizationId"],
            FinalizerMaintenanceRuntimeIdentity.from_dict(data["candidateRuntime"]),
            proof_authority_durability_profile_from_dict(
                data["durabilityProfile"]
            ),
            ActiveDurabilityEnvironmentObservation.from_dict(
                data["environmentObservation"]
            ),
            *(data[field] for field in fields[6:]),
        )


_PERSIST_AUTHORITY_RESULT_KEYS = frozenset({
    "identity", "status", "durableBoundary", "maintenanceRuntimeDigest",
    "failureCode", "workerResultDigest", "diagnostic",
})


@dataclass(frozen=True)
class PersistAuthorityRuntimeCompleted:
    identity: WorkerRequestIdentity
    maintenance_runtime_digest: str
    worker_result_digest: str
    status: ClassVar[str] = "COMPLETED"
    durable_boundary: ClassVar[str] = "AUTHORITY_RUNTIME_DURABLE"

    def __post_init__(self) -> None:
        validate_sha256(self.maintenance_runtime_digest)
        _validate_worker_result_binding(
            self.identity, WorkerKind.AUTHORITY_RUNTIME_PERSISTER,
            self.worker_result_digest, self._payload(),
        )

    def _payload(self) -> dict[str, object]:
        return {
            "identity": self.identity.to_dict(), "status": self.status,
            "durableBoundary": self.durable_boundary,
            "maintenanceRuntimeDigest": self.maintenance_runtime_digest,
            "failureCode": None, "diagnostic": None,
        }

    def to_dict(self) -> dict[str, object]:
        return {**self._payload(), "workerResultDigest": self.worker_result_digest}

    @classmethod
    def from_dict(cls, value: object) -> "PersistAuthorityRuntimeCompleted":
        data = _closed_mapping(value, schema=cls.__name__, keys=_PERSIST_AUTHORITY_RESULT_KEYS)
        _validate_completed_worker_branch(data)
        if data["durableBoundary"] != cls.durable_boundary:
            raise ValueError("completed persistence requires AUTHORITY_RUNTIME_DURABLE")
        return cls(
            WorkerRequestIdentity.from_dict(data["identity"]),
            data["maintenanceRuntimeDigest"], data["workerResultDigest"],
        )


@dataclass(frozen=True)
class PersistAuthorityRuntimeFailed:
    identity: WorkerRequestIdentity
    maintenance_runtime_digest: str
    diagnostic: str
    worker_result_digest: str
    status: ClassVar[str] = "FAILED"
    durable_boundary: ClassVar[str] = "AUTHORITY_RUNTIME_MAY_BE_DURABLE"
    failure_code: ClassVar[FinalizerFailureCode] = FinalizerFailureCode.AUTHORITY_RUNTIME_IO_FAILED

    def __post_init__(self) -> None:
        validate_sha256(self.maintenance_runtime_digest)
        _validate_non_empty_utf8(self.diagnostic, field="diagnostic", maximum_bytes=4096)
        _validate_worker_result_binding(
            self.identity, WorkerKind.AUTHORITY_RUNTIME_PERSISTER,
            self.worker_result_digest, self._payload(),
        )

    def _payload(self) -> dict[str, object]:
        return {
            "identity": self.identity.to_dict(), "status": self.status,
            "durableBoundary": self.durable_boundary,
            "maintenanceRuntimeDigest": self.maintenance_runtime_digest,
            "failureCode": self.failure_code.value, "diagnostic": self.diagnostic,
        }

    def to_dict(self) -> dict[str, object]:
        return {**self._payload(), "workerResultDigest": self.worker_result_digest}

    @classmethod
    def from_dict(cls, value: object) -> "PersistAuthorityRuntimeFailed":
        data = _closed_mapping(value, schema=cls.__name__, keys=_PERSIST_AUTHORITY_RESULT_KEYS)
        if (
            data["status"] != cls.status or data["durableBoundary"] != cls.durable_boundary
            or data["failureCode"] != cls.failure_code.value
        ):
            raise ValueError("failed persistence requires uncertain-publication branch")
        return cls(
            WorkerRequestIdentity.from_dict(data["identity"]),
            data["maintenanceRuntimeDigest"], data["diagnostic"], data["workerResultDigest"],
        )


@dataclass(frozen=True)
class PersistAuthorityRuntimeRejected:
    identity: WorkerRequestIdentity
    failure_code: FinalizerFailureCode
    diagnostic: str
    worker_result_digest: str
    status: ClassVar[str] = "REJECTED"
    durable_boundary: ClassVar[str] = "NO_MUTATION"

    def __post_init__(self) -> None:
        _validate_worker_failure(
            self.failure_code, self.diagnostic,
            (FinalizerFailureCode.RUNTIME_MISMATCH, FinalizerFailureCode.DURABILITY_PROFILE_UNSUPPORTED,
             FinalizerFailureCode.AUTHORITY_RUNTIME_IO_FAILED, FinalizerFailureCode.INPUT_TOO_LARGE,
             FinalizerFailureCode.TIMED_OUT, FinalizerFailureCode.PROCESS_FAILED),
        )
        _validate_worker_result_binding(
            self.identity, WorkerKind.AUTHORITY_RUNTIME_PERSISTER,
            self.worker_result_digest, self._payload(),
        )

    def _payload(self) -> dict[str, object]:
        return {
            "identity": self.identity.to_dict(), "status": self.status,
            "durableBoundary": self.durable_boundary, "maintenanceRuntimeDigest": None,
            "failureCode": self.failure_code.value, "diagnostic": self.diagnostic,
        }

    def to_dict(self) -> dict[str, object]:
        return {**self._payload(), "workerResultDigest": self.worker_result_digest}

    @classmethod
    def from_dict(cls, value: object) -> "PersistAuthorityRuntimeRejected":
        data = _closed_mapping(value, schema=cls.__name__, keys=_PERSIST_AUTHORITY_RESULT_KEYS)
        if (
            data["status"] != cls.status or data["durableBoundary"] != cls.durable_boundary
            or data["maintenanceRuntimeDigest"] is not None
        ):
            raise ValueError("rejected persistence requires NO_MUTATION and null digest")
        return cls(
            WorkerRequestIdentity.from_dict(data["identity"]),
            _enum_from_wire(FinalizerFailureCode, data["failureCode"], field="failureCode"),
            data["diagnostic"], data["workerResultDigest"],
        )


def persist_authority_runtime_result_from_dict(
    value: object, request: PersistAuthorityRuntimeRequest
) -> Union[PersistAuthorityRuntimeCompleted, PersistAuthorityRuntimeFailed, PersistAuthorityRuntimeRejected]:
    if type(request) is not PersistAuthorityRuntimeRequest or not isinstance(value, Mapping):
        raise ValueError("authority runtime result requires its concrete request")
    if value.get("status") == "COMPLETED":
        result = PersistAuthorityRuntimeCompleted.from_dict(value)
    elif value.get("status") == "FAILED":
        result = PersistAuthorityRuntimeFailed.from_dict(value)
    elif value.get("status") == "REJECTED":
        result = PersistAuthorityRuntimeRejected.from_dict(value)
    else:
        raise ValueError("unknown authority runtime result status")
    if result.identity != request.identity:
        raise ValueError("authority runtime result belongs to another request")
    if type(result) is not PersistAuthorityRuntimeRejected and (
        result.maintenance_runtime_digest != request.candidate_runtime.maintenance_runtime_digest
    ):
        raise ValueError("authority runtime result does not match candidate runtime digest")
    return result


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


def _validate_cached_finalization_outcome(
    value: object,
) -> GateEvidenceFinalization:
    if type(value) not in (
        ChildGateEvidenceFinalization,
        CoreGateEvidenceFinalization,
    ):
        raise ValueError("cachedOutcome must be GateEvidenceFinalization")
    return value


def _validate_cached_publication_bytes(
    *,
    completed_at: object,
    manifest_bytes: object,
    manifest_digest: object,
    latest_pointer_bytes: object,
    latest_pointer_digest: object,
) -> None:
    _canonical_utc_instant(completed_at, field="completedAt")
    for field, value, digest in (
        ("manifestBytes", manifest_bytes, manifest_digest),
        ("latestPointerBytes", latest_pointer_bytes, latest_pointer_digest),
    ):
        if type(value) is not bytes or not value:
            raise ValueError(f"{field} must be non-empty exact bytes")
        validate_sha256(digest)
        if raw_sha256(value) != digest:
            raise ValueError(f"{field} digest mismatch")


@dataclass(frozen=True)
class FinalizationReadyReservation:
    state: ClassVar[FinalizationReservationState] = (
        FinalizationReservationState.READY
    )
    invocation_digest: None = None
    cached_outcome: None = None
    completed_at: None = None
    manifest_bytes: None = None
    manifest_digest: None = None
    latest_pointer_bytes: None = None
    latest_pointer_digest: None = None
    latest_disposition: None = None

    def __post_init__(self) -> None:
        if any(
            value is not None
            for value in (
                self.invocation_digest,
                self.cached_outcome,
                self.completed_at,
                self.manifest_bytes,
                self.manifest_digest,
                self.latest_pointer_bytes,
                self.latest_pointer_digest,
                self.latest_disposition,
            )
        ):
            raise ValueError("READY reservation requires null branch fields")


@dataclass(frozen=True)
class FinalizationInvocationStartedReservation:
    invocation_digest: str
    state: ClassVar[FinalizationReservationState] = (
        FinalizationReservationState.INVOCATION_STARTED
    )
    cached_outcome: None = None
    completed_at: None = None
    manifest_bytes: None = None
    manifest_digest: None = None
    latest_pointer_bytes: None = None
    latest_pointer_digest: None = None
    latest_disposition: None = None

    def __post_init__(self) -> None:
        validate_sha256(self.invocation_digest)


@dataclass(frozen=True)
class FinalizationOutcomeCachedReservation:
    invocation_digest: str
    cached_outcome: GateEvidenceFinalization
    state: ClassVar[FinalizationReservationState] = (
        FinalizationReservationState.OUTCOME_CACHED
    )
    completed_at: None = None
    manifest_bytes: None = None
    manifest_digest: None = None
    latest_pointer_bytes: None = None
    latest_pointer_digest: None = None
    latest_disposition: None = None

    def __post_init__(self) -> None:
        validate_sha256(self.invocation_digest)
        _validate_cached_finalization_outcome(self.cached_outcome)


@dataclass(frozen=True)
class FinalizationManifestPreparedReservation:
    invocation_digest: str
    cached_outcome: GateEvidenceFinalization
    completed_at: str
    manifest_bytes: bytes
    manifest_digest: str
    latest_pointer_bytes: bytes
    latest_pointer_digest: str
    state: ClassVar[FinalizationReservationState] = (
        FinalizationReservationState.MANIFEST_PREPARED
    )
    latest_disposition: None = None

    def __post_init__(self) -> None:
        validate_sha256(self.invocation_digest)
        _validate_cached_finalization_outcome(self.cached_outcome)
        _validate_cached_publication_bytes(
            completed_at=self.completed_at,
            manifest_bytes=self.manifest_bytes,
            manifest_digest=self.manifest_digest,
            latest_pointer_bytes=self.latest_pointer_bytes,
            latest_pointer_digest=self.latest_pointer_digest,
        )


@dataclass(frozen=True)
class FinalizationManifestDurableReservation:
    invocation_digest: str
    cached_outcome: GateEvidenceFinalization
    completed_at: str
    manifest_bytes: bytes
    manifest_digest: str
    latest_pointer_bytes: bytes
    latest_pointer_digest: str
    state: ClassVar[FinalizationReservationState] = (
        FinalizationReservationState.MANIFEST_DURABLE
    )
    latest_disposition: None = None

    def __post_init__(self) -> None:
        validate_sha256(self.invocation_digest)
        _validate_cached_finalization_outcome(self.cached_outcome)
        _validate_cached_publication_bytes(
            completed_at=self.completed_at,
            manifest_bytes=self.manifest_bytes,
            manifest_digest=self.manifest_digest,
            latest_pointer_bytes=self.latest_pointer_bytes,
            latest_pointer_digest=self.latest_pointer_digest,
        )


@dataclass(frozen=True)
class FinalizationLatestResolvedReservation:
    invocation_digest: str
    cached_outcome: GateEvidenceFinalization
    completed_at: str
    manifest_bytes: bytes
    manifest_digest: str
    latest_pointer_bytes: bytes
    latest_pointer_digest: str
    latest_disposition: FinalizationLatestDisposition
    state: ClassVar[FinalizationReservationState] = (
        FinalizationReservationState.LATEST_RESOLVED
    )

    def __post_init__(self) -> None:
        validate_sha256(self.invocation_digest)
        _validate_cached_finalization_outcome(self.cached_outcome)
        _validate_cached_publication_bytes(
            completed_at=self.completed_at,
            manifest_bytes=self.manifest_bytes,
            manifest_digest=self.manifest_digest,
            latest_pointer_bytes=self.latest_pointer_bytes,
            latest_pointer_digest=self.latest_pointer_digest,
        )
        if type(self.latest_disposition) is not FinalizationLatestDisposition:
            raise ValueError("latestDisposition must be closed")


FinalizationInvocationReservation = Union[
    FinalizationReadyReservation,
    FinalizationInvocationStartedReservation,
    FinalizationOutcomeCachedReservation,
    FinalizationManifestPreparedReservation,
    FinalizationManifestDurableReservation,
    FinalizationLatestResolvedReservation,
]


def start_finalizer_invocation(
    reservation: FinalizationInvocationReservation,
    *,
    invocation_digest: str,
) -> FinalizationInvocationStartedReservation:
    if type(reservation) is not FinalizationReadyReservation:
        raise ValueError("finalizer invocation may start only from READY")
    return FinalizationInvocationStartedReservation(
        invocation_digest=invocation_digest
    )


def cache_finalizer_outcome(
    reservation: FinalizationInvocationReservation,
    *,
    outcome: GateEvidenceFinalization,
) -> FinalizationOutcomeCachedReservation:
    if type(reservation) is not FinalizationInvocationStartedReservation:
        raise ValueError(
            "finalizer outcome may be cached only after invocation start"
        )
    return FinalizationOutcomeCachedReservation(
        invocation_digest=reservation.invocation_digest,
        cached_outcome=outcome,
    )


def prepare_finalization_manifest(
    reservation: FinalizationInvocationReservation,
    *,
    completed_at: str,
    manifest_bytes: bytes,
    latest_pointer_bytes: bytes,
) -> FinalizationManifestPreparedReservation:
    if type(reservation) is not FinalizationOutcomeCachedReservation:
        raise ValueError(
            "finalization manifest may be prepared only from cached outcome"
        )
    return FinalizationManifestPreparedReservation(
        invocation_digest=reservation.invocation_digest,
        cached_outcome=reservation.cached_outcome,
        completed_at=completed_at,
        manifest_bytes=manifest_bytes,
        manifest_digest=raw_sha256(manifest_bytes),
        latest_pointer_bytes=latest_pointer_bytes,
        latest_pointer_digest=raw_sha256(latest_pointer_bytes),
    )


def mark_finalization_manifest_durable(
    reservation: FinalizationInvocationReservation,
) -> FinalizationManifestDurableReservation:
    if type(reservation) is not FinalizationManifestPreparedReservation:
        raise ValueError(
            "manifest durability may advance only prepared reservation"
        )
    return FinalizationManifestDurableReservation(
        invocation_digest=reservation.invocation_digest,
        cached_outcome=reservation.cached_outcome,
        completed_at=reservation.completed_at,
        manifest_bytes=reservation.manifest_bytes,
        manifest_digest=reservation.manifest_digest,
        latest_pointer_bytes=reservation.latest_pointer_bytes,
        latest_pointer_digest=reservation.latest_pointer_digest,
    )


def resolve_finalization_latest(
    reservation: FinalizationInvocationReservation,
    *,
    disposition: FinalizationLatestDisposition,
) -> FinalizationLatestResolvedReservation:
    if type(reservation) is not FinalizationManifestDurableReservation:
        raise ValueError(
            "latest publication may resolve only a durable manifest"
        )
    return FinalizationLatestResolvedReservation(
        invocation_digest=reservation.invocation_digest,
        cached_outcome=reservation.cached_outcome,
        completed_at=reservation.completed_at,
        manifest_bytes=reservation.manifest_bytes,
        manifest_digest=reservation.manifest_digest,
        latest_pointer_bytes=reservation.latest_pointer_bytes,
        latest_pointer_digest=reservation.latest_pointer_digest,
        latest_disposition=disposition,
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


def _validate_witness_public_key(public_key_hex: object, public_key_sha256: object) -> None:
    if (
        type(public_key_hex) is not str
        or re.fullmatch(r"04[0-9a-f]{128}", public_key_hex) is None
    ):
        raise ValueError("witness key must be canonical uncompressed SEC1 P-256")
    encoded = bytes.fromhex(public_key_hex)
    x = int.from_bytes(encoded[1:33], "big")
    y = int.from_bytes(encoded[33:], "big")
    prime = 0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF
    coefficient = 0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B
    if (
        x >= prime or y >= prime
        or (y * y - (x * x * x - 3 * x + coefficient)) % prime != 0
    ):
        raise ValueError("witness key is not an on-curve canonical P-256 point")
    validate_sha256(public_key_sha256)
    if raw_sha256(encoded) != public_key_sha256:
        raise ValueError("witness public key hash mismatch")


@dataclass(frozen=True)
class ControllerStoreQualificationWitnessAuthorization:
    operator_identity: AbortOperatorIdentity
    workspace_id: str
    gate_id: str
    bootstrap_candidate_digest: str
    crash_fixture_id: str
    qualification_run_id: str
    qualification_id: str
    subject_controller_identity_digest: str
    witness_public_key_hex: str
    witness_public_key_sha256: str
    owner_approval_document_path: str
    owner_approval_document_sha256: str
    authority_source_commit: str
    authorized_at: str
    authorization_id: str
    witness_confirmation_challenge_digest: str
    witness_authorization_digest: str
    artifact_kind: ClassVar[str] = "acceptance-power-controller-store-witness-authorization"
    schema_version: ClassVar[int] = 1
    action: ClassVar[str] = "AUTHORIZE_CONTROLLER_STORE_QUALIFICATION_WITNESS"
    witness_signature_algorithm: ClassVar[str] = "ECDSA_P256_SHA256_P1363_LOW_S"
    witness_scope: ClassVar[str] = "CONTROLLER_STORE_QUALIFICATION_ONLY"
    production_authority_eligible: ClassVar[bool] = False
    expected_target_absent: ClassVar[bool] = True
    authorization_path_id: ClassVar[str] = "CANDIDATE_WITNESS_AUTHORIZATION_V1"

    def __post_init__(self) -> None:
        if type(self.operator_identity) is not AbortOperatorIdentity:
            raise ValueError("witness operator must be a concrete kernel principal")
        _validate_workspace_id(self.workspace_id)
        for value in (
            self.gate_id, self.crash_fixture_id, self.qualification_run_id,
            self.qualification_id,
        ):
            validate_finalizer_id(value)
        for value in (
            self.bootstrap_candidate_digest, self.subject_controller_identity_digest,
            self.owner_approval_document_sha256, self.authorization_id,
            self.witness_confirmation_challenge_digest, self.witness_authorization_digest,
        ):
            validate_sha256(value)
        _validate_witness_public_key(self.witness_public_key_hex, self.witness_public_key_sha256)
        validate_repo_relative_path(self.owner_approval_document_path)
        if re.fullmatch(r"[0-9a-f]{40}", self.authority_source_commit) is None:
            raise ValueError("witness authority source must be a Git SHA-1 commit")
        _canonical_utc_instant(self.authorized_at, field="authorizedAt")
        payload = self._payload()
        if self.authorization_id != domain_separated_sha256(
            _CONTROLLER_WITNESS_AUTHORIZATION_ID_DOMAIN,
            self._id_payload(payload),
        ):
            raise ValueError("witness authorization ID mismatch")
        if self.witness_confirmation_challenge_digest != domain_separated_sha256(
            _CONTROLLER_WITNESS_CONFIRMATION_DOMAIN, payload
        ):
            raise ValueError("witness confirmation challenge mismatch")
        if self.witness_authorization_digest != domain_separated_sha256(
            _CONTROLLER_WITNESS_AUTHORIZATION_DOMAIN,
            {
                **payload,
                "witnessConfirmationChallengeDigest": self.witness_confirmation_challenge_digest,
            },
        ):
            raise ValueError("witness authorization digest mismatch")

    @property
    def witness_id(self) -> str:
        return "p256-sha256:" + self.witness_public_key_sha256

    @staticmethod
    def _id_payload(payload: Mapping[str, object]) -> dict[str, object]:
        return {
            key: payload[key] for key in (
                "workspaceId", "gateId", "bootstrapCandidateDigest", "qualificationId",
                "witnessId", "witnessPublicKeySha256", "ownerApprovalDocumentSha256",
                "authoritySourceCommit",
            )
        }

    def _payload(self) -> dict[str, object]:
        return self._payload_values({
            field.name: getattr(self, field.name) for field in dataclass_fields(self)
        })

    @classmethod
    def _payload_values(cls, values: Mapping[str, object]) -> dict[str, object]:
        return {
            "artifactKind": cls.artifact_kind,
            "schemaVersion": cls.schema_version,
            "action": cls.action,
            "authorizationId": values["authorization_id"],
            "operatorIdentity": values["operator_identity"].to_dict(),
            "workspaceId": values["workspace_id"],
            "gateId": values["gate_id"],
            "bootstrapCandidateDigest": values["bootstrap_candidate_digest"],
            "crashFixtureId": values["crash_fixture_id"],
            "qualificationRunId": values["qualification_run_id"],
            "qualificationId": values["qualification_id"],
            "subjectControllerIdentityDigest": values["subject_controller_identity_digest"],
            "witnessId": "p256-sha256:" + values["witness_public_key_sha256"],
            "witnessSignatureAlgorithm": cls.witness_signature_algorithm,
            "witnessPublicKeyHex": values["witness_public_key_hex"],
            "witnessPublicKeySha256": values["witness_public_key_sha256"],
            "witnessScope": cls.witness_scope,
            "productionAuthorityEligible": cls.production_authority_eligible,
            "ownerApprovalDocumentPath": values["owner_approval_document_path"],
            "ownerApprovalDocumentSha256": values["owner_approval_document_sha256"],
            "authoritySourceCommit": values["authority_source_commit"],
            "expectedTargetAbsent": cls.expected_target_absent,
            "authorizationPathId": cls.authorization_path_id,
            "authorizedAt": values["authorized_at"],
        }

    def to_dict(self) -> dict[str, object]:
        return {
            **self._payload(),
            "witnessConfirmationChallengeDigest": self.witness_confirmation_challenge_digest,
            "witnessAuthorizationDigest": self.witness_authorization_digest,
        }

    @classmethod
    def create(cls, **values: object) -> "ControllerStoreQualificationWitnessAuthorization":
        inputs = frozenset(field.name for field in dataclass_fields(cls)) - {
            "witness_public_key_sha256", "authorization_id",
            "witness_confirmation_challenge_digest", "witness_authorization_digest",
        }
        _closed_mapping(values, schema=cls.__name__ + " inputs", keys=inputs)
        public_key_hex = values["witness_public_key_hex"]
        if type(public_key_hex) is not str:
            raise ValueError("witness key must be a lowercase hex string")
        public_key_sha256 = raw_sha256(bytes.fromhex(public_key_hex))
        _validate_witness_public_key(public_key_hex, public_key_sha256)
        derived = {
            **values,
            "witness_public_key_sha256": public_key_sha256,
            "authorization_id": "0" * 64,
            "witness_confirmation_challenge_digest": "0" * 64,
            "witness_authorization_digest": "0" * 64,
        }
        if type(values["operator_identity"]) is not AbortOperatorIdentity:
            raise ValueError("witness operator must be a concrete kernel principal")
        payload = cls._payload_values(derived)
        derived["authorization_id"] = payload["authorizationId"] = domain_separated_sha256(
            _CONTROLLER_WITNESS_AUTHORIZATION_ID_DOMAIN, cls._id_payload(payload)
        )
        derived["witness_confirmation_challenge_digest"] = domain_separated_sha256(
            _CONTROLLER_WITNESS_CONFIRMATION_DOMAIN, payload
        )
        derived["witness_authorization_digest"] = domain_separated_sha256(
            _CONTROLLER_WITNESS_AUTHORIZATION_DOMAIN,
            {
                **payload,
                "witnessConfirmationChallengeDigest": derived["witness_confirmation_challenge_digest"],
            },
        )
        return cls(**derived)

    @classmethod
    def from_dict(cls, value: object) -> "ControllerStoreQualificationWitnessAuthorization":
        field_names = {
            "operatorIdentity": "operator_identity", "workspaceId": "workspace_id",
            "gateId": "gate_id", "bootstrapCandidateDigest": "bootstrap_candidate_digest",
            "crashFixtureId": "crash_fixture_id", "qualificationRunId": "qualification_run_id",
            "qualificationId": "qualification_id",
            "subjectControllerIdentityDigest": "subject_controller_identity_digest",
            "witnessPublicKeyHex": "witness_public_key_hex",
            "witnessPublicKeySha256": "witness_public_key_sha256",
            "ownerApprovalDocumentPath": "owner_approval_document_path",
            "ownerApprovalDocumentSha256": "owner_approval_document_sha256",
            "authoritySourceCommit": "authority_source_commit", "authorizedAt": "authorized_at",
            "authorizationId": "authorization_id",
            "witnessConfirmationChallengeDigest": "witness_confirmation_challenge_digest",
            "witnessAuthorizationDigest": "witness_authorization_digest",
        }
        constants = {
            "artifactKind": cls.artifact_kind, "schemaVersion": cls.schema_version,
            "action": cls.action, "witnessSignatureAlgorithm": cls.witness_signature_algorithm,
            "witnessScope": cls.witness_scope, "productionAuthorityEligible": False,
            "expectedTargetAbsent": True, "authorizationPathId": cls.authorization_path_id,
        }
        data = _closed_mapping(
            value, schema=cls.__name__,
            keys=frozenset(field_names) | frozenset(constants) | {"witnessId"},
        )
        if any(type(data[key]) is not type(expected) or data[key] != expected for key, expected in constants.items()):
            raise ValueError("witness authorization constants mismatch")
        values = {attribute: data[key] for key, attribute in field_names.items()}
        values["operator_identity"] = AbortOperatorIdentity.from_dict(data["operatorIdentity"])
        result = cls(**values)
        if data["witnessId"] != result.witness_id:
            raise ValueError("witness ID must be derived from its canonical public key")
        return result


@dataclass(frozen=True)
class ControllerStoreQualificationWitnessIdentity:
    authorization: ControllerStoreQualificationWitnessAuthorization
    witness_identity_digest: str

    def __post_init__(self) -> None:
        if type(self.authorization) is not ControllerStoreQualificationWitnessAuthorization:
            raise ValueError("witness identity requires its concrete authorization")
        if self.witness_identity_digest != domain_separated_sha256(
            _CONTROLLER_WITNESS_DOMAIN, self._payload()
        ):
            raise ValueError("witness identity digest mismatch")

    def _payload(self) -> dict[str, object]:
        return self._authorization_payload(self.authorization)

    @staticmethod
    def _authorization_payload(
        authorization: ControllerStoreQualificationWitnessAuthorization,
    ) -> dict[str, object]:
        return {
            "witnessRole": authorization.witness_scope,
            "witnessId": authorization.witness_id,
            "witnessSignatureAlgorithm": authorization.witness_signature_algorithm,
            "witnessPublicKeyHex": authorization.witness_public_key_hex,
            "witnessPublicKeySha256": authorization.witness_public_key_sha256,
            "subjectControllerIdentityDigest": authorization.subject_controller_identity_digest,
            "productionAuthorityEligible": False,
            "authorization": authorization.to_dict(),
            "witnessAuthorizationDigest": authorization.witness_authorization_digest,
            "ownerApprovalDocumentPath": authorization.owner_approval_document_path,
            "ownerApprovalDocumentSha256": authorization.owner_approval_document_sha256,
        }

    def to_dict(self) -> dict[str, object]:
        return {**self._payload(), "witnessIdentityDigest": self.witness_identity_digest}

    @classmethod
    def create(
        cls, authorization: ControllerStoreQualificationWitnessAuthorization
    ) -> "ControllerStoreQualificationWitnessIdentity":
        if type(authorization) is not ControllerStoreQualificationWitnessAuthorization:
            raise ValueError("witness identity requires a concrete authorization")
        return cls(
            authorization=authorization,
            witness_identity_digest=domain_separated_sha256(
                _CONTROLLER_WITNESS_DOMAIN, cls._authorization_payload(authorization)
            ),
        )

    @classmethod
    def from_dict(cls, value: object) -> "ControllerStoreQualificationWitnessIdentity":
        if not isinstance(value, Mapping):
            raise ValueError("witness identity must be an object")
        authorization = ControllerStoreQualificationWitnessAuthorization.from_dict(value.get("authorization"))
        result = cls(authorization, value.get("witnessIdentityDigest"))
        data = _closed_mapping(value, schema=cls.__name__, keys=frozenset(result.to_dict()))
        if (
            data["productionAuthorityEligible"] is not False
            or data != result.to_dict()
        ):
            raise ValueError("witness identity does not match its authorization")
        return result


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

    @classmethod
    def from_dict_unresolved(
        cls,
        value: object,
    ) -> "ProofAdmissionQuiescence":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        for field in (
            "registeredJobs",
            "terminalJobCompletions",
            "acknowledgedEmissions",
            "pendingEmissions",
            "activeJobs",
        ):
            if not isinstance(data[field], list):
                raise ValueError(f"{field} must be an array")
        return cls(
            artifact_kind=data["artifactKind"],
            schema_version=data["schemaVersion"],
            workspace_id=data["workspaceId"],
            gate_id=data["gateId"],
            coordinator_epoch_id=data["coordinatorEpochId"],
            epoch_digest=data["epochDigest"],
            current_epoch_digest=data["currentEpochDigest"],
            coordinator_state=data["coordinatorState"],
            source_commit=data["sourceCommit"],
            proof_admission_source_digest=data[
                "proofAdmissionSourceDigest"
            ],
            claim_admission_lock_identity=(
                ProofAdmissionLockIdentity.from_dict(
                    data["claimAdmissionLockIdentity"]
                )
            ),
            claim_sequence_lock_identity=(
                ProofAdmissionLockIdentity.from_dict(
                    data["claimSequenceLockIdentity"]
                )
            ),
            pause_digest=data["pauseDigest"],
            registered_jobs=_sequence_digest_tuple_from_wire(
                data["registeredJobs"],
                field="registeredJobs",
            ),
            terminal_job_completions=_sequence_digest_tuple_from_wire(
                data["terminalJobCompletions"],
                field="terminalJobCompletions",
            ),
            acknowledged_emissions=_sequence_digest_tuple_from_wire(
                data["acknowledgedEmissions"],
                field="acknowledgedEmissions",
            ),
            pending_emissions=tuple(data["pendingEmissions"]),
            active_jobs=tuple(data["activeJobs"]),
            captured_at=data["capturedAt"],
            quiescence_digest=data["quiescenceDigest"],
        )


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
class PowerControllerTrustAnchorRef:
    workspace_id: str
    gate_id: str
    trust_generation: int
    controller_identity_digest: str
    trust_anchor_digest: str
    trust_anchor_ref_digest: str
    artifact_kind: ClassVar[str] = "acceptance-power-controller-trust-anchor-ref"
    schema_version: ClassVar[int] = 1

    def __post_init__(self) -> None:
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gateId")
        if type(self.trust_generation) is not int or not 1 <= self.trust_generation <= _I_JSON_INTEGER_MAX:
            raise ValueError("trustGeneration must be a positive I-JSON integer")
        for digest in (
            self.controller_identity_digest, self.trust_anchor_digest,
            self.trust_anchor_ref_digest,
        ):
            validate_sha256(digest)
        if self.trust_anchor_ref_digest != domain_separated_sha256(
            _POWER_CONTROLLER_TRUST_ANCHOR_REF_DOMAIN, self._payload()
        ):
            raise ValueError("trustAnchorRefDigest mismatch")

    def _payload(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind, "schemaVersion": self.schema_version,
            "workspaceId": self.workspace_id, "gateId": self.gate_id,
            "trustGeneration": self.trust_generation,
            "controllerIdentityDigest": self.controller_identity_digest,
            "trustAnchorDigest": self.trust_anchor_digest,
        }

    def to_dict(self) -> dict[str, object]:
        return {**self._payload(), "trustAnchorRefDigest": self.trust_anchor_ref_digest}

    @classmethod
    def from_dict(cls, value: object) -> "PowerControllerTrustAnchorRef":
        data = _closed_mapping(value, schema=cls.__name__, keys=frozenset({
            "artifactKind", "schemaVersion", "workspaceId", "gateId",
            "trustGeneration", "controllerIdentityDigest", "trustAnchorDigest",
            "trustAnchorRefDigest",
        }))
        if data["artifactKind"] != cls.artifact_kind or type(data["schemaVersion"]) is not int or data["schemaVersion"] != 1:
            raise ValueError("invalid controller trust anchor ref schema")
        return cls(
            data["workspaceId"], data["gateId"], data["trustGeneration"],
            data["controllerIdentityDigest"], data["trustAnchorDigest"],
            data["trustAnchorRefDigest"],
        )


class PowerControllerTrustGenerationState(str, Enum):
    ACTIVE = "ACTIVE"
    REVOKED = "REVOKED"


@dataclass(frozen=True)
class PowerControllerTrustGenerationRef:
    workspace_id: str
    gate_id: str
    trust_generation: int
    trust_generation_digest: str
    trust_generation_ref_digest: str
    artifact_kind: ClassVar[str] = "acceptance-power-controller-trust-generation-ref"
    schema_version: ClassVar[int] = 1

    def __post_init__(self) -> None:
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gateId")
        if (
            type(self.trust_generation) is not int
            or not 1 <= self.trust_generation <= _I_JSON_INTEGER_MAX
        ):
            raise ValueError("trustGeneration must be a positive I-JSON integer")
        validate_sha256(self.trust_generation_digest)
        validate_sha256(self.trust_generation_ref_digest)
        if self.trust_generation_ref_digest != domain_separated_sha256(
            _POWER_CONTROLLER_TRUST_GENERATION_REF_DOMAIN, self._payload()
        ):
            raise ValueError("trustGenerationRefDigest mismatch")

    def _payload(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind,
            "schemaVersion": self.schema_version,
            "workspaceId": self.workspace_id,
            "gateId": self.gate_id,
            "trustGeneration": self.trust_generation,
            "trustGenerationDigest": self.trust_generation_digest,
        }

    def to_dict(self) -> dict[str, object]:
        return {
            **self._payload(),
            "trustGenerationRefDigest": self.trust_generation_ref_digest,
        }

    @classmethod
    def create(cls, **values: object) -> "PowerControllerTrustGenerationRef":
        payload = {
            "artifactKind": cls.artifact_kind,
            "schemaVersion": cls.schema_version,
            "workspaceId": values["workspace_id"],
            "gateId": values["gate_id"],
            "trustGeneration": values["trust_generation"],
            "trustGenerationDigest": values["trust_generation_digest"],
        }
        return cls(
            **values,
            trust_generation_ref_digest=domain_separated_sha256(
                _POWER_CONTROLLER_TRUST_GENERATION_REF_DOMAIN, payload
            ),
        )

    @classmethod
    def from_dict(cls, value: object) -> "PowerControllerTrustGenerationRef":
        data = _closed_mapping(
            value,
            schema=cls.__name__,
            keys=frozenset(
                {
                    "artifactKind",
                    "schemaVersion",
                    "workspaceId",
                    "gateId",
                    "trustGeneration",
                    "trustGenerationDigest",
                    "trustGenerationRefDigest",
                }
            ),
        )
        if (
            data["artifactKind"] != cls.artifact_kind
            or type(data["schemaVersion"]) is not int
            or data["schemaVersion"] != cls.schema_version
        ):
            raise ValueError("invalid controller trust generation ref schema")
        return cls(
            workspace_id=data["workspaceId"],
            gate_id=data["gateId"],
            trust_generation=data["trustGeneration"],
            trust_generation_digest=data["trustGenerationDigest"],
            trust_generation_ref_digest=data["trustGenerationRefDigest"],
        )


@dataclass(frozen=True)
class ActivePowerControllerTrustGeneration:
    workspace_id: str
    gate_id: str
    trust_generation: int
    predecessor_generation_ref: PowerControllerTrustGenerationRef | None
    trust_anchor_digest: str
    trust_generation_digest: str
    artifact_kind: ClassVar[str] = "acceptance-power-controller-trust-generation"
    schema_version: ClassVar[int] = 1
    state: ClassVar[PowerControllerTrustGenerationState] = (
        PowerControllerTrustGenerationState.ACTIVE
    )

    def __post_init__(self) -> None:
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gateId")
        if (
            type(self.trust_generation) is not int
            or not 1 <= self.trust_generation <= _I_JSON_INTEGER_MAX
        ):
            raise ValueError("trustGeneration must be a positive I-JSON integer")
        if self.trust_generation == 1:
            if self.predecessor_generation_ref is not None:
                raise ValueError("initial trust generation cannot have a predecessor")
        else:
            predecessor = self.predecessor_generation_ref
            if (
                type(predecessor) is not PowerControllerTrustGenerationRef
                or predecessor.workspace_id != self.workspace_id
                or predecessor.gate_id != self.gate_id
                or predecessor.trust_generation != self.trust_generation - 1
            ):
                raise ValueError("trust generation predecessor is invalid")
        validate_sha256(self.trust_anchor_digest)
        validate_sha256(self.trust_generation_digest)
        if self.trust_generation_digest != domain_separated_sha256(
            _POWER_CONTROLLER_TRUST_GENERATION_DOMAIN, self._payload()
        ):
            raise ValueError("trustGenerationDigest mismatch")

    def _payload(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind,
            "schemaVersion": self.schema_version,
            "state": self.state.value,
            "workspaceId": self.workspace_id,
            "gateId": self.gate_id,
            "trustGeneration": self.trust_generation,
            "predecessorGenerationRef": (
                None
                if self.predecessor_generation_ref is None
                else self.predecessor_generation_ref.to_dict()
            ),
            "trustAnchorDigest": self.trust_anchor_digest,
        }

    def to_dict(self) -> dict[str, object]:
        return {
            **self._payload(),
            "trustGenerationDigest": self.trust_generation_digest,
        }

    def reference(self) -> PowerControllerTrustGenerationRef:
        return PowerControllerTrustGenerationRef.create(
            workspace_id=self.workspace_id,
            gate_id=self.gate_id,
            trust_generation=self.trust_generation,
            trust_generation_digest=self.trust_generation_digest,
        )

    @classmethod
    def create(cls, **values: object) -> "ActivePowerControllerTrustGeneration":
        predecessor = values["predecessor_generation_ref"]
        payload = {
            "artifactKind": cls.artifact_kind,
            "schemaVersion": cls.schema_version,
            "state": cls.state.value,
            "workspaceId": values["workspace_id"],
            "gateId": values["gate_id"],
            "trustGeneration": values["trust_generation"],
            "predecessorGenerationRef": (
                None if predecessor is None else predecessor.to_dict()
            ),
            "trustAnchorDigest": values["trust_anchor_digest"],
        }
        return cls(
            **values,
            trust_generation_digest=domain_separated_sha256(
                _POWER_CONTROLLER_TRUST_GENERATION_DOMAIN, payload
            ),
        )

    @classmethod
    def from_dict(cls, value: object) -> "ActivePowerControllerTrustGeneration":
        data = _closed_mapping(
            value,
            schema=cls.__name__,
            keys=frozenset(
                {
                    "artifactKind",
                    "schemaVersion",
                    "state",
                    "workspaceId",
                    "gateId",
                    "trustGeneration",
                    "predecessorGenerationRef",
                    "trustAnchorDigest",
                    "trustGenerationDigest",
                }
            ),
        )
        if (
            data["artifactKind"] != cls.artifact_kind
            or type(data["schemaVersion"]) is not int
            or data["schemaVersion"] != cls.schema_version
            or data["state"] != cls.state.value
        ):
            raise ValueError("invalid active controller trust generation schema")
        predecessor = data["predecessorGenerationRef"]
        return cls(
            workspace_id=data["workspaceId"],
            gate_id=data["gateId"],
            trust_generation=data["trustGeneration"],
            predecessor_generation_ref=(
                None
                if predecessor is None
                else PowerControllerTrustGenerationRef.from_dict(predecessor)
            ),
            trust_anchor_digest=data["trustAnchorDigest"],
            trust_generation_digest=data["trustGenerationDigest"],
        )


@dataclass(frozen=True)
class PowerControllerTrustCurrent:
    workspace_id: str
    gate_id: str
    generation_ref: PowerControllerTrustGenerationRef
    current_trust_digest: str
    artifact_kind: ClassVar[str] = "acceptance-power-controller-trust-current"
    schema_version: ClassVar[int] = 1

    def __post_init__(self) -> None:
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gateId")
        if (
            type(self.generation_ref) is not PowerControllerTrustGenerationRef
            or self.generation_ref.workspace_id != self.workspace_id
            or self.generation_ref.gate_id != self.gate_id
        ):
            raise ValueError("generationRef scope must equal current trust scope")
        validate_sha256(self.current_trust_digest)
        if self.current_trust_digest != domain_separated_sha256(
            _POWER_CONTROLLER_TRUST_CURRENT_DOMAIN, self._payload()
        ):
            raise ValueError("currentTrustDigest mismatch")

    def _payload(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind,
            "schemaVersion": self.schema_version,
            "workspaceId": self.workspace_id,
            "gateId": self.gate_id,
            "generationRef": self.generation_ref.to_dict(),
        }

    def to_dict(self) -> dict[str, object]:
        return {**self._payload(), "currentTrustDigest": self.current_trust_digest}

    @classmethod
    def create(cls, **values: object) -> "PowerControllerTrustCurrent":
        payload = {
            "artifactKind": cls.artifact_kind,
            "schemaVersion": cls.schema_version,
            "workspaceId": values["workspace_id"],
            "gateId": values["gate_id"],
            "generationRef": values["generation_ref"].to_dict(),
        }
        return cls(
            **values,
            current_trust_digest=domain_separated_sha256(
                _POWER_CONTROLLER_TRUST_CURRENT_DOMAIN, payload
            ),
        )

    @classmethod
    def from_dict(cls, value: object) -> "PowerControllerTrustCurrent":
        data = _closed_mapping(
            value,
            schema=cls.__name__,
            keys=frozenset(
                {
                    "artifactKind",
                    "schemaVersion",
                    "workspaceId",
                    "gateId",
                    "generationRef",
                    "currentTrustDigest",
                }
            ),
        )
        if (
            data["artifactKind"] != cls.artifact_kind
            or type(data["schemaVersion"]) is not int
            or data["schemaVersion"] != cls.schema_version
        ):
            raise ValueError("invalid controller trust current schema")
        return cls(
            workspace_id=data["workspaceId"],
            gate_id=data["gateId"],
            generation_ref=PowerControllerTrustGenerationRef.from_dict(
                data["generationRef"]
            ),
            current_trust_digest=data["currentTrustDigest"],
        )


@dataclass(frozen=True)
class GatePublishLockIdentity:
    workspace_id: str
    gate_id: str
    device_id: str
    inode: str
    lock_identity_digest: str
    lock_path_id: ClassVar[str] = "GATE_FINALIZER_PUBLISH_LOCK_V1"
    file_type: ClassVar[str] = "REGULAR_FILE"
    opened_no_follow: ClassVar[bool] = True

    def __post_init__(self) -> None:
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gateId")
        _validate_uint_string(self.device_id, field="deviceId")
        _validate_uint_string(self.inode, field="inode")
        validate_sha256(self.lock_identity_digest)
        if self.lock_identity_digest != domain_separated_sha256(
            _GATE_PUBLISH_LOCK_IDENTITY_DOMAIN, self._payload()
        ):
            raise ValueError("lockIdentityDigest mismatch")

    def _payload(self) -> dict[str, object]:
        return {
            "workspaceId": self.workspace_id,
            "gateId": self.gate_id,
            "lockPathId": self.lock_path_id,
            "deviceId": self.device_id,
            "inode": self.inode,
            "fileType": self.file_type,
            "openedNoFollow": self.opened_no_follow,
        }

    def to_dict(self) -> dict[str, object]:
        return {**self._payload(), "lockIdentityDigest": self.lock_identity_digest}

    @classmethod
    def create(cls, **values: object) -> "GatePublishLockIdentity":
        payload = {
            "workspaceId": values["workspace_id"],
            "gateId": values["gate_id"],
            "lockPathId": cls.lock_path_id,
            "deviceId": values["device_id"],
            "inode": values["inode"],
            "fileType": cls.file_type,
            "openedNoFollow": cls.opened_no_follow,
        }
        return cls(
            **values,
            lock_identity_digest=domain_separated_sha256(
                _GATE_PUBLISH_LOCK_IDENTITY_DOMAIN, payload
            ),
        )

    @classmethod
    def from_dict(cls, value: object) -> "GatePublishLockIdentity":
        data = _closed_mapping(
            value,
            schema=cls.__name__,
            keys=frozenset(
                {
                    "workspaceId",
                    "gateId",
                    "lockPathId",
                    "deviceId",
                    "inode",
                    "fileType",
                    "openedNoFollow",
                    "lockIdentityDigest",
                }
            ),
        )
        if (
            data["lockPathId"] != cls.lock_path_id
            or data["fileType"] != cls.file_type
            or data["openedNoFollow"] is not True
        ):
            raise ValueError("invalid Gate publish lock identity")
        return cls(
            workspace_id=data["workspaceId"],
            gate_id=data["gateId"],
            device_id=data["deviceId"],
            inode=data["inode"],
            lock_identity_digest=data["lockIdentityDigest"],
        )


@dataclass(frozen=True)
class TrustDispatchLease:
    workspace_id: str
    gate_id: str
    selected_trust_generation_ref: PowerControllerTrustGenerationRef
    selected_current_trust_digest: str
    controller_runtime_epoch_id: str
    controller_runtime_epoch_digest: str
    command_id: str
    command_identity_digest: str
    resolution_request_digest: str
    expected_head_digest: str
    command_lock_identity_digest: str
    holder_pid: int
    holder_process_start_identity: ProcessStartIdentity
    publish_lock_identity: GatePublishLockIdentity
    random_lease_bytes: bytes
    trust_dispatch_lease_digest: str
    lock_mode: ClassVar[str] = "SHARED"

    def __post_init__(self) -> None:
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gateId")
        if (
            type(self.selected_trust_generation_ref)
            is not PowerControllerTrustGenerationRef
            or self.selected_trust_generation_ref.workspace_id != self.workspace_id
            or self.selected_trust_generation_ref.gate_id != self.gate_id
        ):
            raise ValueError("selected trust generation scope mismatch")
        for digest in (
            self.selected_current_trust_digest,
            self.controller_runtime_epoch_digest,
            self.command_identity_digest,
            self.resolution_request_digest,
            self.expected_head_digest,
            self.command_lock_identity_digest,
            self.trust_dispatch_lease_digest,
        ):
            validate_sha256(digest)
        for value, field in (
            (self.controller_runtime_epoch_id, "controllerRuntimeEpochId"),
            (self.command_id, "commandId"),
        ):
            _validate_non_empty_utf8(value, field=field, maximum_bytes=256)
        if type(self.holder_pid) is not int or self.holder_pid <= 0:
            raise ValueError("holderPid must be positive")
        if not isinstance(
            self.holder_process_start_identity,
            (DarwinProcessStartIdentity, LinuxProcessStartIdentity),
        ):
            raise ValueError("holderProcessStartIdentity must be typed")
        if (
            type(self.publish_lock_identity) is not GatePublishLockIdentity
            or self.publish_lock_identity.workspace_id != self.workspace_id
            or self.publish_lock_identity.gate_id != self.gate_id
        ):
            raise ValueError("publish lock identity scope mismatch")
        if type(self.random_lease_bytes) is not bytes or len(self.random_lease_bytes) != 32:
            raise ValueError("random lease must be 32 process-memory bytes")
        if self.trust_dispatch_lease_digest != domain_separated_sha256(
            _TRUST_DISPATCH_LEASE_DOMAIN, self._digest_payload()
        ):
            raise ValueError("trustDispatchLeaseDigest mismatch")

    def _digest_payload(self) -> dict[str, object]:
        return {
            "workspaceId": self.workspace_id,
            "gateId": self.gate_id,
            "selectedTrustGenerationRef": self.selected_trust_generation_ref.to_dict(),
            "selectedCurrentTrustDigest": self.selected_current_trust_digest,
            "controllerRuntimeEpochId": self.controller_runtime_epoch_id,
            "controllerRuntimeEpochDigest": self.controller_runtime_epoch_digest,
            "commandId": self.command_id,
            "commandIdentityDigest": self.command_identity_digest,
            "resolutionRequestDigest": self.resolution_request_digest,
            "expectedHeadDigest": self.expected_head_digest,
            "commandLockIdentityDigest": self.command_lock_identity_digest,
            "holderPid": self.holder_pid,
            "holderProcessStartIdentity": self.holder_process_start_identity.to_dict(),
            "publishLockIdentity": self.publish_lock_identity.to_dict(),
            "lockMode": self.lock_mode,
            "randomLeaseBytesHex": self.random_lease_bytes.hex(),
        }

    @classmethod
    def create(cls, **values: object) -> "TrustDispatchLease":
        payload = {
            "workspaceId": values["workspace_id"],
            "gateId": values["gate_id"],
            "selectedTrustGenerationRef": (
                values["selected_trust_generation_ref"].to_dict()
            ),
            "selectedCurrentTrustDigest": values[
                "selected_current_trust_digest"
            ],
            "controllerRuntimeEpochId": values["controller_runtime_epoch_id"],
            "controllerRuntimeEpochDigest": values[
                "controller_runtime_epoch_digest"
            ],
            "commandId": values["command_id"],
            "commandIdentityDigest": values["command_identity_digest"],
            "resolutionRequestDigest": values["resolution_request_digest"],
            "expectedHeadDigest": values["expected_head_digest"],
            "commandLockIdentityDigest": values["command_lock_identity_digest"],
            "holderPid": values["holder_pid"],
            "holderProcessStartIdentity": values[
                "holder_process_start_identity"
            ].to_dict(),
            "publishLockIdentity": values["publish_lock_identity"].to_dict(),
            "lockMode": cls.lock_mode,
            "randomLeaseBytesHex": values["random_lease_bytes"].hex(),
        }
        return cls(
            **values,
            trust_dispatch_lease_digest=domain_separated_sha256(
                _TRUST_DISPATCH_LEASE_DOMAIN, payload
            ),
        )

    def __reduce__(self) -> object:
        raise TypeError("TrustDispatchLease is process-local and non-serializable")

    def __deepcopy__(self, memo: object) -> object:
        raise TypeError("TrustDispatchLease cannot be copied")


@dataclass(frozen=True)
class DurabilityProbeRuntimeManifest:
    probe_source_digest: str
    runtime_measurement: PreflightRuntimeMeasurement
    captured_runtime_files: tuple[CapturedRuntimeFile, ...]
    runtime_artifacts: tuple[DurabilityCapabilityArtifactRef, ...]
    runtime_capture_bundle_digest: str
    runtime_capture_id: str
    runtime_capture_digest: str
    probe_runtime_digest: str
    artifact_kind: ClassVar[str] = "acceptance-durability-probe-runtime"
    schema_version: ClassVar[int] = 1

    def __post_init__(self) -> None:
        for digest in (
            self.probe_source_digest, self.runtime_capture_bundle_digest,
            self.runtime_capture_digest, self.probe_runtime_digest,
        ):
            validate_sha256(digest)
        _validate_non_empty_utf8(self.runtime_capture_id, field="runtimeCaptureId", maximum_bytes=256)
        _validate_runtime_capture_files(self.runtime_measurement, self.captured_runtime_files)
        if (
            type(self.runtime_artifacts) is not tuple
            or len(self.runtime_artifacts) != len(self.captured_runtime_files)
            or any(type(ref) is not DurabilityCapabilityArtifactRef for ref in self.runtime_artifacts)
        ):
            raise ValueError("runtimeArtifacts must match captured file cardinality")
        scopes = {
            (ref.workspace_id, ref.gate_id, ref.crash_fixture_id)
            for ref in self.runtime_artifacts
        }
        if len(scopes) != 1:
            raise ValueError("probe runtime artifacts must share one qualification scope")
        for ref, captured in zip(self.runtime_artifacts, self.captured_runtime_files):
            if (
                ref.artifact_name is not DurabilityCapabilityArtifactName.PROBE_RUNTIME_BLOB
                or ref.content_sha256 != captured.file_sha256
                or ref.byte_length != captured.byte_length
            ):
                raise ValueError("probe runtime refs must match captured files in exact order")
        capture = {
            "captureId": self.runtime_capture_id,
            "measurement": self.runtime_measurement.to_dict(),
            "files": [item.to_dict() for item in self.captured_runtime_files],
            "runtimeCaptureBundleDigest": self.runtime_capture_bundle_digest,
        }
        if self.runtime_capture_digest != domain_separated_sha256(_RUNTIME_CAPTURE_DOMAIN, capture):
            raise ValueError("runtimeCaptureDigest mismatch")
        if self.probe_runtime_digest != domain_separated_sha256(
            _DURABILITY_PROBE_RUNTIME_DOMAIN, self._payload()
        ):
            raise ValueError("probeRuntimeDigest mismatch")

    def _payload(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind, "schemaVersion": self.schema_version,
            "probeSourceDigest": self.probe_source_digest,
            "runtimeMeasurement": self.runtime_measurement.to_dict(),
            "capturedRuntimeFiles": [item.to_dict() for item in self.captured_runtime_files],
            "runtimeArtifacts": [item.to_dict() for item in self.runtime_artifacts],
            "runtimeCaptureBundleDigest": self.runtime_capture_bundle_digest,
            "runtimeCaptureId": self.runtime_capture_id,
            "runtimeCaptureDigest": self.runtime_capture_digest,
        }

    def to_dict(self) -> dict[str, object]:
        return {**self._payload(), "probeRuntimeDigest": self.probe_runtime_digest}

    @classmethod
    def from_dict(cls, value: object) -> "DurabilityProbeRuntimeManifest":
        data = _closed_mapping(value, schema=cls.__name__, keys=frozenset({
            "artifactKind", "schemaVersion", "probeSourceDigest",
            "runtimeMeasurement", "capturedRuntimeFiles", "runtimeArtifacts",
            "runtimeCaptureBundleDigest", "runtimeCaptureId", "runtimeCaptureDigest",
            "probeRuntimeDigest",
        }))
        if data["artifactKind"] != cls.artifact_kind or type(data["schemaVersion"]) is not int or data["schemaVersion"] != 1:
            raise ValueError("invalid durability probe runtime schema")
        for field in ("capturedRuntimeFiles", "runtimeArtifacts"):
            if type(data[field]) is not list or not 3 <= len(data[field]) <= 1024:
                raise ValueError(f"{field} must be a bounded wire array")
        return cls(
            data["probeSourceDigest"], PreflightRuntimeMeasurement.from_dict(data["runtimeMeasurement"]),
            tuple(CapturedRuntimeFile.from_dict(item) for item in data["capturedRuntimeFiles"]),
            tuple(DurabilityCapabilityArtifactRef.from_dict(item) for item in data["runtimeArtifacts"]),
            data["runtimeCaptureBundleDigest"], data["runtimeCaptureId"],
            data["runtimeCaptureDigest"], data["probeRuntimeDigest"],
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
class ProofAuthorityDurabilityCapabilityEvidence:
    os_family: RuntimeOsFamily
    backend: DurabilityBackend
    stable_volume_identity: StableVolumeIdentity
    qualified_host_build: RuntimeHostBuild
    qualified_host_identity: RuntimeHostIdentity
    filesystem_implementation_version: str
    required_mount_options: tuple[str, ...]
    probe_source_files: tuple[tuple[str, str, int], ...]
    probe_source_digest: str
    probe_runtime_digest: str
    successful_operations: tuple[DurabilitySyncOperation, ...]
    crash_fixture_id: str
    qualification_run_id: str
    crash_fixture_manifest_ref: DurabilityCapabilityArtifactRef
    crash_fixture_artifacts: tuple[DurabilityCapabilityArtifactRef, ...]
    bootstrap_qualification_manifest_digest: str
    controller_trust_anchor_ref: PowerControllerTrustAnchorRef
    controller_trust_anchor_digest: str
    controller_runtime_digest: str
    controller_runtime_lock_backend_digest: str
    result: DurabilitySupportResult
    observed_at: str
    capability_evidence_digest: str
    evidence_rule: ClassVar[str] = "DURABILITY_CAPABILITY_EVIDENCE_V1"

    def __post_init__(self) -> None:
        if self.os_family not in (RuntimeOsFamily.DARWIN, RuntimeOsFamily.LINUX):
            raise ValueError("capability OS must be DARWIN or LINUX")
        expected_backend = (
            DurabilityBackend.DARWIN_APFS_FULLFSYNC_V1 if self.os_family is RuntimeOsFamily.DARWIN
            else DurabilityBackend.LINUX_FILE_AND_DIRECTORY_FSYNC_V1
        )
        if self.backend is not expected_backend:
            raise ValueError("capability backend must match OS")
        expected_operations = (DurabilitySyncOperation.SYNC_FILE, DurabilitySyncOperation.SYNC_DIRECTORY)
        if self.os_family is RuntimeOsFamily.DARWIN:
            expected_operations += (DurabilitySyncOperation.SYNC_ANCHOR,)
        if type(self.successful_operations) is not tuple or self.successful_operations != expected_operations:
            raise ValueError("successfulOperations must match exact backend sequence")
        # Reuse the closed host/build/volume/mount qualification checks.
        DurabilityQualifiedEnvironment.create(
            host_build=self.qualified_host_build, host_identity=self.qualified_host_identity,
            filesystem_implementation_version=self.filesystem_implementation_version,
            required_mount_options=self.required_mount_options,
            stable_volume_identity=self.stable_volume_identity,
            probe_runtime_digest=self.probe_runtime_digest,
        )
        if self.qualified_host_build.os_family is not self.os_family:
            raise ValueError("qualified host OS must match capability OS")
        if type(self.probe_source_files) is not tuple or not 1 <= len(self.probe_source_files) <= 64:
            raise ValueError("probeSourceFiles must contain 1..64 immutable triples")
        paths = []
        total = 0
        for item in self.probe_source_files:
            if type(item) is not tuple or len(item) != 3:
                raise ValueError("probe source must be an immutable triple")
            paths.append(validate_repo_relative_path(item[0]))
            validate_sha256(item[1])
            if type(item[2]) is not int or not 0 <= item[2] <= 8 * 1024 * 1024:
                raise ValueError("probe source file exceeds entry limit")
            total += item[2]
        if paths != sorted(set(paths), key=lambda path: path.encode("utf-8")) or total > 64 * 1024 * 1024:
            raise ValueError("probe sources must be unique lexical bounded inventory")
        validate_sha256(self.probe_source_digest)
        if self.probe_source_digest != domain_separated_sha256(
            _DURABILITY_PROBE_SOURCE_DOMAIN, [list(item) for item in self.probe_source_files]
        ):
            raise ValueError("probeSourceDigest mismatch")
        _validate_slug(self.crash_fixture_id, field="crashFixtureId")
        _validate_slug(self.qualification_run_id, field="qualificationRunId")
        if type(self.crash_fixture_manifest_ref) is not DurabilityCapabilityArtifactRef:
            raise ValueError("crashFixtureManifestRef must be concrete")
        if self.crash_fixture_manifest_ref.artifact_name is not DurabilityCapabilityArtifactName.MANIFEST:
            raise ValueError("crashFixtureManifestRef must name MANIFEST")
        if (
            type(self.crash_fixture_artifacts) is not tuple
            or not 1 <= len(self.crash_fixture_artifacts) <= 4096
            or any(type(ref) is not DurabilityCapabilityArtifactRef for ref in self.crash_fixture_artifacts)
        ):
            raise ValueError("crashFixtureArtifacts must be a bounded concrete tuple")
        scope = (
            self.crash_fixture_manifest_ref.workspace_id,
            self.crash_fixture_manifest_ref.gate_id, self.crash_fixture_id,
        )
        if any(
            (ref.workspace_id, ref.gate_id, ref.crash_fixture_id) != scope
            for ref in (self.crash_fixture_manifest_ref, *self.crash_fixture_artifacts)
        ):
            raise ValueError("crash fixture references must match qualification scope")
        if len({ref.durability_capability_ref_digest for ref in self.crash_fixture_artifacts}) != len(self.crash_fixture_artifacts):
            raise ValueError("crash fixture references must be unique")
        for name in (
            DurabilityCapabilityArtifactName.EXPECTATION, DurabilityCapabilityArtifactName.MANIFEST,
            DurabilityCapabilityArtifactName.PROBE_RUNTIME_MANIFEST,
            DurabilityCapabilityArtifactName.CONTROLLER_RUNTIME_EPOCH,
            DurabilityCapabilityArtifactName.CONTROLLER_RUNTIME_CURRENT,
        ):
            if sum(ref.artifact_name is name for ref in self.crash_fixture_artifacts) != 1:
                raise ValueError(f"capability requires exactly one {name.value}")
        if self.crash_fixture_manifest_ref not in self.crash_fixture_artifacts:
            raise ValueError("crashFixtureManifestRef must equal inventory MANIFEST ref")
        if type(self.controller_trust_anchor_ref) is not PowerControllerTrustAnchorRef:
            raise ValueError("controllerTrustAnchorRef must be concrete")
        if (self.controller_trust_anchor_ref.workspace_id, self.controller_trust_anchor_ref.gate_id) != scope[:2]:
            raise ValueError("controller trust anchor must match capability scope")
        for digest in (
            self.bootstrap_qualification_manifest_digest, self.controller_trust_anchor_digest,
            self.controller_runtime_digest, self.controller_runtime_lock_backend_digest,
            self.capability_evidence_digest,
        ):
            validate_sha256(digest)
        if self.controller_trust_anchor_ref.trust_anchor_digest != self.controller_trust_anchor_digest:
            raise ValueError("controllerTrustAnchorDigest must match ref")
        if self.result is not DurabilitySupportResult.SUPPORTED:
            raise ValueError("capability result must be SUPPORTED")
        _canonical_utc_instant(self.observed_at, field="observedAt")
        if self.capability_evidence_digest != domain_separated_sha256(
            _DURABILITY_CAPABILITY_EVIDENCE_DOMAIN, self._payload()
        ):
            raise ValueError("capabilityEvidenceDigest mismatch")

    def _payload(self) -> dict[str, object]:
        return {
            "evidenceRule": self.evidence_rule, "osFamily": self.os_family.value,
            "backend": self.backend.value, "stableVolumeIdentity": self.stable_volume_identity.to_dict(),
            "qualifiedHostBuild": self.qualified_host_build.to_dict(),
            "qualifiedHostIdentity": self.qualified_host_identity.to_dict(),
            "filesystemImplementationVersion": self.filesystem_implementation_version,
            "requiredMountOptions": list(self.required_mount_options),
            "probeSourceFiles": [list(item) for item in self.probe_source_files],
            "probeSourceDigest": self.probe_source_digest, "probeRuntimeDigest": self.probe_runtime_digest,
            "successfulOperations": [item.value for item in self.successful_operations],
            "crashFixtureId": self.crash_fixture_id, "qualificationRunId": self.qualification_run_id,
            "crashFixtureManifestRef": self.crash_fixture_manifest_ref.to_dict(),
            "crashFixtureArtifacts": [ref.to_dict() for ref in self.crash_fixture_artifacts],
            "bootstrapQualificationManifestDigest": self.bootstrap_qualification_manifest_digest,
            "controllerTrustAnchorRef": self.controller_trust_anchor_ref.to_dict(),
            "controllerTrustAnchorDigest": self.controller_trust_anchor_digest,
            "controllerRuntimeDigest": self.controller_runtime_digest,
            "controllerRuntimeLockBackendDigest": self.controller_runtime_lock_backend_digest,
            "result": self.result.value, "observedAt": self.observed_at,
        }

    def to_dict(self) -> dict[str, object]:
        return {**self._payload(), "capabilityEvidenceDigest": self.capability_evidence_digest}

    def validate_maintenance_source(self, runtime: FinalizerMaintenanceRuntimeIdentity) -> None:
        if type(runtime) is not FinalizerMaintenanceRuntimeIdentity:
            raise ValueError("maintenance runtime must be concrete")
        if not set(self.probe_source_files).issubset(runtime.worker_source_files):
            raise ValueError("probe source must be exact subset of maintenance source")
        if runtime.runtime_measurement.platform_runtime.host_build != self.qualified_host_build:
            raise ValueError("maintenance runtime must match qualified host build")

    def validate_manifest_runtime(
        self, manifest: DurabilityCrashFixtureManifest, probe: DurabilityProbeRuntimeManifest
    ) -> None:
        """Validate resolved manifest/runtime; controller/trace admission is separate."""
        if type(manifest) is not DurabilityCrashFixtureManifest or type(probe) is not DurabilityProbeRuntimeManifest:
            raise ValueError("qualification manifest and probe runtime must be concrete")
        if (
            manifest.workspace_id, manifest.gate_id, manifest.crash_fixture_id,
            manifest.qualification_run_id, manifest.backend, manifest.stable_volume_identity,
            manifest.controller_runtime_digest, manifest.controller_runtime_lock_backend_digest,
        ) != (
            self.crash_fixture_manifest_ref.workspace_id, self.crash_fixture_manifest_ref.gate_id,
            self.crash_fixture_id, self.qualification_run_id, self.backend, self.stable_volume_identity,
            self.controller_runtime_digest, self.controller_runtime_lock_backend_digest,
        ):
            raise ValueError("manifest identity must match capability")
        qualified = manifest.qualified_environment
        if (
            qualified.host_build, qualified.host_identity, qualified.filesystem_implementation_version,
            qualified.required_mount_options, qualified.probe_runtime_digest,
        ) != (
            self.qualified_host_build, self.qualified_host_identity, self.filesystem_implementation_version,
            self.required_mount_options, self.probe_runtime_digest,
        ):
            raise ValueError("manifest qualification must match capability")
        if (
            self.crash_fixture_manifest_ref.object_digest != manifest.crash_fixture_manifest_digest
            or self.bootstrap_qualification_manifest_digest != manifest.crash_fixture_manifest_digest
            or probe.probe_runtime_digest != self.probe_runtime_digest
            or probe.probe_source_digest != self.probe_source_digest
        ):
            raise ValueError("qualification/probe digest mismatch")
        references = set(self.crash_fixture_artifacts)
        required = {
            manifest.expectation_ref, manifest.probe_runtime_manifest_ref,
            *probe.runtime_artifacts,
            *(ref for case in manifest.cases for ref in (case.trace_ref, case.recovery_result_ref)),
        }
        if not required.issubset(references):
            raise ValueError("capability inventory omits manifest/runtime artifact")
        for name in (
            DurabilityCapabilityArtifactName.PROBE_RUNTIME_BLOB,
            DurabilityCapabilityArtifactName.POWER_CUT_TRACE,
            DurabilityCapabilityArtifactName.RECOVERY_RESULT,
        ):
            if {ref for ref in references if ref.artifact_name is name} != {
                ref for ref in required if ref.artifact_name is name
            }:
                raise ValueError(f"capability inventory has extra {name.value}")

    @classmethod
    def from_dict(cls, value: object) -> "ProofAuthorityDurabilityCapabilityEvidence":
        fields = frozenset({
            "evidenceRule", "osFamily", "backend", "stableVolumeIdentity", "qualifiedHostBuild",
            "qualifiedHostIdentity", "filesystemImplementationVersion", "requiredMountOptions",
            "probeSourceFiles", "probeSourceDigest", "probeRuntimeDigest", "successfulOperations",
            "crashFixtureId", "qualificationRunId", "crashFixtureManifestRef",
            "crashFixtureArtifacts", "bootstrapQualificationManifestDigest",
            "controllerTrustAnchorRef", "controllerTrustAnchorDigest", "controllerRuntimeDigest",
            "controllerRuntimeLockBackendDigest", "result", "observedAt", "capabilityEvidenceDigest",
        })
        data = _closed_mapping(value, schema=cls.__name__, keys=fields)
        if data["evidenceRule"] != cls.evidence_rule:
            raise ValueError("unknown durability capability evidence rule")
        for field, limit in (
            ("requiredMountOptions", 4096), ("probeSourceFiles", 64),
            ("successfulOperations", 3), ("crashFixtureArtifacts", 4096),
        ):
            if type(data[field]) is not list or len(data[field]) > limit:
                raise ValueError(f"{field} must be a bounded wire array")
        if any(type(item) is not list or len(item) != 3 for item in data["probeSourceFiles"]):
            raise ValueError("probeSourceFiles must contain triple arrays")
        return cls(
            _enum_from_wire(RuntimeOsFamily, data["osFamily"], field="osFamily"),
            _enum_from_wire(DurabilityBackend, data["backend"], field="backend"),
            stable_volume_identity_from_dict(data["stableVolumeIdentity"]),
            runtime_host_build_from_dict(data["qualifiedHostBuild"]),
            runtime_host_identity_from_dict(data["qualifiedHostIdentity"]),
            data["filesystemImplementationVersion"], tuple(data["requiredMountOptions"]),
            tuple(tuple(item) for item in data["probeSourceFiles"]),
            data["probeSourceDigest"], data["probeRuntimeDigest"],
            tuple(_enum_from_wire(DurabilitySyncOperation, item, field="successfulOperation")
                  for item in data["successfulOperations"]),
            data["crashFixtureId"], data["qualificationRunId"],
            DurabilityCapabilityArtifactRef.from_dict(data["crashFixtureManifestRef"]),
            tuple(DurabilityCapabilityArtifactRef.from_dict(item) for item in data["crashFixtureArtifacts"]),
            data["bootstrapQualificationManifestDigest"],
            PowerControllerTrustAnchorRef.from_dict(data["controllerTrustAnchorRef"]),
            data["controllerTrustAnchorDigest"], data["controllerRuntimeDigest"],
            data["controllerRuntimeLockBackendDigest"],
            _enum_from_wire(DurabilitySupportResult, data["result"], field="result"),
            data["observedAt"], data["capabilityEvidenceDigest"],
        )


class _ProofAuthorityDurabilityProfile:
    def _validate(self) -> None:
        if type(self.capability_evidence) is not ProofAuthorityDurabilityCapabilityEvidence:
            raise ValueError("capabilityEvidence must be concrete")
        evidence = self.capability_evidence
        if (
            evidence.os_family, evidence.backend, evidence.stable_volume_identity
        ) != (self.os_family, self.backend, self.stable_volume_identity):
            raise ValueError("profile OS/backend/volume must match capability evidence")
        validate_sha256(self.durability_profile_digest)
        if self.durability_profile_digest != domain_separated_sha256(
            _DURABILITY_PROFILE_DOMAIN[self.os_family.value], self._payload()
        ):
            raise ValueError("durabilityProfileDigest mismatch")

    def _payload(self) -> dict[str, object]:
        return {
            "osFamily": self.os_family.value, "backend": self.backend.value,
            "stableVolumeIdentity": self.stable_volume_identity.to_dict(),
            "syncAnchorIdentity": None if self.sync_anchor_identity is None else self.sync_anchor_identity.to_dict(),
            "capabilityEvidence": self.capability_evidence.to_dict(),
        }

    def to_dict(self) -> dict[str, object]:
        return {**self._payload(), "durabilityProfileDigest": self.durability_profile_digest}

    @classmethod
    def from_dict(cls, value: object):
        data = _closed_mapping(value, schema=cls.__name__, keys=frozenset({
            "osFamily", "backend", "stableVolumeIdentity", "syncAnchorIdentity",
            "capabilityEvidence", "durabilityProfileDigest",
        }))
        if data["osFamily"] != cls.os_family.value or data["backend"] != cls.backend.value:
            raise ValueError("durability profile branch mismatch")
        return cls(
            stable_volume_identity_from_dict(data["stableVolumeIdentity"]),
            None if data["syncAnchorIdentity"] is None else DurabilitySyncAnchorIdentity.from_dict(data["syncAnchorIdentity"]),
            ProofAuthorityDurabilityCapabilityEvidence.from_dict(data["capabilityEvidence"]),
            data["durabilityProfileDigest"],
        )


@dataclass(frozen=True)
class LinuxProofAuthorityDurabilityProfile(_ProofAuthorityDurabilityProfile):
    stable_volume_identity: LinuxStableVolumeIdentity
    sync_anchor_identity: None
    capability_evidence: ProofAuthorityDurabilityCapabilityEvidence
    durability_profile_digest: str
    os_family: ClassVar[RuntimeOsFamily] = RuntimeOsFamily.LINUX
    backend: ClassVar[DurabilityBackend] = DurabilityBackend.LINUX_FILE_AND_DIRECTORY_FSYNC_V1

    def __post_init__(self) -> None:
        if type(self.stable_volume_identity) is not LinuxStableVolumeIdentity or self.sync_anchor_identity is not None:
            raise ValueError("Linux profile requires Linux volume and null anchor")
        self._validate()


@dataclass(frozen=True)
class DarwinProofAuthorityDurabilityProfile(_ProofAuthorityDurabilityProfile):
    stable_volume_identity: DarwinStableVolumeIdentity
    sync_anchor_identity: DurabilitySyncAnchorIdentity
    capability_evidence: ProofAuthorityDurabilityCapabilityEvidence
    durability_profile_digest: str
    os_family: ClassVar[RuntimeOsFamily] = RuntimeOsFamily.DARWIN
    backend: ClassVar[DurabilityBackend] = DurabilityBackend.DARWIN_APFS_FULLFSYNC_V1

    def __post_init__(self) -> None:
        if type(self.stable_volume_identity) is not DarwinStableVolumeIdentity or type(self.sync_anchor_identity) is not DurabilitySyncAnchorIdentity:
            raise ValueError("Darwin profile requires Darwin volume and concrete sync anchor")
        self._validate()


ProofAuthorityDurabilityProfile = Union[
    LinuxProofAuthorityDurabilityProfile, DarwinProofAuthorityDurabilityProfile
]


@dataclass(frozen=True)
class FinalizerRequirementRecord:
    artifact_kind: str
    schema_version: int
    enforcement_generation: int
    enforcement_digest: str
    workspace_id: str
    source_commit: str
    workspace_digest: str
    canonical_worktree_hash: str
    requirement: FinalizerRequirement
    config: FinalizerExecutionConfig
    protected_baseline: FinalizerProtectedBaseline
    bootstrap_baseline: FinalizerBootstrapBaseline
    requirement_mapping: RequiredFinalizerMapping
    captured_sources: tuple[CapturedProtectedSource, ...]
    protected_source_artifacts: tuple[ProtectedSourceArtifact, ...]
    registry_entry: FinalizerRegistryEntry
    source_files: tuple[tuple[str, str], ...]
    source_capture_id: str
    source_capture_digest: str
    source_capture_bundle_digest: str
    runtime_capture_id: str
    runtime_capture_digest: str
    runtime_measurement: PreflightRuntimeMeasurement
    captured_runtime_files: tuple[CapturedRuntimeFile, ...]
    runtime_capture_bundle_digest: str
    runtime_evidence_artifacts: tuple[RuntimeEvidenceArtifact, ...]
    finalizer_runtime: FinalizerRuntimeIdentity
    durability_profile: ProofAuthorityDurabilityProfile
    requirement_digest: str
    config_digest: str
    source_digest: str
    created_at: str

    _WIRE_KEYS: ClassVar[frozenset[str]] = frozenset(
        {
            "artifactKind",
            "schemaVersion",
            "enforcementGeneration",
            "enforcementDigest",
            "workspaceId",
            "sourceCommit",
            "workspaceDigest",
            "canonicalWorktreeHash",
            "requirement",
            "config",
            "protectedBaseline",
            "bootstrapBaseline",
            "requirementMapping",
            "capturedSources",
            "protectedSourceArtifacts",
            "registryEntry",
            "sourceFiles",
            "sourceCaptureId",
            "sourceCaptureDigest",
            "sourceCaptureBundleDigest",
            "runtimeCaptureId",
            "runtimeCaptureDigest",
            "runtimeMeasurement",
            "capturedRuntimeFiles",
            "runtimeCaptureBundleDigest",
            "runtimeEvidenceArtifacts",
            "finalizerRuntime",
            "durabilityProfile",
            "requirementDigest",
            "configDigest",
            "sourceDigest",
            "createdAt",
        }
    )

    def __post_init__(self) -> None:
        if self.artifact_kind != "acceptance-finalizer-requirement":
            raise ValueError(
                "artifactKind must be acceptance-finalizer-requirement"
            )
        if type(self.schema_version) is not int or self.schema_version != 1:
            raise ValueError("schemaVersion must be 1")
        _validate_positive_integer(
            self.enforcement_generation,
            field="enforcementGeneration",
        )
        validate_sha256(self.enforcement_digest)
        _validate_workspace_id(self.workspace_id)
        _validate_non_empty_utf8(self.source_commit, field="sourceCommit")
        _validate_non_empty_utf8(self.workspace_digest, field="workspaceDigest")
        validate_sha256(self.canonical_worktree_hash)
        if (
            type(self.requirement) is not FinalizerRequirement
            or type(self.config) is not FinalizerExecutionConfig
            or type(self.protected_baseline) is not FinalizerProtectedBaseline
            or type(self.bootstrap_baseline) is not FinalizerBootstrapBaseline
            or type(self.requirement_mapping) is not RequiredFinalizerMapping
            or type(self.registry_entry) is not FinalizerRegistryEntry
        ):
            raise ValueError("requirement record requires concrete source contracts")
        gate_id = self.requirement.gate_id
        finalizer_id = self.requirement.finalizer_id
        if (
            (self.config.gate_id, self.config.finalizer_id)
            != (gate_id, finalizer_id)
            or (
                self.protected_baseline.gate_id,
                self.protected_baseline.finalizer_id,
            )
            != (gate_id, finalizer_id)
            or (
                self.requirement_mapping.gate_id,
                self.requirement_mapping.finalizer_id,
            )
            != (gate_id, finalizer_id)
            or self.registry_entry.finalizer_id != finalizer_id
        ):
            raise ValueError("requirement record Gate/finalizer identity mismatch")
        if (
            self.requirement.finalizer_registry_path
            != self.protected_baseline.registry_file_path
            or self.requirement.protected_baseline_digest
            != self.protected_baseline.digest()
            or self.protected_baseline.requirement_mapping_digest
            != self.requirement.requirement_mapping_digest()
        ):
            raise ValueError("requirement record protected-source identity mismatch")
        _validate_captured_protected_sources(self.captured_sources)
        if (
            type(self.protected_source_artifacts) is not tuple
            or len(self.protected_source_artifacts) != len(self.captured_sources)
            or any(
                type(item) is not ProtectedSourceArtifact
                for item in self.protected_source_artifacts
            )
        ):
            raise ValueError(
                "protectedSourceArtifacts must match capturedSources cardinality"
            )
        if tuple(
            item.captured for item in self.protected_source_artifacts
        ) != self.captured_sources:
            raise ValueError(
                "protectedSourceArtifacts must preserve capturedSources exactly"
            )
        source_by_path = {
            item.repo_relative_path: item for item in self.captured_sources
        }
        expected_components = {
            self.requirement.protected_baseline_path: (
                ProtectedSourceComponent.PROTECTED_BASELINE
            ),
            self.requirement.finalizer_registry_path: (
                ProtectedSourceComponent.REGISTRATION_CATALOG
            ),
            self.protected_baseline.contract_schema_path: (
                ProtectedSourceComponent.CONTRACT_SCHEMA
            ),
            self.protected_baseline.entrypoint_source_path: (
                ProtectedSourceComponent.ENTRYPOINT_SOURCE
            ),
            self.protected_baseline.generator_source_path: (
                ProtectedSourceComponent.GENERATOR_SOURCE
            ),
            FINALIZER_BOOTSTRAP_SOURCE_PATHS[0]: (
                ProtectedSourceComponent.CORE_CONTRACTS
            ),
            FINALIZER_BOOTSTRAP_SOURCE_PATHS[1]: (
                ProtectedSourceComponent.SUPERVISOR_SOURCE
            ),
            FINALIZER_BOOTSTRAP_SOURCE_PATHS[2]: (
                ProtectedSourceComponent.CORE_WORKER_BOOTSTRAP
            ),
            FINALIZER_BOOTSTRAP_SOURCE_PATHS[3]: (
                ProtectedSourceComponent.CORE_RESULT_CONTRACTS
            ),
        }
        for path, component in expected_components.items():
            source = source_by_path.get(path)
            if source is None or source.component is not component:
                raise ValueError(
                    f"capturedSources lacks required component: {component.value}"
                )
        if sum(
            item.component is ProtectedSourceComponent.REQUIRED_MAPPING
            for item in self.captured_sources
        ) != 1:
            raise ValueError("capturedSources requires one REQUIRED_MAPPING")
        bootstrap_files = tuple(
            (
                path,
                source_by_path[path].file_sha256,
            )
            for path in FINALIZER_BOOTSTRAP_SOURCE_PATHS
        )
        if bootstrap_files != self.bootstrap_baseline.source_files:
            raise ValueError(
                "bootstrapBaseline does not match captured Core sources"
            )
        if any(
            not source_by_path[path].executable_included
            for path in (
                *FINALIZER_BOOTSTRAP_SOURCE_PATHS,
                *self.registry_entry.source_paths,
            )
        ):
            raise ValueError(
                "bootstrap and registered business sources must be executable-included"
            )
        expected_file_hashes = {
            self.requirement.protected_baseline_path: (
                self.requirement.protected_baseline_file_sha256
            ),
            self.protected_baseline.registry_file_path: (
                self.protected_baseline.registry_file_digest
            ),
            self.protected_baseline.contract_schema_path: (
                self.protected_baseline.contract_schema_digest
            ),
            self.protected_baseline.entrypoint_source_path: (
                self.protected_baseline.entrypoint_source_digest
            ),
            self.protected_baseline.generator_source_path: (
                self.protected_baseline.generator_source_digest
            ),
        }
        if any(
            source_by_path[path].file_sha256 != expected
            for path, expected in expected_file_hashes.items()
        ):
            raise ValueError(
                "protected source hash does not match parsed baseline"
            )
        _validate_file_identity_tuple(self.source_files, field="sourceFiles")
        if tuple(path for path, _ in self.source_files) != (
            self.registry_entry.source_paths
        ):
            raise ValueError("sourceFiles must project registry sourcePaths")
        if any(
            source_by_path.get(path) is None
            or source_by_path[path].file_sha256 != digest
            for path, digest in self.source_files
        ):
            raise ValueError("sourceFiles are absent from capturedSources")
        validate_sha256(self.source_digest)
        if self.source_digest != domain_separated_sha256(
            _SOURCE_DOMAIN,
            [list(item) for item in self.source_files],
        ):
            raise ValueError("sourceDigest does not match sourceFiles")
        if self.source_digest != self.registry_entry.source_digest:
            raise ValueError("sourceDigest does not match registryEntry")
        _validate_non_empty_utf8(
            self.source_capture_id,
            field="sourceCaptureId",
            maximum_bytes=256,
        )
        validate_sha256(self.source_capture_bundle_digest)
        validate_sha256(self.source_capture_digest)
        source_capture_payload = {
            "captureId": self.source_capture_id,
            "workspaceId": self.workspace_id,
            "sourceCommit": self.source_commit,
            "workspaceDigest": self.workspace_digest,
            "canonicalWorktreeHash": self.canonical_worktree_hash,
            "sourceFiles": [
                item.to_dict() for item in self.captured_sources
            ],
            "sourceCaptureBundleDigest": self.source_capture_bundle_digest,
        }
        if self.source_capture_digest != domain_separated_sha256(
            _SOURCE_CAPTURE_DOMAIN,
            source_capture_payload,
        ):
            raise ValueError(
                "sourceCaptureDigest does not match durable source capture"
            )
        _validate_non_empty_utf8(
            self.runtime_capture_id,
            field="runtimeCaptureId",
            maximum_bytes=256,
        )
        if type(self.runtime_measurement) is not PreflightRuntimeMeasurement:
            raise ValueError(
                "runtimeMeasurement must be PreflightRuntimeMeasurement"
            )
        if (
            self.runtime_measurement.core_bootstrap_source_digest
            != self.bootstrap_baseline.core_bootstrap_source_digest
        ):
            raise ValueError(
                "runtimeMeasurement does not match bootstrapBaseline"
            )
        _validate_runtime_capture_files(
            self.runtime_measurement,
            self.captured_runtime_files,
        )
        validate_sha256(self.runtime_capture_bundle_digest)
        validate_sha256(self.runtime_capture_digest)
        runtime_capture_payload = {
            "captureId": self.runtime_capture_id,
            "measurement": self.runtime_measurement.to_dict(),
            "files": [
                item.to_dict() for item in self.captured_runtime_files
            ],
            "runtimeCaptureBundleDigest": self.runtime_capture_bundle_digest,
        }
        if self.runtime_capture_digest != domain_separated_sha256(
            _RUNTIME_CAPTURE_DOMAIN,
            runtime_capture_payload,
        ):
            raise ValueError(
                "runtimeCaptureDigest does not match durable runtime capture"
            )
        if (
            type(self.runtime_evidence_artifacts) is not tuple
            or len(self.runtime_evidence_artifacts)
            != len(self.captured_runtime_files)
            or any(
                type(item) is not RuntimeEvidenceArtifact
                for item in self.runtime_evidence_artifacts
            )
        ):
            raise ValueError(
                "runtimeEvidenceArtifacts must match capturedRuntimeFiles"
            )
        if tuple(
            item.captured for item in self.runtime_evidence_artifacts
        ) != self.captured_runtime_files:
            raise ValueError(
                "runtimeEvidenceArtifacts changed captured runtime identity"
            )
        source_identities = {
            _artifact_source_identity(item.ref)
            for item in (
                *self.protected_source_artifacts,
                *self.runtime_evidence_artifacts,
            )
        }
        if len(source_identities) != 1:
            raise ValueError("durable requirement refs must share one run")
        source_identity = next(iter(source_identities))
        if source_identity[:2] != (self.workspace_id, gate_id):
            raise ValueError(
                "durable requirement refs do not match record scope"
            )
        supervisor_source_artifact = next(
            (
                item.ref
                for item in self.protected_source_artifacts
                if item.component is ProtectedSourceComponent.SUPERVISOR_SOURCE
            ),
            None,
        )
        if supervisor_source_artifact is None:
            raise ValueError("supervisor source artifact is absent")
        if type(self.finalizer_runtime) is not FinalizerRuntimeIdentity:
            raise ValueError("finalizerRuntime must be FinalizerRuntimeIdentity")
        expected_runtime = materialize_runtime_identity(
            self.runtime_measurement,
            self.captured_runtime_files,
            self.runtime_evidence_artifacts,
            supervisor_source_artifact,
        )
        if self.finalizer_runtime != expected_runtime:
            raise ValueError(
                "finalizerRuntime is not the canonical durable projection"
            )
        if type(self.durability_profile) not in (
            LinuxProofAuthorityDurabilityProfile,
            DarwinProofAuthorityDurabilityProfile,
        ):
            raise ValueError("durabilityProfile must use one closed OS branch")
        capability_ref = (
            self.durability_profile.capability_evidence.crash_fixture_manifest_ref
        )
        if (capability_ref.workspace_id, capability_ref.gate_id) != (
            self.workspace_id,
            gate_id,
        ):
            raise ValueError(
                "durabilityProfile does not match requirement record scope"
            )
        validate_sha256(self.requirement_digest)
        validate_sha256(self.config_digest)
        if self.requirement_digest != self.requirement.digest():
            raise ValueError("requirementDigest does not match requirement")
        if self.config_digest != self.config.digest():
            raise ValueError("configDigest does not match config")
        _canonical_utc_instant(self.created_at, field="createdAt")

    def to_dict(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind,
            "schemaVersion": self.schema_version,
            "enforcementGeneration": self.enforcement_generation,
            "enforcementDigest": self.enforcement_digest,
            "workspaceId": self.workspace_id,
            "sourceCommit": self.source_commit,
            "workspaceDigest": self.workspace_digest,
            "canonicalWorktreeHash": self.canonical_worktree_hash,
            "requirement": self.requirement.to_dict(),
            "config": self.config.to_dict(),
            "protectedBaseline": self.protected_baseline.to_dict(),
            "bootstrapBaseline": self.bootstrap_baseline.to_dict(),
            "requirementMapping": self.requirement_mapping.to_dict(),
            "capturedSources": [
                item.to_dict() for item in self.captured_sources
            ],
            "protectedSourceArtifacts": [
                item.to_dict() for item in self.protected_source_artifacts
            ],
            "registryEntry": self.registry_entry.to_dict(),
            "sourceFiles": [list(item) for item in self.source_files],
            "sourceCaptureId": self.source_capture_id,
            "sourceCaptureDigest": self.source_capture_digest,
            "sourceCaptureBundleDigest": self.source_capture_bundle_digest,
            "runtimeCaptureId": self.runtime_capture_id,
            "runtimeCaptureDigest": self.runtime_capture_digest,
            "runtimeMeasurement": self.runtime_measurement.to_dict(),
            "capturedRuntimeFiles": [
                item.to_dict() for item in self.captured_runtime_files
            ],
            "runtimeCaptureBundleDigest": self.runtime_capture_bundle_digest,
            "runtimeEvidenceArtifacts": [
                item.to_dict() for item in self.runtime_evidence_artifacts
            ],
            "finalizerRuntime": self.finalizer_runtime.to_dict(),
            "durabilityProfile": self.durability_profile.to_dict(),
            "requirementDigest": self.requirement_digest,
            "configDigest": self.config_digest,
            "sourceDigest": self.source_digest,
            "createdAt": self.created_at,
        }

    @classmethod
    def from_dict(cls, value: object) -> "FinalizerRequirementRecord":
        data = _closed_mapping(value, schema=cls.__name__, keys=cls._WIRE_KEYS)
        array_fields = (
            "capturedSources",
            "protectedSourceArtifacts",
            "sourceFiles",
            "capturedRuntimeFiles",
            "runtimeEvidenceArtifacts",
        )
        if any(type(data[field]) is not list for field in array_fields):
            raise ValueError("requirement record inventories must be arrays")
        return cls(
            artifact_kind=data["artifactKind"],
            schema_version=data["schemaVersion"],
            enforcement_generation=data["enforcementGeneration"],
            enforcement_digest=data["enforcementDigest"],
            workspace_id=data["workspaceId"],
            source_commit=data["sourceCommit"],
            workspace_digest=data["workspaceDigest"],
            canonical_worktree_hash=data["canonicalWorktreeHash"],
            requirement=FinalizerRequirement.from_dict(data["requirement"]),
            config=FinalizerExecutionConfig.from_dict(data["config"]),
            protected_baseline=FinalizerProtectedBaseline.from_dict(
                data["protectedBaseline"]
            ),
            bootstrap_baseline=FinalizerBootstrapBaseline.from_dict(
                data["bootstrapBaseline"]
            ),
            requirement_mapping=RequiredFinalizerMapping.from_dict(
                data["requirementMapping"]
            ),
            captured_sources=tuple(
                CapturedProtectedSource.from_dict(item)
                for item in data["capturedSources"]
            ),
            protected_source_artifacts=tuple(
                ProtectedSourceArtifact.from_dict(item)
                for item in data["protectedSourceArtifacts"]
            ),
            registry_entry=FinalizerRegistryEntry.from_dict(
                data["registryEntry"]
            ),
            source_files=_file_identity_tuple_from_wire(
                data["sourceFiles"],
                field="sourceFiles",
            ),
            source_capture_id=data["sourceCaptureId"],
            source_capture_digest=data["sourceCaptureDigest"],
            source_capture_bundle_digest=data["sourceCaptureBundleDigest"],
            runtime_capture_id=data["runtimeCaptureId"],
            runtime_capture_digest=data["runtimeCaptureDigest"],
            runtime_measurement=PreflightRuntimeMeasurement.from_dict(
                data["runtimeMeasurement"]
            ),
            captured_runtime_files=tuple(
                CapturedRuntimeFile.from_dict(item)
                for item in data["capturedRuntimeFiles"]
            ),
            runtime_capture_bundle_digest=data["runtimeCaptureBundleDigest"],
            runtime_evidence_artifacts=tuple(
                RuntimeEvidenceArtifact.from_dict(item)
                for item in data["runtimeEvidenceArtifacts"]
            ),
            finalizer_runtime=FinalizerRuntimeIdentity.from_dict(
                data["finalizerRuntime"]
            ),
            durability_profile=proof_authority_durability_profile_from_dict(
                data["durabilityProfile"]
            ),
            requirement_digest=data["requirementDigest"],
            config_digest=data["configDigest"],
            source_digest=data["sourceDigest"],
            created_at=data["createdAt"],
        )


def proof_authority_durability_profile_from_dict(value: object) -> ProofAuthorityDurabilityProfile:
    if not isinstance(value, Mapping):
        raise ValueError("durability profile must be a closed OS-tagged object")
    if value.get("osFamily") == "LINUX":
        return LinuxProofAuthorityDurabilityProfile.from_dict(value)
    if value.get("osFamily") == "DARWIN":
        return DarwinProofAuthorityDurabilityProfile.from_dict(value)
    raise ValueError("unknown durability profile OS")


class FinalizerAuthorityAction(str, Enum):
    INSTALL_INTERLOCK = "INSTALL_INTERLOCK"
    ACTIVATE_GENERATION = "ACTIVATE_GENERATION"


@dataclass(frozen=True)
class FinalizerAuthorityAuthorization:
    action: FinalizerAuthorityAction
    authorization_id: str
    operator_identity: AbortOperatorIdentity
    workspace_id: str
    gate_id: str
    required_finalizer_id: str
    target_generation: int | None
    expected_current_generation: int | None
    expected_prior_latest_pointer: LatestPointer | None
    expected_prior_latest_pointer_digest: str | None
    requirement_digest: str | None
    config_digest: str | None
    source_digest: str | None
    protected_baseline_digest: str | None
    expected_interlock_digest: str | None
    proof_admission_source_digest: str
    proof_admission_quiescence: ProofAdmissionQuiescence | None
    maintenance_runtime: FinalizerMaintenanceRuntimeIdentity
    durability_profile: ProofAuthorityDurabilityProfile
    authority_source_commit: str
    approval_document_sha256: str
    authorized_at: str
    confirmation_challenge_digest: str
    authorization_digest: str
    artifact_kind: ClassVar[str] = "acceptance-finalizer-authority-authorization"
    schema_version: ClassVar[int] = 1
    proof_admission_inventory_rule: ClassVar[str] = "ALL_TRACKED_ACCEPTANCE_CLAIM_SOURCES"
    approval_document_path: ClassVar[str] = "docs/architecture/engineering/acceptance/decisions.md"
    decision_id: ClassVar[str] = "D-19"
    decision_status: ClassVar[str] = "accepted"
    _CONFIRMATION_DOMAIN: ClassVar[str] = "pt.acceptance.finalization.authority-confirmation.v1"
    _AUTHORIZATION_DOMAIN: ClassVar[str] = "pt.acceptance.finalization.authority-authorization.v1"

    def __post_init__(self) -> None:
        if type(self.action) is not FinalizerAuthorityAction:
            raise ValueError("authority action must be closed")
        _validate_slug(self.authorization_id, field="authorizationId")
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gateId")
        _validate_slug(self.required_finalizer_id, field="requiredFinalizerId")
        if type(self.operator_identity) is not AbortOperatorIdentity:
            raise ValueError("operatorIdentity must be concrete")
        _validate_non_empty_utf8(self.authority_source_commit, field="authoritySourceCommit")
        _canonical_utc_instant(self.authorized_at, field="authorizedAt")
        validate_sha256(self.approval_document_sha256)
        validate_sha256(self.proof_admission_source_digest)
        pointer = self.expected_prior_latest_pointer
        if pointer is None:
            if self.expected_prior_latest_pointer_digest is not None:
                raise ValueError("absent prior pointer requires null digest")
        elif (
            type(pointer) is not LatestPointer
            or (pointer.workspace_id, pointer.gate_id) != (self.workspace_id, self.gate_id)
            or pointer.digest() != self.expected_prior_latest_pointer_digest
        ):
            raise ValueError("prior pointer scope/digest mismatch")
        activation_digests = (
            self.requirement_digest, self.config_digest, self.source_digest,
            self.protected_baseline_digest, self.expected_interlock_digest,
        )
        if self.action is FinalizerAuthorityAction.INSTALL_INTERLOCK:
            if (
                self.target_generation is not None
                or self.expected_current_generation is not None
                or any(value is not None for value in activation_digests)
            ):
                raise ValueError("interlock installation forbids generation/activation fields")
            quiescence = self.proof_admission_quiescence
            if type(quiescence) is not ProofAdmissionQuiescence:
                raise ValueError("interlock installation requires concrete quiescence")
            if (
                quiescence.workspace_id, quiescence.gate_id, quiescence.source_commit,
                quiescence.proof_admission_source_digest,
            ) != (
                self.workspace_id, self.gate_id, self.authority_source_commit,
                self.proof_admission_source_digest,
            ):
                raise ValueError("quiescence scope/source mismatch")
            if quiescence.captured_at > self.authorized_at:
                raise ValueError("quiescence cannot follow authorization")
        else:
            if type(self.target_generation) is not int or self.target_generation < 1:
                raise ValueError("targetGeneration must be a positive integer")
            if self.target_generation == 1:
                if self.expected_current_generation is not None:
                    raise ValueError("first activation requires null current generation")
            elif (
                type(self.expected_current_generation) is not int
                or self.expected_current_generation != self.target_generation - 1
            ):
                raise ValueError("activation must advance exactly one generation")
            if self.proof_admission_quiescence is not None:
                raise ValueError("activation requires null quiescence")
            for value in activation_digests:
                validate_sha256(value)
        if type(self.maintenance_runtime) is not FinalizerMaintenanceRuntimeIdentity:
            raise ValueError("maintenanceRuntime must be concrete")
        if type(self.durability_profile) not in (
            LinuxProofAuthorityDurabilityProfile, DarwinProofAuthorityDurabilityProfile,
        ):
            raise ValueError("durabilityProfile must be a concrete closed branch")
        if any(
            (ref.workspace_id, ref.gate_id, ref.authorization_id)
            != (self.workspace_id, self.gate_id, self.authorization_id)
            for ref in self.maintenance_runtime.runtime_artifacts
        ):
            raise ValueError("authority runtime refs must belong to enclosing authorization")
        capability = self.durability_profile.capability_evidence
        if (
            capability.crash_fixture_manifest_ref.workspace_id,
            capability.crash_fixture_manifest_ref.gate_id,
        ) != (self.workspace_id, self.gate_id):
            raise ValueError("durability capability must belong to enclosing authority")
        capability.validate_maintenance_source(self.maintenance_runtime)
        validate_sha256(self.confirmation_challenge_digest)
        validate_sha256(self.authorization_digest)
        if self.confirmation_challenge_digest != domain_separated_sha256(
            self._CONFIRMATION_DOMAIN, self._payload()
        ):
            raise ValueError("confirmationChallengeDigest mismatch")
        if self.authorization_digest != domain_separated_sha256(
            self._AUTHORIZATION_DOMAIN,
            {**self._payload(), "confirmationChallengeDigest": self.confirmation_challenge_digest},
        ):
            raise ValueError("authorizationDigest mismatch")

    def _payload(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind, "schemaVersion": self.schema_version,
            "action": self.action.value, "authorizationId": self.authorization_id,
            "operatorIdentity": self.operator_identity.to_dict(),
            "workspaceId": self.workspace_id, "gateId": self.gate_id,
            "requiredFinalizerId": self.required_finalizer_id,
            "targetGeneration": self.target_generation,
            "expectedCurrentGeneration": self.expected_current_generation,
            "expectedPriorLatestPointer": None if self.expected_prior_latest_pointer is None
            else self.expected_prior_latest_pointer.to_dict(),
            "expectedPriorLatestPointerDigest": self.expected_prior_latest_pointer_digest,
            "requirementDigest": self.requirement_digest, "configDigest": self.config_digest,
            "sourceDigest": self.source_digest, "protectedBaselineDigest": self.protected_baseline_digest,
            "expectedInterlockDigest": self.expected_interlock_digest,
            "proofAdmissionInventoryRule": self.proof_admission_inventory_rule,
            "proofAdmissionSourceDigest": self.proof_admission_source_digest,
            "proofAdmissionQuiescence": None if self.proof_admission_quiescence is None
            else self.proof_admission_quiescence.to_dict(),
            "maintenanceRuntime": self.maintenance_runtime.to_dict(),
            "durabilityProfile": self.durability_profile.to_dict(),
            "authoritySourceCommit": self.authority_source_commit,
            "approvalDocumentPath": self.approval_document_path,
            "approvalDocumentSha256": self.approval_document_sha256,
            "decisionId": self.decision_id, "decisionStatus": self.decision_status,
            "authorizedAt": self.authorized_at,
        }

    def to_dict(self) -> dict[str, object]:
        return {
            **self._payload(), "confirmationChallengeDigest": self.confirmation_challenge_digest,
            "authorizationDigest": self.authorization_digest,
        }

    @classmethod
    def from_dict(
        cls, value: object, *,
        epoch: ProofAdmissionEpochRecord | None = None,
        current_epoch: ProofAdmissionCurrentEpoch | None = None,
        pause: ProofAdmissionPauseRecord | None = None,
        jobs: tuple[ProofAdmissionJobRecord, ...] | None = None,
        completions: tuple[ProofAdmissionJobCompletion, ...] | None = None,
        intents: tuple[ProofAdmissionEmissionIntent, ...] | None = None,
        acknowledgements: tuple[ProofAdmissionEmissionAcknowledgement, ...] | None = None,
        validate_proof_references: bool = True,
    ) -> "FinalizerAuthorityAuthorization":
        fields = frozenset({
            "artifactKind", "schemaVersion", "action", "authorizationId", "operatorIdentity",
            "workspaceId", "gateId", "requiredFinalizerId", "targetGeneration",
            "expectedCurrentGeneration", "expectedPriorLatestPointer",
            "expectedPriorLatestPointerDigest", "requirementDigest", "configDigest",
            "sourceDigest", "protectedBaselineDigest", "expectedInterlockDigest",
            "proofAdmissionInventoryRule", "proofAdmissionSourceDigest", "proofAdmissionQuiescence",
            "maintenanceRuntime", "durabilityProfile", "authoritySourceCommit",
            "approvalDocumentPath", "approvalDocumentSha256", "decisionId", "decisionStatus",
            "authorizedAt", "confirmationChallengeDigest", "authorizationDigest",
        })
        data = _closed_mapping(value, schema=cls.__name__, keys=fields)
        for field, expected in (
            ("artifactKind", cls.artifact_kind), ("schemaVersion", cls.schema_version),
            ("proofAdmissionInventoryRule", cls.proof_admission_inventory_rule),
            ("approvalDocumentPath", cls.approval_document_path),
            ("decisionId", cls.decision_id), ("decisionStatus", cls.decision_status),
        ):
            if type(data[field]) is not type(expected) or data[field] != expected:
                raise ValueError(f"invalid authority {field}")
        return cls(
            _enum_from_wire(FinalizerAuthorityAction, data["action"], field="action"),
            data["authorizationId"], AbortOperatorIdentity.from_dict(data["operatorIdentity"]),
            data["workspaceId"], data["gateId"], data["requiredFinalizerId"],
            data["targetGeneration"], data["expectedCurrentGeneration"],
            None if data["expectedPriorLatestPointer"] is None
            else LatestPointer.from_dict(data["expectedPriorLatestPointer"]),
            data["expectedPriorLatestPointerDigest"], data["requirementDigest"],
            data["configDigest"], data["sourceDigest"], data["protectedBaselineDigest"],
            data["expectedInterlockDigest"], data["proofAdmissionSourceDigest"],
            None if data["proofAdmissionQuiescence"] is None
            else (
                ProofAdmissionQuiescence.from_dict(
                    data["proofAdmissionQuiescence"],
                    epoch=epoch,
                    current_epoch=current_epoch,
                    pause=pause,
                    jobs=jobs,
                    completions=completions,
                    intents=intents,
                    acknowledgements=acknowledgements,
                )
                if validate_proof_references
                else ProofAdmissionQuiescence.from_dict_unresolved(
                    data["proofAdmissionQuiescence"]
                )
            ),
            FinalizerMaintenanceRuntimeIdentity.from_dict(data["maintenanceRuntime"]),
            proof_authority_durability_profile_from_dict(data["durabilityProfile"]),
            data["authoritySourceCommit"], data["approvalDocumentSha256"], data["authorizedAt"],
            data["confirmationChallengeDigest"], data["authorizationDigest"],
        )


@dataclass(frozen=True)
class FinalizerPublicationInterlock:
    workspace_id: str
    gate_id: str
    required_finalizer_id: str
    installed_at: str
    installation_source_commit: str
    proof_admission_source_digest: str
    authorization: FinalizerAuthorityAuthorization
    interlock_digest: str
    artifact_kind: ClassVar[str] = "acceptance-finalizer-publication-interlock"
    schema_version: ClassVar[int] = 1

    def __post_init__(self) -> None:
        if type(self.authorization) is not FinalizerAuthorityAuthorization:
            raise ValueError("interlock authorization must be concrete")
        authority = self.authorization
        if authority.action is not FinalizerAuthorityAction.INSTALL_INTERLOCK:
            raise ValueError("interlock requires INSTALL_INTERLOCK authorization")
        if (
            self.workspace_id, self.gate_id, self.required_finalizer_id,
            self.installation_source_commit, self.proof_admission_source_digest,
        ) != (
            authority.workspace_id, authority.gate_id, authority.required_finalizer_id,
            authority.authority_source_commit, authority.proof_admission_source_digest,
        ):
            raise ValueError("interlock identity/source must match authorization")
        _canonical_utc_instant(self.installed_at, field="installedAt")
        if self.installed_at < authority.authorized_at:
            raise ValueError("installation cannot precede authorization")
        validate_sha256(self.interlock_digest)
        if self.interlock_digest != domain_separated_sha256(
            "pt.acceptance.finalization.publication-interlock.v1", self._payload()
        ):
            raise ValueError("interlockDigest mismatch")

    def _payload(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind, "schemaVersion": self.schema_version,
            "workspaceId": self.workspace_id, "gateId": self.gate_id,
            "requiredFinalizerId": self.required_finalizer_id, "installedAt": self.installed_at,
            "installationSourceCommit": self.installation_source_commit,
            "proofAdmissionSourceDigest": self.proof_admission_source_digest,
            "authorization": self.authorization.to_dict(),
        }

    def to_dict(self) -> dict[str, object]:
        return {**self._payload(), "interlockDigest": self.interlock_digest}

    @classmethod
    def from_dict(
        cls, value: object, *,
        epoch: ProofAdmissionEpochRecord | None = None,
        current_epoch: ProofAdmissionCurrentEpoch | None = None,
        pause: ProofAdmissionPauseRecord | None = None,
        jobs: tuple[ProofAdmissionJobRecord, ...] | None = None,
        completions: tuple[ProofAdmissionJobCompletion, ...] | None = None,
        intents: tuple[ProofAdmissionEmissionIntent, ...] | None = None,
        acknowledgements: tuple[ProofAdmissionEmissionAcknowledgement, ...] | None = None,
        validate_proof_references: bool = True,
    ) -> "FinalizerPublicationInterlock":
        data = _closed_mapping(value, schema=cls.__name__, keys=frozenset({
            "artifactKind", "schemaVersion", "workspaceId", "gateId", "requiredFinalizerId",
            "installedAt", "installationSourceCommit", "proofAdmissionSourceDigest",
            "authorization", "interlockDigest",
        }))
        if (
            data["artifactKind"] != cls.artifact_kind
            or type(data["schemaVersion"]) is not int or data["schemaVersion"] != 1
        ):
            raise ValueError("invalid interlock kind/version")
        return cls(
            data["workspaceId"], data["gateId"], data["requiredFinalizerId"],
            data["installedAt"], data["installationSourceCommit"], data["proofAdmissionSourceDigest"],
            FinalizerAuthorityAuthorization.from_dict(
                data["authorization"], epoch=epoch, current_epoch=current_epoch,
                pause=pause, jobs=jobs, completions=completions, intents=intents,
                acknowledgements=acknowledgements,
                validate_proof_references=validate_proof_references,
            ), data["interlockDigest"],
        )


@dataclass(frozen=True)
class FinalizerActivationIntent:
    workspace_id: str
    gate_id: str
    required_finalizer_id: str
    target_generation: int
    expected_current_generation: int | None
    activated_at: str
    activation_source_commit: str
    expected_prior_latest_pointer: LatestPointer | None
    expected_prior_latest_pointer_digest: str | None
    requirement_digest: str
    config_digest: str
    source_digest: str
    protected_baseline_digest: str
    authorization: FinalizerAuthorityAuthorization
    intent_digest: str
    artifact_kind: ClassVar[str] = "acceptance-finalizer-activation-intent"
    schema_version: ClassVar[int] = 1

    def __post_init__(self) -> None:
        authority = self.authorization
        if (
            type(authority) is not FinalizerAuthorityAuthorization
            or authority.action is not FinalizerAuthorityAction.ACTIVATE_GENERATION
        ):
            raise ValueError("intent requires concrete ACTIVATE_GENERATION authorization")
        for field in (
            "workspace_id", "gate_id", "required_finalizer_id", "target_generation",
            "expected_current_generation", "expected_prior_latest_pointer",
            "expected_prior_latest_pointer_digest", "requirement_digest", "config_digest",
            "source_digest", "protected_baseline_digest",
        ):
            value = getattr(self, field)
            if type(value) is not type(getattr(authority, field)) or value != getattr(authority, field):
                raise ValueError(f"intent {field} must match authorization")
        if self.activation_source_commit != authority.authority_source_commit:
            raise ValueError("intent source must match authorization")
        _canonical_utc_instant(self.activated_at, field="activatedAt")
        if self.activated_at < authority.authorized_at:
            raise ValueError("activation cannot precede authorization")
        validate_sha256(self.intent_digest)
        if self.intent_digest != domain_separated_sha256(
            "pt.acceptance.finalization.activation-intent.v1", self._payload()
        ):
            raise ValueError("intentDigest mismatch")

    def _payload(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind, "schemaVersion": self.schema_version,
            "workspaceId": self.workspace_id, "gateId": self.gate_id,
            "requiredFinalizerId": self.required_finalizer_id, "targetGeneration": self.target_generation,
            "expectedCurrentGeneration": self.expected_current_generation,
            "activatedAt": self.activated_at, "activationSourceCommit": self.activation_source_commit,
            "expectedPriorLatestPointer": None if self.expected_prior_latest_pointer is None
            else self.expected_prior_latest_pointer.to_dict(),
            "expectedPriorLatestPointerDigest": self.expected_prior_latest_pointer_digest,
            "requirementDigest": self.requirement_digest, "configDigest": self.config_digest,
            "sourceDigest": self.source_digest, "protectedBaselineDigest": self.protected_baseline_digest,
            "authorization": self.authorization.to_dict(),
        }

    def to_dict(self) -> dict[str, object]:
        return {**self._payload(), "intentDigest": self.intent_digest}

    @classmethod
    def from_dict(cls, value: object) -> "FinalizerActivationIntent":
        data = _closed_mapping(value, schema=cls.__name__, keys=frozenset({
            "artifactKind", "schemaVersion", "workspaceId", "gateId", "requiredFinalizerId",
            "targetGeneration", "expectedCurrentGeneration", "activatedAt", "activationSourceCommit",
            "expectedPriorLatestPointer", "expectedPriorLatestPointerDigest", "requirementDigest",
            "configDigest", "sourceDigest", "protectedBaselineDigest", "authorization", "intentDigest",
        }))
        if (
            data["artifactKind"] != cls.artifact_kind
            or type(data["schemaVersion"]) is not int or data["schemaVersion"] != 1
        ):
            raise ValueError("invalid activation intent kind/version")
        return cls(
            data["workspaceId"], data["gateId"], data["requiredFinalizerId"],
            data["targetGeneration"], data["expectedCurrentGeneration"], data["activatedAt"],
            data["activationSourceCommit"],
            None if data["expectedPriorLatestPointer"] is None
            else LatestPointer.from_dict(data["expectedPriorLatestPointer"]),
            data["expectedPriorLatestPointerDigest"], data["requirementDigest"], data["configDigest"],
            data["sourceDigest"], data["protectedBaselineDigest"],
            FinalizerAuthorityAuthorization.from_dict(data["authorization"]), data["intentDigest"],
        )


@dataclass(frozen=True)
class FinalizerEnforcementRecord:
    generation: int
    workspace_id: str
    gate_id: str
    required_finalizer_id: str
    activation_intent: FinalizerActivationIntent
    activated_at: str
    activation_source_commit: str
    prior_latest_pointer: LatestPointer | None
    prior_latest_pointer_digest: str | None
    requirement_digest: str
    config_digest: str
    source_digest: str
    protected_baseline_digest: str
    enforcement_digest: str
    artifact_kind: ClassVar[str] = "acceptance-finalizer-enforcement-generation"
    schema_version: ClassVar[int] = 1

    def __post_init__(self) -> None:
        intent = self.activation_intent
        if type(intent) is not FinalizerActivationIntent:
            raise ValueError("activationIntent must be concrete")
        for own, target in (
            ("generation", "target_generation"), ("workspace_id", "workspace_id"),
            ("gate_id", "gate_id"), ("required_finalizer_id", "required_finalizer_id"),
            ("activated_at", "activated_at"), ("activation_source_commit", "activation_source_commit"),
            ("prior_latest_pointer", "expected_prior_latest_pointer"),
            ("prior_latest_pointer_digest", "expected_prior_latest_pointer_digest"),
            ("requirement_digest", "requirement_digest"), ("config_digest", "config_digest"),
            ("source_digest", "source_digest"), ("protected_baseline_digest", "protected_baseline_digest"),
        ):
            value, expected = getattr(self, own), getattr(intent, target)
            if type(value) is not type(expected) or value != expected:
                raise ValueError(f"enforcement {own} must match intent")
        validate_sha256(self.enforcement_digest)
        if self.enforcement_digest != domain_separated_sha256(
            "pt.acceptance.finalization.enforcement.v1", self._payload()
        ):
            raise ValueError("enforcementDigest mismatch")

    def _payload(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind, "schemaVersion": self.schema_version,
            "generation": self.generation, "workspaceId": self.workspace_id, "gateId": self.gate_id,
            "requiredFinalizerId": self.required_finalizer_id, "activationIntent": self.activation_intent.to_dict(),
            "activatedAt": self.activated_at, "activationSourceCommit": self.activation_source_commit,
            "priorLatestPointer": None if self.prior_latest_pointer is None else self.prior_latest_pointer.to_dict(),
            "priorLatestPointerDigest": self.prior_latest_pointer_digest, "requirementDigest": self.requirement_digest,
            "configDigest": self.config_digest, "sourceDigest": self.source_digest,
            "protectedBaselineDigest": self.protected_baseline_digest,
        }

    def to_dict(self) -> dict[str, object]:
        return {**self._payload(), "enforcementDigest": self.enforcement_digest}

    @classmethod
    def from_dict(cls, value: object) -> "FinalizerEnforcementRecord":
        data = _closed_mapping(value, schema=cls.__name__, keys=frozenset({
            "artifactKind", "schemaVersion", "generation", "workspaceId", "gateId", "requiredFinalizerId",
            "activationIntent", "activatedAt", "activationSourceCommit", "priorLatestPointer",
            "priorLatestPointerDigest", "requirementDigest", "configDigest", "sourceDigest",
            "protectedBaselineDigest", "enforcementDigest",
        }))
        if (
            data["artifactKind"] != cls.artifact_kind
            or type(data["schemaVersion"]) is not int or data["schemaVersion"] != 1
        ):
            raise ValueError("invalid enforcement kind/version")
        return cls(
            data["generation"], data["workspaceId"], data["gateId"], data["requiredFinalizerId"],
            FinalizerActivationIntent.from_dict(data["activationIntent"]), data["activatedAt"],
            data["activationSourceCommit"], None if data["priorLatestPointer"] is None
            else LatestPointer.from_dict(data["priorLatestPointer"]),
            data["priorLatestPointerDigest"], data["requirementDigest"], data["configDigest"],
            data["sourceDigest"], data["protectedBaselineDigest"], data["enforcementDigest"],
        )


@dataclass(frozen=True)
class FinalizerActivationPending:
    intent: FinalizerActivationIntent
    candidate_enforcement_record: FinalizerEnforcementRecord
    candidate_activated: FinalizerEnforcementActivated | None
    candidate_current: FinalizerEnforcementCurrent
    pending_digest: str
    artifact_kind: ClassVar[str] = "acceptance-finalizer-activation-pending"
    schema_version: ClassVar[int] = 1

    def __post_init__(self) -> None:
        if (
            type(self.intent) is not FinalizerActivationIntent
            or type(self.candidate_enforcement_record) is not FinalizerEnforcementRecord
            or type(self.candidate_current) is not FinalizerEnforcementCurrent
        ):
            raise ValueError("pending activation requires concrete intent/record/current")
        intent, record, current = self.intent, self.candidate_enforcement_record, self.candidate_current
        if record.activation_intent != intent:
            raise ValueError("pending record must contain the exact intent")
        if (
            current.workspace_id, current.gate_id, current.required_finalizer_id,
            current.generation, current.enforcement_digest,
        ) != (
            intent.workspace_id, intent.gate_id, intent.required_finalizer_id,
            intent.target_generation, record.enforcement_digest,
        ):
            raise ValueError("pending current must match candidate enforcement")
        activated = self.candidate_activated
        if intent.target_generation == 1:
            if type(activated) is not FinalizerEnforcementActivated:
                raise ValueError("first generation requires candidateActivated")
            if (
                activated.workspace_id, activated.gate_id, activated.required_finalizer_id,
                activated.first_generation, activated.first_enforcement_digest, activated.activated_at,
                activated.activation_source_commit, activated.activation_intent_digest,
            ) != (
                intent.workspace_id, intent.gate_id, intent.required_finalizer_id, 1,
                record.enforcement_digest, intent.activated_at, intent.activation_source_commit, intent.intent_digest,
            ):
                raise ValueError("candidateActivated must match first intent/record")
        elif activated is not None:
            raise ValueError("later generations forbid candidateActivated")
        validate_sha256(self.pending_digest)
        if self.pending_digest != domain_separated_sha256(
            "pt.acceptance.finalization.activation-pending.v1", self._payload()
        ):
            raise ValueError("pendingDigest mismatch")

    def _payload(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind, "schemaVersion": self.schema_version,
            "intent": self.intent.to_dict(), "candidateEnforcementRecord": self.candidate_enforcement_record.to_dict(),
            "candidateActivated": None if self.candidate_activated is None else self.candidate_activated.to_dict(),
            "candidateCurrent": self.candidate_current.to_dict(),
        }

    def to_dict(self) -> dict[str, object]:
        return {**self._payload(), "pendingDigest": self.pending_digest}

    @classmethod
    def from_dict(cls, value: object) -> "FinalizerActivationPending":
        data = _closed_mapping(value, schema=cls.__name__, keys=frozenset({
            "artifactKind", "schemaVersion", "intent", "candidateEnforcementRecord",
            "candidateActivated", "candidateCurrent", "pendingDigest",
        }))
        if (
            data["artifactKind"] != cls.artifact_kind
            or type(data["schemaVersion"]) is not int or data["schemaVersion"] != 1
        ):
            raise ValueError("invalid pending activation kind/version")
        return cls(
            FinalizerActivationIntent.from_dict(data["intent"]),
            FinalizerEnforcementRecord.from_dict(data["candidateEnforcementRecord"]),
            None if data["candidateActivated"] is None else FinalizerEnforcementActivated.from_dict(data["candidateActivated"]),
            FinalizerEnforcementCurrent.from_dict(data["candidateCurrent"]), data["pendingDigest"],
        )


class AbortReasonCode(str, Enum):
    OPERATOR_REQUESTED_DISCARD = "OPERATOR_REQUESTED_DISCARD"
    STORAGE_RECLAMATION = "STORAGE_RECLAMATION"
    SUPERSEDED_UNPUBLISHED_RUN = "SUPERSEDED_UNPUBLISHED_RUN"


@dataclass(frozen=True)
class AbortAuthorization:
    authorization_id: str
    attempt_id: str
    authorized_at: str
    operator_identity: AbortOperatorIdentity
    reason_code: AbortReasonCode
    workspace_id: str
    gate_id: str
    evidence_run_id: str
    run_directory_claim: DescriptorClaim
    snapshot_digest: str
    requirement_digest: str
    authority_source_commit: str
    proof_admission_source_digest: str
    maintenance_runtime: FinalizerMaintenanceRuntimeIdentity
    durability_profile: ProofAuthorityDurabilityProfile
    confirmation_challenge_digest: str
    proof_admission_inventory_rule: ClassVar[str] = "ALL_TRACKED_ACCEPTANCE_CLAIM_SOURCES"

    def __post_init__(self) -> None:
        _validate_slug(self.authorization_id, field="authorizationId")
        _validate_slug(self.attempt_id, field="attemptId")
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gateId")
        _validate_run_id(self.evidence_run_id, field="evidenceRunId")
        _canonical_utc_instant(self.authorized_at, field="authorizedAt")
        _validate_non_empty_utf8(self.authority_source_commit, field="authoritySourceCommit")
        if type(self.operator_identity) is not AbortOperatorIdentity or type(self.reason_code) is not AbortReasonCode:
            raise ValueError("abort operator/reason must be concrete closed contracts")
        claim = self.run_directory_claim
        if (
            type(claim) is not DescriptorClaim
            or claim.role is not DescriptorRole.RUN_DIRECTORY
            or type(claim.owner_binding) is not RunDirectoryOwnerBinding
            or (claim.owner_binding.workspace_id, claim.owner_binding.gate_id,
                claim.owner_binding.evidence_run_id)
            != (self.workspace_id, self.gate_id, self.evidence_run_id)
        ):
            raise ValueError("abort run directory must bind exact run identity")
        for digest in (
            self.snapshot_digest, self.requirement_digest,
            self.proof_admission_source_digest, self.confirmation_challenge_digest,
        ):
            validate_sha256(digest)
        if type(self.maintenance_runtime) is not FinalizerMaintenanceRuntimeIdentity:
            raise ValueError("abort maintenance runtime must be concrete")
        if type(self.durability_profile) not in (
            LinuxProofAuthorityDurabilityProfile, DarwinProofAuthorityDurabilityProfile,
        ):
            raise ValueError("abort durability profile must be a concrete branch")
        if any(
            (ref.workspace_id, ref.gate_id, ref.authorization_id)
            != (self.workspace_id, self.gate_id, self.authorization_id)
            for ref in self.maintenance_runtime.runtime_artifacts
        ):
            raise ValueError("abort runtime refs must bind enclosing authorization")
        capability = self.durability_profile.capability_evidence
        if (
            capability.crash_fixture_manifest_ref.workspace_id,
            capability.crash_fixture_manifest_ref.gate_id,
        ) != (self.workspace_id, self.gate_id):
            raise ValueError("abort durability capability must bind authority scope")
        capability.validate_maintenance_source(self.maintenance_runtime)
        if self.confirmation_challenge_digest != domain_separated_sha256(
            _ABORT_CONFIRMATION_DOMAIN, self._payload()
        ):
            raise ValueError("abort confirmationChallengeDigest mismatch")

    def _payload(self) -> dict[str, object]:
        return {
            "authorizationId": self.authorization_id, "attemptId": self.attempt_id,
            "authorizedAt": self.authorized_at, "operatorIdentity": self.operator_identity.to_dict(),
            "reasonCode": self.reason_code.value, "workspaceId": self.workspace_id,
            "gateId": self.gate_id, "evidenceRunId": self.evidence_run_id,
            "runDirectoryClaim": self.run_directory_claim.to_dict(),
            "snapshotDigest": self.snapshot_digest, "requirementDigest": self.requirement_digest,
            "authoritySourceCommit": self.authority_source_commit,
            "proofAdmissionInventoryRule": self.proof_admission_inventory_rule,
            "proofAdmissionSourceDigest": self.proof_admission_source_digest,
            "maintenanceRuntime": self.maintenance_runtime.to_dict(),
            "durabilityProfile": self.durability_profile.to_dict(),
        }

    def to_dict(self) -> dict[str, object]:
        return {**self._payload(), "confirmationChallengeDigest": self.confirmation_challenge_digest}

    @classmethod
    def from_dict(cls, value: object) -> "AbortAuthorization":
        data = _closed_mapping(value, schema=cls.__name__, keys=frozenset({
            "authorizationId", "attemptId", "authorizedAt", "operatorIdentity", "reasonCode",
            "workspaceId", "gateId", "evidenceRunId", "runDirectoryClaim", "snapshotDigest",
            "requirementDigest", "authoritySourceCommit", "proofAdmissionInventoryRule",
            "proofAdmissionSourceDigest", "maintenanceRuntime", "durabilityProfile", "confirmationChallengeDigest",
        }))
        if data["proofAdmissionInventoryRule"] != cls.proof_admission_inventory_rule:
            raise ValueError("abort requires full proof-admission inventory")
        return cls(
            data["authorizationId"], data["attemptId"], data["authorizedAt"],
            AbortOperatorIdentity.from_dict(data["operatorIdentity"]),
            _enum_from_wire(AbortReasonCode, data["reasonCode"], field="reasonCode"),
            data["workspaceId"], data["gateId"], data["evidenceRunId"],
            DescriptorClaim.from_dict(data["runDirectoryClaim"]), data["snapshotDigest"],
            data["requirementDigest"], data["authoritySourceCommit"], data["proofAdmissionSourceDigest"],
            FinalizerMaintenanceRuntimeIdentity.from_dict(data["maintenanceRuntime"]),
            proof_authority_durability_profile_from_dict(data["durabilityProfile"]),
            data["confirmationChallengeDigest"],
        )


class AbortEventType(str, Enum):
    AUTHORIZED = "AUTHORIZED"
    TOMBSTONED = "TOMBSTONED"
    DELETE_BATCH_STARTED = "DELETE_BATCH_STARTED"
    DELETED = "DELETED"
    FAILED = "FAILED"


class AbortCompletionSource(str, Enum):
    DELETE_BATCH_STARTED = "DELETE_BATCH_STARTED"
    TERMINAL_FAILED = "TERMINAL_FAILED"


@dataclass(frozen=True)
class AbortEventAuthorizationProjection:
    authorization_id: str
    authorized_at: str
    workspace_id: str
    gate_id: str
    evidence_run_id: str
    run_directory_claim: DescriptorClaim
    snapshot_digest: str
    requirement_digest: str
    reason_code: AbortReasonCode
    operator_identity: AbortOperatorIdentity
    authority_source_commit: str
    proof_admission_source_digest: str
    maintenance_runtime: FinalizerMaintenanceRuntimeIdentity
    durability_profile: ProofAuthorityDurabilityProfile
    confirmation_challenge_digest: str
    proof_admission_inventory_rule: ClassVar[str] = (
        "ALL_TRACKED_ACCEPTANCE_CLAIM_SOURCES"
    )

    def __post_init__(self) -> None:
        authorization = AbortAuthorization(
            authorization_id=self.authorization_id,
            attempt_id="projection-validation",
            authorized_at=self.authorized_at,
            operator_identity=self.operator_identity,
            reason_code=self.reason_code,
            workspace_id=self.workspace_id,
            gate_id=self.gate_id,
            evidence_run_id=self.evidence_run_id,
            run_directory_claim=self.run_directory_claim,
            snapshot_digest=self.snapshot_digest,
            requirement_digest=self.requirement_digest,
            authority_source_commit=self.authority_source_commit,
            proof_admission_source_digest=self.proof_admission_source_digest,
            maintenance_runtime=self.maintenance_runtime,
            durability_profile=self.durability_profile,
            confirmation_challenge_digest=domain_separated_sha256(
                _ABORT_CONFIRMATION_DOMAIN,
                {
                    "authorizationId": self.authorization_id,
                    "attemptId": "projection-validation",
                    "authorizedAt": self.authorized_at,
                    "operatorIdentity": self.operator_identity.to_dict(),
                    "reasonCode": self.reason_code.value,
                    "workspaceId": self.workspace_id,
                    "gateId": self.gate_id,
                    "evidenceRunId": self.evidence_run_id,
                    "runDirectoryClaim": self.run_directory_claim.to_dict(),
                    "snapshotDigest": self.snapshot_digest,
                    "requirementDigest": self.requirement_digest,
                    "authoritySourceCommit": self.authority_source_commit,
                    "proofAdmissionInventoryRule": self.proof_admission_inventory_rule,
                    "proofAdmissionSourceDigest": self.proof_admission_source_digest,
                    "maintenanceRuntime": self.maintenance_runtime.to_dict(),
                    "durabilityProfile": self.durability_profile.to_dict(),
                },
            ),
        )
        if authorization.confirmation_challenge_digest is None:
            raise ValueError("abort authorization projection is invalid")
        validate_sha256(self.confirmation_challenge_digest)

    def to_dict(self) -> dict[str, object]:
        return {
            "authorizationId": self.authorization_id,
            "authorizedAt": self.authorized_at,
            "workspaceId": self.workspace_id,
            "gateId": self.gate_id,
            "evidenceRunId": self.evidence_run_id,
            "runDirectoryClaim": self.run_directory_claim.to_dict(),
            "snapshotDigest": self.snapshot_digest,
            "requirementDigest": self.requirement_digest,
            "reasonCode": self.reason_code.value,
            "operatorIdentity": self.operator_identity.to_dict(),
            "authoritySourceCommit": self.authority_source_commit,
            "proofAdmissionInventoryRule": self.proof_admission_inventory_rule,
            "proofAdmissionSourceDigest": self.proof_admission_source_digest,
            "maintenanceRuntime": self.maintenance_runtime.to_dict(),
            "durabilityProfile": self.durability_profile.to_dict(),
            "confirmationChallengeDigest": self.confirmation_challenge_digest,
        }

    @classmethod
    def from_authorization(
        cls,
        authorization: AbortAuthorization,
    ) -> "AbortEventAuthorizationProjection":
        if type(authorization) is not AbortAuthorization:
            raise ValueError("authorization must be AbortAuthorization")
        return cls(
            authorization.authorization_id,
            authorization.authorized_at,
            authorization.workspace_id,
            authorization.gate_id,
            authorization.evidence_run_id,
            authorization.run_directory_claim,
            authorization.snapshot_digest,
            authorization.requirement_digest,
            authorization.reason_code,
            authorization.operator_identity,
            authorization.authority_source_commit,
            authorization.proof_admission_source_digest,
            authorization.maintenance_runtime,
            authorization.durability_profile,
            authorization.confirmation_challenge_digest,
        )

    @classmethod
    def from_dict(cls, value: object) -> "AbortEventAuthorizationProjection":
        keys = frozenset(
            {
                "authorizationId",
                "authorizedAt",
                "workspaceId",
                "gateId",
                "evidenceRunId",
                "runDirectoryClaim",
                "snapshotDigest",
                "requirementDigest",
                "reasonCode",
                "operatorIdentity",
                "authoritySourceCommit",
                "proofAdmissionInventoryRule",
                "proofAdmissionSourceDigest",
                "maintenanceRuntime",
                "durabilityProfile",
                "confirmationChallengeDigest",
            }
        )
        data = _closed_mapping(value, schema=cls.__name__, keys=keys)
        if data["proofAdmissionInventoryRule"] != cls.proof_admission_inventory_rule:
            raise ValueError("abort event projection requires full inventory")
        return cls(
            data["authorizationId"],
            data["authorizedAt"],
            data["workspaceId"],
            data["gateId"],
            data["evidenceRunId"],
            DescriptorClaim.from_dict(data["runDirectoryClaim"]),
            data["snapshotDigest"],
            data["requirementDigest"],
            _enum_from_wire(AbortReasonCode, data["reasonCode"], field="reasonCode"),
            AbortOperatorIdentity.from_dict(data["operatorIdentity"]),
            data["authoritySourceCommit"],
            data["proofAdmissionSourceDigest"],
            FinalizerMaintenanceRuntimeIdentity.from_dict(data["maintenanceRuntime"]),
            proof_authority_durability_profile_from_dict(data["durabilityProfile"]),
            data["confirmationChallengeDigest"],
        )


def abort_tombstone_identity_digest(
    authorization: AbortAuthorization | AbortEventAuthorizationProjection,
) -> str:
    if type(authorization) not in (
        AbortAuthorization,
        AbortEventAuthorizationProjection,
    ):
        raise ValueError("abort tombstone identity requires authorization")
    return domain_separated_sha256(
        _ABORT_TOMBSTONE_IDENTITY_DOMAIN,
        {
            "workspaceId": authorization.workspace_id,
            "gateId": authorization.gate_id,
            "evidenceRunId": authorization.evidence_run_id,
            "authorizationId": authorization.authorization_id,
            "runDirectoryClaimDigest": (
                authorization.run_directory_claim.descriptor_claim_digest
            ),
            "snapshotDigest": authorization.snapshot_digest,
            "requirementDigest": authorization.requirement_digest,
        },
    )


def abort_continuation_token(
    *,
    authorization_id: str,
    event_sequence: int,
    next_deletion_plan_index: int,
    deletion_plan_digest: str,
    tombstone_identity_digest: str,
) -> str:
    _validate_slug(authorization_id, field="authorizationId")
    _validate_positive_integer(event_sequence, field="eventSequence")
    _validate_non_negative_integer(
        next_deletion_plan_index,
        field="nextDeletionPlanIndex",
    )
    validate_sha256(deletion_plan_digest)
    validate_sha256(tombstone_identity_digest)
    return domain_separated_sha256(
        _ABORT_CONTINUATION_DOMAIN,
        {
            "authorizationId": authorization_id,
            "eventSequence": event_sequence,
            "nextDeletionPlanIndex": next_deletion_plan_index,
            "deletionPlanDigest": deletion_plan_digest,
            "tombstoneIdentityDigest": tombstone_identity_digest,
        },
    )


@dataclass(frozen=True)
class AbortSealedAuditEvent:
    event_type: AbortEventType
    event_sequence: int
    previous_event_digest: str | None
    authorization: AbortEventAuthorizationProjection
    attempt_id: str
    tombstone_identity_digest: str
    deletion_plan_ref: AbortControlArtifactRef | None
    deletion_plan_digest: str | None
    completion_source: AbortCompletionSource | None
    batch_end_index_exclusive: int | None
    next_traversal_index: int | None
    continuation_token: str | None
    recorded_at: str
    diagnostic: str | None
    event_digest: str

    def __post_init__(self) -> None:
        if type(self.event_type) is not AbortEventType:
            raise ValueError("eventType must be closed")
        _validate_positive_integer(self.event_sequence, field="eventSequence")
        if self.previous_event_digest is not None:
            validate_sha256(self.previous_event_digest)
        if type(self.authorization) is not AbortEventAuthorizationProjection:
            raise ValueError("authorization projection must be concrete")
        _validate_slug(self.attempt_id, field="attemptId")
        validate_sha256(self.tombstone_identity_digest)
        if self.tombstone_identity_digest != abort_tombstone_identity_digest(
            self.authorization
        ):
            raise ValueError("tombstoneIdentityDigest mismatch")
        pair = (self.deletion_plan_ref, self.deletion_plan_digest)
        if (pair[0] is None) != (pair[1] is None):
            raise ValueError("deletion plan ref/digest must be jointly present")
        if pair[0] is not None:
            if (
                type(pair[0]) is not AbortControlArtifactRef
                or (
                    pair[0].workspace_id,
                    pair[0].gate_id,
                    pair[0].evidence_run_id,
                )
                != (
                    self.authorization.workspace_id,
                    self.authorization.gate_id,
                    self.authorization.evidence_run_id,
                )
            ):
                raise ValueError("deletion plan ref scope mismatch")
            validate_sha256(pair[1])
        _canonical_utc_instant(self.recorded_at, field="recordedAt")
        if self.diagnostic is not None:
            _validate_non_empty_utf8(
                self.diagnostic,
                field="diagnostic",
                maximum_bytes=4096,
            )
        self._validate_branch()
        validate_sha256(self.event_digest)
        if self.event_digest != domain_separated_sha256(
            _ABORT_EVENT_DOMAIN,
            self._payload(),
        ):
            raise ValueError("eventDigest mismatch")

    def _validate_branch(self) -> None:
        if self.event_type is AbortEventType.AUTHORIZED:
            AbortAuthorization(
                authorization_id=self.authorization.authorization_id,
                attempt_id=self.attempt_id,
                authorized_at=self.authorization.authorized_at,
                operator_identity=self.authorization.operator_identity,
                reason_code=self.authorization.reason_code,
                workspace_id=self.authorization.workspace_id,
                gate_id=self.authorization.gate_id,
                evidence_run_id=self.authorization.evidence_run_id,
                run_directory_claim=self.authorization.run_directory_claim,
                snapshot_digest=self.authorization.snapshot_digest,
                requirement_digest=self.authorization.requirement_digest,
                authority_source_commit=(
                    self.authorization.authority_source_commit
                ),
                proof_admission_source_digest=(
                    self.authorization.proof_admission_source_digest
                ),
                maintenance_runtime=self.authorization.maintenance_runtime,
                durability_profile=self.authorization.durability_profile,
                confirmation_challenge_digest=(
                    self.authorization.confirmation_challenge_digest
                ),
            )
            if (
                self.event_sequence != 1
                or self.previous_event_digest is not None
                or self.deletion_plan_ref is not None
                or self.completion_source is not None
                or self.batch_end_index_exclusive is not None
                or self.next_traversal_index is not None
                or self.continuation_token is not None
                or self.diagnostic is not None
            ):
                raise ValueError("AUTHORIZED branch is invalid")
        elif self.event_type is AbortEventType.TOMBSTONED:
            if (
                self.event_sequence != 2
                or self.previous_event_digest is None
                or self.deletion_plan_ref is None
                or self.completion_source is not None
                or self.batch_end_index_exclusive is not None
                or self.next_traversal_index != 0
                or self.continuation_token is None
                or self.diagnostic is not None
            ):
                raise ValueError("TOMBSTONED branch is invalid")
        elif self.event_type is AbortEventType.DELETE_BATCH_STARTED:
            if (
                self.previous_event_digest is None
                or self.deletion_plan_ref is None
                or self.completion_source is not None
                or type(self.batch_end_index_exclusive) is not int
                or self.batch_end_index_exclusive <= 0
                or type(self.next_traversal_index) is not int
                or self.next_traversal_index < 0
                or self.next_traversal_index
                >= self.batch_end_index_exclusive
                or self.continuation_token is None
                or self.diagnostic is not None
            ):
                raise ValueError("DELETE_BATCH_STARTED branch is invalid")
        elif self.event_type is AbortEventType.FAILED:
            if (
                self.previous_event_digest is None
                or self.deletion_plan_ref is None
                or self.completion_source is not None
                or self.batch_end_index_exclusive is not None
                or type(self.next_traversal_index) is not int
                or self.next_traversal_index < 0
                or self.continuation_token is None
                or self.diagnostic is None
            ):
                raise ValueError("FAILED branch is invalid")
        elif (
            self.previous_event_digest is None
            or self.deletion_plan_ref is None
            or type(self.completion_source) is not AbortCompletionSource
            or self.batch_end_index_exclusive is not None
            or self.next_traversal_index is not None
            or self.continuation_token is not None
            or self.diagnostic is not None
        ):
            raise ValueError("DELETED branch is invalid")
        if self.continuation_token is not None:
            validate_sha256(self.continuation_token)

    def _payload(self) -> dict[str, object]:
        return {
            "eventType": self.event_type.value,
            "eventSequence": self.event_sequence,
            "previousEventDigest": self.previous_event_digest,
            "authorization": self.authorization.to_dict(),
            "attemptId": self.attempt_id,
            "tombstoneIdentityDigest": self.tombstone_identity_digest,
            "deletionPlanRef": (
                None
                if self.deletion_plan_ref is None
                else self.deletion_plan_ref.to_dict()
            ),
            "deletionPlanDigest": self.deletion_plan_digest,
            "completionSource": (
                None
                if self.completion_source is None
                else self.completion_source.value
            ),
            "batchEndIndexExclusive": self.batch_end_index_exclusive,
            "nextTraversalIndex": self.next_traversal_index,
            "continuationToken": self.continuation_token,
            "recordedAt": self.recorded_at,
            "diagnostic": self.diagnostic,
        }

    def to_dict(self) -> dict[str, object]:
        return {**self._payload(), "eventDigest": self.event_digest}

    @classmethod
    def create(cls, **values: object) -> "AbortSealedAuditEvent":
        payload = {
            "eventType": values["event_type"].value,
            "eventSequence": values["event_sequence"],
            "previousEventDigest": values["previous_event_digest"],
            "authorization": values["authorization"].to_dict(),
            "attemptId": values["attempt_id"],
            "tombstoneIdentityDigest": values["tombstone_identity_digest"],
            "deletionPlanRef": (
                None
                if values["deletion_plan_ref"] is None
                else values["deletion_plan_ref"].to_dict()
            ),
            "deletionPlanDigest": values["deletion_plan_digest"],
            "completionSource": (
                None
                if values["completion_source"] is None
                else values["completion_source"].value
            ),
            "batchEndIndexExclusive": values["batch_end_index_exclusive"],
            "nextTraversalIndex": values["next_traversal_index"],
            "continuationToken": values["continuation_token"],
            "recordedAt": values["recorded_at"],
            "diagnostic": values["diagnostic"],
        }
        return cls(
            **values,
            event_digest=domain_separated_sha256(
                _ABORT_EVENT_DOMAIN,
                payload,
            ),
        )

    @classmethod
    def from_dict(cls, value: object) -> "AbortSealedAuditEvent":
        keys = frozenset(
            {
                "eventType",
                "eventSequence",
                "previousEventDigest",
                "authorization",
                "attemptId",
                "tombstoneIdentityDigest",
                "deletionPlanRef",
                "deletionPlanDigest",
                "completionSource",
                "batchEndIndexExclusive",
                "nextTraversalIndex",
                "continuationToken",
                "recordedAt",
                "diagnostic",
                "eventDigest",
            }
        )
        data = _closed_mapping(value, schema=cls.__name__, keys=keys)
        return cls(
            event_type=_enum_from_wire(
                AbortEventType,
                data["eventType"],
                field="eventType",
            ),
            event_sequence=data["eventSequence"],
            previous_event_digest=data["previousEventDigest"],
            authorization=AbortEventAuthorizationProjection.from_dict(
                data["authorization"]
            ),
            attempt_id=data["attemptId"],
            tombstone_identity_digest=data["tombstoneIdentityDigest"],
            deletion_plan_ref=(
                None
                if data["deletionPlanRef"] is None
                else AbortControlArtifactRef.from_dict(
                    data["deletionPlanRef"]
                )
            ),
            deletion_plan_digest=data["deletionPlanDigest"],
            completion_source=(
                None
                if data["completionSource"] is None
                else _enum_from_wire(
                    AbortCompletionSource,
                    data["completionSource"],
                    field="completionSource",
                )
            ),
            batch_end_index_exclusive=data["batchEndIndexExclusive"],
            next_traversal_index=data["nextTraversalIndex"],
            continuation_token=data["continuationToken"],
            recorded_at=data["recordedAt"],
            diagnostic=data["diagnostic"],
            event_digest=data["eventDigest"],
        )


@dataclass(frozen=True)
class AbortControlArtifactRef:
    workspace_id: str
    gate_id: str
    evidence_run_id: str
    content_sha256: str
    control_ref_digest: str
    artifact_kind: ClassVar[str] = "acceptance-abort-control-ref"
    schema_version: ClassVar[int] = 1
    control_name: ClassVar[str] = "deletion-plan"

    def __post_init__(self) -> None:
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gateId")
        _validate_run_id(self.evidence_run_id, field="evidenceRunId")
        validate_sha256(self.content_sha256)
        validate_sha256(self.control_ref_digest)
        if self.control_ref_digest != domain_separated_sha256(
            _ABORT_CONTROL_REF_DOMAIN, self._payload()
        ):
            raise ValueError("controlRefDigest mismatch")

    def _payload(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind, "schemaVersion": self.schema_version,
            "workspaceId": self.workspace_id, "gateId": self.gate_id,
            "evidenceRunId": self.evidence_run_id, "controlName": self.control_name,
            "contentSha256": self.content_sha256,
        }

    def to_dict(self) -> dict[str, object]:
        return {**self._payload(), "controlRefDigest": self.control_ref_digest}

    @classmethod
    def from_dict(cls, value: object) -> "AbortControlArtifactRef":
        data = _closed_mapping(value, schema=cls.__name__, keys=frozenset({
            "artifactKind", "schemaVersion", "workspaceId", "gateId", "evidenceRunId",
            "controlName", "contentSha256", "controlRefDigest",
        }))
        if (
            data["artifactKind"] != cls.artifact_kind or type(data["schemaVersion"]) is not int
            or data["schemaVersion"] != 1 or data["controlName"] != cls.control_name
        ):
            raise ValueError("invalid abort control ref kind/version/name")
        return cls(data["workspaceId"], data["gateId"], data["evidenceRunId"],
                   data["contentSha256"], data["controlRefDigest"])


@dataclass(frozen=True)
class AbortDeletionPlanEntry:
    entry_kind: str
    tombstone_relative_path: str | None
    file_type: str
    device_id: str
    inode: str
    byte_length: int | None

    def __post_init__(self) -> None:
        for field, value in (("deviceId", self.device_id), ("inode", self.inode)):
            if (
                type(value) is not str or re.fullmatch(r"0|[1-9][0-9]{0,19}", value) is None
                or int(value) > 18446744073709551615
            ):
                raise ValueError(f"{field} must be a canonical UInt64String")
        if self.entry_kind == "TOMBSTONE_ROOT":
            if self.tombstone_relative_path is not None or self.file_type != "DIRECTORY" or self.byte_length is not None:
                raise ValueError("tombstone root requires null path/length and DIRECTORY")
        elif self.entry_kind == "CONTENT":
            validate_repo_relative_path(self.tombstone_relative_path)
            if self.file_type == "REGULAR_FILE":
                if type(self.byte_length) is not int or not 0 <= self.byte_length <= _I_JSON_INTEGER_MAX:
                    raise ValueError("regular-file byteLength must be a nonnegative I-JSON integer")
            elif self.file_type == "DIRECTORY":
                if self.byte_length is not None:
                    raise ValueError("directory byteLength must be null")
            else:
                raise ValueError("deletion plan forbids symlinks and special files")
        else:
            raise ValueError("unknown deletion plan entryKind")

    def to_dict(self) -> dict[str, object]:
        return {
            "entryKind": self.entry_kind, "tombstoneRelativePath": self.tombstone_relative_path,
            "fileType": self.file_type, "deviceId": self.device_id,
            "inode": self.inode, "byteLength": self.byte_length,
        }

    @classmethod
    def from_dict(cls, value: object) -> "AbortDeletionPlanEntry":
        data = _closed_mapping(value, schema=cls.__name__, keys=frozenset({
            "entryKind", "tombstoneRelativePath", "fileType", "deviceId", "inode", "byteLength",
        }))
        return cls(*(data[field] for field in (
            "entryKind", "tombstoneRelativePath", "fileType", "deviceId", "inode", "byteLength",
        )))


@dataclass(frozen=True)
class AbortDeletionPlan:
    workspace_id: str
    gate_id: str
    evidence_run_id: str
    authorization_id: str
    tombstone_identity_digest: str
    entries: tuple[AbortDeletionPlanEntry, ...]
    deletion_plan_digest: str
    artifact_kind: ClassVar[str] = "acceptance-abort-deletion-plan"
    schema_version: ClassVar[int] = 1

    def __post_init__(self) -> None:
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gateId")
        _validate_run_id(self.evidence_run_id, field="evidenceRunId")
        _validate_slug(self.authorization_id, field="authorizationId")
        validate_sha256(self.tombstone_identity_digest)
        validate_sha256(self.deletion_plan_digest)
        if (
            type(self.entries) is not tuple or not 1 <= len(self.entries) <= 16384
            or any(type(entry) is not AbortDeletionPlanEntry for entry in self.entries)
            or self.entries[-1].entry_kind != "TOMBSTONE_ROOT"
            or any(entry.entry_kind != "CONTENT" for entry in self.entries[:-1])
        ):
            raise ValueError("deletion plan requires bounded content followed by one explicit root")
        paths = tuple(entry.tombstone_relative_path for entry in self.entries[:-1])
        if len(paths) != len(set(paths)):
            raise ValueError("deletion plan content paths must be unique")
        # A retained parent must outlive every child it is authorized to remove.
        positions = {entry.tombstone_relative_path: (index, entry.file_type)
                     for index, entry in enumerate(self.entries[:-1])}
        for index, entry in enumerate(self.entries[:-1]):
            parent = posixpath.dirname(entry.tombstone_relative_path)
            while parent:
                if parent in positions and (
                    positions[parent][1] != "DIRECTORY" or positions[parent][0] <= index
                ):
                    raise ValueError("deletion plan parents must be directories ordered after children")
                parent = posixpath.dirname(parent)
        if len(canonical_json_bytes(self.to_dict())) > 4 * 1024 * 1024:
            raise ValueError("deletion plan exceeds 4 MiB")
        if self.deletion_plan_digest != domain_separated_sha256(
            _ABORT_DELETION_PLAN_DOMAIN, self._payload()
        ):
            raise ValueError("deletionPlanDigest mismatch")

    def _payload(self) -> dict[str, object]:
        return {
            "artifactKind": self.artifact_kind, "schemaVersion": self.schema_version,
            "workspaceId": self.workspace_id, "gateId": self.gate_id,
            "evidenceRunId": self.evidence_run_id, "authorizationId": self.authorization_id,
            "tombstoneIdentityDigest": self.tombstone_identity_digest,
            "entries": [entry.to_dict() for entry in self.entries],
        }

    def to_dict(self) -> dict[str, object]:
        return {**self._payload(), "deletionPlanDigest": self.deletion_plan_digest}

    @classmethod
    def from_dict(cls, value: object) -> "AbortDeletionPlan":
        data = _closed_mapping(value, schema=cls.__name__, keys=frozenset({
            "artifactKind", "schemaVersion", "workspaceId", "gateId", "evidenceRunId",
            "authorizationId", "tombstoneIdentityDigest", "entries", "deletionPlanDigest",
        }))
        if data["artifactKind"] != cls.artifact_kind or type(data["schemaVersion"]) is not int or data["schemaVersion"] != 1:
            raise ValueError("invalid deletion plan kind/version")
        if type(data["entries"]) is not list or not 1 <= len(data["entries"]) <= 16384:
            raise ValueError("entries must be a bounded nonempty wire array")
        return cls(
            data["workspaceId"], data["gateId"], data["evidenceRunId"], data["authorizationId"],
            data["tombstoneIdentityDigest"],
            tuple(AbortDeletionPlanEntry.from_dict(entry) for entry in data["entries"]),
            data["deletionPlanDigest"],
        )


class MaintenanceOperation(str, Enum):
    INSTALL_PUBLICATION_INTERLOCK = "INSTALL_PUBLICATION_INTERLOCK"
    ACTIVATE_ENFORCEMENT = "ACTIVATE_ENFORCEMENT"
    WRITE_ABORT_EVENT = "WRITE_ABORT_EVENT"
    TOMBSTONE_RUN = "TOMBSTONE_RUN"
    DELETE_TOMBSTONE_BATCH = "DELETE_TOMBSTONE_BATCH"


class _MaintenanceRequest:
    operation: ClassVar[MaintenanceOperation]

    def _payload(self) -> dict[str, object]:
        payload = {"operation": self.operation.value}
        for field in dataclass_fields(self):
            name = field.name
            if name == "identity":
                continue
            key = name.split("_")[0] + "".join(part.title() for part in name.split("_")[1:])
            item = getattr(self, name)
            payload[key] = item.to_dict() if hasattr(item, "to_dict") else item
        return payload

    def to_dict(self) -> dict[str, object]:
        return {"identity": self.identity.to_dict(), **self._payload()}

    def _validate(self) -> None:
        _validate_workspace_id(self.workspace_id)
        _validate_slug(self.gate_id, field="gateId")
        _validate_worker_request_binding(self.identity, WorkerKind.MAINTENANCE, self._payload())
        owner = self.identity.descriptor_claims[0].owner_binding
        if (owner.workspace_id, owner.gate_id) != (self.workspace_id, self.gate_id):
            raise ValueError("maintenance gate descriptor must match requested scope")
        validate_sha256(self.expected_maintenance_runtime_digest)
        validate_sha256(self.expected_durability_profile_digest)
        if (
            type(self.environment_observation)
            is not ActiveDurabilityEnvironmentObservation
        ):
            raise ValueError(
                "environmentObservation must be active-profile evidence"
            )

    def _validate_authority(self, authority: object) -> None:
        if (authority.workspace_id, authority.gate_id) != (self.workspace_id, self.gate_id):
            raise ValueError("maintenance authority must match request scope")
        if (
            self.expected_maintenance_runtime_digest != authority.maintenance_runtime.maintenance_runtime_digest
            or self.expected_durability_profile_digest != authority.durability_profile.durability_profile_digest
        ):
            raise ValueError("maintenance request must bind exact authority runtime/profile")
        capability = authority.durability_profile.capability_evidence
        qualified = DurabilityQualifiedEnvironment.create(
            host_build=capability.qualified_host_build,
            host_identity=capability.qualified_host_identity,
            filesystem_implementation_version=(
                capability.filesystem_implementation_version
            ),
            required_mount_options=capability.required_mount_options,
            stable_volume_identity=capability.stable_volume_identity,
            probe_runtime_digest=capability.probe_runtime_digest,
        )
        validate_durability_environment_observation(
            self.environment_observation,
            qualified,
        )

    def _validate_abort_ids(self) -> None:
        _validate_run_id(self.evidence_run_id, field="evidenceRunId")
        _validate_slug(self.authorization_id, field="authorizationId")
        _validate_slug(self.attempt_id, field="attemptId")

    def _validate_limits(self, **limits: int) -> None:
        for name, maximum in limits.items():
            value = getattr(self, name)
            if type(value) is not int or not 1 <= value <= maximum:
                raise ValueError(f"{name} must be positive and at most {maximum}")


@dataclass(frozen=True)
class InstallPublicationInterlockRequest(_MaintenanceRequest):
    identity: WorkerRequestIdentity
    workspace_id: str
    gate_id: str
    candidate_interlock: FinalizerPublicationInterlock
    expected_prior_latest_pointer: LatestPointer | None
    expected_prior_latest_pointer_digest: str | None
    environment_observation: ActiveDurabilityEnvironmentObservation
    expected_maintenance_runtime_digest: str
    expected_durability_profile_digest: str
    byte_limit: int = FINALIZER_INPUT_BYTE_LIMIT_MAX
    timeout_seconds: int = 60
    operation: ClassVar[MaintenanceOperation] = MaintenanceOperation.INSTALL_PUBLICATION_INTERLOCK

    def __post_init__(self) -> None:
        self._validate()
        if type(self.candidate_interlock) is not FinalizerPublicationInterlock:
            raise ValueError("candidateInterlock requires concrete publication interlock")
        self._validate_authority(self.candidate_interlock.authorization)
        authority = self.candidate_interlock.authorization
        if (
            self.expected_prior_latest_pointer != authority.expected_prior_latest_pointer
            or self.expected_prior_latest_pointer_digest != authority.expected_prior_latest_pointer_digest
        ):
            raise ValueError("interlock request prior latest must match authorized prior latest")
        self._validate_limits(
            byte_limit=FINALIZER_INPUT_BYTE_LIMIT_MAX,
            timeout_seconds=60,
        )
        if len(canonical_json_bytes(self.candidate_interlock.to_dict())) > self.byte_limit:
            raise ValueError("candidateInterlock exceeds byteLimit")


@dataclass(frozen=True)
class ActivateEnforcementRequest(_MaintenanceRequest):
    identity: WorkerRequestIdentity
    workspace_id: str
    gate_id: str
    intent: FinalizerActivationIntent
    environment_observation: ActiveDurabilityEnvironmentObservation
    expected_maintenance_runtime_digest: str
    expected_durability_profile_digest: str
    entry_limit: int = 4096
    byte_limit: int = FINALIZER_INPUT_BYTE_LIMIT_MAX
    timeout_seconds: int = 60
    operation: ClassVar[MaintenanceOperation] = MaintenanceOperation.ACTIVATE_ENFORCEMENT

    def __post_init__(self) -> None:
        self._validate()
        if type(self.intent) is not FinalizerActivationIntent:
            raise ValueError("intent requires concrete activation intent")
        self._validate_authority(self.intent.authorization)
        self._validate_limits(
            entry_limit=4096,
            byte_limit=FINALIZER_INPUT_BYTE_LIMIT_MAX,
            timeout_seconds=60,
        )
        if len(canonical_json_bytes(self.intent.to_dict())) > self.byte_limit:
            raise ValueError("intent exceeds byteLimit")


@dataclass(frozen=True)
class WriteAbortEventRequest(_MaintenanceRequest):
    identity: WorkerRequestIdentity
    workspace_id: str
    gate_id: str
    evidence_run_id: str
    authorization_id: str
    attempt_id: str
    authorization: AbortAuthorization
    environment_observation: ActiveDurabilityEnvironmentObservation
    expected_maintenance_runtime_digest: str
    expected_durability_profile_digest: str
    operation: ClassVar[MaintenanceOperation] = MaintenanceOperation.WRITE_ABORT_EVENT

    def __post_init__(self) -> None:
        self._validate()
        self._validate_abort_ids()
        if type(self.authorization) is not AbortAuthorization:
            raise ValueError("authorization requires concrete AbortAuthorization")
        self._validate_authority(self.authorization)
        if (self.evidence_run_id, self.authorization_id, self.attempt_id) != (
            self.authorization.evidence_run_id, self.authorization.authorization_id,
            self.authorization.attempt_id,
        ):
            raise ValueError("abort request must match exact authorization run/attempt")


@dataclass(frozen=True)
class TombstoneRunRequest(_MaintenanceRequest):
    identity: WorkerRequestIdentity
    workspace_id: str
    gate_id: str
    evidence_run_id: str
    authorization_id: str
    attempt_id: str
    expected_snapshot_digest: str
    environment_observation: ActiveDurabilityEnvironmentObservation
    expected_maintenance_runtime_digest: str
    expected_durability_profile_digest: str
    deletion_plan_entry_limit: int = 16384
    deletion_plan_byte_limit: int = 4 * 1024 * 1024
    timeout_seconds: int = 60
    operation: ClassVar[MaintenanceOperation] = MaintenanceOperation.TOMBSTONE_RUN

    def __post_init__(self) -> None:
        self._validate()
        self._validate_abort_ids()
        validate_sha256(self.expected_snapshot_digest)
        self._validate_limits(deletion_plan_entry_limit=16384,
                              deletion_plan_byte_limit=4 * 1024 * 1024, timeout_seconds=60)


@dataclass(frozen=True)
class DeleteTombstoneBatchRequest(_MaintenanceRequest):
    identity: WorkerRequestIdentity
    workspace_id: str
    gate_id: str
    evidence_run_id: str
    authorization_id: str
    attempt_id: str
    expected_tombstone_identity_digest: str
    deletion_plan_ref: AbortControlArtifactRef
    deletion_plan_digest: str
    continuation_event_digest: str
    continuation_token: str
    environment_observation: ActiveDurabilityEnvironmentObservation
    expected_maintenance_runtime_digest: str
    expected_durability_profile_digest: str
    entry_limit: int = 1024
    byte_limit: int = 1024 * 1024 * 1024
    timeout_seconds: int = 30
    operation: ClassVar[MaintenanceOperation] = MaintenanceOperation.DELETE_TOMBSTONE_BATCH

    def __post_init__(self) -> None:
        self._validate()
        self._validate_abort_ids()
        for digest in (self.expected_tombstone_identity_digest, self.deletion_plan_digest,
                       self.continuation_event_digest, self.continuation_token):
            validate_sha256(digest)
        if type(self.deletion_plan_ref) is not AbortControlArtifactRef or (
            self.deletion_plan_ref.workspace_id, self.deletion_plan_ref.gate_id,
            self.deletion_plan_ref.evidence_run_id,
        ) != (self.workspace_id, self.gate_id, self.evidence_run_id):
            raise ValueError("deletion plan ref must match requested run")
        self._validate_limits(entry_limit=1024, byte_limit=1024 * 1024 * 1024, timeout_seconds=30)


MaintenanceRequest = Union[
    InstallPublicationInterlockRequest, ActivateEnforcementRequest, WriteAbortEventRequest,
    TombstoneRunRequest, DeleteTombstoneBatchRequest,
]
_MAINTENANCE_REQUEST_TYPES = {
    cls.operation.value: cls for cls in (
        InstallPublicationInterlockRequest, ActivateEnforcementRequest, WriteAbortEventRequest,
        TombstoneRunRequest, DeleteTombstoneBatchRequest,
    )
}


def maintenance_request_from_dict(
    value: object, *, epoch: ProofAdmissionEpochRecord | None = None,
    current_epoch: ProofAdmissionCurrentEpoch | None = None,
    pause: ProofAdmissionPauseRecord | None = None,
    jobs: tuple[ProofAdmissionJobRecord, ...] = (),
    completions: tuple[ProofAdmissionJobCompletion, ...] = (),
    intents: tuple[ProofAdmissionEmissionIntent, ...] = (),
    acknowledgements: tuple[ProofAdmissionEmissionAcknowledgement, ...] = (),
    validate_proof_references: bool = True,
) -> MaintenanceRequest:
    if not isinstance(value, Mapping) or type(value.get("operation")) is not str:
        raise ValueError("maintenance request requires closed operation")
    cls = _MAINTENANCE_REQUEST_TYPES.get(value["operation"])
    if cls is None:
        raise ValueError("unknown maintenance request operation")
    fields = tuple(field.name for field in dataclass_fields(cls))
    wire = {name: name.split("_")[0] + "".join(part.title() for part in name.split("_")[1:])
            for name in fields}
    data = _closed_mapping(value, schema=cls.__name__, keys=frozenset(("operation", *wire.values())))
    args = {name: data[key] for name, key in wire.items()}
    args["identity"] = WorkerRequestIdentity.from_dict(args["identity"])
    args["environment_observation"] = (
        ActiveDurabilityEnvironmentObservation.from_dict(
            args["environment_observation"]
        )
    )
    if cls is InstallPublicationInterlockRequest:
        args["candidate_interlock"] = FinalizerPublicationInterlock.from_dict(
            args["candidate_interlock"], epoch=epoch, current_epoch=current_epoch, pause=pause,
            jobs=jobs, completions=completions, intents=intents, acknowledgements=acknowledgements,
            validate_proof_references=validate_proof_references,
        )
        if args["expected_prior_latest_pointer"] is not None:
            args["expected_prior_latest_pointer"] = LatestPointer.from_dict(args["expected_prior_latest_pointer"])
    elif cls is ActivateEnforcementRequest:
        args["intent"] = FinalizerActivationIntent.from_dict(args["intent"])
    elif cls is WriteAbortEventRequest:
        args["authorization"] = AbortAuthorization.from_dict(args["authorization"])
    elif cls is DeleteTombstoneBatchRequest:
        args["deletion_plan_ref"] = AbortControlArtifactRef.from_dict(args["deletion_plan_ref"])
    return cls(**args)


@dataclass(frozen=True)
class _MaintenanceResult:
    identity: WorkerRequestIdentity
    failure_code: MaintenanceFailureCode | None
    result_digest: str
    diagnostic: str | None
    operation: ClassVar[MaintenanceOperation]
    status: ClassVar[str]
    allowed_boundaries: ClassVar[tuple[str, ...]]

    def _payload(self) -> dict[str, object]:
        payload = {"operation": self.operation.value, "status": self.status,
                   "durableBoundary": self.durable_boundary}
        for field in dataclass_fields(self):
            if field.name == "result_digest":
                continue
            key = field.name.split("_")[0] + "".join(part.title() for part in field.name.split("_")[1:])
            item = getattr(self, field.name)
            payload[key] = item.to_dict() if hasattr(item, "to_dict") else (
                item.value if isinstance(item, Enum) else item
            )
        if self.operation is MaintenanceOperation.WRITE_ABORT_EVENT:
            payload["eventType"] = "AUTHORIZED"
        return payload

    def to_dict(self) -> dict[str, object]:
        return {**self._payload(), "resultDigest": self.result_digest}

    def __post_init__(self) -> None:
        if type(self.identity) is not WorkerRequestIdentity or self.identity.worker_kind is not WorkerKind.MAINTENANCE:
            raise ValueError("maintenance result requires maintenance worker identity")
        if self.durable_boundary not in self.allowed_boundaries:
            raise ValueError("maintenance result durableBoundary outside status branch")
        if self.status == "COMPLETED":
            if self.failure_code is not None or self.diagnostic is not None:
                raise ValueError("completed maintenance result forbids failure fields")
        else:
            if type(self.failure_code) is not MaintenanceFailureCode:
                raise ValueError("maintenance failure requires closed failureCode")
            _validate_non_empty_utf8(self.diagnostic, field="diagnostic", maximum_bytes=4096)
            if self.failure_code not in self._allowed_failures():
                raise ValueError("maintenance failureCode outside durable boundary branch")
        for name in ("authorization_id", "attempt_id"):
            if hasattr(self, name):
                _validate_slug(getattr(self, name), field=name)
        self._validate_branch()
        validate_sha256(self.result_digest)
        if self.result_digest != domain_separated_sha256(_MAINTENANCE_RESULT_DOMAIN, self._payload()):
            raise ValueError("maintenance resultDigest mismatch")

    def _allowed_failures(self) -> tuple[MaintenanceFailureCode, ...]:
        common = tuple(code for code in MaintenanceFailureCode if code is not MaintenanceFailureCode.ACTIVE_RUN)
        io = (MaintenanceFailureCode.TIMED_OUT, MaintenanceFailureCode.IO_FAILED)
        if self.operation is MaintenanceOperation.INSTALL_PUBLICATION_INTERLOCK:
            return io if self.status == "FAILED" else tuple(code for code in common if code is not MaintenanceFailureCode.LIMIT_EXCEEDED)
        if self.operation is MaintenanceOperation.ACTIVATE_ENFORCEMENT:
            return io if self.status == "FAILED" else tuple(MaintenanceFailureCode)
        if self.operation is MaintenanceOperation.WRITE_ABORT_EVENT:
            return io if self.durable_boundary == "EVENT_MAY_BE_DURABLE" else common
        if self.operation is MaintenanceOperation.TOMBSTONE_RUN:
            return (*io, MaintenanceFailureCode.LIMIT_EXCEEDED) if self.durable_boundary == "RUN_TOMBSTONED" else common
        if self.status == "INCOMPLETE":
            return (MaintenanceFailureCode.LIMIT_EXCEEDED,)
        if self.status == "REJECTED":
            return tuple(code for code in common if code is not MaintenanceFailureCode.LIMIT_EXCEEDED)
        return tuple(MaintenanceFailureCode)

    def _validate_branch(self) -> None:
        if self.operation is MaintenanceOperation.INSTALL_PUBLICATION_INTERLOCK:
            if self.status == "REJECTED":
                if self.interlock_digest is not None:
                    raise ValueError("rejected interlock forbids interlockDigest")
            else:
                validate_sha256(self.interlock_digest)
        elif self.operation is MaintenanceOperation.ACTIVATE_ENFORCEMENT:
            if self.generation is not None:
                _validate_positive_integer(self.generation, field="generation")
                if self.generation > _I_JSON_INTEGER_MAX:
                    raise ValueError("generation exceeds I-JSON")
            if self.status == "REJECTED":
                if self.enforcement_digest is not None:
                    raise ValueError("rejected activation forbids enforcementDigest")
            else:
                if self.generation is None:
                    raise ValueError("activation mutation requires generation")
                validate_sha256(self.enforcement_digest)
        elif self.operation is MaintenanceOperation.WRITE_ABORT_EVENT:
            if self.durable_boundary == "NONE":
                if self.event_digest is not None:
                    raise ValueError("prepublication authorization failure forbids eventDigest")
            else:
                validate_sha256(self.event_digest)
        elif self.operation is MaintenanceOperation.TOMBSTONE_RUN:
            pair = (self.deletion_plan_ref, self.deletion_plan_digest)
            if (pair[0] is None) != (pair[1] is None):
                raise ValueError("deletion plan ref and digest must be jointly present")
            if pair[0] is not None:
                if type(pair[0]) is not AbortControlArtifactRef:
                    raise ValueError("deletionPlanRef requires concrete abort control ref")
                validate_sha256(pair[1])
            if self.status == "COMPLETED":
                if pair[0] is None:
                    raise ValueError("completed tombstone requires deletion plan")
                validate_sha256(self.continuation_token)
                validate_sha256(self.tombstoned_event_digest)
            else:
                if self.continuation_token is not None or self.tombstoned_event_digest is not None:
                    raise ValueError("failed tombstone forbids continuation/event")
                if self.durable_boundary == "AUTHORIZATION_DURABLE" and pair[0] is not None:
                    raise ValueError("authorization-only failure forbids deletion plan")
        else:
            for name in ("deleted_entries", "deleted_bytes"):
                item = getattr(self, name)
                if type(item) is not int or not 0 <= item <= _I_JSON_INTEGER_MAX:
                    raise ValueError(f"{name} must be nonnegative I-JSON integer")
            if self.status == "REJECTED":
                if self.deleted_entries != 0 or self.deleted_bytes != 0 or self.continuation_token is not None or self.terminal_event_digest is not None:
                    raise ValueError("NO_MUTATION forbids deletion deltas and events")
            else:
                validate_sha256(self.terminal_event_digest)
                if self.status == "COMPLETED":
                    if self.continuation_token is not None:
                        raise ValueError("completed deletion forbids continuationToken")
                else:
                    validate_sha256(self.continuation_token)


@dataclass(frozen=True)
class InstallPublicationInterlockCompleted(_MaintenanceResult):
    interlock_digest: str
    operation: ClassVar[MaintenanceOperation] = MaintenanceOperation.INSTALL_PUBLICATION_INTERLOCK
    status: ClassVar[str] = "COMPLETED"
    durable_boundary: ClassVar[str] = "INTERLOCK_DURABLE"
    allowed_boundaries: ClassVar[tuple[str, ...]] = ("INTERLOCK_DURABLE",)


@dataclass(frozen=True)
class InstallPublicationInterlockFailed(_MaintenanceResult):
    interlock_digest: str
    operation: ClassVar[MaintenanceOperation] = MaintenanceOperation.INSTALL_PUBLICATION_INTERLOCK
    status: ClassVar[str] = "FAILED"
    durable_boundary: ClassVar[str] = "INTERLOCK_MAY_BE_DURABLE"
    allowed_boundaries: ClassVar[tuple[str, ...]] = ("INTERLOCK_MAY_BE_DURABLE",)


@dataclass(frozen=True)
class InstallPublicationInterlockRejected(_MaintenanceResult):
    interlock_digest: None
    operation: ClassVar[MaintenanceOperation] = MaintenanceOperation.INSTALL_PUBLICATION_INTERLOCK
    status: ClassVar[str] = "REJECTED"
    durable_boundary: ClassVar[str] = "NO_MUTATION"
    allowed_boundaries: ClassVar[tuple[str, ...]] = ("NO_MUTATION",)


@dataclass(frozen=True)
class ActivateEnforcementCompleted(_MaintenanceResult):
    generation: int
    enforcement_digest: str
    operation: ClassVar[MaintenanceOperation] = MaintenanceOperation.ACTIVATE_ENFORCEMENT
    status: ClassVar[str] = "COMPLETED"
    durable_boundary: ClassVar[str] = "ACTIVATED"
    allowed_boundaries: ClassVar[tuple[str, ...]] = ("ACTIVATED",)


@dataclass(frozen=True)
class ActivateEnforcementFailed(_MaintenanceResult):
    generation: int
    enforcement_digest: str
    durable_boundary: str
    operation: ClassVar[MaintenanceOperation] = MaintenanceOperation.ACTIVATE_ENFORCEMENT
    status: ClassVar[str] = "FAILED"
    allowed_boundaries: ClassVar[tuple[str, ...]] = (
        "PENDING_DURABLE", "GENERATION_DURABLE", "ACTIVATION_SENTINEL_DURABLE", "CURRENT_DURABLE",
    )


@dataclass(frozen=True)
class ActivateEnforcementRejected(_MaintenanceResult):
    generation: int | None
    enforcement_digest: None
    operation: ClassVar[MaintenanceOperation] = MaintenanceOperation.ACTIVATE_ENFORCEMENT
    status: ClassVar[str] = "REJECTED"
    durable_boundary: ClassVar[str] = "NO_MUTATION"
    allowed_boundaries: ClassVar[tuple[str, ...]] = ("NO_MUTATION",)


@dataclass(frozen=True)
class WriteAuthorizationCompleted(_MaintenanceResult):
    authorization_id: str
    attempt_id: str
    event_digest: str
    operation: ClassVar[MaintenanceOperation] = MaintenanceOperation.WRITE_ABORT_EVENT
    status: ClassVar[str] = "COMPLETED"
    durable_boundary: ClassVar[str] = "EVENT_DURABLE"
    allowed_boundaries: ClassVar[tuple[str, ...]] = ("EVENT_DURABLE",)


@dataclass(frozen=True)
class WriteAuthorizationFailed(_MaintenanceResult):
    authorization_id: str
    attempt_id: str
    event_digest: str | None
    durable_boundary: str
    operation: ClassVar[MaintenanceOperation] = MaintenanceOperation.WRITE_ABORT_EVENT
    status: ClassVar[str] = "FAILED"
    allowed_boundaries: ClassVar[tuple[str, ...]] = ("NONE", "EVENT_MAY_BE_DURABLE")


@dataclass(frozen=True)
class TombstoneRunCompleted(_MaintenanceResult):
    authorization_id: str
    attempt_id: str
    deletion_plan_ref: AbortControlArtifactRef
    deletion_plan_digest: str
    continuation_token: str
    tombstoned_event_digest: str
    operation: ClassVar[MaintenanceOperation] = MaintenanceOperation.TOMBSTONE_RUN
    status: ClassVar[str] = "COMPLETED"
    durable_boundary: ClassVar[str] = "TOMBSTONED_EVENT_DURABLE"
    allowed_boundaries: ClassVar[tuple[str, ...]] = ("TOMBSTONED_EVENT_DURABLE",)


@dataclass(frozen=True)
class TombstoneRunFailed(_MaintenanceResult):
    authorization_id: str
    attempt_id: str
    deletion_plan_ref: AbortControlArtifactRef | None
    deletion_plan_digest: str | None
    continuation_token: None
    tombstoned_event_digest: None
    durable_boundary: str
    operation: ClassVar[MaintenanceOperation] = MaintenanceOperation.TOMBSTONE_RUN
    status: ClassVar[str] = "FAILED"
    allowed_boundaries: ClassVar[tuple[str, ...]] = ("AUTHORIZATION_DURABLE", "RUN_TOMBSTONED")


@dataclass(frozen=True)
class DeleteTombstoneBatchCompleted(_MaintenanceResult):
    authorization_id: str
    attempt_id: str
    deleted_entries: int
    deleted_bytes: int
    continuation_token: None
    terminal_event_digest: str
    operation: ClassVar[MaintenanceOperation] = MaintenanceOperation.DELETE_TOMBSTONE_BATCH
    status: ClassVar[str] = "COMPLETED"
    durable_boundary: ClassVar[str] = "DELETED_EVENT_DURABLE"
    allowed_boundaries: ClassVar[tuple[str, ...]] = ("DELETED_EVENT_DURABLE",)


@dataclass(frozen=True)
class DeleteTombstoneBatchIncomplete(_MaintenanceResult):
    authorization_id: str
    attempt_id: str
    deleted_entries: int
    deleted_bytes: int
    continuation_token: str
    terminal_event_digest: str
    operation: ClassVar[MaintenanceOperation] = MaintenanceOperation.DELETE_TOMBSTONE_BATCH
    status: ClassVar[str] = "INCOMPLETE"
    durable_boundary: ClassVar[str] = "FAILED_EVENT_DURABLE"
    allowed_boundaries: ClassVar[tuple[str, ...]] = ("FAILED_EVENT_DURABLE",)


@dataclass(frozen=True)
class DeleteTombstoneBatchFailed(_MaintenanceResult):
    authorization_id: str
    attempt_id: str
    deleted_entries: int
    deleted_bytes: int
    continuation_token: str
    terminal_event_digest: str
    operation: ClassVar[MaintenanceOperation] = MaintenanceOperation.DELETE_TOMBSTONE_BATCH
    status: ClassVar[str] = "FAILED"
    durable_boundary: ClassVar[str] = "FAILED_EVENT_DURABLE"
    allowed_boundaries: ClassVar[tuple[str, ...]] = ("FAILED_EVENT_DURABLE",)


@dataclass(frozen=True)
class DeleteTombstoneBatchRejected(_MaintenanceResult):
    authorization_id: str
    attempt_id: str
    deleted_entries: int
    deleted_bytes: int
    continuation_token: None
    terminal_event_digest: None
    operation: ClassVar[MaintenanceOperation] = MaintenanceOperation.DELETE_TOMBSTONE_BATCH
    status: ClassVar[str] = "REJECTED"
    durable_boundary: ClassVar[str] = "NO_MUTATION"
    allowed_boundaries: ClassVar[tuple[str, ...]] = ("NO_MUTATION",)


InstallPublicationInterlockResult = Union[
    InstallPublicationInterlockCompleted, InstallPublicationInterlockFailed, InstallPublicationInterlockRejected,
]
ActivateEnforcementResult = Union[
    ActivateEnforcementCompleted, ActivateEnforcementFailed, ActivateEnforcementRejected,
]
WriteAbortEventResult = Union[WriteAuthorizationCompleted, WriteAuthorizationFailed]
TombstoneRunResult = Union[TombstoneRunCompleted, TombstoneRunFailed]
DeleteTombstoneBatchResult = Union[
    DeleteTombstoneBatchCompleted, DeleteTombstoneBatchIncomplete,
    DeleteTombstoneBatchFailed, DeleteTombstoneBatchRejected,
]
MaintenanceResult = Union[
    InstallPublicationInterlockResult, ActivateEnforcementResult, WriteAbortEventResult,
    TombstoneRunResult, DeleteTombstoneBatchResult,
]
_MAINTENANCE_RESULT_TYPES = {
    (cls.operation.value, cls.status): cls for cls in (
        InstallPublicationInterlockCompleted, InstallPublicationInterlockFailed, InstallPublicationInterlockRejected,
        ActivateEnforcementCompleted, ActivateEnforcementFailed, ActivateEnforcementRejected,
        WriteAuthorizationCompleted, WriteAuthorizationFailed, TombstoneRunCompleted, TombstoneRunFailed,
        DeleteTombstoneBatchCompleted, DeleteTombstoneBatchIncomplete, DeleteTombstoneBatchFailed,
        DeleteTombstoneBatchRejected,
    )
}


def maintenance_result_from_dict(value: object, request: MaintenanceRequest) -> MaintenanceResult:
    if type(request) not in _MAINTENANCE_REQUEST_TYPES.values() or not isinstance(value, Mapping):
        raise ValueError("maintenance result requires its concrete request")
    if value.get("operation") != request.operation.value or type(value.get("status")) is not str:
        raise ValueError("maintenance result belongs to another operation matrix row")
    cls = _MAINTENANCE_RESULT_TYPES.get((request.operation.value, value["status"]))
    if cls is None:
        raise ValueError("unknown maintenance result status")
    fields = tuple(field.name for field in dataclass_fields(cls))
    wire = {name: name.split("_")[0] + "".join(part.title() for part in name.split("_")[1:])
            for name in fields}
    keys = {"operation", "status", "durableBoundary", *wire.values()}
    if request.operation is MaintenanceOperation.WRITE_ABORT_EVENT:
        keys.add("eventType")
    data = _closed_mapping(value, schema=cls.__name__, keys=frozenset(keys))
    if data["durableBoundary"] not in cls.allowed_boundaries:
        raise ValueError("durable boundary outside selected maintenance status")
    if request.operation is MaintenanceOperation.WRITE_ABORT_EVENT and data["eventType"] != "AUTHORIZED":
        raise ValueError("authorization result requires AUTHORIZED eventType")
    args = {name: data[key] for name, key in wire.items()}
    args["identity"] = WorkerRequestIdentity.from_dict(args["identity"])
    if args["identity"] != request.identity:
        raise ValueError("maintenance result must echo exact request identity")
    if args["failure_code"] is not None:
        args["failure_code"] = _enum_from_wire(MaintenanceFailureCode, args["failure_code"], field="failureCode")
    if args.get("deletion_plan_ref") is not None:
        args["deletion_plan_ref"] = AbortControlArtifactRef.from_dict(args["deletion_plan_ref"])
    result = cls(**args)
    for field in ("authorization_id", "attempt_id"):
        if hasattr(request, field) and getattr(result, field) != getattr(request, field):
            raise ValueError("maintenance result must echo exact authorization/attempt")
    if type(request) is InstallPublicationInterlockRequest and result.status != "REJECTED":
        if result.interlock_digest != request.candidate_interlock.interlock_digest:
            raise ValueError("interlock result must bind exact candidate")
    elif type(request) is ActivateEnforcementRequest:
        if result.generation is not None and result.generation != request.intent.target_generation:
            raise ValueError("activation result must bind requested generation")
        if result.status != "REJECTED":
            intent = request.intent
            record = {
                "artifactKind": FinalizerEnforcementRecord.artifact_kind, "schemaVersion": 1,
                "generation": intent.target_generation,
                **{key: intent.to_dict()[key] for key in (
                    "workspaceId", "gateId", "requiredFinalizerId", "activatedAt",
                    "activationSourceCommit", "requirementDigest", "configDigest", "sourceDigest",
                    "protectedBaselineDigest",
                )},
                "activationIntent": intent.to_dict(),
                "priorLatestPointer": None if intent.expected_prior_latest_pointer is None else intent.expected_prior_latest_pointer.to_dict(),
                "priorLatestPointerDigest": intent.expected_prior_latest_pointer_digest,
            }
            if result.enforcement_digest != domain_separated_sha256(_ENFORCEMENT_DOMAIN, record):
                raise ValueError("activation result must bind exact candidate enforcement")
    elif type(request) is TombstoneRunRequest and result.deletion_plan_ref is not None:
        ref = result.deletion_plan_ref
        if (ref.workspace_id, ref.gate_id, ref.evidence_run_id) != (
            request.workspace_id, request.gate_id, request.evidence_run_id,
        ):
            raise ValueError("tombstone result plan ref must match requested run")
    elif type(request) is DeleteTombstoneBatchRequest:
        if result.deleted_entries > request.entry_limit or result.deleted_bytes > request.byte_limit:
            raise ValueError("deletion result exceeds requested batch budgets")
    return result


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


WorkerRequest = Union[
    PrepareBundleRequest, CaptureRuntimeRequest, MaterializeSnapshotRequest,
    ExecuteFinalizerRequest, PersistAuthorityRuntimeRequest, MaintenanceRequest,
]
WorkerResult = Union[
    BundlePreparationCompleted, BundlePreparationFailed,
    CaptureRuntimeCompleted, CaptureRuntimeFailed,
    MaterializeSnapshotCompleted, MaterializeSnapshotFailed,
    ExecuteFinalizerCompleted, ExecuteFinalizerFailed,
    PersistAuthorityRuntimeCompleted, PersistAuthorityRuntimeFailed,
    PersistAuthorityRuntimeRejected, MaintenanceResult,
]


_WORKER_CONTRACT_MATRIX = {
    WorkerKind.BUNDLE_PREPARER: (
        (PrepareBundleRequest,), (BundlePreparationCompleted, BundlePreparationFailed),
        (DescriptorRole.REPOSITORY_ROOT, DescriptorRole.TEMPORARY_DIRECTORY),
        bundle_preparation_result_from_dict,
    ),
    WorkerKind.RUNTIME_CAPTURE: (
        (CaptureRuntimeRequest,), (CaptureRuntimeCompleted, CaptureRuntimeFailed),
        (DescriptorRole.TEMPORARY_DIRECTORY,), capture_runtime_result_from_dict,
    ),
    WorkerKind.MATERIALIZER: (
        (MaterializeSnapshotRequest,), (MaterializeSnapshotCompleted, MaterializeSnapshotFailed),
        (DescriptorRole.RUN_DIRECTORY,), materialize_snapshot_result_from_dict,
    ),
    WorkerKind.FINALIZER: (
        (ExecuteFinalizerRequest,), (ExecuteFinalizerCompleted, ExecuteFinalizerFailed),
        (), execute_finalizer_result_from_dict,
    ),
    WorkerKind.AUTHORITY_RUNTIME_PERSISTER: (
        (PersistAuthorityRuntimeRequest,),
        (PersistAuthorityRuntimeCompleted, PersistAuthorityRuntimeFailed, PersistAuthorityRuntimeRejected),
        (DescriptorRole.GATE_DIRECTORY, DescriptorRole.TEMPORARY_DIRECTORY),
        persist_authority_runtime_result_from_dict,
    ),
    WorkerKind.MAINTENANCE: (
        tuple(_MAINTENANCE_REQUEST_TYPES.values()), tuple(_MAINTENANCE_RESULT_TYPES.values()),
        (DescriptorRole.GATE_DIRECTORY,), maintenance_result_from_dict,
    ),
}


def _worker_request_types(kind: WorkerKind) -> tuple[type, ...]:
    if type(kind) is not WorkerKind:
        raise ValueError("worker kind must be concrete WorkerKind")
    return _WORKER_CONTRACT_MATRIX[kind][0]


def _worker_result_types(kind: WorkerKind) -> tuple[type, ...]:
    if type(kind) is not WorkerKind:
        raise ValueError("worker kind must be concrete WorkerKind")
    return _WORKER_CONTRACT_MATRIX[kind][1]


def worker_timeout_seconds(request: WorkerRequest) -> int:
    if (
        type(getattr(request, "identity", None)) is not WorkerRequestIdentity
        or type(request) not in _worker_request_types(request.identity.worker_kind)
    ):
        raise ValueError("worker timeout requires a concrete request")
    if type(request) is WriteAbortEventRequest:
        return FINALIZER_TIMEOUT_SECONDS_MAX
    return request.timeout_seconds


def worker_request_from_dict(
    value: object, *,
    epoch: ProofAdmissionEpochRecord | None = None,
    current_epoch: ProofAdmissionCurrentEpoch | None = None,
    pause: ProofAdmissionPauseRecord | None = None,
    jobs: tuple[ProofAdmissionJobRecord, ...] = (),
    completions: tuple[ProofAdmissionJobCompletion, ...] = (),
    intents: tuple[ProofAdmissionEmissionIntent, ...] = (),
    acknowledgements: tuple[ProofAdmissionEmissionAcknowledgement, ...] = (),
) -> WorkerRequest:
    if not isinstance(value, Mapping):
        raise ValueError("worker request must be an object")
    identity = WorkerRequestIdentity.from_dict(value.get("identity"))
    if identity.worker_kind is WorkerKind.MAINTENANCE:
        return maintenance_request_from_dict(
            value, epoch=epoch, current_epoch=current_epoch, pause=pause,
            jobs=jobs, completions=completions, intents=intents,
            acknowledgements=acknowledgements,
            validate_proof_references=epoch is not None,
        )
    return _worker_request_types(identity.worker_kind)[0].from_dict(value)


def worker_result_from_dict(value: object, request: WorkerRequest) -> WorkerResult:
    if (
        type(getattr(request, "identity", None)) is not WorkerRequestIdentity
        or type(request) not in _worker_request_types(request.identity.worker_kind)
    ):
        raise ValueError("worker result requires its concrete originating request")
    return _WORKER_CONTRACT_MATRIX[request.identity.worker_kind][3](value, request)


def supervisor_control_frame_from_bytes(
    wire: bytes, *, request: WorkerRequest | None = None,
    expected_identity: WorkerRequestIdentity | None = None,
    epoch: ProofAdmissionEpochRecord | None = None,
    current_epoch: ProofAdmissionCurrentEpoch | None = None,
    pause: ProofAdmissionPauseRecord | None = None,
    jobs: tuple[ProofAdmissionJobRecord, ...] = (),
    completions: tuple[ProofAdmissionJobCompletion, ...] = (),
    intents: tuple[ProofAdmissionEmissionIntent, ...] = (),
    acknowledgements: tuple[ProofAdmissionEmissionAcknowledgement, ...] = (),
) -> _SupervisorFrame | WorkerRequestFrame | WorkerResultFrame:
    """Decode the bounded control channel; ancillary frames are never admitted."""
    if type(wire) is not bytes or not 1 <= len(wire) <= 2097152:
        raise ValueError("supervisor frame exceeds channel byte limit")
    value = _strict_json_value(wire)
    if not isinstance(value, Mapping):
        raise ValueError("supervisor frame must be an object")
    if value.get("frameType") == "WORKER_REQUEST":
        frame = WorkerRequestFrame.from_dict(
            value, epoch=epoch, current_epoch=current_epoch, pause=pause,
            jobs=jobs, completions=completions, intents=intents,
            acknowledgements=acknowledgements,
        )
    elif value.get("frameType") == "WORKER_RESULT":
        frame = WorkerResultFrame.from_dict(value, request=request)
    else:
        return supervisor_scalar_frame_from_bytes(wire, expected_identity=expected_identity)
    if expected_identity is not None and (
        type(expected_identity) is not WorkerRequestIdentity or frame.identity != expected_identity
    ):
        raise ValueError("supervisor frame belongs to another request")
    return frame
