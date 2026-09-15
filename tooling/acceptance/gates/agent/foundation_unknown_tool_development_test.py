from __future__ import annotations

import copy
import unittest

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
                    "tool_id": "foundation_unknown_tool",
                    "tool_version": "unregistered",
                },
            },
            "resolution": {
                "type": "chooseTool",
                "toolId": "foundation_unknown_tool",
                "toolVersion": "unregistered",
                "label": "agent.recovery.chooseTool",
            },
            "recoveryLabel": "Choose tool",
            "recoveryVisible": True,
            "projectedToolId": "foundation_unknown_tool",
            "projectedToolVersion": "unregistered",
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
            "sourceDelivery": {
                "transport": "station-sse",
                "sequence": 4,
                "conversationId": "conversation-1",
                "turnId": "turn-1",
            },
        }
    }


class UnknownToolDevelopmentTest(unittest.TestCase):
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

    def test_rejects_non_station_delivery(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["facts"]["sourceDelivery"]["transport"] = "local"

        with self.assertRaisesRegex(
            UnknownToolError,
            "stationSourceDelivery",
        ):
            evaluate_unknown_tool(capture)


if __name__ == "__main__":
    unittest.main()
