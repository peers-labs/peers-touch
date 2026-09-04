from __future__ import annotations

import copy
import hashlib
import json
import unittest

from tooling.acceptance.gates.agent.foundation_group_one_scenarios import (
    GroupOneScenarioError,
    evaluate_base_approval_denied,
    evaluate_base_active_mutation_conflict,
    evaluate_as_f02,
    evaluate_as_f03,
    evaluate_as_f04,
    evaluate_as_f05,
    evaluate_as_f06,
    evaluate_as_f07,
    evaluate_as_f10,
)


def canonical_payload_hash(value: object) -> str:
    return hashlib.sha256(
        json.dumps(
            value,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()


def valid_capture() -> dict[str, object]:
    entries = [
        {"queue_position": position}
        for position in range(1, 9)
    ]
    return {
        "invalidSubmission": {
            "errorCode": "INVALID_REQUEST",
            "conversationDelta": 0,
            "turnDelta": 0,
        },
        "duplicateSubmission": {
            "firstTurnId": "turn-1",
            "replayedTurnId": "turn-1",
            "turnDelta": 1,
            "queueEntryDelta": 0,
        },
        "queueSubmission": {
            "entries": entries,
            "queueCapacity": 8,
            "overflow": {
                "errorCode": "ADMISSION_QUEUE_FULL",
                "queueSize": 8,
            },
            "cancellation": {
                "queueEntryId": "queue-1",
                "status": "cancelled",
            },
            "receiverDom": {
                "visibleQueuePositions": 8,
                "visible": True,
            },
        },
        "draftRecovery": {
            "beforeHash": "draft-hash",
            "afterHash": "draft-hash",
            "editable": True,
        },
        "rename": {
            "expectedTitle": "Renamed topic",
            "readbackTitle": "Renamed topic",
            "versionBefore": 1,
            "versionAfter": 2,
        },
        "archive": {
            "status": "archived",
            "recoverable": True,
        },
        "deletion": {
            "activeDependencyError": "ACTIVE_DEPENDENCY",
            "deletedAfterSettlement": True,
        },
    }


def valid_as_f07_capture() -> dict[str, object]:
    return {
        "toolIsolation": {
            "disabledBindingCount": 1,
            "readyCapabilityCount": 0,
            "originalReadyCapabilityCount": 1,
            "originalReadyCapabilityHash": "f" * 64,
            "restoredBindingCount": 1,
            "restoredReadyCapabilityCount": 1,
            "restoredReadyCapabilityHash": "f" * 64,
            "restorationVerified": True,
        },
        "retry": {
            "sourceConversationId": "conversation-retry",
            "sourceTurnId": "turn-retry",
            "resultTurnId": "turn-retry",
            "attemptId": "attempt-2",
            "attemptsBefore": [
                {
                    "attemptId": "attempt-1",
                    "turnId": "turn-retry",
                    "index": 1,
                }
            ],
            "attemptsAfter": [
                {
                    "attemptId": "attempt-1",
                    "turnId": "turn-retry",
                    "index": 1,
                },
                {
                    "attemptId": "attempt-2",
                    "turnId": "turn-retry",
                    "index": 2,
                },
            ],
        },
        "regenerate": {
            "sourceUserMessageId": "user-source",
            "sourceAssistantMessageId": "assistant-source",
            "first": {
                "messageId": "assistant-regenerate-1",
                "parentMessageId": "user-source",
                "replacesMessageId": "assistant-source",
                "branchId": "branch-1",
            },
            "second": {
                "messageId": "assistant-regenerate-2",
                "parentMessageId": "user-source",
                "replacesMessageId": "assistant-source",
                "branchId": "branch-2",
            },
        },
        "edit": {
            "sourceUserMessageId": "user-source",
            "sourceParentMessageId": "",
            "revisedContentHash": "a" * 64,
            "user": {
                "messageId": "user-edit",
                "replacesMessageId": "user-source",
                "parentMessageId": "",
                "branchId": "branch-edit",
                "contentHash": "a" * 64,
            },
            "assistant": {
                "messageId": "assistant-edit",
                "parentMessageId": "user-edit",
                "branchId": "branch-edit",
            },
            "assistantMessageId": "assistant-edit",
            "activeBranchMessageId": "assistant-edit",
        },
        "branchSelection": {
            "selectedMessageId": "assistant-regenerate-1",
            "responseActiveBranchMessageId": "assistant-regenerate-1",
            "originalResponseActiveBranchMessageId": "assistant-source",
            "originalMessageId": "assistant-source",
            "readbackActiveBranchMessageId": "assistant-regenerate-1",
            "selectedMessageIds": [
                "user-source",
                "assistant-regenerate-1",
            ],
            "renderedMessageIds": [
                "user-source",
                "assistant-regenerate-1",
            ],
            "receiverVisible": True,
        },
        "staleBranch": {
            "errorCode": "VERSION_CONFLICT",
            "beforeHash": "b" * 64,
            "afterHash": "b" * 64,
            "versionBefore": 4,
            "versionAfter": 4,
        },
        "original": {
            "beforeHash": "c" * 64,
            "afterHash": "c" * 64,
            "usageBeforeHash": "d" * 64,
            "usageAfterHash": "d" * 64,
            "attemptCountBefore": 1,
            "attemptCountAfter": 1,
            "feedbackBeforeHash": "e" * 64,
            "feedbackAfterHash": "e" * 64,
            "feedbackCountBefore": 1,
            "feedbackCountAfter": 1,
        },
    }


def valid_as_f10_capture(platform: str = "desktop_app") -> dict[str, object]:
    browser = platform == "browser"
    return {
        "coreOutcome": {
            "stationStatus": "completed",
            "receiverStatus": "completed",
        },
        "toolIsolation": {
            "disabledBindingCount": 1,
            "readyCapabilityCount": 0,
            "originalReadyCapabilityCount": 1,
            "originalReadyCapabilityHash": "f" * 64,
            "restoredBindingCount": 1,
            "restoredReadyCapabilityCount": 1,
            "restoredReadyCapabilityHash": "f" * 64,
            "restorationVerified": True,
        },
        "capabilitySession": {
            "platform": platform,
            "sessionId": "session-1",
            "readinessSessionId": "session-1",
            "deviceId": "device-1",
            "capabilityCount": 0 if browser else 1,
        },
        "selectedDevice": {
            "sessionDeviceId": "device-1",
            "executionDeviceId": None if browser else "device-1",
        },
        "rejections": {
            "unsupported": {
                "accepted": False,
                "errorCode": "CAPABILITY_UNAVAILABLE",
            },
            "unauthorized": {
                "accepted": False,
                "errorCode": "UNAUTHORIZED",
            },
            "signatureTamper": {
                "accepted": False,
                "errorCode": (
                    "CLIENT_CAPABILITY_COMMAND_ERROR_CODE_SIGNATURE_INVALID"
                ),
            },
            "schemaMismatch": {
                "accepted": False,
                "errorCode": "CLIENT_CAPABILITY_SCHEMA_MISMATCH",
            },
            "crossDevice": {
                "accepted": False,
                "errorCode": (
                    "CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_AUTHORITY_MISMATCH"
                ),
            },
        },
        "execution": {
            "localAttemptDelta": 0,
            "sideEffectDelta": 0,
            "resultDelta": 0,
            "continuationDelta": 0,
            "desktopFallbackDelta": 0,
        },
    }


def valid_as_f05_capture() -> dict[str, object]:
    png = {
        "attachmentId": "att-png",
        "objectRef": "oss:cas/fixture/opaque-png",
        "mimeType": "image/png",
        "sizeBytes": 68,
        "checksum": "sha256:png",
        "filename": "fixture.png",
        "authorizationScope": "conversation:conversation-1",
        "expiresAt": "2026-08-29T00:00:00Z",
    }
    pdf = {
        "attachmentId": "att-pdf",
        "objectRef": "oss:cas/fixture/opaque-pdf",
        "mimeType": "application/pdf",
        "sizeBytes": 45,
        "checksum": "sha256:pdf",
        "filename": "fixture.pdf",
        "authorizationScope": "conversation:conversation-1",
        "expiresAt": "2026-08-29T00:00:00Z",
    }
    return {
        "validFiles": {
            "png": {
                **png,
                "modelDisposition": "omitted",
                "modelVisible": False,
                "omissionReason": "selected_model_has_no_image_input",
                "ledgerDecision": 3,
            },
            "pdf": {
                **pdf,
                "modelDisposition": "omitted",
                "modelVisible": False,
                "omissionReason": "selected_model_has_no_file_input",
                "ledgerDecision": 3,
            },
        },
        "persistence": {
            "beforeRestart": [png, pdf],
            "afterRestart": [pdf, png],
            "projectionReadback": [png, pdf],
            "contextSegmentAttachmentIds": ["att-pdf", "att-png"],
        },
        "uploadRecovery": {
            "failedUpload": {
                "errorCode": "CONTEXT_ATTACHMENT_REJECTED",
                "retriedAttachmentId": "att-retried",
                "retriedChecksum": "sha256:retry",
            },
            "removal": {
                "removedAttachmentId": "att-failed",
                "removedObjectUnavailable": True,
                "siblingIdsBefore": ["att-png", "att-pdf"],
                "siblingIdsAfter": ["att-pdf", "att-png"],
                "siblingChecksumsBefore": ["sha256:png", "sha256:pdf"],
                "siblingChecksumsAfter": ["sha256:png", "sha256:pdf"],
            },
        },
        "rejections": {
            "oversized": {
                "accepted": False,
                "errorCode": "CONTEXT_ATTACHMENT_REJECTED",
                "turnDelta": 0,
                "providerExecutionDelta": 0,
                "messageDelta": 0,
            },
            "unsupported": {
                "accepted": False,
                "errorCode": "CONTEXT_ATTACHMENT_REJECTED",
                "turnDelta": 0,
                "providerExecutionDelta": 0,
                "messageDelta": 0,
            },
            "unauthorized": {
                "accepted": False,
                "errorCode": "CONTEXT_ATTACHMENT_REJECTED",
                "turnDelta": 0,
                "providerExecutionDelta": 0,
                "messageDelta": 0,
            },
        },
        "references": [png, pdf],
        "authorizedDownload": {
            "attachmentId": "att-pdf",
            "authorized": True,
            "downloaded": True,
            "expectedChecksum": "sha256:pdf",
            "actualChecksum": "sha256:pdf",
        },
    }


def valid_as_f06_capture(
    platform: str = "desktop_app",
    locale: str = "en",
    sample_id: str = "sample-001",
) -> dict[str, object]:
    def replay_delivery(event_type: str, sequence: int) -> dict[str, object]:
        raw_payload = {
            "eventType": event_type,
            "data": {
                "content": f"chunk-{sequence}",
                "seq": sequence,
                "turnId": "turn-1",
            },
        }
        return {
            "eventType": event_type,
            "sequence": sequence,
            "streamId": "stream-1",
            "streamGeneration": 7,
            "observedAt": f"2026-08-28T00:00:0{sequence}Z",
            "sourceTransport": "station-sse",
            "sourcePtidHash": "b" * 64,
            "sourceConversationId": "conversation-1",
            "sourceTurnId": "turn-1",
            "sourceSequence": sequence,
            "sourceEventType": event_type,
            "rawPayload": raw_payload,
            "payloadHash": canonical_payload_hash(raw_payload),
        }

    replay_deliveries = [
        replay_delivery("text", 3),
        replay_delivery("snapshot", 4),
    ]
    replay_identities = [
        {
            key: value
            for key, value in delivery.items()
            if key not in {"streamId", "streamGeneration", "observedAt"}
        }
        for delivery in replay_deliveries
    ]
    return {
        "scope": {
            "scenarioKey": f"{platform}|{locale}|AS-F06|{sample_id}",
            "platform": platform,
            "locale": locale,
            "sampleId": sample_id,
        },
        "toolIsolation": {
            "disabledBindingCount": 1,
            "readyCapabilityCount": 0,
        },
        "handoff": {
            "conversationId": "conversation-1",
            "turnId": "turn-1",
            "streamId": "stream-1",
            "streamGeneration": 7,
            "actorPtidHash": "b" * 64,
        },
        "transitions": [
            {"phase": "CONNECTION_LOST", "sequence": 2},
            {"phase": "RECONNECTING", "sequence": 2},
            {"phase": "REPLAYING", "sequence": 2},
            {"phase": "RECONCILING", "sequence": 4},
            {"phase": "CONNECTED", "sequence": 4},
        ],
        "replay": {
            "afterCursor": 2,
            "eventSequences": [3, 4],
            "deliveries": replay_deliveries,
            "stationReadbackDeliveries": copy.deepcopy(replay_deliveries),
            "sourceHash": canonical_payload_hash(replay_identities),
            "replayHash": canonical_payload_hash(replay_identities),
        },
        "idempotence": {
            "duplicateSequence": 4,
            "outOfOrderSequence": 3,
            "staleGeneration": 6,
            "activeGeneration": 7,
            "staleGenerationRejected": True,
            "staleTerminalRejected": True,
            "cursorBeforeMutation": 4,
            "cursorAfterMutation": 4,
            "projectionBeforeMutationHash": "e" * 64,
            "projectionAfterMutationHash": "e" * 64,
            "duplicatePayloadHash": "a" * 64,
            "outOfOrderPayloadHash": "b" * 64,
        },
        "restartRecovery": {
            "pageSwitched": True,
            "clientReloaded": True,
            "stationRestarted": True,
            "stationRestart": {
                "outageObserved": True,
                "beforeStartedAt": "2026-08-28T00:00:00Z",
                "afterStartedAt": "2026-08-28T00:01:00Z",
                "beforeCommit": "a" * 12,
                "afterCommit": "a" * 12,
            },
        },
        "transportLoss": {"observed": True, "nonTerminal": True},
        "terminalProjection": {
            "stationStatus": "completed",
            "clientStatus": "completed",
            "stationHash": "terminal-hash",
            "clientHash": "terminal-hash",
            "prefixPreserved": True,
        },
        "recoveryFailure": {
            "errorHash": "a" * 64,
            "blocker": "",
            "activeFailureObserved": True,
            "expectedActorPtidHash": "b" * 64,
            "observedActorPtidHash": "b" * 64,
            "sessionProjectionAvailable": False,
            "sessionActorMatches": True,
            "expectedTurnId": "turn-1",
            "observedTurnId": "turn-1",
            "expectedStreamId": "stream-1",
            "observedStreamId": "stream-1",
            "expectedStreamGeneration": 7,
            "observedStreamGeneration": 7,
            "notCompleted": True,
            "retry": {
                "invoked": True,
                "observed": True,
                "recoveryEpochBefore": 1,
                "recoveryEpochAfter": 2,
                "resultingPhase": "REPLAYING",
            },
            "durableReload": {
                "invoked": True,
                "observed": True,
                "source": "station-snapshot-reconcile",
                "actorPtidHash": "b" * 64,
                "conversationId": "conversation-1",
                "turnId": "turn-1",
                "streamId": "stream-1",
                "streamGeneration": 7,
                "status": "running",
                "sequence": 4,
                "terminal": False,
                "terminalStatus": None,
                "sourceDelivery": {
                    "transport": "station-sse",
                    "actorPtidHash": "b" * 64,
                    "conversationId": "conversation-1",
                    "turnId": "turn-1",
                    "sequence": 4,
                    "eventType": "snapshot",
                    "rawPayloadHash": "c" * 64,
                },
            },
        },
        "staleRevision": {"rejected": True},
        "sideEffects": {
            "before": {"sourceHash": "c" * 64},
            "after": {"sourceHash": "d" * 64},
            "duplicateMutationBefore": 0,
            "duplicateMutationAfter": 0,
            "duplicateMutationDelta": 0,
            "duplicateSideEffectBefore": 0,
            "duplicateSideEffectAfter": 0,
            "duplicateSideEffectDelta": 0,
        },
        "cleanup": {
            "handoffCleared": True,
            "conversationDeleted": True,
            "recoveryRecordCleared": True,
            "deletionErrorCodeHash": "f" * 64,
        },
    }


def valid_as_f03_capture() -> dict[str, object]:
    return {
        "events": [
            {"eventType": "progress", "sequence": 1},
            {"eventType": "text", "sequence": 2},
            {"eventType": "cancelled", "sequence": 3},
        ],
        "sawTextBeforeCancel": True,
        "thinkingMode": "disabled",
        "terminalTracePersisted": True,
        "toolIsolation": {
            "disabledBindingCount": 1,
            "readyCapabilityCount": 0,
        },
        "toolDefinitionTokens": 0,
    }


def valid_as_f04_capture(
    platform: str = "desktop_app",
) -> dict[str, object]:
    execution_owner = (
        "station" if platform == "browser" else "client_capability"
    )

    def lineage(suffix: str, *, terminal: bool) -> dict[str, object]:
        result: dict[str, object] = {
            "toolCallId": f"tool-call-{suffix}",
            "toolBatchId": f"tool-batch-{suffix}",
            "manifestId": f"manifest-{suffix}",
            "manifestVersion": "1",
            "bindingId": f"binding-{suffix}",
            "bindingRevision": 1,
            "readinessSnapshotId": f"readiness-{suffix}",
            "approvalId": f"approval-{suffix}",
            "decisionId": f"decision-{suffix}",
        }
        if terminal:
            result.update(
                {
                    "executionClaimId": f"claim-{suffix}",
                    "fencingToken": 1,
                    "sideEffectReceiptId": f"receipt-{suffix}",
                    "resultId": f"result-{suffix}",
                    "continuationId": f"continuation-{suffix}",
                    "dispatchCommittedAt": "2026-08-28T00:00:00Z",
                    "startedAt": "2026-08-28T00:00:01Z",
                    "endedAt": "2026-08-28T00:00:02Z",
                }
            )
        return result

    expiry_lineage = lineage("expiry", terminal=False)
    expiry_lineage["decisionId"] = ""
    return {
        "cases": {
            "auto": {
                "policy": "auto",
                "executionOwner": execution_owner,
                "states": [
                    "policy_check",
                    "auto_approved",
                    "running",
                    "succeeded",
                ],
                "executionAttemptCount": 1,
                "sideEffectCount": 1,
                "resultCount": 1,
                "continuationCount": 1,
                "lineage": lineage("auto", terminal=True),
            },
            "manual": {
                "policy": "manual",
                "executionOwner": execution_owner,
                "states": [
                    "policy_check",
                    "awaiting_user",
                    "approved",
                    "running",
                    "succeeded",
                ],
                "executionAttemptCount": 1,
                "sideEffectCount": 1,
                "resultCount": 1,
                "continuationCount": 1,
                "lineage": lineage("manual", terminal=True),
            },
            "deny": {
                "policy": "deny",
                "executionOwner": execution_owner,
                "states": ["policy_check", "denied"],
                "executionAttemptCount": 0,
                "sideEffectCount": 0,
                "resultCount": 0,
                "continuationCount": 0,
                "lineage": lineage("deny", terminal=False),
            },
            "expiry": {
                "policy": "manual",
                "executionOwner": execution_owner,
                "states": ["policy_check", "awaiting_user", "expired"],
                "executionAttemptCount": 0,
                "sideEffectCount": 0,
                "resultCount": 0,
                "continuationCount": 0,
                "lineage": expiry_lineage,
            },
        },
        "duplicateDelivery": {
            "deliveryCount": 2,
            "executionAttemptCount": 1,
            "sideEffectCount": 1,
            "resultCount": 1,
            "continuationCount": 1,
            "originalResultId": "result-auto",
            "replayedResultId": "result-auto",
            "originalContinuationId": "continuation-auto",
            "replayedContinuationId": "continuation-auto",
        },
        "loopBudget": {
            "stopped": True,
            "terminalReason": "max_tool_calls_exhausted",
            "requestedLimit": 2,
            "effectiveLimit": 2,
            "observedIterations": 2,
            "maximumIterations": 2,
            "executionAfterLimit": 0,
        },
        "replay": {
            "sourceHash": "source-hash",
            "replayHash": "source-hash",
            "equal": True,
        },
    }


def valid_active_mutation_conflict_capture() -> dict[str, object]:
    return {
        "rejection": {
            "code": "ADMISSION_ACTIVE_MUTATION_CONFLICT",
            "localeKey": "agent.errors.activeMutationConflict",
            "retryable": True,
            "terminal": True,
            "details": {
                "resource_id": "agent-conflict",
                "expected_revision": "3",
                "actual_revision": "4",
            },
        },
        "winner": {
            "resourceId": "agent-conflict",
            "expectedRevision": 3,
            "actualRevision": 4,
            "revisionBeforeStale": 4,
            "revisionAfterStale": 4,
            "revisionAfterReload": 4,
            "hashBeforeStale": "a" * 64,
            "hashAfterStale": "a" * 64,
            "hashAfterReload": "a" * 64,
        },
        "staleMutation": {
            "attemptedRevision": 3,
            "mutationDelta": 0,
        },
        "receiver": {
            "conflictVisible": True,
            "conflictText": "This item changed while you were editing it.",
            "expectedConflictText": "This item changed while you were editing it.",
            "reloadVisible": True,
            "reloadText": "Reload latest",
            "expectedReloadText": "Reload latest",
            "reloadExecuted": True,
            "reloadedRevision": 4,
        },
        "cleanup": {
            "deletedFromRoster": True,
            "deletedFromStation": True,
            "priorSelection": "assistant",
            "restoredSelection": "assistant",
        },
    }


def valid_approval_denied_capture() -> dict[str, object]:
    return {
        "outcome": {
            "error": "agent.errors.toolApprovalDenied",
            "error_type": "TOOL_APPROVAL_DENIED",
            "locale_key": "agent.errors.toolApprovalDenied",
            "retryable": False,
            "terminal": True,
            "details": {
                "tool_call_id": "tool-call-denied",
                "decision_id": "decision-denied",
            },
        },
        "receiver": {
            "recoveryVisible": True,
            "recoveryText": "Continue without tool",
            "expectedRecoveryText": "Continue without tool",
            "recoveryExecuted": True,
            "errorVisible": True,
            "errorText": "Tool execution was not approved.",
            "expectedErrorText": "Tool execution was not approved.",
        },
        "decision": {
            "accepted": True,
            "approved": False,
            "approvalId": "approval-denied",
            "toolCallId": "tool-call-denied",
            "decisionId": "decision-denied",
            "decisionRevision": 1,
        },
        "station": {
            "policy": "manual",
            "states": ["policy_check", "awaiting_user", "denied"],
            "errorCode": "TOOL_APPROVAL_DENIED",
            "executionAttemptCount": 0,
            "sideEffectCount": 0,
            "resultCount": 0,
            "continuationCount": 0,
            "lineage": {
                "toolCallId": "tool-call-denied",
                "decisionId": "decision-denied",
                "decisionRevision": 1,
            },
        },
        "replay": {
            "acknowledgementSourceHash": "a" * 64,
            "acknowledgementReplayHash": "a" * 64,
            "diagnosticSourceHash": "b" * 64,
            "diagnosticReplayHash": "b" * 64,
            "equal": True,
        },
        "cleanup": {
            "bindingRestored": True,
            "conversationDeleted": True,
        },
    }


class FoundationGroupOneScenariosTest(unittest.TestCase):
    def test_as_f06_accepts_source_bound_recovery_facts(self) -> None:
        assertions = evaluate_as_f06(
            valid_as_f06_capture(),
            platform="desktop_app",
            locale="en",
            sample_id="sample-001",
        )

        self.assertEqual(len(assertions), 12)
        self.assertTrue(all(assertions.values()))

    def test_as_f06_rejects_transition_reordering(self) -> None:
        capture = valid_as_f06_capture()
        capture["transitions"][2], capture["transitions"][3] = (
            capture["transitions"][3],
            capture["transitions"][2],
        )

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "exactRecoveryTransitionOrdering",
        ):
            evaluate_as_f06(
                capture,
                platform="desktop_app",
                locale="en",
                sample_id="sample-001",
            )

    def test_as_f06_rejects_tuple_attribution_mutation(self) -> None:
        capture = valid_as_f06_capture()
        capture["scope"]["locale"] = "zh-CN"

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "exactRuntimeAttribution",
        ):
            evaluate_as_f06(
                capture,
                platform="desktop_app",
                locale="en",
                sample_id="sample-001",
            )

    def test_as_f06_rejects_ready_capability_during_recovery_probe(self) -> None:
        capture = valid_as_f06_capture()
        isolation = capture["toolIsolation"]
        assert isinstance(isolation, dict)
        isolation["readyCapabilityCount"] = 1

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "exactRuntimeAttribution",
        ):
            evaluate_as_f06(
                capture,
                platform="desktop_app",
                locale="en",
                sample_id="sample-001",
            )

    def test_as_f06_rejects_replayed_cursor_and_stale_fence_mutations(
        self,
    ) -> None:
        for mutation, expected in (
            (
                lambda capture: capture["replay"].update(
                    {"eventSequences": [2, 3]}
                ),
                "replayAfterAcknowledgedCursor",
            ),
            (
                lambda capture: capture["idempotence"].update(
                    {"staleGeneration": 7}
                ),
                "staleGenerationAndRevisionRejected",
            ),
        ):
            with self.subTest(expected=expected):
                capture = valid_as_f06_capture()
                mutation(capture)
                with self.assertRaisesRegex(GroupOneScenarioError, expected):
                    evaluate_as_f06(
                        capture,
                        platform="desktop_app",
                        locale="en",
                        sample_id="sample-001",
                    )

    def test_as_f06_rejects_control_events_and_unbound_payload_hashes(
        self,
    ) -> None:
        def synthesize_connected_control(delivery: dict[str, object]) -> None:
            raw_payload = {
                **delivery["rawPayload"],
                "eventType": "connected",
            }
            delivery.update(
                {
                    "eventType": "connected",
                    "rawPayload": raw_payload,
                    "payloadHash": canonical_payload_hash(raw_payload),
                }
            )

        mutations = (
            synthesize_connected_control,
            lambda delivery: delivery["rawPayload"]["data"].update(
                {"content": "forged"}
            ),
            lambda delivery: delivery.update({"payloadHash": "a" * 64}),
            lambda delivery: delivery.update({"sourcePtidHash": "e" * 64}),
        )
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                capture = valid_as_f06_capture()
                delivery = capture["replay"]["deliveries"][0]
                mutation(delivery)
                with self.assertRaisesRegex(
                    GroupOneScenarioError,
                    "replayAfterAcknowledgedCursor",
                ):
                    evaluate_as_f06(
                        capture,
                        platform="desktop_app",
                        locale="en",
                        sample_id="sample-001",
                    )

        capture = valid_as_f06_capture()
        capture["replay"]["stationReadbackDeliveries"][0]["sourceSequence"] = 9
        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "replayAfterAcknowledgedCursor",
        ):
            evaluate_as_f06(
                capture,
                platform="desktop_app",
                locale="en",
                sample_id="sample-001",
            )

    def test_as_f06_rejects_wrong_recovery_actor_stream_and_generation(
        self,
    ) -> None:
        for key, value in (
            ("observedActorPtidHash", "e" * 64),
            ("sessionActorMatches", False),
            ("observedStreamId", "stream-forged"),
            ("observedStreamGeneration", 8),
        ):
            with self.subTest(key=key):
                capture = valid_as_f06_capture()
                capture["recoveryFailure"][key] = value
                with self.assertRaisesRegex(
                    GroupOneScenarioError,
                    "recoveryFailureRetryAndReload",
                ):
                    evaluate_as_f06(
                        capture,
                        platform="desktop_app",
                        locale="en",
                        sample_id="sample-001",
                    )

    def test_as_f06_rejects_reload_without_source_bound_result(self) -> None:
        capture = valid_as_f06_capture()
        capture["recoveryFailure"]["durableReload"].update(
            {
                "observed": True,
                "source": "shared-store-inference",
            }
        )

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "recoveryFailureRetryAndReload",
        ):
            evaluate_as_f06(
                capture,
                platform="desktop_app",
                locale="en",
                sample_id="sample-001",
            )

    def test_as_f06_rejects_forged_recovery_and_duplicate_constants(
        self,
    ) -> None:
        for mutation, expected in (
            (
                lambda capture: capture["recoveryFailure"].update(
                    {
                        "blocker": (
                            "AS_F06_ACTIVE_RECOVERY_FAILURE_NOT_OBSERVED"
                        ),
                        "activeFailureObserved": False,
                    }
                ),
                "AS_F06_ACTIVE_RECOVERY_FAILURE_NOT_OBSERVED",
            ),
            (
                lambda capture: capture["sideEffects"].update(
                    {"duplicateMutationDelta": 1}
                ),
                "zeroDuplicateSideEffects",
            ),
            (
                lambda capture: capture["sideEffects"].update(
                    {"duplicateMutationAfter": 1}
                ),
                "zeroDuplicateSideEffects",
            ),
            (
                lambda capture: capture["sideEffects"].update(
                    {"before": {"sourceHash": "forged"}}
                ),
                "zeroDuplicateSideEffects",
            ),
            (
                lambda capture: capture["idempotence"].update(
                    {"cursorAfterMutation": 5}
                ),
                "duplicateAndOutOfOrderIdempotent",
            ),
            (
                lambda capture: capture["idempotence"].update(
                    {"projectionAfterMutationHash": "f" * 64}
                ),
                "duplicateAndOutOfOrderIdempotent",
            ),
        ):
            with self.subTest(expected=expected):
                capture = valid_as_f06_capture()
                mutation(capture)
                with self.assertRaisesRegex(GroupOneScenarioError, expected):
                    evaluate_as_f06(
                        capture,
                        platform="desktop_app",
                        locale="en",
                        sample_id="sample-001",
                    )

    def test_as_f03_accepts_sequenced_text_then_cancel(self) -> None:
        assertions = evaluate_as_f03(valid_as_f03_capture())

        self.assertTrue(assertions["progressiveEventsSequenced"])
        self.assertTrue(assertions["cancelledDuringTextAuthoritative"])
        self.assertTrue(assertions["exactlyOneAuthoritativeTerminal"])
        self.assertIsNone(assertions["toolAndApprovalWaits"])

    def test_as_f03_rejects_terminal_after_cancel(self) -> None:
        capture = valid_as_f03_capture()
        events = capture["events"]
        assert isinstance(events, list)
        events.append({"eventType": "done", "sequence": 4})

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "exactlyOneAuthoritativeTerminal",
        ):
            evaluate_as_f03(capture)

    def test_as_f03_rejects_implicit_thinking_mode(self) -> None:
        capture = valid_as_f03_capture()
        capture["thinkingMode"] = "auto"

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "cancelledDuringTextAuthoritative",
        ):
            evaluate_as_f03(capture)

    def test_as_f03_rejects_thinking_delta_when_disabled(self) -> None:
        capture = valid_as_f03_capture()
        events = capture["events"]
        assert isinstance(events, list)
        events.insert(1, {"eventType": "thinking", "sequence": 2})
        events[2]["sequence"] = 3
        events[3]["sequence"] = 4

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "progressiveEventsSequenced",
        ):
            evaluate_as_f03(capture)

    def test_as_f03_rejects_ready_capability_during_text_probe(self) -> None:
        capture = valid_as_f03_capture()
        isolation = capture["toolIsolation"]
        assert isinstance(isolation, dict)
        isolation["readyCapabilityCount"] = 1

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "progressiveEventsSequenced",
        ):
            evaluate_as_f03(capture)

    def test_as_f03_rejects_tool_definitions_in_runtime_snapshot(self) -> None:
        capture = valid_as_f03_capture()
        capture["toolDefinitionTokens"] = 61

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "progressiveEventsSequenced",
        ):
            evaluate_as_f03(capture)

    def test_as_f04_accepts_governed_desktop_and_browser_facts(self) -> None:
        for platform in ("desktop_app", "browser"):
            with self.subTest(platform=platform):
                assertions = evaluate_as_f04(
                    valid_as_f04_capture(platform),
                    platform=platform,
                )

                self.assertEqual(len(assertions), 8)
                self.assertTrue(all(assertions.values()))

    def test_as_f04_rejects_duplicate_side_effect(self) -> None:
        capture = valid_as_f04_capture()
        duplicate = capture["duplicateDelivery"]
        assert isinstance(duplicate, dict)
        duplicate["sideEffectCount"] = 2

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "duplicateDeliveryIdempotent",
        ):
            evaluate_as_f04(capture, platform="desktop_app")

    def test_as_f04_rejects_browser_client_execution(self) -> None:
        capture = valid_as_f04_capture("browser")
        cases = capture["cases"]
        assert isinstance(cases, dict)
        auto = cases["auto"]
        assert isinstance(auto, dict)
        auto["executionOwner"] = "client_capability"

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "authorityLineagePersisted",
        ):
            evaluate_as_f04(capture, platform="browser")

    def test_as_f04_rejects_untyped_loop_budget_terminal(self) -> None:
        capture = valid_as_f04_capture()
        loop_budget = capture["loopBudget"]
        assert isinstance(loop_budget, dict)
        loop_budget["terminalReason"] = "completed"

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "loopBudgetEnforced",
        ):
            evaluate_as_f04(capture, platform="desktop_app")

    def test_as_f04_rejects_requested_effective_or_observed_limit_drift(
        self,
    ) -> None:
        for key in (
            "requestedLimit",
            "effectiveLimit",
            "observedIterations",
            "maximumIterations",
        ):
            with self.subTest(key=key):
                capture = valid_as_f04_capture()
                loop_budget = capture["loopBudget"]
                assert isinstance(loop_budget, dict)
                loop_budget[key] = 3

                with self.assertRaisesRegex(
                    GroupOneScenarioError,
                    "loopBudgetEnforced",
                ):
                    evaluate_as_f04(capture, platform="desktop_app")

    def test_as_f05_accepts_complete_attachment_facts(self) -> None:
        assertions = evaluate_as_f05(valid_as_f05_capture())

        self.assertEqual(len(assertions), 10)
        self.assertTrue(all(assertions.values()))

    def test_as_f05_accepts_explicit_model_omission(self) -> None:
        capture = valid_as_f05_capture()
        valid_files = capture["validFiles"]
        assert isinstance(valid_files, dict)
        for fact in valid_files.values():
            assert isinstance(fact, dict)
            fact["modelDisposition"] = "omitted"
            fact["modelVisible"] = False
            fact["omissionReason"] = "selected_model_has_no_file_input"
            fact["ledgerDecision"] = 3

        assertions = evaluate_as_f05(capture)
        self.assertTrue(assertions["validPngHandled"])
        self.assertTrue(assertions["validPdfHandled"])

    def test_as_f05_rejects_provider_execution_for_invalid_attachment(self) -> None:
        capture = valid_as_f05_capture()
        rejections = capture["rejections"]
        assert isinstance(rejections, dict)
        oversized = rejections["oversized"]
        assert isinstance(oversized, dict)
        oversized["providerExecutionDelta"] = 1

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "oversizedRejectedBeforeProvider",
        ):
            evaluate_as_f05(capture)

    def test_as_f05_rejects_local_path_reference(self) -> None:
        capture = valid_as_f05_capture()
        references = capture["references"]
        assert isinstance(references, list)
        references[0]["objectRef"] = "/Users/example/fixture.png"

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "opaque authorized reference",
        ):
            evaluate_as_f05(capture)

    def test_as_f05_rejects_restart_metadata_drift(self) -> None:
        capture = copy.deepcopy(valid_as_f05_capture())
        persistence = capture["persistence"]
        assert isinstance(persistence, dict)
        after_restart = persistence["afterRestart"]
        assert isinstance(after_restart, list)
        after_restart[0] = {
            **after_restart[0],
            "checksum": "sha256:changed",
        }

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "metadataRestartReadback",
        ):
            evaluate_as_f05(capture)

    def test_as_f05_rejects_sibling_loss_after_failed_upload_removal(self) -> None:
        capture = valid_as_f05_capture()
        recovery = capture["uploadRecovery"]
        assert isinstance(recovery, dict)
        removal = recovery["removal"]
        assert isinstance(removal, dict)
        removal["siblingIdsAfter"] = ["att-png"]

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "failedUploadRemovalPreservedSiblings",
        ):
            evaluate_as_f05(capture)

    def test_as_f02_accepts_complete_production_facts(self) -> None:
        assertions = evaluate_as_f02(valid_capture())

        self.assertEqual(len(assertions), 8)
        self.assertTrue(all(assertions.values()))

    def test_as_f02_rejects_missing_fact(self) -> None:
        capture = valid_capture()
        del capture["draftRecovery"]

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "draftRecovery fact is missing",
        ):
            evaluate_as_f02(capture)

    def test_as_f02_rejects_non_fifo_positions(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["queueSubmission"]["entries"][4]["queue_position"] = 4

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "queue positions are not FIFO",
        ):
            evaluate_as_f02(capture)

    def test_as_f02_rejects_placeholder_duplicate_identity(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["duplicateSubmission"]["firstTurnId"] = ""
        capture["duplicateSubmission"]["replayedTurnId"] = ""

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "firstTurnId must be a non-empty string",
        ):
            evaluate_as_f02(capture)

    def test_as_f07_accepts_complete_revision_facts(self) -> None:
        assertions = evaluate_as_f07(valid_as_f07_capture())

        self.assertEqual(len(assertions), 7)
        self.assertTrue(all(assertions.values()))

    def test_as_f07_rejects_unrestored_capability_isolation(self) -> None:
        capture = copy.deepcopy(valid_as_f07_capture())
        capture["toolIsolation"]["restorationVerified"] = False

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "capabilityIsolationRestored",
        ):
            evaluate_as_f07(capture)

    def test_as_f07_rejects_nonzero_isolated_readiness(self) -> None:
        capture = copy.deepcopy(valid_as_f07_capture())
        capture["toolIsolation"]["readyCapabilityCount"] = 1

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "capabilityIsolationRestored",
        ):
            evaluate_as_f07(capture)

    def test_as_f07_rejects_empty_capability_isolation(self) -> None:
        capture = copy.deepcopy(valid_as_f07_capture())
        capture["toolIsolation"]["disabledBindingCount"] = 0
        capture["toolIsolation"]["restoredBindingCount"] = 0

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "disabledBindingCount must be a positive integer",
        ):
            evaluate_as_f07(capture)

    def test_as_f07_rejects_empty_original_readiness(self) -> None:
        capture = copy.deepcopy(valid_as_f07_capture())
        capture["toolIsolation"]["originalReadyCapabilityCount"] = 0
        capture["toolIsolation"]["restoredReadyCapabilityCount"] = 0

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "originalReadyCapabilityCount must be a positive integer",
        ):
            evaluate_as_f07(capture)

    def test_as_f07_rejects_non_hex_capability_hash(self) -> None:
        capture = copy.deepcopy(valid_as_f07_capture())
        capture["toolIsolation"]["originalReadyCapabilityHash"] = "z" * 64
        capture["toolIsolation"]["restoredReadyCapabilityHash"] = "z" * 64

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "capabilityIsolationRestored",
        ):
            evaluate_as_f07(capture)

    def test_as_f07_rejects_regenerate_lineage_drift(self) -> None:
        capture = copy.deepcopy(valid_as_f07_capture())
        capture["regenerate"]["second"]["parentMessageId"] = "wrong-parent"

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "regenerateCreatedSiblings",
        ):
            evaluate_as_f07(capture)

    def test_as_f07_rejects_stale_branch_mutation(self) -> None:
        capture = copy.deepcopy(valid_as_f07_capture())
        capture["staleBranch"]["afterHash"] = "f" * 64

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "staleBranchConflict",
        ):
            evaluate_as_f07(capture)

    def test_as_f07_rejects_original_evidence_mutation(self) -> None:
        capture = copy.deepcopy(valid_as_f07_capture())
        capture["original"]["feedbackAfterHash"] = "f" * 64

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "originalImmutable",
        ):
            evaluate_as_f07(capture)

    def test_as_f07_rejects_empty_original_evidence(self) -> None:
        capture = copy.deepcopy(valid_as_f07_capture())
        capture["original"]["feedbackCountBefore"] = 0
        capture["original"]["feedbackCountAfter"] = 0

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "feedbackCountBefore must be a positive integer",
        ):
            evaluate_as_f07(capture)

    def test_as_f10_accepts_desktop_and_browser_production_facts(self) -> None:
        for platform in ("desktop_app", "browser"):
            with self.subTest(platform=platform):
                assertions = evaluate_as_f10(
                    valid_as_f10_capture(platform),
                    platform=platform,
                )

                self.assertEqual(len(assertions), 9)
                self.assertTrue(all(assertions.values()))

    def test_as_f10_rejects_any_execution_delta(self) -> None:
        capture = valid_as_f10_capture("browser")
        capture["execution"]["sideEffectDelta"] = 1

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "zeroExecutionOnReject",
        ):
            evaluate_as_f10(capture, platform="browser")

    def test_as_f10_rejects_unisolated_core_turn(self) -> None:
        capture = valid_as_f10_capture("browser")
        capture["toolIsolation"]["readyCapabilityCount"] = 1

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "coreOutcomesMatch",
        ):
            evaluate_as_f10(capture, platform="browser")

    def test_as_f10_rejects_browser_local_capabilities(self) -> None:
        capture = valid_as_f10_capture("browser")
        capture["capabilitySession"]["capabilityCount"] = 1

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "selectedDeviceOwnsExecution",
        ):
            evaluate_as_f10(capture, platform="browser")

    def test_as_f10_rejects_unexpected_rejection_code(self) -> None:
        capture = valid_as_f10_capture()
        capture["rejections"]["signatureTamper"]["errorCode"] = "AGENT_5000"

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "signatureTamperRejected",
        ):
            evaluate_as_f10(capture, platform="desktop_app")

    def test_as_f10_accepts_cross_device_command_authority_rejection(self) -> None:
        capture = valid_as_f10_capture()
        capture["rejections"]["crossDevice"]["errorCode"] = (
            "CLIENT_CAPABILITY_COMMAND_ERROR_CODE_AUTHORITY_MISMATCH"
        )

        assertions = evaluate_as_f10(capture, platform="desktop_app")

        self.assertTrue(assertions["crossDeviceRejected"])

    def test_as_f10_defers_unsupported_when_no_production_endpoint(self) -> None:
        capture = valid_as_f10_capture()
        capture["rejections"]["unsupported"] = {
            "availability": "unavailable",
            "unavailable_reason": "NO_PRODUCTION_CAPABILITY_ENDPOINT",
        }
        capture["rejections"]["schemaMismatch"] = {
            "availability": "unavailable",
            "unavailable_reason": "NO_PRODUCTION_CAPABILITY_ENDPOINT",
        }

        assertions = evaluate_as_f10(capture, platform="desktop_app")

        self.assertIsNone(assertions["unsupportedRejected"])
        self.assertIsNone(assertions["schemaMismatchRejected"])
        # Other assertions still pass normally.
        self.assertTrue(assertions["unauthorizedRejected"])
        self.assertTrue(assertions["crossDeviceRejected"])
        self.assertTrue(assertions["zeroExecutionOnReject"])

    def test_active_mutation_conflict_accepts_exact_production_facts(self) -> None:
        assertions = evaluate_base_active_mutation_conflict(
            valid_active_mutation_conflict_capture()
        )

        self.assertEqual(len(assertions), 6)
        self.assertTrue(all(assertions.values()))

    def test_active_mutation_conflict_rejects_winner_hash_drift(self) -> None:
        capture = valid_active_mutation_conflict_capture()
        capture["winner"]["hashAfterStale"] = "b" * 64

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "winnerPreserved",
        ):
            evaluate_base_active_mutation_conflict(capture)

    def test_active_mutation_conflict_rejects_non_localized_recovery(self) -> None:
        capture = valid_active_mutation_conflict_capture()
        capture["receiver"]["reloadText"] = "Reload"

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "localizedRecoveryVisible",
        ):
            evaluate_base_active_mutation_conflict(capture)

    def test_approval_denied_accepts_exact_production_facts(self) -> None:
        assertions = evaluate_base_approval_denied(
            valid_approval_denied_capture()
        )

        self.assertEqual(len(assertions), 6)
        self.assertTrue(all(assertions.values()))

    def test_approval_denied_rejects_unsafe_details(self) -> None:
        capture = valid_approval_denied_capture()
        capture["outcome"]["details"]["actor_id"] = "private-actor"

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "typedDenialProjected",
        ):
            evaluate_base_approval_denied(capture)

    def test_approval_denied_rejects_side_effect(self) -> None:
        capture = valid_approval_denied_capture()
        capture["station"]["sideEffectCount"] = 1

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "zeroSideEffect",
        ):
            evaluate_base_approval_denied(capture)


if __name__ == "__main__":
    unittest.main()
