from __future__ import annotations

import unittest
from unittest.mock import MagicMock
from unittest.mock import patch

from tooling.acceptance.drivers.tauri import TauriSession, resolve_smoke_port


class TauriSmokePortTests(unittest.TestCase):
    def test_zero_allocates_free_loopback_port(self) -> None:
        with patch(
            "tooling.acceptance.drivers.tauri._available_port",
            return_value=45123,
        ):
            self.assertEqual(resolve_smoke_port(0), 45123)

    def test_explicit_port_is_preserved(self) -> None:
        self.assertEqual(resolve_smoke_port(4475), 4475)

    def test_invalid_port_is_rejected(self) -> None:
        for port in (-1, 65536):
            with self.subTest(port=port):
                with self.assertRaises(ValueError):
                    resolve_smoke_port(port)


class TauriSessionSemanticActionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.session = TauriSession(MagicMock())
        self.native_driver = MagicMock()
        self.session._driver = self.native_driver
        self.element = MagicMock()

    def test_semantic_click_uses_element_click(self) -> None:
        self.session.semantic_click(self.element)

        self.element.click.assert_called_once_with()

    def test_semantic_hover_dispatches_webview_pointer_events(self) -> None:
        self.session.semantic_hover(self.element)

        script, element = self.native_driver.execute_script.call_args.args
        self.assertIs(element, self.element)
        self.assertIn("new PointerEvent('pointerover'", script)
        self.assertIn("new MouseEvent('mouseenter'", script)

    def test_semantic_replace_text_clears_before_typing(self) -> None:
        self.session.semantic_replace_text(self.element, "replacement")

        self.element.clear.assert_called_once_with()
        self.element.send_keys.assert_called_once_with("replacement")

    def test_semantic_key_sequence_targets_webview_focus(self) -> None:
        self.session.semantic_key_sequence(
            self.element,
            "ENTER",
            "TAB",
        )

        script, element, keys = self.native_driver.execute_script.call_args.args
        self.assertIs(element, self.element)
        self.assertIn("focus({ preventScroll: true })", script)
        self.assertIn("new KeyboardEvent('keydown'", script)
        self.assertIn("descriptor.key === 'Tab'", script)
        self.assertIn("target.click()", script)
        self.assertEqual(keys, ["ENTER", "TAB"])
        self.element.send_keys.assert_not_called()


if __name__ == "__main__":
    unittest.main()
