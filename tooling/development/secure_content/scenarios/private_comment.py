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
POST_TEXT = "secure-content-w8-private-comment-parent"
COMMENT_TEXT = "secure-content-w8-private-comment-body"


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise RunnerError(message)


def _mapping(value: Any, field: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise RunnerError(f"private-comment {field} is invalid")
    return value


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _require_runtime_binding(context: ScenarioContext) -> None:
    if context.runtime_manifest is None:
        context.block(
            "private-comment requires an immutable external runtime manifest",
            kind="DRIVER_FAILED",
            owner="secure-content-w8-runtime",
            retryable=True,
        )
    if context.runtime != "desktop":
        raise RunnerError("private-comment requires the desktop runtime")
    if (
        context.profile != EXPECTED_PROFILE
        or context.profiles != (EXPECTED_PROFILE,)
    ):
        raise RunnerError("private-comment requires exactly --profile four")
    if context.clients != EXPECTED_CLIENTS:
        raise RunnerError(
            "private-comment requires exactly --clients "
            + ",".join(EXPECTED_CLIENTS)
        )
    if context.budget_seconds != EXPECTED_BUDGET_SECONDS:
        raise RunnerError(
            "private-comment requires exactly --budget-seconds 1200"
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
                f"private-comment client {client_id!r} must bind "
                f"{actor_role!r} to a Native Tauri runtime"
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

        staged = _mapping(
            alice.call(
                "stageFriendsDraft",
                {
                    "draftId": (
                        "w8-comment-parent-"
                        + context.require_runtime_manifest().sha256[:16]
                    ),
                    "revision": 1,
                    "text": POST_TEXT,
                },
            ),
            "parent draft",
        )
        _require(
            staged.get("present") is True
            and staged.get("textSha256") == _sha256(POST_TEXT),
            "Alice private Comment parent draft did not preserve intent",
        )
        published = _mapping(
            reconcile_private_moment_publish(
                alice,
                "publishFriendsDraft",
                label="Alice private Comment parent publish",
            ),
            "parent publish",
        )
        post_id = published.get("transientPostId")
        _require(
            published.get("state") == "PUBLISHED"
            and isinstance(post_id, str)
            and bool(post_id),
            "Alice private Comment parent did not publish",
        )

        bob_parent = _mapping(
            bob.call("readPrivateMoment", {"postId": post_id}),
            "Bob parent read",
        )
        _require(
            bob_parent.get("state") == "CONTENT_READY"
            and bob_parent.get("textSha256") == _sha256(POST_TEXT),
            "Bob could not open the private Comment parent",
        )
        submitted = _mapping(
            bob.call(
                "submitPrivateComment",
                {"postId": post_id, "text": COMMENT_TEXT},
            ),
            "Bob private Comment submit",
        )
        _require(
            submitted.get("state") == "COMMENT_POSTED"
            and submitted.get("postIdSha256") == _sha256(post_id)
            and submitted.get("textSha256") == _sha256(COMMENT_TEXT),
            "Bob private Comment did not reach COMMENT_POSTED",
        )

        alice_thread = _mapping(
            alice.call(
                "readPrivateComments",
                {"postId": post_id, "refresh": True},
            ),
            "Alice private Comment thread",
        )
        alice_comments = alice_thread.get("comments")
        _require(
            isinstance(alice_comments, list)
            and any(
                isinstance(comment, Mapping)
                and comment.get("state") == "COMMENT_POSTED"
                and comment.get("postIdSha256") == _sha256(post_id)
                and comment.get("textSha256") == _sha256(COMMENT_TEXT)
                for comment in alice_comments
            ),
            "Alice did not receive Bob's exact private Comment",
        )

        eve_parent = _mapping(
            eve.call("readPrivateMoment", {"postId": post_id}),
            "Eve parent denial",
        )
        eve_thread = _mapping(
            eve.call(
                "readPrivateComments",
                {"postId": post_id, "refresh": True},
            ),
            "Eve private Comment denial",
        )
        _require(
            eve_parent.get("state") == "NOT_FOUND_OR_NOT_AUTHORIZED",
            "Eve private parent read did not fail closed",
        )
        _require(
            eve_thread.get("state") == "COMMENT_PARENT_UNAVAILABLE"
            and eve_thread.get("comments") == [],
            "Eve private Comment read exposed a receiver projection",
        )

        for client in (alice, bob, eve):
            client.call("clearLocalState")

    return {
        "observations": {
            "aliceParentPublished": True,
            "bobParentReadable": True,
            "bobCommentPosted": True,
            "aliceExactCommentReadable": True,
            "eveParentDenied": True,
            "eveCommentDenied": True,
        },
        "contentDigests": {
            "postIdSha256": _sha256(post_id),
            "postTextSha256": _sha256(POST_TEXT),
            "commentTextSha256": _sha256(COMMENT_TEXT),
        },
        "acceptanceMapping": {
            "journey": "SOC-SEC-J05",
            "scenario": "SOC-SEC-AS06",
            "formalAcceptance": "NOT_RUN",
        },
    }


SCENARIO = ScenarioDefinition(
    scenario_id="private-comment",
    journey_id="sc-dj-social-expansion",
    work_item_id="secure-content-w8",
    runtimes=frozenset({"desktop"}),
    evidence_path=Path("W8/comment/result.json"),
    execute=_execute,
    result_prefix=Path("W8"),
    result_task_id="W8",
    result_workstream_id="W8",
    result_variant="comment",
)
