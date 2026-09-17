from __future__ import annotations

import copy
import unittest
from pathlib import Path

from tooling.acceptance.gates.agent.foundation_stale_version_development import (
    StaleVersionError,
    evaluate_stale_version,
)

ROOT = Path(__file__).resolve().parents[4]


def valid_capture() -> dict[str, object]:
    return {
        "facts": {
            "typedError": {
                "error": "agent.errors.lifecycleStaleVersion",
                "error_type": "LIFECYCLE_STALE_VERSION",
                "locale_key": "agent.errors.lifecycleStaleVersion",
                "retryable": True,
                "terminal": True,
                "details": {
                    "resource_id": "conversation-1",
                    "expected_revision": "4",
                    "actual_revision": "5",
                },
            },
            "resolution": {
                "type": "reloadLatest",
                "resourceId": "conversation-1",
                "expectedRevision": 4,
                "actualRevision": 5,
                "label": "agent.recovery.reloadLatest",
            },
            "winner": {
                "resourceId": "conversation-1",
                "expectedRevision": 4,
                "actualRevision": 5,
                "revisionBeforeStale": 5,
                "revisionAfterStale": 5,
                "revisionAfterReload": 5,
                "hashBeforeStale": "winner-hash",
                "hashAfterStale": "winner-hash",
                "hashAfterReload": "winner-hash",
            },
            "staleMutation": {
                "attemptedRevision": 4,
                "mutationDelta": 0,
                "messageDelta": 0,
            },
            "receiver": {
                "conflictVisible": True,
                "conflictText": "This operation used an outdated version.",
                "expectedConflictText": (
                    "This operation used an outdated version."
                ),
                "reloadVisible": True,
                "reloadText": "Reload latest",
                "expectedReloadText": "Reload latest",
                "projectedErrorType": "LIFECYCLE_STALE_VERSION",
                "projectedExpectedRevision": 4,
                "projectedActualRevision": 5,
                "reloadExecuted": True,
                "reloadedRevision": 5,
                "conflictCleared": True,
            },
            "projection": {
                "revisionBeforeStale": 4,
                "revisionAfterReload": 5,
                "messageCountAfterReload": 0,
            },
        }
    }


class StaleVersionDevelopmentTest(unittest.TestCase):
    def test_accepts_exact_stale_version_facts(self) -> None:
        assertions = evaluate_stale_version(valid_capture())

        self.assertTrue(all(assertions.values()))

    def test_rejects_non_advancing_actual_revision(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["facts"]["typedError"]["details"]["actual_revision"] = "4"
        capture["facts"]["winner"]["actualRevision"] = 4

        with self.assertRaisesRegex(
            StaleVersionError,
            "typedStaleVersion",
        ):
            evaluate_stale_version(capture)

    def test_rejects_reload_that_replays_or_mutates(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["facts"]["winner"]["revisionAfterReload"] = 6
        capture["facts"]["winner"]["hashAfterReload"] = "mutated-hash"

        with self.assertRaisesRegex(
            StaleVersionError,
            "winnerPreserved",
        ):
            evaluate_stale_version(capture)

    def test_rejects_hidden_or_unlocalized_recovery(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["facts"]["receiver"]["reloadVisible"] = False

        with self.assertRaisesRegex(
            StaleVersionError,
            "localizedReloadLatestVisible",
        ):
            evaluate_stale_version(capture)

    def test_rejects_stale_side_effect(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["facts"]["staleMutation"]["messageDelta"] = 1

        with self.assertRaisesRegex(
            StaleVersionError,
            "zeroStaleMutation",
        ):
            evaluate_stale_version(capture)

    def test_native_harness_uses_chat_store_and_visible_reload_surface(self) -> None:
        harness = (
            ROOT / "apps/desktop/src/acceptance/agent/harness.ts"
        ).read_text(encoding="utf-8")
        page = (
            ROOT / "apps/desktop/src/pages/ChatPage.tsx"
        ).read_text(encoding="utf-8")
        start = harness.index("async runDevelopmentStaleVersion")
        end = harness.index("async runDevelopmentUnknownTool", start)
        scenario = harness[start:end]

        self.assertIn(
            "useChatStore.getState().editMessage(",
            scenario,
        )
        self.assertIn(
            "[data-pt-agent-revision-conflict=",
            scenario,
        )
        self.assertIn("reload.click()", scenario)
        self.assertIn(
            "useChatStore.getState().revisionCommandFailure",
            scenario,
        )
        self.assertIn(
            "data-pt-agent-revision-reload-latest",
            page,
        )
        self.assertIn(
            "reloadLatestRevision(currentSessionKey)",
            page,
        )
        self.assertNotIn("reload.click();\n        await useChatStore.getState().editMessage", scenario)


if __name__ == "__main__":
    unittest.main()
