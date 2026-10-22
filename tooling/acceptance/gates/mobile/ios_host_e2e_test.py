from __future__ import annotations

import plistlib
import unittest
from pathlib import Path

from tooling.acceptance.gates.mobile.ios_host_e2e import runtime_blockers


REPO_ROOT = Path(__file__).resolve().parents[4]
SWIFT = REPO_ROOT / (
    "apps/mobile/src-tauri/plugins/platform-permissions/ios/Sources/"
    "PlatformPermissionsPlugin.swift"
)
INFO_PLIST = REPO_ROOT / (
    "apps/mobile/src-tauri/gen/apple/peers-touch-mobile_iOS/Info.plist"
)
ENTITLEMENTS = REPO_ROOT / (
    "apps/mobile/src-tauri/gen/apple/peers-touch-mobile_iOS/"
    "peers-touch-mobile_iOS.entitlements"
)
TYPESCRIPT_PLATFORM = REPO_ROOT / (
    "apps/mobile/src/services/platform/mobilePlatform.ts"
)
RUST_PLATFORM = REPO_ROOT / (
    "apps/mobile/src-tauri/src/commands/platform_bridge.rs"
)


class IOSHostSourceContractTest(unittest.TestCase):
    def test_apns_entitlement_background_modes_and_callbacks_exist(self) -> None:
        swift = SWIFT.read_text(encoding="utf-8")
        with INFO_PLIST.open("rb") as source:
            info = plistlib.load(source)
        with ENTITLEMENTS.open("rb") as source:
            entitlements = plistlib.load(source)

        self.assertEqual(entitlements["aps-environment"], "$(APS_ENVIRONMENT)")
        self.assertEqual(
            set(info["UIBackgroundModes"]),
            {"fetch", "remote-notification"},
        )
        for token in (
            "didRegisterForRemoteNotificationsWithDeviceToken",
            "didFailToRegisterForRemoteNotificationsWithError",
            "didReceiveRemoteNotification:fetchCompletionHandler:",
            "ingestAPNsRegistrationFailure",
            "ingestRemoteNotification",
            'kind: "registration_failed"',
        ):
            self.assertIn(token, swift)

    def test_background_scheduler_and_system_actions_stay_host_only(self) -> None:
        swift = SWIFT.read_text(encoding="utf-8")
        typescript = TYPESCRIPT_PLATFORM.read_text(encoding="utf-8")
        rust = RUST_PLATFORM.read_text(encoding="utf-8")
        for token in (
            "BGTaskScheduler.shared.register",
            "expirationHandler",
            "submitScheduledReconcile",
            "setTaskCompleted(success:",
            "executeSystemAction",
            "UIActivityViewController",
            "UIApplication.openSettingsURLString",
            "observeCapability",
        ):
            self.assertIn(token, swift)
        self.assertNotIn("UIKit", typescript)
        self.assertIn("system_action_execute", rust)
        self.assertIn("capability_observe", rust)

    def test_missing_provider_and_suite_runtime_remain_blocked(self) -> None:
        blockers = runtime_blockers(
            {},
            devicectl_path="/usr/bin/xcrun",
            device_inventory="pipi available physical",
        )
        self.assertEqual(
            blockers,
            [
                "apns-provider-config-unavailable",
                "dedicated-suite-runtime-unavailable",
            ],
        )


if __name__ == "__main__":
    unittest.main()
