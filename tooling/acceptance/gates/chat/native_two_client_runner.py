#!/usr/bin/env python3
"""Prove Direct delivery and receipts through two native Tauri clients."""

from __future__ import annotations

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

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from tooling.acceptance.core import (
    AcceptanceGate,
    ActorRuntime,
    ArtifactRef,
    EvidenceStore,
    GateError,
    REPO_ROOT,
    REPORTS_DIR,
)
from tooling.acceptance.core.provisioning import load_runtime_manifest
from tooling.acceptance.drivers.native import NativeDesktopRuntimeBinding
from tooling.acceptance.drivers.native.runtime import NativeLaunchOptions
from tooling.acceptance.drivers.tauri import TauriDriver, TauriSession
from tooling.acceptance.gates.chat.native_support import (
    DEFAULT_STATION,
    DEV_ACCOUNT_PASSWORD,
    NativeClientLifecycleLedger,
    async_harness,
    configure_station,
    commits_match,
    enter_chat_page,
    reset_fixture,
    runtime_station_service,
    start_authenticated_client,
    stop_client,
)


REPORT_PATH = Path(
    os.environ.get(
        "CHAT_NATIVE_TWO_CLIENT_REPORT",
        str(REPORTS_DIR / "chat-native-two-client-run.json"),
    )
)
STEP_TIMEOUT = float(os.environ.get("CHAT_NATIVE_STEP_TIMEOUT_SECONDS", "120"))
CLIENT_PORTS = {"alice": 4445, "bob": 4446}
REQUIRED_ASSERTIONS = {
    "native_runtime",
    "actor_isolation",
    "alice_to_bob_plaintext",
    "alice_to_bob_delivered",
    "bob_to_alice_plaintext",
    "bob_to_alice_delivered",
}


def current_commit() -> str:
    return subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=REPO_ROOT,
        check=True,
        text=True,
        capture_output=True,
    ).stdout.strip()


def current_workspace_digest() -> str:
    digest = hashlib.sha256()
    digest.update(
        subprocess.run(
            ["git", "diff", "--binary", "HEAD"],
            cwd=REPO_ROOT,
            check=True,
            capture_output=True,
        ).stdout
    )
    untracked = subprocess.run(
        ["git", "ls-files", "--others", "--exclude-standard", "-z"],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
    ).stdout.split(b"\0")
    for raw_path in sorted(path for path in untracked if path):
        digest.update(raw_path)
        digest.update(b"\0")
        digest.update((REPO_ROOT / raw_path.decode("utf-8")).read_bytes())
    return digest.hexdigest()


def commits_match(live_commit: str, tested_commit: str) -> bool:
    return (
        len(live_commit) >= 7
        and len(tested_commit) >= 7
        and (
            live_commit.startswith(tested_commit)
            or tested_commit.startswith(live_commit)
        )
    )


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


def send_text(client: TauriDriver, text: str) -> dict[str, Any]:
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
    )


def message_snapshot(client: TauriDriver, text: str) -> dict[str, Any] | None:
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


class NativeTwoClientGate(AcceptanceGate):
    gate_id = "chat-native-two-client-e2e"
    report_path = REPORT_PATH

    def __init__(self) -> None:
        super().__init__()
        self.manifest = manifest
        self.actor_manifest = actor_manifest
        self.runtime_binding = runtime_binding
        if manifest is not None:
            station = runtime_station_service(manifest)
            self.station_url = str(station.get("endpoint") or "").rstrip("/")
            if not self.station_url:
                raise GateError("runtime manifest Station URL is required")
            self.client_specs = {
                str(client.get("actor")): client
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
            self.tested_commit = current_commit()
            self.workspace_digest = current_workspace_digest()
        else:
            self.station_url = os.environ.get(
                "CHAT_NATIVE_STATION_URL",
                DEFAULT_STATION,
            ).rstrip("/")
            self.tested_commit = current_commit()
            self.workspace_digest = current_workspace_digest()
            self.client_specs: dict[str, dict[str, Any]] = {}
            self.actor_specs: dict[str, dict[str, Any]] = {}
        self.steps: list[dict[str, Any]] = []
        self.clients: dict[str, TauriSession] = {}
        self.runtime_instances: list[TauriSession] = []
        self.client_lifecycles = NativeClientLifecycleLedger()
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

    def verify_fixture_ready(self) -> bool:
        reset = self.actor_manifest.get("reset")
        if (
            self.manifest.get("state") != "FIXTURE_READY"
            or not isinstance(reset, dict)
            or reset.get("authorized") is not True
            or reset.get("targetVerified") is not True
        ):
            raise GateError(
                "runtime manifest fixture is not reset and verified"
            )
        return True

    def source_identity(
        self,
        station_live: dict[str, Any],
    ) -> dict[str, Any]:
        source = self.manifest.get("source")
        station = runtime_station_service(self.manifest)
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

    def start_client(self, actor: str) -> None:
        if self.runtime_binding is not None:
            spec = self.client_specs[actor]
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
            client.start()
            self.client_lifecycles.mark_live(client)
            self.register_driver(client)
            client.wait_for_acceptance_harness(30)
            configure_station(client, self.station_url)
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
        else:
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
            and bool(received.get("messageUlid")),
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

    def collect_client_evidence(self, actor: str) -> None:
        client = self.clients[actor]
        self.save_screenshot(client, actor)
        self.save_dom(client, actor)
        self.save_app_log(client, actor)

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
                and len({client.gateway_port for client in self.clients.values()}) == 2
                and len({client.storage_root for client in self.clients.values()}) == 2,
            )
            conversation_id = self.step(
                "conversation.open",
                self.open_conversation,
            )
            self.prove_direction("alice", "bob")
            self.prove_direction("bob", "alice")
            for actor in ("alice", "bob"):
                self.collect_client_evidence(actor)
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
            "journey": "direct-delivered-receipt",
            "testedCommit": self.tested_commit,
            "testedWorkspaceDigest": self.workspace_digest,
            "stationLive": version,
            "launchOrder": order,
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
    raise SystemExit(NativeTwoClientGate().execute())
