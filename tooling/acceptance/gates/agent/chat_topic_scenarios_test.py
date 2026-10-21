from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
SCENARIOS = ROOT / "tooling/acceptance/gates/agent/chat_topic_scenarios.py"


class ChatTopicScenariosTest(unittest.TestCase):
    def test_topic_actions_use_stable_product_selectors(self) -> None:
        source = SCENARIOS.read_text(encoding="utf-8")
        navigation = source.split("def navigation(", 1)[1].split(
            "\ndef menu(",
            1,
        )[0]
        batch_delete = source.split("def batch_delete(", 1)[1].split(
            "\ndef delete_agent(",
            1,
        )[0]

        for selector in (
            "data-pt-agent-session-start",
            "data-pt-agent-topic-profile",
            "data-pt-agent-topic-search",
        ):
            self.assertIn(selector, navigation)
        self.assertNotIn("querySelectorAll('[title]')", navigation)
        self.assertIn("data-pt-agent-topic-batch-select", batch_delete)
        self.assertIn("data-pt-agent-topic-batch-delete", batch_delete)
        self.assertNotIn("[title=", batch_delete)


if __name__ == "__main__":
    unittest.main()
