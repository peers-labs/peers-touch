"""Real comment controls and painted assertions for the existing Social Suite."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

from tooling.acceptance import search_capture
from tooling.acceptance.gates.agent.foundation_runtime_client import (
    FoundationRuntimeClient,
    wait_until,
)


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


class SocialCommentUI:
    """Attach to an already provisioned Native client; never create resources."""

    def __init__(self, client: FoundationRuntimeClient, actor: str, evidence_root: Path) -> None:
        if client.driver is None:
            raise RuntimeError("Social comment proof requires an attached driver")
        self.client = client
        self.actor = actor
        self.driver = client.driver
        self.actions: list[dict[str, Any]] = []
        self.assertions: list[dict[str, Any]] = []
        self.evidence_root = evidence_root / actor
        self.evidence_root.mkdir(parents=True, exist_ok=True)
        self.artifacts: list[Path] = []

    def visible(self, selector: str) -> Any:
        for element in self.driver.find_elements("css selector", selector):
            if element.is_displayed() and self.driver.execute_script(
                """
                const r = arguments[0].getBoundingClientRect();
                const s = getComputedStyle(arguments[0]);
                return r.width > 0 && r.height > 0 && s.visibility !== 'hidden'
                  && s.display !== 'none' && Number(s.opacity) > 0;
                """,
                element,
            ):
                return element
        return None

    def click(self, selector: str, action: str) -> Any:
        element = wait_until(
            lambda: self.visible(selector),
            f"{self.actor} {action}",
            timeout=90,
        )
        self.driver.execute_script(
            "arguments[0].scrollIntoView({block:'center',inline:'nearest'});",
            element,
        )
        element.click()
        self.actions.append({
            "actor": self.actor,
            "action": action,
            "selectorSha256": _digest(selector),
            "tag": element.tag_name,
            "automationSessionId": str(self.driver.session_id),
        })
        return element

    @staticmethod
    def post_selector(post_id: str) -> str:
        # Product IDs are generated opaque tokens, never arbitrary CSS input.
        if not post_id or any(c in post_id for c in ('"', "\\", "\n", "\r")):
            raise ValueError("Invalid Social post identity")
        return f'[data-acceptance-id="social-moment-card"][data-post-id="{post_id}"]'

    def open_thread(self, post_id: str) -> str:
        self.click(
            '[data-pt-primary-nav="moments"] button, '
            '[data-pt-primary-nav="moments"] [role="button"]',
            "moments-navigation",
        )
        post = self.post_selector(post_id)
        toggle = f'{post} [data-acceptance-id="social-open-comments"]'
        control = wait_until(
            lambda: self.visible(toggle),
            f"{self.actor} private parent card",
            timeout=120,
        )
        expanded = control.get_attribute("aria-expanded")
        if expanded not in ("true", "false"):
            raise RuntimeError("Social comment control has no expansion state")
        if expanded == "false":
            self.click(toggle, "open-comment-thread")
        wait_until(
            lambda: (current := self.visible(toggle)) is not None
            and current.get_attribute("aria-expanded") == "true",
            f"{self.actor} expanded private thread",
            timeout=30,
        )
        return post

    def row(self, post_id: str, text: str, depth: int) -> str:
        post = self.post_selector(post_id)

        def locate() -> str | None:
            for element in self.driver.find_elements(
                "css selector", f"{post} [data-moments-comment]"
            ):
                if (
                    element.is_displayed()
                    and element.get_attribute("data-depth") == str(depth)
                    and self.driver.execute_script(
                        """
                        return arguments[0].querySelector(
                          ':scope > .sk-comment-body > .sk-comment-line > .sk-comment-text'
                        )?.textContent === arguments[1];
                        """,
                        element, text,
                    )
                ):
                    comment_id = element.get_attribute("data-comment-id")
                    if not comment_id or any(c in comment_id for c in ('"', "\\")):
                        raise RuntimeError("Social comment row has invalid identity")
                    return f'{post} [data-comment-id="{comment_id}"]'
            return None

        return wait_until(locate, f"{self.actor} painted comment depth {depth}", timeout=120)

    def submit(self, post_id: str, text: str, *, reply_to: str | None = None) -> str:
        post = self.open_thread(post_id)
        if reply_to is not None:
            root = self.row(post_id, reply_to, 0)
            self.click(
                f"{root} > .sk-comment-body > .sk-comment-meta [data-moments-comment-reply]",
                "reply-to-comment",
            )
        selector = f'{post} [data-acceptance-id="social-comment-input"]'
        editor = wait_until(lambda: self.visible(selector), f"{self.actor} comment editor", timeout=30)
        # Use the native setter to update the React-controlled field deterministically.
        self.driver.execute_script(
            """
            const setter = Object.getOwnPropertyDescriptor(
              HTMLTextAreaElement.prototype, 'value').set;
            setter.call(arguments[0], arguments[1]);
            arguments[0].dispatchEvent(new Event('input', {bubbles:true}));
            arguments[0].dispatchEvent(new Event('change', {bubbles:true}));
            """,
            editor, text,
        )
        send = f'{post} [data-acceptance-id="social-comment-send"]'
        wait_until(
            lambda: (control := self.visible(send)) is not None
            and control.get_attribute("disabled") is None,
            f"{self.actor} enabled comment submit",
            timeout=30,
        )
        self.click(send, "submit-reply" if reply_to else "submit-root-comment")
        depth = 1 if reply_to else 0
        row = self.row(post_id, text, depth)
        return self.visible(row).get_attribute("data-comment-id")

    def assert_like(
        self, post_id: str, text: str, depth: int, count: int, liked: bool, phase: str
    ) -> str:
        row = self.row(post_id, text, depth)
        selector = f"{row} > .sk-comment-body > .sk-comment-meta [data-comment-like]"

        def settled() -> Any:
            control = self.visible(selector)
            if (
                control is not None
                and control.get_attribute("data-comment-like-count") == str(count)
                and control.get_attribute("aria-pressed") == str(liked).lower()
                and control.get_attribute("disabled") is None
            ):
                return control
            return None

        control = wait_until(settled, f"{self.actor} {phase} LIKE {count}/{liked}", timeout=120)
        if phase.startswith("before-"):
            return selector
        self.driver.execute_script(
            "arguments[0].scrollIntoView({block:'center',inline:'nearest'});", control,
        )

        def painted() -> Any:
            current = settled()
            if current is None:
                return None
            return current if self.driver.execute_script(
                search_capture.TARGET_VISIBILITY_JS
                + "\nreturn targetVisibility(arguments[0], true).visible;",
                current,
            ) else None

        control = wait_until(painted, f"{self.actor} unobscured LIKE button", timeout=30)
        if not self.driver.execute_async_script(search_capture.CAPTURE_PAINT_JS, 2500):
            raise RuntimeError("Private comment Native paint frames timed out")
        screenshot = self.evidence_root / f"{len(self.assertions):02d}-{phase}-{depth}.png"
        dom = screenshot.with_suffix(".html")
        if not self.driver.save_screenshot(str(screenshot)):
            raise RuntimeError("Private comment Native screenshot failed")
        dom.write_text(self.driver.page_source, encoding="utf-8")
        if painted() is None:
            raise RuntimeError("Private comment changed during Native painted capture")
        self.artifacts.extend((screenshot, dom))
        self.assertions.append({
            "actor": self.actor,
            "phase": phase,
            "depth": depth,
            "postIdSha256": _digest(post_id),
            "commentTextSha256": _digest(text),
            "commentIdSha256": _digest(self.visible(row).get_attribute("data-comment-id")),
            "count": int(control.get_attribute("data-comment-like-count")),
            "liked": control.get_attribute("aria-pressed") == "true",
            "tag": control.tag_name,
            "automationSessionId": str(self.driver.session_id),
            "paintFrames": 2,
            "screenshot": {"path": str(screenshot), "sha256": hashlib.sha256(screenshot.read_bytes()).hexdigest()},
            "dom": {"path": str(dom), "sha256": hashlib.sha256(dom.read_bytes()).hexdigest()},
        })
        return selector

    def toggle_like(
        self, post_id: str, text: str, depth: int, count: int, liked: bool, phase: str
    ) -> None:
        selector = self.assert_like(post_id, text, depth, count, liked, f"before-{phase}")
        self.click(selector, phase)

    def evidence(self, scenario_id: str, text: str) -> dict[str, Any]:
        if not self.actions or not self.assertions:
            raise RuntimeError("Social interaction needs real actions and painted assertions")
        return {
            "actionResourceId": "dom-action:" + _digest(f"{scenario_id}:{self.actor}")[:24],
            "receiverResourceId": "dom-receiver:" + _digest(f"{scenario_id}:{self.actor}:{text}")[:24],
            "actionTag": self.actions[-1]["tag"],
            "receiverTag": self.assertions[-1]["tag"],
            "actionTextSha256": _digest(self.actions[-1]["action"]),
            "visibleTextSha256": _digest(text),
            "absentTextSha256": [],
            "automationSessionId": str(self.driver.session_id),
            "pageUrlSha256": _digest(str(self.driver.current_url)),
        }


def exercise_comment_likes(
    sender: SocialCommentUI,
    receiver: SocialCommentUI,
    *,
    post_id: str,
    root_text: str,
    reply_text: str,
) -> dict[str, Any]:
    """Real root/reply toggles on both clients in the original AS20 runtime."""
    if (sender.actor, receiver.actor) != ("bob", "alice"):
        raise ValueError("AS20 must consume the Suite's existing Bob and Alice bindings")
    root_id = sender.submit(post_id, root_text)
    receiver.open_thread(post_id)
    receiver.assert_like(post_id, root_text, 0, 0, False, "root-created")
    reply_id = receiver.submit(post_id, reply_text, reply_to=root_text)
    sender.assert_like(post_id, reply_text, 1, 0, False, "reply-created")
    for text, depth, label in ((root_text, 0, "root"), (reply_text, 1, "reply")):
        for actor, peer, prefix in (
            (sender, receiver, "bob"), (receiver, sender, "alice"),
        ):
            actor.toggle_like(post_id, text, depth, 0, False, f"{prefix}-{label}-like")
            actor.assert_like(post_id, text, depth, 1, True, f"{prefix}-{label}-like")
            peer.assert_like(post_id, text, depth, 1, False, f"{prefix}-{label}-like")
            actor.toggle_like(post_id, text, depth, 1, True, f"{prefix}-{label}-unlike")
            actor.assert_like(post_id, text, depth, 0, False, f"{prefix}-{label}-unlike")
            peer.assert_like(post_id, text, depth, 0, False, f"{prefix}-{label}-unlike")
    # Persist one current LIKE on each row for replacement-device readback.
    for text, depth, label in ((root_text, 0, "root"), (reply_text, 1, "reply")):
        receiver.toggle_like(post_id, text, depth, 0, False, f"alice-{label}-retain")
        receiver.assert_like(post_id, text, depth, 1, True, f"alice-{label}-retain")
        sender.assert_like(post_id, text, depth, 1, False, f"alice-{label}-retain")
    return {
        "postId": post_id,
        "rootId": root_id,
        "replyId": reply_id,
        "actions": sender.actions + receiver.actions,
        "assertions": sender.assertions + receiver.assertions,
    }
