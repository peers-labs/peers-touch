#!/usr/bin/env python3
"""Validate Desktop P0b-1 source stable-anchor inventory."""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PHASE = "P0b-1"
BOM = ["BOM-SMP-01"]
SPEC = ["SPEC-ANCHOR-01"]
GATE = "Desktop source must expose required stable anchors before DOM automation evidence can be accepted"
ARTIFACT_KIND = "desktop-anchor-source-gate"


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


def build_report(source_root: Path) -> dict[str, Any]:
    inventory = load_inventory_module()
    matches = inventory.find_anchor_matches(source_root)
    missing = [anchor for anchor in inventory.REQUIRED_ANCHORS if not matches[anchor.anchor_id]]
    status = "pass" if not missing else "fail"
    report = {
        "schemaVersion": 1,
        "generatedAt": utc_now(),
        "artifactKind": ARTIFACT_KIND,
        "status": status,
        "completionStatus": "DONE" if status == "pass" else "PARTIAL",
        "proofStatus": "PROVEN" if status == "pass" else "UNPROVEN",
        "sampleEmissionAllowed": status == "pass",
        "phase": PHASE,
        "bom": BOM,
        "spec": SPEC,
        "gate": GATE,
        "sourceRoot": str(source_root),
        "requiredCount": len(inventory.REQUIRED_ANCHORS),
        "presentCount": len(inventory.REQUIRED_ANCHORS) - len(missing),
        "missing": [
            {
                "anchorId": anchor.anchor_id,
                "selector": anchor.selector,
                "surface": anchor.surface,
            }
            for anchor in missing
        ],
        "anchors": [
            {
                "anchorId": anchor.anchor_id,
                "selector": anchor.selector,
                "surface": anchor.surface,
                "matchCount": len(matches[anchor.anchor_id]),
                "locations": matches[anchor.anchor_id],
            }
            for anchor in inventory.REQUIRED_ANCHORS
        ],
        "boundary": "Source anchors prove selector inventory only; browser and Tauri DOM evidence remains separate.",
        "summary": {
            "status": status,
            "completionStatus": "DONE" if status == "pass" else "PARTIAL",
            "proofStatus": "PROVEN" if status == "pass" else "UNPROVEN",
            "sampleEmissionAllowed": status == "pass",
            "requiredCount": len(inventory.REQUIRED_ANCHORS),
            "presentCount": len(inventory.REQUIRED_ANCHORS) - len(missing),
        },
    }
    if missing:
        issue_context = {
            "sourceArtifact": "tooling/acceptance/reports/desktop-anchor-source-gate-latest.json",
            "sourceArtifactKind": ARTIFACT_KIND,
            "sourcePhase": PHASE,
            "sourceBom": BOM,
            "sourceSpec": SPEC,
            "sourceGate": GATE,
        }
        issues = [
            inventory.bind_issue_source(issue, issue_context)
            for issue in inventory.source_anchor_issue_breakdown(missing)
        ]
        report["issue_breakdown"] = issues
        report["issueBreakdown"] = issues
    return report


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# Desktop Anchor Source Gate",
        "",
        f"- Generated: `{report['generatedAt']}`",
        f"- Status: `{report['status']}`",
        f"- Completion: `{report['completionStatus']}`",
        f"- Proof: `{report['proofStatus']}`",
        f"- Phase: `{report['phase']}`",
        f"- BOM: `{','.join(report['bom'])}`",
        f"- Spec: `{','.join(report['spec'])}`",
        f"- Gate: `{report['gate']}`",
        f"- Source root: `{report['sourceRoot']}`",
        f"- Required: `{report['requiredCount']}`",
        f"- Present: `{report['presentCount']}`",
        "",
        "| Anchor | Selector | Surface | Matches |",
        "|---|---|---|---:|",
    ]
    for anchor in report["anchors"]:
        lines.append(
            "| `{anchor}` | `{selector}` | {surface} | {count} |".format(
                anchor=anchor["anchorId"],
                selector=anchor["selector"],
                surface=anchor["surface"],
                count=anchor["matchCount"],
            )
        )
    lines.extend(
        [
            "",
            "## Boundary",
            "",
            "- This gate does not inspect runtime DOM.",
            "- Browser and Tauri/WebView DOM automation evidence remains required before P0b-1 can pass end to end.",
        ]
    )
    return "\n".join(lines) + "\n"


def write_outputs(report: dict[str, Any], output_prefix: Path) -> tuple[Path, Path]:
    output_prefix.parent.mkdir(parents=True, exist_ok=True)
    json_path = output_prefix.with_suffix(".json")
    md_path = output_prefix.with_suffix(".md")
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    md_path.write_text(render_markdown(report), encoding="utf-8")
    return json_path, md_path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", default="apps/desktop/src")
    parser.add_argument(
        "--output-prefix",
        default="tooling/acceptance/reports/desktop-anchor-source-gate-latest",
    )
    args = parser.parse_args()

    report = build_report(Path(args.source_root))
    json_path, md_path = write_outputs(report, Path(args.output_prefix))
    print(f"desktop anchor source gate JSON: {json_path}")
    print(f"desktop anchor source gate Markdown: {md_path}")
    print(f"status: {report['status']}")
    return 0 if report["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
