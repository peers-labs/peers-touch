from __future__ import annotations

import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from typing import Any

from tooling.acceptance.gates.mobile import proof_contracts
from tooling.acceptance.gates.mobile.proof_contracts import (
    ARTIFACT_ROLES,
    CLIENTS,
    GATE_ID,
    SERVICES,
    VARIANTS,
    ArtifactRecord,
    ProofContractError,
    artifact_records_from_evidence_manifest,
    protected_path_snapshot,
    validate_artifact_roles,
    validate_contract_payload,
    validate_redaction,
    verify_protected_paths,
    verify_version_policy,
    version_policy_snapshot,
)


RUN_ID = "20260829T120000000000Z-0123456789abcdef0123456789abcdef"
WORKSPACE_ID = proof_contracts.evidence_workspace_id(proof_contracts.REPO_ROOT)
SHA256 = "sha256:" + ("a" * 64)
TIMESTAMP = "2026-08-29T12:00:00Z"
UNINSTALL_AT = "2026-08-29T11:59:58Z"
INSTALL_AT = "2026-08-29T11:59:59Z"
HEARTBEAT_AT = "2999-08-29T12:00:00Z"
RENEW_BEFORE = "2999-08-29T12:05:00Z"
EXPIRES_AT = "2999-08-29T12:10:00Z"


def artifact_ref(
    path: str,
    *,
    run_id: str = RUN_ID,
    gate_id: str = GATE_ID,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    digest = (
        hashlib.sha256(
            (
                json.dumps(payload, indent=2, sort_keys=True, default=str)
                + "\n"
            ).encode("utf-8")
        ).hexdigest()
        if payload is not None
        else "a" * 64
    )
    return {
        "artifactKind": "acceptance-artifact-ref",
        "workspaceId": WORKSPACE_ID,
        "gateId": gate_id,
        "runId": run_id,
        "path": path,
        "sha256": digest,
        "mediaType": "application/json",
    }


def fixture_lease(service_id: str = "station-primary") -> dict[str, Any]:
    return {
        "artifactKind": "mobile-oauth-fixture-lease",
        "fixtureId": "mobile-oauth-negative-fixture",
        "resourceKey": f"station/{service_id}/mobile-oauth-fixture",
        "holderRunId": RUN_ID,
        "fenceToken": 11,
        "runId": RUN_ID,
        "gateId": GATE_ID,
        "serviceId": service_id,
        "stationPeerId": f"peer-{service_id}",
        "serviceAttestation": artifact_ref(
            f"runtime/services/{service_id}/attestation.json"
        ),
        "authorization": {
            "destructiveResetApproved": True,
            "deploymentLeaseMatched": True,
            "disposableTargetVerified": True,
        },
        "allowedOperations": [
            "prepare_following_gate",
            "expire_awaiting_attempt",
            "read_proof_snapshot",
            "cleanup_run",
        ],
        "state": "LEASED",
        "heartbeatAt": HEARTBEAT_AT,
        "renewBefore": RENEW_BEFORE,
        "expiresAt": EXPIRES_AT,
        "quarantineReason": "",
        "cleanupRegistered": True,
    }


def fixture_operation(
    operation_id: str = "operation-expiry-ios",
    *,
    variant_id: str = "expiry-ios",
    operation: str = "expire_awaiting_attempt",
    service_id: str = "station-primary",
) -> dict[str, Any]:
    client_id = proof_contracts.VARIANT_CLIENT[variant_id]
    return {
        "artifactKind": "mobile-oauth-fixture-operation",
        "operationId": operation_id,
        "inputDigest": SHA256,
        "resourceKey": f"station/{service_id}/mobile-oauth-fixture",
        "holderRunId": RUN_ID,
        "fenceToken": 11,
        "runId": RUN_ID,
        "gateId": GATE_ID,
        "variantId": variant_id,
        "operation": operation,
        "target": {
            "serviceId": service_id,
            "oauthAttemptRef": "oauth-attempt",
            "accessAttemptRef": "access-attempt",
            "deviceAlias": client_id,
            "lifecycleGeneration": 7,
        },
        "precondition": {
            "oauthState": "OAUTH_ATTEMPT_STATE_AWAITING_PROVIDER",
            "runOwned": True,
        },
        "result": {
            "journalState": "COMMITTED",
            "preconditionMatched": True,
            "affectedRows": 1,
            "before": artifact_ref("runtime/mobile/fixtures/before.json"),
            "after": artifact_ref("runtime/mobile/fixtures/after.json"),
            "postCleanup": artifact_ref(
                "runtime/mobile/fixtures/post-cleanup.json"
            ),
        },
    }


def negative_callback_intent(
    operation: str = "provider_mismatch",
) -> dict[str, Any]:
    variants = {
        "provider_mismatch": (
            "provider-mismatch-ios",
            "oauthProviderMismatch",
            "",
            "",
            "",
        ),
        "station_mismatch": (
            "station-mismatch-ios",
            "oauthStationMismatch",
            "",
            "",
            "station-secondary",
        ),
        "replay": (
            "replay-ios",
            "oauthReplay",
            "volatile-replay-handle",
            "different_after_claim",
            "",
        ),
    }
    variant_id, expected_failure, replay_handle, replay_mode, alternate = variants[
        operation
    ]
    return {
        "artifactKind": "mobile-oauth-negative-callback-intent",
        "runId": RUN_ID,
        "gateId": GATE_ID,
        "variantId": variant_id,
        "clientId": "alice-ios",
        "operation": operation,
        "requiredLeaseRefs": [
            "physical-device-lease/alice-ios",
            "provider-account-lease/github",
            "browser-session-lease/alice-ios",
        ],
        "holderRunId": RUN_ID,
        "fenceTokens": {
            "physicalDevice": 9,
            "providerAccount": 42,
            "browserSession": 18,
        },
        "callbackReplayHandle": replay_handle,
        "replayMode": replay_mode,
        "alternateServiceId": alternate,
        "expectedFailure": expected_failure,
    }


def station_snapshot(
    *,
    phase: str = "post_action",
    service_id: str = "station-primary",
    variant_id: str = "replay-ios",
) -> dict[str, Any]:
    client_id = proof_contracts.VARIANT_CLIENT[variant_id]
    provider = proof_contracts.CLIENT_PROVIDER[client_id]
    residue = {
        "accessAttempts": 1,
        "oauthAttempts": 1,
        "candidates": 1,
        "credentialEnvelopes": 0,
        "sessions": 0,
        "inviteCodes": 1,
        "policyOverrides": 1,
        "fixtureJournalEntries": 1,
    }
    policy_restored = False
    candidate = {
        "count": 1,
        "state": "inactive",
        "actorPtid": "ptid:fixture-alice",
        "sessionRefPresent": False,
    }
    provider_binding = {
        "provider": provider,
        "candidateCorrelationPresent": True,
        "providerSubjectFingerprint": SHA256,
        "bindingCount": 1,
    }
    zero_candidate = phase == "post_cleanup" or variant_id.startswith(
        ("provider-mismatch-", "station-mismatch-")
    )
    if zero_candidate:
        residue["candidates"] = 0
        residue["credentialEnvelopes"] = 0
        residue["sessions"] = 0
        candidate = {"count": 0, "sessionRefPresent": False}
        provider_binding = {
            "provider": provider,
            "candidateCorrelationPresent": False,
        }
    if phase == "post_cleanup":
        residue = {key: 0 for key in residue}
        policy_restored = True
    return {
        "artifactKind": "station-oauth-proof-snapshot",
        "runId": RUN_ID,
        "gateId": GATE_ID,
        "variantId": variant_id,
        "fixtureId": "mobile-oauth-negative-fixture",
        "snapshotPhase": phase,
        "observedAt": TIMESTAMP,
        "observation": {
            "isolation": "postgresql-repeatable-read-read-only",
            "transactionSnapshot": "db-snapshot",
            "startedAt": TIMESTAMP,
            "completedAt": TIMESTAMP,
            "freshnessSeconds": 12,
        },
        "service": {
            "serviceId": service_id,
            "stationPeerId": f"peer-{service_id}",
            "deploymentEnvironment": "mobile-native",
            "liveCommit": "1" * 40,
            "workspaceDigest": SHA256,
            "protocolDigest": SHA256,
            "attestation": artifact_ref(
                f"runtime/services/{service_id}/attestation.json"
            ),
        },
        "binding": {
            "accessAttemptRef": "access-attempt",
            "oauthAttemptRef": "oauth-attempt",
            "expectedProvider": provider,
            "gateId": "auth.login",
            "deviceAlias": client_id,
            "lifecycleGeneration": 7,
        },
        "access": {
            "status": "action_required",
            "currentGateId": "invite.code",
            "decisionRevision": 3,
        },
        "oauth": {
            "state": "OAUTH_ATTEMPT_STATE_FOLLOWING_GATE",
            "result": "OAUTH_ATTEMPT_RESULT_SESSION_CANDIDATE_ISSUED",
            "errorCode": "",
            "updatedAt": TIMESTAMP,
            "expiresRelation": "future",
            "claimedAtPresent": True,
            "consumedAtPresent": True,
        },
        "candidate": candidate,
        "credentialEnvelopeCount": 0,
        "session": {
            "count": 0,
            "activeCount": 0,
            "revokedCount": 0,
            "authMethod": "",
            "decisionRevision": 0,
        },
        "providerBinding": provider_binding,
        "fixture": {
            "operationId": "operation-replay-ios",
            "journalState": "COMMITTED",
            "policyBaselineDigest": SHA256,
            "policyObservedDigest": SHA256,
            "policyRestored": policy_restored,
        },
        "runOwnedResidue": residue,
        "invariants": {
            "singleConsume": True,
            "singleCandidate": True,
            "noEarlyActiveSession": True,
            "noUnexpectedEnvelope": True,
        },
        "redaction": {"status": "passed"},
    }


def provider_account_lease(provider: str = "github") -> dict[str, Any]:
    allowed_clients = {
        "github": ["alice-ios", "bob-android"],
        "google": ["bob-ios", "alice-android"],
    }
    return {
        "artifactKind": "provider-account-lease",
        "leaseId": f"account-{provider}",
        "resourceKey": f"provider-account/{provider}/disposable",
        "holderRunId": RUN_ID,
        "fenceToken": 42,
        "runId": RUN_ID,
        "gateId": GATE_ID,
        "provider": provider,
        "accountRef": f"{provider}-disposable-account",
        "allowedClientIds": allowed_clients[provider],
        "maxConcurrentAuthorizations": 1,
        "heartbeatAt": HEARTBEAT_AT,
        "renewBefore": RENEW_BEFORE,
        "state": "LEASED",
        "acquiredAt": HEARTBEAT_AT,
        "expiresAt": EXPIRES_AT,
        "quarantineReason": "",
        "releaseEvidence": None,
    }


def provider_identity_assertion(provider: str = "github") -> dict[str, Any]:
    return {
        "artifactKind": "provider-identity-assertion",
        "runId": RUN_ID,
        "gateId": GATE_ID,
        "provider": provider,
        "accountRef": f"{provider}-disposable-account",
        "providerSubjectFingerprint": SHA256,
        "identityMatched": True,
        "observedAt": TIMESTAMP,
    }


def browser_session_lease(
    client_id: str = "alice-ios",
    platform: str = "ios",
) -> dict[str, Any]:
    provider = "github" if client_id in {"alice-ios", "bob-android"} else "google"
    return {
        "artifactKind": "provider-browser-session-lease",
        "leaseId": f"browser-{client_id}",
        "resourceKey": f"physical-device/{client_id}/browser/default",
        "holderRunId": RUN_ID,
        "fenceToken": 18,
        "runId": RUN_ID,
        "gateId": GATE_ID,
        "clientId": client_id,
        "platform": platform,
        "physicalDeviceLeaseRef": f"physical-device-lease/{client_id}",
        "browserProfileRef": f"browser-profile/{client_id}",
        "providerAccountLeaseRef": f"provider-account-lease/{provider}",
        "baseline": "preauthenticated-exclusive",
        "checks": {
            "expectedIdentityMatched": True,
            "authorizationInProgress": False,
            "mobileOAuthStateAbsent": True,
            "stationRunStateAbsent": True,
        },
        "cleanupPolicy": "preserve-login-verify-identity",
        "heartbeatAt": HEARTBEAT_AT,
        "renewBefore": RENEW_BEFORE,
        "expiresAt": EXPIRES_AT,
        "state": "BASELINE_VERIFIED",
        "quarantineReason": "",
        "releaseEvidence": None,
    }


def physical_device_lease(client_id: str = "alice-ios") -> dict[str, Any]:
    platform = proof_contracts.CLIENT_PLATFORM[client_id]
    return {
        "artifactKind": "physical-device-lease",
        "leaseId": f"device-{client_id}",
        "resourceKey": f"physical-device/{client_id}",
        "holderRunId": RUN_ID,
        "fenceToken": 9,
        "runId": RUN_ID,
        "gateId": GATE_ID,
        "clientId": client_id,
        "platform": platform,
        "physicalDeviceRef": f"device-ref/{client_id}",
        "destinationClassRef": f"{platform}-physical",
        "brokerRef": "mobile-physical-device-broker",
        "checks": {
            "connected": True,
            "physical": True,
            "simulator": False,
            "platformMatched": True,
        },
        "heartbeatAt": HEARTBEAT_AT,
        "renewBefore": RENEW_BEFORE,
        "acquiredAt": HEARTBEAT_AT,
        "expiresAt": EXPIRES_AT,
        "state": "BASELINE_VERIFIED",
        "quarantineReason": "",
        "releaseEvidence": None,
    }


def build_attestation(platform: str = "android") -> dict[str, Any]:
    artifact_kind = "apk" if platform == "android" else "ipa"
    signing: dict[str, Any] = {
        "policyId": "mobile-acceptance-debug",
        "certificateSha256": SHA256,
        "applicationIdentifier": "com.peers.touch.mobile",
        "debuggable": True,
    }
    if platform == "android":
        signing.update(
            {
                "signerCertificateSha256": SHA256,
                "enabledSigningSchemes": ["v2", "v3"],
            }
        )
    else:
        signing.update(
            {
                "teamIdentifier": "PEERSTEAM",
                "applicationIdentifierEntitlement": "PEERSTEAM.com.peers.touch.mobile",
                "cdHash": {
                    "source": "codesign",
                    "algorithm": "sha256",
                    "valueHex": "b" * 40,
                    "candidateFullValueHex": "b" * 64,
                },
            }
        )
    resolver_arguments = {
        "pnpm": ["--offline", "--frozen-lockfile"],
        "cargo": ["--frozen"],
        "gradle" if platform == "android" else "xcode": (
            ["--offline"]
            if platform == "android"
            else ["-disableAutomaticPackageResolution"]
        ),
    }
    return {
        "artifactKind": "mobile-application-build-attestation",
        "runId": RUN_ID,
        "gateId": GATE_ID,
        "producer": "mobile-native-build",
        "producerSourceDigest": SHA256,
        "toolchainDigest": SHA256,
        "buildIsolation": {
            "environmentPolicy": "empty-base-explicit-allowlist",
            "dependencyPolicy": "locked-preseeded-offline",
            "resolverArguments": resolver_arguments,
            "inapplicableResolvers": [
                "xcode" if platform == "android" else "gradle"
            ],
            "cacheMissPolicy": "BLOCK",
            "ambientEnvironmentInherited": False,
        },
        "buildIdentity": {
            "schema": "peers-mobile-build-identity",
            "buildId": f"build-{platform}",
            "platform": platform,
            "configuration": "acceptance-debug",
            "sourceCommit": "1" * 40,
            "workspaceState": "dirty",
            "workspaceDigest": SHA256,
            "buildInputsDigest": SHA256,
            "allowlistedEnvironmentDigest": SHA256,
            "applicationId": "com.peers.touch.mobile",
            "harnessEnabled": True,
        },
        "embeddedIdentitySha256": SHA256,
        "artifact": {
            "kind": artifact_kind,
            "sha256": SHA256,
            "sizeBytes": 123456,
            "artifactRef": artifact_ref(
                f"runtime/mobile/builds/{platform}.{artifact_kind}"
            ),
        },
        "signing": signing,
        "createdAt": TIMESTAMP,
    }


def fresh_install_trace(client_id: str = "alice-ios") -> dict[str, Any]:
    platform = proof_contracts.CLIENT_PLATFORM[client_id]
    device_lease = physical_device_lease(client_id)
    attestation = build_attestation(platform)
    return {
        "artifactKind": "mobile-fresh-install-trace",
        "runId": RUN_ID,
        "gateId": GATE_ID,
        "clientId": client_id,
        "platform": platform,
        "physicalDeviceLease": artifact_ref(
            f"runtime/mobile/leases/devices/{client_id}.json",
            payload=device_lease,
        ),
        "buildAttestation": artifact_ref(
            f"runtime/mobile/builds/{platform}.json",
            payload=attestation,
        ),
        "applicationId": "com.peers.touch.mobile",
        "artifactSha256": SHA256,
        "uninstall": {
            "stepIndex": 1,
            "requested": True,
            "priorInstallationAbsent": True,
            "completedAt": UNINSTALL_AT,
        },
        "install": {
            "stepIndex": 2,
            "completed": True,
            "applicationPresent": True,
            "completedAt": INSTALL_AT,
        },
        "observedAt": TIMESTAMP,
    }


def installed_build_identity(client_id: str = "alice-ios") -> dict[str, Any]:
    platform = proof_contracts.CLIENT_PLATFORM[client_id]
    attestation = build_attestation(platform)
    install_trace = fresh_install_trace(client_id)
    return {
        "artifactKind": "mobile-installed-build-identity",
        "runId": RUN_ID,
        "gateId": GATE_ID,
        "clientId": client_id,
        "platform": platform,
        "buildAttestation": artifact_ref(
            f"runtime/mobile/builds/{platform}.json",
            payload=attestation,
        ),
        "freshInstallTrace": artifact_ref(
            f"evidence/mobile/runtime/{client_id}/install.json",
            payload=install_trace,
        ),
        "buildId": f"build-{platform}",
        "activeApplicationId": "com.peers.touch.mobile",
        "webEmbeddedIdentitySha256": SHA256,
        "rustEmbeddedIdentitySha256": SHA256,
        "attestedEmbeddedIdentitySha256": SHA256,
        "allIdentitiesMatch": True,
        "observedAt": TIMESTAMP,
    }


def lease_outcome(
    lease: dict[str, Any],
    lease_kind: str,
    acquisition_path: str,
) -> dict[str, Any]:
    lease_id = lease.get("leaseId")
    if lease_id is None:
        lease_id = f"fixture-{lease['serviceId']}"
    outcome: dict[str, Any] = {
        "artifactKind": "mobile-lease-outcome",
        "runId": RUN_ID,
        "gateId": GATE_ID,
        "leaseId": lease_id,
        "leaseKind": lease_kind,
        "resourceKey": lease["resourceKey"],
        "holderRunId": lease["holderRunId"],
        "fenceToken": lease["fenceToken"],
        "acquisition": artifact_ref(acquisition_path, payload=lease),
        "finalState": "RELEASED",
        "cleanupCompleted": True,
        "baselineRestored": True,
        "identityReverified": True,
        "failureCode": "",
        "observedAt": TIMESTAMP,
    }
    if lease_kind == "provider-account":
        outcome["operationSummary"] = {
            "started": 2,
            "completed": 2,
            "maxObservedConcurrency": 1,
            "fenceValidated": True,
        }
    return outcome


def accepted_payloads() -> dict[str, dict[str, Any]]:
    return {
        "mobile-oauth-fixture-lease": fixture_lease(),
        "mobile-oauth-fixture-operation": fixture_operation(),
        "mobile-oauth-negative-callback-intent": negative_callback_intent(),
        "station-oauth-proof-snapshot": station_snapshot(),
        "provider-account-lease": provider_account_lease(),
        "provider-identity-assertion": provider_identity_assertion(),
        "physical-device-lease": physical_device_lease(),
        "provider-browser-session-lease": browser_session_lease(),
        "mobile-application-build-attestation": build_attestation(),
        "mobile-fresh-install-trace": fresh_install_trace(),
        "mobile-installed-build-identity": installed_build_identity(),
        "mobile-lease-outcome": lease_outcome(
            physical_device_lease(),
            "physical-device",
            "runtime/mobile/leases/devices/alice-ios.json",
        ),
    }


def delete_nested(value: dict[str, Any], dotted_path: str) -> None:
    current: dict[str, Any] = value
    parts = dotted_path.split(".")
    for part in parts[:-1]:
        current = current[part]
    del current[parts[-1]]


class ProofPayloadContractTests(unittest.TestCase):
    def test_every_accepted_payload_fixture_passes(self) -> None:
        for kind, payload in accepted_payloads().items():
            with self.subTest(kind=kind):
                validated = validate_contract_payload(
                    payload,
                    expected_kind=kind,
                    expected_run_id=RUN_ID,
                )
                self.assertEqual(validated, payload)
                self.assertIsNot(validated, payload)

    def test_required_nested_fields_fail_closed(self) -> None:
        required_paths = {
            "mobile-oauth-fixture-operation": [
                "target.serviceId",
                "target.oauthAttemptRef",
                "target.accessAttemptRef",
                "target.deviceAlias",
                "target.lifecycleGeneration",
                "precondition.oauthState",
                "precondition.runOwned",
                "result.journalState",
                "result.preconditionMatched",
                "result.affectedRows",
                "result.before",
                "result.after",
                "result.postCleanup",
            ],
            "station-oauth-proof-snapshot": [
                "observation.isolation",
                "observation.transactionSnapshot",
                "observation.startedAt",
                "observation.completedAt",
                "observation.freshnessSeconds",
                "service.serviceId",
                "service.stationPeerId",
                "service.deploymentEnvironment",
                "service.liveCommit",
                "service.workspaceDigest",
                "service.protocolDigest",
                "service.attestation",
                "binding.accessAttemptRef",
                "binding.oauthAttemptRef",
                "binding.expectedProvider",
                "binding.gateId",
                "binding.deviceAlias",
                "binding.lifecycleGeneration",
                "access.status",
                "access.currentGateId",
                "access.decisionRevision",
                "oauth.state",
                "oauth.result",
                "oauth.errorCode",
                "oauth.updatedAt",
                "oauth.expiresRelation",
                "oauth.claimedAtPresent",
                "oauth.consumedAtPresent",
                "candidate.count",
                "candidate.state",
                "candidate.actorPtid",
                "candidate.sessionRefPresent",
                "session.count",
                "session.activeCount",
                "session.revokedCount",
                "session.authMethod",
                "session.decisionRevision",
                "providerBinding.provider",
                "providerBinding.candidateCorrelationPresent",
                "providerBinding.providerSubjectFingerprint",
                "providerBinding.bindingCount",
                "fixture.operationId",
                "fixture.journalState",
                "fixture.policyBaselineDigest",
                "fixture.policyObservedDigest",
                "fixture.policyRestored",
                "runOwnedResidue.accessAttempts",
                "runOwnedResidue.oauthAttempts",
                "runOwnedResidue.candidates",
                "runOwnedResidue.credentialEnvelopes",
                "runOwnedResidue.sessions",
                "runOwnedResidue.inviteCodes",
                "runOwnedResidue.policyOverrides",
                "runOwnedResidue.fixtureJournalEntries",
                "invariants.singleConsume",
                "invariants.singleCandidate",
                "invariants.noEarlyActiveSession",
                "invariants.noUnexpectedEnvelope",
                "redaction.status",
            ],
            "mobile-application-build-attestation": [
                "artifact.kind",
                "artifact.sha256",
                "artifact.sizeBytes",
                "artifact.artifactRef",
                "signing.policyId",
                "signing.certificateSha256",
                "signing.applicationIdentifier",
                "signing.debuggable",
                "signing.signerCertificateSha256",
                "signing.enabledSigningSchemes",
            ],
        }
        payloads = accepted_payloads()
        for kind, paths in required_paths.items():
            for dotted_path in paths:
                with self.subTest(kind=kind, path=dotted_path):
                    payload = copy.deepcopy(payloads[kind])
                    delete_nested(payload, dotted_path)
                    with self.assertRaises(ProofContractError):
                        validate_contract_payload(payload, expected_run_id=RUN_ID)

    def test_every_artifact_ref_requires_complete_identity(self) -> None:
        for field in (
            "artifactKind",
            "workspaceId",
            "gateId",
            "runId",
            "path",
            "sha256",
            "mediaType",
        ):
            with self.subTest(field=field):
                payload = fixture_lease()
                del payload["serviceAttestation"][field]
                with self.assertRaises(ProofContractError):
                    validate_contract_payload(payload, expected_run_id=RUN_ID)

    def test_artifact_refs_reject_cross_run_and_cross_gate_identity(self) -> None:
        for field, value in (
            ("runId", "another-run"),
            ("gateId", "another-gate"),
        ):
            with self.subTest(field=field):
                payload = fixture_lease()
                payload["serviceAttestation"][field] = value
                with self.assertRaises(ProofContractError):
                    validate_contract_payload(payload, expected_run_id=RUN_ID)

    def test_fixture_operation_requires_exact_single_row_commit(self) -> None:
        for dotted_path, value in (
            ("result.preconditionMatched", False),
            ("result.affectedRows", 0),
            ("precondition.runOwned", False),
            ("target.serviceId", "station-secondary"),
            ("target.deviceAlias", "bob-ios"),
        ):
            with self.subTest(path=dotted_path, value=value):
                payload = fixture_operation()
                current: dict[str, Any] = payload
                parts = dotted_path.split(".")
                for part in parts[:-1]:
                    current = current[part]
                current[parts[-1]] = value
                with self.assertRaises(ProofContractError):
                    validate_contract_payload(payload, expected_run_id=RUN_ID)

    def test_provider_account_client_mapping_is_exact(self) -> None:
        for provider, expected in (
            ("github", {"alice-ios", "bob-android"}),
            ("google", {"bob-ios", "alice-android"}),
        ):
            with self.subTest(provider=provider):
                payload = provider_account_lease(provider)
                self.assertEqual(set(payload["allowedClientIds"]), expected)
                payload["allowedClientIds"] = ["alice-ios", "bob-ios"]
                with self.assertRaises(ProofContractError):
                    validate_contract_payload(payload, expected_run_id=RUN_ID)

    def test_browser_lease_client_platform_and_account_relations_are_exact(self) -> None:
        mutations = (
            ("platform", "android"),
            ("physicalDeviceLeaseRef", "physical-device-lease/bob-ios"),
            ("providerAccountLeaseRef", "provider-account-lease/google"),
        )
        for field, value in mutations:
            with self.subTest(field=field):
                payload = browser_session_lease()
                payload[field] = value
                with self.assertRaises(ProofContractError):
                    validate_contract_payload(payload, expected_run_id=RUN_ID)

    def test_station_snapshot_service_matches_bound_client(self) -> None:
        payload = station_snapshot(service_id="station-secondary")
        with self.assertRaises(ProofContractError):
            validate_contract_payload(payload, expected_run_id=RUN_ID)

    def test_station_snapshot_enforces_candidate_session_cardinality(self) -> None:
        mutations = (
            ("candidate", "count", 2),
            ("session", "count", 2),
            ("session", "activeCount", 1),
            ("session", "revokedCount", 1),
            ("providerBinding", "bindingCount", 0),
        )
        for section, field, value in mutations:
            with self.subTest(section=section, field=field):
                payload = station_snapshot()
                payload[section][field] = value
                with self.assertRaises(ProofContractError):
                    validate_contract_payload(payload, expected_run_id=RUN_ID)

    def test_zero_candidate_snapshot_omits_not_applicable_identity(self) -> None:
        payload = station_snapshot()
        payload["candidate"] = {
            "count": 0,
            "sessionRefPresent": False,
        }
        payload["providerBinding"] = {
            "provider": "github",
            "candidateCorrelationPresent": False,
        }
        payload["runOwnedResidue"]["candidates"] = 0
        validate_contract_payload(payload, expected_run_id=RUN_ID)

        invalid_values = (
            ("candidate", "state", "inactive"),
            ("candidate", "actorPtid", "ptid:unexpected"),
            ("providerBinding", "providerSubjectFingerprint", SHA256),
            ("providerBinding", "bindingCount", 0),
            ("root", "credentialEnvelopeCount", 1),
            ("session", "count", 1),
            ("runOwnedResidue", "credentialEnvelopes", 1),
            ("runOwnedResidue", "sessions", 1),
        )
        for section, field, value in invalid_values:
            with self.subTest(section=section, field=field):
                invalid = copy.deepcopy(payload)
                if section == "root":
                    invalid[field] = value
                else:
                    invalid[section][field] = value
                with self.assertRaises(ProofContractError):
                    validate_contract_payload(invalid, expected_run_id=RUN_ID)

    def test_hash_git_and_active_lease_expiry_formats_fail_closed(self) -> None:
        cases = (
            (build_attestation(), ("producerSourceDigest",), "sha256:ABC"),
            (build_attestation(), ("embeddedIdentitySha256",), "a" * 63),
            (build_attestation(), ("buildIdentity", "sourceCommit"), "deadbeef"),
            (station_snapshot(), ("service", "liveCommit"), "G" * 40),
            (station_snapshot(), ("service", "protocolDigest"), "sha256:xyz"),
            (provider_identity_assertion(), ("providerSubjectFingerprint",), "fingerprint"),
            (provider_account_lease(), ("expiresAt",), "2000-01-01T00:00:00Z"),
            (browser_session_lease(), ("renewBefore",), EXPIRES_AT),
        )
        for payload, keys, value in cases:
            with self.subTest(path=".".join(keys), value=value):
                target = payload
                for key in keys[:-1]:
                    target = target[key]
                target[keys[-1]] = value
                with self.assertRaises(ProofContractError):
                    validate_contract_payload(payload, expected_run_id=RUN_ID)

    def test_build_attestation_requires_platform_signing_semantics(self) -> None:
        cases = (
            ("android", "signerCertificateSha256"),
            ("android", "enabledSigningSchemes"),
            ("ios", "teamIdentifier"),
            ("ios", "applicationIdentifierEntitlement"),
            ("ios", "cdHash"),
        )
        for platform, field in cases:
            with self.subTest(platform=platform, field=field):
                payload = build_attestation(platform)
                del payload["signing"][field]
                with self.assertRaises(ProofContractError):
                    validate_contract_payload(payload, expected_run_id=RUN_ID)


class E20AContractTests(unittest.TestCase):
    def test_e20a_typed_payloads_accept_the_frozen_shapes(self) -> None:
        payloads = (
            physical_device_lease(),
            lease_outcome(
                physical_device_lease(),
                "physical-device",
                "runtime/mobile/leases/devices/alice-ios.json",
            ),
            fresh_install_trace(),
            installed_build_identity(),
        )
        for payload in payloads:
            with self.subTest(kind=payload["artifactKind"]):
                validate_contract_payload(payload, expected_run_id=RUN_ID)

    def test_e20a_physical_device_lease_is_opaque_physical_and_fenced(self) -> None:
        mutations = (
            ("platform", "android"),
            ("resourceKey", "physical-device/bob-ios"),
            ("physicalDeviceRef", "device-ref/bob-ios"),
            ("destinationClassRef", "android-physical"),
            ("fenceToken", 0),
        )
        for field, value in mutations:
            with self.subTest(field=field):
                payload = physical_device_lease()
                payload[field] = value
                with self.assertRaises(ProofContractError):
                    validate_contract_payload(payload, expected_run_id=RUN_ID)

    def test_e20a_acquisition_artifacts_cannot_carry_terminal_state(self) -> None:
        payloads = (
            fixture_lease(),
            provider_account_lease(),
            physical_device_lease(),
            browser_session_lease(),
        )
        for payload in payloads:
            with self.subTest(kind=payload["artifactKind"]):
                payload["state"] = "RELEASED"
                with self.assertRaises(ProofContractError):
                    validate_contract_payload(payload, expected_run_id=RUN_ID)

        for forbidden in ("udid", "serial", "artifactPath"):
            with self.subTest(forbidden=forbidden):
                payload = physical_device_lease()
                payload[forbidden] = "sensitive"
                with self.assertRaises(ProofContractError):
                    validate_contract_payload(payload, expected_run_id=RUN_ID)

    def test_e20a_lease_outcome_terminal_semantics_fail_closed(self) -> None:
        released = lease_outcome(
            physical_device_lease(),
            "physical-device",
            "runtime/mobile/leases/devices/alice-ios.json",
        )
        for field, value in (
            ("cleanupCompleted", False),
            ("baselineRestored", False),
            ("identityReverified", False),
            ("failureCode", "LEASE_CLEANUP_FAILED"),
        ):
            with self.subTest(field=field):
                payload = copy.deepcopy(released)
                payload[field] = value
                with self.assertRaises(ProofContractError):
                    validate_contract_payload(payload, expected_run_id=RUN_ID)

        quarantined = copy.deepcopy(released)
        quarantined.update(
            {
                "finalState": "QUARANTINED",
                "cleanupCompleted": False,
                "baselineRestored": False,
                "identityReverified": False,
                "failureCode": "LEASE_FENCE_STALE",
            }
        )
        validate_contract_payload(quarantined, expected_run_id=RUN_ID)
        quarantined["failureCode"] = "UNTYPED_FAILURE"
        with self.assertRaises(ProofContractError):
            validate_contract_payload(quarantined, expected_run_id=RUN_ID)

    def test_e20a_provider_outcome_requires_serial_completed_operations(self) -> None:
        payload = lease_outcome(
            provider_account_lease(),
            "provider-account",
            "runtime/mobile/leases/accounts/github.json",
        )
        validate_contract_payload(payload, expected_run_id=RUN_ID)
        for field, value in (
            ("started", 0),
            ("completed", 1),
            ("maxObservedConcurrency", 2),
            ("fenceValidated", False),
        ):
            with self.subTest(field=field):
                invalid = copy.deepcopy(payload)
                invalid["operationSummary"][field] = value
                with self.assertRaises(ProofContractError):
                    validate_contract_payload(invalid, expected_run_id=RUN_ID)

        invalid = lease_outcome(
            physical_device_lease(),
            "physical-device",
            "runtime/mobile/leases/devices/alice-ios.json",
        )
        invalid["operationSummary"] = payload["operationSummary"]
        with self.assertRaises(ProofContractError):
            validate_contract_payload(invalid, expected_run_id=RUN_ID)

        quarantined = copy.deepcopy(payload)
        quarantined.update(
            {
                "finalState": "QUARANTINED",
                "cleanupCompleted": False,
                "baselineRestored": False,
                "identityReverified": False,
                "failureCode": "LEASE_OPERATION_INCOMPLETE",
            }
        )
        quarantined["operationSummary"].update(
            {
                "completed": 1,
                "maxObservedConcurrency": 2,
                "fenceValidated": False,
            }
        )
        validate_contract_payload(quarantined, expected_run_id=RUN_ID)
        for field, value in (
            ("completed", 3),
            ("maxObservedConcurrency", 0),
            ("maxObservedConcurrency", 99),
        ):
            with self.subTest(quarantined_counter=field):
                invalid = copy.deepcopy(quarantined)
                invalid["operationSummary"][field] = value
                with self.assertRaises(ProofContractError):
                    validate_contract_payload(
                        invalid,
                        expected_run_id=RUN_ID,
                    )

    def test_e20a_build_resolvers_and_signing_are_platform_separated(self) -> None:
        for platform in ("ios", "android"):
            with self.subTest(platform=platform):
                validate_contract_payload(
                    build_attestation(platform),
                    expected_run_id=RUN_ID,
                )

        invalid_cases = (
            ("android-xcode", "android", "xcode", ["-disableAutomaticPackageResolution"]),
            ("ios-gradle", "ios", "gradle", ["--offline"]),
            ("pnpm-not-offline", "android", "pnpm", ["--frozen-lockfile"]),
        )
        for name, platform, resolver, arguments in invalid_cases:
            with self.subTest(case=name):
                payload = build_attestation(platform)
                payload["buildIsolation"]["resolverArguments"][resolver] = arguments
                with self.assertRaises(ProofContractError):
                    validate_contract_payload(payload, expected_run_id=RUN_ID)

        ios = build_attestation("ios")
        for field, value in (
            ("valueHex", "A" * 40),
            ("valueHex", "a" * 39),
            ("candidateFullValueHex", "b" * 63),
        ):
            with self.subTest(field=field, length=len(value)):
                invalid = copy.deepcopy(ios)
                invalid["signing"]["cdHash"][field] = value
                with self.assertRaises(ProofContractError):
                    validate_contract_payload(invalid, expected_run_id=RUN_ID)

        android = build_attestation("android")
        android["signing"]["cdHash"] = ios["signing"]["cdHash"]
        with self.assertRaises(ProofContractError):
            validate_contract_payload(android, expected_run_id=RUN_ID)

        unrelated_cdhash = build_attestation("ios")
        unrelated_cdhash["signing"]["cdHash"]["valueHex"] = "c" * 40
        with self.assertRaises(ProofContractError):
            validate_contract_payload(
                unrelated_cdhash,
                expected_run_id=RUN_ID,
            )

    def test_e20a_json_schema_requires_platform_resolver_shape(self) -> None:
        schema = proof_contracts._load_schema()
        contract = proof_contracts._kind_schema(
            schema,
            "mobile-application-build-attestation",
        )
        for platform, missing_resolver in (
            ("android", "gradle"),
            ("ios", "xcode"),
        ):
            with self.subTest(platform=platform):
                payload = build_attestation(platform)
                del payload["buildIsolation"]["resolverArguments"][
                    missing_resolver
                ]
                with self.assertRaises(ProofContractError):
                    proof_contracts._validate_schema_value(
                        payload,
                        contract,
                        schema,
                        "$",
                    )

    def test_e20a_exact_twelve_outcomes_match_acquisition_tuples(self) -> None:
        records = payload_inventory()
        validate_artifact_roles(records, expected_run_id=RUN_ID)

        outcome_index = next(
            index
            for index, record in enumerate(records)
            if record.role == "mobile-lease-outcome"
            and record.payload["leaseKind"] == "physical-device"
        )
        for field, value in (
            ("resourceKey", "physical-device/other"),
            ("holderRunId", "other-run"),
            ("fenceToken", 10),
            ("acquisition", {
                **records[outcome_index].payload["acquisition"],
                "sha256": "c" * 64,
            }),
        ):
            with self.subTest(field=field):
                invalid = copy.deepcopy(records)
                invalid[outcome_index].payload[field] = value
                with self.assertRaises(ProofContractError):
                    validate_artifact_roles(invalid, expected_run_id=RUN_ID)

    def test_e20a_build_install_runtime_correlation_is_exact(self) -> None:
        records = payload_inventory()
        mutation_cases = (
            (
                "install-artifact",
                "mobile-fresh-install-trace",
                ("artifactSha256",),
                "sha256:" + ("c" * 64),
            ),
            (
                "install-build-ref",
                "mobile-fresh-install-trace",
                ("buildAttestation", "sha256"),
                "c" * 64,
            ),
            (
                "runtime-build",
                "mobile-installed-build-identity",
                ("buildId",),
                "other-build",
            ),
            (
                "runtime-app",
                "mobile-installed-build-identity",
                ("activeApplicationId",),
                "com.peers.touch.other",
            ),
            (
                "runtime-identity",
                "mobile-installed-build-identity",
                ("webEmbeddedIdentitySha256",),
                "sha256:" + ("c" * 64),
            ),
        )
        for name, role, path, value in mutation_cases:
            with self.subTest(case=name):
                invalid = copy.deepcopy(records)
                record = next(item for item in invalid if item.role == role)
                target = record.payload
                for key in path[:-1]:
                    target = target[key]
                target[path[-1]] = value
                with self.assertRaises(ProofContractError):
                    validate_artifact_roles(invalid, expected_run_id=RUN_ID)

        install = fresh_install_trace()
        install["uninstall"]["priorInstallationAbsent"] = False
        with self.assertRaises(ProofContractError):
            validate_contract_payload(install, expected_run_id=RUN_ID)

        for path, value in (
            (("uninstall", "stepIndex"), 2),
            (("install", "stepIndex"), 1),
            (("uninstall", "completedAt"), "2026-08-29T12:00:01Z"),
        ):
            with self.subTest(order_path=".".join(path)):
                invalid = fresh_install_trace()
                invalid[path[0]][path[1]] = value
                with self.assertRaises(ProofContractError):
                    validate_contract_payload(
                        invalid,
                        expected_run_id=RUN_ID,
                    )

        cross_client = payload_inventory()
        second_ios_install = next(
            item
            for item in cross_client
            if item.role == "mobile-fresh-install-trace"
            and item.payload["clientId"] == "bob-ios"
        )
        second_ios_install.payload["buildAttestation"]["sha256"] = "c" * 64
        with self.assertRaises(ProofContractError):
            validate_artifact_roles(cross_client, expected_run_id=RUN_ID)

        wrong_install_hash = payload_inventory()
        installed = next(
            item
            for item in wrong_install_hash
            if item.role == "mobile-installed-build-identity"
        )
        installed.payload["freshInstallTrace"]["sha256"] = "c" * 64
        with self.assertRaises(ProofContractError):
            validate_artifact_roles(
                wrong_install_hash,
                expected_run_id=RUN_ID,
            )

    def test_e20a_artifact_references_cannot_cross_workspaces(self) -> None:
        records = payload_inventory()
        outcome = next(
            item
            for item in records
            if item.role == "mobile-lease-outcome"
        )
        outcome.payload["acquisition"]["workspaceId"] = "f" * 16
        with self.assertRaises(ProofContractError):
            validate_artifact_roles(records, expected_run_id=RUN_ID)


class ReplayAndRedactionTests(unittest.TestCase):
    def test_replay_handle_is_accepted_only_as_volatile_same_run_input(self) -> None:
        payload = negative_callback_intent("replay")
        validate_contract_payload(
            payload,
            expected_run_id=RUN_ID,
            durable=False,
        )

        with self.assertRaises(ProofContractError):
            validate_contract_payload(
                payload,
                expected_run_id=RUN_ID,
                durable=True,
            )

        payload["holderRunId"] = "stale-run"
        with self.assertRaises(ProofContractError):
            validate_contract_payload(
                payload,
                expected_run_id=RUN_ID,
                durable=False,
            )

    def test_negative_callback_operation_semantics_are_exact(self) -> None:
        cases = (
            ("replay", "oauthProviderMismatch"),
            ("provider_mismatch", "oauthReplay"),
            ("station_mismatch", "oauthProviderMismatch"),
        )
        for operation, wrong_failure in cases:
            with self.subTest(operation=operation):
                payload = negative_callback_intent(operation)
                payload["expectedFailure"] = wrong_failure
                with self.assertRaises(ProofContractError):
                    validate_contract_payload(
                        payload,
                        expected_run_id=RUN_ID,
                        durable=operation != "replay",
                    )

        payload = negative_callback_intent("station_mismatch")
        payload["alternateServiceId"] = "station-primary"
        with self.assertRaises(ProofContractError):
            validate_contract_payload(payload, expected_run_id=RUN_ID)

    def test_all_declared_forbidden_fields_are_rejected_recursively(self) -> None:
        expected_fields = {
            "password",
            "passphrase",
            "mfa",
            "mfacode",
            "otp",
            "cookie",
            "cookies",
            "browserstorage",
            "localstorage",
            "sessionstorage",
            "providerusername",
            "provideremail",
            "providersubject",
            "providersubjectid",
            "callbackurl",
            "authorizationurl",
            "authorizeurl",
            "callbackcode",
            "authorizationcode",
            "pkce",
            "pkceverifier",
            "pkcechallenge",
            "codeverifier",
            "codechallenge",
            "nonce",
            "attemptsecret",
            "accesstoken",
            "refreshtoken",
            "bearertoken",
            "token",
            "envelopeciphertext",
            "privatekey",
            "privatekeypem",
            "artifactpath",
            "absolutepath",
            "udid",
            "serial",
            "deviceserial",
            "certificatesubject",
            "provisioningprofile",
            "schemaversion",
            "schemarevision",
            "protocolversion",
            "protocolrevision",
        }
        self.assertEqual(proof_contracts.FORBIDDEN_FIELD_NAMES, expected_fields)
        for field in sorted(expected_fields):
            with self.subTest(field=field):
                with self.assertRaises(ProofContractError):
                    validate_redaction({"outer": [{field: "sensitive-value"}]})

    def test_representative_secret_byte_canaries_are_rejected(self) -> None:
        canaries = {
            "short-code": "code=oauth-secret-code",
            "short-state": "state=oauth-secret-state",
            "short-token": "token=oauth-secret-token",
            "short-cookie": "cookie=secret-cookie",
            "callback-code": "callback_code=oauth-secret-code",
            "callback-state": "callback_state=oauth-secret-state",
            "pkce": "code_verifier=pkce-secret-verifier",
            "nonce": "nonce=oauth-secret-nonce",
            "token": "access_token=oauth-secret-token",
            "cookie": "Cookie: provider_session=secret-cookie",
            "provider-identity": "provider_subject=opaque-but-sensitive-subject",
            "email": "provider-user@example.test",
            "bearer": "Bearer abcdefghijklmnop",
            "private-key": "-----BEGIN PRIVATE KEY-----",
            "oauth-url": "https://provider.test/callback?code=secret",
            "jwt": "eyJabcdefghijk.abcdefghijklmnop.abcdefghijklmnop",
            "mac-path": "/private/tmp/build/app.ipa",
            "linux-path": "/var/tmp/build/app.apk",
            "windows-path": "C:\\Users\\alice\\build\\app.apk",
            "udid": "UDID=00008110-001234567890801E",
            "legacy-udid": "a" * 40,
            "serial": "device_serial=R58M123456A",
            "lowercase-serial": "r58m123456a",
            "certificate-subject": "certificate_subject=CN=Developer",
        }
        for name, canary in canaries.items():
            with self.subTest(canary=name):
                with self.assertRaises(ProofContractError):
                    validate_redaction({"evidence": canary})

    def test_bare_secret_and_identity_values_are_rejected(self) -> None:
        canaries = (
            "code",
            "state",
            "PKCE",
            "nonce",
            "token",
            "cookie",
            "provider-subject-12345",
            "00008110-001234567890801E",
            "CN=Apple Development: Person",
            "/var/tmp/mobile-proof.json",
        )
        for canary in canaries:
            with self.subTest(canary=canary):
                with self.assertRaises(ProofContractError):
                    validate_redaction({"evidence": canary})

    def test_explicit_absence_sentinels_are_allowed(self) -> None:
        for sentinel in ("Bearer disabled", "Cookie: absent"):
            with self.subTest(sentinel=sentinel):
                validate_redaction({"evidence": sentinel})
        validate_redaction({"sourceCommit": "a" * 40})


def artifact_inventory() -> list[ArtifactRecord]:
    records: list[ArtifactRecord] = []
    for name, role in ARTIFACT_ROLES.items():
        if name == "mobile-visible-proof":
            records.extend(
                ArtifactRecord(
                    name,
                    f"evidence/mobile/{variant}/"
                    f"{proof_contracts.VARIANT_CLIENT[variant]}/",
                )
                for variant in VARIANTS
            )
            continue
        if name == "station-oauth-proof-snapshot":
            for variant in VARIANTS:
                services = (
                    SERVICES
                    if variant.startswith("station-mismatch-")
                    else (
                        proof_contracts.CLIENT_SERVICE[
                            proof_contracts.VARIANT_CLIENT[variant]
                        ],
                    )
                )
                records.extend(
                    ArtifactRecord(
                        name,
                        f"evidence/mobile/{variant}/station/{service}.json",
                    )
                    for service in services
                )
            continue
        if name == "mobile-oauth-fixture-operation":
            operations = (
                ("station-primary", "following-gate-ios"),
                ("station-primary", "following-gate-android"),
                ("station-primary", "expiry-ios"),
                ("station-primary", "expiry-android"),
                ("station-primary", "cleanup-primary"),
                ("station-secondary", "cleanup-secondary"),
            )
            records.extend(
                ArtifactRecord(
                    name,
                    f"runtime/mobile/fixtures/{service_id}/operations/"
                    f"{operation_id}.json",
                )
                for service_id, operation_id in operations
            )
            continue
        if name == "mobile-lease-outcome":
            lease_ids = (
                "account-github",
                "account-google",
                *(f"device-{client_id}" for client_id in CLIENTS),
                *(f"browser-{client_id}" for client_id in CLIENTS),
                *(f"fixture-{service_id}" for service_id in SERVICES),
            )
            records.extend(
                ArtifactRecord(
                    name,
                    f"evidence/mobile/cleanup/leases/{lease_id}.json",
                )
                for lease_id in lease_ids
            )
            continue
        dimension_paths = proof_contracts._dimension_paths(role)
        if dimension_paths is not None:
            records.extend(
                ArtifactRecord(name, path) for path in sorted(dimension_paths)
            )
            continue
        records.append(ArtifactRecord(name, role.path_template))
    return records


def payload_for_record(record: ArtifactRecord) -> dict[str, Any]:
    dimensions = proof_contracts._role_path_dimensions(
        ARTIFACT_ROLES[record.role],
        record.path,
    )
    if record.role == "mobile-build-attestation":
        return build_attestation(dimensions["platform"])
    if record.role == "provider-account-lease":
        return provider_account_lease(dimensions["provider"])
    if record.role == "provider-identity-assertion":
        return provider_identity_assertion(dimensions["provider"])
    if record.role == "physical-device-lease":
        return physical_device_lease(dimensions["clientId"])
    if record.role == "provider-browser-session-lease":
        client_id = dimensions["clientId"]
        return browser_session_lease(
            client_id,
            proof_contracts.CLIENT_PLATFORM[client_id],
        )
    if record.role == "mobile-oauth-fixture-lease":
        return fixture_lease(dimensions["serviceId"])
    if record.role == "mobile-oauth-fixture-operation":
        operation_id = dimensions["operationId"]
        operation_specs = {
            "following-gate-ios": (
                "following-gate-ios",
                "prepare_following_gate",
            ),
            "following-gate-android": (
                "following-gate-android",
                "prepare_following_gate",
            ),
            "expiry-ios": ("expiry-ios", "expire_awaiting_attempt"),
            "expiry-android": ("expiry-android", "expire_awaiting_attempt"),
            "cleanup-primary": ("success-ios-github", "cleanup_run"),
            "cleanup-secondary": ("success-ios-google", "cleanup_run"),
        }
        variant_id, operation = operation_specs[operation_id]
        return fixture_operation(
            operation_id,
            variant_id=variant_id,
            operation=operation,
            service_id=dimensions["serviceId"],
        )
    if record.role == "station-oauth-proof-snapshot":
        return station_snapshot(
            variant_id=dimensions["variantId"],
            service_id=dimensions["serviceId"],
        )
    if record.role == "station-post-cleanup-proof":
        service_id = dimensions["serviceId"]
        variant_id = (
            "replay-ios"
            if service_id == "station-primary"
            else "station-mismatch-ios"
        )
        return station_snapshot(
            phase="post_cleanup",
            service_id=service_id,
            variant_id=variant_id,
        )
    if record.role == "mobile-fresh-install-trace":
        return fresh_install_trace(dimensions["clientId"])
    if record.role == "mobile-installed-build-identity":
        return installed_build_identity(dimensions["clientId"])
    if record.role == "mobile-lease-outcome":
        lease_id = dimensions["leaseId"]
        if lease_id.startswith("account-"):
            provider = lease_id.removeprefix("account-")
            acquisition_path = (
                f"runtime/mobile/leases/accounts/{provider}.json"
            )
            return lease_outcome(
                provider_account_lease(provider),
                "provider-account",
                acquisition_path,
            )
        if lease_id.startswith("device-"):
            client_id = lease_id.removeprefix("device-")
            acquisition_path = (
                f"runtime/mobile/leases/devices/{client_id}.json"
            )
            return lease_outcome(
                physical_device_lease(client_id),
                "physical-device",
                acquisition_path,
            )
        if lease_id.startswith("browser-"):
            client_id = lease_id.removeprefix("browser-")
            acquisition_path = (
                f"runtime/mobile/leases/browsers/{client_id}.json"
            )
            return lease_outcome(
                browser_session_lease(
                    client_id,
                    proof_contracts.CLIENT_PLATFORM[client_id],
                ),
                "provider-browser-session",
                acquisition_path,
            )
        service_id = lease_id.removeprefix("fixture-")
        acquisition_path = f"runtime/mobile/fixtures/{service_id}/lease.json"
        return lease_outcome(
            fixture_lease(service_id),
            "fixture",
            acquisition_path,
        )
    payload: dict[str, Any] = {
        "artifactKind": proof_contracts.ROLE_PAYLOAD_KINDS[record.role],
        "runId": RUN_ID,
        "gateId": GATE_ID,
    }
    payload.update(dimensions)
    return payload


def payload_inventory() -> list[ArtifactRecord]:
    return [
        ArtifactRecord(
            record.role,
            record.path,
            payload_for_record(record),
        )
        for record in artifact_inventory()
    ]


class ArtifactRoleContractTests(unittest.TestCase):
    def test_evidence_role_instances_project_to_complete_frozen_inventory(
        self,
    ) -> None:
        expected_records = payload_inventory()
        payloads_by_path = {
            record.path: record.payload for record in expected_records
        }
        role_counts: dict[str, int] = {}
        artifacts: dict[str, dict[str, Any]] = {}
        for record in expected_records:
            role_index = role_counts.get(record.role, 0)
            role_counts[record.role] = role_index + 1
            role_instance = (
                record.role
                if (
                    ARTIFACT_ROLES[record.role].cardinality == 1
                    or ARTIFACT_ROLES[record.role].minimum_cardinality == 1
                )
                else f"{record.role}/{role_index}"
            )
            reference_path = record.path
            if record.role == "mobile-visible-proof":
                reference_path += "projection.json"
                payloads_by_path[reference_path] = record.payload
            artifacts[role_instance] = artifact_ref(
                reference_path,
                payload=record.payload,
            )
        artifacts["diagnostic-log"] = artifact_ref(
            "logs/mobile-native-access-e2e.log"
        )
        manifest = {
            "workspaceId": WORKSPACE_ID,
            "gateId": GATE_ID,
            "runId": RUN_ID,
            "artifacts": artifacts,
        }

        projected = artifact_records_from_evidence_manifest(
            manifest,
            payload_loader=lambda reference: payloads_by_path[reference.path],
        )
        validated = validate_artifact_roles(
            projected,
            expected_run_id=RUN_ID,
            expected_workspace_id=WORKSPACE_ID,
        )

        self.assertEqual(
            [(record.role, record.path) for record in validated],
            [(record.role, record.path) for record in expected_records],
        )

    def test_evidence_role_projection_rejects_invalid_instance_identity(
        self,
    ) -> None:
        record = payload_inventory()[0]
        manifest = {
            "workspaceId": WORKSPACE_ID,
            "gateId": GATE_ID,
            "runId": RUN_ID,
            "artifacts": {
                f"{record.role}/nested/instance": artifact_ref(
                    record.path,
                    payload=record.payload,
                )
            },
        }
        with self.assertRaisesRegex(
            ProofContractError,
            "invalid Evidence Store Artifact Role instance",
        ):
            artifact_records_from_evidence_manifest(
                manifest,
                payload_loader=lambda _: record.payload,
            )

    def test_evidence_role_projection_rejects_reference_run_mismatch(
        self,
    ) -> None:
        record = payload_inventory()[0]
        manifest = {
            "workspaceId": WORKSPACE_ID,
            "gateId": GATE_ID,
            "runId": RUN_ID,
            "artifacts": {
                record.role: artifact_ref(
                    record.path,
                    run_id="20260830T120000000001Z-" + ("2" * 32),
                )
            },
        }

        with self.assertRaisesRegex(
            ProofContractError,
            "runId does not match its manifest",
        ):
            artifact_records_from_evidence_manifest(
                manifest,
                payload_loader=lambda _: record.payload,
            )

    def test_evidence_role_projection_uses_real_visible_payload_and_path(
        self,
    ) -> None:
        record = next(
            item
            for item in payload_inventory()
            if item.role == "mobile-visible-proof"
        )
        loaded: list[str] = []
        manifest = {
            "workspaceId": WORKSPACE_ID,
            "gateId": GATE_ID,
            "runId": RUN_ID,
            "artifacts": {
                f"{record.role}/success-ios-github": artifact_ref(
                    record.path + "projection.json"
                )
            },
        }

        projected = artifact_records_from_evidence_manifest(
            manifest,
            payload_loader=lambda reference: (
                loaded.append(reference.path) or record.payload
            ),
        )

        self.assertEqual(loaded, [record.path + "projection.json"])
        self.assertEqual(projected, [record])

    def test_role_catalog_has_exact_names_cardinality_and_relations(self) -> None:
        expected = {
            "mobile-proof-contract-catalog": 1,
            "mobile-build-attestation": 2,
            "provider-account-lease": 2,
            "provider-identity-assertion": 2,
            "physical-device-lease": 4,
            "provider-browser-session-lease": 4,
            "mobile-oauth-fixture-lease": 2,
            "mobile-oauth-fixture-operation": 6,
            "mobile-fresh-install-trace": 4,
            "mobile-installed-build-identity": 4,
            "mobile-visible-proof": 16,
            "station-oauth-proof-snapshot": 18,
            "mobile-secure-storage-absence": 4,
            "provider-correlation-channel-destruction": 1,
            "station-post-cleanup-proof": 2,
            "mobile-lease-outcome": 12,
            "mobile-redaction-audit": 1,
            "mobile-native-lifecycle": 1,
            "mobile-native-result": 1,
        }
        self.assertEqual(set(ARTIFACT_ROLES), set(expected))
        for name, cardinality in expected.items():
            with self.subTest(role=name):
                role = ARTIFACT_ROLES[name]
                actual = role.cardinality or role.minimum_cardinality
                self.assertEqual(actual, cardinality)
        validate_artifact_roles(artifact_inventory(), validate_payloads=False)

    def test_missing_duplicate_and_unknown_roles_fail_closed(self) -> None:
        records = artifact_inventory()
        for role_name in sorted(ARTIFACT_ROLES):
            with self.subTest(missing=role_name):
                reduced = [record for record in records if record.role != role_name]
                with self.assertRaises(ProofContractError):
                    validate_artifact_roles(reduced, validate_payloads=False)

        with self.assertRaises(ProofContractError):
            validate_artifact_roles(
                records + [records[0]],
                validate_payloads=False,
            )
        with self.assertRaises(ProofContractError):
            validate_artifact_roles(
                records + [ArtifactRecord("unknown-role", "unknown.json")],
                validate_payloads=False,
            )

    def test_variant_client_and_station_path_relations_are_exact(self) -> None:
        records = artifact_inventory()
        for role_name, replacement in (
            (
                "mobile-visible-proof",
                ArtifactRecord(
                    "mobile-visible-proof",
                    "evidence/mobile/replay-ios/bob-ios/",
                ),
            ),
            (
                "station-oauth-proof-snapshot",
                ArtifactRecord(
                    "station-oauth-proof-snapshot",
                    "evidence/mobile/replay-ios/station/station-secondary.json",
                ),
            ),
        ):
            with self.subTest(role=role_name):
                mutated = list(records)
                index = next(
                    position
                    for position, record in enumerate(mutated)
                    if record.role == role_name
                    and "replay-ios" in record.path
                )
                mutated[index] = replacement
                with self.assertRaises(ProofContractError):
                    validate_artifact_roles(mutated, validate_payloads=False)

    def test_payload_validation_is_strict_and_source_bound(self) -> None:
        records = payload_inventory()
        validate_artifact_roles(
            records,
            expected_run_id=RUN_ID,
            expected_source_commit="1" * 40,
            expected_workspace_digest=SHA256,
        )

        missing = list(records)
        missing[0] = ArtifactRecord(missing[0].role, missing[0].path, None)
        with self.assertRaises(ProofContractError):
            validate_artifact_roles(missing, expected_run_id=RUN_ID)

        unknown = copy.deepcopy(records)
        unknown[0].payload["artifactKind"] = "unknown-proof-kind"
        with self.assertRaises(ProofContractError):
            validate_artifact_roles(unknown, expected_run_id=RUN_ID)

        wrong_known_kind = copy.deepcopy(records)
        wrong_known_kind[0] = ArtifactRecord(
            wrong_known_kind[0].role,
            wrong_known_kind[0].path,
            provider_identity_assertion(),
        )
        with self.assertRaises(ProofContractError):
            validate_artifact_roles(wrong_known_kind, expected_run_id=RUN_ID)

        nested_cross_run = copy.deepcopy(records)
        nested_cross_run[0].payload["sourceRef"] = artifact_ref(
            "runtime/mobile/source.json",
            run_id="20260829T120000000001Z-0123456789abcdef0123456789abcdef",
        )
        with self.assertRaises(ProofContractError):
            validate_artifact_roles(nested_cross_run, expected_run_id=RUN_ID)

        for field, value in (("runId", "other-run"), ("gateId", "other-gate")):
            with self.subTest(field=field):
                mismatched = copy.deepcopy(records)
                mismatched[0].payload[field] = value
                with self.assertRaises(ProofContractError):
                    validate_artifact_roles(mismatched, expected_run_id=RUN_ID)

        for expected_commit, expected_digest in (
            ("2" * 40, SHA256),
            ("1" * 40, "sha256:" + ("b" * 64)),
        ):
            with self.subTest(
                expected_commit=expected_commit,
                expected_digest=expected_digest,
            ):
                with self.assertRaises(ProofContractError):
                    validate_artifact_roles(
                        records,
                        expected_run_id=RUN_ID,
                        expected_source_commit=expected_commit,
                        expected_workspace_digest=expected_digest,
                    )

        validate_artifact_roles(artifact_inventory(), validate_payloads=False)

    def test_role_paths_are_bound_to_payload_dimensions(self) -> None:
        cases = (
            (
                "runtime/mobile/builds/ios.json",
                build_attestation("android"),
            ),
            (
                "runtime/mobile/leases/accounts/github.json",
                provider_account_lease("google"),
            ),
            (
                "runtime/mobile/leases/browsers/alice-ios.json",
                browser_session_lease("bob-ios", "ios"),
            ),
            (
                "evidence/mobile/replay-ios/station/station-primary.json",
                station_snapshot(variant_id="expiry-ios"),
            ),
        )
        for path, wrong_payload in cases:
            with self.subTest(path=path):
                records = payload_inventory()
                index = next(
                    position
                    for position, record in enumerate(records)
                    if record.path == path
                )
                records[index] = ArtifactRecord(
                    records[index].role,
                    path,
                    wrong_payload,
                )
                with self.assertRaises(ProofContractError):
                    validate_artifact_roles(
                        records,
                        expected_run_id=RUN_ID,
                        expected_source_commit="1" * 40,
                        expected_workspace_digest=SHA256,
                    )

    def test_fixture_operations_and_lease_outcomes_are_exact(self) -> None:
        records = payload_inventory()
        read_operation = fixture_operation(
            "read-proof-primary",
            variant_id="replay-ios",
            operation="read_proof_snapshot",
            service_id="station-primary",
        )
        records.append(
            ArtifactRecord(
                "mobile-oauth-fixture-operation",
                "runtime/mobile/fixtures/station-primary/operations/"
                "read-proof-primary.json",
                read_operation,
            )
        )
        validate_artifact_roles(records, expected_run_id=RUN_ID)

        records = payload_inventory()
        operation_index = next(
            index
            for index, record in enumerate(records)
            if record.role == "mobile-oauth-fixture-operation"
            and record.payload["operation"] == "cleanup_run"
        )
        invalid_operation = copy.deepcopy(records)
        invalid_operation_payload = copy.deepcopy(
            invalid_operation[operation_index].payload
        )
        invalid_operation_payload["operation"] = "read_proof_snapshot"
        invalid_operation[operation_index] = ArtifactRecord(
            invalid_operation[operation_index].role,
            invalid_operation[operation_index].path,
            invalid_operation_payload,
        )
        with self.assertRaises(ProofContractError):
            validate_artifact_roles(
                invalid_operation,
                expected_run_id=RUN_ID,
            )

        outcome_index = next(
            index
            for index, record in enumerate(records)
            if record.role == "mobile-lease-outcome"
        )
        invalid_outcome = copy.deepcopy(records[outcome_index].payload)
        invalid_outcome["leaseId"] = "unknown-lease"
        records[outcome_index] = ArtifactRecord(
            records[outcome_index].role,
            records[outcome_index].path,
            invalid_outcome,
        )
        with self.assertRaises(ProofContractError):
            validate_artifact_roles(records, expected_run_id=RUN_ID)

    def test_build_artifact_digest_matches_its_reference(self) -> None:
        payload = build_attestation()
        payload["artifact"]["artifactRef"]["sha256"] = "b" * 64
        with self.assertRaises(ProofContractError):
            validate_contract_payload(payload, expected_run_id=RUN_ID)


class SourcePolicyFixture:
    LOCAL_PACKAGE_MANIFESTS = (
        "packages/client-chat-core/package.json",
        "packages/client-media-security/package.json",
        "packages/client-storage/package.json",
        "packages/locales/package.json",
    )
    VERSION_INPUTS = (
        "package.json",
        "apps/mobile/package.json",
        *LOCAL_PACKAGE_MANIFESTS,
        "apps/mobile/src-tauri/Cargo.toml",
        "apps/mobile/src-tauri/plugins/secure-storage/Cargo.toml",
        "packages/messaging-core/Cargo.toml",
        "apps/mobile/src-tauri/tauri.conf.json",
        "packages/locales/metadata.json",
        "tooling/acceptance/environments/mobile-native.yaml",
    )
    LOCKFILES = (
        "pnpm-lock.yaml",
        "apps/mobile/src-tauri/Cargo.lock",
        "packages/messaging-core/Cargo.lock",
    )

    @staticmethod
    def write(path: Path, content: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    @classmethod
    def create(cls, root: Path) -> None:
        cls.write(
            root / "package.json",
            json.dumps(
                {
                    "name": "root",
                    "private": True,
                    "packageManager": "pnpm@9.12.0",
                    "devDependencies": {"vite": "7.3.1"},
                }
            ),
        )
        package_paths = ("apps/mobile/package.json", *cls.LOCAL_PACKAGE_MANIFESTS)
        for path in package_paths:
            cls.write(
                root / path,
                json.dumps(
                    {
                        "name": path,
                        "version": "0.1.0",
                        "dependencies": {"local-dependency": "workspace:*"},
                    }
                ),
            )
        cargo = """
[package]
name = "fixture"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { version = "1", features = ["derive"] }
"""
        for path in (
            "apps/mobile/src-tauri/Cargo.toml",
            "apps/mobile/src-tauri/plugins/secure-storage/Cargo.toml",
            "packages/messaging-core/Cargo.toml",
        ):
            cls.write(root / path, cargo)
        cls.write(
            root / "apps/mobile/src-tauri/tauri.conf.json",
            json.dumps({"productName": "Peers", "version": "0.1.0"}),
        )
        cls.write(
            root / "packages/locales/metadata.json",
            json.dumps({"version": "0.5.5", "en": {"name": "English"}}),
        )
        cls.write(
            root / "tooling/acceptance/environments/mobile-native.yaml",
            json.dumps(
                {
                    "appium": {
                        "server": {"expected_version": "2.19.0"},
                        "drivers": {
                            "ios": {"expected_version": "9.10.5"},
                            "android": {"expected_version": "4.2.9"},
                        },
                        "android": {
                            "chromedriver": {
                                "browser_major": 124,
                                "artifacts": [
                                    {"driver_version": "124.0.6367.207"}
                                ]
                            }
                        },
                    }
                }
            ),
        )
        cls.write(root / "model/domain/oauth/mobile_oauth.proto", "syntax='proto3';")
        for index, path in enumerate(cls.LOCKFILES):
            cls.write(root / path, f"lock-{index}\n")
        schema = json.loads(proof_contracts.SCHEMA_PATH.read_text(encoding="utf-8"))
        cls.write(
            root
            / "tooling/acceptance/gates/mobile/proof-contract.schema.json",
            json.dumps(schema),
        )


class ProtectedSourcePolicyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        base = Path(self.temporary.name)
        self.baseline_root = base / "baseline"
        self.candidate_root = base / "candidate"
        SourcePolicyFixture.create(self.baseline_root)
        SourcePolicyFixture.create(self.candidate_root)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_protected_snapshot_covers_model_domain_and_all_declared_lockfiles(
        self,
    ) -> None:
        snapshot = protected_path_snapshot(self.candidate_root)
        self.assertEqual(
            set(snapshot),
            {"model/domain", *SourcePolicyFixture.LOCKFILES},
        )

    def test_each_protected_path_drift_fails_closed(self) -> None:
        paths = (
            "model/domain/oauth/mobile_oauth.proto",
            *SourcePolicyFixture.LOCKFILES,
        )
        for path in paths:
            with self.subTest(path=path):
                SourcePolicyFixture.create(self.candidate_root)
                target = self.candidate_root / path
                target.write_bytes(target.read_bytes() + b"\ndrift")
                with self.assertRaises(ProofContractError):
                    verify_protected_paths(
                        self.candidate_root,
                        baseline_root=self.baseline_root,
                    )

    def test_version_snapshot_covers_every_declared_semantic_input(self) -> None:
        snapshot = version_policy_snapshot(self.candidate_root)
        self.assertTrue(
            set(SourcePolicyFixture.VERSION_INPUTS) <= set(snapshot),
            sorted(set(SourcePolicyFixture.VERSION_INPUTS) - set(snapshot)),
        )
        self.assertIsNone(snapshot["schemaRevision"])
        self.assertIsNone(snapshot["protocolRevision"])

    def test_every_semantic_version_input_drift_fails_closed(self) -> None:
        replacements = {
            "package.json": ("pnpm@9.12.0", "pnpm@9.12.1"),
            "apps/mobile/package.json": ("0.1.0", "0.1.1"),
            "packages/client-chat-core/package.json": ("0.1.0", "0.1.1"),
            "packages/client-media-security/package.json": ("0.1.0", "0.1.1"),
            "packages/client-storage/package.json": ("0.1.0", "0.1.1"),
            "packages/locales/package.json": ("0.1.0", "0.1.1"),
            "apps/mobile/src-tauri/Cargo.toml": ("0.1.0", "0.1.1"),
            "apps/mobile/src-tauri/plugins/secure-storage/Cargo.toml": (
                "0.1.0",
                "0.1.1",
            ),
            "packages/messaging-core/Cargo.toml": ("0.1.0", "0.1.1"),
            "apps/mobile/src-tauri/tauri.conf.json": ("0.1.0", "0.1.1"),
            "packages/locales/metadata.json": ("0.5.5", "0.5.6"),
            "tooling/acceptance/environments/mobile-native.yaml": (
                "2.19.0",
                "2.19.1",
            ),
        }
        for path, (old, new) in replacements.items():
            with self.subTest(path=path):
                SourcePolicyFixture.create(self.candidate_root)
                target = self.candidate_root / path
                target.write_text(
                    target.read_text(encoding="utf-8").replace(old, new, 1),
                    encoding="utf-8",
                )
                with self.assertRaises(ProofContractError):
                    verify_version_policy(
                        self.candidate_root,
                        baseline_root=self.baseline_root,
                    )

    def test_mobile_native_driver_version_drift_fails_closed(self) -> None:
        for old, new in (
            ("9.10.5", "9.10.6"),
            ("4.2.9", "4.2.10"),
            ("124.0.6367.207", "124.0.6367.208"),
        ):
            with self.subTest(version=old):
                SourcePolicyFixture.create(self.candidate_root)
                path = (
                    self.candidate_root
                    / "tooling/acceptance/environments/mobile-native.yaml"
                )
                path.write_text(
                    path.read_text(encoding="utf-8").replace(old, new, 1),
                    encoding="utf-8",
                )
                with self.assertRaises(ProofContractError):
                    verify_version_policy(
                        self.candidate_root,
                        baseline_root=self.baseline_root,
                    )

        SourcePolicyFixture.create(self.candidate_root)
        path = (
            self.candidate_root
            / "tooling/acceptance/environments/mobile-native.yaml"
        )
        path.write_text(
            path.read_text(encoding="utf-8").replace(
                '"browser_major": 124',
                '"browser_major": 125',
            ),
            encoding="utf-8",
        )
        with self.assertRaises(ProofContractError):
            verify_version_policy(
                self.candidate_root,
                baseline_root=self.baseline_root,
            )

    def test_cargo_feature_only_change_is_allowed(self) -> None:
        path = self.candidate_root / "apps/mobile/src-tauri/Cargo.toml"
        path.write_text(
            path.read_text(encoding="utf-8").replace(
                'features = ["derive"]',
                'features = ["derive", "rc"]',
            ),
            encoding="utf-8",
        )
        report = verify_version_policy(
            self.candidate_root,
            baseline_root=self.baseline_root,
        )
        self.assertEqual(report["status"], "PASS")

    def test_cargo_table_form_coordinates_and_versions_are_protected(self) -> None:
        manifest = self.candidate_root / "apps/mobile/src-tauri/Cargo.toml"
        manifest.write_text(
            """
[package]
name = "fixture"
version = "0.1.0"
edition = "2021"

[dependencies.serde]
version = "1"
path = "../serde"
features = ["derive"]
default-features = false
optional = true
""",
            encoding="utf-8",
        )
        baseline_manifest = self.baseline_root / "apps/mobile/src-tauri/Cargo.toml"
        baseline_manifest.write_text(
            manifest.read_text(encoding="utf-8"),
            encoding="utf-8",
        )

        for old, new in (
            ('version = "1"', 'version = "2"'),
            ('path = "../serde"', 'path = "../serde-next"'),
        ):
            with self.subTest(old=old):
                manifest.write_text(
                    baseline_manifest.read_text(encoding="utf-8").replace(old, new),
                    encoding="utf-8",
                )
                with self.assertRaises(ProofContractError):
                    verify_version_policy(
                        self.candidate_root,
                        baseline_root=self.baseline_root,
                    )

        for old, new in (
            ('features = ["derive"]', 'features = ["derive", "rc"]'),
            ("default-features = false", "default-features = true"),
            ("optional = true", "optional = false"),
        ):
            with self.subTest(old=old):
                manifest.write_text(
                    baseline_manifest.read_text(encoding="utf-8").replace(old, new),
                    encoding="utf-8",
                )
                report = verify_version_policy(
                    self.candidate_root,
                    baseline_root=self.baseline_root,
                )
                self.assertEqual(report["status"], "PASS")


def cutover_disposition(path: str, source: str) -> set[str]:
    dispositions: set[str] = set()
    for rule in proof_contracts.CUTOVER_RULES:
        if rule.pattern.search(source) is None:
            continue
        if proof_contracts._matches_any(path, rule.retained_paths):
            dispositions.add("retained-simulator-contract")
        elif proof_contracts._matches_any(path, rule.replace_paths):
            dispositions.add("replace-at-e2-5")
        else:
            dispositions.add("unclassified")
    return dispositions


class CutoverInventoryContractTests(unittest.TestCase):
    def test_inventory_declares_every_legacy_class(self) -> None:
        samples = {
            "raw-ios-artifact-path": (
                "tooling/acceptance/environments/mobile-native.yaml",
                '"ios": "env:PT_MOBILE_IOS_APP_PATH"',
            ),
            "raw-android-artifact-path": (
                "tooling/acceptance/environments/mobile-native.yaml",
                '"android": "env:PT_MOBILE_ANDROID_APP_PATH"',
            ),
            "raw-artifact-consumer": (
                "tooling/acceptance/provisioners/mobile_native.py",
                "build_artifacts[platform] = artifact",
            ),
            "legacy-android-avd-destination": (
                "tooling/acceptance/environments/mobile-native.yaml",
                '"destination_ref": "env:PT_MOBILE_ANDROID_' + 'AVD"',
            ),
            "declarative-browser-required-marker": (
                "tooling/acceptance/environments/mobile-native.yaml",
                '"clean_' + 'start": "required"',
            ),
            "stale-physical-install": (
                "tooling/acceptance/gates/mobile/appium.py",
                '"appium:noReset": True',
            ),
            "projection-as-station-readback": (
                "tooling/acceptance/gates/mobile/native_e2e.py",
                'session.call_action("projection.read")  # Station readback',
            ),
            "unsupported-physical-variant": (
                "tooling/acceptance/gates/mobile/native_e2e.py",
                "supported=False",
            ),
            "web-harness-cleanup": (
                "tooling/acceptance/gates/mobile/native_e2e.py",
                'session.call_action("cleanup", {})',
            ),
            "driver-visible-invalid-callback": (
                "tooling/acceptance/gates/mobile/native_e2e.py",
                "session.deep_link_for_failure_case(url, failure_case)",
            ),
            "mobile-native-cleanup-registration": (
                "tooling/acceptance/provisioners/mobile_native.py",
                'self.register_cleanup("mobile-native-actors", cleanup_fixture)',
            ),
        }
        for match_class, (path, source) in samples.items():
            with self.subTest(match_class=match_class):
                self.assertIn(
                    "replace-at-e2-5",
                    cutover_disposition(path, source),
                )

    def test_only_simulator_deep_link_and_reset_exceptions_are_retained(self) -> None:
        simulator_cases = (
            (
                "tooling/acceptance/gates/mobile/simulator_e2e.py",
                "session.deep_link_for_failure_case(url, failure_case)",
            ),
            (
                "tooling/acceptance/gates/mobile/simulator_e2e_test.py",
                '"appium:noReset": True',
            ),
            (
                "tooling/acceptance/gates/mobile/simulator_e2e.py",
                '"appium:noReset": True',
            ),
        )
        for path, source in simulator_cases:
            with self.subTest(path=path):
                self.assertEqual(
                    cutover_disposition(path, source),
                    {"retained-simulator-contract"},
                )

        shared_or_physical_cases = (
            (
                "tooling/acceptance/gates/mobile/appium.py",
                "def deep_link_for_failure_case(self, url, failure_case):",
            ),
            (
                "tooling/acceptance/gates/mobile/appium.py",
                '"appium:noReset": True',
            ),
            (
                "tooling/acceptance/gates/mobile/native_e2e.py",
                "session.deep_link_for_failure_case(url, failure_case)",
            ),
        )
        for path, source in shared_or_physical_cases:
            with self.subTest(path=path):
                self.assertEqual(
                    cutover_disposition(path, source),
                    {"replace-at-e2-5"},
                )

    def test_cutover_scans_native_build_and_extensionless_text_sources(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            paths = (
                "tooling/acceptance/check.sh",
                "tooling/acceptance/Makefile",
                "apps/mobile/Native.swift",
                "apps/mobile/Native.kt",
                "apps/mobile/build.gradle",
                "apps/mobile/build.gradle.kts",
                "apps/mobile/scripts/mobile-proof",
            )
            for path in paths:
                SourcePolicyFixture.write(root / path, "PT_MOBILE_IOS_APP_PATH\n")
            scanned = {
                path
                for path, _ in proof_contracts._iter_text_files(
                    root,
                    ("tooling/acceptance", "apps/mobile"),
                )
            }
            self.assertEqual(scanned, set(paths))


if __name__ == "__main__":
    unittest.main(verbosity=2)
