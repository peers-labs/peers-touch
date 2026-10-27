from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling.acceptance.core import EvidenceStore, REPO_ROOT
from tooling.acceptance.station_access_evidence import GateResult, GateSpec, check_gate
from tooling.acceptance.gates.chat import lifecycle_ccu_aggregate
from tooling.acceptance.gates.chat_storage import governance_aggregate
from tooling.acceptance.gates.station_access import lifecycle_aggregate
from tooling.acceptance.input_owners.prerequisite_toolchain import (
    COMMANDS, original_producer_inputs,
)


class PrerequisiteAggregateContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        self.store = EvidenceStore(root / "evidence", worktree=root / "source")
        self.source = {
            "commit": "a" * 40,
            "workspaceDigest": "sha256:" + "b" * 64,
            "canonicalWorktreeHash": self.store.workspace_id,
        }
        self.spec = GateSpec("SYNTHETIC", "synthetic-producer")

    def producer(self, *, cleanup: str | None = "passed", runtime_cell: str | None = None):
        with self.store.begin_run(self.spec.gate_id, source=self.source) as run:
            payload = run.write_json("reports/result.json", {"status": "PASS"}, role="report")
            result = {
                "id": self.spec.gate_id, "artifactKind": "acceptance-gate-result",
                "status": "passed", "completionStatus": "DONE", "proofStatus": "PROVEN",
                "secretScan": {
                    "status": "passed", "scannedHighEntropyValues": 0,
                    "scannedCredentialValues": 0, "redactedArtifacts": [],
                },
            }
            if cleanup is not None:
                result["cleanupStatus"] = cleanup
            if runtime_cell is not None:
                result["runtimeCell"] = runtime_cell
            run.finalize(result=result)
            run.publish_latest()
            return run.manifest_ref, result, payload

    def envelope(self, ref, result):
        return {
            "PT_ACCEPTANCE_CURRENT_RESULTS": json.dumps({
                "source": self.source,
                "results": [{**result, "runManifest": ref.to_dict()}],
            }),
            "PT_ACCEPTANCE_PREREQUISITE_PROOFS": json.dumps([
                {"gateId": self.spec.gate_id, "runManifest": ref.to_dict()},
            ]),
        }

    def test_original_producer_survives_latest_replacement(self) -> None:
        original, result, _ = self.producer()
        replacement, _, _ = self.producer()
        self.assertNotEqual(original.run_id, replacement.run_id)
        with patch.dict("os.environ", self.envelope(original, result)):
            observed = check_gate(self.store, self.spec, expected_source=self.source)
        self.assertEqual(observed.status, "PASS")
        self.assertEqual(observed.run_id, original.run_id)

    def test_cleanup_is_required_for_producer_admission(self) -> None:
        for cleanup in (None, "failed", "interrupted"):
            with self.subTest(cleanup=cleanup):
                ref, result, _ = self.producer(cleanup=cleanup)
                with patch.dict("os.environ", self.envelope(ref, result)):
                    observed = check_gate(self.store, self.spec, expected_source=self.source)
                self.assertEqual(observed.status, "FAIL")

    def test_current_source_with_complete_gates_can_aggregate(self) -> None:
        for module in (lifecycle_ccu_aggregate, governance_aggregate, lifecycle_aggregate):
            with self.subTest(module=module.__name__):
                gates = [GateResult("SYNTHETIC", "synthetic-producer", "run", "PASS")]
                result = module.AggregateResult(source=self.source, gates=gates)
                self.assertTrue(result.passed)
                self.assertFalse(result.unproven)

    def test_original_inventory_bytes_are_verified(self) -> None:
        ref, result, payload = self.producer()
        self.store.resolve(payload).write_text('{"status": "FAIL"}')
        with patch.dict("os.environ", self.envelope(ref, result)):
            observed = check_gate(self.store, self.spec, expected_source=self.source)
        self.assertEqual(observed.status, "ERROR")

    def test_current_result_cannot_claim_a_different_original(self) -> None:
        original, result, _ = self.producer()
        replacement, _, _ = self.producer()
        environment = self.envelope(original, result)
        envelope = json.loads(environment["PT_ACCEPTANCE_CURRENT_RESULTS"])
        envelope["results"][0]["runManifest"] = replacement.to_dict()
        environment["PT_ACCEPTANCE_CURRENT_RESULTS"] = json.dumps(envelope)
        with patch.dict("os.environ", environment):
            observed = check_gate(self.store, self.spec, expected_source=self.source)
        self.assertEqual(observed.status, "ERROR")

    def test_requested_runtime_cell_uses_the_original_manifest(self) -> None:
        for cell, expected in (("desktop-macos-native", "PASS"), (None, "ERROR")):
            with self.subTest(cell=cell):
                ref, result, _ = self.producer(runtime_cell=cell)
                spec = GateSpec("SYNTHETIC", self.spec.gate_id, "desktop-macos-native")
                with patch.dict("os.environ", self.envelope(ref, result)):
                    observed = check_gate(self.store, spec, expected_source=self.source)
                self.assertEqual(observed.status, expected)

    def test_unbound_latest_cannot_supply_missing_current_proof(self) -> None:
        ref, result, _ = self.producer()
        environment = self.envelope(ref, result)
        environment["PT_ACCEPTANCE_PREREQUISITE_PROOFS"] = "[]"
        with (
            patch.dict("os.environ", environment),
            patch.object(self.store, "latest", autospec=True) as latest,
        ):
            observed = check_gate(self.store, self.spec, expected_source=self.source)
        self.assertEqual(observed.status, "MISSING")
        latest.assert_not_called()

    def test_duplicate_or_changed_context_is_rejected(self) -> None:
        ref, result, _ = self.producer()
        environment = self.envelope(ref, result)
        cases = {}
        refs = json.loads(environment["PT_ACCEPTANCE_PREREQUISITE_PROOFS"])
        cases["duplicate-reference"] = {
            **environment, "PT_ACCEPTANCE_PREREQUISITE_PROOFS": json.dumps(refs + refs),
        }
        envelope = json.loads(environment["PT_ACCEPTANCE_CURRENT_RESULTS"])
        envelope["results"] += envelope["results"]
        cases["duplicate-result"] = {
            **environment, "PT_ACCEPTANCE_CURRENT_RESULTS": json.dumps(envelope),
        }
        envelope["results"] = envelope["results"][:1]
        envelope["source"]["workspaceDigest"] = "sha256:" + "c" * 64
        cases["changed-source"] = {
            **environment, "PT_ACCEPTANCE_CURRENT_RESULTS": json.dumps(envelope),
        }
        for name, value in cases.items():
            with self.subTest(name=name), patch.dict("os.environ", value):
                observed = check_gate(self.store, self.spec, expected_source=self.source)
                self.assertEqual(observed.status, "STALE" if name == "changed-source" else "ERROR")

    def owner_context(self, ref):
        gate_id = "x-config-api-aggregate-e2e"
        return {
            "gate": {"id": gate_id, "command": COMMANDS[gate_id], "dependsOn": [self.spec.gate_id]},
            "source": self.source,
            "inputArtifacts": {
                "artifactKind": "acceptance-gate-input-artifacts", "gateId": gate_id,
                "workspaceId": self.store.workspace_id, "runId": "synthetic-consumer",
                "artifacts": {},
                "prerequisiteProofs": [
                    {"gateId": self.spec.gate_id, "runManifest": ref.to_dict()},
                ],
            },
        }

    def test_owner_retains_and_revalidates_original_material_inputs(self) -> None:
        ref, _, _ = self.producer()
        context = self.owner_context(ref)
        original = original_producer_inputs(context, self.store)
        replacement, _, _ = self.producer()
        self.assertEqual(original_producer_inputs(context, self.store), original)
        self.assertNotEqual(
            original_producer_inputs(self.owner_context(replacement), self.store), original,
        )

    def test_owner_rejects_incomplete_or_unproven_prerequisites(self) -> None:
        for cleanup in (None, "failed"):
            with self.subTest(cleanup=cleanup):
                ref, _, _ = self.producer(cleanup=cleanup)
                with self.assertRaisesRegex(ValueError, "complete current-source proof"):
                    original_producer_inputs(self.owner_context(ref), self.store)
        ref, _, _ = self.producer()
        context = self.owner_context(ref)
        context["inputArtifacts"]["prerequisiteProofs"] = []
        with self.assertRaisesRegex(ValueError, "inventory is incomplete"):
            original_producer_inputs(context, self.store)

    def test_empty_aggregate_remains_unproven(self) -> None:
        result = lifecycle_ccu_aggregate.AggregateResult(self.source)
        self.assertFalse(result.passed)
        self.assertTrue(result.unproven)

    def test_runner_supplies_original_prerequisite_envelope(self) -> None:
        root = Path(self.temporary.name)
        catalogue, policy = root / "catalog.json", root / "policy.json"
        consumer = (
            "import json,os;from pathlib import Path;"
            "from tooling.acceptance.core import EvidenceStore;"
            "from tooling.acceptance.station_access_evidence import GateSpec,check_gate;"
            "source=json.loads(os.environ['PT_ACCEPTANCE_CURRENT_RESULTS'])['source'];"
            "store=EvidenceStore.from_environment(repo_root=Path.cwd(),worktree=Path.cwd());"
            "result=check_gate(store,GateSpec('SYNTHETIC','synthetic-producer'),expected_source=source);"
            "assert result.status=='PASS',result;"
            "ref=json.loads(os.environ['PT_ACCEPTANCE_PREREQUISITE_PROOFS'])[0]['runManifest'];"
            "assert result.run_manifest==ref"
        )
        catalogue.write_text(json.dumps({"gates": {
            "synthetic-producer": {"argv": [sys.executable, "-c", "print('synthetic source check')"]},
            "synthetic-consumer": {
                "argv": [sys.executable, "-c", consumer], "dependsOn": ["synthetic-producer"],
            },
        }}))
        policy.write_text(json.dumps({
            "requestSeconds": 180, "planningSeconds": 5,
            "lifecycle": {"cleanupSeconds": 15, "publishSeconds": 15},
            "gates": {
                gate: {"cleanupSeconds": 15, "publishSeconds": 15, "workSeconds": 150}
                for gate in ("synthetic-producer", "synthetic-consumer")
            },
        }))
        completed = subprocess.run(
            [sys.executable, "tooling/scripts/acceptance-run.py", "--gates", str(catalogue),
             "--gate", "synthetic-consumer", "--execution-budget", str(policy)],
            cwd=REPO_ROOT, capture_output=True, text=True, timeout=30,
            env={**os.environ, "PT_ACCEPTANCE_ARTIFACT_ROOT": str(root / "runner-evidence")},
        )
        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        report_path, = (root / "runner-evidence").rglob("reports/run.json")
        report = json.loads(report_path.read_text())
        producer, consumer_result = report["results"]
        self.assertEqual(producer["id"], "synthetic-producer")
        self.assertEqual(consumer_result["id"], "synthetic-consumer")
        self.assertEqual(consumer_result["prerequisiteProofs"][0]["runManifest"], producer["runManifest"])


if __name__ == "__main__":
    unittest.main()
