from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
SCENARIOS = (
    ROOT / "tooling/acceptance/gates/agent/chat_conversation_scenarios.py"
)


class ChatConversationScenariosTest(unittest.TestCase):
    def test_follow_up_uses_the_product_suggestion_selector(self) -> None:
        source = SCENARIOS.read_text(encoding="utf-8")
        follow_up = source.split("def follow_up(", 1)[1].split(
            "\ndef send_stop(",
            1,
        )[0]

        self.assertIn("data-pt-agent-follow-up", follow_up)
        self.assertIn('data-pt-agent-follow-up-action="add"', follow_up)
        self.assertIn('data-pt-agent-follow-up-action="send"', follow_up)
        self.assertIn("runner.wait_visible_element(", follow_up)
        self.assertIn("runner.click_visible(suggestion_selector", follow_up)
        self.assertNotIn("click_text(", follow_up)
        self.assertNotIn(
            "querySelectorAll('button[aria-expanded]')",
            follow_up,
        )


if __name__ == "__main__":
    unittest.main()
