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
)
from tooling.acceptance.gates.chat.native_file_picker import (
    select_native_file,
)


def _control(
    *,
    kind: str = "unknown",
    window_count: int = 1,
    dialog_count: int = 0,
) -> NativeControlSnapshot:
    return NativeControlSnapshot(
        kind=kind,
        window_count=window_count,
        dialog_count=dialog_count,
        frontmost=True,
        main_window=True,
        focused_window=True,
        actual_frontmost_pid=42,
    )


class NativeFilePickerTest(unittest.TestCase):
    def test_direct_platform_selection_restores_native_window(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            source = Path(raw) / "attachment.bin"
            source.write_bytes(b"native-file-picker")
            adapter = Mock()
            adapter.platform = "macos"
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
            binding = SimpleNamespace(
                native_adapter=adapter,
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

    def test_missing_source_fails_before_native_staging(self) -> None:
        binding = SimpleNamespace(
            native_adapter=Mock(),
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
        adapter.activate_process.assert_called_once_with(42)
        adapter.post_mouse_to_process.assert_called_once_with(
            42,
            (MouseAction.LEFT_DOWN, MouseAction.LEFT_UP),
            (500.0, 500.0),
        )


if __name__ == "__main__":
    unittest.main()
