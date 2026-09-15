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
            "content-prekey-client-boundary service scenario does not accept "
            "profiles or clients"
        )

    context.run_check(
        "content-prekey-http-and-receipt-race",
        [
            "go",
            "test",
            "-race",
            "-count=1",
            "./frame/core/server/...",
            "./app/subserver/key_exchange/...",
        ],
        cwd=context.repo_root / "apps/station",
    )
    context.run_check(
        "content-prekey-postgres",
        ["node", "tooling/scripts/run-content-prekey-postgres-tests.mjs"],
        cwd=context.repo_root,
    )
    context.run_check(
        "content-prekey-error-contract",
        ["node", "tooling/scripts/check-content-prekey-errors.mjs"],
        cwd=context.repo_root,
    )
    context.run_check(
        "content-prekey-api-ownership",
        [
            "python3",
            "tooling/scripts/acceptance-run.py",
            "--gate",
            "station-api-ownership",
        ],
        cwd=context.repo_root,
    )
    return {
        "journeyStepId": "content-prekey-client-boundary",
        "observations": [
            (
                "the focused Station Go suites pass the canonical Content PreKey "
                "HTTP and Key Exchange package tests"
            ),
            (
                "the checked PostgreSQL manifest passes exact and conflicting "
                "publication contention, all-existing rollback, receipt growth, "
                "receipt-pool-Actor lock ordering, profile-rotation replay, and "
                "publication and claim revocation races"
            ),
            (
                "the deterministic Content PreKey error-contract checker passes"
            ),
            (
                "the station-api-ownership Gate passes for the registered "
                "Content PreKey routes"
            ),
        ],
    }


SCENARIO = ScenarioDefinition(
    scenario_id="content-prekey-client-boundary",
    journey_id="sc-dj-content-prekey-client-boundary",
    work_item_id="secure-content-w7a",
    runtimes=frozenset({"service"}),
    evidence_path=Path("W7A/EC5A/result.json"),
    execute=_execute,
)
