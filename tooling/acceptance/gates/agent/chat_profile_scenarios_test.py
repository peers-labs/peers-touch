from __future__ import annotations

import unittest
from unittest import mock

from tooling.acceptance.gates.agent.chat_profile_scenarios import (
    empty_document,
    select_prompt_fixture_model,
)
from tooling.acceptance.drivers.native.base import NativeKey, NativeModifier


class PromptFixtureModelSelectionTests(unittest.TestCase):
    def test_empty_document_uses_native_select_delete_and_blur(self) -> None:
        runner = mock.Mock()
        runner.station_agent.side_effect = [
            {"soulMd": "old", "agentsMd": "sibling"},
            {"soulMd": "", "agentsMd": "sibling"},
        ]
        runner.driver.execute_script.side_effect = [True, ""]

        result = empty_document(runner, "agent-1")

        selector = (
            '[data-pt-agent-profile-editor][data-pt-agent-id="agent-1"] '
            'textarea[aria-label="SOUL.md"]'
        )
        self.assertEqual(
            runner.press_native_key.call_args_list,
            [
                mock.call(
                    NativeKey.A,
                    selector=selector,
                    modifiers=(NativeModifier.PRIMARY,),
                ),
                mock.call(NativeKey.DELETE),
                mock.call(NativeKey.TAB),
            ],
        )
        self.assertEqual(result["stationReadback"]["soulMd"], "")

    def test_selects_suite_model_through_visible_composer(self) -> None:
        fixture = {
            "providerId": "fixture-provider",
            "modelId": "fixture-model",
        }
        model = {
            "providerId": fixture["providerId"],
            "modelId": fixture["modelId"],
            "enabled": True,
        }
        runner = mock.Mock()
        runner.harness.return_value = {
            "reconciled": True,
            "authorityModels": [model],
            "storeModels": [model],
            "storeError": None,
        }
        runner.driver.execute_script.side_effect = [True, True, True]

        result = select_prompt_fixture_model(
            runner,
            fixture,
            start_new_topic=True,
        )

        self.assertTrue(result["reconciled"])
        runner.harness.assert_called_once_with(
            "reconcileChatSuiteModelProjection"
        )
        runner.click_visible.assert_any_call(
            "[data-pt-agent-session-start]",
            "New Topic",
        )
        runner.click_visible.assert_any_call(
            (
                '[data-pt-agent-model-provider="fixture-provider"]'
                '[data-pt-agent-model-id="fixture-model"]'
            ),
            "Topic prompt receiver model",
        )


if __name__ == "__main__":
    unittest.main()
