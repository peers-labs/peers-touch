"""Feed observations attached to the original AS20 Social UI controls."""

from __future__ import annotations

import hashlib
import time
from typing import TYPE_CHECKING, Any

from tooling.acceptance import search_capture
from tooling.acceptance.core.harness import call_async_harness
from tooling.acceptance.gates.agent.foundation_runtime_client import wait_until

if TYPE_CHECKING:
    from .social_interaction_ui import SocialCommentUI


CARDS = '.moments-app [data-acceptance-id="social-moment-card"][data-post-id]'
SEARCH = '.moments-app input[data-scope-search="feed"]'


def _sha(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def identity_search_cases(
    baseline: list[dict[str, str]], identities: list[dict[str, str]], post_id: str,
) -> list[dict[str, Any]]:
    """Build independent expectations from acquired UI bodies and profile authority."""
    authority = {item["postId"]: item for item in identities}
    if len(authority) != len(identities) or set(authority) != {item["postId"] for item in baseline}:
        raise RuntimeError("Feed identity readback does not match acquired cards")
    for card in baseline:
        identity = authority[card["postId"]]
        if card["actorPtid"] != identity["actorPtid"] or card["author"] != identity["displayName"]:
            raise RuntimeError("Painted author differs from canonical profile")
    target = authority.get(post_id)
    if not target or not target["displayName"].strip() or not target["homeStationDomain"].strip():
        raise RuntimeError("Canonical author/Station search authority is unavailable")
    cases = []
    for field in ("displayName", "username", "homeStationDomain", "homeStationName"):
        query = target[field].strip()
        if not query:
            continue
        expected = [
            card["postId"] for card in baseline
            if query.lower() in "\n".join([
                card["body"], *(authority[card["postId"]][key] for key in
                               ("displayName", "username", "homeStationDomain", "homeStationName")),
            ]).lower()
        ]
        cases.append({"field": field, "query": query, "expected": sorted(expected)})
    return cases


def assert_identity_search(ui: SocialCommentUI, post_id: str) -> dict[str, Any]:
    post = ui.open_thread(post_id)
    baseline = ui.driver.execute_script("""
      return Array.from(document.querySelectorAll(arguments[0]), card => ({
        postId: card.dataset.postId, actorPtid: card.dataset.authorPtid,
        author: card.querySelector('[data-acceptance-id="social-moment-author"]')?.textContent.trim() || '',
        body: card.querySelector(':scope > .sk-post-body > p')?.textContent || '',
      }));
    """, CARDS)
    readback = call_async_harness(
        ui.driver, "feedSearchIdentities", {"postIds": [card["postId"] for card in baseline]},
        namespace="moments", script_timeout=30,
    )
    cases = identity_search_cases(baseline, readback["identities"], post_id)
    before = sorted(card["postId"] for card in baseline)
    target_identity = next(item for item in readback["identities"] if item["postId"] == post_id)

    def ids() -> list[str]:
        return ui.driver.execute_script(
            "return Array.from(document.querySelectorAll(arguments[0]), e => e.dataset.postId).sort();",
            CARDS,
        )

    def query(value: str) -> None:
        field = wait_until(lambda: ui.visible(SEARCH), f"{ui.actor} feed search field", timeout=30)
        field.clear()
        if value:
            field.send_keys(value)

    field = wait_until(lambda: ui.visible(SEARCH), f"{ui.actor} feed search field", timeout=30)
    if field.get_attribute("value"):
        raise RuntimeError("AS20 identity search must start with an empty query")
    results = []
    try:
        for case in cases:
            value, expected = case["query"], case["expected"]
            ui.click(SEARCH, f"search-private-{case['field']}")
            query(value)
            wait_until(lambda: ids() == expected, f"{ui.actor} {case['field']} search results", timeout=30)
            target = ui.driver.find_element("css selector", post)
            ui.driver.execute_script("arguments[0].scrollIntoView({block:'center'});", target)

            def painted() -> bool:
                return ids() == expected and ui.driver.execute_script(
                    search_capture.TARGET_VISIBILITY_JS + """
                    const card = document.querySelector(arguments[0]);
                    const field = document.querySelector(arguments[1]);
                    return field?.value === arguments[2]
                      && card?.dataset.authorPtid === arguments[3]
                      && card.querySelector('[data-acceptance-id="social-moment-author"]')?.textContent.trim()
                        === arguments[4] && targetVisibility(card, true).visible;
                    """, post, SEARCH, value,
                    target_identity["actorPtid"], target_identity["displayName"],
                )

            deadline = time.monotonic() + 30
            wait_until(painted, f"{ui.actor} painted {case['field']} search", timeout=30)
            if not ui.driver.execute_async_script(
                search_capture.CAPTURE_PAINT_JS, max(1, int((deadline - time.monotonic()) * 1000)),
            ) or time.monotonic() >= deadline:
                raise RuntimeError(f"Native {case['field']} search paint frames timed out")
            screenshot = ui.evidence_root / f"private-search-{case['field']}.png"
            dom = screenshot.with_suffix(".html")
            if not ui.driver.save_screenshot(str(screenshot)):
                raise RuntimeError("Native identity search screenshot failed")
            ui.save_dom(dom)
            if time.monotonic() >= deadline or not painted():
                raise RuntimeError("Native identity search changed during capture")
            ui.artifacts.extend((screenshot, dom))
            query(value + "-no-matching-parent")
            wait_until(lambda: ids() == [], f"{ui.actor} identity search no match", timeout=30)
            results.append({
                "field": case["field"], "querySha256": _sha(value), "matchedCount": len(expected),
                "targetMatched": post_id in expected, "noMatch": True,
                "screenshot": str(screenshot), "dom": str(dom),
            })
    finally:
        query("")
    wait_until(lambda: ids() == before, f"{ui.actor} identity search clear restores feed", timeout=30)
    result = {
        "actor": ui.actor, "postIdSha256": _sha(post_id), "queries": results,
        "friendlyStationNameAvailable": any(case["field"] == "homeStationName" for case in cases),
        "clearedFeedRestored": True,
    }
    ui.assertions.append({"assertion": "canonical-feed-search", **result})
    return result


START_STABLE_FEED_JS = """
const selector = arguments[0], cardsSelector = arguments[1];
if (window.__PT_SOCIAL_FEED_OBSERVATION__) throw new Error('Social observer already active');
const app = document.querySelector('.moments-app'), card = document.querySelector(selector);
const cards = Array.from(document.querySelectorAll(cardsSelector));
const body = card?.querySelector(':scope > .sk-post-body > p');
const thread = card?.querySelector('[data-moments-comment-thread]');
const toggle = card?.querySelector('[data-acceptance-id="social-open-comments"]');
const rows = Array.from(thread?.querySelectorAll('[data-moments-comment]') || []);
if (!app || !body?.textContent || !thread || !toggle || rows.length !== 2)
  throw new Error('Social stable feed baseline missing');
const protectedNodes = new Set(cards);
for (const node of [body, toggle, thread, ...rows,
  ...rows.flatMap(row => Array.from(row.querySelectorAll('.sk-comment-text, [data-comment-like]')))]) {
  protectedNodes.add(node);
  for (const child of node.childNodes) protectedNodes.add(child);
}
const text = body.textContent, count = toggle.textContent;
const rowState = rows.map(row => ({
  text: row.querySelector('.sk-comment-text')?.textContent,
  control: row.querySelector('[data-comment-like]'),
  count: row.querySelector('[data-comment-like]')?.getAttribute('data-comment-like-count'),
  selected: row.querySelector('[data-comment-like]')?.getAttribute('aria-pressed'),
}));
const stats = {frames: 0, mutations: 0, violations: []};
let stopped = false, frame;
const fail = code => { if (!stats.violations.includes(code)) stats.violations.push(code); };
const check = () => {
  const current = Array.from(document.querySelectorAll(cardsSelector));
  if (current.length !== cards.length || current.some((node, index) => node !== cards[index]))
    fail('feed-card-identity-or-order');
  if (!card.isConnected || !body.isConnected || body.textContent !== text) fail('parent-body');
  if (toggle.getAttribute('aria-expanded') !== 'true' || toggle.textContent !== count)
    fail('comment-expansion-or-count');
  if (!thread.isConnected || thread.querySelector('.pt-spinner')) fail('thread-loading-or-removal');
  const style = getComputedStyle(card);
  if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0)
    fail('card-hidden');
  const currentRows = Array.from(thread.querySelectorAll('[data-moments-comment]'));
  if (currentRows.length !== rows.length || currentRows.some((node, index) => node !== rows[index]))
    fail('comment-row-identity-or-order');
  rows.forEach((row, index) => {
    const before = rowState[index], control = row.querySelector('[data-comment-like]');
    if (row.querySelector('.sk-comment-text')?.textContent !== before.text
      || control !== before.control
      || control?.getAttribute('data-comment-like-count') !== before.count
      || control?.getAttribute('aria-pressed') !== before.selected) fail('comment-content-or-reaction');
  });
};
const observer = new MutationObserver(records => {
  stats.mutations += records.length;
  for (const record of records) {
    for (const removed of record.removedNodes) {
      if (Array.from(protectedNodes).some(node => removed === node || removed.contains(node)))
        fail('protected-node-removed');
    }
    if (record.type === 'characterData' && protectedNodes.has(record.target)
      && record.oldValue !== record.target.textContent) fail('protected-text-changed');
  }
  check();
});
observer.observe(app, {subtree: true, childList: true, attributes: true,
  characterData: true, characterDataOldValue: true});
const sample = () => {
  if (stopped) return;
  stats.frames += 1;
  check();
  frame = requestAnimationFrame(sample);
};
check();
frame = requestAnimationFrame(sample);
window.__PT_SOCIAL_FEED_OBSERVATION__ = () => {
  check();
  stopped = true;
  cancelAnimationFrame(frame);
  observer.disconnect();
  delete window.__PT_SOCIAL_FEED_OBSERVATION__;
  return stats;
};
return {started: true};
"""


def assert_stable_reconcile(ui: SocialCommentUI, post_id: str) -> dict[str, Any]:
    """Observe real Runtime reconciles and Native frames, retaining the original thread."""
    post = ui.open_thread(post_id)
    ui.driver.execute_script(START_STABLE_FEED_JS, post, CARDS)
    completed = 0
    try:
        for _ in range(2):
            result = call_async_harness(
                ui.driver, "reconcileFeedProjection", namespace="moments", script_timeout=120,
            )
            if result != {"reconciled": True}:
                raise RuntimeError("Original Moments Runtime reconcile did not complete")
            completed += 1
        deadline = time.monotonic() + 30
        if not ui.driver.execute_async_script(search_capture.CAPTURE_PAINT_JS, 30_000):
            raise RuntimeError("Stable feed Native paint frames timed out")
        screenshot = ui.evidence_root / "private-feed-stable-reconcile.png"
        dom = screenshot.with_suffix(".html")
        if not ui.driver.save_screenshot(str(screenshot)):
            raise RuntimeError("Stable feed Native screenshot failed")
        ui.save_dom(dom)
        if time.monotonic() >= deadline:
            raise RuntimeError("Stable feed Native capture timed out")
        ui.artifacts.extend((screenshot, dom))
    finally:
        stats = ui.driver.execute_script(
            "return window.__PT_SOCIAL_FEED_OBSERVATION__?.();",
        )
    if not stats or stats["frames"] < 2 or stats["violations"]:
        raise RuntimeError(f"Native repeated feed reconcile was not stable: {stats}")
    result = {
        "actor": ui.actor, "postIdSha256": _sha(post_id), "runtimeReconciles": completed,
        **stats, "parentRetained": True, "rootAndReplyRetained": True,
        "screenshot": str(screenshot), "dom": str(dom),
    }
    ui.assertions.append({"assertion": "stable-feed-reconcile", **result})
    return result
