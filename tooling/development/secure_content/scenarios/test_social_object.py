from __future__ import annotations

import hashlib
import unittest
from types import SimpleNamespace
from typing import Any, Mapping
from unittest.mock import patch

from tooling.development.secure_content.scenarios import social_object


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
    clients = social_object.EXPECTED_CLIENTS
    budget_seconds = social_object.EXPECTED_BUDGET_SECONDS

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
        if method == "readPrivateMoment":
            if self.client_id == social_object.EXPECTED_CLIENTS[2]:
                return {
                    "state": "NOT_FOUND_OR_NOT_AUTHORIZED",
                    "media": [],
                }
            post = type(self).posts[str(value["postId"])]
            kind = str(post["momentKind"])
            body = next(
                data
                for case_kind, _name, data in social_object.OBJECT_CASES
                if case_kind == kind
            )
            ready = bool(value.get("openMedia"))
            return {
                "state": "CONTENT_READY",
                "media": [{
                    "state": (
                        "MEDIA_READY" if ready else "MEDIA_PLACEHOLDER"
                    ),
                    "plaintextSha256": _digest(body) if ready else None,
                    "byteLength": len(body) if ready else None,
                }],
            }
        if method == "clearLocalState":
            return {"ok": True}
        raise AssertionError(f"unexpected fake call: {method}")


class SocialObjectScenarioTest(unittest.TestCase):
    def setUp(self) -> None:
        _FakeProductClient.posts = {}

    def test_executes_image_and_video_object_flow(self) -> None:
        with patch.object(
            social_object,
            "AttachedProductClient",
            _FakeProductClient,
        ):
            result = social_object._execute(_Context())

        self.assertEqual(
            {"image", "video"},
            set(result["objects"]),
        )
        self.assertFalse(result["publicFallbackObserved"])
        self.assertIn(
            "MEDIA_READY",
            result["failureStateCoverage"]["runtime"],
        )
        self.assertIn(
            "MEDIA_OFFLINE_RETRYABLE",
            result["failureStateCoverage"]["sourceOnly"],
        )


if __name__ == "__main__":
    unittest.main()
