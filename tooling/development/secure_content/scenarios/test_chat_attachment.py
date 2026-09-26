from __future__ import annotations

import unittest
from types import SimpleNamespace
from typing import Any, Mapping

from tooling.development.secure_content.drivers.chat_attachment import (
    CHAT_ATTACHMENT_FAILURE_CODES,
    ChatAttachmentCorpusDriver,
    ChatAttachmentDriverError,
    corpus_descriptor,
)
from tooling.development.secure_content.scenarios import (
    chat_attachment_atomic,
    chat_attachment_mobile,
    chat_revalidation,
    chat_revalidation_mobile,
)


class _Fixture:
    def __init__(self, *, corrupt_operation: str = "") -> None:
        self.operations: list[str] = []
        self.corrupt_operation = corrupt_operation
        self.corpus = corpus_descriptor()

    def __call__(
        self,
        operation: str,
        payload: Mapping[str, object],
    ) -> Mapping[str, Any]:
        self.operations.append(operation)
        self.assert_common_payload(payload)
        if operation == "prepare-corpus":
            return {
                "runHandle": "fixture-run",
                "chunkCount": 3,
                "attachmentSha256": self.corpus["sha256"],
                "attachmentSizeBytes": self.corpus["sizeBytes"],
            }
        if operation in {"direct-exact-bytes", "group-exact-bytes"}:
            kind = operation.split("-", 1)[0]
            return {
                "conversationKind": kind,
                "messageId": f"{kind}-message",
                "attachmentId": f"{kind}-attachment",
                "nativeSenderVisible": True,
                "nativeReceiverVisible": True,
                "sentSha256": self.corpus["sha256"],
                "senderOpenedSha256": self.corpus["sha256"],
                "receiverOpenedSha256": self.corpus["sha256"],
            }
        if "-resume-boundary-" in operation:
            direction, boundary_text = operation.split("-resume-boundary-")
            boundary = int(boundary_text)
            requested = list(range(boundary, 3))
            if operation == self.corrupt_operation:
                requested = list(range(3))
            return {
                "direction": direction,
                "boundary": boundary,
                "chunkCount": 3,
                "completedChunksBefore": list(range(boundary)),
                "requestedChunksAfter": requested,
                "checkpointSurvived": True,
                "openedSha256": self.corpus["sha256"],
            }
        if operation.startswith("failure-"):
            failure = operation.removeprefix("failure-")
            return {
                "failure": failure,
                "errorCode": CHAT_ATTACHMENT_FAILURE_CODES[failure],
                "typed": True,
                "terminal": True,
                "partialPlaintextBytes": (
                    1 if operation == self.corrupt_operation else 0
                ),
            }
        if operation.startswith("restart-"):
            target = operation.removeprefix("restart-")
            return {
                "target": target,
                "checkpointSurvived": True,
                "openedSha256": self.corpus["sha256"],
            }
        if operation == "fresh-recovery":
            return {
                "freshStorageIdentity": True,
                "historicalGrantRecovered": True,
                "openedSha256": self.corpus["sha256"],
            }
        if operation == "removed-actor":
            return {
                "historicalOpenedSha256": self.corpus["sha256"],
                "newGrantCreated": False,
                "postRemovalOpenErrorCode": (
                    "ATTACHMENT_TRANSFER_ERROR_CODE_NOT_GRANTED"
                ),
                "partialPlaintextBytes": 0,
            }
        if operation == "secrecy-scan":
            return {
                "inspectedFields": [
                    "filename",
                    "key",
                    "nonce",
                    "plaintext-sha256",
                ],
                "stationRowLeakCount": 0,
                "stationLogLeakCount": 0,
                "clientCrossAccountPlaintextLeakCount": 0,
            }
        if operation == "cleanup-corpus":
            return {
                "completed": True,
                "plaintextArtifactsRemaining": 0,
            }
        raise AssertionError(f"unexpected fixture operation: {operation}")

    def assert_common_payload(self, payload: Mapping[str, object]) -> None:
        if payload.get("platform") not in {"desktop", "ios", "android"}:
            raise AssertionError("fixture payload has no platform")


class _Manifest:
    def __init__(self, clients: Mapping[str, Mapping[str, str]]) -> None:
        self.clients = dict(clients)

    def client(self, client_id: str) -> Mapping[str, str]:
        return self.clients[client_id]


class ChatAttachmentDriverTest(unittest.TestCase):
    def test_corpus_is_deterministic_and_spans_multiple_chunks(self) -> None:
        first = corpus_descriptor()
        second = corpus_descriptor()

        self.assertEqual(first, second)
        self.assertGreater(first["sizeBytes"], first["chunkSizeBytes"])
        self.assertRegex(str(first["sha256"]), r"^[0-9a-f]{64}$")

    def test_complete_desktop_corpus_checks_every_mp_g13_cell(self) -> None:
        fixture = _Fixture()

        result = ChatAttachmentCorpusDriver(
            platform="desktop",
            invoke_fixture=fixture,
        ).run()

        self.assertEqual("MP-J11", result["claimBoundary"]["productJourney"])
        self.assertEqual("MP-G13", result["claimBoundary"]["acceptanceGate"])
        self.assertEqual({"direct", "group"}, set(result["exactBytes"]))
        self.assertEqual(2, len(result["resume"]["upload"]))
        self.assertEqual(2, len(result["resume"]["download"]))
        self.assertEqual(
            set(CHAT_ATTACHMENT_FAILURE_CODES),
            set(result["failureCorpus"]),
        )
        self.assertEqual(19, len(fixture.operations))
        self.assertEqual("prepare-corpus", fixture.operations[0])
        self.assertEqual("cleanup-corpus", fixture.operations[-1])

    def test_mobile_corpus_requires_cross_account_secrecy(self) -> None:
        result = ChatAttachmentCorpusDriver(
            platform="ios",
            invoke_fixture=_Fixture(),
        ).run()

        self.assertEqual(
            0,
            result["secrecy"]["clientCrossAccountPlaintextLeakCount"],
        )

    def test_resume_rejects_re_requesting_completed_chunks(self) -> None:
        with self.assertRaisesRegex(
            ChatAttachmentDriverError,
            "did not request only missing chunks",
        ):
            ChatAttachmentCorpusDriver(
                platform="desktop",
                invoke_fixture=_Fixture(
                    corrupt_operation="upload-resume-boundary-1"
                ),
            ).run()

    def test_failure_corpus_rejects_partial_plaintext(self) -> None:
        with self.assertRaisesRegex(
            ChatAttachmentDriverError,
            "did not fail closed",
        ):
            ChatAttachmentCorpusDriver(
                platform="android",
                invoke_fixture=_Fixture(
                    corrupt_operation="failure-aead-failure"
                ),
            ).run()

    def test_desktop_scenario_binds_native_alice_and_bob(self) -> None:
        context = SimpleNamespace(
            clients=(),
            require_runtime_manifest=lambda: _Manifest(
                {
                    "desktop-alice": {
                        "actor_role": "alice",
                        "runtime_kind": "native-tauri",
                    },
                    "desktop-bob": {
                        "actor_role": "bob",
                        "runtime_kind": "native-tauri",
                    },
                    "browser": {
                        "actor_role": "anonymous",
                        "runtime_kind": "browser",
                    },
                }
            ),
        )

        self.assertEqual(
            ("desktop-alice", "desktop-bob"),
            chat_attachment_atomic._native_clients(context),
        )

    def test_mobile_scenario_rejects_mixed_platform_clients(self) -> None:
        context = SimpleNamespace(
            runtime="mobile",
            profile=None,
            profiles=("four", "fiveArm"),
            clients=("ios_alice", "android_bob"),
            require_runtime_manifest=lambda: _Manifest({}),
        )

        with self.assertRaisesRegex(
            RuntimeError,
            "exactly one iOS or Android",
        ):
            chat_attachment_mobile._mobile_platform(context)

    def test_mobile_result_variants_are_platform_isolated(self) -> None:
        self.assertEqual(
            "ios",
            chat_attachment_mobile._result_variant(
                "mobile",
                None,
                ("four", "fiveArm"),
                ("ios_alice", "ios_bob"),
            ),
        )
        self.assertEqual(
            "android",
            chat_attachment_mobile._result_variant(
                "mobile",
                None,
                ("four", "fiveArm"),
                ("android_alice", "android_bob"),
            ),
        )

    def test_scenarios_bind_the_w2_runtime_work_items(self) -> None:
        self.assertEqual(
            "secure-content-w2b-desktop",
            chat_attachment_atomic.SCENARIO.work_item_id,
        )
        self.assertEqual(
            "secure-content-w2b-mobile",
            chat_attachment_mobile.SCENARIO.work_item_id,
        )
        self.assertEqual(
            frozenset({"chat-attachment-desktop"}),
            chat_attachment_atomic.SCENARIO.required_fixture_capabilities,
        )
        self.assertEqual(
            frozenset({"chat-attachment-mobile"}),
            chat_attachment_mobile.SCENARIO.required_fixture_capabilities,
        )
        self.assertEqual(
            "secure-content-w10",
            chat_revalidation.SCENARIO.work_item_id,
        )
        self.assertEqual(
            frozenset({"chat-attachment-revalidation"}),
            chat_revalidation.SCENARIO.required_fixture_capabilities,
        )
        self.assertEqual(
            "secure-content-w10",
            chat_revalidation_mobile.SCENARIO.work_item_id,
        )
        self.assertEqual(
            frozenset({"mobile"}),
            chat_revalidation_mobile.SCENARIO.runtimes,
        )


if __name__ == "__main__":
    unittest.main()
