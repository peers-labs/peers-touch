from __future__ import annotations

import ast
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
RUNNER = ROOT / "tooling/acceptance/gates/chat/native_product_closure_runner.py"
ENTRY = ROOT / "tooling/acceptance/gates/chat/native_product_closure_entry.py"
RUNTIME_BINDING = ROOT / "tooling/acceptance/drivers/native/runtime.py"
GATE_CATALOG = ROOT / "tooling/acceptance/gates.yaml"
MACOS_ADAPTER = ROOT / "tooling/acceptance/drivers/native/macos.py"
DESKTOP_MAIN = ROOT / "apps/desktop/src-tauri/src/main.rs"
DESKTOP_CARGO = ROOT / "apps/desktop/src-tauri/Cargo.toml"
MESSAGE_ACTION_OVERLAY = (
    ROOT
    / "apps/desktop/src/components/chat/message/ChatMessageActionOverlay.tsx"
)
MESSAGE_ROW = ROOT / "apps/desktop/src/components/chat/message/ChatMessageRow.tsx"
MESSAGE_CONTENT = (
    ROOT / "apps/desktop/src/components/chat/message/ChatMessageContent.tsx"
)
HOME_STATION_PROVISIONER = (
    ROOT / "tooling/acceptance/provisioners/home_station.py"
)
CHAT_DETAIL_PANEL = (
    ROOT / "apps/desktop/src/components/chat/ChatDetailPanel.tsx"
)
CHAT_COMPOSER = ROOT / "apps/desktop/src/components/chat/ChatComposer.tsx"
CHAT_MESSAGE_AREA = ROOT / "apps/desktop/src/components/chat/ChatMessageArea.tsx"
CHAT_SESSION_LIST = ROOT / "apps/desktop/src/components/chat/ChatSessionList.tsx"
CREATE_GROUP_MODAL = (
    ROOT / "apps/desktop/src/components/chat/CreateGroupModal.tsx"
)
HTTP_GATEWAY = ROOT / "apps/desktop/src-tauri/src/interface/http_gateway/mod.rs"


class NativeProductClosureStaticTests(unittest.TestCase):
    def setUp(self) -> None:
        self.source = RUNNER.read_text(encoding="utf-8")
        self.entry = ENTRY.read_text(encoding="utf-8")
        self.runtime_binding = RUNTIME_BINDING.read_text(encoding="utf-8")
        self.gate_catalog = GATE_CATALOG.read_text(encoding="utf-8")
        self.macos_adapter = MACOS_ADAPTER.read_text(encoding="utf-8")
        self.desktop_main = DESKTOP_MAIN.read_text(encoding="utf-8")
        self.desktop_cargo = DESKTOP_CARGO.read_text(encoding="utf-8")
        self.message_action_overlay = MESSAGE_ACTION_OVERLAY.read_text(
            encoding="utf-8"
        )
        self.message_row = MESSAGE_ROW.read_text(encoding="utf-8")
        self.message_content = MESSAGE_CONTENT.read_text(encoding="utf-8")
        self.home_station_provisioner = HOME_STATION_PROVISIONER.read_text(
            encoding="utf-8"
        )
        self.chat_detail_panel = CHAT_DETAIL_PANEL.read_text(encoding="utf-8")
        self.chat_composer = CHAT_COMPOSER.read_text(encoding="utf-8")
        self.chat_message_area = CHAT_MESSAGE_AREA.read_text(encoding="utf-8")
        self.chat_session_list = CHAT_SESSION_LIST.read_text(encoding="utf-8")
        self.create_group_modal = CREATE_GROUP_MODAL.read_text(encoding="utf-8")
        self.http_gateway = HTTP_GATEWAY.read_text(encoding="utf-8")
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
        self.assertIn("resolve_native_desktop_runtime", self.entry)
        self.assertIn("PT_ACCEPTANCE_RUNTIME_CELL", self.entry)
        self.assertIn("runtime_binding=runtime_binding", self.entry)

    def test_runner_consumes_injected_runtime_without_local_fallback(self) -> None:
        self.assertIn(
            "runtime_binding: NativeDesktopRuntimeBinding",
            self.source,
        )
        self.assertIn(
            "self.runtime_binding.create_session(",
            self.source,
        )
        self.assertIn(
            "self.native_adapter: NativeDesktopAdapter =",
            self.source,
        )
        for forbidden in (
            "LocalTauriLauncher",
            "find_app_binary",
            "create_native_desktop_adapter",
            "sys.platform",
        ):
            self.assertNotIn(forbidden, self.source)
        self.assertIn("LocalTauriLauncher", self.runtime_binding)
        self.assertIn("MacOSNativeDesktopAdapter", self.runtime_binding)
        self.assertIn(
            "LinuxNativeDesktopRuntimeBinding(",
            self.runtime_binding,
        )

    def test_runtime_cutover_preserves_product_contract(self) -> None:
        expected_assertions = {
            "native_dom_only",
            "source_build_runtime_identity",
            "transcript_exact",
            "thread_exact",
            "toolbar_geometry",
            "toolbar_keyboard_reachable",
            "reaction_picker_success",
            "reaction_authority_readback",
            "reaction_failure_recovery",
            "avatar_exact_loaded",
            "group_avatar_slots_exact",
            "station_attribution_exact",
            "settings_station_readback",
            "settings_restart_recovery",
            "background_upload_recovery",
            "background_rendered",
            "background_second_device_recovery",
            "clear_cursor_station_readback",
            "offline_recovery_exact",
            "restart_exact",
            "attachment_failure_draft_retained",
            "attachment_images_loaded",
            "attachment_count_conservation",
            "attachment_byte_exact",
            "runtime_logs_clean",
            "cleanup_ports_released",
            "cleanup_processes_released",
            "cleanup_storage_released",
        }
        assignment = next(
            node
            for node in self.tree.body
            if isinstance(node, ast.Assign)
            and any(
                isinstance(target, ast.Name)
                and target.id == "REQUIRED_ASSERTIONS"
                for target in node.targets
            )
        )
        self.assertEqual(ast.literal_eval(assignment.value), expected_assertions)

        run_method = next(
            node
            for node in ast.walk(self.tree)
            if isinstance(node, ast.FunctionDef) and node.name == "run"
        )
        fixed_steps = sorted(
            (
                node.lineno,
                str(node.args[0].value),
            )
            for node in ast.walk(run_method)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "step"
            and node.args
            and isinstance(node.args[0], ast.Constant)
        )
        self.assertEqual(
            [name for _, name in fixed_steps],
            [
                "group.create.ui",
                "transcript.thread.ui",
                "toolbar.geometry.ui",
                "reaction.ui",
                "identity.station.dom",
                "settings.background.ui",
                "attachment.failure.ui",
                "attachments.ui",
                "bob.offline.recovery.ui",
                "client.restart.ui",
                "clear.cursor.restart.ui",
                "alice.second-device.recovery.ui",
            ],
        )
        self.assertIn('for actor in ("alice", "bob"):', self.source)

        gate = json.loads(self.gate_catalog)["gates"][
            "chat-native-product-closure-e2e"
        ]
        self.assertEqual(gate["timeout_seconds"], 3600)
        self.assertEqual(
            gate["requiredRuntimeCells"],
            [
                "desktop-macos-native",
                "desktop-linux-native",
                "desktop-windows-native",
            ],
        )

    def test_chat_gates_contain_no_platform_native_implementation(self) -> None:
        forbidden = (
            "AppKit",
            "Quartz",
            "CoreGraphics",
            "ApplicationServices",
            "CGEvent",
            "CGWindow",
            "AXUIElement",
            "NSRunningApplication",
            "osascript",
            "System Events",
            "pbcopy",
            "pbpaste",
        )
        gate_root = RUNNER.parent
        offenders = {
            str(path.relative_to(ROOT)): [
                marker
                for marker in forbidden
                if marker in path.read_text(encoding="utf-8")
            ]
            for path in gate_root.glob("*.py")
            if not path.name.endswith("_test.py")
        }
        self.assertEqual(
            {path: markers for path, markers in offenders.items() if markers},
            {},
        )

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
        for platform_api in (
            "AppKit",
            "Quartz",
            "CoreGraphics",
            "ApplicationServices",
            "CGEvent",
            "CGWindow",
            "AXUIElement",
            "NSRunningApplication",
            "osascript",
            "System Events",
            "pbcopy",
            "pbpaste",
        ):
            self.assertNotIn(platform_api, self.source)
        self.assertIn("CGEventCreateMouseEvent", self.macos_adapter)
        self.assertIn("CGEventPost", self.macos_adapter)
        self.assertNotIn("CGEventPostToPid", self.macos_adapter)
        self.assertIn("document.hasFocus()", self.source)
        self.assertIn("PT_ACCEPTANCE_WINDOW_SLOT", self.source)
        self.assertIn("PT_ACCEPTANCE_WINDOW_COUNT", self.source)
        self.assertNotIn("libc.usleep", self.source)
        self.assertIn("install_native_input_probe", self.source)
        self.assertIn("wait_native_input_event", self.source)
        self.assertIn("if native_mousedown_debug_enabled():", self.source)
        self.assertIn('event.get("owned") is True', self.source)
        self.assertIn("NATIVE_INPUT_ACK_POLL_SECONDS", self.source)
        self.assertIn("poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS", self.source)
        self.assertIn("'mousemove'", self.source)
        self.assertIn('"mousedown"', self.source)
        self.assertIn('"mouseup"', self.source)
        self.assertIn('"click"', self.source)
        self.assertIn("CGEventSourceButtonState", self.macos_adapter)
        self.assertIn("window_stack_at_point", self.source)
        self.assertIn(
            "int(frontmost_app.processIdentifier()) if frontmost_app else -1",
            self.macos_adapter,
        )
        self.assertIn(
            'copied_boolean(front_window, "AXMain")',
            self.macos_adapter,
        )
        self.assertIn(
            'copied_boolean(front_window, "AXFocused")',
            self.macos_adapter,
        )
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
            "if mouse_down_posted:",
            click_source,
        )
        self.assertIn(
            "self.native_adapter.release_stuck_mouse_button(point)",
            click_source,
        )
        self.assertIn(
            '"Native click target changed before event delivery"',
            click_source,
        )
        self.assertLess(
            click_source.index("current_target = client.driver.execute_script("),
            click_source.index(
                "self.native_adapter.post_mouse(\n"
                "                (\n"
                "                    MouseAction.LEFT_DOWN,\n"
                "                    MouseAction.LEFT_UP,\n"
                "                ),"
            ),
        )
        self.assertEqual(
            click_source.count("self.native_adapter.post_mouse("),
            1,
        )
        self.assertNotIn(
            'report_native_input_delivery("before-click")',
            click_source,
        )
        selector_click_start = self.source.index(
            "    def click(self, actor: str, selector: str",
            click_end,
        )
        selector_click_end = self.source.index(
            "    def hover_message(",
            selector_click_start,
        )
        selector_click_source = self.source[selector_click_start:selector_click_end]
        self.assertLess(
            selector_click_source.index("self.focus_actor_window(actor)"),
            selector_click_source.index("client.find_element(selector, timeout)"),
        )
        self.assertIn(
            "return self._click_focused_element(client, element)",
            selector_click_source,
        )
        self.assertNotIn("self.click_element(actor, element)", selector_click_source)
        self.assertNotIn("staging_point", self.source)
        self.assertIn(
            "CGEventCreateMouseEvent(\n                None,",
            self.macos_adapter,
        )
        self.assertIn(".send_keys(", self.source)

    def test_transient_native_actions_resolve_after_idempotent_focus(self) -> None:
        self.assertIn("def actor_window_owns_point() -> bool:", self.source)
        self.assertIn(
            "def capture_native_activation_diagnostic(",
            self.source,
        )
        self.assertIn(
            'set value of attribute "AXMain"',
            self.macos_adapter,
        )
        self.assertNotIn(
            'set value of attribute "AXFocused"',
            self.macos_adapter,
        )
        focus_start = self.source.index(
            "    def focus_actor_window(self, actor: str) -> TauriSession:"
        )
        focus_end = self.source.index(
            "    def click_element(self, actor: str, element: Any) -> Any:",
            focus_start,
        )
        focus_source = self.source[focus_start:focus_end]
        recovery_index = focus_source.index(
            "if self.native_adapter.mouse_button_down():"
        )
        cooperative_index = focus_source.index(
            "self.runtime_binding.request_cooperative_activation("
        )
        activation_index = focus_source.index(
            "self.native_adapter.activate_process(client.process_id)"
        )
        focus_wait_index = focus_source.index(
            "lambda _: actor_window_owns_point()",
            activation_index,
        )
        focus_down_index = focus_source.index(
            "(MouseAction.LEFT_DOWN,)",
            focus_wait_index,
        )
        focus_up_index = focus_source.index(
            "(MouseAction.LEFT_UP,)",
            focus_down_index,
        )
        document_focus_index = focus_source.index(
            'lambda driver: bool(driver.execute_script("return document.hasFocus()"))',
            focus_up_index,
        )
        self.assertIn(
            "NSRunningApplication.runningApplicationWithProcessIdentifier_",
            self.macos_adapter,
        )
        self.assertIn("NSApplicationActivateAllWindows", self.macos_adapter)
        self.assertIn(
            "NSApplicationActivateIgnoringOtherApps",
            self.macos_adapter,
        )
        local_binding_start = self.runtime_binding.index(
            "class LocalMacOSRuntimeBinding("
        )
        yield_start = self.runtime_binding.index(
            "    def request_cooperative_activation(",
            local_binding_start,
        )
        yield_end = self.runtime_binding.index(
            "    def binary_identity(",
            yield_start,
        )
        yield_source = self.runtime_binding[yield_start:yield_end]
        self.assertIn('"acceptance_yield_activation"', yield_source)
        self.assertIn('"acceptance_request_activation"', yield_source)
        self.assertNotIn("call_async_harness", yield_source)
        self.assertIn(
            "window.__TAURI_INTERNALS__.invoke(",
            self.runtime_binding,
        )
        self.assertNotIn("acceptance_yield_activation", self.source)
        self.assertLess(
            self.macos_adapter.index("application.activateWithOptions_(options)"),
            self.macos_adapter.index('tell application "System Events"'),
        )
        self.assertIn('perform action "AXRaise"', self.macos_adapter)
        self.assertIn(
            '"before-activation"',
            focus_source,
        )
        self.assertIn(
            '"after-cooperative-request"',
            focus_source,
        )
        self.assertIn(
            '"cooperative-timeout"',
            focus_source,
        )
        self.assertIn(
            '"before-fallback-activation"',
            focus_source,
        )
        self.assertIn(
            '"after-fallback-activation"',
            focus_source,
        )
        self.assertIn(
            '"point-ownership-timeout"',
            focus_source,
        )
        self.assertIn(
            "except TimeoutException:",
            focus_source,
        )
        self.assertIn(
            '"Native cooperative activation timed out: "',
            focus_source,
        )
        self.assertLess(recovery_index, cooperative_index)
        self.assertLess(cooperative_index, activation_index)
        self.assertLess(recovery_index, activation_index)
        self.assertLess(activation_index, focus_wait_index)
        self.assertLess(focus_wait_index, focus_down_index)
        self.assertLess(focus_down_index, focus_up_index)
        self.assertLess(focus_up_index, document_focus_index)
        self.assertIn(
            "self.native_adapter.window_stack_at_point(",
            focus_source,
        )
        self.assertIn(
            ".point_owned_by(client.process_id or 0)",
            focus_source,
        )
        self.assertNotIn(
            'ownership.get("actualFrontmostPid") == client.process_id',
            focus_source,
        )
        self.assertIn(
            "if focus_mouse_down:",
            focus_source,
        )
        self.assertNotIn("MouseAction.MOVE", focus_source)

    def test_native_activation_failure_emits_durable_predicate_evidence(
        self,
    ) -> None:
        self.assertIn(
            '"native-activation-diagnostics",',
            self.source,
        )
        self.assertIn(
            '"documentFocused": document_focused',
            self.source,
        )
        self.assertIn(
            '"expectedProcessId": client.process_id',
            self.source,
        )
        self.assertIn(
            '"pointOwned": window_stack.point_owned_by(',
            self.source,
        )
        self.assertIn(
            '"windowStack": window_stack.to_dict()',
            self.source,
        )
        self.assertIn(
            '"focusedControl": self.native_adapter.focused_control(',
            self.source,
        )
        self.assertIn(
            'self.write_json_evidence(\n'
            '            "native-activation-diagnostics",',
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

    def test_composer_clear_uses_native_keys_without_webdriver_key_literals(
        self,
    ) -> None:
        composer_start = self.source.index(
            "    def composer_send(self, actor: str, text: str = \"\") -> None:"
        )
        composer_end = self.source.index(
            "    def wait_message_text(",
            composer_start,
        )
        composer_source = self.source[composer_start:composer_end]
        self.assertIn(
            "self.native_adapter.post_key(\n"
            "            NativeKey.A,\n"
            "            modifiers=(NativeModifier.PRIMARY,),",
            composer_source,
        )
        self.assertIn(
            "self.native_adapter.post_key("
            "NativeKey.DELETE, private_source=True)",
            composer_source,
        )
        self.assertIn(
            'lambda _: (composer.get_attribute("value") or "") == ""',
            composer_source,
        )
        self.assertNotIn("Keys.COMMAND", composer_source)
        self.assertNotIn("Keys.BACKSPACE", composer_source)

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
        self.assertIn(
            "NSWindowCollectionBehavior::CanJoinAllSpaces",
            self.desktop_main,
        )
        self.assertIn(
            "NSWindowCollectionBehavior::FullScreenAuxiliary",
            self.desktop_main,
        )
        self.assertIn(
            "ns_window.setCollectionBehavior(collection_behavior)",
            self.desktop_main,
        )
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
                "messaging_list_conversations",
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
            "cleanup_processes_released",
            "cleanup_storage_released",
            "offline_recovery_exact",
            "restart_exact",
            "clear_cursor_station_readback",
            "background_rendered",
            "background_second_device_recovery",
            "runtime_logs_clean",
            "binarySha256",
            "save_screenshot",
            "save_dom",
            "conversation_snapshot",
            "background_resource_snapshot",
            "create_recovery_revision",
            "restore_recovery_revision",
            "runtime-launch-ledger",
            "runtime-log-audit",
        ):
            self.assertIn(required, self.source)

    def test_second_device_and_clear_cursor_are_real_runtime_paths(self) -> None:
        self.assertIn(
            '"chat-native-product-closure-e2e": ("alice", "bob", "alice2")',
            self.home_station_provisioner,
        )
        self.assertIn('"alice2": "alice"', self.source)
        self.assertIn('data-chat-history-action="clear"', self.chat_detail_panel)
        self.assertIn('data-chat-history-action="restore"', self.chat_detail_panel)
        self.assertIn("conversation_get_member_settings", self.source)
        self.assertIn("commits_match(source_commit, station_commit)", self.source)
        self.assertIn('RECOVERY_SELECTORS["restore_submit"]', self.source)
        self.assertNotIn("shutil.copy2", self.source)

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

    def test_attachment_content_uses_the_visible_plaintext_marker(self) -> None:
        self.assertIn("data-message-text={message.ulid}", self.message_content)
        self.assertIn(
            "content: row.querySelector('[data-message-text]')?.innerText || ''",
            self.source,
        )
        self.assertIn("data-message-content={message.ulid}", self.message_row)

    def test_product_files_use_real_native_chooser(self) -> None:
        self.assertIn("def choose_native_file(", self.source)
        self.assertIn("NativeDesktopAdapter", self.source)
        self.assertNotIn("create_native_desktop_adapter", self.source)
        self.assertIn("AXUIElementCreateApplication", self.macos_adapter)
        self.assertIn(
            "AXUIElementSetMessagingTimeout(application, 0.5)",
            self.macos_adapter,
        )
        self.assertIn("CGEventCreateKeyboardEvent", self.macos_adapter)
        self.assertIn("CGEventKeyboardSetUnicodeString", self.macos_adapter)
        self.assertIn('"AXFocusedUIElement"', self.macos_adapter)
        self.assertIn('"AXTextField"', self.macos_adapter)
        self.assertIn('"windowCount"', self.macos_adapter)
        self.assertIn('"sheetCount"', self.macos_adapter)
        self.assertIn("timeout=2", self.macos_adapter)
        self.assertIn("def panel_open(", self.source)
        self.assertIn(
            'control.kind in {"list", "text-field"}',
            self.source,
        )
        self.assertIn(
            "control.kind != baseline_control.kind",
            self.source,
        )
        self.assertIn("def native_app_baseline_ready(", self.source)
        self.assertIn("control.window_count >= 1", self.source)
        self.assertIn("control.main_window", self.source)
        self.assertIn("control.frontmost", self.source)
        self.assertIn('control.kind != "application-dialog"', self.source)
        self.assertIn('return {"selected": True, "control": control}', self.source)
        self.assertIn(
            "NativeKey.A,\n"
            "            modifiers=(NativeModifier.PRIMARY,),",
            self.source,
        )
        self.assertIn("NativeKey.DELETE, private_source=True", self.source)
        self.assertIn('control.value == ""', self.source)
        self.assertIn(
            "poll_frequency=NATIVE_INPUT_ACK_POLL_SECONDS",
            self.source,
        )
        self.assertIn("self.native_adapter.read_clipboard()", self.source)
        self.assertIn(
            "self.native_adapter.write_clipboard(original_clipboard)",
            self.source,
        )
        self.assertIn('control.value == str(selected_path)', self.source)
        self.assertIn(
            "NativeKey.G,\n"
            "            modifiers=(NativeModifier.PRIMARY, NativeModifier.SHIFT),",
            self.source,
        )
        self.assertIn(
            "NativeKey.V,\n"
            "                modifiers=(NativeModifier.PRIMARY,),",
            self.source,
        )
        self.assertIn("NativeKey.ENTER", self.source)
        self.assertIn(
            '"Native Accessibility probe timed out"',
            self.macos_adapter,
        )
        self.assertIn("def selection_or_browser_ready(", self.source)
        self.assertIn("baseline_window_count", self.source)
        self.assertIn('control.kind == "application-dialog"', self.source)
        self.assertIn(
            "core_graphics.CGEventSourceCreate(-1)",
            self.macos_adapter,
        )
        self.assertIn('control.kind != "application-dialog"', self.source)
        self.assertIn("NATIVE_FILE_TRANSITION_TIMEOUT_SECONDS", self.source)
        self.assertIn("def native_app_baseline_ready(", self.source)
        self.assertIn('def native_window_restored(', self.source)
        self.assertIn('control.kind != "unknown"', self.source)
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
        self.assertIn("select.closest('[role=\"dialog\"]')", self.source)
        self.assertIn("style.pointerEvents !== 'none'", self.source)

    def test_transient_dialogs_stop_hit_testing_before_next_journey(self) -> None:
        self.assertIn(
            "def wait_for_dialogs_to_stop_intercepting(self, actor: str)",
            self.source,
        )
        self.assertIn(
            "dialog remained hit-testable after dismissal",
            self.source,
        )
        self.assertIn(
            "document.querySelectorAll('[role=\"dialog\"]')",
            self.source,
        )
        settings_start = self.source.index("    def prove_settings_background(")
        settings_end = self.source.index(
            "    def prove_attachment_failure(",
            settings_start,
        )
        settings_source = self.source[settings_start:settings_end]
        self.assertIn(
            'self.wait_for_dialogs_to_stop_intercepting("alice")',
            settings_source,
        )
        attachment_end = self.source.index(
            "    def attachment_message(",
            settings_end,
        )
        attachment_failure_source = self.source[settings_end:attachment_end]
        self.assertIn(
            'self.wait_for_dialogs_to_stop_intercepting("alice")',
            attachment_failure_source,
        )

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
        self.assertIn(
            "self.runtime_binding.expose_orchestrator_endpoint(",
            self.source,
        )
        self.assertIn("actor_station_url = (", self.source)
        self.assertIn("self.reaction_endpoint_url", self.source)
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
        self.assertIn("reaction_proxy_port", self.source)
        self.assertLess(
            self.source.index("self.reaction_proxy.start()"),
            self.source.index(
                "self.runtime_binding.expose_orchestrator_endpoint("
            ),
        )

    def test_runtime_endpoint_releases_before_local_proxy(self) -> None:
        cleanup_start = self.source.index("    def cleanup_clients(")
        cleanup_end = self.source.index(
            "    def run(",
            cleanup_start,
        )
        cleanup_source = self.source[cleanup_start:cleanup_end]

        self.assertLess(
            cleanup_source.index("self.runtime_binding.finalize_cleanup("),
            cleanup_source.index("self.reaction_proxy.stop()"),
        )

    def test_station_attribution_evidence_serializes_sets_as_lists(self) -> None:
        self.assertIn("station_sets_detail = [", self.source)
        self.assertIn('"engine": engine_authorities', self.source)
        self.assertIn('station_sets["alice"] == {expected_authority}', self.source)
        self.assertNotIn("json.dumps(station_sets)", self.source)

    def test_avatar_proof_waits_for_exact_loaded_surfaces(self) -> None:
        member_avatar_start = self.chat_detail_panel.index("function MemberAvatar(")
        member_avatar_end = self.chat_detail_panel.index(
            "function MemberPreviewCard(",
            member_avatar_start,
        )
        member_avatar = self.chat_detail_panel[
            member_avatar_start:member_avatar_end
        ]
        self.assertIn("<SquareAvatar", member_avatar)
        self.assertIn("remoteUrl={member.avatar}", member_avatar)
        self.assertNotIn("<img", member_avatar)
        self.assertIn("def loaded_snapshot()", self.source)
        self.assertIn('f"{actor} exact loaded avatar surfaces"', self.source)
        self.assertIn('"conversation-list"', self.source)
        self.assertIn('"timeline"', self.source)
        self.assertIn('"thread"', self.source)
        self.assertIn('"details"', self.source)
        self.assertIn("len(canonical) == 1", self.source)
        self.assertGreaterEqual(self.source.count("client_sources["), 3)
        self.assertIn("all(entry.get(\"loaded\") for entry in entries)", self.source)
        self.assertIn("expected_cache_key", self.source)
        self.assertIn('sources["current"]', self.source)
        self.assertIn('snapshot["groupSlots"]', self.source)
        self.assertIn('slot["ptid"] for slot in slot_sets["alice"]', self.source)
        self.assertIn('slot_identity["alice"] == slot_identity["bob"]', self.source)
        group_slots_start = self.source.index("const groupSlots = Array.from(")
        group_slots_end = self.source.index(
            "return { identities, stationNodes, groupSlots };",
            group_slots_start,
        )
        group_slots_source = self.source[group_slots_start:group_slots_end]
        self.assertIn("`${url.pathname}${url.search}`", group_slots_source)
        self.assertNotIn("new URL(src, document.baseURI).href", group_slots_source)
        self.assertNotIn(
            'if entry.get("surface") == "conversation-list"',
            self.source,
        )

    def test_attachment_image_assertion_rejects_an_empty_image_set(self) -> None:
        self.assertIn("imageCount: images.length", self.source)
        self.assertIn("imageLoaded: images.length > 0", self.source)
        self.assertIn('image_attachments[0]["imageCount"] > 0', self.source)

    def test_runtime_audit_fails_closed_on_missing_resources(self) -> None:
        self.assertIn('"runtime log missing"', self.source)
        self.assertIn('"runtime log empty"', self.source)
        self.assertIn(
            're.compile(r"active conversation membership required")',
            self.source,
        )
        self.assertIn(
            're.compile(r"/conversation/members")',
            self.source,
        )
        self.assertIn(r"unhandled(?: promise)? rejection", self.source)
        self.assertIn(
            "self.runtime_binding.finalize_cleanup(",
            self.source,
        )
        self.assertIn('bool(result["storageReleased"])', self.source)
        self.assertIn('self.write_json_evidence("cleanup", result)', self.source)
        self.assertIn('source.get("workspaceDigest") == "clean"', self.source)
        launch_start = self.source.index("    def launch_actor(")
        launch_end = self.source.index("    def restart_actor(", launch_start)
        launch_source = self.source[launch_start:launch_end]
        self.assertLess(
            launch_source.index("self.runtime_instances.append(client)"),
            launch_source.index("client.start()"),
        )
        self.assertLess(
            launch_source.index("self.runtime_launches.append(attempt)"),
            launch_source.index("client.start()"),
        )
        cleanup_start = self.source.index("    def cleanup_clients(")
        cleanup_end = self.source.index("    def run(", cleanup_start)
        cleanup_source = self.source[cleanup_start:cleanup_end]
        self.assertLess(
            cleanup_source.index("client.stop()"),
            cleanup_source.index("self.audit_runtime_logs()"),
        )
        self.assertIn(
            'self.write_json_evidence(\n'
            '            "runtime-launch-ledger",',
            cleanup_source,
        )
        self.assertNotIn(
            'self.step("runtime.logs.clean"',
            self.source,
        )

    def test_group_creation_waits_for_exact_projected_state_once(self) -> None:
        self.assertIn(
            "trackPendingGroupCreation(conversationId, created.commandId);",
            self.create_group_modal,
        )
        self.assertNotIn(
            "if (created.state === 'pending')",
            self.create_group_modal,
        )
        self.assertIn(
            "if (created.state === 'failed') {",
            self.create_group_modal,
        )
        self.assertIn(
            "conversation => conversation.conversationId === conversationId",
            self.create_group_modal,
        )
        self.assertIn(
            "t('chat.social.encryption.establishing')",
            self.create_group_modal,
        )
        self.assertEqual(self.create_group_modal.count("await loadGroups();"), 1)
        self.assertNotIn("await loadSessions();", self.create_group_modal)
        browser_group_create = self.http_gateway[
            self.http_gateway.index('"messaging_create_group" => {'):
            self.http_gateway.index('"messaging_membership_transition" => {')
        ]
        self.assertIn('.get("conversation_id")', browser_group_create)
        self.assertNotIn("ulid::Ulid::new()", browser_group_create)

    def test_conversation_pane_stays_inside_the_native_viewport(self) -> None:
        self.assertIn("width: 'clamp(180px, 28vw, 280px)'", self.chat_session_list)
        self.assertIn("minWidth: 180", self.chat_session_list)
        self.assertIn("minWidth: 0", self.chat_message_area)
        self.assertNotIn("minWidth: 380", self.chat_message_area)

    def test_message_action_anchor_includes_reaction_and_metadata_rows(self) -> None:
        anchor_index = self.message_row.index("data-message-action-anchor")
        bubble_index = self.message_row.index("data-message-content", anchor_index)
        reaction_index = self.message_row.index("data-message-reaction={emoji}", bubble_index)
        metadata_index = self.message_row.index("formatMsgTime(message.sentAtMs)", reaction_index)
        self.assertLess(anchor_index, bubble_index)
        self.assertLess(bubble_index, reaction_index)
        self.assertLess(reaction_index, metadata_index)
        self.assertNotIn("ref={messageContentRef}", self.message_row)
        self.assertIn("const REACTION_PICKER_COLUMNS = 6", self.message_action_overlay)
        self.assertIn(
            "aria-label={t('chat.social.messageArea.actionReact')}",
            self.message_action_overlay,
        )
        self.assertIn('aria-haspopup="dialog"', self.message_action_overlay)

    def test_keyboard_navigation_waits_for_native_focus_transition(self) -> None:
        keyboard_path_start = self.source.index(
            "def prove_keyboard_reaction_picker(",
        )
        keyboard_path_end = self.source.index(
            "def reaction_visible(",
            keyboard_path_start,
        )
        keyboard_path = self.source[keyboard_path_start:keyboard_path_end]
        tab_post = keyboard_path.index(
            "self.native_adapter.post_key("
            "NativeKey.TAB, private_source=True)"
        )
        focus_wait = keyboard_path.index(
            "WebDriverWait(client.driver, 5).until(",
            tab_post,
        )
        changed_focus = keyboard_path.index("!= action", focus_wait)
        self.assertLess(tab_post, focus_wait)
        self.assertLess(focus_wait, changed_focus)

    def test_reaction_retry_reacquires_transient_dom_action(self) -> None:
        reaction_start = self.source.index("def prove_reaction(")
        reaction_end = self.source.index(
            "def prove_identity_station(",
            reaction_start,
        )
        reaction_source = self.source[reaction_start:reaction_end]

        self.assertIn(
            "return bool(error_surfaces and controlled_loss)",
            reaction_source,
        )
        self.assertIn(
            "f'[data-message-reaction-retry=\"{message_id}\"]'",
            reaction_source,
        )
        self.assertNotIn("error_surface.find_element(", reaction_source)

    def test_attachment_ledger_binds_outcome_engine_and_dom_ids(self) -> None:
        self.assertIn(
            "data-chat-send-outcome-message-id",
            self.chat_composer,
        )
        self.assertIn(
            '"messageId": composer.get_attribute(',
            self.source,
        )
        self.assertIn(
            'str(outcome["messageId"])',
            self.source,
        )
        self.assertIn(
            'str(text_outcome["messageId"])',
            self.source,
        )
        self.assertIn("== set(outcome[\"ids\"])", self.source)
        self.assertIn("!= set(text_outcome[\"ids\"])", self.source)
        self.assertIn("engine_attachment_ids != expected_attachment_ids", self.source)

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
