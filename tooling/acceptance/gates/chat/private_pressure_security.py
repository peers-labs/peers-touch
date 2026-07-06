#!/usr/bin/env python3
"""Private chat pressure and security acceptance gate.

Default mode is a bounded smoke run. Set the environment to the Foundation
Profile target for a full family-Station private-chat pressure run:

  CHAT_PRIVATE_PRESSURE_ACTORS=100
  CHAT_PRIVATE_PRESSURE_MESSAGES=1000

The gate exercises Station HTTP contracts only. It proves persisted private
message pressure, encrypted-payload carriage, read acknowledgements, and social
graph rejection behavior. It does not claim Desktop DOM decrypt behavior.
"""

from __future__ import annotations

import base64
import concurrent.futures
import json
import os
import secrets
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_STATION_URL = "http://127.0.0.1:18080"
DEFAULT_ACTORS = 10
DEFAULT_MESSAGES = 50
DEFAULT_WORKERS = 8
DEFAULT_OUT_DIR = "/tmp/peers-touch-chat-private-pressure"


@dataclass
class ActorLogin:
    label: str
    name: str
    token: str
    actor_id: str


@dataclass
class SessionPair:
    session_id: str
    actor_a: ActorLogin
    actor_b: ActorLogin


@dataclass
class SendResult:
    session_id: str
    message_id: str
    sender_id: str
    receiver_id: str
    latency_ms: float


class GateError(RuntimeError):
    pass


class ExpectedHttpError(RuntimeError):
    def __init__(self, status: int, body: dict[str, Any]) -> None:
        super().__init__(f"expected HTTP error status={status} body={body}")
        self.status = status
        self.body = body


def env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as error:
        raise GateError(f"{name} must be an integer, got {raw!r}") from error
    if value <= 0:
        raise GateError(f"{name} must be > 0, got {value}")
    return value


def station_url() -> str:
    return os.environ.get("CHAT_PRIVATE_PRESSURE_STATION_URL", DEFAULT_STATION_URL).rstrip("/")


def out_dir() -> Path:
    return Path(os.environ.get("CHAT_PRIVATE_PRESSURE_OUT_DIR", DEFAULT_OUT_DIR))


def require(condition: bool, message: str) -> None:
    if not condition:
        raise GateError(message)


def field(record: dict[str, Any], snake: str, camel: str | None = None) -> Any:
    if snake in record:
        return record.get(snake)
    if camel and camel in record:
        return record.get(camel)
    return None


def request(
    method: str,
    base: str,
    path: str,
    payload: dict[str, Any] | None = None,
    token: str | None = None,
    expect_error: bool = False,
    timeout: int = 30,
) -> dict[str, Any]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Accept": "application/json"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    last_error: urllib.error.URLError | None = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                body = response.read().decode("utf-8")
                parsed = json.loads(body) if body else {}
                if expect_error:
                    raise GateError(f"{method} {base + path} unexpectedly succeeded body={parsed}")
                return parsed
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(body)
            except json.JSONDecodeError:
                parsed = {"raw": body}
            if expect_error:
                raise ExpectedHttpError(error.code, parsed) from error
            raise GateError(f"{method} {base + path} failed status={error.code} body={parsed}") from error
        except urllib.error.URLError as error:
            last_error = error
            if attempt == 3:
                break
            time.sleep(0.3 * (attempt + 1))
    raise GateError(f"{method} {base + path} failed before HTTP response error={last_error}") from last_error


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


def signup_and_login(base: str, label: str) -> ActorLogin:
    suffix = f"{secrets.token_hex(4)}{int(time.time() * 1000)}"
    name = f"pc{label}{suffix}"[:20]
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
    return ActorLogin(label=label, name=name, token=str(token), actor_id=actor_id_from_login(login_data))


def create_session(base: str, actor_a: ActorLogin, actor_b: ActorLogin) -> str:
    body = data_or_self(
        request(
            "POST",
            base,
            "/friend-chat/session/create",
            {"participant_did": actor_b.actor_id},
            actor_a.token,
            timeout=60,
        )
    )
    session = body.get("session") if isinstance(body.get("session"), dict) else {}
    session_id = field(session, "ulid")
    require(bool(session_id), f"session/create response missing session.ulid body={body}")
    participants = {
        str(field(session, "participant_a_did", "participantADid") or ""),
        str(field(session, "participant_b_did", "participantBDid") or ""),
    }
    require(actor_a.actor_id in participants and actor_b.actor_id in participants, f"session participants mismatch participants={participants}")
    return str(session_id)


def encrypted_payload(index: int, sender: ActorLogin, receiver: ActorLogin) -> str:
    ciphertext = json.dumps(
        {
            "gate": "private-pressure-security",
            "index": index,
            "sender": sender.actor_id,
            "receiver": receiver.actor_id,
            "nonce": secrets.token_hex(8),
        },
        separators=(",", ":"),
    ).encode("utf-8")
    frame = b"\x0a" + encode_varint(len(ciphertext)) + ciphertext + b"\x10\x01"
    return base64.b64encode(frame).decode("ascii")


def encode_varint(value: int) -> bytes:
    out = bytearray()
    while value >= 0x80:
        out.append((value & 0x7F) | 0x80)
        value >>= 7
    out.append(value)
    return bytes(out)


def send_private_message(base: str, pair: SessionPair, index: int) -> SendResult:
    if index % 2 == 0:
        sender, receiver = pair.actor_a, pair.actor_b
    else:
        sender, receiver = pair.actor_b, pair.actor_a
    client_ulid = f"fcp-{time.time_ns()}-{index:06d}-{secrets.token_hex(3)}"
    payload = {
        "session_ulid": pair.session_id,
        "receiver_did": receiver.actor_id,
        "type": 1,
        "encrypted_payload": encrypted_payload(index, sender, receiver),
        "client_ulid": client_ulid,
    }
    start = time.perf_counter()
    body = data_or_self(request("POST", base, "/friend-chat/message/send", payload, sender.token, timeout=60))
    latency_ms = (time.perf_counter() - start) * 1000.0
    message = body.get("message") if isinstance(body.get("message"), dict) else {}
    message_id = str(field(message, "ulid") or "")
    require(message_id == client_ulid, f"send response did not preserve client_ulid expected={client_ulid} got={message_id}")
    require(str(field(message, "sender_did", "senderDid")) == sender.actor_id, "sent message sender mismatch")
    require(str(field(message, "receiver_did", "receiverDid")) == receiver.actor_id, "sent message receiver mismatch")
    require(bool(field(message, "encrypted_payload", "encryptedPayload")), f"sent message missing encrypted_payload message={message}")
    content = str(field(message, "content") or "")
    require("private-pressure-security" not in content, f"sent response leaked plaintext content message={message}")
    return SendResult(pair.session_id, message_id, sender.actor_id, receiver.actor_id, latency_ms)


def list_messages_page(base: str, actor: ActorLogin, session_id: str, before_ulid: str = "", limit: int = 100) -> dict[str, Any]:
    query = {"session_ulid": session_id, "limit": str(limit)}
    if before_ulid:
        query["before_ulid"] = before_ulid
    return data_or_self(
        request("GET", base, f"/friend-chat/messages?{urllib.parse.urlencode(query)}", token=actor.token, timeout=60)
    )


def recover_session_messages(base: str, actor: ActorLogin, session_id: str, expected_ids: set[str]) -> tuple[int, int, float]:
    seen: set[str] = set()
    cursor = ""
    pages = 0
    start = time.perf_counter()
    while True:
        body = list_messages_page(base, actor, session_id, cursor)
        pages += 1
        messages = body.get("messages")
        require(isinstance(messages, list), f"messages response missing list body={body}")
        for message in messages:
            message_id = str(field(message, "ulid") or "")
            if message_id in expected_ids:
                seen.add(message_id)
                content = str(field(message, "content") or "")
                encrypted = field(message, "encrypted_payload", "encryptedPayload")
                require("private-pressure-security" not in content, f"friend message leaked plaintext content message={message}")
                require(bool(encrypted), f"friend message missing encrypted_payload message={message}")
        if seen >= expected_ids:
            break
        if not body.get("has_more") and not body.get("hasMore"):
            break
        cursor = str(field(body, "next_cursor", "nextCursor") or "")
        if not cursor:
            break
    elapsed_ms = (time.perf_counter() - start) * 1000.0
    return len(seen), pages, elapsed_ms


def ack_read(base: str, actor: ActorLogin, message_ids: list[str]) -> None:
    if not message_ids:
        return
    request("POST", base, "/friend-chat/message/ack", {"ulids": message_ids, "status": 4}, actor.token, timeout=60)


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


def expect_error_status(label: str, fn: Any, statuses: set[int]) -> int:
    try:
        fn()
    except ExpectedHttpError as error:
        if error.status not in statuses:
            raise GateError(f"{label} denied with unexpected status={error.status} body={error.body}") from error
        return error.status
    raise GateError(f"{label} unexpectedly succeeded")


def negative_non_participant_send(base: str, outsider: ActorLogin, receiver: ActorLogin, session_id: str) -> int:
    return expect_error_status(
        "non-participant private send",
        lambda: request(
            "POST",
            base,
            "/friend-chat/message/send",
            {
                "session_ulid": session_id,
                "receiver_did": receiver.actor_id,
                "type": 1,
                "encrypted_payload": encrypted_payload(-1, outsider, receiver),
            },
            outsider.token,
            expect_error=True,
        ),
        {403},
    )


def negative_invalid_receiver(base: str, sender: ActorLogin, outsider: ActorLogin, session_id: str) -> int:
    return expect_error_status(
        "invalid private receiver",
        lambda: request(
            "POST",
            base,
            "/friend-chat/message/send",
            {
                "session_ulid": session_id,
                "receiver_did": outsider.actor_id,
                "type": 1,
                "encrypted_payload": encrypted_payload(-2, sender, outsider),
            },
            sender.token,
            expect_error=True,
        ),
        {403},
    )


def negative_blocked_send(base: str, actor_a: ActorLogin, actor_b: ActorLogin) -> int:
    session_id = create_session(base, actor_a, actor_b)
    request("POST", base, "/friend-chat/block", {"target_did": actor_a.actor_id}, actor_b.token)
    return expect_error_status(
        "blocked private send",
        lambda: request(
            "POST",
            base,
            "/friend-chat/message/send",
            {
                "session_ulid": session_id,
                "receiver_did": actor_b.actor_id,
                "type": 1,
                "encrypted_payload": encrypted_payload(-3, actor_a, actor_b),
            },
            actor_a.token,
            expect_error=True,
        ),
        {403},
    )


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    if len(values) == 1:
        return values[0]
    ordered = sorted(values)
    index = (len(ordered) - 1) * p
    lo = int(index)
    hi = min(lo + 1, len(ordered) - 1)
    frac = index - lo
    return ordered[lo] * (1.0 - frac) + ordered[hi] * frac


def write_report(report: dict[str, Any]) -> Path:
    target_dir = out_dir()
    target_dir.mkdir(parents=True, exist_ok=True)
    path = target_dir / "private_pressure_security_report.json"
    path.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
    return path


def main() -> int:
    base = station_url()
    actor_count = env_int("CHAT_PRIVATE_PRESSURE_ACTORS", DEFAULT_ACTORS)
    message_count = env_int("CHAT_PRIVATE_PRESSURE_MESSAGES", DEFAULT_MESSAGES)
    workers = env_int("CHAT_PRIVATE_PRESSURE_WORKERS", DEFAULT_WORKERS)
    require(actor_count >= 4 and actor_count % 2 == 0, "CHAT_PRIVATE_PRESSURE_ACTORS must be an even integer >= 4")
    require(workers >= 1, "CHAT_PRIVATE_PRESSURE_WORKERS must be >= 1")

    print("Private Chat Pressure And Security")
    print("==================================")
    print(f"station={base}")
    print(f"actors={actor_count} sessions={actor_count // 2} messages={message_count} workers={workers}")

    actors = [signup_and_login(base, str(i)) for i in range(actor_count)]
    outsider = signup_and_login(base, "outsider")
    blocker = signup_and_login(base, "blocker")
    blocked = signup_and_login(base, "blocked")

    pairs = [
        SessionPair(create_session(base, actors[i], actors[i + 1]), actors[i], actors[i + 1])
        for i in range(0, actor_count, 2)
    ]
    print(f"[OK] sessions created: {len(pairs)}")

    security: dict[str, int] = {
        "non_participant_send_rejected": negative_non_participant_send(base, outsider, pairs[0].actor_b, pairs[0].session_id),
        "invalid_receiver_rejected": negative_invalid_receiver(base, pairs[0].actor_a, outsider, pairs[0].session_id),
        "blocked_send_rejected": negative_blocked_send(base, blocked, blocker),
    }
    print(f"[OK] security negatives before pressure: {security}")

    started = time.perf_counter()
    results: list[SendResult] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [
            executor.submit(send_private_message, base, pairs[index % len(pairs)], index)
            for index in range(message_count)
        ]
        for done, future in enumerate(concurrent.futures.as_completed(futures), start=1):
            results.append(future.result())
            if done % max(1, message_count // 10) == 0:
                print(f"[INFO] sent {done}/{message_count}")
    total_ms = (time.perf_counter() - started) * 1000.0

    by_session: dict[str, set[str]] = {}
    by_receiver: dict[tuple[str, str], list[str]] = {}
    for result in results:
        by_session.setdefault(result.session_id, set()).add(result.message_id)
        by_receiver.setdefault((result.session_id, result.receiver_id), []).append(result.message_id)

    recovered_total = 0
    pages_total = 0
    recovery_started = time.perf_counter()
    for pair in pairs:
        expected = by_session.get(pair.session_id, set())
        if not expected:
            continue
        recovered, pages, _ = recover_session_messages(base, pair.actor_a, pair.session_id, expected)
        require(recovered == len(expected), f"session {pair.session_id} recovery saw {recovered}/{len(expected)} messages")
        recovered_total += recovered
        pages_total += pages
    recovery_ms = (time.perf_counter() - recovery_started) * 1000.0
    require(recovered_total == message_count, f"private recovery saw {recovered_total}/{message_count} messages")
    print(f"[OK] session recovery: messages={recovered_total} pages={pages_total} duration_ms={recovery_ms:.2f}")

    acked_count = 0
    for pair in pairs:
        for actor in (pair.actor_a, pair.actor_b):
            ids = by_receiver.get((pair.session_id, actor.actor_id), [])[:10]
            ack_read(base, actor, ids)
            acked_count += len(ids)
    require(acked_count > 0, "no messages were acked")
    print(f"[OK] read acknowledgements: acked={acked_count}")

    report = {
        "station_url": base,
        "actor_count": actor_count,
        "session_count": len(pairs),
        "message_count": message_count,
        "worker_count": workers,
        "send_latency_ms": {
            "min": min(result.latency_ms for result in results),
            "max": max(result.latency_ms for result in results),
            "mean": statistics.fmean(result.latency_ms for result in results),
            "p50": percentile([result.latency_ms for result in results], 0.50),
            "p95": percentile([result.latency_ms for result in results], 0.95),
        },
        "send_total_ms": total_ms,
        "recovery": {
            "messages_seen": recovered_total,
            "pages": pages_total,
            "duration_ms": recovery_ms,
        },
        "read_acknowledgements": acked_count,
        "security": security,
        "plaintext_leakage_check": "api_content_does_not_contain_gate_plaintext_and_encrypted_payload_present",
        "mode": "foundation-full" if actor_count >= 100 and message_count >= 1000 else "smoke",
    }
    report_path = write_report(report)
    print(f"[OK] report: {report_path}")
    print(
        "[OK] latency_ms "
        f"p50={report['send_latency_ms']['p50']:.2f} "
        f"p95={report['send_latency_ms']['p95']:.2f} "
        f"max={report['send_latency_ms']['max']:.2f}"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - gate reports root cause.
        print(f"private pressure/security failed: {error}", file=sys.stderr)
        raise SystemExit(1)
