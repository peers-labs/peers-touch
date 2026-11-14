#!/usr/bin/env python3
"""One fail-closed decision for submit, merge, reverse-sync and GitHub.

This validates current source, complete review scope and actually executed
checks. It does not grant permission or prove the honesty of a reviewer.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

from merge_scope import (
    IntegrationError, contains, digest, git, inventory, source_fence,
)


POLICY_FILES = (
    "tooling/scripts/review/integration_review.py",
    "tooling/scripts/review/merge_scope.py",
    "tooling/scripts/review/integration_gate.py",
    "tooling/scripts/review/integration_evidence.py",
    "docs/architecture/engineering/quality/integration-review.md",
)
FACETS = ("callers", "consumers", "registration", "protocol", "persistence", "runtime")
CODE_SUFFIXES = (".py", ".go", ".rs", ".ts", ".tsx", ".js", ".jsx", ".c", ".cpp",
                 ".h", ".java", ".kt", ".swift", ".proto", ".vue", ".svelte",
                 ".mjs", ".cjs", ".mts", ".cts", ".sh", ".bash", ".zsh", ".fish",
                 ".lua", ".rb", ".php", ".pl", ".ps1", ".kts", ".cxx", ".cc",
                 ".hpp", ".hh", ".hxx", ".m", ".mm", ".pyw")


def require(condition: bool, code: str, detail: str) -> None:
    if not condition:
        raise IntegrationError(f"{code}: {detail}")


def load(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise IntegrationError(f"MISSING_OR_INVALID_EVIDENCE: {path}: {error}") from error


def policy_digest() -> str:
    root = Path(__file__).resolve().parents[3]
    return digest({path: (root / path).read_text() for path in POLICY_FILES})


def prepare(root: Path, ours: str, theirs: str, candidate: str) -> dict:
    fence = source_fence(root, ours, theirs, candidate)
    scope = inventory(root, fence)
    return {
        "kind": "integration-review",
        "source": fence, "scope": scope, "policyDigest": policy_digest(),
        "executor": "", "intent": {"ours": "", "theirs": ""},
        "checks": [], "outcomes": [], "bundles": [], "standardDecisions": [],
    }


def current(plan: dict, root: Path, ours: str, theirs: str, candidate: str) -> None:
    require(plan.get("kind") == "integration-review", "INVALID_PLAN", "kind")
    require(plan.get("source") == source_fence(root, ours, theirs, candidate),
            "STALE_SOURCE", "parent, merge base or candidate tree moved")
    require(plan.get("policyDigest") == policy_digest(), "STALE_POLICY", "reprepare")
    require(plan.get("scope") == inventory(root, plan["source"]),
            "SCOPE_TAMPERED", "bilateral or architecture inventory was narrowed")


def reference(root: Path, value: dict) -> None:
    require(isinstance(value, dict), "ACCEPTED_CHANGE_REQUIRED", "reference object")
    revision, path = value.get("revision", ""), value.get("path", "")
    require(isinstance(path, str) and path.startswith("docs/"),
            "ACCEPTED_CHANGE_REQUIRED", "owning requirement must be a docs reference")
    require(bool(value.get("rationale", "").strip()),
            "ACCEPTED_CHANGE_REQUIRED", "explain accepted requirement change")
    git(root, "cat-file", "-e", f"{revision}:{path}")
    require(git(root, "cat-file", "-t", f"{revision}:{path}") == "blob",
            "ACCEPTED_CHANGE_REQUIRED", "reference must identify a requirement file")


def selected(check: dict) -> bool:
    return check["classification"] == "required" or (
        check["classification"] == "conditional" and check["triggered"])


def baseline_token(side: str, path: str) -> str:
    return f"{{baseline:{side}:{path}}}"


def validate_plan(plan: dict, root: Path) -> None:
    require(bool(plan.get("executor", "").strip()), "INTENT_REQUIRED", "executor")
    require(all(plan.get("intent", {}).get(side, "").strip()
                for side in ("ours", "theirs")),
            "INTENT_REQUIRED", "explain both branches, including automatic merges")
    checks = plan.get("checks", [])
    require(isinstance(checks, list) and bool(checks), "CHECKS_REQUIRED", "empty list")
    ids = [check.get("id") for check in checks]
    require(all(isinstance(key, str) and key for key in ids) and len(set(ids)) == len(ids),
            "INVALID_CHECK", "IDs must be unique")
    for check in checks:
        require(check.get("classification") in ("required", "conditional", "advisory"),
                "INVALID_CHECK", f"{check['id']} classification")
        require(bool(check.get("rationale", "").strip()), "INVALID_CHECK",
                f"{check['id']} needs pre-execution relevance/rationale")
        require(check.get("kind") in ("structural", "build", "test", "functional"),
                "INVALID_CHECK", f"{check['id']} kind")
        require(check.get("format") in ("exit", "unittest", "tap", "junit", "vitest"),
                "INVALID_CHECK", f"{check['id']} report format")
        require(check["kind"] in ("structural", "build") or check["format"] != "exit",
                "ZERO_CASES", "exit code alone cannot prove a test/Journey")
        require(isinstance(check.get("argv"), list) and bool(check["argv"])
                and all(isinstance(arg, str) for arg in check["argv"]),
                "INVALID_CHECK", f"{check['id']} argv")
        require(type(check.get("timeoutSeconds", 600)) is int
                and 0 < check.get("timeoutSeconds", 600) <= 3600,
                "INVALID_CHECK", f"{check['id']} bounded timeout")
        require(bool(check.get("covers"))
                and all(isinstance(path, str) and path and not Path(path).is_absolute()
                        and ".." not in Path(path).parts for path in check["covers"]),
                "INVALID_CHECK", f"{check['id']} must name the paths it exercises")
        for baseline in check.get("baselineInputs", []):
            side, path = baseline.get("side"), baseline.get("path", "")
            require(side in ("ours", "theirs") and protected_path(plan, path, side),
                    "BASELINE_REQUIRED", "original standard must be in bilateral scope")
            require(baseline_token(side, path) in check["argv"],
                    "BASELINE_REQUIRED", "argv must execute the original standard input")
        cwd = check.get("cwd", ".")
        require(isinstance(cwd, str) and not Path(cwd).is_absolute()
                and ".." not in Path(cwd).parts,
                "INVALID_CHECK", f"{check['id']} cwd")
        if check["classification"] == "conditional":
            require(isinstance(check.get("triggered"), bool), "INVALID_CHECK",
                    "conditional trigger must be decided before execution")
    required = {check["id"] for check in checks if selected(check)}
    require(bool(required), "CHECKS_REQUIRED", "advisory-only manifests cannot pass")
    entries = {entry["path"]: entry for entry in plan["scope"]["files"]}
    outcomes = plan.get("outcomes", [])
    require(len(outcomes) == len(entries)
            and {entry.get("path") for entry in outcomes} == set(entries),
            "OUTCOME_MISSING", "every bilateral changed/auto-merged path needs a decision")
    for outcome in outcomes:
        entry = entries[outcome["path"]]
        require(outcome.get("decision") in ("PRESERVED", "INTENTIONALLY_SUPERSEDED"),
                "OUTCOME_UNPROVEN", outcome["path"])
        require(bool(outcome.get("reason", "").strip()), "OUTCOME_UNPROVEN",
                outcome["path"])
        proof = set(outcome.get("checks", []))
        require(bool(proof) and proof <= required, "OUTCOME_UNPROVEN",
                f"{outcome['path']} requires executed mandatory proof")
        relevant = [check for check in checks if check["id"] in proof
                    and any(contains(prefix, outcome["path"]) for prefix in check["covers"])]
        require(len(relevant) == len(proof), "CHECK_SCOPE_MISMATCH", outcome["path"])
        if outcome["path"].endswith(CODE_SUFFIXES) or entry["executable"]:
            require(any(check["kind"] == "build" for check in relevant),
                    "AFFECTED_BUILD_UNPROVEN", outcome["path"])
            require(any(check["kind"] in ("test", "functional") for check in relevant),
                    "AFFECTED_BEHAVIOR_UNPROVEN", outcome["path"])
        if entry["ui"]:
            require(any(check["id"] in proof and check["kind"] == "functional"
                        for check in checks),
                    "UI_INTERACTION_UNPROVEN", outcome["path"])
        if outcome["decision"] == "INTENTIONALLY_SUPERSEDED":
            reference(root, outcome.get("acceptedChange"))
        if entry["historicalReversion"]:
            require(outcome["decision"] == "INTENTIONALLY_SUPERSEDED"
                    or bool(outcome.get("reversionAnalysis", "").strip()),
                    "HISTORICAL_REVERSION_UNPROVEN", outcome["path"])
    standards = {
        path for path, entry in entries.items()
        if entry["standard"] and entry["differsFrom"]
    }
    decisions = plan.get("standardDecisions", [])
    require(len(decisions) == len(standards)
            and {entry.get("path") for entry in decisions} == standards,
            "STANDARDS_CHANGE_UNREVIEWED", "changed tests/Gates need separate decisions")
    for decision in decisions:
        require(decision.get("decision") in ("equivalent", "requirement-change"),
                "STANDARDS_WEAKENED", decision["path"])
        require(bool(decision.get("reason", "").strip()),
                "STANDARDS_WEAKENED", decision["path"])
        require(bool(set(decision.get("checks", [])) & required),
                "STANDARDS_WEAKENED", decision["path"])
        if decision["decision"] == "requirement-change":
            reference(root, decision.get("acceptedChange"))
        else:
            require(bool(decision.get("retainedAssertions", "").strip()),
                    "STANDARDS_WEAKENED", "explain unchanged assertions and baseline proof")
            entry = entries[decision["path"]]
            for side in entry["differsFrom"]:
                require(any(
                    check["id"] in decision.get("checks", []) and selected(check)
                    and {"side": side, "path": decision["path"]}
                    in check.get("baselineInputs", []) for check in checks),
                    "BASELINE_REQUIRED", f"{side}:{decision['path']}")
    bundles = plan.get("bundles", [])
    owners = {owner["id"] for owner in plan["scope"]["architecture"]}
    require(len(bundles) == len(owners) and {b.get("id") for b in bundles} == owners,
            "DEPENDENCY_CLOSURE_UNREVIEWED", "every registered affected owner")
    for bundle in bundles:
        require(bool(bundle.get("contract", "").strip())
                and all(bundle.get(facet, "").strip() for facet in FACETS),
                "DEPENDENCY_CLOSURE_UNREVIEWED", bundle["id"])
        require(bool(set(bundle.get("checks", [])) & required),
                "DEPENDENCY_CLOSURE_UNREVIEWED", bundle["id"])
        bundle_checks = [check for check in checks
                         if check["id"] in bundle.get("checks", []) and selected(check)]
        require(any(check["kind"] == "build" for check in bundle_checks)
                and any(check["kind"] in ("test", "functional") for check in bundle_checks),
                "DEPENDENCY_BUILD_OR_BEHAVIOR_UNPROVEN", bundle["id"])
        owner = next(o for o in plan["scope"]["architecture"] if o["id"] == bundle["id"])
        dispositions = bundle.get("gateDispositions", [])
        require(len(dispositions) == len(owner["gates"])
                and {d.get("gate") for d in dispositions} == set(owner["gates"]),
                "GATE_SELECTION_UNREVIEWED", bundle["id"])
        for disposition in dispositions:
            require(disposition.get("classification") in
                    ("required", "conditional", "advisory")
                    and bool(disposition.get("reason", "").strip()),
                    "GATE_SELECTION_UNREVIEWED", disposition["gate"])
            if disposition["classification"] == "conditional":
                require(isinstance(disposition.get("triggered"), bool),
                        "GATE_SELECTION_UNREVIEWED", disposition["gate"])
            if disposition["classification"] == "required" or (
                    disposition["classification"] == "conditional" and disposition["triggered"]):
                require(disposition.get("check") in required
                        and disposition["check"] in bundle.get("checks", []),
                        "GATE_SELECTION_UNREVIEWED", disposition["gate"])

def protected_path(plan: dict, path: str, side: str) -> bool:
    return any(entry["path"] == path and entry["standard"]
               and side in entry["differsFrom"] for entry in plan["scope"]["files"])


def case_counts(check: dict, output: str, report_output: str = "") -> dict:
    """Derive case counts from the original runner; never accept caller PASS."""
    fmt = check["format"]
    if fmt == "exit":
        return {"executed": 1, "failed": 0, "skipped": 0}
    if fmt == "unittest":
        match = re.search(r"Ran (\d+) tests? in ", output)
        skipped = re.search(r"skipped=(\d+)", output)
        return {
            "executed": int(match[1]) if match else 0,
            "failed": sum(map(int, re.findall(r"(?:failures|errors)=(\d+)", output))),
            "skipped": int(skipped[1]) if skipped else 0,
        }
    if fmt == "tap":
        def count(name: str) -> int:
            match = re.search(rf"^# {name} (\d+)$", output, re.MULTILINE)
            return int(match[1]) if match else 0
        return {"executed": count("pass"), "failed": count("fail"),
                "skipped": count("skipped") + count("todo")}
    if fmt == "vitest":
        value = json.loads(report_output)
        require(isinstance(value.get("success"), bool), "REPORT_INCOMPLETE", check["id"])
        for key in ("numPassedTests", "numFailedTests", "numTotalTests"):
            require(type(value.get(key)) is int and value[key] >= 0,
                    "REPORT_INCOMPLETE", f"{check['id']}:{key}")
        for key in ("numFailedTestSuites", "numRuntimeErrorTestSuites",
                    "numPendingTests", "numTodoTests"):
            require(type(value.get(key, 0)) is int and value.get(key, 0) >= 0,
                    "REPORT_INCOMPLETE", f"{check['id']}:{key}")
        failed = max(value["numFailedTests"], value.get("numFailedTestSuites", 0),
                     value.get("numRuntimeErrorTestSuites", 0), int(not value["success"]),
                     sum(item.get("status") == "failed"
                         for item in value.get("testResults", [])))
        skipped = value.get("numPendingTests", 0) + value.get("numTodoTests", 0)
        require(failed or skipped or value["numPassedTests"] == value["numTotalTests"],
                "REPORT_INCONSISTENT", check["id"])
        return {
            "executed": value["numPassedTests"], "failed": failed, "skipped": skipped,
        }
    suites = ET.fromstring(report_output)
    require(suites.tag in ("testsuite", "testsuites"), "REPORT_INCOMPLETE", check["id"])
    cases = suites.findall(".//testcase")
    summaries = [suites, *suites.findall(".//testsuite")]
    for suite in summaries:
        require(all(int(suite.attrib.get(key, 0)) >= 0
                    for key in ("tests", "failures", "errors", "skipped")),
                "REPORT_INCOMPLETE", check["id"])
        if "tests" in suite.attrib:
            require(int(suite.attrib["tests"]) == len(suite.findall(".//testcase")),
                    "REPORT_INCONSISTENT", check["id"])
    failed = max(
        sum(case.find("failure") is not None or case.find("error") is not None for case in cases),
        sum(int(suite.attrib.get("failures", 0)) + int(suite.attrib.get("errors", 0))
            for suite in summaries),
        len(suites.findall(".//error")) + len(suites.findall(".//failure")),
    )
    skipped = max(sum(case.find("skipped") is not None for case in cases),
                  sum(int(suite.attrib.get("skipped", 0)) for suite in summaries))
    return {
        "executed": sum(not any(case.find(tag) is not None for tag in
                               ("skipped", "failure", "error")) for case in cases),
        "failed": failed, "skipped": skipped,
    }


def assert_materialized(plan: dict, root: Path) -> None:
    require(not git(root, "diff", "--name-only"), "DIRTY_CANDIDATE",
            "unstaged changes are not the staged candidate")
    require(not git(root, "ls-files", "--others", "--exclude-standard"),
            "DIRTY_CANDIDATE", "untracked sources can affect the runner")
    require(git(root, "write-tree") == plan["source"]["candidateTree"],
            "WRONG_CHECK_SOURCE", "run on the candidate tree, not either parent")


def run_checks(plan: dict, root: Path, output: Path) -> dict:
    validate_plan(plan, root)
    assert_materialized(plan, root)
    records = []
    for check in plan["checks"]:
        if not selected(check):
            continue
        cwd = (root / check.get("cwd", ".")).resolve()
        require(cwd.is_relative_to(root.resolve()), "INVALID_CHECK", "cwd escape")
        if check["format"] in ("junit", "vitest"):
            report = (cwd / check.get("report", "")).resolve()
            require(report.is_relative_to(output.parent.resolve()), "INVALID_CHECK",
                    "reports must live with external review evidence")
            require(not report.exists(), "STALE_REPORT", str(report))
        started = time.monotonic()
        argv = list(check["argv"])
        baseline_records = []
        for baseline in check.get("baselineInputs", []):
            side, path = baseline["side"], baseline["path"]
            blob = git(root, "rev-parse", f"{plan['source'][side]}:{path}")
            original = subprocess.check_output(["git", "cat-file", "blob", blob], cwd=root)
            destination = output.parent / "baseline" / side / path
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(original)
            mode = next(entry[f"{side}Entry"]["mode"] for entry in plan["scope"]["files"]
                        if entry["path"] == path)
            destination.chmod(int(mode, 8) & 0o777)
            argv = [str(destination.resolve()) if arg == baseline_token(side, path)
                    else arg for arg in argv]
            baseline_records.append({"side": side, "path": path, "blob": blob, "mode": mode})
        report_output = ""
        try:
            env = None
            if baseline_records:
                # Original Python tests remain byte-for-byte intact; imports
                # resolve against the final candidate, not the old parent.
                import os
                env = {**os.environ, "PYTHONPATH": str(root.resolve())}
            result = subprocess.run(argv, cwd=cwd, env=env, capture_output=True, text=True,
                                    timeout=check.get("timeoutSeconds", 600))
            combined = result.stdout + "\n" + result.stderr
            if check["format"] in ("junit", "vitest"):
                require(report.is_file(), "REPORT_MISSING", check["id"])
                report_output = report.read_text()
            counts = case_counts(check, combined, report_output)
            code = result.returncode
        except (OSError, ValueError, ET.ParseError,
                subprocess.TimeoutExpired) as error:
            code, combined = 127, str(error)
            counts = {"executed": 0, "failed": 0, "skipped": 0}
        records.append({
            "id": check["id"], "checkDigest": digest(check),
            "exitCode": code, "counts": counts, "output": combined,
            "reportOutput": report_output, "baselineInputs": baseline_records,
            "durationSeconds": time.monotonic() - started,
        })
        # Detect a generator/check rewriting sources before recording PASS.
        assert_materialized(plan, root)
    result = {"planDigest": digest(plan), "records": records}
    output.write_text(json.dumps(result, indent=2) + "\n")
    return result


def validate_results(plan: dict, results: dict) -> None:
    require(results.get("planDigest") == digest(plan), "STALE_CHECKS", "manifest changed")
    records = results.get("records", [])
    require(len({record.get("id") for record in records}) == len(records),
            "INVALID_RESULTS", "duplicate check results")
    by_id = {record["id"]: record for record in records}
    for check in plan["checks"]:
        if not selected(check):
            continue
        record = by_id.get(check["id"])
        require(record is not None, "REQUIRED_CHECK_MISSING", check["id"])
        require(record["checkDigest"] == digest(check), "STALE_CHECKS", check["id"])
        require(record["exitCode"] == 0, "REQUIRED_CHECK_FAILED", check["id"])
        counts = record["counts"]
        require(counts == case_counts(check, record["output"], record.get("reportOutput", "")),
                "RESULT_COUNTS_MISMATCH", check["id"])
        expected = [{"side": value["side"], "path": value["path"],
                     "blob": next(entry[f"{value['side']}Blob"]
                                  for entry in plan["scope"]["files"]
                                  if entry["path"] == value["path"]),
                     "mode": next(entry[f"{value['side']}Entry"]["mode"]
                                  for entry in plan["scope"]["files"]
                                  if entry["path"] == value["path"])}
                    for value in check.get("baselineInputs", [])]
        require(record.get("baselineInputs", []) == expected,
                "BASELINE_REQUIRED", check["id"])
        require(type(counts.get("executed")) is int and counts["executed"] > 0,
                "ZERO_CASES", check["id"])
        require(counts.get("failed") == 0 and counts.get("skipped") == 0,
                "REQUIRED_CHECK_SKIPPED_OR_FAILED", check["id"])


def validate_review(plan: dict, review: dict, results: dict) -> None:
    require(review.get("planDigest") == digest(plan), "STALE_REVIEW", "manifest changed")
    require(review.get("resultsDigest") == digest(results), "STALE_REVIEW", "original results changed")
    require(bool(review.get("reviewer", "").strip())
            and review["reviewer"] != plan["executor"],
            "INDEPENDENT_REVIEW_REQUIRED", "separate reviewing principal")
    paths = {entry["path"] for entry in plan["scope"]["files"]}
    require(set(review.get("reviewedPaths", [])) == paths,
            "REVIEW_SCOPE_MISSING", "read both intents and the final candidate")
    require(review.get("findings") == [], "REVIEW_FINDINGS", "unresolved findings")
    require(set(review.get("reviewedOwners", [])) ==
            {owner["id"] for owner in plan["scope"]["architecture"]},
            "REVIEW_SCOPE_MISSING", "architecture closure")
    decisions = review.get("standardsDecisions", [])
    require({decision.get("path") for decision in decisions} ==
            {decision["path"] for decision in plan["standardDecisions"]}
            and all(decision.get("verdict") == "supported"
                    and decision.get("reason", "").strip() for decision in decisions),
            "STANDARDS_WEAKENED", "review original assertions independently")
    cases = review.get("counterexamples", [])
    require(bool(cases), "COUNTEREXAMPLE_REQUIRED", "identity alone is insufficient")
    required = {check["id"] for check in plan["checks"]
                if check["classification"] == "required"
                or check["classification"] == "conditional" and check["triggered"]}
    for case in cases:
        require(bool(case.get("scenario", "").strip())
                and bool(case.get("whyRejected", "").strip())
                and case.get("check") in required,
                "COUNTEREXAMPLE_REQUIRED", "scenario, reasoning and executable proof")
    reverts = {entry["path"] for entry in plan["scope"]["files"]
               if entry["historicalReversion"]}
    require(reverts <= {case.get("path") for case in cases},
            "HISTORICAL_REVERSION_UNPROVEN", "reviewer must challenge every historic revert")
    require(bool(review.get("standardsAnalysis", "").strip())
            and bool(review.get("dependencyAnalysis", "").strip()),
            "INDEPENDENT_REVIEW_REQUIRED", "explain standards and cross-file agreement")


def verify_evidence(root: Path, ours: str, theirs: str, candidate: str,
                    plan_path: Path, results_path: Path, review_path: Path) -> dict:
    for path in (plan_path, results_path, review_path):
        require(not path.resolve().is_relative_to(root.resolve()),
                "EXTERNAL_EVIDENCE_REQUIRED", str(path))
    plan, results, review = (load(path) for path in (plan_path, results_path, review_path))
    current(plan, root, ours, theirs, candidate)
    validate_plan(plan, root)
    assert_materialized(plan, root)
    validate_results(plan, results)
    validate_review(plan, review, results)
    return plan


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "run", "verify"))
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--ours", default="HEAD")
    parser.add_argument("--theirs", required=True)
    parser.add_argument("--candidate", default="auto")
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--results", type=Path)
    parser.add_argument("--review", type=Path)
    args = parser.parse_args()
    try:
        root = Path(git(args.repo_root, "rev-parse", "--show-toplevel"))
        require(not args.plan.resolve().is_relative_to(root.resolve()),
                "EXTERNAL_EVIDENCE_REQUIRED", "plan belongs outside the source tree")
        if args.action == "prepare":
            plan = prepare(root, args.ours, args.theirs, args.candidate)
            args.plan.write_text(json.dumps(plan, indent=2) + "\n")
            print(json.dumps({"status": "PREPARED", "source": plan["source"],
                              "paths": len(plan["scope"]["files"])}))
            return 0
        if args.action == "verify":
            require(args.results is not None, "RESULTS_REQUIRED", "--results")
            require(args.review is not None, "INDEPENDENT_REVIEW_REQUIRED", "--review")
            verify_evidence(root, args.ours, args.theirs, args.candidate,
                            args.plan, args.results, args.review)
            print("integration-review: PASS")
            return 0
        plan = load(args.plan)
        current(plan, root, args.ours, args.theirs, args.candidate)
        validate_plan(plan, root)
        require(args.results is not None, "RESULTS_REQUIRED", "--results")
        for path in (args.results, args.review):
            if path:
                require(not path.resolve().is_relative_to(root.resolve()),
                        "EXTERNAL_EVIDENCE_REQUIRED", str(path))
        results = run_checks(plan, root, args.results)
        current(plan, root, args.ours, args.theirs, args.candidate)
        validate_results(plan, results)
        print("integration-review: CHECKS_PASSED (semantic review still required)")
        return 0
    except (ValueError, KeyError, TypeError, AttributeError, OSError, ET.ParseError) as error:
        print(f"integration-review: BLOCKED: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
