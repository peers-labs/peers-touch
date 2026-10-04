"""Browser host-policy Gate proving zero Social registration."""

from __future__ import annotations

from typing import Any

from tooling.acceptance.core import AcceptanceGate

from .cross_station_support import SourceCommand, run_source_commands


COMMANDS = (
    SourceCommand(
        name="browser-host-policy-contract",
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
        name="browser-zero-registration",
        argv=(
            "pnpm",
            "--dir",
            "apps/desktop",
            "exec",
            "vitest",
            "run",
            "src/pages/moments/nativeRegistration.test.ts",
        ),
        timeout_seconds=300,
        required_output_pattern=r"Tests\s+[1-9][0-9]* passed",
    ),
)


class Gate(AcceptanceGate):
    gate_id = "browser-social-zero-registration"
    phase = "CSS-09 Browser Social Prohibition"
    bom = ("CSS-01",)
    spec = (
        "docs/architecture/social/product-definition.md",
        "docs/architecture/cross-station-social/design.md",
    )

    def run(self) -> dict[str, Any]:
        commands = run_source_commands(self, COMMANDS)
        return {
            "evidenceClass": "HOST_POLICY_CONTRACT",
            "commands": commands,
            "browserClientLaunched": False,
            "provenScope": [
                "zero Browser Social module, page, runtime, navigation, or action registration"
            ],
            "unprovenScope": ["Browser Social product behavior is unsupported"],
        }


def main() -> int:
    return Gate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
