"""Win32 Native Desktop Adapter for the Peers-Touch acceptance framework.

Uses ctypes exclusively for Win32 API calls — no pywin32 dependency required.
Implements all abstract methods from NativeDesktopAdapter using:
  - EnumWindows / GetWindowThreadProcessId for window enumeration
  - SetForegroundWindow / BringWindowToTop for activation
  - BitBlt / GDI for screenshot capture
  - SendInput with MOUSEINPUT / KEYBDINPUT for mouse and keyboard simulation
  - OpenClipboard / GetClipboardData / SetClipboardData for clipboard access
"""

from __future__ import annotations

import ctypes
import ctypes.wintypes
import json
import struct
import time
import urllib.request
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

# ---------------------------------------------------------------------------
# Win32 constants
# ---------------------------------------------------------------------------

_INPUT_MOUSE = 0
_INPUT_KEYBOARD = 1

_MOUSEEVENTF_MOVE = 0x0001
_MOUSEEVENTF_LEFTDOWN = 0x0002
_MOUSEEVENTF_LEFTUP = 0x0004
_MOUSEEVENTF_ABSOLUTE = 0x8000

_KEYEVENTF_KEYUP = 0x0002
_KEYEVENTF_EXTENDEDKEY = 0x0001

_CF_UNICODETEXT = 13
_GMEM_MOVEABLE = 0x0002

_SW_RESTORE = 9
_GA_ROOTOWNER = 3
_GWL_STYLE = -16
_WS_MINIMIZE = 0x20000000
_GW_OWNER = 4

_SM_CXSCREEN = 0
_SM_CYSCREEN = 1

_SRCCOPY = 0x00CC0020
_DIB_RGB_COLORS = 0
_BI_RGB = 0

_SWP_NOMOVE = 0x0002
_SWP_NOSIZE = 0x0001

_MK_LBUTTON = 0x0001

# Virtual key codes
_VK_LBUTTON = 0x01
_VK_CONTROL = 0xA2  # VK_LCONTROL
_VK_SHIFT = 0xA0  # VK_LSHIFT
_VK_DELETE = 0x2E
_VK_RETURN = 0x0D
_VK_TAB = 0x09
_VK_ESCAPE = 0x1B
_VK_OEM_2 = 0xBF  # "/" key on US layout

# Map NativeKey to (virtual_key_code, needs_extended_flag)
_KEY_VK_MAP: dict[NativeKey, tuple[int, bool]] = {
    NativeKey.A: (0x41, False),
    NativeKey.G: (0x47, False),
    NativeKey.L: (0x4C, False),
    NativeKey.SLASH: (_VK_OEM_2, False),
    NativeKey.V: (0x56, False),
    NativeKey.DELETE: (_VK_DELETE, True),
    NativeKey.ENTER: (_VK_RETURN, False),
    NativeKey.TAB: (_VK_TAB, False),
    NativeKey.ESCAPE: (_VK_ESCAPE, False),
}

# Map NativeModifier to virtual key code
_MODIFIER_VK_MAP: dict[NativeModifier, int] = {
    NativeModifier.PRIMARY: _VK_CONTROL,
    NativeModifier.SHIFT: _VK_SHIFT,
}

# File-chooser navigation constants
_FILE_CHOOSER_FOCUS_STEPS = 8
_FILE_CHOOSER_FOCUS_TIMEOUT_SECONDS = 1.0

# ---------------------------------------------------------------------------
# Win32 structs for SendInput
# ---------------------------------------------------------------------------


class _MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ("dx", ctypes.wintypes.LONG),
        ("dy", ctypes.wintypes.LONG),
        ("mouseData", ctypes.wintypes.DWORD),
        ("dwFlags", ctypes.wintypes.DWORD),
        ("time", ctypes.wintypes.DWORD),
        ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong)),
    ]


class _KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", ctypes.wintypes.WORD),
        ("wScan", ctypes.wintypes.WORD),
        ("dwFlags", ctypes.wintypes.DWORD),
        ("time", ctypes.wintypes.DWORD),
        ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong)),
    ]


class _INPUT_UNION(ctypes.Union):
    _fields_ = [
        ("mi", _MOUSEINPUT),
        ("ki", _KEYBDINPUT),
    ]


class _INPUT(ctypes.Structure):
    _fields_ = [
        ("type", ctypes.wintypes.DWORD),
        ("union", _INPUT_UNION),
    ]


class _GUITHREADINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", ctypes.wintypes.DWORD),
        ("flags", ctypes.wintypes.DWORD),
        ("hwndActive", ctypes.wintypes.HWND),
        ("hwndFocus", ctypes.wintypes.HWND),
        ("hwndCapture", ctypes.wintypes.HWND),
        ("hwndMenuOwner", ctypes.wintypes.HWND),
        ("hwndMoveSize", ctypes.wintypes.HWND),
        ("hwndCaret", ctypes.wintypes.HWND),
        ("rcCaret", ctypes.wintypes.RECT),
    ]


# BITMAPINFOHEADER for GDI screenshot
class _BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ("biSize", ctypes.wintypes.DWORD),
        ("biWidth", ctypes.wintypes.LONG),
        ("biHeight", ctypes.wintypes.LONG),
        ("biPlanes", ctypes.wintypes.WORD),
        ("biBitCount", ctypes.wintypes.WORD),
        ("biCompression", ctypes.wintypes.DWORD),
        ("biSizeImage", ctypes.wintypes.DWORD),
        ("biXPelsPerMeter", ctypes.wintypes.LONG),
        ("biYPelsPerMeter", ctypes.wintypes.LONG),
        ("biClrUsed", ctypes.wintypes.DWORD),
        ("biClrImportant", ctypes.wintypes.DWORD),
    ]


class _BITMAPINFO(ctypes.Structure):
    _fields_ = [
        ("bmiHeader", _BITMAPINFOHEADER),
        ("bmiColors", ctypes.wintypes.DWORD * 3),
    ]


# ---------------------------------------------------------------------------
# Win32 API handles
# ---------------------------------------------------------------------------

_user32 = ctypes.windll.user32  # type: ignore[attr-defined]
_kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
_gdi32 = ctypes.windll.gdi32  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_mouse_input(
    x: int,
    y: int,
    flags: int,
) -> _INPUT:
    """Build a SendInput structure for a mouse event at absolute coordinates."""
    screen_width = _user32.GetSystemMetrics(_SM_CXSCREEN)
    screen_height = _user32.GetSystemMetrics(_SM_CYSCREEN)
    if screen_width <= 0 or screen_height <= 0:
        raise DriverError("Win32 Native could not determine screen metrics")
    # Normalise to 0..65535 range required by MOUSEEVENTF_ABSOLUTE
    abs_x = int(x * 65535 / screen_width)
    abs_y = int(y * 65535 / screen_height)
    inp = _INPUT()
    inp.type = _INPUT_MOUSE
    inp.union.mi.dx = abs_x
    inp.union.mi.dy = abs_y
    inp.union.mi.dwFlags = flags | _MOUSEEVENTF_ABSOLUTE
    return inp


def _make_key_input(vk: int, flags: int) -> _INPUT:
    """Build a SendInput structure for a keyboard event."""
    inp = _INPUT()
    inp.type = _INPUT_KEYBOARD
    inp.union.ki.wVk = vk
    inp.union.ki.wScan = _user32.MapVirtualKeyW(vk, 0) & 0xFF
    inp.union.ki.dwFlags = flags
    return inp


def _send_inputs(*inputs: _INPUT) -> None:
    """Submit one or more INPUT structs via SendInput."""
    count = len(inputs)
    array = (_INPUT * count)(*inputs)
    sent = _user32.SendInput(count, ctypes.pointer(array), ctypes.sizeof(_INPUT))
    if sent != count:
        raise DriverError(
            f"Win32 SendInput accepted {sent}/{count} events"
        )


def _validated_process_id(process_id: int) -> int:
    try:
        value = int(process_id)
    except (TypeError, ValueError) as error:
        raise DriverError("Native process ID must be a positive integer") from error
    if value <= 0:
        raise DriverError("Native process ID must be a positive integer")
    return value


# ---------------------------------------------------------------------------
# Window enumeration callback type
# ---------------------------------------------------------------------------

_ENUM_WINDOWS_PROC = ctypes.WINFUNCTYPE(
    ctypes.wintypes.BOOL,
    ctypes.wintypes.HWND,
    ctypes.wintypes.LPARAM,
)


# ---------------------------------------------------------------------------
# Adapter implementation
# ---------------------------------------------------------------------------


class Win32NativeDesktopAdapter(NativeDesktopAdapter):
    """Native Desktop adapter for Windows using Win32 API via ctypes."""

    @property
    def platform(self) -> str:
        return "win32"

    # -- window helpers -----------------------------------------------------

    @staticmethod
    def _enum_windows() -> list[ctypes.wintypes.HWND]:
        """Return all top-level visible windows in z-order."""
        results: list[ctypes.wintypes.HWND] = []

        @_ENUM_WINDOWS_PROC
        def _callback(hwnd: ctypes.wintypes.HWND, _lparam: ctypes.wintypes.LPARAM) -> bool:
            if _user32.IsWindowVisible(hwnd):
                results.append(hwnd)
            return True

        _user32.EnumWindows(_callback, 0)
        return results

    @staticmethod
    def _window_process_id(hwnd: ctypes.wintypes.HWND) -> int:
        pid = ctypes.wintypes.DWORD(0)
        _user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        return int(pid.value)

    @staticmethod
    def _focused_window_for_gui_thread(
        hwnd: ctypes.wintypes.HWND,
    ) -> ctypes.wintypes.HWND | int:
        thread_id = _user32.GetWindowThreadProcessId(hwnd, None)
        if not thread_id:
            return 0
        info = _GUITHREADINFO()
        info.cbSize = ctypes.sizeof(_GUITHREADINFO)
        if not _user32.GetGUIThreadInfo(thread_id, ctypes.byref(info)):
            return 0
        return info.hwndFocus or info.hwndActive or 0

    @staticmethod
    def _window_text(hwnd: ctypes.wintypes.HWND) -> str:
        length = _user32.GetWindowTextLengthW(hwnd)
        if length <= 0:
            return ""
        buf = ctypes.create_unicode_buffer(length + 1)
        _user32.GetWindowTextW(hwnd, buf, length + 1)
        return buf.value

    @staticmethod
    def _window_class_name(hwnd: ctypes.wintypes.HWND) -> str:
        buf = ctypes.create_unicode_buffer(256)
        _user32.GetClassNameW(hwnd, buf, 256)
        return buf.value

    @staticmethod
    def _window_rect(hwnd: ctypes.wintypes.HWND) -> NativeWindowBounds:
        rect = ctypes.wintypes.RECT()
        _user32.GetWindowRect(hwnd, ctypes.byref(rect))
        return NativeWindowBounds(
            left=float(rect.left),
            top=float(rect.top),
            width=float(rect.right - rect.left),
            height=float(rect.bottom - rect.top),
        )

    @staticmethod
    def _window_style(hwnd: ctypes.wintypes.HWND) -> int:
        return int(_user32.GetWindowLongW(hwnd, _GWL_STYLE))

    @staticmethod
    def _is_window_minimized(hwnd: ctypes.wintypes.HWND) -> bool:
        return bool(_user32.IsIconic(hwnd))

    def _find_windows_by_pid(self, process_id: int) -> list[ctypes.wintypes.HWND]:
        """Return visible top-level windows owned by *process_id*."""
        return [
            hwnd
            for hwnd in self._enum_windows()
            if self._window_process_id(hwnd) == process_id
        ]

    @staticmethod
    def _process_name(process_id: int) -> str:
        """Return the executable name for *process_id*, or empty string."""
        _PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        handle = _kernel32.OpenProcess(
            _PROCESS_QUERY_LIMITED_INFORMATION, False, process_id
        )
        if not handle:
            return ""
        try:
            buf = ctypes.create_unicode_buffer(260)
            size = ctypes.wintypes.DWORD(260)
            # QueryFullProcessImageNameW
            success = _kernel32.QueryFullProcessImageNameW(
                handle, 0, buf, ctypes.byref(size)
            )
            if success:
                return Path(buf.value).name
            return ""
        finally:
            _kernel32.CloseHandle(handle)

    # -- abstract method implementations ------------------------------------

    def activate_process(self, process_id: int) -> None:
        process_id = _validated_process_id(process_id)
        windows = self._find_windows_by_pid(process_id)
        if not windows:
            raise DriverError(
                f"Win32 Native actor process {process_id} has no visible window"
            )
        # EnumWindows returns top-level windows in top-to-bottom z-order.
        hwnd = windows[0]
        foreground = _user32.GetForegroundWindow()
        if foreground and self._window_process_id(foreground) == process_id:
            return
        if self._is_window_minimized(hwnd):
            _user32.ShowWindow(hwnd, _SW_RESTORE)
        current_thread = _kernel32.GetCurrentThreadId()
        target_thread = _user32.GetWindowThreadProcessId(hwnd, None)
        foreground_thread = (
            _user32.GetWindowThreadProcessId(foreground, None)
            if foreground
            else 0
        )
        attached_threads: list[int] = []
        try:
            for thread_id in {target_thread, foreground_thread}:
                if (
                    thread_id
                    and thread_id != current_thread
                    and _user32.AttachThreadInput(
                        current_thread,
                        thread_id,
                        True,
                    )
                ):
                    attached_threads.append(thread_id)
            _user32.AllowSetForegroundWindow(process_id)
            _user32.BringWindowToTop(hwnd)
            _user32.SetActiveWindow(hwnd)
            _user32.SetFocus(hwnd)
            if not _user32.SetForegroundWindow(hwnd):
                _send_inputs(
                    _make_key_input(0xA4, 0),  # VK_LMENU press
                    _make_key_input(0xA4, _KEYEVENTF_KEYUP),
                )
                _user32.SetForegroundWindow(hwnd)
        finally:
            for thread_id in reversed(attached_threads):
                _user32.AttachThreadInput(
                    current_thread,
                    thread_id,
                    False,
                )
        foreground = _user32.GetForegroundWindow()
        if not foreground or self._window_process_id(foreground) != process_id:
            raise DriverError(
                f"Win32 Native activation failed for process {process_id}"
            )

    def post_mouse(
        self,
        actions: tuple[MouseAction, ...],
        point: tuple[float, float],
    ) -> None:
        x, y = int(round(point[0])), int(round(point[1]))
        inputs: list[_INPUT] = []
        for action in actions:
            if action == MouseAction.MOVE:
                inputs.append(
                    _make_mouse_input(x, y, _MOUSEEVENTF_MOVE)
                )
            elif action == MouseAction.LEFT_DOWN:
                inputs.append(
                    _make_mouse_input(x, y, _MOUSEEVENTF_MOVE | _MOUSEEVENTF_LEFTDOWN)
                )
            elif action == MouseAction.LEFT_UP:
                inputs.append(
                    _make_mouse_input(x, y, _MOUSEEVENTF_MOVE | _MOUSEEVENTF_LEFTUP)
                )
            else:
                raise DriverError(
                    f"unsupported Win32 mouse action: {action.value}"
                )
        if inputs:
            _send_inputs(*inputs)

    def post_key(
        self,
        key: NativeKey,
        *,
        modifiers: tuple[NativeModifier, ...] = (),
        text: str = "",
        private_source: bool = False,
    ) -> None:
        del text, private_source
        vk_info = _KEY_VK_MAP.get(key)
        if vk_info is None:
            raise DriverError(f"unsupported Win32 key input: {key.value}")
        vk, extended = vk_info
        key_down_flags = _KEYEVENTF_EXTENDEDKEY if extended else 0
        key_up_flags = key_down_flags | _KEYEVENTF_KEYUP

        inputs: list[_INPUT] = []
        # Press modifiers
        modifier_vks = [_MODIFIER_VK_MAP[mod] for mod in modifiers]
        for mod_vk in modifier_vks:
            inputs.append(_make_key_input(mod_vk, 0))
        # Press and release the key
        inputs.append(_make_key_input(vk, key_down_flags))
        inputs.append(_make_key_input(vk, key_up_flags))
        # Release modifiers in reverse order
        for mod_vk in reversed(modifier_vks):
            inputs.append(_make_key_input(mod_vk, _KEYEVENTF_KEYUP))

        _send_inputs(*inputs)

    def reveal_file_chooser_location(self) -> None:
        """Reveal the location bar in a standard Windows file dialog.

        Windows common file dialogs have a breadcrumb address bar. Pressing
        Ctrl+L (or clicking the breadcrumb) switches it to an editable text
        field where we can type a path. This mirrors the Linux approach of
        pressing "/" to reveal the path entry.
        """
        self.post_key(NativeKey.L, modifiers=(NativeModifier.PRIMARY,))

    def focused_control(self, process_id: int) -> NativeControlSnapshot:
        process_id = _validated_process_id(process_id)
        try:
            windows = self._find_windows_by_pid(process_id)
            foreground_hwnd = _user32.GetForegroundWindow()
            foreground_pid = (
                self._window_process_id(foreground_hwnd)
                if foreground_hwnd
                else -1
            )
            focused_hwnd = (
                self._focused_window_for_gui_thread(foreground_hwnd)
                if foreground_hwnd
                else 0
            )
            focused_pid = (
                self._window_process_id(focused_hwnd)
                if focused_hwnd
                else -1
            )

            dialog_count = sum(
                1
                for hwnd in windows
                if _user32.GetWindow(hwnd, _GW_OWNER) != 0
            )
            actor_frontmost = foreground_pid == process_id
            actor_focused = focused_pid == process_id or actor_frontmost

            # Determine control kind via class name of the focused child
            kind = "application"
            title = ""
            value = ""
            platform_role = ""
            if actor_frontmost and foreground_hwnd:
                child = focused_hwnd
                if child:
                    cls = self._window_class_name(child)
                    platform_role = cls
                    if "edit" in cls.lower():
                        kind = "text-field"
                    elif "listbox" in cls.lower() or "syslistview" in cls.lower():
                        kind = "list"
                    title = self._window_text(child)
                    if kind == "text-field":
                        value = title
                if kind == "application" and dialog_count > 0:
                    kind = "application-dialog"

            # #region debug-point AF-AJ:file-dialog-focus
            try:
                foreground_thread_id = (
                    _user32.GetWindowThreadProcessId(foreground_hwnd, None)
                    if foreground_hwnd
                    else 0
                )
                gui_info = _GUITHREADINFO()
                gui_info.cbSize = ctypes.sizeof(_GUITHREADINFO)
                ctypes.set_last_error(0)
                gui_info_ok = bool(
                    foreground_thread_id
                    and _user32.GetGUIThreadInfo(
                        foreground_thread_id,
                        ctypes.byref(gui_info),
                    )
                )
                gui_info_error = ctypes.get_last_error()

                def debug_handle(hwnd: ctypes.wintypes.HWND | int) -> int:
                    return int(getattr(hwnd, "value", hwnd) or 0)

                focused_ancestors: list[dict[str, object]] = []
                ancestor = focused_hwnd
                seen_ancestors: set[int] = set()
                for _ in range(8):
                    ancestor_value = debug_handle(ancestor)
                    if not ancestor_value or ancestor_value in seen_ancestors:
                        break
                    seen_ancestors.add(ancestor_value)
                    focused_ancestors.append(
                        {
                            "hwnd": ancestor_value,
                            "class": self._window_class_name(ancestor),
                            "processId": self._window_process_id(ancestor),
                        }
                    )
                    ancestor = _user32.GetParent(ancestor)

                child_classes: set[str] = set()

                @_ENUM_WINDOWS_PROC
                def collect_child_classes(
                    child_hwnd: ctypes.wintypes.HWND,
                    _lparam: ctypes.wintypes.LPARAM,
                ) -> bool:
                    child_class = self._window_class_name(child_hwnd)
                    if child_class:
                        child_classes.add(child_class)
                    return True

                if foreground_hwnd:
                    _user32.EnumChildWindows(
                        foreground_hwnd,
                        collect_child_classes,
                        0,
                    )

                foreground_class = (
                    self._window_class_name(foreground_hwnd)
                    if foreground_hwnd
                    else ""
                )
                actor_windows = [
                    {
                        "hwnd": debug_handle(hwnd),
                        "class": self._window_class_name(hwnd),
                        "owner": debug_handle(_user32.GetWindow(hwnd, _GW_OWNER)),
                    }
                    for hwnd in windows
                ]
                dialog_visible = (
                    dialog_count > 0
                    or foreground_class == "#32770"
                    or any(
                        item["class"] == "#32770"
                        for item in actor_windows
                    )
                )
                if dialog_visible:
                    event = {
                        "sessionId": "cross-station-direct-open",
                        "runId": "pre-fix",
                        "hypothesisId": "AF-AJ",
                        "location": "windows.py:focused_control",
                        "msg": "[DEBUG] Win32 file-dialog focus hierarchy",
                        "data": {
                            "requestedProcessId": process_id,
                            "foregroundHwnd": debug_handle(foreground_hwnd),
                            "foregroundProcessId": foreground_pid,
                            "foregroundThreadId": foreground_thread_id,
                            "foregroundClass": foreground_class,
                            "guiThreadInfoOk": gui_info_ok,
                            "guiThreadInfoError": gui_info_error,
                            "guiActiveHwnd": debug_handle(
                                gui_info.hwndActive
                            ),
                            "guiFocusHwnd": debug_handle(gui_info.hwndFocus),
                            "guiCaretHwnd": debug_handle(gui_info.hwndCaret),
                            "resolvedFocusHwnd": debug_handle(focused_hwnd),
                            "resolvedFocusProcessId": focused_pid,
                            "resolvedFocusClass": platform_role,
                            "resolvedKind": kind,
                            "resolvedValueLength": len(value),
                            "actorFrontmost": actor_frontmost,
                            "actorFocused": actor_focused,
                            "dialogCount": dialog_count,
                            "actorWindows": actor_windows,
                            "focusedAncestors": focused_ancestors,
                            "childClasses": sorted(child_classes),
                        },
                    }
                    request = urllib.request.Request(
                        "http://127.0.0.1:7777/event",
                        data=json.dumps(event).encode("utf-8"),
                        headers={"Content-Type": "application/json"},
                        method="POST",
                    )
                    urllib.request.urlopen(request, timeout=0.25).close()
            except Exception:
                pass
            # #endregion

            return NativeControlSnapshot(
                kind=kind,
                title=title,
                value=value,
                window_count=len(windows),
                dialog_count=dialog_count,
                frontmost=actor_frontmost,
                main_window=actor_frontmost and dialog_count == 0,
                focused_window=actor_focused,
                actual_frontmost_pid=foreground_pid,
                platform_role=platform_role,
                platform_subrole="",
                error="",
            )
        except Exception as error:
            return NativeControlSnapshot(
                actual_frontmost_pid=-1,
                error=f"Win32 focus probe failed: {error}",
            )

    def window_stack_at_point(
        self,
        point: tuple[float, float],
    ) -> NativeWindowStack:
        try:
            x, y = point
            snapshots: list[NativeWindowSnapshot] = []
            for index, hwnd in enumerate(self._enum_windows()):
                bounds = self._window_rect(hwnd)
                if not (
                    bounds.left <= x < bounds.left + bounds.width
                    and bounds.top <= y < bounds.top + bounds.height
                ):
                    continue
                pid = self._window_process_id(hwnd)
                snapshots.append(
                    NativeWindowSnapshot(
                        index=index,
                        owner_pid=pid,
                        owner_name=self._process_name(pid),
                        window_name=self._window_text(hwnd),
                        layer=0,
                        alpha=1.0,
                        bounds=bounds,
                    )
                )
            return NativeWindowStack(windows=tuple(snapshots[:16]))
        except Exception as error:
            return NativeWindowStack(error=f"Win32 window probe failed: {error}")

    def content_origin(
        self,
        process_id: int,
    ) -> tuple[float, float] | None:
        process_id = _validated_process_id(process_id)
        windows = self._find_windows_by_pid(process_id)
        if not windows:
            return None
        hwnd = windows[0]
        # ClientToScreen gives the client area origin relative to the screen
        point = ctypes.wintypes.POINT(0, 0)
        _user32.ClientToScreen(hwnd, ctypes.byref(point))
        return float(point.x), float(point.y)

    def mouse_button_down(self) -> bool:
        state = _user32.GetAsyncKeyState(_VK_LBUTTON)
        # High bit set means the button is currently held
        return bool(state & 0x8000)

    def capture_screenshot(self, path: Path) -> None:
        """Capture the full desktop to a BMP file using GDI BitBlt."""
        path.parent.mkdir(parents=True, exist_ok=True)
        screen_width = _user32.GetSystemMetrics(_SM_CXSCREEN)
        screen_height = _user32.GetSystemMetrics(_SM_CYSCREEN)
        if screen_width <= 0 or screen_height <= 0:
            raise DriverError("Win32 Native could not determine screen size")

        hdc_screen = _user32.GetDC(0)
        if not hdc_screen:
            raise DriverError("Win32 Native GetDC failed for screen")
        hdc_mem = _gdi32.CreateCompatibleDC(hdc_screen)
        hbm = _gdi32.CreateCompatibleBitmap(hdc_screen, screen_width, screen_height)
        old_bm = _gdi32.SelectObject(hdc_mem, hbm)

        try:
            success = _gdi32.BitBlt(
                hdc_mem, 0, 0, screen_width, screen_height,
                hdc_screen, 0, 0, _SRCCOPY,
            )
            if not success:
                raise DriverError("Win32 Native BitBlt failed")

            bmi = _BITMAPINFO()
            bmi.bmiHeader.biSize = ctypes.sizeof(_BITMAPINFOHEADER)
            bmi.bmiHeader.biWidth = screen_width
            bmi.bmiHeader.biHeight = -screen_height  # top-down
            bmi.bmiHeader.biPlanes = 1
            bmi.bmiHeader.biBitCount = 32
            bmi.bmiHeader.biCompression = _BI_RGB

            row_size = screen_width * 4
            pixel_data = ctypes.create_string_buffer(row_size * screen_height)
            _gdi32.GetDIBits(
                hdc_mem, hbm, 0, screen_height,
                pixel_data, ctypes.byref(bmi), _DIB_RGB_COLORS,
            )

            # Write as BMP
            file_header_size = 14
            info_header_size = ctypes.sizeof(_BITMAPINFOHEADER)
            pixel_data_size = row_size * screen_height
            file_size = file_header_size + info_header_size + pixel_data_size

            # BMP file header: signature, file size, reserved, pixel data offset
            bmp_header = struct.pack(
                "<2sIHHI",
                b"BM",
                file_size,
                0,
                0,
                file_header_size + info_header_size,
            )
            # Rewrite biHeight as positive for standard BMP (bottom-up)
            bmi.bmiHeader.biHeight = screen_height
            info_bytes = bytes(bmi.bmiHeader)

            with path.open("wb") as out:
                out.write(bmp_header)
                out.write(info_bytes)
                # Flip rows from top-down to bottom-up for standard BMP
                raw = bytes(pixel_data)
                for row_index in range(screen_height - 1, -1, -1):
                    offset = row_index * row_size
                    out.write(raw[offset : offset + row_size])

            if not path.is_file() or path.stat().st_size == 0:
                raise DriverError(
                    f"Win32 Native desktop screenshot was not created: {path}"
                )
        finally:
            _gdi32.SelectObject(hdc_mem, old_bm)
            _gdi32.DeleteObject(hbm)
            _gdi32.DeleteDC(hdc_mem)
            _user32.ReleaseDC(0, hdc_screen)

    def read_clipboard(self) -> bytes:
        """Read Unicode text from the system clipboard."""
        if not _user32.OpenClipboard(0):
            raise DriverError("Win32 Native could not open clipboard for reading")
        try:
            handle = _user32.GetClipboardData(_CF_UNICODETEXT)
            if not handle:
                return b""
            ptr = _kernel32.GlobalLock(handle)
            if not ptr:
                return b""
            try:
                return ctypes.wstring_at(ptr).encode("utf-8")
            finally:
                _kernel32.GlobalUnlock(handle)
        finally:
            _user32.CloseClipboard()

    def write_clipboard(self, value: bytes) -> None:
        """Write UTF-8 bytes to the system clipboard as Unicode text."""
        if not _user32.OpenClipboard(0):
            raise DriverError("Win32 Native could not open clipboard for writing")
        try:
            _user32.EmptyClipboard()
            if not value:
                return
            text = value.decode("utf-8", errors="replace")
            # Allocate a global memory block for the wide-char string (null-terminated)
            wide = text.encode("utf-16-le") + b"\x00\x00"
            h_global = _kernel32.GlobalAlloc(_GMEM_MOVEABLE, len(wide))
            if not h_global:
                raise DriverError("Win32 Native GlobalAlloc failed for clipboard write")
            ptr = _kernel32.GlobalLock(h_global)
            if not ptr:
                _kernel32.GlobalFree(h_global)
                raise DriverError("Win32 Native GlobalLock failed for clipboard write")
            ctypes.memmove(ptr, wide, len(wide))
            _kernel32.GlobalUnlock(h_global)
            if not _user32.SetClipboardData(_CF_UNICODETEXT, h_global):
                _kernel32.GlobalFree(h_global)
                raise DriverError("Win32 Native SetClipboardData failed")
            # Ownership of h_global transferred to clipboard; do not free it
        finally:
            _user32.CloseClipboard()
