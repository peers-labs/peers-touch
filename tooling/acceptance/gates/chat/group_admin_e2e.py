#!/usr/bin/env python3
"""Group admin acceptance gate.

This gate exercises the real Station group-chat admin runtime on a running
Station. It is intentionally below DOM-level Desktop E2E, but above unit tests:
it creates temporary actors and verifies the Station HTTP contract used by
Desktop/Mobile clients.

Environment:
  CHAT_GROUP_ADMIN_STATION_URL  default http://127.0.0.1:18080
  CHAT_GROUP_ADMIN_EXPECTED_BUILD optional build_commit/build_label expected from /app-meta/version
"""

from __future__ import annotations

import base64
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


DEFAULT_STATION_URL = "http://127.0.0.1:18080"

GROUP_ROLE_MEMBER = 1
GROUP_ROLE_ADMIN = 2
GROUP_ROLE_OWNER = 3


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


def station_url() -> str:
    return os.environ.get("CHAT_GROUP_ADMIN_STATION_URL", DEFAULT_STATION_URL).rstrip("/")


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


def expected_build() -> str:
    return os.environ.get("CHAT_GROUP_ADMIN_EXPECTED_BUILD", "").strip()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise GateError(message)


def request(
    method: str,
    base: str,
    path: str,
    payload: dict[str, Any] | None = None,
    token: str | None = None,
    expect_error: bool = False,
) -> dict[str, Any]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Accept": "application/json"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    last_error: urllib.error.URLError | None = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=25) as response:
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
            if attempt == 4:
                break
            time.sleep(0.5 * (attempt + 1))
    raise GateError(f"{method} {base + path} failed before HTTP response error={last_error}") from last_error


def data_or_self(body: dict[str, Any]) -> dict[str, Any]:
    data = body.get("data")
    return data if isinstance(data, dict) else body


def read_station_version(base: str) -> dict[str, Any]:
    try:
        return data_or_self(request("GET", base, "/app-meta/version"))
    except GateError as error:
        raise GateError(f"station version probe failed; deploy current Station or disable remote gate ambiguity: {error}") from error


def assert_expected_build(version: dict[str, Any], expected: str) -> None:
    if not expected:
        return
    build_commit = str(field(version, "build_commit", "buildCommit") or "")
    build_label = str(field(version, "build_label", "buildLabel") or "")
    require(
        expected in {build_commit, build_label},
        f"station build mismatch expected={expected} build_commit={build_commit} build_label={build_label}",
    )


def field(record: dict[str, Any], snake: str, camel: str | None = None) -> Any:
    if snake in record:
        return record.get(snake)
    if camel and camel in record:
        return record.get(camel)
    return None


def role_value(raw: Any) -> int:
    if isinstance(raw, int):
        return raw
    if isinstance(raw, str):
        if raw.isdigit():
            return int(raw)
        return {
            "GROUP_ROLE_MEMBER": GROUP_ROLE_MEMBER,
            "GROUP_ROLE_ADMIN": GROUP_ROLE_ADMIN,
            "GROUP_ROLE_OWNER": GROUP_ROLE_OWNER,
        }.get(raw, 0)
    return 0


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
    name = f"ga{label}{suffix}"[:20]
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


def create_group(base: str, owner: ActorLogin, initial_members: list[ActorLogin]) -> str:
    body = data_or_self(
        request(
            "POST",
            base,
            "/group-chat/create",
            {
                "name": f"group-admin-gate-{int(time.time() * 1000)}",
                "description": "acceptance gate group",
                "type": 1,
                "visibility": 2,
                "initial_member_dids": [member.actor_id for member in initial_members],
            },
            owner.token,
        )
    )
    group = body.get("group") if isinstance(body.get("group"), dict) else {}
    group_id = field(group, "ulid")
    require(bool(group_id), f"group/create response missing group.ulid body={body}")
    require(field(group, "owner_did", "ownerDid") == owner.actor_id, "created group owner mismatch")
    return str(group_id)


def list_members(base: str, actor: ActorLogin, group_id: str) -> list[dict[str, Any]]:
    query = urllib.parse.urlencode({"group_ulid": group_id, "limit": "100", "offset": "0"})
    body = data_or_self(request("GET", base, f"/group-chat/members?{query}", token=actor.token))
    members = body.get("members")
    require(isinstance(members, list), f"members response missing list body={body}")
    return members


def member_by_actor(members: list[dict[str, Any]], actor: ActorLogin) -> dict[str, Any]:
    for member in members:
        if field(member, "actor_did", "actorDid") == actor.actor_id:
            return member
    raise GateError(f"member {actor.label}/{actor.actor_id} not found")


def assert_role(base: str, viewer: ActorLogin, group_id: str, actor: ActorLogin, role: int) -> None:
    member = member_by_actor(list_members(base, viewer, group_id), actor)
    require(role_value(field(member, "role")) == role, f"{actor.label} role mismatch member={member}")


def update_member_role(base: str, actor: ActorLogin, group_id: str, target: ActorLogin, role: int) -> None:
    request(
        "PUT",
        base,
        "/group-chat/member/update",
        {"group_ulid": group_id, "actor_did": target.actor_id, "role": role},
        actor.token,
    )


def update_member_mute(base: str, actor: ActorLogin, group_id: str, target: ActorLogin, muted: bool, expect_error: bool = False) -> None:
    try:
        request(
            "PUT",
            base,
            "/group-chat/member/update",
            {"group_ulid": group_id, "actor_did": target.actor_id, "muted": muted},
            actor.token,
            expect_error=expect_error,
        )
    except ExpectedHttpError as error:
        require(error.status in {403, 404}, f"unexpected mute denial status={error.status}")


def remove_member(base: str, actor: ActorLogin, group_id: str, target: ActorLogin, expect_error: bool = False) -> None:
    try:
        request(
            "POST",
            base,
            "/group-chat/member/remove",
            {"group_ulid": group_id, "actor_did": target.actor_id},
            actor.token,
            expect_error=expect_error,
        )
    except ExpectedHttpError as error:
        require(error.status in {403, 404}, f"unexpected remove denial status={error.status}")


def update_my_nickname(base: str, actor: ActorLogin, group_id: str, nickname: str) -> None:
    body = data_or_self(
        request(
            "PUT",
            base,
            "/group-chat/member/nickname",
            {"group_ulid": group_id, "nickname": nickname},
            actor.token,
        )
    )
    member = body.get("member") if isinstance(body.get("member"), dict) else {}
    require(field(member, "nickname") == nickname, f"nickname response mismatch body={body}")


def transfer_ownership(base: str, actor: ActorLogin, group_id: str, next_owner: ActorLogin, expect_error: bool = False) -> None:
    try:
        request(
            "POST",
            base,
            "/group-chat/ownership/transfer",
            {"group_ulid": group_id, "next_owner_did": next_owner.actor_id},
            actor.token,
            expect_error=expect_error,
        )
    except ExpectedHttpError as error:
        require(error.status in {403, 404}, f"unexpected transfer denial status={error.status}")


def dissolve_group(base: str, actor: ActorLogin, group_id: str, expect_error: bool = False) -> None:
    try:
        request(
            "POST",
            base,
            "/group-chat/dissolve",
            {"group_ulid": group_id},
            actor.token,
            expect_error=expect_error,
        )
    except ExpectedHttpError as error:
        require(error.status in {403, 404}, f"unexpected dissolve denial status={error.status}")


def send_group_message(base: str, actor: ActorLogin, group_id: str, expect_error: bool = False) -> None:
    payload = base64.b64encode(f"group-admin-gate-{time.time()}".encode("utf-8")).decode("ascii")
    try:
        request(
            "POST",
            base,
            "/group-chat/message/send",
            {"group_ulid": group_id, "type": 1, "encrypted_payload": payload},
            actor.token,
            expect_error=expect_error,
        )
    except ExpectedHttpError as error:
        require(error.status in {400, 403, 404}, f"unexpected send denial status={error.status}")


def send_plaintext_group_message(base: str, actor: ActorLogin, group_id: str) -> None:
    try:
        request(
            "POST",
            base,
            "/group-chat/message/send",
            {"group_ulid": group_id, "type": 1, "content": "plaintext must be rejected"},
            actor.token,
            expect_error=True,
        )
    except ExpectedHttpError as error:
        require(error.status == 400, f"unexpected plaintext denial status={error.status}")


def list_messages(base: str, actor: ActorLogin, group_id: str, expect_error: bool = False) -> None:
    query = urllib.parse.urlencode({"group_ulid": group_id, "limit": "20"})
    try:
        request("GET", base, f"/group-chat/messages?{query}", token=actor.token, expect_error=expect_error)
    except ExpectedHttpError as error:
        require(error.status in {403, 404}, f"unexpected list denial status={error.status}")


def main() -> int:
    base = station_url()
    require_disposable_station(base)
    print("Group Admin E2E")
    print("===============")
    print(f"station={base}")
    version = read_station_version(base)
    assert_expected_build(version, expected_build())
    print(
        "[OK] station build: "
        f"commit={field(version, 'build_commit', 'buildCommit')} "
        f"label={field(version, 'build_label', 'buildLabel')} "
        f"time={field(version, 'build_time', 'buildTime')}"
    )

    owner = signup_and_login(base, "owner")
    admin = signup_and_login(base, "admin")
    member = signup_and_login(base, "member")
    observer = signup_and_login(base, "observer")
    print(f"[OK] actors created: owner={owner.actor_id} admin={admin.actor_id} member={member.actor_id} observer={observer.actor_id}")

    group_id = create_group(base, owner, [admin, member, observer])
    print(f"[OK] group created: {group_id}")

    assert_role(base, owner, group_id, owner, GROUP_ROLE_OWNER)
    assert_role(base, owner, group_id, admin, GROUP_ROLE_MEMBER)
    send_plaintext_group_message(base, owner, group_id)
    send_group_message(base, owner, group_id)
    print("[OK] group message encryption contract enforced")

    update_member_role(base, owner, group_id, admin, GROUP_ROLE_ADMIN)
    assert_role(base, owner, group_id, admin, GROUP_ROLE_ADMIN)
    print("[OK] owner promoted admin")

    remove_member(base, admin, group_id, member)
    list_messages(base, member, group_id, expect_error=True)
    send_group_message(base, member, group_id, expect_error=True)
    print("[OK] admin removed ordinary member and removed member cannot read/send")

    update_member_mute(base, admin, group_id, owner, True, expect_error=True)
    remove_member(base, observer, group_id, admin, expect_error=True)
    print("[OK] admin/member forbidden paths rejected")

    update_my_nickname(base, observer, group_id, "Gate Observer")
    observer_member = member_by_actor(list_members(base, owner, group_id), observer)
    require(field(observer_member, "nickname") == "Gate Observer", "nickname did not persist")
    print("[OK] member nickname persisted")

    transfer_ownership(base, owner, group_id, admin)
    assert_role(base, admin, group_id, owner, GROUP_ROLE_ADMIN)
    assert_role(base, admin, group_id, admin, GROUP_ROLE_OWNER)
    dissolve_group(base, owner, group_id, expect_error=True)
    print("[OK] ownership transfer demoted old owner and denied stale dissolve")

    send_group_message(base, admin, group_id)
    dissolve_group(base, admin, group_id)
    send_group_message(base, admin, group_id, expect_error=True)
    list_messages(base, admin, group_id, expect_error=True)
    print("[OK] new owner dissolved group and dissolved group rejects read/send")

    print("PASS")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except GateError as error:
        print(f"FAIL: {error}", file=sys.stderr)
        raise SystemExit(1)
