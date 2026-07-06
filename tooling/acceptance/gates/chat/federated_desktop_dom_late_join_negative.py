#!/usr/bin/env python3
"""Cross-Station Desktop DOM late-join negative gate.

This gate proves a remote actor added after encrypted group history exists does
not become entitled to pre-join Sender-Key ciphertext, while still receiving and
decrypting post-join messages:

1. validate distinct authority/follower Stations, Relay, peer IDs, and gateways;
2. create one authority actor and one follower actor through their home Stations;
3. login both actors through independent Desktop Web gateways;
4. create an authority group without the follower;
5. send a pre-join Sender-Key encrypted group message;
6. add the follower as a federated member with routing metadata;
7. sync follower projection/history and assert pre-join plaintext never renders;
8. send a post-join Sender-Key encrypted group message and prove follower DOM decrypts it.
"""

from __future__ import annotations

import importlib.util
import json
import os
import queue
import sys
import threading
import time
from pathlib import Path
from typing import Any


DEFAULT_OUT_DIR = "/tmp/peers-touch-chat-federated-dom-late-join-negative"


class GateError(RuntimeError):
    pass


def load_module(path: Path, name: str) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise GateError(f"failed to load module: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def load_positive_gate() -> Any:
    return load_module(Path(__file__).parent / "federated_desktop_dom_group_decrypt.py", "chat_federated_desktop_dom_group_decrypt")


def create_authority_group(dom_gate: Any, session: Any, name: str) -> str:
    result = dom_gate.evaluate_async(
        session,
        f"""
(async () => {{
  return await window.__PT_ACCEPTANCE__.createGroup({{
    name: {name!r},
  }});
}})()
""",
        timeout=60,
    )
    if not isinstance(result, dict) or not result.get("groupUlid"):
        raise GateError(f"create group returned invalid result: {result!r}")
    if int(result.get("memberCount") or 0) != 1:
        raise GateError(f"authority-only group should contain only the owner: {result!r}")
    return str(result["groupUlid"])


def add_federated_group_member(
    dom_gate: Any,
    session: Any,
    group_ulid: str,
    member_did: str,
    member_home_peer: str,
    member_home_domain: str,
) -> dict[str, Any]:
    result = dom_gate.evaluate_async(
        session,
        f"""
(async () => {{
  return await window.__PT_ACCEPTANCE__.addFederatedGroupMember({{
    groupUlid: {group_ulid!r},
    member: {{
      actorDid: {member_did!r},
      homeStationPeerId: {member_home_peer!r},
      homeStationDomain: {member_home_domain!r},
    }},
  }});
}})()
""",
        timeout=90,
    )
    if not isinstance(result, dict) or result.get("groupUlid") != group_ulid or result.get("success") is not True:
        raise GateError(f"addFederatedGroupMember returned invalid result: {result!r}")
    if int(result.get("memberCount") or 0) < 2:
        raise GateError(f"addFederatedGroupMember did not project the remote member: {result!r}")
    return result


def body_text(dom_gate: Any, session: Any) -> str:
    body = dom_gate.evaluate(session, "document.body ? document.body.innerText : ''") or ""
    return str(body)


def assert_pre_join_plaintext_absent(
    fed_gate: Any,
    dom_gate: Any,
    session: Any,
    group_ulid: str,
    forbidden_content: str,
    frames: "queue.Queue[tuple[str, str]]",
    timeout_seconds: int,
) -> dict[str, Any]:
    deadline = time.time() + timeout_seconds
    injected_frames = 0
    sync_attempts = 0
    last_sync: dict[str, Any] = {}
    last_body = ""
    seen_group = False
    seen_history = False
    while time.time() < deadline:
        injected_frames += fed_gate.pump_frames(dom_gate, session, frames)
        last_sync = fed_gate.try_sync_group(dom_gate, session, group_ulid)
        sync_attempts += 1
        injected_frames += fed_gate.pump_frames(dom_gate, session, frames)
        if last_sync.get("ok"):
            seen_group = True
            seen_history = seen_history or int(last_sync.get("messageCount") or 0) >= 1
            try:
                fed_gate.click_group(dom_gate, session, group_ulid)
            except Exception:
                pass
        last_body = body_text(dom_gate, session)
        if forbidden_content in last_body:
            raise GateError(
                "late-joined follower decrypted pre-join group message; "
                f"group={group_ulid!r} content={forbidden_content!r} "
                f"injected_frames={injected_frames} last_sync={last_sync!r} body={last_body[:800]!r}"
            )
        if seen_group and seen_history:
            return {
                "injected_frames": injected_frames,
                "sync_attempts": sync_attempts,
                "last_sync": last_sync,
                "body_excerpt": last_body[:800],
            }
        time.sleep(2)
    raise GateError(
        "late-joined follower did not materialize pre-join history window; "
        f"group={group_ulid!r} injected_frames={injected_frames} last_sync={last_sync!r} body={last_body[:800]!r}"
    )


def main() -> int:
    fed_gate = load_positive_gate()
    dom_gate = fed_gate.load_dom_gate()
    prereq = fed_gate.load_prereq_gate()
    helpers = dom_gate.load_desktop_visual_module().load_dashboard_visual_module()
    chat_gateway = dom_gate.load_chat_gateway_module()
    helpers.load_env_file()

    authority_station = prereq.require_url(
        "CHAT_FEDERATION_AUTHORITY_STATION_URL",
        prereq.get_url("CHAT_FEDERATION_AUTHORITY_STATION_URL", "PT_STATION_URL"),
    )
    follower_station = prereq.require_url(
        "CHAT_FEDERATION_FOLLOWER_STATION_URL",
        prereq.get_url("CHAT_FEDERATION_FOLLOWER_STATION_URL"),
    )
    relay = prereq.require_url(
        "CHAT_FEDERATION_RELAY_URL",
        prereq.get_url("CHAT_FEDERATION_RELAY_URL", "PT_RELAY_URL"),
    )
    authority_peer = prereq.discover_station_peer_id("authority Station", authority_station, os.environ.get("CHAT_FEDERATION_AUTHORITY_PEER_ID", ""))
    follower_peer = prereq.discover_station_peer_id("follower Station", follower_station, os.environ.get("CHAT_FEDERATION_FOLLOWER_PEER_ID", ""))
    if authority_station == follower_station or authority_peer == follower_peer:
        raise GateError("authority and follower Stations must be distinct")
    prereq.check_health("authority Station", authority_station, os.environ.get("CHAT_FEDERATION_AUTHORITY_STATION_HEALTH_URL", ""))
    prereq.check_health("follower Station", follower_station, os.environ.get("CHAT_FEDERATION_FOLLOWER_STATION_HEALTH_URL", ""))
    prereq.check_health("Relay", relay, os.environ.get("CHAT_FEDERATION_RELAY_HEALTH_URL", ""))

    authority_gateway = os.environ.get("CHAT_FEDERATION_AUTHORITY_GATEWAY_URL", fed_gate.DEFAULT_AUTHORITY_GATEWAY).rstrip("/")
    follower_gateway = os.environ.get("CHAT_FEDERATION_FOLLOWER_GATEWAY_URL", fed_gate.DEFAULT_FOLLOWER_GATEWAY).rstrip("/")
    authority_web = os.environ.get("CHAT_FEDERATION_AUTHORITY_WEB_URL", fed_gate.DEFAULT_AUTHORITY_WEB)
    follower_web = os.environ.get("CHAT_FEDERATION_FOLLOWER_WEB_URL", fed_gate.DEFAULT_FOLLOWER_WEB)
    out_dir = Path(os.environ.get("CHAT_FEDERATION_DOM_OUT_DIR", DEFAULT_OUT_DIR))
    out_dir.mkdir(parents=True, exist_ok=True)
    negative_window_seconds = fed_gate.positive_int_env("CHAT_FEDERATION_LATE_JOIN_NEGATIVE_WINDOW_SECONDS", 60)

    chat_gateway.assert_gateway_station(authority_gateway, authority_station)
    chat_gateway.assert_gateway_station(follower_gateway, follower_station)
    actor_a = chat_gateway.signup_and_login(authority_station, "flja")
    actor_b = chat_gateway.signup_and_login(follower_station, "fljb")
    chat_gateway.gateway_logout(authority_gateway)
    chat_gateway.gateway_logout(follower_gateway)

    chrome = helpers.find_chrome()
    a_process = b_process = a_session = b_session = None
    a_profile = b_profile = ""
    frames: "queue.Queue[tuple[str, str]]" = queue.Queue()
    sse_ready = threading.Event()
    stop_sse = threading.Event()
    try:
        a_process, a_session, a_profile = fed_gate.launch_renderer(dom_gate, helpers, chrome, authority_web, authority_gateway, "authority-late-join")
        b_process, b_session, b_profile = fed_gate.launch_renderer(dom_gate, helpers, chrome, follower_web, follower_gateway, "follower-late-join")

        dom_gate.login_with_acceptance_harness(b_session, actor_b.email, actor_b.password, actor_b.actor_id)
        follower_device_id = fed_gate.realtime_device(dom_gate, b_session, actor_b.actor_id)
        follower_session_token = fed_gate.gateway_current_session_token(chat_gateway, follower_gateway, actor_b.actor_id)
        sse_thread = threading.Thread(
            target=fed_gate.sse_reader,
            args=(follower_station, follower_session_token, follower_device_id, frames, sse_ready, stop_sse),
            daemon=True,
        )
        sse_thread.start()
        if not sse_ready.wait(timeout=15):
            raise GateError("follower SSE did not become ready before late-join flow")
        fed_gate.pump_frames(dom_gate, b_session, frames)

        dom_gate.login_with_acceptance_harness(a_session, actor_a.email, actor_a.password, actor_a.actor_id)
        group_name = f"federated-late-join-group-{int(time.time() * 1000)}"
        pre_content = f"federated-pre-join-{int(time.time() * 1000)}"
        post_content = f"federated-post-join-{int(time.time() * 1000)}"
        group_ulid = create_authority_group(dom_gate, a_session, group_name)
        dom_gate.wait_for(a_session, f"Boolean(document.querySelector('[data-chat-group-ulid=\"{group_ulid}\"]'))", "authority Desktop group row", timeout=35)

        fed_gate.send_group_message(dom_gate, a_session, group_ulid, pre_content)
        addition = add_federated_group_member(dom_gate, a_session, group_ulid, actor_b.actor_id, follower_peer, follower_station)
        pre_join_negative = assert_pre_join_plaintext_absent(
            fed_gate,
            dom_gate,
            b_session,
            group_ulid,
            pre_content,
            frames,
            negative_window_seconds,
        )
        fed_gate.send_group_message(dom_gate, a_session, group_ulid, post_content)
        post_join_frames = fed_gate.wait_for_follower_decrypt(dom_gate, b_session, group_ulid, post_content, frames)

        screenshot_path, text_path = dom_gate.capture_evidence(helpers, b_session, out_dir, "chat-federated-desktop-dom-late-join-negative")
        report_path = out_dir / "chat-federated-desktop-dom-late-join-negative-report.json"
        report_path.write_text(
            json.dumps(
                {
                    "authority_station": authority_station,
                    "follower_station": follower_station,
                    "relay": relay,
                    "authority_peer_id": authority_peer,
                    "follower_peer_id": follower_peer,
                    "follower_device_id": follower_device_id,
                    "group_ulid": group_ulid,
                    "pre_join_forbidden_content": pre_content,
                    "post_join_content": post_content,
                    "addition": addition,
                    "negative_window_seconds": negative_window_seconds,
                    "pre_join_negative": pre_join_negative,
                    "post_join_injected_frames": post_join_frames,
                    "screenshot": str(screenshot_path),
                    "evidence": str(text_path),
                },
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        print("Chat Federated Desktop DOM Late Join Negative")
        print("============================================")
        print(f"[OK] chrome: {chrome}")
        print(f"[OK] authority_station: {authority_station}")
        print(f"[OK] follower_station: {follower_station}")
        print(f"[OK] relay: {relay}")
        print(f"[OK] authority_peer_id: {authority_peer}")
        print(f"[OK] follower_peer_id: {follower_peer}")
        print(f"[OK] follower_device_id: {follower_device_id}")
        print(f"[OK] group: {group_ulid}")
        print(f"[OK] pre_join_forbidden_content: {pre_content}")
        print(f"[OK] post_join_content: {post_content}")
        print(f"[OK] pre_join_negative_frames: {pre_join_negative['injected_frames']}")
        print(f"[OK] post_join_injected_frames: {post_join_frames}")
        print(f"[OK] screenshot: {screenshot_path}")
        print(f"[OK] evidence: {text_path}")
        print(f"[OK] report: {report_path}")
        return 0
    finally:
        stop_sse.set()
        if a_process:
            fed_gate.close_renderer(helpers, a_process, a_session, a_profile)
        if b_process:
            fed_gate.close_renderer(helpers, b_process, b_session, b_profile)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - gate prints actionable root cause.
        print(f"federated Desktop DOM late-join negative failed: {error}", file=sys.stderr)
        raise SystemExit(1)
