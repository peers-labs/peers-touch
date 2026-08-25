from __future__ import annotations

import unittest
from typing import Any

from tooling.acceptance.gates.agent.foundation_direct_adapter_test import capture
from tooling.acceptance.gates.agent.foundation_group_one_probe import (
    EXPECTED_GROUP_ONE_TUPLES,
    FoundationGroupOneProbeRunner,
    GroupOneProbeError,
    group_one_tuples,
)
from tooling.acceptance.gates.agent.foundation_group_one_scenarios import (
    evaluate_as_f02,
    evaluate_as_f10,
)


class RecordingHarnessClient:
    def __init__(self, reject_locale: bool = False) -> None:
        self.reject_locale = reject_locale
        self.locales: list[str] = []

    def harness(
        self,
        method: str,
        payload: dict[str, Any] | None = None,
        timeout: float = 120,
    ) -> Any:
        if method != "setFoundationLocale":
            raise AssertionError(f"unexpected Harness method: {method}")
        locale = str((payload or {}).get("locale") or "")
        self.locales.append(locale)
        return {"locale": "wrong" if self.reject_locale else locale}


def scenario_capture(_client: RecordingHarnessClient, probe: Any) -> dict[str, Any]:
    result = capture(probe)
    if probe.cell == "AS-F10":
        browser = probe.platform == "browser"
        facts = {
            "coreOutcome": {
                "stationStatus": "completed",
                "receiverStatus": "completed",
            },
            "capabilitySession": {
                "platform": probe.platform,
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
        result["scenarioFacts"] = facts
        result["assertions"] = evaluate_as_f10(
            facts,
            platform=probe.platform,
        )
        return result
    if probe.cell != "AS-F02":
        return result
    facts = {
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
            "entries": [
                {"queue_position": position}
                for position in range(1, 9)
            ],
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
    result["scenarioFacts"] = facts
    result["assertions"] = evaluate_as_f02(facts)
    return result


class FoundationGroupOneProbeRunnerTest(unittest.TestCase):
    def test_matrix_selects_exact_group_one_tuple_set(self) -> None:
        tuples = group_one_tuples()

        self.assertEqual(len(tuples), EXPECTED_GROUP_ONE_TUPLES)
        self.assertEqual(
            {item.row for item in tuples},
            {"foundation-desktop-direct", "foundation-browser-direct"},
        )
        self.assertEqual({item.locale for item in tuples}, {"en", "zh-CN"})
        self.assertEqual(len({item.key for item in tuples}), len(tuples))

    def test_dispatches_every_tuple_to_its_manifest_client(self) -> None:
        desktop = RecordingHarnessClient()
        browser = RecordingHarnessClient()
        runner = FoundationGroupOneProbeRunner(
            desktop_native=desktop,
            browser=browser,
        )

        observations = runner.collect(scenario_capture)

        self.assertEqual(len(observations), EXPECTED_GROUP_ONE_TUPLES)
        self.assertEqual(len(desktop.locales), 14)
        self.assertEqual(len(browser.locales), 14)
        self.assertEqual(set(desktop.locales), {"en", "zh-CN"})
        self.assertEqual(set(browser.locales), {"en", "zh-CN"})

    def test_locale_mismatch_fails_before_adapter_evidence(self) -> None:
        runner = FoundationGroupOneProbeRunner(
            desktop_native=RecordingHarnessClient(reject_locale=True),
            browser=RecordingHarnessClient(),
        )

        with self.assertRaisesRegex(
            GroupOneProbeError,
            "receiver locale did not converge",
        ):
            runner.collect(scenario_capture)

    def test_as_f02_rejects_assertions_not_derived_from_facts(self) -> None:
        runner = FoundationGroupOneProbeRunner(
            desktop_native=RecordingHarnessClient(),
            browser=RecordingHarnessClient(),
        )

        def mismatched(
            client: RecordingHarnessClient,
            probe: Any,
        ) -> dict[str, Any]:
            result = scenario_capture(client, probe)
            if probe.cell == "AS-F02":
                result["assertions"] = {
                    **result["assertions"],
                    "overflowVisible": False,
                }
            return result

        with self.assertRaisesRegex(
            GroupOneProbeError,
            "assertions do not match production scenario facts",
        ):
            runner.collect(mismatched)

    def test_as_f10_rejects_assertions_not_derived_from_facts(self) -> None:
        runner = FoundationGroupOneProbeRunner(
            desktop_native=RecordingHarnessClient(),
            browser=RecordingHarnessClient(),
        )

        def mismatched(
            client: RecordingHarnessClient,
            probe: Any,
        ) -> dict[str, Any]:
            result = scenario_capture(client, probe)
            if probe.cell == "AS-F10":
                result["assertions"] = {
                    **result["assertions"],
                    "zeroExecutionOnReject": False,
                }
            return result

        with self.assertRaisesRegex(
            GroupOneProbeError,
            "AS-F10 assertions do not match production scenario facts",
        ):
            runner.collect(mismatched)

    def test_as_f10_accepts_deferred_assertions_when_consistent(self) -> None:
        runner = FoundationGroupOneProbeRunner(
            desktop_native=RecordingHarnessClient(),
            browser=RecordingHarnessClient(),
        )

        def deferred_capture(
            client: RecordingHarnessClient,
            probe: Any,
        ) -> dict[str, Any]:
            result = scenario_capture(client, probe)
            if probe.cell == "AS-F10":
                facts = result["scenarioFacts"]
                facts["rejections"]["unsupported"] = {
                    "availability": "unavailable",
                    "unavailable_reason": "NO_PRODUCTION_CAPABILITY_ENDPOINT",
                }
                facts["rejections"]["schemaMismatch"] = {
                    "availability": "unavailable",
                    "unavailable_reason": "NO_PRODUCTION_CAPABILITY_ENDPOINT",
                }
                from tooling.acceptance.gates.agent.foundation_group_one_scenarios import (
                    evaluate_as_f10,
                )

                result["assertions"] = evaluate_as_f10(
                    facts,
                    platform=probe.platform,
                )
            return result

        observations = runner.collect(deferred_capture)

        self.assertEqual(len(observations), EXPECTED_GROUP_ONE_TUPLES)


if __name__ == "__main__":
    unittest.main()
