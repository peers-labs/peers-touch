"""Real Profile UI actions with independent Station readback."""

from __future__ import annotations

import json

from typing import Any

from tooling.acceptance.gates.agent.native_agent_runner import (
    AgentNativeJourney,
    model_capability_config,
    require,
    wait_until,
)


def create_profile(runner: AgentNativeJourney) -> dict[str, Any]:
    baseline = runner.station_agent_roster()
    baseline_ids = {agent["id"] for agent in baseline["agents"]}
    runner.click_visible("[data-pt-agent-create]", "Create Agent")
    profile = wait_until(runner.selected_profile, "created Profile")
    agent_id = profile["agentId"]
    require(agent_id not in baseline_ids, "creation reopened an existing Agent")
    runner.lifecycle_fixture_ids.append(agent_id)
    roster = wait_until(
        lambda: (
            value if len((value := runner.station_agent_roster())["agents"])
            == len(baseline_ids) + 1 else None
        ),
        "one new Station Agent",
    )
    require(
        sum(agent["id"] == agent_id for agent in roster["agents"]) == 1,
        "creation did not persist exactly one Agent",
    )
    require(
        not runner.driver.execute_script(
            """
            const profile = document.querySelector('[data-pt-agent-profile]');
            return Boolean(profile?.querySelector(
              '[data-pt-model-picker], [data-pt-agent-profile-model], select'
            ));
            """
        ),
        "Profile still exposes ordinary Chat model configuration",
    )
    title = f"Profile {runner.runtime_manifest['runId']}"
    runner.set_input_value(
        f'[data-pt-agent-profile-title="{agent_id}"]', title, "Profile title",
    )
    identity = wait_until(
        lambda: (
            value if (value := runner.station_agent(agent_id)).get("title") == title
            else None
        ),
        "Profile title Station autosave",
    )
    require(
        runner.driver.execute_script(
            "return document.querySelector(arguments[0])?.value",
            f'[data-pt-agent-profile-title="{agent_id}"]',
        ) == title,
        "saved title is not visible in Profile",
    )
    return {
        "agentId": agent_id,
        "uiAction": "Create Agent",
        "receiverAssertion": "new Agent Profile visible without model controls",
        "stationReadback": roster,
        "identityReadback": identity,
    }


def edit_documents(
    runner: AgentNativeJourney,
    agent_id: str,
) -> dict[str, Any]:
    marker = str(runner.runtime_manifest["runId"])
    expected = {
        "soulMd": f"SOUL acceptance {marker}: respond precisely.",
        "agentsMd": f"AGENTS acceptance {marker}: preserve user intent.",
    }
    for key, label in (("soulMd", "SOUL.md"), ("agentsMd", "AGENTS.md")):
        runner.set_input_value(
            f'textarea[aria-label="{label}"]', expected[key], label,
        )
        wait_until(
            lambda: (
                value
                if (value := runner.station_agent(agent_id)).get(key) == expected[key]
                else None
            ),
            f"{label} Station autosave",
        )
    persisted = runner.station_agent(agent_id)
    require(
        all(persisted.get(key) == value for key, value in expected.items()),
        "document save overwrote a sibling document",
    )
    runner.click_visible("[data-pt-agent-profile-back]", "Profile Back")
    runner.click_agent_action(agent_id, "edit")
    values = runner.driver.execute_script(
        """
        return Object.fromEntries(['SOUL.md', 'AGENTS.md'].map(label =>
          [label, document.querySelector(`textarea[aria-label="${label}"]`)?.value]
        ));
        """
    )
    require(
        values == {"SOUL.md": expected["soulMd"], "AGENTS.md": expected["agentsMd"]},
        "reopened Profile did not project Station documents",
    )
    empty = {}
    for key, label in (("soulMd", "SOUL.md"), ("agentsMd", "AGENTS.md")):
        empty[key] = empty_document(runner, agent_id, key=key, label=label)
        runner.set_input_value(
            f'textarea[aria-label="{label}"]', expected[key], f"restore {label}",
        )
        wait_until(
            lambda key=key: runner.station_agent(agent_id).get(key) == expected[key],
            f"restored {label} authority",
        )
    return {
        "agentId": agent_id,
        "expectedDocuments": expected,
        "uiAction": "edit and blur SOUL.md and AGENTS.md, return and reopen Profile",
        "receiverAssertion": "both reopened editors display the accepted documents",
        "stationReadback": persisted,
        "editorValues": values,
        "explicitEmpty": empty,
    }


def prepare_prompt_fixture(runner: AgentNativeJourney) -> dict[str, str]:
    """Suite setup only: configure a namespaced real Direct endpoint."""
    from tooling.acceptance.gates.agent.governed_tool_development import (
        OpenAIProviderFixture,
        RemoteProviderBridge,
    )

    marker = str(runner.runtime_manifest["runId"])
    expected = {
        "soulMd": f"SOUL acceptance {marker}: respond precisely.",
        "agentsMd": f"AGENTS acceptance {marker}: preserve user intent.",
    }
    runner.minimum_provider_fixture = OpenAIProviderFixture(
        terminal_only=True,
        expected_system_documents=expected,
        terminal_content=f"Profile prompt accepted {marker}",
    )
    runner.minimum_provider_fixture.start()
    runner.minimum_provider_bridge = RemoteProviderBridge(
        runner.profile_env["PT_STATION_DEPLOY_ENV"],
        artifact_prefix="agent-chat-prompt",
    )
    endpoint = runner.minimum_provider_bridge.start(
        runner.minimum_provider_fixture.port, marker,
    )
    created = runner.invoke_readback_command("provider_create", {
        "id": f"profile-fixture-{marker.lower()}",
        "name": f"Profile fixture {marker}",
        "description": "Suite-owned prompt receiver",
        "logo": "",
        "key_vaults": json.dumps({"api_key": runner.minimum_provider_fixture.api_key}),
        "config_json": json.dumps({"base_url": endpoint}),
        "runtime_kind": "direct",
        "protocol": "openai",
    })
    provider_id = str(created["provider"]["id"])
    runner.cli_provider_fixture = {"providerId": provider_id}
    runner.invoke_readback_command("model_add", {
        "provider_id": provider_id,
        "data": {
            "id": "profile-prompt", "display_name": f"Prompt receiver {marker}",
            "enabled": True,
            "context_window": 8192,
            "capabilities": model_capability_config({
                "streaming": True,
                "native-tools": True,
                "image-input": False,
            }),
        },
    })
    return {
        "providerId": provider_id,
        "modelId": "profile-prompt",
        "displayName": f"Prompt receiver {marker}",
    }


def consume_documents(
    runner: AgentNativeJourney,
    agent_id: str,
    fixture: dict[str, str],
) -> dict[str, Any]:
    from tooling.acceptance.drivers.native import NativeKey

    expected = runner.station_agent(agent_id)
    runner.click_visible("[data-pt-agent-profile-back]", "Profile Back")
    runner.select_agent_chat(agent_id)
    reconciled = runner.harness("reconcileChatSuiteModelProjection")
    require(
        isinstance(reconciled, dict),
        f"Suite-owned model projection returned invalid evidence: {reconciled}",
    )
    expected_model = {
        "providerId": fixture["providerId"],
        "modelId": fixture["modelId"],
        "enabled": True,
    }
    authority_models = reconciled.get("authorityModels")
    store_models = reconciled.get("storeModels")
    require(
        isinstance(authority_models, list) and expected_model in authority_models,
        "Suite-owned model is absent from Station authority: "
        + json.dumps(reconciled, sort_keys=True),
    )
    require(
        reconciled.get("reconciled") is True
        and reconciled.get("storeError") is None,
        "Desktop model projection failed to reconcile: "
        + json.dumps(reconciled, sort_keys=True),
    )
    require(
        isinstance(store_models, list) and expected_model in store_models,
        "Suite-owned model is absent from the Desktop store: "
        + json.dumps(reconciled, sort_keys=True),
    )
    runner.click_visible("[data-pt-agent-session-start]", "New Topic")
    # The composer model button is the button containing the model title.
    runner.wait_visible_element("[data-pt-agent-composer]", "composer")
    opened = runner.driver.execute_script(
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
        const composer = [...document.querySelectorAll('[data-pt-agent-composer]')]
          .find(isViewportVisible);
        const button = [...composer.querySelectorAll(
          '[data-pt-agent-model-picker]',
        )].find(isViewportVisible);
        button?.click();
        return Boolean(button);
        """
    )
    require(opened, "composer model picker is unavailable")
    model_selector = (
        f'[data-pt-agent-model-provider="{fixture["providerId"]}"]'
        f'[data-pt-agent-model-id="{fixture["modelId"]}"]'
    )
    wait_until(
        lambda: runner.driver.execute_script(
            """
            const [providerId, modelId] = arguments;
            const target = [
              ...document.querySelectorAll(
                '[data-pt-agent-model-provider][data-pt-agent-model-id]',
              ),
            ].find(candidate =>
              candidate.dataset.ptAgentModelProvider === providerId
              && candidate.dataset.ptAgentModelId === modelId);
            target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            return Boolean(target);
            """,
            fixture["providerId"],
            fixture["modelId"],
        ),
        "Suite-owned composite model menu item",
        timeout=10,
    )
    runner.wait_visible_element(
        model_selector,
        "reconciled Suite-owned model catalogue",
        timeout=10,
    )
    runner.click_visible(
        model_selector,
        "Topic prompt receiver model",
    )
    wait_until(
        lambda: runner.driver.execute_script(
            """
            const selection = [
              ...document.querySelectorAll(
                '[data-pt-agent-composer] [data-pt-agent-selected-provider]',
              ),
            ].find(element => {
              const rect = element.getBoundingClientRect();
              return element.getClientRects().length > 0
                && rect.right > 0
                && rect.bottom > 0
                && rect.left < window.innerWidth
                && rect.top < window.innerHeight;
            });
            return selection?.dataset.ptAgentSelectedProvider === arguments[0]
              && selection?.dataset.ptAgentSelectedModel === arguments[1];
            """, fixture["providerId"], fixture["modelId"],
        ),
        "Topic model visible selection",
    )
    marker = str(runner.runtime_manifest["runId"])
    prompt = f"Verify Profile documents {marker}"
    runner.set_input_value(
        "[data-pt-agent-composer-input]",
        prompt,
        "Profile prompt",
    )
    wait_until(
        lambda: runner.driver.execute_script(
            """
            return [...document.querySelectorAll(arguments[0])]
              .find(element => {
                const rect = element.getBoundingClientRect();
                return element.getClientRects().length > 0
                  && rect.right > 0
                  && rect.bottom > 0
                  && rect.left < window.innerWidth
                  && rect.top < window.innerHeight;
              })?.value;
            """,
            "[data-pt-agent-composer-input]",
        ) == prompt,
        "Profile prompt committed to the Composer",
    )
    runner.press_native_key(
        NativeKey.ENTER,
        selector="[data-pt-agent-composer-input]",
    )
    response = f"Profile prompt accepted {marker}"
    def visible_messages() -> str:
        return runner.driver.execute_script(
            """
            return [...document.querySelectorAll('[data-pt-agent-message-id]')]
              .filter(element => {
                const rect = element.getBoundingClientRect();
                return element.getClientRects().length > 0
                  && rect.right > 0
                  && rect.bottom > 0
                  && rect.left < window.innerWidth
                  && rect.top < window.innerHeight;
              })
              .map(element => element.innerText).join('\\n');
            """
        )

    def response_or_terminal_failure() -> str | None:
        text = visible_messages()
        if response in text:
            return text
        terminal = runner.driver.execute_script(
            """
            const element = [...document.querySelectorAll('[data-pt-agent-error-type]')]
              .filter(candidate => {
                const rect = candidate.getBoundingClientRect();
                return candidate.getClientRects().length > 0
                  && rect.right > 0
                  && rect.bottom > 0
                  && rect.left < window.innerWidth
                  && rect.top < window.innerHeight;
              })
              .at(-1);
            return element ? {
              errorType: element.dataset.ptAgentErrorType ?? '',
              text: element.innerText,
            } : null;
            """
        )
        if terminal:
            raise RuntimeError(
                "Provider turn reached a terminal error: "
                + json.dumps(terminal, sort_keys=True)
            )
        return None

    try:
        receiver = wait_until(
            response_or_terminal_failure,
            "Provider reply visible in conversation",
            timeout=30,
        )
    except Exception as error:
        runtime = runner.runtime_snapshot()
        conversation_id = str(runtime.get("currentSessionKey") or "")
        try:
            conversation = (
                runner.conversation_readback(conversation_id)
                if conversation_id and not conversation_id.startswith("draft:")
                else None
            )
        except Exception as readback_error:
            conversation = {
                "readbackError": f"{type(readback_error).__name__}: {readback_error}",
            }
        raise type(error)(
            f"{error}; diagnostics={json.dumps({
                'messages': visible_messages(),
                'providerRequests': runner.minimum_provider_fixture.snapshot(),
                'runtime': runtime,
                'conversation': conversation,
                'composer': runner.driver.execute_script(
                    """
                    const input = document.querySelector('[data-pt-agent-composer-input]');
                    const blocked = document.querySelector('[data-pt-agent-readiness-blocking]');
                    return {
                      value: input?.value ?? null,
                      disabled: input?.disabled ?? null,
                      blocked: blocked?.dataset.ptAgentReadinessBlocking ?? null,
                    };
                    """
                ),
            }, sort_keys=True, default=str)}"
        ) from error
    requests = runner.minimum_provider_fixture.snapshot()
    require(bool(requests), "Provider received no request")
    require(
        all(requests[0].get("systemDocuments", {}).get(key) is True
            for key in ("soulMd", "agentsMd")),
        "Provider did not receive both Profile documents as system instructions",
    )
    require(
        all(runner.station_agent(agent_id).get(key) == expected.get(key)
            for key in ("soulMd", "agentsMd")),
        "sending a Topic changed Profile documents",
    )
    return {
        "uiAction": "select Topic model and send with Enter",
        "receiverAssertion": "actual Provider response visible in conversation",
        "receiverText": receiver,
        "providerRequests": requests,
        "stationReadback": expected,
    }


def empty_document(
    runner: AgentNativeJourney,
    agent_id: str,
    *,
    key: str = "soulMd",
    label: str = "SOUL.md",
) -> dict[str, Any]:
    sibling = "agentsMd" if key == "soulMd" else "soulMd"
    previous = runner.station_agent(agent_id)
    runner.set_input_value(f'textarea[aria-label="{label}"]', "", f"clear {label}")
    persisted = wait_until(
        lambda: (
            value if (value := runner.station_agent(agent_id)).get(key) == ""
            else None
        ),
        f"explicit empty {label} Station readback",
    )
    require(
        persisted.get(sibling) == previous.get(sibling),
        f"clearing {label} changed its sibling document",
    )
    require(
        runner.driver.execute_script(
            "return document.querySelector(arguments[0])?.value",
            f'textarea[aria-label="{label}"]',
        ) == "",
        f"explicit empty {label} is not visible in the editor",
    )
    return {
        "uiAction": f"clear {label} and blur",
        "receiverAssertion": f"{label} editor empty while sibling document remains",
        "stationReadback": persisted,
    }


def restart_documents(
    runner: AgentNativeJourney,
    agent_id: str,
) -> dict[str, Any]:
    empty_document(runner, agent_id)
    empty_document(runner, agent_id, key="agentsMd", label="AGENTS.md")
    expected = runner.station_agent(agent_id)
    persistence_before = runner.harness("getSessionPersistenceState")
    require(
        isinstance(persistence_before, dict)
        and persistence_before.get("activeAccountPresent") is True
        and persistence_before.get("accountHasSessionMetadata") is True
        and persistence_before.get("accountRequiresPin") is False
        and persistence_before.get("rawSessionPresent") is True
        and persistence_before.get("rawSessionActorMatches") is True
        and persistence_before.get("rawSessionSource") == "password",
        f"Native session is not restorable before restart: {persistence_before}",
    )
    runner.restart_native_runtime()
    navigation = runner.harness("navigateToAgent", timeout=120)
    require(
        isinstance(navigation, dict)
        and navigation.get("actorId") == runner.actor_ptid
        and navigation.get("identityState") == "ready",
        f"Native restart did not restore the authenticated Agent owner: {navigation}",
    )
    runner.select_agent_chat(agent_id)
    runner.click_agent_action(agent_id, "edit")
    runner.wait_visible_element(
        runner.lifecycle_selector("profile", agent_id=agent_id),
        "restored Agent Profile",
    )
    values = runner.driver.execute_script(
        """
        return Object.fromEntries(['SOUL.md', 'AGENTS.md'].map(label =>
          [label, document.querySelector(`textarea[aria-label="${label}"]`)?.value]
        ));
        """
    )
    require(
        values == {"SOUL.md": expected["soulMd"], "AGENTS.md": expected["agentsMd"]},
        "Native restart did not restore accepted documents",
    )
    persisted = runner.station_agent(agent_id)
    require(
        all(persisted.get(key) == expected.get(key) for key in ("soulMd", "agentsMd")),
        "restart changed Station document authority",
    )
    return {
        "uiAction": "restart Native Desktop, select Agent and open Profile",
        "receiverAssertion": "both document editors restore explicit empty values",
        "stationReadback": persisted,
        "editorValues": values,
        "identityReadback": navigation,
        "persistenceBeforeRestart": persistence_before,
    }
