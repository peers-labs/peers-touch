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


if __name__ == "__main__":
    unittest.main()
