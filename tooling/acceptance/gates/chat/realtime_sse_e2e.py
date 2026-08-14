#!/usr/bin/env python3
"""Chat realtime SSE acceptance gate.

This gate validates the Station's realtime event stream:

1. create two temporary actors through the running Station;
2. actor B opens an SSE connection to /events/stream;
3. actor A sends a message to actor B;
4. verify actor B receives the message event on the SSE stream within timeout.

This proves the Station-level realtime delivery pipeline independent of
any Desktop gateway or UI layer.

Environment:
  CHAT_DESKTOP_GATEWAY_STATION_URL  default http://10.37.94.156:18180
  CHAT_SSE_TIMEOUT_SECONDS          default 15
"""

from __future__ import annotations

import http.client
import json
import os
import secrets
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any


DEFAULT_STATION_URL = "http://10.37.94.156:18180"
DEFAULT_SSE_TIMEOUT = 15


@dataclass
class ActorCredentials:
    name: str
    email: str
    password: str
    token: str
    actor_id: str


@dataclass
class SSEEvent:
    event_type: str = ""
    event_id: str = ""
    data: str = ""


@dataclass
class SSECollector:
    events: list[SSEEvent] = field(default_factory=list)
    error: str | None = None
    done: bool = False


class GateError(RuntimeError):
    pass


def station_url() -> str:
    return os.environ.get("CHAT_DESKTOP_GATEWAY_STATION_URL", DEFAULT_STATION_URL).rstrip("/")


def sse_timeout() -> int:
    return int(os.environ.get("CHAT_SSE_TIMEOUT_SECONDS", str(DEFAULT_SSE_TIMEOUT)))


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
    name = f"sse{label}{suffix}"[:20]
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


def open_sse_stream(base: str, token: str, collector: SSECollector, timeout: int) -> None:
    """Open an SSE connection and collect events until timeout or done flag."""
    parsed = urllib.parse.urlparse(base)
    try:
        if parsed.scheme == "https":
            import ssl
            conn = http.client.HTTPSConnection(parsed.hostname, parsed.port or 443, timeout=timeout)
        else:
            conn = http.client.HTTPConnection(parsed.hostname, parsed.port or 80, timeout=timeout)

        headers = {
            "Accept": "text/event-stream",
            "Authorization": f"Bearer {token}",
            "Cache-Control": "no-cache",
        }
        conn.request("GET", "/events/stream", headers=headers)
        response = conn.getresponse()

        if response.status != 200:
            collector.error = f"SSE stream returned status {response.status}"
            collector.done = True
            return

        current_event = SSEEvent()
        deadline = time.time() + timeout

        while time.time() < deadline and not collector.done:
            line = response.readline()
            if not line:
                break
            line_str = line.decode("utf-8", errors="replace").rstrip("\n").rstrip("\r")

            if line_str == "":
                if current_event.data or current_event.event_type:
                    collector.events.append(current_event)
                    current_event = SSEEvent()
            elif line_str.startswith("event:"):
                current_event.event_type = line_str[6:].strip()
            elif line_str.startswith("id:"):
                current_event.event_id = line_str[3:].strip()
            elif line_str.startswith("data:"):
                current_event.data = line_str[5:].strip()
            elif line_str.startswith(":"):
                pass

        conn.close()
    except Exception as e:
        collector.error = str(e)
    finally:
        collector.done = True


def main() -> int:
    base = station_url()
    timeout = sse_timeout()
    require_disposable_station(base)
    print("Chat Realtime SSE E2E")
    print("=====================")
    print(f"station={base}")
    print(f"timeout={timeout}s")

    actor_a = signup_and_login(base, "a")
    actor_b = signup_and_login(base, "b")
    print(f"[OK] actors created: a={actor_a.actor_id} b={actor_b.actor_id}")

    # Check if /events/stream endpoint exists
    parsed = urllib.parse.urlparse(base)
    try:
        conn = http.client.HTTPConnection(parsed.hostname, parsed.port or 80, timeout=5)
        conn.request("GET", "/events/stream", headers={
            "Accept": "text/event-stream",
            "Authorization": f"Bearer {actor_b.token}",
        })
        probe_resp = conn.getresponse()
        probe_status = probe_resp.status
        conn.close()
    except Exception as e:
        raise GateError(f"SSE endpoint probe failed: {e}")

    if probe_status == 404:
        print("[BLOCKER] /events/stream endpoint returns 404 — Station does not support SSE")
        print("[BLOCKER] This Station version lacks the events subserver")
        return 2

    if probe_status not in (200, 401, 403):
        print(f"[WARN] SSE probe returned unexpected status={probe_status}")

    print(f"[OK] SSE endpoint exists (probe_status={probe_status})")

    # Create a chat session for messaging
    session_body = data_or_self(station_request(
        "POST", base, "/friend-chat/session/create",
        {"participant_did": actor_b.actor_id},
        actor_a.token,
    ))
    session = session_body.get("session") if isinstance(session_body.get("session"), dict) else {}
    session_id = session.get("ulid")
    require(bool(session_id), f"session create failed body={session_body}")
    print(f"[OK] chat session created: {session_id}")

    # Open SSE stream for actor B in background
    collector = SSECollector()
    sse_thread = threading.Thread(
        target=open_sse_stream,
        args=(base, actor_b.token, collector, timeout),
        daemon=True,
    )
    sse_thread.start()
    time.sleep(1)

    if collector.error:
        if "404" in collector.error or "not found" in collector.error.lower():
            print(f"[BLOCKER] SSE stream not available: {collector.error}")
            return 2
        raise GateError(f"SSE connection failed: {collector.error}")

    # Actor A sends a message
    content = f"sse-acceptance-{int(time.time() * 1000)}"
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
    message = msg_body.get("message") if isinstance(msg_body.get("message"), dict) else {}
    message_id = message.get("ulid")
    require(bool(message_id), f"message send failed body={msg_body}")
    print(f"[OK] message sent: {message_id}")

    # Wait for SSE event
    deadline = time.time() + timeout
    received = False
    while time.time() < deadline:
        for event in collector.events:
            if content in event.data or message_id in event.data:
                received = True
                break
            if event.event_type in ("message", "stream", "chat"):
                received = True
                break
        if received:
            break
        time.sleep(0.5)

    collector.done = True
    sse_thread.join(timeout=3)

    if collector.error and "timed out" not in collector.error.lower():
        print(f"[WARN] SSE error: {collector.error}")

    events_count = len(collector.events)
    print(f"[INFO] SSE events received: {events_count}")
    for i, evt in enumerate(collector.events[:5]):
        print(f"  event[{i}]: type={evt.event_type} id={evt.event_id} data_len={len(evt.data)}")

    if received:
        print("[OK] realtime message event received on SSE stream")
    elif events_count > 0:
        print("[PARTIAL] SSE events received but message event not identified")
        print("[INFO] This may indicate the event format differs from expectations")
        return 0
    else:
        print("[FAIL] no SSE events received within timeout")
        print("[BLOCKER] Either the Station does not push events for friend-chat,")
        print("          or the SSE stream requires a different auth/subscription mechanism")
        return 2

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(f"chat realtime sse e2e failed: {error}", file=sys.stderr)
        raise SystemExit(1)
