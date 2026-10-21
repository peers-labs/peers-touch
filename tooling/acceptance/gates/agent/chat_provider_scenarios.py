"""Settings Provider journeys using production controls and safe readback."""

from __future__ import annotations

import json
from typing import Any

from tooling.acceptance.gates.agent.chat_identity_scenarios import click_text
from tooling.acceptance.gates.agent.chat_model_scenarios import (
    select_provider_settings,
    settings_section,
)
from tooling.acceptance.gates.agent.native_agent_runner import (
    AgentNativeJourney, REPO_ROOT, require, wait_until,
)


def toast_feedback(
    runner: AgentNativeJourney,
    text: str,
) -> dict[str, Any] | None:
    return runner.driver.execute_script(
        """
        const message = [...document.querySelectorAll(
          '[role="dialog"], [role="alertdialog"]')]
          .find(element => element.getClientRects().length
            && (element.textContent || '').trim() === arguments[0]);
        if (!message) return null;
        const rect = message.getBoundingClientRect();
        return {text: (message.textContent || '').trim(), x: rect.x, y: rect.y,
          width: rect.width, height: rect.height,
          viewportWidth: innerWidth, viewportHeight: innerHeight};
        """,
        text,
    )


def configuration(runner: AgentNativeJourney) -> dict[str, Any]:
    labels = json.loads((REPO_ROOT / "packages/locales/en/provider.json").read_text())
    settings_section(runner, "providers")
    usable = f'[role="switch"][aria-label="{labels["provider.menu.showUsableOnly"]}"]'
    default_enabled = runner.driver.execute_script(
        "return document.querySelector(arguments[0])?.getAttribute('aria-checked') === 'true';",
        usable,
    )
    require(default_enabled, "usable-only Provider filter does not default on")
    runner.click_visible(usable, "show all registered Providers")
    cli = wait_until(lambda: runner.driver.execute_script(
        """
        const rows = [...document.querySelectorAll('[data-item-id]')]
          .filter(row => row.getClientRects().length);
        const row = rows.find(row => row.dataset.itemId === 'trae-cli');
        return row ? {id: row.dataset.itemId, text: row.innerText} : null;
        """
    ), "registered CLI Provider in mixed list")
    require(runner.driver.execute_script(
        """
        return [...document.querySelectorAll('[data-item-id]')]
          .filter(row => row.getClientRects().length)
          .some(row => row.innerText.includes('Direct'));
        """
    ), "Provider list does not mix Direct and CLI")
    runner.click_visible(
        f'button[title="{labels["provider.menu.addCustomProvider"]}"]', "Add Provider",
    )
    runner.wait_visible_element(
        ".ant-modal .pt-provider-kind-direct",
        "Direct kind choice",
    )
    runner.wait_visible_element(
        ".ant-modal .pt-provider-kind-cli",
        "CLI kind choice",
    )
    require(runner.driver.execute_script(
        "return Boolean(document.querySelector('.ant-modal input#api_key'));"
    ), "Direct creation schema omitted API credential field")
    runner.click_visible(
        ".ant-modal .pt-provider-kind-cli",
        "choose CLI kind",
    )
    wait_until(lambda: runner.driver.execute_script(
        """
        return !document.querySelector('.ant-modal input#api_key')
          && !document.querySelector('.ant-modal input#base_url')
          && Boolean(document.querySelector(
            '.ant-modal .pt-provider-cli-adapter-select'));
        """
    ), "exclusive CLI creation schema")
    runner.click_visible(
        ".ant-modal .pt-provider-cli-adapter-select",
        "registered CLI adapters",
        pointer_sequence=True,
    )
    click_text(
        runner,
        ".pt-provider-cli-adapter-option",
        cli["text"].splitlines()[0],
    )
    click_text(runner, ".ant-modal button", labels["provider.menu.configureBtn"])
    wait_until(lambda: runner.visible_element_state(
        f'[role="switch"][aria-label="{labels["provider.cli.enabled"]}"]',
    ), "selected CLI schema mounted")
    require(runner.driver.execute_script(
        """
        return !document.querySelector('input[placeholder="Please enter your API Key"]')
          && [...document.querySelectorAll('textarea')]
            .filter(element => element.getClientRects().length).length >= 2;
        """
    ), "CLI schema did not expose startup/environment fields exclusively")
    click_text(runner, 'button[aria-expanded]', labels["provider.cli.advanced"])
    advanced = wait_until(
        lambda: (
            values if len(values := runner.driver.execute_script(
                """
                return [...document.querySelectorAll('input[readonly]')]
                  .filter(element => element.getClientRects().length)
                  .map(element => element.value);
                """
            )) >= 2 and all(values) else None
        ),
        "populated read-only CLI command and workspace policy",
    )
    click_text(runner, 'button[aria-expanded]', labels["provider.cli.advanced"])
    wait_until(lambda: runner.driver.execute_script(
        """
        return [...document.querySelectorAll('input[readonly]')]
          .filter(element => element.getClientRects().length).length === 0;
        """
    ), "closed Advanced command fields")
    settings_section(runner, "models")
    settings_section(runner, "providers")
    require(runner.driver.execute_script(
        "return document.querySelector(arguments[0])?.getAttribute('aria-checked') === 'false';",
        usable,
    ), "Provider display preference did not survive Settings navigation")
    return {
        "uiAction": "change usable filter, choose registered CLI in Add Provider and inspect Advanced",
        "receiverAssertion": "mixed list persists preference and mounts only selected read-only CLI schema",
        "cliProviderId": cli["id"], "advancedValues": advanced,
        "operationIds": [
            "settings.provider-list.mixed", "settings.provider-create.kind-choice",
            "settings.provider-create.cli", "settings.provider-schema.selected-only",
            "settings.provider-cli.no-api-fields", "settings.provider-cli.registered-adapter",
            "settings.provider-cli.fields", "settings.provider-cli.advanced",
            "settings.provider-cli.no-command-editor", "settings.providers.usable-only.default",
            "settings.providers.usable-only.persisted",
        ],
    }


def create_direct(
    runner: AgentNativeJourney, fixture: dict[str, str],
) -> dict[str, Any]:
    labels = json.loads((REPO_ROOT / "packages/locales/en/provider.json").read_text())
    settings_section(runner, "providers")
    runner.click_visible(
        f'button[title="{labels["provider.menu.addCustomProvider"]}"]', "Add Direct Provider",
    )
    runner.wait_visible_element('.ant-modal input#id', "Direct provider ID")
    provider_id = f"chat-direct-{runner.runtime_manifest['runId'].lower()}"
    name = f"Native Direct {runner.runtime_manifest['runId']}"
    endpoint = runner.invoke_readback_command(
        "provider_get", {"id": fixture["providerId"]},
    )["provider"]["base_url"]
    for field, value in (
        ("id", provider_id), ("name", name), ("base_url", endpoint),
        ("api_key", runner.minimum_provider_fixture.api_key),
    ):
        runner.set_input_value(f".ant-modal input#{field}", value, f"Direct {field}")
    click_text(runner, ".ant-modal button", labels["provider.menu.createBtn"])
    runner.chat_provider_fixture_ids.append(provider_id)
    detail = wait_until(
        lambda: runner.invoke_readback_command(
            "provider_get",
            {"id": provider_id},
        )["provider"],
        "Station created Direct Provider",
    )
    runner.wait_visible_element(f'[data-item-id="{provider_id}"]', "created Direct row")
    require(runner.driver.execute_script(
        """
        return Boolean(document.querySelector(
          'input[placeholder="Please enter your API Key"]'))
          && ![...document.querySelectorAll('button[aria-expanded]')]
            .some(button => button.getClientRects().length
              && button.innerText.trim() === 'Advanced');
        """
    ), "created Direct provider did not mount its exclusive API schema")
    require(detail["id"] == provider_id and detail["name"] == name
            and detail["runtime_kind"] == "http" and detail["base_url"] == endpoint,
            "Direct form did not persist ID, display name and runtime endpoint")
    return {
        "uiAction": "create Direct Provider through Settings form",
        "receiverAssertion": "created row selects exclusive Direct schema and persists endpoint",
        "providerId": provider_id,
        "stationReadback": {
            "id": detail["id"], "runtimeKind": detail["runtime_kind"],
            "credentialPresent": bool(detail.get("api_key")),
        },
        "operationIds": ["settings.provider-create.direct"],
    }


def cli_discovery(runner: AgentNativeJourney, provider_id: str) -> dict[str, Any]:
    labels = json.loads((REPO_ROOT / "packages/locales/en/provider.json").read_text())
    settings_section(runner, "providers")
    select_provider_settings(runner, provider_id, "registered CLI Provider")
    before = runner.invoke_readback_command("provider_get", {"id": provider_id})["provider"]
    runner.chat_provider_restore.setdefault(provider_id, {
        "enabled": before["enabled"], "runtime_config": before["runtime_config"],
    })
    click_text(runner, "button", labels["provider.cli.restoreDefaults"])
    defaults = before["default_runtime_config"]
    editors = runner.driver.execute_script(
        """
        return [...document.querySelectorAll('textarea')]
          .filter(element => element.getClientRects().length).map(element => element.value);
        """
    )
    require(defaults["startup_args"] == (editors[0].splitlines() if editors[0] else []),
            "Restore defaults did not restore startup arguments")
    environment = "\n".join(
        f"{key}={value}" for key, value in sorted(defaults["environment"].items())
    )
    require(editors[1] == environment, "Restore defaults did not restore environment")
    click_text(runner, "button", labels["provider.cli.save"])
    wait_until(lambda: (
        value if (value := runner.invoke_readback_command(
            "provider_get", {"id": provider_id},
        ))["provider"]["runtime_config"] == defaults else None
    ), "Station persisted restored CLI configuration")
    saved_toast = wait_until(
        lambda: toast_feedback(runner, labels["provider.cli.saved"]),
        "CLI save feedback",
    )
    require(saved_toast["x"] > saved_toast["viewportWidth"] / 2
            and saved_toast["y"] > saved_toast["viewportHeight"] / 2,
            "CLI save feedback is not Shell bottom-right")
    click_text(runner, "button", labels["provider.cli.check"])
    wait_until(
        lambda: toast_feedback(runner, labels["provider.cli.ready"]),
        "Station CLI readiness feedback",
    )
    check = runner.invoke_readback_command("provider_check", {"id": provider_id})
    require(check.get("ok") is True, "registered CLI adapter is not ready on Station")
    click_text(runner, "button", labels["provider.cli.refreshModels"])
    discovered = wait_until(lambda: (
        value if (value := runner.invoke_readback_command(
            "provider_get", {"id": provider_id},
        ))["provider"]["models"] else None
    ), "Station-discovered CLI model catalog")
    models = discovered["provider"]["models"]
    require(runner.driver.execute_script(
        """
        const rows = [...document.querySelectorAll(
          '[data-ui-rows="cli-provider-models"] [data-ui-row]')];
        return rows.length > 0 && rows.every(row => !row.querySelector('button,input'));
        """
    ), "CLI model directory is absent or exposes manual CRUD")
    return {
        "uiAction": "restore and save CLI defaults, check Station readiness and refresh models",
        "receiverAssertion": "bottom-right save feedback, ready status and read-only discovered models",
        "stationReadback": {
            "providerId": provider_id, "ready": check["ok"],
            "modelIds": [model["id"] for model in models],
        },
        "saveToast": saved_toast,
        "operationIds": [
            "settings.provider-cli.check", "settings.provider-cli.restore",
            "settings.provider-cli.save-toast", "settings.feedback.bottom-right",
        ],
    }
