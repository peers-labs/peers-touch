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
from tooling.acceptance.gates.station_access.gateway import gateway_access_login

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


def gateway_proto_command(
    gateway: str,
    command: str,
    args: dict[str, Any] | None = None,
) -> bytes:
    envelope = gateway_envelope(gateway, command, args)
    if not envelope.get("ok"):
        raise GateError(f"gateway command {command} failed envelope={envelope}")
    data = envelope.get("data")
    require(
        isinstance(data, list)
        and data
        and all(
            isinstance(value, int)
            and not isinstance(value, bool)
            and 0 <= value <= 255
            for value in data
        ),
        f"gateway command {command} returned invalid protobuf bytes",
    )
    return bytes(data)


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
    try:
        result = gateway_access_login(
            gateway_command,
            gateway,
            actor.email,
            actor.password,
        )
    except RuntimeError as error:
        raise GateError(str(error)) from error
    actor_ptid = str(result.get("actor_ptid") or "")
    require(
        actor_ptid == actor.actor_ptid,
        f"login {actor.name} PTID mismatch got={actor_ptid} "
        f"want={actor.actor_ptid}",
    )
    session = gateway_status(gateway, "acceptance_current_session")
    actor.account_id = str(session.get("account_id") or "")
    require(
        str(session.get("actor_ptid") or "") == actor.actor_ptid,
        f"login {actor.name} current-session actor mismatch",
    )
    require(
        session.get("messaging_profile_matches") is True,
        f"login {actor.name} messaging profile is not bound",
    )
    require(
        bool(actor.account_id),
        f"login {actor.name} did not return an account ID",
    )
    return actor


def gateway_logout(gateway: str) -> None:
    envelope = gateway_envelope(gateway, "auth_logout")
    if envelope.get("ok"):
        return
    error = envelope.get("error")
    if isinstance(error, dict) and error.get("code") == "UNAUTHORIZED":
        return
    raise GateError(f"gateway command auth_logout failed envelope={envelope}")


def get_federation_context(gateway: str) -> tuple[str, str]:
    data = gateway_command(gateway, "acceptance_federation_context")
    status_raw = data.get("status", "")
    require(isinstance(status_raw, str), "federation context status is required")
    parsed = json.loads(status_raw)
    require(isinstance(parsed, dict), "federation context is invalid")
    federations = parsed.get("federations") or parsed.get("items") or []
    require(len(federations) > 0, "no federation available for friend request")
    federation_id = str(
        federations[0].get("federation_id")
        or federations[0].get("federationId")
        or ""
    )
    station_peer_id = str(parsed.get("active_station_peer_id") or "")
    require(bool(federation_id), "federation ID is required for friend request")
    require(
        bool(station_peer_id),
        "active Station peer ID is required for friend request",
    )
    return federation_id, station_peer_id


def friend_request_context(
    gateway: str,
    target_actor_ptid: str,
) -> dict[str, Any]:
    return gateway_status(
        gateway,
        "acceptance_friend_request_context",
        {"target_actor_ptid": target_actor_ptid},
    )


def wait_for_pending_request(
    gateway: str,
    sender_ptid: str,
    *,
    timeout: float = 10.0,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        context = friend_request_context(gateway, sender_ptid)
        pending = context.get("pending_requests")
        if isinstance(pending, list):
            match = next(
                (
                    request
                    for request in pending
                    if isinstance(request, dict)
                    and request.get("sender_ptid") == sender_ptid
                ),
                None,
            )
            if isinstance(match, dict):
                return match
        time.sleep(0.25)
    raise GateError(
        f"actor B has no pending request from actor A={sender_ptid}"
    )


def wait_for_friendship(
    gateway: str,
    target_actor_ptid: str,
    *,
    timeout: float = 10.0,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    last_relationship: object = None
    while time.monotonic() < deadline:
        context = friend_request_context(gateway, target_actor_ptid)
        last_relationship = context.get("relationship")
        if (
            isinstance(last_relationship, dict)
            and last_relationship.get("target_actor_ptid")
            == target_actor_ptid
            and last_relationship.get("following") is True
            and last_relationship.get("followed_by") is True
        ):
            return last_relationship
        time.sleep(0.25)
    raise GateError(
        "friendship did not converge for target "
        f"{target_actor_ptid}: {last_relationship}"
    )


def run_friend_request_flow(report: EvidenceReport) -> dict[str, Any]:
    gateway_a = gateway_url()
    station = station_url()

    gateway_command(
        gateway_a,
        "station_add",
        {"url": station},
        timeout=10,
    )
    gateway_command(
        gateway_a,
        "station_set_active",
        {"url": station},
        timeout=10,
    )
    report.add_assertion("station_configured", True)

    actor_a = fixture_actor("alice")
    actor_b = fixture_actor("bob")

    gateway_login(gateway_a, actor_a)
    report.add_assertion("actor_a_login_via_gateway", True)

    federation_id, station_peer_id = get_federation_context(gateway_a)
    report.add_assertion("federation_available", True)

    gateway_proto_command(
        gateway_a,
        "social_friend_request_send",
        {
            "receiver_ptid": actor_b.actor_ptid,
            "receiver_home_station_peer_id": station_peer_id,
            "federation_id": federation_id,
            "message": "acceptance gate friend request",
        },
    )
    report.add_assertion("actor_a_sends_friend_request", True)

    gateway_logout(gateway_a)
    gateway_login(gateway_a, actor_b)
    report.add_assertion("actor_b_login_via_gateway", True)

    gateway_proto_command(
        gateway_a,
        "social_friend_request_list",
        {"status": 1, "limit": 200, "offset": 0},
    )
    pending = wait_for_pending_request(
        gateway_a,
        actor_a.actor_ptid,
    )
    report.add_assertion("actor_b_sees_pending_request", True)

    request_id = str(
        pending.get("request_id")
        or pending.get("requestId")
        or pending.get("id")
        or ""
    )
    require(bool(request_id), "pending friend request has no request_id")
    sender_home_station_peer_id = str(
        pending.get("sender_home_station_peer_id")
        or pending.get("senderHomeStationPeerId")
        or ""
    )
    require(
        bool(sender_home_station_peer_id),
        "pending friend request has no sender Home Station",
    )
    request_federation_id = str(
        pending.get("federation_id")
        or pending.get("federationId")
        or federation_id
    )

    gateway_proto_command(
        gateway_a,
        "social_friend_request_accept",
        {
            "request_id": request_id,
            "sender_ptid": actor_a.actor_ptid,
            "sender_home_station_peer_id": sender_home_station_peer_id,
            "federation_id": request_federation_id,
            "message": "",
        },
    )
    report.add_assertion("actor_b_accepts_friend_request", True)

    gateway_logout(gateway_a)
    gateway_login(gateway_a, actor_a)

    gateway_proto_command(
        gateway_a,
        "social_get_relationship",
        {"target_actor_ptid": actor_b.actor_ptid},
    )
    relationship = wait_for_friendship(
        gateway_a,
        actor_b.actor_ptid,
    )
    report.add_assertion("friendship_established", True)

    return {
        "actor_a": actor_a.actor_ptid,
        "actor_b": actor_b.actor_ptid,
        "federation_id": federation_id,
        "request_id": request_id,
        "friendship_confirmed": (
            relationship["following"]
            and relationship["followed_by"]
        ),
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
