from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from tooling.acceptance.core.errors import DriverError
from tooling.acceptance.drivers.native import (
    MouseAction,
    NativeControlSnapshot,
    NativeDesktopAdapter,
    NativeKey,
    NativeModifier,
    NativeWindowBounds,
    NativeWindowSnapshot,
    NativeWindowStack,
    create_native_desktop_adapter,
)
from tooling.acceptance.drivers.native import macos
from tooling.acceptance.drivers.native.macos import MacOSNativeDesktopAdapter


class SyntheticNativeDesktopAdapter(NativeDesktopAdapter):
    def __init__(self) -> None:
        self.mouse_down = False
        self.actions: list[tuple[tuple[MouseAction, ...], tuple[float, float]]] = []

    @property
    def platform(self) -> str:
        return "synthetic"

    def activate_process(self, process_id: int) -> None:
        return None

    def post_mouse(
        self,
        actions: tuple[MouseAction, ...],
        point: tuple[float, float],
    ) -> None:
        self.actions.append((actions, point))
        self.mouse_down = actions[-1] == MouseAction.LEFT_DOWN

    def post_key(
        self,
        key: NativeKey,
        *,
        modifiers: tuple[NativeModifier, ...] = (),
        text: str = "",
        private_source: bool = False,
    ) -> None:
        return None

    def focused_control(self, process_id: int) -> NativeControlSnapshot:
        return NativeControlSnapshot()

    def window_stack_at_point(
        self,
        point: tuple[float, float],
    ) -> NativeWindowStack:
        return NativeWindowStack()

    def mouse_button_down(self) -> bool:
        return self.mouse_down

    def capture_screenshot(self, path: Path) -> None:
        path.write_bytes(b"screenshot")

    def read_clipboard(self) -> bytes:
        return b"clipboard"

    def write_clipboard(self, value: bytes) -> None:
        return None


class NativeDesktopAdapterContractTests(unittest.TestCase):
    def test_contract_is_abstract(self) -> None:
        with self.assertRaises(TypeError):
            NativeDesktopAdapter()

    def test_stuck_button_recovery_posts_one_release(self) -> None:
        adapter = SyntheticNativeDesktopAdapter()
        adapter.mouse_down = True

        self.assertTrue(adapter.release_stuck_mouse_button((10.0, 20.0)))
        self.assertEqual(
            adapter.actions,
            [((MouseAction.LEFT_UP,), (10.0, 20.0))],
        )
        self.assertFalse(adapter.mouse_button_down())
        self.assertFalse(adapter.release_stuck_mouse_button((10.0, 20.0)))

    def test_unimplemented_windows_slot_fails_closed(self) -> None:
        with self.assertRaisesRegex(DriverError, "not implemented"):
            create_native_desktop_adapter("win32")

    def test_darwin_factory_returns_macos_adapter(self) -> None:
        self.assertIsInstance(
            create_native_desktop_adapter("darwin"),
            MacOSNativeDesktopAdapter,
        )

    def test_diagnostic_snapshot_uses_stable_cross_platform_fields(self) -> None:
        snapshot = NativeControlSnapshot(
            kind="text-field",
            window_count=2,
            dialog_count=1,
            actual_frontmost_pid=42,
            platform_role="AXTextField",
        )
        self.assertEqual(
            set(snapshot.to_dict()),
            {
                "kind",
                "title",
                "value",
                "windowCount",
                "dialogCount",
                "frontmost",
                "mainWindow",
                "focusedWindow",
                "actualFrontmostPid",
                "platformRole",
                "platformSubrole",
                "error",
            },
        )

    def test_point_ownership_requires_the_top_visible_window(self) -> None:
        bounds = NativeWindowBounds(0, 0, 100, 100)
        occluding = NativeWindowSnapshot(
            index=0,
            owner_pid=7,
            owner_name="Other",
            window_name="Overlay",
            layer=0,
            alpha=1,
            bounds=bounds,
        )
        target = NativeWindowSnapshot(
            index=1,
            owner_pid=42,
            owner_name="Peers Touch",
            window_name="Main",
            layer=0,
            alpha=1,
            bounds=bounds,
        )

        self.assertFalse(
            NativeWindowStack(windows=(occluding, target)).point_owned_by(42)
        )
        self.assertTrue(
            NativeWindowStack(windows=(target, occluding)).point_owned_by(42)
        )

    def test_platform_adapter_does_not_import_chat_business_code(self) -> None:
        native_root = (
            Path(__file__).resolve().parents[1] / "drivers" / "native"
        )
        offenders = [
            path.name
            for path in native_root.glob("*.py")
            if "tooling.acceptance.gates.chat" in path.read_text(
                encoding="utf-8"
            )
        ]
        self.assertEqual(offenders, [])


class MacOSNativeDesktopAdapterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.adapter = MacOSNativeDesktopAdapter()

    def test_focused_control_maps_platform_fields_to_typed_snapshot(self) -> None:
        result = subprocess.CompletedProcess(
            args=(),
            returncode=0,
            stdout=(
                '{"role":"AXTextField","subrole":"","title":"Open",'
                '"value":"/tmp/file","windowCount":2,"sheetCount":1,'
                '"frontmost":true,"mainWindow":true,"focusedWindow":true,'
                '"actualFrontmostPid":42}'
            ),
            stderr="",
        )
        with patch(
            "tooling.acceptance.drivers.native.macos.subprocess.run",
            return_value=result,
        ):
            snapshot = self.adapter.focused_control(42)

        self.assertEqual(snapshot.kind, "text-field")
        self.assertEqual(snapshot.value, "/tmp/file")
        self.assertEqual(snapshot.window_count, 2)
        self.assertEqual(snapshot.dialog_count, 1)
        self.assertEqual(snapshot.actual_frontmost_pid, 42)
        self.assertEqual(snapshot.platform_role, "AXTextField")

    def test_event_mappings_preserve_existing_macos_input_semantics(self) -> None:
        self.assertEqual(
            macos._MOUSE_EVENT_TYPES,
            {
                MouseAction.LEFT_DOWN: 1,
                MouseAction.LEFT_UP: 2,
                MouseAction.MOVE: 5,
            },
        )
        self.assertEqual(macos._KEY_CODES[NativeKey.A], 0)
        self.assertEqual(macos._KEY_CODES[NativeKey.G], 5)
        self.assertEqual(macos._KEY_CODES[NativeKey.V], 9)
        self.assertEqual(macos._KEY_CODES[NativeKey.DELETE], 51)
        self.assertEqual(macos._KEY_CODES[NativeKey.ENTER], 36)
        self.assertEqual(macos._KEY_CODES[NativeKey.TAB], 48)
        self.assertEqual(macos._KEY_CODES[NativeKey.ESCAPE], 53)
        self.assertEqual(
            macos._MODIFIER_CODES[NativeModifier.PRIMARY],
            (55, 0x00100000),
        )
        self.assertEqual(
            macos._MODIFIER_CODES[NativeModifier.SHIFT],
            (56, 0x00020000),
        )

    def test_process_operations_reject_invalid_pid(self) -> None:
        for process_id in (0, -1, "not-a-pid"):
            with self.subTest(process_id=process_id):
                with self.assertRaisesRegex(DriverError, "process ID"):
                    self.adapter.activate_process(process_id)  # type: ignore[arg-type]

    def test_focused_control_timeout_is_typed_error(self) -> None:
        with patch(
            "tooling.acceptance.drivers.native.macos.subprocess.run",
            side_effect=subprocess.TimeoutExpired(("probe",), 2),
        ):
            snapshot = self.adapter.focused_control(42)

        self.assertEqual(snapshot.error, "Native Accessibility probe timed out")

    def test_window_stack_preserves_order_and_point_owner(self) -> None:
        result = subprocess.CompletedProcess(
            args=(),
            returncode=0,
            stdout=(
                '{"windows":['
                '{"index":0,"ownerPid":42,"ownerName":"Peers Touch",'
                '"windowName":"Main","layer":0,"alpha":1,'
                '"bounds":{"left":1,"top":2,"width":3,"height":4}},'
                '{"index":1,"ownerPid":7,"ownerName":"Other",'
                '"windowName":"","layer":0,"alpha":1,'
                '"bounds":{"left":1,"top":2,"width":3,"height":4}}]}'
            ),
            stderr="",
        )
        with patch(
            "tooling.acceptance.drivers.native.macos.subprocess.run",
            return_value=result,
        ):
            stack = self.adapter.window_stack_at_point((10.0, 20.0))

        self.assertEqual([window.owner_pid for window in stack.windows], [42, 7])
        self.assertTrue(stack.point_owned_by(42))
        self.assertFalse(stack.point_owned_by(8))

    def test_activation_runs_appkit_before_system_events(self) -> None:
        appkit = subprocess.CompletedProcess(
            args=(),
            returncode=0,
            stdout='{"requestAccepted": true}',
            stderr="",
        )
        system_events = subprocess.CompletedProcess(
            args=(),
            returncode=0,
            stdout="true\n",
            stderr="",
        )
        with patch(
            "tooling.acceptance.drivers.native.macos.subprocess.run",
            side_effect=(appkit, system_events),
        ) as run:
            self.adapter.activate_process(42)

        self.assertEqual(run.call_count, 2)
        self.assertEqual(run.call_args_list[0].args[0][0], sys.executable)
        self.assertEqual(run.call_args_list[1].args[0][0], "osascript")

    def test_activation_failure_is_not_silently_ignored(self) -> None:
        failed = subprocess.CompletedProcess(
            args=(),
            returncode=1,
            stdout="",
            stderr="activation denied",
        )
        with patch(
            "tooling.acceptance.drivers.native.macos.subprocess.run",
            return_value=failed,
        ):
            with self.assertRaisesRegex(DriverError, "activation denied"):
                self.adapter.activate_process(42)

    def test_clipboard_round_trip_uses_native_commands(self) -> None:
        read = subprocess.CompletedProcess(
            args=(),
            returncode=0,
            stdout=b"before",
            stderr=b"",
        )
        write = subprocess.CompletedProcess(
            args=(),
            returncode=0,
            stdout=b"",
            stderr=b"",
        )
        with patch(
            "tooling.acceptance.drivers.native.macos.subprocess.run",
            side_effect=(read, write),
        ) as run:
            self.assertEqual(self.adapter.read_clipboard(), b"before")
            self.adapter.write_clipboard(b"after")

        self.assertEqual(run.call_args_list[0].args[0], ("/usr/bin/pbpaste",))
        self.assertEqual(run.call_args_list[1].args[0], ("/usr/bin/pbcopy",))

    def test_screenshot_requires_a_created_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "desktop.png"

            def capture(*args: object, **kwargs: object):
                path.write_bytes(b"png")
                return subprocess.CompletedProcess(
                    args=args,
                    returncode=0,
                    stdout="",
                    stderr="",
                )

            with patch(
                "tooling.acceptance.drivers.native.macos.subprocess.run",
                side_effect=capture,
            ):
                self.adapter.capture_screenshot(path)

            self.assertEqual(path.read_bytes(), b"png")


if __name__ == "__main__":
    unittest.main()
