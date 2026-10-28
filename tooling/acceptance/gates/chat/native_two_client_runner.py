#!/usr/bin/env python3
"""Prove Direct delivery and receipts through two native Tauri clients."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import random
import re
import time
import urllib.request
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit
from xml.etree import ElementTree

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from tooling.acceptance.core import (
    AcceptanceGate,
    ActorRuntime,
    ArtifactRef,
    EvidenceStore,
    GateError,
    REPO_ROOT,
    call_async_harness,
)
from tooling.acceptance.core.provisioning import load_runtime_manifest
from tooling.acceptance.core.evidence_store import workspace_id
from tooling.acceptance.core.launch_context import EphemeralGateClient
from tooling.acceptance.drivers.native import NativeDesktopRuntimeBinding
from tooling.acceptance.drivers.native.runtime import NativeLaunchOptions
from tooling.acceptance.drivers.tauri import TauriSession
from tooling.acceptance.gates.chat.native_support import (
    DEV_ACCOUNT_PASSWORD,
    NativeClientLifecycleLedger,
    async_harness,
    commits_match,
    enter_chat_page,
    is_native_tauri_url,
    native_runtime_source_identity,
    runtime_station_service,
    verify_runtime_fixture_ready,
    wait_for_peer_key_bundle,
)


GATE_ID = "chat-native-two-client-e2e"
CURRENT_PROFILE_GATE_ID = "chat-native-current-profile-two-client-e2e"
LIFECYCLE_ONBOARDING_GATE_ID = "chat-lifecycle-onboarding-e2e"
LIFECYCLE_DIRECT_GATE_ID = "chat-lifecycle-direct-e2e"
LIFECYCLE_RICH_VOICE_GATE_ID = "chat-lifecycle-rich-voice-e2e"
PRESENCE_LAYOUT_GATE_ID = "chat-presence-layout-e2e"
LIVE_VOICE_GATE_ID = "chat-lifecycle-live-voice-e2e"
SUBMITTED_COMMAND_RECOVERY_GATE_ID = (
    "chat-native-submitted-command-recovery-e2e"
)
STORAGE_ACCOUNTING_GATE_ID = "chat-storage-accounting-e2e"
STORAGE_BATCH_DESKTOP_GATE_ID = "chat-storage-desktop-batch-clear-e2e"
STORAGE_REDACTION_RECOVERY_GATE_ID = "chat-storage-redaction-recovery-e2e"
CURRENT_PROFILE_GATE_IDS = frozenset(
    {
        CURRENT_PROFILE_GATE_ID,
        SUBMITTED_COMMAND_RECOVERY_GATE_ID,
    }
)
CURRENT_PROFILE_ACTORS = ("alice", "bob")
CURRENT_PROFILE_INITIAL_SENDER = "bob"
STEP_TIMEOUT = float(os.environ.get("CHAT_NATIVE_STEP_TIMEOUT_SECONDS", "120"))
STATION_BINDING_PROJECTION_TIMEOUT = 30
REQUIRED_ASSERTIONS = {
    "native_runtime",
    "source_build_runtime_identity",
    "actor_isolation",
    "alice_to_bob_plaintext",
    "alice_to_bob_delivered",
    "alice_to_bob_message_clear",
    "bob_to_alice_plaintext",
    "bob_to_alice_delivered",
    "bob_to_alice_message_clear",
    "demo_avatar_bundled",
    "resources_released",
}
CURRENT_PROFILE_REQUIRED_ASSERTIONS = {
    "current_profile_instance_isolation",
    "current_profile_group_initiator",
    "current_profile_device_restart",
}
SUBMITTED_COMMAND_RECOVERY_REQUIRED_ASSERTIONS = {
    "source_build_runtime_identity",
    "current_profile_instance_isolation",
    "current_profile_group_initiator",
    "current_profile_device_restart",
    "native_runtime",
    "actor_isolation",
    "submitted_command_fixture_exact",
    "submitted_command_converged",
    "resources_released",
}


def is_current_profile_gate(gate_id: str) -> bool:
    return gate_id in CURRENT_PROFILE_GATE_IDS


def journey_for_gate(gate_id: str) -> str:
    if gate_id == STORAGE_ACCOUNTING_GATE_ID:
        return "storage-observability"
    if gate_id == STORAGE_BATCH_DESKTOP_GATE_ID:
        return "storage-batch-clear"
    if gate_id == STORAGE_REDACTION_RECOVERY_GATE_ID:
        return "storage-redaction-recovery"
    if gate_id == LIFECYCLE_ONBOARDING_GATE_ID:
        return "onboarding-first-message"
    if gate_id == LIFECYCLE_DIRECT_GATE_ID:
        return "daily-direct"
    if gate_id == LIFECYCLE_RICH_VOICE_GATE_ID:
        return "rich-media-recorded-voice"
    if gate_id == PRESENCE_LAYOUT_GATE_ID:
        return "presence-layout-stability"
    if gate_id == LIVE_VOICE_GATE_ID:
        return "chat-live-voice-lifecycle"
    if gate_id == SUBMITTED_COMMAND_RECOVERY_GATE_ID:
        return "submitted-command-recovery"
    return "direct-delivered-receipt"


def runtime_manifest(
    gate_id: str = GATE_ID,
) -> tuple[dict[str, Any], dict[str, Any]]:
    raw_path = os.environ.get("PT_ACCEPTANCE_RUNTIME_MANIFEST", "").strip()
    if not raw_path:
        raise GateError("PT_ACCEPTANCE_RUNTIME_MANIFEST is required")
    manifest = load_runtime_manifest(Path(raw_path), gate_id)
    actor_ref = manifest.get("actorManifest")
    if not isinstance(actor_ref, dict):
        raise GateError("runtime manifest actorManifest is required")
    store = EvidenceStore.from_environment(
        repo_root=REPO_ROOT,
        worktree=REPO_ROOT,
    )
    actors = store.read_json(ArtifactRef.from_dict(actor_ref))
    if actors.get("artifactKind") != "acceptance-actor-manifest":
        raise GateError("runtime actor manifest has invalid artifact kind")
    return manifest, actors


def read_station_version(station_url: str) -> dict[str, Any]:
    with urllib.request.urlopen(
        f"{station_url.rstrip('/')}/app-meta/version",
        timeout=10,
    ) as response:
        value = json.loads(response.read().decode("utf-8"))
    if not isinstance(value, dict):
        raise GateError("Station version response must be an object")
    return value


def wait_until(
    predicate: Callable[[], Any],
    description: str,
    timeout: float = STEP_TIMEOUT,
    interval: float = 0.25,
) -> Any:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            value = predicate()
            if value:
                return value
        except Exception as error:  # noqa: BLE001
            last_error = error
        time.sleep(interval)
    suffix = f"; last error: {last_error}" if last_error else ""
    raise GateError(f"timed out waiting for {description}{suffix}")


def avatar_evidence_is_valid(
    evidence: dict[str, dict[str, Any]],
    allowed_station_urls: set[str],
) -> bool:
    allowed_origins = {
        (parsed.scheme, parsed.netloc)
        for value in allowed_station_urls
        if (parsed := urlsplit(value))
        and parsed.scheme in {"http", "https"}
        and parsed.netloc
    }
    for identity_evidence in evidence.values():
        rendered = [
            snapshot
            for snapshot in identity_evidence.values()
            if isinstance(snapshot, dict)
        ]
        if not rendered:
            return False
        if any(
            not avatar_snapshot_is_valid(snapshot, allowed_origins)
            for snapshot in rendered
        ):
            return False
        if len({
            str(snapshot.get("declared") or "")
            for snapshot in rendered
        }) != 1:
            return False
    return True


def avatar_snapshot_is_valid(
    snapshot: dict[str, Any],
    allowed_origins: set[tuple[str, str]],
) -> bool:
    declared = str(snapshot.get("declared") or "")
    rendered = str(snapshot.get("rendered") or "")
    if snapshot.get("complete") is not True or int(
        snapshot.get("naturalWidth") or 0
    ) <= 0:
        return False
    if is_bundled_square_avatar(declared):
        return rendered == declared
    parsed = urlsplit(declared)
    return (
        (parsed.scheme, parsed.netloc) in allowed_origins
        and parsed.path == "/sub-oss/file"
        and rendered.startswith("asset://localhost/")
    )


def reconciled_command_snapshot_outcome(
    snapshot: dict[str, Any],
    command_id: str,
    message_id: str,
    command_sha256: str = "",
) -> str | None:
    projection = snapshot.get("projection")
    intent = snapshot.get("intent")
    outbox = snapshot.get("outbox")
    matching = [
        item
        for item in snapshot.get("commandLedger", [])
        if isinstance(item, dict)
        and item.get("commandId") == command_id
        and item.get("messageId") == message_id
    ]
    if (
        snapshot.get("messageId") != message_id
        or not isinstance(outbox, dict)
        or len(matching) != 1
        or (
            command_sha256
            and outbox.get("commandSha256") != command_sha256
        )
    ):
        return None
    original = matching[0]
    intent_matches = (
        intent is None
        or (
            isinstance(intent, dict)
            and intent.get("commandId") == command_id
        )
    )
    if (
        isinstance(projection, dict)
        and bool(projection.get("eventId"))
        and int(projection.get("eventSequence") or 0) > 0
        and projection.get("deliveryState")
        in {"sent", "delivered", "read", "consumed"}
        and intent_matches
        and (
            intent is None
            or intent.get("state") == "committed"
        )
        and outbox.get("state") == "committed"
        and original.get("attemptState") == "committed"
        and original.get("localState") == "committed"
        and original.get("outboxState") == "committed"
        and original.get("draftState") in {"", "accepted"}
    ):
        return "accepted"
    if (
        outbox.get("state") == "retry_wait"
        and outbox.get("lastErrorCode") == "canonical_not_found"
        and original.get("attemptState") == "retry_wait"
        and original.get("localState") == "submitted"
        and original.get("outboxState") == "retry_wait"
        and original.get("draftState") == "retry_wait"
    ):
        return "retrying"
    if (
        outbox.get("state") == "superseded"
        and outbox.get("lastErrorCode") == "stale_delivery_plan"
        and original.get("attemptState") == "superseded"
        and original.get("localState") == "superseded"
        and original.get("outboxState") == "superseded"
        and bool(original.get("draftState"))
    ):
        return "terminal_superseded"
    if (
        outbox.get("state") == "failed"
        and bool(outbox.get("lastErrorCode"))
        and original.get("attemptState") == "failed"
        and original.get("localState") == "failed"
        and original.get("outboxState") == "failed"
        and original.get("draftState") == "failed"
    ):
        return "terminal_failed"
    return None


def submitted_command_snapshot_is_exact(
    snapshot: dict[str, Any],
    command_id: str,
    message_id: str,
) -> bool:
    outbox = snapshot.get("outbox")
    matching = [
        item
        for item in snapshot.get("commandLedger", [])
        if isinstance(item, dict)
        and item.get("commandId") == command_id
        and item.get("messageId") == message_id
    ]
    return (
        snapshot.get("messageId") == message_id
        and snapshot.get("projection") is None
        and isinstance(outbox, dict)
        and bool(outbox.get("commandSha256"))
        and outbox.get("state") == "submitted"
        and outbox.get("lastErrorCode") == ""
        and len(matching) == 1
        and matching[0].get("attemptState") == "submitted"
        and matching[0].get("localState") == "submitted"
        and matching[0].get("outboxState") == "submitted"
        and matching[0].get("draftState") == "submitted"
    )


def send_text(client: TauriSession, text: str) -> dict[str, Any]:
    composer = client.find_element('[data-pt-text-input="chat-composer"]', 30)
    client.execute_script(
        """
        const element = arguments[0];
        const value = arguments[1];
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value',
        )?.set;
        if (!setter) throw new Error('textarea setter missing');
        setter.call(element, value);
        element.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          data: value,
          inputType: 'insertText',
        }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        """,
        composer,
        text,
    )
    client.find_element("[data-chat-send]", 10).click()
    return wait_until(
        lambda: message_snapshot(client, text),
        "sender optimistic message",
        interval=0.01,
    )


def message_snapshot(client: TauriSession, text: str) -> dict[str, Any] | None:
    value = client.execute_script(
        """
        const text = arguments[0];
        const row = Array.from(document.querySelectorAll('[data-message-ulid]'))
          .find((item) => (item.innerText || '').includes(text));
        if (!row) return null;
        return {
          messageUlid: row.getAttribute('data-message-ulid') || '',
          text: row.innerText || '',
          receipt: row.querySelector('[data-message-receipt]')
            ?.getAttribute('data-message-receipt') || '',
        };
        """,
        text,
    )
    return value if isinstance(value, dict) else None


def message_composer_geometry(
    client: TauriSession,
    message_id: str,
) -> dict[str, Any] | None:
    value = client.execute_script(
        """
        const messageId = arguments[0];
        const row = document.querySelector(
          `[data-message-ulid="${messageId}"]`
        );
        const composer = document.querySelector('[data-chat-composer]');
        const viewport = document.querySelector('.chat-message-scroll');
        const timeline = document.querySelector(
          '[data-chat-message-timeline]'
        );
        const sentinel = document.querySelector(
          '[data-chat-message-bottom-sentinel]'
        );
        const renderedRows = Array.from(
          document.querySelectorAll('[data-message-ulid]')
        );
        const rect = (element) => {
          const value = element?.getBoundingClientRect();
          return value ? {
            left: value.left,
            right: value.right,
            top: value.top,
            bottom: value.bottom,
            width: value.width,
            height: value.height,
          } : null;
        };
        return composer && viewport && timeline && sentinel ? {
          row: rect(row),
          composer: rect(composer),
          viewport: rect(viewport),
          timeline: rect(timeline),
          timelineFlexShrink: getComputedStyle(timeline).flexShrink,
          sentinel: rect(sentinel),
          renderedMessageIds: renderedRows.slice(-8).map(
            element => element.getAttribute('data-message-ulid') || ''
          ),
          scroll: {
            clientHeight: viewport.clientHeight,
            scrollHeight: viewport.scrollHeight,
            scrollTop: viewport.scrollTop,
          },
        } : null;
        """,
        message_id,
    )
    return value if isinstance(value, dict) else None


def is_bundled_square_avatar(source: str) -> bool:
    prefix = "data:image/svg+xml;base64,"
    if not source.startswith(prefix):
        return False
    try:
        root = ElementTree.fromstring(
            base64.b64decode(source[len(prefix):], validate=True),
        )
    except (ValueError, ElementTree.ParseError):
        return False
    rect = next(
        (
            child
            for child in root
            if child.tag.rsplit("}", maxsplit=1)[-1] == "rect"
        ),
        None,
    )
    return (
        rect is not None
        and rect.attrib.get("width") == "128"
        and rect.attrib.get("height") == "128"
        and "rx" not in rect.attrib
        and "ry" not in rect.attrib
    )


class NativeTwoClientGate(AcceptanceGate):
    gate_id = GATE_ID

    def __init__(
        self,
        *,
        manifest: dict[str, Any],
        actor_manifest: dict[str, Any],
        runtime_binding: NativeDesktopRuntimeBinding,
        gate_id: str = GATE_ID,
        allow_existing_fixture: bool = False,
        journey_id: str | None = None,
        station_identity_url: str | None = None,
        account_login_client: EphemeralGateClient | None = None,
    ) -> None:
        self.gate_id = gate_id
        super().__init__()
        self.allow_existing_fixture = allow_existing_fixture
        self.journey_id = journey_id or journey_for_gate(gate_id)
        self.manifest = manifest
        self.actor_manifest = actor_manifest
        self.runtime_binding = runtime_binding
        station = runtime_station_service(manifest, "alice")
        self.station_url = str(station.get("endpoint") or "").rstrip("/")
        if not self.station_url:
            raise GateError("runtime manifest Station URL is required")
        self.station_identity_url = str(
            station_identity_url or self.station_url
        ).rstrip("/")
        if not self.station_identity_url:
            raise GateError("Station identity URL is required")
        self.client_specs = {
            str(client.get("id")): client
            for client in manifest.get("clients", [])
            if isinstance(client, dict)
        }
        self.actor_specs = {
            str(actor.get("role")): actor
            for actor in actor_manifest.get("actors", [])
            if isinstance(actor, dict)
        }
        if set(self.client_specs) != {"alice", "bob"}:
            raise GateError(
                "runtime manifest must allocate isolated Alice and Bob clients"
            )
        if set(self.actor_specs) != {"alice", "bob"}:
            raise GateError(
                "actor manifest must contain canonical Alice and Bob identities"
            )
        self.account_login_client = account_login_client
        self.direction_order = (
            [CURRENT_PROFILE_INITIAL_SENDER, "alice"]
            if is_current_profile_gate(gate_id)
            else ["alice", "bob"]
        )
        self.steps: list[dict[str, Any]] = []
        self.clients: dict[str, TauriSession] = {}
        self.runtime_instances: list[TauriSession] = []
        self.runtime_instance_actors: dict[int, str] = {}
        self.client_lifecycles = NativeClientLifecycleLedger()
        self.ptids: dict[str, str] = {}
        self.device_ids: dict[str, str] = {}
        self.station_access: dict[str, dict[str, Any]] = {}
        self._reconciliation_target: dict[str, str] | None = None
        self.restart_messages: list[dict[str, str]] = []
        self.conversation_id = ""
        self.report.station_url = self.station_identity_url
        self.report.manifest = self.manifest
        self.report.runtime.update(
            {
                "runtimeCell": self.runtime_binding.cell_id,
                "journey": self.journey_id,
                "steps": self.steps,
                "stationAccess": self.station_access,
                "cleanup": {},
            }
        )

    def step(
        self,
        name: str,
        action: Callable[[], Any],
        client: str = "",
    ) -> Any:
        started = time.monotonic()
        try:
            value = action()
        except Exception as error:
            self.steps.append(
                {
                    "step": name,
                    "client": client,
                    "status": "fail",
                    "durationMs": int((time.monotonic() - started) * 1000),
                    "error": str(error),
                }
            )
            raise
        self.steps.append(
            {
                "step": name,
                "client": client,
                "status": "pass",
                "durationMs": int((time.monotonic() - started) * 1000),
            }
        )
        return value

    def verify_fixture_ready(self) -> bool:
        verify_runtime_fixture_ready(
            self.manifest,
            self.actor_manifest,
            allow_existing_fixture=self.allow_existing_fixture,
        )
        return True

    def source_identity(
        self,
        station_live: dict[str, Any],
    ) -> dict[str, Any]:
        identity = native_runtime_source_identity(
            gate_id=self.gate_id, manifest=self.manifest,
            runtime_binding=self.runtime_binding, station_live=station_live,
        )
        self.report.runtime.update(
            {
                "runtimeCellRunId": identity["runtimeCell"].get("runId"),
                "sourceIdentity": identity,
            }
        )
        self.assert_condition(
            "source_build_runtime_identity", True,
            json.dumps(identity, sort_keys=True),
        )
        return identity

    def configure_station_access(
        self,
        client: TauriSession,
        actor: str,
    ) -> dict[str, Any]:
        station = runtime_station_service(self.manifest, actor)
        station_url = str(station.get("endpoint") or "").rstrip("/")
        station_peer_id = str(station.get("runtimeIdentity") or "")
        if not station_url or not station_peer_id:
            raise GateError(f"{actor} Station binding identity is incomplete")
        binding = call_async_harness(
            client,
            "configureStation",
            {"stationUrl": station_url},
            namespace="stationAccess",
            script_timeout=30,
        )
        if (
            not isinstance(binding, dict)
            or binding.get("configured") is not True
            or binding.get("activeUrl") != station_url
            or binding.get("boundUrl") != station_url
            or binding.get("bindingPhase") != "access_gate"
            or binding.get("activeStationPeerId") != station_peer_id
        ):
            raise GateError(f"{actor} did not verify the configured Station")
        return binding

    def start_client(self, actor: str) -> None:
        client = self.runtime_binding.create_bound_session(
            actor,
            NativeLaunchOptions(
                window_slot=("alice", "bob").index(actor),
                window_count=2,
            ),
        )
        self.runtime_instances.append(client)
        self.runtime_instance_actors[id(client)] = actor
        expected_ptid = str(
            self.actor_specs[actor].get("ptid") or ""
        )
        self.client_lifecycles.register(client, expected_ptid)
        self.client_lifecycles.mark_live(client)
        self.register_driver(client)
        self.station_access[actor] = {
            "preAuthentication": self.configure_station_access(client, actor),
        }
        account_ref = str(
            self.actor_specs[actor].get("accountRef") or ""
        )
        account = account_ref.removeprefix("station-account:")
        if is_current_profile_gate(self.gate_id):
            if self.account_login_client is None:
                raise GateError("Current-profile accounts require their runtime login capability")
            from tooling.acceptance.provisioners.native_tauri_current_profile import LOGIN_CAPABILITY_ID

            login = self.account_login_client.invoke(
                LOGIN_CAPABILITY_ID, "authenticate",
                {"role": actor, "sessionId": client.driver.session_id},
                timeout_seconds=35,
            )
        else:
            login = async_harness(
                client, "loginWithPassword",
                {"account": account, "password": DEV_ACCOUNT_PASSWORD},
                timeout=30,
            )
        if not (login or {}).get("authenticated"):
            raise GateError(f"{actor} login did not authenticate")
        bound_station = call_async_harness(
            client,
            "bindingState",
            {},
            namespace="stationAccess",
            script_timeout=STATION_BINDING_PROJECTION_TIMEOUT,
        )
        if (
            not isinstance(bound_station, dict)
            or bound_station.get("phase") != "bound"
            or str(bound_station.get("activeUrl") or "").rstrip("/")
            != str(
                runtime_station_service(
                    self.manifest,
                    actor,
                ).get("endpoint")
                or ""
            ).rstrip("/")
        ):
            raise GateError(
                f"{actor} Station binding did not complete after access grant"
            )
        self.station_access[actor]["postAuthentication"] = bound_station
        self.client_lifecycles.mark_authenticated(client)
        hydration = async_harness(
            client,
            "hydrateActiveActor",
            {},
            timeout=30,
        )
        ptid = str((hydration or {}).get("actorPtid") or "")
        if ptid != expected_ptid:
            raise GateError(
                f"{actor} login identity mismatch: "
                f"expected={expected_ptid} actual={ptid}"
            )
        if not is_native_tauri_url(client.get_current_url()):
            raise GateError(
                f"{actor} is not running in native Tauri WebView: "
                f"{client.get_current_url()}"
            )
        self.clients[actor] = client
        self.ptids[actor] = ptid
        if set(self.clients) == set(CURRENT_PROFILE_ACTORS) and self.account_login_client is not None:
            self.account_login_client.close()

        def active_messaging_device() -> dict[str, Any] | None:
            current = async_harness(
                client,
                "getRealtimeDevice",
                {},
            )
            if not isinstance(current, dict) or current.get("active") is not True:
                return None
            return current

        device = wait_until(
            active_messaging_device,
            f"{actor} active messaging device enrollment",
            timeout=45,
        )
        device_id = str((device or {}).get("deviceId") or "")
        if not device_id:
            raise GateError(f"{actor}: messaging device ID is missing")
        self.device_ids[actor] = device_id
        self.report.add_actor(
            ActorRuntime(
                name=actor,
                runtime=self.runtime_binding.cell_id,
                port=client.port,
                gateway_port=client.gateway_port,
                profile=client.profile,
                storage_root=client.storage_root,
                pid=client.process_id,
            )
        )

    def restart_client(self, actor: str) -> TauriSession:
        predecessor = self.clients[actor]
        self.client_lifecycles.stop_preserving_session(predecessor)
        client = self.runtime_binding.create_bound_session(
            actor,
            NativeLaunchOptions(
                window_slot=("alice", "bob").index(actor),
                window_count=2,
            ),
        )
        self.runtime_instances.append(client)
        self.runtime_instance_actors[id(client)] = actor
        expected_ptid = self.ptids[actor]
        self.client_lifecycles.register(client, expected_ptid)
        self.client_lifecycles.transfer_preserved_session(
            predecessor,
            client,
        )
        self.client_lifecycles.mark_live(client)
        self.register_driver(client)
        station_url = str(
            runtime_station_service(
                self.manifest,
                actor,
            ).get("endpoint")
            or ""
        ).rstrip("/")
        bound_station = call_async_harness(
            client,
            "bindingState",
            {},
            namespace="stationAccess",
            script_timeout=STATION_BINDING_PROJECTION_TIMEOUT,
        )
        if (
            not isinstance(bound_station, dict)
            or bound_station.get("phase") != "bound"
            or str(bound_station.get("activeUrl") or "").rstrip("/")
            != station_url
        ):
            raise GateError(
                f"{actor} Station binding did not survive native restart"
            )
        device = wait_until(
            lambda: (
                current
                if (
                    isinstance(
                        current := async_harness(
                            client,
                            "getRealtimeDevice",
                            {},
                        ),
                        dict,
                    )
                    and current.get("active") is True
                    and current.get("actorPtid") == expected_ptid
                    and current.get("deviceId") == self.device_ids[actor]
                )
                else None
            ),
            f"{actor} preserved native session",
            timeout=60,
        )
        if not is_native_tauri_url(client.get_current_url()):
            raise GateError(f"{actor} restart did not use native Tauri")
        self.client_lifecycles.mark_authenticated(client)
        self.clients[actor] = client
        self.device_ids[actor] = str(device["deviceId"])
        self.station_access[actor]["postRestart"] = bound_station
        return client

    def prove_additional_journey_assertions(self) -> None:
        """Variant hook for assertions that must run before evidence cleanup."""

    def prove_current_profile_restart(self) -> None:
        before = self.report.runtime["instanceTopology"]
        state: dict[str, Any] = {}
        for actor in CURRENT_PROFILE_ACTORS:
            if self.clients[actor].process_id == before[actor]["processId"]:
                self.step(
                    "client.restart",
                    lambda actor=actor: self.restart_client(actor), actor,
                )
            self.step(
                "conversation.restore",
                lambda actor=actor: enter_chat_page(self.clients[actor]), actor,
            )
            async_harness(
                self.clients[actor], "syncFriendSession",
                {"sessionUlid": self.conversation_id},
            )
            visible = [
                wait_until(
                    lambda item=item: message_snapshot(self.clients[actor], item["plaintext"]),
                    f"{actor} message after native restart",
                )
                for item in self.restart_messages
            ]
            after = self.current_profile_instance_topology()[actor]
            self.assert_condition(
                f"{actor}_native_restart_preserves_state",
                after["processId"] != before[actor]["processId"]
                and after["deviceId"] == before[actor]["deviceId"]
                and after["actorPtid"] == before[actor]["actorPtid"]
                and after["storageRoot"] == before[actor]["storageRoot"]
                and after["binarySha256"] == before[actor]["binarySha256"]
                and all(
                    observed.get("messageUlid") == expected["messageId"]
                    and expected["plaintext"] in str(observed.get("text") or "")
                    for observed, expected in zip(visible, self.restart_messages)
                ),
                json.dumps({"before": before[actor], "after": after, "messages": visible}),
            )
            state[actor] = {"before": before[actor], "after": after, "messages": visible}
        self.report.runtime["deviceRestartState"] = state
        self.report.runtime["restartMessages"] = self.restart_messages
        self.assert_condition("current_profile_device_restart", bool(self.restart_messages))

    def current_profile_instance_topology(self) -> dict[str, Any]:
        topology: dict[str, Any] = {}
        source = self.manifest["source"]
        binary = self.runtime_binding.binary_identity()
        for actor in CURRENT_PROFILE_ACTORS:
            spec = self.client_specs[actor]
            root = Path(str(spec["worktree"])).resolve()
            if root != REPO_ROOT.resolve():
                raise GateError("Current-profile clients must use the selected source root")
            client = self.clients[actor]
            topology[actor] = {
                "clientId": spec["id"],
                "canonicalRoot": str(root),
                "workspaceId": workspace_id(root),
                "commit": source["commit"],
                "workspaceDigest": source["workspaceDigest"],
                "binarySha256": binary["sha256"],
                "processId": client.process_id,
                "actorPtid": self.ptids[actor],
                "deviceId": self.device_ids[actor],
                "profile": client.profile,
                "storageRoot": client.storage_root,
                "gatewayPort": client.gateway_port,
                "webdriverPort": client.port,
            }
        return topology

    def open_conversation(self) -> str:
        initiator_name, receiver_name = self.direction_order
        initiator = self.clients[initiator_name]
        receiver = self.clients[receiver_name]
        for client in (initiator, receiver):
            enter_chat_page(client)
        wait_for_peer_key_bundle(
            initiator,
            self.ptids[receiver_name],
            str(
                runtime_station_service(
                    self.manifest,
                    receiver_name,
                ).get("runtimeIdentity")
                or ""
            ),
        )
        wait_for_peer_key_bundle(
            receiver,
            self.ptids[initiator_name],
            str(
                runtime_station_service(
                    self.manifest,
                    initiator_name,
                ).get("runtimeIdentity")
                or ""
            ),
        )
        initiator_context = async_harness(
            initiator,
            "federationContext",
            {},
        )
        receiver_context = async_harness(
            receiver,
            "federationContext",
            {},
        )
        initiator_federations = [
            str(item.get("federationId") or "")
            for item in (initiator_context or {}).get("federations", [])
            if isinstance(item, dict) and item.get("federationId")
        ]
        receiver_federations = {
            str(item.get("federationId") or "")
            for item in (receiver_context or {}).get("federations", [])
            if isinstance(item, dict) and item.get("federationId")
        }
        federation_id = next(
            (
                candidate
                for candidate in initiator_federations
                if candidate in receiver_federations
            ),
            "",
        )
        if not federation_id:
            raise GateError(
                "Alice and Bob have no shared Federation for Direct Chat"
            )
        created = async_harness(
            initiator,
            "createDirectConversation",
            {
                "peerPtid": self.ptids[receiver_name],
                "federationId": federation_id,
            },
        )
        conversation_id = str((created or {}).get("conversationId") or "")
        if not conversation_id:
            raise GateError("Direct conversation creation returned no ID")
        for client in (initiator, receiver):
            async_harness(
                client,
                "syncFriendSession",
                {"sessionUlid": conversation_id},
            )
            WebDriverWait(client.driver, 30).until(
                lambda driver: driver.find_element(
                    By.CSS_SELECTOR,
                    '[data-pt-text-input="chat-composer"]',
                )
            )
        return conversation_id

    def prove_direction(
        self,
        sender_name: str,
        receiver_name: str,
    ) -> None:
        sender = self.clients[sender_name]
        receiver = self.clients[receiver_name]
        text = f"{sender_name}-to-{receiver_name}-{time.time_ns()}"
        sent = self.step(
            "message.submitted",
            lambda: send_text(sender, text),
            sender_name,
        )

        message_id = str(sent.get("messageUlid") or "")
        last_geometry: dict[str, Any] | None = None

        def unobscured_sender_row() -> dict[str, Any] | None:
            nonlocal last_geometry
            geometry = message_composer_geometry(sender, message_id)
            last_geometry = geometry
            if not geometry:
                return None
            row = geometry.get("row")
            composer = geometry.get("composer")
            viewport = geometry.get("viewport")
            sentinel = geometry.get("sentinel")
            if not all(
                isinstance(item, dict)
                for item in (row, composer, viewport, sentinel)
            ):
                return None
            return geometry if (
                geometry.get("timelineFlexShrink") == "0"
                and row["bottom"] <= composer["top"] - 8
                and row["bottom"] <= viewport["bottom"] - 8
                and sentinel["top"] >= row["bottom"] + 8
            ) else None

        try:
            geometry = self.step(
                "message.layout",
                lambda: wait_until(
                    unobscured_sender_row,
                    f"{sender_name} submitted message layout",
                    timeout=30,
                ),
                sender_name,
            )
        except GateError as error:
            current = message_snapshot(sender, text)
            raise GateError(
                f"{error}; sent={json.dumps(sent, sort_keys=True)}; "
                f"current={json.dumps(current, sort_keys=True)}; "
                f"geometry={json.dumps(last_geometry, sort_keys=True)}"
            ) from error
        self.assert_condition(
            f"{sender_name}_to_{receiver_name}_message_clear",
            bool(geometry),
            json.dumps(geometry, sort_keys=True),
        )

        received = self.step(
            "message.received",
            lambda: wait_until(
                lambda: message_snapshot(receiver, text),
                f"{receiver_name} exact plaintext",
            ),
            receiver_name,
        )
        self.assert_condition(
            f"{sender_name}_to_{receiver_name}_plaintext",
            text in str(received.get("text") or "")
            and bool(sent.get("messageUlid"))
            and received.get("messageUlid") == sent.get("messageUlid"),
            f"message_id={received.get('messageUlid', '')}",
        )
        if is_current_profile_gate(self.gate_id):
            self.restart_messages.append({
                "messageId": message_id, "plaintext": text,
            })
        self.step("message.decrypted", lambda: True, receiver_name)

        delivered = self.step(
            "receipt.delivered",
            lambda: wait_until(
                lambda: (
                    snapshot
                    if (snapshot := message_snapshot(sender, text))
                    and snapshot.get("receipt") in {"delivered", "read"}
                    else None
                ),
                f"{sender_name} delivered receipt",
            ),
            sender_name,
        )
        self.assert_condition(
            f"{sender_name}_to_{receiver_name}_delivered",
            delivered.get("receipt") in {"delivered", "read"},
            f"message_id={sent.get('messageUlid', '')}; receipt={delivered.get('receipt', '')}",
        )

    def sample_demo_avatar_sources(self) -> dict[str, Any]:
        evidence: dict[str, Any] = {}
        actors = tuple(self.clients)
        for identity in actors:
            identity_ptid = self.ptids[identity]
            identity_evidence: dict[str, Any] = {}
            for client_name, client in self.clients.items():
                snapshot = client.execute_script(
                    """
                    const actorPtid = arguments[0];
                    const candidates = Array.from(
                      document.querySelectorAll('[data-chat-avatar-ptid]')
                    ).filter((element) => (
                      element.getAttribute('data-chat-avatar-ptid')
                        === actorPtid
                    ));
                    const element = candidates.find((candidate) => {
                      const rect = candidate.getBoundingClientRect();
                      return rect.width > 0 && rect.height > 0;
                    });
                    const image = element?.querySelector('img');
                    return element ? {
                      declared:
                        element.getAttribute('data-chat-avatar-src') || '',
                      rendered: image?.getAttribute('src') || '',
                      complete: image?.complete === true,
                      naturalWidth: Number(image?.naturalWidth || 0),
                    } : null;
                    """,
                    identity_ptid,
                )
                identity_evidence[client_name] = snapshot
            evidence[identity] = identity_evidence
        return evidence

    def prove_demo_avatar_sources(self) -> dict[str, Any]:
        allowed_station_urls = {
            getattr(self, "station_identity_url", self.station_url)
        }

        def valid_evidence() -> dict[str, Any] | None:
            evidence = self.sample_demo_avatar_sources()
            return (
                evidence
                if avatar_evidence_is_valid(
                    evidence,
                    allowed_station_urls,
                )
                else None
            )

        evidence = wait_until(
            valid_evidence,
            "valid remote demo avatar sources",
            timeout=30.0,
        )
        valid = avatar_evidence_is_valid(evidence, allowed_station_urls)
        self.assert_condition(
            "demo_avatar_bundled",
            valid,
            json.dumps(evidence, sort_keys=True),
        )
        return evidence

    def expected_reconciliation_target(
        self,
    ) -> dict[str, str] | None:
        return (
            dict(self._reconciliation_target)
            if self._reconciliation_target is not None else None
        )

    def prepare_submitted_command_target(self, conversation_id: str) -> dict[str, Any]:
        actor = CURRENT_PROFILE_INITIAL_SENDER
        client = self.clients[actor]
        plaintext = f"submitted-command-recovery-{time.time_ns()}"
        pause_result = client.invoke_app_result(
            "messaging_acceptance_pause_lifecycle",
            {"input": {"expected_actor_ptid": self.ptids[actor]}},
        )
        paused = pause_result.get("data")
        if not isinstance(paused, dict) or paused.get("paused") is not True:
            raise GateError(
                "Submitted-command preparation did not pause dispatch: "
                + json.dumps(pause_result, sort_keys=True)
            )
        sent = self.step(
            "command.reconciliation.ui_send", lambda: send_text(client, plaintext), actor,
        )
        message_id = str(sent.get("messageUlid") or "")
        snapshot = async_harness(
            client, "engineInteractionSnapshot",
            {"actorPtid": self.ptids[actor], "conversationId": conversation_id,
             "messageId": message_id},
        )
        rows = [
            row for row in (snapshot or {}).get("commandLedger", [])
            if isinstance(row, dict) and row.get("messageId") == message_id
            and row.get("localState") == "prepared"
            and row.get("outboxState") == "pending"
            and row.get("attemptState") == "prepared"
        ]
        if not message_id or len(rows) != 1 or not rows[0].get("commandId"):
            raise GateError("UI send did not create one exact durable prepared command")
        command_id = str(rows[0]["commandId"])
        exact_prepared = async_harness(
            client, "engineInteractionSnapshot",
            {"actorPtid": self.ptids[actor], "conversationId": conversation_id,
             "messageId": message_id, "commandId": command_id},
        )
        prepared_outbox = (exact_prepared or {}).get("outbox")
        prepared_hash = (
            prepared_outbox.get("commandSha256")
            if isinstance(prepared_outbox, dict) else None
        )
        if not prepared_hash:
            raise GateError("UI-prepared command bytes are not available")
        target = {
            "actor": actor,
            "conversationId": conversation_id,
            "messageId": message_id,
            "commandId": command_id,
            "outcome": "accepted",
        }
        self._reconciliation_target = target
        self.report.runtime["createdSubmittedCommand"] = {
            **target,
            "plaintext": plaintext,
            "plaintextSha256": hashlib.sha256(plaintext.encode()).hexdigest(),
            "preparedSnapshot": exact_prepared,
        }
        prepared = async_harness(
            client, "prepareSubmittedCommand",
            {"actorPtid": self.ptids[actor], "conversationId": conversation_id,
             "messageId": message_id, "commandId": command_id},
        )
        initial = prepared.get("snapshot") if isinstance(prepared, dict) else None
        self.assert_condition(
            "submitted_command_fixture_exact",
            isinstance(initial, dict) and submitted_command_snapshot_is_exact(
                initial, command_id, message_id,
            ) and initial["outbox"].get("commandSha256") == prepared_hash,
            json.dumps(prepared, sort_keys=True),
        )
        return initial

    def prove_expected_command_reconciliation(
        self,
        initial: dict[str, Any],
    ) -> dict[str, Any] | None:
        target = self.expected_reconciliation_target()
        if target is None:
            return None
        conversation_id = target["conversationId"]
        actor = target["actor"]
        receiver = next(name for name in self.clients if name != actor)

        def read_sender_snapshot() -> dict[str, Any]:
            value = async_harness(
                self.clients[actor],
                "engineInteractionSnapshot",
                {
                    "actorPtid": self.ptids[actor],
                    "conversationId": conversation_id,
                    "messageId": target["messageId"],
                    "commandId": target["commandId"],
                },
            )
            if not isinstance(value, dict):
                raise GateError(
                    "historical command snapshot returned invalid evidence"
                )
            return value

        original_rows = [
            item
            for item in initial.get("commandLedger", [])
            if isinstance(item, dict)
            and item.get("commandId") == target["commandId"]
            and item.get("messageId") == target["messageId"]
        ]
        initial_outbox = initial.get("outbox")
        command_sha256 = str(
            initial_outbox.get("commandSha256")
            if isinstance(initial_outbox, dict)
            else ""
        )
        if len(original_rows) != 1 or not command_sha256:
            raise GateError(
                "Exact run-created command is absent from the bound Device Engine store"
            )

        observed_retry = (
            reconciled_command_snapshot_outcome(
                initial,
                target["commandId"],
                target["messageId"],
                command_sha256,
            )
            == "retrying"
        )

        def final_snapshot() -> dict[str, Any] | None:
            nonlocal observed_retry
            value = read_sender_snapshot()
            outcome = reconciled_command_snapshot_outcome(
                value,
                target["commandId"],
                target["messageId"],
                command_sha256,
            )
            observed_retry = observed_retry or outcome == "retrying"
            return value if outcome == target["outcome"] else None

        snapshot = wait_until(
            final_snapshot,
            "historical submitted command convergence",
        )
        final_outcome = reconciled_command_snapshot_outcome(
            snapshot,
            target["commandId"],
            target["messageId"],
            command_sha256,
        )
        later_attempts = [
            item
            for item in snapshot.get("commandLedger", [])
            if isinstance(item, dict)
            and item.get("messageId") == target["messageId"]
            and item.get("commandId") != target["commandId"]
        ]
        later_committed = [
            item
            for item in later_attempts
            if item.get("attemptState") == "committed"
            and item.get("localState") == "committed"
            and item.get("outboxState") == "committed"
        ]

        def read_receiver_message() -> dict[str, Any] | None:
            value = async_harness(
                self.clients[receiver],
                "engineMessages",
                {
                    "actorPtid": self.ptids[receiver],
                    "conversationId": conversation_id,
                },
            )
            messages = (
                value.get("messages")
                if isinstance(value, dict)
                else None
            )
            if not isinstance(messages, list):
                return None
            return next(
                (
                    message
                    for message in messages
                    if isinstance(message, dict)
                    and message.get("messageId") == target["messageId"]
                ),
                None,
            )

        if final_outcome == "accepted" or later_committed:
            received = wait_until(
                read_receiver_message,
                "historical submitted message on peer",
            )
        else:
            received = read_receiver_message()
        plaintext = str(self.report.runtime["createdSubmittedCommand"]["plaintext"])
        visible = self.step(
            "command.reconciliation.receiver_visible",
            lambda: wait_until(
                lambda: message_snapshot(self.clients[receiver], plaintext),
                "exact recovered plaintext on the receiver",
            ),
            receiver,
        )
        receiver_matches_outcome = (
            received is not None
            if final_outcome == "accepted" or later_committed
            else received is None
        )
        evidence = {
            "target": {
                **target,
                "commandSha256": command_sha256,
            },
            "initialSenderSnapshot": initial,
            "senderSnapshot": snapshot,
            "receiverMessage": received,
            "receiverVisible": visible,
            "outcome": final_outcome,
            "observedCanonicalNotFoundRetry": observed_retry,
            "laterAttempts": later_attempts,
        }
        self.assert_condition(
            "submitted_command_converged",
            final_outcome == target["outcome"]
            and receiver_matches_outcome
            and visible.get("messageUlid") == target["messageId"]
            and plaintext in str(visible.get("text") or "")
            and (
                received is None
                or received.get("messageId") == target["messageId"]
            ),
            json.dumps(evidence, sort_keys=True),
        )
        self.report.runtime["submittedCommandReconciliation"] = evidence
        return evidence

    def collect_client_evidence(self, actor: str) -> None:
        client = self.clients[actor]
        self.save_screenshot(client, actor)
        self.save_dom(client, actor)

    def cleanup_clients(self) -> dict[str, Any]:
        cleanup_errors = self.client_lifecycles.release_all()

        exported_client_ids: set[int] = set()
        for actor, client in self.clients.items():
            exported_client_ids.add(id(client))
            if not self.save_app_log(client, actor):
                cleanup_errors.append(
                    {
                        "resource": f"log:{client.profile}",
                        "error": "Native client log was not exported",
                    }
                )
        instance_actors = getattr(self, "runtime_instance_actors", {})
        for index, client in enumerate(self.runtime_instances, start=1):
            if id(client) in exported_client_ids:
                continue
            actor = instance_actors.get(id(client), "unbound")
            evidence_name = f"{actor}-runtime-{index}"
            if not self.save_app_log(client, evidence_name):
                cleanup_errors.append(
                    {
                        "resource": f"log:{client.profile}",
                        "error": "Native runtime instance log was not exported",
                    }
                )

        try:
            cleanup = self.runtime_binding.finalize_cleanup(
                self.runtime_instances,
                self.client_specs,
            )
        except Exception as error:
            cleanup = {
                "portsReleased": False,
                "processesReleased": False,
                "storageReleased": False,
                "logsReleased": False,
                "cleanupErrors": [
                    {
                        "resource": "runtime-binding",
                        "error": str(error),
                    }
                ],
            }
        binding_errors = cleanup.get("cleanupErrors")
        if isinstance(binding_errors, list):
            cleanup_errors.extend(
                error
                for error in binding_errors
                if isinstance(error, dict)
            )
        cleanup["cleanupErrors"] = cleanup_errors
        cleanup_passed = (
            bool(cleanup.get("portsReleased"))
            and bool(cleanup.get("processesReleased"))
            and bool(cleanup.get("storageReleased"))
            and bool(cleanup.get("logsReleased"))
            and not cleanup_errors
        )
        self.report.add_assertion(
            "resources_released",
            cleanup_passed,
            json.dumps(cleanup, sort_keys=True),
        )
        return cleanup

    def run(self) -> dict[str, Any]:
        order = list(self.direction_order)
        if not is_current_profile_gate(self.gate_id):
            random.SystemRandom().shuffle(order)
        cleanup: dict[str, Any] = {}
        source_identity: dict[str, Any] = {}
        conversation_id = ""
        try:
            version = self.step(
                "station.identity",
                lambda: read_station_version(self.station_identity_url),
            )
            self.step(
                (
                    "fixture.existing"
                    if self.allow_existing_fixture
                    else "fixture.reset"
                ),
                self.verify_fixture_ready,
            )
            for actor in order:
                self.step(
                    "client.authenticated",
                    lambda actor=actor: self.start_client(actor),
                    actor,
                )
            source_identity = self.step(
                "runtime.source_identity",
                lambda: self.source_identity(version),
            )
            self.report.runtime.update(
                {
                    "runtimeCellRunId": source_identity[
                        "runtimeCell"
                    ]["runId"],
                    "sourceIdentity": source_identity,
                    "launchOrder": order,
                    "directionOrder": list(self.direction_order),
                }
            )
            if is_current_profile_gate(self.gate_id):
                topology = self.step(
                    "runtime.instance_isolation",
                    self.current_profile_instance_topology,
                )
                self.report.runtime["instanceTopology"] = topology
                self.assert_condition(
                    "current_profile_instance_isolation",
                    all(
                        len({item[field] for item in topology.values()}) == 2
                        for field in (
                            "processId", "actorPtid", "deviceId", "profile",
                            "storageRoot", "gatewayPort", "webdriverPort",
                        )
                    ) and all(
                        len({item[field] for item in topology.values()}) == 1
                        for field in (
                            "canonicalRoot", "workspaceId", "commit",
                            "workspaceDigest", "binarySha256",
                        )
                    ),
                    json.dumps(topology, sort_keys=True),
                )
                self.assert_condition(
                    "current_profile_group_initiator",
                    order == self.direction_order == ["bob", "alice"],
                    json.dumps({"directionOrder": self.direction_order}),
                )
            self.assert_condition(
                "native_runtime",
                all(
                    is_native_tauri_url(client.get_current_url())
                    for client in self.clients.values()
                ),
            )
            self.assert_condition(
                "actor_isolation",
                len(set(self.ptids.values())) == 2
                and len(set(self.device_ids.values())) == 2
                and len({client.port for client in self.clients.values()}) == 2
                and len({client.gateway_port for client in self.clients.values()}) == 2
                and len({client.storage_root for client in self.clients.values()}) == 2,
            )
            conversation_id = self.step("conversation.open", self.open_conversation)
            self.conversation_id = conversation_id
            if self.gate_id == SUBMITTED_COMMAND_RECOVERY_GATE_ID:
                initial = self.step(
                    "command.reconciliation.fixture",
                    lambda: self.prepare_submitted_command_target(conversation_id),
                    CURRENT_PROFILE_INITIAL_SENDER,
                )
                target = self.expected_reconciliation_target()
                self.step(
                    "command.reconciliation.restart",
                    lambda: self.restart_client(target["actor"]),
                    target["actor"],
                )
                self.step(
                    "command.reconciliation",
                    lambda: self.prove_expected_command_reconciliation(initial),
                    target["actor"],
                )
                self.restart_messages.append({
                    "messageId": target["messageId"],
                    "plaintext": self.report.runtime["createdSubmittedCommand"]["plaintext"],
                })
            else:
                self.step(
                    "avatar.bundled",
                    self.prove_demo_avatar_sources,
                )
                self.prove_direction(*self.direction_order)
                self.prove_direction(*reversed(self.direction_order))
                self.prove_additional_journey_assertions()
            if is_current_profile_gate(self.gate_id):
                for actor in CURRENT_PROFILE_ACTORS:
                    async_harness(
                        self.clients[actor], "syncFriendSession",
                        {"sessionUlid": conversation_id},
                    )
                self.prove_current_profile_restart()
            for actor in ("alice", "bob"):
                self.collect_client_evidence(actor)
        finally:
            cleanup = self.cleanup_clients()
            self.report.runtime["steps"] = self.steps
            self.report.runtime["cleanup"] = cleanup

        cleanup_passed = (
            bool(cleanup.get("portsReleased"))
            and bool(cleanup.get("processesReleased"))
            and bool(cleanup.get("storageReleased"))
            and bool(cleanup.get("logsReleased"))
            and not cleanup.get("cleanupErrors")
        )
        if not cleanup_passed:
            raise GateError(
                "Native two-client cleanup failed: "
                f"{json.dumps(cleanup, sort_keys=True)}"
            )

        assertion_names = {assertion.name for assertion in self.report.assertions}
        required_assertions = (
            SUBMITTED_COMMAND_RECOVERY_REQUIRED_ASSERTIONS
            if self.gate_id == SUBMITTED_COMMAND_RECOVERY_GATE_ID
            else REQUIRED_ASSERTIONS
        )
        missing = required_assertions - assertion_names
        if missing:
            raise GateError(f"required assertions are missing: {sorted(missing)}")
        return {
            "runtimeCell": self.runtime_binding.cell_id,
            "runtimeCellRunId": source_identity["runtimeCell"]["runId"],
            "journey": self.journey_id,
            "conversationId": conversation_id,
            "sourceIdentity": source_identity,
            "launchOrder": order,
            "directionOrder": list(self.direction_order),
            "instanceTopology": self.report.runtime.get(
                "instanceTopology",
                {},
            ),
            "steps": self.steps,
            "cleanup": cleanup,
            "clients": {
                actor: {
                    "ptid": self.ptids[actor],
                    "deviceId": self.device_ids[actor],
                    "webdriverPort": self.clients[actor].port,
                    "gatewayPort": self.clients[actor].gateway_port,
                    "profile": self.clients[actor].profile,
                    "storageRoot": self.clients[actor].storage_root,
                }
                for actor in ("alice", "bob")
            },
        }
