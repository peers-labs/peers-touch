"""Synthetic capability and OS-specific durability profile validation."""

from __future__ import annotations

import copy
import unittest

from tooling.acceptance.core import finalization_contracts as c
from tooling.acceptance.tests import test_finalization_durability_runtime as runtime
from tooling.acceptance.tests import test_finalization_runtime_measurement as measurement
from tooling.acceptance.tests import test_finalization_maintenance_runtime as maintenance


def sign_capability(payload):
    return runtime.signed(payload, "capabilityEvidenceDigest",
                          "pt.acceptance.finalization.durability-capability-evidence.v1")


def capability_wire(os_family=c.RuntimeOsFamily.LINUX):
    build = measurement.platform(os_family).host_build
    if os_family is c.RuntimeOsFamily.LINUX:
        host = c.LinuxRuntimeHostIdentity.create(host_build=build, machine_id_hash="a" * 64)
        volume = c.LinuxStableVolumeIdentity.create(filesystem_type="ext4", filesystem_uuid="synthetic-volume")
        backend = "LINUX_FILE_AND_DIRECTORY_FSYNC_V1"
        operations = ["SYNC_FILE", "SYNC_DIRECTORY"]
    else:
        host = c.DarwinRuntimeHostIdentity.create(host_build=build, hardware_identity_hash="a" * 64)
        volume = c.DarwinStableVolumeIdentity.create(volume_uuid="synthetic-volume", container_uuid="synthetic-container")
        backend = "DARWIN_APFS_FULLFSYNC_V1"
        operations = ["SYNC_FILE", "SYNC_DIRECTORY", "SYNC_ANCHOR"]
    probe = runtime.runtime_wire()
    sources = [["tooling/acceptance/core/finalizer_worker.py", "a" * 64, 100]]
    refs = []
    for index, name in enumerate((
        c.DurabilityCapabilityArtifactName.EXPECTATION,
        c.DurabilityCapabilityArtifactName.MANIFEST,
        c.DurabilityCapabilityArtifactName.PROBE_RUNTIME_MANIFEST,
        c.DurabilityCapabilityArtifactName.CONTROLLER_RUNTIME_EPOCH,
        c.DurabilityCapabilityArtifactName.CONTROLLER_RUNTIME_CURRENT,
    )):
        refs.append(c.DurabilityCapabilityArtifactRef.create(
            workspace_id="0123456789abcdef", gate_id="synthetic-gate",
            crash_fixture_id="synthetic-fixture", artifact_name=name,
            object_digest=probe["probeRuntimeDigest"] if name is c.DurabilityCapabilityArtifactName.PROBE_RUNTIME_MANIFEST else str(index + 1) * 64,
            content_sha256="e" * 64, byte_length=100,
        ).to_dict())
    return sign_capability({
        "evidenceRule": "DURABILITY_CAPABILITY_EVIDENCE_V1", "osFamily": os_family.value,
        "backend": backend, "stableVolumeIdentity": volume.to_dict(),
        "qualifiedHostBuild": build.to_dict(), "qualifiedHostIdentity": host.to_dict(),
        "filesystemImplementationVersion": "synthetic-filesystem", "requiredMountOptions": ["rw"],
        "probeSourceFiles": sources,
        "probeSourceDigest": c.domain_separated_sha256("pt.acceptance.finalization.durability-probe-source.v1", sources),
        "probeRuntimeDigest": probe["probeRuntimeDigest"], "successfulOperations": operations,
        "crashFixtureId": "synthetic-fixture", "qualificationRunId": "synthetic-qualification",
        "crashFixtureManifestRef": refs[1], "crashFixtureArtifacts": refs + probe["runtimeArtifacts"],
        "bootstrapQualificationManifestDigest": refs[1]["objectDigest"],
        "controllerTrustAnchorRef": runtime.anchor_wire(), "controllerTrustAnchorDigest": "b" * 64,
        "controllerRuntimeDigest": "c" * 64, "controllerRuntimeLockBackendDigest": "d" * 64,
        "result": "SUPPORTED", "observedAt": "2026-10-18T00:00:00+00:00",
    })


def profile_wire(os_family=c.RuntimeOsFamily.LINUX):
    capability = capability_wire(os_family)
    anchor = None if os_family is c.RuntimeOsFamily.LINUX else c.DurabilitySyncAnchorIdentity.create(
        device_id="1", inode="2", content_sha256="a" * 64, byte_length=100,
    ).to_dict()
    return sign_profile({
        "osFamily": os_family.value, "backend": capability["backend"],
        "stableVolumeIdentity": capability["stableVolumeIdentity"],
        "syncAnchorIdentity": anchor, "capabilityEvidence": capability,
    })


def sign_profile(payload):
    return runtime.signed(payload, "durabilityProfileDigest",
                          "pt.acceptance.finalization.durability-profile." + payload["osFamily"].lower() + ".v1")


def active_observation_for_profile(profile, *, device_id="1"):
    if type(profile) not in (
        c.LinuxProofAuthorityDurabilityProfile,
        c.DarwinProofAuthorityDurabilityProfile,
    ):
        raise ValueError("profile must use one concrete durability branch")
    os_family = profile.os_family
    capability = profile.capability_evidence
    qualified = c.DurabilityQualifiedEnvironment.create(
        host_build=capability.qualified_host_build,
        host_identity=capability.qualified_host_identity,
        filesystem_implementation_version=(
            capability.filesystem_implementation_version
        ),
        required_mount_options=capability.required_mount_options,
        stable_volume_identity=capability.stable_volume_identity,
        probe_runtime_digest=capability.probe_runtime_digest,
    )
    mount = c.LiveAuthorityMountBinding.create(
        os_family=os_family,
        stable_volume_identity_digest=(
            capability.stable_volume_identity.volume_identity_digest
        ),
        mount_namespace_id=(
            "mnt:[100]" if os_family is c.RuntimeOsFamily.LINUX else None
        ),
        mount_id="42" if os_family is c.RuntimeOsFamily.LINUX else None,
        darwin_fsid=(
            None if os_family is c.RuntimeOsFamily.LINUX
            else "synthetic-fsid"
        ),
        device_id=device_id,
        host_build=capability.qualified_host_build,
        filesystem_implementation_version=(
            capability.filesystem_implementation_version
        ),
        mount_options=capability.required_mount_options,
        observed_at="2026-10-18T00:00:01+00:00",
    )
    boot_ref = c.DurabilityCapabilityArtifactRef.create(
        workspace_id=capability.crash_fixture_manifest_ref.workspace_id,
        gate_id=capability.crash_fixture_manifest_ref.gate_id,
        crash_fixture_id=capability.crash_fixture_id,
        artifact_name=c.DurabilityCapabilityArtifactName.BOOT_OBSERVATION,
        object_digest="a" * 64,
        content_sha256="b" * 64,
        byte_length=100,
    )
    return c.ActiveDurabilityEnvironmentObservation.create(
        qualified_environment_digest=qualified.qualified_environment_digest,
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
    ).to_dict()


def active_observation_wire(os_family=c.RuntimeOsFamily.LINUX):
    profile = c.proof_authority_durability_profile_from_dict(
        profile_wire(os_family)
    )
    return active_observation_for_profile(profile)


def resolved_qualification():
    wire = capability_wire()
    probe_wire = runtime.runtime_wire()
    probe_wire["probeSourceDigest"] = wire["probeSourceDigest"]
    probe_wire = runtime.sign_runtime(probe_wire)
    wire["probeRuntimeDigest"] = probe_wire["probeRuntimeDigest"]
    probe = c.DurabilityProbeRuntimeManifest.from_dict(probe_wire)
    refs = wire["crashFixtureArtifacts"]
    refs[2] = runtime.sign_blob({**refs[2], "objectDigest": probe.probe_runtime_digest})
    expectation = c.DurabilityCapabilityArtifactRef.from_dict(refs[0])
    probe_ref = c.DurabilityCapabilityArtifactRef.from_dict(refs[2])
    cases = []
    for index, point in enumerate((
        c.DurabilityInterruptionPoint.BEFORE_FILE_SYNC,
        c.DurabilityInterruptionPoint.AFTER_FILE_SYNC,
        c.DurabilityInterruptionPoint.AFTER_RENAME,
        c.DurabilityInterruptionPoint.AFTER_DIRECTORY_SYNC,
    )):
        case_refs = []
        for name in (
            c.DurabilityCapabilityArtifactName.POWER_CUT_TRACE,
            c.DurabilityCapabilityArtifactName.RECOVERY_RESULT,
        ):
            case_refs.append(c.DurabilityCapabilityArtifactRef.create(
                workspace_id="0123456789abcdef", gate_id="synthetic-gate",
                crash_fixture_id="synthetic-fixture", artifact_name=name,
                object_digest=str(index + 5) * 64, content_sha256="a" * 64,
                byte_length=100,
            ))
        cases.append(c.DurabilityCrashCase.create(
            case_id=f"synthetic-case-{index}", interruption_point=point,
            expected_recovered_state=c.DurabilityRecoveredState.NEW_BYTES,
            trace_ref=case_refs[0], recovery_result_ref=case_refs[1],
        ))
        refs.extend(ref.to_dict() for ref in case_refs)
    qualified = c.DurabilityQualifiedEnvironment.create(
        host_build=c.runtime_host_build_from_dict(wire["qualifiedHostBuild"]),
        host_identity=c.runtime_host_identity_from_dict(wire["qualifiedHostIdentity"]),
        filesystem_implementation_version=wire["filesystemImplementationVersion"],
        required_mount_options=tuple(wire["requiredMountOptions"]),
        stable_volume_identity=c.stable_volume_identity_from_dict(wire["stableVolumeIdentity"]),
        probe_runtime_digest=probe.probe_runtime_digest,
    )
    manifest_wire = runtime.signed({
        "artifactKind": "acceptance-durability-crash-fixture", "schemaVersion": 1,
        "workspaceId": "0123456789abcdef", "gateId": "synthetic-gate",
        "crashFixtureId": wire["crashFixtureId"], "qualificationRunId": wire["qualificationRunId"],
        "backend": wire["backend"], "stableVolumeIdentity": wire["stableVolumeIdentity"],
        "qualifiedEnvironment": qualified.to_dict(),
        "controllerRuntimeDigest": wire["controllerRuntimeDigest"],
        "controllerRuntimeLockBackendDigest": wire["controllerRuntimeLockBackendDigest"],
        "expectationRef": expectation.to_dict(), "expectationDigest": expectation.object_digest,
        "probeRuntimeManifestRef": probe_ref.to_dict(),
        "operationSequence": ["WRITE_TEMP", "SYNC_FILE", "RENAME_FINAL", "SYNC_DIRECTORY"],
        "oldContentSha256": "a" * 64, "newContentSha256": "b" * 64,
        "cases": [case.to_dict() for case in cases], "result": "SUPPORTED",
    }, "crashFixtureManifestDigest",
        "pt.acceptance.finalization.durability-crash-fixture-manifest.v1")
    manifest = c.DurabilityCrashFixtureManifest.from_dict(manifest_wire)
    refs[1] = runtime.sign_blob({**refs[1], "objectDigest": manifest.crash_fixture_manifest_digest})
    wire["crashFixtureManifestRef"] = refs[1]
    wire["bootstrapQualificationManifestDigest"] = manifest.crash_fixture_manifest_digest
    return sign_capability(wire), manifest, probe


class DurabilityProfileTests(unittest.TestCase):
    def test_capability_os_branches_and_closed_fields(self):
        for family in (c.RuntimeOsFamily.LINUX, c.RuntimeOsFamily.DARWIN):
            wire = capability_wire(family)
            self.assertEqual(c.ProofAuthorityDurabilityCapabilityEvidence.from_dict(wire).to_dict(), wire)
            for field in wire:
                changed = dict(wire)
                changed.pop(field)
                with self.subTest(os=family, missing=field), self.assertRaises(ValueError):
                    c.ProofAuthorityDurabilityCapabilityEvidence.from_dict(changed)
            for field, value in (
                ("evidenceRule", "UNKNOWN"), ("successfulOperations", []),
                ("successfulOperations", list(reversed(wire["successfulOperations"]))),
                ("probeSourceFiles", []), ("probeSourceDigest", "0" * 64),
                ("probeRuntimeDigest", "bad"), ("requiredMountOptions", ["rw", "rw"]),
                ("crashFixtureId", "different-fixture"), ("crashFixtureArtifacts", []),
                ("controllerTrustAnchorDigest", "0" * 64), ("observedAt", "2026-10-18"),
                ("result", "UNSUPPORTED"), ("path", "/tmp"),
            ):
                with self.subTest(os=family, field=field), self.assertRaises(ValueError):
                    c.ProofAuthorityDurabilityCapabilityEvidence.from_dict(sign_capability({**wire, field: value}))

    def test_capability_resigned_ref_and_source_mismatches(self):
        wire = capability_wire()
        for field in ("workspaceId", "gateId", "crashFixtureId"):
            changed = copy.deepcopy(wire)
            changed["crashFixtureArtifacts"][-1] = runtime.sign_blob({
                **changed["crashFixtureArtifacts"][-1],
                field: "fedcba9876543210" if field == "workspaceId" else "different-scope",
            })
            with self.subTest(field=field), self.assertRaises(ValueError):
                c.ProofAuthorityDurabilityCapabilityEvidence.from_dict(sign_capability(changed))
        for operation in ("duplicate", "remove"):
            changed = copy.deepcopy(wire)
            if operation == "duplicate":
                changed["crashFixtureArtifacts"].append(changed["crashFixtureArtifacts"][0])
            else:
                changed["crashFixtureArtifacts"].pop(0)
            with self.subTest(operation=operation), self.assertRaises(ValueError):
                c.ProofAuthorityDurabilityCapabilityEvidence.from_dict(sign_capability(changed))
        evidence = c.ProofAuthorityDurabilityCapabilityEvidence.from_dict(wire)
        valid_runtime = c.FinalizerMaintenanceRuntimeIdentity.from_dict(maintenance.runtime_wire())
        evidence.validate_maintenance_source(valid_runtime)
        changed = copy.deepcopy(wire)
        changed["probeSourceFiles"][0][1] = "b" * 64
        changed["probeSourceDigest"] = c.domain_separated_sha256(
            "pt.acceptance.finalization.durability-probe-source.v1", changed["probeSourceFiles"],
        )
        with self.assertRaises(ValueError):
            c.ProofAuthorityDurabilityCapabilityEvidence.from_dict(sign_capability(changed)).validate_maintenance_source(valid_runtime)
        with self.assertRaises(ValueError):
            c.ProofAuthorityDurabilityCapabilityEvidence.from_dict(capability_wire(c.RuntimeOsFamily.DARWIN)).validate_maintenance_source(valid_runtime)

    def test_profiles_require_exact_os_anchor_and_capability(self):
        for family, expected in (
            (c.RuntimeOsFamily.LINUX, c.LinuxProofAuthorityDurabilityProfile),
            (c.RuntimeOsFamily.DARWIN, c.DarwinProofAuthorityDurabilityProfile),
        ):
            wire = profile_wire(family)
            result = c.proof_authority_durability_profile_from_dict(wire)
            self.assertIs(type(result), expected)
            self.assertEqual(result.to_dict(), wire)
            for field in wire:
                changed = dict(wire)
                changed.pop(field)
                with self.subTest(os=family, missing=field), self.assertRaises(ValueError):
                    c.proof_authority_durability_profile_from_dict(changed)
            other = c.RuntimeOsFamily.DARWIN if family is c.RuntimeOsFamily.LINUX else c.RuntimeOsFamily.LINUX
            for field, value in (
                ("syncAnchorIdentity", profile_wire(other)["syncAnchorIdentity"]),
                ("stableVolumeIdentity", profile_wire(other)["stableVolumeIdentity"]),
                ("capabilityEvidence", capability_wire(other)), ("path", "/tmp"),
            ):
                with self.subTest(os=family, field=field), self.assertRaises(ValueError):
                    c.proof_authority_durability_profile_from_dict(sign_profile({**wire, field: value}))
            with self.assertRaises(ValueError):
                c.proof_authority_durability_profile_from_dict({**wire, "durabilityProfileDigest": "0" * 64})
        with self.assertRaises(ValueError):
            c.proof_authority_durability_profile_from_dict({"osFamily": "WINDOWS"})

    def test_resolved_manifest_and_runtime_equalities(self):
        wire, manifest, probe = resolved_qualification()
        evidence = c.ProofAuthorityDurabilityCapabilityEvidence.from_dict(wire)
        evidence.validate_manifest_runtime(manifest, probe)
        for field, value in (
            ("qualificationRunId", "different-qualification"),
            ("controllerRuntimeDigest", "f" * 64),
            ("controllerRuntimeLockBackendDigest", "f" * 64),
            ("filesystemImplementationVersion", "different-filesystem"),
            ("probeRuntimeDigest", "f" * 64),
            ("probeSourceDigest", "f" * 64),
            ("bootstrapQualificationManifestDigest", "f" * 64),
        ):
            with self.subTest(field=field), self.assertRaises(ValueError):
                c.ProofAuthorityDurabilityCapabilityEvidence.from_dict(
                    sign_capability({**wire, field: value})
                ).validate_manifest_runtime(manifest, probe)
        for name in ("PROBE_RUNTIME_BLOB", "POWER_CUT_TRACE", "RECOVERY_RESULT"):
            for operation in ("remove", "add"):
                changed = copy.deepcopy(wire)
                index = next(i for i, ref in enumerate(changed["crashFixtureArtifacts"]) if ref["artifactName"] == name)
                if operation == "remove":
                    changed["crashFixtureArtifacts"].pop(index)
                else:
                    changed["crashFixtureArtifacts"].append(runtime.sign_blob({
                        **changed["crashFixtureArtifacts"][index], "contentSha256": "f" * 64,
                    }))
                with self.subTest(name=name, operation=operation), self.assertRaises(ValueError):
                    c.ProofAuthorityDurabilityCapabilityEvidence.from_dict(
                        sign_capability(changed)
                    ).validate_manifest_runtime(manifest, probe)
        with self.assertRaises(ValueError):
            evidence.validate_manifest_runtime(None, probe)


if __name__ == "__main__":
    unittest.main()
