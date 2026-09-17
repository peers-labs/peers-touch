#!/usr/bin/env python3
"""Run the focused V2-J04 MCP lifecycle Development Journey."""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import traceback
from collections.abc import Mapping
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
from tooling.acceptance.gates.agent.capability_binding_development import (
    J02_ACTOR_ACCOUNT,
    J02_IDENTITY_FIXTURE,
    authenticate_native_client,
    copy_native_runtime_logs,
    identity_fixture_evidence,
    persist_native_actor_identity,
    resolve_machine_profile,
    seed_native_actor_identity,
)
from tooling.acceptance.gates.agent.foundation_runtime_client import (
    FoundationClientSpec,
    FoundationRuntimeClient,
)
from tooling.acceptance.gates.agent.governed_tool_development import (
    OpenAIProviderFixture,
    RemoteProviderBridge,
)
from tooling.acceptance.provisioners.home_station import (
    AGENT_V2_MCP_GATE,
    HomeStationProvisioner,
)


WORKSPACE_ID = workspace_id(ROOT)
WORK_ITEM_ID = "MCA-V2-ALIGNMENT-J04"
JOURNEY_ID = "V2-J04"
PROFILE = "two"
MCP_TOOL_NAME = "fixture_echo"
MCP_RESULT_TEXT = "mca-j04-mcp-result"
MCP_BLOCK_ON_LAUNCH = 4

MCP_FIXTURE_SCRIPT = r"""
import fcntl
import hashlib
import json
import os
import socket
import sys
import time
from pathlib import Path

state_dir = Path(os.environ["MCA_J04_STATE_DIR"])
state_dir.mkdir(parents=True, exist_ok=True)
secret = os.environ["MCA_J04_SECRET_CANARY"]
tool_name = os.environ["MCA_J04_TOOL_NAME"]
result_text = os.environ["MCA_J04_RESULT_TEXT"]
block_on_launch = int(os.environ["MCA_J04_BLOCK_ON_LAUNCH"])

def atomic_write(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(value, encoding="utf-8")
    os.replace(temporary, path)

def increment(name):
    lock_path = state_dir / "state.lock"
    with lock_path.open("a+", encoding="utf-8") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        path = state_dir / name
        current = int(path.read_text(encoding="utf-8")) if path.exists() else 0
        current += 1
        atomic_write(path, str(current))
        fcntl.flock(lock.fileno(), fcntl.LOCK_UN)
        return current

def read_frame():
    content_length = None
    while True:
        line = sys.stdin.buffer.readline()
        if not line:
            return None
        header = line.rstrip(b"\r\n")
        if not header:
            break
        if header.lower().startswith(b"content-length:"):
            content_length = int(header.split(b":", 1)[1].strip())
    if content_length is None or content_length > 8 * 1024 * 1024:
        raise RuntimeError("invalid MCP frame")
    return json.loads(sys.stdin.buffer.read(content_length))

def write_frame(value):
    body = json.dumps(value, separators=(",", ":"), sort_keys=True).encode()
    sys.stdout.buffer.write(
        f"Content-Length: {len(body)}\r\n\r\n".encode() + body
    )
    sys.stdout.buffer.flush()

launch = increment("launch-count")
listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
listener.bind(("127.0.0.1", 0))
listener.listen(1)
port = int(listener.getsockname()[1])
atomic_write(
    state_dir / f"process-{launch}.json",
    json.dumps({"launch": launch, "pid": os.getpid(), "port": port}),
)
atomic_write(
    state_dir / "secret-sha256",
    hashlib.sha256(secret.encode()).hexdigest(),
)

while True:
    request = read_frame()
    if request is None:
        break
    request_id = request.get("id")
    method = request.get("method")
    if method == "initialize":
        write_frame({
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "mca-j04-fixture", "version": "1"},
            },
        })
    elif method == "notifications/initialized":
        continue
    elif method == "tools/list":
        if launch == block_on_launch:
            atomic_write(
                state_dir / "blocked-process.json",
                json.dumps({"launch": launch, "pid": os.getpid(), "port": port}),
            )
            while True:
                time.sleep(1)
        write_frame({
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "tools": [{
                    "name": tool_name,
                    "description": "Return the deterministic J04 fixture result",
                    "inputSchema": {
                        "type": "object",
                        "properties": {"sample": {"type": "string"}},
                    },
                }],
            },
        })
    elif method == "tools/call":
        params = request.get("params") or {}
        if params.get("name") != tool_name:
            write_frame({
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {"code": -32602, "message": "unknown tool"},
            })
            continue
        side_effect_count = increment("side-effect-count")
        write_frame({
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "content": [{
                    "type": "text",
                    "text": result_text,
                }],
                "isError": False,
                "sideEffectCount": side_effect_count,
            },
        })
    elif request_id is not None:
        write_frame({
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {"code": -32601, "message": "method not found"},
        })
""".strip()


class McpLifecycleDevelopmentError(RuntimeError):
    """The V2-J04 Development Journey failed."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise McpLifecycleDevelopmentError(message)


def require_mapping(value: object, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise McpLifecycleDevelopmentError(f"{label} must be an object")
    return value


def _read_int(path: Path) -> int:
    try:
        return int(path.read_text(encoding="utf-8").strip())
    except (OSError, ValueError) as error:
        raise McpLifecycleDevelopmentError(
            f"invalid MCP fixture counter {path.name}: {error}"
        ) from error


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise McpLifecycleDevelopmentError(
            f"invalid MCP fixture state {path.name}: {error}"
        ) from error
    if not isinstance(value, dict):
        raise McpLifecycleDevelopmentError(
            f"MCP fixture state {path.name} must be an object"
        )
    return value


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


def inspect_mcp_fixture(
    fixture_root: Path,
    *,
    expected_secret_digest: str,
    expected_launch_count: int,
) -> dict[str, Any]:
    launch_count = _read_int(fixture_root / "launch-count")
    side_effect_count = _read_int(fixture_root / "side-effect-count")
    blocked = _read_json(fixture_root / "blocked-process.json")
    observed_secret_digest = (
        fixture_root / "secret-sha256"
    ).read_text(encoding="utf-8").strip()
    process_states = []
    for path in sorted(fixture_root.glob("process-*.json")):
        process = _read_json(path)
        pid = int(process.get("pid") or 0)
        port = int(process.get("port") or 0)
        process_states.append(
            {
                "launch": int(process.get("launch") or 0),
                "pid": pid,
                "port": port,
                "alive": _process_alive(pid),
                "portOpen": _port_open(port),
            }
        )
    blocked_pid = int(blocked.get("pid") or 0)
    blocked_port = int(blocked.get("port") or 0)
    return {
        "launchCount": launch_count,
        "expectedLaunchCount": expected_launch_count,
        "sideEffectCount": side_effect_count,
        "secretDigestMatched": observed_secret_digest == expected_secret_digest,
        "blockedProcess": {
            "launch": int(blocked.get("launch") or 0),
            "pid": blocked_pid,
            "port": blocked_port,
            "alive": _process_alive(blocked_pid),
            "portOpen": _port_open(blocked_port),
        },
        "processes": process_states,
        "allProcessesReaped": all(
            process["alive"] is False for process in process_states
        ),
        "allPortsReleased": all(
            process["portOpen"] is False for process in process_states
        ),
    }


def evaluate_mcp_lifecycle(
    prepared: Mapping[str, Any],
    recovered: Mapping[str, Any],
    provider_requests: list[dict[str, Any]],
    process_evidence: Mapping[str, Any],
    *,
    canary_leaked: bool,
) -> dict[str, bool]:
    prepare_assertions = require_mapping(
        prepared.get("assertions"),
        "prepare assertions",
    )
    recovery_assertions = require_mapping(
        recovered.get("assertions"),
        "recovery assertions",
    )
    cleanup = require_mapping(recovered.get("cleanup"), "recovery cleanup")
    first = provider_requests[0] if len(provider_requests) > 0 else {}
    continuation = provider_requests[1] if len(provider_requests) > 1 else {}
    assertions = {
        "prepareHarnessPassed": (
            bool(prepare_assertions)
            and all(value is True for value in prepare_assertions.values())
        ),
        "recoveryHarnessPassed": (
            bool(recovery_assertions)
            and all(value is True for value in recovery_assertions.values())
        ),
        "deterministicMcpProviderSequence": (
            len(provider_requests) == 2
            and first.get("stream") is True
            and first.get("authorizationPresent") is True
            and first.get("hasToolResult") is False
            and "local_mcp" in first.get("toolNames", [])
            and continuation.get("stream") is True
            and continuation.get("authorizationPresent") is True
            and continuation.get("hasToolResult") is True
            and continuation.get("hasExpectedToolResult") is True
        ),
        "oneMcpSideEffect": process_evidence.get("sideEffectCount") == 1,
        "lifecycleLaunchesComplete": (
            process_evidence.get("launchCount")
            == process_evidence.get("expectedLaunchCount")
            == 6
        ),
        "cancelledProcessReaped": (
            isinstance(process_evidence.get("blockedProcess"), Mapping)
            and process_evidence["blockedProcess"].get("launch")
            == MCP_BLOCK_ON_LAUNCH
            and process_evidence["blockedProcess"].get("alive") is False
            and process_evidence["blockedProcess"].get("portOpen") is False
        ),
        "allMcpProcessesAndPortsReleased": (
            process_evidence.get("allProcessesReaped") is True
            and process_evidence.get("allPortsReleased") is True
        ),
        "secretCanaryProtected": (
            process_evidence.get("secretDigestMatched") is True
            and canary_leaked is False
        ),
        "productCleanupComplete": cleanup.get("status") == "clean",
    }
    failed = sorted(name for name, passed in assertions.items() if not passed)
    if failed:
        raise McpLifecycleDevelopmentError(
            "V2-J04 facts failed assertions: " + ", ".join(failed)
        )
    return assertions


def _client_from_manifest(
    manifest: Mapping[str, Any],
    profile_env: Mapping[str, str],
) -> FoundationRuntimeClient:
    services = manifest.get("services")
    station = services.get("station") if isinstance(services, Mapping) else None
    clients = manifest.get("clients")
    require(
        isinstance(station, Mapping) and bool(station.get("endpoint")),
        "J04 runtime manifest has no Station endpoint",
    )
    require(
        isinstance(clients, list) and len(clients) == 1,
        "J04 runtime manifest must contain exactly one Native client",
    )
    client = require_mapping(clients[0], "J04 Native client")
    require(
        client.get("runtime") == "native-tauri",
        "J04 runtime manifest client must be native-tauri",
    )
    return FoundationRuntimeClient(
        FoundationClientSpec.from_mapping(client),
        station_url=str(station["endpoint"]),
        profile_env=profile_env,
        startup_timeout=900,
    )


def _cleanup_client(client: FoundationRuntimeClient) -> dict[str, Any]:
    result = client.stop(remove_storage=False)
    shutil.rmtree(client.actor_identity_root, ignore_errors=True)
    result["actorIdentityReleased"] = not client.actor_identity_root.exists()
    if not result["actorIdentityReleased"]:
        result["status"] = "failed"
        result.setdefault("failures", []).append(
            "actor identity root remained present"
        )
    return result


def _canary_in_paths(canary: str, paths: list[Path]) -> bool:
    encoded = canary.encode("utf-8")
    for path in paths:
        if not path.is_file():
            continue
        try:
            if encoded in path.read_bytes():
                return True
        except OSError:
            return True
    return False


def main() -> int:
    started_at = time.monotonic()
    artifact_run_id = datetime.now(timezone.utc).strftime(
        "%Y%m%dT%H%M%S%fZ"
    )
    artifact_dir = (
        Path.home()
        / ".peers-touch"
        / "dev"
        / "workspaces"
        / WORKSPACE_ID
        / "workflow"
        / WORK_ITEM_ID
        / "artifacts"
        / artifact_run_id
    )
    artifact_dir.mkdir(parents=True, exist_ok=False)
    attestation_root = Path("/tmp") / f"mca-mcp-lifecycle-{artifact_run_id}"
    fixture_root = Path(tempfile.mkdtemp(prefix="mca-j04-mcp-"))
    fixture_script = fixture_root / "server.py"
    fixture_script.write_text(MCP_FIXTURE_SCRIPT + "\n", encoding="utf-8")
    fixture_script.chmod(0o700)
    secret_canary = f"mca-j04-secret-{secrets.token_urlsafe(32)}"
    secret_digest = hashlib.sha256(secret_canary.encode("utf-8")).hexdigest()
    server_name = f"mca-j04-{artifact_run_id.lower()}"

    os.environ["PT_ACCEPTANCE_ARTIFACT_ROOT"] = str(attestation_root)
    store = EvidenceStore(attestation_root, worktree=ROOT)
    attestation_run = store.begin_run(
        AGENT_V2_MCP_GATE,
        source=source_identity(ROOT),
    )
    os.environ["PT_ACCEPTANCE_WORKSPACE_ID"] = store.workspace_id
    os.environ["PT_ACCEPTANCE_GATE_ID"] = AGENT_V2_MCP_GATE
    os.environ["PT_ACCEPTANCE_RUN_ID"] = attestation_run.run_id
    os.environ["PT_ACCEPTANCE_APPROVED_PROFILE"] = PROFILE

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
    require(profile_name == PROFILE, "active profile is not Profile two")
    deployment_environment = profile_env.get("PT_STATION_DEPLOY_ENV", "")
    require(
        bool(deployment_environment),
        "Profile two has no Station deployment environment",
    )
    os.environ.update(profile_env)
    os.environ["PT_DEV_PROFILE"] = PROFILE

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
        tool_name="local_mcp",
        tool_arguments={
            "server_name": server_name,
            "tool_name": MCP_TOOL_NAME,
            "arguments": {"sample": "mca-v2-j04"},
        },
        expected_tool_result=MCP_RESULT_TEXT,
        terminal_content="MCP invocation completed.",
        thread_name="mca-j04-provider-fixture",
    )
    provider_bridge = RemoteProviderBridge(
        deployment_environment,
        artifact_prefix="mca-j04-provider",
    )
    runtime_client: FoundationRuntimeClient | None = None
    manifest = None
    prepared: dict[str, Any] = {}
    recovered: dict[str, Any] = {}
    process_evidence: dict[str, Any] = {}
    assertions: dict[str, bool] = {}
    primary_error: BaseException | None = None
    canary_leaked = False
    cleanup: dict[str, Any] = {
        "status": "clean",
        "client": None,
        "providerBridge": None,
        "providerFixtureStopped": False,
        "provisionerResourcesReleased": [],
        "fixtureStorageReleased": False,
        "harnessFallback": None,
        "failures": [],
    }
    harness_state: dict[str, Any] | None = None

    try:
        manifest = provisioner.provision(AGENT_V2_MCP_GATE)
        require(
            manifest.state.value == "FIXTURE_READY",
            (
                "J04 provisioning did not become ready: "
                f"{manifest.blocked_reason or manifest.state.value}"
            ),
        )
        provider_fixture.start()
        provider_base_url = provider_bridge.start(
            provider_fixture.port,
            artifact_run_id,
        )
        runtime_client = _client_from_manifest(
            manifest.to_dict(),
            profile_env,
        )
        seeded_identity = seed_native_actor_identity(
            fixture_root=J02_IDENTITY_FIXTURE,
            target_root=runtime_client.actor_identity_root,
            station_url=profile_env["PT_STATION_URL"],
        )
        runtime_client.start()
        login = authenticate_native_client(runtime_client, profile_env)
        identity_metadata = persist_native_actor_identity(
            source_root=runtime_client.actor_identity_root,
            fixture_root=J02_IDENTITY_FIXTURE,
            station_url=profile_env["PT_STATION_URL"],
            actor_id=str(login["actorId"]),
        )
        prepared_value = runtime_client.harness(
            "runMcpLifecycleDevelopment",
            {
                "phase": "prepare",
                "sampleId": f"mca-j04-{artifact_run_id}",
                "serverName": server_name,
                "providerBaseUrl": provider_base_url,
                "command": sys.executable,
                "args": [str(fixture_script)],
                "env": {
                    "MCA_J04_STATE_DIR": str(fixture_root),
                    "MCA_J04_SECRET_CANARY": secret_canary,
                    "MCA_J04_BLOCK_ON_LAUNCH": str(MCP_BLOCK_ON_LAUNCH),
                    "MCA_J04_TOOL_NAME": MCP_TOOL_NAME,
                    "MCA_J04_RESULT_TEXT": MCP_RESULT_TEXT,
                },
                "toolName": MCP_TOOL_NAME,
                "expectedResult": MCP_RESULT_TEXT,
            },
            timeout=900,
        )
        require(
            isinstance(prepared_value, Mapping),
            "V2-J04 prepare Harness returned invalid evidence",
        )
        prepared = dict(prepared_value)
        harness_state_value = prepared.get("state")
        require(
            isinstance(harness_state_value, Mapping),
            "V2-J04 prepare Harness omitted recovery state",
        )
        harness_state = dict(harness_state_value)
        pre_restart_process = inspect_mcp_fixture(
            fixture_root,
            expected_secret_digest=secret_digest,
            expected_launch_count=5,
        )
        require(
            pre_restart_process["launchCount"] == 5,
            "MCP fixture launch sequence before restart is incomplete",
        )

        runtime_client.restart()
        authenticate_native_client(runtime_client, profile_env)
        recovered_value = runtime_client.harness(
            "runMcpLifecycleDevelopment",
            {
                "phase": "recover",
                "sampleId": f"mca-j04-{artifact_run_id}",
                "serverName": server_name,
                "state": harness_state,
            },
            timeout=600,
        )
        require(
            isinstance(recovered_value, Mapping),
            "V2-J04 recovery Harness returned invalid evidence",
        )
        recovered = dict(recovered_value)
        process_evidence = inspect_mcp_fixture(
            fixture_root,
            expected_secret_digest=secret_digest,
            expected_launch_count=6,
        )
        provider_requests = provider_fixture.snapshot()
        capture_without_secret = {
            "identityFixture": identity_fixture_evidence(
                identity_metadata,
                reused=seeded_identity is not None,
            ),
            "prepared": prepared,
            "recovered": recovered,
            "providerFixture": {
                "requestCount": len(provider_requests),
                "requests": provider_requests,
                "tunnel": {
                    "reversePort": provider_bridge.reverse_port,
                    "bridgePort": provider_bridge.bridge_port,
                },
            },
            "processEvidence": process_evidence,
        }
        canary_leaked = secret_canary in json.dumps(
            capture_without_secret,
            sort_keys=True,
        )
        assertions = evaluate_mcp_lifecycle(
            prepared,
            recovered,
            provider_requests,
            process_evidence,
            canary_leaked=canary_leaked,
        )
    except BaseException as error:
        primary_error = error
    finally:
        if runtime_client is not None and harness_state is not None:
            recovered_cleanup = recovered.get("cleanup")
            if not (
                isinstance(recovered_cleanup, Mapping)
                and recovered_cleanup.get("status") == "clean"
            ):
                try:
                    fallback = runtime_client.harness(
                        "runMcpLifecycleDevelopment",
                        {
                            "phase": "cleanup",
                            "sampleId": f"mca-j04-{artifact_run_id}",
                            "serverName": server_name,
                            "state": harness_state,
                        },
                        timeout=300,
                    )
                    cleanup["harnessFallback"] = fallback
                    if (
                        not isinstance(fallback, Mapping)
                        or fallback.get("status") != "clean"
                    ):
                        cleanup["status"] = "failed"
                        cleanup["failures"].append(
                            "MCP Harness fallback cleanup failed"
                        )
                except BaseException as error:
                    cleanup["status"] = "failed"
                    cleanup["failures"].append(
                        "MCP Harness fallback cleanup: "
                        f"{type(error).__name__}: {error}"
                    )
        if runtime_client is not None:
            try:
                runtime_logs = copy_native_runtime_logs(
                    runtime_client,
                    artifact_dir,
                )
                cleanup["nativeRuntimeLogs"] = runtime_logs
                log_paths = [Path(path) for path in runtime_logs]
                log_paths.append(runtime_client.log_path)
                if _canary_in_paths(secret_canary, log_paths):
                    canary_leaked = True
                    cleanup["status"] = "failed"
                    cleanup["failures"].append(
                        "secret canary reached Native runtime logs"
                    )
            except BaseException as error:
                cleanup["status"] = "failed"
                cleanup["failures"].append(
                    "Native runtime log capture: "
                    f"{type(error).__name__}: {error}"
                )
            try:
                cleanup["client"] = _cleanup_client(runtime_client)
                if cleanup["client"].get("status") != "clean":
                    cleanup["status"] = "failed"
                    cleanup["failures"].append("client runtime cleanup failed")
            except BaseException as error:
                cleanup["status"] = "failed"
                cleanup["failures"].append(
                    f"client runtime cleanup: {type(error).__name__}: {error}"
                )
        try:
            cleanup["providerBridge"] = provider_bridge.stop()
            if cleanup["providerBridge"].get("status") != "clean":
                cleanup["status"] = "failed"
                cleanup["failures"].append("provider bridge cleanup failed")
        except BaseException as error:
            cleanup["status"] = "failed"
            cleanup["failures"].append(
                f"provider bridge cleanup: {type(error).__name__}: {error}"
            )
        try:
            provider_fixture.stop()
            cleanup["providerFixtureStopped"] = True
        except BaseException as error:
            cleanup["status"] = "failed"
            cleanup["failures"].append(
                f"provider fixture cleanup: {type(error).__name__}: {error}"
            )
        try:
            cleanup["provisionerResourcesReleased"] = list(
                provisioner.cleanup()
            )
        except BaseException as error:
            cleanup["status"] = "failed"
            cleanup["failures"].append(
                f"provisioner cleanup: {type(error).__name__}: {error}"
            )
        shutil.rmtree(fixture_root, ignore_errors=True)
        cleanup["fixtureStorageReleased"] = not fixture_root.exists()
        if not cleanup["fixtureStorageReleased"]:
            cleanup["status"] = "failed"
            cleanup["failures"].append("MCP fixture storage cleanup failed")

    result_name = (
        "PASS"
        if primary_error is None
        and assertions
        and all(assertions.values())
        and cleanup["status"] == "clean"
        else "FAIL"
    )
    station = manifest.services.get("station") if manifest is not None else None
    result = {
        "artifactKind": "development-functional-result",
        "schemaVersion": 1,
        "artifactRunId": artifact_run_id,
        "workItemId": WORK_ITEM_ID,
        "journeyId": JOURNEY_ID,
        "verificationClass": "FUNCTIONAL_CHECK",
        "result": result_name,
        "source": source_identity(ROOT),
        "runtimeIdentity": {
            "profile": PROFILE,
            "stationDeploymentEnvironment": deployment_environment,
            "stationBuildCommit": station.live_commit if station else "",
            "clientRuntime": "native-tauri",
            "actorAccount": J02_ACTOR_ACCOUNT,
        },
        "assertions": assertions,
        "capture": {
            "prepared": prepared,
            "recovered": recovered,
            "processEvidence": process_evidence,
            "providerRequests": provider_fixture.snapshot(),
        },
        "secretScan": {
            "status": "failed" if canary_leaked else "passed",
            "canaryDigest": secret_digest,
            "rawCanaryPersisted": canary_leaked,
        },
        "failure": (
            []
            if primary_error is None
            else [{
                "type": type(primary_error).__name__,
                "message": str(primary_error)[:4096],
            }]
        ),
        "cleanup": cleanup,
        "durationMs": int((time.monotonic() - started_at) * 1000),
    }
    serialized = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if secret_canary in serialized:
        result["result"] = "FAIL"
        result["failure"] = [{
            "type": "McpLifecycleDevelopmentError",
            "message": "secret canary reached the Development result",
        }]
        result["secretScan"]["status"] = "failed"
        result["secretScan"]["rawCanaryPersisted"] = True
        serialized = json.dumps(result, indent=2, sort_keys=True) + "\n"
    result_path = artifact_dir / "result.json"
    result_path.write_text(serialized, encoding="utf-8")
    attestation_run.close()
    shutil.rmtree(attestation_root, ignore_errors=True)
    sys.stdout.write(f"{result_path}\n")
    if primary_error is not None:
        traceback.print_exception(
            type(primary_error),
            primary_error,
            primary_error.__traceback__,
        )
    return 0 if result["result"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
