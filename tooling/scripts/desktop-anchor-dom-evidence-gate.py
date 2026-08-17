#!/usr/bin/env python3
"""Validate Desktop stable-anchor DOM automation evidence for Phase 0 P0b-1."""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from _acceptance_artifacts import (
    artifact_session,
    explicit_output_path,
    latest_path,
    latest_ref,
)

ARTIFACT_KIND = "desktop-anchor-dom-evidence-gate"
DOM_EVIDENCE_PRODUCER_ID = "desktop-anchor-dom-evidence-collect-gate"
DOM_EVIDENCE_ROLE = "report"
REPORT_PATH = "reports/desktop-anchor-dom-evidence-gate.json"
REPORT_MARKDOWN_PATH = "reports/desktop-anchor-dom-evidence-gate.md"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def load_inventory_module():
    script = Path(__file__).with_name("desktop-anchor-inventory.py")
    spec = importlib.util.spec_from_file_location("desktop_anchor_inventory", script)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load {script}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def build_report(
    dom_evidence_path: Path,
    source_artifact: Any | None = None,
) -> dict[str, Any]:
    inventory = load_inventory_module()
    dom_evidence = inventory.load_dom_evidence(
        dom_evidence_path,
        source_artifact=source_artifact,
    )
    status = "pass" if dom_evidence["status"] == "pass" else "diagnostic incomplete"
    report = {
        "schemaVersion": 1,
        "artifactKind": ARTIFACT_KIND,
        "generatedAt": utc_now(),
        "status": status,
        "completionStatus": "DONE" if status == "pass" else "PARTIAL",
        "proofStatus": "PROVEN" if status == "pass" else "UNPROVEN",
        "sampleEmissionAllowed": status == "pass",
        "phase": "P0b-1",
        "bom": ["BOM-SMP-01"],
        "spec": ["SPEC-ANCHOR-01"],
        "gate": "Browser and Tauri/WebView DOM automation must prove every required anchor by selector and count",
        "domAutomation": dom_evidence,
        "summary": {
            "status": status,
            "completionStatus": "DONE" if status == "pass" else "PARTIAL",
            "proofStatus": "PROVEN" if status == "pass" else "UNPROVEN",
            "sampleEmissionAllowed": status == "pass",
            "domAutomationStatus": dom_evidence.get("status"),
            "browserProvenCount": dom_evidence.get("browser", {}).get("provenCount", 0),
            "tauriProvenCount": dom_evidence.get("tauri", {}).get("provenCount", 0),
        },
    }
    issue_breakdown = dom_evidence.get("issue_breakdown", dom_evidence.get("issueBreakdown"))
    review_commands = dom_evidence.get("recommended_review_commands", dom_evidence.get("recommendedReviewCommands"))
    if isinstance(issue_breakdown, list):
        report["issue_breakdown"] = issue_breakdown
        report["issueBreakdown"] = issue_breakdown
    if isinstance(review_commands, list):
        report["recommended_review_commands"] = review_commands
        report["recommendedReviewCommands"] = review_commands
    return report


def render_markdown(report: dict[str, Any]) -> str:
    dom = report["domAutomation"]
    lines = [
        "# Desktop Anchor DOM Evidence Gate",
        "",
        f"- Generated: `{report['generatedAt']}`",
        f"- Status: `{report['status']}`",
        f"- Completion: `{report['completionStatus']}`",
        f"- Proof: `{report['proofStatus']}`",
        f"- Phase: `{report['phase']}`",
        f"- BOM: `{', '.join(report['bom'])}`",
        f"- Spec: `{', '.join(report['spec'])}`",
        f"- Gate: `{report['gate']}`",
        "",
        "## DOM Automation",
        "",
        f"- Status: `{dom['status']}`",
        f"- Proof: `{dom['proofStatus']}`",
        f"- Evidence path: `{dom['path']}`",
        f"- Evidence status: `{dom.get('evidenceStatus', 'n/a')}`",
        f"- Source phase: `{dom.get('sourcePhase', 'n/a')}`",
        f"- Source BOM: `{', '.join(dom.get('sourceBom', []))}`",
        f"- Source Spec: `{', '.join(dom.get('sourceSpec', []))}`",
        f"- Source Gate: `{dom.get('sourceGate', 'n/a')}`",
        f"- Details: `{','.join(dom.get('details', []))}`",
        f"- Browser anchors proven: `{dom.get('browser', {}).get('provenCount', 0)}`",
        f"- Tauri anchors proven: `{dom.get('tauri', {}).get('provenCount', 0)}`",
        "",
        "| Anchor | Browser | Tauri |",
        "|---|---|---|",
    ]
    inventory = load_inventory_module()
    browser_anchors = {
        anchor["anchorId"]: anchor for anchor in dom.get("browser", {}).get("anchors", [])
    }
    tauri_anchors = {
        anchor["anchorId"]: anchor for anchor in dom.get("tauri", {}).get("anchors", [])
    }
    for anchor in inventory.REQUIRED_ANCHORS:
        browser = browser_anchors.get(anchor.anchor_id, {})
        tauri = tauri_anchors.get(anchor.anchor_id, {})
        lines.append(
            "| `{anchor}` | `{browser}` | `{tauri}` |".format(
                anchor=anchor.anchor_id,
                browser=browser.get("status", "missing"),
                tauri=tauri.get("status", "missing"),
            )
        )
    lines.extend(
        [
            "",
            "## Boundary",
            "",
            "- This gate validates an existing DOM evidence artifact.",
            "- It does not launch browser or Tauri automation by itself.",
            "- Missing or partial runtime evidence remains `PARTIAL/UNPROVEN`.",
        ]
    )
    return "\n".join(lines) + "\n"


def write_outputs(report: dict[str, Any], output_prefix: str) -> tuple[Path, Path]:
    prefix = explicit_output_path(output_prefix)
    prefix.parent.mkdir(parents=True, exist_ok=True)
    json_path = prefix.with_suffix(".json")
    md_path = prefix.with_suffix(".md")
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    md_path.write_text(render_markdown(report), encoding="utf-8")
    return json_path, md_path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dom-evidence")
    parser.add_argument("--output-prefix")
    args = parser.parse_args()

    if args.dom_evidence:
        report = build_report(Path(args.dom_evidence))
    else:
        report = build_report(
            latest_path(DOM_EVIDENCE_PRODUCER_ID, DOM_EVIDENCE_ROLE),
            source_artifact=latest_ref(
                DOM_EVIDENCE_PRODUCER_ID,
                DOM_EVIDENCE_ROLE,
            ),
        )
    if args.output_prefix:
        json_path, md_path = write_outputs(report, args.output_prefix)
        json_output = str(json_path)
        markdown_output = str(md_path)
    else:
        with artifact_session(ARTIFACT_KIND) as session:
            session.write_json(REPORT_PATH, report, role="report")
            session.write_bytes(
                REPORT_MARKDOWN_PATH,
                render_markdown(report).encode("utf-8"),
                media_type="text/markdown",
                role="report-markdown",
            )
            session.complete(
                status=report["status"],
                completion_status=report["completionStatus"],
                proof_status=report["proofStatus"],
            )
        json_output = REPORT_PATH
        markdown_output = REPORT_MARKDOWN_PATH
    print(f"desktop anchor DOM evidence gate: {json_output}")
    print(f"desktop anchor DOM evidence gate: {markdown_output}")
    print(f"status: {report['status']}")
    return 0 if report["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
