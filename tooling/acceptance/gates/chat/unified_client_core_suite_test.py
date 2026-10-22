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
from tooling.acceptance.gates.chat import unified_client_core_suite


SOURCE = {
    "commit": "a" * 40,
    "workspaceDigest": "sha256:" + ("b" * 64),
    "canonicalWorktreeHash": "0123456789abcdef",
}


def runtime_report() -> dict[str, object]:
    ledger = SuiteRuntimeLedger(
        unified_client_core_suite.RUNTIME_REUSE_CONTRACT,
        suite_runtime_id="uca04-runtime",
        source_digest=SOURCE["workspaceDigest"].removeprefix("sha256:"),
        fixture_epoch="fixture-1",
    )
    ledger.record(SuiteRuntimeAction.PROVISION, resource_id="stations")
    for index in range(5):
        ledger.record(
            SuiteRuntimeAction.CLIENT_LAUNCH,
            resource_id=f"client-{index}",
        )
    for scenario_id in unified_client_core_suite.REQUIRED_SCENARIOS:
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
        "artifactKind": "unified-client-messaging-runtime-evidence",
        "source": SOURCE,
        "runtimeCells": list(
            unified_client_core_suite.REQUIRED_RUNTIME_CELLS
        ),
        "suiteRuntime": runtime_report(),
        "scenarios": {
            scenario_id: {
                "senderProjection": True,
                "receiverProjection": True,
                "receiverVisible": True,
                "restartConverged": True,
                "receiptConverged": True,
            }
            for scenario_id in unified_client_core_suite.REQUIRED_SCENARIOS
        },
    }


class UnifiedClientMessagingSuiteTest(unittest.TestCase):
    def test_exact_runtime_cells_are_required(self) -> None:
        self.assertEqual(
            unified_client_core_suite.parse_runtime_cells(
                ",".join(
                    unified_client_core_suite.REQUIRED_RUNTIME_CELLS
                )
            ),
            unified_client_core_suite.REQUIRED_RUNTIME_CELLS,
        )
        with self.assertRaisesRegex(GateError, "exactly"):
            unified_client_core_suite.parse_runtime_cells(
                "desktop-macos-native,mobile-ios-native"
            )

    def test_current_source_receiver_visible_report_passes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "runtime-evidence.json"
            path.write_text(json.dumps(evidence()), encoding="utf-8")

            result = unified_client_core_suite.validate_runtime_evidence(
                path,
                expected_source=SOURCE,
                runtime_cells=(
                    unified_client_core_suite.REQUIRED_RUNTIME_CELLS
                ),
            )

        self.assertEqual(
            result["suiteRuntime"]["proofState"],
            "SUPPORTING",
        )

    def test_stale_source_fails_closed(self) -> None:
        value = evidence()
        value["source"] = {**SOURCE, "commit": "c" * 40}
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "runtime-evidence.json"
            path.write_text(json.dumps(value), encoding="utf-8")

            with self.assertRaisesRegex(GateError, "stale"):
                unified_client_core_suite.validate_runtime_evidence(
                    path,
                    expected_source=SOURCE,
                    runtime_cells=(
                        unified_client_core_suite.REQUIRED_RUNTIME_CELLS
                    ),
                )

    def test_receiver_projection_gap_fails_closed(self) -> None:
        value = evidence()
        value["scenarios"]["messaging-desktop-android"][
            "receiverVisible"
        ] = False
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "runtime-evidence.json"
            path.write_text(json.dumps(value), encoding="utf-8")

            with self.assertRaisesRegex(GateError, "receiver-proven"):
                unified_client_core_suite.validate_runtime_evidence(
                    path,
                    expected_source=SOURCE,
                    runtime_cells=(
                        unified_client_core_suite.REQUIRED_RUNTIME_CELLS
                    ),
                )

    def test_commit_only_report_cannot_prove_dirty_workspace(self) -> None:
        value = evidence()
        value["suiteRuntime"]["sourceDigest"] = SOURCE["commit"]
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "runtime-evidence.json"
            path.write_text(json.dumps(value), encoding="utf-8")
            with self.assertRaises(GateError):
                unified_client_core_suite.validate_runtime_evidence(
                    path, expected_source=SOURCE,
                    runtime_cells=unified_client_core_suite.REQUIRED_RUNTIME_CELLS,
                )

    def test_truthy_values_cannot_prove_receiver_visibility(self) -> None:
        for unsupported in ("false", 1, ["visible"]):
            with self.subTest(value=unsupported), tempfile.TemporaryDirectory() as temporary:
                value = evidence()
                value["scenarios"]["messaging-desktop-android"]["receiverVisible"] = unsupported
                path = Path(temporary) / "runtime-evidence.json"
                path.write_text(json.dumps(value), encoding="utf-8")
                with self.assertRaisesRegex(GateError, "receiver-proven"):
                    unified_client_core_suite.validate_runtime_evidence(
                        path, expected_source=SOURCE,
                        runtime_cells=unified_client_core_suite.REQUIRED_RUNTIME_CELLS,
                    )


if __name__ == "__main__":
    unittest.main()
