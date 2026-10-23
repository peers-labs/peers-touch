"""One continuous, source-bound native device Search journey."""
from __future__ import annotations

import json
import re
import tempfile
import uuid
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
    "explicit_refresh", "edit_invalidation", "hide_invalidation",
    "functions_navigation", "empty_state", "invalid_query_recovery",
    "logout_clears_search", "same_window_account_isolation",
}
REQUIRED_ASSERTIONS = UI_ASSERTIONS | {
    "native_runtime", "source_build_runtime_identity", "actor_isolation",
    "forged_authority_denied", "stale_content_denied", "hidden_reference_denied",
    "previous_session_cursor_denied", "resources_released",
}
REQUIRED_STEPS = {
    "station.identity", "fixture.reset", "client.authenticated",
    "runtime.source_identity", "conversation.open", "message.seed",
} | {f"search.{name}" for name in UI_ASSERTIONS}


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
    phase = "chat-device-search"
    bom = ("SEARCH-DEVICE-FIND-OPEN",)
    spec = ("chat-device-search",)

    def __init__(self) -> None:
        selected = selected_native_runtime(GATE_ID)
        if selected is None or selected.binding.cell_id != "desktop-macos-native":
            raise GateError("Search requires the selected native macOS runtime")
        super().__init__(
            manifest=selected.manifest, actor_manifest=selected.actor_manifest,
            runtime_binding=selected.binding, gate_id=GATE_ID, journey_id=JOURNEY_ID,
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

    def open_search(self) -> None:
        if not self.receiver.find_elements(".pt-search-field input"):
            self.receiver.find_element(
                '[data-pt-primary-nav="search"] [role="button"]', 20,
            ).click()
        self.field()
        self.assert_condition(
            "search_singleton",
            len(self.receiver.find_elements(".pt-search-field input")) == 1,
        )

    def settled(self) -> None:
        self.wait_js(
            "document.querySelector('.pt-search-field input')"
            " && !document.querySelector('.pt-search-status')",
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
        all_results = self.receiver.find_elements(".pt-search-intents button")[0]
        if all_results.get_attribute("aria-selected") != "true":
            all_results.click()
        self.fill(query)
        self.press(Keys.ENTER)
        self.settled()

    def rows(self) -> str:
        return str(self.receiver.execute_script(
            "return document.querySelector('.pt-search-body')?.innerText || '';",
        ))

    def visible(self, name: str, predicate: Any, detail: Any = None) -> None:
        def observe() -> None:
            self.assert_condition(name, bool(predicate()), json.dumps(detail))
            screenshot = self.save_screenshot(self.receiver, name)
            dom = self.save_dom(self.receiver, name)
            self.report.runtime["search"]["ui"][name] = {
                "actor": "alice", "screenshot": screenshot, "dom": dom,
                "query": self.field().get_attribute("value")
                if self.receiver.find_elements(".pt-search-field input") else "",
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

    def native_page(self, query: str) -> dict[str, Any]:
        result = async_harness(self.receiver, "deviceSearchPage", {
            "query": query, "requestId": uuid.uuid4().hex,
        })
        if result.get("accepted") is not True:
            raise GateError(f"Search native diagnostic query failed: {result}")
        return result["page"]

    def resolve(self, resource: dict[str, Any]) -> dict[str, Any]:
        return async_harness(self.receiver, "deviceSearchResolve", {
            "resource": resource, "requestId": uuid.uuid4().hex,
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
            **payload, "prefix": f"filler-{self.token}", "count": 55,
        }, timeout=180)
        if len(filler.get("messageIds", [])) != 55:
            raise GateError("Search history must exceed the latest message window")
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
        self.field().send_keys("z")
        self.wait_js(
            "document.querySelector('.pt-search-empty')"
            " && !document.querySelector('.pt-search-status')",
            "changed query terminal state",
        )
        self.cached("backspace_cache", lambda: self.press(Keys.BACKSPACE))
        self.press(Keys.ENTER)
        self.settled()
        before = self.counts()
        self.receiver.find_element(".pt-search-footer button", 20).click()
        self.settled()
        after = self.counts()
        self.report.runtime["search"]["cache"]["explicit_refresh"] = {
            "before": before, "after": after,
        }
        self.visible("explicit_refresh", lambda: after["sourceReads"] > before["sourceReads"])
        self.receiver.find_element(".pt-search-row", 20).click()
        self.wait_js("!document.querySelector('.pt-search-field')", "Chat open")
        self.cached("return_cache", lambda: (
            self.receiver.find_element("[data-search-return] button", 20).click(), self.field()
        ))

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
        self.receiver.find_elements(".pt-search-intents button")[1].click()
        self.receiver.find_element(".pt-search-row", 20).click()
        self.wait_js("!!document.querySelector('[data-pt-section-host=\"security\"]')", "real Settings")
        self.visible("functions_navigation", lambda: not self.receiver.find_elements('[data-page="search"]'))

    def prove_account_scope(self) -> None:
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
            self.submit(self.query)
            self.wait_js(
                f"document.querySelector('.pt-search-body')?.innerText.includes({json.dumps(self.query)})",
                "Bob Search after same-window account switch", timeout=90,
            )
            self.visible("same_window_account_isolation", lambda: (
                empty_query and before["readScope"] != after["readScope"]
                and identity.get("actorPtid") == self.ptids["bob"]
                and client.process_id == original_pid and self.query in self.rows()
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
            self.conversation = self.step("conversation.open", self.open_conversation)
            self.step("message.seed", self.seed, "bob")
            self.submit(f"filler-{self.token}")
            self.wait_js("document.querySelectorAll('.pt-search-row').length === 20",
                         "first real Search page", timeout=90)
            self.receiver.find_element(".pt-search-more", 20).click()
            self.wait_js("document.querySelectorAll('.pt-search-row').length === 40",
                         "second real Search page")
            self.receiver.find_element(".pt-search-more", 20).click()
            self.wait_js("document.querySelectorAll('.pt-search-row').length === 55",
                         "all real filler messages received", timeout=90)
            self.visible("pagination", lambda: len(self.receiver.find_elements(".pt-search-row")) == 55)
            self.prove_cache()
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
