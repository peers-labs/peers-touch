from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]


class NativeVisibleStaticContractTest(unittest.TestCase):
    def test_journey_entrypoint_bootstraps_repo_imports_from_any_cwd(self) -> None:
        runner = (
            ROOT
            / "tooling"
            / "acceptance"
            / "gates"
            / "chat"
            / "native_two_client_runner.py"
        )
        environment = os.environ.copy()
        environment.pop("PT_ACCEPTANCE_RUNTIME_MANIFEST", None)
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(
                [sys.executable, str(runner)],
                cwd=directory,
                env=environment,
                capture_output=True,
                text=True,
                check=False,
            )
        output = result.stdout + result.stderr
        self.assertEqual(result.returncode, 1)
        self.assertNotIn("ModuleNotFoundError", output)
        self.assertIn("PT_ACCEPTANCE_RUNTIME_MANIFEST is required", output)

    def test_process_specific_profile_overrides_active_worktree_profile(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            profile = Path(directory) / "native.env"
            profile.write_text(
                "\n".join(
                    (
                        "PT_DEV_PROFILE=chat-native-test",
                        "PT_DESKTOP_APP_GATEWAY_PORT=3337",
                        "PT_DESKTOP_APP_WEB_PORT=3517",
                    )
                )
                + "\n",
                encoding="utf-8",
            )
            result = subprocess.run(
                [
                    "bash",
                    "-c",
                    "source tooling/scripts/local-dev/env.sh; "
                    'printf "%s %s %s" "$PT_DEV_PROFILE" '
                    '"$PT_DESKTOP_APP_GATEWAY_PORT" "$PT_DESKTOP_APP_WEB_PORT"',
                ],
                cwd=ROOT,
                env={**os.environ, "PT_DEV_PROFILE_FILE": str(profile)},
                check=True,
                text=True,
                capture_output=True,
            )
        self.assertEqual(result.stdout, "chat-native-test 3337 3517")

    def test_runner_has_no_fixed_sleep_or_startup_order_contract(self) -> None:
        source = (
            ROOT / "tooling/acceptance/gates/chat/native_visible_runner.py"
        ).read_text(encoding="utf-8")
        self.assertNotIn("time.sleep(", source)
        self.assertIn("random.SystemRandom().shuffle(order)", source)
        self.assertIn('["make", "desktop"]', source)
        self.assertIn("TauriDriver(", source)
        self.assertIn('"TAURI_WEBDRIVER_PORT"', source)
        self.assertIn('self.observer.fill(SELECTORS["composer"], "")', source)
        self.assertIn("PT_ACCEPTANCE_RUNTIME_MANIFEST", source)
        self.assertNotIn("PT_PLAYWRIGHT_SOCKET", source)
        self.assertNotIn("socket.AF_UNIX", source)
        self.assertNotIn("CHAT_NATIVE_DEMO_PASSWORD", source)
        self.assertNotIn("CHAT_NATIVE_ALICE_PTID", source)
        self.assertNotIn("CHAT_NATIVE_BOB_PTID", source)

    def test_native_launcher_uses_declared_cargo_feature(self) -> None:
        launcher = (
            ROOT / "tooling" / "scripts" / "_ensure-desktop-rust.sh"
        ).read_text(encoding="utf-8")
        cargo = (
            ROOT / "apps" / "desktop" / "src-tauri" / "Cargo.toml"
        ).read_text(encoding="utf-8")
        self.assertIn(
            "acceptance-webdriver = [\"dep:tauri-plugin-wdio-webdriver\"]",
            cargo,
        )
        self.assertIn("--features acceptance-webdriver", launcher)
        self.assertIn('"permissions\\":[\\"wdio-webdriver:default\\"]', launcher)
        self.assertNotIn("--features e2e-testing", launcher)
        self.assertNotIn("playwright:default", launcher)

    def test_profile_sync_uses_window_bound_ptid_and_local_account(self) -> None:
        application = (
            ROOT
            / "apps"
            / "desktop"
            / "src-tauri"
            / "src"
            / "application"
            / "profile"
            / "mod.rs"
        ).read_text(encoding="utf-8")
        command = (
            ROOT
            / "apps"
            / "desktop"
            / "src-tauri"
            / "src"
            / "interface"
            / "tauri_commands"
            / "profile.rs"
        ).read_text(encoding="utf-8")
        self.assertIn("profile_matches_ptid", application)
        self.assertIn("canonical_profile_ptid(profile) == Some(actor_ptid)", application)
        self.assertNotIn("profile.id == actor_id ||", application)
        self.assertIn("state.sessions.get(window.label())", command)
        self.assertIn("&session.account_id", command)
        self.assertIn("&session.actor.ptid", command)

    def test_all_visible_journey_entrypoints_exist(self) -> None:
        expected = (
            "native_two_client_runner.py",
            "native_multi_device_runner.py",
            "native_recovery_runner.py",
            "native_group_mls_runner.py",
        )
        for name in expected:
            with self.subTest(name=name):
                self.assertTrue((ROOT / "tooling/acceptance/gates/chat" / name).is_file())

    def test_two_client_entrypoint_uses_core_tauri_driver(self) -> None:
        source = (
            ROOT / "tooling/acceptance/gates/chat/native_two_client_runner.py"
        ).read_text(encoding="utf-8")
        self.assertIn("class NativeTwoClientGate(AcceptanceGate)", source)
        self.assertIn("start_authenticated_client", source)
        self.assertIn("native-tauri-embedded-webdriver", source)
        self.assertNotIn("native_visible_runner", source)
        self.assertNotIn("observerSocket", source)

    def test_chat_harness_returns_canonical_ptid(self) -> None:
        harness = (
            ROOT / "apps/desktop/src/acceptance/chat/harness.ts"
        ).read_text(encoding="utf-8")
        identity = (
            ROOT / "apps/desktop/src/acceptance/chat/identity.ts"
        ).read_text(encoding="utf-8")
        self.assertIn("const actorPtid = activeActorPtid()", harness)
        self.assertIn("actorId: actorPtid", harness)
        self.assertIn("currentUserDid", harness)
        self.assertNotIn("authenticated: Boolean(user?.actorId)", harness)
        self.assertIn("ptid.startsWith('ptid:')", identity)

    def test_chat_navigation_accepts_already_active_narrow_layout(self) -> None:
        source = (
            ROOT / "tooling/acceptance/gates/chat/native_support.py"
        ).read_text(encoding="utf-8")
        self.assertIn('get_current_url().endswith("#/chat")', source)
        self.assertIn('[data-pt-primary-nav="chat"] button', source)

    def test_embedded_webdriver_make_entrypoints_exist(self) -> None:
        source = (ROOT / "tooling/make/acceptance.mk").read_text(encoding="utf-8")
        self.assertIn("acceptance-driver-build:", source)
        self.assertIn("VITE_ACCEPTANCE_HARNESS=1", source)
        self.assertIn("cargo build --features acceptance-webdriver", source)
        self.assertIn("acceptance-driver-smoke:", source)
        self.assertIn("-m tooling.acceptance.drivers.tauri", source)

    def test_stable_selectors_are_bound_in_product_source(self) -> None:
        required = {
            "apps/desktop/src/components/common/StationPicker.tsx": (
                "data-station-picker-trigger",
                "data-station-url",
            ),
            "apps/desktop/src/pages/login/views/LoginFormView.tsx": (
                "data-login-tab",
                "data-login-email",
                "data-login-password",
                "data-login-submit",
            ),
            "apps/desktop/src/pages/login/views/SetPinView.tsx": ("data-login-pin-skip",),
            "apps/desktop/src/components/chat/ChatContactsPanel.tsx": (
                "data-chat-contact-ptid",
            ),
            "apps/desktop/src/components/chat/ChatContactsDetailPanel.tsx": (
                "data-chat-contact-message",
            ),
            "apps/desktop/src/pages/SocialChatPage.tsx": (
                "data-chat-subpage",
            ),
            "apps/desktop/src/components/chat/ChatComposer.tsx": (
                'data-pt-text-input="chat-composer"',
                "data-chat-send",
            ),
            "apps/desktop/src/components/chat/ChatMessageArea.tsx": (
                "data-session-security",
                "data-group-security",
                "data-chat-error",
                "data-chat-detail-toggle",
            ),
            "apps/desktop/src/components/chat/message/ChatMessageRow.tsx": (
                "data-message-ulid",
                "data-message-receipt",
            ),
            "apps/desktop/src/components/settings/RecoverySettings.tsx": (
                "data-recovery-generate",
                "data-recovery-phrase",
                "data-recovery-backup-create",
                "data-recovery-restore-input",
                "data-recovery-restore-submit",
            ),
            "apps/desktop/src/components/chat/CreateGroupModal.tsx": (
                "data-chat-create-group-contact",
                "data-chat-create-group-submit",
            ),
            "apps/desktop/src/components/chat/ChatDetailPanel.tsx": (
                "data-chat-group-add-member-open",
                "data-chat-group-remove-member",
            ),
        }
        for relative, selectors in required.items():
            source = (ROOT / relative).read_text(encoding="utf-8")
            for selector in selectors:
                with self.subTest(path=relative, selector=selector):
                    self.assertIn(selector, source)

    def test_login_email_selector_is_bound_to_the_email_control(self) -> None:
        source = (
            ROOT / "apps/desktop/src/pages/login/views/LoginFormView.tsx"
        ).read_text(encoding="utf-8")
        self.assertRegex(
            source,
            r"<Input\s+data-login-email\s+size=\"large\"\s+"
            r"prefix=\{<Mail[\s\S]+?type=\"email\"",
        )


if __name__ == "__main__":
    unittest.main()
