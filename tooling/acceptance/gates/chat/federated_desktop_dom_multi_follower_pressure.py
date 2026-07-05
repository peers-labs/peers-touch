#!/usr/bin/env python3
"""Cross-Station Desktop DOM multi-follower group pressure acceptance gate.

This gate proves a bounded live browser-facing federated group path with more
than one follower Desktop runtime:

1. validate distinct authority/follower Stations, Relay, peer IDs, and gateways;
2. create one authority actor and N follower actors on the follower Station;
3. login each actor through an independent Desktop Web gateway/runtime;
4. subscribe one realtime SSE stream per follower Desktop device id;
5. create one authority group with all follower actors as FederatedActorRefs;
6. warm up and verify each follower can decrypt the same Sender-Key message;
7. send M Sender-Key encrypted messages from the authority Desktop runtime;
8. sync/decode the paged pressure window in every follower browser runtime;
9. assert every follower sees the expected first/last plaintext samples with no
   waiting/decrypt placeholders in the decoded pressure window.

This is dev Desktop/browser runtime evidence, not packaged-app evidence. The
default shape is intentionally bounded so it can run against the home profile:
one authority Station, one follower Station, two follower Desktop runtimes, and
100 encrypted messages. Increase CHAT_FEDERATION_MULTI_FOLLOWER_MESSAGES or
CHAT_FEDERATION_MULTI_FOLLOWER_COUNT for heavier local evidence.

Each Desktop runtime must use an independent gateway/profile and an isolated
PEERS_STORAGE_ROOT. PT_PROFILE alone does not isolate the platform storage root
on macOS, and shared auth storage can invalidate another follower runtime.
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


DEFAULT_AUTHORITY_WEB = "http://localhost:3311/#/chat"
DEFAULT_AUTHORITY_GATEWAY = "http://127.0.0.1:3131"
DEFAULT_FOLLOWER_WEBS = "http://localhost:3312/#/chat,http://localhost:3313/#/chat"
DEFAULT_FOLLOWER_GATEWAYS = "http://127.0.0.1:3132,http://127.0.0.1:3133"
DEFAULT_OUT_DIR = "/tmp/peers-touch-chat-federated-dom-multi-follower-pressure"


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


def load_pressure_gate() -> Any:
    return load_module(
        Path(__file__).parent / "federated_desktop_dom_group_pressure.py",
        "chat_federated_desktop_dom_group_pressure",
    )


def positive_int_env(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as error:
        raise GateError(f"{name} must be a positive integer, got {raw!r}") from error
    if value < 1:
        raise GateError(f"{name} must be >= 1, got {value}")
    return value


def csv_env(name: str, default: str) -> list[str]:
    values = [item.strip() for item in os.environ.get(name, default).split(",")]
    values = [item for item in values if item]
    if not values:
        raise GateError(f"{name} must contain at least one URL")
    return values


def create_multi_federated_group(dom_gate: Any, session: Any, name: str, members: list[dict[str, str]]) -> str:
    members_json = json.dumps(members, ensure_ascii=False)
    result = dom_gate.evaluate_async(
        session,
        f"""
(async () => {{
  return await window.__PT_ACCEPTANCE__.createGroup({{
    name: {name!r},
    initialFederatedMembers: {members_json},
  }});
}})()
""",
        timeout=90,
    )
    if not isinstance(result, dict) or not result.get("groupUlid"):
        raise GateError(f"create multi-follower federated group returned invalid result: {result!r}")
    expected_members = len(members) + 1
    if int(result.get("memberCount") or 0) < expected_members:
        raise GateError(
            "create multi-follower federated group did not project all members: "
            f"expected>={expected_members} result={result!r}"
        )
    return str(result["groupUlid"])


def main() -> int:
    print("[progress] load federated multi-follower pressure dependencies", flush=True)
    pressure_gate = load_pressure_gate()
    fed_gate = pressure_gate.load_positive_gate()
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
    authority_peer = prereq.discover_station_peer_id(
        "authority Station",
        authority_station,
        os.environ.get("CHAT_FEDERATION_AUTHORITY_PEER_ID", ""),
    )
    follower_peer = prereq.discover_station_peer_id(
        "follower Station",
        follower_station,
        os.environ.get("CHAT_FEDERATION_FOLLOWER_PEER_ID", ""),
    )
    if authority_station == follower_station or authority_peer == follower_peer:
        raise GateError("authority and follower Stations must be distinct")
    prereq.check_health("authority Station", authority_station, os.environ.get("CHAT_FEDERATION_AUTHORITY_STATION_HEALTH_URL", ""))
    prereq.check_health("follower Station", follower_station, os.environ.get("CHAT_FEDERATION_FOLLOWER_STATION_HEALTH_URL", ""))
    prereq.check_health("Relay", relay, os.environ.get("CHAT_FEDERATION_RELAY_HEALTH_URL", ""))

    follower_count = positive_int_env("CHAT_FEDERATION_MULTI_FOLLOWER_COUNT", 2)
    message_count = positive_int_env("CHAT_FEDERATION_MULTI_FOLLOWER_MESSAGES", 100)
    page_limit = positive_int_env("CHAT_FEDERATION_MULTI_FOLLOWER_PAGE_LIMIT", 100)
    max_pages = positive_int_env("CHAT_FEDERATION_MULTI_FOLLOWER_MAX_PAGES", max(4, (message_count // page_limit) + 3))
    timeout_seconds = positive_int_env("CHAT_FEDERATION_MULTI_FOLLOWER_TIMEOUT_SECONDS", 1200)
    authority_gateway = os.environ.get("CHAT_FEDERATION_AUTHORITY_GATEWAY_URL", DEFAULT_AUTHORITY_GATEWAY).rstrip("/")
    authority_web = os.environ.get("CHAT_FEDERATION_AUTHORITY_WEB_URL", DEFAULT_AUTHORITY_WEB)
    follower_gateways = [value.rstrip("/") for value in csv_env("CHAT_FEDERATION_FOLLOWER_GATEWAY_URLS", DEFAULT_FOLLOWER_GATEWAYS)]
    follower_webs = csv_env("CHAT_FEDERATION_FOLLOWER_WEB_URLS", DEFAULT_FOLLOWER_WEBS)
    if len(follower_gateways) < follower_count:
        raise GateError(f"need {follower_count} follower gateways, got {len(follower_gateways)}")
    if len(follower_webs) < follower_count:
        raise GateError(f"need {follower_count} follower web URLs, got {len(follower_webs)}")
    follower_gateways = follower_gateways[:follower_count]
    follower_webs = follower_webs[:follower_count]
    if len(set([authority_gateway, *follower_gateways])) != follower_count + 1:
        raise GateError("authority and follower gateways must be distinct")
    out_dir = Path(os.environ.get("CHAT_FEDERATION_DOM_OUT_DIR", DEFAULT_OUT_DIR))
    out_dir.mkdir(parents=True, exist_ok=True)

    print("[progress] validate Desktop gateway bindings", flush=True)
    chat_gateway.assert_gateway_station(authority_gateway, authority_station)
    for index, gateway in enumerate(follower_gateways, start=1):
        chat_gateway.assert_gateway_station(gateway, follower_station)
        print(f"[progress] follower gateway {index}/{follower_count}: {gateway}", flush=True)

    print("[progress] provision authority and follower actors", flush=True)
    actor_a = chat_gateway.signup_and_login(authority_station, "fmfa")
    chat_gateway.gateway_logout(authority_gateway)
    follower_actors = []
    for index, gateway in enumerate(follower_gateways, start=1):
        actor = chat_gateway.signup_and_login(follower_station, f"fmfb{index}")
        chat_gateway.gateway_logout(gateway)
        follower_actors.append(actor)

    chrome = helpers.find_chrome()
    authority_process = authority_session = None
    authority_profile = ""
    followers: list[dict[str, Any]] = []
    started_at = time.time()
    try:
        print("[progress] launch authority Desktop renderer", flush=True)
        authority_process, authority_session, authority_profile = fed_gate.launch_renderer(
            dom_gate,
            helpers,
            chrome,
            authority_web,
            authority_gateway,
            "authority-multi-follower-pressure",
        )
        print("[progress] launch follower Desktop renderers and subscribe SSE", flush=True)
        for index, actor in enumerate(follower_actors, start=1):
            process, session, profile = fed_gate.launch_renderer(
                dom_gate,
                helpers,
                chrome,
                follower_webs[index - 1],
                follower_gateways[index - 1],
                f"follower-{index}-multi-follower-pressure",
            )
            dom_gate.login_with_acceptance_harness(session, actor.email, actor.password, actor.actor_id)
            device_id = fed_gate.realtime_device(dom_gate, session, actor.actor_id)
            session_token = fed_gate.gateway_current_session_token(chat_gateway, follower_gateways[index - 1], actor.actor_id)
            frames: "queue.Queue[tuple[str, str]]" = queue.Queue()
            ready = threading.Event()
            stop = threading.Event()
            thread = threading.Thread(
                target=fed_gate.sse_reader,
                args=(follower_station, session_token, device_id, frames, ready, stop),
                daemon=True,
            )
            thread.start()
            if not ready.wait(timeout=15):
                raise GateError(f"follower {index} SSE did not become ready before group creation")
            fed_gate.pump_frames(dom_gate, session, frames)
            followers.append(
                {
                    "index": index,
                    "actor": actor,
                    "gateway": follower_gateways[index - 1],
                    "web": follower_webs[index - 1],
                    "process": process,
                    "session": session,
                    "profile": profile,
                    "device_id": device_id,
                    "frames": frames,
                    "stop": stop,
                    "thread": thread,
                    "injected_frames": 0,
                }
            )

        print("[progress] login authority and create multi-follower federated group", flush=True)
        dom_gate.login_with_acceptance_harness(authority_session, actor_a.email, actor_a.password, actor_a.actor_id)
        members = [
            {
                "actorDid": str(follower["actor"].actor_id),
                "homeStationPeerId": follower_peer,
                "homeStationDomain": follower_station,
            }
            for follower in followers
        ]
        group_name = f"federated-multi-follower-pressure-{int(time.time() * 1000)}"
        prefix = f"federated-multi-follower-{int(time.time() * 1000)}"
        group_ulid = create_multi_federated_group(dom_gate, authority_session, group_name, members)
        dom_gate.wait_for(
            authority_session,
            f"Boolean(document.querySelector('[data-chat-group-ulid=\"{group_ulid}\"]'))",
            "authority Desktop group row",
            timeout=35,
        )

        warmup_content = f"{prefix}-warmup"
        print(f"[progress] warm up all follower decrypt paths: {group_ulid}", flush=True)
        fed_gate.send_group_message(dom_gate, authority_session, group_ulid, warmup_content)
        for follower in followers:
            before_frames = int(follower["injected_frames"])
            follower["injected_frames"] = before_frames + fed_gate.wait_for_follower_decrypt(
                dom_gate,
                follower["session"],
                group_ulid,
                warmup_content,
                follower["frames"],
            )
            follower["warmup_frames"] = int(follower["injected_frames"]) - before_frames
            print(
                f"[progress] follower {follower['index']}/{follower_count} warmup decrypted; "
                f"frames={follower['warmup_frames']}",
                flush=True,
            )

        print(f"[progress] send {message_count} encrypted group messages: {group_ulid}", flush=True)
        send_result = pressure_gate.send_group_messages_chunked(dom_gate, authority_session, group_ulid, prefix, message_count)
        print(f"[progress] sent {send_result['sentCount']} messages in {send_result['durationMs']}ms", flush=True)

        follower_reports: list[dict[str, Any]] = []
        for follower in followers:
            print(f"[progress] sync/decode follower {follower['index']}/{follower_count} pressure window", flush=True)
            injected_frames, pressure_result = pressure_gate.wait_for_pressure_decode(
                fed_gate,
                dom_gate,
                follower["session"],
                group_ulid,
                prefix,
                message_count,
                follower["frames"],
                page_limit,
                max_pages,
                timeout_seconds,
            )
            follower["injected_frames"] = int(follower["injected_frames"]) + injected_frames
            print(f"[progress] verify follower {follower['index']} DOM last message", flush=True)
            fed_gate.click_group(dom_gate, follower["session"], group_ulid)
            dom_gate.wait_for(
                follower["session"],
                f"document.body && document.body.innerText.includes({send_result['lastContent']!r})",
                f"follower {follower['index']} Desktop pressure last message",
                timeout=30,
            )
            screenshot_path, text_path = dom_gate.capture_evidence(
                helpers,
                follower["session"],
                out_dir,
                f"chat-federated-desktop-dom-multi-follower-pressure-follower-{follower['index']}",
            )
            follower_reports.append(
                {
                    "index": follower["index"],
                    "actor_id": follower["actor"].actor_id,
                    "gateway": follower["gateway"],
                    "web": follower["web"],
                    "device_id": follower["device_id"],
                    "warmup_frames": follower.get("warmup_frames", 0),
                    "pressure": pressure_result,
                    "injected_realtime_frames": follower["injected_frames"],
                    "screenshot": str(screenshot_path),
                    "evidence": str(text_path),
                }
            )

        duration_ms = int((time.time() - started_at) * 1000)
        report_path = out_dir / "chat-federated-desktop-dom-multi-follower-pressure-report.json"
        report_path.write_text(
            json.dumps(
                {
                    "authority_station": authority_station,
                    "follower_station": follower_station,
                    "relay": relay,
                    "authority_peer_id": authority_peer,
                    "follower_peer_id": follower_peer,
                    "authority_gateway": authority_gateway,
                    "authority_web": authority_web,
                    "group_ulid": group_ulid,
                    "follower_count": follower_count,
                    "message_count": message_count,
                    "warmup_content": warmup_content,
                    "send": send_result,
                    "followers": follower_reports,
                    "duration_ms": duration_ms,
                },
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        print("Chat Federated Desktop DOM Multi-Follower Pressure")
        print("==================================================")
        print(f"[OK] chrome: {chrome}")
        print(f"[OK] authority_station: {authority_station}")
        print(f"[OK] follower_station: {follower_station}")
        print(f"[OK] relay: {relay}")
        print(f"[OK] authority_peer_id: {authority_peer}")
        print(f"[OK] follower_peer_id: {follower_peer}")
        print(f"[OK] group: {group_ulid}")
        print(f"[OK] follower_count: {follower_count}")
        print(f"[OK] message_count: {message_count}")
        print(f"[OK] sent_count: {send_result['sentCount']}")
        for follower in follower_reports:
            pressure = follower["pressure"]
            print(
                f"[OK] follower_{follower['index']}: actor={follower['actor_id']} "
                f"decoded={pressure['decodedCount']} waiting={pressure['waitingCount']} "
                f"failed={pressure['failedCount']} first={pressure['firstFound']} "
                f"last={pressure['lastFound']} frames={follower['injected_realtime_frames']}",
            )
        print(f"[OK] duration_ms: {duration_ms}")
        print(f"[OK] report: {report_path}")
        return 0
    finally:
        for follower in followers:
            follower["stop"].set()
        if authority_process:
            fed_gate.close_renderer(helpers, authority_process, authority_session, authority_profile)
        for follower in followers:
            if follower.get("process"):
                fed_gate.close_renderer(helpers, follower["process"], follower["session"], follower["profile"])


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - gate prints actionable root cause.
        print(f"federated Desktop DOM multi-follower pressure failed: {error}", file=sys.stderr)
        raise SystemExit(1)
