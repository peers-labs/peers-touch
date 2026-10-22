"""Synthetic checks for physical-cell attachment and failure ownership."""

from __future__ import annotations

import unittest

from tooling.acceptance.core import BlockedError
from tooling.acceptance.provisioners import get_runtime_cell_lifecycle


class MobileRuntimeCellTests(unittest.TestCase):
    def test_mobile_cell_without_native_owner_blocks_without_provisioning(self) -> None:
        for cell_id in ("mobile-ios-native", "mobile-android-native"):
            with self.subTest(cell_id=cell_id):
                lifecycle = get_runtime_cell_lifecycle(cell_id)
                with self.assertRaises(BlockedError):
                    lifecycle.ready("synthetic-gate")
                self.assertEqual(lifecycle.status(), {"cellId": cell_id, "attached": False})
                self.assertEqual(lifecycle.stop()["resourceCleanupOwner"], "environment-provisioner")

    def test_foreign_owner_cannot_supply_device_authority(self) -> None:
        lifecycle = get_runtime_cell_lifecycle(
            "mobile-android-native", provisioner=object(),
        )
        with self.assertRaises(BlockedError):
            lifecycle.ready("synthetic-gate")


if __name__ == "__main__":
    unittest.main()
