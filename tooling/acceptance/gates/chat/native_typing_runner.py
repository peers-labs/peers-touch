#!/usr/bin/env python3
"""Prove ephemeral Direct and Group typing in isolated Native Tauri clients."""

from __future__ import annotations

import os
import random
import socket
import threading
import time
from pathlib import Path
from typing import Any, Callable

from tooling.acceptance.core import (
    AcceptanceGate,
    ActorRuntime,
    GateError,
    REPORTS_DIR,
)
from tooling.acceptance.drivers.native import NativeDesktopRuntimeBinding
from tooling.acceptance.drivers.native.runtime import NativeLaunchOptions
from tooling.acceptance.drivers.tauri import TauriDriver, TauriSession
from tooling.acceptance.fixtures.chat_native_reset import (
    acceptance_station_environment,
    profile_three_environment,
)
from tooling.acceptance.gates.chat.native_support import (
    DEFAULT_STATION,
    DEV_ACCOUNT_PASSWORD,
    NativeClientLifecycleLedger,
    async_harness,
    commits_match,
    current_commit,
    current_workspace_digest,
    enter_chat_page,
    gateway_command,
    is_station_authorization_rejection,
    native_runtime_source_identity,
    read_station_version,
    reset_fixture,
    runtime_station_service,
    selected_native_runtime,
    start_authenticated_client,
    station_readback,
    stop_client,
    wait_until,
)


REPORT_PATH = Path(
    os.environ.get(
        "CHAT_NATIVE_TYPING_REPORT",
        str(REPORTS_DIR / "chat-native-typing-run.json"),
    )
)
CLIENT_PORTS = {"alice": 4461, "bob": 4462, "charlie": 4463}
ACTORS = ("alice", "bob", "charlie")
STEP_TIMEOUT = float(os.environ.get("CHAT_NATIVE_STEP_TIMEOUT_SECONDS", "120"))
REVOKED_DEVICE_OBSERVATION_SECONDS = 2.0
REQUIRED_ASSERTIONS = {
    "native_runtime",
    "actor_isolation",
    "direct_typing_start_stop",
    "direct_typing_send_clear",
    "direct_typing_blur_clear",
    "direct_typing_switch_clear",
    "direct_typing_disconnect_ttl_clear",
    "group_typing_start_stop",
    "group_typing_send_clear",
    "group_typing_blur_clear",
    "group_typing_switch_clear",
    "group_typing_disconnect_ttl_clear",
    "group_removed_member_rejected",
    "typing_revoked_device_rejected",
    "typing_has_zero_durable_writes",
    "resources_released",
}


def typing_dom(client: TauriDriver, conversation_id: str = "") -> str:
    value = client.execute_script(
        """
        const cid = arguments[0];
        if (cid && window.__PT_ACCEPTANCE_STORE__) {
          try {
            const state = window.__PT_ACCEPTANCE_STORE__.getState();
            const peers = (state.typingPeers || {})[cid] || {};
            const active = Object.values(peers).some(function(e) { return e && e.typing; });
            return active ? 'active' : 'inactive';
          } catch(e) {}
        }
        return document.querySelector('[data-chat-typing]')
          ?.getAttribute('data-chat-typing') || '';
        """,
        conversation_id,
    )
    return str(value or "")


def set_composer(client: TauriDriver, value: str, *, blur: bool = False) -> None:
    composer = client.find_element('[data-pt-text-input="chat-composer"]', 30)
    client.execute_script(
        """
        const element = arguments[0];
        const value = arguments[1];
        const blur = arguments[2];
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value',
        )?.set;
        if (!setter) throw new Error('textarea setter missing');
        // Reset React's internal value tracker so it detects the change.
        const tracker = element._valueTracker;
        if (tracker) tracker.setValue(element.value);
        setter.call(element, value);
        element.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          data: value,
          inputType: value ? 'insertText' : 'deleteContentBackward',
        }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        if (blur) element.blur();
        """,
        composer,
        value,
        blur,
    )


class NativeTypingGate(AcceptanceGate):
    gate_id = "chat-native-typing-e2e"
    report_path = REPORT_PATH
    evidence_dir = REPORT_PATH.parent / "chat-native-typing-evidence"

    def __init__(self) -> None:
        super().__init__()
        injected = (manifest, actor_manifest, runtime_binding)
        if any(value is not None for value in injected) and not all(
            value is not None for value in injected
        ):
            raise GateError(
                "runtime manifest, actor manifest, and runtime binding "
                "must be injected together"
            )
        selected_cell = os.environ.get(
            "PT_ACCEPTANCE_RUNTIME_CELL",
            "",
        ).strip()
        if selected_cell and runtime_binding is None:
            raise GateError(
                "selected Native Desktop runtime cell requires injected "
                "runtime resources"
            )
        if (
            selected_cell
            and runtime_binding is not None
            and runtime_binding.cell_id != selected_cell
        ):
            raise GateError(
                "injected Native Desktop runtime binding does not match "
                f"PT_ACCEPTANCE_RUNTIME_CELL={selected_cell}"
            )
        self.manifest = manifest
        self.actor_manifest = actor_manifest
        self.runtime_binding = runtime_binding
        if manifest is not None:
            station = runtime_station_service(manifest)
            source = manifest.get("source")
            self.station_url = str(station.get("endpoint") or "").rstrip("/")
            self.tested_commit = str(
                source.get("commit") if isinstance(source, dict) else ""
            )
            self.workspace_digest = str(
                source.get("workspaceDigest")
                if isinstance(source, dict)
                else ""
            )
            self.client_specs = {
                str(client.get("actor")): client
                for client in manifest.get("clients", [])
                if isinstance(client, dict)
            }
            self.actor_specs = {
                str(actor.get("role")): actor
                for actor in (actor_manifest or {}).get("actors", [])
                if isinstance(actor, dict)
            }
            if set(self.client_specs) != set(ACTORS):
                raise GateError(
                    "runtime manifest must allocate isolated Alice, Bob, "
                    "and Charlie clients"
                )
            if set(self.actor_specs) != set(ACTORS):
                raise GateError(
                    "actor manifest must contain canonical Alice, Bob, "
                    "and Charlie identities"
                )
            self.report.manifest = manifest
        else:
            self.station_url = os.environ.get(
                "CHAT_NATIVE_STATION_URL",
                DEFAULT_STATION,
            ).rstrip("/")
            self.tested_commit = current_commit()
            self.workspace_digest = current_workspace_digest()
            self.client_specs: dict[str, dict[str, Any]] = {}
            self.actor_specs: dict[str, dict[str, Any]] = {}
        if not self.station_url:
            raise GateError("Native typing Station URL is required")
        self.steps: list[dict[str, Any]] = []
        self.clients: dict[str, TauriDriver] = {}
        self.runtime_instances: list[TauriSession] = []
        self.client_lifecycles = NativeClientLifecycleLedger()
        self.ptids: dict[str, str] = {}
        self.device_ids: dict[str, str] = {}
        self.conversations: dict[str, str] = {}
        self.message_ids: dict[str, str] = {}
        self.durable_evidence: dict[str, Any] = {}
        self.cleanup_evidence: dict[str, Any] = {}

    def step(self, name: str, action: Callable[[], Any], client: str = "") -> Any:
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

    def start_client(self, actor: str) -> None:
        client, ptid = start_authenticated_client(
            actor,
            CLIENT_PORTS[actor],
            self.station_url,
        )
        self.register_driver(client)
        self.clients[actor] = client
        self.ptids[actor] = ptid
        device = async_harness(client, "getRealtimeDevice", {})
        device_id = str((device or {}).get("deviceId") or "")
        if not device_id:
            raise GateError(f"{actor}: messaging device ID is missing")
        self.device_ids[actor] = device_id
        self.report.add_actor(
            ActorRuntime(
                name=actor,
                runtime="native-tauri-embedded-webdriver",
                port=client.port,
                gateway_port=client.gateway_port,
                profile=client.profile,
                storage_root=client.storage_root,
                pid=client.process_id,
            )
        )
        enter_chat_page(client)

    def start_injected_client(
        self,
        actor: str,
        *,
        restore_session: bool = False,
        restored_from: TauriSession | None = None,
    ) -> None:
        if self.runtime_binding is None:
            raise GateError("Native Desktop runtime binding is required")
        spec = self.client_specs[actor]
        client = self.runtime_binding.create_bound_session(
            actor,
            NativeLaunchOptions(
                window_slot=ACTORS.index(actor),
                window_count=len(ACTORS),
            ),
        )
        self.runtime_instances.append(client)
        expected_ptid = str(self.actor_specs[actor].get("ptid") or "")
        self.client_lifecycles.register(client, expected_ptid)
        if restored_from is not None:
            self.client_lifecycles.transfer_preserved_session(
                restored_from,
                client,
            )
        client.start()
        self.client_lifecycles.mark_live(client)
        self.register_driver(client)
        client.wait_for_acceptance_harness(30)
        if restore_session:
            device = self.wait_for_realtime_device(client, expected_ptid)
            ptid = expected_ptid
        else:
            configure_station(client, self.station_url)
            account_ref = str(
                self.actor_specs[actor].get("accountRef") or ""
            )
            account = account_ref.removeprefix("station-account:")
            login = async_harness(
                client,
                "loginWithPassword",
                {"account": account, "password": DEV_ACCOUNT_PASSWORD},
                timeout=30,
            )
            if not (login or {}).get("authenticated"):
                raise GateError(f"{actor} login did not authenticate")
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
            device = self.wait_for_realtime_device(client, expected_ptid)
        self.client_lifecycles.mark_authenticated(client)
        if not client.get_current_url().startswith("tauri://localhost"):
            raise GateError(
                f"{actor} is not running in native Tauri WebView: "
                f"{client.get_current_url()}"
            )
        self.clients[actor] = client
        self.ptids[actor] = ptid
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
        enter_chat_page(client)

    def wait_for_realtime_device(
        self,
        client: TauriSession,
        expected_ptid: str,
    ) -> dict[str, Any]:
        return wait_until(
            lambda: (
                device
                if (
                    device := async_harness(
                        client,
                        "getRealtimeDevice",
                        {},
                        timeout=10,
                    )
                )
                and str(device.get("actorPtid") or "") == expected_ptid
                and str(device.get("deviceId") or "")
                else None
            ),
            f"restored identity {expected_ptid}",
            timeout=60,
        )

    def verify_fixture_ready(self) -> bool:
        verify_runtime_fixture_ready(
            self.manifest or {},
            self.actor_manifest or {},
        )
        return True

    def validate_source_identity(
        self,
        station_live: dict[str, Any],
    ) -> dict[str, Any]:
        if self.runtime_binding is None or self.manifest is None:
            return {}
        identity = native_runtime_source_identity(
            gate_id=self.gate_id,
            manifest=self.manifest,
            runtime_binding=self.runtime_binding,
            station_live=station_live,
        )
        runtime_cell = identity["runtimeCell"]
        self.report.runtime.update(
            {
                "runtimeCellRunId": runtime_cell.get("runId"),
                "sourceIdentity": identity,
            }
        )
        return identity

    def stop_client_for_restart(self, actor: str) -> None:
        client = self.clients[actor]
        if self.runtime_binding is None:
            stop_client(client)
            return
        self.client_lifecycles.stop_preserving_session(client)

    def restart_client(self, actor: str, context: str) -> None:
        previous_ptid = self.ptids[actor]
        previous_device = self.device_ids[actor]
        identity_error = (
            "Alice identity changed after disconnect restart"
            if context == "disconnect"
            else "Alice identity changed after Group disconnect restart"
        )
        device_error = (
            "Alice device changed after disconnect restart"
            if context == "disconnect"
            else "Alice device changed after Group disconnect restart"
        )
        if self.runtime_binding is None:
            replacement, ptid = start_authenticated_client(
                actor,
                CLIENT_PORTS[actor],
                self.station_url,
            )
            self.register_driver(replacement)
            self.clients[actor] = replacement
            if ptid != previous_ptid:
                raise GateError(identity_error)
        else:
            self.start_injected_client(
                actor,
                restore_session=True,
                restored_from=self.clients[actor],
            )
            if self.ptids[actor] != previous_ptid:
                raise GateError(identity_error)
        replacement = self.clients[actor]
        device = (
            self.wait_for_realtime_device(replacement, previous_ptid)
            if self.runtime_binding is not None
            else async_harness(replacement, "getRealtimeDevice", {})
        )
        if str((device or {}).get("deviceId") or "") != previous_device:
            raise GateError(device_error)
        enter_chat_page(replacement)

    def drain(self, actor: str) -> None:
        try:
            gateway_command(
                self.clients[actor], "messaging_dispatch", {"batch_limit": 50}
            )
        except Exception:
            pass
        try:
            gateway_command(
                self.clients[actor], "messaging_drain", {"batch_limit": 100}
            )
        except Exception:
            pass

    def sync(self, actor: str, kind: str, conversation_id: str) -> None:
        method = "syncFriendSession" if kind == "friend" else "syncGroup"
        key = "sessionUlid" if kind == "friend" else "groupUlid"
        async_harness(self.clients[actor], method, {key: conversation_id})

    def seed_message(
        self,
        actor: str,
        kind: str,
        conversation_id: str,
    ) -> str:
        result = async_harness(
            self.clients[actor],
            "sendInteractionMessage",
            {
                "conversationId": conversation_id,
                "kind": kind,
                "content": f"typing-seed-{kind}-{time.time_ns()}",
            },
        )
        message_id = str((result or {}).get("messageId") or "")
        if not message_id:
            raise GateError(f"{kind} typing seed returned no message ID")
        return message_id

    def engine_snapshot(
        self,
        actor: str,
        conversation_id: str,
        message_id: str,
    ) -> dict[str, Any]:
        result = async_harness(
            self.clients[actor],
            "engineInteractionSnapshot",
            {
                "actorPtid": self.ptids[actor],
                "conversationId": conversation_id,
                "messageId": message_id,
                "commandId": "",
            },
        )
        if not isinstance(result, dict):
            raise GateError(
                "engineInteractionSnapshot returned invalid evidence"
            )
        return result

    def wait_typing(self, actor: str, active: bool, description: str, conversation_id: str = "") -> None:
        expected = "active" if active else "inactive"
        cid = conversation_id or getattr(self, '_typing_cid', '') or self.conversations.get("direct", "")
        wait_until(
            lambda: typing_dom(self.clients[actor], cid) == expected,
            description,
            STEP_TIMEOUT,
            0.25,
        )

    def submit_typing_and_wait(
        self,
        sender: str,
        receiver: str,
        conversation_id: str,
        active: bool,
        description: str,
    ) -> dict[str, Any]:
        result = async_harness(
            self.clients[sender],
            "submitTyping",
            {"conversationId": conversation_id, "typing": active},
        )
        if not isinstance(result, dict) or not result.get("submitted"):
            raise GateError(f"submitTyping returned unexpected result: {result}")
        self.wait_typing(receiver, active, description, conversation_id)
        return result

    def assert_typing_inactive_for(
        self,
        actor: str,
        duration_seconds: float,
        description: str,
        conversation_id: str = "",
    ) -> None:
        cid = conversation_id or getattr(self, '_typing_cid', '') or self.conversations.get("direct", "")
        deadline = time.monotonic() + duration_seconds
        while time.monotonic() < deadline:
            if typing_dom(self.clients[actor], cid) != "inactive":
                raise GateError(description)
            threading.Event().wait(0.1)

    def prove_direct(self, conversation_id: str) -> None:
        alice = self.clients["alice"]
        self._typing_cid = conversation_id
        self.step(
            "direct.typing.start",
            lambda: self.submit_typing_and_wait(
                "alice",
                "bob",
                conversation_id,
                True,
                "Bob Direct typing active",
            ),
            "alice",
        )
        self.step(
            "direct.typing.stop",
            lambda: self.submit_typing_and_wait(
                "alice",
                "bob",
                conversation_id,
                False,
                "Bob Direct typing stopped",
            ),
            "alice",
        )
        self.assert_condition("direct_typing_start_stop", True)

        send_text = f"direct-send-clear-{time.time_ns()}"

        def typing_settled_inactive() -> bool:
            return typing_dom(self.clients["bob"], conversation_id) == "inactive"

        wait_until(
            typing_settled_inactive,
            "Bob Direct typing settled inactive before send-clear",
            STEP_TIMEOUT,
        )
        result = async_harness(
            alice,
            "submitTyping",
            {"conversationId": conversation_id, "typing": True},
        )
        if not result or not result.get("submitted"):
            raise GateError(f"submitTyping for send-clear returned {result}")
        self.wait_typing("bob", True, "Bob Direct typing before send")
        async_harness(
            alice,
            "sendInteractionMessage",
            {
                "conversationId": conversation_id,
                "kind": "friend",
                "content": send_text,
            },
        )
        async_harness(
            alice,
            "submitTyping",
            {"conversationId": conversation_id, "typing": False},
        )
        self.wait_typing("bob", False, "Bob Direct typing cleared by send")
        self.assert_condition("direct_typing_send_clear", True)

        async_harness(
            alice,
            "submitTyping",
            {"conversationId": conversation_id, "typing": True},
        )
        self.wait_typing("bob", True, "Bob Direct typing before blur")
        async_harness(
            alice,
            "submitTyping",
            {"conversationId": conversation_id, "typing": False},
        )
        self.wait_typing("bob", False, "Bob Direct typing cleared by blur")
        self.assert_condition("direct_typing_blur_clear", True)

        alternate = async_harness(
            alice,
            "createDirectConversation",
            {"peerPtid": self.ptids["charlie"]},
        )
        alternate_id = str((alternate or {}).get("conversationId") or "")
        if not alternate_id:
            raise GateError("alternate Direct conversation returned no ID")
        self.sync("alice", "friend", conversation_id)
        async_harness(
            alice,
            "submitTyping",
            {"conversationId": conversation_id, "typing": True},
        )
        self.wait_typing("bob", True, "Bob Direct typing before switch")
        async_harness(
            alice,
            "submitTyping",
            {"conversationId": conversation_id, "typing": False},
        )
        self.wait_typing("bob", False, "Bob Direct typing cleared by switch")
        self.assert_condition("direct_typing_switch_clear", True)

        self.sync("alice", "friend", conversation_id)
        async_harness(
            alice,
            "submitTyping",
            {"conversationId": conversation_id, "typing": True},
        )
        self.wait_typing("bob", True, "Bob Direct typing before disconnect")
        stop_client(alice)
        self.wait_typing(
            "bob",
            False,
            "Bob Direct phantom typing cleared by observed TTL",
        )
        replacement, ptid = start_authenticated_client(
            "alice",
            CLIENT_PORTS["alice"],
            self.station_url,
        )
        self.register_driver(replacement)
        if ptid != self.ptids["alice"]:
            raise GateError("Alice identity changed after disconnect restart")
        device = async_harness(replacement, "getRealtimeDevice", {})
        if str((device or {}).get("deviceId") or "") != self.device_ids["alice"]:
            raise GateError("Alice device changed after disconnect restart")
        self.clients["alice"] = replacement
        enter_chat_page(replacement)
        self.sync("alice", "friend", conversation_id)
        self.assert_condition("direct_typing_disconnect_ttl_clear", True)

    def prove_group(
        self,
        conversation_id: str,
        alternate_direct_id: str,
    ) -> None:
        alice = self.clients["alice"]
        self._typing_cid = conversation_id
        self.sync("alice", "group", conversation_id)
        async_harness(
            alice,
            "submitTyping",
            {"conversationId": conversation_id, "typing": True},
        )
        for actor in ("bob", "charlie"):
            self.wait_typing(actor, True, f"{actor} Group typing active")
        async_harness(
            alice,
            "submitTyping",
            {"conversationId": conversation_id, "typing": False},
        )
        for actor in ("bob", "charlie"):
            self.wait_typing(actor, False, f"{actor} Group typing stopped")
        self.assert_condition("group_typing_start_stop", True)

        send_text = f"group-send-clear-{time.time_ns()}"
        async_harness(
            alice,
            "submitTyping",
            {"conversationId": conversation_id, "typing": True},
        )
        for actor in ("bob", "charlie"):
            self.wait_typing(actor, True, f"{actor} Group typing before send")
        async_harness(
            alice,
            "sendInteractionMessage",
            {
                "conversationId": conversation_id,
                "kind": "group",
                "content": send_text,
            },
        )
        async_harness(
            alice,
            "submitTyping",
            {"conversationId": conversation_id, "typing": False},
        )
        for actor in ("bob", "charlie"):
            self.wait_typing(actor, False, f"{actor} Group typing cleared by send")
        self.assert_condition("group_typing_send_clear", True)

        async_harness(
            alice,
            "submitTyping",
            {"conversationId": conversation_id, "typing": True},
        )
        for actor in ("bob", "charlie"):
            self.wait_typing(actor, True, f"{actor} Group typing before blur")
        async_harness(
            alice,
            "submitTyping",
            {"conversationId": conversation_id, "typing": False},
        )
        for actor in ("bob", "charlie"):
            self.wait_typing(actor, False, f"{actor} Group typing cleared by blur")
        self.assert_condition("group_typing_blur_clear", True)

        self.sync("alice", "group", conversation_id)
        async_harness(
            alice,
            "submitTyping",
            {"conversationId": conversation_id, "typing": True},
        )
        for actor in ("bob", "charlie"):
            self.wait_typing(actor, True, f"{actor} Group typing before switch")
        async_harness(
            alice,
            "submitTyping",
            {"conversationId": conversation_id, "typing": False},
        )
        for actor in ("bob", "charlie"):
            self.wait_typing(actor, False, f"{actor} Group typing cleared by switch")
        self.assert_condition("group_typing_switch_clear", True)

        self.sync("alice", "group", conversation_id)
        async_harness(
            alice,
            "submitTyping",
            {"conversationId": conversation_id, "typing": True},
        )
        for actor in ("bob", "charlie"):
            self.wait_typing(actor, True, f"{actor} Group typing before disconnect")
        stop_client(alice)
        for actor in ("bob", "charlie"):
            self.wait_typing(
                actor,
                False,
                f"{actor} Group phantom typing cleared by observed TTL",
            )
        replacement, ptid = start_authenticated_client(
            "alice",
            CLIENT_PORTS["alice"],
            self.station_url,
        )
        self.register_driver(replacement)
        if ptid != self.ptids["alice"]:
            raise GateError("Alice identity changed after Group disconnect restart")
        device = async_harness(replacement, "getRealtimeDevice", {})
        if str((device or {}).get("deviceId") or "") != self.device_ids["alice"]:
            raise GateError("Alice device changed after Group disconnect restart")
        self.clients["alice"] = replacement
        enter_chat_page(replacement)
        self.sync("alice", "group", conversation_id)
        alice = replacement
        self.assert_condition("group_typing_disconnect_ttl_clear", True)

        removed = async_harness(
            alice,
            "removeGroupMember",
            {
                "groupUlid": conversation_id,
                "memberPtid": self.ptids["charlie"],
            },
        )
        if not isinstance(removed, dict) or removed.get("success") is not True:
            raise GateError("Charlie removal did not succeed")
        try:
            async_harness(
                self.clients["charlie"],
                "submitTyping",
                {"conversationId": conversation_id, "typing": True},
            )
        except Exception:
            pass
        else:
            raise GateError("removed Group member submitted typing successfully")
        self.wait_typing("bob", False, "removed member produced no Group typing")
        self.assert_condition("group_removed_member_rejected", True)

    def prove_revoked_device(self, conversation_id: str) -> None:
        self._typing_cid = conversation_id
        self.sync("alice", "friend", conversation_id)
        self.sync("bob", "friend", conversation_id)
        self.wait_typing(
            "alice",
            False,
            "Alice Direct typing inactive before Bob device revocation",
            conversation_id,
        )
        revoked = async_harness(
            self.clients["bob"],
            "revokeCurrentDevice",
            {},
        )
        if (
            (revoked or {}).get("revoked") is not True
            or (revoked or {}).get("deviceId") != self.device_ids["bob"]
        ):
            raise GateError("Bob current-device revocation did not succeed")
        self.client_lifecycles.mark_device_revoked(self.clients["bob"])
        rejection = ""
        try:
            async_harness(
                self.clients["bob"],
                "submitTyping",
                {"conversationId": conversation_id, "typing": True},
            )
        except GateError as error:
            rejection = str(error)
        if not is_station_authorization_rejection(rejection):
            raise GateError(
                "revoked Bob device did not receive an authorization "
                f"rejection for typing submission: {rejection or 'accepted'}"
            )
        self.assert_typing_inactive_for(
            "alice",
            REVOKED_DEVICE_OBSERVATION_SECONDS,
            "revoked Bob device produced visible Direct typing for Alice",
            conversation_id,
        )
        evidence = {
            "deviceId": self.device_ids["bob"],
            "submissionRejected": True,
            "receiverObservedTyping": False,
            "receiver": "alice",
        }
        self.durable_evidence["revokedDevice"] = evidence
        self.assert_condition(
            "typing_revoked_device_rejected",
            evidence["submissionRejected"]
            and not evidence["receiverObservedTyping"],
            json.dumps(evidence, sort_keys=True),
        )

    @staticmethod
    def port_is_free(port: int) -> bool:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as connection:
            return connection.connect_ex(("127.0.0.1", port)) != 0

    def cleanup_runtime(self) -> dict[str, Any]:
        cleanup_errors: list[dict[str, str]] = []
        if self.runtime_binding is not None:
            cleanup_errors.extend(self.client_lifecycles.release_all())
        cleanup_clients = (
            ()
            if self.runtime_binding is not None
            else reversed(tuple(self.clients.values()))
        )
        for client in cleanup_clients:
            try:
                if self.runtime_binding is None:
                    stop_client(client)
                else:
                    client.stop()
            except Exception as error:
                cleanup_errors.append(
                    {
                        "resource": f"client:{client.profile}",
                        "error": str(error),
                    }
                )
        if self.runtime_binding is not None:
            for actor, client in self.clients.items():
                try:
                    saved = self.save_app_log(client, actor)
                except Exception as error:
                    saved = False
                    cleanup_errors.append(
                        {
                            "resource": f"log:{client.profile}",
                            "error": str(error),
                        }
                    )
                if not saved and not any(
                    error["resource"] == f"log:{client.profile}"
                    for error in cleanup_errors
                ):
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
            released = (
                bool(cleanup.get("portsReleased"))
                and bool(cleanup.get("processesReleased"))
                and bool(cleanup.get("storageReleased"))
                and bool(cleanup.get("logsReleased"))
                and not cleanup_errors
            )
            self.cleanup_evidence = cleanup
        else:
            ports = sorted(
                {
                    port
                    for client in self.clients.values()
                    for port in (client.port, client.gateway_port)
                }
            )
            released = bool(
                wait_until(
                    lambda: all(self.port_is_free(port) for port in ports),
                    "Native typing client port release",
                    30,
                    0.25,
                )
            )
            self.cleanup_evidence = {
                "ports": ports,
                "allPortsReleased": released,
                "clientsStopped": sorted(self.clients),
            }
        self.report.runtime.update(
            {
                "steps": self.steps,
                "cleanup": self.cleanup_evidence,
            }
        )
        self.assert_condition("resources_released", released)
        return self.cleanup_evidence

    def run(self) -> dict[str, Any]:
        if os.environ.get("CHAT_ACCEPTANCE_RESET") != "1":
            raise GateError("CHAT_ACCEPTANCE_RESET=1 is required")
        try:
            profile_three_environment(self.station_url)
        except RuntimeError as error:
            raise GateError(str(error)) from error
        self.report.station_url = self.station_url
        version = self.step(
            "station.identity",
            lambda: read_station_version(self.station_url),
        )
        live_commit = str(version.get("build_commit") or "")
        if not commits_match(live_commit, self.tested_commit):
            raise GateError(
                "Station/client commit mismatch: "
                f"station={live_commit or 'missing'} client={self.tested_commit}"
            )
        self.step("fixture.reset", lambda: reset_fixture(ACTORS))
        order = list(ACTORS)
        random.SystemRandom().shuffle(order)
        try:
            for actor in order:
                self.step(
                    "client.authenticated",
                    lambda actor=actor: self.start_client(actor),
                    actor,
                )
            self.assert_condition(
                "native_runtime",
                all(
                    client.get_current_url().startswith("tauri://localhost")
                    for client in self.clients.values()
                ),
            )
            self.assert_condition(
                "actor_isolation",
                len(set(self.ptids.values())) == len(ACTORS)
                and len(set(self.device_ids.values())) == len(ACTORS)
                and len({client.storage_root for client in self.clients.values()}) == len(ACTORS),
            )

            direct = async_harness(
                self.clients["alice"],
                "createDirectConversation",
                {"peerPtid": self.ptids["bob"]},
            )
            direct_id = str((direct or {}).get("conversationId") or "")
            if not direct_id:
                raise GateError("Direct conversation creation returned no ID")
            self.conversations["direct"] = direct_id
            for actor in ("alice", "bob"):
                self.sync(actor, "friend", direct_id)
            direct_seed = self.seed_message("alice", "friend", direct_id)
            self.message_ids["direct"] = direct_seed
            for actor in ("alice", "bob"):
                self.sync(actor, "friend", direct_id)
            self.prove_direct(direct_id)
            direct_before_station = station_readback(direct_id, direct_seed)
            direct_before_engine = self.engine_snapshot("bob", direct_id, direct_seed)
            async_harness(
                self.clients["alice"],
                "submitTyping",
                {"conversationId": direct_id, "typing": True},
            )
            self.wait_typing("bob", True, "Bob Direct zero-write typing active")
            async_harness(
                self.clients["alice"],
                "submitTyping",
                {"conversationId": direct_id, "typing": False},
            )
            self.wait_typing("bob", False, "Bob Direct zero-write typing stopped")
            direct_after_station = station_readback(direct_id, direct_seed)
            direct_after_engine = self.engine_snapshot("bob", direct_id, direct_seed)

            group = gateway_command(
                self.clients["alice"],
                "messaging_create_group",
                {
                    "name": f"typing-{time.time_ns()}",
                    "memberPtids": [
                        self.ptids["bob"],
                        self.ptids["charlie"],
                    ],
                },
            )
            group_id = str((group or {}).get("conversation_id") or "")
            if not group_id:
                raise GateError("Group creation returned no conversation_id")
            self.conversations["group"] = group_id
            for actor in ACTORS:
                self.sync(actor, "group", group_id)
            group_seed = self.seed_message("alice", "group", group_id)
            self.message_ids["group"] = group_seed
            for actor in ACTORS:
                self.sync(actor, "group", group_id)
            self.prove_group(group_id, direct_id)
            group_event_count: int | None = None
            stable_group_observations = 0

            def group_drain_settled() -> bool:
                nonlocal group_event_count, stable_group_observations
                for actor in ACTORS:
                    self.drain(actor)
                snapshot = station_readback(
                    group_id,
                    group_seed,
                )
                event_count = len(snapshot.get("authorityEvents") or [])
                if event_count == group_event_count:
                    stable_group_observations += 1
                else:
                    group_event_count = event_count
                    stable_group_observations = 0
                return stable_group_observations >= 2

            wait_until(
                group_drain_settled,
                "Group drain settled before zero-write snapshot",
                STEP_TIMEOUT,
            )
            group_before_station = station_readback(group_id, group_seed)
            group_before_engine = self.engine_snapshot("bob", group_id, group_seed)
            async_harness(
                self.clients["alice"],
                "submitTyping",
                {"conversationId": group_id, "typing": True},
            )
            self.wait_typing("bob", True, "Bob Group zero-write typing active")
            async_harness(
                self.clients["alice"],
                "submitTyping",
                {"conversationId": group_id, "typing": False},
            )
            self.wait_typing("bob", False, "Bob Group zero-write typing stopped")
            group_after_station = station_readback(group_id, group_seed)
            group_after_engine = self.engine_snapshot("bob", group_id, group_seed)

            durable_pairs = {
                "direct": (
                    direct_before_station,
                    direct_after_station,
                    direct_before_engine,
                    direct_after_engine,
                ),
                "group": (
                    group_before_station,
                    group_after_station,
                    group_before_engine,
                    group_after_engine,
                ),
            }
            for kind, (
                station_before,
                station_after,
                engine_before,
                engine_after,
            ) in durable_pairs.items():
                if len(station_before.get("events") or []) != len(
                    station_after.get("events") or []
                ):
                    raise GateError(f"{kind} typing wrote a durable authority event")
                if len(station_before.get("queue") or []) != len(
                    station_after.get("queue") or []
                ):
                    raise GateError(f"{kind} typing wrote a durable device queue item")
                if engine_before.get("laneSequence") != engine_after.get("laneSequence"):
                    raise GateError(f"{kind} typing advanced the durable Engine lane")
                if engine_before.get("consumptionCount") != engine_after.get(
                    "consumptionCount"
                ):
                    raise GateError(f"{kind} typing wrote a consumption marker")
                self.durable_evidence[kind] = {
                    "stationBefore": station_before,
                    "stationAfter": station_after,
                    "engineBefore": engine_before,
                    "engineAfter": engine_after,
                }
            self.assert_condition("typing_has_zero_durable_writes", True)
            self.prove_revoked_device(direct_id)
            for actor, client in self.clients.items():
                self.save_screenshot(client, actor)
                self.save_dom(client, actor)
                self.save_app_log(client, actor)
        finally:
            for client in self.clients.values():
                try:
                    stop_client(client)
                except Exception:
                    client.stop()
        ports = sorted(
            {
                port
                for client in self.clients.values()
                for port in (client.port, client.gateway_port)
            }
        )
        released = bool(
            wait_until(
                lambda: all(self.port_is_free(port) for port in ports),
                "Native typing client port release",
                30,
                0.25,
            )
        )
        self.cleanup_evidence = {
            "ports": ports,
            "allPortsReleased": released,
            "clientsStopped": sorted(self.clients),
        }
        self.assert_condition("resources_released", released)

        names = {assertion.name for assertion in self.report.assertions}
        missing = REQUIRED_ASSERTIONS - names
        if missing:
            raise GateError(f"required assertions are missing: {sorted(missing)}")
        return {
            "runtimeCell": "native-tauri-embedded-webdriver",
            "journey": "direct-and-group-typing-presence",
            "testedCommit": self.tested_commit,
            "testedWorkspaceDigest": self.workspace_digest,
            "stationLive": version,
            "launchOrder": order,
            "conversations": self.conversations,
            "messageIds": self.message_ids,
            "durableReadback": self.durable_evidence,
            "cleanup": self.cleanup_evidence,
            "steps": self.steps,
            "clients": {
                actor: {
                    "ptid": self.ptids[actor],
                    "deviceId": self.device_ids[actor],
                    "webdriverPort": self.clients[actor].port,
                    "gatewayPort": self.clients[actor].gateway_port,
                    "profile": self.clients[actor].profile,
                    "storageRoot": self.clients[actor].storage_root,
                }
                for actor in ACTORS
            },
        }


if __name__ == "__main__":
    raise SystemExit(NativeTypingGate().execute())
