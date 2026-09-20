from __future__ import annotations

import copy
import unittest
from pathlib import Path

from tooling.acceptance.gates.agent.foundation_terminal_mutation_development import (
    TerminalMutationError,
    evaluate_terminal_mutation,
)

ROOT = Path(__file__).resolve().parents[4]


def valid_capture() -> dict[str, object]:
    return {
        "facts": {
            "turnId": "turn-1",
            "typedError": {
                "error": "agent.errors.lifecycleTerminalMutation",
                "error_type": "LIFECYCLE_TERMINAL_MUTATION",
                "locale_key": "agent.errors.lifecycleTerminalMutation",
                "retryable": False,
                "terminal": True,
                "details": {
                    "resource_id": "turn-1",
                    "terminal_status": "completed",
                },
            },
            "resolution": {
                "type": "openResult",
                "resourceId": "turn-1",
                "turnId": "turn-1",
                "terminalStatus": "completed",
                "label": "agent.recovery.openResult",
            },
            "receiver": {
                "recoveryVisible": True,
                "recoveryLabel": "Open result",
                "expectedRecoveryLabel": "Open result",
                "errorLabel": "A completed operation cannot be changed.",
                "expectedErrorLabel": (
                    "A completed operation cannot be changed."
                ),
                "projectedResourceId": "turn-1",
                "projectedTerminalStatus": "completed",
                "messageTerminalStatus": "completed",
                "contentBefore": "Durable result",
                "contentAfter": "Durable result",
            },
            "result": {
                "opened": True,
                "turnId": "turn-1",
            },
            "terminal": {
                "hashBefore": "a" * 64,
                "hashAfter": "a" * 64,
                "conversationVersionBefore": 2,
                "conversationVersionAfter": 2,
                "messageCountBefore": 2,
                "messageCountAfter": 2,
                "eventCountBefore": 4,
                "eventCountAfter": 4,
                "messageIdBefore": "assistant-1",
                "messageIdAfter": "assistant-1",
                "messageStatusBefore": 3,
                "messageStatusAfter": 3,
                "messageContentBefore": "Durable result",
                "messageContentAfter": "Durable result",
            },
        }
    }


class TerminalMutationDevelopmentTest(unittest.TestCase):
    def test_accepts_exact_terminal_mutation_facts(self) -> None:
        assertions = evaluate_terminal_mutation(valid_capture())

        self.assertTrue(all(assertions.values()))

    def test_rejects_non_terminal_status(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["facts"]["typedError"]["details"]["terminal_status"] = "running"

        with self.assertRaisesRegex(
            TerminalMutationError,
            "typedTerminalMutation",
        ):
            evaluate_terminal_mutation(capture)

    def test_rejects_mutated_terminal_hash(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["facts"]["terminal"]["hashAfter"] = "b" * 64

        with self.assertRaisesRegex(
            TerminalMutationError,
            "terminalHashUnchanged",
        ):
            evaluate_terminal_mutation(capture)

    def test_rejects_hidden_open_result(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["facts"]["receiver"]["recoveryVisible"] = False

        with self.assertRaisesRegex(
            TerminalMutationError,
            "localizedOpenResultVisible",
        ):
            evaluate_terminal_mutation(capture)

    def test_rejects_wrong_result_target(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["facts"]["result"]["turnId"] = "turn-2"

        with self.assertRaisesRegex(
            TerminalMutationError,
            "openResultOpenedTurnDetails",
        ):
            evaluate_terminal_mutation(capture)

    def test_rejects_terminal_row_or_event_mutation(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["facts"]["terminal"]["eventCountAfter"] = 5

        with self.assertRaisesRegex(
            TerminalMutationError,
            "zeroTerminalMutation",
        ):
            evaluate_terminal_mutation(capture)

    def test_native_harness_uses_store_intent_and_visible_result_surface(
        self,
    ) -> None:
        harness = (
            ROOT / "apps/desktop/src/acceptance/agent/harness.ts"
        ).read_text(encoding="utf-8")
        start = harness.index("async runDevelopmentTerminalMutation")
        end = harness.index("async runDevelopmentUnknownTool", start)
        scenario = harness[start:end]

        self.assertIn(
            "useChatStore.getState().requestTurnCancellation(",
            scenario,
        )
        self.assertIn(
            "Number(replay.status) === AgentTurnStatus.COMPLETED",
            scenario,
        )
        self.assertIn(
            '[data-pt-agent-message-error-recovery="open-result"]',
            scenario,
        )
        self.assertIn("recovery.click()", scenario)
        self.assertIn(
            '[data-agent-turn-details="${turnId}"]',
            scenario,
        )
        self.assertIn("foundationConversationReadback(", scenario)
        self.assertIn("foundationDiagnosticReplay(", scenario)
        self.assertNotIn("api.cancelAgentTurn(", scenario)


if __name__ == "__main__":
    unittest.main()
