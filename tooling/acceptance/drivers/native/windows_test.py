from __future__ import annotations

import ast
import ctypes
import sys
import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.drivers.native.base import NativeDesktopAdapter


WINDOWS_ADAPTER_PATH = Path(__file__).with_name("windows.py")
WINDOWS_PROVISIONER_PATH = (
    Path(__file__).parents[2] / "provisioners" / "native_desktop_windows.py"
)


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

    def test_clipboard_pointer_apis_declare_64_bit_signatures(self) -> None:
        source = WINDOWS_ADAPTER_PATH.read_text(encoding="utf-8")
        for function in (
            "GlobalAlloc",
            "GlobalLock",
            "GlobalFree",
            "GetClipboardData",
            "SetClipboardData",
        ):
            self.assertIn(f"{function}.argtypes =", source)
            self.assertIn(f"{function}.restype = ctypes.c_void_p", source)

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

    def test_file_chooser_reveal_observes_focus_in_the_same_worker(self) -> None:
        source = WINDOWS_ADAPTER_PATH.read_text(encoding="utf-8")
        reveal_start = source.index(
            "    def reveal_file_chooser_location_to_process("
        )
        reveal = source[
            reveal_start:source.index("    def focused_control(", reveal_start)
        ]

        dialog_selection = reveal.index(
            "dialog_hwnd = self._file_chooser_window(process_id)"
        )
        activation = reveal.index(
            "self._activate_window(dialog_hwnd, process_id)"
        )
        input_delivery = reveal.index("self.reveal_file_chooser_location()")
        observation = reveal.index("self.focused_control(process_id)")

        self.assertLess(dialog_selection, activation)
        self.assertLess(activation, input_delivery)
        self.assertLess(input_delivery, observation)
        self.assertIn("_FILE_CHOOSER_FOCUS_STEPS", reveal)
        self.assertIn("_FILE_CHOOSER_FOCUS_TIMEOUT_SECONDS", reveal)
        self.assertIn('last_control.kind == "text-field"', reveal)
        self.assertIn(
            "Win32 Native file chooser did not expose its location field",
            reveal,
        )

    def test_file_chooser_detection_uses_the_common_dialog_class(self) -> None:
        source = WINDOWS_ADAPTER_PATH.read_text(encoding="utf-8")
        helper = source[
            source.index("    def _file_chooser_window("):
            source.index("    @staticmethod\n    def _process_name(")
        ]
        probe = source[
            source.index("    def focused_control("):
            source.index("    def window_stack_at_point(")
        ]
        dialog_count = probe[
            probe.index("            dialog_count = sum("):
            probe.index("            actor_frontmost =")
        ]

        self.assertIn('self._window_class_name(hwnd) == "#32770"', helper)
        self.assertIn('self._window_class_name(hwnd) == "#32770"', dialog_count)
        self.assertNotIn("_GW_OWNER", dialog_count)

    def test_file_chooser_path_targets_the_filename_edit_control(self) -> None:
        source = WINDOWS_ADAPTER_PATH.read_text(encoding="utf-8")
        start = source.index("    def select_file_chooser_path_to_process(")
        method = source[start:source.index("    def focused_control(", start)]

        self.assertIn("EnumChildWindows", method)
        self.assertIn('self._window_class_name(child_hwnd).lower() == "edit"', method)
        self.assertIn("key=lambda hwnd: self._window_rect(hwnd).top", method)
        self.assertIn("_WM_SETTEXT", method)
        self.assertIn("GetDlgItem(dialog_hwnd, _IDOK)", method)
        self.assertIn("_BM_CLICK", method)
        self.assertIn("while self._file_chooser_window(process_id):", method)
        self.assertIn("self._activate_window(dialog_hwnd, process_id)", method)

    def test_staged_fixture_path_is_stable_across_content_changes(self) -> None:
        source = WINDOWS_PROVISIONER_PATH.read_text(encoding="utf-8")
        start = source.index("    def stage_actor_file(")
        method = source[start:source.index("    def actor_file_sha256(", start)]

        self.assertIn("os.fsencode(local_source)", method)
        self.assertIn('"fixtures",\n            source_identity,', method)
        self.assertIn("!= content_digest", method)

    def test_focus_probe_reads_the_foreground_gui_thread(self) -> None:
        source = WINDOWS_ADAPTER_PATH.read_text(encoding="utf-8")
        helper = source[
            source.index("    def _focused_window_for_gui_thread("):
            source.index("    def _window_text(")
        ]
        probe = source[
            source.index("    def focused_control("):
            source.index("    def window_stack_at_point(")
        ]

        self.assertIn("GetWindowThreadProcessId(hwnd, None)", helper)
        self.assertIn("GetGUIThreadInfo(thread_id, ctypes.byref(info))", helper)
        self.assertIn(
            "self._focused_window_for_gui_thread(foreground_hwnd)",
            probe,
        )
        self.assertNotIn("GetFocus(", probe)

    def test_dialog_probe_preserves_specific_control_kind_and_value(self) -> None:
        source = WINDOWS_ADAPTER_PATH.read_text(encoding="utf-8")
        probe = source[
            source.index("    def focused_control("):
            source.index("    def window_stack_at_point(")
        ]

        self.assertIn('kind = "text-field"', probe)
        self.assertIn("value = title", probe)
        self.assertIn(
            'if kind == "application" and dialog_count > 0:',
            probe,
        )
        self.assertNotIn(
            'if dialog_count > 0:\n                    kind = "application-dialog"',
            probe,
        )


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
