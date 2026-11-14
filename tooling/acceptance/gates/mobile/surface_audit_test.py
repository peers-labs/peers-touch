from __future__ import annotations

import unittest

from tooling.acceptance.core import GateError
from tooling.acceptance.gates.mobile.surface_audit import (
    audit_accessibility_tree,
    audit_keyboard_tree,
)


class SurfaceAuditTests(unittest.TestCase):
    def test_accepts_one_pixel_xcuitest_rounding_at_screen_edge(self) -> None:
        result = audit_accessibility_tree(
            """
<AppiumAUT>
  <XCUIElementTypeApplication x="0" y="0" width="402" height="874">
    <XCUIElementTypeButton label="Me" x="301" y="784"
      width="102" height="57" visible="true" />
  </XCUIElementTypeApplication>
</AppiumAUT>
"""
        )

        self.assertEqual(result["interactiveCount"], 1)
        self.assertEqual(result["outsideScreen"], [])

    def test_rejects_malformed_accessibility_tree(self) -> None:
        with self.assertRaisesRegex(GateError, "malformed"):
            audit_accessibility_tree("<AppiumAUT>")

    def test_defers_webview_scroll_geometry_to_the_dom_audit(self) -> None:
        result = audit_accessibility_tree(
            """
<AppiumAUT>
  <XCUIElementTypeApplication x="0" y="0" width="393" height="852">
    <XCUIElementTypeWebView x="0" y="0" width="393" height="852">
      <XCUIElementTypeButton label="Scrollable action" x="16" y="900"
        width="361" height="44" visible="true" />
    </XCUIElementTypeWebView>
  </XCUIElementTypeApplication>
</AppiumAUT>
"""
        )

        self.assertEqual(result["interactiveCount"], 1)
        self.assertEqual(result["outsideScreen"], [])

    def test_rejects_native_controls_outside_application_bounds(self) -> None:
        with self.assertRaisesRegex(GateError, "escape"):
            audit_accessibility_tree(
                """
<AppiumAUT>
  <XCUIElementTypeApplication x="0" y="0" width="393" height="852">
    <XCUIElementTypeButton label="Native action" x="16" y="900"
      width="361" height="44" visible="true" />
  </XCUIElementTypeApplication>
</AppiumAUT>
"""
            )

    def test_defers_system_keyboard_geometry_to_the_keyboard_audit(self) -> None:
        result = audit_accessibility_tree(
            """
<AppiumAUT>
  <XCUIElementTypeApplication x="0" y="0" width="852" height="393">
    <XCUIElementTypeKeyboard x="0" y="220" width="852" height="190">
      <XCUIElementTypeButton label="return" x="790" y="350"
        width="70" height="44" visible="true" />
    </XCUIElementTypeKeyboard>
  </XCUIElementTypeApplication>
</AppiumAUT>
"""
        )

        self.assertEqual(result["interactiveCount"], 1)
        self.assertEqual(result["outsideScreen"], [])

    def test_accepts_out_of_process_dictation_controls_with_keyboard(self) -> None:
        result = audit_accessibility_tree(
            """
<AppiumAUT>
  <XCUIElementTypeApplication x="0" y="0" width="852" height="393">
    <XCUIElementTypeKeyboard x="0" y="75" width="852" height="318" />
    <XCUIElementTypeButton label="Dictate" x="860" y="340"
      width="44" height="44" visible="true" />
  </XCUIElementTypeApplication>
</AppiumAUT>
"""
        )

        self.assertEqual(result["interactiveCount"], 1)
        self.assertEqual(result["outsideScreen"], [])

    def test_rejects_malformed_keyboard_tree(self) -> None:
        with self.assertRaisesRegex(GateError, "malformed"):
            audit_keyboard_tree("<AppiumAUT>")

    def test_multiline_composer_is_audited_above_and_under_the_keyboard(self) -> None:
        for kind in ("XCUIElementTypeTextField", "XCUIElementTypeTextView"):
            with self.subTest(kind=kind):
                template = (
                    '<AppiumAUT><{kind} label="Message" x="20" y="{top}" '
                    'width="300" height="44" visible="true" />'
                    '<XCUIElementTypeKeyboard x="0" y="500" width="393" height="352" /></AppiumAUT>'
                )
                visible = audit_keyboard_tree(template.format(kind=kind, top=420))
                self.assertEqual(visible["textFieldBottom"], 464)
                with self.assertRaisesRegex(GateError, "occludes"):
                    audit_keyboard_tree(template.format(kind=kind, top=480))

    def test_landscape_keyboard_portrait_coordinates_are_normalized(self) -> None:
        template = """
<AppiumAUT>
  <XCUIElementTypeApplication x="0" y="0" width="874" height="402">
    <XCUIElementTypeTextField label="Search conversations" x="52" y="{top}"
      width="717" height="40" visible="true" />
    <XCUIElementTypeKeyboard x="2" y="75" width="162" height="724" visible="true">
      <XCUIElementTypeKey label="Q" x="123" y="77" width="36" height="73" />
    </XCUIElementTypeKeyboard>
  </XCUIElementTypeApplication>
</AppiumAUT>
"""
        result = audit_keyboard_tree(template.format(top=65))
        self.assertEqual(result["textFieldBottom"], 105)
        self.assertEqual(result["keyboardTop"], 238)
        self.assertEqual(result["rawKeyboardRect"], {"x": 2, "y": 75, "width": 162, "height": 724})
        self.assertEqual(result["keyboardRect"], {"x": 75, "y": 238, "width": 724, "height": 162})
        self.assertEqual(result["keyboardCoordinateSpace"], "portrait-to-landscape-left")
        with self.assertRaisesRegex(GateError, "occludes"):
            audit_keyboard_tree(template.format(top=210))

    def test_application_landscape_keyboard_keeps_real_occlusion(self) -> None:
        markup = """
<AppiumAUT>
  <XCUIElementTypeApplication x="0" y="0" width="874" height="402">
    <XCUIElementTypeTextField label="Search" x="52" y="65" width="717" height="40" />
    <XCUIElementTypeKeyboard x="0" y="75" width="874" height="327" />
  </XCUIElementTypeApplication>
</AppiumAUT>
"""
        with self.assertRaisesRegex(GateError, "occludes"):
            audit_keyboard_tree(markup)
        visible = audit_keyboard_tree(markup.replace('y="65"', 'y="20"'))
        self.assertEqual(visible["keyboardTop"], 75)
        self.assertEqual(visible["keyboardCoordinateSpace"], "application")


if __name__ == "__main__":
    unittest.main()
