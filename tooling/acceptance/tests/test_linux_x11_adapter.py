from __future__ import annotations

import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, call, patch

from tooling.acceptance.core.errors import DriverError
from tooling.acceptance.drivers.native import create_native_desktop_adapter
from tooling.acceptance.drivers.native.base import (
    MouseAction,
    NativeKey,
    NativeModifier,
)
from tooling.acceptance.drivers.native.linux_x11 import (
    LinuxX11NativeDesktopAdapter,
    _KEY_SYMBOLS,
    _MODIFIER_SYMBOLS,
)


class LinuxX11NativeDesktopAdapterTests(unittest.TestCase):
    def test_factory_returns_linux_adapter_for_linux_platform(self) -> None:
        with patch.dict("os.environ", {"DISPLAY": ":99"}):
            adapter = create_native_desktop_adapter("linux")

        self.assertIsInstance(adapter, LinuxX11NativeDesktopAdapter)
        self.assertEqual(adapter.platform, "linux")
        self.assertEqual(adapter.display_name, ":99")

    def test_display_is_required(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            with self.assertRaisesRegex(DriverError, "requires DISPLAY"):
                LinuxX11NativeDesktopAdapter()

    def test_process_operations_reject_invalid_pid(self) -> None:
        adapter = LinuxX11NativeDesktopAdapter(":99")
        for process_id in (0, -1, "not-a-pid"):
            with self.subTest(process_id=process_id):
                with self.assertRaisesRegex(DriverError, "process ID"):
                    adapter.activate_process(process_id)  # type: ignore[arg-type]

    def test_key_mapping_uses_x11_control_as_primary_modifier(self) -> None:
        self.assertEqual(_KEY_SYMBOLS[NativeKey.DELETE], "Delete")
        self.assertEqual(_KEY_SYMBOLS[NativeKey.ENTER], "Return")
        self.assertEqual(_MODIFIER_SYMBOLS[NativeModifier.PRIMARY], "Control_L")
        self.assertEqual(_MODIFIER_SYMBOLS[NativeModifier.SHIFT], "Shift_L")

    def test_mouse_buttons_move_pointer_to_the_contract_point_first(self) -> None:
        adapter = LinuxX11NativeDesktopAdapter(":99")
        display = Mock()
        xtest = types.ModuleType("Xlib.ext.xtest")
        xtest.fake_input = Mock()  # type: ignore[attr-defined]
        xlib = types.ModuleType("Xlib")
        xlib.X = types.SimpleNamespace(
            MotionNotify=6,
            ButtonPress=4,
            ButtonRelease=5,
        )
        extension = types.ModuleType("Xlib.ext")
        extension.xtest = xtest

        with (
            patch.object(adapter, "_open_display", return_value=display),
            patch.dict(
                sys.modules,
                {
                    "Xlib": xlib,
                    "Xlib.ext": extension,
                    "Xlib.ext.xtest": xtest,
                },
            ),
        ):
            adapter.post_mouse(
                (MouseAction.LEFT_DOWN, MouseAction.LEFT_UP),
                (29.4, 190.6),
            )

        self.assertEqual(
            xtest.fake_input.call_args_list,  # type: ignore[attr-defined]
            [
                call(display, 6, x=29, y=191),
                call(display, 4, 1, x=29, y=191),
                call(display, 5, 1, x=29, y=191),
            ],
        )
        display.sync.assert_called_once_with()
        display.close.assert_called_once_with()

    def test_window_bounds_translate_client_origin_into_root_coordinates(
        self,
    ) -> None:
        adapter = LinuxX11NativeDesktopAdapter(":99")
        display = Mock()
        root = Mock()
        window = Mock()
        display.screen.return_value.root = root
        window.get_geometry.return_value = types.SimpleNamespace(
            width=860,
            height=800,
        )
        root.translate_coords.return_value = types.SimpleNamespace(x=641, y=52)
        frame = types.SimpleNamespace(value=(1, 1, 20, 5))

        with patch.object(adapter, "_property", return_value=frame) as get_property:
            bounds = adapter._window_bounds(display, window)

        root.translate_coords.assert_called_once_with(window, 0, 0)
        window.translate_coords.assert_not_called()
        get_property.assert_called_once_with(
            display,
            window,
            "_NET_FRAME_EXTENTS",
            "CARDINAL",
        )
        self.assertEqual(bounds.left, 640)
        self.assertEqual(bounds.top, 32)
        self.assertEqual(bounds.width, 862)
        self.assertEqual(bounds.height, 825)

    def test_window_bounds_fall_back_when_frame_extents_are_absent(self) -> None:
        adapter = LinuxX11NativeDesktopAdapter(":99")
        display = Mock()
        root = Mock()
        window = Mock()
        display.screen.return_value.root = root
        window.get_geometry.return_value = types.SimpleNamespace(
            width=860,
            height=800,
        )
        root.translate_coords.return_value = types.SimpleNamespace(x=1, y=52)

        with patch.object(adapter, "_property", return_value=None):
            bounds = adapter._window_bounds(display, window)

        self.assertEqual(bounds.left, 1)
        self.assertEqual(bounds.top, 52)
        self.assertEqual(bounds.width, 860)
        self.assertEqual(bounds.height, 800)

    def test_focused_control_owns_active_descendant_dialog(self) -> None:
        adapter = LinuxX11NativeDesktopAdapter(":99")
        display = Mock()
        application_window = Mock()
        dialog_window = Mock()
        display.get_input_focus.return_value.focus = dialog_window

        def window_pid(_display: object, window: object) -> int:
            return 42 if window is application_window else 84

        with (
            patch.object(adapter, "_open_display", return_value=display),
            patch.object(
                adapter,
                "_client_windows",
                return_value=(application_window,),
            ),
            patch.object(adapter, "_active_window", return_value=dialog_window),
            patch.object(adapter, "_window_pid", side_effect=window_pid),
            patch.object(adapter, "_is_dialog", return_value=False),
            patch.object(
                adapter,
                "_is_native_dialog",
                side_effect=lambda _display, window: window is dialog_window,
            ),
            patch.object(
                adapter,
                "_is_descendant_process",
                side_effect=lambda process_id, ancestor_id: (
                    process_id == 84 and ancestor_id == 42
                ),
            ),
            patch.object(
                adapter,
                "_focused_accessible",
                return_value={
                    "kind": "unknown",
                    "title": "Upload background from local file",
                    "role": "push button",
                },
            ),
        ):
            control = adapter.focused_control(42)

        self.assertEqual(control.kind, "application-dialog")
        self.assertEqual(control.window_count, 2)
        self.assertEqual(control.dialog_count, 1)
        self.assertTrue(control.frontmost)
        self.assertTrue(control.focused_window)
        self.assertFalse(control.main_window)
        self.assertEqual(control.actual_frontmost_pid, 84)
        display.close.assert_called_once_with()

    def test_focused_control_rejects_unrelated_active_dialog(self) -> None:
        adapter = LinuxX11NativeDesktopAdapter(":99")
        display = Mock()
        application_window = Mock()
        unrelated_dialog = Mock()
        display.get_input_focus.return_value.focus = unrelated_dialog

        def window_pid(_display: object, window: object) -> int:
            return 42 if window is application_window else 84

        with (
            patch.object(adapter, "_open_display", return_value=display),
            patch.object(
                adapter,
                "_client_windows",
                return_value=(application_window,),
            ),
            patch.object(adapter, "_active_window", return_value=unrelated_dialog),
            patch.object(adapter, "_window_pid", side_effect=window_pid),
            patch.object(adapter, "_is_dialog", return_value=False),
            patch.object(adapter, "_is_native_dialog", return_value=True),
            patch.object(adapter, "_is_descendant_process", return_value=False),
            patch.object(adapter, "_focused_accessible", return_value={}),
        ):
            control = adapter.focused_control(42)

        self.assertEqual(control.kind, "application")
        self.assertEqual(control.window_count, 1)
        self.assertEqual(control.dialog_count, 0)
        self.assertFalse(control.frontmost)
        self.assertFalse(control.focused_window)
        self.assertFalse(control.main_window)
        self.assertEqual(control.actual_frontmost_pid, 84)
        display.close.assert_called_once_with()

    def test_zenity_normal_window_is_a_native_dialog(self) -> None:
        adapter = LinuxX11NativeDesktopAdapter(":99")
        display = Mock()
        window = Mock()

        with (
            patch.object(adapter, "_is_dialog", return_value=False),
            patch.object(
                adapter,
                "_window_class",
                return_value="zenity.zenity",
            ),
        ):
            self.assertTrue(adapter._is_native_dialog(display, window))

    def test_clipboard_commands_are_bound_to_the_declared_display(self) -> None:
        adapter = LinuxX11NativeDesktopAdapter(":99")
        read = subprocess.CompletedProcess(
            args=(),
            returncode=0,
            stdout=b"clipboard",
            stderr=b"",
        )
        write = subprocess.CompletedProcess(
            args=(),
            returncode=0,
            stdout=b"",
            stderr=b"",
        )
        with patch(
            "tooling.acceptance.drivers.native.linux_x11.subprocess.run",
            side_effect=(read, write),
        ) as run:
            self.assertEqual(adapter.read_clipboard(), b"clipboard")
            adapter.write_clipboard(b"next")

        self.assertEqual(run.call_args_list[0].args[0], (
            "xclip",
            "-selection",
            "clipboard",
            "-out",
        ))
        self.assertEqual(run.call_args_list[0].kwargs["env"]["DISPLAY"], ":99")
        self.assertEqual(run.call_args_list[1].kwargs["input"], b"next")

    def test_screenshot_must_create_a_nonempty_file(self) -> None:
        adapter = LinuxX11NativeDesktopAdapter(":99")
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "desktop.png"

            def create_screenshot(*_args: object, **_kwargs: object) -> subprocess.CompletedProcess[str]:
                path.write_bytes(b"png")
                return subprocess.CompletedProcess(args=(), returncode=0, stdout="", stderr="")

            with patch.object(adapter, "_run", side_effect=create_screenshot):
                adapter.capture_screenshot(path)

            self.assertEqual(path.read_bytes(), b"png")


if __name__ == "__main__":
    unittest.main()
