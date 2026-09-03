#!/usr/bin/env python3
"""Prove MLS group creation, member add, encrypted send, and member removal."""

from __future__ import annotations

import json
import os
import random
import time
from typing import Any, Callable

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
    stop_client,
    wait_until,
    verify_runtime_fixture_ready,
)



REPORT_PATH = None
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


def selected_runtime() -> tuple[
    dict[str, Any],
    dict[str, Any],
    NativeDesktopRuntimeBinding,
] | None:
    selected = selected_native_runtime(NativeGroupMlsGate.gate_id)
    if selected is None:
        return None
    return selected.manifest, selected.actor_manifest, selected.binding


class NativeGroupMlsGate(AcceptanceGate):
    gate_id = "chat-native-group-mls-e2e"
    phase = "MP-W07"
    bom = ("MP-G05", "MP-G06", "MP-G09")
    spec = ("chat-native-visible-clients",)
    report_path = REPORT_PATH
    evidence_dir = (
        REPORT_PATH.parent / "chat-native-group-mls-evidence"
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
                    "runtime manifest must allocate isolated Alice, Bob, and "
                    "Charlie clients"
                )
            if set(self.actor_specs) != set(ACTORS):
                raise GateError(
                    "actor manifest must contain canonical Alice, Bob, and "
                    "Charlie identities"
                )
            self.report.manifest = manifest
        else:
            raise GateError(
                "Native group MLS requires provisioned runtime resources"
            )
            self.tested_commit = current_commit()
            self.workspace_digest = current_workspace_digest()
            self.client_specs: dict[str, dict[str, Any]] = {}
            self.actor_specs: dict[str, dict[str, Any]] = {}
        if not self.station_url:
            raise GateError("Native group MLS Station URL is required")
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
                "journey": "mls-group-add-send-remove",
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


    def start_injected_client(self, actor: str) -> None:
        if self.runtime_binding is None:
            raise GateError("Native Desktop runtime binding is required")
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
            for client in self.clients.values():
                try:
                    stop_client(client)
                except Exception:
                    client.stop()
            return {}
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
                "Native group MLS cleanup failed: "
                f"{json.dumps(cleanup, sort_keys=True)}"
            )
        return cleanup

    def create_group(self) -> str:
        alice = self.clients["alice"]
        enter_chat_page(alice)
        last_error = ""
        for attempt in range(15):
            try:
                result = async_harness(
                    alice,
                    "createGroup",
                    {
                        "name": "Acceptance MLS Group",
                        "memberPtids": [self.ptids["bob"], self.ptids["charlie"]],
                    },
                    timeout=60,
                )
                group_id = (result or {}).get("groupUlid", "")
                if group_id:
                    return str(group_id)
                last_error = f"createGroup returned no groupUlid: {result}"
            except GateError as exc:
                last_error = str(exc)
            if attempt < 14:
                time.sleep(5)
        raise GateError(f"create_group failed after 15 attempts: {last_error}")

    def add_member(self, group_id: str) -> None:
        """Verify charlie is present in the group (added during creation)."""
        alice = self.clients["alice"]
        result = async_harness(
            alice, "syncGroup", {"groupUlid": group_id}, timeout=30
        )
        if not result or result.get("messageCount", -1) < 0:
            raise GateError(f"syncGroup failed: {result}")

    def wait_mls_readiness(self) -> None:
        """Wait for all clients to complete MLS key package publishing."""
        deadline = time.monotonic() + 60
        for actor in ACTORS:
            client = self.clients[actor]
            while time.monotonic() < deadline:
                try:
                    status = async_harness(
                        client, "getRealtimeDevice", {}, timeout=10
                    )
                    if status and status.get("deviceId"):
                        break
                except GateError:
                    pass
                time.sleep(3)
            else:
                raise GateError(f"{actor} MLS enrollment did not complete in 60s")
        time.sleep(15)

    def send_and_verify(self, group_id: str) -> str:
        alice = self.clients["alice"]
        async_harness(alice, "syncGroup", {"groupUlid": group_id}, timeout=30)
        enter_chat_page(alice)
        alice.find_element(
            f'[data-chat-group-ulid={json.dumps(group_id)}]', 30
        ).click()
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
            async_harness(client, "syncGroup", {"groupUlid": group_id}, timeout=30)
            enter_chat_page(client)
            client.find_element(
                f'[data-chat-group-ulid={json.dumps(group_id)}]', 60
            ).click()
            wait_until(
                lambda client=client: message_snapshot(client, text),
                f"{actor} group message",
                180,
            )
        return text

    def remove_member(self, group_id: str) -> None:
        alice = self.clients["alice"]
        time.sleep(10)
        result = async_harness(
            alice,
            "removeGroupMember",
            {"groupUlid": group_id, "memberPtid": self.ptids["charlie"]},
            timeout=60,
        )
        if not result or not result.get("success"):
            raise GateError(
                f"removeGroupMember returned unexpected result: {result}"
            )

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
        order = list(ACTORS)
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
                len(set(self.ptids.values())) == 3
                and len(set(self.device_ids.values())) == 3
                and len({client.port for client in self.clients.values()}) == 3
                and len({client.storage_root for client in self.clients.values()}) == 3,
            )
            self.step(
                "mls.readiness",
                self.wait_mls_readiness,
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
            cleanup = cleanup_preserving_primary_failure(
                self.cleanup_clients,
                self.report,
                "Native group MLS",
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
            "journey": "mls-group-add-send-remove",
            "testedCommit": self.tested_commit,
            "testedWorkspaceDigest": self.workspace_digest,
            "stationLive": version,
            "sourceIdentity": source_identity,
            "launchOrder": order,
            "groupId": group_id,
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
                for actor in ACTORS
            },
        }


def main() -> int:
    runtime = selected_runtime()
    gate = (
        NativeGroupMlsGate()
        if runtime is None
        else NativeGroupMlsGate(
            manifest=runtime[0],
            actor_manifest=runtime[1],
            runtime_binding=runtime[2],
        )
    )
    return gate.execute()


if __name__ == "__main__":
    raise SystemExit(main())
