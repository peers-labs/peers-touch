from __future__ import annotations

import hashlib
import threading
import time
import unittest
from typing import Any

from tooling.development.secure_content.mobile_fixture import (
    MobileProductionFixture,
)
from tooling.development.secure_content.scenarios.mobile_matrix import (
    PLATFORM_OPERATIONS,
)


class _Session:
    def __init__(
        self,
        *,
        record_publish_states: bool = True,
        endpoint_prekeys: int = 8,
        recovery_prekeys: int | None = 8,
        recipient_prekey_owner: _Session | None = None,
    ) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.publish_state_history = ["AUDIENCE_REQUIRED"]
        self.record_publish_states = record_publish_states
        self.published_drafts: dict[tuple[str, int], str] = {}
        self.endpoint_prekey_capacity = endpoint_prekeys
        self.recovery_prekey_capacity = recovery_prekeys
        self.remaining_content_prekeys = endpoint_prekeys
        self.remaining_recovery_prekeys = recovery_prekeys
        self.recipient_prekey_owner = recipient_prekey_owner

    def append_publish_states(self, *states: str) -> None:
        if self.record_publish_states:
            self.publish_state_history.extend(states)

    def call_action(
        self,
        action: str,
        payload: dict[str, Any] | None = None,
    ) -> Any:
        body = dict(payload or {})
        self.calls.append((action, body))
        if action == "moments.private.snapshot":
            return {
                "active": True,
                "publishStateHistory": list(self.publish_state_history),
                "readStateHistoryByPostId": {
                    "post-1": sorted(PLATFORM_OPERATIONS["read-states"]),
                },
                "commentDrafts": [
                    {"state": state}
                    for state in PLATFORM_OPERATIONS["comment-states"]
                ],
                "comments": [],
                "reads": [
                    {
                        "contentKind": kind,
                        "mediaStates": sorted(
                            PLATFORM_OPERATIONS["media-states"]
                        ),
                    }
                    for kind in PLATFORM_OPERATIONS["subtypes"]
                ],
                "report": {
                    "endpointPrekeysAvailable": (
                        self.remaining_content_prekeys
                    ),
                    "recoveryPrekeysAvailable": (
                        self.remaining_recovery_prekeys
                    ),
                },
            }
        if action == "moments.publish":
            self.append_publish_states(
                "READY_PUBLIC",
                "PUBLISHING",
                "PUBLISHED",
            )
            return {"postId": "public-post-1"}
        if action == "moments.private.publishText":
            audience = body.get("audience")
            if (
                isinstance(audience, dict)
                and audience.get("kind") == "CUSTOM_DENY"
                and audience.get("baseKind") == "PUBLIC"
            ):
                self.append_publish_states(
                    "CHECKING_PRIVATE_READINESS",
                    "PRIVATE_UNSUPPORTED",
                )
                raise RuntimeError("SOCIAL_PRIVATE_UNSUPPORTED")
            actor_ptids = (
                audience.get("actorPtids")
                if isinstance(audience, dict)
                else None
            )
            if isinstance(actor_ptids, list) and len(actor_ptids) > 256:
                self.append_publish_states(
                    "CHECKING_PRIVATE_READINESS",
                    "AUDIENCE_TOO_LARGE",
                )
                raise RuntimeError("AUDIENCE_TOO_LARGE")
            prekey_owner = self.recipient_prekey_owner or self
            if (
                prekey_owner.remaining_content_prekeys == 0
                or prekey_owner.remaining_recovery_prekeys == 0
            ):
                self.append_publish_states(
                    "CHECKING_PRIVATE_READINESS",
                    "RECIPIENT_KEY_UNAVAILABLE",
                )
                raise RuntimeError("SOCIAL_PRIVATE_DEPENDENCY_FAILURE")
            draft_key = (str(body.get("draftId")), int(body.get("draftRevision", 0)))
            text = str(body.get("text"))
            if (
                draft_key in self.published_drafts
                and self.published_drafts[draft_key] != text
            ):
                self.append_publish_states(
                    "CHECKING_PRIVATE_READINESS",
                    "PUBLISH_FAILED",
                )
                raise RuntimeError("private Social draft replay conflict")
            self.published_drafts[draft_key] = text
            prekey_owner.remaining_content_prekeys -= 1
            if prekey_owner.remaining_recovery_prekeys is not None:
                prekey_owner.remaining_recovery_prekeys -= 1
            self.append_publish_states(
                "CHECKING_PRIVATE_READINESS",
                "READY_PRIVATE",
                "PUBLISHING",
                "PUBLISHED",
            )
            return {"state": "PUBLISHED", "postId": "post-1"}
        if action == "moments.private.reconcile":
            self.remaining_content_prekeys = self.endpoint_prekey_capacity
            self.remaining_recovery_prekeys = self.recovery_prekey_capacity
            return {"active": True, "publish": []}
        if action == "moments.private.readText":
            text = (
                "secure-content-ios-to-android"
                if "android" in body.get("postId", "")
                else "secure-content-android-to-ios"
            )
            return {
                "state": "CONTENT_READY",
                "textSha256": hashlib.sha256(text.encode()).hexdigest(),
            }
        if action == "messaging.attachment.stage":
            return {
                "stageId": "stage-1",
                "plaintextSize": 2 * 1024 * 1024 + 257,
                "completed": True,
            }
        if action == "messaging.send":
            return {
                "messageId": "message-1",
                "attachmentIds": ["attachment-1"],
            }
        if action == "messaging.projection.read":
            return {
                "messages": {
                    body.get("conversationId", "direct-1"): [
                        {"messageId": "message-1"}
                    ]
                }
            }
        if action == "messaging.attachment.open":
            return {"state": "ready", "available": True}
        if action == "messaging.createDirect":
            return {"conversationId": "direct-1"}
        if action == "messaging.createGroup":
            return {"conversationId": "group-1"}
        if action == "lifecycle.restart":
            return {"requested": True, "scope": "webview"}
        if action in {
            "moments.private.comment.submit",
            "moments.private.read",
            "moments.private.publish",
            "lifecycle.snapshot",
            "recovery.snapshot",
            "messaging.reconcile",
            "cleanup",
        }:
            return {"active": True}
        raise AssertionError(action)


class _UnknownOutcomeSession(_Session):
    def call_action(
        self,
        action: str,
        payload: dict[str, Any] | None = None,
    ) -> Any:
        body = dict(payload or {})
        if (
            action == "moments.private.publishText"
            and str(body.get("draftId", "")).endswith("-publish")
            and str(body.get("text", "")).endswith("-private")
        ):
            self.calls.append((action, body))
            draft_key = (str(body.get("draftId")), int(body.get("draftRevision", 0)))
            self.published_drafts[draft_key] = str(body.get("text"))
            self.append_publish_states(
                "CHECKING_PRIVATE_READINESS",
                "READY_PRIVATE",
                "PUBLISHING",
            )
            return {
                "draftId": body["draftId"],
                "draftRevision": body["draftRevision"],
                "state": "UNKNOWN_OUTCOME",
                "errorCode": 20005,
            }
        if action == "moments.private.reconcile":
            self.calls.append((action, body))
            self.remaining_content_prekeys = 8
            self.append_publish_states("PUBLISHED")
            return {
                "active": True,
                "publish": [
                    {
                        "draftId": "mobile-ios-publish",
                        "draftRevision": 1,
                        "state": "PUBLISHED",
                        "postId": "post-1",
                    }
                ],
            }
        return super().call_action(action, body)


class MobileProductionFixtureTest(unittest.TestCase):
    def setUp(self) -> None:
        bob = _Session()
        self.sessions = {
            "ios_alice": _Session(recipient_prekey_owner=bob),
            "ios_bob": bob,
        }
        self.fixture = MobileProductionFixture(
            sessions=self.sessions,
            actor_ptids={
                "ios_alice": "ptid:alice",
                "ios_bob": "ptid:bob",
            },
            federation_id="federation-1",
        )

    def invoke(self, operation: str, payload: dict[str, object]):
        return self.fixture.execute(
            operation,
            payload,
            time.monotonic() + 10,
            threading.Event(),
        )

    def test_publish_state_result_is_derived_from_production_actions(
        self,
    ) -> None:
        result = self.invoke(
            "publish-states",
            {
                "variant": "ios",
                "clients": ["ios_alice", "ios_bob"],
            },
        )

        self.assertTrue(result["completed"])
        self.assertEqual(
            set(result["observedStates"]),
            PLATFORM_OPERATIONS["publish-states"],
        )
        self.assertIn(
            "moments.private.publishText",
            [action for action, _ in self.sessions["ios_alice"].calls],
        )
        self.assertIn(
            "moments.publish",
            [action for action, _ in self.sessions["ios_alice"].calls],
        )

    def test_publish_drain_uses_receiver_pool_larger_than_32(self) -> None:
        bob = _Session(endpoint_prekeys=40, recovery_prekeys=40)
        self.sessions = {
            "ios_alice": _Session(recipient_prekey_owner=bob),
            "ios_bob": bob,
        }
        self.fixture = MobileProductionFixture(
            sessions=self.sessions,
            actor_ptids={
                "ios_alice": "ptid:alice",
                "ios_bob": "ptid:bob",
            },
            federation_id="federation-1",
        )

        result = self.invoke(
            "publish-states",
            {
                "variant": "ios",
                "clients": ["ios_alice", "ios_bob"],
            },
        )

        drain_calls = [
            body
            for action, body in self.sessions["ios_alice"].calls
            if action == "moments.private.publishText"
            and "-prekey-drain-" in str(body.get("draftId"))
        ]
        self.assertTrue(result["completed"])
        self.assertEqual(len(drain_calls), 40)

    def test_publish_drain_uses_smaller_recovery_pool(self) -> None:
        bob = _Session(endpoint_prekeys=40, recovery_prekeys=5)
        self.sessions = {
            "ios_alice": _Session(recipient_prekey_owner=bob),
            "ios_bob": bob,
        }
        self.fixture = MobileProductionFixture(
            sessions=self.sessions,
            actor_ptids={
                "ios_alice": "ptid:alice",
                "ios_bob": "ptid:bob",
            },
            federation_id="federation-1",
        )

        self.invoke(
            "publish-states",
            {
                "variant": "ios",
                "clients": ["ios_alice", "ios_bob"],
            },
        )

        drain_calls = [
            body
            for action, body in self.sessions["ios_alice"].calls
            if action == "moments.private.publishText"
            and "-prekey-drain-" in str(body.get("draftId"))
        ]
        self.assertEqual(len(drain_calls), 5)

    def test_one_successful_publish_cannot_satisfy_the_state_matrix(self) -> None:
        self.sessions["ios_alice"] = _Session(
            record_publish_states=False,
            recipient_prekey_owner=self.sessions["ios_bob"],
        )
        self.fixture = MobileProductionFixture(
            sessions=self.sessions,
            actor_ptids={
                "ios_alice": "ptid:alice",
                "ios_bob": "ptid:bob",
            },
            federation_id="federation-1",
        )

        with self.assertRaisesRegex(
            RuntimeError,
            "production action coverage for publish-states is incomplete",
        ):
            self.invoke(
                "publish-states",
                {
                    "variant": "ios",
                    "clients": ["ios_alice", "ios_bob"],
                },
            )

    def test_publish_reconciles_unknown_outcome_before_requiring_post_id(
        self,
    ) -> None:
        self.sessions["ios_alice"] = _UnknownOutcomeSession(
            recipient_prekey_owner=self.sessions["ios_bob"],
        )
        self.fixture = MobileProductionFixture(
            sessions=self.sessions,
            actor_ptids={
                "ios_alice": "ptid:alice",
                "ios_bob": "ptid:bob",
            },
            federation_id="federation-1",
        )

        result = self.invoke(
            "publish-states",
            {
                "variant": "ios",
                "clients": ["ios_alice", "ios_bob"],
            },
        )

        self.assertTrue(result["completed"])
        self.assertEqual(self.fixture._posts["ios"], "post-1")
        self.assertEqual(
            [
                action
                for action, _ in self.sessions["ios_alice"].calls
                if action.startswith("moments.private.")
            ][:2],
            [
                "moments.private.publishText",
                "moments.private.reconcile",
            ],
        )

    def test_chat_corpus_is_staged_and_sent_through_mobile_actions(
        self,
    ) -> None:
        from tooling.development.secure_content.drivers.chat_attachment import (
            corpus_descriptor,
        )

        payload = {
            "platform": "ios",
            "clients": ["ios_alice", "ios_bob"],
            "corpus": corpus_descriptor(),
        }
        prepared = self.invoke("prepare-corpus", payload)
        exact = self.invoke(
            "direct-exact-bytes",
            {
                "platform": "ios",
                "clients": ["ios_alice", "ios_bob"],
                "runHandle": prepared["runHandle"],
                "corpus": corpus_descriptor(),
            },
        )

        self.assertTrue(exact["nativeSenderVisible"])
        self.assertTrue(exact["nativeReceiverVisible"])
        self.assertEqual(
            exact["receiverOpenedSha256"],
            corpus_descriptor()["sha256"],
        )
        self.assertIn(
            "messaging.attachment.stage",
            [action for action, _ in self.sessions["ios_alice"].calls],
        )
        self.assertIn(
            "messaging.attachment.open",
            [action for action, _ in self.sessions["ios_bob"].calls],
        )


if __name__ == "__main__":
    unittest.main()
