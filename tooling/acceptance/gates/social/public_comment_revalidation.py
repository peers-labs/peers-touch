"""Comment revalidation in the original public Suite, using real Native reads."""

from __future__ import annotations

from contextlib import contextmanager
from typing import TYPE_CHECKING, Any, Iterator

from tooling.acceptance import search_capture
from tooling.acceptance.core import GateError
from tooling.acceptance.gates.chat.native_support import cleanup_preserving_primary_failure, wait_until
from tooling.development.secure_content.social_feed_ui import (
    ACQUIRED_COMMENT_BASELINE_JS, CARDS, START_STABLE_FEED_JS,
)

if TYPE_CHECKING:
    from .public_feed_native import Gate


class PublicCommentRevalidation:
    """Attach to existing clients; never provision or fabricate a read payload."""

    def __init__(self, gate: Gate) -> None:
        self.gate = gate

    def start(self, actor: str, post: str, *, rows: int, expanded: bool, alive: bool = False) -> None:
        self.gate.clients[actor].execute_script(
            START_STABLE_FEED_JS, post, CARDS,
            {"rows": rows, "expanded": expanded, "editor": True, "alive": alive},
        )

    def stop(self, actor: str) -> Any:
        return self.gate.clients[actor].execute_script(
            "return window.__PT_SOCIAL_FEED_OBSERVATION__?.();",
        )

    def draft(self, actor: str, post: str) -> None:
        selector = f'{post} [data-acceptance-id="social-comment-input"]'
        self.gate.set_input(actor, selector, "Retained acceptance draft")
        self.gate.click(actor, selector)
        self.gate.clients[actor].execute_script(
            "document.querySelector(arguments[0]).setSelectionRange(2, 8);", selector,
        )

    def capture(self, actor: str, phase: str, **observation: Any) -> dict[str, Any]:
        client = self.gate.clients[actor]
        if not client.execute_async_script(search_capture.CAPTURE_PAINT_JS, 5000):
            raise GateError("Public Comment revalidation Native paint timed out")
        label = f"comment-revalidation-{phase}-{actor}"
        screenshot = self.gate.save_screenshot(client, label)
        dom = self.gate.save_dom(client, label)
        stats = self.stop(actor)
        if (not stats or stats["frames"] < 2 or stats["violations"]
            or (observation.get("aliveReturn") and
                (not stats["aliveReturned"] or stats["returnedFrames"] < 2))):
            raise GateError(f"Public Comment revalidation changed confirmed UI: {stats}")
        value = {"actor": actor, "phase": phase, **observation, **stats,
                 "screenshot": screenshot, "dom": dom}
        self.gate.report.runtime.setdefault("commentRevalidation", []).append(value)
        self.gate.assert_condition(label, True, "continuous Native frames and immutable capture")
        return value

    def stable(self, actor: str, post: str, *, phase: str, rows: int,
               expanded: bool = True, alive: bool = False) -> None:
        self.gate.open_comments(actor, post)
        wait_until(lambda: self.gate.clients[actor].execute_script(
            ACQUIRED_COMMENT_BASELINE_JS, post, rows,
        ), f"{actor} acquired Comment baseline", timeout=30)
        self.draft(actor, post)
        if not expanded:
            self.gate.click(actor, f'{post} [data-acceptance-id="social-open-comments"]')
        try:
            self.start(actor, post, rows=rows, expanded=expanded, alive=alive)
            if alive:
                self.gate.clients[actor].execute_script(
                    "return window.__PT_SOCIAL_FEED_OBSERVATION__('inactive');",
                )
                self.gate.click(actor, '[data-pt-primary-nav="chat"] button[data-action-id="primary-nav.chat"]')
                wait_until(lambda: not self.gate.visible_element(actor, post),
                           "Public Moments page inactive", timeout=30)
                self.gate.click(actor, '[data-pt-primary-nav="moments"] button[data-action-id="primary-nav.moments"]')
                wait_until(lambda: self.gate.visible_element(actor, post),
                           "Retained public Moments page active", timeout=30)
                self.gate.clients[actor].execute_script(
                    "return window.__PT_SOCIAL_FEED_OBSERVATION__('active');",
                )
            for _ in range(2):
                if self.gate.action(actor, "reconcileFeedProjection") != {"reconciled": True}:
                    raise GateError("Original public Moments reconcile did not complete")
            self.capture(actor, phase, rows=rows, expanded=expanded, aliveReturn=alive, runtimeReconciles=2)
        finally:
            cleanup_preserving_primary_failure(
                lambda: self.stop(actor), self.gate.report, "Public stable Comment observer")
            if not expanded:
                self.gate.open_comments(actor, post)
            cleanup_preserving_primary_failure(
                lambda: self.gate.set_input(actor, f'{post} [data-acceptance-id="social-comment-input"]', ""),
                self.gate.report, "Public stable Comment draft")

    @contextmanager
    def late_read(self, actor: str, post: str, *, phase: str, rows: int) -> Iterator[None]:
        """Hold an actual verified response before a real UI mutation publishes."""
        client = self.gate.clients[actor]
        post_id = client.execute_script("return document.querySelector(arguments[0]).dataset.postId;", post)
        try:
            self.gate.action(actor, "beginCommentReadReconcile", {"postId": post_id})
            wait_until(
                lambda: self.gate.action(actor, "commentReadReconcileStatus").get("state") == "held",
                "Original verified public Comment response held", timeout=15,
            )
            before = self.gate.action(actor, "commentReadReconcileStatus")
            if before != {"state": "held", "effectCount": 1, "reconciled": False}:
                raise GateError("Public Comment read fault did not affect one pending response")
            yield
            self.draft(actor, post)
            self.start(actor, post, rows=rows, expanded=True)
            released = self.gate.action(actor, "releaseCommentReadReconcile")
            if released != {"state": "released", "effectCount": 1, "reconciled": True}:
                raise GateError("Original delayed public Comment read did not finish")
            self.capture(actor, phase, rows=rows, expanded=True, verifiedResponseHeld=True, effectCount=1)
        finally:
            cleanup_preserving_primary_failure(
                lambda: self.stop(actor), self.gate.report, "Public late Comment observer")
            cleanup_preserving_primary_failure(
                lambda: self.gate.action(actor, "clearCommentReadReconcile"),
                self.gate.report, "Public late Comment read control")
            cleanup_preserving_primary_failure(
                lambda: self.gate.set_input(actor, f'{post} [data-acceptance-id="social-comment-input"]', ""),
                self.gate.report, "Public late Comment draft")

    def delete_disposable(self, actor: str, post: str, text: str) -> None:
        row = self.gate.comment_selector(actor, post, text)
        comment_id = self.gate.clients[actor].execute_script(
            "return document.querySelector(arguments[0]).dataset.commentId;", row,
        )
        self.gate.click(actor, f"{row} [data-comment-delete]")
        self.gate.click(actor, f'[data-action-id="comment.delete.confirm.{comment_id}"]')
        wait_until(lambda: self.gate.clients[actor].execute_script(
            "return !document.querySelector(arguments[0]);", row,
        ), "Confirmed public Comment deletion", timeout=30)
