from __future__ import annotations

import subprocess
import unittest
from unittest.mock import patch

from tooling.acceptance.gates.mobile.social_circles_native import (
    MobileSocialCirclesNativeGate,
)


class MobileSocialCirclesNativeGateTest(unittest.TestCase):
    def test_runs_focused_contracts_rust_social_and_mobile_build(self) -> None:
        completed = subprocess.CompletedProcess(
            args=["contract"],
            returncode=0,
            stdout="",
            stderr="",
        )
        gate = MobileSocialCirclesNativeGate()

        with patch(
            "tooling.acceptance.gates.mobile.social_circles_native.subprocess.run",
            return_value=completed,
        ) as run:
            result = gate.run()

        self.assertEqual(run.call_count, 3)
        self.assertEqual(run.call_args_list[1].args[0][:3], (
            "cargo",
            "test",
            "--manifest-path",
        ))
        self.assertEqual(run.call_args_list[2].args[0], (
            "pnpm",
            "--dir",
            "apps/mobile",
            "run",
            "build",
        ))
        self.assertIn(
            "member writes pending until list and member-count readback converge",
            result["proven_scope"],
        )
        self.assertIn("physical Android behavior", result["unproven_scope"])


if __name__ == "__main__":
    unittest.main()
