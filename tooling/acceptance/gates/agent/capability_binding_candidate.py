#!/usr/bin/env python3
"""Produce the exact-source 69-tuple J02 capability-binding candidate."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import socket
import subprocess
import sys
import uuid
from collections.abc import Callable, Mapping
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType
from typing import Any

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT))

from tooling.acceptance.core import ENVIRONMENTS_DIR, EnvironmentContract
from tooling.acceptance.core.evidence_store import (
    EvidenceStore,
    source_identity,
    workspace_id,
)
from tooling.acceptance.core.provisioner import load_env_file
from tooling.acceptance.gates.agent.agent_v2_candidate_producer import (
    AgentV2CandidateAssembler,
    AgentV2RuntimeAttestation,
    AgentV2RuntimeTuple,
    AgentV2TupleObservation,
)
from tooling.acceptance.gates.agent.foundation_mobile_contract_adapter import (
    _parse_vitest_report,
)
from tooling.acceptance.gates.agent.foundation_runtime_client import (
    FoundationRuntimeClient,
    FoundationRuntimePair,
)
from tooling.acceptance.gates.agent.foundation_scenario_runner import (
    _build_client_manifest,
)
from tooling.acceptance.gates.agent.home_command_center_candidate import (
    _authenticate,
    _load_script,
    resolve_machine_profile,
)
from tooling.acceptance.provisioners.home_station import (
    AGENT_V2_BINDING_GATE,
    HomeStationProvisioner,
)


PROFILE = "two"
ACTOR_ACCOUNT = "bob@p.t"
SECONDARY_ACCOUNT = "alice@p.t"
WORK_ITEM_ID = "MCA-A03-PR112"
MOBILE_TEST_PATH = Path("apps/mobile/src/contracts/agentV2Contract.test.ts")
MOBILE_SOURCE_PATHS = (
    MOBILE_TEST_PATH,
    Path("apps/mobile/src/gen/proto/domain/agent/capability_pb.ts"),
)
GUARD_SOURCE_PATHS = (
    Path("tooling/scripts/review/agent-v2-old-paths.sh"),
    Path("tooling/acceptance/fixtures/agent_v2_old_paths.json"),
    Path("apps/desktop/src/kernel/retiredStorage.ts"),
    Path("apps/desktop/src/kernel/retiredStorage.test.ts"),
    Path(
        "apps/station/app/subserver/agent/infrastructure/persistence/"
        "retired_extension_endpoint_migration.go"
    ),
    Path(
        "apps/station/app/subserver/agent/infrastructure/persistence/"
        "retired_extension_endpoint_migration_test.go"
    ),
)


class CapabilityBindingCandidateError(RuntimeError):
    """J02 observations cannot form a runtime-truthful candidate."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise CapabilityBindingCandidateError(message)


def _mapping(value: Any, label: str) -> dict[str, Any]:
    require(isinstance(value, Mapping), f"{label} must be an object")
    return dict(value)


def _string(value: Any, label: str) -> str:
    require(isinstance(value, str) and bool(value), f"{label} is missing")
    return value


def _hash_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _source_hashes(paths: tuple[Path, ...]) -> dict[str, str]:
    return {
        path.as_posix(): hashlib.sha256((ROOT / path).read_bytes()).hexdigest()
        for path in paths
    }


def _combined_hash(values: Mapping[str, str]) -> str:
    return _hash_text(
        json.dumps(dict(values), sort_keys=True, separators=(",", ":"))
    )


class CapabilityBindingRuntimeAdapter:
    """Execute one Station-owned scenario per Desktop or Browser tuple."""

    def __init__(
        self,
        runtime_pair: FoundationRuntimePair,
        profile_env: Mapping[str, str],
        run_id: str,
    ) -> None:
        self._runtime_pair = runtime_pair
        self._profile_env = dict(profile_env)
        self._run_id = run_id
        actors = {
            "desktop_app": _authenticate(runtime_pair.native, profile_env),
            "browser": _authenticate(runtime_pair.browser, profile_env),
        }
        require(
            len(set(actors.values())) == 1,
            "J02 Native and Browser clients authenticated different actors",
        )
        self.actor_identity_hash = _hash_text(next(iter(actors.values())))
        self._fixture = _mapping(
            runtime_pair.native.harness(
                "prepareCapabilityBindingCandidate",
                {"sampleId": _hash_text(run_id)[:16]},
                timeout=120,
            ),
            "J02 candidate fixture",
        )
        self.agent_name = _string(
            self._fixture.get("agentName"),
            "J02 candidate Agent name",
        )

    def _client(
        self,
        runtime_tuple: AgentV2RuntimeTuple,
    ) -> FoundationRuntimeClient:
        if runtime_tuple.platform == "desktop_app":
            return self._runtime_pair.native
        if runtime_tuple.platform == "browser":
            return self._runtime_pair.browser
        raise CapabilityBindingCandidateError(
            f"J02 runtime adapter rejects platform {runtime_tuple.platform}"
        )

    def observe(
        self,
        runtime_tuple: AgentV2RuntimeTuple,
    ) -> AgentV2TupleObservation:
        require(
            runtime_tuple.runtime_attestation_profile
            == "station_control_plane",
            "J02 Desktop/Browser tuple must use station_control_plane",
        )
        scenario_execution_id = str(uuid.uuid4())
        capture = _mapping(
            self._client(runtime_tuple).harness(
                "runCapabilityBindingScenario",
                {
                    "runId": self._run_id,
                    "scenarioExecutionId": scenario_execution_id,
                    "cell": runtime_tuple.cell,
                    "platform": runtime_tuple.platform,
                    "locale": runtime_tuple.locale,
                    "ordering": runtime_tuple.ordering,
                    "sampleId": runtime_tuple.sample_id,
                    "agentName": self.agent_name,
                    "primaryAccount": ACTOR_ACCOUNT,
                    "secondaryAccount": SECONDARY_ACCOUNT,
                    "password": self._profile_env["CHAT_NATIVE_DEMO_PASSWORD"],
                },
                timeout=180,
            ),
            f"{runtime_tuple.key} Harness capture",
        )
        runtime = _mapping(capture.get("runtime"), "J02 runtime")
        require(
            runtime.get("scenarioExecutionId") == scenario_execution_id,
            "J02 scenario execution identity changed in transit",
        )
        actor_ptid = _string(runtime.get("actorPtid"), "J02 actor")
        require(
            _hash_text(actor_ptid) == self.actor_identity_hash,
            "J02 capture actor differs from the candidate actor",
        )
        assertions = _mapping(capture.get("assertions"), "J02 assertions")
        failed_assertions = sorted(
            key for key, value in assertions.items() if value is not True
        )
        require(
            bool(assertions) and not failed_assertions,
            f"{runtime_tuple.key}: J02 Harness assertions failed: "
            f"{failed_assertions or ['missing']}",
        )
        roles = {
            role: _mapping(payload, f"{runtime_tuple.key} {role}")
            for role, payload in _mapping(capture.get("roles"), "J02 roles").items()
        }
        require(
            set(roles) == runtime_tuple.role_policy.adapter_roles,
            f"{runtime_tuple.key}: J02 role applicability mismatch",
        )
        control = _mapping(
            runtime.get("controlPlaneAttestation"),
            "J02 control-plane attestation",
        )
        return AgentV2TupleObservation(
            tuple_key=runtime_tuple.key,
            observed=True,
            passed=True,
            runtime_attestation=AgentV2RuntimeAttestation(
                "station_control_plane",
                {
                    "scenarioExecutionId": scenario_execution_id,
                    "actorIdentityHash": self.actor_identity_hash,
                    "controlPlaneAttestation": control,
                    "stationProfile": PROFILE,
                    "desktopMode": runtime_tuple.platform,
                    "networkPath": "desktop-capability->station-control-plane",
                    "machine": socket.gethostname(),
                    "coldWarmState": "neutral",
                    "observedAt": _string(
                        runtime.get("observedAt"),
                        "J02 observation timestamp",
                    ),
                },
            ),
            role_observations=roles,
        )

    def cleanup(self) -> None:
        cleanup = _mapping(
            self._runtime_pair.native.harness(
                "cleanupCapabilityBindingCandidate",
                {"fixture": self._fixture},
                timeout=120,
            ),
            "J02 candidate fixture cleanup",
        )
        require(
            cleanup.get("status") == "clean",
            f"J02 candidate fixture cleanup failed: {cleanup.get('failures')}",
        )


class CapabilityBindingMobileAdapter:
    """Run one generated-protobuf Vitest process for each Mobile tuple."""

    def __init__(
        self,
        *,
        runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
        now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    ) -> None:
        self._runner = runner
        self._now = now

    def observe(
        self,
        runtime_tuple: AgentV2RuntimeTuple,
    ) -> AgentV2TupleObservation:
        marker = f"[binding-mobile-cell:{runtime_tuple.cell}]"
        escaped_marker = marker.replace("[", r"\[").replace("]", r"\]")
        command = (
            "pnpm",
            "--dir",
            "apps/mobile",
            "exec",
            "vitest",
            "run",
            "src/contracts/agentV2Contract.test.ts",
            "-t",
            escaped_marker,
            "--reporter=json",
        )
        completed = self._runner(
            command,
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
            timeout=120,
        )
        require(
            completed.returncode == 0,
            f"{runtime_tuple.key}: Mobile contract invocation failed",
        )
        report = _parse_vitest_report(completed.stdout)
        assertions = [
            assertion
            for test_result in report.get("testResults", [])
            if isinstance(test_result, Mapping)
            for assertion in test_result.get("assertionResults", [])
            if isinstance(assertion, Mapping)
            and marker in str(assertion.get("fullName") or "")
        ]
        require(
            len(assertions) == 1 and assertions[0].get("status") == "passed",
            f"{runtime_tuple.key}: Mobile marker is missing or failed",
        )
        source_hashes = _source_hashes(MOBILE_SOURCE_PATHS)
        contract_hash = _combined_hash(source_hashes)
        execution_id = str(uuid.uuid4())
        observed_at = self._now().isoformat(timespec="microseconds")
        return AgentV2TupleObservation(
            tuple_key=runtime_tuple.key,
            observed=True,
            passed=True,
            runtime_attestation=AgentV2RuntimeAttestation(
                "contract_only",
                {
                    "scenarioExecutionId": execution_id,
                    "contractAttestation": {
                        "contractId": runtime_tuple.cell,
                        "contractRunId": f"binding-mobile-{execution_id}",
                        "contractHash": contract_hash,
                        "platform": runtime_tuple.platform,
                        "toolchain": "vitest-generated-protobuf",
                        "roundTripStatus": "passed",
                    },
                    "stationProfile": "contract-only",
                    "networkPath": "generated-protobuf-contract",
                    "machine": socket.gethostname(),
                    "coldWarmState": "contract",
                    "observedAt": observed_at,
                },
            ),
            role_observations={
                "contract-evidence": {
                    "contractId": runtime_tuple.cell,
                    "contractHash": contract_hash,
                    "platform": runtime_tuple.platform,
                    "status": "passed",
                    "roundTripEqual": True,
                    "assertionMarker": marker,
                    "sourceFiles": [
                        {"path": path, "sha256": digest}
                        for path, digest in source_hashes.items()
                    ],
                },
                "zero-execution": {
                    "counterKind": "mobile-contract-runtime-execution",
                    "count": 0,
                    "expected": 0,
                },
                "cleanup": {
                    "resourceKind": "mobile-contract-test-process",
                    "resourceIdHash": _hash_text(" ".join(command)),
                    "status": "clean",
                },
            },
        )


class CapabilityBindingRetirementAdapter:
    """Run the AS-16 hard-cut checks without claiming a product runtime."""

    def __init__(
        self,
        *,
        runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
        now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    ) -> None:
        self._runner = runner
        self._now = now

    def observe(
        self,
        runtime_tuple: AgentV2RuntimeTuple,
    ) -> AgentV2TupleObservation:
        commands = (
            (
                (
                    "tooling/scripts/review/agent-v2-old-paths.sh",
                    "--closure",
                    "C14-CUSTOM-PLUGIN",
                ),
                ROOT,
            ),
            (
                (
                    "pnpm",
                    "exec",
                    "vitest",
                    "run",
                    "src/kernel/retiredStorage.test.ts",
                ),
                ROOT / "apps/desktop",
            ),
            (
                (
                    "go",
                    "test",
                    "./app/subserver/agent/infrastructure/persistence",
                    "-run",
                    "TestRetiredExtensionEndpointMigration",
                    "-count=1",
                ),
                ROOT / "apps/station",
            ),
        )
        outputs: list[str] = []
        for command, cwd in commands:
            completed = self._runner(
                command,
                cwd=cwd,
                check=False,
                capture_output=True,
                text=True,
                timeout=300,
            )
            require(
                completed.returncode == 0,
                f"{runtime_tuple.key}: AS-16 command failed: {' '.join(command)}",
            )
            outputs.append(completed.stdout)
        source_hashes = _source_hashes(GUARD_SOURCE_PATHS)
        source_inventory_hash = _combined_hash(source_hashes)
        execution_id = str(uuid.uuid4())
        observed_at = self._now().isoformat(timespec="microseconds")
        output_hash = _hash_text("\n".join(outputs))
        return AgentV2TupleObservation(
            tuple_key=runtime_tuple.key,
            observed=True,
            passed=True,
            runtime_attestation=AgentV2RuntimeAttestation(
                "orchestration_guard",
                {
                    "scenarioExecutionId": execution_id,
                    "guardAttestation": {
                        "guardId": runtime_tuple.cell,
                        "sourceInventoryHash": source_inventory_hash,
                        "violationCount": 0,
                    },
                    "stationProfile": "guard-only",
                    "networkPath": "source-and-migration-guard",
                    "machine": socket.gethostname(),
                    "coldWarmState": "neutral",
                    "observedAt": observed_at,
                },
            ),
            role_observations={
                "zero-execution": {
                    "counterKind": "product-runtime-execution",
                    "count": 0,
                    "expected": 0,
                },
                "guard-report": {
                    "guardId": runtime_tuple.cell,
                    "sourceInventoryHash": source_inventory_hash,
                    "violationCount": 0,
                    "passed": True,
                    "commandOutputHash": output_hash,
                    "sourceFiles": [
                        {"path": path, "sha256": digest}
                        for path, digest in source_hashes.items()
                    ],
                },
                "cleanup": {
                    "resourceKind": "orchestration-guard-processes",
                    "resourceIdHash": output_hash,
                    "status": "clean",
                },
            },
        )


class CapabilityBindingCandidateProducer:
    def __init__(
        self,
        runtime_adapter: CapabilityBindingRuntimeAdapter,
        mobile_adapter: CapabilityBindingMobileAdapter,
        retirement_adapter: CapabilityBindingRetirementAdapter,
    ) -> None:
        self.assembler = AgentV2CandidateAssembler(AGENT_V2_BINDING_GATE)
        self.runtime_adapter = runtime_adapter
        self.mobile_adapter = mobile_adapter
        self.retirement_adapter = retirement_adapter

    def collect(
        self,
    ) -> tuple[
        tuple[AgentV2RuntimeTuple, AgentV2TupleObservation],
        ...,
    ]:
        collected = []
        for index, runtime_tuple in enumerate(
            self.assembler.runtime_tuples,
            start=1,
        ):
            print(
                json.dumps(
                    {
                        "event": "tuple-start",
                        "index": index,
                        "total": len(self.assembler.runtime_tuples),
                        "tuple": runtime_tuple.key,
                    },
                    sort_keys=True,
                ),
                flush=True,
            )
            try:
                if runtime_tuple.runtime_attestation_profile == "contract_only":
                    observation = self.mobile_adapter.observe(runtime_tuple)
                elif runtime_tuple.runtime_attestation_profile == "orchestration_guard":
                    observation = self.retirement_adapter.observe(runtime_tuple)
                else:
                    observation = self.runtime_adapter.observe(runtime_tuple)
            except BaseException as error:
                raise CapabilityBindingCandidateError(
                    f"{runtime_tuple.key}: tuple execution failed: {error}"
                ) from error
            collected.append((runtime_tuple, observation))
            print(
                json.dumps(
                    {
                        "event": "tuple-pass",
                        "index": index,
                        "total": len(self.assembler.runtime_tuples),
                        "tuple": runtime_tuple.key,
                    },
                    sort_keys=True,
                ),
                flush=True,
            )
        require(
            len(collected) == 69
            and len({observation.tuple_key for _, observation in collected})
            == 69,
            "J02 candidate observations are incomplete",
        )
        return tuple(collected)


def _candidate_root() -> Path:
    configured = os.environ.get("PT_ACCEPTANCE_ARTIFACT_ROOT", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    return (
        Path.home()
        / ".peers-touch"
        / "dev"
        / "workspaces"
        / workspace_id(ROOT)
        / "workflow"
        / WORK_ITEM_ID
        / "artifacts"
        / run_id
        / "capability-binding-candidate"
    )


def _deploy_acceptance_station(
    profile_env: Mapping[str, str],
    run_id: str,
) -> None:
    environment = os.environ.copy()
    environment.update(profile_env)
    environment.update(
        {
            "PT_ACCEPTANCE_ENVIRONMENT": "home-station",
            "PT_AGENT_CAPABILITY_SCENARIO_CONTROL": "1",
            "PT_ACCEPTANCE_RUN_ID": run_id,
        }
    )
    completed = subprocess.run(
        ["make", "station"],
        cwd=ROOT,
        env=environment,
        check=False,
        capture_output=True,
        text=True,
        timeout=1_800,
    )
    require(
        completed.returncode == 0,
        "J02 candidate Station deployment failed: "
        + (completed.stderr.strip() or completed.stdout.strip() or "no output")[
            -4_000:
        ],
    )


def main() -> int:
    activation = subprocess.run(
        ["make", "profile", f"PROFILE={PROFILE}"],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    require(activation.returncode == 0, "failed to activate Profile two")
    profile_name, profile_file, slot, profile_env = resolve_machine_profile()
    require(profile_name == PROFILE, "J02 candidate requires Profile two")
    require(
        bool(profile_env.get("CHAT_NATIVE_DEMO_PASSWORD")),
        "Profile two has no J02 actor credential",
    )
    os.environ.update(profile_env)
    os.environ["PT_ACCEPTANCE_APPROVED_PROFILE"] = PROFILE

    artifact_root = _candidate_root()
    os.environ["PT_ACCEPTANCE_ARTIFACT_ROOT"] = str(artifact_root)
    store = EvidenceStore(artifact_root, worktree=ROOT)
    requested_run_id = os.environ.get("PT_ACCEPTANCE_RUN_ID", "").strip()
    run = store.begin_run(
        AGENT_V2_BINDING_GATE,
        source=source_identity(ROOT),
        run_id=requested_run_id or None,
    )
    os.environ["PT_ACCEPTANCE_WORKSPACE_ID"] = store.workspace_id
    os.environ["PT_ACCEPTANCE_GATE_ID"] = AGENT_V2_BINDING_GATE
    os.environ["PT_ACCEPTANCE_RUN_ID"] = run.run_id
    _deploy_acceptance_station(profile_env, run.run_id)

    provisioner = HomeStationProvisioner(
        EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "home-station.yaml"
        )
    )
    provisioner._resolve_active_profile = lambda: (
        profile_name,
        profile_file,
        slot,
        dict(profile_env),
    )
    runtime_pair: FoundationRuntimePair | None = None
    runtime_adapter: CapabilityBindingRuntimeAdapter | None = None
    observations: tuple[
        tuple[AgentV2RuntimeTuple, AgentV2TupleObservation],
        ...,
    ] | None = None
    primary_error: BaseException | None = None
    run_closed = False
    try:
        manifest = provisioner.provision(AGENT_V2_BINDING_GATE)
        require(
            manifest.state.value == "FIXTURE_READY",
            "J02 provisioning blocked: "
            f"{manifest.blocked_reason or manifest.state.value}",
        )
        runtime_pair = FoundationRuntimePair.from_manifest(
            _build_client_manifest(manifest.to_dict()),
            profile_env=profile_env,
            startup_timeout=900,
        )
        runtime_pair.start()
        runtime_adapter = CapabilityBindingRuntimeAdapter(
            runtime_pair,
            profile_env,
            run.run_id,
        )
        producer = CapabilityBindingCandidateProducer(
            runtime_adapter,
            CapabilityBindingMobileAdapter(),
            CapabilityBindingRetirementAdapter(),
        )
        observations = producer.collect()
    except BaseException as error:
        primary_error = error
    finally:
        cleanup_failures: list[str] = []
        if runtime_adapter is not None:
            try:
                runtime_adapter.cleanup()
            except BaseException as error:
                cleanup_failures.append(
                    f"candidate fixture cleanup failed: {error}"
                )
        if runtime_pair is not None:
            try:
                result = runtime_pair.stop()
                if result.get("status") != "clean":
                    cleanup_failures.append(f"client cleanup failed: {result}")
            except BaseException as error:
                cleanup_failures.append(f"client cleanup failed: {error}")
        try:
            provisioner.cleanup()
        except BaseException as error:
            cleanup_failures.append(f"provisioner cleanup failed: {error}")
        if cleanup_failures:
            run.close()
            run_closed = True
            raise CapabilityBindingCandidateError("; ".join(cleanup_failures))
    if primary_error is not None:
        run.close()
        run_closed = True
        raise primary_error
    require(observations is not None, "J02 candidate produced no observations")
    try:
        assembler = AgentV2CandidateAssembler(AGENT_V2_BINDING_GATE)
        candidate_path = assembler.produce(
            run,
            observations,
            candidate_name="capability-binding-candidate",
        )
        acceptance_run = _load_script(
            ROOT / "tooling/scripts/acceptance-run.py",
            "_capability_binding_candidate_acceptance_run",
        )
        acceptance_run.emit_agent_v2_candidate_metadata(
            run,
            AGENT_V2_BINDING_GATE,
            source_identity(ROOT),
        )
        run.finalize(
            result={
                "status": "passed",
                "completionStatus": "DONE",
                "proofStatus": "CANDIDATE",
            }
        )
        candidate_ref = run.manifest_ref
        run.close()
        run_closed = True

        validator = _load_script(
            ROOT / "tooling/scripts/acceptance-validate.py",
            "_capability_binding_candidate_validator",
        )
        validator.validate_candidate(
            store,
            candidate_ref,
            candidate_ref.sha256,
        )
        print(
            json.dumps(
                {
                    "candidate": str(candidate_path),
                    "manifest": str(store.resolve(candidate_ref)),
                    "proofStatus": "CANDIDATE",
                    "tupleCount": len(observations),
                },
                sort_keys=True,
            )
        )
        return 0
    finally:
        if not run_closed:
            run.close()


if __name__ == "__main__":
    raise SystemExit(main())
