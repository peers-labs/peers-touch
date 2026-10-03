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
PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x04\x00\x00\x00\xb5\x1c\x0c\x02"
)


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise RunnerError(message)


def _mapping(value: Any, field: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise RunnerError(f"social-delete-block {field} is invalid")
    return value


def _sha256(value: bytes | str) -> str:
    payload = value.encode("utf-8") if isinstance(value, str) else value
    return hashlib.sha256(payload).hexdigest()


def _require_runtime_binding(context: ScenarioContext) -> None:
    if context.runtime_manifest is None:
        context.block(
            "social-delete-block requires an immutable runtime manifest",
            kind="DRIVER_FAILED",
            owner="secure-content-w8-runtime",
            retryable=True,
        )
    if context.runtime != "desktop":
        raise RunnerError("social-delete-block requires the desktop runtime")
    if (
        context.profile != EXPECTED_PROFILE
        or context.profiles != (EXPECTED_PROFILE,)
    ):
        raise RunnerError("social-delete-block requires exactly --profile four")
    if context.clients != EXPECTED_CLIENTS:
        raise RunnerError(
            "social-delete-block requires exactly --clients "
            + ",".join(EXPECTED_CLIENTS)
        )
    if context.budget_seconds != EXPECTED_BUDGET_SECONDS:
        raise RunnerError(
            "social-delete-block requires exactly --budget-seconds 1200"
        )
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
                f"social-delete-block client {client_id!r} must bind "
                f"{actor_role!r} to a Native Tauri runtime"
            )


def _identity(client: AttachedProductClient, label: str) -> str:
    result = _mapping(
        client.call("acceptanceActorIdentity"),
        f"{label} identity",
    )
    actor_ptid = result.get("actorPtid")
    if not isinstance(actor_ptid, str) or not actor_ptid:
        raise RunnerError(
            f"social-delete-block {label} identity is missing"
        )
    return actor_ptid


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
        raise RunnerError(
            f"social-delete-block {label} remained UNKNOWN_COMMIT"
        )
    post_id = result.get("transientPostId")
    _require(
        result.get("state") == "PUBLISHED"
        and isinstance(post_id, str)
        and bool(post_id),
        f"social-delete-block {label} did not publish",
    )
    return post_id


def _assert_ready(
    client: AttachedProductClient,
    post_id: str,
    text: str,
    *,
    open_media: bool = False,
) -> Mapping[str, Any]:
    projection = _mapping(
        client.call(
            "readPrivateMoment",
            {"postId": post_id, "openMedia": open_media},
        ),
        "authorized projection",
    )
    _require(
        projection.get("state") == "CONTENT_READY"
        and projection.get("textSha256") == _sha256(text),
        "social-delete-block authorized projection differs",
    )
    return projection


def _assert_revoked(
    client: AttachedProductClient,
    post_id: str,
    *,
    label: str,
) -> Mapping[str, Any]:
    projection = _mapping(
        client.call("readPrivateMoment", {"postId": post_id}),
        f"{label} revoked projection",
    )
    _require(
        projection.get("state")
        in {"DELETED_OR_REVOKED", "NOT_FOUND_OR_NOT_AUTHORIZED"}
        and projection.get("contentKind") is None
        and projection.get("media") == [],
        f"social-delete-block {label} retained private content",
    )
    return projection


def _execute(context: ScenarioContext) -> Mapping[str, Any]:
    _require_runtime_binding(context)
    image_path = context.write_artifact_bytes(
        "w8-delete-private-image.png",
        PNG_BYTES,
        durable=False,
    )
    with ExitStack() as stack:
        stack.callback(image_path.unlink, missing_ok=True)
        alice = stack.enter_context(
            AttachedProductClient(context, EXPECTED_CLIENTS[0])
        )
        bob = stack.enter_context(
            AttachedProductClient(context, EXPECTED_CLIENTS[1])
        )
        eve = stack.enter_context(
            AttachedProductClient(context, EXPECTED_CLIENTS[2])
        )
        alice_ptid = _identity(alice, "Alice")
        bob_ptid = _identity(bob, "Bob")
        _identity(eve, "Eve")
        authority = _mapping(
            alice.call("friendshipAuthority"),
            "friendship authority",
        )
        home_station_peer_id = authority.get("homeStationPeerId")
        _require(
            isinstance(home_station_peer_id, str)
            and bool(home_station_peer_id),
            "social-delete-block Home Station identity is missing",
        )

        deleted_text = "secure-content-w8-delete-private-image"
        deleted_post_id = _publish(
            alice,
            {
                "draftId": "w8-delete-private-image",
                "revision": 1,
                "text": deleted_text,
                "audienceKind": "FRIENDS",
                "momentKind": "IMAGE",
                "files": [{
                    "intentId": "w8-delete-private-image",
                    "filePath": str(image_path),
                }],
            },
            label="delete",
        )
        before_delete = _assert_ready(
            bob,
            deleted_post_id,
            deleted_text,
            open_media=True,
        )
        media = before_delete.get("media")
        _require(
            isinstance(media, list)
            and len(media) == 1
            and isinstance(media[0], Mapping)
            and media[0].get("state") == "MEDIA_READY"
            and media[0].get("plaintextSha256") == _sha256(PNG_BYTES),
            "social-delete-block pre-delete media is not ready",
        )
        deletion = _mapping(
            alice.call(
                "deletePrivateMoment",
                {"postId": deleted_post_id},
            ),
            "delete result",
        )
        _require(
            deletion.get("deleted") is True
            and deletion.get("localProjectionPresent") is False,
            "social-delete-block author deletion did not clear local state",
        )
        _assert_revoked(bob, deleted_post_id, label="delete")

        blocked_text = "secure-content-w8-block-private-text"
        blocked_post_id = _publish(
            alice,
            {
                "draftId": "w8-block-private-text",
                "revision": 1,
                "text": blocked_text,
                "audienceKind": "FRIENDS",
                "momentKind": "TEXT",
            },
            label="block",
        )
        _assert_ready(bob, blocked_post_id, blocked_text)
        block = _mapping(
            alice.call(
                "blockActor",
                {
                    "actorPtid": bob_ptid,
                    "homeStationPeerId": home_station_peer_id,
                    "observedRevision": 0,
                },
            ),
            "block result",
        )
        _require(
            block.get("state") == "BLOCKED"
            and block.get("revision") == 1
            and block.get("interactionAllowed") is False
            and block.get("targetActorPtidSha256") == _sha256(bob_ptid),
            "social-delete-block canonical block did not commit",
        )
        _assert_revoked(bob, blocked_post_id, label="block")
        recovery = _mapping(
            bob.call(
                "recoverPrivateMoment",
                {"postId": blocked_post_id},
            ),
            "blocked recovery",
        )
        _require(
            recovery.get("state")
            in {"DELETED_OR_REVOKED", "NOT_FOUND_OR_NOT_AUTHORIZED"},
            "social-delete-block recovery bypassed the block",
        )

        unblock = _mapping(
            alice.call(
                "unblockActor",
                {
                    "actorPtid": bob_ptid,
                    "homeStationPeerId": home_station_peer_id,
                    "observedRevision": 1,
                },
            ),
            "unblock result",
        )
        _require(
            unblock.get("state") == "UNBLOCKED"
            and unblock.get("revision") == 2
            and unblock.get("interactionAllowed") is True,
            "social-delete-block canonical unblock did not commit",
        )
        _assert_revoked(bob, blocked_post_id, label="unblock")

        for client in (alice, bob, eve):
            client.call("clearLocalState")

    return {
        "authorPtidSha256": _sha256(alice_ptid),
        "delete": {
            "priorMediaReady": True,
            "authorProjectionCleared": True,
            "futureDetailDenied": True,
        },
        "block": {
            "signedCommandCommitted": True,
            "futureDetailDenied": True,
            "futureRecoveryDenied": True,
            "unblockDoesNotRestorePriorGrant": True,
        },
        "maliciousCopyDeletionClaimed": False,
    }


SCENARIO = ScenarioDefinition(
    scenario_id="social-delete-block",
    journey_id="sc-dj-social-expansion",
    work_item_id="secure-content-w8",
    runtimes=frozenset({"desktop"}),
    evidence_path=Path("W8/delete-block/result.json"),
    execute=_execute,
    result_prefix=Path("W8"),
    result_task_id="W8",
    result_workstream_id="W8",
    result_variant="delete-block",
)
