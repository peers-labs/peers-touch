from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.core import EvidenceError, EvidenceStore
from tooling.acceptance.core.evidence import new_report
from tooling.acceptance.core.gate import AcceptanceGate
from tooling.acceptance.core.proof import read_gate_proof


class EvidenceProofTests(unittest.TestCase):
    def test_report_requires_true_assertions(self) -> None:
        for assertions, expected in (
            ([True], "PROVEN"),
            ([True, False], "UNPROVEN"),
            ([1], "UNPROVEN"),
        ):
            with self.subTest(assertions=assertions):
                report = new_report("proof-control")
                report.status = "PASS"
                for index, value in enumerate(assertions):
                    report.add_assertion(str(index), value)
                payload = report.to_dict()
                self.assertEqual(payload["proofStatus"], expected)
                self.assertEqual(payload["sampleEmissionAllowed"], expected == "PROVEN")

    def test_command_return_cannot_override_failed_assertion(self) -> None:
        class RecordedGate(AcceptanceGate):
            gate_id = "proof-control"

            def run(self):
                self.report.add_assertion("receiver-observation", False)
                return {}

        with tempfile.TemporaryDirectory() as directory:
            gate = RecordedGate()
            gate.report_path = Path(directory) / "report.json"
            self.assertEqual(gate.execute(), 1)
            payload = json.loads(gate.report_path.read_text())
            self.assertEqual(payload["proofStatus"], "UNPROVEN")
            self.assertFalse(payload["sampleEmissionAllowed"])


class OriginalProofTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name).resolve()
        worktree = root / "repo"
        worktree.mkdir()
        self.store = EvidenceStore(root / "evidence", worktree=worktree)
        self.source = {"commit": "current", "workspaceDigest": "current"}

    def publish(self, *, changes=None, assertions=None, bind_report=True, cell=None):
        run = self.store.begin_run("proof-control", source=self.source)
        self.addCleanup(run.close)
        report = run.write_json("reports/result.json", {
            "artifactKind": "acceptance-gate-evidence-report",
            "gateId": "proof-control", "status": "PASS",
            "completionStatus": "DONE", "proofStatus": "PROVEN",
            "assertions": [{"name": "observed", "passed": True}]
            if assertions is None else assertions,
        }, role="report")
        result = {
            "id": "proof-control", "status": "passed",
            "completionStatus": "DONE", "proofStatus": "PROVEN",
            "cleanupStatus": "not-required",
            "secretScan": {
                "status": "passed", "scannedHighEntropyValues": 0,
                "scannedCredentialValues": 0, "redactedArtifacts": [],
            },
        }
        if bind_report:
            result.update(sourceArtifact=report.to_dict(),
                          sourceArtifactKind="acceptance-gate-evidence-report")
        if cell is not None:
            result["runtimeCell"] = cell
        result.update(changes or {})
        result = {key: value for key, value in result.items() if value is not None}
        run.finalize(result=result)
        manifest = run.manifest_ref
        run.publish_latest(runtime_cell=cell)
        run.close()
        return manifest, {**result, "runManifest": manifest.to_dict()}, report

    def test_original_reports_and_material_must_qualify(self):
        reference, result, report = self.publish()
        self.assertEqual(
            read_gate_proof(self.store, "proof-control", self.source, result=result)["runId"],
            reference.run_id,
        )
        for field, changed in (
            ("sourceArtifact", {**report.to_dict(), "path": "reports/other.json"}),
            ("sourceArtifactKind", "changed-kind"),
            ("cleanupStatus", "failed"),
            ("manifest", {"state": "changed"}),
        ):
            with self.subTest(field=field), self.assertRaises(EvidenceError):
                read_gate_proof(
                    self.store, "proof-control", self.source,
                    result={**result, field: changed},
                )
        with self.assertRaises(EvidenceError):
            read_gate_proof(self.store, "proof-control", {"commit": "other"}, reference=reference)
        path = self.store.resolve(report)
        path.write_text('{"changed":true}\n')
        with self.assertRaises(EvidenceError):
            read_gate_proof(self.store, "proof-control", self.source, reference=reference)

    def test_missing_report_binding_cannot_hide_failed_assertions(self):
        for assertions in (
            [], [{"name": "observed", "passed": False}],
            [{"name": "observed", "passed": 1}], [{"name": "", "passed": True}],
        ):
            with self.subTest(assertions=assertions):
                reference, _, _ = self.publish(assertions=assertions, bind_report=False)
                with self.assertRaises(EvidenceError):
                    read_gate_proof(self.store, "proof-control", self.source, reference=reference)

    def test_incomplete_cleanup_identity_and_scans_reject(self):
        for changes in (
            {"cleanupStatus": None}, {"cleanupStatus": "failed"},
            {"id": "another-gate"}, {"secretScan": None},
            {"secretScan": {"status": "failed", "scannedHighEntropyValues": 0,
                            "scannedCredentialValues": 0, "redactedArtifacts": []}},
        ):
            with self.subTest(changes=changes):
                reference, _, _ = self.publish(changes=changes)
                with self.assertRaises(EvidenceError):
                    read_gate_proof(self.store, "proof-control", self.source, reference=reference)

    def test_original_legacy_and_runtime_cell_authority_are_distinct(self):
        original, result, _ = self.publish(cell="cell-one")
        _, _, _ = self.publish(cell="cell-two")
        self.assertEqual(
            read_gate_proof(
                self.store, "proof-control", self.source, result=result,
                runtime_cell="cell-one", require_latest=True,
            )["runId"], original.run_id,
        )
        newer, _, _ = self.publish(cell="cell-one")
        self.assertNotEqual(newer.run_id, original.run_id)
        self.assertEqual(
            read_gate_proof(self.store, "proof-control", self.source, result=result)["runId"],
            original.run_id,
        )
        with self.assertRaises(EvidenceError):
            read_gate_proof(
                self.store, "proof-control", self.source, result=result,
                runtime_cell="cell-one", require_latest=True,
            )
        with self.assertRaises(EvidenceError):
            read_gate_proof(
                self.store, "proof-control", self.source,
                reference=original, runtime_cell="cell-two",
            )
        with self.assertRaises(EvidenceError):
            read_gate_proof(
                self.store, "proof-control", self.source, reference=newer,
                gate_definition={"evidenceFinalizer": {"id": "required.finalizer"}},
            )


if __name__ == "__main__":
    unittest.main()
