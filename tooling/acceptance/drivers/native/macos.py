from __future__ import annotations

import ctypes
import json
import subprocess
import sys
import time
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


_CG_IMAGE_ALPHA_NONE = frozenset((0, 5, 6))
_CG_IMAGE_ALPHA_FIRST = frozenset((2, 4))
_CG_IMAGE_ALPHA_LAST = frozenset((1, 3))
_CG_IMAGE_ALPHA_ONLY = 7
_CG_BITMAP_BYTE_ORDER_MASK = 0x7000
_CG_BITMAP_BYTE_ORDER_32_LITTLE = 0x2000


def _pixel_buffer_has_visible_alpha(
    content: bytes,
    *,
    width: int,
    height: int,
    bits_per_pixel: int,
    bytes_per_row: int,
    alpha_info: int,
    bitmap_info: int,
) -> bool:
    """Return whether a CoreGraphics point sample contains a visible pixel."""
    if alpha_info in _CG_IMAGE_ALPHA_NONE:
        return True
    if width <= 0 or height <= 0 or bits_per_pixel <= 0:
        return True
    if bits_per_pixel % 8 != 0:
        return True

    bytes_per_pixel = bits_per_pixel // 8
    if bytes_per_pixel <= 0 or bytes_per_row < width * bytes_per_pixel:
        return True

    little_endian = (
        bitmap_info & _CG_BITMAP_BYTE_ORDER_MASK
    ) == _CG_BITMAP_BYTE_ORDER_32_LITTLE
    if alpha_info in _CG_IMAGE_ALPHA_FIRST:
        alpha_offset = bytes_per_pixel - 1 if little_endian else 0
    elif alpha_info in _CG_IMAGE_ALPHA_LAST:
        alpha_offset = 0 if little_endian else bytes_per_pixel - 1
    elif alpha_info == _CG_IMAGE_ALPHA_ONLY:
        alpha_offset = 0
    else:
        return True

    required_size = (height - 1) * bytes_per_row + width * bytes_per_pixel
    if len(content) < required_size:
        return True
    return any(
        content[
            row * bytes_per_row
            + column * bytes_per_pixel
            + alpha_offset
        ]
        > 0
        for row in range(height)
        for column in range(width)
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
"""

_FILE_CHOOSER_SELECTION_PROBE = r"""
import ctypes
import json
import sys
import time
from pathlib import Path

process_id = int(sys.argv[1])
target_path = Path(sys.argv[2]).expanduser().resolve()
home = Path.home().resolve()
try:
    path_parts = target_path.relative_to(home).parts
except ValueError:
    raise SystemExit("Native file chooser target must be under the user home")
if not target_path.is_file() or not path_parts:
    raise SystemExit("Native file chooser target is not a file")

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
application_services.AXUIElementCopyActionNames.argtypes = [
    CFRef,
    ctypes.POINTER(CFRef),
]
application_services.AXUIElementCopyActionNames.restype = ctypes.c_int32
application_services.AXUIElementIsAttributeSettable.argtypes = [
    CFRef,
    CFRef,
    ctypes.POINTER(ctypes.c_bool),
]
application_services.AXUIElementIsAttributeSettable.restype = ctypes.c_int32
application_services.AXUIElementSetAttributeValue.argtypes = [
    CFRef,
    CFRef,
    CFRef,
]
application_services.AXUIElementSetAttributeValue.restype = ctypes.c_int32
application_services.AXUIElementPerformAction.argtypes = [CFRef, CFRef]
application_services.AXUIElementPerformAction.restype = ctypes.c_int32
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
core_foundation.CFArrayGetCount.argtypes = [CFRef]
core_foundation.CFArrayGetCount.restype = CFIndex
core_foundation.CFArrayGetValueAtIndex.argtypes = [CFRef, CFIndex]
core_foundation.CFArrayGetValueAtIndex.restype = CFRef
core_foundation.CFArrayCreate.argtypes = [
    CFRef,
    ctypes.POINTER(CFRef),
    CFIndex,
    CFRef,
]
core_foundation.CFArrayCreate.restype = CFRef
core_foundation.CFRetain.argtypes = [CFRef]
core_foundation.CFRetain.restype = CFRef
core_foundation.CFRelease.argtypes = [CFRef]


def create_string(value):
    return core_foundation.CFStringCreateWithCString(
        None,
        value.encode("utf-8"),
        UTF8,
    )


def copy_attribute(element, name):
    key = create_string(name)
    value = CFRef()
    try:
        error = application_services.AXUIElementCopyAttributeValue(
            element,
            key,
            ctypes.byref(value),
        )
    finally:
        core_foundation.CFRelease(key)
    return value if error == 0 and value else None


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
    if not core_foundation.CFStringGetCString(
        value,
        buffer,
        size,
        UTF8,
    ):
        return ""
    return buffer.value.decode("utf-8")


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


def copied_actions(element):
    value = CFRef()
    error = application_services.AXUIElementCopyActionNames(
        element,
        ctypes.byref(value),
    )
    try:
        return (
            [decode_text(item) for item in array_items(value)]
            if error == 0 and value
            else []
        )
    finally:
        if value:
            core_foundation.CFRelease(value)


def attribute_is_settable(element, name):
    key = create_string(name)
    result = ctypes.c_bool()
    try:
        error = application_services.AXUIElementIsAttributeSettable(
            element,
            key,
            ctypes.byref(result),
        )
    finally:
        core_foundation.CFRelease(key)
    return error == 0 and bool(result.value)


def find_path(element, predicate, path=(), depth=0):
    current_path = (*path, element)
    if predicate(element, current_path):
        return tuple(
            core_foundation.CFRetain(item)
            for item in current_path
        )
    if depth >= 14:
        return None
    children = copy_attribute(element, "AXChildren")
    try:
        for child in array_items(children):
            result = find_path(
                child,
                predicate,
                current_path,
                depth + 1,
            )
            if result is not None:
                return result
    finally:
        if children:
            core_foundation.CFRelease(children)
    return None


def release_path(path):
    if path is None:
        return
    for element in path:
        core_foundation.CFRelease(element)


application = application_services.AXUIElementCreateApplication(process_id)
application_services.AXUIElementSetMessagingTimeout(application, 1.0)


def open_panel():
    windows_value = copy_attribute(application, "AXWindows")
    fallback = None
    try:
        for window in array_items(windows_value):
            if copied_text(window, "AXIdentifier") == "open-panel":
                return core_foundation.CFRetain(window)
            button = find_path(
                window,
                lambda element, _: (
                    copied_text(element, "AXIdentifier") == "OKButton"
                ),
            )
            if button is not None:
                release_path(button)
                fallback = window
        return (
            core_foundation.CFRetain(fallback)
            if fallback is not None
            else None
        )
    finally:
        if windows_value:
            core_foundation.CFRelease(windows_value)


def find_in_panel(predicate):
    panel = open_panel()
    if panel is None:
        return None
    try:
        return find_path(panel, predicate)
    finally:
        core_foundation.CFRelease(panel)


def wait_for_path(predicate, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = find_in_panel(predicate)
        if result is not None:
            return result
        time.sleep(0.05)
    return None


def perform_action(element, action_name):
    action = create_string(action_name)
    try:
        return application_services.AXUIElementPerformAction(
            element,
            action,
        )
    finally:
        core_foundation.CFRelease(action)


def select_visible_item(filename):
    item_path = wait_for_path(
        lambda element, _: (
            copied_text(element, "AXFilename") == filename
        ),
        5.0,
    )
    button_path = wait_for_path(
        lambda element, _: (
            copied_text(element, "AXIdentifier") == "OKButton"
        ),
        2.0,
    )
    if item_path is None or button_path is None:
        release_path(item_path)
        release_path(button_path)
        raise RuntimeError(
            f"Native file chooser item is unavailable: {filename}"
        )
    try:
        selection_container_index = next(
            index
            for index in range(len(item_path) - 1, -1, -1)
            if attribute_is_settable(
                item_path[index],
                "AXSelectedChildren",
            )
        )
        selection_item = item_path[selection_container_index + 1]
        values = (CFRef * 1)(selection_item)
        selection = core_foundation.CFArrayCreate(
            None,
            values,
            1,
            None,
        )
        selected_children = create_string("AXSelectedChildren")
        try:
            application_services.AXUIElementSetAttributeValue(
                item_path[selection_container_index],
                selected_children,
                selection,
            )
        finally:
            core_foundation.CFRelease(selected_children)
            core_foundation.CFRelease(selection)
        perform_action(button_path[-1], "AXPress")
    finally:
        release_path(item_path)
        release_path(button_path)


try:
    home_path = wait_for_path(
        lambda element, path: (
            copied_text(element, "AXValue") == home.name
            and any(
                copied_text(ancestor, "AXRole") == "AXOutline"
                and copied_text(ancestor, "AXDescription") == "sidebar"
                for ancestor in path
            )
        ),
        5.0,
    )
    if home_path is None:
        raise RuntimeError("Native file chooser home sidebar item is unavailable")
    try:
        home_action = next(
            element
            for element in reversed(home_path)
            if "AXOpen" in copied_actions(element)
        )
        perform_action(home_action, "AXOpen")
    finally:
        release_path(home_path)

    for index, part in enumerate(path_parts):
        select_visible_item(part)
        if index + 1 < len(path_parts):
            next_part = wait_for_path(
                lambda element, _: (
                    copied_text(element, "AXFilename")
                    == path_parts[index + 1]
                ),
                5.0,
            )
            if next_part is None:
                raise RuntimeError(
                    "Native file chooser did not navigate to "
                    f"{part}"
                )
            release_path(next_part)

    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        panel = open_panel()
        if panel is None:
            break
        core_foundation.CFRelease(panel)
        time.sleep(0.05)
    else:
        raise RuntimeError(
            "Native file chooser remained open after file selection"
        )
except Exception as error:
    core_foundation.CFRelease(application)
    raise SystemExit(f"{type(error).__name__}: {error}")

core_foundation.CFRelease(application)
sys.stdout.write(
    json.dumps(
        {
            "selected": True,
            "path": str(target_path),
            "pathParts": list(path_parts),
        }
    )
)
"""

_WINDOW_STACK_PROBE = r"""
import json
import sys

from tooling.acceptance.drivers.native.macos import (
    _pixel_buffer_has_visible_alpha,
)

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
        window_id = int(window.get(Quartz.kCGWindowNumber, 0))
        sample = Quartz.CGWindowListCreateImage(
            Quartz.CGRectMake(point_x, point_y, 1, 1),
            Quartz.kCGWindowListOptionIncludingWindow,
            window_id,
            Quartz.kCGWindowImageBoundsIgnoreFraming,
        )
        if sample is not None:
            provider = Quartz.CGImageGetDataProvider(sample)
            sample_content = (
                Quartz.CGDataProviderCopyData(provider)
                if provider is not None
                else None
            )
            if (
                sample_content is not None
                and not _pixel_buffer_has_visible_alpha(
                    bytes(sample_content),
                    width=int(Quartz.CGImageGetWidth(sample)),
                    height=int(Quartz.CGImageGetHeight(sample)),
                    bits_per_pixel=int(
                        Quartz.CGImageGetBitsPerPixel(sample)
                    ),
                    bytes_per_row=int(
                        Quartz.CGImageGetBytesPerRow(sample)
                    ),
                    alpha_info=int(Quartz.CGImageGetAlphaInfo(sample)),
                    bitmap_info=int(Quartz.CGImageGetBitmapInfo(sample)),
                )
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
    NativeKey.L: 37,
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
    MouseAction.LEFT_DRAG: 6,
}
_CONTROL_KINDS = {
    "AXList": "list",
    "AXTextField": "text-field",
}
_MEDIA_PERMISSION_ALLOW_BUTTON_IDENTIFIER = "action-button-1"


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

    def reveal_file_chooser_location(self) -> None:
        self.post_key(
            NativeKey.G,
            modifiers=(NativeModifier.PRIMARY, NativeModifier.SHIFT),
        )

    def reveal_file_chooser_location_to_process(
        self,
        process_id: int,
    ) -> NativeControlSnapshot | None:
        process_id = self._validated_process_id(process_id)
        owner = self.focused_control(process_id)
        if (
            not owner.frontmost
            or owner.actual_frontmost_pid != process_id
        ):
            raise DriverError(
                "Native file chooser shortcut target is not frontmost: "
                f"{owner.to_dict()}"
            )
        self.reveal_file_chooser_location()
        deadline = time.monotonic() + 2.5
        while time.monotonic() < deadline:
            control = self.focused_control(process_id)
            if control.kind == "text-field":
                return control
            time.sleep(0.05)
        return None

    def select_file_chooser_path_to_process(
        self,
        process_id: int,
        path: str,
    ) -> NativeControlSnapshot | None:
        process_id = self._validated_process_id(process_id)
        target = Path(path).expanduser().resolve()
        if not target.is_file():
            raise DriverError(
                f"Native file chooser target is missing: {target}"
            )
        try:
            target.relative_to(Path.home().resolve())
        except ValueError as error:
            raise DriverError(
                "Native file chooser target must be staged under the user home"
            ) from error
        owner = self.focused_control(process_id)
        if (
            not owner.frontmost
            or owner.actual_frontmost_pid != process_id
        ):
            raise DriverError(
                "Native file chooser selection target is not frontmost: "
                f"{owner.to_dict()}"
            )
        try:
            completed = subprocess.run(
                (
                    sys.executable,
                    "-c",
                    _FILE_CHOOSER_SELECTION_PROBE,
                    str(process_id),
                    str(target),
                ),
                capture_output=True,
                text=True,
                check=False,
                timeout=30,
            )
        except subprocess.TimeoutExpired as error:
            raise DriverError(
                "Native file chooser Accessibility selection timed out"
            ) from error
        if completed.returncode != 0:
            raise DriverError(
                "Native file chooser Accessibility selection failed: "
                f"{completed.stderr.strip() or completed.stdout.strip()}"
            )
        try:
            result = json.loads(completed.stdout)
        except json.JSONDecodeError as error:
            raise DriverError(
                "Native file chooser returned an invalid selection result: "
                f"{completed.stdout!r}"
            ) from error
        if (
            not isinstance(result, dict)
            or result.get("selected") is not True
            or result.get("path") != str(target)
        ):
            raise DriverError(
                f"Native file chooser did not select the staged path: {result!r}"
            )
        control = self.focused_control(process_id)
        return NativeControlSnapshot(
            kind="file-selection",
            value=str(target),
            window_count=control.window_count,
            dialog_count=control.dialog_count,
            frontmost=control.frontmost,
            main_window=control.main_window,
            focused_window=control.focused_window,
            actual_frontmost_pid=control.actual_frontmost_pid,
            platform_role=control.platform_role,
            platform_subrole=control.platform_subrole,
            error=control.error,
        )

    def accept_media_capture_permission_to_process(
        self,
        process_id: int,
    ) -> bool:
        process_id = self._validated_process_id(process_id)
        script = f"""
        tell application "System Events"
          tell first application process whose unix id is {process_id}
            repeat 40 times
              repeat with candidateWindow in windows
                repeat with candidateSheet in sheets of candidateWindow
                  repeat with candidateButton in buttons of candidateSheet
                    try
                      if (value of attribute "AXIdentifier" of candidateButton as text) is "{_MEDIA_PERMISSION_ALLOW_BUTTON_IDENTIFIER}" then
                        click candidateButton
                        return "pressed"
                      end if
                    end try
                  end repeat
                end repeat
              end repeat
              delay 0.05
            end repeat
            return "missing"
          end tell
        end tell
        """
        try:
            completed = subprocess.run(
                ("osascript", "-e", script),
                capture_output=True,
                text=True,
                check=False,
                timeout=5,
            )
        except subprocess.TimeoutExpired as error:
            raise DriverError(
                "Native media-capture permission inspection timed out"
            ) from error
        if completed.returncode != 0:
            raise DriverError(
                "Native media-capture permission action failed: "
                f"{completed.stderr.strip() or completed.stdout.strip()}"
            )
        result = completed.stdout.strip()
        if result == "pressed":
            return True
        if result == "missing":
            return False
        raise DriverError(
            "Native media-capture permission action returned an invalid result: "
            f"{result!r}"
        )

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
