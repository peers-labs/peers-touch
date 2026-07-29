#!/usr/bin/env python3
"""Regression tests for Desktop browser runtime sampling preflight evidence."""

from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path
from typing import Any


def load_module() -> Any:
    script = Path(__file__).with_name("desktop-performance-browser-preflight.py")
    spec = importlib.util.spec_from_file_location("desktop_performance_browser_preflight", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {script}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class DesktopPerformanceBrowserPreflightTest(unittest.TestCase):
    def test_clean_ready_shell_allows_sample_emission(self) -> None:
        module = load_module()
        report = module.evaluate_snapshot(
            {
                "href": "http://localhost:3210/#/chat",
                "text": "Chats\nSettings",
                "anchors": {"primary": 11, "context": 3},
                "buttons": ["Chats", "Settings"],
                "events": 12,
            },
            "tmp/browser-preflight.json",
        )

        self.assertEqual(report["artifactKind"], "desktop-performance-browser-preflight")
        self.assertEqual(report["status"], "pass")
        self.assertEqual(report["completionStatus"], "DONE")
        self.assertEqual(report["proofStatus"], "PROVEN")
        self.assertTrue(report["sampleEmissionAllowed"])
        self.assertEqual(report["issue_breakdown"], [])
        self.assertEqual(report["summary"]["missingAnchors"], [])

    def test_cancel_finish_overlay_blocks_sample_emission(self) -> None:
        module = load_module()
        report = module.evaluate_snapshot(
            {
                "href": "http://localhost:3210/#/chat",
                "text": "Contacts\nCancel\nFinish",
                "anchors": {"primary": 11, "context": 3},
                "buttons": [{"text": "Cancel"}, {"text": "Finish"}],
                "events": 85,
            },
            "tmp/browser-preflight.json",
        )

        self.assertEqual(report["status"], "baseline preflight failure")
        self.assertEqual(report["completionStatus"], "PARTIAL")
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertFalse(report["sampleEmissionAllowed"])
        self.assertEqual(report["failedStep"], "browser-blocking-ui:1")
        self.assertEqual(report["issue_breakdown"][0]["category"], "browser-runtime-preflight")
        self.assertEqual(report["issue_breakdown"][0]["sourceArtifactKind"], "desktop-performance-browser-preflight")
        self.assertEqual(report["issue_breakdown"][0]["sourcePhase"], "P0b-2/P0b-7/P0c-5")
        self.assertIn("Cancel", report["reason"])

    def test_cancel_finish_form_actions_do_not_block_clean_shell(self) -> None:
        module = load_module()
        report = module.evaluate_snapshot(
            {
                "href": "http://localhost:3210/#/settings",
                "text": "Settings\nGeneral\nIdentity\nPublic Profile",
                "anchors": {"primary": 11, "context": 3},
                "buttons": [{"text": "Cancel"}, {"text": "Finish"}],
                "events": 64,
            },
            "tmp/browser-preflight.json",
        )

        self.assertEqual(report["status"], "pass")
        self.assertEqual(report["completionStatus"], "DONE")
        self.assertEqual(report["proofStatus"], "PROVEN")
        self.assertTrue(report["sampleEmissionAllowed"])
        self.assertEqual(report["summary"]["blockingReasonCount"], 0)

    def test_hidden_blocking_text_does_not_block_visible_clean_shell(self) -> None:
        module = load_module()
        report = module.evaluate_snapshot(
            {
                "href": "http://localhost:3210/#/chat",
                "text": "Chats\nSettings\nNo contacts found\nCancel\nFinish",
                "visibleText": "Chats\nSettings\nInbox",
                "anchors": {"primary": 11, "context": 3},
                "buttons": [{"text": "Cancel"}, {"text": "Finish"}],
                "events": 64,
            },
            "tmp/browser-preflight.json",
        )

        self.assertEqual(report["status"], "pass")
        self.assertEqual(report["completionStatus"], "DONE")
        self.assertEqual(report["proofStatus"], "PROVEN")
        self.assertTrue(report["sampleEmissionAllowed"])
        self.assertEqual(report["summary"]["blockingReasonCount"], 0)

    def test_missing_required_anchor_blocks_sample_emission(self) -> None:
        module = load_module()
        report = module.evaluate_snapshot(
            {
                "text": "Chats",
                "anchors": {"primary": 4, "context": 0},
                "buttons": ["Chats"],
            },
            "tmp/browser-preflight.json",
        )

        self.assertEqual(report["status"], "baseline preflight failure")
        self.assertFalse(report["sampleEmissionAllowed"])
        self.assertEqual(report["failedStep"], "browser-anchor:context")
        self.assertEqual(report["summary"]["missingAnchors"], ["context"])

    def test_cdp_page_selection_requires_target_url_when_supplied(self) -> None:
        module = load_module()

        class Response:
            def __enter__(self) -> "Response":
                return self

            def __exit__(self, *_args: object) -> None:
                return None

            def read(self) -> bytes:
                return json.dumps(
                    [
                        {
                            "type": "page",
                            "url": "http://localhost:3200/?surface=settings",
                            "webSocketDebuggerUrl": "ws://127.0.0.1:9224/prototype",
                        },
                        {
                            "type": "page",
                            "url": "http://localhost:3210/#/chat",
                            "webSocketDebuggerUrl": "ws://127.0.0.1:9224/desktop",
                        },
                    ]
                ).encode("utf-8")

        original_urlopen = module.urllib.request.urlopen
        try:
            module.urllib.request.urlopen = lambda *_args, **_kwargs: Response()
            self.assertEqual(
                module.first_page_websocket_url("127.0.0.1", 9224, "localhost:3210"),
                "ws://127.0.0.1:9224/desktop",
            )
            with self.assertRaisesRegex(RuntimeError, "no page target matching"):
                module.first_page_websocket_url("127.0.0.1", 9224, "localhost:9999")
        finally:
            module.urllib.request.urlopen = original_urlopen


if __name__ == "__main__":
    unittest.main()
