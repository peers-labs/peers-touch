from __future__ import annotations

import json
import plistlib
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import yaml


MOBILE_ROOT = Path(__file__).resolve().parents[1]
TAURI_ROOT = MOBILE_ROOT / "src-tauri"
APPLE_ROOT = TAURI_ROOT / "gen" / "apple"
PROJECT_SPEC_PATH = APPLE_ROOT / "project.yml"
INFO_PLIST_PATH = APPLE_ROOT / "peers-touch-mobile_iOS" / "Info.plist"
PBX_PROJECT_PATH = (
    APPLE_ROOT / "peers-touch-mobile.xcodeproj" / "project.pbxproj"
)
SWIFT_PLUGIN_PATH = (
    TAURI_ROOT
    / "plugins"
    / "platform-permissions"
    / "ios"
    / "Sources"
    / "PlatformPermissionsPlugin.swift"
)
ANDROID_PLUGIN_PATH = (
    TAURI_ROOT
    / "plugins"
    / "platform-permissions"
    / "android"
    / "src"
    / "main"
    / "java"
    / "PlatformPermissionsPlugin.kt"
)
ANDROID_MANIFEST_PATH = (
    TAURI_ROOT
    / "plugins"
    / "platform-permissions"
    / "android"
    / "src"
    / "main"
    / "AndroidManifest.xml"
)
COMMANDS_MOD_PATH = TAURI_ROOT / "src" / "commands" / "mod.rs"
PLATFORM_COMMAND_PATH = TAURI_ROOT / "src" / "commands" / "platform_bridge.rs"
NATIVE_EVENT_COMMAND_PATH = TAURI_ROOT / "src" / "commands" / "native_events.rs"
NATIVE_EVENT_EMITTER_PATH = TAURI_ROOT / "src" / "platform" / "native_events.rs"
NATIVE_LIFECYCLE_BRIDGE_PATH = (
    MOBILE_ROOT / "src" / "runtimes" / "nativeLifecycleBridge.ts"
)
MOBILE_NATIVE_EVENT_BRIDGE_PATH = (
    MOBILE_ROOT / "src" / "runtimes" / "mobileNativeEventBridge.ts"
)
PUSH_BRIDGE_PATH = TAURI_ROOT / "src" / "platform" / "push_bridge.rs"
MEDIA_PICKER_PATH = TAURI_ROOT / "src" / "platform" / "media_picker.rs"
NOTIFICATION_PROTO_PATH = (
    MOBILE_ROOT.parent.parent
    / "model"
    / "domain"
    / "notification"
    / "notification.proto"
)
NOTIFICATION_HANDLER_PATH = (
    MOBILE_ROOT.parent.parent
    / "apps"
    / "station"
    / "app"
    / "subserver"
    / "notification"
    / "handler.go"
)


class IOSOAuthCallbackRegistrationTest(unittest.TestCase):
    def test_xcode_inputs_register_the_tauri_callback_scheme(self) -> None:
        tauri_config = json.loads(
            (TAURI_ROOT / "tauri.conf.json").read_text(encoding="utf-8")
        )
        mobile_links = tauri_config["plugins"]["deep-link"]["mobile"]
        self.assertEqual(
            mobile_links,
            [
                {
                    "scheme": ["peers-touch"],
                    "host": "oauth",
                    "path": ["/callback"],
                    "appLink": False,
                }
            ],
        )
        expected_schemes = mobile_links[0]["scheme"]

        project_spec = yaml.safe_load(
            PROJECT_SPEC_PATH.read_text(encoding="utf-8")
        )
        project_properties = project_spec["targets"][
            "peers-touch-mobile_iOS"
        ]["info"]["properties"]
        self.assertEqual(
            self._registered_schemes(project_properties),
            expected_schemes,
        )

        with INFO_PLIST_PATH.open("rb") as info_plist_file:
            info_plist = plistlib.load(info_plist_file)
        self.assertEqual(
            self._registered_schemes(info_plist),
            expected_schemes,
        )

        project_source = PBX_PROJECT_PATH.read_text(encoding="utf-8")
        self.assertIn(
            'INFOPLIST_FILE = "peers-touch-mobile_iOS/Info.plist";',
            project_source,
        )

    @staticmethod
    def _registered_schemes(properties: dict[str, object]) -> list[str]:
        url_types = properties.get("CFBundleURLTypes")
        if not isinstance(url_types, list):
            return []

        schemes: list[str] = []
        for url_type in url_types:
            if not isinstance(url_type, dict):
                continue
            registered = url_type.get("CFBundleURLSchemes")
            if isinstance(registered, list):
                schemes.extend(
                    scheme for scheme in registered if isinstance(scheme, str)
                )
        return schemes


class IOSProjectGenerationTest(unittest.TestCase):
    def test_committed_xcode_project_matches_current_inputs(self) -> None:
        xcodegen = shutil.which("xcodegen")
        self.assertIsNotNone(xcodegen, "xcodegen is required for iOS project checks")

        with tempfile.TemporaryDirectory(prefix="peers-ios-project-") as directory:
            temporary_root = Path(directory)
            temporary_tauri = temporary_root / "src-tauri"
            temporary_apple = temporary_tauri / "gen" / "apple"
            temporary_apple.mkdir(parents=True)

            shutil.copytree(TAURI_ROOT / "src", temporary_tauri / "src")
            for empty_directory in sorted(
                (
                    path
                    for path in (temporary_tauri / "src").rglob("*")
                    if path.is_dir()
                ),
                reverse=True,
            ):
                try:
                    empty_directory.rmdir()
                except OSError:
                    pass

            for name in (
                "Sources",
                "Assets.xcassets",
                "peers-touch-mobile_iOS",
            ):
                shutil.copytree(APPLE_ROOT / name, temporary_apple / name)
            for name in ("project.yml", "LaunchScreen.storyboard"):
                shutil.copy2(APPLE_ROOT / name, temporary_apple / name)
            (temporary_apple / "assets").mkdir()
            (temporary_apple / "Externals").mkdir()

            subprocess.run(
                [xcodegen, "generate"],
                cwd=temporary_apple,
                check=True,
                capture_output=True,
                text=True,
            )

            generated_project = (
                temporary_apple
                / "peers-touch-mobile.xcodeproj"
                / "project.pbxproj"
            )
            self.assertEqual(
                generated_project.read_text(encoding="utf-8"),
                PBX_PROJECT_PATH.read_text(encoding="utf-8"),
            )


class IOSLimitedPhotoPermissionSourceContractTest(unittest.TestCase):
    def test_limited_photo_access_is_usable_and_not_requestable(self) -> None:
        swift_source = SWIFT_PLUGIN_PATH.read_text(encoding="utf-8")
        photo_status_mapping = swift_source.split(
            "private func mapPhotoStatus",
            maxsplit=1,
        )[1].split(
            "private func mapNotificationStatus",
            maxsplit=1,
        )[0]

        self.assertIn(
            "status == .limited {\n"
            "      return PermissionResponse(status: .granted, canRequest: false)",
            photo_status_mapping,
        )
        self.assertIn(
            "case .limited:\n"
            "      return PermissionResponse(status: .granted, canRequest: false)",
            photo_status_mapping,
        )
        self.assertNotIn(
            "PermissionResponse(status: .restricted, canRequest: true)",
            photo_status_mapping,
        )

    def test_android_selected_photo_access_is_usable_and_not_requestable(self) -> None:
        android_source = ANDROID_PLUGIN_PATH.read_text(encoding="utf-8")
        selected_photo_branch = android_source.split(
            "READ_MEDIA_VISUAL_USER_SELECTED",
            maxsplit=1,
        )[1].split(
            'return permissionSnapshot("storageMedia")',
            maxsplit=1,
        )[0]

        self.assertIn(
            "PermissionSnapshot(PermissionStatus.Granted, false)",
            selected_photo_branch,
        )
        self.assertNotIn(
            "PermissionSnapshot(PermissionStatus.Restricted, true)",
            selected_photo_branch,
        )


class NativeReadinessAndReconciliationSourceContractTest(unittest.TestCase):
    def test_native_network_start_acknowledges_after_initial_signal(self) -> None:
        swift_source = SWIFT_PLUGIN_PATH.read_text(encoding="utf-8")
        android_source = ANDROID_PLUGIN_PATH.read_text(encoding="utf-8")
        swift_emitter = swift_source.split(
            "private func emitNetworkSignal",
            maxsplit=1,
        )[1].split(
            "private func networkType",
            maxsplit=1,
        )[0]

        self.assertIn("pendingNetworkObservationInvokes.append(invoke)", swift_source)
        self.assertLess(
            swift_emitter.index("try trigger(networkEvent, data: signal)"),
            swift_emitter.index("networkObservationReady = true"),
        )
        self.assertLess(
            swift_emitter.index("networkObservationReady = true"),
            swift_emitter.index("invoke.resolve(signal)"),
        )
        self.assertIn("emitCurrentNetworkSignal(invoke::resolve)", android_source)
        self.assertLess(
            android_source.index("trigger(NETWORK_EVENT, payload)"),
            android_source.index("onEmitted(payload)"),
        )

    def test_ios_permission_request_state_returns_to_main_thread(self) -> None:
        swift_source = SWIFT_PLUGIN_PATH.read_text(encoding="utf-8")
        request_source = swift_source.split(
            "@objc public func request",
            maxsplit=1,
        )[1].split(
            "@objc public func startNetworkObservation",
            maxsplit=1,
        )[0]

        self.assertGreaterEqual(request_source.count("DispatchQueue.main.async"), 3)
        self.assertIn("self.permissionRequestInProgress = false", request_source)

    def test_reconciliation_counts_are_read_by_rust(self) -> None:
        command_source = PLATFORM_COMMAND_PATH.read_text(encoding="utf-8")
        handlers_source = COMMANDS_MOD_PATH.read_text(encoding="utf-8")

        self.assertIn("background_bridge::perform_reconciliation", command_source)
        self.assertNotIn("input.ledger_pending", command_source)
        self.assertNotIn("lifecycle_reconciliation_report", handlers_source)
        self.assertIn("platform_bridge::lifecycle_reconcile", handlers_source)


class IOSNativeNetworkSourceContractTest(unittest.TestCase):
    def test_network_observation_uses_nw_path_monitor_and_typed_ingress(self) -> None:
        swift_source = SWIFT_PLUGIN_PATH.read_text(encoding="utf-8")
        lifecycle_source = NATIVE_LIFECYCLE_BRIDGE_PATH.read_text(
            encoding="utf-8"
        )
        mobile_bridge_source = MOBILE_NATIVE_EVENT_BRIDGE_PATH.read_text(
            encoding="utf-8"
        )
        android_source = ANDROID_PLUGIN_PATH.read_text(encoding="utf-8")
        android_manifest = ANDROID_MANIFEST_PATH.read_text(encoding="utf-8")

        for token in (
            "import Network",
            "NWPathMonitor()",
            "startNetworkObservation",
            "pathUpdateHandler",
            "try trigger(networkEvent, data: signal)",
        ):
            self.assertIn(token, swift_source)
        for token in (
            "network_start_observation",
            "network_ingest_native_signal",
            "validateNativeNetworkSignal",
            "onNetworkStateChange",
        ):
            self.assertIn(token, lifecycle_source)
        for token in (
            "ConnectivityManager.NetworkCallback",
            "startNetworkObservation",
            "emitNetworkSignal",
            'payload.put("platform", "android")',
        ):
            self.assertIn(token, android_source)
        self.assertIn(
            "android.permission.ACCESS_NETWORK_STATE",
            android_manifest,
        )
        self.assertIn("nativeNetworkCallbacksAvailable", mobile_bridge_source)
        self.assertIn("browser-online", mobile_bridge_source)
        self.assertIn("addEventListener('online'", mobile_bridge_source)


class NativePushSchedulerAndPickerSourceContractTest(unittest.TestCase):
    def test_push_registration_is_ptid_device_bound_and_native_only(self) -> None:
        proto = NOTIFICATION_PROTO_PATH.read_text(encoding="utf-8")
        handler = NOTIFICATION_HANDLER_PATH.read_text(encoding="utf-8")
        rust = PUSH_BRIDGE_PATH.read_text(encoding="utf-8")
        mobile_bridge = MOBILE_NATIVE_EVENT_BRIDGE_PATH.read_text(encoding="utf-8")

        push_contract = proto.split(
            "// Mobile Push Registration",
            maxsplit=1,
        )[1]
        self.assertNotIn("actor_id", push_contract)
        for token in (
            "string actor_ptid",
            "string device_id",
            "oneof provider_binding",
            "bytes app_install_epoch_sha256",
            "bytes provider_binding_sha256",
        ):
            self.assertIn(token, push_contract)
        self.assertIn("serverwrapper.DeviceID()", handler)
        self.assertIn("req.DeviceId", handler)
        self.assertIn("authenticated_native_session", rust)
        self.assertIn("drain_push_callbacks", rust)
        self.assertNotIn("apnsTokenBase64", mobile_bridge)
        self.assertNotIn("fcmToken", mobile_bridge)
        self.assertNotIn("unifiedEndpoint", mobile_bridge)

    def test_scheduler_has_fixed_identity_and_exact_completion_owner(self) -> None:
        swift = SWIFT_PLUGIN_PATH.read_text(encoding="utf-8")
        android = ANDROID_PLUGIN_PATH.read_text(encoding="utf-8")
        rust = PUSH_BRIDGE_PATH.read_text(encoding="utf-8")
        with INFO_PLIST_PATH.open("rb") as info_plist_file:
            info_plist = plistlib.load(info_plist_file)

        identifiers = [
            "com.peers.touch.mobile.reconcile.v1.development",
            "com.peers.touch.mobile.reconcile.v1.production",
        ]
        self.assertEqual(
            info_plist["BGTaskSchedulerPermittedIdentifiers"],
            identifiers,
        )
        for identifier in identifiers:
            self.assertIn(identifier, swift)
            self.assertIn(identifier, android)
            self.assertIn(identifier, rust)
        self.assertIn("setTaskCompleted(success:", swift)
        self.assertIn("compareAndSet(false, true)", android)
        self.assertIn("complete_scheduled_callback", rust)
        self.assertNotIn("dispatchBusinessCommand", swift)
        self.assertNotIn("dispatchBusinessCommand", android)

    def test_picker_paths_terminate_in_rust_owned_opaque_staging(self) -> None:
        swift = SWIFT_PLUGIN_PATH.read_text(encoding="utf-8")
        android = ANDROID_PLUGIN_PATH.read_text(encoding="utf-8")
        rust = MEDIA_PICKER_PATH.read_text(encoding="utf-8")

        for source in (swift, android):
            self.assertIn("peers-touch-native-picker", source)
            self.assertIn('"selected"', source)
            self.assertIn('"cancelled"', source)
            self.assertIn('"permission_required"', source)
            self.assertIn('"expired"', source)
            self.assertIn('"failed"', source)
        self.assertIn('"native-media-staging"', rust)
        self.assertIn("sha256_base64", rust)
        self.assertIn("cleanup_native_items", rust)
        self.assertNotIn("local_path: item.local_path", rust)


class NativeEventInjectionBoundaryTest(unittest.TestCase):
    def test_synthetic_native_event_command_is_acceptance_only(self) -> None:
        commands_source = COMMANDS_MOD_PATH.read_text(encoding="utf-8")
        production_handlers, acceptance_handlers = commands_source.split(
            '#[cfg(feature = "acceptance-harness")]\n'
            "pub fn handlers",
            maxsplit=1,
        )

        self.assertNotIn("mobile_native_event_emit", production_handlers)
        self.assertIn("mobile_native_event_emit", acceptance_handlers)
        self.assertIn(
            '#[cfg(feature = "acceptance-harness")]\npub mod native_events;',
            commands_source,
        )

        command_source = NATIVE_EVENT_COMMAND_PATH.read_text(encoding="utf-8")
        self.assertTrue(
            command_source.startswith(
                '#![cfg(feature = "acceptance-harness")]'
            )
        )

        emitter_source = NATIVE_EVENT_EMITTER_PATH.read_text(encoding="utf-8")
        for function_name in (
            "emit_resume",
            "emit_push",
            "emit_notification_tap",
        ):
            self.assertIn(
                '#[cfg(feature = "acceptance-harness")]\n'
                f"pub fn {function_name}",
                emitter_source,
            )


if __name__ == "__main__":
    unittest.main()
