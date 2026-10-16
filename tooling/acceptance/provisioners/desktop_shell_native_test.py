from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from tooling.acceptance.core import ENVIRONMENTS_DIR, EnvironmentContract
from tooling.acceptance.drivers.native.macos import MacOSStatusItemSnapshot
from tooling.acceptance.provisioners import (
    DesktopShellNativeProvisioner,
    get_provisioner,
)
from tooling.acceptance.provisioners.desktop_shell_native import (
    DesktopShellStatusItemHandler,
)


class DesktopShellNativeProvisionerTests(unittest.TestCase):
    def test_environment_resolves_concrete_provisioner(self) -> None:
        contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "desktop-shell-native.yaml"
        )

        provisioner = get_provisioner(contract)

        self.assertIsInstance(
            provisioner,
            DesktopShellNativeProvisioner,
        )
        self.assertEqual(contract.services, {})
        self.assertEqual(contract.clients[0].required_service_roles, ())

    def test_process_identity_uses_native_pid_path(self) -> None:
        source = Path(__file__).with_name(
            "desktop_shell_native.py"
        ).read_text(encoding="utf-8")

        self.assertIn("proc_pidpath", source)
        self.assertNotIn('"ps", "-p"', source)

    def test_product_package_and_runtime_driver_are_separate_builds(self) -> None:
        source = Path(__file__).with_name(
            "desktop_shell_native.py"
        ).read_text(encoding="utf-8")

        self.assertIn('"--bundles",\n                "app"', source)
        self.assertIn('("make", "acceptance-driver-build")', source)
        self.assertNotIn(
            '"--features",\n                "acceptance-webdriver"',
            source,
        )

    def test_handler_projects_package_status_and_window_identity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            asset = root / "tray.png"
            asset.write_bytes(b"tray-asset")
            binary = root / "peers-touch-desktop"
            binary.write_bytes(b"prefix" + asset.read_bytes() + b"suffix")
            storage = root / "storage"
            storage.mkdir()
            handler = DesktopShellStatusItemHandler(
                artifact_writer=mock.Mock(),
                app_binary=binary,
                tray_asset=asset,
                storage_root=storage,
            )
            process = mock.Mock()
            process.poll.return_value = None
            handler._process = process
            with (
                mock.patch.object(
                    handler._adapter,
                    "status_item_snapshot",
                    return_value=MacOSStatusItemSnapshot(
                        role="AXMenuBarItem",
                        subrole="AXMenuExtra",
                        title="",
                        help="Peers Touch",
                        position=(100.0, 0.0),
                        size=(62.0, 24.0),
                        menu_items=("Show Peers Touch", "Quit"),
                    ),
                ),
                mock.patch.object(
                    handler._adapter,
                    "window_state",
                    return_value={
                        "windowCount": 1,
                        "frontmost": True,
                        "mainWindow": True,
                        "focusedWindow": True,
                    },
                ),
                mock.patch.object(
                    handler,
                    "_process_executable",
                    return_value=binary,
                ),
            ):
                result = handler._inspect(123)

        self.assertTrue(result["processAlive"])
        self.assertTrue(result["package"]["assetEmbedded"])
        self.assertEqual(
            result["processExecutableSha256"],
            result["package"]["binarySha256"],
        )
        self.assertEqual(
            result["statusItem"]["size"],
            {"width": 62.0, "height": 24.0},
        )

    def test_handler_cleanup_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binary = root / "peers-touch-desktop"
            binary.write_bytes(b"binary")
            asset = root / "tray.png"
            asset.write_bytes(b"asset")
            storage = root / "storage"
            storage.mkdir()
            handler = DesktopShellStatusItemHandler(
                artifact_writer=mock.Mock(),
                app_binary=binary,
                tray_asset=asset,
                storage_root=storage,
            )

            first = handler.close()
            second = handler.close()

        self.assertTrue(first.closed)
        self.assertTrue(second.closed)
        self.assertTrue(first.secrets_zeroized)


if __name__ == "__main__":
    unittest.main()
