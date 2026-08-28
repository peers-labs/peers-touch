#!/usr/bin/env python3
"""Fail-closed scenario oracles for Foundation Group 1 runtime captures."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any


class GroupOneScenarioError(RuntimeError):
    """A scenario capture is missing reviewed production facts."""


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
        raise GroupOneScenarioError(
            f"AS-F03 production facts failed assertions: {failed}"
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
            and _positive_int(
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
