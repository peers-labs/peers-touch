#!/usr/bin/env python3
"""Ensure a fail-closed Desktop telemetry mirror artifact exists."""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from _acceptance_artifacts import artifact_session, explicit_output_path, inspect_command


PRODUCER_GATE_ID = "desktop-telemetry-mirror-template-gate"
DEFAULT_OUTPUT = "reports/desktop-performance-mirror-template.json"
STATION_MIRROR_OUTPUT_PREFIX = "tooling/acceptance/reports/desktop-performance-station-mirror"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def load_mirror_module():
    script = Path(__file__).with_name("desktop-telemetry-mirror.py")
    spec = importlib.util.spec_from_file_location("desktop_telemetry_mirror", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {script}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def build_template(station_url: str, filters: dict[str, Any] | None = None) -> dict[str, Any]:
    mirror = load_mirror_module()
    reason = "Station mirror has not been queried; raw event evidence remains unproven"
    review_commands = [
        {
            "purpose": "Start the Desktop development runtime through the project entrypoint.",
            "command": "make desktop",
        },
        {
            "purpose": "Query Station telemetry into an explicit Dev/CI mirror.",
            "command": (
                "python3 tooling/scripts/desktop-telemetry-mirror.py "
                f"--station-url {station_url} "
                f"--output-prefix {STATION_MIRROR_OUTPUT_PREFIX}"
            ),
        },
        {
            "purpose": "Inspect the mirror source artifact diagnostics.",
            "command": inspect_command(PRODUCER_GATE_ID, "report"),
        },
        {
            "purpose": "Re-run the full Phase 0 bundle and keep fail-closed evidence if live samples are still missing.",
            "command": "make acceptance PLAN=tooling/acceptance/plans/desktop-performance-phase0.json",
        },
    ]
    issue_details = [
        {
            "step": "station-query-template",
            "status": "diagnostic incomplete",
            "reason": reason,
            "stationUrl": station_url,
            "filters": filters or {},
        }
    ]
    issue_breakdown = [
        {
            "category": "station-mirror-source",
            "failedStep": "station-query-template",
            "status": "diagnostic incomplete",
            "completionStatus": "PARTIAL",
            "proofStatus": "UNPROVEN",
            "summary": reason,
            "sampleEmissionAllowed": False,
            "proofImpact": "P0a-6/P0c-5 remains PARTIAL/UNPROVEN until Station raw events and rollups are queried from the product sink.",
            "sourceArtifact": "evidence-store:current:report",
            "sourceArtifactKind": mirror.ARTIFACT_KIND,
            "sourcePhase": mirror.PHASE,
            "sourceBom": list(mirror.BOM),
            "sourceSpec": list(mirror.SPEC),
            "sourceGate": mirror.GATE,
            "details": issue_details,
            "evidenceDetails": issue_details,
            "recommended_review_commands": review_commands,
            "recommendedReviewCommands": review_commands,
        }
    ]
    report = {
        "schemaVersion": 1,
        "artifactKind": mirror.ARTIFACT_KIND,
        "source": "station-query-template",
        "stationUrl": station_url,
        "generatedAt": utc_now(),
        "status": "diagnostic incomplete",
        "phase": mirror.PHASE,
        "bom": list(mirror.BOM),
        "spec": list(mirror.SPEC),
        "gate": mirror.GATE,
        "completionStatus": "PARTIAL",
        "proofStatus": "UNPROVEN",
        "sampleEmissionAllowed": False,
        "productSink": "Station",
        "mirrorRole": "Dev/CI evidence artifact",
        "filters": filters or {},
        "summary": {
            "eventCount": 0,
            "rollupCount": 0,
            "maxP95DurationMs": None,
            "sampleEmissionAllowed": False,
        },
        "events": [],
        "rollups": [],
        "reason": reason,
        "issue_breakdown": issue_breakdown,
        "issueBreakdown": issue_breakdown,
        "recommended_review_commands": review_commands,
        "recommendedReviewCommands": review_commands,
    }
    promote_primary_issue(report)
    return report


def promote_primary_issue(report: dict[str, Any]) -> None:
    issues = report.get("issue_breakdown")
    if not isinstance(issues, list) or not issues:
        return
    primary = issues[0]
    if not isinstance(primary, dict):
        return
    failed_step = primary.get("failedStep")
    summary = primary.get("summary")
    if failed_step:
        report["failedStep"] = failed_step
    if summary:
        report["reason"] = summary
    report_summary = report.get("summary")
    if not isinstance(report_summary, dict):
        report_summary = {}
        report["summary"] = report_summary
    if failed_step:
        report_summary["failedStep"] = failed_step
    if summary:
        report_summary["reason"] = summary
    for key in ("category", "sourceArtifact", "sourceArtifactKind", "sourcePhase", "sourceBom", "sourceSpec", "sourceGate"):
        value = primary.get(key)
        if value is not None:
            report_summary[f"primaryIssue{key[0].upper()}{key[1:]}"] = value


def report_exit_code(report: dict[str, Any]) -> int:
    return 0 if report.get("completionStatus") == "DONE" and report.get("proofStatus") == "PROVEN" else 1


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# Desktop Performance Telemetry Mirror Template",
        "",
        f"- Artifact kind: `{report['artifactKind']}`",
        f"- Source: `{report['source']}`",
        f"- Status: `{report['status']}`",
        f"- Generated: `{report['generatedAt']}`",
        f"- Phase: `{report['phase']}`",
        f"- BOM: `{','.join(report['bom'])}`",
        f"- Spec: `{','.join(report['spec'])}`",
        f"- Gate: `{report['gate']}`",
        f"- Completion: `{report['completionStatus']}`",
        f"- Proof: `{report['proofStatus']}`",
        f"- Sample emission allowed: `{report.get('sampleEmissionAllowed')}`",
        f"- Product sink: `{report['productSink']}`",
        f"- Mirror role: `{report['mirrorRole']}`",
        f"- Reason: {report['reason']}",
        f"- Issues: `{','.join(issue.get('category', '') for issue in report.get('issue_breakdown', []))}`",
        f"- Review commands: `{','.join(command.get('command', '') for command in report.get('recommended_review_commands', []))}`",
        "",
        "## Boundary",
        "",
        "- This file is a fail-closed Dev/CI placeholder.",
        "- It is not a Station query result and cannot prove red-line policies.",
        "- A successful Station mirror run may replace this artifact.",
    ]
    return "\n".join(lines) + "\n"


def write_template(output_prefix: Path, report: dict[str, Any], *, force: bool = False) -> tuple[Path, Path, bool]:
    json_path = output_prefix.with_suffix(".json")
    md_path = output_prefix.with_suffix(".md")
    output_prefix.parent.mkdir(parents=True, exist_ok=True)
    json_path_text = str(json_path)
    for field in ("issue_breakdown", "issueBreakdown"):
        issues = report.get(field)
        if isinstance(issues, list):
            for issue in issues:
                if isinstance(issue, dict):
                    issue["sourceArtifact"] = json_path_text
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    md_path.write_text(render_markdown(report), encoding="utf-8")
    return json_path, md_path, True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--station-url", default="http://127.0.0.1:18080")
    parser.add_argument("--output-prefix")
    args = parser.parse_args()

    report = build_template(args.station_url)
    if args.output_prefix:
        json_path, md_path, _ = write_template(
            explicit_output_path(args.output_prefix),
            report,
        )
        display_json = str(json_path)
        display_markdown = str(md_path)
    else:
        with artifact_session(PRODUCER_GATE_ID) as session:
            session.write_json(DEFAULT_OUTPUT, report, role="report")
            session.write_bytes(
                str(Path(DEFAULT_OUTPUT).with_suffix(".md")),
                render_markdown(report).encode("utf-8"),
                media_type="text/markdown",
                role="report-markdown",
            )
            session.complete(
                status=report["status"],
                completion_status=report["completionStatus"],
                proof_status=report["proofStatus"],
            )
        display_json = DEFAULT_OUTPUT
        display_markdown = str(Path(DEFAULT_OUTPUT).with_suffix(".md"))
    print(f"desktop telemetry mirror template wrote: {display_json}")
    print(f"desktop telemetry mirror template wrote: {display_markdown}")
    print(f"status: {report['status']}")
    return report_exit_code(report)


if __name__ == "__main__":
    raise SystemExit(main())
