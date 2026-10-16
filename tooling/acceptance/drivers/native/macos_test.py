from __future__ import annotations

import unittest
from unittest import mock

from tooling.acceptance.drivers.native.macos import (
    MacOSNativeDesktopAdapter,
    MacOSStatusItemSnapshot,
)


class MacOSStatusItemAdapterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.adapter = MacOSNativeDesktopAdapter()
        self.process_patch = mock.patch.object(
            self.adapter,
            "_validated_process_id",
            return_value=123,
        )
        self.process_patch.start()
        self.addCleanup(self.process_patch.stop)

    def test_status_item_snapshot_parses_accessibility_contract(self) -> None:
        with mock.patch.object(
            self.adapter,
            "_run_osascript",
            return_value=(
                "AXMenuBarItem\tAXMenuExtra\t\tPeers Touch\t"
                "831\t4.5\t62\t24\tShow Peers Touch|Quit"
            ),
        ):
            snapshot = self.adapter.status_item_snapshot(
                123,
                expected_help="Peers Touch",
            )

        self.assertEqual(
            snapshot,
            MacOSStatusItemSnapshot(
                role="AXMenuBarItem",
                subrole="AXMenuExtra",
                title="",
                help="Peers Touch",
                position=(831.0, 4.5),
                size=(62.0, 24.0),
                menu_items=("Show Peers Touch", "Quit"),
            ),
        )

    def test_position_main_window_targets_exact_process(self) -> None:
        with mock.patch.object(
            self.adapter,
            "_run_osascript",
            return_value="",
        ) as run:
            self.adapter.position_main_window(123, (0.0, 32.0))

        script, operation = run.call_args.args
        self.assertIn("unix id is 123", script)
        self.assertIn("set position of window 1", script)
        self.assertIn("{0.0, 32.0}", script)
        self.assertEqual(operation, "main-window positioning")

    def test_window_state_parses_hidden_and_visible_states(self) -> None:
        with mock.patch.object(
            self.adapter,
            "_run_osascript",
            side_effect=(
                "0\tfalse\tfalse\tfalse",
                "1\ttrue\ttrue\ttrue",
            ),
        ):
            self.assertEqual(
                self.adapter.window_state(123),
                {
                    "windowCount": 0,
                    "frontmost": False,
                    "mainWindow": False,
                    "focusedWindow": False,
                },
            )
            self.assertEqual(
                self.adapter.window_state(123),
                {
                    "windowCount": 1,
                    "frontmost": True,
                    "mainWindow": True,
                    "focusedWindow": True,
                },
            )

    def test_show_uses_status_item_menu_and_waits_for_focus(self) -> None:
        with (
            mock.patch.object(
                self.adapter,
                "_run_osascript",
                return_value="",
            ) as run,
            mock.patch.object(
                self.adapter,
                "_wait_for_window_count",
                return_value={"windowCount": 1, "frontmost": True},
            ) as wait,
        ):
            result = self.adapter.show_main_window_from_status_item(
                123,
                expected_help="Peers Touch",
                menu_item_title="Show Peers Touch",
            )

        self.assertEqual(result["windowCount"], 1)
        self.assertIn("click targetItem", run.call_args.args[0])
        self.assertIn("Show Peers Touch", run.call_args.args[0])
        wait.assert_called_once_with(
            123,
            expected_visible=True,
            timeout_seconds=10.0,
        )

    def test_hide_uses_native_close_button(self) -> None:
        with (
            mock.patch.object(
                self.adapter,
                "_run_osascript",
                return_value="",
            ) as run,
            mock.patch.object(
                self.adapter,
                "_wait_for_window_count",
                return_value={"windowCount": 0},
            ) as wait,
        ):
            result = self.adapter.hide_main_window(123)

        self.assertEqual(result["windowCount"], 0)
        self.assertIn("AXCloseButton", run.call_args.args[0])
        wait.assert_called_once_with(
            123,
            expected_visible=False,
            timeout_seconds=10.0,
        )


if __name__ == "__main__":
    unittest.main()
