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
from tooling.acceptance.drivers.native.runtime import NativeLaunchOptions
from tooling.acceptance.drivers.tauri import TauriSession
from tooling.acceptance.gates.chat.native_support import (
    async_harness,
    enter_chat_page,
    selected_native_runtime,
    wait_until,
)
from tooling.acceptance.gates.chat.native_two_client_runner import (
    LIFECYCLE_DIRECT_GATE_ID,
    NativeTwoClientGate,
    message_snapshot,
)


GATE_ID = LIFECYCLE_DIRECT_GATE_ID
REPORT_PATH = None
STEP_TIMEOUT = 120.0
REQUIRED_DIRECT_ASSERTIONS = {
    "direct_active_transcript_live",
    "direct_unopened_row_unread",
    "direct_preview_restart",
    "direct_read_cursor_scoped",
    "direct_history_pagination",
    "direct_message_retry_identity",
    "direct_station_identity_human_readable",
    "direct_presence_authoritative",
    "direct_background_preview_immediate",
    "direct_background_persisted",
    "direct_message_search",
    "direct_search_clear_bounded",
    "direct_local_conversation_clear",
}


def station_presence_label(snapshot: object, actor_ptid: str) -> str | None:
    if not isinstance(snapshot, dict):
        return None
    statuses = snapshot.get("statuses")
    if not isinstance(statuses, list) or len(statuses) != 1:
        return None
    status = statuses[0]
    if not isinstance(status, dict) or status.get("actorPtid") != actor_ptid:
        return None
    online = status.get("online")
    if online is True:
        return "online"
    if online is False:
        return "offline"
    return None


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
        baseline = wait_until(
            lambda: adapter.activate_and_focused_control(
                client.process_id or 0
            ),
            f"{actor} Native file chooser owner to become frontmost",
            timeout=10,
        )
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

    def _conversation_summary(
        self,
        actor: str,
        conversation_id: str,
    ) -> dict[str, Any] | None:
        value = async_harness(
            self.clients[actor],
            "engineConversations",
            {"actorPtid": self.ptids[actor]},
        )
        conversations = (
            value.get("conversations")
            if isinstance(value, dict)
            else None
        )
        if not isinstance(conversations, list):
            return None
        return next(
            (
                conversation
                for conversation in conversations
                if isinstance(conversation, dict)
                and conversation.get("conversationId") == conversation_id
            ),
            None,
        )

    @staticmethod
    def _conversation_row(
        client: TauriSession,
        conversation_id: str,
    ) -> dict[str, Any] | None:
        value = client.execute_script(
            """
            const conversationId = arguments[0];
            const row = document.querySelector(
              `[data-pt-conversation-item="${CSS.escape(conversationId)}"]`
            );
            return row ? {
              preview: row.getAttribute('data-chat-conversation-preview') || '',
              latestAt: Number(
                row.getAttribute('data-chat-conversation-latest-at') || '0'
              ),
              unread: Number(
                row.getAttribute('data-chat-conversation-unread') || '0'
              ),
              text: row.textContent || '',
            } : null;
            """,
            conversation_id,
        )
        return value if isinstance(value, dict) else None

    def _restart_client_preserving_state(self, actor: str) -> TauriSession:
        predecessor = self.clients[actor]
        self.save_app_log(predecessor, f"{actor}-before-restart")
        self.client_lifecycles.stop_preserving_session(predecessor)
        successor = self.runtime_binding.create_bound_session(
            actor,
            NativeLaunchOptions(
                window_slot=("alice", "bob").index(actor),
                window_count=2,
            ),
        )
        self.runtime_instances.append(successor)
        self.client_lifecycles.register(successor, self.ptids[actor])
        self.client_lifecycles.transfer_preserved_session(
            predecessor,
            successor,
        )
        self.client_lifecycles.mark_live(successor)
        self.register_driver(successor)

        restored = wait_until(
            lambda: (
                value
                if (
                    isinstance(
                        value := async_harness(
                            successor,
                            "hydrateActiveActor",
                            {},
                            timeout=30,
                        ),
                        dict,
                    )
                    and value.get("actorPtid") == self.ptids[actor]
                )
                else None
            ),
            f"{actor} restored authenticated session",
            timeout=45,
        )
        self.client_lifecycles.mark_authenticated(successor)
        self.clients[actor] = successor
        if restored.get("actorPtid") != self.ptids[actor]:
            raise GateError(f"{actor} restart restored the wrong actor")
        return successor

    @staticmethod
    def _visible_confirmation(client: TauriSession) -> Any | None:
        buttons = client.find_elements(
            ".ant-modal-confirm .ant-btn-primary"
        )
        visible = [
            button
            for button in buttons
            if button.is_displayed() and button.is_enabled()
        ]
        return visible[-1] if visible else None

    def _click_visible_confirmation(
        self,
        client: TauriSession,
        description: str,
    ) -> None:
        confirmation = wait_until(
            lambda: self._visible_confirmation(client),
            description,
            timeout=STEP_TIMEOUT,
        )
        confirmation.click()

    def prove_additional_journey_assertions(self) -> None:
        actor = self.direction_order[0]
        client = self.clients[actor]
        conversation_id = self._active_conversation_id(client)
        peer = next(name for name in self.clients if name != actor)
        peer_client = self.clients[peer]

        live_plaintext = f"direct-live-{time.time_ns()}"
        live_sent = async_harness(
            client,
            "sendInteractionMessage",
            {
                "conversationId": conversation_id,
                "kind": "friend",
                "content": live_plaintext,
            },
        )
        live_message_id = str((live_sent or {}).get("messageId") or "")
        live_received = wait_until(
            lambda: message_snapshot(peer_client, live_plaintext),
            "active Direct transcript freshness",
            timeout=STEP_TIMEOUT,
        )
        self.assert_condition(
            "direct_active_transcript_live",
            bool(live_message_id)
            and live_received.get("messageUlid") == live_message_id,
            json.dumps(live_received, sort_keys=True),
        )

        first_page = async_harness(
            peer_client,
            "messagePage",
            {"conversationId": conversation_id, "limit": 1},
        )
        second_page = async_harness(
            peer_client,
            "messagePage",
            {
                "conversationId": conversation_id,
                "beforeSequence": first_page.get("nextBeforeSequence"),
                "limit": 1,
            },
        )
        first_ids = first_page.get("messageIds", [])
        second_ids = second_page.get("messageIds", [])
        self.assert_condition(
            "direct_history_pagination",
            first_page.get("hasMore") is True
            and isinstance(first_page.get("nextBeforeSequence"), int)
            and len(first_ids) == 1
            and len(second_ids) == 1
            and first_ids[0] != second_ids[0],
            json.dumps(
                {"first": first_page, "second": second_page},
                sort_keys=True,
            ),
        )

        async_harness(peer_client, "parkConversation", {})
        unread_plaintext = f"direct-unread-{time.time_ns()}"
        unread_sent = async_harness(
            client,
            "sendInteractionMessage",
            {
                "conversationId": conversation_id,
                "kind": "friend",
                "content": unread_plaintext,
            },
        )
        unread_message_id = str((unread_sent or {}).get("messageId") or "")
        unread_summary = wait_until(
            lambda: (
                summary
                if (
                    isinstance(
                        summary := self._conversation_summary(
                            peer,
                            conversation_id,
                        ),
                        dict,
                    )
                    and int(
                        (summary.get("summary") or {}).get(
                            "unreadCount",
                            0,
                        )
                    )
                    >= 1
                    and (
                        (summary.get("summary") or {}).get(
                            "latestMessage",
                            {},
                        )
                        or {}
                    ).get("messageId")
                    == unread_message_id
                )
                else None
            ),
            "unopened Direct unread summary",
            timeout=STEP_TIMEOUT,
        )

        peer_client = self._restart_client_preserving_state(peer)
        enter_chat_page(peer_client)
        row = wait_until(
            lambda: (
                snapshot
                if (
                    isinstance(
                        snapshot := self._conversation_row(
                            peer_client,
                            conversation_id,
                        ),
                        dict,
                    )
                    and snapshot.get("preview") == unread_plaintext
                    and int(snapshot.get("unread") or 0) >= 1
                    and int(snapshot.get("latestAt") or 0) > 0
                )
                else None
            ),
            "restart-stable Direct row preview and unread",
            timeout=STEP_TIMEOUT,
        )
        self.assert_condition(
            "direct_unopened_row_unread",
            int(row.get("unread") or 0) >= 1,
            json.dumps(
                {"summary": unread_summary, "row": row},
                sort_keys=True,
            ),
        )
        self.assert_condition(
            "direct_preview_restart",
            row.get("preview") == unread_plaintext
            and int(row.get("latestAt") or 0) > 0,
            json.dumps(row, sort_keys=True),
        )

        peer_client.find_element(
            f'[data-pt-conversation-item="{conversation_id}"]',
            STEP_TIMEOUT,
        ).click()
        reopened_message = wait_until(
            lambda: message_snapshot(peer_client, unread_plaintext),
            "reopened Direct transcript after restart",
            timeout=STEP_TIMEOUT,
        )
        read_summary = wait_until(
            lambda: (
                summary
                if (
                    isinstance(
                        summary := self._conversation_summary(
                            peer,
                            conversation_id,
                        ),
                        dict,
                    )
                    and int(
                        (summary.get("summary") or {}).get(
                            "unreadCount",
                            -1,
                        )
                    )
                    == 0
                )
                else None
            ),
            "conversation-scoped Direct read cursor",
            timeout=STEP_TIMEOUT,
        )
        self.assert_condition(
            "direct_read_cursor_scoped",
            reopened_message.get("messageUlid") == unread_message_id
            and int(
                (read_summary.get("summary") or {}).get("unreadCount", -1)
            )
            == 0,
            json.dumps(read_summary, sort_keys=True),
        )

        client = self.clients[actor]
        retry_plaintext = f"direct-retry-{time.time_ns()}"
        failed = async_harness(
            client,
            "createRestorableCommand",
            {
                "actorPtid": self.ptids[actor],
                "conversationId": conversation_id,
                "plaintext": retry_plaintext,
            },
        )
        retry_message_id = str((failed or {}).get("messageId") or "")
        retry_command_id = str((failed or {}).get("commandId") or "")
        if not retry_message_id or not retry_command_id:
            raise GateError("Direct retry fixture did not preserve message identity")
        async_harness(
            client,
            "syncFriendSession",
            {"sessionUlid": conversation_id},
        )
        retry_control = wait_until(
            lambda: next(
                (
                    element
                    for element in client.find_elements(
                        f'[data-message-retry="{retry_message_id}"]'
                    )
                    if element.is_displayed()
                ),
                None,
            ),
            "actionable Direct message retry control",
            timeout=STEP_TIMEOUT,
        )
        retry_control.click()
        retried = wait_until(
            lambda: message_snapshot(peer_client, retry_plaintext),
            "retried Direct message on peer",
            timeout=STEP_TIMEOUT,
        )
        sender_retry_state = wait_until(
            lambda: (
                value
                if (
                    isinstance(
                        value := client.execute_script(
                            """
                            const messageId = arguments[0];
                            const rows = Array.from(document.querySelectorAll(
                              `[data-message-ulid="${CSS.escape(messageId)}"]`
                            ));
                            return {
                              count: rows.length,
                              retryVisible: Boolean(
                                document.querySelector(
                                  `[data-message-retry="${CSS.escape(messageId)}"]`
                                )
                              ),
                              state: rows[0]?.querySelector(
                                '[data-message-delivery-state]'
                              )?.getAttribute('data-message-delivery-state') || '',
                            };
                            """,
                            retry_message_id,
                        ),
                        dict,
                    )
                    and value.get("count") == 1
                    and value.get("retryVisible") is False
                )
                else None
            ),
            "single logical message after retry",
            timeout=STEP_TIMEOUT,
        )
        self.assert_condition(
            "direct_message_retry_identity",
            retried.get("messageUlid") == retry_message_id
            and sender_retry_state.get("count") == 1,
            json.dumps(
                {
                    "messageId": retry_message_id,
                    "originalCommandId": retry_command_id,
                    "receiver": retried,
                    "sender": sender_retry_state,
                },
                sort_keys=True,
            ),
        )

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
        expected_presence = station_presence_label(
            presence_snapshot,
            self.ptids[peer],
        )
        self.assert_condition(
            "direct_presence_authoritative",
            expected_presence is not None
            and identity.get("presence") == expected_presence
            and identity.get("presenceSource") == "station",
            json.dumps(
                {
                    "expectedPresence": expected_presence,
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
        client.execute_script(
            """
            const pane = document.querySelector('[data-chat-conversation-pane]');
            if (!pane) throw new Error('active conversation pane missing');
            window.__ptChatBackgroundPreviewObserver?.disconnect();
            window.__ptChatBackgroundPreviewObserved =
              pane.getAttribute('data-chat-background-preview') === 'local';
            window.__ptChatBackgroundPreviewObserver = new MutationObserver(() => {
              if (pane.getAttribute('data-chat-background-preview') === 'local') {
                window.__ptChatBackgroundPreviewObserved = true;
              }
            });
            window.__ptChatBackgroundPreviewObserver.observe(pane, {
              attributes: true,
              attributeFilter: ['data-chat-background-preview'],
            });
            """
        )
        self._select_native_file(
            actor,
            "[data-chat-background-upload]",
            REPO_ROOT / "apps/desktop/src-tauri/icon-source.png",
        )
        immediate = wait_until(
            lambda: client.execute_script(
                """
                const pane = document.querySelector('[data-chat-conversation-pane]');
                if (!window.__ptChatBackgroundPreviewObserved) return null;
                return {
                  observed: true,
                  preview: pane?.getAttribute('data-chat-background-preview') || '',
                  ref: pane?.getAttribute('data-chat-background-image') || '',
                };
                """
            ),
            "immediate local background preview",
            timeout=10,
        )
        self.assert_condition(
            "direct_background_preview_immediate",
            immediate.get("observed") is True,
            json.dumps(immediate, sort_keys=True),
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
        client.execute_script(
            "window.__ptChatBackgroundPreviewObserver?.disconnect();"
        )

        client.find_element("[data-chat-history-action=\"clear\"]", STEP_TIMEOUT).click()
        self._click_visible_confirmation(
            client,
            "visible Direct local-data clear confirmation",
        )
        cleared = wait_until(
            lambda: (
                True
                if not client.find_elements(
                    f'[data-message-ulid="{message_id}"]'
                )
                else None
            ),
            "cleared Direct plaintext projection",
            timeout=STEP_TIMEOUT,
        )
        wait_until(
            lambda: not any(
                button.is_displayed()
                for button in client.find_elements(".ant-modal-confirm")
            ),
            "Direct local-data clear confirmation dismissal",
            timeout=STEP_TIMEOUT,
        )
        self.assert_condition(
            "direct_local_conversation_clear",
            cleared is True
            and not client.find_elements(
                '[data-chat-history-action="restore"]'
            ),
            f"conversation_id={conversation_id}; message_id={message_id}",
        )
        self.report.runtime["directExperience"] = {
            "actor": actor,
            "peer": peer,
            "conversationId": conversation_id,
            "messageId": message_id,
            "identity": identity,
            "searchGeometry": geometry,
            "background": persisted,
            "localConversationClear": True,
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
