#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("desktop-performance-cohort-gate.py")
SPEC = importlib.util.spec_from_file_location(
    "desktop_performance_cohort_gate",
    SCRIPT,
)
assert SPEC is not None and SPEC.loader is not None
module = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = module
SPEC.loader.exec_module(module)


class DesktopPerformanceCohortGateTest(unittest.TestCase):
    def test_cohort_requires_only_native_tauri_runtimes(self) -> None:
        self.assertEqual(
            module.REQUIRED_RUNTIMES,
            ("tauri-webview-dev", "tauri-webview-packaged"),
        )

if __name__ == "__main__":
    unittest.main()
