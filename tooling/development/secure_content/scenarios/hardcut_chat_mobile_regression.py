from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

from tooling.development.secure_content.run import (
    ScenarioContext,
    ScenarioDefinition,
)
from tooling.development.secure_content.scenarios.chat_attachment_mobile import (
    PLATFORM_RUNTIME_KINDS,
    _platform_for_clients,
    execute_chat_attachment_mobile,
)


FIXTURE_CAPABILITY = "secure-content-hardcut"
PLATFORM_CLIENTS = {
    "ios": frozenset(
        {
            "secure-content-hardcut-ios-alice",
            "secure-content-hardcut-ios-bob",
        }
    ),
    "android": frozenset(
        {
            "secure-content-hardcut-android-alice",
            "secure-content-hardcut-android-bob",
        }
    ),
}


def _result_variant(
    runtime: str,
    _profile: str | None,
    _profiles: tuple[str, ...],
    clients: tuple[str, ...],
) -> str:
    return "chat-" + _platform_for_clients(
        runtime,
        clients,
        platform_clients=PLATFORM_CLIENTS,
    )


def _execute(context: ScenarioContext) -> Mapping[str, Any]:
    return execute_chat_attachment_mobile(
        context,
        workstream="W11",
        fixture_capability=FIXTURE_CAPABILITY,
        platform_clients=PLATFORM_CLIENTS,
        runtime_kinds=PLATFORM_RUNTIME_KINDS,
    )


SCENARIO = ScenarioDefinition(
    scenario_id="hardcut-chat-mobile-regression",
    journey_id="sc-dj-chat-attachment-mobile",
    work_item_id="secure-content-w11",
    runtimes=frozenset({"mobile"}),
    evidence_path=Path("W11/chat-mobile/result.json"),
    execute=_execute,
    required_fixture_capabilities=frozenset({FIXTURE_CAPABILITY}),
    result_prefix=Path("W11"),
    result_task_id="W11",
    result_workstream_id="W11",
    result_variant=_result_variant,
)
