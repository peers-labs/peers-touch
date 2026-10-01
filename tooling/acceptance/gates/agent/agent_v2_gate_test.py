from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tooling.acceptance.core import EvidenceStore, source_identity
from tooling.acceptance.gates.agent.agent_v2_gate import (
    AUTO_CANDIDATE_PRODUCERS,
    GATE_ROLES,
    MATRIX,
    REPO_ROOT,
    RUNNER_GENERATED_ROLES,
    _produce_candidate,
    _report,
    _resolve_candidate,
    _validate_candidate,
)


class AgentV2GateContractTest(unittest.TestCase):
    gate_id = "agent-v2-home-command-center-e2e"

    def write_candidate(
        self,
        root: Path,
        *,
        gate_id: str | None = None,
        omitted_role: str = "",
        empty_role: str = "",
        matrix: dict[str, str] | None = None,
    ) -> Path:
        selected_gate = gate_id or self.gate_id
        artifacts = []
        for role in (
            set(GATE_ROLES[selected_gate]) - RUNNER_GENERATED_ROLES
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
                    "gateId": selected_gate,
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

    def test_evaluation_gate_requires_external_j06_candidate(self) -> None:
        catalog = json.loads(
            (REPO_ROOT / "tooling/acceptance/gates.yaml").read_text()
        )["gates"]
        gate = catalog["agent-v2-evaluation-lab-e2e"]

        self.assertEqual(
            gate["command"],
            (
                "python3 tooling/acceptance/gates/agent/agent_v2_gate.py "
                "--gate agent-v2-evaluation-lab-e2e"
            ),
        )
        self.assertEqual(gate["runtime_matrix"]["expected_tuple_count"], 57)
        self.assertIn("cell-results", gate["required_artifact_roles"])
        self.assertIn("runtime-events", gate["required_artifact_roles"])

    def test_complete_external_candidate_is_candidate_only(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            issues = _validate_candidate(
                self.gate_id, self.write_candidate(root)
            )
        report = _report(self.gate_id, "candidate.json", issues)
        self.assertEqual(issues, [])
        self.assertTrue(report["candidateComplete"])
        self.assertEqual(
            report["artifactKind"],
            "acceptance-gate-evidence-report",
        )
        self.assertEqual(report["status"], "passed")
        self.assertEqual(report["proofStatus"], "CANDIDATE")

    def test_auto_candidate_runs_bounded_producer_and_cleans_temp_root(
        self,
    ) -> None:
        gate_id = "agent-v2-capability-binding-e2e"
        observed_root: Path | None = None

        def run(
            command: list[str],
            **kwargs: object,
        ) -> subprocess.CompletedProcess[str]:
            nonlocal observed_root
            self.assertEqual(
                command,
                [sys.executable, *AUTO_CANDIDATE_PRODUCERS[gate_id]],
            )
            environment = kwargs["env"]
            self.assertIsInstance(environment, dict)
            assert isinstance(environment, dict)
            observed_root = Path(environment["PT_ACCEPTANCE_ARTIFACT_ROOT"])
            for key in (
                "PT_ACCEPTANCE_WORKSPACE_ID",
                "PT_ACCEPTANCE_GATE_ID",
                "PT_ACCEPTANCE_RUN_ID",
                "PT_ACCEPTANCE_REDACTION_VALUES",
                "PT_AGENT_V2_CANDIDATE_MANIFEST",
            ):
                self.assertNotIn(key, environment)
            candidate = self.write_candidate(
                observed_root,
                gate_id=gate_id,
            )
            return subprocess.CompletedProcess(
                command,
                0,
                stdout=json.dumps({"candidate": str(candidate)}) + "\n",
                stderr="",
            )

        inherited = {
            "PT_ACCEPTANCE_WORKSPACE_ID": "parent-workspace",
            "PT_ACCEPTANCE_GATE_ID": gate_id,
            "PT_ACCEPTANCE_RUN_ID": "parent-run",
            "PT_ACCEPTANCE_REDACTION_VALUES": '["secret"]',
            "PT_AGENT_V2_CANDIDATE_MANIFEST": "/tmp/stale.json",
        }
        with patch.dict(os.environ, inherited), patch(
            "tooling.acceptance.gates.agent.agent_v2_gate.subprocess.run",
            side_effect=run,
        ):
            manifest, issues, role_payloads = _produce_candidate(gate_id)

        self.assertEqual(
            manifest,
            "auto:" + " ".join(AUTO_CANDIDATE_PRODUCERS[gate_id]),
        )
        self.assertEqual(issues, [])
        self.assertEqual(
            set(role_payloads),
            set(GATE_ROLES[gate_id]) - RUNNER_GENERATED_ROLES,
        )
        self.assertIsNotNone(observed_root)
        assert observed_root is not None
        self.assertFalse(observed_root.exists())

    def test_auto_candidate_failure_cleans_temp_root(self) -> None:
        gate_id = "agent-v2-governed-tool-loop-e2e"
        observed_root: Path | None = None

        def run(
            command: list[str],
            **kwargs: object,
        ) -> subprocess.CompletedProcess[str]:
            nonlocal observed_root
            environment = kwargs["env"]
            assert isinstance(environment, dict)
            observed_root = Path(environment["PT_ACCEPTANCE_ARTIFACT_ROOT"])
            return subprocess.CompletedProcess(
                command,
                23,
                stdout="",
                stderr="producer failed",
            )

        with patch(
            "tooling.acceptance.gates.agent.agent_v2_gate.subprocess.run",
            side_effect=run,
        ):
            _, issues, role_payloads = _produce_candidate(gate_id)

        self.assertEqual(
            issues,
            ["candidate producer failed with exit code 23"],
        )
        self.assertEqual(role_payloads, {})
        self.assertIsNotNone(observed_root)
        assert observed_root is not None
        self.assertFalse(observed_root.exists())

    def test_explicit_candidate_does_not_run_auto_producer(self) -> None:
        gate_id = "agent-v2-capability-binding-e2e"
        with tempfile.TemporaryDirectory() as directory:
            candidate = self.write_candidate(
                Path(directory),
                gate_id=gate_id,
            )
            with patch(
                "tooling.acceptance.gates.agent.agent_v2_gate."
                "_produce_candidate",
                side_effect=AssertionError("auto producer must not run"),
            ):
                manifest, issues, role_payloads = _resolve_candidate(
                    gate_id,
                    str(candidate),
                )

        self.assertEqual(manifest, str(candidate))
        self.assertEqual(issues, [])
        self.assertEqual(
            set(role_payloads),
            set(GATE_ROLES[gate_id]) - RUNNER_GENERATED_ROLES,
        )

    def test_unmapped_gate_without_manifest_fails_closed(self) -> None:
        manifest, issues, role_payloads = _produce_candidate(self.gate_id)
        self.assertEqual(manifest, "")
        self.assertEqual(
            issues,
            ["PT_AGENT_V2_CANDIDATE_MANIFEST is required from a real scenario"],
        )
        self.assertEqual(role_payloads, {})

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
