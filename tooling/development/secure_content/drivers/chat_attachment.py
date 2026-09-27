from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any, Callable, Mapping


CORPUS_SIZE_BYTES = (2 * 1024 * 1024) + 257
CORPUS_CHUNK_SIZE_BYTES = 1024 * 1024
CORPUS_SEED = b"peers-touch-mp-j11-attachment-corpus"
CONVERSATION_KINDS = ("direct", "group")
TRANSFER_DIRECTIONS = ("upload", "download")
SECRECY_FIELDS = frozenset(
    {"filename", "key", "nonce", "plaintext-sha256"}
)
CHAT_ATTACHMENT_FAILURE_CODES = {
    "duplicate-conflict": "ATTACHMENT_TRANSFER_ERROR_CODE_PART_CONFLICT",
    "invalid-range": "ATTACHMENT_TRANSFER_ERROR_CODE_RANGE_INVALID",
    "etag-mismatch": "ATTACHMENT_TRANSFER_ERROR_CODE_DESCRIPTOR_MISMATCH",
    "ciphertext-hash-mismatch": "ATTACHMENT_TRANSFER_ERROR_CODE_INTEGRITY_FAILED",
    "plaintext-hash-mismatch": "ATTACHMENT_TRANSFER_ERROR_CODE_INTEGRITY_FAILED",
    "aead-failure": "ATTACHMENT_TRANSFER_ERROR_CODE_INTEGRITY_FAILED",
}


class ChatAttachmentDriverError(RuntimeError):
    pass


FixtureInvoker = Callable[
    [str, Mapping[str, object]],
    Mapping[str, Any],
]


def materialize_corpus() -> bytes:
    result = bytearray()
    counter = 0
    while len(result) < CORPUS_SIZE_BYTES:
        result.extend(
            hashlib.sha256(
                CORPUS_SEED + counter.to_bytes(8, "big")
            ).digest()
        )
        counter += 1
    return bytes(result[:CORPUS_SIZE_BYTES])


def corpus_descriptor() -> dict[str, Any]:
    payload = materialize_corpus()
    return {
        "generator": "sha256-counter",
        "seed": CORPUS_SEED.decode("ascii"),
        "sizeBytes": len(payload),
        "chunkSizeBytes": CORPUS_CHUNK_SIZE_BYTES,
        "sha256": hashlib.sha256(payload).hexdigest(),
        "filename": "mp-j11-attachment.bin",
        "mimeType": "application/octet-stream",
    }


def _mapping(value: Any, field: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ChatAttachmentDriverError(f"{field} must be an object")
    return value


def _text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ChatAttachmentDriverError(f"{field} must be a non-empty string")
    return value


def _positive_int(value: Any, field: str) -> int:
    if (
        not isinstance(value, int)
        or isinstance(value, bool)
        or value < 1
    ):
        raise ChatAttachmentDriverError(f"{field} must be a positive integer")
    return value


def _integer_list(value: Any, field: str) -> list[int]:
    if not isinstance(value, list) or any(
        not isinstance(item, int) or isinstance(item, bool)
        for item in value
    ):
        raise ChatAttachmentDriverError(f"{field} must be an integer list")
    return value


@dataclass(frozen=True)
class ChatAttachmentCorpusDriver:
    platform: str
    invoke_fixture: FixtureInvoker

    def __post_init__(self) -> None:
        if self.platform not in {"desktop", "ios", "android"}:
            raise ValueError(f"unsupported Chat attachment platform: {self.platform}")

    def run(self) -> Mapping[str, Any]:
        corpus = corpus_descriptor()
        prepared = self._invoke("prepare-corpus", {"corpus": corpus})
        run_handle = _text(prepared.get("runHandle"), "prepare runHandle")
        chunk_count = _positive_int(
            prepared.get("chunkCount"),
            "prepare chunkCount",
        )
        if chunk_count < 2:
            raise ChatAttachmentDriverError(
                "MP-J11 corpus must span at least two chunks"
            )
        if (
            prepared.get("attachmentSha256") != corpus["sha256"]
            or prepared.get("attachmentSizeBytes") != corpus["sizeBytes"]
        ):
            raise ChatAttachmentDriverError(
                "prepared corpus identity differs from MP-J11"
            )

        exact_bytes = {
            kind: self._validate_exact_bytes(
                kind,
                self._invoke(
                    f"{kind}-exact-bytes",
                    {"runHandle": run_handle, "corpus": corpus},
                ),
                corpus,
            )
            for kind in CONVERSATION_KINDS
        }
        resume = {
            direction: [
                self._validate_resume(
                    direction,
                    boundary,
                    chunk_count,
                    self._invoke(
                        f"{direction}-resume-boundary-{boundary}",
                        {
                            "runHandle": run_handle,
                            "boundary": boundary,
                            "chunkCount": chunk_count,
                            "corpus": corpus,
                        },
                    ),
                    corpus,
                )
                for boundary in range(1, chunk_count)
            ]
            for direction in TRANSFER_DIRECTIONS
        }
        failures = {
            failure: self._validate_failure(
                failure,
                self._invoke(
                    f"failure-{failure}",
                    {"runHandle": run_handle, "corpus": corpus},
                ),
            )
            for failure in CHAT_ATTACHMENT_FAILURE_CODES
        }
        restarts = {
            target: self._validate_restart(
                target,
                self._invoke(
                    f"restart-{target}",
                    {"runHandle": run_handle, "corpus": corpus},
                ),
                corpus,
            )
            for target in ("client", "station")
        }
        recovery = self._validate_recovery(
            self._invoke(
                "fresh-recovery",
                {"runHandle": run_handle, "corpus": corpus},
            ),
            corpus,
        )
        revocation = self._validate_revocation(
            self._invoke(
                "removed-actor",
                {"runHandle": run_handle, "corpus": corpus},
            ),
            corpus,
        )
        secrecy = self._validate_secrecy(
            self._invoke(
                "secrecy-scan",
                {"runHandle": run_handle},
            )
        )
        cleanup = self._mapping_outcome(
            self._invoke("cleanup-corpus", {"runHandle": run_handle}),
            "cleanup",
        )
        if (
            cleanup.get("completed") is not True
            or cleanup.get("plaintextArtifactsRemaining") != 0
        ):
            raise ChatAttachmentDriverError(
                "MP-J11 fixture cleanup did not remove plaintext artifacts"
            )

        return {
            "platform": self.platform,
            "corpus": {
                "sha256": corpus["sha256"],
                "sizeBytes": corpus["sizeBytes"],
                "chunkSizeBytes": corpus["chunkSizeBytes"],
                "chunkCount": chunk_count,
            },
            "exactBytes": exact_bytes,
            "resume": resume,
            "failureCorpus": failures,
            "restart": restarts,
            "freshRecovery": recovery,
            "removedActor": revocation,
            "secrecy": secrecy,
            "cleanup": {
                "completed": True,
                "plaintextArtifactsRemaining": 0,
            },
            "claimBoundary": {
                "productJourney": "MP-J11",
                "acceptanceGate": "MP-G13",
                "formalAcceptance": "NOT_RUN",
            },
        }

    def _invoke(
        self,
        operation: str,
        payload: Mapping[str, object],
    ) -> Mapping[str, Any]:
        return _mapping(
            self.invoke_fixture(
                operation,
                {
                    "platform": self.platform,
                    **dict(payload),
                },
            ),
            f"{operation} outcome",
        )

    @staticmethod
    def _mapping_outcome(
        value: Mapping[str, Any],
        field: str,
    ) -> Mapping[str, Any]:
        return _mapping(value, field)

    @staticmethod
    def _validate_exact_bytes(
        kind: str,
        outcome: Mapping[str, Any],
        corpus: Mapping[str, Any],
    ) -> Mapping[str, Any]:
        value = _mapping(outcome, f"{kind} exact-bytes")
        if (
            value.get("conversationKind") != kind
            or value.get("nativeSenderVisible") is not True
            or value.get("nativeReceiverVisible") is not True
            or value.get("sentSha256") != corpus["sha256"]
            or value.get("senderOpenedSha256") != corpus["sha256"]
            or value.get("receiverOpenedSha256") != corpus["sha256"]
        ):
            raise ChatAttachmentDriverError(
                f"{kind} attachment bytes or Native projections differ"
            )
        return {
            "conversationKind": kind,
            "messageId": _text(value.get("messageId"), f"{kind} messageId"),
            "attachmentId": _text(
                value.get("attachmentId"),
                f"{kind} attachmentId",
            ),
            "sha256": corpus["sha256"],
            "nativeSenderVisible": True,
            "nativeReceiverVisible": True,
        }

    @staticmethod
    def _validate_resume(
        direction: str,
        boundary: int,
        chunk_count: int,
        outcome: Mapping[str, Any],
        corpus: Mapping[str, Any],
    ) -> Mapping[str, Any]:
        value = _mapping(outcome, f"{direction} resume boundary {boundary}")
        expected_completed = list(range(boundary))
        expected_requested = list(range(boundary, chunk_count))
        if (
            value.get("direction") != direction
            or value.get("boundary") != boundary
            or value.get("chunkCount") != chunk_count
            or _integer_list(
                value.get("completedChunksBefore"),
                f"{direction} completedChunksBefore",
            )
            != expected_completed
            or _integer_list(
                value.get("requestedChunksAfter"),
                f"{direction} requestedChunksAfter",
            )
            != expected_requested
            or value.get("checkpointSurvived") is not True
            or value.get("openedSha256") != corpus["sha256"]
        ):
            raise ChatAttachmentDriverError(
                f"{direction} resume boundary {boundary} did not request only "
                "missing chunks"
            )
        return {
            "boundary": boundary,
            "completedChunksBefore": expected_completed,
            "requestedChunksAfter": expected_requested,
            "checkpointSurvived": True,
            "openedSha256": corpus["sha256"],
        }

    @staticmethod
    def _validate_failure(
        failure: str,
        outcome: Mapping[str, Any],
    ) -> Mapping[str, Any]:
        value = _mapping(outcome, f"failure {failure}")
        expected_code = CHAT_ATTACHMENT_FAILURE_CODES[failure]
        if (
            value.get("failure") != failure
            or value.get("errorCode") != expected_code
            or value.get("typed") is not True
            or value.get("terminal") is not True
            or value.get("partialPlaintextBytes") != 0
        ):
            raise ChatAttachmentDriverError(
                f"{failure} did not fail closed with {expected_code}"
            )
        return {
            "errorCode": expected_code,
            "typed": True,
            "terminal": True,
            "partialPlaintextBytes": 0,
        }

    @staticmethod
    def _validate_restart(
        target: str,
        outcome: Mapping[str, Any],
        corpus: Mapping[str, Any],
    ) -> Mapping[str, Any]:
        value = _mapping(outcome, f"{target} restart")
        if (
            value.get("target") != target
            or value.get("checkpointSurvived") is not True
            or value.get("openedSha256") != corpus["sha256"]
        ):
            raise ChatAttachmentDriverError(
                f"{target} restart did not preserve the attachment checkpoint"
            )
        return {
            "checkpointSurvived": True,
            "openedSha256": corpus["sha256"],
        }

    @staticmethod
    def _validate_recovery(
        outcome: Mapping[str, Any],
        corpus: Mapping[str, Any],
    ) -> Mapping[str, Any]:
        value = _mapping(outcome, "fresh recovery")
        if (
            value.get("freshStorageIdentity") is not True
            or value.get("historicalGrantRecovered") is not True
            or value.get("openedSha256") != corpus["sha256"]
        ):
            raise ChatAttachmentDriverError(
                "fresh recovery did not restore the historical attachment grant"
            )
        return {
            "freshStorageIdentity": True,
            "historicalGrantRecovered": True,
            "openedSha256": corpus["sha256"],
        }

    @staticmethod
    def _validate_revocation(
        outcome: Mapping[str, Any],
        corpus: Mapping[str, Any],
    ) -> Mapping[str, Any]:
        value = _mapping(outcome, "removed actor")
        if (
            value.get("historicalOpenedSha256") != corpus["sha256"]
            or value.get("newGrantCreated") is not False
            or value.get("postRemovalOpenErrorCode")
            != "ATTACHMENT_TRANSFER_ERROR_CODE_NOT_GRANTED"
            or value.get("partialPlaintextBytes") != 0
        ):
            raise ChatAttachmentDriverError(
                "removed actor grant behavior differs from MP-G13"
            )
        return {
            "historicalOpenedSha256": corpus["sha256"],
            "newGrantCreated": False,
            "postRemovalOpenErrorCode": (
                "ATTACHMENT_TRANSFER_ERROR_CODE_NOT_GRANTED"
            ),
            "partialPlaintextBytes": 0,
        }

    def _validate_secrecy(
        self,
        outcome: Mapping[str, Any],
    ) -> Mapping[str, Any]:
        value = _mapping(outcome, "secrecy scan")
        fields = value.get("inspectedFields")
        if (
            not isinstance(fields, list)
            or set(fields) != SECRECY_FIELDS
            or value.get("stationRowLeakCount") != 0
            or value.get("stationLogLeakCount") != 0
            or (
                self.platform in {"ios", "android"}
                and value.get("clientCrossAccountPlaintextLeakCount") != 0
            )
        ):
            raise ChatAttachmentDriverError(
                "MP-J11 secrecy scan found unproven or leaked private material"
            )
        return {
            "inspectedFields": sorted(SECRECY_FIELDS),
            "stationRowLeakCount": 0,
            "stationLogLeakCount": 0,
            **(
                {"clientCrossAccountPlaintextLeakCount": 0}
                if self.platform in {"ios", "android"}
                else {}
            ),
        }
