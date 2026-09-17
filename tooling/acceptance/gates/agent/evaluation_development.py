#!/usr/bin/env python3
"""Run the V2-J06 Evaluation Lab Development Journey and formal preflight."""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import traceback
from collections.abc import Mapping
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import ModuleType
from typing import Any

ROOT = Path(__file__).resolve().parents[4]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tooling.acceptance.core import ENVIRONMENTS_DIR, EnvironmentContract
from tooling.acceptance.core.evidence_store import (
    EvidenceStore,
    RunHandle,
    source_identity,
    workspace_id,
)
from tooling.acceptance.gates.agent.agent_v2_gate import (
    GATE_ROLES,
    MATRIX,
    RUNNER_GENERATED_ROLES,
)
from tooling.acceptance.gates.agent.capability_binding_development import (
    copy_native_runtime_logs,
    resolve_machine_profile,
)
from tooling.acceptance.gates.agent.foundation_runtime_client import (
    FoundationClientSpec,
    FoundationRuntimeClient,
)
from tooling.acceptance.gates.agent.governed_tool_development import (
    RemoteProviderBridge,
)
from tooling.acceptance.provisioners.home_station import (
    AGENT_V2_EVALUATION_GATE,
    HomeStationProvisioner,
)


WORKSPACE_ID = workspace_id(ROOT)
WORK_ITEM_ID = "MCA-V2-ALIGNMENT-J06"
JOURNEY_ID = "V2-J06"
PROFILE = "two"
ACTOR_ACCOUNTS = {
    "alice": "alice@p.t",
    "bob": "bob@p.t",
}
IDENTITY_FIXTURE_ROOT = (
    Path.home()
    / ".peers-touch"
    / "dev"
    / "workspaces"
    / WORKSPACE_ID
    / "runtime"
    / PROFILE
    / "fixtures"
    / "agent-v2-evaluation"
)
MATRIX_PATH = (
    ROOT / "tooling/acceptance/matrices/agent-v2-runtime-matrix.yaml"
)
EXPANDER_PATH = (
    ROOT / "tooling/scripts/expand-agent-v2-runtime-matrix.py"
)
TUPLE_FIELDS = (
    "gate",
    "row",
    "platform",
    "runtime",
    "cell",
    "locale",
    "ordering",
    "sample_id",
)
MAX_REQUEST_BYTES = 2 * 1024 * 1024


class EvaluationDevelopmentError(RuntimeError):
    """The V2-J06 Development Journey or formal preflight failed."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise EvaluationDevelopmentError(message)


def require_mapping(value: object, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise EvaluationDevelopmentError(f"{label} must be an object")
    return value


def begin_attestation_run(artifact_root: Path) -> RunHandle:
    os.environ["PT_ACCEPTANCE_ARTIFACT_ROOT"] = str(artifact_root)
    try:
        store = EvidenceStore(artifact_root, worktree=ROOT)
        run = store.begin_run(
            AGENT_V2_EVALUATION_GATE,
            source=source_identity(ROOT),
        )
    except BaseException:
        shutil.rmtree(artifact_root, ignore_errors=True)
        raise
    os.environ["PT_ACCEPTANCE_WORKSPACE_ID"] = store.workspace_id
    os.environ["PT_ACCEPTANCE_GATE_ID"] = AGENT_V2_EVALUATION_GATE
    os.environ["PT_ACCEPTANCE_RUN_ID"] = run.run_id
    os.environ["PT_ACCEPTANCE_APPROVED_PROFILE"] = PROFILE
    return run


def _load_module(path: Path, name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise EvaluationDevelopmentError(f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def expected_evaluation_tuples() -> list[dict[str, str]]:
    expander = _load_module(
        EXPANDER_PATH,
        "_agent_v2_evaluation_runtime_matrix_expander",
    )
    matrix = expander.load_matrix(MATRIX_PATH)
    expanded, counts = expander.expand_matrix(matrix)
    require(
        counts.get(AGENT_V2_EVALUATION_GATE) == 57,
        "reviewed J06 runtime matrix no longer contains exactly 57 tuples",
    )
    return [
        dict(zip(TUPLE_FIELDS, values))
        for values in expanded
        if values[0] == AGENT_V2_EVALUATION_GATE
    ]


def tuple_key(value: Mapping[str, Any]) -> str:
    return json.dumps(
        [str(value.get(field) or "") for field in TUPLE_FIELDS],
        separators=(",", ":"),
    )


def _all_true(value: object, label: str) -> bool:
    assertions = require_mapping(value, label)
    return bool(assertions) and all(item is True for item in assertions.values())


def evaluate_evaluation_journey(
    capture: Mapping[str, Any],
    *,
    expected_tuples: list[dict[str, str]],
    require_formal_coverage: bool = True,
) -> dict[str, bool]:
    prepare = require_mapping(capture.get("prepare"), "prepare capture")
    recovery = require_mapping(capture.get("recovery"), "recovery capture")
    isolation = require_mapping(capture.get("isolation"), "isolation capture")
    cleanup = require_mapping(capture.get("cleanup"), "cleanup capture")
    station = require_mapping(
        prepare.get("station-readback"),
        "Station readback",
    )
    turn_trace = require_mapping(
        prepare.get("turn-trace"),
        "TurnTrace evidence",
    )
    metrics = require_mapping(
        prepare.get("metrics-lineage"),
        "metrics lineage",
    )
    side_effects = require_mapping(
        prepare.get("side-effect-count"),
        "side-effect count",
    )
    replay = require_mapping(prepare.get("replay"), "mutation replay")
    runtime_events = require_mapping(
        prepare.get("runtime-events"),
        "runtime events",
    )
    tuple_results = capture.get("cell-results")
    require(
        isinstance(tuple_results, list),
        "formal cell-results must be an array",
    )
    expected_keys = {tuple_key(item) for item in expected_tuples}
    observed_keys = {
        tuple_key(require_mapping(item, "cell result"))
        for item in tuple_results
    }
    all_cells_pass = all(
        isinstance(item, Mapping)
        and item.get("observed") is True
        and item.get("passed") is True
        for item in tuple_results
    )

    primary = require_mapping(station.get("primary"), "primary run")
    cancelled = require_mapping(station.get("cancelled"), "cancelled run")
    child = require_mapping(station.get("child"), "child run")
    primary_run = require_mapping(primary.get("run"), "primary run record")
    cancelled_run = require_mapping(
        cancelled.get("run"),
        "cancelled run record",
    )
    child_run = require_mapping(child.get("run"), "child run record")
    cancelled_attempts = cancelled.get("attempts")
    child_attempts = child.get("attempts")
    lineage = turn_trace.get("lineage")
    assertions = {
        "harnessAssertionsPass": _all_true(
            prepare.get("assertions"),
            "prepare assertions",
        ),
        "restartAssertionsPass": _all_true(
            recovery.get("assertions"),
            "recovery assertions",
        ),
        "actorIsolationAssertionsPass": _all_true(
            isolation.get("assertions"),
            "isolation assertions",
        ),
        "actorIsolationComplete": all(
            require_mapping(
                isolation.get("assertions"),
                "isolation assertions",
            ).get(name)
            is True
            for name in (
                "distinctActor",
                "directReadDenied",
                "ownerRunsHidden",
                "ownerBenchmarkHidden",
                "mutationsDenied",
            )
        ),
        "nativeJourneyObserved": (
            require_mapping(
                prepare.get("receiver-dom"),
                "receiver DOM",
            ).get("resultVisible")
            is True
        ),
        "stationAuthoritativeReadback": (
            station.get("entityKind") == "evaluation-run-lineage"
            and bool(station.get("ownerActorId"))
            and bool(primary_run.get("runId"))
            and child_run.get("parentRunId") == primary_run.get("runId")
        ),
        "cancellationAcknowledged": (
            cancelled_run.get("status") in {7, 9, "7", "9"}
            and isinstance(cancelled_attempts, list)
            and any(
                isinstance(attempt, Mapping)
                and attempt.get("cancellationAckAt")
                for attempt in cancelled_attempts
            )
        ),
        "retryLineageUnique": (
            child_run.get("runId") != primary_run.get("runId")
            and metrics.get("childParentRunId") == primary_run.get("runId")
            and isinstance(child_attempts, list)
            and bool(child_attempts)
            and all(
                isinstance(attempt, Mapping)
                and bool(attempt.get("sourceAttemptId"))
                and bool(attempt.get("sourceResultId"))
                and bool(attempt.get("turnId"))
                for attempt in child_attempts
            )
        ),
        "parentMetricsImmutable": (
            metrics.get("parentMetrics")
            == metrics.get("parentMetricsAfterRetry")
        ),
        "turnTraceComplete": (
            turn_trace.get("complete") is True
            and isinstance(lineage, list)
            and bool(lineage)
            and all(
                isinstance(item, Mapping)
                and bool(item.get("turnTraceId"))
                and bool(item.get("attemptId"))
                and bool(item.get("resultId"))
                for item in lineage
            )
        ),
        "schedulerAndAttemptUnique": (
            int(side_effects.get("attemptCount") or 0)
            == int(side_effects.get("uniqueAttemptCount") or -1)
            and int(side_effects.get("schedulerClaimCount") or 0)
            == int(side_effects.get("uniqueSchedulerClaimCount") or -1)
            and int(side_effects.get("attemptCount") or 0) > 0
        ),
        "mutationReplayStable": (
            replay.get("primaryRunId") == primary_run.get("runId")
            and replay.get("cancelledRunId") == cancelled_run.get("runId")
            and replay.get("childRunId") == child_run.get("runId")
        ),
        "runtimeEventsObserved": (
            all(key in runtime_events for key in ("primary", "cancelled", "child"))
        ),
        "retentionAndCleanupComplete": (
            cleanup.get("status") == "clean"
            and cleanup.get("retentionConflictObserved") is True
            and cleanup.get("resourceDeletionComplete") is True
        ),
        "exactFormalTupleCoverage": (
            len(tuple_results) == 57
            and len(observed_keys) == 57
            and observed_keys == expected_keys
            and all_cells_pass
        ),
    }
    if not require_formal_coverage:
        assertions.pop("exactFormalTupleCoverage")
    failed = sorted(name for name, passed in assertions.items() if not passed)
    if failed:
        raise EvaluationDevelopmentError(
            "V2-J06 facts failed assertions: " + ", ".join(failed)
        )
    return assertions


class _EvaluationProviderServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self) -> None:
        super().__init__(("127.0.0.1", 0), _EvaluationProviderHandler)
        self.lock = threading.Lock()
        self.requests: list[dict[str, Any]] = []
        self.fail_once_seen = False

    def record(self, value: dict[str, Any]) -> None:
        with self.lock:
            self.requests.append(value)

    def snapshot(self) -> list[dict[str, Any]]:
        with self.lock:
            return [dict(item) for item in self.requests]


class _EvaluationProviderHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    @property
    def fixture(self) -> _EvaluationProviderServer:
        return self.server  # type: ignore[return-value]

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def do_POST(self) -> None:
        if self.path != "/v1/chat/completions":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_error(400)
            return
        if length <= 0 or length > MAX_REQUEST_BYTES:
            self.send_error(413)
            return
        try:
            payload = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_error(400)
            return
        if not isinstance(payload, Mapping):
            self.send_error(400)
            return
        encoded = json.dumps(payload, sort_keys=True)
        marker = (
            "cancel"
            if "J06_CANCEL_CASE" in encoded
            else "fail-once"
            if "J06_FAIL_ONCE_CASE" in encoded
            else "pass"
        )
        request = {
            "marker": marker,
            "stream": payload.get("stream") is True,
            "authorizationPresent": (
                self.headers.get("Authorization")
                == "Bearer mca-j03-fixture-key"
            ),
            "model": str(payload.get("model") or ""),
        }
        self.fixture.record(request)
        if not request["stream"] or not request["authorizationPresent"]:
            self.send_error(422)
            return
        if marker == "fail-once":
            with self.fixture.lock:
                should_fail = not self.fixture.fail_once_seen
                self.fixture.fail_once_seen = True
            if should_fail:
                self.send_error(422, "deterministic J06 first-attempt failure")
                return
        if marker == "cancel":
            time.sleep(30)
        content = "J06_RETRY_OK" if marker == "fail-once" else "J06_OK"
        model = request["model"] or "mca-j06-model"
        chunks = [
            {
                "model": model,
                "choices": [{
                    "index": 0,
                    "delta": {"content": content},
                    "finish_reason": None,
                }],
            },
            {
                "model": model,
                "choices": [{
                    "index": 0,
                    "delta": {},
                    "finish_reason": "stop",
                }],
            },
        ]
        body = "".join(
            f"data: {json.dumps(chunk, separators=(',', ':'))}\n\n"
            for chunk in chunks
        ) + "data: [DONE]\n\n"
        encoded_body = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Content-Length", str(len(encoded_body)))
        self.end_headers()
        try:
            self.wfile.write(encoded_body)
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            return


class EvaluationProviderFixture:
    def __init__(self) -> None:
        self.server = _EvaluationProviderServer()
        self.thread = threading.Thread(
            target=self.server.serve_forever,
            name="mca-j06-provider-fixture",
            daemon=True,
        )

    @property
    def port(self) -> int:
        return int(self.server.server_address[1])

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

    def snapshot(self) -> list[dict[str, Any]]:
        return self.server.snapshot()


def _validate_identity_root(root: Path) -> None:
    require(root.is_dir() and not root.is_symlink(), "identity root is invalid")
    require(
        not any(path.is_symlink() for path in root.rglob("*")),
        "identity root contains a symlink",
    )
    key_files = tuple(path for path in root.rglob("*.key") if path.is_file())
    require(len(key_files) == 1, "identity root must contain exactly one key")
    key = key_files[0].read_text(encoding="utf-8").strip()
    require(
        len(key) == 64
        and all(character in "0123456789abcdefABCDEF" for character in key),
        "identity key is invalid",
    )


def seed_actor_identity(
    role: str,
    target_root: Path,
    station_url: str,
) -> bool:
    fixture = IDENTITY_FIXTURE_ROOT / role
    if not fixture.exists():
        return False
    metadata = json.loads(
        (fixture / "fixture.json").read_text(encoding="utf-8")
    )
    require(
        metadata.get("profile") == PROFILE
        and metadata.get("account") == ACTOR_ACCOUNTS[role]
        and str(metadata.get("stationUrl") or "").rstrip("/")
        == station_url.rstrip("/")
        and bool(metadata.get("actorId")),
        f"retained {role} identity does not match Profile two",
    )
    source = fixture / "actor-identity"
    _validate_identity_root(source)
    require(not target_root.exists(), f"{role} identity target already exists")
    target_root.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    shutil.copytree(source, target_root, symlinks=False)
    return True


def persist_actor_identity(
    role: str,
    source_root: Path,
    station_url: str,
    actor_id: str,
) -> dict[str, Any]:
    fixture = IDENTITY_FIXTURE_ROOT / role
    metadata = {
        "schemaVersion": 1,
        "profile": PROFILE,
        "account": ACTOR_ACCOUNTS[role],
        "actorId": actor_id,
        "stationUrl": station_url.rstrip("/"),
    }
    if fixture.exists():
        existing = json.loads(
            (fixture / "fixture.json").read_text(encoding="utf-8")
        )
        require(
            existing == metadata,
            f"retained {role} identity belongs to another actor",
        )
        _validate_identity_root(fixture / "actor-identity")
        return metadata
    _validate_identity_root(source_root)
    fixture.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = fixture.parent / f".{role}.tmp-{os.getpid()}"
    shutil.rmtree(temporary, ignore_errors=True)
    try:
        shutil.copytree(source_root, temporary / "actor-identity")
        (temporary / "fixture.json").write_text(
            json.dumps(metadata, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        os.replace(temporary, fixture)
    finally:
        shutil.rmtree(temporary, ignore_errors=True)
    return metadata


def authenticate_client(
    client: FoundationRuntimeClient,
    *,
    account: str,
    password: str,
) -> dict[str, Any]:
    client.configure_station(timeout=60)
    login = client.harness(
        "loginWithPassword",
        {"account": account, "password": password},
        timeout=120,
    )
    require(
        isinstance(login, Mapping)
        and login.get("authenticated") is True
        and bool(login.get("actorId")),
        f"Native actor login failed for {account}",
    )
    navigation = client.harness("navigateToAgent", {}, timeout=60)
    require(
        isinstance(navigation, Mapping)
        and navigation.get("navigated") is True,
        f"Native Agent navigation failed for {account}",
    )
    return dict(login)


def _clients_from_manifest(
    manifest: Mapping[str, Any],
    profile_env: Mapping[str, str],
) -> dict[str, FoundationRuntimeClient]:
    services = manifest.get("services")
    station = services.get("station") if isinstance(services, Mapping) else None
    clients = manifest.get("clients")
    require(
        isinstance(station, Mapping) and bool(station.get("endpoint")),
        "J06 runtime manifest has no Station endpoint",
    )
    require(
        isinstance(clients, list) and len(clients) == 2,
        "J06 runtime manifest must contain two Native clients",
    )
    result: dict[str, FoundationRuntimeClient] = {}
    for raw_client in clients:
        client = require_mapping(raw_client, "J06 Native client")
        actor = str(client.get("actor") or "")
        require(
            actor in ACTOR_ACCOUNTS
            and client.get("runtime") == "native-tauri"
            and actor not in result,
            "J06 clients must be isolated Alice and Bob native-tauri clients",
        )
        result[actor] = FoundationRuntimeClient(
            FoundationClientSpec.from_mapping(client),
            station_url=str(station["endpoint"]),
            profile_env=profile_env,
            startup_timeout=900,
        )
    require(set(result) == set(ACTOR_ACCOUNTS), "J06 actor clients are incomplete")
    return result


def _cleanup_client(client: FoundationRuntimeClient) -> dict[str, Any]:
    result = client.stop(remove_storage=False)
    shutil.rmtree(client.actor_identity_root, ignore_errors=True)
    result["actorIdentityReleased"] = not client.actor_identity_root.exists()
    if not result["actorIdentityReleased"]:
        result["status"] = "failed"
        result.setdefault("failures", []).append("actor identity root remained")
    return result


def _write_json(path: Path, value: Mapping[str, Any]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, indent=2, sort_keys=True, default=str) + "\n",
        encoding="utf-8",
    )
    return path


def write_candidate(
    root: Path,
    capture: Mapping[str, Any],
    *,
    runtime_manifest: Mapping[str, Any],
    duration_ms: int,
    provider_requests: list[dict[str, Any]],
) -> Path:
    prepare = require_mapping(capture["prepare"], "prepare capture")
    recovery = require_mapping(capture["recovery"], "recovery capture")
    role_payloads: dict[str, Mapping[str, Any]] = {
        "cell-results": {
            "expectedTupleCount": 57,
            "results": capture["cell-results"],
        },
        "receiver-dom": {
            "prepare": prepare["receiver-dom"],
            "recovery": recovery["receiver-dom"],
        },
        "station-readback": {
            "prepare": prepare["station-readback"],
            "recovery": recovery["station-readback"],
            "isolation": capture["isolation"],
        },
        "runtime-events": {
            "prepare": prepare["runtime-events"],
            "recovery": recovery["runtime-events"],
        },
        "turn-trace": require_mapping(prepare["turn-trace"], "turn trace"),
        "metrics-lineage": require_mapping(
            prepare["metrics-lineage"],
            "metrics lineage",
        ),
        "runtime-attestation-set": {
            "sourceIdentity": source_identity(ROOT),
            "runtimeManifest": runtime_manifest,
        },
        "measurement-report": {
            "durationMs": duration_ms,
            "providerRequestCount": len(provider_requests),
            "providerRequests": provider_requests,
        },
        "side-effect-count": require_mapping(
            prepare["side-effect-count"],
            "side-effect count",
        ),
        "cleanup": require_mapping(capture["cleanup"], "cleanup"),
        "replay": require_mapping(prepare["replay"], "replay"),
    }
    scenario_roles = (
        set(GATE_ROLES[AGENT_V2_EVALUATION_GATE]) - RUNNER_GENERATED_ROLES
    )
    require(
        set(role_payloads) == scenario_roles,
        "J06 candidate role set does not match the formal Gate",
    )
    references = []
    for role, payload in sorted(role_payloads.items()):
        role_path = _write_json(root / "roles" / f"{role}.json", payload)
        references.append({"role": role, "path": str(role_path)})
    return _write_json(
        root / "candidate.json",
        {
            "gateId": AGENT_V2_EVALUATION_GATE,
            "runtimeMatrix": MATRIX,
            "scenarioExecuted": True,
            "proofStatus": "UNPROVEN",
            "artifacts": references,
        },
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run the V2-J06 Evaluation Lab Development Journey.",
    )
    parser.add_argument("--output-root", default="")
    parser.add_argument("--formal-candidate", action="store_true")
    args = parser.parse_args()
    started_at = time.monotonic()
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
    require(bool(deployment_environment), "Profile two has no Station identity")
    os.environ.update(profile_env)
    os.environ["PT_DEV_PROFILE"] = PROFILE

    artifact_run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    artifact_parent = (
        Path(args.output_root).expanduser().resolve()
        if args.output_root
        else Path.home()
        / ".peers-touch"
        / "dev"
        / "workspaces"
        / WORKSPACE_ID
        / "workflow"
        / WORK_ITEM_ID
        / "artifacts"
    )
    artifact_dir = artifact_parent / artifact_run_id
    artifact_dir.mkdir(parents=True, exist_ok=False)
    provisioner = HomeStationProvisioner(
        EnvironmentContract.from_yaml(ENVIRONMENTS_DIR / "home-station.yaml")
    )
    provisioner._resolve_active_profile = lambda: (
        profile_name,
        profile_file,
        slot,
        dict(profile_env),
    )
    provider_fixture = EvaluationProviderFixture()
    provider_fixture_started = False
    provider_bridge = RemoteProviderBridge(
        deployment_environment,
        artifact_prefix="mca-j06-provider",
    )
    clients: dict[str, FoundationRuntimeClient] = {}
    runtime_manifest = None
    capture: dict[str, Any] = {"cell-results": []}
    state: dict[str, Any] | None = None
    assertions: dict[str, bool] = {}
    primary_error: BaseException | None = None
    cleanup: dict[str, Any] = {
        "status": "clean",
        "product": None,
        "clients": {},
        "providerBridge": None,
        "providerFixtureStopped": False,
        "provisionerResourcesReleased": [],
        "failures": [],
    }
    candidate_root = Path(
        tempfile.mkdtemp(prefix=f"pt-agent-v2-j06-{artifact_run_id}-")
    )
    attestation_root = Path("/tmp") / f"mca-evaluation-{artifact_run_id}"
    try:
        attestation_run = begin_attestation_run(attestation_root)
    except BaseException:
        shutil.rmtree(candidate_root, ignore_errors=True)
        raise

    try:
        runtime_manifest = provisioner.provision(AGENT_V2_EVALUATION_GATE)
        require(
            runtime_manifest.state.value == "FIXTURE_READY",
            (
                "J06 provisioning did not become ready: "
                f"{runtime_manifest.blocked_reason or runtime_manifest.state.value}"
            ),
        )
        clients = _clients_from_manifest(
            runtime_manifest.to_dict(),
            profile_env,
        )
        provider_fixture.start()
        provider_fixture_started = True
        provider_base_url = provider_bridge.start(
            provider_fixture.port,
            artifact_run_id,
        )
        identities: dict[str, Any] = {}
        for role, client in clients.items():
            reused = seed_actor_identity(
                role,
                client.actor_identity_root,
                profile_env["PT_STATION_URL"],
            )
            client.start()
            login = authenticate_client(
                client,
                account=ACTOR_ACCOUNTS[role],
                password=profile_env["CHAT_NATIVE_DEMO_PASSWORD"],
            )
            identities[role] = {
                **persist_actor_identity(
                    role,
                    client.actor_identity_root,
                    profile_env["PT_STATION_URL"],
                    str(login["actorId"]),
                ),
                "reused": reused,
            }

        prepared = clients["alice"].harness(
            "runEvaluationDevelopment",
            {
                "phase": "prepare",
                "sampleId": f"mca-j06-{artifact_run_id}",
                "providerBaseUrl": provider_base_url,
            },
            timeout=1200,
        )
        require(isinstance(prepared, Mapping), "J06 prepare evidence is invalid")
        state_value = prepared.get("state")
        require(isinstance(state_value, Mapping), "J06 state is missing")
        state = dict(state_value)
        capture["identities"] = identities
        capture["prepare"] = dict(prepared)
        isolated = clients["bob"].harness(
            "runEvaluationDevelopment",
            {
                "phase": "isolate",
                "sampleId": f"mca-j06-{artifact_run_id}",
                "state": state,
            },
            timeout=120,
        )
        require(isinstance(isolated, Mapping), "J06 isolation evidence is invalid")
        capture["isolation"] = dict(isolated)

        clients["alice"].restart()
        recovery = clients["alice"].harness(
            "runEvaluationDevelopment",
            {
                "phase": "recover",
                "sampleId": f"mca-j06-{artifact_run_id}",
                "state": state,
            },
            timeout=300,
        )
        require(isinstance(recovery, Mapping), "J06 recovery evidence is invalid")
        capture["recovery"] = dict(recovery)
    except BaseException as error:
        primary_error = error
    finally:
        if state is not None and "alice" in clients:
            try:
                product_cleanup = clients["alice"].harness(
                    "runEvaluationDevelopment",
                    {
                        "phase": "cleanup",
                        "sampleId": f"mca-j06-{artifact_run_id}",
                        "state": state,
                    },
                    timeout=300,
                )
                cleanup["product"] = product_cleanup
                capture["cleanup"] = product_cleanup
                if (
                    not isinstance(product_cleanup, Mapping)
                    or product_cleanup.get("status") != "clean"
                ):
                    cleanup["status"] = "failed"
                    cleanup["failures"].append("product cleanup failed")
            except BaseException as error:
                cleanup["status"] = "failed"
                cleanup["failures"].append(
                    f"product cleanup: {type(error).__name__}: {error}"
                )
        for role, client in clients.items():
            try:
                cleanup[f"{role}RuntimeLogs"] = copy_native_runtime_logs(
                    client,
                    artifact_dir,
                )
            except BaseException as error:
                cleanup["status"] = "failed"
                cleanup["failures"].append(
                    f"{role} log capture: {type(error).__name__}: {error}"
                )
            try:
                client_cleanup = _cleanup_client(client)
                cleanup["clients"][role] = client_cleanup
                if client_cleanup.get("status") != "clean":
                    cleanup["status"] = "failed"
                    cleanup["failures"].append(f"{role} client cleanup failed")
            except BaseException as error:
                cleanup["status"] = "failed"
                cleanup["failures"].append(
                    f"{role} client cleanup: {type(error).__name__}: {error}"
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
        if provider_fixture_started:
            try:
                provider_fixture.stop()
                cleanup["providerFixtureStopped"] = True
            except BaseException as error:
                cleanup["status"] = "failed"
                cleanup["failures"].append(
                    f"provider fixture cleanup: {type(error).__name__}: {error}"
                )
        else:
            cleanup["providerFixtureStopped"] = True
        try:
            cleanup["provisionerResourcesReleased"] = list(
                provisioner.cleanup()
            )
        except BaseException as error:
            cleanup["status"] = "failed"
            cleanup["failures"].append(
                f"provisioner cleanup: {type(error).__name__}: {error}"
            )
        try:
            attestation_run.close()
        except BaseException as error:
            cleanup["status"] = "failed"
            cleanup["failures"].append(
                f"attestation cleanup: {type(error).__name__}: {error}"
            )
        finally:
            shutil.rmtree(attestation_root, ignore_errors=True)

    product_cleanup = cleanup.get("product") or {
        "status": "failed",
        "retentionConflictObserved": False,
        "resourceDeletionComplete": False,
    }
    if not isinstance(product_cleanup, Mapping):
        product_cleanup = {
            "status": "failed",
            "retentionConflictObserved": False,
            "resourceDeletionComplete": False,
        }
    capture["cleanup"] = {
        **dict(product_cleanup),
        "status": (
            "clean"
            if product_cleanup.get("status") == "clean"
            and cleanup["status"] == "clean"
            else "failed"
        ),
        "runtime": cleanup,
    }
    formal_error: BaseException | None = None
    if primary_error is None and cleanup["status"] == "clean":
        try:
            assertions = evaluate_evaluation_journey(
                capture,
                expected_tuples=expected_evaluation_tuples(),
                require_formal_coverage=False,
            )
        except BaseException as error:
            primary_error = error
    if primary_error is None and assertions:
        try:
            evaluate_evaluation_journey(
                capture,
                expected_tuples=expected_evaluation_tuples(),
            )
        except BaseException as error:
            formal_error = error

    duration_ms = int((time.monotonic() - started_at) * 1000)
    provider_requests = provider_fixture.snapshot()
    candidate_path: Path | None = None
    if (
        primary_error is None
        and formal_error is None
        and assertions
        and all(assertions.values())
        and cleanup["status"] == "clean"
        and runtime_manifest is not None
    ):
        candidate_path = write_candidate(
            candidate_root,
            capture,
            runtime_manifest=runtime_manifest.to_dict(),
            duration_ms=duration_ms,
            provider_requests=provider_requests,
        )

    station = (
        runtime_manifest.services.get("station")
        if runtime_manifest is not None
        else None
    )
    result = {
        "artifactKind": "development-functional-result",
        "schemaVersion": 1,
        "artifactRunId": artifact_run_id,
        "workItemId": WORK_ITEM_ID,
        "journeyId": JOURNEY_ID,
        "verificationClass": "FUNCTIONAL_CHECK",
        "result": (
            "FUNCTIONAL_PASS"
            if primary_error is None
            and assertions
            and all(assertions.values())
            and cleanup["status"] == "clean"
            else "FAIL"
        ),
        "source": source_identity(ROOT),
        "runtimeIdentity": {
            "profile": PROFILE,
            "stationDeploymentEnvironment": deployment_environment,
            "stationBuildCommit": station.live_commit if station else "",
            "clientRuntimes": ["native-tauri:alice", "native-tauri:bob"],
        },
        "assertions": assertions,
        "capture": capture,
        "providerRequests": provider_requests,
        "formalCoverage": {
            "expectedTupleCount": 57,
            "observedTupleCount": len(capture["cell-results"]),
            "proofStatus": "CANDIDATE" if candidate_path else "UNPROVEN",
        },
        "failure": (
            []
            if primary_error is None
            else [{
                "type": type(primary_error).__name__,
                "message": str(primary_error)[:4096],
            }]
        ),
        "formalFailure": (
            []
            if formal_error is None
            else [{
                "type": type(formal_error).__name__,
                "message": str(formal_error)[:4096],
            }]
        ),
        "cleanup": cleanup,
        "durationMs": duration_ms,
    }
    result_path = _write_json(artifact_dir / "result.json", result)
    if candidate_path is not None:
        sys.stdout.write(f"{candidate_path}\n")
        return 0
    shutil.rmtree(candidate_root, ignore_errors=True)
    sys.stdout.write(f"{result_path}\n")
    if primary_error is not None:
        traceback.print_exception(
            type(primary_error),
            primary_error,
            primary_error.__traceback__,
            file=sys.stderr,
        )
    if args.formal_candidate:
        return 1
    return 0 if result["result"] == "FUNCTIONAL_PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
