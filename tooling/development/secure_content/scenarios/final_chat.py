from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

from tooling.development.secure_content.run import (
    ScenarioContext,
    ScenarioDefinition,
)
from tooling.development.secure_content.scenarios.chat_attachment_atomic import (
    execute_chat_attachment,
)


FIXTURE_CAPABILITY = "secure-content-final"


def _execute(context: ScenarioContext) -> Mapping[str, Any]:
    return execute_chat_attachment(
        context,
        workstream="W12",
        fixture_capability=FIXTURE_CAPABILITY,
    )


SCENARIO = ScenarioDefinition(
    scenario_id="final-chat",
    journey_id="sc-dj-chat-revalidation",
    work_item_id="secure-content-w12",
    runtimes=frozenset({"desktop"}),
    evidence_path=Path("W12/product/chat-desktop/result.json"),
    execute=_execute,
    required_fixture_capabilities=frozenset({FIXTURE_CAPABILITY}),
    result_prefix=Path("W12/product"),
    result_task_id="W12",
    result_workstream_id="W12",
    result_variant="chat-desktop",
)
