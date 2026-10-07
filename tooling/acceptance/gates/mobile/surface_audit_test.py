from __future__ import annotations

import unittest

from tooling.acceptance.core import GateError
from tooling.acceptance.gates.mobile.surface_audit import (
    audit_accessibility_tree,
    audit_keyboard_tree,
)


class SurfaceAuditTests(unittest.TestCase):
    def test_rejects_malformed_accessibility_tree(self) -> None:
        with self.assertRaisesRegex(GateError, "malformed"):
            audit_accessibility_tree("<AppiumAUT>")

    def test_rejects_malformed_keyboard_tree(self) -> None:
        with self.assertRaisesRegex(GateError, "malformed"):
            audit_keyboard_tree("<AppiumAUT>")


if __name__ == "__main__":
    unittest.main()
