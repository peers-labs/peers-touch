"""Actual input-owner timeout evidence survives through the canonical Runner."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

from tooling.acceptance.core import ArtifactRef, EvidenceStore
from tooling.acceptance.core.execution_identity import InputIdentityProbeFailed, observe_gate_inputs


REPO = Path(__file__).resolve().parents[3]


def timeout_gate(marker: Path):
    return {
        "id": "owner-timeout", "argv": [sys.executable, "-c", "raise AssertionError('unreachable')"],
        "environment": "local", "tier": "ci-cheap",
        "executionInputs": {
            "environmentKeys": [],
            "identityProbe": {
                "ownerId": "synthetic-inputs", "timeoutSeconds": 0.2,
                "argv": [sys.executable, "-c", (
                    "import os,sys,time;from pathlib import Path;"
                    f"Path({str(marker)!r}).write_text(str(os.getpid()));"
                    "print('[ACCEPTANCE_OPERATION] input-owner-python-installation',"
                    "file=sys.stderr,flush=True);time.sleep(5)"
                )],
            },
        },
    }


class InputOwnerDiagnosticTest(unittest.TestCase):
    def test_terminal_rejection_preserves_original_exit_output_and_arguments(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for stdout, exit_code in (
                ("original-stdout", 7), ("not-json", 0), ("a" * 20000, 0),
                ('{"artifactKind":"incomplete"}', 0),
            ):
                with self.subTest(exit_code=exit_code, output=stdout[:32]):
                    gate = timeout_gate(root / "unused")
                    probe = gate["executionInputs"]["identityProbe"]
                    probe["timeoutSeconds"] = 1
                    output_expression = "'a' * 20000" if len(stdout) > 4096 else repr(stdout)
                    probe["argv"] = [sys.executable, "-c", (
                        "import sys;"
                        f"sys.stdout.write({output_expression});"
                        "sys.stderr.write('original-stderr');"
                        f"sys.exit({exit_code})"
                    )]
                    with self.assertRaises(InputIdentityProbeFailed) as failure:
                        observe_gate_inputs(gate, os.environ, repo_root=root, context={"gate": gate})
                    payload = failure.exception.failure
                    self.assertEqual(payload["commandExitCode"], exit_code)
                    self.assertEqual(payload["argv"], probe["argv"])
                    self.assertEqual(payload["output"], {
                        "stdout": stdout, "stderr": "original-stderr",
                    })
                    self.assertEqual(payload["proofStatus"], "supporting-only")

    def test_actual_timeout_preserves_original_diagnostic_and_child_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            marker = root / "owner-pid"
            gate = timeout_gate(marker)
            started = time.monotonic()
            with self.assertRaises(InputIdentityProbeFailed) as failure:
                observe_gate_inputs(gate, os.environ, repo_root=root, context={"gate": gate})
            self.assertLess(time.monotonic() - started, 2)
            payload = failure.exception.failure
            self.assertEqual(payload["errorType"], "EphemeralLaunchTimeout")
            self.assertIn("input-owner-python-installation", payload["output"]["stderr"])
            check = payload["diagnostic"]["resourceChecks"][0]
            self.assertEqual(check["expected"]["commandTimeoutSeconds"], 0.2)
            self.assertEqual(check["observed"]["processCleanup"], "completed")
            with self.assertRaises(ProcessLookupError):
                os.kill(int(marker.read_text()), 0)

    def test_diagnostic_output_tail_is_bounded(self):
        failure = InputIdentityProbeFailed(
            "gate", "owner", OSError("unavailable"),
            {"stdout": "a" * 100000, "stderr": "b" * 100000},
        )
        self.assertTrue(failure.failure["outputTruncated"])
        self.assertTrue(all(len(value.encode()) == 65536 for value in failure.failure["output"].values()))
        unicode_failure = InputIdentityProbeFailed("gate", "owner", OSError(), {"stderr": "中" * 100000})
        self.assertLessEqual(len(unicode_failure.failure["output"]["stderr"].encode()), 65536)

    def test_canonical_runner_seals_timeout_evidence_and_stops_downstream(self):
        self.check_runner_failure(terminal_failure=False)

    def test_canonical_runner_seals_terminal_failure_and_stops_downstream(self):
        self.check_runner_failure(terminal_failure=True)

    def check_runner_failure(self, *, terminal_failure):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            source.mkdir()
            for args in (["init", "-q"], ["config", "user.name", "Fixture"],
                         ["config", "user.email", "fixture@example.invalid"]):
                subprocess.run(["git", "-C", str(source), *args], check=True,
                               capture_output=True, timeout=3)
            (source / "source.txt").write_text("fixture\n")
            (source / ".gitignore").write_text(".local/\n")
            subprocess.run(["git", "-C", str(source), "add", "."], check=True,
                           capture_output=True, timeout=3)
            subprocess.run(["git", "-C", str(source), "-c", "core.hooksPath=/dev/null",
                            "commit", "-qm", "fixture"],
                           check=True, capture_output=True, timeout=3)
            gate = timeout_gate(root / "owner-pid")
            if terminal_failure:
                gate["executionInputs"]["identityProbe"]["argv"] = [sys.executable, "-c", (
                    "import sys;sys.stdout.write('original-terminal-output');"
                    "sys.stderr.write('original-terminal-error');sys.exit(7)"
                )]
            downstream = root / "downstream"
            catalog = root / "catalog.json"
            catalog.write_text(json.dumps({"gates": {
                gate["id"]: {key: value for key, value in gate.items() if key != "id"},
                "downstream": {
                    "argv": [sys.executable, "-c", (
                        f"from pathlib import Path;Path({str(downstream)!r}).touch()"
                    )], "environment": "local", "tier": "ci-cheap",
                },
            }}))
            policy = root / "policy.json"
            policy.write_text(json.dumps({
                "requestSeconds": 5, "planningSeconds": 2,
                "lifecycle": {"cleanupSeconds": 1, "publishSeconds": 1},
                "gates": {},
            }))
            runner = root / "run.py"
            runner.write_text(
                "import importlib.util;from pathlib import Path;"
                f"s=importlib.util.spec_from_file_location('runner',{str(REPO / 'tooling/scripts/acceptance-run.py')!r});"
                "r=importlib.util.module_from_spec(s);s.loader.exec_module(r);"
                f"r.REPO_ROOT=Path({str(source)!r});raise SystemExit(r.main())"
            )
            environment = {
                **os.environ, "PYTHONPATH": str(REPO),
                "PT_ACCEPTANCE_ARTIFACT_ROOT": str(root / "evidence"),
            }
            completed = subprocess.run([
                sys.executable, str(runner), "--gates", str(catalog),
                "--gate", gate["id"], "--gate", "downstream", "--stop-on-failure",
                "--execution-budget", str(policy),
            ], env=environment, capture_output=True, text=True, timeout=10)
            self.assertNotEqual(completed.returncode, 0)
            self.assertFalse(downstream.exists())
            markers = [
                line.removeprefix("execution-session-manifest: ")
                for line in completed.stdout.splitlines()
                if line.startswith("execution-session-manifest: ")
            ]
            self.assertEqual(len(markers), 1, completed.stderr)
            store = EvidenceStore(root / "evidence", worktree=source)
            reference = ArtifactRef.from_dict(json.loads(markers[0]))
            manifest = store.read_run_manifest(reference, manifest_sha256=reference.sha256)
            report = store.read_json(ArtifactRef.from_dict(manifest["artifacts"]["run"]))
            session = store.read_json(ArtifactRef.from_dict(manifest["artifacts"]["execution-session"]))
            result = next(item for item in report["results"] if item["id"] == gate["id"])
            self.assertIn("inputOwnerFailure", result, json.dumps(result, indent=2))
            failure = store.read_json(ArtifactRef.from_dict(result["inputOwnerFailure"]))
            self.assertEqual(session["state"], "PAUSED_REPAIR_REQUIRED")
            self.assertEqual(result["proofStatus"], "UNPROVEN")
            if terminal_failure:
                self.assertEqual(failure["commandExitCode"], 7)
                self.assertEqual(failure["argv"], gate["executionInputs"]["identityProbe"]["argv"])
                self.assertEqual(failure["output"], {
                    "stdout": "original-terminal-output", "stderr": "original-terminal-error",
                })
            else:
                self.assertEqual(result["errorType"], "EphemeralLaunchTimeout")
                self.assertIn("input-owner-python-installation", failure["output"]["stderr"])
            self.assertEqual(failure["proofStatus"], "supporting-only")

if __name__ == "__main__":
    unittest.main()
