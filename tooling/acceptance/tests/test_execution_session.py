"""Fixed obligations, cancellation classification and proof invalidation."""

from copy import deepcopy
from pathlib import Path
import unittest

from tooling.acceptance.core import ArtifactRef, new_run_id, workspace_id
from tooling.acceptance.core.execution_budget import ExecutionBudgetError
from tooling.acceptance.core.execution_session import ExecutionSession


class ExecutionSessionTest(unittest.TestCase):
    source = {"commit": "one"}

    def setUp(self):
        self.report_ref = ArtifactRef(
            workspace_id(Path(__file__).resolve().parents[3]),
            "acceptance-run", new_run_id(), "reports/run.json", "a" * 64,
            "application/json",
        ).to_dict()

    def begin(self, session, source=None, dispatch=None, validated=None, **identities):
        return session.begin(
            source or self.source, dispatch,
            graph_digest=identities.get("graph", "graph"),
            context_digest=identities.get("context", "context"),
            validated_gate_ids=validated,
        )

    def exhausted_report(self):
        return {
            "source": self.source,
            "results": [
                {"id": "first", "status": "passed", "completionStatus": "DONE",
                 "proofStatus": "PROVEN", "cleanupStatus": "not-required"},
                {"id": "second", "status": "failed", "completionStatus": "PARTIAL",
                 "proofStatus": "UNPROVEN", "cleanupStatus": "passed"},
            ],
            "executionBudget": {"stop": {
                "reason": "EXECUTION_BUDGET_STOP", "gateId": "second",
                "cost": {"overrun": {
                    "phase": "work", "stage": "command",
                    "constraints": [{"kind": "request-work", "owner": "Acceptance Runner",
                                     "source": "requestSeconds"}],
                }},
            }},
        }

    def test_clean_request_exhaustion_has_a_distinct_resume_state(self):
        session = ExecutionSession(["first", "second"], "policy")
        self.begin(session)
        session.observe(self.exhausted_report(), self.report_ref)
        self.assertEqual(session.state, "PAUSED_REQUEST_EXHAUSTED")
        restored = ExecutionSession.restore(session.report())
        self.assertEqual(self.begin(restored, dispatch=["second"], validated=["first"]), ("second",))
        self.assertEqual(restored.required_gate_ids, ("first", "second"))
        self.assertEqual(restored.requests[-1]["validatedGateIds"], ["first"])

    def test_other_or_mixed_limits_and_missing_cleanup_require_repair(self):
        baseline = self.exhausted_report()
        variants = []
        for phase in ("cleanup", "publish"):
            value = deepcopy(baseline)
            value["executionBudget"]["stop"]["cost"]["overrun"]["phase"] = phase
            variants.append(value)
        for constraint in (
            {"kind": "operation", "owner": "command", "source": "timeout"},
            {"kind": "request-work", "owner": "wrong", "source": "requestSeconds"},
        ):
            value = deepcopy(baseline)
            value["executionBudget"]["stop"]["cost"]["overrun"]["constraints"].append(constraint)
            variants.append(value)
        for cleanup in (None, "failed", "UNPROVEN"):
            value = deepcopy(baseline)
            value["results"][1]["cleanupStatus"] = cleanup
            variants.append(value)
        for value in variants:
            with self.subTest(value=value):
                session = ExecutionSession(["first", "second"], "policy")
                self.begin(session)
                session.observe(value, self.report_ref)
                self.assertEqual(session.state, "PAUSED_REPAIR_REQUIRED")
                with self.assertRaises(ExecutionBudgetError):
                    self.begin(session)

    def test_source_graph_or_context_change_invalidates_all_completion(self):
        for changes in (
            {"source": {"commit": "two"}}, {"graph": "other"}, {"context": "other"},
        ):
            with self.subTest(changes=changes):
                session = ExecutionSession(["first", "second"], "policy")
                self.begin(session)
                session.observe(self.exhausted_report(), self.report_ref)
                with self.assertRaises(ExecutionBudgetError):
                    self.begin(session, dispatch=["second"], validated=["first"], **changes)
                self.begin(session, **changes)
                self.assertTrue(session.report()["requests"][1]["invalidatedPriorProof"])
                self.assertEqual(session.requests[1]["dispatchGateIds"], ["first", "second"])

    def test_scope_cannot_disappear_overlap_or_expand(self):
        for dispatch, validated in (
            (["first"], []), (["first", "second", "third"], []),
            (["second"], ["first", "second"]), (["first", "first"], ["second"]),
        ):
            with self.subTest(dispatch=dispatch), self.assertRaises(ExecutionBudgetError):
                self.begin(ExecutionSession(["first", "second"], "policy"), dispatch=dispatch, validated=validated)

    def test_unknown_cause_requires_judgment(self):
        session = ExecutionSession(["first", "second"], "policy")
        self.begin(session)
        value = self.exhausted_report()
        value["executionBudget"]["stop"]["reason"] = "EXECUTION_FAILURE_STOP"
        session.observe(value, self.report_ref)
        session.repair(cause="unknown", owner="acceptance", correction="investigation",
                       validation_refs=[self.report_ref], qualification="UNKNOWN")
        self.assertEqual(session.state, "NEEDS_JUDGMENT")
        with self.assertRaises(ExecutionBudgetError):
            self.begin(session)
        with self.assertRaises(ExecutionBudgetError):
            ExecutionSession.restore(session.report())

    def test_repair_reexecutes_full_scope_without_transfer(self):
        session = ExecutionSession(["first", "second"], "policy")
        self.begin(session)
        value = self.exhausted_report()
        value["executionBudget"]["stop"]["reason"] = "EXECUTION_FAILURE_STOP"
        session.observe(value, self.report_ref)
        session.repair(cause="fixture", owner="synthetic", correction="restore input",
                       validation_refs=[self.report_ref], qualification="ARCHITECTURE_OVERHEAD")
        with self.assertRaises(ExecutionBudgetError):
            self.begin(session, dispatch=["second"], validated=["first"])
        self.assertEqual(self.begin(session), ("first", "second"))

    def test_scope_loss_or_source_drift_rejected(self):
        for report in [
            {"source": {"commit": "other"}, "results": [{"id": "gate"}]},
            {"source": self.source, "results": []},
            {"source": self.source, "results": [{"id": "gate"}, {"id": "gate"}]},
        ]:
            session = ExecutionSession(["gate"], "policy")
            self.begin(session)
            with self.assertRaises(ExecutionBudgetError):
                session.observe(report, self.report_ref)

    def test_corrupt_ledger_and_policy_lineage_rejected(self):
        prior = ExecutionSession(["first", "second"], "old-policy")
        self.begin(prior)
        prior.observe(self.exhausted_report(), self.report_ref)
        for gates, policy in [
            (["first"], "new-policy"), (["first", "second", "third"], "new-policy"),
            (["first", "second"], "old-policy"),
        ]:
            with self.subTest(gates=gates, policy=policy), self.assertRaises(ExecutionBudgetError):
                ExecutionSession.from_prior(gates, policy, prior.report(), manifest_ref={}, session_ref={})
        for mutate in (
            lambda value: value.update(extra=True),
            lambda value: value["requests"][0].update(policyDigest="changed"),
            lambda value: value["requests"][0].update(validatedGateIds=["first"]),
            lambda value: value.update(state="QUALIFIED"),
        ):
            changed = prior.report()
            mutate(changed)
            with self.assertRaises(ExecutionBudgetError):
                ExecutionSession.restore(changed)


if __name__ == "__main__":
    unittest.main()
