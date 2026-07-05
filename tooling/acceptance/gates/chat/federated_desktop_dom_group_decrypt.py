#!/usr/bin/env python3
"""Cross-Station Desktop DOM group decrypt acceptance gate.

This gate proves the live browser-facing federated group path:

1. validate distinct authority/follower Stations, Relay, peer IDs, and gateways;
2. create one actor on the authority Station and one actor on the follower Station;
3. login both actors through independent Desktop Web gateways;
4. subscribe to the follower Station realtime SSE with the follower Desktop device id;
5. create an authority group with the follower as an initial FederatedActorRef;
6. send a Sender-Key-encrypted group message from the authority Desktop;
7. inject the real follower SSE SKDM frame into the follower Desktop event path;
8. sync follower group projection/history and verify decrypted DOM text.

Environment:
  CHAT_FEDERATION_AUTHORITY_STATION_URL default active PT_STATION_URL
  CHAT_FEDERATION_FOLLOWER_STATION_URL  required unless profile provides it
  CHAT_FEDERATION_RELAY_URL             default active PT_RELAY_URL
  CHAT_FEDERATION_AUTHORITY_GATEWAY_URL default http://127.0.0.1:3131
  CHAT_FEDERATION_FOLLOWER_GATEWAY_URL  default http://127.0.0.1:3132
  CHAT_FEDERATION_AUTHORITY_WEB_URL     default http://localhost:3311/#/chat
  CHAT_FEDERATION_FOLLOWER_WEB_URL      default http://localhost:3312/#/chat
  CHAT_FEDERATION_DOM_OUT_DIR           default /tmp/peers-touch-chat-federated-dom-group
"""

from __future__ import annotations

import importlib.util
import os
import queue
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


DEFAULT_AUTHORITY_WEB = "http://localhost:3311/#/chat"
DEFAULT_FOLLOWER_WEB = "http://localhost:3312/#/chat"
DEFAULT_AUTHORITY_GATEWAY = "http://127.0.0.1:3131"
DEFAULT_FOLLOWER_GATEWAY = "http://127.0.0.1:3132"
DEFAULT_OUT_DIR = "/tmp/peers-touch-chat-federated-dom-group"


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
    return load_module(Path(__file__).parent / "desktop_dom_message_visible.py", "chat_desktop_dom_message_visible")


def load_prereq_gate() -> Any:
    return load_module(Path(__file__).parent / "federated_browser_prereq.py", "chat_federated_browser_prereq")


def launch_renderer(dom_gate: Any, helpers: Any, chrome: str, url: str, gateway_url: str, label: str) -> tuple[Any, Any, str]:
    port = helpers.random.randint(45001, 52000)
    profile_dir = helpers.tempfile.mkdtemp(prefix=f"pt-chat-fed-{label}-")
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


def realtime_device(dom_gate: Any, session: Any, expected_actor_id: str) -> str:
    result = dom_gate.evaluate_async(
        session,
        """
(async () => {
  return await window.__PT_ACCEPTANCE__.getRealtimeDevice();
})()
""",
        timeout=20,
    )
    if not isinstance(result, dict):
        raise GateError(f"getRealtimeDevice returned invalid result: {result!r}")
    if result.get("actorId") != expected_actor_id:
        raise GateError(f"Desktop realtime actor mismatch: {result!r}")
    device_id = str(result.get("deviceId") or "").strip()
    if not device_id:
        raise GateError(f"Desktop realtime device id missing: {result!r}")
    return device_id


def gateway_current_session_token(chat_gateway: Any, gateway_url: str, expected_actor_id: str) -> str:
    status = chat_gateway.gateway_status_json(gateway_url, "acceptance_current_session")
    actor_id = str(status.get("actor_id") or "")
    if actor_id != expected_actor_id:
        raise GateError(f"gateway current session actor mismatch: got={actor_id!r} want={expected_actor_id!r}")
    token = str(status.get("token") or "").strip()
    if not token:
        raise GateError("gateway current session token missing")
    return token


def create_federated_group(dom_gate: Any, session: Any, name: str, member_did: str, member_home_peer: str, member_home_domain: str) -> str:
    result = dom_gate.evaluate_async(
        session,
        f"""
(async () => {{
  return await window.__PT_ACCEPTANCE__.createGroup({{
    name: {name!r},
    initialFederatedMembers: [{{
      actorDid: {member_did!r},
      homeStationPeerId: {member_home_peer!r},
      homeStationDomain: {member_home_domain!r},
    }}],
  }});
}})()
""",
        timeout=60,
    )
    if not isinstance(result, dict) or not result.get("groupUlid"):
        raise GateError(f"create federated group returned invalid result: {result!r}")
    if int(result.get("memberCount") or 0) < 2:
        raise GateError(f"create federated group did not project both members: {result!r}")
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
        timeout=90,
    )
    if not isinstance(result, dict) or result.get("groupUlid") != group_ulid:
        raise GateError(f"sendGroupMessage returned invalid result: {result!r}")
    if int(result.get("messageCount") or 0) < 1:
        raise GateError(f"sendGroupMessage did not load sent message: {result!r}")


def try_sync_group(dom_gate: Any, session: Any, group_ulid: str) -> dict[str, Any]:
    result = dom_gate.evaluate_async(
        session,
        f"""
(async () => {{
  try {{
    const result = await window.__PT_ACCEPTANCE__.syncGroup({{
      groupUlid: {group_ulid!r},
      limit: 50,
      maxPages: 2,
    }});
    return {{ ok: true, ...result }};
  }} catch (error) {{
    return {{ ok: false, error: String(error && error.message ? error.message : error) }};
  }}
}})()
""",
        timeout=60,
    )
    if not isinstance(result, dict):
        return {"ok": False, "error": f"invalid sync result: {result!r}"}
    return result


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


def inject_realtime_frame(dom_gate: Any, session: Any, event_id: str, data_b64: str) -> None:
    result = dom_gate.evaluate_async(
        session,
        f"""
(async () => {{
  return await window.__PT_ACCEPTANCE__.dispatchRealtimeFrame({{
    eventId: {event_id!r},
    dataB64: {data_b64!r},
  }});
}})()
""",
        timeout=20,
    )
    if not isinstance(result, dict) or result.get("accepted") is not True:
        raise GateError(f"dispatchRealtimeFrame returned invalid result: {result!r}")


def sse_reader(station_url: str, token: str, device_id: str, frames: "queue.Queue[tuple[str, str]]", stop: threading.Event) -> None:
    req = urllib.request.Request(
        f"{station_url.rstrip('/')}/events/stream",
        headers={
            "Accept": "text/event-stream",
            "Authorization": f"Bearer {token}",
            "X-Device-ID": device_id,
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as response:
            current_id = ""
            current_data: list[str] = []
            while not stop.is_set():
                raw = response.readline()
                if not raw:
                    break
                line = raw.decode("utf-8", errors="replace").rstrip("\r\n")
                if not line:
                    if current_data:
                        frames.put((current_id, "\n".join(current_data)))
                    current_id = ""
                    current_data = []
                    continue
                if line.startswith(":"):
                    continue
                if line.startswith("id:"):
                    current_id = line[3:].strip()
                    continue
                if line.startswith("data:"):
                    current_data.append(line[5:].strip())
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        frames.put(("__error__", f"HTTP {error.code}: {detail[:200]}"))
    except Exception as error:  # noqa: BLE001 - surfaced through gate failure.
        if not stop.is_set():
            frames.put(("__error__", str(error)))


def pump_frames(dom_gate: Any, session: Any, frames: "queue.Queue[tuple[str, str]]") -> int:
    count = 0
    while True:
        try:
            event_id, data_b64 = frames.get_nowait()
        except queue.Empty:
            return count
        if event_id == "__error__":
            raise GateError(f"follower SSE failed: {data_b64}")
        inject_realtime_frame(dom_gate, session, event_id, data_b64)
        count += 1


def wait_for_follower_decrypt(dom_gate: Any, session: Any, group_ulid: str, content: str, frames: "queue.Queue[tuple[str, str]]") -> int:
    deadline = time.time() + 120
    last_sync: dict[str, Any] = {}
    frame_count = 0
    while time.time() < deadline:
        frame_count += pump_frames(dom_gate, session, frames)
        last_sync = try_sync_group(dom_gate, session, group_ulid)
        frame_count += pump_frames(dom_gate, session, frames)
        if last_sync.get("ok") and int(last_sync.get("messageCount") or 0) >= 1:
            dom_gate.wait_for(
                session,
                f"Boolean(document.querySelector('[data-chat-group-ulid=\"{group_ulid}\"]'))",
                "follower Desktop group row",
                timeout=10,
            )
            click_group(dom_gate, session, group_ulid)
            try:
                dom_gate.wait_for(
                    session,
                    f"document.body && document.body.innerText.includes({content!r})",
                    "follower Desktop decrypted federated group message",
                    timeout=8,
                )
                return frame_count
            except Exception:
                body = dom_gate.evaluate(session, "document.body ? document.body.innerText : ''") or ""
                if "[Message sent before you joined]" in body or "[Not entitled to this group message]" in body:
                    raise GateError(f"follower rendered entitlement placeholder instead of decrypting: {body[:500]!r}")
        time.sleep(2)
    raise GateError(f"follower did not decrypt federated group message; last_sync={last_sync!r}")


def main() -> int:
    dom_gate = load_dom_gate()
    prereq = load_prereq_gate()
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

    authority_gateway = os.environ.get("CHAT_FEDERATION_AUTHORITY_GATEWAY_URL", DEFAULT_AUTHORITY_GATEWAY).rstrip("/")
    follower_gateway = os.environ.get("CHAT_FEDERATION_FOLLOWER_GATEWAY_URL", DEFAULT_FOLLOWER_GATEWAY).rstrip("/")
    authority_web = os.environ.get("CHAT_FEDERATION_AUTHORITY_WEB_URL", DEFAULT_AUTHORITY_WEB)
    follower_web = os.environ.get("CHAT_FEDERATION_FOLLOWER_WEB_URL", DEFAULT_FOLLOWER_WEB)
    out_dir = Path(os.environ.get("CHAT_FEDERATION_DOM_OUT_DIR", DEFAULT_OUT_DIR))
    out_dir.mkdir(parents=True, exist_ok=True)

    chat_gateway.assert_gateway_station(authority_gateway, authority_station)
    chat_gateway.assert_gateway_station(follower_gateway, follower_station)
    actor_a = chat_gateway.signup_and_login(authority_station, "fa")
    actor_b = chat_gateway.signup_and_login(follower_station, "fb")
    chat_gateway.gateway_logout(authority_gateway)
    chat_gateway.gateway_logout(follower_gateway)

    chrome = helpers.find_chrome()
    a_process = b_process = a_session = b_session = None
    a_profile = b_profile = ""
    frames: "queue.Queue[tuple[str, str]]" = queue.Queue()
    stop_sse = threading.Event()
    sse_thread: threading.Thread | None = None
    try:
        a_process, a_session, a_profile = launch_renderer(dom_gate, helpers, chrome, authority_web, authority_gateway, "authority")
        b_process, b_session, b_profile = launch_renderer(dom_gate, helpers, chrome, follower_web, follower_gateway, "follower")

        dom_gate.login_with_acceptance_harness(b_session, actor_b.email, actor_b.password, actor_b.actor_id)
        follower_device_id = realtime_device(dom_gate, b_session, actor_b.actor_id)
        follower_session_token = gateway_current_session_token(chat_gateway, follower_gateway, actor_b.actor_id)
        sse_thread = threading.Thread(
            target=sse_reader,
            args=(follower_station, follower_session_token, follower_device_id, frames, stop_sse),
            daemon=True,
        )
        sse_thread.start()

        dom_gate.login_with_acceptance_harness(a_session, actor_a.email, actor_a.password, actor_a.actor_id)
        group_name = f"federated-acceptance-group-{int(time.time() * 1000)}"
        content = f"federated-group-skdm-{int(time.time() * 1000)}"
        group_ulid = create_federated_group(dom_gate, a_session, group_name, actor_b.actor_id, follower_peer, follower_station)
        dom_gate.wait_for(a_session, f"Boolean(document.querySelector('[data-chat-group-ulid=\"{group_ulid}\"]'))", "authority Desktop group row", timeout=35)
        send_group_message(dom_gate, a_session, group_ulid, content)
        injected_frames = wait_for_follower_decrypt(dom_gate, b_session, group_ulid, content, frames)

        screenshot_path, text_path = dom_gate.capture_evidence(helpers, b_session, out_dir, "chat-federated-desktop-dom-group-decrypt")
        print("Chat Federated Desktop DOM Group Decrypt")
        print("========================================")
        print(f"[OK] chrome: {chrome}")
        print(f"[OK] authority_station: {authority_station}")
        print(f"[OK] follower_station: {follower_station}")
        print(f"[OK] relay: {relay}")
        print(f"[OK] authority_peer_id: {authority_peer}")
        print(f"[OK] follower_peer_id: {follower_peer}")
        print(f"[OK] follower_device_id: {follower_device_id}")
        print(f"[OK] group: {group_ulid}")
        print(f"[OK] content: {content}")
        print(f"[OK] injected_realtime_frames: {injected_frames}")
        print(f"[OK] screenshot: {screenshot_path}")
        print(f"[OK] evidence: {text_path}")
        return 0
    finally:
        stop_sse.set()
        if a_process:
            close_renderer(helpers, a_process, a_session, a_profile)
        if b_process:
            close_renderer(helpers, b_process, b_session, b_profile)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - gate prints actionable root cause.
        print(f"federated Desktop DOM group decrypt failed: {error}", file=sys.stderr)
        raise SystemExit(1)
