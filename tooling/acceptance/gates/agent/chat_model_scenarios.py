"""Topic-owned composite model selection through the Native composer."""

from __future__ import annotations

import json
from typing import Any

from selenium.webdriver.common.by import By

from tooling.acceptance.drivers.native import NativeKey, NativeModifier
from tooling.acceptance.gates.agent.chat_topic_scenarios import select_topic
from tooling.acceptance.gates.agent.native_agent_runner import (
    AgentNativeJourney, REPO_ROOT, model_capability_config, require, wait_until,
)


def selection(runner: AgentNativeJourney) -> dict[str, str] | None:
    return runner.driver.execute_script(
        """
        const selected = document.querySelector(
          '[data-pt-agent-composer] [data-pt-agent-selected-provider]');
        return selected ? {providerId: selected.dataset.ptAgentSelectedProvider,
                           modelId: selected.dataset.ptAgentSelectedModel} : null;
        """
    )


def open_picker(runner: AgentNativeJourney) -> str:
    labels = json.loads((REPO_ROOT / "packages/locales/en/chat.json").read_text())
    search = f'.ant-dropdown input[placeholder="{labels["chat.model.search"]}"]'
    trigger = "[data-pt-agent-composer] [data-pt-agent-model-picker]"
    runner.wait_visible_element(trigger, "composer model picker")
    if not runner.driver.execute_script(
        "return document.querySelector(arguments[0])"
        "?.classList.contains('ant-dropdown-open') === true;",
        trigger,
    ):
        runner.click_visible(trigger, "open composer model picker")

    wait_until(
        lambda: (
            runner.visible_element_state(search)
            if runner.driver.execute_script(
                "return document.querySelector(arguments[0])"
                "?.classList.contains('ant-dropdown-open') === true;",
                trigger,
            )
            else None
        ),
        "open model Provider tree",
    )
    return search


def select_model(runner: AgentNativeJourney, model: dict[str, str]) -> None:
    search = open_picker(runner)
    runner.set_input_value(
        search,
        model["displayName"],
        "Topic override model search",
    )
    runner.click_visible(
        f'.ant-dropdown-menu [title="{model["displayName"]}"]', "Topic override model",
    )
    wait_until(
        lambda: selection(runner) == {
            "providerId": model["providerId"], "modelId": model["modelId"],
        }, "composite model visible selection",
    )


def settings_section(runner: AgentNativeJourney, section: str) -> None:
    runner.click_primary_navigation("settings", "global Settings")
    runner.click_visible('[data-pt-secondary-tab="ai"]', "AI Settings")
    runner.click_visible(f'[data-pt-section-item="{section}"]', f"{section} Settings")


def select_provider_settings(
    runner: AgentNativeJourney,
    provider_id: str,
    description: str,
) -> None:
    labels = json.loads((REPO_ROOT / "packages/locales/en/provider.json").read_text())
    runner.set_input_value(
        f'input[placeholder="{labels["provider.menu.searchPlaceholder"]}"]',
        provider_id,
        f"{description} search",
    )
    runner.click_visible(f'[data-item-id="{provider_id}"]', description)


def settings_default(
    runner: AgentNativeJourney, agent_id: str, fixture: dict[str, str],
) -> dict[str, Any]:
    settings_section(runner, "models")
    require(runner.driver.execute_script(
        """
        return [...document.querySelectorAll('.pt-model-service-default-select')]
          .filter(element => element.getClientRects().length).length;
        """
    ) == 1, "Models Settings exposes more than the global default selector")
    runner.click_visible(
        ".pt-model-service-default-select",
        "Settings default model",
        pointer_sequence=True,
    )
    runner.driver.find_element(
        By.CSS_SELECTOR,
        ".pt-model-service-default-select input",
    ).send_keys(fixture["displayName"])
    runner.click_visible(
        (
            ".pt-model-select-option"
            f'[data-pt-model-provider="{fixture["providerId"]}"]'
            f'[data-pt-model-id="{fixture["modelId"]}"]'
        ),
        "Suite model in Settings default choices",
    )
    expected = {"provider": fixture["providerId"], "model": fixture["modelId"]}
    accepted = wait_until(lambda: (
        value if (value := runner.invoke_readback_command(
            "model_config_get", {"key": "default"},
        )).get("ref") == expected else None
    ), "Settings default persisted composite reference")
    runner.click_primary_navigation("agent", "Agent workspace")
    runner.select_agent_chat(agent_id)
    runner.click_visible("[data-pt-agent-session-start]", "new default Topic")
    wait_until(lambda: selection(runner) == {
        "providerId": fixture["providerId"], "modelId": fixture["modelId"],
    }, "new Topic projects Settings default")
    return {
        "uiAction": "open global Models Settings, choose default and create a new Topic",
        "receiverAssertion": "one Settings selector owns the default shown by the new composer",
        "stationReadback": accepted,
        "operationIds": ["settings.models.default-only", "composer.settings-default-model"],
    }


def topic_isolation(
    runner: AgentNativeJourney,
    agent_id: str,
    ids: list[str],
    fixture: dict[str, str],
) -> dict[str, Any]:
    """Same model IDs under different Providers must never resolve by ID alone."""
    marker = runner.runtime_manifest["runId"]
    fixture_key = runner.minimum_provider_fixture.api_key
    original_provider = runner.invoke_readback_command(
        "provider_get", {"id": fixture["providerId"]},
    )
    sibling_name = f"Composite sibling {marker}"
    created = runner.invoke_readback_command("provider_create", {
        "id": f"composite-sibling-{marker.lower()}",
        "name": sibling_name, "description": "Suite-owned composite receiver",
        "logo": "", "key_vaults": json.dumps({"api_key": fixture_key}),
        "config_json": json.dumps({"base_url": original_provider["provider"]["base_url"]}),
        "runtime_kind": "direct", "protocol": "openai",
    })
    sibling_id = created["provider"]["id"]
    runner.chat_provider_fixture_ids.append(sibling_id)
    sibling = {
        "providerId": sibling_id, "modelId": fixture["modelId"],
        "displayName": f"Sibling receiver {marker}",
    }
    runner.invoke_readback_command("model_add", {
        "provider_id": sibling_id,
        "data": {
            "id": sibling["modelId"], "display_name": sibling["displayName"],
            "enabled": True, "context_window": 8192,
            "capabilities": model_capability_config({"streaming": True}),
        },
    })
    runner.harness("reconcileChatSuiteModelProjection")
    before = runner.station_agent(agent_id)
    select_topic(runner, ids[0])
    search = open_picker(runner)
    require(
        runner.driver.execute_script(
            """
            return [...document.querySelectorAll('.ant-dropdown-menu-item-group-title')]
              .filter(element => element.getClientRects().length).length >= 2;
            """
        ), "composer has no grouped Provider tree",
    )
    runner.set_input_value(search, sibling["displayName"], "model name search")
    runner.wait_visible_element(
        f'.ant-dropdown-menu [title="{sibling["displayName"]}"]', "model search result",
    )
    require(
        runner.visible_element_state(
            f'.ant-dropdown-menu [title="{fixture["displayName"]}"]',
        ) is None,
        "model name search did not filter the unrelated model",
    )
    runner.click_visible(
        f'.ant-dropdown-menu [title="{sibling["displayName"]}"]', "choose sibling model",
    )
    wait_until(
        lambda: selection(runner) == {
            "providerId": sibling_id, "modelId": sibling["modelId"],
        }, "sibling composite override",
    )
    select_topic(runner, ids[1])
    select_model(runner, fixture)
    select_topic(runner, ids[0])
    require(selection(runner) == {
        "providerId": sibling_id, "modelId": sibling["modelId"],
    }, "Topic restoration chose another Provider sharing the model ID")
    request_count = len(runner.minimum_provider_fixture.snapshot())
    composer = runner.driver.find_element(By.CSS_SELECTOR, "[data-pt-agent-composer-input]")
    for modifier in (NativeModifier.SHIFT, NativeModifier.PRIMARY):
        runner.set_input_value("[data-pt-agent-composer-input]", "first", "keyboard draft")
        runner.press_native_key(
            NativeKey.ENTER,
            selector="[data-pt-agent-composer-input]",
            modifiers=(modifier,),
        )
        wait_until(
            lambda: composer.get_attribute("value") == "first\n",
            f"{modifier.value} Enter newline",
        )
        composer.send_keys("second")
        wait_until(
            lambda: composer.get_attribute("value") == "first\nsecond",
            f"{modifier.value} Enter draft continuation",
        )
    require(len(runner.minimum_provider_fixture.snapshot()) == request_count,
            "modified Enter sent a Provider request")
    runner.set_input_value("[data-pt-agent-composer-input]", "", "clear keyboard draft")
    persisted = {}
    for topic_id, expected_provider in ((ids[0], sibling_id), (ids[1], fixture["providerId"])):
        value = runner.invoke_readback_command(
            "agent_conversation_get", {"conversation_id": topic_id},
        )["conversation"]
        require(
            value["provider_id"] == expected_provider
            and value["model_name"] == fixture["modelId"],
            "Station did not persist Topic composite model override",
        )
        persisted[topic_id] = value
    after = runner.station_agent(agent_id)
    require(
        all(after.get(key) == before.get(key) for key in ("provider", "model")),
        "Topic model selection mutated Agent Profile",
    )
    return {
        "uiAction": "search grouped models, select identical model IDs under two Providers, switch Topics and insert modified Enter",
        "receiverAssertion": "each Topic restores its Provider/model pair and modified Enter remains an unsent multiline draft",
        "stationReadback": persisted,
        "operationIds": [
            "composer.provider-model-tree", "composer.provider-model-search",
            "composer.topic-model-override", "composer.topic-model-restore",
            "composer.modified-enter-newline", "topic.model.provider-id-isolation",
        ],
    }


def disable_recovery(
    runner: AgentNativeJourney, agent_id: str, fixture: dict[str, str],
) -> dict[str, Any]:
    """Availability changes must reach Settings, composer and real turn admission."""
    labels = json.loads((REPO_ROOT / "packages/locales/en/provider.json").read_text())
    provider_id = fixture["providerId"]
    runner.select_agent_chat(agent_id)
    runner.click_visible("[data-pt-agent-session-start]", "new availability Topic")
    select_model(runner, fixture)
    topic_id = runner.runtime_snapshot()["currentSessionKey"]
    observations = {}

    def provider_settings() -> None:
        settings_section(runner, "providers")
        select_provider_settings(runner, provider_id, "fixture Provider")

    def toggle_model() -> None:
        runner.click_visible(
            (
                f'[data-pt-provider-model-provider="{provider_id}"]'
                f'[data-pt-provider-model-toggle="{fixture["modelId"]}"]'
            ),
            "fixture model switch",
        )

    def toggle_provider(enabled: bool) -> None:
        runner.click_visible(
            f'[data-pt-provider-enabled-toggle="{provider_id}"]',
            "Provider enable switch",
        )
        if enabled:
            wait_until(
                lambda: runner.invoke_readback_command(
                    "provider_get", {"id": provider_id},
                )["provider"]["enabled"] is True,
                "Provider enable decision",
                timeout=15,
            )
            return
        outcome = wait_until(
            lambda: (
                "confirm"
                if runner.visible_element_state(".ant-modal-confirm")
                is not None
                else (
                    "disabled"
                    if runner.invoke_readback_command(
                        "provider_get", {"id": provider_id},
                    )["provider"]["enabled"] is False
                    else None
                )
            ),
            "Provider disable decision",
            timeout=15,
        )
        if outcome == "confirm":
            from tooling.acceptance.gates.agent.chat_identity_scenarios import click_text
            click_text(runner, ".ant-modal-confirm button", labels["provider.detail.disableConfirm.ok"])

    def assert_removed(kind: str) -> None:
        runner.click_primary_navigation("agent", "return to Chat")
        runner.select_agent_chat(agent_id)
        select_topic(runner, topic_id)
        wait_until(lambda: selection(runner) != {
            "providerId": provider_id, "modelId": fixture["modelId"],
        }, f"{kind} disabled selection falls back")
        open_picker(runner)
        require(runner.visible_element_state(
            f'.ant-dropdown-menu [title="{fixture["displayName"]}"]',
        ) is None, f"disabled {kind} remains selectable")
        runner.press_native_key(NativeKey.ESCAPE)
        observations[kind] = {
            "selection": selection(runner),
            "enabled": runner.invoke_readback_command(
                "provider_get", {"id": provider_id},
            )["provider"]["enabled"],
        }

    provider_settings()
    toggle_model()
    wait_until(lambda: next(
        item for item in runner.invoke_readback_command(
            "provider_get", {"id": provider_id},
        )["provider"]["models"] if item["id"] == fixture["modelId"]
    )["enabled"] is False, "disabled model authority")
    assert_removed("model")
    provider_settings()
    toggle_model()
    wait_until(lambda: next(
        item for item in runner.invoke_readback_command(
            "provider_get", {"id": provider_id},
        )["provider"]["models"] if item["id"] == fixture["modelId"]
    )["enabled"] is True, "restored model authority")
    runner.harness("reconcileChatSuiteModelProjection")
    runner.click_primary_navigation("agent", "restore Chat")
    runner.select_agent_chat(agent_id)
    select_topic(runner, topic_id)
    select_model(runner, fixture)
    provider_settings()
    toggle_provider(False)
    wait_until(lambda: runner.invoke_readback_command(
        "provider_get", {"id": provider_id},
    )["provider"]["enabled"] is False, "disabled Provider authority", timeout=30)
    assert_removed("provider")
    provider_settings()
    toggle_provider(True)
    wait_until(lambda: runner.invoke_readback_command(
        "provider_get", {"id": provider_id},
    )["provider"]["enabled"] is True, "restored Provider authority")
    runner.harness("reconcileChatSuiteModelProjection")
    runner.click_primary_navigation("agent", "restored Chat")
    runner.select_agent_chat(agent_id)
    select_topic(runner, topic_id)
    select_model(runner, fixture)
    return {
        "uiAction": "disable and restore model and Provider through Settings switches",
        "receiverAssertion": "disabled selections fall back and leave the picker; restored pair is selectable",
        "availability": observations,
        "operationIds": [
            "settings.provider.enabled-projection", "settings.model.enabled-projection",
        ],
    }
