#!/usr/bin/env python3
"""Build the Desktop stable-anchor inventory for Phase 0 P0b-1."""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from _acceptance_artifacts import (
    artifact_session,
    explicit_output_path,
    inspect_command,
    latest_artifact,
)


@dataclass(frozen=True)
class AnchorRequirement:
    anchor_id: str
    selector: str
    surface: str


REQUIRED_ANCHORS = (
    AnchorRequirement("primary-nav", "data-pt-primary-nav", "Desktop primary navigation"),
    AnchorRequirement("secondary-tab", "data-pt-secondary-tab", "Settings secondary tabs"),
    AnchorRequirement("secondary-tab-id", "data-pt-secondary-tab-id", "Settings secondary tab identity"),
    AnchorRequirement("section-item", "data-pt-section-item", "Settings section item"),
    AnchorRequirement("section-item-id", "data-pt-section-item-id", "Settings section item identity"),
    AnchorRequirement("section-host", "data-pt-section-host", "SectionHost frame"),
    AnchorRequirement("text-input", "data-pt-text-input", "Chat composer text input"),
    AnchorRequirement("context-menu-trigger", "data-pt-context-menu-trigger", "Context menu trigger"),
    AnchorRequirement("context-menu-kind", "data-pt-context-menu-kind", "Context menu trigger kind"),
    AnchorRequirement("context-menu-id", "data-pt-context-menu-id", "Context menu trigger identity"),
)

DOM_EVIDENCE_PHASE = "P0b-1"
DOM_EVIDENCE_BOM = ("BOM-SMP-01",)
DOM_EVIDENCE_SPEC = ("SPEC-ANCHOR-01",)
DOM_EVIDENCE_GATE = "Browser, dev native, and packaged native DOM automation must prove every required anchor by selector and count"
DOM_EVIDENCE_ARTIFACT_KIND = "desktop-anchor-dom-evidence"
ANCHOR_INVENTORY_ARTIFACT_KIND = "desktop-anchor-inventory"
ANCHOR_INVENTORY_PRODUCER_ID = "desktop-anchor-inventory-gate"
ANCHOR_INVENTORY_GATE = "Browser and Tauri/WebView target the same object identity"
DOM_EVIDENCE_PRODUCER_ID = "desktop-anchor-dom-evidence-collect-gate"
DOM_EVIDENCE_ROLE = "report"
REPORT_PATH = "reports/desktop-anchor-inventory.json"
REPORT_MARKDOWN_PATH = "reports/desktop-anchor-inventory.md"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def recommended_review_commands(_dom_evidence_path: Path) -> list[dict[str, str]]:
    return [
        {
            "purpose": "Start the Desktop development runtime through the project entrypoint.",
            "command": "make desktop",
        },
        {
            "purpose": "Regenerate the fail-closed DOM evidence template if runtime automation is unavailable.",
            "command": "python3 tooling/scripts/desktop-anchor-dom-evidence-template.py",
        },
        {
            "purpose": "Collect browser/Tauri DOM anchor observations when runtimes are available.",
            "command": "python3 tooling/scripts/desktop-anchor-dom-evidence-collect.py",
        },
        {
            "purpose": "Inspect the DOM evidence diagnostic artifact.",
            "command": inspect_command(
                DOM_EVIDENCE_PRODUCER_ID,
                DOM_EVIDENCE_ROLE,
            ),
        },
        {
            "purpose": "Re-run the independent DOM evidence gate.",
            "command": "python3 tooling/scripts/desktop-anchor-dom-evidence-gate.py",
        },
        {
            "purpose": "Re-run the full Phase 0 bundle and keep fail-closed evidence if runtime DOM samples are still missing.",
            "command": "make acceptance PLAN=tooling/acceptance/plans/desktop-performance-phase0.json",
        },
    ]


def dom_issue_breakdown(dom: dict[str, Any]) -> list[dict[str, str]]:
    issues: list[dict[str, str]] = []
    evidence_status = str(dom.get("evidenceStatus") or dom.get("status") or "missing")
    if dom.get("status") != "pass":
        issues.append(
            {
                "category": "dom-automation-evidence",
                "failedStep": evidence_status,
                "summary": str(dom.get("reason") or "Browser/dev-native/packaged-native DOM anchor evidence is not proven."),
                "proofImpact": "P0b-1 DOM automation remains PARTIAL/UNPROVEN.",
            }
        )
    for runtime_id in ("browser", "tauriDev", "tauriPackaged"):
        runtime = dom.get(runtime_id, {})
        if isinstance(runtime, dict) and runtime.get("status") != "pass":
            required = runtime.get("requiredCount", len(REQUIRED_ANCHORS))
            proven = runtime.get("provenCount", 0)
            issues.append(
                {
                    "category": "dom-runtime-anchor-evidence",
                    "failedStep": f"{runtime_id}:{runtime.get('runtimeStatus', runtime.get('status', 'missing'))}",
                    "summary": f"{runtime_id} DOM anchors are not fully proven ({proven}/{required} anchors proven).",
                    "proofImpact": "P0b-1 cannot prove browser/Tauri target the same object identity.",
                }
            )
    return issues


def dom_evidence_reason(metadata_reasons: list[str], runtimes: dict[str, dict[str, Any]]) -> str:
    reasons: list[str] = []
    if metadata_reasons:
        reasons.append("DOM evidence source metadata is incomplete")
    for runtime_id, runtime in runtimes.items():
        if runtime.get("status") == "pass":
            continue
        required = runtime.get("requiredCount", len(REQUIRED_ANCHORS))
        proven = runtime.get("provenCount", 0)
        reasons.append(f"{runtime_id} DOM anchors are not fully proven ({proven}/{required} anchors proven)")
    return "; ".join(reasons) if reasons else "DOM evidence is proven"


def source_anchor_issue_breakdown(missing: list[AnchorRequirement]) -> list[dict[str, str]]:
    return [
        {
            "category": "source-anchor-inventory",
            "failedStep": anchor.anchor_id,
            "summary": f"Missing source anchor selector `{anchor.selector}` for {anchor.surface}.",
            "proofImpact": "P0b-1 stable anchor inventory remains PARTIAL/UNPROVEN.",
        }
        for anchor in missing
    ]


def bind_issue_source(issue: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    bound = dict(issue)

    def fill(key: str, value: Any) -> None:
        if key not in bound or bound[key] in (None, "", []):
            bound[key] = value

    fill("status", "diagnostic incomplete")
    fill("completionStatus", "PARTIAL")
    fill("proofStatus", "UNPROVEN")
    fill("sampleEmissionAllowed", False)
    fill(
        "sourceArtifact",
        payload.get("sourceArtifact")
        or payload.get("path")
        or "evidence-store:current:report",
    )
    fill("sourceArtifactKind", payload.get("sourceArtifactKind") or payload.get("artifactKind") or ANCHOR_INVENTORY_ARTIFACT_KIND)
    fill("sourcePhase", payload.get("sourcePhase") or payload.get("phase") or DOM_EVIDENCE_PHASE)
    fill("sourceBom", payload.get("sourceBom") or payload.get("bom") or list(DOM_EVIDENCE_BOM))
    fill("sourceSpec", payload.get("sourceSpec") or payload.get("spec") or list(DOM_EVIDENCE_SPEC))
    fill("sourceGate", payload.get("sourceGate") or payload.get("gate") or ANCHOR_INVENTORY_GATE)
    return bound


def with_diagnostics(payload: dict[str, Any], issues: list[dict[str, Any]], commands: list[dict[str, str]]) -> dict[str, Any]:
    if issues:
        issues = [bind_issue_source(issue, payload) for issue in issues]
        payload["issue_breakdown"] = issues
        payload["issueBreakdown"] = issues
    if commands:
        payload["recommended_review_commands"] = commands
        payload["recommendedReviewCommands"] = commands
    return payload


def source_files(source_root: Path) -> list[Path]:
    return sorted(
        path
        for suffix in ("*.ts", "*.tsx")
        for path in source_root.rglob(suffix)
        if path.is_file()
    )


def find_anchor_matches(source_root: Path) -> dict[str, list[dict[str, Any]]]:
    matches: dict[str, list[dict[str, Any]]] = {anchor.anchor_id: [] for anchor in REQUIRED_ANCHORS}
    for path in source_files(source_root):
        text = path.read_text(encoding="utf-8")
        for line_no, line in enumerate(text.splitlines(), start=1):
            for anchor in REQUIRED_ANCHORS:
                if anchor.selector in line:
                    matches[anchor.anchor_id].append(
                        {
                            "path": str(path),
                            "line": line_no,
                            "selector": anchor.selector,
                            "surface": anchor.surface,
                        }
                    )
    return matches


def normalize_dom_anchor(runtime: dict[str, Any], anchor: AnchorRequirement) -> dict[str, Any]:
    anchors = runtime.get("anchors", {})
    entry = anchors.get(anchor.anchor_id, {}) if isinstance(anchors, dict) else {}
    observed_count = entry.get("count", entry.get("matchCount", 0)) if isinstance(entry, dict) else 0
    selector = entry.get("selector") if isinstance(entry, dict) else None
    status = entry.get("status") if isinstance(entry, dict) else None
    reasons: list[str] = []
    if status != "pass":
        reasons.append("anchor status is not pass")
    if selector != anchor.selector:
        reasons.append("selector mismatch")
    if not isinstance(observed_count, int) or observed_count <= 0:
        reasons.append("missing positive DOM match count")
    passed = not reasons
    return {
        "anchorId": anchor.anchor_id,
        "selector": anchor.selector,
        "surface": anchor.surface,
        "status": "pass" if passed else "diagnostic incomplete",
        "observedStatus": status,
        "observedSelector": selector,
        "observedCount": observed_count,
        "reason": "; ".join(reasons) if reasons else "anchor observed with matching selector",
    }


def normalize_dom_runtime(runtime_id: str, runtime: dict[str, Any]) -> dict[str, Any]:
    anchors = [normalize_dom_anchor(runtime, anchor) for anchor in REQUIRED_ANCHORS]
    runtime_status = runtime.get("status")
    failed = [anchor for anchor in anchors if anchor["status"] != "pass"]
    status = "pass" if runtime_status == "pass" and not failed else "diagnostic incomplete"
    return {
        "runtime": runtime_id,
        "status": status,
        "proofStatus": "PROVEN" if status == "pass" else "UNPROVEN",
        "runtimeStatus": runtime_status or "missing",
        "requiredCount": len(REQUIRED_ANCHORS),
        "provenCount": len(REQUIRED_ANCHORS) - len(failed),
        "anchors": anchors,
        "missing": failed,
    }


def validate_dom_evidence_metadata(evidence: dict[str, Any]) -> list[str]:
    reasons: list[str] = []
    if evidence.get("artifactKind") != DOM_EVIDENCE_ARTIFACT_KIND:
        reasons.append("missing or invalid artifactKind")
    if evidence.get("phase") != DOM_EVIDENCE_PHASE:
        reasons.append("missing or invalid phase")
    source_bom = evidence.get("bom")
    if not isinstance(source_bom, list) or not all(item in source_bom for item in DOM_EVIDENCE_BOM):
        reasons.append("missing required DOM evidence BOM binding")
    source_spec = evidence.get("spec")
    if not isinstance(source_spec, list) or not all(item in source_spec for item in DOM_EVIDENCE_SPEC):
        reasons.append("missing required DOM evidence Spec binding")
    if evidence.get("gate") != DOM_EVIDENCE_GATE:
        reasons.append("missing or invalid gate")
    if evidence.get("completionStatus") not in {"DONE", "PARTIAL"}:
        reasons.append("missing or invalid completionStatus")
    if evidence.get("proofStatus") not in {"PROVEN", "UNPROVEN"}:
        reasons.append("missing or invalid proofStatus")
    return reasons


def load_dom_evidence(
    path: Path,
    *,
    source_artifact: Any | None = None,
) -> dict[str, Any]:
    artifact_ref = source_artifact if source_artifact is not None else str(path)
    if not path.exists():
        return with_diagnostics(
            {
            "status": "missing",
            "proofStatus": "UNPROVEN",
            "path": artifact_ref,
            "sourceArtifact": artifact_ref,
            "evidenceStatus": "missing",
            "browser": {"status": "missing"},
            "tauriDev": {"status": "missing"},
            "tauriPackaged": {"status": "missing"},
            },
            [
                {
                    "category": "dom-automation-evidence",
                    "failedStep": "missing",
                    "summary": f"Missing DOM evidence artifact: {path}",
                    "proofImpact": "P0b-1 DOM automation remains PARTIAL/UNPROVEN.",
                }
            ],
            recommended_review_commands(path),
        )
    try:
        evidence = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return with_diagnostics(
            {
            "status": "diagnostic incomplete",
            "proofStatus": "UNPROVEN",
            "path": artifact_ref,
            "sourceArtifact": artifact_ref,
            "evidenceStatus": "unreadable",
            "reason": str(exc),
            "browser": {"status": "missing"},
            "tauriDev": {"status": "missing"},
            "tauriPackaged": {"status": "missing"},
            },
            [
                {
                    "category": "dom-automation-evidence",
                    "failedStep": "unreadable",
                    "summary": str(exc),
                    "proofImpact": "P0b-1 DOM automation remains PARTIAL/UNPROVEN.",
                }
            ],
            recommended_review_commands(path),
        )
    metadata_reasons = validate_dom_evidence_metadata(evidence)
    browser = normalize_dom_runtime("browser-gateway", evidence.get("browser", {}))
    tauri_dev = normalize_dom_runtime("tauri-webview-dev", evidence.get("tauriDev", {}))
    tauri_packaged = normalize_dom_runtime(
        "tauri-webview-packaged",
        evidence.get("tauriPackaged", {}),
    )
    runtimes = {
        "browser": browser,
        "tauriDev": tauri_dev,
        "tauriPackaged": tauri_packaged,
    }
    pass_status = not metadata_reasons and all(
        runtime["status"] == "pass" for runtime in runtimes.values()
    )
    dom_payload = {
        "status": "pass" if pass_status else "diagnostic incomplete",
        "proofStatus": "PROVEN" if pass_status else "UNPROVEN",
        "path": artifact_ref,
        "sourceArtifact": artifact_ref,
        "sourceArtifactKind": evidence.get("artifactKind") or DOM_EVIDENCE_ARTIFACT_KIND,
        "evidenceStatus": "loaded" if not metadata_reasons else "missing-source-metadata",
        "reason": dom_evidence_reason(metadata_reasons, runtimes),
        "details": metadata_reasons,
        "sourcePhase": evidence.get("phase"),
        "sourceBom": evidence.get("bom", []),
        "sourceSpec": evidence.get("spec", []),
        "sourceGate": evidence.get("gate"),
        "completionStatus": evidence.get("completionStatus"),
        "sourceProofStatus": evidence.get("proofStatus"),
        "requiredCount": len(REQUIRED_ANCHORS),
        "provenCount": len(REQUIRED_ANCHORS)
        if pass_status
        else min(runtime.get("provenCount", 0) for runtime in runtimes.values()),
        "browser": browser,
        "tauriDev": tauri_dev,
        "tauriPackaged": tauri_packaged,
    }
    if pass_status:
        return dom_payload
    return with_diagnostics(dom_payload, dom_issue_breakdown(dom_payload), recommended_review_commands(path))


def build_report(
    source_root: Path,
    dom_evidence_path: Path,
    *,
    dom_source_artifact: Any | None = None,
) -> dict[str, Any]:
    matches = find_anchor_matches(source_root)
    missing = [anchor for anchor in REQUIRED_ANCHORS if not matches[anchor.anchor_id]]
    source_status = "loaded" if not missing else "missing"
    dom_evidence = load_dom_evidence(
        dom_evidence_path,
        source_artifact=dom_source_artifact,
    )
    status = "pass" if source_status == "loaded" and dom_evidence["status"] == "pass" else "diagnostic incomplete"
    if missing:
        status = "fail"
    report = {
        "schemaVersion": 1,
        "artifactKind": ANCHOR_INVENTORY_ARTIFACT_KIND,
        "generatedAt": utc_now(),
        "status": status,
        "completionStatus": "DONE" if status == "pass" else "PARTIAL",
        "proofStatus": "PROVEN" if status == "pass" else "UNPROVEN",
        "sampleEmissionAllowed": status == "pass",
        "phase": "P0b-1",
        "bom": ["BOM-SMP-01"],
        "spec": ["SPEC-ANCHOR-01"],
        "gate": ANCHOR_INVENTORY_GATE,
        "sourceAnchors": {
            "status": source_status,
            "proofStatus": "PROVEN" if source_status == "loaded" else "UNPROVEN",
            "sourceRoot": str(source_root),
            "requiredCount": len(REQUIRED_ANCHORS),
            "presentCount": len(REQUIRED_ANCHORS) - len(missing),
            "missing": [
                {
                    "anchorId": anchor.anchor_id,
                    "selector": anchor.selector,
                    "surface": anchor.surface,
                }
                for anchor in missing
            ],
            "matches": [
                {
                    "anchorId": anchor.anchor_id,
                    "selector": anchor.selector,
                    "surface": anchor.surface,
                    "matchCount": len(matches[anchor.anchor_id]),
                    "locations": matches[anchor.anchor_id],
                }
                for anchor in REQUIRED_ANCHORS
            ],
        },
        "domAutomation": dom_evidence,
        "summary": {
            "status": status,
            "completionStatus": "DONE" if status == "pass" else "PARTIAL",
            "proofStatus": "PROVEN" if status == "pass" else "UNPROVEN",
            "sampleEmissionAllowed": status == "pass",
            "sourceAnchorStatus": source_status,
            "domAutomationStatus": dom_evidence.get("status"),
        },
    }
    issues = source_anchor_issue_breakdown(missing) + list(dom_evidence.get("issue_breakdown", []))
    commands = recommended_review_commands(dom_evidence_path) if status != "pass" else []
    return with_diagnostics(report, issues, commands)


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# Desktop Stable Anchor Inventory",
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
        "## Source Anchors",
        "",
        f"- Status: `{report['sourceAnchors']['status']}`",
        f"- Required: `{report['sourceAnchors']['requiredCount']}`",
        f"- Present: `{report['sourceAnchors']['presentCount']}`",
        "",
        "| Anchor | Selector | Surface | Matches |",
        "|---|---|---|---|",
    ]
    for match in report["sourceAnchors"]["matches"]:
        lines.append(
            f"| `{match['anchorId']}` | `{match['selector']}` | {match['surface']} | `{match['matchCount']}` |"
        )
    lines.extend(
        [
            "",
            "## DOM Automation",
            "",
            f"- Status: `{report['domAutomation']['status']}`",
            f"- Proof: `{report['domAutomation']['proofStatus']}`",
            f"- Evidence path: `{report['domAutomation']['path']}`",
            f"- Evidence status: `{report['domAutomation'].get('evidenceStatus', 'n/a')}`",
            f"- Source phase: `{report['domAutomation'].get('sourcePhase', 'n/a')}`",
            f"- Source BOM: `{', '.join(report['domAutomation'].get('sourceBom', []))}`",
            f"- Source Spec: `{', '.join(report['domAutomation'].get('sourceSpec', []))}`",
            f"- Source Gate: `{report['domAutomation'].get('sourceGate', 'n/a')}`",
            f"- Details: `{','.join(report['domAutomation'].get('details', []))}`",
            f"- Browser anchors proven: `{report['domAutomation'].get('browser', {}).get('provenCount', 0)}`",
            f"- Dev native anchors proven: `{report['domAutomation'].get('tauriDev', {}).get('provenCount', 0)}`",
            f"- Packaged native anchors proven: `{report['domAutomation'].get('tauriPackaged', {}).get('provenCount', 0)}`",
            "",
            "| Anchor | Browser | Dev native | Packaged native |",
            "|---|---|---|---|",
        ]
    )
    browser_anchors = {
        anchor["anchorId"]: anchor for anchor in report["domAutomation"].get("browser", {}).get("anchors", [])
    }
    tauri_dev_anchors = {
        anchor["anchorId"]: anchor for anchor in report["domAutomation"].get("tauriDev", {}).get("anchors", [])
    }
    tauri_packaged_anchors = {
        anchor["anchorId"]: anchor
        for anchor in report["domAutomation"].get("tauriPackaged", {}).get("anchors", [])
    }
    for anchor in REQUIRED_ANCHORS:
        browser = browser_anchors.get(anchor.anchor_id, {})
        tauri_dev = tauri_dev_anchors.get(anchor.anchor_id, {})
        tauri_packaged = tauri_packaged_anchors.get(anchor.anchor_id, {})
        lines.append(
            "| `{anchor}` | `{browser}` | `{tauri_dev}` | `{tauri_packaged}` |".format(
                anchor=anchor.anchor_id,
                browser=browser.get("status", "missing"),
                tauri_dev=tauri_dev.get("status", "missing"),
                tauri_packaged=tauri_packaged.get("status", "missing"),
            )
        )
    lines.extend(
        [
            "",
            "## Boundary",
            "",
            "- Source anchors prove selector inventory only.",
            "- Browser, dev native, and packaged native DOM automation evidence is required before P0b-1 can pass.",
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
    parser.add_argument("--source-root", default="apps/desktop/src")
    parser.add_argument("--dom-evidence")
    parser.add_argument("--output-prefix")
    args = parser.parse_args()

    if args.dom_evidence:
        report = build_report(Path(args.source_root), Path(args.dom_evidence))
    else:
        dom_path, dom_ref = latest_artifact(
            DOM_EVIDENCE_PRODUCER_ID,
            DOM_EVIDENCE_ROLE,
        )
        report = build_report(
            Path(args.source_root),
            dom_path,
            dom_source_artifact=dom_ref,
        )
    if args.output_prefix:
        json_path, md_path = write_outputs(report, args.output_prefix)
        json_output = str(json_path)
        markdown_output = str(md_path)
    else:
        with artifact_session(ANCHOR_INVENTORY_PRODUCER_ID) as session:
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
    print(f"desktop anchor inventory: {json_output}")
    print(f"desktop anchor inventory: {markdown_output}")
    print(f"status: {report['status']}")
    return 0 if report["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
