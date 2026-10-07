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

    def test_rejects_malformed_keyboard_tree(self) -> None:
        with self.assertRaisesRegex(GateError, "malformed"):
            audit_keyboard_tree("<AppiumAUT>")


if __name__ == "__main__":
    unittest.main()
