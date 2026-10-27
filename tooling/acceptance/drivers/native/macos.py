from __future__ import annotations

import ctypes
import json
import math
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from tooling.acceptance.core.errors import DriverError
from tooling.acceptance.drivers.native.base import (
    MouseAction,
    NativeControlSnapshot,
    NativeDesktopAdapter,
    NativeInputMode,
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
import time

import AppKit
from tooling.acceptance.drivers.native.macos_ax import AXReadSession

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
application_services.AXUIElementCreateSystemWide.restype = CFRef
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
application_services.AXUIElementSetAttributeValue.argtypes = [CFRef, CFRef, CFRef]
application_services.AXUIElementSetAttributeValue.restype = ctypes.c_int32
application_services.AXUIElementPerformAction.argtypes = [CFRef, CFRef]
application_services.AXUIElementPerformAction.restype = ctypes.c_int32
application_services.AXValueCreate.argtypes = [ctypes.c_int32, ctypes.c_void_p]
application_services.AXValueCreate.restype = CFRef
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
reads = AXReadSession(
    application_services, core_foundation, deadline=time.monotonic() + 1.5,
)
copy_attribute = reads.copy_attribute
set_attribute = reads.set_attribute
perform_action = reads.perform_action


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
windows_value = copy_attribute(application, "AXWindows", required=True)
windows = array_items(windows_value)
front_window = next(
    (window for window in windows if copied_boolean(window, "AXMain")),
    windows[0] if windows else None,
)
operation = sys.argv[2] if len(sys.argv) > 2 else "inspect"
if operation != "inspect":
    if front_window is None:
        raise RuntimeError("main window is absent")
    if operation == "position":
        class CGPoint(ctypes.Structure):
            _fields_ = [("x", ctypes.c_double), ("y", ctypes.c_double)]
        point = CGPoint(*json.loads(sys.argv[3]))
        position = application_services.AXValueCreate(1, ctypes.byref(point))
        if not position:
            raise RuntimeError("cannot create AX window position")
        try:
            set_attribute(front_window, "AXPosition", position)
        finally:
            core_foundation.CFRelease(position)
    elif operation == "activate":
        true_value = CFRef.in_dll(core_foundation, "kCFBooleanTrue")
        set_attribute(application, "AXFrontmost", true_value)
        set_attribute(front_window, "AXMain", true_value)
        perform_action(front_window, "AXRaise")
    elif operation == "close":
        close_button = copy_attribute(front_window, "AXCloseButton", required=True)
        try:
            perform_action(close_button, "AXPress")
        finally:
            core_foundation.CFRelease(close_button)
    else:
        raise RuntimeError(f"unsupported Accessibility operation: {operation}")
    sys.stdout.write(json.dumps({"operation": operation}))
    core_foundation.CFRelease(windows_value)
    core_foundation.CFRelease(application)
    raise SystemExit(0)
focused = copy_attribute(application, "AXFocusedUIElement")
sheet_count = 0
for window in windows:
    sheets_value = copy_attribute(window, "AXSheets")
    try:
        sheet_count += len(array_items(sheets_value))
    finally:
        if sheets_value:
            core_foundation.CFRelease(sheets_value)
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

from tooling.acceptance.drivers.native.macos_ax import AXReadSession

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
reads = AXReadSession(
    application_services, core_foundation, deadline=time.monotonic() + 29,
)
create_string = reads.string
copy_attribute = reads.copy_attribute
perform_action = reads.perform_action


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


def attribute_is_settable(element, name):
    key = create_string(name)
    result = ctypes.c_bool()
    try:
        error = reads.read(
            element, name,
            lambda: application_services.AXUIElementIsAttributeSettable(
                element, key, ctypes.byref(result),
            ),
        )
        if error not in (0, -25205, -25212):
            raise RuntimeError(f"{name} settable inspection failed: AX error {error}")
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


def open_panel():
    reads.begin_observation()
    windows_value = copy_attribute(application, "AXWindows", required=True)
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


class ListSelectionUnsupported(RuntimeError):
    # The panel browser advertises selection but rejects the AX mutation.
    pass


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
        try:
            # The browser list advertises AXSelectedChildren but the XPC
            # service rejects the mutation with -25205. Report it so the
            # driver falls back to the location-field path instead of
            # weakening any other failure.
            try:
                reads.set_attribute(
                    item_path[selection_container_index],
                    "AXSelectedChildren",
                    selection,
                )
            except RuntimeError as error:
                if "AX error -25205" not in str(error):
                    raise
                raise ListSelectionUnsupported(str(error)) from error
        finally:
            core_foundation.CFRelease(selection)
        perform_action(button_path[-1], "AXPress")
    finally:
        release_path(item_path)
        release_path(button_path)


try:
    home_path = wait_for_path(
        lambda element, path: (
            copied_text(element, "AXRole") == "AXStaticText"
            and copied_text(element, "AXValue") == home.name
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
    # The XPC-hosted NSOpenPanel advertises AXOpen on its sidebar rows but the
    # action returns -25205. Select Home through the outline's real
    # AXSelectedRows mutation. A panel already rooted at Home needs no
    # navigation; the first filename wait proves the resulting location.
    try:
        outline_index = next(
            index
            for index, ancestor in enumerate(home_path[:-1])
            if copied_text(ancestor, "AXRole") == "AXOutline"
            and copied_text(ancestor, "AXDescription") == "sidebar"
        )
        values = (CFRef * 1)(home_path[outline_index + 1])
        selection = core_foundation.CFArrayCreate(None, values, 1, None)
        try:
            reads.set_attribute(
                home_path[outline_index], "AXSelectedRows", selection,
            )
        except RuntimeError:
            if find_in_panel(
                lambda element, _: (
                    copied_text(element, "AXFilename") == path_parts[0]
                )
            ) is None:
                raise RuntimeError(
                    "Native file chooser Home sidebar selection is unavailable"
                )
        finally:
            core_foundation.CFRelease(selection)
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
except ListSelectionUnsupported:
    core_foundation.CFRelease(application)
    sys.stdout.write(
        json.dumps(
            {
                "selected": False,
                "reason": "list-selection-unsupported",
                "path": str(target_path),
            }
        )
    )
    raise SystemExit(0)
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
    NativeKey.C: 8,
    NativeKey.G: 5,
    NativeKey.L: 37,
    NativeKey.V: 9,
    NativeKey.COMMA: 43,
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


@dataclass(frozen=True)
class MacOSStatusItemSnapshot:
    role: str
    subrole: str
    title: str
    help: str
    position: tuple[float, float]
    size: tuple[float, float]
    menu_items: tuple[str, ...]

    def to_dict(self) -> dict[str, object]:
        return {
            "role": self.role,
            "subrole": self.subrole,
            "title": self.title,
            "help": self.help,
            "position": {
                "x": self.position[0],
                "y": self.position[1],
            },
            "size": {
                "width": self.size[0],
                "height": self.size[1],
            },
            "menuItems": list(self.menu_items),
        }


class MacOSNativeDesktopAdapter(NativeDesktopAdapter):
    def __init__(
        self,
        input_mode: NativeInputMode = NativeInputMode.SEMANTIC_NON_INTRUSIVE,
    ) -> None:
        self._input_mode = input_mode

    @property
    def input_mode(self) -> NativeInputMode:
        return self._input_mode

    @property
    def platform(self) -> str:
        return "macos"

    def activate_process(self, process_id: int) -> None:
        self.require_exclusive_input("activate macOS process")
        process_id = self._validated_process_id(process_id)
        try:
            appkit_activation = subprocess.run(
                (sys.executable, "-c", _ACTIVATION_PROBE, str(process_id)),
                capture_output=True,
                text=True,
                check=False,
                timeout=2,
            )
        except subprocess.TimeoutExpired as error:
            raise DriverError("Native actor AppKit activation timed out") from error
        if appkit_activation.returncode != 0:
            raise DriverError(
                "Native actor AppKit activation failed: "
                f"{appkit_activation.stderr.strip() or appkit_activation.stdout.strip()}"
            )
        self._accessibility(process_id, "activate")
        state = self._accessibility(process_id)
        if (
            state["frontmost"] is not True
            or state["actualFrontmostPid"] != process_id
        ):
            raise DriverError(
                f"Native actor process {process_id} did not become frontmost"
            )

    def position_main_window(
        self,
        process_id: int,
        point: tuple[float, float],
    ) -> None:
        process_id = self._validated_process_id(process_id)
        x, y = (float(value) for value in point)
        if not all(math.isfinite(value) for value in (x, y)):
            raise DriverError("macOS main-window position is invalid")
        self._accessibility(process_id, "position", json.dumps((x, y)))

    def status_item_snapshot(
        self,
        process_id: int,
        *,
        expected_help: str,
    ) -> MacOSStatusItemSnapshot:
        process_id = self._validated_process_id(process_id)
        if not expected_help or "\t" in expected_help or "\n" in expected_help:
            raise DriverError("macOS status-item help text is invalid")
        script = f"""
        tell application "System Events"
          set targetProcess to first application process whose unix id is {process_id}
          set targetItem to missing value
          repeat with targetBar in menu bars of targetProcess
            repeat with candidateItem in menu bar items of targetBar
              try
                if help of candidateItem is {json.dumps(expected_help)} then
                  set targetItem to candidateItem
                  exit repeat
                end if
              end try
            end repeat
            if targetItem is not missing value then exit repeat
          end repeat
          if targetItem is missing value then error "status item not found"
          set itemTitle to ""
          try
            set itemTitle to title of targetItem as text
          end try
          set itemPosition to position of targetItem
          set itemSize to size of targetItem
          set menuTitles to ""
          if (count of menus of targetItem) > 0 then
            repeat with targetMenuItem in menu items of menu 1 of targetItem
              try
                set menuTitle to title of targetMenuItem as text
                if menuTitle is not "" then
                  if menuTitles is not "" then set menuTitles to menuTitles & "|"
                  set menuTitles to menuTitles & menuTitle
                end if
              end try
            end repeat
          end if
          return (role of targetItem as text) & tab & ¬
            (subrole of targetItem as text) & tab & itemTitle & tab & ¬
            (help of targetItem as text) & tab & ¬
            (item 1 of itemPosition as text) & tab & ¬
            (item 2 of itemPosition as text) & tab & ¬
            (item 1 of itemSize as text) & tab & ¬
            (item 2 of itemSize as text) & tab & menuTitles
        end tell
        """
        output = self._run_osascript(script, "status-item inspection")
        fields = output.split("\t")
        if len(fields) != 9:
            raise DriverError(
                "macOS status-item inspection returned an invalid shape"
            )
        try:
            position = (float(fields[4]), float(fields[5]))
            size = (float(fields[6]), float(fields[7]))
        except ValueError as error:
            raise DriverError(
                "macOS status-item geometry is invalid"
            ) from error
        return MacOSStatusItemSnapshot(
            role=fields[0],
            subrole=fields[1],
            title=fields[2],
            help=fields[3],
            position=position,
            size=size,
            menu_items=tuple(
                item for item in fields[8].split("|") if item
            ),
        )

    def window_state(self, process_id: int) -> dict[str, object]:
        process_id = self._validated_process_id(process_id)
        value = self._accessibility(process_id)
        return {
            key: value[key]
            for key in ("windowCount", "frontmost", "mainWindow", "focusedWindow")
        }

    def hide_main_window(
        self,
        process_id: int,
        *,
        timeout_seconds: float = 10.0,
    ) -> dict[str, object]:
        process_id = self._validated_process_id(process_id)
        self._accessibility(process_id, "close")
        return self._wait_for_window_count(
            process_id,
            expected_visible=False,
            timeout_seconds=timeout_seconds,
        )

    def show_main_window_from_status_item(
        self,
        process_id: int,
        *,
        expected_help: str,
        menu_item_title: str,
        timeout_seconds: float = 10.0,
    ) -> dict[str, object]:
        process_id = self._validated_process_id(process_id)
        for value in (expected_help, menu_item_title):
            if not value or "\n" in value:
                raise DriverError("macOS status-item action text is invalid")
        script = f"""
        tell application "System Events"
          set targetProcess to first application process whose unix id is {process_id}
          set targetItem to missing value
          repeat with targetBar in menu bars of targetProcess
            repeat with candidateItem in menu bar items of targetBar
              try
                if help of candidateItem is {json.dumps(expected_help)} then
                  set targetItem to candidateItem
                  exit repeat
                end if
              end try
            end repeat
            if targetItem is not missing value then exit repeat
          end repeat
          if targetItem is missing value then error "status item not found"
          click targetItem
          click menu item {json.dumps(menu_item_title)} of menu 1 of targetItem
        end tell
        """
        self._run_osascript(script, "status-item Show action")
        return self._wait_for_window_count(
            process_id,
            expected_visible=True,
            timeout_seconds=timeout_seconds,
        )

    def _wait_for_window_count(
        self,
        process_id: int,
        *,
        expected_visible: bool,
        timeout_seconds: float,
    ) -> dict[str, object]:
        deadline = time.monotonic() + timeout_seconds
        last_state: dict[str, object] = {}
        while time.monotonic() < deadline:
            last_state = self.window_state(process_id)
            visible = int(last_state["windowCount"]) > 0
            if visible == expected_visible:
                if not expected_visible or (
                    last_state["frontmost"] is True
                    and last_state["mainWindow"] is True
                    and last_state["focusedWindow"] is True
                ):
                    return last_state
            time.sleep(0.1)
        raise DriverError(
            "macOS main-window visibility did not reach the expected state: "
            f"{last_state}"
        )

    @staticmethod
    def _run_osascript(script: str, operation: str) -> str:
        completed = subprocess.run(
            ("osascript", "-e", script),
            capture_output=True,
            text=True,
            check=False,
        )
        if completed.returncode != 0:
            raise DriverError(
                f"macOS {operation} failed: "
                f"{completed.stderr.strip() or completed.stdout.strip()}"
            )
        return completed.stdout.strip()

    def post_mouse(
        self,
        actions: tuple[MouseAction, ...],
        point: tuple[float, float],
    ) -> None:
        self.require_exclusive_input("post macOS global mouse event")

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

    def post_scroll(
        self,
        point: tuple[float, float],
        *,
        delta_y: int,
    ) -> None:
        self.require_exclusive_input("post macOS global scroll event")
        if type(delta_y) is not int or not -(2**31 - 1) <= delta_y <= 2**31 - 1:
            raise ValueError("Native pixel scroll delta must be a signed 32-bit integer")
        if delta_y == 0:
            raise ValueError("Native pixel scroll delta must not be zero")

        class CGPoint(ctypes.Structure):
            _fields_ = [("x", ctypes.c_double), ("y", ctypes.c_double)]

        core_graphics, core_foundation = self._event_frameworks()
        core_graphics.CGEventCreateScrollWheelEvent2.argtypes = [
            ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32,
            ctypes.c_int32, ctypes.c_int32, ctypes.c_int32,
        ]
        core_graphics.CGEventCreateScrollWheelEvent2.restype = ctypes.c_void_p
        core_graphics.CGEventSetLocation.argtypes = [ctypes.c_void_p, CGPoint]
        # kCGScrollEventUnitPixel=0; CoreGraphics positive deltas move upward.
        event = core_graphics.CGEventCreateScrollWheelEvent2(
            None, 0, 1, -delta_y, 0, 0,
        )
        if not event:
            raise DriverError("CoreGraphics failed to create Native scroll event")
        try:
            self.post_mouse((MouseAction.MOVE,), point)
            core_graphics.CGEventSetLocation(event, CGPoint(*point))
            core_graphics.CGEventPost(0, event)
        finally:
            core_foundation.CFRelease(event)

    def post_key(
        self,
        key: NativeKey,
        *,
        modifiers: tuple[NativeModifier, ...] = (),
        text: str = "",
        private_source: bool = False,
    ) -> None:
        self.require_exclusive_input("post macOS global keyboard event")
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
        # A standalone NSOpenPanel is key while its app-level AXFrontmost can
        # read false. Accept the real ownership signal: the system frontmost
        # process is the owner and its panel is the main window.
        if owner.actual_frontmost_pid != process_id:
            raise DriverError(
                "Native file chooser shortcut target is not frontmost: "
                f"{owner.to_dict()}"
            )
        if not (owner.frontmost or owner.main_window):
            raise DriverError(
                "Native file chooser shortcut target has no key panel: "
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
        self.require_exclusive_input("select path in macOS file chooser")
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
            isinstance(result, dict)
            and result.get("selected") is False
            and result.get("reason") == "list-selection-unsupported"
        ):
            # The panel browser rejects AX list mutation; the caller owns the
            # location-field fallback. No selection result may be invented.
            return None
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
        self.require_exclusive_input("accept macOS media capture permission")
        process_id = self._validated_process_id(process_id)
        try:
            self.activate_process(process_id)
        except DriverError as error:
            if "did not become frontmost" not in str(error):
                raise
        script = f"""
        tell application "System Events"
          tell first application process whose unix id is {process_id}
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
                timeout=2,
            )
        except subprocess.TimeoutExpired:
            return False
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

    def dismiss_owned_dialog_to_process(
        self,
        process_id: int,
        button_title: str = "Cancel",
        *,
        window_titles: tuple[str, ...] = ("Save", "Open", "Select File"),
        raise_if_missing: bool = True,
    ) -> bool:
        """Press a dialog button inside one process via a native AX click.

        Two instances of the same app bundle can coexist in the isolated GUI
        session. A global synthetic Escape is routed to the process that owns
        the key window, which may be the other instance. The click is scoped
        to the target process and its dialog window, so the dismissal cannot
        land on a sibling instance.
        """
        self.require_exclusive_input("dismiss macOS native dialog")
        process_id = self._validated_process_id(process_id)
        try:
            completed = subprocess.run(
                (
                    sys.executable, "-m",
                    "tooling.acceptance.drivers.native.macos_panels",
                    str(process_id), button_title, json.dumps(window_titles),
                ),
                capture_output=True, text=True, check=False, timeout=12,
            )
        except subprocess.TimeoutExpired as error:
            raise DriverError("Native dialog AX inspection timed out") from error
        if completed.returncode != 0:
            raise DriverError(
                "Native dialog AX inspection failed: "
                f"{completed.stderr.strip() or completed.stdout.strip()}"
            )
        try:
            result = json.loads(completed.stdout)
        except json.JSONDecodeError as error:
            raise DriverError("Native dialog AX inspection returned invalid JSON") from error
        if not isinstance(result, dict) or not isinstance(result.get("pressed"), bool):
            raise DriverError("Native dialog AX inspection returned an invalid result")
        if result["pressed"]:
            return True
        if raise_if_missing:
            raise DriverError(f"Native dialog button not found: {result}")
        return False

    @staticmethod
    def _accessibility(
        process_id: int,
        operation: str = "inspect",
        *arguments: str,
    ) -> dict[str, object]:
        try:
            completed = subprocess.run(
                (
                    sys.executable, "-c", _ACCESSIBILITY_PROBE,
                    str(process_id), operation, *arguments,
                ),
                capture_output=True,
                text=True,
                check=False,
                timeout=2,
            )
        except subprocess.TimeoutExpired as error:
            raise DriverError("Native Accessibility probe timed out") from error
        if completed.returncode != 0:
            raise DriverError(
                f"Native Accessibility {operation} failed: "
                f"{completed.stderr.strip() or completed.stdout.strip()}"
            )
        try:
            value = json.loads(completed.stdout)
        except json.JSONDecodeError as error:
            raise DriverError("Native Accessibility returned invalid JSON") from error
        if not isinstance(value, dict):
            raise DriverError("Native Accessibility returned an invalid result")
        if operation == "inspect":
            for key in ("frontmost", "mainWindow", "focusedWindow"):
                if not isinstance(value.get(key), bool):
                    raise DriverError(f"Native Accessibility returned invalid {key}")
            for key in ("windowCount", "sheetCount", "actualFrontmostPid"):
                if type(value.get(key)) is not int:
                    raise DriverError(f"Native Accessibility returned invalid {key}")
        elif value.get("operation") != operation:
            raise DriverError("Native Accessibility returned an unexpected operation")
        return value

    def focused_control(self, process_id: int) -> NativeControlSnapshot:
        process_id = self._validated_process_id(process_id)
        try:
            value = self._accessibility(process_id)
        except DriverError as error:
            return NativeControlSnapshot(error=str(error))
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
