from __future__ import annotations

import json
import unittest
from pathlib import Path


MOBILE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = MOBILE_ROOT.parents[1]


class NativePlatformContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.mobile_manifest = json.loads(
            (MOBILE_ROOT / "package.json").read_text(encoding="utf-8")
        )
        self.root_manifest = json.loads(
            (REPO_ROOT / "package.json").read_text(encoding="utf-8")
        )

    def test_android_and_ios_have_symmetric_build_entrypoints(self) -> None:
        scripts = self.mobile_manifest["scripts"]
        for platform in ("android", "ios"):
            with self.subTest(platform=platform):
                self.assertIn(f"tauri:{platform}:init", scripts)
                self.assertIn(f"tauri:{platform}:dev", scripts)
                self.assertIn(f"tauri:{platform}:build", scripts)
                self.assertIn(f"check:{platform}-project", scripts)

        self.assertEqual(
            scripts["check:required-mobile-projects"],
            "pnpm run check:android-project && pnpm run check:ios-project",
        )
        self.assertIn(
            "check:required-mobile-projects",
            scripts["check"],
        )

    def test_root_entrypoints_expose_both_release_targets(self) -> None:
        scripts = self.root_manifest["scripts"]
        for platform in ("android", "ios"):
            for operation in ("init", "dev", "build", "check"):
                with self.subTest(platform=platform, operation=operation):
                    self.assertIn(f"mobile:{operation}:{platform}", scripts)

    def test_android_project_has_required_generated_host_inputs(self) -> None:
        android_root = MOBILE_ROOT / "src-tauri" / "gen" / "android"
        required = (
            "gradlew",
            "settings.gradle",
            "build.gradle.kts",
            "app/build.gradle.kts",
            "app/src/main/AndroidManifest.xml",
        )
        for relative in required:
            with self.subTest(relative=relative):
                self.assertTrue((android_root / relative).is_file())

        settings = (android_root / "settings.gradle").read_text(
            encoding="utf-8"
        )
        self.assertIn("tauri.settings.gradle", settings)
        self.assertIn(
            "tauri:android:build",
            self.mobile_manifest["scripts"],
        )

    def test_production_identity_has_no_ios_first_static_truth(self) -> None:
        production_paths = (
            MOBILE_ROOT / "src" / "services" / "platform" / "mobilePlatform.ts",
            MOBILE_ROOT / "src-tauri" / "src" / "lib.rs",
            MOBILE_ROOT / "src-tauri" / "src" / "platform" / "ios.rs",
            MOBILE_ROOT / "src-tauri" / "src" / "platform" / "mod.rs",
        )
        for path in production_paths:
            source = path.read_text(encoding="utf-8")
            with self.subTest(path=path.relative_to(REPO_ROOT)):
                self.assertNotIn("ios_first", source)
                self.assertNotIn("tauri-ios", source)

    def test_platform_contracts_are_present_on_both_runtime_sides(self) -> None:
        rust_contract = (
            MOBILE_ROOT / "src-tauri" / "src" / "platform" / "ios.rs"
        ).read_text(encoding="utf-8")
        typescript_contract = (
            MOBILE_ROOT
            / "src"
            / "services"
            / "platform"
            / "platformContracts.ts"
        ).read_text(encoding="utf-8")

        for symbol in (
            "ReleaseTargetId",
            "RuntimePortId",
            "CapabilityFact",
            "AdmissionProjection",
            "SystemAction",
        ):
            with self.subTest(symbol=symbol):
                self.assertIn(symbol, rust_contract)
                self.assertIn(symbol, typescript_contract)


if __name__ == "__main__":
    unittest.main()
