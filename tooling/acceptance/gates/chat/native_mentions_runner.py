#!/usr/bin/env python3
"""Prove E2EE group @mentions across two isolated native Tauri clients.

Journey (one Station, two actors, one MLS group):

* Alice (owner) creates a group containing Bob.
* Bob mutes the group and parks the conversation (surface not active).
* Alice sends an in-ciphertext named @mention of Bob; Bob must surface the
  yellow mention marker and decrypted chip even though the group is muted.
* Opening the group clears the marker and shows the mention chip in the
  decrypted bubble.
* Alice sends @all (owner-only); Bob again gets the muted-exception marker
  and the projection carries mentionAll.
"""

from __future__ import annotations

import os
import time
from typing import Any, Callable

from tooling.acceptance.core import AcceptanceGate, ActorRuntime, GateError
from tooling.acceptance.drivers.native import NativeDesktopRuntimeBinding
from tooling.acceptance.drivers.native.runtime import NativeLaunchOptions
from tooling.acceptance.drivers.tauri import TauriSession
from tooling.acceptance.gates.chat.native_support import (
    DEV_ACCOUNT_PASSWORD,
    NativeClientLifecycleLedger,
    async_harness,
    cleanup_preserving_primary_failure,
    enter_chat_page,
    is_native_tauri_url,
    native_runtime_source_identity,
    read_station_version,
    runtime_station_service,
    shared_federation_id,
    verify_runtime_fixture_ready,
    wait_until,
)


GATE_ID = "chat-native-mentions-e2e"
REPORT_PATH = None
ACTORS = ("alice", "bob")
STEP_TIMEOUT = float(os.environ.get("CHAT_NATIVE_STEP_TIMEOUT_SECONDS", "120"))
REQUIRED_ASSERTIONS = {
    "native_runtime",
    "actor_isolation",
    "group_created",
    "named_mention_projected",
    "muted_group_mention_marker",
    "mention_chip_rendered",
    "marker_cleared_on_open",
    "all_mention_owner_only",
    "muted_all_mention_marker",
    "resources_released",
}


def selected_runtime() -> tuple[
    dict[str, Any],
    dict[str, Any],
    NativeDesktopRuntimeBinding,
] | None:
    from tooling.acceptance.gates.chat.native_support import selected_native_runtime

    selected = selected_native_runtime(GATE_ID)
    if selected is None:
        return None
    return selected.manifest, selected.actor_manifest, selected.binding


def park(client: TauriSession) -> None:
    result = async_harness(client, "parkConversation", {})
    if not isinstance(result, dict) or result.get("parked") is not True:
        raise GateError("conversation park did not settle")


def set_muted(client: TauriSession, conversation_id: str, muted: bool) -> None:
    result = async_harness(
        client,
        "setConversationMuted",
        {"conversationId": conversation_id, "muted": muted},
    )
    if not isinstance(result, dict) or result.get("muted") != muted:
        raise GateError(f"mute projection did not settle to {muted}")


def mention_flag(client: TauriSession, conversation_id: str) -> dict[str, Any]:
    result = async_harness(
        client,
        "mentionFlagState",
        {"conversationId": conversation_id},
    )
    if not isinstance(result, dict):
        raise GateError("mention flag state invalid")
    return result


def marker_visible(client: TauriSession) -> bool:
    return bool(
        client.execute_script(
            """
            return Boolean(document.querySelector('[data-chat-mention-marker]'));
            """,
        )
    )


def bubble_chip(client: TauriSession, message_id: str, actor_ptid: str) -> bool:
    return bool(
        client.execute_script(
            """
            const messageId = arguments[0];
            const actorPtid = arguments[1];
            const row = document.querySelector(
              `[data-message-ulid="${messageId}"]`
            );
            if (!row) return false;
            return Array.from(row.querySelectorAll('[data-chat-mention]')).some(
              (chip) => chip.getAttribute('data-mention-actor') === actorPtid
            );
            """,
            message_id,
            actor_ptid,
        )
    )


def all_chip(client: TauriSession, message_id: str) -> bool:
    return bool(
        client.execute_script(
            """
            const messageId = arguments[0];
            const row = document.querySelector(
              `[data-message-ulid="${messageId}"]`
            );
            if (!row) return false;
            return Array.from(row.querySelectorAll('[data-chat-mention]')).length > 0;
            """,
            message_id,
        )
    )


class NativeMentionsGate(AcceptanceGate):
    gate_id = GATE_ID
    phase = "MP-W12"
    bom = ("MP-G16",)
    spec = ("AS-W12-07",)
    report_path = REPORT_PATH
    evidence_dir = (
        REPORT_PATH.parent / "chat-native-mentions-evidence"
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
        selected_cell = os.environ.get("PT_ACCEPTANCE_RUNTIME_CELL", "").strip()
        if selected_cell and runtime_binding is None:
            raise GateError("selected runtime cell requires injected resources")
        if (
            selected_cell
            and runtime_binding is not None
            and runtime_binding.cell_id != selected_cell
        ):
            raise GateError(
                "injected runtime binding does not match "
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
            if set(self.client_specs) != set(ACTORS):
                raise GateError(
                    "runtime manifest must allocate isolated Alice and Bob clients"
                )
            if set(self.actor_specs) != set(ACTORS):
                raise GateError(
                    "actor manifest must contain canonical Alice and Bob identities"
                )
            self.report.manifest = manifest
        else:
            raise GateError("Native mentions require provisioned runtime resources")
        if not self.station_url:
            raise GateError("Native mentions Station URL is required")
        self.steps: list[dict[str, Any]] = []
        self.clients: dict[str, TauriSession] = {}
        self.runtime_instances: list[TauriSession] = []
        self.client_lifecycles = NativeClientLifecycleLedger()
        self.ptids: dict[str, str] = {}
        self.device_ids: dict[str, str] = {}
        self.group_id = ""

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
        if self.runtime_binding is None:
            raise GateError("runtime binding required")
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
        account_ref = str(self.actor_specs[actor].get("accountRef") or "")
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
                f"{actor} identity mismatch expected={expected_ptid} actual={ptid}"
            )
        device = wait_until(
            lambda: (
                device
                if (
                    device := async_harness(
                        client,
                        "getRealtimeDevice",
                        {},
                        timeout=10,
                    )
                )
                and str(device.get("actorPtid") or "") == expected_ptid
                and str(device.get("deviceId") or "")
                else None
            ),
            f"active messaging device for {actor}",
            timeout=60,
        )
        self.client_lifecycles.mark_authenticated(client)
        if not is_native_tauri_url(client.get_current_url()):
            raise GateError(f"{actor} is not running in native Tauri WebView")
        self.clients[actor] = client
        self.ptids[actor] = ptid
        self.device_ids[actor] = str((device or {}).get("deviceId") or "")
        if not self.device_ids[actor]:
            raise GateError(f"{actor}: messaging device ID missing")
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
        enter_chat_page(client)

    def verify_fixture_ready(self) -> bool:
        verify_runtime_fixture_ready(self.manifest or {}, self.actor_manifest or {})
        return True

    def validate_source_identity(self, station_live: dict[str, Any]) -> dict[str, Any]:
        if self.runtime_binding is None or self.manifest is None:
            return {}
        identity = native_runtime_source_identity(
            gate_id=self.gate_id,
            manifest=self.manifest,
            runtime_binding=self.runtime_binding,
            station_live=station_live,
        )
        self.report.runtime.update(
            {
                "runtimeCellRunId": identity["runtimeCell"].get("runId"),
                "sourceIdentity": identity,
            }
        )
        return identity

    def sync_group(self, actor: str, group_id: str) -> dict[str, Any]:
        def ready() -> dict[str, Any] | None:
            result = async_harness(
                self.clients[actor],
                "syncGroup",
                {"groupUlid": group_id},
                timeout=30,
            )
            if not isinstance(result, dict):
                return None
            members = sorted(
                str(member)
                for member in result.get("memberPtids", [])
                if member
            )
            return result if members == sorted(self.ptids.values()) else None

        return wait_until(
            ready,
            f"{actor} projected group {group_id}",
            STEP_TIMEOUT,
            1,
        )

    def cleanup_runtime(self) -> dict[str, Any]:
        cleanup_errors: list[dict[str, str]] = []
        if self.runtime_binding is not None:
            cleanup_errors.extend(self.client_lifecycles.release_all())
            for client in self.runtime_instances:
                try:
                    client.stop()
                except Exception as error:  # noqa: BLE001
                    cleanup_errors.append(
                        {"resource": f"client:{client.profile}", "error": str(error)}
                    )
            try:
                cleanup = self.runtime_binding.finalize_cleanup(
                    self.runtime_instances,
                    self.client_specs,
                )
            except Exception as error:  # noqa: BLE001
                cleanup = {"cleanupErrors": [{"error": str(error)}]}
            binding_errors = cleanup.get("cleanupErrors")
            if isinstance(binding_errors, list):
                cleanup_errors.extend(
                    error
                    for error in binding_errors
                    if isinstance(error, dict)
                )
            cleanup["cleanupErrors"] = cleanup_errors
            released = (
                bool(cleanup.get("portsReleased"))
                and bool(cleanup.get("processesReleased"))
                and bool(cleanup.get("storageReleased"))
                and bool(cleanup.get("logsReleased"))
                and not cleanup_errors
            )
            self.cleanup_evidence = cleanup
        else:
            released = False
            self.cleanup_evidence = {}
        self.report.runtime.update(
            {"steps": self.steps, "cleanup": self.cleanup_evidence}
        )
        self.assert_condition("resources_released", released)
        return self.cleanup_evidence

    def run(self) -> dict[str, Any]:
        if self.runtime_binding is None:
            raise GateError("provisioned runtime binding required")
        self.report.station_url = self.station_url
        version = self.step(
            "station.identity",
            lambda: read_station_version(self.station_url),
        )
        self.source_evidence = self.validate_source_identity(version)
        self.step("fixture.reset", self.verify_fixture_ready)
        named_message_id = ""
        all_message_id = ""
        try:
            for actor in ACTORS:
                self.step(
                    "client.authenticated",
                    lambda actor=actor: self.start_client(actor),
                    actor,
                )
            self.assert_condition(
                "native_runtime",
                all(
                    is_native_tauri_url(client.get_current_url())
                    for client in self.clients.values()
                ),
            )
            self.assert_condition(
                "actor_isolation",
                len(set(self.ptids.values())) == len(ACTORS)
                and len(set(self.client_specs)) == len(ACTORS)
                and len(
                    {client.storage_root for client in self.clients.values()}
                )
                == len(ACTORS),
            )
            federation_id = self.step(
                "federation.shared",
                lambda: shared_federation_id(self.clients, ACTORS),
            )

            group = async_harness(
                self.clients["alice"],
                "createGroup",
                {
                    "name": f"mentions-{time.time_ns()}",
                    "federationId": federation_id,
                    "memberPtids": [self.ptids["bob"]],
                },
            )
            self.group_id = str((group or {}).get("groupUlid") or "")
            if not self.group_id:
                raise GateError("group creation returned no id")
            for actor in ACTORS:
                self.sync_group(actor, self.group_id)
            self.assert_condition("group_created", bool(self.group_id))

            # ── Named @mention under mute ─────────────────────────────────
            self.step(
                "bob.mute",
                lambda: set_muted(self.clients["bob"], self.group_id, True),
                "bob",
            )
            self.step(
                "bob.park",
                lambda: park(self.clients["bob"]),
                "bob",
            )
            unique = time.time_ns()
            content = f"@Bob mention-{unique}"
            sent = self.step(
                "alice.send_named_mention",
                lambda: async_harness(
                    self.clients["alice"],
                    "sendGroupMention",
                    {
                        "conversationId": self.group_id,
                        "content": content,
                        "mentions": [
                            {
                                "actorPtid": self.ptids["bob"],
                                "offset": 0,
                                "length": 4,
                                "display": "Bob",
                            }
                        ],
                        "mentionAll": False,
                    },
                    timeout=60,
                ),
                "alice",
            )
            projection = (sent or {}).get("projection") or {}
            named_message_id = str(projection.get("messageId") or "")
            named_mentions = projection.get("mentions") or []
            self.assert_condition(
                "named_mention_projected",
                bool(named_message_id)
                and any(
                    mention.get("actorPtid") == self.ptids["bob"]
                    and int(mention.get("offset") or -1) == 0
                    and int(mention.get("length") or 0) == 4
                    for mention in named_mentions
                ),
                f"projection={projection}",
            )

            self.step(
                "bob.muted_marker",
                lambda: wait_until(
                    lambda: mention_flag(
                        self.clients["bob"], self.group_id
                    ).get("mentioned")
                    is True
                    and marker_visible(self.clients["bob"]),
                    "Bob muted mention marker",
                    STEP_TIMEOUT,
                    1,
                ),
                "bob",
            )
            self.assert_condition(
                "muted_group_mention_marker",
                mention_flag(self.clients["bob"], self.group_id).get("mentioned")
                is True,
            )

            # Opening the group clears the marker and renders the chip.
            self.sync_group("bob", self.group_id)
            self.step(
                "bob.marker_cleared",
                lambda: wait_until(
                    lambda: mention_flag(
                        self.clients["bob"], self.group_id
                    ).get("mentioned")
                    is False,
                    "Bob marker cleared on open",
                    STEP_TIMEOUT,
                    1,
                ),
                "bob",
            )
            self.assert_condition(
                "marker_cleared_on_open",
                mention_flag(self.clients["bob"], self.group_id).get("mentioned")
                is False,
            )
            self.step(
                "bob.chip_rendered",
                lambda: wait_until(
                    lambda: bubble_chip(
                        self.clients["bob"],
                        named_message_id,
                        self.ptids["bob"],
                    ),
                    "Bob mention chip in decrypted bubble",
                    STEP_TIMEOUT,
                    1,
                ),
                "bob",
            )
            self.assert_condition(
                "mention_chip_rendered",
                bubble_chip(
                    self.clients["bob"],
                    named_message_id,
                    self.ptids["bob"],
                ),
            )

            # ── Owner @all under mute ─────────────────────────────────────
            self.step(
                "bob.park_for_all",
                lambda: park(self.clients["bob"]),
                "bob",
            )
            all_content = f"@all announcement-{time.time_ns()}"
            all_sent = self.step(
                "alice.send_all",
                lambda: async_harness(
                    self.clients["alice"],
                    "sendGroupMention",
                    {
                        "conversationId": self.group_id,
                        "content": all_content,
                        "mentions": [],
                        "mentionAll": True,
                    },
                    timeout=60,
                ),
                "alice",
            )
            all_projection = (all_sent or {}).get("projection") or {}
            all_message_id = str(all_projection.get("messageId") or "")
            self.assert_condition(
                "all_mention_owner_only",
                bool(all_message_id)
                and all_projection.get("mentionAll") is True,
                f"projection={all_projection}",
            )
            self.step(
                "bob.muted_all_marker",
                lambda: wait_until(
                    lambda: mention_flag(
                        self.clients["bob"], self.group_id
                    ).get("mentioned")
                    is True
                    and marker_visible(self.clients["bob"]),
                    "Bob muted @all marker",
                    STEP_TIMEOUT,
                    1,
                ),
                "bob",
            )
            self.sync_group("bob", self.group_id)
            self.step(
                "bob.all_chip",
                lambda: wait_until(
                    lambda: all_chip(self.clients["bob"], all_message_id),
                    "Bob @all chip",
                    STEP_TIMEOUT,
                    1,
                ),
                "bob",
            )
            self.assert_condition(
                "muted_all_mention_marker",
                mention_flag(self.clients["bob"], self.group_id).get("mentioned")
                is False
                and all_chip(self.clients["bob"], all_message_id),
            )

            for actor, client in self.clients.items():
                self.save_screenshot(client, actor)
                self.save_dom(client, actor)
        finally:
            cleanup_preserving_primary_failure(
                self.cleanup_runtime,
                self.report,
                "Native mentions",
            )

        names = {assertion.name for assertion in self.report.assertions}
        missing = REQUIRED_ASSERTIONS - names
        if missing:
            raise GateError(f"required assertions are missing: {sorted(missing)}")
        return {
            "runtimeCell": (
                self.runtime_binding.cell_id
                if self.runtime_binding is not None
                else "native-tauri-embedded-webdriver"
            ),
            "journey": "group-mentions-e2ee-muted-exception",
            "testedCommit": self.tested_commit,
            "testedWorkspaceDigest": self.workspace_digest,
            "stationLive": version,
            "sourceIdentity": self.source_evidence,
            "groupUlid": self.group_id,
            "namedMessageId": named_message_id,
            "allMessageId": all_message_id,
            "steps": self.steps,
            "cleanup": self.cleanup_evidence,
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
    runtime = selected_runtime()
    if runtime is None:
        raise SystemExit(
            "Native mentions gate requires a provisioned runtime manifest "
            "(PT_ACCEPTANCE_RUNTIME_MANIFEST)"
        )
    gate = NativeMentionsGate(
        manifest=runtime[0],
        actor_manifest=runtime[1],
        runtime_binding=runtime[2],
    )
    raise SystemExit(gate.execute())
