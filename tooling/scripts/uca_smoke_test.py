from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import tooling.scripts.uca_smoke as smoke


class UcaSmokeTests(unittest.TestCase):
    def test_source_identity_is_canonical_and_target_bound(self) -> None:
        clean = subprocess.CompletedProcess(
            args=["git"],
            returncode=0,
            stdout="",
            stderr="",
        )
        with (
            patch.object(smoke, "git_output", return_value="a" * 40),
            patch.object(smoke, "run", return_value=clean),
        ):
            raw = smoke.source_identity("android")

        self.assertEqual(raw, json.dumps(json.loads(raw), sort_keys=True, separators=(",", ":")))
        identity = json.loads(raw)
        self.assertEqual(identity["platform"], "android")
        self.assertEqual(identity["sourceCommit"], "a" * 40)
        self.assertEqual(identity["workspaceDigest"], "clean")

    def test_source_identity_rejects_tracked_dirty_source(self) -> None:
        dirty = subprocess.CompletedProcess(
            args=["git"],
            returncode=0,
            stdout=" M plan.md\n",
            stderr="",
        )
        with (
            patch.object(smoke, "git_output", return_value="a" * 40),
            patch.object(smoke, "run", return_value=dirty),
        ):
            with self.assertRaisesRegex(smoke.SmokeError, "tracked-clean"):
                smoke.source_identity("ios")

    def test_android_emulator_inventory_excludes_offline_and_physical(self) -> None:
        inventory = subprocess.CompletedProcess(
            args=["adb"],
            returncode=0,
            stdout=(
                "List of devices attached\n"
                "emulator-5554\tdevice product:sdk_gphone64_arm64\n"
                "emulator-5556\toffline\n"
                "physical-1\tdevice product:phone\n"
            ),
            stderr="",
        )
        with patch.object(smoke, "run", return_value=inventory):
            self.assertEqual(
                smoke.android_emulators("adb"),
                ["emulator-5554"],
            )

    def test_android_build_environment_skips_empty_sdk_root(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            empty = root / "empty"
            complete = root / "complete"
            ndk = complete / "ndk" / "27.0.11902837"
            empty.mkdir()
            ndk.mkdir(parents=True)
            toolchain = (
                ndk
                / "toolchains"
                / "llvm"
                / "prebuilt"
                / "darwin-x86_64"
                / "bin"
            )
            toolchain.mkdir(parents=True)
            for tool in ("llvm-ar", "llvm-ranlib"):
                executable = toolchain / tool
                executable.write_text("", encoding="utf-8")
            with patch.object(
                smoke,
                "android_sdk_roots",
                return_value=[empty, complete],
            ):
                environment = smoke.android_build_environment()

        self.assertEqual(environment["ANDROID_HOME"], str(complete))
        self.assertEqual(environment["NDK_HOME"], str(ndk))
        self.assertTrue(
            environment["PATH"].startswith(
                str(Path(tempfile.gettempdir()) / "peers-uca-android-toolchain-27.0.11902837")
            )
        )

    def test_ios_selection_prefers_requested_available_device(self) -> None:
        devices = {
            "runtime": [
                {
                    "name": "iPhone 17",
                    "udid": "ios-17",
                    "state": "Booted",
                    "isAvailable": True,
                },
                {
                    "name": "iPhone 16",
                    "udid": "ios-16",
                    "state": "Shutdown",
                    "isAvailable": True,
                },
            ]
        }
        with (
            patch.object(smoke, "ios_devices", return_value=devices),
            patch.object(smoke, "run") as runner,
        ):
            self.assertEqual(smoke.select_ios_device(), ("ios-17", True))
            runner.assert_not_called()

    def test_android_manifest_normalization_removes_generated_blank_rows(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = (
                root
                / "gen"
                / "android"
                / "app"
                / "src"
                / "main"
                / "AndroidManifest.xml"
            )
            manifest.parent.mkdir(parents=True)
            manifest.write_text(
                '<data android:path="/callback" />\n'
                "                \n"
                "                \n"
                "            </intent-filter>\n",
                encoding="utf-8",
            )
            with patch.object(smoke, "MOBILE_TAURI_ROOT", root):
                smoke.normalize_android_generated_manifest()

            self.assertEqual(
                manifest.read_text(encoding="utf-8"),
                '<data android:path="/callback" />\n'
                "            </intent-filter>\n",
            )


if __name__ == "__main__":
    unittest.main()
