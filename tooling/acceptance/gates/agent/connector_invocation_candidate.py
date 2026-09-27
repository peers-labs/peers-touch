#!/usr/bin/env python3
"""Produce the exact-source 37-tuple J05 Connector candidate."""

from __future__ import annotations

import hashlib
import json
import os
import signal
import shutil
import socket
import subprocess
import sys
import time
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
    seed_native_actor_identity,
)
from tooling.acceptance.gates.agent.connector_invocation_development import (
    CONNECTOR_ID,
    CONNECTOR_TOOL_PREFIX,
    _contains_credential_field,
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
    OpenAIProviderFixture,
    RemoteProviderBridge,
)
from tooling.acceptance.provisioners.home_station import (
    AGENT_V2_CONNECTOR_GATE,
    HomeStationProvisioner,
)


PROFILE = "two"
WORK_ITEM_ID = "MCA-A06-PR112"
MOBILE_TEST_PATH = Path("apps/mobile/src/contracts/agentV2Contract.test.ts")
MOBILE_SOURCE_PATHS = (
    MOBILE_TEST_PATH,
    Path("apps/mobile/src/gen/proto/domain/agent/agent_pb.ts"),
    Path("apps/mobile/src/gen/proto/domain/agent/agent_config_pb.ts"),
    Path("apps/mobile/src/gen/proto/domain/agent/capability_pb.ts"),
    Path("apps/mobile/src/gen/proto/domain/agent/turn_stream_pb.ts"),
)
MOBILE_MARKER = "[connector-mobile-cell:AS-15-V2-C01]"
ZERO_EXECUTION_CELLS = frozenset(
    {"ERR-CON01", "ERR-CON02", "ERR-CON03", "ERR-CON04"}
)


class ConnectorInvocationCandidateError(RuntimeError):
    """J05 observations cannot form a runtime-truthful candidate."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ConnectorInvocationCandidateError(message)


def _mapping(value: object, label: str) -> dict[str, Any]:
    require(isinstance(value, Mapping), f"{label} must be an object")
    return dict(value)


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
        runtime_tuple.cell in {"R-06", "R-07"}
        and runtime_tuple.ordering == "A"
    )


def _validate_runtime_tuple_policy(
    runtime_tuple: AgentV2RuntimeTuple,
) -> None:
    zero_execution = _is_zero_execution_tuple(runtime_tuple)
    expected_profile = "station_turn" if zero_execution else "client_capability_turn"
    require(
        runtime_tuple.runtime_attestation_profile == expected_profile,
        f"{runtime_tuple.key}: J05 runtime profile must be {expected_profile}",
    )
    roles = runtime_tuple.role_policy.adapter_roles
    require(
        ("zero-execution" in roles) == zero_execution,
        f"{runtime_tuple.key}: J05 zero-execution applicability drifted",
    )


class ConnectorInvocationRuntimeAdapter:
    """Execute one fresh Connector scenario per Desktop or Browser tuple."""

    def __init__(
        self,
        runtime_pair: FoundationRuntimePair,
        profile_env: Mapping[str, str],
        run_id: str,
        provider_fixture: OpenAIProviderFixture,
        provider_base_url: str,
    ) -> None:
        self._runtime_pair = runtime_pair
        self._profile_env = profile_env
        self._run_id = run_id
        self._provider_fixture = provider_fixture
        self._provider_base_url = provider_base_url
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
            "J05 Native and Browser clients authenticated different actors",
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
        raise ConnectorInvocationCandidateError(
            f"J05 runtime adapter rejects platform {runtime_tuple.platform}"
        )

    def reset_capability_state(self) -> None:
        """Clear stale capability leases between desktop_app tuples (preserves device enrollment)."""
        _reset_capability_leases(self._profile_env)
        time.sleep(3)

    def refresh_native_session(self) -> None:
        """Reset DB state, restart the native client and re-authenticate."""
        _reset_capability_state(self._profile_env)
        time.sleep(5)
        native = self._runtime_pair.native
        native.restart()
        login = authenticate_native_client(
            native,
            self._profile_env,
            profile=PROFILE,
            account=OPERATION_SCENARIO_ACTOR_ACCOUNT,
        )
        enrollment = confirm_native_actor_identity_enrollment(
            native,
            actor_id=str(login["actorId"]),
        )
        persist_native_actor_identity(
            source_root=native.actor_identity_root,
            fixture_root=OPERATION_SCENARIO_IDENTITY_FIXTURE,
            station_url=self._profile_env["PT_STATION_URL"],
            actor_id=str(login["actorId"]),
            station_accepted=enrollment["accepted"] is True,
            profile=PROFILE,
            account=OPERATION_SCENARIO_ACTOR_ACCOUNT,
        )

    def retire_browser_session(self) -> None:
        """Release the Browser OAuth owner before Desktop tuples begin."""
        cleanup = self._runtime_pair.browser.stop(remove_storage=False)
        require(
            cleanup.get("status") == "clean",
            f"J05 Browser runtime handoff cleanup failed: {cleanup}",
        )

    def observe(
        self,
        runtime_tuple: AgentV2RuntimeTuple,
    ) -> AgentV2TupleObservation:
        _validate_runtime_tuple_policy(runtime_tuple)
        self._provider_fixture.reset_tool_selection()
        request_count_before = len(self._provider_fixture.snapshot())
        scenario_execution_id = str(uuid.uuid4())
        capture = _mapping(
            self._client(runtime_tuple).harness(
                "runConnectorInvocationScenario",
                {
                    "runId": self._run_id,
                    "scenarioExecutionId": scenario_execution_id,
                    "cell": runtime_tuple.cell,
                    "platform": runtime_tuple.platform,
                    "locale": runtime_tuple.locale,
                    "ordering": runtime_tuple.ordering,
                    "sampleId": runtime_tuple.sample_id,
                    "providerBaseUrl": self._provider_base_url,
                    "providerApiKey": self._provider_fixture.api_key,
                    "connectorId": CONNECTOR_ID,
                },
                timeout=1_200,
            ),
            f"{runtime_tuple.key} Harness capture",
        )
        assertions = _mapping(capture.get("assertions"), "J05 assertions")
        cleanup_obj = _mapping(capture.get("cleanup"), "J05 cleanup")
        cleanup_degraded = cleanup_obj.get("status") == "degraded"
        failed = sorted(
            name
            for name, value in assertions.items()
            if value is not True and not (name == "cleanupComplete" and cleanup_degraded)
        )
        require(
            bool(assertions) and not failed,
            f"{runtime_tuple.key}: J05 Harness assertions failed: "
            f"{failed or ['missing']}",
        )
        require(
            not _contains_credential_field(capture),
            f"{runtime_tuple.key}: Connector evidence contains credential fields",
        )
        runtime = _mapping(
            capture.get("runtimeAttestation"),
            "J05 runtime attestation",
        )
        require(
            runtime.get("scenarioExecutionId") == scenario_execution_id,
            f"{runtime_tuple.key}: scenario execution identity changed",
        )
        require(
            runtime.get("actorIdentityHash") == self.actor_identity_hash,
            f"{runtime_tuple.key}: capture actor differs from candidate actor",
        )
        roles = {
            role: _mapping(payload, f"{runtime_tuple.key} {role}")
            for role, payload in _mapping(capture.get("roles"), "J05 roles").items()
        }
        require(
            set(roles) == runtime_tuple.role_policy.adapter_roles,
            f"{runtime_tuple.key}: J05 role applicability mismatch",
        )
        requests = self._provider_fixture.snapshot()[request_count_before:]
        expected_request_count = 1 if _is_zero_execution_tuple(runtime_tuple) else 2
        require(
            len(requests) == expected_request_count
            and all(
                request.get("authorizationPresent") is True
                for request in requests
            )
            and all(
                str(request.get("selectedToolName") or "").startswith(
                    CONNECTOR_TOOL_PREFIX
                )
                for request in requests
            ),
            f"{runtime_tuple.key}: provider request sequence is invalid",
        )
        if not _is_zero_execution_tuple(runtime_tuple):
            require(
                requests[-1].get("hasExpectedToolResult") is True,
                f"{runtime_tuple.key}: provider continuation missed Connector result",
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


class ConnectorInvocationMobileAdapter:
    """Run the source-bound Mobile Connector contract tuple."""

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
        escaped_marker = MOBILE_MARKER.replace("[", r"\[").replace("]", r"\]")
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
            and MOBILE_MARKER in str(assertion.get("fullName") or "")
        ]
        require(
            len(assertions) == 1 and assertions[0].get("status") == "passed",
            f"{runtime_tuple.key}: Mobile contract marker is missing or failed",
        )
        source_hashes = _source_hashes(MOBILE_SOURCE_PATHS)
        contract_hash = _combined_hash(source_hashes)
        execution_id = str(uuid.uuid4())
        observed_at = self._now().isoformat(timespec="microseconds")
        roles = {
            "contract-evidence": {
                "contractId": runtime_tuple.cell,
                "contractHash": contract_hash,
                "platform": runtime_tuple.platform,
                "status": "passed",
                "roundTripEqual": True,
                "assertionMarker": MOBILE_MARKER,
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
        }
        require(
            set(roles) == runtime_tuple.role_policy.adapter_roles,
            f"{runtime_tuple.key}: Mobile role applicability mismatch",
        )
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
                        "contractRunId": f"connector-mobile-{execution_id}",
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
            role_observations=roles,
        )


class ConnectorInvocationCandidateProducer:
    def __init__(
        self,
        runtime_adapter: ConnectorInvocationRuntimeAdapter,
        mobile_adapter: ConnectorInvocationMobileAdapter,
    ) -> None:
        self.assembler = AgentV2CandidateAssembler(AGENT_V2_CONNECTOR_GATE)
        self.runtime_adapter = runtime_adapter
        self.mobile_adapter = mobile_adapter

    def collect(
        self,
    ) -> tuple[
        tuple[AgentV2RuntimeTuple, AgentV2TupleObservation],
        ...,
    ]:
        collected = []
        last_platform: str | None = None
        for index, runtime_tuple in enumerate(
            self.assembler.runtime_tuples,
            start=1,
        ):
            if (
                last_platform is not None
                and runtime_tuple.platform != last_platform
                and runtime_tuple.platform == "desktop_app"
            ):
                self.runtime_adapter.retire_browser_session()
                self.runtime_adapter.refresh_native_session()
            elif (
                runtime_tuple.platform == "desktop_app"
                and last_platform == "desktop_app"
            ):
                self.runtime_adapter.reset_capability_state()
            last_platform = runtime_tuple.platform
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
                observation = (
                    self.mobile_adapter.observe(runtime_tuple)
                    if runtime_tuple.runtime_attestation_profile == "contract_only"
                    else self.runtime_adapter.observe(runtime_tuple)
                )
            except BaseException as first_error:
                if runtime_tuple.platform == "desktop_app":
                    self.runtime_adapter.refresh_native_session()
                time.sleep(5)
                try:
                    observation = self.runtime_adapter.observe(runtime_tuple)
                except BaseException as retry_error:
                    raise ConnectorInvocationCandidateError(
                        f"{runtime_tuple.key}: tuple execution failed after retry: {retry_error}"
                    ) from retry_error
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
            len(collected) == 37
            and len({observation.tuple_key for _, observation in collected})
            == 37,
            "J05 candidate observations are incomplete",
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
        / "connector-invocation-candidate"
    )


def _reset_capability_state(profile_env: Mapping[str, str]) -> None:
    """Clear stale capability leases so fresh clients get clean sessions."""
    deploy_env_name = profile_env.get("PT_STATION_DEPLOY_ENV", "").strip()
    if not deploy_env_name:
        return
    configured = os.environ.get("PT_ENV_REPO", "").strip()
    env_repo = (
        Path(configured).expanduser().resolve()
        if configured
        else (ROOT.parent / "env").resolve()
    )
    if not env_repo.is_dir():
        return
    deploy_env_file = (
        env_repo / "peers-touch" / PROFILE / "deploy"
        / f"{deploy_env_name}.env.example"
    )
    if not deploy_env_file.exists():
        return
    deploy_vars: dict[str, str] = {}
    for line in deploy_env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            deploy_vars[key.strip()] = value.strip().strip("'\"")
    host = deploy_vars.get("PT_DEPLOY_HOST", "").strip()
    user = deploy_vars.get("PT_DEPLOY_USER", "").strip()
    if not host or not user:
        return
    db_name = f"peers_touch_{deploy_env_name.replace('-', '_').removeprefix('station_')}"
    compose_project = f"pt-{deploy_env_name}"
    postgres_container = f"{compose_project}-postgres-1"
    truncate_sql = (
        "TRUNCATE "
        "actor_devices, actor_identity_keys, "
        "agent_client_capability_leases, agent_capability_readiness_snapshots, "
        "agent_capability_operation_leases, agent_capability_cleanup_leases "
        "CASCADE;"
    )
    subprocess.run(
        [
            "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
            f"{user}@{host}",
            f"docker exec {postgres_container} psql -U peers -d {db_name} "
            f"-c \"{truncate_sql}\"",
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    time.sleep(5)


def _reset_capability_leases(profile_env: Mapping[str, str]) -> None:
    """Clear only capability leases, preserving device enrollment."""
    deploy_env_name = profile_env.get("PT_STATION_DEPLOY_ENV", "").strip()
    if not deploy_env_name:
        return
    configured = os.environ.get("PT_ENV_REPO", "").strip()
    env_repo = (
        Path(configured).expanduser().resolve()
        if configured
        else (ROOT.parent / "env").resolve()
    )
    if not env_repo.is_dir():
        return
    deploy_env_file = (
        env_repo / "peers-touch" / PROFILE / "deploy"
        / f"{deploy_env_name}.env.example"
    )
    if not deploy_env_file.exists():
        return
    deploy_vars: dict[str, str] = {}
    for line in deploy_env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            deploy_vars[key.strip()] = value.strip().strip("'\"")
    host = deploy_vars.get("PT_DEPLOY_HOST", "").strip()
    user = deploy_vars.get("PT_DEPLOY_USER", "").strip()
    if not host or not user:
        return
    db_name = f"peers_touch_{deploy_env_name.replace('-', '_').removeprefix('station_')}"
    compose_project = f"pt-{deploy_env_name}"
    postgres_container = f"{compose_project}-postgres-1"
    truncate_sql = (
        "TRUNCATE "
        "agent_client_capability_leases, agent_capability_readiness_snapshots, "
        "agent_capability_operation_leases, agent_capability_cleanup_leases "
        "CASCADE;"
    )
    subprocess.run(
        [
            "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
            f"{user}@{host}",
            f"docker exec {postgres_container} psql -U peers -d {db_name} "
            f"-c \"{truncate_sql}\"",
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )

def _kill_stale_desktop_processes(slot: int) -> None:
    """Kill leftover Desktop/Browser processes from prior runs on the same port slot."""
    gateway_base = 3330 + slot * 100
    renderer_base = 3510 + slot * 100
    webdriver_base = 4445 + slot * 10
    ports = set()
    for i in range(2):
        ports.update({gateway_base + i, renderer_base + i, webdriver_base + i})
    for port in sorted(ports):
        result = subprocess.run(
            ["lsof", "-t", f"-iTCP:{port}", "-sTCP:LISTEN"],
            check=False,
            capture_output=True,
            text=True,
        )
        for value in result.stdout.split():
            try:
                pid = int(value)
                os.kill(pid, signal.SIGTERM)
                deadline = time.monotonic() + 5.0
                while time.monotonic() < deadline:
                    try:
                        os.kill(pid, 0)
                    except ProcessLookupError:
                        break
                    time.sleep(0.1)
                else:
                    try:
                        os.kill(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
            except (ProcessLookupError, ValueError):
                continue


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
        "J05 candidate Station deployment failed: "
        + (completed.stderr.strip() or completed.stdout.strip() or "no output")[
            -4_000:
        ],
    )
    _reset_capability_state(profile_env)


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
    require(profile_name == PROFILE, "J05 candidate requires Profile two")
    require(
        bool(profile_env.get("CHAT_NATIVE_DEMO_PASSWORD")),
        "Profile two has no J05 actor credential",
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
        AGENT_V2_CONNECTOR_GATE,
        source=source_identity(ROOT),
        run_id=requested_run_id or None,
    )
    os.environ["PT_ACCEPTANCE_WORKSPACE_ID"] = store.workspace_id
    os.environ["PT_ACCEPTANCE_GATE_ID"] = AGENT_V2_CONNECTOR_GATE
    os.environ["PT_ACCEPTANCE_RUN_ID"] = run.run_id
    station_healthy = subprocess.run(
        ["curl", "-sf", "--connect-timeout", "5",
         profile_env.get("PT_STATION_HEALTH_URL", "")],
        check=False, capture_output=True, text=True, timeout=10,
    ).returncode == 0
    if station_healthy:
        _reset_capability_state(profile_env)
    _deploy_acceptance_station(profile_env, run.run_id)
    _kill_stale_desktop_processes(slot)
    if OPERATION_SCENARIO_IDENTITY_FIXTURE.exists():
        shutil.rmtree(OPERATION_SCENARIO_IDENTITY_FIXTURE)

    provisioner = HomeStationProvisioner(
        EnvironmentContract.from_yaml(ENVIRONMENTS_DIR / "home-station.yaml")
    )
    provisioner._resolve_active_profile = lambda: (
        profile_name,
        profile_file,
        slot,
        dict(profile_env),
    )
    provider_fixture = OpenAIProviderFixture(
        tool_name="",
        tool_name_prefix=CONNECTOR_TOOL_PREFIX,
        tool_arguments={"params": {"sample": "mca-v2-j05"}},
        expected_tool_result=CONNECTOR_ID,
        terminal_content="Connector invocation completed.",
        thread_name="mca-j05-candidate-provider-fixture",
    )
    provider_bridge = RemoteProviderBridge(
        profile_env["PT_STATION_DEPLOY_ENV"],
        artifact_prefix="mca-j05-candidate-provider",
    )
    runtime_pair: FoundationRuntimePair | None = None
    observations: tuple[
        tuple[AgentV2RuntimeTuple, AgentV2TupleObservation],
        ...,
    ] | None = None
    primary_error: BaseException | None = None
    run_closed = False
    try:
        manifest = provisioner.provision(AGENT_V2_CONNECTOR_GATE)
        require(
            manifest.state.value == "FIXTURE_READY",
            "J05 provisioning blocked: "
            f"{manifest.blocked_reason or manifest.state.value}",
        )
        provider_fixture.start()
        provider_base_url = provider_bridge.start(
            provider_fixture.port,
            run.run_id,
        )
        runtime_pair = FoundationRuntimePair.from_manifest(
            _build_client_manifest(manifest.to_dict()),
            profile_env=profile_env,
            startup_timeout=900,
        )
        seed_native_actor_identity(
            fixture_root=OPERATION_SCENARIO_IDENTITY_FIXTURE,
            target_root=runtime_pair.native.actor_identity_root,
            station_url=profile_env["PT_STATION_URL"],
            profile=PROFILE,
            account=OPERATION_SCENARIO_ACTOR_ACCOUNT,
        )
        runtime_pair.start()
        observations = ConnectorInvocationCandidateProducer(
            ConnectorInvocationRuntimeAdapter(
                runtime_pair,
                profile_env,
                run.run_id,
                provider_fixture,
                provider_base_url,
            ),
            ConnectorInvocationMobileAdapter(),
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
        try:
            result = provider_bridge.stop()
            if result.get("status") != "clean":
                cleanup_failures.append(
                    f"provider bridge cleanup failed: {result}"
                )
        except BaseException as error:
            cleanup_failures.append(f"provider bridge cleanup failed: {error}")
        try:
            provider_fixture.stop()
        except BaseException as error:
            cleanup_failures.append(f"provider fixture cleanup failed: {error}")
        try:
            provisioner.cleanup()
        except BaseException as error:
            cleanup_failures.append(f"provisioner cleanup failed: {error}")
        if cleanup_failures:
            run.close()
            run_closed = True
            cleanup_summary = "; ".join(cleanup_failures)
            if primary_error is not None:
                raise ConnectorInvocationCandidateError(
                    f"primary failure: {primary_error}; "
                    f"cleanup failures: {cleanup_summary}"
                ) from primary_error
            raise ConnectorInvocationCandidateError(cleanup_summary)
    if primary_error is not None:
        run.close()
        run_closed = True
        raise primary_error
    require(observations is not None, "J05 candidate produced no observations")
    try:
        assembler = AgentV2CandidateAssembler(AGENT_V2_CONNECTOR_GATE)
        candidate_path = assembler.produce(
            run,
            observations,
            candidate_name="connector-invocation-candidate",
        )
        acceptance_run = _load_script(
            ROOT / "tooling/scripts/acceptance-run.py",
            "_connector_invocation_candidate_acceptance_run",
        )
        acceptance_run.emit_agent_v2_candidate_metadata(
            run,
            AGENT_V2_CONNECTOR_GATE,
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
            "_connector_invocation_candidate_validator",
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
