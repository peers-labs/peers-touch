"""Explicit producer closure and immutable prerequisite proof integration."""

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from tooling.acceptance.core.execution_budget import ExecutionBudgetError
from tooling.acceptance.core.execution_graph import compile_graph, prerequisite_results
from tooling.acceptance.core import EvidenceStore

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
                "default": {"totalSeconds": 10, "cleanupSeconds": 2, "publishSeconds": 3},
                "tiers": {}, "gates": {},
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
            self.assertEqual(session["attempts"][0]["report"]["sha256"],
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
                "default": {"totalSeconds": 10, "cleanupSeconds": 2, "publishSeconds": 3},
                "tiers": {}, "gates": {},
            }))
            command = [sys.executable, "tooling/scripts/acceptance-run.py",
                       "--gates", str(catalog), "--gate", "producer",
                       "--execution-budget", str(policy), "--stop-on-failure"]
            environment = {**os.environ, "PT_ACCEPTANCE_ARTIFACT_ROOT": str(root / "evidence")}
            first = subprocess.run(command, cwd=REPO_ROOT, env=environment,
                                   capture_output=True, text=True, timeout=25)
            self.assertNotEqual(first.returncode, 0)
            session_path, = (root / "evidence").rglob("reports/session.json")
            self.assertEqual(json.loads(session_path.read_text())["state"], "PAUSED")
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
            resumed = subprocess.run(
                command + ["--resume-session", str(session_path), "--repair-record", str(repair_path)],
                cwd=REPO_ROOT, env=environment, capture_output=True, text=True, timeout=25,
            )
            self.assertEqual(resumed.returncode, 0, resumed.stdout + resumed.stderr)
            self.assertEqual(calls.read_text(), "xx")
            sessions = [json.loads(path.read_text()) for path in (root / "evidence").rglob("reports/session.json")]
            latest = next(value for value in sessions if len(value["attempts"]) == 2)
            self.assertEqual(latest["state"], "QUALIFIED")
            self.assertEqual(latest["attempts"][0]["state"], "PAUSED")
            self.assertEqual(latest["attempts"][1]["gateIds"], ["producer"])

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
                "default": {"totalSeconds": 15, "cleanupSeconds": 1, "publishSeconds": 0.000001},
                "tiers": {}, "gates": {},
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
            self.assertEqual(session["state"], "PAUSED")
            self.assertEqual(session["requiredGateIds"], ["first", "second"])
            stop_path, = (root / "evidence").rglob("reports/stop.json")
            stop = json.loads(stop_path.read_text())
            self.assertEqual(stop["unexecutedGateIds"], ["second"])
            self.assertEqual(stop["cost"]["overrun"]["phase"], "publish")
            first, second = stop["results"]
            self.assertEqual(first["id"], "first")
            self.assertEqual(first["status"], "failed")
            self.assertEqual(first["completionStatus"], "PARTIAL")
            self.assertGreater(first["duration_seconds"], 0)
            self.assertNotIn("not dispatched", first["reason"])
            self.assertEqual(second["status"], "blocked")
            self.assertEqual(second["duration_seconds"], 0)


if __name__ == "__main__":
    unittest.main()
