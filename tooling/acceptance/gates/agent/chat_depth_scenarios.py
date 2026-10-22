"""Commands and historical Turn attribution Native scenarios."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

from selenium.webdriver.common.by import By

from tooling.acceptance.drivers.native import NativeKey, NativeModifier
from tooling.acceptance.gates.agent.native_agent_runner import (
    AgentNativeJourney,
    require,
    wait_until,
)


def _open_command_palette_with_native_slash(
    runner: AgentNativeJourney,
) -> None:
    selector = "[data-pt-agent-composer-input]"
    runner.press_native_key(
        NativeKey.A,
        selector=selector,
        modifiers=(NativeModifier.PRIMARY,),
    )
    runner.press_native_key(NativeKey.DELETE)
    runner.press_native_key(NativeKey.SLASH)


def command_projection(
    runner: AgentNativeJourney,
    agent_id: str,
    skill: dict[str, Any],
) -> dict[str, Any]:
    runner.click_visible("[data-pt-agent-profile-back]", "return to Agent Chat")
    runner.select_agent_chat(agent_id)
    initial = runner.runtime_snapshot()
    prior_topic = str(initial.get("currentSessionKey") or "")
    prior_conversations = runner.harness(
        "getCoreLifecycleAgentState",
    ).get("conversations", [])

    runner.click_visible(
        "[data-pt-agent-composer-slash]",
        "open Commands and Skills",
    )
    palette = runner.wait_visible_element(
        '[data-pt-agent-command-palette]'
        '[data-capability-projection-state="ready"]',
        "ready Station command snapshot",
        attributes=("data-capability-snapshot-id",),
    )
    snapshot_id = palette["attributes"]["data-capability-snapshot-id"]
    runner.click_visible('[data-command-id="help"]', "open /help")
    help_view = runner.wait_visible_element(
        '[data-pt-agent-command-palette][data-command-palette-view="help"]',
        "Desktop-local /help view",
        attributes=("data-command-palette-view",),
    )
    require(
        help_view["attributes"]["data-command-palette-view"] == "help",
        "/help did not remain Desktop-local",
    )
    runner.press_native_key(NativeKey.ESCAPE)

    runner.click_visible(
        "[data-pt-agent-composer-slash]",
        "reopen Commands and Skills",
    )
    runner.click_visible('[data-command-id="tools"]', "open /tools")
    tools_view = runner.wait_visible_element(
        '[data-pt-agent-command-palette][data-command-palette-view="tools"]',
        "Station /tools view",
        attributes=("data-command-palette-view",),
    )
    require(
        tools_view["attributes"]["data-command-palette-view"] == "tools",
        "/tools did not use the Station snapshot view",
    )
    runner.press_native_key(NativeKey.ESCAPE)

    runner.click_visible(
        "[data-pt-agent-composer-slash]",
        "reopen Commands and Skills",
    )
    runner.click_visible('[data-command-id="skills"]', "open /skills")
    skill_item = runner.wait_visible_element(
        f'[data-command-capability-id="{skill["capabilityId"]}"]'
        '[data-command-capability-kind="skill"]',
        "bound Skill in Station snapshot",
        attributes=("disabled",),
    )
    require(
        skill_item["attributes"]["disabled"] is None,
        "ready Skill is disabled",
    )
    runner.click_visible(
        f'[data-command-capability-id="{skill["capabilityId"]}"]'
        '[data-command-capability-kind="skill"]',
        "insert bound Skill command token",
    )
    draft = runner.driver.find_element(
        By.CSS_SELECTOR,
        "[data-pt-agent-composer-input]",
    ).get_attribute("value")
    require(
        draft.startswith("/") and draft.endswith(" "),
        "Skill selection did not write one deterministic composer token",
    )
    _open_command_palette_with_native_slash(runner)
    runner.wait_visible_element(
        "[data-pt-agent-command-palette]",
        "typing slash opened Commands and Skills",
    )
    runner.press_native_key(NativeKey.ESCAPE)
    runner.set_input_value(
        "[data-pt-agent-composer-input]",
        "ordinary text remains available",
        "ordinary command-surrounding draft",
    )

    runner.click_visible(
        "[data-pt-agent-composer-slash]",
        "open /clear command",
    )
    runner.click_visible('[data-command-id="clear"]', "execute /clear")

    new_topic = wait_until(
        lambda: (
            value
            if (
                value := str(
                    runner.runtime_snapshot().get("currentSessionKey") or ""
                )
            )
            and value != prior_topic
            and not value.startswith("draft:")
            else None
        ),
        "Station-created empty Topic",
    )
    readback = wait_until(
        lambda: (
            state
            if (
                state := runner.harness("getCoreLifecycleAgentState")
            )
            and any(
                row.get("conversation_id") == new_topic
                for row in state.get("conversations", [])
                if isinstance(row, dict)
            )
            and (
                not prior_topic
                or prior_topic.startswith("draft:")
                or any(
                    row.get("conversation_id") == prior_topic
                    for row in state.get("conversations", [])
                    if isinstance(row, dict)
                )
            )
            else None
        ),
        "new Topic and preserved prior history readback",
    )
    return {
        "uiAction": "inspect /help and /skills, type slash, then execute /clear",
        "receiverAssertion": (
            "one Station snapshot drives capabilities and /clear creates a "
            "durable empty Topic without deleting prior history"
        ),
        "snapshotId": snapshot_id,
        "skillCapabilityId": skill["capabilityId"],
        "insertedDraft": draft,
        "priorTopic": prior_topic,
        "newTopic": new_topic,
        "priorConversationCount": len(prior_conversations),
        "stationReadback": readback,
        "operationIds": [
            "composer.slash",
            "composer.command.help",
            "composer.command.tools",
            "composer.command.skills",
            "composer.command.clear-preserves-history",
            "composer.command.typing-slash-opens",
        ],
    }


def command_degraded(
    runner: AgentNativeJourney,
    agent_id: str,
    skill: dict[str, Any],
) -> dict[str, Any]:
    runner.set_input_value(
        "[data-pt-agent-composer-input]",
        "ordinary text remains enabled while commands are stale",
        "ordinary stale-projection message",
    )
    runner.click_visible(
        "[data-pt-agent-composer-slash]",
        "open Commands and Skills before stale projection",
    )
    runner.wait_visible_element(
        '[data-pt-agent-command-palette]'
        '[data-capability-projection-state="ready"]',
        "ready command palette before stale projection",
    )
    stale = runner.harness(
        "setChatSuiteCommandProjectionState",
        {"agentId": agent_id, "state": "stale"},
    )
    require(stale.get("state") == "stale", "command snapshot did not become stale")
    runner.wait_visible_element(
        '[data-pt-agent-command-palette]'
        '[data-capability-projection-state="stale"]',
        "stale Station command snapshot",
    )
    stale_skill = runner.wait_visible_element(
        f'[data-command-capability-id="{skill["capabilityId"]}"]',
        "stale Skill capability",
        attributes=("disabled",),
    )
    require(
        stale_skill["attributes"]["disabled"] is not None,
        "stale Skill capability remained selectable",
    )
    send = runner.wait_visible_element(
        "[data-pt-agent-composer-send]",
        "ordinary text send action",
        attributes=("disabled",),
    )
    require(
        send["attributes"]["disabled"] is None,
        "stale command projection blocked ordinary text conversation",
    )

    unavailable = runner.harness(
        "setChatSuiteCommandProjectionState",
        {"agentId": agent_id, "state": "unavailable"},
    )
    require(
        unavailable.get("state") == "unavailable",
        "command snapshot did not become unavailable",
    )
    runner.wait_visible_element(
        '[data-pt-agent-command-palette]'
        '[data-capability-projection-state="unavailable"]',
        "unavailable Station command snapshot",
    )
    enabled_capabilities = runner.driver.execute_script(
        """
        return [...document.querySelectorAll(
          '[data-pt-agent-command-palette] [data-command-capability-id]'
        )].filter(element => !element.disabled).length;
        """
    )
    require(
        enabled_capabilities == 0,
        "unavailable command projection exposed a selectable capability",
    )
    runner.press_native_key(NativeKey.ESCAPE)
    restored = runner.harness(
        "setChatSuiteCommandProjectionState",
        {"agentId": agent_id, "state": "ready"},
    )
    require(
        restored.get("state") == "ready",
        f"ready command snapshot did not recover: {restored}",
    )
    return {
        "uiAction": (
            "open stale and unavailable command projections, then enter "
            "ordinary composer text"
        ),
        "receiverAssertion": (
            "capability actions are disabled while ordinary text send remains "
            "enabled and Station recovery restores the ready snapshot"
        ),
        "stale": stale,
        "unavailable": unavailable,
        "restored": restored,
        "operationIds": [
            "composer.command.stale-disables-capabilities",
            "composer.command.unavailable-disables-capabilities",
            "composer.command.text-chat-survives-stale",
        ],
    }


def command_narrow(runner: AgentNativeJourney) -> dict[str, Any]:
    runner.driver.set_window_size(420, 800)
    try:
        runner.click_visible(
            "[data-pt-agent-composer-slash]",
            "open narrow Commands and Skills",
        )
        runner.wait_visible_element(
            "[data-pt-agent-command-palette]",
            "narrow command palette",
        )
        geometry = runner.driver.execute_script(
            """
            const palette = [...document.querySelectorAll(
              '[data-pt-agent-command-palette]'
            )].find(element => element.getClientRects().length > 0);
            const rect = palette?.getBoundingClientRect();
            return rect ? {
              left: rect.left,
              right: rect.right,
              width: rect.width,
              viewportWidth: window.innerWidth,
              documentWidth: document.documentElement.scrollWidth,
            } : null;
            """
        )
        require(isinstance(geometry, dict), "narrow palette geometry is absent")
        require(
            geometry["left"] >= 0
            and geometry["right"] <= geometry["viewportWidth"]
            and geometry["width"] <= geometry["viewportWidth"]
            and geometry["documentWidth"] <= geometry["viewportWidth"],
            f"narrow palette overflowed the viewport: {geometry}",
        )
        runner.press_native_key(NativeKey.ESCAPE)
    finally:
        runner.driver.set_window_size(1440, 900)
        wait_until(
            lambda: (
                value
                if (value := runner.driver.execute_script(
                    "return {width: window.innerWidth, height: window.innerHeight};"
                ))["width"] >= 1200
                else None
            ),
            "wide Native window restoration",
        )
    return {
        "uiAction": "open Commands and Skills in a 420px Native window",
        "receiverAssertion": (
            "the palette remains inside the viewport without horizontal overflow"
        ),
        "geometry": geometry,
        "operationIds": ["composer.command.narrow-palette"],
    }


def historical_turn_attribution(
    runner: AgentNativeJourney,
    agent_id: str,
    skill_consumption: dict[str, Any],
    restart: Callable[[], None],
) -> dict[str, Any]:
    turn_evidence = skill_consumption.get("turnEvidence")
    require(isinstance(turn_evidence, dict), "Skill turn evidence is missing")
    diagnostics = turn_evidence.get("diagnostics")
    replay = diagnostics.get("replay") if isinstance(diagnostics, dict) else None
    turn_id = str(
        replay.get("turnId", replay.get("turn_id", ""))
        if isinstance(replay, dict)
        else ""
    )
    require(bool(turn_id), "historical Turn identity is missing")

    badge_selector = (
        f'[data-turn-attribution-turn-id="{turn_id}"] '
        '[data-attribution-kind="skill"]'
    )
    runner.wait_visible_element(
        badge_selector,
        "historical Skill attribution badge",
    )
    runner.click_visible(badge_selector, "open historical Skill attribution")
    detail = runner.wait_visible_element(
        f'[data-turn-attribution-turn-id="{turn_id}"] '
        '[data-attribution-detail-kind="skill"]',
        "historical Skill attribution detail",
    )
    detail_text = detail["text"]
    skill = skill_consumption["skill"]
    require(
        str(skill["version"]) in detail_text,
        "historical Skill version is absent",
    )
    require(
        skill["content"] not in runner.driver.page_source,
        "ordinary Chat leaked the Skill body",
    )
    removal = skill_consumption.get("removal")
    require(
        isinstance(removal, dict)
        and removal.get("receiverAssertion"),
        "current Skill binding removal was not proven",
    )

    restart()
    runner.harness("navigateToAgent", timeout=120)
    runner.select_agent_chat(agent_id)
    restored_badge_selector = (
        f'[data-turn-attribution-turn-id="{turn_id}"] '
        '[data-attribution-kind="skill"]'
    )
    runner.wait_visible_element(
        restored_badge_selector,
        "restored historical Skill attribution",
        timeout=120,
    )
    runner.click_visible(
        restored_badge_selector,
        "reopen restored historical Skill attribution",
    )
    restored_detail = runner.wait_visible_element(
        f'[data-turn-attribution-turn-id="{turn_id}"] '
        '[data-attribution-detail-kind="skill"]',
        "restored historical Skill attribution detail",
    )
    require(
        str(skill["version"]) in restored_detail["text"],
        "restart rewrote historical Skill attribution",
    )
    return {
        "uiAction": (
            "open Turn sources after Skill use, remove the current binding, "
            "restart, and reopen the same Turn"
        ),
        "receiverAssertion": (
            "the compact Skill badge and exact historical version survive "
            "binding removal and Native restart"
        ),
        "turnId": turn_id,
        "skillCapabilityId": skill["capabilityId"],
        "skillVersion": skill["version"],
        "detailText": detail_text,
        "restoredDetailText": restored_detail["text"],
        "operationIds": [
            "turn.attribution.compact-badges",
            "turn.attribution.detail-included",
            "turn.attribution.detail-omitted",
            "turn.attribution.detail-truncated",
            "turn.attribution.version-pinned",
            "turn.attribution.current-binding-does-not-rewrite-history",
        ],
    }
