from __future__ import annotations

import ast
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
RUNNER = ROOT / "tooling/acceptance/gates/chat/native_product_closure_runner.py"
DESKTOP_MAIN = ROOT / "apps/desktop/src-tauri/src/main.rs"
DESKTOP_CARGO = ROOT / "apps/desktop/src-tauri/Cargo.toml"
MESSAGE_ACTION_OVERLAY = (
    ROOT
    / "apps/desktop/src/components/chat/message/ChatMessageActionOverlay.tsx"
)


class NativeProductClosureStaticTests(unittest.TestCase):
    def setUp(self) -> None:
        self.source = RUNNER.read_text(encoding="utf-8")
        self.desktop_main = DESKTOP_MAIN.read_text(encoding="utf-8")
        self.desktop_cargo = DESKTOP_CARGO.read_text(encoding="utf-8")
        self.message_action_overlay = MESSAGE_ACTION_OVERLAY.read_text(
            encoding="utf-8"
        )
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
        self.assertIn(
            "self.launch_actor(actor, restore_session=True)",
            self.source,
        )
        self.assertEqual(self.source.count("station.auth_logout()"), 1)

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
            "Command.UPLOAD_FILE",
            "LocalFileDetector",
            "UselessFileDetector",
        ):
            self.assertNotIn(forbidden, self.source)
        self.assertIn("CGEventCreateMouseEvent", self.source)
        self.assertIn("CGEventPost", self.source)
        self.assertNotIn("CGEventPostToPid", self.source)
        self.assertIn("document.hasFocus()", self.source)
        self.assertIn("PT_ACCEPTANCE_WINDOW_SLOT", self.source)
        self.assertIn("PT_ACCEPTANCE_WINDOW_COUNT", self.source)
        self.assertNotIn("libc.usleep", self.source)
        self.assertIn("install_native_input_probe", self.source)
        self.assertIn("wait_native_input_event", self.source)
        self.assertIn('event.get("owned") is True', self.source)
        self.assertIn("NATIVE_INPUT_ACK_POLL_SECONDS", self.source)
        self.assertIn("poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS", self.source)
        self.assertIn("'mousemove'", self.source)
        self.assertIn('"mousedown"', self.source)
        self.assertIn('"mouseup"', self.source)
        self.assertIn('"click"', self.source)
        self.assertIn("CGEventSourceButtonState", self.source)
        self.assertIn("native_window_stack_at_point", self.source)
        self.assertIn(
            "int(frontmost_app.processIdentifier()) if frontmost_app else -1",
            self.source,
        )
        self.assertIn('copied_boolean(front_window, "AXMain")', self.source)
        self.assertIn('copied_boolean(front_window, "AXFocused")', self.source)
        click_start = self.source.index(
            "    def click_element(self, actor: str, element: Any) -> Any:"
        )
        click_end = self.source.index(
            "    def click(self, actor: str, selector: str",
            click_start,
        )
        click_source = self.source[click_start:click_end]
        self.assertNotIn('"mousemove"', click_source)
        self.assertIn('"mousedown"', click_source)
        self.assertIn('"mouseup"', click_source)
        self.assertIn('"click"', click_source)
        self.assertNotIn("report_native_input_delivery", click_source)
        self.assertIn(
            "if mouse_down_posted and self.native_mouse_button_down():",
            click_source,
        )
        self.assertIn(
            '"Native click target changed before event delivery"',
            click_source,
        )
        self.assertLess(
            click_source.index("current_target = client.driver.execute_script("),
            click_source.index("self.post_mouse(\n                (1,),"),
        )
        self.assertNotIn(
            'report_native_input_delivery("before-click")',
            click_source,
        )
        self.assertNotIn("staging_point", self.source)
        post_mouse_start = self.source.index("    def post_mouse(")
        post_mouse_end = self.source.index(
            "    def post_key(",
            post_mouse_start,
        )
        post_mouse_source = self.source[post_mouse_start:post_mouse_end]
        self.assertIn("CGEventCreateMouseEvent(\n                None,", post_mouse_source)
        self.assertNotIn("CGEventSourceCreate", post_mouse_source)
        self.assertIn(".send_keys(", self.source)

    def test_transient_native_actions_resolve_after_idempotent_focus(self) -> None:
        self.assertIn("def actor_window_owns_point() -> bool:", self.source)
        self.assertIn('set value of attribute "AXMain"', self.source)
        self.assertNotIn('set value of attribute "AXFocused"', self.source)
        focus_start = self.source.index(
            "    def focus_actor_window(self, actor: str) -> TauriDriver:"
        )
        focus_end = self.source.index(
            "    def click_element(self, actor: str, element: Any) -> Any:",
            focus_start,
        )
        focus_source = self.source[focus_start:focus_end]
        recovery_index = focus_source.index(
            "if self.native_mouse_button_down():"
        )
        cooperative_index = focus_source.index(
            "cooperative_activation = self.request_cooperative_activation(client)"
        )
        activation_index = focus_source.index(
            "self.activate_native_process(client.process_id)"
        )
        focus_wait_index = focus_source.index(
            "lambda _: actor_window_owns_point()",
            activation_index,
        )
        focus_down_index = focus_source.index(
            "self.post_mouse((1,), point)",
            focus_wait_index,
        )
        focus_up_index = focus_source.index(
            "self.post_mouse((2,), point)",
            focus_down_index,
        )
        document_focus_index = focus_source.index(
            'lambda driver: bool(driver.execute_script("return document.hasFocus()"))',
            focus_up_index,
        )
        self.assertIn(
            "NSRunningApplication.runningApplicationWithProcessIdentifier_",
            self.source,
        )
        self.assertIn("NSApplicationActivateAllWindows", self.source)
        self.assertIn("NSApplicationActivateIgnoringOtherApps", self.source)
        yield_start = self.source.index(
            "    def invoke_native_activation_command("
        )
        yield_end = self.source.index(
            "    def activate_native_process(",
            yield_start,
        )
        yield_source = self.source[yield_start:yield_end]
        self.assertIn("window.__TAURI_INTERNALS__.invoke(", yield_source)
        self.assertIn('"acceptance_yield_activation"', yield_source)
        self.assertIn('"acceptance_request_activation"', yield_source)
        self.assertNotIn("call_async_harness", yield_source)
        self.assertLess(
            self.source.index("application.activateWithOptions_(options)"),
            self.source.index('tell application "System Events"'),
        )
        self.assertIn('perform action "AXRaise"', self.source)
        self.assertNotIn("report_focus_snapshot", focus_source)
        self.assertLess(recovery_index, cooperative_index)
        self.assertLess(cooperative_index, activation_index)
        self.assertLess(recovery_index, activation_index)
        self.assertLess(activation_index, focus_wait_index)
        self.assertLess(focus_wait_index, focus_down_index)
        self.assertLess(focus_down_index, focus_up_index)
        self.assertLess(focus_up_index, document_focus_index)
        self.assertIn("self.native_window_stack_at_point(point)", focus_source)
        self.assertIn(
            'window.get("ownerPid") == client.process_id',
            focus_source,
        )
        self.assertNotIn(
            'ownership.get("actualFrontmostPid") == client.process_id',
            focus_source,
        )
        self.assertIn(
            "if focus_mouse_down and self.native_mouse_button_down():",
            focus_source,
        )
        self.assertNotIn("self.post_mouse((5,), point)", focus_source)
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

    def test_transient_action_surface_owns_the_complete_pointer_press(self) -> None:
        pointer_down = self.message_action_overlay.index(
            "      onPointerDownCapture={() => {"
        )
        pointer_enter = self.message_action_overlay.index(
            "      onPointerEnter={() => {",
            pointer_down,
        )
        pointer_down_source = self.message_action_overlay[
            pointer_down:pointer_enter
        ]
        self.assertIn("pointerInsideRef.current = true;", pointer_down_source)
        self.assertIn("onPointerEnter();", pointer_down_source)

    def test_acceptance_window_owns_the_native_overlay_level(self) -> None:
        self.assertIn('feature = "acceptance-webdriver"', self.desktop_main)
        self.assertIn("target_os = \"macos\"", self.desktop_main)
        self.assertIn("NSScreenSaverWindowLevel", self.desktop_main)
        self.assertIn("DispatchQueue::main().exec_async", self.desktop_main)
        self.assertIn("configure_acceptance_window_level(window)?", self.desktop_main)
        self.assertIn("fn acceptance_yield_activation(", self.desktop_main)
        self.assertIn(
            "yieldActivationToApplication(&target)",
            self.desktop_main,
        )
        self.assertIn("fn acceptance_request_activation(", self.desktop_main)
        self.assertIn(
            "NSApplication::sharedApplication(main_thread)"
            ".activateIgnoringOtherApps(true)",
            self.desktop_main,
        )
        self.assertIn(
            '#[cfg(all(feature = "acceptance-webdriver", target_os = "macos"))]',
            self.desktop_main,
        )
        self.assertIn("dispatch2", self.desktop_cargo)
        self.assertIn("objc2-app-kit", self.desktop_cargo)
        self.assertIn('"NSApplication"', self.desktop_cargo)
        self.assertIn('"NSRunningApplication"', self.desktop_cargo)

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
            '[data-chat-background-upload]',
            '[data-chat-attachment-picker]',
            "toolbar_geometry",
            "transcript_exact",
            "thread_exact",
            "attachment_images_loaded",
            "attachment_count_conservation",
            "attachment_byte_exact",
            "cleanup_ports_released",
            "binarySha256",
            "save_screenshot",
            "save_dom",
            "capture_restart_snapshot",
            "restart-detail-failure",
            "alice-restart-detail-failure",
        ):
            self.assertIn(required, self.source)

    def test_product_file_controls_share_the_visible_user_path(self) -> None:
        composer = (
            ROOT / "apps/desktop/src/components/chat/ChatComposer.tsx"
        ).read_text(encoding="utf-8")
        details = (
            ROOT / "apps/desktop/src/components/chat/ChatDetailPanel.tsx"
        ).read_text(encoding="utf-8")
        attachment_item = (
            ROOT / "apps/desktop/src/components/chat/AttachmentItem.tsx"
        ).read_text(encoding="utf-8")
        messaging = (
            ROOT
            / "apps/desktop/src-tauri/src/interface/tauri_commands/messaging.rs"
        ).read_text(encoding="utf-8")
        self.assertIn("data-chat-attachment-picker", composer)
        self.assertIn("imServiceV1.messaging.pickAttachmentSource()", composer)
        self.assertIn("appendPickedAttachment", composer)
        self.assertIn("data-chat-send-outcome-revision", composer)
        self.assertNotIn("data-chat-attachment-input", composer)
        self.assertIn("data-chat-background-upload", details)
        self.assertIn("api.pickImageFile()", details)
        self.assertIn("api.ossUploadLocalFile", details)
        self.assertNotIn("data-chat-background-input", details)
        self.assertNotIn("ossUploadAttachmentBytes", details)
        self.assertIn("messages: s.messages", details)
        self.assertIn("projectDesktopIMMessages(", details)
        self.assertNotIn("getIMMessages: s.getIMMessages", details)
        self.assertIn("fn allow_attachment_preview(", messaging)
        self.assertIn(".asset_protocol_scope()", messaging)
        self.assertEqual(
            messaging.count("allow_attachment_preview(&window,"),
            4,
        )
        self.assertIn("previous_outcome_revision", self.source)
        self.assertIn("revision <= previous_outcome_revision", self.source)
        self.assertIn("data-messaging-attachment-open-state", attachment_item)
        self.assertIn("data-chat-detail-attachment-open-state", details)
        self.assertIn("attachment_images_loaded", self.source)
        self.assertIn("Native open", self.source)

    def test_product_files_use_real_native_chooser(self) -> None:
        self.assertIn("def choose_native_file(", self.source)
        self.assertIn("def post_key(", self.source)
        self.assertIn("def post_key_chord(", self.source)
        self.assertIn("AXUIElementCreateApplication", self.source)
        self.assertIn(
            "AXUIElementSetMessagingTimeout(application, 0.5)",
            self.source,
        )
        focused_control_start = self.source.index(
            "    def native_focused_control("
        )
        focused_control_end = self.source.index(
            "    def native_window_stack_at_point(",
            focused_control_start,
        )
        focused_control_source = self.source[
            focused_control_start:focused_control_end
        ]
        self.assertIn("NATIVE_ACCESSIBILITY_PROBE", focused_control_source)
        self.assertIn("str(process_id)", focused_control_source)
        self.assertIn("timeout=2", focused_control_source)
        self.assertNotIn(
            'tell application "System Events"',
            focused_control_source,
        )
        self.assertIn("CGEventCreateKeyboardEvent", self.source)
        self.assertIn("CGEventKeyboardSetUnicodeString", self.source)
        self.assertIn('"AXFocusedUIElement"', self.source)
        self.assertIn('"AXTextField"', self.source)
        self.assertIn('"windowCount"', self.source)
        self.assertIn('"sheetCount"', self.source)
        self.assertIn("def panel_open(", self.source)
        self.assertIn(
            'NATIVE_FILE_PANEL_FOCUSED_ROLES = frozenset({"AXList", "AXTextField"})',
            self.source,
        )
        self.assertIn(
            'control.get("role") in NATIVE_FILE_PANEL_FOCUSED_ROLES',
            self.source,
        )
        self.assertIn(
            'control.get("role") != baseline_control.get("role")',
            self.source,
        )
        self.assertIn("def native_app_baseline_ready(", self.source)
        self.assertIn('int(control.get("windowCount", 0)) >= 1', self.source)
        self.assertIn('bool(control.get("mainWindow"))', self.source)
        self.assertIn('bool(control.get("frontmost"))', self.source)
        self.assertIn(
            'control.get("subrole") != "AXApplicationDialog"',
            self.source,
        )
        self.assertIn('return {"selected": True, "control": control}', self.source)
        self.assertIn(
            "self.post_key_chord(0, ((55, command),))\n"
            "        self.post_key(51, private_source=True)",
            self.source,
        )
        self.assertIn(
            'control.get("value") == ""',
            self.source,
        )
        self.assertIn(
            "poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS",
            self.source,
        )
        self.assertIn(
            '("/usr/bin/pbcopy",)',
            self.source,
        )
        self.assertIn(
            "Native file chooser could not restore the clipboard",
            self.source,
        )
        self.assertIn('control.get("value") == str(selected_path)', self.source)
        self.assertIn(
            "self.post_key_chord(5, ((55, command), (56, shift)))",
            self.source,
        )
        self.assertIn(
            "self.post_key_chord(9, ((55, command),))",
            self.source,
        )
        self.assertIn("self.post_key(36, private_source=True)", self.source)
        self.assertIn(
            '"Native Accessibility probe timed out"',
            self.source,
        )
        self.assertIn("def selection_or_browser_ready(", self.source)
        self.assertIn("baseline_window_count", self.source)
        self.assertIn(
            'control.get("subrole") == "AXApplicationDialog"',
            self.source,
        )
        self.assertIn(
            "core_graphics.CGEventSourceCreate(-1)",
            self.source,
        )
        self.assertIn(
            'control.get("subrole") != "AXApplicationDialog"',
            self.source,
        )
        self.assertIn("NATIVE_FILE_TRANSITION_TIMEOUT_SECONDS", self.source)
        self.assertIn("def native_app_baseline_ready(", self.source)
        self.assertIn('def native_window_restored(', self.source)
        self.assertIn('and bool(control.get("role"))', self.source)
        self.assertNotIn("report_native_file_snapshot", self.source)
        self.assertIn("self.focus_actor_window(actor)", self.source)
        self.assertIn('trigger_selector="[data-chat-background-upload]"', self.source)
        self.assertIn('trigger_selector="[data-chat-attachment-picker]"', self.source)
        for forbidden in (
            'find_element(\n            "[data-chat-background-input]",\n'
            "            10,\n        ).send_keys",
            "attachment_input.send_keys",
        ):
            self.assertNotIn(forbidden, self.source)

    def test_background_select_uses_visible_native_options(self) -> None:
        self.assertIn("def rendered_options(driver: Any)", self.source)
        self.assertIn('".ant-select-item-option"', self.source)
        self.assertIn("return options if len(options) >= 2 else None", self.source)
        self.assertIn("self.click_element(actor, options[1])", self.source)

    def test_background_modal_reuses_active_surface_without_sleep(self) -> None:
        self.assertIn("def open_background_modal(self, actor: str)", self.source)
        self.assertIn("if active_select is not None:", self.source)
        self.assertIn("document.elementFromPoint(", self.source)
        self.assertIn("document.elementsFromPoint(", self.source)
        self.assertIn(
            "action && (hit === action || action.contains(hit))",
            self.source,
        )
        self.assertIn(").until(background_action_ready)", self.source)
        self.assertIn("name.includes('-leave')", self.source)

    def test_background_recovery_uses_the_visible_retry_action(self) -> None:
        start = self.source.index("    def prove_settings_background(")
        end = self.source.index("    def prove_attachment_failure(", start)
        settings_source = self.source[start:end]
        self.assertEqual(
            settings_source.count(
                'trigger_selector="[data-chat-background-upload]"'
            ),
            1,
        )
        self.assertIn(
            '"[data-chat-background-retry]"',
            settings_source,
        )
        self.assertIn(
            'self.click_element("alice", retry)',
            settings_source,
        )
        self.assertIn(
            "empty_image.write_bytes(valid_image.read_bytes())",
            settings_source,
        )
        self.assertIn(
            'state.get("backgroundRetry") == "true"',
            settings_source,
        )
        self.assertIn(
            'state.get("backgroundRetry") == "false"',
            settings_source,
        )
        self.assertIn(
            "const observer = new MutationObserver(capture);",
            settings_source,
        )
        self.assertIn(
            "'data-chat-detail-action-pending'",
            settings_source,
        )
        self.assertIn(
            "def background_retry_pending()",
            settings_source,
        )
        self.assertIn(
            'item.get("pending") == "background-image"',
            settings_source,
        )
        self.assertIn('"retryTransitions": retry_transitions', settings_source)

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
