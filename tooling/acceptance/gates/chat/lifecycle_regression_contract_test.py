from __future__ import annotations

import unittest

from tooling.acceptance.core import REPO_ROOT


MATRIX = (
    REPO_ROOT
    / "docs/architecture/chat-lifecycle/acceptance-matrix.md"
)
PRODUCT = (
    REPO_ROOT
    / "docs/architecture/chat-lifecycle/product-definition.md"
)
TASK_ROOT = (
    REPO_ROOT
    / "docs/architecture/chat-lifecycle/execution-plans"
    / "20260916-chat-lifecycle-product-closure/tasks"
)

REGRESSION_OWNERS = {
    "CHAT-UR01": (
        "CHAT-02-onboarding.md",
        "chat-lifecycle-onboarding-e2e",
    ),
    "CHAT-UR02": (
        "CHAT-03-direct.md",
        "chat-lifecycle-direct-e2e",
    ),
    "CHAT-UR03": (
        "CHAT-03-direct.md",
        "chat-lifecycle-direct-e2e",
    ),
    "CHAT-UR04": (
        "CHAT-03-direct.md",
        "chat-lifecycle-direct-e2e",
    ),
    "CHAT-UR05": (
        "CHAT-05-interactions-group.md",
        "chat-lifecycle-interactions-group-e2e",
    ),
    "CHAT-UR06": (
        "CHAT-04-rich-voice.md",
        "chat-lifecycle-rich-voice-e2e",
    ),
    "CHAT-UR07": (
        "CHAT-06-live-voice.md",
        "chat-lifecycle-live-voice-e2e",
    ),
    "CHAT-UR08": (
        "CHAT-02-onboarding.md",
        "chat-lifecycle-onboarding-e2e",
    ),
    "CHAT-UR09": (
        "CHAT-02-onboarding.md",
        "chat-lifecycle-onboarding-e2e",
    ),
    "CHAT-UR10": (
        "CHAT-03-direct.md",
        "chat-lifecycle-direct-e2e",
    ),
    "CHAT-UR11": (
        "CHAT-03-direct.md",
        "chat-lifecycle-direct-e2e",
    ),
    "CHAT-UR12": (
        "CHAT-03-direct.md",
        "chat-lifecycle-direct-e2e",
    ),
    "CHAT-UR13": (
        "CHAT-03-direct.md",
        "chat-lifecycle-direct-e2e",
    ),
}


class LifecycleRegressionContractTest(unittest.TestCase):
    def test_every_user_regression_has_one_formal_task_and_gate(self) -> None:
        matrix = MATRIX.read_text(encoding="utf-8")
        for regression_id, (task_name, gate_id) in REGRESSION_OWNERS.items():
            with self.subTest(regression_id=regression_id):
                self.assertEqual(matrix.count(f"| {regression_id} |"), 1)
                self.assertIn(gate_id, matrix)
                task = (TASK_ROOT / task_name).read_text(encoding="utf-8")
                self.assertEqual(task.count(f"{regression_id}:"), 1)
                self.assertIn(gate_id, task)

    def test_one_to_one_video_is_required_but_group_calls_are_not(self) -> None:
        product = PRODUCT.read_text(encoding="utf-8")
        self.assertIn(
            "| CHAT-C10 | Live one-to-one voice and video | required |",
            product,
        )
        self.assertIn(
            "One-to-one audio and video; group calling remains deferred",
            product,
        )
        self.assertNotIn("One-to-one audio only; video is deferred", product)

    def test_direct_experience_regressions_keep_owner_level_guards(self) -> None:
        desktop = REPO_ROOT / "apps/desktop/src"
        message_area = (
            desktop / "components/chat/ChatMessageArea.tsx"
        ).read_text(encoding="utf-8")
        detail_panel = (
            desktop / "components/chat/ChatDetailPanel.tsx"
        ).read_text(encoding="utf-8")
        search_modal = (
            desktop / "components/chat/SearchMessagesModal.tsx"
        ).read_text(encoding="utf-8")
        social_chat = (
            desktop / "store/socialChat.ts"
        ).read_text(encoding="utf-8")
        social_realtime = (
            desktop / "services/socialRealtime.ts"
        ).read_text(encoding="utf-8")
        station_settings = (
            REPO_ROOT
            / "apps/station/app/subserver/conversation/application/command/projections.go"
        ).read_text(encoding="utf-8")
        messaging_schema = (
            REPO_ROOT / "packages/messaging-core/src/store/schema.rs"
        ).read_text(encoding="utf-8")
        desktop_gateway = (
            REPO_ROOT
            / "apps/desktop/src-tauri/src/interface/http_gateway/mod.rs"
        ).read_text(encoding="utf-8")

        self.assertIn("resolveFederationStationName", message_area)
        self.assertIn("refreshPeerPresence", social_realtime)
        self.assertIn("setConversationBackgroundPreview", detail_panel)
        self.assertIn("resolveMessageSearchTargets(", social_chat)
        self.assertIn("data-chat-message-search-clear", search_modal)
        self.assertIn("historyRestoreWindow", station_settings)
        self.assertIn("message-search-backfill-v1", messaging_schema)
        self.assertIn("messaging_search_messages_result", desktop_gateway)


if __name__ == "__main__":
    unittest.main()
