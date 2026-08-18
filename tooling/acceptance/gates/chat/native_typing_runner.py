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

from tooling.acceptance.core import AcceptanceGate, ActorRuntime, GateError, REPORTS_DIR
from tooling.acceptance.drivers.tauri import TauriDriver
from tooling.acceptance.fixtures.chat_native_reset import profile_three_environment
from tooling.acceptance.gates.chat.native_support import (
    DEFAULT_STATION,
    async_harness,
    commits_match,
    current_commit,
    current_workspace_digest,
    enter_chat_page,
    gateway_command,
    read_station_version,
    reset_fixture,
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


def typing_dom(client: TauriDriver) -> str:
    value = client.execute_script(
        """
        return document.querySelector('[data-chat-typing]')
          ?.getAttribute('data-chat-typing') || '';
        """
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

    def __init__(self) -> None:
        super().__init__()
        self.station_url = os.environ.get(
            "CHAT_NATIVE_STATION_URL",
            DEFAULT_STATION,
        ).rstrip("/")
        self.tested_commit = current_commit()
        self.workspace_digest = current_workspace_digest()
        self.steps: list[dict[str, Any]] = []
        self.clients: dict[str, TauriDriver] = {}
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
        return gateway_command(
            self.clients[actor],
            "messaging_acceptance_interaction_snapshot",
            {
                "conversation_id": conversation_id,
                "message_id": message_id,
                "command_id": "",
            },
        )

    def wait_typing(self, actor: str, active: bool, description: str) -> None:
        expected = "active" if active else "inactive"
        wait_until(
            lambda: typing_dom(self.clients[actor]) == expected,
            description,
            STEP_TIMEOUT,
            0.25,
        )

    def assert_typing_inactive_for(
        self,
        actor: str,
        duration_seconds: float,
        description: str,
    ) -> None:
        deadline = time.monotonic() + duration_seconds
        while time.monotonic() < deadline:
            if typing_dom(self.clients[actor]) != "inactive":
                raise GateError(description)
            threading.Event().wait(0.1)

    def prove_direct(self, conversation_id: str) -> None:
        alice = self.clients["alice"]
        self.step(
            "direct.typing.start",
            lambda: (
                set_composer(alice, f"direct-typing-{time.time_ns()}")
                or self.wait_typing("bob", True, "Bob Direct typing active")
            ),
            "alice",
        )
        self.step(
            "direct.typing.stop",
            lambda: (
                set_composer(alice, "")
                or self.wait_typing("bob", False, "Bob Direct typing stopped")
            ),
            "alice",
        )
        self.assert_condition("direct_typing_start_stop", True)

        send_text = f"direct-send-clear-{time.time_ns()}"
        set_composer(alice, send_text)
        self.wait_typing("bob", True, "Bob Direct typing before send")
        alice.find_element("[data-chat-send]", 10).click()
        self.wait_typing("bob", False, "Bob Direct typing cleared by send")
        self.assert_condition("direct_typing_send_clear", True)

        set_composer(alice, f"direct-blur-{time.time_ns()}")
        self.wait_typing("bob", True, "Bob Direct typing before blur")
        set_composer(alice, "", blur=True)
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
        self.sync("charlie", "friend", alternate_id)
        self.sync("alice", "friend", conversation_id)
        set_composer(alice, f"direct-switch-{time.time_ns()}")
        self.wait_typing("bob", True, "Bob Direct typing before switch")
        self.sync("alice", "friend", alternate_id)
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
        self.sync("alice", "group", conversation_id)
        set_composer(alice, f"group-typing-{time.time_ns()}")
        for actor in ("bob", "charlie"):
            self.wait_typing(actor, True, f"{actor} Group typing active")
        set_composer(alice, "")
        for actor in ("bob", "charlie"):
            self.wait_typing(actor, False, f"{actor} Group typing stopped")
        self.assert_condition("group_typing_start_stop", True)

        send_text = f"group-send-clear-{time.time_ns()}"
        set_composer(alice, send_text)
        for actor in ("bob", "charlie"):
            self.wait_typing(actor, True, f"{actor} Group typing before send")
        alice.find_element("[data-chat-send]", 10).click()
        for actor in ("bob", "charlie"):
            self.wait_typing(actor, False, f"{actor} Group typing cleared by send")
        self.assert_condition("group_typing_send_clear", True)

        set_composer(alice, f"group-blur-{time.time_ns()}")
        for actor in ("bob", "charlie"):
            self.wait_typing(actor, True, f"{actor} Group typing before blur")
        set_composer(alice, "", blur=True)
        for actor in ("bob", "charlie"):
            self.wait_typing(actor, False, f"{actor} Group typing cleared by blur")
        self.assert_condition("group_typing_blur_clear", True)

        self.sync("alice", "group", conversation_id)
        set_composer(alice, f"group-switch-{time.time_ns()}")
        for actor in ("bob", "charlie"):
            self.wait_typing(actor, True, f"{actor} Group typing before switch")
        self.sync("alice", "friend", alternate_direct_id)
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
                "memberDid": self.ptids["charlie"],
            },
            timeout=120,
        )
        if not (removed or {}).get("success"):
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
        self.sync("alice", "friend", conversation_id)
        self.sync("bob", "friend", conversation_id)
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
        try:
            async_harness(
                self.clients["bob"],
                "submitTyping",
                {"conversationId": conversation_id, "typing": True},
            )
        except Exception:
            pass
        else:
            raise GateError("revoked device submitted typing successfully")
        async_harness(
            self.clients["alice"],
            "submitTyping",
            {"conversationId": conversation_id, "typing": True},
        )
        self.assert_typing_inactive_for(
            "bob",
            2,
            "revoked device produced visible typing",
        )
        async_harness(
            self.clients["alice"],
            "submitTyping",
            {"conversationId": conversation_id, "typing": False},
        )
        self.assert_condition("typing_revoked_device_rejected", True)

    @staticmethod
    def port_is_free(port: int) -> bool:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as connection:
            return connection.connect_ex(("127.0.0.1", port)) != 0

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

            group = async_harness(
                self.clients["alice"],
                "createGroup",
                {
                    "name": f"typing-{time.time_ns()}",
                    "memberDids": [self.ptids["bob"], self.ptids["charlie"]],
                },
                timeout=120,
            )
            group_id = str((group or {}).get("groupUlid") or "")
            if not group_id:
                raise GateError("Group creation returned no ID")
            self.conversations["group"] = group_id
            for actor in ACTORS:
                self.sync(actor, "group", group_id)
            group_seed = self.seed_message("alice", "group", group_id)
            self.message_ids["group"] = group_seed
            for actor in ACTORS:
                self.sync(actor, "group", group_id)
            self.prove_group(group_id, direct_id)
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
