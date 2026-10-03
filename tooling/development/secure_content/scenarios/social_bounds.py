from __future__ import annotations

import hashlib
import time
from contextlib import ExitStack
from pathlib import Path
from typing import Any, Mapping

from tooling.development.secure_content.attached_client import (
    AttachedProductClient,
)
from tooling.development.secure_content.run import (
    RunnerError,
    ScenarioContext,
    ScenarioDefinition,
)


EXPECTED_PROFILE = "four"
EXPECTED_CLIENTS = (
    "secure-content-desktop-alice",
    "secure-content-desktop-bob",
    "secure-content-desktop-eve",
)
EXPECTED_BUDGET_SECONDS = 1200
MAX_OBJECTS = 10
MAX_POLL_OPTIONS = 20


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise RunnerError(message)


def _mapping(value: Any, field: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise RunnerError(f"social-bounds {field} is invalid")
    return value


def _sha256(value: bytes | str) -> str:
    payload = value.encode("utf-8") if isinstance(value, str) else value
    return hashlib.sha256(payload).hexdigest()


def _require_runtime_binding(context: ScenarioContext) -> None:
    if context.runtime_manifest is None:
        context.block(
            "social-bounds requires an immutable runtime manifest",
            kind="DRIVER_FAILED",
            owner="secure-content-w8-runtime",
            retryable=True,
        )
    if context.runtime != "desktop":
        raise RunnerError("social-bounds requires the desktop runtime")
    if (
        context.profile != EXPECTED_PROFILE
        or context.profiles != (EXPECTED_PROFILE,)
    ):
        raise RunnerError("social-bounds requires exactly --profile four")
    if context.clients != EXPECTED_CLIENTS:
        raise RunnerError(
            "social-bounds requires exactly --clients "
            + ",".join(EXPECTED_CLIENTS)
        )
    if context.budget_seconds != EXPECTED_BUDGET_SECONDS:
        raise RunnerError("social-bounds requires exactly --budget-seconds 1200")
    manifest = context.require_runtime_manifest()
    for client_id, actor_role in zip(
        EXPECTED_CLIENTS,
        ("alice", "bob", "eve"),
    ):
        client = manifest.client(client_id)
        if (
            client.get("actor_role") != actor_role
            or client.get("runtime_kind") != "native-tauri"
        ):
            raise RunnerError(
                f"social-bounds client {client_id!r} must bind "
                f"{actor_role!r} to a Native Tauri runtime"
            )


def _publish(
    client: AttachedProductClient,
    payload: Mapping[str, Any],
    *,
    label: str,
) -> str:
    for attempt in range(3):
        result = _mapping(
            client.call("publishTypedPrivateMoment", payload),
            f"{label} publish",
        )
        if result.get("state") != "UNKNOWN_COMMIT":
            break
        if attempt < 2:
            time.sleep(min(0.25, client.context.remaining_seconds()))
    else:
        raise RunnerError(f"social-bounds {label} remained UNKNOWN_COMMIT")
    post_id = result.get("transientPostId")
    _require(
        result.get("state") == "PUBLISHED"
        and isinstance(post_id, str)
        and bool(post_id),
        f"social-bounds {label} did not publish",
    )
    return post_id


def _assert_rejected(
    client: AttachedProductClient,
    payload: Mapping[str, Any],
    *,
    label: str,
) -> None:
    result = _mapping(
        client.call("probeTypedPrivateMomentRejection", payload),
        f"{label} rejection",
    )
    _require(
        result.get("rejected") is True
        and result.get("state")
        in {"PUBLISH_FAILED", "AUDIENCE_TOO_LARGE", "PRIVATE_UNSUPPORTED"}
        and not result.get("transientPostId"),
        f"social-bounds {label} did not fail closed",
    )


def _execute(context: ScenarioContext) -> Mapping[str, Any]:
    _require_runtime_binding(context)
    with ExitStack() as stack:
        alice = stack.enter_context(
            AttachedProductClient(context, EXPECTED_CLIENTS[0])
        )
        bob = stack.enter_context(
            AttachedProductClient(context, EXPECTED_CLIENTS[1])
        )
        eve = stack.enter_context(
            AttachedProductClient(context, EXPECTED_CLIENTS[2])
        )
        files: list[dict[str, str]] = []
        expected_hashes: list[str] = []
        for index in range(MAX_OBJECTS + 1):
            body = (
                b"\x89PNG\r\n\x1a\n"
                + f"secure-content-w8-bound-{index}".encode("ascii")
            )
            path = context.write_artifact_bytes(
                f"w8-bounds-{index}.png",
                body,
                durable=False,
            )
            stack.callback(path.unlink, missing_ok=True)
            files.append({
                "intentId": f"w8-bound-object-{index}",
                "filePath": str(path),
            })
            expected_hashes.append(_sha256(body))

        object_post_id = _publish(
            alice,
            {
                "draftId": "w8-bounds-object-at-limit",
                "revision": 1,
                "text": "secure-content-w8-bounds-objects",
                "audienceKind": "FRIENDS",
                "momentKind": "IMAGE",
                "files": files[:MAX_OBJECTS],
            },
            label="object at-limit",
        )
        object_projection = _mapping(
            bob.call(
                "readPrivateMoment",
                {"postId": object_post_id, "openMedia": True},
            ),
            "object at-limit receiver projection",
        )
        media = object_projection.get("media")
        _require(
            object_projection.get("state") == "CONTENT_READY"
            and isinstance(media, list)
            and len(media) == MAX_OBJECTS
            and all(
                isinstance(item, Mapping)
                and item.get("state") == "MEDIA_READY"
                for item in media
            )
            and {
                str(item.get("plaintextSha256"))
                for item in media
                if isinstance(item, Mapping)
            }
            == set(expected_hashes[:MAX_OBJECTS]),
            "social-bounds ten-object receiver projection differs",
        )
        _assert_rejected(
            alice,
            {
                "draftId": "w8-bounds-object-over-limit",
                "revision": 1,
                "text": "secure-content-w8-bounds-object-over",
                "audienceKind": "FRIENDS",
                "momentKind": "IMAGE",
                "files": files,
            },
            label="object over-limit",
        )

        poll_options = [
            f"Option {index + 1}"
            for index in range(MAX_POLL_OPTIONS)
        ]
        poll_post_id = _publish(
            alice,
            {
                "draftId": "w8-bounds-poll-at-limit",
                "revision": 1,
                "text": "secure-content-w8-bounds-poll",
                "audienceKind": "FRIENDS",
                "momentKind": "POLL",
                "poll": {
                    "question": "Choose bounded options",
                    "options": poll_options,
                    "minChoices": 1,
                    "maxChoices": MAX_POLL_OPTIONS,
                    "expiresAtSeconds": int(time.time()) + 3600,
                },
            },
            label="poll at-limit",
        )
        poll_projection = _mapping(
            bob.call(
                "readPrivateMoment",
                {"postId": poll_post_id},
            ),
            "poll at-limit receiver projection",
        )
        poll = _mapping(
            poll_projection.get("subtypeEvidence"),
            "poll at-limit evidence",
        )
        _require(
            poll_projection.get("state") == "CONTENT_READY"
            and poll.get("optionLabelSha256")
            == [_sha256(option) for option in poll_options]
            and poll.get("maxChoices") == MAX_POLL_OPTIONS,
            "social-bounds twenty-option Poll projection differs",
        )
        _assert_rejected(
            alice,
            {
                "draftId": "w8-bounds-poll-over-limit",
                "revision": 1,
                "text": "secure-content-w8-bounds-poll-over",
                "audienceKind": "FRIENDS",
                "momentKind": "POLL",
                "poll": {
                    "question": "Choose too many options",
                    "options": [*poll_options, "Option 21"],
                    "minChoices": 1,
                    "maxChoices": MAX_POLL_OPTIONS + 1,
                    "expiresAtSeconds": int(time.time()) + 3600,
                },
            },
            label="poll over-limit",
        )

        for client in (alice, bob, eve):
            client.call("clearLocalState")

    return {
        "runtimeBounds": {
            "objectCountAccepted": MAX_OBJECTS,
            "objectCountRejected": MAX_OBJECTS + 1,
            "pollOptionCountAccepted": MAX_POLL_OPTIONS,
            "pollOptionCountRejected": MAX_POLL_OPTIONS + 1,
        },
        "recipientTruncationObserved": False,
        "partialCommitObserved": False,
        "sourceOnlyCoverage": (
            "audience-slot-limit",
            "comment-page-limit",
            "payload-limit",
            "chunk-limit",
            "plan-upload-limit",
            "recovery-page-limit",
            "storage-full",
            "worker-queue-saturation",
        ),
    }


SCENARIO = ScenarioDefinition(
    scenario_id="social-bounds",
    journey_id="sc-dj-social-expansion",
    work_item_id="secure-content-w8",
    runtimes=frozenset({"desktop"}),
    evidence_path=Path("W8/bounds/result.json"),
    execute=_execute,
    result_prefix=Path("W8"),
    result_task_id="W8",
    result_workstream_id="W8",
    result_variant="bounds",
)
