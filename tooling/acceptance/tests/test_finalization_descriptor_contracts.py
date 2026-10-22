"""D-19 descriptor transfer identity admission tests."""

from __future__ import annotations

import copy
import dataclasses
import unittest

from tooling.acceptance.core.finalization_contracts import (
    DescriptorClaim,
    DescriptorRole,
    GateDirectoryOwnerBinding,
    RepositoryRootOwnerBinding,
    RunDirectoryOwnerBinding,
    TemporaryDirectoryOwnerBinding,
    WorkerKind,
    WorkerRequestIdentity,
    descriptor_owner_binding_from_dict,
    domain_separated_sha256,
    worker_descriptor_roles,
)


class DescriptorContractsTests(unittest.TestCase):
    def owners(self):
        return (
            GateDirectoryOwnerBinding("0123456789abcdef", "synthetic-gate"),
            RunDirectoryOwnerBinding(
                "0123456789abcdef",
                "synthetic-gate",
                "20260831T120102123456Z-0123456789abcdef0123456789abcdef",
            ),
            RepositoryRootOwnerBinding(
                "0123456789abcdef", "synthetic-commit", "a" * 64, "b" * 64
            ),
            TemporaryDirectoryOwnerBinding("session-1", "request-1", "nonce-1"),
        )

    def claim(self, owner, *, inode="2"):
        return DescriptorClaim.create(device_id="1", inode=inode, owner_binding=owner)

    def identity(self, kind, claims):
        return WorkerRequestIdentity.create(
            supervisor_session_id="session-1",
            request_id="request-1",
            sequence=1,
            worker_kind=kind,
            descriptor_claims=claims,
            request_payload_digest="c" * 64,
        )

    def test_owner_binding_closed_branches(self):
        for owner in self.owners():
            with self.subTest(role=owner.role.value):
                wire = owner.to_dict()
                self.assertEqual(descriptor_owner_binding_from_dict(wire), owner)
                for key in wire:
                    missing = dict(wire)
                    missing.pop(key)
                    with self.assertRaises(ValueError):
                        descriptor_owner_binding_from_dict(missing)
                for extra in ("artifactRoot", "credentials", "roleOverride"):
                    with self.assertRaises(ValueError):
                        descriptor_owner_binding_from_dict({**wire, extra: "value"})
        for invalid in (None, [], {"role": []}, {"role": "FILE"}):
            with self.subTest(invalid=invalid):
                with self.assertRaises(ValueError):
                    descriptor_owner_binding_from_dict(invalid)

    def test_claim_roundtrip_and_complete_digest_binding(self):
        for owner in self.owners():
            with self.subTest(role=owner.role.value):
                claim = self.claim(owner)
                wire = claim.to_dict()
                self.assertEqual(DescriptorClaim.from_dict(wire), claim)
                owner_digest = domain_separated_sha256(
                    "pt.acceptance.finalization.descriptor-owner-binding.v1",
                    wire["ownerBinding"],
                )
                self.assertEqual(wire["ownerBindingDigest"], owner_digest)
                payload = dict(wire)
                digest = payload.pop("descriptorClaimDigest")
                self.assertEqual(
                    digest,
                    domain_separated_sha256(
                        "pt.acceptance.finalization.descriptor-claim.v1", payload
                    ),
                )
                for key, changed in (
                    ("deviceId", "3"),
                    ("inode", "4"),
                    ("fileType", "REGULAR_FILE"),
                    ("role", "TEMPORARY_DIRECTORY"),
                    ("ownerBindingDigest", "d" * 64),
                    ("descriptorClaimDigest", "e" * 64),
                ):
                    mutated = {**wire, key: changed}
                    if mutated == wire:
                        continue
                    with self.subTest(changed=key):
                        with self.assertRaises(ValueError):
                            DescriptorClaim.from_dict(mutated)
                for key in wire:
                    missing = dict(wire)
                    missing.pop(key)
                    with self.assertRaises(ValueError):
                        DescriptorClaim.from_dict(missing)
                with self.assertRaises(ValueError):
                    DescriptorClaim.from_dict({**wire, "extra": None})
                mutated = copy.deepcopy(wire)
                owner_wire = mutated["ownerBinding"]
                target = next(key for key in owner_wire if key != "role")
                owner_wire[target] = "rebound"
                with self.assertRaises(ValueError):
                    DescriptorClaim.from_dict(mutated)

    def test_uint64_decimal_boundaries(self):
        owner = self.owners()[0]
        for field in ("device_id", "inode"):
            for valid in ("0", "1", "18446744073709551615"):
                with self.subTest(field=field, valid=valid):
                    values = {"device_id": "1", "inode": "2", field: valid}
                    claim = DescriptorClaim.create(**values, owner_binding=owner)
                    self.assertEqual(getattr(claim, field), valid)
            for invalid in (
                None, True, 1, "", "-1", "+1", "00", "01", " 1",
                "1 ", "1.0", "1e2", "١", "18446744073709551616", "9" * 21,
            ):
                with self.subTest(field=field, invalid=invalid):
                    values = {"device_id": "1", "inode": "2", field: invalid}
                    with self.assertRaises(ValueError):
                        DescriptorClaim.create(**values, owner_binding=owner)

    def test_worker_matrix_roundtrip_and_identity_mutation(self):
        owners = {owner.role: owner for owner in self.owners()}
        expected = {
            WorkerKind.AUTHORITY_RUNTIME_PERSISTER: (
                DescriptorRole.GATE_DIRECTORY, DescriptorRole.TEMPORARY_DIRECTORY,
            ),
            WorkerKind.MAINTENANCE: (DescriptorRole.GATE_DIRECTORY,),
            WorkerKind.BUNDLE_PREPARER: (
                DescriptorRole.REPOSITORY_ROOT, DescriptorRole.TEMPORARY_DIRECTORY,
            ),
            WorkerKind.RUNTIME_CAPTURE: (DescriptorRole.TEMPORARY_DIRECTORY,),
            WorkerKind.MATERIALIZER: (DescriptorRole.RUN_DIRECTORY,),
            WorkerKind.FINALIZER: (),
        }
        for kind, roles in expected.items():
            with self.subTest(kind=kind.value):
                self.assertEqual(worker_descriptor_roles(kind), roles)
                claims = tuple(
                    self.claim(owners[role], inode=str(index + 2))
                    for index, role in enumerate(roles)
                )
                identity = self.identity(kind, claims)
                wire = identity.to_dict()
                self.assertEqual(WorkerRequestIdentity.from_dict(wire), identity)
                payload = dict(wire)
                digest = payload.pop("requestIdentityDigest")
                self.assertEqual(
                    digest,
                    domain_separated_sha256(
                        "pt.acceptance.finalization.worker-request-identity.v1",
                        payload,
                    ),
                )
                for key, changed in (
                    ("supervisorSessionId", "session-2"),
                    ("requestId", "request-2"),
                    ("sequence", 2),
                    ("workerKind", "MAINTENANCE"),
                    ("requestPayloadDigest", "d" * 64),
                    ("requestIdentityDigest", "e" * 64),
                ):
                    if wire[key] == changed:
                        continue
                    with self.subTest(changed=key):
                        with self.assertRaises(ValueError):
                            WorkerRequestIdentity.from_dict({**wire, key: changed})
                for key in wire:
                    missing = dict(wire)
                    missing.pop(key)
                    with self.assertRaises(ValueError):
                        WorkerRequestIdentity.from_dict(missing)
                with self.assertRaises(ValueError):
                    WorkerRequestIdentity.from_dict({**wire, "extra": None})
                with self.assertRaises(ValueError):
                    WorkerRequestIdentity.from_dict(
                        {**wire, "descriptorClaims": tuple(wire["descriptorClaims"])}
                    )
                if roles:
                    with self.assertRaises(ValueError):
                        self.identity(kind, claims[:-1])
                with self.assertRaises(ValueError):
                    self.identity(kind, (*claims, self.claim(self.owners()[0])))
                if len(claims) == 2:
                    with self.assertRaises(ValueError):
                        self.identity(kind, tuple(reversed(claims)))

    def test_request_rejects_cross_session_temp_and_directory_alias(self):
        repo_owner = self.owners()[2]
        temp_owner = self.owners()[3]
        for changed in (
            dataclasses.replace(temp_owner, request_id="request-2"),
            dataclasses.replace(temp_owner, supervisor_session_id="session-2"),
        ):
            with self.subTest(changed=changed):
                with self.assertRaisesRegex(ValueError, "another request"):
                    self.identity(WorkerKind.RUNTIME_CAPTURE, (self.claim(changed),))
        with self.assertRaisesRegex(ValueError, "distinct directories"):
            self.identity(
                WorkerKind.BUNDLE_PREPARER,
                (self.claim(repo_owner), self.claim(temp_owner)),
            )
        for kind in (None, "FINALIZER", [], 1):
            with self.subTest(kind=kind):
                with self.assertRaises(ValueError):
                    worker_descriptor_roles(kind)
                with self.assertRaises(ValueError):
                    self.identity(kind, ())
        for invalid in ([], (None,), (self.owners()[0],)):
            with self.subTest(claims=invalid):
                with self.assertRaises(ValueError):
                    self.identity(WorkerKind.FINALIZER, invalid)

    def test_sequence_and_native_contract_types(self):
        identity = self.identity(WorkerKind.FINALIZER, ())
        for invalid in (0, -1, True, 1.0, None, 9007199254740992):
            with self.subTest(sequence=invalid):
                with self.assertRaises(ValueError):
                    dataclasses.replace(identity, sequence=invalid)
        for changes in (
            {"supervisor_session_id": ""},
            {"request_id": "../request"},
            {"worker_kind": "FINALIZER"},
            {"descriptor_claims": []},
        ):
            with self.subTest(changes=changes):
                with self.assertRaises(ValueError):
                    dataclasses.replace(identity, **changes)
        claim = self.claim(self.owners()[0])
        for changes in (
            {"role": "GATE_DIRECTORY"},
            {"owner_binding": claim.owner_binding.to_dict()},
            {"role": DescriptorRole.RUN_DIRECTORY},
            {"file_type": "FILE"},
        ):
            with self.subTest(changes=changes):
                with self.assertRaises(ValueError):
                    dataclasses.replace(claim, **changes)
