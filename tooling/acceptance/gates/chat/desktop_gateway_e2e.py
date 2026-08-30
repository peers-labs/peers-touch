#!/usr/bin/env python3
"""Chat Desktop gateway acceptance gate.

This gate validates the Desktop Rust gateway as a real Chat client boundary
using the MLS/E2EE messaging pipeline:

1. consume the Provisioner-owned Alice/Bob fixture identities;
2. login actor A through the Desktop HTTP gateway, create a direct
   conversation with actor B, and send an E2EE message;
3. login actor B through the Desktop HTTP gateway, hydrate conversations,
   and verify the message is received and decrypted.
4. prove account switch and PIN unlock preserve one account/JWT/Engine tuple.

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
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from threading import Barrier
from typing import Any

from tooling.acceptance.core import (
    AcceptanceGate,
    ArtifactRef,
    EvidenceReport,
    EvidenceStore,
    ProvisioningError,
    REPO_ROOT,
    load_runtime_manifest,
)
from tooling.acceptance.fixtures.chat_native_actors import (
    ACTOR_ACCOUNTS,
    ACTOR_PASSWORD,
)

GATE_ID = "chat-desktop-gateway-e2e"


@dataclass
class ActorCredentials:
    name: str
    email: str
    password: str
    actor_id: str = ""
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


@lru_cache(maxsize=1)
def actor_manifest() -> dict[str, Any]:
    reference = runtime_manifest().get("actorManifest")
    if not isinstance(reference, dict):
        raise GateError("runtime manifest actorManifest is required")
    manifest = EvidenceStore.from_environment(
        repo_root=REPO_ROOT,
        worktree=REPO_ROOT,
    ).read_json(
        ArtifactRef.from_dict(reference)
    )
    if manifest.get("artifactKind") != "acceptance-actor-manifest":
        raise GateError("runtime actor manifest has invalid artifact kind")
    return manifest


def station_url() -> str:
    station = runtime_manifest().get("station")
    if not isinstance(station, dict) or not station.get("url"):
        raise GateError("runtime manifest Station URL is required")
    return str(station["url"]).rstrip("/")


def gateway_url() -> str:
    clients = runtime_manifest().get("clients")
    if not isinstance(clients, list) or len(clients) != 1:
        raise GateError("runtime manifest requires one Desktop gateway client")
    port = clients[0].get("gateway_port")
    if not isinstance(port, int) or port <= 0:
        raise GateError("runtime manifest Desktop gateway port is invalid")
    return f"http://127.0.0.1:{port}"


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
    ptid = str(actor.get("ptid") or "")
    require(ptid.startswith("ptid:"), f"actor manifest role {role} has invalid PTID")
    return ActorCredentials(
        name=role,
        email=email,
        password=ACTOR_PASSWORD,
        ptid=ptid,
    )


def gateway_envelope(
    gateway: str,
    command: str,
    args: dict[str, Any] | None = None,
    timeout: int = 30,
) -> dict[str, Any]:
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
    require(isinstance(envelope, dict), f"gateway command {command} returned invalid envelope")
    return envelope


def gateway_command(
    gateway: str,
    command: str,
    args: dict[str, Any] | None = None,
    timeout: int = 30,
) -> dict[str, Any]:
    envelope = gateway_envelope(gateway, command, args, timeout)
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


def account_id_for_actor(gateway: str, actor_id: str) -> str:
    accounts = gateway_status(gateway, "account_list").get("accounts")
    require(isinstance(accounts, list), "account_list did not return accounts")
    matches = [
        str(account.get("id") or "")
        for account in accounts
        if isinstance(account, dict)
        and str(account.get("provider_user_id") or "") == actor_id
    ]
    require(len(matches) == 1 and bool(matches[0]), f"missing account for actor {actor_id}")
    return matches[0]


def current_identity(gateway: str) -> dict[str, Any]:
    session = gateway_status(gateway, "acceptance_current_session")
    active = gateway_status(gateway, "account_get_active").get("account")
    require(isinstance(active, dict), "account_get_active did not return an account")
    return {
        "accountId": str(session.get("account_id") or ""),
        "actorId": str(session.get("actor_id") or ""),
        "activeAccountId": str(active.get("id") or ""),
        "tokenFingerprint": str(session.get("token_fingerprint") or ""),
        "messagingProfileMatches": session.get("messaging_profile_matches"),
    }


def require_identity_tuple(
    identity: dict[str, Any],
    account_to_actor: dict[str, str],
) -> None:
    account_id = identity["accountId"]
    require(account_id == identity["activeAccountId"], f"identity account drift: {identity}")
    require(
        identity["actorId"] == account_to_actor.get(account_id),
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
    encrypted.pop("actor_id", None)
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
    account_a = account_id_for_actor(gateway, actor_a.actor_id)
    account_b = account_id_for_actor(gateway, actor_b.actor_id)
    account_to_actor = {
        account_a: actor_a.actor_id,
        account_b: actor_b.actor_id,
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
            account_id: str(future.result().get("actor_id") or "")
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
    require(switched == account_to_actor, f"concurrent account switch drift: {switched}")
    require_identity_tuple(current_identity(gateway), account_to_actor)
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

    gateway_command(gateway, "account_switch", {"id": account_b})
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
        str(unlocked.get("actor_id") or "") == actor_b.actor_id,
        "OAuth PIN unlock did not use the JWT actor",
    )
    require(
        str(unlocked.get("actor_id") or "") != provider_user_id,
        "OAuth PIN unlock derived actor from provider_user_id",
    )
    account_to_actor[oauth_account] = actor_b.actor_id
    require_identity_tuple(current_identity(gateway), account_to_actor)
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
    ptid = data.get("ptid") or ""
    require(
        isinstance(ptid, str) and ptid.startswith("ptid:"),
        f"gateway auth_login missing ptid data={data}",
    )
    if actor.ptid:
        require(
            ptid == actor.ptid,
            f"gateway auth_login PTID mismatch got={ptid} want={actor.ptid}",
        )
    actor_id = data.get("actor_id")
    require(bool(actor_id), f"gateway auth_login missing actor data={data}")
    if actor.actor_id:
        require(
            str(actor_id) == actor.actor_id,
            f"gateway auth_login actor mismatch got={actor_id} want={actor.actor_id}",
        )
    actor.actor_id = str(actor_id)
    actor.ptid = ptid
    return ptid


def gateway_logout(gateway: str) -> None:
    gateway_command(gateway, "auth_logout", timeout=10)


def wait_alive(gateway: str, seconds: int = 30) -> None:
    last_err = None
    for _ in range(seconds):
        try:
            body = json.dumps({"cmd": "station_list", "args": {}}).encode("utf-8")
            req = urllib.request.Request(
                gateway,
                data=body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                json.loads(resp.read().decode("utf-8"))
                return
        except Exception as e:
            last_err = e
            time.sleep(1)
    raise GateError(f"gateway at {gateway} did not become ready within {seconds}s: {last_err}")


def run_gateway_flow(report: EvidenceReport) -> dict[str, Any]:
    base = station_url()
    gateway = gateway_url()

    wait_alive(gateway)
    report.add_assertion("gateway_reachable", True)

    gateway_command(gateway, "station_add", {"url": base}, timeout=10)
    gateway_command(gateway, "station_set_active", {"url": base}, timeout=10)
    report.add_assertion("station_configured", True)

    actor_a = fixture_actor("alice")
    actor_b = fixture_actor("bob")

    # --- Login B first to publish KeyPackages/PreKeys to station and get PTID ---
    gateway_login(gateway, actor_b, timeout=30)
    report.add_assertion("actor_b_authenticated", True)
    time.sleep(10)

    # --- Prove identity transitions before exercising the messaging path ---
    gateway_login(gateway, actor_a, timeout=30)
    report.add_assertion("actor_a_authenticated", True)
    run_identity_consistency_flow(report, gateway, actor_a, actor_b)

    # Refresh A after PIN takeover testing, then create a direct conversation with B.
    gateway_login(gateway, actor_a, timeout=30)
    time.sleep(8)

    create_result = gateway_command(
        gateway,
        "messaging_create_direct",
        {"peer_ptid": actor_b.ptid},
        timeout=30,
    )
    conv_id = create_result.get("conversation_id") or ""
    require(
        bool(conv_id),
        f"messaging_create_direct missing conversation_id result={create_result}",
    )
    report.add_assertion(
        "direct_conversation_created",
        True,
        detail=f"conversation_id={conv_id}",
    )

    # --- Send message from A ---
    test_content = f"acceptance-mls-{int(time.time() * 1000)}"
    send_result = gateway_command(
        gateway,
        "messaging_send_message",
        {
            "conversation_id": conv_id,
            "conversation_kind": "direct",
            "plaintext": test_content,
        },
        timeout=30,
    )
    msg_id = send_result.get("message_id") or ""
    require(bool(msg_id), f"send_message missing message_id result={send_result}")
    report.add_assertion(
        "message_sent",
        True,
        detail=f"message_id={msg_id}",
    )
    time.sleep(6)

    # Drain A's queue to ensure delivery
    gateway_command(gateway, "messaging_drain", {"wait_ms": 3000}, timeout=15)

    gateway_logout(gateway)
    time.sleep(2)

    # --- Login B via gateway and verify receipt ---
    gateway_login(gateway, actor_b, timeout=30)
    time.sleep(5)

    # Hydrate conversations from Station
    gateway_command(gateway, "messaging_hydrate", {}, timeout=30)
    time.sleep(5)

    # List conversations - should see the direct conv
    list_conv_result = gateway_command(gateway, "messaging_list_conversations", {}, timeout=15)
    conversations = list_conv_result.get("conversations") or []
    require(isinstance(conversations, list), f"conversations response not a list result={list_conv_result}")
    conv_ids = [str(c.get("conversation_id", "")) for c in conversations if isinstance(c, dict)]
    b_has_conv = any(cid == conv_id for cid in conv_ids)
    if not b_has_conv:
        time.sleep(5)
        gateway_command(gateway, "messaging_hydrate", {}, timeout=30)
        list_conv_result = gateway_command(gateway, "messaging_list_conversations", {}, timeout=15)
        conversations = list_conv_result.get("conversations") or []
        conv_ids = [str(c.get("conversation_id", "")) for c in conversations if isinstance(c, dict)]
        b_has_conv = any(cid == conv_id for cid in conv_ids)
    require(b_has_conv, f"B does not see direct conversation {conv_id} conv_ids={conv_ids}")
    report.add_assertion("receiver_conversation_hydrated", True)

    # List messages in the conversation
    list_msg_result = gateway_command(gateway, "messaging_list_messages", {
        "conversation_id": conv_id,
    }, timeout=15)
    messages = list_msg_result.get("messages") or []
    require(isinstance(messages, list), f"messages response not a list result={list_msg_result}")

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
    report.add_assertion("receiver_message_decrypted", True)

    return {
        "conversationId": conv_id,
        "messageId": msg_id,
        "journey": "desktop-gateway-direct-message",
    }


class DesktopGatewayE2EGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "MP-W03"
    bom = ("MP-G01", "MP-G02", "MP-G03", "MP-G04")
    spec = ("chat-desktop-gateway-message-flow",)

    def run(self) -> dict[str, Any]:
        self.report.manifest = runtime_manifest()
        self.report.station_url = station_url()
        gateway = gateway_url()
        try:
            result = run_gateway_flow(self.report)
        except Exception:
            try:
                gateway_logout(gateway)
                self.report.add_assertion("gateway_local_session_cleanup", True)
            except Exception as cleanup_error:
                self.report.add_assertion(
                    "gateway_local_session_cleanup",
                    False,
                    str(cleanup_error),
                )
            raise
        gateway_logout(gateway)
        self.report.add_assertion("gateway_local_session_cleanup", True)
        return result


def main() -> int:
    return DesktopGatewayE2EGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
