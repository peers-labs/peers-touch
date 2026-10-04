"""Remote Content PreKey admission Gate for cross-Station Social."""

from __future__ import annotations

from typing import Any

from tooling.acceptance.core import AcceptanceGate

from .cross_station_support import SourceCommand, run_source_commands


TEST_PATTERN = "^(TestFederatedContentPreKey|TestRemoteRecipientAdmission)"
PACKAGES = (
    "./app/subserver/key_exchange/...",
    "./app/subserver/social/...",
)
COMMANDS = (
    SourceCommand(
        name="prekey-test-discovery",
        argv=("go", "test", *PACKAGES, "-list", TEST_PATTERN),
        cwd="apps/station",
        timeout_seconds=300,
        required_output_pattern=TEST_PATTERN,
    ),
    SourceCommand(
        name="prekey-focused-race",
        argv=(
            "go",
            "test",
            "-race",
            *PACKAGES,
            "-run",
            TEST_PATTERN,
            "-count=1",
        ),
        cwd="apps/station",
        timeout_seconds=900,
    ),
)


class Gate(AcceptanceGate):
    gate_id = "social-cross-station-prekey"
    phase = "CSS-09 Remote Content PreKey"
    bom = ("CSS-02A", "CSS-02D")
    spec = (
        "docs/architecture/cross-station-social/design.md",
        "docs/architecture/cross-station-social/integration.md",
    )

    def run(self) -> dict[str, Any]:
        commands = run_source_commands(self, COMMANDS)
        return {
            "evidenceClass": "SOURCE_CONTRACT",
            "commands": commands,
            "provenScope": [
                "authenticated remote Content PreKey admission",
                "exact replay and plan isolation",
                "no business commit on unavailable admission",
            ],
            "unprovenScope": ["Native recipient-visible delivery"],
        }


def main() -> int:
    return Gate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
