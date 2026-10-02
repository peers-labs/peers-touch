#!/usr/bin/env python3
"""Fail-closed oracle for the P12 external runtime lifecycle."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any


EXPECTED_ASSERTIONS = frozenset(
    {
        "adapterAdvertised",
        "stationActivitiesMatchLifecycle",
        "conversationIsolation",
        "followUpResumedExactSession",
        "stationRestartResumedExactSession",
        "resumeUnavailableTyped",
        "bindingPreservedBeforeConfirmation",
        "nativeLocalizedConfirmReset",
        "browserLocalizedConfirmReset",
        "browserOwnsNoExternalProcess",
        "destructiveConfirmationVisible",
        "resetAdvancedExactlyOneEpoch",
        "concurrentResetSerialized",
        "resetReplayIdempotent",
        "resetConflictRejected",
        "cleanupFailureDurable",
        "cleanupRetrySucceeded",
        "freshSessionCreated",
        "cancellationPreservedSession",
        "deletionCleanupSucceeded",
        "externalCleanupExecutedExactlyOnce",
        "runtimeResourcesReleased",
    }
)
EXTERNAL_RUNTIME_READY_STATE = 1
EXTERNAL_RUNTIME_RESUME_UNAVAILABLE_STATE = 2
EXTERNAL_RUNTIME_CLEANUP_FAILED_STATE = 4


class ExternalRuntimeEvidenceError(RuntimeError):
    """P12 runtime evidence is missing or contradicts the contract."""


def _mapping(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ExternalRuntimeEvidenceError(f"{label} is missing")
    return dict(value)


def _binding(value: Any, label: str) -> dict[str, Any]:
    binding = _mapping(value, label)
    if (
        binding.get("runtime_kind") != 2
        or binding.get("provider_id") != "external-agent"
        or binding.get("model_id") != "default"
        or not binding.get("runtime_home_ref")
        or int(binding.get("external_session_epoch") or 0) <= 0
    ):
        raise ExternalRuntimeEvidenceError(f"{label} is not an external binding")
    return binding


def _counter_delta(before: Mapping[str, Any], after: Mapping[str, Any], key: str) -> int:
    before_counters = _mapping(before.get("counters"), "activity before counters")
    after_counters = _mapping(after.get("counters"), "activity after counters")
    return int(after_counters.get(key, -1)) - int(before_counters.get(key, -1))


def evaluate_external_runtime_capture(
    capture: Mapping[str, Any],
) -> dict[str, bool]:
    preparation = _mapping(capture.get("preparation"), "preparation")
    fixture = _mapping(preparation.get("fixture"), "fixture")
    primary_start = _mapping(preparation.get("primaryStart"), "primary start")
    primary_follow_up = _mapping(
        preparation.get("primaryFollowUp"),
        "primary follow-up",
    )
    secondary_start = _mapping(
        preparation.get("secondaryStart"),
        "secondary start",
    )
    primary_start_binding = _binding(
        primary_start.get("binding"),
        "primary start binding",
    )
    primary_follow_binding = _binding(
        primary_follow_up.get("binding"),
        "primary follow-up binding",
    )
    secondary_binding = _binding(
        secondary_start.get("binding"),
        "secondary binding",
    )
    restart = _mapping(capture.get("restart"), "restart")
    restart_turn = _mapping(restart.get("turn"), "restart turn")
    restart_binding = _binding(
        restart_turn.get("binding"),
        "restart binding",
    )
    browser_failure = _mapping(
        capture.get("browserFailure"),
        "browser failure",
    )
    failure_before = _mapping(browser_failure.get("before"), "failure before")
    failure_after = _mapping(browser_failure.get("after"), "failure after")
    failure_before_binding = _binding(
        failure_before.get("runtime_binding"),
        "failure binding before",
    )
    failure_after_binding = _binding(
        failure_after.get("runtime_binding"),
        "failure binding after",
    )
    browser_receiver = _mapping(
        browser_failure.get("receiver"),
        "browser receiver",
    )
    failed_turn = _mapping(browser_failure.get("turn"), "failed Turn")
    failed_assistant = _mapping(
        failed_turn.get("assistant"),
        "failed Assistant",
    )
    failed_typed_error = _mapping(
        failed_assistant.get("typedError"),
        "failed typed error",
    )
    failed_details = _mapping(
        failed_typed_error.get("details"),
        "failed typed error details",
    )
    native_receiver = _mapping(
        capture.get("nativeReceiver"),
        "native receiver",
    )
    reset = _mapping(capture.get("reset"), "reset")
    reset_before = _mapping(reset.get("before"), "reset before")
    reset_after = _mapping(reset.get("after"), "reset after")
    reset_before_binding = _binding(
        reset_before.get("runtime_binding"),
        "reset binding before",
    )
    reset_after_binding = _binding(
        reset_after.get("runtime_binding"),
        "reset binding after",
    )
    concurrent_replay = _mapping(
        reset.get("concurrentReplay"),
        "concurrent reset result",
    )
    concurrent_replay_conversation = _mapping(
        concurrent_replay.get("conversation"),
        "concurrent reset conversation",
    )
    replay = _mapping(reset.get("replay"), "reset replay")
    replay_conversation = _mapping(
        replay.get("conversation"),
        "reset replay conversation",
    )
    cleanup_retry = _mapping(
        capture.get("cleanupRetry"),
        "cleanup retry",
    )
    cleanup_failed = _mapping(
        cleanup_retry.get("failed"),
        "cleanup failed conversation",
    )
    cleanup_failed_binding = _binding(
        cleanup_failed.get("runtime_binding"),
        "cleanup failed binding",
    )
    cleanup_retry_result = _mapping(
        cleanup_retry.get("retry"),
        "cleanup retry result",
    )
    cleanup_retry_conversation = _mapping(
        cleanup_retry_result.get("conversation"),
        "cleanup retry conversation",
    )
    cleanup_retry_binding = _binding(
        cleanup_retry_conversation.get("runtime_binding"),
        "cleanup retry binding",
    )
    fresh = _mapping(capture.get("fresh"), "fresh session")
    fresh_binding = _binding(fresh.get("binding"), "fresh binding")
    cancellation = _mapping(capture.get("cancellation"), "cancellation")
    product_cleanup = _mapping(
        capture.get("productCleanup"),
        "product cleanup",
    )
    adapter_audit = _mapping(
        capture.get("adapterAudit"),
        "adapter audit",
    )
    profile = _mapping(preparation.get("profile"), "effective profile")
    runtimes = profile.get("runtimes")
    if not isinstance(runtimes, list):
        raise ExternalRuntimeEvidenceError(
            "effective profile runtimes are missing"
        )
    external_rows = [
        item
        for item in runtimes
        if isinstance(item, Mapping)
        and item.get("runtime_id") == "external-agent"
    ]
    local_before = _mapping(
        browser_failure.get("localActivityBefore"),
        "browser local activity before",
    )
    local_after = _mapping(
        browser_failure.get("localActivityAfter"),
        "browser local activity after",
    )

    old_tuple = (
        failure_before_binding.get("external_session_id"),
        failure_before_binding.get("external_session_epoch"),
        failure_before_binding.get("runtime_home_ref"),
    )
    preserved_tuple = (
        failure_after_binding.get("external_session_id"),
        failure_after_binding.get("external_session_epoch"),
        failure_after_binding.get("runtime_home_ref"),
    )
    retry_before = _mapping(cleanup_retry.get("before"), "cleanup retry before")
    retry_before_binding = _binding(
        retry_before.get("runtime_binding"),
        "cleanup retry binding before",
    )
    audit_entries = adapter_audit.get("entries")

    assertions = {
        "adapterAdvertised":
            len(external_rows) == 1
            and external_rows[0].get("state")
            == "RUNTIME_ADVERTISEMENT_STATE_READY",
        "stationActivitiesMatchLifecycle":
            _counter_delta(
                _mapping(preparation.get("activityBefore"), "activity before"),
                _mapping(preparation.get("activityAfter"), "activity after"),
                "runtime_bindings_created",
            )
            == 2
            and _counter_delta(
                _mapping(preparation.get("activityBefore"), "activity before"),
                _mapping(preparation.get("activityAfter"), "activity after"),
                "external_sessions_created",
            )
            == 2
            and _counter_delta(
                _mapping(preparation.get("activityBefore"), "activity before"),
                _mapping(preparation.get("activityAfter"), "activity after"),
                "runtime_homes_created",
            )
            == 2
            and _counter_delta(
                _mapping(preparation.get("activityBefore"), "activity before"),
                _mapping(preparation.get("activityAfter"), "activity after"),
                "processes_started",
            )
            == 4,
        "conversationIsolation":
            primary_start_binding.get("external_session_id")
            != secondary_binding.get("external_session_id")
            and primary_start_binding.get("runtime_home_ref")
            != secondary_binding.get("runtime_home_ref"),
        "followUpResumedExactSession":
            primary_follow_binding.get("external_session_id")
            == primary_start_binding.get("external_session_id")
            and primary_follow_binding.get("external_session_epoch")
            == primary_start_binding.get("external_session_epoch")
            and primary_follow_binding.get("runtime_home_ref")
            == primary_start_binding.get("runtime_home_ref"),
        "stationRestartResumedExactSession":
            restart.get("stationRestarted") is True
            and restart_binding.get("external_session_id")
            == primary_start_binding.get("external_session_id")
            and restart_binding.get("external_session_epoch")
            == primary_start_binding.get("external_session_epoch")
            and restart_binding.get("runtime_home_ref")
            == primary_start_binding.get("runtime_home_ref"),
        "resumeUnavailableTyped":
            browser_receiver.get("errorType") == "RUNTIME_RESUME_UNAVAILABLE"
            and browser_receiver.get("localeKey")
            == "agent.errors.resumeUnavailable"
            and browser_receiver.get("retryable") is True
            and browser_receiver.get("terminal") is True
            and browser_receiver.get("resolutionType") == "confirmReset"
            and set(failed_details)
            == {"runtime_profile_id", "reason_code"},
        "bindingPreservedBeforeConfirmation":
            old_tuple == preserved_tuple
            and failure_after_binding.get("state")
            == EXTERNAL_RUNTIME_RESUME_UNAVAILABLE_STATE,
        "nativeLocalizedConfirmReset":
            native_receiver.get("visible") is True
            and native_receiver.get("locale") == "en"
            and native_receiver.get("recoveryText")
            == native_receiver.get("expectedRecoveryText")
            and native_receiver.get("errorText")
            == native_receiver.get("expectedErrorText"),
        "browserLocalizedConfirmReset":
            browser_receiver.get("visible") is True
            and browser_receiver.get("locale") == "zh-CN"
            and browser_receiver.get("recoveryText")
            == browser_receiver.get("expectedRecoveryText")
            and browser_receiver.get("errorText")
            == browser_receiver.get("expectedErrorText"),
        "browserOwnsNoExternalProcess":
            local_before.get("owner") == "desktop-rust"
            and local_after.get("owner") == "desktop-rust"
            and _counter_delta(local_before, local_after, "processes_started") == 0
            and _counter_delta(
                local_before,
                local_after,
                "external_sessions_created",
            ) == 0,
        "destructiveConfirmationVisible":
            reset.get("confirmationVisible") is True
            and reset.get("confirmationText")
            == reset.get("expectedConfirmationText"),
        "resetAdvancedExactlyOneEpoch":
            int(reset_after.get("version") or 0)
            == int(reset_before.get("version") or 0) + 1
            and int(reset_after_binding.get("external_session_epoch") or 0)
            == int(reset_before_binding.get("external_session_epoch") or 0) + 1
            and reset_after_binding.get("external_session_id") == ""
            and reset_after_binding.get("state") == EXTERNAL_RUNTIME_READY_STATE,
        "concurrentResetSerialized":
            int(concurrent_replay.get("closed_external_session_epoch") or 0)
            == int(reset_before_binding.get("external_session_epoch") or 0)
            and int(concurrent_replay_conversation.get("version") or 0)
            == int(reset_after.get("version") or 0)
            and isinstance(concurrent_replay.get("replayed"), bool),
        "resetReplayIdempotent":
            replay.get("replayed") is True
            and int(replay.get("closed_external_session_epoch") or 0)
            == int(reset_before_binding.get("external_session_epoch") or 0)
            and int(replay_conversation.get("version") or 0)
            == int(reset_after.get("version") or 0),
        "resetConflictRejected":
            "DUPLICATE" in str(reset.get("conflictCode") or "").upper(),
        "cleanupFailureDurable":
            bool(cleanup_retry.get("firstFailureCode"))
            and cleanup_failed_binding.get("state")
            == EXTERNAL_RUNTIME_CLEANUP_FAILED_STATE
            and cleanup_failed_binding.get("external_session_id")
            == retry_before_binding.get("external_session_id")
            and cleanup_failed_binding.get("external_session_epoch")
            == retry_before_binding.get("external_session_epoch"),
        "cleanupRetrySucceeded":
            cleanup_retry_result.get("replayed") is False
            and int(cleanup_retry_binding.get("external_session_epoch") or 0)
            == int(retry_before_binding.get("external_session_epoch") or 0) + 1
            and cleanup_retry_binding.get("external_session_id") == ""
            and cleanup_retry_binding.get("state") == EXTERNAL_RUNTIME_READY_STATE,
        "freshSessionCreated":
            fresh_binding.get("external_session_id")
            not in {"", fixture.get("primarySessionId")}
            and int(fresh_binding.get("external_session_epoch") or 0)
            == int(fixture.get("epoch") or 0) + 1,
        "cancellationPreservedSession":
            cancellation.get("bindingPreserved") is True
            and cancellation.get("receiverVisible") is True
            and bool(cancellation.get("turnId")),
        "deletionCleanupSucceeded":
            product_cleanup.get("status") == "clean"
            and not product_cleanup.get("failures"),
        "externalCleanupExecutedExactlyOnce":
            isinstance(audit_entries, list)
            and len(audit_entries) == 3
            and all(
                isinstance(item, Mapping)
                and int(item.get("successCount") or 0) == 1
                for item in audit_entries
            )
            and sum(
                int(item.get("failureCount") or 0)
                for item in audit_entries
                if isinstance(item, Mapping)
            )
            == 1,
        "runtimeResourcesReleased":
            adapter_audit.get("runtimeHomeCount") == 0
            and adapter_audit.get("unexpectedEntryCount") == 0,
    }
    if set(assertions) != EXPECTED_ASSERTIONS:
        raise ExternalRuntimeEvidenceError(
            "P12 oracle assertion inventory changed"
        )
    failed = sorted(name for name, passed in assertions.items() if not passed)
    if failed:
        raise ExternalRuntimeEvidenceError(
            "P12 external runtime assertions failed: " + ", ".join(failed)
        )
    return assertions
