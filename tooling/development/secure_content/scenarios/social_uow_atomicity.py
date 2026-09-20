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
            "social-uow-atomicity service scenario does not accept profiles or clients"
        )

    context.run_check(
        "social-private-uow-race",
        [
            "go",
            "test",
            "-race",
            "-count=1",
            "./app/subserver/social/...",
        ],
        cwd=context.repo_root / "apps/station",
    )
    context.run_check(
        "content-proof-key-history-race",
        [
            "go",
            "test",
            "-race",
            "-count=1",
            "./frame/core/auth/federation",
        ],
        cwd=context.repo_root / "apps/station",
    )
    context.run_check(
        "content-prekey-submit-validation-race",
        [
            "go",
            "test",
            "-race",
            "-count=1",
            "./app/subserver/key_exchange/...",
        ],
        cwd=context.repo_root / "apps/station",
    )
    context.run_check(
        "secure-content-http-transport-race",
        [
            "go",
            "test",
            "-race",
            "-count=1",
            "./frame/core/server",
            "./frame/core/plugin/server/hertz",
            "./frame/core/plugin/native/server",
        ],
        cwd=context.repo_root / "apps/station",
    )
    return {
        "journeyStepId": "social-private-uow-atomicity",
        "observations": [
            (
                "Post and Comment write-boundary failpoints leave no partial "
                "resource, snapshot, envelope, delivery, object-grant, proof, "
                "or receipt rows"
            ),
            (
                "exact prepare and submit replay reuse the original Content "
                "PreKey claims while conflicting hashes are terminal"
            ),
            (
                "FRIENDS and endpoint/recovery epoch drift persist "
                "REJECTED_STALE without committing domain rows"
            ),
            (
                "authorized point reads project only the current endpoint "
                "envelope and unauthorized actors receive not-found"
            ),
            (
                "IMAGE object begin/chunk/complete/attach/read uses durable "
                "leases, exact replay, authorization, range, and cleanup fencing"
            ),
            (
                "point reads verify durable commit proofs through Federation "
                "public-key history and carry a current-key attestation"
            ),
        ],
    }


SCENARIO = ScenarioDefinition(
    scenario_id="social-uow-atomicity",
    journey_id="sc-dj-social-uow-atomicity",
    work_item_id="secure-content-w6",
    runtimes=frozenset({"service"}),
    evidence_path=Path("W6/SC-AS16/result.json"),
    execute=_execute,
)
