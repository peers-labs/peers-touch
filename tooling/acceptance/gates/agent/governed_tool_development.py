#!/usr/bin/env python3
"""Run the focused V2-J03 governed ToolCall Development Journey."""

from __future__ import annotations

import base64
import json
import os
import shlex
import shutil
import subprocess
import sys
import threading
import time
import traceback
from collections.abc import Mapping
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
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
from tooling.acceptance.core.provisioner import load_env_file
from tooling.acceptance.gates.agent.capability_binding_development import (
    J02_ACTOR_ACCOUNT,
    J02_IDENTITY_FIXTURE,
    authenticate_native_client,
    cleanup_clients,
    copy_native_runtime_logs,
    identity_fixture_evidence,
    persist_native_actor_identity,
    resolve_machine_profile,
    seed_native_actor_identity,
)
from tooling.acceptance.gates.agent.foundation_runtime_client import (
    FoundationRuntimePair,
)
from tooling.acceptance.gates.agent.foundation_scenario_runner import (
    _build_client_manifest,
)
from tooling.acceptance.drivers.native import create_native_desktop_adapter
from tooling.acceptance.provisioners.home_station import (
    AGENT_V2_GOVERNED_TOOL_GATE,
    HomeStationProvisioner,
)
from tooling.acceptance.transports import SshTarget, SshTransport, SshTunnel


WORKSPACE_ID = workspace_id(ROOT)
WORK_ITEM_ID = "MCA-V2-ALIGNMENT-J03"
JOURNEY_ID = "V2-J03"
PROFILE = "two"
FIXTURE_API_KEY = "mca-j03-fixture-key"
FIXTURE_TOOL_NAME = "local_clipboard_read"
FIXTURE_CLIPBOARD_TEXT = "mca-j03-clipboard-fixture"
FIXTURE_CLIPBOARD_BYTES = FIXTURE_CLIPBOARD_TEXT.encode("utf-8")
MAX_REQUEST_BYTES = 1_048_576

REMOTE_TCP_BRIDGE = r"""
import selectors
import socket
import socketserver
import sys

bind_host = sys.argv[1]
listen_port = int(sys.argv[2])
target_port = int(sys.argv[3])

class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        upstream = socket.create_connection(("127.0.0.1", target_port), 5)
        try:
            self.request.setblocking(False)
            upstream.setblocking(False)
            selector = selectors.DefaultSelector()
            selector.register(self.request, selectors.EVENT_READ, upstream)
            selector.register(upstream, selectors.EVENT_READ, self.request)
            try:
                while True:
                    events = selector.select(timeout=30)
                    if not events:
                        continue
                    for key, _ in events:
                        data = key.fileobj.recv(65536)
                        if not data:
                            return
                        key.data.sendall(data)
            finally:
                selector.close()
        finally:
            upstream.close()

class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

Server((bind_host, listen_port), Handler).serve_forever()
""".strip()


class GovernedToolDevelopmentError(RuntimeError):
    """The V2-J03 Development Journey failed."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise GovernedToolDevelopmentError(message)


def require_mapping(value: object, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise GovernedToolDevelopmentError(f"{label} must be an object")
    return value


class _ProviderFixtureServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self) -> None:
        super().__init__(("127.0.0.1", 0), _ProviderFixtureHandler)
        self.request_lock = threading.Lock()
        self.requests: list[dict[str, Any]] = []

    def record_request(self, request: dict[str, Any]) -> int:
        with self.request_lock:
            self.requests.append(request)
            return len(self.requests)

    def snapshot(self) -> list[dict[str, Any]]:
        with self.request_lock:
            return [dict(request) for request in self.requests]


class _ProviderFixtureHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    @property
    def fixture(self) -> _ProviderFixtureServer:
        return self.server  # type: ignore[return-value]

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def do_POST(self) -> None:
        if self.path != "/v1/chat/completions":
            self.send_error(404)
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_error(400)
            return
        if content_length <= 0 or content_length > MAX_REQUEST_BYTES:
            self.send_error(413)
            return
        try:
            payload = json.loads(self.rfile.read(content_length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_error(400)
            return
        if not isinstance(payload, Mapping):
            self.send_error(400)
            return

        messages = payload.get("messages")
        tools = payload.get("tools")
        message_roles = [
            str(message.get("role") or "")
            for message in messages
            if isinstance(messages, list) and isinstance(message, Mapping)
        ] if isinstance(messages, list) else []
        tool_result_messages = [
            message
            for message in messages
            if isinstance(messages, list)
            and isinstance(message, Mapping)
            and message.get("role") == "tool"
        ] if isinstance(messages, list) else []
        tool_names = []
        if isinstance(tools, list):
            for tool in tools:
                if not isinstance(tool, Mapping):
                    continue
                function = tool.get("function")
                if isinstance(function, Mapping):
                    name = str(function.get("name") or "")
                    if name:
                        tool_names.append(name)
        request_number = self.fixture.record_request(
            {
                "path": self.path,
                "stream": payload.get("stream") is True,
                "model": str(payload.get("model") or ""),
                "messageRoles": message_roles,
                "toolNames": tool_names,
                "hasToolResult": "tool" in message_roles,
                "hasExpectedToolResult": any(
                    FIXTURE_CLIPBOARD_TEXT
                    in str(message.get("content") or "")
                    for message in tool_result_messages
                ),
                "authorizationPresent": (
                    self.headers.get("Authorization")
                    == f"Bearer {FIXTURE_API_KEY}"
                ),
            }
        )
        if (
            payload.get("stream") is not True
            or FIXTURE_TOOL_NAME not in tool_names
            or self.headers.get("Authorization")
            != f"Bearer {FIXTURE_API_KEY}"
        ):
            self.send_error(422)
            return

        model = str(payload.get("model") or "mca-j03-model")
        has_tool_result = "tool" in message_roles
        if has_tool_result:
            chunks = [
                {
                    "model": model,
                    "choices": [{
                        "index": 0,
                        "delta": {
                            "content": "Governed tool execution completed.",
                        },
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
        else:
            chunks = [{
                "model": model,
                "choices": [{
                    "index": 0,
                    "delta": {
                        "tool_calls": [{
                            "index": 0,
                            "id": f"provider-call-{request_number}",
                            "type": "function",
                            "function": {
                                "name": FIXTURE_TOOL_NAME,
                                "arguments": "{}",
                            },
                        }],
                    },
                    "finish_reason": "tool_calls",
                }],
            }]
        body = "".join(
            f"data: {json.dumps(chunk, separators=(',', ':'))}\n\n"
            for chunk in chunks
        ) + "data: [DONE]\n\n"
        encoded = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)
        self.wfile.flush()
        self.close_connection = True


class OpenAIProviderFixture:
    def __init__(self) -> None:
        self.server = _ProviderFixtureServer()
        self.started = False
        self.thread = threading.Thread(
            target=self.server.serve_forever,
            name="mca-j03-provider-fixture",
            daemon=True,
        )

    @property
    def port(self) -> int:
        return int(self.server.server_address[1])

    def start(self) -> None:
        self.thread.start()
        self.started = True

    def stop(self) -> None:
        if self.started:
            self.server.shutdown()
        self.server.server_close()
        if self.started:
            self.thread.join(timeout=5)
            if self.thread.is_alive():
                raise GovernedToolDevelopmentError(
                    "provider fixture thread did not stop"
                )
            self.started = False

    def snapshot(self) -> list[dict[str, Any]]:
        return self.server.snapshot()


class RemoteProviderBridge:
    def __init__(self, deployment_environment: str) -> None:
        environment_path = (
            ROOT
            / ".local"
            / "deploy"
            / "envs"
            / f"{deployment_environment}.env"
        )
        if not environment_path.is_file():
            raise GovernedToolDevelopmentError(
                f"deployment environment is missing: {environment_path}"
            )
        self.environment = load_env_file(environment_path)
        self.host = self.environment.get("PT_DEPLOY_HOST", "").strip()
        user = self.environment.get("PT_DEPLOY_USER", "").strip()
        require(bool(self.host and user), "deployment SSH identity is incomplete")
        self.transport = SshTransport(
            SshTarget(
                host=self.host,
                user=user,
                port=int(self.environment.get("PT_DEPLOY_SSH_PORT", "22")),
                known_hosts_file=self.environment.get(
                    "PT_DEPLOY_KNOWN_HOSTS_FILE",
                    "",
                ),
            )
        )
        self.tunnel: SshTunnel | None = None
        self.reverse_port = 0
        self.bridge_port = 0
        self.remote_pid = 0
        self.remote_pid_path = ""
        self.remote_log_path = ""

    def _remote_endpoint_ready(self) -> bool:
        probe = self.transport.run_argv(
            (
                "python3",
                "-c",
                (
                    "import socket,sys;"
                    "connection=socket.create_connection("
                    "(sys.argv[1],int(sys.argv[2])),0.5);"
                    "connection.close()"
                ),
                self.host,
                str(self.bridge_port),
            ),
            timeout=5,
            check=False,
        )
        return probe.returncode == 0

    def start(self, local_port: int, run_id: str) -> str:
        self.reverse_port = self.transport.available_remote_port()
        self.bridge_port = self.transport.available_remote_port()
        require(
            self.reverse_port != self.bridge_port,
            "remote provider bridge ports collided",
        )
        self.tunnel = self.transport.start_reverse_forward(
            local_port=local_port,
            remote_port=self.reverse_port,
            timeout=15,
        )
        token = "".join(character for character in run_id if character.isalnum())
        self.remote_pid_path = f"/tmp/mca-j03-provider-{token}.pid"
        self.remote_log_path = f"/tmp/mca-j03-provider-{token}.log"
        encoded_script = base64.b64encode(
            REMOTE_TCP_BRIDGE.encode("utf-8")
        ).decode("ascii")
        bootstrap = (
            "import base64;"
            f"exec(base64.b64decode('{encoded_script}'))"
        )
        remote_command = (
            "umask 077; "
            f"nohup python3 -c {shlex.quote(bootstrap)} "
            f"{shlex.quote(self.host)} {self.bridge_port} {self.reverse_port} "
            f">{shlex.quote(self.remote_log_path)} 2>&1 </dev/null & "
            f"echo $! > {shlex.quote(self.remote_pid_path)}; "
            f"cat {shlex.quote(self.remote_pid_path)}"
        )
        started = self.transport.run_argv(
            ("bash", "-lc", remote_command),
            timeout=15,
            check=True,
        )
        pid = started.stdout.strip()
        require(pid.isdecimal(), "remote provider bridge did not return a pid")
        self.remote_pid = int(pid)
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if self._remote_endpoint_ready():
                return f"http://{self.host}:{self.bridge_port}"
            time.sleep(0.1)
        raise GovernedToolDevelopmentError(
            "remote provider bridge did not become reachable"
        )

    def stop(self) -> dict[str, Any]:
        failures: list[str] = []
        if self.remote_pid:
            stopped = self.transport.run_argv(
                (
                    "bash",
                    "-lc",
                    (
                        f"kill {self.remote_pid} 2>/dev/null || true; "
                        f"rm -f {shlex.quote(self.remote_pid_path)} "
                        f"{shlex.quote(self.remote_log_path)}"
                    ),
                ),
                timeout=10,
                check=False,
            )
            if stopped.returncode != 0:
                failures.append("remote bridge process cleanup failed")
            deadline = time.monotonic() + 5
            while (
                time.monotonic() < deadline
                and self._remote_endpoint_ready()
            ):
                time.sleep(0.05)
            if self._remote_endpoint_ready():
                failures.append("remote bridge port remained open")
        if self.tunnel is not None:
            self.tunnel.stop()
            self.tunnel = None
        if (
            self.reverse_port
            and self.transport.remote_loopback_port_listening(
                self.reverse_port,
                timeout=2,
            )
        ):
            failures.append("SSH reverse-forward port remained open")
        return {
            "status": "clean" if not failures else "failed",
            "failures": failures,
            "reversePort": self.reverse_port,
            "bridgePort": self.bridge_port,
            "remotePid": self.remote_pid,
        }


def evaluate_governed_tool(
    journey: Mapping[str, Any],
    provider_requests: list[dict[str, Any]],
) -> dict[str, bool]:
    harness_assertions = require_mapping(
        journey.get("assertions"),
        "Harness assertions",
    )
    cleanup = require_mapping(journey.get("cleanup"), "Harness cleanup")
    receiver = require_mapping(
        journey.get("receiver-dom"),
        "native receiver evidence",
    )
    station = require_mapping(
        journey.get("station-readback"),
        "Station readback evidence",
    )
    first = provider_requests[0] if len(provider_requests) > 0 else {}
    continuation = provider_requests[1] if len(provider_requests) > 1 else {}
    assertions = {
        "harnessAssertionsPass": (
            bool(harness_assertions)
            and all(value is True for value in harness_assertions.values())
        ),
        "harnessCleanupComplete": cleanup.get("status") == "clean",
        "deterministicProviderSequence": (
            len(provider_requests) == 2
            and first.get("path") == "/v1/chat/completions"
            and first.get("stream") is True
            and first.get("authorizationPresent") is True
            and first.get("hasToolResult") is False
            and FIXTURE_TOOL_NAME in first.get("toolNames", [])
            and continuation.get("path") == "/v1/chat/completions"
            and continuation.get("stream") is True
            and continuation.get("authorizationPresent") is True
            and continuation.get("hasToolResult") is True
            and continuation.get("hasExpectedToolResult") is True
        ),
        "nativeReceiverObserved": (
            receiver.get("visible") is True
            and receiver.get("status") == "success"
            and receiver.get("governanceVisible") is True
        ),
        "stationLineageObserved": (
            station.get("entityKind") == "agent-tool-call-lineage"
            and station.get("sourceHash") == station.get("replayHash")
        ),
    }
    failed = sorted(name for name, passed in assertions.items() if not passed)
    if failed:
        raise GovernedToolDevelopmentError(
            "V2-J03 facts failed assertions: " + ", ".join(failed)
        )
    return assertions


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
    attestation_root = Path("/tmp") / f"mca-governed-tool-{artifact_run_id}"
    os.environ["PT_ACCEPTANCE_ARTIFACT_ROOT"] = str(attestation_root)
    store = EvidenceStore(attestation_root, worktree=ROOT)
    attestation_run = store.begin_run(
        AGENT_V2_GOVERNED_TOOL_GATE,
        source=source_identity(ROOT),
    )
    os.environ["PT_ACCEPTANCE_WORKSPACE_ID"] = store.workspace_id
    os.environ["PT_ACCEPTANCE_GATE_ID"] = AGENT_V2_GOVERNED_TOOL_GATE
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
    provider_fixture = OpenAIProviderFixture()
    provider_bridge = RemoteProviderBridge(deployment_environment)
    runtime_pair: FoundationRuntimePair | None = None
    native_adapter = None
    original_clipboard: bytes | None = None
    manifest = None
    capture: dict[str, Any] = {}
    assertions: dict[str, bool] = {}
    primary_error: BaseException | None = None
    cleanup: dict[str, Any] = {
        "status": "clean",
        "clients": None,
        "providerBridge": None,
        "providerFixtureStopped": False,
        "provisionerResourcesReleased": [],
        "clipboard": {
            "fixtureSeeded": False,
            "fixtureRoundTrip": False,
            "restored": False,
        },
        "failures": [],
    }

    try:
        native_adapter = create_native_desktop_adapter()
        original_clipboard = native_adapter.read_clipboard()
        manifest = provisioner.provision(AGENT_V2_GOVERNED_TOOL_GATE)
        require(
            manifest.state.value == "FIXTURE_READY",
            (
                "J03 provisioning did not become ready: "
                f"{manifest.blocked_reason or manifest.state.value}"
            ),
        )
        provider_fixture.start()
        provider_base_url = provider_bridge.start(
            provider_fixture.port,
            artifact_run_id,
        )
        runtime_pair = FoundationRuntimePair.from_manifest(
            _build_client_manifest(manifest.to_dict()),
            profile_env=profile_env,
            startup_timeout=900,
        )
        client = runtime_pair.native
        seeded_identity = seed_native_actor_identity(
            fixture_root=J02_IDENTITY_FIXTURE,
            target_root=client.actor_identity_root,
            station_url=profile_env["PT_STATION_URL"],
        )
        client.start()
        login = authenticate_native_client(client, profile_env)
        identity_metadata = persist_native_actor_identity(
            source_root=client.actor_identity_root,
            fixture_root=J02_IDENTITY_FIXTURE,
            station_url=profile_env["PT_STATION_URL"],
            actor_id=str(login["actorId"]),
        )
        native_adapter.write_clipboard(FIXTURE_CLIPBOARD_BYTES)
        fixture_round_trip = (
            native_adapter.read_clipboard() == FIXTURE_CLIPBOARD_BYTES
        )
        cleanup["clipboard"]["fixtureSeeded"] = True
        cleanup["clipboard"]["fixtureRoundTrip"] = fixture_round_trip
        require(fixture_round_trip, "clipboard fixture did not round-trip")
        sample_id = f"mca-j03-{artifact_run_id}"
        journey = client.harness(
            "runGovernedToolDevelopment",
            {
                "sampleId": sample_id,
                "providerBaseUrl": provider_base_url,
            },
            timeout=900,
        )
        require(
            isinstance(journey, Mapping),
            "V2-J03 Harness returned invalid evidence",
        )
        provider_requests = provider_fixture.snapshot()
        capture = {
            "identityFixture": identity_fixture_evidence(
                identity_metadata,
                reused=seeded_identity is not None,
            ),
            "providerFixture": {
                "requestCount": len(provider_requests),
                "requests": provider_requests,
                "tunnel": {
                    "reversePort": provider_bridge.reverse_port,
                    "bridgePort": provider_bridge.bridge_port,
                },
            },
            "journey": dict(journey),
        }
        assertions = evaluate_governed_tool(journey, provider_requests)
    except BaseException as error:
        primary_error = error
    finally:
        if native_adapter is not None and original_clipboard is not None:
            try:
                native_adapter.write_clipboard(original_clipboard)
                cleanup["clipboard"]["restored"] = (
                    native_adapter.read_clipboard() == original_clipboard
                )
                if not cleanup["clipboard"]["restored"]:
                    cleanup["status"] = "failed"
                    cleanup["failures"].append(
                        "clipboard fixture restoration did not round-trip"
                    )
            except BaseException as error:
                cleanup["status"] = "failed"
                cleanup["failures"].append(
                    "clipboard fixture restoration: "
                    f"{type(error).__name__}: {error}"
                )
        if runtime_pair is not None:
            try:
                cleanup["nativeRuntimeLogs"] = copy_native_runtime_logs(
                    runtime_pair.native,
                    artifact_dir,
                )
            except BaseException as error:
                cleanup["status"] = "failed"
                cleanup["failures"].append(
                    "Native runtime log capture: "
                    f"{type(error).__name__}: {error}"
                )
            try:
                cleanup["clients"] = cleanup_clients(runtime_pair)
                if cleanup["clients"].get("status") != "clean":
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
        "capture": capture,
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
    result_path = artifact_dir / "result.json"
    result_path.write_text(
        json.dumps(result, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    attestation_run.close()
    shutil.rmtree(attestation_root, ignore_errors=True)
    sys.stdout.write(f"{result_path}\n")
    if primary_error is not None:
        traceback.print_exception(
            type(primary_error),
            primary_error,
            primary_error.__traceback__,
        )
    return 0 if result_name == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
