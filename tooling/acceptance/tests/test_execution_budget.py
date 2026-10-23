"""Synthetic cancellation, reserve, selection and real-runner regression cases."""

from __future__ import annotations

import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

from tooling.acceptance.core.execution_budget import (
    ExecutionBudgetError,
    ExecutionDeadline,
    ExecutionBudgetPolicy,
    GateTimeLimits,
    GateExecution,
    deadline,
    freeze_scope,
    stopped_results,
)
from tooling.acceptance.core.launch_context import GateLaunchSpec, GateProcessLauncher
from tooling.acceptance.core.errors import EphemeralLaunchTimeout


REPO_ROOT = Path(__file__).resolve().parents[3]


@unittest.skipUnless(hasattr(signal, "setitimer"), "POSIX cancellation owner")
class ExecutionBudgetTest(unittest.TestCase):
    def execution(self, work=0.1, cleanup=0.1, publish=0.1):
        return GateExecution("synthetic", GateTimeLimits(cleanup, publish, work),
                             time.monotonic() + 10)

    def test_invalid_reserve_and_nonfinite_deadline_rejected(self):
        for value in [
            {"totalSeconds": 1, "cleanupSeconds": 1, "publishSeconds": 1},
            {"cleanupSeconds": float("inf"), "publishSeconds": 1},
            {"cleanupSeconds": True, "publishSeconds": 1},
            {"cleanupSeconds": 1, "publishSeconds": 1, "workSeconds": 0},
            {"cleanupSeconds": 1, "publishSeconds": 1, "operations": {"read": -1}},
        ]:
            with self.assertRaises(ExecutionBudgetError):
                GateTimeLimits.from_dict(value)

    def test_polling_cannot_swallow_cancellation(self):
        execution = self.execution()
        probes = []

        def polling():
            while True:
                try:
                    probes.append(1)
                    time.sleep(0.01)
                    raise ValueError("retryable synthetic probe")
                except Exception:
                    continue

        with self.assertRaises(ExecutionDeadline):
            execution.call("pending", polling)
        self.assertLess(len(probes), 30)
        self.assertEqual(execution.report()["overrun"]["stage"], "pending")

    def test_sequential_calls_share_work_deadline_and_cleanup_survives(self):
        execution = self.execution()
        execution.call("first", time.sleep, 0.06)
        with self.assertRaises(ExecutionDeadline):
            execution.call("second", time.sleep, 0.07)
        completed = []
        execution.call("cleanup", completed.append, "clean", phase="cleanup")
        execution.call("publish", completed.append, "published", phase="publish")
        self.assertEqual(completed, ["clean", "published"])
        self.assertEqual(execution.report()["state"], "OVER_BUDGET")
        with self.assertRaises(ExecutionBudgetError):
            execution.call("retry-work", lambda: None)

    def test_cleanup_calls_share_reserve_and_publish_has_own_reserve(self):
        execution = self.execution(work=0.3)
        execution.call("cleanup-first", time.sleep, 0.06, phase="cleanup")
        with self.assertRaises(ExecutionDeadline):
            execution.call("cleanup-second", time.sleep, 0.07, phase="cleanup")
        execution.call("publish", lambda: None, phase="publish")
        self.assertEqual(execution.report()["attribution"], "ARCHITECTURE_OVERHEAD")

    def test_outer_timer_is_not_extended_by_inner_call(self):
        started = time.monotonic()
        previous = signal.getsignal(signal.SIGALRM)
        with self.assertRaises(ExecutionDeadline) as cancelled:
            with deadline(0.06, ExecutionDeadline("outer", "outer", "work")):
                with deadline(0.2, ExecutionDeadline("inner", "inner", "work")):
                    time.sleep(0.2)
        self.assertEqual(
            (cancelled.exception.gate_id, cancelled.exception.stage,
             cancelled.exception.phase),
            ("outer", "outer", "work"),
        )
        self.assertLess(time.monotonic() - started, 0.15)
        self.assertEqual(signal.getsignal(signal.SIGALRM), previous)
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL)[0], 0)

    def test_long_work_keeps_request_deadline_after_preparation(self):
        with mock.patch(
            "tooling.acceptance.core.execution_budget.time.monotonic"
        ) as clock:
            clock.return_value = 100
            execution = GateExecution(
                "long-flow", GateTimeLimits(30, 15), request_deadline=400,
            )
            clock.return_value = 260
            self.assertEqual(execution.remaining(), 140)
            execution.call("next-operation", lambda: None)
            clock.return_value = 280
            execution.call("cleanup", lambda: None, phase="cleanup")
            execution.call("publish", lambda: None, phase="publish")
            execution.finish()
            self.assertEqual(execution.report()["state"], "WITHIN_BUDGET")
            self.assertEqual(execution.report()["durationSeconds"], 180)

    def test_ambient_alarm_semantics_do_not_disable_operation_deadline(self):
        for handler in (signal.SIG_IGN, lambda *_: None):
            with self.subTest(handler=handler):
                previous = signal.getsignal(signal.SIGALRM)
                try:
                    signal.signal(signal.SIGALRM, handler)
                    signal.setitimer(signal.ITIMER_REAL, 0.02)
                    with self.assertRaises(ExecutionDeadline) as cancelled:
                        with deadline(0.07, ExecutionDeadline("inner", "read", "work")):
                            time.sleep(0.15)
                    self.assertEqual(cancelled.exception.gate_id, "inner")
                    self.assertEqual(signal.getsignal(signal.SIGALRM), handler)
                    self.assertEqual(signal.getitimer(signal.ITIMER_REAL)[0], 0)
                finally:
                    signal.setitimer(signal.ITIMER_REAL, 0)
                    signal.signal(signal.SIGALRM, previous)
        program = """
import signal, time
from tooling.acceptance.core.execution_budget import ExecutionDeadline, deadline
signal.signal(signal.SIGALRM, signal.SIG_DFL)
signal.setitimer(signal.ITIMER_REAL, 0.02)
with deadline(0.2, ExecutionDeadline("inner", "read", "work")):
    time.sleep(0.3)
"""
        completed = subprocess.run(
            [sys.executable, "-c", program], cwd=REPO_ROOT,
            capture_output=True, text=True, timeout=2,
        )
        self.assertEqual(completed.returncode, -signal.SIGALRM)

    def test_policy_has_no_uniform_work_limit_and_rejects_legacy_policy(self):
        policy = ExecutionBudgetPolicy({
            "requestSeconds": 3600, "planningSeconds": 5,
            "lifecycle": {"cleanupSeconds": 30, "publishSeconds": 15},
            "gates": {},
        })
        self.assertIsNone(policy.for_gate({"id": "long", "tier": "any"}).work_seconds)
        with self.assertRaises(ExecutionBudgetError):
            ExecutionBudgetPolicy({
                "requestSeconds": 3600, "planningSeconds": 5,
                "default": {"totalSeconds": 180, "cleanupSeconds": 30, "publishSeconds": 15},
                "tiers": {}, "gates": {},
            })
        with self.assertRaises(ExecutionBudgetError):
            ExecutionBudgetPolicy({
                "requestSeconds": 3600, "planningSeconds": 5,
                "lifecycle": {"cleanupSeconds": 30, "publishSeconds": 15, "workSeconds": 135},
                "gates": {},
            })

    def test_owner_operation_limit_cancels_without_renewing_request(self):
        execution = GateExecution(
            "operations", GateTimeLimits(
                0.1, 0.1, operations={"read": 0.04},
            ), time.monotonic() + 10,
        )
        with self.assertRaises(ExecutionDeadline) as cancelled:
            execution.call("read", time.sleep, 0.1)
        self.assertEqual(cancelled.exception.stage, "read")
        self.assertEqual(cancelled.exception.constraints[0]["kind"], "owner-operation")
        self.assertEqual(cancelled.exception.constraints[0]["source"], "exact Gate operations.read")
        execution.call("cleanup", lambda: None, phase="cleanup")
        execution.call("publish", lambda: None, phase="publish")
        self.assertEqual(execution.report()["performanceStatus"], "UNPROVEN")

    def test_declared_operation_and_request_limits_both_remain_fixed(self):
        configured = {"read": 0.04}
        limits = GateTimeLimits(0.1, 0.1, operations=configured)
        configured["read"] = 10
        self.assertEqual(limits.operations["read"], 0.04)
        execution = GateExecution("limits", limits, time.monotonic() + 10)
        with self.assertRaises(ExecutionDeadline):
            with execution.stage("read", timeout_seconds=1):
                time.sleep(0.1)
        self.assertEqual(execution.spans[-1]["operationLimitSeconds"], 0.04)

        with mock.patch(
            "tooling.acceptance.core.execution_budget.time.monotonic"
        ) as clock:
            clock.return_value = 100
            execution = GateExecution("progress", GateTimeLimits(30, 15), 400)
            for now in (150, 200, 250, 300, 350):
                clock.return_value = now
                execution.call("finite-operation", lambda: None)
                self.assertEqual(execution.ends["work"], 400)
            clock.return_value = 401
            with self.assertRaises(ExecutionDeadline):
                execution.call("retry", lambda: None)
            self.assertEqual(execution.report()["overrun"]["constraints"][0]["kind"], "request-work")
            execution.call("cleanup", lambda: None, phase="cleanup")
            cleanup_end = execution.ends["cleanup"]
            clock.return_value = 410
            execution.call("cleanup-second", lambda: None, phase="cleanup")
            self.assertEqual(execution.ends["cleanup"], cleanup_end)
            self.assertEqual(cleanup_end, 430)

    def test_command_cancellation_exits_work_before_shared_cleanup(self):
        execution = self.execution(work=0.12, cleanup=0.3, publish=0.1)
        output = []
        launcher = GateProcessLauncher(termination_timeout_seconds=0.2)
        program = (
            "import signal,time,sys;"
            "signal.signal(signal.SIGTERM,lambda *_:(time.sleep(0.06),sys.exit(0)));"
            "print('ready',flush=True);time.sleep(10)"
        )
        with self.assertRaises(ExecutionDeadline):
            launcher.run(
                GateLaunchSpec(
                    (sys.executable, "-c", program), 5, (),
                ), None,
                capture_output=lambda stdout, stderr: output.append(stdout + stderr),
                work_scope=lambda: execution.stage("command", timeout_seconds=5),
                cleanup_scope=lambda: execution.stage("process-cleanup", phase="cleanup"),
            )
        cleanup_end = execution.ends["cleanup"]
        execution.call("resource-cleanup", lambda: None, phase="cleanup")
        self.assertEqual(execution.ends["cleanup"], cleanup_end)
        execution.call("publish", lambda: None, phase="publish")
        self.assertEqual(len(output), 1)
        self.assertIn("ready", output[0])
        self.assertEqual(
            [(span["stage"], span["phase"], span["status"])
             for span in execution.spans],
            [("command", "work", "overrun"),
             ("process-cleanup", "cleanup", "completed"),
             ("resource-cleanup", "cleanup", "completed"),
             ("publish", "publish", "completed")],
        )

    def test_real_runner_preserves_command_protection_after_preparation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            catalog, policy = root / "catalog.json", root / "policy.json"
            marker = root / "completed"
            catalog.write_text(json.dumps({"gates": {"long-flow": {
                "argv": [
                    sys.executable, "-c",
                    "import time;from pathlib import Path;time.sleep(0.7);"
                    f"Path({str(marker)!r}).touch()",
                ],
                "timeout_seconds": 2,
            }}}))
            policy.write_text(json.dumps({
                "requestSeconds": 20, "planningSeconds": 5,
                "lifecycle": {"cleanupSeconds": 0.5, "publishSeconds": 2},
                "gates": {},
            }))
            program = f"""
import importlib.util, sys, time
import tooling.acceptance.core as core
spec = importlib.util.spec_from_file_location("bounded_runner", "tooling/scripts/acceptance-run.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
original = core.source_identity
calls = 0
def observed_source(root):
    global calls
    calls += 1
    if calls == 2:
        time.sleep(0.7)
    return original(root)
core.source_identity = observed_source
sys.argv = ["acceptance-run.py", "--gates", {str(catalog)!r},
            "--gate", "long-flow", "--execution-budget", {str(policy)!r}]
raise SystemExit(runner.main())
"""
            completed = subprocess.run(
                [sys.executable, "-c", program], cwd=REPO_ROOT,
                env={**os.environ, "PT_ACCEPTANCE_ARTIFACT_ROOT": str(root / "evidence")},
                capture_output=True, text=True, timeout=15,
            )
            self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
            self.assertTrue(marker.exists())
            path, = (root / "evidence").rglob("reports/run.json")
            report = json.loads(path.read_text())
            cost = report["executionBudget"]["gates"][0]
            self.assertIsNone(report["executionBudget"]["stop"])
            self.assertGreater(cost["durationSeconds"], 1.4)
            self.assertEqual(
                next(span["operationLimitSeconds"] for span in cost["spans"]
                     if span["stage"] == "command"), 2,
            )
            self.assertEqual(cost["performanceStatus"], "UNPROVEN")
            wall = json.loads(next(
                line.removeprefix("execution-wall-cost: ")
                for line in completed.stderr.splitlines()
                if line.startswith("execution-wall-cost: ")
            ))
            self.assertEqual(wall["handleCleanupStatus"], "passed")
            self.assertGreaterEqual(
                wall["requestDurationSeconds"],
                report["executionBudget"]["requestDurationSeconds"],
            )
            self.assertEqual(wall["requestWorkLimitSeconds"], 20)

    def test_owned_grandchild_stops_without_touching_unrelated_process(self):
        with tempfile.TemporaryDirectory() as temporary:
            marker = Path(temporary) / "late-mutation"
            descendant = (
                "import time,pathlib;time.sleep(0.5);"
                f"pathlib.Path({str(marker)!r}).write_text('unexpected')"
            )
            parent = (
                "import subprocess,sys,time;"
                f"p=subprocess.Popen([sys.executable,'-c',{descendant!r}]);"
                "time.sleep(10)"
            )
            unrelated = subprocess.Popen([sys.executable, "-c", "import time;time.sleep(10)"])
            try:
                with self.assertRaises(EphemeralLaunchTimeout):
                    GateProcessLauncher(termination_timeout_seconds=0.2).run(
                        GateLaunchSpec(argv=(sys.executable, "-c", parent),
                                       timeout_seconds=0.1, required_capabilities=()), None
                    )
                time.sleep(0.55)
                self.assertFalse(marker.exists())
                self.assertIsNone(unrelated.poll())
            finally:
                unrelated.terminate()
                unrelated.wait(timeout=2)

    def test_scope_preserves_shared_and_unmapped_and_rejects_unknown(self):
        definitions = {
            name: {"command": "true"}
            for name in ["shared", "excluded", "unmapped"]
        }
        definitions["manual"] = {
            "command": "true",
            "catalogExecution": "manual",
        }
        capabilities = [
            {"id": "one", "domain": "excluded-domain", "required_gates": ["shared", "excluded"]},
            {"id": "two", "domain": "included-domain", "required_gates": ["shared"]},
        ]
        scope = freeze_scope(definitions, capabilities,
                             excluded_domains=["excluded-domain"], excluded_gates=[])
        self.assertEqual(scope["requiredGateIds"], ["shared", "unmapped"])
        self.assertEqual(len(scope["decisions"]), len(definitions))
        self.assertEqual(
            next(
                item for item in scope["decisions"]
                if item["gateId"] == "manual"
            )["reason"],
            "manual-execution-only",
        )
        with self.assertRaises(ExecutionBudgetError):
            freeze_scope(definitions, capabilities, excluded_domains=[], excluded_gates=["unknown"])
        with self.assertRaises(ExecutionBudgetError):
            freeze_scope(definitions, [{"id": "bad", "domain": "any", "required_gates": ["missing"]}],
                         excluded_domains=[], excluded_gates=[])
        definitions["manual"]["catalogExecution"] = "sometimes"
        with self.assertRaisesRegex(
            ExecutionBudgetError,
            "invalid catalogExecution",
        ):
            freeze_scope(
                definitions,
                capabilities,
                excluded_domains=[],
                excluded_gates=[],
            )

    def test_stopped_results_never_manufacture_proof(self):
        pending = stopped_results([{"id": "first"}, {"id": "second"}], {"first"}, {"gateId": "first"})
        self.assertEqual([item["id"] for item in pending], ["second"])
        self.assertEqual(pending[0]["proofStatus"], "UNPROVEN")
        self.assertEqual(pending[0]["duration_seconds"], 0)

    def test_real_runner_stops_before_next_gate(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            marker = root / "downstream-dispatched"
            catalog = root / "catalog.json"
            policy = root / "budget.json"
            catalog.write_text(json.dumps({"gates": {
                "synthetic-timeout": {"command": f"{sys.executable} -c 'import time;time.sleep(5)'",
                                      "timeout_seconds": 10},
                "synthetic-downstream": {
                    "argv": [sys.executable, "-c", f"from pathlib import Path;Path({str(marker)!r}).touch()"],
                    "timeout_seconds": 10,
                },
            }}))
            policy.write_text(json.dumps({
                "requestSeconds": 20, "planningSeconds": 5,
                "lifecycle": {"cleanupSeconds": 0.5, "publishSeconds": 2},
                "gates": {"synthetic-timeout": {
                    "workSeconds": 0.5, "cleanupSeconds": 0.5, "publishSeconds": 2,
                }},
            }))
            completed = subprocess.run(
                [sys.executable, "tooling/scripts/acceptance-run.py",
                 "--gates", str(catalog), "--gate", "synthetic-timeout",
                 "--gate", "synthetic-downstream", "--execution-budget", str(policy)],
                cwd=REPO_ROOT, env={
                    **os.environ,
                    "PT_ACCEPTANCE_ARTIFACT_ROOT": str(root / "evidence"),
                },
                capture_output=True, text=True, timeout=15,
            )
            self.assertNotEqual(completed.returncode, 0, completed.stdout + completed.stderr)
            self.assertFalse(marker.exists())
            reports = list((root / "evidence").rglob("reports/run.json"))
            self.assertEqual(len(reports), 1, completed.stdout + completed.stderr)
            report = json.loads(reports[0].read_text())
            self.assertEqual(report["executionBudget"]["dispatchedGateCount"], 1)
            self.assertEqual(report["executionBudget"]["stop"]["gateId"], "synthetic-timeout")
            self.assertEqual(report["results"][1]["proofStatus"], "UNPROVEN")
            self.assertEqual(report["proofStatus"], "UNPROVEN")

    def test_real_runner_publishes_full_scope_on_early_timeout_and_interrupt(self):
        for interruption in (False, True):
            with self.subTest(interruption=interruption), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                marker = root / "command-dispatched"
                catalog = root / "catalog.json"
                policy = root / "policy.json"
                catalog.write_text(json.dumps({"gates": {
                    name: {
                        "argv": [
                            sys.executable, "-c",
                            f"from pathlib import Path;Path({str(marker)!r}).touch()",
                        ],
                        "timeout_seconds": 10,
                    }
                    for name in ("synthetic-first", "synthetic-next")
                }}))
                policy.write_text(json.dumps({
                    "requestSeconds": 20, "planningSeconds": 5,
                    "lifecycle": {"cleanupSeconds": 0.5, "publishSeconds": 2},
                    "gates": {"synthetic-first": {
                        "workSeconds": 0.5, "cleanupSeconds": 0.5, "publishSeconds": 2,
                    }},
                }))
                injected_action = (
                    "os.kill(os.getpid(), signal.SIGINT)"
                    if interruption else "time.sleep(1)"
                )
                program = f"""
import importlib.util, os, signal, sys, time
import tooling.acceptance.core as core
spec = importlib.util.spec_from_file_location("bounded_runner", "tooling/scripts/acceptance-run.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
original = core.source_identity
calls = 0
def observed_source(root):
    global calls
    calls += 1
    if calls == 2:
        {injected_action}
    return original(root)
core.source_identity = observed_source
sys.argv = ["acceptance-run.py", "--gates", {str(catalog)!r},
            "--gate", "synthetic-first", "--gate", "synthetic-next",
            "--execution-budget", {str(policy)!r}]
raise SystemExit(runner.main())
"""
                completed = subprocess.run(
                    [sys.executable, "-c", program], cwd=REPO_ROOT,
                    env={**os.environ, "PT_ACCEPTANCE_ARTIFACT_ROOT": str(root / "evidence")},
                    capture_output=True, text=True, timeout=15,
                )
                output = completed.stdout + completed.stderr
                self.assertNotEqual(completed.returncode, 0, output)
                self.assertFalse(marker.exists(), output)
                reports = list((root / "evidence").rglob("reports/run.json"))
                self.assertEqual(len(reports), 1, output)
                report = json.loads(reports[0].read_text())
                self.assertEqual(len(report["results"]), 2)
                self.assertTrue(all(item["proofStatus"] == "UNPROVEN" for item in report["results"]))
                self.assertEqual(report["executionBudget"]["dispatchedGateCount"], 0)
                self.assertEqual(report["executionBudget"]["stop"]["gateId"], "synthetic-first")
                self.assertEqual(
                    report["executionBudget"]["stop"]["reason"],
                    "OWNER_INTERRUPTED" if interruption else "EXECUTION_BUDGET_STOP",
                )

    def test_real_runner_records_command_cancellation_and_publication_timeout(self):
        for interruption in (True, False):
            with self.subTest(interruption=interruption), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                marker = root / "downstream"
                late = root / "late-mutation"
                started = root / "child-pid"
                first_command = (
                    "import os,signal,time;from pathlib import Path;"
                    f"Path({str(started)!r}).write_text(str(os.getpid()));"
                    "print('command started',flush=True);"
                    "os.kill(os.getppid(),signal.SIGINT);time.sleep(1);"
                    f"Path({str(late)!r}).touch()"
                    if interruption else "print('command completed')"
                )
                catalog = root / "catalog.json"
                catalog.write_text(json.dumps({"gates": {
                    "synthetic-first": {
                        "argv": [sys.executable, "-c", first_command],
                        "timeout_seconds": 10,
                    },
                    "synthetic-next": {
                        "argv": [
                            sys.executable, "-c",
                            f"from pathlib import Path;Path({str(marker)!r}).touch()",
                        ],
                        "timeout_seconds": 10,
                    },
                }}))
                policy = root / "policy.json"
                policy.write_text(json.dumps({
                    "requestSeconds": 20, "planningSeconds": 5,
                    "lifecycle": {"cleanupSeconds": 0.5, "publishSeconds": 2},
                    "gates": {},
                }))
                program = f"""
import importlib.util, sys, time
spec = importlib.util.spec_from_file_location("bounded_runner", "tooling/scripts/acceptance-run.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
if not {interruption!r}:
    original = runner.finalize_gate_result
    def delayed_result(*args, **kwargs):
        time.sleep(3)
        return original(*args, **kwargs)
    runner.finalize_gate_result = delayed_result
sys.argv = ["acceptance-run.py", "--gates", {str(catalog)!r},
            "--gate", "synthetic-first", "--gate", "synthetic-next",
            "--execution-budget", {str(policy)!r}]
raise SystemExit(runner.main())
"""
                completed = subprocess.run(
                    [sys.executable, "-c", program], cwd=REPO_ROOT,
                    env={**os.environ, "PT_ACCEPTANCE_ARTIFACT_ROOT": str(root / "evidence")},
                    capture_output=True, text=True, timeout=15,
                )
                output = completed.stdout + completed.stderr
                self.assertNotEqual(completed.returncode, 0, output)
                self.assertFalse(marker.exists(), output)
                reports = list((root / "evidence").rglob("reports/run.json"))
                self.assertEqual(len(reports), 1, output)
                report = json.loads(reports[0].read_text())
                self.assertEqual(report["executionBudget"]["dispatchedGateCount"], 1)
                self.assertEqual(report["results"][0]["status"], "failed")
                self.assertEqual(report["results"][1]["proofStatus"], "UNPROVEN")
                self.assertEqual(
                    report["executionBudget"]["stop"]["reason"],
                    "OWNER_INTERRUPTED" if interruption else "EXECUTION_BUDGET_STOP",
                )
                if interruption:
                    self.assertTrue(started.exists(), output)
                    with self.assertRaises(ProcessLookupError):
                        os.kill(int(started.read_text()), 0)
                    self.assertFalse(late.exists())
                    cleanup = list((root / "evidence").rglob("reports/provisioner-cleanup.json"))
                    self.assertEqual(len(cleanup), 1)
                    self.assertEqual(json.loads(cleanup[0].read_text())["status"], "passed")
                    logs = list((root / "evidence").rglob("logs/*.log"))
                    self.assertTrue(any("command started" in path.read_text() for path in logs))
                else:
                    stop = report["executionBudget"]["stop"]
                    self.assertEqual(stop["cost"]["overrun"]["phase"], "publish")
                    self.assertEqual(stop["cost"]["overrun"]["stage"], "result-finalize")

    def test_stopping_large_scope_keeps_report_bounded(self):
        stop = {
            "gateId": "first", "reason": "EXECUTION_BUDGET_STOP",
            "policyDigest": "policy",
            "cost": {"spans": [{"detail": "large-observation" * 1000}]},
            "source": {"workspaceDigest": "current"},
        }
        gates = [{"id": f"pending-{index}"} for index in range(185)]
        pending = stopped_results(gates, set(), stop)
        self.assertEqual(len(pending), 185)
        self.assertLess(len(json.dumps(pending)), 100000)
        self.assertTrue(all("cost" not in item["executionStop"] for item in pending))
        self.assertTrue(all(item["proofStatus"] == "UNPROVEN" for item in pending))
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "budget_runner", REPO_ROOT / "tooling/scripts/acceptance-run.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        report = module.build_run_report(
            {"decisions": [{"data": "scope" * 1000}] * 234}, pending
        )
        self.assertLess(len(json.dumps(report["results"])), 400000)

    def test_yaml_registry_validation_does_not_spawn_an_interpreter(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            marker = root / "interpreter-started"
            interpreter = root / "forbidden-python"
            interpreter.write_text(f"#!/bin/sh\ntouch '{marker}'\nexit 99\n")
            interpreter.chmod(0o700)
            started = time.monotonic()
            result = subprocess.run(
                ["node", "tooling/scripts/architecture/module-governance.mjs", "validate"],
                cwd=REPO_ROOT,
                env={**os.environ, "PT_ARCHITECTURE_PYTHON": str(interpreter)},
                capture_output=True, text=True, timeout=6,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertFalse(marker.exists())
            self.assertLess(time.monotonic() - started, 5)

    def test_provisioner_registration_does_not_load_platform_dependencies(self):
        result = subprocess.run(
            [sys.executable, "-c",
             "import sys;import tooling.acceptance.provisioners;"
             "assert not any(n.startswith('selenium') for n in sys.modules);"
             "assert 'tooling.acceptance.provisioners.mobile_native' not in sys.modules"],
            cwd=REPO_ROOT, capture_output=True, text=True, timeout=5,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
