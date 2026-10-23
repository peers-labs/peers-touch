"""Explicit producer closure and immutable prerequisite proof integration."""

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from tooling.acceptance.core.execution_budget import ExecutionBudgetError
from tooling.acceptance.core.execution_graph import compile_graph, prerequisite_results
from tooling.acceptance.core import ArtifactRef, EvidenceStore

REPO_ROOT = Path(__file__).resolve().parents[3]


class ExecutionGraphTest(unittest.TestCase):
    def test_shared_producer_once_and_prerequisites_first(self):
        definitions = {
            "shared": {"command": "true"},
            "first": {"judgment": "all-prerequisites", "dependsOn": ["shared"]},
            "second": {"judgment": "all-prerequisites", "dependsOn": ["shared"]},
        }
        graph = compile_graph(definitions, ["first", "second"])
        self.assertEqual(graph["dispatchGateIds"], ["shared", "first", "second"])
        self.assertEqual(graph["producerGateIds"], ["shared"])
        self.assertEqual(graph["dependencies"]["second"], ["shared"])

    def test_invalid_graph_fails_before_launch(self):
        for definitions, selected, excluded in [
            ({"a": {"dependsOn": ["missing"]}}, ["a"], ()),
            ({"a": {"dependsOn": ["b"]}, "b": {"dependsOn": ["a"]}}, ["a"], ()),
            ({"a": {"dependsOn": ["b", "b"]}, "b": {}}, ["a"], ()),
            ({"a": {"dependsOn": ["b"]}, "b": {}}, ["a"], ("b",)),
            ({"a": {"judgment": "all-prerequisites", "dependsOn": ["b"], "environment": "remote"}, "b": {}}, ["a"], ()),
            ({"a": {}}, ["a", "a"], ()),
        ]:
            with self.assertRaises(ExecutionBudgetError):
                compile_graph(definitions, selected, excluded_ids=excluded)

    def test_prerequisite_requires_original_sealed_source(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = EvidenceStore(Path(temporary), worktree=REPO_ROOT)
            source = {"commit": "same", "workspaceDigest": "same"}
            with store.begin_run("producer", source=source) as producer:
                result = {"status": "passed", "completionStatus": "DONE", "proofStatus": "PROVEN"}
                producer.finalize(result=result)
                ref = producer.manifest_ref.to_dict()
            results = [{"id": "producer", **result, "runManifest": ref}]
            references, missing = prerequisite_results(
                {"id": "consumer", "dependsOn": ["producer"]}, results, source, store,
            )
            self.assertFalse(missing)
            self.assertEqual(references[0]["runManifest"]["gateId"], "producer")
            with self.assertRaises(ExecutionBudgetError):
                prerequisite_results({"id": "consumer", "dependsOn": ["producer"]},
                                     results, {"commit": "different"}, store)
            results[0]["cleanupStatus"] = "failed"
            self.assertEqual(prerequisite_results(
                {"id": "consumer", "dependsOn": ["producer"]}, results, source, store,
            )[1], ["producer"])

    def test_real_runner_produces_once_and_records_actual_session(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            marker = root / "producer-calls"
            catalog = root / "catalog.json"
            policy = root / "policy.json"
            catalog.write_text(json.dumps({"gates": {
                "producer": {
                    "argv": [sys.executable, "-c", f"from pathlib import Path;p=Path({str(marker)!r});p.write_text(p.read_text()+'x' if p.exists() else 'x')"],
                    "tier": "ci-structure",
                },
                **{gate: {"judgment": "all-prerequisites", "dependsOn": ["producer"],
                          "tier": "ci-structure"} for gate in ("first", "second")},
            }}))
            policy.write_text(json.dumps({
                "requestSeconds": 30, "planningSeconds": 5,
                "lifecycle": {"cleanupSeconds": 2, "publishSeconds": 3},
                "gates": {},
            }))
            completed = subprocess.run(
                [sys.executable, "tooling/scripts/acceptance-run.py", "--gates", str(catalog),
                 "--gate", "first", "--gate", "second", "--execution-budget", str(policy)],
                cwd=REPO_ROOT, capture_output=True, text=True, timeout=25,
                env={**os.environ, "PT_ACCEPTANCE_ARTIFACT_ROOT": str(root / "evidence")},
            )
            self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
            self.assertEqual(marker.read_text(), "x")
            report_path, = (root / "evidence").rglob("reports/run.json")
            report = json.loads(report_path.read_text())
            self.assertEqual([item["id"] for item in report["results"]], ["producer", "first", "second"])
            self.assertEqual(report["results"][2]["prerequisiteProofs"][0]["gateId"], "producer")
            session_path, = (root / "evidence").rglob("reports/session.json")
            session = json.loads(session_path.read_text())
            self.assertEqual(session["state"], "QUALIFIED")
            self.assertEqual(session["requests"][0]["report"]["sha256"],
                             hashlib.sha256(report_path.read_bytes()).hexdigest())

    def test_real_runner_resumes_after_verified_repair_without_inheriting_pass(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            marker, calls = root / "repaired", root / "calls"
            catalog, policy, repair_path = root / "catalog.json", root / "policy.json", root / "repair.json"
            catalog.write_text(json.dumps({"gates": {"producer": {
                "argv": [sys.executable, "-c",
                         f"from pathlib import Path;import sys;p=Path({str(calls)!r});p.write_text(p.read_text()+'x' if p.exists() else 'x');sys.exit(0 if Path({str(marker)!r}).exists() else 1)"],
                "tier": "ci-cheap",
            }}}))
            policy.write_text(json.dumps({
                "requestSeconds": 30, "planningSeconds": 5,
                "lifecycle": {"cleanupSeconds": 2, "publishSeconds": 3},
                "gates": {},
            }))
            command = [sys.executable, "tooling/scripts/acceptance-run.py",
                       "--gates", str(catalog), "--gate", "producer",
                       "--execution-budget", str(policy), "--stop-on-failure"]
            environment = {**os.environ, "PT_ACCEPTANCE_ARTIFACT_ROOT": str(root / "evidence")}
            first = subprocess.run(command, cwd=REPO_ROOT, env=environment,
                                   capture_output=True, text=True, timeout=25)
            self.assertNotEqual(first.returncode, 0)
            session_path, = (root / "evidence").rglob("reports/session.json")
            self.assertEqual(json.loads(session_path.read_text())["state"], "PAUSED_REPAIR_REQUIRED")
            marker.touch()
            store = EvidenceStore(root / "evidence", worktree=REPO_ROOT)
            with store.begin_run("repair-validation", source={"fixture": "synthetic"}) as validation:
                validation_ref = validation.write_json(
                    "reports/validation.json", {"repaired": marker.exists()}, role="validation",
                )
                validation.finalize(result={"status": "passed"})
            repair_path.write_text(json.dumps({
                "cause": "synthetic fixture missing", "owner": "synthetic",
                "correction": "restore fixture after first failed attempt",
                "qualification": "ARCHITECTURE_OVERHEAD",
                "validation_refs": [validation_ref.to_dict()],
            }))
            prior = store.latest("acceptance-run")
            manifest_path = store.workspace_dir / "acceptance-run" / prior["runId"] / "manifest.json"
            resume_ref = root / "resume.json"
            resume_ref.write_text(json.dumps(ArtifactRef(
                prior["workspaceId"], prior["gateId"], prior["runId"], "manifest.json",
                hashlib.sha256(manifest_path.read_bytes()).hexdigest(), "application/json",
            ).to_dict()))
            resumed = subprocess.run(
                command + ["--resume-session", str(resume_ref), "--repair-record", str(repair_path)],
                cwd=REPO_ROOT, env=environment, capture_output=True, text=True, timeout=25,
            )
            self.assertEqual(resumed.returncode, 0, resumed.stdout + resumed.stderr)
            self.assertEqual(calls.read_text(), "xx")
            sessions = [json.loads(path.read_text()) for path in (root / "evidence").rglob("reports/session.json")]
            latest = next(value for value in sessions if len(value["requests"]) == 2)
            self.assertEqual(latest["state"], "QUALIFIED")
            self.assertEqual(latest["requests"][0]["state"], "PAUSED_REPAIR_REQUIRED")
            self.assertEqual(latest["requests"][1]["dispatchGateIds"], ["producer"])

    def test_failed_prerequisite_never_launches_normal_consumer(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            marker, catalog = root / "consumer-started", root / "catalog.json"
            catalog.write_text(json.dumps({"gates": {
                "producer": {"argv": [sys.executable, "-c", "raise SystemExit(1)"]},
                "consumer": {
                    "dependsOn": ["producer"],
                    "argv": [sys.executable, "-c",
                             f"from pathlib import Path;Path({str(marker)!r}).touch()"],
                },
            }}))
            completed = subprocess.run(
                [sys.executable, "tooling/scripts/acceptance-run.py",
                 "--gates", str(catalog), "--gate", "consumer"],
                cwd=REPO_ROOT, capture_output=True, text=True, timeout=25,
                env={**os.environ, "PT_ACCEPTANCE_ARTIFACT_ROOT": str(root / "evidence")},
            )
            self.assertNotEqual(completed.returncode, 0, completed.stdout + completed.stderr)
            self.assertFalse(marker.exists())
            report_path, = (root / "evidence").rglob("reports/run.json")
            consumer = json.loads(report_path.read_text())["results"][1]
            self.assertEqual(consumer["blockedReason"], "PREREQUISITE_UNPROVEN")
            self.assertEqual(consumer["proofStatus"], "UNPROVEN")
            self.assertEqual(consumer["traceability"]["status"], "complete")
            self.assertEqual(
                consumer["sourceArtifactKind"],
                "acceptance-prerequisite-judgment",
            )
            judgment_ref = consumer["sourceArtifact"]
            judgment = json.loads(
                (
                    root
                    / "evidence"
                    / judgment_ref["workspaceId"]
                    / judgment_ref["gateId"]
                    / judgment_ref["runId"]
                    / judgment_ref["path"]
                ).read_text()
            )
            self.assertEqual(judgment["gateId"], "consumer")
            self.assertEqual(judgment["status"], "BLOCKED")
            self.assertEqual(judgment["requiredGateIds"], ["producer"])
            self.assertEqual(judgment["prerequisiteProofs"], [])

    def test_new_policy_uses_verified_lineage_without_copying_attempts(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            marker, calls = root / "repaired", root / "calls"
            catalog, policy = root / "catalog.json", root / "policy.json"
            lineage = root / "prior-manifest.json"
            catalog.write_text(json.dumps({"gates": {"producer": {
                "argv": [sys.executable, "-c",
                         f"from pathlib import Path;import sys;p=Path({str(calls)!r});"
                         "p.write_text(p.read_text()+'x' if p.exists() else 'x');"
                         f"sys.exit(0 if Path({str(marker)!r}).exists() else 1)"],
            }}}))
            limits = {
                "requestSeconds": 30, "planningSeconds": 5,
                "lifecycle": {"cleanupSeconds": 2, "publishSeconds": 3},
                "gates": {},
            }
            policy.write_text(json.dumps(limits))
            command = [sys.executable, "tooling/scripts/acceptance-run.py",
                       "--gates", str(catalog), "--gate", "producer",
                       "--execution-budget", str(policy), "--stop-on-failure"]
            environment = {**os.environ, "PT_ACCEPTANCE_ARTIFACT_ROOT": str(root / "evidence")}
            first = subprocess.run(command, cwd=REPO_ROOT, env=environment,
                                   capture_output=True, text=True, timeout=15)
            self.assertNotEqual(first.returncode, 0)
            store = EvidenceStore(root / "evidence", worktree=REPO_ROOT)
            prior = store.latest("acceptance-run")
            manifest_path = store.workspace_dir / "acceptance-run" / prior["runId"] / "manifest.json"
            manifest_ref = ArtifactRef(
                prior["workspaceId"], prior["gateId"], prior["runId"],
                "manifest.json", hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
                "application/json",
            ).to_dict()
            prior_session_ref = prior["artifacts"]["execution-session"]
            prior_session = store.read_json(ArtifactRef.from_dict(prior_session_ref))
            marker.touch()
            limits["lifecycle"]["cleanupSeconds"] = 1
            policy.write_text(json.dumps(limits))
            lineage.write_text(json.dumps({**manifest_ref, "sha256": "0" * 64}))
            rejected = subprocess.run(
                command + ["--prior-session-manifest", str(lineage)],
                cwd=REPO_ROOT, env=environment, capture_output=True, text=True, timeout=15,
            )
            self.assertNotEqual(rejected.returncode, 0)
            self.assertEqual(calls.read_text(), "x")
            lineage.write_text(json.dumps(manifest_ref))
            completed = subprocess.run(
                command + ["--prior-session-manifest", str(lineage)],
                cwd=REPO_ROOT, env=environment, capture_output=True, text=True, timeout=15,
            )
            self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
            self.assertEqual(calls.read_text(), "xx")
            latest = store.latest("acceptance-run")
            current = store.read_json(ArtifactRef.from_dict(latest["artifacts"]["execution-session"]))
            self.assertEqual(len(current["requests"]), 1)
            self.assertEqual(current["state"], "QUALIFIED")
            self.assertTrue(current["requests"][0]["invalidatedPriorProof"])
            self.assertNotEqual(current["policyDigest"], prior_session["policyDigest"])
            self.assertEqual(current["lineage"]["session"], prior_session_ref)
            self.assertEqual(current["lineage"]["proofTransfer"], "NONE")

    def test_publication_timeout_records_full_scope_paused_session(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            marker, catalog, policy = root / "downstream", root / "catalog.json", root / "policy.json"
            catalog.write_text(json.dumps({"gates": {
                "first": {"argv": [sys.executable, "-c", "pass"]},
                "second": {"argv": [sys.executable, "-c",
                                    f"from pathlib import Path;Path({str(marker)!r}).touch()"]},
            }}))
            policy.write_text(json.dumps({
                "requestSeconds": 30, "planningSeconds": 5,
                "lifecycle": {"cleanupSeconds": 1, "publishSeconds": 0.000001},
                "gates": {},
            }))
            completed = subprocess.run(
                [sys.executable, "tooling/scripts/acceptance-run.py",
                 "--gates", str(catalog), "--gate", "first", "--gate", "second",
                 "--execution-budget", str(policy)],
                cwd=REPO_ROOT, capture_output=True, text=True, timeout=25,
                env={**os.environ, "PT_ACCEPTANCE_ARTIFACT_ROOT": str(root / "evidence")},
            )
            self.assertNotEqual(completed.returncode, 0, completed.stdout + completed.stderr)
            self.assertFalse(marker.exists())
            session_path, = (root / "evidence").rglob("reports/session.json")
            session = json.loads(session_path.read_text())
            self.assertEqual(session["state"], "PAUSED_REPAIR_REQUIRED")
            self.assertEqual(session["requiredGateIds"], ["first", "second"])
            stop_path, = (root / "evidence").rglob("reports/stop.json")
            stop = json.loads(stop_path.read_text())
            self.assertEqual(stop["unexecutedGateIds"], ["second"])
            self.assertEqual(stop["cost"]["overrun"]["phase"], "publish")
            store = EvidenceStore(root / "evidence", worktree=REPO_ROOT)
            report = store.read_json(ArtifactRef.from_dict(session["requests"][-1]["report"]))
            self.assertEqual(
                store.read_json(ArtifactRef.from_dict(report["terminalObservation"])),
                stop,
            )
            self.assertEqual(report["executionBudget"]["dispatchedGateCount"], 1)
            first, second = report["results"]
            self.assertEqual(first["id"], "first")
            self.assertEqual(first["status"], "failed")
            self.assertEqual(first["completionStatus"], "PARTIAL")
            self.assertGreater(first["duration_seconds"], 0)
            self.assertNotIn("not dispatched", first["reason"])
            self.assertEqual(second["status"], "blocked")
            self.assertEqual(second["duration_seconds"], 0)

    def continuation_fixture(self, root):
        calls, cancelled, downstream = (root / name for name in ("calls", "cancelled", "downstream"))
        catalog, policy = root / "catalog.json", root / "policy.json"
        catalog.write_text(json.dumps({"gates": {
            "first": {"argv": [sys.executable, "-c",
                f"from pathlib import Path;p=Path({str(calls)!r});"
                "p.write_text(p.read_text()+'x' if p.exists() else 'x')"], "tier": "ci-cheap"},
            "second": {"argv": [sys.executable, "-c",
                f"from pathlib import Path;import time;p=Path({str(cancelled)!r});"
                "first=not p.exists();p.write_text(p.read_text()+'x' if p.exists() else 'x');"
                "time.sleep(10 if first else 0)"], "tier": "ci-cheap"},
            "third": {"dependsOn": ["first", "second"], "argv": [sys.executable, "-c",
                f"from pathlib import Path;Path({str(downstream)!r}).touch()"], "tier": "ci-cheap"},
        }}))
        policy.write_text(json.dumps({
            "requestSeconds": 2.5, "planningSeconds": 1.5,
            "lifecycle": {"cleanupSeconds": 1, "publishSeconds": 1}, "gates": {},
        }))
        command = [sys.executable, "-B", "tooling/scripts/acceptance-run.py",
                   "--gates", str(catalog), "--gate", "third",
                   "--execution-budget", str(policy)]
        environment = {**os.environ, "PT_ACCEPTANCE_ARTIFACT_ROOT": str(root / "evidence")}
        completed = subprocess.run(command, cwd=REPO_ROOT, env=environment,
                                   capture_output=True, text=True, timeout=12)
        self.assertNotEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        store = EvidenceStore(root / "evidence", worktree=REPO_ROOT)
        prior = store.latest("acceptance-run")
        session = store.read_json(ArtifactRef.from_dict(prior["artifacts"]["execution-session"]))
        self.assertEqual(session["state"], "PAUSED_REQUEST_EXHAUSTED", completed.stdout + completed.stderr)
        self.assertEqual(calls.read_text(), "x")
        self.assertEqual(cancelled.read_text(), "x")
        self.assertFalse(downstream.exists())
        report = store.read_json(ArtifactRef.from_dict(prior["artifacts"]["run"]))
        manifest_path = store.workspace_dir / "acceptance-run" / prior["runId"] / "manifest.json"
        resume = root / "resume.json"
        resume.write_text(json.dumps(ArtifactRef(
            prior["workspaceId"], prior["gateId"], prior["runId"], "manifest.json",
            hashlib.sha256(manifest_path.read_bytes()).hexdigest(), "application/json",
        ).to_dict()))
        return command + ["--resume-session", str(resume)], environment, store, session, report

    def test_real_two_requests_keep_original_proof_and_reject_concurrent_stale_or_raw_resume(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            command, environment, store, session, first = self.continuation_fixture(root)
            claim = store.execution_request(session["sessionId"])
            try:
                rejected = subprocess.run(command, cwd=REPO_ROOT, env=environment,
                                          capture_output=True, text=True, timeout=10)
                self.assertNotEqual(rejected.returncode, 0)
                self.assertIn("active request", rejected.stderr)
                self.assertEqual((root / "calls").read_text(), "x")
            finally:
                claim.close()
            raw = root / "raw.json"
            raw.write_text(json.dumps(session))
            rejected = subprocess.run(command[:-1] + [str(raw)], cwd=REPO_ROOT, env=environment,
                                      capture_output=True, text=True, timeout=10)
            self.assertNotEqual(rejected.returncode, 0)
            completed = subprocess.run(command, cwd=REPO_ROOT, env=environment,
                                       capture_output=True, text=True, timeout=10)
            self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
            current = store.latest("acceptance-run")
            second = store.read_json(ArtifactRef.from_dict(current["artifacts"]["run"]))
            ledger = store.read_json(ArtifactRef.from_dict(current["artifacts"]["execution-session"]))
            self.assertEqual(ledger["state"], "QUALIFIED")
            self.assertEqual(ledger["requiredGateIds"], ["first", "second", "third"])
            self.assertEqual(ledger["requests"][1]["dispatchGateIds"], ["second", "third"])
            self.assertEqual((root / "calls").read_text(), "x")
            self.assertEqual((root / "cancelled").read_text(), "xx")
            self.assertTrue((root / "downstream").exists())
            self.assertEqual(second["executionBudget"]["dispatchedGateCount"], 2)
            self.assertEqual(second["executionBudget"]["selectedGateCount"], 3)
            self.assertEqual(second["results"][0]["runManifest"], first["results"][0]["runManifest"])
            self.assertEqual(second["results"][0]["duration_seconds"], first["results"][0]["duration_seconds"])
            self.assertEqual(second["results"][0]["originRunId"], first["results"][0]["runManifest"]["runId"])
            self.assertEqual(second["executionSession"]["validatedGateIds"], ["first"])
            stale = subprocess.run(command, cwd=REPO_ROOT, env=environment,
                                   capture_output=True, text=True, timeout=10)
            self.assertNotEqual(stale.returncode, 0)
            self.assertEqual((root / "cancelled").read_text(), "xx")

    def test_corrupt_original_artifact_reruns_its_complete_gate(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            command, environment, store, session, report = self.continuation_fixture(root)
            first = store.read_run_manifest(
                ArtifactRef.from_dict(report["results"][0]["runManifest"]),
                manifest_sha256=report["results"][0]["runManifest"]["sha256"],
            )
            artifact = store.resolve(ArtifactRef.from_dict(first["artifacts"]["execution-identity"]))
            artifact.chmod(0o600)
            artifact.write_text("{}")
            completed = subprocess.run(command, cwd=REPO_ROOT, env=environment,
                                       capture_output=True, text=True, timeout=10)
            self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
            self.assertEqual((root / "calls").read_text(), "xx")
            latest = store.latest("acceptance-run")
            ledger = store.read_json(ArtifactRef.from_dict(latest["artifacts"]["execution-session"]))
            self.assertEqual(ledger["requests"][1]["validatedGateIds"], [])
            self.assertEqual(ledger["requests"][1]["dispatchGateIds"], ["first", "second", "third"])

    def test_changed_context_graph_and_policy_cannot_reuse_proof(self):
        for change in ("context", "graph", "policy"):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                command, environment, store, session, report = self.continuation_fixture(root)
                if change == "context":
                    environment["PT_CONTINUATION_FIXTURE_EPOCH"] = "changed"
                elif change == "graph":
                    catalog = json.loads((root / "catalog.json").read_text())
                    catalog["gates"]["first"]["timeout"] = 59
                    (root / "catalog.json").write_text(json.dumps(catalog))
                else:
                    policy = json.loads((root / "policy.json").read_text())
                    policy["lifecycle"]["cleanupSeconds"] = 0.9
                    (root / "policy.json").write_text(json.dumps(policy))
                completed = subprocess.run(command, cwd=REPO_ROOT, env=environment,
                                           capture_output=True, text=True, timeout=10)
                if change == "policy":
                    self.assertNotEqual(completed.returncode, 0)
                    self.assertEqual((root / "calls").read_text(), "x")
                else:
                    self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
                    self.assertEqual((root / "calls").read_text(), "xx")
                    latest = store.latest("acceptance-run")
                    ledger = store.read_json(ArtifactRef.from_dict(latest["artifacts"]["execution-session"]))
                    self.assertTrue(ledger["requests"][1]["invalidatedPriorProof"])
                    self.assertEqual(ledger["requests"][1]["validatedGateIds"], [])

    def test_crashed_consumed_request_cannot_dispatch_again(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            command, environment, store, session, report = self.continuation_fixture(root)
            reference = ArtifactRef.from_dict(json.loads((root / "resume.json").read_text()))
            claim = store.execution_request(session["sessionId"])
            try:
                claim.consume(2, reference)
            finally:
                claim.close()
            completed = subprocess.run(command, cwd=REPO_ROOT, env=environment,
                                       capture_output=True, text=True, timeout=10)
            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("already consumed", completed.stderr)
            self.assertEqual((root / "calls").read_text(), "x")
            self.assertEqual((root / "cancelled").read_text(), "x")
            self.assertFalse((root / "downstream").exists())

    def test_visible_manifest_cannot_bypass_current_finalizer_authority(self):
        from tooling.acceptance.core.execution_budget import ExecutionBudgetPolicy

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            command, environment, store, session, report = self.continuation_fixture(root)
            enforcement = store.workspace_dir / "first" / "finalizer-enforcement"
            enforcement.mkdir()
            (enforcement / "activation-pending.json").write_text("{}")
            spec = importlib.util.spec_from_file_location(
                "continuation_runner", REPO_ROOT / "tooling/scripts/acceptance-run.py",
            )
            runner = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(runner)
            definitions = json.loads((root / "catalog.json").read_text())["gates"]
            graph = compile_graph(definitions, ["third"])
            reused, validation = runner.revalidate_session_results(
                [runner.gate_from_definition(gate, definitions[gate]) for gate in graph["dispatchGateIds"]],
                report, session["requests"][0]["source"], graph,
                ExecutionBudgetPolicy(json.loads((root / "policy.json").read_text())),
                session["requests"][0]["contextDigest"], store,
            )
            self.assertFalse(reused)
            self.assertEqual(validation[0]["disposition"], "PENDING")
            self.assertIn("authority is invalid", validation[0]["reason"])


if __name__ == "__main__":
    unittest.main()
