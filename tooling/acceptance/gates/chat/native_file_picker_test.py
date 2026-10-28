from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

from tooling.acceptance.core import GateError
from tooling.acceptance.drivers.native import (
    MouseAction,
    NativeControlSnapshot,
    NativeKey,
)
from tooling.acceptance.gates.chat.native_file_picker import (
    select_native_file,
    wait_for_actionable_file_trigger,
)


def _control(
    *,
    kind: str = "unknown",
    value: str = "",
    window_count: int = 1,
    dialog_count: int = 0,
    main_window: bool = True,
    focused_window: bool = True,
    actual_frontmost_pid: int = 42,
) -> NativeControlSnapshot:
    return NativeControlSnapshot(
        kind=kind,
        value=value,
        window_count=window_count,
        dialog_count=dialog_count,
        frontmost=True,
        main_window=main_window,
        focused_window=focused_window,
        actual_frontmost_pid=actual_frontmost_pid,
    )


class NativeFilePickerTest(unittest.TestCase):
    def test_text_field_focus_is_ready_before_opening_picker(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            source = Path(raw) / "attachment.bin"
            source.write_bytes(b"native-file-picker")
            adapter = Mock()
            adapter.platform = "macos"
            adapter.activate_and_focused_control.side_effect = (
                _control(
                    kind="text-field",
                    actual_frontmost_pid=99,
                ),
                _control(kind="text-field"),
            )
            adapter.focused_control.return_value = _control(
                kind="list",
                window_count=2,
                dialog_count=1,
            )
            adapter.select_file_chooser_path_to_process.return_value = _control(
                kind="text-field"
            )
            binding = SimpleNamespace(
                native_adapter=adapter,
                begin_file_chooser=Mock(return_value=None),
                request_cooperative_activation=Mock(return_value=False),
                stage_native_file=Mock(return_value=source),
            )
            driver = Mock()
            driver.execute_script.return_value = True
            client = SimpleNamespace(process_id=42, driver=driver)
            trigger = Mock()

            result = select_native_file(
                actor="alice",
                client=client,
                sessions=(client,),
                runtime_binding=binding,
                source_path=source,
                trigger=trigger,
                timeout_seconds=0.1,
            )

        self.assertEqual(
            result,
            {"name": "attachment.bin", "size": 18},
        )
        trigger.assert_called_once_with()

    def test_direct_platform_selection_restores_native_window(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            source = Path(raw) / "attachment.bin"
            source.write_bytes(b"native-file-picker")
            adapter = Mock()
            adapter.platform = "macos"
            adapter.activate_and_focused_control.side_effect = (
                _control(),
                _control(focused_window=False),
            )
            adapter.focused_control.return_value = _control(
                kind="list",
                window_count=2,
            )
            adapter.select_file_chooser_path_to_process.return_value = (
                _control(kind="file-selection")
            )
            binding = SimpleNamespace(
                native_adapter=adapter,
                begin_file_chooser=Mock(return_value=None),
                request_cooperative_activation=Mock(return_value=False),
                stage_native_file=Mock(return_value=source),
            )
            driver = Mock()
            driver.execute_script.return_value = True
            client = SimpleNamespace(process_id=42, driver=driver)
            trigger = Mock()

            result = select_native_file(
                actor="alice",
                client=client,
                sessions=(client,),
                runtime_binding=binding,
                source_path=source,
                trigger=trigger,
            )

        self.assertEqual(
            result,
            {"name": "attachment.bin", "size": 18},
        )
        binding.stage_native_file.assert_called_once_with(
            "alice",
            source.resolve(),
        )
        trigger.assert_called_once_with()
        adapter.select_file_chooser_path_to_process.assert_called_once_with(
            42,
            str(source),
        )
        self.assertEqual(
            adapter.activate_and_focused_control.call_count,
            2,
        )

    def test_selector_trigger_uses_trusted_native_pointer_sequence(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            source = Path(raw) / "attachment.bin"
            source.write_bytes(b"native-file-picker")
            adapter = Mock()
            adapter.platform = "linux"
            adapter.activate_and_focused_control.side_effect = (
                _control(),
                _control(),
            )
            adapter.focused_control.return_value = _control(
                kind="list",
                window_count=2,
            )
            adapter.select_file_chooser_path_to_process.return_value = (
                _control(kind="file-selection")
            )
            adapter.content_origin.return_value = (100.0, 200.0)
            binding = SimpleNamespace(
                native_adapter=adapter,
                begin_file_chooser=Mock(return_value=None),
                request_cooperative_activation=Mock(return_value=False),
                stage_native_file=Mock(return_value=source),
            )
            driver = Mock()
            driver.execute_script.side_effect = lambda script, *args: (
                {
                    "connected": True,
                    "disabled": False,
                    "hit": True,
                    "element": {
                        "left": 20,
                        "top": 30,
                        "width": 40,
                        "height": 20,
                    },
                    "viewport": {
                        "width": 800,
                        "height": 600,
                        "devicePixelRatio": 1,
                    },
                }
                if "getBoundingClientRect" in script
                else True
            )
            driver.get_window_rect.return_value = {
                "x": 0,
                "y": 0,
                "width": 800,
                "height": 600,
            }
            element = Mock()
            client = SimpleNamespace(
                process_id=42,
                driver=driver,
                find_element=Mock(return_value=element),
            )

            result = select_native_file(
                actor="alice",
                client=client,
                sessions=(client,),
                runtime_binding=binding,
                source_path=source,
                trigger_selector="[data-file-chooser]",
            )

        self.assertEqual(
            result,
            {"name": "attachment.bin", "size": 18},
        )
        client.find_element.assert_called_once_with(
            "[data-file-chooser]",
            30.0,
        )
        adapter.post_mouse_to_process.assert_called_once_with(
            42,
            (
                MouseAction.MOVE,
                MouseAction.LEFT_DOWN,
                MouseAction.LEFT_UP,
            ),
            (140.0, 240.0),
        )

    def test_requires_exactly_one_chooser_trigger(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            source = Path(raw) / "attachment.bin"
            source.write_bytes(b"native-file-picker")
            binding = SimpleNamespace(
                native_adapter=Mock(),
                begin_file_chooser=Mock(return_value=None),
                stage_native_file=Mock(),
            )
            client = SimpleNamespace(process_id=42, driver=Mock())
            for trigger, selector in (
                (None, None),
                (Mock(), "[data-file-chooser]"),
            ):
                with self.subTest(trigger=trigger, selector=selector):
                    with self.assertRaisesRegex(
                        GateError,
                        "requires exactly one chooser trigger",
                    ):
                        select_native_file(
                            actor="alice",
                            client=client,
                            sessions=(client,),
                            runtime_binding=binding,
                            source_path=source,
                            trigger=trigger,
                            trigger_selector=selector,
                        )

        binding.stage_native_file.assert_not_called()

    def test_returned_main_window_wins_over_changed_control_kind(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            source = Path(raw) / "attachment.bin"
            source.write_bytes(b"native-file-picker")
            panel = _control(
                kind="text-field",
                window_count=2,
                dialog_count=1,
                main_window=False,
            )
            returned = _control(kind="text-field")
            adapter = Mock()
            adapter.platform = "linux"
            adapter.activate_and_focused_control.side_effect = (
                _control(kind="unknown"),
                returned,
            )
            adapter.focused_control.side_effect = (
                panel,
                panel,
                _control(
                    kind="text-field",
                    value=str(source),
                    window_count=2,
                    dialog_count=1,
                    main_window=False,
                ),
                returned,
            )
            adapter.select_file_chooser_path_to_process.return_value = None
            adapter.reveal_file_chooser_location_to_process.return_value = panel
            adapter.read_clipboard.side_effect = (b"before", str(source).encode())
            binding = SimpleNamespace(
                native_adapter=adapter,
                begin_file_chooser=Mock(return_value=None),
                request_cooperative_activation=Mock(return_value=False),
                stage_native_file=Mock(return_value=source),
            )
            driver = Mock()
            driver.execute_script.return_value = True
            client = SimpleNamespace(process_id=42, driver=driver)

            result = select_native_file(
                actor="alice",
                client=client,
                sessions=(client,),
                runtime_binding=binding,
                source_path=source,
                trigger=Mock(),
                timeout_seconds=0.1,
            )

        self.assertEqual(
            result,
            {"name": "attachment.bin", "size": 18},
        )
        adapter.post_key_to_process.assert_any_call(
            42,
            NativeKey.ENTER,
            modifiers=(),
            private_source=True,
        )

    def test_platform_text_verification_avoids_post_paste_focus_probe(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as raw:
            source = Path(raw) / "attachment.bin"
            source.write_bytes(b"native-file-picker")
            panel = _control(
                kind="text-field",
                window_count=2,
                dialog_count=1,
                main_window=False,
            )
            returned = _control()
            adapter = Mock()
            adapter.platform = "linux"
            adapter.activate_and_focused_control.side_effect = (
                _control(),
                returned,
            )
            adapter.focused_control.side_effect = (
                panel,
                panel,
                returned,
            )
            adapter.select_file_chooser_path_to_process.return_value = None
            adapter.reveal_file_chooser_location_to_process.return_value = panel
            adapter.verify_focused_text.return_value = True
            adapter.read_clipboard.side_effect = (
                b"before",
                str(source).encode("utf-8"),
            )
            binding = SimpleNamespace(
                native_adapter=adapter,
                begin_file_chooser=Mock(return_value=None),
                request_cooperative_activation=Mock(return_value=False),
                stage_native_file=Mock(return_value=source),
            )
            driver = Mock()
            driver.execute_script.return_value = True
            client = SimpleNamespace(process_id=42, driver=driver)

            result = select_native_file(
                actor="alice",
                client=client,
                sessions=(client,),
                runtime_binding=binding,
                source_path=source,
                trigger=Mock(),
                timeout_seconds=0.1,
            )

        self.assertEqual(
            result,
            {"name": "attachment.bin", "size": 18},
        )
        adapter.verify_focused_text.assert_called_once_with(
            str(source),
            timeout_seconds=10,
        )
        self.assertEqual(adapter.focused_control.call_count, 3)

    def test_missing_source_fails_before_native_staging(self) -> None:
        binding = SimpleNamespace(
            native_adapter=Mock(),
            begin_file_chooser=Mock(return_value=None),
            stage_native_file=Mock(),
        )
        client = SimpleNamespace(process_id=42, driver=Mock())

        with self.assertRaisesRegex(
            GateError,
            "selection source is missing",
        ):
            select_native_file(
                actor="alice",
                client=client,
                sessions=(client,),
                runtime_binding=binding,
                source_path=Path("/missing/native-attachment.bin"),
                trigger=Mock(),
            )

        binding.stage_native_file.assert_not_called()

    def test_direct_selection_refocuses_document_with_native_click(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as raw:
            source = Path(raw) / "attachment.bin"
            source.write_bytes(b"native-file-picker")
            adapter = Mock()
            adapter.platform = "macos"
            adapter.activate_and_focused_control.return_value = _control()
            adapter.focused_control.return_value = _control(
                kind="list",
                window_count=2,
            )
            adapter.select_file_chooser_path_to_process.return_value = (
                _control(kind="file-selection")
            )
            adapter.content_origin.return_value = (100.0, 200.0)
            binding = SimpleNamespace(
                native_adapter=adapter,
                begin_file_chooser=Mock(return_value=None),
                request_cooperative_activation=Mock(return_value=False),
                stage_native_file=Mock(return_value=source),
            )
            driver = Mock()
            driver.execute_script.side_effect = lambda script: (
                {
                    "width": 800,
                    "height": 600,
                    "devicePixelRatio": 2,
                }
                if "devicePixelRatio" in script
                else adapter.post_mouse_to_process.called
            )
            driver.get_window_rect.return_value = {
                "x": 0,
                "y": 0,
                "width": 1600,
                "height": 1200,
            }
            client = SimpleNamespace(process_id=42, driver=driver)

            result = select_native_file(
                actor="alice",
                client=client,
                sessions=(client,),
                runtime_binding=binding,
                source_path=source,
                trigger=Mock(),
                timeout_seconds=0.01,
            )

        self.assertEqual(
            result,
            {"name": "attachment.bin", "size": 18},
        )
        self.assertEqual(adapter.activate_process.call_count, 2)
        adapter.activate_process.assert_called_with(42)
        adapter.post_mouse_to_process.assert_called_once_with(
            42,
            (MouseAction.LEFT_DOWN, MouseAction.LEFT_UP),
            (500.0, 500.0),
        )

    def test_waits_past_hidden_dynamic_surface_instance(self) -> None:
        hidden = Mock()
        hidden.is_displayed.return_value = False
        actionable = Mock()
        actionable.is_displayed.return_value = True
        actionable.is_enabled.return_value = True
        client = SimpleNamespace(
            driver=Mock(),
            find_elements=Mock(
                side_effect=(
                    [hidden],
                    [hidden, actionable],
                )
            ),
        )

        selected = wait_for_actionable_file_trigger(
            actor="alice",
            client=client,
            selector="[data-file-trigger]",
            timeout_seconds=1,
        )

        self.assertIs(selected, actionable)
        self.assertGreaterEqual(client.find_elements.call_count, 2)


if __name__ == "__main__":
    unittest.main()
