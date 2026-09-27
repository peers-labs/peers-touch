#!/usr/bin/env python3
"""Prove CHAT-J03 encrypted attachments and recorded voice on Native Desktop."""

from __future__ import annotations

import hashlib
import json
import tempfile
from pathlib import Path
from typing import Any

from selenium.common.exceptions import TimeoutException
from selenium.webdriver.support.ui import WebDriverWait

from tooling.acceptance.core import AcceptanceGate, GateError
from tooling.acceptance.drivers.native import (
    MouseAction,
    NativeControlSnapshot,
    NativeDesktopRuntimeBinding,
    NativeKey,
    NativeModifier,
)
from tooling.acceptance.drivers.native.runtime import NativeLaunchOptions
from tooling.acceptance.drivers.tauri import TauriSession
from tooling.acceptance.fixtures.chat_attachment_fault_proxy import (
    ATTACHMENT_DOWNLOAD_PREFIX,
    ATTACHMENT_UPLOAD_BEGIN_PATH,
    AcceptanceStationAttachmentFaultProxy,
)
from tooling.acceptance.gates.chat.native_support import (
    async_harness,
    enter_chat_page,
    selected_native_runtime,
    wait_until,
)
from tooling.acceptance.gates.chat.native_two_client_runner import (
    LIFECYCLE_RICH_VOICE_GATE_ID,
    NativeTwoClientGate,
)


GATE_ID = LIFECYCLE_RICH_VOICE_GATE_ID
REPORT_PATH = None
STEP_TIMEOUT = 120.0
REQUIRED_RICH_VOICE_ASSERTIONS = {
    "rich_attachment_retry_retained",
    "rich_attachment_upload_retry_identity",
    "rich_attachment_download_retry_identity",
    "rich_attachment_byte_identity",
    "rich_attachment_restart_recovery",
    "rich_screenshot_cancel_geometry",
    "rich_screenshot_confirm_geometry",
    "voice_capture_permission",
    "voice_cancel_boundary",
    "voice_preview_discard",
    "voice_metadata_persisted",
    "voice_byte_identity",
    "voice_playback_progress_seek_pause",
    "voice_playback_terminal_end",
    "voice_playback_failure_retry",
    "voice_restart_recovery",
}


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class LifecycleRichVoiceGate(NativeTwoClientGate):
    gate_id = GATE_ID
    phase = "CHAT-W03"
    bom = ("CHAT-G06", "CHAT-G07", "CHAT-UR06")
    spec = ("CHAT-J03", "chat-rich-media-recorded-voice")
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
            raise GateError("active rich-media conversation identity is missing")
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
        cooperative_activation = (
            self.runtime_binding.request_cooperative_activation(
                client,
                tuple(self.clients.values()),
            )
        )

        def native_app_ready(_: Any) -> NativeControlSnapshot | None:
            control = (
                adapter.focused_control(client.process_id or 0)
                if cooperative_activation
                else adapter.activate_and_focused_control(
                    client.process_id or 0
                )
            )
            ready = (
                control.window_count >= 1
                and control.main_window
                and control.frontmost
                and control.kind not in {
                    "list",
                    "text-field",
                    "application-dialog",
                }
            )
            return control if ready else None

        baseline = WebDriverWait(
            client.driver,
            30,
            poll_frequency=0.05,
        ).until(native_app_ready)
        trigger = client.find_element(trigger_selector, STEP_TIMEOUT)
        if not trigger.is_displayed() or not trigger.is_enabled():
            raise GateError(
                f"{actor} Native file chooser trigger is not actionable"
            )
        trigger.click()

        def panel_open(control: NativeControlSnapshot) -> bool:
            return (
                control.window_count > baseline.window_count
                or control.dialog_count > baseline.dialog_count
                or (
                    control.kind in {"list", "text-field"}
                    and control.kind != baseline.kind
                )
            )

        def restore_native_window() -> None:
            restored_activation = (
                self.runtime_binding.request_cooperative_activation(
                    client,
                    tuple(self.clients.values()),
                )
            )

            def native_window_restored(
                _: Any,
            ) -> NativeControlSnapshot | None:
                control = (
                    adapter.focused_control(client.process_id or 0)
                    if cooperative_activation
                    else adapter.activate_and_focused_control(
                        client.process_id or 0
                    )
                )
                document_focused = bool(
                    client.driver.execute_script("return document.hasFocus()")
                )
                restored = (
                    control.window_count >= baseline.window_count
                    and not panel_open(control)
                    and control.main_window
                    and control.frontmost
                    and document_focused
                    and control.kind != "application-dialog"
                )
                return control if restored else None

            WebDriverWait(
                client.driver,
                30,
                poll_frequency=0.05,
            ).until(native_window_restored)

        def panel_snapshot() -> NativeControlSnapshot:
            return adapter.focused_control(client.process_id or 0)

        WebDriverWait(
            client.driver,
            30,
            poll_frequency=0.05,
        ).until(
            lambda _: (
                control
                if panel_open(
                    control := panel_snapshot()
                )
                else None
            )
        )
        selected_control = adapter.select_file_chooser_path_to_process(
            client.process_id,
            str(selected_path),
        )
        if selected_control is not None:
            if selected_control.dialog_count:
                raise GateError(
                    "Native file chooser selection was not committed"
                )
            if adapter.platform == "macos":
                restore_native_window()
            return
        if adapter.platform == "win32":
            raise GateError(
                "Native file chooser selection returned no Win32 control"
            )

        def revealed_field_snapshot() -> NativeControlSnapshot:
            return adapter.focused_control(client.process_id or 0)

        path_control: NativeControlSnapshot | None = None
        for reveal_attempt in range(1, 5):
            if adapter.platform == "macos":
                revealed_control = (
                    adapter.reveal_file_chooser_location_to_process(
                        client.process_id
                    )
                )
            elif cooperative_activation:
                owner = adapter.focused_control(client.process_id or 0)
                if (
                    not owner.frontmost
                    or owner.actual_frontmost_pid != client.process_id
                ):
                    self.runtime_binding.request_cooperative_activation(
                        client,
                        tuple(self.clients.values()),
                    )
                adapter.reveal_file_chooser_location()
                revealed_control = None
            else:
                revealed_control = (
                    adapter.reveal_file_chooser_location_to_process(
                        client.process_id
                    )
                )
            if revealed_control is not None:
                if revealed_control.kind != "text-field":
                    raise GateError(
                        "Native file chooser reveal returned an invalid control: "
                        f"{revealed_control.to_dict()}"
                    )
                path_control = revealed_control
                break
            try:
                path_control = WebDriverWait(
                    client.driver,
                    2.5,
                    poll_frequency=0.05,
                ).until(
                    lambda _: (
                        control
                        if (
                            control := revealed_field_snapshot()
                        ).kind
                        == "text-field"
                        else None
                    )
                )
                break
            except TimeoutException:
                continue
        if path_control is None:
            raise GateError(
                "Native file chooser did not expose its location field "
                "after bounded target-owned retries"
            )

        def post_chooser_key(
            key: NativeKey,
            *,
            modifiers: tuple[NativeModifier, ...] = (),
            private_source: bool = False,
        ) -> None:
            if cooperative_activation:
                adapter.post_key(
                    key,
                    modifiers=modifiers,
                    private_source=private_source,
                )
                return
            adapter.post_key_to_process(
                client.process_id,
                key,
                modifiers=modifiers,
                private_source=private_source,
            )

        clipboard = adapter.read_clipboard()
        try:
            selected_path_bytes = str(selected_path).encode("utf-8")
            adapter.write_clipboard(selected_path_bytes)
            if adapter.read_clipboard() != selected_path_bytes:
                raise GateError(
                    "Native file chooser clipboard path did not round-trip"
                )
            post_chooser_key(
                NativeKey.A,
                modifiers=(NativeModifier.PRIMARY,),
            )
            post_chooser_key(
                NativeKey.V,
                modifiers=(NativeModifier.PRIMARY,),
            )
            WebDriverWait(
                client.driver,
                10,
                poll_frequency=0.05,
            ).until(
                lambda _: (
                    control
                    if (
                        (
                            control := adapter.focused_control(
                                client.process_id or 0
                            )
                        ).kind
                        == "text-field"
                        and control.value == str(selected_path)
                    )
                    else None
                )
            )
        finally:
            adapter.write_clipboard(clipboard)
        post_chooser_key(
            NativeKey.ENTER,
            private_source=True,
        )

        def selection_or_dialog_ready(_: Any) -> dict[str, object] | None:
            control = adapter.focused_control(client.process_id or 0)
            if control.window_count < baseline.window_count:
                return None
            if control.kind == "application-dialog":
                return {"selected": False}
            if panel_open(control) and control.kind != "text-field":
                return {"selected": False}
            if (
                not panel_open(control)
                and control.main_window
                and control.frontmost
                and control.focused_window
                and control.kind != "application-dialog"
            ):
                return {"selected": True}
            return None

        intermediate = WebDriverWait(
            client.driver,
            30,
            poll_frequency=0.05,
        ).until(
            selection_or_dialog_ready
        )
        if not intermediate["selected"]:
            post_chooser_key(
                NativeKey.ENTER,
                private_source=True,
            )

        restore_native_window()

    def _restart_client_preserving_state(self, actor: str) -> TauriSession:
        predecessor = self.clients[actor]
        self.save_app_log(predecessor, f"{actor}-before-rich-restart")
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
            f"{actor} restored authenticated rich-media session",
            timeout=45,
        )
        self.client_lifecycles.mark_authenticated(successor)
        self.clients[actor] = successor
        if restored.get("actorPtid") != self.ptids[actor]:
            raise GateError(f"{actor} rich-media restart restored the wrong actor")
        return successor

    def _engine_message(
        self,
        actor: str,
        conversation_id: str,
        message_id: str,
    ) -> dict[str, Any] | None:
        value = async_harness(
            self.clients[actor],
            "engineMessages",
            {
                "actorPtid": self.ptids[actor],
                "conversationId": conversation_id,
            },
        )
        messages = value.get("messages") if isinstance(value, dict) else None
        if not isinstance(messages, list):
            return None
        return next(
            (
                message
                for message in messages
                if isinstance(message, dict)
                and (
                    message.get("messageId")
                    or message.get("message_id")
                )
                == message_id
            ),
            None,
        )

    @staticmethod
    def _message_attachment(
        message: dict[str, Any],
        attachment_id: str,
    ) -> dict[str, Any] | None:
        attachments = message.get("attachments")
        if not isinstance(attachments, list):
            return None
        return next(
            (
                attachment
                for attachment in attachments
                if isinstance(attachment, dict)
                and (
                    attachment.get("attachmentId")
                    or attachment.get("attachment_id")
                )
                == attachment_id
            ),
            None,
        )

    def _engine_attachment(
        self,
        actor: str,
        conversation_id: str,
        message_id: str,
        attachment_id: str,
    ) -> dict[str, Any] | None:
        message = self._engine_message(actor, conversation_id, message_id)
        if message is None:
            return None
        return self._message_attachment(message, attachment_id)

    @staticmethod
    def _voice_surface_snapshot(
        client: TauriSession,
        message_id: str,
        attachment_id: str,
    ) -> dict[str, Any]:
        value = client.execute_script(
            """
            const messageId = arguments[0];
            const attachmentId = arguments[1];
            const message = document.querySelector(
              `[data-message-ulid="${messageId}"]`
            );
            const attachment = document.querySelector(
              `[data-messaging-attachment-id="${attachmentId}"]`
            );
            const viewport = document.querySelector('.chat-message-scroll');
            const describeAttachment = element => element ? {
              attachmentId: element.getAttribute(
                'data-messaging-attachment-id'
              ) || '',
              openState: element.getAttribute(
                'data-messaging-attachment-open-state'
              ) || '',
              voiceNote: element.getAttribute('data-chat-voice-note') || '',
            } : null;
            return {
              messageVisible: Boolean(message),
              attachmentVisible: Boolean(attachment),
              attachmentState: attachment?.getAttribute(
                'data-messaging-attachment-open-state'
              ) || '',
              attachment: describeAttachment(attachment),
              voiceNote: attachment?.getAttribute('data-chat-voice-note') || '',
              renderedMessageIds: Array.from(
                document.querySelectorAll('[data-message-ulid]')
              ).slice(-8).map(
                element => element.getAttribute('data-message-ulid') || ''
              ),
              renderedAttachments: Array.from(
                document.querySelectorAll('[data-messaging-attachment-id]')
              ).slice(-8).map(describeAttachment),
              scroll: viewport ? {
                clientHeight: viewport.clientHeight,
                scrollHeight: viewport.scrollHeight,
                scrollTop: viewport.scrollTop,
              } : null,
            };
            """,
            message_id,
            attachment_id,
        )
        return value if isinstance(value, dict) else {}

    def _open_attachment(self, actor: str, attachment_id: str) -> Path:
        def open_verified_path() -> Path | None:
            try:
                value = async_harness(
                    self.clients[actor],
                    "openAttachment",
                    {
                        "actorPtid": self.ptids[actor],
                        "attachmentId": attachment_id,
                    },
                    timeout=60,
                )
            except GateError as error:
                if "ATTACHMENT_TRANSFER_ERROR_CODE_RETRY_LATER" in str(error):
                    return None
                raise
            local_path = (
                str(value.get("localPath") or "")
                if isinstance(value, dict)
                else ""
            )
            return Path(local_path) if local_path else None

        path = wait_until(
            open_verified_path,
            f"{actor} verified attachment cache path",
            timeout=60,
        )
        return path

    @staticmethod
    def _composer_outcome(
        client: TauriSession,
        conversation_id: str,
        after_revision: int,
    ) -> dict[str, Any] | None:
        composer = client.find_element(
            f'[data-chat-composer="{conversation_id}"]',
            5,
        )
        revision = int(
            composer.get_attribute("data-chat-send-outcome-revision") or 0
        )
        if revision <= after_revision:
            return None
        return {
            "revision": revision,
            "state": composer.get_attribute("data-chat-send-outcome-state") or "",
            "messageId": composer.get_attribute(
                "data-chat-send-outcome-message-id"
            )
            or "",
            "attachmentIds": [
                item
                for item in (
                    composer.get_attribute(
                        "data-chat-send-outcome-attachment-ids"
                    )
                    or ""
                ).split(",")
                if item
            ],
        }

    @staticmethod
    def _renderer_geometry(client: TauriSession) -> dict[str, Any]:
        value = client.execute_script(
            """
            const rect = (selector) => {
              const node = document.querySelector(selector);
              const bounds = node?.getBoundingClientRect();
              return bounds ? {
                left: bounds.left,
                top: bounds.top,
                width: bounds.width,
                height: bounds.height,
              } : null;
            };
            return {
              screenX: window.screenX,
              screenY: window.screenY,
              outerWidth: window.outerWidth,
              outerHeight: window.outerHeight,
              innerWidth: window.innerWidth,
              innerHeight: window.innerHeight,
              devicePixelRatio: window.devicePixelRatio,
              pane: rect('[data-chat-conversation-pane]'),
              composer: rect('[data-chat-composer]'),
            };
            """
        )
        if not isinstance(value, dict):
            raise GateError("renderer geometry snapshot is unavailable")
        return value

    def _geometry_snapshot(
        self,
        actor: str,
    ) -> dict[str, Any]:
        client = self.clients[actor]
        if client.process_id is None:
            raise GateError(f"{actor} process identity is unavailable")
        cooperative_activation = (
            self.runtime_binding.request_cooperative_activation(
                client,
                tuple(self.clients.values()),
            )
        )
        WebDriverWait(
            client.driver,
            10,
            poll_frequency=0.05,
        ).until(
            lambda driver: (
                control
                if (
                    (
                        control := self.runtime_binding.native_adapter.focused_control(
                            client.process_id or 0
                        )
                    ).frontmost
                    and control.main_window
                    and control.actual_frontmost_pid == client.process_id
                    and bool(
                        driver.execute_script("return document.hasFocus()")
                    )
                )
                else None
            )
        )
        renderer = self._renderer_geometry(client)
        driver_window = client.driver.get_window_rect()
        device_pixel_ratio = float(renderer["devicePixelRatio"])
        if device_pixel_ratio <= 0:
            raise GateError(
                f"{actor} native window device pixel ratio is invalid"
            )
        center = (
            (
                float(driver_window["x"])
                + float(driver_window["width"]) / 2
            )
            / device_pixel_ratio,
            (
                float(driver_window["y"])
                + float(driver_window["height"]) / 2
            )
            / device_pixel_ratio,
        )
        stack = self.runtime_binding.native_adapter.window_stack_at_point(center)
        native = next(
            (
                window.to_dict()
                for window in stack.windows
                if window.owner_pid == client.process_id
                and window.alpha > 0
            ),
            None,
        )
        if not native:
            raise GateError(
                f"{actor} native window bounds are unavailable after "
                f"cooperative activation={cooperative_activation}: "
                f"{stack.error}"
            )
        return {"native": native, "renderer": renderer}

    @staticmethod
    def _geometry_equal(
        before: dict[str, Any],
        after: dict[str, Any],
        *,
        allow_composer_expansion: bool = False,
    ) -> bool:
        def close(left: Any, right: Any) -> bool:
            return abs(float(left) - float(right)) <= 1.0

        before_native = before["native"]["bounds"]
        after_native = after["native"]["bounds"]
        before_renderer = before["renderer"]
        after_renderer = after["renderer"]
        native_equal = all(
            close(before_native[key], after_native[key])
            for key in ("left", "top", "width", "height")
        )
        renderer_equal = all(
            close(before_renderer[key], after_renderer[key])
            for key in (
                "screenX",
                "screenY",
                "outerWidth",
                "outerHeight",
                "innerWidth",
                "innerHeight",
                "devicePixelRatio",
            )
        )
        pane_equal = all(
            close(before_renderer["pane"][key], after_renderer["pane"][key])
            for key in ("left", "top", "width", "height")
        )
        before_composer = before_renderer["composer"]
        after_composer = after_renderer["composer"]
        if allow_composer_expansion:
            composer_equal = (
                close(before_composer["left"], after_composer["left"])
                and close(before_composer["width"], after_composer["width"])
                and close(
                    float(before_composer["top"])
                    + float(before_composer["height"]),
                    float(after_composer["top"])
                    + float(after_composer["height"]),
                )
                and float(after_composer["top"])
                <= float(before_composer["top"]) + 1.0
                and float(after_composer["height"])
                >= float(before_composer["height"]) - 1.0
            )
        else:
            composer_equal = all(
                close(before_composer[key], after_composer[key])
                for key in ("left", "top", "width", "height")
            )
        return native_equal and renderer_equal and pane_equal and composer_equal

    def _wait_for_screenshot_picker(
        self,
        actor: str,
    ) -> NativeControlSnapshot:
        client = self.clients[actor]
        if client.process_id is None:
            raise GateError(f"{actor} screenshot picker has no owning process")
        return wait_until(
            lambda: (
                control
                if not (
                    control := self.runtime_binding.native_adapter.focused_control(
                        client.process_id or 0
                    )
                ).frontmost
                else None
            ),
            f"{actor} screenshot picker to become frontmost",
            timeout=10,
        )

    def _native_click(self, actor: str, selector: str) -> None:
        client = self.clients[actor]
        if client.process_id is None:
            raise GateError(f"{actor} native click has no owning process")
        self.runtime_binding.request_cooperative_activation(
            client,
            tuple(self.clients.values()),
        )
        WebDriverWait(
            client.driver,
            10,
            poll_frequency=0.05,
        ).until(
            lambda driver: bool(
                driver.execute_script("return document.hasFocus()")
            )
        )
        element = client.find_element(selector, 10)
        geometry = client.execute_script(
            """
            const element = arguments[0];
            const rect = element.getBoundingClientRect();
            return {
              element: {
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
              },
              viewport: {
                width: window.innerWidth,
                height: window.innerHeight,
                devicePixelRatio: window.devicePixelRatio,
              },
            };
            """,
            element,
        )
        driver_window = client.driver.get_window_rect()
        ratio = float(geometry["viewport"]["devicePixelRatio"])
        native_window = {
            "left": float(driver_window["x"]) / ratio,
            "top": float(driver_window["y"]) / ratio,
            "width": float(driver_window["width"]) / ratio,
            "height": float(driver_window["height"]) / ratio,
        }
        origin = self.runtime_binding.native_adapter.content_origin(
            client.process_id
        )
        if origin is None:
            origin = (
                native_window["left"]
                + max(
                    0.0,
                    (
                        native_window["width"]
                        - float(geometry["viewport"]["width"])
                    )
                    / 2,
                ),
                native_window["top"]
                + max(
                    0.0,
                    native_window["height"]
                    - float(geometry["viewport"]["height"]),
                ),
            )
        point = (
            origin[0]
            + float(geometry["element"]["left"])
            + float(geometry["element"]["width"]) / 2,
            origin[1]
            + float(geometry["element"]["top"])
            + float(geometry["element"]["height"]) / 2,
        )
        adapter = self.runtime_binding.native_adapter
        mouse_down = False
        try:
            adapter.post_mouse((MouseAction.LEFT_DOWN,), point)
            mouse_down = True
            adapter.post_mouse((MouseAction.LEFT_UP,), point)
            mouse_down = False
        finally:
            if mouse_down:
                adapter.post_mouse((MouseAction.LEFT_UP,), point)

    def _cancel_screenshot(self, actor: str) -> dict[str, Any]:
        client = self.clients[actor]
        before = self._geometry_snapshot(actor)
        self._native_click(actor, "[data-chat-screenshot-capture]")
        self._wait_for_screenshot_picker(actor)
        self.runtime_binding.native_adapter.post_key(
            NativeKey.ESCAPE,
            private_source=True,
        )
        wait_until(
            lambda: (
                self._geometry_snapshot(actor)
                if client.find_element(
                    "[data-chat-screenshot-capture]",
                    5,
                ).is_enabled()
                else None
            ),
            f"{actor} screenshot cancellation to restore the app",
            timeout=20,
        )
        after = self._geometry_snapshot(actor)
        evidence = {"before": before, "after": after}
        self.assert_condition(
            "rich_screenshot_cancel_geometry",
            self._geometry_equal(before, after),
            json.dumps(evidence, sort_keys=True),
        )
        return evidence

    def _confirm_screenshot(self, actor: str) -> dict[str, Any]:
        client = self.clients[actor]
        before = self._geometry_snapshot(actor)
        self._native_click(actor, "[data-chat-screenshot-capture]")
        self._wait_for_screenshot_picker(actor)
        native = before["native"]["bounds"]
        left = float(native["left"]) + 32
        top = float(native["top"]) + 72
        adapter = self.runtime_binding.native_adapter
        adapter.drag_mouse(
            (left, top),
            (left + 180, top + 120),
        )
        draft = wait_until(
            lambda: next(
                (
                    item
                    for item in client.find_elements(
                        '[data-chat-attachment-draft]'
                        '[data-chat-attachment-status="ready"]'
                    )
                    if item.is_displayed()
                ),
                None,
            ),
            f"{actor} confirmed screenshot draft",
            timeout=30,
        )
        after = self._geometry_snapshot(actor)
        evidence = {
            "before": before,
            "after": after,
            "draftId": draft.get_attribute("data-chat-attachment-draft") or "",
            "preview": draft.get_attribute("data-chat-attachment-preview") or "",
        }
        self.assert_condition(
            "rich_screenshot_confirm_geometry",
            self._geometry_equal(
                before,
                after,
                allow_composer_expansion=True,
            )
            and bool(evidence["draftId"])
            and bool(evidence["preview"]),
            json.dumps(evidence, sort_keys=True),
        )
        buttons = draft.find_elements("tag name", "button")
        if not buttons:
            raise GateError("confirmed screenshot draft has no discard control")
        buttons[-1].click()
        wait_until(
            lambda: not client.find_elements(
                f'[data-chat-attachment-draft="{evidence["draftId"]}"]'
            ),
            "confirmed screenshot draft discard",
            timeout=10,
        )
        return evidence

    def _prove_attachment_failure(
        self,
        actor: str,
        empty_file: Path,
    ) -> dict[str, Any]:
        client = self.clients[actor]
        self._select_native_file(
            actor,
            "[data-chat-attachment-picker]",
            empty_file,
        )
        draft = wait_until(
            lambda: next(
                (
                    item
                    for item in client.find_elements(
                        '[data-chat-attachment-draft]'
                        '[data-chat-attachment-status="failed"]'
                    )
                    if item.is_displayed()
                ),
                None,
            ),
            "failed rich attachment draft",
            timeout=30,
        )
        draft_id = draft.get_attribute("data-chat-attachment-draft") or ""
        attempt = int(
            draft.get_attribute("data-chat-attachment-attempt") or 0
        )
        buttons = draft.find_elements("tag name", "button")
        if len(buttons) < 2:
            raise GateError("failed rich attachment lacks retry and discard")
        buttons[0].click()
        retained = wait_until(
            lambda: (
                item
                if (
                    item := next(
                        (
                            candidate
                            for candidate in client.find_elements(
                                f'[data-chat-attachment-draft="{draft_id}"]'
                                '[data-chat-attachment-status="failed"]'
                            )
                            if candidate.is_displayed()
                        ),
                        None,
                    )
                )
                and int(
                    item.get_attribute("data-chat-attachment-attempt") or 0
                )
                > attempt
                else None
            ),
            "failed rich attachment retained after retry",
            timeout=30,
        )
        evidence = {
            "draftId": draft_id,
            "attemptBefore": attempt,
            "attemptAfter": int(
                retained.get_attribute("data-chat-attachment-attempt") or 0
            ),
            "status": retained.get_attribute("data-chat-attachment-status"),
        }
        self.assert_condition(
            "rich_attachment_retry_retained",
            bool(draft_id)
            and evidence["attemptAfter"] > attempt
            and evidence["status"] == "failed",
            json.dumps(evidence, sort_keys=True),
        )
        retained_buttons = retained.find_elements("tag name", "button")
        retained_buttons[-1].click()
        return evidence

    def _prove_file_attachment(
        self,
        actor: str,
        peer: str,
        conversation_id: str,
        source: Path,
    ) -> dict[str, Any]:
        if self.runtime_binding is None:
            raise GateError("Native Desktop runtime binding is required")
        client = self.clients[actor]
        composer = client.find_element(
            f'[data-chat-composer="{conversation_id}"]',
            10,
        )
        revision = int(
            composer.get_attribute("data-chat-send-outcome-revision") or 0
        )
        proxy = AcceptanceStationAttachmentFaultProxy(self.station_url)
        proxy_started = False
        upload_override = None
        download_override = None
        try:
            proxy.start()
            proxy_started = True
            upload_override = self.runtime_binding.create_transport_override(
                actor,
                "station",
                proxy.url,
            )
            download_override = self.runtime_binding.create_transport_override(
                peer,
                "station",
                proxy.url,
            )
            self.runtime_binding.apply_transport_override(
                actor,
                "station",
                upload_override,
            )
            proxy.arm_upload_connection_loss_once()
            self._select_native_file(
                actor,
                "[data-chat-attachment-picker]",
                source,
            )
            wait_until(
                lambda: next(
                    (
                        item
                        for item in client.find_elements(
                            '[data-chat-attachment-draft]'
                            '[data-chat-attachment-status="ready"]'
                        )
                        if item.is_displayed()
                    ),
                    None,
                ),
                "ready rich attachment draft",
                timeout=30,
            )
            client.find_element("[data-chat-send]", 10).click()
            outcome = wait_until(
                lambda: self._composer_outcome(
                    client,
                    conversation_id,
                    revision,
                ),
                "interrupted rich attachment send outcome",
                timeout=180,
            )
            if (
                outcome["state"] != "draft"
                or not outcome["messageId"]
                or len(outcome["attachmentIds"]) != 1
            ):
                raise GateError(
                    "interrupted rich attachment did not retain one durable "
                    f"draft identity: {outcome}"
                )
            message_id = str(outcome["messageId"])
            attachment_id = str(outcome["attachmentIds"][0])
            expected_hash = file_sha256(source)
            projections: dict[str, Any] = {}
            hashes: dict[str, str] = {}
            actor_attachment = wait_until(
                lambda: self._engine_attachment(
                    actor,
                    conversation_id,
                    message_id,
                    attachment_id,
                ),
                "interrupted rich attachment projection",
                timeout=180,
            )
            upload_evidence = wait_until(
                lambda: (
                    snapshot
                    if (
                        (snapshot := proxy.evidence())[
                            "uploadConnectionLossCount"
                        ]
                        == 1
                        and snapshot["forwardedPaths"].get(
                            ATTACHMENT_UPLOAD_BEGIN_PATH,
                            0,
                        )
                        >= 1
                    )
                    else None
                ),
                "rich attachment upload to resume after connection loss",
                timeout=30,
            )
            self.assert_condition(
                "rich_attachment_upload_retry_identity",
                isinstance(actor_attachment, dict)
                and upload_evidence["uploadLossesRemaining"] == 0
                and upload_evidence["uploadConnectionLossCount"] == 1,
                json.dumps(
                    {
                        "messageId": message_id,
                        "attachmentId": attachment_id,
                        "initialOutcome": outcome,
                        "transport": upload_evidence,
                    },
                    sort_keys=True,
                ),
            )
            self.runtime_binding.clear_transport_override(
                actor,
                "station",
                upload_override,
            )
            upload_override = None

            actor_path = self._open_attachment(actor, attachment_id)
            projections[actor] = actor_attachment
            hashes[actor] = self.runtime_binding.native_file_sha256(
                actor,
                actor_path,
            )

            peer_attachment = wait_until(
                lambda: self._engine_attachment(
                    peer,
                    conversation_id,
                    message_id,
                    attachment_id,
                ),
                "receiver rich attachment Engine projection",
                timeout=180,
            )
            projections[peer] = peer_attachment
            self.runtime_binding.apply_transport_override(
                peer,
                "station",
                download_override,
            )
            proxy.arm_download_connection_loss_once()
            peer_path = self._open_attachment(peer, attachment_id)
            hashes[peer] = self.runtime_binding.native_file_sha256(
                peer,
                peer_path,
            )
            download_evidence = proxy.evidence()
            forwarded_downloads = sum(
                count
                for path, count in download_evidence["forwardedPaths"].items()
                if path.startswith(ATTACHMENT_DOWNLOAD_PREFIX)
            )
            self.assert_condition(
                "rich_attachment_download_retry_identity",
                download_evidence["downloadConnectionLossCount"] == 1
                and download_evidence["downloadLossesRemaining"] == 0
                and forwarded_downloads >= 1
                and hashes[peer] == expected_hash,
                json.dumps(
                    {
                        "messageId": message_id,
                        "attachmentId": attachment_id,
                        "transport": download_evidence,
                    },
                    sort_keys=True,
                ),
            )
            evidence = {
                "messageId": message_id,
                "attachmentId": attachment_id,
                "initialOutcome": outcome,
                "expectedHash": expected_hash,
                "hashes": hashes,
                "projections": projections,
                "uploadRetry": upload_evidence,
                "downloadRetry": download_evidence,
            }
            self.assert_condition(
                "rich_attachment_byte_identity",
                set(hashes.values()) == {expected_hash}
                and projections[actor] == projections[peer]
                and projections[actor].get("contentKind") == "file"
                and int(projections[actor].get("durationMs") or 0) == 0,
                json.dumps(evidence, sort_keys=True),
            )
            return evidence
        finally:
            cleanup_errors: list[str] = []
            if upload_override is not None:
                try:
                    self.runtime_binding.clear_transport_override(
                        actor,
                        "station",
                        upload_override,
                    )
                except Exception as error:
                    cleanup_errors.append(f"upload override: {error}")
            if download_override is not None:
                try:
                    self.runtime_binding.clear_transport_override(
                        peer,
                        "station",
                        download_override,
                    )
                except Exception as error:
                    cleanup_errors.append(f"download override: {error}")
            if proxy_started:
                try:
                    proxy.stop()
                except Exception as error:
                    cleanup_errors.append(f"fault proxy: {error}")
            if cleanup_errors:
                raise GateError(
                    "rich attachment fault transport cleanup failed: "
                    + "; ".join(cleanup_errors)
                )

    def _record_until_preview(
        self,
        actor: str,
        *,
        minimum_seconds: int,
    ) -> dict[str, Any]:
        client = self.clients[actor]
        if client.process_id is None:
            raise GateError(f"{actor} voice capture has no owning process")
        client.find_element("[data-chat-voice-record]", 10).click()
        recording = self._wait_for_voice_recording(actor)
        self.assert_condition(
            "voice_capture_permission",
            recording.is_displayed(),
            "production MediaRecorder reached the recording state",
        )
        wait_until(
            lambda: (
                recording
                if int(
                    recording.get_attribute(
                        "data-chat-voice-recording-seconds"
                    )
                    or 0
                )
                >= minimum_seconds
                else None
            ),
            f"{actor} recorded voice duration",
            timeout=max(10, minimum_seconds + 5),
        )
        client.find_element("[data-chat-voice-finish]", 10).click()
        preview = wait_until(
            lambda: (
                element
                if (
                    element := client.find_element(
                        '[data-chat-voice-draft="preview"]',
                        5,
                    )
                ).is_displayed()
                else None
            ),
            f"{actor} local voice preview",
            timeout=15,
        )
        duration_ms = int(
            preview.get_attribute("data-chat-voice-duration-ms") or 0
        )
        if duration_ms < minimum_seconds * 1_000:
            raise GateError(
                f"{actor} voice preview duration is incomplete: {duration_ms}"
            )
        return {"durationMs": duration_ms}

    def _wait_for_voice_recording(self, actor: str) -> Any:
        client = self.clients[actor]
        if client.process_id is None:
            raise GateError(f"{actor} voice capture has no owning process")
        permission_accepted = False

        def recording_or_permission() -> Any:
            nonlocal permission_accepted
            recording = next(
                (
                    element
                    for element in client.find_elements(
                        "[data-chat-voice-recording]"
                    )
                    if element.is_displayed()
                ),
                None,
            )
            if recording is not None:
                return recording
            accepted = (
                self.runtime_binding.native_adapter
                .accept_media_capture_permission_to_process(
                    client.process_id or 0
                )
            )
            if accepted and not permission_accepted:
                permission_accepted = True
            return None

        return wait_until(
            recording_or_permission,
            f"{actor} microphone capture to start",
            timeout=30,
        )

    def _prove_voice_cancel_and_discard(
        self,
        actor: str,
    ) -> dict[str, Any]:
        client = self.clients[actor]
        client.find_element("[data-chat-voice-record]", 10).click()
        self._wait_for_voice_recording(actor)
        client.find_element("[data-chat-voice-cancel]", 10).click()
        cancelled = wait_until(
            lambda: (
                True
                if not client.find_elements(
                    "[data-chat-voice-recording], [data-chat-voice-draft]"
                )
                else None
            ),
            f"{actor} voice cancellation",
            timeout=10,
        )
        self.assert_condition(
            "voice_cancel_boundary",
            cancelled is True,
            "cancel removed the recording without creating a draft",
        )
        preview = self._record_until_preview(actor, minimum_seconds=1)
        client.find_element("[data-chat-voice-discard]", 10).click()
        discarded = wait_until(
            lambda: (
                True
                if not client.find_elements("[data-chat-voice-draft]")
                else None
            ),
            f"{actor} voice preview discard",
            timeout=10,
        )
        self.assert_condition(
            "voice_preview_discard",
            discarded is True and int(preview["durationMs"]) > 0,
            json.dumps(preview, sort_keys=True),
        )
        return {"cancelled": cancelled, "preview": preview}

    def _prove_voice_message(
        self,
        actor: str,
        peer: str,
        conversation_id: str,
    ) -> dict[str, Any]:
        client = self.clients[actor]
        composer = client.find_element(
            f'[data-chat-composer="{conversation_id}"]',
            10,
        )
        revision = int(
            composer.get_attribute("data-chat-send-outcome-revision") or 0
        )
        preview = self._record_until_preview(actor, minimum_seconds=2)
        client.find_element("[data-chat-voice-send]", 10).click()
        outcome = wait_until(
            lambda: self._composer_outcome(
                client,
                conversation_id,
                revision,
            ),
            "recorded voice send outcome",
            timeout=180,
        )
        if (
            outcome["state"] != "pending"
            or not outcome["messageId"]
            or len(outcome["attachmentIds"]) != 1
        ):
            raise GateError(f"recorded voice send outcome is invalid: {outcome}")
        message_id = str(outcome["messageId"])
        attachment_id = str(outcome["attachmentIds"][0])
        projections: dict[str, Any] = {}
        hashes: dict[str, str] = {}
        paths: dict[str, Path] = {}
        for participant in (actor, peer):
            attachment = wait_until(
                lambda participant=participant: self._engine_attachment(
                    participant,
                    conversation_id,
                    message_id,
                    attachment_id,
                ),
                f"{participant} recorded voice Engine projection",
                timeout=180,
            )
            projections[participant] = attachment
            paths[participant] = self._open_attachment(
                participant,
                attachment_id,
            )
            hashes[participant] = self.runtime_binding.native_file_sha256(
                participant,
                paths[participant],
            )
        persisted_duration = int(
            projections[actor].get("durationMs")
            or projections[actor].get("duration_ms")
            or 0
        )
        metadata_evidence = {
            "preview": preview,
            "messageId": message_id,
            "attachmentId": attachment_id,
            "projections": projections,
        }
        self.assert_condition(
            "voice_metadata_persisted",
            projections[actor] == projections[peer]
            and projections[actor].get("contentKind") == "voice_note"
            and persisted_duration == int(preview["durationMs"])
            and str(projections[actor].get("mimeType") or "").startswith(
                "audio/"
            ),
            json.dumps(metadata_evidence, sort_keys=True),
        )
        self.assert_condition(
            "voice_byte_identity",
            len(set(hashes.values())) == 1
            and next(iter(hashes.values()), "") != "",
            json.dumps(hashes, sort_keys=True),
        )

        peer_client = self.clients[peer]
        voice_selector = (
            f'[data-message-ulid="{message_id}"] '
            f'[data-messaging-attachment-id="{attachment_id}"]'
            '[data-chat-voice-note="true"]'
        )
        last_voice_surface: dict[str, Any] = {}

        def ready_voice_surface() -> Any:
            nonlocal last_voice_surface
            last_voice_surface = self._voice_surface_snapshot(
                peer_client,
                message_id,
                attachment_id,
            )
            if (
                last_voice_surface.get("messageVisible") is True
                and last_voice_surface.get("attachmentVisible") is True
                and last_voice_surface.get("voiceNote") == "true"
                and last_voice_surface.get("attachmentState") == "ready"
            ):
                return peer_client.find_element(voice_selector, 1)
            return None

        try:
            voice = wait_until(
                ready_voice_surface,
                "receiver recorded voice playback surface",
                timeout=60,
            )
        except GateError as error:
            raise GateError(
                f"{error}; surface="
                f"{json.dumps(last_voice_surface, sort_keys=True)}"
            ) from error
        seek = voice.find_element("css selector", "[data-chat-voice-seek]")
        peer_client.execute_script(
            """
            const input = arguments[0];
            const value = arguments[1];
            const setter = Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype,
              'value',
            )?.set;
            if (!setter) throw new Error('range setter missing');
            setter.call(input, value);
            input.dispatchEvent(new InputEvent('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            """,
            seek,
            str(max(0.5, persisted_duration / 2_000)),
        )
        sought = wait_until(
            lambda: (
                int(
                    voice.get_attribute("data-chat-voice-position-ms")
                    or 0
                )
                if int(
                    voice.get_attribute("data-chat-voice-position-ms")
                    or 0
                )
                > 0
                else None
            ),
            "receiver recorded voice seek",
            timeout=10,
        )
        toggle = voice.find_element(
            "css selector",
            "[data-chat-voice-toggle]",
        )
        toggle.click()
        wait_until(
            lambda: (
                True
                if toggle.get_attribute("data-chat-voice-playing") == "true"
                else None
            ),
            "receiver recorded voice playback",
            timeout=10,
        )
        toggle.click()
        paused = wait_until(
            lambda: (
                True
                if toggle.get_attribute("data-chat-voice-playing") == "false"
                else None
            ),
            "receiver recorded voice pause",
            timeout=10,
        )
        playback_evidence = {
            "durationMs": persisted_duration,
            "positionMs": sought,
            "paused": paused,
        }
        self.assert_condition(
            "voice_playback_progress_seek_pause",
            persisted_duration > 0 and sought > 0 and paused is True,
            json.dumps(playback_evidence, sort_keys=True),
        )
        peer_client.execute_script(
            """
            const input = arguments[0];
            const maximum = Number(input.max || 0);
            const value = Math.max(0, maximum - 0.1);
            const setter = Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype,
              'value',
            )?.set;
            if (!setter) throw new Error('range setter missing');
            setter.call(input, String(value));
            input.dispatchEvent(new InputEvent('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            """,
            seek,
        )
        toggle.click()
        ended = wait_until(
            lambda: (
                True
                if voice.get_attribute("data-chat-voice-playback-state")
                == "ended"
                else None
            ),
            "receiver recorded voice terminal end state",
            timeout=10,
        )
        playback_evidence["ended"] = ended
        self.assert_condition(
            "voice_playback_terminal_end",
            ended is True
            and int(
                voice.get_attribute("data-chat-voice-position-ms") or 0
            )
            > 0,
            json.dumps(playback_evidence, sort_keys=True),
        )

        paths[peer].unlink()
        peer_client.execute_script(
            """
            const root = document.querySelector(arguments[0]);
            const audio = root?.querySelector('audio');
            if (!audio) throw new Error('voice audio element missing');
            audio.load();
            """,
            voice_selector,
        )
        retry = wait_until(
            lambda: next(
                (
                    item
                    for item in peer_client.find_elements(
                        f'{voice_selector} [data-chat-voice-retry]'
                    )
                    if item.is_displayed()
                ),
                None,
            ),
            "receiver recorded voice terminal retry",
            timeout=15,
        )
        retry.click()
        recovered = wait_until(
            lambda: (
                element
                if (
                    element := peer_client.find_element(
                        voice_selector,
                        5,
                    )
                ).get_attribute("data-messaging-attachment-open-state")
                == "ready"
                and element.get_attribute("data-chat-voice-terminal")
                == "false"
                else None
            ),
            "receiver recorded voice cache recovery",
            timeout=60,
        )
        recovered_path = self._open_attachment(peer, attachment_id)
        recovered_hash = self.runtime_binding.native_file_sha256(
            peer,
            recovered_path,
        )
        self.assert_condition(
            "voice_playback_failure_retry",
            recovered is not None
            and recovered_hash == hashes[actor],
            json.dumps(
                {
                    "senderHash": hashes[actor],
                    "recoveredHash": recovered_hash,
                },
                sort_keys=True,
            ),
        )
        return {
            **metadata_evidence,
            "hashes": hashes,
            "paths": {
                participant: str(path)
                for participant, path in paths.items()
            },
            "playback": playback_evidence,
            "recoveredHash": recovered_hash,
        }

    def prove_additional_journey_assertions(self) -> None:
        actor = self.direction_order[0]
        peer = next(name for name in self.clients if name != actor)
        conversation_id = self._active_conversation_id(self.clients[actor])
        with tempfile.TemporaryDirectory(prefix="pt-chat-rich-voice-") as raw:
            root = Path(raw)
            empty_file = root / "empty.png"
            empty_file.write_bytes(b"")
            source_file = root / "rich-attachment.bin"
            source_file.write_bytes(
                b"peers-touch-chat-rich-voice-byte-identity\n"
            )
            retry_evidence = self._prove_attachment_failure(
                actor,
                empty_file,
            )
            cancel_geometry = self._cancel_screenshot(actor)
            confirm_geometry = self._confirm_screenshot(actor)
            attachment = self._prove_file_attachment(
                actor,
                peer,
                conversation_id,
                source_file,
            )
            voice_boundaries = self._prove_voice_cancel_and_discard(actor)
            voice = self._prove_voice_message(
                actor,
                peer,
                conversation_id,
            )

        peer_client = self._restart_client_preserving_state(peer)
        enter_chat_page(peer_client)
        peer_client.find_element(
            f'[data-pt-conversation-item="{conversation_id}"]',
            STEP_TIMEOUT,
        ).click()
        attachment_message_id = str(attachment["messageId"])
        attachment_id = str(attachment["attachmentId"])
        voice_message_id = str(voice["messageId"])
        voice_attachment_id = str(voice["attachmentId"])
        wait_until(
            lambda: self._engine_message(
                peer,
                conversation_id,
                attachment_message_id,
            ),
            "restarted receiver rich attachment projection",
            timeout=60,
        )
        attachment_path = self._open_attachment(peer, attachment_id)
        attachment_hash = self.runtime_binding.native_file_sha256(
            peer,
            attachment_path,
        )
        attachment_restart_evidence = {
            "messageId": attachment_message_id,
            "attachmentId": attachment_id,
            "expectedHash": attachment["expectedHash"],
            "actualHash": attachment_hash,
        }
        self.assert_condition(
            "rich_attachment_restart_recovery",
            attachment_hash == attachment["expectedHash"],
            json.dumps(attachment_restart_evidence, sort_keys=True),
        )
        restarted_voice_metadata = wait_until(
            lambda: self._engine_attachment(
                peer,
                conversation_id,
                voice_message_id,
                voice_attachment_id,
            ),
            "restarted receiver voice projection",
            timeout=60,
        )
        voice_path = self._open_attachment(peer, voice_attachment_id)
        voice_hash = self.runtime_binding.native_file_sha256(
            peer,
            voice_path,
        )
        voice_restart_evidence = {
            "messageId": voice_message_id,
            "attachmentId": voice_attachment_id,
            "metadata": restarted_voice_metadata,
            "expectedHash": voice["hashes"][actor],
            "actualHash": voice_hash,
        }
        self.assert_condition(
            "voice_restart_recovery",
            isinstance(restarted_voice_metadata, dict)
            and restarted_voice_metadata.get("contentKind") == "voice_note"
            and int(restarted_voice_metadata.get("durationMs") or 0) > 0
            and voice_hash == voice["hashes"][actor],
            json.dumps(voice_restart_evidence, sort_keys=True),
        )
        self.report.runtime["richVoiceJourney"] = {
            "actor": actor,
            "peer": peer,
            "conversationId": conversation_id,
            "retry": retry_evidence,
            "screenshotCancel": cancel_geometry,
            "screenshotConfirm": confirm_geometry,
            "attachment": attachment,
            "voiceBoundaries": voice_boundaries,
            "voice": voice,
            "attachmentRestart": attachment_restart_evidence,
            "voiceRestart": voice_restart_evidence,
        }

    def run(self) -> dict[str, Any]:
        result = super().run()
        assertion_names = {assertion.name for assertion in self.report.assertions}
        missing = REQUIRED_RICH_VOICE_ASSERTIONS - assertion_names
        if missing:
            raise GateError(
                f"rich voice assertions are missing: {sorted(missing)}"
            )
        result["journey"] = "rich-media-recorded-voice"
        self.report.runtime["journey"] = "rich-media-recorded-voice"
        return result


def main() -> int:
    selected = selected_native_runtime(GATE_ID)
    gate: AcceptanceGate = LifecycleRichVoiceGate(
        manifest=selected.manifest,
        actor_manifest=selected.actor_manifest,
        runtime_binding=selected.binding,
    )
    return gate.execute()


if __name__ == "__main__":
    raise SystemExit(main())
