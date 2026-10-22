"""Synthetic maintenance request rows and immutable abort deletion plans."""

from __future__ import annotations

import copy
import unittest

from tooling.acceptance.core import finalization_contracts as c
from tooling.acceptance.tests import test_finalization_authority as authority
from tooling.acceptance.tests import test_finalization_durability_profiles as profiles


def control_ref_wire():
    abort = authority.abort_wire()
    return authority.signed({
        "artifactKind": "acceptance-abort-control-ref", "schemaVersion": 1,
        **{key: abort[key] for key in ("workspaceId", "gateId", "evidenceRunId")},
        "controlName": "deletion-plan", "contentSha256": "a" * 64,
    }, "controlRefDigest", "abort-control-ref")


def plan_wire(entries=None):
    abort = authority.abort_wire()
    return authority.signed({
        "artifactKind": "acceptance-abort-deletion-plan", "schemaVersion": 1,
        **{key: abort[key] for key in (
            "workspaceId", "gateId", "evidenceRunId", "authorizationId",
        )},
        "tombstoneIdentityDigest": "b" * 64,
        "entries": entries if entries is not None else [
            {"entryKind": "CONTENT", "tombstoneRelativePath": "logs/run.log",
             "fileType": "REGULAR_FILE", "deviceId": "1", "inode": "2", "byteLength": 16},
            {"entryKind": "CONTENT", "tombstoneRelativePath": "logs",
             "fileType": "DIRECTORY", "deviceId": "1", "inode": "3", "byteLength": None},
            {"entryKind": "TOMBSTONE_ROOT", "tombstoneRelativePath": None,
             "fileType": "DIRECTORY", "deviceId": "1", "inode": "4", "byteLength": None},
        ],
    }, "deletionPlanDigest", "abort-deletion-plan")


def bind_request(payload):
    claim = c.DescriptorClaim.create(
        device_id="1", inode="5",
        owner_binding=c.GateDirectoryOwnerBinding(payload["workspaceId"], payload["gateId"]),
    )
    identity = c.WorkerRequestIdentity.create(
        supervisor_session_id="synthetic-session", request_id="synthetic-request", sequence=1,
        worker_kind=c.WorkerKind.MAINTENANCE, descriptor_claims=(claim,),
        request_payload_digest=c.domain_separated_sha256(
            "pt.acceptance.finalization.worker-request.v1", payload,
        ),
    )
    return {"identity": identity.to_dict(), **payload}


def request_wires():
    installation, references = authority.install_authority()
    interlock = authority.signed({
        "artifactKind": "acceptance-finalizer-publication-interlock", "schemaVersion": 1,
        "workspaceId": installation.workspace_id, "gateId": installation.gate_id,
        "requiredFinalizerId": installation.required_finalizer_id,
        "installedAt": "2026-10-18T00:00:03+00:00",
        "installationSourceCommit": installation.authority_source_commit,
        "proofAdmissionSourceDigest": installation.proof_admission_source_digest,
        "authorization": installation.to_dict(),
    }, "interlockDigest", "publication-interlock")
    abort = authority.abort_wire()
    activation = authority.intent_wire()
    runtime = abort["maintenanceRuntime"]["maintenanceRuntimeDigest"]
    profile = abort["durabilityProfile"]["durabilityProfileDigest"]
    abort_profile = c.proof_authority_durability_profile_from_dict(
        abort["durabilityProfile"]
    )
    common = {
        "workspaceId": abort["workspaceId"], "gateId": abort["gateId"],
        "environmentObservation": profiles.active_observation_for_profile(
            abort_profile
        ),
        "expectedMaintenanceRuntimeDigest": runtime, "expectedDurabilityProfileDigest": profile,
    }
    run = {key: abort[key] for key in ("evidenceRunId", "authorizationId", "attemptId")}
    payloads = [
        {**common, "operation": "INSTALL_PUBLICATION_INTERLOCK",
         "workspaceId": installation.workspace_id, "gateId": installation.gate_id,
         "expectedMaintenanceRuntimeDigest": installation.maintenance_runtime.maintenance_runtime_digest,
         "expectedDurabilityProfileDigest": installation.durability_profile.durability_profile_digest,
         "environmentObservation": profiles.active_observation_for_profile(
             installation.durability_profile
         ),
         "candidateInterlock": interlock, "expectedPriorLatestPointer": None,
         "expectedPriorLatestPointerDigest": None,
         "byteLimit": 1024 * 1024, "timeoutSeconds": 60},
        {**common, "operation": "ACTIVATE_ENFORCEMENT", "intent": activation,
         "entryLimit": 4096, "byteLimit": 1024 * 1024, "timeoutSeconds": 60},
        {**common, **run, "operation": "WRITE_ABORT_EVENT", "authorization": abort},
        {**common, **run, "operation": "TOMBSTONE_RUN", "expectedSnapshotDigest": "a" * 64,
         "deletionPlanEntryLimit": 16384, "deletionPlanByteLimit": 4 * 1024 * 1024,
         "timeoutSeconds": 60},
        {**common, **run, "operation": "DELETE_TOMBSTONE_BATCH",
         "expectedTombstoneIdentityDigest": "b" * 64, "deletionPlanRef": control_ref_wire(),
         "deletionPlanDigest": "c" * 64, "continuationEventDigest": "d" * 64,
         "continuationToken": "e" * 64, "entryLimit": 1024,
         "byteLimit": 1024 * 1024 * 1024, "timeoutSeconds": 30},
    ]
    return tuple(bind_request(payload) for payload in payloads), references


class MaintenanceContractTests(unittest.TestCase):
    def test_abort_authorized_event_projection_and_digest(self):
        authorization = c.AbortAuthorization.from_dict(
            authority.abort_wire()
        )
        projection = c.AbortEventAuthorizationProjection.from_authorization(
            authorization
        )
        event = c.AbortSealedAuditEvent.create(
            event_type=c.AbortEventType.AUTHORIZED,
            event_sequence=1,
            previous_event_digest=None,
            authorization=projection,
            attempt_id=authorization.attempt_id,
            tombstone_identity_digest=c.abort_tombstone_identity_digest(
                authorization
            ),
            deletion_plan_ref=None,
            deletion_plan_digest=None,
            completion_source=None,
            batch_end_index_exclusive=None,
            next_traversal_index=None,
            continuation_token=None,
            recorded_at=authorization.authorized_at,
            diagnostic=None,
        )
        self.assertEqual(
            c.AbortSealedAuditEvent.from_dict(event.to_dict()),
            event,
        )
        for field, value in (
            ("eventSequence", 2),
            ("attemptId", "other-attempt"),
            ("tombstoneIdentityDigest", "0" * 64),
            ("diagnostic", "forbidden"),
            ("unexpected", True),
        ):
            changed = event.to_dict()
            changed[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                c.AbortSealedAuditEvent.from_dict(changed)

    def test_abort_tombstone_and_delete_event_chain_round_trip(self):
        authorization = c.AbortAuthorization.from_dict(
            authority.abort_wire()
        )
        projection = c.AbortEventAuthorizationProjection.from_authorization(
            authorization
        )
        tombstone_digest = c.abort_tombstone_identity_digest(
            authorization
        )
        authorized = c.AbortSealedAuditEvent.create(
            event_type=c.AbortEventType.AUTHORIZED,
            event_sequence=1,
            previous_event_digest=None,
            authorization=projection,
            attempt_id=authorization.attempt_id,
            tombstone_identity_digest=tombstone_digest,
            deletion_plan_ref=None,
            deletion_plan_digest=None,
            completion_source=None,
            batch_end_index_exclusive=None,
            next_traversal_index=None,
            continuation_token=None,
            recorded_at=authorization.authorized_at,
            diagnostic=None,
        )
        plan_ref = c.AbortControlArtifactRef.from_dict(control_ref_wire())
        plan_digest = "c" * 64
        tombstone_token = c.abort_continuation_token(
            authorization_id=authorization.authorization_id,
            event_sequence=2,
            next_deletion_plan_index=0,
            deletion_plan_digest=plan_digest,
            tombstone_identity_digest=tombstone_digest,
        )
        tombstoned = c.AbortSealedAuditEvent.create(
            event_type=c.AbortEventType.TOMBSTONED,
            event_sequence=2,
            previous_event_digest=authorized.event_digest,
            authorization=projection,
            attempt_id=authorization.attempt_id,
            tombstone_identity_digest=tombstone_digest,
            deletion_plan_ref=plan_ref,
            deletion_plan_digest=plan_digest,
            completion_source=None,
            batch_end_index_exclusive=None,
            next_traversal_index=0,
            continuation_token=tombstone_token,
            recorded_at=authorization.authorized_at,
            diagnostic=None,
        )
        started = c.AbortSealedAuditEvent.create(
            event_type=c.AbortEventType.DELETE_BATCH_STARTED,
            event_sequence=3,
            previous_event_digest=tombstoned.event_digest,
            authorization=projection,
            attempt_id="delete-attempt",
            tombstone_identity_digest=tombstone_digest,
            deletion_plan_ref=plan_ref,
            deletion_plan_digest=plan_digest,
            completion_source=None,
            batch_end_index_exclusive=2,
            next_traversal_index=0,
            continuation_token=tombstone_token,
            recorded_at=authorization.authorized_at,
            diagnostic=None,
        )
        failed_token = c.abort_continuation_token(
            authorization_id=authorization.authorization_id,
            event_sequence=4,
            next_deletion_plan_index=2,
            deletion_plan_digest=plan_digest,
            tombstone_identity_digest=tombstone_digest,
        )
        failed = c.AbortSealedAuditEvent.create(
            event_type=c.AbortEventType.FAILED,
            event_sequence=4,
            previous_event_digest=started.event_digest,
            authorization=projection,
            attempt_id=started.attempt_id,
            tombstone_identity_digest=tombstone_digest,
            deletion_plan_ref=plan_ref,
            deletion_plan_digest=plan_digest,
            completion_source=None,
            batch_end_index_exclusive=None,
            next_traversal_index=2,
            continuation_token=failed_token,
            recorded_at=authorization.authorized_at,
            diagnostic="batch limit",
        )
        for event in (tombstoned, started, failed):
            with self.subTest(event=event.event_type):
                self.assertEqual(
                    c.AbortSealedAuditEvent.from_dict(event.to_dict()),
                    event,
                )

    def test_maintenance_result_matrix_all_statuses_and_durable_boundaries(self):
        wires, references = request_wires()
        count = 0
        for wire in wires:
            request = c.maintenance_request_from_dict(wire, **references)
            for (operation, status), cls in c._MAINTENANCE_RESULT_TYPES.items():
                if operation != wire["operation"]:
                    continue
                for boundary in cls.allowed_boundaries:
                    with self.subTest(operation=operation, status=status, boundary=boundary):
                        values = {
                            "identity": request.identity, "failure_code": None if status == "COMPLETED" else c.MaintenanceFailureCode.IO_FAILED,
                            "result_digest": "0" * 64, "diagnostic": None if status == "COMPLETED" else "synthetic I/O failure",
                            "durable_boundary": boundary, "interlock_digest": None,
                            "generation": None, "enforcement_digest": None,
                            "authorization_id": getattr(request, "authorization_id", "synthetic-authorization"),
                            "attempt_id": getattr(request, "attempt_id", "synthetic-attempt"),
                            "event_digest": None, "deletion_plan_ref": None, "deletion_plan_digest": None,
                            "continuation_token": None, "tombstoned_event_digest": None,
                            "deleted_entries": 0, "deleted_bytes": 0, "terminal_event_digest": None,
                        }
                        if operation == "INSTALL_PUBLICATION_INTERLOCK" and status != "REJECTED":
                            values["interlock_digest"] = request.candidate_interlock.interlock_digest
                        if operation == "ACTIVATE_ENFORCEMENT" and status != "REJECTED":
                            values["generation"] = request.intent.target_generation
                            values["enforcement_digest"] = authority.pending_wire()["candidateEnforcementRecord"]["enforcementDigest"]
                        if operation == "WRITE_ABORT_EVENT" and boundary != "NONE":
                            values["event_digest"] = "a" * 64
                        if operation == "TOMBSTONE_RUN" and status == "COMPLETED":
                            values.update(deletion_plan_ref=c.AbortControlArtifactRef.from_dict(control_ref_wire()),
                                          deletion_plan_digest="a" * 64, continuation_token="b" * 64,
                                          tombstoned_event_digest="c" * 64)
                        if operation == "DELETE_TOMBSTONE_BATCH" and status != "REJECTED":
                            values["terminal_event_digest"] = "a" * 64
                            values["continuation_token"] = None if status == "COMPLETED" else "b" * 64
                            if status == "INCOMPLETE":
                                values["failure_code"] = c.MaintenanceFailureCode.LIMIT_EXCEEDED
                        # Build only the digest preimage before invoking the validated public decoder.
                        unsigned = object.__new__(cls)
                        for field in c.dataclass_fields(cls):
                            object.__setattr__(unsigned, field.name, values[field.name])
                        result_wire = authority.signed(unsigned._payload(), "resultDigest", "maintenance-result")
                        parsed = c.maintenance_result_from_dict(result_wire, request)
                        self.assertIs(type(parsed), cls)
                        self.assertEqual(parsed.to_dict(), result_wire)
                        self.assertEqual(c.worker_result_from_dict(result_wire, request), parsed)
                        frame_payload = {
                            "frameType": "WORKER_RESULT", "identity": request.identity.to_dict(),
                            "result": result_wire,
                        }
                        frame_wire = {
                            **frame_payload, "frameDigest": c.domain_separated_sha256(
                                "pt.acceptance.finalization.supervisor-control-frame.v1", frame_payload,
                            ),
                        }
                        self.assertEqual(c.supervisor_control_frame_from_bytes(
                            c.canonical_json_bytes(frame_wire), request=request,
                        ).result, parsed)
                        count += 1
                        for field, value in (
                            ("durableBoundary", "UNKNOWN"), ("status", "UNKNOWN"),
                            ("operation", "UNKNOWN"), ("unexpected", True),
                        ):
                            with self.subTest(field=field), self.assertRaises(ValueError):
                                c.maintenance_result_from_dict(authority.signed({
                                    **result_wire, field: value,
                                }, "resultDigest", "maintenance-result"), request)
                        if status == "COMPLETED":
                            with self.assertRaisesRegex(ValueError, "forbids failure"):
                                c.maintenance_result_from_dict(authority.signed({
                                    **result_wire, "failureCode": "MAINTENANCE_IO_FAILED",
                                }, "resultDigest", "maintenance-result"), request)
                        if "authorizationId" in result_wire:
                            with self.assertRaisesRegex(ValueError, "exact authorization"):
                                c.maintenance_result_from_dict(authority.signed({
                                    **result_wire, "authorizationId": "other-authorization",
                                }, "resultDigest", "maintenance-result"), request)
                        if status == "REJECTED" and operation == "DELETE_TOMBSTONE_BATCH":
                            with self.assertRaisesRegex(ValueError, "NO_MUTATION"):
                                c.maintenance_result_from_dict(authority.signed({
                                    **result_wire, "deletedEntries": 1,
                                }, "resultDigest", "maintenance-result"), request)
                        if operation == "WRITE_ABORT_EVENT" and boundary == "NONE":
                            with self.assertRaisesRegex(ValueError, "prepublication"):
                                c.maintenance_result_from_dict(authority.signed({
                                    **result_wire, "eventDigest": "a" * 64,
                                }, "resultDigest", "maintenance-result"), request)
                        if operation == "DELETE_TOMBSTONE_BATCH" and status != "REJECTED":
                            with self.assertRaisesRegex(ValueError, "budgets"):
                                c.maintenance_result_from_dict(authority.signed({
                                    **result_wire, "deletedEntries": request.entry_limit + 1,
                                }, "resultDigest", "maintenance-result"), request)
                        for field in ("interlockDigest", "enforcementDigest"):
                            if result_wire.get(field) is not None:
                                with self.subTest(field=field), self.assertRaisesRegex(ValueError, "exact candidate"):
                                    c.maintenance_result_from_dict(authority.signed({
                                        **result_wire, field: "0" * 64,
                                    }, "resultDigest", "maintenance-result"), request)
        self.assertEqual(count, 19)

    def test_deletion_plan_roundtrip_root_order_and_closed_branches(self):
        wire = plan_wire()
        self.assertEqual(c.AbortDeletionPlan.from_dict(wire).to_dict(), wire)
        root = wire["entries"][-1]
        self.assertEqual(c.AbortDeletionPlan.from_dict(plan_wire([root])).entries[0].entry_kind,
                         "TOMBSTONE_ROOT")
        for entries in (
            [], wire["entries"][:-1], [root, *wire["entries"]],
            [wire["entries"][1], wire["entries"][0], root],
            [wire["entries"][0], wire["entries"][0], root],
        ):
            with self.subTest(entries=entries), self.assertRaises(ValueError):
                c.AbortDeletionPlan.from_dict(plan_wire(entries))
        for index, field, value in (
            (0, "fileType", "SYMLINK"), (0, "tombstoneRelativePath", "../escape"),
            (0, "byteLength", True), (0, "byteLength", -1),
            (0, "byteLength", 9007199254740992), (0, "inode", "01"),
            (0, "deviceId", "18446744073709551616"), (1, "byteLength", 16),
            (2, "tombstoneRelativePath", "root"), (2, "fileType", "REGULAR_FILE"),
            (0, "unexpected", True),
        ):
            changed = copy.deepcopy(wire)
            changed["entries"][index][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                c.AbortDeletionPlan.from_dict(authority.signed(
                    changed, "deletionPlanDigest", "abort-deletion-plan",
                ))
        changed = copy.deepcopy(wire)
        changed["entries"][1]["fileType"] = "REGULAR_FILE"
        changed["entries"][1]["byteLength"] = 0
        with self.assertRaisesRegex(ValueError, "parents"):
            c.AbortDeletionPlan.from_dict(authority.signed(
                changed, "deletionPlanDigest", "abort-deletion-plan",
            ))

    def test_control_ref_forbids_generic_path_and_wrong_name(self):
        wire = control_ref_wire()
        self.assertEqual(c.AbortControlArtifactRef.from_dict(wire).to_dict(), wire)
        for field, value in (("controlName", "other"), ("schemaVersion", True),
                             ("path", "/tmp/arbitrary"), ("evidenceRunId", "wrong-run")):
            with self.subTest(field=field), self.assertRaises(ValueError):
                c.AbortControlArtifactRef.from_dict(authority.signed(
                    {**wire, field: value}, "controlRefDigest", "abort-control-ref",
                ))

    def test_maintenance_matrix_roundtrip_and_closed_request_rows(self):
        wires, references = request_wires()
        expected = (c.InstallPublicationInterlockRequest, c.ActivateEnforcementRequest,
                    c.WriteAbortEventRequest, c.TombstoneRunRequest, c.DeleteTombstoneBatchRequest)
        for wire, cls in zip(wires, expected):
            with self.subTest(operation=wire["operation"]):
                parsed = c.maintenance_request_from_dict(wire, **references)
                self.assertIs(type(parsed), cls)
                self.assertEqual(parsed.to_dict(), wire)
                for field in wire:
                    changed = dict(wire)
                    changed.pop(field)
                    with self.subTest(missing=field), self.assertRaises(ValueError):
                        c.maintenance_request_from_dict(changed, **references)
                with self.assertRaises(ValueError):
                    c.maintenance_request_from_dict(
                        {**wire, "unexpected": True}, **references,
                    )
                payload = {key: value for key, value in wire.items() if key != "identity"}
                for field, value in (
                    ("expectedMaintenanceRuntimeDigest", "0" * 64),
                    ("expectedDurabilityProfileDigest", "0" * 64),
                ):
                    if wire["operation"] in ("TOMBSTONE_RUN", "DELETE_TOMBSTONE_BATCH"):
                        continue  # These rows resolve their authority from durable storage at runtime.
                    with self.subTest(field=field), self.assertRaisesRegex(ValueError, "exact authority"):
                        c.maintenance_request_from_dict(
                            bind_request({**payload, field: value}), **references,
                        )
        for wire in wires:
            payload = {key: value for key, value in wire.items() if key != "identity"}
            for field in ("entryLimit", "byteLimit", "timeoutSeconds",
                          "deletionPlanEntryLimit", "deletionPlanByteLimit"):
                if field not in payload:
                    continue
                for value in (True, 0, payload[field] + 1):
                    with self.subTest(operation=wire["operation"], field=field, value=value), self.assertRaises(ValueError):
                        c.maintenance_request_from_dict(
                            bind_request({**payload, field: value}), **references,
                        )

    def test_maintenance_request_rejects_resigned_scope_attempt_and_reference_changes(self):
        wires, references = request_wires()
        abort = wires[2]
        payload = {key: value for key, value in abort.items() if key != "identity"}
        for field, value in (("attemptId", "other-attempt"), ("authorizationId", "other-authorization"),
                             ("evidenceRunId", "20261018T000000000000Z-" + "2" * 32)):
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "exact authorization"):
                c.maintenance_request_from_dict(bind_request({**payload, field: value}))
        wire = wires[4]
        payload = {key: value for key, value in wire.items() if key != "identity"}
        changed = copy.deepcopy(payload)
        changed["deletionPlanRef"] = authority.signed({
            **changed["deletionPlanRef"], "gateId": "other-gate",
        }, "controlRefDigest", "abort-control-ref")
        with self.assertRaisesRegex(ValueError, "requested run"):
            c.maintenance_request_from_dict(bind_request(changed))
        changed = copy.deepcopy(wires[3])
        changed["gateId"] = "other-gate"
        with self.assertRaisesRegex(ValueError, "requestPayloadDigest"):
            c.maintenance_request_from_dict(changed)
        for operation in ("UNKNOWN", True):
            with self.subTest(operation=operation), self.assertRaises(ValueError):
                c.maintenance_request_from_dict({**wires[1], "operation": operation}, **references)
