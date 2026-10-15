"""Canonical source-contract Gate for cross-Station private Social."""

from __future__ import annotations

from typing import Any

from tooling.acceptance.core import AcceptanceGate

from .cross_station_support import (
    NODE_TEST_OUTPUT_PATTERN,
    SourceCommand,
    run_source_commands,
)


COMMANDS = (
    SourceCommand(
        name="generated-contract-parity",
        argv=(
            "node",
            "tooling/scripts/proto-gen-secure-content.mjs",
            "--check",
        ),
        timeout_seconds=600,
    ),
    SourceCommand(
        name="generated-contract-tests",
        argv=(
            "node",
            "--test",
            "tooling/scripts/proto-gen-secure-content.test.mjs",
        ),
        timeout_seconds=600,
        required_output_pattern=NODE_TEST_OUTPUT_PATTERN,
    ),
)


class Gate(AcceptanceGate):
    gate_id = "social-cross-station-contract"
    phase = "CSS-09 Cross-Station Social Contract"
    bom = ("CSS-02A", "CSS-02B", "CSS-02D", "CSS-07")
    spec = (
        "docs/architecture/domains/social/cross-station/design.md",
        "docs/architecture/domains/social/cross-station/data-model.md",
    )

    def run(self) -> dict[str, Any]:
        commands = run_source_commands(self, COMMANDS)
        return {
            "evidenceClass": "SOURCE_CONTRACT",
            "commands": commands,
            "provenScope": [
                "canonical Social, Federation, Key Exchange, and generated-client contracts"
            ],
            "unprovenScope": ["Native receiver behavior"],
        }


def main() -> int:
    return Gate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
