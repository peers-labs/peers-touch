from __future__ import annotations

import hashlib
import unittest
from types import SimpleNamespace
from typing import Any, Mapping
from unittest.mock import patch

from tooling.development.secure_content.scenarios import social_subtype


def _digest(value: bytes | str) -> str:
    payload = value.encode("utf-8") if isinstance(value, str) else value
    return hashlib.sha256(payload).hexdigest()


class _Manifest:
    sha256 = "a" * 64

    def client(self, client_id: str) -> Mapping[str, Any]:
        return {
            "actor_role": client_id.rsplit("-", 1)[-1],
            "runtime_kind": "native-tauri",
        }


class _Context:
    runtime_manifest = _Manifest()
    runtime = "desktop"
    profile = "four"
    profiles = ("four",)
    clients = social_subtype.EXPECTED_CLIENTS
    budget_seconds = social_subtype.EXPECTED_BUDGET_SECONDS

    @staticmethod
    def remaining_seconds() -> float:
        return 30.0

    def require_runtime_manifest(self) -> _Manifest:
        return self.runtime_manifest

    def write_artifact_bytes(
        self,
        name: str,
        value: bytes,
        *,
        durable: bool = True,
    ) -> SimpleNamespace:
        del value, durable
        return SimpleNamespace(
            __str__=lambda self: f"/tmp/{name}",
            unlink=lambda **_kwargs: None,
        )


class _FixturePath:
    def __init__(self, value: str) -> None:
        self.value = value

    def __str__(self) -> str:
        return self.value

    def unlink(self, **_kwargs: object) -> None:
        return None


class _FakeProductClient:
    posts: dict[str, dict[str, Any]] = {}
    published_kinds: list[str] = []

    def __init__(
        self,
        context: _Context,
        client_id: str,
        *,
        namespace: str = "moments",
    ) -> None:
        self.context = context
        self.client_id = client_id
        self.namespace = namespace

    def __enter__(self) -> "_FakeProductClient":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def snapshot(self) -> Mapping[str, Any]:
        return {"platform": "native"}

    def call(
        self,
        method: str,
        payload: Mapping[str, Any] | None = None,
    ) -> Mapping[str, Any]:
        value = dict(payload or {})
        if method == "acceptanceActorIdentity":
            return {
                "actorPtid": (
                    "ptid:bob"
                    if self.client_id == social_subtype.EXPECTED_CLIENTS[1]
                    else "ptid:alice"
                )
            }
        if method == "publishTypedPrivateMoment":
            kind = str(value["momentKind"])
            draft_id = str(value["draftId"])
            post_id = f"post-{draft_id}"
            self.posts[post_id] = value
            self.published_kinds.append(kind)
            return {"state": "PUBLISHED", "transientPostId": post_id}
        if method == "readPrivateMoment":
            post_id = str(value["postId"])
            post = self.posts[post_id]
            if self.client_id == social_subtype.EXPECTED_CLIENTS[2]:
                return {"state": "NOT_FOUND_OR_NOT_AUTHORIZED"}
            kind = str(post["momentKind"])
            result: dict[str, Any] = {
                "state": "CONTENT_READY",
                "audienceKind": "FRIENDS",
                "contentKind": kind,
                "textSha256": _digest(str(post["text"])),
                "mentionCount": len(post.get("mentions", ())),
                "mentionedActorPtidsSha256": [
                    _digest(str(mention["actorPtid"]))
                    for mention in post.get("mentions", ())
                ],
                "media": [],
            }
            if kind == "IMAGE":
                result["media"] = [{
                    "state": "MEDIA_READY",
                    "plaintextSha256": _digest(social_subtype.PNG_BYTES),
                }]
            elif kind == "VIDEO":
                result["media"] = [{
                    "state": "MEDIA_READY",
                    "plaintextSha256": _digest(social_subtype.MP4_BYTES),
                }]
            elif kind == "LINK":
                link = post["link"]
                result["subtypeEvidence"] = {
                    "urlSha256": _digest(str(link["url"])),
                    "titleSha256": _digest(str(link["title"])),
                }
            elif kind == "POLL":
                poll = post["poll"]
                result["subtypeEvidence"] = {
                    "questionSha256": _digest(str(poll["question"])),
                    "optionLabelSha256": [
                        _digest(str(option))
                        for option in poll["options"]
                    ],
                    "minChoices": poll["minChoices"],
                    "maxChoices": poll["maxChoices"],
                }
            elif kind == "LOCATION":
                location = post["location"]
                result["subtypeEvidence"] = {
                    "nameSha256": _digest(str(location["name"])),
                    "addressSha256": _digest(str(location["address"])),
                }
            elif kind == "REPOST":
                result["subtypeEvidence"] = {
                    "sourcePostIdSha256": _digest(
                        str(post["repost"]["sourcePostId"])
                    ),
                    "sourceKind": "TEXT",
                }
            return result
        if method == "reactToPrivateMoment":
            return {
                "reactions": [{
                    "kind": 2,
                    "count": 1,
                    "reactedByViewer": True,
                }]
            }
        if method == "unreactToPrivateMoment":
            return {"reactions": []}
        if method == "clearLocalState":
            return {"ok": True}
        raise AssertionError(f"unexpected fake call: {method}")


class SocialSubtypeScenarioTest(unittest.TestCase):
    def setUp(self) -> None:
        _FakeProductClient.posts = {}
        _FakeProductClient.published_kinds = []

    def test_executes_complete_private_subtype_and_reaction_matrix(
        self,
    ) -> None:
        context = _Context()
        context.write_artifact_bytes = lambda name, _value, **_kwargs: (
            _FixturePath(f"/tmp/{name}")
        )
        with patch.object(
            social_subtype,
            "AttachedProductClient",
            _FakeProductClient,
        ):
            result = social_subtype._execute(context)

        self.assertEqual(
            {
                "TEXT",
                "IMAGE",
                "VIDEO",
                "LINK",
                "POLL",
                "REPOST",
                "LOCATION",
            },
            set(result["subtypes"]),
        )
        self.assertEqual("EXACT_RECEIVER_COVERAGE", result["mentionRouting"])
        self.assertEqual(
            [{
                "actorPtid": "ptid:bob",
                "offset": 1,
                "length": 3,
                "display": "Bob",
            }],
            _FakeProductClient.posts[
                "post-w8-subtype-mention"
            ]["mentions"],
        )
        self.assertEqual("ADD_REMOVE", result["reactionLifecycle"])
        self.assertEqual(
            [
                "TEXT",
                "IMAGE",
                "VIDEO",
                "LINK",
                "POLL",
                "LOCATION",
                "TEXT",
                "REPOST",
            ],
            _FakeProductClient.published_kinds,
        )


if __name__ == "__main__":
    unittest.main()
