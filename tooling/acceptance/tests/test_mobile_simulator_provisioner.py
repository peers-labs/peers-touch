#!/usr/bin/env python3
"""Mobile simulator Environment and Provisioner contract tests."""

from __future__ import annotations

import dataclasses
import hashlib
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import call, patch

from tooling.acceptance.core import (
    ArtifactRef,
    BlockedError,
    ClientRuntime,
    EnvironmentContract,
    ProvisioningError,
    ProvisioningState,
    ServiceAttestation,
    new_manifest,
)
from tooling.acceptance.core._paths import ENVIRONMENTS_DIR
from tooling.acceptance.gates.mobile.simulator_e2e import (
    REQUIRED_HARNESS_ACTIONS,
    SimulatorAppiumSession,
    SimulatorBuildTarget,
    SimulatorDeviceTarget,
)
from tooling.acceptance.provisioners import (
    MobileDirectSimulatorProvisioner,
    MobileIOSLayoutSimulatorProvisioner,
    MobileSimulatorProvisioner,
    MobileSocialSimulatorProvisioner,
    MobileStationLifecycleSimulatorProvisioner,
    get_provisioner,
)
from tooling.acceptance.provisioners import (
    mobile_simulator as mobile_simulator_module,
)
from tooling.acceptance.provisioners.mobile_simulator import (
    ANDROID_ABI,
    ANDROID_AVD_NAME,
    ANDROID_MANIFEST_RELATIVE_PATH,
    BASE_SIMULATOR_HARNESS_ACTIONS,
    DIRECT_SIMULATOR_ENVIRONMENT_ID,
    EXPECTED_CLIENTS,
    EXPECTED_DRIVERS,
    IOS_WEB_ASSETS_RELATIVE_PATH,
    IOS_DEVICE_NAME,
    IOS_PEER_DEVICE_NAME,
    IOS_LAYOUT_CLIENTS,
    IOS_RUNTIME,
    MOBILE_WEB_DIST_RELATIVE_PATH,
    SIMULATOR_APPIUM_CAPABILITY_ID,
    STATION_BOUND_SIMULATOR_GATE_IDS,
    STATION_LIFECYCLE_ENVIRONMENT_ID,
    STATION_LIFECYCLE_HARNESS_ACTIONS,
    CommandResult,
    MobileSimulatorAppiumCapabilityHandler,
    SelectedMobileSimulatorProvisioner,
    _GeneratedAndroidManifestGuard,
    _resolve_android_ndk_home,
    _resolve_android_ndk_tool,
    _resolve_command,
    _with_simulator_resources,
    load_mobile_ios_layout_simulator_spec,
    load_mobile_simulator_spec,
    load_mobile_station_lifecycle_simulator_spec,
)
from tooling.acceptance.provisioners.mobile_service_bindings import (
    resolve_mobile_service_bindings,
)


def _write_valid_ndk(path: Path) -> Path:
    path.mkdir(parents=True)
    (path / "source.properties").write_text(
        "Pkg.Desc = Android NDK\n",
        encoding="utf-8",
    )
    (path / "toolchains" / "llvm" / "prebuilt" / "test-host").mkdir(
        parents=True
    )
    ranlib = (
        path
        / "toolchains"
        / "llvm"
        / "prebuilt"
        / "test-host"
        / "bin"
        / "llvm-ranlib"
    )
    ranlib.parent.mkdir()
    ranlib.write_text("", encoding="utf-8")
    ranlib.chmod(0o755)
    return path.resolve()


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
        self.ios_asset_payloads: list[str] = []

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
                                },
                                {
                                    "name": IOS_PEER_DEVICE_NAME,
                                    "udid": "ios-peer-simulator-udid",
                                    "state": "Shutdown",
                                    "isAvailable": True,
                                },
                            ]
                        },
                    }
                ),
            )
        if command[:3] == ("xcrun", "simctl", "create"):
            return CommandResult(
                0,
                "ios-" + hashlib.sha256(
                    command[3].encode("utf-8")
                ).hexdigest()[:16] + "\n",
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
        if command == ("pnpm", "--dir", "apps/mobile", "run", "build"):
            dist = self.repo_root / MOBILE_WEB_DIST_RELATIVE_PATH
            (dist / "assets").mkdir(parents=True, exist_ok=True)
            (dist / "index.html").write_text(
                "fresh-mobile-web-bundle\n",
                encoding="utf-8",
            )
            (dist / "assets" / "main.js").write_text(
                "mobile\n",
                encoding="utf-8",
            )
            return CommandResult(0)
        if command and command[0] == "xcodebuild":
            assets = self.repo_root / IOS_WEB_ASSETS_RELATIVE_PATH
            try:
                self.ios_asset_payloads.append(
                    (assets / "index.html").read_text(encoding="utf-8")
                )
            except OSError as error:
                return CommandResult(
                    1,
                    stderr=f"generated Apple assets are unavailable: {error}",
                )
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
            manifest = self.repo_root / ANDROID_MANIFEST_RELATIVE_PATH
            content = manifest.read_text(encoding="utf-8")
            manifest.write_text(
                content.replace(
                    '                <data android:path="/callback" />\n',
                    '                <data android:path="/callback" />\n'
                    "                \n"
                    "                \n"
                    "                \n",
                ),
                encoding="utf-8",
            )
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


class TestSelectedMobileSimulatorProvisioner(
    SelectedMobileSimulatorProvisioner
):
    def _git_commit(self) -> str:
        return "source-commit"

    def _git_workspace_digest(self) -> str:
        return "clean"

    @staticmethod
    def _build_inputs_digest(platform: str) -> str:
        marker = "1" if platform == "ios" else "2"
        return f"sha256:{marker * 64}"

    def acquire_profile_lease(self, resource: str, owner: str) -> None:
        del owner
        self.register_cleanup(
            f"environment-lease:{resource}",
            lambda: self.executor.events.append(
                "release:environment-lease"
            ),
        )

    @staticmethod
    def _host_platform_identity() -> tuple[str, str]:
        return "darwin", "arm64"


class FakeMobileIOSLayoutSimulatorProvisioner(
    MobileIOSLayoutSimulatorProvisioner
):
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


class FakeEvidenceRun:
    run_id = "20260909T120000000000Z-" + ("1" * 32)

    def __init__(self) -> None:
        self.writes: list[tuple[str, dict[str, Any], str | None]] = []

    def write_json(
        self,
        path: str,
        value: dict[str, Any],
        *,
        role: str | None = None,
        redact: bool = True,
    ) -> ArtifactRef:
        del redact
        self.writes.append((path, value, role))
        return ArtifactRef(
            workspace_id="a" * 16,
            gate_id="mobile-simulator-station-lifecycle-e2e",
            run_id=self.run_id,
            path=path,
            sha256=hashlib.sha256(path.encode("utf-8")).hexdigest(),
            media_type="application/json",
        )


class FakeParentSimulatorSession:
    def __init__(self, client_id: str) -> None:
        self.client_id = client_id
        self.platform = "ios"
        self.session_id = f"raw-session-{client_id}"
        self.device = SimpleNamespace(identifier=f"raw-device-{client_id}")
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.active_station_peer_id = ""
        self.actor_ptid: str | None = None
        self.generation = 0
        self.started = False

    def start(self) -> "FakeParentSimulatorSession":
        self.started = True
        return self

    def stop(self) -> None:
        self.calls.append(("stop", {}))
        self.started = False

    def wait_for_ready(self) -> None:
        self.calls.append(("wait_for_ready", {}))

    def switch_to_app_webview(self) -> str:
        self.calls.append(("switch_to_app_webview", {}))
        return "WEBVIEW_com.peers.touch.mobile"

    def require_harness(self, actions: list[str]) -> list[str]:
        self.calls.append(("require_harness", {"actions": actions}))
        return actions

    def call_action(
        self,
        action: str,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        body = dict(payload or {})
        self.calls.append((action, body))
        if action == "station.add":
            endpoint = str(body["url"])
            self.actor_ptid = None
            self.active_station_peer_id = (
                "peer-secondary"
                if "secondary" in endpoint
                else "peer-primary"
            )
            self.generation += 1
            return {
                "activeStationPeerId": self.active_station_peer_id,
                "verifiedStationPeerId": self.active_station_peer_id,
                "canonicalOrigin": endpoint,
                "entries": [
                    {
                        "stationPeerId": self.active_station_peer_id,
                        "url": endpoint,
                        "label": "Station",
                    }
                ],
            }
        if action == "station.select":
            remote_revocation = (
                "confirmed"
                if self.actor_ptid is not None
                else "not-required"
            )
            self.active_station_peer_id = str(body["stationPeerId"])
            self.actor_ptid = None
            self.generation += 1
            return {
                "activeStationPeerId": self.active_station_peer_id,
                "entries": [],
                "sessionRevocation": {
                    "remoteRevocation": remote_revocation,
                },
            }
        if action == "access.submit":
            if body.get("kind") == "start":
                return {
                    "decision": {"attemptId": "attempt-1"},
                    "session": None,
                }
            self.actor_ptid = "ptid:alice"
            return {
                "decision": {
                    "state": "ACCESS_DECISION_STATE_GRANTED",
                },
                "session": {
                    "stationPeerId": self.active_station_peer_id,
                    "actorPtid": self.actor_ptid,
                },
            }
        if action == "lifecycle.scope.read":
            active = self.actor_ptid is not None
            return {
                "phase": "ACTIVE",
                "launchState": "shell" if active else "station-selection",
                "generation": self.generation,
                "activeStationPeerId": self.active_station_peer_id,
                "activeActorPtid": self.actor_ptid,
                "runtimeStationPeerId": (
                    self.active_station_peer_id if active else None
                ),
                "deviceId": f"device-{self.client_id}",
                "social": {
                    "stationPeerId": (
                        self.active_station_peer_id if active else None
                    ),
                    "actorPtid": self.actor_ptid,
                    "sessionCount": 1 if active else 0,
                    "requestCount": 0,
                    "messageThreadCount": 0,
                },
                "group": {
                    "stationPeerId": (
                        self.active_station_peer_id if active else None
                    ),
                    "actorPtid": self.actor_ptid,
                    "groupCount": 0,
                    "messageThreadCount": 0,
                },
                "navigation": {
                    "primaryRouteId": "tab:chat",
                    "detailKeys": [],
                    "overlayRouteId": None,
                },
            }
        if action == "cleanup":
            return {
                "oauthPurge": {
                    "stationRevocation": "not_required",
                    "secureStorage": {
                        "activeAttemptIndexAbsent": True,
                        "attemptSecretRecordAbsent": True,
                        "currentSessionIndexAbsent": True,
                        "credentialRecordAbsent": True,
                        "publicProjectionAbsent": True,
                    },
                },
                "webSessionProjectionCleared": True,
                "stationRegistryCleared": True,
            }
        return {"ok": True}


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
        self.assertEqual(
            self.spec.ios_peer_device_name,
            IOS_PEER_DEVICE_NAME,
        )
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
            BASE_SIMULATOR_HARNESS_ACTIONS,
        )

    def test_ios_layout_contract_pins_current_iphone_cell(self) -> None:
        path = ENVIRONMENTS_DIR / "mobile-ios-layout-simulator.yaml"
        contract = EnvironmentContract.from_yaml(path)
        spec = load_mobile_ios_layout_simulator_spec(path)

        self.assertEqual(contract.id, "mobile-ios-layout-simulator")
        self.assertFalse(contract.profile.required)
        self.assertEqual(
            {
                client.id: (client.device_name, client.viewport_role)
                for client in spec.clients
            },
            IOS_LAYOUT_CLIENTS,
        )
        self.assertEqual(
            set(spec.harness_actions),
            {"projection.read"},
        )
        self.assertIn("Android", spec.proof_scope["doesNotProve"])

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

    def test_social_simulator_overlay_has_typed_service_bindings(self) -> None:
        path = ENVIRONMENTS_DIR / "mobile-social-simulator.yaml"
        payload = json.loads(path.read_text(encoding="utf-8"))
        contract = EnvironmentContract.from_yaml(path)

        self.assertEqual(payload["base_environment"], "mobile-simulator")
        self.assertEqual(
            set(contract.services),
            {"station-primary", "station-secondary", "relay"},
        )
        self.assertEqual(
            {
                client.id: client.service_bindings["station"].service_id
                for client in contract.clients
            },
            {
                "sim-ios": "station-primary",
                "sim-ios-peer": "station-secondary",
            },
        )
        self.assertFalse(contract.profile.required)
        self.assertFalse(contract.profile.identity_match)
        self.assertEqual(contract.credentials, ())
        provisioner = get_provisioner(contract)
        self.assertIsInstance(
            provisioner,
            MobileSocialSimulatorProvisioner,
        )
        self.assertEqual(
            provisioner._load_overlay()["harness"]["namespace"],
            "__PEERS_MOBILE_ACCEPTANCE__",
        )

    def test_direct_simulator_binds_two_actors_to_one_station(self) -> None:
        path = ENVIRONMENTS_DIR / "mobile-direct-simulator.yaml"
        payload = json.loads(path.read_text(encoding="utf-8"))
        contract = EnvironmentContract.from_yaml(path)

        self.assertEqual(payload["base_environment"], "mobile-simulator")
        self.assertEqual(contract.id, DIRECT_SIMULATOR_ENVIRONMENT_ID)
        self.assertEqual(set(contract.services), {"station"})
        self.assertEqual(
            {
                client.id: (
                    client.actor,
                    client.service_bindings["station"].service_id,
                )
                for client in contract.clients
            },
            {
                "sim-ios": ("alice", "station"),
                "sim-ios-peer": ("bob", "station"),
            },
        )
        self.assertNotIn("relay", contract.services)
        self.assertIn(
            "cross-Station or Relay delivery",
            payload["proof_scope"]["does_not_prove"],
        )
        self.assertIn(
            "lifecycle.scope.read",
            payload["harness"]["required_actions"],
        )
        self.assertIsInstance(
            get_provisioner(contract),
            MobileDirectSimulatorProvisioner,
        )

    def test_direct_simulator_accepts_one_explicit_station_profile(self) -> None:
        path = ENVIRONMENTS_DIR / "mobile-direct-simulator.yaml"
        contract = EnvironmentContract.from_yaml(path)
        provisioner = get_provisioner(
            contract,
            station_profiles={"station": "chat-native-disposable"},
        )

        self.assertIsInstance(
            provisioner,
            MobileDirectSimulatorProvisioner,
        )
        self.assertEqual(
            provisioner._required_station_profiles(),
            {"station": "chat-native-disposable"},
        )
        self.assertEqual(provisioner._required_service_profiles(), {})

    def test_direct_simulator_injects_station_profile_in_memory(self) -> None:
        path = ENVIRONMENTS_DIR / "mobile-direct-simulator.yaml"
        contract = EnvironmentContract.from_yaml(path)
        provisioner = MobileDirectSimulatorProvisioner(
            contract,
            station_profiles={"station": "three"},
        )
        active = {"PT_DEV_PROFILE": "three"}

        with patch(
            "tooling.acceptance.provisioners.mobile_simulator."
            "resolve_machine_profile_environment",
            return_value=(
                "three",
                Path("/canonical/three/profile.env.example"),
                15,
                {
                    "PT_DEV_PROFILE": "three",
                    "PT_STATION_MODE": "remote",
                    "PT_STATION_URL": "https://direct.example",
                    "PT_STATION_DEPLOY_ENV": "station-three",
                },
            ),
        ):
            merged = provisioner._inject_station_profile_bindings(active)

        self.assertEqual(
            merged["PT_MOBILE_DIRECT_STATION_URL"],
            "https://direct.example",
        )
        self.assertEqual(
            merged["PT_MOBILE_DIRECT_STATION_DEPLOY_ENV"],
            "station-three",
        )
        self.assertNotIn("PT_MOBILE_DIRECT_STATION_URL", active)

    def test_direct_simulator_rejects_non_active_station_profile(self) -> None:
        path = ENVIRONMENTS_DIR / "mobile-direct-simulator.yaml"
        contract = EnvironmentContract.from_yaml(path)
        provisioner = MobileDirectSimulatorProvisioner(
            contract,
            station_profiles={"station": "three"},
        )

        with (
            patch(
                "tooling.acceptance.provisioners.mobile_simulator."
                "resolve_machine_profile_environment",
                return_value=(
                    "two",
                    Path("/canonical/two/profile.env.example"),
                    1,
                    {
                        "PT_DEV_PROFILE": "two",
                        "PT_STATION_MODE": "remote",
                        "PT_STATION_URL": "https://two.example",
                        "PT_STATION_DEPLOY_ENV": "station-two",
                    },
                ),
            ),
            self.assertRaisesRegex(
                BlockedError,
                "requested='three' active='two'",
            ),
        ):
            provisioner._inject_station_profile_bindings({})

    def test_current_two_actor_gates_use_direct_environment(self) -> None:
        catalog = json.loads(
            (ENVIRONMENTS_DIR.parent / "gates.yaml").read_text(
                encoding="utf-8"
            )
        )
        gates = catalog["gates"]
        current_gate_ids = (
            "mobile-simulator-social-convergence-e2e",
            "mobile-simulator-chat-contacts-e2e",
            "mobile-simulator-recovery-e2e",
            "mobile-simulator-recovery-ui-e2e",
            "mobile-simulator-moments-e2e",
        )

        for gate_id in current_gate_ids:
            with self.subTest(gate_id=gate_id):
                self.assertEqual(
                    gates[gate_id]["environment"],
                    DIRECT_SIMULATOR_ENVIRONMENT_ID,
                )
                self.assertEqual(
                    gates[gate_id]["provisioner"],
                    DIRECT_SIMULATOR_ENVIRONMENT_ID,
                )

    def test_social_simulator_accepts_explicit_station_profiles(self) -> None:
        path = ENVIRONMENTS_DIR / "mobile-social-simulator.yaml"
        contract = EnvironmentContract.from_yaml(path)
        bindings = {
            "station-primary": "four",
            "station-secondary": "fiveArm",
        }
        provisioner = get_provisioner(
            contract,
            station_profiles=bindings,
            service_profiles={"relay": "one"},
        )

        self.assertIsInstance(
            provisioner,
            MobileSocialSimulatorProvisioner,
        )
        self.assertEqual(
            provisioner._required_station_profiles(),
            bindings,
        )
        self.assertEqual(
            provisioner._required_service_profiles(),
            {"relay": "one"},
        )

    def test_social_simulator_rejects_invalid_station_profile_sets(self) -> None:
        path = ENVIRONMENTS_DIR / "mobile-social-simulator.yaml"
        contract = EnvironmentContract.from_yaml(path)

        for bindings in (
            {"station-primary": "four"},
            {
                "station-primary": "four",
                "station-secondary": "fiveArm",
                "station-extra": "six",
            },
            {
                "station-primary": "four",
                "station-secondary": "four",
            },
            {
                "station-primary": "../four",
                "station-secondary": "fiveArm",
            },
        ):
            with self.subTest(bindings=bindings):
                provisioner = get_provisioner(
                    contract,
                    station_profiles=bindings,
                )
                with self.assertRaises(BlockedError):
                    provisioner._required_station_profiles()

    def test_social_simulator_rejects_invalid_service_profile_sets(self) -> None:
        path = ENVIRONMENTS_DIR / "mobile-social-simulator.yaml"
        contract = EnvironmentContract.from_yaml(path)

        for bindings in (
            {"station-primary": "four"},
            {"relay": "../one"},
        ):
            with self.subTest(bindings=bindings):
                provisioner = get_provisioner(
                    contract,
                    service_profiles=bindings,
                )
                with self.assertRaises(BlockedError):
                    provisioner._required_service_profiles()

    def test_social_simulator_injects_station_profiles_in_memory(self) -> None:
        path = ENVIRONMENTS_DIR / "mobile-social-simulator.yaml"
        contract = EnvironmentContract.from_yaml(path)
        provisioner = MobileSocialSimulatorProvisioner(
            contract,
            station_profiles={
                "station-primary": "four",
                "station-secondary": "fiveArm",
            },
        )
        active = {
            "PT_DEV_PROFILE": "four",
            "PT_RELAY_URL": "https://relay.example",
            "PT_RELAY_DEPLOY_ENV": "relay",
        }
        station_profiles = {
            "four": {
                "PT_DEV_PROFILE": "four",
                "PT_STATION_MODE": "remote",
                "PT_STATION_URL": "https://four.example",
                "PT_STATION_DEPLOY_ENV": "station-four",
            },
            "fiveArm": {
                "PT_DEV_PROFILE": "fiveArm",
                "PT_STATION_MODE": "remote",
                "PT_STATION_URL": "https://five.example",
                "PT_STATION_DEPLOY_ENV": "station-five-arm",
            },
        }

        with (
            patch(
                "tooling.acceptance.provisioners.mobile_simulator."
                "resolve_reviewed_profile_environment",
                side_effect=lambda profile_name: (
                    Path(
                        f"/canonical/{profile_name}/"
                        "profile.env.example"
                    ),
                    station_profiles[profile_name],
                ),
            ),
        ):
            merged = provisioner._inject_station_profile_bindings(active)

        self.assertEqual(
            merged,
            {
                **active,
                "PT_MOBILE_STATION_PRIMARY_URL": "https://four.example",
                "PT_MOBILE_STATION_PRIMARY_DEPLOY_ENV": "station-four",
                "PT_MOBILE_STATION_SECONDARY_URL": "https://five.example",
                "PT_MOBILE_STATION_SECONDARY_DEPLOY_ENV": "station-five-arm",
            },
        )
        self.assertNotIn("PT_MOBILE_STATION_PRIMARY_URL", active)

    def test_social_simulator_injects_relay_profile_in_memory(self) -> None:
        path = ENVIRONMENTS_DIR / "mobile-social-simulator.yaml"
        contract = EnvironmentContract.from_yaml(path)
        provisioner = MobileSocialSimulatorProvisioner(
            contract,
            service_profiles={"relay": "one"},
        )
        active = {
            "PT_DEV_PROFILE": "four",
            "PT_RELAY_URL": "https://stale-relay.example",
            "PT_RELAY_DEPLOY_ENV": "relay",
        }
        with (
            patch(
                "tooling.acceptance.provisioners.mobile_simulator."
                "resolve_reviewed_profile_environment",
                return_value=(
                    Path("/canonical/one/profile.env.example"),
                    {
                        "PT_DEV_PROFILE": "one",
                        "PT_RELAY_MODE": "remote",
                        "PT_RELAY_URL": "https://relay.example",
                        "PT_RELAY_HEALTH_URL": (
                            "https://relay.example/healthz"
                        ),
                        "PT_RELAY_DEPLOY_ENV": "relay-1",
                    },
                ),
            ),
        ):
            merged = provisioner._inject_service_profile_bindings(active)

        self.assertEqual(merged["PT_RELAY_URL"], "https://relay.example")
        self.assertEqual(merged["PT_RELAY_DEPLOY_ENV"], "relay-1")
        self.assertEqual(
            merged["PT_RELAY_HEALTH_URL"],
            "https://relay.example/healthz",
        )
        self.assertEqual(active["PT_RELAY_DEPLOY_ENV"], "relay")

    def test_social_simulator_preserves_base_harness_actions(self) -> None:
        path = ENVIRONMENTS_DIR / "mobile-social-simulator.yaml"
        payload = json.loads(path.read_text(encoding="utf-8"))

        self.assertLessEqual(
            set(REQUIRED_HARNESS_ACTIONS),
            set(payload["harness"]["required_actions"]),
        )

    def test_social_environment_failure_blocks_before_resource_acquisition(self) -> None:
        path = ENVIRONMENTS_DIR / "mobile-social-simulator.yaml"
        contract = EnvironmentContract.from_yaml(path)

        class Base:
            def __init__(self, _contract: EnvironmentContract) -> None:
                raise AssertionError(
                    "base simulator must not be constructed before the overlay"
                )

        for gate_id in (
            "mobile-simulator-social-convergence-e2e",
            "mobile-simulator-chat-contacts-e2e",
        ):
            with self.subTest(gate_id=gate_id):
                provisioner = MobileSocialSimulatorProvisioner(
                    contract,
                    base_factory=Base,
                    overlay_path=path,
                )
                with (
                    patch.object(
                        provisioner,
                        "_load_overlay",
                        side_effect=BlockedError(
                            reason="environment unavailable",
                            resource="mobile-social-simulator:environment",
                        ),
                    ) as load_overlay,
                    patch(
                        "tooling.acceptance.provisioners.mobile_simulator."
                        "resolve_mobile_service_bindings"
                    ) as resolve_bindings,
                    patch.object(
                        provisioner,
                        "acquire_profile_lease",
                    ) as acquire_profile_lease,
                    patch.object(
                        provisioner,
                        "acquire_remote_git_source_lease",
                    ) as acquire_source_lease,
                    patch(
                        "tooling.acceptance.provisioners.mobile_simulator."
                        "verify_reset_target"
                    ) as verify_target,
                    patch.object(
                        provisioner,
                        "_attest_services",
                    ) as attest_services,
                    patch.object(
                        provisioner,
                        "_prepare_actor_fixture",
                    ) as prepare_fixture,
                ):
                    manifest = provisioner.provision(gate_id)

                self.assertEqual(
                    manifest.state,
                    ProvisioningState.BLOCKED,
                )
                self.assertEqual(
                    manifest.blocked_resource,
                    "mobile-social-simulator:environment",
                )
                load_overlay.assert_called_once()
                resolve_bindings.assert_not_called()
                acquire_profile_lease.assert_not_called()
                acquire_source_lease.assert_not_called()
                verify_target.assert_not_called()
                attest_services.assert_not_called()
                prepare_fixture.assert_not_called()

    def test_social_service_attestation_uses_remote_source_owner(self) -> None:
        path = ENVIRONMENTS_DIR / "mobile-social-simulator.yaml"
        contract = EnvironmentContract.from_yaml(path)
        provisioner = MobileSocialSimulatorProvisioner(
            contract,
            overlay_path=path,
        )
        bindings = resolve_mobile_service_bindings(
            contract,
            path,
            environment={
                "PT_MOBILE_STATION_PRIMARY_URL": (
                    "https://station-primary.example"
                ),
                "PT_MOBILE_STATION_PRIMARY_DEPLOY_ENV": "deploy-primary",
                "PT_MOBILE_STATION_SECONDARY_URL": (
                    "https://station-secondary.example"
                ),
                "PT_MOBILE_STATION_SECONDARY_DEPLOY_ENV": "deploy-secondary",
                "PT_RELAY_URL": "https://relay.example",
                "PT_RELAY_DEPLOY_ENV": "deploy-relay",
                "PT_RELAY_HEALTH_URL": (
                    "https://relay.example/sub-oss/healthz"
                ),
            },
        )

        with (
            patch.object(provisioner, "_station_ready", return_value=True),
            patch(
                "tooling.acceptance.provisioners.mobile_simulator."
                "produce_station_attestation",
                side_effect=lambda **kwargs: SimpleNamespace(
                    runtime_identity=f"peer-{kwargs['service_id']}"
                ),
            ) as station_producer,
            patch(
                "tooling.acceptance.provisioners.mobile_simulator."
                "produce_service_attestation",
                side_effect=lambda **kwargs: SimpleNamespace(
                    runtime_identity=f"peer-{kwargs['service_id']}"
                ),
            ) as service_producer,
        ):
            services = provisioner._attest_services("run-id", bindings)

        self.assertEqual(
            set(services),
            {"station-primary", "station-secondary", "relay"},
        )
        for call in station_producer.call_args_list:
            self.assertIs(
                call.kwargs["remote_source_identity_provider"],
                mobile_simulator_module.resolve_remote_source_identity,
            )
        self.assertIs(
            service_producer.call_args.kwargs[
                "remote_source_identity_provider"
            ],
            mobile_simulator_module.resolve_remote_source_identity,
        )

    def test_social_actor_fixture_resolves_each_role_in_its_deployment(
        self,
    ) -> None:
        path = ENVIRONMENTS_DIR / "mobile-social-simulator.yaml"
        contract = EnvironmentContract.from_yaml(path)
        provisioner = MobileSocialSimulatorProvisioner(
            contract,
            overlay_path=path,
        )
        evidence = FakeEvidenceRun()
        provisioner.bind_evidence_run(evidence)  # type: ignore[arg-type]
        bindings = resolve_mobile_service_bindings(
            contract,
            path,
            environment={
                "PT_MOBILE_STATION_PRIMARY_URL": (
                    "https://station-primary.example"
                ),
                "PT_MOBILE_STATION_PRIMARY_DEPLOY_ENV": "deploy-primary",
                "PT_MOBILE_STATION_SECONDARY_URL": (
                    "https://station-secondary.example"
                ),
                "PT_MOBILE_STATION_SECONDARY_DEPLOY_ENV": "deploy-secondary",
                "PT_RELAY_URL": "https://relay.example",
                "PT_RELAY_DEPLOY_ENV": "deploy-relay",
                "PT_RELAY_HEALTH_URL": (
                    "https://relay.example/sub-oss/healthz"
                ),
            },
        )

        with (
            patch.dict(
                "os.environ",
                {"MOBILE_ACCEPTANCE_RESET": "1"},
                clear=False,
            ),
            patch(
                "tooling.acceptance.provisioners.mobile_simulator."
                "verify_reset_target",
            ),
            patch(
                "tooling.acceptance.provisioners.mobile_simulator."
                "reset_fixture",
            ),
            patch(
                "tooling.acceptance.provisioners.mobile_simulator."
                "resolve_actor_identity",
                side_effect=lambda endpoint, _deployment, role: SimpleNamespace(
                    role=role,
                    account_ref=f"station-account:{role}@p.t",
                    ptid=f"ptid:{role}",
                    device_policy="single-active-session",
                    federated_handle=f"@{role}@station.example",
                    home_station_peer_id=(
                        "station-primary"
                        if "primary" in endpoint
                        else "station-secondary"
                    ),
                ),
            ) as resolve_actor,
        ):
            provisioner._prepare_actor_fixture(
                "mobile-simulator-social-convergence-e2e",
                bindings,
                provisioner._load_overlay(),
            )

        self.assertEqual(
            resolve_actor.call_args_list,
            [
                call(
                    "https://station-primary.example",
                    "deploy-primary",
                    "alice",
                ),
                call(
                    "https://station-primary.example",
                    "deploy-primary",
                    "bob",
                ),
                call(
                    "https://station-secondary.example",
                    "deploy-secondary",
                    "alice",
                ),
                call(
                    "https://station-secondary.example",
                    "deploy-secondary",
                    "bob",
                ),
            ],
        )
        actor_payload = evidence.writes[-1][1]
        actors = [
            actor
            for station in actor_payload["stations"].values()
            for actor in station["actors"]
        ]
        self.assertTrue(
            all(actor["federatedHandle"] for actor in actors)
        )
        self.assertEqual(
            {actor["homeStationPeerId"] for actor in actors},
            {"station-primary", "station-secondary"},
        )
        self.assertEqual(
            len({actor["federationId"] for actor in actors}),
            1,
        )
        self.assertTrue(actors[0]["federationId"])

    def test_direct_actor_fixture_resolves_both_roles_on_same_station(
        self,
    ) -> None:
        path = ENVIRONMENTS_DIR / "mobile-direct-simulator.yaml"
        contract = EnvironmentContract.from_yaml(path)
        provisioner = MobileDirectSimulatorProvisioner(
            contract,
            overlay_path=path,
        )
        evidence = FakeEvidenceRun()
        provisioner.bind_evidence_run(evidence)  # type: ignore[arg-type]
        bindings = resolve_mobile_service_bindings(
            contract,
            path,
            environment={
                "PT_MOBILE_DIRECT_STATION_URL": (
                    "https://direct.example"
                ),
                "PT_MOBILE_DIRECT_STATION_DEPLOY_ENV": (
                    "chat-native-disposable-station"
                ),
            },
        )

        with (
            patch.dict(
                "os.environ",
                {"MOBILE_ACCEPTANCE_RESET": "1"},
                clear=False,
            ),
            patch(
                "tooling.acceptance.provisioners.mobile_simulator."
                "verify_reset_target",
            ),
            patch(
                "tooling.acceptance.provisioners.mobile_simulator."
                "reset_fixture",
            ) as reset,
            patch(
                "tooling.acceptance.provisioners.mobile_simulator."
                "resolve_actor_identity",
                side_effect=lambda _endpoint, _deployment, role: SimpleNamespace(
                    role=role,
                    account_ref=f"station-account:{role}@p.t",
                    ptid=f"ptid:{role}",
                    device_policy="single-active-session",
                    federated_handle=f"@{role}@direct",
                    home_station_peer_id="station-direct",
                ),
            ) as resolve_actor,
        ):
            provisioner._prepare_actor_fixture(
                "mobile-simulator-recovery-e2e",
                bindings,
                provisioner._load_overlay(),
            )

        reset.assert_called_once_with(
            "chat-native-disposable-station",
            ("alice", "bob"),
            reset_authorized=True,
        )
        self.assertEqual(
            resolve_actor.call_args_list,
            [
                call(
                    "https://direct.example",
                    "chat-native-disposable-station",
                    "alice",
                ),
                call(
                    "https://direct.example",
                    "chat-native-disposable-station",
                    "bob",
                ),
            ],
        )
        actor_payload = evidence.writes[-1][1]
        self.assertEqual(set(actor_payload["stations"]), {"station"})
        self.assertEqual(
            {
                client["id"]: client["serviceId"]
                for client in actor_payload["clients"]
            },
            {
                "sim-ios": "station",
                "sim-ios-peer": "station",
            },
        )
        self.assertEqual(
            {
                actor["homeStationPeerId"]
                for actor in actor_payload["stations"]["station"]["actors"]
            },
            {"station-direct"},
        )

    def test_station_lifecycle_overlay_has_exact_topology_and_bindings(
        self,
    ) -> None:
        path = (
            ENVIRONMENTS_DIR / "mobile-station-lifecycle-simulator.yaml"
        )
        contract = EnvironmentContract.from_yaml(path)
        spec = load_mobile_station_lifecycle_simulator_spec(path)

        self.assertEqual(
            contract.id,
            STATION_LIFECYCLE_ENVIRONMENT_ID,
        )
        self.assertEqual(
            set(contract.services),
            {"station-primary", "station-secondary"},
        )
        self.assertFalse(contract.profile.required)
        self.assertFalse(contract.profile.identity_match)
        self.assertTrue(
            all(
                service.kind == "station"
                for service in contract.services.values()
            )
        )
        self.assertEqual(
            {
                client.id: client.required_service_roles
                for client in contract.clients
            },
            {
                "sim-ios": (
                    "station-primary",
                    "station-secondary",
                ),
                "sim-ios-peer": ("station-primary",),
            },
        )
        self.assertEqual(
            set(spec.harness_actions),
            STATION_LIFECYCLE_HARNESS_ACTIONS,
        )
        self.assertIn(
            "mobile-simulator-settings-e2e",
            STATION_BOUND_SIMULATOR_GATE_IDS,
        )
        self.assertIn("settings.profile.update", spec.harness_actions)
        self.assertIn("settings.notifications.update", spec.harness_actions)
        self.assertIn("settings.device.update", spec.harness_actions)
        self.assertEqual(contract.credentials, ())
        self.assertIsInstance(
            get_provisioner(contract),
            MobileStationLifecycleSimulatorProvisioner,
        )

    def test_social_simulator_composes_base_runtime_without_credentials(
        self,
    ) -> None:
        social_path = ENVIRONMENTS_DIR / "mobile-social-simulator.yaml"
        contract = EnvironmentContract.from_yaml(social_path)
        base_manifest = _with_simulator_resources(
            dataclasses.replace(
                new_manifest(
                    environment_id="mobile-simulator",
                    gate_id="mobile-simulator-social-convergence-e2e",
                    requested_profile="mobile-simulator",
                    resolved_profile="mobile-simulator",
                    slot=0,
                    commit="a" * 40,
                    worktree="/tmp/worktree",
                    workspace_digest="dirty:test",
                ),
                state=ProvisioningState.FIXTURE_READY,
                clients=(
                    ClientRuntime(
                        actor="simulator",
                        runtime="tauri-ios-simulator",
                        worktree="/tmp/worktree",
                        gateway_port=1,
                        renderer_port=2,
                        webdriver_port=3,
                        profile="sim-ios",
                        storage_root="/tmp/sim-ios",
                    ),
                    ClientRuntime(
                        actor="peer-simulator",
                        runtime="tauri-ios-simulator",
                        worktree="/tmp/worktree",
                        gateway_port=4,
                        renderer_port=5,
                        webdriver_port=6,
                        profile="sim-ios-peer",
                        storage_root="/tmp/sim-ios-peer",
                    ),
                ),
            ),
            {
                "appium": {},
                "applications": {},
                "clients": {},
                "harness": {},
                "proofScope": {},
            },
        )

        class Base:
            def __init__(self, _contract: EnvironmentContract) -> None:
                self.evidence_run = None

            def bind_evidence_run(self, run: object) -> None:
                self.evidence_run = run

            def provision(self, _gate_id: str) -> object:
                return base_manifest

            @staticmethod
            def cleanup() -> tuple[str, ...]:
                return ()

        def attestation(service_id: str, kind: str) -> ServiceAttestation:
            return ServiceAttestation(
                service_id=service_id,
                service_kind=kind,
                environment_id="mobile-social-simulator",
                deployment_environment=f"deploy-{service_id}",
                endpoint=f"https://{service_id}.example",
                live_commit="a" * 40,
                workspace_digest="clean",
                protocol_digest="b" * 64,
                artifact_ref={},
                produced_at="2026-09-04T00:00:00+00:00",
                producer=f"{kind}-deployment",
                runtime_identity=f"peer-{service_id}",
            )

        provisioner = MobileSocialSimulatorProvisioner(
            contract,
            base_factory=Base,
            overlay_path=social_path,
        )
        provisioner.bind_evidence_run(object())  # type: ignore[arg-type]
        services = {
            "station-primary": attestation("station-primary", "station"),
            "station-secondary": attestation("station-secondary", "station"),
            "relay": attestation("relay", "relay"),
        }
        with (
            patch.dict(
                "os.environ",
                {
                    "MOBILE_ACCEPTANCE_RESET": "1",
                    "PT_MOBILE_STATION_PRIMARY_URL": (
                        "https://station-primary.example"
                    ),
                    "PT_MOBILE_STATION_PRIMARY_DEPLOY_ENV": (
                        "station-primary"
                    ),
                    "PT_MOBILE_STATION_SECONDARY_URL": (
                        "https://station-secondary.example"
                    ),
                    "PT_MOBILE_STATION_SECONDARY_DEPLOY_ENV": (
                        "station-secondary"
                    ),
                    "PT_RELAY_URL": "https://relay.example",
                    "PT_RELAY_DEPLOY_ENV": "relay",
                    "PT_RELAY_HEALTH_URL": (
                        "https://relay.example/sub-oss/healthz"
                    ),
                },
                clear=False,
            ),
            patch.object(
                provisioner,
                "acquire_profile_lease",
            ),
            patch.object(
                provisioner,
                "acquire_remote_git_source_lease",
            ),
            patch(
                "tooling.acceptance.provisioners.mobile_simulator."
                "verify_reset_target",
            ),
            patch.object(
                provisioner,
                "_attest_services",
                return_value=services,
            ),
            patch.object(
                provisioner,
                "_prepare_actor_fixture",
                return_value={"artifactKind": "acceptance-artifact-ref"},
            ),
        ):
            manifest = provisioner.provision(
                "mobile-simulator-social-convergence-e2e"
            )

        payload = manifest.to_dict()
        self.assertEqual(
            manifest.state,
            ProvisioningState.FIXTURE_READY,
        )
        self.assertEqual(payload["environmentId"], "mobile-social-simulator")
        self.assertEqual(payload["credentialRefs"], [])
        self.assertEqual(
            {
                client["id"]: client["service_bindings"]["station"][
                    "service_id"
                ]
                for client in payload["clients"]
            },
            {
                "sim-ios": "station-primary",
                "sim-ios-peer": "station-secondary",
            },
        )
        self.assertIn(
            "social.projection.read",
            payload["mobileSimulator"]["harness"]["requiredActions"],
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

    def test_explicit_ndk_home_wins_over_ambiguous_sdk_discovery(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            explicit = _write_valid_ndk(root / "explicit-ndk")
            sdk_root = root / "sdk"
            _write_valid_ndk(sdk_root / "ndk" / "26.0.0")
            _write_valid_ndk(sdk_root / "ndk" / "27.0.0")

            resolved = _resolve_android_ndk_home(
                {
                    "NDK_HOME": str(explicit),
                    "ANDROID_HOME": str(sdk_root),
                }
            )

        self.assertEqual(resolved, str(explicit))

    def test_ndk_home_is_discovered_from_single_sdk_installation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            sdk_root = Path(directory) / "sdk"
            expected = _write_valid_ndk(
                sdk_root / "ndk" / "27.0.11902837"
            )

            resolved = _resolve_android_ndk_home(
                {"ANDROID_SDK_ROOT": str(sdk_root)}
            )

        self.assertEqual(resolved, str(expected))

    def test_invalid_explicit_ndk_home_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            invalid = Path(directory) / "not-an-ndk"
            invalid.mkdir()

            with self.assertRaises(BlockedError) as raised:
                _resolve_android_ndk_home({"NDK_HOME": str(invalid)})

        self.assertEqual(
            raised.exception.resource,
            "mobile-simulator:android-ndk-home",
        )

    def test_missing_sdk_ndk_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            sdk_root = Path(directory) / "sdk"
            sdk_root.mkdir()

            with self.assertRaises(BlockedError) as raised:
                _resolve_android_ndk_home({"ANDROID_HOME": str(sdk_root)})

        self.assertEqual(
            raised.exception.resource,
            "mobile-simulator:android-ndk-discovery",
        )

    def test_ambiguous_sdk_ndks_require_explicit_ndk_home(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            sdk_root = Path(directory) / "sdk"
            _write_valid_ndk(sdk_root / "ndk" / "26.0.0")
            _write_valid_ndk(sdk_root / "ndk" / "27.0.0")

            with self.assertRaises(BlockedError) as raised:
                _resolve_android_ndk_home({"ANDROID_HOME": str(sdk_root)})

        self.assertEqual(
            raised.exception.resource,
            "mobile-simulator:android-ndk-discovery",
        )

    def test_ndk_tool_resolution_requires_one_executable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            ndk_home = _write_valid_ndk(Path(directory) / "ndk")
            expected = (
                ndk_home
                / "toolchains"
                / "llvm"
                / "prebuilt"
                / "test-host"
                / "bin"
                / "llvm-ranlib"
            )

            resolved = _resolve_android_ndk_tool(
                str(ndk_home),
                "llvm-ranlib",
            )

            self.assertEqual(resolved, str(expected))

    def test_android_manifest_guard_restores_generated_whitespace(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manifest = Path(directory) / "AndroidManifest.xml"
            baseline = (
                "<activity>\n"
                f"  {mobile_simulator_module.ANDROID_DEEP_LINK_MARKER}\n"
                "  <data android:path=\"/callback\" />\n"
                f"  {mobile_simulator_module.ANDROID_DEEP_LINK_MARKER}\n"
                "</activity>\n"
            ).encode()
            manifest.write_bytes(baseline)
            guard = _GeneratedAndroidManifestGuard(manifest)
            manifest.write_bytes(
                baseline.replace(
                    b'  <data android:path="/callback" />\n',
                    b'  <data android:path="/callback" />\n  \n  \n',
                )
            )

            guard.restore()

            self.assertEqual(manifest.read_bytes(), baseline)

    def test_android_manifest_guard_rejects_semantic_mutation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manifest = Path(directory) / "AndroidManifest.xml"
            baseline = (
                "<activity>\n"
                f"  {mobile_simulator_module.ANDROID_DEEP_LINK_MARKER}\n"
                "  <data android:scheme=\"peers-touch\" />\n"
                f"  {mobile_simulator_module.ANDROID_DEEP_LINK_MARKER}\n"
                "</activity>\n"
            ).encode()
            manifest.write_bytes(baseline)
            guard = _GeneratedAndroidManifestGuard(manifest)
            changed = baseline.replace(b"peers-touch", b"other-scheme")
            manifest.write_bytes(changed)

            with self.assertRaises(ProvisioningError):
                guard.restore()

            self.assertEqual(manifest.read_bytes(), changed)

    def test_provisioner_does_not_own_gate_or_session_execution(self) -> None:
        self.assertFalse(
            hasattr(mobile_simulator_module, "run_simulator_gate")
        )
        self.assertFalse(hasattr(mobile_simulator_module, "_manifest_object"))
        self.assertFalse(hasattr(mobile_simulator_module, "AppiumSession"))


class MobileStationLifecycleSimulatorProvisionerTests(unittest.TestCase):
    def test_lifecycle_projector_keeps_scope_and_digests_nested_device_ids(
        self,
    ) -> None:
        scope = {"deviceId": "device-one", "group": {}}
        self.assertIs(
            MobileStationLifecycleSimulatorProvisioner
            ._project_lifecycle_harness_result(
                "lifecycle.scope.read",
                scope,
            ),
            scope,
        )

        projected = (
            MobileStationLifecycleSimulatorProvisioner
            ._project_lifecycle_harness_result(
                "session.logout",
                {
                    "runtime": {"deviceId": "device-one"},
                    "winningDeviceId": "device-two",
                },
            )
        )

        self.assertEqual(
            projected,
            {
                "runtime": {
                    "deviceIdentityDigest": hashlib.sha256(
                        b"device-one"
                    ).hexdigest(),
                },
                "winningDeviceIdentityDigest": hashlib.sha256(
                    b"device-two"
                ).hexdigest(),
            },
        )

    def setUp(self) -> None:
        self.contract_path = (
            ENVIRONMENTS_DIR / "mobile-station-lifecycle-simulator.yaml"
        )
        self.contract = EnvironmentContract.from_yaml(self.contract_path)
        self.evidence_run = FakeEvidenceRun()

    def _attestation(self, service_id: str) -> ServiceAttestation:
        return ServiceAttestation(
            service_id=service_id,
            service_kind="station",
            environment_id=STATION_LIFECYCLE_ENVIRONMENT_ID,
            deployment_environment=f"deploy-{service_id}",
            endpoint=f"https://{service_id}.example",
            live_commit="a" * 40,
            workspace_digest="clean",
            protocol_digest="b" * 64,
            artifact_ref=ArtifactRef(
                workspace_id="a" * 16,
                gate_id="mobile-simulator-station-lifecycle-e2e",
                run_id=self.evidence_run.run_id,
                path=f"runtime/services/{service_id}/attestation.json",
                sha256="c" * 64,
                media_type="application/json",
            ).to_dict(),
            produced_at="2026-09-09T00:00:00+00:00",
            producer="station-deployment",
            runtime_identity=(
                "peer-primary"
                if service_id == "station-primary"
                else "peer-secondary"
            ),
        )

    def _base_manifest(self) -> object:
        return _with_simulator_resources(
            dataclasses.replace(
                new_manifest(
                    environment_id="mobile-simulator",
                    gate_id="mobile-simulator-station-lifecycle-e2e",
                    requested_profile="mobile-simulator",
                    resolved_profile="mobile-simulator",
                    slot=0,
                    commit="a" * 40,
                    worktree="/tmp/worktree",
                    workspace_digest="dirty:test",
                ),
                state=ProvisioningState.FIXTURE_READY,
                clients=(
                    ClientRuntime(
                        actor="simulator",
                        runtime="tauri-ios-simulator",
                        worktree="/tmp/worktree",
                        gateway_port=1,
                        renderer_port=2,
                        webdriver_port=3,
                        profile="sim-ios",
                        storage_root="/tmp/sim-ios",
                    ),
                    ClientRuntime(
                        actor="peer-simulator",
                        runtime="tauri-ios-simulator",
                        worktree="/tmp/worktree",
                        gateway_port=4,
                        renderer_port=5,
                        webdriver_port=6,
                        profile="sim-ios-peer",
                        storage_root="/tmp/sim-ios-peer",
                    ),
                ),
            ),
            {
                "appium": {
                    "serverUrl": "http://127.0.0.1:4723",
                    "serverVersion": "2.19.0",
                    "expectedServerVersion": "2.19.0",
                    "drivers": {
                        "ios": {
                            "identity": "appium-xcuitest-driver",
                            "automationName": "XCUITest",
                            "version": "9.10.5",
                            "expectedVersion": "9.10.5",
                        },
                    },
                },
                "applications": {
                    "ios": {
                        "artifact": "/tmp/mobile.app",
                        "sha256": "d" * 64,
                        "id": "com.peers.touch.mobile",
                        "callbackScheme": "peers-touch",
                    },
                },
                "clients": {
                    "sim-ios": {
                        "platform": "ios",
                        "role": "simulator",
                        "runtime": "tauri-ios-simulator",
                        "deviceRole": "simulator",
                        "profile": "sim-ios",
                        "device": "raw-ios-udid",
                        "ports": {
                            "wda-local": 8101,
                            "mjpeg": 9101,
                            "webview": 9511,
                        },
                    },
                    "sim-ios-peer": {
                        "platform": "ios",
                        "role": "peer-simulator",
                        "runtime": "tauri-ios-simulator",
                        "deviceRole": "peer-simulator",
                        "profile": "sim-ios-peer",
                        "device": "raw-ios-peer-udid",
                        "ports": {
                            "wda-local": 8102,
                            "mjpeg": 9201,
                            "webview": 9512,
                        },
                    },
                },
                "harness": {},
                "proofScope": {},
            },
        )

    @staticmethod
    def _service_environment() -> dict[str, str]:
        return {
            "PT_MOBILE_STATION_PRIMARY_URL": (
                "https://station-primary.example"
            ),
            "PT_MOBILE_STATION_PRIMARY_DEPLOY_ENV": "deploy-primary",
            "PT_MOBILE_STATION_SECONDARY_URL": (
                "https://station-secondary.example"
            ),
            "PT_MOBILE_STATION_SECONDARY_DEPLOY_ENV": "deploy-secondary",
        }

    def test_service_attestation_uses_remote_source_owner(self) -> None:
        provisioner = MobileStationLifecycleSimulatorProvisioner(
            self.contract,
        )
        bindings = resolve_mobile_service_bindings(
            self.contract,
            self.contract_path,
            environment=self._service_environment(),
        )

        with (
            patch.object(provisioner, "_station_ready", return_value=True),
            patch(
                "tooling.acceptance.provisioners.mobile_simulator."
                "produce_station_attestation",
                side_effect=lambda **kwargs: self._attestation(
                    kwargs["service_id"]
                ),
            ) as producer,
        ):
            services = provisioner._attest_services("run-id", bindings)

        self.assertEqual(
            set(services),
            {"station-primary", "station-secondary"},
        )
        for call in producer.call_args_list:
            self.assertIs(
                call.kwargs["remote_source_identity_provider"],
                mobile_simulator_module.resolve_remote_source_identity,
            )

    def test_preflight_attests_both_targets_before_authorization_block(
        self,
    ) -> None:
        events: list[str] = []

        class Base:
            def __init__(self, _contract: EnvironmentContract) -> None:
                events.append("base-created")

        provisioner = MobileStationLifecycleSimulatorProvisioner(
            self.contract,
            base_factory=Base,
        )
        provisioner.bind_evidence_run(self.evidence_run)  # type: ignore[arg-type]

        def verify_target(_url: str, deployment: str) -> None:
            events.append(f"target:{deployment}")

        with (
            patch.dict(
                "os.environ",
                {
                    **self._service_environment(),
                    "MOBILE_ACCEPTANCE_RESET": "",
                },
                clear=False,
            ),
            patch.object(
                provisioner,
                "acquire_profile_lease",
                side_effect=lambda resource, _owner: events.append(
                    f"profile-lease:{resource}"
                ),
            ),
            patch.object(
                provisioner,
                "acquire_remote_git_source_lease",
                side_effect=lambda resource, _owner: events.append(
                    f"source-lease:{resource}"
                ),
            ),
            patch(
                "tooling.acceptance.provisioners.mobile_simulator."
                "verify_reset_target",
                side_effect=verify_target,
            ),
            patch.object(
                provisioner,
                "_attest_services",
                side_effect=lambda *_: (
                    events.append("source-attest")
                    or {
                        service_id: self._attestation(service_id)
                        for service_id in (
                            "station-primary",
                            "station-secondary",
                        )
                    }
                ),
            ),
        ):
            manifest = provisioner.provision(
                "mobile-simulator-station-lifecycle-e2e"
            )

        self.assertEqual(manifest.state, ProvisioningState.BLOCKED)
        self.assertEqual(
            manifest.blocked_resource,
            "fixture-authorization:MOBILE_ACCEPTANCE_RESET",
        )
        blocked_payload = manifest.to_dict()
        self.assertEqual(
            set(blocked_payload["services"]),
            {"station-primary", "station-secondary"},
        )
        self.assertEqual(
            blocked_payload["profile"]["resolvedName"],
            STATION_LIFECYCLE_ENVIRONMENT_ID,
        )
        self.assertTrue(blocked_payload["cleanup"]["registered"])
        self.assertEqual(
            events,
            [
                "profile-lease:deploy-primary",
                "source-lease:deploy-primary",
                "profile-lease:deploy-secondary",
                "source-lease:deploy-secondary",
                "target:deploy-primary",
                "target:deploy-secondary",
                "source-attest",
            ],
        )
        self.assertNotIn("base-created", events)

    def test_runtime_binding_rejects_duplicate_station_targets(self) -> None:
        environment = self._service_environment()
        environment["PT_MOBILE_STATION_SECONDARY_URL"] = environment[
            "PT_MOBILE_STATION_PRIMARY_URL"
        ]

        with self.assertRaises(BlockedError) as raised, patch.dict(
            "os.environ",
            environment,
            clear=True,
        ):
            resolve_mobile_service_bindings(
                self.contract,
                self.contract_path,
            )

        self.assertEqual(
            raised.exception.resource,
            "service-binding:mobile-station-lifecycle-simulator:"
            "duplicate-endpoint",
        )

    def test_composes_base_resets_only_alice_and_cleans_up_in_reverse(
        self,
    ) -> None:
        events: list[str] = []
        base_manifest = self._base_manifest()

        class Base:
            def __init__(self, _contract: EnvironmentContract) -> None:
                self.evidence_run = None

            def bind_evidence_run(self, run: object) -> None:
                self.evidence_run = run

            def provision(self, _gate_id: str) -> object:
                events.append("base-provision")
                return base_manifest

            @staticmethod
            def cleanup() -> tuple[str, ...]:
                events.append("base-cleanup")
                return ()

        provisioner = MobileStationLifecycleSimulatorProvisioner(
            self.contract,
            base_factory=Base,
        )
        provisioner.bind_evidence_run(self.evidence_run)  # type: ignore[arg-type]

        def acquire_profile(resource: str, _owner: str) -> None:
            provisioner.register_cleanup(
                f"profile:{resource}",
                lambda resource=resource: events.append(
                    f"release-profile:{resource}"
                ),
            )

        def acquire_source(resource: str, _owner: str) -> None:
            provisioner.register_cleanup(
                f"source:{resource}",
                lambda resource=resource: events.append(
                    f"release-source:{resource}"
                ),
            )

        reset_calls: list[tuple[str, tuple[str, ...]]] = []

        def reset(
            deployment: str,
            actors: tuple[str, ...],
            *,
            reset_authorized: bool,
        ) -> None:
            self.assertTrue(reset_authorized)
            reset_calls.append((deployment, actors))

        services = {
            service_id: self._attestation(service_id)
            for service_id in ("station-primary", "station-secondary")
        }
        with (
            patch.dict(
                "os.environ",
                {
                    **self._service_environment(),
                    "MOBILE_ACCEPTANCE_RESET": "1",
                },
                clear=False,
            ),
            patch.object(
                provisioner,
                "acquire_profile_lease",
                side_effect=acquire_profile,
            ),
            patch.object(
                provisioner,
                "acquire_remote_git_source_lease",
                side_effect=acquire_source,
            ),
            patch.object(
                provisioner,
                "_attest_services",
                return_value=services,
            ),
            patch(
                "tooling.acceptance.provisioners.mobile_simulator."
                "verify_reset_target",
            ),
            patch(
                "tooling.acceptance.provisioners.mobile_simulator."
                "reset_fixture",
                side_effect=reset,
            ),
            patch(
                "tooling.acceptance.provisioners.mobile_simulator."
                "resolve_actor_identity",
                return_value=SimpleNamespace(
                    role="alice",
                    account_ref="station-account:alice@p.t",
                    ptid="ptid:alice",
                    device_policy="single-active-session",
                    federated_handle="@alice@station.example",
                    home_station_peer_id="station-alice",
                ),
            ) as resolve_actor,
        ):
            manifest = provisioner.provision(
                "mobile-simulator-station-lifecycle-e2e"
            )
            context = provisioner.create_gate_launch_context(
                gate_id="mobile-simulator-station-lifecycle-e2e",
                evidence_run_id=self.evidence_run.run_id,
                provisioning_run_id=manifest.run_id,
                required_capabilities=(SIMULATOR_APPIUM_CAPABILITY_ID,),
            )
            context.quiesce()
            context_cleanup = context.close()
            setup_resets = list(reset_calls)
            completed = provisioner.cleanup()

        self.assertEqual(manifest.state, ProvisioningState.FIXTURE_READY)
        self.assertTrue(context_cleanup.succeeded)
        payload = manifest.to_dict()
        self.assertNotEqual(
            manifest.run_id,
            getattr(base_manifest, "run_id"),
        )
        self.assertEqual(
            set(payload["services"]),
            {"station-primary", "station-secondary"},
        )
        self.assertNotIn("relay", payload["services"])
        self.assertEqual(
            {
                client["id"]: tuple(client["required_service_roles"])
                for client in payload["clients"]
            },
            {
                "sim-ios": (
                    "station-primary",
                    "station-secondary",
                ),
                "sim-ios-peer": ("station-primary",),
            },
        )
        self.assertEqual(
            setup_resets,
            [
                ("deploy-primary", ("alice",)),
                ("deploy-secondary", ("alice",)),
            ],
        )
        self.assertEqual(
            resolve_actor.call_args_list,
            [
                call(
                    "https://station-primary.example",
                    "deploy-primary",
                    "alice",
                ),
                call(
                    "https://station-secondary.example",
                    "deploy-secondary",
                    "alice",
                ),
            ],
        )
        resources = payload["mobileSimulator"]
        self.assertNotIn("serverUrl", resources["appium"])
        self.assertNotIn("artifact", resources["applications"]["ios"])
        self.assertNotIn("device", resources["clients"]["sim-ios"])
        self.assertNotIn("device", resources["clients"]["sim-ios-peer"])
        self.assertEqual(
            completed[:4],
            (
                "appium-sessions",
                "actor-fixture:station-secondary",
                "actor-fixture:station-primary",
                "mobile-simulator-base",
            ),
        )
        self.assertEqual(
            completed[-4:],
            (
                "source:deploy-secondary",
                "profile:deploy-secondary",
                "source:deploy-primary",
                "profile:deploy-primary",
            ),
        )
        self.assertLess(
            events.index("base-cleanup"),
            events.index("release-source:deploy-secondary"),
        )

    def test_parent_create_bound_session_resolves_topology_and_emits_proof(
        self,
    ) -> None:
        services = {
            service_id: self._attestation(service_id)
            for service_id in ("station-primary", "station-secondary")
        }
        manifest = dataclasses.replace(
            new_manifest(
                environment_id=STATION_LIFECYCLE_ENVIRONMENT_ID,
                gate_id="mobile-simulator-station-lifecycle-e2e",
                requested_profile="profile",
                resolved_profile="profile",
                slot=7,
                commit="a" * 40,
                worktree="/tmp/worktree",
                workspace_digest="dirty:test",
            ),
            state=ProvisioningState.FIXTURE_READY,
            services=services,
            clients=(
                ClientRuntime(
                    id="sim-ios",
                    actor="alice",
                    runtime="tauri-ios-simulator",
                    required_service_roles=(
                        "station-primary",
                        "station-secondary",
                    ),
                    service_bindings=self.contract.clients[
                        0
                    ].service_bindings,
                    worktree="/tmp/worktree",
                    gateway_port=1,
                    renderer_port=2,
                    webdriver_port=3,
                    profile="sim-ios",
                    storage_root="/tmp/sim-ios",
                ),
                ClientRuntime(
                    id="sim-ios-peer",
                    actor="alice",
                    runtime="tauri-ios-simulator",
                    required_service_roles=("station-primary",),
                    service_bindings=self.contract.clients[
                        1
                    ].service_bindings,
                    worktree="/tmp/worktree",
                    gateway_port=4,
                    renderer_port=5,
                    webdriver_port=6,
                    profile="sim-ios-peer",
                    storage_root="/tmp/sim-ios-peer",
                ),
            ),
        ).to_dict()
        sessions: dict[str, FakeParentSimulatorSession] = {}
        handler = MobileSimulatorAppiumCapabilityHandler(
            manifest=manifest,
            artifact_writer=self.evidence_run,
            session_factory=lambda client_id: sessions.setdefault(
                client_id,
                FakeParentSimulatorSession(client_id),
            ),
            harness_actions=tuple(STATION_LIFECYCLE_HARNESS_ACTIONS),
            sensitive_values=(
                "https://station-primary.example",
                "https://station-secondary.example",
                "raw-device-sim-ios",
                "raw-session-sim-ios",
            ),
            verifier_source_digest="d" * 64,
        )
        cancellation = threading.Event()

        first = handler.invoke(
            "create_bound_session",
            {
                "clientId": "sim-ios",
                "launchOptions": {},
            },
            deadline_monotonic=time.monotonic() + 5,
            cancellation=cancellation,
        )
        second = handler.invoke(
            "select_binding",
            {
                "clientId": "sim-ios",
                "bindingRole": "station-secondary",
            },
            deadline_monotonic=time.monotonic() + 5,
            cancellation=cancellation,
        )
        authenticated = handler.invoke(
            "authenticate_fixture_actor",
            {"clientId": "sim-ios"},
            deadline_monotonic=time.monotonic() + 5,
            cancellation=cancellation,
        )
        cleaned = handler.invoke(
            "harness_action",
            {
                "clientId": "sim-ios",
                "action": "cleanup",
                "actionPayload": {},
            },
            deadline_monotonic=time.monotonic() + 5,
            cancellation=cancellation,
        )

        session = sessions["sim-ios"]
        station_calls = [
            (action, payload)
            for action, payload in session.calls
            if action in {"station.add", "station.select"}
        ]
        self.assertEqual(
            station_calls,
            [
                (
                    "station.add",
                    {"url": "https://station-primary.example"},
                ),
                (
                    "station.add",
                    {"url": "https://station-secondary.example"},
                ),
                (
                    "station.select",
                    {"stationPeerId": "peer-primary"},
                ),
                (
                    "station.select",
                    {"stationPeerId": "peer-secondary"},
                ),
            ],
        )
        self.assertEqual(first["launchGeneration"], 1)
        self.assertEqual(second["launchGeneration"], 1)
        self.assertEqual(
            set(first["bindingProofs"]),
            {"station-primary", "station-secondary"},
        )
        serialized = json.dumps(first, sort_keys=True)
        self.assertNotIn("https://station-primary.example", serialized)
        self.assertNotIn("raw-device-sim-ios", serialized)
        self.assertNotIn("raw-session-sim-ios", serialized)
        serialized_authentication = json.dumps(
            authenticated,
            sort_keys=True,
        )
        self.assertNotIn("password", serialized_authentication.lower())
        self.assertNotIn("email", serialized_authentication.lower())
        self.assertEqual(
            authenticated["value"]["login"]["session"]["actorPtid"],
            "ptid:alice",
        )
        self.assertEqual(
            cleaned["value"]["oauthPurge"]["secureStorage"],
            {
                "activeAttemptIndexAbsent": True,
                "attemptSecretRecordAbsent": True,
                "currentSessionIndexAbsent": True,
                "credentialRecordAbsent": True,
                "publicProjectionAbsent": True,
            },
        )
        proofs = [
            value
            for _path, value, role in self.evidence_run.writes
            if role and role.startswith("mobile-simulator-binding-proof/")
        ]
        self.assertEqual(len(proofs), 2)
        self.assertTrue(
            all(proof["verificationStatus"] == "VERIFIED" for proof in proofs)
        )
        self.assertEqual(
            {proof["declaredServiceId"] for proof in proofs},
            {"station-primary", "station-secondary"},
        )
        handler.project_response(
            "create_bound_session",
            {
                "requestId": "request",
                "status": "OK",
                "result": first,
                "error": None,
            },
        )
        handler.project_response(
            "harness_action",
            {
                "requestId": "cleanup-request",
                "status": "OK",
                "result": cleaned,
                "error": None,
            },
        )
        with self.assertRaisesRegex(ValueError, "raw authority"):
            handler.project_response(
                "harness_action",
                {
                    "requestId": "unsafe-request",
                    "status": "OK",
                    "result": {
                        "clientId": "sim-ios",
                        "value": {"deviceId": "unscoped-device"},
                    },
                    "error": None,
                },
            )
        self.assertTrue(handler.close().closed)


class MobileSimulatorProvisionerTests(unittest.TestCase):
    driver_bytes = b"synthetic chromedriver executable\n"
    driver_version = "124.0.6367.82"

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.repo_root = self.root / "repo"
        self.repo_root.mkdir()
        self.android_manifest = (
            self.repo_root / ANDROID_MANIFEST_RELATIVE_PATH
        )
        self.android_manifest.parent.mkdir(parents=True)
        self.android_manifest_baseline = (
            "<activity>\n"
            f"  {mobile_simulator_module.ANDROID_DEEP_LINK_MARKER}\n"
            '  <data android:path="/callback" />\n'
            f"  {mobile_simulator_module.ANDROID_DEEP_LINK_MARKER}\n"
            "</activity>\n"
        )
        self.android_manifest.write_text(
            self.android_manifest_baseline,
            encoding="utf-8",
        )
        self.ndk_home = _write_valid_ndk(
            self.root / "android-sdk" / "ndk" / "27.0.11902837"
        )
        self.environment = patch.dict(
            "os.environ",
            {
                "ANDROID_HOME": str(self.root / "android-sdk"),
                "ANDROID_SDK_ROOT": str(self.root / "android-sdk"),
                "NDK_HOME": str(self.ndk_home),
            },
            clear=False,
        )
        self.environment.start()
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
        self.environment.stop()
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
            {"tauri-ios-simulator"},
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
        self.assertEqual(set(resources["appium"]["drivers"]), {"ios"})
        self.assertEqual(
            set(resources["clients"]),
            {"sim-ios", "sim-ios-peer"},
        )
        self.assertEqual(
            resources["clients"]["sim-ios"]["deviceRole"],
            "primary-simulator",
        )
        self.assertEqual(
            resources["clients"]["sim-ios-peer"]["deviceRole"],
            "peer-simulator",
        )
        self.assertNotIn("chromedriver", resources)
        self.assertNotEqual(
            resources["clients"]["sim-ios"]["device"],
            resources["clients"]["sim-ios-peer"]["device"],
        )
        for client_id in ("sim-ios", "sim-ios-peer"):
            udid = resources["clients"][client_id]["device"]
            uninstall = (
                "xcrun",
                "simctl",
                "uninstall",
                udid,
                "com.peers.touch.mobile",
            )
            install = (
                "xcrun",
                "simctl",
                "install",
                udid,
                resources["applications"]["ios"]["artifact"],
            )
            self.assertLess(
                self.executor.commands.index(uninstall),
                self.executor.commands.index(install),
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
        self.assertEqual(
            self.android_manifest.read_text(encoding="utf-8"),
            self.android_manifest_baseline,
        )
        ios_assets = (
            self.repo_root
            / "apps"
            / "mobile"
            / "src-tauri"
            / "gen"
            / "apple"
            / "assets"
        )
        self.assertEqual(
            (ios_assets / "index.html").read_text(encoding="utf-8"),
            "fresh-mobile-web-bundle\n",
        )
        self.assertTrue((ios_assets / "assets" / "main.js").is_file())
        self.assertEqual(self.fetches, [])
        self.assertEqual(
            self.executor.ios_asset_payloads,
            ["fresh-mobile-web-bundle\n"],
        )
        self.assertTrue(
            (self.repo_root / IOS_WEB_ASSETS_RELATIVE_PATH / "index.html").is_file()
        )

        self.assertEqual(set(resources["applications"]), {"ios"})
        application = resources["applications"]["ios"]
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
            self.assertEqual(session.chromedriver_executable, "")

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
        ios_assets = (
            self.repo_root
            / "apps"
            / "mobile"
            / "src-tauri"
            / "gen"
            / "apple"
            / "assets"
        )

        completed = self.provisioner.cleanup()

        self.assertFalse(runtime_root.exists())
        self.assertFalse(
            (self.repo_root / IOS_WEB_ASSETS_RELATIVE_PATH).exists()
        )
        self.assertLess(
            completed.index("appium-process"),
            completed.index(
                "application-uninstall:ios:ios-peer-simulator-udid:"
                "com.peers.touch.mobile"
            ),
        )
        self.assertLess(
            completed.index(
                "application-uninstall:ios:ios-peer-simulator-udid:"
                "com.peers.touch.mobile"
            ),
            completed.index("simulator-shutdown:ios-peer-simulator-udid"),
        )
        self.assertLess(
            completed.index("simulator-shutdown:ios-peer-simulator-udid"),
            completed.index("simulator-shutdown:ios-simulator-udid"),
        )
        self.assertEqual(
            completed[-1],
            "environment-lease:mobile-simulator",
        )
        self.assertIn("stop:appium", self.executor.events)
        self.assertNotIn("stop:emulator", self.executor.events)

    def test_cleanup_restores_preexisting_generated_apple_assets(self) -> None:
        assets = self.repo_root / IOS_WEB_ASSETS_RELATIVE_PATH
        assets.mkdir(parents=True)
        (assets / "legacy.txt").write_text("preserve-me\n", encoding="utf-8")

        self.provisioner.provision("mobile-simulator-access-e2e")

        self.assertFalse((assets / "legacy.txt").exists())
        self.assertEqual(
            (assets / "index.html").read_text(encoding="utf-8"),
            "fresh-mobile-web-bundle\n",
        )

        self.provisioner.cleanup()

        self.assertEqual(
            (assets / "legacy.txt").read_text(encoding="utf-8"),
            "preserve-me\n",
        )
        self.assertFalse((assets / "index.html").exists())

    def test_missing_android_toolchain_does_not_block_dual_ios(
        self,
    ) -> None:
        with patch.dict(
            "os.environ",
            {
                "NDK_HOME": "",
                "ANDROID_HOME": "",
                "ANDROID_SDK_ROOT": "",
            },
            clear=False,
        ):
            manifest = self.provisioner.provision(
                "mobile-simulator-access-e2e"
            )

        self.assertNotEqual(manifest.state, ProvisioningState.BLOCKED)
        self.assertEqual(
            {client.profile for client in manifest.clients},
            {"sim-ios", "sim-ios-peer"},
        )

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

    def test_absent_chromedriver_does_not_block_required_ios(self) -> None:
        self._write_cached_driver(self.driver_bytes).unlink()
        self.contract_payload["appium"]["chromedriver"]["acquisition"][
            "enabled"
        ] = False
        self._write_contract()
        self.provisioner = self._new_provisioner()

        manifest = self.provisioner.provision(
            "mobile-simulator-access-e2e"
        )

        self.assertEqual(manifest.state, ProvisioningState.FIXTURE_READY)
        self.assertNotIn("chromedriver", manifest.to_dict()["mobileSimulator"])
        self.assertEqual(self.fetches, [])
        self.provisioner.cleanup()

    def test_contract_without_browser_major_does_not_block_required_ios(
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

        self.assertEqual(manifest.state, ProvisioningState.FIXTURE_READY)
        self.assertNotIn("chromedriver", manifest.to_dict()["mobileSimulator"])
        self.provisioner.cleanup()

    def test_chromedriver_checksum_does_not_block_required_ios(self) -> None:
        self._write_cached_driver(b"tampered")

        manifest = self.provisioner.provision(
            "mobile-simulator-access-e2e"
        )

        self.assertEqual(manifest.state, ProvisioningState.FIXTURE_READY)
        self.assertNotIn("chromedriver", manifest.to_dict()["mobileSimulator"])
        self.provisioner.cleanup()

    def test_chromedriver_acquisition_is_not_run_for_required_ios(
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
        self.assertNotIn("chromedriver", resources)
        self.assertEqual(self.fetches, [])
        self.assertFalse(
            any(
                self.repo_root == path or self.repo_root in path.parents
                for path in self.cache_root.rglob("*")
            )
        )
        self.provisioner.cleanup()

    def test_browser_major_does_not_block_required_ios(self) -> None:
        self.executor.browser_versions["com.google.android.webview"] = (
            "125.0.6422.0"
        )

        manifest = self.provisioner.provision(
            "mobile-simulator-access-e2e"
        )

        self.assertEqual(manifest.state, ProvisioningState.FIXTURE_READY)
        self.assertNotIn("chromedriver", manifest.to_dict()["mobileSimulator"])
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

    def test_unsupported_emulator_abi_does_not_block_required_ios(self) -> None:
        artifact = self.contract_payload["appium"]["chromedriver"][
            "artifacts"
        ][0]
        artifact["android_abis"] = ["x86_64"]
        self._write_contract()
        self.provisioner = self._new_provisioner()

        manifest = self.provisioner.provision(
            "mobile-simulator-access-e2e"
        )

        self.assertEqual(manifest.state, ProvisioningState.FIXTURE_READY)
        self.assertNotIn("chromedriver", manifest.to_dict()["mobileSimulator"])
        self.provisioner.cleanup()

    def test_secure_content_provisioner_owns_selected_platform_clients(
        self,
    ) -> None:
        runtime_source_commit = "1" * 40
        clients = (
            mobile_simulator_module.SimulatorClientSpec(
                id="ios_alice",
                platform="ios",
                role="alice",
                runtime="tauri-ios-simulator",
                port_roles=("wda-local", "mjpeg", "webview"),
                storage_root="<runtime-home>/ios-alice",
            ),
            mobile_simulator_module.SimulatorClientSpec(
                id="android_bob",
                platform="android",
                role="bob",
                runtime="tauri-android-emulator",
                port_roles=("system", "mjpeg", "webview"),
                storage_root="<runtime-home>/android-bob",
            ),
        )
        provisioner = TestSelectedMobileSimulatorProvisioner(
            self.contract,
            clients=clients,
            runtime_source_commit=runtime_source_commit,
            executor=self.executor,
            repo_root=self.repo_root,
            runtime_base=self.root / "secure-content-runtime",
            runtime_cache_base=self.cache_root,
            contract_path=self.contract_path,
            artifact_fetcher=self._fetch_driver,
            status_reader=lambda url, timeout: {
                "value": {"build": {"version": "2.19.0"}}
            },
            sleep=lambda _: None,
        )

        manifest = provisioner.provision("sc-dj-mobile-matrix")

        self.assertEqual(manifest.state, ProvisioningState.FIXTURE_READY)
        payload = manifest.to_dict()
        resources = payload["mobileSimulator"]
        self.assertEqual(
            {client["profile"] for client in payload["clients"]},
            {"ios_alice", "android_bob"},
        )
        self.assertEqual(
            set(resources["applications"]),
            {"ios", "android"},
        )
        self.assertEqual(
            set(resources["appium"]["drivers"]),
            {"ios", "android"},
        )
        build_identities = [
            json.loads(environment["PT_MOBILE_BUILD_IDENTITY_JSON"])
            for environment in self.executor.environments
            if "PT_MOBILE_BUILD_IDENTITY_JSON" in environment
        ]
        self.assertEqual(
            [identity["platform"] for identity in build_identities],
            ["android", "android", "ios", "ios"],
        )
        self.assertEqual(build_identities[0], build_identities[1])
        self.assertEqual(build_identities[2], build_identities[3])
        self.assertNotEqual(build_identities[0], build_identities[2])
        self.assertTrue(
            all(
                identity["sourceCommit"] == runtime_source_commit
                and identity["workspaceState"] == "clean"
                and identity["workspaceDigest"] == "clean"
                and identity["harnessEnabled"] is True
                for identity in build_identities
            )
        )
        self.assertEqual(
            {
                platform: application["buildIdentity"]
                for platform, application in resources[
                    "applications"
                ].items()
            },
            {
                "android": build_identities[0],
                "ios": build_identities[2],
            },
        )
        self.assertNotEqual(
            resources["clients"]["ios_alice"]["device"],
            resources["clients"]["android_bob"]["device"],
        )
        self.assertNotEqual(
            resources["clients"]["ios_alice"]["storageRoot"],
            resources["clients"]["android_bob"]["storageRoot"],
        )

        completed = provisioner.cleanup()

        self.assertLess(
            completed.index("appium-process"),
            completed.index("storage:mobile-simulator"),
        )
        self.assertTrue(
            any(
                item.startswith("simulator-shutdown:ios_alice:")
                for item in completed
            )
        )
        self.assertTrue(
            any(
                item.startswith("emulator-process:android_bob:")
                for item in completed
            )
        )


class MobileIOSLayoutSimulatorProvisionerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.executor = FakeCommandExecutor(self.root)
        self.contract_path = (
            ENVIRONMENTS_DIR / "mobile-ios-layout-simulator.yaml"
        )
        self.contract = EnvironmentContract.from_yaml(self.contract_path)
        self.provisioner = FakeMobileIOSLayoutSimulatorProvisioner(
            self.contract,
            executor=self.executor,
            repo_root=self.root,
            runtime_base=self.root / "runtime",
            contract_path=self.contract_path,
            base_contract_path=ENVIRONMENTS_DIR / "mobile-simulator.yaml",
            status_reader=lambda url, timeout: {
                "value": {"build": {"version": "2.19.0"}}
            },
            sleep=lambda _: None,
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_registry_resolves_ios_layout_provisioner(self) -> None:
        self.assertIsInstance(
            get_provisioner(self.contract),
            MobileIOSLayoutSimulatorProvisioner,
        )

    def test_provision_emits_current_iphone_cell_without_android_resources(
        self,
    ) -> None:
        manifest = self.provisioner.provision(
            "mobile-ios-simulator-layout-accessibility-e2e"
        )

        self.assertEqual(manifest.state, ProvisioningState.FIXTURE_READY)
        payload = manifest.to_dict()
        resources = payload["mobileSimulator"]
        self.assertEqual(set(resources["applications"]), {"ios"})
        self.assertEqual(set(resources["appium"]["drivers"]), {"ios"})
        self.assertEqual(
            {
                client_id: (
                    client["deviceName"],
                    client["viewportRole"],
                )
                for client_id, client in resources["clients"].items()
            },
            IOS_LAYOUT_CLIENTS,
        )
        self.assertEqual(
            {
                client["runtime"]
                for client in payload["clients"]
            },
            {"tauri-ios-simulator"},
        )
        flattened = "\n".join(
            " ".join(command) for command in self.executor.commands
        )
        self.assertNotIn("emulator -list-avds", flattened)
        self.assertNotIn(" tauri android ", f" {flattened} ")
        self.assertNotIn("adb ", flattened)

        completed = self.provisioner.cleanup()
        self.assertEqual(
            sum(
                item.startswith("application-uninstall:ios:")
                for item in completed
            ),
            1,
        )
        self.assertIn(
            "simulator-shutdown:ios-simulator-udid",
            completed,
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
