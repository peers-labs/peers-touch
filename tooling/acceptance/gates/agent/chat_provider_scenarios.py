"""Dashboard management actions with Native Desktop consumer assertions."""

from __future__ import annotations

from typing import Any

from tooling.acceptance.gates.agent.chat_model_scenarios import consumer_model_choices
from tooling.acceptance.gates.agent.native_agent_runner import AgentNativeJourney, require


def configuration(runner: AgentNativeJourney) -> dict[str, Any]:
    result = runner.dashboard.call("configuration")
    return {
        **result,
        "uiAction": "select DM and CLI methods in the shared Dashboard Provider editor",
        "receiverAssertion": "only selected method fields mount; installation and read-only CLI models remain inside the selected Provider",
        "operationIds": [
            "dashboard.provider.methods", "dashboard.provider.selected-schema",
            "dashboard.provider.cli-install", "dashboard.provider.cli-advanced",
            "dashboard.provider.cli-no-command-editor",
        ],
    }


def create_direct(runner: AgentNativeJourney, fixture: dict[str, str]) -> dict[str, Any]:
    provider_id = f"chat-direct-{runner.runtime_manifest['runId'].lower()}"
    runner.chat_provider_fixture_ids.append(provider_id)
    endpoint = runner.dashboard.api(
        "provider/get", {"provider_id": fixture["providerId"]},
    )["provider"]["base_url"]
    name = f"Dashboard Direct {runner.runtime_manifest['runId']}"
    model_name = f"Dashboard receiver {runner.runtime_manifest['runId']}"
    runner.dashboard.call("create-direct", {
        "providerId": provider_id, "name": name, "endpoint": endpoint,
        "key": runner.minimum_provider_fixture.api_key,
        "modelId": fixture["modelId"], "modelName": model_name,
        "actorPTID": runner.actor_ptid,
    })
    detail = runner.dashboard.api("provider/get", {"provider_id": provider_id})["provider"]
    require(detail["name"] == name and detail["base_url"] == endpoint,
            "Dashboard creation did not persist display name and endpoint")
    runner.harness("reconcileChatSuiteModelProjection")
    require({"providerId": provider_id, "modelId": fixture["modelId"]}
            in consumer_model_choices(runner), "Dashboard grant did not reach Native Models")
    return {
        "providerId": provider_id,
        "uiAction": "create DM Provider, save write-only credential, add model and grant through Dashboard; open Native Models",
        "receiverAssertion": "the granted model is selectable in Native Desktop",
        "operationIds": ["dashboard.provider.dm-create-consumed"],
    }


def cli_discovery(runner: AgentNativeJourney, provider_id: str) -> dict[str, Any]:
    before = runner.dashboard.api("provider/get", {"provider_id": provider_id})["provider"]
    original = runner.chat_provider_restore.setdefault(provider_id, {
        "enabled": before["enabled"], "runtime_config": before["runtime_config"],
        "version": int(before["version"]), "last_mutation_version": int(before["version"]),
    })
    try:
        result = runner.dashboard.call("discovery", {"providerId": provider_id})
    finally:
        current = runner.dashboard.api("provider/get", {"provider_id": provider_id})["provider"]
        require(int(current["version"]) in (
            original["last_mutation_version"], original["last_mutation_version"] + 1,
        ), "CLI fixture version changed outside discovery")
        original["last_mutation_version"] = int(current["version"])
    return {
        "stationReadback": result,
        "uiAction": "save CLI runtime defaults and discover models through the selected Dashboard Provider",
        "receiverAssertion": "installed adapter supplies a visible read-only model directory",
        "operationIds": ["dashboard.provider.cli-discovery"],
    }
