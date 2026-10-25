"""One continuous, source-bound native device Search journey."""
from __future__ import annotations

import json
import math
import re
import tempfile
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.keys import Keys

from tooling.acceptance.core import AcceptanceGate, GateError
from tooling.acceptance.gates.chat.native_support import (
    DEV_ACCOUNT_PASSWORD, async_harness, is_native_tauri_url, selected_native_runtime,
)
from tooling.acceptance.gates.chat.native_two_client_runner import (
    NativeTwoClientGate, read_station_version, wait_until,
)

GATE_ID = "chat-device-search-native-e2e"
JOURNEY_ID = "device-search"
UI_ASSERTIONS = {
    "chinese_search", "attachment_filename", "historical_open", "thread_open",
    "pagination",
    "repeat_cache", "reopen_cache", "backspace_cache", "return_cache",
    "input_continuity", "responsive_geometry",
    "explicit_refresh", "edit_invalidation", "hide_invalidation",
    "functions_navigation", "empty_state", "invalid_query_recovery",
    "logout_clears_search", "same_window_account_isolation",
}
RESULT_ASSERTIONS = UI_ASSERTIONS - {
    "historical_open", "thread_open", "hide_invalidation",
    "functions_navigation", "empty_state", "logout_clears_search",
}
REQUIRED_ASSERTIONS = UI_ASSERTIONS | {
    "native_runtime", "source_build_runtime_identity", "actor_isolation",
    "search_geometry_stability",
    "forged_authority_denied", "stale_content_denied", "hidden_reference_denied",
    "previous_session_cursor_denied", "sender_session_revoked", "resources_released",
}
REQUIRED_STEPS = {
    "station.identity", "fixture.reset", "client.authenticated",
    "runtime.source_identity", "search.surface_ready",
    "conversation.open", "message.seed", "search.sender_session_revoked",
    "search.account_scope_seed", "search.account_scope_result",
} | {f"search.{name}" for name in UI_ASSERTIONS}

GEOMETRY_REGIONS = ("panel", "field", "intents", "body", "footer", "coverage", "actions")


def stable_search_geometry(samples: list[dict[str, Any]]) -> bool:
    """Compare real painted regions only within the same native viewport."""
    baselines: dict[tuple[float, float], dict[str, Any]] = {}
    if not samples:
        return False
    for sample in samples:
        viewport = sample.get("viewport", {})
        if not isinstance(viewport, dict):
            return False
        size = tuple(viewport.get(axis) for axis in ("width", "height"))
        if not all(isinstance(value, (int, float)) and not isinstance(value, bool)
                   and math.isfinite(value) and value > 0 for value in size):
            return False
        baseline = baselines.setdefault(size, sample)
        for region in GEOMETRY_REGIONS:
            rect = sample.get(region, {})
            reference = baseline.get(region, {})
            if not isinstance(rect, dict) or not isinstance(reference, dict):
                return False
            for axis in ("x", "y", "width", "height"):
                value, original = rect.get(axis), reference.get(axis)
                if not isinstance(value, (int, float)) or isinstance(value, bool) \
                        or not math.isfinite(value) or not isinstance(original, (int, float)) \
                        or abs(value - original) > 1:
                    return False
            if rect["width"] <= 0 or rect["height"] <= 0:
                return False
        panel = sample["panel"]
        if panel["x"] < 0 or panel["y"] < 0 \
                or panel["x"] + panel["width"] > size[0] + 1 \
                or panel["y"] + panel["height"] > size[1] + 1:
            return False
        for region in GEOMETRY_REGIONS[1:]:
            rect = sample[region]
            if rect["x"] < panel["x"] - 1 or rect["y"] < panel["y"] - 1 \
                    or rect["x"] + rect["width"] > panel["x"] + panel["width"] + 1 \
                    or rect["y"] + rect["height"] > panel["y"] + panel["height"] + 1:
                return False
    return True


def read_counts(lines: list[str]) -> dict[str, int]:
    clean = [re.sub(r"\x1b\[[0-9;]*m", "", line) for line in lines]
    return {
        "lineCount": len(lines),
        "sourceReads": sum(
            "Search read" in line and re.search(r"source_read[=:]\s*true", line) is not None
            for line in clean
        ),
        "hydrationReads": sum(
            int(value) for line in clean
            if "Search hydration" in line
            for value in re.findall(r"source_reads[=:]\s*(\d+)", line)
        ),
    }


class DeviceSearchGate(NativeTwoClientGate):
    gate_id = GATE_ID
    journey_id = JOURNEY_ID
    phase = "chat-device-search"
    bom = ("SEARCH-DEVICE-FIND-OPEN",)
    spec = ("chat-device-search",)
    history_count = 55

    def __init__(self) -> None:
        selected = selected_native_runtime(self.gate_id)
        if selected is None or selected.binding.cell_id != "desktop-macos-native":
            raise GateError("Search requires the selected native macOS runtime")
        super().__init__(
            manifest=selected.manifest, actor_manifest=selected.actor_manifest,
            runtime_binding=selected.binding, gate_id=self.gate_id, journey_id=self.journey_id,
        )
        # Bob sends the first content; creation must populate his native owner
        # before Alice can receive and project the conversation.
        self.direction_order = ("bob", "alice")
        self.token = uuid.uuid4().hex[:12]
        self.query = f"周会 {self.token}"
        self.conversation = ""
        self.message = ""
        self.reply = ""
        self.report.runtime["search"] = {"cache": {}, "resources": {}, "ui": {}}

    @property
    def receiver(self) -> Any:
        return self.clients["alice"]

    def wait_js(self, expression: str, description: str, timeout: float = 30) -> Any:
        return wait_until(
            lambda: self.receiver.execute_script(f"return Boolean({expression});"),
            description, timeout=timeout,
        )

    def field(self) -> Any:
        return self.receiver.find_element(".pt-search-field input", 20)

    def press(self, key: str) -> None:
        self.receiver.execute_script(
            "arguments[0].focus({preventScroll: true});", self.field(),
        )
        ActionChains(self.receiver.driver).send_keys(key).perform()

    def surface(self) -> dict[str, Any]:
        return self.receiver.execute_script("""
            const field = document.querySelector('.pt-search-field');
            const modal = field?.closest('.ant-modal');
            const result = {
                searchOpen: !!field, painted: !field,
                visibilityState: document.visibilityState,
                modalClass: modal?.className || '',
                query: field?.querySelector('input')?.value || '',
                displayedQuery: document.querySelector('.pt-search-body')?.dataset.displayedQuery || '',
                busy: document.querySelector('.pt-search-body')?.getAttribute('aria-busy') === 'true',
                bodyText: document.querySelector('.pt-search-body')?.innerText || '',
                resultCount: document.querySelectorAll('.pt-search-row').length,
                resultText: [...document.querySelectorAll('.pt-search-row')]
                    .map(row => row.innerText).join('\\n'),
                loading: !!document.querySelector('.pt-search-status'),
            };
            if (!field || !modal) return result;
            const rect = field.getBoundingClientRect();
            result.bounds = rect.toJSON();
            result.geometry = {
                viewport: {width: innerWidth, height: innerHeight},
                ...Object.fromEntries(Object.entries({
                    panel: '.ant-modal-container', field: '.pt-search-field',
                    intents: '.pt-search-intents', body: '.pt-search-body',
                    footer: '.pt-search-footer', coverage: '.pt-search-coverage',
                    actions: '.pt-search-footer-actions',
                }).map(([region, selector]) => [
                    region, modal.querySelector(selector)?.getBoundingClientRect().toJSON(),
                ])),
            };
            result.opacity = getComputedStyle(modal).opacity;
            result.motionActive = false;
            let visible = rect.width > 0 && rect.height > 0
                && rect.left >= 0 && rect.top >= 0
                && rect.right <= innerWidth && rect.bottom <= innerHeight;
            for (let node = field; node && visible; node = node.parentElement) {
                const style = getComputedStyle(node);
                result.motionActive ||= node.getAnimations().some(
                    animation => animation.pending || animation.playState === 'running',
                );
                visible = style.display !== 'none' && style.visibility === 'visible'
                    && Number(style.opacity) >= 0.99;
            }
            const hit = document.elementFromPoint(
                rect.left + rect.width / 2, rect.top + rect.height / 2,
            );
            result.painted = visible && !result.motionActive && !modal.className.includes('prepare')
                && !!hit && modal.contains(hit);
            return result;
        """)

    def wait_surface(self) -> dict[str, Any]:
        try:
            return wait_until(
                lambda: (state if (state := self.surface()).get("painted") else None),
                "painted native Search surface", timeout=30,
            )
        except GateError:
            self.report.runtime["search"]["surfaceReadiness"] = {
                **self.surface(),
                "screenshot": self.save_screenshot(self.receiver, "surface-readiness"),
                "dom": self.save_dom(self.receiver, "surface-readiness"),
            }
            raise

    def open_search(self) -> None:
        if not self.receiver.find_elements(".pt-search-field input"):
            self.receiver.find_element(
                '[data-pt-primary-nav="search"] [role="button"]', 20,
            ).click()
        self.field()
        self.record_geometry("surface_ready", self.wait_surface())
        self.assert_condition(
            "search_singleton",
            len(self.receiver.find_elements(".pt-search-field input")) == 1,
        )

    def record_geometry(self, name: str, rendering: dict[str, Any]) -> None:
        if not rendering.get("searchOpen"):
            return
        samples = self.report.runtime["search"].setdefault("geometry", [])
        samples.append({"name": name, **rendering.get("geometry", {})})
        self.assert_condition("search_geometry_stability", stable_search_geometry(samples),
                              f"painted Search geometry across {len(samples)} observations")

    def settled(self) -> None:
        self.wait_js(
            "document.querySelector('.pt-search-field input')"
            " && document.querySelector('.pt-search-body')?.getAttribute('aria-busy') === 'false'"
            " && (document.querySelector('.pt-search-error')"
            " || document.querySelector('[data-search-filter=\"functions\"]')?.getAttribute('aria-selected') === 'true'"
            " || document.querySelector('.pt-search-body')?.dataset.displayedQuery"
            " === document.querySelector('.pt-search-field input')?.value.trim())",
            "settled Search UI",
        )

    def fill(self, query: str) -> None:
        field = self.field()
        field.clear()
        field.send_keys(query)
        self.wait_js(
            f"document.querySelector('.pt-search-field input')?.value === {json.dumps(query)}",
            "Search input acknowledgement",
        )
        # Wait for debounce admission, then the terminal UI; no fixed idle delay.
        self.wait_js(
            "document.querySelector('.pt-search-row')"
            " || document.querySelector('.pt-search-empty')"
            " || document.querySelector('.pt-search-error')",
            "Search terminal content",
        )
        self.settled()

    def submit(self, query: str) -> None:
        self.open_search()
        messages = self.receiver.find_element('[data-search-filter="messages"]')
        if messages.get_attribute("aria-selected") != "true":
            messages.click()
        self.fill(query)
        self.press(Keys.ENTER)
        self.settled()

    def rows(self) -> str:
        return str(self.receiver.execute_script(
            "return [...document.querySelectorAll('.pt-search-row')]"
            ".map(row => row.innerText).join('\\n');",
        ))

    def retain_pagination_failure(self) -> None:
        """Read the failed presentation without issuing another native query."""
        diagnostic: dict[str, Any] = {"assertionPassed": False}
        self.report.runtime["search"]["paginationFailure"] = diagnostic
        try:
            diagnostic["surface"] = self.receiver.execute_script("""
                const body = document.querySelector('.pt-search-body');
                const more = document.querySelector('.pt-search-more');
                return {
                    rowCount: document.querySelectorAll('.pt-search-row').length,
                    busy: body?.getAttribute('aria-busy') === 'true',
                    error: !!document.querySelector('.pt-search-error'),
                    loading: !!document.querySelector('.pt-search-status'),
                    hasMoreControl: !!more, moreDisabled: more?.disabled ?? null,
                    visibilityState: document.visibilityState,
                };
            """)
            view = async_harness(self.receiver, "deviceSearchPresentation", {}, timeout=5)
            page = view.get("page") or {}
            diagnostic["presentation"] = {
                "open": view.get("open"), "status": view.get("status"),
                "filter": view.get("filter"), "rowCount": len(page.get("items", [])),
                "hasMore": page.get("hasMore", False),
                "nextCursor": page.get("nextCursor", ""),
                "sources": page.get("sources", []), "coverage": page.get("coverage", []),
            }
            diagnostic["screenshot"] = self.save_screenshot(self.receiver, "pagination-failure")
            diagnostic["dom"] = self.save_dom(self.receiver, "pagination-failure")
        except Exception as error:
            # A diagnostic failure must never replace the original product failure.
            diagnostic["errorType"] = type(error).__name__

    def visible(self, name: str, predicate: Any, detail: Any = None) -> None:
        def observe() -> None:
            with tempfile.TemporaryDirectory(prefix="search-capture-") as directory:
                screenshot_path = Path(directory) / "frame.png"
                dom_path = Path(directory) / "frame.html"

                def capture() -> dict[str, Any] | None:
                    rendering = self.surface()
                    if not rendering["painted"] or rendering["loading"] or rendering["busy"] or not predicate():
                        return None
                    self.receiver.save_screenshot(screenshot_path)
                    dom_path.write_text(self.receiver.get_page_source())
                    after = self.surface()
                    matched = bool(predicate())
                    if after != rendering or not matched:
                        return None
                    return {**rendering, "assertionPassed": matched}

                try:
                    rendering = wait_until(
                        capture, f"stable painted Search evidence for {name}", timeout=30,
                    )
                except GateError:
                    self.report.runtime["search"]["captureFailure"] = {
                        "assertion": name, "rendering": self.surface(),
                        "screenshot": self.save_screenshot(self.receiver, f"{name}-capture-failure"),
                        "dom": self.save_dom(self.receiver, f"{name}-capture-failure"),
                    }
                    raise
                screenshot = self.report.add_evidence_file(
                    f"{name}-screenshot", screenshot_path, destination_dir=self.evidence_dir,
                )
                dom = self.report.add_evidence_file(
                    f"{name}-dom", dom_path, destination_dir=self.evidence_dir,
                )
            self.record_geometry(name, rendering)
            self.assert_condition(name, rendering["assertionPassed"], json.dumps(detail))
            self.report.runtime["search"]["ui"][name] = {
                "actor": "alice", "screenshot": screenshot, "dom": dom,
                "rendering": rendering,
                "query": rendering["query"],
            }
        self.step(f"search.{name}", observe, "alice")

    def counts(self) -> dict[str, int]:
        path = Path(self.receiver.log_path)
        if not path.is_file():
            raise GateError("Search source-read diagnostic log is missing")
        return read_counts(path.read_text(errors="replace").splitlines())

    def cached(self, name: str, action: Any) -> None:
        before = self.counts()
        action()
        self.settled()
        after = self.counts()
        self.report.runtime["search"]["cache"][name] = {"before": before, "after": after}
        self.visible(name, lambda: (
            self.field().get_attribute("value") == self.query
            and self.token in self.rows() and before["sourceReads"] == after["sourceReads"]
            and before["hydrationReads"] == after["hydrationReads"]
        ))
        after = self.counts()
        self.report.runtime["search"]["cache"][name]["after"] = after
        self.assert_condition(name, (
            before["sourceReads"] == after["sourceReads"]
            and before["hydrationReads"] == after["hydrationReads"]
        ))

    def native_page(self, query: str) -> dict[str, Any]:
        result = async_harness(self.receiver, "deviceSearchPage", {
            "query": query, "requestId": uuid.uuid4().hex,
        })
        if result.get("accepted") is not True:
            raise GateError(f"Search native diagnostic query failed: {result}")
        return result["page"]

    def resolve(self, resource: dict[str, Any]) -> dict[str, Any]:
        return async_harness(self.receiver, "deviceSearchResolve", {
            "resource": resource, "sourceId": "device.messaging", "requestId": uuid.uuid4().hex,
        })

    def message_ref(self) -> dict[str, Any]:
        page = self.native_page(self.query)
        return next(
            item["resource"] for item in page.get("items", [])
            if item.get("resource", {}).get("messageId") == self.message
        )

    def denied(self, name: str, resource: dict[str, Any], code: int) -> None:
        result = self.resolve(resource)
        self.report.runtime["search"].setdefault("denials", {})[name] = result
        self.assert_condition(name, result.get("accepted") is False and result.get("errorCode") == code)

    def seed(self) -> None:
        payload = {"conversationId": self.conversation, "kind": "friend"}
        sent = async_harness(self.clients["bob"], "sendInteractionMessage", {
            **payload, "content": f"{self.query} 原始正文",
        }, timeout=90)
        self.message = str(sent.get("messageId") or "")
        reply = async_harness(self.clients["bob"], "sendInteractionMessage", {
            **payload, "content": f"线程 {self.token}",
            "threadRootMessageId": self.message, "replyToMessageId": self.message,
        }, timeout=90)
        self.reply = str(reply.get("messageId") or "")
        if not self.message or not self.reply:
            raise GateError("Search seed requires real committed message identities")
        filler = async_harness(self.clients["bob"], "sendInteractionMessageBatch", {
            **payload, "prefix": f"filler-{self.token}", "count": self.history_count,
        }, timeout=180)
        if len(filler.get("messageIds", [])) != self.history_count:
            raise GateError("Search history fixture did not commit every required message")
        # Sender commits do not prove the receiver has synchronized the batch.
        # This native-owner receipt is Fixture readiness; Search still uses UI.
        self.report.runtime["search"]["resources"].update({
            "conversationId": self.conversation, "messageId": self.message,
            "replyId": self.reply, "fillerIds": filler["messageIds"],
        })
        received: set[str] = set()

        def received_message(message_id: str) -> bool:
            if message_id not in received:
                page = async_harness(self.receiver, "messagePage", {
                    "conversationId": self.conversation, "limit": 100,
                })
                received.update(page.get("messageIds", []))
            return message_id in received

        for message_id in filler["messageIds"]:
            wait_until(
                lambda message_id=message_id: received_message(message_id),
                "receiver commits seeded message", timeout=30,
            )
        self.report.runtime["search"]["resources"]["receiverFillerIds"] = sorted(
            received.intersection(filler["messageIds"]),
        )

    def upload(self) -> None:
        sender = self.clients["bob"]
        with tempfile.TemporaryDirectory(prefix="search-upload-") as directory:
            source = Path(directory) / f"附件计划-{self.token}.txt"
            source.write_text(f"Search real attachment {self.token}\n")
            native_path = self.runtime_binding.stage_native_file("bob", source)
            sent = async_harness(sender, "sendInteractionMessage", {
                "conversationId": self.conversation, "kind": "friend",
                "content": f"附件 {self.token}",
                "attachments": [{
                    "filePath": str(native_path), "filename": source.name,
                    "mimeType": "text/plain", "contentKind": "file", "durationMs": 0,
                }],
            }, timeout=90)
            if not sent.get("messageId") or len(sent.get("attachmentIds", [])) != 1:
                raise GateError("Search attachment requires a real Messaging upload")
            self.report.runtime["search"]["resources"].update({
                "attachmentMessageId": sent["messageId"],
                "attachmentIds": sent["attachmentIds"], "attachmentFilename": source.name,
            })
            self.submit("附件计划")
            self.wait_js(
                f"document.querySelector('.pt-search-body')?.innerText.includes({json.dumps(source.name)})",
                "received attachment filename in Search", timeout=90,
            )
            self.visible("attachment_filename", lambda: source.name in self.rows())

    def open_target(self, name: str, query: str, target: str, attribute: str) -> None:
        self.submit(query)
        self.receiver.find_element(".pt-search-row", 20).click()
        self.wait_js(
            f"document.activeElement?.getAttribute({json.dumps(attribute)}) === {json.dumps(target)}",
            "actual Chat anchor",
        )
        self.visible(name, lambda: not self.receiver.find_elements(".pt-search-field"))
        self.receiver.find_element("[data-search-return] button", 20).click()
        self.field()
        self.settled()

    def prove_cache(self) -> None:
        self.submit(self.query)
        self.visible("chinese_search", lambda: self.query in self.rows())
        self.cached("repeat_cache", lambda: self.press(Keys.ENTER))
        def reopen() -> None:
            self.press(Keys.ESCAPE)
            self.wait_js("!document.querySelector('.pt-search-field')", "Search closed")
            self.open_search()
        self.cached("reopen_cache", reopen)
        # Warm suggest separately; returning to the prefix reuses that frame.
        self.fill(self.query)
        self.prove_input_continuity()
        self.press(Keys.ENTER)
        self.settled()
        before = self.counts()
        self.receiver.find_element(".pt-search-footer button", 20).click()
        self.settled()
        after = self.counts()
        self.report.runtime["search"]["cache"]["explicit_refresh"] = {
            "before": before, "after": after,
        }
        self.visible("explicit_refresh", lambda: (
            self.query in self.rows() and after["sourceReads"] > before["sourceReads"]
        ))
        self.report.runtime["search"]["cache"]["explicit_refresh"]["after"] = self.counts()
        self.receiver.find_element(".pt-search-row", 20).click()
        self.wait_js("!document.querySelector('.pt-search-field')", "Chat open")
        self.cached("return_cache", lambda: (
            self.receiver.find_element("[data-search-return] button", 20).click(), self.field()
        ))

    def prove_input_continuity(self) -> None:
        self.receiver.execute_script("""
            window.__searchContinuity = {active: true, frames: []};
            const sample = () => {
                const trace = window.__searchContinuity;
                if (!trace.active || trace.frames.length >= 600) return;
                const body = document.querySelector('.pt-search-body');
                trace.frames.push({
                    draft: document.querySelector('.pt-search-field input')?.value,
                    displayed: body?.dataset.displayedQuery,
                    rows: [...document.querySelectorAll('.pt-search-row')].map(row => row.innerText),
                    marks: [...document.querySelectorAll('.pt-search-body mark')].map(mark => mark.textContent),
                    field: document.querySelector('.pt-search-field')?.getBoundingClientRect().toJSON(),
                    body: body?.getBoundingClientRect().toJSON(),
                    viewport: {width: innerWidth, height: innerHeight},
                    panel: document.querySelector('.pt-search-modal .ant-modal-container')?.getBoundingClientRect().toJSON(),
                    intents: document.querySelector('.pt-search-intents')?.getBoundingClientRect().toJSON(),
                    footer: document.querySelector('.pt-search-footer')?.getBoundingClientRect().toJSON(),
                    coverage: document.querySelector('.pt-search-coverage')?.getBoundingClientRect().toJSON(),
                    actions: document.querySelector('.pt-search-footer-actions')?.getBoundingClientRect().toJSON(),
                });
                requestAnimationFrame(sample);
            };
            sample();
        """)
        try:
            self.field().send_keys("z")
            self.settled()
            self.cached("backspace_cache", lambda: self.press(Keys.BACKSPACE))
        finally:
            frames = self.receiver.execute_script(
                "window.__searchContinuity.active = false; return window.__searchContinuity.frames;",
            )
        baseline = frames[0]
        pending = [frame for frame in frames
                   if frame["draft"] == self.query + "z" and frame["displayed"] == self.query]
        retained = bool(pending) and all(
            frame["rows"] == baseline["rows"] and frame["marks"] == baseline["marks"]
            for frame in pending
        )
        geometry = stable_search_geometry(frames)
        self.report.runtime["search"]["continuity"] = {"frames": frames}
        self.visible("input_continuity", lambda: (
            retained and geometry and self.surface()["displayedQuery"] == self.query
            and self.query in self.rows()
        ), {"retained": retained, "geometry": geometry, "frameCount": len(frames)})

    def prove_mutations(self) -> None:
        self.submit(self.query)
        original = self.message_ref()
        forged = {**original, "authorityNamespace": "station:forged"}
        self.denied("forged_authority_denied", forged, 7)
        edited = f"{self.query} 更新正文"
        async_harness(self.clients["bob"], "editInteractionMessage", {
            "conversationId": self.conversation, "kind": "friend",
            "messageId": self.message, "plaintext": edited,
        }, timeout=60)
        self.wait_js(
            f"document.querySelector('.pt-search-body')?.innerText.includes({json.dumps(edited)})",
            "receiver Search real edit invalidation", timeout=90,
        )
        self.visible("edit_invalidation", lambda: "原始正文" not in self.rows() and edited in self.rows())
        self.denied("stale_content_denied", original, 8)
        fresh = self.message_ref()
        async_harness(self.receiver, "deleteLocalInteractionMessage", {
            "conversationId": self.conversation, "kind": "friend", "messageId": self.message,
        }, timeout=60)
        self.wait_js(
            "!document.querySelector('.pt-search-row') && !!document.querySelector('.pt-search-empty')",
            "actor-hidden Search result removal", timeout=90,
        )
        self.visible("hide_invalidation", lambda: edited not in self.rows())
        self.denied("hidden_reference_denied", fresh, 8)
        self.report.runtime["search"]["resources"]["hiddenRef"] = fresh

    def prove_responsive_geometry(self) -> None:
        driver = self.receiver.driver
        original = driver.get_window_rect()
        viewport = self.receiver.execute_script(
            "return {width: innerWidth, height: innerHeight, scale: devicePixelRatio};",
        )
        scale = viewport["scale"]
        chrome = {
            axis: original[axis] - round(viewport[axis] * scale)
            for axis in ("width", "height")
        }
        observations = []
        self.report.runtime["search"]["responsiveGeometry"] = observations
        try:
            for name, width, height in (("wide", 1200, 800), ("short", 860, 640)):
                driver.set_window_size(round(width * scale) + chrome["width"],
                                       round(height * scale) + chrome["height"])
                self.wait_js(f"innerWidth === {width} && innerHeight === {height}",
                             f"actual {name} native viewport", timeout=10)
                self.submit(self.query)
                before = self.wait_surface()
                self.record_geometry(name + "_results", before)
                self.fill(f"geometry-empty-{self.token}")
                after = self.wait_surface()
                self.record_geometry(name + "_empty", after)
                observations.append({
                    "name": name, "results": before, "empty": after,
                    "screenshot": self.save_screenshot(self.receiver, name + "-geometry"),
                    "dom": self.save_dom(self.receiver, name + "-geometry"),
                })
                self.assert_condition("search_geometry_stability", (
                    self.query in before["resultText"]
                    and after["resultCount"] == 0
                    and "geometry-empty-" in after["bodyText"]
                ))
        finally:
            driver.set_window_rect(**original)
            self.wait_js(
                f"innerWidth === {viewport['width']} && innerHeight === {viewport['height']}",
                "restored original native viewport", timeout=10,
            )
        self.submit(self.query)
        self.visible("responsive_geometry", lambda: (
            len(observations) == 2 and self.query in self.rows()
        ))

    def prove_states(self) -> None:
        self.fill(f"empty-{uuid.uuid4().hex}")
        self.visible("empty_state", lambda: bool(self.receiver.find_elements(".pt-search-empty")))
        self.fill("...")
        self.press(Keys.ENTER)
        self.wait_js("!!document.querySelector('.pt-search-error')", "typed invalid-query UI")
        self.fill(f"线程 {self.token}")
        self.visible("invalid_query_recovery", lambda: (
            self.token in self.rows() and not self.receiver.find_elements(".pt-search-error")
        ))
        self.fill("隐私")
        self.receiver.find_element('[data-search-filter="functions"]').click()
        self.receiver.find_element(".pt-search-row", 20).click()
        self.wait_js("!!document.querySelector('[data-pt-section-host=\"security\"]')", "real Settings")
        self.visible("functions_navigation", lambda: not self.receiver.find_elements('[data-page="search"]'))

    def prove_account_scope(self, observe_account: Callable[[], None] | None = None) -> None:
        client = self.receiver
        self.submit(f"线程 {self.token}")
        self.wait_js(
            f"document.querySelector('.pt-search-body')?.innerText.includes({json.dumps(self.token)})",
            "private Search result before logout",
        )
        cursor_query = f"filler-{self.token}"
        old_cursor = self.native_page(cursor_query).get("nextCursor")
        if not old_cursor:
            raise GateError("account isolation requires a real paging session")
        before = async_harness(client, "deviceSearchState", {})
        sender = self.clients["bob"]
        sender_before = async_harness(sender, "identityState", {})
        original_pid = client.process_id
        async_harness(client, "logout", {"actorPtid": self.ptids["alice"]}, timeout=30)
        self.client_lifecycles.mark_auth_revoked(client)
        self.wait_js("!document.querySelector('[data-pt-primary-nav=\"chat\"]')", "logout")
        self.visible("logout_clears_search", lambda: (
            not client.find_elements(".pt-search-field") and not client.find_elements("[data-search-return]")
        ))
        bob_account = str(self.actor_specs["bob"]["accountRef"]).removeprefix("station-account:")
        alice_account = str(self.actor_specs["alice"]["accountRef"]).removeprefix("station-account:")
        try:
            async_harness(client, "loginWithPassword", {
                "account": bob_account, "password": DEV_ACCOUNT_PASSWORD,
            }, timeout=45)
            identity = async_harness(client, "hydrateActiveActor", {}, timeout=45)

            def observe_sender_revocation() -> None:
                def revoked_identity() -> dict[str, Any] | None:
                    state = async_harness(sender, "identityState", {})
                    return state if (
                        state.get("authenticated") is False
                        and state.get("phase") in {"revoked", "accountGate"}
                        and state.get("reason") == "revoked"
                        and state.get("actorPtid") == ""
                    ) else None

                revoked = wait_until(
                    revoked_identity, "original Bob native session revocation", timeout=30,
                )
                self.report.runtime["search"]["sessionHandoff"] = {
                    "actor": "bob", "actorPtid": self.ptids["bob"],
                    "before": sender_before, "after": revoked,
                }
                self.assert_condition("sender_session_revoked", (
                    sender_before.get("authenticated") is True
                    and sender_before.get("actorPtid") == self.ptids["bob"]
                ))
                self.client_lifecycles.mark_auth_revoked(sender)

            self.step("search.sender_session_revoked", observe_sender_revocation, "bob")
            self.open_search()
            empty_query = self.field().get_attribute("value") == ""
            after = async_harness(client, "deviceSearchState", {})
            denied = async_harness(client, "deviceSearchPage", {
                "query": cursor_query, "cursor": old_cursor, "requestId": uuid.uuid4().hex,
            })
            self.report.runtime["search"].setdefault("denials", {})[
                "previous_session_cursor_denied"
            ] = denied
            self.assert_condition("previous_session_cursor_denied",
                                  denied.get("accepted") is False and denied.get("errorCode") == 5)
            if observe_account is not None:
                observe_account()
            # This Bob device has not restored the original sender's history.
            # Search must prove content acquired by its own Messaging owner.
            query = f"账号切换 {self.token}"

            def seed_current_device() -> str:
                sent = async_harness(client, "sendInteractionMessage", {
                    "conversationId": self.conversation, "kind": "friend",
                    "content": f"{query} Bob 当前设备正文",
                }, timeout=90)
                message_id = str(sent.get("messageId") or "")
                if not message_id:
                    raise GateError("account isolation requires a committed current-device message")
                return message_id

            message_id = self.step("search.account_scope_seed", seed_current_device, "alice")
            self.report.runtime["search"]["accountScope"] = {
                "identity": async_harness(client, "identityState", {}),
                "before": before, "after": after, "emptyQuery": empty_query,
                "originalPid": original_pid, "currentPid": client.process_id,
                "query": query, "messageId": message_id,
                "conversationId": self.conversation,
            }

            def observe_current_device() -> None:
                self.submit(query)
                self.wait_js(
                    "[...document.querySelectorAll('.pt-search-row')].some("
                    f"row => row.innerText.includes({json.dumps(query)}))",
                    "Bob current-device Search after same-window account switch", timeout=90,
                )

            self.step("search.account_scope_result", observe_current_device, "alice")
            self.visible("same_window_account_isolation", lambda: (
                empty_query and before["partition"] != after["partition"]
                and identity.get("actorPtid") == self.ptids["bob"]
                and client.process_id == original_pid and query in self.rows()
            ))
        finally:
            # Restore the allocated Actor before the shared lifecycle owner logs out.
            identity = async_harness(client, "identityState", {})
            if identity.get("actorPtid") == self.ptids["bob"]:
                async_harness(client, "logout", {"actorPtid": self.ptids["bob"]})
            async_harness(client, "loginWithPassword", {
                "account": alice_account, "password": DEV_ACCOUNT_PASSWORD,
            }, timeout=45)
            restored = async_harness(client, "hydrateActiveActor", {}, timeout=45)
            if restored.get("actorPtid") != self.ptids["alice"]:
                raise GateError("allocated Search Actor was not restored")
            self.client_lifecycles.mark_authenticated(client)

    def run(self) -> dict[str, Any]:
        try:
            version = self.step("station.identity", lambda: read_station_version(self.station_url))
            self.step("fixture.reset", self.verify_fixture_ready)
            for actor in ("alice", "bob"):
                self.step("client.authenticated", lambda actor=actor: self.start_client(actor), actor)
            self.step("runtime.source_identity", lambda: self.source_identity(version))
            self.assert_condition("native_runtime", all(
                is_native_tauri_url(client.get_current_url()) for client in self.clients.values()
            ))
            self.assert_condition("actor_isolation", len(set(self.ptids.values())) == 2
                                  and len(set(self.device_ids.values())) == 2)
            self.step("search.surface_ready", self.open_search, "alice")
            self.press(Keys.ESCAPE)
            self.wait_js("!document.querySelector('.pt-search-field')", "Search closed")
            self.conversation = self.step("conversation.open", self.open_conversation)
            self.step("message.seed", self.seed, "bob")
            try:
                self.submit(f"filler-{self.token}")
                self.wait_js("document.querySelectorAll('.pt-search-row').length === 20",
                             "first real Search page", timeout=90)
                self.receiver.find_element(".pt-search-more", 20).click()
                self.wait_js("document.querySelectorAll('.pt-search-row').length === 40",
                             "second real Search page")
                self.receiver.find_element(".pt-search-more", 20).click()
                self.wait_js("document.querySelectorAll('.pt-search-row').length === 55",
                             "all real filler messages received", timeout=90)
            except GateError:
                self.retain_pagination_failure()
                raise
            self.visible("pagination", lambda: len(self.receiver.find_elements(".pt-search-row")) == 55)
            self.prove_cache()
            self.prove_responsive_geometry()
            self.open_target("historical_open", self.query, self.message, "data-message-ulid")
            self.open_target("thread_open", f"线程 {self.token}", self.reply, "data-thread-message-id")
            self.upload()
            self.prove_mutations()
            self.prove_states()
            self.prove_account_scope()
            for actor in ("alice", "bob"):
                self.collect_client_evidence(actor)
        finally:
            self.report.runtime["cleanup"] = self.cleanup_clients()
        missing = REQUIRED_ASSERTIONS - {a.name for a in self.report.assertions if a.passed}
        if missing:
            raise GateError(f"Search required proof missing: {sorted(missing)}")
        return {"journey": JOURNEY_ID}


if __name__ == "__main__":
    gate: AcceptanceGate = DeviceSearchGate()
    raise SystemExit(gate.execute())
