from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

from tooling.development.secure_content.run import (
    ScenarioContext,
    ScenarioDefinition,
)
from tooling.development.secure_content.scenarios.mobile_matrix import (
    RUNTIME_KINDS,
    _variant_for_clients,
    execute_mobile_matrix,
)


FIXTURE_CAPABILITY = "secure-content-final"
PLATFORM_CLIENTS = {
    "ios": frozenset(
        {
            "secure-content-ios-alice",
            "secure-content-ios-bob",
            "secure-content-ios-eve",
        }
    ),
    "android": frozenset(
        {
            "secure-content-android-alice",
            "secure-content-android-bob",
            "secure-content-android-eve",
        }
    ),
}


def _result_variant(
    runtime: str,
    _profile: str | None,
    _profiles: tuple[str, ...],
    clients: tuple[str, ...],
) -> str:
    return _variant_for_clients(
        runtime,
        clients,
        platform_clients=PLATFORM_CLIENTS,
    )


def _execute(context: ScenarioContext) -> Mapping[str, Any]:
    return execute_mobile_matrix(
        context,
        workstream="W12",
        fixture_capability=FIXTURE_CAPABILITY,
        platform_clients=PLATFORM_CLIENTS,
        runtime_kinds={
            "ios": RUNTIME_KINDS["ios"],
            "android": RUNTIME_KINDS["android"],
        },
    )


SCENARIO = ScenarioDefinition(
    scenario_id="final-mobile",
    journey_id="sc-dj-final-mobile",
    work_item_id="secure-content-w12",
    runtimes=frozenset({"mobile"}),
    evidence_path=Path("W12/product/mobile/result.json"),
    execute=_execute,
    required_fixture_capabilities=frozenset({FIXTURE_CAPABILITY}),
    result_prefix=Path("W12/product"),
    result_task_id="W12",
    result_workstream_id="W12",
    result_variant=_result_variant,
)
