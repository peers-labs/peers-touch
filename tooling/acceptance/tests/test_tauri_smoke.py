from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from tooling.acceptance.drivers.tauri import (
    MakeDesktopLauncher,
    TauriSession,
    resolve_smoke_port,
)


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


class MakeDesktopLauncherProfileTests(unittest.TestCase):
    def test_runtime_profile_uses_canonical_devctl_resolution(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "canonical-profile.env.example"
            source.write_text(
                "\n".join(
                    (
                        "PT_DEV_PROFILE=canonical",
                        "PT_DEV_SLOT=1",
                        "PT_STATION_URL=http://station.example",
                        "PT_STATION_HEALTH_URL=http://station.example/healthz",
                        "PT_DESKTOP_APP_GATEWAY_PORT=3030",
                        "PT_DESKTOP_APP_WEB_PORT=3210",
                    )
                )
                + "\n",
                encoding="utf-8",
            )
            launcher = MakeDesktopLauncher(
                worktree=root,
                port=45123,
                gateway_port=45124,
                renderer_port=45125,
                profile="semantic-runtime",
                storage_root=str(root / "storage"),
            )
            completed = Mock(
                returncode=0,
                stdout=json.dumps(
                    {
                        "ok": True,
                        "profile": {"resolvedPath": str(source)},
                    }
                ),
                stderr="",
            )

            with patch(
                "tooling.acceptance.drivers.tauri.subprocess.run",
                return_value=completed,
            ) as run:
                rendered = launcher._prepare_runtime_profile()

            command = run.call_args.args[0]
            self.assertEqual(command[0], "node")
            self.assertIn("tooling/devctl/index.mjs", command[1])
            self.assertNotIn(".local/dev/active", " ".join(command))
            content = rendered.read_text(encoding="utf-8")
            self.assertIn("PT_DEV_PROFILE=semantic-runtime", content)
            self.assertIn("PT_DESKTOP_APP_GATEWAY_PORT=45124", content)
            self.assertIn("PT_DESKTOP_APP_WEB_PORT=45125", content)
            launcher.stop()


if __name__ == "__main__":
    unittest.main()
