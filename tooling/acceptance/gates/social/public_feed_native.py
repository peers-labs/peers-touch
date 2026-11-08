"""Public signed-feed Native consumer; private CSS-09 cannot prove this lane."""

from __future__ import annotations

import hashlib
import json
import tempfile
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

    def complete_scenario(self, ledger: SuiteRuntimeLedger, scenario: str, action: str, receiver: str) -> None:
        ledger.record(SuiteRuntimeAction.UI_ACTION, scenario_id=scenario, resource_id=action)
        ledger.record(SuiteRuntimeAction.RECEIVER_ASSERTION, scenario_id=scenario, resource_id=receiver)
        ledger.record(SuiteRuntimeAction.SCENARIO_END, scenario_id=scenario)

    def run(self) -> dict[str, Any]:
        source = self.manifest["source"]
        ledger = SuiteRuntimeLedger(RUNTIME_REUSE,
            suite_runtime_id=self.manifest["runId"],
            source_digest=source.get("workspaceDigest") or source["commit"],
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
                self.start_client(actor)
                ledger.record(SuiteRuntimeAction.CLIENT_LAUNCH, resource_id=f"client:{actor}")
                ledger.record(SuiteRuntimeAction.LOGIN, resource_id=f"session:{actor}")
                version = read_station_version(runtime_station_service(self.manifest, actor)["endpoint"])
                self.assert_condition(f"{actor}-station-source",
                    commits_match(str(version.get("commit") or ""), source["commit"]), "current source")
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

                ledger.record(SuiteRuntimeAction.SCENARIO_START, scenario_id=SCENARIOS[0])
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

                ledger.record(SuiteRuntimeAction.SCENARIO_START, scenario_id=SCENARIOS[1])
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

                ledger.record(SuiteRuntimeAction.SCENARIO_START, scenario_id=SCENARIOS[6])
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

                ledger.record(SuiteRuntimeAction.SCENARIO_START, scenario_id=SCENARIOS[2])
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

                ledger.record(SuiteRuntimeAction.SCENARIO_START, scenario_id=SCENARIOS[3])
                self.restart_client("bob")
                ledger.record(SuiteRuntimeAction.CLIENT_REPLACEMENT, resource_id="client:bob", scenario_id=SCENARIOS[3])
                self.click("bob", '[data-pt-primary-nav="moments"] [role="button"]')
                self.click("bob", '[data-action-id="segment.feed"]')
                self.await_card("bob", edited_text)
                self.open_comments("bob", bob_selector)
                self.assert_comment_like("bob", bob_selector, comment_text, 2, True)
                self.assert_comment_like("bob", bob_selector, reply_text, 1, True)
                self.capture("bob", SCENARIOS[3])
                self.complete_scenario(ledger, SCENARIOS[3], "bob:native-restart", "bob:painted-replayed-updated-body")

                ledger.record(SuiteRuntimeAction.SCENARIO_START, scenario_id=SCENARIOS[4])
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

                ledger.record(SuiteRuntimeAction.SCENARIO_START, scenario_id=SCENARIOS[5])
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
                ledger.record(SuiteRuntimeAction.CLEANUP_COMPLETE, resource_id="suite")
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
