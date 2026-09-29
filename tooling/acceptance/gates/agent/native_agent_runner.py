#!/usr/bin/env python3
"""Native Tauri Agent acceptance runner.

Each journey consumes the provisioned approved-profile runtime and writes evidence
through the external Acceptance Evidence Store. Stream resilience additionally
injects a real transport fault between Desktop and Station.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import socket
import sys
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
from tooling.acceptance.gates.agent.foundation_direct_adapter import (
    DirectRuntimeProbeInput,
)
from tooling.acceptance.gates.agent.foundation_group_one_probe import (
    assert_group_one_capture,
)
from tooling.acceptance.gates.agent.tcp_fault_proxy import TcpFaultProxy


GATE_BY_JOURNEY = {
    "turn": "agent-native-turn-e2e",
    "core-lifecycle": "agent-core-lifecycle-native-e2e",
    "stream-resilience": "agent-stream-resilience-e2e",
    "attachment": "agent-attachment-e2e",
}
# These selectors are the integration contract with the Agent workbench UI.
# Keep lifecycle-specific selectors here so a parallel UI lane can bind them
# without changing journey semantics or scattering fallback selectors.
CORE_LIFECYCLE_SELECTORS = {
    "create": "[data-pt-agent-create]",
    "create_dialog": "[data-pt-agent-create-dialog]",
    "create_name": "[data-pt-agent-create-name]",
    "create_submit": "[data-pt-agent-create-submit]",
    "create_title": "[data-pt-agent-create-title]",
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
    "default": (
        '[data-pt-agent-row][data-pt-agent-id="{agent_id}"]'
        '[data-pt-agent-default="true"]'
    ),
    "session_start": "[data-pt-agent-session-start]",
    "topic_error": "[data-pt-agent-topic-load-error]",
    "topic_retry": "[data-pt-agent-topic-load-retry]",
    "composer": "[data-pt-agent-composer]",
    "confirm_delete": '[data-pt-agent-delete-confirm="{agent_id}"]',
}
APPROVED_PROFILE = os.environ.get("PT_ACCEPTANCE_APPROVED_PROFILE", "one")
CORE_LIFECYCLE_PROFILE = "two"
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


def approved_profile_for_journey(journey: str) -> str:
    if journey == "core-lifecycle":
        return CORE_LIFECYCLE_PROFILE
    return APPROVED_PROFILE


def provider_configuration_required_for_journey(journey: str) -> bool:
    return journey != "core-lifecycle"


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
        self.runtime_profile = self.run_root / f"{self.approved_profile}.env"
        self.desktop_log = self.run_root / "desktop.log"
        self.proxy = (
            TcpFaultProxy.from_url(self.station_url)
            if journey in {"stream-resilience", "core-lifecycle"}
            else None
        )
        self.station_transport_url = (
            self.proxy.url if self.proxy is not None else self.station_url
        )
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
        self.desktop_log_bytes = b""
        self.driver: Any = None
        self.steps: list[dict[str, Any]] = []
        self.assertions: list[dict[str, Any]] = []
        self.station_readback: dict[str, Any] = {}
        self.dom_evidence: dict[str, Any] = {}
        self.journey_evidence: dict[str, Any] = {}
        self.cleanup_evidence: dict[str, Any] = {"status": "not-run"}
        self.lifecycle_fixture_ids: list[str] = []

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
            entry.update(
                status="failed",
                completedAt=now_iso(),
                durationMs=int((time.monotonic() - started) * 1000),
                error=str(error),
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
        }
        self.runtime_profile.write_text(
            "\n".join(f"{key}={value}" for key, value in sorted(values.items()))
            + "\n",
            encoding="utf-8",
        )
        self.runtime_profile.chmod(0o600)

    def start(self) -> None:
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
            {"stationUrl": self.station_transport_url},
            timeout=60,
        )
        expected_url = self.station_transport_url.rstrip("/")
        require(
            isinstance(result, Mapping)
            and result.get("configured") is True
            and str(result.get("activeUrl") or "").rstrip("/") == expected_url
            and result.get("online") is True
            and result.get("peerIdAvailable") is True,
            f"Agent Station binding did not converge: {result}",
        )
        return dict(result)

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
        self.harness("navigateToAgent", timeout=60)
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
            const element = Array.from(document.querySelectorAll(selector))
              .find((candidate) => candidate.getClientRects().length > 0);
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

    def click_visible(self, selector: str, description: str) -> dict[str, Any]:
        self.wait_visible_element(selector, description)
        result = self.driver.execute_script(
            """
            const selector = arguments[0];
            const element = Array.from(document.querySelectorAll(selector))
              .find((candidate) => candidate.getClientRects().length > 0);
            if (!element) return null;
            const result = {
              selector,
              text: (element.textContent || '').trim(),
            };
            element.click();
            return result;
            """,
            selector,
        )
        require(isinstance(result, dict), f"{description} is not visible")
        return result

    def set_input_value(
        self,
        selector: str,
        value: str,
        description: str,
    ) -> dict[str, Any]:
        result = self.driver.execute_script(
            """
            const [selector, value] = arguments;
            const input = Array.from(document.querySelectorAll(selector))
              .find((candidate) => candidate.getClientRects().length > 0);
            if (!(input instanceof HTMLInputElement)
              && !(input instanceof HTMLTextAreaElement)) return null;
            const prototype = input instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
            if (!setter) return null;
            input.focus();
            setter.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.blur();
            return { selector, value: input.value };
            """,
            selector,
            value,
        )
        require(
            isinstance(result, dict) and result.get("value") == value,
            f"{description} could not be edited",
        )
        return result

    def click_agent_action(self, agent_id: str, action: str) -> None:
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

    def select_agent_chat(self, agent_id: str) -> dict[str, Any]:
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
            require(expect_error, f"{command} Station readback was rejected")
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
        created_name = f"lifecycle-{int(time.time() * 1000)}"
        created_title = f"Lifecycle {created_name.removeprefix('lifecycle-')}"
        self.step(
            "create_agent_native_ui",
            lambda: self.click_visible(
                self.lifecycle_selector("create"),
                "Agent create control",
            ),
        )
        self.step(
            "create_dialog_visible",
            lambda: self.wait_visible_element(
                self.lifecycle_selector("create_dialog"),
                "Agent create dialog",
            ),
        )
        unopened_roster = self.step(
            "create_dialog_zero_persistence",
            self.station_agent_roster,
        )
        require(
            len(unopened_roster["agents"]) == baseline_roster_count,
            "opening Agent creation persisted a placeholder Agent",
        )
        self.step(
            "enter_created_agent_name",
            lambda: self.set_input_value(
                self.lifecycle_selector("create_name"),
                created_name,
                "Agent create name",
            ),
        )
        self.step(
            "enter_created_agent_title",
            lambda: self.set_input_value(
                self.lifecycle_selector("create_title"),
                created_title,
                "Agent create title",
            ),
        )
        self.step(
            "submit_agent_creation",
            lambda: self.click_visible(
                self.lifecycle_selector("create_submit"),
                "Agent create submit control",
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
                expected_name=created_name,
                expected_title=created_title,
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

        self.step(
            "duplicate_agent_native_ui",
            lambda: self.click_agent_action(created_id, "clone"),
        )
        duplicate_name = f"{created_name}-copy"
        duplicate_row = self.step(
            "duplicated_agent_listed",
            lambda: wait_until(
                lambda: self.driver.execute_script(
                    """
                    const expectedName = arguments[0];
                    const row = Array.from(
                      document.querySelectorAll('[data-pt-agent-row]')
                    ).find((candidate) =>
                      candidate.getClientRects().length > 0
                      && candidate.getAttribute('data-pt-agent-name') === expectedName
                    );
                    return row ? {
                      agentId: row.getAttribute('data-pt-agent-id'),
                      name: row.getAttribute('data-pt-agent-name'),
                      text: (row.textContent || '').trim(),
                    } : null;
                    """,
                    duplicate_name,
                ),
                "duplicated Agent list row",
            ),
        )
        require(
            isinstance(duplicate_row, Mapping)
            and bool(duplicate_row.get("agentId")),
            "duplicated Agent row has no identity",
        )
        duplicate_id = str(duplicate_row["agentId"])
        require(duplicate_id != created_id, "duplicate reused the source Agent ID")
        self.lifecycle_fixture_ids.append(duplicate_id)
        self.step(
            "select_duplicated_agent",
            lambda: self.select_agent_chat(duplicate_id),
        )
        duplicate_station = self.step(
            "duplicated_agent_station_readback",
            lambda: self.lifecycle_station_state(
                expected_agent_id=duplicate_id,
                expected_name=duplicate_name,
            ),
        )
        duplicate_authority = self.step(
            "duplicated_agent_station_authority",
            lambda: self.station_agent(duplicate_id),
        )
        require(
            duplicate_authority.get("name") == duplicate_name,
            "Station Agent authority did not persist the duplicate",
        )
        duplicate_conversation_count = len(duplicate_station["conversations"])

        self.step(
            "set_default_agent_native_ui",
            lambda: self.click_agent_action(duplicate_id, "default"),
        )
        default_dom = self.step(
            "default_agent_visible",
            lambda: self.wait_visible_element(
                self.lifecycle_selector("default", agent_id=duplicate_id),
                "default Agent marker",
            ),
        )
        default_station = self.step(
            "default_agent_station_readback",
            lambda: self.lifecycle_station_state(
                expected_agent_id=duplicate_id,
                expected_name=duplicate_name,
                expected_default=True,
            ),
        )
        default_authority = self.step(
            "default_agent_station_authority",
            lambda: self.invoke_readback_command("agents_get_default"),
        )
        require(
            default_authority.get("defaultAgent") == duplicate_name
            and isinstance(default_authority.get("agent"), Mapping)
            and default_authority["agent"].get("id") == duplicate_id,
            "Station default Agent readback did not match the native action",
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
                expected_agent_id=duplicate_id,
                expected_name=duplicate_name,
            ),
        )
        session_conversations = session_station["conversations"]
        require(
            len(session_conversations) == duplicate_conversation_count,
            "empty session start persisted a phantom Station conversation",
        )

        proxy = self.proxy
        require(proxy is not None, "topic recovery requires a fault proxy")
        proxy.cut()
        try:
            topic_failure = self.step(
                "topic_load_failure_visible",
                lambda: self.harness(
                    "prepareAgentTopicLoadFailure",
                    {"agentId": duplicate_id},
                    timeout=60,
                ),
            )
        finally:
            proxy.restore()
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
                                    {"agentId": duplicate_id},
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
            "repeat_duplicate_native_ui",
            lambda: self.click_agent_action(created_id, "clone"),
        )
        repeated_duplicate_name = f"{created_name}-copy-2"
        repeated_duplicate_row = self.step(
            "repeat_duplicate_unique_name_visible",
            lambda: wait_until(
                lambda: self.driver.execute_script(
                    """
                    const expectedName = arguments[0];
                    const row = Array.from(
                      document.querySelectorAll('[data-pt-agent-row]')
                    ).find((candidate) =>
                      candidate.getClientRects().length > 0
                      && candidate.getAttribute('data-pt-agent-name') === expectedName
                    );
                    return row ? {
                      agentId: row.getAttribute('data-pt-agent-id'),
                      name: row.getAttribute('data-pt-agent-name'),
                    } : null;
                    """,
                    repeated_duplicate_name,
                ),
                "repeated duplicate Agent list row",
            ),
        )
        require(
            isinstance(repeated_duplicate_row, Mapping)
            and bool(repeated_duplicate_row.get("agentId")),
            "repeated duplicate Agent row has no identity",
        )
        repeated_duplicate_id = str(repeated_duplicate_row["agentId"])
        require(
            repeated_duplicate_id not in {created_id, duplicate_id},
            "repeated duplicate reused an existing Agent ID",
        )
        self.lifecycle_fixture_ids.append(repeated_duplicate_id)
        repeated_duplicate_authority = self.step(
            "repeat_duplicate_station_authority",
            lambda: self.station_agent(repeated_duplicate_id),
        )
        require(
            repeated_duplicate_authority.get("name") == repeated_duplicate_name,
            "repeated duplicate did not persist a unique Agent name",
        )

        self.step(
            "delete_repeated_duplicate_agent_native_ui",
            lambda: self.delete_lifecycle_agent(repeated_duplicate_id),
        )
        self.step(
            "delete_duplicated_agent_native_ui",
            lambda: self.delete_lifecycle_agent(duplicate_id),
        )
        deleted_duplicate = self.assert_visible(
            self.lifecycle_selector("row", agent_id=duplicate_id),
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
            created_id not in post_delete_ids and duplicate_id not in post_delete_ids,
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
            "duplicateRow": dict(duplicate_row),
            "repeatedDuplicateRow": dict(repeated_duplicate_row),
            "defaultMarker": default_dom,
            "deletedDuplicate": deleted_duplicate,
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
            "duplicated": duplicate_station,
            "duplicatedAuthority": duplicate_authority,
            "repeatedDuplicateAuthority": repeated_duplicate_authority,
            "default": default_station,
            "defaultAuthority": default_authority,
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
            "agent.lifecycle.duplicate.persisted",
            "agent.lifecycle.default.visible-and-readable",
            "agent.lifecycle.session-start.no-phantom-persistence",
            "agent.lifecycle.topic-load.failure-preserves-state",
            "agent.lifecycle.topic-load.retry-recovers",
            "agent.lifecycle.repeat-duplicate.unique",
            "agent.lifecycle.delete.removed",
            "agent.lifecycle.deleted-selection.unavailable",
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
            return failures
        if self.visible_element_state(
            self.lifecycle_selector("profile_back")
        ) is not None:
            try:
                self.click_visible(
                    self.lifecycle_selector("profile_back"),
                    "Agent profile back control",
                )
            except Exception as error:  # noqa: BLE001 - continue residue cleanup.
                failures.append(f"Agent profile exit: {error}")
        for agent_id in reversed(tuple(self.lifecycle_fixture_ids)):
            try:
                self.delete_lifecycle_agent(agent_id)
            except Exception as ui_error:  # noqa: BLE001 - cleanup must remove residue.
                try:
                    self.invoke_readback_command(
                        "agents_delete",
                        {"id": agent_id},
                    )
                    self.lifecycle_fixture_ids.remove(agent_id)
                except Exception as command_error:  # noqa: BLE001
                    failures.append(
                        f"Agent fixture {agent_id}: ui={ui_error}; "
                        f"command={command_error}"
                    )
        return failures

    def cleanup(self) -> dict[str, Any]:
        failures = self.cleanup_lifecycle_fixtures()
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
        lifecycle_journey = journey_name == "core-lifecycle"
        if attachment_journey:
            phase = "F3 Context And Resource Intelligence"
            bom = ["C08"]
            spec = [
                "tooling/acceptance/features/agent-attachment-reference.yaml",
                "docs/architecture/agent/execution-plans/"
                "20260817-modern-chat-agent-v2-execution.md",
            ]
            gate_claim = (
                "C08 requires opaque authorized refs, admission before provider "
                "execution, persisted attribution, visible attachment projection, "
                "authorized download, and cleanup."
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
        else:
            phase = "Residual Product Closure"
            bom = ["R6"]
            spec = [
                "tooling/acceptance/features/agent-stream-resilience.yaml",
                "docs/architecture/agent/execution-plans/"
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
