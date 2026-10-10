from __future__ import annotations

import subprocess
import unittest
from unittest.mock import patch

from tooling.acceptance.gates.mobile.social_facade_contract import (
    MobileSocialFacadeContractGate,
)


class MobileSocialFacadeContractGateTest(unittest.TestCase):
    def test_runs_web_build_and_rust_social_contracts(self) -> None:
        completed = subprocess.CompletedProcess(
            args=["contract"],
            returncode=0,
            stdout="",
            stderr="",
        )
        gate = MobileSocialFacadeContractGate()

        with patch(
            "tooling.acceptance.gates.mobile.social_facade_contract.subprocess.run",
            return_value=completed,
        ) as run:
            result = gate.run()

        self.assertEqual(run.call_count, 3)
        self.assertEqual(run.call_args_list[1].args[0], (
            "pnpm",
            "--dir",
            "apps/mobile",
            "run",
            "build",
        ))
        self.assertEqual(run.call_args_list[2].args[0], (
            "cargo",
            "test",
            "--manifest-path",
            "apps/mobile/src-tauri/Cargo.toml",
            "social",
        ))
        self.assertIn(
            "facade teardown and stale-completion rejection",
            result["proven_scope"],
        )
        self.assertIn(
            "native iOS or physical Android user journey",
            result["unproven_scope"],
        )


if __name__ == "__main__":
    unittest.main()
