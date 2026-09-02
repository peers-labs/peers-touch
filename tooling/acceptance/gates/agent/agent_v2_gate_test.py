from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from tooling.acceptance.core import EvidenceStore, source_identity
from tooling.acceptance.gates.agent.agent_v2_gate import (
    GATE_ROLES,
    MATRIX,
    REPO_ROOT,
    RUNNER_GENERATED_ROLES,
    _report,
    _validate_candidate,
)


class AgentV2GateContractTest(unittest.TestCase):
    gate_id = "agent-v2-home-command-center-e2e"

    def write_candidate(
        self,
        root: Path,
        *,
        omitted_role: str = "",
        empty_role: str = "",
        matrix: dict[str, str] | None = None,
    ) -> Path:
        artifacts = []
        for role in (
            set(GATE_ROLES[self.gate_id]) - RUNNER_GENERATED_ROLES
        ):
            if role == omitted_role:
                continue
            path = root / f"{role}.json"
            path.write_text("" if role == empty_role else '{"observed":true}\n')
            artifacts.append({"role": role, "path": path.name})
        manifest = root / "candidate.json"
        manifest.write_text(
            json.dumps(
                {
                    "gateId": self.gate_id,
                    "runtimeMatrix": matrix or MATRIX,
                    "scenarioExecuted": True,
                    "proofStatus": "UNPROVEN",
                    "artifacts": artifacts,
                }
            )
        )
        return manifest

    def test_missing_manifest_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            issues = _validate_candidate(
                self.gate_id, Path(directory) / "missing.json"
            )
        report = _report(self.gate_id, "", issues)
        self.assertFalse(report["candidateComplete"])
        self.assertEqual(report["proofStatus"], "UNPROVEN")

    def test_missing_or_empty_role_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            missing = _validate_candidate(
                self.gate_id,
                self.write_candidate(root, omitted_role="receiver-dom"),
            )
            self.assertTrue(any("missing mandatory artifact roles" in issue for issue in missing))

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            empty = _validate_candidate(
                self.gate_id,
                self.write_candidate(root, empty_role="receiver-dom"),
            )
            self.assertIn("receiver-dom: artifact is empty", empty)

    def test_wrong_matrix_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            issues = _validate_candidate(
                self.gate_id,
                self.write_candidate(
                    root,
                    matrix={**MATRIX, "sha256": "0" * 64},
                ),
            )
        self.assertTrue(any("runtime matrix" in issue for issue in issues))

    def test_duplicate_role_and_source_tree_candidate_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = self.write_candidate(root)
            candidate = json.loads(manifest.read_text())
            candidate["artifacts"].append(dict(candidate["artifacts"][0]))
            manifest.write_text(json.dumps(candidate))
            duplicate = _validate_candidate(self.gate_id, manifest)
        self.assertTrue(any("duplicate artifact roles" in issue for issue in duplicate))

        source_tree = _validate_candidate(
            self.gate_id, REPO_ROOT / "tooling/acceptance/gates.yaml"
        )
        self.assertEqual(
            source_tree, ["candidate manifest must be outside the source tree"]
        )

    def test_catalog_pins_exact_matrix_roles_and_unproven_status(self) -> None:
        catalog = json.loads(
            (REPO_ROOT / "tooling/acceptance/gates.yaml").read_text()
        )["gates"]
        for gate_id, roles in GATE_ROLES.items():
            with self.subTest(gate_id=gate_id):
                gate = catalog[gate_id]
                self.assertEqual(gate["initial_proof_status"], "UNPROVEN")
                self.assertEqual(
                    {
                        key: gate["runtime_matrix"][key]
                        for key in ("id", "version", "sha256")
                    },
                    MATRIX,
                )
                self.assertEqual(gate["required_artifact_roles"], list(roles))

    def test_complete_external_candidate_is_candidate_only(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            issues = _validate_candidate(
                self.gate_id, self.write_candidate(root)
            )
        report = _report(self.gate_id, "candidate.json", issues)
        self.assertEqual(issues, [])
        self.assertTrue(report["candidateComplete"])
        self.assertEqual(report["status"], "passed")
        self.assertEqual(report["proofStatus"], "CANDIDATE")

    def test_gate_registers_scenario_roles_in_parent_run(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            candidate = self.write_candidate(root)
            store = EvidenceStore(root / "evidence", worktree=REPO_ROOT)
            run = store.begin_run(
                self.gate_id,
                source=source_identity(REPO_ROOT),
            )
            try:
                environment = run.subprocess_environment(os.environ.copy())
                environment["PT_AGENT_V2_CANDIDATE_MANIFEST"] = str(
                    candidate
                )
                completed = subprocess.run(
                    [
                        sys.executable,
                        "tooling/acceptance/gates/agent/agent_v2_gate.py",
                        "--gate",
                        self.gate_id,
                    ],
                    cwd=REPO_ROOT,
                    env=environment,
                    text=True,
                    capture_output=True,
                    check=False,
                )
                self.assertEqual(completed.returncode, 0, completed.stderr)
                roles = set(run.collect_existing_artifacts())
                scenario_roles = (
                    set(GATE_ROLES[self.gate_id])
                    - RUNNER_GENERATED_ROLES
                )
                self.assertTrue(scenario_roles.issubset(roles))
                self.assertTrue(RUNNER_GENERATED_ROLES.isdisjoint(roles))
            finally:
                run.close()


if __name__ == "__main__":
    unittest.main()
