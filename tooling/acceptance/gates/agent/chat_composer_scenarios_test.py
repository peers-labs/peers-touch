from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import Mock, call, patch

from tooling.acceptance.gates.agent import native_agent_runner
from tooling.acceptance.gates.agent.chat_composer_scenarios import (
    _persisted_conversation_id,
    slash,
)
from tooling.acceptance.gates.agent.native_agent_runner import JourneyError


class ChatComposerScenariosTest(unittest.TestCase):
    def test_persisted_conversation_waits_for_draft_promotion(self) -> None:
        runner = SimpleNamespace(
            runtime_snapshot=Mock(
                side_effect=(
                    {"currentSessionKey": "draft:agent:conversation-1"},
                    {"currentSessionKey": "conversation-1"},
                )
            )
        )

        with patch.object(native_agent_runner.WAIT_TICK, "wait"):
            conversation_id = _persisted_conversation_id(runner)

        self.assertEqual(conversation_id, "conversation-1")
        self.assertEqual(runner.runtime_snapshot.call_count, 2)

    def test_persisted_conversation_fails_on_terminal_turn_error(self) -> None:
        runner = SimpleNamespace(
            runtime_snapshot=Mock(
                return_value={
                    "currentSessionKey": "draft:agent:conversation-1",
                    "operation": {"runState": "failed"},
                    "assistant": {
                        "error": "attachment rejected",
                        "typedError": {
                            "error_type": "CONTEXT_ATTACHMENT_REJECTED",
                            "details": {
                                "reason_code": "attachment_object_is_unavailable",
                            },
                        },
                    },
                }
            )
        )

        with self.assertRaisesRegex(
            JourneyError,
            "attachment Turn failed before Topic promotion",
        ):
            _persisted_conversation_id(runner)

        self.assertEqual(runner.runtime_snapshot.call_count, 1)

    def test_slash_waits_for_post_render_composer_focus(self) -> None:
        element = Mock()
        element.get_attribute.return_value = "Preserve /"
        driver = Mock()
        driver.find_element.return_value = element
        driver.execute_script.side_effect = (False, True)
        runner = SimpleNamespace(
            driver=driver,
            set_input_value=Mock(),
            click_visible=Mock(),
        )

        with patch.object(native_agent_runner.WAIT_TICK, "wait"):
            result = slash(runner)

        self.assertEqual(result["value"], "Preserve /")
        self.assertEqual(driver.execute_script.call_count, 2)
        runner.set_input_value.assert_has_calls(
            [
                call(
                    "[data-pt-agent-composer-input]",
                    "Preserve ",
                    "slash draft",
                ),
                call(
                    "[data-pt-agent-composer-input]",
                    "",
                    "clear slash draft",
                ),
            ]
        )


if __name__ == "__main__":
    unittest.main()
