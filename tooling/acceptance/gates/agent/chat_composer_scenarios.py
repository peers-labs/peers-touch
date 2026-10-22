"""Native composer resources, verified against committed Station history."""

from __future__ import annotations

import json
from typing import Any

from selenium.webdriver.common.by import By

from tooling.acceptance.drivers.native import NativeKey
from tooling.acceptance.gates.agent.chat_model_scenarios import select_model
from tooling.acceptance.gates.agent.native_agent_runner import (
    AgentNativeJourney, require, wait_until,
)
from tooling.acceptance.gates.chat.native_file_picker import select_native_file


def _persisted_conversation_id(runner: AgentNativeJourney) -> str:
    def promoted_or_failed() -> str | None:
        snapshot = runner.runtime_snapshot()
        key = str(snapshot.get("currentSessionKey") or "")
        if key and not key.startswith("draft:"):
            return key
        operation = snapshot.get("operation")
        assistant = snapshot.get("assistant")
        operation_failed = (
            isinstance(operation, dict)
            and operation.get("runState") in {"failed", "cancelled"}
        )
        assistant_failed = (
            isinstance(assistant, dict)
            and bool(assistant.get("error"))
        )
        require(
            not operation_failed and not assistant_failed,
            "attachment Turn failed before Topic promotion: "
            + json.dumps(
                {
                    "currentSessionKey": key,
                    "operation": operation,
                    "assistant": assistant,
                },
                sort_keys=True,
            ),
        )
        return None

    return wait_until(
        promoted_or_failed,
        "new attachment Topic promotion",
    )


def slash(runner: AgentNativeJourney) -> dict[str, Any]:
    runner.set_input_value("[data-pt-agent-composer-input]", "Preserve ", "slash draft")
    runner.click_visible(
        "[data-pt-agent-composer-slash]", "insert slash",
    )
    value = wait_until(lambda: (
        text if (text := runner.driver.find_element(
            By.CSS_SELECTOR, "[data-pt-agent-composer-input]",
        ).get_attribute("value")) == "Preserve /" else None
    ), "slash appended to current draft")
    wait_until(
        lambda: runner.driver.execute_script(
            "return document.activeElement === document.querySelector("
            "'[data-pt-agent-composer-input]');"
        ) or None,
        "slash insertion focused composer",
    )
    runner.set_input_value("[data-pt-agent-composer-input]", "", "clear slash draft")
    return {
        "uiAction": "click slash with an existing draft",
        "receiverAssertion": "slash appends without replacing draft and composer owns focus",
        "value": value, "operationIds": ["composer.slash"],
    }


def attachments(
    runner: AgentNativeJourney, agent_id: str, fixture: dict[str, str],
) -> dict[str, Any]:
    runner.select_agent_chat(agent_id)
    runner.click_visible("[data-pt-agent-session-start]", "new attachment Topic")
    select_model(runner, fixture)
    root = runner.run_root / "composer-fixtures"
    root.mkdir(parents=True, exist_ok=True)
    brief, discard = root / "brief.pdf", root / "discard.pdf"
    for path, marker in (
        (brief, f"Acceptance brief {runner.runtime_manifest['runId']}"),
        (discard, "This resource must be removed before send."),
    ):
        path.write_bytes(
            (
                "%PDF-1.4\n"
                "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"
                "2 0 obj\n<< /Type /Pages /Count 0 >>\nendobj\n"
                f"% {marker}\n"
                "trailer\n<< /Root 1 0 R >>\n%%EOF\n"
            ).encode("ascii")
        )
    require(runner.runtime_binding is not None, "attachment needs isolated Native runtime")
    for path in (brief, discard):
        select_native_file(
            actor=runner.client["id"],
            client=runner.tauri_driver,
            sessions=runner.runtime_sessions,
            runtime_binding=runner.runtime_binding,
            source_path=path,
            trigger_selector="[data-pt-agent-composer-attachment-choose]",
        )
    staged = wait_until(
        lambda: runner.driver.execute_script(
            """
            const files = [...document.querySelectorAll(
              '[data-pt-agent-composer-attachment]')];
            return files.length === 2 && files.every(
              file => file.dataset.ptAgentComposerAttachmentStatus === 'ready')
              ? files.map(file => ({
                  id: file.dataset.ptAgentComposerAttachment,
                  objectRef: file.dataset.ptAgentComposerAttachmentObjectRef,
                  text: file.innerText,
                })) : null;
            """
        ), "both attachments uploaded and ready",
    )
    removed = next(row for row in staged if "discard.pdf" in row["text"])
    retained = next(row for row in staged if "brief.pdf" in row["text"])
    runner.click_visible(
        f'[data-pt-agent-composer-attachment-remove="{removed["id"]}"]',
        "remove discarded attachment",
    )
    wait_until(
        lambda: runner.visible_element_state(
            f'[data-pt-agent-composer-attachment="{removed["id"]}"]',
        ) is None, "discarded resource removed from composer",
    )
    composer = runner.driver.find_element(By.CSS_SELECTOR, "[data-pt-agent-composer-input]")
    composer.send_keys("Read the attached brief.")
    runner.press_native_key(
        NativeKey.ENTER,
        selector="[data-pt-agent-composer-input]",
    )
    conversation_id = _persisted_conversation_id(runner)
    runner.wait_visible_element(
        f'[data-pt-agent-message-attachment="{retained["id"]}"]',
        "committed attachment visible on user message",
    )
    readback = wait_until(
        lambda: (
            value if retained["id"] in json.dumps(
                value := runner.conversation_readback(conversation_id)
            ) else None
        ), "Station history persisted retained attachment",
    )
    require(removed["id"] not in json.dumps(readback),
            "removed attachment entered committed message history")
    require(retained["objectRef"] in json.dumps(readback),
            "Station message omitted uploaded object identity")
    require(runner.visible_element_state("[data-pt-agent-composer-attachment]") is None,
            "successful send left staged resources in composer")
    return {
        "uiAction": "choose two files through Native input, remove one and send retained file",
        "receiverAssertion": "only retained resource is visible in message and Station history",
        "stationReadback": readback,
        "retainedAttachmentId": retained["id"], "removedAttachmentId": removed["id"],
        "operationIds": [
            "composer.attachment.choose", "composer.attachment.remove",
            "composer.attachment.readback",
        ],
    }
