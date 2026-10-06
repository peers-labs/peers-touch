#!/usr/bin/env python3
"""Deterministic Mobile Social Search/Profile source contract Gate."""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any, Iterable

from tooling.acceptance.core import AcceptanceGate, GateError


REPO_ROOT = Path(__file__).resolve().parents[4]


class MobileSocialSearchProfileNativeGate(AcceptanceGate):
    gate_id = "mobile-social-search-profile-native"
    phase = "MPS-03 descriptor-owned Search and Profile"
    bom = ("MPS-03-SEARCH-PROFILE",)
    spec = ("MPS-D05", "MPS-D12")

    def run(self) -> dict[str, Any]:
        self._assert_source_contract()
        commands = (
            (
                "pnpm",
                "--dir",
                "apps/mobile",
                "exec",
                "vitest",
                "run",
                "src/app/navigation",
                "src/features/social/socialPeopleSearch.test.ts",
                "src/features/social/socialStore.profileSessionFence.test.ts",
                "src/features/social/socialStore.relationshipReadback.test.ts",
                "src/services/gateways/socialGateway.test.ts",
                "src/services/gateways/momentsGateway.test.ts",
                "src/pages/moments",
                "src/pages/MomentsPage.test.ts",
            ),
            ("pnpm", "--dir", "apps/mobile", "run", "build"),
        )
        for command in commands:
            self._run_command(command)

        return {
            "proven_scope": [
                "descriptor-owned full-screen Search and Profile routes",
                "canonical PTID profile identity and authored timeline",
                "explicit Federation-scoped local and remote search",
                "authoritative follow and unfollow relationship readback",
                "existing canonical Direct conversation handoff",
                "query, result anchor, focus, and scroll restoration metadata",
                "profile and Home/Explore invalidation after relationship writes",
            ],
            "unproven_scope": [
                "native iOS visual and interaction journey",
                "physical Android behavior",
                "cross-Station receiver-visible relationship convergence",
            ],
        }

    def _assert_source_contract(self) -> None:
        descriptors = self._read(
            "apps/mobile/src/app/navigation/navigationDescriptors.ts"
        )
        navigation = self._read(
            "apps/mobile/src/app/navigation/navigationStore.ts"
        )
        shell = self._read("apps/mobile/src/components/MobileShell.tsx")
        search = self._read(
            "apps/mobile/src/pages/moments/SocialSearchPage.tsx"
        )
        profile = self._read(
            "apps/mobile/src/pages/moments/SocialProfilePage.tsx"
        )
        social_store = self._read(
            "apps/mobile/src/features/social/socialStore.ts"
        )
        social_gateway = self._read(
            "apps/mobile/src/services/gateways/socialGateway.ts"
        )
        moments_gateway = self._read(
            "apps/mobile/src/services/gateways/momentsGateway.ts"
        )

        self._require_markers(
            descriptors,
            ("detail:social-search", "detail:social-profile"),
            "navigation descriptors",
        )
        self._require_markers(
            navigation,
            (
                "readonly actorPtid: string",
                "readonly federationId: string",
                "detail:social-profile",
            ),
            "navigation route state",
        )
        self._require_markers(
            shell,
            (
                "<SocialSearchPage",
                "<SocialProfilePage",
                "const hideTabbar = activeDetail !== null",
            ),
            "Mobile shell",
        )
        self._require_markers(
            search,
            (
                "readRouteQuery(SEARCH_ROUTE_KEY)",
                "saveListAnchor(SEARCH_ROUTE_KEY, result.ptid)",
                "data-focus-id=\"social-search-input\"",
                "actorPtid: result.ptid",
                "federationId",
            ),
            "Social Search page",
        )
        self._require_markers(
            profile,
            (
                "loadAuthoredPosts(actorPtid)",
                "dispatchOpenContactChat(actorPtid, directFederationId)",
                "requestSocialPeerProfile(actorPtid, true)",
                "facade?.feeds.home.refresh()",
                "facade?.feeds.explore.refresh()",
            ),
            "Social Profile page",
        )
        self._require_markers(
            social_store,
            (
                "gateway.fetchUserFeed(ptid, cursor, 30)",
                "await gw.followUser(ptid)",
                "await gw.unfollowUser(ptid)",
                "await get().loadFriendshipStatus(ptid)",
                "mobile.social.followUnconfirmed",
                "mobile.social.unfollowUnconfirmed",
            ),
            "Social store",
        )
        self._require_markers(
            social_gateway,
            (
                "FollowResponseSchema",
                "UnfollowResponseSchema",
                "/api/v1/social/relationships/follow",
                "/api/v1/social/relationships/unfollow",
            ),
            "Social gateway",
        )
        self._require_markers(
            moments_gateway,
            (
                "fetchUserFeed:",
                "type: 1, // TIMELINE_USER",
                "actor_ptid: actorPtid",
            ),
            "Moments gateway",
        )

    def _read(self, relative_path: str) -> str:
        return (REPO_ROOT / relative_path).read_text(encoding="utf-8")

    @staticmethod
    def _require_markers(
        source: str,
        markers: Iterable[str],
        owner: str,
    ) -> None:
        missing = [marker for marker in markers if marker not in source]
        if missing:
            raise GateError(f"{owner} is missing contract markers: {missing}")

    @staticmethod
    def _run_command(command: tuple[str, ...]) -> None:
        completed = subprocess.run(
            command,
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=1800,
            check=False,
        )
        if completed.returncode != 0:
            detail = (completed.stdout + completed.stderr)[-6000:]
            raise GateError(
                f"Mobile Social Search/Profile command failed: {detail}"
            )


def main() -> int:
    return MobileSocialSearchProfileNativeGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
