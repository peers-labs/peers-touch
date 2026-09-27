#!/usr/bin/env python3
"""Prove Direct delivery and receipts through two native Tauri clients."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import random
import re
import subprocess
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
    runtime_station_service,
    wait_for_peer_key_bundle,
)


GATE_ID = "chat-native-two-client-e2e"
CURRENT_PROFILE_GATE_ID = "chat-native-current-profile-two-client-e2e"
LIFECYCLE_ONBOARDING_GATE_ID = "chat-lifecycle-onboarding-e2e"
LIFECYCLE_DIRECT_GATE_ID = "chat-lifecycle-direct-e2e"
SUBMITTED_COMMAND_RECOVERY_GATE_ID = (
    "chat-native-submitted-command-recovery-e2e"
)
STORAGE_ACCOUNTING_GATE_ID = "chat-storage-accounting-e2e"
STORAGE_BATCH_DESKTOP_GATE_ID = "chat-storage-desktop-batch-clear-e2e"
STORAGE_REDACTION_RECOVERY_GATE_ID = "chat-storage-redaction-recovery-e2e"
CURRENT_PROFILE_GATE_IDS = frozenset(
    {
        CURRENT_PROFILE_GATE_ID,
        LIFECYCLE_ONBOARDING_GATE_ID,
        LIFECYCLE_DIRECT_GATE_ID,
        SUBMITTED_COMMAND_RECOVERY_GATE_ID,
    }
)
CURRENT_PROFILE_ACTOR_WORKTREES = {
    "alice": "peers-chat-high-chat",
    "bob": "peers-group-chat",
}
CURRENT_PROFILE_INITIAL_SENDER = "bob"
EXPECTED_RECONCILIATION_ACTOR_ENV = (
    "PT_CHAT_NATIVE_EXPECTED_RECONCILIATION_ACTOR"
)
EXPECTED_RECONCILIATION_CONVERSATION_ENV = (
    "PT_CHAT_NATIVE_EXPECTED_RECONCILIATION_CONVERSATION_ID"
)
EXPECTED_RECONCILIATION_MESSAGE_ENV = (
    "PT_CHAT_NATIVE_EXPECTED_RECONCILIATION_MESSAGE_ID"
)
EXPECTED_RECONCILIATION_COMMAND_ENV = (
    "PT_CHAT_NATIVE_EXPECTED_RECONCILIATION_COMMAND_ID"
)
EXPECTED_RECONCILIATION_OUTCOME_ENV = (
    "PT_CHAT_NATIVE_EXPECTED_RECONCILIATION_OUTCOME"
)
PREPARE_SUBMITTED_COMMAND_ENV = "PT_CHAT_NATIVE_PREPARE_SUBMITTED_COMMAND"
CREATE_RESTORABLE_COMMAND_ENV = (
    "PT_CHAT_NATIVE_CREATE_RESTORABLE_COMMAND"
)
RESTORABLE_COMMAND_PLAINTEXT_ENV = (
    "PT_CHAT_NATIVE_RESTORABLE_COMMAND_PLAINTEXT"
)
RECONCILIATION_OUTCOMES = {
    "accepted",
    "terminal_failed",
    "terminal_superseded",
}
STEP_TIMEOUT = float(os.environ.get("CHAT_NATIVE_STEP_TIMEOUT_SECONDS", "120"))
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
    "current_profile_cross_worktree",
    "current_profile_group_chat_initiator",
    "current_profile_persistent_device_state",
}
SUBMITTED_COMMAND_RECOVERY_REQUIRED_ASSERTIONS = {
    "source_build_runtime_identity",
    "current_profile_cross_worktree",
    "current_profile_group_chat_initiator",
    "current_profile_persistent_device_state",
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
        return row && composer && viewport && timeline && sentinel ? {
          row: rect(row),
          composer: rect(composer),
          viewport: rect(viewport),
          timeline: rect(timeline),
          timelineFlexShrink: getComputedStyle(timeline).flexShrink,
          sentinel: rect(sentinel),
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
    ) -> None:
        self.gate_id = gate_id
        super().__init__()
        self.allow_existing_fixture = allow_existing_fixture
        self.manifest = manifest
        self.actor_manifest = actor_manifest
        self.runtime_binding = runtime_binding
        station = runtime_station_service(manifest, "alice")
        self.station_url = str(station.get("endpoint") or "").rstrip("/")
        if not self.station_url:
            raise GateError("runtime manifest Station URL is required")
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
        self.direction_order = (
            [CURRENT_PROFILE_INITIAL_SENDER, "alice"]
            if is_current_profile_gate(gate_id)
            else ["alice", "bob"]
        )
        self.steps: list[dict[str, Any]] = []
        self.clients: dict[str, TauriSession] = {}
        self.runtime_instances: list[TauriSession] = []
        self.client_lifecycles = NativeClientLifecycleLedger()
        self.ptids: dict[str, str] = {}
        self.device_ids: dict[str, str] = {}
        self.station_access: dict[str, dict[str, Any]] = {}
        self._reconciliation_target: dict[str, str] | None = None
        self.report.station_url = self.station_url
        self.report.manifest = self.manifest
        self.report.runtime.update(
            {
                "runtimeCell": self.runtime_binding.cell_id,
                "journey": journey_for_gate(self.gate_id),
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
        reset = self.actor_manifest.get("reset")
        fixture_ready = (
            self.manifest.get("state") == "FIXTURE_READY"
            and isinstance(reset, dict)
            and reset.get("targetVerified") is True
        )
        if self.allow_existing_fixture:
            fixture_ready = (
                fixture_ready
                and self.actor_manifest.get("initialState") == "existing"
                and reset.get("authorized") is False
            )
        else:
            fixture_ready = fixture_ready and reset.get("authorized") is True
        if not fixture_ready:
            raise GateError(
                "runtime manifest fixture is not ready for the selected mode"
            )
        return True

    def source_identity(
        self,
        station_live: dict[str, Any],
    ) -> dict[str, Any]:
        source = self.manifest.get("source")
        station = runtime_station_service(self.manifest, "alice")
        runtime_cell = self.runtime_binding.runtime_identity()
        binary = self.runtime_binding.binary_identity()
        identity = {
            "orchestrator": source,
            "station": station,
            "stationLive": station_live,
            "runtimeCell": runtime_cell,
            "binary": binary,
        }
        self.report.runtime.update(
            {
                "runtimeCellRunId": runtime_cell.get("runId"),
                "sourceIdentity": identity,
            }
        )
        source_commit = str(
            source.get("commit") if isinstance(source, dict) else ""
        )
        station_commit = str(
            station.get("liveCommit")
            if isinstance(station, dict)
            else ""
        )
        cell_source = (
            runtime_cell.get("source")
            if isinstance(runtime_cell, dict)
            else None
        )
        binary_sha256 = str(binary.get("sha256") or "")
        remote_source_valid = (
            self.runtime_binding.cell_id != "desktop-linux-native"
            or (
                isinstance(cell_source, dict)
                and cell_source.get("remoteCheckoutClean") is True
                and re.fullmatch(
                    r"[0-9a-f]{64}",
                    str(cell_source.get("remoteSourceDigest") or ""),
                )
                is not None
            )
        )
        self.assert_condition(
            "source_build_runtime_identity",
            isinstance(source, dict)
            and bool(source_commit)
            and source.get("workspaceDigest") == "clean"
            and isinstance(station, dict)
            and station.get("workspaceDigest") == "clean"
            and station_commit == source_commit
            and re.fullmatch(
                r"[0-9a-f]{64}",
                str(station.get("protocolDigest") or ""),
            )
            is not None
            and commits_match(
                str(station_live.get("build_commit") or ""),
                source_commit,
            )
            and isinstance(runtime_cell, dict)
            and runtime_cell.get("cellId")
            == self.runtime_binding.cell_id
            and runtime_cell.get("gateId") == self.gate_id
            and bool(runtime_cell.get("runId"))
            and runtime_cell.get("state") == "LEASED"
            and isinstance(cell_source, dict)
            and cell_source.get("commit") == source_commit
            and cell_source.get("workspaceDigest") == "clean"
            and remote_source_valid
            and binary.get("sourceCommit") == source_commit
            and re.fullmatch(r"[0-9a-f]{64}", binary_sha256) is not None
            and cell_source.get("binarySha256") == binary_sha256,
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
        login = async_harness(
            client,
            "loginWithPassword",
            {
                "account": account,
                "password": DEV_ACCOUNT_PASSWORD,
            },
            timeout=30,
        )
        if not (login or {}).get("authenticated"):
            raise GateError(f"{actor} login did not authenticate")
        bound_station = call_async_harness(
            client,
            "bindingState",
            {},
            namespace="stationAccess",
            script_timeout=10,
        )
        if (
            not isinstance(bound_station, dict)
            or bound_station.get("phase") != "bound"
            or str(bound_station.get("bound_url") or "").rstrip("/")
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
            script_timeout=10,
        )
        if (
            not isinstance(bound_station, dict)
            or bound_station.get("phase") != "bound"
            or str(bound_station.get("bound_url") or "").rstrip("/")
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

    def current_profile_worktree_topology(self) -> dict[str, Any]:
        topology: dict[str, Any] = {}
        for actor, expected_name in CURRENT_PROFILE_ACTOR_WORKTREES.items():
            raw_root = str(self.client_specs[actor].get("worktree") or "")
            root = Path(raw_root).expanduser().resolve()
            completed = subprocess.run(
                (
                    "git",
                    "-C",
                    str(root),
                    "status",
                    "--porcelain",
                    "--untracked-files=all",
                ),
                capture_output=True,
                text=True,
                check=False,
            )
            if completed.returncode != 0:
                raise GateError(
                    f"cannot inspect current-profile worktree for {actor}"
                )

            def git_value(*args: str) -> str:
                result = subprocess.run(
                    ("git", "-C", str(root), *args),
                    capture_output=True,
                    text=True,
                    check=False,
                )
                value = result.stdout.strip()
                if result.returncode != 0 or not value:
                    raise GateError(
                        "cannot resolve current-profile worktree identity "
                        f"for {actor}"
                    )
                return value

            canonical_root = Path(
                git_value("rev-parse", "--show-toplevel")
            ).resolve()
            common_dir = Path(
                git_value(
                    "rev-parse",
                    "--path-format=absolute",
                    "--git-common-dir",
                )
            ).resolve()
            topology[actor] = {
                "clientId": str(self.client_specs[actor].get("id") or ""),
                "logicalName": root.name,
                "expectedLogicalName": expected_name,
                "workspaceId": workspace_id(root),
                "repositoryId": workspace_id(common_dir),
                "canonicalRoot": str(canonical_root),
                "head": git_value("rev-parse", "HEAD"),
                "tree": git_value("rev-parse", "HEAD^{tree}"),
                "clean": not completed.stdout.strip(),
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
        peer_created = async_harness(
            receiver,
            "createDirectConversation",
            {
                "peerPtid": self.ptids[initiator_name],
                "federationId": federation_id,
            },
        )
        peer_conversation_id = str(
            (peer_created or {}).get("conversationId") or ""
        )
        if peer_conversation_id != conversation_id:
            raise GateError(
                "Direct conversation identity diverged across actors: "
                f"{initiator_name}={conversation_id} "
                f"{receiver_name}={peer_conversation_id}"
            )
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

        def unobscured_sender_row() -> dict[str, Any] | None:
            geometry = message_composer_geometry(sender, message_id)
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

        geometry = self.step(
            "message.layout",
            unobscured_sender_row,
            sender_name,
        )
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

    def prove_demo_avatar_sources(self) -> dict[str, Any]:
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

        valid = avatar_evidence_is_valid(evidence, {self.station_url})
        self.assert_condition(
            "demo_avatar_bundled",
            valid,
            json.dumps(evidence, sort_keys=True),
        )
        return evidence

    def expected_reconciliation_target(
        self,
    ) -> dict[str, str] | None:
        if self._reconciliation_target is not None:
            return dict(self._reconciliation_target)
        target = {
            "actor": os.environ.get(
                EXPECTED_RECONCILIATION_ACTOR_ENV,
                "",
            ).strip(),
            "conversationId": os.environ.get(
                EXPECTED_RECONCILIATION_CONVERSATION_ENV,
                "",
            ).strip(),
            "messageId": os.environ.get(
                EXPECTED_RECONCILIATION_MESSAGE_ENV,
                "",
            ).strip(),
            "commandId": os.environ.get(
                EXPECTED_RECONCILIATION_COMMAND_ENV,
                "",
            ).strip(),
            "outcome": os.environ.get(
                EXPECTED_RECONCILIATION_OUTCOME_ENV,
                "",
            ).strip(),
        }
        if not any(target.values()):
            return None
        if os.environ.get(CREATE_RESTORABLE_COMMAND_ENV, "").strip() == "1":
            if (
                not target["actor"]
                or not target["conversationId"]
                or target["messageId"]
                or target["commandId"]
                or target["actor"] not in self.clients
                or target["outcome"] != "accepted"
            ):
                raise GateError(
                    "fresh submitted-command setup requires an actor, "
                    "conversation, accepted outcome, and no preselected "
                    "message or command identity"
                )
            return None
        if (
            not all(target.values())
            or target["actor"] not in self.clients
            or target["outcome"] not in RECONCILIATION_OUTCOMES
        ):
            raise GateError(
                "expected submitted-command reconciliation requires a "
                "complete actor/conversation/message/command identity and "
                "an accepted, terminal_failed, or terminal_superseded outcome"
            )
        return target

    def create_restorable_command_target(self) -> dict[str, str] | None:
        if os.environ.get(CREATE_RESTORABLE_COMMAND_ENV, "").strip() != "1":
            return None
        actor = os.environ.get(
            EXPECTED_RECONCILIATION_ACTOR_ENV,
            "",
        ).strip()
        conversation_id = os.environ.get(
            EXPECTED_RECONCILIATION_CONVERSATION_ENV,
            "",
        ).strip()
        outcome = os.environ.get(
            EXPECTED_RECONCILIATION_OUTCOME_ENV,
            "",
        ).strip()
        if (
            actor not in self.clients
            or not conversation_id
            or outcome != "accepted"
            or os.environ.get(
                EXPECTED_RECONCILIATION_MESSAGE_ENV,
                "",
            ).strip()
            or os.environ.get(
                EXPECTED_RECONCILIATION_COMMAND_ENV,
                "",
            ).strip()
        ):
            raise GateError(
                "fresh submitted-command setup requires an actor, "
                "conversation, accepted outcome, and no preselected "
                "message or command identity"
            )
        plaintext = os.environ.get(
            RESTORABLE_COMMAND_PLAINTEXT_ENV,
            "W8A exact submitted-command recovery",
        )
        if not plaintext:
            raise GateError("fresh submitted-command plaintext is required")
        created = self.step(
            "command.reconciliation.seed",
            lambda: async_harness(
                self.clients[actor],
                "createRestorableCommand",
                {
                    "actorPtid": self.ptids[actor],
                    "conversationId": conversation_id,
                    "plaintext": plaintext,
                },
            ),
            actor,
        )
        if not isinstance(created, dict):
            raise GateError(
                "fresh submitted-command setup returned invalid evidence"
            )
        message_id = str(created.get("messageId") or "")
        command_id = str(created.get("commandId") or "")
        if not message_id or not command_id:
            raise GateError(
                "fresh submitted-command setup omitted its exact identity"
            )
        target = {
            "actor": actor,
            "conversationId": conversation_id,
            "messageId": message_id,
            "commandId": command_id,
            "outcome": outcome,
        }
        self._reconciliation_target = target
        self.report.runtime["createdSubmittedCommand"] = {
            **target,
            "plaintextSha256": hashlib.sha256(
                plaintext.encode("utf-8")
            ).hexdigest(),
        }
        return dict(target)

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
                "expected historical command is absent from the bound "
                "retained Device Engine store"
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
            "outcome": final_outcome,
            "observedCanonicalNotFoundRetry": observed_retry,
            "laterAttempts": later_attempts,
        }
        self.assert_condition(
            "submitted_command_converged",
            final_outcome == target["outcome"]
            and receiver_matches_outcome
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

        for actor, client in self.clients.items():
            if not self.save_app_log(client, actor):
                cleanup_errors.append(
                    {
                        "resource": f"log:{client.profile}",
                        "error": "Native client log was not exported",
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
        if (
            not self.allow_existing_fixture
            and os.environ.get("CHAT_ACCEPTANCE_RESET") != "1"
        ):
            raise GateError("CHAT_ACCEPTANCE_RESET=1 is required")
        if (
            self.gate_id == SUBMITTED_COMMAND_RECOVERY_GATE_ID
            and os.environ.get(PREPARE_SUBMITTED_COMMAND_ENV, "").strip() != "1"
        ):
            raise GateError(
                f"{PREPARE_SUBMITTED_COMMAND_ENV}=1 is required for the "
                "isolated exact-command recovery fixture"
            )

        order = list(self.direction_order)
        if not is_current_profile_gate(self.gate_id):
            random.SystemRandom().shuffle(order)
        cleanup: dict[str, Any] = {}
        source_identity: dict[str, Any] = {}
        conversation_id = ""
        try:
            version = self.step(
                "station.identity",
                lambda: read_station_version(self.station_url),
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
                    "runtime.cross_worktree",
                    self.current_profile_worktree_topology,
                )
                self.report.runtime["worktreeTopology"] = topology
                source = self.manifest.get("source")
                source_commit = str(
                    source.get("commit")
                    if isinstance(source, dict)
                    else ""
                )
                self.assert_condition(
                    "current_profile_cross_worktree",
                    {
                        topology[actor]["logicalName"]
                        for actor in ("alice", "bob")
                    }
                    == set(CURRENT_PROFILE_ACTOR_WORKTREES.values())
                    and all(
                        topology[actor]["logicalName"]
                        == CURRENT_PROFILE_ACTOR_WORKTREES[actor]
                        and topology[actor]["canonicalRoot"]
                        == str(
                            Path(
                                self.client_specs[actor]["worktree"]
                            ).resolve()
                        )
                        and topology[actor]["clean"] is True
                        for actor in ("alice", "bob")
                    )
                    and len(
                        {
                            topology[actor]["workspaceId"]
                            for actor in ("alice", "bob")
                        }
                    )
                    == 2
                    and len(
                        {
                            topology[actor]["repositoryId"]
                            for actor in ("alice", "bob")
                        }
                    )
                    == 1
                    and topology["alice"]["tree"] == topology["bob"]["tree"]
                    and topology["bob"]["head"] == source_commit,
                    json.dumps(topology, sort_keys=True),
                )
                self.assert_condition(
                    "current_profile_group_chat_initiator",
                    self.direction_order[0] == CURRENT_PROFILE_INITIAL_SENDER
                    and topology[self.direction_order[0]]["logicalName"]
                    == "peers-group-chat",
                    json.dumps(
                        {
                            "directionOrder": self.direction_order,
                            "topology": topology,
                        },
                        sort_keys=True,
                    ),
                )
                persistent_storage = {
                    actor: {
                        "storageRoot": str(
                            self.client_specs[actor].get("storage_root") or ""
                        ),
                        "storageLifecycle": str(
                            self.client_specs[actor].get(
                                "storage_lifecycle",
                                "",
                            )
                        ),
                    }
                    for actor in ("alice", "bob")
                }
                persistent_roots = [
                    Path(item["storageRoot"])
                    for item in persistent_storage.values()
                ]
                self.assert_condition(
                    "current_profile_persistent_device_state",
                    len(set(persistent_roots)) == 2
                    and all(
                        item["storageLifecycle"] == "persistent"
                        and root.is_dir()
                        and not root.is_symlink()
                        for item, root in zip(
                            persistent_storage.values(),
                            persistent_roots,
                        )
                    ),
                    json.dumps(persistent_storage, sort_keys=True),
                )
                self.report.runtime["persistentDeviceState"] = (
                    persistent_storage
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
            self.create_restorable_command_target()
            if self.expected_reconciliation_target() is not None:
                target = self.expected_reconciliation_target()
                prepared = self.step(
                    "command.reconciliation.fixture",
                    lambda: async_harness(
                        self.clients[target["actor"]],
                        "prepareSubmittedCommand",
                        {
                            "actorPtid": self.ptids[target["actor"]],
                            "conversationId": target["conversationId"],
                            "messageId": target["messageId"],
                            "commandId": target["commandId"],
                        },
                    ),
                    target["actor"],
                )
                initial = (
                    prepared.get("snapshot")
                    if isinstance(prepared, dict)
                    else None
                )
                self.assert_condition(
                    "submitted_command_fixture_exact",
                    isinstance(initial, dict)
                    and submitted_command_snapshot_is_exact(
                        initial,
                        target["commandId"],
                        target["messageId"],
                    ),
                    json.dumps(prepared, sort_keys=True),
                )
                resumed = self.step(
                    "command.reconciliation.activate",
                    lambda: async_harness(
                        self.clients[target["actor"]],
                        "resumeMessagingLifecycle",
                        {"actorPtid": self.ptids[target["actor"]]},
                    ),
                    target["actor"],
                )
                if not isinstance(resumed, dict) or resumed.get("activated") is not True:
                    raise GateError(
                        "submitted-command lifecycle activation failed"
                    )
                self.step(
                    "command.reconciliation",
                    lambda: self.prove_expected_command_reconciliation(initial),
                    target["actor"],
                )
            conversation_id = ""
            if self.gate_id != SUBMITTED_COMMAND_RECOVERY_GATE_ID:
                conversation_id = self.step(
                    "conversation.open",
                    self.open_conversation,
                )
                self.step(
                    "avatar.bundled",
                    self.prove_demo_avatar_sources,
                )
                self.prove_direction(*self.direction_order)
                self.prove_direction(*reversed(self.direction_order))
                self.prove_additional_journey_assertions()
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
            "journey": journey_for_gate(self.gate_id),
            "conversationId": conversation_id,
            "sourceIdentity": source_identity,
            "launchOrder": order,
            "directionOrder": list(self.direction_order),
            "worktreeTopology": self.report.runtime.get(
                "worktreeTopology",
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
