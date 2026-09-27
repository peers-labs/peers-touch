from __future__ import annotations

from pathlib import Path

from tooling.development.secure_content.run import (
    ScenarioContext,
    ScenarioDefinition,
)
from tooling.development.secure_content.scenarios.mobile_matrix import (
    RUNTIME_KINDS,
    _variant_for_clients,
    execute_mobile_matrix,
)


FIXTURE_CAPABILITY = "secure-content-hardcut"
PLATFORM_CLIENTS = {
    "ios": frozenset(
        {
            "secure-content-hardcut-ios-alice",
            "secure-content-hardcut-ios-bob",
            "secure-content-hardcut-ios-eve",
        }
    ),
    "android": frozenset(
        {
            "secure-content-hardcut-android-alice",
            "secure-content-hardcut-android-bob",
            "secure-content-hardcut-android-eve",
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


def _execute(context: ScenarioContext):
    return execute_mobile_matrix(
        context,
        workstream="W11",
        fixture_capability=FIXTURE_CAPABILITY,
        platform_clients=PLATFORM_CLIENTS,
        runtime_kinds={
            "ios": RUNTIME_KINDS["ios"],
            "android": RUNTIME_KINDS["android"],
        },
    )


SCENARIO = ScenarioDefinition(
    scenario_id="hardcut-mobile-regression",
    journey_id="sc-dj-hardcut-mobile-regression",
    work_item_id="secure-content-w11",
    runtimes=frozenset({"mobile"}),
    evidence_path=Path("W11/mobile/result.json"),
    execute=_execute,
    required_fixture_capabilities=frozenset({FIXTURE_CAPABILITY}),
    result_prefix=Path("W11"),
    result_task_id="W11",
    result_workstream_id="W11",
    result_variant=_result_variant,
)
