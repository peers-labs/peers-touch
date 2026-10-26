from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling.acceptance.core import GateError
from tooling.acceptance.gates.mobile.identity_contract import (
    MobileIdentityContractGate,
    _source_files,
    validate_identity_contract,
)


class MobileIdentityContractGateTest(unittest.TestCase):
    def test_external_provider_ids_do_not_allow_actor_or_numeric_ids(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            proto = root / "model/domain/channel/channel.proto"
            proto.parent.mkdir(parents=True)
            for declaration, allowed in (
                ("string provider_user_id = 1;", True),
                ("string sender_id = 1;", True),
                ("string actor_id = 1;", False),
                ("uint64 provider_user_id = 1;", False),
                ("uint64 sender_id = 1;", False),
            ):
                with self.subTest(declaration=declaration), patch(
                    "tooling.acceptance.gates.mobile.identity_contract.REPO_ROOT",
                    root,
                ), patch(
                    "tooling.acceptance.gates.mobile.identity_contract.IDENTITY_SOURCE_ROOTS",
                    (),
                ):
                    proto.write_text(declaration, encoding="utf-8")
                    if allowed:
                        validate_identity_contract()
                    else:
                        with self.assertRaisesRegex(GateError, "public actor_id fields remain"):
                            validate_identity_contract()

    def test_source_scan_prunes_dependency_and_build_trees(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            for name in ("src/identity.ts", "node_modules/vendor/identity.ts", "target/cache.rs"):
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("actor_did", encoding="utf-8")
            self.assertEqual(list(_source_files(root)), [root / "src/identity.ts"])

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
