from __future__ import annotations

from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

from selenium.common.exceptions import TimeoutException
from selenium.webdriver.support.ui import WebDriverWait

from tooling.acceptance.core import GateError
from tooling.acceptance.drivers.native import (
    MouseAction,
    NativeControlSnapshot,
    NativeDesktopRuntimeBinding,
    NativeKey,
    NativeModifier,
)
from tooling.acceptance.drivers.tauri import TauriSession


DEFAULT_TIMEOUT_SECONDS = 30.0
POLL_SECONDS = 0.05
REVEAL_ATTEMPTS = 4


def select_native_file(
    *,
    actor: str,
    client: TauriSession,
    sessions: Sequence[TauriSession],
    runtime_binding: NativeDesktopRuntimeBinding,
    source_path: Path,
    trigger: Callable[[], Any],
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    """Select one file through the platform-owned native chooser."""

    process_id = client.process_id
    if process_id is None:
        raise GateError(f"{actor} Native file chooser has no owning process")
    resolved_source = source_path.resolve()
    if not resolved_source.is_file():
        raise GateError(
            f"Native file selection source is missing: {resolved_source}"
        )
    selected_path = runtime_binding.stage_native_file(
        actor,
        resolved_source,
    )
    adapter = runtime_binding.native_adapter
    all_sessions = tuple(sessions)
    cooperative_activation = runtime_binding.request_cooperative_activation(
        client,
        all_sessions,
    )

    def activate_and_observe() -> NativeControlSnapshot:
        if cooperative_activation:
            runtime_binding.request_cooperative_activation(
                client,
                all_sessions,
            )
            return adapter.focused_control(process_id)
        return adapter.activate_and_focused_control(process_id)

    def native_app_ready(_: Any) -> NativeControlSnapshot | None:
        control = activate_and_observe()
        return (
            control
            if control.window_count >= 1
            and control.main_window
            and control.frontmost
            and control.kind
            not in {"list", "text-field", "application-dialog"}
            else None
        )

    baseline = WebDriverWait(
        client.driver,
        timeout_seconds,
        poll_frequency=POLL_SECONDS,
    ).until(native_app_ready)
    trigger()

    def panel_open(control: NativeControlSnapshot) -> bool:
        return (
            control.window_count > baseline.window_count
            or control.dialog_count > baseline.dialog_count
            or (
                control.kind in {"list", "text-field"}
                and control.kind != baseline.kind
            )
        )

    WebDriverWait(
        client.driver,
        timeout_seconds,
        poll_frequency=POLL_SECONDS,
    ).until(
        lambda _: (
            control
            if panel_open(control := adapter.focused_control(process_id))
            else None
        )
    )

    def chooser_owner_ready(_: Any) -> NativeControlSnapshot | None:
        if cooperative_activation:
            runtime_binding.request_cooperative_activation(
                client,
                all_sessions,
            )
        else:
            adapter.activate_process(process_id)
        control = adapter.focused_control(process_id)
        return (
            control
            if panel_open(control)
            and control.frontmost
            and control.actual_frontmost_pid == process_id
            else None
        )

    WebDriverWait(
        client.driver,
        timeout_seconds,
        poll_frequency=POLL_SECONDS,
    ).until(chooser_owner_ready)

    def restore_native_window() -> NativeControlSnapshot:
        last_state: dict[str, Any] = {}

        def restored(_: Any) -> NativeControlSnapshot | None:
            control = activate_and_observe()
            document_focused = bool(
                client.driver.execute_script("return document.hasFocus()")
            )
            last_state.update(
                {
                    "control": control.to_dict(),
                    "documentFocused": document_focused,
                }
            )
            return (
                control
                if control.window_count >= baseline.window_count
                and not panel_open(control)
                and control.main_window
                and control.frontmost
                and control.actual_frontmost_pid == process_id
                and (control.focused_window or document_focused)
                and document_focused
                and control.kind != "application-dialog"
                else None
            )

        initial_timeout = min(timeout_seconds, 5.0)
        try:
            return WebDriverWait(
                client.driver,
                initial_timeout,
                poll_frequency=POLL_SECONDS,
            ).until(restored)
        except TimeoutException:
            adapter.activate_process(process_id)
            client.driver.execute_script("window.focus()")
            viewport = client.driver.execute_script(
                """
                return {
                  width: window.innerWidth,
                  height: window.innerHeight,
                  devicePixelRatio: window.devicePixelRatio || 1,
                };
                """
            )
            window = client.driver.get_window_rect()
            ratio = float(viewport["devicePixelRatio"])
            if ratio <= 0:
                raise GateError(
                    "Native file chooser returned an invalid window scale"
                ) from None
            native_window = {
                "left": float(window["x"]) / ratio,
                "top": float(window["y"]) / ratio,
                "width": float(window["width"]) / ratio,
                "height": float(window["height"]) / ratio,
            }
            origin = adapter.content_origin(process_id)
            if origin is None:
                origin = (
                    native_window["left"]
                    + max(
                        0.0,
                        (
                            native_window["width"]
                            - float(viewport["width"])
                        )
                        / 2,
                    ),
                    native_window["top"]
                    + max(
                        0.0,
                        native_window["height"]
                        - float(viewport["height"]),
                    ),
                )
            focus_point = (
                origin[0] + float(viewport["width"]) / 2,
                origin[1] + float(viewport["height"]) / 2,
            )
            adapter.post_mouse_to_process(
                process_id,
                (MouseAction.LEFT_DOWN, MouseAction.LEFT_UP),
                focus_point,
            )
        try:
            return WebDriverWait(
                client.driver,
                max(1.0, timeout_seconds - initial_timeout),
                poll_frequency=POLL_SECONDS,
            ).until(restored)
        except TimeoutException:
            raise GateError(
                "Native file chooser did not restore its owning document: "
                f"{last_state}"
            ) from None

    selected_control = adapter.select_file_chooser_path_to_process(
        process_id,
        str(selected_path),
    )
    if selected_control is not None:
        if selected_control.dialog_count:
            raise GateError("Native file chooser selection was not committed")
        restore_native_window()
        return {
            "name": resolved_source.name,
            "size": resolved_source.stat().st_size,
        }
    if adapter.platform == "win32":
        raise GateError(
            "Native file chooser selection returned no Win32 control"
        )

    path_control: NativeControlSnapshot | None = None
    for _ in range(REVEAL_ATTEMPTS):
        if adapter.platform == "macos":
            revealed = adapter.reveal_file_chooser_location_to_process(
                process_id
            )
        elif cooperative_activation:
            owner = adapter.focused_control(process_id)
            if (
                not owner.frontmost
                or owner.actual_frontmost_pid != process_id
            ):
                runtime_binding.request_cooperative_activation(
                    client,
                    all_sessions,
                )
            adapter.reveal_file_chooser_location()
            revealed = None
        else:
            revealed = adapter.reveal_file_chooser_location_to_process(
                process_id
            )
        if revealed is not None:
            if revealed.kind != "text-field":
                raise GateError(
                    "Native file chooser reveal returned an invalid control: "
                    f"{revealed.to_dict()}"
                )
            path_control = revealed
            break
        try:
            path_control = WebDriverWait(
                client.driver,
                2.5,
                poll_frequency=POLL_SECONDS,
            ).until(
                lambda _: (
                    control
                    if (
                        control := adapter.focused_control(process_id)
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

    def post_key(
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
            process_id,
            key,
            modifiers=modifiers,
            private_source=private_source,
        )

    original_clipboard = adapter.read_clipboard()
    try:
        selected_path_bytes = str(selected_path).encode("utf-8")
        adapter.write_clipboard(selected_path_bytes)
        if adapter.read_clipboard() != selected_path_bytes:
            raise GateError(
                "Native file chooser clipboard path did not round-trip"
            )
        post_key(NativeKey.A, modifiers=(NativeModifier.PRIMARY,))
        post_key(NativeKey.V, modifiers=(NativeModifier.PRIMARY,))
        WebDriverWait(
            client.driver,
            10,
            poll_frequency=POLL_SECONDS,
        ).until(
            lambda _: (
                control
                if (
                    control := adapter.focused_control(process_id)
                ).kind
                == "text-field"
                and control.value == str(selected_path)
                else None
            )
        )
    finally:
        adapter.write_clipboard(original_clipboard)
    post_key(NativeKey.ENTER, private_source=True)

    def selection_or_browser_ready(
        _: Any,
    ) -> dict[str, object] | None:
        control = adapter.focused_control(process_id)
        if control.window_count < baseline.window_count:
            return None
        if control.kind == "application-dialog":
            return {"selected": False, "control": control}
        if panel_open(control) and control.kind != "text-field":
            return {"selected": False, "control": control}
        if (
            not panel_open(control)
            and control.main_window
            and control.frontmost
            and control.focused_window
        ):
            return {"selected": True, "control": control}
        return None

    intermediate = WebDriverWait(
        client.driver,
        timeout_seconds,
        poll_frequency=POLL_SECONDS,
    ).until(selection_or_browser_ready)
    if not intermediate["selected"]:
        post_key(NativeKey.ENTER, private_source=True)

    restore_native_window()
    return {
        "name": resolved_source.name,
        "size": resolved_source.stat().st_size,
    }
