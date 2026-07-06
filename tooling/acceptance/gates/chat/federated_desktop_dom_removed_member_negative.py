#!/usr/bin/env python3
"""Cross-Station Desktop DOM removed-member negative gate.

This gate proves the live browser-facing federated group path does not keep a
removed remote member entitled to post-remove encrypted messages:

1. validate distinct authority/follower Stations, Relay, peer IDs, and gateways;
2. create one actor on the authority Station and one actor on the follower Station;
3. login both actors through independent Desktop Web gateways;
4. subscribe to the follower Station realtime SSE with the follower Desktop device id;
5. create an authority group with the follower as an initial FederatedActorRef;
6. send and prove a pre-remove Sender-Key encrypted group message decrypts on follower;
7. remove the follower member from the authority Desktop;
8. send a post-remove encrypted group message from the authority Desktop;
9. pump follower realtime frames and projection sync, then assert the post-remove
   plaintext never appears in the follower browser DOM.

This is a live Desktop/browser negative evidence gate. It does not prove remote
late-join negative coverage because the current product contract does not expose
post-create federated invite/join routing metadata through Desktop.
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


DEFAULT_OUT_DIR = "/tmp/peers-touch-chat-federated-dom-removed-negative"


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


def remove_group_member(dom_gate: Any, session: Any, group_ulid: str, member_did: str) -> dict[str, Any]:
    result = dom_gate.evaluate_async(
        session,
        f"""
(async () => {{
  return await window.__PT_ACCEPTANCE__.removeGroupMember({{
    groupUlid: {group_ulid!r},
    memberDid: {member_did!r},
  }});
}})()
""",
        timeout=60,
    )
    if not isinstance(result, dict) or result.get("groupUlid") != group_ulid or result.get("success") is not True:
        raise GateError(f"removeGroupMember returned invalid result: {result!r}")
    return result


def body_text(dom_gate: Any, session: Any) -> str:
    body = dom_gate.evaluate(session, "document.body ? document.body.innerText : ''") or ""
    return str(body)


def assert_removed_member_does_not_decrypt(
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
    observed_not_member = False
    last_body = ""
    while time.time() < deadline:
        injected_frames += fed_gate.pump_frames(dom_gate, session, frames)
        last_sync = fed_gate.try_sync_group(dom_gate, session, group_ulid)
        sync_attempts += 1
        injected_frames += fed_gate.pump_frames(dom_gate, session, frames)
        error_text = str(last_sync.get("error") or "").lower()
        if "not a member" in error_text or "forbidden" in error_text:
            observed_not_member = True
        if last_sync.get("ok"):
            try:
                fed_gate.click_group(dom_gate, session, group_ulid)
            except Exception:
                pass
        last_body = body_text(dom_gate, session)
        if forbidden_content in last_body:
            raise GateError(
                "removed follower decrypted post-remove group message; "
                f"group={group_ulid!r} content={forbidden_content!r} "
                f"injected_frames={injected_frames} last_sync={last_sync!r} body={last_body[:800]!r}"
            )
        time.sleep(2)
    return {
        "injected_frames": injected_frames,
        "sync_attempts": sync_attempts,
        "observed_not_member": observed_not_member,
        "last_sync": last_sync,
        "body_excerpt": last_body[:800],
    }


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
    negative_window_seconds = fed_gate.positive_int_env("CHAT_FEDERATION_NEGATIVE_WINDOW_SECONDS", 45)

    chat_gateway.assert_gateway_station(authority_gateway, authority_station)
    chat_gateway.assert_gateway_station(follower_gateway, follower_station)
    actor_a = chat_gateway.signup_and_login(authority_station, "fna")
    actor_b = chat_gateway.signup_and_login(follower_station, "fnb")
    chat_gateway.gateway_logout(authority_gateway)
    chat_gateway.gateway_logout(follower_gateway)

    chrome = helpers.find_chrome()
    a_process = b_process = a_session = b_session = None
    a_profile = b_profile = ""
    frames: "queue.Queue[tuple[str, str]]" = queue.Queue()
    sse_ready = threading.Event()
    stop_sse = threading.Event()
    try:
        a_process, a_session, a_profile = fed_gate.launch_renderer(dom_gate, helpers, chrome, authority_web, authority_gateway, "authority-negative")
        b_process, b_session, b_profile = fed_gate.launch_renderer(dom_gate, helpers, chrome, follower_web, follower_gateway, "follower-negative")

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
            raise GateError("follower SSE did not become ready before group creation")
        fed_gate.pump_frames(dom_gate, b_session, frames)

        dom_gate.login_with_acceptance_harness(a_session, actor_a.email, actor_a.password, actor_a.actor_id)
        group_name = f"federated-negative-group-{int(time.time() * 1000)}"
        pre_content = f"federated-pre-remove-{int(time.time() * 1000)}"
        post_content = f"federated-post-remove-{int(time.time() * 1000)}"
        group_ulid = fed_gate.create_federated_group(dom_gate, a_session, group_name, actor_b.actor_id, follower_peer, follower_station)
        dom_gate.wait_for(a_session, f"Boolean(document.querySelector('[data-chat-group-ulid=\"{group_ulid}\"]'))", "authority Desktop group row", timeout=35)

        fed_gate.send_group_message(dom_gate, a_session, group_ulid, pre_content)
        pre_frames = fed_gate.wait_for_follower_decrypt(dom_gate, b_session, group_ulid, pre_content, frames)
        removal = remove_group_member(dom_gate, a_session, group_ulid, actor_b.actor_id)
        fed_gate.send_group_message(dom_gate, a_session, group_ulid, post_content)
        negative = assert_removed_member_does_not_decrypt(
            fed_gate,
            dom_gate,
            b_session,
            group_ulid,
            post_content,
            frames,
            negative_window_seconds,
        )

        screenshot_path, text_path = dom_gate.capture_evidence(helpers, b_session, out_dir, "chat-federated-desktop-dom-removed-member-negative")
        report_path = out_dir / "chat-federated-desktop-dom-removed-member-negative-report.json"
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
                    "pre_remove_content": pre_content,
                    "post_remove_forbidden_content": post_content,
                    "pre_remove_injected_frames": pre_frames,
                    "removal": removal,
                    "negative_window_seconds": negative_window_seconds,
                    "negative": negative,
                    "screenshot": str(screenshot_path),
                    "evidence": str(text_path),
                },
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        print("Chat Federated Desktop DOM Removed Member Negative")
        print("==================================================")
        print(f"[OK] chrome: {chrome}")
        print(f"[OK] authority_station: {authority_station}")
        print(f"[OK] follower_station: {follower_station}")
        print(f"[OK] relay: {relay}")
        print(f"[OK] authority_peer_id: {authority_peer}")
        print(f"[OK] follower_peer_id: {follower_peer}")
        print(f"[OK] follower_device_id: {follower_device_id}")
        print(f"[OK] group: {group_ulid}")
        print(f"[OK] pre_remove_content: {pre_content}")
        print(f"[OK] post_remove_forbidden_content: {post_content}")
        print(f"[OK] pre_remove_injected_frames: {pre_frames}")
        print(f"[OK] post_remove_injected_frames: {negative['injected_frames']}")
        print(f"[OK] observed_not_member: {negative['observed_not_member']}")
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
        print(f"federated Desktop DOM removed-member negative failed: {error}", file=sys.stderr)
        raise SystemExit(1)
