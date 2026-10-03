from __future__ import annotations

import copy
import unittest

from tooling.acceptance.core.errors import SuiteRuntimeError
from tooling.acceptance.core.suite_runtime import (
    RuntimeReuseContract,
    SuiteRuntimeAction,
    SuiteRuntimeLedger,
    validate_suite_runtime_report,
)


CONTRACT = RuntimeReuseContract.from_dict(
    {
        "scope": "suite",
        "entryCheckId": "suite-functional",
        "scenarioIds": ["publish", "comment", "delete"],
        "maxProvisioningRuns": 1,
        "maxClientLaunches": 2,
        "minWarmReuseRate": 0.66,
        "requireAttachOnlyScenarios": True,
        "requireReceiverVisibleProof": True,
        "allowClientReplacement": False,
    }
)


def valid_ledger() -> SuiteRuntimeLedger:
    ledger = SuiteRuntimeLedger(
        CONTRACT,
        suite_runtime_id="social-desktop-suite",
        source_digest="a" * 40,
        fixture_epoch="fixture-epoch-1",
    )
    ledger.record(
        SuiteRuntimeAction.PROVISION,
        resource_id="desktop-social-runtime",
        duration_seconds=12,
    )
    for actor in ("alice", "bob"):
        ledger.record(
            SuiteRuntimeAction.ACCOUNT_PROVISION,
            resource_id=actor,
        )
        ledger.record(
            SuiteRuntimeAction.CLIENT_LAUNCH,
            resource_id=f"desktop-{actor}",
            duration_seconds=4,
        )
        ledger.record(
            SuiteRuntimeAction.LOGIN,
            resource_id=f"desktop-{actor}",
            duration_seconds=1,
        )
    for scenario_id in CONTRACT.scenario_ids:
        ledger.record(
            SuiteRuntimeAction.SCENARIO_START,
            scenario_id=scenario_id,
        )
        ledger.record(
            SuiteRuntimeAction.FIXTURE_RESET,
            scenario_id=scenario_id,
        )
        ledger.record(
            SuiteRuntimeAction.UI_ACTION,
            scenario_id=scenario_id,
            resource_id="sender",
        )
        ledger.record(
            SuiteRuntimeAction.RECEIVER_ASSERTION,
            scenario_id=scenario_id,
            resource_id="receiver",
        )
        ledger.record(
            SuiteRuntimeAction.SCENARIO_END,
            scenario_id=scenario_id,
        )
    ledger.record(SuiteRuntimeAction.CLEANUP_COMPLETE)
    return ledger


class RuntimeReuseContractTests(unittest.TestCase):
    def test_contract_round_trips(self) -> None:
        self.assertEqual(
            RuntimeReuseContract.from_dict(CONTRACT.to_dict()),
            CONTRACT,
        )

    def test_contract_rejects_scenario_scope(self) -> None:
        payload = CONTRACT.to_dict()
        payload["scope"] = "scenario"
        with self.assertRaisesRegex(
            SuiteRuntimeError,
            "SUITE_RUNTIME_SCOPE_INVALID",
        ):
            RuntimeReuseContract.from_dict(payload)

    def test_contract_rejects_duplicate_scenarios(self) -> None:
        payload = CONTRACT.to_dict()
        payload["scenarioIds"] = ["publish", "publish"]
        with self.assertRaisesRegex(
            SuiteRuntimeError,
            "SUITE_RUNTIME_CONTRACT_INVALID",
        ):
            RuntimeReuseContract.from_dict(payload)


class SuiteRuntimeLedgerTests(unittest.TestCase):
    def test_valid_suite_reports_reuse_and_supporting_proof(self) -> None:
        report = valid_ledger().require_valid()

        self.assertEqual(report["result"], "PASS")
        self.assertEqual(report["proofState"], "SUPPORTING")
        self.assertEqual(report["metrics"]["provisioningRuns"], 1)
        self.assertEqual(report["metrics"]["clientLaunches"], 2)
        self.assertEqual(report["metrics"]["completedScenarios"], 3)
        self.assertEqual(report["metrics"]["warmReuseRate"], 0.666667)
        self.assertEqual(
            validate_suite_runtime_report(
                report,
                expected_contract=CONTRACT,
            ),
            report,
        )

    def test_scenario_cannot_provision_runtime(self) -> None:
        ledger = SuiteRuntimeLedger(
            CONTRACT,
            suite_runtime_id="suite",
            source_digest="b" * 40,
            fixture_epoch="epoch",
        )
        ledger.record(
            SuiteRuntimeAction.PROVISION,
            resource_id="runtime",
        )
        ledger.record(
            SuiteRuntimeAction.SCENARIO_START,
            scenario_id="publish",
        )

        with self.assertRaisesRegex(
            SuiteRuntimeError,
            "SCENARIO_OWNED_PROVISIONING",
        ):
            ledger.record(
                SuiteRuntimeAction.CLIENT_LAUNCH,
                resource_id="late-client",
            )

    def test_duplicate_expensive_resource_is_rejected(self) -> None:
        ledger = SuiteRuntimeLedger(
            CONTRACT,
            suite_runtime_id="suite",
            source_digest="c" * 40,
            fixture_epoch="epoch",
        )
        ledger.record(
            SuiteRuntimeAction.CLIENT_LAUNCH,
            resource_id="desktop-alice",
        )
        with self.assertRaisesRegex(
            SuiteRuntimeError,
            "DUPLICATE_SUITE_RESOURCE",
        ):
            ledger.record(
                SuiteRuntimeAction.CLIENT_LAUNCH,
                resource_id="desktop-alice",
            )

    def test_harness_observation_does_not_replace_ui_proof(self) -> None:
        ledger = SuiteRuntimeLedger(
            CONTRACT,
            suite_runtime_id="suite",
            source_digest="d" * 40,
            fixture_epoch="epoch",
        )
        ledger.record(
            SuiteRuntimeAction.PROVISION,
            resource_id="runtime",
        )
        for scenario_id in CONTRACT.scenario_ids:
            ledger.record(
                SuiteRuntimeAction.SCENARIO_START,
                scenario_id=scenario_id,
            )
            ledger.record(
                SuiteRuntimeAction.SUPPORTING_OBSERVATION,
                scenario_id=scenario_id,
                resource_id="harness",
            )
            ledger.record(
                SuiteRuntimeAction.SCENARIO_END,
                scenario_id=scenario_id,
            )
        ledger.record(SuiteRuntimeAction.CLEANUP_COMPLETE)

        report = ledger.report()
        self.assertEqual(report["result"], "FAIL")
        self.assertEqual(report["proofState"], "UNPROVEN")
        self.assertIn(
            "UI_ACTION_EVIDENCE_MISSING",
            {finding["code"] for finding in report["findings"]},
        )
        self.assertIn(
            "RECEIVER_ASSERTION_MISSING",
            {finding["code"] for finding in report["findings"]},
        )

    def test_report_rejects_digest_mutation(self) -> None:
        report = valid_ledger().require_valid()
        mutated = copy.deepcopy(report)
        mutated["metrics"]["clientLaunches"] = 99

        with self.assertRaisesRegex(
            SuiteRuntimeError,
            "SUITE_RUNTIME_REPORT_DIGEST_MISMATCH",
        ):
            validate_suite_runtime_report(mutated)

    def test_report_requires_cleanup_and_every_scenario(self) -> None:
        ledger = SuiteRuntimeLedger(
            CONTRACT,
            suite_runtime_id="suite",
            source_digest="e" * 40,
            fixture_epoch="epoch",
        )
        ledger.record(
            SuiteRuntimeAction.PROVISION,
            resource_id="runtime",
        )
        ledger.record(
            SuiteRuntimeAction.SCENARIO_START,
            scenario_id="publish",
        )
        ledger.record(
            SuiteRuntimeAction.UI_ACTION,
            scenario_id="publish",
        )
        ledger.record(
            SuiteRuntimeAction.RECEIVER_ASSERTION,
            scenario_id="publish",
        )
        ledger.record(
            SuiteRuntimeAction.SCENARIO_END,
            scenario_id="publish",
        )

        findings = {
            finding["code"] for finding in ledger.report()["findings"]
        }
        self.assertIn("SUITE_SCENARIOS_INCOMPLETE", findings)
        self.assertIn("SUITE_CLEANUP_INCOMPLETE", findings)

    def test_client_replacement_consumes_launch_budget(self) -> None:
        contract = RuntimeReuseContract.from_dict(
            {
                **CONTRACT.to_dict(),
                "maxClientLaunches": 1,
                "allowClientReplacement": True,
            }
        )
        ledger = SuiteRuntimeLedger(
            contract,
            suite_runtime_id="suite",
            source_digest="f" * 40,
            fixture_epoch="epoch",
        )
        ledger.record(
            SuiteRuntimeAction.PROVISION,
            resource_id="runtime",
        )
        ledger.record(
            SuiteRuntimeAction.CLIENT_LAUNCH,
            resource_id="desktop-alice",
        )
        ledger.record(
            SuiteRuntimeAction.CLIENT_REPLACEMENT,
            resource_id="desktop-alice-replacement",
        )

        findings = {
            finding["code"] for finding in ledger.report()["findings"]
        }
        self.assertIn("CLIENT_LAUNCH_BUDGET_EXCEEDED", findings)


if __name__ == "__main__":
    unittest.main()
