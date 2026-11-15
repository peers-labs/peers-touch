"""Search authority and temporal observation regressions; Native proof is separate."""

import json
import subprocess
import unittest

from tooling.development.secure_content.social_feed_ui import (
    ACQUIRED_COMMENT_BASELINE_JS,
    START_STABLE_FEED_JS,
    identity_search_cases,
)


class FeedSearchAuthorityTest(unittest.TestCase):
    def setUp(self):
        self.cards = [
            {"postId": "one", "actorPtid": "alice", "author": "Alice", "body": "Acquired private body"},
            {"postId": "two", "actorPtid": "bob", "author": "Bob", "body": "Alice mentioned here"},
        ]
        self.identities = [
            {"postId": "two", "actorPtid": "bob", "displayName": "Bob", "username": "bob",
             "homeStationDomain": "b.test", "homeStationName": "Station B"},
            {"postId": "one", "actorPtid": "alice", "displayName": "Alice", "username": "alice",
             "homeStationDomain": "a.test", "homeStationName": ""},
        ]

    def test_author_expectation_includes_body_matches_and_domain_uses_exact_profile(self):
        cases = identity_search_cases(self.cards, self.identities, "one")
        self.assertEqual(
            {case["field"]: case["expected"] for case in cases},
            {"displayName": ["one", "two"], "username": ["one", "two"], "homeStationDomain": ["one"]},
        )
        self.assertNotIn("homeStationName", [case["field"] for case in cases])

    def test_mismatched_identity_or_displayed_author_fails_instead_of_redefining_expectation(self):
        for field, value in (("actorPtid", "old-actor"), ("displayName", "Stale Alice")):
            with self.subTest(field=field):
                identities = [dict(item) for item in self.identities]
                identities[1][field] = value
                with self.assertRaisesRegex(RuntimeError, "Painted author"):
                    identity_search_cases(self.cards, identities, "one")

    def test_missing_domain_or_missing_card_authority_remains_a_gap(self):
        self.identities[1]["homeStationDomain"] = ""
        with self.assertRaisesRegex(RuntimeError, "unavailable"):
            identity_search_cases(self.cards, self.identities, "one")
        with self.assertRaisesRegex(RuntimeError, "does not match"):
            identity_search_cases(self.cards, self.identities[:1], "one")


OBSERVER_VM = r"""
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const callbacks = [];
let observe;
const leaf = text => ({textContent: text, childNodes: [], isConnected: true,
  contains(node) { return node === this; }});
const bodyText = leaf('private parent');
const body = {...leaf('private parent'), childNodes: [bodyText]};
let expanded = !(input.mode === 'collapsed');
const toggle = {...leaf('2'), getAttribute: () => String(expanded)};
const makeRow = text => {
  const content = leaf(text);
  const control = {...leaf('emoji'), getAttribute: name =>
    name === 'data-comment-like-count' ? '1' : 'true'};
  return {...leaf(text), childNodes: [content, control],
    querySelector: selector => selector === '.sk-comment-text' ? content : control,
    querySelectorAll: () => [content, control]};
};
const rows = [makeRow('root'), makeRow('reply')];
if (input.mode.startsWith('empty')) rows.length = 0;
const empty = leaf('No comments');
const editor = {...leaf(''), value: 'retained draft', selectionStart: 2, selectionEnd: 8,
  selectionDirection: 'forward'};
const thread = {...leaf(''), querySelector: selector =>
  selector === '.pt-mom-comment-status' ? (rows.length ? null : empty) :
  selector.includes('social-comment-input') ? editor : null, querySelectorAll: () => rows};
const card = {...leaf(''), querySelector: selector =>
  selector.includes('sk-post-body') ? body :
  selector.includes('comment-thread') ? thread : toggle};
const cards = [card, leaf('neighbor')];
const scroller = {scrollHeight: 500, clientHeight: 200, scrollTop: 72, scrollLeft: 0};
card.parentElement = scroller;
let hidden = false;
global.document = {
  activeElement: editor,
  querySelector: selector => selector === '.moments-app' ? leaf('app') : card,
  querySelectorAll: () => cards,
};
global.window = {};
global.getComputedStyle = () => ({visibility: hidden ? 'hidden' : 'visible', display: 'block', opacity: '1'});
global.requestAnimationFrame = callback => { callbacks.push(callback); return callbacks.length; };
let cancelled = 0, disconnected = 0;
global.cancelAnimationFrame = () => cancelled++;
global.MutationObserver = class {
  constructor(callback) { observe = callback; }
  observe() {}
  disconnect() { disconnected++; }
};
new Function(input.script)('target', 'cards', {
  rows: rows.length, expanded, editor: true, alive: input.mode.startsWith('alive-'),
});
callbacks.shift()();
if (input.mode.startsWith('alive-')) {
  window.__PT_SOCIAL_FEED_OBSERVATION__('inactive');
  hidden = true;
  scroller.scrollTop = 0;
  callbacks.shift()();
  hidden = false;
  if (input.mode !== 'alive-reset-scroll') scroller.scrollTop = 72;
  window.__PT_SOCIAL_FEED_OBSERVATION__('active');
  if (input.mode === 'alive-hidden-after-return') hidden = true;
  callbacks.shift()();
} else if (input.mode === 'reinserted-card') {
  observe([{type: 'childList', removedNodes: [card]}]);
} else if (input.mode === 'blank-restored-body') {
  // Both mutations arrive after text has already been restored. A final-state
  // sample alone would miss the empty intermediate value.
  observe([{type: 'characterData', target: bodyText, oldValue: '', removedNodes: []}]);
} else if (input.mode === 'spinner') {
  thread.querySelector = () => leaf('spinner');
  callbacks.shift()();
  thread.querySelector = () => null;
} else if (input.mode === 'unrelated-spinner' || input.mode === 'transient-thread-spinner') {
  // Loading elsewhere in the page is not a target-thread replacement.
  // A spinner inserted and removed in the retained thread between paint
  // frames must still fail through the mutation record.
  const spinner = {...leaf(''), nodeType: 1, matches: () => true, querySelector: () => null};
  observe([{type: 'childList',
    target: input.mode === 'transient-thread-spinner' ? thread : cards[1],
    addedNodes: [spinner], removedNodes: []}]);
} else if (input.mode === 'changed-count') {
  rows[0].querySelector('[data-comment-like]').getAttribute = () => '0';
  callbacks.shift()();
} else if (input.mode === 'empty-reinserted-status') {
  observe([{type: 'childList', removedNodes: [empty]}]);
} else if (input.mode === 'lost-selection') {
  editor.selectionStart = 0;
} else if (input.mode === 'lost-focus') {
  document.activeElement = body;
} else if (input.mode === 'reopened') {
  expanded = false;
} else if (input.mode === 'rolled-back-and-restored-count') {
  observe([{type: 'attributes', target: rows[0].querySelector('[data-comment-like]'),
    attributeName: 'data-comment-like-count', oldValue: '0', removedNodes: []}]);
}
callbacks.shift()();
const stats = window.__PT_SOCIAL_FEED_OBSERVATION__();
console.log(JSON.stringify({...stats, cancelled, disconnected,
  released: !window.__PT_SOCIAL_FEED_OBSERVATION__}));
"""


class FeedTemporalObserverTest(unittest.TestCase):
    def observe(self, mode):
        process = subprocess.run(
            ["node", "-e", OBSERVER_VM],
            input=json.dumps({"script": START_STABLE_FEED_JS, "mode": mode}),
            capture_output=True, text=True, check=True,
        )
        return json.loads(process.stdout)

    def test_unchanged_feed_keeps_native_frame_sampling_and_releases_observer(self):
        stats = self.observe("stable")
        self.assertGreaterEqual(stats["frames"], 2)
        self.assertEqual(stats["violations"], [])
        self.assertTrue(stats["released"])
        self.assertEqual((stats["cancelled"], stats["disconnected"]), (1, 1))

    def test_removed_then_reinserted_same_card_is_not_a_stable_observation(self):
        self.assertIn("protected-node-removed", self.observe("reinserted-card")["violations"])

    def test_transient_empty_body_is_detected_even_after_restoration(self):
        self.assertIn("protected-text-changed", self.observe("blank-restored-body")["violations"])

    def test_initial_spinner_or_changed_confirmed_reaction_cannot_pass(self):
        self.assertIn("thread-loading-or-removal", self.observe("spinner")["violations"])
        self.assertIn("comment-content-or-reaction", self.observe("changed-count")["violations"])

    def test_loading_mutations_belong_to_the_original_comment_thread(self):
        self.assertEqual(self.observe("unrelated-spinner")["violations"], [])
        self.assertIn("thread-loading-or-removal",
                      self.observe("transient-thread-spinner")["violations"])

    def test_empty_and_collapsed_baselines_remain_valid_without_reopening(self):
        for mode in ("empty-stable", "collapsed"):
            with self.subTest(mode=mode):
                self.assertEqual(self.observe(mode)["violations"], [])
        self.assertIn("protected-node-removed", self.observe("empty-reinserted-status")["violations"])
        self.assertIn("comment-expansion-or-count", self.observe("reopened")["violations"])

    def test_draft_selection_and_focus_cannot_silently_reset(self):
        self.assertIn("editor-draft-or-selection", self.observe("lost-selection")["violations"])
        self.assertIn("editor-focus", self.observe("lost-focus")["violations"])
        self.assertIn("confirmed-control-transient-change",
                      self.observe("rolled-back-and-restored-count")["violations"])

    def test_alive_navigation_checks_original_scroll_and_visibility_after_return(self):
        stable = self.observe("alive-stable")
        self.assertEqual(stable["violations"], [])
        self.assertTrue(stable["aliveReturned"])
        self.assertGreaterEqual(stable["returnedFrames"], 2)
        self.assertIn("feed-scroll", self.observe("alive-reset-scroll")["violations"])
        self.assertIn("card-hidden", self.observe("alive-hidden-after-return")["violations"])


class CommentAcquisitionReadinessTest(unittest.TestCase):
    def test_initial_read_must_finish_before_empty_or_populated_baseline_is_ready(self):
        script = r"""
const script = JSON.parse(require('fs').readFileSync(0, 'utf8'));
let loading = true, rows = [], empty = null;
const thread = {
  querySelector: selector => selector === '.pt-spinner' ? loading :
    selector === '.pt-mom-comment-status' ? empty : null,
  querySelectorAll: () => rows,
};
global.document = {querySelector: () => ({querySelector: () => thread})};
const ready = new Function(script);
const results = [ready('post', 0)];
loading = false;
results.push(ready('post', 0));
empty = {textContent: 'No comments'};
results.push(ready('post', 0));
rows = [{}, {}];
loading = true;
results.push(ready('post', 2));
loading = false;
results.push(ready('post', 2));
console.log(JSON.stringify(results));
"""
        result = subprocess.run(
            ["node", "-e", script], input=json.dumps(ACQUIRED_COMMENT_BASELINE_JS),
            capture_output=True, text=True, check=True,
        )
        self.assertEqual(json.loads(result.stdout), [False, False, True, False, True])


if __name__ == "__main__":
    unittest.main()
