from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
import base64
from pathlib import Path
from unittest.mock import MagicMock, patch

from tooling.acceptance.core import AppLaunchMetadata
from tooling.acceptance.core.errors import DriverError
from tooling.acceptance.drivers.native import (
    MouseAction,
    NativeControlSnapshot,
    NativeDesktopAdapter,
    NativeKey,
    NativeModifier,
    NativeWindowBounds,
    NativeWindowSnapshot,
    NativeWindowStack,
    create_native_desktop_adapter,
    resolve_native_desktop_runtime,
)
from tooling.acceptance.drivers.native.runtime import (
    LinuxNativeDesktopRuntimeBinding,
    LocalMacOSRuntimeBinding,
    RemoteLinuxNativeDesktopAdapter,
)
from tooling.acceptance.drivers.native import macos
from tooling.acceptance.drivers.native.macos import MacOSNativeDesktopAdapter
from tooling.acceptance.drivers.tauri import ProvisionedTauriLauncher


class SyntheticNativeDesktopAdapter(NativeDesktopAdapter):
    def __init__(self) -> None:
        self.mouse_down = False
        self.actions: list[tuple[tuple[MouseAction, ...], tuple[float, float]]] = []

    @property
    def platform(self) -> str:
        return "synthetic"

    def activate_process(self, process_id: int) -> None:
        return None

    def post_mouse(
        self,
        actions: tuple[MouseAction, ...],
        point: tuple[float, float],
    ) -> None:
        self.actions.append((actions, point))
        self.mouse_down = actions[-1] == MouseAction.LEFT_DOWN

    def post_key(
        self,
        key: NativeKey,
        *,
        modifiers: tuple[NativeModifier, ...] = (),
        text: str = "",
        private_source: bool = False,
    ) -> None:
        return None

    def reveal_file_chooser_location(self) -> None:
        return None

    def focused_control(self, process_id: int) -> NativeControlSnapshot:
        return NativeControlSnapshot()

    def window_stack_at_point(
        self,
        point: tuple[float, float],
    ) -> NativeWindowStack:
        return NativeWindowStack()

    def mouse_button_down(self) -> bool:
        return self.mouse_down

    def capture_screenshot(self, path: Path) -> None:
        path.write_bytes(b"screenshot")

    def read_clipboard(self) -> bytes:
        return b"clipboard"

    def write_clipboard(self, value: bytes) -> None:
        return None


class SyntheticLinuxRuntimeCell:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []
        self.launches: list[tuple[str, dict[str, object], dict[str, str]]] = []
        self.responses: dict[str, dict[str, object]] = {}
        self.validations: list[tuple[str, str]] = []
        self.exposed_endpoints: list[tuple[str, str]] = []
        self.released_endpoints: list[str] = []

    def validate_binding(self, gate_id: str, source_commit: str) -> None:
        self.validations.append((gate_id, source_commit))

    def launch_actor(
        self,
        actor: str,
        client_spec: dict[str, object],
        environment: dict[str, str],
    ) -> ProvisionedTauriLauncher:
        self.launches.append((actor, client_spec, environment))
        return ProvisionedTauriLauncher(
            AppLaunchMetadata(
                webdriver_host="127.0.0.1",
                webdriver_port=int(client_spec["webdriver_port"]),
                gateway_port=int(client_spec["gateway_port"]),
                profile=str(client_spec["profile"]),
                storage_root=f"/workspace/run/actors/{actor}/storage",
                process_id=100 + len(self.launches),
            )
        )

    def binary_identity(self) -> dict[str, str]:
        return {
            "path": "runtime-cell:binary",
            "sha256": "a" * 64,
            "sourceCommit": "abc123",
        }

    def expose_orchestrator_endpoint(
        self,
        endpoint_id: str,
        url: str,
    ) -> dict[str, object]:
        self.exposed_endpoints.append((endpoint_id, url))
        return {
            "endpointId": endpoint_id,
            "url": "http://127.0.0.1:48080",
        }

    def release_endpoint(self, endpoint_id: str) -> dict[str, object]:
        self.released_endpoints.append(endpoint_id)
        return {"endpointId": endpoint_id, "released": True}

    def endpoint_cleanup_audit(self) -> dict[str, object]:
        return {
            "activeEndpointLeases": [],
            "endpointsReleased": True,
        }

    def actor_cleanup_audit(self) -> dict[str, object]:
        return {
            "portsReleased": True,
            "processesReleased": True,
            "storageReleased": True,
        }

    def execute_adapter(
        self,
        operation: str,
        payload: dict[str, object],
    ) -> dict[str, object]:
        self.calls.append((operation, payload))
        return self.responses.get(operation, {})


class NativeDesktopAdapterContractTests(unittest.TestCase):
    def test_contract_is_abstract(self) -> None:
        with self.assertRaises(TypeError):
            NativeDesktopAdapter()

    def test_stuck_button_recovery_posts_one_release(self) -> None:
        adapter = SyntheticNativeDesktopAdapter()
        adapter.mouse_down = True

        self.assertTrue(adapter.release_stuck_mouse_button((10.0, 20.0)))
        self.assertEqual(
            adapter.actions,
            [((MouseAction.LEFT_UP,), (10.0, 20.0))],
        )
        self.assertFalse(adapter.mouse_button_down())
        self.assertFalse(adapter.release_stuck_mouse_button((10.0, 20.0)))

    def test_unimplemented_windows_slot_fails_closed(self) -> None:
        with self.assertRaisesRegex(DriverError, "not implemented"):
            create_native_desktop_adapter("win32")

    def test_runtime_binding_resolves_linux_without_local_fallback(self) -> None:
        cell = SyntheticLinuxRuntimeCell()
        binding = LinuxNativeDesktopRuntimeBinding(
            "chat-native-product-closure-e2e",
            "abc123",
            cell,
        )
        session = binding.create_session(
            "alice",
            {
                "webdriver_port": 4445,
                "gateway_port": 3330,
                "profile": "chat-native-alice",
                "storage_root": "/local/unused",
            },
            {"PEERS_STATION_URL": "http://127.0.0.1:18080"},
        )

        self.assertEqual(binding.cell_id, "desktop-linux-native")
        self.assertIsInstance(
            binding.native_adapter,
            RemoteLinuxNativeDesktopAdapter,
        )
        self.assertEqual(session.port, 4445)
        self.assertEqual(
            session.storage_root,
            "/workspace/run/actors/alice/storage",
        )
        self.assertEqual(cell.launches[0][0], "alice")
        self.assertEqual(binding.binary_identity()["sha256"], "a" * 64)
        self.assertEqual(
            cell.validations,
            [("chat-native-product-closure-e2e", "abc123")],
        )
        self.assertFalse(
            binding.request_cooperative_activation(session, (session,))
        )

    def test_linux_runtime_binding_owns_explicit_endpoint_leases(self) -> None:
        cell = SyntheticLinuxRuntimeCell()
        binding = LinuxNativeDesktopRuntimeBinding(
            "chat-native-product-closure-e2e",
            "abc123",
            cell,
        )

        endpoint = binding.expose_orchestrator_endpoint(
            "http://127.0.0.1:51219"
        )
        cleanup = binding.finalize_cleanup((), {})

        self.assertEqual(endpoint.url, "http://127.0.0.1:48080")
        self.assertEqual(endpoint.lease_id, "orchestrator-endpoint-1")
        self.assertEqual(
            cell.exposed_endpoints,
            [
                (
                    "orchestrator-endpoint-1",
                    "http://127.0.0.1:51219",
                )
            ],
        )
        self.assertEqual(
            cell.released_endpoints,
            ["orchestrator-endpoint-1"],
        )
        self.assertTrue(cleanup["endpointsReleased"])

    def test_runtime_binding_rejects_unknown_and_unready_cells(self) -> None:
        with self.assertRaisesRegex(DriverError, "not implemented"):
            resolve_native_desktop_runtime(
                "desktop-windows-native",
                gate_id="gate",
                source_commit="abc123",
            )
        with self.assertRaisesRegex(DriverError, "unknown"):
            resolve_native_desktop_runtime(
                "desktop-unknown-native",
                gate_id="gate",
                source_commit="abc123",
            )

    def test_remote_linux_adapter_maps_commands_and_typed_results(self) -> None:
        cell = SyntheticLinuxRuntimeCell()
        cell.responses = {
            "focused_control": {
                "kind": "text-field",
                "frontmost": True,
                "actualFrontmostPid": 42,
            },
            "window_stack_at_point": {
                "windows": [
                    {
                        "index": 0,
                        "ownerPid": 42,
                        "ownerName": "Peers Touch",
                        "windowName": "Chat",
                        "layer": 0,
                        "alpha": 1,
                        "bounds": {
                            "left": 1,
                            "top": 2,
                            "width": 3,
                            "height": 4,
                        },
                    }
                ]
            },
            "content_origin": {"x": 1, "y": 22},
            "mouse_button_down": {"down": True},
            "capture_screenshot": {
                "content": base64.b64encode(b"png").decode("ascii")
            },
            "read_clipboard": {
                "content": base64.b64encode(b"clipboard").decode("ascii")
            },
        }
        adapter = RemoteLinuxNativeDesktopAdapter(cell)
        adapter.activate_process(42)
        adapter.post_mouse((MouseAction.MOVE,), (10.5, 20.5))
        adapter.post_key(
            NativeKey.V,
            modifiers=(NativeModifier.PRIMARY,),
            text="value",
            private_source=True,
        )
        adapter.reveal_file_chooser_location()
        control = adapter.focused_control(42)
        stack = adapter.window_stack_at_point((10.5, 20.5))
        content_origin = adapter.content_origin(42)
        with tempfile.TemporaryDirectory() as tmp:
            screenshot = Path(tmp) / "shot.png"
            adapter.capture_screenshot(screenshot)
            self.assertEqual(screenshot.read_bytes(), b"png")
        self.assertTrue(adapter.mouse_button_down())
        self.assertEqual(adapter.read_clipboard(), b"clipboard")
        adapter.write_clipboard(b"value")

        self.assertTrue(control.frontmost)
        self.assertEqual(control.actual_frontmost_pid, 42)
        self.assertTrue(stack.point_owned_by(42))
        self.assertEqual(content_origin, (1.0, 22.0))
        self.assertEqual(
            [operation for operation, _ in cell.calls],
            [
                "activate_process",
                "post_mouse",
                "post_key",
                "reveal_file_chooser_location",
                "focused_control",
                "window_stack_at_point",
                "content_origin",
                "capture_screenshot",
                "mouse_button_down",
                "read_clipboard",
                "write_clipboard",
            ],
        )

    def test_local_runtime_binding_owns_local_session_construction(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            binary = Path(tmp) / "desktop"
            binary.write_bytes(b"desktop-binary")
            with patch(
                "tooling.acceptance.drivers.native.runtime.find_app_binary",
                return_value=str(binary),
            ):
                binding = LocalMacOSRuntimeBinding()

            session = binding.create_session(
                "alice",
                {
                    "webdriver_port": 4445,
                    "gateway_port": 3330,
                    "profile": "chat-native-alice",
                    "storage_root": str(Path(tmp) / "storage"),
                },
                {"PEERS_STATION_URL": "http://127.0.0.1:18080"},
            )
            endpoint = binding.expose_orchestrator_endpoint(
                "http://127.0.0.1:51219"
            )
            binary_identity = binding.binary_identity()

        self.assertEqual(binding.cell_id, "desktop-macos-native")
        self.assertEqual(session.port, 4445)
        self.assertEqual(session.gateway_port, 3330)
        self.assertEqual(endpoint.url, "http://127.0.0.1:51219")
        self.assertEqual(endpoint.lease_id, "local-direct")
        self.assertEqual(
            binary_identity["sha256"],
            "a37cdd0591588a0016117ba6b84e7182977a007c332bccbc55ba656e74e6f45a",
        )

    def test_darwin_factory_returns_macos_adapter(self) -> None:
        self.assertIsInstance(
            create_native_desktop_adapter("darwin"),
            MacOSNativeDesktopAdapter,
        )

    def test_diagnostic_snapshot_uses_stable_cross_platform_fields(self) -> None:
        snapshot = NativeControlSnapshot(
            kind="text-field",
            window_count=2,
            dialog_count=1,
            actual_frontmost_pid=42,
            platform_role="AXTextField",
        )
        self.assertEqual(
            set(snapshot.to_dict()),
            {
                "kind",
                "title",
                "value",
                "windowCount",
                "dialogCount",
                "frontmost",
                "mainWindow",
                "focusedWindow",
                "actualFrontmostPid",
                "platformRole",
                "platformSubrole",
                "error",
            },
        )

    def test_point_ownership_requires_the_top_visible_window(self) -> None:
        bounds = NativeWindowBounds(0, 0, 100, 100)
        occluding = NativeWindowSnapshot(
            index=0,
            owner_pid=7,
            owner_name="Other",
            window_name="Overlay",
            layer=0,
            alpha=1,
            bounds=bounds,
        )
        target = NativeWindowSnapshot(
            index=1,
            owner_pid=42,
            owner_name="Peers Touch",
            window_name="Main",
            layer=0,
            alpha=1,
            bounds=bounds,
        )

        self.assertFalse(
            NativeWindowStack(windows=(occluding, target)).point_owned_by(42)
        )
        self.assertTrue(
            NativeWindowStack(windows=(target, occluding)).point_owned_by(42)
        )

    def test_platform_adapter_does_not_import_chat_business_code(self) -> None:
        native_root = (
            Path(__file__).resolve().parents[1] / "drivers" / "native"
        )
        offenders = [
            path.name
            for path in native_root.glob("*.py")
            if "tooling.acceptance.gates.chat" in path.read_text(
                encoding="utf-8"
            )
        ]
        self.assertEqual(offenders, [])


class MacOSNativeDesktopAdapterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.adapter = MacOSNativeDesktopAdapter()

    def test_focused_control_maps_platform_fields_to_typed_snapshot(self) -> None:
        result = subprocess.CompletedProcess(
            args=(),
            returncode=0,
            stdout=(
                '{"role":"AXTextField","subrole":"","title":"Open",'
                '"value":"/tmp/file","windowCount":2,"sheetCount":1,'
                '"frontmost":true,"mainWindow":true,"focusedWindow":true,'
                '"actualFrontmostPid":42}'
            ),
            stderr="",
        )
        with patch(
            "tooling.acceptance.drivers.native.macos.subprocess.run",
            return_value=result,
        ):
            snapshot = self.adapter.focused_control(42)

        self.assertEqual(snapshot.kind, "text-field")
        self.assertEqual(snapshot.value, "/tmp/file")
        self.assertEqual(snapshot.window_count, 2)
        self.assertEqual(snapshot.dialog_count, 1)
        self.assertEqual(snapshot.actual_frontmost_pid, 42)
        self.assertEqual(snapshot.platform_role, "AXTextField")

    def test_event_mappings_preserve_existing_macos_input_semantics(self) -> None:
        self.assertEqual(
            macos._MOUSE_EVENT_TYPES,
            {
                MouseAction.LEFT_DOWN: 1,
                MouseAction.LEFT_UP: 2,
                MouseAction.MOVE: 5,
            },
        )
        self.assertEqual(macos._KEY_CODES[NativeKey.A], 0)
        self.assertEqual(macos._KEY_CODES[NativeKey.G], 5)
        self.assertEqual(macos._KEY_CODES[NativeKey.L], 37)
        self.assertEqual(macos._KEY_CODES[NativeKey.V], 9)
        self.assertEqual(macos._KEY_CODES[NativeKey.DELETE], 51)
        self.assertEqual(macos._KEY_CODES[NativeKey.ENTER], 36)
        self.assertEqual(macos._KEY_CODES[NativeKey.TAB], 48)
        self.assertEqual(macos._KEY_CODES[NativeKey.ESCAPE], 53)
        self.assertEqual(
            macos._MODIFIER_CODES[NativeModifier.PRIMARY],
            (55, 0x00100000),
        )
        self.assertEqual(
            macos._MODIFIER_CODES[NativeModifier.SHIFT],
            (56, 0x00020000),
        )

    def test_file_chooser_location_uses_macos_go_to_folder_shortcut(self) -> None:
        with patch.object(self.adapter, "post_key") as post_key:
            self.adapter.reveal_file_chooser_location()

        post_key.assert_called_once_with(
            NativeKey.G,
            modifiers=(NativeModifier.PRIMARY, NativeModifier.SHIFT),
        )

    def test_process_operations_reject_invalid_pid(self) -> None:
        for process_id in (0, -1, "not-a-pid"):
            with self.subTest(process_id=process_id):
                with self.assertRaisesRegex(DriverError, "process ID"):
                    self.adapter.activate_process(process_id)  # type: ignore[arg-type]

    def test_focused_control_timeout_is_typed_error(self) -> None:
        with patch(
            "tooling.acceptance.drivers.native.macos.subprocess.run",
            side_effect=subprocess.TimeoutExpired(("probe",), 2),
        ):
            snapshot = self.adapter.focused_control(42)

        self.assertEqual(snapshot.error, "Native Accessibility probe timed out")

    def test_window_stack_preserves_order_and_point_owner(self) -> None:
        result = subprocess.CompletedProcess(
            args=(),
            returncode=0,
            stdout=(
                '{"windows":['
                '{"index":0,"ownerPid":42,"ownerName":"Peers Touch",'
                '"windowName":"Main","layer":0,"alpha":1,'
                '"bounds":{"left":1,"top":2,"width":3,"height":4}},'
                '{"index":1,"ownerPid":7,"ownerName":"Other",'
                '"windowName":"","layer":0,"alpha":1,'
                '"bounds":{"left":1,"top":2,"width":3,"height":4}}]}'
            ),
            stderr="",
        )
        with patch(
            "tooling.acceptance.drivers.native.macos.subprocess.run",
            return_value=result,
        ):
            stack = self.adapter.window_stack_at_point((10.0, 20.0))

        self.assertEqual([window.owner_pid for window in stack.windows], [42, 7])
        self.assertTrue(stack.point_owned_by(42))
        self.assertFalse(stack.point_owned_by(8))

    def test_activation_runs_appkit_before_system_events(self) -> None:
        appkit = subprocess.CompletedProcess(
            args=(),
            returncode=0,
            stdout='{"requestAccepted": true}',
            stderr="",
        )
        system_events = subprocess.CompletedProcess(
            args=(),
            returncode=0,
            stdout="true\n",
            stderr="",
        )
        with patch(
            "tooling.acceptance.drivers.native.macos.subprocess.run",
            side_effect=(appkit, system_events),
        ) as run:
            self.adapter.activate_process(42)

        self.assertEqual(run.call_count, 2)
        self.assertEqual(run.call_args_list[0].args[0][0], sys.executable)
        self.assertEqual(run.call_args_list[1].args[0][0], "osascript")

    def test_activation_failure_is_not_silently_ignored(self) -> None:
        failed = subprocess.CompletedProcess(
            args=(),
            returncode=1,
            stdout="",
            stderr="activation denied",
        )
        with patch(
            "tooling.acceptance.drivers.native.macos.subprocess.run",
            return_value=failed,
        ):
            with self.assertRaisesRegex(DriverError, "activation denied"):
                self.adapter.activate_process(42)

    def test_clipboard_round_trip_uses_native_commands(self) -> None:
        read = subprocess.CompletedProcess(
            args=(),
            returncode=0,
            stdout=b"before",
            stderr=b"",
        )
        write = subprocess.CompletedProcess(
            args=(),
            returncode=0,
            stdout=b"",
            stderr=b"",
        )
        with patch(
            "tooling.acceptance.drivers.native.macos.subprocess.run",
            side_effect=(read, write),
        ) as run:
            self.assertEqual(self.adapter.read_clipboard(), b"before")
            self.adapter.write_clipboard(b"after")

        self.assertEqual(run.call_args_list[0].args[0], ("/usr/bin/pbpaste",))
        self.assertEqual(run.call_args_list[1].args[0], ("/usr/bin/pbcopy",))

    def test_screenshot_requires_a_created_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "desktop.png"

            def capture(*args: object, **kwargs: object):
                path.write_bytes(b"png")
                return subprocess.CompletedProcess(
                    args=args,
                    returncode=0,
                    stdout="",
                    stderr="",
                )

            with patch(
                "tooling.acceptance.drivers.native.macos.subprocess.run",
                side_effect=capture,
            ):
                self.adapter.capture_screenshot(path)

            self.assertEqual(path.read_bytes(), b"png")


if __name__ == "__main__":
    unittest.main()
