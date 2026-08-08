from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]


class NativeVisibleStaticContractTest(unittest.TestCase):
    def test_runner_has_no_fixed_sleep_or_startup_order_contract(self) -> None:
        source = (
            ROOT / "tooling/acceptance/gates/chat/native_visible_runner.py"
        ).read_text(encoding="utf-8")
        self.assertNotIn("time.sleep(", source)
        self.assertIn("random.SystemRandom().shuffle(order)", source)
        self.assertIn('["make", "desktop"]', source)
        self.assertIn('self.observer.fill(SELECTORS["composer"], "")', source)

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


if __name__ == "__main__":
    unittest.main()
