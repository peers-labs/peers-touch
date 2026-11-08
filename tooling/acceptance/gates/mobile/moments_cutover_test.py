"""Source tests for the denial oracle; no Native product proof."""

import unittest
from unittest.mock import Mock

from tooling.acceptance.core import GateError
from tooling.acceptance.gates.mobile.moments_cutover import assert_public_composer_denial


class MomentsCutoverTests(unittest.TestCase):
    def setUp(self) -> None:
        self.gate = Mock()
        self.session = Mock()
        self.session.call_action.side_effect = lambda action, *_: {
            "moments.publish": {"rejected": True, "code": "FEED_SIGNED_WRITE_REQUIRED"},
            "reliability.draft.read": [{"payloadSha256": "draft-digest"}],
        }.get(action)
        self.session.social_ui.return_value = {"attributes": {"value": "retained text"}}

    def test_denial_requires_product_alert_exact_input_and_durable_draft(self) -> None:
        result = assert_public_composer_denial(self.gate, self.session, "retained text")
        self.assertTrue(result["composerDraftRetained"])
        self.gate._wait_ui.assert_called_once_with(
            self.session, '[data-acceptance-id="social-public-write-rejected"]', "Public write rejection")
        self.gate._wait_ui_attribute.assert_called_once_with(
            self.session, '[data-acceptance-id="social-composer"]',
            "data-draft-persisted", "true", "Retained public draft")

    def test_unsigned_acceptance_fails_before_ui_and_cleanup(self) -> None:
        self.session.call_action.side_effect = None
        self.session.call_action.return_value = {"postId": "unexpected"}
        with self.assertRaisesRegex(GateError, "unsigned public write"):
            assert_public_composer_denial(self.gate, self.session, "retained text")
        self.gate._click_ui.assert_not_called()

    def test_changed_input_fails_before_clearing_the_evidence(self) -> None:
        self.session.social_ui.return_value = {"attributes": {"value": "changed"}}
        with self.assertRaisesRegex(GateError, "changed the composer draft"):
            assert_public_composer_denial(self.gate, self.session, "retained text")
        self.assertFalse(any("social-composer-clear" in str(call) for call in self.gate._click_ui.call_args_list))

    def test_absent_durable_draft_fails(self) -> None:
        self.session.call_action.side_effect = lambda action, *_: (
            {"rejected": True, "code": "FEED_SIGNED_WRITE_REQUIRED"}
            if action == "moments.publish" else [])
        with self.assertRaisesRegex(GateError, "durable Moment draft"):
            assert_public_composer_denial(self.gate, self.session, "retained text")
