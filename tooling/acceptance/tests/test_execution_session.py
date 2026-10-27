"""Fixed obligations, cancellation classification and proof invalidation."""

from copy import deepcopy
from pathlib import Path
import tempfile
import unittest

from tooling.acceptance.core import ArtifactRef, EvidenceError, EvidenceStore, new_run_id, workspace_id
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

    def begin(self, session, source=None, dispatch=None, **identities):
        return session.begin(
            source or self.source, dispatch,
            graph_digest=identities.get("graph", "graph"),
            context_digest=identities.get("context", "context"),
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
        self.assertEqual(self.begin(restored, dispatch=["second", "first"]), ("second", "first"))
        self.assertEqual(restored.requests[-1]["validatedGateIds"], [])
        restored.record_reuse(self.original_reuse())
        self.assertEqual(restored.requests[-1]["dispatchGateIds"], ["second"])
        self.assertEqual(restored.required_gate_ids, ("first", "second"))
        self.assertEqual(restored.requests[-1]["validatedGateIds"], ["first"])

    def original_reuse(self):
        reference = ArtifactRef.from_dict(self.report_ref)
        manifest = ArtifactRef(
            reference.workspace_id, "first", reference.run_id, "manifest.json",
            reference.sha256, "application/json",
        )
        return {
            "id": "first", "status": "passed", "completionStatus": "DONE",
            "proofStatus": "PROVEN", "cleanupStatus": "passed",
            "executionDisposition": "REUSED_ORIGINAL",
            "originRunId": manifest.run_id, "runManifest": manifest.to_dict(),
        }

    def test_begin_rejects_prevalidated_partition(self):
        session = ExecutionSession(["first", "second"], "policy")
        self.begin(session)
        session.observe(self.exhausted_report(), self.report_ref)
        with self.assertRaises(TypeError):
            session.begin(
                self.source, ["second"], graph_digest="graph", context_digest="context",
                validated_gate_ids=["first"],
            )

    def test_record_reuse_requires_complete_original_and_unchanged_active_continuation(self):
        for scenario in (
            "ready", "first", "changed-source", "changed-graph", "changed-context",
            "repair", "failed", "unproven", "cleanup", "origin", "manifest", "duplicate",
        ):
            with self.subTest(scenario=scenario):
                session = ExecutionSession(["first", "second"], "policy")
                result = self.original_reuse()
                if scenario != "ready":
                    self.begin(session)
                if scenario not in {"ready", "first"}:
                    report = self.exhausted_report()
                    if scenario == "repair":
                        report["executionBudget"]["stop"]["reason"] = "EXECUTION_FAILURE_STOP"
                    session.observe(report, self.report_ref)
                    if scenario == "repair":
                        session.repair(
                            cause="fixture", owner="synthetic", correction="restore fixture",
                            validation_refs=[self.report_ref], qualification="PRODUCT_FAILURE",
                        )
                    self.begin(
                        session,
                        source={"commit": "other"} if scenario == "changed-source" else None,
                        graph="other" if scenario == "changed-graph" else "graph",
                        context="other" if scenario == "changed-context" else "context",
                    )
                if scenario == "failed":
                    result["status"] = "failed"
                elif scenario == "unproven":
                    result["proofStatus"] = "UNPROVEN"
                elif scenario == "cleanup":
                    result["cleanupStatus"] = "failed"
                elif scenario == "origin":
                    result["originRunId"] = new_run_id()
                elif scenario == "manifest":
                    result["runManifest"]["path"] = "reports/run.json"
                elif scenario == "duplicate":
                    session.record_reuse(result)
                before = session.report()
                with self.assertRaises(ExecutionBudgetError):
                    session.record_reuse(result)
                self.assertEqual(session.report(), before)
        session = ExecutionSession(["first", "second"], "policy")
        self.begin(session)
        session.observe(self.exhausted_report(), self.report_ref)
        self.begin(session, dispatch=["second", "first"])
        self.assertEqual(session.requests[-1]["validatedGateIds"], [])
        session.record_reuse(self.original_reuse())
        self.assertEqual(session.required_gate_ids, ("first", "second"))
        self.assertEqual(session.requests[-1]["dispatchGateIds"], ["second"])
        self.assertEqual(session.requests[-1]["validatedGateIds"], ["first"])

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

    def test_request_expiry_cannot_hide_an_earlier_failure_or_unproven_result(self):
        for fields in (
            {"status": "failed", "completionStatus": "PARTIAL", "proofStatus": "UNPROVEN"},
            {"status": "blocked", "completionStatus": "BLOCKED", "proofStatus": "UNPROVEN"},
            {"proofStatus": "UNPROVEN"},
            {"completionStatus": "PARTIAL"},
        ):
            with self.subTest(fields=fields):
                report = self.exhausted_report()
                report["results"][0].update(fields)
                session = ExecutionSession(["first", "second"], "policy")
                self.begin(session)
                session.observe(report, self.report_ref)
                self.assertEqual(session.state, "PAUSED_REPAIR_REQUIRED")
                with self.assertRaises(ExecutionBudgetError):
                    self.begin(session)

    def test_only_original_undispatched_stop_projection_allows_clean_exhaustion(self):
        report = self.exhausted_report()
        pending = {
            "id": "third", "status": "blocked", "completionStatus": "BLOCKED",
            "proofStatus": "UNPROVEN", "duration_seconds": 0,
            "executionStop": {"gateId": "second", "reason": "EXECUTION_BUDGET_STOP"},
        }
        report["results"].append(pending)
        self.assertTrue(ExecutionSession.clean_request_exhaustion(report))
        for fields in (
            {"runManifest": self.report_ref},
            {"duration_seconds": 1},
            {"executionStop": {"gateId": "other", "reason": "EXECUTION_BUDGET_STOP"}},
            {"executionStop": None},
        ):
            with self.subTest(fields=fields):
                changed = deepcopy(report)
                changed["results"][-1].update(fields)
                self.assertFalse(ExecutionSession.clean_request_exhaustion(changed))

    def test_source_graph_or_context_change_invalidates_all_completion(self):
        for changes in (
            {"source": {"commit": "two"}}, {"graph": "other"}, {"context": "other"},
        ):
            with self.subTest(changes=changes):
                session = ExecutionSession(["first", "second"], "policy")
                self.begin(session)
                session.observe(self.exhausted_report(), self.report_ref)
                self.begin(session, **changes)
                with self.assertRaises(ExecutionBudgetError):
                    session.record_reuse(self.original_reuse())
                self.assertTrue(session.report()["requests"][1]["invalidatedPriorProof"])
                self.assertEqual(session.requests[1]["dispatchGateIds"], ["first", "second"])

    def test_scope_cannot_disappear_overlap_or_expand(self):
        for dispatch in (
            [], ["first"], ["first", "second", "third"], ["second"], ["first", "first"],
        ):
            with self.subTest(dispatch=dispatch), self.assertRaises(ExecutionBudgetError):
                self.begin(ExecutionSession(["first", "second"], "policy"), dispatch=dispatch)

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
        self.assertEqual(self.begin(session), ("first", "second"))
        with self.assertRaises(ExecutionBudgetError):
            session.record_reuse(self.original_reuse())

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

    def test_sealed_history_retains_latest_actual_failure_and_resets_candidate(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = EvidenceStore(Path(temporary), worktree=Path(__file__).resolve().parents[3])
            session = ExecutionSession(["first", "second"], "policy")
            for state in ("passed", "failed", "not-dispatched"):
                self.begin(session)
                report = self.exhausted_report()
                report["executionBudget"]["policyDigest"] = "policy"
                report["executionGraph"] = {"digest": "graph"}
                first = report["results"][0]
                first.update(
                    status="blocked" if state == "not-dispatched" else state,
                    completionStatus="DONE" if state == "passed" else "PARTIAL",
                    proofStatus="PROVEN" if state == "passed" else "UNPROVEN",
                    duration_seconds=0 if state == "not-dispatched" else 1,
                )
                report["results"][1]["duration_seconds"] = 1
                with store.begin_run("acceptance-run", source=self.source) as run:
                    reference = run.write_json("reports/run.json", report, role="run")
                    run.finalize(result={"status": "failed"})
                session.observe(report, reference.to_dict())
                if session.state == "PAUSED_REPAIR_REQUIRED":
                    session.repair(
                        cause="synthetic actual failure", owner="synthetic",
                        correction="qualified synthetic next attempt",
                        validation_refs=[reference.to_dict()],
                        qualification="PRODUCT_FAILURE",
                    )
            history = session.dispatch_history(
                store, self.source, graph_digest="graph", context_digest="context",
            )
            self.assertEqual(history[0]["status"], "failed")
            self.assertEqual(history[0]["duration_seconds"], 1)
            for source, graph, context in (
                ({"commit": "other"}, "graph", "context"),
                (self.source, "other", "context"),
                (self.source, "graph", "other"),
            ):
                self.assertEqual(session.dispatch_history(
                    store, source, graph_digest=graph, context_digest=context,
                ), [])
            earlier = store.resolve(ArtifactRef.from_dict(session.requests[0]["report"]))
            earlier.chmod(0o600)
            earlier.write_text("{}")
            with self.assertRaises(EvidenceError):
                session.dispatch_history(
                    store, self.source, graph_digest="graph", context_digest="context",
                )

    def test_history_report_requires_original_candidate_and_complete_scope(self):
        session = ExecutionSession(["first", "second"], "policy")
        self.begin(session)
        baseline = self.exhausted_report()
        baseline["executionBudget"]["policyDigest"] = "policy"
        baseline["executionGraph"] = {"digest": "graph"}
        session.observe(baseline, self.report_ref)
        for mutate in (
            lambda value: value.update(source={"commit": "other"}),
            lambda value: value["executionGraph"].update(digest="other"),
            lambda value: value["executionBudget"].update(policyDigest="other"),
            lambda value: value["executionBudget"].update(stop=None),
            lambda value: value["results"].pop(),
            lambda value: value["results"][0].update(id="second"),
        ):
            report = deepcopy(baseline)
            mutate(report)
            with self.assertRaises(ExecutionBudgetError):
                session.request_results(session.requests[0], report)


if __name__ == "__main__":
    unittest.main()
