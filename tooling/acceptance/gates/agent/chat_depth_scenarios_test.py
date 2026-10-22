from __future__ import annotations

import unittest
from unittest import mock

from tooling.acceptance.drivers.native import NativeKey, NativeModifier
from tooling.acceptance.gates.agent.chat_depth_scenarios import (
    _open_command_palette_with_native_slash,
)


class CommandPaletteNativeInputTests(unittest.TestCase):
    def test_focuses_once_before_replacing_the_draft_with_slash(self) -> None:
        runner = mock.Mock()

        _open_command_palette_with_native_slash(runner)

        self.assertEqual(
            runner.press_native_key.call_args_list,
            [
                mock.call(
                    NativeKey.A,
                    selector="[data-pt-agent-composer-input]",
                    modifiers=(NativeModifier.PRIMARY,),
                ),
                mock.call(NativeKey.DELETE),
                mock.call(NativeKey.SLASH),
            ],
        )


if __name__ == "__main__":
    unittest.main()
