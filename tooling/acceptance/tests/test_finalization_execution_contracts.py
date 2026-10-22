"""Request-correlated D-19 materialization and finalizer wire validation."""

from __future__ import annotations

import copy
import unittest

from tooling.acceptance.core import finalization_contracts as contracts
from tooling.acceptance.tests import test_finalization_contracts as fixtures


def signed_result(payload):
    return {
        **payload,
        "workerResultDigest": contracts.domain_separated_sha256(
            "pt.acceptance.finalization.worker-result.v1", payload
        ),
    }


def request_identity(kind, payload, claims=()):
    return contracts.WorkerRequestIdentity.create(
        supervisor_session_id="synthetic-supervisor-session",
        request_id="synthetic-request", sequence=1, worker_kind=kind,
        descriptor_claims=claims,
        request_payload_digest=contracts.domain_separated_sha256(
            "pt.acceptance.finalization.worker-request.v1", payload
        ),
    )


class ExecutionContractsTests(unittest.TestCase):
    def materialize_request(self, *, byte_limit=1024 * 1024):
        snapshot = fixtures.snapshot()
        payload = snapshot.to_dict()
        payload.pop("snapshotDigest")
        payload["artifactInventory"] = [
            contracts.ArtifactMaterializationInput.from_snapshot_artifact(item).to_dict()
            for item in snapshot.artifacts
        ]
        payload.pop("artifacts")
        payload.update(
            inputByteLimit=byte_limit, artifactCountLimit=4096,
            singleArtifactByteLimit=1024 ** 3,
            cumulativeHashByteLimit=8 * 1024 ** 3, timeoutSeconds=60,
        )
        owner = contracts.RunDirectoryOwnerBinding(
            snapshot.workspace_id, snapshot.gate_id, snapshot.evidence_run_id
        )
        claim = contracts.DescriptorClaim.create(device_id="1", inode="2", owner_binding=owner)
        identity = request_identity(contracts.WorkerKind.MATERIALIZER, payload, (claim,))
        return contracts.MaterializeSnapshotRequest.from_dict({"identity": identity.to_dict(), **payload})

    def execution_request(self):
        values = fixtures.finalizer_identity_values()
        values["config_digest"] = contracts.FinalizerExecutionConfig(
            fixtures.GATE_ID, fixtures.FINALIZER_ID, 60, 1024 * 1024
        ).digest()
        finalizer_input = contracts.FinalizerInput.create(
            invocation=contracts.FinalizerInvocationIdentity.create(**values),
            context=contracts.FinalizerContext.create(**values), snapshot=fixtures.snapshot(),
        )
        payload = {"input": finalizer_input.to_dict(), "timeoutSeconds": 60, "inputByteLimit": 1024 * 1024}
        identity = request_identity(contracts.WorkerKind.FINALIZER, payload)
        return contracts.ExecuteFinalizerRequest(identity, finalizer_input, 60, 1024 * 1024)

    def child_outcome(self, request, status=contracts.FinalizerOutcomeStatus.VALIDATED):
        invocation = request.input.invocation
        code = {
            contracts.FinalizerOutcomeStatus.VALIDATED: None,
            contracts.FinalizerOutcomeStatus.REJECTED: contracts.FinalizerFailureCode.REJECTED,
            contracts.FinalizerOutcomeStatus.BLOCKED: contracts.FinalizerFailureCode.BLOCKED,
        }[status]
        payload = {
            "status": status.value, "finalizerId": invocation.finalizer_id,
            "invocationDigest": invocation.invocation_digest,
            "finalizerInputDigest": request.input.finalizer_input_digest,
            "snapshotDigest": invocation.snapshot_digest,
            "primaryResultDigest": invocation.primary_result_digest,
            "validatedRoleInstances": (
                [list(item) for item in invocation.required_role_identities] if code is None else []
            ),
            "failureCode": None if code is None else code.value,
            "diagnostic": None if code is None else "synthetic diagnostic",
        }
        return {
            **payload, "childOutcomeDigest": contracts.domain_separated_sha256(
                "pt.acceptance.finalization.child-outcome.v1", payload
            ),
        }

    def completed(self, request, field, value):
        return signed_result({
            "identity": request.identity.to_dict(), "status": "COMPLETED",
            field: value, "failureCode": None, "diagnostic": None,
        })

    def test_materializer_request_admission(self):
        request = self.materialize_request()
        self.assertEqual(contracts.MaterializeSnapshotRequest.from_dict(request.to_dict()), request)
        wire = request.to_dict()
        for item in wire["artifactInventory"]:
            self.assertIs(type(item), dict)
            self.assertEqual(set(item), {
                "roleName", "discriminator", "ref", "payloadKind",
                "schemaId", "schemaDigest",
            })
        for key in wire:
            with self.subTest(missing=key):
                changed = copy.deepcopy(wire)
                changed.pop(key)
                with self.assertRaises(ValueError):
                    contracts.MaterializeSnapshotRequest.from_dict(changed)
        mutations = (
            ("artifactCountLimit", 4095), ("singleArtifactByteLimit", True),
            ("cumulativeHashByteLimit", 0), ("timeoutSeconds", 59),
            ("inputByteLimit", 0), ("inputByteLimit", 1024 * 1024 + 1),
            ("artifactInventory", []), ("artifactInventory", list(reversed(wire["artifactInventory"]))),
            ("artifactInventory", wire["artifactInventory"] * 2),
            ("evaluationTime", "2026-08-31"),
            ("canonicalWorktreeHash", "invalid"), ("extra", None),
        )
        for field, value in mutations:
            with self.subTest(field=field, value=value):
                changed = copy.deepcopy(wire)
                changed[field] = value
                payload = {key: item for key, item in changed.items() if key != "identity"}
                changed["identity"] = request_identity(
                    contracts.WorkerKind.MATERIALIZER, payload, request.identity.descriptor_claims
                ).to_dict()
                with self.assertRaises(ValueError):
                    contracts.MaterializeSnapshotRequest.from_dict(changed)
        for change in ("foreign-ref", "foreign-owner", "missing-manifest"):
            with self.subTest(change=change):
                changed = copy.deepcopy(wire)
                claims = request.identity.descriptor_claims
                if change == "foreign-ref":
                    changed["artifactInventory"][0]["ref"]["gateId"] = "another-gate"
                elif change == "missing-manifest":
                    changed["runtimeManifestRef"]["path"] = "missing.json"
                else:
                    claims = (contracts.DescriptorClaim.create(
                        device_id="1", inode="2",
                        owner_binding=contracts.RunDirectoryOwnerBinding(
                            fixtures.WORKSPACE_ID, "another-gate", fixtures.RUN_ID
                        ),
                    ),)
                payload = {key: item for key, item in changed.items() if key != "identity"}
                changed["identity"] = request_identity(contracts.WorkerKind.MATERIALIZER, payload, claims).to_dict()
                with self.assertRaises(ValueError):
                    contracts.MaterializeSnapshotRequest.from_dict(changed)

    def test_materializer_result_exact_snapshot(self):
        request = self.materialize_request()
        snapshot = fixtures.snapshot()
        wire = self.completed(request, "snapshot", snapshot.to_dict())
        result = contracts.materialize_snapshot_result_from_dict(wire, request)
        self.assertEqual(result.snapshot, snapshot)
        for field, value in (
            ("sourceCommit", "different-commit"), ("workspaceDigest", "f" * 64),
            ("canonicalWorktreeHash", "d" * 64),
            ("evaluationTime", "2026-08-31T12:01:04+00:00"),
        ):
            with self.subTest(field=field):
                changed = copy.deepcopy(wire)
                changed["snapshot"][field] = value
                nested = changed["snapshot"]
                nested["snapshotDigest"] = contracts.domain_separated_sha256(
                    "pt.acceptance.finalization.snapshot.v1",
                    {key: item for key, item in nested.items() if key != "snapshotDigest"},
                )
                changed = signed_result({key: item for key, item in changed.items() if key != "workerResultDigest"})
                with self.assertRaises(ValueError):
                    contracts.materialize_snapshot_result_from_dict(changed, request)
        changed = copy.deepcopy(wire)
        changed["snapshot"]["artifacts"][0]["ref"]["sha256"] = "f" * 64
        nested = changed["snapshot"]
        nested["snapshotDigest"] = contracts.domain_separated_sha256(
            "pt.acceptance.finalization.snapshot.v1",
            {key: item for key, item in nested.items() if key != "snapshotDigest"},
        )
        changed = signed_result({key: item for key, item in changed.items() if key != "workerResultDigest"})
        with self.assertRaises(ValueError):
            contracts.materialize_snapshot_result_from_dict(changed, request)
        small = self.materialize_request(byte_limit=1)
        with self.assertRaisesRegex(ValueError, "inputByteLimit"):
            contracts.materialize_snapshot_result_from_dict(
                self.completed(small, "snapshot", snapshot.to_dict()), small
            )

    def test_execution_request_config_and_size(self):
        request = self.execution_request()
        self.assertEqual(contracts.ExecuteFinalizerRequest.from_dict(request.to_dict()), request)
        for field, value in (
            ("timeoutSeconds", True), ("timeoutSeconds", 0), ("timeoutSeconds", 61),
            ("timeoutSeconds", 59), ("inputByteLimit", 0), ("inputByteLimit", 1),
            ("inputByteLimit", 1024 * 1024 + 1), ("extra", None),
        ):
            with self.subTest(field=field, value=value):
                changed = request.to_dict()
                changed[field] = value
                payload = {key: item for key, item in changed.items() if key != "identity"}
                changed["identity"] = request_identity(contracts.WorkerKind.FINALIZER, payload).to_dict()
                with self.assertRaises(ValueError):
                    contracts.ExecuteFinalizerRequest.from_dict(changed)
        for key in request.to_dict():
            changed = request.to_dict()
            changed.pop(key)
            with self.subTest(missing=key), self.assertRaises(ValueError):
                contracts.ExecuteFinalizerRequest.from_dict(changed)

    def test_execution_completed_correlates_every_outcome_identity(self):
        request = self.execution_request()
        for status in (
            contracts.FinalizerOutcomeStatus.VALIDATED,
            contracts.FinalizerOutcomeStatus.REJECTED, contracts.FinalizerOutcomeStatus.BLOCKED,
        ):
            with self.subTest(status=status):
                wire = self.completed(request, "childOutcome", self.child_outcome(request, status))
                result = contracts.execute_finalizer_result_from_dict(wire, request)
                self.assertIs(result.child_outcome.status, status)
        wire = self.completed(request, "childOutcome", self.child_outcome(request))
        for field, value in (
            ("finalizerId", "another-finalizer"), ("invocationDigest", "d" * 64),
            ("finalizerInputDigest", "d" * 64), ("snapshotDigest", "d" * 64),
            ("primaryResultDigest", "d" * 64),
            ("validatedRoleInstances", [["synthetic-runtime", None]]),
            ("validatedRoleInstances", [["extra-role", None], *wire["childOutcome"]["validatedRoleInstances"]]),
        ):
            with self.subTest(field=field):
                changed = copy.deepcopy(wire)
                nested = changed["childOutcome"]
                nested[field] = value
                nested["childOutcomeDigest"] = contracts.domain_separated_sha256(
                    "pt.acceptance.finalization.child-outcome.v1",
                    {key: item for key, item in nested.items() if key != "childOutcomeDigest"},
                )
                changed = signed_result({key: item for key, item in changed.items() if key != "workerResultDigest"})
                with self.assertRaises(ValueError):
                    contracts.execute_finalizer_result_from_dict(changed, request)

    def test_failure_branches_and_request_replay_rejection(self):
        rows = (
            (self.materialize_request(), "snapshot", contracts.materialize_snapshot_result_from_dict,
             (contracts.FinalizerFailureCode.MATERIALIZATION_FAILED,
              contracts.FinalizerFailureCode.TIMED_OUT, contracts.FinalizerFailureCode.PROCESS_FAILED)),
            (self.execution_request(), "childOutcome", contracts.execute_finalizer_result_from_dict,
             (contracts.FinalizerFailureCode.RUNTIME_MISMATCH, contracts.FinalizerFailureCode.INPUT_TOO_LARGE,
              contracts.FinalizerFailureCode.OUTPUT_TOO_LARGE, contracts.FinalizerFailureCode.TIMED_OUT,
              contracts.FinalizerFailureCode.CANCELLED, contracts.FinalizerFailureCode.PROCESS_FAILED,
              contracts.FinalizerFailureCode.OUTPUT_INVALID)),
        )
        for request, field, decoder, allowed in rows:
            for code in contracts.FinalizerFailureCode:
                with self.subTest(worker=request.identity.worker_kind, code=code):
                    wire = signed_result({
                        "identity": request.identity.to_dict(), "status": "FAILED",
                        field: None, "failureCode": code.value, "diagnostic": "synthetic failure",
                    })
                    if code in allowed:
                        result = decoder(wire, request)
                        self.assertIs(result.failure_code, code)
                    else:
                        with self.assertRaises(ValueError):
                            decoder(wire, request)
            wire = signed_result({
                "identity": request.identity.to_dict(), "status": "FAILED", field: None,
                "failureCode": allowed[0].value, "diagnostic": "synthetic failure",
            })
            for key in wire:
                changed = dict(wire)
                changed.pop(key)
                with self.subTest(missing=key), self.assertRaises(ValueError):
                    decoder(changed, request)
            for key, value in (
                (field, {}), ("diagnostic", ""), ("diagnostic", "a" * 4097),
                ("failureCode", None), ("status", "REJECTED"), ("extra", None),
                ("workerResultDigest", "d" * 64),
            ):
                changed = {**wire, key: value}
                with self.subTest(key=key), self.assertRaises(ValueError):
                    decoder(changed, request)
            changed = copy.deepcopy(wire)
            identity = request.identity
            changed["identity"] = contracts.WorkerRequestIdentity.create(
                supervisor_session_id=identity.supervisor_session_id, request_id="another-request",
                sequence=identity.sequence + 1, worker_kind=identity.worker_kind,
                descriptor_claims=identity.descriptor_claims,
                request_payload_digest=identity.request_payload_digest,
            ).to_dict()
            changed = signed_result({key: item for key, item in changed.items() if key != "workerResultDigest"})
            with self.assertRaises(ValueError):
                decoder(changed, request)


if __name__ == "__main__":
    unittest.main()
