"""Shared production-action journey for Mobile Messaging Acceptance."""

from __future__ import annotations

import base64
import hashlib
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, Protocol

from tooling.acceptance.core import GateError


ATTACHMENT_BYTES = b"peers-touch mobile acceptance attachment\n"
STATION_ACCOUNT_REF_PREFIX = "station-account:"
TERMINAL_FAILURE_STATES = frozenset({"failed", "terminal", "superseded"})


class MessagingJourneySession(Protocol):
    def call_action(
        self,
        action: str,
        payload: Mapping[str, Any] | None = None,
    ) -> Any:
        ...

    def refresh_webview(self) -> None:
        ...

    def switch_to_app_webview(self, timeout: float = 30.0) -> str:
        ...


@dataclass(frozen=True)
class MessagingActor:
    client_id: str
    role: str
    station_url: str
    station_peer_id: str
    ptid: str
    account_ref: str
    federated_handle: str
    federation_id: str


class MobileMessagingJourney:
    def __init__(
        self,
        *,
        timeout_seconds: float = 30.0,
        poll_interval_seconds: float = 0.25,
        monotonic: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        if timeout_seconds <= 0 or poll_interval_seconds <= 0:
            raise ValueError("Messaging journey timeouts must be positive")
        self.timeout_seconds = timeout_seconds
        self.poll_interval_seconds = poll_interval_seconds
        self.monotonic = monotonic
        self.sleep = sleep

    def authenticate(
        self,
        session: MessagingJourneySession,
        actor: MessagingActor,
        *,
        password: str,
    ) -> dict[str, str]:
        email = self._station_account_email(actor)
        station = self._mapping(
            session.call_action("station.add", {"url": actor.station_url}),
            f"{actor.client_id} station.add",
        )
        if station.get("verifiedStationPeerId") != actor.station_peer_id:
            raise GateError(
                f"{actor.client_id} verified the wrong Station identity"
            )
        started = self._mapping(
            session.call_action("access.submit", {"kind": "start"}),
            f"{actor.client_id} access start",
        )
        decision = self._mapping(
            started.get("decision"),
            f"{actor.client_id} access decision",
        )
        attempt_id = self._text(
            decision.get("attemptId"),
            f"{actor.client_id} access attempt",
        )
        authenticated = self._mapping(
            session.call_action(
                "access.submit",
                {
                    "kind": "login",
                    "attemptId": attempt_id,
                    "email": email,
                    "password": password,
                },
            ),
            f"{actor.client_id} login",
        )
        authenticated_session = self._mapping(
            authenticated.get("session"),
            f"{actor.client_id} authenticated session",
        )
        if (
            authenticated_session.get("stationPeerId") != actor.station_peer_id
            or authenticated_session.get("actorPtid") != actor.ptid
        ):
            raise GateError(
                f"{actor.client_id} authenticated identity does not match its Fixture"
            )
        self._activate_authenticated_shell(session, actor)
        return {
            "clientId": actor.client_id,
            "stationPeerId": actor.station_peer_id,
            "actorPtid": actor.ptid,
        }

    def run_social_convergence(
        self,
        *,
        sender_session: MessagingJourneySession,
        receiver_session: MessagingJourneySession,
        sender: MessagingActor,
        receiver: MessagingActor,
        journey_id: str,
    ) -> dict[str, Any]:
        started_at = self.monotonic()
        conversation_id = self._create_direct(
            sender_session,
            receiver_session,
            sender,
            receiver,
        )
        sender_session.call_action(
            "messaging.typing",
            {"conversationId": conversation_id, "isTyping": True},
        )
        typing_elapsed_ms = self._await_condition(
            lambda: self._typing_visible(
                receiver_session,
                conversation_id,
                sender.ptid,
            ),
            f"{receiver.client_id} typing projection",
        )
        text = f"mobile-social-{journey_id}"
        submitted = self._mapping(
            sender_session.call_action(
                "messaging.send",
                {
                    "conversationId": conversation_id,
                    "plaintext": text,
                },
            ),
            "Direct send",
        )
        message_id = self._text(submitted.get("messageId"), "Direct message ID")
        delivered, delivery_elapsed_ms = self._await_message(
            receiver_session,
            conversation_id,
            message_id,
            lambda message: message.get("plaintext") == text,
            f"{receiver.client_id} Direct delivery",
        )
        event_sequence = self._positive_int(
            delivered.get("eventSequence"),
            "Direct event sequence",
        )
        receiver_session.call_action(
            "messaging.read",
            {
                "conversationId": conversation_id,
                "lastReadSequence": event_sequence,
            },
        )
        _, receipt_elapsed_ms = self._await_message(
            sender_session,
            conversation_id,
            message_id,
            lambda message: receiver.ptid in message.get("readByPtids", []),
            f"{sender.client_id} Direct read receipt",
        )
        total_elapsed_ms = int((self.monotonic() - started_at) * 1000)
        return {
            "scenario": "social-convergence",
            "conversationId": conversation_id,
            "messageId": message_id,
            "senderPtid": sender.ptid,
            "receiverPtid": receiver.ptid,
            "typingVisibleElapsedMs": typing_elapsed_ms,
            "deliveryElapsedMs": delivery_elapsed_ms,
            "receiptElapsedMs": receipt_elapsed_ms,
            "totalElapsedMs": total_elapsed_ms,
        }

    def run_chat_contacts(
        self,
        *,
        sender_session: MessagingJourneySession,
        receiver_session: MessagingJourneySession,
        sender: MessagingActor,
        receiver: MessagingActor,
        journey_id: str,
    ) -> dict[str, Any]:
        direct_id = self._create_direct(
            sender_session,
            receiver_session,
            sender,
            receiver,
        )
        direct = self._run_attachment_and_interaction_path(
            sender_session=sender_session,
            receiver_session=receiver_session,
            sender=sender,
            receiver=receiver,
            conversation_id=direct_id,
            text=f"mobile-direct-{journey_id}",
        )

        group_id = f"mobile-group-{journey_id}"
        created = self._mapping(
            sender_session.call_action(
                "messaging.createGroup",
                {
                    "conversationId": group_id,
                    "name": f"Acceptance {journey_id}",
                    "memberPtids": [sender.ptid, receiver.ptid],
                    "federationId": sender.federation_id,
                },
            ),
            "Group creation",
        )
        if created.get("conversationId") != group_id:
            raise GateError("Group creation returned the wrong conversation ID")
        self._await_conversation(sender_session, group_id, kind=2)
        self._await_conversation(receiver_session, group_id, kind=2)
        group = self._run_attachment_and_interaction_path(
            sender_session=sender_session,
            receiver_session=receiver_session,
            sender=sender,
            receiver=receiver,
            conversation_id=group_id,
            text=f"mobile-group-{journey_id}",
        )
        return {
            "scenario": "chat-contacts",
            "senderPtid": sender.ptid,
            "receiverPtid": receiver.ptid,
            "direct": direct,
            "group": group,
        }

    def _create_direct(
        self,
        sender_session: MessagingJourneySession,
        receiver_session: MessagingJourneySession,
        sender: MessagingActor,
        receiver: MessagingActor,
    ) -> str:
        if sender.federation_id != receiver.federation_id:
            raise GateError("Mobile actors do not share one explicit Federation")
        results = sender_session.call_action(
            "social.people.search",
            {
                "query": receiver.federated_handle,
            },
        )
        if not isinstance(results, list):
            raise GateError("Federated actor search must return a list")
        result = next(
            (
                dict(value)
                for value in results
                if isinstance(value, Mapping)
                and value.get("ptid") == receiver.ptid
            ),
            None,
        )
        if result is None:
            populated_ptids = sum(
                1
                for value in results
                if isinstance(value, Mapping)
                and isinstance(value.get("ptid"), str)
                and bool(value["ptid"].strip())
            )
            raise GateError(
                f"{sender.client_id} did not resolve the receiver identity "
                f"(results={len(results)}, populatedPtids={populated_ptids})"
            )
        receiver_home_station_peer_id = self._text(
            result.get("homeStationPeerId"),
            "Receiver Home Station peer ID",
        )
        if receiver_home_station_peer_id != receiver.station_peer_id:
            raise GateError(
                f"{sender.client_id} resolved the receiver to the wrong Home Station"
            )
        federation_id = self._text(result.get("federationId"), "Federation ID")
        if federation_id != sender.federation_id:
            raise GateError(
                f"{sender.client_id} resolved the receiver in the wrong Federation"
            )
        sender_session.call_action(
            "social.request.send",
            {
                "receiverPtid": receiver.ptid,
                "receiverHomeStationPeerId": receiver_home_station_peer_id,
                "federationId": federation_id,
                "message": "mobile acceptance",
            },
        )
        request: dict[str, Any] = {}

        def request_visible() -> bool:
            nonlocal request
            receiver_session.call_action("social.reconcile")
            projection = self._mapping(
                receiver_session.call_action("social.projection.read"),
                "Receiver Social projection",
            )
            requests = projection.get("friendRequests")
            if not isinstance(requests, list):
                return False
            for value in requests:
                if not isinstance(value, Mapping):
                    continue
                if (
                    value.get("senderPtid") == sender.ptid
                    and value.get("receiverPtid") == receiver.ptid
                ):
                    request = dict(value)
                    return True
            return False

        self._await_condition(
            request_visible,
            f"{receiver.client_id} friend request",
        )
        request_id = self._text(request.get("requestId"), "Friend request ID")
        receiver_session.call_action(
            "social.request.accept",
            {"requestId": request_id},
        )
        conversation: dict[str, Any] = {}

        def direct_visible() -> bool:
            nonlocal conversation
            projection = self._projection(sender_session)
            candidates = projection.get("conversations")
            if not isinstance(candidates, list):
                return False
            expected_members = {sender.ptid, receiver.ptid}
            for value in candidates:
                if not isinstance(value, Mapping):
                    continue
                member_ptids = value.get("memberPtids")
                if (
                    value.get("kind") == 1
                    and value.get("active") is True
                    and isinstance(member_ptids, list)
                    and set(member_ptids) == expected_members
                ):
                    conversation = dict(value)
                    return True
            return False

        self._await_condition(
            direct_visible,
            f"{sender.client_id} Direct conversation",
        )
        conversation_id = self._text(
            conversation.get("conversationId"),
            "Direct conversation ID",
        )
        self._await_conversation(receiver_session, conversation_id, kind=1)
        return conversation_id

    def create_direct_explicitly(
        self,
        sender_session: MessagingJourneySession,
        receiver_session: MessagingJourneySession,
        receiver: MessagingActor,
    ) -> str:
        created = self._mapping(
            sender_session.call_action(
                "messaging.createDirect",
                {"peerPtid": receiver.ptid},
            ),
            "Direct creation",
        )
        conversation_id = self._text(
            created.get("conversationId"),
            "Direct conversation ID",
        )
        self._await_conversation(sender_session, conversation_id, kind=1)
        self._await_conversation(receiver_session, conversation_id, kind=1)
        return conversation_id

    def _run_attachment_and_interaction_path(
        self,
        *,
        sender_session: MessagingJourneySession,
        receiver_session: MessagingJourneySession,
        sender: MessagingActor,
        receiver: MessagingActor,
        conversation_id: str,
        text: str,
    ) -> dict[str, Any]:
        attachment = self._mapping(
            sender_session.call_action(
                "messaging.attachment.stage",
                {
                    "filename": "acceptance.txt",
                    "mimeType": "text/plain",
                    "bytesBase64": base64.b64encode(ATTACHMENT_BYTES).decode("ascii"),
                    "sha256": hashlib.sha256(ATTACHMENT_BYTES).hexdigest(),
                },
            ),
            "Attachment stage",
        )
        stage_id = self._text(attachment.get("stageId"), "Attachment stage ID")
        submitted = self._mapping(
            sender_session.call_action(
                "messaging.send",
                {
                    "conversationId": conversation_id,
                    "plaintext": text,
                    "attachmentStageIds": [stage_id],
                },
            ),
            "Attachment message send",
        )
        message_id = self._text(
            submitted.get("messageId"),
            "Attachment message ID",
        )
        delivered, delivery_elapsed_ms = self._await_message(
            receiver_session,
            conversation_id,
            message_id,
            lambda message: (
                message.get("plaintext") == text
                and len(message.get("attachments", [])) == 1
            ),
            "receiver attachment delivery",
        )
        attachments = delivered.get("attachments")
        if not isinstance(attachments, list) or len(attachments) != 1:
            raise GateError("Receiver attachment projection is incomplete")
        attachment_id = self._text(
            self._mapping(attachments[0], "Receiver attachment").get(
                "attachmentId"
            ),
            "Receiver attachment ID",
        )
        self._await_condition(
            lambda: self._attachment_available(receiver_session, attachment_id),
            "receiver attachment open",
        )

        receiver_session.call_action(
            "messaging.interact",
            {
                "kind": "reaction",
                "conversationId": conversation_id,
                "messageId": message_id,
                "reaction": "ack",
                "remove": False,
            },
        )
        self._await_message(
            sender_session,
            conversation_id,
            message_id,
            lambda message: any(
                reaction.get("actorPtid") == receiver.ptid
                and reaction.get("reaction") == "ack"
                for reaction in message.get("reactions", [])
                if isinstance(reaction, Mapping)
            ),
            "sender reaction readback",
        )
        edited_text = f"{text}-edited"
        sender_session.call_action(
            "messaging.interact",
            {
                "kind": "edit",
                "conversationId": conversation_id,
                "messageId": message_id,
                "plaintext": edited_text,
            },
        )
        edited, _ = self._await_message(
            receiver_session,
            conversation_id,
            message_id,
            lambda message: message.get("editedText") == edited_text,
            "receiver edit readback",
        )
        event_sequence = self._positive_int(
            edited.get("eventSequence"),
            "Attachment message event sequence",
        )
        receiver_session.call_action(
            "messaging.read",
            {
                "conversationId": conversation_id,
                "lastReadSequence": event_sequence,
            },
        )
        self._await_message(
            sender_session,
            conversation_id,
            message_id,
            lambda message: receiver.ptid in message.get("readByPtids", []),
            "sender attachment read receipt",
        )
        searched = receiver_session.call_action(
            "messaging.search",
            {
                "conversationId": conversation_id,
                "query": edited_text,
                "limit": 20,
            },
        )
        if not isinstance(searched, list) or not any(
            isinstance(message, Mapping)
            and message.get("messageId") == message_id
            for message in searched
        ):
            raise GateError("Receiver search did not return the edited message")

        restart = self._mapping(
            receiver_session.call_action("lifecycle.restart"),
            "Receiver lifecycle restart",
        )
        if restart != {"requested": True, "scope": "webview"}:
            raise GateError("Receiver lifecycle restart was not acknowledged")
        receiver_session.refresh_webview()
        receiver_session.switch_to_app_webview()
        self._await_authenticated_runtime_scope(
            receiver_session,
            receiver,
        )
        self._await_message(
            receiver_session,
            conversation_id,
            message_id,
            lambda message: (
                message.get("editedText") == edited_text
                and len(message.get("attachments", [])) == 1
            ),
            "receiver restart readback",
        )
        return {
            "conversationId": conversation_id,
            "messageId": message_id,
            "attachmentId": attachment_id,
            "deliveryElapsedMs": delivery_elapsed_ms,
            "restartReadback": True,
            "searchReadback": True,
            "interactionReadback": True,
            "receiptReadback": True,
        }

    def _await_conversation(
        self,
        session: MessagingJourneySession,
        conversation_id: str,
        *,
        kind: int,
    ) -> int:
        return self._await_condition(
            lambda: any(
                conversation.get("conversationId") == conversation_id
                and conversation.get("kind") == kind
                and conversation.get("active") is True
                for conversation in self._projection(session).get(
                    "conversations",
                    [],
                )
                if isinstance(conversation, Mapping)
            ),
            f"conversation projection {conversation_id}",
        )

    def _await_message(
        self,
        session: MessagingJourneySession,
        conversation_id: str,
        message_id: str,
        predicate: Callable[[Mapping[str, Any]], bool],
        label: str,
    ) -> tuple[dict[str, Any], int]:
        observed: dict[str, Any] = {}

        def check() -> bool:
            nonlocal observed
            messages = self._projection(session).get("messages", {}).get(
                conversation_id,
                [],
            )
            for value in messages:
                if not isinstance(value, Mapping):
                    continue
                if value.get("messageId") != message_id:
                    continue
                if value.get("state") in TERMINAL_FAILURE_STATES:
                    raise GateError(f"{label} reached a terminal failure state")
                observed = dict(value)
                return predicate(value)
            return False

        elapsed_ms = self._await_condition(check, label)
        return observed, elapsed_ms

    def _await_authenticated_runtime_scope(
        self,
        session: MessagingJourneySession,
        actor: MessagingActor,
    ) -> int:
        def ready() -> bool:
            scope = self._mapping(
                session.call_action("lifecycle.scope.read"),
                f"{actor.client_id} lifecycle scope",
            )
            return (
                scope.get("phase") == "ACTIVE"
                and scope.get("activeStationPeerId")
                == actor.station_peer_id
                and scope.get("runtimeStationPeerId")
                == actor.station_peer_id
                and scope.get("activeActorPtid") == actor.ptid
            )

        return self._await_condition(
            ready,
            f"{actor.client_id} authenticated runtime",
        )

    def _projection(
        self,
        session: MessagingJourneySession,
    ) -> dict[str, Any]:
        session.call_action("messaging.reconcile")
        return self._mapping(
            session.call_action("messaging.projection.read", {}),
            "Messaging projection",
        )

    def _typing_visible(
        self,
        session: MessagingJourneySession,
        conversation_id: str,
        actor_ptid: str,
    ) -> bool:
        projection = self._mapping(
            session.call_action("social.projection.read"),
            "Social projection",
        )
        typing_peers = projection.get("typingPeers")
        peers = (
            typing_peers.get(conversation_id)
            if isinstance(typing_peers, Mapping)
            else None
        )
        entry = peers.get(actor_ptid) if isinstance(peers, Mapping) else None
        return isinstance(entry, Mapping) and entry.get("typing") is True

    @staticmethod
    def _attachment_available(
        session: MessagingJourneySession,
        attachment_id: str,
    ) -> bool:
        opened = session.call_action(
            "messaging.attachment.open",
            {"attachmentId": attachment_id},
        )
        return isinstance(opened, Mapping) and (
            opened.get("state") == "ready"
            and opened.get("available") is True
        )

    def _await_condition(
        self,
        predicate: Callable[[], bool],
        label: str,
    ) -> int:
        started_at = self.monotonic()
        deadline = started_at + self.timeout_seconds
        while self.monotonic() < deadline:
            if predicate():
                return int((self.monotonic() - started_at) * 1000)
            self.sleep(self.poll_interval_seconds)
        raise GateError(f"{label} did not converge before timeout")

    @staticmethod
    def _mapping(value: object, label: str) -> dict[str, Any]:
        if not isinstance(value, Mapping):
            raise GateError(f"{label} must return an object")
        return dict(value)

    @staticmethod
    def _text(value: object, label: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise GateError(f"{label} must be a non-empty string")
        return value

    def _activate_authenticated_shell(
        self,
        session: MessagingJourneySession,
        actor: MessagingActor,
    ) -> None:
        restart = self._mapping(
            session.call_action("lifecycle.restart"),
            f"{actor.client_id} post-login restart",
        )
        if restart != {"requested": True, "scope": "webview"}:
            raise GateError(
                f"{actor.client_id} post-login restart was not acknowledged"
            )
        session.refresh_webview()
        session.switch_to_app_webview()
        self._await_authenticated_runtime_scope(session, actor)
        self._await_condition(
            lambda: self._social_runtime_active(session, actor.client_id),
            f"{actor.client_id} Social runtime activation",
        )

    @staticmethod
    def _social_runtime_active(
        session: MessagingJourneySession,
        client_id: str,
    ) -> bool:
        projection = MobileMessagingJourney._mapping(
            session.call_action("social.projection.read"),
            f"{client_id} Social projection",
        )
        return projection.get("active") is True

    @staticmethod
    def _station_account_email(actor: MessagingActor) -> str:
        if not actor.account_ref.startswith(STATION_ACCOUNT_REF_PREFIX):
            raise GateError(
                f"{actor.client_id} accountRef must be Station-owned"
            )
        return MobileMessagingJourney._text(
            actor.account_ref.removeprefix(STATION_ACCOUNT_REF_PREFIX),
            f"{actor.client_id} Station account email",
        )

    @staticmethod
    def _positive_int(value: object, label: str) -> int:
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise GateError(f"{label} must be a positive integer")
        return value
