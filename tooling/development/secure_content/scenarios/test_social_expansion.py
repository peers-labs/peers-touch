from __future__ import annotations

import hashlib
import unittest
from types import SimpleNamespace
from typing import Any, Mapping
from unittest.mock import patch

from tooling.development.secure_content.run import RunnerError
from tooling.development.secure_content.scenarios import social_expansion


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


class _Manifest:
    def client(self, client_id: str) -> Mapping[str, Any]:
        remote = client_id == social_expansion.REMOTE_CLIENT
        return {
            "actor_role": (
                "remote_recipient"
                if remote
                else client_id.rsplit("-", 1)[-1]
            ),
            "runtime_kind": "native-tauri",
            "service_bindings": {
                "station": {
                    "service_id": (
                        "station-five-arm" if remote else "station-four"
                    ),
                }
            },
        }


class _Context:
    runtime_manifest = _Manifest()
    runtime = "desktop"
    profile = None
    profiles = social_expansion.EXPECTED_PROFILES
    clients = social_expansion.EXPECTED_CLIENTS
    budget_seconds = social_expansion.EXPECTED_BUDGET_SECONDS

    @staticmethod
    def remaining_seconds() -> float:
        return 30.0

    def require_runtime_manifest(self) -> _Manifest:
        return self.runtime_manifest

    def fixture_handle(self, capability: str) -> SimpleNamespace:
        assert capability == social_expansion.REMOTE_RECIPIENT_CAPABILITY
        return SimpleNamespace(owner="actor-identity-provisioner")

    def invoke_fixture_action(
        self,
        capability: str,
        operation: str,
    ) -> Mapping[str, Any]:
        assert capability == social_expansion.REMOTE_RECIPIENT_CAPABILITY
        assert operation == social_expansion.REMOTE_RECIPIENT_OPERATION
        return {
            "acknowledgementDigest": "a" * 64,
            "outcome": {
                "actorPtid": "ptid:remote",
                "homeStationPeerIdSha256": "b" * 64,
                "federationId": "federation",
                "federationIdSha256": _digest("federation"),
                "remoteGroupUlid": "01JREMOTE",
                "profileId": "fiveArm",
                "serviceId": "station-five-arm",
            },
        }


class _FakeProductClient:
    identities = {
        social_expansion.LOCAL_CLIENTS[0]: "ptid:alice",
        social_expansion.LOCAL_CLIENTS[1]: "ptid:bob",
        social_expansion.LOCAL_CLIENTS[2]: "ptid:eve",
    }
    staged_payloads: list[dict[str, Any]] = []
    posts: dict[str, dict[str, Any]] = {}
    group_count = 0
    cleared_clients: list[str] = []

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
        self.current_draft: dict[str, Any] | None = None

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
        content = dict(payload or {})
        if method == "acceptanceActorIdentity":
            return {"actorPtid": self.identities[self.client_id]}
        if method == "friendshipAuthority":
            return {
                "federationId": "federation",
                "homeStationPeerId": "station-four-peer",
            }
        if method == "clearLocalState":
            type(self).cleared_clients.append(self.client_id)
            return {"ok": True}
        if method in {"followActor", "addAudienceCircleMember"}:
            return {"ok": True}
        if method == "createAudienceCircle":
            return {"circleId": "42"}
        if method == "createGroup":
            type(self).group_count += 1
            return {
                "groupUlid": f"01JGROUP{type(self).group_count:018d}",
                "memberCount": 2,
            }
        if method == "addFederatedGroupMember":
            return {"groupUlid": content["groupUlid"], "memberCount": 3}
        if method == "groupLifecycleSnapshot":
            return {
                "conversationId": content["groupUlid"],
                "members": [
                    {"ptid": "ptid:alice"},
                    {"ptid": "ptid:bob"},
                    {"ptid": "ptid:remote"},
                ],
            }
        if method == "stagePrivateDraft":
            self.current_draft = content
            type(self).staged_payloads.append(content)
            return {
                "present": True,
                "audienceKind": content["audienceKind"],
                "textSha256": _digest(str(content["text"])),
            }
        if method in {
            "publishPrivateDraft",
            "publishUnsupportedCustomDenyPublic",
        }:
            if method == "publishUnsupportedCustomDenyPublic":
                draft_id = str(content["draftId"])
            else:
                assert self.current_draft is not None
                draft_id = str(self.current_draft["draftId"])
            if draft_id in {
                "w8-audience-custom-deny-public",
                "w8-audience-remote-explicit",
                "w8-audience-remote-group",
            }:
                return {
                    "state": "PRIVATE_UNSUPPORTED",
                    "errorCode": "PRIVATE_UNSUPPORTED",
                    "rejectionEvidence": {
                        "publishPhase": "PREPARE_REJECTED",
                        "prepareSucceeded": False,
                        "receivedPreparePlanCount": 0,
                        "desktopLocalDurableRowCount": 0,
                        "claimCountScope": "NATIVE_RECEIVED_PREPARE_PLAN",
                        "partialRowScope": "DESKTOP_LOCAL_DURABLE_STATE",
                        "serverWriteProof": "STATION_SOURCE_TEST_REQUIRED",
                    },
                }
            assert self.current_draft is not None
            post_id = f"post-{draft_id}"
            type(self).posts[post_id] = dict(self.current_draft)
            return {"state": "PUBLISHED", "transientPostId": post_id}
        if method == "readPrivateMoment":
            post = type(self).posts[str(content["postId"])]
            authorized = (
                self.client_id == social_expansion.LOCAL_CLIENTS[0]
                and post["audienceKind"] == "SELF"
            ) or (
                self.client_id == social_expansion.LOCAL_CLIENTS[1]
                and post["audienceKind"] != "SELF"
            )
            if not authorized:
                return {"state": "NOT_FOUND_OR_NOT_AUTHORIZED"}
            return {
                "state": "CONTENT_READY",
                "audienceKind": post["audienceKind"],
                "textSha256": _digest(str(post["text"])),
            }
        raise AssertionError(f"unexpected fake call: {method}")


class SocialExpansionScenarioTest(unittest.TestCase):
    def setUp(self) -> None:
        _FakeProductClient.staged_payloads = []
        _FakeProductClient.posts = {}
        _FakeProductClient.group_count = 0
        _FakeProductClient.cleared_clients = []

    def test_executes_typed_local_and_remote_boundary_matrix(self) -> None:
        with (
            patch.object(
                social_expansion,
                "AttachedProductClient",
                _FakeProductClient,
            ),
            patch.object(
                social_expansion,
                "_chat_action",
                side_effect=lambda client, method, payload: client.call(
                    method,
                    payload,
                ),
            ),
        ):
            result = social_expansion._execute(_Context())

        self.assertEqual(
            0,
            result["nativeReceivedPreparePlansForRejectedPublishes"],
        )
        self.assertEqual(
            0,
            result["desktopLocalDurableRowsForRejectedPublishes"],
        )
        self.assertEqual(
            "SOURCE_CHECK_REQUIRED",
            result["stationZeroMutationEvidence"],
        )
        self.assertEqual(
            "a" * 64,
            result["remoteRecipientAcknowledgementDigest"],
        )
        self.assertEqual(
            _digest("federation"),
            result["remoteRecipientFederationIdSha256"],
        )
        self.assertTrue(
            all(
                "targetId" not in payload
                for payload in _FakeProductClient.staged_payloads
            )
        )
        circle = next(
            payload
            for payload in _FakeProductClient.staged_payloads
            if payload["audienceKind"] == "CIRCLE"
        )
        groups = [
            payload
            for payload in _FakeProductClient.staged_payloads
            if payload["audienceKind"] == "GROUP"
        ]
        self.assertEqual("42", circle["circleId"])
        self.assertEqual(1, _FakeProductClient.group_count)
        self.assertEqual(2, len(groups))
        self.assertTrue(
            all(payload["groupConversationId"] for payload in groups)
        )
        self.assertEqual(
            "01JREMOTE",
            next(
                payload["groupConversationId"]
                for payload in groups
                if payload["draftId"] == "w8-audience-remote-group"
            ),
        )
        self.assertEqual([], _FakeProductClient.cleared_clients)

    def test_rejected_publish_requires_zero_claim_and_row_evidence(self) -> None:
        client = _FakeProductClient(_Context(), social_expansion.LOCAL_CLIENTS[0])
        original = client.call

        def call(
            method: str,
            payload: Mapping[str, Any] | None = None,
        ) -> Mapping[str, Any]:
            result = original(method, payload)
            if method == "publishPrivateDraft":
                evidence = {
                    **dict(result["rejectionEvidence"]),
                    "receivedPreparePlanCount": 1,
                }
                return {**result, "rejectionEvidence": evidence}
            return result

        client.call = call  # type: ignore[method-assign]
        with self.assertRaisesRegex(RunnerError, "Native prepare boundary"):
            social_expansion._stage_rejected_publish(
                client,
                draft_id="w8-audience-remote-explicit",
                text="remote",
                audience_kind="CUSTOM_ALLOW",
                actor_ptids=("ptid:remote",),
            )


if __name__ == "__main__":
    unittest.main()
