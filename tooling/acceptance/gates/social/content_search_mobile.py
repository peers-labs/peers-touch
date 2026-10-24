"""Bilateral Social Search proof using the existing Mobile Search Suite."""
from __future__ import annotations

import uuid
import time
from collections.abc import Mapping
from typing import Any

from tooling.acceptance.core import AcceptanceGate, ArtifactSession, EphemeralGateClient
from tooling.acceptance.gates.chat.mobile_device_search import (
    MobileDeviceSearchGate, PAGE, ROW, require,
)
from tooling.acceptance.gates.mobile.messaging_journey import MobileMessagingJourney

GATE_ID = "social-content-search-mobile-native-e2e"


class SocialContentSearchMobileGate(MobileDeviceSearchGate):
    scenario_gates = {"device-search": GATE_ID}
    scenario_metadata = {"device-search": {
        "phase": "Social content Search Mobile",
        "bom": ["SOCIAL-CONTENT-FIND-OPEN"], "spec": ["social-content-search"],
    }}

    @staticmethod
    def surface(session: Any) -> dict:
        rendering = MobileDeviceSearchGate.surface(session)
        rendering["originalSocial"] = session.execute_script("""
const watch = window.__PT_SOCIAL_CAPTURE_WATCH__;
if (watch && watch.observer.takeRecords().length) watch.revision += 1;
const thread = document.querySelector('[data-acceptance-id="social-moment-thread"]');
if (!thread) return null;
const anchor = [...thread.querySelectorAll('[data-scroll-anchor-id]')]
  .find(row => row.dataset.scrollAnchorId === thread.dataset.anchorCommentId
    && row.dataset.searchHighlighted === 'true');
const box = anchor?.getBoundingClientRect();
return {
  domRevision: watch?.revision || 0,
  postId: thread.dataset.postId,
  sourceId: thread.dataset.sourceId || 'station.social.public',
  anchorCommentId: thread.dataset.anchorCommentId || '',
  pending: !!thread.querySelector('[data-product-surface="moments.detail-loading"],'
    + '[data-product-surface="moments.comments-loading"]'),
  postText: thread.querySelector('[data-acceptance-id="social-moment-card"]')?.innerText || '',
  anchorText: anchor?.innerText || '',
  anchorFocused: !!anchor && document.activeElement === anchor,
  anchorVisible: !!box && box.width > 0 && box.height > 0
    && box.top >= 0 && box.bottom <= innerHeight
    && box.left >= 0 && box.right <= innerWidth,
};
""")
        return rendering

    def capture(self, artifacts: ArtifactSession, session: Any, name: str,
                *, concealed: bool = False, diagnostic: bool = False) -> None:
        deadline = time.monotonic() + 30
        session.execute_script("""
window.__PT_SOCIAL_CAPTURE_WATCH__?.observer.disconnect();
const watch = {revision: 0};
watch.observer = new MutationObserver(() => { watch.revision += 1; });
watch.observer.observe(document.body, {
  childList: true, subtree: true, characterData: true, attributes: true,
});
window.__PT_SOCIAL_CAPTURE_WATCH__ = watch;
""")
        try:
            if not diagnostic:
                painted = session.execute_async_script("""
const done = arguments[arguments.length - 1];
let finished = false;
const finish = value => { if (!finished) { finished = true; done(value); } };
const timeout = setTimeout(() => finish(false), arguments[0]);
requestAnimationFrame(() => requestAnimationFrame(() => {
  clearTimeout(timeout);
  finish(true);
}));
""", max(1, int((deadline - time.monotonic()) * 1000)))
                require(painted and time.monotonic() < deadline,
                        f"{name} native paint frames timed out")
            super().capture(
                artifacts, session, name, concealed=concealed, diagnostic=diagnostic,
                deadline_monotonic=deadline,
            )
        finally:
            session.execute_script("""
window.__PT_SOCIAL_CAPTURE_WATCH__?.observer.disconnect();
delete window.__PT_SOCIAL_CAPTURE_WATCH__;
""")

    @staticmethod
    def capture_pending(rendering: Mapping[str, Any], concealed: bool) -> bool:
        original = rendering.get("originalSocial")
        return MobileDeviceSearchGate.capture_pending(rendering, concealed) or bool(
            isinstance(original, Mapping) and (
                original.get("pending")
                or (original.get("anchorCommentId") and (
                    not original.get("anchorFocused") or not original.get("anchorVisible")
                ))
            ))

    def _run_social_journey(self, artifacts: ArtifactSession,
                            manifest: Mapping[str, Any]) -> dict:
        self.capability_client = EphemeralGateClient.from_environment()
        require(self.capability_client is not None,
                "Social Search requires its source-bound outage capability")
        return super()._run_social_journey(artifacts, manifest)

    def _capture_runtime_failure(self, artifacts: ArtifactSession) -> list[dict[str, Any]]:
        diagnostics = []
        for session in self.sessions:
            try:
                social = session.call_action("social.projection.read")
                private = session.call_action("moments.private.snapshot")
                moments = social.get("moments") or {}
                reference = artifacts.write_json(
                    f"social-content-search/{session.client_id}/failure-moments.json",
                    {"clientId": session.client_id, "moments": moments,
                     "privateReads": private.get("reads"),
                     "privateReadHistory": private.get("readStateHistoryByPostId")},
                    role=f"social-search-original-moments-failure/{session.client_id}",
                )
                diagnostics.append({"clientId": session.client_id, "artifact": reference.to_dict()})
                for feed in moments.values():
                    detail = feed.get("selectedDetail") or {}
                    retained = next((row for row in private.get("reads", [])
                                     if row.get("postId") == detail.get("postId")), {})
                    if (detail.get("sourceId") != "device.social"
                            or detail.get("state") != "unavailable"
                            or retained.get("state") != "CONTENT_READY"):
                        continue
                    probe = session.execute_async_script("""
const done = arguments[arguments.length - 1];
Promise.resolve(window.__PEERS_MOBILE_ACCEPTANCE__['moments.private.read']({
  postId: arguments[0],
})).then(value => done({state: value.state}), error => {
  const message = String(error?.message || error);
  const transport = message.match(
    /private Social transport failed \\(status=(Some\\(\\d+\\)|None), code=(\\d+), private_content_code=([A-Z0-9_]+|none)\\)/);
  done({
    code: /^MOBILE_[A-Z_]+$/.test(error?.code || '') ? error.code : '',
    runtimeError: message.match(/^mobile\\.privateSocial\\.[A-Za-z]+$/)?.[0] || '',
    transport: transport ? {status: transport[1], code: transport[2],
      privateContentCode: transport[3]} : null,
  });
});
""", detail["postId"])
                    probe_reference = artifacts.write_json(
                        f"social-content-search/{session.client_id}/failure-private-read.json",
                        {"postId": detail["postId"], "originalRead": probe},
                        role=f"social-search-original-private-read-failure/{session.client_id}",
                    )
                    diagnostics.append({"clientId": session.client_id,
                                        "artifact": probe_reference.to_dict()})
                    break
            except Exception as error:
                diagnostics.append({"clientId": session.client_id, "errorType": type(error).__name__})
        return diagnostics + super()._capture_runtime_failure(artifacts)

    def seed(self, journey: MobileMessagingJourney, sender_session: Any,
             receiver_session: Any, conversation: str, token: str) -> dict:
        def send(text: str, **extra: Any) -> str:
            sent = self.mutate_when_admitted(sender_session, "messaging.send", {
                "conversationId": conversation, "plaintext": text, **extra,
            })
            journey._await_message(
                receiver_session, conversation, sent["messageId"],
                lambda row: row.get("plaintext") == text, "Social Search Chat fixture receipt",
            )
            return sent["messageId"]
        query = f"周会 {token}"
        root = send(f"{query} 原始正文")
        reply_query = f"线程 {token}"
        reply = send(reply_query, replyToMessageId=root, threadRootMessageId=root)
        filler = [send(f"历史 {token} {index:03}") for index in range(21)]
        return {"conversation": conversation, "query": query, "root": root,
                "reply": reply, "replyQuery": reply_query, "filler": filler, "token": token}

    def social_seed(self, session: Any, sender: Any, query: str) -> dict:
        self._prepare_private_keys(session)
        self._prepare_private_keys(sender)
        text = {
            "public": f"{query} 公开帖子", "private": f"{query} 私密帖子",
            "publicComment": f"{query} 历史公开评论",
            "privateComment": f"{query} 历史私密评论",
        }
        public = self.mutate_when_admitted(sender, "moments.publish", {
            "text": text["public"], "audienceKind": 1,
        })
        private = self.mutate_when_admitted(sender, "moments.private.publishText", {
            "draftId": uuid.uuid4().hex, "draftRevision": 1,
            "text": text["private"], "audience": {"kind": "FRIENDS"},
        })
        require(public.get("postId") and private.get("postId"),
                "original Social publication must supply canonical IDs")
        public_comment = self.mutate_when_admitted(sender, "moments.comment", {
            "postId": public["postId"], "content": text["publicComment"],
        })
        private_comment = self.mutate_when_admitted(sender, "moments.private.comment.submit", {
            "draftId": uuid.uuid4().hex, "draftRevision": 1,
            "postId": private["postId"], "text": text["privateComment"],
        })
        require(public_comment.get("commentId") and private_comment.get("commentId"),
                "original public/private comments must be acquired")
        acquired = session.call_action("moments.private.read", {"postId": private["postId"]})
        require(acquired.get("state") == "CONTENT_READY",
                "original recipient must receive and decrypt the private post")
        acquired_comments = session.call_action("moments.private.comments.read", {
            "postId": private["postId"],
        })
        require(any(row["commentId"] == private_comment["commentId"]
                    for row in acquired_comments["comments"]),
                "original recipient must acquire the old private comment")
        for index in range(22):
            self.mutate_when_admitted(sender, "moments.comment", {
                "postId": public["postId"], "content": f"new-public-{query}-{index}",
            })
            self.mutate_when_admitted(sender, "moments.private.comment.submit", {
                "draftId": uuid.uuid4().hex, "draftRevision": 1,
                "postId": private["postId"], "text": f"new-private-{query}-{index}",
            })
        return {**text, "publicId": public["postId"], "privateId": private["postId"],
                "publicCommentId": public_comment["commentId"],
                "privateCommentId": private_comment["commentId"], "newerCommentsPerPost": 22,
                "privateAudience": "FRIENDS", "recipientAcquisition": acquired}

    def select(self, session: Any, filter_name: str, query: str) -> None:
        self.open(session)
        self.click(session, f'[data-search-filter="{filter_name}"]')
        self.fill(session, query)
        self.wait(session, """
const page = document.querySelector(arguments[0]);
return page?.dataset.searchState === 'ready'
  && document.querySelector('#mobile-search-input')?.value === arguments[1];
""", "current Social Search result page", PAGE, query)

    def original_open(self, artifacts: ArtifactSession, session: Any,
                      query: str, resource_id: str, post_id: str,
                      text: str, name: str) -> None:
        self.select(session, "social", query)
        self.has(session, resource_id, text)
        self.click(session, f'{ROW}[data-resource-id="{resource_id}"]')
        self._wait_ui_absent(session, PAGE, "original Social detail route")
        if "comment" in name:
            self.wait(session, """
const row = document.querySelector(
  `[data-scroll-anchor-id="${arguments[0]}"][data-search-highlighted="true"]`);
return !!row && document.activeElement === row;
""", "exact original historical comment focus", resource_id)
        else:
            self.wait(session, """
return [...document.querySelectorAll('[data-acceptance-id="social-moment-card"]')]
  .some(row => row.dataset.postId === arguments[0] && row.innerText.includes(arguments[1]));
""", "original Social post body", resource_id, text)
        self.capture(artifacts, session, f"social-{name}-open")
        frame = self.frames[f"{session.client_id}/social-{name}-open"]
        frame["assertionPassed"] = False
        original = frame["rendering"].get("originalSocial") or {}
        require(original.get("postId") == post_id
                and original.get("sourceId") == (
                    "device.social" if "private" in name else "station.social.public")
                and not original.get("pending"),
                "captured original Social target must match its issued parent and source")
        if "comment" in name:
            require(original.get("anchorCommentId") == resource_id
                    and original.get("anchorFocused") and original.get("anchorVisible")
                    and text in original.get("anchorText", ""),
                    "captured historical comment must be visible, focused and exact")
        else:
            require(text in original.get("postText", ""),
                    "captured original post body must match")
        frame["assertionPassed"] = True
        self.click(session, '[data-acceptance-id="social-moment-thread"] '
                   '.moments-comments-header > button')
        self._wait_ui(session, PAGE, "return to retained Search route")
        self.has(session, resource_id, text)
        require(session.execute_script("""
return document.querySelector('#mobile-search-input')?.value === arguments[0]
  && document.querySelector('[data-search-filter="social"]')?.getAttribute('aria-pressed') === 'true';
""", query), "Social return must retain query and filter")
        self.capture(artifacts, session, f"social-{name}-return")

    def block_policy(self, artifacts: ArtifactSession, session: Any,
                     sender: Any, query: str) -> None:
        # Existing private grants are revoked by block, not restored by unblock.
        # These targets do not share the outage/deletion fixture's authority.
        texts = [f"{query} {label}" for label in (
            "屏蔽公开帖子", "屏蔽私密帖子", "屏蔽公开评论", "屏蔽私密评论",
        )]
        public = self.mutate_when_admitted(sender, "moments.publish", {
            "text": texts[0], "audienceKind": 1,
        })
        private = self.mutate_when_admitted(sender, "moments.private.publishText", {
            "draftId": uuid.uuid4().hex, "draftRevision": 1,
            "text": texts[1], "audience": {"kind": "FRIENDS"},
        })
        require(public.get("postId") and private.get("postId"),
                "original block fixture must supply canonical post IDs")
        public_comment = self.mutate_when_admitted(sender, "moments.comment", {
            "postId": public["postId"], "content": texts[2],
        })
        private_comment = self.mutate_when_admitted(sender, "moments.private.comment.submit", {
            "draftId": uuid.uuid4().hex, "draftRevision": 1,
            "postId": private["postId"], "text": texts[3],
        })
        require(public_comment.get("commentId") and private_comment.get("commentId"),
                "original block fixture must supply canonical comment IDs")
        acquired = session.call_action("moments.private.read", {"postId": private["postId"]})
        require(acquired.get("state") == "CONTENT_READY",
                "block fixture private content must be acquired before block")
        acquired_comments = session.call_action("moments.private.comments.read", {
            "postId": private["postId"],
        })
        require(any(row["commentId"] == private_comment["commentId"]
                    for row in acquired_comments["comments"]),
                "block fixture private comment must be acquired before block")
        ids = [public["postId"], private["postId"],
               public_comment["commentId"], private_comment["commentId"]]
        self.select(session, "social", query)
        for resource_id, text in zip(ids, texts):
            self.has(session, resource_id, text)
        self.capture(artifacts, session, "social-block-fixture-visible")
        page = self.native_page(session, query, kinds=[])
        references = [item for item in page["items"] if item["resource"]["id"] in ids]
        require(len(references) == 4, "block fixture must have four issued references")
        artifacts.write_json(
            f"social-content-search/{session.client_id}/block-references.json", {"items": references},
            role=f"social-content-search-block-references/{session.client_id}",
        )
        peer_identity = sender.call_action("getRealtimeDevice")
        self.mutate_when_admitted(session, "social.block", {
            "actorPtid": peer_identity["actorPtid"],
        })
        try:
            self.select(session, "social", query)
            require(not set(ids).intersection(self.rows(session)),
                    "blocked author's posts and comments must disappear")
            self.capture(artifacts, session, "social-blocked")
            for index, reference in enumerate(references):
                self.denial(session, f"blocked-reference-{index}", "search.resolve", {
                    "resource": reference["resource"], "sourceId": reference["sourceId"],
                }, "SEARCH_RESOURCE_UNAVAILABLE")
        finally:
            self.mutate_when_admitted(session, "social.unblock", {
                "actorPtid": peer_identity["actorPtid"],
            })

    def search_scenario(self, artifacts: ArtifactSession, session: Any,
                        sender_session: Any, fixture: dict) -> dict:
        query = fixture["query"]
        social = self.social_seed(session, sender_session, query)
        artifacts.write_json(
            f"social-content-search/{session.client_id}/fixture.json", social,
            role=f"social-content-search-fixture/{session.client_id}",
        )
        self.select(session, "all", query)
        ids = [social[key] for key in (
            "publicId", "privateId", "publicCommentId", "privateCommentId",
        )]
        for resource_id in ids:
            self.has(session, resource_id, query)
        self.has(session, fixture["root"], query)
        self.wait(session, """
const coverage = document.querySelector('.mobile-search-coverage')?.innerText || '';
return ['Private posts and comments acquired on this device', '本机已取得的私密动态与评论']
  .some(copy => coverage.includes(copy))
  && ['Readable public posts and comments on this Station', '当前 Station 可读的公开动态与评论',
      'Public search on this Station is incomplete; more content remains', '当前 Station 公开检索尚不完整，还有内容未检索']
    .some(copy => coverage.includes(copy));
""", "original public and acquired-private source coverage")
        self.capture(artifacts, session, "social-mixed-results")
        self.select(session, "messages", query)
        require(not set(ids).intersection(self.rows(session)), "message filter excludes Social")
        self.has(session, fixture["root"], query)
        self.capture(artifacts, session, "social-messages-filter")
        self.select(session, "social", query)
        require(fixture["root"] not in self.rows(session), "Social filter excludes Messaging")
        for resource_id in ids:
            self.has(session, resource_id, query)
        self.capture(artifacts, session, "social-content-filter")
        original = self.native_page(session, query, kinds=[])
        artifacts.write_json(
            f"social-content-search/{session.client_id}/references.json", original,
            role=f"social-content-search-references/{session.client_id}",
        )
        for name, key, text_key in (
            ("public-post", "publicId", "public"),
            ("private-post", "privateId", "private"),
            ("public-comment", "publicCommentId", "publicComment"),
            ("private-comment", "privateCommentId", "privateComment"),
        ):
            parent = social["privateId" if "private" in name else "publicId"]
            self.original_open(
                artifacts, session, query, social[key], parent, social[text_key], name,
            )
        session.call_action("lifecycle.suspend")
        require(not self.rows(session), "background concealment must remove all Social rows")
        self.capture(artifacts, session, "social-concealed", concealed=True)
        session.call_action("lifecycle.resume")
        for resource_id in ids:
            self.has(session, resource_id, query)
        self.capture(artifacts, session, "social-resumed")
        self.select(session, "all", query)
        def unavailable() -> None:
            self.click(session, ".mobile-search-page .page-header .header-action:last-child")
            self.wait(session, """
return document.querySelector('[data-search-state]')?.dataset.searchState === 'ready'
  && [...document.querySelectorAll('.mobile-search-coverage [data-source-state]')]
    .some(node => !['1', 'READY'].includes(node.dataset.sourceState));
""", "visible incomplete source coverage during Station outage")
            self.has(session, fixture["root"], query)
            self.capture(artifacts, session, "social-source-partial")
        outage = self._restart_source_bound_station(
            during_outage=unavailable, capability_client=self.capability_client,
        )
        artifacts.write_json(
            f"social-content-search/{session.client_id}/outage.json", outage,
            role=f"social-content-search-outage/{session.client_id}",
        )
        self.select(session, "social", query)
        # Service health alone cannot prove original Social reads have resumed.
        self.has(session, social["publicId"], social["public"])
        self.has(session, social["privateId"], social["private"])
        self.capture(artifacts, session, "social-source-recovered")
        deleted = self.mutate_when_admitted(sender_session, "moments.delete", {
            "postId": social["privateId"],
        })
        require(deleted.get("deleted") is True, "original owner must delete private parent")
        self.select(session, "social", query)
        require(not {social["privateId"], social["privateCommentId"]}.intersection(self.rows(session)),
                "deleted private parent suppresses every comment")
        self.capture(artifacts, session, "social-private-parent-deleted")
        for resource_id in (social["privateId"], social["privateCommentId"]):
            item = next(item for item in original["items"] if item["resource"]["id"] == resource_id)
            self.denial(session, f"deleted-{resource_id}", "search.resolve", {
                "resource": item["resource"], "sourceId": item["sourceId"],
            }, "SEARCH_RESOURCE_UNAVAILABLE")
        deleted_public = self.mutate_when_admitted(sender_session, "moments.delete", {
            "postId": social["publicId"],
        })
        require(deleted_public.get("deleted") is True, "original owner must delete public parent")
        self.select(session, "all", query)
        require(not {social["publicId"], social["publicCommentId"]}.intersection(self.rows(session)),
                "deleted public parent suppresses every comment")
        self.has(session, fixture["root"], query)
        self.capture(artifacts, session, "social-public-parent-deleted")
        for resource_id in (social["publicId"], social["publicCommentId"]):
            item = next(item for item in original["items"] if item["resource"]["id"] == resource_id)
            self.denial(session, f"deleted-{resource_id}", "search.resolve", {
                "resource": item["resource"], "sourceId": item["sourceId"],
            }, "SEARCH_RESOURCE_UNAVAILABLE")
        self.block_policy(artifacts, session, sender_session, query)
        # Real Chat received content and the existing continuity/return owner.
        self.select(session, "messages", fixture["replyQuery"])
        self.target(artifacts, session, fixture["replyQuery"], fixture["reply"], "social-chat-regression")
        return {
            "uiAction": f"{session.client_id}:mixed-social-search-original-open-return",
            "receiverAssertion": f"{session.client_id}:public-private-old-comments-and-delete",
            "supportingObservation": f"{session.client_id}:source-bound-resources-and-denials",
        }

    def account_scenario(self, artifacts: ArtifactSession, session: Any, peer_session: Any,
                         actor: Any, peer: Any, fixture: dict, journey: MobileMessagingJourney) -> dict:
        text = f'{fixture["query"]} 账号隔离私密'
        sentinel = self.mutate_when_admitted(session, "moments.private.publishText", {
            "draftId": uuid.uuid4().hex, "draftRevision": 1,
            "text": text, "audience": {"kind": "SELF"},
        })
        self.select(session, "social", fixture["query"])
        self.has(session, sentinel["postId"], text)
        self.capture(artifacts, session, "social-account-before")
        item = next(item for item in self.native_page(session, fixture["query"], kinds=[])["items"]
                    if item["resource"]["id"] == sentinel["postId"])
        self.select(session, "messages", fixture["replyQuery"])
        def account_check() -> None:
            self.select(session, "social", fixture["query"])
            require(sentinel["postId"] not in self.rows(session),
                    "new account must not publish old private Social projections")
            self.capture(artifacts, session, "social-account-after")
            self.denial(session, "old-account-private-reference", "search.resolve", {
                "resource": item["resource"], "sourceId": item["sourceId"],
            }, "SEARCH_RESOURCE_UNAVAILABLE")
            self.select(session, "messages", fixture["replyQuery"])
        return super().account_scenario(
            artifacts, session, peer_session, actor, peer, fixture, journey, account_check,
        )


if __name__ == "__main__":
    gate: AcceptanceGate = SocialContentSearchMobileGate()
    raise SystemExit(gate.execute())
