from __future__ import annotations

import unittest
from pathlib import Path

from tooling.acceptance.gates.mobile.android_host_e2e import runtime_blockers


REPO_ROOT = Path(__file__).resolve().parents[4]
KOTLIN = REPO_ROOT / (
    "apps/mobile/src-tauri/plugins/platform-permissions/android/src/main/java/"
    "PlatformPermissionsPlugin.kt"
)
PLUGIN_MANIFEST = REPO_ROOT / (
    "apps/mobile/src-tauri/plugins/platform-permissions/android/src/main/"
    "AndroidManifest.xml"
)
PLUGIN_GRADLE = REPO_ROOT / (
    "apps/mobile/src-tauri/plugins/platform-permissions/android/build.gradle.kts"
)
ROOT_GRADLE = REPO_ROOT / "apps/mobile/src-tauri/gen/android/build.gradle.kts"
APP_GRADLE = REPO_ROOT / "apps/mobile/src-tauri/gen/android/app/build.gradle.kts"
MOBILE_SHELL = REPO_ROOT / "apps/mobile/src/components/MobileShell.tsx"
NAVIGATION_STORE = REPO_ROOT / (
    "apps/mobile/src/app/navigation/navigationStore.ts"
)
PLATFORM_BRIDGE = REPO_ROOT / (
    "apps/mobile/src-tauri/src/commands/platform_bridge.rs"
)


class AndroidHostSourceContractTest(unittest.TestCase):
    def test_back_uses_tauri_host_event_and_typed_root_handoff(self) -> None:
        shell = MOBILE_SHELL.read_text(encoding="utf-8")
        navigation = NAVIGATION_STORE.read_text(encoding="utf-8")
        self.assertIn("subscribeSystemBack", shell)
        self.assertIn("state.overlayRoute", shell)
        self.assertIn("activeMobileDetailRoute(state)", shell)
        self.assertIn("kind: 'return_to_system'", shell)
        self.assertNotIn("android.", navigation)
        self.assertNotIn("onBackButtonPress", navigation)

    def test_fcm_service_and_generation_fenced_rust_ingress_exist(self) -> None:
        kotlin = KOTLIN.read_text(encoding="utf-8")
        manifest = PLUGIN_MANIFEST.read_text(encoding="utf-8")
        gradle = PLUGIN_GRADLE.read_text(encoding="utf-8")
        root_gradle = ROOT_GRADLE.read_text(encoding="utf-8")
        app_gradle = APP_GRADLE.read_text(encoding="utf-8")
        rust = PLATFORM_BRIDGE.read_text(encoding="utf-8")
        for token in (
            "class PeersFirebaseMessagingService : FirebaseMessagingService()",
            "override fun onNewToken",
            "override fun onMessageReceived",
            "ingestPushReceipt",
            "AndroidHostHandoff.enqueuePush",
        ):
            self.assertIn(token, kotlin)
        self.assertIn("com.google.firebase.MESSAGING_EVENT", manifest)
        self.assertIn("firebase-messaging", gradle)
        self.assertIn("com.google.gms:google-services", root_gradle)
        self.assertIn('file("google-services.json").isFile', app_gradle)
        self.assertIn('apply(plugin = "com.google.gms.google-services")', app_gradle)
        self.assertIn("capability_observe", rust)
        self.assertIn("system_action_execute", rust)

    def test_killed_process_and_full_resolution_media_are_durable(self) -> None:
        kotlin = KOTLIN.read_text(encoding="utf-8")
        worker = kotlin.split("class ReconcileWorker", maxsplit=1)[1].split(
            "private enum class PermissionKind",
            maxsplit=1,
        )[0]
        self.assertIn("ingestScheduledCallback", worker)
        self.assertNotIn("activeInstance", worker)
        self.assertIn("AndroidHostHandoff.enqueueScheduled", kotlin)
        self.assertIn("PENDING_SCHEDULED_WAKE", kotlin)
        self.assertIn("materializeScheduledWake", kotlin)
        self.assertIn("push_scope_token", kotlin)
        self.assertIn("rebindGeneration", kotlin)
        self.assertIn("MediaStore.EXTRA_OUTPUT", kotlin)
        self.assertIn("FileProvider.getUriForFile", kotlin)
        self.assertNotIn('extras?.get("data")', kotlin)
        for mime in (
            "image/*",
            "video/*",
            "application/pdf",
            "text/plain",
        ):
            self.assertIn(mime, kotlin)

    def test_missing_physical_inputs_remain_blocked(self) -> None:
        self.assertEqual(
            runtime_blockers({}, adb_path=None, adb_devices=""),
            [
                "android-sdk-unavailable",
                "physical-android-device-unavailable",
                "fcm-provider-config-unavailable",
                "dedicated-suite-runtime-unavailable",
            ],
        )


if __name__ == "__main__":
    unittest.main()
