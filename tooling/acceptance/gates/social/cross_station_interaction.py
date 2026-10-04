"""Source-authoritative Comment and Reaction Gate."""

from __future__ import annotations

from typing import Any

from tooling.acceptance.core import AcceptanceGate

from .cross_station_support import SourceCommand, run_source_commands


TEST_PATTERN = "^TestFederatedPrivate(Comment|Reaction)"
COMMANDS = (
    SourceCommand(
        name="interaction-test-discovery",
        argv=(
            "go",
            "test",
            "./app/subserver/social/...",
            "-list",
            TEST_PATTERN,
        ),
        cwd="apps/station",
        timeout_seconds=300,
        required_output_pattern=TEST_PATTERN,
    ),
    SourceCommand(
        name="interaction-focused-race",
        argv=(
            "go",
            "test",
            "-race",
            "./app/subserver/social/...",
            "-run",
            TEST_PATTERN,
            "-count=1",
        ),
        cwd="apps/station",
        timeout_seconds=900,
    ),
    SourceCommand(
        name="interaction-comment-rust",
        argv=(
            "cargo",
            "test",
            "--manifest-path",
            "apps/desktop/src-tauri/Cargo.toml",
            "private_comment",
            "--no-fail-fast",
        ),
        timeout_seconds=900,
    ),
    SourceCommand(
        name="interaction-reaction-rust",
        argv=(
            "cargo",
            "test",
            "--manifest-path",
            "apps/desktop/src-tauri/Cargo.toml",
            "private_reaction",
            "--no-fail-fast",
        ),
        timeout_seconds=900,
    ),
    SourceCommand(
        name="interaction-desktop-projection",
        argv=(
            "pnpm",
            "--dir",
            "apps/desktop",
            "exec",
            "vitest",
            "run",
            "src/test/moments-store.test.ts",
            "src/runtimes/momentsRuntime.test.ts",
            "-t",
            "comment|reaction|eventBus|pending|retry",
        ),
        timeout_seconds=600,
        required_output_pattern=r"Tests\s+[1-9][0-9]* passed",
    ),
)


class Gate(AcceptanceGate):
    gate_id = "social-cross-station-interaction"
    phase = "CSS-09 Cross-Station Social Interaction"
    bom = ("CSS-04", "CSS-05")
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
                "source-authoritative Comment prepare/submit/replay",
                "source-authoritative Reaction and unreaction convergence",
            ],
            "unprovenScope": ["Native Alice/Bob interaction visibility"],
        }


def main() -> int:
    return Gate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
