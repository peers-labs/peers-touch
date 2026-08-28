from __future__ import annotations

import copy
import unittest

from tooling.acceptance.gates.agent.foundation_group_one_scenarios import (
    GroupOneScenarioError,
    evaluate_as_f02,
    evaluate_as_f03,
    evaluate_as_f04,
    evaluate_as_f05,
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


def valid_as_f05_capture() -> dict[str, object]:
    png = {
        "attachmentId": "att-png",
        "objectRef": "oss:cas/fixture/opaque-png",
        "mimeType": "image/png",
        "sizeBytes": 68,
        "checksum": "sha256:png",
        "filename": "fixture.png",
        "authorizationScope": "conversation:conversation-1",
        "expiresAt": "2026-08-29T00:00:00Z",
    }
    pdf = {
        "attachmentId": "att-pdf",
        "objectRef": "oss:cas/fixture/opaque-pdf",
        "mimeType": "application/pdf",
        "sizeBytes": 45,
        "checksum": "sha256:pdf",
        "filename": "fixture.pdf",
        "authorizationScope": "conversation:conversation-1",
        "expiresAt": "2026-08-29T00:00:00Z",
    }
    return {
        "validFiles": {
            "png": {
                **png,
                "modelDisposition": "omitted",
                "modelVisible": False,
                "omissionReason": "selected_model_has_no_image_input",
                "ledgerDecision": 3,
            },
            "pdf": {
                **pdf,
                "modelDisposition": "omitted",
                "modelVisible": False,
                "omissionReason": "selected_model_has_no_file_input",
                "ledgerDecision": 3,
            },
        },
        "persistence": {
            "beforeRestart": [png, pdf],
            "afterRestart": [pdf, png],
            "projectionReadback": [png, pdf],
            "contextSegmentAttachmentIds": ["att-pdf", "att-png"],
        },
        "uploadRecovery": {
            "failedUpload": {
                "errorCode": "CONTEXT_ATTACHMENT_REJECTED",
                "retriedAttachmentId": "att-retried",
                "retriedChecksum": "sha256:retry",
            },
            "removal": {
                "removedAttachmentId": "att-failed",
                "removedObjectUnavailable": True,
                "siblingIdsBefore": ["att-png", "att-pdf"],
                "siblingIdsAfter": ["att-pdf", "att-png"],
                "siblingChecksumsBefore": ["sha256:png", "sha256:pdf"],
                "siblingChecksumsAfter": ["sha256:png", "sha256:pdf"],
            },
        },
        "rejections": {
            "oversized": {
                "accepted": False,
                "errorCode": "CONTEXT_ATTACHMENT_REJECTED",
                "turnDelta": 0,
                "providerExecutionDelta": 0,
                "messageDelta": 0,
            },
            "unsupported": {
                "accepted": False,
                "errorCode": "CONTEXT_ATTACHMENT_REJECTED",
                "turnDelta": 0,
                "providerExecutionDelta": 0,
                "messageDelta": 0,
            },
            "unauthorized": {
                "accepted": False,
                "errorCode": "CONTEXT_ATTACHMENT_REJECTED",
                "turnDelta": 0,
                "providerExecutionDelta": 0,
                "messageDelta": 0,
            },
        },
        "references": [png, pdf],
        "authorizedDownload": {
            "attachmentId": "att-pdf",
            "authorized": True,
            "downloaded": True,
            "expectedChecksum": "sha256:pdf",
            "actualChecksum": "sha256:pdf",
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


def valid_as_f04_capture(
    platform: str = "desktop_app",
) -> dict[str, object]:
    execution_owner = (
        "station" if platform == "browser" else "client_capability"
    )

    def lineage(suffix: str, *, terminal: bool) -> dict[str, object]:
        result: dict[str, object] = {
            "toolCallId": f"tool-call-{suffix}",
            "toolBatchId": f"tool-batch-{suffix}",
            "manifestId": f"manifest-{suffix}",
            "manifestVersion": "1",
            "bindingId": f"binding-{suffix}",
            "bindingRevision": 1,
            "readinessSnapshotId": f"readiness-{suffix}",
            "approvalId": f"approval-{suffix}",
            "decisionId": f"decision-{suffix}",
        }
        if terminal:
            result.update(
                {
                    "executionClaimId": f"claim-{suffix}",
                    "fencingToken": 1,
                    "sideEffectReceiptId": f"receipt-{suffix}",
                    "resultId": f"result-{suffix}",
                    "continuationId": f"continuation-{suffix}",
                    "dispatchCommittedAt": "2026-08-28T00:00:00Z",
                    "startedAt": "2026-08-28T00:00:01Z",
                    "endedAt": "2026-08-28T00:00:02Z",
                }
            )
        return result

    expiry_lineage = lineage("expiry", terminal=False)
    expiry_lineage["decisionId"] = ""
    return {
        "cases": {
            "auto": {
                "policy": "auto",
                "executionOwner": execution_owner,
                "states": [
                    "policy_check",
                    "auto_approved",
                    "running",
                    "succeeded",
                ],
                "executionAttemptCount": 1,
                "sideEffectCount": 1,
                "resultCount": 1,
                "continuationCount": 1,
                "lineage": lineage("auto", terminal=True),
            },
            "manual": {
                "policy": "manual",
                "executionOwner": execution_owner,
                "states": [
                    "policy_check",
                    "awaiting_user",
                    "approved",
                    "running",
                    "succeeded",
                ],
                "executionAttemptCount": 1,
                "sideEffectCount": 1,
                "resultCount": 1,
                "continuationCount": 1,
                "lineage": lineage("manual", terminal=True),
            },
            "deny": {
                "policy": "deny",
                "executionOwner": execution_owner,
                "states": ["policy_check", "denied"],
                "executionAttemptCount": 0,
                "sideEffectCount": 0,
                "resultCount": 0,
                "continuationCount": 0,
                "lineage": lineage("deny", terminal=False),
            },
            "expiry": {
                "policy": "manual",
                "executionOwner": execution_owner,
                "states": ["policy_check", "awaiting_user", "expired"],
                "executionAttemptCount": 0,
                "sideEffectCount": 0,
                "resultCount": 0,
                "continuationCount": 0,
                "lineage": expiry_lineage,
            },
        },
        "duplicateDelivery": {
            "deliveryCount": 2,
            "executionAttemptCount": 1,
            "sideEffectCount": 1,
            "resultCount": 1,
            "continuationCount": 1,
            "originalResultId": "result-auto",
            "replayedResultId": "result-auto",
            "originalContinuationId": "continuation-auto",
            "replayedContinuationId": "continuation-auto",
        },
        "loopBudget": {
            "stopped": True,
            "observedIterations": 25,
            "maximumIterations": 25,
            "executionAfterLimit": 0,
        },
        "replay": {
            "sourceHash": "source-hash",
            "replayHash": "source-hash",
            "equal": True,
        },
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

    def test_as_f04_accepts_governed_desktop_and_browser_facts(self) -> None:
        for platform in ("desktop_app", "browser"):
            with self.subTest(platform=platform):
                assertions = evaluate_as_f04(
                    valid_as_f04_capture(platform),
                    platform=platform,
                )

                self.assertEqual(len(assertions), 8)
                self.assertTrue(all(assertions.values()))

    def test_as_f04_rejects_duplicate_side_effect(self) -> None:
        capture = valid_as_f04_capture()
        duplicate = capture["duplicateDelivery"]
        assert isinstance(duplicate, dict)
        duplicate["sideEffectCount"] = 2

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "duplicateDeliveryIdempotent",
        ):
            evaluate_as_f04(capture, platform="desktop_app")

    def test_as_f04_rejects_browser_client_execution(self) -> None:
        capture = valid_as_f04_capture("browser")
        cases = capture["cases"]
        assert isinstance(cases, dict)
        auto = cases["auto"]
        assert isinstance(auto, dict)
        auto["executionOwner"] = "client_capability"

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "authorityLineagePersisted",
        ):
            evaluate_as_f04(capture, platform="browser")

    def test_as_f05_accepts_complete_attachment_facts(self) -> None:
        assertions = evaluate_as_f05(valid_as_f05_capture())

        self.assertEqual(len(assertions), 10)
        self.assertTrue(all(assertions.values()))

    def test_as_f05_accepts_explicit_model_omission(self) -> None:
        capture = valid_as_f05_capture()
        valid_files = capture["validFiles"]
        assert isinstance(valid_files, dict)
        for fact in valid_files.values():
            assert isinstance(fact, dict)
            fact["modelDisposition"] = "omitted"
            fact["modelVisible"] = False
            fact["omissionReason"] = "selected_model_has_no_file_input"
            fact["ledgerDecision"] = 3

        assertions = evaluate_as_f05(capture)
        self.assertTrue(assertions["validPngHandled"])
        self.assertTrue(assertions["validPdfHandled"])

    def test_as_f05_rejects_provider_execution_for_invalid_attachment(self) -> None:
        capture = valid_as_f05_capture()
        rejections = capture["rejections"]
        assert isinstance(rejections, dict)
        oversized = rejections["oversized"]
        assert isinstance(oversized, dict)
        oversized["providerExecutionDelta"] = 1

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "oversizedRejectedBeforeProvider",
        ):
            evaluate_as_f05(capture)

    def test_as_f05_rejects_local_path_reference(self) -> None:
        capture = valid_as_f05_capture()
        references = capture["references"]
        assert isinstance(references, list)
        references[0]["objectRef"] = "/Users/example/fixture.png"

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "opaque authorized reference",
        ):
            evaluate_as_f05(capture)

    def test_as_f05_rejects_restart_metadata_drift(self) -> None:
        capture = copy.deepcopy(valid_as_f05_capture())
        persistence = capture["persistence"]
        assert isinstance(persistence, dict)
        after_restart = persistence["afterRestart"]
        assert isinstance(after_restart, list)
        after_restart[0] = {
            **after_restart[0],
            "checksum": "sha256:changed",
        }

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "metadataRestartReadback",
        ):
            evaluate_as_f05(capture)

    def test_as_f05_rejects_sibling_loss_after_failed_upload_removal(self) -> None:
        capture = valid_as_f05_capture()
        recovery = capture["uploadRecovery"]
        assert isinstance(recovery, dict)
        removal = recovery["removal"]
        assert isinstance(removal, dict)
        removal["siblingIdsAfter"] = ["att-png"]

        with self.assertRaisesRegex(
            GroupOneScenarioError,
            "failedUploadRemovalPreservedSiblings",
        ):
            evaluate_as_f05(capture)

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
