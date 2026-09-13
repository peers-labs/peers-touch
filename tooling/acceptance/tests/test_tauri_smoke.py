from __future__ import annotations

import unittest
from unittest.mock import patch

from tooling.acceptance.drivers.tauri import resolve_smoke_port


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


if __name__ == "__main__":
    unittest.main()
