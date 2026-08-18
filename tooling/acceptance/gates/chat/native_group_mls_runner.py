#!/usr/bin/env python3
"""Prove MLS group creation, member add, encrypted send, and member removal."""

from __future__ import annotations

import json
import os
import random
import time
from pathlib import Path
from typing import Any, Callable

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

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
    start_authenticated_client,
    stop_client,
    wait_until,
)


REPORT_PATH = Path(
    os.environ.get(
        "CHAT_NATIVE_GROUP_MLS_REPORT",
        str(REPORTS_DIR / "chat-native-group-mls-run.json"),
    )
)
CLIENT_PORTS = {"alice": 4445, "bob": 4446, "charlie": 4450}
ACTORS = ("alice", "bob", "charlie")
STEP_TIMEOUT = float(os.environ.get("CHAT_NATIVE_STEP_TIMEOUT_SECONDS", "120"))
REQUIRED_ASSERTIONS = {
    "native_runtime",
    "actor_isolation",
    "group_created",
    "member_added",
    "group_message_delivered",
    "member_removed",
}

SELECTORS = {
    "chat_nav": '[data-pt-primary-nav="chat"]',
    "new_menu": "[data-chat-new-menu]",
    "create_group_menu": "[data-chat-create-group-menu]",
    "create_group": "[data-chat-create-group]",
    "create_group_submit": "[data-chat-create-group-submit]",
    "group_ready": '[data-group-security="ready"]',
    "detail_toggle": "[data-chat-detail-toggle]",
    "group_add_open": "[data-chat-group-add-member-open]",
    "group_add_select": "[data-chat-group-add-member-select]",
    "group_add_submit": "[data-chat-group-add-member-submit]",
    "group_manage": "[data-chat-group-manage-members]",
}


class NativeGroupMlsGate(AcceptanceGate):
    gate_id = "chat-native-group-mls-e2e"
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

    def create_group(self) -> str:
        alice = self.clients["alice"]
        enter_chat_page(alice)
        alice.find_element(
            f'{SELECTORS["chat_nav"]} [role="button"]', 10
        ).click()
        alice.find_element(SELECTORS["new_menu"], 10).click()
        alice.find_element(SELECTORS["create_group_menu"], 10).click()
        WebDriverWait(alice.driver, 30).until(
            lambda driver: driver.find_element(
                By.CSS_SELECTOR, SELECTORS["create_group"]
            )
        )
        bob_selector = (
            f'[data-chat-create-group-contact='
            f'{json.dumps(self.ptids["bob"])}]'
        )
        alice.find_element(bob_selector, 10).click()
        alice.find_element(SELECTORS["create_group_submit"], 10).click()
        group_id = wait_until(
            lambda: alice.execute_script(
                "return document.querySelector('[data-chat-group-ulid]')"
                "?.getAttribute('data-chat-group-ulid')||''"
            ),
            "created MLS group",
            120,
        )
        if not group_id:
            raise GateError("Group creation returned no ID")
        return str(group_id)

    def add_member(self, group_id: str) -> None:
        alice = self.clients["alice"]
        alice.find_element(
            f'[data-chat-group-ulid={json.dumps(group_id)}]', 10
        ).click()
        WebDriverWait(alice.driver, 120).until(
            lambda driver: driver.find_element(
                By.CSS_SELECTOR, SELECTORS["group_ready"]
            )
        )
        alice.find_element(SELECTORS["detail_toggle"], 10).click()
        alice.find_element(SELECTORS["group_add_open"], 10).click()
        add_input = alice.find_element(SELECTORS["group_add_select"], 10)
        alice.execute_script(
            """
            const element = arguments[0];
            const value = arguments[1];
            const setter = Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype, 'value'
            )?.set;
            if (setter) setter.call(element, value);
            else element.value = value;
            element.dispatchEvent(new InputEvent('input', {
              bubbles: true, data: value, inputType: 'insertText',
            }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            """,
            add_input,
            self.ptids["charlie"],
        )
        alice.find_element(SELECTORS["group_add_submit"], 10).click()
        member_selector = (
            f'[data-chat-group-member='
            f'{json.dumps(self.ptids["charlie"])}]'
        )
        WebDriverWait(alice.driver, 120).until(
            lambda driver: driver.find_element(
                By.CSS_SELECTOR, member_selector
            )
        )

    def send_and_verify(self, group_id: str) -> str:
        alice = self.clients["alice"]
        text = f"three-device-mls-{time.time_ns()}"
        composer = alice.find_element(
            '[data-pt-text-input="chat-composer"]', 30
        )
        alice.execute_script(
            """
            const element = arguments[0];
            const value = arguments[1];
            const setter = Object.getOwnPropertyDescriptor(
              HTMLTextAreaElement.prototype, 'value'
            )?.set;
            if (!setter) throw new Error('textarea setter missing');
            setter.call(element, value);
            element.dispatchEvent(new InputEvent('input', {
              bubbles: true, data: value, inputType: 'insertText',
            }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            """,
            composer,
            text,
        )
        alice.find_element("[data-chat-send]", 10).click()
        for actor in ("bob", "charlie"):
            client = self.clients[actor]
            enter_chat_page(client)
            client.find_element(
                f'[data-chat-group-ulid={json.dumps(group_id)}]', 30
            ).click()
            WebDriverWait(client.driver, 120).until(
                lambda driver: driver.find_element(
                    By.CSS_SELECTOR, SELECTORS["group_ready"]
                )
            )
            wait_until(
                lambda client=client: message_snapshot(client, text),
                f"{actor} group message",
                120,
            )
        return text

    def remove_member(self, group_id: str) -> None:
        alice = self.clients["alice"]
        alice.find_element(SELECTORS["group_manage"], 10).click()
        remove_selector = (
            f'[data-chat-group-remove-member='
            f'{json.dumps(self.ptids["charlie"])}]'
        )
        alice.find_element(remove_selector, 10).click()

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

        self.step(
            "fixture.reset",
            lambda: reset_fixture(("alice", "bob", "charlie")),
        )
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
                len(set(self.ptids.values())) == 3
                and len(set(self.device_ids.values())) == 3
                and len({client.port for client in self.clients.values()}) == 3
                and len({client.storage_root for client in self.clients.values()}) == 3,
            )
            group_id = self.step(
                "group.create",
                self.create_group,
                "alice",
            )
            self.assert_condition("group_created", bool(group_id))

            self.step(
                "group.add_member",
                lambda: self.add_member(group_id),
                "alice",
            )
            self.assert_condition("member_added", True)

            text = self.step(
                "group.send_verify",
                lambda: self.send_and_verify(group_id),
                "alice",
            )
            self.assert_condition(
                "group_message_delivered",
                bool(text),
                f"text={text}",
            )

            self.step(
                "group.remove_member",
                lambda: self.remove_member(group_id),
                "alice",
            )
            self.assert_condition("member_removed", True)

            for actor in ACTORS:
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
            "journey": "mls-group-add-send-remove",
            "testedCommit": self.tested_commit,
            "testedWorkspaceDigest": self.workspace_digest,
            "stationLive": version,
            "launchOrder": order,
            "groupId": group_id,
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
    raise SystemExit(NativeGroupMlsGate().execute())
