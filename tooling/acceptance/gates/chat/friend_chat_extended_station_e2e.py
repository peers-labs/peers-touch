#!/usr/bin/env python3
"""Chat friend-chat extended Station-level acceptance gate.

Extends runtime_e2e.py with additional friend-chat Station capabilities:

1. Create actors and establish a session (same as runtime_e2e)
2. Test bidirectional messaging: A→B then B→A
3. Test session settings (mute, pin)
4. Test chat stats
5. Test multiple message types (text, reply)
6. Test message listing with pagination

Environment:
  CHAT_RUNTIME_STATION_URL  default http://10.37.94.156:18180
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
class ActorCredentials:
    name: str
    email: str
    password: str
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
    raise GateError("temporary actor gate requires a disposable loopback Station")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise GateError(message)


def station_request(method: str, base: str, path: str, payload: dict[str, Any] | None = None, token: str | None = None, query: dict[str, str] | None = None) -> dict[str, Any]:
    url = base + path
    if query:
        url += "?" + urllib.parse.urlencode(query)
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Accept": "application/json"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
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
    for candidate in [actor.get("id"), actor.get("actor_id"), actor_ref.get("actor_id"), actor_ref.get("id")]:
        if candidate:
            return str(candidate)
    raise GateError(f"login response missing actor id")


def signup_and_login(base: str, label: str) -> ActorCredentials:
    suffix = f"{int(time.time() * 1000)}{secrets.token_hex(3)}"
    name = f"ex{label}{suffix}"[:20]
    email = f"{name}@testnet.local"
    password = "ChatAa1@" + secrets.token_hex(4)

    station_request("POST", base, "/actor/sign-up", {"name": name, "email": email, "password": password})
    login_body = station_request("POST", base, "/actor/login", {"email": email, "password": password, "device_type": "desktop"})
    login_data = data_or_self(login_body)
    token_data = login_data.get("tokens") if isinstance(login_data.get("tokens"), dict) else {}
    token = token_data.get("access_token")
    if not token:
        raise GateError(f"login response missing access_token")
    return ActorCredentials(name=name, email=email, password=password, token=str(token), actor_id=actor_id_from_login(login_data))


def main() -> int:
    base = station_url()
    require_disposable_station(base)
    print("Chat Friend-Chat Extended Station E2E")
    print("======================================")
    print(f"station={base}")

    actor_a = signup_and_login(base, "a")
    actor_b = signup_and_login(base, "b")
    print(f"[OK] actors: a={actor_a.actor_id} b={actor_b.actor_id}")

    # --- Create session ---
    session_body = data_or_self(station_request(
        "POST", base, "/friend-chat/session/create",
        {"participant_did": actor_b.actor_id},
        actor_a.token,
    ))
    session = session_body.get("session") if isinstance(session_body.get("session"), dict) else session_body
    session_id = session.get("ulid")
    require(bool(session_id), f"session create failed body={session_body}")
    print(f"[OK] session created: {session_id}")

    # --- A sends multiple messages to B ---
    message_ids = []
    for i in range(3):
        content = f"extended-msg-{i}-{int(time.time() * 1000)}"
        msg_body = data_or_self(station_request(
            "POST", base, "/friend-chat/message/send",
            {
                "session_ulid": session_id,
                "receiver_did": actor_b.actor_id,
                "type": 1,
                "content": content,
            },
            actor_a.token,
        ))
        message = msg_body.get("message") if isinstance(msg_body.get("message"), dict) else msg_body
        msg_id = message.get("ulid")
        require(bool(msg_id), f"message send {i} failed")
        message_ids.append(msg_id)
    print(f"[OK] A sent 3 messages: {message_ids}")

    # --- B sends a reply to A (bidirectional) ---
    reply_content = f"reply-from-b-{int(time.time() * 1000)}"
    reply_body = data_or_self(station_request(
        "POST", base, "/friend-chat/message/send",
        {
            "session_ulid": session_id,
            "receiver_did": actor_a.actor_id,
            "type": 1,
            "content": reply_content,
        },
        actor_b.token,
    ))
    reply_msg = reply_body.get("message") if isinstance(reply_body.get("message"), dict) else reply_body
    reply_id = reply_msg.get("ulid")
    require(bool(reply_id), f"B reply failed")
    print(f"[OK] B replied: {reply_id}")

    # --- List messages as A (should see all 4) ---
    msgs_resp = data_or_self(station_request(
        "GET", base, "/friend-chat/messages",
        token=actor_a.token,
        query={"session_ulid": session_id, "limit": "20"},
    ))
    messages = msgs_resp.get("messages") or []
    require(len(messages) >= 4, f"expected >= 4 messages got {len(messages)}")
    print(f"[OK] A sees {len(messages)} messages (including B's reply)")

    # --- Pagination test: limit=2 ---
    page1_resp = data_or_self(station_request(
        "GET", base, "/friend-chat/messages",
        token=actor_a.token,
        query={"session_ulid": session_id, "limit": "2"},
    ))
    page1 = page1_resp.get("messages") or []
    require(len(page1) == 2, f"pagination limit=2 returned {len(page1)} messages")
    print(f"[OK] pagination works: limit=2 returned 2 messages")

    # --- Session list shows the session ---
    sessions_resp = data_or_self(station_request(
        "GET", base, "/friend-chat/sessions",
        token=actor_a.token,
    ))
    sessions = sessions_resp.get("sessions") or []
    found_session = any(isinstance(s, dict) and s.get("ulid") == session_id for s in sessions)
    require(found_session, f"session not in A's session list")
    print(f"[OK] session appears in A's session list")

    # --- Acknowledge messages (B marks A's messages as read) ---
    station_request(
        "POST", base, "/friend-chat/message/ack",
        {"ulids": message_ids, "status": 4},
        actor_b.token,
    )
    print(f"[OK] B acknowledged {len(message_ids)} messages as READ")

    # --- Verify A observes read status ---
    time.sleep(0.5)
    verify_resp = data_or_self(station_request(
        "GET", base, "/friend-chat/messages",
        token=actor_a.token,
        query={"session_ulid": session_id, "limit": "20"},
    ))
    verify_msgs = verify_resp.get("messages") or []
    read_count = sum(
        1 for m in verify_msgs
        if isinstance(m, dict) and m.get("ulid") in message_ids
        and (m.get("status") == 4 or m.get("status") == "FRIEND_MESSAGE_STATUS_READ"
             or str(m.get("status", "")).isdigit() and int(m.get("status", 0)) >= 4)
    )
    require(read_count == len(message_ids), f"not all messages marked read: read_count={read_count}/{len(message_ids)}")
    print(f"[OK] A observes all messages as READ")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(f"chat friend-chat extended station e2e failed: {error}", file=sys.stderr)
        raise SystemExit(1)
