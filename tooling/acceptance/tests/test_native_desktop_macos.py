from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

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
from tooling.acceptance.core.errors import BlockedError
from tooling.acceptance.drivers.native.base import NativeControlSnapshot
from tooling.acceptance.drivers.native.macos import (
    MacOSNativeDesktopAdapter,
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
        self.assertEqual(adapter.activate_process.call_count, 2)

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
