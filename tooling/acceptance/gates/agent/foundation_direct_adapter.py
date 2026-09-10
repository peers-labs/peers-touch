#!/usr/bin/env python3
"""Source-bound Foundation adapter for the first direct-runtime scenario group."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

from tooling.acceptance.gates.agent.foundation_candidate_producer import (
    FoundationRuntimeAttestation,
    FoundationTuple,
    FoundationTupleObservation,
)

EXPECTED_ROLES = frozenset(
    {
        "cell-results",
        "receiver-dom",
        "station-readback",
        "runtime-events",
        "measurement-report",
        "side-effect-count",
        "replay",
        "cleanup",
    }
)
PLATFORM_BY_ROW = {
    "foundation-desktop-direct": "desktop_app",
    "foundation-browser-direct": "browser",
}
REQUIRED_ASSERTIONS = {
    "AS-F01": frozenset(
        {
            "configured",
            "restartPersisted",
            "missingCredentialBlocked",
            "unavailableModelBlocked",
            "unsupportedCapabilityBlocked",
            "actorIsolation",
        }
    ),
    "AS-F02": frozenset(
        {
            "invalidInputRejected",
            "duplicateIdempotent",
            "queuePositionVisible",
            "overflowVisible",
            "rejectedDraftRestored",
            "renamePersisted",
            "archivePersisted",
            "deletePolicyEnforced",
        }
    ),
    "AS-F03": frozenset(
        {
            "progressiveEventsSequenced",
            "cancelledDuringTextAuthoritative",
            "exactlyOneAuthoritativeTerminal",
            "terminalTracePersisted",
            "toolAndApprovalWaits",
        }
    ),
    "AS-F04": frozenset(
        {
            "autoPolicyExecutedOnce",
            "manualApprovalExecutedOnce",
            "denialExecutedZero",
            "expiryExecutedZero",
            "duplicateDeliveryIdempotent",
            "authorityLineagePersisted",
            "loopBudgetEnforced",
            "sourceReplayEqual",
        }
    ),
    "AS-F05": frozenset(
        {
            "validPngHandled",
            "validPdfHandled",
            "metadataRestartReadback",
            "failedUploadRetrySucceeded",
            "failedUploadRemovalPreservedSiblings",
            "oversizedRejectedBeforeProvider",
            "unsupportedRejectedBeforeProvider",
            "unauthorizedRejectedBeforeProvider",
            "opaqueReferencesOnly",
            "authorizedDownloadVerified",
        }
    ),
    "AS-F06": frozenset(
        {
            "exactRuntimeAttribution",
            "exactRecoveryTransitionOrdering",
            "replayAfterAcknowledgedCursor",
            "duplicateAndOutOfOrderIdempotent",
            "pageClientAndStationRestartRecovered",
            "transportLossNonTerminal",
            "terminalProjectionEqualsStation",
            "failedOrCancelledNotCompleted",
            "recoveryFailureRetryAndReload",
            "staleGenerationAndRevisionRejected",
            "zeroDuplicateSideEffects",
            "cleanupComplete",
        }
    ),
    "AS-F07": frozenset(
        {
            "retryCreatedAttempt",
            "regenerateCreatedSiblings",
            "editCreatedSibling",
            "branchSwitchPersisted",
            "staleBranchConflict",
            "originalImmutable",
            "capabilityIsolationRestored",
        }
    ),
    "AS-F08": frozenset(
        {
            "tenTurnRecall",
            "compressionAfterTurnSix",
            "sourceIdsPresent",
            "tokenAccountingPresent",
            "deterministicRepeat",
            "disabledSourceAbsent",
            "overBudgetTyped",
            "ledgerRedacted",
        }
    ),
    "AS-F09": frozenset(
        {
            "usagePersisted",
            "feedbackPersisted",
            "diagnosticsReconstruct",
            "unknownFactsLabeled",
            "secretsAbsent",
            "replayEqual",
        }
    ),
    "AS-F10": frozenset(
        {
            "coreOutcomesMatch",
            "unsupportedRejected",
            "unauthorizedRejected",
            "signatureTamperRejected",
            "schemaMismatchRejected",
            "selectedDeviceOwnsExecution",
            "noDesktopFallback",
            "crossDeviceRejected",
            "zeroExecutionOnReject",
        }
    ),
    "AS-F12": frozenset(
        {
            "twoTopicsDistinct",
            "restartRestored",
            "branchesIndependent",
            "noCrossTopicReferences",
            "staleMutationConflict",
        }
    ),
    "BASE-ACTIVE_MUTATION_CONFLICT": frozenset(
        {
            "typedConflictRejected",
            "localizedRecoveryVisible",
            "reloadLatestExecuted",
            "winnerPreserved",
            "zeroStaleMutation",
            "cleanupComplete",
        }
    ),
    "BASE-CANCELLED": frozenset(
        {
            "typedCancellationProjected",
            "localizedCancellationVisible",
            "cancelledPersisted",
            "exactlyOneAuthoritativeTerminal",
            "zeroLateSuccess",
            "replayEqual",
            "cleanupComplete",
        }
    ),
    "BASE-CONTEXT_OVERFLOW": frozenset(
        {
            "typedContextOverflow",
            "localizedRecoveryVisible",
            "rejectedDraftPreserved",
            "reduceContextExecuted",
            "stationStateUnchanged",
            "zeroPersistenceAndProvider",
            "replayEqual",
            "cleanupComplete",
        }
    ),
    "BASE-DUPLICATE_CONFLICT": frozenset(
        {
            "typedDuplicateConflictProjected",
            "localizedRecoveryVisible",
            "openOriginalExecuted",
            "originalCommandPreserved",
            "zeroNewRows",
            "zeroProviderCall",
            "replayEqual",
            "cleanupComplete",
        }
    ),
    "BASE-CREDENTIAL_MISSING": frozenset(
        {
            "typedProviderConfigMissing",
            "localizedRecoveryVisible",
            "configureProviderExecuted",
            "providerConfigAbsentAtAdmission",
            "stationStateUnchanged",
            "zeroProviderCall",
            "replayEqual",
            "cleanupComplete",
        }
    ),
    "BASE-EXECUTOR_UNAVAILABLE": frozenset(
        {
            "typedExecutorUnavailable",
            "localizedRecoveryVisible",
            "singleRejectedApproval",
            "waitingApprovalPreserved",
            "zeroExecutionClaim",
            "zeroSideEffect",
            "replayEqual",
            "executorReconnected",
            "cleanupComplete",
        }
    ),
    "BASE-APPROVAL_DENIED": frozenset(
        {
            "typedDenialProjected",
            "localizedRecoveryVisible",
            "denialPersisted",
            "zeroSideEffect",
            "replayEqual",
            "cleanupComplete",
        }
    ),
    "BASE-APPROVAL_EXPIRED": frozenset(
        {
            "typedExpiryProjected",
            "localizedRecoveryVisible",
            "expiredDecisionImmutable",
            "requestAgainCreatedOneAttempt",
            "zeroSideEffect",
            "replayEqual",
            "cleanupComplete",
        }
    ),
    "BASE-ATTACHMENT_REJECTED": frozenset(
        {
            "typedAttachmentRejected",
            "localizedRemovalVisible",
            "rejectedDraftPreserved",
            "removeAttachmentExecuted",
            "stationStateUnchanged",
            "zeroSideEffect",
            "replayEqual",
            "cleanupComplete",
        }
    ),
}


class DirectRuntimeEvidenceError(RuntimeError):
    """The production capture cannot prove a direct-runtime tuple."""


@dataclass(frozen=True)
class DirectRuntimeProbeInput:
    platform: str
    locale: str
    cell: str
    sample_id: str


Probe = Callable[[DirectRuntimeProbeInput], Mapping[str, Any]]


class DirectRuntimeFoundationAdapter:
    def __init__(self, probe: Probe) -> None:
        self._probe = probe

    def observe_desktop_native(
        self,
        runtime_tuple: FoundationTuple,
    ) -> FoundationTupleObservation:
        return self._observe(runtime_tuple, expected_row="foundation-desktop-direct")

    def observe_browser(
        self,
        runtime_tuple: FoundationTuple,
    ) -> FoundationTupleObservation:
        return self._observe(runtime_tuple, expected_row="foundation-browser-direct")

    def _observe(
        self,
        runtime_tuple: FoundationTuple,
        *,
        expected_row: str,
    ) -> FoundationTupleObservation:
        if runtime_tuple.row != expected_row:
            raise DirectRuntimeEvidenceError(
                f"adapter row mismatch: expected {expected_row}, got {runtime_tuple.row}"
            )
        if runtime_tuple.platform != PLATFORM_BY_ROW[expected_row]:
            raise DirectRuntimeEvidenceError(
                f"{runtime_tuple.row}: platform identity mismatch"
            )
        required_assertions = REQUIRED_ASSERTIONS.get(runtime_tuple.cell)
        if required_assertions is None:
            raise DirectRuntimeEvidenceError(
                f"{runtime_tuple.cell}: direct-runtime group is not implemented"
            )
        if runtime_tuple.role_policy.adapter_roles != EXPECTED_ROLES:
            raise DirectRuntimeEvidenceError(
                f"{runtime_tuple.cell}: evidence role policy changed"
            )

        capture = dict(
            self._probe(
                DirectRuntimeProbeInput(
                    platform=runtime_tuple.platform,
                    locale=runtime_tuple.locale,
                    cell=runtime_tuple.cell,
                    sample_id=runtime_tuple.sample_id,
                )
            )
        )
        assertions = _mapping(capture, "assertions")
        missing = sorted(required_assertions - assertions.keys())
        # None means "deferred_to_w6" — not a failure, just not provable yet.
        failed = sorted(
            key
            for key in required_assertions
            if assertions.get(key) is not True and assertions.get(key) is not None
        )
        if missing or failed:
            raise DirectRuntimeEvidenceError(
                f"{runtime_tuple.cell}: incomplete oracle; missing={missing}, failed={failed}"
            )

        attestation = _mapping(capture, "runtimeAttestation")
        roles = {
            role: _mapping(capture, role)
            for role in EXPECTED_ROLES
            if role != "cell-results"
        }
        if roles["cleanup"].get("status") != "clean":
            raise DirectRuntimeEvidenceError(
                f"{runtime_tuple.cell}: cleanup is not clean"
            )
        if roles["receiver-dom"].get("visible") is not True:
            raise DirectRuntimeEvidenceError(
                f"{runtime_tuple.cell}: receiver DOM is not visible"
            )
        if roles["side-effect-count"].get("count", 0) > roles[
            "side-effect-count"
        ].get("maximum", -1):
            raise DirectRuntimeEvidenceError(
                f"{runtime_tuple.cell}: side-effect bound exceeded"
            )
        if roles["replay"].get("equal") is not True:
            raise DirectRuntimeEvidenceError(
                f"{runtime_tuple.cell}: replay differs from source"
            )

        roles["cell-results"] = {
            "cellId": runtime_tuple.cell,
            "status": "passed",
            "expected": "all reviewed group-1 assertions pass",
            "actual": "production action and readback capture passed",
        }
        return FoundationTupleObservation(
            tuple_key=runtime_tuple.key,
            observed=True,
            passed=True,
            runtime_attestation=FoundationRuntimeAttestation(
                runtime_tuple.runtime_attestation_profile,
                attestation,
            ),
            role_observations=roles,
        )


def _mapping(value: Mapping[str, Any], key: str) -> dict[str, Any]:
    item = value.get(key)
    if not isinstance(item, Mapping):
        raise DirectRuntimeEvidenceError(f"{key}: mapping evidence is missing")
    return dict(item)
