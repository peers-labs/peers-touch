from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]


class NativeInteractionContractsTest(unittest.TestCase):
    def source(self, path: str) -> str:
        return (ROOT / path).read_text(encoding="utf-8")

    def test_harness_uses_canonical_production_actions(self) -> None:
        source = self.source("apps/desktop/src/acceptance/chat/harness.ts")
        for method in (
            "sendInteractionMessage",
            "editInteractionMessage",
            "submitMetadataInteraction",
            "submitReadCursor",
            "submitTyping",
            "interactionProjection",
            "typingProjection",
        ):
            self.assertIn(method, source)
        self.assertIn("imServiceV1.messaging.sendMessage", source)
        self.assertIn("api.messagingReadCursor", source)
        self.assertIn("api.messagingTypingSend", source)

    def test_native_dom_selectors_cover_interaction_and_typing_state(self) -> None:
        row = self.source(
            "apps/desktop/src/components/chat/message/ChatMessageRow.tsx"
        )
        area = self.source("apps/desktop/src/components/chat/ChatMessageArea.tsx")
        for selector in (
            'data-message-action="edit"',
            'data-message-action="retract"',
            'data-message-action="reaction"',
            'data-message-action="pin"',
            "data-message-edited=",
            "data-message-retracted=",
            "data-message-reply-to=",
            "data-message-thread-root=",
            "data-message-read-by=",
            'data-message-read-state="read"',
        ):
            self.assertIn(selector, row)
        self.assertIn("data-chat-typing=", area)

    def test_engine_readback_is_acceptance_feature_gated(self) -> None:
        store = self.source("apps/desktop/src-tauri/src/messaging/store.rs")
        gateway = self.source(
            "apps/desktop/src-tauri/src/interface/http_gateway/mod.rs"
        )
        self.assertIn('#[cfg(feature = "acceptance-webdriver")]', store)
        self.assertIn("acceptance_interaction_snapshot", store)
        self.assertIn('#[cfg(feature = "acceptance-webdriver")]', gateway)
        self.assertIn("messaging_acceptance_interaction_snapshot", gateway)

    def test_native_runners_are_observation_bounded_and_source_bound(self) -> None:
        for path in (
            "tooling/acceptance/gates/chat/native_interactions_runner.py",
            "tooling/acceptance/gates/chat/native_typing_runner.py",
        ):
            source = self.source(path)
            self.assertIn("current_workspace_digest", source)
            self.assertIn("read_station_version", source)
            self.assertIn("wait_until(", source)
            self.assertIn("station_readback", source)
            self.assertIn("messaging_acceptance_interaction_snapshot", source)
            self.assertNotIn("time.sleep(", source)
            self.assertNotIn("localhost:18080", source)

    def test_gate_catalog_runs_dedicated_native_gates(self) -> None:
        gates = self.source("tooling/acceptance/gates.yaml")
        self.assertIn('"chat-native-interactions-e2e"', gates)
        self.assertIn(
            "python3 -m tooling.acceptance.gates.chat.native_interactions_runner",
            gates,
        )
        self.assertIn('"chat-native-typing-e2e"', gates)
        self.assertIn(
            "python3 -m tooling.acceptance.gates.chat.native_typing_runner",
            gates,
        )


if __name__ == "__main__":
    unittest.main()
