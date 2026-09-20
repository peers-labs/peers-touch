#!/usr/bin/env python3
"""Appium-backed Mobile native business Acceptance scenarios."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Protocol

from tooling.acceptance.core import (
    AcceptanceGate,
    ArtifactRef,
    ArtifactSession,
    DriverError,
    EphemeralCapabilityBlocked,
    EphemeralGateClient,
    EvidenceError,
    EvidenceStore,
    GateError,
    ProvisioningError,
    REPO_ROOT,
    current_run_directory,
    load_runtime_manifest,
    require_runtime_service,
)
from tooling.acceptance.core.redaction import is_sensitive_key
from tooling.acceptance.gates.mobile.appium import (
    APPIUM_CAPABILITY_ID,
    AppiumSession,
)
from tooling.acceptance.gates.mobile.proof_contracts import (
    CLIENT_PLATFORM,
    CLIENT_PROVIDER,
    CLIENT_SERVICE,
    GATE_ID,
    ProofContractError,
    artifact_records_from_evidence_manifest,
    validate_artifact_roles,
    validate_contract_payload,
)
SCENARIO_GATES = {
    "access": "mobile-native-access-e2e",
    "lifecycle": "mobile-native-lifecycle-e2e",
    "recovery": "mobile-native-recovery-e2e",
    "recovery-ui": "mobile-native-recovery-ui-e2e",
    "social-convergence": "mobile-native-social-convergence-e2e",
    "chat-contacts": "mobile-native-chat-contacts-e2e",
    "moments": "mobile-native-moments-e2e",
    "settings": "mobile-native-settings-e2e",
    "platform": "mobile-native-platform-e2e",
}
SCENARIO_METADATA = {
    "access": {
        "phase": "W2-E Native Acceptance",
        "bom": ["W2-E"],
        "spec": ["MS-D14", "MS-AG03"],
        "observed": [
            "physical iOS and Android Access Gate and OAuth variants",
        ],
        "unproven": [],
    },
    "lifecycle": {
        "phase": "W9-C Physical Lifecycle",
        "bom": ["W3", "W7-C", "W7-D"],
        "spec": ["MS-AG02", "MS-AG05"],
        "observed": [
            "physical iOS and Android OS background/foreground delivery with canonical runtime-graph readback",
        ],
        "unproven": [
            "secure-storage deletion failure",
            "physical Station and actor switching",
            "W5 event-ingress reconciliation",
        ],
    },
    "recovery": {
        "phase": "W4 Command Recovery",
        "bom": ["W4"],
        "spec": ["MS-AG04"],
        "observed": [
            "physical durable-command convergence across forced disconnect and cold restart",
        ],
        "unproven": [
            "pre-dispatch, post-dispatch, and post-commit disconnect recovery",
            "ten-trial exactly-once Station commit evidence",
            "visible unresolved outcome after cold restart",
        ],
    },
    "recovery-ui": {
        "phase": "W6-D Recovery UI",
        "bom": ["W6-D"],
        "spec": ["MS-AG05", "MS-AG08", "MS-AG11"],
        "observed": [
            "physical degraded-state and recovery UI across iOS and Android",
        ],
        "unproven": [
            "production-triggered recovery overlays",
            "native accessibility and focus recovery",
            "blocking trust-state recovery",
        ],
    },
    "social-convergence": {
        "phase": "W5 Social Convergence",
        "bom": ["W5"],
        "spec": ["MS-AG06"],
        "observed": [
            "physical Social projection convergence through realtime and forced reconciliation",
        ],
        "unproven": [
            "five-second realtime convergence",
            "thirty-second forced-reconcile convergence",
            "Station readback agreement across both clients",
        ],
    },
    "chat-contacts": {
        "phase": "W6-A Chat And Contacts",
        "bom": ["W6-A"],
        "spec": ["MS-AG04", "MS-AG06", "MS-AG08", "MS-AG09", "MS-AG10"],
        "observed": [
            "physical two-actor Chat, contacts, and group journeys",
        ],
        "unproven": [
            "cross-client Direct and Group Messaging readback",
            "contact-request convergence",
            "native layout and overload behavior",
        ],
    },
    "moments": {
        "phase": "W6-B Moments",
        "bom": ["W6-B"],
        "spec": ["MS-AG04", "MS-AG06", "MS-AG08", "MS-AG09", "MS-AG10"],
        "observed": [
            "physical Moments feed, publish, rollback, and readback",
        ],
        "unproven": [
            "cross-client feed convergence",
            "publish rollback and Station readback",
            "native layout and overload behavior",
        ],
    },
    "settings": {
        "phase": "W6-C Settings",
        "bom": ["W6-C"],
        "spec": ["MS-AG04", "MS-AG06", "MS-AG08", "MS-AG09", "MS-AG10"],
        "observed": [
            "physical account and local settings conflict/readback behavior",
        ],
        "unproven": [
            "account-setting cross-client convergence",
            "local-setting isolation",
            "conflict and Station readback behavior",
        ],
    },
    "platform": {
        "phase": "W7 Native Platform",
        "bom": ["W7-C", "W7-D"],
        "spec": ["MS-AG07", "MS-AG08", "MS-AG11"],
        "observed": [
            "physical iOS and Android permission and network port behavior",
            "physical native accessibility trees, screenshots, and WebView DOM",
        ],
        "unproven": [
            "VoiceOver and TalkBack assisted traversal",
            "maximum text size, reduced motion, and longest-locale matrix",
            "MS-AG07 populated-workload P50/P95/P99 thresholds",
        ],
    },
}
LIFECYCLE_CYCLES = 20
PLATFORM_PERMISSION_KINDS = (
    "camera",
    "microphone",
    "storage",
    "notifications",
)
VALID_LAUNCH_STATES = {
    "app-boot",
    "station-selection",
    "station-handshake",
    "access-gate-chain",
    "runtime-critical",
    "shell",
    "station-change",
    "logout",
    "background",
    "resume",
}

ACCESS_ASSIGNMENTS = {
    "alice-ios": ("station-primary", "github"),
    "bob-ios": ("station-secondary", "google"),
    "alice-android": ("station-primary", "google"),
    "bob-android": ("station-secondary", "github"),
}

PROVIDER_CAPABILITY = "mobile.native.provider-authorization"
STATION_FIXTURE_CAPABILITY = "mobile.native.station-fixture"
PRODUCTION_OAUTH_PURGE_ACTION = "cleanup"
SECURE_STORAGE_ABSENCE_FIELDS = (
    "activeAttemptIndexAbsent",
    "attemptSecretRecordAbsent",
    "currentSessionIndexAbsent",
    "credentialRecordAbsent",
    "publicProjectionAbsent",
)

CAPABILITY_OPERATIONS = {
    APPIUM_CAPABILITY_ID: (
        "start",
        "stop",
        "wait_ready",
        "is_alive",
        "contexts",
        "switch_context",
        "harness_inventory",
        "harness_action",
        "harness_negative_callback",
        "refresh_webview",
        "find_element",
        "click",
        "capture_page_source",
        "capture_screenshot",
        "verify_build_identity",
    ),
    PROVIDER_CAPABILITY: ("authorize",),
    STATION_FIXTURE_CAPABILITY: (
        "prepare_following_gate",
        "expire_awaiting_attempt",
        "read_proof_snapshot",
    ),
}


class MobileNativeBlocked(GateError):
    def __init__(
        self,
        reason: str,
        resource: str,
        *,
        evidence_gaps: list[dict[str, str]] | None = None,
    ) -> None:
        super().__init__(reason)
        self.reason = reason
        self.resource = resource
        self.evidence_gaps = list(evidence_gaps or [])


def validate_lifecycle_snapshot(
    value: Any,
    *,
    expected_phase: str,
    minimum_generation: int = 0,
    expected_boot_order: list[str] | None = None,
) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {
        "phase",
        "launchState",
        "generation",
        "bootOrder",
        "runtimes",
        "errorKey",
    }:
        raise GateError("Mobile lifecycle snapshot has an invalid shape")
    if value["phase"] != expected_phase:
        raise GateError(
            "Mobile lifecycle phase mismatch: "
            f"expected {expected_phase}, got {value['phase']!r}"
        )
    if value["launchState"] not in VALID_LAUNCH_STATES:
        raise GateError("Mobile lifecycle launch state is invalid")
    generation = value["generation"]
    if (
        not isinstance(generation, int)
        or isinstance(generation, bool)
        or generation < minimum_generation
    ):
        raise GateError("Mobile lifecycle generation is invalid or stale")
    boot_order = value["bootOrder"]
    runtimes = value["runtimes"]
    if (
        not isinstance(boot_order, list)
        or not boot_order
        or any(not isinstance(item, str) or not item for item in boot_order)
        or not isinstance(runtimes, list)
    ):
        raise GateError("Mobile lifecycle runtime graph is incomplete")
    if expected_boot_order is not None and boot_order != expected_boot_order:
        raise GateError("Mobile lifecycle boot order changed")
    expected_status = (
        "suspended" if expected_phase == "SUSPENDED" else "ready"
    )
    runtime_ids: list[str] = []
    for runtime in runtimes:
        if not isinstance(runtime, Mapping) or set(runtime) != {
            "id",
            "status",
            "errorKey",
        }:
            raise GateError("Mobile lifecycle runtime snapshot is invalid")
        runtime_id = runtime["id"]
        if not isinstance(runtime_id, str) or not runtime_id:
            raise GateError("Mobile lifecycle runtime identity is invalid")
        if (
            runtime["status"] != expected_status
            or runtime["errorKey"] is not None
        ):
            raise GateError(
                f"Mobile lifecycle runtime {runtime_id!r} "
                f"is not {expected_status}"
            )
        runtime_ids.append(runtime_id)
    if runtime_ids != boot_order or len(set(runtime_ids)) != len(runtime_ids):
        raise GateError("Mobile lifecycle runtime order is inconsistent")
    if value["errorKey"] is not None:
        raise GateError("Mobile lifecycle snapshot contains a transition error")
    return dict(value)


@dataclass(frozen=True)
class AccessVariant:
    id: str
    platform: str
    client_id: str
    service_id: str
    provider: str
    operation: str
    required_cell: str
    expected_phase: str
    expected_failure: str = ""
    alternate_service_id: str = ""


REQUIRED_ACCESS_VARIANTS = (
    AccessVariant(
        id="success-ios-github",
        platform="ios",
        client_id="alice-ios",
        service_id="station-primary",
        provider="github",
        operation="success",
        required_cell="physical-device",
        expected_phase="active_session",
    ),
    AccessVariant(
        id="success-ios-google",
        platform="ios",
        client_id="bob-ios",
        service_id="station-secondary",
        provider="google",
        operation="success",
        required_cell="physical-device",
        expected_phase="active_session",
    ),
    AccessVariant(
        id="success-android-github",
        platform="android",
        client_id="bob-android",
        service_id="station-secondary",
        provider="github",
        operation="success",
        required_cell="physical-device",
        expected_phase="active_session",
    ),
    AccessVariant(
        id="success-android-google",
        platform="android",
        client_id="alice-android",
        service_id="station-primary",
        provider="google",
        operation="success",
        required_cell="physical-device",
        expected_phase="active_session",
    ),
    AccessVariant(
        id="cancel-ios",
        platform="ios",
        client_id="alice-ios",
        service_id="station-primary",
        provider="github",
        operation="cancel",
        required_cell="physical-device",
        expected_phase="cancelled",
    ),
    AccessVariant(
        id="cancel-android",
        platform="android",
        client_id="alice-android",
        service_id="station-primary",
        provider="google",
        operation="cancel",
        required_cell="physical-device",
        expected_phase="cancelled",
    ),
    AccessVariant(
        id="following-gate-ios",
        platform="ios",
        client_id="alice-ios",
        service_id="station-primary",
        provider="github",
        operation="following_gate",
        required_cell="physical-device",
        expected_phase="following_gate",
    ),
    AccessVariant(
        id="following-gate-android",
        platform="android",
        client_id="alice-android",
        service_id="station-primary",
        provider="google",
        operation="following_gate",
        required_cell="physical-device",
        expected_phase="following_gate",
    ),
    AccessVariant(
        id="expiry-ios",
        platform="ios",
        client_id="alice-ios",
        service_id="station-primary",
        provider="github",
        operation="expiry",
        required_cell="physical-device",
        expected_phase="expired",
    ),
    AccessVariant(
        id="expiry-android",
        platform="android",
        client_id="alice-android",
        service_id="station-primary",
        provider="google",
        operation="expiry",
        required_cell="physical-device",
        expected_phase="expired",
    ),
    AccessVariant(
        id="replay-ios",
        platform="ios",
        client_id="alice-ios",
        service_id="station-primary",
        provider="github",
        operation="replay",
        required_cell="physical-device",
        expected_phase="failed",
        expected_failure="oauthReplay",
    ),
    AccessVariant(
        id="replay-android",
        platform="android",
        client_id="alice-android",
        service_id="station-primary",
        provider="google",
        operation="replay",
        required_cell="physical-device",
        expected_phase="failed",
        expected_failure="oauthReplay",
    ),
    AccessVariant(
        id="provider-mismatch-ios",
        platform="ios",
        client_id="alice-ios",
        service_id="station-primary",
        provider="github",
        operation="provider_mismatch",
        required_cell="physical-device",
        expected_phase="failed",
        expected_failure="oauthProviderMismatch",
    ),
    AccessVariant(
        id="provider-mismatch-android",
        platform="android",
        client_id="alice-android",
        service_id="station-primary",
        provider="google",
        operation="provider_mismatch",
        required_cell="physical-device",
        expected_phase="failed",
        expected_failure="oauthProviderMismatch",
    ),
    AccessVariant(
        id="station-mismatch-ios",
        platform="ios",
        client_id="alice-ios",
        service_id="station-primary",
        provider="github",
        operation="station_mismatch",
        required_cell="physical-device",
        expected_phase="failed",
        expected_failure="oauthStationMismatch",
        alternate_service_id="station-secondary",
    ),
    AccessVariant(
        id="station-mismatch-android",
        platform="android",
        client_id="alice-android",
        service_id="station-primary",
        provider="google",
        operation="station_mismatch",
        required_cell="physical-device",
        expected_phase="failed",
        expected_failure="oauthStationMismatch",
        alternate_service_id="station-secondary",
    ),
)


class AccessVariantLedger:
    def __init__(
        self,
        variants: tuple[AccessVariant, ...] = REQUIRED_ACCESS_VARIANTS,
    ) -> None:
        if len({variant.id for variant in variants}) != len(variants):
            raise GateError("Mobile access variant ledger contains duplicate IDs")
        self._variants = variants
        self._status = {variant.id: "PENDING" for variant in variants}
        self._evidence: dict[str, dict[str, Any]] = {}

    def mark_passed(
        self,
        variant_id: str,
        evidence: Mapping[str, Any],
    ) -> None:
        variant = self._variant(variant_id)
        normalized = self._validate_evidence(variant, evidence)
        self._status[variant_id] = "PASSED"
        self._evidence[variant_id] = normalized

    def status(self, variant_id: str) -> str:
        self._variant(variant_id)
        return self._status[variant_id]

    def missing_evidence(self) -> list[dict[str, str]]:
        missing: list[dict[str, str]] = []
        for variant in self._variants:
            status = self._status[variant.id]
            if status == "PASSED":
                continue
            missing.append(
                {
                    "variantId": variant.id,
                    "platform": variant.platform,
                    "requiredCell": variant.required_cell,
                    "status": status,
                    "reason": "required source-bound variant evidence is absent",
                }
            )
        return missing

    def as_dict(self) -> dict[str, Any]:
        return {
            "artifactKind": "mobile-oauth-required-variant-ledger",
            "sourceSpec": ["MS-D14", "MS-AG03", "MS-PA03", "MS-PA25"],
            "requiredVariants": [
                {
                    "variantId": variant.id,
                    "platform": variant.platform,
                    "clientId": variant.client_id,
                    "serviceId": variant.service_id,
                    "provider": variant.provider,
                    "operation": variant.operation,
                    "requiredCell": variant.required_cell,
                    "status": self._status[variant.id],
                    "evidence": self._evidence.get(variant.id),
                }
                for variant in self._variants
            ],
            "missingEvidence": self.missing_evidence(),
        }

    def require_proven(self) -> None:
        missing = self.missing_evidence()
        if not missing:
            return
        details = "; ".join(
            f"{item['variantId']}: {item['reason']}" for item in missing
        )
        raise MobileNativeBlocked(
            f"MS-AG03 required variant evidence is incomplete: {details}",
            "mobile-runtime:oauth-variant-ledger",
            evidence_gaps=missing,
        )

    def _variant(self, variant_id: str) -> AccessVariant:
        for variant in self._variants:
            if variant.id == variant_id:
                return variant
        raise GateError(f"Unknown Mobile access variant {variant_id!r}")

    @staticmethod
    def _validate_evidence(
        variant: AccessVariant,
        evidence: Mapping[str, Any],
    ) -> dict[str, Any]:
        required_refs = (
            "buildAttestation",
            "freshInstallTrace",
            "installedBuildIdentity",
            "physicalDeviceLease",
            "providerAccountLease",
            "browserSessionLease",
            "mobileEvidence",
        )
        normalized = dict(evidence)
        for name in required_refs:
            value = normalized.get(name)
            if not isinstance(value, Mapping):
                raise GateError(
                    f"Mobile access variant {variant.id!r} is missing {name}"
                )
            try:
                ArtifactRef.from_dict(value)
            except Exception as error:
                raise GateError(
                    f"Mobile access variant {variant.id!r} has invalid {name}"
                ) from error
        snapshots = normalized.get("stationSnapshots")
        expected_services = (
            {variant.service_id, variant.alternate_service_id}
            if variant.operation == "station_mismatch"
            else {variant.service_id}
        )
        if not isinstance(snapshots, Mapping) or set(snapshots) != expected_services:
            raise GateError(
                f"Mobile access variant {variant.id!r} has incomplete Station snapshots"
            )
        for service_id, value in snapshots.items():
            if not isinstance(value, Mapping):
                raise GateError(
                    f"Mobile access variant {variant.id!r} has invalid "
                    f"Station snapshot for {service_id}"
                )
            ArtifactRef.from_dict(value)
        return normalized



class CapabilityClient(Protocol):
    def invoke(
        self,
        capability_id: str,
        operation: str,
        payload: Mapping[str, object],
        *,
        timeout_seconds: float,
    ) -> Mapping[str, object]:
        ...


def _invoke_capability(
    client: CapabilityClient,
    capability_id: str,
    operation: str,
    payload: Mapping[str, object],
    *,
    timeout_seconds: float = 120.0,
) -> dict[str, Any]:
    if operation not in CAPABILITY_OPERATIONS[capability_id]:
        raise GateError(
            f"Mobile Gate attempted undeclared operation {operation!r} "
            f"for capability {capability_id!r}"
        )
    try:
        response = client.invoke(
            capability_id,
            operation,
            payload,
            timeout_seconds=timeout_seconds,
        )
    except EphemeralCapabilityBlocked as error:
        raise MobileNativeBlocked(
            str(error),
            error.resource or f"ephemeral-capability:{capability_id}",
        ) from error
    if not isinstance(response, Mapping):
        raise GateError(
            f"Mobile capability {capability_id!r} returned an invalid response"
        )
    projected = dict(response)
    _assert_no_secret_fields(
        projected,
        f"capability.{capability_id}.{operation}",
    )
    return projected


def _response_artifact_ref(
    response: Mapping[str, Any],
    name: str,
    *,
    expected_path: str,
    expected_run_id: str,
    expected_workspace_id: str,
) -> ArtifactRef:
    return _artifact_ref(
        response,
        name,
        expected_path=expected_path,
        expected_run_id=expected_run_id,
        expected_workspace_id=expected_workspace_id,
    )


def _required_text(
    owner: Mapping[str, Any],
    name: str,
    resource: str,
) -> str:
    value = owner.get(name)
    if not isinstance(value, str) or not value.strip():
        raise MobileNativeBlocked(
            f"{resource} requires {name}",
            f"mobile-runtime:{resource.replace(' ', '-')}",
        )
    return value.strip()


def _required_object(
    owner: Mapping[str, Any],
    name: str,
    resource: str,
) -> dict[str, Any]:
    value = owner.get(name)
    if not isinstance(value, dict):
        raise MobileNativeBlocked(
            f"{resource} requires object {name}",
            f"mobile-runtime:{resource.replace(' ', '-')}",
        )
    return value


def _required_int(
    owner: Mapping[str, Any],
    name: str,
    resource: str,
) -> int:
    value = owner.get(name)
    if not isinstance(value, int) or value <= 0:
        raise MobileNativeBlocked(
            f"{resource} requires positive integer {name}",
            f"mobile-runtime:{resource.replace(' ', '-')}",
        )
    return value


def _artifact_ref(
    owner: Mapping[str, Any],
    name: str,
    *,
    expected_path: str,
    expected_run_id: str,
    expected_workspace_id: str,
    expected_gate_id: str = GATE_ID,
) -> ArtifactRef:
    raw_reference = owner.get(name)
    if not isinstance(raw_reference, Mapping):
        raise MobileNativeBlocked(
            f"Mobile runtime manifest requires ArtifactRef {name}",
            f"mobile-runtime:{name}",
        )
    try:
        reference = ArtifactRef.from_dict(raw_reference)
    except Exception as error:
        raise MobileNativeBlocked(
            f"Mobile runtime manifest has invalid ArtifactRef {name}",
            f"mobile-runtime:{name}",
        ) from error
    if (
        reference.workspace_id != expected_workspace_id
        or reference.gate_id != expected_gate_id
        or reference.run_id != expected_run_id
        or reference.path != expected_path
        or reference.media_type != "application/json"
    ):
        raise MobileNativeBlocked(
            f"Mobile runtime ArtifactRef {name} has mismatched identity",
            f"mobile-runtime:{name}",
        )
    return reference


def _load_contract_artifact(
    store: EvidenceStore,
    reference: ArtifactRef,
    expected_kind: str,
) -> dict[str, Any]:
    try:
        payload = store.read_json(reference)
        return validate_contract_payload(
            payload,
            expected_kind=expected_kind,
            expected_run_id=reference.run_id,
            expected_gate_id=reference.gate_id,
            expected_workspace_id=reference.workspace_id,
        )
    except Exception as error:
        raise MobileNativeBlocked(
            f"Mobile {expected_kind} artifact failed validation",
            f"mobile-runtime:{expected_kind}",
        ) from error


@dataclass(frozen=True)
class ClientEvidenceBinding:
    client_id: str
    platform: str
    provider: str
    service_id: str
    build_attestation_ref: ArtifactRef
    build_attestation: Mapping[str, Any]
    physical_device_lease_ref: ArtifactRef
    physical_device_lease: Mapping[str, Any]
    provider_account_lease_ref: ArtifactRef
    provider_account_lease: Mapping[str, Any]
    browser_session_lease_ref: ArtifactRef
    browser_session_lease: Mapping[str, Any]

    def runtime_context(
        self,
        services: Mapping[str, Any],
    ) -> dict[str, Any]:
        station_bindings = []
        for service_id in ("station-primary", "station-secondary"):
            service = _required_object(
                services,
                service_id,
                f"Mobile service {service_id}",
            )
            station_bindings.append(
                {
                    "serviceId": service_id,
                    "stationOrigin": _required_text(
                        service,
                        "endpoint",
                        f"Mobile service {service_id}",
                    ),
                    "stationPeerId": _required_text(
                        service,
                        "runtimeIdentity",
                        f"Mobile service {service_id}",
                    ),
                }
            )
        return {
            "build": {
                "buildId": self.build_attestation["buildIdentity"]["buildId"],
                "harnessEnabled": True,
            },
            "leases": [
                self._lease_binding(
                    self.physical_device_lease,
                    f"physical-device-lease/{self.client_id}",
                ),
                self._lease_binding(
                    self.provider_account_lease,
                    f"provider-account-lease/{self.provider}",
                ),
                self._lease_binding(
                    self.browser_session_lease,
                    f"browser-session-lease/{self.client_id}",
                ),
            ],
            "services": station_bindings,
        }

    @staticmethod
    def _lease_binding(
        lease: Mapping[str, Any],
        lease_ref: str,
    ) -> dict[str, Any]:
        expires_at = _required_text(lease, "expiresAt", lease_ref)
        try:
            expires_at_unix_ms = int(
                datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                .timestamp()
                * 1000
            )
        except ValueError as error:
            raise MobileNativeBlocked(
                f"{lease_ref} has invalid expiresAt",
                f"mobile-runtime:{lease_ref}",
            ) from error
        return {
            "leaseRef": lease_ref,
            "holderRunId": _required_text(lease, "holderRunId", lease_ref),
            "fenceToken": _required_int(lease, "fenceToken", lease_ref),
            "state": _required_text(lease, "state", lease_ref),
            "expiresAtUnixMs": expires_at_unix_ms,
        }


def _load_client_evidence_binding(
    store: EvidenceStore,
    resources: Mapping[str, Any],
    *,
    client_id: str,
    platform: str,
    provider: str,
    service_id: str,
    expected_run_id: str,
) -> ClientEvidenceBinding:
    source = _required_object(resources, "sourceArtifacts", "Mobile runtime manifest")
    applications = _required_object(
        source,
        "applications",
        "Mobile source artifacts",
    )
    clients = _required_object(source, "clients", "Mobile source artifacts")
    account_refs = _required_object(
        source,
        "providerAccountLeases",
        "Mobile source artifacts",
    )
    application = _required_object(
        applications,
        platform,
        f"Mobile source application {platform}",
    )
    client = _required_object(
        clients,
        client_id,
        f"Mobile source client {client_id}",
    )
    workspace_id = store.workspace_id
    build_ref = _artifact_ref(
        application,
        "buildAttestation",
        expected_path=f"runtime/mobile/builds/{platform}.json",
        expected_run_id=expected_run_id,
        expected_workspace_id=workspace_id,
    )
    device_ref = _artifact_ref(
        client,
        "physicalDeviceLease",
        expected_path=f"runtime/mobile/leases/devices/{client_id}.json",
        expected_run_id=expected_run_id,
        expected_workspace_id=workspace_id,
    )
    browser_ref = _artifact_ref(
        client,
        "browserSessionLease",
        expected_path=f"runtime/mobile/leases/browsers/{client_id}.json",
        expected_run_id=expected_run_id,
        expected_workspace_id=workspace_id,
    )
    account_ref = _artifact_ref(
        account_refs,
        provider,
        expected_path=f"runtime/mobile/leases/accounts/{provider}.json",
        expected_run_id=expected_run_id,
        expected_workspace_id=workspace_id,
    )
    build = _load_contract_artifact(
        store,
        build_ref,
        "mobile-application-build-attestation",
    )
    device = _load_contract_artifact(store, device_ref, "physical-device-lease")
    account = _load_contract_artifact(store, account_ref, "provider-account-lease")
    browser = _load_contract_artifact(
        store,
        browser_ref,
        "provider-browser-session-lease",
    )
    if (
        build["buildIdentity"]["platform"] != platform
        or device["clientId"] != client_id
        or device["platform"] != platform
        or account["provider"] != provider
        or client_id not in account["allowedClientIds"]
        or browser["clientId"] != client_id
        or browser["platform"] != platform
        or browser["physicalDeviceLeaseRef"]
        != f"physical-device-lease/{client_id}"
        or browser["providerAccountLeaseRef"]
        != f"provider-account-lease/{provider}"
    ):
        raise MobileNativeBlocked(
            f"Mobile source evidence graph is mismatched for {client_id}",
            f"mobile-runtime:source-evidence:{client_id}",
        )
    return ClientEvidenceBinding(
        client_id=client_id,
        platform=platform,
        provider=provider,
        service_id=service_id,
        build_attestation_ref=build_ref,
        build_attestation=build,
        physical_device_lease_ref=device_ref,
        physical_device_lease=device,
        provider_account_lease_ref=account_ref,
        provider_account_lease=account,
        browser_session_lease_ref=browser_ref,
        browser_session_lease=browser,
    )


def _assert_no_secret_fields(value: Any, path: str = "projection") -> None:
    if isinstance(value, Mapping):
        for key, item in value.items():
            if is_sensitive_key(key):
                raise MobileNativeBlocked(
                    f"Mobile Harness exposed secret-bearing field at {path}.{key}",
                    "mobile-runtime:harness-secret-boundary",
                )
            _assert_no_secret_fields(item, f"{path}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _assert_no_secret_fields(item, f"{path}[{index}]")


def _oauth_projection_summary(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise MobileNativeBlocked(
            "Mobile Harness OAuth projection must be an object",
            "mobile-runtime:oauth-readback",
        )
    _assert_no_secret_fields(value)
    decision = value.get("accessDecision")
    session = value.get("session")
    return {
        "phase": value.get("phase"),
        "provider": value.get("provider"),
        "result": value.get("result"),
        "errorCode": value.get("errorCode"),
        "stationPeerId": value.get("stationPeerId"),
        "accessAttemptId": value.get("accessAttemptId"),
        "oauthAttemptRef": value.get("oauthAttemptRef"),
        "gateId": value.get("gateId"),
        "lifecycleGeneration": value.get("lifecycleGeneration"),
        "expiresAtUnixMs": value.get("expiresAtUnixMs"),
        "candidatePtid": value.get("candidatePtid"),
        "accessDecision": {
            "state": decision.get("state"),
            "attemptId": decision.get("attemptId"),
            "currentGateId": decision.get("currentGateId"),
            "accessGrantId": decision.get("accessGrantId"),
        }
        if isinstance(decision, dict)
        else None,
        "session": {
            "actorPtid": session.get("actorPtid"),
            "expiresAt": session.get("expiresAt"),
        }
        if isinstance(session, dict)
        else None,
    }


def _mobile_projection_summary(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise MobileNativeBlocked(
            "Mobile Harness projection readback must be an object",
            "mobile-runtime:station-readback",
        )
    _assert_no_secret_fields(value)
    station = value.get("station")
    access = value.get("access")
    oauth = value.get("oauth")
    if not isinstance(station, dict) or not isinstance(access, dict) or not isinstance(oauth, dict):
        raise MobileNativeBlocked(
            "Mobile Harness projection requires station, access, and oauth objects",
            "mobile-runtime:station-readback",
        )
    decision = access.get("decision")
    access_session = access.get("session")
    oauth_session = oauth.get("session")
    return {
        "station": {
            "activeStationPeerId": station.get("activeStationPeerId"),
            "entries": station.get("entries"),
        },
        "access": {
            "decision": {
                "state": decision.get("state"),
                "attemptId": decision.get("attemptId"),
                "currentGateId": decision.get("currentGateId"),
                "accessGrantId": decision.get("accessGrantId"),
            }
            if isinstance(decision, dict)
            else None,
            "session": {
                "stationPeerId": access_session.get("stationPeerId"),
                "actorPtid": access_session.get("actorPtid"),
                "expiresAt": access_session.get("expiresAt"),
            }
            if isinstance(access_session, dict)
            else None,
            "loading": access.get("loading"),
            "errorKey": access.get("errorKey"),
            "restored": access.get("restored"),
        },
        "oauth": {
            "phase": oauth.get("phase"),
            "result": oauth.get("result"),
            "errorCode": oauth.get("errorCode"),
            "stationPeerId": oauth.get("stationPeerId"),
            "accessAttemptId": oauth.get("accessAttemptId"),
            "gateId": oauth.get("gateId"),
            "session": {
                "actorPtid": oauth_session.get("actorPtid"),
                "expiresAt": oauth_session.get("expiresAt"),
            }
            if isinstance(oauth_session, dict)
            else None,
        },
    }


def _begin_oauth(
    session: AppiumSession,
    *,
    station_url: str,
    provider: str,
    client_id: str,
) -> dict[str, Any]:
    station_result = session.call_action("station.add", {"url": station_url})
    access_result = session.call_action("access.submit", {"kind": "start"})
    decision = _required_object(
        access_result,
        "decision",
        f"Access start result for {client_id}",
    )
    access_attempt_id = _required_text(
        decision,
        "attemptId",
        f"Access start result for {client_id}",
    )
    gate_id = _required_text(
        decision,
        "currentGateId",
        f"Access start result for {client_id}",
    )
    oauth_result = session.call_action(
        "oauth.start",
        {
            "provider": provider,
            "accessAttemptId": access_attempt_id,
            "gateId": gate_id,
        },
    )
    projection = _oauth_projection_summary(oauth_result)
    if (
        projection.get("accessAttemptId") != access_attempt_id
        or projection.get("gateId") != gate_id
        or projection.get("provider") != provider
    ):
        raise GateError(
            f"OAuth start correlation failed for Mobile client {client_id!r}"
        )
    return {
        "station": station_result,
        "access": access_result,
        "oauth": projection,
    }


def _fixture_target(
    oauth_projection: Mapping[str, Any],
    *,
    service_id: str,
    client_id: str,
) -> dict[str, Any]:
    access_attempt_ref = _required_text(
        oauth_projection,
        "accessAttemptId",
        f"OAuth Fixture binding for {client_id}",
    )
    oauth_attempt_ref = _required_text(
        oauth_projection,
        "oauthAttemptRef",
        f"OAuth Fixture binding for {client_id}",
    )
    lifecycle_generation = _required_int(
        oauth_projection,
        "lifecycleGeneration",
        f"OAuth Fixture binding for {client_id}",
    )
    return {
        "serviceId": service_id,
        "oauthAttemptRef": oauth_attempt_ref,
        "accessAttemptRef": access_attempt_ref,
        "deviceAlias": client_id,
        "lifecycleGeneration": lifecycle_generation,
    }


def _negative_oauth_intent(
    variant: AccessVariant,
    binding: ClientEvidenceBinding,
    *,
    run_id: str,
    callback_replay_handle: str = "",
) -> dict[str, Any]:
    intent = {
        "artifactKind": "mobile-oauth-negative-callback-intent",
        "runId": run_id,
        "gateId": GATE_ID,
        "variantId": variant.id,
        "clientId": variant.client_id,
        "operation": variant.operation,
        "requiredLeaseRefs": [
            f"physical-device-lease/{variant.client_id}",
            f"provider-account-lease/{variant.provider}",
            f"browser-session-lease/{variant.client_id}",
        ],
        "holderRunId": run_id,
        "fenceTokens": {
            "physicalDevice": binding.physical_device_lease["fenceToken"],
            "providerAccount": binding.provider_account_lease["fenceToken"],
            "browserSession": binding.browser_session_lease["fenceToken"],
        },
        "callbackReplayHandle": callback_replay_handle,
        "replayMode": (
            "different_after_claim" if variant.operation == "replay" else ""
        ),
        "alternateServiceId": variant.alternate_service_id,
        "expectedFailure": variant.expected_failure,
    }
    try:
        return validate_contract_payload(
            intent,
            expected_kind="mobile-oauth-negative-callback-intent",
            expected_run_id=run_id,
            expected_gate_id=GATE_ID,
            expected_workspace_id=binding.build_attestation_ref.workspace_id,
            durable=False,
        )
    except ProofContractError as error:
        raise GateError(
            f"Mobile negative OAuth intent is invalid for {variant.id!r}"
        ) from error


def _assert_fail_closed_projection(
    variant: AccessVariant,
    result: Any,
) -> dict[str, Any]:
    if not isinstance(result, Mapping):
        raise GateError(
            f"Mobile negative OAuth result is invalid for {variant.id!r}"
        )
    projection = result.get("projection")
    if (
        result.get("operation") != variant.operation
        or result.get("failure") != variant.expected_failure
        or not isinstance(projection, Mapping)
        or projection.get("phase") != variant.expected_phase
        or projection.get("sessionPresent") is not False
    ):
        raise GateError(
            f"Mobile negative OAuth result is not fail-closed for {variant.id!r}"
        )
    _assert_no_secret_fields(result, f"variant.{variant.id}")
    return dict(result)


class MobileNativeGate(AcceptanceGate):
    def __init__(
        self,
        scenario: str,
        *,
        capability_client: CapabilityClient | None = None,
    ) -> None:
        self.scenario = scenario
        self.gate_id = SCENARIO_GATES[scenario]
        super().__init__()
        self.capability_client = capability_client
        self.lifecycle: list[dict[str, Any]] = []
        self.access_variant_ledger = AccessVariantLedger()

    def run(self) -> dict[str, Any]:
        raise GateError(
            "MobileNativeGate uses its evidence-aware execute entrypoint"
        )

    def execute(self) -> int:
        with ArtifactSession(
            repo_root=REPO_ROOT,
            gate_id=self.gate_id,
        ) as artifacts:
            status = "FAIL"
            completion_status = "PARTIAL"
            proof_status = "UNPROVEN"
            result: dict[str, Any]
            final_inputs_written = False
            try:
                if self.scenario == "access":
                    result = self._run_access(artifacts)
                    self._write_final_judgment_inputs(artifacts, result)
                    final_inputs_written = True
                    self._validate_final_artifact_roles(artifacts)
                elif self.scenario == "lifecycle":
                    result = self._run_lifecycle(artifacts)
                elif self.scenario == "platform":
                    result = self._run_platform(artifacts)
                else:
                    raise MobileNativeBlocked(
                        f"Mobile native scenario {self.scenario!r} is not implemented",
                        f"mobile-scenario:{self.scenario}",
                    )
                result.update(
                    {
                        "status": "PASS",
                        "completionStatus": "DONE",
                        "proofStatus": "PROVEN",
                    }
                )
                status = "PASS"
                completion_status = "DONE"
                proof_status = "PROVEN"
                exit_code = 0
            except MobileNativeBlocked as error:
                status = "BLOCKED"
                result = self._result_base("BLOCKED")
                result.update(
                    {
                    "blockedReason": error.reason,
                    "blockedResource": error.resource,
                    }
                )
                if error.evidence_gaps:
                    result["evidenceGaps"] = error.evidence_gaps
                completion_status = "BLOCKED"
                exit_code = 2
            except (
                DriverError,
                EvidenceError,
                GateError,
                ProofContractError,
                ProvisioningError,
            ) as error:
                result = self._result_base("FAIL")
                result["reason"] = str(error)
                exit_code = 1
            if self.scenario == "access":
                result["variantLedger"] = self.access_variant_ledger.as_dict()
            if self.scenario == "access" and not final_inputs_written:
                self._write_final_judgment_inputs(artifacts, result)
            artifacts.write_json(
                "reports/mobile-native-gate-report.json",
                result,
            )
            artifacts.complete(
                status=status,
                completion_status=completion_status,
                proof_status=proof_status,
                runtime={
                    "scenario": self.scenario,
                    "clientCount": len(
                        {
                            event["clientId"]
                            for event in self.lifecycle
                            if event.get("clientId")
                        }
                    ),
                },
            )
        if exit_code == 0:
            sys.stdout.write(f"PASS: {self.gate_id}\n")
        else:
            sys.stderr.write(
                f"{result['status']}: {self.gate_id}: "
                f"{result.get('blockedReason') or result.get('reason')}\n"
            )
        return exit_code

    def _result_base(self, status: str) -> dict[str, Any]:
        metadata = SCENARIO_METADATA[self.scenario]
        return {
            "artifactKind": "acceptance-gate-evidence-report",
            "gateId": self.gate_id,
            "gate": self.gate_id,
            "scenario": self.scenario,
            "environment": "mobile-native",
            "runtimeCell": "ios-and-android-physical",
            "status": status,
            "completionStatus": (
                "DONE"
                if status == "PASS"
                else "BLOCKED"
                if status == "BLOCKED"
                else "PARTIAL"
            ),
            "proofStatus": "PROVEN" if status == "PASS" else "UNPROVEN",
            "phase": metadata["phase"],
            "bom": list(metadata["bom"]),
            "spec": list(metadata["spec"]),
            "observedScope": (
                list(metadata["observed"]) if status == "PASS" else []
            ),
            "unprovenScope": list(metadata["unproven"]),
            "physicalDeviceClaimed": status == "PASS",
            "sampleEmissionAllowed": status == "PASS",
            "sourcePhase": metadata["phase"],
            "sourceBom": list(metadata["bom"]),
            "sourceSpec": list(metadata["spec"]),
            "sourceGate": self.gate_id,
        }

    def _write_final_judgment_inputs(
        self,
        artifacts: ArtifactSession,
        result: Mapping[str, Any],
    ) -> None:
        artifacts.write_json(
            "reports/mobile-native-lifecycle.json",
            {
                "artifactKind": "mobile-native-lifecycle",
                "runId": artifacts.run_id,
                "gateId": self.gate_id,
                "events": self.lifecycle,
            },
            role="mobile-native-lifecycle",
        )
        claim_neutral_result = dict(result)
        claim_neutral_result.pop("status", None)
        claim_neutral_result.pop("completionStatus", None)
        claim_neutral_result.pop("proofStatus", None)
        claim_neutral_result.update(
            {
                "artifactKind": "mobile-native-result",
                "runId": artifacts.run_id,
                "gateId": self.gate_id,
            }
        )
        artifacts.write_json(
            "reports/mobile-native-result.json",
            claim_neutral_result,
            role="mobile-native-result",
        )

    def _validate_final_artifact_roles(
        self,
        artifacts: ArtifactSession,
    ) -> None:
        run_dir = current_run_directory(repo_root=REPO_ROOT)
        role_dir = run_dir / ".artifact-roles"
        if role_dir.is_symlink() or not role_dir.is_dir():
            raise ProofContractError(
                "Evidence Store role-instance inventory is unavailable"
            )
        role_inventory: dict[str, Mapping[str, Any]] = {}
        for metadata_path in sorted(role_dir.glob("*.json")):
            if metadata_path.is_symlink():
                raise ProofContractError(
                    "Evidence Store role-instance metadata must not be a symlink"
                )
            try:
                metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
                raise ProofContractError(
                    "Evidence Store role-instance metadata is malformed"
                ) from error
            if not isinstance(metadata, Mapping):
                raise ProofContractError(
                    "Evidence Store role-instance metadata must be an object"
                )
            role_instance = metadata.get("role")
            reference = metadata.get("artifact")
            if (
                not isinstance(role_instance, str)
                or not role_instance
                or not isinstance(reference, Mapping)
            ):
                raise ProofContractError(
                    "Evidence Store role-instance metadata is incomplete"
                )
            if role_instance in role_inventory:
                raise ProofContractError(
                    f"duplicate Evidence Store Artifact Role {role_instance!r}"
                )
            role_inventory[role_instance] = reference

        evidence_manifest = {
            "workspaceId": artifacts.store.workspace_id,
            "gateId": self.gate_id,
            "runId": artifacts.run_id,
            "artifacts": role_inventory,
        }
        records = artifact_records_from_evidence_manifest(
            evidence_manifest,
            payload_loader=artifacts.store.read_json,
        )
        validate_artifact_roles(
            records,
            expected_run_id=artifacts.run_id,
            expected_gate_id=self.gate_id,
            expected_workspace_id=artifacts.store.workspace_id,
        )

    def _start_device_scenario_sessions(
        self,
        artifacts: ArtifactSession,
        manifest: Mapping[str, Any],
    ) -> dict[str, AppiumSession]:
        if self.capability_client is None:
            raise MobileNativeBlocked(
                "Mobile native Gate requires the Appium launch capability",
                "mobile-runtime:ephemeral-launch-context",
            )
        resources = _required_object(
            manifest,
            "mobileNative",
            "Mobile runtime manifest",
        )
        if resources.get("scenario") != self.scenario:
            raise MobileNativeBlocked(
                "Mobile runtime manifest scenario does not match the Gate",
                "mobile-runtime:scenario",
            )
        source = _required_object(
            resources,
            "sourceArtifacts",
            "Mobile runtime manifest",
        )
        applications = _required_object(
            source,
            "applications",
            "Mobile source artifacts",
        )
        source_clients = _required_object(
            source,
            "clients",
            "Mobile source artifacts",
        )
        clients = _required_object(
            resources,
            "clients",
            "Mobile runtime manifest",
        )
        if set(clients) != set(source_clients) or len(clients) != 2:
            raise MobileNativeBlocked(
                "Mobile physical scenario requires exactly one client per platform",
                "mobile-runtime:scenario-clients",
            )
        platforms = {
            _required_text(client, "platform", f"Mobile client {client_id}")
            for client_id, client in clients.items()
        }
        if platforms != {"ios", "android"}:
            raise MobileNativeBlocked(
                "Mobile physical scenario requires iOS and Android clients",
                "mobile-runtime:scenario-platforms",
            )
        harness = _required_object(
            resources,
            "harness",
            "Mobile runtime manifest",
        )
        required_actions = harness.get("requiredActions")
        if not isinstance(required_actions, list) or any(
            not isinstance(action, str) or not action
            for action in required_actions
        ):
            raise MobileNativeBlocked(
                "Mobile runtime manifest has invalid Harness actions",
                "mobile-runtime:harness-actions",
            )

        sessions: dict[str, AppiumSession] = {}
        for client_id, client in clients.items():
            platform = _required_text(
                client,
                "platform",
                f"Mobile client {client_id}",
            )
            application = _required_object(
                applications,
                platform,
                f"Mobile source application {platform}",
            )
            source_client = _required_object(
                source_clients,
                client_id,
                f"Mobile source client {client_id}",
            )
            build_ref = _artifact_ref(
                application,
                "buildAttestation",
                expected_path=f"runtime/mobile/builds/{platform}.json",
                expected_run_id=artifacts.run_id,
                expected_workspace_id=artifacts.store.workspace_id,
                expected_gate_id=self.gate_id,
            )
            physical_device_ref = _artifact_ref(
                source_client,
                "physicalDeviceLease",
                expected_path=(
                    f"runtime/mobile/leases/devices/{client_id}.json"
                ),
                expected_run_id=artifacts.run_id,
                expected_workspace_id=artifacts.store.workspace_id,
                expected_gate_id=self.gate_id,
            )
            callback_scheme = _required_text(
                _required_object(
                    resources["applications"],
                    platform,
                    f"Mobile application {platform}",
                ),
                "callbackScheme",
                f"Mobile application {platform}",
            )
            session = AppiumSession(
                self.capability_client,  # type: ignore[arg-type]
                client_id=client_id,
                platform=platform,
                physical_device_lease=physical_device_ref,
                build_attestation=build_ref,
                callback_scheme=callback_scheme,
                gate_id=self.gate_id,
            )
            try:
                session.start()
                session.wait_for_ready()
                session.switch_to_native()
                session.verify_installed_build_identity(
                    session.fresh_install_trace
                )
                session.switch_to_app_webview()
                session.require_harness(required_actions)
            except DriverError as error:
                raise MobileNativeBlocked(
                    f"Mobile client {client_id!r} failed physical preflight",
                    f"mobile-runtime:physical-client:{client_id}",
                ) from error
            self._record_lifecycle(client_id, "physical-harness-ready")
            sessions[client_id] = session

        source_identity = _required_object(
            manifest,
            "source",
            "Mobile runtime manifest",
        )
        artifacts.write_json(
            f"mobile/{self.scenario}/source-identity.json",
            {
                "artifactKind": "mobile-native-scenario-source-identity",
                "gateId": self.gate_id,
                "scenario": self.scenario,
                "source": source_identity,
                "builds": {
                    platform: application["buildAttestation"]
                    for platform, application in applications.items()
                },
            },
            role=f"mobile-native-{self.scenario}-source-identity",
        )
        return sessions

    def _run_lifecycle(self, artifacts: ArtifactSession) -> dict[str, Any]:
        manifest = self._load_manifest()
        sessions = self._start_device_scenario_sessions(artifacts, manifest)
        clients: dict[str, Any] = {}
        for client_id, session in sessions.items():
            initial = validate_lifecycle_snapshot(
                session.call_action("lifecycle.snapshot"),
                expected_phase="ACTIVE",
            )
            previous = initial
            cycles: list[dict[str, int]] = []
            for cycle in range(LIFECYCLE_CYCLES):
                session.switch_to_native()
                session.background_app(1.0)
                session.switch_to_app_webview()
                resumed = validate_lifecycle_snapshot(
                    session.call_action("lifecycle.snapshot"),
                    expected_phase="ACTIVE",
                    minimum_generation=int(previous["generation"]) + 1,
                    expected_boot_order=list(initial["bootOrder"]),
                )
                cycles.append(
                    {
                        "cycle": cycle + 1,
                        "resumedGeneration": int(resumed["generation"]),
                    }
                )
                previous = resumed
            restart = session.call_action("lifecycle.restart")
            if restart != {"requested": True, "scope": "webview"}:
                raise GateError("lifecycle.restart returned invalid data")
            restarted = validate_lifecycle_snapshot(
                session.call_action("lifecycle.snapshot"),
                expected_phase="ACTIVE",
                minimum_generation=int(previous["generation"]) + 1,
                expected_boot_order=list(initial["bootOrder"]),
            )
            session.switch_to_native()
            accessibility = session.capture_native_accessibility()
            screenshot = session.capture_screenshot("lifecycle-final")
            session.switch_to_app_webview()
            dom = session.capture_web_dom("lifecycle-final")
            clients[client_id] = {
                "platform": session.platform,
                "initial": initial,
                "cycles": cycles,
                "restarted": restarted,
                "accessibility": accessibility.to_dict(),
                "screenshot": screenshot.to_dict(),
                "dom": dom.to_dict(),
            }
        return {**self._result_base("PASS"), "clients": clients}

    def _run_platform(self, artifacts: ArtifactSession) -> dict[str, Any]:
        manifest = self._load_manifest()
        sessions = self._start_device_scenario_sessions(artifacts, manifest)
        clients: dict[str, Any] = {}
        for client_id, session in sessions.items():
            started = time.monotonic()
            inventory = session.call_action("platform.permission.checkAll")
            if not isinstance(inventory, list):
                raise GateError("platform permission inventory is invalid")
            by_kind = {
                item.get("kind"): dict(item)
                for item in inventory
                if isinstance(item, Mapping)
            }
            if set(by_kind) != set(PLATFORM_PERMISSION_KINDS):
                raise GateError("platform permission inventory is incomplete")
            permissions: dict[str, Any] = {}
            for kind in PLATFORM_PERMISSION_KINDS:
                before = session.call_action(
                    "platform.permission.check",
                    {"kind": kind},
                )
                if not isinstance(before, Mapping):
                    raise GateError(
                        f"platform permission {kind!r} check is invalid"
                    )
                requested: Mapping[str, Any] | None = None
                if before.get("canRequest") is True:
                    value = session.call_action(
                        "platform.permission.request",
                        {"kind": kind},
                    )
                    if not isinstance(value, Mapping):
                        raise GateError(
                            f"platform permission {kind!r} request is invalid"
                        )
                    requested = value
                after = session.call_action(
                    "platform.permission.check",
                    {"kind": kind},
                )
                if (
                    not isinstance(after, Mapping)
                    or after.get("kind") != kind
                    or after.get("status") != "granted"
                ):
                    raise MobileNativeBlocked(
                        f"Platform permission {kind!r} has no physical result",
                        f"mobile-runtime:permission:{client_id}:{kind}",
                    )
                permissions[kind] = {
                    "before": dict(before),
                    "request": dict(requested) if requested else None,
                    "after": dict(after),
                }
            network = session.call_action("platform.network.read")
            if not isinstance(network, Mapping):
                raise GateError("platform network readback is invalid")
            lifecycle = validate_lifecycle_snapshot(
                session.call_action("lifecycle.snapshot"),
                expected_phase="ACTIVE",
            )
            session.switch_to_native()
            accessibility = session.capture_native_accessibility()
            screenshot = session.capture_screenshot("platform-final")
            session.switch_to_app_webview()
            dom = session.capture_web_dom("platform-final")
            clients[client_id] = {
                "platform": session.platform,
                "permissions": permissions,
                "network": dict(network),
                "lifecycle": lifecycle,
                "diagnosticElapsedMs": round(
                    (time.monotonic() - started) * 1000
                ),
                "accessibility": accessibility.to_dict(),
                "screenshot": screenshot.to_dict(),
                "dom": dom.to_dict(),
            }
        return {**self._result_base("PASS"), "clients": clients}

    def _run_access(self, artifacts: ArtifactSession) -> dict[str, Any]:
        manifest = self._load_manifest()
        resources = _required_object(
            manifest,
            "mobileNative",
            "Mobile runtime manifest",
        )
        _required_text(manifest, "runId", "Mobile runtime manifest")
        source_bindings = {
            client_id: _load_client_evidence_binding(
                artifacts.store,
                resources,
                client_id=client_id,
                platform=CLIENT_PLATFORM[client_id],
                provider=CLIENT_PROVIDER[client_id],
                service_id=CLIENT_SERVICE[client_id],
                expected_run_id=artifacts.run_id,
            )
            for client_id in ACCESS_ASSIGNMENTS
        }
        if self.capability_client is None:
            raise MobileNativeBlocked(
                "Mobile native Gate requires EphemeralGateLaunchContext",
                "mobile-runtime:ephemeral-launch-context",
                evidence_gaps=[
                    {
                        "variantId": variant.id,
                        "platform": variant.platform,
                        "requiredCell": variant.required_cell,
                        "status": "BLOCKED",
                        "reason": "ephemeral Mobile capability binding is unavailable",
                    }
                    for variant in REQUIRED_ACCESS_VARIANTS
                ],
            )
        harness = _required_object(
            resources,
            "harness",
            "Mobile runtime manifest",
        )
        applications = _required_object(
            resources,
            "applications",
            "Mobile runtime manifest",
        )
        required_actions = harness.get("requiredActions")
        if not isinstance(required_actions, list) or any(
            not isinstance(action, str) for action in required_actions
        ):
            raise MobileNativeBlocked(
                "Mobile runtime manifest has invalid Harness actions",
                "mobile-runtime:harness-actions",
            )

        actor_manifest = self._load_actor_manifest(
            artifacts.store,
            manifest.get("actorManifest"),
        )
        source = _required_object(manifest, "source", "Mobile runtime manifest")
        artifacts.write_json(
            "mobile/source-identity.json",
            {
                "artifactKind": "mobile-native-source-identity",
                "gate": self.gate_id,
                "source": source,
                "services": manifest["services"],
            },
            role="mobile-source-identity",
        )

        sessions: dict[str, AppiumSession] = {}
        for client_id, binding in source_bindings.items():
            application = _required_object(
                applications,
                binding.platform,
                f"Mobile application {binding.platform}",
            )
            session = AppiumSession(
                self.capability_client,  # type: ignore[arg-type]
                client_id=client_id,
                platform=binding.platform,
                physical_device_lease=binding.physical_device_lease_ref,
                build_attestation=binding.build_attestation_ref,
                callback_scheme=_required_text(
                    application,
                    "callbackScheme",
                    f"Mobile application {binding.platform}",
                ),
            )
            try:
                session.start()
                session.wait_for_ready()
                session.switch_to_native()
                session.verify_installed_build_identity(
                    session.fresh_install_trace
                )
            except DriverError as error:
                raise MobileNativeBlocked(
                    f"Mobile client {client_id!r} cannot start an isolated Appium session",
                    f"mobile-runtime:appium-session:{client_id}",
                ) from error
            self._record_lifecycle(client_id, "session-created")
            session.capture_native_accessibility()
            try:
                webview = session.switch_to_app_webview()
                inventory = session.require_harness(list(required_actions))
            except DriverError as error:
                raise MobileNativeBlocked(
                    f"Mobile client {client_id!r} has no usable Acceptance Harness",
                    f"mobile-runtime:harness:{client_id}",
                ) from error
            self._record_lifecycle(client_id, "webview-selected")
            self._record_lifecycle(client_id, "harness-ready")
            self._record_lifecycle(client_id, "build-identity-verified")
            sessions[client_id] = session

        try:
            execution_order = {
                "cancel": 0,
                "following_gate": 1,
                "expiry": 2,
                "provider_mismatch": 3,
                "station_mismatch": 4,
                "replay": 5,
                "success": 6,
            }
            for variant in sorted(
                REQUIRED_ACCESS_VARIANTS,
                key=lambda item: (
                    item.client_id,
                    execution_order[item.operation],
                    item.id,
                ),
            ):
                evidence = self._run_access_variant(
                    artifacts,
                    manifest=manifest,
                    actor_manifest=actor_manifest,
                    variant=variant,
                    session=sessions[variant.client_id],
                    binding=source_bindings[variant.client_id],
                )
                self.access_variant_ledger.mark_passed(variant.id, evidence)

            artifacts.write_json(
                "mobile/oauth-variant-ledger.json",
                self.access_variant_ledger.as_dict(),
                role="mobile-oauth-variant-ledger",
            )
            self.access_variant_ledger.require_proven()
        finally:
            self._purge_native_oauth(artifacts, sessions)
        return {
            **self._result_base("PASS"),
            "clients": sorted(sessions),
            "providers": sorted(set(CLIENT_PROVIDER.values())),
        }

    def _purge_native_oauth(
        self,
        artifacts: ArtifactSession,
        sessions: Mapping[str, AppiumSession],
    ) -> None:
        for client_id in sorted(sessions):
            session = sessions[client_id]
            session.switch_to_app_webview(timeout=5)
            raw_result = session.call_action(PRODUCTION_OAUTH_PURGE_ACTION)
            result = self._secure_storage_absence_result(client_id, raw_result)
            artifacts.write_json(
                f"evidence/mobile/cleanup/secure-storage/{client_id}.json",
                {
                    "artifactKind": "mobile-secure-storage-absence",
                    "runId": artifacts.run_id,
                    "gateId": self.gate_id,
                    "clientId": client_id,
                    "platform": CLIENT_PLATFORM[client_id],
                    **result,
                },
                role=f"mobile-secure-storage-absence/{client_id}",
            )
            self._record_lifecycle(client_id, "oauth.purge-absence-persisted")

    @staticmethod
    def _secure_storage_absence_result(
        client_id: str,
        value: Any,
    ) -> dict[str, Any]:
        if not isinstance(value, Mapping):
            raise GateError(
                f"Mobile OAuth purge for {client_id!r} returned an invalid result"
            )
        result = _required_object(
            value,
            "oauthPurge",
            f"Mobile OAuth purge result for {client_id}",
        )
        station_revocation = result.get("stationRevocation")
        if station_revocation not in {
            "not_required",
            "confirmed",
            "unconfirmed",
        }:
            raise GateError(
                f"Mobile OAuth purge for {client_id!r} has invalid Station revocation"
            )
        secure_storage = _required_object(
            result,
            "secureStorage",
            f"Mobile OAuth purge result for {client_id}",
        )
        if any(
            secure_storage.get(field) is not True
            for field in SECURE_STORAGE_ABSENCE_FIELDS
        ):
            raise GateError(
                f"Mobile OAuth purge for {client_id!r} did not prove "
                "secure-storage absence"
            )
        if (
            value.get("webSessionProjectionCleared") is not True
            or value.get("stationRegistryCleared") is not True
        ):
            raise GateError(
                f"Mobile OAuth purge for {client_id!r} did not clear "
                "public projections"
            )
        return {
            "stationRevocation": station_revocation,
            "secureStorage": {
                field: True for field in SECURE_STORAGE_ABSENCE_FIELDS
            },
            "webSessionProjectionCleared": True,
            "stationRegistryCleared": True,
        }

    def _run_access_variant(
        self,
        artifacts: ArtifactSession,
        *,
        manifest: Mapping[str, Any],
        actor_manifest: Mapping[str, Any],
        variant: AccessVariant,
        session: AppiumSession,
        binding: ClientEvidenceBinding,
    ) -> dict[str, Any]:
        service = require_runtime_service(manifest, variant.service_id, "station")
        station_url = _required_text(service, "endpoint", variant.service_id)
        started = _begin_oauth(
            session,
            station_url=station_url,
            provider=variant.provider,
            client_id=variant.client_id,
        )
        self._record_lifecycle(variant.client_id, f"{variant.id}:oauth.start")
        fixture_target = _fixture_target(
            started["oauth"],
            service_id=variant.service_id,
            client_id=variant.client_id,
        )

        if variant.operation == "cancel":
            projection = _oauth_projection_summary(
                session.call_action("oauth.cancel")
            )
            self._require_terminal_projection(variant, projection)
        elif variant.operation == "following_gate":
            self._station_operation(
                "prepare_following_gate",
                variant,
                fixture_target,
            )
            self._authorize_provider(variant)
            projection = self._await_access_phase(
                session,
                expected_phase=variant.expected_phase,
            )
        elif variant.operation == "expiry":
            self._station_operation(
                "expire_awaiting_attempt",
                variant,
                fixture_target,
            )
            projection = self._await_access_phase(
                session,
                expected_phase=variant.expected_phase,
            )
        elif variant.operation == "success":
            self._authorize_provider(variant)
            projection = self._await_access_phase(
                session,
                expected_phase=variant.expected_phase,
            )
        else:
            if variant.operation == "replay":
                self._authorize_provider(variant)
                self._await_access_phase(
                    session,
                    expected_phase="active_session",
                )
                intent = _negative_oauth_intent(
                    variant,
                    binding,
                    run_id=binding.build_attestation_ref.run_id,
                    callback_replay_handle="parent-owned-replay-handle",
                )
                negative_result = session.call_negative_callback(
                    replay_payload={
                        "runId": binding.build_attestation_ref.run_id,
                        "gateId": GATE_ID,
                        "clientId": variant.client_id,
                        "context": binding.runtime_context(manifest["services"]),
                    },
                    negative_payload={
                        "context": binding.runtime_context(
                            manifest["services"]
                        ),
                        "intent": intent,
                    },
                )
            else:
                intent = _negative_oauth_intent(
                    variant,
                    binding,
                    run_id=binding.build_attestation_ref.run_id,
                )
                negative_result = session.call_negative_callback(
                    replay_payload=None,
                    negative_payload={
                        "context": binding.runtime_context(
                            manifest["services"]
                        ),
                        "intent": intent,
                    },
                )
            projection = _assert_fail_closed_projection(
                variant,
                negative_result,
            )["projection"]

        readback = _mobile_projection_summary(
            session.call_action("projection.read")
        )
        if variant.operation == "success":
            self._verify_access_readback(
                readback,
                projection,
                actor_manifest,
                variant.service_id,
                variant.client_id.split("-", 1)[0],
                started["station"],
            )
        dom_ref = session.capture_web_dom(variant.id)
        screenshot_ref = session.capture_screenshot(variant.id)
        mobile_evidence_ref = artifacts.write_json(
            (
                f"evidence/mobile/{variant.id}/"
                f"{variant.client_id}/projection.json"
            ),
            {
                "artifactKind": "mobile-visible-proof",
                "runId": artifacts.run_id,
                "gateId": self.gate_id,
                "variantId": variant.id,
                "clientId": variant.client_id,
                "platform": variant.platform,
                "projection": projection,
                "readback": readback,
                "dom": dom_ref.to_dict(),
                "screenshot": screenshot_ref.to_dict(),
            },
            role=f"mobile-visible-proof/{variant.id}",
        )
        station_snapshots = self._read_station_snapshots(
            artifacts.store,
            variant,
            fixture_target,
            expected_run_id=binding.build_attestation_ref.run_id,
        )
        self._record_lifecycle(variant.client_id, f"{variant.id}:evidence")

        return {
            "buildAttestation": binding.build_attestation_ref.to_dict(),
            "freshInstallTrace": session.fresh_install_trace.to_dict(),
            "installedBuildIdentity": (
                session.installed_build_identity.to_dict()
            ),
            "physicalDeviceLease": binding.physical_device_lease_ref.to_dict(),
            "providerAccountLease": binding.provider_account_lease_ref.to_dict(),
            "browserSessionLease": binding.browser_session_lease_ref.to_dict(),
            "mobileEvidence": mobile_evidence_ref.to_dict(),
            "stationSnapshots": {
                service_id: reference.to_dict()
                for service_id, reference in station_snapshots.items()
            },
        }

    def _authorize_provider(self, variant: AccessVariant) -> None:
        if self.capability_client is None:
            raise GateError("Mobile capability client is unavailable")
        response = _invoke_capability(
            self.capability_client,
            PROVIDER_CAPABILITY,
            "authorize",
            {
                "clientId": variant.client_id,
                "provider": variant.provider,
            },
            timeout_seconds=180.0,
        )
        if response.get("authorized") is not True:
            raise GateError(
                f"Provider authorization did not complete for {variant.id!r}"
            )
        self._record_lifecycle(
            variant.client_id,
            f"{variant.id}:provider.authorize",
        )

    def _station_operation(
        self,
        operation: str,
        variant: AccessVariant,
        target: Mapping[str, Any],
    ) -> None:
        if self.capability_client is None:
            raise GateError("Mobile capability client is unavailable")
        response = _invoke_capability(
            self.capability_client,
            STATION_FIXTURE_CAPABILITY,
            operation,
            {
                "operationId": f"{variant.id}-{operation}",
                "variantId": variant.id,
                "clientId": variant.client_id,
                "serviceId": variant.service_id,
                "target": dict(target),
                "expectedProvider": variant.provider,
            },
        )
        if response.get("completed") is not True:
            raise GateError(
                f"Station Fixture operation did not complete for {variant.id!r}"
            )

    def _read_station_snapshots(
        self,
        store: EvidenceStore,
        variant: AccessVariant,
        target: Mapping[str, Any],
        *,
        expected_run_id: str,
    ) -> dict[str, ArtifactRef]:
        if self.capability_client is None:
            raise GateError("Mobile capability client is unavailable")
        service_ids = [variant.service_id]
        if variant.alternate_service_id:
            service_ids.append(variant.alternate_service_id)
        snapshots: dict[str, ArtifactRef] = {}
        for service_id in service_ids:
            response = _invoke_capability(
                self.capability_client,
                STATION_FIXTURE_CAPABILITY,
                "read_proof_snapshot",
                {
                    "operationId": f"{variant.id}-proof-{service_id}",
                    "variantId": variant.id,
                    "clientId": variant.client_id,
                    "serviceId": service_id,
                    "snapshotPhase": "post_action",
                    "target": dict(target),
                    "expectedProvider": variant.provider,
                },
            )
            reference = _response_artifact_ref(
                response,
                "artifactRef",
                expected_path=(
                    f"evidence/mobile/{variant.id}/station/{service_id}.json"
                ),
                expected_run_id=expected_run_id,
                expected_workspace_id=store.workspace_id,
            )
            _load_contract_artifact(
                store,
                reference,
                "station-oauth-proof-snapshot",
            )
            snapshots[service_id] = reference
        return snapshots

    @staticmethod
    def _require_terminal_projection(
        variant: AccessVariant,
        projection: Mapping[str, Any],
    ) -> None:
        if (
            projection.get("phase") != variant.expected_phase
            or projection.get("session") is not None
        ):
            raise GateError(
                f"OAuth variant {variant.id!r} did not fail closed"
            )

    def _load_manifest(self) -> dict[str, Any]:
        manifest_path = os.environ.get("PT_ACCEPTANCE_RUNTIME_MANIFEST", "")
        if not manifest_path:
            raise MobileNativeBlocked(
                "PT_ACCEPTANCE_RUNTIME_MANIFEST is required",
                "mobile-runtime:manifest",
            )
        try:
            manifest = load_runtime_manifest(Path(manifest_path), self.gate_id)
            if self.scenario == "access":
                require_runtime_service(manifest, "station-primary", "station")
                require_runtime_service(manifest, "station-secondary", "station")
                require_runtime_service(manifest, "relay", "relay")
            elif (
                manifest.get("services") != {}
                or manifest.get("credentialRefs") != []
                or "actorManifest" in manifest
            ):
                raise ProvisioningError(
                    "non-access Mobile scenario inherited access resources"
                )
        except ProvisioningError as error:
            raise MobileNativeBlocked(
                str(error),
                "mobile-runtime:manifest",
            ) from error
        return manifest

    def _load_actor_manifest(
        self,
        store: EvidenceStore,
        raw_reference: Any,
    ) -> dict[str, Any]:
        if not isinstance(raw_reference, dict):
            raise MobileNativeBlocked(
                "Mobile runtime manifest is missing actorManifest",
                "mobile-runtime:actor-manifest",
            )
        try:
            actor_manifest = store.read_json(
                ArtifactRef.from_dict(raw_reference)
            )
        except Exception as error:
            raise MobileNativeBlocked(
                f"Mobile actor manifest is unavailable: {type(error).__name__}",
                "mobile-runtime:actor-manifest",
            ) from error
        return actor_manifest

    def _await_access_phase(
        self,
        session: AppiumSession,
        *,
        expected_phase: str,
        timeout_seconds: float = 90.0,
    ) -> dict[str, Any]:
        deadline = time.monotonic() + timeout_seconds
        projection: dict[str, Any] = {}
        while time.monotonic() < deadline:
            value = session.call_action("oauth.status")
            projection = _oauth_projection_summary(value)
            phase = projection.get("phase")
            if phase == expected_phase:
                return projection
            if phase in {"active_session", "cancelled", "expired", "failed"}:
                raise GateError(
                    f"OAuth access reached {phase!r}, expected {expected_phase!r}"
                )
            time.sleep(0.5)
        raise GateError(
            f"OAuth access did not reach {expected_phase!r} before timeout"
        )

    def _verify_access_readback(
        self,
        readback: Mapping[str, Any],
        projection: Mapping[str, Any],
        actor_manifest: Mapping[str, Any],
        service_id: str,
        actor: str,
        station_result: Any,
    ) -> None:
        if projection.get("phase") != "active_session":
            raise GateError("OAuth projection did not activate a session")
        access = readback.get("access")
        station = readback.get("station")
        oauth = readback.get("oauth")
        decision = access.get("decision") if isinstance(access, dict) else None
        oauth_session = oauth.get("session") if isinstance(oauth, dict) else None
        if (
            not isinstance(decision, dict)
            or decision.get("state") != "ACCESS_DECISION_STATE_GRANTED"
        ):
            raise GateError("Authoritative readback does not show granted access")
        if not isinstance(oauth_session, dict) or not oauth_session.get("actorPtid"):
            raise GateError("OAuth readback does not expose native secure-session metadata")
        if not isinstance(station, dict) or not isinstance(station_result, dict):
            raise GateError("Authoritative readback is missing Station identity")
        verified_station_peer_id = station_result.get("verifiedStationPeerId")
        if (
            not isinstance(verified_station_peer_id, str)
            or not verified_station_peer_id
            or station.get("activeStationPeerId") != verified_station_peer_id
        ):
            raise GateError("Authoritative readback does not match the verified Station")
        expected_ptid = self._actor_ptid(actor_manifest, service_id, actor)
        if oauth_session.get("actorPtid") != expected_ptid:
            raise GateError("OAuth readback actor PTID does not match Fixture")

    def _actor_ptid(
        self,
        actor_manifest: Mapping[str, Any],
        service_id: str,
        actor: str,
    ) -> str:
        stations = actor_manifest.get("stations")
        station = stations.get(service_id) if isinstance(stations, dict) else None
        actors = station.get("actors") if isinstance(station, dict) else None
        if isinstance(actors, list):
            for entry in actors:
                if (
                    isinstance(entry, dict)
                    and entry.get("role") == actor
                    and isinstance(entry.get("ptid"), str)
                    and entry["ptid"]
                ):
                    return entry["ptid"]
        raise MobileNativeBlocked(
            f"Actor manifest has no PTID for {actor!r} on {service_id!r}",
            "mobile-runtime:actor-manifest",
        )

    def _record_lifecycle(
        self,
        client_id: str,
        event: str,
        detail: Mapping[str, Any] | None = None,
    ) -> None:
        self.lifecycle.append(
            {
                "clientId": client_id,
                "event": event,
                "atUnixMs": int(time.time() * 1000),
                "detail": dict(detail or {}),
            }
        )

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenario", choices=sorted(SCENARIO_GATES), required=True)
    args = parser.parse_args()
    client = EphemeralGateClient.from_environment()
    if client is None:
        return MobileNativeGate(args.scenario).execute()
    with client:
        return MobileNativeGate(
            args.scenario,
            capability_client=client,
        ).execute()


if __name__ == "__main__":
    raise SystemExit(main())
