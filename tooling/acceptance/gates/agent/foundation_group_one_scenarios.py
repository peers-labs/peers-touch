#!/usr/bin/env python3
"""Fail-closed scenario oracles for Foundation Group 1 runtime captures."""

from __future__ import annotations

import hashlib
import json
import re
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


def _replay_payload_sequence(
    payload: Mapping[str, Any],
    *,
    scenario: str,
) -> int:
    data = _mapping(payload, "data", scenario=scenario)
    value = data.get("seq")
    if value is None:
        value = data.get("sequence")
    if isinstance(value, bool):
        raise GroupOneScenarioError(
            f"{scenario} replay payload sequence must be a positive integer"
        )
    if isinstance(value, int):
        sequence = value
    elif isinstance(value, str) and value.isdigit():
        sequence = int(value)
    else:
        raise GroupOneScenarioError(
            f"{scenario} replay payload sequence must be a positive integer"
        )
    if sequence <= 0:
        raise GroupOneScenarioError(
            f"{scenario} replay payload sequence must be a positive integer"
        )
    return sequence


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
        and _replay_payload_sequence(payload, scenario="AS-F06")
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
    replay_request_cursor = _positive_int(
        handoff,
        "replayRequestCursor",
        scenario="AS-F06",
    )
    acknowledged_cursor = _positive_int(
        handoff,
        "acknowledgedCursor",
        scenario="AS-F06",
    )
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
            and after_cursor == replay_request_cursor
            and acknowledged_cursor >= replay_request_cursor
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
            "stationReplaySequences": [
                delivery.get("sequence")
                for delivery in station_replay_deliveries
            ],
            "replayPayloadHashesValid": replay_payload_hashes_valid,
            "replaySourceMatches": replay_source_matches,
            "sourceIdentityValid": source_identity_valid,
            "terminalProjection": {
                "stationStatus": terminal.get("stationStatus"),
                "clientStatus": terminal.get("clientStatus"),
                "stationHash": terminal.get("stationHash"),
                "clientHash": terminal.get("clientHash"),
                "prefixPreserved": terminal.get("prefixPreserved"),
            },
            "deliveryStreamMatches": all(
                delivery.get("streamId") == handoff.get("streamId")
                and delivery.get("streamGeneration")
                == handoff.get("streamGeneration")
                for delivery in replay_deliveries
            ),
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


def evaluate_as_f07(capture: Mapping[str, Any]) -> dict[str, bool]:
    retry = _mapping(capture, "retry", scenario="AS-F07")
    attempts_before = _list(
        retry,
        "attemptsBefore",
        scenario="AS-F07",
    )
    attempts_after = _list(
        retry,
        "attemptsAfter",
        scenario="AS-F07",
    )
    regenerate = _mapping(capture, "regenerate", scenario="AS-F07")
    first_regenerate = _mapping(
        regenerate,
        "first",
        scenario="AS-F07",
    )
    second_regenerate = _mapping(
        regenerate,
        "second",
        scenario="AS-F07",
    )
    edit = _mapping(capture, "edit", scenario="AS-F07")
    edited_user = _mapping(edit, "user", scenario="AS-F07")
    edited_assistant = _mapping(edit, "assistant", scenario="AS-F07")
    branch = _mapping(capture, "branchSelection", scenario="AS-F07")
    stale = _mapping(capture, "staleBranch", scenario="AS-F07")
    original = _mapping(capture, "original", scenario="AS-F07")
    tool_isolation = _mapping(
        capture,
        "toolIsolation",
        scenario="AS-F07",
    )

    source_turn_id = _nonempty_string(
        retry,
        "sourceTurnId",
        scenario="AS-F07",
    )
    source_user_id = _nonempty_string(
        regenerate,
        "sourceUserMessageId",
        scenario="AS-F07",
    )
    source_assistant_id = _nonempty_string(
        regenerate,
        "sourceAssistantMessageId",
        scenario="AS-F07",
    )
    first_message_id = _nonempty_string(
        first_regenerate,
        "messageId",
        scenario="AS-F07",
    )
    second_message_id = _nonempty_string(
        second_regenerate,
        "messageId",
        scenario="AS-F07",
    )
    edited_user_id = _nonempty_string(
        edited_user,
        "messageId",
        scenario="AS-F07",
    )
    selected_message_id = _nonempty_string(
        branch,
        "selectedMessageId",
        scenario="AS-F07",
    )
    selected_message_ids = _string_list(
        branch,
        "selectedMessageIds",
        scenario="AS-F07",
    )
    rendered_message_ids = _string_list(
        branch,
        "renderedMessageIds",
        scenario="AS-F07",
    )

    assertions = {
        "retryCreatedAttempt": (
            _nonempty_string(
                retry,
                "sourceConversationId",
                scenario="AS-F07",
            )
            and retry.get("sourceStatus") == "cancelled"
            and source_turn_id
            == _nonempty_string(
                retry,
                "resultTurnId",
                scenario="AS-F07",
            )
            and _nonempty_string(
                retry,
                "attemptId",
                scenario="AS-F07",
            )
            and len(attempts_after) == len(attempts_before) + 1
            and all(
                attempt.get("turnId") == source_turn_id
                for attempt in attempts_after
            )
            and retry.get("attemptId")
            in {attempt.get("attemptId") for attempt in attempts_after}
        ),
        "regenerateCreatedSiblings": (
            first_message_id != second_message_id
            and first_message_id != source_assistant_id
            and second_message_id != source_assistant_id
            and first_regenerate.get("parentMessageId") == source_user_id
            and second_regenerate.get("parentMessageId") == source_user_id
            and first_regenerate.get("replacesMessageId")
            == source_assistant_id
            and second_regenerate.get("replacesMessageId")
            == source_assistant_id
            and _nonempty_string(
                first_regenerate,
                "branchId",
                scenario="AS-F07",
            )
            != _nonempty_string(
                second_regenerate,
                "branchId",
                scenario="AS-F07",
            )
        ),
        "editCreatedSibling": (
            edited_user_id != source_user_id
            and edited_user.get("replacesMessageId") == source_user_id
            and edited_user.get("parentMessageId")
            == edit.get("sourceParentMessageId")
            and _nonempty_string(
                edited_user,
                "contentHash",
                scenario="AS-F07",
            )
            == _nonempty_string(
                edit,
                "revisedContentHash",
                scenario="AS-F07",
            )
            and _nonempty_string(
                edit,
                "assistantMessageId",
                scenario="AS-F07",
            )
            == _nonempty_string(
                edit,
                "activeBranchMessageId",
                scenario="AS-F07",
            )
            and edited_assistant.get("messageId")
            == edit.get("assistantMessageId")
            and edited_assistant.get("parentMessageId") == edited_user_id
            and edited_assistant.get("branchId")
            == edited_user.get("branchId")
        ),
        "branchSwitchPersisted": (
            branch.get("originalResponseActiveBranchMessageId")
            == branch.get("originalMessageId")
            and branch.get("responseActiveBranchMessageId")
            == selected_message_id
            and branch.get("readbackActiveBranchMessageId")
            == selected_message_id
            and selected_message_id in selected_message_ids
            and selected_message_id in rendered_message_ids
            and branch.get("receiverVisible") is True
        ),
        "staleBranchConflict": (
            stale.get("errorCode") == "VERSION_CONFLICT"
            and _nonempty_string(
                stale,
                "beforeHash",
                scenario="AS-F07",
            )
            == _nonempty_string(
                stale,
                "afterHash",
                scenario="AS-F07",
            )
            and _positive_int(
                stale,
                "versionBefore",
                scenario="AS-F07",
            )
            == _positive_int(
                stale,
                "versionAfter",
                scenario="AS-F07",
            )
        ),
        "originalImmutable": all(
            len(
                _nonempty_string(
                    original,
                    before_key,
                    scenario="AS-F07",
                )
            )
            == 64
            and original.get(before_key) == original.get(after_key)
            for before_key, after_key in (
                ("beforeHash", "afterHash"),
                ("usageBeforeHash", "usageAfterHash"),
                ("feedbackBeforeHash", "feedbackAfterHash"),
            )
        ),
        "capabilityIsolationRestored": (
            _positive_int(
                tool_isolation,
                "disabledBindingCount",
                scenario="AS-F07",
            )
            == _nonnegative_int(
                tool_isolation,
                "restoredBindingCount",
                scenario="AS-F07",
            )
            and _nonnegative_int(
                tool_isolation,
                "readyCapabilityCount",
                scenario="AS-F07",
            )
            == 0
            and _positive_int(
                tool_isolation,
                "originalReadyCapabilityCount",
                scenario="AS-F07",
            )
            == _nonnegative_int(
                tool_isolation,
                "restoredReadyCapabilityCount",
                scenario="AS-F07",
            )
            and re.fullmatch(
                r"[0-9a-f]{64}",
                _nonempty_string(
                    tool_isolation,
                    "originalReadyCapabilityHash",
                    scenario="AS-F07",
                ),
            )
            is not None
            and tool_isolation.get("originalReadyCapabilityHash")
            == tool_isolation.get("restoredReadyCapabilityHash")
            and tool_isolation.get("restorationVerified") is True
        ),
    }
    assertions["originalImmutable"] = bool(
        assertions["originalImmutable"]
        and _positive_int(
            original,
            "attemptCountBefore",
            scenario="AS-F07",
        )
        == _positive_int(
            original,
            "attemptCountAfter",
            scenario="AS-F07",
        )
        and _positive_int(
            original,
            "feedbackCountBefore",
            scenario="AS-F07",
        )
        == _positive_int(
            original,
            "feedbackCountAfter",
            scenario="AS-F07",
        )
    )
    failed = sorted(key for key, passed in assertions.items() if not passed)
    if failed:
        diagnostics = {
            "attemptCountBefore": len(attempts_before),
            "attemptCountAfter": len(attempts_after),
            "regenerateMessageIds": [
                first_message_id,
                second_message_id,
            ],
            "editedUserMessageId": edited_user_id,
            "selectedMessageId": selected_message_id,
            "staleErrorCode": stale.get("errorCode"),
        }
        raise GroupOneScenarioError(
            "AS-F07 production facts failed assertions: "
            f"{failed}; diagnostics={json.dumps(diagnostics, sort_keys=True)}"
        )
    return assertions


def evaluate_as_f10(
    capture: Mapping[str, Any],
    *,
    platform: str,
) -> dict[str, bool | None]:
    core = _mapping(capture, "coreOutcome", scenario="AS-F10")
    tool_isolation = _mapping(capture, "toolIsolation", scenario="AS-F10")
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
            "CLIENT_CAPABILITY_COMMAND_ERROR_CODE_AUTHORITY_MISMATCH",
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
            and _nonnegative_int(
                tool_isolation,
                "readyCapabilityCount",
                scenario="AS-F10",
            )
            == 0
            and tool_isolation.get("restorationVerified") is True
            and _nonnegative_int(
                tool_isolation,
                "restoredReadyCapabilityCount",
                scenario="AS-F10",
            )
            == _nonnegative_int(
                tool_isolation,
                "originalReadyCapabilityCount",
                scenario="AS-F10",
            )
            and _nonempty_string(
                tool_isolation,
                "restoredReadyCapabilityHash",
                scenario="AS-F10",
            )
            == _nonempty_string(
                tool_isolation,
                "originalReadyCapabilityHash",
                scenario="AS-F10",
            )
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


def evaluate_as_f12(
    capture: Mapping[str, Any],
    *,
    platform: str,
    locale: str,
    sample_id: str,
) -> dict[str, bool]:
    scenario = "AS-F12"
    scope = _mapping(capture, "scope", scenario=scenario)
    tool_isolation = _mapping(
        capture,
        "toolIsolation",
        scenario=scenario,
    )
    topics = _mapping(capture, "topics", scenario=scenario)
    restart = _mapping(capture, "restart", scenario=scenario)
    station = _mapping(restart, "station", scenario=scenario)
    stale = _mapping(capture, "staleMutation", scenario=scenario)
    stale_before = _mapping(stale, "before", scenario=scenario)
    stale_after = _mapping(stale, "after", scenario=scenario)

    if set(topics) != {"alpha", "beta"}:
        raise GroupOneScenarioError(
            f"{scenario} topics must contain alpha and beta"
        )

    expected_scenario_key = "|".join(
        (platform, locale, scenario, sample_id)
    )
    topic_facts = {
        key: _evaluate_as_f12_topic(
            _mapping(topics, key, scenario=scenario),
            key=key,
            scenario=scenario,
        )
        for key in ("alpha", "beta")
    }
    alpha = topic_facts["alpha"]
    beta = topic_facts["beta"]
    conversation_ids = {
        alpha["conversation_id"],
        beta["conversation_id"],
    }
    distinct_topic_identity = (
        alpha["fact"] != beta["fact"]
        and len(conversation_ids) == 2
        and alpha["message_ids"].isdisjoint(beta["message_ids"])
        and alpha["branch_ids"].isdisjoint(beta["branch_ids"])
        and alpha["turn_ids"].isdisjoint(beta["turn_ids"])
        and _as_f12_runtime_ownership_isolated(alpha, beta)
    )
    source_restart_proven = (
        _sha256_string(
            station,
            "stationUrlHash",
            scenario=scenario,
        )
        and _sha256_string(
            station,
            "protoDigest",
            scenario=scenario,
        )
        and _nonempty_string(
            station,
            "containerId",
            scenario=scenario,
        )
        and _nonempty_string(
            station,
            "imageId",
            scenario=scenario,
        )
        and _nonempty_string(
            station,
            "imageRef",
            scenario=scenario,
        )
        and _nonempty_string(
            station,
            "beforeStartedAt",
            scenario=scenario,
        )
        != _nonempty_string(
            station,
            "afterStartedAt",
            scenario=scenario,
        )
        and _hex_identity_matches(
            _nonempty_string(
                station,
                "sourceCommit",
                scenario=scenario,
            ),
            _nonempty_string(
                station,
                "beforeCommit",
                scenario=scenario,
            ),
        )
        and _hex_identity_matches(
            _nonempty_string(
                station,
                "sourceCommit",
                scenario=scenario,
            ),
            _nonempty_string(
                station,
                "afterCommit",
                scenario=scenario,
            ),
        )
        and _mapping(
            station,
            "clientReloads",
            scenario=scenario,
        ).get(platform)
        is True
        and station.get("owningPlatform") == platform
        and station.get("existingSessionRestored") is True
    )
    stale_target = _nonempty_string(
        stale,
        "targetConversationId",
        scenario=scenario,
    )
    stale_expected_version = _positive_int(
        stale,
        "expectedVersion",
        scenario=scenario,
    )
    stale_before_alpha_version = _positive_int(
        stale_before,
        "alphaVersion",
        scenario=scenario,
    )
    stale_preserved = (
        stale.get("errorCode") == "VERSION_CONFLICT"
        and stale_target == alpha["conversation_id"]
        and _nonempty_string(
            stale,
            "attemptedBranchMessageId",
            scenario=scenario,
        )
        == alpha["source_assistant_message_id"]
        and stale_expected_version < stale_before_alpha_version
        and _sha256_string(
            stale_before,
            "alphaHash",
            scenario=scenario,
        )
        == _sha256_string(
            stale_after,
            "alphaHash",
            scenario=scenario,
        )
        == alpha["post_restart_hash"]
        and _sha256_string(
            stale_before,
            "betaHash",
            scenario=scenario,
        )
        == _sha256_string(
            stale_after,
            "betaHash",
            scenario=scenario,
        )
        == beta["post_restart_hash"]
        and stale_before_alpha_version
        == _positive_int(
            stale_after,
            "alphaVersion",
            scenario=scenario,
        )
        and _positive_int(
            stale_before,
            "betaVersion",
            scenario=scenario,
        )
        == _positive_int(
            stale_after,
            "betaVersion",
            scenario=scenario,
        )
    )
    scope_matches = (
        scope.get("scenarioKey") == expected_scenario_key
        and scope.get("platform") == platform
        and scope.get("locale") == locale
        and scope.get("sampleId") == sample_id
    )
    assertions = {
        "twoTopicsDistinct": (
            distinct_topic_identity
            and _positive_int(
                tool_isolation,
                "disabledBindingCount",
                scenario=scenario,
            )
            > 0
            and _nonnegative_int(
                tool_isolation,
                "readyCapabilityCount",
                scenario=scenario,
            )
            == 0
        ),
        "restartRestored": (
            scope_matches
            and source_restart_proven
            and alpha["restart_restored"]
            and beta["restart_restored"]
        ),
        "branchesIndependent": (
            distinct_topic_identity
            and alpha["branch_owned"]
            and beta["branch_owned"]
            and alpha["selected_branch_message_id"]
            != beta["selected_branch_message_id"]
        ),
        "noCrossTopicReferences": (
            distinct_topic_identity
            and alpha["references_owned"]
            and beta["references_owned"]
        ),
        "staleMutationConflict": stale_preserved,
    }
    failed = sorted(key for key, passed in assertions.items() if not passed)
    if failed:
        diagnostics = {
            "scopeMatches": scope_matches,
            "sourceRestartProven": bool(source_restart_proven),
            "alphaRestart": alpha["restart_checks"],
            "betaRestart": beta["restart_checks"],
        }
        raise GroupOneScenarioError(
            f"{scenario} production facts failed assertions: {failed}; "
            f"diagnostics={json.dumps(diagnostics, sort_keys=True)}"
        )
    return assertions


def _evaluate_as_f12_topic(
    topic: Mapping[str, Any],
    *,
    key: str,
    scenario: str,
) -> dict[str, Any]:
    if topic.get("key") != key:
        raise GroupOneScenarioError(
            f"{scenario} {key} topic key is invalid"
        )
    conversation_id = _nonempty_string(
        topic,
        "conversationId",
        scenario=scenario,
    )
    fact = _nonempty_string(topic, "fact", scenario=scenario)
    turn_ids = _string_set(topic, "turnIds", scenario=scenario)
    runtime_turn_id = _nonempty_string(
        topic,
        "runtimeTurnId",
        scenario=scenario,
    )
    source_assistant_message_id = _nonempty_string(
        topic,
        "sourceAssistantMessageId",
        scenario=scenario,
    )
    sibling_message_id = _nonempty_string(
        topic,
        "siblingMessageId",
        scenario=scenario,
    )
    selected_branch_message_id = _nonempty_string(
        topic,
        "selectedBranchMessageId",
        scenario=scenario,
    )
    pre_restart = _mapping(topic, "preRestart", scenario=scenario)
    post_restart = _mapping(topic, "postRestart", scenario=scenario)
    alternate_post_restart = _mapping(
        topic,
        "alternatePostRestart",
        scenario=scenario,
    )
    restored_post_restart = _mapping(
        topic,
        "restoredSelectedPostRestart",
        scenario=scenario,
    )
    pre_restart_hash = _sha256_string(
        topic,
        "preRestartHash",
        scenario=scenario,
    )
    post_restart_hash = _sha256_string(
        topic,
        "postRestartHash",
        scenario=scenario,
    )
    receiver_before = _mapping(topic, "receiverBefore", scenario=scenario)
    receiver_after = _mapping(topic, "receiverAfter", scenario=scenario)

    post_conversation = _mapping(
        post_restart,
        "conversation",
        scenario=scenario,
    )
    runtime_binding = _mapping(
        post_conversation,
        "runtimeBinding",
        scenario=scenario,
    )
    runtime_turn = _mapping(
        post_restart,
        "runtimeTurn",
        scenario=scenario,
    )
    messages_by_id: dict[str, Mapping[str, Any]] = {}
    for snapshot in (
        post_restart,
        alternate_post_restart,
        restored_post_restart,
    ):
        for message in _list(snapshot, "messages", scenario=scenario):
            message_id = _nonempty_string(
                message,
                "messageId",
                scenario=scenario,
            )
            existing = messages_by_id.get(message_id)
            if existing is not None and existing != message:
                raise GroupOneScenarioError(
                    f"{scenario} {key} message {message_id} changed "
                    "while traversing branches"
                )
            messages_by_id[message_id] = message
    messages = list(messages_by_id.values())
    message_ids = set(messages_by_id)
    if not message_ids:
        raise GroupOneScenarioError(
            f"{scenario} {key} message IDs are missing"
        )
    branch_ids = {
        str(message.get("branchId") or "")
        for message in messages
        if message.get("branchId")
    }
    if not branch_ids:
        raise GroupOneScenarioError(
            f"{scenario} {key} branch IDs are missing"
        )
    message_references_owned = all(
        message.get("conversationId") == conversation_id
        and (
            not message.get("turnId")
            or message.get("turnId") in turn_ids
        )
        and (
            not message.get("parentMessageId")
            or message.get("parentMessageId") in message_ids
        )
        and (
            not message.get("replacesMessageId")
            or message.get("replacesMessageId") in message_ids
        )
        for message in messages
    )
    receiver_before_owned = _evaluate_as_f12_receiver(
        receiver_before,
        conversation_id=conversation_id,
        selected_branch_message_id=selected_branch_message_id,
        message_ids=message_ids,
        scenario=scenario,
    )
    receiver_after_owned = _evaluate_as_f12_receiver(
        receiver_after,
        conversation_id=conversation_id,
        selected_branch_message_id=selected_branch_message_id,
        message_ids=message_ids,
        scenario=scenario,
    )
    alternate_branch_message_id = (
        source_assistant_message_id
        if selected_branch_message_id == sibling_message_id
        else sibling_message_id
    )
    alternate_conversation = _mapping(
        alternate_post_restart,
        "conversation",
        scenario=scenario,
    )
    restored_conversation = _mapping(
        restored_post_restart,
        "conversation",
        scenario=scenario,
    )
    runtime_identity_matches = all(
        _nonempty_string(runtime_binding, field, scenario=scenario)
        == _nonempty_string(runtime_turn, field, scenario=scenario)
        for field in (
            "runtimeKind",
            "providerId",
            "modelId",
            "runtimeProfileId",
        )
    ) and (
        _optional_string(
            runtime_binding,
            "externalSessionId",
            scenario=scenario,
        )
        == _optional_string(
            runtime_turn,
            "externalSessionId",
            scenario=scenario,
        )
    ) and (
        _nonnegative_int(
            runtime_binding,
            "externalSessionEpoch",
            scenario=scenario,
        )
        == _nonnegative_int(
            runtime_turn,
            "externalSessionEpoch",
            scenario=scenario,
        )
    )
    pre_conversation = _mapping(
        pre_restart,
        "conversation",
        scenario=scenario,
    )
    pre_messages = _list(pre_restart, "messages", scenario=scenario)
    post_messages = _list(post_restart, "messages", scenario=scenario)
    pre_runtime_turn = _mapping(
        pre_restart,
        "runtimeTurn",
        scenario=scenario,
    )
    restart_checks = {
        "preHashMatches": (
            _canonical_payload_hash(pre_restart) == pre_restart_hash
        ),
        "postHashMatches": (
            _canonical_payload_hash(post_restart) == post_restart_hash
        ),
        "hashesEqual": pre_restart_hash == post_restart_hash,
        "payloadsEqual": pre_restart == post_restart,
        "conversationVersionEqual": (
            pre_conversation.get("version") == post_conversation.get("version")
        ),
        "activeBranchEqual": (
            pre_conversation.get("activeBranchMessageId")
            == post_conversation.get("activeBranchMessageId")
        ),
        "runtimeBindingEqual": (
            pre_conversation.get("runtimeBinding")
            == post_conversation.get("runtimeBinding")
        ),
        "messagesEqual": pre_messages == post_messages,
        "runtimeTurnEqual": pre_runtime_turn == runtime_turn,
        "selectedBranchEqual": (
            pre_restart.get("selectedBranchMessageId")
            == post_restart.get("selectedBranchMessageId")
        ),
        "conversationMatches": (
            post_conversation.get("conversationId") == conversation_id
        ),
        "topicMatches": (
            post_restart.get("topicLabel") == key
            and post_restart.get("fact") == fact
        ),
        "turnMatches": (
            runtime_turn.get("turnId") == runtime_turn_id
            and runtime_turn_id in turn_ids
        ),
        "runtimeMatches": runtime_identity_matches,
    }
    return {
        "conversation_id": conversation_id,
        "fact": fact,
        "turn_ids": turn_ids,
        "message_ids": message_ids,
        "branch_ids": branch_ids,
        "runtime_kind": _nonempty_string(
            runtime_binding,
            "runtimeKind",
            scenario=scenario,
        ),
        "runtime_home_ref": _optional_string(
            runtime_binding,
            "runtimeHomeRef",
            scenario=scenario,
        ),
        "external_session_id": _optional_string(
            runtime_binding,
            "externalSessionId",
            scenario=scenario,
        ),
        "source_assistant_message_id": source_assistant_message_id,
        "selected_branch_message_id": selected_branch_message_id,
        "post_restart_hash": post_restart_hash,
        "restart_checks": restart_checks,
        "restart_restored": all(restart_checks.values()),
        "branch_owned": (
            source_assistant_message_id != sibling_message_id
            and source_assistant_message_id in message_ids
            and sibling_message_id in message_ids
            and selected_branch_message_id
            in {source_assistant_message_id, sibling_message_id}
            and selected_branch_message_id in message_ids
            and post_conversation.get("activeBranchMessageId")
            == selected_branch_message_id
            and post_restart.get("selectedBranchMessageId")
            == selected_branch_message_id
            and alternate_conversation.get("conversationId")
            == conversation_id
            and alternate_conversation.get("activeBranchMessageId")
            == alternate_branch_message_id
            and alternate_post_restart.get("selectedBranchMessageId")
            == alternate_branch_message_id
            and restored_conversation.get("conversationId")
            == conversation_id
            and restored_conversation.get("activeBranchMessageId")
            == selected_branch_message_id
            and restored_post_restart.get("selectedBranchMessageId")
            == selected_branch_message_id
        ),
        "references_owned": (
            message_references_owned
            and receiver_before_owned
            and receiver_after_owned
        ),
    }


def _evaluate_as_f12_receiver(
    receiver: Mapping[str, Any],
    *,
    conversation_id: str,
    selected_branch_message_id: str,
    message_ids: set[str],
    scenario: str,
) -> bool:
    rendered = _list(receiver, "rendered", scenario=scenario)
    rendered_ids = {
        _nonempty_string(item, "messageId", scenario=scenario)
        for item in rendered
    }
    store_message_ids = _string_set(
        receiver,
        "storeMessageIds",
        scenario=scenario,
    )
    selected_visible = any(
        item.get("messageId") == selected_branch_message_id
        and item.get("visible") is True
        for item in rendered
    )
    return (
        receiver.get("conversationId") == conversation_id
        and receiver.get("selectedBranchMessageId")
        == selected_branch_message_id
        and receiver.get("selectedBranchVisible") is True
        and receiver.get("ownFactVisible") is True
        and receiver.get("foreignFactVisible") is False
        and selected_visible
        and rendered_ids <= message_ids
        and store_message_ids <= message_ids
    )


def _as_f12_runtime_ownership_isolated(
    alpha: Mapping[str, Any],
    beta: Mapping[str, Any],
) -> bool:
    runtime_kinds = {alpha["runtime_kind"], beta["runtime_kind"]}
    if runtime_kinds == {"direct_model"}:
        return all(
            not topic[field]
            for topic in (alpha, beta)
            for field in ("runtime_home_ref", "external_session_id")
        )
    if runtime_kinds == {"external_agent"}:
        return all(
            alpha[field]
            and beta[field]
            and alpha[field] != beta[field]
            for field in ("runtime_home_ref", "external_session_id")
        )
    return False


def evaluate_base_active_mutation_conflict(
    capture: Mapping[str, Any],
) -> dict[str, bool]:
    scenario = "BASE-ACTIVE_MUTATION_CONFLICT"
    rejection = _mapping(capture, "rejection", scenario=scenario)
    details = _mapping(rejection, "details", scenario=scenario)
    winner = _mapping(capture, "winner", scenario=scenario)
    stale_mutation = _mapping(capture, "staleMutation", scenario=scenario)
    receiver = _mapping(capture, "receiver", scenario=scenario)
    cleanup = _mapping(capture, "cleanup", scenario=scenario)

    resource_id = _nonempty_string(winner, "resourceId", scenario=scenario)
    expected_revision = _positive_int(
        winner,
        "expectedRevision",
        scenario=scenario,
    )
    actual_revision = _positive_int(
        winner,
        "actualRevision",
        scenario=scenario,
    )
    winner_hash = _nonempty_string(
        winner,
        "hashBeforeStale",
        scenario=scenario,
    )

    assertions = {
        "typedConflictRejected": (
            rejection.get("code") == "ADMISSION_ACTIVE_MUTATION_CONFLICT"
            and rejection.get("localeKey")
            == "agent.errors.activeMutationConflict"
            and rejection.get("retryable") is True
            and rejection.get("terminal") is True
            and details.get("resource_id") == resource_id
            and str(details.get("expected_revision")) == str(expected_revision)
            and str(details.get("actual_revision")) == str(actual_revision)
            and actual_revision == expected_revision + 1
        ),
        "localizedRecoveryVisible": (
            receiver.get("conflictVisible") is True
            and receiver.get("reloadVisible") is True
            and _nonempty_string(
                receiver,
                "expectedConflictText",
                scenario=scenario,
            )
            in _nonempty_string(
                receiver,
                "conflictText",
                scenario=scenario,
            )
            and _nonempty_string(
                receiver,
                "reloadText",
                scenario=scenario,
            )
            == _nonempty_string(
                receiver,
                "expectedReloadText",
                scenario=scenario,
            )
        ),
        "reloadLatestExecuted": (
            receiver.get("reloadExecuted") is True
            and _positive_int(
                receiver,
                "reloadedRevision",
                scenario=scenario,
            )
            == actual_revision
        ),
        "winnerPreserved": (
            _positive_int(
                winner,
                "revisionBeforeStale",
                scenario=scenario,
            )
            == actual_revision
            and _positive_int(
                winner,
                "revisionAfterStale",
                scenario=scenario,
            )
            == actual_revision
            and _positive_int(
                winner,
                "revisionAfterReload",
                scenario=scenario,
            )
            == actual_revision
            and _nonempty_string(
                winner,
                "hashAfterStale",
                scenario=scenario,
            )
            == winner_hash
            and _nonempty_string(
                winner,
                "hashAfterReload",
                scenario=scenario,
            )
            == winner_hash
        ),
        "zeroStaleMutation": (
            _nonnegative_int(
                stale_mutation,
                "mutationDelta",
                scenario=scenario,
            )
            == 0
            and _positive_int(
                stale_mutation,
                "attemptedRevision",
                scenario=scenario,
            )
            == expected_revision
        ),
        "cleanupComplete": (
            cleanup.get("deletedFromRoster") is True
            and cleanup.get("deletedFromStation") is True
            and cleanup.get("conversationDeleted") is True
            and _nonempty_string(
                cleanup,
                "restoredSelection",
                scenario=scenario,
            )
            == _nonempty_string(
                cleanup,
                "priorSelection",
                scenario=scenario,
            )
        ),
    }
    failed = sorted(key for key, passed in assertions.items() if not passed)
    if failed:
        raise GroupOneScenarioError(
            f"{scenario} production facts failed assertions: {failed}"
        )
    return assertions


def evaluate_base_cancelled(
    capture: Mapping[str, Any],
) -> dict[str, bool]:
    scenario = "BASE-CANCELLED"
    outcome = _mapping(capture, "outcome", scenario=scenario)
    details = _mapping(outcome, "details", scenario=scenario)
    receiver = _mapping(capture, "receiver", scenario=scenario)
    receiver_phases = _mapping(receiver, "phases", scenario=scenario)
    station = _mapping(capture, "station", scenario=scenario)
    persisted_outcome = _mapping(
        station,
        "persistedOutcome",
        scenario=scenario,
    )
    persisted_details = _mapping(
        persisted_outcome,
        "details",
        scenario=scenario,
    )
    replay = _mapping(capture, "replay", scenario=scenario)
    replay_snapshot = _mapping(replay, "snapshot", scenario=scenario)
    cleanup = _mapping(capture, "cleanup", scenario=scenario)
    cancellation = _mapping(capture, "cancellation", scenario=scenario)
    runtime_event = _mapping(capture, "runtimeEvent", scenario=scenario)
    turn_id = _nonempty_string(station, "turnId", scenario=scenario)
    source_hash = _sha256_string(
        replay,
        "sourceHash",
        scenario=scenario,
    )

    def receiver_phase_matches(
        phase_name: str,
        expected_message_id: str,
        expected_error_detail: str,
    ) -> bool:
        phase = _mapping(receiver_phases, phase_name, scenario=scenario)
        return (
            phase.get("visible") is True
            and phase.get("terminalStatus") == "cancelled"
            and phase.get("errorType") == "LIFECYCLE_CANCELLED"
            and phase.get("resourceKind") == "turn"
            and phase.get("resourceId") == turn_id
            and _nonempty_string(
                phase,
                "errorText",
                scenario=scenario,
            )
            == _nonempty_string(
                phase,
                "expectedErrorText",
                scenario=scenario,
            )
            and phase.get("recoveryVisible") is False
            and phase.get("resolutionPresent") is False
            and phase.get("messageId") == expected_message_id
            and phase.get("errorDetail") == expected_error_detail
        )

    assertions = {
        "typedCancellationProjected": (
            outcome.get("error") == "agent.errors.lifecycleCancelled"
            and outcome.get("error_type") == "LIFECYCLE_CANCELLED"
            and outcome.get("locale_key")
            == "agent.errors.lifecycleCancelled"
            and outcome.get("retryable") is False
            and outcome.get("terminal") is True
            and sorted(details) == ["resource_id", "resource_kind"]
            and details.get("resource_kind") == "turn"
            and details.get("resource_id") == turn_id
            and runtime_event.get("eventType") == "cancelled"
            and runtime_event.get("errorType") == "LIFECYCLE_CANCELLED"
            and runtime_event.get("sourceTransport") == "station-sse"
            and _sha256_string(
                runtime_event,
                "sourcePtidHash",
                scenario=scenario,
            )
            and runtime_event.get("sourceConversationId")
            == station.get("conversationId")
            and runtime_event.get("sourceTurnId") == turn_id
            and runtime_event.get("sourceSequence")
            == runtime_event.get("sequence")
            and runtime_event.get("sourceEventType")
            == runtime_event.get("eventType")
            and _positive_int(
                runtime_event,
                "sequence",
                scenario=scenario,
            ) > 0
        ),
        "localizedCancellationVisible": (
            receiver.get("visible") is True
            and receiver.get("terminalStatus") == "cancelled"
            and receiver.get("errorType") == "LIFECYCLE_CANCELLED"
            and receiver.get("resourceKind") == "turn"
            and receiver.get("resourceId") == turn_id
            and _nonempty_string(
                receiver,
                "errorText",
                scenario=scenario,
            )
            == _nonempty_string(
                receiver,
                "expectedErrorText",
                scenario=scenario,
            )
            and receiver.get("recoveryVisible") is False
            and receiver.get("resolutionPresent") is False
            and receiver_phase_matches(
                "live",
                str(station.get("messageId")),
                "cancelled_by_user",
            )
            and receiver_phase_matches(
                "reload",
                str(station.get("messageId")),
                "",
            )
            and receiver_phase_matches(
                "replaySnapshot",
                str(station.get("messageId")),
                "cancelled_by_user",
            )
        ),
        "cancelledPersisted": (
            station.get("turnStatus") == "cancelled"
            and station.get("attemptStatus") == "cancelled"
            and station.get("messageStatus") == "cancelled"
            and station.get("terminalReason") == "cancelled_by_user"
            and persisted_outcome.get("error") == outcome.get("error")
            and persisted_outcome.get("error_type")
            == outcome.get("error_type")
            and persisted_outcome.get("locale_key")
            == outcome.get("locale_key")
            and persisted_outcome.get("retryable")
            == outcome.get("retryable")
            and persisted_outcome.get("terminal")
            == outcome.get("terminal")
            and sorted(persisted_details) == sorted(details)
            and persisted_details.get("resource_kind")
            == details.get("resource_kind")
            and persisted_details.get("resource_id")
            == details.get("resource_id")
            and cancellation.get("status") == "cancelled"
        ),
        "exactlyOneAuthoritativeTerminal": (
            _positive_int(
                station,
                "terminalEventCount",
                scenario=scenario,
            ) == 1
            and _positive_int(
                station,
                "cancelledEventCount",
                scenario=scenario,
            ) == 1
            and _nonnegative_int(
                station,
                "errorEventCount",
                scenario=scenario,
            ) == 0
        ),
        "zeroLateSuccess": (
            _nonnegative_int(
                station,
                "doneEventCount",
                scenario=scenario,
            ) == 0
            and _nonnegative_int(
                station,
                "liveDoneEventCount",
                scenario=scenario,
            ) == 0
        ),
        "replayEqual": (
            replay.get("equal") is True
            and _sha256_string(
                replay,
                "replayHash",
                scenario=scenario,
            ) == source_hash
            and replay_snapshot.get("sourceTransport") == "station-sse"
            and _sha256_string(
                replay_snapshot,
                "sourcePtidHash",
                scenario=scenario,
            )
            == runtime_event.get("sourcePtidHash")
            and replay_snapshot.get("sourceConversationId")
            == station.get("conversationId")
            and replay_snapshot.get("sourceTurnId") == turn_id
            and replay_snapshot.get("sourceSequence")
            == runtime_event.get("sourceSequence")
            and replay_snapshot.get("sourceEventType") == "snapshot"
            and replay_snapshot.get("status") == "cancelled"
        ),
        "cleanupComplete": (
            _positive_int(
                cleanup,
                "cancellationRequestCount",
                scenario=scenario,
            ) == 1
            and _positive_int(
                cleanup,
                "terminalCleanupCount",
                scenario=scenario,
            ) == 1
            and cleanup.get("conversationDeleted") is True
        ),
    }
    failed = sorted(key for key, passed in assertions.items() if not passed)
    if failed:
        raise GroupOneScenarioError(
            f"{scenario} production facts failed assertions: {failed}"
        )
    return assertions


def evaluate_base_approval_denied(
    capture: Mapping[str, Any],
) -> dict[str, bool]:
    scenario = "BASE-APPROVAL_DENIED"
    outcome = _mapping(capture, "outcome", scenario=scenario)
    details = _mapping(outcome, "details", scenario=scenario)
    receiver = _mapping(capture, "receiver", scenario=scenario)
    decision = _mapping(capture, "decision", scenario=scenario)
    station = _mapping(capture, "station", scenario=scenario)
    lineage = _mapping(station, "lineage", scenario=scenario)
    replay = _mapping(capture, "replay", scenario=scenario)
    cleanup = _mapping(capture, "cleanup", scenario=scenario)
    states = station.get("states")
    if not isinstance(states, list) or any(
        not isinstance(value, str) or not value
        for value in states
    ):
        raise GroupOneScenarioError(
            f"{scenario} station states fact is invalid"
        )

    tool_call_id = _nonempty_string(
        decision,
        "toolCallId",
        scenario=scenario,
    )
    decision_id = _nonempty_string(
        decision,
        "decisionId",
        scenario=scenario,
    )
    decision_revision = _positive_int(
        decision,
        "decisionRevision",
        scenario=scenario,
    )
    acknowledgement_source_hash = _nonempty_string(
        replay,
        "acknowledgementSourceHash",
        scenario=scenario,
    )
    diagnostic_source_hash = _nonempty_string(
        replay,
        "diagnosticSourceHash",
        scenario=scenario,
    )

    assertions = {
        "typedDenialProjected": (
            outcome.get("error_type") == "TOOL_APPROVAL_DENIED"
            and outcome.get("locale_key")
            == "agent.errors.toolApprovalDenied"
            and outcome.get("retryable") is False
            and outcome.get("terminal") is True
            and sorted(details) == ["decision_id", "tool_call_id"]
            and details.get("tool_call_id") == tool_call_id
            and details.get("decision_id") == decision_id
        ),
        "localizedRecoveryVisible": (
            receiver.get("recoveryVisible") is True
            and _nonempty_string(
                receiver,
                "recoveryText",
                scenario=scenario,
            )
            == _nonempty_string(
                receiver,
                "expectedRecoveryText",
                scenario=scenario,
            )
            and receiver.get("errorVisible") is True
            and _nonempty_string(
                receiver,
                "errorText",
                scenario=scenario,
            )
            == _nonempty_string(
                receiver,
                "expectedErrorText",
                scenario=scenario,
            )
        ),
        "denialPersisted": (
            decision.get("accepted") is True
            and decision.get("approved") is False
            and station.get("policy") == "manual"
            and states == ["policy_check", "awaiting_user", "denied"]
            and station.get("errorCode") == "TOOL_APPROVAL_DENIED"
            and lineage.get("toolCallId") == tool_call_id
            and lineage.get("decisionId") == decision_id
            and _positive_int(
                lineage,
                "decisionRevision",
                scenario=scenario,
            )
            == decision_revision
        ),
        "zeroSideEffect": all(
            _nonnegative_int(station, key, scenario=scenario) == 0
            for key in (
                "executionAttemptCount",
                "sideEffectCount",
                "resultCount",
                "continuationCount",
            )
        ),
        "replayEqual": (
            replay.get("equal") is True
            and _nonempty_string(
                replay,
                "acknowledgementReplayHash",
                scenario=scenario,
            )
            == acknowledgement_source_hash
            and _nonempty_string(
                replay,
                "diagnosticReplayHash",
                scenario=scenario,
            )
            == diagnostic_source_hash
        ),
        "cleanupComplete": (
            cleanup.get("conversationDeleted") is True
            and cleanup.get("bindingRestored") is True
        ),
    }
    failed = sorted(key for key, passed in assertions.items() if not passed)
    if failed:
        raise GroupOneScenarioError(
            f"{scenario} production facts failed assertions: {failed}"
        )
    return assertions


def evaluate_base_context_overflow(
    capture: Mapping[str, Any],
) -> dict[str, bool]:
    scenario = "BASE-CONTEXT_OVERFLOW"
    outcome = _mapping(capture, "outcome", scenario=scenario)
    details = _mapping(outcome, "details", scenario=scenario)
    receiver = _mapping(capture, "receiver", scenario=scenario)
    station = _mapping(capture, "station", scenario=scenario)
    replay = _mapping(capture, "replay", scenario=scenario)
    cleanup = _mapping(capture, "cleanup", scenario=scenario)
    runtime_event = _mapping(capture, "runtimeEvent", scenario=scenario)
    try:
        limit_tokens = int(str(details.get("limit_tokens", "")))
        actual_tokens = int(str(details.get("actual_tokens", "")))
    except ValueError:
        limit_tokens = 0
        actual_tokens = 0

    assertions = {
        "typedContextOverflow": (
            outcome.get("error") == "agent.errors.contextOverflow"
            and outcome.get("error_type") == "CONTEXT_OVERFLOW"
            and outcome.get("locale_key") == "agent.errors.contextOverflow"
            and outcome.get("retryable") is False
            and outcome.get("terminal") is True
            and sorted(details) == ["actual_tokens", "limit_tokens"]
            and limit_tokens > 0
            and actual_tokens > limit_tokens
            and runtime_event.get("eventType") == "error"
            and runtime_event.get("errorType") == "CONTEXT_OVERFLOW"
            and _positive_int(
                runtime_event,
                "sequence",
                scenario=scenario,
            ) > 0
            and _positive_int(
                runtime_event,
                "streamGeneration",
                scenario=scenario,
            ) > 0
            and runtime_event.get("sourceTransport") == "station-sse"
            and _sha256_string(
                runtime_event,
                "sourcePtidHash",
                scenario=scenario,
            )
            and runtime_event.get("sourceConversationId")
            == station.get("conversationId")
            and runtime_event.get("sourceTurnId") == ""
            and runtime_event.get("sourceSequence") == 0
            and runtime_event.get("sourceEventType") == "error"
        ),
        "localizedRecoveryVisible": (
            receiver.get("errorVisible") is True
            and _nonempty_string(
                receiver,
                "errorText",
                scenario=scenario,
            )
            == _nonempty_string(
                receiver,
                "expectedErrorText",
                scenario=scenario,
            )
            and receiver.get("recoveryVisible") is True
            and _nonempty_string(
                receiver,
                "recoveryText",
                scenario=scenario,
            )
            == _nonempty_string(
                receiver,
                "expectedRecoveryText",
                scenario=scenario,
            )
        ),
        "rejectedDraftPreserved": (
            _positive_int(
                receiver,
                "draftLengthBefore",
                scenario=scenario,
            )
            == _positive_int(
                receiver,
                "draftLengthAfterRejection",
                scenario=scenario,
            )
            and _sha256_string(
                receiver,
                "draftHashBefore",
                scenario=scenario,
            )
            == _sha256_string(
                receiver,
                "draftHashAfterRejection",
                scenario=scenario,
            )
        ),
        "reduceContextExecuted": (
            receiver.get("composerFocusedAfterRecovery") is True
            and 0 < _positive_int(
                receiver,
                "reducedDraftLength",
                scenario=scenario,
            )
            < _positive_int(
                receiver,
                "draftLengthAfterRejection",
                scenario=scenario,
            )
            and bool(
                _sha256_string(
                    receiver,
                    "reducedDraftHash",
                    scenario=scenario,
                )
            )
        ),
        "stationStateUnchanged": (
            station.get("conversationVersionAfter")
            == station.get("conversationVersionBefore")
            and _sha256_string(
                station,
                "afterHash",
                scenario=scenario,
            )
            == _sha256_string(
                station,
                "beforeHash",
                scenario=scenario,
            )
        ),
        "zeroPersistenceAndProvider": (
            _nonnegative_int(station, "turnDelta", scenario=scenario) == 0
            and _nonnegative_int(station, "messageDelta", scenario=scenario)
            == 0
            and _nonnegative_int(station, "queueDelta", scenario=scenario)
            == 0
            and _nonnegative_int(
                station,
                "providerExecutionDelta",
                scenario=scenario,
            )
            == 0
        ),
        "replayEqual": (
            replay.get("equal") is True
            and _sha256_string(
                replay,
                "sourceHash",
                scenario=scenario,
            )
            == _sha256_string(
                replay,
                "replayHash",
                scenario=scenario,
            )
        ),
        "cleanupComplete": (
            cleanup.get("draftCleared") is True
            and cleanup.get("localProjectionCleared") is True
            and cleanup.get("conversationDeleted") is True
        ),
    }
    failed = sorted(key for key, passed in assertions.items() if not passed)
    if failed:
        raise GroupOneScenarioError(
            f"{scenario} production facts failed assertions: {failed}"
        )
    return assertions


def evaluate_base_attachment_rejected(
    capture: Mapping[str, Any],
) -> dict[str, bool]:
    scenario = "BASE-ATTACHMENT_REJECTED"
    runtime_event = _mapping(capture, "runtimeEvent", scenario=scenario)
    outcome = _mapping(capture, "outcome", scenario=scenario)
    details = _mapping(outcome, "details", scenario=scenario)
    receiver = _mapping(capture, "receiver", scenario=scenario)
    station = _mapping(capture, "station", scenario=scenario)
    replay = _mapping(capture, "replay", scenario=scenario)
    cleanup = _mapping(capture, "cleanup", scenario=scenario)
    deletion_readback = _mapping(
        cleanup,
        "deletionReadback",
        scenario=scenario,
    )

    attachment_id = _nonempty_string(
        station,
        "attachmentId",
        scenario=scenario,
    )
    reason_code = _nonempty_string(
        station,
        "reasonCode",
        scenario=scenario,
    )
    object_ref_hash = _sha256_string(
        station,
        "objectRefHash",
        scenario=scenario,
    )
    before_hash = _sha256_string(
        station,
        "beforeHash",
        scenario=scenario,
    )
    after_hash = _sha256_string(
        station,
        "afterHash",
        scenario=scenario,
    )

    assertions = {
        "typedAttachmentRejected": (
            outcome.get("error") == "agent.errors.attachmentRejected"
            and outcome.get("error_type") == "CONTEXT_ATTACHMENT_REJECTED"
            and outcome.get("locale_key")
            == "agent.errors.attachmentRejected"
            and outcome.get("retryable") is False
            and outcome.get("terminal") is True
            and sorted(details) == ["attachment_id", "reason_code"]
            and details.get("attachment_id") == attachment_id
            and details.get("reason_code") == reason_code
            and reason_code == "attachment_object_is_unavailable"
            and runtime_event.get("eventType") == "error"
            and runtime_event.get("errorType")
            == "CONTEXT_ATTACHMENT_REJECTED"
            and _positive_int(
                runtime_event,
                "sequence",
                scenario=scenario,
            )
            > 0
            and _positive_int(
                runtime_event,
                "streamGeneration",
                scenario=scenario,
            )
            > 0
            and bool(
                _nonempty_string(
                    runtime_event,
                    "observedAt",
                    scenario=scenario,
                )
            )
            and bool(
                _sha256_string(
                    runtime_event,
                    "eventId",
                    scenario=scenario,
                )
            )
            and bool(
                _sha256_string(
                    runtime_event,
                    "streamIdHash",
                    scenario=scenario,
                )
            )
            and bool(
                _sha256_string(
                    runtime_event,
                    "conversationIdHash",
                    scenario=scenario,
                )
            )
            and bool(
                _sha256_string(
                    runtime_event,
                    "payloadHash",
                    scenario=scenario,
                )
            )
        ),
        "localizedRemovalVisible": (
            receiver.get("errorVisible") is True
            and _nonempty_string(
                receiver,
                "errorText",
                scenario=scenario,
            )
            == _nonempty_string(
                receiver,
                "expectedErrorText",
                scenario=scenario,
            )
            and receiver.get("removalVisible") is True
            and _nonempty_string(
                receiver,
                "removalText",
                scenario=scenario,
            )
            == _nonempty_string(
                receiver,
                "expectedRemovalText",
                scenario=scenario,
            )
        ),
        "rejectedDraftPreserved": (
            receiver.get("attachmentVisibleAfterReject") is True
            and receiver.get("attachmentStatusAfterReject") == "rejected"
            and _nonempty_string(
                receiver,
                "draftTextAfterRejection",
                scenario=scenario,
            )
            == _nonempty_string(
                receiver,
                "draftTextBefore",
                scenario=scenario,
            )
        ),
        "removeAttachmentExecuted": (
            receiver.get("removalExecuted") is True
            and receiver.get("attachmentPresentAfterRemoval") is False
        ),
        "stationStateUnchanged": (
            _positive_int(
                station,
                "conversationVersionBefore",
                scenario=scenario,
            )
            == _positive_int(
                station,
                "conversationVersionAfter",
                scenario=scenario,
            )
            and before_hash == after_hash
            and _nonnegative_int(
                station,
                "turnDelta",
                scenario=scenario,
            )
            == 0
            and _nonnegative_int(
                station,
                "messageDelta",
                scenario=scenario,
            )
            == 0
        ),
        "zeroSideEffect": (
            _nonnegative_int(
                station,
                "providerExecutionDelta",
                scenario=scenario,
            )
            == 0
        ),
        "replayEqual": (
            replay.get("equal") is True
            and _sha256_string(
                replay,
                "sourceHash",
                scenario=scenario,
            )
            == _sha256_string(
                replay,
                "replayHash",
                scenario=scenario,
            )
        ),
        "cleanupComplete": (
            cleanup.get("draftRemoved") is True
            and cleanup.get("objectDeleted") is True
            and deletion_readback.get("source") == "oss-owner-list"
            and _sha256_string(
                deletion_readback,
                "objectRefHash",
                scenario=scenario,
            )
            == object_ref_hash
            and bool(
                _sha256_string(
                    deletion_readback,
                    "objectPathHash",
                    scenario=scenario,
                )
            )
            and bool(
                _nonempty_string(
                    deletion_readback,
                    "deletedAt",
                    scenario=scenario,
                )
            )
            and _positive_int(
                deletion_readback,
                "readAttempt",
                scenario=scenario,
            )
            > 0
            and cleanup.get("conversationDeleted") is True
        ),
    }
    failed = sorted(key for key, passed in assertions.items() if not passed)
    if failed:
        raise GroupOneScenarioError(
            f"{scenario} production facts failed assertions: {failed}"
        )
    return assertions


def evaluate_base_approval_expired(
    capture: Mapping[str, Any],
) -> dict[str, bool]:
    scenario = "BASE-APPROVAL_EXPIRED"
    outcome = _mapping(capture, "outcome", scenario=scenario)
    details = _mapping(outcome, "details", scenario=scenario)
    receiver = _mapping(capture, "receiver", scenario=scenario)
    decision = _mapping(capture, "decision", scenario=scenario)
    station = _mapping(capture, "station", scenario=scenario)
    lineage = _mapping(station, "lineage", scenario=scenario)
    recovery = _mapping(capture, "recovery", scenario=scenario)
    replay = _mapping(capture, "replay", scenario=scenario)
    cleanup = _mapping(capture, "cleanup", scenario=scenario)
    states = station.get("states")
    if not isinstance(states, list) or any(
        not isinstance(value, str) or not value
        for value in states
    ):
        raise GroupOneScenarioError(
            f"{scenario} station states fact is invalid"
        )

    decision_id = _nonempty_string(
        decision,
        "decisionId",
        scenario=scenario,
    )
    tool_call_id = _nonempty_string(
        decision,
        "toolCallId",
        scenario=scenario,
    )
    expires_at = _nonempty_string(
        decision,
        "expiresAt",
        scenario=scenario,
    )
    acknowledgement_source_hash = _nonempty_string(
        replay,
        "acknowledgementSourceHash",
        scenario=scenario,
    )
    station_source_hash = _nonempty_string(
        replay,
        "stationSourceHash",
        scenario=scenario,
    )

    assertions = {
        "typedExpiryProjected": (
            outcome.get("error_type") == "TOOL_APPROVAL_EXPIRED"
            and outcome.get("locale_key")
            == "agent.errors.toolApprovalExpired"
            and outcome.get("retryable") is True
            and outcome.get("terminal") is True
            and sorted(details) == ["decision_id", "expires_at"]
            and details.get("decision_id") == decision_id
            and details.get("expires_at") == expires_at
        ),
        "localizedRecoveryVisible": (
            receiver.get("recoveryVisible") is True
            and _nonempty_string(
                receiver,
                "recoveryText",
                scenario=scenario,
            )
            == _nonempty_string(
                receiver,
                "expectedRecoveryText",
                scenario=scenario,
            )
            and receiver.get("errorVisible") is True
            and _nonempty_string(
                receiver,
                "errorText",
                scenario=scenario,
            )
            == _nonempty_string(
                receiver,
                "expectedErrorText",
                scenario=scenario,
            )
        ),
        "expiredDecisionImmutable": (
            decision.get("accepted") is False
            and decision.get("errorCode")
            == "TOOL_APPROVAL_DECISION_ERROR_CODE_EXPIRED"
            and station.get("policy") == "manual"
            and states == ["policy_check", "awaiting_user", "expired"]
            and station.get("errorCode") == "TOOL_APPROVAL_EXPIRED"
            and lineage.get("toolCallId") == tool_call_id
            and lineage.get("decisionId") == ""
            and _nonnegative_int(
                lineage,
                "decisionRevision",
                scenario=scenario,
            )
            == _nonnegative_int(
                decision,
                "decisionRevision",
                scenario=scenario,
            )
        ),
        "requestAgainCreatedOneAttempt": (
            receiver.get("recoveryExecuted") is True
            and _nonnegative_int(
                recovery,
                "attemptCountAfter",
                scenario=scenario,
            )
            == _nonnegative_int(
                recovery,
                "attemptCountBefore",
                scenario=scenario,
            )
            + 1
            and recovery.get("newApprovalIdentityDistinct") is True
            and recovery.get("cancellationStatus") == "cancelled"
            and recovery.get("retryToolStatus") == "cancelled"
        ),
        "zeroSideEffect": (
            all(
                _nonnegative_int(station, key, scenario=scenario) == 0
                for key in (
                    "executionAttemptCount",
                    "sideEffectCount",
                    "resultCount",
                    "continuationCount",
                )
            )
            and _nonnegative_int(
                recovery,
                "retryExecutionAttemptCount",
                scenario=scenario,
            )
            == 0
            and _nonnegative_int(
                recovery,
                "retrySideEffectCount",
                scenario=scenario,
            )
            == 0
            and _nonnegative_int(
                recovery,
                "retryResultCount",
                scenario=scenario,
            )
            == 0
            and _nonnegative_int(
                recovery,
                "retryContinuationCount",
                scenario=scenario,
            )
            == 0
        ),
        "replayEqual": (
            replay.get("equal") is True
            and _nonempty_string(
                replay,
                "acknowledgementReplayHash",
                scenario=scenario,
            )
            == acknowledgement_source_hash
            and _nonempty_string(
                replay,
                "stationReplayHash",
                scenario=scenario,
            )
            == station_source_hash
        ),
        "cleanupComplete": (
            cleanup.get("conversationDeleted") is True
            and cleanup.get("bindingRestored") is True
        ),
    }
    failed = sorted(key for key, passed in assertions.items() if not passed)
    if failed:
        raise GroupOneScenarioError(
            f"{scenario} production facts failed assertions: {failed}"
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


def _string_set(
    value: Mapping[str, Any],
    key: str,
    *,
    scenario: str,
) -> set[str]:
    items = _string_list(value, key, scenario=scenario)
    if not items or len(items) != len(set(items)):
        raise GroupOneScenarioError(
            f"{scenario} {key} fact must contain unique values"
        )
    return set(items)


def _sha256_string(
    value: Mapping[str, Any],
    key: str,
    *,
    scenario: str,
) -> str:
    item = _nonempty_string(value, key, scenario=scenario)
    if re.fullmatch(r"[0-9a-f]{64}", item) is None:
        raise GroupOneScenarioError(
            f"{scenario} {key} must be a lowercase SHA-256 digest"
        )
    return item


def _hex_identity_matches(left: str, right: str) -> bool:
    pattern = re.compile(r"^[0-9a-f]{12,40}$")
    return (
        pattern.fullmatch(left) is not None
        and pattern.fullmatch(right) is not None
        and (left.startswith(right) or right.startswith(left))
    )


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


def _optional_string(
    value: Mapping[str, Any],
    key: str,
    *,
    scenario: str,
) -> str:
    item = value.get(key)
    if not isinstance(item, str):
        raise GroupOneScenarioError(
            f"{scenario} {key} must be a string"
        )
    return item
