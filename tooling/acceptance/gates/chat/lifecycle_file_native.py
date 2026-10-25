"""Chat-owned macOS file handoff observations, never production-path shortcuts.

Cards and file actions are selected in the real client. OS observations bind a
window/document to that action's new private copy. Cache reads and mutations are
supporting integrity/eviction observations, not substitutes for the native UI.
"""

from __future__ import annotations

import hashlib
import json
import os
import stat
import subprocess
from collections.abc import Callable
from pathlib import Path
from typing import Any

from tooling.acceptance.core import GateError
from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.drivers.native import (
    NativeDesktopRuntimeBinding,
    NativeKey,
    NativeModifier,
)
from tooling.acceptance.drivers.tauri import TauriSession
from tooling.acceptance.gates.chat.native_support import async_harness, wait_until


def _hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _osascript(script: str) -> str:
    result = subprocess.run(
        ("/usr/bin/osascript", "-e", script),
        capture_output=True, text=True, check=False, timeout=10,
    )
    if result.returncode:
        raise GateError(f"Chat native document observation failed: {result.stderr.strip()}")
    return result.stdout.strip()


def _processes() -> dict[int, tuple[int, str]]:
    result = subprocess.run(
        ("/bin/ps", "-axo", "pid=,ppid=,command="),
        capture_output=True, text=True, check=True, timeout=5,
    )
    processes = {}
    for line in result.stdout.splitlines():
        fields = line.strip().split(None, 2)
        if len(fields) == 3:
            processes[int(fields[0])] = (int(fields[1]), fields[2])
    return processes


def _windows(pid: int) -> list[str]:
    # Inspect only the process bound to this action, never the global AX tree.
    value = _osascript(f"""
        tell application "System Events"
          if not (exists (application process whose unix id is {pid})) then return ""
          set targetProcess to first application process whose unix id is {pid}
          set titles to name of every window of targetProcess
          set AppleScript's text item delimiters to linefeed
          return titles as text
        end tell
    """)
    return value.splitlines() if value else []


class MacOSFileObservation:
    def __init__(self, client: TauriSession, binding: NativeDesktopRuntimeBinding):
        if binding.cell_id != "desktop-macos-native":
            raise BlockedError(
                reason="Chat native file OS oracle is not implemented for this runtime cell",
                resource=f"{binding.cell_id}:file-handoff-oracle",
            )
        binding.native_adapter.require_exclusive_input("observe Chat native file handoff")
        if client.process_id is None:
            raise GateError("Chat file action has no owning native process")
        self.client = client
        self.binding = binding
        self.pid = client.process_id
        self.storage = Path(client.storage_root).resolve(strict=True)
        self.cache = self.storage / "peers-touch" / "desktop" / "cache"
        self.handoff = self.cache / "file-handoff"

    def copies(self) -> set[Path]:
        if not self.handoff.exists():
            return set()
        copies = set()
        for path in self.handoff.glob("*/*/*"):
            if path.is_file():
                if path.is_symlink() or not path.resolve().is_relative_to(self.handoff.resolve()):
                    raise GateError("Chat handoff contains an unowned path")
                copies.add(path)
        return copies

    def new_copy(self, before: set[Path], source: Path) -> Path:
        def selected() -> Path | None:
            paths = self.copies() - before
            if len(paths) > 1:
                raise GateError("one Chat file action created multiple handoff copies")
            return next(iter(paths), None)
        path = wait_until(selected, "new Chat handoff copy", timeout=15)
        if (
            path.name != source.name or _hash(path) != _hash(source)
            or stat.S_IMODE(path.stat().st_mode) != 0o600
            or stat.S_IMODE(path.parent.stat().st_mode) != 0o700
        ):
            raise GateError("Chat handoff bytes, safe filename or private permissions differ")
        return path

    def screenshot(self, path: Path) -> str:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.binding.native_adapter.capture_screenshot(path)
        return str(path)

    def discard(self, path: Path) -> None:
        # Exact action-owned copy only; exports and unrelated copies are excluded.
        if path in self.copies():
            path.unlink()
            path.parent.rmdir()


def _open_detail(client: TauriSession, attachment_id: str) -> str:
    root = f'[data-messaging-attachment-id="{attachment_id}"]'
    client.find_element(
        f'{root}[role="button"], {root} [data-chat-attachment-open]', 30,
    ).click()
    detail = f'[data-chat-file-detail="{attachment_id}"]'
    wait_until(
        lambda: next((item for item in client.find_elements(
            f'{detail} [data-chat-file-state="ready"]',
        ) if item.is_displayed()), None),
        "verified Chat file detail", timeout=60,
    )
    return detail


def _close_detail(client: TauriSession, detail: str) -> None:
    if client.find_elements(detail):
        client.find_element(".ant-modal-close", 5).click()
        wait_until(lambda: not client.find_elements(detail), "Chat detail closed", timeout=10)


def _completed(client: TauriSession, detail: str) -> Any:
    return wait_until(
        lambda: next((item for item in client.find_elements(
            f'{detail} [data-chat-file-action-result="completed"]',
        ) if item.is_displayed()), None),
        "Chat native action completed", timeout=30,
    )


def prove_native_file_preview(
    *, client: TauriSession, runtime_binding: NativeDesktopRuntimeBinding,
    attachment_id: str, source: Path, evidence_root: Path,
    native_click: Callable[[str], None], expected_text: str,
) -> dict[str, Any]:
    if not expected_text:
        raise GateError("native document preview needs a fixture content oracle")
    observer = MacOSFileObservation(client, runtime_binding)
    detail = _open_detail(client, attachment_id)
    before = observer.copies()
    preview_pid = None
    copy = None
    try:
        native_click(f'{detail} [data-chat-file-action="preview"]')
        copy = observer.new_copy(before, source)

        def owned_preview() -> int | None:
            matches = [pid for pid, (parent, command) in _processes().items()
                       if parent == observer.pid
                       and command.startswith("/usr/bin/qlmanage -p ")
                       and command.endswith(str(copy))]
            if len(matches) > 1:
                raise GateError("Chat preview process identity is ambiguous")
            return matches[0] if matches else None

        preview_pid = wait_until(owned_preview, "owned Quick Look process", timeout=15)
        def document_windows() -> list[str] | None:
            values = _windows(preview_pid)
            return values if any(source.name in title for title in values) else None
        titles = wait_until(
            document_windows,
            "Quick Look window for the selected original filename", timeout=20,
        )
        def document_content() -> bool:
            value = _osascript(f"""
                tell application "System Events"
                  set targetProcess to first application process whose unix id is {preview_pid}
                  set nodes to entire contents of window 1 of targetProcess
                  if (count of nodes) > 1000 then error "preview AX tree exceeds bound"
                  repeat with node in nodes
                    try
                      set content to value of attribute "AXValue" of node as text
                      if content contains {json.dumps(expected_text)} then return "matched"
                    end try
                  end repeat
                  return "unproven"
                end tell
            """)
            return value == "matched"
        wait_until(document_content, "Quick Look decoded document content", timeout=20)
        _completed(client, detail)
        screenshot = observer.screenshot(evidence_root / "native-preview.png")
        _close_detail(client, detail)
        wait_until(
            lambda: preview_pid not in _processes() and not copy.exists(),
            "Quick Look and its private copy revoked on detail close", timeout=15,
        )
        return {"attachmentId": attachment_id, "filename": source.name,
                "previewPid": preview_pid, "windowTitles": titles,
                "sha256": _hash(source), "screenshot": screenshot,
                "contentMatched": True, "revoked": True}
    finally:
        _close_detail(client, detail)
        if preview_pid is not None and preview_pid in _processes():
            # Kill only the source-bound child, never a shared Quick Look service.
            parent, command = _processes().get(preview_pid, (-1, ""))
            if parent == observer.pid and command.endswith(str(copy)):
                os.kill(preview_pid, 15)
                wait_until(lambda: preview_pid not in _processes(),
                           "owned Quick Look cleanup", timeout=10)
        if copy is not None:
            observer.discard(copy)


def _textedit_document(path: Path, operation: str = "read") -> str:
    quoted = json.dumps(str(path))
    commands = {
        "read": "return text of targetDocument",
        "close": "close targetDocument saving no",
        # The live external application writes its own document. The client
        # cache path is never supplied to this OS operation.
        "edit": 'set text of targetDocument to "edited-by-external-application"\n'
                "save targetDocument",
    }
    return _osascript(f"""
        tell application id "com.apple.TextEdit"
          set targetDocument to first document whose path is {quoted}
          {commands[operation]}
        end tell
    """)


def _require_textedit_default(source: Path) -> bool:
    # Do not change the operator's default application or launch an unowned
    # editor. Other default-app cells need their own native document oracle.
    script = """
        ObjC.import('AppKit');
        function run(args) {
            const file = $.NSURL.fileURLWithPath($(args[0]));
            const app = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL(file);
            if (!app) return '';
            return ObjC.unwrap($.NSBundle.bundleWithURL(app).bundleIdentifier);
        }
    """
    result = subprocess.run(
        ("/usr/bin/osascript", "-l", "JavaScript", "-e", script, str(source)),
        capture_output=True, text=True, check=True, timeout=10,
    )
    if result.stdout.strip() != "com.apple.TextEdit":
        raise BlockedError(
            reason="Chat external-edit oracle requires TextEdit as the current text-file handler",
            resource="desktop-macos-native:default-text-application",
        )
    return _osascript("""
        tell application "System Events"
          return exists (application process whose bundle identifier is "com.apple.TextEdit")
        end tell
    """) == "true"


def prove_external_file_isolation(
    *, client: TauriSession, runtime_binding: NativeDesktopRuntimeBinding,
    attachment_id: str, source: Path, cache_path: Path, evidence_root: Path,
    native_click: Callable[[str], None],
) -> dict[str, Any]:
    observer = MacOSFileObservation(client, runtime_binding)
    if not cache_path.resolve(strict=True).is_relative_to(observer.storage):
        raise GateError("external-copy oracle cache is outside the bound client")
    already_running = _require_textedit_default(source)
    detail = _open_detail(client, attachment_id)
    before = observer.copies()
    copy = None
    try:
        native_click(f'{detail} [data-chat-file-action="open-external"]')
        copy = observer.new_copy(before, source)

        def document() -> str | None:
            running = _osascript("""
                tell application "System Events"
                  return exists (application process whose bundle identifier is "com.apple.TextEdit")
                end tell
            """)
            if running != "true":
                return None
            try:
                return _textedit_document(copy)
            except GateError:
                return None

        content = wait_until(document, "external TextEdit document at the handoff path", timeout=20)
        if content != source.read_text().strip():
            raise GateError("external application displayed different attachment bytes")
        _completed(client, detail)
        external_pid = int(_osascript("""
            tell application "System Events"
              return unix id of first application process whose bundle identifier is "com.apple.TextEdit"
            end tell
        """))
        titles = _windows(external_pid)
        if not any(source.name in title for title in titles):
            raise GateError("external file has no visible native document window")
        screenshot = observer.screenshot(evidence_root / "external-document.png")
        _textedit_document(copy, "edit")
        wait_until(lambda: copy.read_text().strip() == "edited-by-external-application",
                   "external application persisted its private-copy edit", timeout=10)
        if _hash(cache_path) != _hash(source):
            raise GateError("external application mutated the immutable attachment cache")
        return {"attachmentId": attachment_id, "filename": source.name,
                "application": "com.apple.TextEdit", "windowTitles": titles,
                "cacheSha256": _hash(cache_path), "copySha256": _hash(copy),
                "screenshot": screenshot, "isolated": True}
    finally:
        try:
            if copy is not None:
                # An observation timeout may still have left the exact document
                # open. Cleanup never addresses another window or document.
                _osascript(f"""
                    if application id "com.apple.TextEdit" is running then
                      tell application id "com.apple.TextEdit"
                        set matchingDocuments to every document whose path is {json.dumps(str(copy))}
                        repeat with targetDocument in matchingDocuments
                          close targetDocument saving no
                        end repeat
                        if not {str(already_running).lower()} and (count of documents) is 0 then quit
                      end tell
                    end if
                """)
        finally:
            _close_detail(client, detail)
            if copy is not None:
                observer.discard(copy)


def prove_export_retention(
    *, client: TauriSession, runtime_binding: NativeDesktopRuntimeBinding,
    attachment_id: str, source: Path, cache_path: Path, destination: Path,
    evidence_root: Path, native_click: Callable[[str], None],
) -> dict[str, Any]:
    observer = MacOSFileObservation(client, runtime_binding)
    if destination.exists() or destination.is_symlink():
        raise GateError("Chat export destination must be a new fixture-owned file")
    if not cache_path.resolve(strict=True).is_relative_to(observer.storage):
        raise GateError("eviction fault path is outside the bound client")
    if destination.resolve().is_relative_to(observer.storage):
        raise GateError("export retention requires a destination outside Chat storage")
    destination.parent.mkdir(parents=True, exist_ok=True)
    detail = _open_detail(client, attachment_id)
    adapter = runtime_binding.native_adapter
    baseline = adapter.focused_control(observer.pid)
    try:
        native_click(f'{detail} [data-chat-file-action="save-copy"]')
        panel = wait_until(
            lambda: control if (
                (control := adapter.focused_control(observer.pid)).frontmost
                and control.actual_frontmost_pid == observer.pid
                and (control.dialog_count > baseline.dialog_count
                     or control.window_count > baseline.window_count
                     or control.kind == "application-dialog")
            ) else None,
            "real Chat export destination picker", timeout=30,
        )
        screenshot = observer.screenshot(evidence_root / "export-picker.png")
        adapter.reveal_file_chooser_location_to_process(observer.pid)
        clipboard = adapter.read_clipboard()
        try:
            adapter.write_clipboard(str(destination.parent.resolve()).encode())
            adapter.post_key_to_process(observer.pid, NativeKey.A, modifiers=(NativeModifier.PRIMARY,))
            adapter.post_key_to_process(observer.pid, NativeKey.V, modifiers=(NativeModifier.PRIMARY,))
            wait_until(
                lambda: str(destination.parent.resolve()) in adapter.focused_control(observer.pid).value,
                "native export destination field", timeout=10,
            )
            adapter.post_key_to_process(observer.pid, NativeKey.ENTER)
            wait_until(
                lambda: str(destination.parent.resolve()) not in adapter.focused_control(observer.pid).value,
                "destination folder navigation complete", timeout=10,
            )
            adapter.post_key_to_process(observer.pid, NativeKey.ENTER)
        finally:
            adapter.write_clipboard(clipboard)
        _completed(client, detail)
        wait_until(lambda: destination.is_file(), "real exported file", timeout=15)
        expected = _hash(source)
        if destination.name != source.name or _hash(destination) != expected:
            raise GateError("native export filename or bytes differ")
        _close_detail(client, detail)
        # Exact cache eviction is a fault injection. Recovery must still select
        # the production card and display the verified text in the real client.
        cache_path.unlink()
        if cache_path.exists() or _hash(destination) != expected:
            raise GateError("Chat cache eviction removed or changed the saved export")
        detail = _open_detail(client, attachment_id)
        wait_until(
            lambda: client.find_element(f"{detail} pre", 5).text.strip() == source.read_text().strip(),
            "receiver preview restored after exact cache eviction", timeout=60,
        )
        if _hash(destination) != expected or _hash(cache_path) != expected:
            raise GateError("cache restoration changed the saved export")
        return {"attachmentId": attachment_id, "filename": destination.name,
                "sha256": expected, "picker": panel.to_dict(),
                "screenshot": screenshot, "evictionSurvived": True,
                "visiblePreviewRecovered": True}
    finally:
        if adapter.focused_control(observer.pid).dialog_count > baseline.dialog_count:
            adapter.post_key_to_process(observer.pid, NativeKey.ESCAPE)
        _close_detail(client, detail)


def prove_file_grant_revocation(
    *, client: TauriSession, runtime_binding: NativeDesktopRuntimeBinding,
    attachment_id: str, actor_ptid: str, transition: Callable[[], dict[str, Any]],
    restore: Callable[[], None],
) -> dict[str, Any]:
    """A real visible transition revokes the selected UI's existing grant.

    This primitive proves one boundary only. Account and Station transitions
    require their own bound real UI callbacks and cannot inherit close proof.
    """
    observer = MacOSFileObservation(client, runtime_binding)
    detail = _open_detail(client, attachment_id)
    try:
        grant = async_harness(client, "attachmentFileGrant", {
            "actorPtid": actor_ptid, "attachmentId": attachment_id,
        })
        if (
            not isinstance(grant, dict) or grant.get("attachmentId") != attachment_id
            or not grant.get("assetUrl") or len(grant.get("requests", [])) != 3
        ):
            raise GateError("scope oracle lacks the actual selected UI grant")

        def read_asset() -> dict[str, Any]:
            value = client.driver.execute_async_script("""
                const done = arguments[arguments.length - 1];
                fetch(arguments[0], { headers: { Range: 'bytes=0-31' }, cache: 'no-store' })
                  .then(async response => done({
                    status: response.status, size: (await response.arrayBuffer()).byteLength,
                  })).catch(error => done({ error: String(error) }));
            """, grant["assetUrl"])
            return value if isinstance(value, dict) else {}

        available = read_asset()
        if available.get("status") not in (200, 206) or not available.get("size"):
            raise GateError("scope oracle never observed the selected asset available")
        visible_transition = transition()
        wait_until(lambda: not client.find_elements(detail),
                   "file detail removed by the real scope transition", timeout=15)
        revoked = wait_until(
            lambda: result if (result := read_asset()).get("status") == 404 else None,
            "old UI file grant returns 404 after the visible transition", timeout=15,
        )
        copies = observer.copies()
        baseline = runtime_binding.native_adapter.focused_control(observer.pid)
        rejected = []
        for request in grant["requests"]:
            result = client.driver.execute_async_script("""
                const done = arguments[arguments.length - 1];
                window.__TAURI__.core.invoke('messaging_attachment_file_action', {
                  input: { request_bytes: arguments[0] },
                }).then(value => done({ accepted: true, value }))
                  .catch(error => done({ accepted: false, error: String(error) }));
            """, request)
            if (
                not isinstance(result, dict) or result.get("accepted") is not False
                or not any(code in str(result.get("error", "")) for code in (
                    "FILE_ACCESS_STALE", "FILE_SCOPE_UNAVAILABLE",
                ))
            ):
                raise GateError(f"stale file intent was not explicitly rejected: {result}")
            rejected.append(result["error"])
        after = runtime_binding.native_adapter.focused_control(observer.pid)
        if (
            copies != observer.copies() or after.dialog_count != baseline.dialog_count
            or after.window_count != baseline.window_count
        ):
            raise GateError("replaying a revoked file intent created a native resource")
        return {"attachmentId": attachment_id, "transition": visible_transition,
                "beforeStatus": available["status"], "afterStatus": revoked["status"],
                "rejectedIntents": rejected, "nativeResourcesUnchanged": True}
    finally:
        _close_detail(client, detail)
        restore()
