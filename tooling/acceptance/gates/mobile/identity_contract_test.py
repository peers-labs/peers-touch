from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling.acceptance.core import GateError
from tooling.acceptance.gates.mobile.identity_contract import (
    MobileIdentityContractGate,
)


class MobileIdentityContractGateTest(unittest.TestCase):
    def test_failure_preserves_w1_traceability(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            report_path = Path(temporary_directory) / "report.json"
            gate = MobileIdentityContractGate()
            gate.report_path = report_path

            with patch(
                "tooling.acceptance.gates.mobile.identity_contract."
                "validate_identity_contract",
                side_effect=GateError("non-canonical alias remains"),
            ):
                self.assertEqual(gate.execute(), 1)

            report = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertEqual(report["status"], "FAIL")
            self.assertEqual(
                report["phase"],
                "W1 Unified ActorRef identity and Station trust",
            )
            self.assertEqual(report["bom"], ["W1"])
            self.assertEqual(report["spec"], ["MS-AG01", "MS-AG02"])
            self.assertIn("non-canonical alias remains", report["error"])

    def test_success_keeps_native_behavior_unproven(self) -> None:
        gate = MobileIdentityContractGate()

        with patch(
            "tooling.acceptance.gates.mobile.identity_contract."
            "validate_identity_contract",
        ):
            result = gate.run()

        self.assertIn(
            "PTID-only ActorRef",
            result["proven_scope"][0],
        )
        self.assertEqual(
            result["unproven_scope"],
            ["native Station and session behavior"],
        )


if __name__ == "__main__":
    unittest.main()
