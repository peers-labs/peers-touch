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
from tooling.acceptance.gates.chat.lifecycle_file_pixels import prove_preview_pixels
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
REQUIRED_FILE_VIEWING_ASSERTIONS.update(
    f"rich_file_scope_{role}_{boundary}"
    for role in ("sender", "receiver")
    for boundary in ("close", "leave_chat", "conversation", "account", "station", "logout")
)


def prove_file_format_preview(
    *,
    client: TauriSession,
    attachment_id: str,
    source: Path,
    format_id: str,
    role: str,
    evidence_root: Path,
    assert_condition: Callable[[str, bool, str], Any],
    scroll_preview: Callable[[str], None],
    retain_evidence: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    root = f'[data-messaging-attachment-id="{attachment_id}"]'
    card = f'{root}[role="button"], {root} [role="button"], {root} [data-chat-attachment-open]'
    detail = f'[data-chat-file-detail="{attachment_id}"]'
    kind = FILE_FORMAT_KINDS[format_id]
    client.find_element(card, 30).click()
    try:
        ready_selector = (
            f'{detail} .chat-file-preview-resource[data-chat-preview-state="ready"], '
            f'{detail} .chat-file-preview-resource[data-chat-preview-state="unavailable"]'
        )
        failed_selector = '.chat-file-modal [data-chat-file-state="failed"]'
        state = wait_until(
            lambda: next(
                (item for item in client.find_elements(
                    f'{ready_selector}, {failed_selector}'
                ) if item.is_displayed()), None,
            ),
            f"{role} {format_id} verified detail", timeout=60,
        )
        # An unsupported-but-downloaded file (archive etc.) intentionally has
        # no inline decoder; only the header transfer failure is terminal.
        if state.get_attribute("data-chat-file-state") == "failed":
            raise GateError(f"{role} {format_id} detail reached a terminal access failure")
        def decoded() -> dict[str, Any] | None:
            observation = client.execute_script(
                """
                const detail = document.querySelector(arguments[0]);
                const kind = arguments[1];
                const preview = detail?.querySelector('.chat-file-preview-resource');
                if (!detail || !preview) return null;
                if (preview.dataset.chatPreviewState !== (kind === 'file' ? 'unavailable' : 'ready')
                    || preview.getAttribute('aria-busy') === 'true') return null;
                const node = preview.querySelector(kind === 'image' ? 'img'
                    : kind === 'text' ? 'pre' : kind === 'pdf' ? 'canvas' : kind);
                const result = {
                    filename: detail.dataset.chatFileName,
                    size: detail.dataset.chatFileSize,
                    unsafe: Boolean(preview.querySelector('object,embed,script'))
                        || Array.from(preview.querySelectorAll('iframe')).some(frame =>
                            kind !== 'office' || frame.getAttribute('sandbox') !== ''
                            || !frame.srcdoc.includes("default-src 'none'"))
                        || Boolean(window.__attachmentExecuted),
                    actions: ['open-external', 'save-copy'].every(intent => {
                        const button = document.querySelector(
                          `.chat-file-modal [data-chat-file-action="${intent}"]`
                        );
                        return button && !button.disabled;
                    }),
                };
                if (kind === 'image') {
                    result.width = node?.naturalWidth || 0;
                    result.height = node?.naturalHeight || 0;
                    if (result.width < 1200 || result.width > 1600
                        || result.height < 800 || result.height > 1600) return null;
                } else if (kind === 'audio' || kind === 'video') {
                    result.duration = node?.duration || 0;
                    result.controls = Boolean(node?.controls);
                    result.error = node?.error?.code || 0;
                    result.width = node?.videoWidth || 0;
                    result.height = node?.videoHeight || 0;
                    if (!(result.duration > 0) || result.error || !result.controls
                        || (kind === 'video' && (result.width !== 1280 || result.height !== 720))) return null;
                } else if (kind === 'text') {
                    if (!node) return null;
                    result.text = node.textContent.trim();
                    result.page = preview.querySelector('.chat-preview-page-status')?.textContent;
                } else if (kind === 'pdf') {
                    if (!node?.width || !node?.height) return null;
                    const pixels = node.getContext('2d').getImageData(0, 0, node.width, node.height).data;
                    let drawn = false;
                    for (let index = 0; index < pixels.length; index += 16) {
                        if (pixels[index + 3] && pixels[index] < 240) { drawn = true; break; }
                    }
                    if (!drawn) return null;
                    result.page = node.getAttribute('aria-label');
                    result.renderedPage = Number(node.dataset.chatRenderedPage || 0);
                    if (!result.renderedPage) return null;
                    result.pixels = node.width * node.height;
                } else if (kind === 'office') {
                    result.frame = Boolean(preview.querySelector('iframe'));
                    result.cells = preview.querySelectorAll('td').length;
                    result.text = preview.querySelector('table')?.textContent || '';
                    result.range = preview.querySelector('table')?.dataset.chatWorkbookRange;
                    result.columnHeaders = preview.querySelectorAll('thead th[scope="col"]').length;
                    result.rowHeaders = preview.querySelectorAll('tbody th[scope="row"]').length;
                    result.renderedPage = Number(preview.querySelector('iframe')?.dataset.chatRenderedPage || 0);
                    if (result.cells && (!result.range || !result.columnHeaders || !result.rowHeaders)) return null;
                    if (result.frame && !result.renderedPage) return null;
                    if (!result.frame && !result.cells) return null;
                } else {
                    result.fallback = preview.textContent.trim();
                    result.unavailable = preview.dataset.chatFilePreviewUnavailable === 'true';
                    result.inlineDecoder = Boolean(preview.querySelector('pre,img,audio,video,canvas'));
                    result.nativePreview = Boolean(document.querySelector('.chat-file-modal [data-chat-file-action="preview"]'));
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
        if kind == "image":
            observation["pixelsEvidence"] = prove_preview_pixels(
                client, detail, source.name, ["HIGH RESOLUTION PREVIEW", "15.36 megapixels"],
                evidence_root, "image",
            )
        if kind == "text":
            source_text = source.read_text()
            valid = valid and observation["text"] == source_text[:32 * 1024].strip()
            if format_id == "oversized_text":
                client.find_element(f"{detail} [data-preview-pager='next']", 5).click()
                next_page = wait_until(
                    lambda: value if (
                        (value := decoded()) and value.get("page") != observation.get("page")
                    ) else None,
                    f"{role} large text next page", timeout=20,
                )
                valid = valid and next_page["text"] == source_text[32 * 1024:64 * 1024].strip()
                observation["nextPage"] = next_page["page"]
        if kind == "pdf":
            observation["pixelsEvidence"] = prove_preview_pixels(
                client, detail, source.name, ["File viewing page 1"], evidence_root, "page-1",
            )
            client.find_element(f"{detail} [data-preview-pager='next']", 5).click()
            next_page = wait_until(
                lambda: value if (
                    (value := decoded()) and value.get("page") != observation["page"]
                ) else None,
                f"{role} real PDF next page", timeout=20,
            )
            valid = valid and observation["pixels"] <= 4 * 1024 * 1024 and next_page["renderedPage"] == 2
            observation["nextPage"] = next_page["page"]
            observation["nextPixelsEvidence"] = prove_preview_pixels(
                client, detail, source.name, ["File viewing page 2"], evidence_root, "page-2",
            )
        if kind == "office":
            if format_id == "workbook":
                valid = valid and "Real workbook preview." in observation["text"] and observation["cells"] <= 2000
                client.find_element(f"{detail} [data-preview-column='next']", 5).click()
                wait_until(
                    lambda: not client.find_element(
                        f"{detail} [data-preview-pager='next']", 5
                    ).get_attribute("disabled"),
                    f"{role} workbook column viewport ready", timeout=20,
                )
                client.find_element(f"{detail} [data-preview-pager='next']", 5).click()
                viewport = wait_until(
                    lambda: value if (
                        (value := decoded()) and "Last workbook viewport." in value["text"]
                    ) else None,
                    f"{role} workbook row and column navigation", timeout=20,
                )
                valid = valid and viewport["range"] == "U101:Y110"
                observation["lastViewport"] = viewport["range"]
                observation["pixelsEvidence"] = prove_preview_pixels(
                    client, detail, source.name, ["Last workbook viewport."], evidence_root, "last-viewport",
                )
            else:
                if format_id == "office":
                    # The zoom segmented control drives the production render.
                    client.find_element(f"{detail} [data-zoom='page']", 5).click()
                    wait_until(decoded, f"{role} Word fit-page rendered", timeout=20)
                    observation["overviewPixelsEvidence"] = prove_preview_pixels(
                        client, detail, source.name, [], evidence_root, "page-1-overview",
                    )
                    # A fitted page is an overview. Read text at original size
                    # and page the actual sandboxed document to its figure.
                    client.find_element(f"{detail} [data-zoom='actual']", 5).click()
                    wait_until(decoded, f"{role} Word original-size rendered", timeout=20)
                    observation["pixelsEvidence"] = prove_preview_pixels(
                        client, detail, source.name, ["Real Office file preview."],
                        evidence_root, "page-1-text",
                    )
                    scroll_preview(f"{detail} .chat-office-frame")
                    observation["figurePixelsEvidence"] = prove_preview_pixels(
                        client, detail, source.name, ["Figure 1", "HIGH RESOLUTION PREVIEW"],
                        evidence_root, "page-1-figure",
                    )
                else:
                    observation["pixelsEvidence"] = prove_preview_pixels(
                        client, detail, source.name,
                        ["Real presentation page 1.", "HIGH RESOLUTION PREVIEW"],
                        evidence_root, "page-1",
                    )
                client.find_element(f"{detail} [data-preview-pager='next']", 5).click()
                wait_until(
                    lambda: value if (value := decoded()) and value["renderedPage"] == 2 else None,
                    f"{role} Office second page rendered", timeout=20,
                )
                observation["nextPixelsEvidence"] = prove_preview_pixels(
                    client, detail, source.name,
                    ["Second page verification"] if format_id == "office" else ["Real presentation page 2."],
                    evidence_root, "page-2",
                )
        if retain_evidence:
            retain_evidence(observation)
        assert_condition(
            f"rich_file_format_{format_id}_{role}",
            bool(valid), json.dumps(observation, sort_keys=True),
        )
        return observation
    except Exception as error:
        evidence_root.mkdir(parents=True, exist_ok=True)
        client.save_screenshot(evidence_root / "failed-detail.png")
        snapshot = client.execute_script(
            """
            const card = document.querySelector(arguments[0]);
            const detail = document.querySelector(arguments[1]);
            return {
                route: location.hash,
                card: card?.outerHTML.slice(0, 6000) || null,
                detail: detail?.outerHTML.slice(0, 6000) || null,
                selectedDetails: Array.from(document.querySelectorAll('[data-chat-file-detail]'))
                    .map(node => node.dataset.chatFileDetail),
            };
            """, root, detail,
        )
        # Supporting Native read only: it cannot turn this failed UI assertion
        # into success or start/retry its transfer. The Suite revokes any grant
        # produced by this observation during its normal failure cleanup.
        try:
            native_read = client.invoke_app_result(
                "messaging_attachment_access",
                {"input": {"attachment_id": attachment_id, "start_download": False}},
                timeout=10,
            )
            snapshot["nativeRead"] = {
                "ok": True,
                "projectionBytes": native_read.get("data"),
            }
        except Exception as native_error:
            snapshot["nativeRead"] = {"ok": False, "error": str(native_error)}
        (evidence_root / "failed-detail.json").write_text(
            json.dumps({"error": str(error), "observation": snapshot}, ensure_ascii=False, indent=2),
        )
        raise
    finally:
        if retain_evidence:
            retain_evidence({})
        if client.find_elements(detail):
            client.find_element(".ant-modal-close", 5).click()
            wait_until(lambda: not client.find_elements(detail), f"{role} {format_id} closed", timeout=10)


def prove_file_download_recovery(
    *,
    client: TauriSession,
    attachment_id: str,
    resume_transport: Callable[[], None],
    wait_interrupted: Callable[[], bool] | None = None,
    assert_condition: Callable[[str, bool, str], Any],
) -> dict[str, Any]:
    """The caller keeps the receiver's real transport interrupted until retry."""
    card = f'[data-messaging-attachment-id="{attachment_id}"][role="button"]'
    detail = f'[data-chat-file-detail="{attachment_id}"]'

    def wait_state(state: str) -> Any:
        selector = (
            f'{detail} .chat-file-preview-resource[data-chat-preview-state="ready"]'
            if state == "ready"
            else f'.chat-file-modal [data-chat-file-state="{state}"]'
        )
        return wait_until(
            lambda: next(
                (
                    item for item in client.find_elements(selector)
                    if item.is_displayed()
                ),
                None,
            ),
            f"receiver file detail {state}",
            timeout=60,
        )

    client.find_element(card, 30).click()
    wait_state("downloading")
    if wait_interrupted is not None:
        # The detail enters "downloading" as soon as the transfer is queued,
        # before the background worker attempts the network fetch. Wait until
        # the armed fault proxy has actually rejected a connection so the
        # interruption overlaps a real in-flight download attempt.
        wait_until(
            wait_interrupted,
            "receiver file download interrupted on the faulted route",
            timeout=60,
        )
    progress = client.find_element(f"{detail} progress", 10)
    total = float(progress.get_attribute("max") or 0)
    value = float(progress.get_attribute("value") or 0)
    client.find_element(".ant-modal-close", 5).click()
    wait_until(lambda: not client.find_elements(detail), "pending detail closed", timeout=10)
    client.find_element(card, 10).click()
    wait_state("downloading")
    client.find_element('.chat-file-modal [data-chat-file-action="cancel"]', 10).click()
    wait_state("cancelled")
    client.find_element(".ant-modal-close", 5).click()
    wait_until(lambda: not client.find_elements(detail), "cancelled detail closed", timeout=10)
    client.find_element(card, 10).click()
    wait_state("cancelled")
    resume_transport()
    client.find_element('.chat-file-modal [data-chat-file-action="retry"]', 10).click()
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
    ready = f'{detail} .chat-file-preview-resource[data-chat-preview-state="ready"]'
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
    # The modal animates in on WebKit, so the element exists with final
    # attributes before it is reported as visible. Wait for visibility before
    # asserting the displayed detail instead of racing the open animation.
    wait_until(opened.is_displayed, f"{role} file detail displayed", timeout=10)
    name = opened.get_attribute("data-chat-file-name")
    size = opened.get_attribute("data-chat-file-size")
    title = client.find_element(".chat-file-modal .chat-file-title", 10).text
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
        intent: client.find_element(
            f'.chat-file-modal [data-chat-file-action="{intent}"]', 5
        )
        for intent in ("open-external", "save-copy")
    }
    assert_condition(
        f"rich_file_{role}_text_preview",
        preview.text.strip() == source_text
        and all(action.is_displayed() and action.is_enabled() for action in actions.values()),
        json.dumps({"filename": name, "preview": preview.text, "actions": list(actions)}),
    )
    client.driver.switch_to.active_element.send_keys(Keys.ESCAPE)
    if client.find_elements(detail):
        # WebKit can leave focus on an inner control where ESC does not bubble
        # to the Ant modal; close it deterministically before the teardown wait.
        client.find_element(".ant-modal-close", 5).click()
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
    native_click('.chat-file-modal [data-chat-file-action="save-copy"]')
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
    def dismiss_panel(*, strict: bool = False) -> None:
        # Two same-bundle app instances can coexist, so a global Escape can
        # reach the sibling process's key window. macOS presses Cancel inside
        # the target process dialog; other platforms dismiss with Escape.
        if adapter.platform == "macos":
            adapter.dismiss_owned_dialog_to_process(
                pid, "Cancel", raise_if_missing=strict
            )
        else:
            adapter.post_key_to_process(pid, NativeKey.ESCAPE)

    try:
        dismiss_panel(strict=True)
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
                '.chat-file-modal [data-chat-file-action="save-copy"]', 5
            ).is_enabled(),
            json.dumps({"picker": panel.to_dict(), "result": cancelled.text}),
        )
    finally:
        # A standalone panel adds a window; a sheet adds a dialog. Close any
        # panel still owned by this process before leaving the client.
        remaining = adapter.focused_control(pid)
        if (
            remaining.dialog_count > baseline.dialog_count
            or remaining.window_count > baseline.window_count
        ):
            dismiss_panel()
    client.find_element(".ant-modal-close", 5).click()
    wait_until(lambda: not client.find_elements(detail), f"{role} detail closed", timeout=10)
    return {"filename": name, "size": size, "preview": source_text, "saveCancelled": True}
