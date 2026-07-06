#!/usr/bin/env python3
"""Two-Desktop group Sender Key DOM acceptance gate.

This gate validates the browser-facing Desktop group E2EE path on a single
Station:

1. create two temporary actors through Station;
2. login actor A and actor B through two independent Desktop Web gateways;
3. create a friend-chat session so the transitional SKDM carrier can be synced;
4. create a group with actor B as member from Desktop A;
5. send a group message from Desktop A, which distributes Sender Key material;
6. sync the friend SKDM carrier and group history from Desktop B;
7. verify Desktop B renders the decrypted group message in the browser DOM.

It intentionally does not prove multi-Station federation relay. Use it as a
same-home-Station browser acceptance layer below the cross-Station SKDM tests.

Environment:
  CHAT_DESKTOP_DOM_A_URL          default http://localhost:3311/#/chat
  CHAT_DESKTOP_DOM_B_URL          default http://localhost:3312/#/chat
  CHAT_DESKTOP_DOM_A_GATEWAY_URL  default http://127.0.0.1:3131
  CHAT_DESKTOP_DOM_B_GATEWAY_URL  default http://127.0.0.1:3132
  CHAT_DESKTOP_DOM_STATION_URL    default http://10.37.94.156:18180
  CHAT_DESKTOP_DOM_OUT_DIR        default /tmp/peers-touch-chat-desktop-dom-group
"""

from __future__ import annotations

import importlib.util
import os
import sys
import time
from pathlib import Path
from typing import Any


DEFAULT_A_URL = "http://localhost:3311/#/chat"
DEFAULT_B_URL = "http://localhost:3312/#/chat"
DEFAULT_A_GATEWAY = "http://127.0.0.1:3131"
DEFAULT_B_GATEWAY = "http://127.0.0.1:3132"
DEFAULT_STATION = "http://10.37.94.156:18180"
DEFAULT_OUT_DIR = "/tmp/peers-touch-chat-desktop-dom-group"


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


def load_dom_gate() -> Any:
    script = Path(__file__).parent / "desktop_dom_message_visible.py"
    return load_module(script, "chat_desktop_dom_message_visible")


def launch_renderer(dom_gate: Any, helpers: Any, chrome: str, url: str, gateway_url: str, label: str) -> tuple[Any, Any, str]:
    port = helpers.random.randint(45001, 52000)
    profile_dir = helpers.tempfile.mkdtemp(prefix=f"pt-chat-group-{label}-")
    process = dom_gate.load_desktop_visual_module().launch_desktop_chrome(chrome, port, profile_dir)
    websocket_url = helpers.wait_for_debug_port(port)
    session = helpers.CDPSession(websocket_url)
    session.send("Page.enable")
    session.send("Runtime.enable")
    session.send("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 1000, "deviceScaleFactor": 1, "mobile": False})
    dom_gate.install_tauri_app_result_bridge(session, helpers, gateway_url)
    session.send("Page.navigate", {"url": url})
    session.send("Page.bringToFront")
    dom_gate.wait_for(session, "Boolean(document.body)", f"Desktop document {label}")
    return process, session, profile_dir


def close_renderer(helpers: Any, process: Any, session: Any, profile_dir: str) -> None:
    if session:
        session.close()
    process.terminate()
    try:
        process.wait(timeout=5)
    except helpers.subprocess.TimeoutExpired:
        process.kill()
    helpers.shutil.rmtree(profile_dir, ignore_errors=True)


def create_group(dom_gate: Any, session: Any, name: str, member_did: str) -> str:
    result = dom_gate.evaluate_async(
        session,
        f"""
(async () => {{
  return await window.__PT_ACCEPTANCE__.createGroup({{
    name: {name!r},
    memberDids: [{member_did!r}],
  }});
}})()
""",
        timeout=45,
    )
    if not isinstance(result, dict) or not result.get("groupUlid"):
        raise GateError(f"createGroup returned invalid result: {result!r}")
    if int(result.get("memberCount") or 0) < 2:
        raise GateError(f"createGroup did not project both members: {result!r}")
    return str(result["groupUlid"])


def send_group_message(dom_gate: Any, session: Any, group_ulid: str, content: str) -> None:
    result = dom_gate.evaluate_async(
        session,
        f"""
(async () => {{
  return await window.__PT_ACCEPTANCE__.sendGroupMessage({{
    groupUlid: {group_ulid!r},
    content: {content!r},
  }});
}})()
""",
        timeout=60,
    )
    if not isinstance(result, dict) or result.get("groupUlid") != group_ulid:
        raise GateError(f"sendGroupMessage returned invalid result: {result!r}")
    if int(result.get("messageCount") or 0) < 1:
        raise GateError(f"sendGroupMessage did not load sent message: {result!r}")


def sync_group(dom_gate: Any, session: Any, group_ulid: str) -> None:
    result = dom_gate.evaluate_async(
        session,
        f"""
(async () => {{
  return await window.__PT_ACCEPTANCE__.syncGroup({{
    groupUlid: {group_ulid!r},
    limit: 50,
    maxPages: 1,
  }});
}})()
""",
        timeout=60,
    )
    if not isinstance(result, dict) or result.get("groupUlid") != group_ulid:
        raise GateError(f"syncGroup returned invalid result: {result!r}")
    if int(result.get("messageCount") or 0) < 1:
        raise GateError(f"syncGroup did not load group messages: {result!r}")


def sync_sender_key_carrier(dom_gate: Any, session: Any, friend_session_id: str) -> None:
    result = dom_gate.evaluate_async(
        session,
        f"""
(async () => {{
  return await window.__PT_ACCEPTANCE__.syncFriendSession({{
    sessionUlid: {friend_session_id!r},
    limit: 50,
    maxPages: 1,
  }});
}})()
""",
        timeout=45,
    )
    if not isinstance(result, dict) or result.get("sessionUlid") != friend_session_id:
        raise GateError(f"syncFriendSession returned invalid result for SKDM carrier: {result!r}")
    # SKDM control rows are intentionally hidden from the visible friend timeline.
    # The important signal here is that Station replay returned the carrier and
    # Desktop processed it before group history decrypt.
    if int(result.get("syncedCount") or 0) < 1:
        raise GateError(f"syncFriendSession did not fetch SKDM carrier: {result!r}")


def click_group(dom_gate: Any, session: Any, group_ulid: str) -> None:
    ok = dom_gate.evaluate(
        session,
        f"""
(() => {{
  const row = document.querySelector(`[data-chat-group-ulid="{group_ulid}"]`);
  if (!row) return false;
  row.click();
  return true;
}})()
""",
    )
    if ok is not True:
        raise GateError(f"Desktop DOM group row not found: {group_ulid}")


def main() -> int:
    dom_gate = load_dom_gate()
    helpers = dom_gate.load_desktop_visual_module().load_dashboard_visual_module()
    chat_gateway = dom_gate.load_chat_gateway_module()
    helpers.load_env_file()

    station_url = os.environ.get("CHAT_DESKTOP_DOM_STATION_URL", DEFAULT_STATION).rstrip("/")
    a_url = os.environ.get("CHAT_DESKTOP_DOM_A_URL", DEFAULT_A_URL)
    b_url = os.environ.get("CHAT_DESKTOP_DOM_B_URL", DEFAULT_B_URL)
    a_gateway = os.environ.get("CHAT_DESKTOP_DOM_A_GATEWAY_URL", DEFAULT_A_GATEWAY).rstrip("/")
    b_gateway = os.environ.get("CHAT_DESKTOP_DOM_B_GATEWAY_URL", DEFAULT_B_GATEWAY).rstrip("/")
    out_dir = Path(os.environ.get("CHAT_DESKTOP_DOM_OUT_DIR", DEFAULT_OUT_DIR))
    out_dir.mkdir(parents=True, exist_ok=True)

    chat_gateway.assert_gateway_station(a_gateway, station_url)
    chat_gateway.assert_gateway_station(b_gateway, station_url)
    actor_a = chat_gateway.signup_and_login(station_url, "ga")
    actor_b = chat_gateway.signup_and_login(station_url, "gb")
    friend_session_id = chat_gateway.create_session(station_url, actor_a, actor_b)

    chat_gateway.gateway_logout(a_gateway)
    chat_gateway.gateway_logout(b_gateway)

    chrome = helpers.find_chrome()
    a_process = b_process = a_session = b_session = None
    a_profile = b_profile = ""
    try:
        a_process, a_session, a_profile = launch_renderer(dom_gate, helpers, chrome, a_url, a_gateway, "a")
        b_process, b_session, b_profile = launch_renderer(dom_gate, helpers, chrome, b_url, b_gateway, "b")

        dom_gate.login_with_acceptance_harness(a_session, actor_a.email, actor_a.password, actor_a.actor_id)
        dom_gate.login_with_acceptance_harness(b_session, actor_b.email, actor_b.password, actor_b.actor_id)

        group_name = f"acceptance-group-{int(time.time() * 1000)}"
        content = f"acceptance-group-skdm-{int(time.time() * 1000)}"
        group_ulid = create_group(dom_gate, a_session, group_name, actor_b.actor_id)
        dom_gate.wait_for(a_session, f"Boolean(document.querySelector('[data-chat-group-ulid=\"{group_ulid}\"]'))", "Desktop A group row", timeout=35)
        send_group_message(dom_gate, a_session, group_ulid, content)

        # The current Foundation path still dual-writes SKDM via friend-chat type=50.
        # Syncing the friend session lets Desktop B install the Sender Key before it
        # decrypts the group message.
        sync_sender_key_carrier(dom_gate, b_session, friend_session_id)
        sync_group(dom_gate, b_session, group_ulid)
        dom_gate.wait_for(b_session, f"Boolean(document.querySelector('[data-chat-group-ulid=\"{group_ulid}\"]'))", "Desktop B group row", timeout=35)
        click_group(dom_gate, b_session, group_ulid)
        dom_gate.wait_for(
            b_session,
            f"document.body && document.body.innerText.includes({content!r})",
            "Desktop B visible decrypted group message",
            timeout=45,
        )

        screenshot_path, text_path = dom_gate.capture_evidence(helpers, b_session, out_dir, "chat-desktop-dom-group-sender-key")
        print("Chat Desktop DOM Group Sender Key Visibility")
        print("============================================")
        print(f"[OK] chrome: {chrome}")
        print(f"[OK] station: {station_url}")
        print(f"[OK] gateway_a: {a_gateway}")
        print(f"[OK] gateway_b: {b_gateway}")
        print(f"[OK] friend_session: {friend_session_id}")
        print(f"[OK] group: {group_ulid}")
        print(f"[OK] content: {content}")
        print(f"[OK] screenshot: {screenshot_path}")
        print(f"[OK] evidence: {text_path}")
        return 0
    finally:
        if a_process:
            close_renderer(helpers, a_process, a_session, a_profile)
        if b_process:
            close_renderer(helpers, b_process, b_session, b_profile)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - acceptance gate reports any root cause.
        print(f"chat desktop dom group sender key visibility failed: {error}", file=sys.stderr)
        raise SystemExit(1)
