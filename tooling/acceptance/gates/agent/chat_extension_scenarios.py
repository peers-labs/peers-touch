"""Real bounded Profile capability picker and binding lifecycle."""

from __future__ import annotations

import json
from typing import Any

from selenium.webdriver.common.by import By

from tooling.acceptance.gates.agent.chat_identity_scenarios import click_text
from tooling.acceptance.gates.agent.native_agent_runner import (
    AgentNativeJourney, REPO_ROOT, require, wait_until,
)


def extensions(runner: AgentNativeJourney, agent_id: str) -> dict[str, Any]:
    labels = json.loads((REPO_ROOT / "packages/locales/en/agent.json").read_text())

    def inventory() -> dict[str, Any]:
        return runner.harness("getChatSuiteCapabilityInventory", {"agentId": agent_id})

    baseline = inventory()
    require(not baseline["bindings"], "new Agent unexpectedly has capability bindings")
    click_text(runner, '[data-pt-agent-profile-editor] [role="tab"]',
               labels["agent.profile.tab.extensions"])
    require(not runner.driver.execute_script(
        "return Boolean(document.querySelector('[data-pt-agent-extension]'))"
    ), "unbound catalogue rendered as Profile extensions")
    readbacks = {}
    for kind, source_kind in (
        ("skill", 4),
        ("mcp", 2),
    ):
        candidates = [
            manifest for manifest in baseline["manifests"]
            if manifest["sourceKind"] == source_kind
            and not manifest.get("retiredAt")
            and manifest["availability"] in (1, 2)
        ]
        require(bool(candidates), f"Suite catalogue has no available {kind} capability")
        runner.click_visible(
            f'button[data-pt-agent-extension-add="{kind}"]',
            f"open {kind} picker",
        )
        modal = runner.wait_visible_element(".ant-modal", f"{kind} picker")
        rows = runner.driver.execute_script(
            """
            const modal = [...document.querySelectorAll('.ant-modal')]
              .find(element => element.getClientRects().length);
            return [...modal.querySelectorAll('button')]
              .filter(element => element.querySelector('strong')).length;
            """
        )
        require(0 < rows <= 12, "capability picker is not bounded")
        chosen = runner.driver.execute_script(
            """
            const modal = [...document.querySelectorAll('.ant-modal')]
              .find(element => element.getClientRects().length);
            const button = [...modal.querySelectorAll('button')]
              .find(element => element.querySelector('strong'));
            const name = button?.querySelector('strong')?.innerText;
            button?.click();
            return name;
            """
        )
        require(bool(chosen), f"{kind} picker had no selectable row")
        manifest = next(
            item for item in candidates
            if (item.get("displayMetadata", {}).get("name", "").strip()
                or item.get("sourceInstanceId", "").strip()
                or item["capabilityId"]) == chosen
        )
        capability_id = manifest["capabilityId"]
        row_selector = f'[data-pt-agent-extension="{capability_id}"]'
        runner.wait_visible_element(row_selector, f"bound {kind} row")
        wait_until(
            lambda: runner.visible_element_state(".ant-modal") is None,
            "capability picker unmount",
        )

        def binding(enabled: bool) -> dict[str, Any] | None:
            return next((
                item for item in inventory()["bindings"]
                if item["capabilityId"] == capability_id
                and not item.get("tombstonedAt")
                and item["enabled"] is enabled
            ), None)

        accepted = wait_until(lambda: binding(True), f"{kind} Station binding")
        if kind == "skill":
            runner.click_visible(f'{row_selector} [role="switch"]', "disable bound skill")
            disabled = wait_until(lambda: binding(False), "disabled skill authority")
            require(
                runner.driver.find_element(By.CSS_SELECTOR, f'{row_selector} [role="switch"]')
                .get_attribute("aria-checked") == "false",
                "disabled skill not projected",
            )
            runner.click_visible(f'{row_selector} [role="switch"]', "enable bound skill")
            wait_until(lambda: binding(True), "enabled skill authority")
            runner.click_visible(
                f'{row_selector} button[data-pt-agent-extension-remove="{capability_id}"]',
                "remove bound skill",
            )
            wait_until(
                lambda: runner.visible_element_state(row_selector) is None,
                "removed skill row",
            )
            removed = inventory()
            require(not any(
                item["capabilityId"] == capability_id and not item.get("tombstonedAt")
                for item in removed["bindings"]
            ), "skill removal did not reach authority")
            readbacks[kind] = {
                "accepted": accepted, "disabled": disabled, "removed": removed["bindings"],
            }
        else:
            runner.click_visible(
                f'{row_selector} button[data-pt-agent-extension-remove="{capability_id}"]',
                "remove bound MCP after evidence capture",
            )
            wait_until(
                lambda: runner.visible_element_state(row_selector) is None,
                "removed MCP row",
            )
            removed = inventory()
            require(not any(
                item["capabilityId"] == capability_id and not item.get("tombstonedAt")
                for item in removed["bindings"]
            ), "MCP reset did not reach authority")
            readbacks[kind] = {
                "accepted": accepted,
                "reset": removed["bindings"],
            }
        readbacks[kind]["picker"] = modal
        readbacks[kind]["initialRowCount"] = rows
    click_text(runner, '[data-pt-agent-profile-editor] [role="tab"]',
               labels["agent.profile.section.identity"])
    return {
        "uiAction": "open bounded Skills and MCP pickers, bind, toggle and remove skill",
        "receiverAssertion": "only bound rows render; switch and removal project authority; pickers unmount",
        "bindings": readbacks,
        "operationIds": [
            "profile.extensions.skill-bind", "profile.extensions.skill-toggle",
            "profile.extensions.skill-remove", "profile.extensions.mcp-bind",
            "profile.extensions.picker-unmount",
        ],
    }
