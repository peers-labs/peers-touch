from __future__ import annotations

import ast
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
RUNNER = ROOT / "tooling/acceptance/gates/chat/native_product_closure_runner.py"


class NativeProductClosureStaticTests(unittest.TestCase):
    def setUp(self) -> None:
        self.source = RUNNER.read_text(encoding="utf-8")
        self.tree = ast.parse(self.source)

    def test_runner_is_a_real_acceptance_gate(self) -> None:
        gate = next(
            node
            for node in self.tree.body
            if isinstance(node, ast.ClassDef)
            and node.name == "NativeProductClosureGate"
        )
        self.assertEqual(
            [base.id for base in gate.bases if isinstance(base, ast.Name)],
            ["AcceptanceGate"],
        )
        self.assertIn("load_runtime_manifest", self.source)
        self.assertIn("PT_ACCEPTANCE_RUNTIME_MANIFEST", self.source)

    def test_harness_is_bootstrap_only(self) -> None:
        methods: list[str] = []
        for node in ast.walk(self.tree):
            if not isinstance(node, ast.Call):
                continue
            if not isinstance(node.func, ast.Name):
                continue
            if node.func.id != "call_async_harness":
                continue
            self.assertGreaterEqual(len(node.args), 2)
            self.assertIsInstance(node.args[1], ast.Constant)
            methods.append(str(node.args[1].value))
        self.assertEqual(sorted(methods), ["getRealtimeDevice", "loginWithPassword"])

    def test_claimed_actions_cannot_use_store_or_command_bypasses(self) -> None:
        for forbidden in (
            "__PT_ACCEPTANCE_STORE__",
            ".getState(",
            ".setState(",
            "gateway_command(",
            "execute_async_script(",
            "dispatchEvent(",
            "time.sleep(",
            "ActionChains",
            "ActionBuilder",
            "PointerInput",
        ):
            self.assertNotIn(forbidden, self.source)
        self.assertIn("CGEventCreateMouseEvent", self.source)
        self.assertIn("CGEventPost", self.source)
        self.assertIn("document.hasFocus()", self.source)
        self.assertIn(".click()", self.source)
        self.assertIn(".send_keys(", self.source)

    def test_gateway_commands_are_readback_only(self) -> None:
        assignment = next(
            node
            for node in self.tree.body
            if isinstance(node, ast.Assign)
            and any(
                isinstance(target, ast.Name)
                and target.id == "READBACK_COMMANDS"
                for target in node.targets
            )
        )
        self.assertIsInstance(assignment.value, ast.Set)
        commands = {
            str(item.value)
            for item in assignment.value.elts
            if isinstance(item, ast.Constant)
        }
        self.assertEqual(
            commands,
            {
                "conversation_get_member_settings",
                "messaging_list_messages",
                "messaging_open_attachment",
            },
        )

    def test_required_native_actions_and_evidence_are_fail_closed(self) -> None:
        for required in (
            '[data-chat-create-group-submit]',
            '[data-chat-send]',
            '[data-message-action="reply"]',
            '[data-message-action="thread"]',
            '[data-message-action="reaction"]',
            '[data-chat-detail-toggle]',
            '[data-chat-conversation-action="mute"]',
            '[data-chat-conversation-action="pin"]',
            '[data-chat-background-input]',
            '[data-chat-attachment-input]',
            "toolbar_geometry",
            "transcript_exact",
            "thread_exact",
            "attachment_count_conservation",
            "attachment_byte_exact",
            "cleanup_ports_released",
            "binarySha256",
            "save_screenshot",
            "save_dom",
        ):
            self.assertIn(required, self.source)

    def test_product_file_controls_share_the_visible_user_path(self) -> None:
        composer = (
            ROOT / "apps/desktop/src/components/chat/ChatComposer.tsx"
        ).read_text(encoding="utf-8")
        details = (
            ROOT / "apps/desktop/src/components/chat/ChatDetailPanel.tsx"
        ).read_text(encoding="utf-8")
        self.assertIn("data-chat-attachment-input", composer)
        self.assertIn("fileInputRef.current?.click()", composer)
        self.assertIn("data-chat-background-input", details)
        self.assertIn("backgroundInputRef.current?.click()", details)
        self.assertIn("ossUploadAttachmentBytes", details)


if __name__ == "__main__":
    unittest.main(verbosity=2)
