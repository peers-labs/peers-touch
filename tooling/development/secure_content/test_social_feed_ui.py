"""Search authority and temporal observation regressions; Native proof is separate."""

import json
import subprocess
import unittest

from tooling.development.secure_content.social_feed_ui import (
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
const toggle = {...leaf('2'), getAttribute: () => 'true'};
const makeRow = text => {
  const content = leaf(text);
  const control = {...leaf('emoji'), getAttribute: name =>
    name === 'data-comment-like-count' ? '1' : 'true'};
  return {...leaf(text), childNodes: [content, control],
    querySelector: selector => selector === '.sk-comment-text' ? content : control,
    querySelectorAll: () => [content, control]};
};
const rows = [makeRow('root'), makeRow('reply')];
const thread = {...leaf(''), querySelector: () => null, querySelectorAll: () => rows};
const card = {...leaf(''), querySelector: selector =>
  selector.includes('sk-post-body') ? body :
  selector.includes('comment-thread') ? thread : toggle};
const cards = [card, leaf('neighbor')];
global.document = {
  querySelector: selector => selector === '.moments-app' ? leaf('app') : card,
  querySelectorAll: () => cards,
};
global.window = {};
global.getComputedStyle = () => ({visibility: 'visible', display: 'block', opacity: '1'});
global.requestAnimationFrame = callback => { callbacks.push(callback); return callbacks.length; };
let cancelled = 0, disconnected = 0;
global.cancelAnimationFrame = () => cancelled++;
global.MutationObserver = class {
  constructor(callback) { observe = callback; }
  observe() {}
  disconnect() { disconnected++; }
};
new Function(input.script)('target', 'cards');
callbacks.shift()();
if (input.mode === 'reinserted-card') {
  observe([{type: 'childList', removedNodes: [card]}]);
} else if (input.mode === 'blank-restored-body') {
  // Both mutations arrive after text has already been restored. A final-state
  // sample alone would miss the empty intermediate value.
  observe([{type: 'characterData', target: bodyText, oldValue: '', removedNodes: []}]);
} else if (input.mode === 'spinner') {
  thread.querySelector = () => leaf('spinner');
  callbacks.shift()();
  thread.querySelector = () => null;
} else if (input.mode === 'changed-count') {
  rows[0].querySelector('[data-comment-like]').getAttribute = () => '0';
  callbacks.shift()();
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


if __name__ == "__main__":
    unittest.main()
