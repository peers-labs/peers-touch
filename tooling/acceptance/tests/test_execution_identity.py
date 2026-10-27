"""Owner input closure against real children and the canonical Session Runner."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

from tooling.acceptance.core import ArtifactRef, EvidenceStore
from tooling.acceptance.core.execution_identity import (
    InputIdentityError, observe_gate_inputs, validate_execution_inputs,
)
from tooling.acceptance.core.execution_budget import ExecutionDeadline, GateExecution, GateTimeLimits
from tooling.acceptance.input_owners.source_toolchain import source_observation, tree_digest
from tooling.acceptance.input_owners.installed_inputs import executable_input


REPO_ROOT = Path(__file__).resolve().parents[3]
PROBE_PROGRAM = (
    "import hashlib,json,os;from pathlib import Path;"
    "c=json.loads(os.environ['PT_ACCEPTANCE_INPUT_CONTEXT']);"
    "h=hashlib.sha256(Path(os.environ['INPUT_FILE']).read_bytes()).hexdigest();"
    "assert 'UNDECLARED_SECRET' not in os.environ;"
    "print(json.dumps({'artifactKind':'acceptance-gate-input-observation',"
    "'gateId':c['gate']['id'],'ownerId':'fixture-inputs',"
    "'inputs':{k:h for k in ('runtime','provider','oracle','actionPlan','fixture')}}))"
)


def declared_gate(argv, *, probe_program=PROBE_PROGRAM):
    return {
        "argv": argv, "environment": "local", "tier": "ci-cheap",
        "executionInputs": {
            "environmentKeys": ["INPUT_FILE"],
            "identityProbe": {
                "ownerId": "fixture-inputs",
                "argv": [sys.executable, "-c", probe_program], "timeoutSeconds": 1,
            },
        },
    }


class InputIdentityTest(unittest.TestCase):
    def test_current_material_inputs_change_without_exposing_secret_values(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            input_file = root / "input"
            input_file.write_text("private-fixture-value")
            gate = {"id": "producer", **declared_gate([sys.executable, "-c", "pass"])}
            environment = {
                **os.environ, "INPUT_FILE": str(input_file),
                "UNDECLARED_SECRET": "must-not-be-inherited",
            }
            first = observe_gate_inputs(gate, environment, repo_root=root, context={"gate": gate})
            self.assertNotIn("private-fixture-value", json.dumps(first))
            input_file.write_text("changed-private-fixture")
            second = observe_gate_inputs(gate, environment, repo_root=root, context={"gate": gate})
            self.assertNotEqual(first, second)

    def test_incomplete_duplicate_wrong_identity_and_failed_observations_reject(self):
        for program in (
            "print('{}')",
            "print('{\"gateId\":\"first\",\"gateId\":\"second\"}')",
            PROBE_PROGRAM.replace("'fixture-inputs'", "'wrong-owner'"),
            PROBE_PROGRAM.replace("c['gate']['id']", "'wrong-gate'"),
            PROBE_PROGRAM.replace("'runtime','provider','oracle','actionPlan','fixture'",
                                  "'runtime','provider','oracle','actionPlan'"),
            "raise SystemExit(2)",
            "import time;time.sleep(5)",
        ):
            with self.subTest(program=program), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                input_file = root / "input"
                input_file.write_text("fixture")
                gate = {"id": "producer", **declared_gate(
                    [sys.executable, "-c", "pass"], probe_program=program,
                )}
                with self.assertRaises(InputIdentityError):
                    observe_gate_inputs(
                        gate, {**os.environ, "INPUT_FILE": str(input_file)},
                        repo_root=root, context={"gate": gate},
                    )

    def test_live_contract_requires_owner_and_rejects_runner_input_inheritance(self):
        gate = declared_gate([sys.executable, "-c", "pass"])
        gate.update(environment="synthetic-live", provisioner="synthetic-live")
        validate_execution_inputs("producer", gate)
        gate["executionInputs"].pop("identityProbe")
        with self.assertRaises(ValueError):
            validate_execution_inputs("producer", gate)
        gate = declared_gate([sys.executable, "-c", "pass"])
        gate["executionInputs"]["environmentKeys"].append("PT_ACCEPTANCE_INPUT_CONTEXT")
        with self.assertRaises(ValueError):
            validate_execution_inputs("producer", gate)

    def test_request_cancellation_reaps_probe_inside_fixed_cleanup_tail(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            marker = root / "child-pid"
            program = (
                "import os,time;from pathlib import Path;"
                f"Path({str(marker)!r}).write_text(str(os.getpid()));time.sleep(10)"
            )
            gate = {"id": "probe", **declared_gate(
                [sys.executable, "-c", "pass"], probe_program=program,
            )}
            gate["executionInputs"]["identityProbe"]["timeoutSeconds"] = 10
            execution = GateExecution(
                "probe", GateTimeLimits(1, 1), time.monotonic() + 0.25,
            )
            with self.assertRaises(ExecutionDeadline) as interrupted:
                observe_gate_inputs(
                    gate, os.environ, repo_root=root, context={"gate": gate},
                    execution=execution,
                )
            self.assertEqual(interrupted.exception.phase, "work")
            self.assertEqual(interrupted.exception.constraints[0]["kind"], "request-work")
            pid = int(marker.read_text())
            with self.assertRaises(ProcessLookupError):
                os.kill(pid, 0)
            spans = execution.report()["spans"]
            self.assertTrue(any(item["phase"] == "cleanup" for item in spans))

    def test_probe_timeout_with_confirmed_cleanup_does_not_end_request_work(self):
        gate = {"id": "probe", **declared_gate(
            [sys.executable, "-c", "pass"], probe_program="import time;time.sleep(10)",
        )}
        gate["executionInputs"]["identityProbe"]["timeoutSeconds"] = 0.05
        execution = GateExecution("probe", GateTimeLimits(1, 1), time.monotonic() + 2)
        with self.assertRaises(InputIdentityError):
            observe_gate_inputs(
                gate, os.environ, repo_root=REPO_ROOT, context={"gate": gate},
                execution=execution,
            )
        with execution.stage("next-candidate"):
            pass
        self.assertIsNone(execution.report()["overrun"])

    @unittest.skipUnless(sys.platform == "darwin", "macOS installation input owner")
    def test_installed_code_and_tool_bytes_are_inputs_but_vitest_output_is_not(self):
        with tempfile.TemporaryDirectory(dir=REPO_ROOT / ".local") as temporary:
            root = Path(temporary)
            dependencies = root / "node_modules"
            dependencies.mkdir()
            source = dependencies / "package.js"
            source.write_text("export const value = 1")
            linked = dependencies / "linked.js"
            linked.symlink_to("package.js")
            first = tree_digest(dependencies)
            cache = dependencies / ".vite"
            cache.mkdir()
            (cache / "results.json").write_text("test output")
            self.assertEqual(first, tree_digest(dependencies))
            source.write_text("export const value = 2")
            self.assertNotEqual(first, tree_digest(dependencies))
            tool = root / "tool"
            shutil.copyfile("/usr/bin/true", tool)
            tool.chmod(0o700)
            context = {"gate": {"id": "source"}, "source": {"commit": "source"},
                       "contextDigest": "candidate"}
            relative = str(dependencies.relative_to(REPO_ROOT))
            tool_relative = str(tool.relative_to(REPO_ROOT))

            def observation():
                completed = subprocess.run(
                    [sys.executable, "-m", "tooling.acceptance.input_owners.source_toolchain",
                     "--gate", "source", "--file", tool_relative, "--tree", relative,
                     "--python-package", "yaml"],
                    cwd=REPO_ROOT, capture_output=True, text=True, timeout=15,
                    env={**os.environ, "PT_ACCEPTANCE_INPUT_CONTEXT": json.dumps(context),
                         "PYTHONDONTWRITEBYTECODE": "1"},
                )
                self.assertEqual(completed.returncode, 0, completed.stderr)
                return json.loads(completed.stdout)

            before = observation()
            before_executable = executable_input(str(tool))
            source.write_text("export const value = 3")
            changed_dependency = observation()
            self.assertNotEqual(
                before["inputs"]["runtime"], changed_dependency["inputs"]["runtime"],
            )
            with tool.open("ab") as stream:
                stream.write(b"changed executable input")
            after = observation()
            self.assertNotEqual(before_executable, executable_input(str(tool)))
            self.assertNotEqual(
                changed_dependency["inputs"]["runtime"], after["inputs"]["runtime"],
            )
            shim = root / "shim"
            shim.write_text(f"#!/bin/sh\nexec '{tool}' \"$@\"\n")
            shim.chmod(0o700)
            with self.assertRaises(ValueError):
                executable_input(str(shim))
            (dependencies / "workspace").symlink_to(root)
            with self.assertRaises(ValueError):
                tree_digest(dependencies)

    def test_source_owner_rejects_live_and_provisioned_inputs(self):
        for extra in (
            {"environment": "live"}, {"provisioner": "runtime"},
            {"requiredRuntimeCells": ["native"]}, {"ephemeralCapabilities": ["runtime"]},
        ):
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                source_observation(
                    "source", {"gate": {"id": "source", **extra},
                               "source": {"commit": "source"}, "contextDigest": "candidate"},
                    root=REPO_ROOT, tools=[], trees=[], files=[],
                )
        with self.assertRaises(ValueError):
            source_observation(
                "source", {"gate": {"id": "source"}, "source": {"commit": "source"},
                           "contextDigest": "candidate"},
                root=REPO_ROOT, tools=["cargo"], trees=[], files=[],
            )

    def runner_fixture(
        self, root, *, mutate_during=False, cleanup_failure_at=None, stop_on_failure=True,
    ):
        source = root / "source"
        source.mkdir()
        (source / "README.md").write_text("synthetic source")
        (source / ".gitignore").write_text(".local/\n")
        for args in (
            ("init", "-q"), ("add", "README.md", ".gitignore"),
            ("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
             "-c", "core.hooksPath=/dev/null", "commit", "-qm", "fixture"),
        ):
            subprocess.run(["git", *args], cwd=source, capture_output=True, check=True, timeout=5)
        input_file, calls, second_calls = (root / name for name in ("input", "calls", "second"))
        input_file.write_text("fixture")
        producer_program = (
            f"from pathlib import Path;p=Path({str(calls)!r});"
            "p.write_text(p.read_text()+'x' if p.exists() else 'x');"
            + (f"Path({str(input_file)!r}).write_text('changed')" if mutate_during else "")
        )
        catalog, policy = root / "catalog.json", root / "policy.json"
        catalog.write_text(json.dumps({"gates": {
            "producer": declared_gate([sys.executable, "-c", producer_program]),
            "second": {
                "argv": [sys.executable, "-c",
                         f"from pathlib import Path;import time;p=Path({str(second_calls)!r});"
                         "first=not p.exists();p.write_text(p.read_text()+'x' if p.exists() else 'x');"
                         "time.sleep(10 if first else 0)"],
                "tier": "ci-cheap",
            },
            "consumer": {"judgment": "all-prerequisites", "dependsOn": ["producer", "second"],
                         "tier": "ci-cheap"},
        }}))
        policy.write_text(json.dumps({
            "requestSeconds": 3, "planningSeconds": 1.5,
            "lifecycle": {"cleanupSeconds": 1, "publishSeconds": 1}, "gates": {},
        }))
        program = (
            "import importlib.util,sys,os;from pathlib import Path;"
            f"s=importlib.util.spec_from_file_location('runner',{str(REPO_ROOT / 'tooling/scripts/acceptance-run.py')!r});"
            "m=importlib.util.module_from_spec(s);s.loader.exec_module(m);"
            f"m.REPO_ROOT=Path({str(source)!r});"
            "sys.argv=['acceptance-run.py',*sys.argv[1:]];raise SystemExit(m.main())"
        )
        # Inject a typed failure at the public process boundary. No production
        # hook or real leaked resource is needed to exercise durable stop semantics.
        harness = """
from tooling.acceptance.core.launch_context import GateProcessLauncher
from tooling.acceptance.core.errors import EphemeralLaunchCleanupFailed
original_launch = GateProcessLauncher.run
probe_count = 0
def launch(self, spec, binding, **kwargs):
    global probe_count
    if any('PT_ACCEPTANCE_INPUT_CONTEXT' in arg for arg in spec.argv):
        probe_count += 1
        if probe_count == int(os.environ.get('SYNTHETIC_INPUT_CLEANUP_FAILURE', '0')):
            raise EphemeralLaunchCleanupFailed('synthetic cleanup failure', operation='gate_process')
    return original_launch(self, spec, binding, **kwargs)
GateProcessLauncher.run = launch
"""
        program = program.replace(
            "sys.argv=['acceptance-run.py'",
            "\n" + harness + "\nsys.argv=['acceptance-run.py'",
        )
        command = [sys.executable, "-B", "-c", program, "--gates", str(catalog),
                   "--execution-budget", str(policy), "--gate", "consumer"]
        if stop_on_failure:
            command.append("--stop-on-failure")
        environment = {
            **os.environ, "INPUT_FILE": str(input_file),
            "PT_ACCEPTANCE_ARTIFACT_ROOT": str(root / "evidence"),
        }
        if cleanup_failure_at is not None:
            environment["SYNTHETIC_INPUT_CLEANUP_FAILURE"] = str(cleanup_failure_at)
        first = subprocess.run(command, cwd=REPO_ROOT, env=environment,
                               capture_output=True, text=True, timeout=10)
        store = EvidenceStore(root / "evidence", worktree=source)
        latest = store.latest("acceptance-run")
        report = store.read_json(ArtifactRef.from_dict(latest["artifacts"]["run"]))
        session = store.read_json(ArtifactRef.from_dict(latest["artifacts"]["execution-session"]))
        manifest = store.workspace_dir / "acceptance-run" / latest["runId"] / "manifest.json"
        reference = ArtifactRef(
            latest["workspaceId"], "acceptance-run", latest["runId"], "manifest.json",
            hashlib.sha256(manifest.read_bytes()).hexdigest(), "application/json",
        )
        resume = root / "resume.json"
        resume.write_text(json.dumps(reference.to_dict()))
        return command + ["--resume-session", str(resume)], environment, store, first, report, session

    def test_probe_cleanup_failure_stops_before_work_and_after_work_without_stop_flag(self):
        for failure_at in (1, 2):
            with self.subTest(failure_at=failure_at), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                _, _, _, completed, report, session = self.runner_fixture(
                    root, cleanup_failure_at=failure_at, stop_on_failure=False,
                )
                self.assertNotEqual(completed.returncode, 0, completed.stdout + completed.stderr)
                self.assertEqual(session["state"], "PAUSED_REPAIR_REQUIRED")
                producer = report["results"][0]
                self.assertEqual(producer["cleanupStatus"], "failed")
                self.assertEqual(producer["proofStatus"], "UNPROVEN")
                self.assertFalse((root / "second").exists())
                self.assertEqual((root / "calls").exists(), failure_at == 2)
                self.assertNotIn("runManifest", report["results"][1])

    def test_resume_cleanup_failure_consumes_request_and_seals_full_scope_stop(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            command, environment, store, _, _, _ = self.runner_fixture(root)
            environment["SYNTHETIC_INPUT_CLEANUP_FAILURE"] = "1"
            resumed = subprocess.run(command, cwd=REPO_ROOT, env=environment,
                                     capture_output=True, text=True, timeout=10)
            self.assertNotEqual(resumed.returncode, 0)
            latest = store.latest("acceptance-execution-stop")
            report = store.read_json(ArtifactRef.from_dict(latest["artifacts"]["run"]))
            ledger = store.read_json(ArtifactRef.from_dict(latest["artifacts"]["execution-session"]))
            self.assertEqual(ledger["state"], "PAUSED_REPAIR_REQUIRED")
            self.assertEqual(len(ledger["requests"]), 2)
            self.assertEqual({item["id"] for item in report["results"]},
                             {"producer", "second", "consumer"})
            stop = report["executionBudget"]["stop"]
            self.assertEqual(stop["reason"], "INPUT_OWNER_CLEANUP_STOP")
            self.assertEqual(stop["resourceCleanup"], "failed")
            self.assertEqual(stop["inputOwner"], {"gateId": "producer", "ownerId": "fixture-inputs"})
            self.assertEqual((root / "calls").read_text(), "x")
            self.assertEqual((root / "second").read_text(), "xx")
            second = next(item for item in report["results"] if item["id"] == "second")
            self.assertEqual(second["proofStatus"], "PROVEN")
            self.assertEqual(report["executionBudget"]["dispatchedGateCount"], 1)
            producer = next(item for item in report["results"] if item["id"] == "producer")
            self.assertEqual(producer["cleanupStatus"], "failed")
            self.assertNotIn("runManifest", producer)
            self.assertNotIn("runManifest", next(
                item for item in report["results"] if item["id"] == "consumer"
            ))
            replay = subprocess.run(command, cwd=REPO_ROOT, env=environment,
                                    capture_output=True, text=True, timeout=10)
            self.assertNotEqual(replay.returncode, 0)
            self.assertEqual((root / "calls").read_text(), "x")
            self.assertEqual((root / "second").read_text(), "xx")

    def test_real_requests_revalidate_owner_before_reusing_original_producer(self):
        for drift in (False, True):
            with self.subTest(drift=drift), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                command, environment, store, first, original, session = self.runner_fixture(root)
                self.assertEqual(session["state"], "PAUSED_REQUEST_EXHAUSTED",
                                 first.stdout + first.stderr)
                original_producer = original["results"][0]
                if drift:
                    (root / "input").write_text("changed")
                resumed = subprocess.run(command, cwd=REPO_ROOT, env=environment,
                                         capture_output=True, text=True, timeout=10)
                self.assertEqual(resumed.returncode, 0, resumed.stdout + resumed.stderr)
                latest = store.latest("acceptance-run")
                report = store.read_json(ArtifactRef.from_dict(latest["artifacts"]["run"]))
                ledger = store.read_json(ArtifactRef.from_dict(latest["artifacts"]["execution-session"]))
                self.assertEqual(ledger["state"], "QUALIFIED")
                self.assertEqual(ledger["requiredGateIds"], ["producer", "second", "consumer"])
                producer = next(item for item in report["results"] if item["id"] == "producer")
                self.assertEqual((root / "calls").read_text(), "xx" if drift else "x")
                self.assertEqual(producer["runManifest"] == original_producer["runManifest"], not drift)
                consumer = next(item for item in report["results"] if item["id"] == "consumer")
                self.assertEqual(consumer["prerequisiteProofs"][0]["runManifest"],
                                 producer["runManifest"])
                self.assertEqual((root / "second").read_text(), "xx")

    def test_material_change_during_work_prevents_current_input_proof(self):
        with tempfile.TemporaryDirectory() as temporary:
            _, _, _, completed, report, session = self.runner_fixture(
                Path(temporary), mutate_during=True,
            )
            self.assertNotEqual(completed.returncode, 0)
            self.assertEqual(session["state"], "PAUSED_REPAIR_REQUIRED")
            producer = report["results"][0]
            self.assertEqual(producer["proofStatus"], "UNPROVEN")
            self.assertEqual(producer["inputIdentityStatus"], "UNPROVEN")
            self.assertNotIn("runManifest", report["results"][1])


if __name__ == "__main__":
    unittest.main()
