"""Atomic delivery and receiver projection Gate for cross-Station Social."""

from __future__ import annotations

from typing import Any

from tooling.acceptance.core import AcceptanceGate

from .cross_station_support import SourceCommand, run_source_commands


TEST_PATTERN = (
    "^TestFederatedPrivate"
    "(Delivery|Reconcile|Replay|Restart|Conflict)"
)
PACKAGES = (
    "./frame/core/federation/...",
    "./app/subserver/events/...",
    "./app/subserver/social/...",
)
COMMANDS = (
    SourceCommand(
        name="delivery-test-discovery",
        argv=("go", "test", *PACKAGES, "-list", TEST_PATTERN),
        cwd="apps/station",
        timeout_seconds=300,
        required_output_pattern=TEST_PATTERN,
    ),
    SourceCommand(
        name="delivery-focused-race",
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
        timeout_seconds=1200,
    ),
    SourceCommand(
        name="delivery-desktop-rust",
        argv=(
            "cargo",
            "test",
            "--manifest-path",
            "apps/desktop/src-tauri/Cargo.toml",
            "social::",
            "--no-fail-fast",
        ),
        timeout_seconds=1200,
    ),
    SourceCommand(
        name="delivery-desktop-projection",
        argv=(
            "pnpm",
            "--dir",
            "apps/desktop",
            "exec",
            "vitest",
            "run",
            "src/acceptance/moments/crossStation.test.ts",
            "src/runtimes/momentsRuntime.test.ts",
            "src/test/moments-store.test.ts",
        ),
        timeout_seconds=600,
        required_output_pattern=r"Tests\s+[1-9][0-9]* passed",
    ),
)


class Gate(AcceptanceGate):
    gate_id = "social-cross-station-delivery"
    phase = "CSS-09 Cross-Station Social Delivery"
    bom = ("CSS-02B", "CSS-07")
    spec = (
        "docs/architecture/cross-station-social/design.md",
        "docs/architecture/cross-station-social/data-model.md",
    )

    def run(self) -> dict[str, Any]:
        commands = run_source_commands(self, COMMANDS)
        return {
            "evidenceClass": "SOURCE_CONTRACT",
            "commands": commands,
            "provenScope": [
                "source-atomic outbox commit",
                "receiver-atomic viewer projection",
                "replay, restart, conflict, and reconciliation behavior",
            ],
            "unprovenScope": ["Native receiver-visible delivery"],
        }


def main() -> int:
    return Gate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
