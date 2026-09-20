from __future__ import annotations

import copy
import unittest

from tooling.acceptance.gates.agent.foundation_loop_budget_development import (
    LoopBudgetError,
    evaluate_loop_budget,
)


def valid_capture() -> dict[str, object]:
    return {
        "facts": {
            "turnId": "turn-1",
            "stationError": {
                "error": "agent.errors.toolLoopBudgetExhausted",
                "error_type": "TOOL_LOOP_BUDGET_EXHAUSTED",
                "locale_key": "agent.errors.toolLoopBudgetExhausted",
                "retryable": False,
                "terminal": True,
                "details": {
                    "turn_id": "turn-1",
                    "budget_kind": "tool_calls",
                    "limit": "2",
                },
            },
            "typedError": {
                "error": "agent.errors.toolLoopBudgetExhausted",
                "error_type": "TOOL_LOOP_BUDGET_EXHAUSTED",
                "locale_key": "agent.errors.toolLoopBudgetExhausted",
                "retryable": False,
                "terminal": True,
                "details": {
                    "turn_id": "turn-1",
                    "budget_kind": "tool_calls",
                    "limit": "2",
                },
            },
            "resolution": {
                "type": "inspectBudget",
                "turnId": "turn-1",
                "budgetKind": "tool_calls",
                "limit": "2",
                "label": "agent.recovery.inspectBudget",
            },
            "recoveryLabel": "Inspect budget",
            "recoveryVisible": True,
            "projectedTurnId": "turn-1",
            "projectedBudgetKind": "tool_calls",
            "projectedLimit": "2",
            "turnDetailsOpened": True,
            "loopBudget": {
                "stopped": True,
                "terminalReason": "max_tool_calls_exhausted",
                "requestedLimit": 2,
                "effectiveLimit": 2,
                "observedIterations": 2,
                "maximumIterations": 2,
                "executionAfterLimit": 0,
            },
            "providerCallsBeforeAction": 3,
            "providerCallsAfterAction": 3,
            "toolCallsBeforeAction": 2,
            "toolCallsAfterAction": 2,
            "terminalEventCount": 1,
            "terminalEventType": "error",
        }
    }


class LoopBudgetDevelopmentTest(unittest.TestCase):
    def test_accepts_exact_loop_budget_facts(self) -> None:
        assertions = evaluate_loop_budget(valid_capture())

        self.assertTrue(all(assertions.values()))

    def test_rejects_legacy_detail_shape(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["facts"]["typedError"]["details"] = {
            "reason": "max_tool_calls_exhausted",
            "limit": "2",
            "consumed": "2",
        }

        with self.assertRaisesRegex(LoopBudgetError, "typedLoopBudget"):
            evaluate_loop_budget(capture)

    def test_rejects_retry_after_inspection(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["facts"]["providerCallsAfterAction"] = 4

        with self.assertRaisesRegex(
            LoopBudgetError,
            "inspectBudgetHasNoAutomaticRetry",
        ):
            evaluate_loop_budget(capture)

    def test_rejects_execution_after_limit(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["facts"]["loopBudget"]["executionAfterLimit"] = 1

        with self.assertRaisesRegex(LoopBudgetError, "terminalAtExactLimit"):
            evaluate_loop_budget(capture)

    def test_rejects_wrong_turn_details_target(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["facts"]["resolution"]["turnId"] = "turn-2"

        with self.assertRaisesRegex(
            LoopBudgetError,
            "localizedInspectBudgetVisible",
        ):
            evaluate_loop_budget(capture)


if __name__ == "__main__":
    unittest.main()
