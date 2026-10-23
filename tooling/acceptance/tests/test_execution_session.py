"""Repair cycles preserve scope and never transfer product proof across source."""

import unittest

from tooling.acceptance.core.execution_budget import ExecutionBudgetError
from tooling.acceptance.core.execution_session import ExecutionSession


class ExecutionSessionTest(unittest.TestCase):
    def test_repair_resumes_full_scope_and_invalidates_old_source(self):
        session = ExecutionSession(["first", "second"], "policy")
        source = {"commit": "one", "workspaceDigest": "one"}
        self.assertEqual(session.begin(source), ("first", "second"))
        session.observe({
            "source": source,
            "results": [{"id": "first", "status": "failed"}, {"id": "second", "status": "blocked"}],
            "executionBudget": {"stop": {"gateId": "first"}},
        }, {"runId": "first-attempt"})
        with self.assertRaises(ExecutionBudgetError):
            session.begin(source)
        session.repair(
            cause="duplicate control-plane work", owner="acceptance",
            correction="one parse and bounded references",
            validation_refs=[{"runId": "framework-validation"}],
            qualification="ARCHITECTURE_OVERHEAD",
        )
        session.begin({"commit": "two", "workspaceDigest": "two"})
        self.assertTrue(session.report()["attempts"][1]["invalidatedPriorProof"])
        self.assertEqual(session.report()["attempts"][1]["gateIds"], ["first", "second"])
        self.assertEqual(session.report()["proofStatus"], "supporting-only")

    def test_repair_may_reorder_the_same_scope_after_dependency_change(self):
        session = ExecutionSession(["audit", "producer"], "policy")
        source = {"commit": "one"}
        session.begin(source)
        session.observe({
            "source": source,
            "results": [
                {"id": "audit", "status": "failed"},
                {"id": "producer", "status": "passed"},
            ],
        }, {})
        session.repair(
            cause="dependency order was missing",
            owner="acceptance",
            correction="declare the proof dependency",
            validation_refs=[{"runId": "validation"}],
            qualification="ARCHITECTURE_OVERHEAD",
        )

        self.assertEqual(
            session.begin(source, ["producer", "audit"]),
            ("producer", "audit"),
        )
        self.assertEqual(
            session.report()["attempts"][-1]["gateIds"],
            ["producer", "audit"],
        )

    def test_repair_cannot_add_or_remove_scope_when_reordering(self):
        session = ExecutionSession(["first", "second"], "policy")

        for dispatch in (["first"], ["first", "second", "third"]):
            with self.subTest(dispatch=dispatch), self.assertRaises(
                ExecutionBudgetError
            ):
                session.begin({"commit": "one"}, dispatch)

    def test_unknown_cause_requires_judgment(self):
        session = ExecutionSession(["gate"], "policy")
        source = {"commit": "one"}
        session.begin(source)
        session.observe({"source": source, "results": [{"id": "gate", "status": "failed"}]}, {})
        session.repair(cause="unknown", owner="acceptance", correction="investigation",
                       validation_refs=[{"runId": "diagnostic"}], qualification="UNKNOWN")
        self.assertEqual(session.state, "NEEDS_JUDGMENT")
        with self.assertRaises(ExecutionBudgetError):
            session.begin(source)

    def test_scope_loss_or_source_drift_rejected(self):
        for report in [
            {"source": {"commit": "other"}, "results": [{"id": "gate"}]},
            {"source": {"commit": "one"}, "results": []},
            {"source": {"commit": "one"}, "results": [{"id": "gate"}, {"id": "gate"}]},
        ]:
            session = ExecutionSession(["gate"], "policy")
            session.begin({"commit": "one"})
            with self.assertRaises(ExecutionBudgetError):
                session.observe(report, {})

    def test_new_policy_lineage_cannot_change_scope_or_reuse_policy(self):
        prior = ExecutionSession(["first", "second"], "old-policy")
        source = {"commit": "one"}
        prior.begin(source)
        prior.observe({
            "source": source,
            "results": [{"id": "first", "status": "failed"},
                        {"id": "second", "status": "blocked"}],
        }, {})
        for gates, policy in [
            (["first"], "new-policy"),
            (["first", "second", "third"], "new-policy"),
            (["first", "second"], "old-policy"),
        ]:
            with self.subTest(gates=gates, policy=policy), self.assertRaises(
                ExecutionBudgetError
            ):
                ExecutionSession.from_prior(
                    gates, policy, prior.report(), manifest_ref={}, session_ref={},
                )
        changed = prior.report()
        changed["attempts"][0]["policyDigest"] = "new-policy"
        with self.assertRaises(ExecutionBudgetError):
            ExecutionSession.restore(changed)


if __name__ == "__main__":
    unittest.main()
