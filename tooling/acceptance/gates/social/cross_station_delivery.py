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
        name="delivery-standalone-replay-transport",
        argv=("go", "test", "-v", "-race",
              "../../../tooling/acceptance/fixtures/social_private_delivery_probe.go",
              "../../../tooling/acceptance/fixtures/social_private_delivery_probe_test.go",
              "-run", "^TestPrivateDeliveryReplayTransport", "-count=1"),
        cwd="apps/station/frame", timeout_seconds=300,
        required_output_pattern=r"--- PASS: TestPrivateDeliveryReplayTransportMintsFromFreshRegistry",
    ),
    SourceCommand(
        name="delivery-acceptance-controller",
        argv=("go", "test", "-v", "-race", "-tags", "social_acceptance",
              "./app/subserver/social", "-run", "^Test(NotificationControl|PrivateAcceptance)", "-count=1"),
        cwd="apps/station", timeout_seconds=300,
        required_output_pattern=r"--- PASS: TestPrivateAcceptance",
    ),
    SourceCommand(
        name="delivery-ordinary-receiver",
        argv=("go", "test", "-v", "./app/subserver/social",
              "-run", "^TestPrivateAcceptanceOrdinaryBuildPreservesReceiver$", "-count=1"),
        cwd="apps/station", timeout_seconds=300,
        required_output_pattern=r"--- PASS: TestPrivateAcceptanceOrdinaryBuildPreservesReceiver",
    ),
    SourceCommand(
        name="delivery-parent-ordering",
        argv=("python3", "-m", "unittest",
              "tooling.acceptance.tests.test_social_private_delivery",
              "tooling.acceptance.tests.test_private_social_native_provisioner",
              "tooling.acceptance.gates.social.test_cross_station_support",
              "tooling.development.secure_content.test_runtime_owner.RuntimeOwnerTest."
              "test_social_frame_replay_retains_failed_original_observations",
              "tooling.development.secure_content.test_runtime_owner.RuntimeOwnerTest."
              "test_social_frame_replay_requires_exact_result_and_unchanged_rows",
              "tooling.development.secure_content.test_runtime_owner.RuntimeOwnerTest."
              "test_private_outage_commits_before_stop_and_releases_after_restore",
              "tooling.development.secure_content.test_runtime_owner.RuntimeOwnerTest."
              "test_private_outage_rejects_uncommitted_or_delivered_frame_before_stop",
              "tooling.development.secure_content.test_runtime_owner.RuntimeOwnerTest."
              "test_private_outage_restores_then_releases_without_masking_retry_failure"),
        timeout_seconds=180,
    ),
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
        "docs/architecture/domains/social/cross-station/design.md",
        "docs/architecture/domains/social/cross-station/data-model.md",
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
