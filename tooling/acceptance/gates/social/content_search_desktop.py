"""Social-owned native Search journey on the existing two-client runtime."""
from __future__ import annotations

import json
import sys
import time
import uuid
from typing import Any

from selenium.webdriver.common.keys import Keys

from tooling.acceptance import search_capture
from tooling.acceptance.core import (
    AcceptanceGate, EphemeralGateClient, GateError, RuntimeReuseContract, SuiteRuntimeAction,
    SuiteRuntimeLedger, call_async_harness,
)
from tooling.acceptance.gates.chat.device_search_runner import DeviceSearchGate
from tooling.acceptance.gates.chat.native_support import (
    async_harness, is_native_tauri_url, runtime_station_service,
)
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

RETURN_CONTEXT_JS = """
const root = document.querySelector('.pt-search-body');
const rows = root ? [...root.querySelectorAll('.pt-search-row')] : [];
const anchor = rows.find(row => row.getBoundingClientRect().bottom
  > root.getBoundingClientRect().top);
return {
  query: document.querySelector('.pt-search-field input')?.value || '',
  filter: document.querySelector('[data-search-filter][aria-selected="true"]')?.dataset.searchFilter || '',
  selected: root?.querySelector('[aria-selected="true"]')?.dataset.resourceId || '',
  activeDescendant: document.querySelector('.pt-search-field input')?.getAttribute('aria-activedescendant') || '',
  items: rows.map(row => ({id: row.dataset.resourceId, sourceId: row.dataset.sourceId})),
  scrollTop: root?.scrollTop ?? null,
  anchor: anchor?.dataset.resourceId || '', anchorTop: anchor?.getBoundingClientRect().top ?? null,
};
"""


class SocialContentSearchDesktopGate(DeviceSearchGate):
    gate_id = GATE_ID
    journey_id = "social-content-search"
    phase = "Social content Search Desktop"
    bom = ("SOCIAL-CONTENT-FIND-OPEN",)
    spec = ("social-content-search",)
    # This Suite proves mixed-source retrieval; the Chat history Gate retains
    # its 55-message fixture and its original-window assertions.
    history_count = 21

    def surface(self) -> dict[str, Any]:
        rendering = super().surface()
        target = getattr(self, "original_social_target", None)
        if not target or rendering["searchOpen"]:
            return rendering
        original = self.receiver.execute_script(search_capture.TARGET_VISIBILITY_JS + """
const postId = arguments[0], commentId = arguments[1], bodyText = arguments[2];
const threads = [...document.querySelectorAll('[data-moments-comment-thread]')]
  .filter(node => node.dataset.momentsCommentThread === postId);
const thread = threads.length === 1 ? threads[0] : null;
const root = thread?.closest('[data-moments-comments-region]')?.parentElement;
const cards = root ? [...root.querySelectorAll('[data-acceptance-id="social-moment-card"]')]
  .filter(node => node.dataset.postId === postId) : [];
const card = cards.length === 1 ? cards[0] : null;
const body = [...(card?.querySelectorAll('.ant-typography') || [])]
  .find(node => node.innerText.includes(bodyText));
const anchors = thread ? [...thread.querySelectorAll('[data-moments-comment]')]
  .filter(node => node.dataset.momentsComment === commentId
    && node.dataset.searchAnchor === 'true') : [];
const anchor = anchors.length === 1 ? anchors[0] : null;
const commentBody = anchor?.querySelector('div.ant-typography');
const threadPaint = targetVisibility(root, false);
const postPaint = targetVisibility(body);
const anchorPaint = targetVisibility(anchor);
const commentPaint = targetVisibility(commentBody);
return {
  postId: card?.dataset.postId || '',
  commentParentId: thread?.dataset.momentsCommentThread || '',
  postText: body?.innerText || '',
  anchorCommentId: anchor?.dataset.momentsComment || '',
  anchorText: commentBody?.innerText || '',
  anchorFocused: !!anchor && document.activeElement === anchor,
  threadVisible: threadPaint.visible, postVisible: postPaint.visible,
  anchorVisible: anchorPaint.visible && commentPaint.visible,
  pending: !!root?.querySelector('.ant-spin-spinning,[data-private-moment-state]:not('
    + '[data-private-moment-state="REMOTE_DELIVERY_PENDING"]):not('
    + '[data-private-moment-state="REMOTE_DELIVERY_RETRYING"])')
    || !card || !thread,
  visibility: {thread: threadPaint, post: postPaint, anchor: anchorPaint, comment: commentPaint},
};
""", target["postId"], target["commentId"], target["postText"])
        # Desktop has no source attribute on the original card. Retain the
        # actual presented issuance separately, rather than inventing DOM source.
        original["issuedSourceId"] = target["item"]["sourceId"]
        original["issuedResource"] = target["item"]["resource"]
        rendering["originalSocial"] = original
        rendering["painted"] = bool(
            not original["pending"] and original["threadVisible"]
            and (original["anchorVisible"] and original["anchorFocused"]
                 if target["commentId"] else original["postVisible"])
        )
        return rendering

    def original_matches(self, rendering: dict[str, Any]) -> bool:
        target = self.original_social_target
        original = rendering.get("originalSocial") or {}
        return bool(
            not rendering["searchOpen"] and rendering["painted"]
            and original.get("postId") == target["postId"]
            and original.get("commentParentId") == target["postId"]
            and original.get("issuedSourceId") == target["item"]["sourceId"]
            and original.get("issuedResource") == target["item"]["resource"]
            and target["postText"] in original.get("postText", "")
            and (not target["commentId"] or (
                original.get("anchorCommentId") == target["commentId"]
                and original.get("anchorFocused") and original.get("anchorVisible")
                and target["text"] in original.get("anchorText", "")
            ))
        )

    def remember_return_context(self, resource_id: str) -> dict:
        rows = self.receiver.execute_script("""
return [...document.querySelectorAll('.pt-search-row')].map(row => row.dataset.resourceId);
""")
        self.assert_condition("return_target_present", resource_id in rows)
        # Real keyboard selection also establishes a non-default list position
        # where the target requires it; no store or scroll mutation substitutes.
        for _ in rows:
            self.press(Keys.ARROW_UP)
        for _ in range(rows.index(resource_id)):
            self.press(Keys.ARROW_DOWN)
        self.wait_js(
            "document.querySelector('.pt-search-row[aria-selected=\"true\"]')"
            f"?.dataset.resourceId === {json.dumps(resource_id)}",
            "selected original resource before Open",
        )
        return self.receiver.execute_script(RETURN_CONTEXT_JS)

    @staticmethod
    def return_context_matches(before: dict, after: dict) -> bool:
        return bool(
            before.get("selected") and before.get("items") and before.get("anchor")
            and all(before.get(key) == after.get(key) for key in (
                "query", "filter", "selected", "activeDescendant", "items", "anchor",
            ))
            and before.get("scrollTop") is not None and after.get("scrollTop") is not None
            and abs(before["scrollTop"] - after["scrollTop"]) <= 1
            and before.get("anchorTop") is not None and after.get("anchorTop") is not None
            and abs(before["anchorTop"] - after["anchorTop"]) <= 1
        )

    def return_search(self, name: str, before: dict, text: str) -> None:
        context = self.report.runtime["search"].setdefault("returnContext", {}).setdefault(
            name, {"before": before},
        )
        try:
            self.receiver.find_element("[data-search-return] button:first-child", 20).click()
            self.field()
            self.wait_surface()
            self.settled()
            self.visible(name + "_return", lambda: (
                self.surface()["query"] == self.query
                and self.receiver.find_element('[data-search-filter="social"]')
                .get_attribute("aria-selected") == "true" and text in self.rows()
                and self.return_context_matches(
                    before, self.receiver.execute_script(RETURN_CONTEXT_JS),
                )
            ))
        finally:
            try:
                context["after"] = self.receiver.execute_script(RETURN_CONTEXT_JS)
            except Exception as error:
                context["afterDiagnosticError"] = str(error)
        self.reconcile_continuity(name + "_return")

    def moments(self, actor: str, method: str, payload: dict) -> dict:
        return call_async_harness(
            self.clients[actor], method, payload, namespace="moments",
            script_timeout=60,
        )

    def publish_private(self, actor: str, payload: dict) -> dict:
        # The original UI wrapper can throw UNKNOWN_COMMIT for several native
        # states. The native journal owns reconciliation of this exact draft;
        # Fixture readiness waits for its committed result within one budget.
        deadline = time.monotonic() + 45
        while (remaining := deadline - time.monotonic()) >= 1:
            result = call_async_harness(
                self.clients[actor], "probeTypedPrivateMomentRejection", payload,
                namespace="moments", script_timeout=min(15, int(remaining)),
            )
            self.report.runtime["search"].setdefault("privatePublicationAttempts", []).append({
                "actor": actor, "rejected": result.get("rejected"),
                "state": result.get("state"), "errorCode": result.get("errorCode"),
            })
            if result.get("state") == "UNKNOWN_COMMIT":
                time.sleep(min(1, max(0, deadline - time.monotonic())))
                continue
            if not result.get("rejected") and result.get("state") in {
                "PUBLISHED", "REMOTE_DELIVERY_PENDING", "REMOTE_DELIVERY_RETRYING",
            } and result.get("transientPostId"):
                return result
            raise GateError(
                f"original private publication failed: state={result.get('state')}, "
                f"code={result.get('errorCode')}"
            )
        raise GateError("original private publication did not reconcile UNKNOWN_COMMIT within 45s")

    def page(self) -> dict:
        # Supporting references must belong to the real presented UI response.
        # Another submit can change its source session before the row is clicked.
        result = async_harness(self.receiver, "deviceSearchPresentation", {})
        if not result.get("open") or result.get("query") != self.query or not result.get("page"):
            raise GateError("native Social Search has no current presented result page")
        return result["page"]

    def select(self, kind: str) -> None:
        self.open_search()
        self.receiver.find_element(f'[data-search-filter="{kind}"]', 20).click()
        self.fill(self.query)
        # Reapply the real filter submit boundary: Enter on a retained keyboard
        # selection opens that row instead of submitting the current query.
        self.receiver.find_element(f'[data-search-filter="{kind}"]', 20).click()
        self.settled()

    def item(self, resource_id: str) -> dict:
        page = self.page()
        item = next((item for item in page["items"]
                     if item["resource"]["id"] == resource_id), None)
        if item is None:
            raise GateError("original Search result is unavailable; source states="
                            + json.dumps([source["state"] for source in page["coverage"]]))
        return item

    def seed_social(self) -> None:
        # Social content keys belong to the original Secure Content owner.
        # Messaging device enrollment does not establish this fixture readiness.
        readiness = {}
        for actor in ("alice", "bob"):
            prepared = call_async_harness(
                self.clients[actor], "prepareHistoricalRecoveryEpoch", {},
                namespace="secure-content-fixture", script_timeout=60,
            )
            if any(not isinstance(prepared.get(key), int)
                   or isinstance(prepared[key], bool) or prepared[key] < 1
                   for key in ("recoveryEpoch", "recoveryPreKeyAvailable")):
                raise GateError(f"{actor} original Social content keys are unavailable")
            readiness[actor] = {key: prepared[key] for key in (
                "recoveryEpoch", "recoveryPreKeyAvailable",
            )}
        self.report.runtime["search"]["socialKeyReadiness"] = readiness
        self.public_text = f"{self.query} 公开帖子"
        self.private_text = f"{self.query} 私密帖子"
        self.public_comment_text = f"{self.query} 历史公开评论"
        self.private_comment_text = f"{self.query} 历史私密评论"
        public = self.moments("bob", "publishPublicMoment", {"text": self.public_text})
        private = self.publish_private("bob", {
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
        self.visible("social_source_coverage", lambda: all(
            any(copy in self.receiver.find_element(".pt-search-footer").text for copy in copies)
            for copies in (
                ("Private posts and comments acquired on this device", "本机已取得的私密动态与评论"),
                ("Readable public posts and comments on this Station", "当前 Station 可读的公开动态与评论",
                 "Public search on this Station is incomplete; more content remains", "当前 Station 公开检索尚不完整，还有内容未检索"),
            )
        ))
        self.select("messages")
        self.visible("messages_filter", lambda: self.query + " 原始正文" in self.rows()
                     and self.public_text not in self.rows() and self.private_text not in self.rows())
        self.select("social")
        self.visible("social_filter", lambda: self.public_text in self.rows()
                     and self.private_text in self.rows()
                     and self.query + " 原始正文" not in self.rows())
        self.reconcile_continuity("social_filter")
        self.report.runtime["search"]["socialCoverage"] = page.get("coverage", [])
        original_query = self.query
        try:
            self.query = f"new-public-{self.token}"
            self.select("social")
            self.wait_js("document.querySelectorAll('.pt-search-row').length === 20",
                         "first original no-store Social page", timeout=90)
            self.receiver.find_element(".pt-search-more", 20).click()
            self.wait_js("document.querySelectorAll('.pt-search-row').length === 2",
                         "continued original no-store Social page")
            self.reconcile_continuity("social_pagination")
            self.visible("social_pagination", lambda: (
                len(self.receiver.find_elements(".pt-search-row")) == 2
                and self.query in self.rows()
            ))
        finally:
            self.query = original_query
        self.select("social")

    def original_open_return(self) -> None:
        for name, resource_id, text in (
            ("public_post", self.public_post, self.public_text),
            ("private_post", self.private_post, self.private_text),
            ("public_old_comment", self.public_comment, self.public_comment_text),
            ("private_old_comment", self.private_comment, self.private_comment_text),
        ):
            self.select("social")
            item = self.item(resource_id)
            resource = item["resource"]
            comment = "comment" in name
            post_id = self.private_post if "private" in name else self.public_post
            parent = resource.get("parent") or {}
            self.assert_condition(name + "_issued_binding", (
                item["sourceId"] == (
                    "device.social" if "private" in name else "station.social.public")
                and resource["id"] == resource_id
                and (resource.get("kind") == "social-comment"
                     and parent.get("kind") == "social-post" and parent.get("id") == post_id
                     and parent.get("authorityNamespace") == resource.get("authorityNamespace")
                     and resource.get("anchor") == {"kind": "comment", "id": resource_id}
                     if comment else resource.get("kind") == "social-post"
                     and resource["id"] == post_id and not parent)
            ))
            self.report.runtime["search"].setdefault("socialReferences", {})[name] = item
            before_return = self.remember_return_context(resource_id)
            self.report.runtime["search"].setdefault("returnContext", {})[name] = {
                "before": before_return,
            }
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
            self.original_social_target = {
                "item": item, "postId": post_id, "commentId": resource_id if comment else "",
                "postText": self.private_text if "private" in name else self.public_text,
                "text": text,
            }
            try:
                self.visible(name + "_open", lambda: self.original_matches(self.surface()))
            finally:
                del self.original_social_target
            self.return_search(name, before_return, text)

    def block_policy(self) -> None:
        # Block permanently revokes existing private grants. Use fresh targets
        # after outage/deletion proof rather than expecting unblock to restore them.
        texts = [f"{self.query} {label}" for label in (
            "屏蔽公开帖子", "屏蔽私密帖子", "屏蔽公开评论", "屏蔽私密评论",
        )]
        public = self.moments("bob", "publishPublicMoment", {"text": texts[0]})
        private = self.publish_private("bob", {
            "draftId": uuid.uuid4().hex, "revision": 1, "momentKind": "TEXT",
            "text": texts[1], "audienceKind": "FRIENDS",
        })
        public_id = str(public.get("transientPostId") or "")
        private_id = str(private.get("transientPostId") or "")
        if not public_id or not private_id:
            raise GateError("original block fixture publication is unavailable")
        self.moments("bob", "submitPublicComment", {"postId": public_id, "text": texts[2]})
        self.moments("bob", "submitPrivateCommentWithRetry", {
            "postId": private_id, "text": texts[3],
        })
        acquired = self.moments("alice", "readPrivateMoment", {"postId": private_id})
        if acquired.get("state") != "CONTENT_READY":
            raise GateError("original block fixture private acquisition is unavailable")
        self.moments("alice", "readPrivateComments", {"postId": private_id})
        self.select("social")
        self.wait_js(
            f"{json.dumps(texts)}.every(text => [...document.querySelectorAll('.pt-search-row')]"
            ".some(row => row.innerText.includes(text)))",
            "all current block fixture posts and comments",
        )
        references = [item for item in self.page()["items"] if item.get("snippet") in texts]
        self.assert_condition("block_fixture_references", len(references) == 4)
        self.report.runtime["search"]["blockReferences"] = references
        self.visible("block_fixture_visible", lambda: all(text in self.rows() for text in texts))
        relationship = self.moments("alice", "relationshipStatus", {
            "actorPtid": self.ptids["bob"],
        })
        self.assert_condition("relationship_before_block", relationship["blockedByViewer"] is False)
        blocked = self.moments("alice", "blockActor", {
            "actorPtid": self.ptids["bob"], "homeStationPeerId": self.station_peer_id,
            "observedRevision": relationship["revision"],
        })
        try:
            self.select("social")
            self.visible("blocked_social_source", lambda: all(text not in self.rows() for text in texts))
            for index, reference in enumerate(references):
                denied = async_harness(self.receiver, "deviceSearchResolve", {
                    "resource": reference["resource"],
                    "sourceId": reference["sourceId"], "requestId": uuid.uuid4().hex,
                })
                self.assert_condition(f"blocked_reference_{index}", denied.get("accepted") is False)
        finally:
            self.moments("alice", "unblockActor", {
                "actorPtid": self.ptids["bob"], "homeStationPeerId": self.station_peer_id,
                "observedRevision": blocked["revision"],
            })

    def policy(self) -> None:
        self.select("all")
        def unavailable() -> None:
            self.receiver.find_element(".pt-search-footer button", 20).click()
            self.settled()
            self.visible("social_source_partial", lambda: self.query + " 原始正文" in self.rows()
                         and any(copy in self.receiver.find_element(".pt-search-footer").text
                                 for copy in ("暂不可用", "unavailable")))
        self.report.runtime["search"]["stationOutage"] = (
            SimulatorSocialGate._restart_source_bound_station(
                during_outage=unavailable, capability_client=self.capability_client,
            )
        )
        self.select("social")
        # Process health does not establish original Social read readiness.
        try:
            self.wait_js(
                f"document.querySelector('[data-resource-id=\"{self.private_post}\"]')"
                f" && document.querySelector('[data-resource-id=\"{self.public_post}\"]')",
                "original public and private Social results after Station restoration",
            )
        except GateError:
            self.report.runtime["search"]["restorationFailure"] = {
                "surface": self.surface(),
                "presentation": async_harness(self.receiver, "deviceSearchPresentation", {}),
            }
            raise
        self.visible("social_source_recovered", lambda: self.private_text in self.rows()
                     and self.public_text in self.rows())
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
        self.block_policy()

    def fence(self) -> None:
        sentinel_text = f"{self.query} 账号隔离私密"
        sentinel = self.publish_private("alice", {
            "draftId": uuid.uuid4().hex, "revision": 1, "momentKind": "TEXT",
            "text": sentinel_text, "audienceKind": "SELF",
        })
        sentinel_id = str(sentinel.get("transientPostId") or "")
        if not sentinel_id:
            raise GateError("original SELF publication must supply its canonical ID")
        acquired = self.moments("alice", "readPrivateMoment", {"postId": sentinel_id})
        if acquired.get("state") != "CONTENT_READY":
            raise GateError("account fixture must acquire its original SELF post")
        self.report.runtime["search"]["accountFixture"] = {
            "postId": sentinel_id, "state": acquired["state"],
        }
        self.select("social")
        self.visible("private_account_before_switch", lambda: sentinel_text in self.rows())
        sentinel_item = self.item(sentinel_id)
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
        self.capability_client: EphemeralGateClient | None = None
        try:
            self.capability_client = EphemeralGateClient.from_environment()
            if self.capability_client is None:
                raise GateError("Social Search requires its source-bound outage capability")
            version = self.step("station.identity", lambda: read_station_version(self.station_url))
            self.station_peer_id = str(runtime_station_service(
                self.manifest, "bob",
            )["runtimeIdentity"])
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
            self.finish_cleanup(ledger, sys.exc_info()[1])
        return {"journey": self.journey_id}

    def finish_cleanup(self, ledger: SuiteRuntimeLedger | None,
                       primary_error: BaseException | None) -> None:
        try:
            cleanup = self.cleanup_clients()
        except Exception as error:
            cleanup = {key: False for key in (
                "portsReleased", "processesReleased", "storageReleased", "logsReleased",
            )}
            cleanup["cleanupErrors"] = [f"client cleanup failed: {type(error).__name__}"]
        self.report.runtime["cleanup"] = cleanup
        cleanup.setdefault("cleanupErrors", [])
        if self.capability_client is not None:
            try:
                self.capability_client.close()
            except Exception as error:
                cleanup["capabilityChannelClosed"] = False
                cleanup["capabilityCloseError"] = type(error).__name__
            else:
                cleanup["capabilityChannelClosed"] = True
            finally:
                self.capability_client = None
        released = all(cleanup.get(key) is True for key in (
            "portsReleased", "processesReleased", "storageReleased", "logsReleased",
        )) and not cleanup["cleanupErrors"] and cleanup.get("capabilityChannelClosed", True) is True
        released = released and not any(
            assertion.name == "resources_released" and not assertion.passed
            for assertion in self.report.assertions
        )
        self.report.add_assertion("social_resources_released", released, json.dumps(cleanup))
        if ledger:
            if released:
                ledger.record(SuiteRuntimeAction.CLEANUP_COMPLETE)
            self.report.runtime["suiteRuntime"] = ledger.report()
        if not released:
            if primary_error is None:
                raise GateError("Social Search cleanup failed; native proof remains unproven")
            primary_error.add_note("Social Search cleanup also failed; see runtime.cleanup")


if __name__ == "__main__":
    gate: AcceptanceGate = SocialContentSearchDesktopGate()
    raise SystemExit(gate.execute())
