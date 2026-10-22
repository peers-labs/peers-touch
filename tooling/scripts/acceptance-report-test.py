#!/usr/bin/env python3
"""Regression tests for Acceptance report rendering."""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any


SCRIPT = Path(__file__).with_name("acceptance-report.py")


def load_module() -> Any:
    spec = importlib.util.spec_from_file_location("acceptance_report", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class AcceptanceReportTest(unittest.TestCase):
    def setUp(self) -> None:
        self.module = load_module()
        from tooling.acceptance.core import EvidenceStore

        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.store = EvidenceStore(Path(temporary.name), worktree=SCRIPT.parents[2])
        self.source = {"commit": "synthetic-source", "workspaceDigest": "synthetic-digest"}

    def result(self, gate_id: str, *, required: list | None = None, complete: bool = False,
               payload: dict | None = None, source: dict | None = None) -> dict:
        with self.store.begin_run(gate_id, source=source or self.source) as run:
            primary = run.write_json("reports/observation.json", payload or {
                "artifactKind": "acceptance-runtime-manifest", "environmentId": "synthetic",
                "state": "BLOCKED", "services": {}, "clients": [],
            })
            result = {
                "id": gate_id, "status": "blocked", "proofStatus": "UNPROVEN",
                "sourcePhase": "Synthetic Provisioning", "sourceArtifact": primary.to_dict(),
                "blockedReason": "PREREQUISITE_UNPROVEN" if required else "missing configured endpoint",
            }
            if required is not None:
                result["requiredGateIds"] = required
            else:
                result["blockedResource"] = "service:synthetic:endpoint"
            if complete:
                result["diagnostic"] = {
                    "owner": "synthetic-owner", "recoveryAction": "bind the reviewed endpoint",
                    "resourceChecks": [{
                        "resource": "service:synthetic:endpoint", "state": "OBSERVED",
                        "expected": "configured endpoint", "observed": "unset",
                        "evidenceArtifact": primary.to_dict(),
                    }],
                }
            run.finalize(result=result)
            return {**result, "runManifest": run.manifest_ref.to_dict()}

    def project(self, results: list) -> dict:
        return self.module.diagnostic_projection({"source": self.source, "results": results}, self.store)

    def test_renders_legacy_command(self) -> None:
        self.assertEqual(
            self.module.gate_invocation(
                {
                    "id": "legacy-gate",
                    "command": "python3 -m example.gate",
                }
            ),
            "python3 -m example.gate",
        )

    def test_renders_argv_command(self) -> None:
        self.assertEqual(
            self.module.gate_invocation(
                {
                    "id": "argv-gate",
                    "argv": [
                        "python3",
                        "-m",
                        "example.gate",
                        "--label",
                        "two words",
                    ],
                }
            ),
            "python3 -m example.gate --label 'two words'",
        )

    def test_rejects_ambiguous_or_missing_invocation(self) -> None:
        for gate in (
            {"id": "missing-gate"},
            {"id": "empty-argv", "argv": []},
            {
                "id": "ambiguous-gate",
                "command": "python3 -m example.gate",
                "argv": ["python3", "-m", "example.gate"],
            },
        ):
            with self.subTest(gate=gate["id"]):
                with self.assertRaisesRegex(
                    ValueError,
                    "must contain exactly one valid command or argv",
                ):
                    self.module.gate_invocation(gate)

    def test_judgment_uses_shared_contract(self) -> None:
        gate = {"id": "consumer", "judgment": "all-prerequisites", "dependsOn": ["producer"]}
        self.assertEqual(self.module.gate_invocation(gate), "judgment: all-prerequisites (producer)")
        from tooling.acceptance.core.execution_budget import ExecutionBudgetError
        for extra in ({"argv": ["echo", "bad"]}, {"dependsOn": []}, {"environment": "native"}):
            with self.subTest(extra=extra), self.assertRaisesRegex(ExecutionBudgetError, "invalid structural"):
                self.module.gate_invocation({**gate, **extra})

    def test_valid_block_is_diagnostically_complete_but_not_product_pass(self) -> None:
        result = self.result("producer", complete=True)
        projection = self.project([result])
        self.assertEqual(projection["diagnosticStatus"], "COMPLETE")
        self.assertEqual(projection["results"][0]["status"], "blocked")
        self.assertEqual(projection["evidenceClass"], "SUPPORTING_OBSERVATION")

    def test_missing_check_is_unknown_not_a_missing_device(self) -> None:
        projection = self.project([self.result("producer")])
        node = projection["results"][0]
        self.assertEqual(node["diagnosticStatus"], "DIAGNOSTIC_INCOMPLETE")
        self.assertEqual(node["runtime"]["clients"], [])
        self.assertIn("resourceChecks", node["missingFields"])
        self.assertIn("not an absence finding", node["unrecordedChecks"])
        self.assertIsNone(node["resourceChecks"])

    def test_dependency_chain_keeps_original_producer_refs(self) -> None:
        producer = self.result("producer", complete=True)
        middle = self.result("middle", required=["producer"])
        consumer = self.result("consumer", required=["middle"])
        projection = self.project([producer, middle, consumer])
        root = projection["results"][2]["rootBlockers"][0]
        self.assertEqual(root["chain"], ["consumer", "middle", "producer"])
        self.assertEqual(root["sourceArtifact"], producer["sourceArtifact"])
        self.assertEqual(root["runManifest"], producer["runManifest"])
        self.assertEqual(projection["diagnosticStatus"], "COMPLETE")

    def test_dependency_root_gap_propagates_to_consumer(self) -> None:
        producer = self.result("producer")
        consumer = self.result("consumer", required=["producer"])
        node = self.project([producer, consumer])["results"][1]
        self.assertIn("root:producer:owner", node["missingFields"])

    def test_missing_or_cyclic_dependency_is_diagnostic_gap(self) -> None:
        cases = [
            [self.result("missing-parent", required=["not-in-run"])],
            [self.result("cycle-a", required=["cycle-b"]), self.result("cycle-b", required=["cycle-a"])],
        ]
        for results in cases:
            with self.subTest(results=[x["id"] for x in results]):
                self.assertEqual(self.project(results)["diagnosticStatus"], "DIAGNOSTIC_INCOMPLETE")
                self.assertTrue(self.project(results)["results"][0]["rootBlockers"][0]["gap"])

    def test_source_mismatch_and_mutated_aggregate_cannot_be_diagnostic_truth(self) -> None:
        stale = self.result("stale", complete=True, source={"commit": "older"})
        node = self.project([stale])["results"][0]
        self.assertIn("runManifest.source: mismatch", node["missingFields"])
        self.assertIsNone(node["reason"])
        good = self.result("producer", complete=True)
        tampered = {**good, "blockedResource": "forged-device"}
        node = self.project([tampered])["results"][0]
        self.assertIn("runManifest.result.blockedResource: mismatch", node["missingFields"])
        self.assertEqual(node["resource"], "service:synthetic:endpoint")

    def test_corrupted_artifact_hash_is_rejected(self) -> None:
        from tooling.acceptance.core import ArtifactRef
        result = self.result("producer", complete=True)
        self.store.resolve(ArtifactRef.from_dict(result["sourceArtifact"])).write_text('{"changed": true}')
        node = self.project([result])["results"][0]
        self.assertIn("evidence: invalid reports/observation.json", node["missingFields"])
        self.assertEqual(node["runtime"], {})

    def test_cross_gate_artifact_is_not_accepted(self) -> None:
        donor = self.result("donor", complete=True)
        with self.store.begin_run("borrower", source=self.source) as run:
            result = {**donor, "id": "borrower"}
            result.pop("runManifest")
            run.finalize(result=result)
            result["runManifest"] = run.manifest_ref.to_dict()
        node = self.project([result])["results"][0]
        self.assertTrue(any(field.startswith("evidence: invalid") for field in node["missingFields"]))

    def test_malformed_resource_checks_do_not_qualify(self) -> None:
        with self.store.begin_run("malformed", source=self.source) as run:
            primary = run.write_json("reports/observation.json", {"artifactKind": "synthetic-observation"})
            result = {
                "id": "malformed", "status": "blocked", "proofStatus": "UNPROVEN",
                "sourceArtifact": primary.to_dict(), "sourcePhase": "Synthetic Provisioning",
                "blockedReason": "unknown", "blockedResource": "synthetic-resource",
                "diagnostic": {"owner": "owner", "recoveryAction": "inspect", "resourceChecks": [{"state": "PASSED"}]},
            }
            run.finalize(result=result)
            result["runManifest"] = run.manifest_ref.to_dict()
        node = self.project([result])["results"][0]
        self.assertIn("resourceChecks[0]: invalid or unverified", node["missingFields"])

    def test_deployment_identity_is_read_from_artifact_and_secrets_are_redacted(self) -> None:
        with self.store.begin_run("deployment", source=self.source) as run:
            primary = run.write_json("reports/observation.json", {"artifactKind": "synthetic-observation"})
            attestation = run.write_json("runtime/service/attestation.json", {
                "artifactKind": "service-deployment-attestation", "serviceId": "synthetic-service",
                "endpoint": "https://example.invalid/service?token=sensitive-canary",
                "commit": "deployed-older-source", "producer": "synthetic-deployment-owner",
            })
            result = {
                "id": "deployment", "status": "blocked", "proofStatus": "UNPROVEN",
                "sourceArtifact": primary.to_dict(), "sourcePhase": "Synthetic Provisioning",
                "blockedReason": "source mismatch password=sensitive-canary", "blockedResource": "source:synthetic",
                "evidenceArtifacts": [{"artifactKind": "service-deployment-attestation", "path": attestation.to_dict()}],
            }
            run.finalize(result=result)
            result["runManifest"] = run.manifest_ref.to_dict()
        projection = self.project([result])
        deployment = projection["results"][0]["deployments"][0]
        self.assertEqual(deployment["observed"]["commit"], "deployed-older-source")
        self.assertEqual(deployment["candidateSource"], self.source)
        report = self.module.render_report({"selected_gates": []}, {"source": self.source, "results": [result]}, projection)
        self.assertNotIn("sensitive-canary", report)
        self.assertIn("[REDACTED]", report)

    def test_empty_run_and_passed_unproven_do_not_claim_complete(self) -> None:
        self.assertEqual(self.project([])["diagnosticStatus"], "DIAGNOSTIC_INCOMPLETE")
        projection = self.project([{"id": "unknown", "status": "passed", "proofStatus": "UNPROVEN"}])
        self.assertEqual(projection["diagnosticallyIncompleteGateCount"], 1)
        with self.assertRaisesRegex(ValueError, "duplicate Gate"):
            self.project([{"id": "duplicate"}, {"id": "duplicate"}])


    def test_real_cli_writes_gap_report_and_does_not_inherit_product_proof(self) -> None:
        root = self.store.root
        plan = root / "input-plan.json"
        run = root / "input-run.json"
        plan.write_text(json.dumps({"selected_gates": [{
            "id": "consumer", "judgment": "all-prerequisites", "dependsOn": ["producer"],
        }]}))
        run.write_text(json.dumps({"source": self.source, "results": [self.result("producer")]}))
        environment = {key: value for key, value in os.environ.items() if not key.startswith("PT_ACCEPTANCE_")}
        environment["PT_ACCEPTANCE_ARTIFACT_ROOT"] = str(root)
        completed = subprocess.run([
            sys.executable, str(SCRIPT), "--plan", str(plan), "--run", str(run), "--require-diagnostics",
        ], env=environment, text=True, capture_output=True, timeout=10)
        self.assertEqual(completed.returncode, 2, completed.stderr)
        self.assertIn("DIAGNOSTIC_INCOMPLETE", completed.stdout)
        manifest = self.store.latest("acceptance-report")
        self.assertEqual(manifest["result"]["proofStatus"], "NOT_APPLICABLE")
        self.assertEqual(manifest["result"]["status"], "blocked")
        report_ref = self.store.latest_artifact_ref("acceptance-report", "report")
        content = self.store.resolve(report_ref).read_text()
        self.assertIn("judgment: all-prerequisites (producer)", content)
        self.assertIn("service:synthetic:endpoint", content)
        diagnostic = self.store.read_json(self.store.latest_artifact_ref("acceptance-report", "diagnostics"))
        self.assertEqual(diagnostic["incompleteGateCount"], 1)
        self.assertEqual(diagnostic["observationSource"], self.source)


if __name__ == "__main__":
    unittest.main()
