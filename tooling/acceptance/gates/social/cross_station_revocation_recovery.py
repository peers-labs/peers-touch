"""Revocation, replay resilience, and replacement recovery Gate."""

from __future__ import annotations

from typing import Any

from tooling.acceptance.core import AcceptanceGate

from .cross_station_support import (
    NODE_TEST_OUTPUT_PATTERN,
    SourceCommand,
    run_source_commands,
)


TEST_PATTERN = (
    "^TestFederatedPrivate"
    "(Invalidation|Tombstone|Recovery|Reconcile)"
)
PACKAGES = (
    "./frame/core/federation/...",
    "./app/subserver/social/...",
)
COMMANDS = (
    SourceCommand(
        name="revocation-recovery-discovery",
        argv=("go", "test", *PACKAGES, "-list", TEST_PATTERN),
        cwd="apps/station",
        timeout_seconds=300,
        required_output_pattern=TEST_PATTERN,
    ),
    SourceCommand(
        name="revocation-recovery-race",
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
        name="revocation-desktop-rust",
        argv=(
            "cargo",
            "test",
            "--manifest-path",
            "apps/desktop/src-tauri/Cargo.toml",
            "revoke",
            "--no-fail-fast",
        ),
        timeout_seconds=900,
    ),
    SourceCommand(
        name="recovery-desktop-rust",
        argv=(
            "cargo",
            "test",
            "--manifest-path",
            "apps/desktop/src-tauri/Cargo.toml",
            "recovery",
            "--no-fail-fast",
        ),
        timeout_seconds=900,
    ),
    SourceCommand(
        name="revocation-recovery-projection",
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
            "delete|relationship|revocation|recovery|device|proof",
        ),
        timeout_seconds=600,
        required_output_pattern=r"Tests\s+[1-9][0-9]* passed",
    ),
    SourceCommand(
        name="social-operability-tests",
        argv=(
            "node",
            "--test",
            "tooling/scripts/check-social-cross-station-operability.test.mjs",
        ),
        timeout_seconds=300,
        required_output_pattern=NODE_TEST_OUTPUT_PATTERN,
    ),
    SourceCommand(
        name="social-operability-check",
        argv=(
            "node",
            "tooling/scripts/check-social-cross-station-operability.mjs",
        ),
        timeout_seconds=300,
    ),
)


class Gate(AcceptanceGate):
    gate_id = "social-cross-station-revocation-recovery"
    phase = "CSS-09 Social Revocation And Recovery"
    bom = ("CSS-06", "CSS-07", "CSS-08")
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
                "monotonic tombstones and stale-delivery suppression",
                "reconcile and retry behavior",
                "trusted replacement-device recovery contracts",
                "localized errors and bounded privacy-safe observability",
            ],
            "unprovenScope": ["Native revocation and Bob2 recovery visibility"],
        }


def main() -> int:
    return Gate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
