from __future__ import annotations

import json
import hashlib
import pickle
import sys
import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.core import finalization_contracts as contracts
from tooling.acceptance.core.evidence_store import EvidenceStore
from tooling.acceptance.core.errors import EvidenceConflict, EvidenceManifestInvalid
from tooling.acceptance.core.trust_admission import (
    TrustAdmission,
    TrustDispatchBinding,
)


SHA_A = "a" * 64
SHA_B = "b" * 64
SHA_C = "c" * 64


def process_identity() -> contracts.ProcessStartIdentity:
    if sys.platform == "darwin":
        return contracts.DarwinProcessStartIdentity.create(
            boot_session_uuid="synthetic-boot",
            start_seconds="1",
            start_microseconds="2",
        )
    return contracts.LinuxProcessStartIdentity.create(
        boot_id="synthetic-boot",
        start_clock_ticks="1",
    )


class TrustAdmissionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        base = Path(self.temporary.name)
        self.worktree = base / "worktree"
        self.root = base / "artifacts"
        self.worktree.mkdir()
        self.store = EvidenceStore(self.root, worktree=self.worktree)
        self.gate_id = "synthetic-gate"
        self.trust_dir = (
            self.store.workspace_dir
            / self.gate_id
            / "finalizer-enforcement"
            / "controller-trust"
        )
        (self.trust_dir / "generations").mkdir(parents=True)
        self.generation = contracts.ActivePowerControllerTrustGeneration.create(
            workspace_id=self.store.workspace_id,
            gate_id=self.gate_id,
            trust_generation=1,
            predecessor_generation_ref=None,
            trust_anchor_digest=SHA_A,
        )
        self.current = contracts.PowerControllerTrustCurrent.create(
            workspace_id=self.store.workspace_id,
            gate_id=self.gate_id,
            generation_ref=self.generation.reference(),
        )
        anchor = {
            "artifactKind": "acceptance-power-controller-trust-anchor",
            "schemaVersion": 1,
            "workspaceId": self.store.workspace_id,
            "gateId": self.gate_id,
            "trustGeneration": 1,
            "predecessorGenerationRef": None,
            "controllerIdentity": {"kind": "synthetic"},
            "controllerSignatureAlgorithm": "ED25519",
            "controllerPublicKeyHex": "11" * 32,
            "controllerPublicKeySha256": hashlib.sha256(bytes.fromhex("11" * 32)).hexdigest(),
            "controllerRuntime": {"runtime": "synthetic"},
            "controllerRuntimeLockBackend": {"backend": "synthetic"},
            "bootstrapCandidateDigest": SHA_B,
            "qualificationManifestDigest": SHA_C,
            "qualifiedBackendIdentityDigest": SHA_B,
            "ownerApprovalDocumentPath": "docs/architecture/engineering/acceptance/decisions.md",
            "ownerApprovalDocumentSha256": SHA_C,
            "sourceCommit": "1" * 40,
            "enrolledAt": "2026-10-18T00:00:00+00:00",
            "enrollmentAuthorization": {"authorization": "synthetic"},
        }
        anchor["trustAnchorDigest"] = contracts.domain_separated_sha256(
            "pt.acceptance.finalization.durability-power-controller-trust-anchor.v1",
            anchor,
        )
        self.generation = contracts.ActivePowerControllerTrustGeneration.create(
            workspace_id=self.store.workspace_id,
            gate_id=self.gate_id,
            trust_generation=1,
            predecessor_generation_ref=None,
            trust_anchor_digest=anchor["trustAnchorDigest"],
        )
        self.current = contracts.PowerControllerTrustCurrent.create(
            workspace_id=self.store.workspace_id,
            gate_id=self.gate_id,
            generation_ref=self.generation.reference(),
        )
        (self.trust_dir / f"{anchor['trustAnchorDigest']}.json").write_text(
            json.dumps(anchor, sort_keys=True),
            encoding="utf-8",
        )
        (
            self.trust_dir
            / "generations"
            / (
                f"1-{self.generation.trust_generation_digest}.json"
            )
        ).write_text(
            json.dumps(self.generation.to_dict(), sort_keys=True),
            encoding="utf-8",
        )
        (self.trust_dir / "current.json").write_text(
            json.dumps(self.current.to_dict(), sort_keys=True),
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def binding(self) -> TrustDispatchBinding:
        return TrustDispatchBinding(
            controller_runtime_epoch_id="epoch-1",
            controller_runtime_epoch_digest=SHA_A,
            command_id="command-1",
            command_identity_digest=SHA_B,
            resolution_request_digest=SHA_C,
            expected_head_digest=SHA_A,
            command_lock_identity_digest=SHA_B,
            holder_process_start_identity=process_identity(),
        )

    def test_lease_holds_shared_lock_and_is_not_serializable(self) -> None:
        binding = self.binding()
        held = TrustAdmission(self.store).acquire_dispatch_lease(
            gate_id=self.gate_id,
            binding=binding,
            expected_generation_ref=self.generation.reference(),
            expected_current_trust_digest=self.current.current_trust_digest,
        )
        self.assertTrue(held.held)
        self.assertEqual(
            held.validate_for(
                workspace_id=self.store.workspace_id,
                gate_id=self.gate_id,
                binding=binding,
            ).selected_trust_generation_ref,
            self.generation.reference(),
        )
        with self.assertRaises(TypeError):
            pickle.dumps(held)
        with self.assertRaises(TypeError):
            pickle.dumps(held.lease)
        held.close()
        with self.assertRaises(EvidenceConflict):
            held.validate_for(
                workspace_id=self.store.workspace_id,
                gate_id=self.gate_id,
                binding=binding,
            )

    def test_changed_or_revoked_current_fails_closed(self) -> None:
        admission = TrustAdmission(self.store)
        with self.assertRaises(EvidenceManifestInvalid):
            admission.acquire_dispatch_lease(
                gate_id=self.gate_id,
                binding=self.binding(),
                expected_generation_ref=self.generation.reference(),
                expected_current_trust_digest=SHA_A,
            )
        revoked = self.generation.to_dict()
        revoked["state"] = "REVOKED"
        generation_path = (
            self.trust_dir
            / "generations"
            / f"1-{self.generation.trust_generation_digest}.json"
        )
        generation_path.write_text(json.dumps(revoked), encoding="utf-8")
        with self.assertRaises(EvidenceManifestInvalid):
            admission.acquire_dispatch_lease(
                gate_id=self.gate_id,
                binding=self.binding(),
                expected_generation_ref=self.generation.reference(),
                expected_current_trust_digest=self.current.current_trust_digest,
            )


if __name__ == "__main__":
    unittest.main()
