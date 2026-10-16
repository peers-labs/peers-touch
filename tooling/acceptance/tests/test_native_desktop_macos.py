from __future__ import annotations

import hashlib
import inspect
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, call, patch

from tooling.acceptance.core import (
    CellAdapterIdentity,
    CellDisplayIdentity,
    CellPlatformIdentity,
    CellSourceIdentity,
    CellTransportIdentity,
    REPO_ROOT,
    RuntimeCellContract,
    RuntimeCellState,
)
from tooling.acceptance.core.errors import BlockedError, DriverError
from tooling.acceptance.drivers.native.base import (
    MouseAction,
    NativeControlSnapshot,
    NativeInputMode,
    NativeWindowBounds,
    NativeWindowSnapshot,
    NativeWindowStack,
)
from tooling.acceptance.drivers.native.macos import (
    MacOSNativeDesktopAdapter,
    _ACTIVATION_PROBE,
    _pixel_buffer_has_visible_alpha,
)
from tooling.acceptance.provisioners import get_runtime_cell_lifecycle
from tooling.acceptance.provisioners.native_desktop_macos import (
    NativeDesktopMacOSProvisioner,
    _WINDOW_BOUNDS_PROBE,
)


class NativeDesktopMacOSProvisionerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.contract_path = (
            REPO_ROOT
            / "tooling"
            / "acceptance"
            / "runtime-cells"
            / "desktop-macos-native.yaml"
        )

    def test_contract_declares_local_native_macos_cell(self) -> None:
        contract = RuntimeCellContract.from_yaml(self.contract_path)
        self.assertEqual(contract.cell_id, "desktop-macos-native")
        self.assertEqual(contract.platform, "macos")
        self.assertEqual(contract.architecture, "arm64")
        self.assertEqual(contract.transport.kind, "local")
        self.assertEqual(contract.display.session_type, "native-macos")
        self.assertEqual(contract.source.mode, "local-worktree")
        self.assertIn("gui-session-lease", contract.cleanup_resources)

    def test_registry_resolves_macos_lifecycle(self) -> None:
        lifecycle = get_runtime_cell_lifecycle("desktop-macos-native")
        self.assertIsInstance(lifecycle, NativeDesktopMacOSProvisioner)

    def test_source_identity_builds_binary_before_attesting_current_commit(
        self,
    ) -> None:
        commit = "a" * 40
        tree = "b" * 40
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binary = root / "peers-touch-desktop"
            binary.write_bytes(b"exact-source-binary")
            lifecycle = NativeDesktopMacOSProvisioner(
                source_root=root,
                state_root=root / "state",
            )
            clean = subprocess.CompletedProcess(
                args=("git", "status"),
                returncode=0,
                stdout="",
                stderr="",
            )
            built = subprocess.CompletedProcess(
                args=("make", "acceptance-driver-build"),
                returncode=0,
                stdout="built",
                stderr="",
            )
            with (
                patch.object(
                    lifecycle,
                    "_git",
                    side_effect=(commit, tree),
                ),
                patch(
                    "tooling.acceptance.provisioners."
                    "native_desktop_macos.subprocess.run",
                    side_effect=(clean, built, clean),
                ) as run,
                patch(
                    "tooling.acceptance.provisioners."
                    "native_desktop_macos.find_app_binary",
                    return_value=str(binary),
                ),
            ):
                source = lifecycle._source_identity()

        self.assertEqual(source.commit, commit)
        self.assertEqual(
            source.binary_sha256,
            hashlib.sha256(b"exact-source-binary").hexdigest(),
        )
        self.assertEqual(
            run.call_args_list[1].args[0],
            ("make", "acceptance-driver-build"),
        )
        self.assertEqual(run.call_args_list[1].kwargs["cwd"], root.resolve())

    def test_probe_launcher_places_probe_window_on_main_display(
        self,
    ) -> None:
        launcher = Mock(log_path=None)
        session = Mock(process_id=42, log_path=None)
        adapter = Mock(spec=MacOSNativeDesktopAdapter)
        adapter.capture_screenshot.side_effect = (
            lambda path: path.write_bytes(b"screenshot")
        )
        bounds = {
            "left": 0.0,
            "top": 32.0,
            "width": 1280.0,
            "height": 720.0,
        }
        stack = NativeWindowStack(
            windows=(
                NativeWindowSnapshot(
                    index=0,
                    owner_pid=42,
                    owner_name="peers-touch-desktop",
                    window_name="Peers",
                    layer=0,
                    alpha=1.0,
                    bounds=NativeWindowBounds(
                        left=0.0,
                        top=32.0,
                        width=1280.0,
                        height=720.0,
                    ),
                ),
            ),
        )
        point_probe = (
            (640.0, 392.0),
            {"x": 640.0, "y": 392.0},
            stack,
            True,
            ((640.0, 392.0),),
        )
        lifecycle = NativeDesktopMacOSProvisioner()

        with patch.dict(
            "os.environ",
            {
                "PT_ACCEPTANCE_DESKTOP_INPUT_MODE": "exclusive-native-input",
                "PT_ACCEPTANCE_DESKTOP_INPUT_ISOLATION": "isolated-gui-session",
            },
        ), patch(
            "tooling.acceptance.provisioners.native_desktop_macos."
            "resolve_smoke_port",
            return_value=45123,
        ), patch(
            "tooling.acceptance.provisioners.native_desktop_macos."
            "find_app_binary",
            return_value="/tmp/peers-touch-desktop",
        ), patch(
            "tooling.acceptance.provisioners.native_desktop_macos."
            "LocalTauriLauncher",
            return_value=launcher,
        ) as launcher_type, patch(
            "tooling.acceptance.provisioners.native_desktop_macos."
            "TauriSession",
            return_value=session,
        ), patch(
            "tooling.acceptance.provisioners.native_desktop_macos."
            "MacOSNativeDesktopAdapter",
            return_value=adapter,
        ), patch.object(
            NativeDesktopMacOSProvisioner,
            "_await_window_bounds",
            return_value=bounds,
        ), patch.object(
            NativeDesktopMacOSProvisioner,
            "_probe_owned_point",
            side_effect=(point_probe, point_probe),
        ), patch.object(
            NativeDesktopMacOSProvisioner,
            "_await_webview_focus",
            return_value=True,
        ):
            probes, webdriver_port = lifecycle._probe_native_adapter()

        self.assertEqual(webdriver_port, 45123)
        self.assertTrue(probes.input_probe)
        self.assertTrue(probes.focus_probe)
        self.assertTrue(probes.point_ownership_probe)
        self.assertTrue(probes.screenshot_probe)
        launcher_type.assert_called_once_with(
            app_binary="/tmp/peers-touch-desktop",
            port=45123,
            profile="desktop-macos-native-probe",
            environment={
                "PT_ACCEPTANCE_WINDOW_SLOT": "0",
                "PT_ACCEPTANCE_WINDOW_COUNT": "1",
                "PT_ACCEPTANCE_DESKTOP_INPUT_MODE": "exclusive-native-input",
                "PT_ACCEPTANCE_DESKTOP_INPUT_ISOLATION": "isolated-gui-session",
            },
        )
        adapter.position_main_window.assert_called_once_with(
            42,
            (100.0, 100.0),
        )
        session.invoke_app_result.assert_called_once_with(
            "acceptance_request_activation"
        )
        session.stop.assert_called_once_with()

    def test_semantic_probe_uses_webdriver_without_native_input(self) -> None:
        events: list[str] = []
        launcher = Mock(log_path=None)
        session = Mock(process_id=42, log_path=None)
        session.wait_for_acceptance_harness.side_effect = lambda: events.append(
            "harness-ready"
        )
        session.save_screenshot.side_effect = lambda path: (
            events.append("screenshot"),
            path.write_bytes(b"semantic-screenshot"),
        )[-1]
        session.stop.side_effect = lambda: events.append("session-stop")
        hover = object()
        click = object()
        input_element = object()
        key = object()
        session.find_element.side_effect = (
            hover,
            click,
            input_element,
            key,
        )
        session.execute_script.side_effect = (
            None,
            {
                "hovered": True,
                "clicked": True,
                "text": "semantic-probe",
                "keyCount": 1,
            },
            None,
        )
        session.semantic_hover.side_effect = lambda _element: events.append(
            "semantic-action"
        )
        adapter = Mock(spec=MacOSNativeDesktopAdapter)
        lifecycle = NativeDesktopMacOSProvisioner()
        operator_state = {
            "frontmostPid": 41,
            "pointerX": 120.0,
            "pointerY": 240.0,
            "keyboardFocusSha256": "b" * 64,
        }
        operator_states = iter((operator_state, operator_state))

        def snapshot_operator_state(
            _adapter: MacOSNativeDesktopAdapter,
        ) -> dict[str, object]:
            events.append("operator-snapshot")
            return next(operator_states)

        with patch.dict(
            "os.environ",
            {
                "PT_ACCEPTANCE_DESKTOP_INPUT_MODE": (
                    "semantic-nonintrusive"
                ),
            },
            clear=True,
        ), patch(
            "tooling.acceptance.provisioners.native_desktop_macos."
            "resolve_smoke_port",
            return_value=45123,
        ), patch(
            "tooling.acceptance.provisioners.native_desktop_macos."
            "find_app_binary",
            return_value="/tmp/peers-touch-desktop",
        ), patch(
            "tooling.acceptance.provisioners.native_desktop_macos."
            "LocalTauriLauncher",
            return_value=launcher,
        ) as launcher_type, patch(
            "tooling.acceptance.provisioners.native_desktop_macos."
            "TauriSession",
            return_value=session,
        ), patch(
            "tooling.acceptance.provisioners.native_desktop_macos."
            "MacOSNativeDesktopAdapter",
            return_value=adapter,
        ), patch.object(
            lifecycle,
            "_snapshot_operator_state",
            side_effect=snapshot_operator_state,
        ) as snapshot:
            probes, webdriver_port = lifecycle._probe_native_adapter()

        self.assertEqual(webdriver_port, 45123)
        self.assertEqual(probes.input_mode, "semantic-nonintrusive")
        self.assertEqual(
            probes.semantic_backend,
            "tauri-embedded-webdriver",
        )
        self.assertTrue(probes.semantic_action_probe)
        self.assertTrue(probes.semantic_screenshot_probe)
        self.assertTrue(probes.non_interference_probe)
        self.assertFalse(probes.input_probe)
        self.assertFalse(probes.focus_probe)
        self.assertFalse(probes.point_ownership_probe)
        self.assertFalse(probes.screenshot_probe)
        self.assertEqual(snapshot.call_count, 2)
        self.assertEqual(
            events,
            [
                "harness-ready",
                "operator-snapshot",
                "semantic-action",
                "screenshot",
                "operator-snapshot",
                "session-stop",
            ],
        )
        launcher_type.assert_called_once_with(
            app_binary="/tmp/peers-touch-desktop",
            port=45123,
            profile="desktop-macos-native-probe",
            environment={
                "PT_ACCEPTANCE_WINDOW_SLOT": "0",
                "PT_ACCEPTANCE_WINDOW_COUNT": "1",
                "PT_ACCEPTANCE_DESKTOP_INPUT_MODE": (
                    "semantic-nonintrusive"
                ),
                "PT_ACCEPTANCE_DESKTOP_INPUT_ISOLATION": (
                    "shared-user-session"
                ),
            },
        )
        session.semantic_hover.assert_called_once_with(hover)
        session.semantic_click.assert_called_once_with(click)
        session.semantic_replace_text.assert_called_once_with(
            input_element,
            "semantic-probe",
        )
        session.semantic_key_sequence.assert_called_once()
        session.driver.set_window_rect.assert_not_called()
        session.invoke_app_result.assert_not_called()
        adapter.position_main_window.assert_not_called()
        adapter.post_mouse.assert_not_called()
        adapter.capture_screenshot.assert_not_called()
        session.stop.assert_called_once_with()

    def test_keyboard_focus_identity_excludes_mutable_control_state(
        self,
    ) -> None:
        baseline = NativeControlSnapshot(
            kind="text-input",
            title="Composer",
            value="before",
            window_count=1,
            dialog_count=0,
            frontmost=True,
            main_window=True,
            focused_window=True,
            actual_frontmost_pid=41,
            platform_role="AXTextArea",
            platform_subrole="",
        )
        mutable_state_changed = NativeControlSnapshot(
            kind="text-input",
            title="Composer",
            value="after",
            window_count=2,
            dialog_count=1,
            frontmost=True,
            main_window=True,
            focused_window=True,
            actual_frontmost_pid=41,
            platform_role="AXTextArea",
            platform_subrole="",
        )
        focus_changed = NativeControlSnapshot(
            kind="button",
            title="Send",
            frontmost=True,
            main_window=True,
            focused_window=True,
            actual_frontmost_pid=41,
            platform_role="AXButton",
            platform_subrole="",
        )

        self.assertEqual(
            NativeDesktopMacOSProvisioner._keyboard_focus_identity(
                baseline
            ),
            NativeDesktopMacOSProvisioner._keyboard_focus_identity(
                mutable_state_changed
            ),
        )
        self.assertNotEqual(
            NativeDesktopMacOSProvisioner._keyboard_focus_identity(
                baseline
            ),
            NativeDesktopMacOSProvisioner._keyboard_focus_identity(
                focus_changed
            ),
        )

    def test_operator_focus_waits_for_two_stable_ax_samples(self) -> None:
        adapter = Mock(spec=MacOSNativeDesktopAdapter)
        transient = NativeControlSnapshot(
            actual_frontmost_pid=41,
        )
        stable = NativeControlSnapshot(
            kind="web-area",
            frontmost=True,
            main_window=True,
            actual_frontmost_pid=41,
            platform_role="AXWebArea",
        )
        adapter.focused_control.side_effect = (
            transient,
            stable,
            stable,
        )

        identity = (
            NativeDesktopMacOSProvisioner._stable_operator_focus_identity(
                adapter,
                41,
                timeout_seconds=1,
                interval_seconds=0,
            )
        )

        self.assertEqual(identity["platformRole"], "AXWebArea")
        self.assertEqual(adapter.focused_control.call_count, 3)

    def test_operator_focus_accepts_stable_absence_of_focused_control(
        self,
    ) -> None:
        adapter = Mock(spec=MacOSNativeDesktopAdapter)
        adapter.focused_control.return_value = NativeControlSnapshot(
            actual_frontmost_pid=41,
        )

        identity = (
            NativeDesktopMacOSProvisioner._stable_operator_focus_identity(
                adapter,
                41,
                timeout_seconds=1,
                interval_seconds=0,
            )
        )

        self.assertEqual(identity["actualFrontmostPid"], 41)
        self.assertEqual(identity["platformRole"], "")
        self.assertEqual(adapter.focused_control.call_count, 2)

    def test_operator_focus_rejects_unstable_ax_samples(self) -> None:
        adapter = Mock(spec=MacOSNativeDesktopAdapter)
        adapter.focused_control.return_value = NativeControlSnapshot(
            actual_frontmost_pid=41,
            error="AX probe unavailable",
        )

        with self.assertRaisesRegex(
            BlockedError,
            "keyboard focus did not stabilize",
        ):
            NativeDesktopMacOSProvisioner._stable_operator_focus_identity(
                adapter,
                41,
                timeout_seconds=0,
                interval_seconds=0,
            )

    def test_window_bounds_wait_uses_native_startup_budget(self) -> None:
        default = inspect.signature(
            NativeDesktopMacOSProvisioner._await_window_bounds
        ).parameters["timeout_seconds"].default

        self.assertEqual(default, 30.0)

    def test_webview_focus_clicks_process_owned_point(self) -> None:
        session = Mock()
        session.driver.execute_script.side_effect = [False, True]
        adapter = Mock(spec=MacOSNativeDesktopAdapter)

        focused = NativeDesktopMacOSProvisioner._await_webview_focus(
            session,
            adapter,
            activation_point=(640.0, 400.0),
            timeout_seconds=1,
            interval_seconds=0,
        )

        self.assertTrue(focused)
        self.assertEqual(adapter.post_mouse.call_count, 2)
        adapter.post_mouse.assert_called_with(
            (MouseAction.LEFT_DOWN, MouseAction.LEFT_UP),
            (640.0, 400.0),
        )

    def test_window_bounds_wait_retries_transient_visibility(self) -> None:
        transient = BlockedError(
            reason=(
                "macOS runtime-cell window bounds probe failed: "
                "no visible process-owned window"
            ),
            resource="runtime-cell-window-bounds",
        )
        bounds = {
            "left": 0.0,
            "top": 0.0,
            "width": 1280.0,
            "height": 720.0,
        }

        with patch.object(
            NativeDesktopMacOSProvisioner,
            "_json_probe",
            side_effect=(transient, bounds),
        ) as probe:
            result = NativeDesktopMacOSProvisioner._await_window_bounds(
                42,
                timeout_seconds=1,
                interval_seconds=0,
            )

        self.assertEqual(result, bounds)
        self.assertEqual(probe.call_count, 2)

    def test_window_bounds_probe_accepts_acceptance_window_level(
        self,
    ) -> None:
        self.assertIn("kCGWindowListOptionOnScreenOnly", _WINDOW_BOUNDS_PROBE)
        self.assertIn("kCGWindowOwnerPID", _WINDOW_BOUNDS_PROBE)
        self.assertIn("kCGWindowAlpha", _WINDOW_BOUNDS_PROBE)
        self.assertNotIn("kCGWindowLayer", _WINDOW_BOUNDS_PROBE)

    def test_window_bounds_wait_fails_closed_after_timeout(self) -> None:
        transient = BlockedError(
            reason=(
                "macOS runtime-cell window bounds probe failed: "
                "no visible process-owned window"
            ),
            resource="runtime-cell-window-bounds",
        )

        with patch.object(
            NativeDesktopMacOSProvisioner,
            "_json_probe",
            side_effect=transient,
        ) as probe, self.assertRaisesRegex(
            BlockedError,
            "did not become visible within 0.0s",
        ):
            NativeDesktopMacOSProvisioner._await_window_bounds(
                42,
                timeout_seconds=0,
                interval_seconds=0,
            )

        probe.assert_called_once()

    def test_window_bounds_wait_does_not_retry_other_probe_errors(
        self,
    ) -> None:
        failure = BlockedError(
            reason="macOS runtime-cell window bounds probe failed: Quartz error",
            resource="runtime-cell-window-bounds",
        )

        with patch.object(
            NativeDesktopMacOSProvisioner,
            "_json_probe",
            side_effect=failure,
        ) as probe, self.assertRaisesRegex(BlockedError, "Quartz error"):
            NativeDesktopMacOSProvisioner._await_window_bounds(
                42,
                timeout_seconds=1,
                interval_seconds=0,
            )

        probe.assert_called_once()

    def test_window_sample_ignores_transparent_little_endian_surface(
        self,
    ) -> None:
        self.assertFalse(
            _pixel_buffer_has_visible_alpha(
                bytes(
                    (
                        0,
                        0,
                        0,
                        0,
                        10,
                        20,
                        30,
                        0,
                        0,
                        0,
                        0,
                        0,
                        1,
                        2,
                        3,
                        0,
                    )
                ),
                width=2,
                height=2,
                bits_per_pixel=32,
                bytes_per_row=8,
                alpha_info=2,
                bitmap_info=0x2000,
            )
        )

    def test_window_sample_accepts_visible_little_endian_surface(
        self,
    ) -> None:
        self.assertTrue(
            _pixel_buffer_has_visible_alpha(
                bytes((10, 20, 30, 255)),
                width=1,
                height=1,
                bits_per_pixel=32,
                bytes_per_row=4,
                alpha_info=2,
                bitmap_info=0x2000,
            )
        )
        self.assertTrue(
            _pixel_buffer_has_visible_alpha(
                bytes((255, 10, 20, 30)),
                width=1,
                height=1,
                bits_per_pixel=32,
                bytes_per_row=4,
                alpha_info=1,
                bitmap_info=0x2000,
            )
        )

    def test_window_sample_without_alpha_is_conservatively_visible(
        self,
    ) -> None:
        self.assertTrue(
            _pixel_buffer_has_visible_alpha(
                bytes((10, 20, 30, 40)),
                width=1,
                height=1,
                bits_per_pixel=32,
                bytes_per_row=4,
                alpha_info=0,
                bitmap_info=0,
            )
        )

    def test_media_permission_targets_positive_webkit_action_by_process(
        self,
    ) -> None:
        adapter = MacOSNativeDesktopAdapter(
            NativeInputMode.EXCLUSIVE_NATIVE_INPUT
        )
        completed = Mock(returncode=0, stdout="pressed\n", stderr="")

        with patch(
            "tooling.acceptance.drivers.native.macos.subprocess.run",
            return_value=completed,
        ) as run:
            self.assertTrue(
                adapter.accept_media_capture_permission_to_process(42)
            )

        command = run.call_args.args[0]
        self.assertEqual(command[:2], ("osascript", "-e"))
        self.assertIn("unix id is 42", command[2])
        self.assertIn('"action-button-1"', command[2])
        self.assertNotIn('button "Allow"', command[2])

    def test_default_adapter_blocks_global_input_before_activation(self) -> None:
        adapter = MacOSNativeDesktopAdapter()

        with self.assertRaisesRegex(
            BlockedError,
            "NATIVE_INPUT_ISOLATION_REQUIRED",
        ):
            adapter.activate_process(42)
        with self.assertRaisesRegex(
            BlockedError,
            "NATIVE_INPUT_ISOLATION_REQUIRED",
        ):
            adapter.post_mouse((MouseAction.MOVE,), (100.0, 200.0))

    def test_exclusive_adapter_keeps_native_input_available(self) -> None:
        adapter = MacOSNativeDesktopAdapter(
            NativeInputMode.EXCLUSIVE_NATIVE_INPUT
        )
        completed = Mock(returncode=0, stdout="true\n", stderr="")

        with patch(
            "tooling.acceptance.drivers.native.macos.subprocess.run",
            return_value=completed,
        ) as run:
            adapter.activate_process(42)

        self.assertEqual(run.call_count, 2)

    def test_focus_wait_retries_until_exact_process_owns_focus(self) -> None:
        wrong = NativeControlSnapshot(
            window_count=1,
            frontmost=False,
            actual_frontmost_pid=41,
        )
        accepted = NativeControlSnapshot(
            window_count=1,
            frontmost=True,
            actual_frontmost_pid=42,
        )
        adapter = Mock(spec=MacOSNativeDesktopAdapter)
        adapter.focused_control.side_effect = [wrong, accepted]
        control = NativeDesktopMacOSProvisioner._await_focused_process(
            adapter,
            42,
            timeout_seconds=1,
            interval_seconds=0,
        )
        self.assertEqual(control.actual_frontmost_pid, 42)
        self.assertEqual(adapter.activate_process.call_count, 1)

    def test_focus_wait_preserves_already_focused_process(self) -> None:
        accepted = NativeControlSnapshot(
            window_count=1,
            frontmost=True,
            actual_frontmost_pid=42,
        )
        adapter = Mock(spec=MacOSNativeDesktopAdapter)
        adapter.focused_control.return_value = accepted

        control = NativeDesktopMacOSProvisioner._await_focused_process(
            adapter,
            42,
            timeout_seconds=1,
            interval_seconds=0,
        )

        self.assertEqual(control.actual_frontmost_pid, 42)
        adapter.activate_process.assert_not_called()

    def test_focus_wait_accepts_nsworkspace_pid_without_ax_window(self) -> None:
        accepted = NativeControlSnapshot(
            window_count=0,
            frontmost=False,
            actual_frontmost_pid=42,
        )
        adapter = Mock(spec=MacOSNativeDesktopAdapter)
        adapter.focused_control.return_value = accepted

        control = NativeDesktopMacOSProvisioner._await_focused_process(
            adapter,
            42,
            timeout_seconds=1,
            interval_seconds=0,
        )

        self.assertEqual(control.actual_frontmost_pid, 42)
        adapter.activate_process.assert_not_called()

    def test_focus_wait_clicks_an_owned_window_before_activation(self) -> None:
        wrong = NativeControlSnapshot(
            window_count=1,
            frontmost=False,
            actual_frontmost_pid=41,
        )
        accepted = NativeControlSnapshot(
            window_count=1,
            frontmost=True,
            actual_frontmost_pid=42,
        )
        adapter = Mock(spec=MacOSNativeDesktopAdapter)
        adapter.focused_control.side_effect = [wrong, accepted]

        control = NativeDesktopMacOSProvisioner._await_focused_process(
            adapter,
            42,
            timeout_seconds=1,
            interval_seconds=0,
            activation_point=(640.0, 400.0),
        )

        self.assertEqual(control.actual_frontmost_pid, 42)
        adapter.post_mouse.assert_called_once_with(
            (MouseAction.LEFT_DOWN, MouseAction.LEFT_UP),
            (640.0, 400.0),
        )
        adapter.activate_process.assert_not_called()

    def test_focus_wait_retries_transient_activation_rejection(self) -> None:
        wrong = NativeControlSnapshot(
            window_count=1,
            frontmost=False,
            actual_frontmost_pid=41,
        )
        accepted = NativeControlSnapshot(
            window_count=1,
            frontmost=True,
            actual_frontmost_pid=42,
        )
        adapter = Mock(spec=MacOSNativeDesktopAdapter)
        adapter.activate_process.side_effect = [
            DriverError("Native actor process 42 did not become frontmost"),
            None,
        ]
        adapter.focused_control.side_effect = [wrong, accepted]

        control = NativeDesktopMacOSProvisioner._await_focused_process(
            adapter,
            42,
            timeout_seconds=1,
            interval_seconds=0,
        )

        self.assertEqual(control.actual_frontmost_pid, 42)
        self.assertEqual(adapter.activate_process.call_count, 2)

    def test_appkit_rejection_does_not_skip_accessibility_activation(self) -> None:
        self.assertNotIn("if not request_accepted:", _ACTIVATION_PROBE)

    def test_focus_wait_fails_closed_without_exact_process_focus(
        self,
    ) -> None:
        adapter = Mock(spec=MacOSNativeDesktopAdapter)
        adapter.focused_control.return_value = NativeControlSnapshot(
            window_count=1,
            frontmost=False,
            actual_frontmost_pid=41,
        )
        with self.assertRaisesRegex(
            BlockedError,
            "did not reach exact-PID focus",
        ):
            NativeDesktopMacOSProvisioner._await_focused_process(
                adapter,
                42,
                timeout_seconds=0,
                interval_seconds=0,
            )

    def test_point_probe_uses_unoccluded_process_owned_interior_point(
        self,
    ) -> None:
        process_id = 42
        notification = NativeWindowSnapshot(
            index=0,
            owner_pid=100,
            owner_name="UserNotificationCenter",
            window_name="",
            layer=8,
            alpha=1,
            bounds=NativeWindowBounds(
                left=400,
                top=200,
                width=200,
                height=300,
            ),
        )
        target = NativeWindowSnapshot(
            index=1,
            owner_pid=process_id,
            owner_name="peers-touch-desktop",
            window_name="Peers",
            layer=0,
            alpha=1,
            bounds=NativeWindowBounds(
                left=0,
                top=0,
                width=1000,
                height=800,
            ),
        )
        adapter = Mock(spec=MacOSNativeDesktopAdapter)
        adapter.window_stack_at_point.side_effect = (
            NativeWindowStack(windows=(notification, target)),
            NativeWindowStack(windows=(target,)),
        )
        with patch.object(
            NativeDesktopMacOSProvisioner,
            "_json_probe",
            side_effect=(
                {"x": 500, "y": 400},
                {"x": 250, "y": 600},
            ),
        ):
            point, pointer, stack, input_probe, attempted_points = (
                NativeDesktopMacOSProvisioner._probe_owned_point(
                    adapter,
                    process_id,
                    {
                        "left": 0,
                        "top": 0,
                        "width": 1000,
                        "height": 800,
                    },
                )
            )

        self.assertEqual(point, (250, 600))
        self.assertEqual(pointer, {"x": 250, "y": 600})
        self.assertTrue(input_probe)
        self.assertTrue(stack.point_owned_by(process_id))
        self.assertEqual(
            adapter.post_mouse.call_args_list,
            [
                call((MouseAction.MOVE,), (500, 400)),
                call((MouseAction.MOVE,), (250, 600)),
            ],
        )
        self.assertEqual(attempted_points[0], (500, 400))

    def test_ready_persists_valid_lease_and_stop_cleans_it(self) -> None:
        digest = "a" * 64
        source = CellSourceIdentity(
            mode="local-worktree",
            commit="source-commit",
            workspace_digest="clean",
            remote_source_digest=digest,
            remote_checkout_clean=True,
            binary_sha256=digest,
        )
        platform_identity = CellPlatformIdentity(
            os="macos",
            host_distribution="macOS test",
            host_kernel="test-kernel",
            isolation_kind="host",
            image_digest="",
            distribution="macOS test",
            architecture="arm64",
            webview_backend="WKWebView",
            webview_version="test",
        )
        transport = CellTransportIdentity(
            kind="local",
            host_identity_sha256=digest,
            host_key_sha256=digest,
            webdriver_local_port=0,
            webdriver_remote_port=0,
        )
        display = CellDisplayIdentity(
            session_type="native-macos",
            display_id="main",
            seat="console",
            width=1920,
            height=1080,
            connected_output=True,
            desktop_user_identity_sha256=digest,
        )
        adapter = CellAdapterIdentity(
            input_backend="coregraphics-events",
            window_backend="appkit-accessibility",
            screenshot_backend="coregraphics-screencapture",
            input_probe=True,
            focus_probe=True,
            point_ownership_probe=True,
            screenshot_probe=True,
        )
        with tempfile.TemporaryDirectory() as directory:
            lifecycle = NativeDesktopMacOSProvisioner(
                state_root=Path(directory),
            )
            with patch(
                "tooling.acceptance.provisioners.native_desktop_macos."
                "sys.platform",
                "darwin",
            ), patch.object(
                lifecycle,
                "_source_identity",
                return_value=source,
            ), patch.object(
                lifecycle,
                "_host_identity",
                return_value=(platform_identity, transport, display),
            ), patch.object(
                lifecycle,
                "_probe_native_adapter",
                return_value=(adapter, 45123),
            ):
                manifest = lifecycle.ready("synthetic-gate")

            self.assertEqual(manifest.state, RuntimeCellState.LEASED)
            self.assertEqual(
                manifest.transport.webdriver_local_port,
                45123,
            )
            self.assertEqual(
                lifecycle.status()["state"],
                RuntimeCellState.LEASED.value,
            )
            with self.assertRaises(BlockedError):
                lifecycle.ready("second-gate")
            cleanup = lifecycle.stop()
            self.assertTrue(cleanup["clean"])
            self.assertEqual(
                lifecycle.status()["state"],
                RuntimeCellState.CLEANED.value,
            )

    def test_failed_probe_removes_preparing_lease(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            lifecycle = NativeDesktopMacOSProvisioner(
                state_root=Path(directory),
            )
            with patch(
                "tooling.acceptance.provisioners.native_desktop_macos."
                "sys.platform",
                "darwin",
            ), patch.object(
                lifecycle,
                "_source_identity",
                side_effect=RuntimeError("probe failed"),
            ):
                with self.assertRaisesRegex(RuntimeError, "probe failed"):
                    lifecycle.ready("synthetic-gate")
            self.assertFalse(lifecycle.state_path.exists())


if __name__ == "__main__":
    unittest.main()
