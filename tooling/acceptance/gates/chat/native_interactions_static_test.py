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
            "openInteractionThread",
            "deleteLocalInteractionMessage",
            "revokeCurrentDevice",
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
        thread = self.source("apps/desktop/src/components/chat/ChatThreadPanel.tsx")
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
        for selector in (
            'data-chat-thread-panel="open"',
            "data-chat-thread-root=",
            "data-chat-thread-reply-count=",
            "data-thread-message-id=",
            "data-thread-message-order=",
            "data-thread-message-role=",
        ):
            self.assertIn(selector, thread)
        self.assertIn("data-message-reply-target-state=", row)
        self.assertIn("replyTargetUnavailable", row)

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
            self.assertIn("profile_three_environment(self.station_url)", source)
            self.assertNotIn("time.sleep(", source)
            self.assertNotIn("localhost:18080", source)

    def test_interaction_gate_fails_closed_on_every_w12_variant(self) -> None:
        source = self.source(
            "tooling/acceptance/gates/chat/native_interactions_runner.py"
        )
        for assertion in (
            "direct_reply_thread_panel",
            "direct_reply_target_unavailable",
            "direct_author_only_retract",
            "direct_reaction_remove_convergence",
            "direct_offline_recovery",
            "direct_duplicate_queue_replay",
            "group_reply_thread_panel",
            "group_reply_target_unavailable",
            "group_author_only_retract",
            "group_reaction_remove_convergence",
            "group_offline_recovery",
            "group_duplicate_queue_replay",
            "group_removed_member_denied",
            "revoked_device_denied",
            "pending_interaction_timeout_retry_cancel",
            "station_restart_convergence",
            "resources_released",
        ):
            self.assertIn(f'"{assertion}"', source)
        self.assertIn('self.prove_lifecycle("friend"', source)
        self.assertNotIn('self.prove_lifecycle("direct"', source)

    def test_profile_three_restart_is_remote_and_source_bound(self) -> None:
        runner = self.source(
            "tooling/acceptance/gates/chat/native_interactions_runner.py"
        )
        fixture = self.source(
            "tooling/acceptance/fixtures/chat_native_reset.py"
        )
        self.assertIn("restart_profile_three_station", runner)
        self.assertNotIn('"station-restart"', runner)
        self.assertIn("CHAT_ACCEPTANCE_ALLOW_STATION_RESTART", fixture)
        self.assertIn("docker restart", fixture)
        self.assertIn(".State.StartedAt", fixture)
        self.assertIn("parsed_url.hostname != host", fixture)
        self.assertIn("parsed_url.port != 18080", fixture)
        self.assertIn("beforeCommit", fixture)
        self.assertIn("afterCommit", fixture)
        self.assertIn("lane_row.next_sequence + 1", fixture)
        self.assertIn("SET next_sequence = next_sequence + 1", fixture)
        self.assertIn("self.station_url,", runner)
        self.assertIn('"cleanup": self.cleanup_evidence', runner)
        self.assertIn("device changed across client restart", runner)

    def test_typing_gate_requires_full_group_lifecycle_and_cleanup(self) -> None:
        source = self.source(
            "tooling/acceptance/gates/chat/native_typing_runner.py"
        )
        for assertion in (
            "group_typing_start_stop",
            "group_typing_send_clear",
            "group_typing_blur_clear",
            "group_typing_switch_clear",
            "group_typing_disconnect_ttl_clear",
            "group_removed_member_rejected",
            "typing_revoked_device_rejected",
            "typing_has_zero_durable_writes",
            "resources_released",
        ):
            self.assertIn(f'"{assertion}"', source)
        self.assertIn("port_is_free", source)
        self.assertIn('"cleanup": self.cleanup_evidence', source)
        self.assertIn("device changed after disconnect restart", source)

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
