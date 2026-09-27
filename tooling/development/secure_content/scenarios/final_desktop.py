from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

from tooling.development.secure_content.run import (
    ScenarioContext,
    ScenarioDefinition,
)
from tooling.development.secure_content.scenarios.hardcut_regression import (
    execute_hardcut_regression,
)


FIXTURE_CAPABILITY = "secure-content-final"
EXPECTED_CLIENTS = frozenset(
    {
        "secure-content-desktop-alice",
        "secure-content-desktop-bob",
        "secure-content-desktop-eve",
    }
)


def _execute(context: ScenarioContext) -> Mapping[str, Any]:
    return execute_hardcut_regression(
        context,
        workstream="W12",
        fixture_capability=FIXTURE_CAPABILITY,
        expected_clients=EXPECTED_CLIENTS,
        expected_profiles=frozenset({"four"}),
    )


SCENARIO = ScenarioDefinition(
    scenario_id="final-desktop",
    journey_id="sc-dj-final-desktop",
    work_item_id="secure-content-w12",
    runtimes=frozenset({"desktop"}),
    evidence_path=Path("W12/product/desktop/result.json"),
    execute=_execute,
    required_fixture_capabilities=frozenset({FIXTURE_CAPABILITY}),
    result_prefix=Path("W12/product"),
    result_task_id="W12",
    result_workstream_id="W12",
    result_variant="desktop",
)
