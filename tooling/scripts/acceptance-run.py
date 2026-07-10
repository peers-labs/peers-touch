#!/usr/bin/env python3
"""Run acceptance gates from the current plan or explicit gate ids."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import time
from pathlib import Path
from typing import Any

JSON_REPORT_PATTERN = re.compile(r"tooling/acceptance/reports/[^\s`'\"]+\.json")
RUN_ARTIFACT_KIND = "acceptance-run"
RESULT_ARTIFACT_KIND = "acceptance-gate-result"
RESULT_TRACEABILITY_FIELDS = ("sourceArtifact", "sourceArtifactKind", "sourcePhase", "sourceBom", "sourceSpec", "sourceGate")
DEFAULT_PLAN_PATH = Path("tooling/acceptance/reports/latest-plan.json")


def load_plan(path: Path) -> dict[str, Any]:
    if not path.exists():
        if path != DEFAULT_PLAN_PATH:
            raise SystemExit(f"acceptance plan {str(path)!r} does not exist")
        subprocess.run(["python3", "tooling/scripts/acceptance-plan.py"], check=True)
    return json.loads(path.read_text(encoding="utf-8"))


def load_gate_definitions(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8")).get("gates", {})


def gate_from_definition(gate_id: str, definition: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": gate_id,
        "command": definition["command"],
        "timeout_seconds": definition.get("timeout_seconds", 600),
        "environment": definition.get("environment", "local"),
        "tier": definition.get("tier", "local-evidence"),
        "description": definition.get("description", ""),
        "required_by": ["manual"],
    }


def plan_gate_from_entry(entry: Any, definitions: dict[str, Any]) -> dict[str, Any]:
    if isinstance(entry, str):
        if entry not in definitions:
            raise SystemExit(f"gate {entry!r} is missing from gate definitions")
        return gate_from_definition(entry, definitions[entry])
    if not isinstance(entry, dict):
        raise SystemExit(f"plan selected_gates entry must be a gate id string or object: {entry!r}")
    gate_id = entry.get("id")
    if not isinstance(gate_id, str) or not gate_id:
        raise SystemExit(f"plan selected_gates object is missing id: {entry!r}")
    if "command" in entry:
        return dict(entry)
    if gate_id not in definitions:
        raise SystemExit(f"gate {gate_id!r} is missing from gate definitions")
    gate = gate_from_definition(gate_id, definitions[gate_id])
    gate.update(entry)
    return gate


def selected_gates_from_plan(plan: dict[str, Any], definitions: dict[str, Any]) -> list[dict[str, Any]]:
    return [plan_gate_from_entry(entry, definitions) for entry in plan.get("selected_gates", [])]


def filter_gates_by_tier(gates: list[dict[str, Any]], tiers: list[str]) -> list[dict[str, Any]]:
    if not tiers:
        return gates
    selected = set(tiers)
    return [gate for gate in gates if gate.get("tier", "local-evidence") in selected]


def artifact_paths_from_log(log_text: str) -> list[Path]:
    paths: list[Path] = []
    seen: set[str] = set()
    for match in JSON_REPORT_PATTERN.findall(log_text):
        if match in seen:
            continue
        seen.add(match)
        paths.append(Path(match))
    return paths


def load_json_artifact(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def evidence_summary_from_artifact(path: Path, artifact: dict[str, Any]) -> dict[str, Any]:
    summary: dict[str, Any] = {"path": str(path)}
    for key in (
        "artifactKind",
        "status",
        "completionStatus",
        "proofStatus",
        "phase",
        "bom",
        "spec",
        "gate",
        "reason",
        "failedStep",
        "sampleEmissionAllowed",
    ):
        if key in artifact:
            summary[key] = artifact[key]
    details = artifact.get("details", artifact.get("evidenceDetails"))
    if isinstance(details, list):
        summary["details"] = details
        summary["evidenceDetails"] = details
    issue_breakdown = artifact.get("issue_breakdown", artifact.get("issueBreakdown"))
    if isinstance(issue_breakdown, list):
        summary["issue_breakdown"] = issue_breakdown
        summary["issueBreakdown"] = issue_breakdown
    review_commands = artifact.get("recommended_review_commands", artifact.get("recommendedReviewCommands"))
    if isinstance(review_commands, list):
        summary["recommended_review_commands"] = review_commands
        summary["recommendedReviewCommands"] = review_commands
    return summary


def reason_from_issue_breakdown(summary: dict[str, Any]) -> str | None:
    issues = summary.get("issue_breakdown", summary.get("issueBreakdown"))
    if not isinstance(issues, list):
        return None
    for issue in issues:
        if not isinstance(issue, dict):
            continue
        reason = issue.get("summary")
        if isinstance(reason, str) and reason:
            return reason
    return None


def enrich_result_with_evidence(result: dict[str, Any], log_text: str) -> dict[str, Any]:
    artifacts: list[dict[str, Any]] = []
    for path in artifact_paths_from_log(log_text):
        artifact = load_json_artifact(path)
        if artifact is None:
            continue
        artifacts.append(evidence_summary_from_artifact(path, artifact))
    if not artifacts:
        return result
    enriched = dict(result)
    enriched["evidenceArtifacts"] = artifacts
    primary = artifacts[0]
    enriched["sourceArtifact"] = primary.get("path")
    for source_key, target_key in (
        ("artifactKind", "sourceArtifactKind"),
        ("status", "evidenceStatus"),
        ("completionStatus", "completionStatus"),
        ("proofStatus", "proofStatus"),
        ("phase", "phase"),
        ("bom", "bom"),
        ("spec", "spec"),
        ("gate", "gate"),
        ("reason", "reason"),
        ("failedStep", "failedStep"),
        ("sampleEmissionAllowed", "sampleEmissionAllowed"),
    ):
        if source_key in primary:
            enriched[target_key] = primary[source_key]
    for source_key, target_key in (
        ("phase", "sourcePhase"),
        ("bom", "sourceBom"),
        ("spec", "sourceSpec"),
        ("gate", "sourceGate"),
    ):
        if source_key in primary:
            enriched[target_key] = primary[source_key]
    for key in (
        "details",
        "evidenceDetails",
        "issue_breakdown",
        "issueBreakdown",
        "recommended_review_commands",
        "recommendedReviewCommands",
    ):
        if key in primary:
            enriched[key] = primary[key]
    if not enriched.get("reason"):
        issue_reason = reason_from_issue_breakdown(primary)
        if issue_reason:
            enriched["reason"] = issue_reason
    return enriched


def dedupe_review_commands(results: list[dict[str, Any]]) -> list[dict[str, str]]:
    commands: list[dict[str, str]] = []
    seen: set[str] = set()
    for result in results:
        source_commands = result.get("recommended_review_commands", result.get("recommendedReviewCommands"))
        if not isinstance(source_commands, list):
            continue
        for command in source_commands:
            if not isinstance(command, dict):
                continue
            purpose = command.get("purpose")
            command_text = command.get("command")
            if not isinstance(purpose, str) or not isinstance(command_text, str):
                continue
            key = command_text
            if key in seen:
                continue
            seen.add(key)
            commands.append({"purpose": purpose, "command": command_text})
    return commands


def result_is_incomplete(result: dict[str, Any]) -> bool:
    if result.get("status") not in {"passed", "dry-run"}:
        return True
    if result.get("completionStatus") == "PARTIAL":
        return True
    return result.get("proofStatus") == "UNPROVEN"


def result_traceability(result: dict[str, Any]) -> dict[str, Any]:
    missing = [key for key in RESULT_TRACEABILITY_FIELDS if key not in result]
    incomplete = result_is_incomplete(result)
    if not missing:
        status = "complete"
        reason = "result preserves source artifact Phase/BOM/Spec/Gate traceability"
    elif incomplete:
        status = "missing"
        reason = "incomplete acceptance result is missing source artifact Phase/BOM/Spec/Gate traceability"
    else:
        status = "not-required"
        reason = "passed static/local gate does not emit a source evidence artifact"
    trace: dict[str, Any] = {
        "status": status,
        "missingFields": missing,
        "reason": reason,
    }
    for key in RESULT_TRACEABILITY_FIELDS:
        if key in result:
            trace[key] = result[key]
    return trace


def standardize_result(result: dict[str, Any], plan_path: str) -> dict[str, Any]:
    standardized = dict(result)
    gate_id = str(standardized.get("id") or "unknown")
    standardized.setdefault("artifactKind", RESULT_ARTIFACT_KIND)
    standardized.setdefault("artifactPath", standardized.get("log") or standardized.get("sourceArtifact") or f"{plan_path}#results/{gate_id}")
    standardized.setdefault("sampleEmissionAllowed", False)
    standardized["traceability"] = result_traceability(standardized)
    return standardized


def run_issue_breakdown(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    for result in results:
        if not result_is_incomplete(result):
            continue
        gate_id = str(result.get("id") or "unknown")
        source_artifact = result.get("sourceArtifact")
        source_artifact_kind = result.get("sourceArtifactKind")
        source_details = result.get("details", result.get("evidenceDetails"))
        source_trace = {
            key: result[key]
            for key in ("sourcePhase", "sourceBom", "sourceSpec", "sourceGate")
            if key in result
        }
        source_issues = result.get("issue_breakdown", result.get("issueBreakdown"))
        if isinstance(source_issues, list) and source_issues:
            for issue in source_issues:
                if not isinstance(issue, dict):
                    continue
                run_issue = {
                    "category": str(issue.get("category") or f"acceptance-gate:{gate_id}"),
                    "failedStep": str(issue.get("failedStep") or gate_id),
                    "status": str(issue.get("status") or result.get("evidenceStatus") or "diagnostic incomplete"),
                    "completionStatus": str(issue.get("completionStatus") or result.get("completionStatus") or "PARTIAL"),
                    "proofStatus": str(issue.get("proofStatus") or result.get("proofStatus") or "UNPROVEN"),
                    "sampleEmissionAllowed": issue.get("sampleEmissionAllowed")
                    if isinstance(issue.get("sampleEmissionAllowed"), bool)
                    else result.get("sampleEmissionAllowed") is True,
                    "summary": str(issue.get("summary") or result.get("reason") or "acceptance gate failed"),
                    "proofImpact": str(
                        issue.get("proofImpact")
                        or "Acceptance run remains PARTIAL/UNPROVEN until this gate passes."
                    ),
                    "acceptanceGateId": gate_id,
                }
                if isinstance(source_artifact, str):
                    run_issue["sourceArtifact"] = source_artifact
                if isinstance(source_artifact_kind, str):
                    run_issue["sourceArtifactKind"] = source_artifact_kind
                run_issue.update(source_trace)
                if isinstance(source_details, list):
                    run_issue["details"] = source_details
                    run_issue["evidenceDetails"] = source_details
                issues.append(run_issue)
            continue
        run_issue = {
            "category": f"acceptance-gate:{gate_id}",
            "failedStep": gate_id,
            "status": str(result.get("evidenceStatus") or "diagnostic incomplete"),
            "completionStatus": str(result.get("completionStatus") or "PARTIAL"),
            "proofStatus": str(result.get("proofStatus") or "UNPROVEN"),
            "sampleEmissionAllowed": result.get("sampleEmissionAllowed") is True,
            "summary": str(result.get("reason") or "acceptance gate remains incomplete without source diagnostics"),
            "proofImpact": "Acceptance run remains PARTIAL/UNPROVEN until this gate emits proven source evidence.",
            "acceptanceGateId": gate_id,
        }
        if isinstance(source_artifact, str):
            run_issue["sourceArtifact"] = source_artifact
        if isinstance(source_artifact_kind, str):
            run_issue["sourceArtifactKind"] = source_artifact_kind
        run_issue.update(source_trace)
        if isinstance(source_details, list):
            run_issue["details"] = source_details
            run_issue["evidenceDetails"] = source_details
        issues.append(run_issue)
    return issues


def unique_ordered(values: list[Any]) -> list[Any]:
    unique: list[Any] = []
    seen: set[str] = set()
    for value in values:
        key = json.dumps(value, sort_keys=True, ensure_ascii=False)
        if key in seen:
            continue
        seen.add(key)
        unique.append(value)
    return unique


def aggregate_source_values(results: list[dict[str, Any]], key: str) -> list[Any]:
    values: list[Any] = []
    for result in results:
        value = result.get(key)
        if value is None:
            continue
        if isinstance(value, list):
            values.extend(value)
        else:
            values.append(value)
    return unique_ordered(values)


def missing_result_traceability_count(results: list[dict[str, Any]]) -> int:
    return sum(
        1
        for result in results
        if result.get("status") != "dry-run" and result.get("traceability", {}).get("status") == "missing"
    )


def result_traceability_state(results: list[dict[str, Any]]) -> dict[str, Any]:
    missing = [
        {
            "acceptanceGateId": result.get("id"),
            "artifactKind": result.get("artifactKind"),
            "artifactPath": result.get("artifactPath"),
            **result.get("traceability", {}),
        }
        for result in results
        if result.get("status") != "dry-run" and result.get("traceability", {}).get("status") == "missing"
    ]
    status = "pass" if not missing else "diagnostic incomplete"
    return {
        "artifactKind": "acceptance-run-result-traceability-state",
        "status": status,
        "completionStatus": "DONE" if status == "pass" else "PARTIAL",
        "proofStatus": "PROVEN" if status == "pass" else "UNPROVEN",
        "sampleEmissionAllowed": False,
        "missingTraceabilityCount": len(missing),
        "missingTraceability": missing,
    }


def build_run_report(plan_path: str, results: list[dict[str, Any]]) -> dict[str, Any]:
    results = [standardize_result(result, plan_path) for result in results]
    failed = [result for result in results if result.get("status") not in {"passed", "dry-run"}]
    dry_run = [result for result in results if result.get("status") == "dry-run"]
    partial = [result for result in results if result.get("completionStatus") == "PARTIAL"]
    unproven = [result for result in results if result.get("proofStatus") == "UNPROVEN"]
    incomplete = [result for result in results if result_is_incomplete(result)]
    passed_but_unproven = [
        result for result in results if result.get("status") == "passed" and result.get("proofStatus") == "UNPROVEN"
    ]
    missing_traceability = missing_result_traceability_count(results)
    sample_emission_allowed = (
        bool(results)
        and not failed
        and not dry_run
        and not partial
        and not unproven
        and not incomplete
        and missing_traceability == 0
    )
    report: dict[str, Any] = {
        "artifactKind": RUN_ARTIFACT_KIND,
        "plan": plan_path,
        "sourceArtifact": plan_path,
        "summary": {
            "total": len(results),
            "passed": len([result for result in results if result.get("status") == "passed"]),
            "failed": len(failed),
            "dryRun": len(dry_run),
            "partial": len(partial),
            "unproven": len(unproven),
            "incomplete": len(incomplete),
            "passedButUnproven": len(passed_but_unproven),
            "missingResultTraceability": missing_traceability,
            "sampleEmissionAllowed": sample_emission_allowed,
        },
        "completionStatus": "DONE" if not incomplete else "PARTIAL",
        "proofStatus": "PROVEN" if not failed and not unproven else "UNPROVEN",
        "sampleEmissionAllowed": sample_emission_allowed,
        "resultTraceabilityState": result_traceability_state(results),
        "results": results,
    }
    source_phases = aggregate_source_values(results, "sourcePhase")
    source_bom = aggregate_source_values(results, "sourceBom")
    source_spec = aggregate_source_values(results, "sourceSpec")
    source_gates = aggregate_source_values(results, "sourceGate")
    if source_phases:
        report["sourcePhases"] = source_phases
    if source_bom:
        report["sourceBom"] = source_bom
    if source_spec:
        report["sourceSpec"] = source_spec
    if source_gates:
        report["sourceGates"] = source_gates
    if incomplete:
        issue_breakdown = run_issue_breakdown(results)
        review_commands = dedupe_review_commands(results)
        report["issue_breakdown"] = issue_breakdown
        report["issueBreakdown"] = issue_breakdown
        if review_commands:
            report["recommended_review_commands"] = review_commands
            report["recommendedReviewCommands"] = review_commands
    return report


def render_markdown(report: dict[str, Any]) -> str:
    return "\n".join(
        [
            "# Acceptance Run",
            "",
            f"- Completion: `{report.get('completionStatus', 'UNKNOWN')}`",
            f"- Proof: `{report.get('proofStatus', 'UNKNOWN')}`",
            f"- Sample emission allowed: `{report.get('sampleEmissionAllowed', False)}`",
            "- Summary: "
            + json.dumps(report.get("summary", {}), ensure_ascii=False, sort_keys=True),
            "",
            "## Results",
            "",
            "| Gate | Status | Completion | Proof | Source kind |",
            "| --- | --- | --- | --- | --- |",
            *[
                "| {id} | {status} | {completion} | {proof} | {source_kind} |".format(
                    id=result.get("id", ""),
                    status=result.get("status", ""),
                    completion=result.get("completionStatus", ""),
                    proof=result.get("proofStatus", ""),
                    source_kind=result.get("sourceArtifactKind", ""),
                )
                for result in report.get("results", [])
                if isinstance(result, dict)
            ],
            "",
        ]
    )


def write_run_report(output: Path, report: dict[str, Any]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    output.with_suffix(".md").write_text(render_markdown(report), encoding="utf-8")


def acceptance_exit_code(report: dict[str, Any]) -> int:
    if report.get("completionStatus") != "DONE":
        return 1
    if report.get("proofStatus") != "PROVEN":
        return 1
    if report.get("sampleEmissionAllowed") is not True:
        return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", default=str(DEFAULT_PLAN_PATH))
    parser.add_argument("--gates", default="tooling/acceptance/gates.yaml")
    parser.add_argument("--output", default="tooling/acceptance/reports/latest-run.json")
    parser.add_argument("--gate", action="append", default=[])
    parser.add_argument("--tier", action="append", default=[])
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    plan = load_plan(Path(args.plan))
    definitions = load_gate_definitions(Path(args.gates))
    gates = selected_gates_from_plan(plan, definitions)
    if args.gate:
        requested = set(args.gate)
        selected_by_id = {gate["id"]: gate for gate in gates}
        gates = []
        for gate_id in args.gate:
            if gate_id in selected_by_id:
                gates.append(selected_by_id[gate_id])
                continue
            if gate_id not in definitions:
                raise SystemExit(f"gate {gate_id!r} is missing from {args.gates}")
            gates.append(gate_from_definition(gate_id, definitions[gate_id]))
    gates = filter_gates_by_tier(gates, args.tier)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)

    results: list[dict[str, Any]] = []
    print("Acceptance Run")
    print("==============")
    if args.tier:
        print(f"tiers: {', '.join(args.tier)}")
    if not gates:
        print("[SKIP] no selected gates")

    for gate in gates:
        gate_id = gate["id"]
        command = gate["command"]
        timeout = int(gate.get("timeout_seconds") or 600)
        environment = gate.get("environment", "local")
        tier = gate.get("tier", "local-evidence")
        print(f"[RUN] {gate_id} [{tier}/{environment}]: {command}")
        started = time.time()
        if args.dry_run:
            results.append(
                {
                    "id": gate_id,
                    "command": command,
                    "environment": environment,
                    "tier": tier,
                    "status": "dry-run",
                    "duration_seconds": 0,
                }
            )
            write_run_report(output, build_run_report(args.plan, results))
            continue
        completed = subprocess.run(
            command,
            shell=True,
            text=True,
            capture_output=True,
            timeout=timeout,
        )
        duration = round(time.time() - started, 3)
        status = "passed" if completed.returncode == 0 else "failed"
        log_dir = Path("tooling/acceptance/reports/logs")
        log_dir.mkdir(parents=True, exist_ok=True)
        log_path = log_dir / f"{gate_id}.log"
        log_path.write_text(completed.stdout + completed.stderr, encoding="utf-8")
        print(f"[{status.upper()}] {gate_id} duration={duration}s log={log_path}")
        result = {
            "id": gate_id,
            "command": command,
            "environment": environment,
            "tier": tier,
            "status": status,
            "exit_code": completed.returncode,
            "duration_seconds": duration,
            "log": str(log_path),
        }
        results.append(enrich_result_with_evidence(result, completed.stdout + completed.stderr))
        write_run_report(output, build_run_report(args.plan, results))

    report = build_run_report(args.plan, results)
    write_run_report(output, report)
    return acceptance_exit_code(report)


if __name__ == "__main__":
    raise SystemExit(main())
