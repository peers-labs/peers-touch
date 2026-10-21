"""Roster actions observed through the real Native product surface."""

from __future__ import annotations

import json
from typing import Any

from tooling.acceptance.gates.agent.native_agent_runner import (
    AgentNativeJourney, REPO_ROOT, require, wait_until,
)


def prepare_roster(runner: AgentNativeJourney) -> dict[str, Any]:
    """Establish the protected row once, retaining all pre-existing Agents."""
    existing = next(
        (agent for agent in runner.station_agent_roster()["agents"]
         if agent["name"] == "assistant"),
        None,
    )
    if existing is not None:
        return {"agentId": existing["id"], "created": False}
    created = runner.invoke_readback_command("agents_create", {
        "data": {"name": "assistant", "description": ""},
    })
    runner.harness("reconcileChatSuiteRosterProjection")
    return {"agentId": created["id"], "created": True}


def roster(runner: AgentNativeJourney, agent_id: str) -> dict[str, Any]:
    labels = json.loads((REPO_ROOT / "packages/locales/en/agent.json").read_text())
    rail = '[data-pt-agent-rail="expanded"]'
    row = runner.lifecycle_selector("row", agent_id=agent_id)
    title = runner.station_agent(agent_id)["title"]
    runner.click_visible("[data-pt-agent-profile-back]", "return to Chat")
    runner.select_agent_chat(agent_id)
    runner.assert_visible(rail, True)
    search = f'{rail} input[placeholder="{labels["agent.sidebar.searchAgents"]}"]'
    runner.set_input_value(search, title, "search owned Agent")
    runner.wait_visible_element(row, "searched Agent")
    visible_ids = runner.driver.execute_script(
        """
        return [...document.querySelectorAll('[data-pt-agent-row]')]
          .filter(element => element.getClientRects().length)
          .map(element => element.dataset.ptAgentId);
        """
    )
    require(visible_ids == [agent_id], "Agent search did not isolate the named Agent")
    runner.set_input_value(search, "", "restore full roster")
    runner.click_visible(
        runner.lifecycle_selector("menu", agent_id=agent_id), "owned Agent menu",
    )
    edit = runner.lifecycle_selector("menu_action", action="edit", agent_id=agent_id)
    runner.wait_visible_element(edit, "Profile menu action")
    geometry = runner.driver.execute_script(
        """
        const isViewportVisible = (element) => {
          const rect = element.getBoundingClientRect();
          return element.getClientRects().length > 0
            && rect.width > 0
            && rect.height > 0
            && rect.right > 0
            && rect.bottom > 0
            && rect.left < window.innerWidth
            && rect.top < window.innerHeight;
        };
        const triggerElement = [...document.querySelectorAll(arguments[0])]
          .find(isViewportVisible);
        const actionElement = [...document.querySelectorAll(arguments[1])]
          .find(isViewportVisible);
        const menuElement = actionElement?.closest('.ant-dropdown');
        if (!triggerElement || !menuElement) return null;
        const trigger = triggerElement.getBoundingClientRect();
        const menu = menuElement.getBoundingClientRect();
        const horizontalGap = Math.max(
          0, trigger.left - menu.right, menu.left - trigger.right,
        );
        const verticalGap = Math.max(
          0, trigger.top - menu.bottom, menu.top - trigger.bottom,
        );
        return {trigger: {x: trigger.x, y: trigger.y, width: trigger.width,
                          height: trigger.height},
                menu: {x: menu.x, y: menu.y, width: menu.width, height: menu.height},
                horizontalGap, verticalGap};
        """, runner.lifecycle_selector("menu", agent_id=agent_id), edit,
    )
    require(
        isinstance(geometry, dict)
        and geometry.get("horizontalGap", 1000) <= 12
        and geometry.get("verticalGap", 1000) <= 12,
        f"Agent action menu is not anchored to its trigger: {geometry}",
    )
    require(
        runner.visible_element_state(runner.lifecycle_selector(
            "menu_action", action="delete", agent_id=agent_id,
        )) is not None,
        "owned Agent menu omits Delete",
    )
    runner.click_visible(edit, "open Profile from Agent menu")
    require(runner.selected_profile()["agentId"] == agent_id, "menu opened another Profile")
    runner.assert_visible(rail, True)
    runner.click_visible("[data-pt-agent-profile-back]", "return to owned Chat")
    protected = next(
        agent for agent in runner.station_agent_roster()["agents"]
        if agent["name"] == "assistant"
    )
    runner.click_visible(
        runner.lifecycle_selector("menu", agent_id=protected["id"]),
        "protected Assistant menu",
    )
    runner.wait_visible_element(
        runner.lifecycle_selector("menu_action", action="edit", agent_id=protected["id"]),
        "protected Assistant Profile action",
    )
    require(
        runner.visible_element_state(runner.lifecycle_selector(
            "menu_action", action="delete", agent_id=protected["id"],
        )) is None,
        "protected Assistant exposes Delete",
    )
    runner.select_agent_chat(agent_id)
    wait_until(
        lambda: runner.visible_element_state(
            runner.lifecycle_selector("composer"),
        ), "owned Agent Chat",
    )
    runner.click_agent_action(agent_id, "edit")
    return {
        "uiAction": "search Agent, switch to Chat, inspect anchored menus and open Profile",
        "receiverAssertion": "roster remains visible, matching Agent opens and protected Assistant has no Delete",
        "stationReadback": runner.station_agent(agent_id),
        "menuGeometry": geometry,
        "operationIds": [
            "agent.roster.persistent", "agent.search", "agent.row.switches-to-chat",
            "agent.menu.anchored", "agent.menu.profile",
            "agent.menu.delete-only-when-allowed",
        ],
    }
