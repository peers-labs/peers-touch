from __future__ import annotations

import unittest
from unittest.mock import Mock, patch

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


class TauriSemanticActionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.session = TauriSession(Mock())
        self.element = Mock()

    def test_semantic_click_uses_webdriver_element(self) -> None:
        self.session.semantic_click(self.element)

        self.element.click.assert_called_once_with()

    def test_semantic_hover_dispatches_pointer_and_mouse_events(self) -> None:
        with patch.object(self.session, "execute_script") as execute:
            self.session.semantic_hover(self.element)

        script, element = execute.call_args.args
        self.assertIs(element, self.element)
        self.assertIn("new PointerEvent('pointerover'", script)
        self.assertIn("new MouseEvent('mousemove'", script)

    def test_semantic_replace_text_uses_element_clear_and_send_keys(self) -> None:
        self.session.semantic_replace_text(self.element, "replacement")

        self.element.clear.assert_called_once_with()
        self.element.send_keys.assert_called_once_with("replacement")

    def test_semantic_key_sequence_uses_webdriver_actions(self) -> None:
        webdriver = Mock()
        driver_owner = Mock()
        driver_owner.driver = webdriver
        self.session._driver = driver_owner
        actions = Mock()
        actions.send_keys.return_value = actions
        with (
            patch.object(self.session, "execute_script") as execute,
            patch(
                "tooling.acceptance.drivers.tauri.ActionChains",
                return_value=actions,
            ) as action_chains,
        ):
            self.session.semantic_key_sequence(self.element, "ENTER", "TAB")

        execute.assert_called_once_with(
            "arguments[0].focus({ preventScroll: true });",
            self.element,
        )
        action_chains.assert_called_once_with(webdriver)
        actions.send_keys.assert_called_once_with("ENTER", "TAB")
        actions.perform.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
