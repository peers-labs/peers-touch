from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
SCENARIOS = ROOT / "tooling/acceptance/gates/agent/chat_model_scenarios.py"
PROVIDER_SCENARIOS = ROOT / "tooling/acceptance/gates/agent/chat_provider_scenarios.py"
SUITE = ROOT / "tooling/acceptance/gates/agent/chat_native_suite.py"
HARNESS = ROOT / "apps/desktop/src/acceptance/agent/harness.ts"


class ChatModelScenariosTest(unittest.TestCase):
    def test_availability_uses_composite_authority_selectors(self) -> None:
        source = SCENARIOS.read_text(encoding="utf-8")
        start = source.index("def disable_recovery(")
        scenario = source[start:]

        self.assertIn("data-pt-provider-enabled-toggle", scenario)
        self.assertIn("data-pt-provider-model-provider", scenario)
        self.assertIn("data-pt-provider-model-toggle", scenario)
        self.assertIn("select_provider_settings(", scenario)
        self.assertEqual(
            scenario.count('runner.harness("reconcileChatSuiteModelProjection")'),
            2,
        )
        self.assertIn("def toggle_provider(enabled: bool)", scenario)
        self.assertIn('"Provider disable decision"', scenario)
        self.assertIn('"Provider enable decision"', scenario)
        self.assertIn('if outcome == "confirm":', scenario)
        self.assertIn("toggle_provider(False)", scenario)
        self.assertIn("toggle_provider(True)", scenario)
        self.assertNotIn("document.querySelectorAll('strong')", scenario)

    def test_provider_selection_filters_long_lists_through_product_search(self) -> None:
        source = SCENARIOS.read_text(encoding="utf-8")
        start = source.index("def select_provider_settings(")
        end = source.index("\ndef settings_default(", start)
        helper = source[start:end]

        self.assertIn('provider.menu.searchPlaceholder', helper)
        self.assertIn("runner.set_input_value(", helper)
        self.assertIn("runner.click_visible(", helper)
        self.assertNotIn("scrollIntoView", helper)

        provider_source = PROVIDER_SCENARIOS.read_text(encoding="utf-8")
        cli_start = provider_source.index("def cli_discovery(")
        cli_scenario = provider_source[cli_start:]
        self.assertIn(
            'select_provider_settings(runner, provider_id, "registered CLI Provider")',
            cli_scenario,
        )
        self.assertNotIn(
            'click_visible(f\'[data-item-id="{provider_id}"]\'',
            cli_scenario,
        )

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
