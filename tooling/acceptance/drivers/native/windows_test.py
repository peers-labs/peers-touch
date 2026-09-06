from __future__ import annotations

import ast
import ctypes
import sys
import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.drivers.native.base import NativeDesktopAdapter


WINDOWS_ADAPTER_PATH = Path(__file__).with_name("windows.py")


class Win32NativeDesktopAdapterContractTest(unittest.TestCase):
    def test_implements_complete_native_adapter_contract(self) -> None:
        module = ast.parse(WINDOWS_ADAPTER_PATH.read_text(encoding="utf-8"))
        adapter = next(
            node
            for node in module.body
            if isinstance(node, ast.ClassDef)
            and node.name == "Win32NativeDesktopAdapter"
        )
        implemented = {
            node.name
            for node in adapter.body
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        }
        self.assertEqual(
            set(NativeDesktopAdapter.__abstractmethods__) - implemented,
            set(),
        )

    def test_uses_only_standard_library_win32_bindings(self) -> None:
        source = WINDOWS_ADAPTER_PATH.read_text(encoding="utf-8")
        self.assertIn("ctypes.windll.user32", source)
        self.assertIn("ctypes.windll.kernel32", source)
        self.assertIn("ctypes.windll.gdi32", source)
        self.assertNotIn("win32api", source)
        self.assertNotIn("pywinauto", source)

    def test_activation_preserves_focus_when_process_is_already_foreground(self) -> None:
        source = WINDOWS_ADAPTER_PATH.read_text(encoding="utf-8")
        activation = source[
            source.index("    def activate_process("):
            source.index("    def post_mouse(")
        ]
        foreground_guard = activation.index(
            "self._window_process_id(foreground) == process_id"
        )
        early_return = activation.index("return", foreground_guard)
        top_level_focus = activation.index("_user32.SetFocus(hwnd)")

        self.assertLess(foreground_guard, early_return)
        self.assertLess(early_return, top_level_focus)


@unittest.skipUnless(sys.platform == "win32", "Windows-only native smoke")
class Win32NativeDesktopAdapterSmokeTest(unittest.TestCase):
    def test_screen_metrics_and_screenshot(self) -> None:
        from tooling.acceptance.drivers.native.windows import (
            Win32NativeDesktopAdapter,
        )

        adapter = Win32NativeDesktopAdapter()
        self.assertEqual(adapter.platform, "win32")
        self.assertGreater(ctypes.windll.user32.GetSystemMetrics(0), 0)
        self.assertGreater(ctypes.windll.user32.GetSystemMetrics(1), 0)

        with tempfile.TemporaryDirectory() as directory:
            screenshot = Path(directory) / "desktop.bmp"
            adapter.capture_screenshot(screenshot)
            self.assertGreater(screenshot.stat().st_size, 54)


if __name__ == "__main__":
    unittest.main()
