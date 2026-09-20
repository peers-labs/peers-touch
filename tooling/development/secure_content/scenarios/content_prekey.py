from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

from tooling.development.secure_content.run import (
    RunnerError,
    ScenarioContext,
    ScenarioDefinition,
)


def _execute(context: ScenarioContext) -> Mapping[str, Any]:
    if context.profile is not None or context.profiles or context.clients:
        raise RunnerError(
            "content-prekey service scenario does not accept profiles or clients"
        )

    context.run_check(
        "content-prekey-operational-lifecycle",
        [
            "go",
            "test",
            "-race",
            "-count=1",
            "-run",
            "^TestContentPreKeyOperationalLifecycle$",
            "./app/subserver/key_exchange/...",
        ],
        cwd=context.repo_root / "apps/station",
    )
    return {
        "journeyStepId": "content-prekey-lifecycle",
        "observations": [
            "endpoint and recovery Content PreKey pools remain separate",
            (
                "exact plan/hash replay returns the original claim while a "
                "conflicting hash is rejected"
            ),
            "consumed or exposed Content PreKeys cannot be reused",
            "depletion blocks prepare and replenishment restores bounded readiness",
        ],
    }


SCENARIO = ScenarioDefinition(
    scenario_id="content-prekey",
    journey_id="sc-dj-content-prekey",
    work_item_id="secure-content-w3",
    runtimes=frozenset({"service"}),
    evidence_path=Path("W3/SC-AS08/result.json"),
    execute=_execute,
)
