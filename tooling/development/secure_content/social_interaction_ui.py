"""Real comment controls and painted assertions for the existing Social Suite."""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Any

from selenium.common.exceptions import StaleElementReferenceException

from tooling.acceptance import search_capture
from tooling.acceptance.core.evidence_store import (
    current_run_directory,
    write_current_artifact,
)
from tooling.acceptance.gates.agent.foundation_runtime_client import (
    FoundationClientError,
    FoundationRuntimeClient,
    wait_until,
)
from .social_feed_ui import assert_identity_search, assert_stable_reconcile


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def action_enabled(element: Any) -> bool:
    """Whether a UI-kit action control can be activated.

    The design-system Button/IconButton never sets the native ``disabled``
    attribute: it stays focusable and signals unavailability through
    ``aria-disabled`` while intercepting the click. Checking only the native
    attribute therefore always reports "enabled" and silently clicks a blocked
    control, so both signals must agree before treating the control as live.
    """
    if element is None:
        return False
    if element.get_attribute("disabled") is not None:
        return False
    return element.get_attribute("aria-disabled") != "true"


# A successful click immediately triggers a React repaint (submit/toggle), so
# the resolved node can be replaced within the same call. Re-resolve a live
# node a bounded number of times instead of failing the whole Journey on one
# repaint race.
_STALE_CLICK_ATTEMPTS = 3


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

    def save_dom(self, path: Path) -> None:
        """Redact the Native snapshot before its single immutable write."""
        repo_root = self.client.spec.worktree
        run_root = current_run_directory(repo_root=repo_root)
        write_current_artifact(
            path.relative_to(run_root).as_posix(),
            self.driver.page_source.encode("utf-8"),
            repo_root=repo_root,
        )

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

    def attribute(self, selector: str, name: str, action: str) -> str:
        """Read an element attribute, re-resolving across repaint races.

        A painted comment/control node can be replaced between the locating
        wait and the read. ``wait_until`` already retries predicate failures,
        so a stale read is reported as "not ready" instead of aborting the
        Journey. Only use for attributes whose expected value is a non-empty
        string (never a legitimate ``None`` such as ``disabled``).
        """

        def read() -> str | None:
            element = self.visible(selector)
            if element is None:
                return None
            try:
                value = element.get_attribute(name)
            except StaleElementReferenceException:
                return None
            return value or None

        return wait_until(read, f"{self.actor} {action}", timeout=30)

    def attributes(self, selector: str, names: tuple[str, ...], action: str) -> dict[str, str]:
        """Read several attributes from one live node with stale retry."""

        def read() -> dict[str, str] | None:
            element = self.visible(selector)
            if element is None:
                return None
            try:
                values = {name: element.get_attribute(name) for name in names}
                tag_name = element.tag_name
            except StaleElementReferenceException:
                return None
            values["tag"] = tag_name
            return values

        return wait_until(read, f"{self.actor} {action}", timeout=30)

    def click(self, selector: str, action: str) -> Any:
        last_error: StaleElementReferenceException | None = None
        for _ in range(_STALE_CLICK_ATTEMPTS):
            element = wait_until(
                lambda: self.visible(selector),
                f"{self.actor} {action}",
                timeout=90,
            )
            try:
                # Read identity before activating: a successful submit/toggle
                # repaints and detaches the node right after click(), so any
                # post-click read would report staleness even though the
                # intended action already landed.
                tag_name = element.tag_name
                self.driver.execute_script(
                    "arguments[0].scrollIntoView({block:'center',inline:'nearest'});",
                    element,
                )
                element.click()
            except StaleElementReferenceException as error:
                # The node was replaced before or during an unconfirmed click;
                # re-resolve a live node and retry. A click that returns has
                # already been delivered and is never retried, so submit and
                # toggle actions cannot be duplicated by this recovery path.
                last_error = error
                continue
            self.actions.append({
                "actor": self.actor,
                "action": action,
                "selectorSha256": _digest(selector),
                "tag": tag_name,
                "automationSessionId": str(self.driver.session_id),
            })
            return element
        raise last_error or RuntimeError(
            f"{self.actor} {action} click did not resolve a stable element"
        )

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
        revealed: set[str] = set()

        def reveal_parent() -> bool:
            # A newly published head can be outside the retained feed viewport.
            # Reveal its actual control before Selenium rejects clipped nodes.
            for element in self.driver.find_elements("css selector", toggle):
                if element.id not in revealed:
                    self.driver.execute_script(
                        "arguments[0].scrollIntoView({block:'center',inline:'nearest'});",
                        element,
                    )
                    revealed.add(element.id)
            return self.visible(toggle) is not None

        wait_until(
            reveal_parent,
            f"{self.actor} private parent card",
            timeout=120,
        )
        expanded = self.attribute(toggle, "aria-expanded", "comment thread expansion")
        if expanded not in ("true", "false"):
            raise RuntimeError("Social comment control has no expansion state")
        if expanded == "false":
            self.click(toggle, "open-comment-thread")
        wait_until(
            lambda: self.attribute(toggle, "aria-expanded", "comment thread expanded")
            == "true",
            f"{self.actor} expanded private thread",
            timeout=30,
        )
        return post

    def assert_feed_search(self, post_id: str, text: str) -> dict[str, Any]:
        """Search the original acquired private parent through its real field."""
        post = self.open_thread(post_id)
        search = '.moments-app input[data-scope-search="feed"]'
        cards = '.moments-app [data-acceptance-id="social-moment-card"][data-post-id]'

        def card_ids() -> list[str]:
            return self.driver.execute_script(
                "return Array.from(document.querySelectorAll(arguments[0]), "
                "element => element.dataset.postId).sort();", cards,
            )

        before = card_ids()
        field = self.click(search, "search-private-parent")
        if field.get_attribute("value"):
            raise RuntimeError("AS20 private search must start with an empty query")

        def query(value: str) -> None:
            current = wait_until(
                lambda: self.visible(search), f"{self.actor} feed search field", timeout=30,
            )
            current.clear()
            if value:
                current.send_keys(value)

        try:
            query(text)
            wait_until(
                lambda: card_ids() == [post_id],
                f"{self.actor} private body search result", timeout=30,
            )
            target = wait_until(
                lambda: self.visible(post), f"{self.actor} searched private parent", timeout=30,
            )
            self.driver.execute_script(
                "arguments[0].scrollIntoView({block:'center',inline:'nearest'});", target,
            )

            def painted() -> bool:
                return card_ids() == [post_id] and self.driver.execute_script(
                    search_capture.TARGET_VISIBILITY_JS + """
                    const target = document.querySelector(arguments[0]);
                    const field = document.querySelector(arguments[1]);
                    const thread = target?.querySelector('[data-moments-comment-thread]');
                    return field?.value === arguments[2]
                      && target?.querySelector(':scope > .sk-post-body > p')?.textContent.includes(arguments[2])
                      && thread && !thread.querySelector('.pt-spinner')
                      && thread.querySelectorAll('[data-moments-comment]').length === 0
                      && Boolean(thread.querySelector('.pt-mom-comment-status')?.textContent.trim())
                      && targetVisibility(target, true).visible;
                    """, post, search, text,
                )

            capture_deadline = time.monotonic() + 30
            wait_until(painted, f"{self.actor} painted private search result", timeout=30)
            remaining_ms = max(1, int((capture_deadline - time.monotonic()) * 1000))
            if not self.driver.execute_async_script(
                search_capture.CAPTURE_PAINT_JS, remaining_ms,
            ) or time.monotonic() >= capture_deadline:
                try:
                    state = self.driver.execute_script("""
                      return {visibility: document.visibilityState,
                        hidden: document.hidden, width: innerWidth, height: innerHeight,
                        readyState: document.readyState};
                    """)
                    self.save_dom(self.evidence_root / "private-search-paint-timeout.html")
                except Exception as error:
                    state = {"diagnosticError": type(error).__name__}
                raise RuntimeError(f"Private search Native paint frames timed out: {state}")
            screenshot = self.evidence_root / "private-feed-search.png"
            dom = screenshot.with_suffix(".html")
            if not self.driver.save_screenshot(str(screenshot)):
                raise RuntimeError("Private search Native screenshot failed")
            self.save_dom(dom)
            if time.monotonic() >= capture_deadline:
                raise RuntimeError("Private search Native capture timed out")
            if not painted():
                raise RuntimeError("Private search changed during Native capture")
            self.artifacts.extend((screenshot, dom))
            query(text + "-no-matching-parent")
            wait_until(
                lambda: card_ids() == [], f"{self.actor} private search no match", timeout=30,
            )
        finally:
            query("")
        wait_until(
            lambda: card_ids() == before, f"{self.actor} cleared search restores feed", timeout=30,
        )
        return {
            "actor": self.actor,
            "querySha256": _digest(text),
            "postIdSha256": _digest(post_id),
            "matchedPrivateBody": True,
            "emptyThreadSettled": True,
            "noMatch": True,
            "clearedFeedRestored": True,
            "screenshot": str(screenshot),
            "dom": str(dom),
        }

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
            lambda: action_enabled(self.visible(send)),
            f"{self.actor} enabled comment submit",
            timeout=30,
        )
        self.click(send, "submit-reply" if reply_to else "submit-root-comment")
        depth = 1 if reply_to else 0
        row = self.row(post_id, text, depth)
        return self.attribute(row, "data-comment-id", "submitted comment identity")

    def assert_like(
        self, post_id: str, text: str, depth: int, count: int, liked: bool, phase: str,
        *, post_comment_count: int | None = None,
    ) -> str:
        row = self.row(post_id, text, depth)
        selector = f"{row} > .sk-comment-body > .sk-comment-meta [data-comment-like]"

        def settled() -> Any:
            control = self.visible(selector)
            if (
                action_enabled(control)
                and control.get_attribute("data-comment-like-count") == str(count)
                and control.get_attribute("aria-pressed") == str(liked).lower()
                and self.driver.execute_script(
                    """
                    const button = arguments[0], count = arguments[1];
                    const content = button.querySelector('.pt-button-content');
                    const emoji = content?.querySelector('.sk-comment-reaction-emoji');
                    const counter = content?.querySelector('.sk-comment-reaction-count');
                    const style = getComputedStyle(button);
                    const row = button.closest('[data-comment-id]');
                    const time = row?.querySelector(':scope > .sk-comment-body > .sk-comment-meta time');
                    const timestamp = time ? new Date(time.dateTime) : null;
                    const comments = button.closest('[data-post-id]')?.querySelector(
                      '[data-acceptance-id="social-open-comments"] .pt-button-content');
                    return emoji?.textContent === '👍'
                      && (count > 0 ? counter?.textContent.trim() === String(count) : !counter)
                      && !/Like|赞/.test(content?.textContent || '')
                      && button.getBoundingClientRect().height === 22
                      && style.padding === '0px' && style.borderWidth === '0px'
                      && ['transparent', 'rgba(0, 0, 0, 0)'].includes(style.backgroundColor)
                      && timestamp && Number.isFinite(timestamp.getTime())
                      && time.title === timestamp.toLocaleString()
                      && time.textContent.trim().length > 0
                      && time.textContent.trim() !== time.title
                      && (arguments[2] === null
                        || comments?.textContent.trim() === String(arguments[2]));
                    """,
                    control, count, post_comment_count,
                )
            ):
                return control
            return None

        try:
            control = wait_until(
                settled, f"{self.actor} {phase} LIKE {count}/{liked}", timeout=120,
            )
        except FoundationClientError as error:
            # Failure snapshots are diagnostics, never painted PASS evidence.
            # Preserve the original predicate and its deadline while recording
            # which combined condition failed before the Suite releases Native.
            diagnostic: dict[str, Any] = {
                "actor": self.actor, "phase": phase, "depth": depth,
                "postIdSha256": _digest(post_id),
                "commentTextSha256": _digest(text),
                "expected": {
                    "count": count, "liked": liked,
                    "postCommentCount": post_comment_count,
                },
            }
            stem = self.evidence_root / f"{len(self.assertions):02d}-{phase}-{depth}-failure"
            capture_errors: list[str] = []
            try:
                diagnostic["observed"] = self.driver.execute_script(
                    """
                    const button = document.querySelector(arguments[0]);
                    const count = arguments[1], liked = arguments[2], postCount = arguments[3];
                    if (!button) return {checks: {controlPresent: false}};
                    const content = button.querySelector('.pt-button-content');
                    const emoji = content?.querySelector('.sk-comment-reaction-emoji');
                    const counter = content?.querySelector('.sk-comment-reaction-count');
                    const style = getComputedStyle(button), rect = button.getBoundingClientRect();
                    const row = button.closest('[data-comment-id]');
                    const time = row?.querySelector(':scope > .sk-comment-body > .sk-comment-meta time');
                    const timestamp = time ? new Date(time.dateTime) : null;
                    const comments = button.closest('[data-post-id]')?.querySelector(
                      '[data-acceptance-id="social-open-comments"] .pt-button-content');
                    const numeric = value => /^\\d+$/.test(value || '') ? value : null;
                    return {
                      checks: {
                        controlPresent: true,
                        enabled: !button.hasAttribute('disabled') && button.getAttribute('aria-disabled') !== 'true',
                        count: button.getAttribute('data-comment-like-count') === String(count),
                        pressed: button.getAttribute('aria-pressed') === String(liked),
                        emoji: emoji?.textContent === '👍',
                        counter: count > 0 ? counter?.textContent.trim() === String(count) : !counter,
                        emojiOnly: !/Like|赞/.test(content?.textContent || ''),
                        height: rect.height === 22,
                        padding: style.padding === '0px',
                        border: style.borderWidth === '0px',
                        background: ['transparent', 'rgba(0, 0, 0, 0)'].includes(style.backgroundColor),
                        timestamp: Boolean(timestamp && Number.isFinite(timestamp.getTime())),
                        timeTooltip: Boolean(timestamp && time.title === timestamp.toLocaleString()),
                        relativeTime: Boolean(time && time.textContent.trim().length > 0
                          && time.textContent.trim() !== time.title),
                        postCommentCount: postCount === null
                          || comments?.textContent.trim() === String(postCount),
                      },
                      count: numeric(button.getAttribute('data-comment-like-count')),
                      pressed: button.getAttribute('aria-pressed'),
                      postCommentCount: numeric(comments?.textContent.trim()),
                      rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height},
                      style: {padding: style.padding, borderWidth: style.borderWidth,
                        backgroundColor: style.backgroundColor, display: style.display,
                        visibility: style.visibility, opacity: style.opacity},
                      viewport: {width: innerWidth, height: innerHeight},
                      visibilityState: document.visibilityState,
                    };
                    """,
                    selector, count, liked, post_comment_count,
                )
                elements = self.driver.find_elements("css selector", selector)
                diagnostic["observed"]["checks"]["nativeDisplayed"] = bool(
                    elements and elements[0].is_displayed()
                )
                diagnostic["observed"]["checks"]["visible"] = self.visible(selector) is not None
            except Exception as capture_error:
                capture_errors.append(f"observation:{type(capture_error).__name__}")
            for suffix in (".png", ".html"):
                path = stem.with_suffix(suffix)
                try:
                    if suffix == ".png":
                        if not self.driver.save_screenshot(str(path)):
                            raise RuntimeError("Native failure screenshot failed")
                    else:
                        self.save_dom(path)
                    self.artifacts.append(path)
                except Exception as capture_error:
                    capture_errors.append(f"{suffix}:{type(capture_error).__name__}")
            diagnostic["captureErrors"] = capture_errors
            checks = diagnostic.get("observed", {}).get("checks", {})
            failed = [name for name, passed in checks.items() if not passed]
            diagnostic["failedChecks"] = failed
            path = stem.with_suffix(".json")
            write_current_artifact(
                path.relative_to(current_run_directory(repo_root=self.client.spec.worktree)).as_posix(),
                json.dumps(diagnostic, ensure_ascii=False, indent=2).encode("utf-8"),
                repo_root=self.client.spec.worktree,
            )
            self.artifacts.append(path)
            raise FoundationClientError(
                f"{error}; failed checks: {', '.join(failed) or 'observation unavailable'}; "
                f"diagnostic: {path}"
            ) from error
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
        self.save_dom(dom)
        if painted() is None:
            raise RuntimeError("Private comment changed during Native painted capture")
        live_control = self.attributes(
            selector,
            ("data-comment-like-count", "aria-pressed"),
            f"{self.actor} {phase} painted LIKE state",
        )
        comment_id = self.attribute(
            row, "data-comment-id", f"{self.actor} {phase} comment identity"
        )
        self.artifacts.extend((screenshot, dom))
        self.assertions.append({
            "actor": self.actor,
            "phase": phase,
            "depth": depth,
            "postIdSha256": _digest(post_id),
            "commentTextSha256": _digest(text),
            "commentIdSha256": _digest(comment_id),
            "count": int(live_control["data-comment-like-count"]),
            "liked": live_control["aria-pressed"] == "true",
            "reactionPresentation": "emoji-only",
            "metadataCompact": True,
            "relativeTime": True,
            "postCommentCount": post_comment_count,
            "tag": live_control["tag"],
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


class SocialPollUI:
    """Use the same attached Driver and painted oracle for the shared poll form."""

    def __init__(self, client: FoundationRuntimeClient, actor: str, evidence_root: Path) -> None:
        self.controls = SocialCommentUI(client, actor, evidence_root)
        self.actor = actor
        self.driver = self.controls.driver
        self.actions = self.controls.actions
        self.assertions = self.controls.assertions
        self.artifacts = self.controls.artifacts
        self.evidence_root = self.controls.evidence_root

    def visible(self, selector: str) -> Any:
        return self.controls.visible(selector)

    def click(self, selector: str, action: str) -> Any:
        return self.controls.click(selector, action)

    def post_selector(self, post_id: str) -> str:
        return self.controls.post_selector(post_id)

    def open_poll(self, post_id: str) -> str:
        self.click(
            '[data-pt-primary-nav="moments"] button, '
            '[data-pt-primary-nav="moments"] [role="button"]',
            "moments-navigation",
        )
        selector = f'{self.post_selector(post_id)} [data-acceptance-id="social-poll"]'
        revealed: set[str] = set()

        def reveal_poll() -> Any:
            # Later posts and expanded comments push older polls outside the
            # clipped feed viewport. Scroll the actual Native element before
            # Selenium's visibility atom; waiting for visibility first can
            # never reveal that otherwise fully rendered poll.
            for element in self.driver.find_elements("css selector", selector):
                if element.id not in revealed:
                    self.driver.execute_script(
                        "arguments[0].scrollIntoView({block:'center',inline:'nearest'});",
                        element,
                    )
                    revealed.add(element.id)
            return self.visible(selector)

        wait_until(reveal_poll, f"{self.actor} private poll", timeout=120)
        return selector

    def select(self, post_id: str, choices: list[int]) -> None:
        selector = self.open_poll(post_id)
        controls = self.driver.find_elements("css selector", f"{selector} input")
        if not controls or choices != sorted(set(choices)) or any(
            index < 0 or index >= len(controls) for index in choices
        ):
            raise ValueError("Invalid poll UI selection")
        single = controls[0].get_attribute("type") == "radio"
        if single and len(choices) != 1:
            raise ValueError("Single-choice poll requires one choice")
        # Free capacity before adding replacement choices in a maxed-out ballot.
        order = sorted(range(len(controls)), key=lambda index: index in choices)
        for index in order:
            control = controls[index]
            checked = bool(self.driver.execute_script("return arguments[0].checked;", control))
            if (index in choices and not checked) or (
                not single and index not in choices and checked
            ):
                self.click(f'{selector} [data-poll-option="{index}"] label', "poll-select")
        wait_until(
            lambda: self.driver.execute_script(
                """
                return JSON.stringify([...arguments[0].querySelectorAll('input')]
                  .flatMap((e,i) => e.checked ? [i] : [])) === JSON.stringify(arguments[1]);
                """,
                self.visible(selector), choices,
            ),
            f"{self.actor} selected complete ballot",
            timeout=30,
        )

    def submit(self, post_id: str, choices: list[int]) -> None:
        self.select(post_id, choices)
        selector = f'{self.post_selector(post_id)} [data-acceptance-id="social-poll-submit"]'
        wait_until(
            lambda: action_enabled(self.visible(selector)),
            f"{self.actor} enabled ballot submit",
            timeout=30,
        )
        self.click(selector, "poll-submit")

    def cancel(self, post_id: str) -> None:
        self.click(
            f'{self.post_selector(post_id)} [data-action-id="moment.poll.cancel.{post_id}"]',
            "poll-cancel-selection",
        )

    def assert_poll(
        self, post_id: str, counts: list[int], choices: list[int], voters: int, phase: str,
        *, closed: bool = False,
    ) -> None:
        selector = self.open_poll(post_id)

        def settled() -> Any:
            element = self.visible(selector)
            if element is None:
                return None
            return element if self.driver.execute_script(
                """
                const p=arguments[0], counts=arguments[1], choices=arguments[2],
                  voters=arguments[3], closed=arguments[4];
                const selected=[...p.querySelectorAll('input')].flatMap((e,i)=>e.checked?[i]:[]);
                return p.dataset.pollState === (closed ? 'closed' : 'ready')
                  && JSON.stringify([...p.querySelectorAll('[data-poll-count]')]
                    .map(e=>e.dataset.pollCount)) === JSON.stringify(counts.map(String))
                  && JSON.stringify(selected) === JSON.stringify(choices)
                  && p.querySelector('[data-poll-voters]')?.dataset.pollVoters === String(voters)
                  && !p.querySelector('[role=alert]')
                  && (!closed || [...p.querySelectorAll('input')].every(e=>e.disabled));
                """,
                element, counts, choices, voters, closed,
            ) else None

        element = wait_until(settled, f"{self.actor} {phase} verified ballot", timeout=120)
        self.driver.execute_script(
            "arguments[0].scrollIntoView({block:'center',inline:'nearest'});", element,
        )

        def painted() -> Any:
            current = settled()
            return current if current is not None and self.driver.execute_script(
                search_capture.TARGET_VISIBILITY_JS
                + "\nreturn targetVisibility(arguments[0], true).visible;",
                current,
            ) else None

        element = wait_until(painted, f"{self.actor} unobscured poll", timeout=30)
        if not self.driver.execute_async_script(search_capture.CAPTURE_PAINT_JS, 2500):
            raise RuntimeError("Private poll Native paint frames timed out")
        screenshot = self.evidence_root / f"{len(self.assertions):02d}-poll-{phase}.png"
        dom = screenshot.with_suffix(".html")
        if not self.driver.save_screenshot(str(screenshot)):
            raise RuntimeError("Private poll Native screenshot failed")
        self.controls.save_dom(dom)
        if painted() is None:
            raise RuntimeError("Private poll changed during Native painted capture")
        self.artifacts.extend((screenshot, dom))
        self.assertions.append({
            "actor": self.actor, "phase": phase, "postIdSha256": _digest(post_id),
            "counts": counts, "choices": choices, "voters": voters, "closed": closed,
            "tag": element.tag_name, "automationSessionId": str(self.driver.session_id),
            "paintFrames": 2,
            "screenshot": {"path": str(screenshot), "sha256": hashlib.sha256(screenshot.read_bytes()).hexdigest()},
            "dom": {"path": str(dom), "sha256": hashlib.sha256(dom.read_bytes()).hexdigest()},
        })

    def assert_denied(self, post_id: str, phase: str) -> None:
        self.click(
            '[data-pt-primary-nav="moments"] button, '
            '[data-pt-primary-nav="moments"] [role="button"]',
            "moments-navigation",
        )
        selector = self.post_selector(post_id)

        def concealed() -> bool:
            return all(not self.driver.execute_script(
                """
                return Boolean(arguments[0].querySelector(
                  '[data-acceptance-id="social-poll"], [data-moments-body]'));
                """, element,
            ) for element in self.driver.find_elements("css selector", selector))

        wait_until(concealed, f"{self.actor} concealed private poll", timeout=120)
        if not self.driver.execute_async_script(search_capture.CAPTURE_PAINT_JS, 2500):
            raise RuntimeError("Private poll denial paint frames timed out")
        screenshot = self.evidence_root / f"{len(self.assertions):02d}-poll-{phase}.png"
        dom = screenshot.with_suffix(".html")
        if not self.driver.save_screenshot(str(screenshot)):
            raise RuntimeError("Private poll denial screenshot failed")
        self.controls.save_dom(dom)
        if not concealed():
            raise RuntimeError("Private poll resurrected during painted denial capture")
        self.artifacts.extend((screenshot, dom))
        self.assertions.append({
            "actor": self.actor, "phase": phase, "postIdSha256": _digest(post_id),
            "concealed": True, "tag": "body", "automationSessionId": str(self.driver.session_id),
            "paintFrames": 2,
            "screenshot": {"path": str(screenshot), "sha256": hashlib.sha256(screenshot.read_bytes()).hexdigest()},
            "dom": {"path": str(dom), "sha256": hashlib.sha256(dom.read_bytes()).hexdigest()},
        })


def exercise_private_poll(
    sender: SocialPollUI, receiver: SocialPollUI, *, post_id: str, multiple: bool,
) -> dict[str, Any]:
    """Submit and replace full ballots; counts always come from the painted owner."""
    first = [0, 1] if multiple else [1]
    retained = [1, 2] if multiple else [0]
    sender.submit(post_id, first)
    sender.assert_poll(post_id, [1, 1, 0] if multiple else [0, 1], first, 1, "first")
    receiver.assert_poll(post_id, [1, 1, 0] if multiple else [0, 1], [], 1, "first")
    receiver.submit(post_id, retained)
    counts = [1, 2, 1] if multiple else [1, 1]
    sender.assert_poll(post_id, counts, first, 2, "two-actors")
    receiver.assert_poll(post_id, counts, retained, 2, "two-actors")
    sender.submit(post_id, retained)
    counts = [0, 2, 2] if multiple else [2, 0]
    for ui in (sender, receiver):
        ui.assert_poll(post_id, counts, retained, 2, "replacement")
    sender.select(post_id, first)
    sender.cancel(post_id)
    sender.assert_poll(post_id, counts, retained, 2, "cancel")
    return {"postId": post_id, "counts": counts, "choices": retained, "voters": 2}


def exercise_comment_likes(
    sender: SocialCommentUI,
    receiver: SocialCommentUI,
    *,
    post_id: str,
    parent_text: str,
    root_text: str,
    reply_text: str,
) -> dict[str, Any]:
    """Real root/reply toggles on both clients in the original AS20 runtime."""
    if (sender.actor, receiver.actor) != ("bob", "alice"):
        raise ValueError("AS20 must consume the Suite's existing Bob and Alice bindings")
    searches = [
        client.assert_feed_search(post_id, parent_text) for client in (sender, receiver)
    ]
    identity_searches = [
        assert_identity_search(client, post_id) for client in (sender, receiver)
    ]
    root_id = sender.submit(post_id, root_text)
    receiver.open_thread(post_id)
    receiver.assert_like(
        post_id, root_text, 0, 0, False, "root-created", post_comment_count=1,
    )
    reply_id = receiver.submit(post_id, reply_text, reply_to=root_text)
    sender.assert_like(
        post_id, reply_text, 1, 0, False, "reply-created", post_comment_count=2,
    )
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
    reconciles = [
        assert_stable_reconcile(client, post_id) for client in (sender, receiver)
    ]
    return {
        "postId": post_id,
        "rootId": root_id,
        "replyId": reply_id,
        "feedSearch": searches,
        "identitySearch": identity_searches,
        "feedReconcile": reconciles,
        "actions": sender.actions + receiver.actions,
        "assertions": sender.assertions + receiver.assertions,
    }
