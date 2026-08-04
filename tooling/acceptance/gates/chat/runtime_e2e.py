#!/usr/bin/env python3
"""Chat runtime acceptance gate.

This gate exercises the real Station friend_chat runtime on a running Station:

1. create two temporary test actors through /actor/sign-up + /actor/login;
2. create a friend-chat session as actor A with actor B;
3. send one message from A to B;
4. list the message as B from the Station persistence API;
5. mark the message read as B and verify A observes the read status.

It deliberately does not claim DOM-level Desktop E2E or two-client live SSE
delivery. Those remain separate, explicit unproven scopes.
"""

from __future__ import annotations

import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any


DEFAULT_STATION_URL = "http://10.37.94.156:18180"


@dataclass
class ActorLogin:
    name: str
    token: str
    actor_id: str


class GateError(RuntimeError):
    pass


def station_url() -> str:
    return os.environ.get("CHAT_RUNTIME_STATION_URL", DEFAULT_STATION_URL).rstrip("/")


def require_disposable_station(base: str) -> None:
    hostname = urllib.parse.urlparse(base).hostname
    if hostname in {"127.0.0.1", "localhost", "::1"}:
        return
    if os.environ.get("PT_ACCEPTANCE_ALLOW_SHARED_TEMP_ACTORS") == "1":
        return
    raise GateError(
        "temporary actor gate requires a disposable loopback Station; "
        "set PT_ACCEPTANCE_ALLOW_SHARED_TEMP_ACTORS=1 only for an explicitly disposable remote database"
    )


def request(method: str, base: str, path: str, payload: dict[str, Any] | None = None, token: str | None = None) -> dict[str, Any]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Accept": "application/json"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"

    url = base + path
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=25) as response:
            body = response.read().decode("utf-8")
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            parsed = {"raw": body}
        raise GateError(f"{method} {url} failed status={error.code} body={parsed}") from error


def data_or_self(body: dict[str, Any]) -> dict[str, Any]:
    data = body.get("data")
    return data if isinstance(data, dict) else body


def actor_id_from_login(data: dict[str, Any]) -> str:
    actor = data.get("actor") if isinstance(data.get("actor"), dict) else {}
    actor_ref = data.get("actor_ref") if isinstance(data.get("actor_ref"), dict) else {}
    candidates = [
        actor.get("id"),
        actor.get("actor_id"),
        actor_ref.get("actor_id"),
        actor_ref.get("id"),
    ]
    for candidate in candidates:
        if candidate:
            return str(candidate)
    raise GateError(f"login response missing actor id fields={sorted(data.keys())}")


def signup_and_login(base: str, label: str) -> ActorLogin:
    suffix = f"{int(time.time() * 1000)}{secrets.token_hex(3)}"
    name = f"chat{label}{suffix}"[:20]
    email = f"{name}@testnet.local"
    password = "ChatAa1@" + secrets.token_hex(4)

    request("POST", base, "/actor/sign-up", {"name": name, "email": email, "password": password})
    login_body = request(
        "POST",
        base,
        "/actor/login",
        {"email": email, "password": password, "device_type": "desktop"},
    )
    login_data = data_or_self(login_body)
    token_data = login_data.get("tokens") if isinstance(login_data.get("tokens"), dict) else {}
    token = token_data.get("access_token")
    if not token:
        raise GateError(f"login response missing access_token fields={sorted(login_data.keys())}")
    return ActorLogin(name=name, token=str(token), actor_id=actor_id_from_login(login_data))


def require(condition: bool, message: str) -> None:
    if not condition:
        raise GateError(message)


def create_session(base: str, actor_a: ActorLogin, actor_b: ActorLogin) -> str:
    body = data_or_self(
        request(
            "POST",
            base,
            "/friend-chat/session/create",
            {"participant_did": actor_b.actor_id},
            actor_a.token,
        )
    )
    session = body.get("session") if isinstance(body.get("session"), dict) else {}
    session_id = session.get("ulid")
    require(bool(session_id), f"session/create response missing session.ulid body={body}")
    participants = {
        str(session.get("participant_a_did") or session.get("participantADid") or ""),
        str(session.get("participant_b_did") or session.get("participantBDid") or ""),
    }
    participants.discard("")
    if len(participants) == 2:
        require(
            participants == {actor_a.actor_id, actor_b.actor_id},
            f"session participants mismatch participants={participants}",
        )
    return str(session_id)


def send_message(base: str, sender: ActorLogin, receiver: ActorLogin, session_id: str) -> str:
    content = f"acceptance-chat-runtime-{int(time.time() * 1000)}"
    body = data_or_self(
        request(
            "POST",
            base,
            "/friend-chat/message/send",
            {
                "session_ulid": session_id,
                "receiver_did": receiver.actor_id,
                "type": 1,
                "content": content,
            },
            sender.token,
        )
    )
    message = body.get("message") if isinstance(body.get("message"), dict) else {}
    message_id = message.get("ulid")
    require(bool(message_id), f"message/send response missing message.ulid body={body}")
    require(str(message.get("sender_did") or message.get("senderDid")) == sender.actor_id, "sent message sender mismatch")
    require(str(message.get("receiver_did") or message.get("receiverDid")) == receiver.actor_id, "sent message receiver mismatch")
    require(message.get("content") == content, "sent message content mismatch")
    return str(message_id)


def list_messages(base: str, actor: ActorLogin, session_id: str) -> list[dict[str, Any]]:
    query = urllib.parse.urlencode({"session_ulid": session_id, "limit": "20"})
    body = data_or_self(request("GET", base, f"/friend-chat/messages?{query}", token=actor.token))
    messages = body.get("messages")
    require(isinstance(messages, list), f"messages response missing list body={body}")
    return messages


def find_message(messages: list[dict[str, Any]], message_id: str) -> dict[str, Any]:
    for message in messages:
        if str(message.get("ulid")) == message_id:
            return message
    raise GateError(f"message {message_id} not found in listed messages")


def ack_read(base: str, actor: ActorLogin, message_id: str) -> None:
    request("POST", base, "/friend-chat/message/ack", {"ulids": [message_id], "status": 4}, actor.token)


def message_status_rank(status: Any) -> int:
    if isinstance(status, int):
        return status
    if isinstance(status, str):
        ranks = {
            "FRIEND_MESSAGE_STATUS_UNSPECIFIED": 0,
            "FRIEND_MESSAGE_STATUS_SENDING": 1,
            "FRIEND_MESSAGE_STATUS_SENT": 2,
            "FRIEND_MESSAGE_STATUS_DELIVERED": 3,
            "FRIEND_MESSAGE_STATUS_READ": 4,
            "FRIEND_MESSAGE_STATUS_FAILED": 5,
        }
        if status.isdigit():
            return int(status)
        return ranks.get(status, 0)
    return 0


def main() -> int:
    base = station_url()
    require_disposable_station(base)
    print("Chat Runtime E2E")
    print("================")
    print(f"station={base}")

    actor_a = signup_and_login(base, "a")
    actor_b = signup_and_login(base, "b")
    print(f"[OK] actors created: a={actor_a.actor_id} b={actor_b.actor_id}")

    session_id = create_session(base, actor_a, actor_b)
    print(f"[OK] session created: {session_id}")

    message_id = send_message(base, actor_a, actor_b, session_id)
    print(f"[OK] message sent: {message_id}")

    receiver_messages = list_messages(base, actor_b, session_id)
    receiver_message = find_message(receiver_messages, message_id)
    require(str(receiver_message.get("receiver_did") or receiver_message.get("receiverDid")) == actor_b.actor_id, "receiver listed message receiver mismatch")
    print("[OK] receiver listed persisted message")

    ack_read(base, actor_b, message_id)
    sender_messages = list_messages(base, actor_a, session_id)
    sender_message = find_message(sender_messages, message_id)
    require(message_status_rank(sender_message.get("status")) >= 4, f"sender did not observe read status message={sender_message}")
    print("[OK] sender observes read status")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - acceptance gate reports any root cause.
        print(f"chat runtime e2e failed: {error}", file=sys.stderr)
        raise SystemExit(1)
