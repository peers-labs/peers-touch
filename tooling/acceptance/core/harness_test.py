from __future__ import annotations

import unittest

from tooling.acceptance.core.harness import ASYNC_HARNESS_SCRIPT


class HarnessDiagnosticsTest(unittest.TestCase):
    def test_async_failure_preserves_message_when_webkit_stack_omits_it(
        self,
    ) -> None:
        self.assertIn(
            "stack ? `${message}\n${stack}` : message",
            ASYNC_HARNESS_SCRIPT,
        )


if __name__ == "__main__":
    unittest.main()
