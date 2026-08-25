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


def _mapping(value: Mapping[str, Any], key: str) -> dict[str, Any]:
    item = value.get(key)
    if not isinstance(item, Mapping):
        raise GroupOneScenarioError(f"AS-F02 {key} fact is missing")
    return dict(item)


def _list(value: Mapping[str, Any], key: str) -> list[dict[str, Any]]:
    item = value.get(key)
    if not isinstance(item, list) or any(
        not isinstance(entry, Mapping) for entry in item
    ):
        raise GroupOneScenarioError(f"AS-F02 {key} fact is invalid")
    return [dict(entry) for entry in item]


def _positive_int(value: Mapping[str, Any], key: str) -> int:
    item = value.get(key)
    if not isinstance(item, int) or isinstance(item, bool) or item <= 0:
        raise GroupOneScenarioError(f"AS-F02 {key} must be a positive integer")
    return item


def _nonempty_string(value: Mapping[str, Any], key: str) -> str:
    item = value.get(key)
    if not isinstance(item, str) or not item:
        raise GroupOneScenarioError(f"AS-F02 {key} must be a non-empty string")
    return item
