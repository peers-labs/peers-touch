#!/usr/bin/env python3
"""Prove Direct delivery across two devices of the same recipient."""

from __future__ import annotations

import json
import os
import shutil
import time
from typing import Any, Callable

from tooling.acceptance.core import (
    AcceptanceGate,
    ActorRuntime,
    GateError,
    REPO_ROOT,
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
    stop_client,
    verify_runtime_fixture_ready,
    wait_until,
)


GATE_ID = "chat-native-multi-device-e2e"
REPORT_PATH = None
CLIENT_PORTS = {"alice": 4447, "bob1": 4448, "bob2": 4449}
CLIENT_ACTOR_ROLES = {
    "alice": "alice",
    "bob1": "bob",
    "bob2": "bob",
}
STEP_TIMEOUT = float(os.environ.get("CHAT_NATIVE_STEP_TIMEOUT_SECONDS", "120"))
REQUIRED_ASSERTIONS = {
    "native_runtime",
    "actor_isolation",
    "bob1_initial_delivery",
    "session_handoff",
    "bob2_enrollment_operational",
}


def selected_runtime() -> tuple[
    dict[str, Any],
    dict[str, Any],
    NativeDesktopRuntimeBinding,
] | None:
    selected = selected_native_runtime(GATE_ID)
    if selected is None:
        return None
    return selected.manifest, selected.actor_manifest, selected.binding


class NativeMultiDeviceGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "MP-W07"
    bom = ("MP-G05", "MP-G06")
    spec = ("chat-native-visible-clients",)
    report_path = REPORT_PATH
    evidence_dir = (
        REPORT_PATH.parent / "chat-native-multi-device-evidence"
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
            if set(self.client_specs) != set(CLIENT_ACTOR_ROLES):
                raise GateError(
                    "runtime manifest must allocate isolated Alice, Bob1, "
                    "and Bob2 clients"
                )
            if set(self.actor_specs) != {"alice", "bob"}:
                raise GateError(
                    "actor manifest must contain canonical Alice and Bob identities"
                )
            self.report.manifest = manifest
        else:
            raise GateError(
                "Native multi-device requires provisioned runtime resources"
            )
            self.tested_commit = current_commit()
            self.workspace_digest = current_workspace_digest()
            self.client_specs: dict[str, dict[str, Any]] = {}
            self.actor_specs: dict[str, dict[str, Any]] = {}
        if not self.station_url:
            raise GateError("Native multi-device Station URL is required")
        self.steps: list[dict[str, Any]] = []
        self.clients: dict[str, TauriSession] = {}
        self.runtime_instances: list[TauriSession] = []
        self.client_lifecycles = NativeClientLifecycleLedger()
        self.ptids: dict[str, str] = {}
        self.device_ids: dict[str, str] = {}
        self.cleanup_evidence: dict[str, Any] = {}
        self.source_evidence: dict[str, Any] = {}

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
        self.start_injected_client(actor)

    def start_injected_client(self, actor: str) -> None:
        if self.runtime_binding is None:
            raise GateError("Native Desktop runtime binding is required")
        actor_role = CLIENT_ACTOR_ROLES[actor]
        client = self.runtime_binding.create_bound_session(
            actor,
            NativeLaunchOptions(
                window_slot=tuple(CLIENT_ACTOR_ROLES).index(actor),
                window_count=len(CLIENT_ACTOR_ROLES),
            ),
        )
        self.runtime_instances.append(client)
        expected_ptid = str(
            self.actor_specs[actor_role].get("ptid") or ""
        )
        self.client_lifecycles.register(client, expected_ptid)
        self.client_lifecycles.mark_live(client)
        self.register_driver(client)
        account_ref = str(
            self.actor_specs[actor_role].get("accountRef") or ""
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

    def wait_for_revoked_identity(self, actor: str) -> dict[str, Any]:
        def revoked_identity() -> dict[str, Any] | None:
            value = async_harness(
                self.clients[actor],
                "identityState",
                {},
            )
            if not isinstance(value, dict):
                return None
            return (
                value
                if value.get("authenticated") is False
                and value.get("phase") in {"revoked", "accountGate"}
                and value.get("reason") == "revoked"
                else None
            )

        return wait_until(
            revoked_identity,
            f"{actor} authoritative session revocation",
        )

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
            cleanup["released"] = (
                bool(cleanup.get("portsReleased"))
                and bool(cleanup.get("processesReleased"))
                and bool(cleanup.get("storageReleased"))
                and bool(cleanup.get("logsReleased"))
                and not cleanup_errors
            )
            self.cleanup_evidence = cleanup
        else:
            self.cleanup_evidence = {
                "clientsStopped": sorted(self.clients),
                "cleanupErrors": cleanup_errors,
            }
        self.report.runtime.update(
            {
                "steps": self.steps,
                "cleanup": self.cleanup_evidence,
            }
        )
        if (
            self.runtime_binding is not None
            and not self.cleanup_evidence.get("released")
        ):
            raise GateError(
                "Native multi-device runtime cleanup failed: "
                f"{json.dumps(self.cleanup_evidence, sort_keys=True)}"
            )
        return self.cleanup_evidence

    def run(self) -> dict[str, Any]:
        if os.environ.get("CHAT_ACCEPTANCE_RESET") != "1":
            raise GateError("CHAT_ACCEPTANCE_RESET=1 is required")

        self.report.station_url = self.station_url
        version = self.step(
            "station.identity",
            lambda: read_station_version(self.station_url),
        )
        if self.runtime_binding is None:
            live_commit = str(version.get("build_commit") or "")
            if not commits_match(live_commit, self.tested_commit):
                raise GateError(
                    "Station/client commit mismatch: "
                    f"station={live_commit or 'missing'} "
                    f"client={self.tested_commit}"
                )
        else:
            self.source_evidence = self.validate_source_identity(version)

        self.step(
            "fixture.reset",
            self.verify_fixture_ready,
        )
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
            if self.runtime_binding is None:
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
            else:
                self.runtime_binding.clone_actor_storage(
                    "bob1",
                    self.client_specs["bob1"],
                    "bob2",
                    self.client_specs["bob2"],
                    "peers-touch/desktop/data/secure-store/identity-keys",
                )

            self.step(
                "client.authenticated",
                lambda: self.start_client("bob2"),
                "bob2",
            )
            bob1_revoked = self.step(
                "client.session-revoked",
                lambda: self.wait_for_revoked_identity("bob1"),
                "bob1",
            )
            self.client_lifecycles.mark_auth_revoked(bob1)
            self.assert_condition(
                "session_handoff",
                self.ptids["bob1"] == self.ptids["bob2"]
                and self.device_ids.get("bob1") != self.device_ids.get("bob2"),
                json.dumps(bob1_revoked, sort_keys=True),
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
            cleanup_preserving_primary_failure(
                self.cleanup_runtime,
                self.report,
                "Native multi-device",
            )

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
            "journey": "session-handoff-delivery",
            "testedCommit": self.tested_commit,
            "testedWorkspaceDigest": self.workspace_digest,
            "stationLive": version,
            "sourceIdentity": self.source_evidence,
            "conversationId": conversation_id,
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
                for actor in self.clients
            },
        }


if __name__ == "__main__":
    runtime = selected_runtime()
    gate = (
        NativeMultiDeviceGate()
        if runtime is None
        else NativeMultiDeviceGate(
            manifest=runtime[0],
            actor_manifest=runtime[1],
            runtime_binding=runtime[2],
        )
    )
    raise SystemExit(gate.execute())
