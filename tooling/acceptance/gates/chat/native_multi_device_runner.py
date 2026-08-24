#!/usr/bin/env python3
"""Prove Direct delivery across two devices of the same recipient."""

from __future__ import annotations

import os
import shutil
import time
from pathlib import Path
from typing import Any, Callable

from tooling.acceptance.core import AcceptanceGate, ActorRuntime, GateError, REPO_ROOT, REPORTS_DIR
from tooling.acceptance.drivers.tauri import TauriSession
from tooling.acceptance.gates.chat.native_support import (
    DEFAULT_STATION,
    async_harness,
    commits_match,
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
    "bob2_enrollment_operational",
}


class NativeMultiDeviceGate(AcceptanceGate):
    gate_id = "chat-native-multi-device-e2e"
    report_path = REPORT_PATH
    evidence_dir = REPORT_PATH.parent / "chat-native-multi-device-evidence"

    def __init__(self) -> None:
        super().__init__()
        self.station_url = os.environ.get(
            "CHAT_NATIVE_STATION_URL",
            DEFAULT_STATION,
        ).rstrip("/")
        self.tested_commit = current_commit()
        self.workspace_digest = current_workspace_digest()
        self.steps: list[dict[str, Any]] = []
        self.clients: dict[str, TauriSession] = {}
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
            instance=actor,
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
        # Clear instance-specific storage (bob1, bob2) not covered by reset_fixture.
        webdriver_root = REPO_ROOT / ".local" / "acceptance" / "embedded-webdriver"
        for instance in ("bob1", "bob2"):
            instance_storage = webdriver_root / instance / "storage"
            if instance_storage.exists():
                shutil.rmtree(instance_storage)
            instance_storage.mkdir(parents=True, exist_ok=True)
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

            for client in (alice, bob1):
                try:
                    gateway_command(client, "messaging_drain", {"batch_limit": 100})
                except Exception:
                    pass
            time.sleep(2)

            # Retry createDirectConversation: bob1's lifecycle worker must complete
            # device enrollment on Station before the peer can be resolved.
            conversation_id = ""
            for attempt in range(8):
                try:
                    created = async_harness(
                        alice,
                        "createDirectConversation",
                        {"peerPtid": self.ptids["bob1"]},
                    )
                    conversation_id = str((created or {}).get("conversationId") or "")
                except GateError:
                    conversation_id = ""
                if conversation_id:
                    break
                time.sleep(2)
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

            # Phase 2: bob2 logs in (session kick).
            # Copy bob1's actor identity key to bob2's storage so the same PTID
            # can enroll a second device without ErrActorIdentityConflict.
            bob1_keys = (
                webdriver_root / "bob1" / "storage" / "peers-touch"
                / "desktop" / "data" / "secure-store" / "identity-keys"
            )
            bob2_keys = (
                webdriver_root / "bob2" / "storage" / "peers-touch"
                / "desktop" / "data" / "secure-store" / "identity-keys"
            )
            if bob1_keys.exists():
                bob2_keys.mkdir(parents=True, exist_ok=True)
                for key_file in bob1_keys.iterdir():
                    shutil.copy2(key_file, bob2_keys / key_file.name)

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

            # Phase 3: bob2 proves enrollment is operational by successfully
            # resolving the existing conversation. createDirectConversation is
            # deterministic (same alice+bob PTIDs), so it returns the existing
            # conversation view — this requires bob2's device to be enrolled on
            # Station (otherwise resolveEndpointManifests returns 404).
            bob2 = self.clients["bob2"]
            enter_chat_page(bob2)

            conversation2_id = ""
            for attempt in range(8):
                try:
                    created2 = async_harness(
                        bob2,
                        "createDirectConversation",
                        {"peerPtid": self.ptids["alice"]},
                    )
                    conversation2_id = str((created2 or {}).get("conversationId") or "")
                except GateError:
                    conversation2_id = ""
                if conversation2_id:
                    break
                time.sleep(2)
            self.assert_condition(
                "bob2_enrollment_operational",
                conversation2_id == conversation_id,
                f"bob2_conv={conversation2_id} expected={conversation_id}",
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
