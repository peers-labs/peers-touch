from __future__ import annotations

import copy
import unittest

from tooling.acceptance.gates.agent.foundation_provider_timeout_development import (
    ProviderTimeoutError,
    evaluate_provider_timeout,
)


def valid_capture() -> dict[str, object]:
    deadline = "2026-09-16T01:02:03.456000000Z"
    return {
        "facts": {
            "typedError": {
                "error": "agent.errors.providerTimeout",
                "error_type": "PROVIDER_TIMEOUT",
                "locale_key": "agent.errors.providerTimeout",
                "retryable": True,
                "terminal": True,
                "details": {
                    "provider_id": "provider-1",
                    "model_id": "model-1",
                    "deadline": deadline,
                },
            },
            "providerId": "provider-1",
            "modelId": "model-1",
            "deadline": deadline,
            "projectedDeadline": deadline,
            "submittedAt": "2026-09-16T01:00:03.456Z",
            "terminalObservedAt": "2026-09-16T01:02:03.500Z",
            "requestedBudget": {
                "maxOutputTokens": 8192,
                "wallTimeMs": 180000,
            },
            "resolution": {
                "type": "retry",
                "providerId": "provider-1",
                "modelId": "model-1",
                "deadline": deadline,
                "label": "agent.recovery.retry",
            },
            "recoveryLabel": "Retry",
            "recoveryVisible": True,
            "providerCalls": [
                {
                    "provider": "provider-1",
                    "model": "model-1",
                    "latencyMs": "120001",
                }
            ],
            "classifiedErrors": [{"reason": 7}],
            "completedAssistantMessageCount": 0,
            "traceCountBefore": 0,
            "traceCountAfter": 1,
            "queueCountBefore": 0,
            "queueCountAfter": 0,
            "messageDelta": 2,
            "traceDelta": 1,
            "queueDelta": 0,
        }
    }


class ProviderTimeoutDevelopmentTest(unittest.TestCase):
    def test_accepts_real_timeout_facts(self) -> None:
        assertions = evaluate_provider_timeout(valid_capture())

        self.assertTrue(all(assertions.values()))

    def test_rejects_hidden_provider_retry(self) -> None:
        capture = valid_capture()
        capture["facts"]["providerCalls"].append(
            {
                "provider": "provider-1",
                "model": "model-1",
                "latencyMs": "120000",
            }
        )

        with self.assertRaisesRegex(
            ProviderTimeoutError,
            "oneTerminalProviderAttempt",
        ):
            evaluate_provider_timeout(capture)

    def test_rejects_runtime_budget_that_ends_first(self) -> None:
        capture = valid_capture()
        capture["facts"]["requestedBudget"]["wallTimeMs"] = 120000

        with self.assertRaisesRegex(
            ProviderTimeoutError,
            "providerDeadlinePrecedesTurnBudget",
        ):
            evaluate_provider_timeout(capture)

    def test_rejects_non_timeout_classification(self) -> None:
        capture = valid_capture()
        capture["facts"]["classifiedErrors"][0]["reason"] = 6

        with self.assertRaisesRegex(
            ProviderTimeoutError,
            "upstreamTimeoutCancelled",
        ):
            evaluate_provider_timeout(capture)

    def test_rejects_impossible_deadline(self) -> None:
        capture = copy.deepcopy(valid_capture())
        invalid = "2026-02-30T01:02:03Z"
        capture["facts"]["typedError"]["details"]["deadline"] = invalid
        capture["facts"]["deadline"] = invalid
        capture["facts"]["projectedDeadline"] = invalid
        capture["facts"]["resolution"]["deadline"] = invalid

        with self.assertRaisesRegex(
            ProviderTimeoutError,
            "valid UTC RFC3339",
        ):
            evaluate_provider_timeout(capture)


if __name__ == "__main__":
    unittest.main()
