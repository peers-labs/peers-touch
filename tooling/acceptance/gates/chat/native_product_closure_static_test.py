from __future__ import annotations

import ast
import binascii
import json
import struct
import tempfile
import unittest
import zlib
from pathlib import Path
from unittest.mock import patch

from selenium.webdriver.common.by import By

from tooling.acceptance.core import GateError
from tooling.acceptance.core.evidence import new_report
from tooling.acceptance.gates.chat.native_product_closure_runner import (
    NativeProductClosureGate,
    VALID_ATTACHMENT_IMAGE_BYTES,
    file_sha256,
    native_input_event_cursor,
)


ROOT = Path(__file__).resolve().parents[4]
RUNNER = ROOT / "tooling/acceptance/gates/chat/native_product_closure_runner.py"
ENTRY = ROOT / "tooling/acceptance/gates/chat/native_product_closure_entry.py"
RUNTIME_BINDING = ROOT / "tooling/acceptance/drivers/native/runtime.py"
GATE_CATALOG = ROOT / "tooling/acceptance/gates.yaml"
MACOS_ADAPTER = ROOT / "tooling/acceptance/drivers/native/macos.py"
DESKTOP_MAIN = ROOT / "apps/desktop/src-tauri/src/main.rs"
DESKTOP_CARGO = ROOT / "apps/desktop/src-tauri/Cargo.toml"
DESKTOP_TAURI_CONFIG = ROOT / "apps/desktop/src-tauri/tauri.conf.json"
MESSAGE_ACTION_OVERLAY = (
    ROOT
    / "apps/desktop/src/components/chat/message/ChatMessageActionOverlay.tsx"
)
MESSAGE_TIMELINE = (
    ROOT
    / "apps/desktop/src/components/chat/message/ChatMessageTimeline.tsx"
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
CHAT_SEARCH_DROPDOWN = (
    ROOT / "apps/desktop/src/components/chat/ChatSearchDropdown.tsx"
)
CREATE_GROUP_MODAL = (
    ROOT / "apps/desktop/src/components/chat/CreateGroupModal.tsx"
)
HTTP_GATEWAY = ROOT / "apps/desktop/src-tauri/src/interface/http_gateway/mod.rs"


class SyntheticLinuxRuntimeBinding:
    cell_id = "desktop-linux-native"

    def __init__(self) -> None:
        self.runtime = {
            "artifactKind": "acceptance-runtime-cell-manifest",
            "cellId": self.cell_id,
            "gateId": "chat-native-product-closure-e2e",
            "runId": "cell-run-a",
            "state": "LEASED",
            "platform": {
                "os": "linux",
                "imageDigest": "c" * 64,
            },
            "transport": {
                "hostIdentitySha256": "d" * 64,
                "hostKeySha256": "e" * 64,
            },
            "source": {
                "commit": "commit-a",
                "workspaceDigest": "clean",
                "remoteSourceDigest": "b" * 64,
                "remoteCheckoutClean": True,
                "binarySha256": "a" * 64,
            },
        }
        self.binary = {
            "path": "runtime-cell:desktop-linux-native:cell-run-a:bin",
            "sha256": "a" * 64,
            "sourceCommit": "commit-a",
        }

    def runtime_identity(self) -> dict[str, object]:
        return self.runtime

    def binary_identity(self) -> dict[str, str]:
        return self.binary


class NativeProductClosureStaticTests(unittest.TestCase):
    def setUp(self) -> None:
        station_version = patch(
            "tooling.acceptance.gates.chat.native_product_closure_runner."
            "read_station_version",
            return_value={"build_commit": "commit-a"},
        )
        station_version.start()
        self.addCleanup(station_version.stop)
        self.source = RUNNER.read_text(encoding="utf-8")
        self.entry = ENTRY.read_text(encoding="utf-8")
        self.runtime_binding = RUNTIME_BINDING.read_text(encoding="utf-8")
        self.gate_catalog = GATE_CATALOG.read_text(encoding="utf-8")
        self.macos_adapter = MACOS_ADAPTER.read_text(encoding="utf-8")
        self.desktop_main = DESKTOP_MAIN.read_text(encoding="utf-8")
        self.desktop_cargo = DESKTOP_CARGO.read_text(encoding="utf-8")
        self.desktop_tauri_config = json.loads(
            DESKTOP_TAURI_CONFIG.read_text(encoding="utf-8")
        )
        self.message_action_overlay = MESSAGE_ACTION_OVERLAY.read_text(
            encoding="utf-8"
        )
        self.message_timeline = MESSAGE_TIMELINE.read_text(encoding="utf-8")
        self.message_row = MESSAGE_ROW.read_text(encoding="utf-8")
        self.message_content = MESSAGE_CONTENT.read_text(encoding="utf-8")
        self.home_station_provisioner = HOME_STATION_PROVISIONER.read_text(
            encoding="utf-8"
        )
        self.chat_detail_panel = CHAT_DETAIL_PANEL.read_text(encoding="utf-8")
        self.chat_composer = CHAT_COMPOSER.read_text(encoding="utf-8")
        self.chat_message_area = CHAT_MESSAGE_AREA.read_text(encoding="utf-8")
        self.chat_session_list = CHAT_SESSION_LIST.read_text(encoding="utf-8")
        self.chat_search_dropdown = CHAT_SEARCH_DROPDOWN.read_text(
            encoding="utf-8"
        )
        self.create_group_modal = CREATE_GROUP_MODAL.read_text(encoding="utf-8")
        self.http_gateway = HTTP_GATEWAY.read_text(encoding="utf-8")
        self.tree = ast.parse(self.source)

    def test_client_specs_are_keyed_by_stable_client_id(self) -> None:
        self.assertIn('str(client.get("id")): client', self.source)
        self.assertNotIn('str(client.get("actor")): client', self.source)

    def test_entrypoint_injects_runtime_manifest_into_binding(self) -> None:
        resolution = self.entry.index("resolve_native_desktop_runtime(")
        injection = self.entry.index(
            "runtime_binding.set_runtime_manifest(manifest)"
        )
        construction = self.entry.index("super().__init__(")

        self.assertLess(resolution, injection)
        self.assertLess(injection, construction)

    def source_identity_gate(
        self,
        runtime_binding: SyntheticLinuxRuntimeBinding,
    ) -> NativeProductClosureGate:
        gate = object.__new__(NativeProductClosureGate)
        gate.manifest = {
            "source": {
                "commit": "commit-a",
                "workspaceDigest": "clean",
            },
            "services": {
                "station-four": {
                    "kind": "station",
                    "endpoint": "http://station-four",
                    "liveCommit": "commit-a",
                    "workspaceDigest": "clean",
                    "protocolDigest": "f" * 64,
                },
                "station-five": {
                    "kind": "station",
                    "endpoint": "http://station-five",
                    "liveCommit": "commit-a",
                    "workspaceDigest": "clean",
                    "protocolDigest": "f" * 64,
                },
            },
            "clients": [
                {
                    "id": actor,
                    "actor": actor,
                    "runtime": "native-tauri",
                    "required_service_roles": ["station"],
                    "service_bindings": {
                        "station": {
                            "service_id": service_id,
                            "required_kind": "station",
                        },
                    },
                }
                for actor, service_id in (
                    ("alice", "station-four"),
                    ("bob", "station-five"),
                )
            ],
        }
        gate.runtime_binding = runtime_binding
        gate.station_url = "http://station-four"
        gate.report = new_report(gate.gate_id)
        return gate

    def test_source_identity_binds_linux_cell_host_image_and_binary(self) -> None:
        binding = SyntheticLinuxRuntimeBinding()
        gate = self.source_identity_gate(binding)

        identity = gate.source_identity()

        self.assertEqual(identity["runtimeCell"], binding.runtime)
        self.assertEqual(identity["binary"], binding.binary)
        self.assertEqual(identity["stationLive"]["build_commit"], "commit-a")
        self.assertEqual(gate.report.runtime["runtimeCellRunId"], "cell-run-a")
        self.assertTrue(gate.report.assertions[-1].passed)

    def test_source_identity_rejects_incomplete_or_mismatched_runtime(self) -> None:
        mutations = {
            "missing cell run": lambda binding: binding.runtime.update(
                {"runId": ""}
            ),
            "missing host identity": lambda binding: binding.runtime[
                "transport"
            ].update({"hostIdentitySha256": ""}),
            "missing image digest": lambda binding: binding.runtime[
                "platform"
            ].update({"imageDigest": ""}),
            "dirty remote checkout": lambda binding: binding.runtime[
                "source"
            ].update({"remoteCheckoutClean": False}),
            "missing remote digest": lambda binding: binding.runtime[
                "source"
            ].update({"remoteSourceDigest": ""}),
            "binary digest mismatch": lambda binding: binding.runtime[
                "source"
            ].update({"binarySha256": "9" * 64}),
        }
        for name, mutate in mutations.items():
            with self.subTest(name=name):
                binding = SyntheticLinuxRuntimeBinding()
                mutate(binding)
                gate = self.source_identity_gate(binding)
                with self.assertRaisesRegex(
                    GateError,
                    "source_build_runtime_identity",
                ):
                    gate.source_identity()

    def test_source_identity_rejects_malformed_station_protocol_digest(self) -> None:
        binding = SyntheticLinuxRuntimeBinding()
        gate = self.source_identity_gate(binding)
        gate.manifest["services"]["station-four"]["protocolDigest"] = (
            "not-a-digest"
        )

        with self.assertRaisesRegex(
            GateError,
            "source_build_runtime_identity",
        ):
            gate.source_identity()

    def test_native_click_reveal_leaves_visible_target_unchanged(self) -> None:
        element = object()

        class Driver:
            def execute_script(self, script: str, target: object):
                self.assert_target(target)
                if "rect.width * rect.height" in script:
                    return 1
                if "scrollIntoView" in script:
                    self.fail("visible target must not be scrolled")
                return True

            def assert_target(self, target: object) -> None:
                self_test.assertIs(target, element)

            def fail(self, message: str) -> None:
                self_test.fail(message)

        class Client:
            driver = Driver()

            def find_element(self, selector: str, timeout: float) -> object:
                self_test.fail(
                    f"visible target must not be rebound: {selector} {timeout}"
                )

        self_test = self
        gate = object.__new__(NativeProductClosureGate)
        actual = gate._reveal_native_click_target(
            Client(),
            element,
            selector="[data-action]",
        )
        self.assertIs(actual, element)

    def test_native_click_reveal_rebinds_selector_after_scroll(self) -> None:
        original = object()
        rebound = object()
        events: list[str] = []

        class Driver:
            def execute_script(self, script: str, target: object):
                if "rect.width * rect.height" in script:
                    events.append("resolve")
                    return 1
                if "scrollIntoView" in script:
                    self_test.assertIs(target, original)
                    events.append("scroll")
                    return None
                events.append("visible")
                return target is rebound

        class Client:
            driver = Driver()

            def find_element(self, selector: str, timeout: float) -> object:
                self_test.assertEqual(selector, "[data-action]")
                self_test.assertEqual(timeout, 30)
                events.append("rebind")
                return rebound

        self_test = self
        gate = object.__new__(NativeProductClosureGate)
        actual = gate._reveal_native_click_target(
            Client(),
            original,
            selector="[data-action]",
        )
        self.assertIs(actual, rebound)
        self.assertEqual(
            events,
            [
                "resolve",
                "visible",
                "scroll",
                "rebind",
                "resolve",
                "visible",
            ],
        )

    def test_native_click_resolves_zero_geometry_wrapper(self) -> None:
        interactive_child = object()

        class Wrapper:
            def find_elements(self, by: str, selector: str) -> list[object]:
                self_test.assertEqual(by, By.CSS_SELECTOR)
                self_test.assertIn('[role="button"]', selector)
                return [interactive_child]

        wrapper = Wrapper()

        class Driver:
            def execute_script(self, script: str, target: object):
                if target is wrapper:
                    self_test.assertIn("rect.width * rect.height", script)
                    return 0
                self_test.assertIs(target, interactive_child)
                self_test.assertIn("style.visibility", script)
                return 16

        class Client:
            driver = Driver()

        self_test = self
        gate = object.__new__(NativeProductClosureGate)
        actual = gate._resolve_native_click_surface(Client(), wrapper)
        self.assertIs(actual, interactive_child)

    def test_native_click_resolves_interactive_zero_geometry_root_surface(
        self,
    ) -> None:
        surface = object()

        class Root:
            def find_elements(self, by: str, selector: str) -> list[object]:
                self_test.assertEqual(by, By.CSS_SELECTOR)
                return [] if selector != "*" else [surface]

        root = Root()

        class Driver:
            def execute_script(self, script: str, *targets: object):
                if len(targets) == 1 and targets[0] is root:
                    if ".matches(arguments[1])" in script:
                        self_test.fail("selector argument must be present")
                    return 0
                if len(targets) == 2 and targets[0] is root:
                    if targets[1] == (
                        'button, [role="button"], a[href], '
                        'input, select, textarea'
                    ):
                        return True
                    self_test.assertIs(targets[1], surface)
                    return 24
                self_test.fail(f"unexpected resolver call: {targets}")

        class Client:
            driver = Driver()

        self_test = self
        gate = object.__new__(NativeProductClosureGate)
        actual = gate._resolve_native_click_surface(Client(), root)
        self.assertIs(actual, surface)

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

    def test_native_input_event_cursor_preserves_owned_event_order(self) -> None:
        events = [
            {"type": "mousemove", "owned": True},
            {"type": "mousedown", "owned": False},
            {"type": "mousedown", "owned": True},
            {"type": "mouseup", "owned": True},
            {"type": "click", "owned": True},
        ]

        down_cursor = native_input_event_cursor(events, "mousedown", 0)
        self.assertEqual(down_cursor, 3)
        up_cursor = native_input_event_cursor(events, "mouseup", down_cursor or 0)
        self.assertEqual(up_cursor, 4)
        self.assertEqual(
            native_input_event_cursor(events, "click", up_cursor or 0),
            5,
        )
        self.assertIsNone(native_input_event_cursor(events, "mousedown", 3))

    def test_file_sha256_hashes_attachment_evidence_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            attachment = Path(directory) / "attachment.bin"
            attachment.write_bytes(b"abc")

            self.assertEqual(
                file_sha256(attachment),
                "ba7816bf8f01cfea414140de5dae2223"
                "b00361a396177a9cb410ff61f20015ad",
            )

    def test_attachment_image_fixture_has_valid_png_chunks(self) -> None:
        self.assertEqual(
            VALID_ATTACHMENT_IMAGE_BYTES[:8],
            b"\x89PNG\r\n\x1a\n",
        )
        position = 8
        chunks: dict[bytes, bytes] = {}
        while position < len(VALID_ATTACHMENT_IMAGE_BYTES):
            length = struct.unpack(
                ">I",
                VALID_ATTACHMENT_IMAGE_BYTES[position:position + 4],
            )[0]
            chunk_type = VALID_ATTACHMENT_IMAGE_BYTES[position + 4:position + 8]
            chunk_data = VALID_ATTACHMENT_IMAGE_BYTES[
                position + 8:position + 8 + length
            ]
            chunk_crc = struct.unpack(
                ">I",
                VALID_ATTACHMENT_IMAGE_BYTES[
                    position + 8 + length:position + 12 + length
                ],
            )[0]
            self.assertEqual(
                chunk_crc,
                binascii.crc32(chunk_type + chunk_data) & 0xFFFFFFFF,
            )
            chunks[chunk_type] = chunk_data
            position += 12 + length

        self.assertEqual(position, len(VALID_ATTACHMENT_IMAGE_BYTES))
        self.assertEqual(zlib.decompress(chunks[b"IDAT"]), b"\x00\xff\x00\x00\xff")

    def test_runner_consumes_injected_runtime_without_local_fallback(self) -> None:
        self.assertIn(
            "runtime_binding: NativeDesktopRuntimeBinding",
            self.source,
        )
        self.assertIn(
            "self.runtime_binding.create_bound_session(",
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
            "visible_ui_has_no_i18n_keys",
            "conversation_search_open_exact",
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
                "conversation.search.ui",
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
                "localization.visible",
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

    def test_harness_methods_are_bounded_and_static(self) -> None:
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
        self.assertEqual(
            sorted(methods),
            [
                "conversationMemberSettings",
                "engineConversations",
                "engineMessages",
                "getRealtimeDevice",
                "hydrateActiveActor",
                "loginWithPassword",
                "openAttachment",
            ],
        )
        self.assertIn(
            "self.launch_actor(\n"
            "            actor,\n"
            "            restore_session=True,\n"
            "            restored_from=predecessor,",
            self.source,
        )
        self.assertIn(
            "self.client_lifecycles.stop_preserving_session("
            "self.clients[actor])",
            self.source,
        )
        offline_start = self.source.index("    def prove_offline_recovery(")
        offline_end = self.source.index(
            "    def prove_restart(",
            offline_start,
        )
        offline_source = self.source[offline_start:offline_end]
        self.assertIn(
            'self.stop_actor_for_restart("bob")',
            offline_source,
        )
        self.assertIn(
            'self.restore_actor_after_restart("bob")',
            offline_source,
        )
        self.assertNotIn(
            'self.clients["bob"].stop()',
            offline_source,
        )
        launch_actor = next(
            node
            for node in ast.walk(self.tree)
            if isinstance(node, ast.FunctionDef)
            and node.name == "launch_actor"
        )
        launch_source = ast.get_source_segment(self.source, launch_actor) or ""
        self.assertNotIn("station.auth_logout()", launch_source)

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
        self.assertIn("window_slot", self.source)
        self.assertIn("window_count", self.source)
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
        self.assertIn("def _resolve_native_click_surface(", click_source)
        self.assertIn("if float(root_area or 0) > 0:", click_source)
        self.assertIn("element.find_elements(", click_source)
        self.assertIn("if len(interactive) == 1:", click_source)
        self.assertIn(
            '"return arguments[0].matches(arguments[1]);"',
            click_source,
        )
        self.assertIn("resolved = max(", click_source)
        self.assertNotIn("return element;", click_source)
        self.assertIn(
            "Native click target has no unique interactive surface",
            click_source,
        )
        self.assertIn("def _reveal_native_click_target(", click_source)
        self.assertIn("if not center_is_in_view():", click_source)
        self.assertIn("arguments[0].scrollIntoView({", click_source)
        self.assertIn("block: 'center'", click_source)
        self.assertIn("inline: 'nearest'", click_source)
        self.assertIn(
            "element = client.find_element(selector, 30)",
            click_source,
        )
        self.assertLess(
            click_source.index("arguments[0].scrollIntoView({"),
            click_source.index("target = client.driver.execute_script("),
        )
        self.assertIn("if focus_target:", click_source)
        self.assertLess(
            click_source.index(
                '"arguments[0].focus({ preventScroll: true });"'
            ),
            click_source.index("target = client.driver.execute_script("),
        )
        self.assertLess(
            click_source.index("target = client.driver.execute_script("),
            click_source.index("probe_id = self.install_native_input_probe("),
        )
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
            "content_origin = native_origin or self.native_content_origin(client)",
            click_source,
        )
        self.assertLess(
            click_source.index(
                "content_origin = native_origin or self.native_content_origin(client)"
            ),
            click_source.index("current_target = client.driver.execute_script("),
        )
        self.assertLess(
            click_source.index("current_target = client.driver.execute_script("),
            click_source.index("probe_id = self.install_native_input_probe("),
        )
        self.assertLess(
            click_source.index("probe_id = self.install_native_input_probe("),
            click_source.index(
                "self.native_adapter.post_mouse_to_process(\n"
                "                process_id,\n"
                "                (\n"
                "                    MouseAction.MOVE,\n"
                "                    MouseAction.LEFT_DOWN,\n"
                "                    MouseAction.LEFT_UP,\n"
                "                ),"
            ),
        )
        self.assertEqual(
            click_source.count("self.native_adapter.post_mouse_to_process("),
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
            "return self._click_focused_element(\n"
            "            client,\n"
            "            element,\n"
            "            selector=selector,\n"
            "        )",
            selector_click_source,
        )
        self.assertIn("selector=selector,", click_source)
        self.assertIn(
            'float(current_target["x"]),',
            click_source,
        )
        self.assertIn('float(current_target["y"]),', click_source)
        self.assertIn("let deliveredPoint = null;", self.source)
        self.assertIn("const mutations = [];", self.source)
        self.assertIn("reactionStates: inspectReactionStates()", self.source)
        self.assertIn("probeSnapshot: probe?.snapshot?.() || null", self.source)
        self.assertIn(
            "const anchoredPoint = deliveredPoint || expectedPoint;",
            self.source,
        )
        self.assertIn(
            "Math.abs(event.clientY - anchoredPoint.y) <= 2",
            self.source,
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
        point_ownership_wait_index = focus_source.index(
            "lambda _: actor_window_owns_point()",
        )
        fallback_document_focus_index = focus_source.index(
            "lambda driver: bool(\n"
            '                    driver.execute_script("return document.hasFocus()")',
            activation_index,
        )
        focus_down_index = focus_source.index(
            "MouseAction.LEFT_DOWN,",
            fallback_document_focus_index,
        )
        focus_up_index = focus_source.index(
            "MouseAction.LEFT_UP,",
            focus_down_index,
        )
        click_document_focus_index = focus_source.index(
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
        self.assertNotIn('"after-cooperative-request"', focus_source)
        self.assertIn(
            '"cooperative-timeout"',
            focus_source,
        )
        self.assertIn(
            '"before-fallback-activation"',
            focus_source,
        )
        self.assertNotIn('"after-fallback-activation"', focus_source)
        self.assertIn(
            '"point-ownership-timeout"',
            focus_source,
        )
        self.assertIn('"fallback-focus-timeout"', focus_source)
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
        self.assertLess(point_ownership_wait_index, activation_index)
        self.assertLess(activation_index, fallback_document_focus_index)
        self.assertLess(fallback_document_focus_index, focus_down_index)
        self.assertLess(focus_down_index, focus_up_index)
        self.assertLess(focus_up_index, click_document_focus_index)
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
        mouse_enter = self.message_action_overlay.index(
            "      onMouseEnter={() => {",
            pointer_down,
        )
        pointer_down_source = self.message_action_overlay[
            pointer_down:mouse_enter
        ]
        self.assertIn("pointerInsideRef.current = true;", pointer_down_source)
        self.assertIn("onHoverEnter();", pointer_down_source)
        self.assertIn("onMouseLeave={() => {", self.message_action_overlay)
        self.assertNotIn("onPointerEnter={() => {", self.message_action_overlay)
        self.assertNotIn("onPointerLeave={() => {", self.message_action_overlay)

    def test_message_action_click_stays_scoped_after_native_hover(self) -> None:
        action_start = self.source.index(
            "    def click_message_action("
        )
        action_end = self.source.index(
            "    def composer_send(",
            action_start,
        )
        action_source = self.source[action_start:action_end]

        self.assertIn(
            "client = self.focus_actor_window(actor)",
            action_source,
        )
        self.assertIn(
            "native_origin = self.native_content_origin(client)",
            action_source,
        )
        self.assertIn(
            "toolbar = self.hover_message(actor, message_id)",
            action_source,
        )
        self.assertIn(
            "element = toolbar.find_element(",
            action_source,
        )
        self.assertIn(
            "selector = MESSAGE_ACTION_SELECTORS.get(action)",
            action_source,
        )
        self.assertIn(
            'raise GateError(f"unsupported message action: {action}")',
            action_source,
        )
        self.assertIn(
            "return self._click_focused_element(\n"
            "            client,\n"
            "            element,\n"
            "            native_origin=native_origin,\n"
            "            focus_target=False,\n"
            "        )",
            action_source,
        )
        self.assertNotIn("self.click(", action_source)
        self.assertLess(
            action_source.index("native_origin = self.native_content_origin(client)"),
            action_source.index("toolbar = self.hover_message(actor, message_id)"),
        )

        transcript_start = self.source.index(
            "    def prove_transcript_thread("
        )
        transcript_end = self.source.index(
            "    def overlay_geometry(",
            transcript_start,
        )
        transcript_source = self.source[transcript_start:transcript_end]
        self.assertIn(
            'self.click_message_action("alice", str(bob_root["id"]), "reply")',
            transcript_source,
        )
        self.assertIn(
            'self.click_message_action("alice", str(bob_root["id"]), "thread")',
            transcript_source,
        )
        self.assertNotIn(
            'self.click("alice", \'[data-message-action=',
            transcript_source,
        )

    def test_message_actions_are_owned_by_the_conversation_pane_overlay(self) -> None:
        self.assertIn("<ChatMessageActionOverlay", self.message_timeline)
        self.assertIn("onActionTargetChange={activateActions}", self.message_timeline)
        self.assertIn("data-message-action-overlay-host", self.chat_message_area)
        self.assertIn("ref={messageActionAnchorRef}", self.message_row)
        self.assertNotIn("function HoverActions(", self.message_row)
        self.assertNotIn("msg-hover-actions", self.message_row)

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

    def test_authenticated_readbacks_use_the_owning_tauri_window(self) -> None:
        self.assertNotIn("gateway_read(", self.source)
        self.assertNotIn("urllib.request", self.source)
        for method in (
            "engineMessages",
            "engineConversations",
            "conversationMemberSettings",
            "openAttachment",
        ):
            with self.subTest(method=method):
                self.assertIn(f'"{method}"', self.source)
        self.assertIn('"actorPtid": self.ptids[actor]', self.source)
        self.assertIn(
            "self.runtime_binding.native_file_sha256(",
            self.source,
        )
        self.assertNotIn(
            "if not local_path.is_file():",
            self.source,
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
        self.assertIn('"conversationMemberSettings"', self.source)
        self.assertNotIn("conversation_get_member_settings", self.source)
        self.assertIn("commits_match(source_commit, station_commit)", self.source)
        self.assertIn('RECOVERY_SELECTORS["restore_submit"]', self.source)
        self.assertNotIn("shutil.copy2", self.source)

    def test_confirmation_waits_for_the_visible_native_click_surface(self) -> None:
        confirmation = self.source.split(
            "    def click_confirmation(",
            maxsplit=1,
        )[1].split(
            "    def prove_clear_cursor(",
            maxsplit=1,
        )[0]

        self.assertIn("wait_until(", confirmation)
        self.assertIn('".ant-modal-confirm .ant-btn-primary"', confirmation)
        self.assertIn("timeout=30", confirmation)
        self.assertIn("self.click_element(actor, confirmation)", confirmation)
        self.assertNotIn("execute_script", confirmation)

    def test_recovery_latches_transient_lobehub_toast_roles(self) -> None:
        create_recovery = self.source.split(
            "    def create_recovery_revision(",
            maxsplit=1,
        )[1].split(
            "    def restore_recovery_revision(",
            maxsplit=1,
        )[0]
        restore_recovery = self.source.split(
            "    def restore_recovery_revision(",
            maxsplit=1,
        )[1].split(
            "    def prove_second_device(",
            maxsplit=1,
        )[0]

        self.assertIn(
            '"feedback": \'[role="dialog"], [role="alertdialog"]\'',
            self.source,
        )
        self.assertIn(
            'RECOVERY_SELECTORS["feedback"]',
            self.source.split(
                "    def arm_recovery_feedback_probe(",
                maxsplit=1,
            )[1].split(
                "    def create_recovery_revision(",
                maxsplit=1,
            )[0],
        )
        create_arm = create_recovery.index(
            "self.arm_recovery_feedback_probe(actor)"
        )
        create_click = create_recovery.index(
            'self.click(actor, RECOVERY_SELECTORS["backup"])'
        )
        self.assertLess(create_arm, create_click)
        self.assertIn("self.recovery_feedback_observed(actor)", create_recovery)
        restore_arm = restore_recovery.index(
            "self.arm_recovery_feedback_probe(actor)"
        )
        restore_click = restore_recovery.index(
            'self.click(actor, RECOVERY_SELECTORS["restore_submit"])'
        )
        self.assertLess(restore_arm, restore_click)
        self.assertIn("self.recovery_feedback_observed(actor)", restore_recovery)
        self.assertIn(
            'RECOVERY_SELECTORS["restore_input"]',
            restore_recovery,
        )
        self.assertIn(
            "window.__PT_RECOVERY_FEEDBACK_PROBE__?.cleanup?.()",
            self.source,
        )
        self.assertIn(
            "const preexisting = new WeakSet(",
            self.source,
        )
        self.assertIn("if (preexisting.has(candidate)) continue;", self.source)
        self.assertIn("bounds.width > 0", self.source)
        self.assertIn("bounds.height > 0", self.source)
        self.assertNotIn(
            'find_elements(\n'
            '                        By.CSS_SELECTOR,\n'
            '                        RECOVERY_SELECTORS["feedback"],',
            create_recovery + restore_recovery,
        )

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
        preview_scope = messaging[
            messaging.index("fn allow_attachment_preview("):
            messaging.index(
                "#[tauri::command]\npub async fn messaging_pick_attachment_source",
            )
        ]
        self.assertIn(".allow_file(path)", preview_scope)
        self.assertIn("allow messaging attachment preview", preview_scope)
        self.assertNotIn("tauri::async_runtime::spawn", preview_scope)
        self.assertNotIn("reqwest::Client", preview_scope)
        self.assertNotIn("127.0.0.1", preview_scope)
        self.assertNotIn("reqwest::blocking::Client", preview_scope)
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
        transcript_start = self.source.index("    def transcript(")
        transcript_end = self.source.index(
            "    def engine_messages(",
            transcript_start,
        )
        transcript_source = self.source[transcript_start:transcript_end]
        self.assertIn(
            "row.querySelector('[data-message-text]')",
            transcript_source,
        )
        self.assertNotIn(
            "row.querySelector('[data-message-content]')",
            transcript_source,
        )

    def test_product_files_use_real_native_chooser(self) -> None:
        self.assertIn("def choose_native_file(", self.source)
        self.assertIn("NativeDesktopAdapter", self.source)
        self.assertNotIn("create_native_desktop_adapter", self.source)
        self.assertIn(
            "self.runtime_binding.stage_native_file(",
            self.source,
        )
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
            "self.native_adapter.reveal_file_chooser_location()",
            self.source,
        )
        self.assertNotIn(
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
        selection_start = self.source.index(
            "        def selection_or_browser_ready("
        )
        selection_end = self.source.index(
            "        intermediate = WebDriverWait(",
            selection_start,
        )
        selection_source = self.source[selection_start:selection_end]
        self.assertIn("control.main_window", selection_source)
        self.assertIn("control.frontmost", selection_source)
        self.assertIn("control.focused_window", selection_source)
        self.assertNotIn('control.kind == "unknown"', selection_source)
        self.assertIn(
            "core_graphics.CGEventSourceCreate(-1)",
            self.macos_adapter,
        )
        self.assertIn('control.kind != "application-dialog"', self.source)
        self.assertIn("NATIVE_FILE_TRANSITION_TIMEOUT_SECONDS", self.source)
        self.assertIn("def native_app_baseline_ready(", self.source)
        self.assertIn('def native_window_restored(', self.source)
        restored_start = self.source.index("        def native_window_restored(")
        restored_end = self.source.index(
            "        WebDriverWait(",
            restored_start,
        )
        restored_source = self.source[restored_start:restored_end]
        self.assertIn("control.main_window", restored_source)
        self.assertIn("control.frontmost", restored_source)
        self.assertIn("control.focused_window", restored_source)
        self.assertNotIn('control.kind != "unknown"', restored_source)
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
        refreshed = settings_source.index(
            'self.runtime_binding.stage_native_file("alice", empty_image)'
        )
        retried = settings_source.index('self.click_element("alice", retry)')
        self.assertLess(refreshed, retried)
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
            "self.runtime_binding.create_transport_override(",
            self.source,
        )
        self.assertIn(
            "self.runtime_binding.apply_transport_override(",
            self.source,
        )
        self.assertIn(
            "self.runtime_binding.clear_transport_override(",
            self.source,
        )
        self.assertNotIn("expose_orchestrator_endpoint(", self.source)
        self.assertNotIn("reaction_endpoint_url", self.source)
        self.assertNotIn(
            '"PEERS_STATION_URL"', self.source,
            "D-18: Station URL must not be injected by runners",
        )
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
                "self.runtime_binding.create_transport_override("
            ),
        )
        launch_start = self.source.index("    def launch_actor(")
        launch_end = self.source.index("\n    def ", launch_start + 8)
        launch_source = self.source[launch_start:launch_end]
        self.assertLess(
            launch_source.index(
                "self.runtime_binding.apply_transport_override("
            ),
            launch_source.index('"loginWithPassword"'),
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

    def test_attachment_failure_proves_retry_retains_draft_without_message(
        self,
    ) -> None:
        self.assertIn(
            'empty_attachment = self.fixture_root / "w13-empty-attachment.png"',
            self.source,
        )
        start = self.source.index("    def prove_attachment_failure(")
        end = self.source.index("    def attachment_message(", start)
        journey = self.source[start:end]
        self.assertIn("before_ids == staged_ids == after_retry_ids", journey)
        self.assertIn('self.click_element("alice", buttons[0])', journey)
        self.assertIn('data-chat-attachment-attempt', journey)
        self.assertIn('evidence["retainedAttempt"] > staged_attempt', journey)
        self.assertIn("and bool(preview)", journey)
        self.assertIn("and retained_preview == preview", journey)
        self.assertIn(
            "failed attachment draft retained after retry",
            journey,
        )
        self.assertIn('evidence["retainedStatus"] == "failed"', journey)
        self.assertIn("len(buttons) >= 2", journey)
        self.assertIn("len(retained_buttons) >= 2", journey)
        self.assertIn(
            'self.click_element("alice", retained_buttons[1])',
            journey,
        )
        self.assertIn(
            "failed attachment draft removed before the success journey",
            journey,
        )
        self.assertIn(
            "data-chat-attachment-attempt={item.attempt}",
            self.chat_composer,
        )
        self.assertNotIn(
            'self.assert_condition("attachment_failure_draft_retained", True)',
            journey,
        )

        retry_index = self.chat_composer.index(
            "onClick={() => retryDraft(item.id)}"
        )
        remove_index = self.chat_composer.index(
            "onClick={() => removeDraft(item.id)}",
            retry_index,
        )
        self.assertLess(retry_index, remove_index)

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
            launch_source.index(
                "self.runtime_binding.create_bound_session("
            ),
            launch_source.index("self.runtime_instances.append(client)"),
        )
        self.assertLess(
            launch_source.index("self.runtime_launches.append(attempt)"),
            launch_source.index(
                "self.client_lifecycles.mark_live(client)"
            ),
        )
        cleanup_start = self.source.index("    def cleanup_clients(")
        cleanup_end = self.source.index("    def run(", cleanup_start)
        cleanup_source = self.source[cleanup_start:cleanup_end]
        self.assertLess(
            cleanup_source.index(
                "self.client_lifecycles.release(client)"
            ),
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

    def test_product_failure_remains_primary_when_cleanup_also_fails(self) -> None:
        gate = object.__new__(NativeProductClosureGate)
        gate.steps = []
        gate.report = new_report(gate.gate_id)

        with self.assertRaisesRegex(GateError, "group timed out"):
            gate.step(
                "group.create.ui",
                lambda: (_ for _ in ()).throw(GateError("group timed out")),
            )

        self.assertEqual(gate.report.runtime["firstFailedStep"], "group.create.ui")
        self.assertEqual(
            gate.report.runtime["steps"],
            [{
                "step": "group.create.ui",
                "status": "fail",
                "error": "group timed out",
            }],
        )
        self.assertIn(
            "cleanup = cleanup_preserving_primary_failure(",
            self.source,
        )
        self.assertIn('self.report.runtime["cleanup"] = result', self.source)

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

    def test_session_list_error_is_bounded_and_replaces_empty_state(self) -> None:
        self.assertIn("data-chat-session-list-error", self.chat_session_list)
        self.assertIn("data-chat-session-list-retry", self.chat_session_list)
        self.assertIn(
            "loadError && visibleConversations.length > 0",
            self.chat_session_list,
        )
        self.assertIn(
            "loadError && visibleConversations.length === 0",
            self.chat_session_list,
        )
        self.assertIn("overflowWrap: 'break-word'", self.chat_session_list)
        self.assertNotIn("<Alert", self.chat_session_list)

    def test_native_product_gate_rejects_visible_i18n_keys(self) -> None:
        localization_start = self.source.index(
            "    def capture_visible_localization(",
        )
        localization_end = self.source.index(
            "    def bind_recovered_device(",
            localization_start,
        )
        localization_source = self.source[localization_start:localization_end]
        self.assertIn("document.body?.innerText", localization_source)
        self.assertIn("visible_ui_has_no_i18n_keys", localization_source)
        self.assertIn(
            "covered == REQUIRED_LOCALIZATION_CHECKPOINTS",
            localization_source,
        )
        self.assertIn("client is None or not client.is_alive()", localization_source)
        self.assertNotIn("for actor, client in self.clients.items()", localization_source)
        expected_checkpoints = {
            "localization_checkpoint, (actor,)",
            '"direct-open", ("alice",)',
            '"group-create", ("alice",)',
            '"group-open", ("alice", "bob")',
            '"thread", ("alice",)',
            '"reaction-error", ("alice",)',
            '"identity", ("alice", "bob")',
            '"background-picker", (actor,)',
            '"background-failure", ("alice",)',
            '"settings", ("alice",)',
            '"attachment-failure", ("alice",)',
            '"attachments", ("alice", "bob")',
            '"offline", ("alice", "bob")',
            '"restart", ("alice", "bob")',
            '"clear-cursor", ("alice", "bob")',
            '"recovery-create", (actor,)',
            '"recovery-restore", (actor,)',
            '"alice2", ("alice2",)',
        }
        for checkpoint in expected_checkpoints:
            self.assertIn(
                f"self.capture_visible_localization({checkpoint})",
                self.source,
            )
        self.assertIn(
            'self.localization_checks.setdefault("reaction-picker", {})[actor] = []',
            self.source,
        )
        self.assertIn(
            'self.step("localization.visible", self.prove_visible_localization)',
            self.source,
        )
        second_device_step = self.source.index(
            'self.step(\n'
            '                "alice.second-device.recovery.ui",'
        )
        localization_step = self.source.index(
            'self.step("localization.visible", self.prove_visible_localization)'
        )
        self.assertLess(second_device_step, localization_step)
        self.assertEqual(
            self.desktop_tauri_config["bundle"]["resources"][
                "../../../packages/locales/"
            ],
            "i18n/",
        )

    def test_conversation_search_opens_and_reuses_one_direct(self) -> None:
        self.assertIn("data-chat-session-search", self.chat_session_list)
        self.assertIn("data-chat-search-result", self.chat_search_dropdown)
        self.assertIn(
            "data-chat-search-result-id={conversation.id}",
            self.chat_search_dropdown,
        )
        self.assertIn(
            "data-chat-search-result-peer-ptid={conversation.peerPtid || ''}",
            self.chat_search_dropdown,
        )
        self.assertIn(
            'data-chat-search-result-peer-ptid="{peer_ptid}"',
            self.source,
        )
        self.assertNotIn("data-chat-search-result-peer-did", self.source)
        journey_start = self.source.index(
            "    def prove_conversation_search_open("
        )
        journey_end = self.source.index(
            "    def open_group_through_ui(",
            journey_start,
        )
        journey = self.source[journey_start:journey_end]
        self.assertEqual(journey.count("self.search_contact_result("), 2)
        self.assertIn(
            "second_conversation_id == first_conversation_id",
            journey,
        )
        self.assertIn('"conversation_search_open_exact"', journey)
        self.assertIn('"error.unknown"', journey)
        self.assertIn('"conversation action failed"', journey)
        self.assertIn("LOCALIZATION_KEY_PATTERN.search", journey)
        self.assertIn("|provider|", self.source)
        self.assertIn("|error|errors|", self.source)
        self.assertIn(
            'self.write_json_evidence("direct-search-reuse", direct_search)',
            self.source,
        )
        self.assertIn('"alice-direct-search-first"', journey)
        self.assertIn('"alice-direct-search-second"', journey)
        self.assertIn(
            'client.find_elements("[data-chat-conversation-pane]")',
            self.source,
        )
        self.assertNotIn(
            '[data-chat-conversation-pane][data-session-security="ready"]',
            self.source,
        )
        self.assertIn('"securityState": (', self.source)
        self.assertIn('"sessionRows": len(session_rows)', self.source)
        for forbidden in (
            "call_async_harness",
            "gateway_read(",
            "__PT_ACCEPTANCE_STORE__",
            ".getState(",
            ".setState(",
            ".click()",
        ):
            self.assertNotIn(forbidden, journey)

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

    def test_toolbar_initial_focus_is_one_shot_per_activation(self) -> None:
        focus_ref = self.message_action_overlay.index(
            "const focusedActivationRef = useRef<MessageActionTarget | null>(null);"
        )
        focus_effect = self.message_action_overlay.index(
            "if (!target?.requestFocus || !geometry || pickerOpen) return;",
            focus_ref,
        )
        activation_guard = self.message_action_overlay.index(
            "if (focusedActivationRef.current === target) return;",
            focus_effect,
        )
        activation_mark = self.message_action_overlay.index(
            "focusedActivationRef.current = target;",
            activation_guard,
        )
        toolbar_focus = self.message_action_overlay.index(
            "surfaceRef.current?.querySelector<HTMLButtonElement>"
            "('[data-message-action]')?.focus();",
            activation_mark,
        )

        self.assertLess(focus_effect, activation_guard)
        self.assertLess(activation_guard, activation_mark)
        self.assertLess(activation_mark, toolbar_focus)

    def test_keyboard_navigation_uses_one_target_bound_sequence(self) -> None:
        keyboard_path_start = self.source.index(
            "def prove_keyboard_reaction_picker(",
        )
        keyboard_path_end = self.source.index(
            "def reaction_visible(",
            keyboard_path_start,
        )
        keyboard_path = self.source[keyboard_path_start:keyboard_path_end]
        row_focus = keyboard_path.index(
            '"arguments[0].focus({ preventScroll: true });"'
        )
        row_focus_wait = keyboard_path.index(
            "return document.activeElement === row && Boolean(toolbar);",
            row_focus,
        )
        sequence_post = keyboard_path.index(
            "self.native_adapter.post_key_sequence_to_process(\n"
            "            process_id,\n"
            "            (",
            row_focus_wait,
        )
        sequence_keys = keyboard_path.index(
            "NativeKey.ENTER,\n"
            "                NativeKey.TAB,\n"
            "                NativeKey.ENTER,",
            sequence_post,
        )
        picker_wait = keyboard_path.index(
            "WebDriverWait(client.driver, 15).until(",
            sequence_keys,
        )
        self.assertNotIn("self.click_element(actor, row)", keyboard_path)
        self.assertLess(row_focus, row_focus_wait)
        self.assertLess(row_focus_wait, sequence_post)
        self.assertLess(sequence_post, sequence_keys)
        self.assertLess(sequence_keys, picker_wait)
        self.assertIn(
            "interval_seconds=NATIVE_KEY_SEQUENCE_INTERVAL_SECONDS",
            keyboard_path,
        )
        self.assertNotIn("self.native_adapter.post_key(", keyboard_path)
        self.assertNotIn(
            "self.native_adapter.post_key_to_process(",
            keyboard_path,
        )

    def test_reaction_selection_uses_atomic_native_keyboard_sequences(self) -> None:
        selection_start = self.source.index(
            "def prove_keyboard_reaction_picker(",
        )
        selection_end = self.source.index(
            "def reaction_visible(",
            selection_start,
        )
        selection_source = self.source[selection_start:selection_end]
        reaction_start = self.source.index("def prove_reaction(")
        reaction_end = self.source.index(
            "def prove_identity_station(",
            reaction_start,
        )
        reaction_source = self.source[reaction_start:reaction_end]

        self.assertIn(
            "NativeKey.ENTER,\n"
            "                NativeKey.TAB,\n"
            "                NativeKey.ENTER,\n"
            "                NativeKey.ENTER,",
            selection_source,
        )
        self.assertIn("reaction_picker_localized", selection_source)
        self.assertIn("return str(selected_emoji)", selection_source)
        self.assertEqual(
            reaction_source.count(
                "self.prove_keyboard_reaction_picker("
            ),
            2,
        )

    def test_reaction_connection_loss_proves_automatic_exact_retry(self) -> None:
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
            '"reaction automatic retry convergence"',
            reaction_source,
        )
        self.assertIn("len(command_hashes) < 2", reaction_source)
        self.assertIn("len(set(command_hashes)) != 1", reaction_source)
        self.assertIn(
            'forwarded_paths.get("/conversation/command")',
            reaction_source,
        )
        self.assertNotIn('forwarded_paths.get("/messaging/', reaction_source)
        self.assertNotIn(
            "f'[data-message-reaction-retry=\"{message_id}\"]'",
            reaction_source,
        )

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
