#!/usr/bin/env python3
"""Fail-closed Native Tauri Gates for Agent Phase 2 product journeys."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable

REPO_ROOT = Path(__file__).resolve().parents[4]
REPORT_DIR = REPO_ROOT / "tooling/acceptance/reports/agent-native"
SOCKET_PATH = os.environ.get("PT_PLAYWRIGHT_SOCKET", "/tmp/tauri-playwright.sock")
STATION_URL = os.environ.get("PT_STATION_URL", "http://127.0.0.1:18080").rstrip("/")
TEST_EMAIL = os.environ.get("AGENT_TEST_EMAIL", "agent-test-a@p.t")
TEST_PASSWORD = os.environ.get("AGENT_TEST_PASSWORD", "")
TEST_NAME = os.environ.get("AGENT_TEST_NAME", "agent-test-a")
TEST_CONNECTOR_ID = os.environ.get("AGENT_TEST_CONNECTOR_ID", "")

DEFAULT_TIMEOUT = 30_000

CAPABILITY_GATE_IDS = {
    "I1": "agent-native-mention-e2e",
    "C6": "agent-native-knowledge-binding-e2e",
    "C7": "agent-native-connector-lifecycle-e2e",
    "R9": "agent-native-message-forward-e2e",
    "P2": "agent-native-portal-navigation-e2e",
}


class BlockedError(RuntimeError):
    """Environment or approved-fixture prerequisite is missing."""


class TauriBridge:
    def __init__(self, socket_path: str):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(60)
        self.sock.connect(socket_path)
        self.file = self.sock.makefile("rw", encoding="utf-8", newline="\n")
        self.seq = 0

    def close(self) -> None:
        self.file.close()
        self.sock.close()

    def send(self, command: dict[str, Any]) -> Any:
        self.seq += 1
        message = {**command, "seq": self.seq}
        self.file.write(json.dumps(message, ensure_ascii=False) + "\n")
        self.file.flush()
        response_line = self.file.readline()
        if not response_line:
            raise RuntimeError("Native observer socket closed before response")
        response = json.loads(response_line)
        if not response.get("ok", False):
            raise RuntimeError(f"{command.get('type')} failed: {response.get('error')}")
        return response.get("data")

    def ping(self) -> Any:
        return self.send({"type": "ping"})

    def list_windows(self) -> Any:
        return self.send({"type": "list_windows"})

    def eval(self, script: str) -> Any:
        return self.send({"type": "eval", "script": script})

    def click(self, selector: str, timeout_ms: int = DEFAULT_TIMEOUT) -> Any:
        return self.send({"type": "click", "selector": selector, "timeout_ms": timeout_ms})

    def fill(self, selector: str, text: str, timeout_ms: int = DEFAULT_TIMEOUT) -> Any:
        return self.send(
            {"type": "fill", "selector": selector, "text": text, "timeout_ms": timeout_ms}
        )

    def wait_for_selector(self, selector: str, timeout_ms: int = DEFAULT_TIMEOUT) -> Any:
        return self.send(
            {"type": "wait_for_selector", "selector": selector, "timeout_ms": timeout_ms}
        )

    def wait_for_function(self, expression: str, timeout_ms: int = DEFAULT_TIMEOUT) -> Any:
        return self.send(
            {"type": "wait_for_function", "expression": expression, "timeout_ms": timeout_ms}
        )

    def native_screenshot(self) -> bytes:
        data = self.send({"type": "native_screenshot"})
        if not isinstance(data, dict) or "base64" not in data:
            raise RuntimeError("Native screenshot did not return base64 evidence")
        return base64.b64decode(data["base64"])


def wait_until(
    fn: Callable[[], Any],
    description: str,
    timeout_ms: int = DEFAULT_TIMEOUT,
    interval_ms: int = 250,
) -> Any:
    deadline = time.time() + timeout_ms / 1000
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            result = fn()
            if result:
                return result
        except Exception as error:  # noqa: BLE001
            last_error = error
        time.sleep(interval_ms / 1000)
    raise RuntimeError(f"Timed out waiting for {description}: {last_error}")


def js_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def harness_call(bridge: TauriBridge, expression: str) -> Any:
    return bridge.eval(f"(async () => await ({expression}))()")


def fill_textarea(bridge: TauriBridge, selector: str, text: str) -> None:
    changed = bridge.eval(
        f"""(() => {{
          const element = document.querySelector({js_string(selector)});
          if (!(element instanceof HTMLTextAreaElement)) return false;
          const setter = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            'value',
          )?.set;
          setter?.call(element, {js_string(text)});
          element.dispatchEvent(new InputEvent('input', {{ bubbles: true, inputType: 'insertText', data: {js_string(text)} }}));
          element.dispatchEvent(new Event('change', {{ bubbles: true }}));
          element.focus();
          element.setSelectionRange(element.value.length, element.value.length);
          return true;
        }})()"""
    )
    if not changed:
        raise RuntimeError(f"Textarea not found: {selector}")


def dispatch_click(bridge: TauriBridge, selector: str) -> None:
    clicked = bridge.eval(
        f"""(() => {{
          const element = document.querySelector({js_string(selector)});
          if (!element) return false;
          element.dispatchEvent(new MouseEvent('click', {{ bubbles: true, cancelable: true, view: window }}));
          return true;
        }})()"""
    )
    if not clicked:
        raise RuntimeError(f"Clickable element not found: {selector}")


def add_step(evidence: dict[str, Any], step: str, **data: Any) -> None:
    evidence["steps"].append({"step": step, "ts": time.time(), **data})


def bootstrap_account() -> dict[str, Any]:
    if not TEST_PASSWORD:
        return {"status": "credential_missing"}
    body = json.dumps(
        {"name": TEST_NAME, "email": TEST_EMAIL, "password": TEST_PASSWORD}
    ).encode()
    request = urllib.request.Request(
        f"{STATION_URL}/actor/sign-up",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return {"status": "created", "code": response.status}
    except urllib.error.HTTPError as error:
        body_text = error.read().decode(errors="replace")
        if error.code in {400, 409} and "exists" in body_text.lower():
            return {"status": "exists", "code": error.code}
        return {"status": "failed", "code": error.code}


def login_to_shell(bridge: TauriBridge, evidence: dict[str, Any]) -> None:
    if not TEST_PASSWORD:
        raise BlockedError("ACCEPTANCE_CREDENTIAL_MISSING: AGENT_TEST_PASSWORD")

    if bridge.eval("!!document.querySelector('[data-login-add-account]')"):
        bridge.click("[data-login-add-account]")
        add_step(evidence, "login.add_account_clicked")

    bridge.wait_for_selector('[data-login-tab="email"]')
    bridge.click('[data-login-tab="email"]')
    bridge.fill("[data-login-email]", TEST_EMAIL)
    bridge.fill("[data-login-password]", TEST_PASSWORD)
    bridge.click("[data-login-submit]")
    add_step(evidence, "login.credentials_submitted")

    deadline = time.time() + 30
    while time.time() < deadline:
        if bridge.eval("document.querySelectorAll('[data-pt-primary-nav]').length > 0"):
            return
        if bridge.eval("!!document.querySelector('[data-login-pin-skip]')"):
            bridge.click("[data-login-pin-skip]")
        time.sleep(0.3)
    raise RuntimeError("Authenticated Ready Shell did not become visible")


def prepare_runtime(bridge: TauriBridge, evidence: dict[str, Any]) -> dict[str, Any]:
    bridge.ping()
    windows = bridge.list_windows()
    if not windows:
        raise RuntimeError("Native observer reported no windows")
    evidence["windows"] = windows
    add_step(evidence, "runtime.native_window_ready", count=len(windows))

    nav_count = bridge.eval("document.querySelectorAll('[data-pt-primary-nav]').length")
    if nav_count == 0:
        evidence["accountBootstrap"] = bootstrap_account()
        login_to_shell(bridge, evidence)
        nav_count = bridge.eval("document.querySelectorAll('[data-pt-primary-nav]').length")
    if nav_count <= 0:
        raise RuntimeError("Ready Shell has no primary navigation")
    add_step(evidence, "runtime.ready_shell", navCount=nav_count)

    bridge.wait_for_function(
        "typeof window.__PT_AGENT_ACCEPTANCE__?.ensureFixture === 'function'"
    )
    fixture = harness_call(bridge, "window.__PT_AGENT_ACCEPTANCE__.ensureFixture()")
    if not fixture or not fixture.get("source") or not fixture.get("target"):
        raise RuntimeError("Agent Acceptance fixture did not return source and target Agents")
    evidence["fixture"] = {
        "sourceAgentId": fixture["source"]["id"],
        "targetAgentId": fixture["target"]["id"],
        "sendReady": fixture["sendReady"],
    }
    add_step(evidence, "fixture.ready", sendReady=fixture["sendReady"])
    return fixture


def activate_agent(
    bridge: TauriBridge,
    agent_name: str,
    surface: str,
) -> None:
    harness_call(
        bridge,
        "window.__PT_AGENT_ACCEPTANCE__.activateAgent("
        f"{js_string(agent_name)}, {js_string(surface)})",
    )
    bridge.wait_for_selector("[data-pt-agent-workbench]")
    if surface == "chat":
        if not bridge.eval("!!document.querySelector('[data-pt-agent-composer]')"):
            if bridge.eval("!!document.querySelector('[data-pt-agent-profile-back]')"):
                dispatch_click(bridge, "[data-pt-agent-profile-back]")
            elif bridge.eval("!!document.querySelector('button:has(.lucide-arrow-left)')"):
                dispatch_click(bridge, "button:has(.lucide-arrow-left)")
            else:
                dispatch_click(bridge, '[data-pt-agent-nav="start-topic"]')
            time.sleep(0.5)
            if not bridge.eval("!!document.querySelector('[data-pt-agent-composer]')"):
                current_surface = bridge.eval(
                    "document.querySelector('[data-pt-conversation-rail]')"
                    "?.getAttribute('data-pt-agent-surface') || 'unknown'"
                )
                raise RuntimeError(
                    f"Start New Topic did not open Chat surface; current={current_surface}"
                )
        bridge.wait_for_selector("[data-pt-agent-composer]")
    else:
        bridge.wait_for_selector('[data-pt-agent-profile-tab="soul"]')


def prove_mention(
    bridge: TauriBridge,
    evidence: dict[str, Any],
    fixture: dict[str, Any],
) -> None:
    source = fixture["source"]
    target = fixture["target"]
    activate_agent(bridge, source["name"], "chat")
    bridge.wait_for_selector("[data-pt-agent-composer-input]")

    fill_textarea(bridge, "[data-pt-agent-composer-input]", "@")
    bridge.wait_for_selector("[data-pt-agent-mention-popup]")
    bridge.click(f'[data-pt-agent-mention-option="{target["id"]}"]')
    bridge.wait_for_selector(f'[data-pt-agent-mention-tag="{target["id"]}"]')
    selected = harness_call(bridge, "window.__PT_AGENT_ACCEPTANCE__.mentionSnapshot()")
    if target["id"] not in selected["mentionedAgentIds"]:
        raise RuntimeError("Mention selection was not projected into draft state")
    add_step(evidence, "I1.mention_selected", targetAgentId=target["id"])

    dispatch_click(
        bridge,
        f'[data-pt-agent-mention-tag="{target["id"]}"] .ant-tag-close-icon'
    )
    bridge.wait_for_function(
        f"!document.querySelector('[data-pt-agent-mention-tag={json.dumps(target['id'])}]')"
    )
    removed = harness_call(bridge, "window.__PT_AGENT_ACCEPTANCE__.mentionSnapshot()")
    if target["id"] in removed["mentionedAgentIds"]:
        raise RuntimeError("Mention tag removal did not clear draft state")
    add_step(evidence, "I1.mention_removed")

    if not fixture["sendReady"]:
        raise BlockedError("ACCEPTANCE_PROVIDER_MODEL_MISSING: successful-send cleanup unproven")
    marker = f"mention-acceptance-{int(time.time())}"
    fill_textarea(bridge, "[data-pt-agent-composer-input]", "@")
    bridge.wait_for_selector("[data-pt-agent-mention-popup]")
    bridge.click(f'[data-pt-agent-mention-option="{target["id"]}"]')
    fill_textarea(
        bridge,
        "[data-pt-agent-composer-input]",
        f"@{target['title']} {marker}",
    )
    bridge.click("[data-pt-agent-composer-send]")
    bridge.wait_for_function(
        "!document.querySelector('[data-pt-agent-mention-tags]') "
        "&& document.querySelector('[data-pt-agent-composer-input]').value === ''",
        timeout_ms=60_000,
    )
    cleared = harness_call(bridge, "window.__PT_AGENT_ACCEPTANCE__.mentionSnapshot()")
    if cleared["mentionedAgentIds"]:
        raise RuntimeError("Successful send did not clear mention state")
    add_step(evidence, "I1.successful_send_cleared_mentions", marker=marker)


def knowledge_bindings(bridge: TauriBridge, agent_id: str) -> list[dict[str, Any]]:
    result = harness_call(
        bridge,
        f"window.__PT_AGENT_ACCEPTANCE__.knowledgeBindings({js_string(agent_id)})",
    )
    return result or []


def prove_knowledge(
    bridge: TauriBridge,
    evidence: dict[str, Any],
    fixture: dict[str, Any],
) -> None:
    source = fixture["source"]
    activate_agent(bridge, source["name"], "profile")
    bridge.click('[data-pt-agent-profile-tab="capabilities"]')
    bridge.wait_for_selector("[data-pt-agent-knowledge-add-toggle]")
    add_step(evidence, "C6.capabilities_tab_ready")

    marker = f"knowledge-acceptance-{int(time.time())}"
    toggle_probe = bridge.eval(
        """(() => {
          const element = document.querySelector('[data-pt-agent-knowledge-add-toggle]');
          return element ? { tag: element.tagName, html: element.outerHTML.slice(0, 500) } : null;
        })()"""
    )
    add_step(evidence, "C6.add_toggle_probe", probe=toggle_probe)
    dispatch_click(bridge, "[data-pt-agent-knowledge-add-toggle]")
    add_step(
        evidence,
        "C6.add_toggle_dispatched",
        sourceCount=bridge.eval(
            "document.querySelectorAll('[data-pt-agent-knowledge-source]').length"
        ),
    )
    bridge.wait_for_selector("[data-pt-agent-knowledge-source]")
    add_step(evidence, "C6.add_form_open")
    bridge.fill("[data-pt-agent-knowledge-source]", f"https://example.invalid/{marker}")
    add_step(evidence, "C6.source_filled")
    bridge.fill("[data-pt-agent-knowledge-title]", marker)
    add_step(evidence, "C6.title_filled")
    dispatch_click(bridge, "[data-pt-agent-knowledge-submit]")
    add_step(evidence, "C6.submit_clicked")

    resource_id = wait_until(
        lambda: bridge.eval(
            f"""(() => {{
              const rows = [...document.querySelectorAll('[data-pt-agent-knowledge-resource]')];
              const row = rows.find((item) => item.textContent.includes({js_string(marker)}));
              return row?.getAttribute('data-pt-agent-knowledge-resource') || '';
            }})()"""
        ),
        "visible knowledge resource row",
        timeout_ms=60_000,
    )
    wait_until(
        lambda: next(
            (
                binding
                for binding in knowledge_bindings(bridge, source["id"])
                if binding.get("resourceId") == resource_id
                and binding.get("enabled") is True
                and binding.get("policy") == "manual"
            ),
            None,
        ),
        "Station knowledge binding create readback",
        timeout_ms=60_000,
    )
    add_step(evidence, "C6.binding_created", resourceId=resource_id)

    bridge.click(f'[data-pt-agent-knowledge-policy="{resource_id}"]')
    wait_until(
        lambda: not any(
            binding.get("resourceId") == resource_id
            for binding in knowledge_bindings(bridge, source["id"])
        ),
        "Station binding removal after disable",
        timeout_ms=60_000,
    )
    add_step(evidence, "C6.binding_disabled")

    bridge.click(f'[data-pt-agent-knowledge-policy="{resource_id}"]')
    wait_until(
        lambda: any(
            binding.get("resourceId") == resource_id
            for binding in knowledge_bindings(bridge, source["id"])
        ),
        "Station binding recreation after enable",
        timeout_ms=60_000,
    )
    add_step(evidence, "C6.binding_reenabled")

    bridge.click(f'[data-pt-agent-knowledge-remove="{resource_id}"]')
    wait_until(
        lambda: not any(
            binding.get("resourceId") == resource_id
            for binding in knowledge_bindings(bridge, source["id"])
        ),
        "Station binding deletion readback",
        timeout_ms=60_000,
    )
    bridge.wait_for_function(
        f"!document.querySelector('[data-pt-agent-knowledge-resource={json.dumps(resource_id)}]')"
    )
    add_step(evidence, "C6.binding_removed", resourceId=resource_id)


def connector_snapshot(bridge: TauriBridge, agent_id: str) -> dict[str, Any]:
    return harness_call(
        bridge,
        f"window.__PT_AGENT_ACCEPTANCE__.connectorSnapshot({js_string(agent_id)})",
    )


def prove_connector(
    bridge: TauriBridge,
    evidence: dict[str, Any],
    fixture: dict[str, Any],
) -> None:
    source = fixture["source"]
    activate_agent(bridge, source["name"], "profile")
    bridge.click('[data-pt-agent-profile-tab="capabilities"]')
    bridge.wait_for_selector("[data-pt-agent-connectors]")

    if not TEST_CONNECTOR_ID:
        raise BlockedError(
            "ACCEPTANCE_CREDENTIAL_MISSING: approved AGENT_TEST_CONNECTOR_ID"
        )

    snapshot = connector_snapshot(bridge, source["id"])
    available = snapshot.get("available", [])
    connector = next(
        (
            item
            for item in available
            if item.get("id") == TEST_CONNECTOR_ID
            and item.get("status") == "connected"
        ),
        None,
    )
    if not connector:
        raise BlockedError(
            "ACCEPTANCE_FIXTURE_SETUP_FAILED: approved connector is not connected"
        )
    connector_id = connector["id"]
    bridge.wait_for_selector(f'[data-pt-agent-connector="{connector_id}"]')
    bridge.click(f'[data-pt-agent-connector-toggle="{connector_id}"]')
    configured = wait_until(
        lambda: next(
            (
                item
                for item in connector_snapshot(bridge, source["id"]).get("configured", [])
                if item.get("connectorId") == connector_id
            ),
            None,
        ),
        "persisted connector mount",
        timeout_ms=60_000,
    )
    add_step(
        evidence,
        "C7.connector_mounted",
        connectorId=connector_id,
        enabledToolCount=len(configured.get("enabledTools", [])),
    )

    bridge.click(f'[data-pt-agent-connector-sync="{connector_id}"]')
    synced = wait_until(
        lambda: next(
            (
                item
                for item in connector_snapshot(bridge, source["id"]).get("configured", [])
                if item.get("connectorId") == connector_id
            ),
            None,
        ),
        "connector tool sync readback",
        timeout_ms=60_000,
    )
    add_step(
        evidence,
        "C7.tools_synced",
        connectorId=connector_id,
        enabledToolCount=len(synced.get("enabledTools", [])),
    )

    bridge.click(f'[data-pt-agent-connector-toggle="{connector_id}"]')
    wait_until(
        lambda: not any(
            item.get("connectorId") == connector_id
            for item in connector_snapshot(bridge, source["id"]).get("configured", [])
        ),
        "persisted connector unmount",
        timeout_ms=60_000,
    )
    add_step(evidence, "C7.connector_unmounted", connectorId=connector_id)


def conversation_snapshot(bridge: TauriBridge, agent_id: str) -> dict[str, Any]:
    return harness_call(
        bridge,
        f"window.__PT_AGENT_ACCEPTANCE__.conversationSnapshot({js_string(agent_id)})",
    )


def prove_forward(
    bridge: TauriBridge,
    evidence: dict[str, Any],
    fixture: dict[str, Any],
) -> None:
    if not fixture["sendReady"]:
        raise BlockedError("ACCEPTANCE_PROVIDER_MODEL_MISSING: forward source send unproven")
    source = fixture["source"]
    target = fixture["target"]
    activate_agent(bridge, source["name"], "chat")
    bridge.wait_for_selector("[data-pt-agent-composer-input]")
    marker = f"forward-acceptance-{int(time.time())}"
    fill_textarea(bridge, "[data-pt-agent-composer-input]", marker)
    bridge.click("[data-pt-agent-composer-send]")
    message_selector = '[data-pt-agent-message="user"]'
    wait_until(
        lambda: bridge.eval(
            f"[...document.querySelectorAll({js_string(message_selector)})]"
            f".some((item) => item.textContent.includes({js_string(marker)}))"
        ),
        "source user message",
        timeout_ms=60_000,
    )
    bridge.eval(
        f"""(() => {{
          const rows = [...document.querySelectorAll({js_string(message_selector)})];
          const row = rows.find((item) => item.textContent.includes({js_string(marker)}));
          row?.dispatchEvent(new MouseEvent('mouseenter', {{ bubbles: true }}));
          row?.dispatchEvent(new MouseEvent('mouseover', {{ bubbles: true }}));
          return Boolean(row);
        }})()"""
    )
    bridge.click(f"{message_selector} [data-pt-message-actions-more]")
    bridge.wait_for_selector('[data-pt-message-action="forward"]')
    bridge.click('[data-pt-message-action="forward"]')
    bridge.wait_for_selector("[data-pt-agent-forward-modal]")
    bridge.click(f'[data-pt-agent-forward-target="{target["id"]}"]')

    def destination_message() -> dict[str, Any] | None:
        snapshot = conversation_snapshot(bridge, target["name"])
        for response in snapshot.get("messagesByConversation", {}).values():
            for message in response.get("messages", []):
                if marker in message.get("content", ""):
                    return message
        return None

    persisted = wait_until(
        destination_message,
        "forwarded transcript in target Station conversation",
        timeout_ms=90_000,
    )
    activate_agent(bridge, target["name"], "chat")
    wait_until(
        lambda: marker in bridge.eval("document.body.innerText"),
        "forwarded transcript visible in target conversation",
        timeout_ms=60_000,
    )
    add_step(
        evidence,
        "R9.forward_persisted_and_visible",
        targetAgentId=target["id"],
        messageId=persisted.get("message_id"),
        marker=marker,
    )


def portal_snapshot(bridge: TauriBridge) -> dict[str, Any]:
    return harness_call(bridge, "window.__PT_AGENT_ACCEPTANCE__.portalSnapshot()")


def prove_portal(
    bridge: TauriBridge,
    evidence: dict[str, Any],
    fixture: dict[str, Any],
) -> None:
    source = fixture["source"]
    activate_agent(bridge, source["name"], "chat")
    add_step(
        evidence,
        "P2.chat_surface_ready",
        surface=bridge.eval(
            "document.querySelector('[data-pt-conversation-rail]')"
            "?.getAttribute('data-pt-agent-surface') || 'unknown'"
        ),
    )
    portal_toggle = (
        "[data-pt-agent-portal-toggle]"
        if bridge.eval(
            "!!document.querySelector('[data-pt-agent-portal-toggle] .lucide-panel-right')"
        )
        else "button:has(.lucide-panel-right)"
    )
    bridge.wait_for_selector(portal_toggle)
    add_step(evidence, "P2.toggle_ready")
    dispatch_click(bridge, portal_toggle)
    bridge.wait_for_selector("[data-pt-agent-portal]")
    add_step(evidence, "P2.portal_opened")
    dispatch_click(bridge, '[data-pt-agent-portal-tab="files"]')
    add_step(evidence, "P2.files_opened")
    dispatch_click(bridge, '[data-pt-agent-portal-tab="progress"]')
    add_step(evidence, "P2.progress_opened")
    bridge.wait_for_selector("[data-pt-agent-portal-back]")
    before_back = portal_snapshot(bridge)
    if len(before_back["portalStack"]) < 2 or before_back["activeView"]["type"] != "workingProgress":
        raise RuntimeError("Portal did not push two distinct views")

    dispatch_click(bridge, "[data-pt-agent-portal-back]")
    bridge.wait_for_function(
        "document.querySelector('[data-pt-agent-portal]')"
        ".getAttribute('data-pt-agent-portal-view') === 'workingFiles'"
    )
    add_step(evidence, "P2.back_restored_previous_view")

    dispatch_click(bridge, portal_toggle)
    bridge.wait_for_function("!document.querySelector('[data-pt-agent-portal]')")
    collapsed = portal_snapshot(bridge)
    if collapsed["expanded"] or not collapsed["portalStack"]:
        raise RuntimeError("Portal collapse did not preserve the navigation stack")
    dispatch_click(bridge, portal_toggle)
    bridge.wait_for_selector('[data-pt-agent-portal-view="workingFiles"]')
    add_step(evidence, "P2.collapse_reopen_preserved_stack")

    dispatch_click(bridge, "[data-pt-agent-portal-close]")
    bridge.wait_for_function("!document.querySelector('[data-pt-agent-portal]')")
    closed = portal_snapshot(bridge)
    if closed["expanded"] or closed["portalStack"] or closed["activeView"] is not None:
        raise RuntimeError("Explicit Portal close did not clear the stack")
    add_step(evidence, "P2.explicit_close_cleared_stack")


PROVERS: dict[str, Callable[[TauriBridge, dict[str, Any], dict[str, Any]], None]] = {
    "I1": prove_mention,
    "C6": prove_knowledge,
    "C7": prove_connector,
    "R9": prove_forward,
    "P2": prove_portal,
}


def source_identity() -> dict[str, Any]:
    head = subprocess.check_output(
        ["git", "rev-parse", "HEAD"],
        cwd=REPO_ROOT,
        text=True,
    ).strip()
    branch = subprocess.check_output(
        ["git", "branch", "--show-current"],
        cwd=REPO_ROOT,
        text=True,
    ).strip()
    status_lines = subprocess.check_output(
        ["git", "status", "--porcelain=v1", "-z"],
        cwd=REPO_ROOT,
    ).split(b"\0")
    digest = hashlib.sha256()
    changed_paths: list[str] = []
    for raw_line in status_lines:
        if not raw_line:
            continue
        line = raw_line.decode(errors="surrogateescape")
        path = line[3:]
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        changed_paths.append(path)
        digest.update(path.encode(errors="surrogateescape"))
        file_path = REPO_ROOT / path
        if file_path.is_file():
            digest.update(file_path.read_bytes())
    return {
        "gitHead": head,
        "branch": branch,
        "worktree": "<repo-root>",
        "workspaceDigest": digest.hexdigest(),
        "changedPathCount": len(changed_paths),
    }


def write_report(evidence: dict[str, Any], capability: str) -> Path:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORT_DIR / f"{capability.lower()}.json"
    path.write_text(
        json.dumps(evidence, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--capability", required=True, choices=sorted(PROVERS))
    args = parser.parse_args()
    capability = args.capability
    gate_id = CAPABILITY_GATE_IDS[capability]
    started = time.time()
    evidence: dict[str, Any] = {
        "schemaVersion": 1,
        "artifactKind": "agent-native-capability-gate",
        "phase": "agent-phase2-native",
        "bom": "agent-phase2-native-current-worktree",
        "spec": "docs/architecture/agent/execution-plans/20260816-lobehub-parity-full-landing.md",
        "gate": gate_id,
        "capability": capability,
        "gateId": gate_id,
        "runtime": "native-tauri-embedded-webdriver",
        "socket": SOCKET_PATH,
        "station": STATION_URL,
        "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": source_identity(),
        "steps": [],
    }
    bridge: TauriBridge | None = None
    exit_code = 1
    try:
        wait_until(lambda: Path(SOCKET_PATH).exists(), "Native observer socket")
        bridge = TauriBridge(SOCKET_PATH)
        fixture = prepare_runtime(bridge, evidence)
        PROVERS[capability](bridge, evidence, fixture)
        screenshot_path = REPORT_DIR / f"{capability.lower()}.png"
        screenshot_path.write_bytes(bridge.native_screenshot())
        evidence["screenshot"] = str(screenshot_path.relative_to(REPO_ROOT))
        evidence["status"] = "passed"
        evidence["proofStatus"] = "PROVEN"
        exit_code = 0
    except BlockedError as error:
        evidence["status"] = "blocked"
        evidence["proofStatus"] = "UNPROVEN"
        evidence["firstFailedStep"] = str(error)
        exit_code = 2
    except Exception as error:  # noqa: BLE001
        evidence["status"] = "failed"
        evidence["proofStatus"] = "UNPROVEN"
        evidence["firstFailedStep"] = str(error)
        exit_code = 1
    finally:
        if bridge is not None:
            if exit_code != 0:
                try:
                    failure_path = REPORT_DIR / f"{capability.lower()}-failure.png"
                    failure_path.parent.mkdir(parents=True, exist_ok=True)
                    failure_path.write_bytes(bridge.native_screenshot())
                    evidence["failureScreenshot"] = str(failure_path.relative_to(REPO_ROOT))
                except Exception as screenshot_error:  # noqa: BLE001
                    evidence["failureScreenshotError"] = str(screenshot_error)
            try:
                evidence["cleanup"] = harness_call(
                    bridge, "window.__PT_AGENT_ACCEPTANCE__.cleanupFixture()"
                )
            except Exception as cleanup_error:  # noqa: BLE001
                evidence["cleanupError"] = str(cleanup_error)
                if exit_code == 0:
                    evidence["status"] = "failed"
                    evidence["proofStatus"] = "UNPROVEN"
                    evidence["firstFailedStep"] = "ACCEPTANCE_FIXTURE_CLEANUP_FAILED"
                    exit_code = 1
            bridge.close()
        evidence["durationMs"] = int((time.time() - started) * 1000)
        evidence["completedAt"] = time.strftime(
            "%Y-%m-%dT%H:%M:%SZ", time.gmtime()
        )
        report_path = write_report(evidence, capability)
        stream = sys.stderr if exit_code else sys.stdout
        stream.write(f"[{evidence['status'].upper()}] {gate_id}: {report_path}\n")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
