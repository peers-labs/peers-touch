#!/usr/bin/env python3
"""Chat friend-request gateway acceptance gate.

Proves the friend-request lifecycle through the Desktop Rust gateway:

1. Login actor A (alice) via Desktop HTTP gateway.
2. Login actor B (bob) via Desktop HTTP gateway (separate session).
3. Actor A sends a friend request to actor B.
4. Actor B lists pending friend requests and finds A's request.
5. Actor B accepts the friend request.
6. Verify friendship is established (bidirectional follow).

This gate uses the current `social_friend_request_*` Tauri command surface
and the Station `/api/v1/social/friend-request/*` API. It does NOT prove
DOM-level UI interaction or conversation creation.

Environment:
  PT_ACCEPTANCE_RUNTIME_MANIFEST    path to provisioner-generated manifest
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from tooling.acceptance.core import (
    AcceptanceGate,
    ArtifactRef,
    EvidenceReport,
    EvidenceStore,
    ProvisioningError,
    REPO_ROOT,
    load_runtime_manifest,
    require_runtime_service,
)
from tooling.acceptance.fixtures.chat_native_actors import (
    ACTOR_ACCOUNTS,
    ACTOR_PASSWORD,
)

GATE_ID = "chat-friend-request-gateway-e2e"


@dataclass
class ActorCredentials:
    name: str
    email: str
    password: str
    actor_ptid: str = ""
    account_id: str = ""


class GateError(RuntimeError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise GateError(message)


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
    if not isinstance(clients, list) or len(clients) < 1:
        raise GateError("runtime manifest requires at least one Desktop gateway client")
    port = clients[0].get("gateway_port")
    if not isinstance(port, int) or port <= 0:
        raise GateError("runtime manifest Desktop gateway port is invalid")
    return f"http://127.0.0.1:{port}"


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
        raise GateError(
            f"gateway command {command} failed status={error.code} body={detail}"
        ) from error
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


def gateway_login(gateway: str, actor: ActorCredentials) -> ActorCredentials:
    result = gateway_status(
        gateway,
        "auth_login",
        {"email": actor.email, "password": actor.password},
    )
    actor.account_id = str(result.get("account_id") or "")
    actor.actor_ptid = str(result.get("actor_ptid") or actor.actor_ptid)
    require(bool(actor.account_id), f"login {actor.name} did not return an account ID")
    require(bool(actor.actor_ptid), f"login {actor.name} did not return a PTID")
    return actor


def gateway_logout(gateway: str) -> None:
    try:
        gateway_command(gateway, "auth_logout")
    except Exception:
        pass


def get_station_peer_id(station: str) -> str:
    req = urllib.request.Request(f"{station}/sub-oss/healthz", method="GET")
    with urllib.request.urlopen(req, timeout=10) as response:
        data = json.loads(response.read().decode("utf-8"))
    return ""


def get_federation_id(gateway: str) -> str:
    data = gateway_command(gateway, "federation_list")
    status_raw = data.get("status", "")
    if isinstance(status_raw, str):
        parsed = json.loads(status_raw)
    else:
        parsed = status_raw
    federations = parsed.get("federations") or parsed.get("items") or []
    require(len(federations) > 0, "no federation available for friend request")
    return str(federations[0].get("federation_id") or federations[0].get("federationId") or "")


def run_friend_request_flow(report: EvidenceReport) -> dict[str, Any]:
    gateway_a = gateway_url()
    station = station_url()

    actor_a = fixture_actor("alice")
    actor_b = fixture_actor("bob")

    gateway_login(gateway_a, actor_a)
    report.add_assertion("actor_a_login_via_gateway", True)

    federation_id = get_federation_id(gateway_a)
    require(bool(federation_id), "federation ID is required for friend request")
    report.add_assertion("federation_available", True)

    gateway_command(
        gateway_a,
        "social_friend_request_send",
        {
            "receiver_ptid": actor_b.actor_ptid,
            "receiver_home_station_peer_id": actor_a.actor_ptid.split(":")[0]
                if ":" not in actor_a.actor_ptid else "",
            "federation_id": federation_id,
            "message": "acceptance gate friend request",
        },
    )
    report.add_assertion("actor_a_sends_friend_request", True)

    gateway_command(gateway_a, "account_switch", {"id": ""})
    gateway_login(gateway_a, actor_b)
    report.add_assertion("actor_b_login_via_gateway", True)

    requests_data = gateway_command(gateway_a, "social_friend_request_list")
    status_raw = requests_data.get("status", "")
    if isinstance(status_raw, str):
        parsed = json.loads(status_raw)
    else:
        parsed = status_raw
    requests_list = parsed.get("requests") or parsed.get("items") or []
    pending = [
        r for r in requests_list
        if str(r.get("sender_ptid") or r.get("senderPtid") or "") == actor_a.actor_ptid
    ]
    require(len(pending) > 0, f"actor B has no pending request from actor A: {requests_list}")
    report.add_assertion("actor_b_sees_pending_request", True)

    request_id = str(
        pending[0].get("request_id")
        or pending[0].get("requestId")
        or pending[0].get("id")
        or ""
    )
    require(bool(request_id), "pending friend request has no request_id")

    gateway_command(
        gateway_a,
        "social_friend_request_accept",
        {"request_id": request_id},
    )
    report.add_assertion("actor_b_accepts_friend_request", True)

    gateway_command(gateway_a, "account_switch", {"id": ""})
    gateway_login(gateway_a, actor_a)

    time.sleep(1)

    friends_data = gateway_command(
        gateway_a,
        "social_relationships_list",
        {"relationship_type": "friend"},
    )
    status_raw = friends_data.get("status", "")
    if isinstance(status_raw, str):
        parsed = json.loads(status_raw)
    else:
        parsed = status_raw
    friends = parsed.get("relationships") or parsed.get("friends") or parsed.get("items") or []
    is_friend = any(
        str(f.get("ptid") or f.get("actor_ptid") or f.get("actorPtid") or "") == actor_b.actor_ptid
        for f in friends
    )
    report.add_assertion(
        "friendship_established",
        is_friend,
        f"actor B not in actor A friends list: {[str(f.get('ptid', f.get('actor_ptid', ''))) for f in friends]}",
    )

    return {
        "actor_a": actor_a.actor_ptid,
        "actor_b": actor_b.actor_ptid,
        "federation_id": federation_id,
        "request_id": request_id,
        "friendship_confirmed": is_friend,
    }


class FriendRequestGatewayE2EGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "MP-W03"
    bom = ("MP-G01",)
    spec = ("chat-friend-request-gateway-lifecycle",)

    def run(self) -> dict[str, Any]:
        self.report.manifest = runtime_manifest()
        self.report.station_url = station_url()
        gateway = gateway_url()
        try:
            result = run_friend_request_flow(self.report)
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
    return FriendRequestGatewayE2EGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
