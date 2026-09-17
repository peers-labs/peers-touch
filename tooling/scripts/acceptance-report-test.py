#!/usr/bin/env python3
"""Regression tests for Acceptance report rendering."""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path
from typing import Any


SCRIPT = Path(__file__).with_name("acceptance-report.py")


def load_module() -> Any:
    spec = importlib.util.spec_from_file_location("acceptance_report", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class AcceptanceReportTest(unittest.TestCase):
    def setUp(self) -> None:
        self.module = load_module()

    def test_renders_legacy_command(self) -> None:
        self.assertEqual(
            self.module.gate_invocation(
                {
                    "id": "legacy-gate",
                    "command": "python3 -m example.gate",
                }
            ),
            "python3 -m example.gate",
        )

    def test_renders_argv_command(self) -> None:
        self.assertEqual(
            self.module.gate_invocation(
                {
                    "id": "argv-gate",
                    "argv": [
                        "python3",
                        "-m",
                        "example.gate",
                        "--label",
                        "two words",
                    ],
                }
            ),
            "python3 -m example.gate --label 'two words'",
        )

    def test_rejects_ambiguous_or_missing_invocation(self) -> None:
        for gate in (
            {"id": "missing-gate"},
            {"id": "empty-argv", "argv": []},
            {
                "id": "ambiguous-gate",
                "command": "python3 -m example.gate",
                "argv": ["python3", "-m", "example.gate"],
            },
        ):
            with self.subTest(gate=gate["id"]):
                with self.assertRaisesRegex(
                    ValueError,
                    "must contain exactly one valid command or argv",
                ):
                    self.module.gate_invocation(gate)


if __name__ == "__main__":
    unittest.main()
