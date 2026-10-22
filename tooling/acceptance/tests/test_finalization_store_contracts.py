from __future__ import annotations

import copy
import hashlib
import struct
import unittest

from tooling.acceptance.core import finalization_contracts as c
from tooling.acceptance.tests import test_finalization_contracts as fixtures
from tooling.acceptance.tests import test_finalization_authority as authority
from tooling.acceptance.tests import test_finalization_runtime_measurement as runtime_measurement


WORKSPACE_ID = "0123456789abcdef"
GATE_ID = "synthetic-cleanup-evidence"
FINALIZER_ID = "synthetic-finalizer"
RUN_ID = "20261018T120000000000Z-" + "1" * 32


def artifact_ref(path: str, digest: str) -> c.ArtifactRef:
    return c.ArtifactRef(
        workspace_id=WORKSPACE_ID,
        gate_id=GATE_ID,
        run_id=RUN_ID,
        path=path,
        sha256=digest,
        media_type="application/octet-stream",
    )


def source_bytes(path: str) -> bytes:
    return f"source:{path}".encode("utf-8")


def runtime_bytes(
    kind: c.RuntimeFileKind,
    module_name: str | None,
    logical_name: str | None,
) -> bytes:
    return (
        f"runtime:{kind.value}:{module_name or ''}:{logical_name or ''}"
    ).encode("utf-8")


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def capture_bundle(
    magic: bytes,
    manifest: object,
    contents: tuple[bytes, ...],
) -> bytes:
    manifest_bytes = c.canonical_json_bytes(manifest)
    return b"".join(
        (
            magic,
            struct.pack(">Q", len(manifest_bytes)),
            manifest_bytes,
            *(
                part
                for content in contents
                for part in (struct.pack(">Q", len(content)), content)
            ),
        )
    )


def requirement_record() -> c.FinalizerRequirementRecord:
    mapping = c.RequiredFinalizerMapping(GATE_ID, FINALIZER_ID)
    mapping_path = "tooling/acceptance/capabilities/synthetic.yaml"
    registry_path = "tooling/acceptance/finalizers/registry.json"
    baseline_path = "tooling/acceptance/gates/synthetic/finalizer-baseline.json"
    contract_path = "tooling/acceptance/gates/synthetic/proof-contract.schema.json"
    entrypoint_path = "tooling/acceptance/gates/synthetic/finalizer.py"
    generator_path = "tooling/acceptance/gates/synthetic/contract.py"
    hashes = {
        path: sha256(source_bytes(path))
        for path in (
            mapping_path,
            registry_path,
            baseline_path,
            contract_path,
            entrypoint_path,
            generator_path,
            *c.FINALIZER_BOOTSTRAP_SOURCE_PATHS,
        )
    }
    protected_baseline = c.FinalizerProtectedBaseline(
        gate_id=GATE_ID,
        finalizer_id=FINALIZER_ID,
        requirement_mapping_digest=c.domain_separated_sha256(
            "pt.acceptance.finalization.requirement-mapping.v1",
            {
                "gateId": GATE_ID,
                "finalizerId": FINALIZER_ID,
                "finalizerRegistryPath": registry_path,
                "protectedBaselinePath": baseline_path,
            },
        ),
        registry_file_path=registry_path,
        registry_file_digest=hashes[registry_path],
        contract_schema_path=contract_path,
        contract_schema_digest=hashes[contract_path],
        entrypoint_source_path=entrypoint_path,
        entrypoint_source_digest=hashes[entrypoint_path],
        generator_source_path=generator_path,
        generator_source_digest=hashes[generator_path],
    )
    requirement = c.FinalizerRequirement(
        gate_id=GATE_ID,
        finalizer_id=FINALIZER_ID,
        finalizer_registry_path=registry_path,
        protected_baseline_path=baseline_path,
        protected_baseline_digest=protected_baseline.digest(),
        protected_baseline_file_sha256=hashes[baseline_path],
    )
    source_files = tuple(
        sorted(
            (
                (entrypoint_path, hashes[entrypoint_path]),
                (generator_path, hashes[generator_path]),
            )
        )
    )
    source_digest = c.domain_separated_sha256(
        "pt.acceptance.finalization.source.v1",
        [list(item) for item in source_files],
    )
    registry = c.FinalizerRegistryEntry(
        finalizer_id=FINALIZER_ID,
        entrypoint="synthetic.finalizer",
        source_paths=tuple(path for path, _ in source_files),
        source_digest=source_digest,
        contract_role_projection_digest=c.domain_separated_sha256(
            "pt.acceptance.finalization.role-projection.v1",
            {
                "finalizerId": FINALIZER_ID,
                "evidenceRoleNames": ["synthetic-runtime"],
            },
        ),
        evidence_role_names=("synthetic-runtime",),
    )
    component_by_path = {
        baseline_path: c.ProtectedSourceComponent.PROTECTED_BASELINE,
        mapping_path: c.ProtectedSourceComponent.REQUIRED_MAPPING,
        registry_path: c.ProtectedSourceComponent.REGISTRATION_CATALOG,
        contract_path: c.ProtectedSourceComponent.CONTRACT_SCHEMA,
        entrypoint_path: c.ProtectedSourceComponent.ENTRYPOINT_SOURCE,
        generator_path: c.ProtectedSourceComponent.GENERATOR_SOURCE,
        c.FINALIZER_BOOTSTRAP_SOURCE_PATHS[0]: c.ProtectedSourceComponent.CORE_CONTRACTS,
        c.FINALIZER_BOOTSTRAP_SOURCE_PATHS[1]: c.ProtectedSourceComponent.SUPERVISOR_SOURCE,
        c.FINALIZER_BOOTSTRAP_SOURCE_PATHS[2]: c.ProtectedSourceComponent.CORE_WORKER_BOOTSTRAP,
        c.FINALIZER_BOOTSTRAP_SOURCE_PATHS[3]: c.ProtectedSourceComponent.CORE_RESULT_CONTRACTS,
    }
    executable_paths = {
        *c.FINALIZER_BOOTSTRAP_SOURCE_PATHS,
        *registry.source_paths,
    }
    captured_sources = tuple(
        c.CapturedProtectedSource(
            component=component_by_path[path],
            repo_relative_path=path,
            file_sha256=hashes[path],
            byte_length=len(source_bytes(path)),
            executable_included=path in executable_paths,
        )
        for path in sorted(component_by_path)
    )
    protected_artifacts = tuple(
        c.ProtectedSourceArtifact(
            component=item.component,
            repo_relative_path=item.repo_relative_path,
            ref=artifact_ref(item.repo_relative_path, item.file_sha256),
            file_sha256=item.file_sha256,
            byte_length=item.byte_length,
            executable_included=item.executable_included,
        )
        for item in captured_sources
    )
    bootstrap = c.FinalizerBootstrapBaseline.create(
        source_files=tuple(
            (path, hashes[path]) for path in c.FINALIZER_BOOTSTRAP_SOURCE_PATHS
        )
    )
    source_capture = c.PreflightSourceCapture.create(
        capture_id="synthetic-source-capture",
        workspace_id=WORKSPACE_ID,
        source_commit="synthetic-source",
        workspace_digest="synthetic-workspace-digest",
        canonical_worktree_hash="a" * 64,
        source_files=captured_sources,
        source_capture_bundle_digest=sha256(
            capture_bundle(
                b"pt-finalizer-bundle-v1",
                [
                    {
                        "repoRelativePath": item.repo_relative_path,
                        "fileSha256": item.file_sha256,
                        "byteLength": item.byte_length,
                    }
                    for item in captured_sources
                ],
                tuple(
                    source_bytes(item.repo_relative_path)
                    for item in captured_sources
                ),
            )
        ),
        temporary_directory_claim=c.DescriptorClaim.create(
            device_id="1",
            inode="2",
            owner_binding=c.TemporaryDirectoryOwnerBinding(
                "synthetic-session",
                "synthetic-request",
                "synthetic-nonce",
            ),
        ),
    )
    original_measurement = runtime_measurement.measurement()
    compiler_binary = runtime_bytes(
        c.RuntimeFileKind.COMPILER_BINARY,
        None,
        None,
    )
    python_binary = runtime_bytes(
        c.RuntimeFileKind.PYTHON_EXECUTABLE,
        None,
        None,
    )
    supervisor_binary = runtime_bytes(
        c.RuntimeFileKind.SUPERVISOR_BINARY,
        None,
        None,
    )
    stdlib_binary = runtime_bytes(
        c.RuntimeFileKind.STDLIB_MODULE,
        "json",
        None,
    )
    loader_binary = runtime_bytes(
        c.RuntimeFileKind.LOADED_RUNTIME_IMAGE,
        None,
        "dynamic-loader",
    )
    compiler_path_hash = c.raw_sha256(b"/synthetic/compiler")
    python_path_hash = c.raw_sha256(b"/synthetic/python")
    supervisor_path_hash = c.raw_sha256(b"/synthetic/supervisor")
    stdlib_path_hash = c.raw_sha256(b"/synthetic/json.py")
    loader_path_hash = c.raw_sha256(b"/synthetic/loader")
    build = c.PreflightSupervisorBuildIdentity.create(
        compiler_executable_path_hash=compiler_path_hash,
        compiler_binary_sha256=sha256(compiler_binary),
        compiler_version="synthetic-cc",
        target_triple="synthetic-target",
        compiler_flags=("-Wall", "-O2"),
    )
    modules = (
        c.PreflightStdlibModuleIdentity(
            "json",
            c.StdlibModuleOriginKind.FILE,
            sha256(stdlib_binary),
        ),
        c.PreflightStdlibModuleIdentity(
            "sys",
            c.StdlibModuleOriginKind.BUILTIN,
            None,
        ),
    )
    loader = c.PreflightLoadedRuntimeImage.create(
        logical_name="dynamic-loader",
        origin_kind=c.RuntimeImageOriginKind.STANDALONE_FILE,
        path_hash=loader_path_hash,
        file_sha256=sha256(loader_binary),
    )
    platform = c.PreflightRuntimePlatformAttestation.create(
        os_family=c.RuntimeOsFamily.LINUX,
        host_build=original_measurement.platform_runtime.host_build,
        dynamic_loader_identity=loader,
        shared_cache_uuid=None,
        loaded_images=(loader,),
    )
    measurement = c.PreflightRuntimeMeasurement.create(
        supervisor_source_path=original_measurement.supervisor_source_path,
        supervisor_source_file_sha256=hashes[
            c.FINALIZER_BOOTSTRAP_SOURCE_PATHS[1]
        ],
        supervisor_binary_sha256=sha256(supervisor_binary),
        supervisor_build_identity=build,
        executable_path_hash=python_path_hash,
        executable_sha256=sha256(python_binary),
        implementation=original_measurement.implementation,
        version=original_measurement.version,
        stdlib_modules=modules,
        platform_runtime=platform,
        core_bootstrap_source_digest=bootstrap.core_bootstrap_source_digest,
    )
    captured_runtime_files = tuple(
        sorted(
            (
                c.CapturedRuntimeFile.create(
                    kind=c.RuntimeFileKind.COMPILER_BINARY,
                    path_hash=compiler_path_hash,
                    file_sha256=sha256(compiler_binary),
                    byte_length=len(compiler_binary),
                ),
                c.CapturedRuntimeFile.create(
                    kind=c.RuntimeFileKind.PYTHON_EXECUTABLE,
                    path_hash=python_path_hash,
                    file_sha256=sha256(python_binary),
                    byte_length=len(python_binary),
                ),
                c.CapturedRuntimeFile.create(
                    kind=c.RuntimeFileKind.SUPERVISOR_BINARY,
                    path_hash=supervisor_path_hash,
                    file_sha256=sha256(supervisor_binary),
                    byte_length=len(supervisor_binary),
                ),
                c.CapturedRuntimeFile.create(
                    kind=c.RuntimeFileKind.STDLIB_MODULE,
                    module_name="json",
                    path_hash=stdlib_path_hash,
                    file_sha256=sha256(stdlib_binary),
                    byte_length=len(stdlib_binary),
                ),
                c.CapturedRuntimeFile.create(
                    kind=c.RuntimeFileKind.LOADED_RUNTIME_IMAGE,
                    logical_name="dynamic-loader",
                    origin_kind=c.RuntimeImageOriginKind.STANDALONE_FILE,
                    path_hash=loader_path_hash,
                    file_sha256=sha256(loader_binary),
                    byte_length=len(loader_binary),
                ),
            ),
            key=lambda item: item.identity_key,
        )
    )
    runtime_artifacts = tuple(
        c.RuntimeEvidenceArtifact(
            kind=item.kind,
            module_name=item.module_name,
            logical_name=item.logical_name,
            origin_kind=item.origin_kind,
            path_hash=item.path_hash,
            ref=artifact_ref(
                f"finalizer-runtime/{index:04d}.blob",
                item.file_sha256,
            ),
            file_sha256=item.file_sha256,
            byte_length=item.byte_length,
        )
        for index, item in enumerate(captured_runtime_files)
    )
    supervisor_source_artifact = next(
        item.ref
        for item in protected_artifacts
        if item.component is c.ProtectedSourceComponent.SUPERVISOR_SOURCE
    )
    finalizer_runtime = c.materialize_runtime_identity(
        measurement,
        captured_runtime_files,
        runtime_artifacts,
        supervisor_source_artifact,
    )
    runtime_bundle_digest = sha256(
        capture_bundle(
            b"pt-finalizer-runtime-bundle-v1",
            {
                "captureId": "synthetic-runtime-capture",
                "measurement": measurement.to_dict(),
                "files": [
                    item.to_dict() for item in captured_runtime_files
                ],
            },
            tuple(
                runtime_bytes(
                    item.kind,
                    item.module_name,
                    item.logical_name,
                )
                for item in captured_runtime_files
            ),
        )
    )
    runtime_capture_digest = c.domain_separated_sha256(
        "pt.acceptance.finalization.runtime-capture.v1",
        {
            "captureId": "synthetic-runtime-capture",
            "measurement": measurement.to_dict(),
            "files": [item.to_dict() for item in captured_runtime_files],
            "runtimeCaptureBundleDigest": runtime_bundle_digest,
        },
    )
    profile = authority.install_authority()[0].durability_profile
    config = c.FinalizerExecutionConfig(
        gate_id=GATE_ID,
        finalizer_id=FINALIZER_ID,
        timeout_seconds=60,
        input_byte_limit=1024 * 1024,
    )
    return c.FinalizerRequirementRecord(
        artifact_kind="acceptance-finalizer-requirement",
        schema_version=1,
        enforcement_generation=1,
        enforcement_digest="d" * 64,
        workspace_id=WORKSPACE_ID,
        source_commit=source_capture.source_commit,
        workspace_digest=source_capture.workspace_digest,
        canonical_worktree_hash=source_capture.canonical_worktree_hash,
        requirement=requirement,
        config=config,
        protected_baseline=protected_baseline,
        bootstrap_baseline=bootstrap,
        requirement_mapping=mapping,
        captured_sources=captured_sources,
        protected_source_artifacts=protected_artifacts,
        registry_entry=registry,
        source_files=source_files,
        source_capture_id=source_capture.capture_id,
        source_capture_digest=source_capture.source_capture_digest,
        source_capture_bundle_digest=source_capture.source_capture_bundle_digest,
        runtime_capture_id="synthetic-runtime-capture",
        runtime_capture_digest=runtime_capture_digest,
        runtime_measurement=measurement,
        captured_runtime_files=captured_runtime_files,
        runtime_capture_bundle_digest=runtime_bundle_digest,
        runtime_evidence_artifacts=runtime_artifacts,
        finalizer_runtime=finalizer_runtime,
        durability_profile=profile,
        requirement_digest=requirement.digest(),
        config_digest=config.digest(),
        source_digest=source_digest,
        created_at="2026-10-18T12:00:00+00:00",
    )


def immutable_artifacts(
    record: c.FinalizerRequirementRecord,
) -> dict[str, bytes]:
    result = {
        item.ref.path: source_bytes(item.repo_relative_path)
        for item in record.protected_source_artifacts
    }
    result.update(
        {
            item.ref.path: runtime_bytes(
                item.kind,
                item.module_name,
                item.logical_name,
            )
            for item in record.runtime_evidence_artifacts
        }
    )
    return result


def source_capture(
    record: c.FinalizerRequirementRecord,
) -> c.PreflightSourceCapture:
    return c.PreflightSourceCapture.create(
        capture_id=record.source_capture_id,
        workspace_id=record.workspace_id,
        source_commit=record.source_commit,
        workspace_digest=record.workspace_digest,
        canonical_worktree_hash=record.canonical_worktree_hash,
        source_files=record.captured_sources,
        source_capture_bundle_digest=record.source_capture_bundle_digest,
        temporary_directory_claim=c.DescriptorClaim.create(
            device_id="1",
            inode="2",
            owner_binding=c.TemporaryDirectoryOwnerBinding(
                "synthetic-session",
                "synthetic-source-request",
                "synthetic-source-nonce",
            ),
        ),
    )


def preflight_runtime_capture(
    record: c.FinalizerRequirementRecord,
) -> c.PreflightRuntimeCapture:
    return c.PreflightRuntimeCapture(
        capture_id=record.runtime_capture_id,
        measurement=record.runtime_measurement,
        files=record.captured_runtime_files,
        runtime_capture_bundle_digest=record.runtime_capture_bundle_digest,
        temporary_directory_claim=c.DescriptorClaim.create(
            device_id="1",
            inode="3",
            owner_binding=c.TemporaryDirectoryOwnerBinding(
                "synthetic-session",
                "synthetic-runtime-request",
                "synthetic-runtime-nonce",
            ),
        ),
        runtime_capture_digest=record.runtime_capture_digest,
    )


def preflight_token(
    record: c.FinalizerRequirementRecord,
) -> c.FinalizerPreflightToken:
    return c.FinalizerPreflightToken.create(
        enforcement_generation=record.enforcement_generation,
        enforcement_digest=record.enforcement_digest,
        requirement_digest=record.requirement_digest,
        config_digest=record.config_digest,
        source_digest=record.source_digest,
        supervisor_session_id="synthetic-session",
        supervisor_runtime_digest=(
            record.finalizer_runtime.supervisor_runtime_digest
        ),
        preflight_runtime_digest=(
            record.runtime_measurement.preflight_runtime_digest
        ),
        source_capture_id=record.source_capture_id,
        source_capture_digest=record.source_capture_digest,
        runtime_capture_id=record.runtime_capture_id,
        runtime_capture_digest=record.runtime_capture_digest,
        durability_profile_digest=(
            record.durability_profile.durability_profile_digest
        ),
    )


class FinalizerStoreContractTests(unittest.TestCase):
    def test_requirement_record_round_trip_and_closed_schema(self) -> None:
        record = requirement_record()
        self.assertEqual(
            c.FinalizerRequirementRecord.from_dict(record.to_dict()),
            record,
        )
        for mutation in (
            lambda value: value.update(extra=True),
            lambda value: value.update(sourceDigest="0" * 64),
            lambda value: value["capturedSources"].reverse(),
            lambda value: value["protectedSourceArtifacts"][0].update(
                byteLength=101
            ),
            lambda value: value["runtimeEvidenceArtifacts"][0].update(
                fileSha256="0" * 64
            ),
            lambda value: value["bootstrapBaseline"]["sourceFiles"].pop(),
        ):
            changed = copy.deepcopy(record.to_dict())
            mutation(changed)
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                c.FinalizerRequirementRecord.from_dict(changed)

    def test_source_capture_is_one_shot_and_digest_excludes_process_state(self) -> None:
        record = requirement_record()
        claim = c.DescriptorClaim.create(
            device_id="1",
            inode="2",
            owner_binding=c.TemporaryDirectoryOwnerBinding(
                "session",
                "request",
                "nonce",
            ),
        )
        capture = c.PreflightSourceCapture.create(
            capture_id=record.source_capture_id,
            workspace_id=record.workspace_id,
            source_commit=record.source_commit,
            workspace_digest=record.workspace_digest,
            canonical_worktree_hash=record.canonical_worktree_hash,
            source_files=record.captured_sources,
            source_capture_bundle_digest=record.source_capture_bundle_digest,
            temporary_directory_claim=claim,
        )
        digest = capture.source_capture_digest
        capture.consume()
        self.assertTrue(capture.consumed)
        self.assertEqual(capture.source_capture_digest, digest)
        with self.assertRaisesRegex(ValueError, "already consumed"):
            capture.consume()

    def test_reservation_transitions_cache_exact_bytes_once(self) -> None:
        primary = fixtures.primary_result()
        snapshot = fixtures.snapshot()
        outcome = fixtures.child_finalization(
            primary_result_digest=primary.digest(),
            snapshot_digest=snapshot.snapshot_digest,
        )
        invocation_digest = outcome.child_outcome.invocation_digest
        ready = c.FinalizationReadyReservation()
        started = c.start_finalizer_invocation(
            ready,
            invocation_digest=invocation_digest,
        )
        cached = c.cache_finalizer_outcome(started, outcome=outcome)
        prepared = c.prepare_finalization_manifest(
            cached,
            completed_at="2026-10-18T12:00:01+00:00",
            manifest_bytes=b'{"manifest":true}',
            latest_pointer_bytes=b'{"latest":true}',
        )
        durable = c.mark_finalization_manifest_durable(prepared)
        resolved = c.resolve_finalization_latest(
            durable,
            disposition=c.FinalizationLatestDisposition.PUBLISHED,
        )
        self.assertIs(
            resolved.state,
            c.FinalizationReservationState.LATEST_RESOLVED,
        )
        self.assertEqual(resolved.manifest_bytes, prepared.manifest_bytes)
        self.assertEqual(
            resolved.latest_pointer_bytes,
            prepared.latest_pointer_bytes,
        )
        with self.assertRaisesRegex(ValueError, "only from READY"):
            c.start_finalizer_invocation(
                started,
                invocation_digest=invocation_digest,
            )
        with self.assertRaisesRegex(ValueError, "only a durable manifest"):
            c.resolve_finalization_latest(
                prepared,
                disposition=c.FinalizationLatestDisposition.SUPERSEDED,
            )


if __name__ == "__main__":
    unittest.main()
