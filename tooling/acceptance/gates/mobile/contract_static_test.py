from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling.acceptance.gates.mobile.contract_static import (
    MobileContractStaticGate,
)


class MobileContractStaticGateTest(unittest.TestCase):
    def test_runs_projection_fence_regressions_after_contract_checks(self) -> None:
        completed = subprocess.CompletedProcess(
            args=["pnpm"],
            returncode=0,
            stdout="",
            stderr="",
        )
        gate = MobileContractStaticGate()

        with patch(
            "tooling.acceptance.gates.mobile.contract_static.subprocess.run",
            return_value=completed,
        ) as run:
            result = gate.run()

        self.assertEqual(run.call_count, 2)
        self.assertEqual(
            run.call_args_list[0].args[0],
            [
                "pnpm",
                "--dir",
                "apps/mobile",
                "run",
                "check:mobile-shell-contracts",
            ],
        )
        self.assertEqual(
            run.call_args_list[1].args[0],
            [
                "pnpm",
                "--dir",
                "apps/mobile",
                "exec",
                "vitest",
                "run",
                "src/acceptance/actions.social.test.ts",
                "src/features/social/momentsFeedStore.test.ts",
                "src/features/social/socialStore.profileSessionFence.test.ts",
                "src/runtimes/socialProjectionRuntime.test.ts",
                "src/pages/MomentsPage.test.ts",
                "src/pages/moments/MomentCommentsSection.test.tsx",
            ],
        )
        self.assertIn(
            "Mobile Moments and Profile source-level runtime projection fencing",
            result["proven_scope"],
        )

    def test_bounded_list_paths_select_receiver_and_native_quality_gates(self) -> None:
        root = Path(__file__).resolve().parents[4]
        spec = importlib.util.spec_from_file_location(
            "mobile_list_acceptance_plan",
            root / "tooling/scripts/acceptance-plan.py",
        )
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        planner = importlib.util.module_from_spec(spec)
        with patch.object(sys, "path", [str(root / "tooling/scripts"), *sys.path]):
            spec.loader.exec_module(planner)
        paths = (
            "apps/mobile/src/components/BoundedList.tsx",
            "apps/mobile/src/components/boundedListRange.ts",
            "apps/mobile/scripts/check-bounded-lists.mjs",
            "apps/mobile/scripts/fixtures/bounded-list.tsx",
        )
        for path in paths:
            with self.subTest(path=path):
                result = planner.plan(root / "tooling/acceptance", [path])
                self.assertEqual(set(result["impacted_features"]), {
                    "mobile-chat-contacts-groups",
                    "mobile-native-accessibility-performance",
                })
                self.assertEqual({gate["id"] for gate in result["selected_gates"]}, {
                    "mobile-simulator-social-convergence-e2e",
                    "mobile-simulator-chat-contacts-e2e",
                    "mobile-ios-simulator-layout-accessibility-e2e",
                    "mobile-simulator-platform-e2e",
                    "mobile-hard-cut-static",
                })

    def test_runtime_availability_paths_select_lifecycle_and_receiver_gates(self) -> None:
        root = Path(__file__).resolve().parents[4]
        spec = importlib.util.spec_from_file_location(
            "mobile_contract_acceptance_plan",
            root / "tooling/scripts/acceptance-plan.py",
        )
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        planner = importlib.util.module_from_spec(spec)
        with patch.object(sys, "path", [str(root / "tooling/scripts"), *sys.path]):
            spec.loader.exec_module(planner)
        expected_gates = {
            "mobile-contract-static",
            "mobile-simulator-runtime-lifecycle-e2e",
            "mobile-simulator-station-lifecycle-e2e",
            "mobile-simulator-recovery-ui-e2e",
            "mobile-simulator-social-convergence-e2e",
            "mobile-simulator-chat-contacts-e2e",
            "mobile-simulator-moments-e2e",
            "mobile-simulator-settings-e2e",
        }
        expected_features = {
            "mobile-session-lifecycle",
            "mobile-recovery-degraded-states",
            "mobile-chat-contacts-groups",
            "mobile-moments-participation",
            "mobile-profile-settings",
        }
        paths = (
            "apps/mobile/src/components/MobileRouteBoundary.tsx",
            "apps/mobile/src/components/MobileRouteBoundary.test.tsx",
            "apps/mobile/src/runtimes/runtimeSessionTransition.ts",
            "apps/mobile/src/runtimes/runtimeSessionTransition.test.ts",
            "apps/mobile/src/runtimes/messagingRuntime.ts",
            "apps/mobile/src/app/lifecycle/runtimeAvailability.ts",
            "apps/mobile/src/app/lifecycle/runtimeReadiness.test.ts",
        )
        for path in paths:
            with self.subTest(path=path):
                result = planner.plan(root / "tooling/acceptance", [path])
                self.assertEqual(
                    {gate["id"] for gate in result["selected_gates"]},
                    expected_gates,
                )
                self.assertEqual(
                    set(result["impacted_features"]),
                    expected_features,
                )

    def test_hard_cut_failure_preserves_plan_traceability(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            report_path = Path(temporary_directory) / "report.json"
            gate = MobileContractStaticGate(hard_cut=True)
            gate.report_path = report_path

            with patch(
                "tooling.acceptance.gates.mobile.contract_static.subprocess.run",
                return_value=subprocess.CompletedProcess(
                    args=["pnpm"],
                    returncode=1,
                    stdout="",
                    stderr="retired callers remain",
                ),
            ):
                self.assertEqual(gate.execute(), 1)

            report = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertEqual(report["status"], "FAIL")
            self.assertEqual(report["phase"], "W8 Atomic old-path deletion")
            self.assertEqual(report["bom"], ["W8"])
            self.assertEqual(report["spec"], ["MS-AG01"])
            self.assertIn("retired callers remain", report["error"])

    def test_regular_contract_gate_does_not_claim_w8(self) -> None:
        gate = MobileContractStaticGate()

        self.assertIsNone(gate.report.phase)
        self.assertEqual(gate.report.bom, [])
        self.assertEqual(gate.report.spec, [])


if __name__ == "__main__":
    unittest.main()
