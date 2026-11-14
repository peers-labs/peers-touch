"""Shared Mobile surface accessibility audit primitives."""

from __future__ import annotations

import xml.etree.ElementTree as ET
from typing import Any

from tooling.acceptance.core import GateError


INTERACTIVE_TYPES = {
    "XCUIElementTypeButton",
    "XCUIElementTypeLink",
    "XCUIElementTypeSecureTextField",
    "XCUIElementTypeSwitch",
    "XCUIElementTypeTextField",
    "XCUIElementTypeTextView",
}
GEOMETRY_TOLERANCE_PX = 1
SYSTEM_KEYBOARD_CONTROL_LABELS = {
    "Dictate",
    "dictation",
    "return",
}


def _rect(node: ET.Element) -> tuple[int, int, int, int] | None:
    try:
        return tuple(
            int(float(node.attrib[name]))
            for name in ("x", "y", "width", "height")
        )
    except (KeyError, TypeError, ValueError):
        return None


def audit_accessibility_tree(markup: str) -> dict[str, Any]:
    try:
        root = ET.fromstring(markup)
    except ET.ParseError as error:
        raise GateError("iOS accessibility tree is malformed") from error

    application = next(
        (
            node
            for node in root.iter()
            if node.tag == "XCUIElementTypeApplication"
        ),
        None,
    )
    application_rect = _rect(application) if application is not None else None
    if application_rect is None:
        raise GateError("iOS accessibility tree has no application bounds")
    _, _, screen_width, screen_height = application_rect
    webview_descendants = {
        id(descendant)
        for webview in root.iter()
        if webview.tag == "XCUIElementTypeWebView"
        for descendant in webview.iter()
    }
    keyboard_descendants = {
        id(descendant)
        for keyboard in root.iter()
        if keyboard.tag == "XCUIElementTypeKeyboard"
        for descendant in keyboard.iter()
    }
    keyboard_present = bool(keyboard_descendants)

    unlabeled: list[str] = []
    outside_screen: list[str] = []
    interactive_count = 0
    for node in root.iter():
        if node.tag not in INTERACTIVE_TYPES:
            continue
        if node.attrib.get("visible", "true") == "false":
            continue
        interactive_count += 1
        label = (
            node.attrib.get("label")
            or node.attrib.get("name")
            or node.attrib.get("value")
            or ""
        ).strip()
        if not label:
            unlabeled.append(node.tag)
        bounds = _rect(node)
        if bounds is None:
            outside_screen.append(f"{node.tag}:missing-bounds")
            continue
        x, y, width, height = bounds
        if (
            x < -GEOMETRY_TOLERANCE_PX
            or y < -GEOMETRY_TOLERANCE_PX
            or x + width > screen_width + GEOMETRY_TOLERANCE_PX
            or y + height > screen_height + GEOMETRY_TOLERANCE_PX
        ) and (
            id(node) not in webview_descendants
            and id(node) not in keyboard_descendants
            and not (
                keyboard_present
                and label in SYSTEM_KEYBOARD_CONTROL_LABELS
            )
        ):
            outside_screen.append(f"{node.tag}:{label[:80]}")

    if interactive_count == 0:
        raise GateError("iOS accessibility tree has no interactive elements")
    if unlabeled:
        raise GateError(
            "iOS accessibility tree contains unlabeled controls: "
            + ", ".join(unlabeled)
        )
    if outside_screen:
        raise GateError(
            "iOS accessibility controls escape the application bounds: "
            + ", ".join(outside_screen)
        )
    return {
        "interactiveCount": interactive_count,
        "unlabeled": unlabeled,
        "outsideScreen": outside_screen,
        "screen": {"width": screen_width, "height": screen_height},
    }


def audit_keyboard_tree(markup: str) -> dict[str, Any]:
    try:
        root = ET.fromstring(markup)
    except ET.ParseError as error:
        raise GateError("iOS keyboard tree is malformed") from error
    keyboard = next(
        (node for node in root.iter() if node.tag == "XCUIElementTypeKeyboard"),
        None,
    )
    text_field = next(
        (
            node
            for node in root.iter()
            if node.tag in {
                "XCUIElementTypeTextField",
                "XCUIElementTypeSecureTextField",
                "XCUIElementTypeTextView",
            }
            and node.attrib.get("visible", "true") != "false"
        ),
        None,
    )
    keyboard_rect = _rect(keyboard) if keyboard is not None else None
    text_field_rect = _rect(text_field) if text_field is not None else None
    if keyboard_rect is None or text_field_rect is None:
        raise GateError("iOS keyboard audit requires keyboard and text field")
    raw_keyboard_rect = keyboard_rect
    coordinate_space = "application"
    application = next(
        (node for node in root.iter() if node.tag == "XCUIElementTypeApplication"),
        None,
    )
    application_rect = _rect(application) if application is not None else None
    if application_rect is not None:
        app_x, app_y, screen_width, screen_height = application_rect
        x, y, width, height = keyboard_rect
        if (
            app_x == 0 and app_y == 0
            and screen_width > screen_height
            and height > screen_height
            and 0 <= x < x + width <= screen_height
            and 0 <= y < y + height <= screen_width
        ):
            # WDA LANDSCAPE is landscape-left. iOS can keep the entire keyboard
            # subtree in portrait coordinates while the app/text field rotates.
            # Transform that out-of-landscape, valid-portrait rectangle once;
            # already rotated keyboard bounds retain their original coordinates.
            keyboard_rect = (y, screen_height - x - width, height, width)
            coordinate_space = "portrait-to-landscape-left"
    _, keyboard_top, _, _ = keyboard_rect
    _, text_top, _, text_height = text_field_rect
    if text_top + text_height > keyboard_top:
        raise GateError(
            "iOS keyboard occludes the active text field: "
            f"textFieldBottom={text_top + text_height}, "
            f"keyboardTop={keyboard_top}"
        )
    return {
        "keyboardTop": keyboard_top,
        "textFieldBottom": text_top + text_height,
        "keyboardRect": dict(zip(("x", "y", "width", "height"), keyboard_rect)),
        "rawKeyboardRect": dict(zip(("x", "y", "width", "height"), raw_keyboard_rect)),
        "keyboardCoordinateSpace": coordinate_space,
    }
