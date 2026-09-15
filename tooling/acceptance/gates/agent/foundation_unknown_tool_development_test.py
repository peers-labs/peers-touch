from __future__ import annotations

import copy
import unittest
from pathlib import Path

from tooling.acceptance.gates.agent.foundation_unknown_tool_development import (
    UnknownToolError,
    evaluate_unknown_tool,
)


def valid_capture() -> dict[str, object]:
    return {
        "facts": {
            "conversationId": "conversation-1",
            "turnId": "turn-1",
            "typedError": {
                "error": "agent.errors.toolUnknown",
                "error_type": "TOOL_UNKNOWN",
                "locale_key": "agent.errors.toolUnknown",
                "retryable": False,
                "terminal": True,
                "details": {
                    "tool_id": "skills_list",
                    "tool_version": "builtin-v1",
                },
            },
            "resolution": {
                "type": "chooseTool",
                "toolId": "skills_list",
                "toolVersion": "builtin-v1",
                "label": "agent.recovery.chooseTool",
            },
            "recoveryLabel": "Choose tool",
            "recoveryVisible": True,
            "advertisedToolId": "skills_list",
            "advertisedToolVersion": "builtin-v1",
            "bindingId": "binding-skills-list",
            "originalBindingRevision": "7",
            "isolatedBindingRevision": "8",
            "isolatedBindingEnabled": False,
            "providerStartObserved": True,
            "providerStartSequence": 12,
            "projectedToolId": "skills_list",
            "projectedToolVersion": "builtin-v1",
            "providerCalls": [{"provider": "provider-1", "model": "model-1"}],
            "providerCallCountBefore": 0,
            "providerCallCountAfter": 1,
            "toolCallCountBefore": 0,
            "toolCallCountAfter": 0,
            "toolExecutionCountBefore": 0,
            "toolExecutionCountAfter": 0,
            "sideEffectCountBefore": 0,
            "sideEffectCountAfter": 0,
            "completedAssistantMessageCount": 0,
            "traceCountBefore": 0,
            "traceCountAfter": 1,
            "queueCountBefore": 0,
            "queueCountAfter": 0,
        }
    }


class UnknownToolDevelopmentTest(unittest.TestCase):
    def test_runner_uses_its_local_gate_identity(self) -> None:
        source = Path(
            "tooling/acceptance/gates/agent/"
            "foundation_unknown_tool_development.py"
        ).read_text(encoding="utf-8")

        self.assertIn('GATE_ID = "agent-v2-kernel-foundation-e2e"', source)
        self.assertIn('UNKNOWN_TOOL_ID = "skills_list"', source)
        self.assertNotIn("AGENT_V2_FOUNDATION_GATE", source)
        self.assertNotIn("foundation_unknown_tool", source)
        self.assertNotIn('UNKNOWN_TOOL_VERSION = "unregistered"', source)

    def test_accepts_unknown_tool_facts(self) -> None:
        assertions = evaluate_unknown_tool(valid_capture())

        self.assertTrue(all(assertions.values()))

    def test_rejects_tool_decision(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["facts"]["toolCallCountAfter"] = 1

        with self.assertRaisesRegex(
            UnknownToolError,
            "zeroDecisionOrExecution",
        ):
            evaluate_unknown_tool(capture)

    def test_rejects_automatic_retry(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["facts"]["providerCallCountAfter"] = 2

        with self.assertRaisesRegex(
            UnknownToolError,
            "oneTerminalProviderAttempt",
        ):
            evaluate_unknown_tool(capture)

    def test_rejects_unbounded_details(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["facts"]["typedError"]["details"]["reason"] = "not found"

        with self.assertRaisesRegex(
            UnknownToolError,
            "typedUnknownTool",
        ):
            evaluate_unknown_tool(capture)

    def test_rejects_version_not_pinned_to_advertised_manifest(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["facts"]["typedError"]["details"]["tool_version"] = "stale-v0"

        with self.assertRaisesRegex(
            UnknownToolError,
            "typedUnknownTool",
        ):
            evaluate_unknown_tool(capture)

    def test_rejects_missing_provider_binding_race(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["facts"]["isolatedBindingRevision"] = "9"

        with self.assertRaisesRegex(
            UnknownToolError,
            "providerBindingRace",
        ):
            evaluate_unknown_tool(capture)

if __name__ == "__main__":
    unittest.main()
