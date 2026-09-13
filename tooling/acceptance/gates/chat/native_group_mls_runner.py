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
    is_native_tauri_url,
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
    "default_friend_projection",
    "same_name_identity_disambiguated",
    "identity_metadata_parity",
    "avatar_parity",
    "contact_message_routes_selected_peer",
    "existing_friend_search_state",
    "group_created",
    "group_creation_visible",
    "group_creation_failure_recoverable",
    "member_added",
    "group_message_delivered",
    "group_restart_recovered",
    "member_removed",
}

class VisibleGroupCreationFailure(GateError):
    """Stops polling once the UI reaches a terminal recoverable failure."""

SELECTORS = {
    "chat_nav": '[data-pt-primary-nav="chat"]',
    "chat_nav": '[data-pt-primary-nav="chat"]',
    "contacts_subpage": '[data-chat-subpage="contacts"]',
    "contact_message": "[data-chat-contact-message]",
    "new_menu": "[data-chat-new-menu]",
    "create_group_menu": "[data-chat-create-group-menu]",
    "create_group": "[data-chat-create-group]",
    "create_group_close": "[data-chat-create-group-close]",
    "create_group_contact": "[data-chat-create-group-contact]",
    "create_group_submit": "[data-chat-create-group-submit]",
    "find_people_menu": "[data-chat-find-people-menu]",
    "find_people": "[data-chat-find-people]",
    "find_people_input": "[data-chat-find-people-input]",
    "find_people_search": "[data-chat-find-people-search]",
    "find_people_result": "[data-chat-find-people-result]",
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
    spec = (
        "chat-native-visible-clients",
        "chat-native-friendship-projection",
    )
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
        self.start_injected_client(actor)

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
        if not is_native_tauri_url(client.get_current_url()):
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

    def open_create_group_modal(self, actor: str) -> TauriSession:
        client = self.clients[actor]
        enter_chat_page(client)
        client.find_element(SELECTORS["new_menu"], 30).click()
        client.find_element(SELECTORS["create_group_menu"], 10).click()
        client.find_element(SELECTORS["create_group"], 20)
        return client

    def create_group_contact_snapshot(self, actor: str) -> dict[str, Any]:
        client = self.open_create_group_modal(actor)
        expected_ptids = {
            ptid
            for role, ptid in self.ptids.items()
            if role != actor
        }

        def ready() -> dict[str, Any] | None:
            value = client.execute_script(
                """
                const root = document.querySelector(arguments[0]);
                if (!root) return null;
                const rows = Array.from(root.querySelectorAll(arguments[1]))
                  .map((row) => {
                    const identity = row.querySelector(
                      '[data-chat-identity-ptid]',
                    );
                    const image = row.querySelector('img');
                    const federationLabel = row.querySelector(
                      '[data-chat-identity-federation]',
                    );
                    const stationLabel = row.querySelector(
                      '[data-chat-identity-station]',
                    );
                    const metadataFields = [
                      federationLabel,
                      stationLabel,
                    ].filter(Boolean);
                    return {
                      ptid:
                        row.getAttribute('data-chat-contact-ptid') || '',
                      displayName:
                        identity?.getAttribute(
                          'data-chat-identity-display-name',
                        ) || '',
                      federatedHandle:
                        row.getAttribute(
                          'data-chat-contact-federated-handle',
                        ) || '',
                      homeStationDomain:
                        row.getAttribute(
                          'data-chat-contact-home-station-domain',
                        ) || '',
                      homeStationPeerId:
                        row.getAttribute(
                          'data-chat-contact-home-station-peer-id',
                        ) || '',
                      federationId:
                        row.getAttribute(
                          'data-chat-contact-federation-id',
                        ) || '',
                      federationName:
                        identity?.getAttribute(
                          'data-chat-identity-federation-name',
                        ) || '',
                      avatarSource:
                        row.getAttribute(
                          'data-chat-contact-avatar-src',
                        ) || '',
                      avatarCurrentSource:
                        image?.currentSrc || image?.src || '',
                      avatarLoaded: Boolean(
                        image?.complete && image?.naturalWidth > 0,
                      ),
                      metadata:
                        row.querySelector(
                          '[data-chat-identity-metadata]',
                        )?.textContent?.trim() || '',
                      federationLabel:
                        federationLabel?.textContent?.trim() || '',
                      stationLabel:
                        stationLabel?.textContent?.trim() || '',
                      metadataClipped: metadataFields.some(
                        (field) => (
                          field.scrollWidth > field.clientWidth + 1
                          || field.scrollHeight > field.clientHeight + 1
                        ),
                      ),
                    };
                  });
                return {
                  state:
                    root.getAttribute('data-chat-friendship-state') || '',
                  rows,
                };
                """,
                SELECTORS["create_group"],
                SELECTORS["create_group_contact"],
            )
            if not isinstance(value, dict) or value.get("state") != "ready":
                return None
            rows = value.get("rows")
            if not isinstance(rows, list):
                return None
            by_ptid = {
                str(row.get("ptid") or ""): row
                for row in rows
                if isinstance(row, dict) and row.get("ptid")
            }
            for ptid in expected_ptids:
                row = by_ptid.get(ptid)
                if (
                    not isinstance(row, dict)
                    or not row.get("displayName")
                    or not row.get("federatedHandle")
                    or not row.get("homeStationDomain")
                    or not row.get("homeStationPeerId")
                    or not row.get("federationId")
                    or not row.get("federationName")
                    or not row.get("avatarSource")
                    or not row.get("avatarCurrentSource")
                    or row.get("avatarLoaded") is not True
                    or not row.get("metadata")
                    or not row.get("federationLabel")
                    or not row.get("stationLabel")
                    or row.get("metadataClipped") is not False
                ):
                    return None
            return {
                "state": value["state"],
                "contacts": sorted(by_ptid),
                "byPtid": by_ptid,
            }

        snapshot = wait_until(
            ready,
            f"{actor} complete Create Group identity projection",
            STEP_TIMEOUT,
        )
        client.find_element(SELECTORS["create_group_close"], 10).click()
        return snapshot

    def create_group(self) -> str:
        alice = self.open_create_group_modal("alice")
        selected_ptids = [self.ptids["bob"], self.ptids["charlie"]]
        for ptid in selected_ptids:
            selector = (
                f'[data-chat-create-group-contact={json.dumps(ptid)}]'
            )
            alice.find_element(selector, 20).click()
            wait_until(
                lambda selector=selector: next(
                    (
                        row
                        for row in alice.find_elements(selector)
                        if row.get_attribute("aria-pressed") == "true"
                    ),
                    None,
                ),
                f"Alice selected {ptid} for Group creation",
                10,
            )

        submit = wait_until(
            lambda: next(
                (
                    button
                    for button in alice.find_elements(
                        SELECTORS["create_group_submit"]
                    )
                    if button.is_enabled()
                ),
                None,
            ),
            "Alice enabled visible Group creation",
            10,
        )
        submit.click()

        def accepted_group() -> str | None:
            state = alice.execute_script(
                """
                const modal = document.querySelector(arguments[0]);
                const selected = modal
                  ? Array.from(modal.querySelectorAll(arguments[1]))
                    .filter((row) => row.getAttribute('aria-pressed') === 'true')
                    .map((row) => (
                      row.getAttribute('data-chat-create-group-contact') || ''
                    ))
                  : [];
                const error = modal?.querySelector(
                  '[data-chat-create-group-error]',
                );
                const retry = modal?.querySelector(
                  '[data-chat-create-group-retry="true"]',
                );
                const pane = document.querySelector(
                  '[data-chat-conversation-pane][data-group-security]',
                );
                return {
                  modalState:
                    modal?.getAttribute('data-chat-create-group-state') || '',
                  selected,
                  error: error?.textContent?.trim() || '',
                  retry: Boolean(retry),
                  conversationId:
                    pane?.getAttribute('data-chat-conversation-pane') || '',
                  groupSecurity:
                    pane?.getAttribute('data-group-security') || '',
                };
                """,
                SELECTORS["create_group"],
                SELECTORS["create_group_contact"],
            )
            if not isinstance(state, dict):
                return None
            if state.get("modalState") == "failed":
                preserved = set(state.get("selected") or [])
                if (
                    set(selected_ptids).issubset(preserved)
                    and state.get("retry") is True
                    and state.get("error")
                ):
                    self.assert_condition(
                        "group_creation_failure_recoverable",
                        True,
                        json.dumps(state, sort_keys=True),
                    )
                raise VisibleGroupCreationFailure(
                    "visible Group creation failed: "
                    f"{json.dumps(state, sort_keys=True)}"
                )
            conversation_id = str(state.get("conversationId") or "")
            security = str(state.get("groupSecurity") or "")
            return (
                conversation_id
                if conversation_id
                and security in {"establishing", "ready"}
                else None
            )

        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            value = accepted_group()
            if value:
                return value
            time.sleep(0.25)
        raise GateError("timed out waiting for visible Group creation acceptance")

    def verify_default_friend_projection(self) -> dict[str, Any]:
        alice = self.clients["alice"]
        identity_matrix = {
            actor: self.create_group_contact_snapshot(actor)
            for actor in ACTORS
        }
        contacts = identity_matrix["alice"]

        alice.find_element(SELECTORS["new_menu"], 10).click()
        alice.find_element(SELECTORS["find_people_menu"], 10).click()
        search_input = alice.find_element(SELECTORS["find_people_input"], 10)
        alice.execute_script(
            """
            const root = arguments[0];
            const input = root instanceof HTMLInputElement
              ? root
              : root.querySelector('input');
            const value = arguments[1];
            if (!input) throw new Error('Find People input missing');
            const setter = Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype, 'value'
            )?.set;
            if (!setter) throw new Error('input setter missing');
            setter.call(input, value);
            input.dispatchEvent(new InputEvent('input', {
              bubbles: true, data: value, inputType: 'insertText',
            }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            """,
            search_input,
            "carol",
        )
        alice.find_element(SELECTORS["find_people_search"], 10).click()

        carol_selector = (
            f'[data-chat-find-people-result={json.dumps(self.ptids["charlie"])}]'
        )

        def existing_friend_result() -> dict[str, Any] | None:
            value = alice.execute_script(
                """
                const row = document.querySelector(arguments[0]);
                if (!row) return null;
                const action = row.querySelector('[data-chat-find-people-action]');
                return {
                  friendState: row.getAttribute('data-chat-friend-state') || '',
                  actionDisabled: Boolean(action?.disabled),
                  actionText: action?.textContent?.trim() || '',
                };
                """,
                carol_selector,
            )
            if not isinstance(value, dict):
                return None
            return value if (
                value.get("friendState") == "friend"
                and value.get("actionDisabled") is True
            ) else None

        search = wait_until(
            existing_friend_result,
            "existing friend state in Find People",
            STEP_TIMEOUT,
        )
        alice.find_element(".ant-modal-close", 10).click()

        alice.find_element(SELECTORS["contacts_subpage"], 10).click()
        contact_selector = (
            f'[data-chat-contact-ptid={json.dumps(self.ptids["charlie"])}]'
        )

        def contact_route_ready() -> dict[str, Any] | None:
            value = alice.execute_script(
                """
                const row = document.querySelector(arguments[0]);
                if (!row) return null;
                return {
                  peerPtid: row.getAttribute('data-chat-contact-ptid') || '',
                  federationId:
                    row.getAttribute('data-chat-contact-federation-id') || '',
                };
                """,
                contact_selector,
            )
            if not isinstance(value, dict):
                return None
            return value if (
                value.get("peerPtid") == self.ptids["charlie"]
                and bool(value.get("federationId"))
            ) else None

        route = wait_until(
            contact_route_ready,
            "selected contact has explicit federation scope",
            STEP_TIMEOUT,
        )
        alice.find_element(contact_selector, 10).click()
        alice.find_element(SELECTORS["contact_message"], 10).click()

        def selected_peer_route() -> dict[str, Any] | None:
            value = alice.execute_script(
                """
                const layout = document.querySelector(
                  '[data-social-chat-layout]',
                );
                const pane = document.querySelector(
                  '[data-chat-conversation-pane]',
                );
                if (!layout || !pane) return null;
                return {
                  activePeerPtid:
                    layout.getAttribute('data-chat-active-peer-ptid') || '',
                  conversationId:
                    pane.getAttribute('data-chat-conversation-pane') || '',
                };
                """,
            )
            if not isinstance(value, dict):
                return None
            return value if (
                value.get("activePeerPtid") == self.ptids["charlie"]
                and bool(value.get("conversationId"))
            ) else None

        direct = wait_until(
            selected_peer_route,
            "contact Message routes to the selected peer",
            STEP_TIMEOUT,
        )
        return {
            "contacts": contacts,
            "identityMatrix": identity_matrix,
            "direct": {
                **route,
                **direct,
            },
            "search": search,
        }

    def verify_identity_parity(
        self,
        matrix: dict[str, Any],
    ) -> dict[str, Any]:
        comparable_fields = (
            "displayName",
            "federatedHandle",
            "homeStationDomain",
            "homeStationPeerId",
            "federationId",
            "federationName",
            "avatarSource",
        )
        by_ptid: dict[str, list[dict[str, Any]]] = {}
        same_name: dict[str, dict[str, list[dict[str, Any]]]] = {}
        for observer, snapshot in matrix.items():
            contacts = snapshot.get("byPtid")
            if not isinstance(contacts, dict):
                raise GateError(
                    f"{observer} Create Group identity snapshot is invalid"
                )
            for ptid, row in contacts.items():
                if ptid == self.ptids[observer] or not isinstance(row, dict):
                    continue
                by_ptid.setdefault(str(ptid), []).append(
                    {"observer": observer, **row}
                )
            by_name: dict[str, list[dict[str, Any]]] = {}
            for row in contacts.values():
                if not isinstance(row, dict):
                    continue
                display_name = str(row.get("displayName") or "").strip()
                if display_name:
                    by_name.setdefault(display_name.casefold(), []).append(row)
            duplicates = {
                display_name: rows
                for display_name, rows in by_name.items()
                if len(rows) > 1
            }
            for display_name, rows in duplicates.items():
                ptids = {str(row.get("ptid") or "") for row in rows}
                stations = {
                    (
                        str(row.get("federatedHandle") or ""),
                        str(row.get("homeStationPeerId") or ""),
                    )
                    for row in rows
                }
                if (
                    len(ptids) != len(rows)
                    or "" in ptids
                    or len(stations) != len(rows)
                    or any(not all(station) for station in stations)
                ):
                    raise GateError(
                        f"{observer} same-name identities are ambiguous: "
                        f"{json.dumps(rows, sort_keys=True)}"
                    )
            if duplicates:
                same_name[observer] = duplicates

        evidence: dict[str, Any] = {}
        for ptid in self.ptids.values():
            rows = by_ptid.get(ptid, [])
            if len(rows) < 2:
                raise GateError(
                    f"Actor {ptid} is not visible on two independent clients"
                )
            field_values = {
                field: {str(row.get(field) or "") for row in rows}
                for field in comparable_fields
            }
            if any(len(values) != 1 or "" in values for values in field_values.values()):
                raise GateError(
                    f"Actor identity diverged for {ptid}: "
                    f"{json.dumps(rows, sort_keys=True)}"
                )
            if not all(
                row.get("avatarLoaded") is True
                and row.get("avatarCurrentSource")
                for row in rows
            ):
                raise GateError(
                    f"Actor avatar did not load for {ptid}: "
                    f"{json.dumps(rows, sort_keys=True)}"
                )
            evidence[ptid] = rows
        if not same_name:
            raise GateError(
                "Native fixture did not expose a same-name cross-Station "
                "identity case"
            )
        return {
            "actors": evidence,
            "sameName": same_name,
        }

    def restart_group_client(
        self,
        actor: str,
        group_id: str,
        expected_text: str,
    ) -> dict[str, Any]:
        if self.runtime_binding is None:
            raise GateError("Native Desktop runtime binding is required")
        predecessor = self.clients[actor]
        self.client_lifecycles.stop_preserving_session(predecessor)
        client = self.runtime_binding.create_bound_session(
            actor,
            NativeLaunchOptions(
                window_slot=ACTORS.index(actor),
                window_count=len(ACTORS),
                restore_session=True,
            ),
        )
        self.runtime_instances.append(client)
        expected_ptid = self.ptids[actor]
        self.client_lifecycles.register(client, expected_ptid)
        self.client_lifecycles.transfer_preserved_session(
            predecessor,
            client,
        )
        self.client_lifecycles.mark_live(client)
        try:
            endpoint = wait_until(
                lambda: (
                    status
                    if (
                        isinstance(
                            status := async_harness(
                                client,
                                "mlsReadiness",
                                {},
                                timeout=10,
                            ),
                            dict,
                        )
                        and status.get("actorPtid") == expected_ptid
                        and status.get("deviceId") == self.device_ids[actor]
                        and status.get("active") is True
                    )
                    else None
                ),
                f"{actor} restored MLS endpoint",
                120,
                interval=1,
            )
            self.client_lifecycles.mark_authenticated(client)
            self.register_driver(client)
            self.clients[actor] = client
            projection = wait_until(
                lambda: (
                    snapshot
                    if (
                        isinstance(
                            snapshot := async_harness(
                                client,
                                "syncGroup",
                                {"groupUlid": group_id},
                                timeout=30,
                            ),
                            dict,
                        )
                        and snapshot.get("securityState") == "ready"
                    )
                    else None
                ),
                f"{actor} restored Group projection",
                180,
                interval=1,
            )
            enter_chat_page(client)
            client.find_element(
                f'[data-chat-group-ulid={json.dumps(group_id)}]',
                30,
            ).click()
            message = wait_until(
                lambda: message_snapshot(client, expected_text),
                f"{actor} restored Group message",
                120,
            )
            return {
                "endpoint": endpoint,
                "projection": projection,
                "message": message,
            }
        except Exception:
            cleanup_errors = self.client_lifecycles.release(client)
            if cleanup_errors:
                raise GateError(
                    "restored Group client cleanup failed: "
                    f"{json.dumps(cleanup_errors, sort_keys=True)}"
                )
            raise

    def visible_group_projection(self, group_id: str) -> dict[str, Any]:
        expected_members = sorted(self.ptids.values())
        projections: dict[str, Any] = {}
        for actor in ACTORS:
            client = self.clients[actor]

            def ready() -> dict[str, Any] | None:
                result = async_harness(
                    client,
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
                group_name = str(result.get("groupName") or "").strip()
                if members != expected_members or not group_name:
                    return None
                enter_chat_page(client)
                selector = (
                    f'[data-chat-group-ulid={json.dumps(group_id)}]'
                )
                rows = client.find_elements(selector)
                if not rows:
                    return None
                row = rows[0]
                visible_name = (row.text or "").strip()
                row.click()
                pane = client.execute_script(
                    """
                    const pane = document.querySelector(
                      '[data-chat-conversation-pane][data-group-security]',
                    );
                    return pane ? {
                      conversationId:
                        pane.getAttribute('data-chat-conversation-pane') || '',
                      security:
                        pane.getAttribute('data-group-security') || '',
                    } : null;
                    """
                )
                if (
                    not isinstance(pane, dict)
                    or pane.get("conversationId") != group_id
                    or pane.get("security") != "ready"
                ):
                    return None
                return {
                    **result,
                    "memberPtids": members,
                    "visibleName": visible_name,
                    "pane": pane,
                }

            projections[actor] = wait_until(
                ready,
                f"{actor} visible ready Group projection",
                240,
                interval=2,
            )

        names = {
            str(projection.get("groupName") or "")
            for projection in projections.values()
        }
        if len(names) != 1 or "" in names:
            raise GateError(
                "Group name diverged across Native clients: "
                f"{json.dumps(projections, sort_keys=True)}"
            )
        return projections

    def add_member(self, group_id: str) -> dict[str, Any]:
        """Verify the UI-created Group has the exact initial member set."""
        return self.visible_group_projection(group_id)

    def wait_mls_readiness(self) -> None:
        """Wait for all clients to complete MLS key package publishing."""
        for actor in ACTORS:
            client = self.clients[actor]
            def ready() -> dict[str, Any] | None:
                try:
                    status = async_harness(
                        client, "mlsReadiness", {}, timeout=10
                    )
                    return status if (
                        isinstance(status, dict)
                        and status.get("deviceId")
                        == self.device_ids[actor]
                        and status.get("active") is True
                        and int(status.get("availableKeyPackages") or 0) > 0
                    ) else None
                except GateError:
                    return None

            wait_until(
                ready,
                f"{actor} active endpoint and MLS KeyPackage inventory",
                120,
                interval=1,
            )

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

    def remove_member(self, group_id: str) -> dict[str, Any]:
        alice = self.clients["alice"]
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
        projections: dict[str, Any] = {}
        for actor in ("alice", "bob"):
            projections[actor] = wait_until(
                lambda actor=actor: (
                    snapshot
                    if (
                        isinstance(
                            snapshot := async_harness(
                                self.clients[actor],
                                "syncGroup",
                                {"groupUlid": group_id},
                                timeout=30,
                            ),
                            dict,
                        )
                        and self.ptids["charlie"]
                        not in set(snapshot.get("memberPtids") or [])
                    )
                    else None
                ),
                f"{actor} observes Charlie removed from Group",
                180,
                interval=1,
            )
        return projections

    def prove_group_creation_failure_recovery(self) -> dict[str, Any]:
        revoked = async_harness(
            self.clients["charlie"],
            "revokeCurrentDevice",
            {},
        )
        if (
            not isinstance(revoked, dict)
            or revoked.get("revoked") is not True
            or revoked.get("deviceId") != self.device_ids["charlie"]
        ):
            raise GateError(
                "Charlie current-device revocation did not succeed"
            )
        self.client_lifecycles.mark_device_revoked(
            self.clients["charlie"]
        )
        wait_until(
            lambda: (
                status
                if (
                    isinstance(
                        status := async_harness(
                            self.clients["charlie"],
                            "getRealtimeDevice",
                            {},
                        ),
                        dict,
                    )
                    and status.get("active") is False
                )
                else None
            ),
            "Charlie revoked endpoint projection",
            STEP_TIMEOUT,
        )

        alice = self.open_create_group_modal("alice")
        charlie_ptid = self.ptids["charlie"]
        selector = (
            f'[data-chat-create-group-contact={json.dumps(charlie_ptid)}]'
        )
        alice.find_element(selector, 20).click()
        submit = wait_until(
            lambda: next(
                (
                    button
                    for button in alice.find_elements(
                        SELECTORS["create_group_submit"]
                    )
                    if button.is_enabled()
                ),
                None,
            ),
            "Alice enabled unavailable-member Group creation",
            10,
        )
        submit.click()

        def recoverable_failure() -> dict[str, Any] | None:
            value = alice.execute_script(
                """
                const root = document.querySelector(arguments[0]);
                if (!root) return null;
                const selected = Array.from(
                  root.querySelectorAll(arguments[1]),
                )
                  .filter(
                    (row) => row.getAttribute('aria-pressed') === 'true',
                  )
                  .map((row) => (
                    row.getAttribute(
                      'data-chat-create-group-contact',
                    ) || ''
                  ));
                const error = root.querySelector(
                  '[data-chat-create-group-error]',
                );
                const retry = root.querySelector(
                  '[data-chat-create-group-retry="true"]',
                );
                return {
                  state:
                    root.getAttribute('data-chat-create-group-state') || '',
                  selected,
                  error: error?.textContent?.trim() || '',
                  retryEnabled:
                    retry instanceof HTMLButtonElement && !retry.disabled,
                };
                """,
                SELECTORS["create_group"],
                SELECTORS["create_group_contact"],
            )
            if not isinstance(value, dict):
                return None
            return value if (
                value.get("state") == "failed"
                and charlie_ptid in set(value.get("selected") or [])
                and bool(value.get("error"))
                and value.get("retryEnabled") is True
            ) else None

        evidence = wait_until(
            recoverable_failure,
            "inline unavailable-member Group creation recovery",
            120,
        )
        self.save_screenshot(alice, "alice-group-create-recoverable-error")
        self.save_dom(alice, "alice-group-create-recoverable-error")
        alice.find_element(SELECTORS["create_group_close"], 10).click()
        return evidence

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
                    is_native_tauri_url(client.get_current_url())
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
            friendship = self.step(
                "friendship.default_projection",
                self.verify_default_friend_projection,
                "alice",
            )
            self.assert_condition(
                "default_friend_projection",
                {
                    self.ptids["bob"],
                    self.ptids["charlie"],
                }.issubset(set(friendship["contacts"]["contacts"])),
            )
            identity_parity = self.step(
                "friendship.identity_parity",
                lambda: self.verify_identity_parity(
                    friendship["identityMatrix"]
                ),
            )
            actor_identity = identity_parity["actors"]
            self.assert_condition(
                "same_name_identity_disambiguated",
                bool(identity_parity["sameName"]),
                json.dumps(
                    identity_parity["sameName"],
                    sort_keys=True,
                ),
            )
            self.assert_condition(
                "identity_metadata_parity",
                bool(actor_identity)
                and all(
                    row.get("federatedHandle")
                    and row.get("homeStationDomain")
                    and row.get("homeStationPeerId")
                    and row.get("federationId")
                    and row.get("federationName")
                    for rows in actor_identity.values()
                    for row in rows
                ),
                json.dumps(actor_identity, sort_keys=True),
            )
            self.assert_condition(
                "avatar_parity",
                bool(actor_identity)
                and all(
                    row.get("avatarSource")
                    and row.get("avatarLoaded") is True
                    for rows in actor_identity.values()
                    for row in rows
                ),
                json.dumps(actor_identity, sort_keys=True),
            )
            self.assert_condition(
                "contact_message_routes_selected_peer",
                friendship["direct"]["peerPtid"] == self.ptids["charlie"]
                and friendship["direct"]["activePeerPtid"]
                == self.ptids["charlie"],
            )
            self.assert_condition(
                "existing_friend_search_state",
                friendship["search"]["friendState"] == "friend"
                and friendship["search"]["actionDisabled"] is True,
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

            group_projection = self.step(
                "group.add_member",
                lambda: self.add_member(group_id),
                "alice",
            )
            self.assert_condition(
                "group_creation_visible",
                set(group_projection) == set(ACTORS)
                and all(
                    projection["pane"]["conversationId"] == group_id
                    and projection["pane"]["security"] == "ready"
                    for projection in group_projection.values()
                ),
                json.dumps(group_projection, sort_keys=True),
            )
            self.assert_condition(
                "member_added",
                all(
                    projection["memberPtids"]
                    == sorted(self.ptids.values())
                    for projection in group_projection.values()
                ),
                json.dumps(group_projection, sort_keys=True),
            )

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

            restart = self.step(
                "group.restart_recovery",
                lambda: self.restart_group_client(
                    "bob",
                    group_id,
                    text,
                ),
                "bob",
            )
            self.assert_condition(
                "group_restart_recovered",
                restart["projection"]["securityState"] == "ready"
                and bool(restart["message"]),
                json.dumps(restart, sort_keys=True),
            )

            removal = self.step(
                "group.remove_member",
                lambda: self.remove_member(group_id),
                "alice",
            )
            self.assert_condition(
                "member_removed",
                set(removal) == {"alice", "bob"}
                and all(
                    self.ptids["charlie"]
                    not in set(projection["memberPtids"])
                    for projection in removal.values()
                ),
                json.dumps(removal, sort_keys=True),
            )

            group_failure = self.step(
                "group.create_failure_recovery",
                self.prove_group_creation_failure_recovery,
                "alice",
            )
            self.assert_condition(
                "group_creation_failure_recoverable",
                group_failure["state"] == "failed"
                and group_failure["retryEnabled"] is True
                and self.ptids["charlie"] in group_failure["selected"],
                json.dumps(group_failure, sort_keys=True),
            )

            for actor in ACTORS:
                self.save_screenshot(self.clients[actor], actor)
                self.save_dom(self.clients[actor], actor)
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
