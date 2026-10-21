from __future__ import annotations

import json
import hashlib
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling.acceptance.core import finalization_contracts as c
from tooling.acceptance.core import finalizer_worker
from tooling.acceptance.core.evidence_finalization import (
    NativeSupervisor,
    SupervisorExecutables,
)
from tooling.acceptance.tests import test_finalization_authority as authority
from tooling.acceptance.tests import test_finalization_store_contracts as store_fixtures
from tooling.acceptance.tests import (
    test_finalization_maintenance_contracts as maintenance_fixtures,
)
from tooling.acceptance.tests import (
    test_finalization_authority_persistence as persistence,
)
from tooling.acceptance.tests.test_finalization_execution_contracts import (
    request_identity,
)


def write_contract(path: Path, value: object) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.write_bytes(c.canonical_json_bytes(value))


def persist_proof_closure(
    gate: Path,
    references: dict[str, object],
) -> None:
    claim = gate / "claim-admission"
    epoch = references["epoch"]
    pause = references["pause"]
    write_contract(
        claim / "epochs" / f"{epoch.coordinator_epoch_id}.json",
        epoch.to_dict(),
    )
    write_contract(
        claim / "current-epoch.json",
        references["current_epoch"].to_dict(),
    )
    write_contract(
        claim / "pauses" / f"{pause.coordinator_epoch_id}.json",
        pause.to_dict(),
    )
    jobs = claim / "jobs" / epoch.coordinator_epoch_id
    completions = claim / "completions" / epoch.coordinator_epoch_id
    emissions = claim / "emissions" / epoch.coordinator_epoch_id
    for directory in (jobs, completions, emissions):
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    for item in references["jobs"]:
        write_contract(
            jobs / f"{item.job_sequence}-{item.job_id}.json",
            item.to_dict(),
        )
    for item in references["completions"]:
        write_contract(
            completions / f"{item.job_sequence}.json",
            item.to_dict(),
        )
    for item in references["intents"]:
        write_contract(
            emissions / str(item.job_sequence) / "intent.json",
            item.to_dict(),
        )
    for item in references["acknowledgements"]:
        write_contract(
            emissions / str(item.job_sequence) / "acknowledged.json",
            item.to_dict(),
        )


def gate_claim(
    gate: Path,
    *,
    workspace_id: str,
    gate_id: str,
) -> c.DescriptorClaim:
    observed = gate.stat()
    return c.DescriptorClaim.create(
        device_id=str(observed.st_dev),
        inode=str(observed.st_ino),
        owner_binding=c.GateDirectoryOwnerBinding(
            workspace_id,
            gate_id,
        ),
    )


class MaintenanceWorkerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        self.gate = root / "gate"
        self.capture = root / "capture"
        self.gate.mkdir(mode=0o700)
        self.capture.mkdir(mode=0o700)
        self.persist_request = persistence.AuthorityPersistenceTests().live_request(
            self.gate,
            self.capture,
        )
        gate_fd = os.open(self.gate, os.O_RDONLY | os.O_DIRECTORY)
        capture_fd = os.open(
            self.capture,
            os.O_RDONLY | os.O_DIRECTORY,
        )
        try:
            with patch.object(finalizer_worker.sys, "platform", "linux"):
                finalizer_worker._persist_authority_runtime_result(
                    self.persist_request,
                    gate_fd,
                    capture_fd,
                    deadline=time.monotonic() + 10,
                    mutation_state=[False],
                )
        finally:
            os.close(capture_fd)
            os.close(gate_fd)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def install_request(self):
        installation, references = authority.install_authority()
        authorization_wire = authority.sign_authority(
            {
                **installation.to_dict(),
                "maintenanceRuntime": (
                    self.persist_request.candidate_runtime.to_dict()
                ),
                "durabilityProfile": (
                    self.persist_request.durability_profile.to_dict()
                ),
            }
        )
        installation = c.FinalizerAuthorityAuthorization.from_dict(
            authorization_wire,
            **references,
        )
        interlock_wire = authority.signed(
            {
                "artifactKind": (
                    "acceptance-finalizer-publication-interlock"
                ),
                "schemaVersion": 1,
                "workspaceId": installation.workspace_id,
                "gateId": installation.gate_id,
                "requiredFinalizerId": (
                    installation.required_finalizer_id
                ),
                "installedAt": "2026-10-18T00:00:03+00:00",
                "installationSourceCommit": (
                    installation.authority_source_commit
                ),
                "proofAdmissionSourceDigest": (
                    installation.proof_admission_source_digest
                ),
                "authorization": installation.to_dict(),
            },
            "interlockDigest",
            "publication-interlock",
        )
        interlock = c.FinalizerPublicationInterlock.from_dict(
            interlock_wire,
            **references,
        )
        payload = {
            "operation": "INSTALL_PUBLICATION_INTERLOCK",
            "workspaceId": installation.workspace_id,
            "gateId": installation.gate_id,
            "candidateInterlock": interlock.to_dict(),
            "expectedPriorLatestPointer": None,
            "expectedPriorLatestPointerDigest": None,
            "environmentObservation": (
                self.persist_request.environment_observation.to_dict()
            ),
            "expectedMaintenanceRuntimeDigest": (
                self.persist_request.candidate_runtime
                .maintenance_runtime_digest
            ),
            "expectedDurabilityProfileDigest": (
                self.persist_request.durability_profile
                .durability_profile_digest
            ),
            "byteLimit": 1024 * 1024,
            "timeoutSeconds": 60,
        }
        identity = request_identity(
            c.WorkerKind.MAINTENANCE,
            payload,
            (
                gate_claim(
                    self.gate,
                    workspace_id=installation.workspace_id,
                    gate_id=installation.gate_id,
                ),
            ),
        )
        request = c.maintenance_request_from_dict(
            {"identity": identity.to_dict(), **payload},
            **references,
        )
        return request, references

    def activation_request(self, interlock_digest: str):
        base = authority.authority_wire()
        authorization_wire = authority.sign_authority(
            {
                **base,
                "gateId": self.persist_request.gate_id,
                "requiredFinalizerId": "synthetic-finalizer",
                "expectedInterlockDigest": interlock_digest,
                "maintenanceRuntime": (
                    self.persist_request.candidate_runtime.to_dict()
                ),
                "durabilityProfile": (
                    self.persist_request.durability_profile.to_dict()
                ),
            }
        )
        intent_wire = authority.intent_wire(authorization_wire)
        intent = c.FinalizerActivationIntent.from_dict(intent_wire)
        payload = {
            "operation": "ACTIVATE_ENFORCEMENT",
            "workspaceId": intent.workspace_id,
            "gateId": intent.gate_id,
            "intent": intent.to_dict(),
            "environmentObservation": (
                self.persist_request.environment_observation.to_dict()
            ),
            "expectedMaintenanceRuntimeDigest": (
                self.persist_request.candidate_runtime
                .maintenance_runtime_digest
            ),
            "expectedDurabilityProfileDigest": (
                self.persist_request.durability_profile
                .durability_profile_digest
            ),
            "entryLimit": 4096,
            "byteLimit": 1024 * 1024,
            "timeoutSeconds": 60,
        }
        identity = request_identity(
            c.WorkerKind.MAINTENANCE,
            payload,
            (
                gate_claim(
                    self.gate,
                    workspace_id=intent.workspace_id,
                    gate_id=intent.gate_id,
                ),
            ),
        )
        return c.maintenance_request_from_dict(
            {"identity": identity.to_dict(), **payload}
        )

    def abort_request(self):
        record = store_fixtures.requirement_record()
        run_dir = self.gate / store_fixtures.RUN_ID
        run_dir.mkdir(mode=0o700)
        (run_dir / ".active.lock").touch(mode=0o600)
        (run_dir / ".finalization.lock").touch(mode=0o600)
        runtime_ref = record.runtime_evidence_artifacts[0].ref
        artifact = c.SnapshotArtifact(
            role_name="synthetic-runtime",
            discriminator=None,
            ref=runtime_ref,
            payload=None,
            payload_digest=None,
        )
        snapshot = c.ReadOnlyEvidenceSnapshot.create(
            workspace_id=record.workspace_id,
            gate_id=record.requirement.gate_id,
            evidence_run_id=store_fixtures.RUN_ID,
            evaluation_time="2026-10-18T12:00:01+00:00",
            artifacts=(artifact,),
            runtime_manifest_ref=runtime_ref,
            source_commit=record.source_commit,
            workspace_digest=record.workspace_digest,
            canonical_worktree_hash=record.canonical_worktree_hash,
        )
        trace = c.PrimaryResultSourceTrace.create(
            producer_id="synthetic-runner",
            source_commit=record.source_commit,
            invocation_id="synthetic-orphan",
            evidence_refs=(runtime_ref,),
        )
        primary_tuple = c.CanonicalResultTuple.PassedDoneProven
        primary = c.CanonicalPrimaryResult(
            document=c.CanonicalOpaqueJson.from_value(
                schema_id="acceptance-primary-result-v1",
                schema_digest="f" * 64,
                value={
                    **primary_tuple.to_dict(),
                    "reasonCode": None,
                    "sourceTrace": trace.to_dict(),
                },
            ),
            result_tuple=primary_tuple,
            reason_code=None,
            source_trace=trace,
        )
        executable_ref = c.ArtifactRef(
            record.workspace_id,
            record.requirement.gate_id,
            store_fixtures.RUN_ID,
            "finalizer/source.bundle",
            "a" * 64,
            "application/octet-stream",
        )
        executable = c.FinalizerExecutableArtifact.create(
            ref=executable_ref,
            files=tuple(
                (item.repo_relative_path, item.file_sha256)
                for item in record.captured_sources
                if item.executable_included
            ),
            source_digest=record.source_digest,
            core_bootstrap_source_digest=(
                record.bootstrap_baseline.core_bootstrap_source_digest
            ),
            entrypoint=record.registry_entry.entrypoint,
        )
        context = c.FinalizerContext.create(
            finalizer_id=record.requirement.finalizer_id,
            finalizer_executable=executable,
            finalizer_source_digest=record.source_digest,
            finalizer_runtime=record.finalizer_runtime,
            supervisor_session_id="synthetic-session",
            supervisor_runtime_digest=(
                record.finalizer_runtime.supervisor_runtime_digest
            ),
            enforcement_generation=record.enforcement_generation,
            enforcement_digest=record.enforcement_digest,
            requirement_digest=record.requirement_digest,
            config_digest=record.config_digest,
            workspace_id=record.workspace_id,
            gate_id=record.requirement.gate_id,
            evidence_run_id=store_fixtures.RUN_ID,
            provisioning_run_id="synthetic-provisioning",
            runtime_manifest_ref=runtime_ref,
            source_commit=record.source_commit,
            workspace_digest=record.workspace_digest,
            canonical_worktree_hash=record.canonical_worktree_hash,
            snapshot_digest=snapshot.snapshot_digest,
            required_role_identities=(("synthetic-runtime", None),),
            primary_status=primary.result_tuple,
            primary_result_digest=primary.digest(),
        )
        marker = c.SealedEvidenceMarker.create(
            snapshot=snapshot,
            finalizer_context=context,
            primary_result=primary,
            sealed_at="2026-10-18T12:00:02+00:00",
        )
        write_contract(
            run_dir / "finalization-requirement.json",
            record.to_dict(),
        )
        write_contract(run_dir / "sealed.json", marker.to_dict())
        observed = run_dir.stat()
        run_claim = c.DescriptorClaim.create(
            device_id=str(observed.st_dev),
            inode=str(observed.st_ino),
            owner_binding=c.RunDirectoryOwnerBinding(
                record.workspace_id,
                record.requirement.gate_id,
                store_fixtures.RUN_ID,
            ),
        )
        wire = authority.signed(
            {
                "authorizationId": "synthetic-authorization",
                "attemptId": "synthetic-attempt",
                "authorizedAt": "2026-10-18T12:00:03+00:00",
                "operatorIdentity": c.AbortOperatorIdentity.create(
                    effective_uid=os.geteuid()
                ).to_dict(),
                "reasonCode": "OPERATOR_REQUESTED_DISCARD",
                "workspaceId": record.workspace_id,
                "gateId": record.requirement.gate_id,
                "evidenceRunId": store_fixtures.RUN_ID,
                "runDirectoryClaim": run_claim.to_dict(),
                "snapshotDigest": snapshot.snapshot_digest,
                "requirementDigest": record.requirement_digest,
                "authoritySourceCommit": record.source_commit,
                "proofAdmissionInventoryRule": (
                    "ALL_TRACKED_ACCEPTANCE_CLAIM_SOURCES"
                ),
                "proofAdmissionSourceDigest": "e" * 64,
                "maintenanceRuntime": (
                    self.persist_request.candidate_runtime.to_dict()
                ),
                "durabilityProfile": (
                    self.persist_request.durability_profile.to_dict()
                ),
            },
            "confirmationChallengeDigest",
            "abort-confirmation",
        )
        authorization = c.AbortAuthorization.from_dict(wire)
        payload = {
            "operation": "WRITE_ABORT_EVENT",
            "workspaceId": authorization.workspace_id,
            "gateId": authorization.gate_id,
            "evidenceRunId": authorization.evidence_run_id,
            "authorizationId": authorization.authorization_id,
            "attemptId": authorization.attempt_id,
            "authorization": authorization.to_dict(),
            "environmentObservation": (
                self.persist_request.environment_observation.to_dict()
            ),
            "expectedMaintenanceRuntimeDigest": (
                self.persist_request.candidate_runtime
                .maintenance_runtime_digest
            ),
            "expectedDurabilityProfileDigest": (
                self.persist_request.durability_profile
                .durability_profile_digest
            ),
        }
        identity = request_identity(
            c.WorkerKind.MAINTENANCE,
            payload,
            (
                gate_claim(
                    self.gate,
                    workspace_id=authorization.workspace_id,
                    gate_id=authorization.gate_id,
                ),
            ),
        )
        return c.maintenance_request_from_dict(
            {"identity": identity.to_dict(), **payload}
        )

    def test_install_and_activate_are_durable_and_idempotent(self) -> None:
        install_request, references = self.install_request()
        frame_payload = {
            "frameType": "WORKER_REQUEST",
            "identity": install_request.identity.to_dict(),
            "request": install_request.to_dict(),
        }
        decoded = c.supervisor_control_frame_from_bytes(
            c.canonical_json_bytes(
                {
                    **frame_payload,
                    "frameDigest": c.domain_separated_sha256(
                        "pt.acceptance.finalization.supervisor-control-frame.v1",
                        frame_payload,
                    ),
                }
            )
        )
        self.assertEqual(decoded.request, install_request)
        persist_proof_closure(self.gate, references)
        gate_fd = os.open(self.gate, os.O_RDONLY | os.O_DIRECTORY)
        try:
            with patch.object(finalizer_worker.sys, "platform", "linux"):
                first = finalizer_worker._install_interlock_result(
                    install_request,
                    gate_fd,
                    deadline=time.monotonic() + 10,
                )
                second = finalizer_worker._install_interlock_result(
                    install_request,
                    gate_fd,
                    deadline=time.monotonic() + 10,
                )
            self.assertIs(
                type(first),
                c.InstallPublicationInterlockCompleted,
            )
            self.assertEqual(first.interlock_digest, second.interlock_digest)
            activation_request = self.activation_request(
                first.interlock_digest
            )
            with patch.object(finalizer_worker.sys, "platform", "linux"):
                activated = finalizer_worker._activate_enforcement_result(
                    activation_request,
                    gate_fd,
                    deadline=time.monotonic() + 10,
                )
                retried = finalizer_worker._activate_enforcement_result(
                    activation_request,
                    gate_fd,
                    deadline=time.monotonic() + 10,
                )
            self.assertIs(type(activated), c.ActivateEnforcementCompleted)
            self.assertEqual(
                activated.enforcement_digest,
                retried.enforcement_digest,
            )
        finally:
            os.close(gate_fd)
        enforcement = self.gate / "finalizer-enforcement"
        self.assertFalse((enforcement / "activation-pending.json").exists())
        current = c.FinalizerEnforcementCurrent.from_dict(
            json.loads(
                (enforcement / "current.json").read_text(encoding="utf-8")
            )
        )
        self.assertEqual(current.generation, 1)

    def test_write_abort_authorization_is_durable_and_idempotent(self):
        request = self.abort_request()
        gate_fd = os.open(self.gate, os.O_RDONLY | os.O_DIRECTORY)
        try:
            with patch.object(finalizer_worker.sys, "platform", "linux"):
                first = finalizer_worker._write_abort_authorization_result(
                    request,
                    gate_fd,
                    deadline=time.monotonic() + 10,
                )
                second = finalizer_worker._write_abort_authorization_result(
                    request,
                    gate_fd,
                    deadline=time.monotonic() + 10,
                )
        finally:
            os.close(gate_fd)
        self.assertIs(type(first), c.WriteAuthorizationCompleted)
        self.assertEqual(first.event_digest, second.event_digest)
        event = c.AbortSealedAuditEvent.from_dict(
            json.loads(
                (
                    self.gate
                    / "aborts"
                    / request.evidence_run_id
                    / "authorized.json"
                ).read_text(encoding="utf-8")
            )
        )
        self.assertIs(event.event_type, c.AbortEventType.AUTHORIZED)

    def test_native_supervisor_dispatches_maintenance_fail_closed(self):
        wires, references = maintenance_fixtures.request_wires()
        payload = {
            key: value
            for key, value in wires[3].items()
            if key != "identity"
        }
        identity = request_identity(
            c.WorkerKind.MAINTENANCE,
            payload,
            (
                gate_claim(
                    self.gate,
                    workspace_id=payload["workspaceId"],
                    gate_id=payload["gateId"],
                ),
            ),
        )
        request = c.maintenance_request_from_dict(
            {"identity": identity.to_dict(), **payload},
            **references,
        )
        binary = Path(self.temporary.name) / "finalization-supervisor"
        source = (
            Path(__file__).parents[1]
            / "core"
            / "finalization_supervisor.c"
        )
        cflags = subprocess.check_output(
            ["pkg-config", "--cflags", "json-c", "openssl"],
            text=True,
        ).split()
        libraries = subprocess.check_output(
            ["pkg-config", "--libs", "json-c", "openssl"],
            text=True,
        ).split()
        subprocess.run(
            [
                "cc",
                "-std=c11",
                "-Wall",
                "-Wextra",
                "-Werror",
                "-O2",
                *cflags,
                str(source),
                "-o",
                str(binary),
                *libraries,
            ],
            check=True,
        )
        worker = Path(finalizer_worker.__file__).resolve()
        python = Path(sys.executable).resolve()

        def digest(path: Path) -> str:
            return hashlib.sha256(path.read_bytes()).hexdigest()

        supervisor_cwd = Path(self.temporary.name) / "supervisor-cwd"
        supervisor_cwd.mkdir(mode=0o700)
        executables = SupervisorExecutables(
            binary=str(binary.resolve()),
            binary_sha256=digest(binary),
            python=str(python),
            python_sha256=digest(python),
            worker=str(worker),
            worker_sha256=digest(worker),
        )
        gate_fd = os.open(self.gate, os.O_RDONLY | os.O_DIRECTORY)
        try:
            with NativeSupervisor(
                executables,
                session_id="synthetic-supervisor-session",
                runtime_digest="a" * 64,
                temporary_directory=str(supervisor_cwd.resolve()),
            ) as supervisor:
                try:
                    result = supervisor.execute(
                        request,
                        owner_fds=(gate_fd,),
                    )
                except BaseException as error:
                    diagnostics = b"".join(
                        chunk
                        for _, chunk, _ in supervisor.diagnostics
                    ).decode("utf-8", errors="replace")
                    self.fail(
                        f"{type(error).__name__}: {error}; "
                        f"frames={[type(item).__name__ for item in supervisor.frames]}; "
                        f"returncode={supervisor.process.poll() if supervisor.process else None}\n"
                        f"{diagnostics}"
                    )
                self.assertIs(
                    type(result),
                    c.TombstoneRunFailed,
                )
                self.assertIs(
                    result.failure_code,
                    c.MaintenanceFailureCode.DURABILITY_PROFILE_UNSUPPORTED,
                )
            self.assertEqual(supervisor.session.state, "CLOSED")
        finally:
            os.close(gate_fd)


if __name__ == "__main__":
    unittest.main()
