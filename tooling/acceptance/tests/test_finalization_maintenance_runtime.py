"""Pure historical maintenance runtime identity integrity."""

from __future__ import annotations

import copy
import unittest

from tooling.acceptance.core import finalization_contracts as contracts
from tooling.acceptance.tests import test_finalization_runtime_capture as capture_fixtures


def signed_ref(payload):
    payload = {key: value for key, value in payload.items() if key != "authorityRuntimeRefDigest"}
    return {
        **payload, "authorityRuntimeRefDigest": contracts.domain_separated_sha256(
            "pt.acceptance.finalization.authority-runtime-ref.v1", payload
        ),
    }


def signed_runtime(payload):
    payload = {key: value for key, value in payload.items() if key != "maintenanceRuntimeDigest"}
    return {
        **payload, "maintenanceRuntimeDigest": contracts.domain_separated_sha256(
            "pt.acceptance.finalization.maintenance-runtime.v1", payload
        ),
    }


def runtime_wire():
    captured = capture_fixtures.completed(capture_fixtures.request())
    sources = [["tooling/acceptance/core/finalizer_worker.py", "a" * 64, 100]]
    references = []
    for item in captured["files"]:
        references.append(signed_ref({
            "artifactKind": "acceptance-finalizer-authority-runtime-ref", "schemaVersion": 1,
            "workspaceId": "0123456789abcdef", "gateId": "synthetic-gate",
            "authorizationId": "synthetic-authorization", "kind": item["kind"],
            "moduleName": item["moduleName"], "logicalName": item["logicalName"],
            "originKind": item["originKind"], "contentSha256": item["fileSha256"],
            "byteLength": item["byteLength"],
        }))
    return signed_runtime({
        "protocolVersion": 1, "workerSourceRule": "MAINTENANCE_WORKER_SOURCE_V1",
        "workerSourceFiles": sources,
        "workerSourceDigest": contracts.domain_separated_sha256(
            "pt.acceptance.finalization.maintenance-worker-source.v1",
            {"workerSourceRule": "MAINTENANCE_WORKER_SOURCE_V1", "workerSourceFiles": sources},
        ),
        "runtimeCaptureId": captured["captureId"], "runtimeMeasurement": captured["measurement"],
        "capturedRuntimeFiles": captured["files"], "runtimeArtifacts": references,
        "runtimeCaptureBundleDigest": captured["runtimeCaptureBundleDigest"],
        "runtimeCaptureDigest": captured["runtimeCaptureDigest"],
    })


class MaintenanceRuntimeTests(unittest.TestCase):
    def test_authority_ref_closed_kind_branches(self):
        wire = runtime_wire()
        for ref in wire["runtimeArtifacts"]:
            with self.subTest(kind=ref["kind"]):
                result = contracts.AuthorityRuntimeArtifactRef.from_dict(ref)
                self.assertEqual(result.to_dict(), ref)
                for field in ref:
                    missing = dict(ref)
                    missing.pop(field)
                    with self.subTest(missing=field), self.assertRaises(ValueError):
                        contracts.AuthorityRuntimeArtifactRef.from_dict(missing)
                for field, value in (
                    ("schemaVersion", True), ("kind", "UNKNOWN"), ("contentSha256", "bad"),
                    ("byteLength", -1), ("byteLength", 256 * 1024 * 1024 + 1),
                    ("workspaceId", "bad"), ("authorizationId", "../escape"), ("path", "/tmp"),
                ):
                    changed = signed_ref({**ref, field: value})
                    with self.subTest(field=field), self.assertRaises(ValueError):
                        contracts.AuthorityRuntimeArtifactRef.from_dict(changed)
                for field, value in (
                    ("moduleName", None if ref["moduleName"] else "unexpected"),
                    ("logicalName", None if ref["logicalName"] else "unexpected"),
                    ("originKind", None if ref["originKind"] else "STANDALONE_FILE"),
                ):
                    with self.subTest(nullability=field), self.assertRaises(ValueError):
                        contracts.AuthorityRuntimeArtifactRef.from_dict(signed_ref({**ref, field: value}))

    def test_maintenance_runtime_roundtrip_and_closed_fields(self):
        wire = runtime_wire()
        result = contracts.FinalizerMaintenanceRuntimeIdentity.from_dict(wire)
        self.assertEqual(result.to_dict(), wire)
        for field in wire:
            missing = dict(wire)
            missing.pop(field)
            with self.subTest(missing=field), self.assertRaises(ValueError):
                contracts.FinalizerMaintenanceRuntimeIdentity.from_dict(missing)
        for field, value in (
            ("protocolVersion", True), ("workerSourceRule", "UNKNOWN"),
            ("workerSourceFiles", []), ("capturedRuntimeFiles", []), ("runtimeArtifacts", []),
            ("runtimeCaptureId", ""), ("workerSourceDigest", "f" * 64),
            ("runtimeCaptureDigest", "0" * 64), ("credentials", {}),
        ):
            with self.subTest(field=field), self.assertRaises(ValueError):
                contracts.FinalizerMaintenanceRuntimeIdentity.from_dict(
                    signed_runtime({**wire, field: value})
                )

    def test_resigned_artifact_identity_and_order_mismatch(self):
        wire = runtime_wire()
        for field, value in (
            ("authorizationId", "different-authorization"), ("workspaceId", "fedcba9876543210"),
            ("gateId", "different-gate"), ("contentSha256", "0" * 64), ("byteLength", 11),
        ):
            with self.subTest(field=field):
                changed = copy.deepcopy(wire)
                changed["runtimeArtifacts"][0] = signed_ref({
                    **changed["runtimeArtifacts"][0], field: value,
                })
                with self.assertRaises(ValueError):
                    contracts.FinalizerMaintenanceRuntimeIdentity.from_dict(signed_runtime(changed))
        for field in ("runtimeArtifacts", "capturedRuntimeFiles"):
            for operation in ("reverse", "remove", "duplicate"):
                with self.subTest(field=field, operation=operation):
                    changed = copy.deepcopy(wire)
                    if operation == "reverse":
                        changed[field].reverse()
                    elif operation == "remove":
                        changed[field].pop()
                    else:
                        changed[field].append(changed[field][0])
                    with self.assertRaises(ValueError):
                        contracts.FinalizerMaintenanceRuntimeIdentity.from_dict(signed_runtime(changed))

    def test_resigned_source_and_capture_closure(self):
        wire = runtime_wire()
        for sources in (
            [["tooling/acceptance/core/other.py", "a" * 64, 100]],
            wire["workerSourceFiles"] * 2,
            [["../escape.py", "a" * 64, 100]],
            [["tooling/acceptance/core/finalizer_worker.py", "a" * 64, 8 * 1024 * 1024 + 1]],
            [["tooling/acceptance/core/finalizer_worker.py", "a" * 64, True]],
        ):
            with self.subTest(sources=sources):
                changed = copy.deepcopy(wire)
                changed["workerSourceFiles"] = sources
                changed["workerSourceDigest"] = contracts.domain_separated_sha256(
                    "pt.acceptance.finalization.maintenance-worker-source.v1",
                    {"workerSourceRule": changed["workerSourceRule"], "workerSourceFiles": sources},
                )
                with self.assertRaises(ValueError):
                    contracts.FinalizerMaintenanceRuntimeIdentity.from_dict(signed_runtime(changed))
        changed = copy.deepcopy(wire)
        changed["capturedRuntimeFiles"][0]["fileSha256"] = "0" * 64
        changed["runtimeArtifacts"][0] = signed_ref({
            **changed["runtimeArtifacts"][0], "contentSha256": "0" * 64,
        })
        changed["runtimeCaptureDigest"] = contracts.domain_separated_sha256(
            "pt.acceptance.finalization.runtime-capture.v1",
            {"captureId": changed["runtimeCaptureId"], "measurement": changed["runtimeMeasurement"],
             "files": changed["capturedRuntimeFiles"],
             "runtimeCaptureBundleDigest": changed["runtimeCaptureBundleDigest"]},
        )
        with self.assertRaises(ValueError):
            contracts.FinalizerMaintenanceRuntimeIdentity.from_dict(signed_runtime(changed))


if __name__ == "__main__":
    unittest.main()
