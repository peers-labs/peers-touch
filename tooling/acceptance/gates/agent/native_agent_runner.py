#!/usr/bin/env python3
"""Native Tauri Agent acceptance runner.

The stream-resilience journey consumes the provisioned One-profile runtime,
injects a real transport fault between Desktop and Station, and writes all
evidence through the external Acceptance Evidence Store.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
import urllib.request
from urllib.parse import urlparse

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT))

from selenium import webdriver
from selenium.webdriver.chrome.options import Options as ChromeOptions

from tooling.acceptance.core import (
    ArtifactRef,
    ArtifactSession,
    CredentialRef,
    EvidenceStore,
    current_artifact_ref,
    load_json_artifact,
    load_runtime_manifest,
)
from tooling.acceptance.core.harness import call_async_harness
from tooling.acceptance.core.provisioner import load_env_file


GATE_BY_JOURNEY = {
    "turn": "agent-native-turn-e2e",
    "stream-resilience": "agent-stream-resilience-e2e",
}
APPROVED_PROFILE = os.environ.get("PT_ACCEPTANCE_APPROVED_PROFILE", "one")
WAIT_TICK = threading.Event()
DEFAULT_TIMEOUT = float(os.environ.get("PT_AGENT_NATIVE_STEP_TIMEOUT_SECONDS", "120"))
STARTUP_TIMEOUT = float(os.environ.get("PT_AGENT_NATIVE_STARTUP_TIMEOUT_SECONDS", "900"))


class JourneyError(RuntimeError):
    """Fail-closed product journey error."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise JourneyError(message)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def wait_until(
    predicate: Callable[[], Any],
    description: str,
    timeout: float = DEFAULT_TIMEOUT,
    interval: float = 0.2,
) -> Any:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            value = predicate()
            if value:
                return value
        except JourneyError:
            raise
        except Exception as error:  # noqa: BLE001 - retained for Gate diagnostics.
            last_error = error
        WAIT_TICK.wait(min(interval, max(0.0, deadline - time.monotonic())))
    suffix = f"; last error: {last_error}" if last_error else ""
    raise JourneyError(f"timed out waiting for {description}{suffix}")


def port_open(port: int) -> bool:
    with socket.socket() as probe:
        return probe.connect_ex(("127.0.0.1", port)) == 0


class TcpFaultProxy:
    """Transparent TCP proxy whose active connections can be cut deterministically."""

    def __init__(self, upstream_host: str, upstream_port: int) -> None:
        self.upstream_host = upstream_host
        self.upstream_port = upstream_port
        self.listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen()
        self.listener.settimeout(0.2)
        self.port = int(self.listener.getsockname()[1])
        self._enabled = threading.Event()
        self._enabled.set()
        self._stopped = threading.Event()
        self._connections: set[socket.socket] = set()
        self._lock = threading.Lock()
        self._thread = threading.Thread(
            target=self._accept_loop,
            name="agent-stream-fault-proxy",
            daemon=True,
        )

    @classmethod
    def from_url(cls, station_url: str) -> TcpFaultProxy:
        parsed = urlparse(station_url)
        require(parsed.scheme == "http", "R6 fault proxy requires an http Station URL")
        require(bool(parsed.hostname), "Station URL is missing a host")
        return cls(parsed.hostname or "", parsed.port or 80)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    @property
    def is_alive(self) -> bool:
        return self._thread.is_alive() and not self._stopped.is_set()

    def start(self) -> None:
        self._thread.start()

    def cut(self) -> None:
        self._enabled.clear()
        self._close_active_connections()

    def restore(self) -> None:
        self._enabled.set()

    def close(self) -> None:
        self._stopped.set()
        self._enabled.set()
        try:
            self.listener.close()
        except OSError:
            pass
        self._close_active_connections()
        self._thread.join(timeout=3)

    def _track(self, connection: socket.socket) -> None:
        with self._lock:
            self._connections.add(connection)

    def _untrack(self, connection: socket.socket) -> None:
        with self._lock:
            self._connections.discard(connection)

    def _close_active_connections(self) -> None:
        with self._lock:
            active = tuple(self._connections)
            self._connections.clear()
        for connection in active:
            try:
                connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                connection.close()
            except OSError:
                pass

    def _accept_loop(self) -> None:
        while not self._stopped.is_set():
            try:
                downstream, _ = self.listener.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            if not self._enabled.is_set():
                downstream.close()
                continue
            try:
                upstream = socket.create_connection(
                    (self.upstream_host, self.upstream_port),
                    timeout=10,
                )
            except OSError:
                downstream.close()
                continue
            downstream.settimeout(None)
            upstream.settimeout(None)
            self._track(downstream)
            self._track(upstream)
            threading.Thread(
                target=self._pump,
                args=(downstream, upstream),
                daemon=True,
            ).start()
            threading.Thread(
                target=self._pump,
                args=(upstream, downstream),
                daemon=True,
            ).start()

    def _pump(self, source: socket.socket, target: socket.socket) -> None:
        try:
            while not self._stopped.is_set() and self._enabled.is_set():
                chunk = source.recv(64 * 1024)
                if not chunk:
                    break
                target.sendall(chunk)
        except OSError:
            pass
        finally:
            for connection in (source, target):
                self._untrack(connection)
                try:
                    connection.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                try:
                    connection.close()
                except OSError:
                    pass


class AgentNativeJourney:
    def __init__(self, journey: str) -> None:
        self.journey = journey
        self.gate_id = GATE_BY_JOURNEY[journey]
        manifest_value = os.environ.get("PT_ACCEPTANCE_RUNTIME_MANIFEST", "").strip()
        require(bool(manifest_value), "PT_ACCEPTANCE_RUNTIME_MANIFEST is required")
        self.runtime_manifest_path = Path(manifest_value)
        self.runtime_manifest = load_runtime_manifest(
            self.runtime_manifest_path,
            self.gate_id,
        )
        self.runtime_manifest_ref = current_artifact_ref(
            "runtime/environment-manifest.json",
            repo_root=REPO_ROOT,
        ).to_dict()
        require(
            self.runtime_manifest.get("profile", {}).get("resolvedName")
            == APPROVED_PROFILE,
            f"{self.gate_id} requires the approved {APPROVED_PROFILE} profile",
        )
        clients = self.runtime_manifest.get("clients")
        require(
            isinstance(clients, list) and len(clients) == 1,
            f"{self.gate_id} requires exactly one isolated native client",
        )
        self.client = clients[0]
        require(isinstance(self.client, dict), "runtime client entry must be an object")
        station = self.runtime_manifest.get("station")
        require(isinstance(station, dict), "runtime Station attestation is required")
        self.station_url = str(station.get("url") or "").rstrip("/")
        require(bool(self.station_url), "runtime Station URL is required")

        self.evidence_store = EvidenceStore.from_environment(
            repo_root=REPO_ROOT,
            worktree=REPO_ROOT,
        )
        actor_ref = ArtifactRef.from_dict(
            self.runtime_manifest.get("actorManifest") or {}
        )
        actor_manifest = load_json_artifact(
            self.evidence_store.resolve(actor_ref),
            "acceptance-actor-manifest",
        )
        actors = actor_manifest.get("actors")
        require(isinstance(actors, list) and len(actors) == 1, "one actor is required")
        actor = actors[0]
        require(isinstance(actor, dict), "actor manifest entry must be an object")
        account_ref = str(actor.get("accountRef") or "")
        require(
            account_ref.startswith("station-account:"),
            "actor accountRef must be Station-owned",
        )
        self.email = account_ref.removeprefix("station-account:")
        credential_refs = actor_manifest.get("credentialRefs")
        require(
            isinstance(credential_refs, list) and len(credential_refs) == 1,
            "actor manifest requires one credential reference",
        )
        self.password = CredentialRef(
            id="agent-actor-password",
            source_ref=str(credential_refs[0]),
        ).resolve()

        active_profile = (
            REPO_ROOT
            / ".local"
            / "dev"
            / "active"
            / f"{REPO_ROOT.name}.env"
        )
        require(
            active_profile.exists() or active_profile.is_symlink(),
            "active One profile is missing",
        )
        self.profile_env = load_env_file(active_profile.resolve(strict=True))
        require(
            self.profile_env.get("PT_DEV_PROFILE") == APPROVED_PROFILE,
            "active profile identity changed after provisioning",
        )
        self.provider_id = self.profile_env.get("PT_AGENT_PROVIDER_ID", "").strip()
        self.provider_key = CredentialRef(
            id="agent-provider-api-key",
            source_ref="env:PT_AGENT_PROVIDER_API_KEY",
        ).resolve()
        self.model_id = self.profile_env.get(
            "PT_AGENT_DEFAULT_MODEL_ID",
            "",
        ).strip()
        self.provider_base_url = self.profile_env.get(
            "PT_AGENT_PROVIDER_BASE_URL",
            "",
        ).strip()
        require(bool(self.provider_id), "One profile is missing PT_AGENT_PROVIDER_ID")
        require(bool(self.model_id), "One profile is missing PT_AGENT_DEFAULT_MODEL_ID")
        require(
            bool(self.provider_base_url),
            "One profile is missing PT_AGENT_PROVIDER_BASE_URL",
        )

        self.gateway_port = int(self.client.get("gateway_port") or 0)
        self.renderer_port = int(self.client.get("renderer_port") or 0)
        self.webdriver_port = int(self.client.get("webdriver_port") or 0)
        self.storage_root = Path(str(self.client.get("storage_root") or ""))
        require(
            all((self.gateway_port, self.renderer_port, self.webdriver_port)),
            "runtime client ports are incomplete",
        )
        require(str(self.storage_root), "runtime client storage root is missing")
        self.run_root = self.storage_root.parent
        self.runtime_profile = self.run_root / f"{APPROVED_PROFILE}.env"
        self.desktop_log = self.run_root / "desktop.log"
        self.proxy = TcpFaultProxy.from_url(self.station_url)
        self.process: subprocess.Popen[str] | None = None
        self.log_handle: Any = None
        self.driver: Any = None
        self.steps: list[dict[str, Any]] = []
        self.assertions: list[dict[str, Any]] = []
        self.station_readback: dict[str, Any] = {}
        self.dom_evidence: dict[str, Any] = {}
        self.cleanup_evidence: dict[str, Any] = {"status": "not-run"}

    def step(self, name: str, operation: Callable[[], Any]) -> Any:
        started = time.monotonic()
        entry: dict[str, Any] = {
            "step": name,
            "status": "running",
            "startedAt": now_iso(),
        }
        self.steps.append(entry)
        try:
            result = operation()
            entry.update(
                status="passed",
                completedAt=now_iso(),
                durationMs=int((time.monotonic() - started) * 1000),
            )
            return result
        except Exception as error:
            entry.update(
                status="failed",
                completedAt=now_iso(),
                durationMs=int((time.monotonic() - started) * 1000),
                error=str(error),
            )
            raise

    def harness(
        self,
        method: str,
        payload: dict[str, Any] | None = None,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> Any:
        return call_async_harness(
            self.driver,
            method,
            payload,
            namespace="agent",
            script_timeout=timeout,
        )

    def _write_runtime_profile(self) -> None:
        self.run_root.mkdir(parents=True, exist_ok=True)
        self.storage_root.mkdir(parents=True, exist_ok=True)
        values = {
            **self.profile_env,
            "PT_DEV_PROFILE": APPROVED_PROFILE,
            "PT_STATION_URL": self.proxy.url,
            "PT_STATION_HEALTH_URL": f"{self.proxy.url}/app-meta/version",
            "PT_DESKTOP_APP_GATEWAY_PORT": str(self.gateway_port),
            "PT_DESKTOP_APP_WEB_PORT": str(self.renderer_port),
        }
        self.runtime_profile.write_text(
            "\n".join(f"{key}={value}" for key, value in sorted(values.items()))
            + "\n",
            encoding="utf-8",
        )
        self.runtime_profile.chmod(0o600)

    def start(self) -> None:
        self.proxy.start()
        self._write_runtime_profile()
        self.log_handle = self.desktop_log.open("w", encoding="utf-8")
        environment = os.environ.copy()
        environment.update(
            {
                "WORKTREE_ID": REPO_ROOT.name,
                "PT_DEV_PROFILE": APPROVED_PROFILE,
                "PT_DEV_PROFILE_FILE": str(self.runtime_profile),
                "PT_DESKTOP_APP_GATEWAY_PORT": str(self.gateway_port),
                "PT_DESKTOP_APP_WEB_PORT": str(self.renderer_port),
                "PEERS_STORAGE_ROOT": str(self.storage_root),
                "PT_STATION_MODE": "remote",
                "PT_STATION_URL": self.proxy.url,
                "PEERS_STATION_URL": self.proxy.url,
                "PT_DESKTOP_E2E": "true",
                "TAURI_WEBDRIVER_PORT": str(self.webdriver_port),
                "RESTART": "1",
                "CARGO_BUILD_JOBS": "1",
            }
        )
        self.process = subprocess.Popen(
            ["make", "desktop"],
            cwd=REPO_ROOT,
            env=environment,
            stdout=self.log_handle,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )

        def webdriver_ready() -> bool:
            if self.process is not None and self.process.poll() is not None:
                raise JourneyError(
                    f"Desktop exited with code {self.process.returncode}"
                )
            return port_open(self.webdriver_port)

        wait_until(webdriver_ready, "embedded WebDriver", STARTUP_TIMEOUT)
        self.driver = webdriver.Remote(
            command_executor=f"http://127.0.0.1:{self.webdriver_port}",
            options=ChromeOptions(),
        )
        self.driver.set_script_timeout(DEFAULT_TIMEOUT)
        wait_until(
            lambda: bool(
                self.driver.execute_script(
                    "return Boolean(document.querySelector('#root')"
                    " && window.__PT_ACCEPTANCE__?.agent)"
                )
            ),
            "Agent acceptance harness",
            DEFAULT_TIMEOUT,
        )

    def login(self) -> dict[str, Any]:
        result = self.harness(
            "loginWithPassword",
            {"account": self.email, "password": self.password},
            timeout=60,
        )
        require(
            isinstance(result, dict)
            and result.get("authenticated") is True
            and bool(result.get("actorId")),
            "Agent actor login failed",
        )
        return result

    def verify_proxy_health(self) -> dict[str, Any]:
        require(self.proxy.is_alive, "Station fault proxy thread is not alive")
        with urllib.request.urlopen(
            f"{self.proxy.url}/app-meta/version",
            timeout=10,
        ) as response:
            payload = json.loads(response.read().decode("utf-8"))
        require(
            isinstance(payload, dict)
            and str(payload.get("build_commit") or "").lower()
            not in {"", "unknown"},
            "Station fault proxy does not preserve runtime identity",
        )
        return {
            "proxyPort": self.proxy.port,
            "status": response.status,
            "buildCommit": payload.get("build_commit"),
        }

    def navigate_and_configure(self) -> None:
        self.harness("navigateToAgent", timeout=60)
        configured = self.harness(
            "ensureProvider",
            {
                "providerId": self.provider_id,
                "apiKey": self.provider_key,
                "modelId": self.model_id,
                "baseUrl": self.provider_base_url,
            },
            timeout=60,
        )
        require(
            isinstance(configured, dict) and configured.get("configured") is True,
            "Agent provider setup failed",
        )

    def runtime_snapshot(self) -> dict[str, Any]:
        snapshot = self.harness("getRuntimeSnapshot")
        require(isinstance(snapshot, dict), "runtime snapshot must be an object")
        return snapshot

    def active_snapshot(
        self,
        *,
        minimum_seq: int = 1,
        require_content: bool = False,
    ) -> dict[str, Any] | None:
        snapshot = self.runtime_snapshot()
        operation = snapshot.get("operation")
        if not isinstance(operation, dict):
            return None
        if operation.get("runState") in {"completed", "failed", "cancelled"}:
            raise JourneyError(
                "Agent operation reached a terminal state before the observation point: "
                f"{operation.get('runState')}"
            )
        if (
            operation.get("runState") not in {"streaming", "reconciling"}
            or not operation.get("turnId")
            or not operation.get("conversationId")
            or int(operation.get("lastEventSeq") or 0) < minimum_seq
        ):
            return None
        if require_content:
            assistant = snapshot.get("assistant")
            if (
                not isinstance(assistant, dict)
                or not str(assistant.get("content") or "")
            ):
                return None
        return snapshot

    def completed_snapshot(self, conversation_id: str) -> dict[str, Any] | None:
        snapshot = self.runtime_snapshot()
        operation = snapshot.get("operation")
        assistant = snapshot.get("assistant")
        if not isinstance(operation, dict) or not isinstance(assistant, dict):
            return None
        if operation.get("runState") in {"failed", "cancelled"}:
            raise JourneyError(
                "Agent operation reached an unexpected terminal state: "
                f"{operation.get('runState')}"
            )
        if (
            operation.get("conversationId") != conversation_id
            or operation.get("runState") != "completed"
            or assistant.get("loading") is True
            or assistant.get("error")
            or not str(assistant.get("content") or "")
        ):
            return None
        return snapshot

    def send_long_turn(self, label: str) -> None:
        prompt = (
            f"{label}. Count from 1 through 20, one number per line, "
            "with no other text."
        )
        sent = self.harness("sendMessage", {"content": prompt}, timeout=30)
        require(isinstance(sent, dict) and sent.get("sent") is True, "send failed")

    def dom_state(self, selector: str) -> dict[str, Any]:
        state = self.driver.execute_script(
            """
            const selector = arguments[0];
            const matches = Array.from(document.querySelectorAll(selector));
            return {
              count: matches.length,
              visible: matches.some((element) => element.getClientRects().length > 0),
              values: matches.map((element) => ({
                status: element.getAttribute('data-pt-agent-operation-status')
                  || element.getAttribute('data-pt-agent-background-operation-status')
                  || '',
                title: element.getAttribute('title') || '',
                text: (element.textContent || '').trim(),
              })),
            };
            """,
            selector,
        )
        require(isinstance(state, dict), f"selector {selector} returned invalid DOM state")
        return state

    def assert_visible(self, selector: str, expected: bool) -> dict[str, Any]:
        state = self.dom_state(selector)
        require(
            bool(state.get("visible")) is expected,
            f"selector {selector} visible={state.get('visible')}, expected={expected}",
        )
        return state

    def conversation_readback(self, conversation_id: str) -> dict[str, Any]:
        result = self.harness(
            "getConversationReadback",
            {"conversationId": conversation_id},
            timeout=60,
        )
        require(isinstance(result, dict), "Station conversation readback is invalid")
        return result

    def run_turn(self) -> None:
        self.step("login", self.login)
        self.step("navigate_and_configure", self.navigate_and_configure)
        self.step("send_turn", lambda: self.send_long_turn("Native Agent turn"))
        active = self.step(
            "wait_active_turn",
            lambda: wait_until(
                lambda: self.active_snapshot(minimum_seq=1),
                "active Agent turn",
            ),
        )
        conversation_id = str(active["operation"]["conversationId"])
        completed = self.step(
            "wait_turn_completed",
            lambda: wait_until(
                lambda: self.completed_snapshot(conversation_id),
                "completed Agent turn",
                DEFAULT_TIMEOUT,
            ),
        )
        self.assertions.append(
            {
                "id": "agent.native.turn.completed",
                "status": "pass",
                "assistantMessageId": completed["assistant"]["id"],
            }
        )

    def run_stream_resilience(self) -> None:
        self.step("login", self.login)
        self.step("navigate_and_configure", self.navigate_and_configure)
        self.step("send_replay_turn", lambda: self.send_long_turn("R6 replay"))
        before_fault = self.step(
            "wait_active_turn",
            lambda: wait_until(
                lambda: self.active_snapshot(minimum_seq=2),
                "persisted active Agent turn",
                interval=0.02,
            ),
        )
        operation = before_fault["operation"]
        conversation_id = str(operation["conversationId"])
        turn_id = str(operation["turnId"])
        before_seq = int(operation["lastEventSeq"])
        before_content = str((before_fault.get("assistant") or {}).get("content") or "")
        self.dom_evidence["beforeFault"] = {
            "runtime": {
                "currentSessionKey": before_fault.get("currentSessionKey"),
                "isStreaming": before_fault.get("isStreaming"),
                "operationCount": before_fault.get("operationCount"),
                "operation": operation,
                "assistantContentLength": len(before_content),
            },
            "composer": self.dom_state("[data-pt-agent-composer]"),
            "operationTray": self.dom_state("[data-pt-agent-operation-status]"),
            "buttons": self.dom_state("button"),
        }
        require(
            before_fault.get("isStreaming") is True,
            "active operation is not projected as current-session streaming",
        )
        stop_dom = self.step(
            "stop_control_visible",
            lambda: wait_until(
                lambda: (
                    state
                    if (
                        state := self.dom_state(
                            "[data-pt-agent-stop]"
                        )
                    ).get("visible")
                    else None
                ),
                "visible Agent stop control",
                15,
            ),
        )

        self.step("cut_station_transport", self.proxy.cut)
        reconciling = self.step(
            "reconciling_visible",
            lambda: wait_until(
                lambda: (
                    state
                    if (
                        (
                            state := self.dom_state(
                                '[data-pt-agent-operation-status="reconciling"]'
                            )
                        ).get("visible")
                        and self.runtime_snapshot().get("operation", {}).get("runState")
                        == "reconciling"
                    )
                    else None
                ),
                "visible reconciling operation",
                30,
            ),
        )
        self.step("restore_station_transport", self.proxy.restore)
        completed = self.step(
            "cursor_replay_completed",
            lambda: wait_until(
                lambda: self.completed_snapshot(conversation_id),
                "cursor replay completion",
                DEFAULT_TIMEOUT,
            ),
        )
        after_seq = int(completed["operation"].get("lastEventSeq") or 0)
        assistant_content = str(completed["assistant"]["content"])
        require(after_seq > before_seq, "cursor did not advance after reconnect")
        require(
            assistant_content.startswith(before_content),
            "replayed projection lost the acknowledged prefix",
        )
        station = self.step(
            "station_replay_readback",
            lambda: self.conversation_readback(conversation_id),
        )
        station_assistant = next(
            (
                message
                for message in station.get("messages", [])
                if isinstance(message, dict)
                and message.get("role") == "assistant"
                and message.get("turnId") == turn_id
            ),
            None,
        )
        require(
            isinstance(station_assistant, dict),
            "Station readback is missing the replayed assistant message",
        )
        require(
            station_assistant.get("content") == assistant_content,
            "Desktop replay projection differs from Station persisted content",
        )
        self.station_readback["replay"] = {
            "conversationId": conversation_id,
            "turnId": turn_id,
            "beforeSeq": before_seq,
            "afterSeq": after_seq,
            "stationMessageId": station_assistant.get("messageId"),
            "contentMatches": True,
        }
        self.dom_evidence["reconciling"] = reconciling
        self.dom_evidence["stopControl"] = stop_dom

        self.step("send_identity_boundary_turn", lambda: self.send_long_turn("R6 logout"))
        identity_active = self.step(
            "wait_identity_boundary_turn",
            lambda: wait_until(
                lambda: self.active_snapshot(minimum_seq=1),
                "active turn before logout",
            ),
        )
        identity_operation = identity_active["operation"]
        identity_turn_id = str(identity_operation["turnId"])
        identity_conversation_id = str(identity_operation["conversationId"])
        logout = self.step("logout_during_active_turn", lambda: self.harness("logout"))
        require(logout.get("operationCount") == 0, "logout left Agent operations alive")
        require(
            logout.get("previousOperationsAborted") is True,
            "logout did not abort every previous Agent operation",
        )
        auth_snapshot = self.step(
            "auth_gate_isolated",
            lambda: wait_until(
                lambda: (
                    {
                        "operation": operation_state,
                        "backgroundOperation": background_state,
                        "login": login_state,
                    }
                    if (
                        not (operation_state := self.dom_state(
                            "[data-pt-agent-operation-status]"
                        )).get("visible")
                        and not (background_state := self.dom_state(
                            "[data-pt-agent-background-operation-status]"
                        )).get("visible")
                        and (login_state := self.dom_state(
                            "[data-login-email], [data-login-add-account], [data-login-tab]"
                        )).get("visible")
                    )
                    else None
                ),
                "isolated auth gate with no Agent operation tray",
                30,
            ),
        )
        self.dom_evidence["authGate"] = auth_snapshot

        self.step("relogin", self.login)
        after_relogin = self.step("relogin_projection_isolated", self.runtime_snapshot)
        require(
            after_relogin.get("operationCount") == 0
            and after_relogin.get("messageCount") == 0,
            "re-login restored a previous actor operation projection",
        )
        persisted = self.step(
            "station_identity_boundary_readback",
            lambda: self.conversation_readback(identity_conversation_id),
        )
        persisted_turn_messages = [
            message
            for message in persisted.get("messages", [])
            if isinstance(message, dict)
            and message.get("turnId") == identity_turn_id
        ]
        require(
            bool(persisted_turn_messages),
            "Station readback is missing the operation aborted at logout",
        )
        self.station_readback["identityBoundary"] = {
            "conversationId": identity_conversation_id,
            "turnId": identity_turn_id,
            "persistedTurnMessageCount": len(persisted_turn_messages),
            "clientOperationCountAfterRelogin": after_relogin.get("operationCount"),
        }
        self.assertions.extend(
            [
                {
                    "id": "r6.reconciling.visible",
                    "status": "pass",
                    "beforeSeq": before_seq,
                    "afterSeq": after_seq,
                },
                {
                    "id": "r6.cursor-replay.station-equal",
                    "status": "pass",
                    "conversationId": conversation_id,
                    "turnId": turn_id,
                },
                {
                    "id": "r6.identity-boundary.zero-tray",
                    "status": "pass",
                    "turnId": identity_turn_id,
                },
                {
                    "id": "r6.identity-boundary.station-readback",
                    "status": "pass",
                    "turnId": identity_turn_id,
                },
            ]
        )

    def best_effort_logout(self) -> None:
        if self.driver is None:
            return
        try:
            snapshot = self.runtime_snapshot()
            if snapshot.get("authenticated"):
                self.harness("logout", timeout=30)
        except Exception:  # noqa: BLE001 - cleanup result records failures separately.
            pass

    def cleanup(self) -> dict[str, Any]:
        failures: list[str] = []
        self.best_effort_logout()
        if self.driver is not None:
            try:
                self.driver.quit()
            except Exception as error:  # noqa: BLE001
                failures.append(f"webdriver: {error}")
            self.driver = None
        if self.process is not None and self.process.poll() is None:
            try:
                os.killpg(self.process.pid, signal.SIGTERM)
                self.process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                os.killpg(self.process.pid, signal.SIGKILL)
                self.process.wait(timeout=5)
            except Exception as error:  # noqa: BLE001
                failures.append(f"desktop-process: {error}")
        self.proxy.close()
        if self.log_handle is not None:
            self.log_handle.flush()
            self.log_handle.close()
            self.log_handle = None
        shutil.rmtree(self.storage_root, ignore_errors=True)
        ports = {
            "gateway": not port_open(self.gateway_port),
            "renderer": not port_open(self.renderer_port),
            "webdriver": not port_open(self.webdriver_port),
            "faultProxy": not port_open(self.proxy.port),
        }
        if not all(ports.values()):
            failures.append(f"ports still listening: {ports}")
        if self.storage_root.exists():
            failures.append(f"storage remains: {self.storage_root}")
        self.cleanup_evidence = {
            "status": "passed" if not failures else "failed",
            "portsReleased": ports,
            "storageReleased": not self.storage_root.exists(),
            "failures": failures,
        }
        return self.cleanup_evidence


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--journey",
        choices=tuple(GATE_BY_JOURNEY),
        default="turn",
    )
    return parser.parse_args()


def run_journey(journey_name: str) -> int:
    gate_id = GATE_BY_JOURNEY[journey_name]
    status = "failed"
    failure = ""
    runner: AgentNativeJourney | None = None
    with ArtifactSession(repo_root=REPO_ROOT, gate_id=gate_id) as artifacts:
        started_at = now_iso()
        try:
            runner = AgentNativeJourney(journey_name)
            runner.step("start_native_runtime", runner.start)
            runner.step("fault_proxy_health", runner.verify_proxy_health)
            if journey_name == "stream-resilience":
                runner.run_stream_resilience()
            else:
                runner.run_turn()
            status = "passed"
        except Exception as error:  # noqa: BLE001 - Gate must persist failure evidence.
            failure = str(error)
        finally:
            cleanup = (
                runner.cleanup()
                if runner is not None
                else {"status": "not-started", "failures": []}
            )
            if cleanup.get("status") == "failed":
                status = "failed"
                cleanup_failure = "; ".join(cleanup.get("failures") or [])
                failure = (
                    f"{failure}; cleanup failed: {cleanup_failure}"
                    if failure
                    else f"cleanup failed: {cleanup_failure}"
                )

        report = {
            "artifactKind": "agent-native-journey-report",
            "gateId": gate_id,
            "journey": journey_name,
            "status": status,
            "completionStatus": "DONE" if status == "passed" else "FAILED",
            "proofStatus": "PROVEN" if status == "passed" else "UNPROVEN",
            "phase": "Residual Product Closure",
            "bom": ["R6"],
            "spec": [
                "tooling/acceptance/features/agent-stream-resilience.yaml",
                "docs/architecture/agent/execution-plans/20260816-lobehub-parity-full-landing.md",
            ],
            "gate": (
                "R6 requires visible reconnecting state, monotonic cursor replay "
                "equal to Station readback, identity-boundary teardown, and "
                "resource cleanup."
            ),
            "sampleEmissionAllowed": status == "passed",
            "startedAt": started_at,
            "completedAt": now_iso(),
            "steps": runner.steps if runner is not None else [],
            "assertions": runner.assertions if runner is not None else [],
            "runtimeManifest": (
                runner.runtime_manifest_ref
                if runner is not None
                else {}
            ),
            "stationReadback": (
                runner.station_readback if runner is not None else {}
            ),
            "receiverDom": runner.dom_evidence if runner is not None else {},
            "cleanup": cleanup,
            "error": failure,
        }
        evidence_metadata = {
            key: report[key]
            for key in (
                "status",
                "completionStatus",
                "proofStatus",
                "phase",
                "bom",
                "spec",
                "gate",
                "sampleEmissionAllowed",
            )
        }
        artifacts.write_json(
            "reports/agent-native-journey.json",
            report,
            role="report",
        )
        artifacts.write_json(
            "evidence/receiver-dom.json",
            {
                "artifactKind": "agent-native-receiver-dom",
                **evidence_metadata,
                "evidence": report["receiverDom"],
            },
            role="receiver-dom",
        )
        artifacts.write_json(
            "evidence/station-readback.json",
            {
                "artifactKind": "agent-native-station-readback",
                **evidence_metadata,
                "evidence": report["stationReadback"],
            },
            role="station-readback",
        )
        artifacts.write_json(
            "evidence/cleanup.json",
            {
                "artifactKind": "agent-native-cleanup",
                **evidence_metadata,
                "evidence": cleanup,
            },
            role="cleanup",
        )
        if runner is not None and runner.desktop_log.is_file():
            artifacts.write_bytes(
                "logs/desktop.log",
                runner.desktop_log.read_bytes(),
                media_type="text/plain",
            )
        artifacts.complete(
            status=status,
            completion_status="DONE" if status == "passed" else "FAILED",
            proof_status="PROVEN" if status == "passed" else "UNPROVEN",
            runtime={
                "environment": "home-station",
                "profile": APPROVED_PROFILE,
                "journey": journey_name,
            },
        )

    if status == "passed":
        print(f"PASS: {gate_id}")
        return 0
    print(f"FAIL: {gate_id}: {failure}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    arguments = parse_args()
    raise SystemExit(run_journey(arguments.journey))
