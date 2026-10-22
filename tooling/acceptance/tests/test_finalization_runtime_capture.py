from __future__ import annotations

import copy
import unittest

from tooling.acceptance.core import finalization_contracts as contracts
from tooling.acceptance.tests.test_finalization_runtime_measurement import measurement, paths


def request():
    payload = {
        "runtimePaths": [item.to_dict() for item in paths()],
        "measurementBasis": contracts.RuntimeMeasurementBasis.from_measurement(
            measurement()
        ).to_dict(),
        "fileLimit": 1024,
        "singleFileByteLimit": 256 * 1024 * 1024,
        "cumulativeByteLimit": 512 * 1024 * 1024,
        "timeoutSeconds": 60,
    }
    identity = contracts.WorkerRequestIdentity.create(
        supervisor_session_id="session", request_id="request", sequence=1,
        worker_kind=contracts.WorkerKind.RUNTIME_CAPTURE,
        descriptor_claims=(contracts.DescriptorClaim.create(
            device_id="1", inode="2",
            owner_binding=contracts.TemporaryDirectoryOwnerBinding("session", "request", "nonce"),
        ),),
        request_payload_digest=contracts.domain_separated_sha256(
            "pt.acceptance.finalization.worker-request.v1", payload
        ),
    )
    return contracts.CaptureRuntimeRequest.from_dict({"identity": identity.to_dict(), **payload})


def sign_result(payload):
    payload = dict(payload)
    payload.pop("workerResultDigest", None)
    return {
        **payload,
        "workerResultDigest": contracts.domain_separated_sha256(
            "pt.acceptance.finalization.worker-result.v1", payload
        ),
    }


def resign_capture(payload):
    payload = dict(payload)
    capture = {key: payload[key] for key in (
        "captureId", "measurement", "files", "runtimeCaptureBundleDigest",
    )}
    payload["runtimeCaptureDigest"] = contracts.domain_separated_sha256(
        "pt.acceptance.finalization.runtime-capture.v1", capture
    )
    return sign_result(payload)


def completed(req):
    measured = measurement()
    source_hashes = {
        contracts.RuntimePathKind.COMPILER_BINARY: "c" * 64,
        contracts.RuntimePathKind.PYTHON_EXECUTABLE: "d" * 64,
        contracts.RuntimePathKind.SUPERVISOR_BINARY: "b" * 64,
        contracts.RuntimePathKind.STDLIB_MODULE: "e" * 64,
    }
    files = tuple(sorted((
        *(contracts.CapturedRuntimeFile.create(
            kind=contracts.RuntimeFileKind(item.kind.value),
            module_name=item.module_name,
            path_hash=item.expected_path_hash,
            file_sha256=source_hashes[item.kind], byte_length=10,
        ) for item in req.runtime_paths),
        contracts.CapturedRuntimeFile.create(
            kind=contracts.RuntimeFileKind.LOADED_RUNTIME_IMAGE,
            logical_name="dynamic-loader",
            origin_kind=contracts.RuntimeImageOriginKind.STANDALONE_FILE,
            path_hash="a" * 64, file_sha256="b" * 64, byte_length=20,
        ),
    ), key=lambda item: item.identity_key))
    return resign_capture({
        "identity": req.identity.to_dict(), "status": "COMPLETED",
        "captureId": "capture", "measurement": measured.to_dict(),
        "files": [item.to_dict() for item in files],
        "runtimeCaptureBundleDigest": "f" * 64, "failureCode": None, "diagnostic": None,
    })


def failed(req, failure_code="FINALIZER_RUNTIME_MISMATCH"):
    return sign_result({
        "identity": req.identity.to_dict(), "status": "FAILED",
        "captureId": None, "measurement": None, "files": [],
        "runtimeCaptureBundleDigest": None, "runtimeCaptureDigest": None,
        "failureCode": failure_code, "diagnostic": "runtime rejected",
    })


class RuntimeCaptureContractTest(unittest.TestCase):
    def test_request_binds_static_measurement_basis(self):
        basis = request().to_dict()["measurementBasis"]
        self.assertEqual(set(basis), {
            "supervisorSourcePath", "supervisorSourceFileSha256",
            "supervisorBuildIdentity", "protocolVersion",
            "stdlibModules", "coreBootstrapSourceDigest",
        })

    def test_request_closed_fields_fixed_limits_and_exact_inputs(self):
        req = request()
        self.assertEqual(contracts.CaptureRuntimeRequest.from_dict(req.to_dict()), req)
        for field in req.to_dict():
            invalid = req.to_dict()
            invalid.pop(field)
            with self.subTest(missing=field), self.assertRaises(ValueError):
                contracts.CaptureRuntimeRequest.from_dict(invalid)
        for field, value in (
            ("fileLimit", 1025), ("timeoutSeconds", True),
            ("singleFileByteLimit", 1), ("cumulativeByteLimit", 1),
            ("runtimePaths", []),
            ("runtimePaths", list(reversed(req.to_dict()["runtimePaths"]))),
            ("credentials", {}),
        ):
            with self.subTest(field=field), self.assertRaises(ValueError):
                contracts.CaptureRuntimeRequest.from_dict({**req.to_dict(), field: value})

    def test_result_branches_and_all_fields_are_closed(self):
        req = request()
        for value, expected_type in (
            (completed(req), contracts.CaptureRuntimeCompleted),
            (failed(req), contracts.CaptureRuntimeFailed),
        ):
            result = contracts.capture_runtime_result_from_dict(value, req)
            self.assertIs(type(result), expected_type)
            self.assertEqual(result.to_dict(), value)
            for field in value:
                invalid = dict(value)
                invalid.pop(field)
                with self.subTest(status=value["status"], missing=field), self.assertRaises(ValueError):
                    contracts.capture_runtime_result_from_dict(invalid, req)
            with self.assertRaises(ValueError):
                contracts.capture_runtime_result_from_dict({**value, "artifactRef": {}}, req)

    def test_complete_capture_digest_and_measurement_file_correlations(self):
        req = request()
        valid = completed(req)
        for mutation in (
            lambda value: value["files"].pop(),
            lambda value: value["files"].reverse(),
            lambda value: value["files"].append(value["files"][0]),
            lambda value: value["files"][0].update(fileSha256="a" * 64),
            lambda value: value["files"][0].update(pathHash="a" * 64),
            lambda value: value["files"][0].update(byteLength=256 * 1024 * 1024 + 1),
            lambda value: value["files"][1].update(logicalName="other-loader"),
            lambda value: value.update(runtimeCaptureDigest="a" * 64),
            lambda value: value.update(captureId="another-capture"),
        ):
            invalid = copy.deepcopy(valid)
            mutation(invalid)
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                contracts.capture_runtime_result_from_dict(sign_result(invalid), req)
        for field, altered in (("fileSha256", "a" * 64), ("pathHash", "a" * 64)):
            invalid = copy.deepcopy(valid)
            invalid["files"][0][field] = altered
            with self.subTest(resigned=field), self.assertRaises(ValueError):
                contracts.capture_runtime_result_from_dict(resign_capture(invalid), req)
        for mutation in (
            lambda value: value["files"].pop(),
            lambda value: value["files"].reverse(),
            lambda value: value["files"].append(value["files"][0]),
            lambda value: value["files"][1].update(logicalName="other-loader"),
            lambda value: value["files"][0].update(byteLength=256 * 1024 * 1024 + 1),
            lambda value: value["files"][2].update(pathHash="a" * 64),
        ):
            invalid = copy.deepcopy(valid)
            mutation(invalid)
            with self.subTest(resigned_mutation=mutation), self.assertRaises(ValueError):
                contracts.capture_runtime_result_from_dict(resign_capture(invalid), req)

    def test_failure_codes_null_fields_and_request_identity(self):
        req = request()
        for code in (
            "FINALIZER_RUNTIME_MISMATCH", "FINALIZER_TIMED_OUT", "FINALIZER_PROCESS_FAILED",
        ):
            self.assertEqual(
                contracts.capture_runtime_result_from_dict(failed(req, code), req).failure_code.value,
                code,
            )
        for field, value in (
            ("captureId", "forbidden"), ("measurement", measurement().to_dict()),
            ("files", [{}]), ("runtimeCaptureBundleDigest", "a" * 64),
            ("runtimeCaptureDigest", "a" * 64), ("diagnostic", ""),
            ("diagnostic", "x" * 4097), ("failureCode", "FINALIZER_OUTPUT_INVALID"),
            ("status", "OTHER"),
        ):
            invalid = failed(req)
            invalid[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                contracts.capture_runtime_result_from_dict(sign_result(invalid), req)
        changed_identity = contracts.WorkerRequestIdentity.create(
            supervisor_session_id=req.identity.supervisor_session_id,
            request_id=req.identity.request_id, sequence=2,
            worker_kind=req.identity.worker_kind,
            descriptor_claims=req.identity.descriptor_claims,
            request_payload_digest=req.identity.request_payload_digest,
        )
        for result in (completed(req), failed(req)):
            invalid = {**result, "identity": changed_identity.to_dict()}
            with self.subTest(status=result["status"]), self.assertRaises(ValueError):
                contracts.capture_runtime_result_from_dict(sign_result(invalid), req)
