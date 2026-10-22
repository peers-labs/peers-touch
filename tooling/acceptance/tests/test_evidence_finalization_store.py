from __future__ import annotations

import dataclasses
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling.acceptance.core import finalization_contracts as c
from tooling.acceptance.core.evidence_store import EvidenceStore
from tooling.acceptance.core.result_contracts import CanonicalResultTuple
from tooling.acceptance.tests import test_finalization_authority as authority
from tooling.acceptance.tests import test_finalization_store_contracts as fixtures


def write_contract(path: Path, value: object) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.write_bytes(c.canonical_json_bytes(value))


def install_enforcement(
    store: EvidenceStore,
    record: c.FinalizerRequirementRecord,
) -> c.FinalizerRequirementRecord:
    install_authorization, references = authority.install_authority()
    authorization = authority.authority_wire()
    authorization.update(
        gateId=record.requirement.gate_id,
        requiredFinalizerId=record.requirement.finalizer_id,
        requirementDigest=record.requirement_digest,
        configDigest=record.config_digest,
        sourceDigest=record.source_digest,
        protectedBaselineDigest=record.protected_baseline.digest(),
        maintenanceRuntime=install_authorization.maintenance_runtime.to_dict(),
        durabilityProfile=install_authorization.durability_profile.to_dict(),
        authoritySourceCommit=install_authorization.authority_source_commit,
    )
    authorization = authority.sign_authority(authorization)
    intent = authority.intent_wire(authorization)
    generation_payload = {
        "artifactKind": "acceptance-finalizer-enforcement-generation",
        "schemaVersion": 1,
        "generation": 1,
        "workspaceId": record.workspace_id,
        "gateId": record.requirement.gate_id,
        "requiredFinalizerId": record.requirement.finalizer_id,
        "activationIntent": intent,
        "activatedAt": intent["activatedAt"],
        "activationSourceCommit": intent["activationSourceCommit"],
        "priorLatestPointer": None,
        "priorLatestPointerDigest": None,
        "requirementDigest": record.requirement_digest,
        "configDigest": record.config_digest,
        "sourceDigest": record.source_digest,
        "protectedBaselineDigest": record.protected_baseline.digest(),
    }
    generation = {
        **generation_payload,
        "enforcementDigest": c.domain_separated_sha256(
            "pt.acceptance.finalization.enforcement.v1",
            generation_payload,
        ),
    }
    record = dataclasses.replace(
        record,
        enforcement_digest=generation["enforcementDigest"],
    )
    current = c.FinalizerEnforcementCurrent.create(
        workspace_id=record.workspace_id,
        gate_id=record.requirement.gate_id,
        required_finalizer_id=record.requirement.finalizer_id,
        generation=1,
        enforcement_digest=record.enforcement_digest,
    )
    activated = c.FinalizerEnforcementActivated.create(
        workspace_id=record.workspace_id,
        gate_id=record.requirement.gate_id,
        required_finalizer_id=record.requirement.finalizer_id,
        first_generation=1,
        first_enforcement_digest=record.enforcement_digest,
        activated_at=intent["activatedAt"],
        activation_source_commit=intent["activationSourceCommit"],
        activation_intent_digest=intent["intentDigest"],
    )
    self_claim_dir = (
        store.workspace_dir
        / record.requirement.gate_id
        / "claim-admission"
    )
    write_contract(
        self_claim_dir
        / "epochs"
        / f"{references['epoch'].coordinator_epoch_id}.json",
        references["epoch"].to_dict(),
    )
    write_contract(
        self_claim_dir / "current-epoch.json",
        references["current_epoch"].to_dict(),
    )
    write_contract(
        self_claim_dir
        / "pauses"
        / f"{references['pause'].coordinator_epoch_id}.json",
        references["pause"].to_dict(),
    )
    for job in references["jobs"]:
        write_contract(
            self_claim_dir
            / "jobs"
            / job.coordinator_epoch_id
            / f"{job.job_sequence}-{job.job_id}.json",
            job.to_dict(),
        )
    for completion in references["completions"]:
        write_contract(
            self_claim_dir
            / "completions"
            / completion.coordinator_epoch_id
            / f"{completion.job_sequence}.json",
            completion.to_dict(),
        )
    for intent in references["intents"]:
        emission_dir = (
            self_claim_dir
            / "emissions"
            / intent.coordinator_epoch_id
            / str(intent.job_sequence)
        )
        write_contract(emission_dir / "intent.json", intent.to_dict())
    for acknowledgement in references["acknowledgements"]:
        emission_dir = (
            self_claim_dir
            / "emissions"
            / acknowledgement.coordinator_epoch_id
            / str(acknowledgement.job_sequence)
        )
        write_contract(
            emission_dir / "acknowledged.json",
            acknowledgement.to_dict(),
        )
    interlock_payload = {
        "artifactKind": "acceptance-finalizer-publication-interlock",
        "schemaVersion": 1,
        "workspaceId": record.workspace_id,
        "gateId": record.requirement.gate_id,
        "requiredFinalizerId": record.requirement.finalizer_id,
        "installedAt": "2026-10-18T00:00:03+00:00",
        "installationSourceCommit": (
            install_authorization.authority_source_commit
        ),
        "proofAdmissionSourceDigest": (
            install_authorization.proof_admission_source_digest
        ),
        "authorization": install_authorization.to_dict(),
    }
    interlock = {
        **interlock_payload,
        "interlockDigest": c.domain_separated_sha256(
            "pt.acceptance.finalization.publication-interlock.v1",
            interlock_payload,
        ),
    }
    enforcement_dir = (
        store.workspace_dir
        / record.requirement.gate_id
        / "finalizer-enforcement"
    )
    write_contract(
        enforcement_dir / "publication-interlock.json",
        interlock,
    )
    write_contract(enforcement_dir / "activated.json", activated.to_dict())
    write_contract(enforcement_dir / "current.json", current.to_dict())
    write_contract(
        enforcement_dir / "generations" / "1.json",
        generation,
    )
    return record


def finalizer_outcome(
    finalizer_input: c.FinalizerInput,
) -> c.ChildGateEvidenceFinalization:
    invocation = finalizer_input.invocation
    child_payload = {
        "status": c.FinalizerOutcomeStatus.VALIDATED.value,
        "finalizerId": invocation.finalizer_id,
        "invocationDigest": invocation.invocation_digest,
        "finalizerInputDigest": finalizer_input.finalizer_input_digest,
        "snapshotDigest": invocation.snapshot_digest,
        "primaryResultDigest": invocation.primary_result_digest,
        "validatedRoleInstances": [
            list(item) for item in invocation.required_role_identities
        ],
        "failureCode": None,
        "diagnostic": None,
    }
    child = c.FinalizerChildOutcome.from_dict(
        {
            **child_payload,
            "childOutcomeDigest": c.domain_separated_sha256(
                "pt.acceptance.finalization.child-outcome.v1",
                child_payload,
            ),
        }
    )
    outcome_payload = {
        "origin": c.FinalizationOrigin.CHILD.value,
        "childOutcome": child.to_dict(),
    }
    return c.ChildGateEvidenceFinalization.from_dict(
        {
            **outcome_payload,
            "outcomeDigest": c.domain_separated_sha256(
                "pt.acceptance.finalization.outcome.v1",
                outcome_payload,
            ),
        }
    )


class EvidenceFinalizationStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name) / "evidence"
        worktree = Path(self.temporary.name) / "worktree"
        worktree.mkdir()
        self.workspace_patch = patch(
            "tooling.acceptance.core.evidence_store.workspace_id",
            return_value=fixtures.WORKSPACE_ID,
        )
        self.workspace_patch.start()
        self.store = EvidenceStore(root, worktree=worktree)

    def tearDown(self) -> None:
        self.workspace_patch.stop()
        self.temporary.cleanup()

    def required_run(self):
        record = install_enforcement(
            self.store,
            fixtures.requirement_record(),
        )
        source_capture = fixtures.source_capture(record)
        runtime_capture = fixtures.preflight_runtime_capture(record)
        supervisor_session = c.SupervisorSession(
            "synthetic-session",
            record.finalizer_runtime.supervisor_runtime_digest,
        )
        supervisor_session.state = "READY"
        run = self.store.begin_required_run(
            requirement_record=record,
            preflight_token=fixtures.preflight_token(record),
            source_capture=source_capture,
            runtime_capture=runtime_capture,
            supervisor_session=supervisor_session,
            immutable_artifacts=fixtures.immutable_artifacts(record),
        )
        self.assertTrue(source_capture.consumed)
        self.assertTrue(runtime_capture.consumed)
        return run, record, supervisor_session

    def test_required_run_seal_finalize_and_generation_publish(self) -> None:
        run, record, supervisor_session = self.required_run()
        executable_sources = tuple(
            item
            for item in record.captured_sources
            if item.executable_included
        )
        source_bundle = fixtures.capture_bundle(
            b"pt-finalizer-bundle-v1",
            [
                {
                    "repoRelativePath": item.repo_relative_path,
                    "fileSha256": item.file_sha256,
                    "byteLength": item.byte_length,
                }
                for item in executable_sources
            ],
            tuple(
                fixtures.source_bytes(item.repo_relative_path)
                for item in executable_sources
            ),
        )
        source_bundle_ref = run.write_bytes(
            "finalizer/source.bundle",
            source_bundle,
            role="finalizer-source-bundle",
        )
        executable = c.FinalizerExecutableArtifact.create(
            ref=c.ArtifactRef.from_dict(source_bundle_ref.to_dict()),
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
        runtime_payload = {
            "workspaceId": record.workspace_id,
            "gateId": record.requirement.gate_id,
            "runId": run.run_id,
            "sourceCommit": record.source_commit,
            "workspaceDigest": record.workspace_digest,
            "canonicalWorktreeHash": record.canonical_worktree_hash,
        }
        runtime_bytes = c.canonical_json_bytes(runtime_payload)
        runtime_ref = run.write_bytes(
            "runtime/manifest.json",
            runtime_bytes,
            media_type="application/json",
            role="synthetic-runtime",
        )
        runtime_contract_ref = c.ArtifactRef.from_dict(runtime_ref.to_dict())
        runtime_artifact = c.SnapshotArtifact(
            role_name="synthetic-runtime",
            discriminator=None,
            ref=runtime_contract_ref,
            payload=None,
            payload_digest=None,
        )
        run.register_finalization_artifact(runtime_artifact)
        snapshot = c.ReadOnlyEvidenceSnapshot.create(
            workspace_id=record.workspace_id,
            gate_id=record.requirement.gate_id,
            evidence_run_id=run.run_id,
            evaluation_time="2026-10-18T12:00:01+00:00",
            artifacts=(runtime_artifact,),
            runtime_manifest_ref=runtime_contract_ref,
            source_commit=record.source_commit,
            workspace_digest=record.workspace_digest,
            canonical_worktree_hash=record.canonical_worktree_hash,
        )
        source_trace = c.PrimaryResultSourceTrace.create(
            producer_id="synthetic-runner",
            source_commit=record.source_commit,
            invocation_id="synthetic-primary",
            evidence_refs=(runtime_contract_ref,),
        )
        primary_tuple = CanonicalResultTuple.PassedDoneProven
        primary = c.CanonicalPrimaryResult(
            document=c.CanonicalOpaqueJson.from_value(
                schema_id="acceptance-primary-result-v1",
                schema_digest="f" * 64,
                value={
                    **primary_tuple.to_dict(),
                    "reasonCode": None,
                    "sourceTrace": source_trace.to_dict(),
                },
            ),
            result_tuple=primary_tuple,
            reason_code=None,
            source_trace=source_trace,
        )
        identity_values = {
            "finalizer_id": record.requirement.finalizer_id,
            "finalizer_executable": executable,
            "finalizer_source_digest": record.source_digest,
            "finalizer_runtime": record.finalizer_runtime,
            "supervisor_session_id": "synthetic-session",
            "supervisor_runtime_digest": (
                record.finalizer_runtime.supervisor_runtime_digest
            ),
            "enforcement_generation": record.enforcement_generation,
            "enforcement_digest": record.enforcement_digest,
            "requirement_digest": record.requirement_digest,
            "config_digest": record.config_digest,
            "workspace_id": record.workspace_id,
            "gate_id": record.requirement.gate_id,
            "evidence_run_id": run.run_id,
            "provisioning_run_id": "synthetic-provisioning",
            "runtime_manifest_ref": runtime_contract_ref,
            "source_commit": record.source_commit,
            "workspace_digest": record.workspace_digest,
            "canonical_worktree_hash": record.canonical_worktree_hash,
            "snapshot_digest": snapshot.snapshot_digest,
            "required_role_identities": (("synthetic-runtime", None),),
            "primary_status": primary.result_tuple,
            "primary_result_digest": primary.digest(),
        }
        context = c.FinalizerContext.create(**identity_values)
        marker = c.SealedEvidenceMarker.create(
            snapshot=snapshot,
            finalizer_context=context,
            primary_result=primary,
            sealed_at="2026-10-18T12:00:02+00:00",
        )
        run.seal_for_finalization(marker)
        invocation = c.FinalizerInvocationIdentity.create(**identity_values)
        finalizer_input = c.FinalizerInput.create(
            invocation=invocation,
            context=context,
            snapshot=snapshot,
        )
        run.start_finalizer_invocation(finalizer_input)
        with self.assertRaises(Exception):
            run.start_finalizer_invocation(finalizer_input)
        supervisor_session.state = "CLOSED"
        run.cache_finalizer_outcome(
            finalizer_outcome(finalizer_input),
            supervisor_session=supervisor_session,
        )
        manifest = run.finalize_with_evidence()
        self.assertEqual(
            manifest["result"]["proofStatus"],
            "PROVEN",
        )
        self.assertEqual(
            manifest["result"]["evidenceFinalization"]["state"],
            "COMPLETED",
        )
        latest_path = (
            run.run_dir.parent
            / "finalizer-enforcement"
            / "latest"
            / "1.json"
        )
        latest = c.LatestPointer.from_dict(
            json.loads(latest_path.read_text(encoding="utf-8"))
        )
        self.assertEqual(latest.run_id, run.run_id)
        resolution = self.store.authoritative_latest(fixtures.GATE_ID)
        self.assertIs(
            resolution.authority_mode,
            c.LatestAuthorityMode.FINALIZER_ENFORCED,
        )
        self.assertEqual(resolution.manifest_ref.run_id, run.run_id)
        self.assertEqual(run.state, "LATEST_RESOLVED")
        run.close()
        self.assertEqual(run.state, "CLOSED")

    def test_required_allocation_is_atomic_and_one_shot(self) -> None:
        record = install_enforcement(
            self.store,
            fixtures.requirement_record(),
        )
        source_capture = fixtures.source_capture(record)
        runtime_capture = fixtures.preflight_runtime_capture(record)
        supervisor_session = c.SupervisorSession(
            "synthetic-session",
            record.finalizer_runtime.supervisor_runtime_digest,
        )
        supervisor_session.state = "READY"
        artifacts = fixtures.immutable_artifacts(record)
        changed = dict(artifacts)
        first_path = next(iter(changed))
        changed[first_path] = b"tampered"
        with self.assertRaises(Exception):
            self.store.begin_required_run(
                requirement_record=record,
                preflight_token=fixtures.preflight_token(record),
                source_capture=source_capture,
                runtime_capture=runtime_capture,
                supervisor_session=supervisor_session,
                immutable_artifacts=changed,
            )
        self.assertFalse(source_capture.consumed)
        self.assertFalse(runtime_capture.consumed)
        self.assertFalse(
            (
                self.store.workspace_dir
                / fixtures.GATE_ID
                / fixtures.RUN_ID
            ).exists()
        )
        run = self.store.begin_required_run(
            requirement_record=record,
            preflight_token=fixtures.preflight_token(record),
            source_capture=source_capture,
            runtime_capture=runtime_capture,
            supervisor_session=supervisor_session,
            immutable_artifacts=artifacts,
        )
        with self.assertRaises(Exception):
            self.store.begin_required_run(
                requirement_record=record,
                preflight_token=fixtures.preflight_token(record),
                source_capture=source_capture,
                runtime_capture=runtime_capture,
                supervisor_session=supervisor_session,
                immutable_artifacts=artifacts,
            )
        run.close()

    def test_pre_seal_failure_is_downgraded_and_authoritative(self) -> None:
        run, record, supervisor_session = self.required_run()
        evidence_ref = run.write_bytes(
            "reports/pre-seal.json",
            b'{"stage":"materializer"}',
            media_type="application/json",
            role="pre-seal-diagnostic",
        )
        contract_ref = c.ArtifactRef.from_dict(evidence_ref.to_dict())
        source_trace = c.PrimaryResultSourceTrace.create(
            producer_id="synthetic-runner",
            source_commit=record.source_commit,
            invocation_id="synthetic-pre-seal",
            evidence_refs=(contract_ref,),
        )
        primary_tuple = CanonicalResultTuple.PassedDoneProven
        primary = c.CanonicalPrimaryResult(
            document=c.CanonicalOpaqueJson.from_value(
                schema_id="acceptance-primary-result-v1",
                schema_digest="f" * 64,
                value={
                    **primary_tuple.to_dict(),
                    "reasonCode": None,
                    "sourceTrace": source_trace.to_dict(),
                },
            ),
            result_tuple=primary_tuple,
            reason_code=None,
            source_trace=source_trace,
        )
        supervisor_session.state = "CLOSED"
        manifest = run.finalize_pre_seal_failure(
            primary,
            supervisor_session=supervisor_session,
        )
        self.assertEqual(manifest["result"]["status"], "failed")
        self.assertEqual(
            manifest["result"]["evidenceFinalization"]["state"],
            "NOT_INVOKED_PRE_SEAL",
        )
        self.assertFalse((run.run_dir / "sealed.json").exists())
        resolution = self.store.authoritative_latest(fixtures.GATE_ID)
        self.assertIs(
            resolution.result_tuple,
            CanonicalResultTuple.FailedPartialUnproven,
        )
        run.close()


if __name__ == "__main__":
    unittest.main()
