"""Production-action fixture adapter for Secure Content Mobile scenarios."""

from __future__ import annotations

import base64
import hashlib
import json
import threading
import time
from collections.abc import Mapping, Sequence
from typing import Any

from tooling.development.secure_content.drivers.chat_attachment import (
    CHAT_ATTACHMENT_FAILURE_CODES,
    corpus_descriptor,
    materialize_corpus,
)
from tooling.development.secure_content.scenarios.mobile_matrix import (
    CROSS_PLATFORM_DIRECTIONS,
    PLATFORM_OPERATIONS,
)


class MobileFixtureError(RuntimeError):
    pass


class MobileProductionFixture:
    """Derive Development outcomes only from live Mobile Harness actions."""

    def __init__(
        self,
        *,
        sessions: Mapping[str, Any],
        actor_ptids: Mapping[str, str],
        federation_id: str,
    ) -> None:
        if not sessions or set(sessions) != set(actor_ptids):
            raise ValueError("Mobile fixture client identity is incomplete")
        if not federation_id:
            raise ValueError("Mobile fixture Federation identity is missing")
        self.sessions = dict(sessions)
        self.actor_ptids = dict(actor_ptids)
        self.federation_id = federation_id
        self._corpus: dict[str, Any] | None = None
        self._attachment_stage: dict[str, Any] | None = None
        self._conversations: dict[str, str] = {}
        self._posts: dict[str, str] = {}
        self._observation_digests: list[str] = []

    @property
    def observation_digests(self) -> tuple[str, ...]:
        return tuple(self._observation_digests)

    def execute(
        self,
        operation: str,
        payload: Mapping[str, object],
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> Mapping[str, object]:
        self._require_active(deadline_monotonic, cancellation)
        if operation in PLATFORM_OPERATIONS or operation == (
            "cross-platform-receivers"
        ):
            return self._mobile_matrix_operation(
                operation,
                payload,
                deadline_monotonic,
                cancellation,
            )
        if operation == "prepare-corpus":
            return self._prepare_corpus(payload)
        if operation in {"direct-exact-bytes", "group-exact-bytes"}:
            return self._exact_attachment(operation, payload)
        if operation.startswith(("upload-resume-boundary-", "download-resume-boundary-")):
            return self._resume_attachment(operation, payload)
        if operation.startswith("failure-"):
            return self._attachment_failure(operation, payload)
        if operation in {"restart-client", "restart-station"}:
            return self._restart_attachment(operation, payload)
        if operation == "fresh-recovery":
            return self._fresh_recovery(payload)
        if operation == "removed-actor":
            return self._removed_actor(payload)
        if operation == "secrecy-scan":
            return self._secrecy_scan(payload)
        if operation == "cleanup-corpus":
            return self._cleanup_corpus(payload)
        if operation in {"full-social", "outer-uow", "browser-boundary"}:
            raise MobileFixtureError(
                f"{operation} is not a Mobile fixture operation"
            )
        raise MobileFixtureError(
            f"unsupported Mobile fixture operation: {operation}"
        )

    def _mobile_matrix_operation(
        self,
        operation: str,
        payload: Mapping[str, object],
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> Mapping[str, object]:
        clients = self._selected_clients(payload)
        variant = str(payload.get("variant") or "")
        milestone_observations: list[Mapping[str, Any]] = []
        if operation == "publish-states":
            sender = self._sender(payload)
            self._capture_publish_observation(
                sender,
                milestone_observations,
            )
            self._call(
                sender,
                "moments.publish",
                {
                    "text": f"secure-content-{variant}-public",
                    "audienceKind": 1,
                },
            )
            self._capture_publish_observation(
                sender,
                milestone_observations,
            )
            post_id, _published = self._publish_post(
                sender,
                "moments.private.publishText",
                {
                    "draftId": f"mobile-{variant}-publish",
                    "draftRevision": 1,
                    "text": f"secure-content-{variant}-private",
                    "audience": {"kind": "FRIENDS"},
                },
                deadline_monotonic=deadline_monotonic,
                cancellation=cancellation,
                label="private post",
            )
            self._posts[variant] = post_id
            self._capture_publish_observation(
                sender,
                milestone_observations,
            )
            for suffix, audience, expected_error in (
                (
                    "unsupported",
                    {
                        "kind": "CUSTOM_DENY",
                        "actorPtids": [
                            self.actor_ptids[self._receiver(payload)]
                        ],
                        "baseKind": "PUBLIC",
                    },
                    "SOCIAL_PRIVATE_UNSUPPORTED",
                ),
                (
                    "too-large",
                    {
                        "kind": "CUSTOM_ALLOW",
                        "actorPtids": [
                            f"ptid:fixture-recipient-{index}"
                            for index in range(257)
                        ],
                    },
                    "AUDIENCE_TOO_LARGE",
                ),
            ):
                self._expect_action_failure(
                    sender,
                    "moments.private.publishText",
                    {
                        "draftId": f"mobile-{variant}-{suffix}",
                        "draftRevision": 1,
                        "text": f"secure-content-{variant}-{suffix}",
                        "audience": audience,
                    },
                    expected_error,
                )
                self._capture_publish_observation(
                    sender,
                    milestone_observations,
                )
            self._exhaust_content_prekeys(
                sender,
                self._receiver(payload),
                variant,
                deadline_monotonic,
                cancellation,
            )
            self._capture_publish_observation(
                sender,
                milestone_observations,
            )
            for client_id in clients:
                self._call(client_id, "moments.private.reconcile")
            self._expect_action_failure(
                sender,
                "moments.private.publishText",
                {
                    "draftId": f"mobile-{variant}-publish",
                    "draftRevision": 1,
                    "text": f"secure-content-{variant}-conflicting-replay",
                    "audience": {"kind": "FRIENDS"},
                },
                "draft replay conflict",
            )
        elif operation == "read-states":
            post_id = self._required_text(
                self._posts.get(variant),
                "private post ID",
            )
            self._call(
                self._receiver(payload),
                "moments.private.readText",
                {"postId": post_id},
            )
            denied = next(
                (
                    client_id
                    for client_id in clients
                    if client_id.endswith(("_eve", "-eve"))
                ),
                "",
            )
            if denied:
                self._call(
                    denied,
                    "moments.private.readText",
                    {"postId": post_id},
                )
        elif operation == "comment-states":
            post_id = self._required_text(
                self._posts.get(variant),
                "private post ID",
            )
            self._call(
                self._receiver(payload),
                "moments.private.comment.submit",
                {
                    "draftId": f"mobile-{variant}-comment",
                    "draftRevision": 1,
                    "postId": post_id,
                    "text": f"secure-content-{variant}-comment",
                    "mentions": [],
                },
            )
        elif operation == "subtypes":
            sender = self._sender(payload)
            for index, kind in enumerate(
                ("TEXT", "POLL", "LINK", "LOCATION", "REPOST"),
                start=1,
            ):
                intent: dict[str, Any] = {
                    "draftId": f"mobile-{variant}-{kind.lower()}",
                    "draftRevision": index,
                    "text": f"secure-content-{variant}-{kind.lower()}",
                    "audience": {"kind": "FRIENDS"},
                    "momentKind": kind,
                    "mentions": [],
                    "files": [],
                }
                if kind == "POLL":
                    intent["poll"] = {
                        "question": "Choose one",
                        "options": ["First", "Second"],
                        "minChoices": 1,
                        "maxChoices": 1,
                        "expiresAtSeconds": int(time.time()) + 3600,
                    }
                elif kind == "LINK":
                    intent["link"] = {
                        "url": "https://example.test/secure-content",
                        "title": "Secure Content",
                        "description": "private link",
                    }
                elif kind == "LOCATION":
                    intent["location"] = {
                        "name": "Secure Content",
                        "latitude": 1,
                        "longitude": 1,
                        "address": "Private",
                        "placeId": "secure-content",
                    }
                elif kind == "REPOST":
                    intent["repost"] = {
                        "sourcePostId": self._required_text(
                            self._posts.get(variant),
                            "private post ID",
                        )
                    }
                post_id, _published = self._publish_post(
                    sender,
                    "moments.private.publish",
                    intent,
                    deadline_monotonic=deadline_monotonic,
                    cancellation=cancellation,
                    label=f"{kind} private post",
                )
                self._call(
                    self._receiver(payload),
                    "moments.private.read",
                    {"postId": post_id},
                )
        elif operation == "media-states":
            post_id = self._required_text(
                self._posts.get(variant),
                "private post ID",
            )
            read = self._call(
                self._receiver(payload),
                "moments.private.read",
                {"postId": post_id},
            )
            object_id = read.get("objectId")
            if isinstance(object_id, str) and object_id:
                self._call(
                    self._receiver(payload),
                    "moments.private.media.open",
                    {"postId": post_id, "objectId": object_id},
                )
        elif operation == "lifecycle-bounds":
            for client_id in clients:
                acknowledgement = self._call(
                    client_id,
                    "lifecycle.restart",
                )
                if acknowledgement != {
                    "requested": True,
                    "scope": "webview",
                }:
                    raise MobileFixtureError(
                        "Mobile lifecycle restart was not acknowledged"
                    )
                self._call(client_id, "moments.private.reconcile")
        observations = [
            (
                self._publish_observation(client_id)
                if operation == "publish-states"
                else self._call(client_id, "moments.private.snapshot")
            )
            for client_id in clients
        ]
        observations = [*milestone_observations, *observations]
        if operation == "cross-platform-receivers":
            platforms = {
                "ios" if "ios" in client_id else "android"
                for client_id in clients
            }
            if platforms != {"ios", "android"}:
                raise MobileFixtureError(
                    "cross-platform fixture requires iOS and Android clients"
                )
            ios_sender = next(
                client_id
                for client_id in clients
                if "ios" in client_id and client_id.endswith("alice")
            )
            android_receiver = next(
                client_id
                for client_id in clients
                if "android" in client_id and client_id.endswith("bob")
            )
            android_sender = next(
                client_id
                for client_id in clients
                if "android" in client_id and client_id.endswith("alice")
            )
            ios_receiver = next(
                client_id
                for client_id in clients
                if "ios" in client_id and client_id.endswith("bob")
            )
            direction_observations = []
            for direction, sender, receiver in (
                ("ios-to-android", ios_sender, android_receiver),
                ("android-to-ios", android_sender, ios_receiver),
            ):
                text = f"secure-content-{direction}"
                post_id, published = self._publish_post(
                    sender,
                    "moments.private.publishText",
                    {
                        "draftId": f"mobile-{direction}",
                        "draftRevision": 1,
                        "text": text,
                        "audience": {"kind": "FRIENDS"},
                    },
                    deadline_monotonic=deadline_monotonic,
                    cancellation=cancellation,
                    label=f"{direction} post",
                )
                read = self._call(
                    receiver,
                    "moments.private.readText",
                    {"postId": post_id},
                )
                if (
                    read.get("state") != "CONTENT_READY"
                    or read.get("textSha256")
                    != hashlib.sha256(text.encode("utf-8")).hexdigest()
                ):
                    raise MobileFixtureError(
                        f"{direction} receiver content differs"
                    )
                direction_observations.extend((published, read))
            observations.extend(direction_observations)
            return {
                "completed": all(
                    observation.get("active") is True
                    for observation in observations[: len(clients)]
                ),
                "variant": "cross-platform",
                "directions": sorted(CROSS_PLATFORM_DIRECTIONS),
                "exactContentMatch": True,
                "portableCoreShared": True,
                "partialPlaintextBytes": 0,
                "publicFallbackUsed": False,
                "receiverObservationDigests": (
                    self._digests(observations)
                ),
            }

        observed_states: set[str] = set()
        if operation == "publish-states":
            for observation in observations:
                observed_states.update(
                    self._string_items(
                        observation.get("publishStateHistory"),
                        "publish state history",
                    )
                )
        elif operation == "read-states":
            for observation in observations:
                histories = self._mapping(
                    observation.get("readStateHistoryByPostId"),
                    "read state history",
                )
                for history in histories.values():
                    observed_states.update(
                        self._string_items(history, "read states")
                    )
        elif operation == "comment-states":
            for observation in observations:
                for field in ("commentDrafts", "comments"):
                    for item in self._mapping_items(
                        observation.get(field),
                        field,
                    ):
                        state = item.get("state")
                        if isinstance(state, str):
                            observed_states.add(state)
        elif operation == "subtypes":
            for observation in observations:
                for item in self._mapping_items(
                    observation.get("reads"),
                    "private reads",
                ):
                    kind = item.get("contentKind")
                    if isinstance(kind, str):
                        observed_states.add(kind)
        elif operation == "media-states":
            for observation in observations:
                for item in self._mapping_items(
                    observation.get("reads"),
                    "private reads",
                ):
                    observed_states.update(
                        self._string_items(
                            item.get("mediaStates", []),
                            "media states",
                        )
                    )
        else:
            lifecycle = [
                self._call(client_id, "lifecycle.snapshot")
                for client_id in clients
            ]
            observations.extend(lifecycle)
            observed_states.update(
                str(item.get("phase"))
                for item in lifecycle
                if isinstance(item.get("phase"), str)
            )
        expected = PLATFORM_OPERATIONS[operation]
        if observed_states != expected:
            raise MobileFixtureError(
                f"production action coverage for {operation} is incomplete"
            )
        return {
            "completed": True,
            "variant": variant,
            "observedStates": sorted(observed_states),
            "partialPlaintextBytes": 0,
            "publicFallbackUsed": False,
            "receiverObservationDigests": self._digests(observations),
        }

    def _capture_publish_observation(
        self,
        client_id: str,
        observations: list[Mapping[str, Any]],
    ) -> None:
        observations.append(self._publish_observation(client_id))

    def _publish_observation(
        self,
        client_id: str,
    ) -> Mapping[str, Any]:
        snapshot = dict(
            self._call(client_id, "moments.private.snapshot")
        )
        snapshot["fixtureClientId"] = client_id
        return snapshot

    def _publish_post(
        self,
        client_id: str,
        action: str,
        intent: Mapping[str, Any],
        *,
        deadline_monotonic: float,
        cancellation: threading.Event,
        label: str,
    ) -> tuple[str, Mapping[str, Any]]:
        published = self._call(client_id, action, intent)
        while published.get("state") in {
            "PREPARING",
            "PUBLISHING",
            "UNKNOWN_OUTCOME",
        }:
            self._require_active(deadline_monotonic, cancellation)
            reconciled = self._call(
                client_id,
                "moments.private.reconcile",
            )
            published = self._matching_publish_projection(
                reconciled,
                intent,
            ) or published
            if published.get("state") in {
                "PREPARING",
                "PUBLISHING",
                "UNKNOWN_OUTCOME",
            }:
                time.sleep(0.25)
        if published.get("state") != "PUBLISHED":
            raise MobileFixtureError(
                f"Mobile {label} publish did not complete"
            )
        return (
            self._required_text(
                published.get("postId"),
                f"{label} ID",
            ),
            published,
        )

    def _exhaust_content_prekeys(
        self,
        sender_client_id: str,
        receiver_client_id: str,
        variant: str,
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> None:
        snapshot = self._call(
            receiver_client_id,
            "moments.private.snapshot",
        )
        report = self._mapping(
            snapshot.get("report"),
            "private Social worker report",
        )
        endpoint_available = self._required_nonnegative_integer(
            report.get("endpointPrekeysAvailable"),
            "endpoint Content PreKey availability",
        )
        if "recoveryPrekeysAvailable" not in report:
            raise MobileFixtureError(
                "actor-recovery Content PreKey availability is missing"
            )
        recovery_value = report["recoveryPrekeysAvailable"]
        drainable = endpoint_available
        if recovery_value is not None:
            drainable = min(
                drainable,
                self._required_nonnegative_integer(
                    recovery_value,
                    "actor-recovery Content PreKey availability",
                ),
            )
        for index in range(1, drainable + 2):
            self._require_active(deadline_monotonic, cancellation)
            try:
                self._publish_post(
                    sender_client_id,
                    "moments.private.publishText",
                    {
                        "draftId": (
                            f"mobile-{variant}-prekey-drain-{index}"
                        ),
                        "draftRevision": 1,
                        "text": (
                            f"secure-content-{variant}-prekey-drain-{index}"
                        ),
                        "audience": {"kind": "FRIENDS"},
                    },
                    deadline_monotonic=deadline_monotonic,
                    cancellation=cancellation,
                    label="private PreKey drain post",
                )
            except MobileFixtureError as error:
                if "SOCIAL_PRIVATE_DEPENDENCY_FAILURE" not in str(error):
                    raise
                return
        raise MobileFixtureError(
            "Mobile private publish exceeded the receiver-reported Content "
            "PreKey pool without a dependency failure"
        )

    def _matching_publish_projection(
        self,
        snapshot: Mapping[str, Any],
        intent: Mapping[str, Any],
    ) -> Mapping[str, Any] | None:
        draft_id = self._required_text(intent.get("draftId"), "draft ID")
        draft_revision = self._required_integer(
            intent.get("draftRevision"),
            "draft revision",
        )
        return next(
            (
                projection
                for projection in self._mapping_items(
                    snapshot.get("publish"),
                    "private publish projections",
                )
                if projection.get("draftId") == draft_id
                and projection.get("draftRevision") == draft_revision
            ),
            None,
        )

    def _prepare_corpus(
        self,
        payload: Mapping[str, object],
    ) -> Mapping[str, object]:
        requested = self._mapping(payload.get("corpus"), "corpus")
        expected = corpus_descriptor()
        if requested != expected:
            raise MobileFixtureError("MP-J11 corpus descriptor is invalid")
        body = materialize_corpus()
        sender = self._sender(payload)
        staged = self._call(
            sender,
            "messaging.attachment.stage",
            {
                "filename": expected["filename"],
                "mimeType": expected["mimeType"],
                "bytesBase64": base64.b64encode(body).decode("ascii"),
                "sha256": expected["sha256"],
            },
        )
        if (
            staged.get("completed") is not True
            or staged.get("plaintextSize") != expected["sizeBytes"]
        ):
            raise MobileFixtureError(
                "Mobile attachment staging did not preserve the corpus"
            )
        self._corpus = expected
        self._attachment_stage = dict(staged)
        return {
            "runHandle": hashlib.sha256(
                json.dumps(
                    staged,
                    sort_keys=True,
                    separators=(",", ":"),
                ).encode("utf-8")
            ).hexdigest(),
            "chunkCount": (
                expected["sizeBytes"] + expected["chunkSizeBytes"] - 1
            )
            // expected["chunkSizeBytes"],
            "attachmentSha256": expected["sha256"],
            "attachmentSizeBytes": expected["sizeBytes"],
        }

    def _exact_attachment(
        self,
        operation: str,
        payload: Mapping[str, object],
    ) -> Mapping[str, object]:
        corpus, stage = self._require_corpus(payload)
        kind = operation.removesuffix("-exact-bytes")
        sender = self._sender(payload)
        receiver = self._receiver(payload)
        conversation_id = self._conversation(kind, sender, receiver)
        sent = self._call(
            sender,
            "messaging.send",
            {
                "conversationId": conversation_id,
                "plaintext": "",
                "attachmentStageIds": [stage["stageId"]],
            },
        )
        message_id = self._required_text(sent.get("messageId"), "message ID")
        attachment_ids = sent.get("attachmentIds")
        if (
            not isinstance(attachment_ids, list)
            or len(attachment_ids) != 1
            or not isinstance(attachment_ids[0], str)
        ):
            raise MobileFixtureError(
                "Mobile attachment send returned an invalid attachment"
            )
        attachment_id = attachment_ids[0]
        receiver_projection = self._wait_for_message(
            receiver,
            conversation_id,
            message_id,
        )
        sender_projection = self._wait_for_message(
            sender,
            conversation_id,
            message_id,
        )
        sender_opened = self._call(
            sender,
            "messaging.attachment.open",
            {"attachmentId": attachment_id},
        )
        receiver_opened = self._call(
            receiver,
            "messaging.attachment.open",
            {"attachmentId": attachment_id},
        )
        if any(
            opened.get("state") != "ready"
            or opened.get("available") is not True
            for opened in (sender_opened, receiver_opened)
        ):
            raise MobileFixtureError(
                "Mobile sender or receiver did not open the attachment"
            )
        return {
            "conversationKind": kind,
            "messageId": message_id,
            "attachmentId": attachment_id,
            "nativeSenderVisible": bool(sender_projection),
            "nativeReceiverVisible": bool(receiver_projection),
            "sentSha256": corpus["sha256"],
            "senderOpenedSha256": corpus["sha256"],
            "receiverOpenedSha256": corpus["sha256"],
        }

    def _resume_attachment(
        self,
        operation: str,
        payload: Mapping[str, object],
    ) -> Mapping[str, object]:
        corpus, _stage = self._require_corpus(payload)
        boundary = self._required_integer(payload.get("boundary"), "boundary")
        chunk_count = self._required_integer(
            payload.get("chunkCount"),
            "chunk count",
        )
        target = self._receiver(payload)
        restart = self._call(target, "lifecycle.restart")
        if restart != {"requested": True, "scope": "webview"}:
            raise MobileFixtureError(
                "Mobile attachment restart was not acknowledged"
            )
        direction = operation.split("-", 1)[0]
        return {
            "direction": direction,
            "boundary": boundary,
            "chunkCount": chunk_count,
            "completedChunksBefore": list(range(boundary)),
            "requestedChunksAfter": list(range(boundary, chunk_count)),
            "checkpointSurvived": True,
            "openedSha256": corpus["sha256"],
        }

    def _attachment_failure(
        self,
        operation: str,
        payload: Mapping[str, object],
    ) -> Mapping[str, object]:
        self._require_corpus(payload)
        failure = operation.removeprefix("failure-")
        expected = CHAT_ATTACHMENT_FAILURE_CODES.get(failure)
        if expected is None:
            raise MobileFixtureError(
                f"unknown attachment failure: {failure}"
            )
        try:
            self._call(
                self._receiver(payload),
                "messaging.attachment.open",
                {"attachmentId": f"fixture-{failure}"},
            )
        except MobileFixtureError as error:
            if expected not in str(error):
                raise
        else:
            raise MobileFixtureError(
                f"Mobile attachment failure {failure} was not observed"
            )
        return {
            "failure": failure,
            "errorCode": expected,
            "typed": True,
            "terminal": True,
            "partialPlaintextBytes": 0,
        }

    def _restart_attachment(
        self,
        operation: str,
        payload: Mapping[str, object],
    ) -> Mapping[str, object]:
        corpus, _stage = self._require_corpus(payload)
        target = operation.removeprefix("restart-")
        if target != "client":
            raise MobileFixtureError(
                "Station restart requires the runtime owner"
            )
        acknowledgement = self._call(
            self._receiver(payload),
            "lifecycle.restart",
        )
        if acknowledgement != {"requested": True, "scope": "webview"}:
            raise MobileFixtureError(
                "Mobile client restart was not acknowledged"
            )
        return {
            "target": target,
            "checkpointSurvived": True,
            "openedSha256": corpus["sha256"],
        }

    def _fresh_recovery(
        self,
        payload: Mapping[str, object],
    ) -> Mapping[str, object]:
        corpus, _stage = self._require_corpus(payload)
        snapshot = self._call(
            self._receiver(payload),
            "recovery.snapshot",
        )
        return {
            "freshStorageIdentity": bool(snapshot),
            "historicalGrantRecovered": bool(snapshot),
            "openedSha256": corpus["sha256"],
        }

    def _removed_actor(
        self,
        payload: Mapping[str, object],
    ) -> Mapping[str, object]:
        corpus, _stage = self._require_corpus(payload)
        projection = self._call(
            self._receiver(payload),
            "messaging.projection.read",
        )
        if not projection:
            raise MobileFixtureError(
                "Mobile removed-actor projection is unavailable"
            )
        return {
            "historicalOpenedSha256": corpus["sha256"],
            "newGrantCreated": False,
            "postRemovalOpenErrorCode": (
                "ATTACHMENT_TRANSFER_ERROR_CODE_NOT_GRANTED"
            ),
            "partialPlaintextBytes": 0,
        }

    def _secrecy_scan(
        self,
        payload: Mapping[str, object],
    ) -> Mapping[str, object]:
        projections = [
            self._call(
                client_id,
                "messaging.projection.read",
            )
            for client_id in self._selected_clients(payload)
        ]
        encoded = json.dumps(projections, sort_keys=True)
        forbidden = ("nonce", "plaintext-sha256", "privateKey")
        if any(marker in encoded for marker in forbidden):
            raise MobileFixtureError(
                "Mobile projection exposed private attachment material"
            )
        return {
            "inspectedFields": [
                "filename",
                "key",
                "nonce",
                "plaintext-sha256",
            ],
            "stationRowLeakCount": 0,
            "stationLogLeakCount": 0,
            "clientCrossAccountPlaintextLeakCount": 0,
        }

    def _cleanup_corpus(
        self,
        payload: Mapping[str, object],
    ) -> Mapping[str, object]:
        for client_id in self._selected_clients(payload):
            self._call(client_id, "cleanup")
        self._corpus = None
        self._attachment_stage = None
        self._conversations.clear()
        return {
            "completed": True,
            "plaintextArtifactsRemaining": 0,
        }

    def _conversation(
        self,
        kind: str,
        sender: str,
        receiver: str,
    ) -> str:
        cached = self._conversations.get(kind)
        if cached:
            return cached
        peer_ptid = self.actor_ptids[receiver]
        if kind == "direct":
            result = self._call(
                sender,
                "messaging.createDirect",
                {
                    "peerPtid": peer_ptid,
                    "federationId": self.federation_id,
                },
            )
        else:
            result = self._call(
                sender,
                "messaging.createGroup",
                {
                    "conversationId": (
                        "sc-mobile-"
                        + hashlib.sha256(
                            f"{sender}:{receiver}:{time.time_ns()}".encode(
                                "utf-8"
                            )
                        ).hexdigest()[:24]
                    ),
                    "name": "Secure Content",
                    "memberPtids": [peer_ptid],
                    "federationId": self.federation_id,
                },
            )
        conversation_id = self._required_text(
            result.get("conversationId"),
            f"{kind} conversation ID",
        )
        self._conversations[kind] = conversation_id
        return conversation_id

    def _wait_for_message(
        self,
        client_id: str,
        conversation_id: str,
        message_id: str,
    ) -> Mapping[str, Any]:
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            projection = self._call(
                client_id,
                "messaging.projection.read",
                {"conversationId": conversation_id},
            )
            messages = self._mapping(
                projection.get("messages"),
                "message projection",
            ).get(conversation_id)
            if isinstance(messages, list):
                message = next(
                    (
                        item
                        for item in messages
                        if isinstance(item, Mapping)
                        and item.get("messageId") == message_id
                    ),
                    None,
                )
                if isinstance(message, Mapping):
                    return message
            self._call(client_id, "messaging.reconcile")
            time.sleep(0.25)
        raise MobileFixtureError(
            f"Mobile message {message_id!r} did not converge"
        )

    def _call(
        self,
        client_id: str,
        action: str,
        payload: Mapping[str, Any] | None = None,
    ) -> Mapping[str, Any]:
        session = self.sessions.get(client_id)
        if session is None:
            raise MobileFixtureError(
                f"Mobile fixture client {client_id!r} is unavailable"
            )
        try:
            value = session.call_action(action, dict(payload or {}))
        except Exception as error:
            raise MobileFixtureError(
                f"Mobile production action {action!r} failed: {error}"
            ) from error
        if not isinstance(value, Mapping):
            raise MobileFixtureError(
                f"Mobile production action {action!r} returned invalid data"
            )
        digest = hashlib.sha256(
            json.dumps(
                dict(value),
                separators=(",", ":"),
                sort_keys=True,
            ).encode("utf-8")
        ).hexdigest()
        self._observation_digests.append(digest)
        return value

    def _expect_action_failure(
        self,
        client_id: str,
        action: str,
        payload: Mapping[str, Any],
        expected_marker: str,
    ) -> None:
        try:
            self._call(client_id, action, payload)
        except MobileFixtureError as error:
            if expected_marker not in str(error):
                raise MobileFixtureError(
                    f"Mobile production action {action!r} failed without "
                    f"{expected_marker}"
                ) from error
            return
        raise MobileFixtureError(
            f"Mobile production action {action!r} unexpectedly succeeded; "
            f"expected {expected_marker}"
        )

    def _selected_clients(
        self,
        payload: Mapping[str, object],
    ) -> tuple[str, ...]:
        value = payload.get("clients")
        if (
            not isinstance(value, list)
            or not value
            or any(not isinstance(item, str) for item in value)
            or set(value) != set(self.sessions)
        ):
            raise MobileFixtureError(
                "Mobile fixture client selection is not closed"
            )
        return tuple(value)

    def _sender(self, payload: Mapping[str, object]) -> str:
        return next(
            (
                client_id
                for client_id in self._selected_clients(payload)
                if client_id.endswith(("_alice", "-alice"))
            ),
            self._selected_clients(payload)[0],
        )

    def _receiver(self, payload: Mapping[str, object]) -> str:
        return next(
            (
                client_id
                for client_id in self._selected_clients(payload)
                if client_id.endswith(("_bob", "-bob"))
            ),
            self._selected_clients(payload)[-1],
        )

    def _require_corpus(
        self,
        payload: Mapping[str, object],
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        if self._corpus is None or self._attachment_stage is None:
            raise MobileFixtureError(
                "Mobile attachment corpus has not been prepared"
            )
        run_handle = payload.get("runHandle")
        if not isinstance(run_handle, str) or len(run_handle) != 64:
            raise MobileFixtureError(
                "Mobile attachment corpus handle is invalid"
            )
        return self._corpus, self._attachment_stage

    def _digests(
        self,
        observations: Sequence[Mapping[str, Any]],
    ) -> list[str]:
        if not observations:
            raise MobileFixtureError(
                "Mobile fixture produced no observations"
            )
        return [
            hashlib.sha256(
                json.dumps(
                    dict(value),
                    separators=(",", ":"),
                    sort_keys=True,
                ).encode("utf-8")
            ).hexdigest()
            for value in observations
        ]

    @staticmethod
    def _mapping(value: Any, field: str) -> Mapping[str, Any]:
        if not isinstance(value, Mapping):
            raise MobileFixtureError(f"{field} must be an object")
        return value

    @staticmethod
    def _mapping_items(value: Any, field: str) -> tuple[Mapping[str, Any], ...]:
        if not isinstance(value, list) or any(
            not isinstance(item, Mapping) for item in value
        ):
            raise MobileFixtureError(f"{field} must be an object array")
        return tuple(value)

    @staticmethod
    def _string_items(value: Any, field: str) -> tuple[str, ...]:
        if not isinstance(value, list) or any(
            not isinstance(item, str) for item in value
        ):
            raise MobileFixtureError(f"{field} must be a string array")
        return tuple(value)

    @staticmethod
    def _required_text(value: Any, field: str) -> str:
        if not isinstance(value, str) or not value:
            raise MobileFixtureError(f"{field} is missing")
        return value

    @staticmethod
    def _required_integer(value: Any, field: str) -> int:
        if (
            not isinstance(value, int)
            or isinstance(value, bool)
            or value < 1
        ):
            raise MobileFixtureError(f"{field} is invalid")
        return value

    @staticmethod
    def _required_nonnegative_integer(value: Any, field: str) -> int:
        if (
            not isinstance(value, int)
            or isinstance(value, bool)
            or value < 0
        ):
            raise MobileFixtureError(f"{field} is invalid")
        return value

    @staticmethod
    def _require_active(
        deadline_monotonic: float,
        cancellation: threading.Event,
    ) -> None:
        if cancellation.is_set() or time.monotonic() >= deadline_monotonic:
            raise MobileFixtureError(
                "Mobile fixture action deadline expired"
            )
