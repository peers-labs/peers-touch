from __future__ import annotations

import base64
import inspect
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from tooling.acceptance.gates.agent import depth_linux_native


class InstalledLinuxDepthTests(unittest.TestCase):
    def test_gate_consumes_runtime_cell_installed_appimage(self) -> None:
        source_commit = "a" * 40
        with tempfile.TemporaryDirectory() as temporary:
            manifest_path = Path(temporary) / "runtime-cell.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "cellId": "desktop-linux-native",
                        "gateId": depth_linux_native.GATE_ID,
                        "source": {
                            "commit": source_commit,
                            "artifactKind": "installed-appimage",
                        },
                    }
                ),
                encoding="utf-8",
            )
            provisioner = mock.Mock()
            provisioner.installed_desktop_artifact.return_value = {
                "artifactPath": (
                    "/workspace/run/installed-desktop/home/.local/share/"
                    "peers-touch/apps/peers-dev.AppImage"
                ),
                "artifactSha256": "b" * 64,
                "launchedSha256": "b" * 64,
                "receipt": {
                    "platform": "linux",
                    "sourceCommit": source_commit,
                },
                "installLogBase64": base64.b64encode(b"installed\n").decode(),
                "sourceCommit": source_commit,
            }
            environment = {
                "PT_ACCEPTANCE_RUNTIME_CELL": "desktop-linux-native",
                "PT_ACCEPTANCE_RUNTIME_CELL_MANIFEST": str(manifest_path),
            }
            with mock.patch.dict(
                depth_linux_native.os.environ,
                environment,
                clear=False,
            ), mock.patch.object(
                depth_linux_native.subprocess,
                "check_output",
                return_value=f"{source_commit}\n",
            ), mock.patch.object(
                depth_linux_native,
                "NativeDesktopLinuxProvisioner",
                return_value=provisioner,
            ):
                installed = depth_linux_native.installed_desktop()

        provisioner.validate_binding.assert_called_once_with(
            depth_linux_native.GATE_ID,
            source_commit,
        )
        self.assertEqual(installed["logBytes"], b"installed\n")
        self.assertEqual(installed["receipt"]["sourceCommit"], source_commit)

    def test_catalog_requests_installed_appimage(self) -> None:
        catalog = json.loads(
            (
                depth_linux_native.REPO_ROOT
                / "tooling/acceptance/gates.yaml"
            ).read_text(encoding="utf-8")
        )
        gate = catalog["gates"][depth_linux_native.GATE_ID]
        self.assertEqual(
            gate["requiredRuntimeCells"],
            ["desktop-linux-native"],
        )
        self.assertEqual(
            gate["runtimeCellArtifact"],
            "installed-appimage",
        )

    def test_release_acceptance_appimage_exposes_http_gateway(self) -> None:
        source_root = depth_linux_native.REPO_ROOT / "apps/desktop/src-tauri/src"
        interface = (source_root / "interface/mod.rs").read_text(encoding="utf-8")
        main = (source_root / "main.rs").read_text(encoding="utf-8")
        acceptance_cfg = (
            '#[cfg(any(debug_assertions, feature = "acceptance-webdriver"))]'
        )

        self.assertIn(f"{acceptance_cfg}\npub mod http_gateway;", interface)
        self.assertIn(
            f"{acceptance_cfg}\n"
            "            interface::http_gateway::start(",
            main,
        )

    def test_installed_appimage_build_includes_frontend_harness(self) -> None:
        build_source = inspect.getsource(
            depth_linux_native.NativeDesktopLinuxProvisioner._build_binary
        )

        self.assertIn('"export PT_DESKTOP_E2E=true; "', build_source)
        self.assertIn('"export VITE_ACCEPTANCE_HARNESS=1; "', build_source)


if __name__ == "__main__":
    unittest.main()
