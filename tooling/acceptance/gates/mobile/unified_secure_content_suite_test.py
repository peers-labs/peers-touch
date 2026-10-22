from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.core import (
    GateError,
    SuiteRuntimeAction,
    SuiteRuntimeLedger,
)
from tooling.acceptance.gates.mobile import unified_secure_content_suite


SOURCE = {
    "commit": "a" * 40,
    "workspaceDigest": "sha256:" + ("b" * 64),
    "canonicalWorktreeHash": "0123456789abcdef",
}


def runtime_report() -> dict[str, object]:
    ledger = SuiteRuntimeLedger(
        unified_secure_content_suite.RUNTIME_REUSE_CONTRACT,
        suite_runtime_id="uca05-runtime",
        source_digest=SOURCE["workspaceDigest"].removeprefix("sha256:"),
        fixture_epoch="fixture-1",
    )
    ledger.record(SuiteRuntimeAction.PROVISION, resource_id="stations")
    for index in range(3):
        ledger.record(
            SuiteRuntimeAction.CLIENT_LAUNCH,
            resource_id=f"client-{index}",
        )
    for scenario_id in unified_secure_content_suite.REQUIRED_SCENARIOS:
        ledger.record(
            SuiteRuntimeAction.SCENARIO_START,
            scenario_id=scenario_id,
        )
        ledger.record(SuiteRuntimeAction.UI_ACTION, scenario_id=scenario_id)
        ledger.record(
            SuiteRuntimeAction.RECEIVER_ASSERTION,
            scenario_id=scenario_id,
        )
        ledger.record(
            SuiteRuntimeAction.SCENARIO_END,
            scenario_id=scenario_id,
        )
    ledger.record(SuiteRuntimeAction.CLEANUP_COMPLETE)
    return ledger.require_valid()


def evidence() -> dict[str, object]:
    return {
        "artifactKind": "unified-client-secure-content-runtime-evidence",
        "source": SOURCE,
        "runtimeCells": list(
            unified_secure_content_suite.REQUIRED_RUNTIME_CELLS
        ),
        "suiteRuntime": runtime_report(),
        "scenarios": {
            scenario_id: {
                field: True
                for field in unified_secure_content_suite.SCENARIO_FIELDS
            }
            for scenario_id in unified_secure_content_suite.REQUIRED_SCENARIOS
        },
    }


class UnifiedSecureContentSuiteTest(unittest.TestCase):
    def test_exact_runtime_cells_are_required(self) -> None:
        self.assertEqual(
            unified_secure_content_suite.parse_runtime_cells(
                ",".join(
                    unified_secure_content_suite.REQUIRED_RUNTIME_CELLS
                )
            ),
            unified_secure_content_suite.REQUIRED_RUNTIME_CELLS,
        )
        with self.assertRaisesRegex(GateError, "exactly"):
            unified_secure_content_suite.parse_runtime_cells(
                "desktop-macos-native,mobile-ios-native"
            )

    def test_current_source_lifecycle_report_passes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "runtime-evidence.json"
            path.write_text(json.dumps(evidence()), encoding="utf-8")

            result = unified_secure_content_suite.validate_runtime_evidence(
                path,
                expected_source=SOURCE,
                runtime_cells=(
                    unified_secure_content_suite.REQUIRED_RUNTIME_CELLS
                ),
            )

        self.assertEqual(result["suiteRuntime"]["proofState"], "SUPPORTING")

    def test_stale_source_fails_closed(self) -> None:
        value = evidence()
        value["source"] = {**SOURCE, "commit": "c" * 40}
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "runtime-evidence.json"
            path.write_text(json.dumps(value), encoding="utf-8")

            with self.assertRaisesRegex(GateError, "stale"):
                unified_secure_content_suite.validate_runtime_evidence(
                    path,
                    expected_source=SOURCE,
                    runtime_cells=(
                        unified_secure_content_suite.REQUIRED_RUNTIME_CELLS
                    ),
                )

    def test_missing_revocation_proof_fails_closed(self) -> None:
        value = evidence()
        value["scenarios"]["secure-content-android"][
            "revocationConverged"
        ] = False
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "runtime-evidence.json"
            path.write_text(json.dumps(value), encoding="utf-8")

            with self.assertRaisesRegex(GateError, "lifecycle proof"):
                unified_secure_content_suite.validate_runtime_evidence(
                    path,
                    expected_source=SOURCE,
                    runtime_cells=(
                        unified_secure_content_suite.REQUIRED_RUNTIME_CELLS
                    ),
                )

    def test_truthy_values_cannot_prove_revocation(self) -> None:
        for unsupported in ("false", 1, ["revoked"]):
            with self.subTest(value=unsupported), tempfile.TemporaryDirectory() as temporary:
                value = evidence()
                value["scenarios"]["secure-content-android"]["revocationConverged"] = unsupported
                path = Path(temporary) / "runtime-evidence.json"
                path.write_text(json.dumps(value), encoding="utf-8")
                with self.assertRaisesRegex(GateError, "lifecycle proof"):
                    unified_secure_content_suite.validate_runtime_evidence(
                        path, expected_source=SOURCE,
                        runtime_cells=unified_secure_content_suite.REQUIRED_RUNTIME_CELLS,
                    )


if __name__ == "__main__":
    unittest.main()
