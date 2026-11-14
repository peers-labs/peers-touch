from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
SCENARIOS = ROOT / "tooling/acceptance/gates/agent/chat_model_scenarios.py"
PROVIDER_SCENARIOS = ROOT / "tooling/acceptance/gates/agent/chat_provider_scenarios.py"
SUITE = ROOT / "tooling/acceptance/gates/agent/chat_native_suite.py"
HARNESS = ROOT / "apps/desktop/src/acceptance/agent/harness.ts"


class ChatModelScenariosTest(unittest.TestCase):
    def test_model_selection_filters_long_menus_through_product_search(self) -> None:
        source = SCENARIOS.read_text(encoding="utf-8")
        picker_start = source.index("def open_picker(")
        start = source.index("def select_model(")
        end = source.index("\ndef settings_section(", start)
        picker = source[picker_start:start]
        helper = source[start:end]

        self.assertIn('chat.model.search', picker)
        self.assertIn("data-pt-agent-model-picker", picker)
        self.assertIn("ant-dropdown-open", picker)
        self.assertIn("runner.visible_element_state(search)", picker)
        self.assertIn("runner.click_visible(trigger", picker)
        self.assertIn('"open model Provider tree"', picker)
        self.assertNotIn("span[title]", picker)
        self.assertIn("runner.set_input_value(", helper)
        self.assertIn("runner.click_visible(", helper)
        self.assertNotIn("scrollIntoView", helper)

    def test_models_setup_uses_bounded_projection_owners(self) -> None:
        suite = SUITE.read_text(encoding="utf-8")
        harness = HARNESS.read_text(encoding="utf-8")

        self.assertIn(
            'runner.harness("reconcileChatSuiteTopicProjection")',
            suite,
        )
        self.assertIn(
            'runner.harness("reconcileChatSuiteModelProjection")',
            suite,
        )
        model_start = harness.index(
            "async reconcileChatSuiteModelProjection()"
        )
        model_end = harness.index(
            "async reconcileChatSuiteRosterProjection()",
            model_start,
        )
        model_projection = harness[model_start:model_end]
        self.assertNotIn("agent-capability", model_projection)
        self.assertNotIn("agent-topic", model_projection)


if __name__ == "__main__":
    unittest.main()
