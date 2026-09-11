from __future__ import annotations

import copy
import hashlib
import json
import unittest

from tooling.acceptance.gates.agent.foundation_group_one_scenarios import (
    GroupOneScenarioError,
    evaluate_base_attachment_rejected,
    evaluate_base_approval_expired,
    evaluate_base_approval_denied,
    evaluate_base_active_mutation_conflict,
    evaluate_base_cancelled,
    evaluate_base_context_overflow,
    evaluate_base_credential_missing,
    evaluate_base_duplicate_conflict,
    evaluate_base_executor_unavailable,
    evaluate_base_forbidden_actor,
    evaluate_base_incompatible_capability,
    evaluate_as_f02,
    evaluate_as_f03,
    evaluate_as_f04,
    evaluate_as_f05,
    evaluate_as_f06,
    evaluate_as_f07,
    evaluate_as_f10,
    evaluate_as_f12,
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
            "sourceStatus": "cancelled",
            "sourceStreamCancellationObserved": True,
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
        "receiverInteraction": {
            "attachmentId": "att-pdf",
            "visible": True,
            "keyboardReachable": True,
            "accessibleNamePresent": True,
            "openInvoked": True,
            "openedUrlHash": "a" * 64,
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
        replay_delivery("text", 5),
        replay_delivery("snapshot", 6),
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
            "replayRequestCursor": 2,
            "acknowledgedCursor": 4,
        },
        "transitions": [
            {"phase": "CONNECTION_LOST", "sequence": 4},
            {"phase": "RECONNECTING", "sequence": 4},
            {"phase": "REPLAYING", "sequence": 4},
            {"phase": "RECONCILING", "sequence": 6},
            {"phase": "CONNECTED", "sequence": 6},
        ],
        "replay": {
            "afterCursor": 4,
            "throughCursor": 6,
            "eventSequences": [5, 6],
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
                "sequence": 6,
                "terminal": False,
                "terminalStatus": None,
                "sourceDelivery": {
                    "transport": "station-sse",
                    "actorPtidHash": "b" * 64,
                    "conversationId": "conversation-1",
                    "turnId": "turn-1",
                    "sequence": 6,
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


def valid_as_f12_capture(
    platform: str = "desktop_app",
    locale: str = "en",
    sample_id: str = "sample-001",
) -> dict[str, object]:
    def topic(topic_key: str, index: int) -> dict[str, object]:
        conversation_id = f"conversation-{topic_key}"
        fact = f"{topic_key}-{sample_id}-nonce"
        user_message_id = f"message-{topic_key}-user"
        source_message_id = f"message-{topic_key}-assistant"
        sibling_message_id = f"message-{topic_key}-branch"
        turn_ids = [
            f"turn-{topic_key}-first",
            f"turn-{topic_key}-second",
        ]
        snapshot = {
            "topicLabel": topic_key,
            "fact": fact,
            "conversation": {
                "conversationId": conversation_id,
                "agentId": "agent-foundation",
                "status": "active",
                "activeBranchMessageId": sibling_message_id,
                "version": index + 4,
                "runtimeBinding": {
                    "runtimeKind": "direct_model",
                    "providerId": "provider",
                    "modelId": "model",
                    "runtimeProfileId": "modern-chat-agent-v1",
                    "externalSessionId": "",
                    "externalSessionEpoch": 1,
                    "runtimeHomeRef": "",
                    "capabilitySnapshotHash": "a" * 64,
                    "configSnapshotHash": "b" * 64,
                },
            },
            "selectedBranchMessageId": sibling_message_id,
            "runtimeTurn": {
                "turnId": turn_ids[1],
                "attemptId": f"attempt-{topic_key}",
                "runtimeKind": "direct_model",
                "providerId": "provider",
                "modelId": "model",
                "runtimeProfileId": "modern-chat-agent-v1",
                "externalSessionId": "",
                "externalSessionEpoch": 1,
            },
            "messages": [
                {
                    "conversationId": conversation_id,
                    "messageId": user_message_id,
                    "turnId": turn_ids[1],
                    "role": "user",
                    "status": "completed",
                    "content": fact,
                    "seq": 1,
                    "branchId": f"branch-{topic_key}",
                    "parentMessageId": "",
                    "replacesMessageId": "",
                },
                {
                    "conversationId": conversation_id,
                    "messageId": source_message_id,
                    "turnId": turn_ids[1],
                    "role": "assistant",
                    "status": "completed",
                    "content": fact,
                    "seq": 2,
                    "branchId": f"branch-{topic_key}",
                    "parentMessageId": user_message_id,
                    "replacesMessageId": "",
                },
                {
                    "conversationId": conversation_id,
                    "messageId": sibling_message_id,
                    "turnId": turn_ids[1],
                    "role": "assistant",
                    "status": "completed",
                    "content": fact,
                    "seq": 3,
                    "branchId": f"branch-{topic_key}-sibling",
                    "parentMessageId": user_message_id,
                    "replacesMessageId": source_message_id,
                },
            ],
        }
        receiver = {
            "conversationId": conversation_id,
            "selectedBranchMessageId": sibling_message_id,
            "rendered": [
                {
                    "messageId": user_message_id,
                    "role": "user",
                    "visible": True,
                    "text": fact,
                },
                {
                    "messageId": sibling_message_id,
                    "role": "assistant",
                    "visible": True,
                    "text": fact,
                },
            ],
            "storeMessageIds": [
                user_message_id,
                sibling_message_id,
            ],
            "selectedBranchVisible": True,
            "ownFactVisible": True,
            "foreignFactVisible": False,
        }
        snapshot_hash = canonical_payload_hash(snapshot)
        alternate_snapshot = copy.deepcopy(snapshot)
        alternate_snapshot["conversation"][
            "activeBranchMessageId"
        ] = source_message_id
        alternate_snapshot["selectedBranchMessageId"] = source_message_id
        return {
            "key": topic_key,
            "conversationId": conversation_id,
            "fact": fact,
            "turnIds": turn_ids,
            "runtimeTurnId": turn_ids[1],
            "sourceAssistantMessageId": source_message_id,
            "siblingMessageId": sibling_message_id,
            "selectedBranchMessageId": sibling_message_id,
            "preRestart": copy.deepcopy(snapshot),
            "preRestartHash": snapshot_hash,
            "receiverBefore": copy.deepcopy(receiver),
            "postRestart": copy.deepcopy(snapshot),
            "postRestartHash": snapshot_hash,
            "alternatePostRestart": alternate_snapshot,
            "restoredSelectedPostRestart": copy.deepcopy(snapshot),
            "receiverAfter": copy.deepcopy(receiver),
        }

    topics = {
        "alpha": topic("alpha", 1),
        "beta": topic("beta", 2),
    }
    return {
        "scope": {
            "scenarioKey": f"{platform}|{locale}|AS-F12|{sample_id}",
            "platform": platform,
            "locale": locale,
            "sampleId": sample_id,
        },
        "toolIsolation": {
            "disabledBindingCount": 1,
            "readyCapabilityCount": 0,
        },
        "restart": {
            "stationRestarted": True,
            "clientRestarted": True,
            "station": {
                "stationUrlHash": "c" * 64,
                "protoDigest": "d" * 64,
                "containerId": "e" * 64,
                "imageId": "f" * 64,
                "imageRef": "foundation-station:test",
                "beforeStartedAt": "2026-09-04T00:00:00Z",
                "afterStartedAt": "2026-09-04T00:01:00Z",
                "sourceCommit": "a" * 40,
                "beforeCommit": "a" * 40,
                "afterCommit": "a" * 40,
                "clientReloads": {platform: True},
                "owningPlatform": platform,
                "existingSessionRestored": True,
            },
        },
        "topics": topics,
        "staleMutation": {
            "errorCode": "VERSION_CONFLICT",
            "targetConversationId": "conversation-alpha",
            "attemptedBranchMessageId": "message-alpha-assistant",
            "expectedVersion": 3,
            "before": {
                "alphaHash": topics["alpha"]["postRestartHash"],
                "betaHash": topics["beta"]["postRestartHash"],
                "alphaVersion": 5,
                "betaVersion": 6,
            },
            "after": {
                "alphaHash": topics["alpha"]["postRestartHash"],
                "betaHash": topics["beta"]["postRestartHash"],
                "alphaVersion": 5,
                "betaVersion": 6,
            },
        },
        "cleanup": {
            "cleanupComplete": True,
            "handoffCleared": True,
            "conversationIds": [
                "conversation-alpha",
                "conversation-beta",
            ],
            "deletedConversationIds": [
                "conversation-alpha",
                "conversation-beta",
            ],
            "cancellationErrorCodes": [],
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
            "conversationDeleted": True,
            "priorSelection": "assistant",
            "restoredSelection": "assistant",
        },
    }


def valid_forbidden_actor_capture() -> dict[str, object]:
    owner_actor_hash = "a" * 64
    receiver_actor_hash = "b" * 64
    owner_state_hash = "c" * 64
    replay_hash = "d" * 64
    return {
        "outcome": {
            "error": "agent.errors.forbiddenActor",
            "error_type": "OWNERSHIP_FORBIDDEN_ACTOR",
            "locale_key": "agent.errors.forbiddenActor",
            "retryable": False,
            "terminal": True,
            "details": {
                "resource_kind": "conversation",
                "resource_id": "conversation-owner",
            },
        },
        "receiver": {
            "errorVisible": True,
            "errorText": "This account cannot access the requested item.",
            "expectedErrorText": (
                "This account cannot access the requested item."
            ),
            "recoveryVisible": True,
            "recoveryText": "Switch account",
            "expectedRecoveryText": "Switch account",
            "accountGateObserved": True,
            "recoveryExecuted": True,
            "receiverActorHash": receiver_actor_hash,
            "receiverRestored": True,
        },
        "foreignAccess": {
            "resourceKind": "conversation",
            "resourceId": "conversation-owner",
            "ownerActorHash": owner_actor_hash,
            "receiverActorHash": receiver_actor_hash,
            "requestCount": 2,
            "foreignPayloadCount": 0,
        },
        "owner": {
            "resourceKind": "conversation",
            "resourceId": "conversation-owner",
            "ownerActorHash": owner_actor_hash,
            "beforeHash": owner_state_hash,
            "afterHash": owner_state_hash,
            "versionBefore": 1,
            "versionAfter": 1,
        },
        "station": {
            "conversationDelta": 0,
            "turnDelta": 0,
            "messageDelta": 0,
            "queueDelta": 0,
            "providerExecutionDelta": 0,
        },
        "runtimeEvent": {
            "eventId": "e" * 64,
            "sequence": 1,
            "eventType": "error",
            "observedAt": "2026-09-11T00:00:00Z",
            "streamGeneration": 1,
            "streamIdHash": "f" * 64,
            "conversationIdHash": "1" * 64,
            "payloadHash": replay_hash,
            "errorType": "OWNERSHIP_FORBIDDEN_ACTOR",
            "sourceTransport": "station-sse",
            "sourcePtidHash": receiver_actor_hash,
            "sourceConversationId": "conversation-owner",
            "sourceTurnId": "",
            "sourceSequence": 0,
            "sourceEventType": "error",
        },
        "replay": {
            "sourceHash": replay_hash,
            "replayHash": replay_hash,
            "equal": True,
        },
        "cleanup": {
            "localProjectionCleared": True,
            "foreignResourceDeleted": True,
            "foreignAgentDeleted": True,
            "ownerSelectionRestored": True,
            "receiverRestored": True,
            "conversationDeleted": True,
        },
    }


def valid_incompatible_capability_capture(
    locale: str = "en",
) -> dict[str, object]:
    conversation_id = "conversation-incompatible-capability"
    state_hash = "2" * 64
    payload_hash = "7" * 64
    receiver_copy = {
        "en": (
            "The selected runtime does not support a required capability.",
            "Choose compatible model",
        ),
        "zh-CN": (
            "所选运行时不支持必需能力。",
            "选择兼容模型",
        ),
    }
    error_text, recovery_text = receiver_copy[locale]
    return {
        "outcome": {
            "error": "agent.errors.incompatibleCapability",
            "error_type": "RUNTIME_INCOMPATIBLE_CAPABILITY",
            "locale_key": "agent.errors.incompatibleCapability",
            "retryable": False,
            "terminal": True,
            "details": {
                "capability_id": "tool:skills_list",
                "reason_code": "runtime_capability_unavailable",
            },
        },
        "receiver": {
            "errorVisible": True,
            "errorText": error_text,
            "expectedErrorText": error_text,
            "recoveryVisible": True,
            "recoveryLocaleKey": "agent.recovery.chooseCompatibleModel",
            "recoveryText": recovery_text,
            "expectedRecoveryText": recovery_text,
            "recoveryExecuted": True,
            "profileVisible": True,
            "profileAgentId": "agent-incompatible",
            "modelSelectionVisible": True,
            "selectedModelId": "model-incompatible",
        },
        "readiness": {
            "source": "station-capability-readiness",
            "capabilityId": "tool:skills_list",
            "reasonCode": "runtime_capability_unavailable",
            "incompatibleModelId": "model-incompatible",
            "snapshotIdBefore": "readiness-before",
            "snapshotIdAfter": "readiness-after",
            "runtimeSnapshotIdBefore": "runtime-incompatible",
            "runtimeSnapshotIdAfter": "runtime-incompatible",
            "bindingRevisionBefore": 7,
            "bindingRevisionAfter": 7,
            "stateBefore": "unavailable",
            "stateAfter": "unavailable",
        },
        "station": {
            "agentId": "agent-incompatible",
            "conversationId": conversation_id,
            "turnId": "turn-incompatible",
            "selectedModelIdBefore": "model-incompatible",
            "selectedModelIdAfter": "model-incompatible",
            "conversationVersionBefore": 3,
            "conversationVersionAfter": 3,
            "beforeHash": state_hash,
            "afterHash": state_hash,
            "turnDelta": 1,
            "messageDelta": 0,
            "queueDelta": 0,
        },
        "execution": {
            "runtimeExecutionDelta": 0,
            "providerCallDelta": 0,
            "toolCallDelta": 0,
            "toolExecutionDelta": 0,
            "sideEffectDelta": 0,
        },
        "runtimeEvent": {
            "eventId": "3" * 64,
            "sequence": 1,
            "eventType": "error",
            "observedAt": "2026-09-11T01:00:00Z",
            "streamGeneration": 1,
            "streamIdHash": "4" * 64,
            "conversationIdHash": hashlib.sha256(
                conversation_id.encode("utf-8")
            ).hexdigest(),
            "payloadHash": "5" * 64,
            "errorType": "RUNTIME_INCOMPATIBLE_CAPABILITY",
            "sourceTransport": "station-sse",
            "sourcePtidHash": "6" * 64,
            "sourceConversationId": conversation_id,
            "sourceTurnId": "turn-incompatible",
            "sourceSequence": 1,
            "sourceEventType": "error",
        },
        "replay": {
            "sourceHash": payload_hash,
            "replayHash": payload_hash,
            "equal": True,
        },
        "cleanup": {
            "localProjectionCleared": True,
            "conversationDeleted": True,
            "disposableAgentDeleted": True,
            "capabilityBindingRemoved": True,
            "fixtureProviderRestored": True,
            "modelConfigurationUnchanged": True,
            "priorSelection": "agent-default",
            "restoredSelection": "agent-default",
        },
    }


def valid_cancelled_capture() -> dict[str, object]:
    outcome = {
        "error": "agent.errors.lifecycleCancelled",
        "error_type": "LIFECYCLE_CANCELLED",
        "locale_key": "agent.errors.lifecycleCancelled",
        "retryable": False,
        "terminal": True,
        "details": {
            "resource_kind": "turn",
            "resource_id": "turn-cancelled",
        },
    }
    receiver = {
        "messageId": "message-cancelled",
        "visible": True,
        "terminalStatus": "cancelled",
        "errorType": "LIFECYCLE_CANCELLED",
        "resourceKind": "turn",
        "resourceId": "turn-cancelled",
        "errorDetail": "cancelled_by_user",
        "errorText": "This operation was cancelled.",
        "expectedErrorText": "This operation was cancelled.",
        "recoveryVisible": False,
        "resolutionPresent": False,
    }
    live_receiver = copy.deepcopy(receiver)
    reload_receiver = {
        **receiver,
        "errorDetail": "",
    }
    return {
        "outcome": outcome,
        "receiver": {
            **receiver,
            "phases": {
                "live": live_receiver,
                "reload": reload_receiver,
                "replaySnapshot": copy.deepcopy(receiver),
            },
        },
        "station": {
            "conversationId": "conversation-cancelled",
            "messageId": "message-cancelled",
            "turnId": "turn-cancelled",
            "turnStatus": "cancelled",
            "attemptStatus": "cancelled",
            "messageStatus": "cancelled",
            "terminalReason": "cancelled_by_user",
            "persistedOutcome": copy.deepcopy(outcome),
            "terminalEventCount": 1,
            "cancelledEventCount": 1,
            "doneEventCount": 0,
            "errorEventCount": 0,
            "liveTerminalEventCount": 1,
            "liveDoneEventCount": 0,
        },
        "replay": {
            "sourceHash": "a" * 64,
            "replayHash": "a" * 64,
            "equal": True,
            "snapshot": {
                "sourceTransport": "station-sse",
                "sourcePtidHash": "a" * 64,
                "sourceConversationId": "conversation-cancelled",
                "sourceTurnId": "turn-cancelled",
                "sourceSequence": 3,
                "sourceEventType": "snapshot",
                "status": "cancelled",
            },
        },
        "cleanup": {
            "cancellationRequestCount": 1,
            "terminalCleanupCount": 1,
            "conversationDeleted": True,
        },
        "cancellation": {
            "status": "cancelled",
            "latencyMs": 25,
        },
        "runtimeEvent": {
            "eventId": "b" * 64,
            "eventType": "cancelled",
            "sequence": 3,
            "observedAt": "2026-09-07T08:30:00Z",
            "streamGeneration": 1,
            "streamIdHash": "c" * 64,
            "conversationIdHash": "d" * 64,
            "payloadHash": "e" * 64,
            "errorType": "LIFECYCLE_CANCELLED",
            "sourceTransport": "station-sse",
            "sourcePtidHash": "a" * 64,
            "sourceConversationId": "conversation-cancelled",
            "sourceTurnId": "turn-cancelled",
            "sourceSequence": 3,
            "sourceEventType": "cancelled",
        },
    }


def valid_context_overflow_capture() -> dict[str, object]:
    return {
        "runtimeEvent": {
            "eventId": "b" * 64,
            "sequence": 1,
            "eventType": "error",
            "observedAt": "2026-09-07T12:00:00Z",
            "streamGeneration": 1,
            "streamIdHash": "c" * 64,
            "conversationIdHash": "d" * 64,
            "payloadHash": "e" * 64,
            "errorType": "CONTEXT_OVERFLOW",
            "sourceTransport": "station-sse",
            "sourcePtidHash": "a" * 64,
            "sourceConversationId": "conversation-overflow",
            "sourceTurnId": "",
            "sourceSequence": 0,
            "sourceEventType": "error",
        },
        "outcome": {
            "error": "agent.errors.contextOverflow",
            "error_type": "CONTEXT_OVERFLOW",
            "locale_key": "agent.errors.contextOverflow",
            "retryable": False,
            "terminal": True,
            "details": {
                "limit_tokens": "64",
                "actual_tokens": "128",
            },
        },
        "receiver": {
            "errorVisible": True,
            "errorText": "The selected context exceeds the model limit.",
            "expectedErrorText": (
                "The selected context exceeds the model limit."
            ),
            "recoveryVisible": True,
            "recoveryText": "Reduce context",
            "expectedRecoveryText": "Reduce context",
            "draftLengthBefore": 256,
            "draftLengthAfterRejection": 256,
            "draftHashBefore": "f" * 64,
            "draftHashAfterRejection": "f" * 64,
            "composerFocusedAfterRecovery": True,
            "reducedDraftLength": 32,
            "reducedDraftHash": "1" * 64,
        },
        "station": {
            "conversationId": "conversation-overflow",
            "conversationVersionBefore": 2,
            "conversationVersionAfter": 2,
            "beforeHash": "2" * 64,
            "afterHash": "2" * 64,
            "turnDelta": 0,
            "messageDelta": 0,
            "queueDelta": 0,
            "providerExecutionDelta": 0,
        },
        "replay": {
            "sourceHash": "2" * 64,
            "replayHash": "2" * 64,
            "equal": True,
        },
        "cleanup": {
            "draftCleared": True,
            "localProjectionCleared": True,
            "conversationDeleted": True,
        },
    }


def valid_credential_missing_capture() -> dict[str, object]:
    conversation_id = "conversation-credential-missing"
    state_hash = "a" * 64
    return {
        "outcome": {
            "error": "agent.errors.providerCredentialMissing",
            "error_type": "PROVIDER_CREDENTIAL_MISSING",
            "locale_key": "agent.errors.providerCredentialMissing",
            "retryable": True,
            "terminal": True,
            "details": {
                "provider_id": "provider-missing",
            },
        },
        "runtimeEvent": {
            "eventId": "b" * 64,
            "sequence": 1,
            "eventType": "error",
            "observedAt": "2026-09-07T12:30:00Z",
            "streamGeneration": 1,
            "streamIdHash": "c" * 64,
            "conversationIdHash": hashlib.sha256(
                conversation_id.encode("utf-8")
            ).hexdigest(),
            "payloadHash": "d" * 64,
            "errorType": "PROVIDER_CREDENTIAL_MISSING",
            "sourceTransport": "station-sse",
            "sourcePtidHash": "e" * 64,
            "sourceConversationId": conversation_id,
            "sourceTurnId": "",
            "sourceSequence": 0,
            "sourceEventType": "error",
        },
        "receiver": {
            "errorVisible": True,
            "errorText": "Provider credentials are not configured.",
            "expectedErrorText": "Provider credentials are not configured.",
            "recoveryVisible": True,
            "recoveryText": "Configure credential",
            "expectedRecoveryText": "Configure credential",
            "configureProviderExecuted": True,
        },
        "station": {
            "conversationId": conversation_id,
            "providerId": "provider-missing",
            "providerStatusBefore": "not_configured",
            "providerConfiguredBefore": False,
            "providerStatusAfter": "not_configured",
            "providerConfiguredAfter": False,
            "conversationVersionBefore": 1,
            "conversationVersionAfter": 1,
            "beforeHash": state_hash,
            "afterHash": state_hash,
            "turnDelta": 0,
            "messageDelta": 0,
            "queueDelta": 0,
            "providerExecutionDelta": 0,
        },
        "replay": {
            "sourceHash": state_hash,
            "replayHash": state_hash,
            "equal": True,
        },
        "cleanup": {
            "conversationDeleted": True,
            "disposableAgentDeleted": True,
            "priorSelection": "primary-agent",
            "restoredSelection": "primary-agent",
        },
    }


def valid_duplicate_conflict_capture() -> dict[str, object]:
    conversation_id = "conversation-duplicate-conflict"
    original_turn_id = "turn-original"
    state_hash = "a" * 64
    idempotency_key_hash = "b" * 64
    message_ids = ["message-user", "message-assistant"]
    return {
        "outcome": {
            "error": "agent.errors.duplicateConflict",
            "error_type": "ADMISSION_DUPLICATE_CONFLICT",
            "locale_key": "agent.errors.duplicateConflict",
            "retryable": False,
            "terminal": True,
            "details": {
                "idempotency_key_hash": idempotency_key_hash,
                "existing_command_id": original_turn_id,
            },
        },
        "runtimeEvent": {
            "eventId": "c" * 64,
            "sequence": 1,
            "eventType": "error",
            "observedAt": "2026-09-08T05:00:00Z",
            "streamGeneration": 1,
            "streamIdHash": "d" * 64,
            "conversationIdHash": hashlib.sha256(
                conversation_id.encode("utf-8")
            ).hexdigest(),
            "payloadHash": "e" * 64,
            "errorType": "ADMISSION_DUPLICATE_CONFLICT",
            "sourceTransport": "station-sse",
            "sourcePtidHash": "f" * 64,
            "sourceConversationId": conversation_id,
            "sourceTurnId": "",
            "sourceSequence": 0,
            "sourceEventType": "error",
        },
        "receiver": {
            "errorVisible": True,
            "errorText": "This request conflicts with an existing request.",
            "expectedErrorText": (
                "This request conflicts with an existing request."
            ),
            "recoveryVisible": True,
            "recoveryText": "Open original",
            "expectedRecoveryText": "Open original",
            "openOriginalExecuted": True,
            "openedTurnId": original_turn_id,
        },
        "station": {
            "conversationId": conversation_id,
            "originalTurnId": original_turn_id,
            "existingCommandId": original_turn_id,
            "idempotencyKeyHash": idempotency_key_hash,
            "conversationVersionBefore": 2,
            "conversationVersionAfter": 2,
            "beforeHash": state_hash,
            "afterHash": state_hash,
            "originalMessageIdsBefore": message_ids,
            "originalMessageIdsAfter": list(message_ids),
            "turnDelta": 0,
            "messageDelta": 0,
            "queueDelta": 0,
            "providerExecutionDelta": 0,
        },
        "replay": {
            "sourceHash": state_hash,
            "replayHash": state_hash,
            "equal": True,
        },
        "cleanup": {
            "conversationDeleted": True,
            "localProjectionCleared": True,
            "operationCleared": True,
            "portalClosed": True,
        },
    }


def valid_attachment_rejected_capture() -> dict[str, object]:
    return {
        "runtimeEvent": {
            "eventId": "b" * 64,
            "sequence": 1,
            "eventType": "error",
            "observedAt": "2026-09-06T18:32:20Z",
            "streamGeneration": 1,
            "streamIdHash": "c" * 64,
            "conversationIdHash": "d" * 64,
            "payloadHash": "e" * 64,
            "errorType": "CONTEXT_ATTACHMENT_REJECTED",
        },
        "outcome": {
            "error": "agent.errors.attachmentRejected",
            "error_type": "CONTEXT_ATTACHMENT_REJECTED",
            "locale_key": "agent.errors.attachmentRejected",
            "retryable": False,
            "terminal": True,
            "details": {
                "attachment_id": "attachment-rejected",
                "reason_code": "attachment_object_is_unavailable",
            },
        },
        "receiver": {
            "errorVisible": True,
            "errorText": "An attachment cannot be used for this request.",
            "expectedErrorText": (
                "An attachment cannot be used for this request."
            ),
            "attachmentVisibleAfterReject": True,
            "attachmentStatusAfterReject": "rejected",
            "draftTextBefore": "Reject the invalid attachment",
            "draftTextAfterRejection": "Reject the invalid attachment",
            "removalVisible": True,
            "removalText": "Remove attachment",
            "expectedRemovalText": "Remove attachment",
            "removalExecuted": True,
            "attachmentPresentAfterRemoval": False,
        },
        "station": {
            "attachmentId": "attachment-rejected",
            "objectRefHash": "f" * 64,
            "reasonCode": "attachment_object_is_unavailable",
            "conversationVersionBefore": 2,
            "conversationVersionAfter": 2,
            "beforeHash": "a" * 64,
            "afterHash": "a" * 64,
            "turnDelta": 0,
            "providerExecutionDelta": 0,
            "messageDelta": 0,
        },
        "replay": {
            "sourceHash": "a" * 64,
            "replayHash": "a" * 64,
            "equal": True,
        },
        "cleanup": {
            "draftRemoved": True,
            "objectDeleted": True,
            "deletionReadback": {
                "source": "oss-owner-list",
                "objectRefHash": "f" * 64,
                "objectPathHash": "0" * 64,
                "deletedAt": "2026-09-06T18:32:21Z",
                "readAttempt": 1,
            },
            "conversationDeleted": True,
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


def valid_executor_unavailable_capture() -> dict[str, object]:
    station = {
        "policy": "manual",
        "states": ["policy_check", "awaiting_user"],
        "errorCode": "",
        "executionOwner": "client_capability",
        "executionAttemptCount": 0,
        "sideEffectCount": 0,
        "resultCount": 0,
        "continuationCount": 0,
        "lineage": {
            "toolCallId": "tool-call-executor",
            "approvalId": "approval-executor",
            "decisionId": "",
            "decisionRevision": 0,
            "executionClaimId": "",
            "fencingToken": 0,
            "sideEffectReceiptId": "",
            "resultId": "",
            "continuationId": "",
            "dispatchCommittedAt": None,
        },
    }
    return {
        "outcome": {
            "error": "agent.errors.executorUnavailable",
            "error_type": "CLIENT_EXECUTOR_UNAVAILABLE",
            "locale_key": "agent.errors.executorUnavailable",
            "retryable": True,
            "terminal": True,
            "details": {
                "target_device_id": "device-executor",
                "capability_id": "clipboard.read",
            },
        },
        "receiver": {
            "errorVisible": True,
            "errorText": "The required client executor is unavailable.",
            "expectedErrorText": "The required client executor is unavailable.",
            "recoveryVisible": True,
            "recoveryText": "Reconnect executor",
            "expectedRecoveryText": "Reconnect executor",
            "approveDisabled": True,
            "repeatedApprovalBlocked": True,
            "recoveryExecuted": True,
            "approvalEnabledAfterRecovery": True,
        },
        "decision": {
            "accepted": False,
            "approved": True,
            "errorCode": (
                "TOOL_APPROVAL_DECISION_ERROR_CODE_EXECUTOR_UNAVAILABLE"
            ),
            "approvalId": "approval-executor",
            "toolCallId": "tool-call-executor",
            "decisionId": "decision-executor",
            "decisionRevision": 0,
        },
        "station": station,
        "stationAfterRecovery": copy.deepcopy(station),
        "executor": {
            "targetDeviceId": "device-executor",
            "targetCapabilityId": "clipboard.read",
            "sessionRemoved": True,
            "localSessionRemoved": True,
            "sessionRestored": True,
            "restoredDeviceId": "device-executor",
            "restoredCapabilityId": "clipboard.read",
            "withdrawnExecutionAttemptCount": 0,
            "restoredExecutionAttemptCount": 0,
            "withdrawnSideEffectCount": 0,
            "restoredSideEffectCount": 0,
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
            "executorRestored": True,
            "turnCancelled": True,
            "conversationDeleted": True,
        },
    }


def valid_approval_expired_capture() -> dict[str, object]:
    return {
        "outcome": {
            "error": "agent.errors.toolApprovalExpired",
            "error_type": "TOOL_APPROVAL_EXPIRED",
            "locale_key": "agent.errors.toolApprovalExpired",
            "retryable": True,
            "terminal": True,
            "details": {
                "decision_id": "decision-expired",
                "expires_at": "2026-09-04T22:00:00Z",
            },
        },
        "receiver": {
            "recoveryVisible": True,
            "recoveryText": "Request again",
            "expectedRecoveryText": "Request again",
            "recoveryExecuted": True,
            "errorVisible": True,
            "errorText": "The tool approval request has expired.",
            "expectedErrorText": "The tool approval request has expired.",
        },
        "decision": {
            "accepted": False,
            "approvalId": "approval-expired",
            "toolCallId": "tool-call-expired",
            "decisionId": "decision-expired",
            "decisionRevision": 0,
            "errorCode": "TOOL_APPROVAL_DECISION_ERROR_CODE_EXPIRED",
            "expiresAt": "2026-09-04T22:00:00Z",
        },
        "station": {
            "policy": "manual",
            "states": ["policy_check", "awaiting_user", "expired"],
            "errorCode": "TOOL_APPROVAL_EXPIRED",
            "executionAttemptCount": 0,
            "sideEffectCount": 0,
            "resultCount": 0,
            "continuationCount": 0,
            "lineage": {
                "toolCallId": "tool-call-expired",
                "decisionId": "",
                "decisionRevision": 0,
            },
        },
        "recovery": {
            "attemptCountBefore": 1,
            "attemptCountAfter": 2,
            "newApprovalIdentityDistinct": True,
            "cancellationStatus": "cancelled",
            "retryToolStatus": "cancelled",
            "retryExecutionAttemptCount": 0,
            "retrySideEffectCount": 0,
            "retryResultCount": 0,
            "retryContinuationCount": 0,
        },
        "replay": {
            "acknowledgementSourceHash": "a" * 64,
            "acknowledgementReplayHash": "a" * 64,
            "stationSourceHash": "b" * 64,
            "stationReplayHash": "b" * 64,
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

    def test_as_f06_accepts_wire_string_replay_sequences(self) -> None:
        capture = valid_as_f06_capture()
        for key in ("deliveries", "stationReadbackDeliveries"):
            deliveries = capture["replay"][key]
            assert isinstance(deliveries, list)
            for delivery in deliveries:
                assert isinstance(delivery, dict)
                raw_payload = delivery["rawPayload"]
                assert isinstance(raw_payload, dict)
                raw_data = raw_payload["data"]
                assert isinstance(raw_data, dict)
                raw_data["seq"] = str(delivery["sequence"])
                delivery["payloadHash"] = canonical_payload_hash(raw_payload)
        for deliveries_key, hash_key in (
            ("deliveries", "sourceHash"),
            ("stationReadbackDeliveries", "replayHash"),
        ):
            replay_identities = [
                {
                    key: value
                    for key, value in delivery.items()
                    if key not in {"streamId", "streamGeneration", "observedAt"}
                }
                for delivery in capture["replay"][deliveries_key]
            ]
            capture["replay"][hash_key] = canonical_payload_hash(
                replay_identities
            )

        assertions = evaluate_as_f06(
            capture,
            platform="desktop_app",
            locale="en",
            sample_id="sample-001",
        )

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
                lambda capture: capture["handoff"].update(
                    {"replayRequestCursor": 5}
                ),
                "replayAfterAcknowledgedCursor",
            ),
            (
                lambda capture: capture["handoff"].update(
                    {"acknowledgedCursor": 1}
                ),
                "replayAfterAcknowledgedCursor",
            ),
            (
                lambda capture: capture["replay"].update(
                    {"throughCursor": 5}
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

        self.assertEqual(len(assertions), 11)
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

    def test_as_f05_requires_the_history_attachment_action(self) -> None:
        capture = valid_as_f05_capture()
        receiver = capture["receiverInteraction"]
        assert isinstance(receiver, dict)
        receiver["openInvoked"] = False

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "historyAttachmentActionVisible",
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

    def test_as_f07_rejects_retry_without_cancelled_source(self) -> None:
        capture = copy.deepcopy(valid_as_f07_capture())
        capture["retry"]["sourceStatus"] = "completed"

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "retryCreatedAttempt",
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

    def test_as_f12_accepts_two_topic_restart_isolation(self) -> None:
        assertions = evaluate_as_f12(
            valid_as_f12_capture(),
            platform="desktop_app",
            locale="en",
            sample_id="sample-001",
        )

        self.assertEqual(len(assertions), 5)
        self.assertTrue(all(assertions.values()))

    def test_as_f12_rejects_topic_label_mismatch(self) -> None:
        capture = valid_as_f12_capture()
        alpha = capture["topics"]["alpha"]
        for phase in ("preRestart", "postRestart"):
            alpha[phase]["topicLabel"] = "beta"
            alpha[f"{phase}Hash"] = canonical_payload_hash(alpha[phase])
        for stale_phase in ("before", "after"):
            capture["staleMutation"][stale_phase]["alphaHash"] = (
                alpha["postRestartHash"]
            )

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "restartRestored",
        ):
            evaluate_as_f12(
                capture,
                platform="desktop_app",
                locale="en",
                sample_id="sample-001",
            )

    def test_as_f12_accepts_independent_original_branch_selection(self) -> None:
        capture = valid_as_f12_capture()
        beta = capture["topics"]["beta"]
        selected = beta["sourceAssistantMessageId"]
        beta["selectedBranchMessageId"] = selected
        for phase in ("preRestart", "postRestart"):
            snapshot = beta[phase]
            snapshot["selectedBranchMessageId"] = selected
            snapshot["conversation"]["activeBranchMessageId"] = selected
            beta[f"{phase}Hash"] = canonical_payload_hash(snapshot)
        restored = beta["restoredSelectedPostRestart"]
        restored["selectedBranchMessageId"] = selected
        restored["conversation"]["activeBranchMessageId"] = selected
        alternate = beta["alternatePostRestart"]
        alternate["selectedBranchMessageId"] = beta["siblingMessageId"]
        alternate["conversation"]["activeBranchMessageId"] = (
            beta["siblingMessageId"]
        )
        for receiver_phase in ("receiverBefore", "receiverAfter"):
            receiver = beta[receiver_phase]
            receiver["selectedBranchMessageId"] = selected
            receiver["rendered"][1]["messageId"] = selected
            receiver["storeMessageIds"][1] = selected
        capture["staleMutation"]["before"]["betaHash"] = (
            beta["postRestartHash"]
        )
        capture["staleMutation"]["after"]["betaHash"] = (
            beta["postRestartHash"]
        )

        assertions = evaluate_as_f12(
            capture,
            platform="desktop_app",
            locale="en",
            sample_id="sample-001",
        )

        self.assertTrue(all(assertions.values()))

    def test_as_f12_rejects_cross_topic_reference_leakage(self) -> None:
        capture = valid_as_f12_capture()
        for phase in (
            "postRestart",
            "alternatePostRestart",
            "restoredSelectedPostRestart",
        ):
            capture["topics"]["alpha"][phase]["messages"][0][
                "conversationId"
            ] = "conversation-beta"

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "noCrossTopicReferences",
        ):
            evaluate_as_f12(
                capture,
                platform="desktop_app",
                locale="en",
                sample_id="sample-001",
            )

    def test_as_f12_rejects_direct_model_runtime_home(self) -> None:
        capture = valid_as_f12_capture()
        for phase in ("preRestart", "postRestart"):
            capture["topics"]["alpha"][phase]["conversation"][
                "runtimeBinding"
            ]["runtimeHomeRef"] = "runtime-home-alpha"
            capture["topics"]["alpha"][f"{phase}Hash"] = canonical_payload_hash(
                capture["topics"]["alpha"][phase]
            )
        capture["staleMutation"]["before"]["alphaHash"] = (
            capture["topics"]["alpha"]["postRestartHash"]
        )
        capture["staleMutation"]["after"]["alphaHash"] = (
            capture["topics"]["alpha"]["postRestartHash"]
        )

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "twoTopicsDistinct",
        ):
            evaluate_as_f12(
                capture,
                platform="desktop_app",
                locale="en",
                sample_id="sample-001",
            )

    def test_as_f12_accepts_distinct_external_runtime_ownership(self) -> None:
        capture = valid_as_f12_capture()
        for topic_key in ("alpha", "beta"):
            topic = capture["topics"][topic_key]
            for phase in ("preRestart", "postRestart"):
                snapshot = topic[phase]
                binding = snapshot["conversation"]["runtimeBinding"]
                runtime_turn = snapshot["runtimeTurn"]
                binding["runtimeKind"] = "external_agent"
                binding["runtimeHomeRef"] = f"runtime-home-{topic_key}"
                binding["externalSessionId"] = f"external-session-{topic_key}"
                runtime_turn["runtimeKind"] = "external_agent"
                runtime_turn["externalSessionId"] = (
                    f"external-session-{topic_key}"
                )
                topic[f"{phase}Hash"] = canonical_payload_hash(snapshot)
            capture["staleMutation"]["before"][f"{topic_key}Hash"] = (
                topic["postRestartHash"]
            )
            capture["staleMutation"]["after"][f"{topic_key}Hash"] = (
                topic["postRestartHash"]
            )

        assertions = evaluate_as_f12(
            capture,
            platform="desktop_app",
            locale="en",
            sample_id="sample-001",
        )

        self.assertTrue(all(assertions.values()))

    def test_as_f12_rejects_stale_mutation_of_either_topic(self) -> None:
        capture = valid_as_f12_capture()
        capture["staleMutation"]["after"]["betaHash"] = "f" * 64

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "staleMutationConflict",
        ):
            evaluate_as_f12(
                capture,
                platform="desktop_app",
                locale="en",
                sample_id="sample-001",
            )

    def test_as_f12_rejects_incomplete_restart_restoration(self) -> None:
        capture = valid_as_f12_capture()
        capture["topics"]["beta"]["postRestart"]["conversation"][
            "activeBranchMessageId"
        ] = "message-beta-assistant"

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "restartRestored",
        ):
            evaluate_as_f12(
                capture,
                platform="desktop_app",
                locale="en",
                sample_id="sample-001",
            )

    def test_as_f12_rejects_restart_source_identity_drift(self) -> None:
        capture = valid_as_f12_capture()
        capture["restart"]["station"]["afterCommit"] = "b" * 40

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "restartRestored",
        ):
            evaluate_as_f12(
                capture,
                platform="desktop_app",
                locale="en",
                sample_id="sample-001",
            )

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

    def test_active_mutation_conflict_requires_attestation_conversation_cleanup(
        self,
    ) -> None:
        capture = valid_active_mutation_conflict_capture()
        capture["cleanup"]["conversationDeleted"] = False

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "cleanupComplete",
        ):
            evaluate_base_active_mutation_conflict(capture)

    def test_forbidden_actor_accepts_exact_production_facts(self) -> None:
        assertions = evaluate_base_forbidden_actor(
            valid_forbidden_actor_capture()
        )

        self.assertEqual(len(assertions), 8)
        self.assertTrue(all(assertions.values()))
        self.assertTrue(all(type(value) is bool for value in assertions.values()))

    def test_forbidden_actor_rejects_typed_contract_drift(self) -> None:
        mutations = (
            lambda capture: capture["outcome"].update(
                {"error": "agent.errors.generic"}
            ),
            lambda capture: capture["outcome"].update(
                {"error_type": "OWNERSHIP_UNAUTHORIZED_RESOURCE"}
            ),
            lambda capture: capture["outcome"].update(
                {"locale_key": "agent.errors.generic"}
            ),
            lambda capture: capture["outcome"].update({"retryable": True}),
            lambda capture: capture["outcome"].update({"terminal": False}),
            lambda capture: capture["outcome"]["details"].update(
                {"actor_id": "private-actor"}
            ),
            lambda capture: capture["outcome"]["details"].update(
                {"resource_kind": "agent"}
            ),
            lambda capture: capture["outcome"]["details"].update(
                {"resource_id": "conversation-other"}
            ),
        )
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                capture = valid_forbidden_actor_capture()
                mutation(capture)
                with self.assertRaisesRegex(
                    GroupOneScenarioError,
                    "typedForbiddenActorRejected",
                ):
                    evaluate_base_forbidden_actor(capture)

    def test_forbidden_actor_requires_localized_switch_account(self) -> None:
        for key, value, expected in (
            ("errorText", "Forbidden", "localizedRecoveryVisible"),
            ("recoveryVisible", False, "localizedRecoveryVisible"),
            ("recoveryText", "Sign out", "localizedRecoveryVisible"),
            ("accountGateObserved", False, "switchAccountExecuted"),
            ("recoveryExecuted", False, "switchAccountExecuted"),
            ("receiverRestored", False, "switchAccountExecuted"),
        ):
            with self.subTest(key=key):
                capture = valid_forbidden_actor_capture()
                capture["receiver"][key] = value
                with self.assertRaisesRegex(GroupOneScenarioError, expected):
                    evaluate_base_forbidden_actor(capture)

    def test_forbidden_actor_rejects_foreign_payload_or_identity_drift(
        self,
    ) -> None:
        mutations = (
            lambda capture: capture["foreignAccess"].update(
                {"foreignPayloadCount": 1}
            ),
            lambda capture: capture["foreignAccess"].update(
                {"requestCount": 1}
            ),
            lambda capture: capture["foreignAccess"].update(
                {"resourceId": "conversation-other"}
            ),
            lambda capture: capture["foreignAccess"].update(
                {"receiverActorHash": "a" * 64}
            ),
        )
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                capture = valid_forbidden_actor_capture()
                mutation(capture)
                with self.assertRaisesRegex(
                    GroupOneScenarioError,
                    "foreignReadRejected",
                ):
                    evaluate_base_forbidden_actor(capture)

    def test_forbidden_actor_rejects_owner_state_drift(self) -> None:
        for key, value in (
            ("afterHash", "e" * 64),
            ("versionAfter", 2),
        ):
            with self.subTest(key=key):
                capture = valid_forbidden_actor_capture()
                capture["owner"][key] = value
                with self.assertRaisesRegex(
                    GroupOneScenarioError,
                    "ownerStatePreserved",
                ):
                    evaluate_base_forbidden_actor(capture)

    def test_forbidden_actor_rejects_each_cross_mutation(self) -> None:
        for key in (
            "conversationDelta",
            "turnDelta",
            "messageDelta",
            "queueDelta",
            "providerExecutionDelta",
        ):
            with self.subTest(key=key):
                capture = valid_forbidden_actor_capture()
                capture["station"][key] = 1
                with self.assertRaisesRegex(
                    GroupOneScenarioError,
                    "zeroCrossMutation",
                ):
                    evaluate_base_forbidden_actor(capture)

    def test_forbidden_actor_rejects_replay_drift(self) -> None:
        capture = valid_forbidden_actor_capture()
        capture["replay"]["replayHash"] = "e" * 64

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "replayEqual",
        ):
            evaluate_base_forbidden_actor(capture)

    def test_forbidden_actor_requires_complete_cleanup(self) -> None:
        for key in (
            "localProjectionCleared",
            "foreignResourceDeleted",
            "foreignAgentDeleted",
            "ownerSelectionRestored",
            "receiverRestored",
            "conversationDeleted",
        ):
            with self.subTest(key=key):
                capture = valid_forbidden_actor_capture()
                capture["cleanup"][key] = False
                with self.assertRaisesRegex(
                    GroupOneScenarioError,
                    "cleanupComplete",
                ):
                    evaluate_base_forbidden_actor(capture)

    def test_incompatible_capability_accepts_exact_production_facts(self) -> None:
        for locale in ("en", "zh-CN"):
            with self.subTest(locale=locale):
                assertions = evaluate_base_incompatible_capability(
                    valid_incompatible_capability_capture(locale)
                )
                self.assertEqual(len(assertions), 6)
                self.assertTrue(all(assertions.values()))
                self.assertTrue(
                    all(type(value) is bool for value in assertions.values())
                )

    def test_incompatible_capability_rejects_typed_contract_tampering(
        self,
    ) -> None:
        mutations = (
            lambda capture: capture["outcome"].update(
                {"error": "agent.errors.generic"}
            ),
            lambda capture: capture["outcome"].update(
                {"error_type": "RUNTIME_UNAVAILABLE"}
            ),
            lambda capture: capture["outcome"].update(
                {"locale_key": "agent.errors.generic"}
            ),
            lambda capture: capture["outcome"].update({"retryable": True}),
            lambda capture: capture["outcome"].update({"terminal": False}),
            lambda capture: capture["outcome"]["details"].update(
                {"model_id": "private-model"}
            ),
            lambda capture: capture["outcome"]["details"].update(
                {"capability_id": "tools.execute"}
            ),
            lambda capture: capture["runtimeEvent"].update(
                {"errorType": "RUNTIME_UNAVAILABLE"}
            ),
        )
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                capture = valid_incompatible_capability_capture()
                mutation(capture)
                with self.assertRaisesRegex(
                    GroupOneScenarioError,
                    "typedIncompatibleCapabilityRejected",
                ):
                    evaluate_base_incompatible_capability(capture)

    def test_incompatible_capability_requires_localized_recovery(self) -> None:
        for key, value in (
            ("errorText", "Incompatible"),
            ("recoveryVisible", False),
            ("recoveryLocaleKey", "agent.recovery.chooseModel"),
            ("recoveryText", "Choose model"),
            ("recoveryExecuted", False),
            ("profileVisible", False),
            ("profileAgentId", "agent-other"),
            ("modelSelectionVisible", False),
            ("selectedModelId", "model-compatible"),
        ):
            with self.subTest(key=key):
                capture = valid_incompatible_capability_capture()
                capture["receiver"][key] = value
                with self.assertRaisesRegex(
                    GroupOneScenarioError,
                    "localizedChooseCompatibleModelRecovery",
                ):
                    evaluate_base_incompatible_capability(capture)

    def test_incompatible_capability_rejects_station_readback_tampering(
        self,
    ) -> None:
        mutations = (
            lambda capture: capture["readiness"].update(
                {"source": "desktop-cache"}
            ),
            lambda capture: capture["readiness"].update(
                {"stateAfter": "ready"}
            ),
            lambda capture: capture["readiness"].update(
                {"reasonCode": "model_capability_inferred"}
            ),
            lambda capture: capture["readiness"].update(
                {"runtimeSnapshotIdAfter": "runtime-compatible"}
            ),
            lambda capture: capture["readiness"].update(
                {"bindingRevisionAfter": 8}
            ),
            lambda capture: capture["station"].update(
                {"selectedModelIdAfter": "model-compatible"}
            ),
            lambda capture: capture["station"].update(
                {"conversationVersionAfter": 4}
            ),
            lambda capture: capture["station"].update(
                {"afterHash": "7" * 64}
            ),
        )
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                capture = valid_incompatible_capability_capture()
                mutation(capture)
                with self.assertRaisesRegex(
                    GroupOneScenarioError,
                    "stationReadinessReadback",
                ):
                    evaluate_base_incompatible_capability(capture)

    def test_incompatible_capability_rejects_each_side_effect(self) -> None:
        for owner, key, value in (
            ("execution", "runtimeExecutionDelta", 1),
            ("execution", "providerCallDelta", 1),
            ("execution", "toolCallDelta", 1),
            ("execution", "toolExecutionDelta", 1),
            ("execution", "sideEffectDelta", 1),
            ("station", "turnDelta", 2),
            ("station", "messageDelta", 1),
            ("station", "queueDelta", 1),
        ):
            with self.subTest(owner=owner, key=key):
                capture = valid_incompatible_capability_capture()
                capture[owner][key] = value
                with self.assertRaisesRegex(
                    GroupOneScenarioError,
                    "zeroRejectedPathSideEffects",
                ):
                    evaluate_base_incompatible_capability(capture)

    def test_incompatible_capability_rejects_replay_tampering(self) -> None:
        capture = valid_incompatible_capability_capture()
        capture["replay"]["replayHash"] = "8" * 64

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "replayEqual",
        ):
            evaluate_base_incompatible_capability(capture)

    def test_incompatible_capability_requires_complete_cleanup(self) -> None:
        for key in (
            "localProjectionCleared",
            "conversationDeleted",
            "disposableAgentDeleted",
            "capabilityBindingRemoved",
            "fixtureProviderRestored",
            "modelConfigurationUnchanged",
        ):
            with self.subTest(key=key):
                capture = valid_incompatible_capability_capture()
                capture["cleanup"][key] = False
                with self.assertRaisesRegex(
                    GroupOneScenarioError,
                    "cleanupComplete",
                ):
                    evaluate_base_incompatible_capability(capture)

    def test_cancelled_accepts_exact_production_facts(self) -> None:
        assertions = evaluate_base_cancelled(valid_cancelled_capture())

        self.assertEqual(len(assertions), 7)
        self.assertTrue(all(assertions.values()))

    def test_cancelled_rejects_unsafe_details(self) -> None:
        capture = valid_cancelled_capture()
        capture["outcome"]["details"]["actor_id"] = "private-actor"

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "typedCancellationProjected",
        ):
            evaluate_base_cancelled(capture)

    def test_cancelled_rejects_late_success(self) -> None:
        capture = valid_cancelled_capture()
        capture["station"]["doneEventCount"] = 1

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "zeroLateSuccess",
        ):
            evaluate_base_cancelled(capture)

    def test_cancelled_requires_live_reload_and_replay_projection_parity(
        self,
    ) -> None:
        capture = valid_cancelled_capture()
        capture["receiver"]["phases"]["replaySnapshot"]["errorType"] = None

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "localizedCancellationVisible",
        ):
            evaluate_base_cancelled(capture)

    def test_cancelled_rejects_synthetic_live_message_identity(self) -> None:
        capture = valid_cancelled_capture()
        capture["receiver"]["phases"]["live"][
            "messageId"
        ] = "recovered-turn-cancelled"

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "localizedCancellationVisible",
        ):
            evaluate_base_cancelled(capture)

    def test_cancelled_rejects_wrong_source_replay_snapshot(self) -> None:
        capture = valid_cancelled_capture()
        capture["replay"]["snapshot"]["sourceTurnId"] = "turn-other"

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "replayEqual",
        ):
            evaluate_base_cancelled(capture)

    def test_cancelled_requires_one_cleanup_and_conversation_deletion(
        self,
    ) -> None:
        capture = valid_cancelled_capture()
        capture["cleanup"]["terminalCleanupCount"] = 2

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "cleanupComplete",
        ):
            evaluate_base_cancelled(capture)

    def test_context_overflow_accepts_exact_production_facts(self) -> None:
        assertions = evaluate_base_context_overflow(
            valid_context_overflow_capture()
        )

        self.assertEqual(len(assertions), 8)
        self.assertTrue(all(assertions.values()))
        self.assertTrue(all(type(value) is bool for value in assertions.values()))

    def test_context_overflow_rejects_unsafe_details(self) -> None:
        capture = valid_context_overflow_capture()
        capture["outcome"]["details"]["prompt"] = "private"

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "typedContextOverflow",
        ):
            evaluate_base_context_overflow(capture)

    def test_context_overflow_rejects_draft_loss(self) -> None:
        capture = valid_context_overflow_capture()
        capture["receiver"]["draftHashAfterRejection"] = "3" * 64

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "rejectedDraftPreserved",
        ):
            evaluate_base_context_overflow(capture)

    def test_context_overflow_rejects_provider_execution(self) -> None:
        capture = valid_context_overflow_capture()
        capture["station"]["providerExecutionDelta"] = 1

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "zeroPersistenceAndProvider",
        ):
            evaluate_base_context_overflow(capture)

    def test_context_overflow_rejects_wrong_source_identity(self) -> None:
        capture = valid_context_overflow_capture()
        capture["runtimeEvent"]["sourceConversationId"] = "conversation-other"

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "typedContextOverflow",
        ):
            evaluate_base_context_overflow(capture)

    def test_context_overflow_requires_cleanup(self) -> None:
        capture = valid_context_overflow_capture()
        capture["cleanup"]["conversationDeleted"] = False

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "cleanupComplete",
        ):
            evaluate_base_context_overflow(capture)

    def test_duplicate_conflict_accepts_exact_production_facts(self) -> None:
        assertions = evaluate_base_duplicate_conflict(
            valid_duplicate_conflict_capture()
        )

        self.assertEqual(len(assertions), 8)
        self.assertTrue(all(assertions.values()))
        self.assertTrue(all(type(value) is bool for value in assertions.values()))

    def test_duplicate_conflict_rejects_typed_contract_drift(self) -> None:
        for key, value in (
            ("error_type", "IDEMPOTENCY_CONFLICT"),
            ("locale_key", "agent.errors.generic"),
            ("retryable", True),
        ):
            with self.subTest(key=key):
                capture = valid_duplicate_conflict_capture()
                capture["outcome"][key] = value
                with self.assertRaisesRegex(
                    GroupOneScenarioError,
                    "typedDuplicateConflictProjected",
                ):
                    evaluate_base_duplicate_conflict(capture)

    def test_duplicate_conflict_rejects_identity_or_row_drift(self) -> None:
        mutations = (
            lambda capture: capture["outcome"]["details"].update(
                {"existing_command_id": "turn-other"}
            ),
            lambda capture: capture["station"].update(
                {"originalMessageIdsAfter": ["message-other"]}
            ),
            lambda capture: capture["station"].update({"turnDelta": 1}),
            lambda capture: capture["station"].update(
                {"providerExecutionDelta": 1}
            ),
            lambda capture: capture["runtimeEvent"].update(
                {"sourceConversationId": "conversation-other"}
            ),
        )
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                capture = valid_duplicate_conflict_capture()
                mutation(capture)
                with self.assertRaises(GroupOneScenarioError):
                    evaluate_base_duplicate_conflict(capture)

    def test_duplicate_conflict_requires_open_original_recovery(self) -> None:
        for key, value, expected in (
            ("errorText", "Conflict", "localizedRecoveryVisible"),
            ("recoveryVisible", False, "localizedRecoveryVisible"),
            ("recoveryText", "Open", "localizedRecoveryVisible"),
            ("openOriginalExecuted", False, "openOriginalExecuted"),
            ("openedTurnId", "turn-other", "openOriginalExecuted"),
        ):
            with self.subTest(key=key):
                capture = valid_duplicate_conflict_capture()
                capture["receiver"][key] = value
                with self.assertRaisesRegex(GroupOneScenarioError, expected):
                    evaluate_base_duplicate_conflict(capture)

    def test_duplicate_conflict_requires_cleanup(self) -> None:
        capture = valid_duplicate_conflict_capture()
        capture["cleanup"]["portalClosed"] = False

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "cleanupComplete",
        ):
            evaluate_base_duplicate_conflict(capture)

    def test_credential_missing_accepts_exact_production_facts(self) -> None:
        assertions = evaluate_base_credential_missing(
            valid_credential_missing_capture()
        )

        self.assertEqual(len(assertions), 8)
        self.assertTrue(all(assertions.values()))

    def test_credential_missing_rejects_unsafe_details(self) -> None:
        for mutation in (
            lambda capture: capture["outcome"]["details"].update(
                {"credential": "secret"}
            ),
            lambda capture: capture["outcome"]["details"].update(
                {"provider_id": "provider-other"}
            ),
        ):
            with self.subTest(mutation=mutation):
                capture = valid_credential_missing_capture()
                mutation(capture)
                with self.assertRaisesRegex(
                    GroupOneScenarioError,
                    "typedProviderConfigMissing",
                ):
                    evaluate_base_credential_missing(capture)

    def test_credential_missing_requires_localized_executed_action(self) -> None:
        for key, value, expected in (
            ("errorText", "Credential missing", "localizedRecoveryVisible"),
            ("recoveryVisible", False, "localizedRecoveryVisible"),
            ("recoveryText", "Configure", "localizedRecoveryVisible"),
            (
                "configureProviderExecuted",
                False,
                "configureProviderExecuted",
            ),
        ):
            with self.subTest(key=key):
                capture = valid_credential_missing_capture()
                capture["receiver"][key] = value
                with self.assertRaisesRegex(GroupOneScenarioError, expected):
                    evaluate_base_credential_missing(capture)

    def test_credential_missing_requires_absent_credential_at_admission(
        self,
    ) -> None:
        for key, value in (
            ("providerStatusBefore", "configured"),
            ("providerConfiguredBefore", True),
            ("providerStatusAfter", "configured"),
            ("providerConfiguredAfter", True),
        ):
            with self.subTest(key=key):
                capture = valid_credential_missing_capture()
                capture["station"][key] = value
                with self.assertRaisesRegex(
                    GroupOneScenarioError,
                    "providerConfigAbsentAtAdmission",
                ):
                    evaluate_base_credential_missing(capture)

    def test_credential_missing_rejects_station_or_provider_delta(
        self,
    ) -> None:
        for key, expected in (
            ("turnDelta", "stationStateUnchanged"),
            ("messageDelta", "stationStateUnchanged"),
            ("queueDelta", "stationStateUnchanged"),
            ("providerExecutionDelta", "zeroProviderCall"),
        ):
            with self.subTest(key=key):
                capture = valid_credential_missing_capture()
                capture["station"][key] = 1
                with self.assertRaisesRegex(GroupOneScenarioError, expected):
                    evaluate_base_credential_missing(capture)

    def test_credential_missing_rejects_source_identity_drift(self) -> None:
        for key, value in (
            ("sourceTransport", "local"),
            ("sourceConversationId", "conversation-other"),
            ("sourceTurnId", "turn-forged"),
            ("sourceSequence", 1),
            ("sourceEventType", "done"),
            ("conversationIdHash", "f" * 64),
        ):
            with self.subTest(key=key):
                capture = valid_credential_missing_capture()
                capture["runtimeEvent"][key] = value
                with self.assertRaisesRegex(
                    GroupOneScenarioError,
                    "typedProviderConfigMissing",
                ):
                    evaluate_base_credential_missing(capture)

    def test_credential_missing_rejects_replay_drift(self) -> None:
        capture = valid_credential_missing_capture()
        capture["replay"]["replayHash"] = "f" * 64

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "replayEqual",
        ):
            evaluate_base_credential_missing(capture)

    def test_credential_missing_requires_fixture_restoration(self) -> None:
        for key, value in (
            ("conversationDeleted", False),
            ("disposableAgentDeleted", False),
            ("restoredSelection", "other-agent"),
        ):
            with self.subTest(key=key):
                capture = valid_credential_missing_capture()
                capture["cleanup"][key] = value
                with self.assertRaisesRegex(
                    GroupOneScenarioError,
                    "cleanupComplete",
                ):
                    evaluate_base_credential_missing(capture)

    def test_attachment_rejected_accepts_exact_production_facts(self) -> None:
        assertions = evaluate_base_attachment_rejected(
            valid_attachment_rejected_capture()
        )

        self.assertEqual(len(assertions), 8)
        self.assertTrue(all(assertions.values()))

    def test_attachment_rejected_rejects_unsafe_details(self) -> None:
        capture = valid_attachment_rejected_capture()
        capture["outcome"]["details"]["object_ref"] = "oss:private-object"

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "typedAttachmentRejected",
        ):
            evaluate_base_attachment_rejected(capture)

    def test_attachment_rejected_rejects_draft_loss(self) -> None:
        capture = valid_attachment_rejected_capture()
        capture["receiver"]["draftTextAfterRejection"] = "different draft"

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "rejectedDraftPreserved",
        ):
            evaluate_base_attachment_rejected(capture)

    def test_attachment_rejected_rejects_provider_execution(self) -> None:
        capture = valid_attachment_rejected_capture()
        capture["station"]["providerExecutionDelta"] = 1

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "zeroSideEffect",
        ):
            evaluate_base_attachment_rejected(capture)

    def test_attachment_rejected_rejects_unrelated_runtime_event(self) -> None:
        capture = valid_attachment_rejected_capture()
        capture["runtimeEvent"]["eventType"] = "done"

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "typedAttachmentRejected",
        ):
            evaluate_base_attachment_rejected(capture)

    def test_attachment_rejected_requires_authoritative_deletion(self) -> None:
        capture = valid_attachment_rejected_capture()
        capture["cleanup"]["deletionReadback"]["source"] = "resolve-error"

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "cleanupComplete",
        ):
            evaluate_base_attachment_rejected(capture)

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

    def test_executor_unavailable_accepts_exact_production_facts(self) -> None:
        assertions = evaluate_base_executor_unavailable(
            valid_executor_unavailable_capture()
        )

        self.assertEqual(len(assertions), 9)
        self.assertTrue(all(assertions.values()))

    def test_executor_unavailable_rejects_decision_mutation(self) -> None:
        capture = valid_executor_unavailable_capture()
        capture["station"]["lineage"]["decisionId"] = "decision-executor"

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "waitingApprovalPreserved",
        ):
            evaluate_base_executor_unavailable(capture)

    def test_executor_unavailable_rejects_local_side_effect_delta(self) -> None:
        capture = valid_executor_unavailable_capture()
        capture["executor"]["restoredSideEffectCount"] = 1

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "zeroSideEffect",
        ):
            evaluate_base_executor_unavailable(capture)

    def test_approval_expired_accepts_exact_production_facts(self) -> None:
        assertions = evaluate_base_approval_expired(
            valid_approval_expired_capture()
        )

        self.assertEqual(len(assertions), 7)
        self.assertTrue(all(assertions.values()))

    def test_approval_expired_rejects_unsafe_details(self) -> None:
        capture = valid_approval_expired_capture()
        capture["outcome"]["details"]["tool_call_id"] = "tool-call-expired"

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "typedExpiryProjected",
        ):
            evaluate_base_approval_expired(capture)

    def test_approval_expired_rejects_decision_mutation(self) -> None:
        capture = valid_approval_expired_capture()
        capture["station"]["lineage"]["decisionId"] = "decision-expired"

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "expiredDecisionImmutable",
        ):
            evaluate_base_approval_expired(capture)

    def test_approval_expired_rejects_duplicate_retry_attempt(self) -> None:
        capture = valid_approval_expired_capture()
        capture["recovery"]["attemptCountAfter"] = 3

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "requestAgainCreatedOneAttempt",
        ):
            evaluate_base_approval_expired(capture)

    def test_approval_expired_rejects_retry_side_effect(self) -> None:
        capture = valid_approval_expired_capture()
        capture["recovery"]["retrySideEffectCount"] = 1

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "zeroSideEffect",
        ):
            evaluate_base_approval_expired(capture)


if __name__ == "__main__":
    unittest.main()
