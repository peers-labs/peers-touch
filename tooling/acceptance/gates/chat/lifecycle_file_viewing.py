"""Visible file-detail assertions for the existing CHAT-J03 native journey.

Cache readback is intentionally absent: these checks select production cards,
read visible content, reopen the detail and cancel the real destination picker.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

from selenium.webdriver.common.keys import Keys

from tooling.acceptance.core import GateError
from tooling.acceptance.drivers.native import NativeDesktopRuntimeBinding, NativeKey
from tooling.acceptance.drivers.tauri import TauriSession
from tooling.acceptance.gates.chat.lifecycle_file_fixtures import FILE_FORMAT_KINDS
from tooling.acceptance.gates.chat.native_support import wait_until


REQUIRED_FILE_VIEWING_ASSERTIONS = {
    f"rich_file_{role}_{check}"
    for role in ("sender", "receiver")
    for check in ("detail", "text_preview", "close_reopen", "save_cancelled")
}

# Missing native observations cannot inherit historical rich-media proof.
# These accepted obligations stay mandatory through injection and execution.
REQUIRED_FILE_VIEWING_ASSERTIONS.update({
    "rich_file_supported_format_matrix",
    "rich_file_cancel_retry",
    "rich_file_native_preview",
    "rich_file_external_copy_isolation",
    "rich_file_export_survives_eviction",
    "rich_file_scope_fencing",
})
REQUIRED_FILE_VIEWING_ASSERTIONS.update(
    f"rich_file_format_{format_id}_{role}"
    for format_id in FILE_FORMAT_KINDS
    for role in ("sender", "receiver")
)


def prove_file_format_preview(
    *,
    client: TauriSession,
    attachment_id: str,
    source: Path,
    format_id: str,
    role: str,
    assert_condition: Callable[[str, bool, str], Any],
) -> dict[str, Any]:
    root = f'[data-messaging-attachment-id="{attachment_id}"]'
    card = f'{root}[role="button"], {root} [role="button"], {root} [data-chat-attachment-open]'
    detail = f'[data-chat-file-detail="{attachment_id}"]'
    kind = FILE_FORMAT_KINDS[format_id]
    client.find_element(card, 30).click()
    try:
        wait_until(
            lambda: next(
                (item for item in client.find_elements(
                    f'{detail} [data-chat-file-state="ready"]'
                ) if item.is_displayed()), None,
            ),
            f"{role} {format_id} verified detail", timeout=60,
        )
        def decoded() -> dict[str, Any] | None:
            observation = client.execute_script(
                """
                const detail = document.querySelector(arguments[0]);
                const kind = arguments[1];
                const preview = detail?.querySelector('.chat-file-preview-resource');
                if (!detail || !preview) return null;
                const node = preview.querySelector(kind === 'image' ? 'img'
                    : kind === 'text' ? 'pre' : kind === 'pdf' ? 'canvas' : kind);
                const result = {
                    filename: detail.dataset.chatFileName,
                    size: detail.dataset.chatFileSize,
                    unsafe: Boolean(preview.querySelector('iframe,object,embed,script'))
                        || Boolean(window.__attachmentExecuted),
                    actions: ['open-external', 'save-copy'].every(intent => {
                        const button = detail.querySelector(`[data-chat-file-action="${intent}"]`);
                        return button && !button.disabled;
                    }),
                };
                if (kind === 'image') {
                    result.width = node?.naturalWidth || 0;
                    result.height = node?.naturalHeight || 0;
                    if (result.width !== 2 || result.height !== 2) return null;
                } else if (kind === 'audio' || kind === 'video') {
                    result.duration = node?.duration || 0;
                    result.controls = Boolean(node?.controls);
                    result.error = node?.error?.code || 0;
                    result.width = node?.videoWidth || 0;
                    result.height = node?.videoHeight || 0;
                    if (!(result.duration > 0) || result.error || !result.controls
                        || (kind === 'video' && (result.width !== 96 || result.height !== 64))) return null;
                } else if (kind === 'text') {
                    if (!node) return null;
                    result.text = node.textContent.trim();
                } else if (kind === 'pdf') {
                    if (!node?.width || !node?.height) return null;
                    const pixels = node.getContext('2d').getImageData(0, 0, node.width, node.height).data;
                    let drawn = false;
                    for (let index = 0; index < pixels.length; index += 16) {
                        if (pixels[index + 3] && pixels[index] < 240) { drawn = true; break; }
                    }
                    if (!drawn) return null;
                    result.page = node.getAttribute('aria-label');
                    result.pixels = node.width * node.height;
                } else {
                    result.fallback = preview.textContent.trim();
                    result.unavailable = preview.dataset.chatFilePreviewUnavailable === 'true';
                    result.inlineDecoder = Boolean(preview.querySelector('pre,img,audio,video,canvas'));
                    result.nativePreview = Boolean(detail.querySelector('[data-chat-file-action="preview"]'));
                    if (!result.fallback || !result.unavailable || result.inlineDecoder) return null;
                }
                return result;
                """, detail, kind,
            )
            return observation if isinstance(observation, dict) else None
        observation = wait_until(decoded, f"{role} real {format_id} decoder result", timeout=30)
        valid = (
            observation["filename"] == source.name
            and observation["size"] == str(source.stat().st_size)
            and observation["actions"] and not observation["unsafe"]
        )
        if kind == "text":
            valid = valid and observation["text"] == source.read_text().strip()
        if kind == "pdf":
            client.find_element(f"{detail} .chat-pdf-navigation button:last-child", 5).click()
            next_page = wait_until(
                lambda: value if (
                    (value := decoded()) and value.get("page") != observation["page"]
                ) else None,
                f"{role} real PDF next page", timeout=20,
            )
            valid = valid and observation["pixels"] <= 4 * 1024 * 1024
            observation["nextPage"] = next_page["page"]
        if kind == "office":
            valid = valid and observation["nativePreview"]
        assert_condition(
            f"rich_file_format_{format_id}_{role}",
            bool(valid), json.dumps(observation, sort_keys=True),
        )
        return observation
    finally:
        if client.find_elements(detail):
            client.find_element(".ant-modal-close", 5).click()
            wait_until(lambda: not client.find_elements(detail), f"{role} {format_id} closed", timeout=10)


def prove_file_download_recovery(
    *,
    client: TauriSession,
    attachment_id: str,
    resume_transport: Callable[[], None],
    assert_condition: Callable[[str, bool, str], Any],
) -> dict[str, Any]:
    """The caller keeps the receiver's real transport interrupted until retry."""
    card = f'[data-messaging-attachment-id="{attachment_id}"][role="button"]'
    detail = f'[data-chat-file-detail="{attachment_id}"]'

    def wait_state(state: str) -> Any:
        return wait_until(
            lambda: next(
                (
                    item for item in client.find_elements(
                        f'{detail} [data-chat-file-state="{state}"]'
                    ) if item.is_displayed()
                ),
                None,
            ),
            f"receiver file detail {state}",
            timeout=60,
        )

    client.find_element(card, 30).click()
    wait_state("downloading")
    progress = client.find_element(f"{detail} progress", 10)
    total = float(progress.get_attribute("max") or 0)
    value = float(progress.get_attribute("value") or 0)
    client.find_element(".ant-modal-close", 5).click()
    wait_until(lambda: not client.find_elements(detail), "pending detail closed", timeout=10)
    client.find_element(card, 10).click()
    wait_state("downloading")
    client.find_element(f'{detail} [data-chat-file-action="cancel"]', 10).click()
    wait_state("cancelled")
    client.find_element(".ant-modal-close", 5).click()
    wait_until(lambda: not client.find_elements(detail), "cancelled detail closed", timeout=10)
    client.find_element(card, 10).click()
    wait_state("cancelled")
    resume_transport()
    client.find_element(f'{detail} [data-chat-file-action="retry"]', 10).click()
    wait_state("ready")
    recovered = client.find_element(detail, 5)
    evidence = {"attachmentId": attachment_id, "total": total, "beforeCancel": value}
    assert_condition(
        "rich_file_cancel_retry",
        total > 0 and 0 <= value <= total
        and recovered.get_attribute("data-chat-file-detail") == attachment_id,
        json.dumps(evidence),
    )
    client.find_element(".ant-modal-close", 5).click()
    wait_until(lambda: not client.find_elements(detail), "recovered detail closed", timeout=10)
    return evidence


def prove_file_detail(
    *,
    client: TauriSession,
    runtime_binding: NativeDesktopRuntimeBinding,
    attachment_id: str,
    source: Path,
    role: str,
    native_click: Callable[[str], None],
    assert_condition: Callable[[str, bool, str], Any],
) -> dict[str, Any]:
    card = f'[data-messaging-attachment-id="{attachment_id}"][role="button"]'
    detail = f'[data-chat-file-detail="{attachment_id}"]'
    ready = f'{detail} [data-chat-file-state="ready"]'
    source_text = source.read_text().strip()

    def open_detail() -> Any:
        client.find_element(card, 30).click()
        return client.find_element(detail, 10)

    def ready_detail() -> Any:
        return wait_until(
            lambda: next(
                (item for item in client.find_elements(ready) if item.is_displayed()),
                None,
            ),
            f"{role} visible verified file detail",
            timeout=60,
        )

    opened = open_detail()
    name = opened.get_attribute("data-chat-file-name")
    size = opened.get_attribute("data-chat-file-size")
    title = client.find_element(".ant-modal-title", 10).text
    assert_condition(
        f"rich_file_{role}_detail",
        opened.is_displayed()
        and name == source.name
        and title == source.name
        and size == str(source.stat().st_size),
        json.dumps({"filename": name, "title": title, "size": size}),
    )
    ready_detail()
    preview = wait_until(
        lambda: next(
            (
                item for item in client.find_elements(f"{detail} pre")
                if item.is_displayed() and item.text.strip() == source_text
            ),
            None,
        ),
        f"{role} real text preview",
        timeout=30,
    )
    actions = {
        intent: client.find_element(f'{detail} [data-chat-file-action="{intent}"]', 5)
        for intent in ("open-external", "save-copy")
    }
    assert_condition(
        f"rich_file_{role}_text_preview",
        preview.text.strip() == source_text
        and all(action.is_displayed() and action.is_enabled() for action in actions.values()),
        json.dumps({"filename": name, "preview": preview.text, "actions": list(actions)}),
    )
    client.driver.switch_to.active_element.send_keys(Keys.ESCAPE)
    wait_until(
        lambda: not client.find_elements(detail),
        f"{role} file detail teardown",
        timeout=10,
    )
    open_detail()
    ready_detail()
    assert_condition(
        f"rich_file_{role}_close_reopen",
        client.find_element(detail, 5).get_attribute("data-chat-file-name") == source.name
        and client.find_element(f"{detail} pre", 30).text.strip() == source_text,
        "the same card reopened the same original file and verified preview",
    )

    # Physical destination-picker input is allowed only in the declared
    # isolated GUI session. The native adapter enforces this before activation.
    adapter = runtime_binding.native_adapter
    adapter.require_exclusive_input("cancel Chat save-copy destination picker")
    pid = client.process_id
    if pid is None:
        raise GateError("file save cancellation has no owning native process")
    baseline = adapter.focused_control(pid)
    native_click(f'{detail} [data-chat-file-action="save-copy"]')
    panel = wait_until(
        lambda: (
            control if (
                (control := adapter.focused_control(pid)).frontmost
                and control.actual_frontmost_pid == pid
                and (
                    control.dialog_count > baseline.dialog_count
                    or control.window_count > baseline.window_count
                    or control.kind == "application-dialog"
                )
            ) else None
        ),
        f"{role} native save-copy picker",
        timeout=30,
    )
    try:
        adapter.post_key_to_process(pid, NativeKey.ESCAPE)
        cancelled = wait_until(
            lambda: next(
                (
                    item for item in client.find_elements(
                        f'{detail} [data-chat-file-action-result="actionCancelled"]'
                    ) if item.is_displayed()
                ),
                None,
            ),
            f"{role} save-copy cancellation result",
            timeout=30,
        )
        assert_condition(
            f"rich_file_{role}_save_cancelled",
            cancelled.is_displayed()
            and client.find_element(
                f'{detail} [data-chat-file-action="save-copy"]', 5
            ).is_enabled(),
            json.dumps({"picker": panel.to_dict(), "result": cancelled.text}),
        )
    finally:
        # On any failure close only this owned picker before leaving the client.
        if adapter.focused_control(pid).dialog_count > baseline.dialog_count:
            adapter.post_key_to_process(pid, NativeKey.ESCAPE)
    client.find_element(".ant-modal-close", 5).click()
    wait_until(lambda: not client.find_elements(detail), f"{role} detail closed", timeout=10)
    return {"filename": name, "size": size, "preview": source_text, "saveCancelled": True}
