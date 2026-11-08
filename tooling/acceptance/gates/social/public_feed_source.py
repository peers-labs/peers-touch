"""Source checks for Actor-Owned Moments; never Native product proof."""

from __future__ import annotations

from typing import Any

from tooling.acceptance.core import AcceptanceGate
from .cross_station_support import SourceCommand, run_source_commands


COMMANDS = (
    SourceCommand(
        name="public-feed-native-entry",
        argv=("python3", "-m", "unittest",
              "tooling.acceptance.gates.social.test_public_feed_native"),
    ),
    SourceCommand(
        name="public-feed-desktop-types",
        argv=("pnpm", "exec", "tsc", "--noEmit", "-p", "tsconfig.json"),
        cwd="apps/desktop",
    ),
    SourceCommand(
        name="public-feed-desktop-consumer",
        argv=("pnpm", "exec", "vitest", "run", "src/services/publicFeedNative.test.ts",
              "src/services/publicFeedProjection.test.ts", "src/runtimes/momentsRuntime.test.ts",
              "src/components/moments/momentsInteraction.contract.test.ts",
              "src/pages/moments/nativeRegistration.test.ts", "src/store/discovery.test.ts",
              "src/services/socialCirclePages.test.ts", "src/store/relationships.test.ts",
              "src/services/socialRealtime.test.ts", "src/services/socialRelationshipTransport.test.ts",
              "src/store/momentsCircles.test.ts", "src/store/momentsReactions.test.ts",
              "src/store/privateComments.test.ts", "src/services/eventStream.test.ts"),
        cwd="apps/desktop",
    ),
    SourceCommand(
        name="public-feed-mobile-cutover",
        argv=("pnpm", "exec", "vitest", "run", "src/services/gateways/momentsGateway.test.ts",
              "src/pages/moments/MomentComposer.test.ts", "src/runtimes/privateMomentsRuntime.test.ts",
              "src/features/social/mobileSocialFacade.test.ts", "src/pages/moments/MomentCommentsSection.test.tsx",
              "src/pages/moments/MomentThreadMedia.test.ts", "src/acceptance/actions.social.test.ts",
              "src/acceptance/actions.privateSocial.test.ts"),
        cwd="apps/mobile",
    ),
    SourceCommand(
        name="public-feed-mobile-types",
        argv=("pnpm", "exec", "tsc", "--noEmit", "-p", "tsconfig.json"),
        cwd="apps/mobile",
    ),
    SourceCommand(
        name="public-feed-mobile-native-oracles",
        argv=("python3", "-m", "unittest",
              "tooling.acceptance.gates.mobile.simulator_social_e2e_test",
              "tooling.acceptance.gates.mobile.android_social_e2e_test",
              "tooling.acceptance.gates.mobile.moments_cutover_test"),
    ),
    SourceCommand(
        name="private-comment-native-oracles",
        argv=("python3", "-m", "unittest",
              "tooling.acceptance.gates.social.test_desktop_private_e2e",
              "tooling.development.secure_content.test_runtime_owner.RuntimeOwnerTest."
              "test_social_cross_station_suite_contract_and_bindings_are_closed"),
    ),
    SourceCommand(
        name="private-comment-native-replay-harness",
        argv=("pnpm", "exec", "vitest", "run", "src/acceptance/moments/harness.test.ts",
              "-t", "comment LIKE"),
        cwd="apps/desktop",
    ),
    SourceCommand(
        name="public-feed-test-discovery",
        argv=("go", "test", "./app/subserver/social/...", "-list", "^TestFeed"),
        cwd="apps/station",
        required_output_pattern=r"^TestFeedInteractionExpirationRenewsTransportAndOnlyACKMarksForwarded$",
    ),
    SourceCommand(
        name="public-feed-go-regressions",
        argv=(
            "go", "test", "./app/subserver/social/...", "./app/subserver/actor_identity/...",
            "./frame/core/signedlog/...", "./frame/core/federation/delivery/...",
            "./app/subserver/federation/domain/...", "-count=1",
        ),
        cwd="apps/station",
        timeout_seconds=1200,
        required_output_pattern=r"^ok\s+.*app/subserver/social/application",
    ),
    SourceCommand(
        name="public-feed-rust-conformance",
        argv=(
            "cargo", "test", "--manifest-path", "packages/station-trust/Cargo.toml",
            "feed_log::tests", "--quiet",
        ),
        timeout_seconds=1800,
        required_output_pattern=r"test result: ok\. [1-9][0-9]* passed",
    ),
    SourceCommand(
        name="public-feed-native-relationship-transport",
        argv=(
            "cargo", "test", "--manifest-path", "apps/desktop/src-tauri/Cargo.toml",
            "--bin", "peers-touch-desktop", "contracts::social_relationship_input_tests",
            "--no-default-features", "--quiet",
        ),
        timeout_seconds=1800,
        required_output_pattern=r"test result: ok\. [1-9][0-9]* passed",
    ),
    SourceCommand(
        name="public-feed-native-integrity",
        argv=(
            "cargo", "test", "--manifest-path", "apps/desktop/src-tauri/Cargo.toml",
            "--bin", "peers-touch-desktop", "social::public_feed",
            "--no-default-features", "--quiet",
        ),
        timeout_seconds=1800,
        required_output_pattern=r"test result: ok\. [1-9][0-9]* passed",
    ),
)


class Gate(AcceptanceGate):
    gate_id = "social-public-feed-source"
    phase = "Actor-Owned Moments v1 Source"
    bom = ("AFL-01", "AFL-02", "AFL-03A", "AFL-03B", "AFL-05", "AFL-06")
    spec = (
        "docs/architecture/domains/social/federation/actor-feed-log.md",
        "docs/architecture/domains/social/federation/actor-owned-moments-development.md",
    )

    def run(self) -> dict[str, Any]:
        return {
            "evidenceClass": "SOURCE_CHECK",
            "commands": run_source_commands(self, COMMANDS),
            "provenScope": ["Go source regressions, Native Rust journal/cache integrity and Desktop/Mobile consumer source checks"],
            "unprovenScope": [
                "Native user publication and receiver rendering",
                "Deployed two-Station replication and non-follower interaction",
                "Mobile Native public-write denial and private audience regression",
            ],
        }


def main() -> int:
    return Gate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
