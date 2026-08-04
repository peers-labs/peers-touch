#!/usr/bin/env python3
"""Chat Desktop gateway acceptance gate.

This gate validates the Desktop Rust gateway as a real Chat client boundary:

1. create two temporary actors through the running Station;
2. create a friend-chat session and message from actor A to actor B;
3. login actor B through the Desktop HTTP gateway;
4. list/sync/list messages through Desktop gateway friend_chat commands;
5. acknowledge the message as READ through Desktop gateway;
6. verify actor A observes READ status from Station persistence.

It is intentionally not a DOM-level Desktop UI E2E. It proves the
desktop-rust BFF/gateway contract over real auth and Station APIs.

Environment:
  CHAT_DESKTOP_GATEWAY_URL          default http://127.0.0.1:3030
  CHAT_DESKTOP_GATEWAY_STATION_URL  default http://10.37.94.156:18180
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


DEFAULT_GATEWAY_URL = "http://127.0.0.1:3030"
DEFAULT_STATION_URL = "http://10.37.94.156:18180"


@dataclass
class ActorCredentials:
    name: str
    email: str
    password: str
    token: str
    actor_id: str


class GateError(RuntimeError):
    pass


def station_url() -> str:
    return os.environ.get("CHAT_DESKTOP_GATEWAY_STATION_URL", DEFAULT_STATION_URL).rstrip("/")


def gateway_url() -> str:
    return os.environ.get("CHAT_DESKTOP_GATEWAY_URL", DEFAULT_GATEWAY_URL).rstrip("/")


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


def require(condition: bool, message: str) -> None:
    if not condition:
        raise GateError(message)


def station_request(method: str, base: str, path: str, payload: dict[str, Any] | None = None, token: str | None = None) -> dict[str, Any]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Accept": "application/json"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = urllib.request.Request(base + path, data=data, headers=headers, method=method)
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
        raise GateError(f"{method} {base + path} failed status={error.code} body={parsed}") from error


def data_or_self(body: dict[str, Any]) -> dict[str, Any]:
    data = body.get("data")
    return data if isinstance(data, dict) else body


def actor_id_from_login(data: dict[str, Any]) -> str:
    actor = data.get("actor") if isinstance(data.get("actor"), dict) else {}
    actor_ref = data.get("actor_ref") if isinstance(data.get("actor_ref"), dict) else {}
    for candidate in [
        actor.get("id"),
        actor.get("actor_id"),
        actor_ref.get("actor_id"),
        actor_ref.get("id"),
    ]:
        if candidate:
            return str(candidate)
    raise GateError(f"login response missing actor id fields={sorted(data.keys())}")


def signup_and_login(base: str, label: str) -> ActorCredentials:
    suffix = f"{int(time.time() * 1000)}{secrets.token_hex(3)}"
    name = f"gw{label}{suffix}"[:20]
    email = f"{name}@testnet.local"
    password = "ChatAa1@" + secrets.token_hex(4)

    station_request("POST", base, "/actor/sign-up", {"name": name, "email": email, "password": password})
    login_body = station_request(
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
    return ActorCredentials(name=name, email=email, password=password, token=str(token), actor_id=actor_id_from_login(login_data))


def create_session(base: str, actor_a: ActorCredentials, actor_b: ActorCredentials) -> str:
    body = data_or_self(
        station_request(
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
    return str(session_id)


def send_station_message(base: str, sender: ActorCredentials, receiver: ActorCredentials, session_id: str) -> tuple[str, str]:
    content = f"acceptance-chat-gateway-{int(time.time() * 1000)}"
    body = data_or_self(
        station_request(
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
    return str(message_id), content


def list_station_messages(base: str, actor: ActorCredentials, session_id: str) -> list[dict[str, Any]]:
    query = urllib.parse.urlencode({"session_ulid": session_id, "limit": "20"})
    body = data_or_self(station_request("GET", base, f"/friend-chat/messages?{query}", token=actor.token))
    messages = body.get("messages")
    require(isinstance(messages, list), f"messages response missing messages list body={body}")
    return [m for m in messages if isinstance(m, dict)]


def find_message(messages: list[dict[str, Any]], message_id: str) -> dict[str, Any]:
    for message in messages:
        if str(message.get("ulid") or "") == message_id:
            return message
    raise GateError(f"message not found: {message_id}")


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


def gateway_command(gateway: str, command: str, args: dict[str, Any] | None = None) -> dict[str, Any]:
    body = json.dumps({"cmd": command, "args": args or {}}).encode("utf-8")
    req = urllib.request.Request(
        gateway,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as response:
            envelope = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise GateError(f"gateway command {command} failed status={error.code} body={detail}") from error
    if not envelope.get("ok"):
        raise GateError(f"gateway command {command} failed envelope={envelope}")
    data = envelope.get("data")
    require(isinstance(data, dict), f"gateway command {command} missing data envelope={envelope}")
    return data


def gateway_status_json(gateway: str, command: str, args: dict[str, Any] | None = None) -> dict[str, Any]:
    data = gateway_command(gateway, command, args)
    status = data.get("status")
    require(isinstance(status, str), f"gateway command {command} missing string status data={data}")
    try:
        parsed = json.loads(status)
    except json.JSONDecodeError as error:
        raise GateError(f"gateway command {command} status is not JSON status={status}") from error
    require(isinstance(parsed, dict), f"gateway command {command} status is not object status={parsed}")
    return parsed


def assert_gateway_station(gateway: str, expected_station: str) -> None:
    status = gateway_status_json(gateway, "station_list")
    active_url = str(status.get("active_url") or "").rstrip("/")
    if active_url != expected_station:
        raise GateError(
            "Desktop gateway active station mismatch; "
            f"got={active_url or 'empty'} want={expected_station}. "
            "Start an isolated Desktop gateway or set CHAT_DESKTOP_GATEWAY_STATION_URL to its active Station."
        )


def gateway_login(gateway: str, actor: ActorCredentials) -> None:
    data = gateway_command(gateway, "auth_login", {"account": actor.email, "password": actor.password})
    actor_id = data.get("actor_id")
    require(str(actor_id) == actor.actor_id, f"gateway auth_login actor mismatch got={actor_id} want={actor.actor_id}")


def gateway_logout(gateway: str) -> None:
    try:
        gateway_command(gateway, "auth_logout")
    except Exception:
        pass


def gateway_list_sessions(gateway: str, session_id: str, actor_b: ActorCredentials) -> dict[str, Any]:
    status = gateway_status_json(gateway, "friend_chat_list_sessions", {"limit": 20, "offset": 0})
    sessions = status.get("sessions")
    require(isinstance(sessions, list), f"gateway sessions response missing sessions list status={status}")
    for session in sessions:
        if not isinstance(session, dict):
            continue
        if str(session.get("ulid") or "") == session_id:
            participants = {
                str(session.get("participant_a_did") or session.get("participantADid") or ""),
                str(session.get("participant_b_did") or session.get("participantBDid") or ""),
            }
            require(actor_b.actor_id in participants, f"gateway session participant mismatch session={session}")
            return session
    raise GateError(f"gateway did not list expected session={session_id}")


def gateway_sync_session(gateway: str, session_id: str) -> None:
    status = gateway_status_json(
        gateway,
        "friend_chat_sync_from_station_scoped",
        {"session_ulid": session_id, "limit": 50, "max_pages": 1},
    )
    require("synced_count" in status or "pages_fetched" in status, f"gateway sync response missing counters status={status}")


def gateway_list_messages(gateway: str, session_id: str, message_id: str, expected_content: str) -> dict[str, Any]:
    status = gateway_status_json(
        gateway,
        "friend_chat_list_messages",
        {"session_ulid": session_id, "limit": 20},
    )
    messages = status.get("messages")
    require(isinstance(messages, list), f"gateway messages response missing messages list status={status}")
    message = find_message([m for m in messages if isinstance(m, dict)], message_id)
    require(message.get("content") == expected_content, f"gateway message content mismatch message={message}")
    return message


def gateway_ack_read(gateway: str, message_id: str) -> None:
    gateway_status_json(gateway, "friend_chat_ack_messages", {"ulids": [message_id], "status": 4})


def main() -> int:
    base = station_url()
    gateway = gateway_url()
    require_disposable_station(base)
    print("Chat Desktop Gateway E2E")
    print("========================")
    print(f"station={base}")
    print(f"gateway={gateway}")

    assert_gateway_station(gateway, base)
    print("[OK] gateway active station matches target")

    actor_a = signup_and_login(base, "a")
    actor_b = signup_and_login(base, "b")
    print(f"[OK] actors created: a={actor_a.actor_id} b={actor_b.actor_id}")

    session_id = create_session(base, actor_a, actor_b)
    message_id, content = send_station_message(base, actor_a, actor_b, session_id)
    print(f"[OK] station message sent: {message_id}")

    try:
        gateway_login(gateway, actor_b)
        print("[OK] gateway authenticated receiver")

        gateway_list_sessions(gateway, session_id, actor_b)
        print("[OK] gateway listed chat session")

        gateway_sync_session(gateway, session_id)
        print("[OK] gateway synced session from Station")

        gateway_list_messages(gateway, session_id, message_id, content)
        print("[OK] gateway listed persisted message")

        gateway_ack_read(gateway, message_id)
        sender_message = find_message(list_station_messages(base, actor_a, session_id), message_id)
        require(message_status_rank(sender_message.get("status")) >= 4, f"sender did not observe gateway read ack message={sender_message}")
        print("[OK] station observed gateway read acknowledgement")
    finally:
        gateway_logout(gateway)

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - acceptance gate reports any root cause.
        print(f"chat desktop gateway e2e failed: {error}", file=sys.stderr)
        raise SystemExit(1)
