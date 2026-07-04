#!/usr/bin/env python3
"""Chat Desktop DOM message visibility acceptance gate.

This gate validates the Desktop renderer can display a real friend-chat
message after authenticating through the acceptance-only Desktop harness and
syncing through the Desktop Rust gateway.

Proof boundary:
  - real Station actor/session/message persistence;
  - real Desktop HTTP gateway commands reached through the Tauri invoke bridge;
  - real Desktop React renderer DOM showing the session and message.

Non-goals:
  - live Tauri realtime event consumption;
  - two running Desktop windows;
  - reconnect or missed-event replay.

Environment:
  CHAT_DESKTOP_DOM_URL              default http://localhost:3210/#/chat
  CHAT_DESKTOP_DOM_OUT_DIR          default /tmp/peers-touch-chat-desktop-dom
  CHAT_DESKTOP_DOM_GATEWAY_URL      default http://127.0.0.1:3030
  CHAT_DESKTOP_DOM_STATION_URL      default http://10.37.94.156:18180
"""

from __future__ import annotations

import importlib.util
import os
import sys
import time
from pathlib import Path
from typing import Any


DEFAULT_URL = "http://localhost:3210/#/chat"
DEFAULT_OUT_DIR = "/tmp/peers-touch-chat-desktop-dom"
DEFAULT_GATEWAY = "http://127.0.0.1:3030"
DEFAULT_STATION = "http://10.37.94.156:18180"


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


def load_desktop_visual_module() -> Any:
    script = Path(__file__).parents[1] / "desktop" / "gateway_smoke.py"
    return load_module(script, "desktop_gateway_smoke")


def load_chat_gateway_module() -> Any:
    script = Path(__file__).parent / "desktop_gateway_e2e.py"
    return load_module(script, "chat_desktop_gateway_e2e")


def install_tauri_app_result_bridge(session: Any, helpers: Any, gateway_url: str) -> None:
    script = f"""
(() => {{
  const gatewayUrl = {helpers.json.dumps(gateway_url)};
  let callbackId = 1;
  const callbacks = {{}};
  const textEncoder = new TextEncoder();

  const writeVarint = (out, value) => {{
    let v = BigInt(value || 0);
    while (v >= 0x80n) {{
      out.push(Number((v & 0x7fn) | 0x80n));
      v >>= 7n;
    }}
    out.push(Number(v));
  }};
  const writeTag = (out, field, wireType) => writeVarint(out, (field << 3) | wireType);
  const writeBytes = (out, field, bytes) => {{
    if (!bytes || bytes.length === 0) return;
    writeTag(out, field, 2);
    writeVarint(out, bytes.length);
    out.push(...bytes);
  }};
  const writeString = (out, field, value) => {{
    const text = value == null ? '' : String(value);
    if (!text) return;
    writeBytes(out, field, Array.from(textEncoder.encode(text)));
  }};
  const writeInt = (out, field, value) => {{
    const number = Number(value || 0);
    if (!number) return;
    writeTag(out, field, 0);
    writeVarint(out, number);
  }};
  const writeBool = (out, field, value) => {{
    if (!value) return;
    writeTag(out, field, 0);
    writeVarint(out, 1);
  }};
  const writeMessage = (out, field, messageBytes) => writeBytes(out, field, messageBytes);
  const bytesFromBase64 = (value) => {{
    if (!value) return [];
    const binary = atob(String(value));
    return Array.from(binary, (ch) => ch.charCodeAt(0));
  }};
  const enumValue = (value, values) => {{
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return values[value] || 0;
    return 0;
  }};
  const friendMessageType = (value) => enumValue(value, {{
    FRIEND_MESSAGE_TYPE_TEXT: 1,
    FRIEND_MESSAGE_TYPE_IMAGE: 2,
    FRIEND_MESSAGE_TYPE_FILE: 3,
    FRIEND_MESSAGE_TYPE_AUDIO: 4,
    FRIEND_MESSAGE_TYPE_VIDEO: 5,
    FRIEND_MESSAGE_TYPE_SENDER_KEY_DISTRIBUTION: 50,
  }});
  const friendMessageStatus = (value) => enumValue(value, {{
    FRIEND_MESSAGE_STATUS_SENDING: 1,
    FRIEND_MESSAGE_STATUS_SENT: 2,
    FRIEND_MESSAGE_STATUS_DELIVERED: 3,
    FRIEND_MESSAGE_STATUS_READ: 4,
    FRIEND_MESSAGE_STATUS_FAILED: 5,
  }});
  const encodeFriendSession = (raw) => {{
    const out = [];
    writeString(out, 1, raw.ulid);
    writeString(out, 2, raw.participant_a_did || raw.participantADid);
    writeString(out, 3, raw.participant_b_did || raw.participantBDid);
    writeString(out, 4, raw.last_message_ulid || raw.lastMessageUlid);
    writeInt(out, 6, raw.unread_count_a ?? raw.unreadCountA);
    writeInt(out, 7, raw.unread_count_b ?? raw.unreadCountB);
    writeString(out, 10, raw.participant_a_display_name || raw.participantADisplayName);
    writeString(out, 11, raw.participant_a_avatar || raw.participantAAvatar);
    writeString(out, 12, raw.participant_b_display_name || raw.participantBDisplayName);
    writeString(out, 13, raw.participant_b_avatar || raw.participantBAvatar);
    return out;
  }};
  const encodeFriendMessage = (raw) => {{
    const out = [];
    writeString(out, 1, raw.ulid);
    writeString(out, 2, raw.session_ulid || raw.sessionUlid);
    writeString(out, 3, raw.sender_did || raw.senderDid);
    writeString(out, 4, raw.receiver_did || raw.receiverDid);
    writeInt(out, 5, friendMessageType(raw.type));
    writeString(out, 6, raw.content);
    writeString(out, 8, raw.reply_to_ulid || raw.replyToUlid);
    writeInt(out, 9, friendMessageStatus(raw.status));
    writeBool(out, 16, raw.recalled);
    writeString(out, 18, raw.thread_root_ulid || raw.threadRootUlid);
    return out;
  }};
  const groupMessageType = (value) => enumValue(value, {{
    GROUP_MESSAGE_TYPE_TEXT: 1,
    GROUP_MESSAGE_TYPE_IMAGE: 2,
    GROUP_MESSAGE_TYPE_FILE: 3,
    GROUP_MESSAGE_TYPE_AUDIO: 4,
    GROUP_MESSAGE_TYPE_VIDEO: 5,
  }});
  const groupRole = (value) => enumValue(value, {{
    GROUP_ROLE_MEMBER: 1,
    GROUP_ROLE_ADMIN: 2,
    GROUP_ROLE_OWNER: 3,
  }});
  const encodeGroup = (raw) => {{
    const out = [];
    writeString(out, 1, raw.ulid);
    writeString(out, 2, raw.name);
    writeString(out, 3, raw.description);
    writeString(out, 4, raw.avatar_cid || raw.avatarCid);
    writeString(out, 5, raw.owner_did || raw.ownerDid);
    writeInt(out, 16, raw.membership_epoch ?? raw.membershipEpoch);
    return out;
  }};
  const encodeGroupMember = (raw) => {{
    const out = [];
    writeString(out, 1, raw.group_ulid || raw.groupUlid);
    writeString(out, 2, raw.actor_did || raw.actorDid);
    writeInt(out, 3, groupRole(raw.role));
    writeString(out, 4, raw.nickname);
    writeBool(out, 5, raw.muted);
    writeString(out, 8, raw.invited_by || raw.invitedBy);
    writeString(out, 9, raw.actor_home_station_peer_id || raw.actorHomeStationPeerId);
    writeString(out, 10, raw.actor_home_station_domain || raw.actorHomeStationDomain);
    return out;
  }};
  const encodeGroupMessage = (raw) => {{
    const out = [];
    writeString(out, 1, raw.ulid);
    writeString(out, 2, raw.group_ulid || raw.groupUlid);
    writeString(out, 3, raw.sender_did || raw.senderDid);
    writeInt(out, 4, groupMessageType(raw.type));
    writeString(out, 5, raw.content);
    writeString(out, 7, raw.reply_to_ulid || raw.replyToUlid);
    for (const item of raw.mentioned_dids || raw.mentionedDids || []) writeString(out, 8, item);
    writeBool(out, 9, raw.mention_all || raw.mentionAll);
    writeBool(out, 13, raw.recalled);
    writeBytes(out, 14, bytesFromBase64(raw.encrypted_payload || raw.encryptedPayload));
    writeString(out, 16, raw.thread_root_ulid || raw.threadRootUlid);
    return out;
  }};
  const encodeChatProtoCommand = (cmd, status) => {{
    const out = [];
    if (cmd === 'friend_chat_list_sessions') {{
      for (const item of status.sessions || []) writeMessage(out, 1, encodeFriendSession(item));
      writeInt(out, 2, status.total);
      return out;
    }}
    if (cmd === 'friend_chat_list_messages') {{
      for (const item of status.messages || []) writeMessage(out, 1, encodeFriendMessage(item));
      writeBool(out, 2, status.has_more || status.hasMore);
      writeString(out, 3, status.next_cursor || status.nextCursor);
      return out;
    }}
    if (cmd === 'group_chat_list_groups') {{
      for (const item of status.groups || []) writeMessage(out, 1, encodeGroup(item));
      writeInt(out, 2, status.total);
      return out;
    }}
    if (cmd === 'group_chat_get_members') {{
      for (const item of status.members || []) writeMessage(out, 1, encodeGroupMember(item));
      writeInt(out, 2, status.total);
      return out;
    }}
    if (cmd === 'group_chat_list_messages') {{
      for (const item of status.messages || []) writeMessage(out, 1, encodeGroupMessage(item));
      writeBool(out, 2, status.has_more || status.hasMore);
      writeString(out, 3, status.next_cursor || status.nextCursor);
      return out;
    }}
    if (cmd === 'group_chat_send_message') {{
      if (status.message) writeMessage(out, 1, encodeGroupMessage(status.message));
      return out;
    }}
    if (cmd === 'group_chat_create_group') {{
      if (status.group) writeMessage(out, 1, encodeGroup(status.group));
      return out;
    }}
    if (cmd === 'friend_chat_ack_messages') return out;
    return null;
  }};

  window.__PT_ERRORS__ = [];
  window.addEventListener('error', (event) => {{
    window.__PT_ERRORS__.push(String(event.error && event.error.stack ? event.error.stack : event.message));
  }});
  window.addEventListener('unhandledrejection', (event) => {{
    const reason = event.reason;
    window.__PT_ERRORS__.push(String(reason && reason.stack ? reason.stack : reason));
  }});

  window.__TAURI_INTERNALS__ = {{
    metadata: {{
      currentWindow: {{ label: 'main' }},
      currentWebview: {{ label: 'main' }},
    }},
    transformCallback(callback, once) {{
      const id = callbackId++;
      callbacks[id] = {{ callback, once: !!once }};
      return id;
    }},
    async invoke(cmd, args) {{
      if (cmd === 'plugin:event|listen') return 0;
      if (cmd === 'plugin:event|unlisten') return null;

      const commandArgs = args && Object.prototype.hasOwnProperty.call(args, 'input')
        ? args.input
        : (args || {{}});
      const response = await fetch(gatewayUrl, {{
        method: 'POST',
        headers: {{ 'Content-Type': 'application/json' }},
        body: JSON.stringify({{ cmd, args: commandArgs || {{}} }}),
      }});
      if (!response.ok) {{
        throw new Error(`gateway http ${{response.status}} for ${{cmd}}`);
      }}
      const envelope = await response.json();
      if (
        (
          cmd === 'friend_chat_list_sessions'
          || cmd === 'friend_chat_list_messages'
          || cmd === 'friend_chat_ack_messages'
          || cmd === 'group_chat_list_groups'
          || cmd === 'group_chat_get_members'
          || cmd === 'group_chat_list_messages'
          || cmd === 'group_chat_send_message'
          || cmd === 'group_chat_create_group'
        )
        && envelope && envelope.ok && envelope.data && typeof envelope.data.status === 'string'
      ) {{
        const status = JSON.parse(envelope.data.status || '{{}}');
        const protoBytes = encodeChatProtoCommand(cmd, status);
        if (protoBytes) return {{ ok: true, data: protoBytes }};
      }}
      return envelope;
    }},
  }};

  window.__TAURI__ = {{ internals: window.__TAURI_INTERNALS__ }};
}})();
"""
    session.send("Page.addScriptToEvaluateOnNewDocument", {"source": script})


def evaluate(session: Any, expression: str) -> Any:
    result = session.send("Runtime.evaluate", {"expression": expression, "returnByValue": True})
    if result.get("exceptionDetails"):
        raise GateError(f"CDP evaluation failed: {result['exceptionDetails']}")
    return result.get("result", {}).get("value")


def evaluate_async(session: Any, expression: str, timeout: float = 30.0) -> Any:
    result = session.send(
        "Runtime.evaluate",
        {
            "expression": expression,
            "returnByValue": True,
            "awaitPromise": True,
            "timeout": int(timeout * 1000),
        },
    )
    if result.get("exceptionDetails"):
        raise GateError(f"CDP async evaluation failed: {result['exceptionDetails']}")
    return result.get("result", {}).get("value")


def wait_for(session: Any, expression: str, description: str, timeout: float = 25.0) -> Any:
    deadline = time.time() + timeout
    last_value: Any = None
    while time.time() < deadline:
        last_value = evaluate(session, expression)
        if last_value:
            return last_value
        time.sleep(0.35)
    debug = evaluate(
        session,
            "JSON.stringify({body:(document.body && document.body.innerText || '').slice(0, 1200), hasAcceptanceHarness:Boolean(window.__PT_ACCEPTANCE__), buttons:Array.from(document.querySelectorAll('button')).map((button)=>button.innerText || button.textContent || ''), inputs:Array.from(document.querySelectorAll('input')).map((input)=>({type:input.type, placeholder:input.placeholder, value:input.type === 'password' ? '*'.repeat(input.value.length) : input.value}))})",
    )
    raise GateError(f"timed out waiting for {description}; last_value={last_value!r}; debug={debug!r}")


def click_button_containing(session: Any, needle: str) -> bool:
    rect = evaluate(
        session,
        f"""
(() => {{
  const button = Array.from(document.querySelectorAll('button')).find((item) =>
    (item.innerText || item.textContent || '').toLowerCase().includes({needle.lower()!r})
  );
  if (!button) return null;
  const rect = button.getBoundingClientRect();
  return {{ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }};
}})()
""",
    )
    if not isinstance(rect, dict):
        return False
    x = float(rect["x"])
    y = float(rect["y"])
    session.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y})
    session.send("Input.dispatchMouseEvent", {"type": "mousePressed", "x": x, "y": y, "button": "left", "clickCount": 1})
    session.send("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1})
    return True


def click_selector(session: Any, selector: str) -> bool:
    rect = evaluate(
        session,
        f"""
(() => {{
  const element = document.querySelector({selector!r});
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return {{ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }};
}})()
""",
    )
    if not isinstance(rect, dict):
        return False
    x = float(rect["x"])
    y = float(rect["y"])
    session.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y})
    session.send("Input.dispatchMouseEvent", {"type": "mousePressed", "x": x, "y": y, "button": "left", "clickCount": 1})
    session.send("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1})
    return True


def login_with_acceptance_harness(session: Any, account: str, password: str, expected_actor_id: str) -> None:
    wait_for(session, "Boolean(window.__PT_ACCEPTANCE__)", "Desktop acceptance harness", timeout=20)
    result = evaluate_async(
        session,
        f"""
(async () => {{
  const result = await window.__PT_ACCEPTANCE__.loginWithPassword({{
    account: {account!r},
    password: {password!r},
  }});
  window.location.hash = '#/chat';
  window.dispatchEvent(new PopStateEvent('popstate'));
  return result;
}})()
""",
        timeout=35,
    )
    if not isinstance(result, dict):
        raise GateError(f"Desktop acceptance harness returned invalid result: {result!r}")
    if result.get("authenticated") is not True:
        raise GateError(f"Desktop acceptance harness did not authenticate: {result!r}")
    actor_id = result.get("actorId")
    if actor_id != expected_actor_id:
        raise GateError(f"Desktop acceptance harness authenticated wrong actor: got={actor_id!r} want={expected_actor_id!r}")


def sync_friend_session_with_acceptance_harness(session: Any, session_id: str) -> None:
    result = evaluate_async(
        session,
        f"""
(async () => {{
  return await window.__PT_ACCEPTANCE__.syncFriendSession({{
    sessionUlid: {session_id!r},
    limit: 50,
    maxPages: 1,
  }});
}})()
""",
        timeout=35,
    )
    if not isinstance(result, dict):
        raise GateError(f"Desktop acceptance harness sync returned invalid result: {result!r}")
    if result.get("sessionUlid") != session_id:
        raise GateError(f"Desktop acceptance harness synced wrong session: {result!r}")
    if int(result.get("messageCount") or 0) < 1:
        raise GateError(f"Desktop acceptance harness sync did not load messages: {result!r}")


def click_chat_session(session: Any, session_id: str) -> None:
    expression = f"""
(() => {{
  const row = document.querySelector(`[data-chat-session-ulid="{session_id}"]`);
  if (!row) return false;
  row.click();
  return true;
}})()
"""
    if evaluate(session, expression) is not True:
        raise GateError(f"Desktop DOM session row not found: {session_id}")


def capture_evidence(helpers: Any, session: Any, out_dir: Path, basename: str) -> tuple[Path, Path]:
    screenshot = session.send("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": True})
    screenshot_path = out_dir / f"{basename}.png"
    screenshot_path.write_bytes(helpers.base64.b64decode(screenshot["data"]))
    text = evaluate(session, "document.body ? document.body.innerText : ''") or ""
    text_path = out_dir / f"{basename}.txt"
    text_path.write_text(text, encoding="utf-8")
    return screenshot_path, text_path


def main() -> int:
    helpers = load_desktop_visual_module().load_dashboard_visual_module()
    desktop_smoke = load_desktop_visual_module()
    chat_gateway = load_chat_gateway_module()
    helpers.load_env_file()

    target_url = os.environ.get("CHAT_DESKTOP_DOM_URL", DEFAULT_URL)
    out_dir = Path(os.environ.get("CHAT_DESKTOP_DOM_OUT_DIR", DEFAULT_OUT_DIR))
    out_dir.mkdir(parents=True, exist_ok=True)
    gateway_url = os.environ.get("CHAT_DESKTOP_DOM_GATEWAY_URL", DEFAULT_GATEWAY).rstrip("/")
    station_url = os.environ.get("CHAT_DESKTOP_DOM_STATION_URL", DEFAULT_STATION).rstrip("/")

    chat_gateway.assert_gateway_station(gateway_url, station_url)
    actor_a = chat_gateway.signup_and_login(station_url, "a")
    actor_b = chat_gateway.signup_and_login(station_url, "b")
    session_id = chat_gateway.create_session(station_url, actor_a, actor_b)
    message_id, content = chat_gateway.send_station_message(station_url, actor_a, actor_b, session_id)

    # Ensure the target gateway starts from a logged-out renderer state. The UI
    # login below must be the path that creates the authenticated session.
    chat_gateway.gateway_logout(gateway_url)

    chrome = helpers.find_chrome()
    port = helpers.random.randint(45001, 52000)
    profile_dir = helpers.tempfile.mkdtemp(prefix="pt-chat-desktop-dom-")
    process = desktop_smoke.launch_desktop_chrome(chrome, port, profile_dir)
    session = None
    try:
        websocket_url = helpers.wait_for_debug_port(port)
        session = helpers.CDPSession(websocket_url)
        session.send("Page.enable")
        session.send("Runtime.enable")
        session.send("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 1000, "deviceScaleFactor": 1, "mobile": False})
        install_tauri_app_result_bridge(session, helpers, gateway_url)
        session.send("Page.navigate", {"url": target_url})
        session.send("Page.bringToFront")

        wait_for(session, "Boolean(document.body)", "Desktop document")
        login_with_acceptance_harness(session, actor_b.email, actor_b.password, actor_b.actor_id)
        sync_friend_session_with_acceptance_harness(session, session_id)

        wait_for(session, "Boolean(document.querySelector('[data-page=\"chat\"]'))", "Desktop chat page")
        wait_for(
            session,
            f"Boolean(document.querySelector('[data-chat-session-ulid=\"{session_id}\"]'))",
            "Desktop chat session row",
            timeout=35,
        )
        click_chat_session(session, session_id)
        wait_for(
            session,
            f"document.body && document.body.innerText.includes({content!r})",
            "Desktop visible chat message",
            timeout=35,
        )
        wait_for(
            session,
            f"Boolean(document.querySelector('[data-message-ulid=\"{message_id}\"]'))",
            "Desktop message DOM node",
            timeout=12,
        )
        screenshot_path, text_path = capture_evidence(helpers, session, out_dir, "chat-desktop-dom-message")

        print("Chat Desktop DOM Message Visibility")
        print("===================================")
        print(f"[OK] chrome: {chrome}")
        print(f"[OK] station: {station_url}")
        print(f"[OK] gateway: {gateway_url}")
        print(f"[OK] session: {session_id}")
        print(f"[OK] message: {message_id}")
        print(f"[OK] screenshot: {screenshot_path}")
        print(f"[OK] evidence: {text_path}")
        return 0
    finally:
        if session:
            session.close()
        process.terminate()
        try:
            process.wait(timeout=5)
        except helpers.subprocess.TimeoutExpired:
            process.kill()
        helpers.shutil.rmtree(profile_dir, ignore_errors=True)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - acceptance gate reports any root cause.
        print(f"chat desktop dom message visibility failed: {error}", file=sys.stderr)
        raise SystemExit(1)
