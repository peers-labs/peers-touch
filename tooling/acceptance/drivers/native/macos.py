from __future__ import annotations

import ctypes
import json
import subprocess
import sys
from pathlib import Path

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


_ACCESSIBILITY_PROBE = r"""
import ctypes
import json
import sys

import AppKit

process_id = int(sys.argv[1])
application_services = ctypes.CDLL(
    "/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices"
)
core_foundation = ctypes.CDLL(
    "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation"
)
CFRef = ctypes.c_void_p
CFIndex = ctypes.c_long
CFTypeID = ctypes.c_ulong
UTF8 = 0x08000100

application_services.AXUIElementCreateApplication.argtypes = [ctypes.c_int32]
application_services.AXUIElementCreateApplication.restype = CFRef
application_services.AXUIElementCopyAttributeValue.argtypes = [
    CFRef,
    CFRef,
    ctypes.POINTER(CFRef),
]
application_services.AXUIElementCopyAttributeValue.restype = ctypes.c_int32
application_services.AXUIElementSetMessagingTimeout.argtypes = [
    CFRef,
    ctypes.c_float,
]
application_services.AXUIElementSetMessagingTimeout.restype = ctypes.c_int32
core_foundation.CFStringCreateWithCString.argtypes = [
    CFRef,
    ctypes.c_char_p,
    ctypes.c_uint32,
]
core_foundation.CFStringCreateWithCString.restype = CFRef
core_foundation.CFStringGetTypeID.restype = CFTypeID
core_foundation.CFBooleanGetTypeID.restype = CFTypeID
core_foundation.CFArrayGetTypeID.restype = CFTypeID
core_foundation.CFGetTypeID.argtypes = [CFRef]
core_foundation.CFGetTypeID.restype = CFTypeID
core_foundation.CFStringGetLength.argtypes = [CFRef]
core_foundation.CFStringGetLength.restype = CFIndex
core_foundation.CFStringGetMaximumSizeForEncoding.argtypes = [
    CFIndex,
    ctypes.c_uint32,
]
core_foundation.CFStringGetMaximumSizeForEncoding.restype = CFIndex
core_foundation.CFStringGetCString.argtypes = [
    CFRef,
    ctypes.c_char_p,
    CFIndex,
    ctypes.c_uint32,
]
core_foundation.CFStringGetCString.restype = ctypes.c_bool
core_foundation.CFBooleanGetValue.argtypes = [CFRef]
core_foundation.CFBooleanGetValue.restype = ctypes.c_bool
core_foundation.CFArrayGetCount.argtypes = [CFRef]
core_foundation.CFArrayGetCount.restype = CFIndex
core_foundation.CFArrayGetValueAtIndex.argtypes = [CFRef, CFIndex]
core_foundation.CFArrayGetValueAtIndex.restype = CFRef
core_foundation.CFRelease.argtypes = [CFRef]


def create_attribute(name):
    return core_foundation.CFStringCreateWithCString(
        None,
        name.encode("utf-8"),
        UTF8,
    )


def copy_attribute(element, name):
    key = create_attribute(name)
    value = CFRef()
    try:
        error = application_services.AXUIElementCopyAttributeValue(
            element,
            key,
            ctypes.byref(value),
        )
    finally:
        core_foundation.CFRelease(key)
    return value if error == 0 else None


def decode_text(value):
    if (
        not value
        or core_foundation.CFGetTypeID(value)
        != core_foundation.CFStringGetTypeID()
    ):
        return ""
    size = (
        core_foundation.CFStringGetMaximumSizeForEncoding(
            core_foundation.CFStringGetLength(value),
            UTF8,
        )
        + 1
    )
    buffer = ctypes.create_string_buffer(size)
    if not core_foundation.CFStringGetCString(value, buffer, size, UTF8):
        return ""
    return buffer.value.decode("utf-8")


def decode_boolean(value):
    return bool(
        value
        and core_foundation.CFGetTypeID(value)
        == core_foundation.CFBooleanGetTypeID()
        and core_foundation.CFBooleanGetValue(value)
    )


def array_items(value):
    if (
        not value
        or core_foundation.CFGetTypeID(value)
        != core_foundation.CFArrayGetTypeID()
    ):
        return []
    return [
        core_foundation.CFArrayGetValueAtIndex(value, index)
        for index in range(core_foundation.CFArrayGetCount(value))
    ]


def copied_text(element, name):
    value = copy_attribute(element, name)
    try:
        return decode_text(value)
    finally:
        if value:
            core_foundation.CFRelease(value)


def copied_boolean(element, name):
    value = copy_attribute(element, name)
    try:
        return decode_boolean(value)
    finally:
        if value:
            core_foundation.CFRelease(value)


application = application_services.AXUIElementCreateApplication(process_id)
application_services.AXUIElementSetMessagingTimeout(application, 0.5)
focused = copy_attribute(application, "AXFocusedUIElement")
windows_value = copy_attribute(application, "AXWindows")
windows = array_items(windows_value)
sheet_count = 0
for window in windows:
    sheets_value = copy_attribute(window, "AXSheets")
    try:
        sheet_count += len(array_items(sheets_value))
    finally:
        if sheets_value:
            core_foundation.CFRelease(sheets_value)
front_window = windows[0] if windows else None
frontmost_app = AppKit.NSWorkspace.sharedWorkspace().frontmostApplication()
result = {
    "role": copied_text(focused, "AXRole") if focused else "",
    "subrole": copied_text(focused, "AXSubrole") if focused else "",
    "title": copied_text(focused, "AXTitle") if focused else "",
    "value": copied_text(focused, "AXValue") if focused else "",
    "windowCount": len(windows),
    "sheetCount": sheet_count,
    "frontmost": copied_boolean(application, "AXFrontmost"),
    "mainWindow": (
        copied_boolean(front_window, "AXMain") if front_window else False
    ),
    "focusedWindow": (
        copied_boolean(front_window, "AXFocused") if front_window else False
    ),
    "actualFrontmostPid": (
        int(frontmost_app.processIdentifier()) if frontmost_app else -1
    ),
}
sys.stdout.write(json.dumps(result))
if windows_value:
    core_foundation.CFRelease(windows_value)
if focused:
    core_foundation.CFRelease(focused)
core_foundation.CFRelease(application)
"""

_ACTIVATION_PROBE = r"""
import json
import sys

import AppKit

application = AppKit.NSRunningApplication.runningApplicationWithProcessIdentifier_(
    int(sys.argv[1])
)
if application is None:
    raise SystemExit("Native actor process is unavailable")
workspace = AppKit.NSWorkspace.sharedWorkspace()
frontmost_before = workspace.frontmostApplication()
target_active_before = bool(application.isActive())
options = (
    AppKit.NSApplicationActivateAllWindows
    | AppKit.NSApplicationActivateIgnoringOtherApps
)
request_accepted = bool(application.activateWithOptions_(options))
frontmost_after = workspace.frontmostApplication()
sys.stdout.write(
    json.dumps(
        {
            "activationMode": "uncoordinated-fallback",
            "activationPolicy": int(application.activationPolicy()),
            "finishedLaunching": bool(application.isFinishedLaunching()),
            "hidden": bool(application.isHidden()),
            "targetActiveBefore": target_active_before,
            "requestAccepted": request_accepted,
            "targetActiveAfter": bool(application.isActive()),
            "frontmostPidBefore": (
                int(frontmost_before.processIdentifier())
                if frontmost_before is not None
                else -1
            ),
            "frontmostPidAfter": (
                int(frontmost_after.processIdentifier())
                if frontmost_after is not None
                else -1
            ),
        }
    )
)
if not request_accepted:
    raise SystemExit("AppKit rejected Native actor activation")
"""

_WINDOW_STACK_PROBE = r"""
import json
import sys

try:
    import Quartz

    point_x = float(sys.argv[1])
    point_y = float(sys.argv[2])
    windows = Quartz.CGWindowListCopyWindowInfo(
        Quartz.kCGWindowListOptionOnScreenOnly,
        Quartz.kCGNullWindowID,
    )
    owners = []
    for index, window in enumerate(windows):
        bounds = window.get(Quartz.kCGWindowBounds) or {}
        left = float(bounds.get("X", 0))
        top = float(bounds.get("Y", 0))
        width = float(bounds.get("Width", 0))
        height = float(bounds.get("Height", 0))
        if not (
            left <= point_x < left + width
            and top <= point_y < top + height
        ):
            continue
        owners.append(
            {
                "index": index,
                "ownerPid": int(window.get(Quartz.kCGWindowOwnerPID, 0)),
                "ownerName": str(window.get(Quartz.kCGWindowOwnerName, "")),
                "windowName": str(window.get(Quartz.kCGWindowName, "")),
                "layer": int(window.get(Quartz.kCGWindowLayer, 0)),
                "alpha": float(window.get(Quartz.kCGWindowAlpha, 0)),
                "bounds": {
                    "left": left,
                    "top": top,
                    "width": width,
                    "height": height,
                },
            }
        )
    print(json.dumps({"windows": owners[:16]}))
except Exception as error:
    print(json.dumps({"error": f"{type(error).__name__}: {error}"}))
"""

_KEY_CODES = {
    NativeKey.A: 0,
    NativeKey.G: 5,
    NativeKey.V: 9,
    NativeKey.DELETE: 51,
    NativeKey.ENTER: 36,
    NativeKey.TAB: 48,
    NativeKey.ESCAPE: 53,
}
_MODIFIER_CODES = {
    NativeModifier.PRIMARY: (55, 0x00100000),
    NativeModifier.SHIFT: (56, 0x00020000),
}
_MOUSE_EVENT_TYPES = {
    MouseAction.LEFT_DOWN: 1,
    MouseAction.LEFT_UP: 2,
    MouseAction.MOVE: 5,
}
_CONTROL_KINDS = {
    "AXList": "list",
    "AXTextField": "text-field",
}


class MacOSNativeDesktopAdapter(NativeDesktopAdapter):
    @property
    def platform(self) -> str:
        return "macos"

    def activate_process(self, process_id: int) -> None:
        process_id = self._validated_process_id(process_id)
        appkit_activation = subprocess.run(
            (sys.executable, "-c", _ACTIVATION_PROBE, str(process_id)),
            capture_output=True,
            text=True,
            check=False,
        )
        if appkit_activation.returncode != 0:
            raise DriverError(
                "Native actor AppKit activation failed: "
                f"{appkit_activation.stderr.strip() or appkit_activation.stdout.strip()}"
            )

        script = f"""
        tell application "System Events"
          set targetProcess to first application process whose unix id is {process_id}
          set frontmost of targetProcess to true
          try
            perform action "AXRaise" of front window of targetProcess
          end try
          try
            set value of attribute "AXMain" of front window of targetProcess to true
          end try
          try
            perform action "AXRaise" of front window of targetProcess
          end try
          return frontmost of targetProcess
        end tell
        """
        completed = subprocess.run(
            ("osascript", "-e", script),
            capture_output=True,
            text=True,
            check=False,
        )
        if completed.returncode != 0:
            raise DriverError(
                "Native actor activation failed: "
                f"{completed.stderr.strip() or completed.stdout.strip()}"
            )
        if completed.stdout.strip() != "true":
            raise DriverError(
                f"Native actor process {process_id} did not become frontmost"
            )

    def post_mouse(
        self,
        actions: tuple[MouseAction, ...],
        point: tuple[float, float],
    ) -> None:
        class CGPoint(ctypes.Structure):
            _fields_ = [("x", ctypes.c_double), ("y", ctypes.c_double)]

        core_graphics, core_foundation = self._event_frameworks()
        core_graphics.CGEventCreateMouseEvent.argtypes = [
            ctypes.c_void_p,
            ctypes.c_uint32,
            CGPoint,
            ctypes.c_uint32,
        ]
        core_graphics.CGEventCreateMouseEvent.restype = ctypes.c_void_p
        native_point = CGPoint(*point)
        for action in actions:
            event = core_graphics.CGEventCreateMouseEvent(
                None,
                _MOUSE_EVENT_TYPES[action],
                native_point,
                0,
            )
            if not event:
                raise DriverError(
                    "CoreGraphics failed to create Native mouse event"
                )
            core_graphics.CGEventPost(0, event)
            core_foundation.CFRelease(event)

    def post_key(
        self,
        key: NativeKey,
        *,
        modifiers: tuple[NativeModifier, ...] = (),
        text: str = "",
        private_source: bool = False,
    ) -> None:
        core_graphics, core_foundation = self._event_frameworks()
        core_graphics.CGEventCreateKeyboardEvent.argtypes = [
            ctypes.c_void_p,
            ctypes.c_uint16,
            ctypes.c_bool,
        ]
        core_graphics.CGEventCreateKeyboardEvent.restype = ctypes.c_void_p
        core_graphics.CGEventSourceCreate.argtypes = [ctypes.c_int32]
        core_graphics.CGEventSourceCreate.restype = ctypes.c_void_p
        core_graphics.CGEventSetFlags.argtypes = [
            ctypes.c_void_p,
            ctypes.c_uint64,
        ]
        core_graphics.CGEventKeyboardSetUnicodeString.argtypes = [
            ctypes.c_void_p,
            ctypes.c_ulong,
            ctypes.POINTER(ctypes.c_uint16),
        ]
        encoded = text.encode("utf-16-le")
        unicode_units = (ctypes.c_uint16 * (len(encoded) // 2)).from_buffer_copy(
            encoded
        )
        source = (
            core_graphics.CGEventSourceCreate(-1)
            if modifiers or private_source
            else None
        )
        if (modifiers or private_source) and not source:
            raise DriverError(
                "CoreGraphics failed to create Native private event source"
            )

        active_flags = 0

        def post(key_code: int, pressed: bool, flags: int) -> None:
            event = core_graphics.CGEventCreateKeyboardEvent(
                source,
                key_code,
                pressed,
            )
            if not event:
                raise DriverError(
                    "CoreGraphics failed to create Native keyboard event"
                )
            try:
                if flags:
                    core_graphics.CGEventSetFlags(event, flags)
                if text and key_code == _KEY_CODES[key]:
                    core_graphics.CGEventKeyboardSetUnicodeString(
                        event,
                        len(unicode_units),
                        unicode_units,
                    )
                core_graphics.CGEventPost(0, event)
            finally:
                core_foundation.CFRelease(event)

        try:
            for modifier in modifiers:
                modifier_key, modifier_flag = _MODIFIER_CODES[modifier]
                active_flags |= modifier_flag
                post(modifier_key, True, active_flags)
            post(_KEY_CODES[key], True, active_flags)
            post(_KEY_CODES[key], False, active_flags)
            for modifier in reversed(modifiers):
                modifier_key, modifier_flag = _MODIFIER_CODES[modifier]
                active_flags &= ~modifier_flag
                post(modifier_key, False, active_flags)
        finally:
            if source:
                core_foundation.CFRelease(source)

    def focused_control(self, process_id: int) -> NativeControlSnapshot:
        process_id = self._validated_process_id(process_id)
        try:
            completed = subprocess.run(
                (sys.executable, "-c", _ACCESSIBILITY_PROBE, str(process_id)),
                capture_output=True,
                text=True,
                check=False,
                timeout=2,
            )
        except subprocess.TimeoutExpired:
            return NativeControlSnapshot(
                error="Native Accessibility probe timed out"
            )
        if completed.returncode != 0:
            return NativeControlSnapshot(error=completed.stderr.strip())
        try:
            value = json.loads(completed.stdout)
        except json.JSONDecodeError:
            return NativeControlSnapshot(
                error=f"unexpected AX response: {completed.stdout!r}"
            )
        if not isinstance(value, dict):
            return NativeControlSnapshot(error="invalid AX response")
        role = str(value.get("role") or "")
        subrole = str(value.get("subrole") or "")
        kind = (
            "application-dialog"
            if subrole == "AXApplicationDialog"
            else _CONTROL_KINDS.get(role, "other" if role else "unknown")
        )
        return NativeControlSnapshot(
            kind=kind,
            title=str(value.get("title") or ""),
            value=str(value.get("value") or ""),
            window_count=int(value.get("windowCount") or 0),
            dialog_count=int(value.get("sheetCount") or 0),
            frontmost=bool(value.get("frontmost")),
            main_window=bool(value.get("mainWindow")),
            focused_window=bool(value.get("focusedWindow")),
            actual_frontmost_pid=int(value.get("actualFrontmostPid") or -1),
            platform_role=role,
            platform_subrole=subrole,
        )

    def window_stack_at_point(
        self,
        point: tuple[float, float],
    ) -> NativeWindowStack:
        completed = subprocess.run(
            (
                sys.executable,
                "-c",
                _WINDOW_STACK_PROBE,
                str(point[0]),
                str(point[1]),
            ),
            capture_output=True,
            text=True,
            check=False,
        )
        if completed.returncode != 0:
            return NativeWindowStack(
                error=completed.stderr.strip()
                or f"window stack probe exited {completed.returncode}"
            )
        try:
            value = json.loads(completed.stdout)
        except json.JSONDecodeError:
            return NativeWindowStack(
                error=f"invalid window stack probe: {completed.stdout!r}"
            )
        if not isinstance(value, dict):
            return NativeWindowStack(error="invalid window stack")
        error = str(value.get("error") or "")
        windows: list[NativeWindowSnapshot] = []
        for raw_window in value.get("windows") or []:
            if not isinstance(raw_window, dict):
                continue
            raw_bounds = raw_window.get("bounds")
            bounds = raw_bounds if isinstance(raw_bounds, dict) else {}
            windows.append(
                NativeWindowSnapshot(
                    index=int(raw_window.get("index") or 0),
                    owner_pid=int(raw_window.get("ownerPid") or 0),
                    owner_name=str(raw_window.get("ownerName") or ""),
                    window_name=str(raw_window.get("windowName") or ""),
                    layer=int(raw_window.get("layer") or 0),
                    alpha=float(raw_window.get("alpha") or 0),
                    bounds=NativeWindowBounds(
                        left=float(bounds.get("left") or 0),
                        top=float(bounds.get("top") or 0),
                        width=float(bounds.get("width") or 0),
                        height=float(bounds.get("height") or 0),
                    ),
                )
            )
        return NativeWindowStack(windows=tuple(windows), error=error)

    def mouse_button_down(self) -> bool:
        core_graphics = ctypes.CDLL(
            "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics"
        )
        core_graphics.CGEventSourceButtonState.argtypes = [
            ctypes.c_int32,
            ctypes.c_uint32,
        ]
        core_graphics.CGEventSourceButtonState.restype = ctypes.c_bool
        return bool(core_graphics.CGEventSourceButtonState(0, 0))

    def capture_screenshot(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        completed = subprocess.run(
            ("/usr/sbin/screencapture", "-x", str(path)),
            capture_output=True,
            text=True,
            check=False,
        )
        if completed.returncode != 0 or not path.is_file():
            raise DriverError(
                "macOS desktop screenshot failed: "
                f"{completed.stderr.strip() or completed.stdout.strip()}"
            )

    def read_clipboard(self) -> bytes:
        completed = subprocess.run(
            ("/usr/bin/pbpaste",),
            capture_output=True,
            check=False,
        )
        if completed.returncode != 0:
            raise DriverError("Native file chooser could not read the clipboard")
        return completed.stdout

    def write_clipboard(self, value: bytes) -> None:
        completed = subprocess.run(
            ("/usr/bin/pbcopy",),
            input=value,
            capture_output=True,
            check=False,
        )
        if completed.returncode != 0:
            raise DriverError("Native file chooser could not write the clipboard")

    @staticmethod
    def _event_frameworks() -> tuple[ctypes.CDLL, ctypes.CDLL]:
        core_graphics = ctypes.CDLL(
            "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics"
        )
        core_foundation = ctypes.CDLL(
            "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation"
        )
        core_graphics.CGEventPost.argtypes = [
            ctypes.c_uint32,
            ctypes.c_void_p,
        ]
        core_foundation.CFRelease.argtypes = [ctypes.c_void_p]
        return core_graphics, core_foundation

    @staticmethod
    def _validated_process_id(process_id: int) -> int:
        try:
            value = int(process_id)
        except (TypeError, ValueError) as error:
            raise DriverError(
                f"Native process ID is invalid: {process_id!r}"
            ) from error
        if value <= 0:
            raise DriverError(f"Native process ID must be positive: {value}")
        return value
