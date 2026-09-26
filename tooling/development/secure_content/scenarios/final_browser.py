from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

from tooling.development.secure_content.run import (
    ScenarioContext,
    ScenarioDefinition,
)
from tooling.development.secure_content.scenarios.hardcut_browser_regression import (
    execute_hardcut_browser_regression,
)


FIXTURE_CAPABILITY = "secure-content-final"
EXPECTED_CLIENTS = frozenset(
    {
        "secure-content-browser-authenticated",
        "secure-content-browser-anonymous",
    }
)


def _execute(context: ScenarioContext) -> Mapping[str, Any]:
    return execute_hardcut_browser_regression(
        context,
        workstream="W12",
        fixture_capability=FIXTURE_CAPABILITY,
        expected_profiles=frozenset({"four"}),
        expected_clients=EXPECTED_CLIENTS,
    )


SCENARIO = ScenarioDefinition(
    scenario_id="final-browser",
    journey_id="sc-dj-browser-private-boundary",
    work_item_id="secure-content-w12",
    runtimes=frozenset({"browser"}),
    evidence_path=Path("W12/product/browser/result.json"),
    execute=_execute,
    required_fixture_capabilities=frozenset({FIXTURE_CAPABILITY}),
    result_prefix=Path("W12/product"),
    result_task_id="W12",
    result_workstream_id="W12",
    result_variant="browser",
)
