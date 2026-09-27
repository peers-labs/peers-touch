from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


BUILD_SCRIPT = (
    Path(__file__).resolve().parents[1]
    / "src-tauri/gen/apple/scripts/build-rust-code.sh"
)


class IOSSimulatorArchiveBuildTest(unittest.TestCase):
    def run_build(
        self,
        *,
        configuration: str = "debug",
        static: bool = False,
        dev: bool = False,
        fail: bool = False,
        arch: str = "arm64",
    ) -> tuple[subprocess.CompletedProcess[str], list[str], str]:
        with tempfile.TemporaryDirectory(prefix="mobile-ios-archive-") as directory:
            root = Path(directory)
            tauri = root / "src-tauri"
            apple = tauri / "gen/apple"
            scripts = apple / "scripts"
            scripts.mkdir(parents=True)
            script = scripts / BUILD_SCRIPT.name
            shutil.copy2(BUILD_SCRIPT, script)
            toolchain = root / "tools"
            toolchain.mkdir()
            target = (
                "aarch64-apple-ios-sim" if arch == "arm64" else "x86_64-apple-ios"
            )
            external_arch = "arm64-sim" if arch == "arm64" else "x86_64"
            cargo_target = root / "cargo target"
            archive = cargo_target / target / configuration / "libpeers_touch_mobile_lib.a"
            archive.parent.mkdir(parents=True)
            archive.write_text("stale archive", encoding="utf-8")
            external = apple / "Externals" / external_arch / configuration / "libapp.a"
            external.parent.mkdir(parents=True)
            external.write_text("prior packaged archive", encoding="utf-8")
            calls = root / "cargo-args"
            for name, body in {
                "pnpm": "#!/bin/sh\nexit 0\n",
                "cargo": (
                    '#!/bin/sh\nprintf "%s\\n" "$@" > "$BUILD_CALLS"\n'
                    '[ "$BUILD_FAIL" = "0" ] || exit 9\n'
                    'printf "current archive" > "$EXPECTED_ARCHIVE"\n'
                ),
            }.items():
                executable = toolchain / name
                executable.write_text(body, encoding="utf-8")
                executable.chmod(0o755)
            environment = {
                **os.environ,
                "PATH": f"{toolchain}{os.pathsep}{os.environ['PATH']}",
                "SDKROOT": "/sdk/iPhoneSimulator.sdk",
                "PLATFORM_DISPLAY_NAME": "iOS Simulator",
                "FRAMEWORK_SEARCH_PATHS": ".",
                "HEADER_SEARCH_PATHS": ".",
                "CONFIGURATION": configuration,
                "ARCHS": arch,
                "CARGO_TARGET_DIR": str(cargo_target),
                "MOBILE_TAURI_STATIC_BUNDLE_BUILD": "1" if static else "0",
                "MOBILE_TAURI_DEV_CONFIG": "",
                "MOBILE_BUILD_DEBUG_URL": "",
                "BUILD_CALLS": str(calls),
                "BUILD_FAIL": "1" if fail else "0",
                "EXPECTED_ARCHIVE": str(archive),
            }
            if dev:
                config = root / "dev.json"
                config.write_text(
                    json.dumps({"build": {"devUrl": "http://127.0.0.1:5173"}}),
                    encoding="utf-8",
                )
                environment["MOBILE_TAURI_DEV_CONFIG"] = str(config)
            result = subprocess.run(
                ["bash", str(script)],
                cwd=apple,
                env=environment,
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
            return (
                result,
                calls.read_text(encoding="utf-8").splitlines() if calls.exists() else [],
                external.read_text(encoding="utf-8"),
            )

    def test_packaged_simulator_rebuilds_existing_archive(self) -> None:
        for configuration in ("debug", "release"):
            for arch, target in (
                ("arm64", "aarch64-apple-ios-sim"),
                ("x86_64", "x86_64-apple-ios"),
            ):
                with self.subTest(configuration=configuration, arch=arch):
                    result, args, archive = self.run_build(
                        configuration=configuration, arch=arch
                    )
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertIn("--target", args)
                    self.assertEqual(args[args.index("--target") + 1], target)
                    self.assertIn("custom-protocol", args[args.index("--features") + 1])
                    self.assertNotIn(
                        "acceptance-harness",
                        args[args.index("--features") + 1],
                    )
                    self.assertEqual("--release" in args, configuration == "release")
                    self.assertEqual(archive, "current archive")

    def test_dev_simulator_rebuilds_without_packaged_assets(self) -> None:
        result, args, archive = self.run_build(dev=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("--features", args)
        self.assertNotIn("custom-protocol", args[args.index("--features") + 1])
        self.assertEqual(archive, "current archive")

    def test_static_simulator_build_preserves_embedded_assets(self) -> None:
        result, args, archive = self.run_build(static=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("custom-protocol", args[args.index("--features") + 1])
        self.assertIn("acceptance-harness", args[args.index("--features") + 1])
        self.assertEqual(archive, "current archive")

    def test_compile_failure_never_copies_stale_archive(self) -> None:
        result, args, archive = self.run_build(fail=True)
        self.assertEqual(result.returncode, 9)
        self.assertIn("--target", args)
        self.assertEqual(archive, "prior packaged archive")


if __name__ == "__main__":
    unittest.main()
