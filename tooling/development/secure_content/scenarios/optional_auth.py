from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

from tooling.development.secure_content.run import (
    ScenarioContext,
    ScenarioDefinition,
)


def _execute(context: ScenarioContext) -> Mapping[str, Any]:
    context.run_check(
        "credential-matrix-http-hertz",
        [
            "go",
            "test",
            "-count=1",
            "-run",
            (
                "^(TestOptionalJWTTraversesRealHTTPRequest|"
                "TestOptionalJWTTraversesRealHertzRequest|"
                "TestSocialPublicReadRoutesUseStrictOptionalJWT|"
                "TestSocialPublicCapableCollectionsUseStrictOptionalJWT)$"
            ),
            "./frame/core/auth/adapter/http",
            "./frame/core/auth/adapter/hertz",
            "./app/subserver/social",
        ],
        cwd=context.repo_root / "apps/station",
    )
    return {
        "journeyStepId": "credential-matrix",
        "observations": [
            "absent credential projects anonymous",
            "valid credential projects canonical actor",
            "malformed expired and revoked credentials return 401",
        ],
    }


SCENARIO = ScenarioDefinition(
    scenario_id="optional-auth",
    journey_id="sc-dj-optional-auth",
    work_item_id="secure-content-w4",
    runtimes=frozenset({"service"}),
    evidence_path=Path("W4/SC-AS02/result.json"),
    execute=_execute,
)
