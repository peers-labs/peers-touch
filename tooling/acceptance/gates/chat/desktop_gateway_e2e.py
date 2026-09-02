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
    actor_ptid: str = ""
    account_id: str = ""



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


def fixture_actor(role: str) -> ActorCredentials:
    actors = actor_manifest().get("actors")
    require(isinstance(actors, list), "actor manifest actors are required")
    actor = next(
        (
            item
            for item in actors
            if isinstance(item, dict) and item.get("role") == role
        ),
        None,
    )
    require(isinstance(actor, dict), f"actor manifest is missing role {role}")
    account_ref = str(actor.get("accountRef") or "")
    require(
        account_ref.startswith("station-account:"),
        f"actor manifest role {role} has invalid account reference",
    )
    email = account_ref.removeprefix("station-account:")
    require(
        email == ACTOR_ACCOUNTS.get(role),
        f"actor manifest role {role} does not match the committed fixture",
    )
    actor_ptid = str(actor.get("ptid") or "")
    require(
        actor_ptid.startswith("ptid:"),
        f"actor manifest role {role} has invalid PTID",
    )
    return ActorCredentials(
        name=role,
        email=email,
        password=ACTOR_PASSWORD,
        actor_ptid=actor_ptid,
    )



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


def gateway_status(
    gateway: str,
    command: str,
    args: dict[str, Any] | None = None,
) -> dict[str, Any]:
    data = gateway_command(gateway, command, args)
    status = data.get("status")
    require(isinstance(status, str), f"gateway command {command} missing status")
    parsed = json.loads(status)
    require(isinstance(parsed, dict), f"gateway command {command} status is invalid")
    return parsed


def current_identity(gateway: str) -> dict[str, Any]:
    session = gateway_status(gateway, "acceptance_current_session")
    active = gateway_status(gateway, "account_get_active").get("account")
    require(isinstance(active, dict), "account_get_active did not return an account")
    return {
        "accountId": str(session.get("account_id") or ""),
        "actorPtid": str(session.get("actor_ptid") or ""),
        "activeAccountId": str(active.get("id") or ""),
        "tokenFingerprint": str(session.get("token_fingerprint") or ""),
        "messagingProfileMatches": session.get("messaging_profile_matches"),
    }


def require_identity_tuple(
    identity: dict[str, Any],
    account_to_actor_ptid: dict[str, str],
) -> None:
    account_id = identity["accountId"]
    require(account_id == identity["activeAccountId"], f"identity account drift: {identity}")
    require(
        identity["actorPtid"] == account_to_actor_ptid.get(account_id),
        f"identity actor drift: {identity}",
    )
    require(
        identity["messagingProfileMatches"] is True,
        f"messaging profile drift: {identity}",
    )
    require(
        len(identity["tokenFingerprint"]) == 64,
        f"session token fingerprint is missing: {identity}",
    )


def identity_state_path(account_id: str) -> Path:
    clients = runtime_manifest().get("clients")
    require(
        isinstance(clients, list) and len(clients) == 1,
        "one gateway client is required",
    )
    storage_root = Path(str(clients[0].get("storage_root") or ""))
    require(storage_root.is_absolute(), "gateway storage root must be absolute")
    candidates = list(
        (storage_root / "peers-touch" / "desktop" / "data" / "account").glob(
            "*/identities.json"
        )
    )
    matching = []
    for path in candidates:
        value = json.loads(path.read_text(encoding="utf-8"))
        accounts = value.get("accounts") if isinstance(value, dict) else None
        if isinstance(accounts, list) and any(
            isinstance(account, dict) and account.get("id") == account_id
            for account in accounts
        ):
            matching.append(path)
    require(len(matching) == 1, "selected account must have one identity state file")
    return matching[0]


def replace_identity_state(path: Path, content: bytes) -> None:
    temporary = path.with_name(f".{path.name}.{secrets.token_hex(6)}.tmp")
    temporary.write_bytes(content)
    temporary.chmod(path.stat().st_mode)
    os.replace(temporary, path)


def remove_persisted_actor_binding(account_id: str) -> tuple[Path, bytes]:
    path = identity_state_path(account_id)
    original = path.read_bytes()
    state = json.loads(original)
    account = next(
        (
            item
            for item in state.get("accounts", [])
            if isinstance(item, dict) and item.get("id") == account_id
        ),
        None,
    )
    require(isinstance(account, dict), "selected account disappeared from identity state")
    encrypted = account.get("encrypted_session")
    require(isinstance(encrypted, dict), "selected account has no encrypted PIN session")
    encrypted.pop("actor_ptid", None)
    replace_identity_state(
        path,
        (json.dumps(state, indent=2, sort_keys=True) + "\n").encode("utf-8"),
    )
    return path, original


def run_identity_consistency_flow(
    report: EvidenceReport,
    gateway: str,
    actor_a: ActorCredentials,
    actor_b: ActorCredentials,
) -> None:
    account_a = actor_a.account_id
    account_b = actor_b.account_id
    require(bool(account_a), "actor A login did not capture an account ID")
    require(bool(account_b), "actor B login did not capture an account ID")
    account_to_actor_ptid = {
        account_a: actor_a.actor_ptid,
        account_b: actor_b.actor_ptid,
    }
    gateway_status(
        gateway,
        "acceptance_identity_transition_metrics",
        {"reset": True},
    )
    start_barrier = Barrier(2)

    def switch_after_barrier(account_id: str) -> dict[str, Any]:
        start_barrier.wait(timeout=5)
        return gateway_command(
            gateway,
            "account_switch",
            {"id": account_id, "acceptance_hold_ms": 250},
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = {
            account_id: executor.submit(
                switch_after_barrier,
                account_id,
            )
            for account_id in (account_a, account_b)
        }
        switched = {
            account_id: str(future.result().get("actor_ptid") or "")
            for account_id, future in futures.items()
        }
    transition_metrics = gateway_status(
        gateway,
        "acceptance_identity_transition_metrics",
    )
    require(
        int(transition_metrics.get("max_waiters") or 0) >= 2,
        f"account switch requests did not overlap at the identity lock: {transition_metrics}",
    )
    require(
        switched == account_to_actor_ptid,
        f"concurrent account switch drift: {switched}",
    )
    require_identity_tuple(current_identity(gateway), account_to_actor_ptid)
    report.add_assertion("concurrent_account_switch_identity_atomic", True)

    gateway_command(gateway, "account_switch", {"id": account_b})
    previous_identity = current_identity(gateway)
    failed_commit = gateway_envelope(
        gateway,
        "account_switch",
        {
            "id": account_a,
            "acceptance_fail_identity_commit": True,
        },
    )
    require(failed_commit.get("ok") is False, "durable identity failure must fail closed")
    reason = failed_commit.get("error", {}).get("details", {}).get("reason")
    require(reason == "identity_commit_failed", f"unexpected commit failure: {reason}")
    require(
        current_identity(gateway) == previous_identity,
        "durable commit failure changed the prior account/JWT/runtime tuple",
    )
    report.add_assertion("identity_commit_failure_rolls_back", True)

    provider_user_id = f"provider-user-{secrets.token_hex(6)}"
    oauth_state = gateway_status(
        gateway,
        "account_upsert_oauth",
        {
            "actor_ptid": actor_b.actor_ptid,
            "provider": "acceptance-oauth",
            "provider_user_id": provider_user_id,
            "name": "Acceptance OAuth",
        },
    )
    oauth_account = str(oauth_state.get("active_account_id") or "")
    require(bool(oauth_account), "OAuth fixture account was not persisted")
    test_pin = secrets.token_hex(4)
    gateway_status(
        gateway,
        "account_set_pin",
        {"account_id": oauth_account, "pin": test_pin},
    )

    gateway_command(gateway, "account_switch", {"id": account_a})
    previous_identity = current_identity(gateway)
    failed_switch = gateway_envelope(
        gateway,
        "account_switch",
        {"id": oauth_account},
    )
    require(failed_switch.get("ok") is False, "PIN-protected switch must fail closed")
    require(
        current_identity(gateway) == previous_identity,
        "failed account switch changed the committed identity tuple",
    )
    report.add_assertion("failed_account_switch_preserves_identity", True)

    unlocked = gateway_command(
        gateway,
        "account_unlock",
        {"account_id": oauth_account, "pin": test_pin},
    )
    require(
        str(unlocked.get("actor_ptid") or "") == actor_b.actor_ptid,
        "OAuth PIN unlock did not use the JWT actor",
    )
    require(
        str(unlocked.get("actor_ptid") or "") != provider_user_id,
        "OAuth PIN unlock derived actor from provider_user_id",
    )
    account_to_actor_ptid[oauth_account] = actor_b.actor_ptid
    require_identity_tuple(current_identity(gateway), account_to_actor_ptid)
    report.add_assertion("oauth_pin_unlock_uses_jwt_actor", True)

    state_path, original = remove_persisted_actor_binding(oauth_account)
    try:
        previous_identity = current_identity(gateway)
        failed_unlock = gateway_envelope(
            gateway,
            "account_unlock",
            {"account_id": oauth_account, "pin": test_pin},
        )
        require(failed_unlock.get("ok") is False, "legacy PIN session must fail closed")
        reason = (
            failed_unlock.get("error", {})
            .get("details", {})
            .get("reason")
        )
        require(reason == "persisted_actor_missing", f"unexpected legacy PIN failure: {reason}")
        require(
            current_identity(gateway) == previous_identity,
            "legacy PIN rejection changed the committed identity tuple",
        )
        report.add_assertion("legacy_pin_missing_actor_rejected", True)
    finally:
        replace_identity_state(state_path, original)


def gateway_login(gateway: str, actor: ActorCredentials, timeout: int = 30) -> str:
    data = gateway_command(
        gateway,
        "auth_login",
        {"account": actor.email, "password": actor.password},
        timeout=timeout,
    )
    actor_ptid = data.get("actor_ptid") or ""
    require(
        isinstance(actor_ptid, str) and actor_ptid.startswith("ptid:"),
        f"gateway auth_login missing actor_ptid data={data}",
    )
    if actor.actor_ptid:
        require(
            actor_ptid == actor.actor_ptid,
            f"gateway auth_login PTID mismatch got={actor_ptid} want={actor.actor_ptid}",
        )
    identity = current_identity(gateway)
    require(
        identity["actorPtid"] == actor_ptid,
        f"gateway login/session actor drift: {identity}",
    )
    require(
        identity["accountId"] == identity["activeAccountId"],
        f"gateway login/account drift: {identity}",
    )
    require(bool(identity["accountId"]), f"gateway login missing account ID: {identity}")
    actor.actor_ptid = actor_ptid
    actor.account_id = identity["accountId"]
    return actor_ptid



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

    create_result = gateway_command(
        gateway,
        "messaging_create_direct",
        {"peer_ptid": actor_b.actor_ptid},
        timeout=30,
    )

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
            require(
                sender == actor_a.actor_ptid,
                f"message sender mismatch got={sender} want={actor_a.actor_ptid}",
            )
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
