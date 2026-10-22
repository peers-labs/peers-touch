"""Synthetic witness credentials; these checks do not qualify any power backend."""

from __future__ import annotations

import copy
import hashlib
import pickle
import unittest

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, utils
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from tooling.acceptance.core import finalization_contracts as c
from tooling.acceptance.core.errors import EvidenceManifestInvalid
from tooling.acceptance.core.power_controller import (
    Ed25519SigningAuthority,
    P256QualificationWitness,
)


P256_ORDER = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551


class ControllerWitnessTests(unittest.TestCase):
    def setUp(self) -> None:
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.public = self.key.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )

        def sign(message):
            r, s = utils.decode_dss_signature(
                self.key.sign(message, ec.ECDSA(hashes.SHA256()))
            )
            return r.to_bytes(32, "big") + min(s, P256_ORDER - s).to_bytes(32, "big")

        self.witness = P256QualificationWitness(self.public, sign)
        self.authorization = c.ControllerStoreQualificationWitnessAuthorization.create(
            operator_identity=c.AbortOperatorIdentity.create(effective_uid=1000),
            workspace_id="0123456789abcdef", gate_id="synthetic-gate",
            bootstrap_candidate_digest="a" * 64,
            crash_fixture_id="synthetic-fixture", qualification_run_id="qualification-run",
            qualification_id="qualification-1",
            subject_controller_identity_digest="b" * 64,
            witness_public_key_hex=self.public.hex(),
            owner_approval_document_path="docs/architecture/engineering/acceptance/decisions.md",
            owner_approval_document_sha256="c" * 64,
            authority_source_commit="1" * 40,
            authorized_at="2026-10-19T00:00:00+00:00",
        )

    def test_authorization_and_identity_round_trip_and_scope(self) -> None:
        authorization = self.authorization
        self.assertEqual(c.ControllerStoreQualificationWitnessAuthorization.from_dict(authorization.to_dict()), authorization)
        identity = c.ControllerStoreQualificationWitnessIdentity.create(authorization)
        self.assertEqual(c.ControllerStoreQualificationWitnessIdentity.from_dict(identity.to_dict()), identity)
        self.assertEqual(authorization.witness_id, self.witness.witness_id)
        self.assertFalse(identity.to_dict()["productionAuthorityEligible"])
        self.assertEqual(authorization.witness_public_key_sha256, hashlib.sha256(self.public).hexdigest())

    def test_every_authorization_field_mutation_is_rejected(self) -> None:
        wire = self.authorization.to_dict()
        for field, value in wire.items():
            with self.subTest(field=field):
                mutation = copy.deepcopy(wire)
                mutation[field] = None if value is not None else "unexpected"
                with self.assertRaises((ValueError, TypeError)):
                    c.ControllerStoreQualificationWitnessAuthorization.from_dict(mutation)
        for field in ("extra", "privateKeyHex"):
            mutation = {**wire, field: "unexpected"}
            with self.assertRaises(ValueError):
                c.ControllerStoreQualificationWitnessAuthorization.from_dict(mutation)

    def test_every_identity_copy_is_bound_to_authorization(self) -> None:
        wire = c.ControllerStoreQualificationWitnessIdentity.create(self.authorization).to_dict()
        for field in wire:
            with self.subTest(field=field):
                mutation = copy.deepcopy(wire)
                mutation[field] = None
                with self.assertRaises((ValueError, TypeError)):
                    c.ControllerStoreQualificationWitnessIdentity.from_dict(mutation)

    def test_invalid_sec1_and_production_key_substitution(self) -> None:
        ed = Ed25519PrivateKey.generate().public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw
        )
        for encoded in (ed, bytes(65), b"\x04" + b"\xff" * 64, self.public[:33]):
            with self.subTest(length=len(encoded)):
                with self.assertRaises(ValueError):
                    P256QualificationWitness(encoded)
        with self.assertRaises(ValueError):
            Ed25519SigningAuthority(self.public, lambda message: bytes(64))
        with self.assertRaises(ValueError):
            c.ControllerStoreQualificationWitnessAuthorization.from_dict({
                **self.authorization.to_dict(),
                "witnessSignatureAlgorithm": "ED25519",
                "witnessPublicKeyHex": ed.hex(),
            })

    def test_phase_payload_and_low_s_verification(self) -> None:
        payload = {"qualificationRunId": "qualification-run", "caseId": "case-1"}
        signature = self.witness.sign_payload("RECOVERY", payload)
        self.witness.verify_payload("RECOVERY", payload, signature)
        for phase, value, encoded in (
            ("INTERRUPTION", payload, signature),
            ("RECOVERY", {**payload, "caseId": "case-2"}, signature),
            ("PRODUCTION", payload, signature),
            ("RECOVERY", payload, signature.upper()),
            ("RECOVERY", payload, "0" * 128),
        ):
            with self.subTest(phase=phase, value=value):
                with self.assertRaises(EvidenceManifestInvalid):
                    self.witness.verify_payload(phase, value, encoded)
        raw = bytes.fromhex(signature)
        high_s = raw[:32] + (P256_ORDER - int.from_bytes(raw[32:], "big")).to_bytes(32, "big")
        with self.assertRaises(EvidenceManifestInvalid):
            self.witness.verify_payload("RECOVERY", payload, high_s.hex())
        with self.assertRaises(TypeError):
            pickle.dumps(self.witness)

    def test_ed25519_strict_point_and_scalar_encodings(self) -> None:
        for point in (bytes(32), b"\x01" + bytes(31), b"\xff" * 32):
            with self.assertRaises(ValueError):
                Ed25519SigningAuthority(point, lambda message: bytes(64))
        key = Ed25519PrivateKey.generate()
        public = key.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw
        )
        authority = Ed25519SigningAuthority(public, key.sign)
        payload = {"artifactKind": "acceptance-power-controller-runtime-epoch"}
        signature = authority.sign_payload(payload)
        authority.verify_payload(payload, signature)
        order = 2**252 + 27742317777372353535851937790883648493
        raw = bytes.fromhex(signature)
        for invalid in (
            signature.upper(),
            (bytes(32) + raw[32:]).hex(),
            (raw[:32] + order.to_bytes(32, "little")).hex(),
            (raw[:32] + (int.from_bytes(raw[32:], "little") + order).to_bytes(32, "little")).hex(),
        ):
            with self.assertRaises(EvidenceManifestInvalid):
                authority.verify_payload(payload, invalid)


if __name__ == "__main__":
    unittest.main()
