from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

from tooling.development.secure_content.run import (
    ScenarioContext,
    ScenarioDefinition,
)
from tooling.development.secure_content.scenarios.chat_attachment_mobile import (
    execute_chat_attachment_mobile,
    _result_variant,
)


FIXTURE_CAPABILITY = "chat-attachment-revalidation"


def _execute(context: ScenarioContext) -> Mapping[str, Any]:
    return execute_chat_attachment_mobile(
        context,
        workstream="W10",
        fixture_capability=FIXTURE_CAPABILITY,
    )


SCENARIO = ScenarioDefinition(
    scenario_id="chat-revalidation-mobile",
    journey_id="sc-dj-chat-attachment-mobile",
    work_item_id="secure-content-w10",
    runtimes=frozenset({"mobile"}),
    evidence_path=Path("W10/mobile/result.json"),
    execute=_execute,
    required_fixture_capabilities=frozenset({FIXTURE_CAPABILITY}),
    result_prefix=Path("W10"),
    result_task_id="W10",
    result_workstream_id="W10",
    result_variant=_result_variant,
)
