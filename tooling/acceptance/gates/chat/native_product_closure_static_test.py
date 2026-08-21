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
            ".click()",
        ):
            self.assertNotIn(forbidden, self.source)
        self.assertIn("CGEventCreateMouseEvent", self.source)
        self.assertIn("CGEventPost", self.source)
        self.assertIn("document.hasFocus()", self.source)
        self.assertIn("PT_ACCEPTANCE_WINDOW_SLOT", self.source)
        self.assertIn("PT_ACCEPTANCE_WINDOW_COUNT", self.source)
        self.assertNotIn("libc.usleep", self.source)
        self.assertIn("install_native_input_probe", self.source)
        self.assertIn("wait_native_input_event", self.source)
        self.assertIn("NATIVE_INPUT_ACK_POLL_SECONDS", self.source)
        self.assertIn("poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS", self.source)
        self.assertIn('"mousemove"', self.source)
        self.assertIn('"mousedown"', self.source)
        self.assertIn('"mouseup"', self.source)
        self.assertIn('"click"', self.source)
        self.assertIn("CGEventSourceButtonState", self.source)
        self.assertIn("self.post_mouse((5,), point)", self.source)
        self.assertIn("self.post_mouse((1,), point)", self.source)
        self.assertIn("self.post_mouse((2,), point)", self.source)
        self.assertIn(".send_keys(", self.source)

    def test_transient_native_actions_resolve_after_idempotent_focus(self) -> None:
        self.assertIn(
            'if bool(client.driver.execute_script("return document.hasFocus()")):',
            self.source,
        )
        click_start = self.source.index(
            "    def click(self, actor: str, selector: str, timeout: float = 30)"
        )
        click_end = self.source.index(
            "    def hover_message(self, actor: str, message_id: str)",
            click_start,
        )
        click_source = self.source[click_start:click_end]
        self.assertLess(
            click_source.index("self.focus_actor_window(actor)"),
            click_source.index("client.find_element(selector, timeout)"),
        )

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

    def test_background_select_uses_visible_native_options(self) -> None:
        self.assertIn("def visible_options(driver: Any)", self.source)
        self.assertIn('".ant-select-item-option"', self.source)
        self.assertIn("option.is_displayed() and option.is_enabled()", self.source)
        self.assertIn("return visible if len(visible) >= 2 else None", self.source)
        self.assertIn("self.click_element(actor, options[1])", self.source)

    def test_group_creation_feedback_does_not_cover_composer_actions(self) -> None:
        create_group = (
            ROOT / "apps/desktop/src/components/chat/CreateGroupModal.tsx"
        ).read_text(encoding="utf-8")
        self.assertIn("toast.success({", create_group)
        self.assertIn("placement: 'top'", create_group)

    def test_visible_thread_previews_preserve_reply_identity(self) -> None:
        message_row = (
            ROOT / "apps/desktop/src/components/chat/message/ChatMessageRow.tsx"
        ).read_text(encoding="utf-8")
        self.assertIn("data-thread-preview-message-id={reply.ulid}", message_row)
        self.assertIn("data-thread-preview-message-content={reply.ulid}", message_row)
        self.assertIn("[data-thread-preview-message-id]", self.source)
        self.assertIn("[data-thread-preview-message-content]", self.source)

    def test_top_level_transcript_excludes_rooted_thread_replies(self) -> None:
        self.assertIn(
            'expected_top_level_ids = [str(root["id"]), str(bob_root["id"])]',
            self.source,
        )
        self.assertIn('reply["id"] not in top_level_ids', self.source)
        self.assertIn("alice_transcript == bob_transcript", self.source)
        self.assertIn('expected in item["content"]', self.source)
        self.assertNotIn(
            'len(value := self.transcript("alice")) >= 3',
            self.source,
        )

    def test_toolbar_adjacent_rects_cross_webdriver_as_plain_objects(self) -> None:
        self.assertIn(
            ".map((item) => rect(item.querySelector('[data-message-content]')))",
            self.source,
        )
        self.assertNotIn(
            ".map((item) => item.querySelector('[data-message-content]')"
            "?.getBoundingClientRect())",
            self.source,
        )

    def test_reaction_fault_transport_is_ready_before_alice_login(self) -> None:
        self.assertIn("self.reaction_proxy.start()", self.source)
        self.assertIn("actor_station_url = (", self.source)
        self.assertIn("PEERS_STATION_URL", self.source)
        self.assertNotIn(
            'self.configure_station(self.clients["alice"], proxy.url)',
            self.source,
        )
        self.assertIn(
            "'[data-message-reaction-state=\"error\"]'",
            self.source,
        )
        self.assertIn("controlled_loss", self.source)
        self.assertIn("{self.reaction_proxy.port}", self.source)

    def test_station_attribution_evidence_serializes_sets_as_lists(self) -> None:
        self.assertIn("station_sets_detail = [", self.source)
        self.assertIn("json.dumps(station_sets_detail)", self.source)
        self.assertNotIn("json.dumps(station_sets)", self.source)

    def test_avatar_proof_waits_for_exact_loaded_surfaces(self) -> None:
        self.assertIn("def loaded_snapshot()", self.source)
        self.assertIn('f"{actor} exact loaded avatar surfaces"', self.source)
        self.assertIn("len(entries) >= 3", self.source)
        self.assertIn("len(sources) == 1", self.source)
        self.assertIn("all(entry.get(\"loaded\") for entry in entries)", self.source)

    def test_narrow_thread_panel_keeps_native_controls_in_viewport(self) -> None:
        chat_page = (
            ROOT / "apps/desktop/src/pages/SocialChatPage.tsx"
        ).read_text(encoding="utf-8")
        self.assertIn("data-chat-side-panel-open=", chat_page)
        self.assertIn("data-chat-conversation-list-shell", chat_page)
        self.assertIn("@media (max-width: 960px)", chat_page)
        self.assertIn("overflow-x: hidden !important", chat_page)
        self.assertIn("min-width: 0 !important", chat_page)


if __name__ == "__main__":
    unittest.main(verbosity=2)
