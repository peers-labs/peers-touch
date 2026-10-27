from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from tooling.acceptance.core.errors import DriverError, NativeInputBlocked
from tooling.acceptance.drivers.native.base import (
    NativeControlSnapshot,
    NativeInputMode,
)
from tooling.acceptance.drivers.native.macos import (
    MacOSNativeDesktopAdapter,
    MacOSStatusItemSnapshot,
    _ACCESSIBILITY_PROBE,
    _FILE_CHOOSER_SELECTION_PROBE,
)


_BUSY_ACCESSIBILITY_OWNER = r"""
import sys
import time
from pathlib import Path

import AppKit
import Foundation

root = Path(sys.argv[1])
delay = float(sys.argv[2])

class BusyOwner(Foundation.NSObject):
    def tick_(self, timer):
        (root / "ready").touch()
        if (root / "arm").exists():
            timer.invalidate()
            (root / "busy").touch()
            time.sleep(delay)

app = AppKit.NSApplication.sharedApplication()
app.setActivationPolicy_(AppKit.NSApplicationActivationPolicyAccessory)
window = AppKit.NSWindow.alloc().initWithContentRect_styleMask_backing_defer_(
    ((150, 150), (400, 200)),
    AppKit.NSWindowStyleMaskTitled | AppKit.NSWindowStyleMaskClosable,
    AppKit.NSBackingStoreBuffered, False,
)
window.setTitle_("AX responsiveness fixture")
window.orderBack_(None)
if sys.argv[3] == "panel":
    panel = AppKit.NSOpenPanel.openPanel()
    panel.beginWithCompletionHandler_(lambda response: None)
owner = BusyOwner.alloc().init()
timer = Foundation.NSTimer.scheduledTimerWithTimeInterval_target_selector_userInfo_repeats_(
    0.02, owner, "tick:", None, True,
)
app.run()
"""


@unittest.skipUnless(sys.platform == "darwin", "requires real macOS Accessibility")
class MacOSAccessibilityResponsivenessTests(unittest.TestCase):
    def _probe_busy_owner(
        self, probe: str, busy_seconds: float, *, panel: bool = False,
        arguments: tuple[str, ...] = (),
    ) -> tuple[
        subprocess.CompletedProcess[str], float
    ]:
        with tempfile.TemporaryDirectory(prefix="pt-ax-responsiveness-") as directory:
            root = Path(directory)
            with (root / "owner.log").open("w+") as log:
                child = subprocess.Popen(
                    (sys.executable, "-c", _BUSY_ACCESSIBILITY_OWNER,
                     str(root), str(busy_seconds), "panel" if panel else "window"),
                    stdout=log, stderr=log,
                )
                try:
                    for marker, timeout in (("ready", 5), ("busy", 2)):
                        deadline = time.monotonic() + timeout
                        while not (root / marker).exists():
                            if child.poll() is not None:
                                log.seek(0)
                                self.fail(f"AppKit fixture exited: {log.read()}")
                            if time.monotonic() >= deadline:
                                self.fail(f"AppKit fixture never became {marker}")
                            time.sleep(0.01)
                        if marker == "ready":
                            (root / "arm").touch()
                    began = time.monotonic()
                    result = subprocess.run(
                        (sys.executable, "-c", probe, str(child.pid), *arguments),
                        capture_output=True, text=True, timeout=2,
                    )
                    return result, time.monotonic() - began
                finally:
                    if child.poll() is None:
                        child.terminate()
                    child.wait(timeout=3)

    def test_busy_application_recovers_within_the_existing_rpc_bound(self) -> None:
        result, elapsed = self._probe_busy_owner(_ACCESSIBILITY_PROBE, 1.1)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["windowCount"], 1)
        self.assertLess(elapsed, 2)

    def test_unresponsive_application_preserves_the_terminal_ax_error(self) -> None:
        result, elapsed = self._probe_busy_owner(_ACCESSIBILITY_PROBE, 4)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("AXWindows inspection failed: AX error -25204", result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertLess(elapsed, 2)

    def _observe_panel(self, busy_seconds: float) -> tuple[
        subprocess.CompletedProcess[str], float
    ]:
        probe = _FILE_CHOOSER_SELECTION_PROBE.split("try:\n    home_path =")[0]
        probe += """
panel = open_panel()
sys.stdout.write(json.dumps({"panelFound": bool(panel)}))
if panel:
    core_foundation.CFRelease(panel)
core_foundation.CFRelease(application)
"""
        with tempfile.NamedTemporaryFile(dir=Path.home(), suffix=".txt") as target:
            return self._probe_busy_owner(
                probe, busy_seconds, panel=True, arguments=(target.name,),
            )

    def test_busy_file_panel_is_observed_after_ax_recovery(self) -> None:
        result, elapsed = self._observe_panel(1.1)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)["panelFound"])
        self.assertLess(elapsed, 2)

    def test_unresponsive_file_panel_cannot_be_reported_as_closed(self) -> None:
        result, elapsed = self._observe_panel(4)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("AXWindows inspection failed: AX error -25204", result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertLess(elapsed, 2)

    def _cancel_panel(self, busy_seconds: float, *, panel: bool = True) -> tuple[
        subprocess.CompletedProcess[str], float
    ]:
        probe = """
import json
import sys
from tooling.acceptance.drivers.native.macos_panels import press_panel_button
sys.stdout.write(json.dumps(press_panel_button(
    int(sys.argv[1]), "Cancel", ("Open",), timeout_seconds=1.5,
)))
"""
        return self._probe_busy_owner(probe, busy_seconds, panel=panel)

    def test_busy_panel_button_is_pressed_once_after_read_recovery(self) -> None:
        result, elapsed = self._cancel_panel(1.1)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)["pressed"])
        self.assertLess(elapsed, 2)

    def test_unresponsive_panel_preserves_failure_before_any_press(self) -> None:
        result, elapsed = self._cancel_panel(4)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("AXWindows inspection failed: AX error -25204", result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertLess(elapsed, 2)

    def test_successfully_observed_absent_panel_returns_no_press(self) -> None:
        result, elapsed = self._cancel_panel(0, panel=False)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(json.loads(result.stdout)["pressed"])
        self.assertLess(elapsed, 2)


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
            "_accessibility",
            return_value={"operation": "position"},
        ) as run:
            self.adapter.position_main_window(123, (0.0, 32.0))

        process_id, operation, position = run.call_args.args
        self.assertEqual(process_id, 123)
        self.assertEqual(operation, "position")
        self.assertEqual(json.loads(position), [0.0, 32.0])

    def test_window_state_parses_hidden_and_visible_states(self) -> None:
        with mock.patch.object(
            self.adapter,
            "_accessibility",
            side_effect=(
                {
                    "windowCount": 0, "frontmost": False,
                    "mainWindow": False, "focusedWindow": False,
                },
                {
                    "windowCount": 1, "frontmost": True,
                    "mainWindow": True, "focusedWindow": True,
                },
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
                "_accessibility",
                return_value={"operation": "close"},
            ) as run,
            mock.patch.object(
                self.adapter,
                "_wait_for_window_count",
                return_value={"windowCount": 0},
            ) as wait,
        ):
            result = self.adapter.hide_main_window(123)

        self.assertEqual(result["windowCount"], 0)
        run.assert_called_once_with(123, "close")
        wait.assert_called_once_with(
            123,
            expected_visible=False,
            timeout_seconds=10.0,
        )

    def test_window_inspection_failures_do_not_mean_hidden(self) -> None:
        for result in (
            subprocess.CompletedProcess([], 1, "", "AXWindows error -25202"),
            subprocess.CompletedProcess([], 0, "{}\n", ""),
            subprocess.CompletedProcess([], 0, "invalid JSON\n", ""),
        ):
            with (
                self.subTest(result=result),
                mock.patch(
                    "tooling.acceptance.drivers.native.macos.subprocess.run",
                    return_value=result,
                ) as run,
            ):
                with self.assertRaises(DriverError):
                    self.adapter.window_state(123)
                self.assertEqual(run.call_args.kwargs["timeout"], 2)
                self.assertEqual(run.call_args.args[0][-2:], ("123", "inspect"))

    def test_accessibility_timeout_is_bounded_and_preserves_failure(self) -> None:
        with mock.patch(
            "tooling.acceptance.drivers.native.macos.subprocess.run",
            side_effect=subprocess.TimeoutExpired("AX probe", 2),
        ):
            with self.assertRaisesRegex(DriverError, "timed out"):
                self.adapter.window_state(123)
            self.assertIn("timed out", self.adapter.focused_control(123).error)

    def test_activation_rejects_a_sibling_frontmost_process(self) -> None:
        adapter = MacOSNativeDesktopAdapter(NativeInputMode.EXCLUSIVE_NATIVE_INPUT)
        with (
            mock.patch.object(adapter, "_validated_process_id", return_value=123),
            mock.patch(
                "tooling.acceptance.drivers.native.macos.subprocess.run",
                return_value=subprocess.CompletedProcess([], 0, "{}", ""),
            ),
            mock.patch.object(
                adapter, "_accessibility",
                side_effect=(
                    {"operation": "activate"},
                    {"frontmost": True, "actualFrontmostPid": 456},
                ),
            ),
        ):
            with self.assertRaisesRegex(DriverError, "did not become frontmost"):
                adapter.activate_process(123)

    def test_semantic_input_rejects_activation_before_os_mutation(self) -> None:
        with mock.patch.object(self.adapter, "_accessibility") as run:
            with self.assertRaises(NativeInputBlocked):
                self.adapter.activate_process(123)
            run.assert_not_called()

    def test_nonfinite_position_is_rejected_before_os_mutation(self) -> None:
        with mock.patch.object(self.adapter, "_accessibility") as run:
            with self.assertRaisesRegex(DriverError, "position is invalid"):
                self.adapter.position_main_window(123, (float("nan"), 32.0))
            run.assert_not_called()

    def test_unsupported_ax_list_selection_falls_back_without_faking_success(self) -> None:
        adapter = MacOSNativeDesktopAdapter(NativeInputMode.EXCLUSIVE_NATIVE_INPUT)
        owner = NativeControlSnapshot(frontmost=True, actual_frontmost_pid=123)
        with tempfile.NamedTemporaryFile(dir=Path.home(), suffix=".txt") as target:
            with (
                mock.patch.object(adapter, "_validated_process_id", return_value=123),
                mock.patch.object(adapter, "focused_control", return_value=owner),
                mock.patch(
                    "tooling.acceptance.drivers.native.macos.subprocess.run",
                    return_value=subprocess.CompletedProcess(
                        [],
                        0,
                        json.dumps({
                            "selected": False,
                            "reason": "list-selection-unsupported",
                            "path": target.name,
                        }),
                        "",
                    ),
                ) as run,
            ):
                self.assertIsNone(
                    adapter.select_file_chooser_path_to_process(123, target.name)
                )
            self.assertIn("-c", run.call_args.args[0])

    def test_unknown_chooser_result_is_still_a_failure(self) -> None:
        adapter = MacOSNativeDesktopAdapter(NativeInputMode.EXCLUSIVE_NATIVE_INPUT)
        owner = NativeControlSnapshot(frontmost=True, actual_frontmost_pid=123)
        with tempfile.NamedTemporaryFile(dir=Path.home(), suffix=".txt") as target:
            with (
                mock.patch.object(adapter, "_validated_process_id", return_value=123),
                mock.patch.object(adapter, "focused_control", return_value=owner),
                mock.patch(
                    "tooling.acceptance.drivers.native.macos.subprocess.run",
                    return_value=subprocess.CompletedProcess(
                        [],
                        0,
                        json.dumps({"selected": False, "reason": "unexpected"}),
                        "",
                    ),
                ),
            ):
                with self.assertRaisesRegex(DriverError, "did not select"):
                    adapter.select_file_chooser_path_to_process(123, target.name)

    def test_chooser_probe_reports_unsupported_list_selection_as_a_sentinel(self) -> None:
        self.assertIn("class ListSelectionUnsupported", _FILE_CHOOSER_SELECTION_PROBE)
        self.assertIn("list-selection-unsupported", _FILE_CHOOSER_SELECTION_PROBE)
        compile(
            _FILE_CHOOSER_SELECTION_PROBE,
            "_FILE_CHOOSER_SELECTION_PROBE",
            "exec",
        )


class AXTransientReadRetryTest(unittest.TestCase):
    def _session(self):
        from tooling.acceptance.drivers.native.macos_ax import AXReadSession

        session = object.__new__(AXReadSession)
        session.read_deadline = __import__("time").monotonic() + 1.5

        class AX:
            def AXUIElementSetMessagingTimeout(self, *_):
                return 0

        session.ax = AX()
        session._check = lambda error, operation: None
        return session

    def test_cannot_complete_is_retried_like_notification_timeout(self):
        session = self._session()
        calls = 0

        def operation():
            nonlocal calls
            calls += 1
            return -25200 if calls == 1 else 0

        self.assertEqual(session.read(object(), "AXChildren", operation), 0)
        self.assertEqual(calls, 2)

    def test_persistent_cannot_complete_returns_error_within_budget(self):
        session = self._session()
        self.assertEqual(session.read(object(), "AXChildren", lambda: -25200), -25200)


if __name__ == "__main__":
    unittest.main()
