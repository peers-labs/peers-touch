from __future__ import annotations

import hashlib
from contextlib import ExitStack
from pathlib import Path
from typing import Any, Mapping

from tooling.development.secure_content.attached_client import (
    AttachedProductClient,
    reconcile_private_moment_publish,
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


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise RunnerError(message)


def _mapping(value: Any, field: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise RunnerError(f"social-expansion {field} is invalid")
    return value


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _require_runtime_binding(context: ScenarioContext) -> None:
    if context.runtime_manifest is None:
        context.block(
            "social-expansion requires an immutable external runtime manifest",
            kind="DRIVER_FAILED",
            owner="secure-content-w8-runtime",
            retryable=True,
        )
    if context.runtime != "desktop":
        raise RunnerError("social-expansion requires the desktop runtime")
    if (
        context.profile != EXPECTED_PROFILE
        or context.profiles != (EXPECTED_PROFILE,)
    ):
        raise RunnerError("social-expansion requires exactly --profile four")
    if context.clients != EXPECTED_CLIENTS:
        raise RunnerError(
            "social-expansion requires exactly --clients "
            + ",".join(EXPECTED_CLIENTS)
        )
    if context.budget_seconds != EXPECTED_BUDGET_SECONDS:
        raise RunnerError(
            "social-expansion requires exactly --budget-seconds 1200"
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
                f"social-expansion client {client_id!r} must bind "
                f"{actor_role!r} to a Native Tauri runtime"
            )


def _identity(client: AttachedProductClient, label: str) -> str:
    result = _mapping(
        client.call("acceptanceActorIdentity"),
        f"{label} identity",
    )
    actor_ptid = result.get("actorPtid")
    if not isinstance(actor_ptid, str) or not actor_ptid:
        raise RunnerError(f"social-expansion {label} identity is missing")
    return actor_ptid


def _stage_publish(
    publisher: AttachedProductClient,
    *,
    draft_id: str,
    text: str,
    audience_kind: str,
    target_id: str | None = None,
    base_kind: str | None = None,
    actor_ptids: tuple[str, ...] = (),
) -> str:
    staged = _mapping(
        publisher.call(
            "stagePrivateDraft",
            {
                "draftId": draft_id,
                "revision": 1,
                "text": text,
                "audienceKind": audience_kind,
                "targetId": target_id,
                "baseKind": base_kind,
                "actorPtids": list(actor_ptids),
                "momentKind": "TEXT",
            },
        ),
        f"{audience_kind} staged draft",
    )
    _require(
        staged.get("present") is True
        and staged.get("audienceKind") == audience_kind
        and staged.get("textSha256") == _sha256(text),
        f"social-expansion {audience_kind} draft did not preserve intent",
    )
    published = _mapping(
        reconcile_private_moment_publish(
            publisher,
            "publishPrivateDraft",
            label=f"social-expansion {audience_kind} publish",
        ),
        f"{audience_kind} publish",
    )
    post_id = published.get("transientPostId")
    _require(
        published.get("state") == "PUBLISHED"
        and isinstance(post_id, str)
        and bool(post_id),
        f"social-expansion {audience_kind} did not publish",
    )
    return post_id


def _assert_read(
    client: AttachedProductClient,
    *,
    post_id: str,
    text: str,
    audience_kind: str,
    authorized: bool,
) -> None:
    projection = _mapping(
        client.call("readPrivateMoment", {"postId": post_id}),
        f"{audience_kind} receiver projection",
    )
    if authorized:
        _require(
            projection.get("state") == "CONTENT_READY"
            and projection.get("audienceKind") == audience_kind
            and projection.get("textSha256") == _sha256(text),
            f"social-expansion {audience_kind} receiver projection differs",
        )
        return
    _require(
        projection.get("state") == "NOT_FOUND_OR_NOT_AUTHORIZED",
        f"social-expansion {audience_kind} unauthorized read did not fail closed",
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
        for client, label in ((alice, "Alice"), (bob, "Bob"), (eve, "Eve")):
            snapshot = _mapping(client.snapshot(), f"{label} snapshot")
            _require(
                snapshot.get("platform") == "native",
                f"social-expansion {label} is not a Native client",
            )

        alice_ptid = _identity(alice, "Alice")
        bob_ptid = _identity(bob, "Bob")
        eve_ptid = _identity(eve, "Eve")

        bob.call("followActor", {"actorPtid": alice_ptid})
        friends_text = "secure-content-w8-audience-friends"
        friends_id = _stage_publish(
            alice,
            draft_id="w8-audience-friends",
            text=friends_text,
            audience_kind="FRIENDS",
        )
        _assert_read(
            bob,
            post_id=friends_id,
            text=friends_text,
            audience_kind="FRIENDS",
            authorized=True,
        )
        _assert_read(
            eve,
            post_id=friends_id,
            text=friends_text,
            audience_kind="FRIENDS",
            authorized=False,
        )

        followers_text = "secure-content-w8-audience-followers"
        followers_id = _stage_publish(
            alice,
            draft_id="w8-audience-followers",
            text=followers_text,
            audience_kind="FOLLOWERS",
        )
        _assert_read(
            bob,
            post_id=followers_id,
            text=followers_text,
            audience_kind="FOLLOWERS",
            authorized=True,
        )
        _assert_read(
            eve,
            post_id=followers_id,
            text=followers_text,
            audience_kind="FOLLOWERS",
            authorized=False,
        )

        self_text = "secure-content-w8-audience-self"
        self_id = _stage_publish(
            alice,
            draft_id="w8-audience-self",
            text=self_text,
            audience_kind="SELF",
        )
        _assert_read(
            alice,
            post_id=self_id,
            text=self_text,
            audience_kind="SELF",
            authorized=True,
        )
        _assert_read(
            bob,
            post_id=self_id,
            text=self_text,
            audience_kind="SELF",
            authorized=False,
        )

        circle = _mapping(
            alice.call(
                "createAudienceCircle",
                {"name": "secure-content-w8-audience"},
            ),
            "Circle creation",
        )
        circle_id = circle.get("circleId")
        _require(
            isinstance(circle_id, str) and circle_id.isdigit(),
            "social-expansion Circle identity is invalid",
        )
        alice.call(
            "addAudienceCircleMember",
            {"circleId": circle_id, "actorPtid": bob_ptid},
        )
        circle_text = "secure-content-w8-audience-circle"
        circle_post_id = _stage_publish(
            alice,
            draft_id="w8-audience-circle",
            text=circle_text,
            audience_kind="CIRCLE",
            target_id=circle_id,
        )
        _assert_read(
            bob,
            post_id=circle_post_id,
            text=circle_text,
            audience_kind="CIRCLE",
            authorized=True,
        )
        _assert_read(
            eve,
            post_id=circle_post_id,
            text=circle_text,
            audience_kind="CIRCLE",
            authorized=False,
        )

        custom_text = "secure-content-w8-audience-custom-allow"
        custom_id = _stage_publish(
            alice,
            draft_id="w8-audience-custom-allow",
            text=custom_text,
            audience_kind="CUSTOM_ALLOW",
            actor_ptids=(bob_ptid,),
        )
        _assert_read(
            bob,
            post_id=custom_id,
            text=custom_text,
            audience_kind="CUSTOM_ALLOW",
            authorized=True,
        )
        _assert_read(
            eve,
            post_id=custom_id,
            text=custom_text,
            audience_kind="CUSTOM_ALLOW",
            authorized=False,
        )

        eve.call("followActor", {"actorPtid": alice_ptid})
        deny_text = "secure-content-w8-audience-custom-deny"
        deny_id = _stage_publish(
            alice,
            draft_id="w8-audience-custom-deny",
            text=deny_text,
            audience_kind="CUSTOM_DENY",
            base_kind="FOLLOWERS",
            actor_ptids=(eve_ptid,),
        )
        _assert_read(
            bob,
            post_id=deny_id,
            text=deny_text,
            audience_kind="CUSTOM_DENY",
            authorized=True,
        )
        _assert_read(
            eve,
            post_id=deny_id,
            text=deny_text,
            audience_kind="CUSTOM_DENY",
            authorized=False,
        )

        alice.call("clearLocalState")
        bob.call("clearLocalState")
        eve.call("clearLocalState")

    context.block(
        (
            "DESIGN_AMENDMENT_REQUIRED: Audience.GROUP target_id is uint64 "
            "while canonical Conversation group IDs are string identities; "
            "CUSTOM_DENY(PUBLIC) has no complete federated PUBLIC actor "
            "authority for freezing recipients; "
            "the runtime manifest also supplies no production remote-recipient "
            "identity handle. The Social expansion scenario will not invent "
            "either fixture or claim the remaining comment/subtype/delete/"
            "bounds slices"
        ),
        kind="DESIGN_AMENDMENT_REQUIRED",
        owner="secure-content-architecture-owner",
        retryable=False,
    )
    raise AssertionError("unreachable after design blocker")


SCENARIO = ScenarioDefinition(
    scenario_id="social-expansion",
    journey_id="sc-dj-social-expansion",
    work_item_id="secure-content-w8",
    runtimes=frozenset({"desktop"}),
    evidence_path=Path("W8/audience/result.json"),
    execute=_execute,
    result_prefix=Path("W8"),
    result_task_id="W8",
    result_workstream_id="W8",
    result_variant="audience",
)
