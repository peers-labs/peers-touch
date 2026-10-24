"""Social-owned native Search journey on the existing two-client runtime."""
from __future__ import annotations

import json
import uuid
from typing import Any

from selenium.webdriver.common.keys import Keys

from tooling.acceptance.core import (
    AcceptanceGate, GateError, RuntimeReuseContract, SuiteRuntimeAction,
    SuiteRuntimeLedger, call_async_harness,
)
from tooling.acceptance.gates.chat.device_search_runner import DeviceSearchGate
from tooling.acceptance.gates.chat.native_support import async_harness, is_native_tauri_url
from tooling.acceptance.gates.chat.native_two_client_runner import read_station_version
from tooling.acceptance.gates.mobile.simulator_social_e2e import SimulatorSocialGate

GATE_ID = "social-content-search-desktop-native-e2e"
SCENARIOS = ("mixed-search", "original-open-return", "current-policy", "session-fence")
REUSE = RuntimeReuseContract.from_dict({
    "scope": "suite", "entryCheckId": "social-content-search-desktop",
    "scenarioIds": list(SCENARIOS), "maxProvisioningRuns": 1,
    "maxClientLaunches": 2, "minWarmReuseRate": 0.75,
    "requireAttachOnlyScenarios": True, "requireReceiverVisibleProof": True,
    "allowClientReplacement": False,
})


class SocialContentSearchDesktopGate(DeviceSearchGate):
    gate_id = GATE_ID
    journey_id = "social-content-search"
    phase = "Social content Search Desktop"
    bom = ("SOCIAL-CONTENT-FIND-OPEN",)
    spec = ("social-content-search",)

    def moments(self, actor: str, method: str, payload: dict) -> dict:
        return call_async_harness(
            self.clients[actor], method, payload, namespace="moments",
            script_timeout=60,
        )

    def page(self) -> dict:
        result = async_harness(self.receiver, "deviceSearchPage", {
            "query": self.query, "kinds": [], "requestId": uuid.uuid4().hex,
        })
        if not result.get("accepted"):
            raise GateError(f"native Social Search failed: {result}")
        return result["page"]

    def select(self, kind: str) -> None:
        self.open_search()
        self.receiver.find_element(f'[data-search-filter="{kind}"]', 20).click()
        self.fill(self.query)
        self.press(Keys.ENTER)
        self.settled()

    def item(self, resource_id: str) -> dict:
        return next(item for item in self.page()["items"]
                    if item["resource"]["id"] == resource_id)

    def seed_social(self) -> None:
        self.public_text = f"{self.query} 公开帖子"
        self.private_text = f"{self.query} 私密帖子"
        self.public_comment_text = f"{self.query} 历史公开评论"
        self.private_comment_text = f"{self.query} 历史私密评论"
        public = self.moments("bob", "publishPublicMoment", {"text": self.public_text})
        private = self.moments("bob", "publishTypedPrivateMoment", {
            "draftId": uuid.uuid4().hex, "revision": 1, "momentKind": "TEXT",
            "text": self.private_text, "audienceKind": "FRIENDS",
        })
        self.public_post = str(public.get("transientPostId") or "")
        self.private_post = str(private.get("transientPostId") or "")
        if not self.public_post or not self.private_post:
            raise GateError(f"original Social publication failed: {public}, {private}")
        public_comment = self.moments("bob", "submitPublicComment", {
            "postId": self.public_post, "text": self.public_comment_text,
        })
        private_comment = self.moments("bob", "submitPrivateCommentWithRetry", {
            "postId": self.private_post, "text": self.private_comment_text,
        })
        acquired = self.moments("alice", "readPrivateMoment", {"postId": self.private_post})
        if acquired.get("state") != "CONTENT_READY":
            raise GateError(f"original recipient private acquisition is not ready: {acquired}")
        acquired_comments = self.moments("alice", "readPrivateComments", {
            "postId": self.private_post,
        })
        if not acquired_comments.get("comments"):
            raise GateError("original recipient must acquire the old private comment")
        self.public_comment = str(public_comment.get("commentId") or "")
        # Private evidence intentionally hashes IDs; the owning query supplies
        # the original reference after local acquisition.
        self.private_comment = ""
        for index in range(22):
            self.moments("bob", "submitPublicComment", {
                "postId": self.public_post, "text": f"new-public-{self.token}-{index}",
            })
            self.moments("bob", "submitPrivateCommentWithRetry", {
                "postId": self.private_post, "text": f"new-private-{self.token}-{index}",
            })
        self.report.runtime["search"]["socialFixture"] = {
            "publicPost": self.public_post, "privatePost": self.private_post,
            "publicComment": self.public_comment, "newerCommentsPerPost": 22,
            "privatePublication": private, "privateCommentReceipt": private_comment,
            "recipientAcquisition": acquired, "privateAudience": "FRIENDS",
        }

    def mixed(self) -> None:
        self.select("all")
        for text in (self.public_text, self.private_text, self.public_comment_text,
                     self.private_comment_text, self.query + " 原始正文"):
            self.wait_js(
                f"[...document.querySelectorAll('.pt-search-row')].some("
                f"row => row.innerText.includes({json.dumps(text)}))",
                f"native mixed result {text}",
            )
        page = self.page()
        private = next(item for item in page["items"]
                       if item.get("snippet") == self.private_comment_text)
        self.private_comment = private["resource"]["id"]
        self.report.runtime["search"]["socialFixture"]["privateComment"] = self.private_comment
        for resource_id in (
            self.public_post, self.private_post, self.public_comment, self.private_comment,
        ):
            self.wait_js(
                f"document.querySelector('[data-resource-id=\"{resource_id}\"]')",
                "independent canonical Social result row",
            )
        self.visible("mixed_public_private_messages", lambda: all(
            text in self.rows() for text in (
                self.public_text, self.private_text,
                self.public_comment_text, self.private_comment_text,
            )))
        self.select("messages")
        self.visible("messages_filter", lambda: self.query + " 原始正文" in self.rows()
                     and self.public_text not in self.rows() and self.private_text not in self.rows())
        self.select("social")
        self.visible("social_filter", lambda: self.public_text in self.rows()
                     and self.private_text in self.rows()
                     and self.query + " 原始正文" not in self.rows())
        self.report.runtime["search"]["socialCoverage"] = page.get("coverage", [])

    def original_open_return(self) -> None:
        for name, resource_id, text in (
            ("public_post", self.public_post, self.public_text),
            ("private_post", self.private_post, self.private_text),
            ("public_old_comment", self.public_comment, self.public_comment_text),
            ("private_old_comment", self.private_comment, self.private_comment_text),
        ):
            self.select("social")
            item = self.item(resource_id)
            self.report.runtime["search"].setdefault("socialReferences", {})[name] = item
            row = self.receiver.find_element(f'[data-resource-id="{resource_id}"]', 20)
            row.click()
            self.wait_js("!document.querySelector('.pt-search-field')", "original Social route")
            if "comment" in name:
                target = f'[data-moments-comment="{resource_id}"][data-search-anchor="true"]'
                self.wait_js(
                    f"document.activeElement === document.querySelector({json.dumps(target)})",
                    "exact historical original comment focus",
                )
            else:
                self.wait_js(
                    f"[...document.querySelectorAll('[data-acceptance-id=\"social-moment-card\"]')]"
                    f".some(node => node.innerText.includes({json.dumps(text)}))",
                    "original Moment body",
                )
            self.visible(name + "_open", lambda: not self.receiver.find_elements(".pt-search-field"))
            self.open_search()
            self.settled()
            self.visible(name + "_return", lambda: self.surface()["query"] == self.query
                         and self.receiver.find_element('[data-search-filter="social"]')
                         .get_attribute("aria-selected") == "true" and text in self.rows())

    def policy(self) -> None:
        public_before_block = self.item(self.public_post)
        blocked = self.moments("alice", "blockActor", {
            "actorPtid": self.ptids["bob"], "homeStationPeerId": self.station_peer_id,
            "observedRevision": 0,
        })
        try:
            self.select("social")
            self.visible("blocked_social_source", lambda: self.public_text not in self.rows()
                         and self.public_comment_text not in self.rows()
                         and self.private_text not in self.rows()
                         and self.private_comment_text not in self.rows())
            blocked_reference = async_harness(self.receiver, "deviceSearchResolve", {
                "resource": public_before_block["resource"],
                "sourceId": public_before_block["sourceId"], "requestId": uuid.uuid4().hex,
            })
            self.assert_condition("blocked_reference", blocked_reference.get("accepted") is False)
        finally:
            self.moments("alice", "unblockActor", {
                "actorPtid": self.ptids["bob"], "homeStationPeerId": self.station_peer_id,
                "observedRevision": blocked["revision"],
            })
        self.select("all")
        def unavailable() -> None:
            self.receiver.find_element(".pt-search-footer button", 20).click()
            self.settled()
            self.visible("social_source_partial", lambda: self.query + " 原始正文" in self.rows()
                         and any(copy in self.receiver.find_element(".pt-search-footer").text
                                 for copy in ("暂不可用", "unavailable")))
        self.report.runtime["search"]["stationOutage"] = (
            SimulatorSocialGate._restart_source_bound_station(during_outage=unavailable)
        )
        self.select("social")
        old = self.item(self.private_post)
        self.moments("bob", "deletePrivateMoment", {"postId": self.private_post})
        self.select("social")
        self.visible("private_parent_delete", lambda: self.private_text not in self.rows()
                     and self.private_comment_text not in self.rows() and self.public_text in self.rows())
        denial = async_harness(self.receiver, "deviceSearchResolve", {
            "resource": old["resource"], "sourceId": old["sourceId"],
            "requestId": uuid.uuid4().hex,
        })
        self.assert_condition("deleted_private_reference", denial.get("accepted") is False)
        old_public = self.item(self.public_post)
        self.moments("bob", "deletePublicMoment", {"postId": self.public_post})
        self.select("all")
        self.visible("public_parent_delete", lambda: self.public_text not in self.rows()
                     and self.public_comment_text not in self.rows()
                     and self.query + " 原始正文" in self.rows())
        denial_public = async_harness(self.receiver, "deviceSearchResolve", {
            "resource": old_public["resource"], "sourceId": old_public["sourceId"],
            "requestId": uuid.uuid4().hex,
        })
        self.assert_condition("deleted_public_reference", denial_public.get("accepted") is False)
        self.report.runtime["search"]["policyDenials"] = [denial, denial_public]

    def fence(self) -> None:
        sentinel_text = f"{self.query} 账号隔离私密"
        sentinel = self.moments("alice", "publishTypedPrivateMoment", {
            "draftId": uuid.uuid4().hex, "revision": 1, "momentKind": "TEXT",
            "text": sentinel_text, "audienceKind": "SELF",
        })
        self.select("social")
        self.visible("private_account_before_switch", lambda: sentinel_text in self.rows())
        sentinel_item = self.item(sentinel["transientPostId"])
        def account_check() -> None:
            self.select("social")
            self.visible("private_account_after_switch", lambda: sentinel_text not in self.rows())
            denial = async_harness(self.receiver, "deviceSearchResolve", {
                "resource": sentinel_item["resource"], "sourceId": sentinel_item["sourceId"],
                "requestId": uuid.uuid4().hex,
            })
            self.assert_condition("private_account_reference", denial.get("accepted") is False)
            self.select("messages")
        self.select("messages")
        self.prove_account_scope(account_check)
        before = async_harness(self.receiver, "deviceSearchState", {})
        async_harness(self.receiver, "logout", {"actorPtid": self.ptids["alice"]})
        self.client_lifecycles.mark_auth_revoked(self.receiver)
        self.wait_js("!document.querySelector('.pt-search-row')", "logout removes private Search DOM")
        after = async_harness(self.receiver, "identityState", {})
        self.visible("social_logout_concealment", lambda: not self.receiver.find_elements(".pt-search-row"))
        self.assert_condition("logout_search_scope",
                              bool(before.get("partition")) and after.get("authenticated") is False)

    def run(self) -> dict[str, Any]:
        ledger = None
        try:
            version = self.step("station.identity", lambda: read_station_version(self.station_url))
            self.station_peer_id = str(version.get("peer_id") or version.get("station_peer_id") or "")
            self.step("fixture.reset", self.verify_fixture_ready)
            for actor in ("alice", "bob"):
                self.step("client.authenticated", lambda actor=actor: self.start_client(actor), actor)
            self.step("runtime.source_identity", lambda: self.source_identity(version))
            self.assert_condition("native_runtime", all(
                is_native_tauri_url(client.get_current_url()) for client in self.clients.values()))
            ledger = SuiteRuntimeLedger(
                REUSE, suite_runtime_id=self.manifest["runId"],
                source_digest=self.manifest["source"]["commit"], fixture_epoch=self.manifest["runId"],
            )
            ledger.record(SuiteRuntimeAction.PROVISION, resource_id="chat-storage-native")
            for actor in self.clients:
                ledger.record(SuiteRuntimeAction.CLIENT_LAUNCH, resource_id=actor)
                ledger.record(SuiteRuntimeAction.LOGIN, resource_id=actor)
            self.conversation = self.step("conversation.open", self.open_conversation)
            self.step("message.seed", self.seed, "bob")
            self.step("social.seed", self.seed_social)
            for name, action in zip(SCENARIOS, (
                self.mixed, self.original_open_return, self.policy, self.fence,
            )):
                ledger.record(SuiteRuntimeAction.SCENARIO_START, scenario_id=name)
                try:
                    self.step(name, action, "alice")
                    ledger.record(SuiteRuntimeAction.UI_ACTION, scenario_id=name, resource_id=name)
                    ledger.record(SuiteRuntimeAction.RECEIVER_ASSERTION, scenario_id=name, resource_id=name)
                    ledger.record(SuiteRuntimeAction.SUPPORTING_OBSERVATION, scenario_id=name, resource_id=name)
                finally:
                    ledger.record(SuiteRuntimeAction.SCENARIO_END, scenario_id=name)
            for actor in self.clients:
                self.collect_client_evidence(actor)
        finally:
            self.report.runtime["cleanup"] = self.cleanup_clients()
            if ledger:
                ledger.record(SuiteRuntimeAction.CLEANUP_COMPLETE)
                self.report.runtime["suiteRuntime"] = ledger.report()
        return {"journey": self.journey_id}


if __name__ == "__main__":
    gate: AcceptanceGate = SocialContentSearchDesktopGate()
    raise SystemExit(gate.execute())
