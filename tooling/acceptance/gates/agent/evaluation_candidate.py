#!/usr/bin/env python3
"""Produce the exact-source 57-tuple J06 Evaluation candidate."""

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
from tooling.acceptance.gates.agent.evaluation_development import (
    ACTOR_ACCOUNTS,
    ACTOR_IDENTITY_FIXTURES,
    EvaluationProviderFixture,
    authenticate_client,
    persist_actor_identity,
    seed_actor_identity,
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
from tooling.acceptance.gates.agent.foundation_station_restart import (
    restart_foundation_station,
)
from tooling.acceptance.gates.agent.governed_tool_development import (
    RemoteProviderBridge,
)
from tooling.acceptance.provisioners.home_station import (
    AGENT_V2_EVALUATION_GATE,
    HomeStationProvisioner,
)


PROFILE = "two"
WORK_ITEM_ID = "MCA-A07-PR112-R1"
MOBILE_TEST_PATH = Path("apps/mobile/src/contracts/agentV2Contract.test.ts")
MOBILE_SOURCE_PATHS = (
    MOBILE_TEST_PATH,
    Path("apps/mobile/src/gen/proto/domain/agent/agent_pb.ts"),
    Path("apps/mobile/src/gen/proto/domain/agent/capability_pb.ts"),
    Path("apps/mobile/src/gen/proto/domain/agent/evaluation_pb.ts"),
)
MOBILE_MARKER = "[evaluation-mobile-cell:AS-15-V2-E01]"
CONTROL_PLANE_CELLS = frozenset({"ERR-E01", "ERR-E02", "ERR-E05"})


class EvaluationCandidateError(RuntimeError):
    """J06 observations cannot form a runtime-truthful candidate."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise EvaluationCandidateError(message)


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


def _is_control_plane_tuple(runtime_tuple: AgentV2RuntimeTuple) -> bool:
    return runtime_tuple.cell in CONTROL_PLANE_CELLS


def _validate_runtime_tuple_policy(
    runtime_tuple: AgentV2RuntimeTuple,
) -> None:
    if runtime_tuple.platform == "mobile_contract":
        require(
            runtime_tuple.cell == "AS-15-V2-E01"
            and runtime_tuple.runtime_attestation_profile == "contract_only",
            f"{runtime_tuple.key}: invalid J06 Mobile contract tuple",
        )
        require(
            runtime_tuple.role_policy.adapter_roles
            == frozenset({"cell-results", "contract-evidence", "cleanup"}),
            f"{runtime_tuple.key}: invalid J06 Mobile role policy",
        )
        return
    require(
        runtime_tuple.platform in {"desktop_app", "browser"},
        f"{runtime_tuple.key}: unsupported J06 runtime platform",
    )
    expected_profile = (
        "station_control_plane"
        if _is_control_plane_tuple(runtime_tuple)
        else "station_turn"
    )
    require(
        runtime_tuple.runtime_attestation_profile == expected_profile,
        f"{runtime_tuple.key}: J06 runtime profile must be {expected_profile}",
    )
    turn_roles = {"runtime-events", "turn-trace", "metrics-lineage"}
    has_turn_roles = turn_roles.issubset(
        runtime_tuple.role_policy.adapter_roles
    )
    require(
        has_turn_roles == (not _is_control_plane_tuple(runtime_tuple)),
        f"{runtime_tuple.key}: J06 Turn role applicability drifted",
    )


class EvaluationRuntimeAdapter:
    """Execute one fresh Evaluation scenario per Desktop or Browser tuple."""

    def __init__(
        self,
        runtime_pair: FoundationRuntimePair,
        profile_env: Mapping[str, str],
        run_id: str,
        provider_fixture: EvaluationProviderFixture,
        provider_base_url: str,
        runtime_manifest: Mapping[str, Any],
    ) -> None:
        self._runtime_pair = runtime_pair
        self._profile_env = profile_env
        self._run_id = run_id
        self._provider_fixture = provider_fixture
        self._provider_base_url = provider_base_url
        self._runtime_manifest = runtime_manifest
        provider_info = {
            "providerId": f"mca-j06-candidate-{run_id[:12]}",
            "apiKey": provider_fixture.api_key,
            "modelId": f"model-j06-{run_id[:12]}",
            "baseUrl": provider_base_url,
        }
        seed_actor_identity(
            "alice",
            runtime_pair.native.actor_identity_root,
            profile_env["PT_STATION_URL"],
            fixture=ACTOR_IDENTITY_FIXTURES["alice"],
        )
        runtime_pair.native.start()
        native_login = authenticate_client(
            runtime_pair.native,
            account=ACTOR_ACCOUNTS["alice"],
            password=profile_env["CHAT_NATIVE_DEMO_PASSWORD"],
            ensure_provider=provider_info,
        )
        persist_actor_identity(
            "alice",
            runtime_pair.native.actor_identity_root,
            profile_env["PT_STATION_URL"],
            str(native_login["actorId"]),
            str(native_login["stationPeerId"]),
            fixture=ACTOR_IDENTITY_FIXTURES["alice"],
            station_accepted=native_login["stationAccepted"] is True,
        )
        require(
            seed_actor_identity(
                "alice",
                runtime_pair.browser.actor_identity_root,
                profile_env["PT_STATION_URL"],
                fixture=ACTOR_IDENTITY_FIXTURES["alice"],
            ),
            "J06 Browser identity could not reuse the enrolled Native identity",
        )
        runtime_pair.browser.start()
        browser_login = authenticate_client(
            runtime_pair.browser,
            account=ACTOR_ACCOUNTS["alice"],
            password=profile_env["CHAT_NATIVE_DEMO_PASSWORD"],
            ensure_provider=provider_info,
        )
        logins = {
            "desktop_app": native_login,
            "browser": browser_login,
        }
        actors = {
            platform: str(login["actorId"])
            for platform, login in logins.items()
        }
        require(
            len(set(actors.values())) == 1,
            "J06 Native and Browser clients authenticated different actors",
        )
        self.actor_identity_hash = _hash_text(actors["desktop_app"])

    def _client(
        self,
        runtime_tuple: AgentV2RuntimeTuple,
    ) -> FoundationRuntimeClient:
        if runtime_tuple.platform == "desktop_app":
            return self._runtime_pair.native
        if runtime_tuple.platform == "browser":
            return self._runtime_pair.browser
        raise EvaluationCandidateError(
            f"J06 runtime adapter rejects platform {runtime_tuple.platform}"
        )

    def _payload(
        self,
        runtime_tuple: AgentV2RuntimeTuple,
        scenario_execution_id: str,
    ) -> dict[str, Any]:
        return {
            "runId": self._run_id,
            "scenarioExecutionId": scenario_execution_id,
            "cell": runtime_tuple.cell,
            "platform": runtime_tuple.platform,
            "locale": runtime_tuple.locale,
            "ordering": runtime_tuple.ordering,
            "sampleId": runtime_tuple.sample_id,
            "providerBaseUrl": self._provider_base_url,
            "providerApiKey": self._provider_fixture.api_key,
        }

    def _observe_restart(
        self,
        runtime_tuple: AgentV2RuntimeTuple,
        client: FoundationRuntimeClient,
        payload: Mapping[str, Any],
    ) -> dict[str, Any]:
        state: dict[str, Any] | None = None
        restarted = False
        try:
            prepared = _mapping(
                client.harness(
                    "runEvaluationScenario",
                    {**payload, "phase": "prepare"},
                    timeout=1_200,
                ),
                f"{runtime_tuple.key} restart preparation",
            )
            state = _mapping(
                prepared.get("state"),
                f"{runtime_tuple.key} restart state",
            )
            station_restart = restart_foundation_station(
                self._runtime_manifest,
                repo_root=ROOT,
            )
            restarted = True
            client.restart()
            login = authenticate_client(
                client,
                account=ACTOR_ACCOUNTS["alice"],
                password=self._profile_env["CHAT_NATIVE_DEMO_PASSWORD"],
                ensure_provider={
                    "providerId": f"mca-j06-candidate-{self._run_id[:12]}",
                    "apiKey": self._provider_fixture.api_key,
                    "modelId": f"model-j06-{self._run_id[:12]}",
                    "baseUrl": self._provider_base_url,
                },
            )
            require(
                _hash_text(str(login["actorId"])) == self.actor_identity_hash,
                f"{runtime_tuple.key}: actor identity changed after restart",
            )
            return _mapping(
                client.harness(
                    "runEvaluationScenario",
                    {
                        **payload,
                        "phase": "recover",
                        "state": state,
                        "stationRestart": station_restart,
                    },
                    timeout=1_200,
                ),
                f"{runtime_tuple.key} restart capture",
            )
        except BaseException as error:
            cleanup_error: BaseException | None = None
            if state is not None:
                fallback = (
                    self._runtime_pair.browser
                    if client is self._runtime_pair.native
                    else self._runtime_pair.native
                )
                try:
                    fallback.harness(
                        "runEvaluationScenario",
                        {
                            **payload,
                            "phase": "cleanup",
                            "state": state,
                            "staleScenarioExpected": restarted,
                        },
                        timeout=300,
                    )
                except BaseException as candidate_cleanup_error:
                    cleanup_error = candidate_cleanup_error
            if cleanup_error is not None:
                raise EvaluationCandidateError(
                    f"AS-14 primary failure: {error}; "
                    f"cleanup failure: {cleanup_error}"
                ) from error
            raise

    def observe(
        self,
        runtime_tuple: AgentV2RuntimeTuple,
    ) -> AgentV2TupleObservation:
        _validate_runtime_tuple_policy(runtime_tuple)
        self._provider_fixture.reset_scenario()
        request_count_before = len(self._provider_fixture.snapshot())
        scenario_execution_id = str(uuid.uuid4())
        client = self._client(runtime_tuple)
        payload = self._payload(runtime_tuple, scenario_execution_id)
        if runtime_tuple.cell == "AS-14":
            capture = self._observe_restart(runtime_tuple, client, payload)
        else:
            capture = _mapping(
                client.harness(
                    "runEvaluationScenario",
                    {**payload, "phase": "execute"},
                    timeout=1_200,
                ),
                f"{runtime_tuple.key} Harness capture",
            )
        assertions = _mapping(capture.get("assertions"), "J06 assertions")
        failed = sorted(
            name for name, value in assertions.items() if value is not True
        )
        require(
            bool(assertions) and not failed,
            f"{runtime_tuple.key}: J06 Harness assertions failed: "
            f"{failed or ['missing']}",
        )
        runtime = _mapping(
            capture.get("runtimeAttestation"),
            "J06 runtime attestation",
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
            for role, payload in _mapping(capture.get("roles"), "J06 roles").items()
        }
        require(
            set(roles) == runtime_tuple.role_policy.adapter_roles,
            f"{runtime_tuple.key}: J06 role applicability mismatch",
        )
        requests = self._provider_fixture.snapshot()[request_count_before:]
        if _is_control_plane_tuple(runtime_tuple):
            require(
                not requests,
                f"{runtime_tuple.key}: control-plane rejection invoked provider",
            )
        else:
            require(
                requests
                and all(
                    request.get("authorizationPresent") is True
                    for request in requests
                ),
                f"{runtime_tuple.key}: Evaluation provider path was not observed",
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


class EvaluationMobileAdapter:
    """Run the source-bound Mobile Evaluation contract tuple."""

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
        _validate_runtime_tuple_policy(runtime_tuple)
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
            f"{runtime_tuple.key}: Mobile marker is missing or failed",
        )
        source_hashes = _source_hashes(MOBILE_SOURCE_PATHS)
        contract_hash = _combined_hash(source_hashes)
        execution_id = str(uuid.uuid4())
        observed_at = self._now().isoformat(timespec="microseconds")
        roles = {
            "cell-results": {
                "cellId": runtime_tuple.cell,
                "status": "passed",
                "expected": "generated Evaluation contracts round-trip",
                "actual": contract_hash,
            },
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
                        "contractRunId": f"evaluation-mobile-{execution_id}",
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


class EvaluationCandidateProducer:
    def __init__(
        self,
        runtime_adapter: EvaluationRuntimeAdapter,
        mobile_adapter: EvaluationMobileAdapter,
    ) -> None:
        self.assembler = AgentV2CandidateAssembler(AGENT_V2_EVALUATION_GATE)
        self.runtime_adapter = runtime_adapter
        self.mobile_adapter = mobile_adapter

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
                observation = (
                    self.mobile_adapter.observe(runtime_tuple)
                    if runtime_tuple.runtime_attestation_profile == "contract_only"
                    else self.runtime_adapter.observe(runtime_tuple)
                )
            except BaseException as error:
                raise EvaluationCandidateError(
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
            len(collected) == 57
            and len({observation.tuple_key for _, observation in collected})
            == 57,
            "J06 candidate observations are incomplete",
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
        / "evaluation-candidate"
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
        "J06 candidate Station deployment failed: "
        + (completed.stderr.strip() or completed.stdout.strip() or "no output")[
            -4_000:
        ],
    )
    _reset_capability_state(profile_env)


def _station_is_healthy(url: str) -> bool:
    try:
        return subprocess.run(
            ["curl", "-sf", "--connect-timeout", "5", url],
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        ).returncode == 0
    except subprocess.TimeoutExpired:
        return False


def _environment_repository(environment: Mapping[str, str]) -> Path:
    configured = environment.get("PT_ENV_REPO", "").strip()
    return (
        Path(configured).expanduser().resolve()
        if configured
        else (ROOT.parent / "env").resolve()
    )


def _reset_capability_state(profile_env: Mapping[str, str]) -> None:
    """Clear device enrollment and capability leases before a fresh candidate run."""
    deploy_env_name = profile_env.get("PT_STATION_DEPLOY_ENV", "").strip()
    require(bool(deploy_env_name), "J06 deployment environment is missing")
    env_repo = _environment_repository(os.environ)
    require(env_repo.is_dir(), f"J06 environment repository is unavailable: {env_repo}")
    deploy_env_file = (
        env_repo / "peers-touch" / PROFILE / "deploy"
        / f"{deploy_env_name}.env.example"
    )
    require(
        deploy_env_file.is_file(),
        f"J06 deployment environment file is unavailable: {deploy_env_file}",
    )
    deploy_vars: dict[str, str] = {}
    for line in deploy_env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            deploy_vars[key.strip()] = value.strip().strip("'\"")
    host = deploy_vars.get("PT_DEPLOY_HOST", "").strip()
    user = deploy_vars.get("PT_DEPLOY_USER", "").strip()
    require(bool(host and user), "J06 deployment host identity is missing")
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
    completed = subprocess.run(
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
    require(
        completed.returncode == 0,
        "J06 capability state reset failed: "
        + (completed.stderr.strip() or completed.stdout.strip() or "no output")[
            -2_000:
        ],
    )
    time.sleep(5)


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
    require(profile_name == PROFILE, "J06 candidate requires Profile two")
    require(
        bool(profile_env.get("CHAT_NATIVE_DEMO_PASSWORD")),
        "Profile two has no J06 actor credential",
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
        AGENT_V2_EVALUATION_GATE,
        source=source_identity(ROOT),
        run_id=requested_run_id or None,
    )
    os.environ["PT_ACCEPTANCE_WORKSPACE_ID"] = store.workspace_id
    os.environ["PT_ACCEPTANCE_GATE_ID"] = AGENT_V2_EVALUATION_GATE
    os.environ["PT_ACCEPTANCE_RUN_ID"] = run.run_id
    station_healthy = _station_is_healthy(
        profile_env.get("PT_STATION_HEALTH_URL", "")
    )
    if station_healthy:
        _reset_capability_state(profile_env)
    _deploy_acceptance_station(profile_env, run.run_id)
    _kill_stale_desktop_processes(slot)
    for fixture_path in ACTOR_IDENTITY_FIXTURES.values():
        if fixture_path.exists():
            shutil.rmtree(fixture_path)

    provisioner = HomeStationProvisioner(
        EnvironmentContract.from_yaml(ENVIRONMENTS_DIR / "home-station.yaml")
    )
    provisioner._resolve_active_profile = lambda: (
        profile_name,
        profile_file,
        slot,
        dict(profile_env),
    )
    provider_fixture: EvaluationProviderFixture | None = None
    provider_bridge = RemoteProviderBridge(
        profile_env["PT_STATION_DEPLOY_ENV"],
        artifact_prefix="mca-j06-candidate-provider",
    )
    runtime_pair: FoundationRuntimePair | None = None
    observations: tuple[
        tuple[AgentV2RuntimeTuple, AgentV2TupleObservation],
        ...,
    ] | None = None
    primary_error: BaseException | None = None
    run_closed = False
    try:
        manifest = provisioner.provision(AGENT_V2_EVALUATION_GATE)
        require(
            manifest.state.value == "FIXTURE_READY",
            "J06 provisioning blocked: "
            f"{manifest.blocked_reason or manifest.state.value}",
        )
        provider_fixture = EvaluationProviderFixture()
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
        observations = EvaluationCandidateProducer(
            EvaluationRuntimeAdapter(
                runtime_pair,
                profile_env,
                run.run_id,
                provider_fixture,
                provider_base_url,
                manifest.to_dict(),
            ),
            EvaluationMobileAdapter(),
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
            if provider_fixture is not None:
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
                raise EvaluationCandidateError(
                    f"primary failure: {primary_error}; "
                    f"cleanup failures: {cleanup_summary}"
                ) from primary_error
            raise EvaluationCandidateError(cleanup_summary)
    if primary_error is not None:
        run.close()
        run_closed = True
        raise primary_error
    require(observations is not None, "J06 candidate produced no observations")
    try:
        assembler = AgentV2CandidateAssembler(AGENT_V2_EVALUATION_GATE)
        candidate_path = assembler.produce(
            run,
            observations,
            candidate_name="evaluation-candidate",
        )
        acceptance_run = _load_script(
            ROOT / "tooling/scripts/acceptance-run.py",
            "_evaluation_candidate_acceptance_run",
        )
        acceptance_run.emit_agent_v2_candidate_metadata(
            run,
            AGENT_V2_EVALUATION_GATE,
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
            "_evaluation_candidate_validator",
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
