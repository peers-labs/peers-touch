from __future__ import annotations

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

    def test_probe_launcher_places_window_on_primary_display(self) -> None:
        launcher = Mock(log_path=None)
        session = Mock()
        session.start.side_effect = RuntimeError("stop after launch")
        lifecycle = NativeDesktopMacOSProvisioner()

        with patch(
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
        ):
            with self.assertRaisesRegex(RuntimeError, "stop after launch"):
                lifecycle._probe_native_adapter()

        launcher_type.assert_called_once_with(
            app_binary="/tmp/peers-touch-desktop",
            port=45123,
            profile="desktop-macos-native-probe",
            environment={
                "PT_ACCEPTANCE_WINDOW_SLOT": "0",
                "PT_ACCEPTANCE_WINDOW_COUNT": "1",
            },
        )
        session.stop.assert_called_once_with()

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
        adapter = MacOSNativeDesktopAdapter()
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
