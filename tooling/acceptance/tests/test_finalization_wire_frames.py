"""Synthetic admission tests for bundle work and supervisor scalar frames."""

from __future__ import annotations

import base64
import unittest

from tooling.acceptance.core import finalization_contracts as contracts
from tooling.acceptance.tests import test_finalization_authority_persistence as persistence
from tooling.acceptance.tests import test_finalization_execution_contracts as execution
from tooling.acceptance.tests import test_finalization_maintenance_contracts as maintenance
from tooling.acceptance.tests import test_finalization_runtime_capture as capture


class FinalizationWireFrameTests(unittest.TestCase):
    def identity(self, *, sequence=1):
        owners = (
            contracts.RepositoryRootOwnerBinding(
                "0123456789abcdef", "synthetic-commit", "a" * 64, "b" * 64
            ),
            contracts.TemporaryDirectoryOwnerBinding("session", "request", "nonce"),
        )
        payload = {
            "sourceInventory": [["source.py", "c" * 64]],
            "entrypoint": "source.main",
            "fileLimit": 64,
            "pathByteLimit": 512,
            "manifestByteLimit": 256 * 1024,
            "entryByteLimit": 8 * 1024 * 1024,
            "bundleByteLimit": 64 * 1024 * 1024,
            "expandedByteLimit": 64 * 1024 * 1024,
            "temporaryStorageByteLimit": 128 * 1024 * 1024,
            "timeoutSeconds": 60,
        }
        return contracts.WorkerRequestIdentity.create(
            supervisor_session_id="session", request_id="request", sequence=sequence,
            worker_kind=contracts.WorkerKind.BUNDLE_PREPARER,
            descriptor_claims=tuple(
                contracts.DescriptorClaim.create(
                    device_id="1", inode=str(index + 2), owner_binding=owner
                )
                for index, owner in enumerate(owners)
            ),
            request_payload_digest=contracts.domain_separated_sha256(
                "pt.acceptance.finalization.worker-request.v1", payload
            ),
        )

    def request(self):
        return contracts.PrepareBundleRequest(
            self.identity(), (("source.py", "c" * 64),), "source.main"
        )

    def signed_frame(self, payload):
        return {
            **payload,
            "frameDigest": contracts.domain_separated_sha256(
                "pt.acceptance.finalization.supervisor-control-frame.v1", payload
            ),
        }

    def decode(self, payload, *, ancillary=False, expected_identity=None):
        return contracts.supervisor_scalar_frame_from_bytes(
            contracts.canonical_json_bytes(self.signed_frame(payload)),
            ancillary=ancillary, expected_identity=expected_identity,
        )

    def result(self, *, status="COMPLETED", identity=None):
        value = {
            "identity": (identity or self.identity()).to_dict(),
            "status": status,
            "captureId": "capture" if status == "COMPLETED" else None,
            "sourceCaptureBundleDigest": "d" * 64 if status == "COMPLETED" else None,
            "expandedInventory": [["source.py", "c" * 64, 10]] if status == "COMPLETED" else [],
            "failureCode": None if status == "COMPLETED" else "FINALIZER_BUNDLE_INVALID",
            "diagnostic": None if status == "COMPLETED" else "bundle rejected",
        }
        return self.resign_result(value)

    def resign_result(self, value):
        payload = dict(value)
        payload.pop("workerResultDigest", None)
        return {
            **payload, "workerResultDigest": contracts.domain_separated_sha256(
                "pt.acceptance.finalization.worker-result.v1", payload
            ),
        }

    def test_bundle_request_roundtrip_and_limits(self):
        request = self.request()
        self.assertEqual(contracts.PrepareBundleRequest.from_dict(request.to_dict()), request)
        for key in request.to_dict():
            invalid = request.to_dict()
            invalid.pop(key)
            with self.subTest(missing=key), self.assertRaises(ValueError):
                contracts.PrepareBundleRequest.from_dict(invalid)
        for key, value in (
            ("timeoutSeconds", True), ("timeoutSeconds", 61), ("fileLimit", 63),
            ("sourceInventory", [["../source.py", "c" * 64]]),
            ("sourceInventory", [["source.py", "c" * 64]] * 65),
            ("entrypoint", "source.other"), ("credentials", "secret"),
        ):
            invalid = {**request.to_dict(), key: value}
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                contracts.PrepareBundleRequest.from_dict(invalid)

    def test_bundle_result_branches_and_request_correlation(self):
        request = self.request()
        for status, result_type in (
            ("COMPLETED", contracts.BundlePreparationCompleted),
            ("FAILED", contracts.BundlePreparationFailed),
        ):
            result = contracts.bundle_preparation_result_from_dict(self.result(status=status), request)
            self.assertIs(type(result), result_type)
            self.assertEqual(result.to_dict(), self.result(status=status))
            for key in result.to_dict():
                invalid = result.to_dict()
                invalid.pop(key)
                with self.subTest(status=status, missing=key), self.assertRaises(ValueError):
                    contracts.bundle_preparation_result_from_dict(invalid, request)
        mutations = (
            {"failureCode": "FINALIZER_TIMED_OUT"},
            {"diagnostic": "unexpected"},
            {"expandedInventory": [["source.py", "e" * 64, 10]]},
            {"expandedInventory": [["other.py", "c" * 64, 10]]},
            {"expandedInventory": [["source.py", "c" * 64, True]]},
            {"expandedInventory": [["source.py", "c" * 64, 8 * 1024 * 1024 + 1]]},
            {"expandedInventory": [["source.py", "c" * 64, 10]] * 2},
            {"artifactRoot": "/tmp"},
        )
        for mutation in mutations:
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                contracts.bundle_preparation_result_from_dict(
                    self.resign_result({**self.result(), **mutation}), request
                )
        with self.assertRaises(ValueError):
            contracts.bundle_preparation_result_from_dict(self.result(identity=self.identity(sequence=2)), request)
        for code in ("FINALIZER_RUNTIME_MISMATCH", "FINALIZER_CANCELLED"):
            with self.subTest(code=code), self.assertRaises(ValueError):
                contracts.bundle_preparation_result_from_dict(
                    self.resign_result({**self.result(status="FAILED"), "failureCode": code}), request
                )

    def frame_payloads(self):
        identity = self.identity().to_dict()
        digests = [claim.descriptor_claim_digest for claim in self.identity().descriptor_claims]
        shared = {"identity": identity}
        return (
            {"frameType": "SUPERVISOR_READY", "supervisorSessionId": "session", "supervisorRuntimeDigest": "f" * 64, "protocolVersion": 1},
            {"frameType": "DESCRIPTOR_TRANSFER", **shared, "descriptorClaimDigests": digests},
            {"frameType": "REQUEST_ACCEPTED", **shared, "acceptedDescriptorClaimDigests": digests},
            {"frameType": "WORKER_ARMED", **shared, "pid": 100, "pgid": 100, "timerKind": "ITIMER_REAL", "timerSeconds": 60},
            {"frameType": "WORKER_READY", **shared, "validatedDescriptorClaimDigests": digests, "timerRemainingMicros": 59000000},
            {"frameType": "WORKER_DIAGNOSTIC", **shared, "stream": "STDOUT", "chunkSequence": 1, "chunkBase64": "YWJj", "finalChunk": False},
            {"frameType": "WORKER_EXITED", **shared, "exitCode": 0},
            {"frameType": "WORKER_SIGNALED", **shared, "signalNumber": 9},
            {"frameType": "WORKER_TIMEOUT", **shared, "deadlineOwner": "CHILD_ITIMER_REAL"},
            {"frameType": "WORKER_CANCELLED", **shared, "reason": "SESSION_CLOSE"},
            {"frameType": "WORKER_CANCEL_REQUEST", **shared, "reason": "ORCHESTRATOR_CANCEL"},
            {"frameType": "SUPERVISOR_CLOSE", "supervisorSessionId": "session", "lastSequence": 1},
            {"frameType": "SUPERVISOR_CLOSE_ACK", "supervisorSessionId": "session", "lastSequence": 1, "allWorkersReaped": True},
        )

    def test_all_scalar_branches_roundtrip_and_closed_fields(self):
        for payload in self.frame_payloads():
            ancillary = payload["frameType"] == "DESCRIPTOR_TRANSFER"
            with self.subTest(frame=payload["frameType"]):
                frame = self.decode(payload, ancillary=ancillary)
                self.assertEqual(frame.to_dict(), self.signed_frame(payload))
                for key in payload:
                    invalid = dict(payload)
                    invalid.pop(key)
                    with self.subTest(missing=key), self.assertRaises(ValueError):
                        self.decode(invalid, ancillary=ancillary)
                with self.assertRaises(ValueError):
                    self.decode({**payload, "foreign": None}, ancillary=ancillary)
                if "identity" in payload:
                    with self.assertRaises(ValueError):
                        self.decode(payload, ancillary=ancillary, expected_identity=self.identity(sequence=2))
                wire = self.signed_frame(payload)
                wire["frameDigest"] = "0" * 64
                with self.assertRaises(ValueError):
                    contracts.supervisor_scalar_frame_from_bytes(
                        contracts.canonical_json_bytes(wire), ancillary=ancillary
                    )

    def test_channels_and_canonical_wire_rejection(self):
        for payload in self.frame_payloads():
            with self.subTest(frame=payload["frameType"]), self.assertRaises(ValueError):
                self.decode(payload, ancillary=payload["frameType"] != "DESCRIPTOR_TRANSFER")
        for wire in (
            b"", b"\xff", b"{}", b"[]", b'{"frameType":"SUPERVISOR_READY","frameType":"SUPERVISOR_READY"}',
            b" " + contracts.canonical_json_bytes(self.signed_frame(self.frame_payloads()[0])),
            b"x" * 2097153,
        ):
            with self.subTest(wire_length=len(wire)), self.assertRaises(ValueError):
                contracts.supervisor_scalar_frame_from_bytes(wire)
        with self.assertRaises(ValueError):
            contracts.supervisor_scalar_frame_from_bytes(b"x" * 4097, ancillary=True)

    def test_timer_descriptor_and_termination_boundaries(self):
        payloads = {value["frameType"]: value for value in self.frame_payloads()}
        for frame_type, key, invalid in (
            ("SUPERVISOR_READY", "protocolVersion", True),
            ("WORKER_ARMED", "pid", True),
            ("WORKER_ARMED", "pgid", 101),
            ("WORKER_ARMED", "timerSeconds", 0),
            ("WORKER_ARMED", "timerSeconds", 61),
            ("WORKER_ARMED", "timerKind", "ITIMER_VIRTUAL"),
            ("WORKER_READY", "timerRemainingMicros", 0),
            ("WORKER_READY", "timerRemainingMicros", 60000001),
            ("WORKER_EXITED", "exitCode", True),
            ("WORKER_EXITED", "exitCode", 256),
            ("WORKER_SIGNALED", "signalNumber", 0),
            ("WORKER_TIMEOUT", "deadlineOwner", "RUNNER"),
            ("WORKER_CANCEL_REQUEST", "reason", "operator"),
            ("SUPERVISOR_CLOSE", "lastSequence", -1),
            ("SUPERVISOR_CLOSE_ACK", "allWorkersReaped", 1),
            ("REQUEST_ACCEPTED", "acceptedDescriptorClaimDigests", []),
            ("DESCRIPTOR_TRANSFER", "descriptorClaimDigests", list(reversed(payloads["DESCRIPTOR_TRANSFER"]["descriptorClaimDigests"]))),
        ):
            with self.subTest(frame=frame_type, key=key), self.assertRaises(ValueError):
                self.decode(
                    {**payloads[frame_type], key: invalid},
                    ancillary=frame_type == "DESCRIPTOR_TRANSFER",
                )

    def request_frame(self):
        payload = {
            "frameType": "WORKER_REQUEST", "identity": self.identity().to_dict(),
            "request": self.request().to_dict(),
        }
        return contracts.WorkerRequestFrame.from_dict(self.signed_frame(payload))

    def result_frame(self):
        payload = {
            "frameType": "WORKER_RESULT", "identity": self.identity().to_dict(),
            "result": self.result(),
        }
        return contracts.WorkerResultFrame.from_dict(
            self.signed_frame(payload), request=self.request()
        )

    def session(self, *, phase="WORKER_READY"):
        session = contracts.SupervisorSession("session", "f" * 64)
        payloads = {value["frameType"]: value for value in self.frame_payloads()}
        session.accept(self.decode(payloads["SUPERVISOR_READY"]))
        if phase == "READY":
            return session
        session.accept(self.request_frame())
        if phase == "REQUEST_SENT":
            return session
        for frame_type, next_phase in (
            ("DESCRIPTOR_TRANSFER", "DESCRIPTORS_SENT"),
            ("REQUEST_ACCEPTED", "ACCEPTED"),
            ("WORKER_ARMED", "ARMED"),
            ("WORKER_READY", "WORKER_READY"),
        ):
            session.accept(self.decode(payloads[frame_type], ancillary=frame_type == "DESCRIPTOR_TRANSFER"))
            if phase == next_phase:
                return session
        raise AssertionError("invalid test phase")

    def test_bundle_frame_inner_outer_identity(self):
        self.assertEqual(self.request_frame().request, self.request())
        self.assertEqual(self.result_frame().result.to_dict(), self.result())
        for frame in (self.request_frame(), self.result_frame()):
            wire = frame.to_dict()
            wire["identity"] = self.identity(sequence=2).to_dict()
            wire = self.signed_frame({key: value for key, value in wire.items() if key != "frameDigest"})
            with self.subTest(frame=frame.frame_type), self.assertRaises(ValueError):
                if frame.frame_type == "WORKER_REQUEST":
                    contracts.WorkerRequestFrame.from_dict(wire)
                else:
                    contracts.WorkerResultFrame.from_dict(wire, request=self.request())

    def union_requests(self):
        wires, references = maintenance.request_wires()
        fixtures = execution.ExecutionContractsTests()
        return (
            self.request(), capture.request(), fixtures.materialize_request(),
            fixtures.execution_request(), persistence.request(),
            *(contracts.maintenance_request_from_dict(wire, **references) for wire in wires),
        ), references

    def test_worker_union_all_kinds_and_maintenance_operations(self):
        requests, references = self.union_requests()
        self.assertEqual({item.identity.worker_kind for item in requests}, set(contracts.WorkerKind))
        for request in requests:
            with self.subTest(kind=request.identity.worker_kind, request=type(request).__name__):
                payload = {
                    "frameType": "WORKER_REQUEST", "identity": request.identity.to_dict(),
                    "request": request.to_dict(),
                }
                wire = contracts.canonical_json_bytes(self.signed_frame(payload))
                frame = contracts.supervisor_control_frame_from_bytes(
                    wire, expected_identity=request.identity, **references,
                )
                self.assertIs(type(frame), contracts.WorkerRequestFrame)
                self.assertEqual(frame.request, request)
                self.assertEqual(
                    contracts.worker_request_from_dict(request.to_dict(), **references), request,
                )
                session = contracts.SupervisorSession(request.identity.supervisor_session_id, "f" * 64)
                session.accept(contracts.supervisor_control_frame_from_bytes(
                    contracts.canonical_json_bytes(self.signed_frame({
                        "frameType": "SUPERVISOR_READY",
                        "supervisorSessionId": request.identity.supervisor_session_id,
                        "supervisorRuntimeDigest": "f" * 64, "protocolVersion": 1,
                    })),
                ))
                session.accept(frame)
                claims = [claim.descriptor_claim_digest for claim in request.identity.descriptor_claims]
                if claims:
                    session.accept(self.decode({
                        "frameType": "DESCRIPTOR_TRANSFER", "identity": request.identity.to_dict(),
                        "descriptorClaimDigests": claims,
                    }, ancillary=True))
                session.accept(self.decode({
                    "frameType": "REQUEST_ACCEPTED", "identity": request.identity.to_dict(),
                    "acceptedDescriptorClaimDigests": claims,
                }))
                timeout = 30 if type(request) is contracts.DeleteTombstoneBatchRequest else 60
                self.assertEqual(contracts.worker_timeout_seconds(request), timeout)
                session.accept(self.decode({
                    "frameType": "WORKER_ARMED", "identity": request.identity.to_dict(),
                    "pid": 123, "pgid": 123, "timerKind": "ITIMER_REAL", "timerSeconds": timeout,
                }))
                session.accept(self.decode({
                    "frameType": "WORKER_READY", "identity": request.identity.to_dict(),
                    "validatedDescriptorClaimDigests": claims, "timerRemainingMicros": timeout * 1000000,
                }))
                session.accept(self.decode({
                    "frameType": "WORKER_CANCEL_REQUEST", "identity": request.identity.to_dict(),
                    "reason": "ORCHESTRATOR_CANCEL",
                }))
                session.accept(self.decode({
                    "frameType": "WORKER_CANCELLED", "identity": request.identity.to_dict(),
                    "reason": "ORCHESTRATOR_CANCEL",
                }))
                self.assertEqual((session.state, session.next_sequence), ("READY", 2))
                with self.assertRaises(ValueError):
                    session.accept(frame)
                self.assertEqual(session.state, "FAILED")

    def test_worker_result_union_request_correlation_and_control_channel(self):
        fixtures = execution.ExecutionContractsTests()
        materializer = fixtures.materialize_request()
        finalizer = fixtures.execution_request()
        runtime = capture.request()
        persister = persistence.request()
        result_pairs = (
            (self.request(), self.result()),
            (runtime, capture.completed(runtime)),
            (runtime, capture.failed(runtime)),
            (materializer, fixtures.completed(materializer, "snapshot", execution.fixtures.snapshot().to_dict())),
            (finalizer, fixtures.completed(finalizer, "childOutcome", fixtures.child_outcome(finalizer))),
            *((persister, persistence.result_wire(persister, status))
              for status in ("COMPLETED", "FAILED", "REJECTED")),
        )
        for request, result in result_pairs:
            with self.subTest(kind=request.identity.worker_kind, status=result["status"]):
                payload = {
                    "frameType": "WORKER_RESULT", "identity": request.identity.to_dict(), "result": result,
                }
                wire = contracts.canonical_json_bytes(self.signed_frame(payload))
                frame = contracts.supervisor_control_frame_from_bytes(
                    wire, request=request, expected_identity=request.identity,
                )
                self.assertEqual(frame.result.to_dict(), result)
                self.assertEqual(contracts.worker_result_from_dict(result, request), frame.result)
                for other in (None, object(), self.request(), finalizer):
                    if type(other) is type(request) and getattr(other, "identity", None) == request.identity:
                        continue
                    with self.subTest(other=type(other).__name__), self.assertRaises(ValueError):
                        contracts.supervisor_control_frame_from_bytes(wire, request=other)
                with self.assertRaises(ValueError):
                    contracts.supervisor_control_frame_from_bytes(
                        wire, request=request, expected_identity=self.identity(sequence=2),
                    )
        for wire in (
            b"", b" " * 2097153, b'{"frameType":"WORKER_REQUEST","frameType":"WORKER_RESULT"}',
            contracts.canonical_json_bytes(self.signed_frame(next(
                item for item in self.frame_payloads() if item["frameType"] == "DESCRIPTOR_TRANSFER"
            ))),
        ):
            with self.subTest(wire_length=len(wire)), self.assertRaises(ValueError):
                contracts.supervisor_control_frame_from_bytes(wire)

    def test_session_complete_and_close_once(self):
        session = self.session()
        session.accept(self.result_frame())
        self.assertEqual(session.phase, "RESULT_RECEIVED")
        session.accept(self.decode(next(value for value in self.frame_payloads() if value["frameType"] == "WORKER_EXITED")))
        self.assertEqual((session.state, session.next_sequence, session.request), ("READY", 2, None))
        for frame_type, expected in (("SUPERVISOR_CLOSE", "CLOSING"), ("SUPERVISOR_CLOSE_ACK", "CLOSED")):
            session.accept(self.decode(next(value for value in self.frame_payloads() if value["frameType"] == frame_type)))
            self.assertEqual(session.state, expected)
        session.accept_eof()
        with self.assertRaises(ValueError):
            session.accept(self.decode(self.frame_payloads()[0]))
        self.assertEqual(session.state, "FAILED")

    def test_descriptor_free_session_success_and_failure_close_projection(self):
        fixture = execution.ExecutionContractsTests()
        request = fixture.execution_request()
        identity = request.identity.to_dict()
        session = contracts.SupervisorSession(request.identity.supervisor_session_id, "f" * 64)
        payloads = (
            {"frameType": "SUPERVISOR_READY", "supervisorSessionId": request.identity.supervisor_session_id,
             "supervisorRuntimeDigest": "f" * 64, "protocolVersion": 1},
            {"frameType": "WORKER_REQUEST", "identity": identity, "request": request.to_dict()},
            {"frameType": "REQUEST_ACCEPTED", "identity": identity, "acceptedDescriptorClaimDigests": []},
            {"frameType": "WORKER_ARMED", "identity": identity, "pid": 123, "pgid": 123,
             "timerKind": "ITIMER_REAL", "timerSeconds": 60},
            {"frameType": "WORKER_READY", "identity": identity,
             "validatedDescriptorClaimDigests": [], "timerRemainingMicros": 59999999},
            {"frameType": "WORKER_RESULT", "identity": identity,
             "result": fixture.completed(request, "childOutcome", fixture.child_outcome(request))},
            {"frameType": "WORKER_EXITED", "identity": identity, "exitCode": 0},
        )
        for payload in payloads:
            session.accept(contracts.supervisor_control_frame_from_bytes(
                contracts.canonical_json_bytes(self.signed_frame(payload)), request=request,
            ))
        self.assertEqual((session.state, session.next_sequence), ("READY", 2))
        with self.assertRaises(ValueError):
            session.accept(contracts.supervisor_control_frame_from_bytes(
                contracts.canonical_json_bytes(self.signed_frame(payloads[1])),
            ))
        for frame_type in ("SUPERVISOR_CLOSE", "SUPERVISOR_CLOSE_ACK"):
            payload = {"frameType": frame_type, "supervisorSessionId": request.identity.supervisor_session_id,
                       "lastSequence": 1}
            if frame_type == "SUPERVISOR_CLOSE_ACK":
                payload["allWorkersReaped"] = True
            session.accept(contracts.supervisor_control_frame_from_bytes(
                contracts.canonical_json_bytes(self.signed_frame(payload)),
            ))
        self.assertEqual(session.state, "CLOSED")
        self.assertTrue(session.closed_after_failure)
        self.assertEqual(session.failure_code, contracts.FinalizerFailureCode.SUPERVISOR_FAILED)
        session.accept_eof()

    def test_session_illegal_order_is_terminal(self):
        payloads = {value["frameType"]: value for value in self.frame_payloads()}
        for phase, frame in (
            ("READY", self.result_frame()),
            ("REQUEST_SENT", self.decode(payloads["REQUEST_ACCEPTED"])),
            ("DESCRIPTORS_SENT", self.decode(payloads["WORKER_READY"])),
            ("ACCEPTED", self.result_frame()),
            ("ARMED", self.decode(payloads["WORKER_DIAGNOSTIC"])),
            ("WORKER_READY", self.decode(payloads["WORKER_EXITED"])),
            ("WORKER_READY", self.decode(payloads["SUPERVISOR_CLOSE"])),
            ("WORKER_READY", self.decode(payloads["WORKER_CANCELLED"])),
        ):
            session = self.session(phase=phase)
            with self.subTest(phase=phase, frame=frame.frame_type), self.assertRaises(ValueError):
                session.accept(frame)
            self.assertEqual(session.state, "FAILED")

    def test_session_cancellation_and_failure_reap(self):
        payloads = {value["frameType"]: value for value in self.frame_payloads()}
        session = self.session()
        session.accept(self.decode(payloads["WORKER_CANCEL_REQUEST"]))
        session.accept(self.decode({**payloads["WORKER_CANCELLED"], "reason": "ORCHESTRATOR_CANCEL"}))
        self.assertEqual((session.state, session.next_sequence), ("READY", 2))
        session = self.session()
        session.accept(self.decode(payloads["WORKER_CANCEL_REQUEST"]))
        with self.assertRaises(ValueError):
            session.accept(self.result_frame())
        with self.assertRaises(ValueError):
            session.acknowledge_reaped_after_failure(self.identity(sequence=2))
        self.assertIsNotNone(session.request)
        session.acknowledge_reaped_after_failure(self.identity())
        self.assertIsNone(session.request)
        session.accept(self.decode(payloads["SUPERVISOR_CLOSE"]))
        session.accept(self.decode(payloads["SUPERVISOR_CLOSE_ACK"]))
        session.accept_eof()
        for frame_type in ("WORKER_SIGNALED", "WORKER_TIMEOUT"):
            session = self.session(phase="ACCEPTED")
            session.accept(self.decode(payloads[frame_type]))
            self.assertEqual((session.state, session.next_sequence), ("FAILED", 2))
            self.assertEqual(
                session.failure_code,
                contracts.FinalizerFailureCode.TIMED_OUT
                if frame_type == "WORKER_TIMEOUT" else contracts.FinalizerFailureCode.PROCESS_FAILED,
            )
        session = self.session()
        with self.assertRaises(ValueError):
            session.accept_eof()
        self.assertEqual(session.state, "FAILED")

    def test_session_diagnostic_cumulative_sequence_and_final_chunk(self):
        payload = next(value for value in self.frame_payloads() if value["frameType"] == "WORKER_DIAGNOSTIC")
        chunk = base64.b64encode(b"x" * 65536).decode("ascii")
        session = self.session()
        for sequence in range(1, 5):
            session.accept(self.decode({**payload, "chunkSequence": sequence, "chunkBase64": chunk}))
        with self.assertRaises(ValueError):
            session.accept(self.decode({**payload, "chunkSequence": 5, "chunkBase64": "eA=="}))
        self.assertEqual(session.state, "FAILED")
        session = self.session()
        session.accept(self.decode({**payload, "finalChunk": True}))
        with self.assertRaises(ValueError):
            session.accept(self.decode({**payload, "chunkSequence": 2}))
        session = self.session()
        with self.assertRaises(ValueError):
            session.accept(self.decode({**payload, "chunkSequence": 2}))

    def test_diagnostic_base64_and_chunk_bounds(self):
        payload = next(value for value in self.frame_payloads() if value["frameType"] == "WORKER_DIAGNOSTIC")
        for size in (0, 65536):
            valid = {**payload, "chunkBase64": base64.b64encode(b"x" * size).decode("ascii")}
            self.assertEqual(self.decode(valid).chunk_base64, valid["chunkBase64"])
        for key, invalid in (
            ("chunkBase64", base64.b64encode(b"x" * 65537).decode("ascii")),
            ("chunkBase64", "YQ==\n"), ("chunkBase64", "YR=="),
            ("chunkSequence", True), ("chunkSequence", 0),
            ("stream", "SYSTEM"), ("finalChunk", 1),
        ):
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.decode({**payload, key: invalid})


if __name__ == "__main__":
    unittest.main()
