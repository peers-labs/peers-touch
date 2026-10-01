#!/usr/bin/env python3
"""Produce the exact-source 86-tuple J03 governed ToolCall candidate."""

from __future__ import annotations

import hashlib
import json
import os
import socket
import subprocess
import sys
import uuid
from collections.abc import Callable, Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[4]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tooling.acceptance.core import ENVIRONMENTS_DIR, EnvironmentContract
from tooling.acceptance.core.evidence_store import (
    EvidenceStore,
    source_identity,
    workspace_id,
)
from tooling.acceptance.drivers.native import create_native_desktop_adapter
from tooling.acceptance.gates.agent.agent_v2_candidate_producer import (
    AgentV2CandidateAssembler,
    AgentV2RuntimeAttestation,
    AgentV2RuntimeTuple,
    AgentV2TupleObservation,
)
from tooling.acceptance.gates.agent.capability_binding_candidate import (
    _load_script,
    resolve_machine_profile,
)
from tooling.acceptance.gates.agent.capability_binding_development import (
    OPERATION_SCENARIO_ACTOR_ACCOUNT,
    OPERATION_SCENARIO_IDENTITY_FIXTURE,
    authenticate_native_client,
    confirm_native_actor_identity_enrollment,
    persist_native_actor_identity,
    resolve_operation_scenario_actor,
    seed_native_actor_identity,
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
from tooling.acceptance.gates.agent.governed_tool_development import (
    FIXTURE_CLIPBOARD_BYTES,
    OpenAIProviderFixture,
    RemoteProviderBridge,
)
from tooling.acceptance.provisioners.home_station import (
    AGENT_V2_GOVERNED_TOOL_GATE,
    HomeStationProvisioner,
)


PROFILE = "two"
WORK_ITEM_ID = "MCA-A04-PR112-R2"
MOBILE_TEST_PATH = Path("apps/mobile/src/contracts/agentV2Contract.test.ts")
MOBILE_SOURCE_PATHS = (
    MOBILE_TEST_PATH,
    Path("apps/mobile/src/gen/proto/domain/agent/agent_pb.ts"),
    Path("apps/mobile/src/gen/proto/domain/agent/capability_pb.ts"),
)
CRASH_CELLS = (
    "CR-00",
    "CR-01",
    "CR-02",
    "CR-03",
    "CR-04N",
    "CR-04I",
    "CR-05",
    "CR-06",
)
ZERO_EXECUTION_CELLS = frozenset({"ERR-O01", "ERR-O05"})


class GovernedToolCandidateError(RuntimeError):
    """J03 observations cannot form a runtime-truthful candidate."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise GovernedToolCandidateError(message)


def _mapping(value: object, label: str) -> dict[str, Any]:
    require(isinstance(value, Mapping), f"{label} must be an object")
    return dict(value)


def _string(value: object, label: str) -> str:
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


def _is_zero_execution_tuple(runtime_tuple: AgentV2RuntimeTuple) -> bool:
    return runtime_tuple.cell in ZERO_EXECUTION_CELLS or (
        runtime_tuple.cell in {"R-05", "R-07"}
        and runtime_tuple.ordering == "A"
    )


def _validate_runtime_tuple_policy(runtime_tuple: AgentV2RuntimeTuple) -> None:
    zero_execution = _is_zero_execution_tuple(runtime_tuple)
    expected_profile = (
        "station_turn"
        if zero_execution
        else (
            "client_capability_turn"
            if runtime_tuple.platform == "desktop_app"
            else "station_capability_turn"
        )
    )
    require(
        runtime_tuple.runtime_attestation_profile == expected_profile,
        f"{runtime_tuple.key}: J03 runtime profile must be {expected_profile}",
    )
    roles = runtime_tuple.role_policy.adapter_roles
    require(
        ("zero-execution" in roles) == zero_execution,
        f"{runtime_tuple.key}: J03 zero-execution role applicability drifted",
    )
    require(
        ("executor-receipts" in roles) != zero_execution,
        f"{runtime_tuple.key}: J03 executor receipt applicability drifted",
    )


class GovernedToolRuntimeAdapter:
    """Execute one fresh governed ToolCall scenario for each runtime tuple."""

    def __init__(
        self,
        runtime_pair: FoundationRuntimePair,
        profile_env: Mapping[str, str],
        run_id: str,
        local_provider: OpenAIProviderFixture,
        station_provider: OpenAIProviderFixture,
        local_provider_url: str,
        station_provider_url: str,
        native_adapter: Any,
    ) -> None:
        self._runtime_pair = runtime_pair
        self._run_id = run_id
        self._local_provider = local_provider
        self._station_provider = station_provider
        self._local_provider_url = local_provider_url
        self._station_provider_url = station_provider_url
        self._native_adapter = native_adapter
        logins = {
            "desktop_app": authenticate_native_client(
                runtime_pair.native,
                profile_env,
                profile=PROFILE,
                account=OPERATION_SCENARIO_ACTOR_ACCOUNT,
            ),
            "browser": authenticate_native_client(
                runtime_pair.browser,
                profile_env,
                profile=PROFILE,
                account=OPERATION_SCENARIO_ACTOR_ACCOUNT,
            ),
        }
        actors = {
            platform: str(login["actorId"])
            for platform, login in logins.items()
        }
        require(
            len(set(actors.values())) == 1,
            "J03 Native and Browser clients authenticated different actors",
        )
        enrollment = confirm_native_actor_identity_enrollment(
            runtime_pair.native,
            actor_id=actors["desktop_app"],
        )
        persist_native_actor_identity(
            source_root=runtime_pair.native.actor_identity_root,
            fixture_root=OPERATION_SCENARIO_IDENTITY_FIXTURE,
            station_url=profile_env["PT_STATION_URL"],
            actor_id=actors["desktop_app"],
            station_accepted=enrollment["accepted"] is True,
            profile=PROFILE,
            account=OPERATION_SCENARIO_ACTOR_ACCOUNT,
            allow_actor_rebinding=True,
        )
        self.actor_identity_hash = _hash_text(next(iter(actors.values())))

    def _client(
        self,
        runtime_tuple: AgentV2RuntimeTuple,
    ) -> FoundationRuntimeClient:
        if runtime_tuple.platform == "desktop_app":
            return self._runtime_pair.native
        if runtime_tuple.platform == "browser":
            return self._runtime_pair.browser
        raise GovernedToolCandidateError(
            f"J03 runtime adapter rejects platform {runtime_tuple.platform}"
        )

    def _execute(
        self,
        runtime_tuple: AgentV2RuntimeTuple,
        *,
        cell: str | None = None,
        locale: str | None = None,
        ordering: str | None = None,
    ) -> tuple[str, dict[str, Any]]:
        if runtime_tuple.platform == "desktop_app":
            self._native_adapter.write_clipboard(FIXTURE_CLIPBOARD_BYTES)
            require(
                self._native_adapter.read_clipboard()
                == FIXTURE_CLIPBOARD_BYTES,
                f"{runtime_tuple.key}: clipboard fixture did not round-trip",
            )
        scenario_execution_id = str(uuid.uuid4())
        capture = _mapping(
            self._client(runtime_tuple).harness(
                "runGovernedToolScenario",
                {
                    "runId": self._run_id,
                    "scenarioExecutionId": scenario_execution_id,
                    "cell": cell or runtime_tuple.cell,
                    "platform": runtime_tuple.platform,
                    "locale": locale or runtime_tuple.locale,
                    "ordering": ordering or runtime_tuple.ordering,
                    "sampleId": runtime_tuple.sample_id,
                    "providerBaseUrl": (
                        self._local_provider_url
                        if runtime_tuple.platform == "desktop_app"
                        else self._station_provider_url
                    ),
                    "providerApiKey": (
                        self._local_provider.api_key
                        if runtime_tuple.platform == "desktop_app"
                        else self._station_provider.api_key
                    ),
                },
                timeout=900,
            ),
            f"{runtime_tuple.key} Harness capture",
        )
        assertions = _mapping(capture.get("assertions"), "J03 assertions")
        failed = sorted(
            name for name, value in assertions.items() if value is not True
        )
        require(
            bool(assertions) and not failed,
            f"{runtime_tuple.key}: J03 Harness assertions failed: "
            f"{failed or ['missing']}",
        )
        runtime = _mapping(
            capture.get("runtimeAttestation"),
            "J03 runtime attestation",
        )
        require(
            runtime.get("scenarioExecutionId") == scenario_execution_id,
            "J03 scenario execution identity changed in transit",
        )
        require(
            runtime.get("actorIdentityHash") == self.actor_identity_hash,
            "J03 capture actor differs from the candidate actor",
        )
        return scenario_execution_id, capture

    def _fresh_crash_aggregate(
        self,
        runtime_tuple: AgentV2RuntimeTuple,
    ) -> dict[str, Any]:
        executions: list[dict[str, str]] = []
        for cell in CRASH_CELLS:
            scenario_execution_id, capture = self._execute(
                runtime_tuple,
                cell=cell,
                locale="neutral",
                ordering="single",
            )
            runtime = _mapping(
                capture.get("runtimeAttestation"),
                f"{runtime_tuple.key} {cell} runtime attestation",
            )
            binding_key = (
                "toolCallBinding"
                if runtime_tuple.platform == "desktop_app"
                else "stationToolCallBinding"
            )
            binding = _mapping(
                runtime.get(binding_key),
                f"{runtime_tuple.key} {cell} primary ToolCall binding",
            )
            executions.append(
                {
                    "cell": cell,
                    "scenarioExecutionId": scenario_execution_id,
                    "toolCallId": _string(
                        binding.get("toolCallId"),
                        f"{runtime_tuple.key} {cell} ToolCall identity",
                    ),
                }
            )
        require(
            len({item["scenarioExecutionId"] for item in executions})
            == len(CRASH_CELLS),
            f"{runtime_tuple.key}: AS-05 reused crash scenario identities",
        )
        require(
            len({item["toolCallId"] for item in executions})
            == len(CRASH_CELLS),
            f"{runtime_tuple.key}: AS-05 reused crash ToolCall identities",
        )
        return {
            "cells": list(CRASH_CELLS),
            "distinctExecutionCount": len(executions),
            "distinctToolCallCount": len(executions),
            "executions": executions,
        }

    def observe(
        self,
        runtime_tuple: AgentV2RuntimeTuple,
    ) -> AgentV2TupleObservation:
        _validate_runtime_tuple_policy(runtime_tuple)
        fixture = (
            self._local_provider
            if runtime_tuple.platform == "desktop_app"
            else self._station_provider
        )
        provider_url = (
            self._local_provider_url
            if runtime_tuple.platform == "desktop_app"
            else self._station_provider_url
        )
        request_count_before = len(fixture.snapshot())
        crash_aggregate = (
            self._fresh_crash_aggregate(runtime_tuple)
            if runtime_tuple.cell == "AS-05"
            else None
        )
        scenario_execution_id, capture = self._execute(runtime_tuple)
        runtime = _mapping(
            capture.get("runtimeAttestation"),
            "J03 runtime attestation",
        )
        roles = {
            role: _mapping(payload, f"{runtime_tuple.key} {role}")
            for role, payload in _mapping(capture.get("roles"), "J03 roles").items()
        }
        if runtime_tuple.cell == "AS-05":
            require(
                crash_aggregate is not None,
                f"{runtime_tuple.key}: crash-fencing aggregate is missing",
            )
            roles["measurement-report"]["crashBarrierCoverage"] = crash_aggregate
        require(
            set(roles) == runtime_tuple.role_policy.adapter_roles,
            f"{runtime_tuple.key}: J03 role applicability mismatch",
        )
        requests = fixture.snapshot()[request_count_before:]
        require(
            requests
            and all(request.get("authorizationPresent") is True for request in requests),
            f"{runtime_tuple.key}: provider fixture was not invoked authentically",
        )
        return AgentV2TupleObservation(
            tuple_key=runtime_tuple.key,
            observed=True,
            passed=True,
            runtime_attestation=AgentV2RuntimeAttestation(
                runtime_tuple.runtime_attestation_profile,
                runtime,
            ),
            role_observations=roles,
        )


class GovernedToolMobileAdapter:
    """Run one generated-protobuf contract process for each Mobile tuple."""

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
        marker = f"[tool-mobile-cell:{runtime_tuple.cell}]"
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
                        "contractRunId": f"tool-mobile-{execution_id}",
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
                "cleanup": {
                    "resourceKind": "mobile-contract-test-process",
                    "resourceIdHash": _hash_text(" ".join(command)),
                    "status": "clean",
                },
            },
        )


class GovernedToolCandidateProducer:
    def __init__(
        self,
        runtime_adapter: GovernedToolRuntimeAdapter,
        mobile_adapter: GovernedToolMobileAdapter,
    ) -> None:
        self.assembler = AgentV2CandidateAssembler(
            AGENT_V2_GOVERNED_TOOL_GATE
        )
        self.runtime_adapter = runtime_adapter
        self.mobile_adapter = mobile_adapter

    def collect(
        self,
    ) -> tuple[
        tuple[AgentV2RuntimeTuple, AgentV2TupleObservation],
        ...,
    ]:
        collected = []
        ordered_tuples = tuple(
            runtime_tuple
            for runtime_tuple in self.assembler.runtime_tuples
            if runtime_tuple.cell != "AS-05"
        ) + tuple(
            runtime_tuple
            for runtime_tuple in self.assembler.runtime_tuples
            if runtime_tuple.cell == "AS-05"
        )
        for index, runtime_tuple in enumerate(
            ordered_tuples,
            start=1,
        ):
            print(
                json.dumps(
                    {
                        "event": "tuple-start",
                        "index": index,
                        "total": len(ordered_tuples),
                        "tuple": runtime_tuple.key,
                    },
                    sort_keys=True,
                ),
                flush=True,
            )
            try:
                observation = (
                    self.mobile_adapter.observe(runtime_tuple)
                    if runtime_tuple.runtime_attestation_profile == "contract_only"
                    else self.runtime_adapter.observe(runtime_tuple)
                )
            except BaseException as error:
                raise GovernedToolCandidateError(
                    f"{runtime_tuple.key}: tuple execution failed: {error}"
                ) from error
            collected.append((runtime_tuple, observation))
            print(
                json.dumps(
                    {
                        "event": "tuple-pass",
                        "index": index,
                        "total": len(ordered_tuples),
                        "tuple": runtime_tuple.key,
                    },
                    sort_keys=True,
                ),
                flush=True,
            )
        require(
            len(collected) == 86
            and len({observation.tuple_key for _, observation in collected})
            == 86,
            "J03 candidate observations are incomplete",
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
        / "governed-tool-candidate"
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
    print(
        json.dumps(
            {
                "event": "station-deploy-start",
                "runId": run_id,
                "source": source_identity(ROOT)["commit"],
            },
            sort_keys=True,
        ),
        flush=True,
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
        "J03 candidate Station deployment failed: "
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
    require(profile_name == PROFILE, "J03 candidate requires Profile two")
    require(
        bool(profile_env.get("CHAT_NATIVE_DEMO_PASSWORD")),
        "Profile two has no J03 actor credential",
    )
    os.environ.update(profile_env)
    os.environ["PT_ACCEPTANCE_APPROVED_PROFILE"] = PROFILE
    os.environ["PT_ACCEPTANCE_ENVIRONMENT"] = "home-station"
    os.environ["PT_AGENT_CAPABILITY_SCENARIO_CONTROL"] = "1"

    artifact_root = _candidate_root()
    os.environ["PT_ACCEPTANCE_ARTIFACT_ROOT"] = str(artifact_root)
    store = EvidenceStore(artifact_root, worktree=ROOT)
    requested_run_id = os.environ.get("PT_ACCEPTANCE_RUN_ID", "").strip()
    run = store.begin_run(
        AGENT_V2_GOVERNED_TOOL_GATE,
        source=source_identity(ROOT),
        run_id=requested_run_id or None,
    )
    os.environ["PT_ACCEPTANCE_WORKSPACE_ID"] = store.workspace_id
    os.environ["PT_ACCEPTANCE_GATE_ID"] = AGENT_V2_GOVERNED_TOOL_GATE
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
    local_provider = OpenAIProviderFixture()
    station_provider = OpenAIProviderFixture(
        tool_name="skills_list",
        expected_tool_result="",
        thread_name="mca-j03-station-provider-fixture",
    )
    local_bridge = RemoteProviderBridge(
        profile_env["PT_STATION_DEPLOY_ENV"],
        artifact_prefix="mca-j03-local-provider",
    )
    station_bridge = RemoteProviderBridge(
        profile_env["PT_STATION_DEPLOY_ENV"],
        artifact_prefix="mca-j03-station-provider",
    )
    runtime_pair: FoundationRuntimePair | None = None
    native_adapter = None
    original_clipboard: bytes | None = None
    observations: tuple[
        tuple[AgentV2RuntimeTuple, AgentV2TupleObservation],
        ...,
    ] | None = None
    primary_error: BaseException | None = None
    run_closed = False
    try:
        native_adapter = create_native_desktop_adapter()
        original_clipboard = native_adapter.read_clipboard()
        native_adapter.write_clipboard(FIXTURE_CLIPBOARD_BYTES)
        require(
            native_adapter.read_clipboard() == FIXTURE_CLIPBOARD_BYTES,
            "clipboard fixture did not round-trip",
        )
        manifest = provisioner.provision(AGENT_V2_GOVERNED_TOOL_GATE)
        require(
            manifest.state.value == "FIXTURE_READY",
            "J03 provisioning blocked: "
            f"{manifest.blocked_reason or manifest.state.value}",
        )
        local_provider.start()
        station_provider.start()
        local_provider_url = local_bridge.start(local_provider.port, run.run_id)
        station_provider_url = station_bridge.start(
            station_provider.port,
            run.run_id,
        )
        runtime_pair = FoundationRuntimePair.from_manifest(
            _build_client_manifest(manifest.to_dict()),
            profile_env=profile_env,
            startup_timeout=900,
        )
        expected_actor_id = resolve_operation_scenario_actor(profile_env)
        seed_native_actor_identity(
            fixture_root=OPERATION_SCENARIO_IDENTITY_FIXTURE,
            target_root=runtime_pair.native.actor_identity_root,
            station_url=profile_env["PT_STATION_URL"],
            profile=PROFILE,
            account=OPERATION_SCENARIO_ACTOR_ACCOUNT,
            expected_actor_id=expected_actor_id,
        )
        runtime_pair.start()
        runtime_adapter = GovernedToolRuntimeAdapter(
            runtime_pair,
            profile_env,
            run.run_id,
            local_provider,
            station_provider,
            local_provider_url,
            station_provider_url,
            native_adapter,
        )
        observations = GovernedToolCandidateProducer(
            runtime_adapter,
            GovernedToolMobileAdapter(),
        ).collect()
    except BaseException as error:
        primary_error = error
    finally:
        cleanup_failures: list[str] = []
        if runtime_pair is not None:
            try:
                result = runtime_pair.stop()
                if result.get("status") != "clean":
                    cleanup_failures.append(f"client cleanup failed: {result}")
            except BaseException as error:
                cleanup_failures.append(f"client cleanup failed: {error}")
        for bridge in (local_bridge, station_bridge):
            try:
                result = bridge.stop()
                if result.get("status") != "clean":
                    cleanup_failures.append(
                        f"provider bridge cleanup failed: {result}"
                    )
            except BaseException as error:
                cleanup_failures.append(f"provider bridge cleanup failed: {error}")
        for fixture in (local_provider, station_provider):
            try:
                fixture.stop()
            except BaseException as error:
                cleanup_failures.append(f"provider fixture cleanup failed: {error}")
        if native_adapter is not None and original_clipboard is not None:
            try:
                native_adapter.write_clipboard(original_clipboard)
                if native_adapter.read_clipboard() != original_clipboard:
                    cleanup_failures.append("clipboard restoration did not round-trip")
            except BaseException as error:
                cleanup_failures.append(f"clipboard restoration failed: {error}")
        try:
            provisioner.cleanup()
        except BaseException as error:
            cleanup_failures.append(f"provisioner cleanup failed: {error}")
        if cleanup_failures:
            run.close()
            run_closed = True
            cleanup_summary = "; ".join(cleanup_failures)
            if primary_error is not None:
                raise GovernedToolCandidateError(
                    f"primary failure: {primary_error}; "
                    f"cleanup failures: {cleanup_summary}"
                ) from primary_error
            raise GovernedToolCandidateError(cleanup_summary)
    if primary_error is not None:
        run.close()
        run_closed = True
        raise primary_error
    require(observations is not None, "J03 candidate produced no observations")
    try:
        assembler = AgentV2CandidateAssembler(AGENT_V2_GOVERNED_TOOL_GATE)
        candidate_path = assembler.produce(
            run,
            observations,
            candidate_name="governed-tool-candidate",
        )
        acceptance_run = _load_script(
            ROOT / "tooling/scripts/acceptance-run.py",
            "_governed_tool_candidate_acceptance_run",
        )
        acceptance_run.emit_agent_v2_candidate_metadata(
            run,
            AGENT_V2_GOVERNED_TOOL_GATE,
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
            "_governed_tool_candidate_validator",
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
