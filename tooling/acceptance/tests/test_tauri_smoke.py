from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from selenium.webdriver.remote.command import Command
from selenium.webdriver.remote.webelement import WebElement

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


class TauriSessionSemanticActionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.session = TauriSession(Mock())
        self.native_driver = Mock()
        self.native_driver.execute_async_script.return_value = {"ok": True}
        self.session._driver = self.native_driver
        self.element = Mock()

    def test_semantic_click_emits_element_targeted_mouse_press_and_release(self) -> None:
        driver = self.native_driver.driver
        self.session.semantic_click(WebElement(driver, "visible-select"))

        command, payload = driver.execute.call_args.args
        self.assertEqual(command, Command.W3C_ACTIONS)
        pointer = next(action for action in payload["actions"] if action["type"] == "pointer")
        self.assertEqual(pointer["parameters"]["pointerType"], "mouse")
        self.assertEqual(
            [(action["type"], action.get("button")) for action in pointer["actions"]],
            [("pointerMove", None), ("pointerDown", 0), ("pointerUp", 0)],
        )
        self.assertEqual(pointer["actions"][0]["origin"], {
            "element-6066-11e4-a52e-4f735466cecf": "visible-select",
        })
        self.assertEqual(pointer["actions"][0]["duration"], 0)
        self.assertEqual((pointer["actions"][0]["x"], pointer["actions"][0]["y"]), (0, 0))
        driver.execute.assert_called_once()

    def test_semantic_click_preserves_action_failure_without_fallback(self) -> None:
        driver = self.native_driver.driver
        driver.execute.side_effect = RuntimeError("rejected pointer action")
        with self.assertRaisesRegex(RuntimeError, "rejected pointer action"):
            self.session.semantic_click(WebElement(driver, "visible-select"))
        driver.execute.assert_called_once()

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

        script, element, keys, interval = self.native_driver.execute_async_script.call_args.args
        self.assertIs(element, self.element)
        self.assertIn("focus({ preventScroll: true })", script)
        self.assertIn("new KeyboardEvent('keydown'", script)
        self.assertIn("descriptor.key === 'Tab'", script)
        self.assertIn("target.click()", script)
        self.assertEqual(keys, ["ENTER", "TAB"])
        self.assertEqual(interval, 100)
        self.element.send_keys.assert_not_called()

    def test_key_sequence_consumes_controls_after_deferred_focus_and_render(self) -> None:
        self.session.semantic_key_sequence(
            self.element, "\ue007", "\ue004", "\ue007", "\ue007",
            interval_seconds=0.01,
        )
        script, _, keys, interval = self.native_driver.execute_async_script.call_args.args
        harness = r"""
            const fs = require('fs');
            const { script, keys, interval } = JSON.parse(fs.readFileSync(0, 'utf8'));
            const targets = [];
            let selected = 0;
            class KeyboardEvent {
              constructor(type, init) {
                this.type = type;
                Object.assign(this, init);
                this.defaultPrevented = false;
              }
              preventDefault() { this.defaultPrevented = true; }
            }
            global.KeyboardEvent = KeyboardEvent;
            global.getComputedStyle = () => ({ display: 'block', visibility: 'visible' });
            const control = (name, button) => ({
              name,
              focus() { document.activeElement = this; },
              getBoundingClientRect() { return { width: 28, height: 28 }; },
              matches() { return button; },
              getAttribute() { return ''; },
              dispatchEvent(event) {
                if (event.type === 'keydown') targets.push(this.name);
                if (this === row && event.type === 'keydown' && event.key === 'Enter') {
                  event.preventDefault();
                  setTimeout(() => first.focus(), 3);
                }
              },
              click() {},
            });
            const row = control('row', false);
            const first = control('first', true);
            const second = control('second', true);
            const choice = control('choice', true);
            const candidates = [row, first, second];
            second.click = () => setTimeout(() => {
              candidates.push(choice);
              choice.focus();
            }, 3);
            choice.click = () => { selected += 1; };
            global.document = {
              activeElement: row,
              querySelectorAll() { return candidates; },
            };
            new Promise(resolve => {
              new Function(script)(row, keys, interval, resolve);
            }).then(result => process.stdout.write(JSON.stringify({ result, targets, selected })));
        """
        completed = subprocess.run(
            ["node", "-e", harness],
            input=json.dumps({"script": script, "keys": keys, "interval": interval}),
            capture_output=True, text=True, timeout=3, check=True,
        )
        result = json.loads(completed.stdout)
        self.assertEqual(result["result"], {"ok": True})
        self.assertEqual(result["targets"], ["row", "first", "second", "choice"])
        self.assertEqual(result["selected"], 1)

    def test_invalid_key_sequences_fail_before_dispatch(self) -> None:
        for interval in (-1, float("nan"), float("inf")):
            with self.subTest(interval=interval), self.assertRaises(ValueError):
                self.session.semantic_key_sequence(
                    self.element, "\ue007", interval_seconds=interval,
                )
        with self.assertRaises(ValueError):
            self.session.semantic_key_sequence(self.element)
        self.native_driver.execute_async_script.assert_not_called()


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
