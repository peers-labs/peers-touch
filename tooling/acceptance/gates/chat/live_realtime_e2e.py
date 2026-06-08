#!/usr/bin/env python3
"""Chat live realtime acceptance gate.

This gate exercises the realtime delivery contract on a running Station:

1. create two temporary test actors through /actor/sign-up + /actor/login;
2. create a friend-chat session as actor A with actor B;
3. open actor B's authenticated /events/stream before actor A sends;
4. verify actor B receives the live MessageEnvelope event;
5. open actor A's authenticated /events/stream before actor B acks;
6. verify actor A receives the live MessageReceipt READ event.

It deliberately does not claim Desktop DOM-level E2E. The proof boundary is
the canonical Station SSE stream and protobuf StreamEvent delivery contract.
"""

from __future__ import annotations

import base64
import json
import os
import queue
import secrets
import sys
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable


DEFAULT_STATION_URL = "http://10.37.94.156:18180"
DEFAULT_STREAM_TIMEOUT_SECONDS = 35.0


@dataclass
class ActorLogin:
    name: str
    token: str
    actor_id: str


@dataclass
class StreamEvent:
    event_id: str
    kind: str
    payload: dict[str, Any]


class GateError(RuntimeError):
    pass


def station_url() -> str:
    return os.environ.get("CHAT_RUNTIME_STATION_URL", DEFAULT_STATION_URL).rstrip("/")


def stream_timeout_seconds() -> float:
    raw = os.environ.get("CHAT_LIVE_REALTIME_TIMEOUT_SECONDS", "")
    if not raw:
        return DEFAULT_STREAM_TIMEOUT_SECONDS
    try:
        return float(raw)
    except ValueError as error:
        raise GateError(f"invalid CHAT_LIVE_REALTIME_TIMEOUT_SECONDS={raw!r}") from error


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
    name = f"live{label}{suffix}"[:20]
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
    require(actor_a.actor_id in participants and actor_b.actor_id in participants, f"session participants mismatch participants={participants}")
    return str(session_id)


def send_message(base: str, sender: ActorLogin, receiver: ActorLogin, session_id: str) -> str:
    content = f"acceptance-chat-live-{int(time.time() * 1000)}"
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


def ack_read(base: str, actor: ActorLogin, message_id: str) -> None:
    request("POST", base, "/friend-chat/message/ack", {"ulids": [message_id], "status": 4}, actor.token)


def read_varint(data: bytes, offset: int) -> tuple[int, int]:
    shift = 0
    value = 0
    while offset < len(data):
        byte = data[offset]
        offset += 1
        value |= (byte & 0x7F) << shift
        if byte < 0x80:
            return value, offset
        shift += 7
        if shift >= 64:
            break
    raise GateError("invalid protobuf varint")


def read_length_delimited(data: bytes, offset: int) -> tuple[bytes, int]:
    length, offset = read_varint(data, offset)
    end = offset + length
    if end > len(data):
        raise GateError("invalid protobuf length-delimited field")
    return data[offset:end], end


def skip_field(data: bytes, offset: int, wire_type: int) -> int:
    if wire_type == 0:
        _, offset = read_varint(data, offset)
        return offset
    if wire_type == 1:
        return offset + 8
    if wire_type == 2:
        _, offset = read_length_delimited(data, offset)
        return offset
    if wire_type == 5:
        return offset + 4
    raise GateError(f"unsupported protobuf wire type: {wire_type}")


def parse_message_envelope(data: bytes) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    offset = 0
    while offset < len(data):
        tag, offset = read_varint(data, offset)
        field_number = tag >> 3
        wire_type = tag & 0x07
        if field_number in {1, 2, 3, 4} and wire_type == 2:
            raw, offset = read_length_delimited(data, offset)
            key = {
                1: "sender_actor_id",
                2: "recipient_actor_id",
                3: "session_ulid",
                4: "ulid",
            }[field_number]
            payload[key] = raw.decode("utf-8")
            continue
        if field_number == 5 and wire_type == 2:
            raw, offset = read_length_delimited(data, offset)
            payload["ciphertext_size"] = len(raw)
            continue
        if field_number == 6 and wire_type == 0:
            payload["sent_ts_unix_ms"], offset = read_varint(data, offset)
            continue
        offset = skip_field(data, offset, wire_type)
    return payload


def parse_message_receipt(data: bytes) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    offset = 0
    while offset < len(data):
        tag, offset = read_varint(data, offset)
        field_number = tag >> 3
        wire_type = tag & 0x07
        if field_number in {1, 2, 4} and wire_type == 2:
            raw, offset = read_length_delimited(data, offset)
            key = {
                1: "session_ulid",
                2: "ulid",
                4: "from_actor_id",
            }[field_number]
            payload[key] = raw.decode("utf-8")
            continue
        if field_number == 3 and wire_type == 0:
            payload["kind"], offset = read_varint(data, offset)
            continue
        offset = skip_field(data, offset, wire_type)
    return payload


def decode_stream_event(encoded: str, fallback_event_id: str) -> StreamEvent:
    try:
        data = base64.b64decode(encoded, validate=True)
    except ValueError as error:
        raise GateError("SSE data is not valid base64 protobuf") from error

    event_id = fallback_event_id
    kind = "unknown"
    payload: dict[str, Any] = {}
    offset = 0
    while offset < len(data):
        tag, offset = read_varint(data, offset)
        field_number = tag >> 3
        wire_type = tag & 0x07
        if field_number == 1 and wire_type == 2:
            raw, offset = read_length_delimited(data, offset)
            event_id = raw.decode("utf-8")
            continue
        if field_number == 2 and wire_type == 0:
            payload["ts_unix_ms"], offset = read_varint(data, offset)
            continue
        if field_number == 11 and wire_type == 2:
            raw, offset = read_length_delimited(data, offset)
            kind = "message"
            payload = {**payload, **parse_message_envelope(raw)}
            continue
        if field_number == 12 and wire_type == 2:
            raw, offset = read_length_delimited(data, offset)
            kind = "receipt"
            payload = {**payload, **parse_message_receipt(raw)}
            continue
        offset = skip_field(data, offset, wire_type)
    return StreamEvent(event_id=event_id, kind=kind, payload=payload)


class EventStream:
    def __init__(self, base: str, actor: ActorLogin, device_id: str) -> None:
        self.base = base
        self.actor = actor
        self.device_id = device_id
        self.connected = threading.Event()
        self.stopped = threading.Event()
        self.events: queue.Queue[StreamEvent] = queue.Queue()
        self.errors: queue.Queue[BaseException] = queue.Queue()
        self.response: Any = None
        self.thread = threading.Thread(target=self._run, name=f"chat-live-sse-{device_id}", daemon=True)

    def __enter__(self) -> EventStream:
        self.thread.start()
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        self.close()

    def close(self) -> None:
        self.stopped.set()
        # urllib response.close() can block until the socket read timeout on
        # long-lived SSE streams. The reader is daemonized, so the gate can
        # stop waiting once the required evidence has been observed.
        self.thread.join(timeout=0.1)

    def wait_connected(self, timeout: float) -> None:
        if not self.connected.wait(timeout=timeout):
            self.raise_if_failed()
            raise GateError(f"stream did not connect actor={self.actor.actor_id} device={self.device_id}")

    def wait_for(self, predicate: Callable[[StreamEvent], bool], timeout: float, description: str) -> StreamEvent:
        deadline = time.monotonic() + timeout
        observed: list[str] = []
        while time.monotonic() < deadline:
            self.raise_if_failed()
            remaining = max(0.1, deadline - time.monotonic())
            try:
                event = self.events.get(timeout=min(0.5, remaining))
            except queue.Empty:
                continue
            observed.append(f"{event.kind}:{event.payload.get('ulid', event.event_id)}")
            if predicate(event):
                return event
        self.raise_if_failed()
        raise GateError(f"timed out waiting for {description}; observed={observed[-8:]}")

    def raise_if_failed(self) -> None:
        try:
            error = self.errors.get_nowait()
        except queue.Empty:
            return
        raise GateError(f"stream failed actor={self.actor.actor_id}: {error}") from error

    def _run(self) -> None:
        url = self.base + "/events/stream"
        headers = {
            "Accept": "text/event-stream",
            "Authorization": f"Bearer {self.actor.token}",
            "X-Device-ID": self.device_id,
        }
        req = urllib.request.Request(url, headers=headers, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=stream_timeout_seconds()) as response:
                self.response = response
                self._read_frames(response)
        except ValueError as error:
            self.errors.put(error)
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            self.errors.put(GateError(f"GET {url} failed status={error.code} body={body}"))
        except Exception as error:  # noqa: BLE001 - background stream errors are surfaced by the gate.
            if not self.stopped.is_set():
                self.errors.put(error)

    def _read_frames(self, response: Any) -> None:
        data_lines: list[str] = []
        event_id = ""
        while not self.stopped.is_set():
            raw = response.readline()
            if raw == b"":
                raise GateError("stream closed by server")
            line = raw.decode("utf-8", errors="replace").rstrip("\r\n")
            if line == "":
                if data_lines:
                    self.events.put(decode_stream_event("".join(data_lines), event_id))
                    data_lines = []
                    event_id = ""
                continue
            if line.startswith(":"):
                if line.strip() == ": connected":
                    self.connected.set()
                continue
            if line.startswith("id:"):
                event_id = line[3:].strip()
                continue
            if line.startswith("data:"):
                data_lines.append(line[5:].strip())


def message_event_matches(event: StreamEvent, actor_a: ActorLogin, actor_b: ActorLogin, session_id: str, message_id: str) -> bool:
    return (
        event.kind == "message"
        and event.payload.get("sender_actor_id") == actor_a.actor_id
        and event.payload.get("recipient_actor_id") == actor_b.actor_id
        and event.payload.get("session_ulid") == session_id
        and event.payload.get("ulid") == message_id
    )


def receipt_event_matches(event: StreamEvent, actor_b: ActorLogin, session_id: str, message_id: str) -> bool:
    return (
        event.kind == "receipt"
        and event.payload.get("session_ulid") == session_id
        and event.payload.get("ulid") == message_id
        and event.payload.get("kind") == 2
        and event.payload.get("from_actor_id") == actor_b.actor_id
    )


def main() -> int:
    base = station_url()
    timeout = stream_timeout_seconds()
    print("Chat Live Realtime E2E")
    print("======================")
    print(f"station={base}")

    actor_a = signup_and_login(base, "a")
    actor_b = signup_and_login(base, "b")
    print(f"[OK] actors created: a={actor_a.actor_id} b={actor_b.actor_id}")

    session_id = create_session(base, actor_a, actor_b)
    print(f"[OK] session created: {session_id}")

    with EventStream(base, actor_b, f"acceptance-b-{secrets.token_hex(4)}") as receiver_stream:
        receiver_stream.wait_connected(timeout)
        print("[OK] receiver stream connected")
        message_id = send_message(base, actor_a, actor_b, session_id)
        print(f"[OK] message sent: {message_id}")
        receiver_stream.wait_for(
            lambda event: message_event_matches(event, actor_a, actor_b, session_id, message_id),
            timeout,
            "receiver live message event",
        )
        print("[OK] receiver stream received message event")

    with EventStream(base, actor_a, f"acceptance-a-{secrets.token_hex(4)}") as sender_stream:
        sender_stream.wait_connected(timeout)
        print("[OK] sender stream connected")
        ack_read(base, actor_b, message_id)
        print("[OK] receiver acked message as read")
        sender_stream.wait_for(
            lambda event: receipt_event_matches(event, actor_b, session_id, message_id),
            timeout,
            "sender live read receipt event",
        )
        print("[OK] sender stream received read receipt event")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - acceptance gate reports any root cause.
        print(f"chat live realtime e2e failed: {error}", file=sys.stderr)
        raise SystemExit(1)
