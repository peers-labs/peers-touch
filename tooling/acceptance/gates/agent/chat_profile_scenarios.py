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
from tooling.acceptance.drivers.native.base import NativeKey, NativeModifier


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


def select_prompt_fixture_model(
    runner: AgentNativeJourney,
    fixture: dict[str, str],
    *,
    start_new_topic: bool,
) -> dict[str, Any]:
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
    if start_new_topic:
        runner.click_visible("[data-pt-agent-session-start]", "New Topic")
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
    runner.click_visible(model_selector, "Topic prompt receiver model")
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
            """,
            fixture["providerId"],
            fixture["modelId"],
        ),
        "Topic model visible selection",
    )
    return reconciled


def consume_documents(
    runner: AgentNativeJourney,
    agent_id: str,
    fixture: dict[str, str],
) -> dict[str, Any]:
    from tooling.acceptance.drivers.native import NativeKey

    expected = runner.station_agent(agent_id)
    runner.click_visible("[data-pt-agent-profile-back]", "Profile Back")
    runner.select_agent_chat(agent_id)
    select_prompt_fixture_model(
        runner,
        fixture,
        start_new_topic=True,
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


def consume_bound_skill(
    runner: AgentNativeJourney,
    agent_id: str,
    skill: dict[str, Any],
    fixture: dict[str, str],
) -> dict[str, Any]:
    """Prove the pinned Skill index, skill_view body, and ContextLedger refs."""
    from tooling.acceptance.drivers.native import NativeKey
    from tooling.acceptance.gates.agent.chat_extension_scenarios import (
        remove_retained_skill,
    )

    provider = runner.minimum_provider_fixture
    require(provider is not None, "Skill consumption requires the Suite Provider")
    select_prompt_fixture_model(
        runner,
        fixture,
        start_new_topic=True,
    )
    response = f"Bound Skill accepted {runner.runtime_manifest['runId']}"
    with provider.server.request_lock:
        prior_provider = {
            "terminalOnly": provider.server.terminal_only,
            "toolName": provider.server.tool_name,
            "toolArguments": dict(provider.server.tool_arguments),
            "expectedToolResult": provider.server.expected_tool_result,
            "terminalContent": provider.server.terminal_content,
            "expectedSystemDocuments": dict(
                provider.server.expected_system_documents
            ),
        }
        request_offset = len(provider.server.requests)
        provider.server.terminal_only = False
        provider.server.tool_name = "skill_view"
        provider.server.tool_arguments = {"name": skill["name"]}
        provider.server.expected_tool_result = skill["content"]
        provider.server.terminal_content = response
        provider.server.selected_tool_name = ""
        provider.server.expected_system_documents.update({
            "skillIndex": skill["name"],
            "skillBody": skill["content"],
        })

    prompt = f"Call skill_view for {skill['name']} and apply it."
    runner.set_input_value(
        "[data-pt-agent-composer-input]",
        prompt,
        "Skill activation prompt",
    )
    runner.press_native_key(
        NativeKey.ENTER,
        selector="[data-pt-agent-composer-input]",
    )

    def terminal() -> dict[str, Any] | None:
        snapshot = runner.runtime_snapshot()
        assistant = snapshot.get("assistant")
        if not isinstance(assistant, dict):
            return None
        typed_error = assistant.get("typedError")
        if typed_error:
            raise RuntimeError(
                "Skill activation reached a terminal error: "
                + json.dumps(typed_error, sort_keys=True)
            )
        return (
            snapshot
            if response in str(assistant.get("content") or "")
            and not assistant.get("loading")
            else None
        )

    try:
        terminal_snapshot = wait_until(
            terminal,
            "Skill-assisted Provider response",
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
                "readbackError": (
                    f"{type(readback_error).__name__}: {readback_error}"
                ),
            }
        raise type(error)(
            f"{error}; diagnostics={json.dumps({
                'providerRequests': provider.snapshot()[request_offset:],
                'runtime': runtime,
                'conversation': conversation,
                'selectedModel': runner.driver.execute_script(
                    """
                    const selected = document.querySelector(
                      '[data-pt-agent-selected-provider]'
                    );
                    return selected ? {
                      providerId: selected.dataset.ptAgentSelectedProvider,
                      modelId: selected.dataset.ptAgentSelectedModel,
                    } : null;
                    """
                ),
            }, sort_keys=True, default=str)}"
        ) from error
    require(
        response in runner.driver.execute_script(
            """
            return [...document.querySelectorAll('[data-pt-agent-message-id]')]
              .filter(element => element.getClientRects().length > 0)
              .map(element => element.innerText).join('\\n');
            """
        ),
        "Skill-assisted response is absent from the visible conversation",
    )
    provider_requests = [
        row
        for row in provider.snapshot()[request_offset:]
        if not row.get("followUpRequest")
    ]
    require(
        len(provider_requests) == 2
        and provider_requests[0].get("selectedToolName") == "skill_view"
        and provider_requests[0].get("systemDocuments", {}).get("skillIndex") is True
        and provider_requests[0].get("systemDocuments", {}).get("skillBody") is False
        and provider_requests[1].get("hasExpectedToolResult") is True,
        "Provider did not observe index-only disclosure followed by skill_view body",
    )
    with provider.server.request_lock:
        provider.server.terminal_only = bool(prior_provider["terminalOnly"])
        provider.server.tool_name = str(prior_provider["toolName"])
        provider.server.tool_arguments = dict(prior_provider["toolArguments"])
        provider.server.expected_tool_result = str(
            prior_provider["expectedToolResult"]
        )
        provider.server.terminal_content = str(prior_provider["terminalContent"])
        provider.server.expected_system_documents = dict(
            prior_provider["expectedSystemDocuments"]
        )
        provider.server.selected_tool_name = ""

    conversation_id = str(terminal_snapshot.get("currentSessionKey") or "")
    assistant = terminal_snapshot.get("assistant")
    turn_id = str(assistant.get("turnId") or "") if isinstance(assistant, dict) else ""
    require(
        bool(conversation_id) and bool(turn_id),
        "Skill-assisted turn identity is unavailable",
    )
    turn_evidence = runner.harness(
        "getFoundationTurnEvidence",
        {"conversationId": conversation_id, "turnId": turn_id},
    )
    require(isinstance(turn_evidence, dict), "Skill turn evidence is invalid")
    diagnostics = turn_evidence.get("diagnostics")
    replay = diagnostics.get("replay") if isinstance(diagnostics, dict) else None
    ledgers = (
        replay.get("contextLedgers", replay.get("context_ledgers", []))
        if isinstance(replay, dict)
        else []
    )
    require(isinstance(ledgers, list) and ledgers, "Skill ContextLedger is absent")
    segments = [
        segment
        for ledger in ledgers
        if isinstance(ledger, dict)
        for segment in ledger.get("segments", [])
        if isinstance(segment, dict)
    ]

    def segment_type(segment: dict[str, Any]) -> Any:
        return segment.get("type")

    indexes = [
        segment for segment in segments
        if segment_type(segment) in (5, "CONTEXT_SEGMENT_TYPE_SKILL_INDEX")
    ]
    bodies = [
        segment for segment in segments
        if segment_type(segment) in (6, "CONTEXT_SEGMENT_TYPE_SKILL_BODY")
    ]
    expected_body_ref = (
        f"skill:{skill['skillId']}:version={int(skill['version'])}"
    )
    require(
        bool(indexes)
        and any(
            expected_body_ref
            in segment.get("sourceRefs", segment.get("source_refs", []))
            for segment in bodies
        ),
        f"ContextLedger did not pin the authorized Skill body: {segments}",
    )
    require(
        skill["content"] not in json.dumps(turn_evidence, sort_keys=True),
        "redacted ContextLedger leaked the Skill body",
    )
    removed = remove_retained_skill(runner, agent_id, skill)
    return {
        "uiAction": (
            "send a Skill activation prompt, observe the reply, then remove the bound Skill"
        ),
        "receiverAssertion": (
            "the reply is visible and the consumed Skill disappears only after explicit removal"
        ),
        "providerRequests": provider_requests,
        "turnEvidence": turn_evidence,
        "skill": skill,
        "removal": removed,
        "operationIds": removed["operationIds"],
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
    selector = (
        f'[data-pt-agent-profile-editor][data-pt-agent-id="{agent_id}"] '
        f'textarea[aria-label="{label}"]'
    )
    scrolled = runner.driver.execute_script(
        """
        const element = document.querySelector(arguments[0]);
        if (!(element instanceof HTMLTextAreaElement)) return false;
        element.scrollIntoView({ block: 'center', inline: 'nearest' });
        return true;
        """,
        selector,
    )
    require(scrolled is True, f"{label} editor is unavailable")
    runner.press_native_key(
        NativeKey.A,
        selector=selector,
        modifiers=(NativeModifier.PRIMARY,),
    )
    runner.press_native_key(NativeKey.DELETE)
    runner.press_native_key(NativeKey.TAB)
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
            selector,
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


def roundtrip_definition_package(
    runner: AgentNativeJourney,
    agent_id: str,
) -> dict[str, Any]:
    """Exercise the Desktop package API with one non-empty and one empty prompt."""
    marker = str(runner.runtime_manifest["runId"])
    expected_soul = f"SOUL package {marker}: preserve typed identity."
    runner.set_input_value(
        'textarea[aria-label="SOUL.md"]',
        expected_soul,
        "package SOUL.md",
    )
    wait_until(
        lambda: (
            value
            if (value := runner.station_agent(agent_id)).get("soulMd")
            == expected_soul
            else None
        ),
        "package SOUL.md Station autosave",
    )
    empty_document(
        runner,
        agent_id,
        key="agentsMd",
        label="AGENTS.md",
    )
    source = runner.station_agent(agent_id)
    imported_name = f"definition-roundtrip-{marker.lower()}"
    evidence = runner.harness(
        "roundtripAgentDefinitionPackage",
        {"agentId": agent_id, "importedName": imported_name},
    )
    require(isinstance(evidence, dict), "Agent package roundtrip evidence is invalid")
    packaged = evidence.get("package")
    imported = evidence.get("imported")
    require(
        isinstance(packaged, dict)
        and packaged.get("identityPrompt") == expected_soul
        and packaged.get("agentConfigPrompt") == ""
        and packaged.get("retiredAliases") == []
        and packaged.get("unresolvedDependencies") == [],
        f"exported package lost typed AgentDefinition: {evidence}",
    )
    require(
        isinstance(imported, dict)
        and imported.get("soulMd") == expected_soul
        and imported.get("agentsMd") == ""
        and imported.get("unresolvedDependencies") == [],
        f"imported package lost explicit prompt values: {evidence}",
    )
    imported_agent_id = str(imported.get("agentId") or "")
    require(bool(imported_agent_id), "package import returned no Agent identity")
    runner.lifecycle_fixture_ids.append(imported_agent_id)
    return {
        "uiAction": "enter non-empty SOUL.md and clear AGENTS.md in the visible Profile",
        "receiverAssertion": "the editors show non-empty and explicit-empty values before package roundtrip",
        "sourceReadback": source,
        "packageRoundtrip": evidence,
    }


def conflict_preserves_document_draft(
    runner: AgentNativeJourney,
    agent_id: str,
) -> dict[str, Any]:
    """A Station winner must reject the stale Profile save without losing its draft."""
    current = runner.station_agent(agent_id)
    current_version = int(current.get("version") or 0)
    require(current_version > 0, "AgentDefinition conflict requires a durable version")
    marker = str(runner.runtime_manifest["runId"])
    winning_description = f"Station winner {marker}"
    winner = runner.invoke_readback_command(
        "agents_update",
        {
            "id": agent_id,
            "data": {
                "name": current.get("name", ""),
                "title": current.get("title", ""),
                "description": winning_description,
                "soulMd": current.get("soulMd", ""),
                "agentsMd": current.get("agentsMd", ""),
                "provider": current.get("provider", ""),
                "model": current.get("model", ""),
                "effort": current.get("effort", ""),
                "thinkingMode": current.get("thinkingMode", "auto"),
                "visibility": current.get("visibility", "private"),
                "version": current_version,
            },
        },
    )
    require(
        int(winner.get("version") or 0) == current_version + 1
        and winner.get("description") == winning_description,
        f"concurrent Station mutation did not win exactly once: {winner}",
    )

    draft = f"Unsaved SOUL draft {marker}"
    runner.set_input_value(
        'textarea[aria-label="SOUL.md"]',
        draft,
        "conflicting SOUL.md draft",
    )

    def conflict_surface() -> dict[str, Any] | None:
        state = runner.driver.execute_script(
            """
            const editor = document.querySelector('[data-pt-agent-profile-editor]');
            const draft = document.querySelector('textarea[aria-label="SOUL.md"]');
            const notice = [...document.querySelectorAll('.ant-message-notice-content')]
              .find(element => element.getClientRects().length > 0);
            return {
              saveState: editor?.dataset.ptAgentProfileSaveState ?? '',
              draft: draft?.value ?? null,
              notice: notice?.innerText ?? '',
            };
            """
        )
        if (
            isinstance(state, dict)
            and state.get("saveState") == "conflict"
            and state.get("draft") == draft
            and str(state.get("notice") or "").strip()
        ):
            return state
        return None

    receiver = wait_until(
        conflict_surface,
        "visible AgentDefinition conflict with retained document draft",
        timeout=30,
    )
    persisted = runner.station_agent(agent_id)
    require(
        int(persisted.get("version") or 0) == current_version + 1
        and persisted.get("description") == winning_description
        and persisted.get("soulMd") == current.get("soulMd", ""),
        "stale Profile save partially mutated Station authority",
    )
    return {
        "uiAction": "edit and blur SOUL.md after a concurrent Station mutation",
        "receiverAssertion": "visible save failure leaves the exact local draft in the editor",
        "receiverState": receiver,
        "winnerReadback": persisted,
        "attemptedDraft": draft,
    }
