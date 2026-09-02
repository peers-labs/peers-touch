from __future__ import annotations

import dataclasses
import hashlib
import unittest

from tooling.acceptance.core.finalization_contracts import (
    AbortOperatorIdentity,
    AbortOperatorIdentityKind,
    AbortPreflightDurableBoundary,
    AbortPreflightStatus,
    AbortSealedPreflightRejected,
    AbortSealedPreflightRequest,
    ActiveDurabilityEnvironmentObservation,
    ArtifactRef,
    AuthoritativeLatestResolution,
    CanonicalOpaqueJson,
    CanonicalPrimaryResult,
    CapturedRuntimeFile,
    ChildGateEvidenceFinalization,
    ClaimLeaseWrapperIdentity,
    ClaimLeaseWrapperWaitEvidence,
    ClaimEmitterInput,
    ClaimEmitterOutput,
    ConsumingChildWaitEvidence,
    CoreGateEvidenceFinalization,
    DurabilityCapabilityArtifactName,
    DurabilityCapabilityArtifactRef,
    DurabilityCrashCase,
    DurabilityCrashFixtureManifest,
    DurabilityBackend,
    DurabilityExecutionStartRecord,
    DurabilityInterruptionPoint,
    DurabilityObservationMode,
    DurabilityQualifiedEnvironment,
    DurabilityRecoveredState,
    DurabilitySupportResult,
    DurabilitySyncOperation,
    DurabilitySyncAnchorIdentity,
    DarwinBootBoundaryObservation,
    DarwinDurabilityProfileBootObservation,
    DarwinDurabilityQualificationBootObservation,
    DarwinProcessStartIdentity,
    DarwinProofAdmissionExecutionEnvironmentIdentity,
    DarwinRuntimeHostBuild,
    DarwinRuntimeHostIdentity,
    DarwinStableVolumeIdentity,
    EvidenceFinalizationRecord,
    EvidenceFinalizationState,
    FinalizerContext,
    FinalizerExecutableArtifact,
    FinalizerFailureCode,
    FinalizerInput,
    FinalizerInvocationIdentity,
    FinalizerOutcomeStatus,
    FinalizerExecutionConfig,
    FinalizerEnforcementActivated,
    FinalizerEnforcementCurrent,
    FinalizerChildOutcome,
    FinalizerPreflightToken,
    FinalizerProtectedBaseline,
    FinalizerRegistryEntry,
    FinalizerRequirement,
    FinalizerRuntimeIdentity,
    FinalizationOrigin,
    LinuxRuntimeHostBuild,
    LinuxRuntimeHostIdentity,
    LinuxStableVolumeIdentity,
    LinuxDurabilityProfileBootObservation,
    LinuxDurabilityQualificationBootObservation,
    LinuxPidfdWaitCapabilityEvidence,
    LinuxBootBoundaryObservation,
    LinuxExecutionEnvironmentTermination,
    LinuxLegacyClaimEnvironmentIdentity,
    LinuxLegacyEnvironmentTermination,
    LinuxPidNamespaceTerminationEvidence,
    LinuxProofAdmissionExecutionEnvironmentIdentity,
    LinuxProcessStartIdentity,
    LinuxWaitIdCode,
    LinuxWaitIdStatus,
    LatestAuthorityMode,
    LatestPointer,
    LoadedRuntimeImage,
    LiveAuthorityMountBinding,
    MaintenanceFailureCode,
    PrimaryResultSourceTrace,
    PreflightLoadedRuntimeImage,
    PreflightStdlibModuleIdentity,
    PreflightSupervisorBuildIdentity,
    QualificationDurabilityEnvironmentObservation,
    ProofAdmissionEdgeKind,
    ProofAdmissionEmissionAcknowledgement,
    ProofAdmissionEmissionIntent,
    ProofAdmissionGrammarId,
    ProofAdmissionInterpreter,
    ProofAdmissionJobCompletion,
    ProofAdmissionJobRecord,
    ProofAdmissionJobTerminalState,
    ProofAdmissionJobRuntimeIdentity,
    ProofAdmissionLockIdentity,
    ProofAdmissionOrphanRecoveryEvidence,
    ProofAdmissionPauseRecord,
    ProofAdmissionCurrentEpoch,
    ProofAdmissionEpochRecord,
    ProofAdmissionEpochRef,
    ProofAdmissionProcessGroupEnumeration,
    ProofAdmissionTerminationMethod,
    ProofAdmissionQuiescence,
    ProofAdmissionSinkIdentity,
    ProofAdmissionSinkResolverIdentity,
    ProofAdmissionSourceClassification,
    ProofAdmissionSourceEdge,
    ProofAdmissionSourceNode,
    PythonScannerInterpreterIdentity,
    BootBoundaryAttestation,
    BootBoundaryObservationRef,
    KernelEvidenceHelperIdentity,
    ReadOnlyEvidenceSnapshot,
    RequiredFinalizerMapping,
    RuntimeImageOriginKind,
    RuntimeFileKind,
    RuntimeOsFamily,
    RuntimePlatformAttestation,
    SealedEvidenceMarker,
    SnapshotArtifact,
    StdlibModuleIdentity,
    StdlibModuleOriginKind,
    SupervisorBuildIdentity,
    ForbiddenProcessApiRule,
    ForbiddenProcessApiScan,
    ForbiddenProcessOperation,
    IdempotentClaimSinkReceipt,
    PosixWaitStatus,
    canonical_forbidden_process_api_registry,
    canonical_json_bytes,
    classify_proof_admission_source,
    domain_separated_sha256,
    gate_evidence_finalization_from_dict,
    merge_finalizer_outcome,
    proof_admission_source_digest,
    runtime_host_build_from_dict,
    runtime_host_identity_from_dict,
    durability_environment_observation_from_dict,
    durability_profile_boot_observation_from_dict,
    durability_qualification_boot_observation_from_dict,
    stable_volume_identity_from_dict,
    validate_durability_environment_observation,
    validate_finalizer_id,
    validate_repo_relative_path,
    validate_sha256,
    _canonical_utc_instant,
)
from tooling.acceptance.core.result_contracts import CanonicalResultTuple


SHA_A = "a" * 64
SHA_B = "b" * 64
SHA_C = "c" * 64
SHA_D = "d" * 64
SHA_E = "e" * 64

GATE_ID = "synthetic-cleanup-evidence"
FINALIZER_ID = "synthetic.cleanup-finalizer"
REGISTRY_PATH = "tooling/acceptance/fixtures/finalizers.json"
BASELINE_PATH = "tooling/acceptance/fixtures/finalizer.protected.json"
WORKSPACE_ID = "0123456789abcdef"
RUN_ID = "20260831T120102123456Z-0123456789abcdef0123456789abcdef"


class CanonicalUtcTimestampTest(unittest.TestCase):
    def test_accepts_canonical_utc_timestamp(self) -> None:
        instant = _canonical_utc_instant(
            "2026-08-31T12:00:00+00:00",
            field="observedAt",
        )

        self.assertEqual(instant.isoformat(), "2026-08-31T12:00:00+00:00")

    def test_rejects_malformed_naive_and_non_utc_timestamps(self) -> None:
        for timestamp in (
            "not-a-time",
            "2026-08-31T12:00:00",
            "2026-08-31T13:00:00+01:00",
        ):
            with self.subTest(timestamp=timestamp):
                with self.assertRaisesRegex(
                    ValueError,
                    "observedAt must be a canonical UTC timestamp",
                ):
                    _canonical_utc_instant(timestamp, field="observedAt")


def contract_role_projection_digest(
    role_names: tuple[str, ...],
) -> str:
    return domain_separated_sha256(
        "pt.acceptance.finalization.role-projection.v1",
        {
            "finalizerId": FINALIZER_ID,
            "evidenceRoleNames": role_names,
        },
    )


def valid_requirement() -> FinalizerRequirement:
    return FinalizerRequirement(
        gate_id=GATE_ID,
        finalizer_id=FINALIZER_ID,
        finalizer_registry_path=REGISTRY_PATH,
        protected_baseline_path=BASELINE_PATH,
        protected_baseline_digest=SHA_A,
        protected_baseline_file_sha256=SHA_B,
    )


def valid_registry_entry(
    *,
    source_paths: tuple[str, ...] = (
        "tooling/acceptance/fixtures/finalizer_contract.py",
        "tooling/acceptance/fixtures/synthetic_finalizer.py",
    ),
    evidence_role_names: tuple[str, ...] = (
        "synthetic-cleanup",
        "synthetic-primary",
    ),
) -> FinalizerRegistryEntry:
    return FinalizerRegistryEntry(
        finalizer_id=FINALIZER_ID,
        entrypoint="tooling.acceptance.finalizers.synthetic",
        source_paths=source_paths,
        source_digest=SHA_A,
        contract_role_projection_digest=contract_role_projection_digest(
            evidence_role_names
        ),
        evidence_role_names=evidence_role_names,
    )


def valid_baseline() -> FinalizerProtectedBaseline:
    return FinalizerProtectedBaseline(
        gate_id=GATE_ID,
        finalizer_id=FINALIZER_ID,
        requirement_mapping_digest=SHA_A,
        registry_file_path=REGISTRY_PATH,
        registry_file_digest=SHA_B,
        contract_schema_path=(
            "tooling/acceptance/fixtures/finalizer_contract.json"
        ),
        contract_schema_digest=SHA_C,
        entrypoint_source_path=(
            "tooling/acceptance/fixtures/synthetic_finalizer.py"
        ),
        entrypoint_source_digest=SHA_D,
        generator_source_path=(
            "tooling/acceptance/fixtures/finalizer_contract.py"
        ),
        generator_source_digest=SHA_E,
    )


def artifact_ref(path: str, *, sha256: str = SHA_A) -> ArtifactRef:
    return ArtifactRef(
        workspace_id=WORKSPACE_ID,
        gate_id=GATE_ID,
        run_id=RUN_ID,
        path=path,
        sha256=sha256,
        media_type="application/json",
    )


def source_trace() -> PrimaryResultSourceTrace:
    return PrimaryResultSourceTrace.create(
        producer_id="synthetic-runner",
        source_commit="synthetic-source-commit",
        invocation_id="synthetic-primary-invocation",
        evidence_refs=(
            artifact_ref("runtime/manifest.json", sha256=SHA_C),
        ),
    )


def primary_result(
    result_tuple: CanonicalResultTuple = CanonicalResultTuple.PassedDoneProven,
) -> CanonicalPrimaryResult:
    trace = source_trace()
    document_value = {
        **result_tuple.to_dict(),
        "reasonCode": None,
        "sourceTrace": trace.to_dict(),
        "syntheticDetail": {"count": 1},
    }
    return CanonicalPrimaryResult(
        document=CanonicalOpaqueJson.from_value(
            schema_id="acceptance-primary-result-v1",
            schema_digest=SHA_C,
            value=document_value,
        ),
        result_tuple=result_tuple,
        reason_code=None,
        source_trace=trace,
    )


def snapshot() -> ReadOnlyEvidenceSnapshot:
    runtime_ref = artifact_ref("runtime/manifest.json", sha256=SHA_C)
    payload = CanonicalOpaqueJson.from_value(
        schema_id="synthetic-evidence-v1",
        schema_digest=SHA_D,
        value={"released": True},
    )
    artifacts = (
        SnapshotArtifact(
            role_name="synthetic-cleanup",
            discriminator="worker-a",
            ref=artifact_ref("reports/cleanup.json", sha256=SHA_D),
            payload=payload,
            payload_digest=payload.payload_digest(),
        ),
        SnapshotArtifact(
            role_name="synthetic-runtime",
            discriminator=None,
            ref=runtime_ref,
            payload=None,
            payload_digest=None,
        ),
    )
    return ReadOnlyEvidenceSnapshot.create(
        workspace_id=WORKSPACE_ID,
        gate_id=GATE_ID,
        evidence_run_id=RUN_ID,
        evaluation_time="2026-08-31T12:01:02+00:00",
        artifacts=artifacts,
        runtime_manifest_ref=runtime_ref,
        source_commit="synthetic-source-commit",
        workspace_digest="clean",
        canonical_worktree_hash=SHA_E,
    )


def finalizer_executable() -> FinalizerExecutableArtifact:
    return FinalizerExecutableArtifact.create(
        ref=artifact_ref("finalizer/source.bundle", sha256=SHA_A),
        files=(
            ("tooling/acceptance/core/finalization_contracts.py", SHA_B),
            ("tooling/acceptance/finalizers/synthetic.py", SHA_C),
        ),
        source_digest=SHA_D,
        core_bootstrap_source_digest=SHA_E,
        entrypoint="tooling.acceptance.finalizers.synthetic",
    )


def supervisor_build() -> SupervisorBuildIdentity:
    return SupervisorBuildIdentity.create(
        compiler_executable_path_hash=SHA_A,
        compiler_binary_sha256=SHA_B,
        compiler_binary_ref=artifact_ref(
            "runtime/compiler.bin",
            sha256=SHA_B,
        ),
        compiler_version="Synthetic CC 1",
        target_triple="x86_64-synthetic-linux",
        compiler_flags=("-O2", "-Wall"),
    )


def linux_platform_runtime() -> RuntimePlatformAttestation:
    loader = LoadedRuntimeImage.create(
        logical_name="dynamic-loader",
        origin_kind=RuntimeImageOriginKind.STANDALONE_FILE,
        path_hash=SHA_A,
        file_sha256=SHA_B,
        artifact_ref=artifact_ref("runtime/loader.bin", sha256=SHA_B),
    )
    library = LoadedRuntimeImage.create(
        logical_name="libpython",
        origin_kind=RuntimeImageOriginKind.STANDALONE_FILE,
        path_hash=SHA_C,
        file_sha256=SHA_D,
        artifact_ref=artifact_ref("runtime/libpython.bin", sha256=SHA_D),
    )
    return RuntimePlatformAttestation.create(
        os_family=RuntimeOsFamily.LINUX,
        host_build=LinuxRuntimeHostBuild.create(
            os_release_file_sha256=SHA_E,
            kernel_release="6.8.0",
            kernel_version="synthetic-linux-kernel",
            machine="x86_64",
        ),
        dynamic_loader_identity=loader,
        shared_cache_uuid=None,
        loaded_images=(library, loader),
    )


def finalizer_runtime() -> FinalizerRuntimeIdentity:
    return FinalizerRuntimeIdentity.create(
        supervisor_source_path=(
            "tooling/acceptance/core/finalization_supervisor.c"
        ),
        supervisor_source_file_sha256=SHA_A,
        supervisor_source_artifact=artifact_ref(
            "tooling/acceptance/core/finalization_supervisor.c",
            sha256=SHA_A,
        ),
        supervisor_binary_ref=artifact_ref(
            "runtime/finalization-supervisor",
            sha256=SHA_B,
        ),
        supervisor_binary_sha256=SHA_B,
        supervisor_build_identity=supervisor_build(),
        executable_path_hash=SHA_C,
        executable_ref=artifact_ref("runtime/python", sha256=SHA_C),
        executable_sha256=SHA_C,
        implementation="CPython",
        version="3.12.6",
        stdlib_modules=(
            StdlibModuleIdentity.create(
                module_name="json",
                origin_kind=StdlibModuleOriginKind.FILE,
                file_sha256=SHA_D,
                artifact_ref=artifact_ref(
                    "runtime/stdlib/json.py",
                    sha256=SHA_D,
                ),
            ),
            StdlibModuleIdentity.create(
                module_name="sys",
                origin_kind=StdlibModuleOriginKind.BUILTIN,
            ),
        ),
        platform_runtime=linux_platform_runtime(),
        core_bootstrap_source_digest=SHA_E,
    )


def finalizer_identity_values() -> dict[str, object]:
    current_snapshot = snapshot()
    current_primary = primary_result()
    executable = finalizer_executable()
    runtime = finalizer_runtime()
    return {
        "finalizer_id": FINALIZER_ID,
        "finalizer_executable": executable,
        "finalizer_source_digest": executable.source_digest,
        "finalizer_runtime": runtime,
        "supervisor_session_id": "synthetic-supervisor-session",
        "supervisor_runtime_digest": runtime.supervisor_runtime_digest,
        "enforcement_generation": 1,
        "enforcement_digest": SHA_A,
        "requirement_digest": SHA_B,
        "config_digest": SHA_C,
        "workspace_id": WORKSPACE_ID,
        "gate_id": GATE_ID,
        "evidence_run_id": RUN_ID,
        "provisioning_run_id": "synthetic-provisioning-run",
        "runtime_manifest_ref": current_snapshot.runtime_manifest_ref,
        "source_commit": current_snapshot.source_commit,
        "workspace_digest": current_snapshot.workspace_digest,
        "canonical_worktree_hash": current_snapshot.canonical_worktree_hash,
        "snapshot_digest": current_snapshot.snapshot_digest,
        "required_role_identities": (
            ("synthetic-cleanup", "worker-a"),
            ("synthetic-runtime", None),
        ),
        "primary_status": current_primary.result_tuple,
        "primary_result_digest": current_primary.digest(),
    }


def validated_child_outcome(
    *,
    primary_result_digest: str,
    snapshot_digest: str,
) -> FinalizerChildOutcome:
    roles = (
        ("synthetic-cleanup", "worker-a"),
        ("synthetic-runtime", None),
    )
    payload = {
        "status": FinalizerOutcomeStatus.VALIDATED.value,
        "finalizerId": FINALIZER_ID,
        "invocationDigest": SHA_A,
        "finalizerInputDigest": SHA_B,
        "snapshotDigest": snapshot_digest,
        "primaryResultDigest": primary_result_digest,
        "validatedRoleInstances": [
            [role_name, discriminator]
            for role_name, discriminator in roles
        ],
        "failureCode": None,
        "diagnostic": None,
    }
    return FinalizerChildOutcome(
        status=FinalizerOutcomeStatus.VALIDATED,
        finalizer_id=FINALIZER_ID,
        invocation_digest=SHA_A,
        finalizer_input_digest=SHA_B,
        snapshot_digest=snapshot_digest,
        primary_result_digest=primary_result_digest,
        child_outcome_digest=domain_separated_sha256(
            "pt.acceptance.finalization.child-outcome.v1",
            payload,
        ),
        validated_role_instances=roles,
        failure_code=None,
        diagnostic=None,
    )


def child_finalization(
    *,
    primary_result_digest: str,
    snapshot_digest: str,
) -> ChildGateEvidenceFinalization:
    child = validated_child_outcome(
        primary_result_digest=primary_result_digest,
        snapshot_digest=snapshot_digest,
    )
    payload = {
        "origin": FinalizationOrigin.CHILD.value,
        "childOutcome": child.to_dict(),
    }
    return ChildGateEvidenceFinalization(
        origin=FinalizationOrigin.CHILD,
        child_outcome=child,
        outcome_digest=domain_separated_sha256(
            "pt.acceptance.finalization.outcome.v1",
            payload,
        ),
    )


class IdentifierValidationTest(unittest.TestCase):
    def test_finalizer_id_accepts_architecture_slug(self) -> None:
        self.assertEqual(
            validate_finalizer_id(FINALIZER_ID),
            FINALIZER_ID,
        )

    def test_finalizer_id_rejects_non_ascii_empty_and_overlong_values(self) -> None:
        for value in (
            "",
            "-leading",
            "contains/slash",
            "contains space",
            "é",
            "a" * 129,
            None,
        ):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    validate_finalizer_id(value)

    def test_sha256_requires_lowercase_raw_hex(self) -> None:
        self.assertEqual(validate_sha256(SHA_A), SHA_A)
        for value in (
            "sha256:" + SHA_A,
            "A" * 64,
            "a" * 63,
            "g" * 64,
            b"a" * 64,
        ):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    validate_sha256(value)

    def test_repo_relative_path_accepts_only_canonical_posix_paths(self) -> None:
        path = "tooling/acceptance/fixtures/finalizer_contract.py"
        self.assertEqual(validate_repo_relative_path(path), path)

        invalid = (
            "",
            "/absolute",
            "../escape",
            "nested/../escape",
            "./relative",
            "double//separator",
            "trailing/",
            "C:/drive",
            "windows\\path",
            "nul\x00path",
            "control\npath",
            "a" * 513,
            None,
        )
        for value in invalid:
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    validate_repo_relative_path(value)


class CanonicalJsonTest(unittest.TestCase):
    def test_canonical_json_matches_rfc_8785_primitive_vector(self) -> None:
        value = {
            "numbers": [
                333333333.33333329,
                1e30,
                4.50,
                2e-3,
                1e-27,
                -0.0,
                1e-6,
                1e20,
            ],
            "string": "€$\u000f\nA'B\"\\\\\"/",
            "literals": [None, True, False],
        }
        self.assertEqual(
            canonical_json_bytes(value),
            (
                b'{"literals":[null,true,false],'
                b'"numbers":[333333333.3333333,1e+30,4.5,0.002,'
                b'1e-27,0,0.000001,100000000000000000000],'
                b'"string":"\xe2\x82\xac$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}'
            ),
        )

    def test_object_keys_use_utf16_code_unit_order(self) -> None:
        value = {"\ue000": 1, "\U00010000": 2}
        self.assertEqual(
            canonical_json_bytes(value),
            b'{"\xf0\x90\x80\x80":2,"\xee\x80\x80":1}',
        )

    def test_tuple_and_list_have_the_same_canonical_array_encoding(self) -> None:
        self.assertEqual(
            canonical_json_bytes(("a", 1, True)),
            canonical_json_bytes(["a", 1, True]),
        )

    def test_unsupported_non_finite_unsafe_and_cyclic_values_fail_closed(self) -> None:
        cyclic: list[object] = []
        cyclic.append(cyclic)
        for value in (
            float("nan"),
            float("inf"),
            9007199254740992,
            {"bad": object()},
            {1: "non-string-key"},
            "\ud800",
            cyclic,
        ):
            with self.subTest(value=type(value).__name__):
                with self.assertRaises(ValueError):
                    canonical_json_bytes(value)

    def test_domain_digest_uses_exact_canonical_envelope(self) -> None:
        domain = "pt.acceptance.finalization.config.v1"
        payload = {"timeoutSeconds": 30, "inputByteLimit": 1048576}
        expected_bytes = (
            b'{"domain":"pt.acceptance.finalization.config.v1",'
            b'"payload":{"inputByteLimit":1048576,"timeoutSeconds":30}}'
        )
        self.assertEqual(
            domain_separated_sha256(domain, payload),
            hashlib.sha256(expected_bytes).hexdigest(),
        )
        with self.assertRaises(ValueError):
            domain_separated_sha256("unregistered-domain", payload)


class ClosedContractTest(unittest.TestCase):
    def test_required_mapping_is_closed_and_immutable(self) -> None:
        mapping = RequiredFinalizerMapping.from_dict(
            {"gateId": GATE_ID, "finalizerId": FINALIZER_ID}
        )
        self.assertEqual(
            mapping.to_dict(),
            {"gateId": GATE_ID, "finalizerId": FINALIZER_ID},
        )
        self.assertFalse(hasattr(mapping, "__dict__"))
        with self.assertRaises(dataclasses.FrozenInstanceError):
            mapping.gate_id = "changed"
        with self.assertRaises(ValueError):
            RequiredFinalizerMapping.from_dict(
                {
                    "gateId": GATE_ID,
                    "finalizerId": FINALIZER_ID,
                    "required": True,
                }
            )
        with self.assertRaises(ValueError):
            RequiredFinalizerMapping.from_dict({"gateId": GATE_ID})

    def test_outcome_merge_is_monotonic_and_closed(self) -> None:
        for primary in CanonicalResultTuple:
            with self.subTest(primary=primary):
                self.assertIs(
                    merge_finalizer_outcome(
                        primary,
                        None,
                        finalizer_required=False,
                    ),
                    primary,
                )
                expected_validated = primary
                self.assertIs(
                    merge_finalizer_outcome(
                        primary,
                        FinalizerOutcomeStatus.VALIDATED,
                        finalizer_required=True,
                    ),
                    expected_validated,
                )
                expected_failure = (
                    primary
                    if primary.status in {"failed", "blocked"}
                    else CanonicalResultTuple.FailedPartialUnproven
                )
                for outcome in (
                    None,
                    FinalizerOutcomeStatus.REJECTED,
                    FinalizerOutcomeStatus.BLOCKED,
                    FinalizerOutcomeStatus.TIMED_OUT,
                    FinalizerOutcomeStatus.ERROR,
                ):
                    self.assertIs(
                        merge_finalizer_outcome(
                            primary,
                            outcome,
                            finalizer_required=True,
                        ),
                        expected_failure,
                    )

        with self.assertRaises(ValueError):
            merge_finalizer_outcome(
                CanonicalResultTuple.PassedDoneProven,
                FinalizerOutcomeStatus.VALIDATED,
                finalizer_required=False,
            )

    def test_failure_code_enums_are_closed_and_unique(self) -> None:
        self.assertEqual(len(FinalizerFailureCode), 26)
        self.assertEqual(len(MaintenanceFailureCode), 8)

    def test_requirement_round_trip_and_exact_digest_preimages(self) -> None:
        requirement = valid_requirement()
        self.assertEqual(
            FinalizerRequirement.from_dict(requirement.to_dict()),
            requirement,
        )
        expected_requirement = hashlib.sha256(
            canonical_json_bytes(
                {
                    "domain": "pt.acceptance.finalization.requirement.v1",
                    "payload": requirement.to_dict(),
                }
            )
        ).hexdigest()
        expected_mapping = domain_separated_sha256(
            "pt.acceptance.finalization.requirement-mapping.v1",
            {
                "gateId": GATE_ID,
                "finalizerId": FINALIZER_ID,
                "finalizerRegistryPath": REGISTRY_PATH,
                "protectedBaselinePath": BASELINE_PATH,
            },
        )
        self.assertEqual(requirement.digest(), expected_requirement)
        self.assertEqual(
            requirement.requirement_mapping_digest(),
            expected_mapping,
        )

    def test_requirement_rejects_unknown_fields_and_invalid_components(self) -> None:
        payload = valid_requirement().to_dict()
        for field, value in (
            ("gateId", "bad gate"),
            ("finalizerId", "bad/finalizer"),
            ("finalizerRegistryPath", "../registry.yaml"),
            ("protectedBaselinePath", "/baseline.json"),
            ("protectedBaselineDigest", "A" * 64),
            ("protectedBaselineFileSha256", "short"),
        ):
            invalid = dict(payload)
            invalid[field] = value
            with self.subTest(field=field):
                with self.assertRaises(ValueError):
                    FinalizerRequirement.from_dict(invalid)

        unknown = dict(payload)
        unknown["extra"] = True
        with self.assertRaises(ValueError):
            FinalizerRequirement.from_dict(unknown)

    def test_execution_config_enforces_integer_core_bounds(self) -> None:
        config = FinalizerExecutionConfig(
            gate_id=GATE_ID,
            finalizer_id=FINALIZER_ID,
            timeout_seconds=60,
            input_byte_limit=1024 * 1024,
        )
        self.assertEqual(
            FinalizerExecutionConfig.from_dict(config.to_dict()),
            config,
        )
        self.assertRegex(config.digest(), r"^[0-9a-f]{64}$")

        for field, value in (
            ("timeoutSeconds", 0),
            ("timeoutSeconds", 61),
            ("timeoutSeconds", True),
            ("timeoutSeconds", 1.0),
            ("inputByteLimit", 0),
            ("inputByteLimit", 1024 * 1024 + 1),
            ("inputByteLimit", "1048576"),
        ):
            invalid = config.to_dict()
            invalid[field] = value
            with self.subTest(field=field, value=value):
                with self.assertRaises(ValueError):
                    FinalizerExecutionConfig.from_dict(invalid)

    def test_registry_entry_requires_immutable_unique_lexical_tuples(self) -> None:
        entry = valid_registry_entry()
        self.assertEqual(
            FinalizerRegistryEntry.from_dict(entry.to_dict()),
            entry,
        )
        self.assertIsInstance(entry.source_paths, tuple)
        self.assertIsInstance(entry.evidence_role_names, tuple)

        constructor_cases = (
            {
                "source_paths": [
                    "tooling/acceptance/fixtures/synthetic_finalizer.py"
                ]
            },
            {
                "source_paths": (
                    "tooling/acceptance/fixtures/synthetic_finalizer.py",
                    "tooling/acceptance/fixtures/finalizer_contract.py",
                )
            },
            {
                "source_paths": (
                    "tooling/acceptance/fixtures/finalizer_contract.py",
                    "tooling/acceptance/fixtures/finalizer_contract.py",
                )
            },
            {"source_paths": ()},
            {
                "evidence_role_names": (
                    "synthetic-primary",
                    "synthetic-cleanup",
                )
            },
            {
                "evidence_role_names": (
                    "synthetic-primary",
                    "synthetic-primary",
                )
            },
            {"evidence_role_names": ["synthetic-primary"]},
        )
        defaults = {
            "source_paths": (
                "tooling/acceptance/fixtures/finalizer_contract.py",
                "tooling/acceptance/fixtures/synthetic_finalizer.py",
            ),
            "evidence_role_names": (
                "synthetic-cleanup",
                "synthetic-primary",
            ),
        }
        for overrides in constructor_cases:
            values = {**defaults, **overrides}
            with self.subTest(overrides=overrides):
                with self.assertRaises(ValueError):
                    valid_registry_entry(**values)

    def test_registry_entry_rejects_role_projection_digest_mismatch(self) -> None:
        with self.assertRaises(ValueError):
            FinalizerRegistryEntry(
                finalizer_id=FINALIZER_ID,
                entrypoint="tooling.acceptance.finalizers.synthetic",
                source_paths=(
                    "tooling/acceptance/fixtures/synthetic_finalizer.py",
                ),
                source_digest=SHA_A,
                contract_role_projection_digest=SHA_B,
                evidence_role_names=(),
            )

    def test_registry_decoder_rejects_non_arrays_and_unknown_fields(self) -> None:
        payload = valid_registry_entry().to_dict()
        payload["sourcePaths"] = tuple(payload["sourcePaths"])
        with self.assertRaises(ValueError):
            FinalizerRegistryEntry.from_dict(payload)

        payload = valid_registry_entry().to_dict()
        payload["extra"] = "forbidden"
        with self.assertRaises(ValueError):
            FinalizerRegistryEntry.from_dict(payload)

    def test_protected_baseline_round_trip_and_digest(self) -> None:
        baseline = valid_baseline()
        self.assertEqual(
            FinalizerProtectedBaseline.from_dict(baseline.to_dict()),
            baseline,
        )
        self.assertEqual(
            baseline.digest(),
            domain_separated_sha256(
                "pt.acceptance.finalization.protected-baseline.v1",
                baseline.to_dict(),
            ),
        )
        self.assertFalse(hasattr(baseline, "__dict__"))

    def test_protected_baseline_rejects_unknown_and_invalid_fields(self) -> None:
        payload = valid_baseline().to_dict()
        payload["registryFilePath"] = "../finalizers.yaml"
        with self.assertRaises(ValueError):
            FinalizerProtectedBaseline.from_dict(payload)

        payload = valid_baseline().to_dict()
        payload["generatorSourceDigest"] = "SHA_A"
        with self.assertRaises(ValueError):
            FinalizerProtectedBaseline.from_dict(payload)

        payload = valid_baseline().to_dict()
        payload["mutableExtension"] = {}
        with self.assertRaises(ValueError):
            FinalizerProtectedBaseline.from_dict(payload)


class SnapshotContractTest(unittest.TestCase):
    def test_snapshot_rejects_subclass_serialization_substitution(self) -> None:
        current = snapshot()

        class ArtifactRefSubclass(ArtifactRef):
            def to_dict(self) -> dict[str, object]:
                return {
                    **super().to_dict(),
                    "path": "substituted.json",
                }

        class SnapshotArtifactSubclass(SnapshotArtifact):
            pass

        reference = current.runtime_manifest_ref
        reference_subclass = ArtifactRefSubclass(
            **{
                field.name: getattr(reference, field.name)
                for field in dataclasses.fields(reference)
            }
        )
        with self.assertRaisesRegex(ValueError, "ref must be an ArtifactRef"):
            SnapshotArtifact(
                role_name="synthetic-runtime",
                discriminator=None,
                ref=reference_subclass,
                payload=None,
                payload_digest=None,
            )
        artifact_subclass = SnapshotArtifactSubclass(
            **{
                field.name: getattr(current.artifacts[0], field.name)
                for field in dataclasses.fields(current.artifacts[0])
            }
        )
        with self.assertRaisesRegex(
            ValueError,
            "snapshot inputs must use concrete contract types",
        ):
            ReadOnlyEvidenceSnapshot.create(
                workspace_id=current.workspace_id,
                gate_id=current.gate_id,
                evidence_run_id=current.evidence_run_id,
                evaluation_time=current.evaluation_time,
                artifacts=(artifact_subclass,),
                runtime_manifest_ref=reference,
                source_commit=current.source_commit,
                workspace_digest=current.workspace_digest,
                canonical_worktree_hash=current.canonical_worktree_hash,
            )

    def test_snapshot_requires_canonical_utc_evaluation_time(self) -> None:
        current = snapshot()
        with self.assertRaisesRegex(
            ValueError,
            "evaluationTime must be a canonical UTC timestamp",
        ):
            ReadOnlyEvidenceSnapshot.create(
                workspace_id=current.workspace_id,
                gate_id=current.gate_id,
                evidence_run_id=current.evidence_run_id,
                evaluation_time="not-a-time",
                artifacts=current.artifacts,
                runtime_manifest_ref=current.runtime_manifest_ref,
                source_commit=current.source_commit,
                workspace_digest=current.workspace_digest,
                canonical_worktree_hash=current.canonical_worktree_hash,
            )

    def test_artifact_opaque_payload_and_snapshot_round_trip(self) -> None:
        current = snapshot()
        self.assertEqual(
            ReadOnlyEvidenceSnapshot.from_dict(current.to_dict()),
            current,
        )
        self.assertEqual(
            ArtifactRef.from_dict(current.runtime_manifest_ref.to_dict()),
            current.runtime_manifest_ref,
        )
        self.assertFalse(hasattr(current, "store"))
        with self.assertRaises(dataclasses.FrozenInstanceError):
            current.gate_id = "changed"

    def test_opaque_json_rejects_base64_utf8_jcs_length_and_hash_mutations(
        self,
    ) -> None:
        opaque = CanonicalOpaqueJson.from_value(
            schema_id="synthetic-evidence-v1",
            schema_digest=SHA_A,
            value={"a": 1},
        )
        mutations = (
            ("canonicalUtf8Base64", "not-base64!"),
            ("canonicalUtf8Base64", "eyJhIjogMX0="),
            ("canonicalUtf8Base64", "/w=="),
            ("byteLength", opaque.byte_length + 1),
            ("contentDigest", SHA_B),
            ("schemaDigest", "A" * 64),
        )
        for field, value in mutations:
            payload = opaque.to_dict()
            payload[field] = value
            with self.subTest(field=field, value=value):
                with self.assertRaises(ValueError):
                    CanonicalOpaqueJson.from_dict(payload)

        duplicate = b'{"a":1,"a":2}'
        payload = opaque.to_dict()
        import base64

        payload["canonicalUtf8Base64"] = base64.b64encode(duplicate).decode(
            "ascii"
        )
        payload["byteLength"] = len(duplicate)
        payload["contentDigest"] = hashlib.sha256(duplicate).hexdigest()
        with self.assertRaises(ValueError):
            CanonicalOpaqueJson.from_dict(payload)

    def test_snapshot_rejects_order_duplicate_identity_and_cross_run_ref(
        self,
    ) -> None:
        current = snapshot()
        reversed_payload = current.to_dict()
        reversed_payload["artifacts"] = list(
            reversed(reversed_payload["artifacts"])
        )
        with self.assertRaises(ValueError):
            ReadOnlyEvidenceSnapshot.from_dict(reversed_payload)

        duplicate_payload = current.to_dict()
        duplicate_payload["artifacts"] = [
            duplicate_payload["artifacts"][0],
            duplicate_payload["artifacts"][0],
        ]
        with self.assertRaises(ValueError):
            ReadOnlyEvidenceSnapshot.from_dict(duplicate_payload)

        cross_run = current.to_dict()
        cross_run["runtimeManifestRef"] = {
            **cross_run["runtimeManifestRef"],
            "runId": (
                "20260831T120102123456Z-"
                "ffffffffffffffffffffffffffffffff"
            ),
        }
        with self.assertRaises(ValueError):
            ReadOnlyEvidenceSnapshot.from_dict(cross_run)

    def test_snapshot_digest_and_unknown_fields_fail_closed(self) -> None:
        current = snapshot()
        for mutate in (
            lambda payload: payload.update(snapshotDigest=SHA_A),
            lambda payload: payload.update(extra=True),
            lambda payload: payload["artifacts"][0].update(extra=True),
            lambda payload: payload["runtimeManifestRef"].update(extra=True),
        ):
            payload = current.to_dict()
            mutate(payload)
            with self.assertRaises(ValueError):
                ReadOnlyEvidenceSnapshot.from_dict(payload)


class PrimaryAndOutcomeContractTest(unittest.TestCase):
    def test_primary_result_round_trip_and_projection_equality(self) -> None:
        primary = primary_result()
        self.assertEqual(
            CanonicalPrimaryResult.from_dict(primary.to_dict()),
            primary,
        )
        payload = primary.to_dict()
        payload["resultTuple"] = (
            CanonicalResultTuple.PassedDoneUnproven.to_dict()
        )
        with self.assertRaises(ValueError):
            CanonicalPrimaryResult.from_dict(payload)

        class OpaqueSubclass(CanonicalOpaqueJson):
            def to_dict(self) -> dict[str, object]:
                return {
                    **super().to_dict(),
                    "schemaId": "substituted-schema-v1",
                }

        document = primary.document
        substituted_document = OpaqueSubclass(
            **{
                field.name: getattr(document, field.name)
                for field in dataclasses.fields(document)
            }
        )
        with self.assertRaisesRegex(
            ValueError,
            "document must be CanonicalOpaqueJson",
        ):
            CanonicalPrimaryResult(
                document=substituted_document,
                result_tuple=primary.result_tuple,
                reason_code=primary.reason_code,
                source_trace=primary.source_trace,
            )

        payload = primary.to_dict()
        payload["extra"] = "forbidden"
        with self.assertRaises(ValueError):
            CanonicalPrimaryResult.from_dict(payload)

    def test_source_trace_rejects_order_digest_and_unknown_fields(self) -> None:
        first = artifact_ref("reports/a.json", sha256=SHA_A)
        second = artifact_ref("reports/b.json", sha256=SHA_B)
        with self.assertRaisesRegex(ValueError, "evidenceRefs must be non-empty"):
            PrimaryResultSourceTrace.create(
                producer_id="synthetic-runner",
                source_commit="synthetic-source-commit",
                invocation_id="synthetic-primary-invocation",
                evidence_refs=(),
            )

        trace = PrimaryResultSourceTrace.create(
            producer_id="synthetic-runner",
            source_commit="synthetic-source-commit",
            invocation_id="synthetic-primary-invocation",
            evidence_refs=(second, first),
        )
        self.assertEqual(trace.evidence_refs, (first, second))
        self.assertEqual(
            PrimaryResultSourceTrace.from_dict(trace.to_dict()),
            trace,
        )

        payload = trace.to_dict()
        payload["evidenceRefs"] = list(reversed(payload["evidenceRefs"]))
        with self.assertRaises(ValueError):
            PrimaryResultSourceTrace.from_dict(payload)

        for field, value in (("sourceTraceDigest", SHA_A), ("extra", True)):
            payload = trace.to_dict()
            payload[field] = value
            with self.subTest(field=field):
                with self.assertRaises(ValueError):
                    PrimaryResultSourceTrace.from_dict(payload)

    def test_child_and_core_outcome_unions_round_trip(self) -> None:
        primary = primary_result()
        current_snapshot = snapshot()
        child = child_finalization(
            primary_result_digest=primary.digest(),
            snapshot_digest=current_snapshot.snapshot_digest,
        )
        self.assertEqual(
            gate_evidence_finalization_from_dict(child.to_dict()),
            child,
        )

        core_payload = {
            "origin": FinalizationOrigin.CORE.value,
            "status": FinalizerOutcomeStatus.TIMED_OUT.value,
            "childOutcome": None,
            "finalizerId": FINALIZER_ID,
            "invocationDigest": SHA_A,
            "finalizerInputDigest": SHA_B,
            "snapshotDigest": current_snapshot.snapshot_digest,
            "primaryResultDigest": primary.digest(),
            "validatedRoleInstances": [],
            "failureCode": FinalizerFailureCode.TIMED_OUT.value,
            "diagnostic": "synthetic timeout",
        }
        core = CoreGateEvidenceFinalization(
            origin=FinalizationOrigin.CORE,
            status=FinalizerOutcomeStatus.TIMED_OUT,
            child_outcome=None,
            finalizer_id=FINALIZER_ID,
            invocation_digest=SHA_A,
            finalizer_input_digest=SHA_B,
            snapshot_digest=current_snapshot.snapshot_digest,
            primary_result_digest=primary.digest(),
            outcome_digest=domain_separated_sha256(
                "pt.acceptance.finalization.outcome.v1",
                core_payload,
            ),
            validated_role_instances=(),
            failure_code=FinalizerFailureCode.TIMED_OUT,
            diagnostic="synthetic timeout",
        )
        self.assertEqual(
            gate_evidence_finalization_from_dict(core.to_dict()),
            core,
        )
        invalid_core = core.to_dict()
        invalid_core["status"] = FinalizerOutcomeStatus.ERROR.value
        invalid_core["failureCode"] = (
            FinalizerFailureCode.ABORT_SEALED_INCOMPLETE.value
        )
        invalid_core["outcomeDigest"] = domain_separated_sha256(
            "pt.acceptance.finalization.outcome.v1",
            {
                key: value
                for key, value in invalid_core.items()
                if key != "outcomeDigest"
            },
        )
        with self.assertRaises(ValueError):
            gate_evidence_finalization_from_dict(invalid_core)

    def test_outcome_mutation_and_unknown_fields_fail_closed(self) -> None:
        primary = primary_result()
        current_snapshot = snapshot()
        child = child_finalization(
            primary_result_digest=primary.digest(),
            snapshot_digest=current_snapshot.snapshot_digest,
        )
        mutations = (
            lambda payload: payload.update(origin="UNKNOWN"),
            lambda payload: payload.update(outcomeDigest=SHA_E),
            lambda payload: payload.update(status="VALIDATED"),
            lambda payload: payload["childOutcome"].update(
                childOutcomeDigest=SHA_E
            ),
            lambda payload: payload["childOutcome"].update(extra=True),
        )
        for mutate in mutations:
            payload = child.to_dict()
            mutate(payload)
            with self.assertRaises(ValueError):
                gate_evidence_finalization_from_dict(payload)


class EvidenceFinalizationRecordTest(unittest.TestCase):
    def test_all_state_branches_round_trip_and_merge(self) -> None:
        not_required = EvidenceFinalizationRecord(
            artifact_kind="acceptance-evidence-finalization",
            schema_version=1,
            state=EvidenceFinalizationState.NOT_REQUIRED,
            enforcement_generation=None,
            enforcement_digest=None,
            requirement_digest=None,
            config_digest=None,
            source_digest=None,
            seal_digest=None,
            primary_result=None,
            primary_result_digest=None,
            failure_code=None,
            outcome=None,
        )
        self.assertEqual(
            EvidenceFinalizationRecord.from_dict(not_required.to_dict()),
            not_required,
        )

        primary = primary_result()
        pre_seal = EvidenceFinalizationRecord(
            artifact_kind="acceptance-evidence-finalization",
            schema_version=1,
            state=EvidenceFinalizationState.NOT_INVOKED_PRE_SEAL,
            enforcement_generation=1,
            enforcement_digest=SHA_A,
            requirement_digest=SHA_B,
            config_digest=SHA_C,
            source_digest=SHA_D,
            seal_digest=None,
            primary_result=primary,
            primary_result_digest=primary.digest(),
            failure_code=FinalizerFailureCode.NOT_INVOKED_PRE_SEAL,
            outcome=None,
        )
        self.assertEqual(
            EvidenceFinalizationRecord.from_dict(pre_seal.to_dict()),
            pre_seal,
        )
        self.assertIs(
            pre_seal.published_result_tuple(),
            CanonicalResultTuple.FailedPartialUnproven,
        )

        current_snapshot = snapshot()
        outcome = child_finalization(
            primary_result_digest=primary.digest(),
            snapshot_digest=current_snapshot.snapshot_digest,
        )
        completed = EvidenceFinalizationRecord(
            artifact_kind="acceptance-evidence-finalization",
            schema_version=1,
            state=EvidenceFinalizationState.COMPLETED,
            enforcement_generation=1,
            enforcement_digest=SHA_A,
            requirement_digest=SHA_B,
            config_digest=SHA_C,
            source_digest=SHA_D,
            seal_digest=SHA_E,
            primary_result=primary,
            primary_result_digest=primary.digest(),
            failure_code=None,
            outcome=outcome,
        )
        self.assertEqual(
            EvidenceFinalizationRecord.from_dict(completed.to_dict()),
            completed,
        )
        self.assertIs(
            completed.published_result_tuple(),
            CanonicalResultTuple.PassedDoneProven,
        )

        class PrimarySubclass(CanonicalPrimaryResult):
            pass

        substituted_primary = PrimarySubclass(
            **{
                field.name: getattr(primary, field.name)
                for field in dataclasses.fields(primary)
            }
        )
        with self.assertRaisesRegex(
            ValueError,
            "primaryResult must be CanonicalPrimaryResult",
        ):
            EvidenceFinalizationRecord(
                artifact_kind="acceptance-evidence-finalization",
                schema_version=1,
                state=EvidenceFinalizationState.COMPLETED,
                enforcement_generation=1,
                enforcement_digest=SHA_A,
                requirement_digest=SHA_B,
                config_digest=SHA_C,
                source_digest=SHA_D,
                seal_digest=SHA_E,
                primary_result=substituted_primary,
                primary_result_digest=substituted_primary.digest(),
                failure_code=None,
                outcome=outcome,
            )

    def test_record_branch_mutations_and_unknown_fields_fail_closed(self) -> None:
        primary = primary_result()
        record = EvidenceFinalizationRecord(
            artifact_kind="acceptance-evidence-finalization",
            schema_version=1,
            state=EvidenceFinalizationState.NOT_INVOKED_PRE_SEAL,
            enforcement_generation=1,
            enforcement_digest=SHA_A,
            requirement_digest=SHA_B,
            config_digest=SHA_C,
            source_digest=SHA_D,
            seal_digest=None,
            primary_result=primary,
            primary_result_digest=primary.digest(),
            failure_code=FinalizerFailureCode.NOT_INVOKED_PRE_SEAL,
            outcome=None,
        )
        for field, value in (
            ("state", "UNKNOWN"),
            ("schemaVersion", 2),
            ("sealDigest", SHA_E),
            ("primaryResultDigest", SHA_E),
            ("failureCode", FinalizerFailureCode.BLOCKED.value),
            ("extra", True),
        ):
            payload = record.to_dict()
            payload[field] = value
            with self.subTest(field=field):
                with self.assertRaises(ValueError):
                    EvidenceFinalizationRecord.from_dict(payload)


class RuntimeIdentityContractTest(unittest.TestCase):
    def test_preflight_runtime_identity_parts_exclude_artifact_refs(self) -> None:
        build = PreflightSupervisorBuildIdentity.create(
            compiler_executable_path_hash=SHA_A,
            compiler_binary_sha256=SHA_B,
            compiler_version="synthetic-cc",
            target_triple="x86_64-unknown-linux-gnu",
            compiler_flags=("-O2", "-Wall"),
        )
        file_module = PreflightStdlibModuleIdentity.create(
            module_name="json",
            origin_kind=StdlibModuleOriginKind.FILE,
            file_sha256=SHA_C,
        )
        builtin_module = PreflightStdlibModuleIdentity.create(
            module_name="sys",
            origin_kind=StdlibModuleOriginKind.BUILTIN,
        )
        image = PreflightLoadedRuntimeImage.create(
            logical_name="dynamic-loader",
            origin_kind=RuntimeImageOriginKind.STANDALONE_FILE,
            path_hash=SHA_D,
            file_sha256=SHA_E,
        )

        self.assertEqual(
            PreflightSupervisorBuildIdentity.from_dict(build.to_dict()),
            build,
        )
        self.assertEqual(
            PreflightStdlibModuleIdentity.from_dict(file_module.to_dict()),
            file_module,
        )
        self.assertEqual(
            PreflightStdlibModuleIdentity.from_dict(builtin_module.to_dict()),
            builtin_module,
        )
        self.assertEqual(
            PreflightLoadedRuntimeImage.from_dict(image.to_dict()),
            image,
        )
        for value in (build, file_module, builtin_module, image):
            self.assertNotIn("artifactRef", value.to_dict())

        payload = file_module.to_dict()
        payload["artifactRef"] = artifact_ref("runtime/json.py").to_dict()
        with self.assertRaises(ValueError):
            PreflightStdlibModuleIdentity.from_dict(payload)

        payload = builtin_module.to_dict()
        payload["fileSha256"] = SHA_A
        with self.assertRaises(ValueError):
            PreflightStdlibModuleIdentity.from_dict(payload)

        payload = image.to_dict()
        payload["sharedCacheUuid"] = "forbidden"
        with self.assertRaises(ValueError):
            PreflightLoadedRuntimeImage.from_dict(payload)

    def test_captured_runtime_file_kind_matrix_is_closed(self) -> None:
        files = (
            CapturedRuntimeFile.create(
                kind=RuntimeFileKind.SUPERVISOR_BINARY,
                path_hash=SHA_A,
                file_sha256=SHA_B,
                byte_length=100,
            ),
            CapturedRuntimeFile.create(
                kind=RuntimeFileKind.STDLIB_MODULE,
                module_name="json",
                path_hash=SHA_C,
                file_sha256=SHA_D,
                byte_length=200,
            ),
            CapturedRuntimeFile.create(
                kind=RuntimeFileKind.LOADED_RUNTIME_IMAGE,
                logical_name="libpython",
                origin_kind=RuntimeImageOriginKind.STANDALONE_FILE,
                path_hash=SHA_D,
                file_sha256=SHA_E,
                byte_length=300,
            ),
        )
        for captured in files:
            with self.subTest(kind=captured.kind):
                self.assertEqual(
                    CapturedRuntimeFile.from_dict(captured.to_dict()),
                    captured,
                )

        payload = files[0].to_dict()
        payload["moduleName"] = "forbidden"
        with self.assertRaises(ValueError):
            CapturedRuntimeFile.from_dict(payload)

        payload = files[1].to_dict()
        payload["moduleName"] = None
        with self.assertRaises(ValueError):
            CapturedRuntimeFile.from_dict(payload)

        payload = files[2].to_dict()
        payload["originKind"] = RuntimeImageOriginKind.DARWIN_SHARED_CACHE.value
        with self.assertRaises(ValueError):
            CapturedRuntimeFile.from_dict(payload)

    def test_executable_build_and_runtime_round_trip(self) -> None:
        executable = finalizer_executable()
        runtime = finalizer_runtime()

        self.assertEqual(
            FinalizerExecutableArtifact.from_dict(executable.to_dict()),
            executable,
        )
        self.assertEqual(
            SupervisorBuildIdentity.from_dict(
                runtime.supervisor_build_identity.to_dict()
            ),
            runtime.supervisor_build_identity,
        )
        self.assertEqual(
            FinalizerRuntimeIdentity.from_dict(runtime.to_dict()),
            runtime,
        )
        self.assertFalse(hasattr(runtime, "store"))
        with self.assertRaises(dataclasses.FrozenInstanceError):
            runtime.protocol_version = 2

    def test_executable_and_runtime_digest_mutations_fail_closed(self) -> None:
        executable_payload = finalizer_executable().to_dict()
        executable_payload["bundleDigest"] = SHA_B
        with self.assertRaises(ValueError):
            FinalizerExecutableArtifact.from_dict(executable_payload)

        executable_payload = finalizer_executable().to_dict()
        executable_payload["files"] = list(
            reversed(executable_payload["files"])
        )
        with self.assertRaises(ValueError):
            FinalizerExecutableArtifact.from_dict(executable_payload)

        for mutate in (
            lambda payload: payload.update(finalizerRuntimeDigest=SHA_A),
            lambda payload: payload.update(supervisorRuntimeDigest=SHA_A),
            lambda payload: payload.update(stdlibDigest=SHA_A),
            lambda payload: payload["supervisorBuildIdentity"].update(
                compilerFlagsDigest=SHA_A
            ),
            lambda payload: payload["executableRef"].update(
                runId=(
                    "20260831T120102123456Z-"
                    "ffffffffffffffffffffffffffffffff"
                )
            ),
            lambda payload: payload.update(extra=True),
        ):
            payload = finalizer_runtime().to_dict()
            mutate(payload)
            with self.assertRaises(ValueError):
                FinalizerRuntimeIdentity.from_dict(payload)

    def test_stdlib_origin_branches_are_closed(self) -> None:
        file_module = finalizer_runtime().stdlib_modules[0]
        self.assertEqual(
            StdlibModuleIdentity.from_dict(file_module.to_dict()),
            file_module,
        )

        payload = file_module.to_dict()
        payload["originKind"] = StdlibModuleOriginKind.BUILTIN.value
        with self.assertRaises(ValueError):
            StdlibModuleIdentity.from_dict(payload)

        payload = file_module.to_dict()
        payload["originKind"] = "DYNAMIC"
        with self.assertRaises(ValueError):
            StdlibModuleIdentity.from_dict(payload)

    def test_linux_platform_branch_and_order_are_exact(self) -> None:
        platform = linux_platform_runtime()
        self.assertEqual(
            RuntimePlatformAttestation.from_dict(platform.to_dict()),
            platform,
        )
        self.assertEqual(
            tuple(image.logical_name for image in platform.loaded_images),
            ("dynamic-loader", "libpython"),
        )

        payload = platform.to_dict()
        payload["loadedImages"] = list(reversed(payload["loadedImages"]))
        with self.assertRaises(ValueError):
            RuntimePlatformAttestation.from_dict(payload)

        payload = platform.to_dict()
        payload["sharedCacheUuid"] = "forbidden-on-linux"
        with self.assertRaises(ValueError):
            RuntimePlatformAttestation.from_dict(payload)

    def test_darwin_host_and_shared_cache_branch_round_trip(self) -> None:
        host_build = DarwinRuntimeHostBuild.create(
            product_version="15.6",
            product_build_version="24G84",
            kernel_release="24.6.0",
            kernel_version="synthetic-darwin-kernel",
        )
        host_identity = DarwinRuntimeHostIdentity.create(
            host_build=host_build,
            hardware_identity_hash=SHA_A,
        )
        loader = LoadedRuntimeImage.create(
            logical_name="dynamic-loader",
            origin_kind=RuntimeImageOriginKind.DARWIN_SHARED_CACHE,
            path_hash=SHA_B,
            macho_uuid="synthetic-macho-uuid",
            code_directory_hash="synthetic-code-directory-hash",
            shared_cache_uuid="synthetic-shared-cache-uuid",
        )
        platform = RuntimePlatformAttestation.create(
            os_family=RuntimeOsFamily.DARWIN,
            host_build=host_build,
            dynamic_loader_identity=loader,
            shared_cache_uuid="synthetic-shared-cache-uuid",
            loaded_images=(loader,),
        )

        self.assertEqual(runtime_host_build_from_dict(host_build.to_dict()), host_build)
        self.assertEqual(
            runtime_host_identity_from_dict(host_identity.to_dict()),
            host_identity,
        )
        self.assertEqual(
            RuntimePlatformAttestation.from_dict(platform.to_dict()),
            platform,
        )

        payload = platform.to_dict()
        payload["sharedCacheUuid"] = "different-cache"
        with self.assertRaises(ValueError):
            RuntimePlatformAttestation.from_dict(payload)

    def test_linux_host_identity_digest_and_union_are_closed(self) -> None:
        host_build = LinuxRuntimeHostBuild.create(
            os_release_file_sha256=SHA_A,
            kernel_release="6.8.0",
            kernel_version="synthetic-linux-kernel",
            machine="aarch64",
        )
        identity = LinuxRuntimeHostIdentity.create(
            host_build=host_build,
            machine_id_hash=SHA_B,
        )
        self.assertEqual(
            runtime_host_identity_from_dict(identity.to_dict()),
            identity,
        )

        payload = identity.to_dict()
        payload["runtimeHostIdentityDigest"] = SHA_C
        with self.assertRaises(ValueError):
            runtime_host_identity_from_dict(payload)

        payload = host_build.to_dict()
        payload["osFamily"] = "WINDOWS"
        with self.assertRaises(ValueError):
            runtime_host_build_from_dict(payload)


class FinalizerInputClosureTest(unittest.TestCase):
    def test_context_invocation_input_and_seal_round_trip(self) -> None:
        values = finalizer_identity_values()
        context = FinalizerContext.create(**values)
        invocation = FinalizerInvocationIdentity.create(**values)
        current_snapshot = snapshot()
        current_primary = primary_result()
        finalizer_input = FinalizerInput.create(
            invocation=invocation,
            context=context,
            snapshot=current_snapshot,
        )
        marker = SealedEvidenceMarker.create(
            snapshot=current_snapshot,
            finalizer_context=context,
            primary_result=current_primary,
            sealed_at="2026-08-31T12:01:03+00:00",
        )

        self.assertEqual(FinalizerContext.from_dict(context.to_dict()), context)
        self.assertEqual(
            FinalizerInvocationIdentity.from_dict(invocation.to_dict()),
            invocation,
        )
        self.assertEqual(
            FinalizerInput.from_dict(finalizer_input.to_dict()),
            finalizer_input,
        )
        self.assertEqual(
            SealedEvidenceMarker.from_dict(marker.to_dict()),
            marker,
        )

    def test_invocation_digest_excludes_only_runtime_self_digest(self) -> None:
        invocation = FinalizerInvocationIdentity.create(
            **finalizer_identity_values()
        )
        expected_runtime = invocation.finalizer_runtime.to_dict()
        expected_runtime.pop("finalizerRuntimeDigest")
        expected_payload = invocation.to_dict()
        expected_payload.pop("invocationDigest")
        expected_payload["finalizerRuntime"] = expected_runtime
        self.assertEqual(
            invocation.invocation_digest,
            domain_separated_sha256(
                "pt.acceptance.finalization.invocation.v1",
                expected_payload,
            ),
        )

    def test_input_rejects_every_duplicate_authority_mismatch(self) -> None:
        values = finalizer_identity_values()
        finalizer_input = FinalizerInput.create(
            invocation=FinalizerInvocationIdentity.create(**values),
            context=FinalizerContext.create(**values),
            snapshot=snapshot(),
        )

        payload = finalizer_input.to_dict()
        payload["context"]["enforcementDigest"] = SHA_E
        with self.assertRaises(ValueError):
            FinalizerInput.from_dict(payload)

        payload = finalizer_input.to_dict()
        payload["snapshot"]["workspaceDigest"] = "different"
        payload["snapshot"]["snapshotDigest"] = SHA_A
        with self.assertRaises(ValueError):
            FinalizerInput.from_dict(payload)

        payload = finalizer_input.to_dict()
        payload["finalizerInputDigest"] = SHA_A
        with self.assertRaises(ValueError):
            FinalizerInput.from_dict(payload)

    def test_input_rejects_required_role_absent_from_snapshot(self) -> None:
        values = {
            **finalizer_identity_values(),
            "required_role_identities": (
                ("synthetic-missing", None),
                ("synthetic-runtime", None),
            ),
        }

        with self.assertRaisesRegex(
            ValueError,
            "requiredRoleIdentities are absent from snapshot artifacts",
        ):
            FinalizerInput.create(
                invocation=FinalizerInvocationIdentity.create(**values),
                context=FinalizerContext.create(**values),
                snapshot=snapshot(),
            )

    def test_context_rejects_nested_artifact_ref_identity_substitution(
        self,
    ) -> None:
        context = FinalizerContext.create(**finalizer_identity_values())
        payload = context.to_dict()
        payload["finalizerExecutable"]["ref"]["runId"] = (
            "20260831T120102123456Z-ffffffffffffffffffffffffffffffff"
        )
        with self.assertRaises(ValueError):
            FinalizerContext.from_dict(payload)

    def test_seal_rejects_context_primary_and_digest_mutations(self) -> None:
        values = finalizer_identity_values()
        marker = SealedEvidenceMarker.create(
            snapshot=snapshot(),
            finalizer_context=FinalizerContext.create(**values),
            primary_result=primary_result(),
            sealed_at="2026-08-31T12:01:03+00:00",
        )
        for field, value in (
            ("primaryResultDigest", SHA_A),
            ("sealDigest", SHA_B),
            ("schemaVersion", 2),
            ("extra", True),
        ):
            payload = marker.to_dict()
            payload[field] = value
            with self.subTest(field=field):
                with self.assertRaises(ValueError):
                    SealedEvidenceMarker.from_dict(payload)

    def test_seal_rejects_invalid_time_and_primary_source_identity(self) -> None:
        values = finalizer_identity_values()
        current_snapshot = snapshot()
        context = FinalizerContext.create(**values)

        with self.assertRaisesRegex(
            ValueError,
            "sealedAt must not precede evaluationTime",
        ):
            SealedEvidenceMarker.create(
                snapshot=current_snapshot,
                finalizer_context=context,
                primary_result=primary_result(),
                sealed_at="2026-08-31T12:01:01+00:00",
            )

        foreign_trace = PrimaryResultSourceTrace.create(
            producer_id="synthetic-runner",
            source_commit="foreign-source-commit",
            invocation_id="synthetic-primary-invocation",
            evidence_refs=(
                artifact_ref("reports/primary.json", sha256=SHA_B),
            ),
        )
        foreign_document = {
            **CanonicalResultTuple.PassedDoneProven.to_dict(),
            "reasonCode": None,
            "sourceTrace": foreign_trace.to_dict(),
        }
        foreign_primary = CanonicalPrimaryResult(
            document=CanonicalOpaqueJson.from_value(
                schema_id="acceptance-primary-result-v1",
                schema_digest=SHA_C,
                value=foreign_document,
            ),
            result_tuple=CanonicalResultTuple.PassedDoneProven,
            reason_code=None,
            source_trace=foreign_trace,
        )
        foreign_context = FinalizerContext.create(
            **{
                **values,
                "primary_result_digest": foreign_primary.digest(),
            }
        )
        with self.assertRaisesRegex(
            ValueError,
            "primary result sourceCommit does not match snapshot",
        ):
            SealedEvidenceMarker.create(
                snapshot=current_snapshot,
                finalizer_context=foreign_context,
                primary_result=foreign_primary,
                sealed_at="2026-08-31T12:01:03+00:00",
            )

        foreign_ref = ArtifactRef(
            workspace_id="fedcba9876543210",
            gate_id=GATE_ID,
            run_id=RUN_ID,
            path="reports/primary.json",
            sha256=SHA_B,
            media_type="application/json",
        )
        foreign_trace = PrimaryResultSourceTrace.create(
            producer_id="synthetic-runner",
            source_commit=current_snapshot.source_commit,
            invocation_id="synthetic-primary-invocation",
            evidence_refs=(foreign_ref,),
        )
        foreign_document = {
            **CanonicalResultTuple.PassedDoneProven.to_dict(),
            "reasonCode": None,
            "sourceTrace": foreign_trace.to_dict(),
        }
        foreign_primary = CanonicalPrimaryResult(
            document=CanonicalOpaqueJson.from_value(
                schema_id="acceptance-primary-result-v1",
                schema_digest=SHA_C,
                value=foreign_document,
            ),
            result_tuple=CanonicalResultTuple.PassedDoneProven,
            reason_code=None,
            source_trace=foreign_trace,
        )
        foreign_context = FinalizerContext.create(
            **{
                **values,
                "primary_result_digest": foreign_primary.digest(),
            }
        )
        with self.assertRaisesRegex(
            ValueError,
            "primary result evidenceRefs do not match snapshot",
        ):
            SealedEvidenceMarker.create(
                snapshot=current_snapshot,
                finalizer_context=foreign_context,
                primary_result=foreign_primary,
                sealed_at="2026-08-31T12:01:03+00:00",
            )

        unlisted_trace = PrimaryResultSourceTrace.create(
            producer_id="synthetic-runner",
            source_commit=current_snapshot.source_commit,
            invocation_id="synthetic-primary-invocation",
            evidence_refs=(
                artifact_ref("reports/unlisted.json", sha256=SHA_B),
            ),
        )
        unlisted_document = {
            **CanonicalResultTuple.PassedDoneProven.to_dict(),
            "reasonCode": None,
            "sourceTrace": unlisted_trace.to_dict(),
        }
        unlisted_primary = CanonicalPrimaryResult(
            document=CanonicalOpaqueJson.from_value(
                schema_id="acceptance-primary-result-v1",
                schema_digest=SHA_C,
                value=unlisted_document,
            ),
            result_tuple=CanonicalResultTuple.PassedDoneProven,
            reason_code=None,
            source_trace=unlisted_trace,
        )
        unlisted_context = FinalizerContext.create(
            **{
                **values,
                "primary_result_digest": unlisted_primary.digest(),
            }
        )
        with self.assertRaisesRegex(
            ValueError,
            "primary result evidenceRefs are absent from snapshot",
        ):
            SealedEvidenceMarker.create(
                snapshot=current_snapshot,
                finalizer_context=unlisted_context,
                primary_result=unlisted_primary,
                sealed_at="2026-08-31T12:01:03+00:00",
            )

    def test_preflight_token_round_trip_is_closed(self) -> None:
        token = FinalizerPreflightToken.create(
            enforcement_generation=1,
            enforcement_digest=SHA_A,
            requirement_digest=SHA_B,
            config_digest=SHA_C,
            source_digest=SHA_D,
            supervisor_session_id="synthetic-supervisor-session",
            supervisor_runtime_digest=SHA_E,
            preflight_runtime_digest=SHA_A,
            source_capture_id="synthetic-source-capture",
            source_capture_digest=SHA_B,
            runtime_capture_id="synthetic-runtime-capture",
            runtime_capture_digest=SHA_C,
            durability_profile_digest=SHA_D,
        )
        self.assertEqual(
            FinalizerPreflightToken.from_dict(token.to_dict()),
            token,
        )

        payload = token.to_dict()
        payload["unknown"] = True
        with self.assertRaises(ValueError):
            FinalizerPreflightToken.from_dict(payload)


class AuthoritativeResolutionContractTest(unittest.TestCase):
    def latest_pointer(self) -> LatestPointer:
        manifest = artifact_ref("manifest.json", sha256=SHA_B)
        return LatestPointer.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            run_id=RUN_ID,
            completed_at="2026-08-31T12:01:04+00:00",
            manifest=manifest,
        )

    def test_latest_pointer_round_trip_digest_and_immutability(self) -> None:
        pointer = self.latest_pointer()
        self.assertEqual(LatestPointer.from_dict(pointer.to_dict()), pointer)
        self.assertEqual(
            pointer.digest(),
            domain_separated_sha256(
                "pt.acceptance.finalization.prior-latest-pointer.v1",
                pointer.to_dict(),
            ),
        )
        with self.assertRaises(dataclasses.FrozenInstanceError):
            pointer.run_id = "changed"
        class ArtifactRefSubclass(ArtifactRef):
            def to_dict(self) -> dict[str, object]:
                return {
                    **super().to_dict(),
                    "path": "substituted.json",
                }

        manifest_subclass = ArtifactRefSubclass(
            **{
                field.name: getattr(pointer.manifest, field.name)
                for field in dataclasses.fields(pointer.manifest)
            }
        )
        with self.assertRaisesRegex(
            ValueError,
            "manifest must be an ArtifactRef",
        ):
            LatestPointer.create(
                workspace_id=WORKSPACE_ID,
                gate_id=GATE_ID,
                run_id=RUN_ID,
                completed_at="2026-08-31T12:01:04+00:00",
                manifest=manifest_subclass,
            )

    def test_latest_pointer_rejects_identity_hash_and_unknown_mutations(
        self,
    ) -> None:
        pointer = self.latest_pointer()
        mutations = (
            lambda payload: payload.update(manifestSha256=SHA_A),
            lambda payload: payload["manifest"].update(gateId="other-gate"),
            lambda payload: payload["manifest"].update(
                runId=(
                    "20260831T120102123456Z-"
                    "ffffffffffffffffffffffffffffffff"
                )
            ),
            lambda payload: payload.update(schemaVersion=2),
            lambda payload: payload.update(extra=True),
        )
        for mutate in mutations:
            payload = pointer.to_dict()
            mutate(payload)
            with self.subTest(payload=payload):
                with self.assertRaises(ValueError):
                    LatestPointer.from_dict(payload)

    def test_both_authority_mode_branches_round_trip(self) -> None:
        pointer = self.latest_pointer()
        legacy = AuthoritativeLatestResolution.create(
            authority_mode=LatestAuthorityMode.LEGACY,
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            interlock_digest=None,
            generation=None,
            enforcement_digest=None,
            manifest_ref=pointer.manifest,
            result_tuple=CanonicalResultTuple.PassedDoneProven,
        )
        enforced = AuthoritativeLatestResolution.create(
            authority_mode=LatestAuthorityMode.FINALIZER_ENFORCED,
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            interlock_digest=SHA_A,
            generation=2,
            enforcement_digest=SHA_C,
            manifest_ref=pointer.manifest,
            result_tuple=CanonicalResultTuple.FailedPartialUnproven,
        )
        for resolution in (legacy, enforced):
            with self.subTest(authority_mode=resolution.authority_mode):
                self.assertEqual(
                    AuthoritativeLatestResolution.from_dict(
                        resolution.to_dict()
                    ),
                    resolution,
                )
                with self.assertRaises(dataclasses.FrozenInstanceError):
                    resolution.gate_id = "changed"

    def test_resolution_rejects_branch_identity_digest_and_unknown_mutations(
        self,
    ) -> None:
        pointer = self.latest_pointer()
        legacy = AuthoritativeLatestResolution.create(
            authority_mode=LatestAuthorityMode.LEGACY,
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            interlock_digest=None,
            generation=None,
            enforcement_digest=None,
            manifest_ref=pointer.manifest,
            result_tuple=CanonicalResultTuple.PassedDoneProven,
        )
        enforced = AuthoritativeLatestResolution.create(
            authority_mode=LatestAuthorityMode.FINALIZER_ENFORCED,
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            interlock_digest=SHA_A,
            generation=1,
            enforcement_digest=SHA_B,
            manifest_ref=pointer.manifest,
            result_tuple=CanonicalResultTuple.PassedDoneProven,
        )
        cases = (
            (legacy, lambda payload: payload.update(interlockDigest=SHA_A)),
            (legacy, lambda payload: payload.update(generation=1)),
            (enforced, lambda payload: payload.update(interlockDigest=None)),
            (enforced, lambda payload: payload.update(generation=None)),
            (enforced, lambda payload: payload.update(generation=0)),
            (enforced, lambda payload: payload.update(enforcementDigest=None)),
            (
                enforced,
                lambda payload: payload["manifestRef"].update(
                    workspaceId="ffffffffffffffff"
                ),
            ),
            (enforced, lambda payload: payload.update(manifestSha256=SHA_E)),
            (enforced, lambda payload: payload.update(resolutionDigest=SHA_E)),
            (enforced, lambda payload: payload.update(extra=True)),
        )
        for resolution, mutate in cases:
            payload = resolution.to_dict()
            mutate(payload)
            with self.subTest(payload=payload):
                with self.assertRaises(ValueError):
                    AuthoritativeLatestResolution.from_dict(payload)


class EnforcementSelectorContractTest(unittest.TestCase):
    def test_activated_and_current_round_trip_and_are_frozen(self) -> None:
        activated = FinalizerEnforcementActivated.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            required_finalizer_id=FINALIZER_ID,
            first_generation=1,
            first_enforcement_digest=SHA_A,
            activated_at="2026-08-31T12:02:00+00:00",
            activation_source_commit="synthetic-source-commit",
            activation_intent_digest=SHA_B,
        )
        current = FinalizerEnforcementCurrent.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            required_finalizer_id=FINALIZER_ID,
            generation=3,
            enforcement_digest=SHA_C,
        )
        self.assertEqual(
            FinalizerEnforcementActivated.from_dict(activated.to_dict()),
            activated,
        )
        self.assertEqual(
            FinalizerEnforcementCurrent.from_dict(current.to_dict()),
            current,
        )
        with self.assertRaises(dataclasses.FrozenInstanceError):
            current.generation = 4

    def test_activated_and_current_reject_all_contract_mutations(self) -> None:
        activated = FinalizerEnforcementActivated.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            required_finalizer_id=FINALIZER_ID,
            first_generation=1,
            first_enforcement_digest=SHA_A,
            activated_at="2026-08-31T12:02:00+00:00",
            activation_source_commit="synthetic-source-commit",
            activation_intent_digest=SHA_B,
        )
        current = FinalizerEnforcementCurrent.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            required_finalizer_id=FINALIZER_ID,
            generation=1,
            enforcement_digest=SHA_C,
        )
        cases = (
            (
                FinalizerEnforcementActivated,
                activated,
                lambda payload: payload.update(firstGeneration=2),
            ),
            (
                FinalizerEnforcementActivated,
                activated,
                lambda payload: payload.update(activatedDigest=SHA_E),
            ),
            (
                FinalizerEnforcementActivated,
                activated,
                lambda payload: payload.update(extra=True),
            ),
            (
                FinalizerEnforcementCurrent,
                current,
                lambda payload: payload.update(generation=0),
            ),
            (
                FinalizerEnforcementCurrent,
                current,
                lambda payload: payload.update(currentDigest=SHA_E),
            ),
            (
                FinalizerEnforcementCurrent,
                current,
                lambda payload: payload.update(extra=True),
            ),
        )
        for contract_type, contract, mutate in cases:
            payload = contract.to_dict()
            mutate(payload)
            with self.subTest(contract=contract_type.__name__, payload=payload):
                with self.assertRaises(ValueError):
                    contract_type.from_dict(payload)


class AbortPreflightContractTest(unittest.TestCase):
    def request(self) -> AbortSealedPreflightRequest:
        return AbortSealedPreflightRequest.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            evidence_run_id=RUN_ID,
            authorization_id="synthetic-authorization",
            attempt_id="synthetic-attempt",
            source_commit="synthetic-source-commit",
            durability_profile_digest=SHA_A,
        )

    def test_operator_identity_is_closed_canonical_and_immutable(self) -> None:
        identity = AbortOperatorIdentity.create(effective_uid=501)
        self.assertEqual(
            identity.identity_kind,
            AbortOperatorIdentityKind.POSIX_EFFECTIVE_UID,
        )
        self.assertEqual(
            AbortOperatorIdentity.from_dict(identity.to_dict()),
            identity,
        )
        with self.assertRaises(dataclasses.FrozenInstanceError):
            identity.principal_id = "posix-euid:0"
        for principal_id in (
            "501",
            "posix-euid:-1",
            "posix-euid:01",
            "posix-euid:4294967296",
        ):
            payload = identity.to_dict()
            payload["principalId"] = principal_id
            with self.subTest(principal_id=principal_id):
                with self.assertRaises(ValueError):
                    AbortOperatorIdentity.from_dict(payload)
        payload = identity.to_dict()
        payload["extra"] = True
        with self.assertRaises(ValueError):
            AbortOperatorIdentity.from_dict(payload)

    def test_abort_preflight_request_and_rejection_round_trip(self) -> None:
        request = self.request()
        rejected = AbortSealedPreflightRejected.create(
            request=request,
            host_os_family=RuntimeOsFamily.LINUX,
            diagnostic="synthetic backend unsupported",
        )
        self.assertEqual(
            AbortSealedPreflightRequest.from_dict(request.to_dict()),
            request,
        )
        self.assertEqual(
            AbortSealedPreflightRejected.from_dict(rejected.to_dict()),
            rejected,
        )
        self.assertIs(rejected.status, AbortPreflightStatus.REJECTED)
        self.assertIs(
            rejected.durable_boundary,
            AbortPreflightDurableBoundary.NO_MUTATION,
        )

    def test_abort_preflight_rejects_branch_digest_and_unknown_mutations(
        self,
    ) -> None:
        request = self.request()
        rejected = AbortSealedPreflightRejected.create(
            request=request,
            host_os_family=RuntimeOsFamily.DARWIN,
            diagnostic="synthetic unsupported delete",
        )
        request_mutations = (
            lambda payload: payload.update(
                abortPreflightRequestDigest=SHA_E
            ),
            lambda payload: payload.update(durabilityProfileDigest="bad"),
            lambda payload: payload.update(evidenceRunId="bad-run"),
            lambda payload: payload.update(extra=True),
        )
        for mutate in request_mutations:
            payload = request.to_dict()
            mutate(payload)
            with self.subTest(payload=payload):
                with self.assertRaises(ValueError):
                    AbortSealedPreflightRequest.from_dict(payload)

        result_mutations = (
            lambda payload: payload.update(status="COMPLETED"),
            lambda payload: payload.update(durableBoundary="MUTATED"),
            lambda payload: payload.update(
                failureCode=FinalizerFailureCode.TIMED_OUT.value
            ),
            lambda payload: payload.update(hostOsFamily="WINDOWS"),
            lambda payload: payload.update(abortPreflightResultDigest=SHA_E),
            lambda payload: payload["request"].update(attemptId="substituted"),
            lambda payload: payload.update(extra=True),
        )
        for mutate in result_mutations:
            payload = rejected.to_dict()
            mutate(payload)
            with self.subTest(payload=payload):
                with self.assertRaises(ValueError):
                    AbortSealedPreflightRejected.from_dict(payload)


class DurabilityIdentityContractTest(unittest.TestCase):
    def linux_host(
        self,
    ) -> tuple[LinuxRuntimeHostBuild, LinuxRuntimeHostIdentity]:
        build = LinuxRuntimeHostBuild.create(
            os_release_file_sha256=SHA_A,
            kernel_release="6.8.0",
            kernel_version="synthetic-linux",
            machine="x86_64",
        )
        return build, LinuxRuntimeHostIdentity.create(
            host_build=build,
            machine_id_hash=SHA_B,
        )

    def test_stable_volume_branches_round_trip_and_are_immutable(self) -> None:
        linux = LinuxStableVolumeIdentity.create(
            filesystem_type="ext4",
            filesystem_uuid="synthetic-linux-volume",
        )
        self.assertEqual(
            linux.volume_identity_digest,
            "a404bbc8b25ecb78a843e752278a9b7b5fa78711228598f355108ab128d7d55d",
        )
        darwin = DarwinStableVolumeIdentity.create(
            volume_uuid="synthetic-apfs-volume",
            container_uuid="synthetic-apfs-container",
        )
        for identity in (linux, darwin):
            with self.subTest(identity=type(identity).__name__):
                self.assertEqual(
                    stable_volume_identity_from_dict(identity.to_dict()),
                    identity,
                )
                with self.assertRaises(dataclasses.FrozenInstanceError):
                    identity.volume_identity_digest = SHA_E

        payload = linux.to_dict()
        payload["osFamily"] = RuntimeOsFamily.DARWIN.value
        with self.assertRaises(ValueError):
            stable_volume_identity_from_dict(payload)
        payload = darwin.to_dict()
        payload["filesystemType"] = "HFS+"
        with self.assertRaises(ValueError):
            DarwinStableVolumeIdentity.from_dict(payload)
        payload = linux.to_dict()
        payload["extra"] = True
        with self.assertRaises(ValueError):
            LinuxStableVolumeIdentity.from_dict(payload)

    def test_sync_anchor_is_closed_and_digest_bound(self) -> None:
        anchor = DurabilitySyncAnchorIdentity.create(
            device_id="2049",
            inode="42",
            content_sha256=SHA_A,
            byte_length=128,
        )
        self.assertEqual(
            anchor.anchor_identity_digest,
            "db8eceb154f1f2d0bdb3439f1b3af627df7edf8eee25d5ce13943bdf01b69206",
        )
        self.assertEqual(
            DurabilitySyncAnchorIdentity.from_dict(anchor.to_dict()),
            anchor,
        )
        for field, value in (
            ("fileType", "DIRECTORY"),
            ("byteLength", -1),
            ("anchorIdentityDigest", SHA_B),
            ("extra", True),
        ):
            payload = anchor.to_dict()
            payload[field] = value
            with self.subTest(field=field):
                with self.assertRaises(ValueError):
                    DurabilitySyncAnchorIdentity.from_dict(payload)

    def test_qualified_environment_closes_host_and_volume_os_identity(
        self,
    ) -> None:
        build, identity = self.linux_host()
        volume = LinuxStableVolumeIdentity.create(
            filesystem_type="ext4",
            filesystem_uuid="synthetic-linux-volume",
        )
        environment = DurabilityQualifiedEnvironment.create(
            host_build=build,
            host_identity=identity,
            filesystem_implementation_version="ext4-synthetic",
            required_mount_options=("rw", "sync"),
            stable_volume_identity=volume,
            probe_runtime_digest=SHA_C,
        )
        self.assertEqual(
            DurabilityQualifiedEnvironment.from_dict(environment.to_dict()),
            environment,
        )

        payload = environment.to_dict()
        payload["requiredMountOptions"] = ["sync", "rw"]
        with self.assertRaises(ValueError):
            DurabilityQualifiedEnvironment.from_dict(payload)

        darwin_volume = DarwinStableVolumeIdentity.create(
            volume_uuid="synthetic-apfs-volume",
            container_uuid="synthetic-apfs-container",
        )
        payload = environment.to_dict()
        payload["stableVolumeIdentity"] = darwin_volume.to_dict()
        with self.assertRaises(ValueError):
            DurabilityQualifiedEnvironment.from_dict(payload)

        other_build = LinuxRuntimeHostBuild.create(
            os_release_file_sha256=SHA_D,
            kernel_release="6.8.1",
            kernel_version="different-linux",
            machine="x86_64",
        )
        payload = environment.to_dict()
        payload["hostBuild"] = other_build.to_dict()
        with self.assertRaises(ValueError):
            DurabilityQualifiedEnvironment.from_dict(payload)

    def test_capability_ref_uses_exact_schema_and_typed_object_digest(self) -> None:
        reference = DurabilityCapabilityArtifactRef.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            crash_fixture_id="synthetic-crash-fixture",
            artifact_name=DurabilityCapabilityArtifactName.EXPECTATION,
            object_digest=SHA_A,
            content_sha256=SHA_B,
            byte_length=100,
        )
        self.assertEqual(
            DurabilityCapabilityArtifactRef.from_dict(reference.to_dict()),
            reference,
        )
        payload = reference.to_dict()
        payload["objectDigest"] = None
        with self.assertRaises(ValueError):
            DurabilityCapabilityArtifactRef.from_dict(payload)
        payload = reference.to_dict()
        payload["qualificationRunId"] = "not-part-of-this-contract"
        with self.assertRaises(ValueError):
            DurabilityCapabilityArtifactRef.from_dict(payload)

    def test_environment_observation_branches_close_live_identity(self) -> None:
        build, identity = self.linux_host()
        volume = LinuxStableVolumeIdentity.create(
            filesystem_type="ext4",
            filesystem_uuid="synthetic-linux-volume",
        )
        qualified = DurabilityQualifiedEnvironment.create(
            host_build=build,
            host_identity=identity,
            filesystem_implementation_version="ext4-synthetic",
            required_mount_options=("rw", "sync"),
            stable_volume_identity=volume,
            probe_runtime_digest=SHA_C,
        )
        mount = LiveAuthorityMountBinding.create(
            os_family=RuntimeOsFamily.LINUX,
            stable_volume_identity_digest=volume.volume_identity_digest,
            mount_namespace_id="mnt:[100]",
            mount_id="42",
            darwin_fsid=None,
            device_id="2049",
            host_build=build,
            filesystem_implementation_version="ext4-synthetic",
            mount_options=("rw", "sync"),
            observed_at="2026-08-31T12:00:00+00:00",
        )
        qualification_ref = DurabilityCapabilityArtifactRef.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            crash_fixture_id="synthetic-crash-fixture",
            artifact_name=(
                DurabilityCapabilityArtifactName.QUALIFICATION_BOOT_OBSERVATION
            ),
            object_digest=SHA_A,
            content_sha256=SHA_B,
            byte_length=100,
        )
        qualification = QualificationDurabilityEnvironmentObservation.create(
            qualified_environment_digest=qualified.qualified_environment_digest,
            host_build=build,
            host_identity=identity,
            filesystem_implementation_version="ext4-synthetic",
            mount_options=("rw", "sync"),
            stable_volume_identity=volume,
            live_mount_binding=mount,
            boot_observation_ref=qualification_ref,
            observed_at="2026-08-31T12:00:01+00:00",
        )
        self.assertEqual(
            durability_environment_observation_from_dict(
                qualification.to_dict()
            ),
            qualification,
        )

        active_ref = DurabilityCapabilityArtifactRef.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            crash_fixture_id="synthetic-crash-fixture",
            artifact_name=DurabilityCapabilityArtifactName.BOOT_OBSERVATION,
            object_digest=SHA_A,
            content_sha256=SHA_B,
            byte_length=100,
        )
        active = ActiveDurabilityEnvironmentObservation.create(
            qualified_environment_digest=qualified.qualified_environment_digest,
            host_build=build,
            host_identity=identity,
            filesystem_implementation_version="ext4-synthetic",
            mount_options=("rw", "sync"),
            stable_volume_identity=volume,
            live_mount_binding=mount,
            boot_observation_ref=active_ref,
            observed_at="2026-08-31T12:00:01+00:00",
        )
        self.assertEqual(
            durability_environment_observation_from_dict(active.to_dict()),
            active,
        )
        self.assertIs(
            validate_durability_environment_observation(active, qualified),
            active,
        )

        substituted_qualified = DurabilityQualifiedEnvironment.create(
            host_build=build,
            host_identity=identity,
            filesystem_implementation_version="ext4-synthetic",
            required_mount_options=("rw", "sync"),
            stable_volume_identity=volume,
            probe_runtime_digest=SHA_D,
        )
        with self.assertRaises(ValueError):
            validate_durability_environment_observation(
                active,
                substituted_qualified,
            )

        payload = qualification.to_dict()
        payload["observationMode"] = DurabilityObservationMode.ACTIVE_PROFILE.value
        with self.assertRaises(ValueError):
            QualificationDurabilityEnvironmentObservation.from_dict(payload)
        payload = active.to_dict()
        payload["liveMountBinding"]["mountOptions"] = ["rw"]
        with self.assertRaises(ValueError):
            ActiveDurabilityEnvironmentObservation.from_dict(payload)
        payload = active.to_dict()
        payload["bootObservationRef"]["artifactName"] = (
            DurabilityCapabilityArtifactName.QUALIFICATION_BOOT_OBSERVATION.value
        )
        with self.assertRaises(ValueError):
            ActiveDurabilityEnvironmentObservation.from_dict(payload)

    def test_crash_case_closes_ref_identity_and_artifact_names(self) -> None:
        def durability_ref(
            artifact_name: DurabilityCapabilityArtifactName,
            *,
            crash_fixture_id: str = "synthetic-crash-fixture",
        ) -> DurabilityCapabilityArtifactRef:
            return DurabilityCapabilityArtifactRef.create(
                workspace_id=WORKSPACE_ID,
                gate_id=GATE_ID,
                crash_fixture_id=crash_fixture_id,
                artifact_name=artifact_name,
                object_digest=SHA_A,
                content_sha256=SHA_B,
                byte_length=100,
            )

        crash_case = DurabilityCrashCase.create(
            case_id="after-file-sync",
            interruption_point=DurabilityInterruptionPoint.AFTER_FILE_SYNC,
            expected_recovered_state=DurabilityRecoveredState.OLD_BYTES,
            trace_ref=durability_ref(
                DurabilityCapabilityArtifactName.POWER_CUT_TRACE
            ),
            recovery_result_ref=durability_ref(
                DurabilityCapabilityArtifactName.RECOVERY_RESULT
            ),
        )
        self.assertEqual(
            DurabilityCrashCase.from_dict(crash_case.to_dict()),
            crash_case,
        )

        payload = crash_case.to_dict()
        payload["expectedRecoveredState"] = DurabilityRecoveredState.OTHER.value
        with self.assertRaises(ValueError):
            DurabilityCrashCase.from_dict(payload)
        payload = crash_case.to_dict()
        payload["recoveryResultRef"] = durability_ref(
            DurabilityCapabilityArtifactName.RECOVERY_RESULT,
            crash_fixture_id="other-crash-fixture",
        ).to_dict()
        with self.assertRaises(ValueError):
            DurabilityCrashCase.from_dict(payload)
        payload = crash_case.to_dict()
        payload["traceRef"]["artifactName"] = (
            DurabilityCapabilityArtifactName.MANIFEST.value
        )
        with self.assertRaises(ValueError):
            DurabilityCrashCase.from_dict(payload)

        blob = DurabilityCapabilityArtifactRef.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            crash_fixture_id="synthetic-crash-fixture",
            artifact_name=DurabilityCapabilityArtifactName.PROBE_RUNTIME_BLOB,
            object_digest=None,
            content_sha256=SHA_B,
            byte_length=100,
        )
        payload = blob.to_dict()
        payload["objectDigest"] = SHA_A
        with self.assertRaises(ValueError):
            DurabilityCapabilityArtifactRef.from_dict(payload)

    def test_linux_crash_fixture_manifest_closes_backend_and_case_matrix(
        self,
    ) -> None:
        build, identity = self.linux_host()
        volume = LinuxStableVolumeIdentity.create(
            filesystem_type="ext4",
            filesystem_uuid="synthetic-linux-volume",
        )
        qualified = DurabilityQualifiedEnvironment.create(
            host_build=build,
            host_identity=identity,
            filesystem_implementation_version="ext4-synthetic",
            required_mount_options=("rw", "sync"),
            stable_volume_identity=volume,
            probe_runtime_digest=SHA_C,
        )

        def durability_ref(
            artifact_name: DurabilityCapabilityArtifactName,
            identity: str,
            object_digest: str,
        ) -> DurabilityCapabilityArtifactRef:
            return DurabilityCapabilityArtifactRef.create(
                workspace_id=WORKSPACE_ID,
                gate_id=GATE_ID,
                crash_fixture_id="synthetic-crash-fixture",
                artifact_name=artifact_name,
                object_digest=object_digest,
                content_sha256=hashlib.sha256(identity.encode()).hexdigest(),
                byte_length=len(identity),
            )

        points = (
            DurabilityInterruptionPoint.BEFORE_FILE_SYNC,
            DurabilityInterruptionPoint.AFTER_FILE_SYNC,
            DurabilityInterruptionPoint.AFTER_RENAME,
            DurabilityInterruptionPoint.AFTER_DIRECTORY_SYNC,
        )
        cases = tuple(
            DurabilityCrashCase.create(
                case_id=point.value.lower().replace("_", "-"),
                interruption_point=point,
                expected_recovered_state=(
                    DurabilityRecoveredState.ABSENT
                    if point is DurabilityInterruptionPoint.BEFORE_FILE_SYNC
                    else DurabilityRecoveredState.OLD_BYTES
                ),
                trace_ref=durability_ref(
                    DurabilityCapabilityArtifactName.POWER_CUT_TRACE,
                    f"{point.value}-trace",
                    hashlib.sha256(f"{point.value}-trace-object".encode()).hexdigest(),
                ),
                recovery_result_ref=durability_ref(
                    DurabilityCapabilityArtifactName.RECOVERY_RESULT,
                    f"{point.value}-recovery",
                    hashlib.sha256(
                        f"{point.value}-recovery-object".encode()
                    ).hexdigest(),
                ),
            )
            for point in points
        )
        manifest = DurabilityCrashFixtureManifest.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            crash_fixture_id="synthetic-crash-fixture",
            qualification_run_id="synthetic-qualification",
            backend=DurabilityBackend.LINUX_FILE_AND_DIRECTORY_FSYNC_V1,
            stable_volume_identity=volume,
            qualified_environment=qualified,
            controller_runtime_digest=SHA_D,
            controller_runtime_lock_backend_digest=SHA_E,
            expectation_ref=durability_ref(
                DurabilityCapabilityArtifactName.EXPECTATION,
                "expectation",
                SHA_A,
            ),
            expectation_digest=SHA_A,
            probe_runtime_manifest_ref=durability_ref(
                DurabilityCapabilityArtifactName.PROBE_RUNTIME_MANIFEST,
                "probe-runtime",
                SHA_C,
            ),
            operation_sequence=(
                DurabilitySyncOperation.WRITE_TEMP,
                DurabilitySyncOperation.SYNC_FILE,
                DurabilitySyncOperation.RENAME_FINAL,
                DurabilitySyncOperation.SYNC_DIRECTORY,
            ),
            old_content_sha256=SHA_A,
            new_content_sha256=SHA_B,
            cases=cases,
        )
        self.assertEqual(
            DurabilityCrashFixtureManifest.from_dict(manifest.to_dict()),
            manifest,
        )
        digest_payload = manifest.to_dict()
        digest_payload.pop("crashFixtureManifestDigest")
        self.assertEqual(
            manifest.crash_fixture_manifest_digest,
            domain_separated_sha256(
                "pt.acceptance.finalization.durability-crash-fixture-manifest.v1",
                digest_payload,
            ),
        )

        mismatched_expectation_ref = durability_ref(
            DurabilityCapabilityArtifactName.EXPECTATION,
            "other-expectation",
            SHA_B,
        )
        mutations = (
            lambda payload: payload.update(
                backend=DurabilityBackend.DARWIN_APFS_FULLFSYNC_V1.value
            ),
            lambda payload: payload.update(
                operationSequence=payload["operationSequence"][:-1]
            ),
            lambda payload: payload.update(
                cases=[payload["cases"][0], *payload["cases"][0:]]
            ),
            lambda payload: payload.update(
                expectationRef=mismatched_expectation_ref.to_dict()
            ),
            lambda payload: payload.update(result="UNSUPPORTED"),
            lambda payload: payload.update(extra=True),
        )
        for mutate in mutations:
            payload = manifest.to_dict()
            mutate(payload)
            with self.subTest(payload=payload):
                with self.assertRaises(ValueError):
                    DurabilityCrashFixtureManifest.from_dict(payload)

    def test_durability_boot_observation_branches_are_closed(self) -> None:
        linux_build, linux_identity = self.linux_host()
        darwin_build = DarwinRuntimeHostBuild.create(
            product_version="15.6",
            product_build_version="24G84",
            kernel_release="24.6.0",
            kernel_version="synthetic-darwin",
        )
        darwin_identity = DarwinRuntimeHostIdentity.create(
            host_build=darwin_build,
            hardware_identity_hash=SHA_B,
        )
        common = {
            "workspace_id": WORKSPACE_ID,
            "gate_id": GATE_ID,
            "crash_fixture_id": "synthetic-crash-fixture",
            "qualification_run_id": "synthetic-qualification",
            "source_commit": "f" * 40,
            "helper_source_digest": SHA_C,
            "helper_runtime_digest": SHA_D,
            "boot_time_seconds": "100",
            "observed_at": "2026-09-01T00:00:00+00:00",
        }
        observations = (
            (
                DarwinDurabilityQualificationBootObservation.create(
                    **common,
                    bootstrap_candidate_digest=SHA_A,
                    host_identity=darwin_identity,
                    boot_session_uuid="synthetic-darwin-qualification-boot",
                    boot_time_microseconds="10",
                ),
                durability_qualification_boot_observation_from_dict,
                "qualificationBootObservationDigest",
                "pt.acceptance.finalization.durability-qualification-boot-observation.v1",
            ),
            (
                LinuxDurabilityQualificationBootObservation.create(
                    **common,
                    bootstrap_candidate_digest=SHA_A,
                    host_identity=linux_identity,
                    boot_id="synthetic-linux-qualification-boot",
                    boot_time_nanoseconds="20",
                ),
                durability_qualification_boot_observation_from_dict,
                "qualificationBootObservationDigest",
                "pt.acceptance.finalization.durability-qualification-boot-observation.v1",
            ),
            (
                DarwinDurabilityProfileBootObservation.create(
                    **common,
                    durability_profile_digest=SHA_E,
                    host_identity=darwin_identity,
                    boot_session_uuid="synthetic-darwin-profile-boot",
                    boot_time_microseconds="30",
                ),
                durability_profile_boot_observation_from_dict,
                "profileBootObservationDigest",
                "pt.acceptance.finalization.durability-profile-boot-observation.v1",
            ),
            (
                LinuxDurabilityProfileBootObservation.create(
                    **common,
                    durability_profile_digest=SHA_E,
                    host_identity=linux_identity,
                    boot_id="synthetic-linux-profile-boot",
                    boot_time_nanoseconds="40",
                ),
                durability_profile_boot_observation_from_dict,
                "profileBootObservationDigest",
                "pt.acceptance.finalization.durability-profile-boot-observation.v1",
            ),
        )

        for observation, decoder, digest_key, domain in observations:
            with self.subTest(observation=type(observation).__name__):
                payload = observation.to_dict()
                self.assertEqual(decoder(payload), observation)
                field_names = {
                    field.name for field in dataclasses.fields(observation)
                }
                self.assertNotIn("authority_digest", field_names)
                self.assertNotIn("boot_identity", field_names)
                self.assertNotIn("boot_time_fraction", field_names)
                self.assertIn(
                    "bootstrap_candidate_digest"
                    if "Qualification" in type(observation).__name__
                    else "durability_profile_digest",
                    field_names,
                )
                digest = payload.pop(digest_key)
                self.assertEqual(
                    digest,
                    domain_separated_sha256(domain, payload),
                )
                payload["extra"] = True
                with self.assertRaises(ValueError):
                    decoder(payload)

        payload = observations[1][0].to_dict()
        payload["hostIdentity"] = darwin_identity.to_dict()
        with self.assertRaises(ValueError):
            LinuxDurabilityQualificationBootObservation.from_dict(payload)

        payload = observations[3][0].to_dict()
        payload["profileBootObservationDigest"] = SHA_A
        with self.assertRaises(ValueError):
            LinuxDurabilityProfileBootObservation.from_dict(payload)

        with self.assertRaises(ValueError):
            durability_qualification_boot_observation_from_dict(
                observations[3][0].to_dict()
            )

    def test_execution_start_closes_sequence_and_expectation_identity(self) -> None:
        expectation_ref = DurabilityCapabilityArtifactRef.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            crash_fixture_id="synthetic-crash-fixture",
            artifact_name=DurabilityCapabilityArtifactName.EXPECTATION,
            object_digest=SHA_A,
            content_sha256=SHA_B,
            byte_length=100,
        )
        first = DurabilityExecutionStartRecord.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            crash_fixture_id="synthetic-crash-fixture",
            qualification_run_id="synthetic-qualification",
            case_id="before-file-sync",
            interruption_point=DurabilityInterruptionPoint.BEFORE_FILE_SYNC,
            qualified_environment_digest=SHA_C,
            expectation_ref=expectation_ref,
            expectation_digest=SHA_A,
            durable_sequence=1,
            previous_execution_digest=None,
            started_at="2026-09-01T00:00:01+00:00",
        )
        self.assertEqual(
            DurabilityExecutionStartRecord.from_dict(first.to_dict()),
            first,
        )
        digest_payload = first.to_dict()
        digest_payload.pop("executionStartDigest")
        self.assertEqual(
            first.execution_start_digest,
            domain_separated_sha256(
                "pt.acceptance.finalization.durability-execution-start.v1",
                digest_payload,
            ),
        )

        second = DurabilityExecutionStartRecord.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            crash_fixture_id="synthetic-crash-fixture",
            qualification_run_id="synthetic-qualification",
            case_id="after-file-sync",
            interruption_point=DurabilityInterruptionPoint.AFTER_FILE_SYNC,
            qualified_environment_digest=SHA_C,
            expectation_ref=expectation_ref,
            expectation_digest=SHA_A,
            durable_sequence=2,
            previous_execution_digest=first.execution_start_digest,
            started_at="2026-09-01T00:00:02+00:00",
        )
        self.assertEqual(
            DurabilityExecutionStartRecord.from_dict(second.to_dict()),
            second,
        )

        invalid_first = first.to_dict()
        invalid_first["previousExecutionDigest"] = SHA_D
        with self.assertRaises(ValueError):
            DurabilityExecutionStartRecord.from_dict(invalid_first)

        invalid_second = second.to_dict()
        invalid_second["previousExecutionDigest"] = None
        with self.assertRaises(ValueError):
            DurabilityExecutionStartRecord.from_dict(invalid_second)

        wrong_ref = DurabilityCapabilityArtifactRef.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            crash_fixture_id="other-crash-fixture",
            artifact_name=DurabilityCapabilityArtifactName.EXPECTATION,
            object_digest=SHA_A,
            content_sha256=SHA_B,
            byte_length=100,
        )
        payload = first.to_dict()
        payload["expectationRef"] = wrong_ref.to_dict()
        with self.assertRaises(ValueError):
            DurabilityExecutionStartRecord.from_dict(payload)


class ProofAdmissionContractTest(unittest.TestCase):
    def linux_host(
        self,
    ) -> tuple[LinuxRuntimeHostBuild, LinuxRuntimeHostIdentity]:
        host_build = LinuxRuntimeHostBuild.create(
            os_release_file_sha256=SHA_A,
            kernel_release="6.8.0",
            kernel_version="synthetic-linux",
            machine="x86_64",
        )
        return (
            host_build,
            LinuxRuntimeHostIdentity.create(
                host_build=host_build,
                machine_id_hash=SHA_B,
            ),
        )

    def resolution(self) -> AuthoritativeLatestResolution:
        return AuthoritativeLatestResolution.create(
            authority_mode=LatestAuthorityMode.FINALIZER_ENFORCED,
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            interlock_digest=SHA_A,
            generation=1,
            enforcement_digest=SHA_B,
            manifest_ref=artifact_ref("manifest.json", sha256=SHA_C),
            result_tuple=CanonicalResultTuple.PassedDoneProven,
        )

    def linux_epoch_and_termination(
        self,
    ) -> tuple[
        ProofAdmissionEpochRecord,
        LinuxExecutionEnvironmentTermination,
    ]:
        host_build, host_identity = self.linux_host()
        runtime_ref = DurabilityCapabilityArtifactRef.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            crash_fixture_id="synthetic-crash-fixture",
            artifact_name=(
                DurabilityCapabilityArtifactName.PROBE_RUNTIME_MANIFEST
            ),
            object_digest=SHA_A,
            content_sha256=SHA_B,
            byte_length=100,
        )
        boot_helper = KernelEvidenceHelperIdentity.create(
            helper_kind="BOOT_BOUNDARY",
            source_files=(
                ("tooling/acceptance/core/proof_admission.py", SHA_A, 100),
            ),
            runtime_manifest_ref=runtime_ref,
            runtime_digest=SHA_C,
        )
        mount = LiveAuthorityMountBinding.create(
            os_family=RuntimeOsFamily.LINUX,
            stable_volume_identity_digest=SHA_D,
            mount_namespace_id="mnt:[100]",
            mount_id="42",
            darwin_fsid=None,
            device_id="2049",
            host_build=host_build,
            filesystem_implementation_version="ext4-synthetic",
            mount_options=("rw", "sync"),
            observed_at="2026-08-31T12:00:00+00:00",
        )
        prior = LinuxBootBoundaryObservation.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            observation_id="boot-before",
            source_commit="synthetic-source",
            host_identity=host_identity,
            durability_profile_digest=SHA_E,
            live_mount_binding=mount,
            helper_identity=boot_helper,
            boot_id="boot-a",
            boot_time_seconds="100",
            boot_time_nanoseconds="1",
            observed_at="2026-08-31T12:00:01+00:00",
        )
        current = LinuxBootBoundaryObservation.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            observation_id="boot-after",
            source_commit="synthetic-source",
            host_identity=host_identity,
            durability_profile_digest=SHA_E,
            live_mount_binding=mount,
            helper_identity=boot_helper,
            boot_id="boot-b",
            boot_time_seconds="200",
            boot_time_nanoseconds="2",
            observed_at="2026-08-31T12:01:00+00:00",
        )
        attestation = BootBoundaryAttestation.create(
            prior_observation=prior,
            current_observation=current,
        )
        predecessor = LinuxLegacyEnvironmentTermination.create(
            execution_environment_identity=(
                LinuxLegacyClaimEnvironmentIdentity.create(
                    host_identity=host_identity,
                    boot_observation_digest=prior.observation_digest,
                )
            ),
            boot_boundary_attestation=attestation,
            terminated_at="2026-08-31T12:01:01+00:00",
        )
        pidfd_capability = LinuxPidfdWaitCapabilityEvidence.create(
            host_build=host_build,
            host_identity=host_identity,
            probe_child_pid=30,
            probe_child_process_start_identity=(
                LinuxProcessStartIdentity.create(
                    boot_id="boot-b",
                    start_clock_ticks="10",
                )
            ),
            probe_pidfd_lease_id="probe-pidfd",
            pidfd_poll_revents_raw="1",
            wait_id_status=LinuxWaitIdStatus.create(
                si_pid=30,
                si_uid="501",
                si_code=LinuxWaitIdCode.CLD_EXITED,
                si_status=0,
            ),
            post_wait_pidfd_poll_revents_raw="16",
            probed_at="2026-08-31T12:01:02+00:00",
        )
        supervisor_start = LinuxProcessStartIdentity.create(
            boot_id="boot-b",
            start_clock_ticks="20",
        )
        init_start = LinuxProcessStartIdentity.create(
            boot_id="boot-b",
            start_clock_ticks="21",
        )
        environment = LinuxProofAdmissionExecutionEnvironmentIdentity.create(
            host_build=host_build,
            host_identity=host_identity,
            environment_id="linux-epoch-environment",
            supervisor_pid=10,
            supervisor_process_start_identity=supervisor_start,
            epoch_boot_observation_ref=BootBoundaryObservationRef.create(
                os_family=RuntimeOsFamily.LINUX,
                workspace_id=WORKSPACE_ID,
                gate_id=GATE_ID,
                observation_id=current.observation_id,
                observation_digest=current.observation_digest,
            ),
            pid_namespace_device_id="4",
            pid_namespace_inode="5",
            namespace_init_pid=11,
            namespace_init_process_start_identity=init_start,
            namespace_init_pidfd_lease_id="namespace-pidfd",
            pidfd_wait_capability=pidfd_capability,
        )
        epoch = ProofAdmissionEpochRecord.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            coordinator_epoch_id="epoch-1",
            execution_environment_identity=environment,
            coordinator_pid=10,
            coordinator_process_start_identity=supervisor_start,
            source_commit="synthetic-source",
            proof_admission_source_digest=SHA_E,
            claim_admission_lock_identity=(
                ProofAdmissionLockIdentity.create(device_id="1", inode="2")
            ),
            claim_sequence_lock_identity=(
                ProofAdmissionLockIdentity.create(device_id="1", inode="3")
            ),
            previous_epoch_ref=None,
            predecessor_environment_termination=predecessor,
            started_at="2026-08-31T12:01:03+00:00",
        )
        termination_helper = KernelEvidenceHelperIdentity.create(
            helper_kind="LINUX_PID_NAMESPACE_TERMINATION",
            source_files=(
                ("tooling/acceptance/core/proof_admission.py", SHA_A, 100),
            ),
            runtime_manifest_ref=runtime_ref,
            runtime_digest=SHA_C,
        )
        termination = LinuxExecutionEnvironmentTermination.create(
            execution_environment_identity=environment,
            termination_method=(
                ProofAdmissionTerminationMethod
                .PID_NAMESPACE_INIT_TERMINATED
            ),
            namespace_termination_evidence=(
                LinuxPidNamespaceTerminationEvidence.create(
                    helper_identity=termination_helper,
                    pidfd_owner_pid=10,
                    pidfd_owner_process_start_identity=supervisor_start,
                    pid_namespace_device_id="4",
                    pid_namespace_inode="5",
                    namespace_init_pid=11,
                    namespace_init_process_start_identity=init_start,
                    namespace_init_pidfd_lease_id="namespace-pidfd",
                    namespace_init_pidfd_poll_revents_raw="1",
                    namespace_init_wait_status=LinuxWaitIdStatus.create(
                        si_pid=11,
                        si_uid="501",
                        si_code=LinuxWaitIdCode.CLD_KILLED,
                        si_status=9,
                    ),
                    post_wait_pidfd_poll_revents_raw="16",
                    observed_at="2026-08-31T12:02:00+00:00",
                )
            ),
            boot_boundary_attestation=None,
            terminated_at="2026-08-31T12:02:01+00:00",
        )
        return epoch, termination

    def scanner_and_runtime(
        self,
    ) -> tuple[ForbiddenProcessApiScan, ProofAdmissionJobRuntimeIdentity]:
        host_build, host_identity = self.linux_host()
        interpreter = PythonScannerInterpreterIdentity.create(
            host_os_family=RuntimeOsFamily.LINUX,
            host_build=host_build,
            host_identity=host_identity,
            executable_path_hash=SHA_A,
            executable_sha256=SHA_B,
            implementation="CPython",
            version="3.12.6",
            ast_grammar_feature_version="3.12",
            stdlib_digest=SHA_C,
        )
        scan = ForbiddenProcessApiScan.create(
            scanner_source_files=(
                ("tooling/acceptance/core/proof_admission.py", SHA_D, 120),
            ),
            scanner_interpreter=interpreter,
            proof_admission_source_digest=SHA_E,
            inspected_nodes=(
                ("tooling/acceptance/fixtures/claim.py", SHA_A),
            ),
            rule_registry=canonical_forbidden_process_api_registry(),
        )
        runtime = ProofAdmissionJobRuntimeIdentity.create(
            host_os_family=RuntimeOsFamily.LINUX,
            host_build=host_build,
            host_identity=host_identity,
            argv=(
                "/captured/python",
                "tooling/acceptance/fixtures/claim.py",
            ),
            executable_path_hash=SHA_A,
            executable_sha256=SHA_B,
            entrypoint_path="tooling/acceptance/fixtures/claim.py",
            entrypoint_file_sha256=SHA_D,
            entrypoint_source_node_digest=SHA_A,
            interpreter_executable_path_hash=SHA_A,
            interpreter_executable_sha256=SHA_B,
            interpreter_implementation="CPython",
            interpreter_version="3.12.6",
            ast_grammar_feature_version="3.12",
            stdlib_digest=SHA_C,
            forbidden_process_api_scan=scan,
        )
        return scan, runtime

    def completed_job(
        self,
        *,
        resolution: AuthoritativeLatestResolution | None = None,
        job_sequence: int = 1,
        epoch: ProofAdmissionEpochRecord | None = None,
    ) -> tuple[
        ProofAdmissionJobRecord,
        ProofAdmissionJobCompletion,
        ProofAdmissionEpochRecord,
    ]:
        epoch = epoch or self.linux_epoch_and_termination()[0]
        _, runtime = self.scanner_and_runtime()
        environment = epoch.execution_environment_identity
        host_build = environment.host_build
        host_identity = environment.host_identity
        coordinator_start = epoch.coordinator_process_start_identity
        wrapper_start = LinuxProcessStartIdentity.create(
            boot_id=coordinator_start.boot_id,
            start_clock_ticks="101",
        )
        claim_start = LinuxProcessStartIdentity.create(
            boot_id=coordinator_start.boot_id,
            start_clock_ticks="102",
        )
        wrapper = ClaimLeaseWrapperIdentity.create(
            host_os_family=RuntimeOsFamily.LINUX,
            host_build=host_build,
            host_identity=host_identity,
            wrapper_source_files=(
                ("tooling/acceptance/core/proof_admission.py", SHA_A, 100),
            ),
            job_runtime=runtime,
            wrapper_pid=20,
            wrapper_process_start_identity=wrapper_start,
            claim_process_pid=21,
            claim_process_start_identity=claim_start,
        )
        expected_resolution = resolution or self.resolution()
        sink = ProofAdmissionSinkIdentity.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            resolver_identity=ProofAdmissionSinkResolverIdentity.create(
                source_files=(
                    ("tooling/acceptance/core/proof_admission.py", SHA_A, 100),
                )
            ),
            deadline_milliseconds=1000,
        )
        job = ProofAdmissionJobRecord.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            coordinator_epoch_id="epoch-1",
            epoch_digest=epoch.epoch_digest,
            claim_admission_lock_identity=(
                epoch.claim_admission_lock_identity
            ),
            claim_sequence_lock_identity=(
                epoch.claim_sequence_lock_identity
            ),
            job_lease_lock_identity=ProofAdmissionLockIdentity.create(
                device_id="1", inode="4"
            ),
            job_sequence=job_sequence,
            job_id=f"job-{job_sequence}",
            claim_process_pid=21,
            claim_process_group_id=21,
            claim_process_start_identity=claim_start,
            runtime_identity=runtime,
            lease_wrapper_identity=wrapper,
            emitter_input=ClaimEmitterInput.create(
                resolution=expected_resolution
            ),
            expected_resolution=expected_resolution,
            sink_identity=sink,
            source_commit=epoch.source_commit,
            proof_admission_source_digest=(
                epoch.proof_admission_source_digest
            ),
            registered_at="2026-08-31T12:06:00+00:00",
        )
        waits = ClaimLeaseWrapperWaitEvidence.create(
            wrapper_pid=20,
            wrapper_process_start_identity=wrapper_start,
            claim_process_pid=21,
            claim_process_start_identity=claim_start,
            claim_wait_status=ConsumingChildWaitEvidence.create(
                waiter_pid=20,
                waiter_process_start_identity=wrapper_start,
                child_pid=21,
                child_process_start_identity=claim_start,
                returned_pid=21,
                status=PosixWaitStatus.create_exited(0),
                waited_at="2026-08-31T12:06:00.250000+00:00",
            ),
            wrapper_wait_status=ConsumingChildWaitEvidence.create(
                waiter_pid=10,
                waiter_process_start_identity=coordinator_start,
                child_pid=20,
                child_process_start_identity=wrapper_start,
                returned_pid=20,
                status=PosixWaitStatus.create_exited(0),
                waited_at="2026-08-31T12:06:00.250000+00:00",
            ),
        )
        completion = ProofAdmissionJobCompletion.create(
            job=job,
            epoch=epoch,
            terminal_state=ProofAdmissionJobTerminalState.COMPLETED,
            output=ClaimEmitterOutput.create(resolution=expected_resolution),
            wrapper_wait_status=waits,
            process_group_enumeration=(
                ProofAdmissionProcessGroupEnumeration.create(
                    claim_process_group_id=21,
                    claim_process_pid=21,
                    claim_process_start_identity=claim_start,
                    observer_pid=10,
                    observer_process_start_identity=coordinator_start,
                    observed_at="2026-08-31T12:06:00.500000+00:00",
                )
            ),
            completed_at="2026-08-31T12:06:01+00:00",
        )
        early_enumeration = ProofAdmissionProcessGroupEnumeration.create(
            claim_process_group_id=21,
            claim_process_pid=21,
            claim_process_start_identity=claim_start,
            observer_pid=10,
            observer_process_start_identity=coordinator_start,
            observed_at="2026-08-31T11:00:00+00:00",
        )
        with self.assertRaisesRegex(
            ValueError,
            "leaf completion chronology is invalid",
        ):
            ProofAdmissionJobCompletion.create(
                job=job,
                epoch=epoch,
                terminal_state=ProofAdmissionJobTerminalState.COMPLETED,
                output=ClaimEmitterOutput.create(
                    resolution=expected_resolution
                ),
                wrapper_wait_status=waits,
                process_group_enumeration=early_enumeration,
                completed_at="2026-08-31T12:06:01+00:00",
            )
        pre_epoch_job = ProofAdmissionJobRecord.create(
            **{
                **{
                    field.name: getattr(job, field.name)
                    for field in dataclasses.fields(job)
                    if field.name != "job_record_digest"
                },
                "registered_at": "2026-08-31T11:00:00+00:00",
            }
        )
        with self.assertRaisesRegex(
            ValueError,
            "job registration cannot precede epoch start",
        ):
            ProofAdmissionJobCompletion.create(
                job=pre_epoch_job,
                epoch=epoch,
                terminal_state=ProofAdmissionJobTerminalState.COMPLETED,
                output=ClaimEmitterOutput.create(
                    resolution=expected_resolution
                ),
                wrapper_wait_status=waits,
                process_group_enumeration=(
                    ProofAdmissionProcessGroupEnumeration.create(
                        claim_process_group_id=21,
                        claim_process_pid=21,
                        claim_process_start_identity=claim_start,
                        observer_pid=10,
                        observer_process_start_identity=coordinator_start,
                        observed_at="2026-08-31T12:06:00.500000+00:00",
                    )
                ),
                completed_at="2026-08-31T12:06:01+00:00",
            )
        return job, completion, epoch

    def test_source_classifier_node_and_edge_are_closed(self) -> None:
        self.assertEqual(
            classify_proof_admission_source(
                "tooling/acceptance/claim.py",
                executable=False,
            ),
            (
                ProofAdmissionSourceClassification.PARSED_SOURCE,
                ProofAdmissionGrammarId.PYTHON_AST_V1,
                ProofAdmissionInterpreter.PYTHON3,
            ),
        )
        edge = ProofAdmissionSourceEdge.create(
            edge_kind=ProofAdmissionEdgeKind.IMPORT,
            target_path="tooling/acceptance/claim.py",
            assigned_grammar_id=ProofAdmissionGrammarId.PYTHON_AST_V1,
            assigned_interpreter=ProofAdmissionInterpreter.PYTHON3,
        )
        node = ProofAdmissionSourceNode.create(
            repo_relative_path="tooling/acceptance/entry.py",
            raw_file_sha256=SHA_A,
            byte_length=12,
            classification=ProofAdmissionSourceClassification.PARSED_SOURCE,
            grammar_id=ProofAdmissionGrammarId.PYTHON_AST_V1,
            interpreter_assignment=ProofAdmissionInterpreter.PYTHON3,
            forward_edges=(edge,),
        )
        target = ProofAdmissionSourceNode.create(
            repo_relative_path="tooling/acceptance/claim.py",
            raw_file_sha256=SHA_B,
            byte_length=10,
            classification=ProofAdmissionSourceClassification.PARSED_SOURCE,
            grammar_id=ProofAdmissionGrammarId.PYTHON_AST_V1,
            interpreter_assignment=ProofAdmissionInterpreter.PYTHON3,
            forward_edges=(),
        )
        self.assertEqual(ProofAdmissionSourceNode.from_dict(node.to_dict()), node)
        self.assertRegex(
            proof_admission_source_digest((target, node)),
            r"^[0-9a-f]{64}$",
        )
        payload = node.to_dict()
        payload["sourceNodeDigest"] = SHA_B
        with self.assertRaises(ValueError):
            ProofAdmissionSourceNode.from_dict(payload)
        with self.assertRaises(ValueError):
            classify_proof_admission_source(
                "tooling/acceptance/entry.py",
                executable=False,
                incoming_assignment=(
                    ProofAdmissionGrammarId.POSIX_SHELL_V1,
                    ProofAdmissionInterpreter.POSIX_SH,
                ),
            )
        class EdgeSubclass(ProofAdmissionSourceEdge):
            pass

        edge_subclass = EdgeSubclass(
            **{
                field.name: getattr(edge, field.name)
                for field in dataclasses.fields(edge)
            }
        )
        with self.assertRaisesRegex(
            ValueError,
            "source node inputs must use concrete contract types",
        ):
            ProofAdmissionSourceNode.create(
                repo_relative_path="tooling/acceptance/entry.py",
                raw_file_sha256=SHA_A,
                byte_length=12,
                classification=(
                    ProofAdmissionSourceClassification.PARSED_SOURCE
                ),
                grammar_id=ProofAdmissionGrammarId.PYTHON_AST_V1,
                interpreter_assignment=ProofAdmissionInterpreter.PYTHON3,
                forward_edges=(edge_subclass,),
            )

        class NodeSubclass(ProofAdmissionSourceNode):
            pass

        node_subclass = NodeSubclass(
            **{
                field.name: getattr(node, field.name)
                for field in dataclasses.fields(node)
            }
        )
        with self.assertRaisesRegex(
            ValueError,
            "inventory must contain typed nodes",
        ):
            proof_admission_source_digest((target, node_subclass))

    def test_wait_pidfd_scan_and_job_runtime_round_trip(self) -> None:
        scan, runtime = self.scanner_and_runtime()
        self.assertEqual(ForbiddenProcessApiScan.from_dict(scan.to_dict()), scan)
        self.assertEqual(
            ProofAdmissionJobRuntimeIdentity.from_dict(runtime.to_dict()),
            runtime,
        )
        process = LinuxProcessStartIdentity.create(
            boot_id="synthetic-boot",
            start_clock_ticks="100",
        )
        wait = ConsumingChildWaitEvidence.create(
            waiter_pid=10,
            waiter_process_start_identity=process,
            child_pid=11,
            child_process_start_identity=LinuxProcessStartIdentity.create(
                boot_id="synthetic-boot",
                start_clock_ticks="101",
            ),
            returned_pid=11,
            status=PosixWaitStatus.create_exited(0),
            waited_at="2026-08-31T12:06:00.250000+00:00",
        )
        self.assertEqual(ConsumingChildWaitEvidence.from_dict(wait.to_dict()), wait)
        status = LinuxWaitIdStatus.create(
            si_pid=12,
            si_uid="501",
            si_code=LinuxWaitIdCode.CLD_EXITED,
            si_status=0,
        )
        host_build, host_identity = self.linux_host()
        capability = LinuxPidfdWaitCapabilityEvidence.create(
            host_build=host_build,
            host_identity=host_identity,
            probe_child_pid=12,
            probe_child_process_start_identity=LinuxProcessStartIdentity.create(
                boot_id="synthetic-boot",
                start_clock_ticks="102",
            ),
            probe_pidfd_lease_id="synthetic-pidfd-lease",
            pidfd_poll_revents_raw="1",
            wait_id_status=status,
            post_wait_pidfd_poll_revents_raw="16",
            probed_at="2026-08-31T12:03:00+00:00",
        )
        self.assertEqual(
            LinuxPidfdWaitCapabilityEvidence.from_dict(capability.to_dict()),
            capability,
        )
        payload = capability.to_dict()
        payload["pidfdPollHupBeforeWait"] = True
        with self.assertRaises(ValueError):
            LinuxPidfdWaitCapabilityEvidence.from_dict(payload)

    def test_claim_sink_emission_and_quiescence_close_identity(self) -> None:
        resolution = self.resolution()
        class ArtifactRefSubclass(ArtifactRef):
            def to_dict(self) -> dict[str, object]:
                return {
                    **super().to_dict(),
                    "path": "substituted.json",
                }

        manifest_ref = artifact_ref("manifest.json", sha256=SHA_C)
        manifest_ref_subclass = ArtifactRefSubclass(
            **{
                field.name: getattr(manifest_ref, field.name)
                for field in dataclasses.fields(manifest_ref)
            }
        )
        with self.assertRaisesRegex(
            ValueError,
            "resolution inputs must use concrete contract types",
        ):
            AuthoritativeLatestResolution.create(
                authority_mode=LatestAuthorityMode.FINALIZER_ENFORCED,
                workspace_id=WORKSPACE_ID,
                gate_id=GATE_ID,
                interlock_digest=SHA_A,
                generation=1,
                enforcement_digest=SHA_B,
                manifest_ref=manifest_ref_subclass,
                result_tuple=CanonicalResultTuple.PassedDoneProven,
            )
        claim_input = ClaimEmitterInput.create(resolution=resolution)
        claim_output = ClaimEmitterOutput.create(resolution=resolution)
        self.assertEqual(ClaimEmitterInput.from_dict(claim_input.to_dict()), claim_input)
        self.assertEqual(ClaimEmitterOutput.from_dict(claim_output.to_dict()), claim_output)
        job, completion, epoch = self.completed_job(resolution=resolution)
        sink = job.sink_identity
        class ResolverSubclass(ProofAdmissionSinkResolverIdentity):
            pass

        resolver_subclass = ResolverSubclass(
            **{
                field.name: getattr(sink.resolver_identity, field.name)
                for field in dataclasses.fields(sink.resolver_identity)
            }
        )
        with self.assertRaisesRegex(
            ValueError,
            "resolverIdentity must be typed",
        ):
            ProofAdmissionSinkIdentity.create(
                workspace_id=WORKSPACE_ID,
                gate_id=GATE_ID,
                resolver_identity=resolver_subclass,
                deadline_milliseconds=1000,
            )
        intent = ProofAdmissionEmissionIntent.create(
            job=job,
            completion=completion,
            epoch=epoch,
            created_at="2026-08-31T12:06:02+00:00",
        )
        with self.assertRaisesRegex(
            ValueError,
            "cannot precede completion",
        ):
            ProofAdmissionEmissionIntent.create(
                job=job,
                completion=completion,
                epoch=epoch,
                created_at="2026-08-31T12:06:00+00:00",
            )
        self.assertEqual(
            ProofAdmissionEmissionIntent.from_dict(
                intent.to_dict(),
                job=job,
                completion=completion,
                epoch=epoch,
            ),
            intent,
        )
        class JobSubclass(ProofAdmissionJobRecord):
            pass

        class CompletionSubclass(ProofAdmissionJobCompletion):
            pass

        job_subclass = JobSubclass(
            **{
                field.name: getattr(job, field.name)
                for field in dataclasses.fields(job)
            }
        )
        completion_subclass = CompletionSubclass(
            **{
                field.name: getattr(completion, field.name)
                for field in dataclasses.fields(completion)
            }
        )
        for candidate_job, candidate_completion in (
            (object(), completion),
            (job, object()),
            (job_subclass, completion),
            (job, completion_subclass),
        ):
            with (
                self.subTest(
                    candidate_job=type(candidate_job).__name__,
                    candidate_completion=type(candidate_completion).__name__,
                ),
                self.assertRaisesRegex(
                    ValueError,
                    "emission intent requires typed job, completion, and "
                    "epoch references",
                ),
            ):
                ProofAdmissionEmissionIntent.create(
                    job=candidate_job,
                    completion=candidate_completion,
                    epoch=epoch,
                    created_at="2026-08-31T12:06:02+00:00",
                )
            with self.assertRaisesRegex(
                ValueError,
                "emission intent requires typed job, completion, and "
                "epoch references",
            ):
                ProofAdmissionEmissionIntent.from_dict(
                    intent.to_dict(),
                    job=candidate_job,
                    completion=candidate_completion,
                    epoch=epoch,
                )
        foreign_job, foreign_completion, foreign_epoch = self.completed_job(
            resolution=resolution,
            job_sequence=2,
        )
        with self.assertRaisesRegex(
            ValueError,
            "does not close over",
        ):
            ProofAdmissionEmissionIntent.create(
                job=job,
                completion=foreign_completion,
                epoch=epoch,
                created_at="2026-08-31T12:06:02+00:00",
            )
        with self.assertRaisesRegex(
            ValueError,
            "emission intent references do not close over job and completion",
        ):
            ProofAdmissionEmissionIntent.from_dict(
                intent.to_dict(),
                job=foreign_job,
                completion=foreign_completion,
                epoch=foreign_epoch,
            )
        receipt = IdempotentClaimSinkReceipt.create(
            sink_id=sink.sink_id,
            idempotency_key=intent.idempotency_key,
            accepted_payload_sha256=intent.payload_sha256,
            accepted_at="2026-08-31T12:06:03+00:00",
        )
        acknowledgement = ProofAdmissionEmissionAcknowledgement.create(
            intent=intent,
            sink_receipt=receipt,
            acknowledged_at="2026-08-31T12:06:04+00:00",
        )
        self.assertEqual(
            ProofAdmissionEmissionAcknowledgement.from_dict(
                acknowledgement.to_dict(),
                intent=intent,
            ),
            acknowledgement,
        )
        forged_acknowledgement = acknowledgement.to_dict()
        forged_acknowledgement["emissionIntentDigest"] = SHA_A
        forged_acknowledgement["idempotencyKey"] = SHA_B
        forged_acknowledgement["acceptedPayloadSha256"] = SHA_C
        forged_acknowledgement["sinkReceipt"] = (
            IdempotentClaimSinkReceipt.create(
                sink_id=sink.sink_id,
                idempotency_key=SHA_B,
                accepted_payload_sha256=SHA_C,
                accepted_at="2026-08-31T12:06:03+00:00",
            ).to_dict()
        )
        forged_acknowledgement["emissionAcknowledgementDigest"] = (
            domain_separated_sha256(
                "pt.acceptance.finalization."
                "proof-admission-emission-acknowledgement.v1",
                {
                    key: value
                    for key, value in forged_acknowledgement.items()
                    if key != "emissionAcknowledgementDigest"
                },
            )
        )
        with self.assertRaisesRegex(
            ValueError,
            "does not close over the exact intent",
        ):
            ProofAdmissionEmissionAcknowledgement.from_dict(
                forged_acknowledgement,
                intent=intent,
            )
        class IntentSubclass(ProofAdmissionEmissionIntent):
            pass

        class ReceiptSubclass(IdempotentClaimSinkReceipt):
            pass

        intent_subclass = IntentSubclass(
            **{
                field.name: getattr(intent, field.name)
                for field in dataclasses.fields(intent)
            }
        )
        receipt_subclass = ReceiptSubclass(
            **{
                field.name: getattr(receipt, field.name)
                for field in dataclasses.fields(receipt)
            }
        )
        for candidate_intent, candidate_receipt in (
            (object(), receipt),
            (intent, object()),
            (intent_subclass, receipt),
            (intent, receipt_subclass),
        ):
            with (
                self.subTest(
                    candidate_intent=type(candidate_intent).__name__,
                    candidate_receipt=type(candidate_receipt).__name__,
                ),
                self.assertRaisesRegex(
                    ValueError,
                    "acknowledgement requires concrete intent and receipt",
                ),
            ):
                ProofAdmissionEmissionAcknowledgement.create(
                    intent=candidate_intent,
                    sink_receipt=candidate_receipt,
                    acknowledged_at="2026-08-31T12:04:02+00:00",
                )
        early_receipt = IdempotentClaimSinkReceipt.create(
            sink_id=sink.sink_id,
            idempotency_key=intent.idempotency_key,
            accepted_payload_sha256=intent.payload_sha256,
            accepted_at="2026-08-31T12:06:01+00:00",
        )
        with self.assertRaisesRegex(
            ValueError,
            "receipt does not acknowledge the exact intent",
        ):
            ProofAdmissionEmissionAcknowledgement.create(
                intent=intent,
                sink_receipt=early_receipt,
                acknowledged_at="2026-08-31T12:06:04+00:00",
            )
        with self.assertRaisesRegex(
            ValueError,
            "sink receipt must precede acknowledgement",
        ):
            ProofAdmissionEmissionAcknowledgement.create(
                intent=intent,
                sink_receipt=receipt,
                acknowledged_at="2026-08-31T12:06:02+00:00",
            )
        with self.assertRaisesRegex(
            ValueError,
            "acceptedAt must be a canonical UTC timestamp",
        ):
            IdempotentClaimSinkReceipt.create(
                sink_id=sink.sink_id,
                idempotency_key=intent.idempotency_key,
                accepted_payload_sha256=intent.payload_sha256,
                accepted_at="2026-08-31T13:04:01+01:00",
            )
        lock_a = ProofAdmissionLockIdentity.create(device_id="1", inode="2")
        lock_b = ProofAdmissionLockIdentity.create(device_id="1", inode="3")
        pause = ProofAdmissionPauseRecord.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            coordinator_epoch_id="epoch-1",
            epoch_digest=epoch.epoch_digest,
            claim_admission_lock_identity=lock_a,
            claim_sequence_lock_identity=lock_b,
            last_accepted_job_sequence=1,
            paused_at="2026-08-31T12:07:00+00:00",
        )
        current_epoch = ProofAdmissionCurrentEpoch.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            coordinator_epoch_id="epoch-1",
            epoch_digest=epoch.epoch_digest,
        )
        quiescence = ProofAdmissionQuiescence.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            coordinator_epoch_id="epoch-1",
            epoch_digest=epoch.epoch_digest,
            current_epoch_digest=current_epoch.current_epoch_digest,
            source_commit="synthetic-source",
            proof_admission_source_digest=SHA_E,
            claim_admission_lock_identity=lock_a,
            claim_sequence_lock_identity=lock_b,
            pause_digest=pause.pause_digest,
            registered_jobs=((1, job.job_record_digest),),
            terminal_job_completions=((1, completion.completion_digest),),
            acknowledged_emissions=((1, acknowledgement.emission_acknowledgement_digest),),
            captured_at="2026-08-31T12:08:00+00:00",
            epoch=epoch,
            current_epoch=current_epoch,
            pause=pause,
            jobs=(job,),
            completions=(completion,),
            intents=(intent,),
            acknowledgements=(acknowledgement,),
        )
        early_pause = ProofAdmissionPauseRecord.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            coordinator_epoch_id="epoch-1",
            epoch_digest=epoch.epoch_digest,
            claim_admission_lock_identity=lock_a,
            claim_sequence_lock_identity=lock_b,
            last_accepted_job_sequence=1,
            paused_at="2026-08-31T12:01:00+00:00",
        )
        with self.assertRaisesRegex(
            ValueError,
            "epoch, current, or pause reference",
        ):
            ProofAdmissionQuiescence.create(
                workspace_id=WORKSPACE_ID,
                gate_id=GATE_ID,
                coordinator_epoch_id="epoch-1",
                epoch_digest=epoch.epoch_digest,
                current_epoch_digest=current_epoch.current_epoch_digest,
                source_commit="synthetic-source",
                proof_admission_source_digest=SHA_E,
                claim_admission_lock_identity=lock_a,
                claim_sequence_lock_identity=lock_b,
                pause_digest=early_pause.pause_digest,
                registered_jobs=((1, job.job_record_digest),),
                terminal_job_completions=(
                    (1, completion.completion_digest),
                ),
                acknowledged_emissions=(
                    (1, acknowledgement.emission_acknowledgement_digest),
                ),
                captured_at="2026-08-31T12:08:00+00:00",
                epoch=epoch,
                current_epoch=current_epoch,
                pause=early_pause,
                jobs=(job,),
                completions=(completion,),
                intents=(intent,),
                acknowledgements=(acknowledgement,),
            )
        self.assertEqual(
            ProofAdmissionQuiescence.from_dict(
                quiescence.to_dict(),
                epoch=epoch,
                current_epoch=current_epoch,
                pause=pause,
                jobs=(job,),
                completions=(completion,),
                intents=(intent,),
                acknowledgements=(acknowledgement,),
            ),
            quiescence,
        )
        foreign_current = ProofAdmissionCurrentEpoch.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            coordinator_epoch_id="epoch-1",
            epoch_digest=SHA_A,
        )
        with self.assertRaisesRegex(
            ValueError,
            "epoch, current, or pause reference",
        ):
            ProofAdmissionQuiescence.from_dict(
                {
                    **quiescence.to_dict(),
                    "currentEpochDigest":
                        foreign_current.current_epoch_digest,
                    "quiescenceDigest": domain_separated_sha256(
                        "pt.acceptance.finalization."
                        "proof-admission-quiescence.v1",
                        {
                            **quiescence._digest_payload(),
                            "currentEpochDigest":
                                foreign_current.current_epoch_digest,
                        },
                    ),
                },
                epoch=epoch,
                current_epoch=foreign_current,
                pause=pause,
                jobs=(job,),
                completions=(completion,),
                intents=(intent,),
                acknowledgements=(acknowledgement,),
            )
        with self.assertRaisesRegex(
            ValueError,
            "acknowledgement cardinality",
        ):
            ProofAdmissionQuiescence.create(
                workspace_id=WORKSPACE_ID,
                gate_id=GATE_ID,
                coordinator_epoch_id="epoch-1",
                epoch_digest=epoch.epoch_digest,
                current_epoch_digest=current_epoch.current_epoch_digest,
                source_commit="synthetic-source",
                proof_admission_source_digest=SHA_E,
                claim_admission_lock_identity=lock_a,
                claim_sequence_lock_identity=lock_b,
                pause_digest=pause.pause_digest,
                registered_jobs=((1, job.job_record_digest),),
                terminal_job_completions=(
                    (1, completion.completion_digest),
                ),
                acknowledged_emissions=(),
                captured_at="2026-08-31T12:08:00+00:00",
                epoch=epoch,
                current_epoch=current_epoch,
                pause=pause,
                jobs=(job,),
                completions=(completion,),
                intents=(),
                acknowledgements=(),
            )
        with self.assertRaisesRegex(
            ValueError,
            "concrete job, completion, and acknowledgement references",
        ):
            ProofAdmissionQuiescence.from_dict(
                quiescence.to_dict(),
                epoch=epoch,
                current_epoch=current_epoch,
                pause=pause,
                jobs=(object(),),
                completions=(completion,),
                intents=(intent,),
                acknowledgements=(acknowledgement,),
            )
        payload = quiescence.to_dict()
        payload["activeJobs"] = [1]
        with self.assertRaises(ValueError):
            ProofAdmissionQuiescence.from_dict(
                payload,
                epoch=epoch,
                current_epoch=current_epoch,
                pause=pause,
                jobs=(job,),
                completions=(completion,),
                intents=(intent,),
                acknowledgements=(acknowledgement,),
            )

    def test_job_and_leaf_completion_close_runtime_wait_and_authority(self) -> None:
        epoch, _ = self.linux_epoch_and_termination()
        _, runtime = self.scanner_and_runtime()
        environment = epoch.execution_environment_identity
        host_build = environment.host_build
        host_identity = environment.host_identity
        coordinator_start = epoch.coordinator_process_start_identity
        wrapper_start = LinuxProcessStartIdentity.create(
            boot_id=coordinator_start.boot_id,
            start_clock_ticks="101",
        )
        claim_start = LinuxProcessStartIdentity.create(
            boot_id=coordinator_start.boot_id,
            start_clock_ticks="102",
        )
        wrapper = ClaimLeaseWrapperIdentity.create(
            host_os_family=RuntimeOsFamily.LINUX,
            host_build=host_build,
            host_identity=host_identity,
            wrapper_source_files=(
                ("tooling/acceptance/core/proof_admission.py", SHA_A, 100),
            ),
            job_runtime=runtime,
            wrapper_pid=20,
            wrapper_process_start_identity=wrapper_start,
            claim_process_pid=21,
            claim_process_start_identity=claim_start,
        )
        resolution = self.resolution()
        resolver = ProofAdmissionSinkResolverIdentity.create(
            source_files=(
                ("tooling/acceptance/core/proof_admission.py", SHA_A, 100),
            )
        )
        sink = ProofAdmissionSinkIdentity.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            resolver_identity=resolver,
            deadline_milliseconds=1000,
        )
        lock_a = epoch.claim_admission_lock_identity
        lock_b = epoch.claim_sequence_lock_identity
        lock_c = ProofAdmissionLockIdentity.create(device_id="1", inode="4")
        job_values = {
            "workspace_id": WORKSPACE_ID,
            "gate_id": GATE_ID,
            "coordinator_epoch_id": "epoch-1",
            "epoch_digest": epoch.epoch_digest,
            "claim_admission_lock_identity": lock_a,
            "claim_sequence_lock_identity": lock_b,
            "job_lease_lock_identity": lock_c,
            "job_sequence": 1,
            "job_id": "job-1",
            "claim_process_pid": 21,
            "claim_process_group_id": 21,
            "claim_process_start_identity": claim_start,
            "runtime_identity": runtime,
            "lease_wrapper_identity": wrapper,
            "emitter_input": ClaimEmitterInput.create(resolution=resolution),
            "expected_resolution": resolution,
            "sink_identity": sink,
            "source_commit": "synthetic-source",
            "proof_admission_source_digest": SHA_E,
            "registered_at": "2026-08-31T12:06:00+00:00",
        }
        job = ProofAdmissionJobRecord.create(**job_values)

        class PoisonedReference:
            def __getattribute__(self, name: str) -> object:
                raise RuntimeError(f"poisoned property accessed: {name}")

        class ResolutionSubclass(AuthoritativeLatestResolution):
            pass

        class SinkSubclass(ProofAdmissionSinkIdentity):
            pass

        resolution_subclass = object.__new__(ResolutionSubclass)
        sink_subclass = object.__new__(SinkSubclass)
        for constructor in (
            ClaimEmitterInput.create,
            ClaimEmitterOutput.create,
        ):
            with self.assertRaisesRegex(
                ValueError,
                "resolution must be AuthoritativeLatestResolution",
            ):
                constructor(resolution=resolution_subclass)
        for field, invalid_value in (
            ("expected_resolution", PoisonedReference()),
            ("sink_identity", PoisonedReference()),
            ("expected_resolution", resolution_subclass),
            ("sink_identity", sink_subclass),
        ):
            with (
                self.subTest(field=field, value=type(invalid_value).__name__),
                self.assertRaisesRegex(
                    ValueError,
                    "job structured inputs must use concrete contract types",
                ),
            ):
                ProofAdmissionJobRecord.create(
                    **{**job_values, field: invalid_value}
                )
        for foreign_workspace_id, foreign_gate_id in (
            ("fedcba9876543210", GATE_ID),
            (WORKSPACE_ID, "foreign-gate"),
        ):
            foreign_ref = ArtifactRef(
                workspace_id=foreign_workspace_id,
                gate_id=foreign_gate_id,
                run_id=RUN_ID,
                path="manifest.json",
                sha256=SHA_C,
                media_type="application/json",
            )
            foreign_resolution = AuthoritativeLatestResolution.create(
                authority_mode=LatestAuthorityMode.FINALIZER_ENFORCED,
                workspace_id=foreign_workspace_id,
                gate_id=foreign_gate_id,
                interlock_digest=SHA_A,
                generation=1,
                enforcement_digest=SHA_B,
                manifest_ref=foreign_ref,
                result_tuple=CanonicalResultTuple.PassedDoneProven,
            )
            with (
                self.subTest(
                    workspace_id=foreign_workspace_id,
                    gate_id=foreign_gate_id,
                ),
                self.assertRaisesRegex(
                    ValueError,
                    "job authority input or sink identity does not close",
                ),
            ):
                ProofAdmissionJobRecord.create(
                    workspace_id=WORKSPACE_ID,
                    gate_id=GATE_ID,
                    coordinator_epoch_id="epoch-1",
                    epoch_digest=SHA_C,
                    claim_admission_lock_identity=lock_a,
                    claim_sequence_lock_identity=lock_b,
                    job_lease_lock_identity=lock_c,
                    job_sequence=1,
                    job_id="job-1",
                    claim_process_pid=21,
                    claim_process_group_id=21,
                    claim_process_start_identity=claim_start,
                    runtime_identity=runtime,
                    lease_wrapper_identity=wrapper,
                    emitter_input=ClaimEmitterInput.create(
                        resolution=foreign_resolution,
                    ),
                    expected_resolution=foreign_resolution,
                    sink_identity=sink,
                    source_commit="synthetic-source",
                    proof_admission_source_digest=SHA_E,
                    registered_at="2026-08-31T12:06:00+00:00",
                )
        claim_wait = ConsumingChildWaitEvidence.create(
            waiter_pid=20,
            waiter_process_start_identity=wrapper_start,
            child_pid=21,
            child_process_start_identity=claim_start,
            returned_pid=21,
            status=PosixWaitStatus.create_exited(0),
            waited_at="2026-08-31T12:06:00.250000+00:00",
        )
        wrapper_wait = ConsumingChildWaitEvidence.create(
            waiter_pid=10,
            waiter_process_start_identity=coordinator_start,
            child_pid=20,
            child_process_start_identity=wrapper_start,
            returned_pid=20,
            status=PosixWaitStatus.create_exited(0),
            waited_at="2026-08-31T12:06:00.250000+00:00",
        )
        waits = ClaimLeaseWrapperWaitEvidence.create(
            wrapper_pid=20,
            wrapper_process_start_identity=wrapper_start,
            claim_process_pid=21,
            claim_process_start_identity=claim_start,
            claim_wait_status=claim_wait,
            wrapper_wait_status=wrapper_wait,
        )
        group_enumeration = ProofAdmissionProcessGroupEnumeration.create(
            claim_process_group_id=21,
            claim_process_pid=21,
            claim_process_start_identity=claim_start,
            observer_pid=10,
            observer_process_start_identity=coordinator_start,
            observed_at="2026-08-31T12:06:00.500000+00:00",
        )
        self.assertEqual(
            ProofAdmissionProcessGroupEnumeration.from_dict(
                group_enumeration.to_dict()
            ),
            group_enumeration,
        )
        completion = ProofAdmissionJobCompletion.create(
            job=job,
            epoch=epoch,
            terminal_state=ProofAdmissionJobTerminalState.COMPLETED,
            output=ClaimEmitterOutput.create(resolution=resolution),
            wrapper_wait_status=waits,
            process_group_enumeration=group_enumeration,
            completed_at="2026-08-31T12:06:01+00:00",
        )
        cancelled_waits = ClaimLeaseWrapperWaitEvidence.create(
            wrapper_pid=20,
            wrapper_process_start_identity=wrapper_start,
            claim_process_pid=21,
            claim_process_start_identity=claim_start,
            claim_wait_status=ConsumingChildWaitEvidence.create(
                waiter_pid=20,
                waiter_process_start_identity=wrapper_start,
                child_pid=21,
                child_process_start_identity=claim_start,
                returned_pid=21,
                status=PosixWaitStatus.create_exited(1),
                waited_at="2026-08-31T12:06:00.250000+00:00",
            ),
            wrapper_wait_status=wrapper_wait,
        )
        cancelled = ProofAdmissionJobCompletion.create(
            job=job,
            epoch=epoch,
            terminal_state=ProofAdmissionJobTerminalState.CANCELLED,
            output=None,
            wrapper_wait_status=cancelled_waits,
            process_group_enumeration=group_enumeration,
            completed_at="2026-08-31T12:06:01+00:00",
        )
        self.assertEqual(
            ProofAdmissionJobCompletion.from_dict(
                cancelled.to_dict(),
                job=job,
                epoch=epoch,
            ),
            cancelled,
        )
        completed_intent = ProofAdmissionEmissionIntent.create(
            job=job,
            completion=completion,
            epoch=epoch,
            created_at="2026-08-31T12:06:02+00:00",
        )
        completed_receipt = IdempotentClaimSinkReceipt.create(
            sink_id=job.sink_identity.sink_id,
            idempotency_key=completed_intent.idempotency_key,
            accepted_payload_sha256=completed_intent.payload_sha256,
            accepted_at="2026-08-31T12:06:03+00:00",
        )
        completed_acknowledgement = (
            ProofAdmissionEmissionAcknowledgement.create(
                intent=completed_intent,
                sink_receipt=completed_receipt,
                acknowledged_at="2026-08-31T12:06:04+00:00",
            )
        )
        current_epoch = ProofAdmissionCurrentEpoch.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            coordinator_epoch_id="epoch-1",
            epoch_digest=epoch.epoch_digest,
        )
        pause = ProofAdmissionPauseRecord.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            coordinator_epoch_id="epoch-1",
            epoch_digest=epoch.epoch_digest,
            claim_admission_lock_identity=lock_a,
            claim_sequence_lock_identity=lock_b,
            last_accepted_job_sequence=1,
            paused_at="2026-08-31T12:06:30+00:00",
        )
        with self.assertRaisesRegex(
            ValueError,
            "acknowledgement cardinality",
        ):
            ProofAdmissionQuiescence.create(
                workspace_id=WORKSPACE_ID,
                gate_id=GATE_ID,
                coordinator_epoch_id="epoch-1",
                epoch_digest=epoch.epoch_digest,
                current_epoch_digest=current_epoch.current_epoch_digest,
                source_commit="synthetic-source",
                proof_admission_source_digest=SHA_E,
                claim_admission_lock_identity=lock_a,
                claim_sequence_lock_identity=lock_b,
                pause_digest=pause.pause_digest,
                registered_jobs=((1, job.job_record_digest),),
                terminal_job_completions=(
                    (1, cancelled.completion_digest),
                ),
                acknowledged_emissions=(
                    (
                        1,
                        completed_acknowledgement
                        .emission_acknowledgement_digest,
                    ),
                ),
                captured_at="2026-08-31T12:07:00+00:00",
                epoch=epoch,
                current_epoch=current_epoch,
                pause=pause,
                jobs=(job,),
                completions=(cancelled,),
                intents=(completed_intent,),
                acknowledgements=(completed_acknowledgement,),
            )
        foreign_observer = ProofAdmissionProcessGroupEnumeration.create(
            claim_process_group_id=21,
            claim_process_pid=21,
            claim_process_start_identity=claim_start,
            observer_pid=999,
            observer_process_start_identity=coordinator_start,
            observed_at="2026-08-31T12:06:00.500000+00:00",
        )
        with self.assertRaisesRegex(
            ValueError,
            "does not match waits and group enumeration",
        ):
            ProofAdmissionJobCompletion.create(
                job=job,
                epoch=epoch,
                terminal_state=ProofAdmissionJobTerminalState.COMPLETED,
                output=ClaimEmitterOutput.create(resolution=resolution),
                wrapper_wait_status=waits,
                process_group_enumeration=foreign_observer,
                completed_at="2026-08-31T12:06:01+00:00",
            )
        late_enumeration = ProofAdmissionProcessGroupEnumeration.create(
            claim_process_group_id=21,
            claim_process_pid=21,
            claim_process_start_identity=claim_start,
            observer_pid=10,
            observer_process_start_identity=coordinator_start,
            observed_at="2026-08-31T13:00:00+00:00",
        )
        with self.assertRaisesRegex(
            ValueError,
            "enumeration cannot follow completion",
        ):
            ProofAdmissionJobCompletion.create(
                job=job,
                epoch=epoch,
                terminal_state=ProofAdmissionJobTerminalState.COMPLETED,
                output=ClaimEmitterOutput.create(resolution=resolution),
                wrapper_wait_status=waits,
                process_group_enumeration=late_enumeration,
                completed_at="2026-08-31T12:06:01+00:00",
            )
        foreign_coordinator_start = LinuxProcessStartIdentity.create(
            boot_id=coordinator_start.boot_id,
            start_clock_ticks="999",
        )
        foreign_coordinator_waits = ClaimLeaseWrapperWaitEvidence.create(
            wrapper_pid=20,
            wrapper_process_start_identity=wrapper_start,
            claim_process_pid=21,
            claim_process_start_identity=claim_start,
            claim_wait_status=claim_wait,
            wrapper_wait_status=ConsumingChildWaitEvidence.create(
                waiter_pid=999,
                waiter_process_start_identity=foreign_coordinator_start,
                child_pid=20,
                child_process_start_identity=wrapper_start,
                returned_pid=20,
                status=PosixWaitStatus.create_exited(0),
                waited_at="2026-08-31T12:06:00.250000+00:00",
            ),
        )
        foreign_coordinator_enumeration = (
            ProofAdmissionProcessGroupEnumeration.create(
                claim_process_group_id=21,
                claim_process_pid=21,
                claim_process_start_identity=claim_start,
                observer_pid=999,
                observer_process_start_identity=foreign_coordinator_start,
                observed_at="2026-08-31T12:06:00.500000+00:00",
            )
        )
        with self.assertRaisesRegex(
            ValueError,
            "does not close over the referenced job and epoch",
        ):
            ProofAdmissionJobCompletion.create(
                job=job,
                epoch=epoch,
                terminal_state=ProofAdmissionJobTerminalState.COMPLETED,
                output=ClaimEmitterOutput.create(resolution=resolution),
                wrapper_wait_status=foreign_coordinator_waits,
                process_group_enumeration=(
                    foreign_coordinator_enumeration
                ),
                completed_at="2026-08-31T12:06:01+00:00",
            )
        substituted_wrapper_start = LinuxProcessStartIdentity.create(
            boot_id="foreign-boot",
            start_clock_ticks="999999",
        )
        substituted_waits = ClaimLeaseWrapperWaitEvidence.create(
            wrapper_pid=222,
            wrapper_process_start_identity=substituted_wrapper_start,
            claim_process_pid=21,
            claim_process_start_identity=claim_start,
            claim_wait_status=ConsumingChildWaitEvidence.create(
                waiter_pid=222,
                waiter_process_start_identity=substituted_wrapper_start,
                child_pid=21,
                child_process_start_identity=claim_start,
                returned_pid=21,
                status=PosixWaitStatus.create_exited(0),
                waited_at="2026-08-31T12:06:00.250000+00:00",
            ),
            wrapper_wait_status=ConsumingChildWaitEvidence.create(
                waiter_pid=10,
                waiter_process_start_identity=coordinator_start,
                child_pid=222,
                child_process_start_identity=substituted_wrapper_start,
                returned_pid=222,
                status=PosixWaitStatus.create_exited(0),
                waited_at="2026-08-31T12:06:00.250000+00:00",
            ),
        )
        with self.assertRaisesRegex(
            ValueError,
            "completion does not close over the referenced job",
        ):
            ProofAdmissionJobCompletion.create(
                job=job,
                epoch=epoch,
                terminal_state=ProofAdmissionJobTerminalState.COMPLETED,
                output=ClaimEmitterOutput.create(resolution=resolution),
                wrapper_wait_status=substituted_waits,
                process_group_enumeration=group_enumeration,
                completed_at="2026-08-31T12:06:01+00:00",
            )
        self.assertEqual(ProofAdmissionJobRecord.from_dict(job.to_dict()), job)
        self.assertEqual(
            ProofAdmissionJobCompletion.from_dict(
                completion.to_dict(),
                job=job,
                epoch=epoch,
            ),
            completion,
        )
        class JobSubclass(ProofAdmissionJobRecord):
            pass

        job_subclass = JobSubclass(
            **{
                field.name: getattr(job, field.name)
                for field in dataclasses.fields(job)
            }
        )
        with self.assertRaisesRegex(
            ValueError,
            "completion requires typed job and epoch references",
        ):
            ProofAdmissionJobCompletion.from_dict(
                completion.to_dict(),
                job=object(),
                epoch=epoch,
            )
        with self.assertRaisesRegex(
            ValueError,
            "completion requires typed job and epoch references",
        ):
            ProofAdmissionJobCompletion.from_dict(
                completion.to_dict(),
                job=job_subclass,
                epoch=epoch,
            )
        with self.assertRaisesRegex(
            ValueError,
            "completion requires typed job and epoch references",
        ):
            ProofAdmissionJobCompletion.create(
                job=object(),
                epoch=epoch,
                terminal_state=ProofAdmissionJobTerminalState.COMPLETED,
                output=ClaimEmitterOutput.create(resolution=resolution),
                wrapper_wait_status=waits,
                process_group_enumeration=group_enumeration,
                completed_at="2026-08-31T12:06:01+00:00",
            )
        with self.assertRaisesRegex(
            ValueError,
            "completion requires a typed job reference",
        ):
            ProofAdmissionJobCompletion.create_reaped(
                job=object(),
                epoch=object(),
                pause=object(),
                execution_environment_termination=object(),
                orphan_recovery_evidence=object(),
                completed_at="2026-08-31T12:06:01+00:00",
            )
        payload = completion.to_dict()
        payload["output"]["resolution"]["generation"] = 2
        with self.assertRaises(ValueError):
            ProofAdmissionJobCompletion.from_dict(
                payload,
                job=job,
                epoch=epoch,
            )
        for foreign_workspace_id, foreign_gate_id in (
            ("fedcba9876543210", GATE_ID),
            (WORKSPACE_ID, "foreign-gate"),
        ):
            foreign_ref = ArtifactRef(
                workspace_id=foreign_workspace_id,
                gate_id=foreign_gate_id,
                run_id=RUN_ID,
                path="manifest.json",
                sha256=SHA_C,
                media_type="application/json",
            )
            foreign_resolution = AuthoritativeLatestResolution.create(
                authority_mode=LatestAuthorityMode.FINALIZER_ENFORCED,
                workspace_id=foreign_workspace_id,
                gate_id=foreign_gate_id,
                interlock_digest=SHA_A,
                generation=1,
                enforcement_digest=SHA_B,
                manifest_ref=foreign_ref,
                result_tuple=CanonicalResultTuple.PassedDoneProven,
            )
            foreign_payload = completion.to_dict()
            foreign_payload["output"] = ClaimEmitterOutput.create(
                resolution=foreign_resolution
            ).to_dict()
            foreign_payload["completionDigest"] = domain_separated_sha256(
                "pt.acceptance.finalization.proof-admission-job-completion.v1",
                {
                    key: value
                    for key, value in foreign_payload.items()
                    if key != "completionDigest"
                },
            )
            with (
                self.subTest(
                    workspace_id=foreign_workspace_id,
                    gate_id=foreign_gate_id,
                ),
                self.assertRaisesRegex(
                    ValueError,
                    "completed output resolution identity does not match completion",
                ),
            ):
                ProofAdmissionJobCompletion.from_dict(
                    foreign_payload,
                    job=job,
                    epoch=epoch,
                )

    def test_linux_boot_environment_epoch_and_namespace_termination(self) -> None:
        host_build, host_identity = self.linux_host()
        runtime_ref = DurabilityCapabilityArtifactRef.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            crash_fixture_id="synthetic-crash-fixture",
            artifact_name=DurabilityCapabilityArtifactName.PROBE_RUNTIME_MANIFEST,
            object_digest=SHA_A,
            content_sha256=SHA_B,
            byte_length=100,
        )
        boot_helper = KernelEvidenceHelperIdentity.create(
            helper_kind="BOOT_BOUNDARY",
            source_files=(
                ("tooling/acceptance/core/proof_admission.py", SHA_A, 100),
            ),
            runtime_manifest_ref=runtime_ref,
            runtime_digest=SHA_C,
        )
        mount = LiveAuthorityMountBinding.create(
            os_family=RuntimeOsFamily.LINUX,
            stable_volume_identity_digest=SHA_D,
            mount_namespace_id="mnt:[100]",
            mount_id="42",
            darwin_fsid=None,
            device_id="2049",
            host_build=host_build,
            filesystem_implementation_version="ext4-synthetic",
            mount_options=("rw", "sync"),
            observed_at="2026-08-31T12:00:00+00:00",
        )
        prior = LinuxBootBoundaryObservation.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            observation_id="boot-before",
            source_commit="synthetic-source",
            host_identity=host_identity,
            durability_profile_digest=SHA_E,
            live_mount_binding=mount,
            helper_identity=boot_helper,
            boot_id="boot-a",
            boot_time_seconds="100",
            boot_time_nanoseconds="1",
            observed_at="2026-08-31T12:00:01+00:00",
        )
        current = LinuxBootBoundaryObservation.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            observation_id="boot-after",
            source_commit="synthetic-source",
            host_identity=host_identity,
            durability_profile_digest=SHA_E,
            live_mount_binding=mount,
            helper_identity=boot_helper,
            boot_id="boot-b",
            boot_time_seconds="200",
            boot_time_nanoseconds="2",
            observed_at="2026-08-31T12:01:00+00:00",
        )
        attestation = BootBoundaryAttestation.create(
            prior_observation=prior,
            current_observation=current,
        )
        reversed_current = LinuxBootBoundaryObservation.create(
            workspace_id=current.workspace_id,
            gate_id=current.gate_id,
            observation_id=current.observation_id,
            source_commit=current.source_commit,
            host_identity=current.host_identity,
            durability_profile_digest=current.durability_profile_digest,
            live_mount_binding=current.live_mount_binding,
            helper_identity=current.helper_identity,
            boot_id=current.boot_id,
            boot_time_seconds=current.boot_time_seconds,
            boot_time_nanoseconds=current.boot_time_nanoseconds,
            observed_at="2026-08-31T12:00:00+00:00",
        )
        with self.assertRaisesRegex(
            ValueError,
            "boot observation authority fields do not match",
        ):
            BootBoundaryAttestation.create(
                prior_observation=prior,
                current_observation=reversed_current,
            )
        legacy = LinuxLegacyClaimEnvironmentIdentity.create(
            host_identity=host_identity,
            boot_observation_digest=prior.observation_digest,
        )
        predecessor = LinuxLegacyEnvironmentTermination.create(
            execution_environment_identity=legacy,
            boot_boundary_attestation=attestation,
            terminated_at="2026-08-31T12:01:01+00:00",
        )
        pidfd_status = LinuxWaitIdStatus.create(
            si_pid=30,
            si_uid="501",
            si_code=LinuxWaitIdCode.CLD_EXITED,
            si_status=0,
        )
        pidfd_capability = LinuxPidfdWaitCapabilityEvidence.create(
            host_build=host_build,
            host_identity=host_identity,
            probe_child_pid=30,
            probe_child_process_start_identity=LinuxProcessStartIdentity.create(
                boot_id="boot-b",
                start_clock_ticks="10",
            ),
            probe_pidfd_lease_id="probe-pidfd",
            pidfd_poll_revents_raw="1",
            wait_id_status=pidfd_status,
            post_wait_pidfd_poll_revents_raw="16",
            probed_at="2026-08-31T12:01:02+00:00",
        )
        supervisor_start = LinuxProcessStartIdentity.create(
            boot_id="boot-b",
            start_clock_ticks="20",
        )
        init_start = LinuxProcessStartIdentity.create(
            boot_id="boot-b",
            start_clock_ticks="21",
        )
        observation_ref = BootBoundaryObservationRef.create(
            os_family=RuntimeOsFamily.LINUX,
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            observation_id=current.observation_id,
            observation_digest=current.observation_digest,
        )
        environment = LinuxProofAdmissionExecutionEnvironmentIdentity.create(
            host_build=host_build,
            host_identity=host_identity,
            environment_id="linux-epoch-environment",
            supervisor_pid=10,
            supervisor_process_start_identity=supervisor_start,
            epoch_boot_observation_ref=observation_ref,
            pid_namespace_device_id="4",
            pid_namespace_inode="5",
            namespace_init_pid=11,
            namespace_init_process_start_identity=init_start,
            namespace_init_pidfd_lease_id="namespace-pidfd",
            pidfd_wait_capability=pidfd_capability,
        )
        class EnvironmentSubclass(
            LinuxProofAdmissionExecutionEnvironmentIdentity
        ):
            pass

        environment_subclass = object.__new__(EnvironmentSubclass)
        with self.assertRaisesRegex(
            ValueError,
            "epoch inputs must use concrete contract types",
        ):
            ProofAdmissionEpochRecord.create(
                workspace_id=WORKSPACE_ID,
                gate_id=GATE_ID,
                coordinator_epoch_id="epoch-1",
                execution_environment_identity=environment_subclass,
                coordinator_pid=10,
                coordinator_process_start_identity=supervisor_start,
                source_commit="synthetic-source",
                proof_admission_source_digest=SHA_E,
                claim_admission_lock_identity=(
                    ProofAdmissionLockIdentity.create(
                        device_id="1",
                        inode="2",
                    )
                ),
                claim_sequence_lock_identity=(
                    ProofAdmissionLockIdentity.create(
                        device_id="1",
                        inode="3",
                    )
                ),
                previous_epoch_ref=None,
                predecessor_environment_termination=predecessor,
                started_at="2026-08-31T12:01:03+00:00",
            )
        lock_a = ProofAdmissionLockIdentity.create(device_id="1", inode="2")
        lock_b = ProofAdmissionLockIdentity.create(device_id="1", inode="3")
        epoch = ProofAdmissionEpochRecord.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            coordinator_epoch_id="epoch-1",
            execution_environment_identity=environment,
            coordinator_pid=10,
            coordinator_process_start_identity=supervisor_start,
            source_commit="synthetic-source",
            proof_admission_source_digest=SHA_E,
            claim_admission_lock_identity=lock_a,
            claim_sequence_lock_identity=lock_b,
            previous_epoch_ref=None,
            predecessor_environment_termination=predecessor,
            started_at="2026-08-31T12:01:03+00:00",
        )
        with self.assertRaisesRegex(
            ValueError,
            "predecessor termination must precede epoch start",
        ):
            ProofAdmissionEpochRecord.create(
                workspace_id=WORKSPACE_ID,
                gate_id=GATE_ID,
                coordinator_epoch_id="epoch-too-early",
                execution_environment_identity=environment,
                coordinator_pid=10,
                coordinator_process_start_identity=supervisor_start,
                source_commit="synthetic-source",
                proof_admission_source_digest=SHA_E,
                claim_admission_lock_identity=lock_a,
                claim_sequence_lock_identity=lock_b,
                previous_epoch_ref=None,
                predecessor_environment_termination=predecessor,
                started_at="2026-08-31T12:01:00+00:00",
            )
        self.assertEqual(ProofAdmissionEpochRecord.from_dict(epoch.to_dict()), epoch)

        termination_helper = KernelEvidenceHelperIdentity.create(
            helper_kind="LINUX_PID_NAMESPACE_TERMINATION",
            source_files=(
                ("tooling/acceptance/core/proof_admission.py", SHA_A, 100),
            ),
            runtime_manifest_ref=runtime_ref,
            runtime_digest=SHA_C,
        )
        namespace_status = LinuxWaitIdStatus.create(
            si_pid=11,
            si_uid="501",
            si_code=LinuxWaitIdCode.CLD_KILLED,
            si_status=9,
        )
        namespace_evidence = LinuxPidNamespaceTerminationEvidence.create(
            helper_identity=termination_helper,
            pidfd_owner_pid=10,
            pidfd_owner_process_start_identity=supervisor_start,
            pid_namespace_device_id="4",
            pid_namespace_inode="5",
            namespace_init_pid=11,
            namespace_init_process_start_identity=init_start,
            namespace_init_pidfd_lease_id="namespace-pidfd",
            namespace_init_pidfd_poll_revents_raw="1",
            namespace_init_wait_status=namespace_status,
            post_wait_pidfd_poll_revents_raw="16",
            observed_at="2026-08-31T12:06:09+00:00",
        )
        termination = LinuxExecutionEnvironmentTermination.create(
            execution_environment_identity=environment,
            termination_method=ProofAdmissionTerminationMethod.PID_NAMESPACE_INIT_TERMINATED,
            namespace_termination_evidence=namespace_evidence,
            boot_boundary_attestation=None,
            terminated_at="2026-08-31T12:06:10+00:00",
        )
        self.assertEqual(
            LinuxExecutionEnvironmentTermination.from_dict(
                termination.to_dict()
            ),
            termination,
        )
        payload = termination.to_dict()
        payload["namespaceTerminationEvidence"]["pidNamespaceInode"] = "6"
        with self.assertRaises(ValueError):
            LinuxExecutionEnvironmentTermination.from_dict(payload)
        job, _, _ = self.completed_job(epoch=epoch)
        pause = ProofAdmissionPauseRecord.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            coordinator_epoch_id=epoch.coordinator_epoch_id,
            epoch_digest=epoch.epoch_digest,
            claim_admission_lock_identity=(
                epoch.claim_admission_lock_identity
            ),
            claim_sequence_lock_identity=(
                epoch.claim_sequence_lock_identity
            ),
            last_accepted_job_sequence=1,
            paused_at="2026-08-31T12:06:20+00:00",
        )
        recovery_owner_start = LinuxProcessStartIdentity.create(
            boot_id=supervisor_start.boot_id,
            start_clock_ticks="200",
        )
        recovery_group_enumeration = (
            ProofAdmissionProcessGroupEnumeration.create(
                claim_process_group_id=job.claim_process_group_id,
                claim_process_pid=job.claim_process_pid,
                claim_process_start_identity=(
                    job.claim_process_start_identity
                ),
                observer_pid=50,
                observer_process_start_identity=recovery_owner_start,
                observed_at="2026-08-31T12:06:30+00:00",
            )
        )
        recovery = ProofAdmissionOrphanRecoveryEvidence.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            coordinator_epoch_id=epoch.coordinator_epoch_id,
            epoch_digest=epoch.epoch_digest,
            pause_digest=pause.pause_digest,
            claim_admission_lock_identity=(
                epoch.claim_admission_lock_identity
            ),
            exclusive_lock_owner_pid=50,
            exclusive_lock_owner_process_start_identity=(
                recovery_owner_start
            ),
            job_record_digest=job.job_record_digest,
            job_lease_lock_identity=job.job_lease_lock_identity,
            process_group_enumeration=recovery_group_enumeration,
            execution_environment_termination_digest=(
                termination.execution_environment_termination_digest
            ),
            observed_at="2026-08-31T12:06:40+00:00",
        )
        reaped = ProofAdmissionJobCompletion.create_reaped(
            job=job,
            epoch=epoch,
            pause=pause,
            execution_environment_termination=termination,
            orphan_recovery_evidence=recovery,
            completed_at="2026-08-31T12:07:00+00:00",
        )
        with self.assertRaisesRegex(
            ValueError,
            "completion cannot precede job registration",
        ):
            ProofAdmissionJobCompletion.create_reaped(
                job=job,
                epoch=epoch,
                pause=pause,
                execution_environment_termination=termination,
                orphan_recovery_evidence=recovery,
                completed_at="2026-08-31T12:01:01+00:00",
            )
        self.assertEqual(
            ProofAdmissionJobCompletion.from_dict(
                reaped.to_dict(),
                job=job,
                epoch=epoch,
                pause=pause,
            ),
            reaped,
        )
        foreign_environment = (
            LinuxProofAdmissionExecutionEnvironmentIdentity.create(
                host_build=host_build,
                host_identity=host_identity,
                environment_id="foreign-linux-epoch-environment",
                supervisor_pid=10,
                supervisor_process_start_identity=supervisor_start,
                epoch_boot_observation_ref=observation_ref,
                pid_namespace_device_id="4",
                pid_namespace_inode="5",
                namespace_init_pid=11,
                namespace_init_process_start_identity=init_start,
                namespace_init_pidfd_lease_id="namespace-pidfd",
                pidfd_wait_capability=pidfd_capability,
            )
        )
        foreign_termination = LinuxExecutionEnvironmentTermination.create(
            execution_environment_identity=foreign_environment,
            termination_method=(
                ProofAdmissionTerminationMethod
                .PID_NAMESPACE_INIT_TERMINATED
            ),
            namespace_termination_evidence=namespace_evidence,
            boot_boundary_attestation=None,
            terminated_at="2026-08-31T12:06:10+00:00",
        )
        with self.assertRaisesRegex(
            ValueError,
            "termination does not match job epoch",
        ):
            ProofAdmissionJobCompletion.create_reaped(
                job=job,
                epoch=epoch,
                pause=pause,
                execution_environment_termination=foreign_termination,
                orphan_recovery_evidence=recovery,
                completed_at="2026-08-31T12:07:00+00:00",
            )
        previous_ref = ProofAdmissionEpochRef.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            coordinator_epoch_id=epoch.coordinator_epoch_id,
            epoch_digest=epoch.epoch_digest,
        )
        successor_environment = (
            LinuxProofAdmissionExecutionEnvironmentIdentity.create(
                host_build=host_build,
                host_identity=host_identity,
                environment_id="linux-successor-environment",
                supervisor_pid=40,
                supervisor_process_start_identity=(
                    LinuxProcessStartIdentity.create(
                        boot_id="boot-b",
                        start_clock_ticks="40",
                    )
                ),
                epoch_boot_observation_ref=observation_ref,
                pid_namespace_device_id="4",
                pid_namespace_inode="6",
                namespace_init_pid=41,
                namespace_init_process_start_identity=(
                    LinuxProcessStartIdentity.create(
                        boot_id="boot-b",
                        start_clock_ticks="41",
                    )
                ),
                namespace_init_pidfd_lease_id="successor-pidfd",
                pidfd_wait_capability=pidfd_capability,
            )
        )
        successor_values = {
            "workspace_id": WORKSPACE_ID,
            "gate_id": GATE_ID,
            "coordinator_epoch_id": "epoch-2",
            "execution_environment_identity": successor_environment,
            "coordinator_pid": 40,
            "coordinator_process_start_identity": (
                successor_environment.supervisor_process_start_identity
            ),
            "source_commit": "synthetic-source",
            "proof_admission_source_digest": SHA_E,
            "claim_admission_lock_identity": lock_a,
            "claim_sequence_lock_identity": lock_b,
            "previous_epoch_ref": previous_ref,
            "predecessor_environment_termination": termination,
            "started_at": "2026-08-31T12:07:10+00:00",
        }
        successor = ProofAdmissionEpochRecord.create(
            previous_epoch=epoch,
            **successor_values,
        )
        self.assertEqual(
            ProofAdmissionEpochRecord.from_dict(
                successor.to_dict(),
                previous_epoch=epoch,
            ),
            successor,
        )
        early_termination = LinuxExecutionEnvironmentTermination.create(
            execution_environment_identity=environment,
            termination_method=(
                ProofAdmissionTerminationMethod
                .PID_NAMESPACE_INIT_TERMINATED
            ),
            namespace_termination_evidence=namespace_evidence,
            boot_boundary_attestation=None,
            terminated_at="2026-08-31T12:01:02+00:00",
        )
        with self.assertRaisesRegex(
            ValueError,
            "must follow previous epoch start",
        ):
            ProofAdmissionEpochRecord.create(
                previous_epoch=epoch,
                **{
                    **successor_values,
                    "predecessor_environment_termination":
                        early_termination,
                },
            )
        foreign_previous_ref = ProofAdmissionEpochRef.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            coordinator_epoch_id="foreign-epoch",
            epoch_digest=epoch.epoch_digest,
        )
        with self.assertRaisesRegex(
            ValueError,
            "does not match previous epoch",
        ):
            ProofAdmissionEpochRecord.create(
                previous_epoch=epoch,
                **{
                    **successor_values,
                    "previous_epoch_ref": foreign_previous_ref,
                },
            )

    def test_darwin_boot_attestation_and_environment_round_trip(self) -> None:
        host_build = DarwinRuntimeHostBuild.create(
            product_version="15.0",
            product_build_version="24A1",
            kernel_release="24.0.0",
            kernel_version="synthetic-darwin",
        )
        host_identity = DarwinRuntimeHostIdentity.create(
            host_build=host_build,
            hardware_identity_hash=SHA_A,
        )
        runtime_ref = DurabilityCapabilityArtifactRef.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            crash_fixture_id="synthetic-crash-fixture",
            artifact_name=DurabilityCapabilityArtifactName.PROBE_RUNTIME_MANIFEST,
            object_digest=SHA_A,
            content_sha256=SHA_B,
            byte_length=100,
        )
        helper = KernelEvidenceHelperIdentity.create(
            helper_kind="BOOT_BOUNDARY",
            source_files=(
                ("tooling/acceptance/core/proof_admission.py", SHA_A, 100),
            ),
            runtime_manifest_ref=runtime_ref,
            runtime_digest=SHA_C,
        )
        mount = LiveAuthorityMountBinding.create(
            os_family=RuntimeOsFamily.DARWIN,
            stable_volume_identity_digest=SHA_D,
            mount_namespace_id=None,
            mount_id=None,
            darwin_fsid="synthetic-fsid",
            device_id="2049",
            host_build=host_build,
            filesystem_implementation_version="apfs-synthetic",
            mount_options=("local", "rw"),
            observed_at="2026-08-31T12:00:00+00:00",
        )
        prior = DarwinBootBoundaryObservation.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            observation_id="darwin-before",
            source_commit="synthetic-source",
            host_identity=host_identity,
            durability_profile_digest=SHA_E,
            live_mount_binding=mount,
            helper_identity=helper,
            boot_session_uuid="boot-a",
            boot_time_seconds="100",
            boot_time_microseconds="1",
            observed_at="2026-08-31T12:00:01+00:00",
        )
        current = DarwinBootBoundaryObservation.create(
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            observation_id="darwin-after",
            source_commit="synthetic-source",
            host_identity=host_identity,
            durability_profile_digest=SHA_E,
            live_mount_binding=mount,
            helper_identity=helper,
            boot_session_uuid="boot-b",
            boot_time_seconds="200",
            boot_time_microseconds="2",
            observed_at="2026-08-31T12:01:00+00:00",
        )
        attestation = BootBoundaryAttestation.create(
            prior_observation=prior,
            current_observation=current,
        )
        reference = BootBoundaryObservationRef.create(
            os_family=RuntimeOsFamily.DARWIN,
            workspace_id=WORKSPACE_ID,
            gate_id=GATE_ID,
            observation_id=current.observation_id,
            observation_digest=current.observation_digest,
        )
        environment = DarwinProofAdmissionExecutionEnvironmentIdentity.create(
            host_build=host_build,
            host_identity=host_identity,
            environment_id="darwin-epoch-environment",
            supervisor_pid=10,
            supervisor_process_start_identity=DarwinProcessStartIdentity.create(
                boot_session_uuid="boot-b",
                start_seconds="201",
                start_microseconds="1",
            ),
            epoch_boot_observation_ref=reference,
        )
        self.assertEqual(
            BootBoundaryAttestation.from_dict(attestation.to_dict()),
            attestation,
        )
        self.assertEqual(
            DarwinProofAdmissionExecutionEnvironmentIdentity.from_dict(
                environment.to_dict()
            ),
            environment,
        )
        payload = attestation.to_dict()
        payload["currentObservation"]["bootSessionUuid"] = "boot-a"
        with self.assertRaises(ValueError):
            BootBoundaryAttestation.from_dict(payload)


if __name__ == "__main__":
    unittest.main()
