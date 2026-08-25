from __future__ import annotations

import os
import signal
import subprocess
from pathlib import Path
from typing import Any

from tooling.acceptance.core.errors import DriverError
from tooling.acceptance.drivers.native.base import (
    MouseAction,
    NativeControlSnapshot,
    NativeDesktopAdapter,
    NativeKey,
    NativeModifier,
    NativeWindowBounds,
    NativeWindowSnapshot,
    NativeWindowStack,
)


_KEY_SYMBOLS = {
    NativeKey.A: "a",
    NativeKey.G: "g",
    NativeKey.L: "l",
    NativeKey.V: "v",
    NativeKey.DELETE: "Delete",
    NativeKey.ENTER: "Return",
    NativeKey.TAB: "Tab",
    NativeKey.ESCAPE: "Escape",
}
_MODIFIER_SYMBOLS = {
    NativeModifier.PRIMARY: "Control_L",
    NativeModifier.SHIFT: "Shift_L",
}
_CONTROL_KINDS = {
    "entry": "text-field",
    "text": "text-field",
    "list": "list",
    "file chooser": "application-dialog",
}


class LinuxX11NativeDesktopAdapter(NativeDesktopAdapter):
    """Native Desktop adapter for an X11 session with XTest and EWMH."""

    def __init__(self, display_name: str | None = None) -> None:
        self.display_name = display_name or os.environ.get("DISPLAY", "")
        if not self.display_name:
            raise DriverError("Linux Native adapter requires DISPLAY")

    @property
    def platform(self) -> str:
        return "linux"

    def activate_process(self, process_id: int) -> None:
        process_id = self._validated_process_id(process_id)
        display = self._open_display()
        try:
            root = display.screen().root
            target = next(
                (
                    window
                    for window in reversed(self._client_windows(display))
                    if self._window_pid(display, window) == process_id
                ),
                None,
            )
            if target is None:
                raise DriverError(
                    f"Linux Native actor process {process_id} has no EWMH window"
                )
            active = display.intern_atom("_NET_ACTIVE_WINDOW")
            from Xlib import X, protocol

            event = protocol.event.ClientMessage(
                window=target,
                client_type=active,
                data=(32, [2, X.CurrentTime, 0, 0, 0]),
            )
            root.send_event(
                event,
                event_mask=X.SubstructureRedirectMask
                | X.SubstructureNotifyMask,
            )
            target.set_input_focus(X.RevertToParent, X.CurrentTime)
            display.sync()
        except DriverError:
            raise
        except Exception as error:
            raise DriverError(
                f"Linux Native activation failed for process {process_id}: {error}"
            ) from error
        finally:
            display.close()

    def post_mouse(
        self,
        actions: tuple[MouseAction, ...],
        point: tuple[float, float],
    ) -> None:
        display = self._open_display()
        try:
            from Xlib import X
            from Xlib.ext import xtest

            x, y = (int(round(point[0])), int(round(point[1])))
            if actions:
                xtest.fake_input(display, X.MotionNotify, x=x, y=y)
            for action in actions:
                if action == MouseAction.LEFT_DOWN:
                    xtest.fake_input(display, X.ButtonPress, 1, x=x, y=y)
                elif action == MouseAction.LEFT_UP:
                    xtest.fake_input(display, X.ButtonRelease, 1, x=x, y=y)
                elif action != MouseAction.MOVE:
                    raise DriverError(
                        f"unsupported Linux mouse action: {action.value}"
                    )
            display.sync()
        except DriverError:
            raise
        except Exception as error:
            raise DriverError(f"Linux Native mouse input failed: {error}") from error
        finally:
            display.close()

    def post_key(
        self,
        key: NativeKey,
        *,
        modifiers: tuple[NativeModifier, ...] = (),
        text: str = "",
        private_source: bool = False,
    ) -> None:
        del text, private_source
        display = self._open_display()
        try:
            from Xlib import X, XK
            from Xlib.ext import xtest

            modifier_codes = [
                self._keycode(display, XK.string_to_keysym(_MODIFIER_SYMBOLS[item]))
                for item in modifiers
            ]
            key_code = self._keycode(
                display,
                XK.string_to_keysym(_KEY_SYMBOLS[key]),
            )
            for modifier_code in modifier_codes:
                xtest.fake_input(display, X.KeyPress, modifier_code)
            xtest.fake_input(display, X.KeyPress, key_code)
            xtest.fake_input(display, X.KeyRelease, key_code)
            for modifier_code in reversed(modifier_codes):
                xtest.fake_input(display, X.KeyRelease, modifier_code)
            display.sync()
        except KeyError as error:
            raise DriverError(f"unsupported Linux key input: {key.value}") from error
        except DriverError:
            raise
        except Exception as error:
            raise DriverError(f"Linux Native key input failed: {error}") from error
        finally:
            display.close()

    def reveal_file_chooser_location(self) -> None:
        self.post_key(
            NativeKey.L,
            modifiers=(NativeModifier.PRIMARY,),
        )

    def focused_control(self, process_id: int) -> NativeControlSnapshot:
        process_id = self._validated_process_id(process_id)
        display = self._open_display()
        try:
            windows = tuple(
                window
                for window in self._client_windows(display)
                if self._window_pid(display, window) == process_id
            )
            active_window = self._active_window(display)
            active_pid = (
                self._window_pid(display, active_window)
                if active_window is not None
                else -1
            )
            focused_window = display.get_input_focus().focus
            focused_pid = (
                self._window_pid(display, focused_window)
                if focused_window is not None
                else -1
            )
            owned_dialog_count = sum(
                self._is_dialog(display, window) for window in windows
            )
            active_descendant_dialog = bool(
                active_window is not None
                and active_pid != process_id
                and self._is_descendant_process(active_pid, process_id)
                and self._is_native_dialog(display, active_window)
            )
            dialog_count = owned_dialog_count + int(active_descendant_dialog)
            actor_frontmost = active_pid == process_id or active_descendant_dialog
            actor_focused = (
                focused_pid == process_id
                or (
                    active_descendant_dialog
                    and self._is_descendant_process(focused_pid, process_id)
                )
            )
            accessible = self._focused_accessible()
            return NativeControlSnapshot(
                kind=(
                    "application-dialog"
                    if active_descendant_dialog
                    else str(accessible.get("kind") or (
                        "application-dialog"
                        if owned_dialog_count > 0 and active_pid == process_id
                        else "application"
                    ))
                ),
                title=str(accessible.get("title") or ""),
                value=str(accessible.get("value") or ""),
                window_count=len(windows) + int(active_descendant_dialog),
                dialog_count=dialog_count,
                frontmost=actor_frontmost,
                main_window=active_pid == process_id and dialog_count == 0,
                focused_window=actor_focused,
                actual_frontmost_pid=active_pid,
                platform_role=str(accessible.get("role") or ""),
                platform_subrole=str(accessible.get("subrole") or ""),
                error=str(accessible.get("error") or ""),
            )
        except Exception as error:
            return NativeControlSnapshot(
                actual_frontmost_pid=-1,
                error=f"Linux X11 focus probe failed: {error}",
            )
        finally:
            display.close()

    def window_stack_at_point(
        self,
        point: tuple[float, float],
    ) -> NativeWindowStack:
        display = self._open_display()
        try:
            x, y = point
            snapshots: list[NativeWindowSnapshot] = []
            for index, window in enumerate(
                reversed(self._client_windows(display))
            ):
                bounds = self._window_bounds(display, window)
                if not (
                    bounds.left <= x < bounds.left + bounds.width
                    and bounds.top <= y < bounds.top + bounds.height
                ):
                    continue
                snapshots.append(
                    NativeWindowSnapshot(
                        index=index,
                        owner_pid=self._window_pid(display, window),
                        owner_name=self._window_class(window),
                        window_name=self._window_title(display, window),
                        layer=0,
                        alpha=1.0,
                        bounds=bounds,
                    )
                )
            return NativeWindowStack(windows=tuple(snapshots[:16]))
        except Exception as error:
            return NativeWindowStack(error=f"Linux X11 window probe failed: {error}")
        finally:
            display.close()

    def content_origin(
        self,
        process_id: int,
    ) -> tuple[float, float]:
        process_id = self._validated_process_id(process_id)
        display = self._open_display()
        try:
            window = next(
                (
                    candidate
                    for candidate in reversed(self._client_windows(display))
                    if self._window_pid(display, candidate) == process_id
                ),
                None,
            )
            if window is None:
                raise DriverError(
                    f"Linux Native actor process {process_id} has no EWMH window"
                )
            root = display.screen().root
            origin = root.translate_coords(window, 0, 0)
            return float(origin.x), float(origin.y)
        except DriverError:
            raise
        except Exception as error:
            raise DriverError(
                f"Linux Native content origin failed for process "
                f"{process_id}: {error}"
            ) from error
        finally:
            display.close()

    def mouse_button_down(self) -> bool:
        display = self._open_display()
        try:
            from Xlib import X

            pointer = display.screen().root.query_pointer()
            return bool(pointer.mask & X.Button1Mask)
        except Exception as error:
            raise DriverError(
                f"Linux Native mouse state probe failed: {error}"
            ) from error
        finally:
            display.close()

    def capture_screenshot(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._run(
            ("scrot", "--overwrite", str(path)),
            operation="desktop screenshot",
        )
        if not path.is_file() or path.stat().st_size == 0:
            raise DriverError(
                f"Linux Native desktop screenshot was not created: {path}"
            )

    def read_clipboard(self) -> bytes:
        completed = self._run(
            ("xclip", "-selection", "clipboard", "-out"),
            operation="clipboard read",
            text=False,
        )
        return bytes(completed.stdout)

    def write_clipboard(self, value: bytes) -> None:
        self._run(
            ("xclip", "-selection", "clipboard", "-in"),
            operation="clipboard write",
            input_bytes=value,
            text=False,
        )

    def _open_display(self) -> Any:
        try:
            from Xlib import display as xdisplay

            return xdisplay.Display(self.display_name)
        except Exception as error:
            raise DriverError(
                f"cannot connect to Linux X11 display {self.display_name!r}: {error}"
            ) from error

    @staticmethod
    def _validated_process_id(process_id: int) -> int:
        try:
            value = int(process_id)
        except (TypeError, ValueError) as error:
            raise DriverError("Native process ID must be a positive integer") from error
        if value <= 0:
            raise DriverError("Native process ID must be a positive integer")
        return value

    @staticmethod
    def _is_descendant_process(process_id: int, ancestor_id: int) -> bool:
        current = process_id
        for _ in range(32):
            if current <= 1:
                return False
            try:
                stat = Path(f"/proc/{current}/stat").read_text(encoding="utf-8")
                parent_id = int(stat.rsplit(")", 1)[1].split()[1])
            except (IndexError, OSError, ValueError):
                return False
            if parent_id == ancestor_id:
                return True
            if parent_id == current:
                return False
            current = parent_id
        return False

    @staticmethod
    def _keycode(display: Any, key_symbol: int) -> int:
        code = int(display.keysym_to_keycode(key_symbol))
        if code <= 0:
            raise DriverError("Linux X11 key symbol has no keycode")
        return code

    @staticmethod
    def _property(display: Any, window: Any, name: str, property_type: str) -> Any:
        atom = display.intern_atom(name)
        expected_type = display.intern_atom(property_type)
        return window.get_full_property(atom, expected_type)

    def _client_windows(self, display: Any) -> tuple[Any, ...]:
        root = display.screen().root
        value = self._property(
            display,
            root,
            "_NET_CLIENT_LIST_STACKING",
            "WINDOW",
        )
        if value is None:
            return ()
        return tuple(display.create_resource_object("window", item) for item in value.value)

    def _active_window(self, display: Any) -> Any | None:
        value = self._property(
            display,
            display.screen().root,
            "_NET_ACTIVE_WINDOW",
            "WINDOW",
        )
        if value is None or not len(value.value):
            return None
        return display.create_resource_object("window", value.value[0])

    def _window_pid(self, display: Any, window: Any) -> int:
        root_id = display.screen().root.id
        current = window
        for _ in range(32):
            value = self._property(
                display,
                current,
                "_NET_WM_PID",
                "CARDINAL",
            )
            if value is not None and len(value.value):
                return int(value.value[0])
            tree = current.query_tree()
            parent = tree.parent
            if parent is None or parent.id in (current.id, root_id):
                break
            current = parent
        return -1

    def _is_dialog(self, display: Any, window: Any) -> bool:
        value = self._property(
            display,
            window,
            "_NET_WM_WINDOW_TYPE",
            "ATOM",
        )
        if value is None:
            return False
        dialog = display.intern_atom("_NET_WM_WINDOW_TYPE_DIALOG")
        return dialog in value.value

    def _is_native_dialog(self, display: Any, window: Any) -> bool:
        return (
            self._is_dialog(display, window)
            or self._window_class(window).lower() == "zenity.zenity"
        )

    def _window_title(self, display: Any, window: Any) -> str:
        value = self._property(display, window, "_NET_WM_NAME", "UTF8_STRING")
        if value is None:
            return ""
        raw = value.value
        return (
            raw.decode("utf-8", errors="replace")
            if isinstance(raw, bytes)
            else str(raw)
        )

    @staticmethod
    def _window_class(window: Any) -> str:
        try:
            value = window.get_wm_class() or ()
        except Exception:
            return ""
        return ".".join(str(item) for item in value)

    def _window_bounds(self, display: Any, window: Any) -> NativeWindowBounds:
        geometry = window.get_geometry()
        root = display.screen().root
        translated = root.translate_coords(window, 0, 0)
        frame = self._property(
            display,
            window,
            "_NET_FRAME_EXTENTS",
            "CARDINAL",
        )
        extents = (
            tuple(float(value) for value in frame.value[:4])
            if frame is not None and len(frame.value) >= 4
            else (0.0, 0.0, 0.0, 0.0)
        )
        left, right, top, bottom = extents
        return NativeWindowBounds(
            left=float(translated.x) - left,
            top=float(translated.y) - top,
            width=float(geometry.width) + left + right,
            height=float(geometry.height) + top + bottom,
        )

    @staticmethod
    def _focused_accessible() -> dict[str, object]:
        previous_handler = signal.getsignal(signal.SIGALRM)

        def timeout_handler(_signum: int, _frame: object) -> None:
            raise TimeoutError("AT-SPI focus probe timed out")

        try:
            signal.signal(signal.SIGALRM, timeout_handler)
            signal.setitimer(signal.ITIMER_REAL, 2.0)
            import pyatspi

            desktop = pyatspi.Registry.getDesktop(0)
            stack = [desktop]
            while stack:
                node = stack.pop()
                state = node.getState()
                if state.contains(pyatspi.STATE_FOCUSED):
                    role = str(node.getRoleName() or "")
                    kind = _CONTROL_KINDS.get(role.lower(), "unknown")
                    value = ""
                    try:
                        value = node.queryText().getText(0, -1)
                    except Exception:
                        pass
                    return {
                        "kind": kind,
                        "title": str(getattr(node, "name", "") or ""),
                        "value": value,
                        "role": role,
                        "subrole": "",
                    }
                try:
                    stack.extend(reversed([node[index] for index in range(node.childCount)]))
                except Exception:
                    continue
        except Exception as error:
            return {"error": f"Linux AT-SPI probe failed: {error}"}
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
            signal.signal(signal.SIGALRM, previous_handler)
        return {}

    def _run(
        self,
        command: tuple[str, ...],
        *,
        operation: str,
        input_bytes: bytes | None = None,
        text: bool = True,
    ) -> subprocess.CompletedProcess[Any]:
        environment = os.environ.copy()
        environment["DISPLAY"] = self.display_name
        completed = subprocess.run(
            command,
            input=input_bytes,
            capture_output=True,
            text=text,
            env=environment,
            timeout=10,
            check=False,
        )
        if completed.returncode != 0:
            detail = completed.stderr or completed.stdout
            if isinstance(detail, bytes):
                detail = detail.decode("utf-8", errors="replace")
            raise DriverError(
                f"Linux Native {operation} failed: {str(detail).strip()[-2000:]}"
            )
        return completed
