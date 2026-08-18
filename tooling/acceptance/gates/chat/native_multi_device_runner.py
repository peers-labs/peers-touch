#!/usr/bin/env python3
"""Prove Direct delivery across two devices of the same recipient."""

from __future__ import annotations

import os
import random
import time
from pathlib import Path
from typing import Any, Callable

from tooling.acceptance.core import AcceptanceGate, ActorRuntime, GateError, REPORTS_DIR, REPO_ROOT
from tooling.acceptance.drivers.station import StationDriver
from tooling.acceptance.drivers.tauri import TauriDriver
from tooling.acceptance.gates.chat.native_support import (
    ACCOUNTS,
    DEFAULT_STATION,
    DEV_ACCOUNT_PASSWORD,
    async_harness,
    commits_match,
    configure_station,
    current_commit,
    current_workspace_digest,
    enter_chat_page,
    gateway_command,
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
    "bob1_initial_delivery",
    "session_handoff",
    "bob2_post_handoff_delivery",
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
        storage = (
            REPO_ROOT
            / ".local"
            / "acceptance"
            / "embedded-webdriver"
            / actor
            / "storage"
        )
        storage.mkdir(parents=True, exist_ok=True)
        client = TauriDriver(
            port=CLIENT_PORTS[actor],
            profile=f"acceptance-{actor}",
            storage_root=str(storage),
            environment={"PEERS_STATION_URL": self.station_url},
        )
        client.start()
        try:
            client.wait_for_acceptance_harness(30)
            configure_station(client, self.station_url)
            with StationDriver(
                f"http://127.0.0.1:{client.gateway_port}"
            ) as station:
                station.auth_logout()
            login = async_harness(
                client,
                "loginWithPassword",
                {
                    "account": ACCOUNTS[account],
                    "password": DEV_ACCOUNT_PASSWORD,
                },
                timeout=30,
            )
            ptid = str((login or {}).get("actorId") or "")
            if not (login or {}).get("authenticated") or not ptid.startswith("ptid:"):
                raise GateError(
                    f"{account} login did not return canonical PTID: {login}"
                )
        except Exception:
            client.stop()
            raise
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
        try:
            # Phase 1: alice + bob1 — verify initial delivery
            for actor in ("alice", "bob1"):
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
                self.ptids["alice"] != self.ptids["bob1"]
                and len({client.storage_root for client in self.clients.values()}) == 2,
            )

            alice = self.clients["alice"]
            bob1 = self.clients["bob1"]
            enter_chat_page(alice)
            enter_chat_page(bob1)
            created = async_harness(
                alice,
                "createDirectConversation",
                {"peerPtid": self.ptids["bob1"]},
            )
            conversation_id = str((created or {}).get("conversationId") or "")
            if not conversation_id:
                raise GateError("Direct conversation creation returned no ID")
            async_harness(alice, "syncFriendSession", {"sessionUlid": conversation_id})
            async_harness(bob1, "syncFriendSession", {"sessionUlid": conversation_id})

            text1 = f"pre-handoff-{time.time_ns()}"
            send_text(alice, text1)
            received1 = wait_until(
                lambda: message_snapshot(bob1, text1),
                "bob1 pre-handoff delivery",
            )
            self.assert_condition(
                "bob1_initial_delivery",
                text1 in str(received1.get("text") or "")
                and bool(received1.get("messageUlid")),
            )

            # Phase 2: bob2 logs in (session kick)
            self.step(
                "client.authenticated",
                lambda: self.start_client("bob2"),
                "bob2",
            )
            self.assert_condition(
                "session_handoff",
                self.ptids["bob1"] == self.ptids["bob2"]
                and self.device_ids.get("bob1") != self.device_ids.get("bob2"),
            )

            # Phase 3: verify delivery to bob2 (active session)
            bob2 = self.clients["bob2"]
            enter_chat_page(bob2)
            async_harness(bob2, "syncFriendSession", {"sessionUlid": conversation_id})

            text2 = f"post-handoff-{time.time_ns()}"
            send_text(alice, text2)

            for _ in range(5):
                try:
                    gateway_command(bob2, "messaging_drain", {"batch_limit": 100})
                except Exception:
                    pass
                time.sleep(1)

            async_harness(bob2, "syncFriendSession", {"sessionUlid": conversation_id})
            received2 = wait_until(
                lambda: message_snapshot(bob2, text2),
                "bob2 post-handoff delivery",
            )
            self.assert_condition(
                "bob2_post_handoff_delivery",
                text2 in str(received2.get("text") or "")
                and bool(received2.get("messageUlid")),
            )

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
            "journey": "session-handoff-delivery",
            "testedCommit": self.tested_commit,
            "testedWorkspaceDigest": self.workspace_digest,
            "stationLive": version,
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
                for actor in self.clients
            },
        }


if __name__ == "__main__":
    raise SystemExit(NativeMultiDeviceGate().execute())
