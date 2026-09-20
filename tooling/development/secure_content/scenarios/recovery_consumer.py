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
            "recovery-consumer service scenario does not accept profiles or clients"
        )

    context.run_check(
        "portable-recovery-consumer",
        [
            "cargo",
            "test",
            "--manifest-path",
            "apps/desktop/src-tauri/Cargo.toml",
            "-p",
            "secure-content-core",
            "recovery",
        ],
        cwd=context.repo_root,
    )
    context.run_check(
        "station-recovery-query-race",
        [
            "go",
            "test",
            "-race",
            "-count=1",
            "./app/subserver/recovery/...",
            "./app/subserver/social/...",
        ],
        cwd=context.repo_root / "apps/station",
    )
    return {
        "journeyStepId": "never-opened-recovery",
        "observations": [
            (
                "the canonical recovery master and typed one-time recovery "
                "PreKey derive the accepted X25519 vector"
            ),
            (
                "the recovery consumer verifies the claimed public key before "
                "opening a binding-authenticated HPKE envelope"
            ),
            (
                "Social recovery pages return each currently authorized "
                "resource once and resume from the exact cursor"
            ),
            (
                "wrong phrase, actor, epoch, key ID, revoked grants, blocks, "
                "and deleted resources release no plaintext"
            ),
        ],
    }


SCENARIO = ScenarioDefinition(
    scenario_id="recovery-consumer",
    journey_id="sc-dj-recovery-consumer",
    work_item_id="secure-content-w5",
    runtimes=frozenset({"service"}),
    evidence_path=Path("W5/SC-AS08/result.json"),
    execute=_execute,
)
