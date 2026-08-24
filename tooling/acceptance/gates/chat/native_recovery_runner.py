#!/usr/bin/env python3
"""Prove 24-word recovery phrase backup and history restore across reinstall."""

from __future__ import annotations

import os
import random
import shutil
import time
from pathlib import Path
from typing import Any, Callable

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from tooling.acceptance.core import AcceptanceGate, ActorRuntime, GateError, REPORTS_DIR
from tooling.acceptance.drivers.tauri import TauriSession
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
        "CHAT_NATIVE_RECOVERY_REPORT",
        str(REPORTS_DIR / "chat-native-recovery-run.json"),
    )
)
CLIENT_PORTS = {"alice": 4445, "bob": 4446}
STEP_TIMEOUT = float(os.environ.get("CHAT_NATIVE_STEP_TIMEOUT_SECONDS", "120"))
REQUIRED_ASSERTIONS = {
    "native_runtime",
    "actor_isolation",
    "alice_to_bob_plaintext",
    "alice_to_bob_delivered",
    "recovery_phrase_valid",
    "reinstall_restore",
}

SELECTORS = {
    "settings_nav": '[data-pt-primary-nav="settings"]',
    "security_section": '[data-pt-section-item="security"]',
    "recovery_generate": "[data-recovery-generate]",
    "recovery_reveal": "[data-recovery-reveal]",
    "recovery_backup": "[data-recovery-backup-create]",
    "recovery_restore_open": "[data-recovery-restore-open]",
    "recovery_restore_input": "[data-recovery-restore-input]",
    "recovery_restore_submit": "[data-recovery-restore-submit]",
}


class NativeRecoveryGate(AcceptanceGate):
    gate_id = "chat-native-recovery-e2e"
    report_path = REPORT_PATH
    evidence_dir = REPORT_PATH.parent / "chat-native-recovery-evidence"

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

    def open_conversation(self) -> str:
        alice = self.clients["alice"]
        bob = self.clients["bob"]
        for client in (alice, bob):
            enter_chat_page(client)
        created = async_harness(
            alice,
            "createDirectConversation",
            {"peerPtid": self.ptids["bob"]},
        )
        conversation_id = str((created or {}).get("conversationId") or "")
        if not conversation_id:
            raise GateError("Direct conversation creation returned no ID")
        for client in (alice, bob):
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

    def prove_initial_delivery(self, text: str) -> None:
        alice = self.clients["alice"]
        bob = self.clients["bob"]
        self.step(
            "message.submitted",
            lambda: send_text(alice, text),
            "alice",
        )
        received = self.step(
            "message.received",
            lambda: wait_until(
                lambda: message_snapshot(bob, text),
                "bob exact plaintext",
            ),
            "bob",
        )
        self.assert_condition(
            "alice_to_bob_plaintext",
            text in str(received.get("text") or "")
            and bool(received.get("messageUlid")),
            f"message_id={received.get('messageUlid', '')}",
        )
        delivered = self.step(
            "receipt.delivered",
            lambda: wait_until(
                lambda: (
                    snapshot
                    if (snapshot := message_snapshot(alice, text))
                    and snapshot.get("receipt") in {"delivered", "read"}
                    else None
                ),
                "alice delivered receipt",
            ),
            "alice",
        )
        self.assert_condition(
            "alice_to_bob_delivered",
            delivered.get("receipt") in {"delivered", "read"},
            f"receipt={delivered.get('receipt', '')}",
        )

    def generate_recovery_phrase(self) -> str:
        bob = self.clients["bob"]
        bob.find_element(SELECTORS["settings_nav"], 30).click()
        bob.find_element(SELECTORS["security_section"], 10).click()
        WebDriverWait(bob.driver, 30).until(
            lambda driver: driver.find_element(
                By.CSS_SELECTOR,
                SELECTORS["recovery_generate"],
            )
        )
        bob.find_element(SELECTORS["recovery_generate"], 10).click()
        bob.find_element(SELECTORS["recovery_reveal"], 10).click()
        phrase = str(
            bob.execute_script(
                "return Array.from(document.querySelectorAll("
                "'[data-recovery-phrase] span:last-child')"
                ").map(e=>e.textContent?.trim()).filter(Boolean).join(' ')"
            )
            or ""
        )
        words = phrase.split()
        if len(words) != 24:
            raise GateError(
                f"recovery phrase must contain 24 words, got {len(words)}"
            )
        bob.find_element(SELECTORS["recovery_backup"], 10).click()
        return phrase

    def reinstall_and_restore(self, phrase: str, text: str, conversation_id: str = "") -> None:
        bob = self.clients["bob"]
        bob_storage = bob.storage_root
        stop_client(bob)
        shutil.rmtree(bob_storage, ignore_errors=True)
        new_bob, ptid = start_authenticated_client(
            "bob",
            CLIENT_PORTS["bob"],
            self.station_url,
        )
        self.register_driver(new_bob)
        if ptid != self.ptids["bob"]:
            raise GateError("Bob identity changed after reinstall")
        self.clients["bob"] = new_bob
        new_bob.find_element(SELECTORS["settings_nav"], 30).click()
        new_bob.find_element(SELECTORS["security_section"], 10).click()
        WebDriverWait(new_bob.driver, 30).until(
            lambda driver: driver.find_element(
                By.CSS_SELECTOR,
                SELECTORS["recovery_restore_open"],
            )
        )
        new_bob.find_element(SELECTORS["recovery_restore_open"], 10).click()
        restore_input = new_bob.find_element(
            SELECTORS["recovery_restore_input"], 10
        )
        new_bob.execute_script(
            """
            const element = arguments[0];
            const value = arguments[1];
            const setter = Object.getOwnPropertyDescriptor(
              HTMLTextAreaElement.prototype, 'value'
            )?.set || Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype, 'value'
            )?.set;
            if (setter) setter.call(element, value);
            else element.value = value;
            element.dispatchEvent(new InputEvent('input', {
              bubbles: true, data: value, inputType: 'insertText',
            }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            """,
            restore_input,
            phrase,
        )
        new_bob.find_element(SELECTORS["recovery_restore_submit"], 10).click()
        enter_chat_page(new_bob)
        for attempt in range(8):
            try:
                async_harness(
                    new_bob,
                    "syncFriendSession",
                    {"sessionUlid": conversation_id},
                )
                break
            except GateError:
                if attempt == 7:
                    raise
                time.sleep(3)
        restored = wait_until(
            lambda: message_snapshot(new_bob, text),
            "restored exact plaintext after reinstall",
            120,
        )
        self.assert_condition(
            "reinstall_restore",
            text in str(restored.get("text") or "")
            and bool(restored.get("messageUlid")),
            f"message_id={restored.get('messageUlid', '')}",
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

        self.step("fixture.reset", reset_fixture)
        order = ["alice", "bob"]
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
                len(set(self.ptids.values())) == 2
                and len(set(self.device_ids.values())) == 2
                and len({client.port for client in self.clients.values()}) == 2
                and len({client.storage_root for client in self.clients.values()}) == 2,
            )
            conversation_id = self.step(
                "conversation.open",
                self.open_conversation,
            )
            text = f"recovery-history-{time.time_ns()}"
            self.prove_initial_delivery(text)

            phrase = self.step(
                "recovery.generate",
                self.generate_recovery_phrase,
                "bob",
            )
            self.assert_condition(
                "recovery_phrase_valid",
                len(phrase.split()) == 24,
                f"word_count={len(phrase.split())}",
            )
            self.step(
                "recovery.reinstall_restore",
                lambda: self.reinstall_and_restore(phrase, text, conversation_id),
                "bob",
            )
            for actor in ("alice", "bob"):
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
            "journey": "reinstall-24-word-recovery-restore",
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
                for actor in ("alice", "bob")
            },
        }


if __name__ == "__main__":
    raise SystemExit(NativeRecoveryGate().execute())
