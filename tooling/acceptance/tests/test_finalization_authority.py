"""Synthetic D-19 authority branches and activation-chain integrity."""

from __future__ import annotations

import copy
import unittest

from tooling.acceptance.core import finalization_contracts as c
from tooling.acceptance.tests import test_finalization_durability_profiles as profiles
from tooling.acceptance.tests import test_finalization_durability_runtime as runtime
from tooling.acceptance.tests import test_finalization_maintenance_runtime as maintenance
from tooling.acceptance.tests import test_finalization_contracts as admission


def signed(payload, field, domain):
    return runtime.signed(payload, field, "pt.acceptance.finalization." + domain + ".v1")


def sign_authority(payload):
    payload = {key: value for key, value in payload.items()
               if key not in ("confirmationChallengeDigest", "authorizationDigest")}
    return signed(signed(payload, "confirmationChallengeDigest", "authority-confirmation"),
                  "authorizationDigest", "authority-authorization")


def authority_wire(generation=1):
    return sign_authority({
        "artifactKind": "acceptance-finalizer-authority-authorization", "schemaVersion": 1,
        "action": "ACTIVATE_GENERATION", "authorizationId": "synthetic-authorization",
        "operatorIdentity": c.AbortOperatorIdentity.create(effective_uid=1000).to_dict(),
        "workspaceId": "0123456789abcdef", "gateId": "synthetic-gate",
        "requiredFinalizerId": "synthetic-finalizer", "targetGeneration": generation,
        "expectedCurrentGeneration": None if generation == 1 else generation - 1,
        "expectedPriorLatestPointer": None, "expectedPriorLatestPointerDigest": None,
        "requirementDigest": "a" * 64, "configDigest": "b" * 64,
        "sourceDigest": "c" * 64, "protectedBaselineDigest": "d" * 64,
        "expectedInterlockDigest": "e" * 64,
        "proofAdmissionInventoryRule": "ALL_TRACKED_ACCEPTANCE_CLAIM_SOURCES",
        "proofAdmissionSourceDigest": "f" * 64, "proofAdmissionQuiescence": None,
        "maintenanceRuntime": maintenance.runtime_wire(), "durabilityProfile": profiles.profile_wire(),
        "authoritySourceCommit": "synthetic-source",
        "approvalDocumentPath": "docs/architecture/engineering/acceptance/decisions.md",
        "approvalDocumentSha256": "a" * 64, "decisionId": "D-19", "decisionStatus": "accepted",
        "authorizedAt": "2026-10-18T00:00:01+00:00",
    })


def intent_wire(authority=None):
    authority = authority or authority_wire()
    return signed({
        "artifactKind": "acceptance-finalizer-activation-intent", "schemaVersion": 1,
        **{field: authority[field] for field in (
            "workspaceId", "gateId", "requiredFinalizerId", "targetGeneration",
            "expectedCurrentGeneration", "expectedPriorLatestPointer", "expectedPriorLatestPointerDigest",
            "requirementDigest", "configDigest", "sourceDigest", "protectedBaselineDigest",
        )},
        "activatedAt": "2026-10-18T00:00:02+00:00",
        "activationSourceCommit": authority["authoritySourceCommit"], "authorization": authority,
    }, "intentDigest", "activation-intent")


def abort_wire():
    authority = authority_wire()
    run_id = "20261018T000000000000Z-" + "1" * 32
    claim = c.DescriptorClaim.create(
        device_id="1", inode="2",
        owner_binding=c.RunDirectoryOwnerBinding(
            authority["workspaceId"], authority["gateId"], run_id,
        ),
    )
    return signed({
        **{field: authority[field] for field in (
            "authorizationId", "authorizedAt", "operatorIdentity", "workspaceId",
            "gateId", "authoritySourceCommit", "proofAdmissionInventoryRule",
            "proofAdmissionSourceDigest", "maintenanceRuntime", "durabilityProfile",
        )},
        "attemptId": "synthetic-attempt", "reasonCode": "OPERATOR_REQUESTED_DISCARD",
        "evidenceRunId": run_id, "runDirectoryClaim": claim.to_dict(),
        "snapshotDigest": "a" * 64, "requirementDigest": "b" * 64,
    }, "confirmationChallengeDigest", "abort-confirmation")


def pending_wire(generation=1):
    intent = intent_wire(authority_wire(generation))
    record = signed({
        "artifactKind": "acceptance-finalizer-enforcement-generation", "schemaVersion": 1,
        "generation": generation,
        **{field: intent[field] for field in (
            "workspaceId", "gateId", "requiredFinalizerId", "activatedAt", "activationSourceCommit",
            "requirementDigest", "configDigest", "sourceDigest", "protectedBaselineDigest",
        )},
        "activationIntent": intent, "priorLatestPointer": intent["expectedPriorLatestPointer"],
        "priorLatestPointerDigest": intent["expectedPriorLatestPointerDigest"],
    }, "enforcementDigest", "enforcement")
    current = c.FinalizerEnforcementCurrent.create(
        workspace_id=intent["workspaceId"], gate_id=intent["gateId"],
        required_finalizer_id=intent["requiredFinalizerId"], generation=generation,
        enforcement_digest=record["enforcementDigest"],
    ).to_dict()
    activated = None if generation != 1 else c.FinalizerEnforcementActivated.create(
        workspace_id=intent["workspaceId"], gate_id=intent["gateId"],
        required_finalizer_id=intent["requiredFinalizerId"], first_generation=1,
        first_enforcement_digest=record["enforcementDigest"], activated_at=intent["activatedAt"],
        activation_source_commit=intent["activationSourceCommit"],
        activation_intent_digest=intent["intentDigest"],
    ).to_dict()
    return signed({
        "artifactKind": "acceptance-finalizer-activation-pending", "schemaVersion": 1,
        "intent": intent, "candidateEnforcementRecord": record,
        "candidateActivated": activated, "candidateCurrent": current,
    }, "pendingDigest", "activation-pending")


def install_authority():
    helper = admission.ProofAdmissionContractTest()
    epoch = helper.linux_epoch_and_termination()[0]
    pause = c.ProofAdmissionPauseRecord.create(
        workspace_id=epoch.workspace_id, gate_id=epoch.gate_id,
        coordinator_epoch_id=epoch.coordinator_epoch_id, epoch_digest=epoch.epoch_digest,
        claim_admission_lock_identity=epoch.claim_admission_lock_identity,
        claim_sequence_lock_identity=epoch.claim_sequence_lock_identity,
        last_accepted_job_sequence=0, paused_at="2026-10-18T00:00:00+00:00",
    )
    current = c.ProofAdmissionCurrentEpoch.create(
        workspace_id=epoch.workspace_id, gate_id=epoch.gate_id,
        coordinator_epoch_id=epoch.coordinator_epoch_id, epoch_digest=epoch.epoch_digest,
    )
    references = dict(epoch=epoch, current_epoch=current, pause=pause,
                      jobs=(), completions=(), intents=(), acknowledgements=())
    quiescence = c.ProofAdmissionQuiescence.create(
        workspace_id=epoch.workspace_id, gate_id=epoch.gate_id,
        coordinator_epoch_id=epoch.coordinator_epoch_id, epoch_digest=epoch.epoch_digest,
        current_epoch_digest=current.current_epoch_digest, source_commit=epoch.source_commit,
        proof_admission_source_digest=epoch.proof_admission_source_digest,
        claim_admission_lock_identity=epoch.claim_admission_lock_identity,
        claim_sequence_lock_identity=epoch.claim_sequence_lock_identity,
        pause_digest=pause.pause_digest, registered_jobs=(), terminal_job_completions=(),
        acknowledged_emissions=(), captured_at="2026-10-18T00:00:01+00:00", **references,
    )
    authority = c.FinalizerAuthorityAuthorization.from_dict(authority_wire())
    runtime_identity = authority.maintenance_runtime
    runtime_refs = tuple(c.AuthorityRuntimeArtifactRef.from_dict(maintenance.signed_ref({
        **ref.to_dict(), "gateId": epoch.gate_id,
    })) for ref in runtime_identity.runtime_artifacts)
    runtime_identity = c.FinalizerMaintenanceRuntimeIdentity.from_dict(maintenance.signed_runtime({
        **runtime_identity.to_dict(), "runtimeArtifacts": [ref.to_dict() for ref in runtime_refs],
    }))
    profile = authority.durability_profile.to_dict()
    evidence = profile["capabilityEvidence"]
    evidence["crashFixtureManifestRef"] = runtime.sign_blob({
        **evidence["crashFixtureManifestRef"], "gateId": epoch.gate_id,
    })
    evidence["crashFixtureArtifacts"] = [runtime.sign_blob({**ref, "gateId": epoch.gate_id})
                                         for ref in evidence["crashFixtureArtifacts"]]
    evidence["controllerTrustAnchorRef"] = signed({
        **evidence["controllerTrustAnchorRef"], "gateId": epoch.gate_id,
    }, "trustAnchorRefDigest", "durability-power-controller-trust-anchor-ref")
    profile["capabilityEvidence"] = profiles.sign_capability(evidence)
    profile = c.proof_authority_durability_profile_from_dict(profiles.sign_profile(profile))
    wire = sign_authority({
        **authority.to_dict(), "action": "INSTALL_INTERLOCK", "gateId": epoch.gate_id,
        "authoritySourceCommit": epoch.source_commit,
        "proofAdmissionSourceDigest": epoch.proof_admission_source_digest,
        "targetGeneration": None, "expectedCurrentGeneration": None, "requirementDigest": None,
        "configDigest": None, "sourceDigest": None, "protectedBaselineDigest": None,
        "expectedInterlockDigest": None, "proofAdmissionQuiescence": quiescence.to_dict(),
        "maintenanceRuntime": runtime_identity.to_dict(), "durabilityProfile": profile.to_dict(),
        "authorizedAt": "2026-10-18T00:00:02+00:00",
    })
    return c.FinalizerAuthorityAuthorization.from_dict(wire, **references), references


class AuthorityContractTests(unittest.TestCase):
    def test_abort_authorization_roundtrip_and_closed_fields(self):
        wire = abort_wire()
        for reason in c.AbortReasonCode:
            candidate = signed({**wire, "reasonCode": reason.value},
                               "confirmationChallengeDigest", "abort-confirmation")
            self.assertEqual(c.AbortAuthorization.from_dict(candidate).to_dict(), candidate)
        for field in wire:
            changed = dict(wire)
            changed.pop(field)
            with self.subTest(missing=field), self.assertRaises(ValueError):
                c.AbortAuthorization.from_dict(changed)
        for field, value in (
            ("reasonCode", "UNKNOWN"), ("attemptId", ""),
            ("evidenceRunId", "other-run"), ("snapshotDigest", None),
            ("proofAdmissionInventoryRule", "PARTIAL"), ("path", "/tmp"),
            ("authorizationId", "other-authorization"),
            ("workspaceId", "fedcba9876543210"), ("gateId", "other-gate"),
        ):
            with self.subTest(field=field), self.assertRaises(ValueError):
                c.AbortAuthorization.from_dict(signed({**wire, field: value},
                    "confirmationChallengeDigest", "abort-confirmation"))
        with self.assertRaisesRegex(ValueError, "confirmationChallengeDigest"):
            c.AbortAuthorization.from_dict({**wire, "snapshotDigest": "0" * 64})

    def test_abort_authorization_rejects_resigned_nested_identity_substitution(self):
        wire = abort_wire()
        for owner in (
            c.GateDirectoryOwnerBinding(wire["workspaceId"], wire["gateId"]),
            c.RunDirectoryOwnerBinding(wire["workspaceId"], wire["gateId"],
                "20261018T000000000000Z-" + "2" * 32),
        ):
            claim = c.DescriptorClaim.create(device_id="1", inode="2", owner_binding=owner)
            with self.subTest(owner=owner), self.assertRaisesRegex(ValueError, "exact run identity"):
                c.AbortAuthorization.from_dict(signed({
                    **wire, "runDirectoryClaim": claim.to_dict(),
                }, "confirmationChallengeDigest", "abort-confirmation"))
        changed = copy.deepcopy(wire)
        changed["runDirectoryClaim"]["ownerBinding"]["unexpected"] = True
        with self.assertRaises(ValueError):
            c.AbortAuthorization.from_dict(signed(changed, "confirmationChallengeDigest", "abort-confirmation"))
        changed = copy.deepcopy(wire)
        for ref in changed["maintenanceRuntime"]["runtimeArtifacts"]:
            ref.update(maintenance.signed_ref({**ref, "authorizationId": "other-authorization"}))
        changed["maintenanceRuntime"] = maintenance.signed_runtime(changed["maintenanceRuntime"])
        with self.assertRaisesRegex(ValueError, "enclosing authorization"):
            c.AbortAuthorization.from_dict(signed(changed, "confirmationChallengeDigest", "abort-confirmation"))

    def test_interlock_resolves_quiescence_and_time(self):
        authority, references = install_authority()
        wire = signed({
            "artifactKind": "acceptance-finalizer-publication-interlock", "schemaVersion": 1,
            "workspaceId": authority.workspace_id, "gateId": authority.gate_id,
            "requiredFinalizerId": authority.required_finalizer_id,
            "installedAt": "2026-10-18T00:00:03+00:00",
            "installationSourceCommit": authority.authority_source_commit,
            "proofAdmissionSourceDigest": authority.proof_admission_source_digest,
            "authorization": authority.to_dict(),
        }, "interlockDigest", "publication-interlock")
        self.assertEqual(c.FinalizerPublicationInterlock.from_dict(wire, **references).to_dict(), wire)
        with self.assertRaises(ValueError):
            c.FinalizerPublicationInterlock.from_dict(wire)
        for field, value in (
            ("installedAt", "2026-10-18T00:00:01+00:00"),
            ("installationSourceCommit", "other-source"), ("proofAdmissionSourceDigest", "0" * 64),
        ):
            with self.subTest(field=field), self.assertRaises(ValueError):
                c.FinalizerPublicationInterlock.from_dict(signed({**wire, field: value}, "interlockDigest", "publication-interlock"), **references)
        wire["installedAt"] = "2026-10-18T00:00:02.100000+00:00"
        self.assertEqual(
            c.FinalizerPublicationInterlock.from_dict(
                signed(wire, "interlockDigest", "publication-interlock"), **references,
            ).installed_at, wire["installedAt"],
        )
        quiescence = authority.proof_admission_quiescence.to_dict()
        quiescence["capturedAt"] = "2026-10-18T00:00:02.100000+00:00"
        quiescence = signed(quiescence, "quiescenceDigest", "proof-admission-quiescence")
        with self.assertRaises(ValueError):
            c.FinalizerAuthorityAuthorization.from_dict(sign_authority({
                **authority.to_dict(), "proofAdmissionQuiescence": quiescence,
            }), **references)

    def test_authority_closed_branches_and_resigned_mismatch(self):
        for generation in (1, 2, 10):
            wire = authority_wire(generation)
            self.assertEqual(c.FinalizerAuthorityAuthorization.from_dict(wire).to_dict(), wire)
        wire = authority_wire()
        for field in wire:
            changed = dict(wire)
            changed.pop(field)
            with self.subTest(missing=field), self.assertRaises(ValueError):
                c.FinalizerAuthorityAuthorization.from_dict(changed)
        for field, value in (
            ("schemaVersion", True), ("action", "UNKNOWN"), ("targetGeneration", True),
            ("targetGeneration", 0), ("expectedCurrentGeneration", 0),
            ("authorizationId", "other-authorization"), ("workspaceId", "fedcba9876543210"),
            ("expectedPriorLatestPointerDigest", "a" * 64), ("requirementDigest", None),
            ("proofAdmissionInventoryRule", "PARTIAL"), ("decisionStatus", "proposed"),
            ("approvalDocumentPath", "other.md"), ("path", "/tmp"),
        ):
            with self.subTest(field=field), self.assertRaises(ValueError):
                c.FinalizerAuthorityAuthorization.from_dict(sign_authority({**wire, field: value}))
        with self.assertRaises(ValueError):
            c.FinalizerAuthorityAuthorization.from_dict(sign_authority({
                **authority_wire(3), "expectedCurrentGeneration": 1,
            }))
        for field in ("authorizationDigest", "confirmationChallengeDigest"):
            with self.subTest(digest=field), self.assertRaises(ValueError):
                c.FinalizerAuthorityAuthorization.from_dict({**wire, field: "0" * 64})
        changed = copy.deepcopy(wire)
        for ref in changed["maintenanceRuntime"]["runtimeArtifacts"]:
            ref["authorizationId"] = "other-authorization"
            ref.update(maintenance.signed_ref(ref))
        changed["maintenanceRuntime"] = maintenance.signed_runtime(changed["maintenanceRuntime"])
        with self.assertRaises(ValueError):
            c.FinalizerAuthorityAuthorization.from_dict(sign_authority(changed))

    def test_intent_and_enforcement_bind_exact_authority(self):
        wire = intent_wire()
        self.assertEqual(c.FinalizerActivationIntent.from_dict(wire).to_dict(), wire)
        for field in wire:
            changed = dict(wire)
            changed.pop(field)
            with self.subTest(missing=field), self.assertRaises(ValueError):
                c.FinalizerActivationIntent.from_dict(changed)
        for field, value in (
            ("targetGeneration", 2), ("workspaceId", "fedcba9876543210"),
            ("sourceDigest", "0" * 64), ("activatedAt", "2026-10-18T00:00:00+00:00"),
            ("activationSourceCommit", "other-source"), ("path", "/tmp"),
        ):
            with self.subTest(field=field), self.assertRaises(ValueError):
                c.FinalizerActivationIntent.from_dict(signed({**wire, field: value}, "intentDigest", "activation-intent"))
        record = pending_wire()["candidateEnforcementRecord"]
        self.assertEqual(c.FinalizerEnforcementRecord.from_dict(record).to_dict(), record)
        for field, value in (("generation", True), ("sourceDigest", "0" * 64), ("priorLatestPointerDigest", "a" * 64)):
            with self.subTest(record=field), self.assertRaises(ValueError):
                c.FinalizerEnforcementRecord.from_dict(signed({**record, field: value}, "enforcementDigest", "enforcement"))

    def test_pending_candidate_generation_and_sentinel_consistency(self):
        for generation in (1, 2):
            wire = pending_wire(generation)
            self.assertEqual(c.FinalizerActivationPending.from_dict(wire).to_dict(), wire)
            changed = copy.deepcopy(wire)
            changed["candidateActivated"] = pending_wire(1)["candidateActivated"] if generation == 2 else None
            with self.subTest(generation=generation), self.assertRaises(ValueError):
                c.FinalizerActivationPending.from_dict(signed(changed, "pendingDigest", "activation-pending"))
        for branch, field, digest, domain in (
            ("candidateCurrent", "enforcementDigest", "currentDigest", "enforcement-current"),
            ("candidateActivated", "activationIntentDigest", "activatedDigest", "enforcement-activated"),
            ("candidateEnforcementRecord", "configDigest", "enforcementDigest", "enforcement"),
        ):
            changed = pending_wire()
            changed[branch] = signed({**changed[branch], field: "0" * 64}, digest, domain)
            with self.subTest(branch=branch), self.assertRaises(ValueError):
                c.FinalizerActivationPending.from_dict(signed(changed, "pendingDigest", "activation-pending"))

    def test_intent_time_orders_microseconds_after_whole_second(self):
        wire = intent_wire()
        wire["activatedAt"] = "2026-10-18T00:00:01.100000+00:00"
        wire = signed(wire, "intentDigest", "activation-intent")
        self.assertEqual(c.FinalizerActivationIntent.from_dict(wire).activated_at, wire["activatedAt"])
        authority = authority_wire()
        authority["authorizedAt"] = "2026-10-18T00:00:01.100000+00:00"
        wire = intent_wire(sign_authority(authority))
        wire["activatedAt"] = "2026-10-18T00:00:01+00:00"
        with self.assertRaises(ValueError):
            c.FinalizerActivationIntent.from_dict(signed(wire, "intentDigest", "activation-intent"))
