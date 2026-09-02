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
from typing import Any

from tooling.acceptance.core import (
    AcceptanceGate,
    ArtifactRef,
    ArtifactSession,
    CredentialRef,
    DriverError,
    EvidenceStore,
    GateError,
    ProvisioningError,
    REPO_ROOT,
    load_runtime_manifest,
    require_runtime_service,
)
from tooling.acceptance.core.redaction import is_sensitive_key
from tooling.acceptance.gates.mobile.appium import (
    AppiumSession,
    UrllibAppiumTransport,
)
from tooling.acceptance.gates.mobile.proof_contracts import (
    CLIENT_PLATFORM,
    CLIENT_PROVIDER,
    CLIENT_SERVICE,
    GATE_ID,
    ProofContractError,
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

ACCESS_ASSIGNMENTS = {
    "alice-ios": ("station-primary", "github"),
    "bob-ios": ("station-secondary", "google"),
    "alice-android": ("station-primary", "google"),
    "bob-android": ("station-secondary", "github"),
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



@dataclass(frozen=True)
class ProviderStep:
    using: str
    selector: str
    action: str


@dataclass(frozen=True)
class ProviderFlow:
    provider: str
    steps: tuple[ProviderStep, ...]

    @classmethod
    def from_credential(cls, provider: str, raw_value: str) -> "ProviderFlow":
        try:
            payload = json.loads(raw_value)
        except json.JSONDecodeError as error:
            raise MobileNativeBlocked(
                f"{provider} account credential must be JSON",
                f"credential:{provider}:format",
            ) from error
        if not isinstance(payload, dict) or payload.get("provider") != provider:
            raise MobileNativeBlocked(
                f"{provider} account credential has the wrong provider identity",
                f"credential:{provider}:identity",
            )
        if "callback" in payload:
            raise MobileNativeBlocked(
                f"{provider} account credential must not define a callback locator",
                f"credential:{provider}:automation",
            )
        raw_steps = payload.get("steps")
        if not isinstance(raw_steps, list) or not raw_steps:
            raise MobileNativeBlocked(
                f"{provider} account credential requires native browser steps",
                f"credential:{provider}:automation",
            )
        steps: list[ProviderStep] = []
        for index, raw_step in enumerate(raw_steps):
            if not isinstance(raw_step, dict):
                raise MobileNativeBlocked(
                    f"{provider} account step {index} must be an object",
                    f"credential:{provider}:automation",
                )
            using = _required_text(raw_step, "using", f"{provider} step {index}")
            selector = _required_text(
                raw_step,
                "selector",
                f"{provider} step {index}",
            )
            action = _required_text(
                raw_step,
                "action",
                f"{provider} step {index}",
            )
            if action != "click":
                raise MobileNativeBlocked(
                    (
                        f"{provider} account step {index} must use a "
                        "pre-authenticated click action"
                    ),
                    f"credential:{provider}:automation",
                )
            steps.append(
                ProviderStep(
                    using=using,
                    selector=selector,
                    action=action,
                )
            )
        return cls(
            provider=provider,
            steps=tuple(steps),
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
        or reference.gate_id != GATE_ID
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
        device_broker: Any | None = None,
    ) -> None:
        self.scenario = scenario
        self.gate_id = SCENARIO_GATES[scenario]
        super().__init__()
        self.device_broker = device_broker
        self.sessions: list[AppiumSession] = []
        self.lifecycle: list[dict[str, Any]] = []
        self.cleanup: list[dict[str, Any]] = []
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
            try:
                if self.scenario != "access":
                    raise MobileNativeBlocked(
                        f"Mobile native scenario {self.scenario!r} is not implemented",
                        f"mobile-scenario:{self.scenario}",
                    )
                result = self._run_access(artifacts)
                status = "PASS"
                completion_status = "DONE"
                proof_status = "PROVEN"
                exit_code = 0
            except MobileNativeBlocked as error:
                status = "BLOCKED"
                result = {
                    "artifactKind": "mobile-native-gate-result",
                    "gate": self.gate_id,
                    "scenario": self.scenario,
                    "status": "BLOCKED",
                    "completionStatus": "BLOCKED",
                    "proofStatus": "UNPROVEN",
                    "blockedReason": error.reason,
                    "blockedResource": error.resource,
                    "sourcePhase": "W2-E Native Acceptance",
                    "sourceBom": ["W2-E"],
                    "sourceSpec": ["MS-D14", "MS-AG03"],
                    "sourceGate": self.gate_id,
                }
                if error.evidence_gaps:
                    result["evidenceGaps"] = error.evidence_gaps
                completion_status = "BLOCKED"
                exit_code = 2
            except (DriverError, GateError, ProvisioningError) as error:
                result = {
                    "artifactKind": "mobile-native-gate-result",
                    "gate": self.gate_id,
                    "scenario": self.scenario,
                    "status": "FAIL",
                    "completionStatus": "PARTIAL",
                    "proofStatus": "UNPROVEN",
                    "reason": str(error),
                    "sourcePhase": "W2-E Native Acceptance",
                    "sourceBom": ["W2-E"],
                    "sourceSpec": ["MS-D14", "MS-AG03"],
                    "sourceGate": self.gate_id,
                }
                exit_code = 1
            finally:
                self._cleanup_sessions(artifacts)

            artifacts.write_json(
                "mobile/lifecycle.json",
                {
                    "artifactKind": "mobile-native-lifecycle",
                    "events": self.lifecycle,
                },
                role="mobile-lifecycle",
            )
            if any(item["status"] == "failed" for item in self.cleanup):
                status = "FAIL"
                completion_status = "PARTIAL"
                proof_status = "UNPROVEN"
                exit_code = 1
                result.update(
                    {
                        "status": "FAIL",
                        "completionStatus": "PARTIAL",
                        "proofStatus": "UNPROVEN",
                        "reason": "one or more Mobile cleanup actions failed",
                    }
                )
            if self.scenario == "access":
                result["variantLedger"] = self.access_variant_ledger.as_dict()
            result["cleanup"] = list(self.cleanup)
            artifacts.write_json(
                "mobile/result.json",
                result,
                role="mobile-native-result",
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

    def _run_access(self, artifacts: ArtifactSession) -> dict[str, Any]:
        manifest = self._load_manifest()
        resources = _required_object(
            manifest,
            "mobileNative",
            "Mobile runtime manifest",
        )
        run_id = _required_text(manifest, "runId", "Mobile runtime manifest")
        source_bindings = {
            client_id: _load_client_evidence_binding(
                artifacts.store,
                resources,
                client_id=client_id,
                platform=CLIENT_PLATFORM[client_id],
                provider=CLIENT_PROVIDER[client_id],
                service_id=CLIENT_SERVICE[client_id],
                expected_run_id=run_id,
            )
            for client_id in ACCESS_ASSIGNMENTS
        }
        if self.device_broker is None:
            raise MobileNativeBlocked(
                (
                    "Mobile native RuntimeManifest has no process-local fenced "
                    "device broker handoff"
                ),
                "mobile-runtime:physical-device-broker",
                evidence_gaps=[
                    {
                        "variantId": variant.id,
                        "platform": variant.platform,
                        "requiredCell": variant.required_cell,
                        "status": "BLOCKED",
                        "reason": (
                            "process-local fenced device broker is unavailable"
                        ),
                    }
                    for variant in REQUIRED_ACCESS_VARIANTS
                ],
            )
        del source_bindings
        raise MobileNativeBlocked(
            (
                "Mobile OAuth projection has no opaque Station Fixture binding "
                "for oauthAttemptRef and lifecycleGeneration"
            ),
            "mobile-runtime:station-fixture-binding",
            evidence_gaps=[
                {
                    "variantId": variant.id,
                    "platform": variant.platform,
                    "requiredCell": variant.required_cell,
                    "status": "BLOCKED",
                    "reason": (
                        "authoritative Station Fixture correlation is unavailable"
                    ),
                }
                for variant in REQUIRED_ACCESS_VARIANTS
            ],
        )
        appium = _required_object(resources, "appium", "Mobile runtime manifest")
        applications = _required_object(
            resources,
            "applications",
            "Mobile runtime manifest",
        )
        clients = _required_object(
            resources,
            "clients",
            "Mobile runtime manifest",
        )
        harness = _required_object(
            resources,
            "harness",
            "Mobile runtime manifest",
        )
        credential_refs = _required_object(
            resources,
            "credentialRefs",
            "Mobile runtime manifest",
        )
        server_url = _required_text(appium, "serverUrl", "Appium resource")
        drivers = _required_object(appium, "drivers", "Appium resource")
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
        provider_flows = self._load_provider_flows(credential_refs)
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

        readbacks: dict[str, Any] = {}
        for client_id, (service_id, provider) in ACCESS_ASSIGNMENTS.items():
            client = _required_object(
                clients,
                client_id,
                f"Mobile client {client_id}",
            )
            platform = _required_text(client, "platform", f"Mobile client {client_id}")
            device_role = _required_text(
                client,
                "deviceRole",
                f"Mobile client {client_id}",
            )
            if not device_role.endswith("-physical"):
                raise MobileNativeBlocked(
                    (
                        f"Mobile client {client_id!r} must be a physical device "
                        "for MS-AG03"
                    ),
                    f"mobile-runtime:physical-device:{client_id}",
                )
            application = _required_object(
                applications,
                platform,
                f"Mobile application {platform}",
            )
            driver = _required_object(
                drivers,
                platform,
                f"Appium driver {platform}",
            )
            ports = _required_object(client, "ports", f"Mobile client {client_id}")
            session = AppiumSession(
                UrllibAppiumTransport(server_url),
                client_id=client_id,
                platform=platform,
                automation_name=_required_text(
                    driver,
                    "automationName",
                    f"Appium driver {platform}",
                ),
                device=_required_text(client, "device", f"Mobile client {client_id}"),
                artifact=_required_text(
                    application,
                    "artifact",
                    f"Mobile application {platform}",
                ),
                application_id=_required_text(
                    application,
                    "id",
                    f"Mobile application {platform}",
                ),
                callback_scheme=_required_text(
                    application,
                    "callbackScheme",
                    f"Mobile application {platform}",
                ),
                ports={
                    name: _required_int(ports, name, f"Mobile client {client_id}")
                    for name in ports
                },
            )
            self.sessions.append(session)
            try:
                session.start()
                session.wait_for_ready()
                session.switch_to_native()
            except DriverError as error:
                raise MobileNativeBlocked(
                    f"Mobile client {client_id!r} cannot start an isolated Appium session",
                    f"mobile-runtime:appium-session:{client_id}",
                ) from error
            self._record_lifecycle(client_id, "session-created")
            artifacts.write_bytes(
                f"mobile/{client_id}/native-ax.xml",
                session.get_page_source().encode("utf-8"),
                media_type="application/xml",
                role=f"{client_id}-native-ax",
            )
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

            service = require_runtime_service(
                manifest,
                service_id,
                "station",
            )
            station_url = _required_text(service, "endpoint", service_id)
            cancel_variant_id = f"cancel-{platform}"
            should_run_cancel = (
                client_id.startswith("alice-")
                and self.access_variant_ledger.status(cancel_variant_id) == "PENDING"
            )
            if should_run_cancel:
                cancel_readback = self._run_cancel_variant(
                    session,
                    station_url=station_url,
                    provider=provider,
                    client_id=client_id,
                )
                self.access_variant_ledger.mark_passed(cancel_variant_id)
                artifacts.write_json(
                    f"mobile/{client_id}/cancel-readback.json",
                    cancel_readback,
                    role=f"{client_id}-cancel-readback",
                )
            station_result = _begin_oauth(
                session,
                station_url=station_url,
                provider=provider,
                client_id=client_id,
            )
            self._record_lifecycle(client_id, "station.add")
            self._record_lifecycle(client_id, "access.start")
            self._record_lifecycle(client_id, "oauth.start")
            try:
                self._complete_provider_flow(
                    session,
                    provider_flows[provider],
                )
            except DriverError as error:
                raise MobileNativeBlocked(
                    f"{provider} native authorization did not redirect back to the app",
                    f"mobile-runtime:provider-authorization:{provider}",
                ) from error
            self._record_lifecycle(client_id, "provider.redirect-returned")
            projection = self._await_access_result(
                session,
            )
            readback = _mobile_projection_summary(
                session.call_action("projection.read")
            )
            self._verify_access_readback(
                readback,
                projection,
                actor_manifest,
                service_id,
                str(client.get("actor") or ""),
                station_result,
            )
            readbacks[client_id] = readback
            artifacts.write_json(
                f"mobile/{client_id}/station-readback.json",
                readback,
                role=f"{client_id}-station-readback",
            )
            artifacts.write_bytes(
                f"mobile/{client_id}/web-dom.html",
                session.get_page_source().encode("utf-8"),
                media_type="text/html",
                role=f"{client_id}-web-dom",
            )
            artifacts.write_bytes(
                f"mobile/{client_id}/screenshot.png",
                session.screenshot_bytes(),
                media_type="image/png",
                role=f"{client_id}-screenshot",
            )
            self._record_lifecycle(
                client_id,
                "evidence-captured",
                {"webview": webview, "actionCount": len(inventory)},
            )
            self.access_variant_ledger.mark_passed(
                f"success-{platform}-{provider}"
            )

        artifacts.write_json(
            "mobile/oauth-variant-ledger.json",
            self.access_variant_ledger.as_dict(),
            role="mobile-oauth-variant-ledger",
        )
        self.access_variant_ledger.require_proven()
        return {
            "artifactKind": "mobile-native-gate-result",
            "gate": self.gate_id,
            "scenario": "access",
            "status": "PASS",
            "completionStatus": "DONE",
            "proofStatus": "PROVEN",
            "sourcePhase": "W2-E Native Acceptance",
            "sourceBom": ["W2-E"],
            "sourceSpec": ["MS-D14", "MS-AG03"],
            "sourceGate": "mobile-native-access-e2e",
            "clients": sorted(readbacks),
            "providers": sorted(provider_flows),
        }

    def _run_cancel_variant(
        self,
        session: AppiumSession,
        *,
        station_url: str,
        provider: str,
        client_id: str,
    ) -> dict[str, Any]:
        _begin_oauth(
            session,
            station_url=station_url,
            provider=provider,
            client_id=client_id,
        )
        cancelled = _oauth_projection_summary(
            session.call_action("oauth.cancel")
        )
        if cancelled.get("phase") != "cancelled":
            raise GateError(
                f"OAuth cancel variant for {client_id!r} did not reach cancelled"
            )
        if cancelled.get("session") is not None:
            raise GateError(
                f"OAuth cancel variant for {client_id!r} activated a session"
            )
        readback = _mobile_projection_summary(
            session.call_action("projection.read")
        )
        oauth = readback.get("oauth")
        if (
            not isinstance(oauth, dict)
            or oauth.get("phase") != "cancelled"
            or oauth.get("session") is not None
        ):
            raise GateError(
                f"OAuth cancel readback for {client_id!r} is not fail-closed"
            )
        self._record_lifecycle(client_id, "oauth.cancel")
        return readback

    def _load_manifest(self) -> dict[str, Any]:
        manifest_path = os.environ.get("PT_ACCEPTANCE_RUNTIME_MANIFEST", "")
        if not manifest_path:
            raise MobileNativeBlocked(
                "PT_ACCEPTANCE_RUNTIME_MANIFEST is required",
                "mobile-runtime:manifest",
            )
        try:
            manifest = load_runtime_manifest(Path(manifest_path), self.gate_id)
            require_runtime_service(manifest, "station-primary", "station")
            require_runtime_service(manifest, "station-secondary", "station")
            require_runtime_service(manifest, "relay", "relay")
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

    def _load_provider_flows(
        self,
        credential_refs: Mapping[str, Any],
    ) -> dict[str, ProviderFlow]:
        flows: dict[str, ProviderFlow] = {}
        for provider in ("github", "google"):
            credential_id = f"{provider}-disposable-account"
            source_ref = credential_refs.get(credential_id)
            if not isinstance(source_ref, str):
                raise MobileNativeBlocked(
                    f"Mobile runtime manifest is missing {credential_id}",
                    f"credential:{provider}",
                )
            try:
                raw_value = CredentialRef(
                    id=credential_id,
                    source_ref=source_ref,
                ).resolve()
            except ProvisioningError as error:
                raise MobileNativeBlocked(
                    f"Mobile {provider} credential is unavailable",
                    f"credential:{provider}",
                ) from error
            flows[provider] = ProviderFlow.from_credential(
                provider,
                raw_value,
            )
        return flows

    def _complete_provider_flow(
        self,
        session: AppiumSession,
        flow: ProviderFlow,
    ) -> None:
        session.switch_to_native()
        for step in flow.steps:
            element_id = session.find_element(step.using, step.selector)
            session.click(element_id)
        session.switch_to_app_webview(timeout=90)

    def _await_access_result(
        self,
        session: AppiumSession,
        timeout_seconds: float = 90.0,
    ) -> dict[str, Any]:
        deadline = time.monotonic() + timeout_seconds
        projection: dict[str, Any] = {}
        while time.monotonic() < deadline:
            value = session.call_action("oauth.status")
            projection = _oauth_projection_summary(value)
            phase = projection.get("phase")
            if phase == "active_session":
                return projection
            if phase in {"cancelled", "expired", "failed"}:
                raise GateError(
                    f"OAuth access ended in terminal phase {phase!r}"
                )
            time.sleep(0.5)
        raise GateError("OAuth access did not reach active_session before timeout")

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
            raise GateError("Station readback does not show granted access")
        if not isinstance(oauth_session, dict) or not oauth_session.get("actorPtid"):
            raise GateError("OAuth readback does not expose native secure-session metadata")
        if not isinstance(station, dict) or not isinstance(station_result, dict):
            raise GateError("Station readback is missing Station identity")
        verified_station_peer_id = station_result.get("verifiedStationPeerId")
        if (
            not isinstance(verified_station_peer_id, str)
            or not verified_station_peer_id
            or station.get("activeStationPeerId") != verified_station_peer_id
        ):
            raise GateError("Station readback does not match the verified Station")
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

    def _cleanup_sessions(self, artifacts: ArtifactSession) -> None:
        for session in reversed(self.sessions):
            client_id = session.client_id
            try:
                if session.session_id:
                    try:
                        session.switch_to_app_webview(timeout=5)
                        session.call_action("cleanup", {})
                        self.cleanup.append(
                            {
                                "clientId": client_id,
                                "resource": "product-harness",
                                "status": "passed",
                            }
                        )
                    except Exception as error:
                        self.cleanup.append(
                            {
                                "clientId": client_id,
                                "resource": "product-harness",
                                "status": "failed",
                                "errorType": type(error).__name__,
                            }
                        )
                session.stop()
                self.cleanup.append(
                    {
                        "clientId": client_id,
                        "resource": "appium-session",
                        "status": "passed",
                    }
                )
            except Exception as error:
                self.cleanup.append(
                    {
                        "clientId": client_id,
                        "resource": "appium-session",
                        "status": "failed",
                        "errorType": type(error).__name__,
                    }
                )
        self.sessions.clear()
        artifacts.write_json(
            "mobile/cleanup.json",
            {
                "artifactKind": "mobile-native-cleanup",
                "resources": self.cleanup,
            },
            role="mobile-cleanup",
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenario", choices=sorted(SCENARIO_GATES), required=True)
    args = parser.parse_args()
    return MobileNativeGate(args.scenario).execute()


if __name__ == "__main__":
    raise SystemExit(main())
