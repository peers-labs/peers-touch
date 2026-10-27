"""Bounded, process-owned AppKit panel actions through the native AX API.

System Events can expose an incomplete tree for an XPC-hosted file panel.
Read AXChildren directly and retain the selected control before AXPress;
never search another process when the requested owner has no panel.
"""

from __future__ import annotations

import ctypes
import json
import sys
import time
from contextlib import contextmanager
from collections.abc import Iterator

from tooling.acceptance.drivers.native.macos_ax import AXReadSession


_REF = ctypes.c_void_p
_UTF8 = 0x08000100
_MAX_NODES = 300
_MAX_DEPTH = 14
_PANEL_IDS = frozenset(("save-panel", "open-panel"))
# A bounded panel tree walk needs more than the 1.5s window-probe budget;
# every AX message still times out at 0.5s and the walk caps at 300 nodes.
_PANEL_READ_BUDGET_SECONDS = 8.0


class _Accessibility:
    def __init__(self, deadline: float) -> None:
        self.ax = ctypes.CDLL(
            "/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices"
        )
        self.cf = ctypes.CDLL(
            "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation"
        )
        signatures = (
            (self.ax.AXUIElementCreateApplication, [ctypes.c_int32], _REF),
            (self.ax.AXUIElementSetMessagingTimeout, [_REF, ctypes.c_float], ctypes.c_int32),
            (self.ax.AXUIElementCopyAttributeValue, [_REF, _REF, ctypes.POINTER(_REF)], ctypes.c_int32),
            (self.ax.AXUIElementPerformAction, [_REF, _REF], ctypes.c_int32),
            (self.cf.CFStringCreateWithCString, [_REF, ctypes.c_char_p, ctypes.c_uint32], _REF),
            (self.cf.CFGetTypeID, [_REF], ctypes.c_ulong),
            (self.cf.CFStringGetTypeID, [], ctypes.c_ulong),
            (self.cf.CFArrayGetTypeID, [], ctypes.c_ulong),
            (self.cf.CFBooleanGetTypeID, [], ctypes.c_ulong),
            (self.cf.CFBooleanGetValue, [_REF], ctypes.c_bool),
            (self.cf.CFStringGetLength, [_REF], ctypes.c_long),
            (self.cf.CFStringGetMaximumSizeForEncoding, [ctypes.c_long, ctypes.c_uint32], ctypes.c_long),
            (self.cf.CFStringGetCString, [_REF, ctypes.c_void_p, ctypes.c_long, ctypes.c_uint32], ctypes.c_bool),
            (self.cf.CFArrayGetCount, [_REF], ctypes.c_long),
            (self.cf.CFArrayGetValueAtIndex, [_REF, ctypes.c_long], _REF),
            (self.cf.CFRetain, [_REF], _REF),
            (self.cf.CFRelease, [_REF], None),
        )
        for function, arguments, result in signatures:
            function.argtypes = arguments
            function.restype = result
        self.reads = AXReadSession(
            self.ax, self.cf, deadline=deadline,
            read_budget_seconds=_PANEL_READ_BUDGET_SECONDS,
        )

    @contextmanager
    def attribute(
        self, element: _REF, name: str, *, required: bool = False,
    ) -> Iterator[_REF | None]:
        ref = self.reads.copy_attribute(element, name, required=required)
        try:
            yield ref
        finally:
            if ref:
                self.cf.CFRelease(ref)

    def text(self, element: _REF, name: str) -> str:
        with self.attribute(element, name) as ref:
            if not ref or self.cf.CFGetTypeID(ref) != self.cf.CFStringGetTypeID():
                return ""
            size = self.cf.CFStringGetMaximumSizeForEncoding(
                self.cf.CFStringGetLength(ref), _UTF8,
            ) + 1
            buffer = ctypes.create_string_buffer(size)
            if not self.cf.CFStringGetCString(ref, buffer, size, _UTF8):
                return ""
            return buffer.value.decode()

    def enabled(self, element: _REF) -> bool:
        with self.attribute(element, "AXEnabled") as ref:
            return bool(
                ref and self.cf.CFGetTypeID(ref) == self.cf.CFBooleanGetTypeID()
                and self.cf.CFBooleanGetValue(ref)
            )

    def items(self, ref: _REF | None) -> list[_REF]:
        if not ref or self.cf.CFGetTypeID(ref) != self.cf.CFArrayGetTypeID():
            return []
        return [
            self.cf.CFArrayGetValueAtIndex(ref, index)
            for index in range(self.cf.CFArrayGetCount(ref))
        ]

def press_panel_button(
    process_id: int, button_title: str, window_titles: tuple[str, ...],
    *, timeout_seconds: float = 10.0,
) -> dict[str, object]:
    """Press exactly one enabled control in exactly one owner-bound panel."""
    if process_id <= 0 or not button_title or not 0 < timeout_seconds <= 10:
        raise ValueError("native panel action has invalid owner, button or timeout")
    deadline = time.monotonic() + timeout_seconds
    api = _Accessibility(deadline)
    application = api.ax.AXUIElementCreateApplication(process_id)
    observation: dict[str, object] = {"pressed": False, "error": "panel unavailable"}
    raised = False
    try:
        while time.monotonic() < deadline:
            api.reads.begin_observation()
            visited = 0

            def find_button(node: _REF, depth: int = 0) -> _REF | None:
                nonlocal visited
                visited += 1
                if visited > _MAX_NODES or depth > _MAX_DEPTH or time.monotonic() >= deadline:
                    return None
                # Read the cheap role discriminator first; enabled/title are
                # fetched only for actual buttons so a panel walk stays inside
                # its bounded read budget.
                if api.text(node, "AXRole") == "AXButton" and api.enabled(node) and (
                    api.text(node, "AXTitle") == button_title
                    or (
                        button_title == "Cancel"
                        and api.text(node, "AXIdentifier") == "CancelButton"
                    )
                ):
                    return api.cf.CFRetain(node)
                with api.attribute(node, "AXChildren") as children:
                    for child in api.items(children):
                        found = find_button(child, depth + 1)
                        if found:
                            return found
                return None

            with api.attribute(application, "AXWindows", required=True) as windows:
                panels = [
                    window for window in api.items(windows)
                    if api.text(window, "AXIdentifier") in _PANEL_IDS
                    or api.text(window, "AXTitle") in window_titles
                ]
                if len(panels) > 1:
                    return {"pressed": False, "error": "native panel ownership is ambiguous"}
                if panels:
                    panel = panels[0]
                    if not raised:
                        api.reads.perform_action(panel, "AXRaise")
                        raised = True
                    button = find_button(panel)
                    observation = {
                        "pressed": False, "panelId": api.text(panel, "AXIdentifier"),
                        "visited": visited, "error": "native panel button unavailable",
                    }
                    if button:
                        try:
                            api.reads.perform_action(button, "AXPress")
                            return {**observation, "pressed": True, "error": ""}
                        finally:
                            api.cf.CFRelease(button)
            time.sleep(0.1)
        return observation
    finally:
        api.cf.CFRelease(application)


if __name__ == "__main__":
    result = press_panel_button(int(sys.argv[1]), sys.argv[2], tuple(json.loads(sys.argv[3])))
    sys.stdout.write(json.dumps(result))
