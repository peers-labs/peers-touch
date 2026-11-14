#!/usr/bin/env python3
"""Integration admission regressions using real Git objects and branch topology."""

from __future__ import annotations

import argparse
import base64
import errno
import json
import os
import subprocess
import sys
import tempfile
import unittest
import zlib
from pathlib import Path

from integration_review import (
    IntegrationError, current, digest, prepare, run_checks,
    validate_plan, validate_results, validate_review, case_counts,
)
from merge_scope import git, inventory, source_fence
from integration_evidence import decode, write_bundle

SCRIPTS = Path(__file__).resolve().parent


REGISTRY = (
    "docs/architecture/engineering/architecture-governance/architecture-modules.json"
)


class Repository:
    def __init__(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pt-integration-fixture-")
        self.root = Path(self.temp.name) / "repo"
        self.root.mkdir()
        subprocess.run(["git", "init", "-q", "--template=", str(self.root)], check=True)
        self.env = dict(os.environ, GIT_AUTHOR_NAME="Integration Fixture",
                        GIT_AUTHOR_EMAIL="fixture@example.invalid",
                        GIT_COMMITTER_NAME="Integration Fixture",
                        GIT_COMMITTER_EMAIL="fixture@example.invalid",
                        GIT_INDEX_FILE=str(Path(self.temp.name) / "fixture-index"))

    def command(self, *args: str, text: str = "") -> str:
        return subprocess.check_output(
            ["git", *args], cwd=self.root, env=self.env, input=text, text=True
        ).strip()

    def commit(self, files: dict[str, str], parents=(), name=None, modes=None) -> str:
        self.command("read-tree", "--empty")
        entries = []
        for path, content in files.items():
            blob = self.command("hash-object", "-w", "--stdin", text=content)
            entries.append(f"{(modes or {}).get(path, '100644')} blob {blob}\t{path}\n")
        self.command("update-index", "--index-info", text="".join(entries))
        tree = self.command("write-tree")
        argv = ["commit-tree", tree]
        for parent in dict.fromkeys(parents):
            argv.extend(("-p", parent))
        commit = self.command(*argv, text=f"Integration regression fixture {name or tree}\n")
        if name:
            self.command("update-ref", f"refs/heads/{name}", commit)
        return commit

    def checkout(self, commit: str) -> None:
        subprocess.run(["git", "checkout", "-q", "--detach", commit],
                       cwd=self.root, check=True)

    def close(self) -> None:
        # The editor's Git AI observer may append .git/ai after a Git command
        # returns. Remove that task-owned metadata residue without stopping
        # the user's observer or ignoring a failed cleanup.
        for attempt in range(3):
            try:
                self.temp.cleanup()
                return
            except OSError as error:
                if error.errno != errno.ENOTEMPTY or attempt == 2:
                    raise


def manifest(repo: Repository, ours: str, theirs: str, candidate: str) -> dict:
    plan = prepare(repo.root, ours, theirs, candidate)
    plan.update(executor="fixture-integrator",
                intent={"ours": "Retain accepted behavior",
                        "theirs": "Integrate peer-owned changes"})
    plan["checks"] = [{
        "id": "behavior", "classification": "required",
        "rationale": "Execute the affected contract's original assertion",
        "kind": "test", "format": "unittest",
        "argv": [sys.executable, "-m", "unittest", "test_behavior.py"],
        "cwd": ".", "covers": [entry["path"] for entry in plan["scope"]["files"]] or ["service.py"],
    }]
    plan["checks"].append({
        "id": "build", "classification": "required", "kind": "build", "format": "exit",
        "rationale": "Parse every candidate Python source", "cwd": ".",
        "argv": [sys.executable, "-m", "compileall", "-q", "."],
        "covers": plan["checks"][0]["covers"],
    })
    plan["outcomes"] = [
        {"path": entry["path"], "decision": "PRESERVED",
         "reason": "The accepted behavior remains supported",
         "checks": ["behavior", "build"]}
        for entry in plan["scope"]["files"]
    ]
    for entry in plan["scope"]["files"]:
        if entry["ui"]:
            # Used only for validation schema fixtures, never executed or
            # reported as actual UI evidence.
            plan["checks"][0]["kind"] = "functional"
    plan["standardDecisions"] = [
        {"path": entry["path"], "decision": "equivalent",
         "reason": "No accepted assertion was removed",
         "retainedAssertions": "Original behavior assertion must still pass",
         "checks": ["behavior"]}
        for entry in plan["scope"]["files"] if entry["standard"] and entry["differsFrom"]
    ]
    for decision in plan["standardDecisions"]:
        entry = next(e for e in plan["scope"]["files"] if e["path"] == decision["path"])
        for side in entry["differsFrom"]:
            key = f"baseline-{side}-{len(plan['checks'])}"
            plan["checks"].append({
                "id": key, "classification": "required", "kind": "test",
                "format": "unittest", "rationale": "Execute unchanged original assertion",
                "cwd": ".", "covers": [decision["path"]],
                "baselineInputs": [{"side": side, "path": decision["path"]}],
                "argv": [sys.executable, "-c",
                         "import runpy,unittest,types,sys;"
                         "m=types.ModuleType('baseline');"
                         "m.__dict__.update(runpy.run_path(sys.argv[1]));"
                         "r=unittest.TextTestRunner().run("
                         "unittest.defaultTestLoader.loadTestsFromModule(m));"
                         "sys.exit(not r.wasSuccessful())",
                         f"{{baseline:{side}:{decision['path']}}}"],
            })
            decision["checks"].append(key)
    plan["bundles"] = [
        {"id": owner["id"], "contract": "Original registered contract",
         "checks": ["behavior", "build"],
         **{facet: "Checked in the affected contract"
            for facet in ("callers", "consumers", "registration", "protocol",
                          "persistence", "runtime")},
         "gateDispositions": [
             {"gate": gate, "classification": "required",
              "reason": "Original contract proof", "check": "behavior"}
             for gate in owner["gates"]
         ]}
        for owner in plan["scope"]["architecture"]
    ]
    return plan


def review_for(plan: dict, results: dict) -> dict:
    return {
        "planDigest": digest(plan), "reviewer": "fixture-reviewer",
        "resultsDigest": digest(results),
        "reviewedPaths": [entry["path"] for entry in plan["scope"]["files"]],
        "reviewedOwners": [owner["id"] for owner in plan["scope"]["architecture"]],
        "standardsDecisions": [
            {"path": decision["path"], "verdict": "supported",
             "reason": "Fixture baseline result checked"}
            for decision in plan["standardDecisions"]],
        "findings": [], "standardsAnalysis": "Baseline assertions remain intact",
        "dependencyAnalysis": "Both ends agree on the contract",
        "counterexamples": [
            {"scenario": "A mismatched response must fail the original assertion",
             "whyRejected": "The original test checks the consumer result",
             "check": "behavior"}
        ],
    }


class IntegrationRegressions(unittest.TestCase):
    def setUp(self):
        self.repo = Repository()
        self.base_files = {
            ".gitignore": "__pycache__/\n",
            "service.py": "def value():\n    return 1\n",
            "test_behavior.py": (
                "import unittest\nfrom service import value\n"
                "class Contract(unittest.TestCase):\n"
                "    def test_value(self):\n        self.assertEqual(value(), 1)\n"
            ),
            "docs/accepted.md": "# Accepted contract\nValue remains one.\n",
        }
        self.base = self.repo.commit(self.base_files, name="base")

    def tearDown(self):
        self.repo.close()

    def pair(self, left=None, right=None, candidate=None):
        ours_files = {**self.base_files, **(left or {})}
        theirs_files = {**self.base_files, **(right or {})}
        ours = self.repo.commit(ours_files, (self.base,), name="ours")
        theirs = self.repo.commit(theirs_files, (self.base,), name="theirs")
        tip = (self.repo.commit(candidate, (ours, theirs), name="candidate")
               if candidate is not None else "auto")
        return ours, theirs, tip

    def assertBlocked(self, code, action, *args):
        with self.assertRaisesRegex(IntegrationError, code):
            action(*args)

    def test_silent_ui_historical_reversion_is_mandatory_review(self):
        path = "apps/desktop/src/pages/SettingsPage.tsx"
        old = {**self.base_files, path: "<main>old</main>\n"}
        old_tip = self.repo.commit(old)
        modern = {**old, path: "<main><nav>groups</nav>modern</main>\n"}
        accepted = self.repo.commit(modern, (old_tip,), name="accepted")
        ours = self.repo.commit({**modern, "rail.py": "rail = True\n"},
                                (accepted,), name="ours")
        theirs = self.repo.commit(old, (accepted,), name="theirs")
        plan = manifest(self.repo, ours, theirs, "auto")
        entry = next(e for e in plan["scope"]["files"] if e["path"] == path)
        self.assertEqual(entry["baseBlob"], entry["oursBlob"])
        self.assertEqual(entry["candidateBlob"], entry["theirsBlob"])
        self.assertTrue(entry["historicalReversion"])
        self.assertBlocked("HISTORICAL_REVERSION_UNPROVEN",
                           validate_plan, plan, self.repo.root)

    def test_historic_bad_merge_propagation_is_visible(self):
        old = {**self.base_files, "surface.py": "legacy = True\n"}
        old_tip = self.repo.commit(old)
        new = {**old, "surface.py": "legacy = False\n"}
        accepted = self.repo.commit(new, (old_tip,))
        upstream = self.repo.commit({**new, "api.py": "version = 1\n"}, (accepted,))
        bad_merge = self.repo.commit(old, (accepted, upstream), name="bad-merge")
        ours = self.repo.commit({**new, "unrelated.py": "ok = True\n"},
                                (accepted,), name="ours")
        plan = manifest(self.repo, ours, bad_merge, "auto")
        self.assertTrue(next(e for e in plan["scope"]["files"]
                             if e["path"] == "surface.py")["historicalReversion"])
        self.assertBlocked("HISTORICAL_REVERSION_UNPROVEN",
                           validate_plan, plan, self.repo.root)

    def test_bilateral_paths_cannot_be_removed_from_scope(self):
        ours, theirs, tip = self.pair({"left.py": "left=1\n"}, {"right.py": "right=1\n"})
        plan = manifest(self.repo, ours, theirs, tip)
        self.assertEqual({e["path"] for e in plan["scope"]["files"]},
                         {"left.py", "right.py"})
        plan["scope"]["files"].pop()
        self.assertBlocked("SCOPE_TAMPERED", current, plan, self.repo.root,
                           ours, theirs, tip)

    def test_cross_file_protocol_mismatch_executes_and_fails(self):
        ours, theirs, _ = self.pair(
            {"service.py": "def value():\n    return {'number': 1}\n"},
            {"consumer.py": "from service import value\ndef read(): return value()['value']\n"},
        )
        candidate = self.repo.commit({
            **self.base_files, "service.py": "def value():\n    return {'number': 1}\n",
            "consumer.py": "from service import value\ndef read(): return value()['value']\n",
            "test_behavior.py": (
                "import unittest\nfrom consumer import read\n"
                "class Contract(unittest.TestCase):\n"
                "    def test_value(self):\n        self.assertEqual(read(), 1)\n"
            ),
        }, (ours, theirs))
        plan = manifest(self.repo, ours, theirs, candidate)
        self.repo.checkout(candidate)
        results = run_checks(plan, self.repo.root, Path(self.repo.temp.name) / "results.json")
        self.assertBlocked("REQUIRED_CHECK_FAILED", validate_results, plan, results)

    def test_weakening_standards_cannot_hide_in_an_auto_merge(self):
        ours, theirs, tip = self.pair(right={"test_behavior.py": (
            "import unittest\nclass Contract(unittest.TestCase):\n"
            "    def test_value(self):\n        self.assertTrue(True)\n"
        )})
        plan = manifest(self.repo, ours, theirs, tip)
        plan["standardDecisions"] = []
        self.assertBlocked("STANDARDS_CHANGE_UNREVIEWED", validate_plan, plan, self.repo.root)

    def test_deleted_standards_need_separate_decision(self):
        ours, theirs, _ = self.pair()
        files = dict(self.base_files)
        del files["test_behavior.py"]
        tip = self.repo.commit(files, (ours, theirs))
        plan = manifest(self.repo, ours, theirs, tip)
        plan["standardDecisions"] = []
        self.assertBlocked("STANDARDS_CHANGE_UNREVIEWED", validate_plan, plan, self.repo.root)

    def test_target_advancement_invalidates_old_green(self):
        ours, theirs, tip = self.pair(right={"peer.py": "value=1\n"})
        plan = manifest(self.repo, ours, "theirs", tip)
        self.repo.commit({**self.base_files, "peer.py": "value=2\n"}, (theirs,), name="theirs")
        self.assertBlocked("STALE_SOURCE", current, plan, self.repo.root,
                           ours, "theirs", tip)

    def test_zero_cases_fail_even_when_runner_exits_zero(self):
        ours, theirs, _ = self.pair()
        tip = self.repo.commit({**self.base_files, "test_behavior.py": "import unittest\n"},
                               (ours, theirs))
        plan = manifest(self.repo, ours, theirs, tip)
        # Python 3.13 itself returns exit 5 on empty discovery. Exercise the
        # dangerous runner variant that still exits zero with zero cases.
        plan["checks"][0]["argv"] = [
            sys.executable, "-c",
            "import unittest; unittest.main(module='test_behavior', exit=False)",
        ]
        self.repo.checkout(tip)
        results = run_checks(plan, self.repo.root, Path(self.repo.temp.name) / "results.json")
        self.assertBlocked("ZERO_CASES", validate_results, plan, results)

    def test_skipped_cases_fail_even_when_runner_exits_zero(self):
        ours, theirs, _ = self.pair()
        tip = self.repo.commit({**self.base_files, "test_behavior.py": (
            "import unittest\n@unittest.skip('environment unavailable')\n"
            "class Contract(unittest.TestCase):\n"
            "    def test_value(self): pass\n"
        )}, (ours, theirs))
        plan = manifest(self.repo, ours, theirs, tip)
        self.repo.checkout(tip)
        results = run_checks(plan, self.repo.root, Path(self.repo.temp.name) / "results.json")
        self.assertBlocked("REQUIRED_CHECK_SKIPPED_OR_FAILED", validate_results, plan, results)

    def test_missing_mandatory_check_is_blocked(self):
        ours, theirs, tip = self.pair(right={"peer.py": "value=1\n"})
        plan = manifest(self.repo, ours, theirs, tip)
        self.assertBlocked("REQUIRED_CHECK_MISSING", validate_results, plan,
                           {"planDigest": digest(plan), "records": []})

    def test_real_runner_passes_preservation_and_independent_review(self):
        ours, theirs, _ = self.pair({"left.py": "left=1\n"}, {"right.py": "right=1\n"})
        candidate = source_fence(self.repo.root, ours, theirs, "auto")["candidateTree"]
        # Make the exact Git merge tree addressable without altering its bytes.
        tip = self.repo.command("commit-tree", candidate, "-p", ours, "-p", theirs,
                                text="Legitimate integration\n")
        plan = manifest(self.repo, ours, theirs, tip)
        validate_plan(plan, self.repo.root)
        self.repo.checkout(tip)
        results = run_checks(plan, self.repo.root, Path(self.repo.temp.name) / "results.json")
        validate_results(plan, results)
        validate_review(plan, review_for(plan, results), results)
        review = review_for(plan, results)
        review["reviewer"] = plan["executor"]
        self.assertBlocked("INDEPENDENT_REVIEW_REQUIRED", validate_review, plan, review, results)
        review = review_for(plan, results)
        review["counterexamples"] = []
        self.assertBlocked("COUNTEREXAMPLE_REQUIRED", validate_review, plan, review, results)

    def test_accepted_complete_replacement_is_allowed(self):
        ours, theirs, _ = self.pair()
        tip = self.repo.commit({**self.base_files, "service.py": "def value():\n    return 2\n",
                               "test_behavior.py": (
                                   "import unittest\nfrom service import value\n"
                                   "class Contract(unittest.TestCase):\n"
                                   "    def test_value(self):\n        self.assertEqual(value(), 2)\n"
                               ),
                               "docs/accepted.md": "# Accepted replacement\nValue is two.\n"},
                              (ours, theirs))
        plan = manifest(self.repo, ours, theirs, tip)
        ref = {"revision": tip, "path": "docs/accepted.md",
               "rationale": "Fixture owner accepted complete value replacement"}
        for outcome in plan["outcomes"]:
            outcome.update(decision="INTENTIONALLY_SUPERSEDED", acceptedChange=ref)
        for decision in plan["standardDecisions"]:
            decision.update(decision="requirement-change", acceptedChange=ref)
        plan["checks"] = [check for check in plan["checks"] if not check.get("baselineInputs")]
        self.repo.checkout(tip)
        results = run_checks(plan, self.repo.root, Path(self.repo.temp.name) / "results.json")
        validate_results(plan, results)
        validate_review(plan, review_for(plan, results), results)

    def test_structural_success_cannot_replace_build_and_behavior(self):
        ours, theirs, tip = self.pair(right={"peer.py": "value=1\n"})
        plan = manifest(self.repo, ours, theirs, tip)
        plan["checks"][0].update(kind="structural", format="exit",
                                 argv=[sys.executable, "-c", "pass"])
        self.assertBlocked("AFFECTED_BEHAVIOR_UNPROVEN", validate_plan, plan, self.repo.root)

    def test_populated_equivalence_claim_still_runs_original_assertion(self):
        ours, theirs, _ = self.pair(
            right={"test_behavior.py": (
                "import unittest\nclass Contract(unittest.TestCase):\n"
                "    def test_value(self): self.assertTrue(True)\n")})
        tip = self.repo.commit({**self.base_files,
                               "service.py": "def value(): return 9\n",
                               "test_behavior.py": (
                                   "import unittest\nclass Contract(unittest.TestCase):\n"
                                   "    def test_value(self): self.assertTrue(True)\n")},
                              (ours, theirs))
        plan = manifest(self.repo, ours, theirs, tip)
        self.repo.checkout(tip)
        results = run_checks(plan, self.repo.root, Path(self.repo.temp.name) / "results.json")
        self.assertEqual(results["records"][0]["exitCode"], 0)
        self.assertBlocked("REQUIRED_CHECK_FAILED", validate_results, plan, results)

    def test_fabricated_counts_cannot_mask_original_zero_output(self):
        ours, theirs, _ = self.pair(right={"peer.py": "value=1\n"})
        tip = self.repo.commit({**self.base_files, "peer.py": "value=1\n"}, (ours, theirs))
        plan = manifest(self.repo, ours, theirs, tip)
        self.repo.checkout(tip)
        results = run_checks(plan, self.repo.root, Path(self.repo.temp.name) / "results.json")
        results["records"][0]["output"] = "Ran 0 tests in 0.001s\nOK\n"
        self.assertBlocked("RESULT_COUNTS_MISMATCH", validate_results, plan, results)

    def test_registered_consumer_survives_registry_deletion(self):
        registry = {"modules": [
            {"id": "producer", "root": "docs/producer", "governedPaths": ["service.py"],
             "capabilities": [{"id": "api", "contractRoots": ["service.py"],
                               "allowedDependencies": [], "consumers": [],
                               "evidenceGates": ["api-contract"]}]},
            {"id": "consumer", "root": "docs/consumer", "governedPaths": ["consumer.py"],
             "capabilities": [{"id": "client", "contractRoots": ["consumer.py"],
                               "allowedDependencies": ["api"], "consumers": [],
                               "evidenceGates": ["client-contract"]}]}]}
        self.base_files[REGISTRY] = json.dumps(registry)
        self.base = self.repo.commit(self.base_files, name="base")
        ours, theirs, _ = self.pair({"service.py": "def value(): return 1\n"},
                                   {REGISTRY: json.dumps({"modules": []})})
        plan = manifest(self.repo, ours, theirs, "auto")
        self.assertEqual({o["id"] for o in plan["scope"]["architecture"]},
                         {"producer", "consumer"})
        disposition = plan["bundles"][0]["gateDispositions"][0]
        disposition.update(classification="conditional", triggered=True, check="absent")
        self.assertBlocked("GATE_SELECTION_UNREVIEWED", validate_plan, plan, self.repo.root)
        plan["bundles"][0]["checks"] = ["behavior"]
        self.assertBlocked("DEPENDENCY_BUILD_OR_BEHAVIOR_UNPROVEN",
                           validate_plan, plan, self.repo.root)
        left, right, _ = self.pair(right={REGISTRY: json.dumps({"modules": []})})
        scope = inventory(self.repo.root, source_fence(self.repo.root, left, right, "auto"))
        self.assertEqual([entry["path"] for entry in scope["files"]], [REGISTRY])
        self.assertEqual({owner["id"] for owner in scope["architecture"]}, {"producer", "consumer"})

    def test_submit_entry_rejects_missing_evidence_and_skip(self):
        self.repo.checkout(self.base)
        for extra, expected in (([], "source-bound integration"), (["--skip-ci-gates"], "cannot produce")):
            result = subprocess.run(["bash", str(SCRIPTS / "submit-pipeline.sh"), *extra],
                                    cwd=self.repo.root, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(expected, result.stderr)
            self.assertEqual(git(self.repo.root, "rev-parse", "HEAD"), self.base)

    def test_all_release_entries_reject_missing_review_before_mutation(self):
        ours, theirs, _ = self.pair({"left.py": "left=1\n"}, {"right.py": "right=1\n"})
        candidate = source_fence(self.repo.root, ours, theirs, "auto")["candidateTree"]
        tip = self.repo.command("commit-tree", candidate, "-p", ours, "-p", theirs,
                                text="Candidate fixture\n")
        plan = manifest(self.repo, ours, theirs, tip)
        self.repo.checkout(tip)
        output = Path(self.repo.temp.name)
        results = run_checks(plan, self.repo.root, output / "results.json")
        (output / "plan.json").write_text(json.dumps(plan))
        for action in ("commit", "fanout", "github-merge"):
            result = subprocess.run(
                [sys.executable, str(SCRIPTS / "integration_gate.py"), action,
                 "--ours", ours, "--theirs", theirs, "--candidate", tip,
                 "--plan", str(output / "plan.json"), "--results", str(output / "results.json"),
                 "--review", str(output / "absent-review.json"), "--execute"],
                cwd=self.repo.root, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("MISSING_OR_INVALID_EVIDENCE", result.stderr)
            self.assertEqual(git(self.repo.root, "rev-parse", "HEAD"), tip)
        validate_results(plan, results)

    def test_external_evidence_roundtrip_preserves_original_results(self):
        ours, theirs, tip = self.pair(right={"peer.py": "peer=1\n"})
        plan = manifest(self.repo, ours, theirs, tip)
        results = {"planDigest": digest(plan), "records": []}
        bundle = {"plan": plan, "results": results, "review": review_for(plan, results)}
        encoded = base64.b64encode(zlib.compress(json.dumps(bundle).encode())).decode()
        restored = decode(encoded)
        self.assertEqual(restored, bundle)
        output = Path(self.repo.temp.name)
        write_bundle(restored, output)
        self.assertEqual(json.loads((output / "results.json").read_text()), results)
        self.assertBlocked("INVALID_EVIDENCE", decode,
                           base64.b64encode(zlib.compress(b"{}")).decode())

    def test_real_commit_and_fanout_use_same_final_source_evidence(self):
        ours, theirs, _ = self.pair({"left.py": "left=1\n"}, {"right.py": "right=1\n"})
        self.repo.checkout(ours)
        env = {key: value for key, value in self.repo.env.items() if key != "GIT_INDEX_FILE"}
        subprocess.run(["git", "merge", "--no-commit", "--no-ff", theirs],
                       cwd=self.repo.root, env=env, capture_output=True, text=True, check=True)
        plan = manifest(self.repo, ours, theirs, "index")
        output = Path(self.repo.temp.name)
        results = run_checks(plan, self.repo.root, output / "results.json")
        (output / "plan.json").write_text(json.dumps(plan))
        (output / "review.json").write_text(json.dumps(review_for(plan, results)))
        (output / "message.txt").write_text("test: integrate approved fixture behavior\n")
        common = ["--plan", str(output / "plan.json"), "--results", str(output / "results.json"),
                  "--review", str(output / "review.json")]
        result = subprocess.run(
            [sys.executable, str(SCRIPTS / "integration_gate.py"), "commit",
             "--ours", "HEAD", "--theirs", "MERGE_HEAD", "--candidate", "index",
             "--message-file", str(output / "message.txt"), *common, "--execute"],
            cwd=self.repo.root, env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        final = git(self.repo.root, "rev-parse", "HEAD")
        self.assertEqual(git(self.repo.root, "rev-parse", "HEAD^{tree}"),
                         plan["source"]["candidateTree"])
        target = output / "target"
        subprocess.run(["git", "worktree", "add", "-q", "--detach", str(target), ours],
                       cwd=self.repo.root, check=True)
        try:
            result = subprocess.run(
                [sys.executable, str(SCRIPTS / "integration_gate.py"), "fanout",
                 "--ours", ours, "--theirs", theirs, "--candidate", "HEAD",
                 "--target", str(target), "--target-head", ours, *common, "--execute"],
                cwd=self.repo.root, env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(git(target, "rev-parse", "HEAD"), final)
            # A stale inventoried target must be refused even if all proof is green.
            result = subprocess.run(
                [sys.executable, str(SCRIPTS / "integration_gate.py"), "fanout",
                 "--ours", ours, "--theirs", theirs, "--candidate", "HEAD",
                 "--target", str(target), "--target-head", ours, *common, "--execute"],
                cwd=self.repo.root, env=env, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("CONCURRENT_CHANGE_DETECTED", result.stderr)
            self.assertEqual(git(target, "rev-parse", "HEAD"), final)
        finally:
            subprocess.run(["git", "worktree", "remove", str(target)],
                           cwd=self.repo.root, check=True)

    def test_report_level_errors_never_become_passed_cases(self):
        bad_reports = [
            ("junit", '<testsuites errors="1"><testsuite tests="1">'
             '<testcase name="ok"/></testsuite><testsuite errors="1"><error/>'
             '</testsuite></testsuites>'),
            ("vitest", json.dumps({"success": True, "numPassedTests": 1,
                                  "numFailedTests": 0, "numTotalTests": 1,
                                  "numFailedTestSuites": 1})),
            ("vitest", json.dumps({"success": False, "numPassedTests": 1,
                                  "numFailedTests": 0, "numTotalTests": 1,
                                  "numRuntimeErrorTestSuites": 1})),
        ]
        for fmt, report in bad_reports:
            check = {"id": "report", "classification": "required", "format": fmt}
            plan = {"checks": [check], "scope": {"files": []}}
            results = {"planDigest": digest(plan), "records": [{
                "id": "report", "checkDigest": digest(check), "exitCode": 0,
                "output": "", "reportOutput": report,
                "counts": case_counts(check, "", report),
            }]}
            self.assertBlocked("REQUIRED_CHECK_SKIPPED_OR_FAILED", validate_results, plan, results)
        for fmt, report in [
                ("junit", '<testsuite tests="1" errors="0" failures="0"><testcase name="ok"/></testsuite>'),
                ("vitest", json.dumps({"success": True, "numPassedTests": 1,
                                      "numFailedTests": 0, "numTotalTests": 1}))]:
            self.assertEqual(case_counts({"id": "good", "format": fmt}, "", report),
                             {"executed": 1, "failed": 0, "skipped": 0})

    def test_file_mode_change_is_part_of_original_standards_review(self):
        path = "tests/check.sh"
        files = {**self.base_files, path: "#!/bin/sh\nexit 0\n"}
        self.base_files = files
        self.base = self.repo.commit(files, modes={path: "100755"})
        ours = self.repo.commit(files, (self.base,), modes={path: "100755"})
        theirs = self.repo.commit(files, (self.base,), modes={path: "100755"})
        tip = self.repo.commit(files, (ours, theirs), modes={path: "100644"})
        plan = manifest(self.repo, ours, theirs, tip)
        entry = next(e for e in plan["scope"]["files"] if e["path"] == path)
        self.assertEqual(entry["oursBlob"], entry["candidateBlob"])
        self.assertNotEqual(entry["oursEntry"]["mode"], entry["candidateEntry"]["mode"])
        self.assertTrue(entry["differsFrom"])
        plan["standardDecisions"] = []
        self.assertBlocked("STANDARDS_CHANGE_UNREVIEWED", validate_plan, plan, self.repo.root)

    def test_mjs_shell_and_unknown_executables_need_real_build_and_behavior(self):
        for path in ("scripts/rule.mjs", "scripts/rule.cjs", "scripts/check.sh", "scripts/tool"):
            ours, theirs, _ = self.pair()
            tip = self.repo.commit({**self.base_files, path: "exit 0\n"}, (ours, theirs),
                                   modes={path: "100755"})
            plan = manifest(self.repo, ours, theirs, tip)
            plan["checks"] = [{
                "id": "syntax", "classification": "required", "kind": "structural",
                "format": "exit", "argv": ["bash", "-n", path], "covers": [path],
                "rationale": "Only syntax was checked",
            }]
            for outcome in plan["outcomes"]:
                outcome["checks"] = ["syntax"]
            self.assertBlocked("AFFECTED_BUILD_UNPROVEN", validate_plan, plan, self.repo.root)

    def test_last_merge_proof_cannot_deliver_unreviewed_earlier_changes(self):
        original = self.base
        self.base_files["auth.py"] = "def permit(actor): return actor == 'owner'\n"
        self.base = self.repo.commit(self.base_files, (original,))
        ours, theirs, _ = self.pair({"docs/left.md": "Left documentation\n"},
                                   {"docs/right.md": "Right documentation\n"})
        tree = source_fence(self.repo.root, ours, theirs, "auto")["candidateTree"]
        tip = self.repo.command("commit-tree", tree, "-p", ours, "-p", theirs,
                                text="Documentation merge\n")
        plan = manifest(self.repo, ours, theirs, tip)
        self.assertNotIn("auth.py", {e["path"] for e in plan["scope"]["files"]})
        self.repo.checkout(tip)
        output = Path(self.repo.temp.name)
        results = run_checks(plan, self.repo.root, output / "results.json")
        (output / "plan.json").write_text(json.dumps(plan))
        (output / "review.json").write_text(json.dumps(review_for(plan, results)))
        target = output / "target"
        subprocess.run(["git", "worktree", "add", "-q", "--detach", str(target), original],
                       cwd=self.repo.root, check=True)
        try:
            result = subprocess.run(
                [sys.executable, str(SCRIPTS / "integration_gate.py"), "fanout",
                 "--ours", ours, "--theirs", theirs, "--candidate", tip,
                 "--target", str(target), "--target-head", original,
                 "--plan", str(output / "plan.json"), "--results", str(output / "results.json"),
                 "--review", str(output / "review.json"), "--execute"],
                cwd=self.repo.root, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("UNREVIEWED_TARGET_SOURCE", result.stderr)
            self.assertEqual(git(target, "rev-parse", "HEAD"), original)
        finally:
            subprocess.run(["git", "worktree", "remove", str(target)],
                           cwd=self.repo.root, check=True)


def historical_replay(root: Path) -> dict:
    fixture = json.loads((Path(__file__).resolve().parents[3] /
                          "tooling/review-fixtures/integration-settings-history.json").read_text())
    path = fixture["path"]
    # Isolate just the exact historical file blobs in real topology, avoiding
    # unrelated thousands of files and keeping the original repo read-only.
    with tempfile.TemporaryDirectory(prefix="pt-settings-history-"):
        repo = Repository()
        try:
            old = subprocess.check_output(
                ["git", "show", fixture["oldBlob"]], cwd=root, text=True)
            new = subprocess.check_output(
                ["git", "show", fixture["acceptedBlob"]], cwd=root, text=True)
            old_tip = repo.commit({path: old})
            accepted = repo.commit({path: new}, (old_tip,))
            ours = repo.commit({path: new, "left.py": "left=1\n"}, (accepted,))
            prior_branch = repo.commit({path: new, "api.py": "api=1\n"}, (accepted,))
            bad = repo.commit({path: old}, (accepted, prior_branch))
            fence = source_fence(repo.root, ours, bad, "auto")
            entry = next(e for e in inventory(repo.root, fence)["files"] if e["path"] == path)
            assert entry["baseBlob"] == fixture["acceptedBlob"]
            assert entry["candidateBlob"] == fixture["oldBlob"]
            assert entry["historicalReversion"]
            actual = source_fence(root, fixture["ours"], fixture["theirs"],
                                  fixture["propagationMerge"])
            assert actual["mergeBase"] == fixture["mergeBase"]
            assert git(root, "rev-parse", f"{actual['mergeBase']}:{path}") == fixture["acceptedBlob"]
            assert git(root, "rev-parse", f"{actual['ours']}:{path}") == fixture["acceptedBlob"]
            assert git(root, "rev-parse", f"{actual['theirs']}:{path}") == fixture["oldBlob"]
            plan = manifest(repo, ours, bad, "auto")
            try:
                validate_plan(plan, repo.root)
            except IntegrationError as error:
                assert fixture["expected"] in str(error), str(error)
                return {"case": "actual-settings-history", "status": "REJECTED",
                        "reason": str(error), "actualSource": actual}
            raise AssertionError("Settings regression was incorrectly admitted")
        finally:
            repo.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--historical-repo", type=Path)
    args = parser.parse_args()
    result = unittest.TextTestRunner(verbosity=2).run(
        unittest.defaultTestLoader.loadTestsFromTestCase(IntegrationRegressions))
    if args.historical_repo and result.wasSuccessful():
        print(json.dumps(historical_replay(args.historical_repo), indent=2))
    raise SystemExit(0 if result.wasSuccessful() else 1)
