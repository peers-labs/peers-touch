#!/usr/bin/env python3
"""Group chat pressure and security acceptance gate.

Default mode is a bounded smoke run. Set the environment to the Foundation
Profile target for a full family-Station pressure run:

  CHAT_GROUP_PRESSURE_ACTORS=100
  CHAT_GROUP_PRESSURE_SENDERS=10
  CHAT_GROUP_PRESSURE_MESSAGES=1000

The gate exercises Station HTTP contracts only. It does not claim Desktop DOM
decrypt behavior or multi-Station federation behavior.
"""

from __future__ import annotations

import base64
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
DEFAULT_ACTORS = 12
DEFAULT_SENDERS = 3
DEFAULT_MESSAGES = 60
DEFAULT_OUT_DIR = "/tmp/peers-touch-chat-group-pressure"


@dataclass
class ActorLogin:
    label: str
    name: str
    token: str
    actor_id: str


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
    return os.environ.get("CHAT_GROUP_PRESSURE_STATION_URL", DEFAULT_STATION_URL).rstrip("/")


def out_dir() -> Path:
    return Path(os.environ.get("CHAT_GROUP_PRESSURE_OUT_DIR", DEFAULT_OUT_DIR))


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
    name = f"gp{label}{suffix}"[:20]
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


def create_group(base: str, owner: ActorLogin, members: list[ActorLogin]) -> tuple[str, int]:
    body = data_or_self(
        request(
            "POST",
            base,
            "/group-chat/create",
            {
                "name": f"group-pressure-{int(time.time() * 1000)}",
                "description": "group pressure acceptance",
                "type": 1,
                "visibility": 2,
                "initial_member_dids": [member.actor_id for member in members],
            },
            owner.token,
            timeout=60,
        )
    )
    group = body.get("group") if isinstance(body.get("group"), dict) else {}
    group_id = field(group, "ulid")
    require(bool(group_id), f"group/create response missing group.ulid body={body}")
    epoch = int(field(group, "membership_epoch", "membershipEpoch") or 0)
    return str(group_id), epoch


def get_group_epoch(base: str, actor: ActorLogin, group_id: str) -> int:
    query = urllib.parse.urlencode({"group_ulid": group_id})
    body = data_or_self(request("GET", base, f"/group-chat/info?{query}", token=actor.token))
    group = body.get("group") if isinstance(body.get("group"), dict) else {}
    return int(field(group, "membership_epoch", "membershipEpoch") or 0)


def encrypted_payload(index: int, sender: ActorLogin) -> str:
    raw = json.dumps(
        {
            "gate": "group-pressure-security",
            "index": index,
            "sender": sender.actor_id,
            "nonce": secrets.token_hex(8),
        },
        separators=(",", ":"),
    ).encode("utf-8")
    return base64.b64encode(raw).decode("ascii")


def send_group_message(base: str, actor: ActorLogin, group_id: str, epoch: int, index: int) -> float:
    payload = {
        "group_ulid": group_id,
        "type": 1,
        "encrypted_payload": encrypted_payload(index, actor),
        "observed_membership_epoch": epoch,
    }
    start = time.perf_counter()
    request("POST", base, "/group-chat/message/send", payload, actor.token, timeout=60)
    return (time.perf_counter() - start) * 1000.0


def expect_error_status(label: str, fn: Any, statuses: set[int]) -> int:
    try:
        fn()
    except ExpectedHttpError as error:
        if error.status not in statuses:
            raise GateError(f"{label} denied with unexpected status={error.status} body={error.body}") from error
        return error.status
    raise GateError(f"{label} unexpectedly succeeded")


def negative_plaintext(base: str, actor: ActorLogin, group_id: str, epoch: int) -> int:
    return expect_error_status(
        "plaintext group send",
        lambda: request(
            "POST",
            base,
            "/group-chat/message/send",
            {
                "group_ulid": group_id,
                "type": 1,
                "content": "plaintext must not persist",
                "observed_membership_epoch": epoch,
            },
            actor.token,
            expect_error=True,
        ),
        {400},
    )


def negative_stale_epoch(base: str, actor: ActorLogin, group_id: str, epoch: int) -> int:
    stale = max(0, epoch - 1)
    if stale == epoch:
        stale = epoch + 1
    return expect_error_status(
        "stale membership epoch send",
        lambda: request(
            "POST",
            base,
            "/group-chat/message/send",
            {
                "group_ulid": group_id,
                "type": 1,
                "encrypted_payload": encrypted_payload(-1, actor),
                "observed_membership_epoch": stale,
            },
            actor.token,
            expect_error=True,
        ),
        {409},
    )


def negative_direct_join(base: str, actor: ActorLogin, group_id: str) -> int:
    return expect_error_status(
        "direct group join without invitation",
        lambda: request(
            "POST",
            base,
            "/group-chat/join",
            {"group_ulid": group_id, "invitation_ulid": ""},
            actor.token,
            expect_error=True,
        ),
        {400, 403, 404},
    )


def remove_member(base: str, owner: ActorLogin, group_id: str, target: ActorLogin) -> None:
    request(
        "POST",
        base,
        "/group-chat/member/remove",
        {"group_ulid": group_id, "actor_did": target.actor_id},
        owner.token,
    )


def negative_removed_member_send(base: str, actor: ActorLogin, group_id: str, epoch: int) -> int:
    return expect_error_status(
        "removed member send",
        lambda: request(
            "POST",
            base,
            "/group-chat/message/send",
            {
                "group_ulid": group_id,
                "type": 1,
                "encrypted_payload": encrypted_payload(-2, actor),
                "observed_membership_epoch": epoch,
            },
            actor.token,
            expect_error=True,
        ),
        {403},
    )


def list_messages_page(base: str, actor: ActorLogin, group_id: str, before_ulid: str = "", limit: int = 100) -> dict[str, Any]:
    query = {"group_ulid": group_id, "limit": str(limit)}
    if before_ulid:
        query["before_ulid"] = before_ulid
    return data_or_self(
        request("GET", base, f"/group-chat/messages?{urllib.parse.urlencode(query)}", token=actor.token, timeout=60)
    )


def recover_backlog(base: str, actor: ActorLogin, group_id: str, expected: int) -> tuple[int, int, float]:
    seen: set[str] = set()
    cursor = ""
    pages = 0
    start = time.perf_counter()
    while True:
        body = list_messages_page(base, actor, group_id, cursor, 100)
        pages += 1
        messages = body.get("messages")
        require(isinstance(messages, list), f"messages response missing list body={body}")
        for message in messages:
            ulid = str(field(message, "ulid") or "")
            if ulid:
                seen.add(ulid)
            content = str(field(message, "content") or "")
            encrypted = field(message, "encrypted_payload", "encryptedPayload")
            require(content == "", f"group message leaked plaintext content message={message}")
            require(bool(encrypted), f"group message missing encrypted_payload message={message}")
        if len(seen) >= expected:
            break
        if not body.get("has_more") and not body.get("hasMore"):
            break
        cursor = str(field(body, "next_cursor", "nextCursor") or "")
        if not cursor:
            break
    elapsed_ms = (time.perf_counter() - start) * 1000.0
    return len(seen), pages, elapsed_ms


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
    path = target_dir / "group_pressure_security_report.json"
    path.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
    return path


def main() -> int:
    base = station_url()
    actor_count = env_int("CHAT_GROUP_PRESSURE_ACTORS", DEFAULT_ACTORS)
    sender_count = env_int("CHAT_GROUP_PRESSURE_SENDERS", DEFAULT_SENDERS)
    message_count = env_int("CHAT_GROUP_PRESSURE_MESSAGES", DEFAULT_MESSAGES)
    require(actor_count >= 4, "CHAT_GROUP_PRESSURE_ACTORS must be >= 4")
    require(1 <= sender_count < actor_count, "CHAT_GROUP_PRESSURE_SENDERS must be >= 1 and < actor count")

    print("Group Pressure And Security")
    print("===========================")
    print(f"station={base}")
    print(f"actors={actor_count} senders={sender_count} messages={message_count}")

    actors = [signup_and_login(base, str(i)) for i in range(actor_count)]
    owner = actors[0]
    inactive = actors[-1]
    outsider = signup_and_login(base, "outsider")
    group_id, _ = create_group(base, owner, actors[1:])
    epoch = get_group_epoch(base, owner, group_id)
    require(epoch > 0, f"group membership epoch must be positive after create, got {epoch}")
    print(f"[OK] group created: {group_id} epoch={epoch}")

    security: dict[str, int] = {
        "plaintext_rejected": negative_plaintext(base, owner, group_id, epoch),
        "stale_epoch_rejected": negative_stale_epoch(base, owner, group_id, epoch),
        "direct_join_rejected": negative_direct_join(base, outsider, group_id),
    }
    print(f"[OK] security negatives before pressure: {security}")

    senders = actors[:sender_count]
    latencies: list[float] = []
    started = time.perf_counter()
    for index in range(message_count):
        sender = senders[index % len(senders)]
        latencies.append(send_group_message(base, sender, group_id, epoch, index))
        if (index + 1) % max(1, message_count // 10) == 0:
            print(f"[INFO] sent {index + 1}/{message_count}")
    total_ms = (time.perf_counter() - started) * 1000.0

    recovered, pages, recovery_ms = recover_backlog(base, inactive, group_id, message_count)
    require(recovered >= message_count, f"inactive recovery saw {recovered}/{message_count} messages")
    print(f"[OK] inactive recovery: messages={recovered} pages={pages} duration_ms={recovery_ms:.2f}")

    remove_member(base, owner, group_id, inactive)
    epoch_after_remove = get_group_epoch(base, owner, group_id)
    require(epoch_after_remove > epoch, f"remove did not advance epoch before={epoch} after={epoch_after_remove}")
    security["removed_member_send_rejected"] = negative_removed_member_send(base, inactive, group_id, epoch_after_remove)
    print(f"[OK] removed member rejected: epoch={epoch_after_remove}")

    report = {
        "station_url": base,
        "group_ulid": group_id,
        "actor_count": actor_count,
        "sender_count": sender_count,
        "message_count": message_count,
        "membership_epoch": epoch,
        "membership_epoch_after_remove": epoch_after_remove,
        "send_latency_ms": {
            "min": min(latencies),
            "max": max(latencies),
            "mean": statistics.fmean(latencies),
            "p50": percentile(latencies, 0.50),
            "p95": percentile(latencies, 0.95),
        },
        "send_total_ms": total_ms,
        "inactive_recovery": {
            "messages_seen": recovered,
            "pages": pages,
            "duration_ms": recovery_ms,
        },
        "security": security,
        "plaintext_leakage_check": "api_content_empty_and_encrypted_payload_present",
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
        print(f"group pressure/security failed: {error}", file=sys.stderr)
        raise SystemExit(1)
