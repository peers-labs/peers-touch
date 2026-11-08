"""Public signed-feed Native consumer; private CSS-09 cannot prove this lane."""

from __future__ import annotations

import hashlib
import json
import tempfile
import time
from contextlib import ExitStack
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from tooling.acceptance.core import (
    GateError, RuntimeReuseContract, SuiteRuntimeAction, SuiteRuntimeLedger,
    call_async_harness, validate_suite_runtime_report,
)
from tooling.acceptance.gates.chat.native_two_client_runner import NativeTwoClientGate
from tooling.acceptance.gates.chat.device_search_runner import DeviceSearchGate
from tooling.acceptance.gates.chat.native_support import (
    cleanup_preserving_primary_failure, commits_match, read_station_version,
    runtime_station_service, selected_native_runtime, wait_until,
)
from tooling.development.secure_content.runtime_owner import (
    _prepare_cross_station_social_fixture, _prepare_social_suite_federation,
)

GATE_ID = "social-public-feed-native-e2e"
SCENARIOS = (
    "publication-late-follower", "non-follower-interaction", "public-edit",
    "restart-readback", "public-search", "public-tombstone",
    "comment-reactions",
    "poll-single-choice", "poll-multiple-choice", "poll-cutoff",
)
RUNTIME_REUSE = RuntimeReuseContract.from_dict({
    "scope": "suite", "entryCheckId": GATE_ID, "scenarioIds": list(SCENARIOS),
    "maxProvisioningRuns": 1, "maxClientLaunches": 3,
    "minWarmReuseRate": 0.66, "requireAttachOnlyScenarios": True,
    "requireReceiverVisibleProof": True, "allowClientReplacement": True,
})


@dataclass
class FixtureClient:
    """Bind the existing Social fixture owner to the already-started Driver."""
    session: Any
    station_url: str
    harness_namespace: str = "moments"

    @property
    def driver(self) -> Any:
        return self.session

    def harness(self, method: str, payload: dict[str, Any], *, timeout: float) -> Any:
        return call_async_harness(self.session, method, payload,
                                  namespace=self.harness_namespace, script_timeout=timeout)


class Gate(DeviceSearchGate):
    gate_id = GATE_ID
    phase = "Actor-Owned Moments Native"
    bom = ("AFL-08C", "AFL-09")
    spec = ("docs/architecture/domains/social/federation/actor-feed-log.md",)

    def __init__(self) -> None:
        selected = selected_native_runtime(GATE_ID)
        if selected is None:
            raise GateError("Public feed requires a prepared Native runtime")
        # Reuse Native Search's original input and painted-surface oracle;
        # this Suite owns Social fixtures rather than Chat history seeding.
        NativeTwoClientGate.__init__(self,
            manifest=selected.manifest, actor_manifest=selected.actor_manifest,
            runtime_binding=selected.binding, gate_id=GATE_ID,
            journey_id="actor-owned-moments-public",
        )
        if self.manifest.get("environmentId") != "cross-station-social-native":
            raise GateError("Public feed requires the reviewed two-Station environment")
        self.report.runtime["search"] = {}
        self.active_social_scenario: str | None = None

    @property
    def receiver(self) -> Any:
        return self.clients["bob"]

    def action(self, actor: str, method: str, payload: dict[str, Any] | None = None) -> Any:
        return call_async_harness(self.clients[actor], method, payload or {},
                                  namespace="moments", script_timeout=120)

    def prepare_fixture(self, stack: ExitStack) -> dict[str, str]:
        primary = runtime_station_service(self.manifest, "alice")
        secondary = runtime_station_service(self.manifest, "bob")
        federation_id = _prepare_social_suite_federation(
            primary_url=primary["endpoint"], secondary_url=secondary["endpoint"],
            primary_peer_id=primary["runtimeIdentity"], secondary_peer_id=secondary["runtimeIdentity"],
            primary_product_url=primary["endpoint"], fixture_epoch=self.manifest["runId"],
            cleanup_stack=stack)
        for actor in ("alice", "bob"):
            self.action(actor, "reconcileFederationProjection")
        return _prepare_cross_station_social_fixture(
            FixtureClient(self.clients["alice"], primary["endpoint"]),
            FixtureClient(self.clients["bob"], secondary["endpoint"]),
            federation_id=federation_id)

    def visible_element(self, actor: str, selector: str) -> Any | None:
        client = self.clients[actor]
        for element in client.find_elements(selector):
            if element.is_displayed() and client.execute_script("""
                const r = arguments[0].getBoundingClientRect();
                const s = getComputedStyle(arguments[0]);
                return r.width > 0 && r.height > 0 && s.visibility !== 'hidden'
                  && s.display !== 'none' && Number(s.opacity) > 0;
            """, element):
                return element
        return None

    def click(self, actor: str, selector: str) -> None:
        element = wait_until(lambda: self.visible_element(actor, selector), selector, timeout=120)
        element.click()

    def open_comments(self, actor: str, post_selector: str) -> None:
        selector = f'{post_selector} [data-acceptance-id="social-open-comments"]'
        control = wait_until(lambda: self.visible_element(actor, selector), selector, timeout=30)
        expanded = control.get_attribute("aria-expanded")
        if expanded not in ("true", "false"):
            raise GateError("Moment comment control has no explicit expansion state")
        if expanded == "false":
            control.click()
        def is_open() -> bool:
            current = self.visible_element(actor, selector)
            return current is not None and current.get_attribute("aria-expanded") == "true"
        wait_until(is_open,
                   f"{actor} expanded Moment comments", timeout=30)

    def card(self, actor: str, text: str) -> Any | None:
        return next((element for element in self.clients[actor].find_elements(
            '[data-acceptance-id="social-moment-card"]')
            if element.is_displayed() and text in element.text), None)

    def await_card(self, actor: str, text: str) -> Any:
        def read() -> Any:
            self.action(actor, "findPublicMoment", {"text": text})
            element = self.card(actor, text)
            return element if element and self.visible_element(actor,
                f'[data-acceptance-id="social-moment-card"][data-post-id="{element.get_attribute("data-post-id")}"]') else None
        return wait_until(read, f"{actor} signed public Moment", timeout=120)

    def capture(self, actor: str, label: str) -> None:
        self.save_screenshot(self.clients[actor], label)
        self.save_dom(self.clients[actor], label)

    def comment_selector(self, actor: str, post_selector: str, text: str) -> str:
        def locate() -> str | None:
            for row in self.clients[actor].find_elements(
                f"{post_selector} [data-moments-comment]"
            ):
                if row.is_displayed() and self.clients[actor].execute_script("""
                    return arguments[0].querySelector(
                      ':scope > .sk-comment-body > .sk-comment-line > .sk-comment-text'
                    )?.textContent === arguments[1];
                """, row, text):
                    comment_id = row.get_attribute("data-comment-id")
                    return f'{post_selector} [data-comment-id="{comment_id}"]'
            return None
        return wait_until(locate, f"{actor} painted comment", timeout=120)

    def assert_comment_like(self, actor: str, post_selector: str, text: str,
                            count: int, liked: bool) -> str:
        row = self.comment_selector(actor, post_selector, text)
        selector = f"{row} > .sk-comment-body > .sk-comment-meta [data-comment-like]"
        def settled() -> bool:
            control = self.visible_element(actor, selector)
            return bool(control
                and control.get_attribute("data-comment-like-count") == str(count)
                and control.get_attribute("aria-pressed") == str(liked).lower()
                and control.get_attribute("disabled") is None)
        wait_until(settled, f"{actor} confirmed comment LIKE {count}/{liked}", timeout=120)
        return selector

    def set_input(self, actor: str, selector: str, value: str) -> None:
        control = wait_until(lambda: self.visible_element(actor, selector), selector, timeout=30)
        self.clients[actor].execute_script("""
            const el = arguments[0], value = arguments[1];
            const prototype = el.tagName === 'TEXTAREA'
              ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, value);
            el.dispatchEvent(new Event('input', {bubbles: true}));
            el.dispatchEvent(new Event('change', {bubbles: true}));
        """, control, value)
        wait_until(lambda: self.clients[actor].execute_script("""
            const el = arguments[0], expected = arguments[1];
            return el.value === expected || (el.type === 'datetime-local'
              && new Date(el.value).getTime() === new Date(expected).getTime());
        """, control, value),
                   f"{actor} controlled input accepted", timeout=30)

    def create_poll(self, text: str, *, multiple: bool = False, cutoff_seconds: int | None = None) -> dict[str, str]:
        self.click("alice", '[data-acceptance-id="social-composer-open"]')
        self.set_input("alice", 'textarea[data-moments-composer-input]', text)
        self.click("alice", '[data-acceptance-id="social-compose-poll"]')
        invalid = self.visible_element("alice", '[data-acceptance-id="social-composer-publish"]')
        self.assert_condition(f"{text}-empty-poll-publication-disabled", invalid is not None
                              and invalid.get_attribute("disabled") is not None)
        self.set_input("alice", '[data-acceptance-id="social-poll-question"]', text + " question")
        for index in range(2):
            self.set_input("alice", f'[data-acceptance-id="social-poll-draft-option-{index}"]', f"Option {index}")
        if multiple:
            self.click("alice", '[data-action-id="compose.poll.add-option"]')
            self.set_input("alice", '[data-acceptance-id="social-poll-draft-option-2"]', "Option 2")
            self.set_input("alice", '[data-acceptance-id="social-poll-maximum"]', "2")
            self.set_input("alice", '[data-acceptance-id="social-poll-minimum"]', "2")
        if cutoff_seconds is not None:
            expiry = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(time.time() + cutoff_seconds))
            self.set_input("alice", '.sk-compose-poll input[type="datetime-local"]', expiry)
        # Dismiss/reopen goes through the original draft owner, including poll
        # fields; it must not turn the retained draft back into a text post.
        self.click("alice", '[data-action-id="compose.cancel"]')
        self.click("alice", '[data-acceptance-id="social-composer-open"]')
        self.assert_condition(f"{text}-poll-draft-restored",
            self.visible_element("alice", '[data-acceptance-id="social-poll-question"]').get_attribute("value")
            == text + " question")
        self.click("alice", '[data-acceptance-id="social-composer-publish"]')
        return {actor: self.await_card(actor, text).get_attribute("data-post-id") for actor in ("alice", "bob")}

    def poll_selector(self, post_id: str) -> str:
        return f'[data-acceptance-id="social-moment-card"][data-post-id="{post_id}"] [data-acceptance-id="social-poll"]'

    def assert_poll(self, actor: str, text: str, post_id: str, counts: list[int], choices: list[int],
                    *, closed: bool = False) -> None:
        selector = self.poll_selector(post_id)
        def settled() -> bool:
            self.await_card(actor, text)
            element = self.visible_element(actor, selector)
            if element:
                self.clients[actor].execute_script("arguments[0].scrollIntoView({block: 'center', inline: 'nearest'});", element)
            return bool(element and self.clients[actor].execute_script("""
                const el = arguments[0], counts = arguments[1], choices = arguments[2], closed = arguments[3];
                const r = el.getBoundingClientRect();
                const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
                return r.top >= 0 && r.bottom <= innerHeight + 1 && hit && el.contains(hit)
                  && el.dataset.pollState === (closed ? 'closed' : 'ready')
                  && JSON.stringify([...el.querySelectorAll('[data-poll-count]')].map(e => Number(e.dataset.pollCount))) === JSON.stringify(counts)
                  && JSON.stringify([...el.querySelectorAll('input')].flatMap((e, i) => e.checked ? [i] : [])) === JSON.stringify(choices)
                  && Number(el.querySelector('[data-poll-voters]')?.dataset.pollVoters) === (counts.some(n => n > 0) ? 2 : 0)
                  && (!closed || [...el.querySelectorAll('input')].every(e => e.disabled));
            """, element, counts, choices, closed))
        wait_until(settled, f"{actor} verified poll counts and selection", timeout=120)

    def select_poll(self, actor: str, post_id: str, indices: list[int]) -> None:
        selector = self.poll_selector(post_id)
        inputs = self.clients[actor].find_elements(f"{selector} input")
        single = inputs[0].get_attribute("type") == "radio"
        for index, control in enumerate(inputs):
            checked = control.get_attribute("checked") in ("true", "checked")
            if (index in indices and not checked) or (not single and index not in indices and checked):
                self.click(actor, f"{selector} [data-poll-option='{index}'] label")

    def poll_scenario(self, ledger: SuiteRuntimeLedger, scenario: str, *, multiple: bool) -> tuple[str, dict[str, str]]:
        self.begin_scenario(ledger, scenario)
        text = f"{scenario}-{self.manifest['runId']}"
        ids = self.create_poll(text, multiple=multiple)
        self.select_poll("bob", ids["bob"], [0, 1] if multiple else [1])
        self.click("bob", f'{self.poll_selector(ids["bob"])} [data-acceptance-id="social-poll-submit"]')
        self.select_poll("alice", ids["alice"], [1, 2] if multiple else [0])
        self.click("alice", f'{self.poll_selector(ids["alice"])} [data-acceptance-id="social-poll-submit"]')
        counts = [1, 2, 1] if multiple else [1, 1]
        self.assert_poll("alice", text, ids["alice"], counts, [1, 2] if multiple else [0])
        self.assert_poll("bob", text, ids["bob"], counts, [0, 1] if multiple else [1])
        self.select_poll("bob", ids["bob"], [1, 2] if multiple else [0])
        self.click("bob", f'{self.poll_selector(ids["bob"])} [data-acceptance-id="social-poll-submit"]')
        counts = [0, 2, 2] if multiple else [2, 0]
        for actor in ("alice", "bob"):
            self.assert_poll(actor, text, ids[actor], counts, [1, 2] if multiple else [0])
        # Local cancellation does not revoke the committed ballot.
        self.select_poll("bob", ids["bob"], [0, 1] if multiple else [1])
        self.click("bob", f'[data-action-id="moment.poll.cancel.{ids["bob"]}"]')
        self.assert_poll("bob", text, ids["bob"], counts, [1, 2] if multiple else [0])
        updated_text = f"Edited-{text}"
        alice_card = f'[data-acceptance-id="social-moment-card"][data-post-id="{ids["alice"]}"]'
        self.click("alice", f'{alice_card} [data-acceptance-id="social-moment-menu"]')
        self.click("alice", f'[data-action-id="moment.edit.{ids["alice"]}"]')
        self.set_input("alice", '[data-acceptance-id="social-edit-input"]', updated_text)
        self.click("alice", '[data-acceptance-id="social-edit-save"]')
        for actor in ("alice", "bob"):
            self.assert_poll(actor, updated_text, ids[actor], counts, [1, 2] if multiple else [0])
        self.capture("bob", scenario)
        self.complete_scenario(ledger, scenario, "alice,bob:poll-publish-vote-replace-cancel",
                               "alice,bob:painted-verified-ballots-and-two-voters")
        return updated_text, ids

    def begin_scenario(self, ledger: SuiteRuntimeLedger, scenario: str) -> None:
        ledger.record(SuiteRuntimeAction.SCENARIO_START, scenario_id=scenario)
        self.active_social_scenario = scenario

    def complete_scenario(self, ledger: SuiteRuntimeLedger, scenario: str, action: str, receiver: str) -> None:
        ledger.record(SuiteRuntimeAction.UI_ACTION, scenario_id=scenario, resource_id=action)
        ledger.record(SuiteRuntimeAction.RECEIVER_ASSERTION, scenario_id=scenario, resource_id=receiver)
        ledger.record(SuiteRuntimeAction.SCENARIO_END, scenario_id=scenario)
        self.active_social_scenario = None

    def run(self) -> dict[str, Any]:
        source = self.manifest["source"]
        ledger = SuiteRuntimeLedger(RUNTIME_REUSE,
            suite_runtime_id=self.manifest["runId"],
            source_digest=(source["commit"]
                if source.get("workspaceDigest") in (None, "", "clean")
                else source["workspaceDigest"].removeprefix("sha256:")),
            fixture_epoch=self.actor_manifest["runId"])
        ledger.record(SuiteRuntimeAction.PROVISION, resource_id="two-station-runtime")
        ledger.record(SuiteRuntimeAction.ACCOUNT_PROVISION, resource_id="alice,bob")
        cleanup: dict[str, Any] = {}
        source_identity: dict[str, Any] = {}
        text = f"AFL-{self.manifest['runId']}"
        edited_text = f"Updated-{self.manifest['runId']}"
        try:
            self.verify_fixture_ready()
            for actor in ("alice", "bob"):
                version = read_station_version(runtime_station_service(self.manifest, actor)["endpoint"])
                self.assert_condition(f"{actor}-station-source",
                    commits_match(str(version.get("build_commit") or ""), source["commit"]), "current source")
                self.start_client(actor)
                ledger.record(SuiteRuntimeAction.CLIENT_LAUNCH, resource_id=f"client:{actor}")
                ledger.record(SuiteRuntimeAction.LOGIN, resource_id=f"session:{actor}")
            primary = runtime_station_service(self.manifest, "alice")
            secondary = runtime_station_service(self.manifest, "bob")
            self.assert_condition("two-distinct-stations",
                primary["runtimeIdentity"] != secondary["runtimeIdentity"])
            source_identity = self.source_identity(read_station_version(primary["endpoint"]))
            with ExitStack() as stack:
                fixture = self.prepare_fixture(stack)
                self.action("bob", "unfollowActor", {"actorPtid": fixture["alicePtid"]})
                for actor in ("alice", "bob"):
                    self.click(actor, '[data-pt-primary-nav="moments"] [role="button"]')
                    self.click(actor, '[data-action-id="segment.feed"]')

                self.begin_scenario(ledger, SCENARIOS[0])
                self.click("alice", '[data-acceptance-id="social-composer-open"]')
                wait_until(lambda: self.visible_element("alice", 'textarea[data-moments-composer-input]'),
                           "Alice composer input", timeout=30).send_keys(text)
                self.click("alice", '[data-acceptance-id="social-composer-publish"]')
                alice_card = self.await_card("alice", text)
                self.action("bob", "followActor", {"actorPtid": fixture["alicePtid"]})
                bob_card = self.await_card("bob", text)
                alice_id = alice_card.get_attribute("data-post-id")
                bob_id = bob_card.get_attribute("data-post-id")
                self.assert_condition("native-public-commit", self.action("alice", "publicFeedStatus")["pendingCount"] == 0)
                self.capture("bob", SCENARIOS[0])
                self.complete_scenario(ledger, SCENARIOS[0], "alice:composer-publish", "bob:painted-signed-body")

                self.begin_scenario(ledger, SCENARIOS[1])
                self.action("bob", "unfollowActor", {"actorPtid": fixture["alicePtid"]})
                bob_selector = f'[data-post-id="{bob_id}"]'
                self.open_comments("bob", bob_selector)
                comment_text = f"Non-follower {text}"
                comment_input = wait_until(lambda: self.visible_element("bob",
                    f'{bob_selector} [data-acceptance-id="social-comment-input"]'), "Bob comment input", timeout=30)
                comment_input.send_keys(comment_text)
                self.click("bob", f'{bob_selector} [data-acceptance-id="social-comment-send"]')
                wait_until(lambda: comment_text in self.await_card("bob", text).text, "Bob committed comment", timeout=120)
                self.click("bob", f'{bob_selector} [data-acceptance-id="social-reaction-trigger"]')
                self.click("bob", '[data-acceptance-id="social-reaction-pick-1"]')
                alice_selector = f'[data-post-id="{alice_id}"]'
                self.open_comments("alice", alice_selector)
                wait_until(lambda: comment_text in self.await_card("alice", text).text, "Alice non-follower comment", timeout=120)
                wait_until(lambda: self.visible_element("alice",
                    f'{alice_selector} [data-acceptance-id="social-reaction-chip-1"]'), "Alice signed reaction", timeout=120)
                self.capture("alice", SCENARIOS[1])
                self.complete_scenario(ledger, SCENARIOS[1], "bob:comment-send-and-reaction-pick", "alice:painted-thread-and-reaction")

                self.begin_scenario(ledger, SCENARIOS[6])
                alice_root = self.assert_comment_like("alice", alice_selector, comment_text, 0, False)
                self.click("alice", alice_root)
                bob_root = self.assert_comment_like("bob", bob_selector, comment_text, 1, False)
                self.assert_comment_like("alice", alice_selector, comment_text, 1, True)
                self.click("bob", bob_root)
                self.assert_comment_like("alice", alice_selector, comment_text, 2, True)
                self.assert_comment_like("bob", bob_selector, comment_text, 2, True)
                self.click("alice", alice_root)
                self.assert_comment_like("alice", alice_selector, comment_text, 1, False)
                self.assert_comment_like("bob", bob_selector, comment_text, 1, True)
                self.click("alice", alice_root)
                self.assert_comment_like("bob", bob_selector, comment_text, 2, True)
                root_row = self.comment_selector("alice", alice_selector, comment_text)
                self.click("alice", f"{root_row} > .sk-comment-body > .sk-comment-meta [data-moments-comment-reply]")
                reply_text = f"Reply {text}"
                reply_input = wait_until(lambda: self.visible_element("alice",
                    f'{alice_selector} [data-acceptance-id="social-comment-input"]'),
                    "Alice reply input", timeout=30)
                reply_input.send_keys(reply_text)
                self.click("alice", f'{alice_selector} [data-acceptance-id="social-comment-send"]')
                bob_reply = self.assert_comment_like("bob", bob_selector, reply_text, 0, False)
                self.click("bob", bob_reply)
                self.assert_comment_like("alice", alice_selector, reply_text, 1, False)
                self.assert_comment_like("bob", bob_selector, reply_text, 1, True)
                self.click("bob", bob_reply)
                self.assert_comment_like("alice", alice_selector, reply_text, 0, False)
                self.assert_comment_like("bob", bob_selector, reply_text, 0, False)
                self.click("bob", bob_reply)
                self.assert_comment_like("alice", alice_selector, reply_text, 1, False)
                self.assert_comment_like("bob", bob_selector, reply_text, 1, True)
                for actor in ("alice", "bob"):
                    self.capture(actor, f"{SCENARIOS[6]}-{actor}")
                self.complete_scenario(ledger, SCENARIOS[6],
                    "alice,bob:root-and-reply-like-set-remove", "alice,bob:painted-confirmed-counts")

                polls = [
                    self.poll_scenario(ledger, SCENARIOS[7], multiple=False),
                    self.poll_scenario(ledger, SCENARIOS[8], multiple=True),
                ]
                self.begin_scenario(ledger, SCENARIOS[9])
                cutoff_text = f"Cutoff-{self.manifest['runId']}"
                cutoff_ids = self.create_poll(cutoff_text, cutoff_seconds=30)
                for actor in ("alice", "bob"):
                    self.assert_poll(actor, cutoff_text, cutoff_ids[actor], [0, 0], [], closed=True)
                self.capture("bob", SCENARIOS[9])
                self.complete_scenario(ledger, SCENARIOS[9], "alice:publish-short-deadline",
                                       "bob:painted-closed-poll-and-disabled-options")

                self.begin_scenario(ledger, SCENARIOS[2])
                self.action("bob", "followActor", {"actorPtid": fixture["alicePtid"]})
                self.click("alice", f'{alice_selector} [data-acceptance-id="social-moment-menu"]')
                self.click("alice", f'[data-action-id="moment.edit.{alice_id}"]')
                editor = wait_until(lambda: self.visible_element("alice",
                    '[data-acceptance-id="social-edit-input"]'), "Alice signed edit input", timeout=30)
                editor.clear()
                editor.send_keys(edited_text)
                self.click("alice", '[data-acceptance-id="social-edit-save"]')
                self.assert_condition("author-edit-object-id",
                    self.await_card("alice", edited_text).get_attribute("data-post-id") == alice_id)
                self.assert_condition("receiver-edit-object-id",
                    self.await_card("bob", edited_text).get_attribute("data-post-id") == bob_id)
                self.capture("bob", SCENARIOS[2])
                self.complete_scenario(ledger, SCENARIOS[2], "alice:edit-save", "bob:painted-updated-signed-body")

                self.begin_scenario(ledger, SCENARIOS[3])
                self.restart_client("bob")
                ledger.record(SuiteRuntimeAction.CLIENT_REPLACEMENT, resource_id="client:bob", scenario_id=SCENARIOS[3])
                self.click("bob", '[data-pt-primary-nav="moments"] [role="button"]')
                self.click("bob", '[data-action-id="segment.feed"]')
                self.await_card("bob", edited_text)
                self.open_comments("bob", bob_selector)
                self.assert_comment_like("bob", bob_selector, comment_text, 2, True)
                self.assert_comment_like("bob", bob_selector, reply_text, 1, True)
                for index, (poll_text, poll_ids) in enumerate(polls):
                    self.assert_poll("bob", poll_text, poll_ids["bob"],
                                     [2, 0] if index == 0 else [0, 2, 2], [0] if index == 0 else [1, 2])
                self.capture("bob", SCENARIOS[3])
                self.complete_scenario(ledger, SCENARIOS[3], "bob:native-restart", "bob:painted-replayed-updated-body")

                self.begin_scenario(ledger, SCENARIOS[4])
                self.open_search()
                self.click("bob", '[data-search-filter="social"]')
                self.fill(edited_text)
                result_selector = (
                    f'.pt-search-row[data-resource-id="{bob_id}"]'
                    '[data-source-id="station.social.public"]'
                )
                wait_until(lambda: self.visible_element("bob", result_selector),
                           "Bob Search issued replicated public post", timeout=120)
                page = self.native_page(edited_text)
                item = next((item for item in page["items"]
                             if item["resource"]["id"] == bob_id
                             and item["sourceId"] == "station.social.public"), None)
                self.assert_condition("search-replicated-public-identity", item is not None)
                self.assert_condition("search-replicated-updated-body",
                    edited_text in self.rows() and self.wait_surface()["painted"])
                self.report.runtime["search"]["replicatedPublicReference"] = item
                self.capture("bob", SCENARIOS[4])
                self.complete_scenario(ledger, SCENARIOS[4],
                    "bob:search-social-query", "bob:painted-replicated-updated-result")

                self.begin_scenario(ledger, SCENARIOS[5])
                self.click("alice", f'{alice_selector} [data-acceptance-id="social-moment-menu"]')
                self.click("alice", f'[data-action-id="moment.delete.{alice_id}"]')
                self.click("alice", '[data-acceptance-id="social-delete-confirm"]')
                for actor in ("alice", "bob"):
                    def removed(actor: str = actor) -> bool:
                        result = self.action(actor, "findPublicMoment", {"text": edited_text})
                        return result.get("found") is False and self.card(actor, edited_text) is None
                    wait_until(removed, f"{actor} tombstoned card removed", timeout=120)
                self.assert_condition("native-tombstone-committed",
                    self.action("alice", "publicFeedStatus")["pendingCount"] == 0)
                self.wait_js(
                    f"!document.querySelector({json.dumps(result_selector)})"
                    " && !!document.querySelector('.pt-search-empty')"
                    " && !document.querySelector('.pt-search-error')"
                    " && document.querySelector('.pt-search-body')?.getAttribute('aria-busy') === 'false'"
                    f" && document.querySelector('.pt-search-body')?.dataset.displayedQuery === {json.dumps(edited_text)}",
                    "Bob public tombstone removes the actual retained Search result", timeout=120)
                self.assert_condition("search-tombstone-painted-empty", self.wait_surface()["painted"])
                self.capture("bob", SCENARIOS[5])
                self.complete_scenario(ledger, SCENARIOS[5],
                    "alice:delete-confirm", "bob:no-painted-deleted-card-or-search-result")
        finally:
            def release() -> None:
                nonlocal cleanup
                cleanup = self.cleanup_clients()
                if cleanup.get("cleanupErrors"):
                    raise GateError("Public Native Suite cleanup failed")
                if self.active_social_scenario is not None:
                    # End the failed scenario's lifetime without supplying a
                    # successful UI action or receiver assertion. The ledger
                    # remains invalid; actual cleanup is recorded separately.
                    ledger.record(SuiteRuntimeAction.SCENARIO_END,
                                  scenario_id=self.active_social_scenario)
                    self.active_social_scenario = None
                ledger.record(SuiteRuntimeAction.CLEANUP_COMPLETE, resource_id="suite")
                self.report.runtime["suiteRuntimeReport"] = ledger.report()
            cleanup_preserving_primary_failure(release, self.report, "Public signed-feed Native")
        runtime_report = ledger.report()
        validate_suite_runtime_report(runtime_report, RUNTIME_REUSE)
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as artifact:
            json.dump(runtime_report, artifact, sort_keys=True)
            artifact_path = Path(artifact.name)
        try:
            self.report.add_evidence_file("suite-runtime", artifact_path, destination_dir=self.evidence_dir)
        finally:
            artifact_path.unlink(missing_ok=True)
        self.assert_condition("public-native-scenarios", True)
        return {"evidenceClass": "ACCEPTANCE_PROOF", "sourceIdentity": source_identity,
            "scenarioResults": {scenario: "PASS" for scenario in SCENARIOS},
            "textSha256": hashlib.sha256(text.encode()).hexdigest(),
            "suiteRuntimeReport": runtime_report, "cleanup": cleanup,
            "unprovenScope": ["Lost ACK fault", "Dropped notification fault", "Second writer denial",
                              "Station projection tamper and head rollback faults", "Prototype visual parity", "Mobile Native"]}


def main() -> int:
    return Gate().execute()


if __name__ == "__main__":
    raise SystemExit(main())
