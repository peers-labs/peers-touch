from __future__ import annotations

import hashlib
import unittest
from types import SimpleNamespace
from typing import Any, Mapping
from unittest.mock import patch

from tooling.development.secure_content.scenarios import social_delete_block


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
    clients = social_delete_block.EXPECTED_CLIENTS
    budget_seconds = social_delete_block.EXPECTED_BUDGET_SECONDS

    @staticmethod
    def remaining_seconds() -> float:
        return 30.0

    def require_runtime_manifest(self) -> _Manifest:
        return self.runtime_manifest

    def write_artifact_bytes(
        self,
        name: str,
        _value: bytes,
        *,
        durable: bool = True,
    ) -> SimpleNamespace:
        del durable
        return SimpleNamespace(
            __str__=lambda self: f"/tmp/{name}",
            unlink=lambda **_kwargs: None,
        )


class _FakeProductClient:
    posts: dict[str, dict[str, Any]] = {}
    deleted: set[str] = set()
    blocked = False
    grants_revoked = False

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
            actor = self.client_id.rsplit("-", 1)[-1]
            return {"actorPtid": f"ptid:{actor}"}
        if method == "friendshipAuthority":
            return {"homeStationPeerId": "station-four-peer"}
        if method == "publishTypedPrivateMoment":
            post_id = f"post-{value['draftId']}"
            type(self).posts[post_id] = value
            return {"state": "PUBLISHED", "transientPostId": post_id}
        if method == "readPrivateMoment":
            post_id = str(value["postId"])
            if post_id in type(self).deleted or (
                type(self).grants_revoked
                and self.client_id
                == social_delete_block.EXPECTED_CLIENTS[1]
            ):
                return {
                    "state": "NOT_FOUND_OR_NOT_AUTHORIZED",
                    "media": [],
                }
            post = type(self).posts[post_id]
            result: dict[str, Any] = {
                "state": "CONTENT_READY",
                "textSha256": _digest(str(post["text"])),
                "contentKind": post["momentKind"],
                "media": [],
            }
            if post["momentKind"] == "IMAGE":
                result["media"] = [{
                    "state": "MEDIA_READY",
                    "plaintextSha256": _digest(
                        social_delete_block.PNG_BYTES
                    ),
                }]
            return result
        if method == "deletePrivateMoment":
            post_id = str(value["postId"])
            type(self).deleted.add(post_id)
            return {"deleted": True, "localProjectionPresent": False}
        if method == "blockActor":
            type(self).blocked = True
            type(self).grants_revoked = True
            return {
                "state": "BLOCKED",
                "revision": 1,
                "interactionAllowed": False,
                "targetActorPtidSha256": _digest(str(value["actorPtid"])),
            }
        if method == "recoverPrivateMoment":
            return {"state": "NOT_FOUND_OR_NOT_AUTHORIZED"}
        if method == "unblockActor":
            type(self).blocked = False
            return {
                "state": "UNBLOCKED",
                "revision": 2,
                "interactionAllowed": True,
            }
        if method == "clearLocalState":
            return {"ok": True}
        raise AssertionError(f"unexpected fake call: {method}")


class SocialDeleteBlockScenarioTest(unittest.TestCase):
    def setUp(self) -> None:
        _FakeProductClient.posts = {}
        _FakeProductClient.deleted = set()
        _FakeProductClient.blocked = False
        _FakeProductClient.grants_revoked = False

    def test_executes_delete_and_block_revocation_flow(self) -> None:
        with patch.object(
            social_delete_block,
            "AttachedProductClient",
            _FakeProductClient,
        ):
            result = social_delete_block._execute(_Context())

        self.assertTrue(result["delete"]["priorMediaReady"])
        self.assertTrue(result["delete"]["futureDetailDenied"])
        self.assertTrue(result["block"]["signedCommandCommitted"])
        self.assertTrue(result["block"]["futureRecoveryDenied"])
        self.assertTrue(result["block"]["unblockDoesNotRestorePriorGrant"])
        self.assertFalse(result["maliciousCopyDeletionClaimed"])


if __name__ == "__main__":
    unittest.main()
