"""Typed EventBus ownership Gate for cross-Station Social."""

from __future__ import annotations

from typing import Any

from tooling.acceptance.core import AcceptanceGate

from .cross_station_support import SourceCommand, run_source_commands


COMMANDS = (
    SourceCommand(
        name="eventbus-static-contract",
        argv=(
            "python3",
            "-m",
            "unittest",
            "tooling.acceptance.gates.social."
            "cross_station_eventbus_contract_test",
        ),
        timeout_seconds=180,
        required_output_pattern=r"^Ran [1-9][0-9]* tests?",
    ),
    SourceCommand(
        name="eventbus-runtime-source",
        argv=(
            "pnpm",
            "--dir",
            "apps/desktop",
            "exec",
            "vitest",
            "run",
            "src/services/eventStream.test.ts",
            "src/services/socialRealtime.test.ts",
            "src/runtimes/momentsRuntime.test.ts",
        ),
        timeout_seconds=600,
        required_output_pattern=r"Tests\s+[1-9][0-9]* passed",
    ),
)


class Gate(AcceptanceGate):
    gate_id = "social-cross-station-eventbus-contract"
    phase = "CSS-09 Social EventBus Contract"
    bom = ("CSS-01", "CSS-02B", "CSS-06", "CSS-07")
    spec = (
        "docs/client/desktop/runtime-projections.md",
        "docs/architecture/cross-station-social/design.md",
    )

    def run(self) -> dict[str, Any]:
        commands = run_source_commands(self, COMMANDS)
        return {
            "evidenceClass": "SOURCE_CONTRACT",
            "commands": commands,
            "provenScope": [
                "typed producer-to-runtime wiring",
                "single momentsRuntime projection owner",
                "reconciliation, identity fencing, and teardown",
            ],
            "unprovenScope": ["Native hidden-page receiver behavior"],
        }


def main() -> int:
    return Gate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
