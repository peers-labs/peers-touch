"""Shared Mobile public-write denial Journey through the original UI owner."""

from typing import Any

from tooling.acceptance.core import GateError


def assert_public_composer_denial(gate: Any, session: Any, text: str) -> dict[str, Any]:
    rejected = session.call_action("moments.publish", {"text": text, "audienceKind": 1})
    if not isinstance(rejected, dict) or rejected.get("rejected") is not True or rejected.get("code") != "FEED_SIGNED_WRITE_REQUIRED":
        raise GateError("Mobile accepted an unsigned public write")
    session.call_action("navigation.apply", {"kind": "primary", "routeId": "tab:moments"})
    gate._click_ui(session, '[data-acceptance-id="social-composer-open"]', "Public composer")
    gate._set_ui_value(session, '[data-acceptance-id="social-composer-text"]', text, "Public draft")
    gate._click_ui(session, '[data-acceptance-id="social-composer-publish"]', "Unsigned public publish")
    gate._wait_ui(session, '[data-acceptance-id="social-public-write-rejected"]', "Public write rejection")
    gate._wait_ui_attribute(session, '[data-acceptance-id="social-composer"]',
                            "data-draft-persisted", "true", "Retained public draft")
    retained = session.social_ui("query", {"selector": '[data-acceptance-id="social-composer-text"]'})
    if retained.get("attributes", {}).get("value") != text:
        raise GateError("Public denial changed the composer draft")
    drafts = session.call_action("reliability.draft.read", {"kind": "moment"})
    if not isinstance(drafts, list) or not drafts:
        raise GateError("Public denial did not retain a durable Moment draft")
    result = {"publicWriteRejected": True, "composerDraftRetained": True,
              "draftPayloadSha256": [draft["payloadSha256"] for draft in drafts],
              "rejectionScreenshot": session.capture_screenshot("public-write-rejected").to_dict()}
    # Capture rejection before the next scenario changes namespaced business state.
    gate._click_ui(session, '[data-acceptance-id="social-composer-clear"]', "Clear retained test draft")
    session.call_action("navigation.apply", {"kind": "primary", "routeId": "tab:chat"})
    return result
