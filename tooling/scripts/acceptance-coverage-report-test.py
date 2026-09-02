#!/usr/bin/env python3
"""Regression tests for durable Acceptance coverage evidence."""

from __future__ import annotations

import importlib.util
import hashlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import Mock, patch

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from tooling.acceptance.core import ArtifactRef, CanonicalResultTuple, EvidenceStore
def load_module() -> Any:
    script = Path(__file__).with_name("acceptance-coverage-report.py")
    spec = importlib.util.spec_from_file_location(
        "acceptance_coverage_report",
        script,
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {script}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class AcceptanceCoverageEvidenceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name)
        self.worktree = self.base / "repo"
        self.worktree.mkdir()
        self.artifact_root = self.base / "artifacts"
        self.source = {
            "commit": "abc123",
            "workspaceDigest": "clean",
        }
        self.module = load_module()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_rejects_duplicate_gate_catalog_keys(self) -> None:
        gates_path = self.worktree / "gates.yaml"
        gates_path.write_text(
            '{"gates":{"finalizer-gate":{"evidenceFinalizer":{},'
            '"evidenceFinalizer":{}}}}',
            encoding="utf-8",
        )

        with self.assertRaisesRegex(ValueError, "duplicate key"):
            self.module.load_json_or_yaml(gates_path)

        gates_path.write_text(
            '{"gates":{"finalizer-gate":{"timeout_seconds":-1e999}}}',
            encoding="utf-8",
        )
        with self.assertRaisesRegex(ValueError, "invalid number"):
            self.module.load_json_or_yaml(gates_path)

    def _has_evidence(
        self,
        gate_id: str,
        gate_definition: dict[str, Any] | None = None,
        finalizer_binding: Any | None = None,
    ) -> bool:
        with patch.object(
            self.module,
            "REPO_ROOT",
            self.worktree,
        ), patch.dict(
            os.environ,
            {"PT_ACCEPTANCE_ARTIFACT_ROOT": str(self.artifact_root)},
            clear=True,
        ), patch(
            "tooling.acceptance.core.source_identity",
            return_value=self.source,
        ):
            return self.module.has_evidence_for_gate(
                gate_id,
                gate_definition,
                finalizer_binding,
            )

    def _publish_run(
        self,
        gate_id: str,
        *,
        result: dict[str, Any],
        runtime_cell: str | None = None,
        include_secret_scan: bool = True,
        include_seal: bool = False,
    ) -> Path:
        store = EvidenceStore(
            self.artifact_root,
            worktree=self.worktree,
        )
        finalized_result: dict[str, Any] = dict(result)
        if include_secret_scan:
            finalized_result.setdefault(
                "secretScan",
                {
                    "status": "passed",
                    "scannedHighEntropyValues": 0,
                    "scannedCredentialValues": 0,
                    "redactedArtifacts": [],
                },
            )
        run = store.begin_run(gate_id, source=self.source)
        report_payload = {"gate": gate_id, **finalized_result}
        if finalized_result.get("tier") == "env-evidence":
            report_payload.update(
                {
                    "artifactKind": "acceptance-gate-evidence-report",
                    "gateId": gate_id,
                    "status": "PASS",
                    "completionStatus": "DONE",
                    "proofStatus": "PROVEN",
                }
            )
        report = run.write_json(
            "reports/result.json",
            report_payload,
            role="report",
        )
        if include_seal:
            run.write_json(
                "reports/finalizer-seal.json",
                {"artifactKind": "acceptance-finalizer-seal"},
                role="finalizer-seal",
            )
        if finalized_result.get("tier") == "env-evidence":
            finalized_result.setdefault("evidenceGateId", gate_id)
            finalized_result.setdefault(
                "sourceArtifactKind",
                "acceptance-gate-evidence-report",
            )
            finalized_result.setdefault("sourceArtifact", report.to_dict())
        run.finalize(result=finalized_result)
        run.publish_latest(runtime_cell=runtime_cell)
        run.close()
        return store.resolve(report)

    def test_nonempty_legacy_directory_does_not_prove_gate(self) -> None:
        legacy = (
            self.worktree
            / "tooling"
            / "acceptance"
            / "evidence"
            / "synthetic-gate"
        )
        legacy.mkdir(parents=True)
        (legacy / "note.txt").write_text("not durable evidence", encoding="utf-8")

        self.assertFalse(
            self._has_evidence(
                "synthetic-gate",
                {"tier": "env-evidence"},
            )
        )

    def test_environment_proof_rejects_spoofed_source_artifact_kind(
        self,
    ) -> None:
        report = self._publish_run(
            "synthetic-gate",
            result={
                "status": "passed",
                "completionStatus": "DONE",
                "proofStatus": "PROVEN",
                "tier": "env-evidence",
            },
        )
        payload = json.loads(report.read_text(encoding="utf-8"))
        payload["artifactKind"] = "unrelated-report"
        report.write_text(json.dumps(payload) + "\n", encoding="utf-8")

        store = EvidenceStore(
            self.artifact_root,
            worktree=self.worktree,
        )
        pointer = store._latest_pointer("synthetic-gate", required=True)
        self.assertIsNotNone(pointer)
        manifest_path = store.resolve(
            ArtifactRef.from_dict(pointer["manifest"])
        )
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        source_artifact = manifest["result"]["sourceArtifact"]
        manifest["result"].pop("tier", None)
        manifest["result"]["sourceArtifactKind"] = "unrelated-report"
        source_artifact["sha256"] = hashlib.sha256(
            report.read_bytes()
        ).hexdigest()
        manifest["artifacts"]["report"]["sha256"] = source_artifact["sha256"]
        manifest_path.write_text(
            json.dumps(manifest, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        pointer["manifest"]["sha256"] = hashlib.sha256(
            manifest_path.read_bytes()
        ).hexdigest()
        pointer["manifestSha256"] = pointer["manifest"]["sha256"]
        (
            manifest_path.parent.parent / "latest.json"
        ).write_text(
            json.dumps(pointer, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

        self.assertFalse(
            self._has_evidence(
                "synthetic-gate",
                {"tier": "env-evidence"},
            )
        )

    def test_public_fixture_credential_does_not_require_secret_scan(self) -> None:
        self._publish_run(
            "synthetic-gate",
            result={
                "status": "passed",
                "completionStatus": "DONE",
                "proofStatus": "PROVEN",
                "manifest": {
                    "credentialRefs": [
                        "fixture:apps/station/app/conf/actor.yml#preset_users"
                    ],
                },
            },
        )

        self.assertTrue(self._has_evidence("synthetic-gate"))

    def test_handwritten_fail_json_does_not_prove_gate(self) -> None:
        legacy = self.worktree / "tooling" / "acceptance" / "evidence"
        legacy.mkdir(parents=True)
        (legacy / "synthetic-gate.json").write_text(
            json.dumps({"gate": "synthetic-gate", "status": "FAIL"}),
            encoding="utf-8",
        )

        self.assertFalse(
            self._has_evidence(
                "synthetic-gate",
                {"tier": "env-evidence"},
            )
        )

    def test_latest_manifest_requires_passed_done_proven(self) -> None:
        self._publish_run(
            "synthetic-gate",
            result={
                "status": "failed",
                "completionStatus": "DONE",
                "proofStatus": "PROVEN",
            },
        )

        self.assertFalse(self._has_evidence("synthetic-gate"))

    def test_latest_manifest_requires_intact_artifacts(self) -> None:
        report = self._publish_run(
            "synthetic-gate",
            result={
                "status": "passed",
                "completionStatus": "DONE",
                "proofStatus": "PROVEN",
            },
        )
        report.write_text('{"tampered":true}\n', encoding="utf-8")

        self.assertFalse(self._has_evidence("synthetic-gate"))

    def test_latest_manifest_requires_successful_redaction(self) -> None:
        store = EvidenceStore(
            self.artifact_root,
            worktree=self.worktree,
        )
        run = store.begin_run("synthetic-gate", source=self.source)
        run.write_json(
            "reports/result.json",
            {"gate": "synthetic-gate", "status": "passed"},
            role="report",
        )
        run.finalize(
            result={
                "status": "passed",
                "completionStatus": "DONE",
                "proofStatus": "PROVEN",
            },
            redaction_status="failed",
        )
        run.publish_latest()
        run.close()

        self.assertFalse(self._has_evidence("synthetic-gate"))

    def test_latest_manifest_requires_successful_secret_scan(self) -> None:
        self._publish_run(
            "synthetic-gate",
            result={
                "status": "passed",
                "completionStatus": "DONE",
                "proofStatus": "PROVEN",
            },
            include_secret_scan=False,
        )

        self.assertFalse(self._has_evidence("synthetic-gate"))

    def test_latest_manifest_requires_credential_scan_coverage(self) -> None:
        self._publish_run(
            "synthetic-gate",
            result={
                "status": "passed",
                "completionStatus": "DONE",
                "proofStatus": "PROVEN",
                "manifest": {
                    "credentialRefs": ["env:FIRST", "env:SECOND"],
                },
                "secretScan": {
                    "status": "passed",
                    "scannedHighEntropyValues": 0,
                    "scannedCredentialValues": 1,
                    "redactedArtifacts": [],
                },
            },
        )

        self.assertFalse(self._has_evidence("synthetic-gate"))

    def test_environment_proof_rejects_cross_gate_source_artifact(self) -> None:
        store = EvidenceStore(
            self.artifact_root,
            worktree=self.worktree,
        )
        other = store.begin_run("other-gate", source=self.source)
        other_reference = other.write_json(
            "reports/other.json",
            {
                "artifactKind": "acceptance-gate-evidence-report",
                "gateId": "other-gate",
                "status": "PASS",
            },
            role="report",
        )
        other.close()

        self._publish_run(
            "synthetic-gate",
            result={
                "status": "passed",
                "completionStatus": "DONE",
                "proofStatus": "PROVEN",
                "tier": "env-evidence",
                "evidenceGateId": "synthetic-gate",
                "sourceArtifactKind": "acceptance-gate-evidence-report",
                "sourceArtifact": other_reference.to_dict(),
            },
        )

        self.assertFalse(
            self._has_evidence(
                "synthetic-gate",
                {"tier": "env-evidence"},
            )
        )

    def test_runtime_cell_gate_requires_complete_platform_matrix(self) -> None:
        self._publish_run(
            "synthetic-gate",
            result={
                "status": "passed",
                "completionStatus": "DONE",
                "proofStatus": "PROVEN",
                "runtimeCell": "desktop-linux-native",
            },
            runtime_cell="desktop-linux-native",
        )

        self.assertFalse(
            self._has_evidence(
                "synthetic-gate",
                {
                    "requiredRuntimeCells": [
                        "desktop-macos-native",
                        "desktop-linux-native",
                    ],
                },
            )
        )

    def test_complete_platform_matrix_proves_runtime_cell_gate(self) -> None:
        required_cells = [
            "desktop-macos-native",
            "desktop-linux-native",
        ]
        for cell_id in required_cells:
            self._publish_run(
                "synthetic-gate",
                result={
                    "status": "passed",
                    "completionStatus": "DONE",
                    "proofStatus": "PROVEN",
                    "runtimeCell": cell_id,
                },
                runtime_cell=cell_id,
            )

        self.assertTrue(
            self._has_evidence(
                "synthetic-gate",
                {"requiredRuntimeCells": required_cells},
            )
        )

    def test_stale_source_does_not_prove_gate(self) -> None:
        self._publish_run(
            "synthetic-gate",
            result={
                "status": "passed",
                "completionStatus": "DONE",
                "proofStatus": "PROVEN",
            },
        )
        self.source["commit"] = "different"

        self.assertFalse(self._has_evidence("synthetic-gate"))

    def test_malformed_manifest_fails_closed(self) -> None:
        malformed = {
            "artifactKind": "acceptance-run-manifest",
            "state": "DURABLE",
            "workspaceId": "0123456789abcdef",
            "gateId": "synthetic-gate",
        }
        with patch(
            "tooling.acceptance.core.EvidenceStore.latest",
            return_value=malformed,
        ):
            self.assertFalse(self._has_evidence("synthetic-gate"))

    def test_intact_latest_passed_done_proven_manifest_proves_gate(self) -> None:
        self._publish_run(
            "synthetic-gate",
            result={
                "status": "passed",
                "completionStatus": "DONE",
                "proofStatus": "PROVEN",
            },
        )

        self.assertTrue(self._has_evidence("synthetic-gate"))

    def test_required_finalizer_rejects_missing_finalization_record(self) -> None:
        self._publish_run(
            "synthetic-gate",
            result={
                "status": "passed",
                "completionStatus": "DONE",
                "proofStatus": "PROVEN",
            },
        )

        self.assertFalse(
            self._has_evidence(
                "synthetic-gate",
                {"evidenceFinalizer": {"id": "synthetic.finalizer"}},
                Mock(),
            )
        )

    def test_required_finalizer_remains_unproven_before_authority_cutover(
        self,
    ) -> None:
        self._publish_run(
            "synthetic-gate",
            result={
                "status": "passed",
                "completionStatus": "DONE",
                "proofStatus": "PROVEN",
                "evidenceFinalization": {"record": "validated separately"},
            },
            include_seal=True,
        )
        self.assertFalse(
            self._has_evidence(
                "synthetic-gate",
                {"evidenceFinalizer": {"id": "synthetic.finalizer"}},
                Mock(),
            )
        )


if __name__ == "__main__":
    unittest.main()
