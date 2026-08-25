from __future__ import annotations

import copy
import unittest

from tooling.acceptance.gates.agent.foundation_group_one_scenarios import (
    GroupOneScenarioError,
    evaluate_as_f02,
)


def valid_capture() -> dict[str, object]:
    entries = [
        {"queue_position": position}
        for position in range(1, 9)
    ]
    return {
        "invalidSubmission": {
            "errorCode": "INVALID_REQUEST",
            "conversationDelta": 0,
            "turnDelta": 0,
        },
        "duplicateSubmission": {
            "firstTurnId": "turn-1",
            "replayedTurnId": "turn-1",
            "turnDelta": 1,
            "queueEntryDelta": 0,
        },
        "queueSubmission": {
            "entries": entries,
            "queueCapacity": 8,
            "overflow": {
                "errorCode": "ADMISSION_QUEUE_FULL",
                "queueSize": 8,
            },
            "cancellation": {
                "queueEntryId": "queue-1",
                "status": "cancelled",
            },
            "receiverDom": {
                "visibleQueuePositions": 8,
                "visible": True,
            },
        },
        "draftRecovery": {
            "beforeHash": "draft-hash",
            "afterHash": "draft-hash",
            "editable": True,
        },
        "rename": {
            "expectedTitle": "Renamed topic",
            "readbackTitle": "Renamed topic",
            "versionBefore": 1,
            "versionAfter": 2,
        },
        "archive": {
            "status": "archived",
            "recoverable": True,
        },
        "deletion": {
            "activeDependencyError": "ACTIVE_DEPENDENCY",
            "deletedAfterSettlement": True,
        },
    }


class FoundationGroupOneScenariosTest(unittest.TestCase):
    def test_as_f02_accepts_complete_production_facts(self) -> None:
        assertions = evaluate_as_f02(valid_capture())

        self.assertEqual(len(assertions), 8)
        self.assertTrue(all(assertions.values()))

    def test_as_f02_rejects_missing_fact(self) -> None:
        capture = valid_capture()
        del capture["draftRecovery"]

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "draftRecovery fact is missing",
        ):
            evaluate_as_f02(capture)

    def test_as_f02_rejects_non_fifo_positions(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["queueSubmission"]["entries"][4]["queue_position"] = 4

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "queue positions are not FIFO",
        ):
            evaluate_as_f02(capture)

    def test_as_f02_rejects_placeholder_duplicate_identity(self) -> None:
        capture = copy.deepcopy(valid_capture())
        capture["duplicateSubmission"]["firstTurnId"] = ""
        capture["duplicateSubmission"]["replayedTurnId"] = ""

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "firstTurnId must be a non-empty string",
        ):
            evaluate_as_f02(capture)


if __name__ == "__main__":
    unittest.main()
