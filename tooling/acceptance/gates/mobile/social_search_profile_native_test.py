from __future__ import annotations

import subprocess
import unittest
from unittest.mock import patch

from tooling.acceptance.gates.mobile.social_search_profile_native import (
    MobileSocialSearchProfileNativeGate,
)


class MobileSocialSearchProfileNativeGateTest(unittest.TestCase):
    def test_runs_focused_contracts_and_mobile_build(self) -> None:
        completed = subprocess.CompletedProcess(
            args=["contract"],
            returncode=0,
            stdout="",
            stderr="",
        )
        gate = MobileSocialSearchProfileNativeGate()

        with patch(
            "tooling.acceptance.gates.mobile.social_search_profile_native.subprocess.run",
            return_value=completed,
        ) as run:
            result = gate.run()

        self.assertEqual(run.call_count, 2)
        self.assertEqual(run.call_args_list[1].args[0], (
            "pnpm",
            "--dir",
            "apps/mobile",
            "run",
            "build",
        ))
        self.assertIn(
            "authoritative follow and unfollow relationship readback",
            result["proven_scope"],
        )
        self.assertIn("physical Android behavior", result["unproven_scope"])


if __name__ == "__main__":
    unittest.main()
