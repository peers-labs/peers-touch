"""Authority persistence branch and request identity contracts."""

from __future__ import annotations

import copy
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling.acceptance.core import finalization_contracts as contracts
from tooling.acceptance.core import finalizer_worker
from tooling.acceptance.tests.test_finalization_execution_contracts import request_identity, signed_result
from tooling.acceptance.tests.test_finalization_maintenance_runtime import (
    runtime_wire,
    signed_ref,
    signed_runtime,
)
from tooling.acceptance.tests.test_finalization_durability_profiles import (
    active_observation_wire,
    profile_wire,
)
from tooling.acceptance.tests import test_finalization_store_contracts as store_fixtures


def request():
    runtime = contracts.FinalizerMaintenanceRuntimeIdentity.from_dict(runtime_wire())
    payload = {
        "workspaceId": "0123456789abcdef", "gateId": "synthetic-gate",
        "authorizationId": "synthetic-authorization", "candidateRuntime": runtime.to_dict(),
        "durabilityProfile": profile_wire(),
        "environmentObservation": active_observation_wire(),
        "expectedDurabilityProfileDigest": profile_wire()["durabilityProfileDigest"],
        "fileLimit": 1024,
        "singleFileByteLimit": 256 * 1024 * 1024,
        "cumulativeByteLimit": 512 * 1024 * 1024, "timeoutSeconds": 60,
    }
    claims = (
        contracts.DescriptorClaim.create(
            device_id="1", inode="1",
            owner_binding=contracts.GateDirectoryOwnerBinding("0123456789abcdef", "synthetic-gate"),
        ),
        contracts.DescriptorClaim.create(
            device_id="1", inode="2",
            owner_binding=contracts.TemporaryDirectoryOwnerBinding(
                "synthetic-supervisor-session", "synthetic-request", "nonce"
            ),
        ),
    )
    identity = request_identity(contracts.WorkerKind.AUTHORITY_RUNTIME_PERSISTER, payload, claims)
    return contracts.PersistAuthorityRuntimeRequest.from_dict({"identity": identity.to_dict(), **payload})


def result_wire(req, status):
    boundary, code, digest, diagnostic = {
        "COMPLETED": ("AUTHORITY_RUNTIME_DURABLE", None, req.candidate_runtime.maintenance_runtime_digest, None),
        "FAILED": ("AUTHORITY_RUNTIME_MAY_BE_DURABLE", "FINALIZER_AUTHORITY_RUNTIME_IO_FAILED",
                   req.candidate_runtime.maintenance_runtime_digest, "publication uncertain"),
        "REJECTED": ("NO_MUTATION", "FINALIZER_RUNTIME_MISMATCH", None, "runtime mismatch"),
    }[status]
    return signed_result({
        "identity": req.identity.to_dict(), "status": status, "durableBoundary": boundary,
        "maintenanceRuntimeDigest": digest, "failureCode": code, "diagnostic": diagnostic,
    })


class AuthorityPersistenceTests(unittest.TestCase):
    def live_request(self, gate: Path, temporary: Path):
        record = store_fixtures.requirement_record()
        references = tuple(
            contracts.AuthorityRuntimeArtifactRef.from_dict(
                signed_ref(
                    {
                        "artifactKind": (
                            "acceptance-finalizer-authority-runtime-ref"
                        ),
                        "schemaVersion": 1,
                        "workspaceId": record.workspace_id,
                        "gateId": record.requirement.gate_id,
                        "authorizationId": "synthetic-authorization",
                        "kind": item.kind.value,
                        "moduleName": item.module_name,
                        "logicalName": item.logical_name,
                        "originKind": (
                            None
                            if item.origin_kind is None
                            else item.origin_kind.value
                        ),
                        "contentSha256": item.file_sha256,
                        "byteLength": item.byte_length,
                    }
                )
            )
            for item in record.captured_runtime_files
        )
        source_files = (
            (
                "tooling/acceptance/core/finalizer_worker.py",
                "a" * 64,
                100,
            ),
        )
        runtime = contracts.FinalizerMaintenanceRuntimeIdentity.from_dict(
            signed_runtime(
                {
                    "protocolVersion": 1,
                    "workerSourceRule": "MAINTENANCE_WORKER_SOURCE_V1",
                    "workerSourceFiles": [list(item) for item in source_files],
                    "workerSourceDigest": contracts.domain_separated_sha256(
                        "pt.acceptance.finalization.maintenance-worker-source.v1",
                        {
                            "workerSourceRule": (
                                "MAINTENANCE_WORKER_SOURCE_V1"
                            ),
                            "workerSourceFiles": [
                                list(item) for item in source_files
                            ],
                        },
                    ),
                    "runtimeCaptureId": record.runtime_capture_id,
                    "runtimeMeasurement": (
                        record.runtime_measurement.to_dict()
                    ),
                    "capturedRuntimeFiles": [
                        item.to_dict()
                        for item in record.captured_runtime_files
                    ],
                    "runtimeArtifacts": [
                        item.to_dict() for item in references
                    ],
                    "runtimeCaptureBundleDigest": (
                        record.runtime_capture_bundle_digest
                    ),
                    "runtimeCaptureDigest": record.runtime_capture_digest,
                }
            )
        )
        profile = record.durability_profile
        capability = profile.capability_evidence
        qualified = contracts.DurabilityQualifiedEnvironment.create(
            host_build=capability.qualified_host_build,
            host_identity=capability.qualified_host_identity,
            filesystem_implementation_version=(
                capability.filesystem_implementation_version
            ),
            required_mount_options=capability.required_mount_options,
            stable_volume_identity=capability.stable_volume_identity,
            probe_runtime_digest=capability.probe_runtime_digest,
        )
        gate_stat = gate.stat()
        mount = contracts.LiveAuthorityMountBinding.create(
            os_family=contracts.RuntimeOsFamily.LINUX,
            stable_volume_identity_digest=(
                capability.stable_volume_identity.volume_identity_digest
            ),
            mount_namespace_id="mnt:[100]",
            mount_id="42",
            darwin_fsid=None,
            device_id=str(gate_stat.st_dev),
            host_build=capability.qualified_host_build,
            filesystem_implementation_version=(
                capability.filesystem_implementation_version
            ),
            mount_options=capability.required_mount_options,
            observed_at="2026-10-18T00:00:01+00:00",
        )
        boot_ref = contracts.DurabilityCapabilityArtifactRef.create(
            workspace_id=record.workspace_id,
            gate_id=record.requirement.gate_id,
            crash_fixture_id=capability.crash_fixture_id,
            artifact_name=(
                contracts.DurabilityCapabilityArtifactName.BOOT_OBSERVATION
            ),
            object_digest="a" * 64,
            content_sha256="b" * 64,
            byte_length=100,
        )
        observation = contracts.ActiveDurabilityEnvironmentObservation.create(
            qualified_environment_digest=(
                qualified.qualified_environment_digest
            ),
            host_build=capability.qualified_host_build,
            host_identity=capability.qualified_host_identity,
            filesystem_implementation_version=(
                capability.filesystem_implementation_version
            ),
            mount_options=capability.required_mount_options,
            stable_volume_identity=capability.stable_volume_identity,
            live_mount_binding=mount,
            boot_observation_ref=boot_ref,
            observed_at="2026-10-18T00:00:02+00:00",
        )
        gate_claim = contracts.DescriptorClaim.create(
            device_id=str(gate_stat.st_dev),
            inode=str(gate_stat.st_ino),
            owner_binding=contracts.GateDirectoryOwnerBinding(
                record.workspace_id,
                record.requirement.gate_id,
            ),
        )
        temporary_stat = temporary.stat()
        temporary_claim = contracts.DescriptorClaim.create(
            device_id=str(temporary_stat.st_dev),
            inode=str(temporary_stat.st_ino),
            owner_binding=contracts.TemporaryDirectoryOwnerBinding(
                "synthetic-supervisor-session",
                "synthetic-request",
                "nonce",
            ),
        )
        payload = {
            "workspaceId": record.workspace_id,
            "gateId": record.requirement.gate_id,
            "authorizationId": "synthetic-authorization",
            "candidateRuntime": runtime.to_dict(),
            "durabilityProfile": profile.to_dict(),
            "environmentObservation": observation.to_dict(),
            "expectedDurabilityProfileDigest": (
                profile.durability_profile_digest
            ),
            "fileLimit": 1024,
            "singleFileByteLimit": 256 * 1024 * 1024,
            "cumulativeByteLimit": 512 * 1024 * 1024,
            "timeoutSeconds": 60,
        }
        identity = request_identity(
            contracts.WorkerKind.AUTHORITY_RUNTIME_PERSISTER,
            payload,
            (gate_claim, temporary_claim),
        )
        request = contracts.PersistAuthorityRuntimeRequest.from_dict(
            {"identity": identity.to_dict(), **payload}
        )
        bundle = store_fixtures.capture_bundle(
            b"pt-finalizer-runtime-bundle-v1",
            {
                "captureId": record.runtime_capture_id,
                "measurement": record.runtime_measurement.to_dict(),
                "files": [
                    item.to_dict()
                    for item in record.captured_runtime_files
                ],
            },
            tuple(
                store_fixtures.runtime_bytes(
                    item.kind,
                    item.module_name,
                    item.logical_name,
                )
                for item in record.captured_runtime_files
            ),
        )
        (temporary / f"runtime-capture-{record.runtime_capture_id}.bundle").write_bytes(
            bundle
        )
        return request

    def test_request_owner_candidate_and_fixed_limits(self):
        req = request()
        self.assertEqual(contracts.PersistAuthorityRuntimeRequest.from_dict(req.to_dict()), req)
        for field, value in (
            ("workspaceId", "fedcba9876543210"), ("gateId", "another-gate"),
            ("authorizationId", "another-authority"), ("fileLimit", 1023),
            ("singleFileByteLimit", True), ("cumulativeByteLimit", 0),
            ("timeoutSeconds", 59), ("expectedDurabilityProfileDigest", "bad"),
            ("extra", None),
        ):
            with self.subTest(field=field):
                changed = req.to_dict()
                changed[field] = value
                payload = {key: item for key, item in changed.items() if key != "identity"}
                changed["identity"] = request_identity(
                    contracts.WorkerKind.AUTHORITY_RUNTIME_PERSISTER, payload, req.identity.descriptor_claims
                ).to_dict()
                with self.assertRaises(ValueError):
                    contracts.PersistAuthorityRuntimeRequest.from_dict(changed)
        changed = req.to_dict()
        claim = contracts.DescriptorClaim.create(
            device_id="1", inode="1",
            owner_binding=contracts.GateDirectoryOwnerBinding("0123456789abcdef", "another-gate"),
        )
        changed["identity"] = request_identity(
            contracts.WorkerKind.AUTHORITY_RUNTIME_PERSISTER,
            {key: item for key, item in changed.items() if key != "identity"},
            (claim, req.identity.descriptor_claims[1]),
        ).to_dict()
        with self.assertRaisesRegex(ValueError, "GATE_DIRECTORY"):
            contracts.PersistAuthorityRuntimeRequest.from_dict(changed)
        for field in req.to_dict():
            changed = req.to_dict()
            changed.pop(field)
            with self.subTest(missing=field), self.assertRaises(ValueError):
                contracts.PersistAuthorityRuntimeRequest.from_dict(changed)

    def test_result_closed_branches_and_complete_digest(self):
        req = request()
        for status, expected_type in (
            ("COMPLETED", contracts.PersistAuthorityRuntimeCompleted),
            ("FAILED", contracts.PersistAuthorityRuntimeFailed),
            ("REJECTED", contracts.PersistAuthorityRuntimeRejected),
        ):
            with self.subTest(status=status):
                wire = result_wire(req, status)
                result = contracts.persist_authority_runtime_result_from_dict(wire, req)
                self.assertIs(type(result), expected_type)
                self.assertEqual(result.to_dict(), wire)
                for field in wire:
                    changed = dict(wire)
                    changed.pop(field)
                    with self.subTest(missing=field), self.assertRaises(ValueError):
                        contracts.persist_authority_runtime_result_from_dict(changed, req)
                for field, value in (
                    ("durableBoundary", "UNKNOWN"), ("status", "INCOMPLETE"),
                    ("maintenanceRuntimeDigest", "0" * 64),
                    ("diagnostic", "a" * 4097), ("extra", None),
                ):
                    changed = signed_result({key: item for key, item in {**wire, field: value}.items()
                                             if key != "workerResultDigest"})
                    with self.subTest(field=field), self.assertRaises(ValueError):
                        contracts.persist_authority_runtime_result_from_dict(changed, req)
                changed = {**wire, "workerResultDigest": "0" * 64}
                with self.assertRaises(ValueError):
                    contracts.persist_authority_runtime_result_from_dict(changed, req)
                changed = copy.deepcopy(wire)
                identity = req.identity
                changed["identity"] = contracts.WorkerRequestIdentity.create(
                    supervisor_session_id=identity.supervisor_session_id, request_id=identity.request_id,
                    sequence=2, worker_kind=identity.worker_kind,
                    descriptor_claims=identity.descriptor_claims,
                    request_payload_digest=identity.request_payload_digest,
                ).to_dict()
                changed = signed_result({key: item for key, item in changed.items() if key != "workerResultDigest"})
                with self.assertRaises(ValueError):
                    contracts.persist_authority_runtime_result_from_dict(changed, req)

    def test_uncertain_publication_and_rejection_failure_codes(self):
        req = request()
        rejected_codes = {
            contracts.FinalizerFailureCode.RUNTIME_MISMATCH,
            contracts.FinalizerFailureCode.DURABILITY_PROFILE_UNSUPPORTED,
            contracts.FinalizerFailureCode.AUTHORITY_RUNTIME_IO_FAILED,
            contracts.FinalizerFailureCode.INPUT_TOO_LARGE,
            contracts.FinalizerFailureCode.TIMED_OUT, contracts.FinalizerFailureCode.PROCESS_FAILED,
        }
        for status in ("FAILED", "REJECTED"):
            for code in contracts.FinalizerFailureCode:
                with self.subTest(status=status, code=code):
                    wire = result_wire(req, status)
                    wire["failureCode"] = code.value
                    wire = signed_result({key: item for key, item in wire.items() if key != "workerResultDigest"})
                    allowed = (
                        code is contracts.FinalizerFailureCode.AUTHORITY_RUNTIME_IO_FAILED
                        if status == "FAILED" else code in rejected_codes
                    )
                    if allowed:
                        result = contracts.persist_authority_runtime_result_from_dict(wire, req)
                        self.assertIs(result.failure_code, code)
                    else:
                        with self.assertRaises(ValueError):
                            contracts.persist_authority_runtime_result_from_dict(wire, req)
        for status, digest in (("FAILED", None), ("COMPLETED", None),
                               ("REJECTED", req.candidate_runtime.maintenance_runtime_digest)):
            wire = result_wire(req, status)
            wire["maintenanceRuntimeDigest"] = digest
            with self.subTest(status=status), self.assertRaises(ValueError):
                contracts.persist_authority_runtime_result_from_dict(
                    signed_result({key: item for key, item in wire.items() if key != "workerResultDigest"}), req
                )

    def test_worker_persists_content_addressed_runtime_and_equal_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            gate = root / "gate"
            temporary = root / "temporary"
            gate.mkdir(mode=0o700)
            temporary.mkdir(mode=0o700)
            request = self.live_request(gate, temporary)
            gate_fd = os.open(gate, os.O_RDONLY | os.O_DIRECTORY)
            temporary_fd = os.open(
                temporary,
                os.O_RDONLY | os.O_DIRECTORY,
            )
            try:
                for _ in range(2):
                    mutation_state = [False]
                    with patch.object(finalizer_worker.sys, "platform", "linux"):
                        result = finalizer_worker._persist_authority_runtime_result(
                            request,
                            gate_fd,
                            temporary_fd,
                            deadline=time.monotonic() + 10,
                            mutation_state=mutation_state,
                        )
                    self.assertIs(
                        type(result),
                        contracts.PersistAuthorityRuntimeCompleted,
                    )
                    self.assertTrue(mutation_state[0])
            finally:
                os.close(temporary_fd)
                os.close(gate_fd)
            runtime_dir = (
                gate
                / "finalizer-enforcement"
                / "runtime"
                / "synthetic-authorization"
            )
            self.assertEqual(
                contracts.FinalizerMaintenanceRuntimeIdentity.from_dict(
                    json.loads(
                        (runtime_dir / "identity.json").read_text(
                            encoding="utf-8"
                        )
                    )
                ),
                request.candidate_runtime,
            )
            self.assertEqual(
                len(tuple(runtime_dir.glob("*.blob"))),
                len(request.candidate_runtime.runtime_artifacts),
            )


if __name__ == "__main__":
    unittest.main()
