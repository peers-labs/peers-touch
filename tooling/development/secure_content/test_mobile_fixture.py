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
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []

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
                "publishStateHistory": sorted(
                    PLATFORM_OPERATIONS["publish-states"]
                ),
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
            }
        if action == "moments.private.publishText":
            return {"state": "PUBLISHED", "postId": "post-1"}
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
            "moments.private.reconcile",
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
        if action == "moments.private.publishText":
            self.calls.append((action, body))
            return {
                "draftId": body["draftId"],
                "draftRevision": body["draftRevision"],
                "state": "UNKNOWN_OUTCOME",
                "errorCode": 20005,
            }
        if action == "moments.private.reconcile":
            self.calls.append((action, body))
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
        self.sessions = {
            "ios_alice": _Session(),
            "ios_bob": _Session(),
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

    def test_publish_reconciles_unknown_outcome_before_requiring_post_id(
        self,
    ) -> None:
        self.sessions["ios_alice"] = _UnknownOutcomeSession()
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
