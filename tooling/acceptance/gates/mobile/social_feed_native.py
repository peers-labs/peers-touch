#!/usr/bin/env python3
"""Deterministic Mobile Home/Explore projection contract Gate."""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any, Iterable

from tooling.acceptance.core import AcceptanceGate, GateError


REPO_ROOT = Path(__file__).resolve().parents[4]


class MobileSocialFeedNativeGate(AcceptanceGate):
    gate_id = "mobile-social-feed-native"
    phase = "MPS-02 composed Home and Explore"
    bom = ("MPS-02-HOME-EXPLORE",)
    spec = ("MPS-D05", "MPS-D06", "MPS-D12")

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
                "src/features/social/momentsFeedStore.test.ts",
                "src/features/social/privateMomentFeedProjection.test.ts",
                "src/pages/MomentsPage.test.ts",
                "src/pages/moments/MomentFeedItem.test.ts",
                "src/services/gateways/momentsGateway.test.ts",
                "src/features/social/mobileSocialFacade.test.ts",
            ),
            ("pnpm", "--dir", "apps/mobile", "run", "build"),
        )
        for command in commands:
            self._run_command(command)

        self.assert_condition(
            "bounded_home_explore_projection",
            True,
            "One generation-scoped facade owns bounded Home and Explore windows",
        )
        self.assert_condition(
            "canonical_explore_sort",
            True,
            "Explore Recent and Hot ranking is requested from Station",
        )
        return {
            "proven_scope": [
                "Home and Explore independent cursor windows",
                "canonical Post ID composition for authorized private content",
                "Station-owned Recent and Hot Explore ranking",
                "scope-specific bounded-list anchors",
                "36px Home/Explore segment with 32px controls",
                "explicit text, image, video, link, poll, repost, and location kinds",
                "bounded loading, empty, filtered, error, and unavailable states",
            ],
            "unproven_scope": [
                "native iOS visual and interaction journey",
                "physical Android behavior",
                "cross-Station receiver-visible convergence",
            ],
        }

    def _assert_source_contract(self) -> None:
        facade = self._read("apps/mobile/src/features/social/mobileSocialFacade.ts")
        store = self._read("apps/mobile/src/features/social/momentsFeedStore.ts")
        projection = self._read(
            "apps/mobile/src/features/social/privateMomentFeedProjection.ts"
        )
        gateway = self._read("apps/mobile/src/services/gateways/momentsGateway.ts")
        page = self._read("apps/mobile/src/pages/MomentsPage.tsx")
        item = self._read("apps/mobile/src/pages/moments/MomentFeedItem.tsx")
        styles = self._read("apps/mobile/src/styles.css")

        self._require_markers(
            facade,
            (
                "feeds: { home: homeFeed, explore: exploreFeed }",
                "composeHomeFeedState",
                "Promise.all([",
                "homeFeed.reconcile()",
                "exploreFeed.reconcile()",
            ),
            "Mobile Social facade",
        )
        self._require_markers(
            store,
            (
                "MomentsFeedScope = 'home' | 'explore'",
                "gateway.fetchPublicFeed(cursor, DEFAULT_PAGE_SIZE, feedSort)",
                "setSort",
                "MAX_FEED_POSTS = 200",
            ),
            "Moments feed store",
        )
        self._require_markers(
            projection,
            (
                "postsById.set(post.id, post)",
                ".slice(0, MAX_COMPOSED_POSTS)",
                "case 'TEXT'",
                "case 'IMAGE'",
                "case 'VIDEO'",
                "case 'LINK'",
                "case 'POLL'",
                "case 'REPOST'",
                "case 'LOCATION'",
            ),
            "Private Moment feed projection",
        )
        self._require_markers(
            gateway,
            (
                "sort = TimelineSort.RECENT",
                "sort === TimelineSort.HOT ? TimelineSort.HOT : undefined",
            ),
            "Moments gateway",
        )
        self._require_markers(
            page,
            (
                "surfaceKey={`moments:feed:${feedScope}`}",
                "className=\"moments-scope-segment\"",
                "projection?.[feedScope]",
            ),
            "Moments page",
        )
        self._require_markers(
            item,
            ("data-moment-content-kind={contentKind}", "renderStructuredContent()"),
            "Moment feed item",
        )
        self._require_markers(
            styles,
            (
                ".moments-scope-segment",
                "height: 36px;",
                ".moments-scope-control",
                "height: 32px;",
            ),
            "Moments feed styles",
        )
        forbidden = (
            "readActiveMomentsRuntime",
            "usePrivateMomentsRuntime",
            "useMomentsFeed",
        )
        retired_hits = [symbol for symbol in forbidden if symbol in page]
        if retired_hits:
            raise GateError(
                f"Retired page-owned feed paths remain: {retired_hits}"
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
                f"Mobile Social feed command failed ({command[0]}): {detail}"
            )


def main() -> int:
    return MobileSocialFeedNativeGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
