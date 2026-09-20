#!/usr/bin/env python3
"""Prove CHAT-J02 Direct projection, settings, search, and history recovery."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from tooling.acceptance.core import AcceptanceGate, GateError, REPO_ROOT
from tooling.acceptance.drivers.native import (
    NativeControlSnapshot,
    NativeDesktopRuntimeBinding,
    NativeKey,
    NativeModifier,
)
from tooling.acceptance.drivers.tauri import TauriSession
from tooling.acceptance.gates.chat.native_support import (
    async_harness,
    selected_native_runtime,
    wait_until,
)
from tooling.acceptance.gates.chat.native_two_client_runner import (
    LIFECYCLE_DIRECT_GATE_ID,
    NativeTwoClientGate,
)


GATE_ID = LIFECYCLE_DIRECT_GATE_ID
REPORT_PATH = None
STEP_TIMEOUT = 120.0
REQUIRED_DIRECT_ASSERTIONS = {
    "direct_station_identity_human_readable",
    "direct_presence_authoritative",
    "direct_background_preview_immediate",
    "direct_background_persisted",
    "direct_message_search",
    "direct_search_clear_bounded",
    "direct_history_restore",
}


class LifecycleDirectGate(NativeTwoClientGate):
    gate_id = GATE_ID
    phase = "CHAT-W02"
    bom = ("CHAT-G04", "CHAT-G05")
    spec = ("CHAT-J02", "chat-native-visible-clients")
    report_path = REPORT_PATH

    def __init__(
        self,
        *,
        manifest: dict[str, Any],
        actor_manifest: dict[str, Any],
        runtime_binding: NativeDesktopRuntimeBinding,
    ) -> None:
        super().__init__(
            manifest=manifest,
            actor_manifest=actor_manifest,
            runtime_binding=runtime_binding,
            gate_id=GATE_ID,
            allow_existing_fixture=True,
        )

    @staticmethod
    def _active_conversation_id(client: TauriSession) -> str:
        value = client.find_element(
            "[data-chat-conversation-pane]",
            STEP_TIMEOUT,
        ).get_attribute("data-chat-conversation-pane")
        if not value:
            raise GateError("active Direct conversation identity is missing")
        return str(value)

    def _select_native_file(
        self,
        actor: str,
        trigger_selector: str,
        source_path: Path,
    ) -> None:
        client = self.clients[actor]
        if client.process_id is None:
            raise GateError(f"{actor} Native file chooser has no owning process")
        selected_path = self.runtime_binding.stage_native_file(
            actor,
            source_path.resolve(),
        )
        adapter = self.runtime_binding.native_adapter
        baseline = adapter.activate_and_focused_control(client.process_id)
        client.find_element(trigger_selector, STEP_TIMEOUT).click()

        def panel_ready(_: Any) -> NativeControlSnapshot | None:
            control = adapter.focused_control(client.process_id or 0)
            opened = (
                control.window_count > baseline.window_count
                or control.dialog_count > baseline.dialog_count
                or control.kind in {"list", "text-field", "application-dialog"}
            )
            return control if opened else None

        WebDriverWait(client.driver, 10).until(panel_ready)
        if adapter.platform == "win32":
            adapter.select_file_chooser_path_to_process(
                client.process_id,
                str(selected_path),
            )
            return

        adapter.reveal_file_chooser_location_to_process(client.process_id)
        WebDriverWait(client.driver, 10).until(
            lambda _: (
                control
                if (control := adapter.focused_control(client.process_id or 0)).kind
                == "text-field"
                else None
            )
        )
        clipboard = adapter.read_clipboard()
        try:
            adapter.write_clipboard(str(selected_path).encode("utf-8"))
            adapter.post_key_to_process(
                client.process_id,
                NativeKey.A,
                modifiers=(NativeModifier.PRIMARY,),
            )
            adapter.post_key_to_process(
                client.process_id,
                NativeKey.V,
                modifiers=(NativeModifier.PRIMARY,),
            )
            adapter.post_key_to_process(
                client.process_id,
                NativeKey.ENTER,
                private_source=True,
            )
        finally:
            adapter.write_clipboard(clipboard)

        def selection_or_main_window(
            _: Any,
        ) -> dict[str, object] | None:
            control = adapter.focused_control(client.process_id or 0)
            if (
                control.main_window
                and control.frontmost
                and control.focused_window
                and control.kind != "application-dialog"
                and control.window_count <= baseline.window_count
            ):
                return {"selected": True, "control": control}
            if control.kind != "text-field":
                return {"selected": False, "control": control}
            return None

        intermediate = WebDriverWait(client.driver, 10).until(
            selection_or_main_window
        )
        if not intermediate["selected"]:
            adapter.post_key_to_process(
                client.process_id,
                NativeKey.ENTER,
                private_source=True,
            )
        WebDriverWait(client.driver, 10).until(
            lambda _: (
                control
                if (
                    (control := adapter.activate_and_focused_control(
                        client.process_id or 0
                    )).main_window
                    and control.frontmost
                    and control.focused_window
                    and control.kind != "application-dialog"
                )
                else None
            )
        )

    def prove_additional_journey_assertions(self) -> None:
        actor = self.direction_order[0]
        client = self.clients[actor]
        conversation_id = self._active_conversation_id(client)
        peer = next(name for name in self.clients if name != actor)
        plaintext = f"direct-search-{time.time_ns()}"
        sent = async_harness(
            client,
            "sendInteractionMessage",
            {
                "conversationId": conversation_id,
                "kind": "friend",
                "content": plaintext,
            },
        )
        message_id = str((sent or {}).get("messageId") or "")
        if not message_id:
            raise GateError("Direct search fixture did not return a message ID")
        wait_until(
            lambda: (
                snapshot
                if message_id
                in (
                    snapshot := async_harness(
                        client,
                        "searchMessages",
                        {
                            "conversationId": conversation_id,
                            "query": plaintext,
                        },
                    )
                ).get("messageIds", [])
                else None
            ),
            "durable Direct search projection",
            timeout=STEP_TIMEOUT,
        )

        client.find_element("[data-chat-detail-toggle]", STEP_TIMEOUT).click()
        client.find_element("[data-chat-detail-panel=\"open\"]", STEP_TIMEOUT)
        presence_snapshot = async_harness(
            client,
            "presenceSnapshot",
            {"actorPtids": [self.ptids[peer]]},
        )
        identity = client.execute_script(
            """
            const station = document.querySelector('[data-chat-station="authority"]');
            const presence = document.querySelector('[data-chat-presence-tag]');
            const details = document.querySelector('[data-chat-profile-technical-details]');
            return {
              stationText: station?.textContent?.trim() || '',
              stationId: station?.getAttribute('data-chat-station-id') || '',
              presence: presence?.getAttribute('data-chat-presence-tag') || '',
              presenceSource: presence?.getAttribute('data-chat-presence-source') || '',
              detailsCollapsed: details ? !details.hasAttribute('open') : false,
            };
            """
        )
        self.assert_condition(
            "direct_station_identity_human_readable",
            bool(identity.get("stationText"))
            and identity.get("stationId") not in identity.get("stationText")
            and identity.get("detailsCollapsed") is True,
            json.dumps(identity, sort_keys=True),
        )
        self.assert_condition(
            "direct_presence_authoritative",
            isinstance(presence_snapshot, dict)
            and presence_snapshot.get("statuses") == [
                {"actorPtid": self.ptids[peer], "online": True}
            ]
            and identity.get("presence") == "online"
            and identity.get("presenceSource") == "station",
            json.dumps(
                {
                    "identity": identity,
                    "snapshot": presence_snapshot,
                },
                sort_keys=True,
            ),
        )

        client.execute_script(
            "window.dispatchEvent(new CustomEvent('peers-chat:open-search'));"
        )
        search = client.find_element("[data-chat-message-search-input]", STEP_TIMEOUT)
        search.clear()
        search.send_keys(plaintext)
        result = wait_until(
            lambda: next(
                (
                    element
                    for element in client.find_elements(
                        "[data-messaging-search-result]"
                    )
                    if element.get_attribute(
                        "data-messaging-search-message-id"
                    )
                    == message_id
                ),
                None,
            ),
            "Direct message search result",
            timeout=STEP_TIMEOUT,
        )
        geometry = client.execute_script(
            """
            const input = document.querySelector('[data-chat-message-search-input]');
            const field = input?.closest('.ant-input-affix-wrapper');
            const clear = field?.querySelector('[data-chat-message-search-clear]');
            if (!field || !clear) return null;
            const fieldRect = field.getBoundingClientRect();
            const clearRect = clear.getBoundingClientRect();
            return { rightInset: fieldRect.right - clearRect.right };
            """
        )
        self.assert_condition(
            "direct_message_search",
            result is not None,
            f"conversation_id={conversation_id}; message_id={message_id}",
        )
        self.assert_condition(
            "direct_search_clear_bounded",
            isinstance(geometry, dict)
            and float(geometry.get("rightInset") or 999) <= 20,
            json.dumps(geometry, sort_keys=True),
        )
        client.execute_script(
            "document.querySelector('.ant-modal-close')?.click();"
        )

        client.find_element(
            '[data-chat-conversation-action="background"]',
            STEP_TIMEOUT,
        ).click()
        self._select_native_file(
            actor,
            "[data-chat-background-upload]",
            REPO_ROOT / "apps/desktop/src-tauri/icon-source.png",
        )
        immediate = wait_until(
            lambda: client.execute_script(
                """
                const pane = document.querySelector('[data-chat-conversation-pane]');
                return pane?.getAttribute('data-chat-background-preview') || '';
                """
            )
            == "local",
            "immediate local background preview",
            timeout=2,
        )
        self.assert_condition(
            "direct_background_preview_immediate",
            immediate is True,
        )
        persisted = wait_until(
            lambda: client.execute_script(
                """
                const pane = document.querySelector('[data-chat-conversation-pane]');
                const ref = pane?.getAttribute('data-chat-background-image') || '';
                const preview = pane?.getAttribute('data-chat-background-preview') || '';
                return ref && preview === 'durable' ? { ref, preview } : null;
                """
            ),
            "durable background persistence",
            timeout=STEP_TIMEOUT,
        )
        self.assert_condition(
            "direct_background_persisted",
            bool(persisted.get("ref")),
            json.dumps(persisted, sort_keys=True),
        )

        client.find_element("[data-chat-history-action=\"clear\"]", STEP_TIMEOUT).click()
        client.find_element(".ant-modal-confirm .ant-btn-primary", STEP_TIMEOUT).click()
        cleared_at = wait_until(
            lambda: (
                value
                if int(
                    value := client.find_element(
                        "[data-chat-detail-panel=\"open\"]",
                        STEP_TIMEOUT,
                    ).get_attribute("data-chat-detail-cleared-at")
                    or "0"
                )
                > 0
                else None
            ),
            "history clear marker",
            timeout=STEP_TIMEOUT,
        )
        client.find_element("[data-chat-history-action=\"restore\"]", STEP_TIMEOUT).click()
        client.find_element(".ant-modal-confirm .ant-btn-primary", STEP_TIMEOUT).click()
        restored = wait_until(
            lambda: client.execute_script(
                """
                const panel = document.querySelector('[data-chat-detail-panel="open"]');
                const message = document.querySelector(
                  `[data-message-ulid="${arguments[0]}"]`
                );
                return panel?.getAttribute('data-chat-detail-cleared-at') === '0'
                  && Boolean(message);
                """,
                message_id,
            ),
            "restored durable history",
            timeout=STEP_TIMEOUT,
        )
        self.assert_condition(
            "direct_history_restore",
            restored is True,
            f"conversation_id={conversation_id}; cleared_at={cleared_at}; message_id={message_id}",
        )
        self.report.runtime["directExperience"] = {
            "actor": actor,
            "peer": peer,
            "conversationId": conversation_id,
            "messageId": message_id,
            "identity": identity,
            "searchGeometry": geometry,
            "background": persisted,
            "clearedAt": cleared_at,
        }

    def run(self) -> dict[str, Any]:
        result = super().run()
        assertion_names = {assertion.name for assertion in self.report.assertions}
        missing = REQUIRED_DIRECT_ASSERTIONS - assertion_names
        if missing:
            raise GateError(f"Direct assertions are missing: {sorted(missing)}")
        result["journey"] = "daily-direct"
        self.report.runtime["journey"] = "daily-direct"
        return result


def main() -> int:
    selected = selected_native_runtime(GATE_ID)
    gate: AcceptanceGate = LifecycleDirectGate(
        manifest=selected.manifest,
        actor_manifest=selected.actor_manifest,
        runtime_binding=selected.binding,
    )
    return gate.execute()


if __name__ == "__main__":
    raise SystemExit(main())
