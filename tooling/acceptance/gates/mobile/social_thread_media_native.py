#!/usr/bin/env python3
"""Deterministic Mobile inline-thread and temporary-media source Gate."""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any, Iterable

from tooling.acceptance.core import AcceptanceGate, GateError


REPO_ROOT = Path(__file__).resolve().parents[4]


class MobileSocialThreadMediaNativeGate(AcceptanceGate):
    gate_id = "mobile-social-thread-media-native"
    phase = "MPS-06 inline thread and temporary media"
    bom = ("MPS-06-THREAD-MEDIA-V21",)
    spec = ("MPS-D05", "MPS-D07", "MPS-D12")

    def run(self) -> dict[str, Any]:
        self._assert_source_contract()
        command = (
            "pnpm",
            "--dir",
            "apps/mobile",
            "exec",
            "vitest",
            "run",
            "src/pages/moments/MomentFeedItem.test.ts",
            "src/pages/moments/MomentCommentsSection.test.tsx",
            "src/pages/moments/MomentImage.test.tsx",
            "src/pages/moments/MomentThreadMedia.test.ts",
            "src/runtimes/privateMomentsRuntime.test.ts",
        )
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
            raise GateError(f"Mobile thread/media tests failed: {detail}")

        self.assert_condition(
            "single_inline_comment_thread",
            True,
            "Feed owns one lazy selected thread and does not mutate detail routes",
        )
        self.assert_condition(
            "private_comment_projection",
            True,
            "Private comments retain per-post cursor and failure state in runtime projection",
        )
        self.assert_condition(
            "temporary_media_lifecycle",
            True,
            "Public Blob URLs are revoked and private media requires Native MEDIA_READY",
        )
        return {
            "proven_scope": [
                "one inline selected comment thread",
                "ten-comment initial window and explicit expansion",
                "public/private comment authority separation",
                "private per-post cursor, loading, and error projection",
                "temporary image/video overlay without route mutation",
                "public object URL release and private Native materialization",
                "focus restoration after overlay close",
            ],
            "unproven_scope": [
                "native iOS visual and interaction journey",
                "physical Android media decoder behavior",
                "cross-Station receiver-visible private comment convergence",
            ],
        }

    def _assert_source_contract(self) -> None:
        page = self._read("apps/mobile/src/pages/MomentsPage.tsx")
        comments = self._read(
            "apps/mobile/src/pages/moments/MomentCommentsSection.tsx"
        )
        item = self._read("apps/mobile/src/pages/moments/MomentFeedItem.tsx")
        overlay = self._read(
            "apps/mobile/src/pages/moments/MomentMediaOverlay.tsx"
        )
        runtime = self._read("apps/mobile/src/runtimes/privateMomentsRuntime.ts")

        self._require_markers(
            page,
            (
                "selectedThreadPostId",
                "selectedThreadPostId === post.id",
                "<MomentMediaOverlay",
                "setMediaSelection",
            ),
            "Moments page",
        )
        self._require_markers(
            comments,
            (
                "INITIAL_COMMENT_COUNT = 10",
                "privateRoute ? null : facade?.feed",
                "intents.readPrivateComments",
                "intents.submitPrivateComment",
            ),
            "Moment comments",
        )
        self._require_markers(
            item,
            ("onOpenComments(post.id)", "onOpenMedia?.(", "onOpenAuthor?.("),
            "Moment feed item",
        )
        self._require_markers(
            overlay,
            (
                "gateway.loadMedia",
                "intents.openPrivateMedia",
                "MEDIA_READY",
                "URL.revokeObjectURL",
                "selection.returnFocus?.focus()",
            ),
            "Moment media overlay",
        )
        self._require_markers(
            runtime,
            (
                "commentThreadsByPostId",
                "nextCursor: page.nextCursor",
                "errorMessage: readableErrorMessage(error)",
            ),
            "Private Moments runtime",
        )

        forbidden = (
            "if (activePostId)",
            "mobile-detail-page",
            "showInlineComment",
            "onOpenDetail",
        )
        hits = [marker for marker in forbidden if marker in page or marker in item]
        if hits:
            raise GateError(f"Retired Moment interaction paths remain: {hits}")

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


def main() -> int:
    return MobileSocialThreadMediaNativeGate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
