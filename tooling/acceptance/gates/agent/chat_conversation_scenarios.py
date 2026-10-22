"""Real inline clarification with Provider continuation and Station readback."""

from __future__ import annotations

import json
import threading
import time
from typing import Any

from selenium.webdriver.common.by import By

from tooling.acceptance.drivers.native import NativeKey
from tooling.acceptance.gates.agent.chat_model_scenarios import select_model
from tooling.acceptance.gates.agent.native_agent_runner import (
    AgentNativeJourney, REPO_ROOT, model_capability_config, require, wait_until,
)


def tool_approval(
    runner: AgentNativeJourney, agent_id: str, fixture: dict[str, str],
) -> dict[str, Any]:
    """Exercise two real governed turns: deny without execution, then approve."""
    setup = runner.harness("prepareChatSuiteToolApproval", {"agentId": agent_id})
    server = runner.minimum_provider_fixture.server
    marker = runner.runtime_manifest["runId"]
    with server.request_lock:
        server.terminal_only = False
        server.tool_name = setup["toolName"]
        server.selected_tool_name = ""
        server.tool_arguments = {}
        server.expected_tool_result = ""
        server.terminal_content = f"Approval continuation {marker}"
        server.follow_up_suggestions = []
    runner.select_agent_chat(agent_id)
    cases = {}
    for decision in ("cancel", "approve"):
        runner.click_visible("[data-pt-agent-session-start]", f"new {decision} Topic")
        select_model(runner, fixture)
        request_start = len(runner.minimum_provider_fixture.snapshot())
        runner.driver.find_element(
            By.CSS_SELECTOR, "[data-pt-agent-composer-input]",
        ).send_keys(
            f"List skills for approval acceptance {decision} {marker}.",
        )
        runner.press_native_key(
            NativeKey.ENTER,
            selector="[data-pt-agent-composer-input]",
        )
        cancel = runner.wait_visible_element(
            '[data-pt-agent-tool-recovery="continue-without-tool"]', "inline cancellation",
        )
        wait_until(lambda: runner.driver.execute_script(
            "return document.activeElement === document.querySelector("
            "'[data-pt-agent-tool-recovery=\"continue-without-tool\"]');"
        ), "safe cancellation focus")
        require(cancel, "approval lacks cancellation action")
        runner.set_input_value(
            "[data-pt-agent-composer-input]", f"Draft {decision}", "approval draft",
        )
        conversation_id = runner.runtime_snapshot()["currentSessionKey"]
        selector = (
            '[data-pt-agent-tool-recovery="continue-without-tool"]'
            if decision == "cancel" else '[data-pt-agent-tool-decision="approve"]'
        )
        runner.click_visible(selector, f"{decision} tool execution")
        receipt = runner.wait_visible_element(
            "[data-pt-agent-tool-receipt]", f"{decision} system receipt",
        )
        require(receipt["text"], "system receipt has no readable outcome")
        wait_until(lambda: runner.driver.execute_script(
            """
            return [...document.querySelectorAll('[data-pt-agent-message-id]')]
              .some(e => e.getClientRects().length && e.innerText.includes(arguments[0]));
            """, server.terminal_content,
        ), f"{decision} Agent continuation")
        require(runner.visible_element_state(
            '[data-pt-agent-tool-decision="approve"]',
        ) is None, "terminal tool still exposes approval")
        require(runner.driver.find_element(
            By.CSS_SELECTOR, "[data-pt-agent-composer-input]",
        ).get_attribute("value") == f"Draft {decision}", "approval discarded draft")
        readback = runner.conversation_readback(conversation_id)
        requests = runner.minimum_provider_fixture.snapshot()[request_start:]
        require(any(row["hasToolResult"] and row["authorizationPresent"] for row in requests),
                "Agent continuation omitted authorized tool settlement")
        serialized = json.dumps(readback).lower()
        if decision == "cancel":
            require("denied" in serialized or "approvaldenied" in serialized,
                    "cancelled tool was not durably denied")
        else:
            require("skills_list" in serialized, "approved tool receipt absent from history")
        cases[decision] = {
            "receipt": receipt,
            "stationReadback": readback, "providerRequests": requests,
            "terminalCard": runner.driver.execute_script(
                "return [...document.querySelectorAll('[data-pt-agent-tool-call]')]"
                ".filter(e => e.getClientRects().length).map(e => e.innerText);"
            ),
        }
    return {
        "uiAction": "send governed skill requests, cancel first approval and run second",
        "receiverAssertion": "Cancel owns initial focus; terminal receipts and real Agent continuation preserve draft",
        "cases": cases,
        "operationIds": [
            "approval.cancel", "approval.safe-focus", "approval.run",
            "approval.system-receipt", "approval.continue",
        ],
    }


def configure_clarification_fixture(runner: AgentNativeJourney) -> None:
    """Suite setup uses the already registered real Direct endpoint."""
    provider = runner.cli_provider_fixture["providerId"]
    fixture = runner.minimum_provider_fixture
    with fixture.server.request_lock:
        fixture.server.terminal_only = False
        fixture.server.tool_name = "ask_user"
        fixture.server.selected_tool_name = ""
        fixture.server.tool_arguments = {
            "prompt": "Choose the acceptance destination.",
            "choices": ["First choice", "Second choice"],
        }
        fixture.server.expected_tool_result = "Own destination"
        fixture.server.terminal_content = f"Clarification accepted {runner.runtime_manifest['runId']}"
    runner.invoke_readback_command("model_update", {
        "provider_id": provider, "model_id": "profile-prompt",
        "data": {
            "capabilities": model_capability_config({
                "streaming": True,
                "native-tools": True,
            }),
            "context_window": 8192,
        },
    })
    runner.harness("reconcileChatSuiteModelProjection")


def clarification(
    runner: AgentNativeJourney, agent_id: str, fixture: dict[str, str],
    *, restart: Any = None,
) -> dict[str, Any]:
    runner.select_agent_chat(agent_id)
    runner.click_visible("[data-pt-agent-session-start]", "new clarification Topic")
    select_model(runner, fixture)
    composer = runner.driver.find_element(By.CSS_SELECTOR, "[data-pt-agent-composer-input]")
    composer.send_keys("Ask me for an acceptance destination.")
    runner.press_native_key(
        NativeKey.ENTER,
        selector="[data-pt-agent-composer-input]",
    )
    card = runner.wait_visible_element(
        "[data-pt-agent-clarification]", "inline clarification question",
    )
    conversation_id = runner.runtime_snapshot()["currentSessionKey"]
    if restart is not None:
        restart()
    else:
        runner.restart_native_runtime()
    runner.harness("navigateToAgent", timeout=120)
    runner.select_agent_chat(agent_id)
    from tooling.acceptance.gates.agent.chat_topic_scenarios import select_topic
    select_topic(runner, conversation_id)
    runner.wait_visible_element(
        "[data-pt-agent-clarification-submit]", "waiting clarification restored after restart",
    )
    require(runner.invoke_readback_command(
        "agent_conversation_get", {"conversation_id": conversation_id},
    )["conversation"]["conversation_id"] == conversation_id,
            "restart changed the waiting Topic identity")
    runner.click_visible(
        '[data-pt-agent-clarification-choice="First choice"]', "clarification option",
    )
    require(
        runner.driver.find_element(
            By.CSS_SELECTOR, "[data-pt-agent-clarification-submit]",
        ).is_enabled(),
        "clarification option did not enable Submit",
    )
    runner.click_visible("[data-pt-agent-clarification-other]", "own clarification answer")
    runner.set_input_value(
        "[data-pt-agent-clarification-input]", "Own destination", "clarification answer",
    )
    runner.click_visible("[data-pt-agent-clarification-submit]", "submit clarification")
    answer = wait_until(
        lambda: (
            text if "Own destination" in (
                text := runner.driver.execute_script(
                    """
                    return [...document.querySelectorAll('[data-pt-agent-clarification-answer]')]
                      .filter(element => element.getClientRects().length)
                      .map(element => element.innerText).join('\\n');
                    """
                )
            ) else None
        ), "accepted clarification answer",
    )
    response = f"Clarification accepted {runner.runtime_manifest['runId']}"
    wait_until(
        lambda: runner.driver.execute_script(
            """
            return [...document.querySelectorAll('[data-pt-agent-message-id]')]
              .some(element => element.getClientRects().length
                && element.innerText.includes(arguments[0]));
            """, response,
        ), "actual Provider continuation after answer",
    )
    requests = runner.minimum_provider_fixture.snapshot()
    require(
        any(request["hasExpectedToolResult"] for request in requests),
        "Provider continuation did not consume the committed clarification answer",
    )
    readback = runner.conversation_readback(conversation_id)
    require("Own destination" in json.dumps(readback),
            "Station history omitted the committed clarification answer")
    require(response in json.dumps(readback), "Station omitted Provider continuation")
    return {
        "uiAction": "send, restart while clarification waits, restore Topic, choose option and Other, then Submit",
        "receiverAssertion": "inline answer becomes terminal and actual Provider continuation is visible",
        "question": card, "answer": answer,
        "stationReadback": readback, "providerRequests": requests,
        "operationIds": [
            "ask.option", "ask.other", "ask.submit", "ask.continue",
            "ask.answer.persisted", "ask.restart-continuation",
        ],
    }


def follow_up(runner: AgentNativeJourney, agent_id: str, fixture: dict[str, str]) -> dict[str, Any]:
    """Suggestions must originate in a real authorized Station Provider call."""
    labels = json.loads((REPO_ROOT / "packages/locales/en/chat.json").read_text())
    agent_labels = json.loads((REPO_ROOT / "packages/locales/en/agent.json").read_text())
    marker = runner.runtime_manifest["runId"]
    suggestions = [f"Explain {marker}", f"Compare {marker}", f"Next step {marker}"]
    content = f"Conversation artifact {marker}\n\n```python\nprint('{marker}')\n```"
    with runner.minimum_provider_fixture.server.request_lock:
        runner.minimum_provider_fixture.server.terminal_only = True
        runner.minimum_provider_fixture.server.terminal_content = content
        runner.minimum_provider_fixture.server.follow_up_suggestions = suggestions
    runner.select_agent_chat(agent_id)
    runner.click_visible("[data-pt-agent-session-start]", "new follow-up Topic")
    select_model(runner, fixture)
    runner.driver.find_element(
        By.CSS_SELECTOR, "[data-pt-agent-composer-input]",
    ).send_keys(
        f"Provide a code artifact for {marker}.",
    )
    runner.press_native_key(
        NativeKey.ENTER,
        selector="[data-pt-agent-composer-input]",
    )
    suggestion_selector = (
        f'[data-pt-agent-follow-up="{suggestions[0]}"]'
    )
    runner.wait_visible_element(
        suggestion_selector,
        "Station-generated follow-up chip",
    )
    time.sleep(0.5)
    stable_chip = runner.driver.execute_script(
        """
        const element = document.querySelector(arguments[0]);
        if (!element) return {exists: false};
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        let scroller = element.parentElement;
        while (scroller && scroller.scrollHeight <= scroller.clientHeight) {
          scroller = scroller.parentElement;
        }
        return {
          exists: true,
          visible: element.getClientRects().length > 0
            && style.display !== 'none'
            && style.visibility !== 'hidden'
            && Number(style.opacity) > 0
            && rect.width > 0
            && rect.height > 0
            && rect.right > 0
            && rect.bottom > 0
            && rect.left < window.innerWidth
            && rect.top < window.innerHeight,
          rect: {
            left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
            width: rect.width, height: rect.height,
          },
          viewport: {width: window.innerWidth, height: window.innerHeight},
          scroller: scroller ? {
            scrollTop: scroller.scrollTop,
            scrollHeight: scroller.scrollHeight,
            clientHeight: scroller.clientHeight,
          } : null,
        };
        """,
        suggestion_selector,
    )
    if stable_chip.get("visible") is not True:
        conversation_id = runner.runtime_snapshot()["currentSessionKey"]
        store_messages = runner.harness("getMessages")
        station_messages = runner.invoke_readback_command(
            "agent_conversation_messages",
            {"conversation_id": conversation_id, "limit": 200},
        )
        require(
            False,
            "follow-up suggestion did not remain reachable: "
            f"{json.dumps({'dom': stable_chip, 'store': store_messages, 'station': station_messages})}",
        )
    runner.click_visible(suggestion_selector, "expand follow-up suggestion")
    chip = runner.wait_visible_element('button[aria-expanded="true"]', "expanded suggestion")
    require(chip, "suggestion did not expand")
    runner.set_input_value("[data-pt-agent-composer-input]", "Preserved draft", "existing draft")
    runner.click_visible(
        '[data-pt-agent-follow-up-action="add"]',
        "Add suggestion to input",
    )
    draft = wait_until(lambda: (
        value if suggestions[0] in (value := runner.driver.find_element(
            By.CSS_SELECTOR, "[data-pt-agent-composer-input]",
        ).get_attribute("value")) else None
    ), "suggestion appended to composer")
    require("Preserved draft" in draft, "Add suggestion replaced existing draft")
    conversation_id = runner.runtime_snapshot()["currentSessionKey"]
    readback = runner.conversation_readback(conversation_id)
    require(content in json.dumps(readback, ensure_ascii=False).replace("\\n", "\n"),
            "Provider artifact absent from Station history")
    runner.click_visible("[data-pt-agent-activity-toggle]", "expand turn activity")
    runner.wait_visible_element(
        '[data-pt-agent-activity-toggle][aria-expanded="true"]', "expanded turn activity",
    )
    runner.press_native_key(
        NativeKey.ENTER,
        selector="[data-pt-agent-activity-toggle]",
    )
    runner.wait_visible_element(
        '[data-pt-agent-activity-toggle][aria-expanded="false"]', "activity keyboard collapse",
    )
    header = runner.driver.execute_script(
        """
        const root = document.querySelector('[data-pt-agent-conversation-header]');
        const title = root.querySelector('strong');
        const trigger = root.querySelector('[title="' + arguments[0] + '"]');
        const a = root.getBoundingClientRect(), b = trigger.getBoundingClientRect();
        return {title: title.innerText, rightGap: a.right - b.right,
                controls: [...root.querySelectorAll('button,[role="button"]')]
                  .map(e => e.title || e.getAttribute('aria-label') || e.innerText),
                inputs: root.querySelectorAll('input').length};
        """, agent_labels["agent.chat.search.open"],
    )
    require(header["title"] and header["rightGap"] < 40 and header["inputs"] == 0,
            "conversation header does not show Topic and right-aligned search")
    require(not runner.driver.execute_script(
        "return [...document.querySelectorAll('[data-pt-agent-conversation-header] button,"
        "[data-pt-agent-conversation-header] [role=\"button\"]')]"
        ".some(e => /export|share|subscribe|skill|quick/i.test(e.title || e.innerText));"
    ), "conversation header exposes excluded actions")
    runner.click_visible(
        f'[title="{agent_labels["agent.chat.search.open"]}"]', "search conversation content",
    )
    runner.set_input_value(
        f'input[aria-label="{agent_labels["agent.chat.search.placeholder"]}"]',
        marker, "search marker",
    )
    match = runner.wait_visible_element(
        '[data-pt-agent-search-match="active"]', "search navigates to actual message",
    )
    runner.click_visible(
        f'[title="{agent_labels["agent.chat.search.next"]}"]', "next content match",
    )
    runner.click_visible(
        f'[title="{agent_labels["agent.chat.search.close"]}"]', "close content search",
    )
    wait_until(lambda: runner.driver.execute_script(
        "return document.activeElement?.title === arguments[0];",
        agent_labels["agent.chat.search.open"],
    ), "search focus restored")
    runner.click_visible(
        '[data-pt-agent-message="assistant"] [data-pt-message-action="copy"]',
        "copy actual assistant response",
    )
    copied = runner.driver.execute_async_script(
        "const done = arguments[arguments.length - 1];"
        "navigator.clipboard.readText().then(done, error => done({error: String(error)}));"
    )
    require(isinstance(copied, str) and marker in copied, "Copy did not write assistant response")
    runner.click_visible(
        f'[title="{labels["chat.message.artifact.open"]}"]', "open generated code artifact",
    )
    artifact = wait_until(lambda: runner.driver.execute_script(
        "return [...document.querySelectorAll('pre')].filter(e => e.getClientRects().length)"
        ".map(e => e.innerText).find(text => text.includes(arguments[0]));", marker,
    ), "artifact detail content")
    runner.click_visible("[data-pt-agent-artifacts-list]", "all Topic artifacts")
    runner.wait_visible_element(
        '[data-pt-agent-portal-view="artifacts"]', "basic artifact list",
    )
    require(not runner.driver.execute_script(
        "const panel = document.querySelector('[data-pt-agent-portal]');"
        "return Boolean(panel.querySelector('input,[data-pt-agent-portal-tab]'));"
    ), "basic artifacts exposed search or working inspector tabs")
    runner.click_visible("[data-pt-agent-portal-close]", "close artifact detail")
    runner.click_visible("[data-pt-message-actions-more]", "ordinary message menu")
    require(not runner.driver.execute_script(
        "return [...document.querySelectorAll('[data-pt-message-action=\"turnDetails\"]')]"
        ".some(e => e.getClientRects().length);"
    ), "ordinary message menu exposes developer turn inspector")
    runner.press_native_key(NativeKey.ESCAPE)
    runner.click_visible(suggestion_selector, "reopen follow-up suggestion")
    runner.click_visible(
        '[data-pt-agent-follow-up-action="send"]',
        "Reply now",
    )
    wait_until(lambda: runner.driver.execute_script(
        "return [...document.querySelectorAll('[data-pt-agent-message=\"user\"]')]"
        ".some(e => e.getClientRects().length && e.innerText.includes(arguments[0]));",
        suggestions[0],
    ), "quick reply becomes real user message")
    require(runner.driver.find_element(
        By.CSS_SELECTOR, "[data-pt-agent-composer-input]",
    ).get_attribute("value") == draft, "Reply now consumed existing draft")
    requests = runner.minimum_provider_fixture.snapshot()
    require(any(row.get("followUpRequest") and row["authorizationPresent"] for row in requests),
            "suggestions bypassed authorized Station Provider request")
    return {
        "uiAction": "send code request, expand suggestion, append, search, copy, open artifact, Reply now",
        "receiverAssertion": "actual Provider output renders searchable artifact and suggestions; quick reply preserves draft",
        "suggestions": suggestions, "draft": draft, "searchMatch": match,
        "artifact": artifact, "stationReadback": readback, "providerRequests": requests,
        "operationIds": [
            "header.search.content", "header.search.navigate", "header.search.close-focus",
            "turn.activity", "turn.copy", "quick-reply.expand", "quick-reply.add-to-input",
            "quick-reply.reply-now", "quick-reply.preserve-draft", "artifact.open", "artifact.detail",
            "header.topic-title", "header.search.right-aligned", "header.no-fake-roster-search",
            "header.no-ai-quick-tools", "header.no-export-share-link",
            "artifact.basic-scope-only",
            "turn.no-developer-inspectors",
        ],
    }


def send_stop(runner: AgentNativeJourney, agent_id: str, fixture: dict[str, str]) -> dict[str, Any]:
    """Hold the real upstream request until the user cancels the admitted turn."""
    server = runner.minimum_provider_fixture.server
    gate = threading.Event()
    with server.request_lock:
        server.terminal_only = True
        server.response_gate = gate
        server.failure_status = None
    runner.select_agent_chat(agent_id)
    runner.click_visible("[data-pt-agent-session-start]", "new stoppable Topic")
    select_model(runner, fixture)
    composer = runner.driver.find_element(By.CSS_SELECTOR, "[data-pt-agent-composer-input]")
    try:
        composer.send_keys("Wait for my cancellation.")
        runner.press_native_key(
            NativeKey.ENTER,
            selector="[data-pt-agent-composer-input]",
        )
        runner.wait_visible_element("[data-pt-agent-stop]", "reachable Stop")
        if runner.driver.execute_script(
            "return matchMedia('(prefers-reduced-motion: reduce)').matches;"
        ):
            motion = runner.driver.execute_script(
                """
                return [...document.querySelectorAll('[data-pt-agent-workbench] *')]
                  .filter(e => e.getClientRects().length)
                  .map(e => getComputedStyle(e).animationName);
                """
            )
            require(motion and all(name == "none" for name in motion),
                    "reduced-motion running turn still animates")
        conversation_id = runner.runtime_snapshot()["currentSessionKey"]
        composer.send_keys("Draft during running turn")
        runner.press_native_key(
            NativeKey.ENTER,
            selector="[data-pt-agent-composer-input]",
        )
        require(composer.get_attribute("value") == "Draft during running turn",
                "second Enter discarded running draft")
        snapshot = runner.runtime_snapshot()
        require(isinstance(snapshot.get("operation"), dict)
                and snapshot["operation"].get("conversationId") == conversation_id,
                "second Enter changed the active turn owner")
        running_readback = runner.conversation_readback(conversation_id)
        require(len([message for message in running_readback["messages"]
                     if message["role"] == "user"]) == 1,
                "second Enter created another durable user message")
        require(not runner.driver.execute_script(
            "return [...document.querySelectorAll('[data-pt-agent-turn-queue],"
            "[data-pt-agent-message-queued]')].some(e => e.getClientRects().length);"
        ), "running turn exposed a queue")
        runner.click_visible("[data-pt-agent-stop]", "Stop running turn")
        terminal = runner.wait_visible_element(
            '[data-pt-agent-terminal-status="cancelled"], [data-pt-agent-error-type="EXECUTION_CANCELLED"]',
            "honest cancellation terminal",
        )
        require(composer.get_attribute("value") == "Draft during running turn",
                "Stop discarded running draft")
        readback = runner.conversation_readback(conversation_id)
        require("cancel" in json.dumps(readback).lower(), "Station did not persist cancellation")
        return {
            "uiAction": "send through real Provider, type during running turn, second Enter, Stop",
            "receiverAssertion": "one running owner retains draft and becomes durable cancellation without queue",
            "terminal": terminal, "runningSnapshot": snapshot, "stationReadback": readback,
            "operationIds": [
                "turn.single-active-owner", "turn.running-draft-preserved", "turn.no-queue-panel",
                "turn.stop-reachable", "turn.stop", "turn.stop.execution-cancelled", "turn.stop.topic-error",
            ],
        }
    finally:
        gate.set()
        server.response_gate = None


def retry(runner: AgentNativeJourney, agent_id: str, fixture: dict[str, str]) -> dict[str, Any]:
    server = runner.minimum_provider_fixture.server
    marker = runner.runtime_manifest["runId"]
    with server.request_lock:
        server.terminal_only = True
        server.disconnect_requests = True
        server.terminal_content = f"Recovered network {marker}"
    runner.select_agent_chat(agent_id)
    runner.click_visible("[data-pt-agent-session-start]", "new recovery Topic")
    select_model(runner, fixture)
    composer = runner.driver.find_element(By.CSS_SELECTOR, "[data-pt-agent-composer-input]")
    try:
        composer.send_keys(f"Recover request {marker}.")
        runner.press_native_key(
            NativeKey.ENTER,
            selector="[data-pt-agent-composer-input]",
        )
        runner.wait_visible_element("[data-pt-agent-stop]", "network request started")
        composer.send_keys("Draft retained after network failure")
        error = runner.wait_visible_element(
            '[data-pt-agent-message="assistant"][data-pt-agent-error-type]',
            "typed upstream transport failure",
        )
        conversation_id = runner.runtime_snapshot()["currentSessionKey"]
        failure_readback = runner.conversation_readback(conversation_id)
        require(any(message.get("errorJson") for message in failure_readback["messages"]),
                "transport failure was not persisted as typed error")
        require(composer.get_attribute("value") == "Draft retained after network failure",
                "transport failure discarded draft")
        server.disconnect_requests = False
        runner.click_visible('[data-pt-message-action="retry"]', "Retry actual failed turn")
        recovered = wait_until(lambda: runner.driver.execute_script(
            "return [...document.querySelectorAll('[data-pt-agent-message=\"assistant\"]')]"
            ".filter(e => e.getClientRects().length).map(e => e.innerText)"
            ".find(text => text.includes(arguments[0]));", f"Recovered network {marker}",
        ), "Provider response after Retry")
        require(composer.get_attribute("value") == "Draft retained after network failure",
                "Retry consumed unsent draft")
        readback = runner.conversation_readback(conversation_id)
        require(f"Recovered network {marker}" in json.dumps(readback),
                "Retry result absent from Station history")
        return {
            "uiAction": "send through disconnected upstream, type draft, Retry after recovery",
            "receiverAssertion": "typed failure and actual retried Provider response preserve draft and Topic",
            "error": error, "recovered": recovered, "stationReadback": readback,
            "operationIds": ["error.typed-network", "error.draft-preserved", "error.retry"],
        }
    finally:
        server.disconnect_requests = False
