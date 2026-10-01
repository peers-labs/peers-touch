#!/usr/bin/env python3
"""Produce the exact-source 41-tuple J04 MCP lifecycle candidate."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
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
    load_preprovisioned_runtime_manifest,
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
    OpenAIProviderFixture,
    RemoteProviderBridge,
)
from tooling.acceptance.gates.agent.mcp_lifecycle_development import (
    MCP_FIXTURE_SCRIPT,
    MCP_RESULT_TEXT,
    MCP_TOOL_NAME,
)
from tooling.acceptance.provisioners.home_station import (
    AGENT_V2_MCP_GATE,
    HomeStationProvisioner,
)


PROFILE = "two"
WORK_ITEM_ID = "MCA-A05-PR112"
MOBILE_TEST_PATH = Path("apps/mobile/src/contracts/agentV2Contract.test.ts")
MOBILE_SOURCE_PATHS = (
    MOBILE_TEST_PATH,
    Path("apps/mobile/src/gen/proto/domain/agent/agent_pb.ts"),
    Path("apps/mobile/src/gen/proto/domain/agent/capability_pb.ts"),
)
MOBILE_MARKERS = {
    "AS-04-UNAVAILABLE": "[foundation-mobile-cell:AS-15-P11]",
    "AS-15-V2-M01": "[foundation-mobile-cell:AS-15-P11]",
    "TAX-04": "[binding-mobile-cell:TAX-04]",
}


class McpLifecycleCandidateError(RuntimeError):
    """J04 observations cannot form a runtime-truthful candidate."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise McpLifecycleCandidateError(message)


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


def _process_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _port_open(port: int) -> bool:
    if port <= 0 or port > 65535:
        return False
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.2)
        return probe.connect_ex(("127.0.0.1", port)) == 0


def inspect_candidate_fixture(
    fixture_root: Path,
    *,
    expected_secret_digest: str,
) -> dict[str, Any]:
    launch_path = fixture_root / "launch-count"
    side_effect_path = fixture_root / "side-effect-count"
    secret_path = fixture_root / "secret-sha256"
    launch_count = (
        int(launch_path.read_text(encoding="utf-8").strip())
        if launch_path.is_file()
        else 0
    )
    side_effect_count = (
        int(side_effect_path.read_text(encoding="utf-8").strip())
        if side_effect_path.is_file()
        else 0
    )
    observed_secret_digest = (
        secret_path.read_text(encoding="utf-8").strip()
        if secret_path.is_file()
        else ""
    )
    processes = []
    for path in sorted(fixture_root.glob("process-*.json")):
        value = json.loads(path.read_text(encoding="utf-8"))
        require(isinstance(value, dict), f"{path.name} must be an object")
        pid = int(value.get("pid") or 0)
        port = int(value.get("port") or 0)
        processes.append(
            {
                "launch": int(value.get("launch") or 0),
                "pid": pid,
                "port": port,
                "alive": _process_alive(pid),
                "portOpen": _port_open(port),
            }
        )
    return {
        "launchCount": launch_count,
        "sideEffectCount": side_effect_count,
        "secretDigestMatched": observed_secret_digest == expected_secret_digest,
        "processes": processes,
        "liveProcessCount": sum(
            process["alive"] is True for process in processes
        ),
        "openPortCount": sum(
            process["portOpen"] is True for process in processes
        ),
    }


def _validate_role_set(
    runtime_tuple: AgentV2RuntimeTuple,
    roles: Mapping[str, Any],
) -> None:
    require(
        set(roles) == runtime_tuple.role_policy.adapter_roles,
        f"{runtime_tuple.key}: J04 role applicability mismatch",
    )


class McpLifecycleRuntimeAdapter:
    """Execute fresh Desktop and Browser J04 tuple observations."""

    def __init__(
        self,
        runtime_pair: FoundationRuntimePair,
        profile_env: Mapping[str, str],
        run_id: str,
        provider_fixture: OpenAIProviderFixture,
        provider_base_url: str,
    ) -> None:
        self._runtime_pair = runtime_pair
        self._profile_env = dict(profile_env)
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
            "J04 Native and Browser clients authenticated different actors",
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

    def _client(
        self,
        runtime_tuple: AgentV2RuntimeTuple,
    ) -> FoundationRuntimeClient:
        if runtime_tuple.platform == "desktop_app":
            return self._runtime_pair.native
        if runtime_tuple.platform == "browser":
            return self._runtime_pair.browser
        raise McpLifecycleCandidateError(
            f"J04 runtime adapter rejects platform {runtime_tuple.platform}"
        )

    def _observe_browser(
        self,
        runtime_tuple: AgentV2RuntimeTuple,
    ) -> AgentV2TupleObservation:
        capture = _mapping(
            self._client(runtime_tuple).harness(
                "runMcpLifecycleScenario",
                {
                    "runId": self._run_id,
                    "scenarioExecutionId": str(uuid.uuid4()),
                    "cell": runtime_tuple.cell,
                    "platform": runtime_tuple.platform,
                    "locale": runtime_tuple.locale,
                    "ordering": runtime_tuple.ordering,
                    "sampleId": runtime_tuple.sample_id,
                    "serverName": (
                        f"mca-j04-unavailable-{uuid.uuid4().hex[:16]}"
                    ),
                },
                timeout=300,
            ),
            f"{runtime_tuple.key} Browser Harness capture",
        )
        roles = {
            role: _mapping(payload, f"{runtime_tuple.key} {role}")
            for role, payload in _mapping(
                capture.get("roles"),
                "J04 Browser roles",
            ).items()
        }
        roles["process-port-secret-canary"] = {
            "processCount": 0,
            "portCount": 0,
            "secretLeakCount": 0,
            "passed": True,
        }
        _validate_role_set(runtime_tuple, roles)
        runtime = _mapping(
            capture.get("runtimeAttestation"),
            "J04 Browser runtime attestation",
        )
        require(
            runtime.get("scenarioExecutionId"),
            f"{runtime_tuple.key}: Browser scenario execution ID is missing",
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

    def _observe_desktop(
        self,
        runtime_tuple: AgentV2RuntimeTuple,
    ) -> AgentV2TupleObservation:
        authenticate_native_client(
            self._runtime_pair.native,
            self._profile_env,
            profile=PROFILE,
            account=OPERATION_SCENARIO_ACTOR_ACCOUNT,
        )
        fixture_root = Path(tempfile.mkdtemp(prefix="mca-j04-candidate-"))
        fixture_script = fixture_root / "server.py"
        fixture_script.write_text(MCP_FIXTURE_SCRIPT + "\n", encoding="utf-8")
        fixture_script.chmod(0o700)
        secret_canary = f"mca-j04-secret-{uuid.uuid4().hex}"
        secret_digest = hashlib.sha256(
            secret_canary.encode("utf-8")
        ).hexdigest()
        scenario_execution_id = str(uuid.uuid4())
        server_name = "mca-j04-candidate"
        request_count_before = len(self._provider_fixture.snapshot())
        try:
            try:
                capture = _mapping(
                    self._client(runtime_tuple).harness(
                        "runMcpLifecycleScenario",
                        {
                            "runId": self._run_id,
                            "scenarioExecutionId": scenario_execution_id,
                            "cell": runtime_tuple.cell,
                            "platform": runtime_tuple.platform,
                            "locale": runtime_tuple.locale,
                            "ordering": runtime_tuple.ordering,
                            "sampleId": runtime_tuple.sample_id,
                            "serverName": server_name,
                            "providerBaseUrl": self._provider_base_url,
                            "providerApiKey": self._provider_fixture.api_key,
                            "command": sys.executable,
                            "args": [str(fixture_script)],
                            "env": {
                                "MCA_J04_STATE_DIR": str(fixture_root),
                                "MCA_J04_SECRET_CANARY": secret_canary,
                                "MCA_J04_BLOCK_ON_LAUNCH": (
                                    "4,6"
                                    if runtime_tuple.cell == "R-04"
                                    else "4"
                                ),
                                "MCA_J04_TOOL_NAME": MCP_TOOL_NAME,
                                "MCA_J04_RESULT_TEXT": MCP_RESULT_TEXT,
                            },
                            "toolName": MCP_TOOL_NAME,
                            "expectedResult": MCP_RESULT_TEXT,
                        },
                        timeout=900,
                    ),
                    f"{runtime_tuple.key} Native Harness capture",
                )
            except BaseException as error:
                fixture = inspect_candidate_fixture(
                    fixture_root,
                    expected_secret_digest=secret_digest,
                )
                requests = self._provider_fixture.snapshot()[
                    request_count_before:
                ]
                log_path = self._client(runtime_tuple).log_path
                log_tail = ""
                if log_path.is_file():
                    log_tail = log_path.read_text(
                        encoding="utf-8",
                        errors="replace",
                    )[-8_000:].replace(secret_canary, "[REDACTED]")
                raise McpLifecycleCandidateError(
                    f"{runtime_tuple.key}: Native Harness failed: {error}; "
                    f"providerRequests={json.dumps(requests, sort_keys=True)}; "
                    f"fixture={json.dumps(fixture, sort_keys=True)}; "
                    f"nativeLogTail={log_tail}"
                ) from error
            fixture = inspect_candidate_fixture(
                fixture_root,
                expected_secret_digest=secret_digest,
            )
            leaked = secret_canary in json.dumps(capture, sort_keys=True)
            require(
                fixture["liveProcessCount"] == 0,
                f"{runtime_tuple.key}: MCP process residue remained",
            )
            require(
                fixture["openPortCount"] == 0,
                f"{runtime_tuple.key}: MCP port residue remained",
            )
            require(
                fixture["secretDigestMatched"] is True and not leaked,
                f"{runtime_tuple.key}: MCP secret canary evidence failed",
            )
            requests = self._provider_fixture.snapshot()[
                request_count_before:
            ]
            require(
                len(requests) == 2
                and all(
                    request.get("authorizationPresent") is True
                    for request in requests
                ),
                f"{runtime_tuple.key}: provider invocation was not authentic",
            )
            roles = {
                role: _mapping(payload, f"{runtime_tuple.key} {role}")
                for role, payload in _mapping(
                    capture.get("roles"),
                    "J04 Native roles",
                ).items()
            }
            roles["process-port-secret-canary"] = {
                "processCount": fixture["liveProcessCount"],
                "portCount": fixture["openPortCount"],
                "secretLeakCount": int(leaked),
                "passed": (
                    fixture["liveProcessCount"] == 0
                    and fixture["openPortCount"] == 0
                    and fixture["secretDigestMatched"] is True
                    and not leaked
                ),
                "launchCount": fixture["launchCount"],
            }
            _validate_role_set(runtime_tuple, roles)
            runtime = _mapping(
                capture.get("runtimeAttestation"),
                "J04 Native runtime attestation",
            )
            require(
                runtime.get("scenarioExecutionId") == scenario_execution_id,
                f"{runtime_tuple.key}: scenario execution identity changed",
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
        finally:
            shutil.rmtree(fixture_root, ignore_errors=True)

    def observe(
        self,
        runtime_tuple: AgentV2RuntimeTuple,
    ) -> AgentV2TupleObservation:
        if runtime_tuple.runtime_attestation_profile == "unavailable_runtime":
            return self._observe_browser(runtime_tuple)
        return self._observe_desktop(runtime_tuple)


class McpLifecycleMobileAdapter:
    """Run one source-bound contract process for each Mobile J04 tuple."""

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
        marker = MOBILE_MARKERS.get(runtime_tuple.cell)
        require(
            marker is not None,
            f"{runtime_tuple.key}: no reviewed Mobile MCP contract marker",
        )
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
                "assertionMarker": marker,
                "sourceFiles": [
                    {"path": path, "sha256": digest}
                    for path, digest in source_hashes.items()
                ],
            },
            "zero-execution": {
                "counterKind": "mobile-local-mcp-execution",
                "count": 0,
                "expected": 0,
            },
            "cleanup": {
                "resourceKind": "mobile-contract-test-process",
                "resourceIdHash": _hash_text(" ".join(command)),
                "status": "clean",
            },
        }
        _validate_role_set(runtime_tuple, roles)
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
                        "contractRunId": f"mcp-mobile-{execution_id}",
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


class McpLifecycleCandidateProducer:
    def __init__(
        self,
        runtime_adapter: McpLifecycleRuntimeAdapter,
        mobile_adapter: McpLifecycleMobileAdapter,
    ) -> None:
        self.assembler = AgentV2CandidateAssembler(AGENT_V2_MCP_GATE)
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
                raise McpLifecycleCandidateError(
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
            len(collected) == 41
            and len({observation.tuple_key for _, observation in collected})
            == 41,
            "J04 candidate observations are incomplete",
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
        / "mcp-lifecycle-candidate"
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
        "J04 candidate Station deployment failed: "
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
    require(profile_name == PROFILE, "J04 candidate requires Profile two")
    require(
        bool(profile_env.get("CHAT_NATIVE_DEMO_PASSWORD")),
        "Profile two has no J04 actor credential",
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
        AGENT_V2_MCP_GATE,
        source=source_identity(ROOT),
        run_id=requested_run_id or None,
    )
    os.environ["PT_ACCEPTANCE_WORKSPACE_ID"] = store.workspace_id
    os.environ["PT_ACCEPTANCE_GATE_ID"] = AGENT_V2_MCP_GATE
    os.environ["PT_ACCEPTANCE_RUN_ID"] = run.run_id
    runtime_manifest = load_preprovisioned_runtime_manifest(
        AGENT_V2_MCP_GATE,
        repo_root=ROOT,
    )
    provisioner: HomeStationProvisioner | None = None
    if runtime_manifest is None:
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
    provider_fixture = OpenAIProviderFixture(
        tool_name="local_mcp",
        tool_arguments={
            "server_name": "mca-j04-candidate",
            "tool_name": MCP_TOOL_NAME,
            "arguments": {"sample": "mca-v2-j04"},
        },
        expected_tool_result=MCP_RESULT_TEXT,
        terminal_content="MCP invocation completed.",
        thread_name="mca-j04-candidate-provider-fixture",
    )
    provider_bridge = RemoteProviderBridge(
        profile_env["PT_STATION_DEPLOY_ENV"],
        artifact_prefix="mca-j04-candidate-provider",
    )
    runtime_pair: FoundationRuntimePair | None = None
    observations: tuple[
        tuple[AgentV2RuntimeTuple, AgentV2TupleObservation],
        ...,
    ] | None = None
    primary_error: BaseException | None = None
    run_closed = False
    try:
        if runtime_manifest is None:
            assert provisioner is not None
            manifest = provisioner.provision(AGENT_V2_MCP_GATE)
            require(
                manifest.state.value == "FIXTURE_READY",
                "J04 provisioning blocked: "
                f"{manifest.blocked_reason or manifest.state.value}",
            )
            runtime_manifest = manifest.to_dict()
        provider_fixture.start()
        provider_base_url = provider_bridge.start(
            provider_fixture.port,
            run.run_id,
        )
        runtime_pair = FoundationRuntimePair.from_manifest(
            _build_client_manifest(runtime_manifest),
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
        observations = McpLifecycleCandidateProducer(
            McpLifecycleRuntimeAdapter(
                runtime_pair,
                profile_env,
                run.run_id,
                provider_fixture,
                provider_base_url,
            ),
            McpLifecycleMobileAdapter(),
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
        if provisioner is not None:
            try:
                provisioner.cleanup()
            except BaseException as error:
                cleanup_failures.append(f"provisioner cleanup failed: {error}")
        if cleanup_failures:
            run.close()
            run_closed = True
            cleanup_summary = "; ".join(cleanup_failures)
            if primary_error is not None:
                raise McpLifecycleCandidateError(
                    f"primary failure: {primary_error}; "
                    f"cleanup failures: {cleanup_summary}"
                ) from primary_error
            raise McpLifecycleCandidateError(cleanup_summary)
    if primary_error is not None:
        run.close()
        run_closed = True
        raise primary_error
    require(observations is not None, "J04 candidate produced no observations")
    try:
        assembler = AgentV2CandidateAssembler(AGENT_V2_MCP_GATE)
        candidate_path = assembler.produce(
            run,
            observations,
            candidate_name="mcp-lifecycle-candidate",
        )
        acceptance_run = _load_script(
            ROOT / "tooling/scripts/acceptance-run.py",
            "_mcp_lifecycle_candidate_acceptance_run",
        )
        acceptance_run.emit_agent_v2_candidate_metadata(
            run,
            AGENT_V2_MCP_GATE,
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
            "_mcp_lifecycle_candidate_validator",
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
