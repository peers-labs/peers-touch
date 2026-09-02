#!/usr/bin/env python3
"""Mobile simulator Environment and Provisioner contract tests."""

from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from typing import Any

from tooling.acceptance.core import EnvironmentContract, ProvisioningState
from tooling.acceptance.core._paths import ENVIRONMENTS_DIR
from tooling.acceptance.gates.mobile.simulator_e2e import (
    SimulatorAppiumSession,
    SimulatorBuildTarget,
    SimulatorDeviceTarget,
)
from tooling.acceptance.provisioners import (
    MobileSimulatorProvisioner,
    get_provisioner,
)
from tooling.acceptance.provisioners import (
    mobile_simulator as mobile_simulator_module,
)
from tooling.acceptance.provisioners.mobile_simulator import (
    ANDROID_ABI,
    ANDROID_AVD_NAME,
    EXPECTED_CLIENTS,
    EXPECTED_DRIVERS,
    IOS_DEVICE_NAME,
    IOS_RUNTIME,
    CommandResult,
    MobileSimulatorProvisioner,
    _resolve_command,
    load_mobile_simulator_spec,
)


class FakeProcess:
    def __init__(self, name: str, events: list[str]) -> None:
        self.name = name
        self.events = events
        self.returncode: int | None = None

    def poll(self) -> int | None:
        return self.returncode

    def stop(self) -> None:
        self.events.append(f"stop:{self.name}")
        self.returncode = 0


class FakeCommandExecutor:
    def __init__(self, repo_root: Path) -> None:
        self.repo_root = repo_root
        self.events: list[str] = []
        self.commands: list[tuple[str, ...]] = []
        self.environments: list[dict[str, str]] = []
        self.browser_versions = {
            "com.android.chrome": "124.0.6367.82",
            "com.google.android.webview": "124.0.6367.82",
        }
        self.active_webview_package = "com.google.android.webview"
        self.driver_version = "124.0.6367.82"

    def run(
        self,
        command: tuple[str, ...] | list[str],
        *,
        cwd: Path,
        env: dict[str, str],
        timeout: float,
    ) -> CommandResult:
        del cwd, timeout
        command = tuple(command)
        self.commands.append(command)
        self.environments.append(dict(env))
        self.events.append(f"run:{' '.join(command)}")

        if command == ("xcrun", "simctl", "list", "--json"):
            return CommandResult(
                0,
                json.dumps(
                    {
                        "runtimes": [
                            {
                                "identifier": (
                                    "com.apple.CoreSimulator.SimRuntime.iOS-17-4"
                                ),
                                "name": IOS_RUNTIME,
                                "isAvailable": True,
                            }
                        ],
                        "devices": {
                            "com.apple.CoreSimulator.SimRuntime.iOS-17-4": [
                                {
                                    "name": IOS_DEVICE_NAME,
                                    "udid": "ios-simulator-udid",
                                    "state": "Shutdown",
                                    "isAvailable": True,
                                }
                            ]
                        },
                    }
                ),
            )
        if command == ("emulator", "-list-avds"):
            return CommandResult(0, f"{ANDROID_AVD_NAME}\n")
        if command == ("adb", "devices"):
            return CommandResult(
                0,
                "List of devices attached\nphysical-device\tdevice\n",
            )
        if (
            len(command) >= 6
            and command[:4] == ("adb", "-s", command[2], "shell")
            and command[-2:] == ("getprop", "sys.boot_completed")
        ):
            return CommandResult(0, "1\n")
        if (
            len(command) >= 6
            and command[:4] == ("adb", "-s", command[2], "shell")
            and command[-2:] == ("getprop", "ro.product.cpu.abi")
        ):
            return CommandResult(0, f"{ANDROID_ABI}\n")
        if (
            len(command) == 7
            and command[:4] == ("adb", "-s", command[2], "shell")
            and command[4:6] == ("dumpsys", "package")
        ):
            package_name = command[6]
            version = self.browser_versions.get(package_name)
            if not version:
                return CommandResult(1, stderr="Unable to find package")
            return CommandResult(0, f"Packages:\n  versionName={version}\n")
        if (
            len(command) == 6
            and command[:4] == ("adb", "-s", command[2], "shell")
            and command[4:] == ("dumpsys", "webviewupdate")
        ):
            version = self.browser_versions[self.active_webview_package]
            return CommandResult(
                0,
                "WebView Update Service State:\n"
                "  Current WebView package (name, version): "
                f"({self.active_webview_package}, {version})\n",
            )
        if command[:4] == (
            "appium",
            "driver",
            "list",
            "--installed",
        ):
            return CommandResult(
                0,
                json.dumps(
                    {
                        "xcuitest": {"version": "9.10.5"},
                        "uiautomator2": {"version": "4.2.9"},
                    }
                ),
            )
        if command[-1:] == ("--version",) and Path(command[0]).name == (
            "chromedriver"
        ):
            return CommandResult(
                0,
                f"ChromeDriver {self.driver_version}\n",
            )
        if command and command[0] == "xcodebuild":
            derived_data = Path(command[command.index("-derivedDataPath") + 1])
            app = (
                derived_data
                / "Build"
                / "Products"
                / "debug-iphonesimulator"
                / "peers-touch-mobile_iOS.app"
            )
            app.mkdir(parents=True, exist_ok=True)
            (app / "Peers").write_text("ios-app\n", encoding="utf-8")
            return CommandResult(0)
        if (
            command[:4] == ("pnpm", "--dir", "apps/mobile", "exec")
            and "android" in command
        ):
            apk = (
                self.repo_root
                / "apps"
                / "mobile"
                / "src-tauri"
                / "gen"
                / "android"
                / "app"
                / "build"
                / "outputs"
                / "apk"
                / "arm64"
                / "debug"
                / "app-arm64-debug.apk"
            )
            apk.parent.mkdir(parents=True, exist_ok=True)
            apk.write_bytes(b"android-apk")
            return CommandResult(0)
        return CommandResult(0)

    def start(
        self,
        command: tuple[str, ...] | list[str],
        *,
        cwd: Path,
        env: dict[str, str],
        log_path: Path,
    ) -> FakeProcess:
        del cwd, env
        command = tuple(command)
        self.commands.append(command)
        self.events.append(f"start:{' '.join(command)}")
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text("", encoding="utf-8")
        name = "appium" if command[0] == "appium" else "emulator"
        return FakeProcess(name, self.events)


class TestMobileSimulatorProvisioner(MobileSimulatorProvisioner):
    def _git_commit(self) -> str:
        return "source-commit"

    def _git_workspace_digest(self) -> str:
        return "sha256:workspace"

    def acquire_profile_lease(self, resource: str, owner: str) -> None:
        del owner
        self.register_cleanup(
            f"environment-lease:{resource}",
            lambda: self.executor.events.append("release:environment-lease"),
        )

    @staticmethod
    def _host_platform_identity() -> tuple[str, str]:
        return "darwin", "arm64"


class MobileSimulatorContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.path = ENVIRONMENTS_DIR / "mobile-simulator.yaml"
        self.payload = json.loads(self.path.read_text(encoding="utf-8"))
        self.spec = load_mobile_simulator_spec(self.path)

    def test_contract_is_simulator_only_and_declares_runtime_materials(
        self,
    ) -> None:
        contract = EnvironmentContract.from_yaml(self.path)

        self.assertEqual(contract.id, "mobile-simulator")
        self.assertFalse(contract.profile.required)
        self.assertEqual(contract.services, {})
        self.assertEqual(contract.fixtures, ())
        self.assertEqual(contract.credentials, ())
        self.assertEqual(
            {
                client.id: (client.platform, client.role, client.runtime)
                for client in self.spec.clients
            },
            EXPECTED_CLIENTS,
        )
        self.assertEqual(self.spec.ios_runtime, IOS_RUNTIME)
        self.assertEqual(self.spec.ios_device_name, IOS_DEVICE_NAME)
        self.assertEqual(self.spec.android_avd_name, ANDROID_AVD_NAME)
        self.assertEqual(self.spec.android_abi, ANDROID_ABI)
        self.assertTrue(self.spec.chromedriver.acquisition_enabled)
        self.assertEqual(len(self.spec.chromedriver.artifacts), 1)
        self.assertEqual(
            self.spec.chromedriver.artifacts[0].browser_major,
            124,
        )
        self.assertEqual(
            self.spec.build_environment,
            {
                "VITE_ACCEPTANCE_HARNESS": "1",
                "MOBILE_TAURI_STATIC_BUNDLE_BUILD": "1",
            },
        )
        ios_command = self.spec.build_commands["ios"]
        self.assertNotIn("--debug", ios_command)
        self.assertEqual(
            ios_command[ios_command.index("-configuration") + 1],
            "debug",
        )
        android_command = self.spec.build_commands["android"]
        config_index = android_command.index("--config")
        self.assertEqual(
            json.loads(android_command[config_index + 1])["build"]["devUrl"],
            None,
        )
        self.assertIn(
            "physical-device MS-AG03",
            self.spec.proof_scope["doesNotProve"],
        )

    def test_contract_declares_appium_xcuitest_and_uiautomator2(self) -> None:
        self.assertEqual(
            {
                platform: (
                    driver.identity,
                    driver.installed_name,
                    driver.automation_name,
                    driver.expected_version,
                )
                for platform, driver in self.spec.drivers.items()
            },
            {
                "ios": (*EXPECTED_DRIVERS["ios"], "9.10.5"),
                "android": (*EXPECTED_DRIVERS["android"], "4.2.9"),
            },
        )
        self.assertEqual(self.spec.appium_ownership, "provisioner")
        self.assertEqual(self.spec.appium_expected_version, "2.19.0")
        self.assertEqual(
            set(self.spec.harness_actions),
            {
                "lifecycle.restart",
                "native.deliverDeepLink",
                "projection.read",
                "cleanup",
            },
        )

    def test_physical_role_or_runtime_fails_closed(self) -> None:
        payload = json.loads(json.dumps(self.payload))
        payload["clients"][0]["role"] = "physical"
        with tempfile.NamedTemporaryFile(
            mode="w",
            suffix=".yaml",
            delete=False,
        ) as file:
            json.dump(payload, file)
            path = Path(file.name)
        try:
            with self.assertRaisesRegex(
                Exception,
                "simulator-only runtime kinds",
            ):
                load_mobile_simulator_spec(path)
        finally:
            path.unlink()

    def test_provisioner_is_registered(self) -> None:
        contract = EnvironmentContract.from_yaml(self.path)
        self.assertIsInstance(
            get_provisioner(contract),
            MobileSimulatorProvisioner,
        )

    def test_android_tools_resolve_from_sdk_when_not_on_path(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            sdk_root = Path(directory)
            emulator = sdk_root / "emulator" / "emulator"
            adb = sdk_root / "platform-tools" / "adb"
            for executable in (emulator, adb):
                executable.parent.mkdir(parents=True, exist_ok=True)
                executable.write_text("", encoding="utf-8")
                executable.chmod(0o755)

            environment = {
                "ANDROID_HOME": str(sdk_root),
                "PATH": "",
            }
            self.assertEqual(
                _resolve_command(("emulator", "-list-avds"), environment)[0],
                str(emulator),
            )
            self.assertEqual(
                _resolve_command(("adb", "devices"), environment)[0],
                str(adb),
            )

    def test_provisioner_does_not_own_gate_or_session_execution(self) -> None:
        self.assertFalse(
            hasattr(mobile_simulator_module, "run_simulator_gate")
        )
        self.assertFalse(hasattr(mobile_simulator_module, "_manifest_object"))
        self.assertFalse(hasattr(mobile_simulator_module, "AppiumSession"))


class MobileSimulatorProvisionerTests(unittest.TestCase):
    driver_bytes = b"synthetic chromedriver executable\n"
    driver_version = "124.0.6367.82"

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.repo_root = self.root / "repo"
        self.repo_root.mkdir()
        self.executor = FakeCommandExecutor(self.repo_root)
        self.contract = EnvironmentContract.from_yaml(
            ENVIRONMENTS_DIR / "mobile-simulator.yaml"
        )
        self.contract_payload = json.loads(
            (
                ENVIRONMENTS_DIR / "mobile-simulator.yaml"
            ).read_text(encoding="utf-8")
        )
        self.contract_payload["appium"]["chromedriver"]["artifacts"] = [
            {
                "browser_major": 124,
                "driver_version": self.driver_version,
                "source": (
                    "https://storage.googleapis.com/chrome-for-testing-public/"
                    "synthetic/chromedriver"
                ),
                "platform": "darwin",
                "arch": "arm64",
                "android_abis": [ANDROID_ABI],
                "sha256": hashlib.sha256(self.driver_bytes).hexdigest(),
                "cache_target": (
                    f"{self.driver_version}/darwin-arm64/chromedriver"
                ),
                "artifact_kind": "executable",
                "executable_member": "",
                "executable_target": (
                    f"{self.driver_version}/darwin-arm64/chromedriver"
                ),
            }
        ]
        self.contract_path = self.root / "mobile-simulator.json"
        self.cache_root = self.root / "external-runtime-cache"
        self.fetches: list[str] = []
        self._write_contract()
        self._write_cached_driver(self.driver_bytes)
        self.provisioner = self._new_provisioner()

    def _write_contract(self) -> None:
        self.contract_path.write_text(
            json.dumps(self.contract_payload),
            encoding="utf-8",
        )

    def _write_cached_driver(self, content: bytes) -> Path:
        relative = self.contract_payload["appium"]["chromedriver"][
            "artifacts"
        ][0]["cache_target"]
        path = self.cache_root / "chromedriver" / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        path.chmod(0o755)
        return path

    def _new_provisioner(self) -> TestMobileSimulatorProvisioner:
        return TestMobileSimulatorProvisioner(
            self.contract,
            executor=self.executor,
            repo_root=self.repo_root,
            runtime_base=self.root / "runtime",
            runtime_cache_base=self.cache_root,
            contract_path=self.contract_path,
            artifact_fetcher=self._fetch_driver,
            status_reader=lambda url, timeout: {
                "value": {"build": {"version": "2.19.0"}}
            },
            sleep=lambda _: None,
        )

    def _fetch_driver(self, source: str, destination: Path) -> None:
        self.fetches.append(source)
        destination.write_bytes(self.driver_bytes)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_provision_discovers_builds_deploys_and_emits_appium_manifest(
        self,
    ) -> None:
        manifest = self.provisioner.provision(
            "mobile-simulator-access-e2e"
        )

        self.assertEqual(manifest.state, ProvisioningState.FIXTURE_READY)
        payload = manifest.to_dict()
        self.assertEqual(payload["services"], {})
        self.assertEqual(payload["credentialRefs"], [])
        self.assertNotIn("actorManifest", payload)
        self.assertEqual(
            {
                client["runtime"]
                for client in payload["clients"]
            },
            {"tauri-ios-simulator", "tauri-android-emulator"},
        )

        resources = payload["mobileSimulator"]
        self.assertTrue(resources["appium"]["owned"])
        self.assertEqual(
            resources["appium"]["serverVersion"],
            "2.19.0",
        )
        self.assertEqual(
            resources["appium"]["expectedServerVersion"],
            "2.19.0",
        )
        self.assertEqual(
            resources["appium"]["drivers"]["ios"]["expectedVersion"],
            "9.10.5",
        )
        self.assertEqual(
            resources["appium"]["drivers"]["android"]["expectedVersion"],
            "4.2.9",
        )
        self.assertEqual(
            set(resources["clients"]),
            {"sim-ios", "sim-android"},
        )
        self.assertEqual(
            resources["clients"]["sim-ios"]["deviceRole"],
            "simulator",
        )
        self.assertEqual(
            resources["clients"]["sim-android"]["deviceRole"],
            "emulator",
        )
        chromedriver = resources["chromedriver"]
        self.assertEqual(chromedriver["version"], self.driver_version)
        self.assertEqual(
            chromedriver["sha256"],
            hashlib.sha256(self.driver_bytes).hexdigest(),
        )
        self.assertEqual(chromedriver["browser"]["major"], 124)
        self.assertEqual(
            chromedriver["browser"]["activePackage"],
            "com.google.android.webview",
        )
        self.assertEqual(
            chromedriver["browser"]["discovery"],
            "adb-shell-dumpsys-webviewupdate",
        )
        self.assertTrue(
            chromedriver["executableReference"].startswith(
                "<runtime-cache>/chromedriver/"
            )
        )
        self.assertEqual(
            resources["clients"]["sim-android"]["appiumCapabilities"][
                "appium:chromedriverExecutable"
            ],
            chromedriver["executable"],
        )
        self.assertEqual(
            resources["clients"]["sim-android"]["appiumCapabilities"][
                "chromedriverExecutableReference"
            ],
            chromedriver["executableReference"],
        )
        self.assertEqual(
            resources["appium"]["drivers"]["android"][
                "chromedriverExecutable"
            ],
            chromedriver["executable"],
        )
        self.assertEqual(
            resources["appium"]["drivers"]["android"][
                "chromedriverExecutableReference"
            ],
            chromedriver["executableReference"],
        )
        self.assertTrue(
            resources["clients"]["sim-android"]["device"].startswith(
                "emulator-"
            )
        )
        self.assertFalse(
            any(
                "physical-device" in " ".join(command)
                for command in self.executor.commands
            )
        )
        self.assertTrue(
            all(
                environment.get("VITE_ACCEPTANCE_HARNESS") == "1"
                for environment in self.executor.environments
            )
        )
        self.assertEqual(self.fetches, [])

        for platform in ("ios", "android"):
            application = resources["applications"][platform]
            self.assertTrue(Path(application["artifact"]).exists())
            self.assertEqual(len(application["sha256"]), 64)

        for client_id, (platform, _, _) in EXPECTED_CLIENTS.items():
            client = resources["clients"][client_id]
            application = resources["applications"][platform]
            driver = resources["appium"]["drivers"][platform]
            session = SimulatorAppiumSession(
                transport=object(),  # type: ignore[arg-type]
                client_id=client_id,
                platform=platform,
                automation_name=driver["automationName"],
                device=SimulatorDeviceTarget(
                    platform=platform,
                    identifier=client["device"],
                    role=client["deviceRole"],
                ),
                build=SimulatorBuildTarget(
                    platform=platform,
                    artifact=Path(application["artifact"]),
                    application_id=application["id"],
                ),
                callback_scheme=application["callbackScheme"],
                ports=client["ports"],
                chromedriver_executable=(
                    client.get("appiumCapabilities", {}).get(
                        "appium:chromedriverExecutable",
                        "",
                    )
                ),
            )
            self.assertEqual(session.device.identifier, client["device"])
            if platform == "android":
                self.assertEqual(
                    session.chromedriver_executable,
                    chromedriver["executable"],
                )

    def test_cleanup_releases_resources_in_reverse_acquisition_order(
        self,
    ) -> None:
        manifest = self.provisioner.provision(
            "mobile-simulator-access-e2e"
        )
        runtime_root = Path(
            manifest.to_dict()["mobileSimulator"]["clients"]["sim-ios"][
                "storageRoot"
            ]
        ).parents[1]

        completed = self.provisioner.cleanup()

        self.assertFalse(runtime_root.exists())
        self.assertLess(
            completed.index("appium-process"),
            completed.index(
                "application-uninstall:android:com.peers.touch.mobile"
            ),
        )
        self.assertLess(
            completed.index(
                "application-uninstall:android:com.peers.touch.mobile"
            ),
            completed.index("emulator-process:emulator-5554"),
        )
        self.assertLess(
            completed.index("emulator-process:emulator-5554"),
            completed.index("simulator-shutdown:ios-simulator-udid"),
        )
        self.assertEqual(
            completed[-1],
            "environment-lease:mobile-simulator",
        )
        self.assertIn("stop:appium", self.executor.events)
        self.assertIn("stop:emulator", self.executor.events)

    def test_missing_exact_ios_runtime_blocks_without_using_another_device(
        self,
    ) -> None:
        original_run = self.executor.run

        def run_without_ios_runtime(
            command: tuple[str, ...] | list[str],
            *,
            cwd: Path,
            env: dict[str, str],
            timeout: float,
        ) -> CommandResult:
            if tuple(command) == ("xcrun", "simctl", "list", "--json"):
                return CommandResult(
                    0,
                    json.dumps({"runtimes": [], "devices": {}}),
                )
            return original_run(
                command,
                cwd=cwd,
                env=env,
                timeout=timeout,
            )

        self.executor.run = run_without_ios_runtime  # type: ignore[method-assign]
        manifest = self.provisioner.provision(
            "mobile-simulator-access-e2e"
        )

        self.assertEqual(manifest.state, ProvisioningState.BLOCKED)
        self.assertEqual(
            manifest.blocked_resource,
            "mobile-simulator:ios-runtime",
        )
        self.assertFalse(
            any(
                command[0] in {"xcodebuild", "appium"}
                for command in self.executor.commands
            )
        )
        self.provisioner.cleanup()

    def test_absent_chromedriver_blocks_without_implicit_download(self) -> None:
        self._write_cached_driver(self.driver_bytes).unlink()
        self.contract_payload["appium"]["chromedriver"]["acquisition"][
            "enabled"
        ] = False
        self._write_contract()
        self.provisioner = self._new_provisioner()

        manifest = self.provisioner.provision(
            "mobile-simulator-access-e2e"
        )

        self.assertEqual(manifest.state, ProvisioningState.BLOCKED)
        self.assertEqual(
            manifest.blocked_resource,
            "mobile-simulator:chromedriver-artifact-absent",
        )
        self.assertEqual(self.fetches, [])
        self.provisioner.cleanup()

    def test_contract_without_browser_major_fails_closed(
        self,
    ) -> None:
        self.contract_payload["appium"]["chromedriver"]["artifacts"] = []
        self.contract_payload["appium"]["chromedriver"]["acquisition"][
            "enabled"
        ] = False
        self._write_contract()
        self.provisioner = self._new_provisioner()

        manifest = self.provisioner.provision(
            "mobile-simulator-access-e2e"
        )

        self.assertEqual(manifest.state, ProvisioningState.BLOCKED)
        self.assertEqual(
            manifest.blocked_resource,
            "mobile-simulator:chromedriver-browser-mismatch:124",
        )
        self.provisioner.cleanup()

    def test_chromedriver_checksum_mismatch_blocks(self) -> None:
        self._write_cached_driver(b"tampered")

        manifest = self.provisioner.provision(
            "mobile-simulator-access-e2e"
        )

        self.assertEqual(manifest.state, ProvisioningState.BLOCKED)
        self.assertEqual(
            manifest.blocked_resource,
            "mobile-simulator:chromedriver-checksum",
        )
        self.provisioner.cleanup()

    def test_explicit_acquisition_writes_only_to_external_runtime_cache(
        self,
    ) -> None:
        self._write_cached_driver(self.driver_bytes).unlink()
        self.contract_payload["appium"]["chromedriver"]["acquisition"][
            "enabled"
        ] = True
        self._write_contract()
        self.provisioner = self._new_provisioner()

        manifest = self.provisioner.provision(
            "mobile-simulator-access-e2e"
        )

        self.assertEqual(manifest.state, ProvisioningState.FIXTURE_READY)
        resources = manifest.to_dict()["mobileSimulator"]
        self.assertTrue(resources["chromedriver"]["acquisition"]["performed"])
        self.assertEqual(len(self.fetches), 1)
        self.assertFalse(
            any(
                self.repo_root == path or self.repo_root in path.parents
                for path in self.cache_root.rglob("*")
            )
        )
        self.provisioner.cleanup()

    def test_browser_major_without_exact_driver_blocks(self) -> None:
        self.executor.browser_versions["com.google.android.webview"] = (
            "125.0.6422.0"
        )

        manifest = self.provisioner.provision(
            "mobile-simulator-access-e2e"
        )

        self.assertEqual(manifest.state, ProvisioningState.BLOCKED)
        self.assertEqual(
            manifest.blocked_resource,
            "mobile-simulator:chromedriver-browser-mismatch:125",
        )
        self.provisioner.cleanup()

    def test_appium_driver_version_mismatch_blocks_before_server_start(
        self,
    ) -> None:
        self.contract_payload["appium"]["drivers"]["ios"][
            "expected_version"
        ] = "9.10.4"
        self._write_contract()
        self.provisioner = self._new_provisioner()

        manifest = self.provisioner.provision(
            "mobile-simulator-access-e2e"
        )

        self.assertEqual(manifest.state, ProvisioningState.BLOCKED)
        self.assertEqual(
            manifest.blocked_resource,
            "mobile-simulator:appium-driver-version:ios",
        )
        self.assertNotIn("stop:appium", self.executor.events)
        self.provisioner.cleanup()

    def test_appium_server_version_mismatch_blocks(self) -> None:
        self.provisioner = TestMobileSimulatorProvisioner(
            self.contract,
            executor=self.executor,
            repo_root=self.repo_root,
            runtime_base=self.root / "runtime",
            runtime_cache_base=self.cache_root,
            contract_path=self.contract_path,
            artifact_fetcher=self._fetch_driver,
            status_reader=lambda url, timeout: {
                "value": {"build": {"version": "2.18.0"}}
            },
            sleep=lambda _: None,
        )

        manifest = self.provisioner.provision(
            "mobile-simulator-access-e2e"
        )

        self.assertEqual(manifest.state, ProvisioningState.BLOCKED)
        self.assertEqual(
            manifest.blocked_resource,
            "mobile-simulator:appium-server-version",
        )
        self.provisioner.cleanup()

    def test_unsupported_emulator_abi_blocks(self) -> None:
        artifact = self.contract_payload["appium"]["chromedriver"][
            "artifacts"
        ][0]
        artifact["android_abis"] = ["x86_64"]
        self._write_contract()
        self.provisioner = self._new_provisioner()

        manifest = self.provisioner.provision(
            "mobile-simulator-access-e2e"
        )

        self.assertEqual(manifest.state, ProvisioningState.BLOCKED)
        self.assertEqual(
            manifest.blocked_resource,
            "mobile-simulator:chromedriver-unsupported-arch",
        )
        self.provisioner.cleanup()

if __name__ == "__main__":
    unittest.main(verbosity=2)
