from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.core import REPO_ROOT
from tooling.acceptance.gates.chat.lifecycle_presence_layout import (
    GATE_ID,
    PRESENCE_LEASE_SECONDS,
    PRESENCE_OBSERVATION_SECONDS,
    REQUIRED_PRESENCE_LAYOUT_ASSERTIONS,
    UNREAD_DELIVERY_CHUNK_SIZE,
    UNREAD_OVERFLOW_TARGET,
    conversation_geometry_equal,
    message_geometry_equal,
    scroll_anchor_equal,
)
from tooling.acceptance.gates.chat.native_two_client_runner import (
    journey_for_gate,
)
from tooling.acceptance.provisioners.home_station import (
    CLIENT_ROLES,
    GATE_ROLES,
)


class LifecyclePresenceLayoutContractTest(unittest.TestCase):
    def source(self, path: str) -> str:
        return (REPO_ROOT / path).read_text(encoding="utf-8")

    def test_feature_is_connected_to_existing_chat_capability(self) -> None:
        domain = json.loads(self.source("tooling/acceptance/domains/chat.yaml"))
        capabilities = json.loads(
            self.source("tooling/acceptance/capabilities/chat.yaml")
        )
        feature = json.loads(
            self.source(
                "tooling/acceptance/features/"
                "chat-presence-layout-stability.yaml"
            )
        )
        capability = next(
            item
            for item in capabilities["capabilities"]
            if item["id"] == "chat-native-visible-clients"
        )

        self.assertIn("chat-native-visible-clients", domain["capabilities"])
        self.assertIn(feature["id"], capability["features"])
        self.assertIn(GATE_ID, feature["required_gates"])
        self.assertIn(GATE_ID, capability["required_gates"])
        self.assertIn(GATE_ID, capability["evidence"]["proven_by"])

    def test_changed_presence_and_layout_paths_select_dedicated_gate(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as raw:
            output = Path(raw) / "plan.json"
            subprocess.run(
                (
                    "python3",
                    "tooling/scripts/acceptance-plan.py",
                    "--changed-file",
                    "apps/station/app/subserver/presence/query.go",
                    "--changed-file",
                    "apps/desktop/src/hooks/usePresence.ts",
                    "--changed-file",
                    "apps/desktop/src/components/chat/ChatSessionList.tsx",
                    "--changed-file",
                    (
                        "apps/desktop/src/components/chat/message/"
                        "ChatMessageTimeline.tsx"
                    ),
                    "--changed-file",
                    (
                        "tooling/acceptance/gates/chat/"
                        "lifecycle_presence_layout.py"
                    ),
                    "--output",
                    str(output),
                ),
                cwd=REPO_ROOT,
                check=True,
                capture_output=True,
                text=True,
            )
            plan = json.loads(output.read_text(encoding="utf-8"))

        selected = {
            gate["id"]
            for gate in plan["selected_gates"]
        }
        self.assertIn(GATE_ID, selected)
        self.assertIn(
            "chat-presence-layout-stability",
            plan["impacted_features"],
        )

    def test_gate_uses_two_station_native_runtime(self) -> None:
        gates = json.loads(self.source("tooling/acceptance/gates.yaml"))
        gate = gates["gates"][GATE_ID]
        self.assertEqual(
            gate["environment"],
            "native-tauri-embedded-webdriver",
        )
        self.assertEqual(
            gate["requiredRuntimeCells"],
            ["desktop-macos-native"],
        )
        self.assertEqual(GATE_ROLES[GATE_ID], ("alice", "bob"))
        self.assertEqual(CLIENT_ROLES[GATE_ID], ("alice", "bob"))
        self.assertEqual(
            journey_for_gate(GATE_ID),
            "presence-layout-stability",
        )

    def test_gate_covers_presence_and_geometry_failure_modes(self) -> None:
        self.assertGreater(
            PRESENCE_OBSERVATION_SECONDS,
            PRESENCE_LEASE_SECONDS,
        )
        for assertion in (
            "presence_cross_station_authority",
            "presence_focus_independent",
            "presence_lease_renewal",
            "presence_unknown_preserved",
            "session_unread_geometry_stable",
            "session_unread_capped",
            "message_metadata_geometry_stable",
            "message_scroll_anchor_stable",
            "message_pending_interaction_slot_reserved",
            "message_emoji_geometry_bounded",
        ):
            self.assertIn(
                assertion,
                REQUIRED_PRESENCE_LAYOUT_ASSERTIONS,
            )

        runner = self.source(
            "tooling/acceptance/gates/chat/lifecycle_presence_layout.py"
        )
        harness = self.source("apps/desktop/src/acceptance/chat/harness.ts")
        for contract in (
            "request_cooperative_activation(",
            "AcceptanceStationPresenceFaultProxy",
            'data-chat-presence-tag',
            'data-chat-session-unread-lane',
            'data-message-metadata-rail',
            'badgeText") == "99+"',
            "wait_until(",
        ):
            self.assertIn(contract, runner)
        self.assertNotIn("time.sleep(", runner)
        self.assertIn("sendInteractionMessageBatch", harness)
        self.assertIn("imServiceV1.messaging.sendMessage(", harness)

    def test_unread_overflow_uses_bounded_observed_batches(self) -> None:
        self.assertGreater(UNREAD_DELIVERY_CHUNK_SIZE, 1)
        self.assertLess(
            UNREAD_DELIVERY_CHUNK_SIZE,
            UNREAD_OVERFLOW_TARGET,
        )

        runner = self.source(
            "tooling/acceptance/gates/chat/lifecycle_presence_layout.py"
        )
        self.assertIn("while next_index <= UNREAD_OVERFLOW_TARGET:", runner)
        self.assertIn("wait_for_unread_projection(", runner)
        self.assertIn('"overflowBatches": overflow_batches', runner)

    def test_conversation_geometry_requires_reserved_shapes(self) -> None:
        before = {
            "row": {"left": 1, "top": 2, "width": 280, "height": 64},
            "text": {"left": 51, "top": 25, "width": 181, "height": 20},
            "lane": {"left": 240, "top": 25, "width": 28, "height": 20},
        }
        after = json.loads(json.dumps(before))
        self.assertTrue(conversation_geometry_equal(before, after))
        after["text"]["width"] = 170
        self.assertFalse(conversation_geometry_equal(before, after))

    def test_message_geometry_and_anchor_are_compared_independently(
        self,
    ) -> None:
        before = {
            "rows": {
                "a": {
                    "row": {"top": 10, "bottom": 82, "height": 72},
                    "rail": {"top": 58, "bottom": 82, "height": 24},
                },
                "b": {
                    "row": {"top": 82, "bottom": 154, "height": 72},
                    "rail": {"top": 130, "bottom": 154, "height": 24},
                },
            },
            "anchorId": "a",
            "anchorOffset": 10,
            "scrollTop": 200,
        }
        after = json.loads(json.dumps(before))
        self.assertTrue(message_geometry_equal(before, after, ("a", "b")))
        self.assertTrue(scroll_anchor_equal(before, after))

        after["rows"]["b"]["row"]["top"] = 85
        self.assertFalse(message_geometry_equal(before, after, ("a", "b")))
        after = json.loads(json.dumps(before))
        after["scrollTop"] = 205
        self.assertFalse(scroll_anchor_equal(before, after))


if __name__ == "__main__":
    unittest.main()
