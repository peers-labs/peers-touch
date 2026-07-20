#!/usr/bin/env python3
"""Fail-closed Desktop performance matrix gate.

This runner does not start Desktop and does not emit telemetry samples. It
aggregates runtime-cell evidence into an explicit matrix so Phase 0 cannot
silently treat missing prerequisites as sampled performance data.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ALLOWED_STATUSES = {
    "sampled",
    "blocked",
    "baseline preflight failure",
    "diagnostic incomplete",
}
LIVE_GATE_REQUIRED_BOM = (
    "BOM-RUN-03",
    "BOM-RUN-04",
    "BOM-CON-03",
    "BOM-CON-04",
    "BOM-CAP-05",
    "BOM-RUN-05",
)
LIVE_GATE_REQUIRED_PHASE = "P0a-3/P0a-4/P0a-5/P0a-6/P0c-5"
LIVE_GATE_REQUIRED_SPEC = (
    "SPEC-GW-01",
    "SPEC-STA-01",
    "SPEC-STA-02",
    "SPEC-DB-01",
    "SPEC-DB-02",
    "SPEC-STA-03",
    "SPEC-MIRROR-01",
)
LIVE_GATE_REQUIRED_ARTIFACT_KIND = "desktop-telemetry-live-gate"
PREFLIGHT_REQUIRED_PHASE = "P0c-1/P0c-2"
PREFLIGHT_REQUIRED_BOM = ("BOM-RUN-01", "BOM-CAP-04", "BOM-GATE-01")
PREFLIGHT_REQUIRED_SPEC = ("SPEC-RUN-01", "SPEC-GATE-01")
PREFLIGHT_REQUIRED_ARTIFACT_KIND = "desktop-performance-preflight"
COHORT_REQUIRED_PHASE = "P0c-3"
COHORT_REQUIRED_TASK = "P0c3-R2"
COHORT_REQUIRED_ARTIFACT_KIND = "desktop-performance-cohort-gate"
CELL_REQUIRED_PHASE = "P0c-3"
CELL_REQUIRED_ARTIFACT_KIND = "desktop-performance-runtime-cell"
RAW_EVENTS_REQUIRED_PHASE = "P0a-6/P0c-5"
RAW_EVENTS_REQUIRED_BOM = ("BOM-CAP-05", "BOM-RUN-05")
RAW_EVENTS_REQUIRED_SPEC = ("SPEC-STA-03", "SPEC-MIRROR-01")
RAW_EVENTS_REQUIRED_ARTIFACT_KIND = "desktop-performance-station-mirror"
RAW_EVENTS_REQUIRED_PRODUCT_SINK = "Station"
RAW_EVENTS_REQUIRED_ROLE = "Dev/CI evidence artifact"
MATRIX_ARTIFACT_KIND = "desktop-performance-matrix-gate"
MATRIX_PHASE = "P0c-3/P0c-4/P0c-5"
MATRIX_BOM = ("BOM-GATE-02", "BOM-GATE-03", "BOM-CAP-04", "BOM-RUN-05", "BOM-CAP-05")
MATRIX_SPEC = ("SPEC-GATE-02", "SPEC-GATE-03", "SPEC-RUN-01", "SPEC-MIRROR-01", "SPEC-STA-03")
MATRIX_GATE = (
    "Runtime matrix, red-line policy evaluation, and source evidence diagnostics must all remain "
    "fail-closed until sampled runtime evidence is proven"
)


@dataclass(frozen=True)
class MatrixCellSpec:
    cell_id: str
    runtime: str
    entrypoint: str
    startup_mode: str
    bom: tuple[str, ...]
    spec: tuple[str, ...]
    gate: str


@dataclass(frozen=True)
class RedLinePolicy:
    policy_id: str
    scope: str
    max_duration_ms: float | None
    required_event_kinds: tuple[str, ...]
    budget_event_kinds: tuple[str, ...]
    forbidden_event_kinds: tuple[str, ...] = ()


DEFAULT_CELLS = (
    MatrixCellSpec(
        cell_id="browser-gateway",
        runtime="browser-gateway",
        entrypoint="make desktop-web",
        startup_mode="dev-browser-gateway",
        bom=("BOM-GATE-02", "BOM-CAP-04"),
        spec=("SPEC-GATE-02", "SPEC-RUN-01"),
        gate="browser/gateway preflight must pass before samples are accepted",
    ),
    MatrixCellSpec(
        cell_id="tauri-webview-dev",
        runtime="tauri-webview-dev",
        entrypoint="make desktop",
        startup_mode="dev-tauri-webview",
        bom=("BOM-GATE-02", "BOM-CAP-04"),
        spec=("SPEC-GATE-02", "SPEC-RUN-01"),
        gate="Dev Tauri WebView evidence required; browser samples are not substitutes",
    ),
    MatrixCellSpec(
        cell_id="tauri-webview-packaged",
        runtime="tauri-webview-packaged",
        entrypoint="pnpm --dir apps/desktop tauri build --features e2e-testing",
        startup_mode="packaged-tauri-webview",
        bom=("BOM-GATE-02", "BOM-CAP-04"),
        spec=("SPEC-GATE-02", "SPEC-RUN-01"),
        gate="Packaged Tauri WebView evidence is mandatory for shipped Desktop claims",
    ),
)

RED_LINE_POLICIES = (
    RedLinePolicy(
        policy_id="primary-nav-click",
        scope="primary navigation click-frame",
        max_duration_ms=100.0,
        required_event_kinds=("interaction.started", "route.requested", "route.visible", "react.commit"),
        budget_event_kinds=("route.visible", "react.commit"),
        forbidden_event_kinds=("surface.hidden.render",),
    ),
    RedLinePolicy(
        policy_id="secondary-tab-click",
        scope="secondary tab click-frame",
        max_duration_ms=100.0,
        required_event_kinds=("interaction.started", "route.requested", "route.visible", "surface.render", "react.commit"),
        budget_event_kinds=("route.visible", "surface.render", "react.commit"),
        forbidden_event_kinds=("surface.hidden.render",),
    ),
    RedLinePolicy(
        policy_id="context-menu-visible",
        scope="right-click context menu intent-to-visible",
        max_duration_ms=50.0,
        required_event_kinds=("contextmenu.intent", "overlay.visible"),
        budget_event_kinds=("overlay.visible",),
    ),
    RedLinePolicy(
        policy_id="longtask",
        scope="main-thread long task",
        max_duration_ms=50.0,
        required_event_kinds=(),
        budget_event_kinds=("longtask.detected",),
    ),
    RedLinePolicy(
        policy_id="layout-shift",
        scope="main-thread layout shift",
        max_duration_ms=0.1,
        required_event_kinds=(),
        budget_event_kinds=("layout.shift",),
    ),
    RedLinePolicy(
        policy_id="paint-timing-evidence",
        scope="main-thread paint timing evidence",
        max_duration_ms=None,
        required_event_kinds=("paint.timing",),
        budget_event_kinds=(),
    ),
    RedLinePolicy(
        policy_id="hidden-render",
        scope="hidden render during click-frame",
        max_duration_ms=None,
        required_event_kinds=(),
        budget_event_kinds=(),
        forbidden_event_kinds=("surface.hidden.render",),
    ),
    RedLinePolicy(
        policy_id="click-frame-invoke",
        scope="click-frame invoke",
        max_duration_ms=100.0,
        required_event_kinds=("invoke.started",),
        budget_event_kinds=("invoke.completed", "invoke.failed"),
    ),
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def runtime_cell_issue_breakdown(spec: MatrixCellSpec, reason: str) -> list[dict[str, str]]:
    return [
        {
            "category": "runtime-cell-evidence",
            "failedStep": spec.cell_id,
            "summary": reason,
            "proofImpact": "P0c-3 remains PARTIAL/UNPROVEN until this runtime cell emits proven evidence.",
        }
    ]


def runtime_cell_review_commands(spec: MatrixCellSpec) -> list[dict[str, str]]:
    return [
        {
            "purpose": "Start the runtime through the planned Make entrypoint.",
            "command": spec.entrypoint,
        },
        {
            "purpose": "Collect runtime cell observations after the runtime is available.",
            "command": "python3 tooling/scripts/desktop-performance-cell-collect.py",
        },
        {
            "purpose": "Inspect this runtime cell evidence artifact.",
            "command": f"jq '{{status,proofStatus,issue_breakdown,recommended_review_commands}}' tooling/acceptance/reports/desktop-performance-cells/{spec.cell_id}.json",
        },
        {
            "purpose": "Re-run the matrix gate after runtime cell evidence exists.",
            "command": "python3 tooling/scripts/desktop-performance-matrix-gate.py",
        },
        {
            "purpose": "Re-run the full Phase 0 bundle and keep fail-closed evidence if runtime samples are still missing.",
            "command": "make acceptance PLAN=tooling/acceptance/plans/desktop-performance-phase0.json",
        },
    ]


def attach_runtime_cell_diagnostics(evidence: dict[str, Any], spec: MatrixCellSpec, reason: str) -> dict[str, Any]:
    issue_breakdown = runtime_cell_issue_breakdown(spec, reason)
    review_commands = runtime_cell_review_commands(spec)
    evidence["issue_breakdown"] = issue_breakdown
    evidence["issueBreakdown"] = issue_breakdown
    evidence["recommended_review_commands"] = review_commands
    evidence["recommendedReviewCommands"] = review_commands
    return evidence


def diagnostic_issue_breakdown(report: dict[str, Any]) -> Any:
    return report.get("issue_breakdown", report.get("issueBreakdown"))


def diagnostic_review_commands(report: dict[str, Any]) -> Any:
    return report.get("recommended_review_commands", report.get("recommendedReviewCommands"))


def live_gate_source_metadata(report: dict[str, Any], path: Path, source_status: str) -> dict[str, Any]:
    details: list[str] = []
    failed_step = report.get("failedStep")
    if isinstance(failed_step, str) and failed_step:
        details.append(f"failedStep={failed_step}")
    reason = report.get("reason")
    if isinstance(reason, str) and reason:
        details.append(reason)
    source_details = report.get("details")
    if isinstance(source_details, list):
        for item in source_details:
            if isinstance(item, dict):
                step = item.get("step")
                error = item.get("error")
                if step and error:
                    details.append(f"{step}: {error}")
                elif error:
                    details.append(str(error))
            elif item:
                details.append(str(item))
    evidence = {
        "path": str(path),
        "sourceArtifact": str(path),
        "status": "loaded",
        "sourceStatus": source_status,
        "completionStatus": report.get("completionStatus", "PARTIAL"),
        "proofStatus": report.get("proofStatus", "UNPROVEN"),
        "sourcePhase": report.get("phase"),
        "sourceBom": report.get("bom", []),
        "sourceSpec": report.get("spec", []),
        "sourceGate": report.get("gate"),
        "sourceArtifactKind": report.get("artifactKind"),
        "sampleEmissionAllowed": bool(report.get("sampleEmissionAllowed")) and source_status == "pass",
    }
    if isinstance(failed_step, str) and failed_step:
        evidence["failedStep"] = failed_step
    if details:
        evidence["details"] = details
    issue_breakdown = diagnostic_issue_breakdown(report)
    if isinstance(issue_breakdown, list):
        evidence["issue_breakdown"] = issue_breakdown
        evidence["issueBreakdown"] = issue_breakdown
    review_commands = diagnostic_review_commands(report)
    if isinstance(review_commands, list):
        evidence["recommended_review_commands"] = review_commands
        evidence["recommendedReviewCommands"] = review_commands
    return evidence


def validate_live_gate_source_metadata(report: dict[str, Any]) -> list[str]:
    reasons: list[str] = []
    if report.get("artifactKind") != LIVE_GATE_REQUIRED_ARTIFACT_KIND:
        reasons.append("missing or invalid artifactKind")
    if report.get("completionStatus") not in {"DONE", "PARTIAL"}:
        reasons.append("missing or invalid completionStatus")
    if report.get("proofStatus") not in {"PROVEN", "UNPROVEN"}:
        reasons.append("missing or invalid proofStatus")
    if report.get("phase") != LIVE_GATE_REQUIRED_PHASE:
        reasons.append("missing or invalid phase")
    source_bom = report.get("bom")
    if not isinstance(source_bom, list) or not all(item in source_bom for item in LIVE_GATE_REQUIRED_BOM):
        reasons.append("missing required P0a BOM binding")
    source_spec = report.get("spec")
    if not isinstance(source_spec, list) or not all(item in source_spec for item in LIVE_GATE_REQUIRED_SPEC):
        reasons.append("missing required P0a Spec binding")
    if not isinstance(report.get("gate"), str) or not report.get("gate"):
        reasons.append("missing gate")
    status = report.get("status")
    if status != "pass":
        issue_breakdown = diagnostic_issue_breakdown(report)
        if not isinstance(issue_breakdown, list) or not issue_breakdown:
            reasons.append("missing issue_breakdown")
        else:
            for issue in issue_breakdown:
                if not isinstance(issue, dict):
                    reasons.append("invalid issue_breakdown item")
                    break
                for key in ("category", "failedStep", "summary", "proofImpact"):
                    if not isinstance(issue.get(key), str) or not issue.get(key):
                        reasons.append(f"missing issue_breakdown.{key}")
        review_commands = diagnostic_review_commands(report)
        if not isinstance(review_commands, list) or not review_commands:
            reasons.append("missing recommended_review_commands")
        else:
            for command in review_commands:
                if not isinstance(command, dict):
                    reasons.append("invalid recommended_review_commands item")
                    break
                for key in ("purpose", "command"):
                    if not isinstance(command.get(key), str) or not command.get(key):
                        reasons.append(f"missing recommended_review_commands.{key}")
    return reasons


def preflight_source_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        reason = f"missing Desktop performance preflight report: {path}"
        issue_breakdown = [
            {
                "category": "desktop-performance-preflight",
                "failedStep": "desktop-performance-preflight",
                "summary": reason,
                "proofImpact": "P0c-1/P0c-2 remains PARTIAL/UNPROVEN until Desktop runtime preflight evidence exists.",
            }
        ]
        review_commands = [
            {"purpose": "Generate Desktop runtime preflight evidence.", "command": "python3 tooling/scripts/desktop-performance-preflight.py"},
            {"purpose": "Re-run the P0c matrix gate.", "command": "python3 tooling/scripts/desktop-performance-matrix-gate.py"},
            {"purpose": "Re-run the full Phase 0 bundle.", "command": "make acceptance PLAN=tooling/acceptance/plans/desktop-performance-phase0.json"},
        ]
        return {
            "path": str(path),
            "sourceArtifact": str(path),
            "status": "diagnostic incomplete",
            "sourceStatus": "missing",
            "completionStatus": "PARTIAL",
            "proofStatus": "UNPROVEN",
            "sourcePhase": PREFLIGHT_REQUIRED_PHASE,
            "sourceBom": list(PREFLIGHT_REQUIRED_BOM),
            "sourceSpec": list(PREFLIGHT_REQUIRED_SPEC),
            "sourceGate": "Desktop runtime preflight evidence must exist before matrix proof is allowed",
            "sourceArtifactKind": PREFLIGHT_REQUIRED_ARTIFACT_KIND,
            "sampleEmissionAllowed": False,
            "reason": reason,
            "details": ["missing preflight artifact"],
            "issue_breakdown": issue_breakdown,
            "issueBreakdown": issue_breakdown,
            "recommended_review_commands": review_commands,
            "recommendedReviewCommands": review_commands,
        }

    report = read_json(path)
    details: list[str] = []
    if report.get("artifactKind") != PREFLIGHT_REQUIRED_ARTIFACT_KIND:
        details.append("missing or invalid artifactKind")
    if report.get("phase") != PREFLIGHT_REQUIRED_PHASE:
        details.append("missing or invalid phase")
    source_bom = report.get("bom")
    if not isinstance(source_bom, list) or not all(item in source_bom for item in PREFLIGHT_REQUIRED_BOM):
        details.append("missing required preflight BOM binding")
    source_spec = report.get("spec")
    if not isinstance(source_spec, list) or not all(item in source_spec for item in PREFLIGHT_REQUIRED_SPEC):
        details.append("missing required preflight Spec binding")
    if not isinstance(report.get("gate"), str) or not report.get("gate"):
        details.append("missing gate")
    if report.get("completionStatus") != "DONE":
        details.append("missing or incomplete completionStatus")
    if report.get("proofStatus") != "PROVEN":
        details.append("missing or invalid proofStatus")
    if report.get("sampleEmissionAllowed") is not True:
        details.append("sample emission is not allowed")

    status = "pass" if not details else "diagnostic incomplete"
    evidence = {
        "path": str(path),
        "sourceArtifact": str(path),
        "status": status,
        "sourceStatus": report.get("status", "diagnostic incomplete"),
        "completionStatus": "DONE" if status == "pass" else "PARTIAL",
        "proofStatus": "PROVEN" if status == "pass" else "UNPROVEN",
        "sourcePhase": report.get("phase"),
        "sourceBom": report.get("bom", []),
        "sourceSpec": report.get("spec", []),
        "sourceGate": report.get("gate"),
        "sourceArtifactKind": report.get("artifactKind"),
        "sampleEmissionAllowed": bool(report.get("sampleEmissionAllowed")) and status == "pass",
        "reason": "Desktop performance preflight evidence is proven"
        if status == "pass"
        else report.get("reason") or "Desktop performance preflight evidence is incomplete",
        "failedStep": report.get("failedStep"),
        "details": details,
    }
    issue_breakdown = diagnostic_issue_breakdown(report)
    if isinstance(issue_breakdown, list):
        evidence["issue_breakdown"] = issue_breakdown
        evidence["issueBreakdown"] = issue_breakdown
    review_commands = diagnostic_review_commands(report)
    if isinstance(review_commands, list):
        evidence["recommended_review_commands"] = review_commands
        evidence["recommendedReviewCommands"] = review_commands
    return evidence


def cohort_source_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        reason = f"missing Desktop performance cohort gate report: {path}"
        issues = [
            {
                "category": "desktop-performance-cohort",
                "failedStep": "desktop-performance-cohort",
                "summary": reason,
                "proofImpact": "P0c3-R2 remains PARTIAL/UNPROVEN and every runtime cell stays blocked.",
            }
        ]
        return {
            "path": str(path),
            "sourceArtifact": str(path),
            "status": "diagnostic incomplete",
            "sourceStatus": "missing",
            "completionStatus": "PARTIAL",
            "proofStatus": "UNPROVEN",
            "sourcePhase": COHORT_REQUIRED_PHASE,
            "sourceTask": COHORT_REQUIRED_TASK,
            "sourceGate": "Cohort gate evidence must exist before matrix samples are admitted",
            "sourceArtifactKind": COHORT_REQUIRED_ARTIFACT_KIND,
            "sampleEmissionAllowed": False,
            "reason": reason,
            "issue_breakdown": issues,
            "issueBreakdown": issues,
        }

    report = read_json(path)
    details: list[str] = []
    if report.get("artifactKind") != COHORT_REQUIRED_ARTIFACT_KIND:
        details.append("missing or invalid artifactKind")
    if report.get("phase") != COHORT_REQUIRED_PHASE:
        details.append("missing or invalid phase")
    if report.get("planTask") != COHORT_REQUIRED_TASK:
        details.append("missing or invalid planTask")
    if not isinstance(report.get("gate"), str) or not report.get("gate"):
        details.append("missing gate")
    if report.get("completionStatus") != "DONE":
        details.append("missing or incomplete completionStatus")
    if report.get("proofStatus") != "PROVEN":
        details.append("missing or invalid proofStatus")
    if report.get("sampleEmissionAllowed") is not True:
        details.append("sample emission is not allowed")
    status = "pass" if not details else "diagnostic incomplete"
    evidence = {
        "path": str(path),
        "sourceArtifact": str(path),
        "status": status,
        "sourceStatus": report.get("status", "diagnostic incomplete"),
        "completionStatus": "DONE" if status == "pass" else "PARTIAL",
        "proofStatus": "PROVEN" if status == "pass" else "UNPROVEN",
        "sourcePhase": report.get("phase"),
        "sourceTask": report.get("planTask"),
        "sourceGate": report.get("gate"),
        "sourceArtifactKind": report.get("artifactKind"),
        "sampleEmissionAllowed": bool(report.get("sampleEmissionAllowed")) and status == "pass",
        "reason": "Desktop performance cohort identity is proven"
        if status == "pass"
        else report.get("reason") or "Desktop performance cohort evidence is incomplete",
        "failedStep": report.get("failedStep"),
        "details": details,
    }
    source_issues = diagnostic_issue_breakdown(report)
    if isinstance(source_issues, list):
        evidence["issue_breakdown"] = source_issues
        evidence["issueBreakdown"] = source_issues
    return evidence


def status_from_live_gate(path: Path) -> tuple[str, dict[str, Any]]:
    if not path.exists():
        return (
            "baseline preflight failure",
            {
                "reason": "missing live gate report",
                "path": str(path),
                "sourceArtifact": str(path),
                "status": "missing",
                "sourceStatus": "missing",
                "completionStatus": "PARTIAL",
                "proofStatus": "UNPROVEN",
                "sourceArtifactKind": LIVE_GATE_REQUIRED_ARTIFACT_KIND,
                "sourcePhase": LIVE_GATE_REQUIRED_PHASE,
                "sourceBom": list(LIVE_GATE_REQUIRED_BOM),
                "sourceSpec": list(LIVE_GATE_REQUIRED_SPEC),
                "sourceGate": "Desktop Gateway upload, Station ingest, raw/rollup query, and Dev mirror must all pass before live telemetry is proven",
                "sampleEmissionAllowed": False,
            },
        )
    report = read_json(path)
    status = str(report.get("status") or "diagnostic incomplete")
    evidence = live_gate_source_metadata(report, path, status)
    metadata_reasons = validate_live_gate_source_metadata(report)
    if metadata_reasons:
        evidence["status"] = "missing-source-metadata"
        evidence["reason"] = "live gate report is missing required source metadata"
        evidence["details"] = metadata_reasons
        evidence["sampleEmissionAllowed"] = False
        return (
            "blocked",
            evidence,
        )
    if status == "pass":
        evidence["interactionId"] = report.get("interactionId")
        return (
            "sampled",
            evidence,
        )
    if status == "baseline preflight failure":
        evidence["error"] = report.get("error")
        evidence["steps"] = report.get("steps", [])
        return (
            "baseline preflight failure",
            evidence,
        )
    evidence["error"] = report.get("error")
    return (
        "blocked",
        evidence,
    )


def validate_cell_source_metadata(spec: MatrixCellSpec, report: dict[str, Any]) -> list[str]:
    reasons: list[str] = []
    if report.get("artifactKind") != CELL_REQUIRED_ARTIFACT_KIND:
        reasons.append("missing or invalid artifactKind")
    if report.get("completionStatus") not in {"DONE", "PARTIAL"}:
        reasons.append("missing or invalid completionStatus")
    if report.get("proofStatus") not in {"PROVEN", "UNPROVEN"}:
        reasons.append("missing or invalid proofStatus")
    if report.get("phase") != CELL_REQUIRED_PHASE:
        reasons.append("missing or invalid phase")
    if report.get("cellId") != spec.cell_id:
        reasons.append("missing or invalid cellId")
    if report.get("entrypoint") != spec.entrypoint:
        reasons.append("missing or invalid entrypoint")
    if report.get("startupMode") != spec.startup_mode:
        reasons.append("missing or invalid startupMode")
    source_bom = report.get("bom")
    if not isinstance(source_bom, list) or not all(item in source_bom for item in spec.bom):
        reasons.append("missing required BOM binding")
    source_spec = report.get("spec")
    if not isinstance(source_spec, list) or not all(item in source_spec for item in spec.spec):
        reasons.append("missing required Spec binding")
    if not isinstance(report.get("gate"), str) or not report.get("gate"):
        reasons.append("missing gate")
    return reasons


def status_from_cell_evidence(spec: MatrixCellSpec, evidence_dir: Path) -> tuple[str, dict[str, Any]]:
    path = evidence_dir / f"{spec.cell_id}.json"
    if not path.exists():
        return (
            "diagnostic incomplete",
            attach_runtime_cell_diagnostics(
                {
                "reason": "missing runtime cell evidence report",
                "path": str(path),
                "sourceArtifact": str(path),
                "status": "missing",
                "sourceArtifactKind": CELL_REQUIRED_ARTIFACT_KIND,
                "sourcePhase": CELL_REQUIRED_PHASE,
                "sourceBom": list(spec.bom),
                "sourceSpec": list(spec.spec),
                "sourceGate": spec.gate,
                "sourceCellId": spec.cell_id,
                "sourceEntrypoint": spec.entrypoint,
                "sourceStartupMode": spec.startup_mode,
                "sampleEmissionAllowed": False,
            },
                spec,
                "missing runtime cell evidence report",
            ),
        )
    try:
        report = read_json(path)
    except (OSError, json.JSONDecodeError) as exc:
        return (
            "blocked",
            attach_runtime_cell_diagnostics(
                {
                "reason": "runtime cell evidence report is unreadable",
                "path": str(path),
                "sourceArtifact": str(path),
                "status": "unreadable",
                "error": str(exc),
                "sourceArtifactKind": CELL_REQUIRED_ARTIFACT_KIND,
                "sourcePhase": CELL_REQUIRED_PHASE,
                "sourceBom": list(spec.bom),
                "sourceSpec": list(spec.spec),
                "sourceGate": spec.gate,
                "sourceCellId": spec.cell_id,
                "sourceEntrypoint": spec.entrypoint,
                "sourceStartupMode": spec.startup_mode,
                "sampleEmissionAllowed": False,
            },
                spec,
                "runtime cell evidence report is unreadable",
            ),
        )

    status = str(report.get("status") or "diagnostic incomplete")
    if status not in ALLOWED_STATUSES:
        return (
            "blocked",
            attach_runtime_cell_diagnostics(
                {
                "reason": "runtime cell evidence report has invalid status",
                "path": str(path),
                "sourceArtifact": str(path),
                "status": "invalid-status",
                "sourceStatus": status,
                "sourceArtifactKind": report.get("artifactKind"),
                "sourcePhase": report.get("phase"),
                "sourceBom": report.get("bom", []),
                "sourceSpec": report.get("spec", []),
                "sourceGate": report.get("gate"),
                "sourceCellId": report.get("cellId"),
                "sourceEntrypoint": report.get("entrypoint"),
                "sourceStartupMode": report.get("startupMode"),
                "sampleEmissionAllowed": False,
            },
                spec,
                "runtime cell evidence report has invalid status",
            ),
        )
    runtime = report.get("runtime")
    if runtime is not None and runtime != spec.runtime:
        return (
            "blocked",
            attach_runtime_cell_diagnostics(
                {
                "reason": "runtime cell evidence report runtime mismatch",
                "path": str(path),
                "sourceArtifact": str(path),
                "status": "runtime-mismatch",
                "expectedRuntime": spec.runtime,
                "actualRuntime": runtime,
                "sourceArtifactKind": report.get("artifactKind"),
                "sourcePhase": report.get("phase"),
                "sourceBom": report.get("bom", []),
                "sourceSpec": report.get("spec", []),
                "sourceGate": report.get("gate"),
                "sourceCellId": report.get("cellId"),
                "sourceEntrypoint": report.get("entrypoint"),
                "sourceStartupMode": report.get("startupMode"),
                "sampleEmissionAllowed": False,
            },
                spec,
                "runtime cell evidence report runtime mismatch",
            ),
        )
    metadata_reasons = validate_cell_source_metadata(spec, report)
    if metadata_reasons:
        return (
            "blocked",
            attach_runtime_cell_diagnostics(
                {
                "reason": "runtime cell evidence report is missing required source metadata",
                "details": metadata_reasons,
                "path": str(path),
                "sourceArtifact": str(path),
                "status": "missing-source-metadata",
                "sourceStatus": status,
                "sourceArtifactKind": report.get("artifactKind"),
                "sourcePhase": report.get("phase"),
                "sourceBom": report.get("bom", []),
                "sourceSpec": report.get("spec", []),
                "sourceGate": report.get("gate"),
                "sourceCellId": report.get("cellId"),
                "sourceEntrypoint": report.get("entrypoint"),
                "sourceStartupMode": report.get("startupMode"),
                "sampleEmissionAllowed": False,
            },
                spec,
                "runtime cell evidence report is missing required source metadata",
            ),
        )
    evidence = {
            "path": str(path),
            "sourceArtifact": str(path),
            "status": "loaded",
            "sourceStatus": status,
            "completionStatus": report.get("completionStatus", "PARTIAL"),
            "proofStatus": report.get("proofStatus", "UNPROVEN"),
            "sourcePhase": report.get("phase"),
            "sourceBom": report.get("bom", []),
            "sourceSpec": report.get("spec", []),
            "sourceGate": report.get("gate"),
            "sourceArtifactKind": report.get("artifactKind"),
            "sourceCellId": report.get("cellId"),
            "sourceEntrypoint": report.get("entrypoint"),
            "sourceStartupMode": report.get("startupMode"),
            "interactionId": report.get("interactionId"),
            "readyShell": report.get("readyShell"),
            "sampleEmissionAllowed": bool(report.get("sampleEmissionAllowed")) and status == "sampled",
    }
    if not evidence["sampleEmissionAllowed"]:
        attach_runtime_cell_diagnostics(evidence, spec, str(report.get("reason") or status))
    return (
        status,
        evidence,
    )


def load_raw_events(path: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if not path.exists():
        return [], {
            "path": str(path),
            "sourceArtifact": str(path),
            "status": "missing",
            "sourceArtifactKind": RAW_EVENTS_REQUIRED_ARTIFACT_KIND,
            "sourcePhase": RAW_EVENTS_REQUIRED_PHASE,
            "sourceBom": list(RAW_EVENTS_REQUIRED_BOM),
            "sourceSpec": list(RAW_EVENTS_REQUIRED_SPEC),
            "sourceGate": "Dev/CI mirror artifact must preserve Station query evidence without becoming the product telemetry sink",
        }
    report = read_json(path)
    events = report.get("events")
    if not isinstance(events, list):
        return [], {"path": str(path), "sourceArtifact": str(path), "status": "missing-events"}
    typed_events = [event for event in events if isinstance(event, dict)]
    metadata_reasons = validate_raw_events_source_metadata(report)
    proof_reasons = validate_raw_events_source_proof(report)
    if metadata_reasons or proof_reasons:
        status = "missing-source-metadata" if metadata_reasons else "source-proof-unproven"
        reason = (
            "raw events report is missing required Station mirror source metadata"
            if metadata_reasons
            else "raw events report preserves source metadata but Station mirror proof is unproven"
        )
        return [], {
            "path": str(path),
            "sourceArtifact": str(path),
            "status": status,
            "eventCount": len(typed_events),
            "reason": reason,
            "details": metadata_reasons + proof_reasons,
            "sourcePhase": report.get("phase"),
            "sourceBom": report.get("bom", []),
            "sourceSpec": report.get("spec", []),
            "sourceGate": report.get("gate"),
            "sourceArtifactKind": report.get("artifactKind"),
            "completionStatus": report.get("completionStatus"),
            "proofStatus": report.get("proofStatus"),
        }
    return typed_events, {
        "path": str(path),
        "sourceArtifact": str(path),
        "status": "loaded",
        "eventCount": len(typed_events),
        "completionStatus": report.get("completionStatus"),
        "proofStatus": report.get("proofStatus"),
        "sourcePhase": report.get("phase"),
        "sourceBom": report.get("bom", []),
        "sourceSpec": report.get("spec", []),
        "sourceGate": report.get("gate"),
        "sourceArtifactKind": report.get("artifactKind"),
        "productSink": report.get("productSink"),
        "mirrorRole": report.get("mirrorRole"),
    }


def validate_raw_events_source_metadata(report: dict[str, Any]) -> list[str]:
    reasons: list[str] = []
    if report.get("artifactKind") != RAW_EVENTS_REQUIRED_ARTIFACT_KIND:
        reasons.append("missing or invalid artifactKind")
    if report.get("phase") != RAW_EVENTS_REQUIRED_PHASE:
        reasons.append("missing or invalid phase")
    source_bom = report.get("bom")
    if not isinstance(source_bom, list) or not all(item in source_bom for item in RAW_EVENTS_REQUIRED_BOM):
        reasons.append("missing required raw event BOM binding")
    source_spec = report.get("spec")
    if not isinstance(source_spec, list) or not all(item in source_spec for item in RAW_EVENTS_REQUIRED_SPEC):
        reasons.append("missing required raw event Spec binding")
    if not isinstance(report.get("gate"), str) or not report.get("gate"):
        reasons.append("missing gate")
    if report.get("productSink") != RAW_EVENTS_REQUIRED_PRODUCT_SINK:
        reasons.append("missing Station product sink boundary")
    if report.get("mirrorRole") != RAW_EVENTS_REQUIRED_ROLE:
        reasons.append("missing Dev/CI mirror role boundary")
    return reasons


def validate_raw_events_source_proof(report: dict[str, Any]) -> list[str]:
    reasons: list[str] = []
    if report.get("completionStatus") != "DONE":
        reasons.append(f"source completionStatus is {report.get('completionStatus')!r}; expected 'DONE'")
    if report.get("proofStatus") != "PROVEN":
        reasons.append(f"source proofStatus is {report.get('proofStatus')!r}; expected 'PROVEN'")
    return reasons


def event_kinds(events: list[dict[str, Any]]) -> set[str]:
    return {str(event.get("kind")) for event in events if event.get("kind")}


def event_interaction_id(event: dict[str, Any]) -> str | None:
    interaction_id = event.get("interactionId")
    return str(interaction_id) if interaction_id else None


def interaction_windows(events: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    windows: dict[str, list[dict[str, Any]]] = {}
    for event in events:
        interaction_id = event_interaction_id(event)
        if interaction_id is None:
            continue
        windows.setdefault(interaction_id, []).append(event)
    return windows


def event_duration(event: dict[str, Any]) -> float | None:
    value = event.get("durationMs")
    if isinstance(value, (int, float)):
        return float(value)
    return None


def evaluate_red_line_policy(
    policy: RedLinePolicy,
    events: list[dict[str, Any]],
    event_evidence: dict[str, Any],
    sampled_cell_count: int,
) -> dict[str, Any]:
    if sampled_cell_count == 0:
        return {
            "policyId": policy.policy_id,
            "scope": policy.scope,
            "status": "diagnostic incomplete",
            "proofStatus": "UNPROVEN",
            "reason": "no sampled matrix cell; red-line cannot be evaluated",
            "maxDurationMs": policy.max_duration_ms,
            "requiredEventKinds": list(policy.required_event_kinds),
            "budgetEventKinds": list(policy.budget_event_kinds),
            "forbiddenEventKinds": list(policy.forbidden_event_kinds),
            "rawEvidence": event_evidence,
        }
    if event_evidence.get("status") != "loaded":
        return {
            "policyId": policy.policy_id,
            "scope": policy.scope,
            "status": "diagnostic incomplete",
            "proofStatus": "UNPROVEN",
            "reason": "raw event evidence is not loaded/proven",
            "maxDurationMs": policy.max_duration_ms,
            "requiredEventKinds": list(policy.required_event_kinds),
            "budgetEventKinds": list(policy.budget_event_kinds),
            "forbiddenEventKinds": list(policy.forbidden_event_kinds),
            "rawEvidence": event_evidence,
        }

    windows = interaction_windows(events)
    candidate_windows = [
        (interaction_id, window_events)
        for interaction_id, window_events in windows.items()
        if all(kind in event_kinds(window_events) for kind in policy.required_event_kinds)
    ]
    if policy.required_event_kinds and not candidate_windows:
        return {
            "policyId": policy.policy_id,
            "scope": policy.scope,
            "status": "fail",
            "proofStatus": "UNPROVEN",
            "reason": "no single interactionId window contains required event kinds",
            "maxDurationMs": policy.max_duration_ms,
            "requiredEventKinds": list(policy.required_event_kinds),
            "missingEventKinds": [
                kind for kind in policy.required_event_kinds if kind not in event_kinds(events)
            ],
            "missingInteractionWindowEventKinds": [
                kind for kind in policy.required_event_kinds if kind not in event_kinds(events)
            ],
            "budgetEventKinds": list(policy.budget_event_kinds),
            "forbiddenEventKinds": list(policy.forbidden_event_kinds),
            "interactionWindowCount": len(windows),
            "rawEvidence": event_evidence,
        }

    scoped_events = [
        event
        for _, window_events in candidate_windows
        for event in window_events
    ] if policy.required_event_kinds else events
    kinds = event_kinds(scoped_events)
    missing = [kind for kind in policy.required_event_kinds if kind not in kinds]
    forbidden = [kind for kind in policy.forbidden_event_kinds if kind in kinds]
    durations = [
        duration
        for event in events
        if str(event.get("kind")) in policy.budget_event_kinds
        for duration in [event_duration(event)]
        if duration is not None
    ]
    max_observed = max(durations) if durations else None
    over_budget = (
        policy.max_duration_ms is not None
        and max_observed is not None
        and max_observed > policy.max_duration_ms
    )
    if missing or forbidden or over_budget:
        reasons = []
        if missing:
            reasons.append(f"missing required event kinds: {', '.join(missing)}")
        if forbidden:
            reasons.append(f"forbidden event kinds present: {', '.join(forbidden)}")
        if over_budget:
            reasons.append(f"max duration {max_observed}ms exceeds budget {policy.max_duration_ms}ms")
        return {
            "policyId": policy.policy_id,
            "scope": policy.scope,
            "status": "fail",
            "proofStatus": "UNPROVEN",
            "reason": "; ".join(reasons),
            "maxDurationMs": policy.max_duration_ms,
            "maxObservedDurationMs": max_observed,
            "matchedInteractionIds": [interaction_id for interaction_id, _ in candidate_windows],
            "requiredEventKinds": list(policy.required_event_kinds),
            "missingEventKinds": missing,
            "budgetEventKinds": list(policy.budget_event_kinds),
            "forbiddenEventKinds": list(policy.forbidden_event_kinds),
            "presentForbiddenEventKinds": forbidden,
            "rawEvidence": event_evidence,
        }

    return {
        "policyId": policy.policy_id,
        "scope": policy.scope,
        "status": "pass",
        "proofStatus": "PROVEN",
        "reason": "required events present and observed durations are within budget",
        "maxDurationMs": policy.max_duration_ms,
        "maxObservedDurationMs": max_observed,
        "matchedInteractionIds": [interaction_id for interaction_id, _ in candidate_windows],
        "requiredEventKinds": list(policy.required_event_kinds),
        "budgetEventKinds": list(policy.budget_event_kinds),
        "forbiddenEventKinds": list(policy.forbidden_event_kinds),
        "rawEvidence": event_evidence,
    }


def evaluate_red_lines(events: list[dict[str, Any]], event_evidence: dict[str, Any], sampled_cell_count: int) -> dict[str, Any]:
    policies = [
        evaluate_red_line_policy(policy, events, event_evidence, sampled_cell_count)
        for policy in RED_LINE_POLICIES
    ]
    failed = [policy for policy in policies if policy["status"] == "fail"]
    incomplete = [policy for policy in policies if policy["status"] == "diagnostic incomplete"]
    status = "fail" if failed else ("diagnostic incomplete" if incomplete else "pass")
    return {
        "status": status,
        "completionStatus": "DONE" if status == "pass" else "PARTIAL",
        "proofStatus": "PROVEN" if status == "pass" else "UNPROVEN",
        "bom": ["BOM-GATE-03"],
        "spec": ["SPEC-GATE-03"],
        "gate": "Over-budget or missing required event fails the red-line gate",
        "rawEvidence": event_evidence,
        "policies": policies,
        "summary": {
            "policyCount": len(policies),
            "passed": len([policy for policy in policies if policy["status"] == "pass"]),
            "failed": len(failed),
            "diagnosticIncomplete": len(incomplete),
        },
    }


def format_markdown_list(value: Any) -> str:
    if isinstance(value, list):
        return ",".join(str(item) for item in value)
    if value is None:
        return "n/a"
    return str(value)


def matrix_review_commands() -> list[dict[str, str]]:
    return [
        {
            "purpose": "Start the Desktop development runtime through the project entrypoint.",
            "command": "make desktop",
        },
        {
            "purpose": "Run the P0a live telemetry gate to populate browser/gateway matrix evidence.",
            "command": "python3 tooling/scripts/desktop-telemetry-live-gate.py",
        },
        {
            "purpose": "Collect runtime cell observations after target runtimes are available.",
            "command": "python3 tooling/scripts/desktop-performance-cell-collect.py",
        },
        {
            "purpose": "Prove all runtime cells share one cohort and actual actor.",
            "command": "python3 tooling/scripts/desktop-performance-cohort-gate.py",
        },
        {
            "purpose": "Re-run the P0c matrix gate.",
            "command": "python3 tooling/scripts/desktop-performance-matrix-gate.py",
        },
        {
            "purpose": "Re-run the full Phase 0 bundle and keep fail-closed evidence if runtime samples are still missing.",
            "command": "make acceptance PLAN=tooling/acceptance/plans/desktop-performance-phase0.json",
        },
    ]


def matrix_issue_breakdown(
    cells: list[dict[str, Any]],
    red_lines: dict[str, Any],
    preflight: dict[str, Any],
    cohort: dict[str, Any],
) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []

    def normalize_issue(issue: dict[str, Any], source: dict[str, Any]) -> dict[str, Any]:
        normalized = dict(issue)

        def fill(key: str, value: Any) -> None:
            if key not in normalized or normalized[key] in (None, "", []):
                normalized[key] = value

        fill("status", "diagnostic incomplete")
        fill("completionStatus", "PARTIAL")
        fill("proofStatus", "UNPROVEN")
        fill("sampleEmissionAllowed", False)
        fill("sourceArtifact", source.get("sourceArtifact") or source.get("path") or "tooling/acceptance/reports/desktop-performance-matrix-latest.json")
        fill("sourceArtifactKind", source.get("sourceArtifactKind") or MATRIX_ARTIFACT_KIND)
        fill("sourcePhase", source.get("sourcePhase") or MATRIX_PHASE)
        fill("sourceBom", source.get("sourceBom") or list(MATRIX_BOM))
        fill("sourceSpec", source.get("sourceSpec") or list(MATRIX_SPEC))
        fill("sourceGate", source.get("sourceGate") or MATRIX_GATE)
        return normalized

    if preflight.get("status") != "pass":
        source_issues = preflight.get("issue_breakdown", preflight.get("issueBreakdown"))
        if isinstance(source_issues, list) and source_issues:
            for issue in source_issues:
                if isinstance(issue, dict):
                    issues.append(normalize_issue(issue, preflight))
        else:
            issues.append(
                normalize_issue({
                    "category": "desktop-performance-preflight",
                    "failedStep": str(preflight.get("failedStep") or "desktop-performance-preflight"),
                    "summary": str(preflight.get("reason") or "Desktop performance preflight evidence is incomplete"),
                    "proofImpact": "P0c-1/P0c-2 remains PARTIAL/UNPROVEN until Desktop runtime preflight evidence is proven.",
                }, preflight)
            )
    if cohort.get("status") != "pass":
        source_issues = cohort.get("issue_breakdown", cohort.get("issueBreakdown"))
        if isinstance(source_issues, list) and source_issues:
            for issue in source_issues:
                if isinstance(issue, dict):
                    issues.append(normalize_issue(issue, cohort))
        else:
            issues.append(
                normalize_issue({
                    "category": "desktop-performance-cohort",
                    "failedStep": str(cohort.get("failedStep") or "desktop-performance-cohort"),
                    "summary": str(cohort.get("reason") or "Desktop performance cohort evidence is incomplete"),
                    "proofImpact": "P0c3-R2 remains PARTIAL/UNPROVEN and every runtime cell stays blocked.",
                }, cohort)
            )
    for cell in cells:
        if cell.get("sampleEmissionAllowed"):
            continue
        evidence = cell.get("evidence")
        source_issues = (
            evidence.get("issue_breakdown", evidence.get("issueBreakdown"))
            if isinstance(evidence, dict)
            else None
        )
        if isinstance(source_issues, list) and source_issues:
            for issue in source_issues:
                if isinstance(issue, dict):
                    issues.append(normalize_issue(issue, evidence))
            continue
        issues.append(
            normalize_issue({
                "category": "matrix-cell",
                "failedStep": str(cell.get("cellId") or "unknown"),
                "summary": str(cell.get("reason") or "matrix cell sample emission is blocked"),
                "proofImpact": "P0c-3 remains PARTIAL/UNPROVEN until every runtime cell emits proven evidence.",
            }, evidence if isinstance(evidence, dict) else {})
        )
    for policy in red_lines.get("policies", []):
        if policy.get("status") == "pass":
            continue
        policy_id = str(policy.get("policyId") or "unknown")
        issues.append(
            normalize_issue({
                "category": f"red-line:{policy_id}",
                "failedStep": policy_id,
                "summary": str(policy.get("reason") or "red-line policy evidence is not proven"),
                "proofImpact": "P0c-4/P0c-5 remains PARTIAL/UNPROVEN until sampled red-line evidence is present and evaluated.",
            }, red_lines)
        )
    return issues


def build_cell(
    spec: MatrixCellSpec,
    *,
    status: str,
    reason: str,
    evidence: dict[str, Any],
    cohort_allowed: bool,
) -> dict[str, Any]:
    if status not in ALLOWED_STATUSES:
        raise ValueError(f"invalid cell status {status!r}")
    sample_allowed = bool(evidence.get("sampleEmissionAllowed")) and status == "sampled" and cohort_allowed
    proof_status = "PROVEN" if sample_allowed else "UNPROVEN"
    completion_status = "DONE" if sample_allowed else "PARTIAL"
    return {
        "cellId": spec.cell_id,
        "runtime": spec.runtime,
        "entrypoint": spec.entrypoint,
        "startupMode": spec.startup_mode,
        "status": status,
        "completionStatus": completion_status,
        "proofStatus": proof_status,
        "reason": reason,
        "sampleEmissionAllowed": sample_allowed,
        "cohortSampleEmissionAllowed": cohort_allowed,
        "bom": list(spec.bom),
        "spec": list(spec.spec),
        "gate": spec.gate,
        "sourceArtifact": evidence.get("sourceArtifact") or evidence.get("path"),
        "sourceArtifactKind": evidence.get("sourceArtifactKind"),
        "sourcePhase": evidence.get("sourcePhase"),
        "sourceBom": evidence.get("sourceBom"),
        "sourceSpec": evidence.get("sourceSpec"),
        "sourceGate": evidence.get("sourceGate"),
        "evidence": evidence,
    }


def build_matrix(args: argparse.Namespace) -> dict[str, Any]:
    cells: list[dict[str, Any]] = []
    cell_evidence_dir = Path(args.cell_evidence_dir)
    preflight_report = getattr(args, "preflight_report", None)
    if preflight_report is None:
        preflight_report = str(Path(args.live_gate_report).with_name("desktop-performance-preflight.json"))
    preflight = preflight_source_state(Path(preflight_report))
    cohort_report = getattr(args, "cohort_report", None)
    if cohort_report is None:
        cohort_report = str(Path(args.events_report).with_name("desktop-performance-cohort-gate.json"))
    cohort = cohort_source_state(Path(cohort_report))
    cohort_allowed = bool(cohort.get("sampleEmissionAllowed"))
    for spec in DEFAULT_CELLS:
        if spec.cell_id == "browser-gateway":
            status, evidence = status_from_live_gate(Path(args.live_gate_report))
            reason = "uses desktop telemetry live gate report"
        else:
            status, evidence = status_from_cell_evidence(spec, cell_evidence_dir)
            reason = "uses runtime-specific cell evidence report"
        cells.append(
            build_cell(
                spec,
                status=status,
                reason=reason,
                evidence=evidence,
                cohort_allowed=cohort_allowed,
            )
        )

    sampled = [cell for cell in cells if cell["sampleEmissionAllowed"]]
    sample_blocked = [cell for cell in cells if not cell["sampleEmissionAllowed"]]
    events, event_evidence = load_raw_events(Path(args.events_report))
    red_lines = evaluate_red_lines(events, event_evidence, len(sampled))
    status = "pass" if len(sampled) == len(cells) and red_lines["status"] == "pass" else "diagnostic incomplete"
    if sampled and red_lines["status"] == "fail":
        status = "fail"
    report = {
        "schemaVersion": 1,
        "artifactKind": MATRIX_ARTIFACT_KIND,
        "generatedAt": utc_now(),
        "status": status,
        "completionStatus": "DONE" if status == "pass" else "PARTIAL",
        "proofStatus": "PROVEN" if status == "pass" else "UNPROVEN",
        "sampleEmissionAllowed": status == "pass",
        "phase": MATRIX_PHASE,
        "bom": list(MATRIX_BOM),
        "spec": list(MATRIX_SPEC),
        "gate": MATRIX_GATE,
        "plan": {
            "task": "P0c-3",
            "bom": ["BOM-GATE-02", "BOM-CAP-04"],
            "spec": ["SPEC-GATE-02", "SPEC-RUN-01"],
            "gate": "Every matrix cell reports explicit state before red-line evaluation",
        },
        "failClosed": {
            "sampleEmissionRequiresPreflightPass": True,
            "preflightSampleEmissionAllowed": bool(preflight.get("sampleEmissionAllowed")),
            "sampleEmissionRequiresCohortPass": True,
            "cohortSampleEmissionAllowed": cohort_allowed,
            "allowedStatuses": sorted(ALLOWED_STATUSES),
            "blockedCellCount": len(sample_blocked),
        },
        "preflightState": preflight,
        "cohortState": cohort,
        "redLinePolicy": red_lines,
        "cells": cells,
        "summary": {
            "cellCount": len(cells),
            "sampled": len(sampled),
            "blocked": len([cell for cell in cells if cell["status"] == "blocked"]),
            "baselinePreflightFailure": len(
                [cell for cell in cells if cell["status"] == "baseline preflight failure"]
            ),
            "diagnosticIncomplete": len([cell for cell in cells if cell["status"] == "diagnostic incomplete"]),
            "sampleEmissionAllowed": status == "pass",
        },
    }
    if status != "pass":
        issue_breakdown = matrix_issue_breakdown(cells, red_lines, preflight, cohort)
        review_commands = matrix_review_commands()
        report["issue_breakdown"] = issue_breakdown
        report["issueBreakdown"] = issue_breakdown
        report["recommended_review_commands"] = review_commands
        report["recommendedReviewCommands"] = review_commands
    return report


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        "# Desktop Performance Matrix Gate",
        "",
        f"- Generated: `{report['generatedAt']}`",
        f"- Status: `{report['status']}`",
        f"- Completion: `{report['completionStatus']}`",
        f"- Proof: `{report['proofStatus']}`",
        f"- Red-line status: `{report['redLinePolicy']['status']}`",
        f"- Plan task: `{report['plan']['task']}`",
        f"- BOM: `{', '.join(report['plan']['bom'])}`",
        f"- Spec: `{', '.join(report['plan']['spec'])}`",
        f"- Gate: `{report['plan']['gate']}`",
        "",
        "## Runtime Preflight",
        "",
        f"- Status: `{report['preflightState']['status']}`",
        f"- Completion: `{report['preflightState']['completionStatus']}`",
        f"- Proof: `{report['preflightState']['proofStatus']}`",
        f"- Source status: `{report['preflightState'].get('sourceStatus')}`",
        f"- Source artifact: `{report['preflightState'].get('sourceArtifact')}`",
        f"- Source kind: `{report['preflightState'].get('sourceArtifactKind')}`",
        f"- Source phase: `{report['preflightState'].get('sourcePhase')}`",
        f"- Source BOM: `{format_markdown_list(report['preflightState'].get('sourceBom'))}`",
        f"- Source Spec: `{format_markdown_list(report['preflightState'].get('sourceSpec'))}`",
        f"- Source Gate: `{report['preflightState'].get('sourceGate')}`",
        f"- Sample emission allowed: `{report['preflightState'].get('sampleEmissionAllowed')}`",
        f"- Reason: `{report['preflightState'].get('reason')}`",
        "",
        "## Cohort Preflight",
        "",
        f"- Status: `{report['cohortState']['status']}`",
        f"- Completion: `{report['cohortState']['completionStatus']}`",
        f"- Proof: `{report['cohortState']['proofStatus']}`",
        f"- Source status: `{report['cohortState'].get('sourceStatus')}`",
        f"- Source artifact: `{report['cohortState'].get('sourceArtifact')}`",
        f"- Source kind: `{report['cohortState'].get('sourceArtifactKind')}`",
        f"- Source phase: `{report['cohortState'].get('sourcePhase')}`",
        f"- Source task: `{report['cohortState'].get('sourceTask')}`",
        f"- Source Gate: `{report['cohortState'].get('sourceGate')}`",
        f"- Sample emission allowed: `{report['cohortState'].get('sampleEmissionAllowed')}`",
        f"- Reason: `{report['cohortState'].get('reason')}`",
        "",
        "## Matrix",
        "",
        "| Cell | Runtime | Entrypoint | Status | Proof | Sample emission | Evidence status | Evidence path | Source artifact | Source kind | Source completion | Source proof | Source phase | Source BOM | Source Spec | Source Gate | Details | Reason |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for cell in report["cells"]:
        evidence = cell.get("evidence", {})
        evidence_status = evidence.get("status", "n/a") if isinstance(evidence, dict) else "n/a"
        evidence_path = evidence.get("path", "n/a") if isinstance(evidence, dict) else "n/a"
        source_artifact = evidence.get("sourceArtifact", "n/a") if isinstance(evidence, dict) else "n/a"
        source_completion = evidence.get("completionStatus", "n/a") if isinstance(evidence, dict) else "n/a"
        source_proof = evidence.get("proofStatus", "n/a") if isinstance(evidence, dict) else "n/a"
        source_phase = evidence.get("sourcePhase", "n/a") if isinstance(evidence, dict) else "n/a"
        source_kind = evidence.get("sourceArtifactKind", "n/a") if isinstance(evidence, dict) else "n/a"
        source_bom = format_markdown_list(evidence.get("sourceBom")) if isinstance(evidence, dict) else "n/a"
        source_spec = format_markdown_list(evidence.get("sourceSpec")) if isinstance(evidence, dict) else "n/a"
        source_gate = evidence.get("sourceGate", "n/a") if isinstance(evidence, dict) else "n/a"
        detail_items: list[str] = []
        if isinstance(evidence, dict):
            raw_details = evidence.get("details")
            if isinstance(raw_details, list):
                detail_items.extend(str(item) for item in raw_details)
            raw_issues = evidence.get("issueBreakdown")
            if isinstance(raw_issues, list):
                detail_items.extend(
                    f"issue={issue.get('category', 'unknown')}"
                    for issue in raw_issues
                    if isinstance(issue, dict)
                )
            raw_commands = evidence.get("recommendedReviewCommands")
            if isinstance(raw_commands, list):
                detail_items.extend(
                    f"review={command.get('command')}"
                    for command in raw_commands
                    if isinstance(command, dict) and command.get("command")
                )
        details = format_markdown_list(detail_items) if detail_items else "n/a"
        lines.append(
            "| `{cellId}` | `{runtime}` | `{entrypoint}` | `{status}` | `{proof}` | `{sample}` | `{evidenceStatus}` | `{evidencePath}` | `{sourceArtifact}` | `{sourceKind}` | `{sourceCompletion}` | `{sourceProof}` | `{sourcePhase}` | `{sourceBom}` | `{sourceSpec}` | `{sourceGate}` | `{details}` | {reason} |".format(
                cellId=cell["cellId"],
                runtime=cell["runtime"],
                entrypoint=cell["entrypoint"],
                status=cell["status"],
                proof=cell["proofStatus"],
                sample="allowed" if cell["sampleEmissionAllowed"] else "blocked",
                evidenceStatus=evidence_status,
                evidencePath=evidence_path,
                sourceArtifact=source_artifact,
                sourceKind=source_kind,
                sourceCompletion=source_completion,
                sourceProof=source_proof,
                sourcePhase=source_phase,
                sourceBom=source_bom,
                sourceSpec=source_spec,
                sourceGate=source_gate,
                details=details,
                reason=cell["reason"],
            )
        )
    lines.extend(["", "## Red Lines", ""])
    lines.append("| Policy | Scope | Status | Proof | Matched interactions | Window count | Raw evidence status | Raw evidence path | Raw source artifact | Raw source kind | Raw source completion | Raw source proof | Raw source phase | Raw source BOM | Raw source Spec | Raw source Gate | Raw details | Reason |")
    lines.append("|---|---|---|---|---|---:|---|---|---|---|---|---|---|---|---|---|---|---|")
    for policy in report["redLinePolicy"]["policies"]:
        raw_evidence = policy.get("rawEvidence", {})
        raw_evidence_status = raw_evidence.get("status", "n/a") if isinstance(raw_evidence, dict) else "n/a"
        raw_evidence_path = raw_evidence.get("path", "n/a") if isinstance(raw_evidence, dict) else "n/a"
        raw_source_artifact = raw_evidence.get("sourceArtifact", "n/a") if isinstance(raw_evidence, dict) else "n/a"
        raw_source_completion = raw_evidence.get("completionStatus", "n/a") if isinstance(raw_evidence, dict) else "n/a"
        raw_source_proof = raw_evidence.get("proofStatus", "n/a") if isinstance(raw_evidence, dict) else "n/a"
        raw_source_phase = raw_evidence.get("sourcePhase", "n/a") if isinstance(raw_evidence, dict) else "n/a"
        raw_source_kind = raw_evidence.get("sourceArtifactKind", "n/a") if isinstance(raw_evidence, dict) else "n/a"
        raw_source_bom = format_markdown_list(raw_evidence.get("sourceBom")) if isinstance(raw_evidence, dict) else "n/a"
        raw_source_spec = format_markdown_list(raw_evidence.get("sourceSpec")) if isinstance(raw_evidence, dict) else "n/a"
        raw_source_gate = raw_evidence.get("sourceGate", "n/a") if isinstance(raw_evidence, dict) else "n/a"
        raw_details = format_markdown_list(raw_evidence.get("details")) if isinstance(raw_evidence, dict) else "n/a"
        lines.append(
            "| `{policyId}` | {scope} | `{status}` | `{proof}` | `{matched}` | {windowCount} | `{rawEvidenceStatus}` | `{rawEvidencePath}` | `{rawSourceArtifact}` | `{rawSourceKind}` | `{rawSourceCompletion}` | `{rawSourceProof}` | `{rawSourcePhase}` | `{rawSourceBom}` | `{rawSourceSpec}` | `{rawSourceGate}` | `{rawDetails}` | {reason} |".format(
                policyId=policy["policyId"],
                scope=policy["scope"],
                status=policy["status"],
                proof=policy["proofStatus"],
                matched=format_markdown_list(policy.get("matchedInteractionIds")),
                windowCount=policy.get("interactionWindowCount", "n/a"),
                rawEvidenceStatus=raw_evidence_status,
                rawEvidencePath=raw_evidence_path,
                rawSourceArtifact=raw_source_artifact,
                rawSourceKind=raw_source_kind,
                rawSourceCompletion=raw_source_completion,
                rawSourceProof=raw_source_proof,
                rawSourcePhase=raw_source_phase,
                rawSourceBom=raw_source_bom,
                rawSourceSpec=raw_source_spec,
                rawSourceGate=raw_source_gate,
                rawDetails=raw_details,
                reason=policy["reason"],
            )
        )
    lines.extend(
        [
            "",
            "## Boundary",
            "",
            "- This gate is a Dev/CI matrix mirror, not the Station product sink.",
            "- Missing preflight evidence blocks sample emission.",
            "- Browser/gateway evidence is not a substitute for Tauri WebView evidence.",
        ]
    )
    return "\n".join(lines) + "\n"


def write_outputs(report: dict[str, Any], output_prefix: str) -> tuple[Path, Path]:
    prefix = Path(output_prefix)
    prefix.parent.mkdir(parents=True, exist_ok=True)
    json_path = prefix.with_suffix(".json")
    md_path = prefix.with_suffix(".md")
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    md_path.write_text(render_markdown(report), encoding="utf-8")
    return json_path, md_path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--live-gate-report",
        default="tooling/acceptance/reports/desktop-telemetry-live-gate.json",
    )
    parser.add_argument(
        "--preflight-report",
        default="tooling/acceptance/reports/desktop-performance-preflight.json",
    )
    parser.add_argument(
        "--cohort-report",
        default="tooling/acceptance/reports/desktop-performance-cohort-gate.json",
    )
    parser.add_argument(
        "--output-prefix",
        default="tooling/acceptance/reports/desktop-performance-matrix-latest",
    )
    parser.add_argument(
        "--events-report",
        default="tooling/acceptance/reports/desktop-performance-latest.json",
        help="Dev mirror report containing raw frontend telemetry events for red-line evaluation.",
    )
    parser.add_argument(
        "--cell-evidence-dir",
        default="tooling/acceptance/reports/desktop-performance-cells",
        help="Directory containing per-runtime cell evidence files named <cellId>.json.",
    )
    args = parser.parse_args()

    report = build_matrix(args)
    json_path, md_path = write_outputs(report, args.output_prefix)
    print(f"desktop performance matrix: {json_path}")
    print(f"desktop performance matrix: {md_path}")
    print(f"status: {report['status']}")
    return 0 if report["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
