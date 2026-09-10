from __future__ import annotations

import unittest
from typing import Any

from tooling.acceptance.gates.agent.foundation_direct_adapter import (
    DirectRuntimeProbeInput,
)
from tooling.acceptance.gates.agent.foundation_direct_adapter_test import capture
from tooling.acceptance.gates.agent.foundation_group_one_probe import (
    EXPECTED_GROUP_ONE_TUPLES,
    FoundationGroupOneProbeRunner,
    GroupOneProbeError,
    assert_group_one_capture,
    group_one_tuples,
)
from tooling.acceptance.gates.agent.foundation_group_one_scenarios import (
    evaluate_base_attachment_rejected,
    evaluate_base_approval_expired,
    evaluate_base_approval_denied,
    evaluate_base_active_mutation_conflict,
    evaluate_base_cancelled,
    evaluate_base_context_overflow,
    evaluate_base_credential_missing,
    evaluate_base_duplicate_conflict,
    evaluate_base_executor_unavailable,
    evaluate_as_f02,
    evaluate_as_f03,
    evaluate_as_f04,
    evaluate_as_f05,
    evaluate_as_f06,
    evaluate_as_f07,
    evaluate_as_f10,
    evaluate_as_f12,
)
from tooling.acceptance.gates.agent.foundation_group_one_scenarios_test import (
    valid_attachment_rejected_capture,
    valid_approval_expired_capture,
    valid_approval_denied_capture,
    valid_active_mutation_conflict_capture,
    valid_cancelled_capture,
    valid_context_overflow_capture,
    valid_credential_missing_capture,
    valid_duplicate_conflict_capture,
    valid_executor_unavailable_capture,
    valid_as_f04_capture,
    valid_as_f05_capture,
    valid_as_f06_capture,
    valid_as_f07_capture,
    valid_as_f12_capture,
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


def typed_runtime_role(
    facts: dict[str, object],
) -> dict[str, object]:
    runtime_event = facts["runtimeEvent"]
    assert isinstance(runtime_event, dict)
    role = {
        "eventId": runtime_event["eventId"],
        "sequence": runtime_event["sequence"],
        "eventType": runtime_event["eventType"],
        "occurredAt": runtime_event["observedAt"],
        "streamGeneration": runtime_event["streamGeneration"],
        "streamIdHash": runtime_event["streamIdHash"],
        "conversationIdHash": runtime_event["conversationIdHash"],
        "payloadHash": runtime_event["payloadHash"],
        "errorType": runtime_event["errorType"],
    }
    for key in (
        "sourceTransport",
        "sourcePtidHash",
        "sourceConversationId",
        "sourceTurnId",
        "sourceSequence",
        "sourceEventType",
    ):
        if key in runtime_event:
            role[key] = runtime_event[key]
    return role


def scenario_capture(_client: RecordingHarnessClient, probe: Any) -> dict[str, Any]:
    result = capture(probe)
    if probe.cell == "BASE-DUPLICATE_CONFLICT":
        facts = valid_duplicate_conflict_capture()
        result["scenarioFacts"] = facts
        result["assertions"] = evaluate_base_duplicate_conflict(facts)
        result["runtime-events"] = typed_runtime_role(facts)
        result["runtimeAttestation"]["actorIdentityHash"] = (
            facts["runtimeEvent"]["sourcePtidHash"]
        )
        return result
    if probe.cell == "BASE-CREDENTIAL_MISSING":
        facts = valid_credential_missing_capture()
        result["scenarioFacts"] = facts
        result["assertions"] = evaluate_base_credential_missing(facts)
        result["runtime-events"] = typed_runtime_role(facts)
        result["runtimeAttestation"]["actorIdentityHash"] = (
            facts["runtimeEvent"]["sourcePtidHash"]
        )
        return result
    if probe.cell == "BASE-CANCELLED":
        facts = valid_cancelled_capture()
        result["scenarioFacts"] = facts
        result["assertions"] = evaluate_base_cancelled(facts)
        result["runtime-events"] = typed_runtime_role(facts)
        return result
    if probe.cell == "BASE-ATTACHMENT_REJECTED":
        facts = valid_attachment_rejected_capture()
        result["scenarioFacts"] = facts
        result["assertions"] = evaluate_base_attachment_rejected(facts)
        result["runtime-events"] = typed_runtime_role(facts)
        return result
    if probe.cell == "BASE-CONTEXT_OVERFLOW":
        facts = valid_context_overflow_capture()
        result["scenarioFacts"] = facts
        result["assertions"] = evaluate_base_context_overflow(facts)
        result["runtime-events"] = typed_runtime_role(facts)
        return result
    if probe.cell == "BASE-APPROVAL_EXPIRED":
        facts = valid_approval_expired_capture()
        result["scenarioFacts"] = facts
        result["assertions"] = evaluate_base_approval_expired(facts)
        return result
    if probe.cell == "BASE-EXECUTOR_UNAVAILABLE":
        facts = valid_executor_unavailable_capture()
        result["scenarioFacts"] = facts
        result["assertions"] = evaluate_base_executor_unavailable(facts)
        return result
    if probe.cell == "AS-F03":
        facts = {
            "events": [
                {"eventType": "progress", "sequence": 1},
                {"eventType": "text", "sequence": 2},
                {"eventType": "cancelled", "sequence": 3},
            ],
            "sawTextBeforeCancel": True,
            "thinkingMode": "disabled",
            "terminalTracePersisted": True,
            "toolIsolation": {
                "disabledBindingCount": 1,
                "readyCapabilityCount": 0,
            },
            "toolDefinitionTokens": 0,
        }
        result["scenarioFacts"] = facts
        result["assertions"] = evaluate_as_f03(facts)
        return result
    if probe.cell == "AS-F04":
        facts = valid_as_f04_capture(probe.platform)
        result["scenarioFacts"] = facts
        result["assertions"] = evaluate_as_f04(
            facts,
            platform=probe.platform,
        )
        return result
    if probe.cell == "AS-F05":
        facts = valid_as_f05_capture()
        result["scenarioFacts"] = facts
        result["assertions"] = evaluate_as_f05(facts)
        return result
    if probe.cell == "AS-F06":
        facts = valid_as_f06_capture(
            probe.platform,
            probe.locale,
            probe.sample_id,
        )
        result["scenarioFacts"] = facts
        result["assertions"] = evaluate_as_f06(
            facts,
            platform=probe.platform,
            locale=probe.locale,
            sample_id=probe.sample_id,
        )
        return result
    if probe.cell == "AS-F07":
        facts = valid_as_f07_capture()
        result["scenarioFacts"] = facts
        result["assertions"] = evaluate_as_f07(facts)
        return result
    if probe.cell == "AS-F10":
        browser = probe.platform == "browser"
        facts = {
            "coreOutcome": {
                "stationStatus": "completed",
                "receiverStatus": "completed",
            },
            "toolIsolation": {
                "disabledBindingCount": 1,
                "readyCapabilityCount": 0,
                "originalReadyCapabilityCount": 1,
                "originalReadyCapabilityHash": "f" * 64,
                "restoredBindingCount": 1,
                "restoredReadyCapabilityCount": 1,
                "restoredReadyCapabilityHash": "f" * 64,
                "restorationVerified": True,
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
    if probe.cell == "AS-F12":
        facts = valid_as_f12_capture(
            probe.platform,
            probe.locale,
            probe.sample_id,
        )
        result["scenarioFacts"] = facts
        result["assertions"] = evaluate_as_f12(
            facts,
            platform=probe.platform,
            locale=probe.locale,
            sample_id=probe.sample_id,
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
    def test_attachment_rejected_routes_to_independent_oracle(self) -> None:
        facts = valid_attachment_rejected_capture()
        capture_value = {
            "scenarioFacts": facts,
            "assertions": evaluate_base_attachment_rejected(facts),
            "runtime-events": typed_runtime_role(facts),
        }
        probe = DirectRuntimeProbeInput(
            platform="browser",
            locale="en",
            cell="BASE-ATTACHMENT_REJECTED",
            sample_id="sample-001",
        )

        assert_group_one_capture(probe, capture_value)

        capture_value["assertions"] = {
            **capture_value["assertions"],
            "zeroSideEffect": False,
        }
        with self.assertRaisesRegex(
            GroupOneProbeError,
            "BASE-ATTACHMENT_REJECTED assertions do not match",
        ):
            assert_group_one_capture(probe, capture_value)

    def test_attachment_rejected_rejects_baseline_runtime_event(self) -> None:
        facts = valid_attachment_rejected_capture()
        capture_value = {
            "scenarioFacts": facts,
            "assertions": evaluate_base_attachment_rejected(facts),
            "runtime-events": {
                **typed_runtime_role(facts),
                "eventType": "done",
            },
        }
        probe = DirectRuntimeProbeInput(
            platform="browser",
            locale="en",
            cell="BASE-ATTACHMENT_REJECTED",
            sample_id="sample-001",
        )

        with self.assertRaisesRegex(
            GroupOneProbeError,
            "runtime-events role does not match",
        ):
            assert_group_one_capture(probe, capture_value)

    def test_approval_expired_routes_to_independent_oracle(self) -> None:
        facts = valid_approval_expired_capture()
        capture_value = {
            "scenarioFacts": facts,
            "assertions": evaluate_base_approval_expired(facts),
        }
        probe = DirectRuntimeProbeInput(
            platform="browser",
            locale="en",
            cell="BASE-APPROVAL_EXPIRED",
            sample_id="sample-001",
        )

        assert_group_one_capture(probe, capture_value)

        capture_value["assertions"] = {
            **capture_value["assertions"],
            "expiredDecisionImmutable": False,
        }
        with self.assertRaisesRegex(
            GroupOneProbeError,
            "BASE-APPROVAL_EXPIRED assertions do not match",
        ):
            assert_group_one_capture(probe, capture_value)

    def test_approval_denied_routes_to_independent_oracle(self) -> None:
        facts = valid_approval_denied_capture()
        capture_value = {
            "scenarioFacts": facts,
            "assertions": evaluate_base_approval_denied(facts),
        }
        probe = DirectRuntimeProbeInput(
            platform="browser",
            locale="en",
            cell="BASE-APPROVAL_DENIED",
            sample_id="sample-001",
        )

        assert_group_one_capture(probe, capture_value)

        capture_value["assertions"] = {
            **capture_value["assertions"],
            "zeroSideEffect": False,
        }
        with self.assertRaisesRegex(
            GroupOneProbeError,
            "BASE-APPROVAL_DENIED assertions do not match",
        ):
            assert_group_one_capture(probe, capture_value)

    def test_executor_unavailable_routes_to_independent_oracle(self) -> None:
        facts = valid_executor_unavailable_capture()
        capture_value = {
            "scenarioFacts": facts,
            "assertions": evaluate_base_executor_unavailable(facts),
        }
        probe = DirectRuntimeProbeInput(
            platform="browser",
            locale="en",
            cell="BASE-EXECUTOR_UNAVAILABLE",
            sample_id="sample-001",
        )

        assert_group_one_capture(probe, capture_value)

        capture_value["assertions"] = {
            **capture_value["assertions"],
            "zeroExecutionClaim": False,
        }
        with self.assertRaisesRegex(
            GroupOneProbeError,
            "BASE-EXECUTOR_UNAVAILABLE assertions do not match",
        ):
            assert_group_one_capture(probe, capture_value)

    def test_active_mutation_conflict_routes_to_independent_oracle(self) -> None:
        facts = valid_active_mutation_conflict_capture()
        capture_value = {
            "scenarioFacts": facts,
            "assertions": evaluate_base_active_mutation_conflict(facts),
        }
        probe = DirectRuntimeProbeInput(
            platform="desktop_app",
            locale="en",
            cell="BASE-ACTIVE_MUTATION_CONFLICT",
            sample_id="sample-001",
        )

        assert_group_one_capture(probe, capture_value)

        capture_value["assertions"] = {
            **capture_value["assertions"],
            "zeroStaleMutation": False,
        }
        with self.assertRaisesRegex(
            GroupOneProbeError,
            "BASE-ACTIVE_MUTATION_CONFLICT assertions do not match",
        ):
            assert_group_one_capture(probe, capture_value)

    def test_cancelled_routes_to_independent_oracle(self) -> None:
        facts = valid_cancelled_capture()
        capture_value = {
            "scenarioFacts": facts,
            "assertions": evaluate_base_cancelled(facts),
            "runtime-events": typed_runtime_role(facts),
            "runtimeAttestation": {
                "actorIdentityHash": facts["runtimeEvent"]["sourcePtidHash"],
            },
        }
        probe = DirectRuntimeProbeInput(
            platform="browser",
            locale="en",
            cell="BASE-CANCELLED",
            sample_id="sample-001",
        )

        assert_group_one_capture(probe, capture_value)

        capture_value["assertions"] = {
            **capture_value["assertions"],
            "zeroLateSuccess": False,
        }
        with self.assertRaisesRegex(
            GroupOneProbeError,
            "BASE-CANCELLED assertions do not match",
        ):
            assert_group_one_capture(probe, capture_value)

    def test_context_overflow_routes_to_independent_oracle(self) -> None:
        facts = valid_context_overflow_capture()
        capture_value = {
            "scenarioFacts": facts,
            "assertions": evaluate_base_context_overflow(facts),
            "runtime-events": typed_runtime_role(facts),
            "runtimeAttestation": {
                "actorIdentityHash": facts["runtimeEvent"]["sourcePtidHash"],
            },
        }
        probe = DirectRuntimeProbeInput(
            platform="browser",
            locale="en",
            cell="BASE-CONTEXT_OVERFLOW",
            sample_id="sample-001",
        )

        assert_group_one_capture(probe, capture_value)

        capture_value["assertions"] = {
            **capture_value["assertions"],
            "zeroPersistenceAndProvider": False,
        }
        with self.assertRaisesRegex(
            GroupOneProbeError,
            "BASE-CONTEXT_OVERFLOW assertions do not match",
        ):
            assert_group_one_capture(probe, capture_value)

    def test_duplicate_conflict_routes_to_independent_oracle(self) -> None:
        probe = DirectRuntimeProbeInput(
            platform="browser",
            locale="en",
            cell="BASE-DUPLICATE_CONFLICT",
            sample_id="sample-001",
        )
        capture_value = scenario_capture(RecordingHarnessClient(), probe)

        assert_group_one_capture(probe, capture_value)

        capture_value["assertions"] = {
            **capture_value["assertions"],
            "zeroNewRows": False,
        }
        with self.assertRaisesRegex(
            GroupOneProbeError,
            "BASE-DUPLICATE_CONFLICT assertions do not match",
        ):
            assert_group_one_capture(probe, capture_value)

    def test_duplicate_conflict_rejects_runtime_role_identity_drift(
        self,
    ) -> None:
        probe = DirectRuntimeProbeInput(
            platform="browser",
            locale="en",
            cell="BASE-DUPLICATE_CONFLICT",
            sample_id="sample-001",
        )
        capture_value = scenario_capture(RecordingHarnessClient(), probe)
        capture_value["runtime-events"]["sourceConversationId"] = (
            "conversation-forged"
        )

        with self.assertRaisesRegex(
            GroupOneProbeError,
            "runtime-events role does not match",
        ):
            assert_group_one_capture(probe, capture_value)

    def test_duplicate_conflict_rejects_runtime_actor_drift(self) -> None:
        probe = DirectRuntimeProbeInput(
            platform="browser",
            locale="en",
            cell="BASE-DUPLICATE_CONFLICT",
            sample_id="sample-001",
        )
        capture_value = scenario_capture(RecordingHarnessClient(), probe)
        capture_value["runtimeAttestation"]["actorIdentityHash"] = "0" * 64

        with self.assertRaisesRegex(
            GroupOneProbeError,
            "runtime source actor does not match",
        ):
            assert_group_one_capture(probe, capture_value)

    def test_credential_missing_routes_to_independent_oracle(self) -> None:
        probe = DirectRuntimeProbeInput(
            platform="browser",
            locale="en",
            cell="BASE-CREDENTIAL_MISSING",
            sample_id="sample-001",
        )
        capture_value = scenario_capture(RecordingHarnessClient(), probe)

        assert_group_one_capture(probe, capture_value)

        capture_value["assertions"] = {
            **capture_value["assertions"],
            "zeroProviderCall": False,
        }
        with self.assertRaisesRegex(
            GroupOneProbeError,
            "BASE-CREDENTIAL_MISSING assertions do not match",
        ):
            assert_group_one_capture(probe, capture_value)

    def test_credential_missing_rejects_runtime_role_identity_drift(
        self,
    ) -> None:
        probe = DirectRuntimeProbeInput(
            platform="browser",
            locale="en",
            cell="BASE-CREDENTIAL_MISSING",
            sample_id="sample-001",
        )
        capture_value = scenario_capture(RecordingHarnessClient(), probe)
        capture_value["runtime-events"]["sourceConversationId"] = (
            "conversation-forged"
        )

        with self.assertRaisesRegex(
            GroupOneProbeError,
            "runtime-events role does not match",
        ):
            assert_group_one_capture(probe, capture_value)

    def test_credential_missing_rejects_runtime_actor_drift(self) -> None:
        probe = DirectRuntimeProbeInput(
            platform="browser",
            locale="en",
            cell="BASE-CREDENTIAL_MISSING",
            sample_id="sample-001",
        )
        capture_value = scenario_capture(RecordingHarnessClient(), probe)
        capture_value["runtimeAttestation"]["actorIdentityHash"] = "f" * 64

        with self.assertRaisesRegex(
            GroupOneProbeError,
            "runtime source actor does not match",
        ):
            assert_group_one_capture(probe, capture_value)

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
        self.assertEqual(len(desktop.locales), 22)
        self.assertEqual(len(browser.locales), 22)
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

    def test_as_f12_rejects_renderer_assertions_not_derived_from_facts(
        self,
    ) -> None:
        facts = valid_as_f12_capture()
        capture_value = {
            "scenarioFacts": facts,
            "assertions": {
                **evaluate_as_f12(
                    facts,
                    platform="desktop_app",
                    locale="en",
                    sample_id="sample-001",
                ),
                "noCrossTopicReferences": False,
            },
        }
        probe = DirectRuntimeProbeInput(
            platform="desktop_app",
            locale="en",
            cell="AS-F12",
            sample_id="sample-001",
        )

        with self.assertRaisesRegex(
            GroupOneProbeError,
            "AS-F12 assertions do not match production scenario facts",
        ):
            assert_group_one_capture(probe, capture_value)

    def test_as_f05_rejects_assertions_not_derived_from_facts(self) -> None:
        runner = FoundationGroupOneProbeRunner(
            desktop_native=RecordingHarnessClient(),
            browser=RecordingHarnessClient(),
        )

        def mismatched(
            client: RecordingHarnessClient,
            probe: Any,
        ) -> dict[str, Any]:
            result = scenario_capture(client, probe)
            if probe.cell == "AS-F05":
                result["scenarioFacts"]["diagnosticSecret"] = "must-not-leak"
                result["assertions"] = {
                    **result["assertions"],
                    "authorizedDownloadVerified": False,
                    "failedUploadRemovalPreservedSiblings": False,
                }
            return result

        with self.assertRaises(GroupOneProbeError) as raised:
            runner.collect(mismatched)

        self.assertEqual(
            str(raised.exception),
            "AS-F05 assertions do not match production scenario facts: "
            'mismatches=[{"capture":false,"evaluated":true,'
            '"key":"authorizedDownloadVerified"},'
            '{"capture":false,"evaluated":true,'
            '"key":"failedUploadRemovalPreservedSiblings"}]',
        )
        self.assertNotIn("must-not-leak", str(raised.exception))

    def test_as_f07_rejects_assertions_not_derived_from_facts(self) -> None:
        runner = FoundationGroupOneProbeRunner(
            desktop_native=RecordingHarnessClient(),
            browser=RecordingHarnessClient(),
        )

        def mismatched(
            client: RecordingHarnessClient,
            probe: Any,
        ) -> dict[str, Any]:
            result = scenario_capture(client, probe)
            if probe.cell == "AS-F07":
                result["assertions"] = {
                    **result["assertions"],
                    "branchSwitchPersisted": False,
                }
            return result

        with self.assertRaisesRegex(
            GroupOneProbeError,
            "AS-F07 assertions do not match production scenario facts",
        ):
            runner.collect(mismatched)

    def test_deferred_assertion_key_mismatch_remains_fail_closed(self) -> None:
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
                facts = result["scenarioFacts"]
                facts["rejections"]["unsupported"] = {
                    "availability": "unavailable",
                    "unavailable_reason": "NO_PRODUCTION_CAPABILITY_ENDPOINT",
                }
                result["assertions"] = evaluate_as_f10(
                    facts,
                    platform=probe.platform,
                )
                result["assertions"].pop("unsupportedRejected")
            return result

        with self.assertRaises(GroupOneProbeError) as raised:
            runner.collect(mismatched)

        self.assertEqual(
            str(raised.exception),
            "AS-F10 deferred keys mismatch: "
            'mismatches=[{"capture":null,"evaluated":null,'
            '"key":"unsupportedRejected"}]',
        )

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
