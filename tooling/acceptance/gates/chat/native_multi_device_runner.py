#!/usr/bin/env python3
"""Prove Direct delivery across two devices of the same recipient."""

from __future__ import annotations

import os
import random
import time
from pathlib import Path
from typing import Any, Callable

from tooling.acceptance.core import AcceptanceGate, ActorRuntime, GateError, REPORTS_DIR
from tooling.acceptance.drivers.tauri import TauriDriver
from tooling.acceptance.gates.chat.native_support import (
    DEFAULT_STATION,
    async_harness,
    commits_match,
    current_commit,
    current_workspace_digest,
    enter_chat_page,
    message_snapshot,
    read_station_version,
    reset_fixture,
    send_text,
    start_authenticated_client,
    stop_client,
    wait_until,
)


REPORT_PATH = Path(
    os.environ.get(
        "CHAT_NATIVE_MULTI_DEVICE_REPORT",
        str(REPORTS_DIR / "chat-native-multi-device-run.json"),
    )
)
CLIENT_PORTS = {"alice": 4447, "bob1": 4448, "bob2": 4449}
STEP_TIMEOUT = float(os.environ.get("CHAT_NATIVE_STEP_TIMEOUT_SECONDS", "120"))
REQUIRED_ASSERTIONS = {
    "native_runtime",
    "actor_isolation",
    "alice_to_bob1_plaintext",
    "alice_to_bob1_delivered",
    "alice_to_bob2_plaintext",
    "alice_to_bob2_delivered",
}


class NativeMultiDeviceGate(AcceptanceGate):
    gate_id = "chat-native-multi-device-e2e"
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

    def start_client(self, actor: str) -> None:
        account = "bob" if actor.startswith("bob") else actor
        client, ptid = start_authenticated_client(
            account,
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

    def open_conversation(self) -> str:
        alice = self.clients["alice"]
        for client in self.clients.values():
            enter_chat_page(client)
        created = async_harness(
            alice,
            "createDirectConversation",
            {"peerPtid": self.ptids["bob1"]},
        )
        conversation_id = str((created or {}).get("conversationId") or "")
        if not conversation_id:
            raise GateError("Direct conversation creation returned no ID")
        for client in self.clients.values():
            async_harness(
                client,
                "syncFriendSession",
                {"sessionUlid": conversation_id},
            )
        return conversation_id

    def prove_delivery(self, receiver_name: str, text: str) -> None:
        receiver = self.clients[receiver_name]
        received = self.step(
            "message.received",
            lambda: wait_until(
                lambda: message_snapshot(receiver, text),
                f"{receiver_name} exact plaintext",
            ),
            receiver_name,
        )
        self.assert_condition(
            f"alice_to_{receiver_name}_plaintext",
            text in str(received.get("text") or "")
            and bool(received.get("messageUlid")),
            f"message_id={received.get('messageUlid', '')}",
        )
        delivered = self.step(
            "receipt.delivered",
            lambda: wait_until(
                lambda: (
                    snapshot
                    if (snapshot := message_snapshot(receiver, text))
                    and snapshot.get("receipt") in {"delivered", "read"}
                    else None
                ),
                f"{receiver_name} delivered receipt",
            ),
            receiver_name,
        )
        self.assert_condition(
            f"alice_to_{receiver_name}_delivered",
            delivered.get("receipt") in {"delivered", "read"},
            f"receipt={delivered.get('receipt', '')}",
        )

    def run(self) -> dict[str, Any]:
        if os.environ.get("CHAT_ACCEPTANCE_RESET") != "1":
            raise GateError("CHAT_ACCEPTANCE_RESET=1 is required")

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

        self.step("fixture.reset", lambda: reset_fixture(("alice", "bob")))
        order = ["alice", "bob1", "bob2"]
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
                self.ptids["bob1"] == self.ptids["bob2"]
                and self.device_ids["bob1"] != self.device_ids["bob2"]
                and self.ptids["alice"] != self.ptids["bob1"]
                and len({client.port for client in self.clients.values()}) == 3
                and len({client.storage_root for client in self.clients.values()}) == 3,
            )
            conversation_id = self.step(
                "conversation.open",
                self.open_conversation,
            )
            text = f"alice-to-bob-devices-{time.time_ns()}"
            self.step(
                "message.submitted",
                lambda: send_text(self.clients["alice"], text),
                "alice",
            )
            self.prove_delivery("bob1", text)
            self.prove_delivery("bob2", text)
            for actor in self.clients:
                self.save_screenshot(self.clients[actor], actor)
                self.save_dom(self.clients[actor], actor)
                self.save_app_log(self.clients[actor], actor)
        finally:
            for client in self.clients.values():
                try:
                    stop_client(client)
                except Exception:
                    client.stop()

        assertion_names = {assertion.name for assertion in self.report.assertions}
        missing = REQUIRED_ASSERTIONS - assertion_names
        if missing:
            raise GateError(f"required assertions are missing: {sorted(missing)}")
        return {
            "runtimeCell": "native-tauri-embedded-webdriver",
            "journey": "multi-device-direct-delivery",
            "testedCommit": self.tested_commit,
            "testedWorkspaceDigest": self.workspace_digest,
            "stationLive": version,
            "launchOrder": order,
            "conversationId": conversation_id,
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
                for actor in ("alice", "bob1", "bob2")
            },
        }


if __name__ == "__main__":
    raise SystemExit(NativeMultiDeviceGate().execute())
