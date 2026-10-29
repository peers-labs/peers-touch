#!/usr/bin/env python3
"""Native Tauri Agent acceptance runner.

Each journey consumes the provisioned approved-profile runtime and writes evidence
through the external Acceptance Evidence Store. Stream resilience additionally
injects a real transport fault between Desktop and Station.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import shutil
import socket
import sys
import tempfile
import threading
import time
from collections.abc import Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
import urllib.request

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core import (
    ArtifactRef,
    ArtifactSession,
    EvidenceStore,
    current_artifact_ref,
    load_json_artifact,
    load_runtime_manifest,
    require_runtime_service,
)
from tooling.acceptance.core.harness import call_async_harness
from tooling.acceptance.core.provisioner import (
    load_env_file,
    resolve_machine_profile_environment,
)
from tooling.acceptance.drivers.tauri import LocalTauriLauncher, TauriSession
from tooling.acceptance.drivers.native import (
    NativeLaunchOptions,
    NativeKey,
    MouseAction,
    NativeModifier,
    resolve_native_desktop_runtime,
)
from tooling.acceptance.gates.agent.capability_binding_development import (
    OPERATION_SCENARIO_IDENTITY_FIXTURE,
    seed_native_actor_identity,
)
from tooling.acceptance.gates.agent.foundation_direct_adapter import (
    DirectRuntimeProbeInput,
)
from tooling.acceptance.gates.agent.foundation_group_one_probe import (
    assert_group_one_capture,
)
from tooling.acceptance.gates.agent.governed_tool_development import (
    OpenAIProviderFixture,
    RemoteProviderBridge,
)
from tooling.acceptance.gates.agent.mcp_lifecycle_development import (
    MCP_BLOCK_ON_LAUNCH,
    MCP_FIXTURE_SCRIPT,
    MCP_RESULT_TEXT,
    MCP_TOOL_NAME,
    inspect_mcp_fixture,
)
from tooling.acceptance.gates.agent.tcp_fault_proxy import TcpFaultProxy
from tooling.acceptance.gates.agent.chat_station_origin import ChatStationOrigin
from tooling.acceptance.gates.agent.chat_identity_fixture import resolve_chat_identity_fixture


GATE_BY_JOURNEY = {
    "chat-profile": "agent-chat-profile-native",
    "chat-models": "agent-chat-models-native",
    "chat-topics": "agent-chat-topics-native",
    "chat-conversation": "agent-chat-conversation-native",
    "chat-layout": "agent-chat-layout-native",
    "chat-workspace": "agent-chat-workspace-native",
    "chat-commands": "agent-slash-command-native-e2e",
    "chat-attribution": "agent-context-projection-native-e2e",
    "depth-linux": "agent-depth-linux-native-e2e",
    "agent-definition": "agent-definition-roundtrip-native-e2e",
    "turn": "agent-native-turn-e2e",
    "cli-provider": "agent-cli-provider-primary-native-e2e",
    "core-lifecycle": "agent-core-lifecycle-native-e2e",
    "minimum-usable-chat": "agent-minimum-usable-chat-native-e2e",
    "stream-resilience": "agent-stream-resilience-e2e",
    "attachment": "agent-attachment-e2e",
}
# These selectors are the integration contract with the Agent workbench UI.
# Keep lifecycle-specific selectors here so a parallel UI lane can bind them
# without changing journey semantics or scattering fallback selectors.
CORE_LIFECYCLE_SELECTORS = {
    "create": "[data-pt-agent-create]",
    "row": '[data-pt-agent-row][data-pt-agent-id="{agent_id}"]',
    "menu": '[data-pt-agent-menu][data-pt-agent-id="{agent_id}"]',
    "menu_action": (
        '[data-pt-agent-menu-action="{action}"]'
        '[data-pt-agent-id="{agent_id}"]'
    ),
    "profile": '[data-pt-agent-profile="{agent_id}"]',
    "profile_any": "[data-pt-agent-profile]",
    "profile_back": "[data-pt-agent-profile-back]",
    "profile_title": '[data-pt-agent-profile-title="{agent_id}"]',
    "profile_saved": (
        '[data-pt-agent-profile-save-state="saved"]'
        '[data-pt-agent-id="{agent_id}"]'
    ),
    "session_start": "[data-pt-agent-session-start]",
    "topic_error": "[data-pt-agent-topic-load-error]",
    "topic_retry": "[data-pt-agent-topic-load-retry]",
    "composer": "[data-pt-agent-composer]",
    "confirm_delete": '[data-pt-agent-delete-confirm="{agent_id}"]',
}
APPROVED_PROFILE = os.environ.get("PT_ACCEPTANCE_APPROVED_PROFILE", "one")
CHAT_APPROVED_PROFILE = os.environ.get("PT_ACCEPTANCE_APPROVED_PROFILE", "one-slave")
CORE_LIFECYCLE_PROFILE = "two"
CLI_PROVIDER_PROFILE = "two"
MINIMUM_USABLE_CHAT_PROFILE = "two"
WAIT_TICK = threading.Event()
DEFAULT_TIMEOUT = float(os.environ.get("PT_AGENT_NATIVE_STEP_TIMEOUT_SECONDS", "120"))


# #region debug-point A-D:c08-station-latency
def report_c08_latency_debug(
    hypothesis_id: str,
    message: str,
    data: Mapping[str, object],
) -> None:
    try:
        debug_env = load_env_file(
            REPO_ROOT / ".dbg" / "c08-station-latency.env"
        )
        endpoint = debug_env.get("DEBUG_SERVER_URL", "")
        session_id = debug_env.get(
            "DEBUG_SESSION_ID",
            "c08-station-latency",
        )
        if not endpoint:
            return
        request = urllib.request.Request(
            endpoint,
            data=json.dumps(
                {
                    "sessionId": session_id,
                    "runId": os.environ.get(
                        "PT_C08_DEBUG_RUN_ID",
                        "pre-fix",
                    ),
                    "hypothesisId": hypothesis_id,
                    "location": "native_agent_runner.py",
                    "msg": f"[DEBUG] {message}",
                    "data": dict(data),
                    "ts": time.time_ns() // 1_000_000,
                }
            ).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=0.25):
            pass
    except Exception:
        pass
# #endregion


class JourneyError(RuntimeError):
    """Fail-closed product journey error."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise JourneyError(message)


def active_direct_station_multiaddr(result: Mapping[str, Any]) -> str:
    data = result.get("data")
    status = data.get("status") if isinstance(data, Mapping) else None
    try:
        state = json.loads(status) if isinstance(status, str) else None
    except json.JSONDecodeError as error:
        raise JourneyError("station_list returned invalid status JSON") from error
    require(isinstance(state, Mapping), "station_list returned no state")
    active_peer_id = str(state.get("active_station_peer_id") or "").strip()
    entries = state.get("entries")
    require(
        bool(active_peer_id) and isinstance(entries, list),
        "active Station route is unavailable",
    )
    active_entries = [
        entry
        for entry in entries
        if isinstance(entry, Mapping)
        and entry.get("station_peer_id") == active_peer_id
    ]
    require(
        len(active_entries) == 1,
        "active Station identity is ambiguous",
    )
    entry = active_entries[0]
    active_route_id = str(entry.get("active_route_id") or "").strip()
    routes = entry.get("routes")
    require(
        bool(active_route_id) and isinstance(routes, list),
        "active Station route is unavailable",
    )
    active_routes = [
        route
        for route in routes
        if isinstance(route, Mapping)
        and route.get("route_id") == active_route_id
    ]
    require(
        len(active_routes) == 1
        and active_routes[0].get("route_type") == "direct",
        "Station fault injection requires one active Direct route",
    )
    addresses = active_routes[0].get("addresses")
    direct_addresses = (
        [
            address
            for address in addresses
            if isinstance(address, str)
            and "/p2p-circuit/" not in address
            and "/tcp/" in address
            and "/p2p/" in address
        ]
        if isinstance(addresses, list)
        else []
    )
    require(
        len(direct_addresses) == 1,
        "active Station Direct route must expose one TCP multiaddr",
    )
    return direct_addresses[0]


MODEL_RUNTIME_CAPABILITY_IDS = frozenset({
    "text-input",
    "image-input",
    "file-input",
    "audio-input",
    "text-output",
    "image-output",
    "structured-output",
    "streaming",
    "reasoning",
    "prompt-cache",
    "external-resume",
    "native-tools",
    "parallel-tools",
    "local-bridge",
})


def model_capability_config(
    flags: Mapping[str, bool],
) -> dict[str, dict[str, bool]]:
    unknown = sorted(set(flags) - MODEL_RUNTIME_CAPABILITY_IDS)
    require(not unknown, f"unknown runtime model capabilities: {unknown}")
    require(
        all(type(enabled) is bool for enabled in flags.values()),
        "runtime model capability flags must be boolean",
    )
    return {"flags": dict(flags)}


def approved_profile_for_journey(journey: str) -> str:
    if journey in {"chat-commands", "chat-attribution"}:
        return CORE_LIFECYCLE_PROFILE
    if journey == "depth-linux":
        return CORE_LIFECYCLE_PROFILE
    if journey.startswith("chat-"):
        return CHAT_APPROVED_PROFILE
    if journey == "agent-definition":
        return CORE_LIFECYCLE_PROFILE
    if journey == "minimum-usable-chat":
        return MINIMUM_USABLE_CHAT_PROFILE
    if journey == "core-lifecycle":
        return CORE_LIFECYCLE_PROFILE
    if journey == "cli-provider":
        return CLI_PROVIDER_PROFILE
    return APPROVED_PROFILE


def provider_configuration_required_for_journey(journey: str) -> bool:
    if journey.startswith("chat-"):
        return False
    return journey not in {
        "agent-definition",
        "cli-provider",
        "core-lifecycle",
        "depth-linux",
        "minimum-usable-chat",
    }


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


class AgentNativeJourney:
    def __init__(self, journey: str) -> None:
        self.journey = journey
        self.gate_id = GATE_BY_JOURNEY[journey]
        self.approved_profile = approved_profile_for_journey(journey)
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
            == self.approved_profile,
            f"{self.gate_id} requires the approved {self.approved_profile} profile",
        )
        clients = self.runtime_manifest.get("clients")
        require(
            isinstance(clients, list) and len(clients) == 1,
            f"{self.gate_id} requires exactly one isolated native client",
        )
        self.client = clients[0]
        require(isinstance(self.client, dict), "runtime client entry must be an object")
        station = require_runtime_service(
            self.runtime_manifest,
            "station",
            "station",
        )
        self.station_url = str(station.get("endpoint") or "").rstrip("/")
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
        self.actor_ptid = str(actor.get("ptid") or "")
        require(
            self.actor_ptid.startswith("ptid:"),
            "actor manifest requires the canonical Station actor identity",
        )
        credential_refs = actor_manifest.get("credentialRefs")
        require(
            isinstance(credential_refs, list)
            and "profile:CHAT_NATIVE_DEMO_PASSWORD" in credential_refs,
            "actor manifest requires the approved profile credential reference",
        )

        profile_name, _, _, self.profile_env = (
            resolve_machine_profile_environment(REPO_ROOT)
        )
        require(
            profile_name == self.approved_profile
            and self.profile_env.get("PT_DEV_PROFILE") == self.approved_profile,
            "active profile identity changed after provisioning",
        )
        self.password = self.profile_env.get(
            "CHAT_NATIVE_DEMO_PASSWORD",
            "",
        )
        require(
            bool(self.password),
            "approved profile is missing CHAT_NATIVE_DEMO_PASSWORD",
        )
        self.provider_id = self.profile_env.get("PT_AGENT_PROVIDER_ID", "").strip()
        self.provider_key = self.profile_env.get(
            "PT_AGENT_PROVIDER_API_KEY",
            "",
        )
        self.model_id = self.profile_env.get(
            "PT_AGENT_DEFAULT_MODEL_ID",
            "",
        ).strip()
        self.provider_base_url = self.profile_env.get(
            "PT_AGENT_PROVIDER_BASE_URL",
            "",
        ).strip()
        self.provider_configuration_required = (
            provider_configuration_required_for_journey(journey)
        )
        if self.provider_configuration_required:
            require(
                bool(self.provider_id),
                "approved profile is missing PT_AGENT_PROVIDER_ID",
            )
            require(
                bool(self.model_id),
                "approved profile is missing PT_AGENT_DEFAULT_MODEL_ID",
            )
            require(
                bool(self.provider_base_url),
                "approved profile is missing PT_AGENT_PROVIDER_BASE_URL",
            )
            require(
                bool(self.provider_key),
                "approved profile is missing PT_AGENT_PROVIDER_API_KEY",
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
        self.actor_identity_root = self.run_root / "actor-identity"
        self.runtime_profile = self.run_root / f"{self.approved_profile}.env"
        self.desktop_log = self.run_root / "desktop.log"
        self.proxy = (
            TcpFaultProxy.from_url(self.station_url)
            if self.station_url.startswith("http://")
            else None
        )
        self.station_transport_url = (
            self.proxy.url if self.proxy is not None else self.station_url
        )
        self.client_station_transport_url = self.station_transport_url
        self.chat_station_origin: ChatStationOrigin | None = None
        report_c08_latency_debug(
            "A-B",
            "transport-selected",
            {
                "journey": journey,
                "transportKind": (
                    "fault-proxy" if self.proxy is not None else "direct"
                ),
                "sourceCommit": self.runtime_manifest.get("source", {}).get(
                    "commit",
                    "",
                ),
            },
        )
        self.tauri_driver: TauriSession | None = None
        self.runtime_binding: Any = None
        self.station_transport_override: Any = None
        self.direct_fault_proxy: TcpFaultProxy | None = None
        self.direct_station_transport_override: Any = None
        self.runtime_sessions: list[TauriSession] = []
        self.desktop_log_bytes = b""
        self.driver: Any = None
        self.steps: list[dict[str, Any]] = []
        self.assertions: list[dict[str, Any]] = []
        self.station_readback: dict[str, Any] = {}
        self.dom_evidence: dict[str, Any] = {}
        self.journey_evidence: dict[str, Any] = {}
        self.cleanup_evidence: dict[str, Any] = {"status": "not-run"}
        self.lifecycle_fixture_ids: list[str] = []
        self.cli_provider_fixture: dict[str, str] | None = None
        self.chat_provider_fixture_ids: list[str] = []
        self.chat_skill_fixture_ids: list[dict[str, str]] = []
        self.chat_mcp_fixture_names: list[str] = []
        self.chat_provider_restore: dict[str, dict[str, Any]] = {}
        self.cli_provider_sample_id = ""
        self.minimum_provider_fixture: OpenAIProviderFixture | None = None
        self.minimum_provider_bridge: RemoteProviderBridge | None = None
        self.minimum_fixture_root: Path | None = None
        self.minimum_harness_state: dict[str, Any] | None = None
        self.minimum_resource_cleanup: dict[str, Any] = {
            "status": "not-run",
        }

    def step(self, name: str, operation: Callable[[], Any]) -> Any:
        started = time.monotonic()
        report_c08_latency_debug(
            "B-C-D",
            "step-started",
            {"journey": self.journey, "step": name},
        )
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
            report_c08_latency_debug(
                "B-C-D",
                "step-passed",
                {
                    "journey": self.journey,
                    "step": name,
                    "durationMs": entry["durationMs"],
                },
            )
            return result
        except Exception as error:
            import traceback

            entry.update(
                status="failed",
                completedAt=now_iso(),
                durationMs=int((time.monotonic() - started) * 1000),
                error=str(error) or type(error).__name__,
                errorType=type(error).__name__,
                traceback=traceback.format_exc(),
            )
            report_c08_latency_debug(
                "B-C-D",
                "step-failed",
                {
                    "journey": self.journey,
                    "step": name,
                    "durationMs": entry["durationMs"],
                    "errorType": type(error).__name__,
                },
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
            "PT_DEV_PROFILE": self.approved_profile,
            "PT_STATION_URL": self.station_transport_url,
            "PT_STATION_HEALTH_URL": (
                f"{self.station_transport_url}/app-meta/version"
            ),
            "PT_DESKTOP_APP_GATEWAY_PORT": str(self.gateway_port),
            "PT_DESKTOP_APP_WEB_PORT": str(self.renderer_port),
            "PEERS_ACTOR_IDENTITY_ROOT": str(self.actor_identity_root),
        }
        self.runtime_profile.write_text(
            "\n".join(f"{key}={value}" for key, value in sorted(values.items()))
            + "\n",
            encoding="utf-8",
        )
        self.runtime_profile.chmod(0o600)

    def start(self, *, require_initial_route: bool = True) -> None:
        cell_id = os.environ.get("PT_ACCEPTANCE_RUNTIME_CELL", "").strip()
        if self.journey.startswith("chat-"):
            require(bool(cell_id), "Native Chat requires an explicit Runtime Cell")
        if cell_id:
            if self.runtime_binding is None:
                self.runtime_binding = resolve_native_desktop_runtime(
                    cell_id,
                    gate_id=self.gate_id,
                    source_commit=self.runtime_manifest["source"]["commit"],
                )
                self.runtime_binding.set_runtime_manifest(self.runtime_manifest)
            # Canonical discovery during launch must use the reviewed
            # manifest origin; the loopback fault-proxy origin is switched in
            # only after the bound session exists, and switched back before
            # any rebind (native restart).
            self._restore_public_station_origin()
            self.tauri_driver = self.runtime_binding.create_bound_session(
                self.client["id"],
                NativeLaunchOptions(
                    restore_session=not require_initial_route,
                    storage_fixtures=(
                        (resolve_chat_identity_fixture(self.profile_env, self.actor_ptid),)
                        if self.journey.startswith("chat-") and require_initial_route
                        else ()
                    ),
                ),
            )
            self.runtime_sessions.append(self.tauri_driver)
            self.driver = self.tauri_driver.driver
            self.tauri_driver.wait_for_acceptance_harness()
            if self.proxy is not None:
                self._activate_loopback_station_origin()
            return
        if self.proxy is not None:
            self.proxy.start()
        self._write_runtime_profile()
        environment = {
            **self.profile_env,
            "PT_DEV_PROFILE": self.approved_profile,
            "PT_DEV_PROFILE_FILE": str(self.runtime_profile),
            "PT_DEV_PROFILE_FILE_AUTHORITY": "acceptance-runtime-manifest",
            "PT_ACCEPTANCE_RUNTIME_PROFILE_ROOT": str(self.run_root),
            "PT_DESKTOP_APP_GATEWAY_PORT": str(self.gateway_port),
            "PT_DESKTOP_APP_WEB_PORT": str(self.renderer_port),
            "PT_STATION_MODE": "remote",
            "PT_STATION_URL": self.station_transport_url,
            "PEERS_STATION_URL": self.station_transport_url,
            "PEERS_ACTOR_IDENTITY_ROOT": str(self.actor_identity_root),
            "PT_STATION_HEALTH_URL": (
                f"{self.station_transport_url}/app-meta/version"
            ),
            "PT_DESKTOP_E2E": "true",
        }
        self.tauri_driver = TauriSession(
            LocalTauriLauncher(
                port=self.webdriver_port,
                gateway_port=self.gateway_port,
                profile=self.profile_env.get(
                    "PT_PROFILE",
                    f"{self.approved_profile}-app",
                ),
                storage_root=str(self.storage_root),
                environment=environment,
                log_path=self.desktop_log,
            )
        )
        self.driver = self.tauri_driver.start()
        if require_initial_route:
            self.tauri_driver.wait_for_ready()
        self.tauri_driver.wait_for_acceptance_harness()
        require(
            bool(
                self.driver.execute_script(
                    "return Boolean(window.__PT_ACCEPTANCE__?.agent)"
                )
            ),
            "Agent acceptance Harness namespace is unavailable",
        )

    def _restore_public_station_origin(self) -> None:
        if (
            self.chat_station_origin is not None
            and self.chat_station_origin.active
        ):
            self.chat_station_origin.restore()
        self.chat_station_origin = None
        self.client_station_transport_url = self.station_url

    def _activate_loopback_station_origin(self) -> None:
        require(
            self.proxy is not None,
            "loopback Station origin needs a proxy",
        )
        self.proxy.start()
        canonical_origin = self.proxy.url
        self.client_station_transport_url = canonical_origin
        self.chat_station_origin = ChatStationOrigin(
            self.profile_env, self.station_url,
        )
        self.chat_station_origin.activate(canonical_origin)

    def seed_minimum_usable_actor_identity(self) -> dict[str, Any]:
        seeded = seed_native_actor_identity(
            fixture_root=OPERATION_SCENARIO_IDENTITY_FIXTURE,
            target_root=self.actor_identity_root,
            station_url=self.station_url,
            profile=self.approved_profile,
            account=self.email,
            expected_actor_id=self.actor_ptid,
        )
        require(
            isinstance(seeded, Mapping),
            "minimum usable Agent Chat requires the retained trusted actor identity",
        )
        return {
            "actorId": seeded.get("actorId"),
            "profile": seeded.get("profile"),
            "account": seeded.get("account"),
            "reused": True,
        }

    def restart_native_runtime(self) -> dict[str, Any]:
        require(
            self.tauri_driver is not None,
            "native runtime is not started",
        )
        if self.runtime_binding is not None:
            self.tauri_driver.stop(preserve_state=True)
            self.tauri_driver = None
            self.driver = None
            self.start(require_initial_route=False)
            return {"restarted": True, "storageRootPreserved": True}
        self.tauri_driver.stop()
        self.tauri_driver = None
        self.driver = None
        wait_until(
            lambda: all(
                not port_open(port)
                for port in (
                    self.gateway_port,
                    self.renderer_port,
                    self.webdriver_port,
                )
            ),
            "native runtime ports to close",
            timeout=30,
        )
        self.start(require_initial_route=False)
        return {
            "restarted": True,
            "storageRootPreserved": self.storage_root.exists(),
        }

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

    def verify_station_transport_health(self) -> dict[str, Any]:
        started = time.monotonic()
        if self.proxy is not None:
            require(
                self.proxy.is_alive,
                "Station fault proxy thread is not alive",
            )
        with urllib.request.urlopen(
            f"{self.station_transport_url}/app-meta/version",
            timeout=10,
        ) as response:
            payload = json.loads(response.read().decode("utf-8"))
        require(
            isinstance(payload, dict)
            and str(payload.get("build_commit") or "").lower()
            not in {"", "unknown"},
            "Station transport does not preserve runtime identity",
        )
        report_c08_latency_debug(
            "B",
            "station-health-passed",
            {
                "journey": self.journey,
                "transportKind": (
                    "fault-proxy" if self.proxy is not None else "direct"
                ),
                "durationMs": int((time.monotonic() - started) * 1000),
                "buildCommitPresent": bool(payload.get("build_commit")),
            },
        )
        result = {
            "transportKind": (
                "fault-proxy" if self.proxy is not None else "direct"
            ),
            "status": response.status,
            "buildCommit": payload.get("build_commit"),
        }
        if self.proxy is not None:
            result["proxyPort"] = self.proxy.port
        return result

    def configure_station(self) -> dict[str, Any]:
        result = self.harness(
            "configureStation",
            {"stationUrl": self.client_station_transport_url},
            timeout=60,
        )
        expected_url = self.client_station_transport_url.rstrip("/")
        require(
            isinstance(result, Mapping)
            and result.get("configured") is True
            and str(result.get("activeUrl") or "").rstrip("/") == expected_url
            and result.get("online") is True
            and result.get("peerIdAvailable") is True,
            f"Agent Station binding did not converge: {result}",
        )
        return dict(result)

    def bind_direct_station_fault_route(self) -> dict[str, Any]:
        require(
            self.runtime_binding is not None
            and self.tauri_driver is not None,
            "Direct Station fault injection requires a Native Runtime Binding",
        )
        require(
            self.direct_fault_proxy is None
            and self.direct_station_transport_override is None,
            "Direct Station fault transport is already bound",
        )
        station_state = self.tauri_driver.invoke_app_result("station_list")
        direct_multiaddr = active_direct_station_multiaddr(station_state)
        proxy = TcpFaultProxy.from_multiaddr(direct_multiaddr)
        proxy.start()
        self.direct_fault_proxy = proxy
        try:
            handle = self.runtime_binding.create_transport_override(
                self.client["id"],
                "station",
                proxy.multiaddr,
            )
            self.direct_station_transport_override = handle
            self.runtime_binding.apply_verified_direct_route_override(
                self.client["id"],
                "station",
                handle,
            )
        except Exception:
            proxy.close()
            self.direct_fault_proxy = None
            raise
        self.station_readback["faultTransport"] = {
            "kind": "direct-route",
            "opaqueOverrideApplied": True,
        }
        return {
            "transportKind": "direct-route-fault-proxy",
            "proxyPort": proxy.port,
        }

    def release_direct_station_fault_route(self) -> dict[str, Any]:
        handle = self.direct_station_transport_override
        proxy = self.direct_fault_proxy
        try:
            if handle is not None:
                require(
                    self.runtime_binding is not None,
                    "Direct Station fault route has no Runtime Binding",
                )
                self.runtime_binding.clear_verified_direct_route_override(
                    self.client["id"],
                    "station",
                    handle,
                )
        finally:
            self.direct_station_transport_override = None
            if proxy is not None:
                proxy.close()
            self.direct_fault_proxy = None
        return {
            "transportKind": "direct-route-fault-proxy",
            "released": True,
        }

    def configure_provider(self) -> None:
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

    def navigate_and_configure(self) -> None:
        self.click_primary_navigation("agent", "Agent workspace")
        self.wait_visible_element(
            "[data-pt-agent-composer]",
            "Agent composer after primary navigation",
            timeout=120,
        )
        idle_runtime = self.harness(
            "waitForIdleSessionRuntimes",
            timeout=120,
        )
        require(
            isinstance(idle_runtime, dict)
            and idle_runtime.get("state") == "ready"
            and idle_runtime.get("actorId") == self.actor_ptid,
            f"Agent idle runtime owner did not converge: {idle_runtime}",
        )
        if self.provider_configuration_required:
            self.configure_provider()

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
            const isViewportVisible = (element) => {
              const style = getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              return element.getClientRects().length > 0
                && style.display !== 'none'
                && style.visibility !== 'hidden'
                && Number(style.opacity) > 0
                && rect.width > 0
                && rect.height > 0
                && rect.right > 0
                && rect.bottom > 0
                && rect.left < window.innerWidth
                && rect.top < window.innerHeight;
            };
            return {
              count: matches.length,
              visible: matches.some(isViewportVisible),
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

    def lifecycle_selector(self, name: str, **values: str) -> str:
        template = CORE_LIFECYCLE_SELECTORS[name]
        return template.format(**values)

    def visible_element_state(
        self,
        selector: str,
        attributes: tuple[str, ...] = (),
    ) -> dict[str, Any] | None:
        state = self.driver.execute_script(
            """
            const [selector, attributes] = arguments;
            const isViewportVisible = (element) => {
              const style = getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              return element.getClientRects().length > 0
                && style.display !== 'none'
                && style.visibility !== 'hidden'
                && Number(style.opacity) > 0
                && rect.width > 0
                && rect.height > 0
                && rect.right > 0
                && rect.bottom > 0
                && rect.left < window.innerWidth
                && rect.top < window.innerHeight;
            };
            const element = Array.from(document.querySelectorAll(selector))
              .find(isViewportVisible);
            if (!element) return null;
            return {
              selector,
              text: (element.textContent || '').trim(),
              attributes: Object.fromEntries(
                attributes.map((name) => [name, element.getAttribute(name)]),
              ),
            };
            """,
            selector,
            list(attributes),
        )
        require(
            state is None or isinstance(state, dict),
            f"selector {selector} returned invalid element state",
        )
        return state

    def wait_visible_element(
        self,
        selector: str,
        description: str,
        *,
        attributes: tuple[str, ...] = (),
        timeout: float = DEFAULT_TIMEOUT,
    ) -> dict[str, Any]:
        return wait_until(
            lambda: self.visible_element_state(selector, attributes),
            description,
            timeout,
        )

    def _visible_web_element(
        self,
        selector: str,
        *,
        text: str | None = None,
    ) -> tuple[Any, dict[str, Any]] | None:
        for element in self.driver.find_elements("css selector", selector):
            state = self.driver.execute_script(
                """
                const element = arguments[0];
                const style = getComputedStyle(element);
                const rect = element.getBoundingClientRect();
                return {
                  visible: element.getClientRects().length > 0
                    && style.display !== 'none'
                    && style.visibility !== 'hidden'
                    && Number(style.opacity) > 0
                    && rect.width > 0
                    && rect.height > 0
                    && rect.right > 0
                    && rect.bottom > 0
                    && rect.left < window.innerWidth
                    && rect.top < window.innerHeight,
                  text: (element.textContent || '').trim(),
                };
                """,
                element,
            )
            if (
                isinstance(state, dict)
                and state.get("visible") is True
                and (text is None or state.get("text") == text)
            ):
                return element, state
        return None

    def click_visible(
        self,
        selector: str,
        description: str,
        *,
        text: str | None = None,
        pointer_sequence: bool = False,
    ) -> dict[str, Any]:
        def click_once() -> dict[str, Any] | None:
            resolved = self._visible_web_element(selector, text=text)
            if resolved is None:
                return None
            element, state = resolved
            if pointer_sequence:
                self.driver.execute_script(
                    """
                    const element = arguments[0];
                    const rect = element.getBoundingClientRect();
                    const init = {
                      bubbles: true,
                      cancelable: true,
                      clientX: rect.left + rect.width / 2,
                      clientY: rect.top + rect.height / 2,
                      pointerId: 1,
                      pointerType: 'mouse',
                      button: 0,
                      buttons: 1,
                      view: window,
                    };
                    element.dispatchEvent(new PointerEvent('pointerdown', init));
                    element.dispatchEvent(new MouseEvent('mousedown', init));
                    element.dispatchEvent(new PointerEvent('pointerup', {
                      ...init,
                      buttons: 0,
                    }));
                    element.dispatchEvent(new MouseEvent('mouseup', {
                      ...init,
                      buttons: 0,
                    }));
                    element.dispatchEvent(new MouseEvent('click', {
                      ...init,
                      buttons: 0,
                    }));
                    """,
                    element,
                )
            else:
                element.click()
            return {
                "selector": selector,
                "text": str(state.get("text") or ""),
            }

        return wait_until(click_once, description)

    def click_primary_navigation(
        self,
        page_id: str,
        description: str,
    ) -> dict[str, Any]:
        return self.click_visible(
            f'[data-pt-primary-nav="{page_id}"] [role="button"]',
            description,
        )

    def set_input_value(
        self,
        selector: str,
        value: str,
        description: str,
    ) -> dict[str, Any]:
        def edit_visible_input() -> dict[str, Any] | None:
            result = self.driver.execute_script(
                """
                const [selector, value] = arguments;
                const isRendered = (element) => {
                  const style = getComputedStyle(element);
                  const rect = element.getBoundingClientRect();
                  return element.getClientRects().length > 0
                    && style.display !== 'none'
                    && style.visibility !== 'hidden'
                    && Number(style.opacity) > 0
                    && rect.width > 0
                    && rect.height > 0;
                };
                const isViewportVisible = (element) => {
                  const rect = element.getBoundingClientRect();
                  return rect.right > 0
                    && rect.bottom > 0
                    && rect.left < window.innerWidth
                    && rect.top < window.innerHeight;
                };
                const input = Array.from(document.querySelectorAll(selector))
                  .find(isRendered);
                if (!(input instanceof HTMLInputElement)
                  && !(input instanceof HTMLTextAreaElement)) return null;
                if (!isViewportVisible(input)) {
                  input.scrollIntoView({ block: 'center', inline: 'nearest' });
                  return null;
                }
                const prototype = input instanceof HTMLTextAreaElement
                  ? HTMLTextAreaElement.prototype
                  : HTMLInputElement.prototype;
                const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
                if (!setter) return null;
                input.focus();
                setter.call(input, value);
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                const acceptedValue = input.value;
                input.blur();
                return { selector, value: acceptedValue };
                """,
                selector,
                value,
            )
            return (
                result
                if isinstance(result, dict) and result.get("value") == value
                else None
            )

        return wait_until(
            edit_visible_input,
            f"{description} to accept edited value",
        )

    def press_native_key(
        self,
        key: NativeKey,
        *,
        selector: str | None = None,
        modifiers: tuple[NativeModifier, ...] = (),
    ) -> None:
        require(
            self.runtime_binding is not None and self.tauri_driver is not None,
            "Native key input requires a bound Desktop runtime",
        )
        process_id = self.tauri_driver.process_id
        require(process_id is not None, "Native Desktop process identity is unavailable")
        if selector is not None:
            adapter = self.runtime_binding.native_adapter

            target = wait_until(
                lambda: self.driver.execute_script(
                    """
                    const candidate = Array.from(
                      document.querySelectorAll(arguments[0])
                    ).find((item) => {
                      const style = getComputedStyle(item);
                      const rect = item.getBoundingClientRect();
                      return item.getClientRects().length > 0
                        && style.display !== 'none'
                        && style.visibility !== 'hidden'
                        && Number(style.opacity) > 0
                        && rect.width > 0
                        && rect.height > 0;
                    });
                    if (!candidate) return null;
                    candidate.scrollIntoView({
                      block: 'center',
                      inline: 'nearest',
                    });
                    const rect = candidate.getBoundingClientRect();
                    return {
                      x: rect.left + rect.width / 2,
                      y: rect.top + Math.min(rect.height / 2, 24),
                      viewportWidth: window.innerWidth,
                      viewportHeight: window.innerHeight,
                      devicePixelRatio: window.devicePixelRatio || 1,
                    };
                    """,
                    selector,
                ),
                f"Native key target {selector} geometry",
            )
            origin = adapter.content_origin(process_id)
            if origin is None:
                ratio = float(target["devicePixelRatio"])
                require(ratio > 0, "Native key target returned an invalid scale")
                window = self.driver.get_window_rect()
                window_left = float(window["x"]) / ratio
                window_top = float(window["y"]) / ratio
                window_width = float(window["width"]) / ratio
                window_height = float(window["height"]) / ratio
                origin = (
                    window_left
                    + max(
                        0.0,
                        (
                            window_width
                            - float(target["viewportWidth"])
                        ) / 2,
                    ),
                    window_top
                    + max(
                        0.0,
                        window_height - float(target["viewportHeight"]),
                    ),
                )
            point = (
                float(origin[0]) + float(target["x"]),
                float(origin[1]) + float(target["y"]),
            )
            window_stack = adapter.window_stack_at_point(point)
            require(
                not window_stack.error
                and window_stack.point_owned_by(process_id),
                f"Native key target {selector} is not owned by the Desktop actor",
            )
            adapter.post_mouse(
                (
                    MouseAction.MOVE,
                    MouseAction.LEFT_DOWN,
                    MouseAction.LEFT_UP,
                ),
                point,
            )
            adapter.post_key(
                key,
                modifiers=modifiers,
                private_source=True,
            )
            return
        self.runtime_binding.native_adapter.post_key_to_process(
            process_id,
            key,
            modifiers=modifiers,
            private_source=True,
        )

    def click_agent_action(self, agent_id: str, action: str) -> None:
        self.filter_agent_rail(agent_id)
        self.click_visible(
            self.lifecycle_selector("menu", agent_id=agent_id),
            f"Agent {agent_id} action menu",
        )
        action_selector = self.lifecycle_selector(
            "menu_action",
            action=action,
            agent_id=agent_id,
        )
        self.wait_visible_element(
            action_selector,
            f"Agent {agent_id} {action} menu item",
        )
        self.click_visible(
            action_selector,
            f"Agent {agent_id} {action} action",
        )

    def filter_agent_rail(self, agent_id: str) -> None:
        row_selector = self.lifecycle_selector("row", agent_id=agent_id)
        if self.visible_element_state(row_selector) is not None:
            return
        labels = json.loads(
            (REPO_ROOT / "packages/locales/en/agent.json").read_text()
        )
        agent = self.station_agent(agent_id)
        query = str(agent.get("name") or "").strip()
        require(bool(query), f"Agent {agent_id} has no searchable Station name")
        expanded_selector = '[data-pt-agent-rail="expanded"]'
        collapsed_toggle_selector = (
            '[data-pt-agent-rail="collapsed"] '
            '[data-pt-panel-toggle-dock="left"] button'
        )

        def ensure_expanded() -> dict[str, Any] | None:
            expanded = self.visible_element_state(expanded_selector)
            if expanded is not None:
                return expanded
            collapsed_toggle = self._visible_web_element(
                collapsed_toggle_selector,
            )
            if collapsed_toggle is not None:
                collapsed_toggle[0].click()
            return None

        wait_until(ensure_expanded, "expanded Agent rail")
        self.set_input_value(
            (
                f'{expanded_selector} '
                f'input[placeholder="{labels["agent.sidebar.searchAgents"]}"]'
            ),
            query,
            f"Agent {agent_id} rail search",
        )
        self.wait_visible_element(row_selector, f"Agent {agent_id} filtered row")

    def select_agent_chat(self, agent_id: str) -> dict[str, Any]:
        self.filter_agent_rail(agent_id)
        self.click_visible(
            self.lifecycle_selector("row", agent_id=agent_id),
            f"Agent {agent_id} list row",
        )
        profile = self.visible_element_state(
            self.lifecycle_selector("profile", agent_id=agent_id),
        )
        if profile is not None:
            self.click_visible(
                self.lifecycle_selector("profile_back"),
                "Agent profile back control",
            )
        return self.wait_visible_element(
            self.lifecycle_selector("composer"),
            f"Agent {agent_id} composer",
        )

    def lifecycle_station_state(
        self,
        *,
        expected_agent_id: str,
        expected_name: str | None = None,
        expected_title: str | None = None,
        expected_default: bool | None = None,
    ) -> dict[str, Any]:
        state = self.harness("getCoreLifecycleAgentState", timeout=60)
        require(isinstance(state, Mapping), "Agent Station readback is invalid")
        agent = state.get("agent")
        conversations = state.get("conversations")
        require(isinstance(agent, Mapping), "Agent Station readback has no agent")
        require(
            str(agent.get("id") or "") == expected_agent_id,
            "Agent Station readback selected a different Agent",
        )
        if expected_name is not None:
            require(
                str(agent.get("name") or "") == expected_name,
                "Agent Station readback did not persist the expected name",
            )
        if expected_title is not None:
            require(
                str(agent.get("title") or "") == expected_title,
                "Agent Station readback did not persist the expected title",
            )
        if expected_default is not None:
            require(
                agent.get("isDefault") is expected_default,
                "Agent Station readback did not persist the expected default",
            )
        require(
            isinstance(conversations, list),
            "Agent Station conversation readback is invalid",
        )
        return dict(state)

    def invoke_readback_command(
        self,
        command: str,
        payload: dict[str, Any] | None = None,
        *,
        expect_error: bool = False,
    ) -> dict[str, Any]:
        result = self.driver.execute_async_script(
            """
            const [command, payload, done] = arguments;
            const invoke = window.__TAURI_INTERNALS__?.invoke;
            if (typeof invoke !== 'function') {
              done({ transportOk: false, error: 'Tauri invoke unavailable' });
              return;
            }
            Promise.resolve(invoke(
              command,
              payload === null ? undefined : { input: payload },
            ))
              .then((value) => done({ transportOk: true, value }))
              .catch((error) => done({
                transportOk: false,
                error: String(error?.message || error),
              }));
            """,
            command,
            payload,
        )
        require(
            isinstance(result, Mapping),
            f"{command} returned an invalid native readback envelope",
        )
        if result.get("transportOk") is not True:
            require(
                expect_error,
                f"{command} native readback failed: {result.get('error')}",
            )
            return {"rejected": True, "error": str(result.get("error") or "")}
        value = result.get("value")
        require(
            isinstance(value, Mapping),
            f"{command} returned an invalid command result",
        )
        if value.get("ok") is not True:
            rejection = json.dumps(
                dict(value),
                sort_keys=True,
                default=str,
            )
            require(
                expect_error,
                f"{command} Station readback was rejected: {rejection}",
            )
            return {"rejected": True, "error": value.get("error")}
        require(not expect_error, f"{command} unexpectedly succeeded")
        data = value.get("data")
        if isinstance(data, Mapping) and isinstance(data.get("status"), str):
            try:
                parsed = json.loads(data["status"])
            except json.JSONDecodeError as error:
                raise JourneyError(
                    f"{command} returned malformed Station readback"
                ) from error
            require(
                isinstance(parsed, dict),
                f"{command} Station readback must be an object",
            )
            return parsed
        require(
            isinstance(data, dict),
            f"{command} Station readback data must be an object",
        )
        return data

    def station_agent_roster(self) -> dict[str, Any]:
        roster = self.invoke_readback_command("agents_list")
        agents = roster.get("agents")
        require(isinstance(agents, list), "Station Agent roster is invalid")
        return roster

    def station_agent(self, agent_id: str) -> dict[str, Any]:
        agent = self.invoke_readback_command("agents_get", {"id": agent_id})
        require(
            str(agent.get("id") or "") == agent_id,
            "Station returned a different Agent",
        )
        return agent

    def station_agent_absent(self, agent_id: str) -> dict[str, Any] | None:
        roster = self.station_agent_roster()
        return (
            roster
            if all(
                not isinstance(agent, Mapping)
                or str(agent.get("id") or "") != agent_id
                for agent in roster["agents"]
            )
            else None
        )

    def selected_profile(self) -> dict[str, str] | None:
        state = self.visible_element_state(
            self.lifecycle_selector("profile_any"),
            ("data-pt-agent-profile",),
        )
        if state is None:
            return None
        attributes = state.get("attributes")
        if not isinstance(attributes, Mapping):
            return None
        agent_id = str(attributes.get("data-pt-agent-profile") or "")
        return {"agentId": agent_id} if agent_id else None

    def delete_lifecycle_agent(self, agent_id: str) -> None:
        self.click_agent_action(agent_id, "delete")
        confirm_selector = self.lifecycle_selector(
            "confirm_delete",
            agent_id=agent_id,
        )
        self.wait_visible_element(
            confirm_selector,
            f"Agent {agent_id} delete confirmation",
        )
        self.click_visible(
            confirm_selector,
            f"Agent {agent_id} delete confirmation",
        )
        wait_until(
            lambda: self.visible_element_state(confirm_selector) is None,
            f"Agent {agent_id} delete confirmation closure",
        )
        wait_until(
            lambda: self.station_agent_absent(agent_id),
            f"Agent {agent_id} Station roster removal",
        )
        row_selector = self.lifecycle_selector("row", agent_id=agent_id)
        wait_until(
            lambda: self.visible_element_state(row_selector) is None,
            f"Agent {agent_id} native roster removal",
        )
        if agent_id in self.lifecycle_fixture_ids:
            self.lifecycle_fixture_ids.remove(agent_id)

    def run_core_lifecycle(self) -> None:
        self.step("login", self.login)
        self.step("navigate_and_configure", self.navigate_and_configure)
        baseline = self.step(
            "station_baseline_readback",
            lambda: self.harness("getCoreLifecycleAgentState", timeout=60),
        )
        require(isinstance(baseline, Mapping), "baseline Agent state is invalid")
        baseline_agent = baseline.get("agent")
        require(isinstance(baseline_agent, Mapping), "baseline Agent is missing")
        baseline_id = str(baseline_agent.get("id") or "")
        baseline_name = str(baseline_agent.get("name") or "")
        require(bool(baseline_id and baseline_name), "baseline Agent identity is invalid")
        baseline_conversations = baseline.get("conversations")
        require(
            isinstance(baseline_conversations, list),
            "baseline Station conversations are missing",
        )
        baseline_roster = self.step(
            "station_baseline_roster",
            self.station_agent_roster,
        )
        baseline_roster_count = len(baseline_roster["agents"])
        self.step(
            "create_agent_native_ui",
            lambda: self.click_visible(
                self.lifecycle_selector("create"),
                "Agent create control",
            ),
        )
        created_profile = self.step(
            "created_profile_visible",
            lambda: wait_until(
                lambda: (
                    profile
                    if (
                        (profile := self.selected_profile()) is not None
                        and profile["agentId"] != baseline_id
                    )
                    else None
                ),
                "new Agent profile",
            ),
        )
        created_id = created_profile["agentId"]
        self.lifecycle_fixture_ids.append(created_id)
        created_station = self.step(
            "created_agent_station_readback",
            lambda: self.lifecycle_station_state(
                expected_agent_id=created_id,
            ),
        )
        created_agent = created_station["agent"]
        created_name = str(created_agent.get("name") or "")
        require(bool(created_name), "created Agent has no Station-owned name")
        created_authority = self.step(
            "created_agent_station_authority",
            lambda: self.station_agent(created_id),
        )
        created_roster = self.step(
            "created_agent_station_list",
            self.station_agent_roster,
        )
        require(
            len(created_roster["agents"]) == baseline_roster_count + 1,
            "one create action must persist exactly one Agent",
        )
        require(
            sum(
                1
                for agent in created_roster["agents"]
                if isinstance(agent, Mapping) and agent.get("id") == created_id
            )
            == 1,
            "Station Agent roster does not contain exactly one created Agent",
        )

        self.step(
            "return_to_agent_chat",
            lambda: self.click_visible(
                self.lifecycle_selector("profile_back"),
                "Agent profile back control",
            ),
        )
        created_row = self.step(
            "created_agent_listed",
            lambda: self.wait_visible_element(
                self.lifecycle_selector("row", agent_id=created_id),
                "created Agent list row",
                attributes=("data-pt-agent-id",),
            ),
        )
        self.step(
            "select_baseline_agent",
            lambda: self.select_agent_chat(baseline_id),
        )
        self.step(
            "baseline_station_selection_readback",
            lambda: self.lifecycle_station_state(
                expected_agent_id=baseline_id,
                expected_name=baseline_name,
            ),
        )
        self.step(
            "select_created_agent",
            lambda: self.select_agent_chat(created_id),
        )

        self.step(
            "open_created_agent_profile",
            lambda: self.click_agent_action(created_id, "edit"),
        )
        self.step(
            "created_profile_reopened",
            lambda: self.wait_visible_element(
                self.lifecycle_selector("profile", agent_id=created_id),
                "created Agent profile",
            ),
        )
        edited_title = f"{created_name}-edited"
        self.step(
            "edit_agent_name_native_ui",
            lambda: self.set_input_value(
                self.lifecycle_selector("profile_title", agent_id=created_id),
                edited_title,
                "Agent profile title",
            ),
        )
        self.step(
            "agent_profile_saved",
            lambda: self.wait_visible_element(
                self.lifecycle_selector("profile_saved", agent_id=created_id),
                "saved Agent profile state",
            ),
        )
        edited_station = self.step(
            "edited_agent_station_readback",
            lambda: self.lifecycle_station_state(
                expected_agent_id=created_id,
                expected_name=created_name,
                expected_title=edited_title,
            ),
        )
        require(
            int(edited_station["agent"].get("version") or 0)
            > int(created_agent.get("version") or 0),
            "Agent Station version did not advance after edit",
        )
        edited_authority = self.step(
            "edited_agent_station_authority",
            lambda: self.station_agent(created_id),
        )
        require(
            edited_authority.get("title") == edited_title
            and int(edited_authority.get("version") or 0)
            > int(created_authority.get("version") or 0),
            "Station Agent authority did not persist the profile edit",
        )
        self.step(
            "return_after_agent_edit",
            lambda: self.click_visible(
                self.lifecycle_selector("profile_back"),
                "Agent profile back control",
            ),
        )

        legacy_actions_absent = self.step(
            "legacy_duplicate_default_cut_absent",
            lambda: {
                "clone": self.visible_element_state(
                    self.lifecycle_selector(
                        "menu_action", action="clone", agent_id=created_id,
                    )
                ),
                "default": self.visible_element_state(
                    self.lifecycle_selector(
                        "menu_action", action="default", agent_id=created_id,
                    )
                ),
            },
        )
        require(
            legacy_actions_absent["clone"] is None
            and legacy_actions_absent["default"] is None,
            "obsolete Duplicate or Set default action remains visible",
        )
        self.step(
            "create_second_agent_native_ui",
            lambda: self.click_visible(
                self.lifecycle_selector("create"),
                "Agent create control",
            ),
        )
        second_profile = self.step(
            "second_created_profile_visible",
            lambda: wait_until(
                lambda: (
                    profile
                    if (
                        (profile := self.selected_profile()) is not None
                        and profile["agentId"] not in {baseline_id, created_id}
                    )
                    else None
                ),
                "second new Agent profile",
            ),
        )
        second_id = str(second_profile["agentId"])
        self.lifecycle_fixture_ids.append(second_id)
        second_authority = self.step(
            "second_created_agent_station_authority",
            lambda: self.station_agent(second_id),
        )
        second_name = str(second_authority.get("name") or "")
        require(
            bool(second_name) and second_name != created_name,
            "second Create did not persist a distinct Agent identity",
        )
        second_station = self.step(
            "second_created_agent_station_readback",
            lambda: self.lifecycle_station_state(
                expected_agent_id=second_id,
                expected_name=second_name,
            ),
        )
        second_conversation_count = len(second_station["conversations"])
        self.step(
            "return_after_second_create",
            lambda: self.click_visible(
                self.lifecycle_selector("profile_back"),
                "Agent profile back control",
            ),
        )
        second_row = self.step(
            "second_created_agent_listed",
            lambda: self.wait_visible_element(
                self.lifecycle_selector("row", agent_id=second_id),
                "second created Agent list row",
                attributes=("data-pt-agent-id",),
            ),
        )
        self.step(
            "select_second_created_agent",
            lambda: self.select_agent_chat(second_id),
        )

        before_session = self.runtime_snapshot()
        self.step(
            "start_session_native_ui",
            lambda: self.click_visible(
                self.lifecycle_selector("session_start"),
                "new Agent session control",
            ),
        )
        started_session = self.step(
            "new_session_visible",
            lambda: wait_until(
                lambda: (
                    snapshot
                    if (
                        (snapshot := self.runtime_snapshot()).get(
                            "currentSessionKey"
                        )
                        != before_session.get("currentSessionKey")
                        and snapshot.get("messageCount") == 0
                        and self.dom_state(
                            self.lifecycle_selector("composer")
                        ).get("visible")
                    )
                    else None
                ),
                "fresh Agent session",
            ),
        )
        session_station = self.step(
            "session_start_station_readback",
            lambda: self.lifecycle_station_state(
                expected_agent_id=second_id,
                expected_name=second_name,
            ),
        )
        session_conversations = session_station["conversations"]
        require(
            len(session_conversations) == second_conversation_count,
            "empty session start persisted a phantom Station conversation",
        )

        require(
            self.runtime_binding is not None,
            "topic recovery requires a Native Runtime Binding",
        )
        self.step(
            "topic_load_fault_route_bound",
            self.bind_direct_station_fault_route,
        )
        proxy = self.direct_fault_proxy
        require(
            proxy is not None
            and self.direct_station_transport_override is not None,
            "topic recovery requires a bound Direct Station fault route",
        )
        proxy.cut()
        try:
            def station_transport_rejected() -> dict[str, Any] | None:
                try:
                    self.harness("getCoreLifecycleAgentState", timeout=10)
                except Exception as error:  # noqa: BLE001 - fault acknowledgement.
                    return {
                        "rejected": True,
                        "errorType": type(error).__name__,
                    }
                return None

            self.step(
                "topic_load_fault_acknowledged",
                lambda: wait_until(
                    station_transport_rejected,
                    "Station transport rejection after topic fault",
                    timeout=30,
                ),
            )
            topic_failure = self.step(
                "topic_load_failure_visible",
                lambda: self.harness(
                    "prepareAgentTopicLoadFailure",
                    {"agentId": second_id},
                    timeout=60,
                ),
            )
        finally:
            proxy.restore()
            self.runtime_binding.apply_verified_direct_route_override(
                self.client["id"],
                "station",
                self.direct_station_transport_override,
            )
        require(
            topic_failure.get("rejected") is True
            and topic_failure.get("errorVisible") is True
            and topic_failure.get("beforeKeys") == topic_failure.get("afterKeys")
            and topic_failure.get("draftCountBefore")
            == topic_failure.get("draftCountAfter"),
            "topic load failure replaced accepted state or hid recovery",
        )
        self.step(
            "retry_topic_load_native_ui",
            lambda: self.click_visible(
                self.lifecycle_selector("topic_retry"),
                "topic load retry",
            ),
        )
        recovered_topics = self.step(
            "topic_load_recovered",
            lambda: wait_until(
                lambda: (
                    state
                    if (
                        isinstance(
                            (
                                state := self.harness(
                                    "getAgentTopicLoadState",
                                    {"agentId": second_id},
                                    timeout=30,
                                )
                            ),
                            Mapping,
                        )
                        and state.get("loading") is False
                        and state.get("errorVisible") is False
                    )
                    else None
                ),
                "Agent topic load recovery",
                90,
            ),
        )
        self.step(
            "topic_load_fault_route_released",
            self.release_direct_station_fault_route,
        )

        self.step(
            "create_third_agent_native_ui",
            lambda: self.click_visible(
                self.lifecycle_selector("create"),
                "Agent create control",
            ),
        )
        third_profile = self.step(
            "third_created_profile_visible",
            lambda: wait_until(
                lambda: (
                    profile
                    if (
                        (profile := self.selected_profile()) is not None
                        and profile["agentId"]
                        not in {baseline_id, created_id, second_id}
                    )
                    else None
                ),
                "third new Agent profile",
            ),
        )
        third_id = str(third_profile["agentId"])
        self.lifecycle_fixture_ids.append(third_id)
        third_authority = self.step(
            "third_created_agent_station_authority",
            lambda: self.station_agent(third_id),
        )
        third_name = str(third_authority.get("name") or "")
        require(
            bool(third_name)
            and len({created_name, second_name, third_name}) == 3,
            "repeated Create did not persist a third unique Agent",
        )
        self.step(
            "return_after_third_create",
            lambda: self.click_visible(
                self.lifecycle_selector("profile_back"),
                "Agent profile back control",
            ),
        )
        third_row = self.step(
            "third_created_agent_listed",
            lambda: self.wait_visible_element(
                self.lifecycle_selector("row", agent_id=third_id),
                "third created Agent list row",
                attributes=("data-pt-agent-id",),
            ),
        )

        self.step(
            "delete_third_created_agent_native_ui",
            lambda: self.delete_lifecycle_agent(third_id),
        )
        self.step(
            "delete_second_created_agent_native_ui",
            lambda: self.delete_lifecycle_agent(second_id),
        )
        deleted_second = self.assert_visible(
            self.lifecycle_selector("row", agent_id=second_id),
            False,
        )
        self.step(
            "delete_created_agent_native_ui",
            lambda: self.delete_lifecycle_agent(created_id),
        )
        deleted_created = self.assert_visible(
            self.lifecycle_selector("row", agent_id=created_id),
            False,
        )
        restored_station = self.step(
            "post_delete_station_readback",
            lambda: self.lifecycle_station_state(
                expected_agent_id=baseline_id,
                expected_name=baseline_name,
            ),
        )
        post_delete_roster = self.step(
            "post_delete_station_roster",
            self.station_agent_roster,
        )
        post_delete_ids = {
            str(agent.get("id") or "")
            for agent in post_delete_roster["agents"]
            if isinstance(agent, Mapping)
        }
        require(
            created_id not in post_delete_ids
            and second_id not in post_delete_ids
            and third_id not in post_delete_ids,
            "deleted Agents remain in the Station Agent roster",
        )
        deleted_created_readback = self.step(
            "deleted_agent_station_rejection",
            lambda: self.invoke_readback_command(
                "agents_get",
                {"id": created_id},
                expect_error=True,
            ),
        )
        selected_authority = self.step(
            "post_delete_selected_agent_readback",
            lambda: self.invoke_readback_command("agents_get_selected"),
        )
        require(
            selected_authority.get("selectedAgent") == baseline_name,
            "Station selected Agent was not restored after cleanup",
        )

        self.dom_evidence["coreLifecycle"] = {
            "createdRow": created_row,
            "secondCreatedRow": second_row,
            "thirdCreatedRow": third_row,
            "legacyActionsAbsent": legacy_actions_absent,
            "deletedSecond": deleted_second,
            "deletedCreated": deleted_created,
            "session": {
                "before": before_session.get("currentSessionKey"),
                "after": started_session.get("currentSessionKey"),
                "messageCount": started_session.get("messageCount"),
            },
            "topicRecovery": {
                "failure": dict(topic_failure),
                "recovered": dict(recovered_topics),
            },
        }
        self.station_readback["coreLifecycle"] = {
            "baseline": baseline,
            "baselineRoster": baseline_roster,
            "created": created_station,
            "createdAuthority": created_authority,
            "createdRoster": created_roster,
            "edited": edited_station,
            "editedAuthority": edited_authority,
            "secondCreated": second_station,
            "secondCreatedAuthority": second_authority,
            "thirdCreatedAuthority": third_authority,
            "sessionStart": session_station,
            "postDelete": restored_station,
            "postDeleteRoster": post_delete_roster,
            "deletedAgentReadback": deleted_created_readback,
            "selectedAfterDelete": selected_authority,
        }
        self.journey_evidence["selectors"] = dict(CORE_LIFECYCLE_SELECTORS)
        for assertion_id in (
            "agent.lifecycle.create.persisted",
            "agent.lifecycle.list.visible",
            "agent.lifecycle.select.chat-ready",
            "agent.lifecycle.edit.persisted",
            "agent.lifecycle.repeat-create.distinct",
            "agent.lifecycle.legacy-actions.cut",
            "agent.lifecycle.session-start.no-phantom-persistence",
            "agent.lifecycle.topic-load.failure-preserves-state",
            "agent.lifecycle.topic-load.retry-recovers",
            "agent.lifecycle.third-create.unique",
            "agent.lifecycle.delete.removed",
            "agent.lifecycle.deleted-selection.unavailable",
        ):
            self.assertions.append({"id": assertion_id, "status": "pass"})

    def run_cli_provider(self) -> None:
        self.step("login", self.login)
        self.step("navigate_to_agent", self.navigate_and_configure)
        sample_id = f"cli-{self.runtime_manifest.get('runId', '')}"
        self.cli_provider_sample_id = sample_id
        prepared = self.step(
            "discover_create_and_open_empty_topic",
            lambda: self.harness(
                "prepareCliProviderPrimary",
                {"sampleId": sample_id},
                timeout=120,
            ),
        )
        require(
            isinstance(prepared, Mapping),
            "CLI Provider preparation returned invalid evidence",
        )
        fixture = prepared.get("fixture")
        provider = prepared.get("provider")
        prepared_station = prepared.get("station")
        prepared_receiver = prepared.get("receiver")
        require(
            isinstance(fixture, Mapping)
            and isinstance(provider, Mapping)
            and isinstance(prepared_station, Mapping)
            and isinstance(prepared_receiver, Mapping),
            "CLI Provider preparation evidence is incomplete",
        )
        agent_id = str(fixture.get("agentId") or "")
        agent_name = str(fixture.get("agentName") or "")
        conversation_id = str(fixture.get("conversationId") or "")
        require(
            bool(agent_id and agent_name and conversation_id),
            "CLI Provider fixture identity is incomplete",
        )
        self.cli_provider_fixture = {
            "agentId": agent_id,
            "agentName": agent_name,
            "conversationId": conversation_id,
            "priorSelection": str(fixture.get("priorSelection") or ""),
            "priorSurface": str(fixture.get("priorSurface") or "chat"),
        }
        self.lifecycle_fixture_ids.append(agent_id)
        require(
            provider.get("id") == "trae-cli"
            and provider.get("runtimeKind") == "cli"
            and provider.get("enabled") is True
            and provider.get("requiresApiKey") is False
            and provider.get("hasApiKey") is False
            and provider.get("modelId") == "default",
            "built-in CLI Provider is not selectable without credentials",
        )
        require(
            prepared_receiver.get("visible") is True
            and prepared_receiver.get("providerId") == "trae-cli"
            and prepared_receiver.get("modelId") == "default"
            and int(prepared_receiver.get("messageCount", -1)) == 0,
            "CLI Provider empty topic is not visible",
        )
        require(
            prepared_station.get("agentId") == agent_id
            and prepared_station.get("providerId") == "trae-cli"
            and prepared_station.get("modelId") == "default"
            and prepared_station.get("conversationId") == conversation_id
            and int(prepared_station.get("messageCount", -1)) == 0,
            "CLI Provider Agent or empty topic is not Station-backed",
        )

        executed = self.step(
            "send_stream_and_persist",
            lambda: self.harness(
                "executeCliProviderPrimary",
                {
                    "agentId": agent_id,
                    "agentName": agent_name,
                    "conversationId": conversation_id,
                    "sampleId": sample_id,
                },
                timeout=360,
            ),
        )
        require(
            isinstance(executed, Mapping),
            "CLI Provider execution returned invalid evidence",
        )
        executed_fixture = executed.get("fixture")
        stream = executed.get("stream")
        executed_station = executed.get("station")
        executed_receiver = executed.get("receiver")
        require(
            isinstance(executed_fixture, Mapping)
            and isinstance(stream, Mapping)
            and isinstance(executed_station, Mapping)
            and isinstance(executed_receiver, Mapping),
            "CLI Provider execution evidence is incomplete",
        )
        turn_id = str(executed_fixture.get("turnId") or "")
        assistant_message_id = str(
            executed_fixture.get("assistantMessageId") or ""
        )
        assistant_content_hash = str(
            executed_fixture.get("assistantContentHash") or ""
        )
        require(
            bool(turn_id and assistant_message_id and assistant_content_hash),
            "CLI Provider terminal identity is incomplete",
        )
        require(
            int(stream.get("providerStartCount") or 0) >= 1
            and int(stream.get("providerDeltaCount") or 0) >= 1
            and int(stream.get("textLength") or 0) > 0
            and stream.get("allStationDelivered") is True,
            "CLI Provider did not deliver a Station-backed stream",
        )
        require(
            executed_station.get("providerId") == "trae-cli"
            and executed_station.get("modelId") == "default"
            and int(executed_station.get("runtimeKind") or 0) == 1
            and executed_station.get("assistantStatus") == "completed"
            and executed_station.get("turnId") == turn_id
            and executed_station.get("assistantContentHash")
            == assistant_content_hash,
            "CLI Provider terminal response is not Station-authoritative",
        )
        require(
            executed_receiver.get("visible") is True
            and executed_receiver.get("terminalStatus") == "completed"
            and executed_receiver.get("contentHash") == assistant_content_hash,
            "CLI Provider terminal response is not visible",
        )

        self.step("restart_native_client", self.restart_native_runtime)
        self.step(
            "station_transport_health_after_restart",
            self.verify_station_transport_health,
        )
        self.step("configure_station_after_restart", self.configure_station)
        self.step("login_after_restart", self.login)
        self.step("navigate_after_restart", self.navigate_and_configure)
        restored = self.step(
            "restore_station_conversation_after_restart",
            lambda: self.harness(
                "restoreCliProviderPrimary",
                {
                    "agentId": agent_id,
                    "agentName": agent_name,
                    "conversationId": conversation_id,
                    "turnId": turn_id,
                    "assistantMessageId": assistant_message_id,
                    "assistantContentHash": assistant_content_hash,
                },
                timeout=120,
            ),
        )
        require(
            isinstance(restored, Mapping),
            "CLI Provider restart restoration returned invalid evidence",
        )
        restored_station = restored.get("station")
        restored_receiver = restored.get("receiver")
        require(
            isinstance(restored_station, Mapping)
            and isinstance(restored_receiver, Mapping)
            and restored_station.get("conversationId") == conversation_id
            and restored_station.get("turnId") == turn_id
            and restored_station.get("assistantContentHash")
            == assistant_content_hash,
            "CLI Provider Station state changed across native restart",
        )
        require(
            restored_receiver.get("visible") is True
            and restored_receiver.get("currentSessionKey") == conversation_id
            and restored_receiver.get("assistantMessageId")
            == assistant_message_id
            and restored_receiver.get("terminalStatus") == "completed"
            and restored_receiver.get("contentHash")
            == assistant_content_hash,
            "CLI Provider response was not restored in the native client",
        )

        failed = self.step(
            "typed_failure_without_fabricated_completion",
            lambda: self.harness(
                "executeCliProviderFailure",
                {"sampleId": sample_id},
                timeout=120,
            ),
        )
        require(
            isinstance(failed, Mapping),
            "CLI Provider failure journey returned invalid evidence",
        )
        failed_station = failed.get("station")
        failed_receiver = failed.get("receiver")
        failed_cleanup = failed.get("cleanup")
        require(
            isinstance(failed_station, Mapping)
            and isinstance(failed_receiver, Mapping)
            and isinstance(failed_cleanup, Mapping),
            "CLI Provider failure evidence is incomplete",
        )
        require(
            failed_station.get("assistantStatus") == "failed"
            and failed_station.get("errorType") == "RUNTIME_UNAVAILABLE"
            and failed_station.get("runtimeKind") == "direct_model"
            and failed_station.get("reasonCode") == "cli_binary_missing"
            and int(failed_station.get("completedAssistantCount", -1)) == 0,
            "CLI Provider failure was not Station-authoritative",
        )
        require(
            failed_receiver.get("visible") is True
            and failed_receiver.get("errorType") == "RUNTIME_UNAVAILABLE"
            and failed_receiver.get("reasonCode") == "cli_binary_missing",
            "CLI Provider typed failure was not visible",
        )
        require(
            failed_cleanup.get("status") == "clean",
            "CLI Provider failure fixture cleanup failed",
        )

        product_cleanup = self.step(
            "cleanup_cli_provider_fixture",
            lambda: self.harness(
                "cleanupCliProviderPrimary",
                {
                    "agentId": agent_id,
                    "conversationId": conversation_id,
                    "priorSelection": self.cli_provider_fixture[
                        "priorSelection"
                    ],
                    "priorSurface": self.cli_provider_fixture["priorSurface"],
                },
                timeout=120,
            ),
        )
        require(
            isinstance(product_cleanup, Mapping)
            and product_cleanup.get("status") == "clean",
            "CLI Provider product fixture cleanup failed",
        )
        self.lifecycle_fixture_ids.remove(agent_id)
        self.cli_provider_fixture = None

        self.dom_evidence["cliProvider"] = {
            "prepared": dict(prepared_receiver),
            "completed": dict(executed_receiver),
            "restored": dict(restored_receiver),
            "failure": dict(failed_receiver),
        }
        self.station_readback["cliProvider"] = {
            "prepared": dict(prepared_station),
            "completed": dict(executed_station),
            "restored": dict(restored_station),
            "failure": dict(failed_station),
        }
        self.journey_evidence["cliProvider"] = {
            "provider": dict(provider),
            "stream": dict(stream),
            "failure": dict(failed),
            "productCleanup": dict(product_cleanup),
        }
        for assertion_id in (
            "agent.cli-provider.catalog.discoverable",
            "agent.cli-provider.credentials.not-required",
            "agent.cli-provider.agent.persisted",
            "agent.cli-provider.empty-topic.visible",
            "agent.cli-provider.send.accepted",
            "agent.cli-provider.stream.delta-observed",
            "agent.cli-provider.terminal.station-backed",
            "agent.cli-provider.terminal.visible",
            "agent.cli-provider.restart.restored",
            "agent.cli-provider.failure.typed-visible",
            "agent.cli-provider.failure.station-backed",
            "agent.cli-provider.failure.no-fabricated-completion",
            "agent.cli-provider.cleanup.clean",
        ):
            self.assertions.append({"id": assertion_id, "status": "pass"})

    def run_minimum_usable_chat(self) -> None:
        self.step("login", self.login)
        self.step("navigate_to_agent", self.navigate_and_configure)
        capability_sessions = self.step(
            "native_capability_session_ready",
            lambda: self.harness(
                "getFoundationCapabilitySessions",
                timeout=240,
            ),
        )
        selected_session = (
            capability_sessions.get("selectedStationSession")
            if isinstance(capability_sessions, Mapping)
            else None
        )
        require(
            isinstance(selected_session, Mapping)
            and selected_session.get("ptid") == self.actor_ptid
            and bool(selected_session.get("session_id")),
            "minimum usable Agent Chat capability session is unavailable",
        )
        run_id = str(self.runtime_manifest.get("runId") or "")
        sample_id = f"amu-{run_id}"
        server_name = f"amu-mcp-{run_id.lower()}"
        expected_assistant_response = "Minimum usable Agent response."
        fixture_root = Path(tempfile.mkdtemp(prefix="pt-agent-amu-mcp-"))
        fixture_script = fixture_root / "server.py"
        fixture_script.write_text(MCP_FIXTURE_SCRIPT + "\n", encoding="utf-8")
        fixture_script.chmod(0o700)
        secret_canary = f"pt-agent-amu-{secrets.token_urlsafe(32)}"
        secret_digest = hashlib.sha256(secret_canary.encode("utf-8")).hexdigest()
        deployment_environment = self.profile_env.get(
            "PT_STATION_DEPLOY_ENV",
            "",
        ).strip()
        require(
            bool(deployment_environment),
            "minimum usable Agent Chat requires a Station deployment identity",
        )

        self.minimum_fixture_root = fixture_root
        self.minimum_provider_fixture = OpenAIProviderFixture(
            tool_name="local_mcp",
            tool_arguments={
                "server_name": server_name,
                "tool_name": MCP_TOOL_NAME,
                "arguments": {"sample": "minimum-usable-agent-chat"},
            },
            expected_tool_result=MCP_RESULT_TEXT,
            terminal_content=expected_assistant_response,
            thread_name="agent-minimum-usable-provider-fixture",
        )
        self.minimum_provider_bridge = RemoteProviderBridge(
            deployment_environment,
            artifact_prefix="agent-minimum-usable-provider",
        )
        self.step(
            "start_direct_model_provider_fixture",
            self.minimum_provider_fixture.start,
        )
        provider_base_url = self.step(
            "bridge_direct_model_provider_to_station",
            lambda: self.minimum_provider_bridge.start(
                self.minimum_provider_fixture.port,
                run_id,
            ),
        )
        prepared = self.step(
            "configure_select_bind_send_and_complete",
            lambda: self.harness(
                "runMcpLifecycleDevelopment",
                {
                    "phase": "prepare",
                    "sampleId": sample_id,
                    "serverName": server_name,
                    "providerBaseUrl": provider_base_url,
                    "providerApiKey": self.minimum_provider_fixture.api_key,
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
                    "expectedAssistantResponse": expected_assistant_response,
                },
                timeout=900,
            ),
        )
        require(
            isinstance(prepared, Mapping),
            "minimum usable Agent Chat preparation returned invalid evidence",
        )
        prepared_assertions = prepared.get("assertions")
        expected_prepared_assertions = {
            "manifestAndConfigurationVisible",
            "installTestConnectSucceeded",
            "authoritativeBindingReady",
            "directModelAgentSelected",
            "governedMcpInvocationSucceeded",
            "finalAssistantVisibleAndPersisted",
            "cancellationVisibleAndTerminal",
            "retryRestoredConnection",
            "stationReplayEqual",
            "toolLineageComplete",
        }
        require(
            isinstance(prepared_assertions, Mapping)
            and set(prepared_assertions) == expected_prepared_assertions
            and all(value is True for value in prepared_assertions.values()),
            "minimum usable Agent Chat preparation assertions failed",
        )
        prepared_receiver = prepared.get("receiver-dom")
        prepared_tool_call = (
            prepared_receiver.get("toolCall")
            if isinstance(prepared_receiver, Mapping)
            else None
        )
        prepared_assistant = (
            prepared_receiver.get("assistant")
            if isinstance(prepared_receiver, Mapping)
            else None
        )
        require(
            isinstance(prepared_tool_call, Mapping)
            and prepared_tool_call.get("visible") is True
            and prepared_tool_call.get("status") == "success"
            and isinstance(prepared_assistant, Mapping)
            and prepared_assistant.get("visible") is True
            and prepared_assistant.get("terminalStatus") == "completed",
            "minimum usable Agent Chat receiver evidence is incomplete",
        )
        state = prepared.get("state")
        require(
            isinstance(state, Mapping),
            "minimum usable Agent Chat preparation omitted recovery state",
        )
        self.minimum_harness_state = dict(state)

        self.step("restart_native_client", self.restart_native_runtime)
        self.step(
            "station_transport_health_after_restart",
            self.verify_station_transport_health,
        )
        self.step("configure_station_after_restart", self.configure_station)
        self.step("login_after_restart", self.login)
        self.step("navigate_after_restart", self.navigate_and_configure)
        recovered = self.step(
            "recover_agent_conversation_and_capability",
            lambda: self.harness(
                "runMcpLifecycleDevelopment",
                {
                    "phase": "recover",
                    "sampleId": sample_id,
                    "serverName": server_name,
                    "state": self.minimum_harness_state,
                },
                timeout=600,
            ),
        )
        require(
            isinstance(recovered, Mapping),
            "minimum usable Agent Chat recovery returned invalid evidence",
        )
        recovered_assertions = recovered.get("assertions")
        recovered_cleanup = recovered.get("cleanup")
        expected_recovered_assertions = {
            "restartInvalidatedConnection",
            "priorOperationsRemainTerminal",
            "bindingSurvivedRestart",
            "agentAndDirectModelSurvivedRestart",
            "conversationAndFinalReplySurvivedRestart",
            "reconnectRestoredConnection",
            "cleanupComplete",
        }
        require(
            isinstance(recovered_assertions, Mapping)
            and set(recovered_assertions) == expected_recovered_assertions
            and all(value is True for value in recovered_assertions.values()),
            "minimum usable Agent Chat recovery assertions failed",
        )
        recovered_receiver = recovered.get("receiver-dom")
        restored_conversation = (
            recovered_receiver.get("restoredConversation")
            if isinstance(recovered_receiver, Mapping)
            else None
        )
        require(
            isinstance(restored_conversation, Mapping)
            and restored_conversation.get("visible") is True
            and restored_conversation.get("terminalStatus") == "completed",
            "minimum usable Agent Chat restart receiver evidence is incomplete",
        )
        require(
            isinstance(recovered_cleanup, Mapping)
            and recovered_cleanup.get("status") == "clean",
            "minimum usable Agent Chat product cleanup failed",
        )
        self.minimum_harness_state = None

        process_evidence = self.step(
            "verify_mcp_process_cleanup",
            lambda: inspect_mcp_fixture(
                fixture_root,
                expected_secret_digest=secret_digest,
                expected_launch_count=6,
            ),
        )
        require(
            process_evidence.get("sideEffectCount") == 1
            and process_evidence.get("allProcessesReaped") is True
            and process_evidence.get("allPortsReleased") is True,
            "minimum usable Agent Chat MCP process cleanup is incomplete",
        )
        provider_requests = self.minimum_provider_fixture.snapshot()
        require(
            len(provider_requests) == 2
            and provider_requests[0].get("hasToolResult") is False
            and provider_requests[1].get("hasToolResult") is True
            and provider_requests[1].get("hasExpectedToolResult") is True,
            "minimum usable Agent Chat Direct Model sequence is invalid",
        )

        self.dom_evidence["minimumUsableChat"] = {
            "prepared": prepared.get("receiver-dom"),
            "recovered": recovered.get("receiver-dom"),
        }
        self.station_readback["minimumUsableChat"] = {
            "prepared": prepared.get("station-readback"),
            "recovered": recovered.get("station-readback"),
        }
        self.journey_evidence["minimumUsableChat"] = {
            "capabilitySession": {
                "actorId": selected_session.get("ptid"),
                "sessionId": selected_session.get("session_id"),
            },
            "preparedAssertions": dict(prepared_assertions),
            "recoveredAssertions": dict(recovered_assertions),
            "providerRequests": provider_requests,
            "processEvidence": process_evidence,
        }
        for assertion_id in (
            "agent.minimum.agent-config.selected",
            "agent.minimum.direct-model.selected",
            "agent.minimum.mcp.binding-ready",
            "agent.minimum.message.sent",
            "agent.minimum.governed-execution.completed",
            "agent.minimum.final-response.visible",
            "agent.minimum.restart.conversation-restored",
            "agent.minimum.restart.final-response-restored",
            "agent.minimum.cleanup.clean",
        ):
            self.assertions.append({"id": assertion_id, "status": "pass"})

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
        marker = f"FIFO-{self.runtime_manifest['runId']}"
        composer = "[data-pt-agent-composer-input]"
        send = "[data-pt-agent-composer-send]"

        def send_running_turn() -> None:
            self.set_input_value(
                composer,
                "Count from 1 through 10000, one number per line, with no other text.",
                "running turn input",
            )
            self.click_visible(send, "send running turn")

        self.step("send_turn_native", send_running_turn)
        active = self.step(
            "wait_active_turn",
            lambda: wait_until(
                lambda: self.active_snapshot(minimum_seq=1),
                "active Agent turn",
            ),
        )
        conversation_id = str(active["operation"]["conversationId"])
        first_turn_id = str(active["operation"]["turnId"])

        def enqueue_native() -> dict[str, Any]:
            # The successor is queued behind a deliberately long first turn,
            # so it must explicitly supersede that instruction. Reasoning
            # models otherwise reconcile the two user requests indefinitely
            # behind the stream and never emit answer text within the
            # observation window.
            self.set_input_value(
                composer,
                f"Ignore any previous request in this conversation. "
                f"Reply with exactly {marker} and nothing else.",
                "FIFO input",
            )
            self.click_visible(send, "Send while the first turn runs")
            return self.wait_visible_element(
                "[data-pt-agent-message-queued]", "visible FIFO successor",
            )

        self.dom_evidence["queued"] = self.step("enqueue_native", enqueue_native)
        self.step(
            "stop_first_turn_native",
            lambda: self.click_visible("[data-pt-agent-stop]", "Stop first turn"),
        )

        def fifo_readback() -> dict[str, Any] | None:
            readback = self.conversation_readback(conversation_id)
            messages = readback.get("messages", [])
            cancelled = [
                row for row in messages if row.get("role") == "assistant"
                and row.get("turnId") == first_turn_id
                and row.get("status") == "cancelled"
            ]
            successors = [
                row for row in messages if row.get("role") == "assistant"
                and row.get("turnId") != first_turn_id
                and row.get("status") == "completed"
                and marker in str(row.get("content") or "")
            ]
            return readback if len(cancelled) == 1 and len(successors) == 1 else None

        self.station_readback["fifo"] = self.step(
            "fifo_cancel_and_successor_readback",
            lambda: wait_until(fifo_readback, "cancelled first turn and completed FIFO successor"),
        )
        self.dom_evidence["successor"] = self.step(
            "fifo_successor_visible",
            lambda: wait_until(
                lambda: self.driver.execute_script(
                    """
                    const row = [...document.querySelectorAll('[data-pt-agent-message-id]')]
                      .find(element => element.getClientRects().length
                        && element.innerText.includes(arguments[0]));
                    return row ? {messageId: row.dataset.ptAgentMessageId, text: row.innerText} : null;
                    """,
                    marker,
                ),
                "visible FIFO response",
            ),
        )
        self.step("send_recoverable_turn_native", send_running_turn)
        recoverable = self.step(
            "wait_recoverable_turn",
            lambda: wait_until(
                lambda: self.active_snapshot(minimum_seq=1),
                "admitted recoverable turn",
            ),
        )
        recovered_turn_id = str(recoverable["operation"]["turnId"])
        self.step("restart_active_native_runtime", self.restart_native_runtime)
        self.step("restore_agent_navigation", lambda: self.click_primary_navigation("agent", "Agent after restart"))
        self.step(
            "recovered_stop_native",
            lambda: self.click_visible("[data-pt-agent-stop]", "Stop recovered turn"),
        )
        def terminal_readback() -> dict[str, Any] | None:
            readback = self.conversation_readback(conversation_id)
            messages = [
                row for row in readback.get("messages", [])
                if row.get("turnId") == recovered_turn_id
            ]
            users = [row for row in messages if row.get("role") == "user"]
            assistants = [row for row in messages if row.get("role") == "assistant"]
            if len(users) != 1 or len(assistants) != 1:
                return None
            assistant = assistants[0]
            require(assistant.get("parentMessageId") == users[0].get("messageId"),
                    "recovered cancellation lost its admitted user lineage")
            return readback if assistant.get("status") == "cancelled" else None

        self.station_readback["recovered"] = self.step(
            "recovered_terminal_readback",
            lambda: wait_until(terminal_readback, "one durable recovered terminal"),
        )
        terminal_message = next(
            row for row in self.station_readback["recovered"]["messages"]
            if row.get("turnId") == recovered_turn_id and row.get("role") == "assistant"
        )
        terminal_selector = (
            f'[data-pt-agent-message-id="{terminal_message["messageId"]}"]'
            '[data-pt-agent-terminal-status="cancelled"]'
        )
        self.dom_evidence["cancelled"] = self.step(
            "recovered_terminal_visible",
            lambda: self.wait_visible_element(terminal_selector, "visible recovered cancellation"),
        )
        self.step("restart_terminal_native_runtime", self.restart_native_runtime)
        self.step("reload_agent_navigation", lambda: self.click_primary_navigation("agent", "reloaded Agent"))
        self.dom_evidence["reloaded"] = self.step(
            "terminal_history_reloaded",
            lambda: self.wait_visible_element(
                terminal_selector,
                "cancelled history after restart",
            ),
        )
        require(self.runtime_snapshot().get("isStreaming") is False,
                "terminal history left a loading projection after restart")
        require(self.dom_state(
            f'[data-pt-agent-message-id="{terminal_message["messageId"]}"]',
        )["count"] == 1, "restart duplicated the recovered assistant")
        for assertion_id in (
            "agent.native.turn.send-while-running",
            "agent.native.turn.fifo-successor",
            "agent.native.turn.stop-isolated",
            "agent.native.turn.recovered-stop",
            "agent.native.turn.terminal-lineage",
            "agent.native.turn.restart-no-loading-orphan",
        ):
            self.assertions.append({"id": assertion_id, "status": "pass"})

    def run_stream_resilience(self) -> None:
        proxy = self.proxy
        require(proxy is not None, "stream resilience requires a fault proxy")
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

        self.step("cut_station_transport", proxy.cut)
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
        self.step("restore_station_transport", proxy.restore)
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

    def run_attachment(self) -> None:
        self.step("login", self.login)
        self.step("navigate_and_configure", self.navigate_and_configure)
        locale = self.step(
            "set_locale",
            lambda: self.harness(
                "setFoundationLocale",
                {"locale": "en"},
                timeout=30,
            ),
        )
        require(
            isinstance(locale, Mapping) and locale.get("locale") == "en",
            "Attachment journey locale did not converge",
        )
        sample_id = f"attachment-{self.runtime_manifest.get('runId', '')}"
        required_roles = (
            "runtimeAttestation",
            "receiver-dom",
            "station-readback",
            "runtime-events",
            "measurement-report",
            "side-effect-count",
            "replay",
            "cleanup",
        )
        captures: dict[str, dict[str, Any]] = {}
        for cell, step_name in (
            ("AS-F05", "attachment_admission"),
            ("BASE-ATTACHMENT_REJECTED", "attachment_rejection_surface"),
        ):
            capture = self.step(
                step_name,
                lambda cell=cell: self.harness(
                    "foundationDirectProbe",
                    {
                        "platform": "desktop_app",
                        "locale": "en",
                        "cell": cell,
                        "sampleId": f"{sample_id}-{cell.lower()}",
                    },
                    timeout=300,
                ),
            )
            require(
                isinstance(capture, Mapping),
                f"Attachment journey returned invalid {cell} evidence",
            )
            assert_group_one_capture(
                DirectRuntimeProbeInput(
                    platform="desktop_app",
                    locale="en",
                    cell=cell,
                    sample_id=f"{sample_id}-{cell.lower()}",
                ),
                capture,
            )
            assertions = capture.get("assertions")
            require(
                isinstance(assertions, Mapping)
                and bool(assertions)
                and all(value is True for value in assertions.values()),
                f"Attachment journey did not satisfy every {cell} assertion",
            )
            missing_roles = sorted(
                role for role in required_roles
                if not isinstance(capture.get(role), Mapping)
            )
            require(
                not missing_roles,
                f"Attachment journey {cell} is missing evidence roles: "
                + ", ".join(missing_roles),
            )
            receiver_dom = capture["receiver-dom"]
            station_readback = capture["station-readback"]
            runtime_events = capture["runtime-events"]
            replay = capture["replay"]
            product_cleanup = capture["cleanup"]
            require(
                receiver_dom.get("visible") is True,
                f"Attachment journey {cell} receiver evidence is not visible",
            )
            require(
                station_readback.get("entityKind") in {
                    "agent-conversation-readback",
                    "agent-attachment-pre-admission",
                }
                and bool(station_readback.get("stateHash")),
                f"Attachment journey {cell} Station readback is incomplete",
            )
            require(
                int(runtime_events.get("sequence") or 0) > 0,
                f"Attachment journey {cell} runtime event is missing",
            )
            require(
                replay.get("equal") is True,
                f"Attachment journey {cell} replay readback diverged",
            )
            require(
                product_cleanup.get("status") == "clean",
                f"Attachment journey {cell} product cleanup was not clean",
            )
            assertion_prefix = cell.lower().replace("_", "-")
            self.assertions.extend(
                {
                    "id": f"{assertion_prefix}.{assertion_id}",
                    "status": "pass",
                }
                for assertion_id in sorted(assertions)
            )
            captures[cell] = dict(capture)

        self.dom_evidence = {
            cell: capture["receiver-dom"]
            for cell, capture in captures.items()
        }
        self.station_readback = {
            cell: capture["station-readback"]
            for cell, capture in captures.items()
        }
        self.journey_evidence = captures

    def best_effort_logout(self) -> None:
        if self.driver is None:
            return
        try:
            snapshot = self.runtime_snapshot()
            if snapshot.get("authenticated"):
                self.harness("logout", timeout=30)
        except Exception:  # noqa: BLE001 - cleanup result records failures separately.
            pass

    def cleanup_lifecycle_fixtures(self) -> list[str]:
        failures: list[str] = []
        if self.driver is None:
            if (self.lifecycle_fixture_ids or self.cli_provider_fixture
                    or self.chat_provider_fixture_ids or self.chat_provider_restore
                    or self.chat_skill_fixture_ids or self.chat_mcp_fixture_names):
                failures.append("owned Agent or Provider fixtures remain without a command transport")
            return failures
        if self.journey == "cli-provider" and self.cli_provider_sample_id:
            try:
                residue = self.harness(
                    "cleanupCliProviderPrimaryResidue",
                    {"sampleId": self.cli_provider_sample_id},
                    timeout=120,
                )
                if (
                    not isinstance(residue, Mapping)
                    or residue.get("status") != "clean"
                ):
                    failures.append(
                        f"CLI Provider residue cleanup: {residue}"
                    )
                else:
                    self.lifecycle_fixture_ids.clear()
                    self.cli_provider_fixture = None
            except Exception as error:  # noqa: BLE001
                failures.append(f"CLI Provider residue cleanup: {error}")
        try:
            profile_open = self.visible_element_state(
                self.lifecycle_selector("profile_back")
            ) is not None
        except Exception as error:  # noqa: BLE001 - continue residue cleanup.
            profile_open = False
            failures.append(f"Agent profile inspection: {error}")
        if profile_open:
            try:
                self.click_visible(
                    self.lifecycle_selector("profile_back"),
                    "Agent profile back control",
                )
            except Exception as error:  # noqa: BLE001 - continue residue cleanup.
                failures.append(f"Agent profile exit: {error}")
        for skill in reversed(tuple(self.chat_skill_fixture_ids)):
            try:
                self.invoke_readback_command(
                    "skills_delete",
                    {
                        "agent_id": skill["agentId"],
                        "id": skill["skillId"],
                    },
                )
                self.chat_skill_fixture_ids.remove(skill)
            except Exception as error:
                failures.append(
                    f"Chat Suite Skill {skill.get('skillId', '')} cleanup: {error}"
                )
        for agent_id in reversed(tuple(self.lifecycle_fixture_ids)):
            try:
                self.harness(
                    "cleanupChatSuiteCapabilityBindings",
                    {"agentId": agent_id},
                    timeout=120,
                )
            except Exception as error:  # noqa: BLE001 - continue Agent cleanup.
                failures.append(
                    f"Agent fixture {agent_id} capability cleanup: {error}"
                )
            try:
                if self.station_agent_absent(agent_id) is None:
                    self.invoke_readback_command(
                        "agents_delete",
                        {"id": agent_id},
                    )
                    wait_until(
                        lambda: self.station_agent_absent(agent_id),
                        f"Agent {agent_id} cleanup readback",
                    )
                self.lifecycle_fixture_ids.remove(agent_id)
            except Exception as error:  # noqa: BLE001 - cleanup must remove residue.
                failures.append(f"Agent fixture {agent_id} cleanup: {error}")
        for name in reversed(tuple(self.chat_mcp_fixture_names)):
            try:
                self.invoke_readback_command("mcp_delete_server", {"name": name})
                self.chat_mcp_fixture_names.remove(name)
            except Exception as error:
                failures.append(f"Chat Suite MCP {name} cleanup: {error}")
        if self.journey.startswith("chat-") and self.cli_provider_fixture:
            try:
                self.invoke_readback_command(
                    "provider_delete",
                    {"id": self.cli_provider_fixture["providerId"]},
                )
                self.cli_provider_fixture = None
            except Exception as error:
                failures.append(f"Chat Suite Provider cleanup: {error}")
        for provider_id in reversed(tuple(self.chat_provider_fixture_ids)):
            try:
                self.invoke_readback_command("provider_delete", {"id": provider_id})
                self.chat_provider_fixture_ids.remove(provider_id)
            except Exception as error:
                failures.append(f"Chat Suite Provider {provider_id} cleanup: {error}")
        for provider_id, original in tuple(self.chat_provider_restore.items()):
            try:
                current = self.invoke_readback_command(
                    "provider_get", {"id": provider_id},
                )["provider"]
                self.invoke_readback_command("provider_update", {
                    "id": provider_id, "enabled": original["enabled"],
                    "version": int(current["version"]),
                    "runtime_config": original["runtime_config"],
                })
                restored = self.invoke_readback_command(
                    "provider_get", {"id": provider_id},
                )["provider"]
                require(restored["runtime_config"] == original["runtime_config"]
                        and restored["enabled"] == original["enabled"],
                        "CLI fixture configuration was not restored")
                del self.chat_provider_restore[provider_id]
            except Exception as error:
                failures.append(f"Chat Suite CLI {provider_id} restore: {error}")
        return failures

    def cleanup_minimum_usable_resources(self) -> list[str]:
        failures: list[str] = []
        harness_cleanup: Any = None
        if self.minimum_harness_state is not None and self.driver is not None:
            try:
                harness_cleanup = self.harness(
                    "runMcpLifecycleDevelopment",
                    {
                        "phase": "cleanup",
                        "sampleId": "minimum-usable-cleanup",
                        "serverName": self.minimum_harness_state["serverName"],
                        "state": self.minimum_harness_state,
                    },
                    timeout=300,
                )
                if (
                    not isinstance(harness_cleanup, Mapping)
                    or harness_cleanup.get("status") != "clean"
                ):
                    failures.append(
                        f"minimum usable Harness cleanup: {harness_cleanup}"
                    )
                else:
                    self.minimum_harness_state = None
            except Exception as error:  # noqa: BLE001
                failures.append(f"minimum usable Harness cleanup: {error}")
        if self.minimum_harness_state is not None:
            failures.append("minimum usable Harness state remains")

        bridge_cleanup: Any = None
        if self.minimum_provider_bridge is not None:
            try:
                bridge_cleanup = self.minimum_provider_bridge.stop()
                if bridge_cleanup.get("status") != "clean":
                    failures.append(
                        f"minimum usable provider bridge: {bridge_cleanup}"
                    )
            except Exception as error:  # noqa: BLE001
                failures.append(f"minimum usable provider bridge: {error}")
            self.minimum_provider_bridge = None

        provider_stopped = self.minimum_provider_fixture is None
        if self.minimum_provider_fixture is not None:
            try:
                self.minimum_provider_fixture.stop()
                provider_stopped = True
            except Exception as error:  # noqa: BLE001
                failures.append(f"minimum usable provider fixture: {error}")
            self.minimum_provider_fixture = None

        fixture_storage_released = self.minimum_fixture_root is None
        if self.minimum_fixture_root is not None:
            shutil.rmtree(self.minimum_fixture_root, ignore_errors=True)
            fixture_storage_released = not self.minimum_fixture_root.exists()
            if not fixture_storage_released:
                failures.append(
                    "minimum usable MCP fixture storage remains"
                )
            self.minimum_fixture_root = None

        self.minimum_resource_cleanup = {
            "status": "clean" if not failures else "failed",
            "harness": harness_cleanup,
            "providerBridge": bridge_cleanup,
            "providerFixtureStopped": provider_stopped,
            "fixtureStorageReleased": fixture_storage_released,
            "failures": list(failures),
        }
        return failures

    def cleanup(self) -> dict[str, Any]:
        failures = self.cleanup_minimum_usable_resources()
        failures.extend(self.cleanup_lifecycle_fixtures())
        if (
            self.direct_fault_proxy is not None
            or self.direct_station_transport_override is not None
        ):
            try:
                self.release_direct_station_fault_route()
            except Exception as error:
                failures.append(f"Direct Station fault route cleanup: {error}")
        if self.chat_station_origin is not None:
            try:
                self.chat_station_origin.restore()
                self.station_readback["canonicalOriginRestored"] = True
            except Exception as error:
                failures.append(f"Station canonical origin restoration: {error}")
        if self.runtime_binding is not None:
            try:
                self.station_readback["bindingProof"] = (
                    self.runtime_binding.binding_proof_evidence()
                )
            except Exception as error:
                failures.append(f"runtime-binding proof: {error}")
            try:
                for session in reversed(self.runtime_sessions):
                    session.stop()
                log_chunks: list[bytes] = []
                for index, session in enumerate(self.runtime_sessions, start=1):
                    if session.log_path is None or not session.log_path.is_file():
                        continue
                    try:
                        content = session.log_path.read_bytes()[-1_000_000:]
                    except OSError as error:
                        failures.append(
                            f"native session {index} log capture: {error}"
                        )
                        continue
                    log_chunks.append(f"\n=== native session {index} ===\n".encode())
                    log_chunks.append(content)
                self.desktop_log_bytes = b"".join(log_chunks)
                audit = self.runtime_binding.finalize_cleanup(
                    self.runtime_sessions,
                    {self.client["id"]: self.client},
                )
                if (
                    audit.get("cleanupErrors")
                    or audit.get("tunnelFailures")
                    or any(
                        audit.get(key) is not True
                        for key in (
                            "portsReleased", "processesReleased",
                            "storageReleased", "logsReleased",
                        )
                    )
                ):
                    failures.append(f"runtime-binding cleanup: {audit}")
            except Exception as error:
                audit = {"error": str(error)}
                failures.append(f"runtime-binding cleanup: {error}")
            if self.proxy is not None:
                self.proxy.close()
            self.tauri_driver = None
            self.driver = None
            self.cleanup_evidence = {
                "status": "failed" if failures else "passed",
                "runtimeBinding": audit,
                "failures": failures,
            }
            return self.cleanup_evidence
        self.best_effort_logout()
        if self.tauri_driver is not None:
            try:
                self.tauri_driver.stop()
            except Exception as error:  # noqa: BLE001
                failures.append(f"tauri-driver: {error}")
            self.tauri_driver = None
        self.driver = None
        if self.proxy is not None:
            self.proxy.close()
        if self.desktop_log.is_file():
            try:
                self.desktop_log_bytes = self.desktop_log.read_bytes()
            except OSError as error:
                failures.append(f"desktop-log: {error}")
        shutil.rmtree(self.run_root, ignore_errors=True)
        ports = {
            "gateway": not port_open(self.gateway_port),
            "renderer": not port_open(self.renderer_port),
            "webdriver": not port_open(self.webdriver_port),
            "faultProxy": (
                self.proxy is None or not port_open(self.proxy.port)
            ),
        }
        if not all(ports.values()):
            failures.append(f"ports still listening: {ports}")
        if self.run_root.exists():
            failures.append(f"run storage remains: {self.run_root}")
        self.cleanup_evidence = {
            "status": "passed" if not failures else "failed",
            "portsReleased": ports,
            "storageReleased": not self.run_root.exists(),
            "minimumUsableResources": self.minimum_resource_cleanup,
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
            if journey_name == "minimum-usable-chat":
                runner.step(
                    "seed_native_actor_identity",
                    runner.seed_minimum_usable_actor_identity,
                )
            runner.step("start_native_runtime", runner.start)
            runner.step(
                "station_transport_health",
                runner.verify_station_transport_health,
            )
            runner.step("configure_active_station", runner.configure_station)
            if journey_name == "stream-resilience":
                runner.run_stream_resilience()
            elif journey_name == "attachment":
                runner.run_attachment()
            elif journey_name == "core-lifecycle":
                runner.run_core_lifecycle()
            elif journey_name == "cli-provider":
                runner.run_cli_provider()
            elif journey_name == "minimum-usable-chat":
                runner.run_minimum_usable_chat()
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

        attachment_journey = journey_name == "attachment"
        cli_provider_journey = journey_name == "cli-provider"
        lifecycle_journey = journey_name == "core-lifecycle"
        minimum_usable_journey = journey_name == "minimum-usable-chat"
        if attachment_journey:
            phase = "F3 Context And Resource Intelligence"
            bom = ["C08"]
            spec = [
                "tooling/acceptance/features/agent-attachment-reference.yaml",
                "docs/architecture/domains/agent/execution-plans/"
                "20260817-modern-chat-agent-v2-execution.md",
            ]
            gate_claim = (
                "C08 requires opaque authorized refs, admission before provider "
                "execution, persisted attribution, visible attachment projection, "
                "authorized download, and cleanup."
            )
        elif minimum_usable_journey:
            phase = "Minimum Usable Agent Chat"
            bom = ["agent-minimum-usable-chat"]
            spec = [
                "tooling/acceptance/features/"
                "agent-minimum-usable-chat.yaml",
                "docs/architecture/domains/agent/execution-plans/"
                "20261001-minimum-usable-agent-chat/plan.md",
            ]
            gate_claim = (
                "One profile-two Native client must configure and select a "
                "Direct Model Agent, bind a ready MCP capability, complete one "
                "Station-governed invocation and final Assistant response, "
                "then restore that Agent, conversation, binding, and response "
                "after native restart."
            )
        elif cli_provider_journey:
            phase = "CLI Provider Primary Journey"
            bom = ["agent-cli-provider-primary"]
            spec = [
                "tooling/acceptance/features/agent-cli-provider-primary.yaml",
                "tooling/acceptance/matrices/"
                "agent-cli-provider-primary-native.yaml",
                "docs/architecture/domains/agent/execution-plans/"
                "20260917-modern-chat-agent-v2-alignment/tasks/MCA-P04.md",
            ]
            gate_claim = (
                "The built-in CLI Provider must be selectable without HTTP "
                "credentials and complete a Station-backed native Agent turn "
                "that survives native process restart."
            )
        elif lifecycle_journey:
            phase = "Agent Core Lifecycle"
            bom = ["agent-core-lifecycle"]
            spec = [
                "tooling/acceptance/features/agent-core-lifecycle.yaml",
                "tooling/acceptance/matrices/agent-core-lifecycle-native.yaml",
            ]
            gate_claim = (
                "Agent core lifecycle requires native create, list, select, edit, "
                "duplicate, default, session-start, delete, negative state, "
                "Station readback, and cleanup evidence."
            )
        elif journey_name == "turn":
            phase = "Agent Turn Projection Ownership"
            bom = ["agent-turn-projection"]
            spec = ["docs/knowledge/invariants/agent-turn-projection-ownership.md"]
            gate_claim = (
                "Native Send admits a visible FIFO successor during streaming; "
                "Stop cancels only its owner; native restart restores a stoppable "
                "turn and one terminal assistant with admitted user lineage."
            )
        else:
            phase = "Residual Product Closure"
            bom = ["R6"]
            spec = [
                "tooling/acceptance/features/agent-stream-resilience.yaml",
                "docs/architecture/domains/agent/execution-plans/"
                "20260816-lobehub-parity-full-landing.md",
            ]
            gate_claim = (
                "R6 requires visible reconnecting state, monotonic cursor replay "
                "equal to Station readback, identity-boundary teardown, and "
                "resource cleanup."
            )
        report = {
            "artifactKind": "acceptance-gate-evidence-report",
            "gateId": gate_id,
            "journey": journey_name,
            "status": status,
            "completionStatus": "DONE" if status == "passed" else "FAILED",
            "proofStatus": "PROVEN" if status == "passed" else "UNPROVEN",
            "phase": phase,
            "bom": bom,
            "spec": spec,
            "gate": gate_claim,
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
            "journeyEvidence": (
                runner.journey_evidence if runner is not None else {}
            ),
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
        if attachment_journey:
            artifacts.write_json(
                "evidence/attachment.json",
                {
                    "artifactKind": "agent-attachment-evidence",
                    **evidence_metadata,
                    "evidence": report["journeyEvidence"],
                },
                role="attachment-evidence",
            )
        if runner is not None and runner.desktop_log_bytes:
            artifacts.write_bytes(
                "logs/desktop.log",
                runner.desktop_log_bytes,
                media_type="text/plain",
            )
        artifacts.complete(
            status=status,
            completion_status="DONE" if status == "passed" else "FAILED",
            proof_status="PROVEN" if status == "passed" else "UNPROVEN",
            runtime={
                "environment": "home-station",
                "profile": approved_profile_for_journey(journey_name),
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
