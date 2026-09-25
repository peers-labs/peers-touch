from __future__ import annotations

import copy
import unittest
from collections.abc import Mapping
from typing import Any
from unittest.mock import patch

from tooling.acceptance.core import DriverError, GateError
from tooling.acceptance.gates.mobile.messaging_journey import (
    MobileMessagingJourney,
    MessagingActor,
)


class FakeMessagingNetwork:
    def __init__(self) -> None:
        self.conversations: dict[str, dict[str, Any]] = {}
        self.messages: dict[str, list[dict[str, Any]]] = {}
        self.typing: dict[str, dict[str, dict[str, Any]]] = {}
        self.friend_requests: list[dict[str, Any]] = []
        self.actors: dict[str, MessagingActor] = {}
        self.sequence = 0

    def add_conversation(
        self,
        conversation_id: str,
        *,
        kind: int,
        owner_ptid: str,
        member_ptids: list[str],
        name: str = "",
    ) -> None:
        self.conversations[conversation_id] = {
            "conversationId": conversation_id,
            "authorityStationId": "station-primary",
            "kind": kind,
            "name": name,
            "ownerPtid": owner_ptid,
            "memberPtids": member_ptids,
            "membershipEpoch": 1,
            "mlsEpoch": 1 if kind == 2 else 0,
            "active": True,
            "updatedAtUnixMs": 1,
        }
        self.messages.setdefault(conversation_id, [])


class FakeMessagingSession:
    def __init__(
        self,
        network: FakeMessagingNetwork,
        actor: MessagingActor,
    ) -> None:
        self.network = network
        self.actor = actor
        self.active_station = ""
        self.refresh_count = 0
        self.login_emails: list[str] = []
        self.lifecycle_restart_count = 0
        self.social_runtime_active = False
        self.scope_bootstrap_reads_per_refresh = 0
        self.scope_bootstrap_reads_remaining = 0
        self.runtime_phase = "ACTIVE"
        self.lifecycle_scope_phases: list[str] = []
        self.messaging_projection_reads_while_bootstrapping = 0
        self.network.actors[actor.ptid] = actor

    def call_action(
        self,
        action: str,
        payload: Mapping[str, Any] | None = None,
    ) -> Any:
        body = dict(payload or {})
        if action == "station.add":
            self.active_station = self.actor.station_peer_id
            return {
                "verifiedStationPeerId": self.actor.station_peer_id,
            }
        if action == "access.submit":
            if body["kind"] == "start":
                return {
                    "decision": {
                        "attemptId": f"attempt-{self.actor.client_id}",
                    },
                    "session": None,
                }
            if body.get("password") != "1":
                raise AssertionError("unexpected fixture credential")
            email = body.get("email")
            if not isinstance(email, str):
                raise AssertionError("login email must be a string")
            self.login_emails.append(email)
            return {
                "decision": {"state": "ACCESS_DECISION_STATE_GRANTED"},
                "session": {
                    "stationPeerId": self.actor.station_peer_id,
                    "actorPtid": self.actor.ptid,
                },
            }
        if action == "messaging.createDirect":
            peer_ptid = str(body["peerPtid"])
            conversation_id = "-".join(
                sorted((self.actor.ptid, peer_ptid))
            )
            self.network.add_conversation(
                conversation_id,
                kind=1,
                owner_ptid=self.actor.ptid,
                member_ptids=[self.actor.ptid, peer_ptid],
            )
            return {
                "conversationId": conversation_id,
                "state": "projected",
            }
        if action == "social.people.search":
            if set(body) != {"query"}:
                raise AssertionError("search must not accept asserted identity evidence")
            query = str(body["query"])
            return [
                {
                    "ptid": actor.ptid,
                    "federationId": actor.federation_id,
                    "homeStationPeerId": actor.station_peer_id,
                }
                for actor in self.network.actors.values()
                if actor.federated_handle == query
            ]
        if action == "social.request.send":
            if not self.social_runtime_active:
                raise GateError("mobile.social.runtimeUnavailable")
            receiver = self.network.actors[str(body["receiverPtid"])]
            if body["receiverHomeStationPeerId"] != receiver.station_peer_id:
                raise AssertionError("receiver Home Station identity mismatch")
            if body["federationId"] != "federation-1":
                raise AssertionError("receiver Federation identity mismatch")
            self.network.sequence += 1
            self.network.friend_requests.append(
                {
                    "requestId": f"request-{self.network.sequence}",
                    "federationId": body["federationId"],
                    "senderPtid": self.actor.ptid,
                    "receiverPtid": body["receiverPtid"],
                    "senderHomeStationPeerId": self.actor.station_peer_id,
                    "receiverHomeStationPeerId": body[
                        "receiverHomeStationPeerId"
                    ],
                    "status": 1,
                }
            )
            return self._social_projection()
        if action == "social.request.accept":
            request = next(
                request
                for request in self.network.friend_requests
                if request["requestId"] == body["requestId"]
            )
            request["status"] = 2
            conversation_id = "-".join(
                sorted((request["senderPtid"], request["receiverPtid"]))
            )
            self.network.add_conversation(
                conversation_id,
                kind=1,
                owner_ptid=request["senderPtid"],
                member_ptids=[
                    request["senderPtid"],
                    request["receiverPtid"],
                ],
            )
            return self._social_projection()
        if action == "social.reconcile":
            return self._social_projection()
        if action == "messaging.createGroup":
            conversation_id = str(body["conversationId"])
            if body.get("federationId") != self.actor.federation_id:
                raise AssertionError("Group Federation identity mismatch")
            self.network.add_conversation(
                conversation_id,
                kind=2,
                owner_ptid=self.actor.ptid,
                member_ptids=list(body["memberPtids"]),
                name=str(body["name"]),
            )
            return {
                "conversationId": conversation_id,
                "commandId": f"create-{conversation_id}",
                "state": "projected",
            }
        if action == "messaging.typing":
            conversation_id = str(body["conversationId"])
            self.network.typing.setdefault(conversation_id, {})[
                self.actor.ptid
            ] = {
                "typing": bool(body["isTyping"]),
                "lastUpdate": 1,
            }
            return {
                "conversationId": conversation_id,
                "isTyping": bool(body["isTyping"]),
                "submitted": True,
            }
        if action == "social.projection.read":
            return self._social_projection()
        if action == "messaging.attachment.stage":
            return {
                "stageId": f"stage-{self.actor.client_id}",
                "filename": body["filename"],
                "mimeType": body["mimeType"],
                "plaintextSize": 41,
                "completed": True,
            }
        if action == "messaging.send":
            self.network.sequence += 1
            message_id = f"message-{self.network.sequence}"
            attachment_ids = (
                [f"attachment-{self.network.sequence}"]
                if body.get("attachmentStageIds")
                else []
            )
            self.network.messages[str(body["conversationId"])].append(
                {
                    "eventId": f"event-{self.network.sequence}",
                    "eventSequence": self.network.sequence,
                    "messageId": message_id,
                    "senderPtid": self.actor.ptid,
                    "state": "delivered",
                    "timestampUnixMs": self.network.sequence,
                    "retracted": False,
                    "reactions": [],
                    "readByPtids": [],
                    "plaintext": body["plaintext"],
                    "attachments": [
                        {
                            "attachmentId": attachment_id,
                            "filename": "acceptance.txt",
                            "mimeType": "text/plain",
                            "plaintextSize": 41,
                            "availabilityState": "local",
                        }
                        for attachment_id in attachment_ids
                    ],
                }
            )
            return {
                "conversationId": body["conversationId"],
                "commandId": f"command-{self.network.sequence}",
                "messageId": message_id,
                "attachmentIds": attachment_ids,
                "state": "pending",
            }
        if action == "messaging.interact":
            message = self._message(
                str(body["conversationId"]),
                str(body["messageId"]),
            )
            if body["kind"] == "reaction":
                message["reactions"].append(
                    {
                        "actorPtid": self.actor.ptid,
                        "reaction": body["reaction"],
                        "createdAtUnixMs": 2,
                    }
                )
            elif body["kind"] == "edit":
                message["editedText"] = body["plaintext"]
                message["editedAtUnixMs"] = 2
            return {
                "conversationId": body["conversationId"],
                "commandId": f"interaction-{body['messageId']}",
                "messageId": body["messageId"],
                "attachmentIds": [],
                "state": "pending",
            }
        if action == "messaging.read":
            conversation_id = str(body["conversationId"])
            for message in self.network.messages[conversation_id]:
                if message["eventSequence"] <= body["lastReadSequence"]:
                    message["readByPtids"] = sorted(
                        {
                            *message["readByPtids"],
                            self.actor.ptid,
                        }
                    )
                    message["state"] = "read"
            return {
                "conversationId": conversation_id,
                "lastReadSequence": body["lastReadSequence"],
                "submitted": True,
            }
        if action == "messaging.search":
            query = str(body["query"])
            return [
                copy.deepcopy(message)
                for message in self.network.messages[str(body["conversationId"])]
                if query in (
                    str(message.get("editedText") or "")
                    or str(message["plaintext"])
                )
            ]
        if action == "messaging.reconcile":
            return {
                "deviceEnrolled": True,
                "processed": 0,
                "cursor": self.network.sequence,
                "laneHead": self.network.sequence,
                "consumerEpoch": 1,
                "deliveryReceiptSubmitted": False,
                "commandState": "idle",
            }
        if action == "messaging.projection.read":
            if self.runtime_phase != "ACTIVE":
                self.messaging_projection_reads_while_bootstrapping += 1
            return {
                "runtime": {
                    "active": True,
                    "deviceEnrolled": True,
                    "laneSequence": self.network.sequence,
                    "consumerEpoch": 1,
                    "conversationCount": len(self.network.conversations),
                    "activationGeneration": 1,
                    "workerPhase": "running",
                },
                "conversations": copy.deepcopy(
                    list(self.network.conversations.values())
                ),
                "messages": copy.deepcopy(self.network.messages),
            }
        if action == "messaging.attachment.open":
            return {"state": "ready", "available": True}
        if action == "lifecycle.restart":
            self.lifecycle_restart_count += 1
            self.social_runtime_active = True
            self.scope_bootstrap_reads_remaining = (
                self.scope_bootstrap_reads_per_refresh
            )
            self.runtime_phase = (
                "BOOTSTRAPPING"
                if self.scope_bootstrap_reads_remaining > 0
                else "ACTIVE"
            )
            return {"requested": True, "scope": "webview"}
        if action == "lifecycle.scope.read":
            if self.scope_bootstrap_reads_remaining > 0:
                self.scope_bootstrap_reads_remaining -= 1
                self.runtime_phase = "BOOTSTRAPPING"
                actor_ptid = None
                runtime_station_peer_id = None
                launch_state = "app-boot"
            else:
                self.runtime_phase = "ACTIVE"
                actor_ptid = self.actor.ptid
                runtime_station_peer_id = self.actor.station_peer_id
                launch_state = "shell"
            self.lifecycle_scope_phases.append(self.runtime_phase)
            return {
                "generation": self.lifecycle_restart_count,
                "phase": self.runtime_phase,
                "launchState": launch_state,
                "activeStationPeerId": self.actor.station_peer_id,
                "activeActorPtid": actor_ptid,
                "runtimeStationPeerId": runtime_station_peer_id,
            }
        raise AssertionError(f"unexpected action: {action}")

    def refresh_webview(self) -> None:
        self.refresh_count += 1
        self.social_runtime_active = True
        self.scope_bootstrap_reads_remaining = (
            self.scope_bootstrap_reads_per_refresh
        )
        self.runtime_phase = (
            "BOOTSTRAPPING"
            if self.scope_bootstrap_reads_remaining > 0
            else "ACTIVE"
        )

    def switch_to_app_webview(self, timeout: float = 30.0) -> str:
        del timeout
        return "WEBVIEW_peers"

    def _message(
        self,
        conversation_id: str,
        message_id: str,
    ) -> dict[str, Any]:
        return next(
            message
            for message in self.network.messages[conversation_id]
            if message["messageId"] == message_id
        )

    def _social_projection(self) -> dict[str, Any]:
        return {
            "active": self.social_runtime_active,
            "activeSessionUlid": None,
            "friendRequests": copy.deepcopy(self.network.friend_requests),
            "typingPeers": copy.deepcopy(self.network.typing),
            "peerOnline": {},
            "lastReconcileAt": 1,
            "ingress": {
                "lifecycle": "active",
                "streamCursor": "event-1",
                "writeAdmissionOpen": True,
                "staleDomains": [],
                "dataQueueDepth": 0,
                "controlQueueDepth": 0,
            },
        }


class IncrementingClock:
    def __init__(self) -> None:
        self.value = 0.0

    def monotonic(self) -> float:
        self.value += 0.001
        return self.value

    def sleep(self, seconds: float) -> None:
        self.value += seconds


class MobileMessagingJourneyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.network = FakeMessagingNetwork()
        self.sender = MessagingActor(
            client_id="sim-ios",
            role="alice",
            station_url="https://station-primary.example",
            station_peer_id="station-primary",
            ptid="ptid:alice",
            account_ref="station-account:alice@p.t",
            federated_handle="@alice@station-primary.example",
            federation_id="federation-1",
        )
        self.receiver = MessagingActor(
            client_id="sim-ios-peer",
            role="bob",
            station_url="https://station-secondary.example",
            station_peer_id="station-secondary",
            ptid="ptid:bob",
            account_ref="station-account:bob@p.t",
            federated_handle="@bob@station-secondary.example",
            federation_id="federation-1",
        )
        self.sender_session = FakeMessagingSession(self.network, self.sender)
        self.receiver_session = FakeMessagingSession(
            self.network,
            self.receiver,
        )
        clock = IncrementingClock()
        self.journey = MobileMessagingJourney(
            timeout_seconds=1,
            poll_interval_seconds=0.01,
            monotonic=clock.monotonic,
            sleep=clock.sleep,
        )

    def test_social_convergence_proves_typing_delivery_and_receipt(self) -> None:
        self.journey.authenticate(self.sender_session, self.sender, password="1")
        self.journey.authenticate(
            self.receiver_session,
            self.receiver,
            password="1",
        )

        result = self.journey.run_social_convergence(
            sender_session=self.sender_session,
            receiver_session=self.receiver_session,
            sender=self.sender,
            receiver=self.receiver,
            journey_id="social",
        )

        self.assertEqual(result["scenario"], "social-convergence")
        self.assertEqual(result["senderPtid"], "ptid:alice")
        self.assertEqual(result["receiverPtid"], "ptid:bob")
        self.assertGreaterEqual(result["deliveryElapsedMs"], 0)
        message = self.network.messages[result["conversationId"]][0]
        self.assertIn("ptid:bob", message["readByPtids"])

    def test_authentication_resolves_canonical_station_account_reference(
        self,
    ) -> None:
        self.sender_session.scope_bootstrap_reads_per_refresh = 1
        self.journey.authenticate(
            self.sender_session,
            self.sender,
            password="1",
        )

        self.assertEqual(self.sender_session.login_emails, ["alice@p.t"])
        self.assertEqual(self.sender_session.lifecycle_restart_count, 1)
        self.assertEqual(self.sender_session.refresh_count, 0)
        self.assertTrue(self.sender_session.social_runtime_active)
        self.assertEqual(
            self.sender_session.lifecycle_scope_phases,
            ["BOOTSTRAPPING", "ACTIVE"],
        )

    def test_post_restart_waits_for_full_harness_registration(self) -> None:
        actor = self.sender

        class Session:
            def __init__(self) -> None:
                self.scope_attempts = 0
                self.social_attempts = 0

            def call_action(
                self,
                action: str,
                _payload: Mapping[str, Any] | None = None,
            ) -> Any:
                if action == "lifecycle.restart":
                    return {"requested": True, "scope": "webview"}
                if action == "lifecycle.scope.read":
                    self.scope_attempts += 1
                    if self.scope_attempts == 1:
                        raise DriverError(
                            "acceptance.mobile.actionUnavailable:"
                            "lifecycle.scope.read"
                        )
                    return {
                        "phase": "ACTIVE",
                        "activeStationPeerId": actor.station_peer_id,
                        "runtimeStationPeerId": actor.station_peer_id,
                        "activeActorPtid": actor.ptid,
                    }
                if action == "social.projection.read":
                    self.social_attempts += 1
                    if self.social_attempts == 1:
                        raise DriverError(
                            "acceptance.mobile.actionUnavailable:"
                            "social.projection.read"
                        )
                    return {
                        "active": True,
                        "ingress": {
                            "lifecycle": "active",
                            "writeAdmissionOpen": True,
                            "staleDomains": [],
                        },
                    }
                raise AssertionError(action)

            def refresh_webview(self) -> None:
                return None

            def switch_to_app_webview(
                self,
                timeout: float = 30.0,
            ) -> str:
                del timeout
                return "WEBVIEW_peers"

        session = Session()
        journey = MobileMessagingJourney(
            timeout_seconds=0.1,
            poll_interval_seconds=0.001,
        )

        journey._activate_authenticated_shell(session, actor)

        self.assertEqual(session.scope_attempts, 2)
        self.assertEqual(session.social_attempts, 2)

    def test_authentication_rejects_non_station_account_reference(self) -> None:
        malformed = MessagingActor(
            client_id="sim-ios",
            role="alice",
            station_url=self.sender.station_url,
            station_peer_id=self.sender.station_peer_id,
            ptid=self.sender.ptid,
            account_ref="fixture:alice",
            federated_handle=self.sender.federated_handle,
            federation_id=self.sender.federation_id,
        )

        with self.assertRaisesRegex(GateError, "must be Station-owned"):
            self.journey.authenticate(
                self.sender_session,
                malformed,
                password="1",
            )

        self.assertEqual(self.sender_session.active_station, "")
        self.assertEqual(self.sender_session.login_emails, [])
        self.assertEqual(self.sender_session.lifecycle_restart_count, 0)
        self.assertEqual(self.sender_session.refresh_count, 0)

    def test_chat_contacts_waits_for_authenticated_runtime_after_restart(
        self,
    ) -> None:
        self.journey.authenticate(self.sender_session, self.sender, password="1")
        self.journey.authenticate(
            self.receiver_session,
            self.receiver,
            password="1",
        )
        self.receiver_session.lifecycle_scope_phases.clear()
        self.receiver_session.scope_bootstrap_reads_per_refresh = 1

        result = self.journey.run_chat_contacts(
            sender_session=self.sender_session,
            receiver_session=self.receiver_session,
            sender=self.sender,
            receiver=self.receiver,
            journey_id="chat",
        )

        self.assertEqual(result["scenario"], "chat-contacts")
        for kind in ("direct", "group"):
            self.assertTrue(result[kind]["restartReadback"])
            self.assertTrue(result[kind]["searchReadback"])
            self.assertTrue(result[kind]["interactionReadback"])
            self.assertTrue(result[kind]["receiptReadback"])
        self.assertEqual(self.receiver_session.refresh_count, 0)
        self.assertEqual(
            self.receiver_session.lifecycle_scope_phases,
            [
                "BOOTSTRAPPING",
                "ACTIVE",
                "BOOTSTRAPPING",
                "ACTIVE",
            ],
        )
        self.assertEqual(
            self.receiver_session.messaging_projection_reads_while_bootstrapping,
            0,
        )

    def test_attachment_journey_rejects_public_type_as_private_mime(self) -> None:
        self.journey.authenticate(self.sender_session, self.sender, password="1")
        self.journey.authenticate(
            self.receiver_session, self.receiver, password="1"
        )
        original_call = self.receiver_session.call_action

        def read_with_invalid_metadata(
            action: str, payload: Mapping[str, Any] | None = None
        ) -> Any:
            result = original_call(action, payload)
            if action == "messaging.projection.read":
                for messages in result["messages"].values():
                    for message in messages:
                        for attachment in message["attachments"]:
                            attachment["mimeType"] = "application/octet-stream"
            return result

        with patch.object(
            self.receiver_session, "call_action", side_effect=read_with_invalid_metadata
        ), self.assertRaisesRegex(GateError, "private metadata changed"):
            self.journey.run_chat_contacts(
                sender_session=self.sender_session,
                receiver_session=self.receiver_session,
                sender=self.sender,
                receiver=self.receiver,
                journey_id="private-mime",
            )

    def test_authentication_rejects_wrong_fixture_identity(self) -> None:
        wrong = MessagingActor(
            client_id="sim-ios",
            role="alice",
            station_url=self.sender.station_url,
            station_peer_id=self.sender.station_peer_id,
            ptid="ptid:other",
            account_ref=self.sender.account_ref,
            federated_handle=self.sender.federated_handle,
            federation_id=self.sender.federation_id,
        )

        with self.assertRaisesRegex(GateError, "does not match"):
            self.journey.authenticate(
                self.sender_session,
                wrong,
                password="1",
            )

    def test_timeout_remains_a_gate_failure(self) -> None:
        class EmptySession(FakeMessagingSession):
            def call_action(
                self,
                action: str,
                payload: Mapping[str, Any] | None = None,
            ) -> Any:
                if action == "messaging.projection.read":
                    return {
                        "runtime": {},
                        "conversations": [],
                        "messages": {},
                    }
                return super().call_action(action, payload)

        sender_session = EmptySession(self.network, self.sender)
        receiver_session = EmptySession(self.network, self.receiver)
        sender_session.social_runtime_active = True
        receiver_session.social_runtime_active = True

        with self.assertRaisesRegex(GateError, "did not converge"):
            self.journey.run_social_convergence(
                sender_session=sender_session,
                receiver_session=receiver_session,
                sender=self.sender,
                receiver=self.receiver,
                journey_id="timeout",
            )


if __name__ == "__main__":
    unittest.main()
