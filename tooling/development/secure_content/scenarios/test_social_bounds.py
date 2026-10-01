from __future__ import annotations

import hashlib
import unittest
from types import SimpleNamespace
from typing import Any, Mapping
from unittest.mock import patch

from tooling.development.secure_content.scenarios import social_bounds


def _digest(value: bytes | str) -> str:
    payload = value.encode("utf-8") if isinstance(value, str) else value
    return hashlib.sha256(payload).hexdigest()


class _Manifest:
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
    clients = social_bounds.EXPECTED_CLIENTS
    budget_seconds = social_bounds.EXPECTED_BUDGET_SECONDS

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

    @staticmethod
    def remaining_seconds() -> float:
        return 30.0


class _FakeProductClient:
    posts: dict[str, dict[str, Any]] = {}

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

    def call(
        self,
        method: str,
        payload: Mapping[str, Any] | None = None,
    ) -> Mapping[str, Any]:
        value = dict(payload or {})
        if method == "publishTypedPrivateMoment":
            post_id = f"post-{value['draftId']}"
            type(self).posts[post_id] = value
            return {"state": "PUBLISHED", "transientPostId": post_id}
        if method == "probeTypedPrivateMomentRejection":
            return {
                "rejected": True,
                "state": "PUBLISH_FAILED",
            }
        if method == "readPrivateMoment":
            post = type(self).posts[str(value["postId"])]
            if post["momentKind"] == "IMAGE":
                hashes = [
                    _digest(
                        b"\x89PNG\r\n\x1a\n"
                        + f"secure-content-w8-bound-{index}".encode("ascii")
                    )
                    for index in range(social_bounds.MAX_OBJECTS)
                ]
                return {
                    "state": "CONTENT_READY",
                    "media": [
                        {
                            "state": "MEDIA_READY",
                            "plaintextSha256": digest,
                        }
                        for digest in hashes
                    ],
                }
            poll = post["poll"]
            return {
                "state": "CONTENT_READY",
                "subtypeEvidence": {
                    "optionLabelSha256": [
                        _digest(str(option))
                        for option in poll["options"]
                    ],
                    "maxChoices": poll["maxChoices"],
                },
            }
        if method == "clearLocalState":
            return {"ok": True}
        raise AssertionError(f"unexpected fake call: {method}")


class SocialBoundsScenarioTest(unittest.TestCase):
    def setUp(self) -> None:
        _FakeProductClient.posts = {}

    def test_executes_at_limit_and_over_limit_paths(self) -> None:
        with patch.object(
            social_bounds,
            "AttachedProductClient",
            _FakeProductClient,
        ):
            result = social_bounds._execute(_Context())

        self.assertEqual(
            social_bounds.MAX_OBJECTS,
            result["runtimeBounds"]["objectCountAccepted"],
        )
        self.assertEqual(
            social_bounds.MAX_OBJECTS + 1,
            result["runtimeBounds"]["objectCountRejected"],
        )
        self.assertEqual(
            social_bounds.MAX_POLL_OPTIONS,
            result["runtimeBounds"]["pollOptionCountAccepted"],
        )
        self.assertFalse(result["recipientTruncationObserved"])
        self.assertFalse(result["partialCommitObserved"])


if __name__ == "__main__":
    unittest.main()
