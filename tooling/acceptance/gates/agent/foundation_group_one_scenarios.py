#!/usr/bin/env python3
"""Fail-closed scenario oracles for Foundation Group 1 runtime captures."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from typing import Any


class GroupOneScenarioError(RuntimeError):
    """A scenario capture is missing reviewed production facts."""


AS_F04_MAX_TOOL_CALLS = 2
AS_F06_CONTROL_EVENTS = {
    "connection_lost",
    "reconnecting",
    "replaying",
    "reconciling",
    "connected",
    "recovery_failed",
    "catchup_done",
}


def _canonical_payload_hash(value: Any) -> str:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _replay_delivery_identity(
    delivery: Mapping[str, Any],
) -> dict[str, Any]:
    return {
        "eventType": delivery.get("eventType"),
        "sequence": delivery.get("sequence"),
        "sourceTransport": delivery.get("sourceTransport"),
        "sourcePtidHash": delivery.get("sourcePtidHash"),
        "sourceConversationId": delivery.get("sourceConversationId"),
        "sourceTurnId": delivery.get("sourceTurnId"),
        "sourceSequence": delivery.get("sourceSequence"),
        "sourceEventType": delivery.get("sourceEventType"),
        "rawPayload": delivery.get("rawPayload"),
        "payloadHash": delivery.get("payloadHash"),
    }


def evaluate_as_f02(capture: Mapping[str, Any]) -> dict[str, bool]:
    invalid = _mapping(capture, "invalidSubmission")
    duplicate = _mapping(capture, "duplicateSubmission")
    queue = _mapping(capture, "queueSubmission")
    draft = _mapping(capture, "draftRecovery")
    rename = _mapping(capture, "rename")
    archive = _mapping(capture, "archive")
    deletion = _mapping(capture, "deletion")

    entries = _list(queue, "entries")
    positions = [_positive_int(entry, "queue_position") for entry in entries]
    queue_capacity = _positive_int(queue, "queueCapacity")
    if len(entries) != queue_capacity:
        raise GroupOneScenarioError(
            f"AS-F02 queue snapshot is not full: {len(entries)}/{queue_capacity}"
        )
    if positions != list(range(1, queue_capacity + 1)):
        raise GroupOneScenarioError(
            f"AS-F02 queue positions are not FIFO: {positions}"
        )

    overflow = _mapping(queue, "overflow")
    cancellation = _mapping(queue, "cancellation")
    receiver = _mapping(queue, "receiverDom")
    visible_positions = _positive_int(receiver, "visibleQueuePositions")
    assertions = {
        "invalidInputRejected": (
            invalid.get("errorCode") == "INVALID_REQUEST"
            and invalid.get("conversationDelta") == 0
            and invalid.get("turnDelta") == 0
        ),
        "duplicateIdempotent": (
            _nonempty_string(duplicate, "firstTurnId")
            == _nonempty_string(duplicate, "replayedTurnId")
            and duplicate.get("turnDelta") == 1
            and duplicate.get("queueEntryDelta") == 0
        ),
        "queuePositionVisible": (
            visible_positions == queue_capacity
            and receiver.get("visible") is True
            and _nonempty_string(cancellation, "queueEntryId")
            and cancellation.get("status") == "cancelled"
        ),
        "overflowVisible": (
            overflow.get("errorCode") == "ADMISSION_QUEUE_FULL"
            and overflow.get("queueSize") == queue_capacity
        ),
        "rejectedDraftRestored": (
            _nonempty_string(draft, "beforeHash")
            == _nonempty_string(draft, "afterHash")
            and draft.get("editable") is True
        ),
        "renamePersisted": (
            _nonempty_string(rename, "expectedTitle")
            == _nonempty_string(rename, "readbackTitle")
            and _positive_int(rename, "versionAfter")
            > _positive_int(rename, "versionBefore")
        ),
        "archivePersisted": (
            archive.get("status") == "archived"
            and archive.get("recoverable") is True
        ),
        "deletePolicyEnforced": (
            deletion.get("activeDependencyError")
            == "ACTIVE_DEPENDENCY"
            and deletion.get("deletedAfterSettlement") is True
        ),
    }
    failed = sorted(key for key, passed in assertions.items() if not passed)
    if failed:
        raise GroupOneScenarioError(
            f"AS-F02 production facts failed assertions: {failed}"
        )
    return assertions


def evaluate_as_f03(capture: Mapping[str, Any]) -> dict[str, bool | None]:
    tool_isolation = _mapping(
        capture,
        "toolIsolation",
        scenario="AS-F03",
    )
    events = [
        _mapping({"event": value}, "event", scenario="AS-F03")
        for value in _list(capture, "events", scenario="AS-F03")
    ]
    sequences = [
        _positive_int(event, "sequence", scenario="AS-F03")
        for event in events
    ]
    terminal_events = [
        event
        for event in events
        if event.get("eventType") in {"done", "error", "cancelled"}
    ]
    assertions: dict[str, bool | None] = {
        "progressiveEventsSequenced": (
            any(event.get("eventType") == "progress" for event in events)
            and any(event.get("eventType") == "text" for event in events)
            and not any(
                event.get("eventType") == "thinking"
                for event in events
            )
            and _nonnegative_int(
                tool_isolation,
                "readyCapabilityCount",
                scenario="AS-F03",
            ) == 0
            and _nonnegative_int(
                capture,
                "toolDefinitionTokens",
                scenario="AS-F03",
            ) == 0
            and sequences == sorted(set(sequences))
        ),
        "cancelledDuringTextAuthoritative": (
            capture.get("sawTextBeforeCancel") is True
            and capture.get("thinkingMode") == "disabled"
        ),
        "exactlyOneAuthoritativeTerminal": (
            len(terminal_events) == 1
            and terminal_events[0].get("eventType") == "cancelled"
        ),
        "terminalTracePersisted": (
            capture.get("terminalTracePersisted") is True
        ),
        "toolAndApprovalWaits": None,
    }
    failed = sorted(
        key for key, passed in assertions.items()
        if passed is not None and not passed
    )
    if failed:
        diagnostics = {
            "eventTypes": [event.get("eventType") for event in events],
            "sequences": sequences,
            "readyCapabilityCount": tool_isolation.get(
                "readyCapabilityCount"
            ),
            "toolDefinitionTokens": capture.get("toolDefinitionTokens"),
        }
        raise GroupOneScenarioError(
            "AS-F03 production facts failed assertions: "
            f"{failed}; diagnostics={diagnostics}"
        )
    return assertions


def evaluate_as_f04(
    capture: Mapping[str, Any],
    *,
    platform: str,
) -> dict[str, bool]:
    cases = _mapping(capture, "cases", scenario="AS-F04")
    auto = _mapping(cases, "auto", scenario="AS-F04")
    manual = _mapping(cases, "manual", scenario="AS-F04")
    denied = _mapping(cases, "deny", scenario="AS-F04")
    expired = _mapping(cases, "expiry", scenario="AS-F04")
    duplicate = _mapping(capture, "duplicateDelivery", scenario="AS-F04")
    loop_budget = _mapping(capture, "loopBudget", scenario="AS-F04")
    replay = _mapping(capture, "replay", scenario="AS-F04")

    expected_owner = {
        "desktop_app": "client_capability",
        "browser": "station",
    }.get(platform)
    if expected_owner is None:
        raise GroupOneScenarioError(
            f"AS-F04 unsupported platform {platform!r}"
        )

    def states(case: Mapping[str, Any], name: str) -> list[str]:
        values = case.get("states")
        if not isinstance(values, list) or any(
            not isinstance(value, str) or not value for value in values
        ):
            raise GroupOneScenarioError(
                f"AS-F04 {name}.states fact is invalid"
            )
        return values

    def count(case: Mapping[str, Any], key: str) -> int:
        return _nonnegative_int(case, key, scenario="AS-F04")

    def lineage_complete(
        case: Mapping[str, Any],
        *,
        terminal: bool,
        decision_required: bool = True,
    ) -> bool:
        lineage = _mapping(case, "lineage", scenario="AS-F04")
        common = (
            _nonempty_string(lineage, "toolCallId", scenario="AS-F04")
            and _nonempty_string(lineage, "toolBatchId", scenario="AS-F04")
            and _nonempty_string(lineage, "manifestId", scenario="AS-F04")
            and _nonempty_string(lineage, "manifestVersion", scenario="AS-F04")
            and _nonempty_string(lineage, "bindingId", scenario="AS-F04")
            and _positive_int(lineage, "bindingRevision", scenario="AS-F04")
            and _nonempty_string(
                lineage,
                "readinessSnapshotId",
                scenario="AS-F04",
            )
            and _nonempty_string(lineage, "approvalId", scenario="AS-F04")
        )
        if decision_required:
            common = bool(
                common
                and _nonempty_string(
                    lineage,
                    "decisionId",
                    scenario="AS-F04",
                )
            )
        if not common:
            return False
        if not terminal:
            return True
        return bool(
            _nonempty_string(lineage, "executionClaimId", scenario="AS-F04")
            and _positive_int(lineage, "fencingToken", scenario="AS-F04")
            and _nonempty_string(
                lineage,
                "sideEffectReceiptId",
                scenario="AS-F04",
            )
            and _nonempty_string(lineage, "resultId", scenario="AS-F04")
            and _nonempty_string(lineage, "continuationId", scenario="AS-F04")
            and lineage.get("dispatchCommittedAt")
            and lineage.get("startedAt")
            and lineage.get("endedAt")
        )

    auto_states = states(auto, "auto")
    manual_states = states(manual, "manual")
    deny_states = states(denied, "deny")
    expiry_states = states(expired, "expiry")
    executed_cases = (auto, manual)
    nonexecuted_cases = (denied, expired)
    owner_matches = all(
        case.get("executionOwner") == expected_owner
        for case in (*executed_cases, *nonexecuted_cases)
    )

    assertions = {
        "autoPolicyExecutedOnce": (
            auto.get("policy") == "auto"
            and auto_states
            == ["policy_check", "auto_approved", "running", "succeeded"]
            and count(auto, "executionAttemptCount") == 1
            and count(auto, "sideEffectCount") == 1
            and count(auto, "resultCount") == 1
            and count(auto, "continuationCount") == 1
        ),
        "manualApprovalExecutedOnce": (
            manual.get("policy") == "manual"
            and manual_states
            == [
                "policy_check",
                "awaiting_user",
                "approved",
                "running",
                "succeeded",
            ]
            and count(manual, "executionAttemptCount") == 1
            and count(manual, "sideEffectCount") == 1
            and count(manual, "resultCount") == 1
            and count(manual, "continuationCount") == 1
        ),
        "denialExecutedZero": (
            denied.get("policy") == "deny"
            and deny_states == ["policy_check", "denied"]
            and all(
                count(denied, key) == 0
                for key in (
                    "executionAttemptCount",
                    "sideEffectCount",
                    "resultCount",
                    "continuationCount",
                )
            )
        ),
        "expiryExecutedZero": (
            expired.get("policy") == "manual"
            and expiry_states
            == ["policy_check", "awaiting_user", "expired"]
            and all(
                count(expired, key) == 0
                for key in (
                    "executionAttemptCount",
                    "sideEffectCount",
                    "resultCount",
                    "continuationCount",
                )
            )
        ),
        "duplicateDeliveryIdempotent": (
            count(duplicate, "deliveryCount") >= 2
            and count(duplicate, "executionAttemptCount") == 1
            and count(duplicate, "sideEffectCount") == 1
            and count(duplicate, "resultCount") == 1
            and count(duplicate, "continuationCount") == 1
            and _nonempty_string(
                duplicate,
                "originalResultId",
                scenario="AS-F04",
            )
            == _nonempty_string(
                duplicate,
                "replayedResultId",
                scenario="AS-F04",
            )
            and _nonempty_string(
                duplicate,
                "originalContinuationId",
                scenario="AS-F04",
            )
            == _nonempty_string(
                duplicate,
                "replayedContinuationId",
                scenario="AS-F04",
            )
        ),
        "authorityLineagePersisted": (
            owner_matches
            and lineage_complete(auto, terminal=True)
            and lineage_complete(manual, terminal=True)
            and lineage_complete(denied, terminal=False)
            and lineage_complete(
                expired,
                terminal=False,
                decision_required=False,
            )
        ),
        "loopBudgetEnforced": (
            loop_budget.get("stopped") is True
            and _nonempty_string(
                loop_budget,
                "terminalReason",
                scenario="AS-F04",
            )
            == "max_tool_calls_exhausted"
            and _positive_int(
                loop_budget,
                "requestedLimit",
                scenario="AS-F04",
            )
            == AS_F04_MAX_TOOL_CALLS
            == _positive_int(
                loop_budget,
                "effectiveLimit",
                scenario="AS-F04",
            )
            == _positive_int(
                loop_budget,
                "observedIterations",
                scenario="AS-F04",
            )
            == _positive_int(
                loop_budget,
                "maximumIterations",
                scenario="AS-F04",
            )
            and count(loop_budget, "executionAfterLimit") == 0
        ),
        "sourceReplayEqual": (
            _nonempty_string(replay, "sourceHash", scenario="AS-F04")
            == _nonempty_string(replay, "replayHash", scenario="AS-F04")
            and replay.get("equal") is True
        ),
    }
    failed = sorted(key for key, passed in assertions.items() if not passed)
    if failed:
        raise GroupOneScenarioError(
            f"AS-F04 production facts failed assertions: {failed}"
        )
    return assertions


def evaluate_as_f05(capture: Mapping[str, Any]) -> dict[str, bool]:
    valid_files = _mapping(capture, "validFiles", scenario="AS-F05")
    png = _mapping(valid_files, "png", scenario="AS-F05")
    pdf = _mapping(valid_files, "pdf", scenario="AS-F05")
    persistence = _mapping(capture, "persistence", scenario="AS-F05")
    upload_recovery = _mapping(capture, "uploadRecovery", scenario="AS-F05")
    failed_upload = _mapping(
        upload_recovery,
        "failedUpload",
        scenario="AS-F05",
    )
    removal = _mapping(upload_recovery, "removal", scenario="AS-F05")
    rejections = _mapping(capture, "rejections", scenario="AS-F05")
    oversized = _mapping(rejections, "oversized", scenario="AS-F05")
    unsupported = _mapping(rejections, "unsupported", scenario="AS-F05")
    unauthorized = _mapping(rejections, "unauthorized", scenario="AS-F05")
    references = _list(capture, "references", scenario="AS-F05")
    download = _mapping(capture, "authorizedDownload", scenario="AS-F05")

    def valid_handled_file(
        fact: Mapping[str, Any],
        *,
        mime_type: str,
    ) -> bool:
        disposition = fact.get("modelDisposition")
        return (
            fact.get("mimeType") == mime_type
            and disposition in {"consumed", "omitted"}
            and _nonempty_string(fact, "attachmentId", scenario="AS-F05")
            and _opaque_object_ref(fact, "objectRef")
            and _positive_int(fact, "sizeBytes", scenario="AS-F05")
            and _nonempty_string(fact, "checksum", scenario="AS-F05")
            and _nonempty_string(
                fact,
                "authorizationScope",
                scenario="AS-F05",
            )
            and _nonempty_string(fact, "expiresAt", scenario="AS-F05")
            and (
                (disposition == "consumed" and fact.get("modelVisible") is True)
                or (
                    disposition == "omitted"
                    and fact.get("modelVisible") is False
                    and _nonempty_string(
                        fact,
                        "omissionReason",
                        scenario="AS-F05",
                    )
                    and fact.get("ledgerDecision") is not None
                )
            )
        )

    before_restart = _normalized_attachment_metadata(
        persistence,
        "beforeRestart",
    )
    after_restart = _normalized_attachment_metadata(
        persistence,
        "afterRestart",
    )
    projection_readback = _normalized_attachment_metadata(
        persistence,
        "projectionReadback",
    )
    context_segment_ids = _string_list(
        persistence,
        "contextSegmentAttachmentIds",
        scenario="AS-F05",
    )
    expected_attachment_ids = sorted(
        {
            _nonempty_string(png, "attachmentId", scenario="AS-F05"),
            _nonempty_string(pdf, "attachmentId", scenario="AS-F05"),
        }
    )

    before_siblings = sorted(
        _string_list(
            removal,
            "siblingIdsBefore",
            scenario="AS-F05",
        )
    )
    after_siblings = sorted(
        _string_list(
            removal,
            "siblingIdsAfter",
            scenario="AS-F05",
        )
    )
    removed_attachment_id = _nonempty_string(
        removal,
        "removedAttachmentId",
        scenario="AS-F05",
    )

    def rejected_before_provider(fact: Mapping[str, Any]) -> bool:
        return (
            fact.get("accepted") is False
            and fact.get("errorCode") == "CONTEXT_ATTACHMENT_REJECTED"
            and _nonnegative_int(fact, "turnDelta", scenario="AS-F05") == 0
            and _nonnegative_int(
                fact,
                "providerExecutionDelta",
                scenario="AS-F05",
            )
            == 0
            and _nonnegative_int(fact, "messageDelta", scenario="AS-F05") == 0
        )

    normalized_references = [
        (
            _nonempty_string(reference, "attachmentId", scenario="AS-F05"),
            _opaque_object_ref(reference, "objectRef"),
        )
        for reference in references
    ]
    reference_ids = sorted(
        attachment_id for attachment_id, opaque in normalized_references if opaque
    )
    assertions = {
        "validPngHandled": valid_handled_file(png, mime_type="image/png"),
        "validPdfHandled": valid_handled_file(
            pdf,
            mime_type="application/pdf",
        ),
        "metadataRestartReadback": (
            before_restart == after_restart == projection_readback
            and sorted(context_segment_ids) == expected_attachment_ids
            and sorted(item["attachmentId"] for item in after_restart)
            == expected_attachment_ids
        ),
        "failedUploadRetrySucceeded": (
            _nonempty_string(
                failed_upload,
                "errorCode",
                scenario="AS-F05",
            )
            == "CONTEXT_ATTACHMENT_REJECTED"
            and _nonempty_string(
                failed_upload,
                "retriedAttachmentId",
                scenario="AS-F05",
            )
            and _nonempty_string(
                failed_upload,
                "retriedChecksum",
                scenario="AS-F05",
            ).startswith("sha256:")
        ),
        "failedUploadRemovalPreservedSiblings": (
            before_siblings == after_siblings == expected_attachment_ids
            and removed_attachment_id not in after_siblings
            and removal.get("removedObjectUnavailable") is True
            and _string_list(
                removal,
                "siblingChecksumsBefore",
                scenario="AS-F05",
            )
            == _string_list(
                removal,
                "siblingChecksumsAfter",
                scenario="AS-F05",
            )
        ),
        "oversizedRejectedBeforeProvider": rejected_before_provider(oversized),
        "unsupportedRejectedBeforeProvider": rejected_before_provider(
            unsupported
        ),
        "unauthorizedRejectedBeforeProvider": rejected_before_provider(
            unauthorized
        ),
        "opaqueReferencesOnly": (
            len(references) == len(expected_attachment_ids)
            and reference_ids == expected_attachment_ids
            and not _contains_raw_path(capture)
        ),
        "authorizedDownloadVerified": (
            download.get("authorized") is True
            and download.get("downloaded") is True
            and _nonempty_string(
                download,
                "attachmentId",
                scenario="AS-F05",
            )
            in expected_attachment_ids
            and _nonempty_string(
                download,
                "expectedChecksum",
                scenario="AS-F05",
            )
            == _nonempty_string(
                download,
                "actualChecksum",
                scenario="AS-F05",
            )
        ),
    }
    failed = sorted(key for key, passed in assertions.items() if not passed)
    if failed:
        raise GroupOneScenarioError(
            f"AS-F05 production facts failed assertions: {failed}"
        )
    return assertions


def evaluate_as_f06(
    capture: Mapping[str, Any],
    *,
    platform: str,
    locale: str,
    sample_id: str,
) -> dict[str, bool]:
    scope = _mapping(capture, "scope", scenario="AS-F06")
    tool_isolation = _mapping(
        capture,
        "toolIsolation",
        scenario="AS-F06",
    )
    handoff = _mapping(capture, "handoff", scenario="AS-F06")
    transitions = _list(capture, "transitions", scenario="AS-F06")
    replay = _mapping(capture, "replay", scenario="AS-F06")
    idempotence = _mapping(capture, "idempotence", scenario="AS-F06")
    restart = _mapping(capture, "restartRecovery", scenario="AS-F06")
    restart_attestation = _mapping(
        restart,
        "stationRestart",
        scenario="AS-F06",
    )
    transport = _mapping(capture, "transportLoss", scenario="AS-F06")
    terminal = _mapping(capture, "terminalProjection", scenario="AS-F06")
    recovery_failure = _mapping(
        capture,
        "recoveryFailure",
        scenario="AS-F06",
    )
    recovery_retry = _mapping(
        recovery_failure,
        "retry",
        scenario="AS-F06",
    )
    durable_reload = _mapping(
        recovery_failure,
        "durableReload",
        scenario="AS-F06",
    )
    durable_reload_delivery = _mapping(
        durable_reload,
        "sourceDelivery",
        scenario="AS-F06",
    )
    stale_revision = _mapping(capture, "staleRevision", scenario="AS-F06")
    side_effects = _mapping(capture, "sideEffects", scenario="AS-F06")
    before_durable = _mapping(side_effects, "before", scenario="AS-F06")
    after_durable = _mapping(side_effects, "after", scenario="AS-F06")
    cleanup = _mapping(capture, "cleanup", scenario="AS-F06")

    phases = [
        _nonempty_string(transition, "phase", scenario="AS-F06")
        for transition in transitions
    ]
    required_phases = [
        "CONNECTION_LOST",
        "RECONNECTING",
        "REPLAYING",
        "RECONCILING",
        "CONNECTED",
    ]
    phase_positions = [
        phases.index(phase) if phase in phases else -1
        for phase in required_phases
    ]
    raw_replay_sequences = replay.get("eventSequences")
    if (
        not isinstance(raw_replay_sequences, list)
        or any(
            not isinstance(sequence, int)
            or isinstance(sequence, bool)
            or sequence <= 0
            for sequence in raw_replay_sequences
        )
    ):
        raise GroupOneScenarioError(
            "AS-F06 eventSequences fact is invalid"
        )
    replay_sequences = list(raw_replay_sequences)
    replay_deliveries = [
        _mapping({"delivery": value}, "delivery", scenario="AS-F06")
        for value in _list(replay, "deliveries", scenario="AS-F06")
    ]
    replay_delivery_sequences = [
        _positive_int(delivery, "sequence", scenario="AS-F06")
        for delivery in replay_deliveries
    ]
    replay_payloads = [
        _mapping(delivery, "rawPayload", scenario="AS-F06")
        for delivery in replay_deliveries
    ]
    replay_payload_hashes_valid = all(
        payload.get("eventType") == delivery.get("eventType")
        and delivery.get("eventType") not in AS_F06_CONTROL_EVENTS
        and (
            _mapping(payload, "data", scenario="AS-F06").get("seq")
            or _mapping(payload, "data", scenario="AS-F06").get("sequence")
        )
        == delivery.get("sequence")
        and _nonempty_string(
            delivery,
            "payloadHash",
            scenario="AS-F06",
        )
        == _canonical_payload_hash(payload)
        for delivery, payload in zip(
            replay_deliveries,
            replay_payloads,
        )
    )
    station_replay_deliveries = [
        _mapping({"delivery": value}, "delivery", scenario="AS-F06")
        for value in _list(
            replay,
            "stationReadbackDeliveries",
            scenario="AS-F06",
        )
    ]
    replay_identities = [
        _replay_delivery_identity(delivery)
        for delivery in replay_deliveries
    ]
    station_replay_identities = [
        _replay_delivery_identity(delivery)
        for delivery in station_replay_deliveries
    ]
    replay_source_matches = (
        replay_identities == station_replay_identities
        and _nonempty_string(replay, "sourceHash", scenario="AS-F06")
        == _canonical_payload_hash(replay_identities)
        and _nonempty_string(replay, "replayHash", scenario="AS-F06")
        == _canonical_payload_hash(station_replay_identities)
    )
    source_identity_valid = all(
        delivery.get("sourceTransport") == "station-sse"
        and delivery.get("sourcePtidHash") == handoff.get("actorPtidHash")
        and delivery.get("sourceConversationId")
        == handoff.get("conversationId")
        and delivery.get("sourceTurnId") == handoff.get("turnId")
        and delivery.get("sourceSequence") == delivery.get("sequence")
        and delivery.get("sourceEventType") == delivery.get("eventType")
        for delivery in replay_deliveries
    )
    after_cursor = _positive_int(replay, "afterCursor", scenario="AS-F06")
    blocker = recovery_failure.get("blocker")
    if not isinstance(blocker, str):
        raise GroupOneScenarioError("AS-F06 blocker fact is invalid")
    if blocker:
        raise GroupOneScenarioError(
            f"AS-F06 recovery failure probe blocked: {blocker}"
        )
    error_hash = _nonempty_string(
        recovery_failure,
        "errorHash",
        scenario="AS-F06",
    )
    duplicate_sequence = _positive_int(
        idempotence,
        "duplicateSequence",
        scenario="AS-F06",
    )
    out_of_order_sequence = _positive_int(
        idempotence,
        "outOfOrderSequence",
        scenario="AS-F06",
    )
    stale_generation = _positive_int(
        idempotence,
        "staleGeneration",
        scenario="AS-F06",
    )
    active_generation = _positive_int(
        idempotence,
        "activeGeneration",
        scenario="AS-F06",
    )
    cursor_before_mutation = _positive_int(
        idempotence,
        "cursorBeforeMutation",
        scenario="AS-F06",
    )
    cursor_after_mutation = _positive_int(
        idempotence,
        "cursorAfterMutation",
        scenario="AS-F06",
    )
    projection_before_mutation_hash = _nonempty_string(
        idempotence,
        "projectionBeforeMutationHash",
        scenario="AS-F06",
    )
    projection_after_mutation_hash = _nonempty_string(
        idempotence,
        "projectionAfterMutationHash",
        scenario="AS-F06",
    )
    duplicate_payload_hash = _nonempty_string(
        idempotence,
        "duplicatePayloadHash",
        scenario="AS-F06",
    )
    out_of_order_payload_hash = _nonempty_string(
        idempotence,
        "outOfOrderPayloadHash",
        scenario="AS-F06",
    )
    duplicate_mutation_before = _nonnegative_int(
        side_effects,
        "duplicateMutationBefore",
        scenario="AS-F06",
    )
    duplicate_mutation_after = _nonnegative_int(
        side_effects,
        "duplicateMutationAfter",
        scenario="AS-F06",
    )
    duplicate_mutation_delta = _nonnegative_int(
        side_effects,
        "duplicateMutationDelta",
        scenario="AS-F06",
    )
    duplicate_side_effect_before = _nonnegative_int(
        side_effects,
        "duplicateSideEffectBefore",
        scenario="AS-F06",
    )
    duplicate_side_effect_after = _nonnegative_int(
        side_effects,
        "duplicateSideEffectAfter",
        scenario="AS-F06",
    )
    duplicate_side_effect_delta = _nonnegative_int(
        side_effects,
        "duplicateSideEffectDelta",
        scenario="AS-F06",
    )

    assertions = {
        "exactRuntimeAttribution": (
            scope.get("platform") == platform
            and scope.get("locale") == locale
            and scope.get("sampleId") == sample_id
            and bool(
                _nonempty_string(
                    scope,
                    "scenarioKey",
                    scenario="AS-F06",
                )
            )
            and _nonnegative_int(
                tool_isolation,
                "readyCapabilityCount",
                scenario="AS-F06",
            ) == 0
        ),
        "exactRecoveryTransitionOrdering": (
            all(position >= 0 for position in phase_positions)
            and phase_positions == sorted(phase_positions)
        ),
        "replayAfterAcknowledgedCursor": (
            bool(replay_sequences)
            and replay_sequences == sorted(set(replay_sequences))
            and replay_sequences == replay_delivery_sequences
            and all(sequence > after_cursor for sequence in replay_sequences)
            and replay_payload_hashes_valid
            and replay_source_matches
            and source_identity_valid
            and all(
                delivery.get("streamId") == handoff.get("streamId")
                and delivery.get("streamGeneration")
                == handoff.get("streamGeneration")
                and bool(
                    _nonempty_string(
                        delivery,
                        "eventType",
                        scenario="AS-F06",
                    )
                )
                for delivery in replay_deliveries
            )
        ),
        "duplicateAndOutOfOrderIdempotent": (
            duplicate_sequence == cursor_before_mutation
            and out_of_order_sequence < cursor_before_mutation
            and stale_generation < active_generation
            and cursor_after_mutation == cursor_before_mutation
            and len(projection_before_mutation_hash) == 64
            and projection_before_mutation_hash
            == projection_after_mutation_hash
            and len(duplicate_payload_hash) == 64
            and len(out_of_order_payload_hash) == 64
        ),
        "pageClientAndStationRestartRecovered": (
            restart.get("pageSwitched") is True
            and restart.get("clientReloaded") is True
            and restart.get("stationRestarted") is True
            and restart_attestation.get("outageObserved") is True
            and _nonempty_string(
                restart_attestation,
                "beforeStartedAt",
                scenario="AS-F06",
            )
            != _nonempty_string(
                restart_attestation,
                "afterStartedAt",
                scenario="AS-F06",
            )
            and _nonempty_string(
                restart_attestation,
                "beforeCommit",
                scenario="AS-F06",
            )
            == _nonempty_string(
                restart_attestation,
                "afterCommit",
                scenario="AS-F06",
            )
        ),
        "transportLossNonTerminal": (
            transport.get("observed") is True
            and transport.get("nonTerminal") is True
        ),
        "terminalProjectionEqualsStation": (
            _nonempty_string(terminal, "stationHash", scenario="AS-F06")
            == _nonempty_string(terminal, "clientHash", scenario="AS-F06")
            and terminal.get("stationStatus") == terminal.get("clientStatus")
            and terminal.get("prefixPreserved") is True
        ),
        "failedOrCancelledNotCompleted": (
            recovery_failure.get("notCompleted") is True
        ),
        "recoveryFailureRetryAndReload": (
            len(error_hash) == 64
            and blocker == ""
            and recovery_failure.get("activeFailureObserved") is True
            and recovery_failure.get("expectedActorPtidHash")
            == recovery_failure.get("observedActorPtidHash")
            and recovery_failure.get("sessionActorMatches") is True
            and recovery_failure.get("expectedTurnId")
            == recovery_failure.get("observedTurnId")
            and recovery_failure.get("expectedStreamId")
            == recovery_failure.get("observedStreamId")
            and recovery_failure.get("expectedStreamGeneration")
            == recovery_failure.get("observedStreamGeneration")
            and recovery_retry.get("invoked") is True
            and recovery_retry.get("observed") is True
            and _nonnegative_int(
                recovery_retry,
                "recoveryEpochAfter",
                scenario="AS-F06",
            )
            > _nonnegative_int(
                recovery_retry,
                "recoveryEpochBefore",
                scenario="AS-F06",
            )
            and durable_reload.get("invoked") is True
            and durable_reload.get("observed") is True
            and durable_reload.get("source")
            == "station-snapshot-reconcile"
            and durable_reload.get("actorPtidHash")
            == recovery_failure.get("expectedActorPtidHash")
            and durable_reload.get("conversationId")
            == handoff.get("conversationId")
            and durable_reload.get("turnId") == handoff.get("turnId")
            and durable_reload.get("streamId") == handoff.get("streamId")
            and durable_reload.get("streamGeneration")
            == handoff.get("streamGeneration")
            and _nonnegative_int(
                durable_reload,
                "sequence",
                scenario="AS-F06",
            )
            >= after_cursor
            and durable_reload_delivery.get("transport") == "station-sse"
            and durable_reload_delivery.get("actorPtidHash")
            == recovery_failure.get("expectedActorPtidHash")
            and durable_reload_delivery.get("conversationId")
            == handoff.get("conversationId")
            and durable_reload_delivery.get("turnId")
            == handoff.get("turnId")
            and durable_reload_delivery.get("sequence")
            == durable_reload.get("sequence")
            and durable_reload_delivery.get("eventType") == "snapshot"
            and len(
                _nonempty_string(
                    durable_reload_delivery,
                    "rawPayloadHash",
                    scenario="AS-F06",
                )
            )
            == 64
            and (
                durable_reload.get("terminal") is False
                or (
                    durable_reload.get("terminal") is True
                    and durable_reload.get("terminalStatus")
                    in {"completed", "failed", "cancelled", "interrupted"}
                )
            )
        ),
        "staleGenerationAndRevisionRejected": (
            stale_generation < active_generation
            and idempotence.get("staleGenerationRejected") is True
            and idempotence.get("staleTerminalRejected") is True
            and stale_revision.get("rejected") is True
        ),
        "zeroDuplicateSideEffects": (
            len(
                _nonempty_string(
                    before_durable,
                    "sourceHash",
                    scenario="AS-F06",
                )
            )
            == 64
            and len(
                _nonempty_string(
                    after_durable,
                    "sourceHash",
                    scenario="AS-F06",
                )
            )
            == 64
            and duplicate_mutation_before == 0
            and duplicate_mutation_after == 0
            and duplicate_mutation_delta == 0
            and duplicate_mutation_delta
            == duplicate_mutation_after - duplicate_mutation_before
            and duplicate_side_effect_before == 0
            and duplicate_side_effect_after == 0
            and duplicate_side_effect_delta == 0
            and duplicate_side_effect_delta
            == duplicate_side_effect_after - duplicate_side_effect_before
        ),
        "cleanupComplete": (
            cleanup.get("handoffCleared") is True
            and cleanup.get("conversationDeleted") is True
            and cleanup.get("recoveryRecordCleared") is True
            and len(
                _nonempty_string(
                    cleanup,
                    "deletionErrorCodeHash",
                    scenario="AS-F06",
                )
            )
            == 64
        ),
    }
    failed = sorted(key for key, passed in assertions.items() if not passed)
    if failed:
        diagnostics = {
            "phases": phases,
            "afterCursor": after_cursor,
            "replaySequences": replay_sequences,
            "replayDeliverySequences": replay_delivery_sequences,
            "staleGeneration": stale_generation,
            "activeGeneration": active_generation,
            "staleGenerationRejected": idempotence.get(
                "staleGenerationRejected"
            ),
            "staleTerminalRejected": idempotence.get(
                "staleTerminalRejected"
            ),
            "staleRevisionRejected": stale_revision.get("rejected"),
        }
        raise GroupOneScenarioError(
            "AS-F06 production facts failed assertions: "
            f"{failed}; diagnostics={json.dumps(diagnostics, sort_keys=True)}"
        )
    return assertions


def evaluate_as_f10(
    capture: Mapping[str, Any],
    *,
    platform: str,
) -> dict[str, bool | None]:
    core = _mapping(capture, "coreOutcome", scenario="AS-F10")
    session = _mapping(capture, "capabilitySession", scenario="AS-F10")
    selected_device = _mapping(capture, "selectedDevice", scenario="AS-F10")
    rejections = _mapping(capture, "rejections", scenario="AS-F10")
    execution = _mapping(capture, "execution", scenario="AS-F10")

    unsupported = _mapping(rejections, "unsupported", scenario="AS-F10")
    unauthorized = _mapping(rejections, "unauthorized", scenario="AS-F10")
    signature_tamper = _mapping(
        rejections,
        "signatureTamper",
        scenario="AS-F10",
    )
    schema_mismatch = _mapping(
        rejections,
        "schemaMismatch",
        scenario="AS-F10",
    )
    cross_device = _mapping(rejections, "crossDevice", scenario="AS-F10")

    expected_session_platform = {
        "desktop_app": "desktop_app",
        "browser": "browser",
    }.get(platform)
    if expected_session_platform is None:
        raise GroupOneScenarioError(
            f"AS-F10 unsupported platform {platform!r}"
        )

    capability_count = _nonnegative_int(
        session,
        "capabilityCount",
        scenario="AS-F10",
    )
    session_matches_readiness = (
        _nonempty_string(session, "sessionId", scenario="AS-F10")
        == _nonempty_string(session, "readinessSessionId", scenario="AS-F10")
    )
    session_platform_matches = session.get("platform") == expected_session_platform
    if platform == "browser":
        selected_device_owns_execution = (
            capability_count == 0
            and selected_device.get("executionDeviceId") is None
        )
    else:
        selected_device_owns_execution = (
            capability_count > 0
            and _nonempty_string(
                selected_device,
                "sessionDeviceId",
                scenario="AS-F10",
            )
            == _nonempty_string(
                selected_device,
                "executionDeviceId",
                scenario="AS-F10",
            )
        )

    rejection_codes = {
        "unsupported": {"AGENT_4002", "CAPABILITY_UNAVAILABLE"},
        "unauthorized": {"AGENT_4002", "UNAUTHORIZED"},
        "signatureTamper": {
            "CLIENT_CAPABILITY_COMMAND_ERROR_CODE_SIGNATURE_INVALID",
        },
        "schemaMismatch": {"AGENT_4002", "CLIENT_CAPABILITY_SCHEMA_MISMATCH"},
        "crossDevice": {
            "AGENT_4002",
            "CLIENT_CAPABILITY_COMMAND_ERROR_CODE_SIGNATURE_INVALID",
            "CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_AUTHORITY_MISMATCH",
        },
    }

    def _is_deferred(fact: Mapping[str, Any]) -> bool:
        """A fact is deferred when no production endpoint exists yet."""
        return (
            fact.get("availability") == "unavailable"
            and fact.get("unavailable_reason")
            == "NO_PRODUCTION_CAPABILITY_ENDPOINT"
        )

    def rejected(
        fact: Mapping[str, Any],
        kind: str,
    ) -> bool:
        return (
            fact.get("accepted") is False
            and fact.get("errorCode") in rejection_codes[kind]
        )

    # Deferred assertions return None when no production path exists (W6 dep).
    unsupported_result: bool | None = (
        None if _is_deferred(unsupported) else rejected(unsupported, "unsupported")
    )
    schema_mismatch_result: bool | None = (
        None
        if _is_deferred(schema_mismatch)
        else rejected(schema_mismatch, "schemaMismatch")
    )

    zero_execution = all(
        _nonnegative_int(execution, key, scenario="AS-F10") == 0
        for key in (
            "localAttemptDelta",
            "sideEffectDelta",
            "resultDelta",
            "continuationDelta",
        )
    )
    assertions: dict[str, bool | None] = {
        "coreOutcomesMatch": (
            core.get("stationStatus") == "completed"
            and core.get("receiverStatus") == "completed"
        ),
        "unsupportedRejected": unsupported_result,
        "unauthorizedRejected": rejected(unauthorized, "unauthorized"),
        "signatureTamperRejected": rejected(
            signature_tamper,
            "signatureTamper",
        ),
        "schemaMismatchRejected": schema_mismatch_result,
        "selectedDeviceOwnsExecution": (
            session_matches_readiness
            and session_platform_matches
            and selected_device_owns_execution
        ),
        "noDesktopFallback": (
            _nonnegative_int(
                execution,
                "desktopFallbackDelta",
                scenario="AS-F10",
            )
            == 0
        ),
        "crossDeviceRejected": rejected(cross_device, "crossDevice"),
        "zeroExecutionOnReject": zero_execution,
    }
    # Only non-deferred (non-None) assertions participate in pass/fail.
    failed = sorted(
        key
        for key, passed in assertions.items()
        if passed is not None and not passed
    )
    if failed:
        raise GroupOneScenarioError(
            f"AS-F10 production facts failed assertions: {failed}"
        )
    return assertions


def _mapping(
    value: Mapping[str, Any],
    key: str,
    *,
    scenario: str = "AS-F02",
) -> dict[str, Any]:
    item = value.get(key)
    if not isinstance(item, Mapping):
        raise GroupOneScenarioError(f"{scenario} {key} fact is missing")
    return dict(item)


def _list(
    value: Mapping[str, Any],
    key: str,
    *,
    scenario: str = "AS-F02",
) -> list[dict[str, Any]]:
    item = value.get(key)
    if not isinstance(item, list) or any(
        not isinstance(entry, Mapping) for entry in item
    ):
        raise GroupOneScenarioError(f"{scenario} {key} fact is invalid")
    return [dict(entry) for entry in item]


def _string_list(
    value: Mapping[str, Any],
    key: str,
    *,
    scenario: str,
) -> list[str]:
    item = value.get(key)
    if (
        not isinstance(item, list)
        or any(not isinstance(entry, str) or not entry for entry in item)
    ):
        raise GroupOneScenarioError(f"{scenario} {key} fact is invalid")
    return list(item)


def _normalized_attachment_metadata(
    value: Mapping[str, Any],
    key: str,
) -> list[dict[str, Any]]:
    items = _list(value, key, scenario="AS-F05")
    normalized = []
    for item in items:
        normalized.append(
            {
                "attachmentId": _nonempty_string(
                    item,
                    "attachmentId",
                    scenario="AS-F05",
                ),
                "objectRef": _opaque_object_ref(item, "objectRef"),
                "mimeType": _nonempty_string(
                    item,
                    "mimeType",
                    scenario="AS-F05",
                ),
                "sizeBytes": _positive_int(
                    item,
                    "sizeBytes",
                    scenario="AS-F05",
                ),
                "checksum": _nonempty_string(
                    item,
                    "checksum",
                    scenario="AS-F05",
                ),
                "filename": _nonempty_string(
                    item,
                    "filename",
                    scenario="AS-F05",
                ),
                "authorizationScope": _nonempty_string(
                    item,
                    "authorizationScope",
                    scenario="AS-F05",
                ),
                "expiresAt": _nonempty_string(
                    item,
                    "expiresAt",
                    scenario="AS-F05",
                ),
            }
        )
    return sorted(normalized, key=lambda item: item["attachmentId"])


def _opaque_object_ref(value: Mapping[str, Any], key: str) -> str:
    item = _nonempty_string(value, key, scenario="AS-F05")
    lowered = item.lower()
    if (
        lowered.startswith(("/", "\\", "file:", "http:", "https:"))
        or "/users/" in lowered
        or "\\users\\" in lowered
        or "/tmp/" in lowered
    ):
        raise GroupOneScenarioError(
            f"AS-F05 {key} must be an opaque authorized reference"
        )
    return item


def _contains_raw_path(value: Any) -> bool:
    if isinstance(value, Mapping):
        return any(_contains_raw_path(item) for item in value.values())
    if isinstance(value, list):
        return any(_contains_raw_path(item) for item in value)
    if not isinstance(value, str):
        return False
    lowered = value.lower()
    return (
        lowered.startswith(("file:", "http:", "https:", "/users/", "/tmp/"))
        or "\\users\\" in lowered
        or (
            len(value) >= 3
            and value[0].isalpha()
            and value[1:3] in {":\\", ":/"}
        )
    )


def _positive_int(
    value: Mapping[str, Any],
    key: str,
    *,
    scenario: str = "AS-F02",
) -> int:
    item = value.get(key)
    if not isinstance(item, int) or isinstance(item, bool) or item <= 0:
        raise GroupOneScenarioError(
            f"{scenario} {key} must be a positive integer"
        )
    return item


def _nonnegative_int(
    value: Mapping[str, Any],
    key: str,
    *,
    scenario: str,
) -> int:
    item = value.get(key)
    if not isinstance(item, int) or isinstance(item, bool) or item < 0:
        raise GroupOneScenarioError(
            f"{scenario} {key} must be a non-negative integer"
        )
    return item


def _nonempty_string(
    value: Mapping[str, Any],
    key: str,
    *,
    scenario: str = "AS-F02",
) -> str:
    item = value.get(key)
    if not isinstance(item, str) or not item:
        raise GroupOneScenarioError(
            f"{scenario} {key} must be a non-empty string"
        )
    return item
