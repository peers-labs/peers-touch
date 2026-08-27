from __future__ import annotations

import copy
import unittest

from tooling.acceptance.gates.agent.foundation_group_one_scenarios import (
    GroupOneScenarioError,
    evaluate_as_f02,
    evaluate_as_f03,
    evaluate_as_f10,
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


def valid_as_f10_capture(platform: str = "desktop_app") -> dict[str, object]:
    browser = platform == "browser"
    return {
        "coreOutcome": {
            "stationStatus": "completed",
            "receiverStatus": "completed",
        },
        "capabilitySession": {
            "platform": platform,
            "sessionId": "session-1",
            "readinessSessionId": "session-1",
            "deviceId": "device-1",
            "capabilityCount": 0 if browser else 1,
        },
        "selectedDevice": {
            "sessionDeviceId": "device-1",
            "executionDeviceId": None if browser else "device-1",
        },
        "rejections": {
            "unsupported": {
                "accepted": False,
                "errorCode": "CAPABILITY_UNAVAILABLE",
            },
            "unauthorized": {
                "accepted": False,
                "errorCode": "UNAUTHORIZED",
            },
            "signatureTamper": {
                "accepted": False,
                "errorCode": (
                    "CLIENT_CAPABILITY_COMMAND_ERROR_CODE_SIGNATURE_INVALID"
                ),
            },
            "schemaMismatch": {
                "accepted": False,
                "errorCode": "CLIENT_CAPABILITY_SCHEMA_MISMATCH",
            },
            "crossDevice": {
                "accepted": False,
                "errorCode": (
                    "CLIENT_CAPABILITY_RECEIPT_ERROR_CODE_AUTHORITY_MISMATCH"
                ),
            },
        },
        "execution": {
            "localAttemptDelta": 0,
            "sideEffectDelta": 0,
            "resultDelta": 0,
            "continuationDelta": 0,
            "desktopFallbackDelta": 0,
        },
    }


def valid_as_f03_capture() -> dict[str, object]:
    return {
        "events": [
            {"eventType": "progress", "sequence": 1},
            {"eventType": "text", "sequence": 2},
            {"eventType": "cancelled", "sequence": 3},
        ],
        "sawTextBeforeCancel": True,
        "thinkingMode": "disabled",
        "terminalTracePersisted": True,
    }


class FoundationGroupOneScenariosTest(unittest.TestCase):
    def test_as_f03_accepts_sequenced_text_then_cancel(self) -> None:
        assertions = evaluate_as_f03(valid_as_f03_capture())

        self.assertTrue(assertions["progressiveEventsSequenced"])
        self.assertTrue(assertions["cancelledDuringTextAuthoritative"])
        self.assertTrue(assertions["exactlyOneAuthoritativeTerminal"])
        self.assertIsNone(assertions["toolAndApprovalWaits"])

    def test_as_f03_rejects_terminal_after_cancel(self) -> None:
        capture = valid_as_f03_capture()
        events = capture["events"]
        assert isinstance(events, list)
        events.append({"eventType": "done", "sequence": 4})

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "exactlyOneAuthoritativeTerminal",
        ):
            evaluate_as_f03(capture)

    def test_as_f03_rejects_implicit_thinking_mode(self) -> None:
        capture = valid_as_f03_capture()
        capture["thinkingMode"] = "auto"

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "cancelledDuringTextAuthoritative",
        ):
            evaluate_as_f03(capture)

    def test_as_f03_rejects_thinking_delta_when_disabled(self) -> None:
        capture = valid_as_f03_capture()
        events = capture["events"]
        assert isinstance(events, list)
        events.insert(1, {"eventType": "thinking", "sequence": 2})
        events[2]["sequence"] = 3
        events[3]["sequence"] = 4

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "progressiveEventsSequenced",
        ):
            evaluate_as_f03(capture)

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

    def test_as_f10_accepts_desktop_and_browser_production_facts(self) -> None:
        for platform in ("desktop_app", "browser"):
            with self.subTest(platform=platform):
                assertions = evaluate_as_f10(
                    valid_as_f10_capture(platform),
                    platform=platform,
                )

                self.assertEqual(len(assertions), 9)
                self.assertTrue(all(assertions.values()))

    def test_as_f10_rejects_any_execution_delta(self) -> None:
        capture = valid_as_f10_capture("browser")
        capture["execution"]["sideEffectDelta"] = 1

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "zeroExecutionOnReject",
        ):
            evaluate_as_f10(capture, platform="browser")

    def test_as_f10_rejects_browser_local_capabilities(self) -> None:
        capture = valid_as_f10_capture("browser")
        capture["capabilitySession"]["capabilityCount"] = 1

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "selectedDeviceOwnsExecution",
        ):
            evaluate_as_f10(capture, platform="browser")

    def test_as_f10_rejects_unexpected_rejection_code(self) -> None:
        capture = valid_as_f10_capture()
        capture["rejections"]["signatureTamper"]["errorCode"] = "AGENT_5000"

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "signatureTamperRejected",
        ):
            evaluate_as_f10(capture, platform="desktop_app")

    def test_as_f10_defers_unsupported_when_no_production_endpoint(self) -> None:
        capture = valid_as_f10_capture()
        capture["rejections"]["unsupported"] = {
            "availability": "unavailable",
            "unavailable_reason": "NO_PRODUCTION_CAPABILITY_ENDPOINT",
        }
        capture["rejections"]["schemaMismatch"] = {
            "availability": "unavailable",
            "unavailable_reason": "NO_PRODUCTION_CAPABILITY_ENDPOINT",
        }

        assertions = evaluate_as_f10(capture, platform="desktop_app")

        self.assertIsNone(assertions["unsupportedRejected"])
        self.assertIsNone(assertions["schemaMismatchRejected"])
        # Other assertions still pass normally.
        self.assertTrue(assertions["unauthorizedRejected"])
        self.assertTrue(assertions["crossDeviceRejected"])
        self.assertTrue(assertions["zeroExecutionOnReject"])


if __name__ == "__main__":
    unittest.main()
