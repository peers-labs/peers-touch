#!/usr/bin/env python3
"""Prove 24-word recovery phrase backup and history restore across reinstall."""

from __future__ import annotations

import json
import os
import random
import shutil
import time
from typing import Any, Callable

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from tooling.acceptance.core import (
    AcceptanceGate,
    ActorRuntime,
    GateError,
)
from tooling.acceptance.drivers.native import NativeDesktopRuntimeBinding
from tooling.acceptance.drivers.native.runtime import NativeLaunchOptions
from tooling.acceptance.drivers.tauri import TauriSession
from tooling.acceptance.gates.chat.native_support import (
    DEV_ACCOUNT_PASSWORD,
    NativeClientLifecycleLedger,
    async_harness,
    cleanup_preserving_primary_failure,
    commits_match,
    current_commit,
    current_workspace_digest,
    enter_chat_page,
    message_snapshot,
    native_runtime_source_identity,
    read_station_version,
    runtime_station_service,
    selected_native_runtime,
    send_text,
    verify_runtime_fixture_ready,
    wait_until,
)


REPORT_PATH = None
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


def selected_runtime() -> tuple[
    dict[str, Any],
    dict[str, Any],
    NativeDesktopRuntimeBinding,
] | None:
    selected = selected_native_runtime(NativeRecoveryGate.gate_id)
    if selected is None:
        return None
    return selected.manifest, selected.actor_manifest, selected.binding


class NativeRecoveryGate(AcceptanceGate):
    gate_id = "chat-native-recovery-e2e"
    phase = "MP-W08"
    bom = ("MP-G07", "MP-G08", "MP-G12")
    spec = ("chat-native-visible-clients",)
    report_path = REPORT_PATH
    evidence_dir = (
        REPORT_PATH.parent / "chat-native-recovery-evidence"
        if REPORT_PATH is not None
        else None
    )

    def __init__(
        self,
        *,
        manifest: dict[str, Any] | None = None,
        actor_manifest: dict[str, Any] | None = None,
        runtime_binding: NativeDesktopRuntimeBinding | None = None,
    ) -> None:
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
            station = runtime_station_service(manifest, "alice")
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
                str(client.get("id")): client
                for client in manifest.get("clients", [])
                if isinstance(client, dict)
            }
            self.actor_specs = {
                str(actor.get("role")): actor
                for actor in (actor_manifest or {}).get("actors", [])
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
            self.report.manifest = manifest
        else:
            raise GateError(
                "Native recovery requires provisioned runtime resources"
            )
            self.tested_commit = current_commit()
            self.workspace_digest = current_workspace_digest()
            self.client_specs: dict[str, dict[str, Any]] = {}
            self.actor_specs: dict[str, dict[str, Any]] = {}
        if not self.station_url:
            raise GateError("Native recovery Station URL is required")
        self.steps: list[dict[str, Any]] = []
        self.clients: dict[str, TauriSession] = {}
        self.runtime_instances: list[TauriSession] = []
        self.client_lifecycles = NativeClientLifecycleLedger()
        self.ptids: dict[str, str] = {}
        self.device_ids: dict[str, str] = {}
        self.report.station_url = self.station_url
        self.report.runtime.update(
            {
                "runtimeCell": (
                    runtime_binding.cell_id
                    if runtime_binding is not None
                    else "native-tauri-embedded-webdriver"
                ),
                "journey": "reinstall-24-word-recovery-restore",
                "steps": self.steps,
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

    def start_client(self, actor: str) -> None:
        if self.runtime_binding is None:
            raise GateError("Native Desktop runtime binding is required")
        self.start_injected_client(actor)

    def start_injected_client(self, actor: str) -> None:
        if self.runtime_binding is None:
            raise GateError("Native Desktop runtime binding is required")
        client = self.runtime_binding.create_bound_session(
            actor,
            NativeLaunchOptions(
                window_slot=("alice", "bob").index(actor),
                window_count=2,
            ),
        )
        self.runtime_instances.append(client)
        expected_ptid = str(self.actor_specs[actor].get("ptid") or "")
        self.client_lifecycles.register(client, expected_ptid)
        self.client_lifecycles.mark_live(client)
        self.register_driver(client)
        account_ref = str(
            self.actor_specs[actor].get("accountRef") or ""
        )
        login = async_harness(
            client,
            "loginWithPassword",
            {
                "account": account_ref.removeprefix("station-account:"),
                "password": DEV_ACCOUNT_PASSWORD,
            },
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
        if not client.get_current_url().startswith("tauri://localhost"):
            raise GateError(
                f"{actor} is not running in native Tauri WebView: "
                f"{client.get_current_url()}"
            )
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
                runtime=self.runtime_binding.cell_id,
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
        self.stop_authenticated_client(bob)
        self.start_injected_client("bob")
        new_bob = self.clients["bob"]
        if self.ptids["bob"] != str(
            self.actor_specs["bob"].get("ptid") or ""
        ):
            raise GateError("Bob identity changed after reinstall")
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

    def verify_fixture_ready(self) -> bool:
        verify_runtime_fixture_ready(
            self.manifest or {},
            self.actor_manifest or {},
        )
        return True

    def source_identity(
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
        self.assert_condition(
            "source_build_runtime_identity",
            True,
            json.dumps(identity, sort_keys=True),
        )
        self.report.runtime.update(
            {
                "runtimeCellRunId": runtime_cell.get("runId"),
                "sourceIdentity": identity,
            }
        )
        return identity

    def stop_authenticated_client(self, client: TauriSession) -> None:
        errors = self.client_lifecycles.release(client)
        if errors:
            raise GateError(json.dumps(errors, sort_keys=True))

    def cleanup_clients(self) -> dict[str, Any]:
        if self.runtime_binding is None:
            raise GateError("Native Desktop runtime binding is required")
        cleanup_errors: list[dict[str, str]] = []
        for client in reversed(self.runtime_instances):
            try:
                self.stop_authenticated_client(client)
            except Exception as error:
                cleanup_errors.append(
                    {
                        "resource": f"client:{client.profile}",
                        "error": str(error),
                    }
                )
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
        self.report.runtime["cleanup"] = cleanup
        if not cleanup_passed:
            raise GateError(
                "Native recovery cleanup failed: "
                f"{json.dumps(cleanup, sort_keys=True)}"
            )
        return cleanup

    def run(self) -> dict[str, Any]:
        if os.environ.get("CHAT_ACCEPTANCE_RESET") != "1":
            raise GateError("CHAT_ACCEPTANCE_RESET=1 is required")

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

        source_identity = self.source_identity(version)
        self.step(
            "fixture.reset",
            self.verify_fixture_ready,
        )
        order = ["alice", "bob"]
        random.SystemRandom().shuffle(order)
        cleanup: dict[str, Any] = {}
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
            cleanup = cleanup_preserving_primary_failure(
                self.cleanup_clients,
                self.report,
                "Native recovery",
            )
            self.report.runtime["steps"] = self.steps

        assertion_names = {assertion.name for assertion in self.report.assertions}
        missing = REQUIRED_ASSERTIONS - assertion_names
        if missing:
            raise GateError(f"required assertions are missing: {sorted(missing)}")
        return {
            "runtimeCell": (
                self.runtime_binding.cell_id
                if self.runtime_binding is not None
                else "native-tauri-embedded-webdriver"
            ),
            "journey": "reinstall-24-word-recovery-restore",
            "testedCommit": self.tested_commit,
            "testedWorkspaceDigest": self.workspace_digest,
            "stationLive": version,
            "sourceIdentity": source_identity,
            "launchOrder": order,
            "conversationId": conversation_id,
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


def main() -> int:
    runtime = selected_runtime()
    gate = (
        NativeRecoveryGate()
        if runtime is None
        else NativeRecoveryGate(
            manifest=runtime[0],
            actor_manifest=runtime[1],
            runtime_binding=runtime[2],
        )
    )
    return gate.execute()


if __name__ == "__main__":
    raise SystemExit(main())
