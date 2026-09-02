#!/usr/bin/env python3
"""Chat Desktop gateway acceptance gate.

This gate validates the Desktop Rust gateway as a real Chat client boundary
using the MLS/E2EE messaging pipeline:

1. create two temporary actors through the running Station;
2. login actor A through the Desktop HTTP gateway, create a direct
   conversation with actor B, and send an E2EE message;
3. login actor B through the Desktop HTTP gateway, hydrate conversations,
   and verify the message is received and decrypted.

It is intentionally not a DOM-level Desktop UI E2E. It proves the
desktop-rust BFF/gateway contract over real auth, MLS key exchange,
envelope routing, and message persistence.

Environment:
  CHAT_DESKTOP_GATEWAY_URL          default http://127.0.0.1:3030
  CHAT_DESKTOP_GATEWAY_STATION_URL  default http://10.37.94.156:18080
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
from functools import lru_cache
from pathlib import Path
from typing import Any

from tooling.acceptance.core import (
    ProvisioningError,
    load_runtime_manifest,
    require_runtime_service,
)

GATE_ID = "chat-desktop-gateway-e2e"


@dataclass
class ActorCredentials:
    name: str
    email: str
    password: str
    token: str
    actor_id: str
    ptid: str = ""


class GateError(RuntimeError):
    pass


@lru_cache(maxsize=1)
def runtime_manifest() -> dict[str, Any]:
    path = os.environ.get("PT_ACCEPTANCE_RUNTIME_MANIFEST", "")
    if not path:
        raise GateError("PT_ACCEPTANCE_RUNTIME_MANIFEST is required")
    try:
        return load_runtime_manifest(Path(path), GATE_ID)
    except ProvisioningError as error:
        raise GateError(str(error)) from error


def station_url() -> str:
    try:
        station = require_runtime_service(
            runtime_manifest(),
            "station",
            "station",
        )
    except ProvisioningError as error:
        raise GateError(str(error)) from error
    return str(station["endpoint"]).rstrip("/")


def gateway_url() -> str:
    clients = runtime_manifest().get("clients")
    if not isinstance(clients, list) or len(clients) != 1:
        raise GateError("runtime manifest requires one Desktop gateway client")
    port = clients[0].get("gateway_port")
    if not isinstance(port, int) or port <= 0:
        raise GateError("runtime manifest Desktop gateway port is invalid")
    return f"http://127.0.0.1:{port}"


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


def signup(base: str, label: str) -> tuple[str, str, str]:
    suffix = f"{int(time.time() * 1000)}{secrets.token_hex(3)}"
    name = f"gw{label}{suffix}"[:20]
    email = f"{name}@testnet.local"
    password = "ChatAa1@" + secrets.token_hex(4)
    station_request("POST", base, "/actor/sign-up", {"name": name, "email": email, "password": password})
    time.sleep(4)
    return name, email, password


def station_login(base: str, email: str, password: str) -> tuple[str, str]:
    for attempt in range(5):
        try:
            login_body = station_request(
                "POST", base, "/actor/login",
                {"email": email, "password": password, "device_type": "desktop"},
            )
            login_data = data_or_self(login_body)
            token_data = login_data.get("tokens") if isinstance(login_data.get("tokens"), dict) else {}
            token = token_data.get("access_token")
            if not token:
                raise GateError(f"login response missing access_token fields={sorted(login_data.keys())}")
            actor_id = actor_id_from_login(login_data)
            return str(token), actor_id
        except GateError:
            if attempt == 4:
                raise
            time.sleep(3)
    raise GateError("unreachable")


def signup_and_login(base: str, label: str) -> ActorCredentials:
    name, email, password = signup(base, label)
    token, actor_id = station_login(base, email, password)
    return ActorCredentials(name=name, email=email, password=password, token=token, actor_id=actor_id)


def gateway_command(gateway: str, command: str, args: dict[str, Any] | None = None, timeout: int = 30) -> dict[str, Any]:
    body = json.dumps({"cmd": command, "args": args or {}}).encode("utf-8")
    req = urllib.request.Request(
        gateway,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            envelope = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise GateError(f"gateway command {command} failed status={error.code} body={detail}") from error
    if not envelope.get("ok"):
        raise GateError(f"gateway command {command} failed envelope={envelope}")
    data = envelope.get("data")
    require(isinstance(data, dict), f"gateway command {command} missing data envelope={envelope}")
    return data


def gateway_login(gateway: str, actor: ActorCredentials, timeout: int = 30) -> str:
    data = gateway_command(gateway, "auth_login", {"account": actor.email, "password": actor.password}, timeout=timeout)
    ptid = data.get("ptid") or ""
    require(isinstance(ptid, str) and ptid.startswith("ptid:"), f"gateway auth_login missing ptid data={data}")
    actor_id = data.get("actor_id")
    require(str(actor_id) == actor.actor_id, f"gateway auth_login actor mismatch got={actor_id} want={actor.actor_id}")
    actor.ptid = ptid
    return ptid


def gateway_logout(gateway: str) -> None:
    try:
        gateway_command(gateway, "auth_logout", timeout=10)
    except Exception:
        pass


def wait_alive(gateway: str, seconds: int = 30) -> None:
    last_err = None
    for _ in range(seconds):
        try:
            body = json.dumps({"cmd": "station_list", "args": {}}).encode("utf-8")
            req = urllib.request.Request(gateway, data=body, headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=5) as resp:
                json.loads(resp.read().decode("utf-8"))
                return
        except Exception as e:
            last_err = e
            time.sleep(1)
    raise GateError(f"gateway at {gateway} did not become ready within {seconds}s: {last_err}")


def main() -> int:
    base = station_url()
    gateway = gateway_url()
    print("Chat Desktop Gateway E2E (MLS messaging)")
    print("========================================")
    print(f"station={base}")
    print(f"gateway={gateway}")

    wait_alive(gateway)
    print("[OK] gateway is reachable")

    print("[..] configuring station on gateway...")
    gateway_command(gateway, "station_add", {"url": base}, timeout=10)
    gateway_command(gateway, "station_set_active", {"url": base}, timeout=10)
    print("[OK] station configured")

    actor_a = signup_and_login(base, "a")
    actor_b = signup_and_login(base, "b")
    print(f"[OK] actors created: a={actor_a.actor_id} b={actor_b.actor_id}")

    # --- Login B first to publish KeyPackages/PreKeys to station and get PTID ---
    gateway_login(gateway, actor_b, timeout=30)
    print(f"[OK] gateway authenticated actor B ptid={actor_b.ptid[:60]}...")
    time.sleep(10)
    gateway_logout(gateway)
    time.sleep(3)

    # --- Login A via gateway and create direct conversation with B ---
    gateway_login(gateway, actor_a, timeout=30)
    print(f"[OK] gateway authenticated actor A ptid={actor_a.ptid[:60]}...")
    time.sleep(8)

    create_result = gateway_command(gateway, "messaging_create_direct", {
        "peer_ptid": actor_b.ptid,
    }, timeout=30)
    conv_id = create_result.get("conversation_id") or ""
    require(bool(conv_id), f"messaging_create_direct missing conversation_id result={create_result}")
    print(f"[OK] direct conversation created: {conv_id}")
    time.sleep(8)

    # --- Send message from A ---
    test_content = f"acceptance-mls-{int(time.time() * 1000)}"
    send_result = gateway_command(gateway, "messaging_send_message", {
        "conversation_id": conv_id,
        "conversation_kind": "direct",
        "plaintext": test_content,
    }, timeout=30)
    msg_id = send_result.get("message_id") or ""
    require(bool(msg_id), f"send_message missing message_id result={send_result}")
    print(f"[OK] message sent from A: {msg_id}")
    time.sleep(6)

    # Drain A's queue to ensure delivery
    gateway_command(gateway, "messaging_drain", {"wait_ms": 3000}, timeout=15)

    gateway_logout(gateway)
    time.sleep(2)

    # --- Login B via gateway and verify receipt ---
    gateway_login(gateway, actor_b, timeout=30)
    print("[OK] gateway authenticated actor B")
    time.sleep(5)

    # Hydrate conversations from Station
    gateway_command(gateway, "messaging_hydrate", {}, timeout=30)
    print("[OK] B hydrated conversations from Station")
    time.sleep(5)

    # List conversations - should see the direct conv
    list_conv_result = gateway_command(gateway, "messaging_list_conversations", {}, timeout=15)
    conversations = list_conv_result.get("conversations") or []
    require(isinstance(conversations, list), f"conversations response not a list result={list_conv_result}")
    conv_ids = [str(c.get("conversation_id", "")) for c in conversations if isinstance(c, dict)]
    print(f"[OK] B sees {len(conversations)} conversation(s): {conv_ids[:5]}")
    b_has_conv = any(cid == conv_id for cid in conv_ids)
    if not b_has_conv:
        time.sleep(5)
        gateway_command(gateway, "messaging_hydrate", {}, timeout=30)
        list_conv_result = gateway_command(gateway, "messaging_list_conversations", {}, timeout=15)
        conversations = list_conv_result.get("conversations") or []
        conv_ids = [str(c.get("conversation_id", "")) for c in conversations if isinstance(c, dict)]
        b_has_conv = any(cid == conv_id for cid in conv_ids)
    require(b_has_conv, f"B does not see direct conversation {conv_id} conv_ids={conv_ids}")
    print("[OK] B sees the direct conversation with A")

    # List messages in the conversation
    list_msg_result = gateway_command(gateway, "messaging_list_messages", {
        "conversation_id": conv_id,
    }, timeout=15)
    messages = list_msg_result.get("messages") or []
    require(isinstance(messages, list), f"messages response not a list result={list_msg_result}")
    print(f"[OK] B sees {len(messages)} message(s) in conversation")

    found = False
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        if msg.get("plaintext") == test_content:
            sender = msg.get("sender_ptid", "")
            require(sender == actor_a.ptid, f"message sender mismatch got={sender} want={actor_a.ptid}")
            found = True
            break

    if not found:
        time.sleep(5)
        gateway_command(gateway, "messaging_drain", {"wait_ms": 5000}, timeout=15)
        list_msg_result = gateway_command(gateway, "messaging_list_messages", {
            "conversation_id": conv_id,
        }, timeout=15)
        messages = list_msg_result.get("messages") or []
        for msg in messages:
            if isinstance(msg, dict) and msg.get("plaintext") == test_content:
                found = True
                break

    require(found, f"B did not receive message '{test_content}' messages={messages[:3]}")
    print(f"[OK] B received and decrypted message: '{test_content}'")

    gateway_logout(gateway)

    print()
    print("=" * 56)
    print("CHAT DESKTOP GATEWAY E2E PASSED (MLS)")
    print(f"  Direct conversation: {conv_id}")
    print(f"  Message verified: '{test_content}'")
    print(f"  A: {actor_a.email}")
    print(f"  B: {actor_b.email}")
    print("=" * 56)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"chat desktop gateway e2e failed: {error}", file=sys.stderr)
        raise SystemExit(1)
