from __future__ import annotations

import hashlib
import time
from contextlib import ExitStack
from pathlib import Path
from typing import Any, Mapping

from tooling.acceptance.core.harness import call_async_harness
from tooling.development.secure_content.attached_client import (
    AttachedProductClient,
    reconcile_private_moment_publish,
)
from tooling.development.secure_content.run import (
    RunnerError,
    ScenarioContext,
    ScenarioDefinition,
)


EXPECTED_PROFILES = ("four", "fiveArm")
LOCAL_CLIENTS = (
    "secure-content-desktop-alice",
    "secure-content-desktop-bob",
    "secure-content-desktop-eve",
)
REMOTE_CLIENT = "secure-content-desktop-remote-recipient"
EXPECTED_CLIENTS = LOCAL_CLIENTS
REMOTE_RECIPIENT_CAPABILITY = "remote-private-recipient"
REMOTE_RECIPIENT_OPERATION = "resolve"
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
    if context.profile is not None or context.profiles != EXPECTED_PROFILES:
        raise RunnerError(
            "social-expansion requires exactly "
            "--profile four --secondary-profile fiveArm"
        )
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
    for client_id, actor_role, service_id in (
        (LOCAL_CLIENTS[0], "alice", "station-four"),
        (LOCAL_CLIENTS[1], "bob", "station-four"),
        (LOCAL_CLIENTS[2], "eve", "station-four"),
    ):
        client = manifest.client(client_id)
        station_binding = _mapping(
            client.get("service_bindings"),
            f"{client_id} service bindings",
        ).get("station")
        if (
            client.get("actor_role") != actor_role
            or client.get("runtime_kind") != "native-tauri"
            or not isinstance(station_binding, Mapping)
            or station_binding.get("service_id") != service_id
        ):
            raise RunnerError(
                f"social-expansion client {client_id!r} must bind "
                f"{actor_role!r} to {service_id!r} through Native Tauri"
            )
    handle = context.fixture_handle(REMOTE_RECIPIENT_CAPABILITY)
    if handle.owner != "actor-identity-provisioner":
        raise RunnerError(
            "social-expansion remote recipient must be Actor Identity-owned"
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


def _chat_action(
    client: AttachedProductClient,
    method: str,
    payload: Mapping[str, Any],
) -> Mapping[str, Any]:
    client.snapshot()
    try:
        result = call_async_harness(
            client.driver,
            method,
            dict(payload),
            namespace="chat",
            script_timeout=min(45.0, client.context.remaining_seconds()),
        )
    finally:
        client.snapshot()
    return _mapping(result, f"Chat {method}")

def _wait_for_group_member(
    client: AttachedProductClient,
    *,
    group_id: str,
    member_ptid: str,
) -> Mapping[str, Any]:
    deadline = time.monotonic() + min(
        30.0,
        client.context.remaining_seconds(),
    )
    while time.monotonic() < deadline:
        snapshot = _chat_action(
            client,
            "groupLifecycleSnapshot",
            {"groupUlid": group_id},
        )
        members = snapshot.get("members")
        if isinstance(members, list) and any(
            isinstance(member, Mapping)
            and member.get("ptid") == member_ptid
            for member in members
        ):
            return snapshot
        time.sleep(
            min(
                0.25,
                max(0.0, deadline - time.monotonic()),
            )
        )
    raise RunnerError(
        "social-expansion remote Group membership did not become authoritative"
    )


def _stage_draft(
    publisher: AttachedProductClient,
    *,
    draft_id: str,
    text: str,
    audience_kind: str,
    circle_id: str | None = None,
    group_conversation_id: str | None = None,
    base_kind: str | None = None,
    actor_ptids: tuple[str, ...] = (),
) -> Mapping[str, Any]:
    payload: dict[str, Any] = {
        "draftId": draft_id,
        "revision": 1,
        "text": text,
        "audienceKind": audience_kind,
        "baseKind": base_kind,
        "actorPtids": list(actor_ptids),
        "momentKind": "TEXT",
    }
    if circle_id is not None:
        payload["circleId"] = circle_id
    if group_conversation_id is not None:
        payload["groupConversationId"] = group_conversation_id
    staged = _mapping(
        publisher.call("stagePrivateDraft", payload),
        f"{audience_kind} staged draft",
    )
    _require(
        staged.get("present") is True
        and staged.get("audienceKind") == audience_kind
        and staged.get("textSha256") == _sha256(text),
        f"social-expansion {audience_kind} draft did not preserve intent",
    )
    return staged


def _stage_publish(
    publisher: AttachedProductClient,
    *,
    draft_id: str,
    text: str,
    audience_kind: str,
    circle_id: str | None = None,
    group_conversation_id: str | None = None,
    base_kind: str | None = None,
    actor_ptids: tuple[str, ...] = (),
) -> str:
    _stage_draft(
        publisher,
        draft_id=draft_id,
        text=text,
        audience_kind=audience_kind,
        circle_id=circle_id,
        group_conversation_id=group_conversation_id,
        base_kind=base_kind,
        actor_ptids=actor_ptids,
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


def _stage_rejected_publish(
    publisher: AttachedProductClient,
    *,
    draft_id: str,
    text: str,
    audience_kind: str,
    group_conversation_id: str | None = None,
    base_kind: str | None = None,
    actor_ptids: tuple[str, ...] = (),
    acceptance_unsupported_probe: bool = False,
) -> None:
    if acceptance_unsupported_probe:
        rejected_method = "publishUnsupportedCustomDenyPublic"
        rejected_payload = {
            "draftId": draft_id,
            "revision": 1,
            "text": text,
            "audienceKind": audience_kind,
            "baseKind": base_kind,
            "actorPtids": list(actor_ptids),
            "momentKind": "TEXT",
        }
    else:
        _stage_draft(
            publisher,
            draft_id=draft_id,
            text=text,
            audience_kind=audience_kind,
            group_conversation_id=group_conversation_id,
            base_kind=base_kind,
            actor_ptids=actor_ptids,
        )
        rejected_method = "publishPrivateDraft"
        rejected_payload = None
    if rejected_payload is None:
        rejected_result = reconcile_private_moment_publish(
            publisher,
            rejected_method,
            label=f"social-expansion {draft_id} rejection",
        )
    else:
        rejected_result = publisher.call(rejected_method, rejected_payload)
    rejected = _mapping(rejected_result, f"{draft_id} rejection")
    _require(
        rejected.get("state") == "PRIVATE_UNSUPPORTED"
        and rejected.get("errorCode") == "PRIVATE_UNSUPPORTED",
        f"social-expansion {draft_id} did not reject as PRIVATE_UNSUPPORTED",
    )
    evidence = _mapping(
        rejected.get("rejectionEvidence"),
        f"{draft_id} rejection evidence",
    )
    _require(
        evidence.get("publishPhase") == "PREPARE_REJECTED"
        and evidence.get("prepareSucceeded") is False
        and evidence.get("receivedPreparePlanCount") == 0
        and evidence.get("claimCountScope") == "NATIVE_RECEIVED_PREPARE_PLAN",
        f"social-expansion {draft_id} did not prove its Native prepare boundary",
    )
    _require(
        evidence.get("desktopLocalDurableRowCount") == 0
        and evidence.get("partialRowScope") == "DESKTOP_LOCAL_DURABLE_STATE"
        and evidence.get("serverWriteProof") == "STATION_SOURCE_TEST_REQUIRED"
        and not rejected.get("transientPostId"),
        f"social-expansion {draft_id} left Desktop-local durable state",
    )


def _remote_recipient(
    context: ScenarioContext,
) -> tuple[str, str, str, str, str]:
    acknowledgement = context.invoke_fixture_action(
        REMOTE_RECIPIENT_CAPABILITY,
        REMOTE_RECIPIENT_OPERATION,
    )
    outcome = _mapping(
        acknowledgement.get("outcome"),
        "remote recipient fixture outcome",
    )
    actor_ptid = outcome.get("actorPtid")
    home_station_digest = outcome.get("homeStationPeerIdSha256")
    federation_id = outcome.get("federationId")
    federation_digest = outcome.get("federationIdSha256")
    remote_group_ulid = outcome.get("remoteGroupUlid")
    if (
        not isinstance(actor_ptid, str)
        or not actor_ptid
        or outcome.get("profileId") != "fiveArm"
        or outcome.get("serviceId") != "station-five-arm"
        or not isinstance(home_station_digest, str)
        or len(home_station_digest) != 64
        or any(
            character not in "0123456789abcdef"
            for character in home_station_digest
        )
        or not isinstance(federation_digest, str)
        or len(federation_digest) != 64
        or any(
            character not in "0123456789abcdef"
            for character in federation_digest
        )
        or not isinstance(federation_id, str)
        or not federation_id
        or _sha256(federation_id) != federation_digest
        or not isinstance(remote_group_ulid, str)
        or not remote_group_ulid
    ):
        raise RunnerError(
            "social-expansion remote recipient fixture is not fiveArm-bound"
        )
    acknowledgement_digest = acknowledgement.get("acknowledgementDigest")
    if (
        not isinstance(acknowledgement_digest, str)
        or len(acknowledgement_digest) != 64
        or any(
            character not in "0123456789abcdef"
            for character in acknowledgement_digest
        )
    ):
        raise RunnerError(
            "social-expansion remote recipient acknowledgement is missing"
        )
    return (
        actor_ptid,
        federation_id,
        acknowledgement_digest,
        federation_digest,
        remote_group_ulid,
    )


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
            AttachedProductClient(context, LOCAL_CLIENTS[0])
        )
        bob = stack.enter_context(
            AttachedProductClient(context, LOCAL_CLIENTS[1])
        )
        eve = stack.enter_context(
            AttachedProductClient(context, LOCAL_CLIENTS[2])
        )
        for client, label in (
            (alice, "Alice"),
            (bob, "Bob"),
            (eve, "Eve"),
        ):
            snapshot = _mapping(client.snapshot(), f"{label} snapshot")
            _require(
                snapshot.get("platform") == "native",
                f"social-expansion {label} is not a Native client",
            )

        alice_ptid = _identity(alice, "Alice")
        bob_ptid = _identity(bob, "Bob")
        eve_ptid = _identity(eve, "Eve")
        (
            remote_ptid,
            federation_id,
            remote_acknowledgement_digest,
            remote_federation_digest,
            remote_group_id,
        ) = _remote_recipient(context)

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
            circle_id=circle_id,
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

        same_station_group = _mapping(
            _chat_action(
                alice,
                "createGroup",
                {
                    "name": "secure-content-w8-local-group",
                    "federationId": federation_id,
                    "memberPtids": [bob_ptid],
                },
            ),
            "same-Station Group creation",
        )
        same_station_group_id = same_station_group.get("groupUlid")
        _require(
            isinstance(same_station_group_id, str)
            and bool(same_station_group_id),
            "social-expansion same-Station Group identity is invalid",
        )
        group_text = "secure-content-w8-audience-group"
        group_post_id = _stage_publish(
            alice,
            draft_id="w8-audience-group",
            text=group_text,
            audience_kind="GROUP",
            group_conversation_id=same_station_group_id,
        )
        _assert_read(
            bob,
            post_id=group_post_id,
            text=group_text,
            audience_kind="GROUP",
            authorized=True,
        )
        _assert_read(
            eve,
            post_id=group_post_id,
            text=group_text,
            audience_kind="GROUP",
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

        _stage_rejected_publish(
            alice,
            draft_id="w8-audience-custom-deny-public",
            text="secure-content-w8-audience-custom-deny-public",
            audience_kind="CUSTOM_DENY",
            base_kind="PUBLIC",
            actor_ptids=(eve_ptid,),
            acceptance_unsupported_probe=True,
        )
        _stage_rejected_publish(
            alice,
            draft_id="w8-audience-remote-explicit",
            text="secure-content-w8-audience-remote-explicit",
            audience_kind="CUSTOM_ALLOW",
            actor_ptids=(remote_ptid,),
        )

        _wait_for_group_member(
            alice,
            group_id=remote_group_id,
            member_ptid=remote_ptid,
        )
        _stage_rejected_publish(
            alice,
            draft_id="w8-audience-remote-group",
            text="secure-content-w8-audience-remote-group",
            audience_kind="GROUP",
            group_conversation_id=remote_group_id,
        )

    return {
        "supportedAudiences": (
            "FRIENDS",
            "FOLLOWERS",
            "SELF",
            "CIRCLE",
            "GROUP",
            "CUSTOM_ALLOW",
            "CUSTOM_DENY(FOLLOWERS)",
        ),
        "rejectedAudiences": (
            "CUSTOM_DENY(PUBLIC)",
            "CUSTOM_ALLOW(remote)",
            "GROUP(remote)",
        ),
        "remoteRecipientAcknowledgementDigest": (
            remote_acknowledgement_digest
        ),
        "remoteRecipientFederationIdSha256": remote_federation_digest,
        "nativeReceivedPreparePlansForRejectedPublishes": 0,
        "desktopLocalDurableRowsForRejectedPublishes": 0,
        "stationZeroMutationEvidence": "SOURCE_CHECK_REQUIRED",
    }


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
    required_fixture_capabilities=frozenset(
        {REMOTE_RECIPIENT_CAPABILITY}
    ),
)
