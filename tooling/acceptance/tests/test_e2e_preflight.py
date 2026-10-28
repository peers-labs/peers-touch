"""E2E preparation contract and real CLI execution without an IDE."""

from __future__ import annotations

import contextlib
import copy
from functools import partial
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

from tooling.acceptance.core import EvidenceStore
from tooling.acceptance.core.e2e_preflight import (
    PREFLIGHT_ENV, prepare_e2e, preflight_binding, preflight_gate_entry,
    require_ready, revalidate_preflight,
)
from tooling.acceptance.core.execution_budget import ExecutionBudgetError
from tooling.acceptance.core.execution_graph import compile_graph, prerequisite_results
from tooling.acceptance.tests.synthetic_git import run_synthetic_git, synthetic_git_environment

REPO_ROOT = Path(__file__).resolve().parents[3]
SOURCE = {"commit": "head", "workspaceDigest": "source", "canonicalWorktreeHash": "workspace"}


def module_at(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, REPO_ROOT / "tooling/scripts" / filename)
    module = importlib.util.module_from_spec(spec)
    with mock.patch.object(sys, "path", [str(REPO_ROOT / "tooling/scripts"), *sys.path]):
        spec.loader.exec_module(module)
    return module


def declaration(reference="actions.py#journey", dependencies=(), lifetime="scenario"):
    return {
        "ref": reference, "purpose": "Reuse original owner action", "lifetime": lifetime,
        "dependsOn": list(dependencies), "invalidatedBy": ["source", "action-plan"],
    }


def gate_definition():
    return {
        "command": "true", "tier": "ci-cheap", "environment": "local",
        "e2e": {
            "journeys": [{"id": "single-journey", "uses": ["actions.py#journey"]}],
            "implementations": [declaration()],
        },
    }


class E2EPreflightTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.actions = self.root / "actions.py"
        self.actions.write_text("raise RuntimeError('must never import')\ndef journey():\n    return 1\n")
        self.catalog = self.root / "gates.json"
        self.definitions = {"selected": gate_definition(), "unrelated": gate_definition()}
        self.catalog.write_text(json.dumps({"gates": self.definitions}))

    def prepare(self, selected=None, policy="acceptance"):
        return prepare_e2e(
            self.definitions, compile_graph(self.definitions, selected or ["selected"]),
            SOURCE, repo_root=self.root, catalog_path=self.catalog, execution_policy=policy,
        )

    def test_pure_read_does_not_import_and_keeps_one_explicit_journey(self):
        report = self.prepare()
        require_ready(report)
        self.assertEqual(report["dispatchGateIds"], ["selected"])
        self.assertEqual(report["proofStatus"], "UNPROVEN")
        self.assertEqual(report["gates"][0]["resources"]["disposition"], "QUALIFY_AT_OWNER")
        self.assertEqual(report["implementations"][0]["disposition"], "REUSE_IMPLEMENTATION")
        self.assertNotEqual(report["digest"], self.prepare(policy="development")["digest"])

    def test_missing_action_stops_then_original_owner_enhancement_can_run(self):
        self.actions.write_text("def another_action():\n    return 1\n")
        report = self.prepare()
        self.assertEqual(report["implementations"][0]["owner"], "actions.py#journey")
        with self.assertRaisesRegex(ExecutionBudgetError, "ENHANCE_REQUIRED"):
            require_ready(report)
        self.actions.write_text("def journey():\n    return 2\n")
        require_ready(self.prepare())

    def test_stub_empty_journey_and_read_budget_do_not_claim_implementation(self):
        for body in ["pass", "...", "raise NotImplementedError()"]:
            self.actions.write_text(f"def journey():\n    {body}\n")
            self.assertFalse(self.prepare()["ready"])
        self.definitions["selected"]["e2e"]["journeys"] = []
        self.assertFalse(self.prepare()["ready"])
        with self.assertRaisesRegex(ExecutionBudgetError, "time budget"):
            prepare_e2e(
                self.definitions, compile_graph(self.definitions, ["selected"]), SOURCE,
                repo_root=self.root, catalog_path=self.catalog,
                execution_policy="acceptance", timeout_seconds=1e-9,
            )

    def test_unreferenced_cycle_and_path_escape_are_rejected(self):
        self.definitions["selected"]["e2e"]["implementations"].append(
            declaration("actions.py#unused", dependencies=["actions.py#unused"]),
        )
        with self.assertRaisesRegex(ExecutionBudgetError, "cycle"):
            self.prepare()
        self.definitions["selected"]["e2e"]["implementations"] = [declaration("../other.py#action")]
        with self.assertRaisesRegex(ExecutionBudgetError, "invalid"):
            self.prepare()

    def test_undeclared_dependency_is_a_gap_and_does_not_select_another_gate(self):
        self.definitions["selected"]["e2e"]["implementations"][0]["dependsOn"] = ["other.py#login"]
        self.definitions["unrelated"]["e2e"]["implementations"] = [declaration("other.py#login")]
        report = self.prepare()
        self.assertFalse(report["ready"])
        self.assertEqual(report["dispatchGateIds"], ["selected"])
        self.assertIn("other.py#login", [item["owner"] for item in report["implementations"]])

    def test_cycles_lifetime_inversion_and_cross_gate_lifecycle_drift_fail(self):
        cases = []
        for dependencies, lifetime in [
            (["actions.py#journey"], "scenario"),
            (["actions.py#login"], "suite"),
        ]:
            definitions = copy.deepcopy(self.definitions)
            definitions["selected"]["e2e"]["implementations"] = [
                declaration(dependencies=dependencies, lifetime=lifetime),
                declaration("actions.py#login", lifetime="scenario"),
            ]
            cases.append((definitions, ["selected"]))
        definitions = copy.deepcopy(self.definitions)
        definitions["unrelated"]["e2e"]["implementations"][0]["lifetime"] = "suite"
        cases.append((definitions, ["selected", "unrelated"]))
        for definitions, selected in cases:
            with self.subTest(selected=selected), self.assertRaises(ExecutionBudgetError):
                prepare_e2e(
                    definitions, compile_graph(definitions, selected), SOURCE,
                    repo_root=self.root, catalog_path=self.catalog, execution_policy="acceptance",
                )

    def test_rechecks_source_catalog_implementation_and_child_scope(self):
        report = self.prepare()
        with mock.patch("tooling.acceptance.core.evidence_store.source_identity", return_value=SOURCE):
            with mock.patch.dict(os.environ, {PREFLIGHT_ENV: preflight_binding(report)}):
                self.assertEqual(preflight_gate_entry("selected", repo_root=self.root), report)
                with self.assertRaisesRegex(ExecutionBudgetError, "outside"):
                    preflight_gate_entry("unrelated", repo_root=self.root)
                self.actions.write_text("def journey():\n    return 3\n")
                with self.assertRaisesRegex(ExecutionBudgetError, "changed"):
                    preflight_gate_entry("selected", repo_root=self.root)
        with self.assertRaisesRegex(ExecutionBudgetError, "source changed"):
            revalidate_preflight(report, {**SOURCE, "workspaceDigest": "changed"}, repo_root=self.root)
        with self.assertRaisesRegex(ExecutionBudgetError, "changed"):
            revalidate_preflight(report, SOURCE, repo_root=self.root)

    def test_gate_checks_before_concrete_constructor_and_before_execution(self):
        from tooling.acceptance.core.gate import AcceptanceGate

        acquired = []
        test_root = self.root

        class JourneyGate(AcceptanceGate):
            gate_id = "selected"

            def __init__(self):
                acquired.append("client")
                super().__init__()
                self.report_path = test_root / "gate-result.json"
                self.register_driver(mock.Mock(stop=lambda: acquired.append("cleanup")))

            def run(self):
                acquired.append("action")
                return {}

        report = self.prepare()
        with (
            mock.patch("tooling.acceptance.core.evidence_store.source_identity", return_value=SOURCE),
            mock.patch("tooling.acceptance.core.gate.preflight_gate_entry",
                       partial(preflight_gate_entry, repo_root=self.root)),
            mock.patch.dict(os.environ, {PREFLIGHT_ENV: preflight_binding(report)}),
        ):
            self.actions.write_text("def unrelated():\n    return 1\n")
            with self.assertRaises(ExecutionBudgetError):
                JourneyGate()
            self.assertFalse(acquired)
            self.actions.write_text("raise RuntimeError('must never import')\ndef journey():\n    return 1\n")
            gate = JourneyGate()
            self.actions.write_text("def journey():\n    return 2\n")
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(gate.execute(), 1)
            self.assertEqual(acquired, ["client", "cleanup"])

    def test_source_gate_does_not_trigger_e2e_and_planner_uses_same_declaration(self):
        self.definitions["source-e2e-looking-name"] = {"command": "true"}
        report = self.prepare(["source-e2e-looking-name"])
        self.assertEqual(report["gates"], [{"gateId": "source-e2e-looking-name", "disposition": "NOT_DECLARED"}])
        planner = module_at("e2e_planner", "acceptance-plan.py")
        runner = module_at("e2e_runner", "acceptance-run.py")
        validator = module_at("e2e_validator", "acceptance-validate.py")
        projection = planner.planned_gate("selected", self.definitions["selected"])
        self.assertEqual(projection["e2e"], runner.gate_from_definition("selected", self.definitions["selected"])["e2e"])
        validator.validate_gate_launch("selected", self.definitions["selected"])
        projection["e2e"] = {"journeys": [], "implementations": []}
        with self.assertRaisesRegex(SystemExit, "stale"):
            runner.plan_gate_from_entry(projection, self.definitions)

    def test_preview_allocates_no_store_and_never_provisions_in_both_modes(self):
        runner = module_at("e2e_preview_runner", "acceptance-run.py")
        for policy in ["acceptance", "development"]:
            args = ["acceptance-run.py", "--gates", str(self.catalog), "--gate", "selected", "--dry-run"]
            if policy == "development":
                args.extend(["--execution-policy", policy, "--work-item", "hook-preview"])
            output = io.StringIO()
            with (
                mock.patch.object(runner, "REPO_ROOT", self.root),
                mock.patch.object(sys, "argv", args),
                mock.patch("tooling.acceptance.core.source_identity", return_value=SOURCE),
                mock.patch.object(EvidenceStore, "__init__", side_effect=AssertionError("store allocated")),
                mock.patch.object(runner.subprocess, "run", side_effect=AssertionError("Gate launched")),
                contextlib.redirect_stdout(output),
            ):
                self.assertEqual(runner.main(), 0)
            preview = json.loads(next(line.removeprefix("preview: ") for line in output.getvalue().splitlines() if line.startswith("preview: ")))
            self.assertEqual(preview["executionPolicy"], policy)
            self.assertEqual(preview["e2ePreflight"]["dispatchGateIds"], ["selected"])

    def test_interrupted_preparation_retains_full_scope_without_dispatch(self):
        runner = module_at("e2e_interrupted_runner", "acceptance-run.py")
        policy = self.root / "budget.json"
        policy.write_text(json.dumps({
            "requestSeconds": 20, "planningSeconds": 5,
            "lifecycle": {"cleanupSeconds": 1, "publishSeconds": 1}, "gates": {},
        }))
        artifacts = self.root.parent / (self.root.name + "-evidence")
        self.addCleanup(lambda: __import__("shutil").rmtree(artifacts, ignore_errors=True))
        args = [
            "acceptance-run.py", "--gates", str(self.catalog), "--gate", "selected",
            "--execution-budget", str(policy),
        ]
        with (
            mock.patch.object(runner, "REPO_ROOT", self.root),
            mock.patch.object(sys, "argv", args),
            mock.patch("tooling.acceptance.core.source_identity", return_value=SOURCE),
            mock.patch.object(runner, "prepare_e2e", side_effect=KeyboardInterrupt),
            mock.patch.dict(os.environ, {"PT_ACCEPTANCE_ARTIFACT_ROOT": str(artifacts)}),
            contextlib.redirect_stdout(io.StringIO()),
            contextlib.redirect_stderr(io.StringIO()),
        ):
            self.assertEqual(runner.main(), 1)
        report = json.loads(next(artifacts.rglob("reports/run.json")).read_text())
        self.assertEqual([item["id"] for item in report["results"]], ["selected"])
        self.assertEqual(report["executionBudget"]["dispatchedGateCount"], 0)
        self.assertEqual(report["executionBudget"]["stop"]["reason"], "OWNER_INTERRUPTED")


class E2EManualExecutionTest(unittest.TestCase):
    """Real processes exercise shared runner ordering and original-owner repair."""

    def test_no_ide_repair_rerun_shared_dependency_and_development_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root = base / "source"
            root.mkdir()
            actions = root / "actions.py"
            actions.write_text("def missing_action():\n    return 1\n")
            events = base / "events.jsonl"
            gate_script = root / "gate.py"
            gate_script.write_text(
                f"import sys, json\nfrom pathlib import Path\nsys.path.insert(0, {str(REPO_ROOT)!r})\n"
                "from tooling.acceptance.core.e2e_preflight import preflight_gate_entry\n"
                "gate_id = sys.argv[1]\n"
                f"report = preflight_gate_entry(gate_id, repo_root=Path({str(root)!r}))\n"
                f"with Path({str(events)!r}).open('a') as stream:\n"
                "    stream.write(json.dumps({'gateId': gate_id, 'preflight': report['ready']}) + '\\n')\n"
            )
            definitions = {}
            for gate_id in ("shared", "first", "second", "unrelated"):
                definition = gate_definition()
                definition["argv"] = [sys.executable, str(gate_script), gate_id]
                definition.pop("command")
                if gate_id in ("first", "second"):
                    definition["dependsOn"] = ["shared"]
                definitions[gate_id] = definition
            catalog = root / "gates.json"
            catalog.write_text(json.dumps({"gates": definitions}))
            wrapper = base / "invoke.py"
            wrapper.write_text(
                f"import sys, importlib.util\nfrom pathlib import Path\nsys.path.insert(0, {str(REPO_ROOT)!r})\n"
                f"spec = importlib.util.spec_from_file_location('runner', {str(REPO_ROOT / 'tooling/scripts/acceptance-run.py')!r})\n"
                "runner = importlib.util.module_from_spec(spec)\nspec.loader.exec_module(runner)\n"
                f"runner.REPO_ROOT = Path({str(root)!r})\nraise SystemExit(runner.main())\n"
            )
            environment = synthetic_git_environment()
            run_synthetic_git(root, "init", environment=environment)
            run_synthetic_git(root, "add", "actions.py", "gate.py", "gates.json", environment=environment)
            environment.update({
                "GIT_AUTHOR_NAME": "Fixture", "GIT_AUTHOR_EMAIL": "fixture@example.invalid",
                "GIT_COMMITTER_NAME": "Fixture", "GIT_COMMITTER_EMAIL": "fixture@example.invalid",
            })
            run_synthetic_git(root, "commit", "-m", "Synthetic E2E source", environment=environment)
            environment.update({
                "PATH": str(Path(sys.executable).parent) + os.pathsep + environment["PATH"],
                "PT_ACCEPTANCE_ARTIFACT_ROOT": str(base / "acceptance"),
                "PT_MACHINE_DEV_ROOT": str(base / "development"),
                "PYTHONDONTWRITEBYTECODE": "1",
            })
            command = [
                sys.executable, "-B", str(wrapper), "--gates", str(catalog),
                "--gate", "first", "--gate", "second",
            ]
            failed = subprocess.run(command, cwd=root, env=environment, capture_output=True, text=True, timeout=30)
            self.assertNotEqual(failed.returncode, 0, failed.stdout + failed.stderr)
            self.assertIn("ENHANCE_REQUIRED", failed.stderr)
            self.assertFalse(events.exists())
            self.assertFalse((base / "acceptance").exists())
            actions.write_text("def journey():\n    return 1\n")
            completed = subprocess.run(command, cwd=root, env=environment, capture_output=True, text=True, timeout=30)
            self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
            observations = [json.loads(line) for line in events.read_text().splitlines()]
            self.assertEqual([item["gateId"] for item in observations], ["shared", "first", "second"])
            self.assertTrue(all(item["preflight"] for item in observations))
            store = EvidenceStore(base / "acceptance", worktree=root)
            from tooling.acceptance.core import ArtifactRef
            manifest = store.latest("acceptance-run")
            report = store.read_json(ArtifactRef.from_dict(manifest["artifacts"]["e2e-preflight"]))
            self.assertEqual(report["dispatchGateIds"], ["shared", "first", "second"])
            self.assertEqual(report["proofStatus"], "UNPROVEN")
            development = subprocess.run(
                [*command, "--execution-policy", "development", "--work-item", "hook-manual"],
                cwd=root, env=environment, capture_output=True, text=True, timeout=30,
            )
            self.assertEqual(development.returncode, 0, development.stdout + development.stderr)
            self.assertIn("Development Functional Run", development.stdout)
            self.assertEqual(len(events.read_text().splitlines()), 6)
            dev_report_ref = json.loads(next(
                line.removeprefix("run: ") for line in development.stdout.splitlines()
                if line.startswith("run: ")
            ))
            development_store = EvidenceStore(
                base / "development" / "workspaces" / store.workspace_id
                / "workflow" / "hook-manual" / "artifacts", worktree=root,
            )
            dev_report = development_store.read_json(ArtifactRef.from_dict(dev_report_ref))
            refs, missing = prerequisite_results(
                {"id": "consumer", "dependsOn": ["shared"]}, dev_report["results"],
                dev_report["source"], development_store, execution_policy="development",
            )
            self.assertFalse(missing)
            self.assertIn("developmentManifest", refs[0])
            self.assertEqual(prerequisite_results(
                {"id": "consumer", "dependsOn": ["shared"]}, dev_report["results"],
                dev_report["source"], development_store,
            )[1], ["shared"])
            with self.assertRaises(ExecutionBudgetError):
                prerequisite_results(
                    {"id": "consumer", "dependsOn": ["shared"]}, dev_report["results"],
                    {**dev_report["source"], "commit": "changed"}, development_store,
                    execution_policy="development",
                )


if __name__ == "__main__":
    unittest.main()
