#!/usr/bin/env python3
"""Cross-Station Desktop DOM group pressure acceptance gate.

This gate proves the live browser-facing federated group path under a bounded
family-Station pressure target:

1. validate distinct authority/follower Stations, Relay, peer IDs, and gateways;
2. create one authority actor and one follower actor through real Stations;
3. login both actors through independent Desktop Web gateways;
4. subscribe to follower realtime SSE using the follower Desktop device id;
5. create an authority group with the follower as an initial FederatedActorRef;
6. send N Sender-Key encrypted messages from the authority Desktop runtime;
7. pump live follower realtime frames, sync follower projection/history, and
   decrypt the paged message set in the follower Desktop browser runtime;
8. assert expected count, first/last plaintext samples, and no waiting/decrypt
   placeholders in the decoded pressure window.

This is dev Desktop/browser runtime evidence, not packaged-app evidence.
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


DEFAULT_OUT_DIR = "/tmp/peers-touch-chat-federated-dom-pressure"


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


def send_group_messages(dom_gate: Any, session: Any, group_ulid: str, prefix: str, count: int, start_index: int = 1) -> dict[str, Any]:
    result = dom_gate.evaluate_async(
        session,
        f"""
(async () => {{
  return await window.__PT_ACCEPTANCE__.sendGroupMessages({{
    groupUlid: {group_ulid!r},
    prefix: {prefix!r},
    count: {count},
    startIndex: {start_index},
  }});
}})()
""",
        timeout=max(120, count * 3),
    )
    if not isinstance(result, dict) or result.get("groupUlid") != group_ulid or int(result.get("sentCount") or 0) != count:
        raise GateError(f"sendGroupMessages returned invalid result: {result!r}")
    return result


def send_group_messages_chunked(dom_gate: Any, session: Any, group_ulid: str, prefix: str, count: int) -> dict[str, Any]:
    chunk_size = max(1, int(os.environ.get("CHAT_FEDERATION_PRESSURE_SEND_CHUNK_SIZE", "50")))
    sent = 0
    duration_ms = 0
    first_content = f"{prefix}-0001"
    last_content = f"{prefix}-{str(count).zfill(4)}"
    while sent < count:
        current = min(chunk_size, count - sent)
        start_index = sent + 1
        result = send_group_messages(dom_gate, session, group_ulid, prefix, current, start_index)
        sent += current
        duration_ms += int(result.get("durationMs") or 0)
        print(f"[progress] sent pressure chunk: {sent}/{count}", flush=True)
    return {
        "groupUlid": group_ulid,
        "sentCount": sent,
        "firstContent": first_content,
        "lastContent": last_content,
        "durationMs": duration_ms,
    }


def sync_group_pressure(
    dom_gate: Any,
    session: Any,
    group_ulid: str,
    prefix: str,
    expected_count: int,
    page_limit: int,
    max_pages: int,
    timeout: int,
) -> dict[str, Any]:
    result = dom_gate.evaluate_async(
        session,
        f"""
(async () => {{
  return await window.__PT_ACCEPTANCE__.syncGroupPressure({{
    groupUlid: {group_ulid!r},
    expectedCount: {expected_count},
    prefix: {prefix!r},
    limit: {page_limit},
    maxPages: {max_pages},
  }});
}})()
""",
        timeout=timeout,
    )
    if not isinstance(result, dict) or result.get("groupUlid") != group_ulid:
        raise GateError(f"syncGroupPressure returned invalid result: {result!r}")
    return result


def sync_group_pressure_projection(
    dom_gate: Any,
    session: Any,
    group_ulid: str,
    page_limit: int,
    max_pages: int,
    timeout: int,
) -> dict[str, Any]:
    result = dom_gate.evaluate_async(
        session,
        f"""
(async () => {{
  return await window.__PT_ACCEPTANCE__.syncGroupPressureProjection({{
    groupUlid: {group_ulid!r},
    limit: {page_limit},
    maxPages: {max_pages},
  }});
}})()
""",
        timeout=timeout,
    )
    if not isinstance(result, dict) or result.get("groupUlid") != group_ulid:
        raise GateError(f"syncGroupPressureProjection returned invalid result: {result!r}")
    return result


def sync_group_pressure_page(
    dom_gate: Any,
    session: Any,
    group_ulid: str,
    prefix: str,
    before_ulid: str,
    page_limit: int,
    timeout: int,
) -> dict[str, Any]:
    result = dom_gate.evaluate_async(
        session,
        f"""
(async () => {{
  return await window.__PT_ACCEPTANCE__.syncGroupPressurePage({{
    groupUlid: {group_ulid!r},
    prefix: {prefix!r},
    beforeUlid: {before_ulid!r},
    limit: {page_limit},
  }});
}})()
""",
        timeout=timeout,
    )
    if not isinstance(result, dict) or result.get("groupUlid") != group_ulid:
        raise GateError(f"syncGroupPressurePage returned invalid result: {result!r}")
    return result


def decode_group_pressure(
    dom_gate: Any,
    session: Any,
    group_ulid: str,
    prefix: str,
    expected_count: int,
    chunk_size: int,
    timeout: int,
) -> dict[str, Any]:
    result = dom_gate.evaluate_async(
        session,
        f"""
(async () => {{
  return await window.__PT_ACCEPTANCE__.decodeGroupPressure({{
    groupUlid: {group_ulid!r},
    prefix: {prefix!r},
    expectedCount: {expected_count},
    chunkSize: {chunk_size},
  }});
}})()
""",
        timeout=timeout,
    )
    if not isinstance(result, dict) or result.get("groupUlid") != group_ulid:
        raise GateError(f"decodeGroupPressure returned invalid result: {result!r}")
    return result


def wait_for_pressure_decode(
    fed_gate: Any,
    dom_gate: Any,
    session: Any,
    group_ulid: str,
    prefix: str,
    expected_count: int,
    frames: "queue.Queue[tuple[str, str]]",
    page_limit: int,
    max_pages: int,
    timeout_seconds: int,
) -> tuple[int, dict[str, Any]]:
    deadline = time.time() + timeout_seconds
    injected_frames = 0
    last_result: dict[str, Any] = {}
    page_timeout = max(120, page_limit * 2)
    decode_chunk_size = max(1, int(os.environ.get("CHAT_FEDERATION_PRESSURE_DECODE_CHUNK_SIZE", str(page_limit))))
    decode_timeout = max(120, decode_chunk_size * 2)
    attempts = 0
    while time.time() < deadline:
        attempts += 1
        injected_frames += fed_gate.pump_frames(dom_gate, session, frames)
        projection = sync_group_pressure_projection(
            dom_gate,
            session,
            group_ulid,
            page_limit,
            max_pages,
            max(120, max_pages * 10),
        )
        injected_frames += fed_gate.pump_frames(dom_gate, session, frames)
        before_ulid = ""
        total_messages = 0
        pages_fetched = 0
        for page_index in range(max_pages):
            page = sync_group_pressure_page(
                dom_gate,
                session,
                group_ulid,
                prefix,
                before_ulid,
                page_limit,
                page_timeout,
            )
            pages_fetched += 1
            total_messages += int(page.get("messageCount") or 0)
            before_ulid = str(page.get("nextBeforeUlid") or "")
            injected_frames += fed_gate.pump_frames(dom_gate, session, frames)
            if not page.get("hasMore"):
                break
        decode_result: dict[str, Any] = {}
        while time.time() < deadline:
            decode_result = decode_group_pressure(
                dom_gate,
                session,
                group_ulid,
                prefix,
                expected_count,
                decode_chunk_size,
                decode_timeout,
            )
            injected_frames += fed_gate.pump_frames(dom_gate, session, frames)
            print(
                "[progress] pressure decode chunk "
                f"{int(decode_result.get('decodedWindowCount') or 0)}/{int(decode_result.get('messageCount') or 0)} "
                f"decoded={decode_result.get('decodedCount')} "
                f"waiting={decode_result.get('waitingCount')} "
                f"failed={decode_result.get('failedCount')} "
                f"first={decode_result.get('firstFound')} "
                f"last={decode_result.get('lastFound')}",
                flush=True,
            )
            if decode_result.get("completed") is True:
                break
        last_result = {
            "ok": True,
            "stage": "complete",
            "groupUlid": group_ulid,
            "messageCount": int(decode_result.get("messageCount") or total_messages),
            "decodedCount": int(decode_result.get("decodedCount") or 0),
            "waitingCount": int(decode_result.get("waitingCount") or 0),
            "failedCount": int(decode_result.get("failedCount") or 0),
            "pagesFetched": pages_fetched,
            "syncedCount": projection.get("syncedCount"),
            "firstFound": decode_result.get("firstFound") is True,
            "lastFound": decode_result.get("lastFound") is True,
        }
        print(
            "[progress] pressure sync attempt "
            f"{attempts}: ok={last_result.get('ok')} "
            f"messages={last_result.get('messageCount')} "
            f"decoded={last_result.get('decodedCount')} "
            f"waiting={last_result.get('waitingCount')} "
            f"failed={last_result.get('failedCount')} "
            f"first={last_result.get('firstFound')} "
            f"last={last_result.get('lastFound')} "
            f"frames={injected_frames} "
            f"stage={last_result.get('stage', '')} "
            f"error={last_result.get('error', '')}",
            flush=True,
        )
        if (
            last_result.get("ok") is True
            and
            int(last_result.get("messageCount") or 0) >= expected_count
            and int(last_result.get("decodedCount") or 0) >= expected_count
            and int(last_result.get("waitingCount") or 0) == 0
            and int(last_result.get("failedCount") or 0) == 0
            and last_result.get("firstFound") is True
            and last_result.get("lastFound") is True
        ):
            return injected_frames, last_result
        time.sleep(5)
    raise GateError(
        "follower did not decode pressure message window; "
        f"group={group_ulid!r} prefix={prefix!r} expected={expected_count} "
        f"injected_frames={injected_frames} queued_frames={frames.qsize()} last_result={last_result!r}"
    )


def main() -> int:
    print("[progress] load federated pressure dependencies", flush=True)
    fed_gate = load_positive_gate()
    dom_gate = fed_gate.load_dom_gate()
    prereq = fed_gate.load_prereq_gate()
    helpers = dom_gate.load_desktop_visual_module().load_dashboard_visual_module()
    chat_gateway = dom_gate.load_chat_gateway_module()
    helpers.load_env_file()

    print("[progress] validate live federation endpoints", flush=True)
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
    message_count = fed_gate.positive_int_env("CHAT_FEDERATION_PRESSURE_MESSAGES", 1000)
    page_limit = fed_gate.positive_int_env("CHAT_FEDERATION_PRESSURE_PAGE_LIMIT", 100)
    max_pages = fed_gate.positive_int_env("CHAT_FEDERATION_PRESSURE_MAX_PAGES", max(12, (message_count // page_limit) + 3))
    timeout_seconds = fed_gate.positive_int_env("CHAT_FEDERATION_PRESSURE_TIMEOUT_SECONDS", 1800)

    print("[progress] validate Desktop gateway bindings", flush=True)
    chat_gateway.assert_gateway_station(authority_gateway, authority_station)
    chat_gateway.assert_gateway_station(follower_gateway, follower_station)
    print("[progress] provision pressure actors", flush=True)
    actor_a = chat_gateway.signup_and_login(authority_station, "fpa")
    actor_b = chat_gateway.signup_and_login(follower_station, "fpb")
    chat_gateway.gateway_logout(authority_gateway)
    chat_gateway.gateway_logout(follower_gateway)

    chrome = helpers.find_chrome()
    a_process = b_process = a_session = b_session = None
    a_profile = b_profile = ""
    frames: "queue.Queue[tuple[str, str]]" = queue.Queue()
    sse_ready = threading.Event()
    stop_sse = threading.Event()
    try:
        print("[progress] launch authority/follower Desktop renderers", flush=True)
        a_process, a_session, a_profile = fed_gate.launch_renderer(dom_gate, helpers, chrome, authority_web, authority_gateway, "authority-pressure")
        b_process, b_session, b_profile = fed_gate.launch_renderer(dom_gate, helpers, chrome, follower_web, follower_gateway, "follower-pressure")

        print("[progress] login follower and subscribe SSE", flush=True)
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

        print("[progress] login authority and create federated group", flush=True)
        dom_gate.login_with_acceptance_harness(a_session, actor_a.email, actor_a.password, actor_a.actor_id)
        group_name = f"federated-pressure-group-{int(time.time() * 1000)}"
        prefix = f"federated-pressure-{int(time.time() * 1000)}"
        group_ulid = fed_gate.create_federated_group(dom_gate, a_session, group_name, actor_b.actor_id, follower_peer, follower_station)
        dom_gate.wait_for(a_session, f"Boolean(document.querySelector('[data-chat-group-ulid=\"{group_ulid}\"]'))", "authority Desktop group row", timeout=35)

        warmup_content = f"{prefix}-warmup"
        print(f"[progress] warm up verified decrypt path: {group_ulid}", flush=True)
        fed_gate.send_group_message(dom_gate, a_session, group_ulid, warmup_content)
        warmup_frames = fed_gate.wait_for_follower_decrypt(dom_gate, b_session, group_ulid, warmup_content, frames)
        print(f"[progress] warmup decrypted; frames={warmup_frames}", flush=True)

        started_at = time.time()
        print(f"[progress] send {message_count} encrypted group messages: {group_ulid}", flush=True)
        send_result = send_group_messages_chunked(dom_gate, a_session, group_ulid, prefix, message_count)
        print(f"[progress] sent {send_result['sentCount']} messages in {send_result['durationMs']}ms", flush=True)
        print("[progress] sync/decode follower pressure window", flush=True)
        injected_frames, pressure_result = wait_for_pressure_decode(
            fed_gate,
            dom_gate,
            b_session,
            group_ulid,
            prefix,
            message_count,
            frames,
            page_limit,
            max_pages,
            timeout_seconds,
        )
        print("[progress] verify follower DOM last message", flush=True)
        fed_gate.click_group(dom_gate, b_session, group_ulid)
        dom_gate.wait_for(
            b_session,
            f"document.body && document.body.innerText.includes({send_result['lastContent']!r})",
            "follower Desktop pressure last message",
            timeout=30,
        )
        duration_ms = int((time.time() - started_at) * 1000)

        screenshot_path, text_path = dom_gate.capture_evidence(helpers, b_session, out_dir, "chat-federated-desktop-dom-group-pressure")
        report_path = out_dir / "chat-federated-desktop-dom-group-pressure-report.json"
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
                    "message_count": message_count,
                    "warmup_content": warmup_content,
                    "warmup_frames": warmup_frames,
                    "send": send_result,
                    "pressure": pressure_result,
                    "injected_realtime_frames": injected_frames,
                    "duration_ms": duration_ms,
                    "screenshot": str(screenshot_path),
                    "evidence": str(text_path),
                },
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        print("Chat Federated Desktop DOM Group Pressure")
        print("=========================================")
        print(f"[OK] chrome: {chrome}")
        print(f"[OK] authority_station: {authority_station}")
        print(f"[OK] follower_station: {follower_station}")
        print(f"[OK] relay: {relay}")
        print(f"[OK] authority_peer_id: {authority_peer}")
        print(f"[OK] follower_peer_id: {follower_peer}")
        print(f"[OK] follower_device_id: {follower_device_id}")
        print(f"[OK] group: {group_ulid}")
        print(f"[OK] warmup_content: {warmup_content}")
        print(f"[OK] warmup_frames: {warmup_frames}")
        print(f"[OK] message_count: {message_count}")
        print(f"[OK] sent_count: {send_result['sentCount']}")
        print(f"[OK] decoded_count: {pressure_result['decodedCount']}")
        print(f"[OK] waiting_count: {pressure_result['waitingCount']}")
        print(f"[OK] failed_count: {pressure_result['failedCount']}")
        print(f"[OK] first_found: {pressure_result['firstFound']}")
        print(f"[OK] last_found: {pressure_result['lastFound']}")
        print(f"[OK] injected_realtime_frames: {injected_frames}")
        print(f"[OK] duration_ms: {duration_ms}")
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
        print(f"federated Desktop DOM group pressure failed: {error}", file=sys.stderr)
        raise SystemExit(1)
