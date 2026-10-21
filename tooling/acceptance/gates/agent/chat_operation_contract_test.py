from __future__ import annotations

import unittest

from tooling.acceptance.gates.agent.chat_operation_contract import (
    coverage_report,
    operation_contract,
)


class OperationEvidenceTest(unittest.TestCase):
    def test_confirmed_baseline_and_production_authority_are_separate(self) -> None:
        rows = operation_contract()
        baseline = [row for row in rows if row["origin"] == "confirmed-prototype"]
        self.assertEqual(len(baseline), 121)
        self.assertEqual(len({row["journey"] for row in baseline}), 11)
        self.assertEqual(len({row["operationId"] for row in rows}), len(rows))
        self.assertIn("profile.documents.provider-consumption", {
            row["operationId"] for row in rows
        })

    def test_mapping_alone_cannot_prove_any_operation(self) -> None:
        report = coverage_report({})
        self.assertEqual(report["status"], "unproven")
        self.assertEqual(len(report["missingOperations"]), report["operationCount"])

    def test_api_or_source_check_cannot_replace_receiver_proof(self) -> None:
        row = operation_contract()[0]
        observation = {
            "status": "passed",
            "sourceCommit": "a" * 40,
            "runtimeId": "native-suite",
            "artifactRefs": [{"role": "station-readback"}],
            "gateId": row["gateId"],
        }
        report = coverage_report({row["operationId"]: observation})
        self.assertIn(row["operationId"], report["missingOperations"])
        observation.update(uiAction="row click", receiverAssertion="Chat visible")
        observation.update(
            operationId=row["operationId"],
            scenarioId=row["scenarioId"],
            suiteProofStatus="PROVEN",
            cleanupStatus="passed",
        )
        report = coverage_report({row["operationId"]: observation})
        self.assertNotIn(row["operationId"], report["missingOperations"])
        observation["gateId"] = "different-gate"
        report = coverage_report({row["operationId"]: observation})
        self.assertIn(row["operationId"], report["missingOperations"])

    def test_unknown_operation_cannot_enter_coverage(self) -> None:
        with self.assertRaisesRegex(ValueError, "unknown operation"):
            coverage_report({"invented": {}})

    def test_each_operation_maps_to_an_approved_task_scenario(self) -> None:
        import json
        import re
        from tooling.acceptance.gates.agent.chat_native_suite import PLAN_ROOT, TASK_BY_AREA

        for row in operation_contract():
            area = row["gateId"].removeprefix("agent-chat-").removesuffix("-native")
            source = (PLAN_ROOT / "tasks" / f"{TASK_BY_AREA[area]}.md").read_text()
            contract = json.loads(re.findall(r"```json\n([\s\S]*?)\n```", source)[0])
            self.assertIn(row["scenarioId"], contract["runtimeReuse"]["scenarioIds"])

    def test_failed_cleanup_and_foreign_operation_cannot_prove(self) -> None:
        row = operation_contract()[0]
        evidence = dict(
            status="passed", uiAction="click", receiverAssertion="visible",
            sourceCommit="a" * 40, runtimeId="suite", artifactRefs=[{"role": "dom"}],
            gateId=row["gateId"], scenarioId=row["scenarioId"],
            operationId=row["operationId"], suiteProofStatus="PROVEN",
            cleanupStatus="failed",
        )
        self.assertIn(row["operationId"], coverage_report({
            row["operationId"]: evidence,
        })["missingOperations"])
        evidence.update(cleanupStatus="passed", operationId="other")
        self.assertIn(row["operationId"], coverage_report({
            row["operationId"]: evidence,
        })["missingOperations"])

    def test_partial_suite_publishes_no_proven_children(self) -> None:
        from tooling.acceptance.gates.agent.chat_native_suite import stamp_observations

        row = operation_contract()[0]
        stamped = stamp_observations(
            {row["operationId"]: {
                "scenarioId": row["scenarioId"],
                "uiAction": "row click", "receiverAssertion": "Chat visible",
            }},
            gate_id=row["gateId"], source_commit="a" * 40, runtime_id="suite",
            artifact_refs=[{"role": "dom"}], lifecycle={"result": "PASS"},
            cleanup={"status": "passed"}, failure="",
        )
        self.assertEqual(stamped[row["operationId"]]["suiteProofStatus"], "UNPROVEN")
        self.assertEqual(
            len(coverage_report(stamped)["missingOperations"]),
            len(operation_contract()),
        )

    def test_workspace_contract_covers_all_child_scenarios(self) -> None:
        from tooling.acceptance.gates.agent.chat_native_suite import suite_contract

        contract = suite_contract("workspace")
        self.assertTrue({
            row["scenarioId"] for row in operation_contract()
        }.issubset(contract.scenario_ids))
        self.assertEqual(contract.max_provisioning_runs, 1)
        self.assertEqual(contract.max_client_launches, 3)

    def test_workspace_children_retain_owning_gates(self) -> None:
        from tooling.acceptance.gates.agent.chat_native_suite import stamp_observations

        observations = {
            row["operationId"]: {
                "scenarioId": row["scenarioId"],
                "uiAction": "production control click",
                "receiverAssertion": "actual output visible",
            }
            for row in operation_contract()
        }
        stamped = stamp_observations(
            observations, gate_id="agent-chat-workspace-native",
            source_commit="a" * 40, runtime_id="suite",
            artifact_refs=[{"role": "dom"}], lifecycle={"result": "PASS"},
            cleanup={"status": "passed"}, failure="",
        )
        for row in operation_contract():
            self.assertEqual(stamped[row["operationId"]]["gateId"], row["gateId"])
        self.assertEqual(coverage_report(stamped)["missingOperations"], [])


if __name__ == "__main__":
    unittest.main()
