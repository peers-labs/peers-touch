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
MP4_BYTES = (
    b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom"
    b"secure-content-w8-video"
)


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise RunnerError(message)


def _mapping(value: Any, field: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise RunnerError(f"social-subtype {field} is invalid")
    return value


def _sha256(value: bytes | str) -> str:
    payload = value.encode("utf-8") if isinstance(value, str) else value
    return hashlib.sha256(payload).hexdigest()


def _require_runtime_binding(context: ScenarioContext) -> None:
    if context.runtime_manifest is None:
        context.block(
            "social-subtype requires an immutable external runtime manifest",
            kind="DRIVER_FAILED",
            owner="secure-content-w8-runtime",
            retryable=True,
        )
    if context.runtime != "desktop":
        raise RunnerError("social-subtype requires the desktop runtime")
    if (
        context.profile != EXPECTED_PROFILE
        or context.profiles != (EXPECTED_PROFILE,)
    ):
        raise RunnerError("social-subtype requires exactly --profile four")
    if context.clients != EXPECTED_CLIENTS:
        raise RunnerError(
            "social-subtype requires exactly --clients "
            + ",".join(EXPECTED_CLIENTS)
        )
    if context.budget_seconds != EXPECTED_BUDGET_SECONDS:
        raise RunnerError(
            "social-subtype requires exactly --budget-seconds 1200"
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
                f"social-subtype client {client_id!r} must bind "
                f"{actor_role!r} to a Native Tauri runtime"
            )


def _identity(client: AttachedProductClient, label: str) -> str:
    result = _mapping(
        client.call("acceptanceActorIdentity"),
        f"{label} identity",
    )
    actor_ptid = result.get("actorPtid")
    if not isinstance(actor_ptid, str) or not actor_ptid:
        raise RunnerError(f"social-subtype {label} identity is missing")
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
        raise RunnerError(f"social-subtype {label} remained UNKNOWN_COMMIT")
    post_id = result.get("transientPostId")
    _require(
        result.get("state") == "PUBLISHED"
        and isinstance(post_id, str)
        and bool(post_id),
        f"social-subtype {label} did not publish",
    )
    return post_id


def _read(
    client: AttachedProductClient,
    *,
    post_id: str,
    kind: str,
    text: str,
    open_media: bool = False,
) -> Mapping[str, Any]:
    projection = _mapping(
        client.call(
            "readPrivateMoment",
            {"postId": post_id, "openMedia": open_media},
        ),
        f"{kind} receiver projection",
    )
    _require(
        projection.get("state") == "CONTENT_READY"
        and projection.get("contentKind") == kind
        and projection.get("textSha256") == _sha256(text),
        f"social-subtype {kind} receiver projection differs",
    )
    return projection


def _base_payload(kind: str, text: str) -> dict[str, Any]:
    return {
        "draftId": f"w8-subtype-{kind.lower()}",
        "revision": 1,
        "text": text,
        "audienceKind": "FRIENDS",
        "momentKind": kind,
    }


def _await_reaction_transition(
    client: AttachedProductClient,
    *,
    method: str,
    post_id: str,
    present: bool,
) -> Mapping[str, Any]:
    latest: Mapping[str, Any] = {}
    for attempt in range(20):
        try:
            latest = _mapping(
                client.call(method, {"postId": post_id, "kind": "LOVE"}),
                "Reaction transition",
            )
        except RunnerError as error:
            if "secure content Reaction command is already pending" not in str(
                error
            ):
                raise
            if attempt == 19:
                raise
            time.sleep(min(0.25, client.context.remaining_seconds()))
            continue
        reactions = latest.get("reactions")
        converged = (
            isinstance(reactions, list)
            and (
                (
                    present
                    and len(reactions) == 1
                    and isinstance(reactions[0], Mapping)
                    and reactions[0].get("count") == 1
                    and reactions[0].get("reactedByViewer") is True
                )
                or (not present and reactions == [])
            )
        )
        if converged:
            return latest
        if attempt < 19:
            time.sleep(min(0.25, client.context.remaining_seconds()))
    return latest


def _execute(context: ScenarioContext) -> Mapping[str, Any]:
    _require_runtime_binding(context)
    image_path = context.write_artifact_bytes(
        "w8-subtype-image.png",
        PNG_BYTES,
        durable=False,
    )
    video_path = context.write_artifact_bytes(
        "w8-subtype-video.mp4",
        MP4_BYTES,
        durable=False,
    )
    with ExitStack() as stack:
        stack.callback(image_path.unlink, missing_ok=True)
        stack.callback(video_path.unlink, missing_ok=True)
        alice = stack.enter_context(
            AttachedProductClient(context, EXPECTED_CLIENTS[0])
        )
        bob = stack.enter_context(
            AttachedProductClient(context, EXPECTED_CLIENTS[1])
        )
        eve = stack.enter_context(
            AttachedProductClient(context, EXPECTED_CLIENTS[2])
        )
        for client, label in ((alice, "Alice"), (bob, "Bob"), (eve, "Eve")):
            snapshot = _mapping(client.snapshot(), f"{label} snapshot")
            _require(
                snapshot.get("platform") == "native",
                f"social-subtype {label} is not a Native client",
            )

        bob_ptid = _identity(bob, "Bob")
        cases = [
            ("TEXT", "secure-content-w8-subtype-text", {}),
            (
                "IMAGE",
                "secure-content-w8-subtype-image",
                {
                    "files": [{
                        "intentId": "w8-image-source",
                        "filePath": str(image_path),
                    }]
                },
            ),
            (
                "VIDEO",
                "secure-content-w8-subtype-video",
                {
                    "files": [{
                        "intentId": "w8-video-source",
                        "filePath": str(video_path),
                    }]
                },
            ),
            (
                "LINK",
                "secure-content-w8-subtype-link",
                {
                    "link": {
                        "url": "https://example.test/secure-content",
                        "title": "Secure Content",
                        "description": "private link preview",
                    }
                },
            ),
            (
                "POLL",
                "secure-content-w8-subtype-poll",
                {
                    "poll": {
                        "question": "Choose one",
                        "options": ["First", "Second"],
                        "minChoices": 1,
                        "maxChoices": 1,
                        "expiresAtSeconds": int(time.time()) + 3600,
                    }
                },
            ),
            (
                "LOCATION",
                "secure-content-w8-subtype-location",
                {
                    "location": {
                        "name": "Central Park",
                        "latitude": 40.7829,
                        "longitude": -73.9654,
                        "address": "New York",
                        "placeId": "central-park",
                    }
                },
            ),
        ]
        post_ids: dict[str, str] = {}
        projections: dict[str, Mapping[str, Any]] = {}
        for kind, text, extra in cases:
            post_id = _publish(
                alice,
                {**_base_payload(kind, text), **extra},
                label=kind,
            )
            post_ids[kind] = post_id
            projections[kind] = _read(
                bob,
                post_id=post_id,
                kind=kind,
                text=text,
                open_media=kind in {"IMAGE", "VIDEO"},
            )

        for kind, expected_bytes in (
            ("IMAGE", PNG_BYTES),
            ("VIDEO", MP4_BYTES),
        ):
            media = projections[kind].get("media")
            _require(
                isinstance(media, list)
                and len(media) == 1
                and isinstance(media[0], Mapping)
                and media[0].get("state") == "MEDIA_READY"
                and media[0].get("plaintextSha256")
                == _sha256(expected_bytes),
                f"social-subtype {kind} receiver bytes differ",
            )

        link = _mapping(
            projections["LINK"].get("subtypeEvidence"),
            "LINK evidence",
        )
        _require(
            link.get("urlSha256")
            == _sha256("https://example.test/secure-content")
            and link.get("titleSha256") == _sha256("Secure Content"),
            "social-subtype LINK metadata differs",
        )
        poll = _mapping(
            projections["POLL"].get("subtypeEvidence"),
            "POLL evidence",
        )
        _require(
            poll.get("questionSha256") == _sha256("Choose one")
            and poll.get("optionLabelSha256")
            == [_sha256("First"), _sha256("Second")]
            and poll.get("minChoices") == 1
            and poll.get("maxChoices") == 1,
            "social-subtype POLL metadata differs",
        )
        location = _mapping(
            projections["LOCATION"].get("subtypeEvidence"),
            "LOCATION evidence",
        )
        _require(
            location.get("nameSha256") == _sha256("Central Park")
            and location.get("addressSha256") == _sha256("New York"),
            "social-subtype LOCATION metadata differs",
        )

        mention_text = "@Bob secure mention"
        mention_id = _publish(
            alice,
            {
                **_base_payload("TEXT", mention_text),
                "draftId": "w8-subtype-mention",
                "mentions": [{
                    "actorPtid": bob_ptid,
                    "offset": 1,
                    "length": 3,
                    "display": "Bob",
                }],
            },
            label="MENTION",
        )
        mention = _read(
            bob,
            post_id=mention_id,
            kind="TEXT",
            text=mention_text,
        )
        _require(
            mention.get("mentionCount") == 1
            and mention.get("mentionedActorPtidsSha256")
            == [_sha256(bob_ptid)],
            "social-subtype Mention routing differs",
        )

        repost_text = "secure-content-w8-subtype-repost"
        repost_id = _publish(
            alice,
            {
                **_base_payload("REPOST", repost_text),
                "repost": {"sourcePostId": post_ids["TEXT"]},
            },
            label="REPOST",
        )
        repost = _read(
            bob,
            post_id=repost_id,
            kind="REPOST",
            text=repost_text,
        )
        repost_evidence = _mapping(
            repost.get("subtypeEvidence"),
            "REPOST evidence",
        )
        _require(
            repost_evidence.get("sourcePostIdSha256")
            == _sha256(post_ids["TEXT"])
            and repost_evidence.get("sourceKind") == "TEXT",
            "social-subtype REPOST source differs",
        )

        reacted = _await_reaction_transition(
            bob,
            method="reactToPrivateMoment",
            post_id=post_ids["TEXT"],
            present=True,
        )
        reactions = reacted.get("reactions")
        _require(
            isinstance(reactions, list)
            and len(reactions) == 1
            and isinstance(reactions[0], Mapping)
            and reactions[0].get("count") == 1
            and reactions[0].get("reactedByViewer") is True,
            "social-subtype private Reaction add differs",
        )
        unreacted = _await_reaction_transition(
            bob,
            method="unreactToPrivateMoment",
            post_id=post_ids["TEXT"],
            present=False,
        )
        _require(
            unreacted.get("reactions") == [],
            "social-subtype private Reaction removal differs",
        )

        denied = _mapping(
            eve.call(
                "readPrivateMoment",
                {"postId": post_ids["LINK"]},
            ),
            "Eve subtype denial",
        )
        _require(
            denied.get("state") == "NOT_FOUND_OR_NOT_AUTHORIZED",
            "social-subtype unauthorized receiver did not fail closed",
        )

        for client in (alice, bob, eve):
            client.call("clearLocalState")

    return {
        "subtypes": (
            "TEXT",
            "IMAGE",
            "VIDEO",
            "LINK",
            "POLL",
            "REPOST",
            "LOCATION",
        ),
        "mentionRouting": "EXACT_RECEIVER_COVERAGE",
        "reactionLifecycle": "ADD_REMOVE",
        "imagePlaintextSha256": _sha256(PNG_BYTES),
        "videoPlaintextSha256": _sha256(MP4_BYTES),
    }


SCENARIO = ScenarioDefinition(
    scenario_id="social-subtype",
    journey_id="sc-dj-social-expansion",
    work_item_id="secure-content-w8",
    runtimes=frozenset({"desktop"}),
    evidence_path=Path("W8/subtype/result.json"),
    execute=_execute,
    result_prefix=Path("W8"),
    result_task_id="W8",
    result_workstream_id="W8",
    result_variant="subtype",
)
